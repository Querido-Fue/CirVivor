import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    GPU_TOWER_GROUP_ABI,
    GPU_TOWER_GROUP_ABI_VERSION,
    GPU_TOWER_GROUP_MEMBER_FLAG,
    GPU_TOWER_GROUP_STORAGE_PROFILE,
    broadcastGpuTowerGroupControlOracle,
    createGpuTowerGroupHostStorage,
    reduceGpuTowerGroupCameraSummaryOracle,
    writeGpuTowerGroupCommand,
    writeGpuTowerGroupRoster
} from '../script/module/ingame/physics/gpu/gpu_tower_group_abi.js';
import {
    GPU_TOWER_GROUP_CONTROL_WGSL,
    GPU_TOWER_GROUP_SUMMARY_WGSL
} from '../script/module/ingame/physics/gpu/gpu_tower_group_shaders.js';
import {
    GpuTowerGroupRuntime
} from '../script/module/ingame/physics/gpu/gpu_tower_group_runtime.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER
} from '../script/module/ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GAMEPLAY_TEAM_ID
} from '../script/module/ingame/contract/gameplay_team_contract.js';
import {
    INPUT_DISPOSITIONS,
    PLAYER_ACTION_TYPES
} from '../script/module/ingame/contract/player_controllable_contract.js';
import {
    GpuTowerGroupFacade
} from '../script/module/ingame/object/tower/gpu_tower_group_facade.js';

const PROTOCOL = Object.freeze({
    sessionGeneration: 3,
    deviceGeneration: 4,
    authoritativeEpoch: 5
});

function createMember(index, overrides = {}) {
    return {
        slot: index,
        entityId: 1000 + index,
        incarnation: 7,
        logicalTowerOrdinal: index + 1,
        shareUnits: index + 1,
        maxHpFixedPoint: 10_000,
        powerFixedPoint: 500,
        flags: GPU_TOWER_GROUP_MEMBER_FLAG.TOWER_NOUN
            | GPU_TOWER_GROUP_MEMBER_FLAG.LIVING,
        ...overrides
    };
}

function createBody(member, overrides = {}) {
    return {
        slot: member.slot,
        entityId: member.entityId,
        incarnation: member.incarnation,
        alive: true,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        interactionLayer:
            GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
        position: { x: member.slot * 2, y: member.slot * -3 },
        radius: 0.5,
        ...overrides
    };
}

function createRosterAndCommand(count, moveIntent = { x: 0.25, y: -0.5 }) {
    const storage = createGpuTowerGroupHostStorage(256);
    const roster = writeGpuTowerGroupRoster(storage, {
        protocol: PROTOCOL,
        groupRevision: 9,
        members: Array.from({ length: count }, (_, index) => createMember(index))
    });
    const command = writeGpuTowerGroupCommand(storage, {
        protocol: PROTOCOL,
        sourceTick: 17,
        groupRevision: roster.groupRevision,
        rosterFingerprint: roster.fingerprint,
        moveIntent,
        aimWorldPoint: { x: 44, y: 55 }
    });
    return { storage, roster, command };
}

test('0/1/2/10/256 Tower roster는 CPU command 하나를 exact living member 전체에 broadcast한다', () => {
    for (const count of [0, 1, 2, 10, 256]) {
        const { roster, command } = createRosterAndCommand(count);
        const bodies = roster.members.map(createBody);
        const result = broadcastGpuTowerGroupControlOracle({
            members: roster.members,
            bodies,
            command
        });
        assert.equal(roster.memberCount, count);
        assert.equal(result.controls.length, count);
        assert.equal(result.excludedMemberCount, 0);
        for (let index = 0; index < result.controls.length; index++) {
            assert.equal(result.controls[index].slot, index);
            assert.deepEqual(result.controls[index].moveIntent, command.moveIntent);
            assert.deepEqual(result.controls[index].aimWorldPoint, command.aimWorldPoint);
            assert.equal('position' in result.controls[index], false);
        }
    }
});

