import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const PASS_PATH = fileURLToPath(new URL(
    '../script/module/scene/title/webgpu/_title_webgpu_overlay_glass_pass.js',
    import.meta.url
));
const passSource = await readFile(PASS_PATH, 'utf8');
const namespace = await loadGameModule('scene/title/webgpu/_title_webgpu_overlay_glass_pass.js');
const {
    TITLE_WEBGPU_OVERLAY_GLASS_PASS_CONSTANTS: CONSTANTS,
    TITLE_WEBGPU_OVERLAY_GLASS_SHADER: SHADER,
    TitleWebGpuOverlayGlassPass
} = namespace;

function copyBytes(data) {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data.slice(0));
    }
    if (ArrayBuffer.isView(data)) {
        return new Uint8Array(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        );
    }
    return new Uint8Array(data).slice();
}

function createDevice(id = 'device') {
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
                throw new Error('glass pass must not submit');
            },
            copyExternalImageToTexture() {
                records.forbiddenExternalCopyCount += 1;
                throw new Error('glass pass must not upload external textures');
            }
        },
        createShaderModule(descriptor) {
            const shaderModule = { kind: 'shader-module', descriptor };
            records.shaderModules.push(shaderModule);
            return shaderModule;
        },
        createSampler(descriptor) {
            const sampler = { kind: 'sampler', descriptor };
            records.samplers.push(sampler);
            return sampler;
        },
        createRenderPipeline(descriptor) {
            const bindGroupLayout = { kind: 'bind-group-layout' };
            const pipeline = {
                kind: 'pipeline',
                descriptor,
                getBindGroupLayout(index) {
                    assert.equal(index, 0);
                    return bindGroupLayout;
                }
            };
            records.pipelines.push(pipeline);
            return pipeline;
        },
        createBindGroup(descriptor) {
            const bindGroup = { kind: 'bind-group', descriptor };
            records.bindGroups.push(bindGroup);
            return bindGroup;
        },
        createBuffer(descriptor) {
            const buffer = {
                kind: 'buffer',
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                }
            };
            records.buffers.push(buffer);
            return buffer;
        },
        createTexture() {
            records.forbiddenTextureCreateCount += 1;
            throw new Error('glass pass must not allocate textures');
        }
    };
    return { device, records };
}

function createEncoder() {
    const records = {
        renderPasses: [],
        forbiddenFinishCount: 0
    };
    const encoder = {
        beginRenderPass(descriptor) {
            const passRecord = {
                descriptor,
                pipeline: null,
                bindGroups: [],
                viewport: null,
                scissor: null,
                scissors: [],
                draws: [],
                endCount: 0
            };
            records.renderPasses.push(passRecord);
            return {
                setPipeline(pipeline) {
                    passRecord.pipeline = pipeline;
                },
                setBindGroup(index, bindGroup) {
                    passRecord.bindGroups.push({ index, bindGroup });
                },
                setViewport(x, y, width, height, minDepth, maxDepth) {
                    passRecord.viewport = { x, y, width, height, minDepth, maxDepth };
                },
                setScissorRect(x, y, width, height) {
                    passRecord.scissor = { x, y, width, height };
                    passRecord.scissors.push({ x, y, width, height });
                },
                draw(vertexCount, instanceCount, firstVertex, firstInstance) {
                    passRecord.draws.push({ vertexCount, instanceCount, firstVertex, firstInstance });
                },
                end() {
                    passRecord.endCount += 1;
                }
            };
        },
        finish() {
            records.forbiddenFinishCount += 1;
            throw new Error('glass pass must not finish the caller encoder');
        }
    };
    return { encoder, records };
}

function createContext(device, encoder, overrides = {}) {
    return {
        device,
        deviceGeneration: 7,
        frameId: 100,
        format: 'rgba8unorm',
        encoder,
        ...overrides
    };
}

