import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const simulationNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_simulation.js'
);
const shaderNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_enemy_simulation_shader.js'
);
const shieldAbiNamespace = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_shield_interaction_abi.js'
);

const { TitleWebGpuEnemySimulation } = simulationNamespace;
const {
    TITLE_WEBGPU_ENEMY_SIMULATION_BODY_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY,
    TITLE_WEBGPU_ENEMY_SIMULATION_COLLISION_WORKGROUP_SIZE,
    TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS,
    TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY,
    TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT,
    TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT,
    TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
    TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES,
    TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS,
    TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
} = shaderNamespace;
const {
    TITLE_WEBGPU_SHIELD_INTERACTION_ABI,
    TITLE_WEBGPU_SHIELD_INTERACTION_MAX_DENTS,
    TITLE_WEBGPU_SHIELD_INTERACTION_MAX_IMPACTS
} = shieldAbiNamespace;

const BUFFER_USAGE_COPY_SRC = 0x04;
const BUFFER_USAGE_STORAGE = 0x80;
const EXPECTED_PRESENTATION_RECORD_BYTES = 32;
const EXPECTED_PRESENTATION_RECORD_FLOATS = 8;
const EXPECTED_RESOURCE_BUFFER_COUNT = 19;
const BODY_DISPATCH_COUNT = Math.ceil(
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY
    / TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
);
const RECORD_DISPATCH_COUNT = Math.ceil(
    TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY
    / TITLE_WEBGPU_ENEMY_SIMULATION_WORKGROUP_SIZE
);
const LAYER_DISPATCH_COUNT = TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT;

function snapshotBytes(data, dataOffset = 0, size = undefined) {
    const source = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
    const elementByteSize = ArrayBuffer.isView(data) ? data.BYTES_PER_ELEMENT : 1;
    const sourceByteOffset = (dataOffset ?? 0) * elementByteSize;
    const sourceByteLength = size === undefined
        ? source.byteLength - sourceByteOffset
        : size * elementByteSize;
    return source.slice(sourceByteOffset, sourceByteOffset + sourceByteLength);
}

function createFakeDevice(id = 'device') {
    let nextIdentity = 0;
    const records = {
        buffers: [],
        shaderModules: [],
        pipelines: [],
        bindGroups: [],
        writes: [],
        forbiddenCalls: []
    };
    const device = {
        id,
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
            submit() {
                records.forbiddenCalls.push('queue.submit');
                throw new Error('title simulation이 queue.submit()을 호출했습니다.');
            },
            onSubmittedWorkDone() {
                records.forbiddenCalls.push('queue.onSubmittedWorkDone');
                throw new Error('title simulation이 queue 완료를 대기했습니다.');
            }
        },
        createBuffer(descriptor) {
            const buffer = {
                id: `${id}:buffer:${nextIdentity++}`,
                label: descriptor.label,
                descriptor,
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                },
                mapAsync() {
                    records.forbiddenCalls.push(`buffer.mapAsync:${descriptor.label}`);
                    throw new Error('title simulation이 readback mapping을 시작했습니다.');
                },
                getMappedRange() {
                    records.forbiddenCalls.push(`buffer.getMappedRange:${descriptor.label}`);
                    throw new Error('title simulation이 mapped range를 읽었습니다.');
                }
            };
            records.buffers.push(buffer);
            return buffer;
        },
        createShaderModule(descriptor) {
            const module = {
                id: `${id}:shader:${nextIdentity++}`,
                descriptor
            };
            records.shaderModules.push(module);
            return module;
        },
        createComputePipeline(descriptor) {
            const pipeline = {
                id: `${id}:pipeline:${nextIdentity++}`,
                label: descriptor.label,
                descriptor,
                getBindGroupLayout(index) {
                    return { pipeline, index };
                }
            };
            records.pipelines.push(pipeline);
            return pipeline;
        },
        createBindGroup(descriptor) {
            const bindGroup = {
                id: `${id}:bind-group:${nextIdentity++}`,
                descriptor
            };
            records.bindGroups.push(bindGroup);
            return bindGroup;
        },
        createCommandEncoder() {
            records.forbiddenCalls.push('device.createCommandEncoder');
            throw new Error('title simulation이 command encoder를 생성했습니다.');
        }
    };
    return { device, records };
}