test('zero intent/no Tower는 no-op이고 stale·ABA·wrong-team member는 exact 검증에서 제외된다', () => {
    const empty = createRosterAndCommand(0, { x: 0, y: 0 });
    assert.deepEqual(
        broadcastGpuTowerGroupControlOracle({
            members: empty.roster.members,
            bodies: [],
            command: empty.command
        }).controls,
        []
    );

    const { roster, command } = createRosterAndCommand(2, { x: 0, y: 0 });
    const bodies = [
        createBody(roster.members[0], { incarnation: 8 }),
        createBody(roster.members[1], { teamId: GAMEPLAY_TEAM_ID.HOSTILE })
    ];
    const excluded = broadcastGpuTowerGroupControlOracle({
        members: roster.members,
        bodies,
        command
    });
    assert.equal(excluded.controls.length, 0);
    assert.equal(excluded.excludedMemberCount, 2);
});

test('camera summary는 share 가중 centroid·bounds·logical primary를 deterministic하게 줄인다', () => {
    const storage = createGpuTowerGroupHostStorage(16);
    const roster = writeGpuTowerGroupRoster(storage, {
        protocol: PROTOCOL,
        groupRevision: 12,
        members: [
            createMember(8, {
                entityId: 202,
                logicalTowerOrdinal: 2,
                shareUnits: 3
            }),
            createMember(3, {
                entityId: 101,
                logicalTowerOrdinal: 1,
                shareUnits: 1
            })
        ]
    });
    const bodies = [
        createBody(roster.members[0], {
            position: { x: 0, y: 2 },
            radius: 1
        }),
        createBody(roster.members[1], {
            position: { x: 8, y: 6 },
            radius: 2
        })
    ];
    const summary = reduceGpuTowerGroupCameraSummaryOracle({
        protocol: PROTOCOL,
        sourceTick: 30,
        groupRevision: roster.groupRevision,
        rosterFingerprint: roster.fingerprint,
        members: roster.members,
        bodies
    });
    assert.equal(summary.livingCount, 2);
    assert.equal(summary.livingShareUnits, 4);
    assert.deepEqual(summary.centroid, { x: 6, y: 5 });
    assert.deepEqual(summary.bounds, {
        minX: -1,
        minY: 1,
        maxX: 10,
        maxY: 8
    });
    assert.deepEqual(summary.primaryHandle, {
        entityId: 101,
        incarnation: 7
    });
    assert.equal(summary.primaryLogicalTowerOrdinal, 1);
});

function installFakeWebGpuGlobals() {
    const previous = {
        GPUBufferUsage: globalThis.GPUBufferUsage,
        GPUShaderStage: globalThis.GPUShaderStage,
        GPUMapMode: globalThis.GPUMapMode
    };
    globalThis.GPUBufferUsage = Object.freeze({
        STORAGE: 1 << 0,
        COPY_SRC: 1 << 1,
        COPY_DST: 1 << 2,
        UNIFORM: 1 << 3,
        MAP_READ: 1 << 4
    });
    globalThis.GPUShaderStage = Object.freeze({ COMPUTE: 1 });
    globalThis.GPUMapMode = Object.freeze({ READ: 1 });
    return () => {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    };
}

class FakeBuffer {
    constructor(descriptor) {
        this.label = descriptor.label;
        this.size = descriptor.size;
        this.data = new ArrayBuffer(descriptor.size);
        this.mapResolvers = [];
        this.destroyed = false;
    }

    mapAsync() {
        return new Promise((resolve) => this.mapResolvers.push(resolve));
    }

    resolveMap() {
        this.mapResolvers.shift()?.();
    }

    getMappedRange() {
        return this.data;
    }

    unmap() {}

    destroy() {
        this.destroyed = true;
    }
}

class FakeDevice {
    constructor() {
        this.limits = {
            maxBufferSize: 1 << 24,
            maxStorageBufferBindingSize: 1 << 24,
            maxStorageBuffersPerShaderStage: 9
        };
        this.queue = {
            writeBuffer: (target, offset, source) => {
                const bytes = ArrayBuffer.isView(source)
                    ? new Uint8Array(
                        source.buffer,
                        source.byteOffset,
                        source.byteLength
                    )
                    : new Uint8Array(source);
                new Uint8Array(target.data, offset, bytes.byteLength).set(bytes);
            },
            submit() {}
        };
    }

