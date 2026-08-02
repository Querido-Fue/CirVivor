import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ALGORITHM_PATH = fileURLToPath(new URL(
    '../script/module/display/webgpu/webgpu_gaussian_blur_algorithm.js',
    import.meta.url
));
const POOL_PATH = fileURLToPath(new URL(
    '../script/module/display/webgpu/webgpu_transient_texture_pool.js',
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
        throw new Error(`예상하지 못한 Gaussian algorithm import입니다: ${specifier}`);
    });
    await algorithmModule.evaluate();
    return algorithmModule.namespace;
}

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function createSourceTexture(id, width, height, format = 'rgba8unorm') {
    const record = {
        id,
        viewCount: 0,
        destroyCount: 0
    };
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
                throw new Error('algorithm이 직접 제출하면 안 됩니다.');
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
        algorithmId: 'gaussian-quality',
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

function readUniformSlot(writeRecord, slotIndex) {
    const offset = slotIndex * (256 / Float32Array.BYTES_PER_ELEMENT);
    return writeRecord.data.slice(offset, offset + 32);
}

test('quality ID/상한/shader는 paired separable Gaussian이고 presentation 소유 API를 호출하지 않는다', async () => {
    const namespace = await loadAlgorithmModule();
    const constants = namespace.WEBGPU_GAUSSIAN_BLUR_CONSTANTS;
    assert.equal(namespace.WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID, 'gaussian-quality');
    assert.equal(constants.MAX_EFFECTIVE_SIGMA, 4);
    assert.equal(constants.MIN_DOWNSAMPLE_SCALE, 1 / 4);
    assert.equal(constants.MAX_SOURCE_SIGMA, 16);
    assert.equal(constants.MAX_UNDOWNSAMPLED_SIGMA, 13 / 4);
    assert.equal(constants.MAX_KERNEL_RADIUS, 12);
    assert.equal(constants.MAX_PAIRED_TAP_COUNT, 6);
    assert.equal(constants.MAX_PASS_COUNT, 3);
    assert.equal(namespace.WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_SIGMA_CUTOFF, 1 / 8);
    assert.equal(namespace.WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE, 1 / 64);
    assert.equal(constants.SUBPIXEL_IDENTITY_SIGMA_CUTOFF, 1 / 8);
    assert.equal(constants.SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE, 1 / 64);
    assert.equal(constants.DOWNSAMPLE_SAMPLE_COUNT, 4);
    assert.deepEqual(
        Array.from(constants.DOWNSAMPLE_SCALE_BUCKETS, (bucket) => bucket.scale),
        [1, 3 / 4, 1 / 2, 3 / 8, 1 / 4]
    );
    assert.equal(
        constants.DOWNSAMPLE_SCALE_BUCKETS.every((bucket) => Object.isFrozen(bucket)),
        true
    );
    assert.equal(Object.isFrozen(constants.DOWNSAMPLE_SCALE_BUCKETS), true);
    assert.deepEqual(
        Array.from(constants.SUPPORTED_TEXTURE_FORMATS),
        ['rgba8unorm', 'bgra8unorm']
    );
    assert.equal(Object.isFrozen(constants.SUPPORTED_TEXTURE_FORMATS), true);
    assert.match(namespace.WEBGPU_GAUSSIAN_BLUR_SHADER, /pairedTaps/);
    assert.match(namespace.WEBGPU_GAUSSIAN_BLUR_SHADER, /input\.uv \+ offset/);
    assert.match(namespace.WEBGPU_GAUSSIAN_BLUR_SHADER, /input\.uv - offset/);

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

test('factory halo preflight는 GPU 생성 없이 exact support를 제공하고 subpixel identity를 0으로 보존한다', async () => {
    const {
        createWebGpuGaussianBlurAlgorithmFactory,
        getWebGpuGaussianRequiredHalo,
        WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_SIGMA_CUTOFF: cutoff
    } = await loadAlgorithmModule();
    const composer = createComposerHarness();
    const factory = createWebGpuGaussianBlurAlgorithmFactory({
        composerPort: composer.port
    });

    assert.equal(typeof factory.getRequiredHalo, 'function');
    for (const sigma of [0, 0.1, cutoff]) {
        assert.equal(getWebGpuGaussianRequiredHalo(sigma), 0);
        assert.equal(factory.getRequiredHalo({ sigma }), 0);
    }
    assert.equal(getWebGpuGaussianRequiredHalo(cutoff + Number.EPSILON), 3);
    assert.equal(factory.getRequiredHalo({ sigma: 3 }), 11);
    assert.equal(factory.getRequiredHalo({ sigma: 10 }), 35);
    assert.equal(factory.getRequiredHalo({ sigma: 16 }), 51);
    assert.throws(() => factory.getRequiredHalo({ sigma: 16.001 }), /sigma는 16 이하/);
    assert.equal(composer.deferred.length, 0, 'preflight는 frame callback/GPU instance를 만들지 않음');
});

test('prepare는 3-sigma 정규화/대칭 kernel과 bilinear paired tap을 한 번만 계산한다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('kernel');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 2
    });
    const source = createSourceTexture('kernel-source', 512, 256);
    const frame = createContext(deviceHarness.device, 2, 10, 512, 256);
    const request = createRequest(source.texture, 3, {
        sourceRevision: 19,
        checkpointId: 'animated-overlay'
    });
    const prepared = algorithm.prepare({ context: frame.context, request, key: 'structural-key' });
    const kernel = prepared.kernel;

    assert.equal(prepared.key, 'structural-key');
    assert.equal('sourceRevision' in prepared, false);
    assert.equal('checkpointId' in prepared, false);
    assert.equal(prepared.downsampleScale, 1);
    assert.equal(prepared.effectiveSigma, 3);
    assert.deepEqual(Array.from(prepared.passes, (pass) => pass.kind), [
        'horizontal',
        'vertical'
    ]);
    assert.equal(kernel.radius, 9);
    assert.equal(kernel.dispatchRadius, 9);
    assert.equal(kernel.logicalTapCount, 19);
    assert.equal(kernel.dispatchTapCount, 19);
    assert.equal(kernel.pairCount, 5);
    assert.equal(kernel.hardwareSampleCount, 11);
    assert.equal(Object.isFrozen(kernel), true);
    assert.equal(Object.isFrozen(kernel.logicalWeights), true);
    assert.equal(Object.isFrozen(kernel.pairedTaps), true);

    let logicalSum = kernel.logicalWeights[0];
    for (let index = 1; index < kernel.logicalWeights.length; index++) {
        assert.equal(kernel.logicalWeights[index], Math.fround(kernel.logicalWeights[index]));
        assert.ok(kernel.logicalWeights[index] <= kernel.logicalWeights[index - 1]);
        logicalSum += kernel.logicalWeights[index] * 2;
    }
    assertClose(logicalSum, 1, 2e-7);
    assertClose(kernel.normalizedWeightSum, 1, 2e-7);
    assertClose(kernel.variance, 9, 2e-6);
    assert.ok(kernel.weightSigma > kernel.sigma, '3-sigma truncation variance를 보정해야 합니다.');

    for (const tap of kernel.pairedTaps) {
        const firstWeight = kernel.logicalWeights[tap.firstIndex];
        const secondWeight = tap.secondIndex === null
            ? 0
            : kernel.logicalWeights[tap.secondIndex];
        const combined = Math.fround(firstWeight + secondWeight);
        const expectedOffset = Math.fround(
            (tap.firstIndex * firstWeight
                + (tap.secondIndex ?? tap.firstIndex + 1) * secondWeight) / combined
        );
        assert.equal(tap.weight, combined);
        assert.equal(tap.offset, expectedOffset);
        assert.ok(tap.offset >= tap.firstIndex);
        assert.ok(tap.offset <= (tap.secondIndex ?? tap.firstIndex));
    }

    assert.equal(deviceHarness.records.textures.length, 0, 'prepare에서는 transient lease 금지');
    assert.equal(deviceHarness.records.shaderModules.length, 1);
    assert.equal(deviceHarness.records.pipelines.length, 2);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    algorithm.destroy();
});

