import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const enemyPassModule = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_pass.js'
);
const enemyAtlasModule = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_shape_atlas.js'
);
const adapterModule = await loadGameModule(
    'scene/title/webgpu/_title_cpu_enemy_presentation_adapter.js'
);

const {
    TitleWebGpuEnemyPass,
    TITLE_WEBGPU_ENEMY_PASS_CONSTANTS,
    TITLE_WEBGPU_ENEMY_SHADER
} = enemyPassModule;
const {
    TitleWebGpuEnemyShapeAtlas,
    TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS,
    TITLE_WEBGPU_ENEMY_SHAPE_KEYS
} = enemyAtlasModule;
const {
    TitleCpuEnemyPresentationAdapter,
    TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS
} = adapterModule;

const passSourceUrl = new URL(
    '../script/module/scene/title/webgpu/_title_webgpu_enemy_pass.js',
    import.meta.url
);
const atlasSourceUrl = new URL(
    '../script/module/scene/title/webgpu/_title_webgpu_enemy_shape_atlas.js',
    import.meta.url
);
const [passSource, atlasSource] = await Promise.all([
    readFile(passSourceUrl, 'utf8'),
    readFile(atlasSourceUrl, 'utf8')
]);

const TEST_PALETTE = Object.freeze([
    Object.freeze([0.10, 0.20, 0.30, 0.40]),
    Object.freeze([0.11, 0.21, 0.31, 0.41]),
    Object.freeze([0.50, 0.60, 0.70, 0.80]),
    Object.freeze([0.51, 0.61, 0.71, 0.81]),
    Object.freeze([0.20, 0.40, 0.60, 1.00]),
    Object.freeze([0.21, 0.41, 0.61, 0.91])
]);

function createRasterHarness() {
    const records = {
        canvasCreateCount: 0,
        canvasDimensions: [],
        clearCalls: [],
        fillStyles: [],
        shapeCalls: []
    };
    let fillStyle = '';
    const context = {
        clearRect(...args) {
            records.clearCalls.push(args);
        },
        get fillStyle() {
            return fillStyle;
        },
        set fillStyle(value) {
            fillStyle = value;
            records.fillStyles.push(value);
        }
    };
    const canvas = {
        width: 0,
        height: 0,
        getContext(type) {
            assert.equal(type, '2d');
            return context;
        }
    };

    return {
        records,
        atlasOptions: {
            canvasFactory(width, height) {
                records.canvasCreateCount += 1;
                records.canvasDimensions.push([width, height]);
                return canvas;
            },
            shapeDrawerFactory() {
                return {
                    drawShape(ctx, shape, x, y, size) {
                        assert.strictEqual(ctx, context);
                        records.shapeCalls.push({ shape, x, y, size });
                    }
                };
            }
        }
    };
}

function createFakeGpu(label = 'device') {
    let nextId = 1;
    const records = {
        label,
        buffers: [],
        textures: [],
        textureViews: [],
        shaders: [],
        samplers: [],
        pipelines: [],
        bindGroups: [],
        writes: [],
        copies: [],
        forbiddenCalls: []
    };

    const queue = {
        writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
            const elementByteSize = ArrayBuffer.isView(data)
                ? data.BYTES_PER_ELEMENT
                : 1;
            const sourceElementLength = ArrayBuffer.isView(data)
                ? data.length
                : data.byteLength;
            const resolvedDataOffset = dataOffset ?? 0;
            const resolvedSize = size ?? (sourceElementLength - resolvedDataOffset);
            const writtenByteLength = resolvedSize * elementByteSize;
            assert.ok(
                resolvedDataOffset + resolvedSize <= sourceElementLength,
                'writeBuffer source span이 data 범위를 벗어났습니다.'
            );
            assert.ok(
                bufferOffset + writtenByteLength <= buffer.descriptor.size,
                'writeBuffer destination span이 GPUBuffer 크기를 벗어났습니다.'
            );
            records.writes.push({
                buffer,
                bufferOffset,
                data,
                dataOffset,
                size,
                writtenByteLength,
                snapshot: buffer.label.includes('uniform')
                    ? Array.from(data)
                    : null
            });
        },
        copyExternalImageToTexture(source, destination, size) {
            records.copies.push({ source, destination, size });
        },
        submit() {
            records.forbiddenCalls.push('queue.submit');
            throw new Error('pass가 queue.submit()을 호출했습니다.');
        }
    };
    const device = {
        queue,
        createShaderModule(descriptor) {
            const shader = { id: nextId++, descriptor };
            records.shaders.push(shader);
            return shader;
        },
        createSampler(descriptor) {
            const sampler = { id: nextId++, descriptor };
            records.samplers.push(sampler);
            return sampler;
        },
        createRenderPipeline(descriptor) {
            const pipeline = {
                id: nextId++,
                descriptor,
                getBindGroupLayout(index) {
                    return { pipeline, index };
                }
            };
            records.pipelines.push(pipeline);
            return pipeline;
        },
        createBuffer(descriptor) {
            const buffer = {
                id: nextId++,
                label: descriptor.label,
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                }
            };
            records.buffers.push(buffer);
            return buffer;
        },
        createBindGroup(descriptor) {
            const bindGroup = { id: nextId++, descriptor };
            records.bindGroups.push(bindGroup);
            return bindGroup;
        },
        createTexture(descriptor) {
            const texture = {
                id: nextId++,
                label: descriptor.label,
                descriptor,
                destroyCount: 0,
                createView(viewDescriptor) {
                    const view = {
                        id: nextId++,
                        texture,
                        descriptor: viewDescriptor
                    };
                    records.textureViews.push(view);
                    return view;
                },
                destroy() {
                    this.destroyCount += 1;
                }
            };
            records.textures.push(texture);
            return texture;
        },
        createCommandEncoder() {
            records.forbiddenCalls.push('device.createCommandEncoder');
            throw new Error('pass가 device.createCommandEncoder()를 호출했습니다.');
        }
    };
    return { device, records };
}