function createFakeEncoder() {
    const records = {
        computePasses: [],
        forbiddenCalls: []
    };
    const encoder = {
        beginComputePass(descriptor) {
            const passRecord = {
                descriptor,
                dispatches: [],
                endCount: 0
            };
            records.computePasses.push(passRecord);
            let currentPipeline = null;
            let currentBindGroup = null;
            return {
                setPipeline(pipeline) {
                    currentPipeline = pipeline;
                },
                setBindGroup(index, bindGroup) {
                    assert.equal(index, 0);
                    currentBindGroup = bindGroup;
                },
                dispatchWorkgroups(x, y = 1, z = 1) {
                    assert.ok(currentPipeline, 'dispatch 전에 pipeline이 설정되어야 합니다.');
                    assert.ok(currentBindGroup, 'dispatch 전에 bind group이 설정되어야 합니다.');
                    passRecord.dispatches.push({
                        entryPoint: currentPipeline.descriptor.compute.entryPoint,
                        x,
                        y,
                        z,
                        bindGroup: currentBindGroup
                    });
                },
                end() {
                    passRecord.endCount += 1;
                }
            };
        },
        finish() {
            records.forbiddenCalls.push('encoder.finish');
            throw new Error('title simulation이 encoder.finish()를 호출했습니다.');
        }
    };
    return { encoder, records };
}

function createContext(device, encoder, frameId, deviceGeneration = 4) {
    return {
        device,
        encoder,
        frameId,
        deviceGeneration,
        format: 'rgba8unorm'
    };
}

function getBuffer(records, label) {
    return records.buffers.find((buffer) => buffer.label === label);
}

function getWrites(records, label) {
    return records.writes.filter((write) => write.buffer.label === label);
}

function getLastWrite(records, label) {
    const writes = getWrites(records, label);
    return writes[writes.length - 1];
}