function createInput(overrides = {}) {
    return {
        targetView: { kind: 'target-view' },
        targetWidth: 800,
        targetHeight: 600,
        backdropView: { kind: 'backdrop-view' },
        backdropWidth: 200,
        backdropHeight: 100,
        backdropLogicalBounds: { x: 100, y: 50, w: 400, h: 200 },
        panel: {
            x: 120,
            y: 80,
            w: 240,
            h: 120,
            radius: 18,
            lineWidth: 2,
            fill: 'rgba(64, 128, 255, 0.2)',
            stroke: '#ffffff80',
            tintColor: [0.9, 0.95, 1, 0.7],
            edgeColor: [1, 1, 1, 1],
            tintStrength: 0.22,
            edgeStrength: 0.48,
            refractionStrength: 4,
            alpha: 0.5,
            sampleBackdrop: true
        },
        opacity: 0.8,
        ...overrides
    };
}

function getWrittenFloats(records, index = records.writes.length - 1) {
    const write = records.writes[index];
    return new Float32Array(
        write.bytes.buffer,
        write.bytes.byteOffset,
        write.bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
}

function assertApproximately(actual, expected, epsilon = 1e-5) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

function mapWithInverseUniform(floats, x, y) {
    const row0 = CONSTANTS.INVERSE_HOMOGRAPHY_ROW_0_OFFSET;
    const row1 = CONSTANTS.INVERSE_HOMOGRAPHY_ROW_1_OFFSET;
    const row2 = CONSTANTS.INVERSE_HOMOGRAPHY_ROW_2_OFFSET;
    const denominator = (floats[row2] * x) + (floats[row2 + 1] * y) + floats[row2 + 2];
    return {
        x: ((floats[row0] * x) + (floats[row0 + 1] * y) + floats[row0 + 2]) / denominator,
        y: ((floats[row1] * x) + (floats[row1 + 1] * y) + floats[row1 + 2]) / denominator
    };
}

test('uniform ABI와 WGSL은 ROI origin, rounded AA, explicit LOD, premultiplied 출력을 고정한다', () => {
    assert.equal(CONSTANTS.UNIFORM_FLOAT_COUNT, 64);
    assert.equal(CONSTANTS.UNIFORM_BYTE_SIZE, 256);
    assert.deepEqual(
        [
            CONSTANTS.TARGET_BACKDROP_RESOLUTION_OFFSET,
            CONSTANTS.BACKDROP_LOGICAL_BOUNDS_OFFSET,
            CONSTANTS.PANEL_RECT_OFFSET,
            CONSTANTS.INVERSE_HOMOGRAPHY_ROW_0_OFFSET,
            CONSTANTS.INVERSE_HOMOGRAPHY_ROW_1_OFFSET,
            CONSTANTS.INVERSE_HOMOGRAPHY_ROW_2_OFFSET,
            CONSTANTS.GLASS_PARAMETERS_OFFSET,
            CONSTANTS.STYLE_PARAMETERS_OFFSET,
            CONSTANTS.SHADOW_PARAMETERS_OFFSET,
            CONSTANTS.FILL_COLOR_OFFSET,
            CONSTANTS.STROKE_COLOR_OFFSET,
            CONSTANTS.TINT_COLOR_OFFSET,
            CONSTANTS.EDGE_COLOR_OFFSET,
            CONSTANTS.SHADOW_COLOR_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET
        ],
        [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]
    );
    assert.match(SHADER, /fn rounded_rect_sdf\(/);
    assert.match(SHADER, /fwidth\(panelSdf\)/);
    assert.match(SHADER, /backdropLogicalBounds\.xy/);
    assert.match(SHADER, /backdropLogicalBounds\.zw/);
    assert.match(SHADER, /targetBackdropResolution\.zw/);
    assert.match(SHADER, /targetPosition \+ parameters\.panelRect\.xy/);
    assert.match(SHADER, /textureSampleLevel\([\s\S]*?0\.0\s*\)/);
    assert.match(SHADER, /@group\(0\) @binding\(3\) var effectTexture/);
    assert.match(SHADER, /effectTextureParameters\.w > 0\.5/);
    assert.match(SHADER, /1\.0 - rawEffectUv\.y/);
    assert.match(SHADER, /let halfEffectTexel = vec2<f32>\(0\.5\) \/ effectResolution/);
    assert.match(SHADER, /textureSampleLevel\(\s*effectTexture,[\s\S]*?clampedEffectUv,[\s\S]*?0\.0\s*\)/);
    assert.match(SHADER, /shadowPremultiplied/);
    assert.match(SHADER, /effectPremultiplied = effectColor\.rgb \* effectCoverage/);
    assert.match(SHADER, /effectPremultiplied[\s\S]*basePremultiplied \* oneMinusEffectAlpha/);
    assert.match(SHADER, /return vec4<f32>\(outputPremultiplied, outputAlpha\)/);
    assert.doesNotMatch(passSource, /getCurrentTexture\s*\(/);
    assert.doesNotMatch(passSource, /\.finish\s*\(/);
    assert.doesNotMatch(passSource, /\.submit\s*\(/);
    assert.doesNotMatch(passSource, /createTexture\s*\(/);
});

test('encode는 logical ROI와 다운샘플 extent를 분리하고 premultiplied load/store pass만 기록한다', () => {
    const { device, records: deviceRecords } = createDevice();
    const { encoder, records: encoderRecords } = createEncoder();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const diagnosticsBefore = pass.getDiagnostics();

    assert.equal(diagnosticsBefore.warmCacheReady, true);
    assert.equal(deviceRecords.shaderModules.length, 1);
    assert.equal(deviceRecords.samplers.length, 1);
    assert.equal(deviceRecords.pipelines.length, 1);
    assert.equal(deviceRecords.buffers.length, 1);
    assert.equal(pass.encode(createContext(device, encoder), createInput()), true);

    assert.equal(deviceRecords.writes.length, 1);
    const floats = getWrittenFloats(deviceRecords);
    assert.deepEqual(Array.from(floats.slice(0, 4)), [800, 600, 200, 100]);
    assert.deepEqual(Array.from(floats.slice(4, 8)), [100, 50, 400, 200]);
    assert.deepEqual(Array.from(floats.slice(8, 12)), [0, 0, 240, 120]);
    assert.deepEqual(Array.from(floats.slice(12, 15)), [1, 0, -120]);
    assert.deepEqual(Array.from(floats.slice(16, 19)), [0, 1, -80]);
    assert.deepEqual(Array.from(floats.slice(20, 23)), [0, 0, 1]);
    assertApproximately(floats[CONSTANTS.GLASS_PARAMETERS_OFFSET + 2], 0.4);
    assert.equal(floats[CONSTANTS.GLASS_PARAMETERS_OFFSET + 3], 4);
    assert.equal(floats[CONSTANTS.STYLE_PARAMETERS_OFFSET + 2], 1);
    assertApproximately(floats[CONSTANTS.FILL_COLOR_OFFSET], 64 / 255);
    assertApproximately(floats[CONSTANTS.FILL_COLOR_OFFSET + 1], 128 / 255);
    assertApproximately(floats[CONSTANTS.FILL_COLOR_OFFSET + 2], 1);
    assertApproximately(floats[CONSTANTS.FILL_COLOR_OFFSET + 3], 0.2);
    assertApproximately(floats[CONSTANTS.STROKE_COLOR_OFFSET + 3], 128 / 255);
    assert.deepEqual(
        Array.from(floats.slice(
            CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET + 4
        )),
        [200, 100, 0, 0]
    );
    assert.deepEqual(
        Array.from(floats.slice(
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET + 4
        )),
        [0, 0, 240, 120]
    );
    const bindGroupEntries = deviceRecords.bindGroups[0].descriptor.entries;
    assert.equal(bindGroupEntries.length, 4);
    assert.equal(bindGroupEntries[2].resource, bindGroupEntries[3].resource);

    const samplerDescriptor = deviceRecords.samplers[0].descriptor;
    assert.equal(samplerDescriptor.addressModeU, 'clamp-to-edge');
    assert.equal(samplerDescriptor.addressModeV, 'clamp-to-edge');
    assert.equal(samplerDescriptor.minFilter, 'linear');
    assert.equal(samplerDescriptor.magFilter, 'linear');
    const blend = deviceRecords.pipelines[0].descriptor.fragment.targets[0].blend;
    for (const blendComponent of [blend.color, blend.alpha]) {
        assert.equal(blendComponent.srcFactor, 'one');
        assert.equal(blendComponent.dstFactor, 'one-minus-src-alpha');
        assert.equal(blendComponent.operation, 'add');
    }

    assert.equal(encoderRecords.renderPasses.length, 1);
    const renderPass = encoderRecords.renderPasses[0];
    assert.equal(renderPass.descriptor.colorAttachments[0].loadOp, 'load');
    assert.equal(renderPass.descriptor.colorAttachments[0].storeOp, 'store');
    assert.deepEqual(renderPass.viewport, {
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        minDepth: 0,
        maxDepth: 1
    });
    assert.deepEqual(renderPass.scissor, { x: 115, y: 75, width: 250, height: 130 });
    assert.deepEqual(renderPass.draws, [{
        vertexCount: 3,
        instanceCount: 1,
        firstVertex: 0,
        firstInstance: 0
    }]);
    assert.equal(renderPass.endCount, 1);
    assert.equal(deviceRecords.forbiddenSubmitCount, 0);
    assert.equal(deviceRecords.forbiddenTextureCreateCount, 0);
    assert.equal(deviceRecords.forbiddenExternalCopyCount, 0);
    assert.equal(encoderRecords.forbiddenFinishCount, 0);
    const diagnostics = pass.getDiagnostics();
    assert.equal(diagnostics.clearBatchCount, 0);
    assert.equal(diagnostics.loadBatchCount, 1);
    assert.equal(diagnostics.lastBatchLoadOp, 'load');
});

test('cropped target은 global homography/backdrop 좌표를 유지하고 scissor만 localize한다', () => {
    const { device, records: deviceRecords } = createDevice();
    const { encoder, records: encoderRecords } = createEncoder();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const input = createInput({
        targetWidth: 128,
        targetHeight: 64,
        targetOriginX: 224,
        targetOriginY: 64,
        logicalTargetWidth: 400,
        logicalTargetHeight: 240,
        panel: {
            ...createInput().panel,
            x: 250,
            y: 70,
            w: 80,
            h: 50,
            lineWidth: 1,
            refractionStrength: 0
        }
    });

    assert.equal(pass.encode(createContext(device, encoder), input), true);
    const floats = getWrittenFloats(deviceRecords);
    assert.deepEqual(Array.from(floats.slice(8, 12)), [224, 64, 80, 50]);
    const centerLocal = mapWithInverseUniform(floats, 290, 95);
    assertApproximately(centerLocal.x, 40);
    assertApproximately(centerLocal.y, 25);
    assert.deepEqual(encoderRecords.renderPasses[0].scissor, {
        x: 24,
        y: 4,
        width: 84,
        height: 54
    });
});

test('first-writer glass batch는 caller 요청으로 target을 투명 clear한다', () => {
    const { device } = createDevice();
    const { encoder, records: encoderRecords } = createEncoder();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });

    assert.equal(pass.encode(
        createContext(device, encoder),
        createInput({ clear: true })
    ), true);

    assert.equal(encoderRecords.renderPasses.length, 1);
    const attachment = encoderRecords.renderPasses[0]
        .descriptor.colorAttachments[0];
    assert.equal(attachment.loadOp, 'clear');
    assert.deepEqual({ ...attachment.clearValue }, { r: 0, g: 0, b: 0, a: 0 });
    const diagnostics = pass.getDiagnostics();
    assert.equal(diagnostics.clearBatchCount, 1);
    assert.equal(diagnostics.loadBatchCount, 0);
    assert.equal(diagnostics.lastBatchLoadOp, 'clear');

    assert.throws(
        () => pass.encode(
            createContext(device, createEncoder().encoder, { frameId: 101 }),
            createInput({ clear: 'yes' })
        ),
        /clear는 boolean/
    );
});

test('effect texture는 legacy 절대 rect를 panel-local로 바꾸고 premultiplied overlay 입력을 기록한다', () => {
    const { device, records: deviceRecords } = createDevice();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const effectTextureView = { kind: 'effect-texture-view' };
    const input = createInput({
        effectTextureView,
        effectTextureWidth: 512,
        effectTextureHeight: 256,
        effectTextureRect: { x: 150, y: 95, w: 120, h: 60 }
    });

    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder),
        input
    ), true);
    let floats = getWrittenFloats(deviceRecords);
    assert.deepEqual(
        Array.from(floats.slice(
            CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET + 4
        )),
        [512, 256, 1, 0]
    );
    assert.deepEqual(
        Array.from(floats.slice(
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET + 4
        )),
        [30, 15, 120, 60]
    );
    const entries = deviceRecords.bindGroups[0].descriptor.entries;
    assert.equal(entries[2].resource, input.backdropView);
    assert.equal(entries[3].resource, effectTextureView);

    const invalidRect = {
        w: 0,
        h: 60,
        get x() {
            throw new Error('invalid legacy rect must not read x');
        },
        get y() {
            throw new Error('invalid legacy rect must not read y');
        }
    };
    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 101 }),
        { ...input, effectTextureRect: invalidRect }
    ), true);
    floats = getWrittenFloats(deviceRecords);
    assert.deepEqual(
        Array.from(floats.slice(
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET,
            CONSTANTS.EFFECT_TEXTURE_RECT_OFFSET + 4
        )),
        [0, 0, 240, 120]
    );
});

