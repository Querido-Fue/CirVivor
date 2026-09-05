import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const enemyPassNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_pass.js'
);
const shieldPassNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_shield_pass.js'
);
const shieldInteractionAbiNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_shield_interaction_abi.js'
);

const {
    TitleWebGpuEnemyPass,
    TITLE_WEBGPU_ENEMY_PASS_CONSTANTS
} = enemyPassNamespace;
const {
    TitleWebGpuShieldPass,
    TITLE_WEBGPU_SHIELD_PASS_CONSTANTS
} = shieldPassNamespace;
const { TITLE_WEBGPU_SHIELD_INTERACTION_ABI } = shieldInteractionAbiNamespace;

const ENEMY_RECORD_FLOATS = TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.RECORD_STRIDE_BYTES
    / Float32Array.BYTES_PER_ELEMENT;
const LEGACY_SHIELD_COUNT_BYTE_OFFSET = 10 * Uint32Array.BYTES_PER_ELEMENT;
const LEGACY_SHIELD_COUNT_BYTE_SIZE = 2 * Uint32Array.BYTES_PER_ELEMENT;
const LEGACY_SHIELD_IMPACT_BYTE_OFFSET = 28 * Float32Array.BYTES_PER_ELEMENT;
const LEGACY_SHIELD_DENT_BYTE_OFFSET = LEGACY_SHIELD_IMPACT_BYTE_OFFSET
    + TITLE_WEBGPU_SHIELD_INTERACTION_ABI.IMPACT_BYTE_SIZE;
const TEST_PALETTE = Object.freeze([
    Object.freeze([0.10, 0.20, 0.30, 0.40]),
    Object.freeze([0.11, 0.21, 0.31, 0.41]),
    Object.freeze([0.50, 0.60, 0.70, 0.80]),
    Object.freeze([0.51, 0.61, 0.71, 0.81]),
    Object.freeze([0.20, 0.40, 0.60, 1.00]),
    Object.freeze([0.21, 0.41, 0.61, 0.91])
]);

function snapshotBytes(data, dataOffset = 0, size = undefined) {
    const source = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
    const elementByteSize = ArrayBuffer.isView(data) ? data.BYTES_PER_ELEMENT : 1;
    const byteOffset = dataOffset * elementByteSize;
    const byteLength = size === undefined
        ? source.byteLength - byteOffset
        : size * elementByteSize;
    return source.slice(byteOffset, byteOffset + byteLength);
}

function createRasterOptions() {
    const context = {
        clearRect() {},
        set fillStyle(_value) {}
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
        canvasFactory() {
            return canvas;
        },
        shapeDrawerFactory() {
            return { drawShape() {} };
        }
    };
}

function createGpuBufferIdentity(id) {
    return {
        id,
        mapAsync() {
            throw new Error(`${id} readback은 허용되지 않습니다.`);
        },
        getMappedRange() {
            throw new Error(`${id} mapped range 접근은 허용되지 않습니다.`);
        }
    };
}

function createFakeDevice(id = 'device') {
    let nextId = 0;
    const records = {
        buffers: [],
        writes: [],
        externalCopies: [],
        forbiddenCalls: []
    };
    const device = {
        queue: {
            writeBuffer(buffer, bufferOffset, data, dataOffset, size) {
                records.writes.push({
                    buffer,
                    bufferOffset,
                    dataOffset,
                    size,
                    bytes: snapshotBytes(data, dataOffset, size)
                });
            },
            copyExternalImageToTexture(source, destination, copySize) {
                records.externalCopies.push({ source, destination, copySize });
            },
            submit() {
                records.forbiddenCalls.push('queue.submit');
                throw new Error('bridge pass가 queue.submit()을 호출했습니다.');
            },
            onSubmittedWorkDone() {
                records.forbiddenCalls.push('queue.onSubmittedWorkDone');
                throw new Error('bridge pass가 queue 완료를 대기했습니다.');
            }
        },
        createShaderModule(descriptor) {
            return { id: `${id}:shader:${nextId++}`, descriptor };
        },
        createSampler(descriptor) {
            return { id: `${id}:sampler:${nextId++}`, descriptor };
        },
        createRenderPipeline(descriptor) {
            const pipeline = {
                id: `${id}:pipeline:${nextId++}`,
                descriptor,
                getBindGroupLayout(index) {
                    return { pipeline, index };
                }
            };
            return pipeline;
        },
        createBindGroup(descriptor) {
            return { id: `${id}:bind-group:${nextId++}`, descriptor };
        },
        createBuffer(descriptor) {
            const buffer = {
                id: `${id}:buffer:${nextId++}`,
                label: descriptor.label,
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                },
                mapAsync() {
                    records.forbiddenCalls.push(`buffer.mapAsync:${descriptor.label}`);
                    throw new Error('bridge pass가 buffer readback을 시작했습니다.');
                },
                getMappedRange() {
                    records.forbiddenCalls.push(`buffer.getMappedRange:${descriptor.label}`);
                    throw new Error('bridge pass가 mapped range를 읽었습니다.');
                }
            };
            records.buffers.push(buffer);
            return buffer;
        },
        createTexture(descriptor) {
            const texture = {
                id: `${id}:texture:${nextId++}`,
                descriptor,
                createView(viewDescriptor) {
                    return { texture, descriptor: viewDescriptor };
                },
                destroy() {}
            };
            return texture;
        },
        createCommandEncoder() {
            records.forbiddenCalls.push('device.createCommandEncoder');
            throw new Error('bridge pass가 command encoder를 생성했습니다.');
        }
    };
    return { device, records };
}

