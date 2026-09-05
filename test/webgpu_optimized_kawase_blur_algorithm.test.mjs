import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ALGORITHM_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgpu/webgpu_optimized_kawase_blur_algorithm.js',
    import.meta.url
));
const POOL_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgpu/webgpu_transient_texture_pool.js',
    import.meta.url
));

const [algorithmSource, poolSource] = await Promise.all([
    readFile(ALGORITHM_PATH, 'utf8'),
    readFile(POOL_PATH, 'utf8')
]);

async function loadAlgorithmModule() {
    const context = vm.createContext({ console });
    const poolModule = new vm.SourceTextModule(poolSource, {
        context,
        identifier: POOL_PATH
    });
    const algorithmModule = new vm.SourceTextModule(algorithmSource, {
        context,
        identifier: ALGORITHM_PATH
    });
    await algorithmModule.link(async (specifier) => {
        if (specifier === './webgpu_transient_texture_pool.js') {
            return poolModule;
        }
        throw new Error(`예상하지 못한 optimized Kawase import입니다: ${specifier}`);
    });
    await algorithmModule.evaluate();
    return algorithmModule.namespace;
}

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function createSourceTexture(id, width, height, format = 'rgba8unorm') {
    const record = { id, viewCount: 0, destroyCount: 0 };
    const texture = {
        id,
        width,
        height,
        format,
        createView(descriptor = {}) {
            record.viewCount += 1;
            return Object.freeze({
                id: `${id}:view:${record.viewCount}`,
                texture,
                width,
                height,
                descriptor: cloneRecord(descriptor)
            });
        },
        destroy() {
            record.destroyCount += 1;
        }
    };
    return { texture, record };
}

function createDevice(id) {
    const records = {
        id,
        samplers: [],
        shaderModules: [],
        pipelines: [],
        bindGroups: [],
        buffers: [],
        writeBuffers: [],
        textures: [],
        forbiddenSubmitCount: 0
    };
    const device = {
        id,
        queue: {
            writeBuffer(buffer, bufferOffset, data) {
                records.writeBuffers.push({
                    buffer,
                    bufferOffset,
                    data: Array.from(data)
                });
            },
            submit() {
                records.forbiddenSubmitCount += 1;
                throw new Error('algorithm이 직접 submit하면 안 됩니다.');
            }
        },
        createSampler(descriptor) {
            const sampler = Object.freeze({
                id: `${id}:sampler:${records.samplers.length}`,
                descriptor: cloneRecord(descriptor)
            });
            records.samplers.push(sampler);
            return sampler;
        },
        createShaderModule(descriptor) {
            const module = Object.freeze({
                id: `${id}:shader:${records.shaderModules.length}`,
                descriptor: cloneRecord(descriptor)
            });
            records.shaderModules.push(module);
            return module;
        },
        createRenderPipeline(descriptor) {
            const pipelineRecord = {
                id: `${id}:pipeline:${records.pipelines.length}`,
                descriptor: cloneRecord(descriptor),
                entryPoint: descriptor.fragment.entryPoint,
                bindGroupLayoutRequests: []
            };
            const pipeline = {
                id: pipelineRecord.id,
                entryPoint: pipelineRecord.entryPoint,
                getBindGroupLayout(index) {
                    pipelineRecord.bindGroupLayoutRequests.push(index);
                    return Object.freeze({
                        id: `${pipelineRecord.id}:layout:${index}`,
                        pipeline
                    });
                }
            };
            pipelineRecord.pipeline = pipeline;
            records.pipelines.push(pipelineRecord);
            return pipeline;
        },
        createBindGroup(descriptor) {
            const bindGroup = Object.freeze({
                id: `${id}:bind-group:${records.bindGroups.length}`,
                descriptor
            });
            records.bindGroups.push(bindGroup);
            return bindGroup;
        },
        createBuffer(descriptor) {
            const bufferRecord = {
                id: `${id}:buffer:${records.buffers.length}`,
                descriptor: cloneRecord(descriptor),
                destroyCount: 0
            };
            const buffer = {
                id: bufferRecord.id,
                destroy() {
                    bufferRecord.destroyCount += 1;
                }
            };
            bufferRecord.buffer = buffer;
            records.buffers.push(bufferRecord);
            return buffer;
        },
        createTexture(descriptor) {
            const width = descriptor.size.width;
            const height = descriptor.size.height;
            const textureRecord = {
                id: `${id}:texture:${records.textures.length}`,
                descriptor: cloneRecord(descriptor),
                views: [],
                destroyCount: 0
            };
            const texture = {
                id: textureRecord.id,
                width,
                height,
                format: descriptor.format,
                createView(viewDescriptor = {}) {
                    const view = Object.freeze({
                        id: `${textureRecord.id}:view:${textureRecord.views.length}`,
                        texture,
                        width,
                        height,
                        descriptor: cloneRecord(viewDescriptor)
                    });
                    textureRecord.views.push(view);
                    return view;
                },
                destroy() {
                    textureRecord.destroyCount += 1;
                }
            };
            textureRecord.texture = texture;
            records.textures.push(textureRecord);
            return texture;
        }
    };
    return { device, records };
}

