import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const NW_WEBGPU_CAPABILITY_RUNNER_SOURCE = await readFile(
    new URL('./nw_webgpu_capability/runner.js', import.meta.url),
    'utf8'
);
const NW_WEBGPU_CAPABILITY_SUPPORT_SOURCE = await readFile(
    new URL('./support/run_nw_webgpu_capability.mjs', import.meta.url),
    'utf8'
);

const {
    GpuSimulationEndpoint,
    GpuEnemySimulationEndpoint,
    GPU_BODY_CONTROL_PROGRAM_MODE,
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_SELECTION_POLICY,
    GPU_BODY_CONTROL_STATE_FLAGS,
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    createGpuSimulationEndpoint
} = await loadGameModule('ingame/gpu_simulation_endpoint.js');
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    GPU_SPAWN_PROGRAM_MODE
} = await loadGameModule('ingame/physics/gpu/gpu_fixed_primitive_abi.js');
const {
    GPU_PROJECTILE_CAPTURE_ROLE
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION
} = await loadGameModule('ingame/contract/projectile_capture_contract.js');
const {
    BASIC_RHOM_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    BASIC_RHOM_ATTACK_DATA
} = await loadGameModule('data/object/enemy/basic_rhom_attack_data.js');
const {
    HOSTILE_RHOM_PROJECTILE_DATA
} = await loadGameModule(
    'data/object/projectile/hostile_rhom_projectile_data.js'
);
const {
    createGpuEnemySpawnIntent
} = await loadGameModule('ingame/object/enemy/gpu_enemy_spawn_adapter.js');
const {
    createGpuCoreProxySpawnIntent
} = await loadGameModule('ingame/object/core/gpu_core_proxy_spawn_adapter.js');
const {
    createGpuTowerSpawnIntent
} = await loadGameModule('ingame/object/tower/gpu_tower_spawn_adapter.js');
const {
    createGpuSelectedTargetProjectileIntent
} = await loadGameModule(
    'ingame/object/projectile/gpu_projectile_spawn_adapter.js'
);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function createCanonicalSpawnIntent(
    definitionId = 'fixed_primitive_fixture',
    overrides = {}
) {
    return {
        kindId: 'projectile',
        definitionId,
        projectileCapturePolicyId:
            PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE,
        schemaVersion: PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
        archetypeId: definitionId,
        wordTagMask: 0,
        modifierSetId: null,
        sourceExecutionId: null,
        projectileGeneration: 1,
        originProducerId: null,
        originSourceAbilityId: null,
        originOwnerEntityId: null,
        originOwnerIncarnation: null,
        originSourceEntityId: null,
        originSourceIncarnation: null,
        originTargetEntityId: null,
        originTargetIncarnation: null,
        projectileCaptureState: Object.freeze({
            role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
        }),
        position: { x: 1, y: 2 },
        velocity: { x: 0.5, y: -0.25 },
        radius: 0.2,
        inverseMass: 1,
        bodyLayer: 0x0002,
        collisionMask: 0x0001,
        interactionLayer: 0x0004,
        interactionMask: 0x0008,
        alive: true,
        health: 1,
        penetration: 1,
        damageSelf: 0,
        damageOther: 0,
        lifetimeRemaining: 5,
        teamId: GAMEPLAY_TEAM_ID.PLAYER,
        damagePolicyId: GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        ...overrides
    };
}

test('default actual fixed primitive projectile fixture는 canonical capture ingress를 보존한다', () => {
    const start = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        'function createPhase3SpawnIntent('
    );
    const end = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        '\nfunction integrateTowerControlOracle(',
        start
    );
    assert.ok(start >= 0 && end > start);
    const helperSource = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.slice(start, end);
    for (const marker of [
        "kindId === 'projectile'",
        'PROJECTILE_CAPTURE_POLICY_ID.NOT_CAPTURABLE',
        'PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION',
        'archetypeId: definitionId',
        'projectileGeneration: 1',
        'originProducerId: null',
        'originSourceAbilityId: null',
        'originOwnerEntityId: null',
        'originSourceEntityId: null',
        'originTargetEntityId: null',
        'role: GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE'
    ]) {
        assert.ok(helperSource.includes(marker), `Phase 3 helper marker 누락: ${marker}`);
    }

    const boundaryStart = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        'function commitPhase3CompletionBoundary('
    );
    const boundaryEnd = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        '\nasync function deviceQueueDone(',
        boundaryStart
    );
    assert.ok(boundaryStart >= 0 && boundaryEnd > boundaryStart);
    const boundarySource = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.slice(
        boundaryStart,
        boundaryEnd
    );
    const captureIndex = boundarySource.indexOf(
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary'
    );
    const releaseIndex = boundarySource.indexOf(
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary'
    );
    const genericIndex = boundarySource.indexOf(
        'commitCompletedEventsAtFixedBoundary'
    );
    assert.ok(
        captureIndex >= 0
            && releaseIndex > captureIndex
            && genericIndex > releaseIndex
    );
    assert.match(
        NW_WEBGPU_CAPABILITY_RUNNER_SOURCE,
        /commitPhase3CompletionBoundary\(\s*endpoint,\s*11,\s*'Phase 3 source-relative'/
    );

    const publicationStart = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        'function installProductionCompletionPublicationOrder('
    );
    const publicationEnd = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        '\nfunction createGpuSimulationEndpoint(',
        publicationStart
    );
    assert.ok(publicationStart >= 0 && publicationEnd > publicationStart);
    const publicationSource = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.slice(
        publicationStart,
        publicationEnd
    );
    const publicationCaptureIndex = publicationSource.indexOf(
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary'
    );
    const publicationReleaseIndex = publicationSource.indexOf(
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary'
    );
    const publicationGenericIndex = publicationSource.indexOf(
        'commitGenericEvents(targetFixedTick)'
    );
    assert.ok(
        publicationCaptureIndex >= 0
            && publicationReleaseIndex > publicationCaptureIndex
            && publicationGenericIndex > publicationReleaseIndex
    );

    const saturationStart = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        "const poseRingBurstPolicy =\n            'intentional-no-settle-or-publication-backpressure-window'"
    );
    const saturationEnd = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.indexOf(
        'const activeBeforeCapacityReject',
        saturationStart
    );
    assert.ok(saturationStart >= 0 && saturationEnd > saturationStart);
    const saturationSource = NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.slice(
        saturationStart,
        saturationEnd
    );
    const saturationLoopStart = saturationSource.indexOf(
        'for (let tick = 11; tick <= 16; tick++)'
    );
    const saturationSettleStart = saturationSource.indexOf(
        'await device.queue.onSubmittedWorkDone()'
    );
    assert.ok(
        saturationLoopStart >= 0 && saturationSettleStart > saturationLoopStart
    );
    const saturationLoop = saturationSource.slice(
        saturationLoopStart,
        saturationSettleStart
    );
    assert.ok(saturationLoop.includes('endpoint.fixedUpdate(fixedDelta, tick)'));
    assert.ok(!saturationLoop.includes('await '));
    assert.ok(!saturationLoop.includes('commitCompletedEventsAtFixedBoundary'));
});