function createFakeEncoder() {
    const records = { passes: [], forbiddenCalls: [] };
    const encoder = {
        beginRenderPass(descriptor) {
            const passRecord = { descriptor, commands: [] };
            records.passes.push(passRecord);
            return {
                setPipeline(pipeline) {
                    passRecord.commands.push(['setPipeline', pipeline]);
                },
                setBindGroup(index, bindGroup) {
                    passRecord.commands.push(['setBindGroup', index, bindGroup]);
                },
                draw(...args) {
                    passRecord.commands.push(['draw', ...args]);
                },
                end() {
                    passRecord.commands.push(['end']);
                }
            };
        },
        finish() {
            records.forbiddenCalls.push('encoder.finish');
            throw new Error('pass가 encoder.finish()를 호출했습니다.');
        }
    };
    return { encoder, records };
}

function createPacket(recordCount, styleCodes = []) {
    const adapter = new TitleCpuEnemyPresentationAdapter();
    const packet = adapter.writePacket([], []);
    packet.recordCount = recordCount;
    packet.usedByteLength = recordCount * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
    for (let index = 0; index < recordCount; index++) {
        const offset = index * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS;
        packet.records[offset] = 100 + index;
        packet.records[offset + 1] = 200 + index;
        packet.records[offset + 2] = 30;
        packet.records[offset + 3] = 24;
        packet.records[offset + 4] = 1;
        packet.records[offset + 5] = 0;
        packet.records[offset + 6] = 0.5;
        packet.records[offset + 7] = styleCodes[index]
            ?? (index % TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.SHAPE_COUNT);
    }
    return packet;
}

function createContext(device, frameId, deviceGeneration, encoder, format = 'rgba8unorm') {
    return {
        frameId,
        device,
        deviceGeneration,
        encoder,
        target: { id: `canvas-${frameId}` },
        format,
        width: 1920,
        height: 1080
    };
}

function createPass(atlasOptions) {
    return new TitleWebGpuEnemyPass({ atlasOptions });
}

test('enemy atlas는 packet shape code와 같은 8개 ShapeDrawer mask를 세대당 한 번 업로드한다', () => {
    const raster = createRasterHarness();
    const firstGpu = createFakeGpu('first');
    const secondGpu = createFakeGpu('second');
    const atlas = new TitleWebGpuEnemyShapeAtlas(raster.atlasOptions);

    assert.deepEqual(Array.from(TITLE_WEBGPU_ENEMY_SHAPE_KEYS), [
        'enemy_square',
        'enemy_triangle',
        'enemy_arrow',
        'enemy_hexa',
        'enemy_penta',
        'enemy_rhom',
        'enemy_octa',
        'enemy_jorang'
    ]);
    const first = atlas.ensure(firstGpu.device, 3);
    assert.strictEqual(atlas.ensure(firstGpu.device, 3), first);
    assert.equal(raster.records.canvasCreateCount, 1);
    assert.deepEqual(raster.records.canvasDimensions, [[
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.WIDTH,
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.HEIGHT
    ]]);
    assert.deepEqual(raster.records.shapeCalls, Array.from(TITLE_WEBGPU_ENEMY_SHAPE_KEYS,
        (shape, index) => ({
            shape,
            x: index * TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.CELL_SIZE,
            y: 0,
            size: TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.CELL_SIZE
        })
    ));
    assert.deepEqual(raster.records.fillStyles, ['#FFFFFF']);
    assert.equal(firstGpu.records.textures.length, 1);
    assert.equal(firstGpu.records.textures[0].descriptor.usage, 0x02 | 0x04 | 0x10);
    assert.equal(firstGpu.records.copies.length, 1);

    const second = atlas.ensure(secondGpu.device, 4);
    assert.notStrictEqual(second, first);
    assert.equal(firstGpu.records.textures[0].destroyCount, 1);
    assert.equal(secondGpu.records.textures.length, 1);
    assert.equal(secondGpu.records.copies.length, 1);
    assert.equal(raster.records.shapeCalls.length, 8, 'CPU mask raster는 generation 사이에도 재사용합니다.');
    assert.throws(() => atlas.ensure(firstGpu.device, 3), /stale/u);
    assert.equal(atlas.destroy(), true);
    assert.equal(atlas.destroy(), false);
    assert.equal(secondGpu.records.textures[0].destroyCount, 1);
});

