import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ALGORITHM_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgpu/webgpu_kawase_blur_algorithm.js',
    import.meta.url
));
const POOL_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgpu/webgpu_transient_texture_pool.js',
    import.meta.url
));
const CONSTANTS_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgl/_webgl_constants.js',
    import.meta.url
));

const [algorithmSource, poolSource, constantsSource] = await Promise.all([
    readFile(ALGORITHM_PATH, 'utf8'),
    readFile(POOL_PATH, 'utf8'),
    readFile(CONSTANTS_PATH, 'utf8')
]);

async function loadAlgorithmModule() {
    const context = vm.createContext({ console });
    const poolModule = new vm.SourceTextModule(poolSource, {
        context,
        identifier: POOL_PATH
    });
    const constantsModule = new vm.SourceTextModule(constantsSource, {
        context,
        identifier: CONSTANTS_PATH
    });
    const algorithmModule = new vm.SourceTextModule(algorithmSource, {
        context,
        identifier: ALGORITHM_PATH
    });
    await algorithmModule.link(async (specifier) => {
        if (specifier === './webgpu_transient_texture_pool.js') {
            return poolModule;
        }
        if (specifier === '../webgl/_webgl_constants.js') {
            return constantsModule;
        }
        throw new Error(`예상하지 못한 Kawase algorithm import입니다: ${specifier}`);
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
    const records = {
        id,
        passes: []
    };
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
        algorithmId: 'kawase-compatibility',
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

function assertClose(actual, expected, epsilon = 1e-7) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

function readUniformSlot(writeRecord, slotIndex) {
    const offset = slotIndex * (256 / Float32Array.BYTES_PER_ELEMENT);
    return writeRecord.data.slice(offset, offset + 4);
}

test('compatibility ID/kernel/topology가 legacy authority와 일치하고 presentation 소유 API를 호출하지 않는다', async () => {
    const namespace = await loadAlgorithmModule();
    assert.equal(namespace.WEBGPU_KAWASE_BLUR_ALGORITHM_ID, 'kawase-compatibility');
    assert.equal(namespace.WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.DOWN_PASS_COUNT, 4);
    assert.equal(namespace.WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.UP_PASS_COUNT, 3);
    assert.equal(namespace.WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.PASS_COUNT, 7);
    assert.equal(namespace.WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.MIN_SIZE, 8);
    assert.equal(
        (namespace.WEBGPU_KAWASE_COMPATIBILITY_SHADER.match(/\* 0\.1875;/g) || []).length,
        4
    );
    assert.equal(
        (namespace.WEBGPU_KAWASE_COMPATIBILITY_SHADER.match(/\* 0\.15;/g) || []).length,
        4
    );
    assert.match(namespace.WEBGPU_KAWASE_COMPATIBILITY_SHADER, /\* 0\.25;/);
    assert.match(namespace.WEBGPU_KAWASE_COMPATIBILITY_SHADER, /\* 0\.4;/);

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

test('1920x1080 legacy 4-down/3-up 순서, offset, 최종 1/8 크기와 clear/store pass를 정확히 encode한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('topology');
    const composer = createComposerHarness();
    const factory = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    });
    const algorithm = factory({
        device: deviceHarness.device,
        deviceGeneration: 3
    });
    const source = createSourceTexture('source-1080p', 1920, 1080);
    const request = createRequest(source.texture, 16);
    const frame = createContext(deviceHarness.device, 3, 41, 1920, 1080);

    const prepared = algorithm.prepare({ context: frame.context, request, key: 'topology' });
    assert.equal(deviceHarness.records.textures.length, 0, 'prepare에서 transient lease 금지');
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);

    const output = algorithm.encode({
        context: frame.context,
        request,
        key: 'topology',
        prepared
    });
    assert.equal(Object.isFrozen(output), true);
    assert.equal(output.frameLifetime, 'until-frame-complete');
    assert.equal(output.passCount, 7);
    assert.equal(output.width, 240);
    assert.equal(output.height, 135);
    assert.equal(output.blurScale, 2);
    assert.equal(frame.records.passes.length, 7);

    const expectedTargets = [
        [960, 540],
        [480, 270],
        [240, 135],
        [120, 67],
        [960, 540],
        [480, 270],
        [240, 135]
    ];
    const expectedEntryPoints = [
        'kawase_down',
        'kawase_down',
        'kawase_down',
        'kawase_down',
        'kawase_up',
        'kawase_up',
        'kawase_up'
    ];
    for (let index = 0; index < frame.records.passes.length; index++) {
        const pass = frame.records.passes[index];
        const attachment = pass.descriptor.colorAttachments[0];
        assert.deepEqual(
            [attachment.view.width, attachment.view.height],
            expectedTargets[index]
        );
        assert.equal(attachment.loadOp, 'clear');
        assert.equal(attachment.storeOp, 'store');
        assert.deepEqual(cloneRecord(attachment.clearValue), { r: 0, g: 0, b: 0, a: 0 });
        assert.equal(pass.pipeline.entryPoint, expectedEntryPoints[index]);
        assert.deepEqual(pass.draws, [[3, 1, 0, 0]]);
        assert.equal(pass.endCount, 1);
    }

    assert.equal(deviceHarness.records.textures.length, 4, '중간 target은 encode 순서로 alias 재사용');
    assert.strictEqual(output.texture, deviceHarness.records.textures[2].texture);
    assert.equal(deviceHarness.records.writeBuffers.length, 1);
    const expectedSources = [
        [1920, 1080],
        [960, 540],
        [480, 270],
        [240, 135],
        [120, 67],
        [960, 540],
        [480, 270]
    ];
    const expectedOffsets = [2, 4, 6, 8, 6, 4, 2];
    for (let index = 0; index < 7; index++) {
        const uniform = readUniformSlot(deviceHarness.records.writeBuffers[0], index);
        assertClose(uniform[0], 1 / expectedSources[index][0]);
        assertClose(uniform[1], 1 / expectedSources[index][1]);
        assertClose(uniform[2], expectedOffsets[index]);
        assert.equal(uniform[3], 0);
    }

    assert.deepEqual(deviceHarness.records.samplers[0].descriptor, {
        label: 'title-kawase-linear-clamp-sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        addressModeW: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'nearest'
    });
    assert.equal(deviceHarness.records.pipelines.length, 2);
    for (const pipeline of deviceHarness.records.pipelines) {
        const target = pipeline.descriptor.fragment.targets[0];
        assert.equal(target.format, 'rgba8unorm');
        assert.equal(target.blend, undefined);
    }
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);
    assert.equal(composer.deferred.length, 1);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 1);

    composer.settle('committed', 41);
    const committed = algorithm.getDiagnostics();
    assert.equal(committed.activeFrameId, null);
    assert.equal(committed.completedFrameCount, 1);
    assert.equal(committed.pool.frameActive, false);
    assert.equal(committed.pool.leasedTextureCount, 0);
    assert.equal(committed.pool.forcedReleaseCount, 0);

    const warmCounts = {
        samplers: deviceHarness.records.samplers.length,
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    };
    const warmFrame = createContext(deviceHarness.device, 3, 42, 1920, 1080);
    algorithm.encode({
        context: warmFrame.context,
        request,
        key: 'topology',
        prepared
    });
    assert.equal(warmFrame.records.passes.length, 7);
    assert.deepEqual({
        samplers: deviceHarness.records.samplers.length,
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length,
        textures: deviceHarness.records.textures.length,
        sourceViews: source.record.viewCount
    }, warmCounts, '동일 high-water warm frame의 GPU resource 생성은 0이어야 함');
    composer.settle('committed', 42);
    assert.equal(algorithm.destroy(), true);
    assert.equal(algorithm.destroy(), false);
    assert.equal(deviceHarness.records.buffers[0].destroyCount, 1);
    assert.equal(deviceHarness.records.textures.every((record) => record.destroyCount === 1), true);
});