test('default actual stale target/control fixtures는 completion coherence와 GPU ABA evidence를 분리한다', () => {
    for (const marker of [
        'runProductionTargetEntityDeathBeforeRequestHardwareSmoke',
        "scenario: 'target-death-published-before-target-entity-request'",
        "publicationPolicy: 'capture-release-generic-per-boundary'",
        "shotRequest.reason === 'stale-target'",
        'const slotAba = await runProductionTargetEntitySlotAbaHardwareSmoke',
        "slotAba.outcome.reason === 'target-invalid'",
        "scenario: 'tower-lethal-published-then-stale-control-rejected'",
        "code === 'stale-handle'",
        'deadControlGpuSubmitted: false',
        "scenario: 'target-death-published-before-hostile-shot-commit'",
        'const targetDeathCompleted = endpoint.commitCompletedEventsAtFixedBoundary(',
        "code === 'stale-target'",
        "rejectionPhase: 'fixed-commit-after-death-publication'",
        "targetInvalid.outcome === 'stale-target'"
    ]) {
        assert.ok(
            NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.includes(marker),
            `coherent actual fixture marker 누락: ${marker}`
        );
    }
    assert.ok(
        !NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.includes(
            'runProductionTargetEntityDeathBeforeResolveHardwareSmoke'
        )
    );
    assert.ok(
        !NW_WEBGPU_CAPABILITY_RUNNER_SOURCE.includes(
            "scenario: 'tower-lethal-then-exact-dead-control-two-submit'"
        )
    );
    for (const marker of [
        "=== 'tower-lethal-published-then-stale-control-rejected'",
        'fixture.deadControlGpuSubmitted === false',
        "fixture.submissions.deadControl.rejectionCode === 'stale-handle'",
        'fixture.submissions.deadControl.publishedBatchCountBeforeCommit === 1'
    ]) {
        assert.ok(
            NW_WEBGPU_CAPABILITY_SUPPORT_SOURCE.includes(marker),
            `coherent support schema marker 누락: ${marker}`
        );
    }
});