function createFakeEncoder({ supportCopy = true } = {}) {
    const records = {
        copies: [],
        passes: [],
        forbiddenCalls: []
    };
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
                setViewport(...args) {
                    passRecord.commands.push(['setViewport', ...args]);
                },
                setScissorRect(...args) {
                    passRecord.commands.push(['setScissorRect', ...args]);
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
            throw new Error('bridge pass가 encoder.finish()를 호출했습니다.');
        }
    };
    if (supportCopy) {
        encoder.copyBufferToBuffer = (...args) => {
            records.copies.push(args);
        };
    }
    return { encoder, records };
}

function createContext(device, encoder, frameId = 1) {
    return {
        device,
        deviceGeneration: 3,
        frameId,
        format: 'rgba8unorm',
        encoder
    };
}

function createGpuEnemyPacket(gpuSourceBuffer, recordCount = 3) {
    return {
        gpuSourceBuffer,
        recordCount,
        usedByteLength: recordCount
            * TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.RECORD_STRIDE_BYTES,
        recordStrideFloats: ENEMY_RECORD_FLOATS,
        recordStrideBytes: TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.RECORD_STRIDE_BYTES,
        maxRecordCount: TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.MAX_RECORDS
    };
}

function createInactiveShieldCommand(overrides = {}) {
    return {
        x: 400,
        y: 300,
        radius: 64,
        fieldRadius: 180,
        time: 2,
        alpha: 0.8,
        ringThickness: 3,
        glowWidth: 20,
        impacts: [],
        dents: [],
        ...overrides
    };
}

test('enemy GPU source는 CPU record upload 없이 used span만 복사한 뒤 기존 instance 수로 draw한다', () => {
    const gpu = createFakeDevice('enemy');
    const encoded = createFakeEncoder();
    const sourceBuffer = createGpuBufferIdentity('enemy-source');
    const packet = createGpuEnemyPacket(sourceBuffer, 7);
    const pass = new TitleWebGpuEnemyPass({ atlasOptions: createRasterOptions() });

    assert.equal(pass.encode(
        createContext(gpu.device, encoded.encoder, 10),
        {
            packet,
            targetView: { id: 'enemy-target' },
            targetWidth: 1280,
            targetHeight: 720,
            palette: TEST_PALETTE
        }
    ), true);

    const recordBuffer = gpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-record-buffer'
    );
    const uniformBuffer = gpu.records.buffers.find(
        (buffer) => buffer.label === 'title-webgpu-enemy-uniform-buffer'
    );
    assert.ok(recordBuffer);
    assert.ok(uniformBuffer);
    assert.deepEqual(encoded.records.copies, [[
        sourceBuffer,
        0,
        recordBuffer,
        0,
        packet.usedByteLength
    ]]);
    assert.equal(
        gpu.records.writes.some((write) => write.buffer === recordBuffer),
        false,
        'GPU record source가 있으면 record buffer를 CPU queue.writeBuffer로 덮지 않습니다.'
    );
    assert.equal(gpu.records.writes.length, 1);
    assert.strictEqual(gpu.records.writes[0].buffer, uniformBuffer);
    assert.deepEqual(
        encoded.records.passes[0].commands.find((command) => command[0] === 'draw'),
        ['draw', 6, packet.recordCount, 0, 0]
    );
    assert.equal(pass.getDiagnostics().gpuRecordCopyCount, 1);
    assert.deepEqual(gpu.records.forbiddenCalls, []);
    assert.deepEqual(encoded.records.forbiddenCalls, []);
});