function createEncoder(id, options = {}) {
    const records = { id, passes: [] };
    let localPassIndex = 0;
    const encoder = {
        id,
        beginRenderPass(descriptor) {
            const passIndex = localPassIndex++;
            if (passIndex === options.failAtPass) {
                throw new Error(`forced-render-pass-failure:${passIndex}`);
            }
            const passRecord = {
                index: passIndex,
                descriptor,
                pipeline: null,
                bindGroups: [],
                draws: [],
                endCount: 0
            };
            records.passes.push(passRecord);
            return {
                setPipeline(pipeline) {
                    passRecord.pipeline = pipeline;
                },
                setBindGroup(index, bindGroup) {
                    passRecord.bindGroups.push({ index, bindGroup });
                },
                draw(...args) {
                    passRecord.draws.push(args);
                },
                end() {
                    passRecord.endCount += 1;
                }
            };
        }
    };
    return { encoder, records };
}

function createComposerHarness(options = {}) {
    const deferred = [];
    const port = {
        deferFrameCallbacks(callbacks) {
            if (options.rejectCallbacks) {
                return false;
            }
            deferred.push(callbacks);
            return true;
        }
    };
    return {
        port,
        deferred,
        settle(kind, frameId) {
            const callbacks = deferred.splice(0, deferred.length);
            for (const callback of callbacks) {
                callback[kind]?.(Object.freeze({
                    frameId,
                    submitted: kind === 'committed',
                    reason: kind === 'aborted' ? 'test-abort' : null
                }));
            }
        }
    };
}

function createContext(device, deviceGeneration, frameId, width, height, options = {}) {
    const encoderHarness = createEncoder(`encoder:${frameId}`, options);
    const format = options.format || 'rgba8unorm';
    return {
        context: Object.freeze({
            frameId,
            device,
            deviceGeneration,
            encoder: encoderHarness.encoder,
            target: Object.freeze({
                device,
                deviceGeneration,
                format,
                width,
                height,
                view: Object.freeze({ id: `canvas-view:${frameId}` })
            }),
            format,
            width,
            height
        }),
        records: encoderHarness.records
    };
}

function createRequest(sourceTexture, sigma, overrides = {}) {
    return Object.freeze({
        algorithmId: 'kawase-optimized',
        sourceTexture,
        sourceRevision: overrides.sourceRevision ?? 1,
        checkpointId: overrides.checkpointId || 'root',
        bounds: Object.freeze(overrides.bounds || {
            x: 0,
            y: 0,
            width: sourceTexture.width,
            height: sourceTexture.height
        }),
        halo: Object.freeze(overrides.halo || {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
        }),
        sigma,
        edgeMode: overrides.edgeMode || 'clamp',
        colorSpace: overrides.colorSpace || 'srgb',
        format: overrides.format || sourceTexture.format
    });
}

function assertClose(actual, expected, epsilon = 1e-6) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

test('optimized ID, normalized premultiplied shader와 presentation ownership 금지를 고정한다', async () => {
    const namespace = await loadAlgorithmModule();
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_ALGORITHM_ID,
        'kawase-optimized'
    );
    assert.equal(namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.MAX_PASS_COUNT, 5);
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.PYRAMID_PASS_COUNT,
        4
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.FILTER_CENTER_MIX_CAP,
        0.625
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.SIGMA_QUANTIZATION_STEP,
        1 / 16
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_SUBPIXEL_IDENTITY_SIGMA_CUTOFF,
        0.1
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_SUBPIXEL_IDENTITY_MAX_FOLDED_SIGMA,
        1 / 8
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE,
        1 / 64
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS
            .SUBPIXEL_IDENTITY_REQUEST_SIGMA_CUTOFF,
        0.1
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS
            .SUBPIXEL_IDENTITY_MAX_FOLDED_SIGMA,
        1 / 8
    );
    assert.equal(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE,
        1 / 64
    );
    assert.equal(
        (namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER.match(/\* 0\.125;/g) || []).length,
        4
    );
    assert.match(namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER, /\* 0\.5;/);
    assert.match(namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER, /diagonal \*= 0\.25;/);
    assert.match(namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER, /center \* \(1\.0 - centerMix\)/);
    assert.match(namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER, /fn kawase_reconstruct/u);
    assert.match(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER,
        /original \* \(1\.0 - blurWeight\) \+ blurred \* blurWeight/u
    );
    assert.match(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER,
        /input\.position\.xy \/ \(blurExtent \* 4\.0\)/u
    );
    assert.match(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER,
        /textureSampleLevel\(sourceTexture, sourceSampler, input\.uv, 0\.0\)/u,
        'non-uniform pass index 분기 안의 center fetch는 explicit LOD여야 함'
    );
    assert.doesNotMatch(
        namespace.WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER,
        /\blet\s+pass\b/u,
        'pass는 Chromium WGSL 예약어라 local identifier로 사용할 수 없음'
    );
    assert.match(algorithmSource, /addressModeU:\s*'clamp-to-edge'/u);
    assert.match(algorithmSource, /addressModeV:\s*'clamp-to-edge'/u);

    for (const forbiddenCall of [
        'queue.submit',
        'acquireFrameTarget',
        'getCurrentTexture',
        'markCanvasDrawn',
        'markCanvasCleared',
        '.finish('
    ]) {
        assert.equal(algorithmSource.includes(forbiddenCall), false, `${forbiddenCall} 호출 금지`);
    }
});

