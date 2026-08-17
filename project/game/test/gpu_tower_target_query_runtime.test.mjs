import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    GPU_TOWER_TARGET_QUERY_ABI,
    GPU_TOWER_TARGET_QUERY_FLAG,
    GPU_TOWER_TARGET_QUERY_POLICY,
    GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE,
    selectGpuTowerTargetQueryOracle
} from '../script/module/ingame/physics/gpu/gpu_tower_target_query_abi.js';
import {
    GPU_TOWER_TARGET_QUERY_WGSL
} from '../script/module/ingame/physics/gpu/gpu_tower_target_query_shaders.js';
import {
    GpuTowerTargetQueryRuntime
} from '../script/module/ingame/physics/gpu/gpu_tower_target_query_runtime.js';

const member = (slot, entityId, x, shareUnits, overrides = {}) => ({
    slot,
    entityId,
    incarnation: 1,
    shareUnits,
    groupRevision: 7,
    alive: true,
    towerNoun: true,
    position: { x, y: 0 },
    ...overrides
});

test('source-local 기본 질의는 distance → share → entity/incarnation 순서다', () => {
    const source = { sourcePosition: { x: 0, y: 0 }, groupRevision: 7 };
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [member(0, 30, 3, 100), member(1, 20, 1, 1)]
    }).entityId, 20);
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [member(0, 30, -2, 100), member(1, 20, 2, 200)]
    }).entityId, 20);
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [member(0, 30, -2, 200), member(1, 20, 2, 200)]
    }).entityId, 20);
});

test('O identity 정책·death/ABA·zero roster는 data-owned 결과를 보존한다', () => {
    const source = {
        sourcePosition: { x: 0, y: 0 },
        groupRevision: 7,
        policy: GPU_TOWER_TARGET_QUERY_POLICY.LOWEST_IDENTITY
    };
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [member(0, 50, 1, 1), member(1, 10, 100, 1)]
    }).entityId, 10);
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [
            member(0, 10, 1, 1, { alive: false }),
            member(1, 20, 2, 1, { incarnation: 2 })
        ]
    }).entityId, 20);
    assert.equal(selectGpuTowerTargetQueryOracle({ ...source, members: [] }), null);
    assert.equal(selectGpuTowerTargetQueryOracle({
        ...source,
        members: [member(0, 10, 1, 1, { groupRevision: 6 })]
    }), null);
});

test('query ABI/shader는 compact 결과, revision latch, Archer rewrite, <=9 storage를 고정한다', () => {
    assert.equal(GPU_TOWER_TARGET_QUERY_ABI.RESULT.STRIDE, 40);
    assert.equal(GPU_TOWER_TARGET_QUERY_FLAG.ROSTER_CHANGED, 1 << 2);
    assert.deepEqual(GPU_TOWER_TARGET_QUERY_STORAGE_PROFILE, {
        queryStorageBuffersPerStage: 9,
        spawnRewriteStorageBuffersPerStage: 4,
        maximumStorageBuffersPerStage: 9
    });
    assert.match(GPU_TOWER_TARGET_QUERY_WGSL, /distance_squared < output\.distance_squared/);
    assert.match(GPU_TOWER_TARGET_QUERY_WGSL, /member\.share_units > output\.share_units/);
    assert.match(GPU_TOWER_TARGET_QUERY_WGSL, /previous\.group_revision != output\.group_revision/);
    assert.match(GPU_TOWER_TARGET_QUERY_WGSL, /rewrite_tower_target_spawns/);
    assert.match(GPU_TOWER_TARGET_QUERY_WGSL, /SPAWN_REQUEST_TOWER_DAMAGE_CHANNEL/);
});

class FakeBuffer {
    constructor(descriptor) {
        this.size = descriptor.size;
        this.destroyed = false;
    }
    destroy() { this.destroyed = true; }
}

class FakeDevice {
    constructor() {
        this.limits = {
            maxStorageBuffersPerShaderStage: 9,
            maxStorageBufferBindingSize: 1 << 24,
            maxBufferSize: 1 << 24
        };
    }
    createBuffer(descriptor) { return new FakeBuffer(descriptor); }
    createBindGroupLayout(descriptor) { return descriptor; }
    createPipelineLayout(descriptor) { return descriptor; }
    createShaderModule(descriptor) { return descriptor; }
    createComputePipeline(descriptor) { return descriptor.compute.entryPoint; }
    createBindGroup(descriptor) { return descriptor; }
}

function installWebGpuGlobals() {
    const oldUsage = globalThis.GPUBufferUsage;
    const oldStage = globalThis.GPUShaderStage;
    globalThis.GPUBufferUsage = Object.freeze({
        STORAGE: 1,
        COPY_SRC: 2,
        COPY_DST: 4
    });
    globalThis.GPUShaderStage = Object.freeze({ COMPUTE: 1 });
    return () => {
        if (oldUsage === undefined) delete globalThis.GPUBufferUsage;
        else globalThis.GPUBufferUsage = oldUsage;
        if (oldStage === undefined) delete globalThis.GPUShaderStage;
        else globalThis.GPUShaderStage = oldStage;
    };
}

test('runtime은 CPU roster/pose readback 없이 query와 spawn rewrite를 한 fixed pass에 encode한다', () => {
    const restore = installWebGpuGlobals();
    const device = new FakeDevice();
    const runtime = new GpuTowerTargetQueryRuntime({ capacity: 128 });
    try {
        const buffer = () => new FakeBuffer({ size: 4096 });
        runtime.initialize(device, {
            counts: buffer(),
            physics: buffer(),
            simulation: buffer(),
            enemyBehaviorStates: buffer(),
            members: buffer(),
            roster: buffer(),
            results: buffer(),
            compatibilityTarget: buffer(),
            spawnProgram: buffer()
        }, {
            sessionGeneration: 1,
            deviceGeneration: 2,
            authoritativeEpoch: 3
        });
        const pipelines = [];
        const dispatches = [];
        runtime.encode({
            setBindGroup() {},
            setPipeline(pipeline) { pipelines.push(pipeline); },
            dispatchWorkgroups(count) { dispatches.push(count); }
        }, 9);
        assert.deepEqual(pipelines, [
            'reset_query_stats',
            'query_tower_targets',
            'rewrite_tower_target_spawns'
        ]);
        assert.deepEqual(dispatches, [1, 2, 2]);
        assert.equal(runtime.getStatus().noCpuRosterOrPoseReadback, true);
    } finally {
        runtime.destroy();
        restore();
    }
});

test('A/O/M/Archer와 R3 actor payload 소비자는 roster query 결과를 사용한다', () => {
    const collision = readFileSync(new URL(
        '../script/module/ingame/physics/gpu/gpu_collision_shaders.js',
        import.meta.url
    ), 'utf8');
    const actor = readFileSync(new URL(
        '../script/module/ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js',
        import.meta.url
    ), 'utf8');
    assert.match(collision, /tower_target_query_is_valid\(body_id\)/);
    assert.match(collision, /tower_target_query_roster_changed\(body_id\)/);
    assert.match(collision, /tower_target_query_is_valid\(command\.destination_slot\)/);
    assert.match(actor, /query_actor_payload_tower_target/);
    assert.match(actor, /member\.share_units > selected_share/);
    assert.match(actor, /targetReadbackPolicy: 'none'/);
});