    createBuffer(descriptor) {
        return new FakeBuffer(descriptor);
    }

    createBindGroupLayout(descriptor) {
        return descriptor;
    }

    createPipelineLayout(descriptor) {
        return descriptor;
    }

    createShaderModule(descriptor) {
        return descriptor;
    }

    createComputePipeline(descriptor) {
        return {
            label: descriptor.label,
            entryPoint: descriptor.compute.entryPoint
        };
    }

    createBindGroup(descriptor) {
        return descriptor;
    }

    createCommandEncoder() {
        return {
            beginComputePass() {
                return {
                    setPipeline() {},
                    setBindGroup() {},
                    dispatchWorkgroups() {},
                    end() {}
                };
            },
            copyBufferToBuffer(source, sourceOffset, target, targetOffset, size) {
                new Uint8Array(target.data, targetOffset, size).set(
                    new Uint8Array(source.data, sourceOffset, size)
                );
            },
            finish() {
                return {};
            }
        };
    }
}

function createGpuResources(device, capacity = 256) {
    const buffer = (label, size) => device.createBuffer({ label, size, usage: 0 });
    return {
        counts: buffer('counts', 16),
        physics: buffer('physics', capacity * 32),
        simulation: buffer('simulation', capacity * 32),
        bodyControlStates: buffer('body-control', capacity * 64)
    };
}

function encodeControl(runtime, sourceTick) {
    runtime.encodeControl({
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups() {}
    }, sourceTick);
}