test('0.1px 이하 requested sigma는 identity이고 나머지 bucket은 멱등이다', async () => {
    const namespace = await loadAlgorithmModule();
    const quantize = namespace.quantizeWebGpuOptimizedKawaseSigma;
    const requiredHalo = namespace.getWebGpuOptimizedKawaseRequiredHalo;
    assert.equal(quantize(0), 0);
    assert.equal(quantize(-10), 0);
    assert.equal(quantize(0.001), 0);
    assert.equal(quantize(0.1), 0);
    assert.equal(quantize(0.100001), 0.125);
    assert.equal(quantize(0.125), 0.125);
    assert.equal(quantize(0.126), 0.125);
    assert.equal(quantize(1.03), 1);
    assert.equal(quantize(1.04), 1.0625);
    assert.equal(quantize(16), 16);
    assert.throws(() => quantize(16.01), /16 이하/);
    assert.equal(requiredHalo(0), 0);
    assert.equal(requiredHalo(0.1), 0);
    assert.ok(requiredHalo(0.100001) > 0);
    assert.ok(requiredHalo(0.125) > 0);
    assert.ok(requiredHalo(0.126) > 0);
    assert.equal(requiredHalo(7.5625), 25);
    for (const sigma of [0, 0.001, 0.1, 0.100001, 0.125, 0.126, 1.04, 16]) {
        const quantized = quantize(sigma);
        assert.equal(quantize(quantized), quantized, `sigma ${sigma} bucket은 멱등이어야 함`);
    }
});

test('subpixel cutoff를 넘는 sigma가 고정 quarter pyramid와 full reconstruction topology를 사용한다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory,
        getWebGpuOptimizedKawaseRequiredHalo
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('topology');
    const composer = createComposerHarness();
    const factory = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    });
    assert.equal(factory.getPreparationSigma(1.04), 1.0625);
    assert.equal(factory.getRequiredHalo({ sigma: 7.5625 }), 25);
    const algorithm = factory({ device: deviceHarness.device, deviceGeneration: 2 });
    const source = createSourceTexture('source', 401, 241);
    const frame = createContext(deviceHarness.device, 2, 1, 401, 241);

    const cases = [0.1875, 1, 2, 3.5, 3.5625, 6.5, 7.5, 7.5625, 10];
    for (const sigma of cases) {
        const prepared = algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, sigma),
            key: `sigma:${sigma}`
        });
        assert.equal(prepared.topology, 'fixed-quarter-pyramid-reconstruct');
        assert.equal(prepared.passes.length, 4);
        assert.equal(prepared.totalPassCount, 5);
        assert.equal(prepared.alignmentDivisor, 4);
        assert.equal(prepared.finalWidth, 401);
        assert.equal(prepared.finalHeight, 241);
        assert.equal(prepared.reconstructionPass.targetWidth, 401);
        assert.equal(prepared.reconstructionPass.targetHeight, 241);
        assertClose(prepared.reconstructedSigma, sigma, 2e-6);
        assert.ok(prepared.centerMix <= 0.625);
        assert.equal(
            prepared.passes
                .filter((pass) => pass.kind === 'filter')
                .every((pass) => pass.hardwareSampleCount === 5),
            true
        );
        assert.ok(prepared.requiredHalo >= Math.ceil(sigma * 3));
        assert.equal(
            prepared.requiredHalo,
            getWebGpuOptimizedKawaseRequiredHalo(sigma)
        );
        assert.equal(prepared.sigmaQuantizationStep, 1 / 16);
        assert.equal(prepared.finalOutputFetchesPerOutputPixel, 2);
        assert.ok(prepared.sourcePixelEquivalentSamplesPerOutputPixel < 4.25);
    }
    assert.equal(deviceHarness.records.textures.length, 0, 'prepare에서 texture lease 금지');
    assert.equal(deviceHarness.records.pipelines.length, 3, 'format pipeline은 한 번만 생성');
    algorithm.destroy();
});