test('각 축 floor/min-8과 blurScale 하한을 보존하며 sigma 0은 source를 그대로 반환한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('minimum');
    const composer = createComposerHarness();
    const algorithm = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('tiny-source', 9, 7);
    const request = createRequest(source.texture, 0.1);
    const frame = createContext(deviceHarness.device, 1, 1, 9, 7);
    const prepared = algorithm.prepare({ context: frame.context, request, key: 'tiny' });
    const output = algorithm.encode({ context: frame.context, request, key: 'tiny', prepared });

    assert.equal(prepared.blurScale, 0.5);
    assert.equal(output.width, 8);
    assert.equal(output.height, 8);
    assert.deepEqual(
        frame.records.passes.map((pass) => [
            pass.descriptor.colorAttachments[0].view.width,
            pass.descriptor.colorAttachments[0].view.height
        ]),
        Array.from({ length: 7 }, () => [8, 8])
    );
    const expectedOffsets = [0.5, 1, 1.5, 2, 1.5, 1, 0.5];
    for (let index = 0; index < expectedOffsets.length; index++) {
        assertClose(
            readUniformSlot(deviceHarness.records.writeBuffers[0], index)[2],
            expectedOffsets[index]
        );
    }
    composer.settle('committed', 1);

    const zeroRequest = createRequest(source.texture, 0, { sourceRevision: 2 });
    const zeroFrame = createContext(deviceHarness.device, 1, 2, 9, 7);
    const zeroPrepared = algorithm.prepare({
        context: zeroFrame.context,
        request: zeroRequest,
        key: 'zero'
    });
    const zeroOutput = algorithm.encode({
        context: zeroFrame.context,
        request: zeroRequest,
        key: 'zero',
        prepared: zeroPrepared
    });
    assert.strictEqual(zeroOutput.texture, source.texture);
    assert.equal(zeroOutput.width, 9);
    assert.equal(zeroOutput.height, 7);
    assert.equal(zeroOutput.passCount, 0);
    assert.equal(zeroOutput.frameLifetime, 'source-owned');
    assert.equal(zeroFrame.records.passes.length, 0);
    assert.equal(composer.deferred.length, 0);
    assert.equal(source.record.viewCount, 1, 'source view는 generation에서 재사용');
    algorithm.destroy();
});