test('compact shield buffer는 비활성 CPU command를 활성화하고 legacy 560B uniform의 세 span에 복사된다', () => {
    const gpu = createFakeDevice('shield');
    const encoded = createFakeEncoder();
    const sourceBuffer = createGpuBufferIdentity('shield-interactions');
    const pass = new TitleWebGpuShieldPass();
    const command = createInactiveShieldCommand();

    assert.equal(pass.encode(
        createContext(gpu.device, encoded.encoder, 20),
        {
            command,
            gpuInteractionBuffer: sourceBuffer,
            targetView: { id: 'shield-target' },
            targetWidth: 800,
            targetHeight: 600
        }
    ), true);

    const uniformBuffer = gpu.records.buffers.find(
        (buffer) => buffer.label === 'title-magnetic-shield-uniform:0'
    );
    assert.ok(uniformBuffer);
    assert.equal(
        uniformBuffer.descriptor.size,
        TITLE_WEBGPU_SHIELD_PASS_CONSTANTS.UNIFORM_BYTE_SIZE
    );
    assert.equal(TITLE_WEBGPU_SHIELD_PASS_CONSTANTS.UNIFORM_BYTE_SIZE, 560);
    assert.equal(TITLE_WEBGPU_SHIELD_INTERACTION_ABI.BYTE_SIZE, 464);
    assert.deepEqual(encoded.records.copies, [
        [
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.HEADER_BYTE_OFFSET,
            uniformBuffer,
            LEGACY_SHIELD_COUNT_BYTE_OFFSET,
            LEGACY_SHIELD_COUNT_BYTE_SIZE
        ],
        [
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.IMPACT_BYTE_OFFSET,
            uniformBuffer,
            LEGACY_SHIELD_IMPACT_BYTE_OFFSET,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.IMPACT_BYTE_SIZE
        ],
        [
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.DENT_BYTE_OFFSET,
            uniformBuffer,
            LEGACY_SHIELD_DENT_BYTE_OFFSET,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.DENT_BYTE_SIZE
        ]
    ]);
    assert.equal(gpu.records.writes.length, 1);
    assert.strictEqual(gpu.records.writes[0].buffer, uniformBuffer);
    const cpuUniformCounts = new Uint32Array(gpu.records.writes[0].bytes.buffer);
    assert.equal(cpuUniformCounts[10], 0);
    assert.equal(cpuUniformCounts[11], 0);
    assert.deepEqual(
        encoded.records.passes[0].commands.find((entry) => entry[0] === 'draw'),
        ['draw', 3, 1, 0, 0]
    );
    assert.equal(pass.getDiagnostics().skipCount, 0);
    assert.deepEqual(gpu.records.forbiddenCalls, []);
    assert.deepEqual(encoded.records.forbiddenCalls, []);
});

test('GPU buffer identity와 composer encoder copy 계약이 잘못되면 즉시 오류를 낸다', () => {
    const invalidGpu = createFakeDevice('invalid-shield');
    const invalidEncoder = createFakeEncoder();
    const shieldPass = new TitleWebGpuShieldPass();
    assert.throws(() => shieldPass.encode(
        createContext(invalidGpu.device, invalidEncoder.encoder, 30),
        {
            command: createInactiveShieldCommand(),
            gpuInteractionBuffer: 17,
            targetView: {},
            targetWidth: 800,
            targetHeight: 600
        }
    ), /gpuInteractionBuffer identity/u);

    const enemyGpu = createFakeDevice('missing-enemy-copy');
    const enemyEncoder = createFakeEncoder({ supportCopy: false });
    const enemyPass = new TitleWebGpuEnemyPass({ atlasOptions: createRasterOptions() });
    assert.throws(() => enemyPass.encode(
        createContext(enemyGpu.device, enemyEncoder.encoder, 31),
        {
            packet: createGpuEnemyPacket(createGpuBufferIdentity('enemy-source')),
            targetView: {},
            targetWidth: 800,
            targetHeight: 600,
            palette: TEST_PALETTE
        }
    ), /copyBufferToBuffer/u);

    const shieldGpu = createFakeDevice('missing-shield-copy');
    const shieldEncoder = createFakeEncoder({ supportCopy: false });
    const copyShieldPass = new TitleWebGpuShieldPass();
    assert.throws(() => copyShieldPass.encode(
        createContext(shieldGpu.device, shieldEncoder.encoder, 32),
        {
            command: createInactiveShieldCommand(),
            gpuInteractionBuffer: createGpuBufferIdentity('shield-source'),
            targetView: {},
            targetWidth: 800,
            targetHeight: 600
        }
    ), /encoder\.copyBufferToBuffer/u);

    assert.deepEqual(invalidGpu.records.forbiddenCalls, []);
    assert.deepEqual(invalidEncoder.records.forbiddenCalls, []);
    assert.deepEqual(enemyGpu.records.forbiddenCalls, []);
    assert.deepEqual(enemyEncoder.records.forbiddenCalls, []);
    assert.deepEqual(shieldGpu.records.forbiddenCalls, []);
    assert.deepEqual(shieldEncoder.records.forbiddenCalls, []);
});