test('encodeBatch는 panel별 backdrop/effect/scissor 순서를 한 render pass에 보존하고 Y-flip flag를 기록한다', () => {
    const { device, records: deviceRecords } = createDevice();
    const { encoder, records: encoderRecords } = createEncoder();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const base = createInput();
    const backdropA = { kind: 'backdrop-a' };
    const backdropB = { kind: 'backdrop-b' };
    const effectB = { kind: 'effect-b' };

    const drawCount = pass.encodeBatch(createContext(device, encoder), {
        targetView: base.targetView,
        targetWidth: base.targetWidth,
        targetHeight: base.targetHeight,
        entries: [{
            backdropView: backdropA,
            backdropWidth: 160,
            backdropHeight: 90,
            backdropLogicalBounds: { x: 0, y: 0, w: 320, h: 180 },
            panel: { ...base.panel, x: 20, y: 30, w: 120, h: 60 },
            opacity: 1
        }, {
            backdropView: backdropB,
            backdropWidth: 240,
            backdropHeight: 135,
            backdropLogicalBounds: { x: 100, y: 40, w: 480, h: 270 },
            effectTextureView: effectB,
            effectTextureWidth: 96,
            effectTextureHeight: 48,
            effectTextureFlipY: true,
            effectTextureRect: { x: 210, y: 110, w: 80, h: 40 },
            panel: { ...base.panel, x: 200, y: 100, w: 180, h: 90 },
            opacity: 0.75
        }, {
            get backdropView() {
                throw new Error('transparent panel must skip before backdrop validation');
            },
            panel: { ...base.panel, alpha: 0 }
        }, {
            backdropView: backdropA,
            backdropWidth: 160,
            backdropHeight: 90,
            backdropLogicalBounds: { x: 0, y: 0, w: 320, h: 180 },
            panel: { ...base.panel, x: 2000, y: 2000, w: 60, h: 40 }
        }]
    });

    assert.equal(drawCount, 2);
    assert.equal(encoderRecords.renderPasses.length, 1);
    const renderPass = encoderRecords.renderPasses[0];
    assert.equal(renderPass.bindGroups.length, 2);
    assert.equal(renderPass.draws.length, 2);
    assert.equal(renderPass.scissors.length, 2);
    assert.equal(
        renderPass.bindGroups[0].bindGroup.descriptor.entries[2].resource,
        backdropA
    );
    assert.equal(
        renderPass.bindGroups[1].bindGroup.descriptor.entries[2].resource,
        backdropB
    );
    assert.equal(
        renderPass.bindGroups[1].bindGroup.descriptor.entries[3].resource,
        effectB
    );
    assert.ok(renderPass.scissors[0].x < renderPass.scissors[1].x);
    assert.equal(
        getWrittenFloats(deviceRecords, 0)[CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET + 3],
        0
    );
    assert.equal(
        getWrittenFloats(deviceRecords, 1)[CONSTANTS.EFFECT_TEXTURE_PARAMETERS_OFFSET + 3],
        1
    );
    const diagnostics = pass.getDiagnostics();
    assert.equal(diagnostics.encodeCount, 2);
    assert.equal(diagnostics.batchEncodeCount, 1);
    assert.equal(diagnostics.renderPassCount, 1);
    assert.equal(diagnostics.skipCount, 2);
    assert.equal(diagnostics.lastBatchDrawCount, 2);
});

