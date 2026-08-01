import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const PASS_PATH = fileURLToPath(new URL(
    '../script/module/scene/title/webgpu/_title_webgpu_shield_pass.js',
    import.meta.url
));
const EFFECT_PATH = fileURLToPath(new URL(
    '../script/module/scene/title/shield/_title_shield_effect.js',
    import.meta.url
));
const [passSource, effectSource] = await Promise.all([
    readFile(PASS_PATH, 'utf8'),
    readFile(EFFECT_PATH, 'utf8')
]);
const passNamespace = await loadGameModule('scene/title/webgpu/_title_webgpu_shield_pass.js');
const commandNamespace = await loadGameModule('scene/title/shield/_title_shield_render_command.js');

function cloneRecord(value) {
    return JSON.parse(JSON.stringify(value));
}

function copyBytes(data) {
    if (data?.buffer) {
        return new Uint8Array(
            new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength).slice().buffer
        );
    }
    return new Uint8Array(new Uint8Array(data).slice().buffer);
}

function createDevice(id) {
    const records = {
        shaderModules: [],
        pipelines: [],
        bindGroups: [],
        buffers: [],
        writes: [],
        forbiddenSubmitCount: 0
    };
    const device = {
        id,
        queue: {
            writeBuffer(buffer, offset, data) {
                records.writes.push({ buffer, offset, bytes: copyBytes(data) });
            },
            submit() {
                records.forbiddenSubmitCount += 1;
                throw new Error('shield pass가 presentation submit을 소유하면 안 됩니다.');
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
        }
    };
    return { device, records };
}

function createEncoder(id) {
    const records = {
        passes: [],
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
            return {
                setPipeline(pipeline) {
                    passRecord.pipeline = pipeline;
                },
                setBindGroup(index, bindGroup) {
                    passRecord.bindGroups.push({ index, bindGroup });
                },
                setViewport(...args) {
                    passRecord.viewports.push(args);
                },
                setScissorRect(...args) {
                    passRecord.scissors.push(args);
                },
                draw(...args) {
                    passRecord.draws.push(args);
                },
                end() {
                    passRecord.endCount += 1;
                }
            };
        },
        finish() {
            records.forbiddenFinishCount += 1;
            throw new Error('shield pass가 encoder lifecycle을 소유하면 안 됩니다.');
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
        fieldRadius: 200,
        time: 1.25,
        alpha: 0.8,
        ringThickness: 2,
        glowWidth: 20,
        shadowColor: [0.1, 0.2, 0.3],
        lowColor: [0.4, 0.5, 0.6],
        highColor: [0.7, 0.8, 0.9],
        highlightColor: [0.91, 0.92, 0.93],
        impacts: [
            { angle: 0.1, intensity: 0.2, width: 0.3, progress: 0.4 },
            { angle: 0.5, intensity: 0.6, width: 0.7, progress: 0.8 }
        ],
        dents: [
            { angle: 0.9, depth: 10, width: 0.11, strength: 0.12 }
        ],
        ...overrides
    };
}

function createTargetInput(command, overrides = {}) {
    return {
        command,
        targetView: Object.freeze({ id: overrides.targetId || 'effect-target' }),
        targetWidth: overrides.targetWidth ?? 800,
        targetHeight: overrides.targetHeight ?? 600,
        originX: overrides.originX ?? 100,
        originY: overrides.originY ?? 50,
        ...(overrides.loadOp ? { loadOp: overrides.loadOp } : {}),
        ...(overrides.format ? { format: overrides.format } : {})
    };
}

function getWriteViews(write) {
    return {
        floats: new Float32Array(write.bytes.buffer),
        uints: new Uint32Array(write.bytes.buffer)
    };
}

test('presentation command는 legacy 값/순서/최대치를 보존하고 command와 slot identity를 재사용한다', () => {
    const config = {
        getColors: () => ({
            shadow: [0.01, 0.02, 0.03],
            low: [0.11, 0.12, 0.13],
            high: [0.21, 0.22, 0.23],
            highlight: [0.31, 0.32, 0.33]
        }),
        getFieldRadius: (radius) => radius * 4,
        getBaseAlpha: () => 0.75,
        getRingThickness: () => 1.75,
        getGlowWidth: () => 26
    };
    const impacts = Array.from({ length: 15 }, (_, index) => ({
        angle: index + 0.1,
        intensity: index + 0.2,
        width: index + 0.3,
        age: index + 0.4,
        duration: index + 1
    }));
    const dents = Array.from({ length: 20 }, (_, index) => ({
        angle: index + 0.5,
        depth: index + 1.5,
        width: index + 2.5,
        strength: index + 3.5
    }));
    const command = commandNamespace.buildTitleShieldRenderCommand({
        centerX: 400,
        centerY: 240,
        radius: 80,
        time: 2,
        impacts,
        dents,
        config
    });

    assert.equal(command.impacts.length, 12);
    assert.equal(command.dents.length, 16);
    assert.deepEqual(
        Array.from(command.impacts, (impact) => impact.angle),
        impacts.slice(0, 12).map((impact) => impact.angle)
    );
    assert.deepEqual(
        Array.from(command.dents, (dent) => dent.angle),
        dents.slice(0, 16).map((dent) => dent.angle)
    );
    assert.equal(command.fieldRadius, 320);
    assert.equal(command.alpha, 0.75);
    const impactArray = command.impacts;
    const dentArray = command.dents;
    const firstImpactSlot = command.impacts[0];
    const firstDentSlot = command.dents[0];

    impacts[0].angle = -3;
    impacts.length = 2;
    dents[0].angle = -4;
    dents.length = 1;
    const reused = commandNamespace.buildTitleShieldRenderCommand({
        centerX: 401,
        centerY: 241,
        radius: 81,
        time: 3,
        impacts,
        dents,
        config
    }, command);
    assert.strictEqual(reused, command);
    assert.strictEqual(reused.impacts, impactArray);
    assert.strictEqual(reused.dents, dentArray);
    assert.strictEqual(reused.impacts[0], firstImpactSlot);
    assert.strictEqual(reused.dents[0], firstDentSlot);
    assert.equal(reused.impacts.length, 2);
    assert.equal(reused.dents.length, 1);
    assert.equal(reused.impacts[0].angle, -3);
    assert.equal(reused.dents[0].angle, -4);

    assert.match(effectSource, /const command = this\.getPresentationCommand\(\);/u);
    assert.match(effectSource, /renderGL\('effect', command\);/u);
    assert.match(effectSource, /\}, this\.presentationCommand\);/u);
});