test('고정 pyramid는 64B filter uniform과 전용 reconstruction bind group으로 encode된다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('half');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 3 });
    const source = createSourceTexture('half-source', 400, 240);
    const request = createRequest(source.texture, 6.5);
    const frame = createContext(deviceHarness.device, 3, 41, 400, 240);
    const prepared = algorithm.prepare({ context: frame.context, request, key: 'half' });
    const output = algorithm.encode({
        context: frame.context,
        request,
        key: 'half',
        prepared
    });

    assert.equal(output.algorithmId, 'kawase-optimized');
    assert.equal(output.topology, 'fixed-quarter-pyramid-reconstruct');
    assert.equal(output.quantizedSigma, 6.5);
    assert.equal(output.width, 400);
    assert.equal(output.height, 240);
    assert.equal(output.passCount, 5);
    assert.equal(frame.records.passes.length, 5);
    assert.deepEqual(
        frame.records.passes.map((pass) => pass.pipeline.entryPoint),
        [
            'kawase_downsample',
            'kawase_downsample',
            'kawase_filter',
            'kawase_filter',
            'kawase_reconstruct'
        ]
    );
    assert.deepEqual(
        frame.records.passes.map((pass) => pass.draws[0]),
        [[3, 1, 0, 0], [3, 1, 0, 1], [3, 1, 0, 2], [3, 1, 0, 3], [3, 1, 0, 0]]
    );
    for (const pass of frame.records.passes) {
        const attachment = pass.descriptor.colorAttachments[0];
        assert.equal(attachment.loadOp, 'clear');
        assert.equal(attachment.storeOp, 'store');
        assert.equal(pass.endCount, 1);
    }
    assert.equal(deviceHarness.records.buffers.length, 2);
    assert.equal(deviceHarness.records.buffers[0].descriptor.size, 64);
    assert.equal(deviceHarness.records.buffers[1].descriptor.size, 16);
    assert.equal(deviceHarness.records.writeBuffers.length, 2);
    assert.equal(deviceHarness.records.writeBuffers[0].data.length, 16);
    const uniforms = deviceHarness.records.writeBuffers[0].data;
    assertClose(uniforms[0], 1 / 400);
    assertClose(uniforms[1], 1 / 240);
    assert.equal(uniforms[2], 0.5);
    assert.equal(uniforms[3], 0.5);
    assertClose(uniforms[4], 1 / 200);
    assertClose(uniforms[5], 1 / 120);
    assert.equal(uniforms[6], 0.5);
    assert.equal(uniforms[7], 0.5);
    assertClose(uniforms[10], prepared.filterOffset);
    assertClose(uniforms[11], prepared.centerMix);
    assertClose(deviceHarness.records.writeBuffers[1].data[0], prepared.blurWeight);
    assert.equal(deviceHarness.records.textures.length, 4);
    assert.equal(
        Array.from(
            deviceHarness.records.bindGroups.at(-1).descriptor.entries,
            (entry) => entry.binding
        ).join(','),
        '0,1,3,4'
    );
    assertClose(output.sourcePixelEquivalentSamplesPerOutputPixel, 4.1875);
    assert.equal(output.finalOutputFetchesPerOutputPixel, 2);
    assert.equal(composer.deferred.length, 1);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 1);
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);

    composer.settle('committed', 41);
    assert.equal(algorithm.getDiagnostics().activeFrameId, null);
    assert.equal(algorithm.getDiagnostics().completedFrameCount, 1);
    algorithm.destroy();
});

test('같은 topology warm frame은 GPU resource를 추가 생성하지 않는다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('warm');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('warm-source', 640, 360);
    const request = createRequest(source.texture, 10);
    const firstFrame = createContext(deviceHarness.device, 1, 1, 640, 360);
    const prepared = algorithm.prepare({
        context: firstFrame.context,
        request,
        key: 'warm'
    });
    algorithm.encode({ context: firstFrame.context, request, key: 'warm', prepared });
    composer.settle('committed', 1);

    const warmCounts = {
        samplers: deviceHarness.records.samplers.length,
        shaders: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    };
    const secondFrame = createContext(deviceHarness.device, 1, 2, 640, 360);
    algorithm.encode({ context: secondFrame.context, request, key: 'warm', prepared });
    assert.deepEqual({
        samplers: deviceHarness.records.samplers.length,
        shaders: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    }, warmCounts);
    composer.settle('committed', 2);
    algorithm.destroy();
});