test('scale policy는 고정 5-bucket으로 4/8 절벽을 피하고 variance/상한 계약을 지킨다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('scale');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 1
    });
    const source = createSourceTexture('scale-source', 1001, 501);
    const frame = createContext(deviceHarness.device, 1, 1, 1001, 501);
    const cases = [
        [0, 1, 0],
        [0.5, 1, 2],
        [13 / 4, 1, 2],
        [13 / 4 + 0.0001, 3 / 4, 3],
        [4, 3 / 4, 3],
        [13 / 3, 3 / 4, 3],
        [13 / 3 + 0.0001, 1 / 2, 3],
        [13 / 2, 1 / 2, 3],
        [13 / 2 + 0.0001, 3 / 8, 3],
        [8, 3 / 8, 3],
        [26 / 3, 3 / 8, 3],
        [26 / 3 + 0.0001, 1 / 4, 3],
        [16, 1 / 4, 3]
    ];

    for (const [sigma, scale, passCount] of cases) {
        const request = createRequest(source.texture, sigma);
        const prepared = algorithm.prepare({
            context: frame.context,
            request,
            key: `scale:${sigma}`
        });
        assert.equal(prepared.downsampleScale, scale);
        assertClose(prepared.downsampleFactor, 1 / scale);
        assert.equal(prepared.passes.length, passCount);
        assert.ok(prepared.downsampleScale >= 1 / 4);
        assert.ok(prepared.downsampleFactor <= 4);
        if (sigma > 0) {
            assert.ok(prepared.effectiveSigma <= 4);
            assertClose(prepared.reconstructedSourceSigma, sigma, 3e-5);
            assertClose(prepared.sourcePsfVariance, sigma * sigma, 7e-4);
        }
        assert.equal(prepared.finalWidth, Math.ceil(1001 * scale));
        assert.equal(prepared.finalHeight, Math.ceil(501 * scale));
    }

    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 16.001),
            key: 'too-large'
        }),
        /sigma는 16 이하/
    );
    assert.equal(deviceHarness.records.textures.length, 0);
    algorithm.destroy();
});