function createPrimitiveBackend(options = {}) {
    const bodies = new Map();
    const calls = [];
    const completedBodyControlProgramBatches = [];
    const completedSpawnProgramBatches = [];
    const completedEventBatches = [];
    let protocol = Object.freeze({
        sessionGeneration: 1,
        deviceGeneration: 1,
        authoritativeEpoch: 1,
        submittedTickCount: 0
    });
    let trackedPose = null;
    let destroyed = false;

    const backend = {
        bodies,
        calls,
        completedBodyControlProgramBatches,
        completedSpawnProgramBatches,
        completedEventBatches,
        setProtocol(next) {
            protocol = Object.freeze({ ...next });
        },
        setTrackedPose(next) {
            trackedPose = next;
        },
        queueSpawnProgramBatch(batch) {
            completedSpawnProgramBatches.push(batch);
        },
        queueBodyControlProgramBatch(batch) {
            completedBodyControlProgramBatches.push(batch);
        },
        queueEventBatch(batch) {
            completedEventBatches.push(batch);
        },
        getCapacity() {
            return options.capacity ?? 8;
        },
        init(tileMap) {
            calls.push({ type: 'init', tileMap });
            return true;
        },
        spawnBodies(source) {
            const batch = Array.from(source);
            calls.push({ type: 'spawnBodies', bodies: batch });
            const handles = batch.map((body) => {
                const handle = Object.freeze({
                    entityId: body.entityId,
                    incarnation: body.incarnation
                });
                bodies.set(handleKey(handle), body);
                return handle;
            });
            return {
                accepted: batch.length,
                rejected: 0,
                handles,
                requiresRecovery: false
            };
        },
        despawnBodies(source) {
            const handles = Array.from(source);
            calls.push({ type: 'despawnBodies', handles });
            let removed = 0;
            for (const handle of handles) {
                removed += bodies.delete(handleKey(handle)) ? 1 : 0;
            }
            return {
                removed,
                rejected: handles.length - removed,
                requiresRecovery: false
            };
        },
        hasBody(handle) {
            return bodies.has(handleKey(handle));
        },
        hasActiveBodies() {
            return bodies.size > 0;
        },
        canControlBody(handle) {
            calls.push({ type: 'canControlBody', handle });
            return bodies.has(handleKey(handle));
        },
        stageFixedPrograms(plan) {
            calls.push({ type: 'stageFixedPrograms', plan });
            for (const entry of plan.sourceRelativeSpawns) {
                bodies.set(
                    handleKey(entry.destinationHandle),
                    entry.destinationSpawn
                );
            }
            const controlCount = plan.controls.length;
            const spawnCount = plan.sourceRelativeSpawns.length;
            return {
                accepted: controlCount + spawnCount,
                rejected: 0,
                requiresRecovery: false,
                controls: {
                    accepted: controlCount,
                    rejected: 0,
                    reason: null
                },
                sourceRelativeSpawns: {
                    accepted: spawnCount,
                    rejected: 0,
                    reason: null
                }
            };
        },
        drainCompletedSpawnProgramBatches(out = []) {
            calls.push({ type: 'drainCompletedSpawnProgramBatches' });
            for (const batch of completedSpawnProgramBatches.splice(0)) {
                for (const outcome of batch.outcomes ?? []) {
                    if (outcome.reason === 'source-invalid'
                        || outcome.reason === 'target-invalid') {
                        bodies.delete(handleKey(outcome.destinationHandle));
                    }
                }
                out.push(batch);
            }
            return out;
        },
        drainCompletedBodyControlProgramBatches(out = []) {
            calls.push({ type: 'drainCompletedBodyControlProgramBatches' });
            out.push(...completedBodyControlProgramBatches.splice(0));
            return out;
        },
        hasPendingSpawnProgramThroughTick(sourceTick) {
            calls.push({ type: 'hasPendingSpawnProgramThroughTick', sourceTick });
            return completedSpawnProgramBatches.some(
                (batch) => batch.sourceTick <= sourceTick
            );
        },
        drainCompletedEventBatches(out = []) {
            calls.push({ type: 'drainCompletedEventBatches' });
            out.push(...completedEventBatches.splice(0));
            return out;
        },
        configureTowerGameplayTarget(handle) {
            calls.push({ type: 'configureTowerGameplayTarget', handle });
            if (handle === null && options.throwTowerGameplayTargetClear === true) {
                throw new Error('fixture-gameplay-target-clear-threw');
            }
            if (handle === null && options.rejectTowerGameplayTargetClear === true) {
                return Object.freeze({
                    accepted: false,
                    reason: 'fixture-gameplay-target-clear-rejected'
                });
            }
            return Object.freeze({
                accepted: true,
                configured: handle === null ? null : Object.freeze({ ...handle })
            });
        },
        configureTrackedBody(handle) {
            calls.push({ type: 'configureTrackedBody', handle });
            return Object.freeze({
                accepted: true,
                tracked: handle === null ? null : Object.freeze({ ...handle })
            });
        },
        getObservedTrackedPose() {
            calls.push({ type: 'getObservedTrackedPose' });
            return trackedPose;
        },
        getLatestTrackedPose() {
            calls.push({ type: 'getLatestTrackedPose' });
            return trackedPose;
        },
        fixedUpdate(delta, sourceTick) {
            calls.push({ type: 'fixedUpdate', delta, sourceTick });
            return true;
        },
        updatePresentation(frame) {
            calls.push({ type: 'updatePresentation', frame });
        },
        synchronizePresentation() {
            calls.push({ type: 'synchronizePresentation' });
        },
        draw(camera) {
            calls.push({ type: 'draw', camera });
            return true;
        },
        getEventProtocolState() {
            return protocol;
        },
        getRuntimeState() {
            return destroyed ? 'destroyed' : 'gpu-ready';
        },
        requiresRecovery() {
            return false;
        },
        getStatus() {
            return Object.freeze({
                state: destroyed ? 'destroyed' : 'gpu-ready',
                marker: 'fixed-primitive-backend'
            });
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            calls.push({ type: 'destroy' });
            bodies.clear();
        }
    };
    return backend;
}

function createLegacyBackend() {
    const backend = createPrimitiveBackend();
    delete backend.canControlBody;
    delete backend.stageFixedPrograms;
    delete backend.drainCompletedSpawnProgramBatches;
    delete backend.hasPendingSpawnProgramThroughTick;
    delete backend.configureTowerGameplayTarget;
    delete backend.configureTrackedBody;
    delete backend.getObservedTrackedPose;
    delete backend.getLatestTrackedPose;
    delete backend.getEventProtocolState;
    return backend;
}

function createEndpoint(backend) {
    const endpoint = createGpuSimulationEndpoint({
        gpuSimulationBackend: backend
    }, {
        capacity: backend.getCapacity(),
        controlCommandCapacity: 4,
        spawnProgramCapacity: 4
    });
    backend.setProtocol?.({
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 7,
        authoritativeEpoch: 3,
        submittedTickCount: 0
    });
    endpoint.init({ id: 'fixed-primitive-map' });
    return endpoint;
}

function spawnSource(endpoint, definitionId = 'controlled_source', overrides = {}) {
    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent(definitionId, overrides),
        1,
        `spawn:${definitionId}`
    ).accepted, true);
    return endpoint.commitAtFixedBoundary(1).spawned[0].handle;
}

function assertThrowsNamed(callback, expectedName) {
    assert.throws(callback, (error) => error?.name === expectedName);
}

function createEventBatch(protocol, handle, sourceTick) {
    return Object.freeze({
        sessionGeneration: protocol.sessionGeneration,
        deviceGeneration: protocol.deviceGeneration,
        authoritativeEpoch: protocol.authoritativeEpoch,
        previousSourceTick: 0,
        previousSubmittedTick: 0,
        sourceTick,
        submittedTick: 1,
        completedThroughTick: sourceTick,
        atomicTransformFirstHitCapacityRejected: false,
        retryableAtomicTransformFirstHitCapacityRejected: false,
        atomicTransformFirstHitRejectionReason: null,
        atomicTransformFirstHitCandidateCount: 0,
        atomicTransformFirstHitCommittedCount: 0,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 1,
        events: Object.freeze([Object.freeze({
            type: 'contact',
            eventType: 'interaction-enter',
            sequence: 0,
            entityId: handle.entityId,
            incarnation: handle.incarnation,
            valueFixedPoint: 0
        })])
    });
}