test('같은 frame의 여러 key는 서로 다른 uniform buffer와 최종 lease를 사용하고 callback 하나로 정리한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('multi-request');
    const composer = createComposerHarness();
    const algorithm = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 5 });
    const source = createSourceTexture('shared-source', 640, 360);
    const firstRequest = createRequest(source.texture, 4, { checkpointId: 'base' });
    const secondRequest = createRequest(source.texture, 24, { checkpointId: 'floating' });
    const frame = createContext(deviceHarness.device, 5, 70, 640, 360);
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

    assert.equal(frame.records.passes.length, 14);
    assert.equal(deviceHarness.records.writeBuffers.length, 2);
    assert.notStrictEqual(
        deviceHarness.records.writeBuffers[0].buffer,
        deviceHarness.records.writeBuffers[1].buffer,
        '동일 command buffer에서 uniform overwrite hazard 금지'
    );
    assertClose(readUniformSlot(deviceHarness.records.writeBuffers[0], 0)[2], 0.5);
    assertClose(readUniformSlot(deviceHarness.records.writeBuffers[1], 0)[2], 3);
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
        key: 'first',
        prepared: firstPrepared
    });
    assert.strictEqual(
        deviceHarness.records.writeBuffers[2].buffer,
        deviceHarness.records.writeBuffers[0].buffer,
        '다음 submit 순서에서는 첫 uniform slot을 재사용'
    );
    composer.settle('committed', 71);
    algorithm.destroy();
});