test('scale 경계 PSF variance/source offset은 연속이고 fetch/pixel 절벽은 제거된다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('boundary-continuity');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 1
    });
    const source = createSourceTexture('boundary-source', 1600, 900);
    const frame = createContext(deviceHarness.device, 1, 1, 1600, 900);
    const prepare = (sigma) => algorithm.prepare({
        context: frame.context,
        request: createRequest(source.texture, sigma),
        key: `boundary:${sigma}`
    });
    const epsilon = 1e-6;
    const boundaries = [13 / 4, 13 / 3, 13 / 2, 26 / 3];
    const expectedFetchCounts = [22, 26, 26, 26];

    for (let index = 0; index < boundaries.length; index++) {
        const boundary = boundaries[index];
        const before = prepare(boundary - epsilon);
        const exact = prepare(boundary);
        const after = prepare(boundary + epsilon);

        assert.ok(before.downsampleScale > after.downsampleScale);
        assertClose(before.reconstructedSourceSigma, boundary - epsilon, 3e-5);
        assertClose(exact.reconstructedSourceSigma, boundary, 3e-5);
        assertClose(after.reconstructedSourceSigma, boundary + epsilon, 3e-5);
        assert.ok(before.sourcePsfVariance < exact.sourcePsfVariance);
        assert.ok(exact.sourcePsfVariance < after.sourcePsfVariance);
        assertClose(
            before.downsampleSourceOffset,
            after.downsampleSourceOffset,
            2e-6
        );
        assert.equal(before.fetchCountPerOutputPixel, expectedFetchCounts[index]);
        assert.equal(after.fetchCountPerOutputPixel, expectedFetchCounts[index]);
        assert.ok(
            Math.abs(before.sourcePsfExcessKurtosis - after.sourcePsfExcessKurtosis) < 0.065,
            '중간 scale bucket은 PSF shape 변화도 기존 2x 절벽보다 작게 제한해야 합니다.'
        );
        assert.ok(
            after.normalizedFetchWork / before.normalizedFetchWork >= 0.4,
            '해상도 전환의 면적 가중 workload 하락은 기존 1/4 절벽보다 완만해야 합니다.'
        );
    }

    for (const formerBoundary of [4, 8]) {
        const before = prepare(formerBoundary - epsilon);
        const after = prepare(formerBoundary + epsilon);
        assert.equal(before.downsampleScale, after.downsampleScale);
        assert.equal(before.passes.length, after.passes.length);
        assert.equal(before.fetchCountPerOutputPixel, after.fetchCountPerOutputPixel);
    }

    const fullResolutionWorst = prepare(13 / 4);
    assert.equal(fullResolutionWorst.fetchCountPerOutputPixel, 22);
    assert.ok(fullResolutionWorst.fetchCountPerOutputPixel < 26);
    algorithm.destroy();
});

