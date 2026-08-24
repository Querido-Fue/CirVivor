import {
    WAVE_OVERTIME_DAMAGE_BASIS,
    createWaveResolutionProfile
} from './production/script/module/ingame/contract/wave_resolution_contract.js';
import {
    createWaveQuiescenceSnapshot
} from './production/script/module/ingame/contract/wave_quiescence_contract.js';
import {
    WAVE_RUN_FINAL_CONTINUE_RESULT,
    WAVE_RUN_STATE
} from './production/script/module/ingame/contract/wave_run_state_contract.js';
import {
    createWaveRunPlan,
    getWaveRunPlanFingerprint,
    getWaveRunPlanWaveMetadata
} from './production/script/module/ingame/contract/wave_run_plan_contract.js';
import {
    CoreOvertimePressureDirector
} from './production/script/module/ingame/flow/core_overtime_pressure_director.js';
import {
    WaveRunCoordinator
} from './production/script/module/ingame/flow/wave_run_coordinator.js';
import {
    CoreIntegrity
} from './production/script/module/ingame/state/core_integrity.js';
import {
    RunOutcome
} from './production/script/module/ingame/state/run_outcome.js';

const resultPath = process.env.CIRVIVOR_WEBGPU_RESULT_PATH;
const HOSTILE_COUNT = 2;
const HOSTILE_RECORD_BYTES = 16;
const HOSTILE_BUFFER_BYTES = HOSTILE_COUNT * HOSTILE_RECORD_BYTES;
const LITTLE_ENDIAN = true;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

const HOSTILE_LIFECYCLE_SHADER = /* wgsl */`
struct HostileRecord {
    alive: u32,
    siege_weight_fixed: u32,
    entity_id: u32,
    incarnation: u32,
}

struct Operation {
    value: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> hostiles: array<HostileRecord>;
@group(0) @binding(1) var<uniform> operation: Operation;

@compute @workgroup_size(2)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= 2u) {
        return;
    }
    if (operation.value == 0u) {
        hostiles[id.x].alive = 1u;
        hostiles[id.x].siege_weight_fixed = select(4000u, 8000u, id.x == 1u);
        hostiles[id.x].entity_id = 100u + id.x;
        hostiles[id.x].incarnation = 1u;
        return;
    }
    if (operation.value == 1u && id.x == 0u) {
        hostiles[id.x].alive = 0u;
        return;
    }
    if (operation.value == 2u) {
        hostiles[id.x].alive = 0u;
    }
}
`;

