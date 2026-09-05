import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const PASS_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/webgpu/_title_webgpu_gradient_pass.js',
    import.meta.url
));
const LEGACY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/scene/title/_title_gradient_background.js',
    import.meta.url
));

const [passSource, legacySource] = await Promise.all([
    readFile(PASS_PATH, 'utf8'),
    readFile(LEGACY_PATH, 'utf8')
]);

async function loadPassModule() {
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(passSource, {
        context,
        identifier: PASS_PATH
    });
    await module.link(() => {
        throw new Error('title WebGPU gradient pass는 외부 module을 import하지 않아야 합니다.');
    });
    await module.evaluate();
    return module.namespace;
}

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function createDevice(id) {
    const records = {
        id,
        shaderModules: [],
        pipelines: [],
        bindGroups: [],
        buffers: [],
        writeBuffers: [],
        forbiddenSubmitCount: 0,
        forbiddenTextureCreateCount: 0
    };
    const device = {
        id,
        queue: {
            writeBuffer(buffer, offset, data) {
                records.writeBuffers.push({
                    buffer,
                    offset,
                    data: Array.from(data)
                });
            },
            submit() {
                records.forbiddenSubmitCount += 1;
                throw new Error('gradient pass가 직접 submit하면 안 됩니다.');
            }
        },
        createShaderModule(descriptor) {
            const shaderModule = Object.freeze({
                id: `${id}:shader:${records.shaderModules.length}`,
                descriptor: cloneRecord(descriptor)
            });
            records.shaderModules.push(shaderModule);
            return shaderModule;
        },
        createRenderPipeline(descriptor) {
            const pipelineRecord = {
                id: `${id}:pipeline:${records.pipelines.length}`,
                descriptor: cloneRecord(descriptor),
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
            throw new Error('gradient pass가 caller-owned target 대신 texture를 만들면 안 됩니다.');
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
            throw new Error('gradient pass가 encoder를 finish하면 안 됩니다.');
        }
    };
    return { encoder, records };
}

function createFrame(device, deviceGeneration, frameId, format = 'rgba8unorm') {
    const encoderHarness = createEncoder(`encoder:${frameId}`);
    return {
        context: Object.freeze({
            frameId,
            device,
            deviceGeneration,
            encoder: encoderHarness.encoder,
            target: Object.freeze({ id: `composer-target:${frameId}` }),
            format,
            width: 1920,
            height: 1080
        }),
        records: encoderHarness.records
    };
}

const PALETTE = Object.freeze([
    Object.freeze([0.10, 0.20, 0.30]),
    Object.freeze([0.25, 0.35, 0.45]),
    Object.freeze([0.40, 0.50, 0.60]),
    Object.freeze([0.55, 0.65, 0.75]),
    Object.freeze([0.70, 0.80, 0.90])
]);

function assertClose(actual, expected, epsilon = 1e-7) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

test('WGSL은 legacy t=0 oracle과 fullscreen weighted gradient 계약을 보존한다', async () => {
    const namespace = await loadPassModule();
    const shader = namespace.TITLE_WEBGPU_GRADIENT_SHADER;

    assert.match(shader, /const COLOR_COUNT: u32 = 5u/);
    assert.match(shader, /@vertex\s+fn title_gradient_vertex/);
    assert.match(shader, /@fragment\s+fn title_gradient_fragment/);
    assert.match(shader, /let positions = array<vec2<f32>, 3>/);
    assert.match(shader, /0\.08 \+ \(distanceSquared \* \(5\.4 \+ \(f32\(index\) \* 0\.65\)\)\)/);
    assert.match(shader, /pow\(color, vec3<f32>\(2\.2\)\)/);
    assert.match(shader, /pow\(color, vec3<f32>\(1\.0 \/ 2\.2\)\)/);
    assert.match(shader, /52\.9829189/);
    assert.match(shader, /0\.06711056, 0\.00583715/);
    assert.match(shader, /0\.6 \/ 255\.0/);
    assert.match(shader, /vec4<f32>\(clamp\(color[\s\S]*, 1\.0\)/);
    assert.match(shader, /if \(time == 0\.0\)[\s\S]*return vec2<f32>\(0\.0\)/);
    assert.match(shader, /@location\(1\) @interpolate\(flat\) point0/);
    assert.match(shader, /@location\(6\) @interpolate\(flat\) modulation/);
    assert.match(shader, /@location\(11\) @interpolate\(flat\) linearColor4/);
    assert.match(shader, /parameters\.resolution\.y - input\.position\.y/);
    const fragmentBody = shader.slice(shader.indexOf('fn title_gradient_fragment'));
    assert.doesNotMatch(fragmentBody, /point_motion_delta\(/);
    assert.doesNotMatch(fragmentBody, /scalar_motion_delta\(/);
    assert.doesNotMatch(fragmentBody, /to_linear\(/);

    for (const [legacyExpression, zeroExpression] of [
        ['sin(localTime * 0.92 + 0.2) * 0.10', 'sin(0.2) * 0.10'],
        ['cos(localTime * 0.43 + 1.1) * 0.03', 'cos(1.1) * 0.03'],
        ['cos(localTime * 0.78 + 0.8) * 0.08', 'cos(0.8) * 0.08'],
        ['sin(localTime * 0.31 + 2.2) * 0.03', 'sin(2.2) * 0.03'],
        ['cos(localTime * 0.74 + 1.7) * 0.09', 'cos(1.7) * 0.09'],
        ['sin(localTime * 0.36 + 0.5) * 0.04', 'sin(0.5) * 0.04'],
        ['sin(localTime * 0.88 + 1.1) * 0.07', 'sin(1.1) * 0.07'],
        ['cos(localTime * 0.29 + 2.7) * 0.03', 'cos(2.7) * 0.03'],
        ['cos(localTime * 0.66 + 2.4) * 0.11', 'cos(2.4) * 0.11'],
        ['sin(localTime * 0.27 + 0.6) * 0.03', 'sin(0.6) * 0.03'],
        ['sin(localTime * 0.72 + 0.4) * 0.09', 'sin(0.4) * 0.09'],
        ['cos(localTime * 0.34 + 1.9) * 0.03', 'cos(1.9) * 0.03'],
        ['sin(localTime * 0.61 + 1.3) * 0.10', 'sin(1.3) * 0.10'],
        ['cos(localTime * 0.25 + 2.6) * 0.03', 'cos(2.6) * 0.03'],
        ['cos(localTime * 0.69 + 2.0) * 0.08', 'cos(2.0) * 0.08'],
        ['sin(localTime * 0.33 + 0.7) * 0.03', 'sin(0.7) * 0.03'],
        ['sin(localTime * 0.84 + 0.9) * 0.08', 'sin(0.9) * 0.08'],
        ['cos(localTime * 0.38 + 2.4) * 0.03', 'cos(2.4) * 0.03'],
        ['cos(localTime * 0.63 + 1.6) * 0.08', 'cos(1.6) * 0.08'],
        ['sin(localTime * 0.24 + 0.1) * 0.03', 'sin(0.1) * 0.03']
    ]) {
        assert.equal(legacySource.includes(legacyExpression), true);
        assert.equal(shader.includes(zeroExpression), true);
    }
});

test('presentation time wrap과 t=0 exact-zero, 45~90초 motion bound를 지킨다', async () => {
    const namespace = await loadPassModule();
    const constants = namespace.TITLE_WEBGPU_GRADIENT_CONSTANTS;

    assert.equal(namespace.wrapTitleWebGpuGradientTime(0), 0);
    assert.equal(namespace.wrapTitleWebGpuGradientTime(4096), 0);
    assert.equal(namespace.wrapTitleWebGpuGradientTime(4102.5), 6.5);
    assert.equal(namespace.wrapTitleWebGpuGradientTime(-1), 4095);
    assert.equal(namespace.wrapTitleWebGpuGradientTime(Number.NaN), 0);

    const atZero = namespace.evaluateTitleWebGpuGradientMotion(0);
    assert.equal(atZero.wrappedSeconds, 0);
    assert.equal(atZero.luminanceDelta, 0);
    assert.equal(atZero.saturationDelta, 0);
    assert.equal(atZero.pointDeltas.length, 5);
    for (const delta of atZero.pointDeltas) {
        assert.equal(delta.x, 0);
        assert.equal(delta.y, 0);
    }

    for (const period of [
        ...constants.POINT_MOTION_PERIODS_SECONDS,
        constants.LUMINANCE_PERIOD_SECONDS,
        constants.SATURATION_PERIOD_SECONDS
    ]) {
        assert.ok(period >= constants.MIN_MOTION_PERIOD_SECONDS);
        assert.ok(period <= constants.MAX_MOTION_PERIOD_SECONDS);
    }

    let sawPointMotion = false;
    let sawLuminanceMotion = false;
    let sawSaturationMotion = false;
    for (let time = 0; time < constants.TIME_WRAP_SECONDS; time += 0.25) {
        const motion = namespace.evaluateTitleWebGpuGradientMotion(time);
        for (const delta of motion.pointDeltas) {
            const displacement = Math.hypot(delta.x, delta.y);
            assert.ok(displacement <= constants.MAX_POINT_DISPLACEMENT_UV + 1e-12);
            sawPointMotion ||= displacement > 1e-6;
        }
        assert.ok(Math.abs(motion.luminanceDelta) <= constants.MAX_LUMINANCE_DELTA + 1e-12);
        assert.ok(Math.abs(motion.saturationDelta) <= constants.MAX_SATURATION_DELTA + 1e-12);
        sawLuminanceMotion ||= Math.abs(motion.luminanceDelta) > 1e-6;
        sawSaturationMotion ||= Math.abs(motion.saturationDelta) > 1e-6;
    }
    assert.equal(sawPointMotion, true);
    assert.equal(sawLuminanceMotion, true);
    assert.equal(sawSaturationMotion, true);

    const luminanceAtSeven = namespace.evaluateTitleWebGpuGradientMotion(7).luminanceDelta;
    const luminanceOnePeriodLater = namespace.evaluateTitleWebGpuGradientMotion(
        7 + constants.LUMINANCE_PERIOD_SECONDS
    ).luminanceDelta;
    assertClose(luminanceAtSeven, luminanceOnePeriodLater, 1e-12);
    const saturationAtEleven = namespace.evaluateTitleWebGpuGradientMotion(11).saturationDelta;
    const saturationOnePeriodLater = namespace.evaluateTitleWebGpuGradientMotion(
        11 + constants.SATURATION_PERIOD_SECONDS
    ).saturationDelta;
    assertClose(saturationAtEleven, saturationOnePeriodLater, 1e-12);
});

test('caller-owned target에 clear→pipeline→bind→draw 순서로 pass 하나만 encode한다', async () => {
    const { TitleWebGpuGradientPass } = await loadPassModule();
    const deviceHarness = createDevice('encode');
    const frame = createFrame(deviceHarness.device, 3, 41);
    const targetView = Object.freeze({ id: 'offscreen-gradient-view' });
    const gradientPass = new TitleWebGpuGradientPass();

    const output = gradientPass.encode({
        context: frame.context,
        targetView,
        format: 'rgba8unorm',
        width: 1920,
        height: 1080,
        presentationSeconds: 4100.25,
        colors: PALETTE
    });

    assert.equal(Object.isSealed(output), true);
    assert.strictEqual(output.targetView, targetView);
    assert.deepEqual({
        frameId: output.frameId,
        deviceGeneration: output.deviceGeneration,
        format: output.format,
        width: output.width,
        height: output.height,
        wrappedSeconds: output.wrappedSeconds,
        passCount: output.passCount
    }, {
        frameId: 41,
        deviceGeneration: 3,
        format: 'rgba8unorm',
        width: 1920,
        height: 1080,
        wrappedSeconds: 4.25,
        passCount: 1
    });
    assert.deepEqual(frame.records.operationOrder, [
        'beginRenderPass',
        'setPipeline',
        'setBindGroup:0',
        'draw',
        'end'
    ]);
    assert.equal(frame.records.passes.length, 1);
    const passRecord = frame.records.passes[0];
    const attachment = passRecord.descriptor.colorAttachments[0];
    assert.strictEqual(attachment.view, targetView);
    assert.deepEqual(cloneRecord(attachment.clearValue), { r: 0, g: 0, b: 0, a: 1 });
    assert.equal(attachment.loadOp, 'clear');
    assert.equal(attachment.storeOp, 'store');
    assert.deepEqual(passRecord.draws, [[3, 1, 0, 0]]);
    assert.equal(passRecord.endCount, 1);

    assert.equal(deviceHarness.records.shaderModules.length, 1);
    assert.equal(deviceHarness.records.pipelines.length, 1);
    assert.equal(deviceHarness.records.pipelines[0].descriptor.fragment.targets[0].format, 'rgba8unorm');
    assert.equal(deviceHarness.records.pipelines[0].descriptor.fragment.targets[0].blend, undefined);
    assert.equal(deviceHarness.records.buffers.length, 1);
    assert.deepEqual(deviceHarness.records.buffers[0].descriptor, {
        label: 'title-webgpu-gradient-uniform:0',
        size: 96,
        usage: 72
    });
    assert.equal(deviceHarness.records.writeBuffers.length, 1);
    const uniforms = deviceHarness.records.writeBuffers[0].data;
    assert.deepEqual(uniforms.slice(0, 4), [1920, 1080, 4.25, 0]);
    for (let index = 0; index < PALETTE.length; index++) {
        const offset = 4 + (index * 4);
        assertClose(uniforms[offset], PALETTE[index][0]);
        assertClose(uniforms[offset + 1], PALETTE[index][1]);
        assertClose(uniforms[offset + 2], PALETTE[index][2]);
        assert.equal(uniforms[offset + 3], 0);
    }
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);
    assert.equal(deviceHarness.records.forbiddenTextureCreateCount, 0);
    assert.equal(frame.records.forbiddenFinishCount, 0);
});

test('t=0 encode uniform은 oracle phase에 정확히 고정된다', async () => {
    const { TitleWebGpuGradientPass } = await loadPassModule();
    const deviceHarness = createDevice('time-zero');
    const frame = createFrame(deviceHarness.device, 1, 0);
    const gradientPass = new TitleWebGpuGradientPass();

    gradientPass.encode({
        context: frame.context,
        targetView: { id: 'time-zero-view' },
        width: 1280,
        height: 720,
        presentationSeconds: 4096,
        colors: PALETTE
    });

    const uniforms = deviceHarness.records.writeBuffers[0].data;
    assert.equal(uniforms[2], 0);
    assert.deepEqual(uniforms.slice(0, 4), [1280, 720, 0, 0]);
});

test('resize는 uniform만 바꾸고 format/generation 범위에서 pipeline과 high-water buffer를 재사용한다', async () => {
    const { TitleWebGpuGradientPass } = await loadPassModule();
    const deviceHarness = createDevice('cache');
    const gradientPass = new TitleWebGpuGradientPass();

    const first = createFrame(deviceHarness.device, 5, 1);
    const firstOutput = gradientPass.encode({
        context: first.context,
        targetView: { id: 'first-view' },
        width: 1920,
        height: 1080,
        presentationSeconds: 1,
        colors: PALETTE
    });
    const warmCounts = {
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length
    };

    const resized = createFrame(deviceHarness.device, 5, 2);
    const resizedOutput = gradientPass.encode({
        context: resized.context,
        targetView: { id: 'resized-view' },
        width: 2560,
        height: 1440,
        presentationSeconds: 2,
        colors: new Float32Array(PALETTE.flat())
    });
    assert.strictEqual(resizedOutput, firstOutput);
    assert.deepEqual({
        shaderModules: deviceHarness.records.shaderModules.length,
        pipelines: deviceHarness.records.pipelines.length,
        bindGroups: deviceHarness.records.bindGroups.length,
        buffers: deviceHarness.records.buffers.length
    }, warmCounts, 'resize/새 target view는 GPU resource를 만들지 않아야 합니다.');
    assert.deepEqual(deviceHarness.records.writeBuffers[1].data.slice(0, 4), [2560, 1440, 2, 0]);

    gradientPass.encode({
        context: resized.context,
        targetView: { id: 'same-frame-second-view' },
        width: 1280,
        height: 720,
        presentationSeconds: 3,
        colors: PALETTE
    });
    assert.equal(deviceHarness.records.buffers.length, 2, '동일 command buffer의 uniform overwrite 금지');
    assert.notStrictEqual(
        deviceHarness.records.writeBuffers[1].buffer,
        deviceHarness.records.writeBuffers[2].buffer
    );

    const next = createFrame(deviceHarness.device, 5, 3);
    gradientPass.encode({
        context: next.context,
        targetView: { id: 'next-view' },
        width: 2560,
        height: 1440,
        presentationSeconds: 4,
        colors: PALETTE
    });
    assert.strictEqual(
        deviceHarness.records.writeBuffers[3].buffer,
        deviceHarness.records.buffers[0].buffer,
        '다음 frame은 high-water uniform buffer를 재사용해야 합니다.'
    );
    assert.equal(deviceHarness.records.buffers.length, 2);
    assert.equal(deviceHarness.records.bindGroups.length, 2);

    const alternateFormat = createFrame(deviceHarness.device, 5, 4, 'bgra8unorm');
    gradientPass.encode({
        context: alternateFormat.context,
        targetView: { id: 'bgra-view' },
        width: 2560,
        height: 1440,
        presentationSeconds: 5,
        colors: PALETTE
    });
    assert.equal(deviceHarness.records.shaderModules.length, 1);
    assert.equal(deviceHarness.records.pipelines.length, 2);
    assert.equal(deviceHarness.records.buffers.length, 2);
    assert.equal(deviceHarness.records.bindGroups.length, 3);
    assert.deepEqual(
        deviceHarness.records.pipelines.map((record) => record.descriptor.fragment.targets[0].format),
        ['rgba8unorm', 'bgra8unorm']
    );
});

test('device generation 변경은 old buffer를 폐기하고 destroy는 idempotent하다', async () => {
    const { TitleWebGpuGradientPass } = await loadPassModule();
    const firstDevice = createDevice('generation-a');
    const secondDevice = createDevice('generation-b');
    const gradientPass = new TitleWebGpuGradientPass();

    gradientPass.encode({
        context: createFrame(firstDevice.device, 8, 1).context,
        targetView: { id: 'generation-a-view' },
        width: 640,
        height: 360,
        presentationSeconds: 1,
        colors: PALETTE
    });
    assert.equal(firstDevice.records.buffers[0].destroyCount, 0);

    gradientPass.encode({
        context: createFrame(secondDevice.device, 9, 2).context,
        targetView: { id: 'generation-b-view' },
        width: 640,
        height: 360,
        presentationSeconds: 2,
        colors: PALETTE
    });
    assert.equal(firstDevice.records.buffers[0].destroyCount, 1);
    assert.equal(secondDevice.records.shaderModules.length, 1);
    assert.equal(secondDevice.records.pipelines.length, 1);
    assert.equal(secondDevice.records.buffers.length, 1);
    assert.equal(gradientPass.getDiagnostics().deviceGeneration, 9);
    assert.equal(gradientPass.getDiagnostics().generationChangeCount, 1);
    assert.throws(() => gradientPass.encode({
        context: createFrame(firstDevice.device, 8, 3).context,
        targetView: { id: 'stale-generation-view' },
        width: 640,
        height: 360,
        presentationSeconds: 3,
        colors: PALETTE
    }), /stale.*generation/);
    assert.equal(secondDevice.records.buffers[0].destroyCount, 0);

    const invalidSameGenerationDevice = createDevice('generation-invalid');
    assert.throws(() => gradientPass.encode({
        context: createFrame(invalidSameGenerationDevice.device, 9, 3).context,
        targetView: { id: 'invalid-view' },
        width: 640,
        height: 360,
        presentationSeconds: 3,
        colors: PALETTE
    }), /identity.*generation 변경 없이/);
    assert.equal(secondDevice.records.buffers[0].destroyCount, 1);
    assert.equal(gradientPass.getDiagnostics().deviceGeneration, null);

    gradientPass.encode({
        context: createFrame(invalidSameGenerationDevice.device, 9, 4).context,
        targetView: { id: 'recovered-view' },
        width: 640,
        height: 360,
        presentationSeconds: 4,
        colors: PALETTE
    });
    assert.equal(gradientPass.destroy(), true);
    assert.equal(gradientPass.destroy(), false);
    assert.equal(invalidSameGenerationDevice.records.buffers[0].destroyCount, 1);
    assert.equal(gradientPass.getDiagnostics().destroyed, true);
    assert.throws(() => gradientPass.encode({}), /destroy된/);
});

test('잘못된 extent/palette는 GPU resource 생성 전에 fail-closed로 거부한다', async () => {
    const { TitleWebGpuGradientPass } = await loadPassModule();
    const deviceHarness = createDevice('validation');
    const frame = createFrame(deviceHarness.device, 1, 1);
    const gradientPass = new TitleWebGpuGradientPass();
    const baseInput = {
        context: frame.context,
        targetView: { id: 'validation-view' },
        width: 320,
        height: 180,
        presentationSeconds: 0,
        colors: PALETTE
    };

    assert.throws(() => gradientPass.encode({ ...baseInput, width: 0 }), /width.*양의 정수/);
    assert.throws(() => gradientPass.encode({ ...baseInput, colors: [[0, 0, 0]] }), /RGB 5색/);
    assert.throws(() => gradientPass.encode({
        ...baseInput,
        colors: PALETTE.map((color, index) => index === 4 ? [0, 0, 1.1] : color)
    }), /0\.\.1 범위/);
    assert.equal(deviceHarness.records.shaderModules.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(deviceHarness.records.buffers.length, 0);
    assert.equal(deviceHarness.records.bindGroups.length, 0);
    assert.equal(deviceHarness.records.writeBuffers.length, 0);
    assert.equal(frame.records.passes.length, 0);
});

test('pass source에는 presentation/canvas/texture 소유 API가 없다', () => {
    assert.doesNotMatch(passSource, /^import\s/m);
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
});