test('prepare는 rgba8unorm/bgra8unorm만 허용하고 source/output format을 fail-closed 검증한다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('format-validation');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 1
    });
    const frame = createContext(deviceHarness.device, 1, 1, 128, 64);

    for (const format of ['rgba8unorm', 'bgra8unorm']) {
        const source = createSourceTexture(`supported-${format}`, 128, 64, format);
        const prepared = algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 3),
            key: `supported:${format}`
        });
        assert.equal(prepared.format, format);
    }
    const validPipelineCount = deviceHarness.records.pipelines.length;

    for (const format of ['rgba8uint', 'rgba16float', 'depth24plus']) {
        const source = createSourceTexture(`unsupported-source-${format}`, 128, 64, format);
        assert.throws(
            () => algorithm.prepare({
                context: frame.context,
                request: createRequest(source.texture, 3, { format: 'rgba8unorm' }),
                key: `unsupported-source:${format}`
            }),
            new RegExp(`source texture format은 .*만 지원합니다: ${format}`)
        );
    }

    const validSource = createSourceTexture('valid-source', 128, 64, 'rgba8unorm');
    for (const format of ['rgba8uint', 'rgba16float', 'depth24plus']) {
        assert.throws(
            () => algorithm.prepare({
                context: frame.context,
                request: createRequest(validSource.texture, 3, { format }),
                key: `unsupported-output:${format}`
            }),
            new RegExp(`output format은 .*만 지원합니다: ${format}`)
        );
    }

    const unknownSource = createSourceTexture('unknown-source-format', 128, 64);
    delete unknownSource.texture.format;
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(unknownSource.texture, 3, { format: 'rgba8unorm' }),
            key: 'unknown-source-format'
        }),
        /source texture format이 필요합니다/
    );
    assert.equal(deviceHarness.records.pipelines.length, validPipelineCount);
    assert.equal(deviceHarness.records.textures.length, 0);
    algorithm.destroy();
});