function asFloat32(write) {
    return new Float32Array(
        write.bytes.buffer,
        write.bytes.byteOffset,
        write.bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
}

function asUint32(write) {
    return new Uint32Array(
        write.bytes.buffer,
        write.bytes.byteOffset,
        write.bytes.byteLength / Uint32Array.BYTES_PER_ELEMENT
    );
}

function queueSpawn(simulation, layerIndex = 0, styleCode = 0) {
    return simulation.queueSpawn({
        layerIndex,
        styleCode,
        position: { x: 120 + layerIndex, y: 240 + layerIndex },
        speed: { x: -30, y: 4 },
        baseSpeed: { x: -18, y: 2 },
        burstVelocity: { x: -12, y: 2 },
        burstDecayRate: 11.5,
        rotation: 45,
        width: 24,
        height: 20,
        alpha: 0.6,
        collisionRadius: 10,
        collisionGrace: 0.3,
        magneticScale: 1
    });
}

function queueFixedStep(simulation, delta = 1 / 60) {
    return simulation.queueFixedStep(delta, {
        uiww: 1200,
        objectFocused: true,
        leftPressing: false,
        mousePos: { x: 320, y: 180 },
        logoMagneticPoint: { x: 480, y: 270 },
        logoMagneticDistance: 420
    });
}

function setPresentationState(simulation) {
    simulation.setPresentationState({
        width: 1920,
        height: 1080,
        objectOffsetY: 24,
        interpolationAlpha: 0.5,
        frameDelta: 1 / 60,
        shieldLayout: { centerX: 640, centerY: 360, radius: 96 }
    });
}

function extractStruct(source, structName) {
    const match = source.match(new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\};`, 'u'));
    assert.ok(match, `${structName} WGSL struct가 필요합니다.`);
    return match[1];
}

test('title simulation host/WGSL ABI는 420/140/840과 128B/96B/64B/464B를 고정한다', () => {
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_CAPACITY, 420);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_CAPACITY, 140);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_LAYER_COUNT, 3);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT, 840);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_BODY_BYTES, 128);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS, 24);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES, 96);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_FLOATS, 16);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_FIXED_BYTES, 64);
    assert.equal(TITLE_WEBGPU_SHIELD_INTERACTION_ABI.BYTE_SIZE, 464);
    assert.equal(TITLE_WEBGPU_SHIELD_INTERACTION_MAX_IMPACTS, 12);
    assert.equal(TITLE_WEBGPU_SHIELD_INTERACTION_MAX_DENTS, 16);

    assert.equal((extractStruct(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, 'BodyState')
        .match(/vec4</gu) ?? []).length, 8);
    assert.equal((extractStruct(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, 'SpawnCommand')
        .match(/vec4</gu) ?? []).length, 6);
    assert.equal((extractStruct(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, 'FixedParameters')
        .match(/vec4</gu) ?? []).length, 4);

    assert.throws(
        () => new TitleWebGpuEnemySimulation({ capacity: 419 }),
        /420\/140/u
    );
    assert.throws(
        () => new TitleWebGpuEnemySimulation({ layerCapacity: 139 }),
        /420\/140/u
    );
});

test('spawn/resize/fixed queue를 정확한 compute 순서와 dispatch count로 기록하고 GPU packet을 노출한다', () => {
    const gpu = createFakeDevice('encode');
    const encoded = createFakeEncoder();
    const simulation = new TitleWebGpuEnemySimulation({ targetPerLayer: 126 });
    setPresentationState(simulation);
    assert.equal(simulation.queueResize(2, 0.5), true);
    assert.equal(queueFixedStep(simulation), true);
    assert.ok(queueSpawn(simulation, 0, 0));
    assert.ok(queueSpawn(simulation, 2, 6));
    assert.equal(queueFixedStep(simulation, 1 / 120), true);

    const output = simulation.encode(createContext(gpu.device, encoded.encoder, 10));
    assert.equal(encoded.records.computePasses.length, 1);
    const computePass = encoded.records.computePasses[0];
    assert.equal(computePass.endCount, 1);
    assert.deepEqual(
        computePass.dispatches.map(({ entryPoint, x }) => [entryPoint, x]),
        [
            ['resize_title_bodies', BODY_DISPATCH_COUNT],
            ['simulate_title_layers', LAYER_DISPATCH_COUNT],
            ['spawn_title_bodies', 1],
            ['simulate_title_layers', 2],
            ['simulate_title_layers', LAYER_DISPATCH_COUNT],
            ['clear_title_shield_frame', 1],
            ['write_title_presentation', RECORD_DISPATCH_COUNT]
        ]
    );

    assert.equal(BODY_DISPATCH_COUNT, 7);
    assert.equal(TITLE_WEBGPU_ENEMY_SIMULATION_COLLISION_WORKGROUP_SIZE, 160);
    assert.equal(LAYER_DISPATCH_COUNT, 3);
    assert.equal(RECORD_DISPATCH_COUNT, 7);
    const presentationDispatch = computePass.dispatches.at(-1);
    assert.equal(presentationDispatch.entryPoint, 'write_title_presentation');
    assert.deepEqual(
        Array.from(
            presentationDispatch.bindGroup.descriptor.entries,
            ({ binding }) => binding
        ),
        [0, 6, 7, 8, 9]
    );
    const spawnWrite = getLastWrite(gpu.records, 'title-gpu-sim-spawns');
    assert.equal(spawnWrite.size, 2 * TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_FLOATS);
    assert.equal(spawnWrite.bytes.byteLength, 2 * TITLE_WEBGPU_ENEMY_SIMULATION_SPAWN_BYTES);
    assert.deepEqual(
        Array.from(asUint32(getLastWrite(gpu.records, 'title-gpu-sim-spawn-control'))),
        [2, 126, 0, 0]
    );
    assert.deepEqual(
        Array.from(asFloat32(getLastWrite(gpu.records, 'title-gpu-sim-resize'))),
        [2, 0.5, 0, 0]
    );
    assert.equal(getWrites(gpu.records, 'title-gpu-sim-fixed:0').length, 1);
    assert.equal(getWrites(gpu.records, 'title-gpu-sim-fixed:1').length, 1);
    assert.equal(
        asFloat32(getLastWrite(gpu.records, 'title-gpu-sim-collision-only'))[10],
        5
    );

    const presentationBuffer = getBuffer(gpu.records, 'title-gpu-sim-presentation');
    const shieldBuffer = getBuffer(gpu.records, 'title-gpu-sim-shield-interactions');
    assert.equal(Object.isSealed(output), true);
    assert.equal(Object.isSealed(output.presentationPacket), true);
    assert.equal(Object.isSealed(output.presentationSource), true);
    assert.equal(Object.isSealed(output.shieldInteractionSource), true);
    assert.strictEqual(output.presentationPacket.gpuSourceBuffer, presentationBuffer);
    assert.strictEqual(output.presentationSource.gpuSourceBuffer, presentationBuffer);
    assert.equal(output.presentationSource.byteOffset, 0);
    assert.equal(output.presentationSource.byteLength, 840 * EXPECTED_PRESENTATION_RECORD_BYTES);
    assert.equal(output.presentationPacket.records, null);
    assert.equal(output.presentationPacket.recordCount, 840);
    assert.equal(output.presentationPacket.usedByteLength, 840 * EXPECTED_PRESENTATION_RECORD_BYTES);
    assert.equal(output.presentationPacket.recordStrideFloats, EXPECTED_PRESENTATION_RECORD_FLOATS);
    assert.equal(output.presentationPacket.recordStrideBytes, EXPECTED_PRESENTATION_RECORD_BYTES);
    assert.strictEqual(output.shieldInteractionBuffer, shieldBuffer);
    assert.equal(output.frameId, 10);
    assert.equal(output.deviceGeneration, 4);
    assert.equal(output.revision, 1);
    assert.equal(output.presentationPacket.frameId, 10);
    assert.equal(output.presentationPacket.deviceGeneration, 4);
    assert.equal(output.presentationPacket.revision, 1);
    assert.equal(output.presentationSource.frameId, 10);
    assert.equal(output.presentationSource.deviceGeneration, 4);
    assert.equal(output.presentationSource.revision, 1);
    assert.strictEqual(output.shieldInteractionSource.gpuSourceBuffer, shieldBuffer);
    assert.equal(output.shieldInteractionSource.byteOffset, 0);
    assert.equal(output.shieldInteractionSource.byteLength, 464);
    assert.equal(output.shieldInteractionSource.frameId, 10);
    assert.equal(output.shieldInteractionSource.deviceGeneration, 4);
    assert.equal(output.shieldInteractionSource.revision, 1);
    assert.equal(
        presentationBuffer.descriptor.size,
        TITLE_WEBGPU_ENEMY_SIMULATION_RECORD_COUNT * EXPECTED_PRESENTATION_RECORD_BYTES
    );
    assert.equal(
        presentationBuffer.descriptor.usage,
        BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC
    );
    assert.equal(shieldBuffer.descriptor.size, TITLE_WEBGPU_SHIELD_INTERACTION_ABI.BYTE_SIZE);
    assert.equal(shieldBuffer.descriptor.usage, BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC);
    assert.equal(gpu.records.buffers.length, EXPECTED_RESOURCE_BUFFER_COUNT);

    const shieldSource = simulation.getShieldInteractionSource();
    assert.strictEqual(shieldSource, output.shieldInteractionSource);
    assert.strictEqual(shieldSource.gpuSourceBuffer, shieldBuffer);
    assert.equal(shieldSource.byteLength, 464);
    assert.equal(shieldSource.impactCountByteOffset, 0);
    assert.equal(shieldSource.dentCountByteOffset, 4);
    assert.equal(simulation.getDiagnostics().normalReadbackCount, 0);
    assert.equal(simulation.getDiagnostics().ownsSubmit, false);
    assert.deepEqual(gpu.records.forbiddenCalls, []);
    assert.deepEqual(encoded.records.forbiddenCalls, []);

    simulation.finishFrame('committed', 10);
    simulation.destroy();
});

test('resize viewport epoch는 이전 fixed와 이후 fixed/spawn을 분리하고 ratio fallback을 지원한다', () => {
    const gpu = createFakeDevice('resize-epoch');
    const encoded = createFakeEncoder();
    const simulation = new TitleWebGpuEnemySimulation();
    simulation.setPresentationState({ width: 800, height: 600 });
    assert.equal(queueFixedStep(simulation), true);
    assert.equal(simulation.queueResize(2, 0.5, { width: 1600, height: 300 }), true);
    assert.equal(queueFixedStep(simulation), true);
    assert.ok(queueSpawn(simulation, 1, 1));

    simulation.encode(createContext(gpu.device, encoded.encoder, 1));
    assert.deepEqual(
        encoded.records.computePasses[0].dispatches.map(({ entryPoint }) => entryPoint),
        [
            'simulate_title_layers',
            'resize_title_bodies',
            'simulate_title_layers',
            'spawn_title_bodies',
            'simulate_title_layers',
            'clear_title_shield_frame',
            'write_title_presentation'
        ]
    );
    assert.deepEqual(
        Array.from(asFloat32(getLastWrite(gpu.records, 'title-gpu-sim-fixed:0')).slice(12, 14)),
        [800, 600]
    );
    assert.deepEqual(
        Array.from(asFloat32(getLastWrite(gpu.records, 'title-gpu-sim-fixed:1')).slice(12, 14)),
        [1600, 300]
    );
    assert.deepEqual(
        Array.from(asFloat32(getLastWrite(gpu.records, 'title-gpu-sim-collision-only')).slice(12, 14)),
        [1600, 300]
    );
    simulation.finishFrame('committed', 1);
    simulation.destroy();

    const fallbackGpu = createFakeDevice('resize-epoch-fallback');
    const fallbackSimulation = new TitleWebGpuEnemySimulation();
    fallbackSimulation.setPresentationState({ width: 100, height: 80 });
    assert.equal(fallbackSimulation.queueResize(1.5, 0.25), true);
    assert.equal(queueFixedStep(fallbackSimulation), true);
    fallbackSimulation.encode(createContext(
        fallbackGpu.device,
        createFakeEncoder().encoder,
        1
    ));
    assert.deepEqual(
        Array.from(asFloat32(
            getLastWrite(fallbackGpu.records, 'title-gpu-sim-fixed:0')
        ).slice(12, 14)),
        [150, 20]
    );
    fallbackSimulation.finishFrame('committed', 1);
    fallbackSimulation.destroy();
});

test('abort는 queue를 보존하고 commit은 encode snapshot만 consume한다', () => {
    const gpu = createFakeDevice('queue');
    const firstEncoder = createFakeEncoder();
    const simulation = new TitleWebGpuEnemySimulation();
    setPresentationState(simulation);
    queueSpawn(simulation, 0, 0);
    queueFixedStep(simulation);
    simulation.queueResize(2, 3);

    const firstOutput = simulation.encode(createContext(gpu.device, firstEncoder.encoder, 1));
    const presentationSource = firstOutput.presentationSource;
    const shieldInteractionSource = firstOutput.shieldInteractionSource;
    assert.equal(simulation.finishFrame('aborted', 1), true);
    assert.deepEqual(
        {
            spawns: simulation.getDiagnostics().pendingSpawnCount,
            fixed: simulation.getDiagnostics().pendingFixedStepCount,
            aborts: simulation.getDiagnostics().abortCount
        },
        { spawns: 1, fixed: 1, aborts: 1 }
    );

    const secondEncoder = createFakeEncoder();
    const secondOutput = simulation.encode(createContext(gpu.device, secondEncoder.encoder, 2));
    assert.strictEqual(secondOutput, firstOutput);
    assert.strictEqual(secondOutput.presentationSource, presentationSource);
    assert.strictEqual(secondOutput.shieldInteractionSource, shieldInteractionSource);
    assert.equal(secondOutput.presentationSource.frameId, 2);
    assert.equal(secondOutput.shieldInteractionSource.frameId, 2);
    queueSpawn(simulation, 1, 1);
    queueFixedStep(simulation, 1 / 120);
    simulation.queueResize(5, 7);
    assert.equal(simulation.finishFrame('committed', 2), true);
    assert.deepEqual(
        {
            spawns: simulation.getDiagnostics().pendingSpawnCount,
            fixed: simulation.getDiagnostics().pendingFixedStepCount,
            commits: simulation.getDiagnostics().commitCount,
            lastCommittedFrameId: simulation.getDiagnostics().lastCommittedFrameId
        },
        { spawns: 1, fixed: 1, commits: 1, lastCommittedFrameId: 2 }
    );

    const thirdEncoder = createFakeEncoder();
    const writesBeforeThirdFrame = gpu.records.writes.length;
    simulation.encode(createContext(gpu.device, thirdEncoder.encoder, 3));
    const thirdFrameWrites = gpu.records.writes.slice(writesBeforeThirdFrame);
    const resizeWrite = thirdFrameWrites.find(
        (write) => write.buffer.label === 'title-gpu-sim-resize'
    );
    assert.ok(resizeWrite);
    assert.deepEqual(Array.from(asFloat32(resizeWrite)), [5, 7, 0, 0]);
    assert.deepEqual(
        thirdEncoder.records.computePasses[0].dispatches.map(({ entryPoint }) => entryPoint),
        [
            'spawn_title_bodies',
            'simulate_title_layers',
            'simulate_title_layers',
            'resize_title_bodies',
            'clear_title_shield_frame',
            'write_title_presentation'
        ]
    );
    simulation.finishFrame('committed', 3);
    assert.equal(simulation.getDiagnostics().pendingSpawnCount, 0);
    assert.equal(simulation.getDiagnostics().pendingFixedStepCount, 0);
    simulation.destroy();
});

test('stale generation, same-generation device drift와 generation 변경은 기존 resource를 보존하며 거부한다', () => {
    const cases = [
        {
            id: 'stale',
            nextGeneration: 4,
            useSecondDevice: false,
            expected: /stale.*device generation/u
        },
        {
            id: 'drift',
            nextGeneration: 5,
            useSecondDevice: true,
            expected: /device drift/u
        },
        {
            id: 'generation-change',
            nextGeneration: 6,
            useSecondDevice: true,
            expected: /CPU epoch fallback/u
        }
    ];

    for (const entry of cases) {
        const firstGpu = createFakeDevice(`${entry.id}-a`);
        const secondGpu = createFakeDevice(`${entry.id}-b`);
        const simulation = new TitleWebGpuEnemySimulation();
        simulation.encode(createContext(firstGpu.device, createFakeEncoder().encoder, 10, 5));
        simulation.finishFrame('committed', 10);

        assert.throws(() => simulation.encode(createContext(
            entry.useSecondDevice ? secondGpu.device : firstGpu.device,
            createFakeEncoder().encoder,
            11,
            entry.nextGeneration
        )), entry.expected);
        assert.equal(simulation.getDiagnostics().failedClosed, true);
        assert.throws(() => simulation.encode(createContext(
            firstGpu.device,
            createFakeEncoder().encoder,
            12,
            5
        )), /fail-closed/u);
        assert.equal(firstGpu.records.buffers.length, EXPECTED_RESOURCE_BUFFER_COUNT);
        assert.equal(firstGpu.records.buffers.every((buffer) => buffer.destroyCount === 0), true);
        assert.equal(secondGpu.records.buffers.length, 0);

        assert.equal(simulation.destroy(), true);
        assert.equal(firstGpu.records.buffers.every((buffer) => buffer.destroyCount === 1), true);
        assert.deepEqual(firstGpu.records.forbiddenCalls, []);
        assert.deepEqual(secondGpu.records.forbiddenCalls, []);
    }
});

test('active frame destroy는 completion까지 GPU resource 해제를 미루고 이후 idempotent하게 닫힌다', () => {
    const gpu = createFakeDevice('destroy');
    const encoded = createFakeEncoder();
    const simulation = new TitleWebGpuEnemySimulation();
    queueSpawn(simulation, 0, 0);
    const output = simulation.encode(createContext(gpu.device, encoded.encoder, 8));
    const presentationBuffer = output.presentationPacket.gpuSourceBuffer;
    const shieldBuffer = output.shieldInteractionBuffer;

    assert.equal(simulation.destroy(), true);
    assert.equal(simulation.getDiagnostics().destroyed, true);
    assert.equal(simulation.getDiagnostics().destroyPending, true);
    assert.equal(gpu.records.buffers.every((buffer) => buffer.destroyCount === 0), true);
    assert.strictEqual(output.presentationPacket.gpuSourceBuffer, presentationBuffer);
    assert.strictEqual(output.shieldInteractionBuffer, shieldBuffer);

    assert.equal(simulation.finishFrame('aborted', 8), true);
    assert.equal(gpu.records.buffers.every((buffer) => buffer.destroyCount === 1), true);
    assert.equal(output.presentationPacket.gpuSourceBuffer, null);
    assert.equal(output.presentationSource.gpuSourceBuffer, null);
    assert.equal(output.shieldInteractionBuffer, null);
    assert.equal(output.shieldInteractionSource.gpuSourceBuffer, null);
    assert.equal(simulation.getDiagnostics().destroyPending, false);
    assert.equal(simulation.getDiagnostics().deviceGeneration, null);
    assert.equal(simulation.destroy(), false);
    assert.equal(queueFixedStep(simulation), false);
    assert.throws(() => simulation.encode(createContext(
        gpu.device,
        createFakeEncoder().encoder,
        9
    )), /destroy/u);
    assert.deepEqual(gpu.records.forbiddenCalls, []);
    assert.deepEqual(encoded.records.forbiddenCalls, []);
});

test('bounded queue overflow는 초과 입력만 거부하고 이미 수락한 journal은 정상 drain한다', () => {
    const gpu = createFakeDevice('overflow');
    const encoded = createFakeEncoder();
    const simulation = new TitleWebGpuEnemySimulation();
    setPresentationState(simulation);
    for (let index = 0; index < 8; index++) {
        assert.equal(queueFixedStep(simulation), true);
    }
    assert.equal(queueFixedStep(simulation), false);
    assert.equal(simulation.getDiagnostics().queueOverflowed, true);

    simulation.encode(createContext(gpu.device, encoded.encoder, 1));
    assert.equal(
        encoded.records.computePasses[0].dispatches.filter(
            ({ entryPoint }) => entryPoint === 'simulate_title_layers'
        ).length,
        8
    );
    simulation.finishFrame('committed', 1);
    assert.equal(simulation.getDiagnostics().pendingFixedStepCount, 0);
    simulation.destroy();
});

test('resource 생성 중간 실패는 부분 buffer를 모두 정리하고 backend를 terminal fail-closed한다', () => {
    const gpu = createFakeDevice('resource-failure');
    const originalCreateBuffer = gpu.device.createBuffer;
    let createAttemptCount = 0;
    gpu.device.createBuffer = (descriptor) => {
        createAttemptCount += 1;
        if (createAttemptCount === 5) {
            throw new Error('synthetic-create-failure');
        }
        return originalCreateBuffer(descriptor);
    };
    const simulation = new TitleWebGpuEnemySimulation();

    assert.throws(() => simulation.encode(createContext(
        gpu.device,
        createFakeEncoder().encoder,
        1
    )), /synthetic-create-failure/u);
    assert.equal(gpu.records.buffers.length, 4);
    assert.equal(gpu.records.buffers.every((buffer) => buffer.destroyCount === 1), true);
    assert.equal(simulation.getDiagnostics().deviceGeneration, null);
    assert.equal(simulation.getDiagnostics().failedClosed, true);
    assert.throws(() => simulation.encode(createContext(
        gpu.device,
        createFakeEncoder().encoder,
        2
    )), /fail-closed/u);
    assert.equal(gpu.records.buffers.length, 4);
});

test('WGSL은 host가 사용하는 compute entry point, bounds, layer partition과 shield 상한을 명시한다', () => {
    for (const entryPoint of [
        'spawn_title_bodies',
        'resize_title_bodies',
        'integrate_title_bodies',
        'simulate_title_layers',
        'accumulate_title_collisions',
        'apply_title_collisions',
        'clear_title_shield_frame',
        'write_title_presentation'
    ]) {
        assert.match(
            TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
            new RegExp(`fn\\s+${entryPoint}\\s*\\(`, 'u')
        );
    }

    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const BODY_CAPACITY: u32 = 420u;/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const LAYER_CAPACITY: u32 = 140u;/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const RECORD_COUNT: u32 = 840u;/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const MAX_IMPACTS: u32 = 12u;/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const MAX_DENTS: u32 = 16u;/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /commandCount = min\(spawnControl\.x, BODY_CAPACITY\)/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /targetPerLayer = min\(spawnControl\.y, LAYER_CAPACITY\)/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /if \(index >= BODY_CAPACITY/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /if \(bodyIndex >= BODY_CAPACITY\)/u);
    assert.ok(
        (TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.match(
            /let partitionStart = layer \* LAYER_CAPACITY;/gu
        ) ?? []).length >= 2
    );
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /softnessRecordIndex = bodyIndex \* 2u/u);
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /previousImpactCount = min\([\s\S]*MAX_IMPACTS\s*\)/u
    );
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /currentCount >= MAX_IMPACTS/u);
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /atomicCompareExchangeWeak\([\s\S]*currentCount,[\s\S]*currentCount \+ 1u/u
    );
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /const MAX_ACTIVE_DENTS: u32 = 8u/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /let maxRelevantDistance = radius \+ enemyRadius \+ 64\.8/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn fast_smoothing_factor/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn fast_asin_unit/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn fast_atan2/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn update_fixed_shield_state/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /atomicCompareExchangeWeak/u);
    const shieldStateSection = TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.slice(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.indexOf('fn update_fixed_shield_state'),
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.indexOf('@compute @workgroup_size(1)')
    );
    const targetVisualOffset = shieldStateSection.indexOf('let targetVisual');
    const slotAdmissionOffset = shieldStateSection.indexOf('if (slotCode == 0u && needsPersistentSlot)');
    assert.ok(targetVisualOffset >= 0 && targetVisualOffset < slotAdmissionOffset);
    assert.match(
        shieldStateSection,
        /let needsPersistentSlot = contacting \|\| targetVisual > 0\.0 \|\| body\.response\.w > 0\.001;/u
    );
    const releaseSection = TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.slice(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.indexOf('fn release_title_shield_slot'),
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER.indexOf('fn update_fixed_shield_state')
    );
    assert.match(releaseSection, /atomicStore\(&shieldWinnerKeys\[slotIndex\], 0u\)/u);
    assert.doesNotMatch(releaseSection, /atomicCompareExchangeWeak/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn try_append_title_shield_impact/u);
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /body\.shield\.z < -0\.5 && body\.shield\.w < 0\.5[\s\S]*try_append_title_shield_impact\(body\)/u
    );
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /slotMatches[\s\S]*body\.metadata\.x != 0u[\s\S]*atomicStore\(&shieldWinnerKeys\[localIndex\], 0u\)/u
    );
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /body\.response = vec4<f32>\(body\.response\.xy, 0\.0, 0\.0\);[\s\S]*body\.shield = vec4<f32>\(0\.0\);/u
    );
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn collect_title_shield_body/u);
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /collect_title_shield_body\(bodyIndex, body\)/u
    );
    assert.match(
        TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
        /ownerCode = atomicLoad\(&shieldWinnerKeys\[localIndex\]\)/u
    );
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /fn collision_layer_for_workgroup/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /collisionGridHeads: array<atomic<i32>, 144>/u);
    assert.match(TITLE_WEBGPU_ENEMY_SIMULATION_SHADER, /counts: array<atomic<u32>, 4>/u);
    for (const removedEntryPoint of [
        'update_title_shield',
        'update_title_shield_parallel',
        'collect_title_shield_interactions',
        'write_title_shield_dents'
    ]) {
        assert.doesNotMatch(
            TITLE_WEBGPU_ENEMY_SIMULATION_SHADER,
            new RegExp(`fn\\s+${removedEntryPoint}\\s*\\(`, 'u')
        );
    }
});
