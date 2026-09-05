import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    WAVE_CLEAR_BLOCKER,
    WAVE_CLEAR_PROOF_RESULT_CODE,
    createWaveClearProof,
    createWaveQuiescenceSnapshot,
    validateWaveClearProof
} = await loadGameModule('ingame/contract/wave_quiescence_contract.js');
const { WAVE_RUN_RESULT_CODE, WAVE_RUN_STATE } = await loadGameModule(
    'ingame/contract/wave_run_state_contract.js'
);
const { getWaveRunPlanFingerprint } = await loadGameModule(
    'ingame/contract/wave_run_plan_contract.js'
);
const { WaveRunCoordinator } = await loadGameModule(
    'ingame/flow/wave_run_coordinator.js'
);
const { HostileParticipationTracker } = await loadGameModule(
    'ingame/state/hostile_participation_tracker.js'
);
const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { R9_QA_THREE_WAVE_RUN_PLAN } = await loadGameModule(
    'data/scene/game/r9_wave_run_plan_data.js'
);

function createSnapshot(overrides = {}) {
    const liveHostileActorCount = overrides.liveHostileActorCount ?? 0;
    const pendingHostileActorCount
        = overrides.pendingHostileActorCount ?? 0;
    const totalSpawnCount = overrides.totalSpawnCount ?? 1;
    const remainingSpawnCount = overrides.remainingSpawnCount ?? 0;
    return createWaveQuiescenceSnapshot({
        snapshotRevision: overrides.snapshotRevision ?? 1,
        fixedTick: overrides.fixedTick ?? 10,
        protocol: {
            sessionGeneration: overrides.sessionGeneration ?? 1,
            deviceGeneration: overrides.deviceGeneration ?? 2,
            authoritativeEpoch: overrides.authoritativeEpoch ?? 3
        },
        wave: {
            mapId: overrides.mapId ?? R9_QA_THREE_WAVE_RUN_PLAN.mapId,
            waveId: overrides.waveId
                ?? R9_QA_THREE_WAVE_RUN_PLAN.waves[0].waveDefinition.waveId,
            waveOrdinal: overrides.waveOrdinal ?? 1,
            initialized: overrides.waveInitialized ?? true,
            totalSpawnCount,
            queuedSpawnCount: totalSpawnCount - remainingSpawnCount,
            remainingSpawnCount,
            blockedSpawnCount: overrides.blockedSpawnCount ?? 0,
            allSpawnsQueued: overrides.allSpawnsQueued ?? true,
            completionOwned: overrides.completionOwned ?? false
        },
        hostile: {
            revision: overrides.hostileRevision
                ?? overrides.snapshotRevision
                ?? 1,
            registryRevision: overrides.trackerRegistryRevision ?? 20,
            countExact: overrides.countExact ?? true,
            liveHostileActorCount,
            pendingHostileActorCount,
            hostileActorCount:
                liveHostileActorCount + pendingHostileActorCount
        },
        pending: {
            hostileLifecycleSpawnCount:
                overrides.hostileLifecycleSpawnCount ?? 0,
            hostileMaterializationCount:
                overrides.hostileMaterializationCount ?? 0,
            hostileTransitCount: overrides.hostileTransitCount ?? 0,
            hostileAtomicTransformCount:
                overrides.hostileAtomicTransformCount ?? 0,
            lifecycleCommandCount: overrides.lifecycleCommandCount ?? 0,
            materializationWorkCount:
                overrides.materializationWorkCount ?? 0,
            transitActorCount: overrides.transitActorCount ?? 0,
            atomicTransformWorkCount:
                overrides.atomicTransformWorkCount ?? 0
        },
        events: {
            lastSubmittedTick: overrides.lastSubmittedTick ?? 8,
            lastCompletedTick: overrides.lastCompletedTick ?? 8,
            completedThroughTick: overrides.completedThroughTick ?? 8,
            deferredBatchCount: overrides.deferredBatchCount ?? 0,
            protocolFailure: overrides.protocolFailure ?? false
        },
        registryRevision: overrides.registryRevision ?? 20,
        run: {
            running: overrides.running ?? true,
            defeated: overrides.defeated ?? false,
            coreDepleted: overrides.coreDepleted ?? false,
            recoveryRequired: overrides.recoveryRequired ?? false
        }
    });
}