test('같은 frame의 두 output은 uniform buffer와 최종 lease를 공유하지 않는다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('multi');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 5 });
    const source = createSourceTexture('multi-source', 320, 180);
    const firstRequest = createRequest(source.texture, 6.5, { checkpointId: 'base' });
    const secondRequest = createRequest(source.texture, 10, { checkpointId: 'floating' });
    const frame = createContext(deviceHarness.device, 5, 70, 320, 180);
    const firstPrepared = algorithm.prepare({
        context: frame.context,
        request: firstRequest,
        key: 'first'
    });
    const secondPrepared = algorithm.prepare({
        context: frame.context,
        request: secondRequest,
        key: 'second'
    });
    const firstOutput = algorithm.encode({
        context: frame.context,
        request: firstRequest,
        key: 'first',
        prepared: firstPrepared
    });
    const secondOutput = algorithm.encode({
        context: frame.context,
        request: secondRequest,
        key: 'second',
        prepared: secondPrepared
    });

    assert.equal(deviceHarness.records.writeBuffers.length, 4);
    assert.notStrictEqual(
        deviceHarness.records.writeBuffers[0].buffer,
        deviceHarness.records.writeBuffers[2].buffer
    );
    assert.notStrictEqual(
        deviceHarness.records.writeBuffers[1].buffer,
        deviceHarness.records.writeBuffers[3].buffer
    );
    assert.notStrictEqual(firstOutput.texture, secondOutput.texture);
    assert.equal(composer.deferred.length, 1);
    composer.settle('aborted', 70);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);
    assert.equal(algorithm.getDiagnostics().abortedFrameCount, 1);
    algorithm.destroy();
});

test('sigma 0과 0.1px 이하는 source identity이고 cutoff 위는 convex weight로 연속이다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('identity');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('identity-source', 128, 72);
    const frame = createContext(deviceHarness.device, 1, 1, 128, 72);
    const zeroRequest = createRequest(source.texture, 0);
    const zeroPrepared = algorithm.prepare({
        context: frame.context,
        request: zeroRequest,
        key: 'zero'
    });
    const zeroOutput = algorithm.encode({
        context: frame.context,
        request: zeroRequest,
        key: 'zero',
        prepared: zeroPrepared
    });
    assert.strictEqual(zeroOutput.texture, source.texture);
    assert.equal(zeroOutput.passCount, 0);
    assert.equal(composer.deferred.length, 0);
    assert.equal(deviceHarness.records.textures.length, 0);

    const tinyRequest = createRequest(source.texture, 0.1);
    const tinyPrepared = algorithm.prepare({
        context: frame.context,
        request: tinyRequest,
        key: 'tiny'
    });
    const tinyOutput = algorithm.encode({
        context: frame.context,
        request: tinyRequest,
        key: 'tiny',
        prepared: tinyPrepared
    });
    assert.equal(tinyPrepared.quantizedSigma, 0);
    assert.equal(tinyPrepared.topology, 'identity');
    assert.equal(tinyPrepared.centerMix, 0);
    assert.equal(tinyPrepared.blurWeight, 0);
    assert.equal(tinyPrepared.requiredHalo, 0);
    assert.equal(tinyPrepared.totalPassCount, 0);
    assert.equal(tinyPrepared.filterPassCount, 0);
    assert.strictEqual(tinyOutput.texture, source.texture);
    assert.equal(tinyOutput.passCount, 0);
    assert.equal(deviceHarness.records.textures.length, 0);

    const aboveCutoffRequest = createRequest(source.texture, 0.100001);
    const aboveCutoffPrepared = algorithm.prepare({
        context: frame.context,
        request: aboveCutoffRequest,
        key: 'above-cutoff'
    });
    assert.equal(aboveCutoffPrepared.quantizedSigma, 0.125);
    assert.equal(aboveCutoffPrepared.topology, 'fixed-quarter-pyramid-reconstruct');
    assertClose(aboveCutoffPrepared.blurWeight, (0.125 ** 2) / 4);
    assert.ok(
        255 * aboveCutoffPrepared.blurWeight < 1,
        'cutoff 직후 topology 전환은 RGBA8 최악 채널 차이 1 LSB 미만이어야 함'
    );
    assert.equal(aboveCutoffPrepared.totalPassCount, 5);
    assert.equal(aboveCutoffPrepared.filterPassCount, 2);
    algorithm.destroy();
});