test('32-byte packet을 그대로 업로드하고 packet 순서의 단일 instanced draw로 합성한다', () => {
    const raster = createRasterHarness();
    const gpu = createFakeGpu();
    const encoded = createFakeEncoder();
    const pass = createPass(raster.atlasOptions);
    const styleCodes = [
        0,
        1 | 0x8,
        2 | (1 << 4),
        3 | 0x8 | (2 << 4)
    ];
    const packet = createPacket(styleCodes.length, styleCodes);
    const targetView = { id: 'scene-target' };

    assert.equal(pass.encode(
        createContext(gpu.device, 20, 5, encoded.encoder),
        {
            packet,
            targetView,
            targetWidth: 1920,
            targetHeight: 1080,
            palette: TEST_PALETTE
        }
    ), true);

    const recordBuffer = gpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-record-buffer'
    );
    assert.ok(recordBuffer);
    assert.equal(recordBuffer.descriptor.size, TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.RECORD_BUFFER_BYTE_SIZE);
    const recordWrite = gpu.records.writes.find((write) => write.buffer === recordBuffer);
    assert.strictEqual(recordWrite.data, packet.records);
    assert.equal(recordWrite.bufferOffset, 0);
    assert.equal(recordWrite.dataOffset, 0);
    assert.equal(recordWrite.size, styleCodes.length * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS);
    assert.equal(
        recordWrite.writtenByteLength,
        styleCodes.length * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES
    );

    assert.equal(encoded.records.passes.length, 1);
    const renderPass = encoded.records.passes[0];
    assert.strictEqual(renderPass.descriptor.colorAttachments[0].view, targetView);
    assert.equal(renderPass.descriptor.colorAttachments[0].loadOp, 'load');
    assert.deepEqual(renderPass.commands.map((command) => command[0]), [
        'setPipeline',
        'setBindGroup',
        'draw',
        'end'
    ]);
    assert.deepEqual(renderPass.commands[2], ['draw', 6, styleCodes.length, 0, 0]);
    assert.match(TITLE_WEBGPU_ENEMY_SHADER, /records\[instanceIndex\]/u);
    assert.match(TITLE_WEBGPU_ENEMY_SHADER, /shapeCode\s*=\s*styleCode\s*&\s*SHAPE_MASK/u);
    assert.match(TITLE_WEBGPU_ENEMY_SHADER, /styleCode\s*&\s*SOFTNESS_BIT/u);
    assert.match(TITLE_WEBGPU_ENEMY_SHADER, /layerIndex\s*=\s*styleCode\s*>>\s*LAYER_SHIFT/u);
    assert.match(TITLE_WEBGPU_ENEMY_SHADER, /paletteIndex\s*=\s*\(safeLayerIndex\s*\*\s*2u\)\s*\+\s*softnessIndex/u);

    const pipelineTarget = gpu.records.pipelines[0].descriptor.fragment.targets[0];
    assert.deepEqual({ ...pipelineTarget.blend.color }, {
        operation: 'add',
        srcFactor: 'one',
        dstFactor: 'one-minus-src-alpha'
    });
    assert.deepEqual(
        { ...pipelineTarget.blend.alpha },
        { ...pipelineTarget.blend.color }
    );
    assert.equal(gpu.records.forbiddenCalls.length, 0);
    assert.equal(encoded.records.forbiddenCalls.length, 0);
});