function assertNoPublicSlotKeys(value, path = 'root') {
    if (value === null || typeof value !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        assert.equal(
            /^(slot|sourceSlot|destinationSlot|stableSlot)$/i.test(key),
            false,
            `${path}.${key}가 private GPU slot을 노출했습니다.`
        );
        assertNoPublicSlotKeys(child, `${path}.${key}`);
    }
}

function createRhomPriorityFixture(endpoint) {
    const route = Object.freeze({
        gateId: 'endpoint-rhom-gate',
        pathId: 'endpoint-rhom-route',
        waypoints: Object.freeze([
            Object.freeze({ x: 1, y: 1 }),
            Object.freeze({ x: 8, y: 1 })
        ])
    });
    const rhomIntent = createGpuEnemySpawnIntent({
        definition: BASIC_RHOM_ENEMY_DATA,
        route,
        spawnSequence: 0,
        waveId: 'endpoint-rhom-priority',
        policyId: 'endpoint-contract'
    });
    const requests = [
        endpoint.requestSpawn(rhomIntent, 1, 'rhom:source'),
        endpoint.requestSpawn(
            createGpuCoreProxySpawnIntent({ position: { x: 8, y: 1 } }),
            1,
            'rhom:core'
        ),
        endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: { x: 4, y: 1 } }),
            1,
            'rhom:tower'
        ),
        endpoint.requestSpawn(
            createCanonicalSpawnIntent('rhom-forged-projectile-source'),
            1,
            'rhom:projectile'
        )
    ];
    assert.equal(requests.every(({ accepted }) => accepted), true);
    const commit = endpoint.commitAtFixedBoundary(1);
    const handles = new Map(
        commit.spawned.map(({ commandId, handle }) => [commandId, handle])
    );
    return Object.freeze({
        source: handles.get('rhom:source'),
        core: handles.get('rhom:core'),
        tower: handles.get('rhom:tower'),
        projectile: handles.get('rhom:projectile')
    });
}

function createRhomPriorityControl(handles, overrides = {}) {
    return {
        sourceHandle: handles.source,
        coreTargetHandle: handles.core,
        towerTargetHandle: handles.tower,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        selectionSequence: 0,
        attackDefinitionId: BASIC_RHOM_ATTACK_DATA.id,
        projectileDefinitionId: HOSTILE_RHOM_PROJECTILE_DATA.id,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        ...overrides
    };
}

function createRhomSelectedIntent(handles) {
    return createGpuSelectedTargetProjectileIntent({
        definition: HOSTILE_RHOM_PROJECTILE_DATA,
        sourceHandle: handles.source,
        ownerHandle: handles.source,
        coreTargetHandle: handles.core,
        towerTargetHandle: handles.tower,
        positionOffset: BASIC_RHOM_ATTACK_DATA.positionOffset,
        targetOffset: BASIC_RHOM_ATTACK_DATA.targetOffset,
        launchSpeed: BASIC_RHOM_ATTACK_DATA.launchSpeed,
        attackRangeTiles: BASIC_RHOM_ATTACK_DATA.attackRangeTiles,
        targetSelectionPolicyId: BASIC_RHOM_ATTACK_DATA.targetSelectionPolicy,
        distancePolicyId: BASIC_RHOM_ATTACK_DATA.distancePolicy,
        stopWhileTargetInRange: true,
        targetPolicyId: BASIC_RHOM_ATTACK_DATA.targetPolicyId,
        allegiancePolicy: BASIC_RHOM_ATTACK_DATA.allegiancePolicy,
        producerId: BASIC_RHOM_ATTACK_DATA.producerId,
        sourceAbilityId: BASIC_RHOM_ATTACK_DATA.sourceAbilityId,
        spawnSequence: 0
    });
}

test('generic endpoint는 fixed primitive public seam을 제공하고 private GPU slot을 노출하지 않는다', () => {
    assert.strictEqual(GpuSimulationEndpoint, GpuEnemySimulationEndpoint);
    assert.equal(GPU_BODY_CONTROL_PROGRAM_MODE.PRIORITY_TARGET_IN_RANGE, 2);
    assert.equal(GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED, 2);
    assert.equal(GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER, 2);
    assert.equal(
        GPU_BODY_CONTROL_SELECTION_POLICY.CORE_FIRST_IN_RANGE_THEN_TOWER,
        1
    );
    assert.equal(GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW, 2);
    assert.equal(GPU_SPAWN_PROGRAM_REQUEST_FLAGS.REQUIRE_EXACT_SELECTED_TARGET, 1);
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint);

    assert.equal(typeof endpoint.requestBodyControl, 'function');
    assert.equal(typeof endpoint.requestSourceRelativeSpawn, 'function');
    assert.equal(typeof endpoint.configureTowerGameplayTarget, 'function');
    assert.equal(typeof endpoint.configureTrackedBody, 'function');
    assert.equal(typeof endpoint.getObservedTrackedPose, 'function');
    assert.equal('getBodySlot' in endpoint, false);
    assert.equal('resolveBodySlot' in endpoint, false);

    const control = endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:source:2');
    assert.equal(control.accepted, true);
    const replay = endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:source:2');
    assert.equal(replay.accepted, true);
    assert.equal(replay.replay, true);

    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.fixedCommands.controls.length, 1);
    const staged = backend.calls.find(({ type }) => type === 'stageFixedPrograms');
    assert.deepEqual(Array.from(staged.plan.controls, (entry) => ({ ...entry })), [{
        entityId: source.entityId,
        incarnation: source.incarnation,
        modeFlags: GPU_BODY_CONTROL_PROGRAM_MODE.MOVE_INTENT,
        moveIntentX: 1,
        moveIntentY: 0
    }]);
    assert.equal(staged.plan.sourceRelativeSpawns.length, 0);
    assertNoPublicSlotKeys(control, 'controlReceipt');
    assertNoPublicSlotKeys(committed.fixedCommands, 'fixedCommit');
    assertNoPublicSlotKeys(endpoint.getStatus(), 'status');
    endpoint.destroy();
});