test('sigma 10은 1 downsample + H/V, variance 보정/padded fetch kernel을 encode하고 warm 재사용한다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('encode');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 3
    });
    const source = createSourceTexture('encode-source', 800, 400);
    const request = createRequest(source.texture, 10);
    const frame = createContext(deviceHarness.device, 3, 41, 800, 400);
    const prepared = algorithm.prepare({ context: frame.context, request, key: 'sigma-10' });
    const output = algorithm.encode({
        context: frame.context,
        request,
        key: 'sigma-10-output',
        prepared
    });

    assert.equal(output.algorithmId, 'gaussian-quality');
    assert.equal(output.frameLifetime, 'until-frame-complete');
    assert.equal(output.passCount, 3);
    assert.equal(output.width, 200);
    assert.equal(output.height, 100);
    assert.equal(output.downsampleScale, 0.25);
    assert.equal(output.downsampleFactor, 4);
    assertClose(output.effectiveSigma, Math.sqrt(99) / 4, 2e-6);
    assertClose(output.residualSourceSigma, Math.sqrt(99), 1e-9);
    assertClose(output.reconstructedSourceSigma, 10, 3e-5);
    assert.equal(output.downsampleSourceOffset, 1);
    assert.equal(output.kernelRadius, 8);
    assert.equal(output.kernelDispatchRadius, 10);
    assert.equal(output.pairedTapCount, 5);
    assert.equal(output.samplesPerGaussianPass, 11);
    assert.equal(output.fetchCountPerOutputPixel, 26);
    assert.deepEqual(frame.records.passes.map((pass) => pass.pipeline.entryPoint), [
        'gaussian_downsample',
        'gaussian_directional',
        'gaussian_directional'
    ]);
    assert.equal(frame.records.passes.length, 3);
    for (const pass of frame.records.passes) {
        const attachment = pass.descriptor.colorAttachments[0];
        assert.deepEqual([attachment.view.width, attachment.view.height], [200, 100]);
        assert.equal(attachment.loadOp, 'clear');
        assert.equal(attachment.storeOp, 'store');
        assert.deepEqual(cloneRecord(attachment.clearValue), { r: 0, g: 0, b: 0, a: 0 });
        assert.deepEqual(pass.draws, [[3, 1, 0, 0]]);
        assert.equal(pass.endCount, 1);
    }

    assert.equal(deviceHarness.records.textures.length, 2, '두 ping-pong target만 필요합니다.');
    assert.strictEqual(output.texture, deviceHarness.records.textures[0].texture);
    assert.equal(deviceHarness.records.writeBuffers.length, 1);
    const downsampleUniform = readUniformSlot(deviceHarness.records.writeBuffers[0], 0);
    assertClose(downsampleUniform[0], 0.25 / 200);
    assertClose(downsampleUniform[1], 0.25 / 100);
    assert.equal(downsampleUniform[2], 0);
    assert.equal(downsampleUniform[3], 0);

    const horizontalUniform = readUniformSlot(deviceHarness.records.writeBuffers[0], 1);
    const verticalUniform = readUniformSlot(deviceHarness.records.writeBuffers[0], 2);
    assertClose(horizontalUniform[0], 1 / 200);
    assert.equal(horizontalUniform[1], 0);
    assert.equal(horizontalUniform[2], prepared.kernel.centerWeight);
    assert.equal(horizontalUniform[3], prepared.kernel.pairCount);
    assert.equal(verticalUniform[0], 0);
    assertClose(verticalUniform[1], 1 / 100);
    assert.equal(verticalUniform[2], prepared.kernel.centerWeight);
    assert.equal(verticalUniform[3], prepared.kernel.pairCount);
    for (let index = 0; index < prepared.kernel.pairCount; index++) {
        const uniformOffset = 4 + index * 4;
        assert.equal(horizontalUniform[uniformOffset], prepared.kernel.pairedTaps[index].offset);
        assert.equal(horizontalUniform[uniformOffset + 1], prepared.kernel.pairedTaps[index].weight);
        assert.equal(verticalUniform[uniformOffset], prepared.kernel.pairedTaps[index].offset);
        assert.equal(verticalUniform[uniformOffset + 1], prepared.kernel.pairedTaps[index].weight);
    }
    assert.equal(prepared.kernel.pairedTaps.at(-1).weight, 0, 'padding fetch는 PSF를 바꾸지 않습니다.');

    assert.deepEqual(deviceHarness.records.samplers[0].descriptor, {
        label: 'title-gaussian-linear-clamp-sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest'
    });
    assert.equal(deviceHarness.records.pipelines.length, 2);
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);
    assert.equal(composer.deferred.length, 1);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 1);

    composer.settle('committed', 41);
    assert.equal(algorithm.getDiagnostics().completedFrameCount, 1);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);

    const warmCounts = {
        samplers: deviceHarness.records.samplers.length,
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    };
    const warmFrame = createContext(deviceHarness.device, 3, 42, 800, 400);
    const changedPresentationRequest = createRequest(source.texture, 10, {
        sourceRevision: 999,
        checkpointId: 'different-depth'
    });
    algorithm.encode({
        context: warmFrame.context,
        request: changedPresentationRequest,
        key: 'different-output-key',
        prepared
    });
    assert.deepEqual({
        samplers: deviceHarness.records.samplers.length,
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    }, warmCounts, '동일 generation/high-water warm frame의 GPU resource 생성은 0이어야 합니다.');
    composer.settle('committed', 42);

    assert.equal(algorithm.destroy(), true);
    assert.equal(algorithm.destroy(), false);
    assert.equal(deviceHarness.records.buffers[0].destroyCount, 1);
    assert.equal(deviceHarness.records.textures.every((record) => record.destroyCount === 1), true);
});