test('palette uniform은 layer별 core→softness 순서를 보존하고 shader에서 premultiplied alpha로 적용한다', () => {
    const raster = createRasterHarness();
    const gpu = createFakeGpu();
    const encoded = createFakeEncoder();
    const pass = createPass(raster.atlasOptions);

    pass.encode(createContext(gpu.device, 1, 0, encoded.encoder), {
        packet: createPacket(1, [0x8 | (2 << 4) | 6]),
        targetView: {},
        targetWidth: 1280,
        targetHeight: 720,
        palette: TEST_PALETTE
    });

    const uniformWrite = gpu.records.writes.find(
        (write) => write.buffer.label === 'title-webgpu-enemy-uniform-buffer'
    );
    assert.deepEqual(uniformWrite.snapshot.slice(0, 4), [
        1280,
        720,
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.WIDTH,
        TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.HEIGHT
    ]);
    const expectedPalette = TEST_PALETTE.flat().map(Math.fround);
    assert.deepEqual(uniformWrite.snapshot.slice(4), expectedPalette);
    assert.match(
        TITLE_WEBGPU_ENEMY_SHADER,
        /alpha\s*=\s*clamp\(record\.rotationAlphaStyle\.z[\s\S]*sourceColor\.a/u
    );
    assert.match(
        TITLE_WEBGPU_ENEMY_SHADER,
        /vec4<f32>\(input\.paletteColor\.rgb\s*\*\s*alpha,\s*alpha\)/u
    );
});

test('840-record 고정 buffer를 재사용하며 매 frame 실제 written span만 업로드한다', () => {
    const raster = createRasterHarness();
    const gpu = createFakeGpu();
    const pass = createPass(raster.atlasOptions);
    const packet = createPacket(TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS);

    const firstEncoder = createFakeEncoder();
    pass.encode(createContext(gpu.device, 7, 2, firstEncoder.encoder), {
        packet,
        targetView: {},
        targetWidth: 2560,
        targetHeight: 1440,
        palette: TEST_PALETTE
    });
    const recordBuffer = gpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-record-buffer'
    );
    const firstRecordWrite = gpu.records.writes.find((write) => write.buffer === recordBuffer);
    assert.equal(firstRecordWrite.size, 840 * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS);
    assert.equal(firstRecordWrite.writtenByteLength, 840 * 32);
    assert.deepEqual(firstEncoder.records.passes[0].commands[2], ['draw', 6, 840, 0, 0]);

    packet.recordCount = 2;
    packet.usedByteLength = 2 * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
    const secondEncoder = createFakeEncoder();
    pass.encode(createContext(gpu.device, 8, 2, secondEncoder.encoder), {
        packet,
        targetView: {},
        targetWidth: 2560,
        targetHeight: 1440,
        palette: TEST_PALETTE
    });
    const recordWrites = gpu.records.writes.filter((write) => write.buffer === recordBuffer);
    assert.equal(recordWrites.length, 2);
    assert.strictEqual(recordWrites[1].buffer, recordBuffer);
    assert.strictEqual(recordWrites[1].data, packet.records);
    assert.equal(recordWrites[1].size, 2 * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS);
    assert.equal(recordWrites[1].writtenByteLength, 64);

    packet.recordCount = 841;
    packet.usedByteLength = 841 * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
    assert.throws(() => pass.encode(
        createContext(gpu.device, 9, 2, createFakeEncoder().encoder),
        {
            packet,
            targetView: {},
            targetWidth: 2560,
            targetHeight: 1440,
            palette: TEST_PALETTE
        }
    ), /recordCount/u);
});

