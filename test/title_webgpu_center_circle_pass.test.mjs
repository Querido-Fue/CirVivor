import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const PASS_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/webgpu/_title_webgpu_center_circle_pass.js',
    import.meta.url
));
const passSource = await readFile(PASS_PATH, 'utf8');
const namespace = await loadGameModule('scene/title/webgpu/_title_webgpu_center_circle_pass.js');

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function copyBytes(data) {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data.slice(0));
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
        );
    }
    return new Uint8Array(new Uint8Array(data).slice().buffer);
}

function createDevice(id) {
    const records = {
        shaderModules: [],
        samplers: [],
        pipelines: [],
        bindGroups: [],
        buffers: [],
        writes: [],
        forbiddenSubmitCount: 0,
        forbiddenTextureCreateCount: 0,
        forbiddenExternalCopyCount: 0
    };
    const device = {
        id,
        queue: {
            writeBuffer(buffer, offset, data) {
                records.writes.push({ buffer, offset, bytes: copyBytes(data) });
            },
            submit() {
                records.forbiddenSubmitCount += 1;
                throw new Error('center circle pass가 submit을 소유하면 안 됩니다.');
            },
            copyExternalImageToTexture() {
                records.forbiddenExternalCopyCount += 1;
                throw new Error('center circle pass가 external upload를 소유하면 안 됩니다.');
            }
        },
        createShaderModule(descriptor) {
            const shaderModule = Object.freeze({
                id: `${id}:shader:${records.shaderModules.length}`,
                descriptor
            });
            records.shaderModules.push(shaderModule);
            return shaderModule;
        },
        createSampler(descriptor) {
            const sampler = Object.freeze({
                id: `${id}:sampler:${records.samplers.length}`,
                descriptor: cloneRecord(descriptor)
            });
            records.samplers.push(sampler);
            return sampler;
        },
        createRenderPipeline(descriptor) {
            const pipelineRecord = {
                id: `${id}:pipeline:${records.pipelines.length}`,
                descriptor,
                layoutRequests: []
            };
            const pipeline = {
                id: pipelineRecord.id,
                getBindGroupLayout(index) {
                    pipelineRecord.layoutRequests.push(index);
                    return Object.freeze({ id: `${pipelineRecord.id}:layout:${index}` });
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
        createTexture() {
            records.forbiddenTextureCreateCount += 1;
            throw new Error('center circle pass가 texture를 만들면 안 됩니다.');
        }
    };
    return { device, records };
}

function createEncoder(id) {
    const records = {
        id,
        passes: [],
        operationOrder: [],
        forbiddenFinishCount: 0
    };
    const encoder = {
        id,
        beginRenderPass(descriptor) {
            const passRecord = {
                descriptor,
                pipeline: null,
                bindGroups: [],
                viewports: [],
                scissors: [],
                draws: [],
                endCount: 0
            };
            records.passes.push(passRecord);
            records.operationOrder.push('beginRenderPass');
            return {
                setPipeline(pipeline) {
                    passRecord.pipeline = pipeline;
                    records.operationOrder.push('setPipeline');
                },
                setBindGroup(index, bindGroup) {
                    passRecord.bindGroups.push({ index, bindGroup });
                    records.operationOrder.push(`setBindGroup:${index}`);
                },
                setViewport(...args) {
                    passRecord.viewports.push(args);
                    records.operationOrder.push('setViewport');
                },
                setScissorRect(...args) {
                    passRecord.scissors.push(args);
                    records.operationOrder.push('setScissorRect');
                },
                draw(...args) {
                    passRecord.draws.push(args);
                    records.operationOrder.push('draw');
                },
                end() {
                    passRecord.endCount += 1;
                    records.operationOrder.push('end');
                }
            };
        },
        finish() {
            records.forbiddenFinishCount += 1;
            throw new Error('center circle pass가 encoder를 finish하면 안 됩니다.');
        }
    };
    return { encoder, records };
}

function createContext(device, deviceGeneration, frameId, format = 'rgba8unorm') {
    const encoderHarness = createEncoder(`encoder:${frameId}`);
    return {
        context: Object.freeze({
            device,
            deviceGeneration,
            frameId,
            format,
            encoder: encoderHarness.encoder
        }),
        records: encoderHarness.records
    };
}

function createCommand(overrides = {}) {
    return {
        x: 500,
        y: 300,
        radius: 50,
        outlineWidth: 2,
        time: 1.25,
        alpha: 0.8,
        glowStrength: 0.12,
        glassStrength: 0.62,
        brightnessBoost: 0.08,
        bodyRadiusExpandOutlineRatio: 0.58,
        backdropBlurStrength: 0.36,
        backdropRefractionStrength: 5.2,
        scissorPaddingRatio: 0.86,
        scissorPaddingMin: 28,
        colors: {
            base: [0.1, 0.2, 0.3],
            deep: [0.2, 0.3, 0.4],
            rim: [0.3, 0.4, 0.5],
            highlight: [0.8, 0.9, 1]
        },
        ...overrides
    };
}

function createInput(command, backdropView, targetView, overrides = {}) {
    return {
        command,
        backdropView,
        backdropWidth: overrides.backdropWidth ?? 64,
        backdropHeight: overrides.backdropHeight ?? 32,
        targetView,
        targetWidth: overrides.targetWidth ?? 400,
        targetHeight: overrides.targetHeight ?? 300,
        originX: overrides.originX ?? 350,
        originY: overrides.originY ?? 150,
        ...(overrides.backdropLogicalWidth !== undefined
            ? { backdropLogicalWidth: overrides.backdropLogicalWidth }
            : {}),
        ...(overrides.backdropLogicalHeight !== undefined
            ? { backdropLogicalHeight: overrides.backdropLogicalHeight }
            : {}),
        ...(overrides.backdropOriginX !== undefined
            ? { backdropOriginX: overrides.backdropOriginX }
            : {}),
        ...(overrides.backdropOriginY !== undefined
            ? { backdropOriginY: overrides.backdropOriginY }
            : {}),
        ...(overrides.loadOp ? { loadOp: overrides.loadOp } : {}),
        ...(overrides.format ? { format: overrides.format } : {})
    };
}

function getWrittenFloats(write) {
    return new Float32Array(write.bytes.buffer);
}

function assertClose(actual, expected, epsilon = 1e-6) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

test('WGSL은 legacy glass/glow 상수와 screen-to-ROI backdrop sample transform을 보존한다', () => {
    const shader = namespace.TITLE_WEBGPU_CENTER_CIRCLE_SHADER;
    assert.equal(namespace.TITLE_WEBGPU_CENTER_CIRCLE_PASS_CONSTANTS.UNIFORM_BYTE_SIZE, 144);
    assert.match(shader, /let local = fragCoord - parameters\.center/);
    assert.match(shader, /let edgeSoftness = 1\.35/);
    assert.match(shader, /vec3<f32>\(-0\.45, -0\.68, 0\.58\)/);
    assert.match(shader, /vec2<f32>\(-0\.25, -0\.56\)/);
    assert.match(shader, /vec2<f32>\(0\.42, 0\.095\)/);
    assert.match(shader, /let backdropLocal = fragCoord \+ parameters\.targetToBackdropOffset/);
    assert.match(shader, /parameters\.backdropLogicalSize/);
    assert.match(shader, /let halfBackdropTexel = vec2<f32>\(0\.5\)[\s\S]*parameters\.backdropResolution/);
    assert.match(shader, /backdropLocal \+ refractionOffset/);
    assert.match(shader, /textureSample\([\s\S]*backdropUv/);
    assert.match(shader, /let outlineAlpha = outlineCore \* 0\.36/);
    assert.match(shader, /let glowPulse = 0\.94 \+ \(sin\(parameters\.time\) \* 0\.06\)/);
    assert.match(shader, /premultipliedColor = min\(premultipliedColor, vec3<f32>\(alpha\)\)/);
    assert.doesNotMatch(shader, /targetResolution\.y - input\.position\.y/);
});

test('screen-space center를 target local로 바꾸고 legacy scissor bounds 안에서 backdrop과 합성한다', () => {
    const { TitleWebGpuCenterCirclePass } = namespace;
    const deviceHarness = createDevice('encode');
    const frame = createContext(deviceHarness.device, 3, 41);
    const backdropView = Object.freeze({ id: 'blurred-roi' });
    const targetView = Object.freeze({ id: 'transparent-effect-roi' });
    const centerPass = new TitleWebGpuCenterCirclePass();

    assert.equal(centerPass.encode(
        frame.context,
        createInput(createCommand(), backdropView, targetView)
    ), true);

    assert.deepEqual(frame.records.operationOrder, [
        'beginRenderPass',
        'setPipeline',
        'setBindGroup:0',
        'setViewport',
        'setScissorRect',
        'draw',
        'end'
    ]);
    assert.equal(frame.records.passes.length, 1);
    const passRecord = frame.records.passes[0];
    const attachment = passRecord.descriptor.colorAttachments[0];
    assert.strictEqual(attachment.view, targetView);
    assert.deepEqual(cloneRecord(attachment.clearValue), { r: 0, g: 0, b: 0, a: 0 });
    assert.equal(attachment.loadOp, 'load');
    assert.equal(attachment.storeOp, 'store');
    assert.deepEqual(passRecord.viewports, [[49, 49, 202, 202, 0, 1]]);
    assert.deepEqual(passRecord.scissors, [[49, 49, 202, 202]]);
    assert.deepEqual(passRecord.draws, [[3, 1, 0, 0]]);
    assert.equal(passRecord.endCount, 1);

    const pipelineTarget = deviceHarness.records.pipelines[0].descriptor.fragment.targets[0];
    assert.equal(pipelineTarget.format, 'rgba8unorm');
    assert.deepEqual(cloneRecord(pipelineTarget.blend), {
        color: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add'
        },
        alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add'
        }
    });
    assert.deepEqual(deviceHarness.records.samplers[0].descriptor, {
        label: 'title-center-circle-backdrop-sampler',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear'
    });
    const entries = deviceHarness.records.bindGroups[0].descriptor.entries;
    assert.deepEqual(Array.from(entries, (entry) => entry.binding), [0, 1, 2]);
    assert.strictEqual(entries[1].resource, deviceHarness.records.samplers[0]);
    assert.strictEqual(entries[2].resource, backdropView);

    const floats = getWrittenFloats(deviceHarness.records.writes[0]);
    assert.deepEqual(Array.from(floats.slice(0, 13)), [
        400, 300, 150, 150, 64, 32, 400, 300, 0, 0, 50, 2, 1.25
    ]);
    assertClose(floats[13], 0.8);
    assertClose(floats[14], 0.12);
    assertClose(floats[15], 0.62);
    assertClose(floats[16], 0.08);
    assertClose(floats[17], 0.58);
    assertClose(floats[18], 0.36);
    assertClose(floats[19], 5.2);
    for (const [offset, expected] of [
        [20, [0.1, 0.2, 0.3, 0]],
        [24, [0.2, 0.3, 0.4, 0]],
        [28, [0.3, 0.4, 0.5, 0]],
        [32, [0.8, 0.9, 1, 0]]
    ]) {
        expected.forEach((value, index) => assertClose(floats[offset + index], value));
    }
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);
    assert.equal(deviceHarness.records.forbiddenTextureCreateCount, 0);
    assert.equal(deviceHarness.records.forbiddenExternalCopyCount, 0);
    assert.equal(frame.records.forbiddenFinishCount, 0);
});

test('full-scene target은 저해상도 backdrop의 screen-space 논리 ROI를 독립 매핑한다', () => {
    const { TitleWebGpuCenterCirclePass } = namespace;
    const deviceHarness = createDevice('direct-scene');
    const frame = createContext(deviceHarness.device, 1, 1);
    const centerPass = new TitleWebGpuCenterCirclePass();

    assert.equal(centerPass.encode(frame.context, createInput(
        createCommand(),
        { id: 'downsampled-backdrop' },
        { id: 'full-scene' },
        {
            targetWidth: 1280,
            targetHeight: 720,
            originX: 0,
            originY: 0,
            backdropWidth: 64,
            backdropHeight: 64,
            backdropLogicalWidth: 400,
            backdropLogicalHeight: 400,
            backdropOriginX: 300,
            backdropOriginY: 100
        }
    )), true);

    const floats = getWrittenFloats(deviceHarness.records.writes[0]);
    assert.deepEqual(Array.from(floats.slice(0, 12)), [
        1280, 720,
        500, 300,
        64, 64,
        400, 400,
        -300, -100,
        50, 2
    ]);
});

test('같은 generation/format/frame high-water를 재사용하고 format·generation 변경을 격리한다', () => {
    const { TitleWebGpuCenterCirclePass } = namespace;
    const firstDevice = createDevice('generation-a');
    const centerPass = new TitleWebGpuCenterCirclePass();
    const backdropView = Object.freeze({ id: 'stable-backdrop' });
    const targetView = Object.freeze({ id: 'effect-target' });
    const command = createCommand();

    centerPass.encode(
        createContext(firstDevice.device, 7, 1).context,
        createInput(command, backdropView, targetView)
    );
    const warmCounts = {
        shaderModules: firstDevice.records.shaderModules.length,
        samplers: firstDevice.records.samplers.length,
        pipelines: firstDevice.records.pipelines.length,
        bindGroups: firstDevice.records.bindGroups.length,
        buffers: firstDevice.records.buffers.length
    };

    centerPass.encode(
        createContext(firstDevice.device, 7, 2).context,
        createInput(command, backdropView, targetView, {
            targetWidth: 500,
            targetHeight: 400
        })
    );
    assert.deepEqual({
        shaderModules: firstDevice.records.shaderModules.length,
        samplers: firstDevice.records.samplers.length,
        pipelines: firstDevice.records.pipelines.length,
        bindGroups: firstDevice.records.bindGroups.length,
        buffers: firstDevice.records.buffers.length
    }, warmCounts);
    assert.strictEqual(
        firstDevice.records.writes[0].buffer,
        firstDevice.records.writes[1].buffer
    );

    centerPass.encode(
        createContext(firstDevice.device, 7, 2).context,
        createInput(command, backdropView, targetView)
    );
    assert.equal(firstDevice.records.buffers.length, 2);
    assert.equal(firstDevice.records.bindGroups.length, 2);
    assert.notStrictEqual(
        firstDevice.records.writes[1].buffer,
        firstDevice.records.writes[2].buffer
    );

    centerPass.encode(
        createContext(firstDevice.device, 7, 3, 'bgra8unorm').context,
        createInput(command, backdropView, targetView)
    );
    assert.equal(firstDevice.records.shaderModules.length, 1);
    assert.equal(firstDevice.records.samplers.length, 1);
    assert.equal(firstDevice.records.pipelines.length, 2);
    assert.equal(firstDevice.records.buffers.length, 2);
    assert.equal(firstDevice.records.bindGroups.length, 3);

    const secondDevice = createDevice('generation-b');
    centerPass.encode(
        createContext(secondDevice.device, 8, 4).context,
        createInput(command, backdropView, targetView)
    );
    assert.deepEqual(firstDevice.records.buffers.map((record) => record.destroyCount), [1, 1]);
    assert.equal(secondDevice.records.shaderModules.length, 1);
    assert.equal(secondDevice.records.samplers.length, 1);
    assert.equal(secondDevice.records.pipelines.length, 1);
    assert.equal(secondDevice.records.buffers.length, 1);
    assert.equal(centerPass.getDiagnostics().generationChangeCount, 1);

    assert.throws(() => centerPass.encode(
        createContext(firstDevice.device, 7, 5).context,
        createInput(command, backdropView, targetView)
    ), /stale/);
    assert.equal(secondDevice.records.buffers[0].destroyCount, 0);

    const invalidIdentityDevice = createDevice('generation-invalid-identity');
    assert.throws(() => centerPass.encode(
        createContext(invalidIdentityDevice.device, 8, 6).context,
        createInput(command, backdropView, targetView)
    ), /identity.*generation 변경 없이/);
    assert.equal(secondDevice.records.buffers[0].destroyCount, 1);

    centerPass.encode(
        createContext(invalidIdentityDevice.device, 8, 7).context,
        createInput(command, backdropView, targetView)
    );
    assert.equal(centerPass.destroy(), true);
    assert.equal(centerPass.destroy(), false);
    assert.equal(invalidIdentityDevice.records.buffers[0].destroyCount, 1);
    assert.throws(() => centerPass.encode({}, {}), /destroy된/);
});

test('무효·화면 밖 명령은 resource 생성 전에 skip하고 target/backdrop alias는 거부한다', () => {
    const { TitleWebGpuCenterCirclePass } = namespace;
    const deviceHarness = createDevice('validation');
    const centerPass = new TitleWebGpuCenterCirclePass();
    const frame = createContext(deviceHarness.device, 1, 1);
    const backdropView = Object.freeze({ id: 'backdrop' });
    const targetView = Object.freeze({ id: 'target' });

    assert.equal(centerPass.encode(frame.context, { command: createCommand({ radius: 0 }) }), false);
    assert.equal(centerPass.encode(frame.context, { command: createCommand({ alpha: 0 }) }), false);
    assert.equal(centerPass.encode(
        frame.context,
        createInput(createCommand({ x: -1000, y: -1000 }), backdropView, targetView)
    ), false);
    assert.throws(() => centerPass.encode(
        frame.context,
        createInput(createCommand(), targetView, targetView)
    ), /분리/);
    assert.equal(deviceHarness.records.shaderModules.length, 0);
    assert.equal(deviceHarness.records.samplers.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(deviceHarness.records.bindGroups.length, 0);
    assert.equal(deviceHarness.records.buffers.length, 0);
    assert.equal(deviceHarness.records.writes.length, 0);
    assert.equal(frame.records.passes.length, 0);
});

test('pass source에는 presentation ownership·자체 blur·canvas upload API가 없다', () => {
    for (const forbiddenCall of [
        'acquireFrameTarget(',
        'getCurrentTexture(',
        '.submit(',
        '.finish(',
        'markCanvasDrawn(',
        'markCanvasCleared(',
        'createTexture(',
        'copyExternalImageToTexture(',
        'texImage2D(',
        'drawImage(',
        'putImageData('
    ]) {
        assert.equal(passSource.includes(forbiddenCall), false, `${forbiddenCall} 호출 금지`);
    }
    assert.doesNotMatch(passSource, /KAWASE|GAUSSIAN|blur_algorithm/i);
});