test('M public wrapper는 exact canonical source/Core/Tower와 selected policy 증거만 owner에 전달한다', () => {
    const backend = createPrimitiveBackend({ capacity: 12 });
    const endpoint = createEndpoint(backend);
    const handles = createRhomPriorityFixture(endpoint);
    const control = createRhomPriorityControl(handles);

    const acceptedControl = endpoint.requestPriorityTargetControl(
        control,
        2,
        'rhom:control:valid'
    );
    assert.equal(acceptedControl.accepted, true);
    assert.equal(Number.isSafeInteger(acceptedControl.attackFingerprint), true);
    assert.ok(acceptedControl.attackFingerprint > 0);

    const selectedIntent = createRhomSelectedIntent(handles);
    const acceptedSpawn = endpoint.requestSelectedTargetSpawn(
        selectedIntent,
        2,
        'rhom:spawn:valid'
    );
    assert.equal(acceptedSpawn.accepted, true);

    assert.deepEqual({ ...endpoint.requestPriorityTargetControl(
        createRhomPriorityControl(handles, {
            sourceHandle: handles.projectile
        }),
        3,
        'rhom:control:forged-source-kind'
    ) }, {
        accepted: false,
        reason: 'priority-source-kind-definition-invalid'
    });
    assert.deepEqual({ ...endpoint.requestPriorityTargetControl(
        createRhomPriorityControl(handles, {
            coreTargetHandle: handles.tower
        }),
        3,
        'rhom:control:forged-core-kind'
    ) }, {
        accepted: false,
        reason: 'priority-core-kind-definition-invalid'
    });
    assert.deepEqual({ ...endpoint.requestPriorityTargetControl(
        createRhomPriorityControl(handles, {
            projectileDefinitionId: 'forged-projectile'
        }),
        3,
        'rhom:control:forged-profile-evidence'
    ) }, {
        accepted: false,
        reason: 'priority-target-control-evidence-invalid'
    });
    assert.deepEqual({ ...endpoint.requestSelectedTargetSpawn({
        ...selectedIntent,
        destinationSpawn: {
            ...selectedIntent.destinationSpawn,
            definitionId: 'forged-selected-projectile'
        }
    }, 3, 'rhom:spawn:forged-definition') }, {
        accepted: false,
        reason: 'selected-target-spawn-evidence-invalid'
    });
    assert.deepEqual({ ...endpoint.requestSelectedTargetSpawn({
        ...selectedIntent,
        destinationSpawn: {
            ...selectedIntent.destinationSpawn,
            contactHandler: {
                ...selectedIntent.destinationSpawn.contactHandler,
                flags: 0
            }
        }
    }, 3, 'rhom:spawn:forged-handler-policy') }, {
        accepted: false,
        reason: 'selected-target-spawn-evidence-invalid'
    });

    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.fixedCommands.controls.length, 1);
    assert.equal(committed.fixedCommands.selectedTargetSpawns.length, 1);
    const staged = backend.calls.findLast(
        ({ type }) => type === 'stageFixedPrograms'
    ).plan;
    assert.equal(staged.controls.length, 1);
    assert.equal(staged.sourceRelativeSpawns.length, 1);
    assert.equal(
        staged.sourceRelativeSpawns[0].destinationSpawn.definitionId,
        HOSTILE_RHOM_PROJECTILE_DATA.id
    );
    assertNoPublicSlotKeys(committed.fixedCommands, 'rhomFixedCommit');
    endpoint.destroy();
});

test('tracked body observation은 exact handle만 구성하고 immutable observed snapshot을 반환한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'tracked_source');
    const observed = Object.freeze({
        valid: true,
        entityId: source.entityId,
        incarnation: source.incarnation,
        sourceTick: 9,
        observedThroughTick: 9,
        position: Object.freeze({ x: 3.25, y: 4.5 }),
        previousPosition: Object.freeze({ x: 3, y: 4.25 }),
        velocity: Object.freeze({ x: 0.25, y: 0.25 }),
        ageTicks: 0,
        sessionGeneration: endpoint.getStatus().sessionGeneration,
        deviceGeneration: 7,
        authoritativeEpoch: 3
    });
    backend.setTrackedPose(observed);

    const configured = endpoint.configureTrackedBody(source);
    assert.equal(configured.accepted, true);
    assert.deepEqual({ ...configured.tracked }, { ...source });
    const stale = endpoint.configureTrackedBody({
        entityId: source.entityId,
        incarnation: source.incarnation + 1
    });
    assert.deepEqual({ ...stale }, {
        accepted: false,
        reason: 'stale-handle'
    });
    const snapshot = endpoint.getObservedTrackedPose();
    assert.equal(snapshot.valid, observed.valid);
    assert.equal(snapshot.entityId, observed.entityId);
    assert.equal(snapshot.incarnation, observed.incarnation);
    assert.equal(snapshot.sourceTick, observed.sourceTick);
    assert.deepEqual({ ...snapshot.position }, { ...observed.position });
    assert.deepEqual(
        { ...snapshot.previousPosition },
        { ...observed.previousPosition }
    );
    assert.deepEqual({ ...snapshot.velocity }, { ...observed.velocity });
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.position), true);
    assert.equal(Object.isFrozen(snapshot.previousPosition), true);
    assert.equal(Object.isFrozen(snapshot.velocity), true);
    assert.throws(() => {
        snapshot.position.x = 100;
    }, TypeError);
    assert.deepEqual({ ...endpoint.configureTrackedBody(null) }, {
        accepted: true,
        tracked: null
    });
    endpoint.destroy();
});