test('bind-group cache는 uniform/backdrop/effect view identity를 모두 구분한다', () => {
    const { device, records: deviceRecords } = createDevice();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const input = createInput();
    const effectA = { kind: 'effect-a' };
    const effectB = { kind: 'effect-b' };
    const backdropB = { kind: 'backdrop-b' };
    const encodeFrame = (frameId, overrides = {}) => pass.encode(
        createContext(device, createEncoder().encoder, { frameId }),
        { ...input, ...overrides }
    );

    assert.equal(encodeFrame(1), true);
    assert.equal(deviceRecords.bindGroups.length, 1);
    assert.equal(encodeFrame(2, {
        effectTextureView: effectA,
        effectTextureWidth: 128,
        effectTextureHeight: 64
    }), true);
    assert.equal(deviceRecords.bindGroups.length, 2);
    assert.equal(encodeFrame(3, {
        effectTextureView: effectA,
        effectTextureWidth: 128,
        effectTextureHeight: 64
    }), true);
    assert.equal(deviceRecords.bindGroups.length, 2);
    assert.equal(encodeFrame(4, {
        effectTextureView: effectB,
        effectTextureWidth: 128,
        effectTextureHeight: 64
    }), true);
    assert.equal(deviceRecords.bindGroups.length, 3);
    assert.equal(encodeFrame(5, {
        backdropView: backdropB,
        effectTextureView: effectA,
        effectTextureWidth: 128,
        effectTextureHeight: 64
    }), true);
    assert.equal(deviceRecords.bindGroups.length, 4);
    assert.equal(encodeFrame(6), true);
    assert.equal(deviceRecords.bindGroups.length, 4);

    const resources = deviceRecords.bindGroups.map((record) => record.descriptor.entries);
    assert.equal(resources[0][2].resource, input.backdropView);
    assert.equal(resources[0][3].resource, input.backdropView);
    assert.equal(resources[1][2].resource, input.backdropView);
    assert.equal(resources[1][3].resource, effectA);
    assert.equal(resources[2][3].resource, effectB);
    assert.equal(resources[3][2].resource, backdropB);
    assert.equal(resources[3][3].resource, effectA);
});