test('sigma 1/8 이하는 무할당 identity이고 경계 바로 위는 기존 normalized H/V Gaussian이다', async () => {
    const {
        createWebGpuGaussianBlurAlgorithmFactory,
        WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_SIGMA_CUTOFF: cutoff
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('identity');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 1
    });
    const source = createSourceTexture('identity-source', 321, 181);
    const frame = createContext(deviceHarness.device, 1, 1, 321, 181);
    const identityCases = [0, 0.1, cutoff];
    let cutoffPrepared = null;

    for (const sigma of identityCases) {
        const request = createRequest(source.texture, sigma);
        const prepared = algorithm.prepare({
            context: frame.context,
            request,
            key: `identity:${sigma}`
        });
        const output = algorithm.encode({
            context: frame.context,
            request,
            key: `identity:${sigma}`,
            prepared
        });

        assert.equal(prepared.identity, true);
        assert.equal(prepared.subpixelIdentity, sigma > 0);
        assert.equal(prepared.sourceSigma, sigma);
        assert.equal(prepared.reconstructedSourceSigma, 0);
        assert.equal(prepared.passes.length, 0);
        assert.strictEqual(output.texture, source.texture);
        assert.equal(output.width, 321);
        assert.equal(output.height, 181);
        assert.equal(output.passCount, 0);
        assert.equal(output.identity, true);
        assert.equal(output.subpixelIdentity, sigma > 0);
        assert.equal(output.sourceSigma, sigma);
        assert.equal(output.reconstructedSourceSigma, 0);
        assert.equal(output.frameLifetime, 'source-owned');
        assert.equal(output.downsampleScale, 1);
        assert.equal(output.samplesPerGaussianPass, 0);
        if (sigma === cutoff) {
            cutoffPrepared = prepared;
        }
    }

    assert.equal(frame.records.passes.length, 0);
    assert.equal(deviceHarness.records.textures.length, 0);
    assert.equal(deviceHarness.records.buffers.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(source.record.viewCount, 1);
    assert.equal(composer.deferred.length, 0);
    assert.deepEqual({
        encodeCount: algorithm.getDiagnostics().encodeCount,
        identityEncodeCount: algorithm.getDiagnostics().identityEncodeCount,
        subpixelIdentityEncodeCount: algorithm.getDiagnostics().subpixelIdentityEncodeCount,
        passCount: algorithm.getDiagnostics().passCount,
        activeFrameId: algorithm.getDiagnostics().activeFrameId,
        frameActive: algorithm.getDiagnostics().pool.frameActive
    }, {
        encodeCount: 3,
        identityEncodeCount: 3,
        subpixelIdentityEncodeCount: 2,
        passCount: 0,
        activeFrameId: null,
        frameActive: false
    });
    assert.equal(algorithm.getDiagnostics().subpixelIdentitySigmaCutoff, cutoff);
    assert.equal(algorithm.getDiagnostics().subpixelIdentityMaxPsfVariance, 1 / 64);

    const aboveCutoff = cutoff + Number.EPSILON;
    assert.ok(aboveCutoff > cutoff);
    const blurRequest = createRequest(source.texture, aboveCutoff);
    assert.throws(
        () => algorithm.encode({
            context: frame.context,
            request: blurRequest,
            key: 'cutoff-prepared-reuse',
            prepared: cutoffPrepared
        }),
        /sigma가 prepare 이후 변경/
    );
    const blurPrepared = algorithm.prepare({
        context: frame.context,
        request: blurRequest,
        key: 'above-cutoff'
    });
    assert.equal(blurPrepared.identity, false);
    assert.equal(blurPrepared.subpixelIdentity, false);
    assert.deepEqual(Array.from(blurPrepared.passes, (pass) => pass.kind), [
        'horizontal',
        'vertical'
    ]);
    assert.ok(blurPrepared.kernel.normalizedWeightSum > 0.999999);
    assert.ok(blurPrepared.kernel.normalizedWeightSum < 1.000001);
    assert.throws(
        () => algorithm.encode({
            context: frame.context,
            request: blurRequest,
            key: 'forged-cutoff-topology',
            prepared: Object.freeze({
                ...blurPrepared,
                identity: true,
                subpixelIdentity: true,
                passes: Object.freeze([])
            })
        }),
        /identity cutoff prepared state가 일치하지 않습니다/
    );
    const blurOutput = algorithm.encode({
        context: frame.context,
        request: blurRequest,
        key: 'above-cutoff',
        prepared: blurPrepared
    });
    assert.equal(blurOutput.identity, false);
    assert.equal(blurOutput.sourceSigma, aboveCutoff);
    assert.equal(blurOutput.passCount, 2);
    assert.equal(frame.records.passes.length, 2);
    assert.equal(deviceHarness.records.textures.length, 2);
    assert.equal(deviceHarness.records.buffers.length, 1);
    assert.equal(deviceHarness.records.pipelines.length, 2);
    assert.equal(composer.deferred.length, 1);
    assert.equal(algorithm.getDiagnostics().encodeCount, 4);
    assert.equal(algorithm.getDiagnostics().identityEncodeCount, 3);
    assert.equal(algorithm.getDiagnostics().subpixelIdentityEncodeCount, 2);
    composer.settle('committed', 1);
    algorithm.destroy();
});