test('Tower gameplay target은 exact Tower만 hard gate하고 tracked pose desync는 diagnostic-only다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    assert.equal(endpoint.requestSpawn(
        createGpuTowerSpawnIntent({ position: { x: 4, y: 2 } }),
        1,
        'gameplay-target:tower'
    ).accepted, true);
    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent('gameplay-target:decoy'),
        1,
        'gameplay-target:decoy'
    ).accepted, true);
    const spawned = new Map(endpoint.commitAtFixedBoundary(1).spawned.map(
        ({ commandId, handle }) => [commandId, handle]
    ));
    const tower = spawned.get('gameplay-target:tower');
    const decoy = spawned.get('gameplay-target:decoy');

    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(tower) }, {
        accepted: true,
        configured: tower
    });
    const gameplayCall = backend.calls.findLast(
        ({ type }) => type === 'configureTowerGameplayTarget'
    );
    assert.deepEqual({ ...gameplayCall.handle }, { ...tower });
    assert.equal('slot' in gameplayCall.handle, false);
    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(decoy) }, {
        accepted: false,
        reason: 'tower-kind-definition-invalid'
    });
    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget({
        entityId: tower.entityId,
        incarnation: tower.incarnation + 1
    }) }, {
        accepted: false,
        reason: 'stale-handle'
    });

    const decoyKey = handleKey(decoy);
    const decoyBody = backend.bodies.get(decoyKey);
    backend.bodies.delete(decoyKey);
    assert.deepEqual({ ...endpoint.configureTrackedBody(decoy) }, {
        accepted: false,
        reason: 'registry-backend-desync'
    });
    assert.equal(endpoint.requiresRecovery(), false);
    assert.equal(endpoint.getStatus().trackedPoseDiagnostic.reason,
        'registry-backend-desync');
    backend.bodies.set(decoyKey, decoyBody);
    const trackedTower = endpoint.configureTrackedBody(tower);
    assert.deepEqual({
        ...trackedTower,
        tracked: { ...trackedTower.tracked }
    }, {
        accepted: true,
        tracked: { ...tower }
    });
    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(null) }, {
        accepted: true,
        configured: null
    });
    assert.equal(endpoint.configureTowerGameplayTarget(tower).accepted, true);
    assert.equal(
        endpoint.closeGameplayIngress('fixture-terminal', 2).closed,
        true
    );
    const gameplayCallsBeforeClosedReenable = backend.calls.filter(
        ({ type }) => type === 'configureTowerGameplayTarget'
    ).length;
    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(tower) }, {
        accepted: false,
        reason: 'gameplay-ingress-closed'
    });
    assert.equal(
        backend.calls.filter(
            ({ type }) => type === 'configureTowerGameplayTarget'
        ).length,
        gameplayCallsBeforeClosedReenable
    );
    assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(null) }, {
        accepted: true,
        configured: null
    });
    endpoint.destroy();

    const desyncBackend = createPrimitiveBackend();
    const desyncEndpoint = createEndpoint(desyncBackend);
    assert.equal(desyncEndpoint.requestSpawn(
        createGpuTowerSpawnIntent({ position: { x: 4, y: 2 } }),
        1,
        'gameplay-target:desync-tower'
    ).accepted, true);
    const desyncTower = desyncEndpoint.commitAtFixedBoundary(1).spawned[0].handle;
    desyncBackend.bodies.delete(handleKey(desyncTower));
    assert.deepEqual({
        ...desyncEndpoint.configureTowerGameplayTarget(desyncTower)
    }, {
        accepted: false,
        reason: 'registry-backend-desync'
    });
    assert.equal(desyncEndpoint.requiresRecovery(), true);
    assert.equal(
        desyncEndpoint.getStatus().events.protocolFailure.stage,
        'tower-gameplay-target-config'
    );
    desyncEndpoint.destroy();
});

for (const clearFailure of Object.freeze([
    Object.freeze({
        name: 'reject',
        options: Object.freeze({ rejectTowerGameplayTargetClear: true }),
        reason: 'fixture-gameplay-target-clear-rejected'
    }),
    Object.freeze({
        name: 'throw',
        options: Object.freeze({ throwTowerGameplayTargetClear: true }),
        reason: 'tower-gameplay-target-clear-threw'
    })
])) {
    test(`Tower gameplay target clear backend ${clearFailure.name}는 protocol recovery를 hard gate한다`, () => {
        const backend = createPrimitiveBackend(clearFailure.options);
        const endpoint = createEndpoint(backend);
        assert.equal(endpoint.requestSpawn(
            createGpuTowerSpawnIntent({ position: { x: 4, y: 2 } }),
            1,
            `gameplay-target:clear-${clearFailure.name}`
        ).accepted, true);
        const tower = endpoint.commitAtFixedBoundary(1).spawned[0].handle;
        assert.equal(endpoint.configureTowerGameplayTarget(tower).accepted, true);

        assert.deepEqual({ ...endpoint.configureTowerGameplayTarget(null) }, {
            accepted: false,
            reason: clearFailure.reason
        });
        assert.equal(endpoint.requiresRecovery(), true);
        assert.equal(
            endpoint.getStatus().events.protocolFailure.stage,
            'tower-gameplay-target-config'
        );
        endpoint.destroy();
    });
}