test('pure metrics가 blurWeight, phase variance와 exact halo preflight를 함께 결정한다', async () => {
    const {
        getWebGpuOptimizedKawaseMetrics,
        getWebGpuOptimizedKawaseRequiredHalo
    } = await loadAlgorithmModule();
    const small = getWebGpuOptimizedKawaseMetrics(1);
    assert.equal(small.basePyramidAxisVariance, 4);
    assert.equal(small.residualVariance, 0);
    assert.equal(small.centerMix, 0);
    assert.equal(small.blurWeight, 0.25);
    assert.deepEqual(
        Array.from(small.phaseVariance, (entry) => entry.baseVariance),
        [5, 3, 3, 5]
    );
    const large = getWebGpuOptimizedKawaseMetrics(6.5);
    assert.equal(large.blurWeight, 1);
    assertClose(large.reconstructedSigma, 6.5, 2e-6);
    assert.equal(
        large.requiredHalo,
        Math.ceil(Math.max(6.5 * 3, large.exactKernelSupport) + 2)
    );
    assert.equal(large.requiredHalo, getWebGpuOptimizedKawaseRequiredHalo(6.5));
});

test('1/16 sigma bucket과 이전 3.5/7.5 경계에서 topology와 extent가 변하지 않는다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('continuity');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('continuity-source', 800, 450);
    const frame = createContext(deviceHarness.device, 1, 1, 800, 450);
    const prepare = (sigma) => algorithm.prepare({
        context: frame.context,
        request: createRequest(source.texture, sigma),
        key: `continuity:${sigma}`
    });

    const referenceExtents = prepare(0.1875).passes.map(
        (pass) => [pass.targetWidth, pass.targetHeight]
    );
    for (const [beforeSigma, afterSigma] of [
        [1.5, 1.5625],
        [3.5, 3.5625],
        [7.5, 7.5625]
    ]) {
        const before = prepare(beforeSigma);
        const after = prepare(afterSigma);
        assertClose(before.reconstructedSigma, beforeSigma, 3e-6);
        assertClose(after.reconstructedSigma, afterSigma, 3e-6);
        assert.ok(before.centerMix <= 0.625);
        assert.ok(after.centerMix <= 0.625);
        assert.equal(before.filterPassCount, 2);
        assert.equal(after.filterPassCount, 2);
        assert.equal(before.topology, 'fixed-quarter-pyramid-reconstruct');
        assert.equal(after.topology, before.topology);
        assert.equal(
            JSON.stringify(Array.from(
                before.passes,
                (pass) => [pass.targetWidth, pass.targetHeight]
            )),
            JSON.stringify(referenceExtents)
        );
        assert.equal(
            JSON.stringify(Array.from(
                after.passes,
                (pass) => [pass.targetWidth, pass.targetHeight]
            )),
            JSON.stringify(referenceExtents)
        );
        assert.equal(after.finalWidth, 800);
        assert.equal(after.finalHeight, 450);
    }
    algorithm.destroy();
});

test('CPU bilinear PSF golden은 odd/even extent와 16개 mod4 phase에서 연속·정규화된다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('psf-golden');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });

    for (const [width, height] of [[128, 132], [129, 133]]) {
        const source = createSourceTexture(`psf:${width}x${height}`, width, height);
        const frame = createContext(deviceHarness.device, 1, 1, width, height);
        const prepare = (sigma) => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, sigma),
            key: `psf:${width}x${height}:${sigma}`
        });
        const preparedSmall = prepare(1);
        const preparedSmallNext = prepare(1.0625);
        const preparedLarge = prepare(6.5);
        const preparedLargeNext = prepare(6.5625);
        const preparedThreshold = prepare(2);

        for (let phaseY = 0; phaseY < 4; phaseY++) {
            for (let phaseX = 0; phaseX < 4; phaseX++) {
                const outputX = 56 + phaseX;
                const outputY = 60 + phaseY;
                const small = measurePsf(simulateReconstructedPsf(
                    preparedSmall,
                    outputX,
                    outputY
                ));
                const smallNext = measurePsf(simulateReconstructedPsf(
                    preparedSmallNext,
                    outputX,
                    outputY
                ));
                const large = measurePsf(simulateReconstructedPsf(
                    preparedLarge,
                    outputX,
                    outputY
                ));
                const largeNext = measurePsf(simulateReconstructedPsf(
                    preparedLargeNext,
                    outputX,
                    outputY
                ));

                for (const metrics of [small, smallNext, large, largeNext]) {
                    assertClose(metrics.sum, 1, 1e-6);
                    assert.ok(metrics.minWeight >= -1e-12, 'PSF weight는 양수여야 함');
                    assertPremultipliedInvariant(metrics.sum);
                }
                assertClose(small.centerWeight, small.maxWeight, 1e-12);
                assert.ok(
                    Math.abs(small.sigma - 1) <= Math.max(0.15, 1 * 0.05),
                    `small sigma phase error: ${small.sigma}`
                );
                assert.ok(
                    Math.abs(large.sigma - 6.5) <= Math.max(0.15, 6.5 * 0.05),
                    `large sigma phase error: ${large.sigma}`
                );
                assert.ok(centroidDistance(small, smallNext) <= 0.25);
                assert.ok(centroidDistance(large, largeNext) <= 0.25);
                assert.ok(large.supportRadius <= preparedLarge.exactKernelSupport);

                const threshold = measurePsf(simulateReconstructedPsf(
                    preparedThreshold,
                    outputX,
                    outputY
                ));
                const expectedThresholdVariance = (
                    preparedThreshold.phaseVariance[phaseX].reconstructedVariance
                    + preparedThreshold.phaseVariance[phaseY].reconstructedVariance
                ) * 0.5;
                assertClose(threshold.sigma, Math.sqrt(expectedThresholdVariance), 2e-6);
                assert.ok(
                    threshold.sigma >= Math.sqrt(3) - 2e-6
                    && threshold.sigma <= Math.sqrt(5) + 2e-6,
                    'single bilinear reconstruction의 sigma=2 mod4 bound를 벗어남'
                );
            }
        }
    }
    algorithm.destroy();
});