function activate(registry, options = {}) {
    const handle = registry.reserveEntity({
        kindId: options.kindId ?? 'enemy',
        definitionId: options.definitionId ?? 'basic_circle_01',
        createdAtTick: options.createdAtTick ?? 1
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, {
        teamId: options.teamId ?? 2,
        siegeWeight: options.siegeWeight ?? 1,
        bountyBudget: options.bountyBudget ?? 1,
        countsTowardHostile: options.countsTowardHostile ?? true,
        countsTowardSiege: options.countsTowardSiege ?? true,
        creationOrigin: options.creationOrigin ?? 'NATURAL'
    }), true);
    return handle;
}

function createCoordinator() {
    const coordinator = new WaveRunCoordinator({
        plan: R9_QA_THREE_WAVE_RUN_PLAN,
        runSessionId: 'r9-quiescence-run'
    });
    assert.equal(coordinator.startPlan({
        transactionId: 'start',
        runSessionId: 'r9-quiescence-run',
        planId: R9_QA_THREE_WAVE_RUN_PLAN.planId,
        planFingerprint: getWaveRunPlanFingerprint(
            R9_QA_THREE_WAVE_RUN_PLAN
        )
    }).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(coordinator.beginWave({
        transactionId: 'begin',
        runSessionId: 'r9-quiescence-run',
        planId: R9_QA_THREE_WAVE_RUN_PLAN.planId,
        waveOrdinal: 1,
        waveId: R9_QA_THREE_WAVE_RUN_PLAN.waves[0].waveDefinition.waveId,
        startingFixedTick: 0
    }).code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    return coordinator;
}

test('exact clear proof는 bounded scalar snapshot만 포함하고 deep immutable이다', () => {
    const snapshot = createSnapshot();
    const receipt = createWaveClearProof(snapshot);
    assert.equal(receipt.accepted, true);
    assert.equal(receipt.code, WAVE_CLEAR_PROOF_RESULT_CODE.PROVEN);
    assert.equal(receipt.blockers.length, 0);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.pending), true);
    assert.equal(Object.isFrozen(receipt.proof), true);
    assert.equal(Object.isFrozen(receipt.blockers), true);
    assert.doesNotMatch(
        JSON.stringify(snapshot),
        /transformArray|poseArray|entityArray|worldPosition/u
    );
    assert.throws(() => { snapshot.fixedTick = 99; }, TypeError);
    assert.throws(() => { receipt.proof.waveId = 'mutated'; }, TypeError);
});

test('live/pending/materialization/transit/transform/event 각각 clear를 막는다', () => {
    const cases = [
        {
            overrides: { liveHostileActorCount: 1 },
            blocker: WAVE_CLEAR_BLOCKER.LIVE_HOSTILE_REMAINS
        },
        {
            overrides: {
                pendingHostileActorCount: 1,
                hostileMaterializationCount: 1,
                materializationWorkCount: 1
            },
            blocker: WAVE_CLEAR_BLOCKER.PENDING_HOSTILE_REMAINS
        },
        {
            overrides: {
                pendingHostileActorCount: 1,
                hostileTransitCount: 1,
                transitActorCount: 1
            },
            blocker: WAVE_CLEAR_BLOCKER.HOSTILE_PRODUCER_PENDING
        },
        {
            overrides: {
                hostileAtomicTransformCount: 1,
                atomicTransformWorkCount: 1
            },
            blocker: WAVE_CLEAR_BLOCKER.HOSTILE_PRODUCER_PENDING
        },
        {
            overrides: { lastSubmittedTick: 9, lastCompletedTick: 8 },
            blocker: WAVE_CLEAR_BLOCKER.EVENT_WATERMARK_INCOMPLETE
        },
        {
            overrides: { deferredBatchCount: 1 },
            blocker: WAVE_CLEAR_BLOCKER.EVENT_WATERMARK_INCOMPLETE
        },
        {
            overrides: { registryRevision: 21 },
            blocker: WAVE_CLEAR_BLOCKER.REGISTRY_REVISION_DRIFT
        }
    ];
    for (const { overrides, blocker } of cases) {
        const receipt = createWaveClearProof(createSnapshot(overrides));
        assert.equal(receipt.accepted, false, blocker);
        assert.ok(receipt.blockers.includes(blocker), blocker);
    }
});