test('SpawnProgram completion은 event drain 전에 destination을 활성화하며 public 결과에는 slot이 없다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'spawn_program_source');
    const protocol = backend.getEventProtocolState();

    const requested = endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('spawn_program_destination'),
        positionOffset: { x: 0.25, y: -0.5 },
        launchVelocity: { x: 4, y: 2 },
        sourceVelocityScale: 0.5
    }, 2, 'source-relative:2');
    assert.equal(requested.accepted, true);
    assert.equal(endpoint.getStatus().reservedCount, 0);

    const commit = endpoint.commitAtFixedBoundary(2);
    const pending = commit.fixedCommands.sourceRelativeSpawns[0];
    assert.equal(pending.state, 'gpu-resolve-pending');
    assert.equal(endpoint.getStatus().activeCount, 1);
    assert.equal(endpoint.getStatus().reservedCount, 1);
    assertNoPublicSlotKeys(requested, 'spawnReceipt');
    assertNoPublicSlotKeys(pending, 'spawnPending');

    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: source,
            destinationHandle: pending.handle,
            reason: 'resolved'
        })])
    }));
    backend.queueEventBatch(createEventBatch(protocol, pending.handle, 2));
    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(3);

    const spawnDrainIndex = backend.calls.findIndex(
        ({ type }) => type === 'drainCompletedSpawnProgramBatches'
    );
    const eventDrainIndex = backend.calls.findIndex(
        ({ type }) => type === 'drainCompletedEventBatches'
    );
    assert.ok(spawnDrainIndex >= 0);
    assert.ok(eventDrainIndex > spawnDrainIndex);
    assert.equal(snapshot.protocolFailure, null);
    assert.equal(snapshot.contactEvents.length, 1);
    assert.equal(snapshot.contactEvents[0].disposition, 'applied');
    assert.equal(endpoint.getRegistry().has(pending.handle), true);
    assert.equal(endpoint.getStatus().activeCount, 2);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(
        endpoint.getStatus().fixedCommands.lastCompletionResult.completed[0].outcome,
        'resolved'
    );
    endpoint.destroy();
});

test('target-invalid completion은 exact targetHandle을 검증하고 reservation을 normal cleanup한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent('target_mode_source'),
        1,
        'spawn:target-mode-source'
    ).accepted, true);
    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent('target_mode_target'),
        1,
        'spawn:target-mode-target'
    ).accepted, true);
    const initial = endpoint.commitAtFixedBoundary(1).spawned;
    const sourceHandle = initial[0].handle;
    const targetHandle = initial[1].handle;
    const protocol = backend.getEventProtocolState();

    const requested = endpoint.requestSourceRelativeSpawn({
        modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
        sourceHandle,
        targetHandle,
        destinationSpawn: createCanonicalSpawnIntent('target_mode_destination'),
        positionOffset: { x: 0.25, y: -0.5 },
        targetOffset: { x: 0.5, y: -0.25 },
        launchSpeed: 12
    }, 2, 'source-relative-target:2');
    assert.equal(requested.accepted, true);
    assertNoPublicSlotKeys(requested, 'targetSpawnReceipt');

    const commit = endpoint.commitAtFixedBoundary(2);
    const pending = commit.fixedCommands.sourceRelativeSpawns[0];
    const staged = backend.calls.findLast(
        ({ type }) => type === 'stageFixedPrograms'
    ).plan.sourceRelativeSpawns[0];
    assert.deepEqual({ ...staged.sourceHandle }, { ...sourceHandle });
    assert.deepEqual({ ...staged.targetHandle }, { ...targetHandle });
    assert.equal(
        staged.modeFlags,
        GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
    );
    assert.equal(staged.destinationSpawn.targetEntityId, targetHandle.entityId);
    assert.equal(
        staged.destinationSpawn.targetIncarnation,
        targetHandle.incarnation
    );
    assertNoPublicSlotKeys(pending, 'targetSpawnPending');
    assertNoPublicSlotKeys(staged, 'targetSpawnStage');

    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle,
            targetHandle,
            destinationHandle: pending.handle,
            reason: 'target-invalid'
        })])
    }));
    const snapshot = endpoint.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(snapshot.protocolFailure, null);
    assert.equal(endpoint.getRegistry().has(pending.handle), false);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    assert.equal(
        endpoint.getStatus().fixedCommands.telemetry.completedTargetInvalid,
        1
    );
    assert.deepEqual(
        Array.from(
            endpoint.getStatus().fixedCommands.lastCompletionResult.completed,
            ({ commandId, outcome }) => ({ commandId, outcome })
        ),
        [{ commandId: 'source-relative-target:2', outcome: 'target-invalid' }]
    );
    assertNoPublicSlotKeys(snapshot, 'targetInvalidCompletion');
    endpoint.destroy();
});

test('source-relative INHERIT_SUBJECT destination은 exact active source registry team으로만 활성화된다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'hostile_inherit_source', {
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    });
    const protocol = backend.getEventProtocolState();
    const receipt = endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('inherited_destination', {
            teamId: undefined,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
        }),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 3, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'inherit-subject:2');

    assert.equal(receipt.accepted, true);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    const committed = endpoint.commitAtFixedBoundary(2);
    const pending = committed.fixedCommands.sourceRelativeSpawns[0];
    const staged = backend.calls.find(({ type }) => type === 'stageFixedPrograms');
    const stagedDestination = staged.plan.sourceRelativeSpawns[0].destinationSpawn;
    assert.equal(stagedDestination.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        stagedDestination.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );
    assert.equal(endpoint.getStatus().reservedCount, 1);

    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: source,
            destinationHandle: pending.handle,
            reason: 'resolved'
        })])
    }));
    backend.queueEventBatch(createEventBatch(protocol, pending.handle, 2));
    endpoint.commitCompletedEventsAtFixedBoundary(3);

    const destination = endpoint.getRegistry().copyEntityView(pending.handle, {});
    assert.equal(destination.metadata.teamId, GAMEPLAY_TEAM_ID.HOSTILE);
    assert.equal(
        destination.metadata.damagePolicyId,
        GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    assert.equal(
        destination.metadata.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
    );
    assert.equal(destination.metadata.sourceEntityId, source.entityId);
    assert.equal(destination.metadata.sourceIncarnation, source.incarnation);
    endpoint.destroy();
});