test('render-pass 실패 cleanup 뒤 복구되고 generation drift는 기존 resource를 폐기한다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const firstDevice = createDevice('recovery-a');
    const composer = createComposerHarness();
    const factory = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    });
    const algorithm = factory({ device: firstDevice.device, deviceGeneration: 8 });
    const source = createSourceTexture('recovery-source', 320, 180);
    const request = createRequest(source.texture, 10);
    const failedFrame = createContext(firstDevice.device, 8, 90, 320, 180, {
        failAtPass: 2
    });
    const prepared = algorithm.prepare({
        context: failedFrame.context,
        request,
        key: 'recovery'
    });
    assert.throws(
        () => algorithm.encode({
            context: failedFrame.context,
            request,
            key: 'recovery',
            prepared
        }),
        /forced-render-pass-failure:2/
    );
    composer.settle('aborted', 90);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);

    const recoveredFrame = createContext(firstDevice.device, 8, 91, 320, 180);
    assert.equal(algorithm.encode({
        context: recoveredFrame.context,
        request,
        key: 'recovery',
        prepared
    }).passCount, 5);
    composer.settle('committed', 91);

    const secondDevice = createDevice('recovery-b');
    const secondContext = createContext(secondDevice.device, 9, 92, 320, 180);
    assert.throws(
        () => algorithm.prepare({
            context: secondContext.context,
            request,
            key: 'generation-drift'
        }),
        /device\/generation drift/
    );
    assert.equal(algorithm.getDiagnostics().destroyed, true);
    assert.equal(firstDevice.records.buffers.every((entry) => entry.destroyCount === 1), true);
    assert.equal(firstDevice.records.textures.every((entry) => entry.destroyCount === 1), true);
});

test('profile/format을 제한하고 extent 없는 adapter는 bounds+halo fallback을 사용한다', async () => {
    const {
        createWebGpuOptimizedKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('validation');
    const composer = createComposerHarness();
    const algorithm = createWebGpuOptimizedKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('validation-source', 100, 50);
    const frame = createContext(deviceHarness.device, 1, 1, 100, 50);
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 4, { edgeMode: 'mirror' }),
            key: 'mirror'
        }),
        /edgeMode=clamp/
    );
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 4, { colorSpace: 'linear-srgb' }),
            key: 'linear'
        }),
        /colorSpace=srgb/
    );
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 4, { format: 'rgba16float' }),
            key: 'float'
        }),
        /rgba8unorm, bgra8unorm/
    );

    delete source.texture.width;
    delete source.texture.height;
    const fallbackRequest = createRequest(source.texture, 6.5, {
        bounds: { x: 10, y: 5, width: 80, height: 40 },
        halo: { left: 10, top: 5, right: 10, bottom: 5 }
    });
    const prepared = algorithm.prepare({
        context: frame.context,
        request: fallbackRequest,
        key: 'fallback'
    });
    assert.equal(prepared.sourceWidth, 100);
    assert.equal(prepared.sourceHeight, 50);
    assert.equal(prepared.finalWidth, 100);
    assert.equal(prepared.finalHeight, 50);
    algorithm.destroy();
});