test('count-only visible zero와 incomplete run/wave source는 proof가 아니다', () => {
    for (const overrides of [
        { countExact: false },
        { allSpawnsQueued: false, remainingSpawnCount: 1 },
        { blockedSpawnCount: 1 },
        { waveInitialized: false },
        { completionOwned: true },
        { running: false },
        { defeated: true, running: false },
        { coreDepleted: true, running: false },
        { recoveryRequired: true }
    ]) {
        assert.equal(
            createWaveClearProof(createSnapshot(overrides)).accepted,
            false,
            JSON.stringify(overrides)
        );
    }
});

test('proof replay는 exact이고 snapshot revision drift는 SOURCE_CHANGED다', () => {
    const first = createSnapshot({ snapshotRevision: 7 });
    const proof = createWaveClearProof(first).proof;
    assert.equal(validateWaveClearProof(proof, first).accepted, true);
    const drifted = createSnapshot({
        snapshotRevision: 8,
        hostileRevision: 8
    });
    assert.deepEqual({ ...validateWaveClearProof(proof, drifted) }, {
        accepted: false,
        code: WAVE_CLEAR_PROOF_RESULT_CODE.SOURCE_CHANGED
    });
});

test('coordinator는 final zero proof를 exact once 받아 CLEAR_CANDIDATE로 봉인한다', () => {
    const coordinator = createCoordinator();
    const snapshot = createSnapshot({ snapshotRevision: 11 });
    const first = coordinator.observeWaveQuiescence({
        transactionId: 'clear-final-death',
        snapshot
    });
    const replay = coordinator.observeWaveQuiescence({
        transactionId: 'clear-final-death',
        snapshot
    });
    assert.equal(first.code, WAVE_RUN_RESULT_CODE.ACCEPTED);
    assert.equal(first.state, WAVE_RUN_STATE.CLEAR_CANDIDATE);
    assert.equal(replay.replayed, true);
    assert.equal(replay.facts.length, 0);
    assert.equal(coordinator.getStatus().state, WAVE_RUN_STATE.CLEAR_CANDIDATE);
    assert.equal(coordinator.getStatus().clearProofFingerprint > 0, true);

    const changed = coordinator.observeWaveQuiescence({
        transactionId: 'clear-final-death',
        snapshot: createSnapshot({ snapshotRevision: 12 })
    });
    assert.equal(changed.code, WAVE_RUN_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(coordinator.getStatus().state, WAVE_RUN_STATE.CLEAR_CANDIDATE);
});

test('coordinator evaluator port는 live hostile을 통과시키고 exact clear만 seal한다', () => {
    const coordinator = createCoordinator();
    const live = coordinator.evaluateWaveQuiescence(createSnapshot({
        snapshotRevision: 1,
        liveHostileActorCount: 1
    }));
    assert.deepEqual({
        accepted: live.accepted,
        clearCandidateAccepted: live.clearCandidateAccepted,
        code: live.code
    }, {
        accepted: false,
        clearCandidateAccepted: false,
        code: WAVE_RUN_RESULT_CODE.QUIESCENCE_NOT_PROVEN
    });
    const clear = coordinator.evaluateWaveQuiescence(createSnapshot({
        snapshotRevision: 2
    }));
    assert.equal(clear.accepted, true);
    assert.equal(clear.clearCandidateAccepted, true);
    assert.equal(clear.state, WAVE_RUN_STATE.CLEAR_CANDIDATE);
});

test('tracker는 sentence hostile을 포함하고 technical/projectile/stale/ABA를 exact 처리한다', () => {
    const registry = new WorldRegistry({ capacity: 16 });
    const sentence = activate(registry, { creationOrigin: 'PLAYER_SENTENCE' });
    const technical = activate(registry, { countsTowardHostile: false });
    const projectile = activate(registry, {
        kindId: 'projectile',
        teamId: 2
    });
    const tracker = new HostileParticipationTracker();
    let status = tracker.refresh(registry);
    assert.equal(status.liveHostileActorCount, 1);
    assert.equal(status.liveSentenceCreatedCount, 1);
    assert.equal(status.fullReconcileCount, 1);
    assert.equal(status.perEnemyUiObjectCount, 0);

    assert.equal(registry.remove(sentence), true);
    status = tracker.refresh(registry, {}, {
        lifecycle: {
            despawned: [{ handle: sentence }],
            spawned: [],
            registryRevision: registry.getRevision()
        }
    });
    assert.equal(status.liveHostileActorCount, 0);
    assert.equal(status.perTickRegistryScanCount, 0);
    tracker.observePublishedHandles([sentence], registry);
    assert.equal(tracker.getStatus().liveHostileActorCount, 0);

    const aba = activate(registry, { creationOrigin: 'NATURAL' });
    assert.equal(aba.entityId, sentence.entityId);
    assert.notEqual(aba.incarnation, sentence.incarnation);
    tracker.observePublishedHandles([aba], registry);
    tracker.observeLifecycle({
        despawned: [{ handle: sentence }],
        spawned: [],
        registryRevision: registry.getRevision()
    }, registry);
    assert.equal(tracker.getStatus().liveHostileActorCount, 1);
    assert.equal(tracker.getStatus().fullReconcileCount, 1);
    void technical;
    void projectile;
});

test('tracker는 1,000→1→0 hostile lifecycle batch를 O(changes)로 exact 집계한다', () => {
    const registry = new WorldRegistry({ capacity: 1_000 });
    const handles = [];
    for (let index = 0; index < 1_000; index++) {
        handles.push(activate(registry, {
            createdAtTick: index + 1,
            creationOrigin: (index & 1) === 0
                ? 'PLAYER_SENTENCE'
                : 'NATURAL'
        }));
    }
    const tracker = new HostileParticipationTracker();
    let status = tracker.refresh(registry);
    assert.equal(status.liveHostileActorCount, 1_000);
    assert.equal(status.fullReconcileCount, 1);

    const firstBatch = handles.slice(0, -1);
    for (const handle of firstBatch) {
        assert.equal(registry.remove(handle), true);
    }
    status = tracker.refresh(registry, {}, {
        lifecycle: {
            despawned: firstBatch.map((handle) => ({ handle })),
            spawned: [],
            registryRevision: registry.getRevision()
        }
    });
    assert.equal(status.liveHostileActorCount, 1);
    assert.equal(status.perTickRegistryScanCount, 0);
    assert.equal(status.fullReconcileCount, 1);

    const finalHandle = handles.at(-1);
    assert.equal(registry.remove(finalHandle), true);
    status = tracker.refresh(registry, {}, {
        lifecycle: {
            despawned: [{ handle: finalHandle }],
            spawned: [],
            registryRevision: registry.getRevision()
        }
    });
    assert.equal(status.liveHostileActorCount, 0);
    assert.equal(status.perTickRegistryScanCount, 0);
    assert.equal(status.fullReconcileCount, 1);
    const proof = createWaveClearProof(createSnapshot({
        totalSpawnCount: 1_000,
        snapshotRevision: status.revision,
        hostileRevision: status.revision,
        trackerRegistryRevision: status.registryRevision,
        registryRevision: registry.getRevision()
    }));
    assert.equal(proof.accepted, true);
});

test('256-step randomized tracker/quiescence는 oracle과 같고 steady full scan은 0이다', () => {
    const registry = new WorldRegistry({ capacity: 64 });
    let externalFullScanCount = 0;
    const port = Object.freeze({
        copyActiveHandlesInto(out, options) {
            externalFullScanCount++;
            return registry.copyActiveHandlesInto(out, options);
        },
        copyEntityView(handle, out) {
            return registry.copyEntityView(handle, out);
        },
        getRevision() {
            return registry.getRevision();
        }
    });
    const tracker = new HostileParticipationTracker();
    tracker.refresh(port);
    const live = [];
    let randomState = 0x9e37_79b9;
    const random = () => {
        randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
        return randomState;
    };
    for (let step = 0; step < 256; step++) {
        let changes;
        if (live.length === 0 || (live.length < 40 && (random() % 100) < 55)) {
            const hostile = (random() & 3) !== 0;
            const handle = activate(registry, {
                createdAtTick: step + 1,
                kindId: hostile ? 'enemy' : 'projectile',
                countsTowardHostile: hostile,
                creationOrigin: (random() & 1) === 0
                    ? 'PLAYER_SENTENCE'
                    : 'NATURAL'
            });
            live.push({ handle, hostile });
            changes = {
                lifecycle: {
                    despawned: [],
                    spawned: [{ handle }],
                    registryRevision: registry.getRevision()
                }
            };
        } else {
            const index = random() % live.length;
            const [{ handle }] = live.splice(index, 1);
            assert.equal(registry.remove(handle), true);
            changes = {
                lifecycle: {
                    despawned: [{ handle }],
                    spawned: [],
                    registryRevision: registry.getRevision()
                }
            };
        }
        const lifecyclePending = random() % 2;
        const materializationPending = random() % 2;
        const transitPending = random() % 2;
        const atomicPending = random() % 2;
        const actorPending = lifecyclePending
            + materializationPending
            + transitPending;
        const status = tracker.refresh(port, {
            pendingHostileActorCount: actorPending,
            pendingSiegeWeight: actorPending,
            pendingBountyPotential: actorPending,
            pendingSentenceCreatedCount: actorPending
        }, changes);
        const watermarkComplete = (random() & 3) !== 0;
        const receipt = createWaveClearProof(createSnapshot({
            snapshotRevision: step + 1,
            hostileRevision: status.revision,
            trackerRegistryRevision: status.registryRevision,
            registryRevision: registry.getRevision(),
            liveHostileActorCount: status.liveHostileActorCount,
            pendingHostileActorCount: status.pendingHostileActorCount,
            hostileLifecycleSpawnCount: lifecyclePending,
            hostileMaterializationCount: materializationPending,
            hostileTransitCount: transitPending,
            hostileAtomicTransformCount: atomicPending,
            lifecycleCommandCount: lifecyclePending,
            materializationWorkCount: materializationPending,
            transitActorCount: transitPending,
            atomicTransformWorkCount: atomicPending,
            lastSubmittedTick: step + 1,
            lastCompletedTick: watermarkComplete ? step + 1 : step,
            completedThroughTick: step + 1
        }));
        const oracle = status.countExact
            && status.liveHostileActorCount === 0
            && actorPending === 0
            && atomicPending === 0
            && watermarkComplete;
        assert.equal(receipt.accepted, oracle, `step=${step}`);
        assert.equal(status.perTickRegistryScanCount, 0, `scan step=${step}`);
        assert.equal(status.fullReconcileCount, 1, `reconcile step=${step}`);
    }
    assert.equal(externalFullScanCount, 1);
    assert.equal(tracker.getStatus().perEnemyUiObjectCount, 0);
});

test('GameObjectSystem은 proof 평가 뒤에만 gameplay ingress를 stage한다', async () => {
    const [gameObjectSource, endpointSource, waveDirectorSource] = await Promise.all([
        readFile(new URL(
            '../project/game/script/module/ingame/object/game_object_system.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../project/game/script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../project/game/script/module/ingame/flow/wave_director.js',
            import.meta.url
        ), 'utf8')
    ]);
    const evaluateIndex = gameObjectSource.indexOf(
        '#evaluateWaveQuiescenceBeforeGameplayIngress('
    );
    const waveStageIndex = gameObjectSource.indexOf(
        'this.waveDirector?.queueSpawnsForFixedTick(',
        evaluateIndex
    );
    const abilityStageIndex = gameObjectSource.indexOf(
        'this.abilityRuntime?.stageForFixedTick(',
        evaluateIndex
    );
    assert.ok(evaluateIndex > 0);
    assert.ok(waveStageIndex > evaluateIndex);
    assert.ok(abilityStageIndex > waveStageIndex);
    assert.match(
        gameObjectSource.slice(evaluateIndex, waveStageIndex),
        /!waveQuiescence\.gameplayIngressSealed/u
    );
    assert.match(endpointSource,
        /actorPayloadTransitLandings\.values\(\)[\s\S]*pendingHostileTransitCount/u);
    assert.match(waveDirectorSource, /completionOwned:\s*false/u);
    assert.doesNotMatch(waveDirectorSource, /createWaveClearProof|WaveRunCoordinator/u);
});

test('next Wave seam은 candidate init 뒤 원자 교체하고 authentic CLOSED 뒤에만 활성화한다', async () => {
    const [objectSource, gameSystemSource, gameSceneSource] = await Promise.all([
        readFile(new URL(
            '../project/game/script/module/ingame/object/game_object_system.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../project/game/script/module/ingame/game_system.js',
            import.meta.url
        ), 'utf8'),
        readFile(new URL(
            '../project/game/script/module/scene/game/_game_scene.js',
            import.meta.url
        ), 'utf8')
    ]);
    const prepareStart = objectSource.indexOf('    prepareNextWave(request = {})');
    const activateStart = objectSource.indexOf(
        '    activatePreparedNextWave(request = {})',
        prepareStart
    );
    const prepareSource = objectSource.slice(prepareStart, activateStart);
    assert.ok(prepareStart > 0 && activateStart > prepareStart);
    assert.ok(
        prepareSource.indexOf('candidate.init(this.tileMap)')
            < prepareSource.indexOf('oldWaveDirector.destroy()')
    );
    assert.ok(
        prepareSource.indexOf('oldWaveDirector.destroy()')
            < prepareSource.indexOf('this.waveDirector = candidate')
    );
    assert.doesNotMatch(prepareSource, /queueSpawnsForFixedTick/u);
    assert.match(prepareSource, /this\.waveGameplayIngressSealed = true/u);
    assert.match(
        objectSource.slice(activateStart),
        /this\.waveGameplayIngressSealed = false/u
    );
    const activationSource = objectSource.slice(
        activateStart,
        objectSource.indexOf(
            '    getNextWaveProgressionStatus()',
            activateStart
        )
    );
    assert.ok(
        activationSource.indexOf(
            'if (known?.activationReceipt) return known.activationReceipt;'
        ) < activationSource.indexOf('if (!prepared)')
    );
    assert.match(
        gameSystemSource,
        /progressClosing\(\)[\s\S]*SHOP_PHASE_RESULT_CODE\.CLOSED[\s\S]*#captureR9PendingShopClose/u
    );
    assert.match(
        gameSystemSource,
        /#progressR9ClosedShopBoundary\(\)[\s\S]*prepareNextWave\([\s\S]*observeShopContinue\([\s\S]*beginWave\([\s\S]*activatePreparedNextWave\(/u
    );
    assert.match(
        gameSceneSource,
        /r9WaveRunPlan: this\.r9WaveRunPlan[\s\S]*r9RunSessionId: this\.r9RunSessionId/u
    );
});

console.log('R9 exact wave quiescence authority: ok');
