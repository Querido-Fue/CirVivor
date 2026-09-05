import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_ACTOR_TRANSIT_ABI,
    GPU_ACTOR_TRANSIT_ABI_VERSION,
    GPU_ACTOR_TRANSIT_PHASE,
    computeActorTransitActivationTick,
    deriveActorTransitGroundVelocity,
    sampleActorTransit
} = await loadGameModule('ingame/physics/gpu/gpu_actor_transit_abi.js');
const {
    GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT,
    GPU_ACTOR_TRANSIT_WGSL,
    GPU_ACTOR_TRANSIT_WORKGROUP_SIZE
} = await loadGameModule('ingame/physics/gpu/gpu_actor_transit_shaders.js');
const {
    GpuActorTransitRuntime
} = await loadGameModule('ingame/physics/gpu/gpu_actor_transit_runtime.js');
const {
    GPU_TOWER_CREATION_ACTOR_ACTION_WGSL
} = await loadGameModule('ingame/physics/gpu/gpu_tower_creation_shaders.js');
const {
    GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_actor_payload_materialization_runtime.js'
);
const {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    R5_THROW_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    actorActionProfileFingerprint
} = await loadGameModule('ingame/contract/actor_action_contract.js');
const {
    ActorPayloadMaterializer
} = await loadGameModule('ingame/word/actor_payload_materializer.js');

function installFakeWebGpuGlobals() {
    const prior = {
        GPUBufferUsage: globalThis.GPUBufferUsage,
        GPUShaderStage: globalThis.GPUShaderStage,
        GPUMapMode: globalThis.GPUMapMode
    };
    globalThis.GPUBufferUsage = Object.freeze({
        MAP_READ: 1,
        COPY_SRC: 4,
        COPY_DST: 8,
        STORAGE: 128,
        INDIRECT: 256
    });
    globalThis.GPUShaderStage = Object.freeze({ COMPUTE: 4 });
    globalThis.GPUMapMode = Object.freeze({ READ: 1 });
    return () => {
        globalThis.GPUBufferUsage = prior.GPUBufferUsage;
        globalThis.GPUShaderStage = prior.GPUShaderStage;
        globalThis.GPUMapMode = prior.GPUMapMode;
    };
}

class FakeBuffer {
    constructor({ label, size }) {
        this.label = label;
        this.size = size;
        this.data = new ArrayBuffer(size);
        this.destroyed = false;
    }

    destroy() { this.destroyed = true; }
    unmap() {}
}

class FakeDevice {
    constructor() {
        this.limits = { maxStorageBuffersPerShaderStage: 9 };
        this.queue = {
            writeBuffer: (target, targetOffset, source) => {
                const bytes = ArrayBuffer.isView(source)
                    ? new Uint8Array(
                        source.buffer,
                        source.byteOffset,
                        source.byteLength
                    )
                    : new Uint8Array(source);
                new Uint8Array(target.data, targetOffset, bytes.byteLength)
                    .set(bytes);
            },
            submit() {}
        };
    }

    createBuffer(descriptor) { return new FakeBuffer(descriptor); }
    createBindGroupLayout(descriptor) { return descriptor; }
    createShaderModule(descriptor) { return descriptor; }
    createPipelineLayout(descriptor) { return descriptor; }
    createBindGroup(descriptor) { return descriptor; }
    createComputePipeline(descriptor) {
        return Object.freeze({ entryPoint: descriptor.compute.entryPoint });
    }
}

function fakeTransitResources(device, capacity) {
    const buffer = (label, stride) => device.createBuffer({
        label,
        size: capacity * stride,
        usage: 0
    });
    return Object.freeze({
        physics: buffer('physics', 32),
        simulation: buffer('simulation', 32),
        abilityMetadata: buffer('ability-metadata', 48),
        enemyBehaviorStates: buffer('enemy-behavior', 80)
    });
}