test('warm frame과 resize는 GPU resource를 만들지 않고 format/generation 경계에서만 갱신한다', () => {
    const raster = createRasterHarness();
    const firstGpu = createFakeGpu('first');
    const pass = createPass(raster.atlasOptions);
    const packet = createPacket(3);
    const input = {
        packet,
        targetView: {},
        targetWidth: 1920,
        targetHeight: 1080,
        palette: TEST_PALETTE
    };

    pass.encode(
        createContext(firstGpu.device, 100, 9, createFakeEncoder().encoder),
        input
    );
    const warmCounts = {
        buffers: firstGpu.records.buffers.length,
        textures: firstGpu.records.textures.length,
        shaders: firstGpu.records.shaders.length,
        samplers: firstGpu.records.samplers.length,
        pipelines: firstGpu.records.pipelines.length,
        bindGroups: firstGpu.records.bindGroups.length,
        copies: firstGpu.records.copies.length,
        rasterShapes: raster.records.shapeCalls.length
    };
    pass.encode(
        createContext(firstGpu.device, 101, 9, createFakeEncoder().encoder),
        { ...input, targetWidth: 2560, targetHeight: 1440 }
    );
    assert.deepEqual({
        buffers: firstGpu.records.buffers.length,
        textures: firstGpu.records.textures.length,
        shaders: firstGpu.records.shaders.length,
        samplers: firstGpu.records.samplers.length,
        pipelines: firstGpu.records.pipelines.length,
        bindGroups: firstGpu.records.bindGroups.length,
        copies: firstGpu.records.copies.length,
        rasterShapes: raster.records.shapeCalls.length
    }, warmCounts);

    pass.encode(
        createContext(firstGpu.device, 102, 9, createFakeEncoder().encoder, 'bgra8unorm'),
        { ...input, format: 'bgra8unorm' }
    );
    assert.equal(firstGpu.records.pipelines.length, warmCounts.pipelines + 1);
    assert.equal(firstGpu.records.bindGroups.length, warmCounts.bindGroups + 1);
    assert.equal(firstGpu.records.buffers.length, warmCounts.buffers);
    assert.equal(firstGpu.records.textures.length, warmCounts.textures);

    const driftGpu = createFakeGpu('drift');
    assert.throws(() => pass.encode(
        createContext(driftGpu.device, 103, 9, createFakeEncoder().encoder),
        input
    ), /device drift/u);
    assert.equal(driftGpu.records.buffers.length, 0);

    const oldRecordBuffer = firstGpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-record-buffer'
    );
    const oldUniformBuffer = firstGpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-uniform-buffer'
    );
    const oldTexture = firstGpu.records.textures[0];
    const secondGpu = createFakeGpu('second');
    pass.encode(
        createContext(secondGpu.device, 104, 10, createFakeEncoder().encoder),
        input
    );
    assert.equal(oldRecordBuffer.destroyCount, 1);
    assert.equal(oldUniformBuffer.destroyCount, 1);
    assert.equal(oldTexture.destroyCount, 1);
    assert.equal(secondGpu.records.buffers.length, 2);
    assert.equal(secondGpu.records.textures.length, 1);
    assert.equal(secondGpu.records.copies.length, 1);
    assert.equal(raster.records.shapeCalls.length, 8);
    assert.throws(() => pass.encode(
        createContext(firstGpu.device, 105, 9, createFakeEncoder().encoder),
        input
    ), /stale/u);

    assert.equal(pass.destroy(), true);
    assert.equal(pass.destroy(), false);
    assert.equal(secondGpu.records.buffers.every((buffer) => buffer.destroyCount === 1), true);
    assert.equal(secondGpu.records.textures[0].destroyCount, 1);
    assert.throws(() => pass.encode(
        createContext(secondGpu.device, 106, 10, createFakeEncoder().encoder),
        input
    ), /destroy/u);
});

test('empty packet은 target/atlas/resource를 건드리지 않고 same-frame 이중 encode는 거부한다', () => {
    const raster = createRasterHarness();
    const gpu = createFakeGpu();
    const pass = createPass(raster.atlasOptions);
    const emptyPacket = createPacket(0);
    const emptyEncoder = createFakeEncoder();
    assert.equal(pass.encode(
        createContext(gpu.device, 1, 0, emptyEncoder.encoder),
        { packet: emptyPacket }
    ), false);
    assert.equal(gpu.records.buffers.length, 0);
    assert.equal(gpu.records.textures.length, 0);
    assert.equal(gpu.records.writes.length, 0);
    assert.equal(emptyEncoder.records.passes.length, 0);

    const input = {
        packet: createPacket(1),
        targetView: {},
        targetWidth: 800,
        targetHeight: 600,
        palette: TEST_PALETTE
    };
    pass.encode(createContext(gpu.device, 2, 0, createFakeEncoder().encoder), input);
    assert.throws(() => pass.encode(
        createContext(gpu.device, 2, 0, createFakeEncoder().encoder),
        input
    ), /프레임당 한 번/u);
});

test('enemy pass와 atlas는 composer의 presentation 소유 API를 호출하지 않는다', () => {
    const combinedSource = `${passSource}\n${atlasSource}`;
    assert.doesNotMatch(combinedSource, /\bgetCurrentTexture\s*\(/u);
    assert.doesNotMatch(combinedSource, /\bcreateCommandEncoder\s*\(/u);
    assert.doesNotMatch(combinedSource, /\.finish\s*\(/u);
    assert.doesNotMatch(combinedSource, /\.submit\s*\(/u);
    assert.doesNotMatch(combinedSource, /\bmarkCanvas(?:Drawn|Cleared)\s*\(/u);
    assert.equal(TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.MAX_RECORDS, 840);
    assert.equal(TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.RECORD_STRIDE_BYTES, 32);
});