test('source-relative team injection 충돌은 command enqueue와 registry reservation 전에 fail-fast한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'hostile_conflict_source', {
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
    });
    const callsBefore = backend.calls.length;

    assertThrowsNamed(() => endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('injected_player_destination', {
            teamId: GAMEPLAY_TEAM_ID.PLAYER,
            allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT
        }),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 3, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'inherit-injection:2'), 'RangeError');

    assert.equal(endpoint.getStatus().activeCount, 1);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'stageFixedPrograms').length,
        0
    );
    assert.equal(backend.calls.length, callsBefore);
    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.fixedCommands.sourceRelativeSpawns.length, 0);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    endpoint.destroy();
});

test('endpoint는 spawn domain pressure에서 동일 tick control을 commit하고 reservation을 누수하지 않는다', () => {
    const backend = createPrimitiveBackend();
    backend.stageFixedPrograms = (plan) => {
        backend.calls.push({ type: 'stageFixedPrograms', plan });
        return {
            accepted: plan.controls.length,
            rejected: plan.sourceRelativeSpawns.length,
            requiresRecovery: false,
            controls: {
                accepted: plan.controls.length,
                rejected: 0,
                reason: null
            },
            sourceRelativeSpawns: {
                accepted: 0,
                rejected: plan.sourceRelativeSpawns.length,
                reason: 'spawn-program-capacity'
            }
        };
    };
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'pressure_source');

    assert.equal(endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'control:pressure').accepted, true);
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('pressure_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 4, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'spawn:pressure').accepted, true);

    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.fixedCommands.controls.length, 1);
    assert.equal(committed.fixedCommands.sourceRelativeSpawns.length, 0);
    assert.deepEqual(
        Array.from(committed.fixedCommands.rejected, ({ domain, code }) => ({
            domain,
            code
        })),
        [{ domain: 'spawn', code: 'spawn-program-capacity' }]
    );
    assert.equal(endpoint.getStatus().activeCount, 1);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.getStatus().fixedCommands.pendingDestinationCount, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});

test('SpawnProgram protocol failure는 같은 경계의 event/lifecycle/fixed submit을 모두 차단한다', () => {
    const backend = createPrimitiveBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'failure_source');
    const protocol = backend.getEventProtocolState();
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('failure_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'source-relative:failure').accepted, true);
    const pending = endpoint.commitAtFixedBoundary(2)
        .fixedCommands.sourceRelativeSpawns[0];

    assert.equal(endpoint.requestSpawn(
        createCanonicalSpawnIntent('must_not_spawn'),
        3,
        'lifecycle:must-not-commit'
    ).accepted, true);
    backend.queueSpawnProgramBatch(Object.freeze({
        ...protocol,
        deviceGeneration: protocol.deviceGeneration + 1,
        sourceTick: 2,
        outcomes: Object.freeze([Object.freeze({
            sourceHandle: source,
            destinationHandle: pending.handle,
            reason: 'resolved'
        })])
    }));
    backend.queueEventBatch(createEventBatch(protocol, source, 2));

    const failure = endpoint.commitCompletedEventsAtFixedBoundary(3);
    assert.equal(failure.protocolFailure.stage, 'spawn-program-completion');
    assert.equal(failure.protocolFailure.code, 'generation-mismatch');
    assert.equal(
        backend.calls.filter(({ type }) => type === 'drainCompletedEventBatches').length,
        0
    );

    const spawnCallCount = backend.calls.filter(
        ({ type }) => type === 'spawnBodies'
    ).length;
    const stageCallCount = backend.calls.filter(
        ({ type }) => type === 'stageFixedPrograms'
    ).length;
    const fixedCallCount = backend.calls.filter(
        ({ type }) => type === 'fixedUpdate'
    ).length;
    const boundary = endpoint.commitAtFixedBoundary(3);
    assert.equal(boundary.state, 'failed');
    assert.equal(boundary.recoveryRequired, true);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'spawnBodies').length,
        spawnCallCount
    );
    assert.equal(
        backend.calls.filter(({ type }) => type === 'stageFixedPrograms').length,
        stageCallCount
    );
    assert.equal(endpoint.fixedUpdate(1 / 60, 3), false);
    assert.equal(
        backend.calls.filter(({ type }) => type === 'fixedUpdate').length,
        fixedCallCount
    );
    endpoint.destroy();
});

test('새 optional API가 없는 injected legacy backend의 spawn-only 거부는 terminal recovery 없이 fail closed한다', () => {
    const backend = createLegacyBackend();
    const endpoint = createEndpoint(backend);
    const source = spawnSource(endpoint, 'legacy_source');

    assert.deepEqual({ ...endpoint.requestBodyControl({
        handle: source,
        moveIntentX: 1,
        moveIntentY: 0
    }, 2, 'legacy:control') }, {
        accepted: false,
        commandId: 'legacy:control',
        reason: 'flow-body-not-controllable'
    });
    assert.deepEqual({ ...endpoint.configureTrackedBody(null) }, {
        accepted: false,
        reason: 'fixed-primitives-unsupported'
    });
    assert.equal(endpoint.getObservedTrackedPose(), null);
    assert.equal(endpoint.requestSourceRelativeSpawn({
        sourceHandle: source,
        destinationSpawn: createCanonicalSpawnIntent('legacy_destination'),
        positionOffset: { x: 0, y: 0 },
        launchVelocity: { x: 1, y: 0 },
        sourceVelocityScale: 0
    }, 2, 'legacy:source-relative').accepted, true);
    const committed = endpoint.commitAtFixedBoundary(2);
    assert.equal(committed.state, 'committed-with-rejections');
    assert.equal(committed.recoveryRequired, false);
    assert.equal(committed.fixedCommands.rejected[0].code,
        'fixed-primitives-unsupported');
    assert.equal(committed.fixedCommands.rejected[0].domain, 'spawn');
    assert.equal(committed.fixedCommands.protocolFailure, null);
    assert.equal(endpoint.getStatus().reservedCount, 0);
    assert.equal(endpoint.requiresRecovery(), false);
    endpoint.destroy();
});