function simulateReconstructedPsf(prepared, outputX, outputY) {
    const quarterWidth = prepared.passes.at(-1).targetWidth;
    const quarterHeight = prepared.passes.at(-1).targetHeight;
    let blurDistribution = new Map();
    addBilinearPsfWeight(
        blurDistribution,
        (outputX - 1.5) / 4,
        (outputY - 1.5) / 4,
        prepared.blurWeight,
        quarterWidth,
        quarterHeight
    );

    for (let index = prepared.passes.length - 1; index >= 0; index--) {
        const pass = prepared.passes[index];
        const next = new Map();
        for (const point of blurDistribution.values()) {
            if (pass.kind === 'filter') {
                addBilinearPsfWeight(
                    next,
                    point.x,
                    point.y,
                    point.weight * (1 - pass.centerMix),
                    pass.sourceWidth,
                    pass.sourceHeight
                );
                for (const signX of [-1, 1]) {
                    for (const signY of [-1, 1]) {
                        addBilinearPsfWeight(
                            next,
                            point.x + signX * pass.offset,
                            point.y + signY * pass.offset,
                            point.weight * pass.centerMix * 0.25,
                            pass.sourceWidth,
                            pass.sourceHeight
                        );
                    }
                }
                continue;
            }
            const sourceX = point.x * 2 + 0.5;
            const sourceY = point.y * 2 + 0.5;
            addBilinearPsfWeight(
                next,
                sourceX,
                sourceY,
                point.weight * 0.5,
                pass.sourceWidth,
                pass.sourceHeight
            );
            for (const signX of [-1, 1]) {
                for (const signY of [-1, 1]) {
                    addBilinearPsfWeight(
                        next,
                        sourceX + signX * 0.5,
                        sourceY + signY * 0.5,
                        point.weight * 0.125,
                        pass.sourceWidth,
                        pass.sourceHeight
                    );
                }
            }
        }
        blurDistribution = next;
    }

    addPsfWeight(
        blurDistribution,
        outputX,
        outputY,
        1 - prepared.blurWeight
    );
    return Object.freeze({ distribution: blurDistribution, outputX, outputY });
}

function addBilinearPsfWeight(target, x, y, weight, width, height) {
    if (!(weight > 0)) return;
    const left = Math.floor(x);
    const top = Math.floor(y);
    const fractionX = x - left;
    const fractionY = y - top;
    addPsfWeight(target, clampIndex(left, width), clampIndex(top, height), weight * (1 - fractionX) * (1 - fractionY));
    addPsfWeight(target, clampIndex(left + 1, width), clampIndex(top, height), weight * fractionX * (1 - fractionY));
    addPsfWeight(target, clampIndex(left, width), clampIndex(top + 1, height), weight * (1 - fractionX) * fractionY);
    addPsfWeight(target, clampIndex(left + 1, width), clampIndex(top + 1, height), weight * fractionX * fractionY);
}

function clampIndex(value, extent) {
    return Math.max(0, Math.min(extent - 1, value));
}

function addPsfWeight(target, x, y, weight) {
    if (!(weight > 0)) return;
    const key = `${x},${y}`;
    const existing = target.get(key);
    if (existing) {
        existing.weight += weight;
    } else {
        target.set(key, { x, y, weight });
    }
}

function measurePsf(psf) {
    const distribution = psf.distribution;
    let sum = 0;
    let centroidX = 0;
    let centroidY = 0;
    let centerWeight = 0;
    let maxWeight = 0;
    let minWeight = Infinity;
    let supportRadius = 0;
    for (const point of distribution.values()) {
        sum += point.weight;
        centroidX += point.x * point.weight;
        centroidY += point.y * point.weight;
        if (point.x === psf.outputX && point.y === psf.outputY) centerWeight = point.weight;
        maxWeight = Math.max(maxWeight, point.weight);
        minWeight = Math.min(minWeight, point.weight);
        supportRadius = Math.max(
            supportRadius,
            Math.abs(point.x - psf.outputX),
            Math.abs(point.y - psf.outputY)
        );
    }
    centroidX /= sum;
    centroidY /= sum;
    let varianceX = 0;
    let varianceY = 0;
    for (const point of distribution.values()) {
        varianceX += (point.x - centroidX) ** 2 * point.weight;
        varianceY += (point.y - centroidY) ** 2 * point.weight;
    }
    varianceX /= sum;
    varianceY /= sum;
    return {
        sum,
        centroidX,
        centroidY,
        varianceX,
        varianceY,
        sigma: Math.sqrt((varianceX + varianceY) * 0.5),
        centerWeight,
        maxWeight,
        minWeight,
        supportRadius
    };
}

function centroidDistance(left, right) {
    return Math.hypot(
        right.centroidX - left.centroidX,
        right.centroidY - left.centroidY
    );
}

function assertPremultipliedInvariant(weightSum) {
    const premultiplied = [0.2, 0.1, 0.05, 0.25];
    const output = premultiplied.map((channel) => channel * weightSum);
    assert.ok(output[0] <= output[3] + 1e-12);
    assert.ok(output[1] <= output[3] + 1e-12);
    assert.ok(output[2] <= output[3] + 1e-12);
    assertClose(output[3], 0.25, 1e-6);
}