function createGpuHostileLifecycle(device) {
    const hostileBuffer = device.createBuffer({
        label: 'R9 actual hostile records',
        size: HOSTILE_BUFFER_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    const operationBuffer = device.createBuffer({
        label: 'R9 actual hostile lifecycle operation',
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const module = device.createShaderModule({
        label: 'R9 actual hostile lifecycle shader',
        code: HOSTILE_LIFECYCLE_SHADER
    });
    const pipeline = device.createComputePipeline({
        label: 'R9 actual hostile lifecycle pipeline',
        layout: 'auto',
        compute: { module, entryPoint: 'main' }
    });
    const bindGroup = device.createBindGroup({
        label: 'R9 actual hostile lifecycle bindings',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: hostileBuffer } },
            { binding: 1, resource: { buffer: operationBuffer } }
        ]
    });

    async function dispatch(operation) {
        const words = new Uint32Array(4);
        words[0] = operation;
        device.queue.writeBuffer(operationBuffer, 0, words);
        const encoder = device.createCommandEncoder({
            label: `R9 hostile operation ${operation}`
        });
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(1);
        pass.end();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
    }

    async function readAggregate() {
        const readback = device.createBuffer({
            label: 'R9 actual hostile readback',
            size: HOSTILE_BUFFER_BYTES,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        const encoder = device.createCommandEncoder({
            label: 'R9 hostile aggregate readback'
        });
        encoder.copyBufferToBuffer(
            hostileBuffer,
            0,
            readback,
            0,
            HOSTILE_BUFFER_BYTES
        );
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const bytes = readback.getMappedRange().slice(0);
        readback.unmap();
        readback.destroy();
        const view = new DataView(bytes);
        const handles = [];
        let hostileActorCount = 0;
        let siegeWeightFixedPoint = 0;
        for (let index = 0; index < HOSTILE_COUNT; index++) {
            const base = index * HOSTILE_RECORD_BYTES;
            const alive = view.getUint32(base, LITTLE_ENDIAN) === 1;
            if (!alive) continue;
            hostileActorCount++;
            siegeWeightFixedPoint += view.getUint32(base + 4, LITTLE_ENDIAN);
            handles.push(Object.freeze({
                entityId: view.getUint32(base + 8, LITTLE_ENDIAN),
                incarnation: view.getUint32(base + 12, LITTLE_ENDIAN)
            }));
        }
        return Object.freeze({
            hostileActorCount,
            siegeWeightFixedPoint,
            siegeWeight: siegeWeightFixedPoint / 1_000,
            handles: Object.freeze(handles)
        });
    }

    return Object.freeze({
        dispatch,
        readAggregate,
        destroy() {
            hostileBuffer.destroy();
            operationBuffer.destroy();
        }
    });
}

function createProfile() {
    return createWaveResolutionProfile({
        profileId: 'r9-actual-overtime-profile',
        combatDurationTicks: 1,
        requireAllHostilesCleared: true,
        overtime: {
            enabled: true,
            graceTicks: 1,
            pulseIntervalTicks: 2,
            damageBasis: WAVE_OVERTIME_DAMAGE_BASIS.SIEGE_WEIGHT,
            minimumDamageFixedPoint: 0,
            damagePerSiegeWeightNumerator: 250,
            damagePerSiegeWeightDenominator: 1_000,
            maximumDamageFixedPoint: 100_000
        },
        settlement: {
            completionGoldBonus: 0,
            openShop: true
        }
    });
}

function createPlan(profile) {
    const mapId = 'r9-actual-overtime-map';
    const waveDefinition = Object.freeze({
        waveId: 'r9-actual-overtime-wave',
        mapId,
        enemyModifiers: Object.freeze({}),
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: 'r9-actual-overtime-entry',
            type: 'SPAWN_GROUP',
            spawnGroup: Object.freeze({})
        })])
    });
    return createWaveRunPlan({
        planId: 'r9-actual-overtime-plan',
        mapId,
        waves: [{
            waveOrdinal: 1,
            waveDefinition,
            resolutionProfileId: profile.profileId
        }],
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    }, {
        resolutionProfileById: Object.freeze({ [profile.profileId]: profile })
    });
}

function createCpuHarness(runSessionId, maxIntegrity) {
    const profile = createProfile();
    const plan = createPlan(profile);
    const coordinator = new WaveRunCoordinator({ plan, runSessionId });
    const coreIntegrity = new CoreIntegrity({ maxIntegrity });
    const runOutcome = new RunOutcome();
    const director = new CoreOvertimePressureDirector({
        coreIntegrity,
        runOutcome,
        waveRunCoordinator: coordinator
    });
    const waveId = getWaveRunPlanWaveMetadata(plan, 1).waveId;
    coordinator.startPlan({
        transactionId: `${runSessionId}:start`,
        runSessionId,
        planId: plan.planId,
        planFingerprint: getWaveRunPlanFingerprint(plan)
    });
    coordinator.beginWave({
        transactionId: `${runSessionId}:begin`,
        runSessionId,
        planId: plan.planId,
        waveOrdinal: 1,
        waveId,
        startingFixedTick: 0
    });
    coordinator.observeClockTick({
        transactionId: `${runSessionId}:clock:1`,
        runSessionId,
        planId: plan.planId,
        waveOrdinal: 1,
        waveId,
        proposedElapsedCombatTicks: 1,
        completedFixedTick: 1,
        intentionalPause: false,
        completed: true
    });
    return Object.freeze({
        profile,
        plan,
        waveId,
        coordinator,
        coreIntegrity,
        runOutcome,
        director
    });
}