test('tilt transform과 projected quad는 역호모그래피로 복원되고 refraction/shadow halo가 scissor에 반영된다', () => {
    const { device, records: deviceRecords } = createDevice();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const firstEncoder = createEncoder();
    const cosine = Math.cos(0.24);
    const sine = Math.sin(0.24);
    const transformMatrix = [
        cosine, 0, -sine, 0,
        0, 1, 0, 0,
        sine, 0, cosine, 0,
        4, 5, 0, 1
    ];
    const tiltInput = createInput({
        panel: {
            ...createInput().panel,
            transformMatrix,
            perspective: 900,
            refractionStrength: 14,
            shadowRadius: 8,
            shadowOffsetX: 4,
            shadowOffsetY: -6,
            shadowColor: 'rgba(0,0,0,0.5)'
        }
    });

    assert.equal(pass.encode(
        createContext(device, firstEncoder.encoder),
        tiltInput
    ), true);
    const tiltFloats = getWrittenFloats(deviceRecords);
    const centerLocal = mapWithInverseUniform(tiltFloats, 244, 145);
    assertApproximately(centerLocal.x, 120, 0.03);
    assertApproximately(centerLocal.y, 60, 0.03);
    const tiltDiagnostics = pass.getDiagnostics();
    assert.equal(tiltDiagnostics.lastHalo, 31);
    assert.ok(tiltDiagnostics.lastScissor.width > tiltInput.panel.w);
    assert.ok(tiltDiagnostics.lastScissor.height > tiltInput.panel.h);
    assert.ok(tiltDiagnostics.lastScissor.x >= 0);
    assert.ok(tiltDiagnostics.lastScissor.y >= 0);

    const projectedQuad = [
        { x: 80, y: 60 },
        { x: 300, y: 80 },
        { x: 285, y: 220 },
        { x: 95, y: 205 }
    ];
    const secondEncoder = createEncoder();
    assert.equal(pass.encode(
        createContext(device, secondEncoder.encoder, { frameId: 101 }),
        createInput({
            panel: {
                ...createInput().panel,
                x: 500,
                y: 500,
                w: 200,
                h: 120,
                projectedQuad,
                refractionStrength: 0
            }
        })
    ), true);
    const quadFloats = getWrittenFloats(deviceRecords);
    const topLeft = mapWithInverseUniform(quadFloats, 80, 60);
    const bottomRight = mapWithInverseUniform(quadFloats, 285, 220);
    assertApproximately(topLeft.x, 0, 0.001);
    assertApproximately(topLeft.y, 0, 0.001);
    assertApproximately(bottomRight.x, 200, 0.002);
    assertApproximately(bottomRight.y, 120, 0.002);
    const quadScissor = secondEncoder.records.renderPasses[0].scissor;
    assert.ok(quadScissor.x < 80);
    assert.ok(quadScissor.y < 60);
    assert.ok(quadScissor.x + quadScissor.width > 285);
    assert.ok(quadScissor.y + quadScissor.height > 220);
});