function writeSummary(runtime, {
    sourceTick,
    groupRevision,
    rosterFingerprint,
    centroidX
}) {
    const view = new DataView(runtime.buffers.summary.data);
    const abi = GPU_TOWER_GROUP_ABI.SUMMARY;
    view.setUint32(abi.ABI_VERSION, GPU_TOWER_GROUP_ABI_VERSION, true);
    view.setUint32(abi.STATUS, 0, true);
    view.setUint32(abi.SESSION_GENERATION, PROTOCOL.sessionGeneration, true);
    view.setUint32(abi.DEVICE_GENERATION, PROTOCOL.deviceGeneration, true);
    view.setUint32(abi.AUTHORITATIVE_EPOCH, PROTOCOL.authoritativeEpoch, true);
    view.setUint32(abi.SOURCE_TICK, sourceTick, true);
    view.setUint32(abi.GROUP_REVISION, groupRevision, true);
    view.setUint32(abi.LIVING_COUNT, 1, true);
    view.setFloat32(abi.CENTROID_X, centroidX, true);
    view.setFloat32(abi.CENTROID_Y, 2, true);
    view.setFloat32(abi.BOUNDS_MIN_X, centroidX - 1, true);
    view.setFloat32(abi.BOUNDS_MIN_Y, 1, true);
    view.setFloat32(abi.BOUNDS_MAX_X, centroidX + 1, true);
    view.setFloat32(abi.BOUNDS_MAX_Y, 3, true);
    view.setUint32(abi.PRIMARY_ENTITY_ID, 1000, true);
    view.setUint32(abi.PRIMARY_INCARNATION, 7, true);
    view.setUint32(abi.LIVING_SHARE_UNITS, 1, true);
    view.setUint32(abi.ROSTER_FINGERPRINT, rosterFingerprint, true);
    view.setUint32(abi.PRIMARY_LOGICAL_ORDINAL, 1, true);
    view.setUint32(abi.EXCLUDED_MEMBER_COUNT, 0, true);
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

test('summary ring pressure는 물리를 막지 않고 out-of-order/old generation 결과를 폐기한다', async () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const runtime = new GpuTowerGroupRuntime({
        capacity: 256,
        readbackSlotCount: 2
    });
    try {
        runtime.initialize(device, createGpuResources(device), PROTOCOL);
        const roster = runtime.synchronizeRoster({
            protocol: PROTOCOL,
            groupRevision: 9,
            members: [createMember(0)]
        });
        for (const [sourceTick, centroidX] of [[1, 10], [2, 20]]) {
            runtime.stageCommand({
                protocol: PROTOCOL,
                sourceTick,
                moveIntent: { x: 1, y: 0 },
                aimWorldPoint: { x: 5, y: 6 }
            });
            encodeControl(runtime, sourceTick);
            writeSummary(runtime, {
                sourceTick,
                groupRevision: roster.groupRevision,
                rosterFingerprint: roster.fingerprint,
                centroidX
            });
            assert.equal(runtime.submitSummary({ sourceTick }), true);
        }
        runtime.stageCommand({
            protocol: PROTOCOL,
            sourceTick: 3,
            moveIntent: { x: 1, y: 0 },
            aimWorldPoint: { x: 5, y: 6 }
        });
        encodeControl(runtime, 3);
        assert.equal(runtime.submitSummary({ sourceTick: 3 }), false);
        assert.equal(runtime.getStatus().droppedSummaryCount, 1);

        runtime.readbackSlots[1].buffer.resolveMap();
        await flushMicrotasks();
        assert.equal(runtime.getLatestSummary().centroid.x, 20);
        runtime.readbackSlots[0].buffer.resolveMap();
        await flushMicrotasks();
        assert.equal(runtime.getLatestSummary().centroid.x, 20);
        assert.equal(runtime.getStatus().staleSummaryCount, 1);
        assert.equal(runtime.getStatus().pendingReadbacks, 0);

        runtime.stageCommand({
            protocol: PROTOCOL,
            sourceTick: 4,
            moveIntent: { x: 0, y: 0 },
            aimWorldPoint: { x: 0, y: 0 }
        });
        encodeControl(runtime, 4);
        writeSummary(runtime, {
            sourceTick: 4,
            groupRevision: roster.groupRevision,
            rosterFingerprint: roster.fingerprint,
            centroidX: 40
        });
        assert.equal(runtime.submitSummary({ sourceTick: 4 }), true);
        const oldSlot = runtime.readbackSlots.find((slot) => slot.inFlight);
        runtime.initialize(device, createGpuResources(device), {
            ...PROTOCOL,
            deviceGeneration: PROTOCOL.deviceGeneration + 1
        });
        oldSlot.buffer.resolveMap();
        await flushMicrotasks();
        assert.equal(runtime.getLatestSummary().valid, false);
        assert.equal(runtime.getLatestSummary().reason, 'awaiting-summary');
    } finally {
        runtime.destroy();
        restore();
    }
});

test('group facade 하나가 move와 primary Aim을 소비하고 tick당 backend command 하나만 만든다', () => {
    const groupRecord = Object.freeze({
        logicalTowerId: 'the-tower',
        logicalTowerOrdinal: 1,
        shareUnits: 1_000_000_000,
        maxHpFixedPoint: 10_000,
        powerFixedPoint: 1_000,
        alive: true,
        exactGpuBinding: Object.freeze({
            entityId: 7,
            incarnation: 2,
            ...PROTOCOL
        })
    });
    const state = {
        getStatus: () => ({ groupRevision: 1, stateRevision: 2 }),
        getTowerRecords: () => [groupRecord]
    };
    let runtimeStatus = {
        state: 'idle',
        groupRevision: 0,
        deviceGeneration: 0,
        authoritativeEpoch: 0
    };
    const stageCalls = [];
    const backend = {
        synchronizeTowerGroupRoster(source) {
            runtimeStatus = {
                state: 'ready',
                groupRevision: source.groupRevision,
                deviceGeneration: PROTOCOL.deviceGeneration,
                authoritativeEpoch: PROTOCOL.authoritativeEpoch
            };
            return Object.freeze({ accepted: true, roster: source });
        },
        getTowerGroupRuntimeStatus: () => runtimeStatus,
        stageTowerGroupCommand(source) {
            stageCalls.push(source);
            return Object.freeze({
                accepted: true,
                commandId: source.commandId
            });
        }
    };
    const facade = new GpuTowerGroupFacade({
        towerGroupState: state,
        camera: {
            viewportToWorld(x, y, out) {
                out.x = x + 100;
                out.y = y - 50;
                return out;
            }
        }
    });
    facade.bindGpuBody({ entityId: 7, incarnation: 2 }, 3);
    assert.equal(facade.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.MOVE_VECTOR,
        payload: { x: 1, y: 1 }
    }), INPUT_DISPOSITIONS.CONSUMED);
    assert.equal(facade.handlePlayerAction({
        type: PLAYER_ACTION_TYPES.PRIMARY_POINTER_FIRE,
        payload: { pressed: true, viewportX: 12, viewportY: 34 }
    }), INPUT_DISPOSITIONS.CONSUMED);
    assert.equal(facade.stageControlForFixedTick(backend, 8).accepted, true);
    assert.equal(facade.stageControlForFixedTick(backend, 8).accepted, true);
    assert.equal(stageCalls.length, 1);
    assert.equal(Math.hypot(
        stageCalls[0].moveIntent.x,
        stageCalls[0].moveIntent.y
    ) <= 1, true);
    assert.deepEqual(stageCalls[0].aimWorldPoint, { x: 112, y: -16 });
    assert.deepEqual(facade.getSharedAimState(8), {
        pressed: true,
        sourceTick: 8,
        aimWorldPoint: { x: 112, y: -16 }
    });
});