test('같은 frame의 여러 요청은 uniform/output lease를 분리하고 단일 abort callback으로 모두 정리한다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const deviceHarness = createDevice('multi');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 5
    });
    const source = createSourceTexture('multi-source', 640, 360);
    const firstRequest = createRequest(source.texture, 3, { checkpointId: 'base' });
    const secondRequest = createRequest(source.texture, 10, { checkpointId: 'floating' });
    const frame = createContext(deviceHarness.device, 5, 70, 640, 360);
    const firstPrepared = algorithm.prepare({
        context: frame.context,
        request: firstRequest,
        key: 'first-prepare'
    });
    const secondPrepared = algorithm.prepare({
        context: frame.context,
        request: secondRequest,
        key: 'second-prepare'
    });
    const firstOutput = algorithm.encode({
        context: frame.context,
        request: firstRequest,
        key: 'first-output',
        prepared: firstPrepared
    });
    const secondOutput = algorithm.encode({
        context: frame.context,
        request: secondRequest,
        key: 'second-output',
        prepared: secondPrepared
    });

    assert.equal(frame.records.passes.length, 5);
    assert.equal(deviceHarness.records.writeBuffers.length, 2);
    assert.notStrictEqual(
        deviceHarness.records.writeBuffers[0].buffer,
        deviceHarness.records.writeBuffers[1].buffer,
        '같은 command buffer의 uniform overwrite hazard를 피해야 합니다.'
    );
    assert.notStrictEqual(firstOutput.texture, secondOutput.texture);
    assert.equal(composer.deferred.length, 1);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 2);

    composer.settle('aborted', 70);
    assert.equal(algorithm.getDiagnostics().abortedFrameCount, 1);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);

    const nextFrame = createContext(deviceHarness.device, 5, 71, 640, 360);
    algorithm.encode({
        context: nextFrame.context,
        request: firstRequest,
        key: 'first-output-next',
        prepared: firstPrepared
    });
    assert.strictEqual(
        deviceHarness.records.writeBuffers[2].buffer,
        deviceHarness.records.writeBuffers[0].buffer,
        '다음 frame은 첫 uniform buffer를 재사용해야 합니다.'
    );
    composer.settle('committed', 71);
    algorithm.destroy();
});

test('render-pass 실패 abort 뒤 복구되고 generation drift와 destroy가 모든 generation resource를 정리한다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const firstDevice = createDevice('recovery-a');
    const composer = createComposerHarness();
    const factory = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port });
    const algorithm = factory({ device: firstDevice.device, deviceGeneration: 8 });
    const source = createSourceTexture('recovery-source', 320, 180);
    const request = createRequest(source.texture, 10);
    const failedFrame = createContext(firstDevice.device, 8, 90, 320, 180, {
        failAtPass: 1
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
            key: 'recovery-output',
            prepared
        }),
        /forced-render-pass-failure:1/
    );
    assert.equal(composer.deferred.length, 1);
    composer.settle('aborted', 90);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);

    const recoveredFrame = createContext(firstDevice.device, 8, 91, 320, 180);
    assert.equal(algorithm.encode({
        context: recoveredFrame.context,
        request,
        key: 'recovered-output',
        prepared
    }).passCount, 3);
    assert.equal(recoveredFrame.records.passes.length, 3);
    composer.settle('committed', 91);
    assert.equal(algorithm.getDiagnostics().completedFrameCount, 1);
    assert.equal(algorithm.getDiagnostics().abortedFrameCount, 1);

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
    assert.equal(firstDevice.records.buffers.every((record) => record.destroyCount === 1), true);
    assert.equal(firstDevice.records.textures.every((record) => record.destroyCount === 1), true);
    assert.equal(algorithm.destroy(), false);

    const replacement = factory({ device: secondDevice.device, deviceGeneration: 9 });
    const replacementSource = createSourceTexture('replacement-source', 320, 180);
    const replacementRequest = createRequest(replacementSource.texture, 10);
    const replacementPrepared = replacement.prepare({
        context: secondContext.context,
        request: replacementRequest,
        key: 'replacement'
    });
    assert.equal(replacement.encode({
        context: secondContext.context,
        request: replacementRequest,
        key: 'replacement-output',
        prepared: replacementPrepared
    }).passCount, 3);
    composer.settle('committed', 92);
    replacement.destroy();
});