test('warm pipeline과 uniform/bind-group high-water cache는 frame 사이에 재사용된다', () => {
    const { device, records: deviceRecords } = createDevice();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const input = createInput();

    assert.equal(deviceRecords.shaderModules.length, 1);
    assert.equal(deviceRecords.samplers.length, 1);
    assert.equal(deviceRecords.pipelines.length, 1);
    assert.equal(deviceRecords.buffers.length, 1);
    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 1 }),
        input
    ), true);
    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 2 }),
        input
    ), true);
    assert.equal(deviceRecords.buffers.length, 1);
    assert.equal(deviceRecords.bindGroups.length, 1);

    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 2 }),
        input
    ), true);
    assert.equal(deviceRecords.buffers.length, 2);
    assert.equal(deviceRecords.bindGroups.length, 2);
    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 3 }),
        input
    ), true);
    assert.equal(pass.encode(
        createContext(device, createEncoder().encoder, { frameId: 3 }),
        input
    ), true);
    assert.equal(deviceRecords.buffers.length, 2);
    assert.equal(deviceRecords.bindGroups.length, 2);
    assert.equal(deviceRecords.shaderModules.length, 1);
    assert.equal(deviceRecords.samplers.length, 1);
    assert.equal(deviceRecords.pipelines.length, 1);

    const diagnostics = pass.getDiagnostics();
    assert.equal(diagnostics.warmCacheReady, true);
    assert.equal(diagnostics.uniformBufferCount, 2);
    assert.equal(diagnostics.frameUniformCount, 2);
    assert.equal(diagnostics.encodeCount, 5);
    assert.equal(diagnostics.pipelineCreateCount, 1);
    assert.equal(diagnostics.uniformBufferCreateCount, 2);
    assert.equal(diagnostics.bindGroupCreateCount, 2);
});