test('같은 TowerGroup summary를 반복 관측해도 camera presentation 속도를 보존한다', () => {
    const facade = new GpuTowerGroupFacade();
    facade.bindGpuBody({ entityId: 7, incarnation: 2 }, 3);
    const createFrame = (currentFixedTick) => ({
        currentFixedTick,
        fixedAlpha: 0.5,
        fixedDelta: 0.1,
        presentationProfile: 'reference-clock-extrapolation',
        predictionDelta: 0.05,
        sessionGeneration: PROTOCOL.sessionGeneration,
        deviceGeneration: PROTOCOL.deviceGeneration,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch
    });
    const createSummary = (sourceTick, centroidX) => ({
        valid: true,
        livingCount: 1,
        sourceTick,
        centroid: { x: centroidX, y: 2 },
        bounds: {
            minX: centroidX - 1,
            minY: 1,
            maxX: centroidX + 1,
            maxY: 3
        },
        primaryHandle: { entityId: 7, incarnation: 2 },
        ...PROTOCOL
    });

    assert.equal(facade.updateObservedSummary(
        createSummary(10, 10),
        createFrame(10)
    ), true);
    const movingSummary = createSummary(11, 11);
    assert.equal(facade.updateObservedSummary(
        movingSummary,
        createFrame(12)
    ), true);
    assert.deepEqual(facade.copyCameraFollowPositionInto({}), {
        x: 12.5,
        y: 2
    });

    assert.equal(facade.updateObservedSummary(
        movingSummary,
        createFrame(12)
    ), true);
    assert.deepEqual(
        facade.copyCameraFollowPositionInto({}),
        { x: 12.5, y: 2 },
        '같은 readback을 다시 읽은 렌더 프레임은 속도를 0으로 덮지 않습니다.'
    );
    assert.equal(facade.updateObservedSummary(
        movingSummary,
        createFrame(13)
    ), true);
    assert.deepEqual(facade.copyCameraFollowPositionInto({}), {
        x: 13.5,
        y: 2
    });
});