function createMaterializerHarness({ runtimeUnavailable = false } = {}) {
    const command = Object.freeze({
        executionId: 'throw-enemy-execution',
        executionOrdinal: 7,
        executionIdFingerprint: 707,
        fingerprint: 701,
        actionCode: SENTENCE_ACTION_CODE.THROW,
        payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
        actorActionProfileFingerprint:
            actorActionProfileFingerprint(R5_THROW_ACTOR_ACTION_PROFILE),
        compiledAbility: Object.freeze({
            actorActionProfile: R5_THROW_ACTOR_ACTION_PROFILE,
            budgets: Object.freeze({ generatedBodyCount: 2 })
        })
    });
    const ready = Object.freeze({
        command,
        completion: Object.freeze({
            snapshotToken: Object.freeze({}),
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            commandFingerprint: command.fingerprint,
            snapshotFingerprint: 702,
            subjectCount: 2,
            capacityDemand: 2
        })
    });
    const payloadCompletions = [];
    const transitCompletions = [];
    const settlements = [];
    let drained = false;
    const abilityRuntime = {
        drainReadySnapshots(out) {
            if (!drained) out.push(ready);
            drained = true;
            return out;
        },
        returnReadySnapshot() { return true; },
        markGpuMaterializationPending() { return true; },
        completeSnapshotExecution(record, evidence) {
            settlements.push({ type: 'complete', record, evidence });
            return true;
        },
        rejectSnapshotExecution(record, code, evidence) {
            settlements.push({ type: 'reject', record, code, evidence });
            return true;
        }
    };
    const endpoint = {
        requestActorPayloadMaterialization() {
            return runtimeUnavailable
                ? Object.freeze({
                    accepted: false,
                    runtimeUnavailable: true,
                    reason: 'actor-payload-runtime-unavailable',
                    requiresRecovery: false
                })
                : Object.freeze({
                    accepted: true,
                    destinationFingerprint: 0xdecafbad
                });
        },
        drainCompletedActorPayloadMaterializations(out) {
            out.push(...payloadCompletions.splice(0));
            return out;
        },
        drainCompletedActorTransits(out) {
            out.push(...transitCompletions.splice(0));
            return out;
        },
        cancelPendingActorPayloadMaterializations() {
            return Object.freeze({ cancelledExecutionCount: 0 });
        },
        getActorPayloadMaterializationStatus() {
            return Object.freeze({ requiresRecovery: false });
        }
    };
    return {
        command,
        ready,
        payloadCompletions,
        transitCompletions,
        settlements,
        materializer: new ActorPayloadMaterializer({
            abilityRuntime,
            endpoint
        })
    };
}

test('Throw duration은 권위이고 midpoint/arc/0·1 tick 경계가 결정적이다', () => {
    const source = Object.freeze({
        startTick: 100,
        travelDurationFixedTicks: 10,
        startPosition: Object.freeze({ x: 0, y: 4 }),
        landingPosition: Object.freeze({ x: 10, y: -6 }),
        presentationArcHeight: 7
    });
    assert.equal(computeActorTransitActivationTick(100, 10), 110);
    assert.deepEqual(deriveActorTransitGroundVelocity({
        ...source,
        fixedHz: 60
    }), { x: 60, y: -60 });

    const midpoint = sampleActorTransit(source, 105);
    assert.equal(midpoint.phase, GPU_ACTOR_TRANSIT_PHASE.AIRBORNE);
    assert.deepEqual(midpoint.groundPosition, { x: 5, y: -1 });
    assert.equal(midpoint.presentationArcHeight, 7);
    const tallerArc = sampleActorTransit({
        ...source,
        presentationArcHeight: 14
    }, 105);
    assert.deepEqual(tallerArc.groundPosition, midpoint.groundPosition);
    assert.equal(tallerArc.presentationArcHeight, 14);

    const landed = sampleActorTransit(source, 110);
    assert.equal(landed.phase, GPU_ACTOR_TRANSIT_PHASE.ACTIVE);
    assert.deepEqual(landed.groundPosition, source.landingPosition);
    assert.equal(landed.presentationArcHeight, 0);
    const oneTick = sampleActorTransit({
        ...source,
        travelDurationFixedTicks: 1
    }, 101);
    assert.equal(oneTick.phase, GPU_ACTOR_TRANSIT_PHASE.ACTIVE);
    assert.deepEqual(oneTick.groundPosition, source.landingPosition);
    assert.throws(() => computeActorTransitActivationTick(1, 0));
    assert.throws(() => sampleActorTransit({
        ...source,
        travelDurationFixedTicks: 0
    }, 100));
});