test('device/generation/format drift는 fail-closed이고 destroy는 모든 warm buffer를 한 번만 정리한다', () => {
    const generationDevice = createDevice('generation-device');
    const generationPass = new TitleWebGpuOverlayGlassPass({
        device: generationDevice.device,
        format: 'rgba8unorm'
    });
    assert.equal(generationPass.encode(
        createContext(generationDevice.device, createEncoder().encoder, { deviceGeneration: 3 }),
        createInput()
    ), true);
    assert.throws(
        () => generationPass.encode(
            createContext(generationDevice.device, createEncoder().encoder, { deviceGeneration: 4 }),
            createInput()
        ),
        /advanced device generation/
    );
    assert.equal(generationPass.getDiagnostics().invalidated, true);
    assert.equal(generationPass.getDiagnostics().warmCacheReady, false);
    assert.equal(generationDevice.records.buffers[0].destroyCount, 1);
    assert.throws(
        () => generationPass.encode(
            createContext(generationDevice.device, createEncoder().encoder, { deviceGeneration: 3 }),
            createInput()
        ),
        /무효화된/
    );

    const identityDevice = createDevice('identity-device');
    const otherDevice = createDevice('other-device');
    const identityPass = new TitleWebGpuOverlayGlassPass({
        device: identityDevice.device,
        format: 'rgba8unorm'
    });
    assert.throws(
        () => identityPass.encode(
            createContext(otherDevice.device, createEncoder().encoder),
            createInput()
        ),
        /device identity drift/
    );
    assert.equal(identityPass.getDiagnostics().invalidated, true);

    const formatDevice = createDevice('format-device');
    const formatPass = new TitleWebGpuOverlayGlassPass({
        device: formatDevice.device,
        format: 'rgba8unorm'
    });
    assert.throws(
        () => formatPass.encode(
            createContext(formatDevice.device, createEncoder().encoder, { format: 'bgra8unorm' }),
            createInput()
        ),
        /target format drift/
    );

    const destroyDevice = createDevice('destroy-device');
    const destroyPass = new TitleWebGpuOverlayGlassPass({
        device: destroyDevice.device,
        format: 'rgba8unorm'
    });
    assert.equal(destroyPass.destroy(), true);
    assert.equal(destroyPass.destroy(), false);
    assert.equal(destroyDevice.records.buffers[0].destroyCount, 1);
    assert.equal(destroyPass.getDiagnostics().destroyed, true);
    assert.equal(destroyPass.getDiagnostics().uniformBufferCount, 0);
    assert.throws(
        () => destroyPass.encode(
            createContext(destroyDevice.device, createEncoder().encoder),
            createInput()
        ),
        /destroy된/
    );
});

test('투명·퇴화·화면 밖 패널은 render pass 없이 안전하게 skip된다', () => {
    const { device, records: deviceRecords } = createDevice();
    const pass = new TitleWebGpuOverlayGlassPass({ device, format: 'rgba8unorm' });
    const encoderRecord = createEncoder();
    const context = createContext(device, encoderRecord.encoder);

    assert.equal(pass.encode(context, createInput({ opacity: 0 })), false);
    assert.equal(pass.encode(context, createInput({ panel: { x: 0, y: 0, w: 0, h: 20 } })), false);
    assert.equal(pass.encode(context, createInput({
        panel: { x: 2000, y: 2000, w: 100, h: 100, fill: '#fff' }
    })), false);
    assert.equal(encoderRecord.records.renderPasses.length, 0);
    assert.equal(deviceRecords.writes.length, 0);
    assert.equal(pass.getDiagnostics().skipCount, 3);
});