function createSnapshot(harness, aggregate, revision, fixedTick) {
    return createWaveQuiescenceSnapshot({
        snapshotRevision: revision,
        fixedTick,
        protocol: {
            sessionGeneration: 1,
            deviceGeneration: 1,
            authoritativeEpoch: 1
        },
        wave: {
            mapId: harness.plan.mapId,
            waveId: harness.waveId,
            waveOrdinal: 1,
            initialized: true,
            totalSpawnCount: 2,
            queuedSpawnCount: 2,
            remainingSpawnCount: 0,
            blockedSpawnCount: 0,
            allSpawnsQueued: true,
            completionOwned: false
        },
        hostile: {
            revision,
            registryRevision: revision,
            countExact: true,
            liveHostileActorCount: aggregate.hostileActorCount,
            pendingHostileActorCount: 0,
            hostileActorCount: aggregate.hostileActorCount
        },
        pending: {
            hostileLifecycleSpawnCount: 0,
            hostileMaterializationCount: 0,
            hostileTransitCount: 0,
            hostileAtomicTransformCount: 0,
            lifecycleCommandCount: 0,
            materializationWorkCount: 0,
            transitActorCount: 0,
            atomicTransformWorkCount: 0
        },
        events: {
            lastSubmittedTick: 1,
            lastCompletedTick: 1,
            completedThroughTick: 1,
            deferredBatchCount: 0,
            protocolFailure: false
        },
        registryRevision: revision,
        run: {
            running: harness.runOutcome.isRunning(),
            defeated: harness.runOutcome.isDefeated(),
            coreDepleted: harness.coreIntegrity.isDepleted(),
            recoveryRequired: false
        }
    });
}

function hostileStatus(snapshot, aggregate) {
    return Object.freeze({
        revision: snapshot.hostile.revision,
        registryRevision: snapshot.hostile.registryRevision,
        countExact: true,
        liveHostileActorCount: aggregate.hostileActorCount,
        pendingHostileActorCount: 0,
        hostileActorCount: aggregate.hostileActorCount,
        siegeWeight: aggregate.siegeWeight
    });
}

function observePressure(harness, snapshot, aggregate, completedFixedTick) {
    harness.coordinator.evaluateWaveQuiescence(snapshot);
    return harness.director.observeFixedBoundary({
        fixedTick: snapshot.fixedTick,
        completedFixedTick,
        completedBoundary: true,
        intentionalPause: false,
        recoveryRequired: false,
        snapshot,
        hostileStatus: hostileStatus(snapshot, aggregate)
    });
}

function findPulse(result) {
    return result.facts.find((fact) => fact.type === 'OvertimePulse') ?? null;
}

async function runFixture(device) {
    const gpu = createGpuHostileLifecycle(device);
    try {
        await gpu.dispatch(0);
        const created = await gpu.readAggregate();
        assert(created.hostileActorCount === 2, 'GPU hostile create count mismatch');
        assert(created.siegeWeight === 12, 'GPU hostile siege total mismatch');

        const normal = createCpuHarness('r9-actual-normal', 10);
        const entrySnapshot = createSnapshot(normal, created, 1, 2);
        const entry = normal.coordinator.evaluateWaveQuiescence(entrySnapshot);
        assert(entry.state === WAVE_RUN_STATE.OVERTIME,
            'R9 actual fixture did not enter OVERTIME');
        const firstSnapshot = createSnapshot(normal, created, 2, 3);
        const first = observePressure(normal, firstSnapshot, created, 2);
        const firstPulse = findPulse(first);
        assert(firstPulse?.requestedDamage === 3,
            'R9 first overtime damage mismatch');

        await gpu.dispatch(1);
        const oneRemaining = await gpu.readAggregate();
        assert(oneRemaining.hostileActorCount === 1,
            'GPU first hostile death mismatch');
        assert(oneRemaining.siegeWeight === 8,
            'GPU remaining hostile siege mismatch');
        const secondSnapshot = createSnapshot(normal, oneRemaining, 3, 5);
        const second = observePressure(normal, secondSnapshot, oneRemaining, 4);
        const secondPulse = findPulse(second);
        assert(secondPulse?.requestedDamage === 2,
            'R9 second overtime damage mismatch');

        await gpu.dispatch(2);
        const cleared = await gpu.readAggregate();
        assert(cleared.hostileActorCount === 0,
            'GPU final hostile death mismatch');
        const clearSnapshot = createSnapshot(normal, cleared, 4, 7);
        const finalBoundary = observePressure(normal, clearSnapshot, cleared, 6);
        assert(normal.coordinator.getStatus().state
            === WAVE_RUN_STATE.CLEAR_CANDIDATE,
        'R9 actual final hostile did not clear wave');
        assert(findPulse(finalBoundary) === null,
            'R9 actual final death did not suppress due pulse');

        await gpu.dispatch(0);
        const lethalCreated = await gpu.readAggregate();
        const lethal = createCpuHarness('r9-actual-lethal', 1);
        const lethalEntry = createSnapshot(lethal, lethalCreated, 1, 2);
        lethal.coordinator.evaluateWaveQuiescence(lethalEntry);
        const lethalSnapshot = createSnapshot(lethal, lethalCreated, 2, 3);
        const lethalBoundary = observePressure(
            lethal,
            lethalSnapshot,
            lethalCreated,
            2
        );
        assert(lethalBoundary.defeated === true,
            'R9 actual lethal pulse did not defeat run');
        assert(lethal.runOutcome.isDefeated(),
            'R9 actual RunOutcome was not sealed');
        assert(lethal.coordinator.getStatus().state
            === WAVE_RUN_STATE.RUN_DEFEATED,
        'R9 actual WaveRun was not defeated');

        return Object.freeze({
            scenario: 'r9-overtime-pressure-actual-webgpu',
            gpuCreateCount: created.hostileActorCount,
            gpuCreateSiegeWeight: created.siegeWeight,
            createdHandles: created.handles,
            firstPulseDamage: firstPulse.requestedDamage,
            firstPulseOrdinal: firstPulse.overtimePulseOrdinal,
            remainingCountAfterFirstDeath: oneRemaining.hostileActorCount,
            remainingSiegeWeightAfterFirstDeath: oneRemaining.siegeWeight,
            secondPulseDamage: secondPulse.requestedDamage,
            secondPulseOrdinal: secondPulse.overtimePulseOrdinal,
            finalHostileCount: cleared.hostileActorCount,
            finalPulseSuppressed: findPulse(finalBoundary) === null,
            finalWaveState: normal.coordinator.getStatus().state,
            finalCoreIntegrity: normal.coreIntegrity.getCurrentIntegrity(),
            lethal: Object.freeze({
                defeated: lethalBoundary.defeated,
                coreDepleted: lethal.coreIntegrity.isDepleted(),
                runFailedFactCount: lethal.director.getFacts().filter(
                    (fact) => fact.type === 'RunFailed'
                ).length,
                waveFailedFactCount: lethal.coordinator.getFacts().filter(
                    (fact) => fact.type === 'WaveFailed'
                ).length,
                waveState: lethal.coordinator.getStatus().state
            }),
            hostileBufferBytes: HOSTILE_BUFFER_BYTES,
            storageMaximum: 2,
            recoveryRequired: normal.director.requiresRecovery()
                || lethal.director.requiresRecovery()
        });
    } finally {
        gpu.destroy();
    }
}