test('persistent transit ABI/pass는 stable-slot parallel, exact identity, <=9 storage를 고정한다', () => {
    assert.equal(GPU_ACTOR_TRANSIT_ABI_VERSION, 2);
    assert.equal(GPU_ACTOR_TRANSIT_ABI.RECORD.STRIDE, 160);
    assert.equal(GPU_ACTOR_TRANSIT_ABI.DISPATCH_ARGS.STRIDE, 16);
    assert.equal(GPU_ACTOR_TRANSIT_STORAGE_BINDING_COUNT, 7);
    assert.equal(GPU_ACTOR_TRANSIT_WORKGROUP_SIZE, 64);
    assert.equal(new Set([...GPU_ACTOR_TRANSIT_WGSL.matchAll(
        /@binding\((\d+)\)/g
    )].map((match) => Number(match[1]))).size, 7);
    const advance = GPU_ACTOR_TRANSIT_WGSL.slice(
        GPU_ACTOR_TRANSIT_WGSL.indexOf('fn advance_actor_transits'),
        GPU_ACTOR_TRANSIT_WGSL.indexOf('fn seal_actor_transit_aggregate')
    );
    assert.doesNotMatch(advance, /\bloop\s*\{/);
    assert.doesNotMatch(advance, /\bfor\s*\(/);
    assert.match(advance, /simulations\.values\[slot\]\.entity_id/);
    assert.match(advance, /physics\.values\[slot\]\.physical_meta = 0u/);
    assert.match(advance, /metadata\.values\[slot\]\.noun_mask = 0u/);
    assert.match(advance, /simulations\.values\[slot\]\.flow_speed = 0\.0/);
    assert.match(advance, /physics\.values\[slot\]\.position = landing/);
    assert.doesNotMatch(advance, /SOURCE_ENTITY_ID/);

    for (const shader of [
        GPU_TOWER_CREATION_ACTOR_ACTION_WGSL,
        GPU_ACTOR_ACTION_ENEMY_MATERIALIZATION_WGSL
    ]) {
        assert.equal(new Set([...shader.matchAll(
            /@binding\((\d+)\)/g
        )].map((match) => Number(match[1]))).size, 9);
        assert.match(shader, /PERSISTENT_TRANSIT_AIRBORNE/);
        assert.match(shader, /REQUIRED_TRANSIT_FLAGS/);
        assert.match(shader, /transit_record_fingerprint/);
    }
});

test('256 actor batch, ABA, source-death independence, terminal/recovery promotion identity를 보존한다', () => {
    const restore = installFakeWebGpuGlobals();
    const device = new FakeDevice();
    const runtime = new GpuActorTransitRuntime({
        sessionGeneration: 1,
        readbackSlotCount: 2
    });
    try {
        runtime.initialize(
            device,
            fakeTransitResources(device, 256),
            {
                sessionGeneration: 1,
                deviceGeneration: 2,
                authoritativeEpoch: 3,
                bodyCapacity: 256
            }
        );
        const handles = Object.freeze(Array.from(
            { length: 256 },
            (_, index) => Object.freeze({
                entityId: index + 1,
                incarnation: 4
            })
        ));
        assert.equal(runtime.registerCommittedBatch({
            transactionId: 'throw-256',
            completionOwner: 'tower-creation',
            handles,
            startTick: 20,
            durationFixedTicks: 1,
            actionCode: SENTENCE_ACTION_CODE.THROW,
            payloadCode: ACTOR_PAYLOAD_CODE.TOWER,
            executionOrdinal: 9,
            executionFingerprint: 901,
            actorActionProfileFingerprint: 902,
            placementFingerprint: 903
        }), true);
        assert.equal(runtime.getStatus().activeActorCount, 256);
        assert.equal(runtime.getStatus().perActorCpuAdvanceCount, 0);
        assert.equal(
            runtime.getStatus().dispatchModel,
            'stable-slot-indirect-workgroups'
        );
        assert.equal(runtime.isAirborne(handles[0]), true);
        assert.equal(runtime.isAirborne({
            entityId: handles[0].entityId,
            incarnation: handles[0].incarnation + 1
        }), false);

        // Source identity는 launch 후 생사와 무관하고 destination ABA만 exact하다.
        runtime.cancelAll('terminal-or-recovery');
        assert.equal(runtime.isAirborne(handles[0]), false);
        const completions = runtime.drainCompleted([]);
        assert.equal(completions.length, 1);
        assert.equal(completions[0].state, 'CANCELLED');
        assert.equal(completions[0].actorActionProfileFingerprint, 902);
        assert.equal(completions[0].placementFingerprint, 903);
        assert.equal(completions[0].executionFingerprint, 901);
        assert.equal(completions[0].handles.length, 256);
    } finally {
        runtime.destroy();
        restore();
    }
});

test('Enemy Throw는 launch에서 cooldown을 commit하되 hostile handle은 landing 뒤 공개한다', () => {
    const harness = createMaterializerHarness();
    const stage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: 30
    });
    assert.equal(stage.stagedCount, 1);
    const handles = Object.freeze([
        Object.freeze({ entityId: 11, incarnation: 2 }),
        Object.freeze({ entityId: 12, incarnation: 3 })
    ]);
    harness.payloadCompletions.push(Object.freeze({
        transactionId: 'actor-payload.r3:throw-enemy-execution',
        executionOrdinal: harness.command.executionOrdinal,
        commandFingerprint: harness.command.fingerprint,
        snapshotFingerprint: 702,
        subjectCount: 2,
        destinationCount: 2,
        copiesPerSubject: 1,
        modifierSetFingerprint: 0,
        destinationFingerprint: 0xdecafbad,
        generatedCount: 2,
        materializationTargetTick: 30,
        status: ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE,
        state: 'COMMITTED_AIRBORNE',
        committed: true,
        airborne: true,
        handles,
        requiresRecovery: false
    }));
    const launched = harness.materializer.observeCompleted(31);
    assert.equal(launched.committedCount, 1);
    assert.deepEqual(launched.committedHandles, []);
    assert.equal(harness.settlements.length, 1);
    assert.equal(harness.settlements[0].type, 'complete');

    harness.transitCompletions.push(Object.freeze({
        transactionId: 'actor-payload.r3:throw-enemy-execution',
        state: 'LANDED',
        landed: true,
        handles,
        requiresRecovery: false
    }));
    const landing = harness.materializer.observeCompleted(32);
    assert.deepEqual(landing.committedHandles, handles);
    assert.equal(harness.settlements.length, 1);
});

test('Throw runtime unavailable은 protocol failure/cooldown mutation이 아닌 정상 거절이다', () => {
    const harness = createMaterializerHarness({ runtimeUnavailable: true });
    const stage = harness.materializer.stageReadyForFixedTick({
        targetFixedTick: 40
    });
    assert.equal(stage.stagedCount, 0);
    assert.equal(stage.rejectedCount, 1);
    assert.equal(stage.recoveryRequired, false);
    assert.equal(harness.settlements.length, 1);
    assert.equal(harness.settlements[0].type, 'reject');
    assert.equal(harness.materializer.getStatus().totalRuntimeUnavailable, 1);
});