test('callback 등록 실패, profile/range 오류, extent fallback은 fail-closed 계약을 지킨다', async () => {
    const { createWebGpuGaussianBlurAlgorithmFactory } = await loadAlgorithmModule();
    const rejectingDevice = createDevice('callback-reject');
    const rejectingComposer = createComposerHarness({ rejectCallbacks: true });
    const rejectingAlgorithm = createWebGpuGaussianBlurAlgorithmFactory({
        composerPort: rejectingComposer.port
    })({ device: rejectingDevice.device, deviceGeneration: 1 });
    const rejectingSource = createSourceTexture('callback-source', 64, 64);
    const rejectingRequest = createRequest(rejectingSource.texture, 3);
    const rejectingFrame = createContext(rejectingDevice.device, 1, 1, 64, 64);
    const rejectingPrepared = rejectingAlgorithm.prepare({
        context: rejectingFrame.context,
        request: rejectingRequest,
        key: 'reject'
    });
    assert.throws(
        () => rejectingAlgorithm.encode({
            context: rejectingFrame.context,
            request: rejectingRequest,
            key: 'reject-output',
            prepared: rejectingPrepared
        }),
        /callback 등록에 실패/
    );
    assert.equal(rejectingAlgorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(rejectingAlgorithm.getDiagnostics().pool.leasedTextureCount, 0);
    assert.equal(rejectingDevice.records.textures.length, 0);
    rejectingAlgorithm.destroy();

    const deviceHarness = createDevice('validation');
    const composer = createComposerHarness();
    const algorithm = createWebGpuGaussianBlurAlgorithmFactory({ composerPort: composer.port })({
        device: deviceHarness.device,
        deviceGeneration: 1
    });
    const source = createSourceTexture('validation-source', 100, 50);
    const frame = createContext(deviceHarness.device, 1, 1, 100, 50);
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 3, { edgeMode: 'mirror' }),
            key: 'mirror'
        }),
        /edgeMode=clamp/
    );
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: createRequest(source.texture, 3, { colorSpace: 'linear-srgb' }),
            key: 'linear'
        }),
        /colorSpace=srgb/
    );

    delete source.texture.width;
    delete source.texture.height;
    const fallbackRequest = createRequest(source.texture, 8, {
        bounds: { x: 10, y: 5, width: 80, height: 40 },
        halo: { left: 10, top: 5, right: 10, bottom: 5 }
    });
    const fallbackPrepared = algorithm.prepare({
        context: frame.context,
        request: fallbackRequest,
        key: 'extent-fallback'
    });
    assert.equal(fallbackPrepared.sourceWidth, 100);
    assert.equal(fallbackPrepared.sourceHeight, 50);
    assert.equal(fallbackPrepared.downsampleScale, 3 / 8);
    assert.equal(fallbackPrepared.finalWidth, 38);
    assert.equal(fallbackPrepared.finalHeight, 19);
    const fallbackOutput = algorithm.encode({
        context: frame.context,
        request: fallbackRequest,
        key: 'extent-fallback-output',
        prepared: fallbackPrepared
    });
    assert.equal(fallbackOutput.passCount, 3);
    composer.settle('committed', 1);
    algorithm.destroy();
});