async function run() {
    const result = {
        status: 'fail',
        runtime: {
            nw: process.versions.nw || '',
            chrome: process.versions.chrome || '',
            protocol: location.protocol,
            secureContext: isSecureContext
        }
    };
    let device = null;
    try {
        assert(resultPath, 'CIRVIVOR_WEBGPU_RESULT_PATH missing');
        assert(isSecureContext, `secure context required: ${location.protocol}`);
        assert(navigator.gpu, 'navigator.gpu unavailable');
        const adapter = await navigator.gpu.requestAdapter({
            powerPreference: 'high-performance'
        });
        assert(adapter, 'WebGPU adapter unavailable');
        assert(adapter.limits.maxStorageBuffersPerShaderStage >= 9,
            'WebGPU storage buffer limit below 9');
        result.adapterMaxStorageBuffersPerShaderStage
            = adapter.limits.maxStorageBuffersPerShaderStage;
        result.requestedMaxStorageBuffersPerShaderStage = 9;
        device = await adapter.requestDevice({
            requiredLimits: { maxStorageBuffersPerShaderStage: 9 }
        });
        result.deviceMaxStorageBuffersPerShaderStage
            = device.limits.maxStorageBuffersPerShaderStage;
        const uncapturedErrors = [];
        device.addEventListener('uncapturederror', (event) => {
            uncapturedErrors.push(event.error?.message ?? String(event.error));
        });
        result.r9OvertimePressure = await runFixture(device);
        await device.queue.onSubmittedWorkDone();
        result.uncapturedErrorCount = uncapturedErrors.length;
        assert(uncapturedErrors.length === 0,
            `uncaptured WebGPU error: ${uncapturedErrors.join(' | ')}`);
        const lostPromise = device.lost;
        device.destroy();
        const lost = await lostPromise;
        result.deviceLostReason = lost.reason;
        assert(lost.reason === 'destroyed',
            `device lost reason: ${lost.reason}`);
        result.status = 'pass';
    } catch (error) {
        result.error = error?.stack ?? String(error);
        try { device?.destroy(); } catch { /* best effort */ }
    }
    require('node:fs').writeFileSync(
        resultPath,
        `${JSON.stringify(result, null, 2)}\n`,
        'utf8'
    );
    nw.App.quit();
}

run();