test('WGSL은 legacy 최대치와 magnetic shield 수식 및 premultiplied alpha 출력을 보존한다', () => {
    assert.equal(passNamespace.TITLE_WEBGPU_SHIELD_PASS_CONSTANTS.MAX_IMPACTS, 12);
    assert.equal(passNamespace.TITLE_WEBGPU_SHIELD_PASS_CONSTANTS.MAX_DENTS, 16);
    assert.equal(passNamespace.TITLE_WEBGPU_SHIELD_PASS_CONSTANTS.UNIFORM_BYTE_SIZE, 560);
    const shader = passNamespace.TITLE_WEBGPU_SHIELD_SHADER;
    assert.match(shader, /impacts: array<vec4<f32>, 12>/u);
    assert.match(shader, /dents: array<vec4<f32>, 16>/u);
    assert.match(shader, /index < 12u/u);
    assert.match(shader, /index < 16u/u);
    assert.match(shader, /shellWave = sin/u);
    assert.match(shader, /fieldBloom = exp\(-pow/u);
    assert.match(shader, /fade = pow\(1\.0 - progress, 1\.4\)/u);
    assert.match(shader, /localActivity = saturate\(max\(approachActivity, impactActivity \* 0\.92\)\)/u);
    assert.match(shader, /baseAlpha \*= localActivity \* activityNoise/u);
    assert.match(shader, /fieldAlpha \*= max\(approachActivity, impactActivity \* 0\.55\)/u);
    assert.match(shader, /premultipliedColor = min\(color \* parameters\.alpha, vec3<f32>\(alpha\)\)/u);
});

test('dent/impact count가 모두 0이면 정확히 투명한 shader 계약에 따라 draw/resource를 생략한다', () => {
    const { TitleWebGpuShieldPass } = passNamespace;
    const pass = new TitleWebGpuShieldPass();
    const deviceHarness = createDevice('inactive');
    const frame = createContext(deviceHarness.device, 1, 1);
    const inactive = createCommand({ impacts: [], dents: [] });

    assert.equal(pass.encode(frame.context, createTargetInput(inactive)), false);
    assert.equal(frame.records.passes.length, 0);
    assert.equal(deviceHarness.records.shaderModules.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(deviceHarness.records.buffers.length, 0);
    assert.equal(deviceHarness.records.writes.length, 0);
    assert.deepEqual({ ...pass.getDiagnostics() }, {
        destroyed: false,
        deviceGeneration: null,
        pipelineFormatCount: 0,
        uniformBufferCount: 0,
        activeFrameId: null,
        frameUniformCount: 0,
        encodeCount: 0,
        skipCount: 1,
        cleanupFailureCount: 0
    });

    const impactOnly = createCommand({ dents: [] });
    const dentOnly = createCommand({ impacts: [] });
    assert.equal(pass.encode(frame.context, createTargetInput(impactOnly)), true);
    assert.equal(pass.encode(frame.context, createTargetInput(dentOnly)), true);
    assert.equal(frame.records.passes.length, 2);
    assert.deepEqual(
        deviceHarness.records.writes.map((write) => {
            const uniform = getWriteViews(write);
            return [uniform.uints[10], uniform.uints[11]];
        }),
        [[2, 0], [0, 1]]
    );
    assert.equal(pass.getDiagnostics().encodeCount, 2);
    assert.equal(pass.getDiagnostics().skipCount, 1);
    pass.destroy();
});

test('screen command를 target-local로 변환하고 실제 영향 ROI에 viewport/scissor를 제한한다', () => {
    const { TitleWebGpuShieldPass } = passNamespace;
    const pass = new TitleWebGpuShieldPass();
    const deviceHarness = createDevice('roi');
    const frame = createContext(deviceHarness.device, 3, 21);
    const command = createCommand();
    const encoded = pass.encode(frame.context, createTargetInput(command));

    assert.equal(encoded, true);
    assert.equal(frame.records.passes.length, 1);
    const record = frame.records.passes[0];
    assert.equal(record.descriptor.colorAttachments[0].loadOp, 'clear');
    assert.equal(record.descriptor.colorAttachments[0].storeOp, 'store');
    assert.deepEqual(cloneRecord(record.descriptor.colorAttachments[0].clearValue), {
        r: 0,
        g: 0,
        b: 0,
        a: 0
    });
    assert.deepEqual(record.viewports, [[200, 50, 400, 400, 0, 1]]);
    assert.deepEqual(record.scissors, [[200, 50, 400, 400]]);
    assert.deepEqual(record.draws, [[3, 1, 0, 0]]);
    assert.equal(record.endCount, 1);

    const target = deviceHarness.records.pipelines[0].descriptor.fragment.targets[0];
    assert.equal(target.format, 'rgba8unorm');
    assert.deepEqual(cloneRecord(target.blend), {
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

    const uniform = getWriteViews(deviceHarness.records.writes[0]);
    assert.deepEqual(Array.from(uniform.floats.slice(0, 10)), [
        800,
        600,
        400,
        250,
        50,
        200,
        1.25,
        Math.fround(0.8),
        2,
        20
    ]);
    assert.equal(uniform.uints[10], 2);
    assert.equal(uniform.uints[11], 1);
    assert.deepEqual(Array.from(uniform.floats.slice(28, 36)), [
        Math.fround(0.1),
        Math.fround(0.2),
        Math.fround(0.3),
        Math.fround(0.4),
        Math.fround(0.5),
        Math.fround(0.6),
        Math.fround(0.7),
        Math.fround(0.8)
    ]);
    assert.equal(deviceHarness.records.forbiddenSubmitCount, 0);
    assert.equal(frame.records.forbiddenFinishCount, 0);
    pass.destroy();
});

test('동일 frame 다중 encode의 uniform을 분리하고 resize/generation/format resource lifecycle을 지킨다', () => {
    const { TitleWebGpuShieldPass } = passNamespace;
    const pass = new TitleWebGpuShieldPass();
    const firstDevice = createDevice('reuse-a');
    const firstFrame = createContext(firstDevice.device, 7, 100);
    const command = createCommand();

    assert.equal(pass.encode(firstFrame.context, createTargetInput(command)), true);
    command.time = 9;
    assert.equal(pass.encode(firstFrame.context, createTargetInput(command, { loadOp: 'load' })), true);
    assert.equal(firstDevice.records.buffers.length, 2);
    assert.notStrictEqual(
        firstDevice.records.writes[0].buffer,
        firstDevice.records.writes[1].buffer,
        '동일 command buffer에서 uniform overwrite hazard 금지'
    );
    assert.equal(firstFrame.records.passes[1].descriptor.colorAttachments[0].loadOp, 'load');

    const warmCounts = {
        shaders: firstDevice.records.shaderModules.length,
        pipelines: firstDevice.records.pipelines.length,
        bindGroups: firstDevice.records.bindGroups.length,
        buffers: firstDevice.records.buffers.length
    };
    const resizedFrame = createContext(firstDevice.device, 7, 101);
    assert.equal(pass.encode(resizedFrame.context, createTargetInput(command, {
        targetWidth: 1024,
        targetHeight: 512,
        originX: 0,
        originY: 0
    })), true);
    assert.deepEqual({
        shaders: firstDevice.records.shaderModules.length,
        pipelines: firstDevice.records.pipelines.length,
        bindGroups: firstDevice.records.bindGroups.length,
        buffers: firstDevice.records.buffers.length
    }, warmCounts, 'resize는 uniform/ROI만 갱신해야 함');
    assert.strictEqual(firstDevice.records.writes[2].buffer, firstDevice.records.writes[0].buffer);

    const alternateFormatFrame = createContext(firstDevice.device, 7, 102, 'bgra8unorm');
    assert.equal(pass.encode(
        alternateFormatFrame.context,
        createTargetInput(command, { format: 'bgra8unorm' })
    ), true);
    assert.equal(firstDevice.records.shaderModules.length, 1);
    assert.equal(firstDevice.records.pipelines.length, 2);
    assert.equal(firstDevice.records.buffers.length, 2);

    const secondDevice = createDevice('reuse-b');
    const nextGeneration = createContext(secondDevice.device, 8, 103);
    assert.equal(pass.encode(nextGeneration.context, createTargetInput(command)), true);
    assert.equal(firstDevice.records.buffers.every((buffer) => buffer.destroyCount === 1), true);
    assert.equal(secondDevice.records.shaderModules.length, 1);
    assert.equal(secondDevice.records.pipelines.length, 1);
    assert.equal(secondDevice.records.buffers.length, 1);
    assert.equal(pass.getDiagnostics().deviceGeneration, 8);

    assert.equal(pass.destroy(), true);
    assert.equal(pass.destroy(), false);
    assert.equal(secondDevice.records.buffers[0].destroyCount, 1);
});

test('stale frame/generation과 same-generation device drift는 최신 cache를 보존한 채 거부한다', () => {
    const { TitleWebGpuShieldPass } = passNamespace;
    const pass = new TitleWebGpuShieldPass();
    const currentDevice = createDevice('generation-current');
    const currentFrame = createContext(currentDevice.device, 8, 100);
    const command = createCommand();

    assert.equal(pass.encode(currentFrame.context, createTargetInput(command)), true);
    const currentBufferRecord = currentDevice.records.buffers[0];
    const currentBuffer = currentBufferRecord.buffer;
    const currentPipeline = currentDevice.records.pipelines[0].pipeline;

    const staleFrame = createContext(currentDevice.device, 8, 99);
    assert.throws(
        () => pass.encode(staleFrame.context, createTargetInput(command)),
        /stale title WebGPU shield frame/u
    );
    assert.equal(currentDevice.records.shaderModules.length, 1);
    assert.equal(currentDevice.records.pipelines.length, 1);
    assert.equal(currentDevice.records.buffers.length, 1);
    assert.equal(currentDevice.records.writes.length, 1);
    assert.strictEqual(currentDevice.records.writes[0].buffer, currentBuffer);

    const staleDevice = createDevice('generation-stale');
    const staleGenerationFrame = createContext(staleDevice.device, 7, 101);
    assert.throws(
        () => pass.encode(staleGenerationFrame.context, createTargetInput(command)),
        /stale title WebGPU shield device generation/u
    );

    const driftDevice = createDevice('generation-drift');
    const driftFrame = createContext(driftDevice.device, 8, 102);
    assert.throws(
        () => pass.encode(driftFrame.context, createTargetInput(command)),
        /generation 변경 없는 title WebGPU shield device drift/u
    );

    assert.equal(pass.getDiagnostics().deviceGeneration, 8);
    assert.equal(currentBufferRecord.destroyCount, 0);
    assert.equal(staleDevice.records.shaderModules.length, 0);
    assert.equal(staleDevice.records.pipelines.length, 0);
    assert.equal(staleDevice.records.buffers.length, 0);
    assert.equal(staleDevice.records.writes.length, 0);
    assert.equal(driftDevice.records.shaderModules.length, 0);
    assert.equal(driftDevice.records.pipelines.length, 0);
    assert.equal(driftDevice.records.buffers.length, 0);
    assert.equal(driftDevice.records.writes.length, 0);

    const resumedCurrentFrame = createContext(currentDevice.device, 8, 100);
    assert.equal(pass.encode(resumedCurrentFrame.context, createTargetInput(command)), true);
    assert.equal(currentDevice.records.buffers.length, 2);
    assert.strictEqual(
        currentDevice.records.writes[1].buffer,
        currentDevice.records.buffers[1].buffer
    );

    const resumedFrame = createContext(currentDevice.device, 8, 103);
    assert.equal(pass.encode(resumedFrame.context, createTargetInput(command)), true);
    assert.equal(currentDevice.records.shaderModules.length, 1);
    assert.equal(currentDevice.records.pipelines.length, 1);
    assert.strictEqual(resumedFrame.records.passes[0].pipeline, currentPipeline);
    assert.strictEqual(currentDevice.records.writes[2].buffer, currentBuffer);

    pass.destroy();
    assert.equal(currentBufferRecord.destroyCount, 1);
    assert.equal(currentDevice.records.buffers[1].destroyCount, 1);
});

test('화면 밖 command는 pass/resource를 만들지 않고 presentation ownership API가 source에 없다', () => {
    const { TitleWebGpuShieldPass } = passNamespace;
    const pass = new TitleWebGpuShieldPass();
    const deviceHarness = createDevice('skip');
    const frame = createContext(deviceHarness.device, 1, 1);
    const command = createCommand({ x: -1000, y: -1000 });

    assert.equal(pass.encode(frame.context, createTargetInput(command)), false);
    assert.equal(frame.records.passes.length, 0);
    assert.equal(deviceHarness.records.shaderModules.length, 0);
    assert.equal(deviceHarness.records.pipelines.length, 0);
    assert.equal(deviceHarness.records.buffers.length, 0);
    assert.equal(pass.getDiagnostics().skipCount, 1);

    for (const forbiddenCall of [
        'queue.submit',
        'acquireFrameTarget',
        'getCurrentTexture',
        'markCanvasDrawn',
        'markCanvasCleared',
        '.finish('
    ]) {
        assert.equal(passSource.includes(forbiddenCall), false, `${forbiddenCall} 호출 금지`);
    }
    pass.destroy();
});