test('pending Tower creation의 source roster는 stateRevision 변화에도 같은 tick control을 허용한다', () => {
    let stateRevision = 2;
    const state = {
        getStatus: () => ({ groupRevision: 3, stateRevision }),
        getTowerRecords: () => [Object.freeze({
            logicalTowerId: 'the-tower',
            logicalTowerOrdinal: 1,
            shareUnits: 1_000_000_000,
            maxHpFixedPoint: 10_000,
            powerFixedPoint: 1_000,
            alive: true,
            exactGpuBinding: Object.freeze({
                entityId: 7,
                incarnation: 2,
                ...PROTOCOL
            })
        })]
    };
    let synchronizeCount = 0;
    const stageCalls = [];
    let runtimeStatus = {
        state: 'ready',
        groupRevision: 3,
        deviceGeneration: PROTOCOL.deviceGeneration,
        authoritativeEpoch: PROTOCOL.authoritativeEpoch,
        pendingRosterTransition: null
    };
    const backend = {
        synchronizeTowerGroupRoster(source) {
            synchronizeCount++;
            return Object.freeze({ accepted: true, roster: source });
        },
        getTowerGroupRuntimeStatus: () => runtimeStatus,
        stageTowerGroupCommand(source) {
            stageCalls.push(source);
            return Object.freeze({ accepted: true, commandId: source.commandId });
        }
    };
    const facade = new GpuTowerGroupFacade({ towerGroupState: state });
    facade.bindGpuBody({ entityId: 7, incarnation: 2 }, 3);
    assert.equal(facade.synchronizeGpuRoster(backend, true).accepted, true);
    assert.equal(synchronizeCount, 1);

    stateRevision++;
    runtimeStatus = {
        ...runtimeStatus,
        pendingRosterTransition: Object.freeze({
            sourceGroupRevision: 3,
            targetGroupRevision: 4,
            targetRosterFingerprint: 123
        })
    };
    const receipt = facade.stageControlForFixedTick(backend, 8);
    assert.equal(receipt.accepted, true);
    assert.equal(synchronizeCount, 1);
    assert.equal(stageCalls.length, 1);
});

test('TowerGroup shader/통합 경계는 독립 ABI, <=9 storage, body readback 금지를 보존한다', () => {
    assert.deepEqual(GPU_TOWER_GROUP_STORAGE_PROFILE, {
        controlStorageBuffersPerStage: 7,
        summaryStorageBuffersPerStage: 7,
        maximumStorageBuffersPerStage: 7
    });
    assert.match(GPU_TOWER_GROUP_CONTROL_WGSL, /body_controls\.values\[slot\]/);
    assert.match(GPU_TOWER_GROUP_CONTROL_WGSL, /BODY_FLAG_CONTROLLED_THIS_TICK/);
    assert.doesNotMatch(
        GPU_TOWER_GROUP_CONTROL_WGSL,
        /physics\.values\[slot\]\s*=/,
        'group control은 collision/position 결과를 직접 덮어쓰지 않습니다.'
    );
    assert.match(GPU_TOWER_GROUP_SUMMARY_WGSL, /weighted_position/);
    assert.match(GPU_TOWER_GROUP_SUMMARY_WGSL, /member_matches_body/);

    const simulationSource = readFileSync(new URL(
        '../script/module/ingame/physics/gpu/gpu_circle_body_simulation.js',
        import.meta.url
    ), 'utf8');
    const clearIndex = simulationSource.indexOf(
        "this.#dispatchBodies(pass, 'clear_body_control_states')"
    );
    const groupIndex = simulationSource.indexOf(
        'this.towerGroupControlRuntime.encodeControl(',
        clearIndex
    );
    const motionIndex = simulationSource.indexOf(
        "this.#dispatchBodies(pass, 'apply_controlled_motion')",
        groupIndex
    );
    assert.ok(clearIndex >= 0 && groupIndex > clearIndex && motionIndex > groupIndex);

    const gameObjectSource = readFileSync(new URL(
        '../script/module/ingame/object/game_object_system.js',
        import.meta.url
    ), 'utf8');
    assert.match(gameObjectSource, /new GpuTowerGroupFacade/);
    assert.doesNotMatch(
        gameObjectSource,
        /playerControllables\.push\(this\.primaryProjectileController\)/
    );

    const runtime = new GpuTowerGroupRuntime({ capacity: 1 });
    const status = runtime.getStatus();
    assert.equal(status.perTowerCpuCommandCount, 0);
    assert.equal(status.fullBodyReadbackCount, 0);
    assert.equal(status.summaryReadbackBytes, GPU_TOWER_GROUP_ABI.SUMMARY.STRIDE);
});