test('중간 render-pass 실패의 abort cleanup 뒤 다음 frame이 복구되고 generation drift는 resource를 폐기한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const firstDevice = createDevice('recovery-a');
    const composer = createComposerHarness();
    const factory = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    });
    const algorithm = factory({ device: firstDevice.device, deviceGeneration: 8 });
    const source = createSourceTexture('recovery-source', 320, 180);
    const request = createRequest(source.texture, 8);
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
    assert.equal(composer.deferred.length, 1);
    composer.settle('aborted', 90);
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);

    const recoveredFrame = createContext(firstDevice.device, 8, 91, 320, 180);
    const recoveredOutput = algorithm.encode({
        context: recoveredFrame.context,
        request,
        key: 'recovery',
        prepared
    });
    assert.equal(recoveredOutput.passCount, 7);
    assert.equal(recoveredFrame.records.passes.length, 7);
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
    const secondSource = createSourceTexture('replacement-source', 320, 180);
    const secondRequest = createRequest(secondSource.texture, 8);
    const secondPrepared = replacement.prepare({
        context: secondContext.context,
        request: secondRequest,
        key: 'replacement'
    });
    assert.equal(replacement.encode({
        context: secondContext.context,
        request: secondRequest,
        key: 'replacement',
        prepared: secondPrepared
    }).passCount, 7);
    composer.settle('committed', 92);
    replacement.destroy();
});

test('cleanup callback 등록 거부는 열린 pool과 lease를 남기지 않는다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('callback-reject');
    const composer = createComposerHarness({ rejectCallbacks: true });
    const algorithm = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('callback-source', 64, 64);
    const request = createRequest(source.texture, 4);
    const frame = createContext(deviceHarness.device, 1, 1, 64, 64);
    const prepared = algorithm.prepare({ context: frame.context, request, key: 'reject' });

    assert.throws(
        () => algorithm.encode({ context: frame.context, request, key: 'reject', prepared }),
        /callback 등록에 실패/
    );
    assert.equal(algorithm.getDiagnostics().pool.frameActive, false);
    assert.equal(algorithm.getDiagnostics().pool.leasedTextureCount, 0);
    assert.equal(deviceHarness.records.textures.length, 0);
    algorithm.destroy();
});

test('compatibility profile은 실제 sampler/encoded-space 의미와 같은 clamp+sRGB만 허용한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('profile-validation');
    const composer = createComposerHarness();
    const algorithm = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('profile-source', 128, 72);
    const frame = createContext(deviceHarness.device, 1, 1, 128, 72);

    const mirrorRequest = createRequest(source.texture, 4, { edgeMode: 'mirror' });
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: mirrorRequest,
            key: 'mirror'
        }),
        /edgeMode=clamp/
    );
    const linearRequest = createRequest(source.texture, 4, { colorSpace: 'linear' });
    assert.throws(
        () => algorithm.prepare({
            context: frame.context,
            request: linearRequest,
            key: 'linear'
        }),
        /colorSpace=srgb/
    );
    assert.equal(deviceHarness.records.samplers.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(deviceHarness.records.textures.length, 0);
    algorithm.destroy();
});

test('GPUTexture extent 속성이 없는 mock/adapter는 prepare와 encode 모두 bounds+halo fallback을 사용한다', async () => {
    const {
        createWebGpuKawaseBlurAlgorithmFactory
    } = await loadAlgorithmModule();
    const deviceHarness = createDevice('extent-fallback');
    const composer = createComposerHarness();
    const algorithm = createWebGpuKawaseBlurAlgorithmFactory({
        composerPort: composer.port
    })({ device: deviceHarness.device, deviceGeneration: 1 });
    const source = createSourceTexture('extent-fallback-source', 100, 50);
    delete source.texture.width;
    delete source.texture.height;
    const request = createRequest(source.texture, 4, {
        bounds: { x: 10, y: 5, width: 80, height: 40 },
        halo: { left: 10, top: 5, right: 10, bottom: 5 }
    });
    const frame = createContext(deviceHarness.device, 1, 1, 100, 50);
    const prepared = algorithm.prepare({
        context: frame.context,
        request,
        key: 'extent-fallback'
    });
    const output = algorithm.encode({
        context: frame.context,
        request,
        key: 'extent-fallback',
        prepared
    });

    assert.equal(prepared.sourceWidth, 100);
    assert.equal(prepared.sourceHeight, 50);
    assert.equal(output.width, 12);
    assert.equal(output.height, 8);
    assert.equal(frame.records.passes.length, 7);
    composer.settle('committed', 1);
    algorithm.destroy();
});
