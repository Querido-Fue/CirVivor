import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const { GoldLedger } = await loadGameModule('ingame/state/gold_ledger.js');
const { BountyRewardDirector } = await loadGameModule(
    'ingame/object/enemy/bounty_reward_director.js'
);
const { HostileParticipationTracker } = await loadGameModule(
    'ingame/state/hostile_participation_tracker.js'
);
const { WorldRegistry } = await loadGameModule(
    'ingame/object/world_registry.js'
);
const { SentenceRuntimeEstimator } = await loadGameModule(
    'ingame/word/sentence_runtime_estimator.js'
);
const { evaluateActorPayloadCapacity } = await loadGameModule(
    'ingame/word/actor_payload_budget.js'
);
const { WordSystem } = await loadGameModule('ingame/word/word_system.js');
const {
    R3_ENEMY_WORD_OFFER_METADATA,
    R3_SHOWCASE_SENTENCE_LOADOUT
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} = await loadGameModule(
    'ingame/contract/enemy_lifecycle_disposition_contract.js'
);
const { GPU_CIRCLE_APPLIED_EVENT_FLAG } = await loadGameModule(
    'ingame/physics/gpu/gpu_circle_body_abi.js'
);

const ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');

const PROTOCOL = Object.freeze({
    sessionGeneration: 1,
    deviceGeneration: 2,
    authoritativeEpoch: 3,
    sourceTick: 4
});

function activate(registry, {
    kindId = 'enemy',
    definitionId = 'basic_circle_01',
    createdAtTick = 1,
    metadata = {}
} = {}) {
    const handle = registry.reserveEntity({
        kindId,
        definitionId,
        createdAtTick
    });
    assert.ok(handle);
    assert.equal(registry.activateReserved(handle, metadata), true);
    return handle;
}

function createKillFixture({ creationOrigin = 'NATURAL', bountyBudget = 1 } = {}) {
    const registry = new WorldRegistry({ capacity: 16 });
    const source = activate(registry, {
        kindId: 'projectile',
        definitionId: 'basic_bullet_01',
        metadata: { teamId: 1 }
    });
    const target = activate(registry, {
        metadata: {
            teamId: 2,
            bountyBudget,
            weight: 1,
            siegeWeight: 1,
            rewardEligible: true,
            countsTowardHostile: true,
            countsTowardSiege: true,
            creationOrigin
        }
    });
    const damage = Object.freeze({
        ...PROTOCOL,
        key: `damage:${source.entityId}:${target.entityId}`,
        type: 'contact',
        eventType: 'damage-applied',
        disposition: 'applied',
        entityId: source.entityId,
        incarnation: source.incarnation,
        other: target,
        flags: GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
    });
    const death = Object.freeze({
        ...PROTOCOL,
        key: `death:${target.entityId}:${target.incarnation}`,
        type: 'death',
        eventType: 'death',
        disposition: 'despawn-requested',
        entityId: target.entityId,
        incarnation: target.incarnation
    });
    const snapshot = Object.freeze({
        events: Object.freeze([damage, death]),
        protocolFailure: null
    });
    const commandId = `gpu-death:${death.key}`;
    return { registry, source, target, snapshot, commandId };
}

function playerKillCommit(fixture, disposition = ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL) {
    return Object.freeze({
        state: 'committed',
        recoveryRequired: false,
        despawned: Object.freeze([Object.freeze({
            commandId: fixture.commandId,
            handle: fixture.target,
            reason: 'gpu-death',
            disposition,
            bountyEligible:
                disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.PLAYER_KILL
        })])
    });
}

function createBountyHarness(options = {}) {
    const goldLedger = new GoldLedger();
    const director = new BountyRewardDirector({
        goldLedger,
        sessionGeneration: options.sessionGeneration ?? 1
    });
    return { goldLedger, director };
}

test('sentence-created Enemy와 natural Enemy의 authentic Player kill은 Gold를 각각 정확히 한 번 지급한다', () => {
    for (const creationOrigin of ['PLAYER_SENTENCE', 'NATURAL']) {
        const fixture = createKillFixture({ creationOrigin, bountyBudget: 3 });
        const { goldLedger, director } = createBountyHarness();
        assert.equal(
            director.observeCompletedEvents(
                fixture.snapshot,
                fixture.registry
            ).stagedClaimCount,
            1
        );
        const first = director.observeLifecycle(playerKillCommit(fixture), 5);
        const replay = director.observeLifecycle(playerKillCommit(fixture), 5);
        assert.equal(first.payoutCount, 1);
        assert.equal(first.payoutAmount, 3);
        assert.equal(replay.payoutCount, 0);
        assert.equal(goldLedger.getBalance(), 3);
        assert.equal(goldLedger.getStatus().creditCount, 1);
    }
});

test('Core impact와 MERGE/TRANSFORM consumption은 direct payout 0이고 bounty budget은 destination으로 보존된다', () => {
    const fixture = createKillFixture({ bountyBudget: 7 });
    const { goldLedger, director } = createBountyHarness();
    director.observeCompletedEvents(fixture.snapshot, fixture.registry);
    const core = director.observeLifecycle(playerKillCommit(
        fixture,
        ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
    ), 5);
    assert.equal(core.payoutCount, 0);

    const transferredBudget = 5 + 2;
    const transformCommit = Object.freeze({
        state: 'committed',
        recoveryRequired: false,
        spawned: Object.freeze([{ metadata: { bountyBudget: transferredBudget } }]),
        despawned: Object.freeze([
            {
                commandId: 'merge-a',
                disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED,
                bountyEligible: false
            },
            {
                commandId: 'transform-b',
                disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED,
                bountyEligible: false
            }
        ])
    });
    assert.equal(director.observeLifecycle(transformCommit, 6).payoutCount, 0);
    assert.equal(transformCommit.spawned[0].metadata.bountyBudget, 7);
    assert.equal(goldLedger.getBalance(), 0);
});

test('duplicate/replay와 old session/ABA identity는 Gold를 만들지 않는다', () => {
    const fixture = createKillFixture({ bountyBudget: 2 });
    const { goldLedger, director } = createBountyHarness();
    director.observeCompletedEvents(fixture.snapshot, fixture.registry);
    director.observeCompletedEvents(fixture.snapshot, fixture.registry);
    director.observeLifecycle(playerKillCommit(fixture), 5);
    director.observeLifecycle(playerKillCommit(fixture), 5);
    assert.equal(goldLedger.getBalance(), 2);

    director.resetGpuBinding(2);
    assert.equal(
        director.observeCompletedEvents(fixture.snapshot, fixture.registry)
            .stagedClaimCount,
        0
    );
    director.observeLifecycle(playerKillCommit(fixture), 6);
    assert.equal(goldLedger.getBalance(), 2);

    fixture.registry.remove(fixture.target);
    const aba = activate(fixture.registry, {
        metadata: {
            teamId: 2,
            bountyBudget: 99,
            weight: 1,
            rewardEligible: true
        }
    });
    assert.equal(aba.entityId, fixture.target.entityId);
    assert.notEqual(aba.incarnation, fixture.target.incarnation);
    assert.equal(
        director.observeCompletedEvents({
            ...fixture.snapshot,
            events: fixture.snapshot.events.map((event) => ({
                ...event,
                sessionGeneration: 2
            }))
        }, fixture.registry).stagedClaimCount,
        0
    );
    assert.equal(goldLedger.getBalance(), 2);
});

test('hostile tracker는 live/pending count와 siege를 보존하고 per-Enemy UI 객체를 만들지 않는다', () => {
    const registry = new WorldRegistry({ capacity: 16 });
    const natural = activate(registry, {
        metadata: { teamId: 2, weight: 99, siegeWeight: 2, bountyBudget: 1 }
    });
    const sentence = activate(registry, {
        metadata: {
            teamId: 2,
            weight: 17,
            siegeWeight: 1,
            bountyBudget: 1,
            creationOrigin: 'PLAYER_SENTENCE',
            countsTowardHostile: true,
            countsTowardSiege: true
        }
    });
    const tracker = new HostileParticipationTracker();
    const first = tracker.refresh(registry, {
        pendingHostileActorCount: 3,
        pendingSiegeWeight: 3,
        pendingBountyPotential: 6,
        pendingSentenceCreatedCount: 3
    });
    assert.equal(first.liveHostileActorCount, 2);
    assert.equal(first.pendingHostileActorCount, 3);
    assert.equal(first.siegeWeight, 6);
    assert.equal(first.bountyPotential, 8);
    assert.equal(first.sentenceCreatedCount, 4);
    assert.equal(first.perEnemyUiObjectCount, 0);

    registry.remove(natural);
    registry.remove(sentence);
    const composite = activate(registry, {
        metadata: { teamId: 2, weight: 3, siegeWeight: 3, bountyBudget: 2 }
    });
    const lifecycle = Object.freeze({
        despawned: Object.freeze([
            Object.freeze({ handle: natural }),
            Object.freeze({ handle: sentence })
        ]),
        spawned: Object.freeze([Object.freeze({ handle: composite })]),
        registryRevision: registry.getRevision()
    });
    const transformed = tracker.refresh(registry, {}, { lifecycle });
    assert.equal(transformed.liveSiegeWeight, first.liveSiegeWeight);
    assert.equal(transformed.liveBountyPotential, 2);
    const replayed = tracker.refresh(registry, {}, { lifecycle });
    assert.equal(replayed.liveHostileActorCount, 1);
    assert.equal(replayed.liveSiegeWeight, 3);
    const stringIdentityReplay = tracker.refresh(registry, {}, {
        lifecycle: {
            despawned: [{
                handle: {
                    entityId: String(composite.entityId),
                    incarnation: composite.incarnation
                }
            }],
            spawned: [],
            registryRevision: registry.getRevision()
        }
    });
    assert.equal(stringIdentityReplay.liveHostileActorCount, 1);
    assert.equal(transformed.perEnemyUiObjectCount, 0);
});

test('incremental hostile tracker는 randomized lifecycle/ABA에서 full audit와 동일하다', () => {
    const registry = new WorldRegistry({ capacity: 32 });
    let fullScanCount = 0;
    const incrementalRegistryPort = Object.freeze({
        copyActiveHandlesInto(target, options) {
            fullScanCount++;
            return registry.copyActiveHandlesInto(target, options);
        },
        copyEntityView(handle, target) {
            return registry.copyEntityView(handle, target);
        },
        getRevision() {
            return registry.getRevision();
        }
    });
    const tracker = new HostileParticipationTracker();
    tracker.refresh(incrementalRegistryPort);

    const comparableFields = Object.freeze([
        'registryRevision',
        'liveHostileActorCount',
        'pendingHostileActorCount',
        'hostileActorCount',
        'liveSiegeWeight',
        'pendingSiegeWeight',
        'siegeWeight',
        'liveBountyPotential',
        'pendingBountyPotential',
        'bountyPotential',
        'liveSentenceCreatedCount',
        'pendingSentenceCreatedCount',
        'sentenceCreatedCount',
        'perEnemyUiObjectCount'
    ]);
    const comparable = (snapshot) => Object.fromEntries(
        comparableFields.map((field) => [field, snapshot[field]])
    );
    const liveHandles = [];
    const latestIncarnationByEntityId = new Map();
    let observedAbaReuse = false;
    let randomState = 0x51e9a4d3;
    const random = () => {
        randomState = (
            Math.imul(randomState, 1664525) + 1013904223
        ) >>> 0;
        return randomState;
    };

    for (let step = 0; step < 256; step++) {
        let changes;
        const shouldSpawn = liveHandles.length === 0
            || (liveHandles.length < 24 && random() % 100 < 60);
        if (shouldSpawn) {
            const handle = activate(registry, {
                createdAtTick: step + 1,
                metadata: {
                    teamId: 2,
                    weight: 1000 + step,
                    siegeWeight: ((random() % 8) + 1) / 4,
                    bountyBudget: random() % 7,
                    creationOrigin: (random() & 1) === 0
                        ? 'PLAYER_SENTENCE'
                        : 'NATURAL',
                    countsTowardHostile: true,
                    countsTowardSiege: true
                }
            });
            const previousIncarnation = latestIncarnationByEntityId.get(handle.entityId);
            if (previousIncarnation !== undefined
                && previousIncarnation !== handle.incarnation) {
                observedAbaReuse = true;
            }
            latestIncarnationByEntityId.set(handle.entityId, handle.incarnation);
            liveHandles.push(handle);
            changes = step % 5 === 0
                ? { publishedHandles: [handle] }
                : {
                    lifecycle: {
                        despawned: [],
                        spawned: [{ handle }],
                        registryRevision: registry.getRevision()
                    }
                };
        } else {
            const index = random() % liveHandles.length;
            const [handle] = liveHandles.splice(index, 1);
            assert.equal(registry.remove(handle), true);
            changes = {
                lifecycle: {
                    despawned: [{ handle }],
                    spawned: [],
                    registryRevision: registry.getRevision()
                }
            };
        }

        const pending = {
            pendingHostileActorCount: random() % 4,
            pendingSiegeWeight: (random() % 8) / 4,
            pendingBountyPotential: random() % 9,
            pendingSentenceCreatedCount: random() % 4
        };
        const actual = tracker.refresh(incrementalRegistryPort, pending, changes);
        const replayed = tracker.refresh(incrementalRegistryPort, pending, changes);
        assert.deepEqual(comparable(replayed), comparable(actual));

        const auditTracker = new HostileParticipationTracker();
        const expected = auditTracker.refresh(registry, pending);
        assert.deepEqual(comparable(actual), comparable(expected), `step=${step}`);
        auditTracker.destroy();
    }

    assert.equal(observedAbaReuse, true);
    assert.equal(fullScanCount, 1);
    assert.equal(tracker.getStatus().perEnemyUiObjectCount, 0);
    tracker.destroy();
});

test('Enemy offer metadata는 normal Subject+Payload, shop, hostile bounty/siege 계약을 노출한다', () => {
    const offer = R3_ENEMY_WORD_OFFER_METADATA;
    assert.equal(offer.wordKind, 'Entity Word');
    assert.deepEqual([...offer.roles].sort(), ['payload', 'subject']);
    assert.equal(offer.shopEligible, true);
    assert.equal(offer.payloadTeamId, 2);
    assert.equal(offer.bountyPolicy, 'DEFINITION_RESOLVED_ORDINARY_ENEMY');
    assert.equal(offer.countsTowardHostile, true);
    assert.equal(offer.countsTowardSiege, true);
});

test('sentence-created registry publication은 provenance/economy와 GPU generation authority를 보존한다', () => {
    for (const field of [
        'creationOrigin',
        'sourceAbilityId',
        'sourceExecutionId',
        'siegeWeight',
        'rewardEligible'
    ]) {
        assert.match(ENDPOINT_SOURCE, new RegExp(`metadata\\.${field}`));
    }
    assert.match(ENDPOINT_SOURCE, /Object\.entries\(template/);
    assert.match(ENDPOINT_SOURCE, /metadata\.generation = null/);
    assert.match(ENDPOINT_SOURCE,
        /generationAuthority = 'GPU_ABILITY_METADATA'/);
    assert.match(ENDPOINT_SOURCE,
        /generationRule = 'SOURCE_GENERATION_PLUS_ONE'/);
    assert.match(ENDPOINT_SOURCE,
        /metadata\.siegeWeight = Number\(template\.siegeWeight\)/);
    assert.doesNotMatch(ENDPOINT_SOURCE,
        /metadata\.siegeWeight = Number\(template\.weight/);
});

test('preview는 runtime subject/count와 동일하고 shared capacity 판정을 사용하며 danger가 실행을 막지 않는다', () => {
    const runtime = Object.freeze({
        livingTowerCount: 1,
        liveHostileActorCount: 4,
        pendingHostileActorCount: 1,
        siegeWeight: 5,
        registryAvailable: 8,
        bodyAvailable: 6,
        bountyPerEnemy: 1,
        siegeWeightPerEnemy: 1,
        dangerThreshold: 5
    });
    const estimator = new SentenceRuntimeEstimator({
        getRuntimeState: () => runtime
    });
    const compiledAbility = Object.freeze({
        previewFormulaId: 'preview.actor-payload.enemy.v1',
        subjectSelector: Object.freeze({ code: 2 }),
        budgets: Object.freeze({ subjectCount: 1000, generatedBodyCount: 1000 }),
        cooldownTicks: 1
    });
    const preview = estimator.estimate(compiledAbility, {
        cooldown: { remainingTicks: 0 }
    });
    const runtimeCapacity = evaluateActorPayloadCapacity({
        requiredBodies: 4,
        registryAvailable: 8,
        bodyAvailable: 6,
        generatedBodyBudget: 1000
    });
    assert.equal(preview.subjectCount, runtime.liveHostileActorCount);
    assert.equal(preview.rawSubjectCount, 4);
    assert.equal(preview.eligibleSubjectCount, 4);
    assert.equal(preview.previewSubjectCount, 4);
    assert.equal(preview.subjectBudget, 1000);
    assert.equal(preview.countExact, false);
    assert.equal(preview.newEnemyCount, 4);
    assert.equal(preview.resultingHostileCount, 9);
    assert.equal(preview.potentialBounty, 4);
    assert.deepEqual(preview.capacityValidity, runtimeCapacity);
    assert.equal(preview.dangerous, true);
    assert.equal(preview.executionEnabled, true);

    const oneShort = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({ ...runtime, bodyAvailable: 3 })
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(oneShort.capacityValidity.valid, false);
    assert.equal(oneShort.executionEnabled, false);

    const estimateBoundary = (
        rawSubjectCount,
        {
            availableBodies = rawSubjectCount,
            cooldownRemainingTicks = 0,
            dangerThreshold = 10_000
        } = {}
    ) => new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            ...runtime,
            liveHostileActorCount: rawSubjectCount,
            pendingHostileActorCount: 0,
            registryAvailable: availableBodies,
            bodyAvailable: availableBodies,
            dangerThreshold
        })
    }).estimate(compiledAbility, {
        cooldown: { remainingTicks: cooldownRemainingTicks }
    });
    const boundary999 = estimateBoundary(999);
    const boundary1000 = estimateBoundary(1000);
    const boundary1001 = estimateBoundary(1001, { availableBodies: 2000 });
    assert.deepEqual([
        boundary999.rawSubjectCount,
        boundary999.previewSubjectCount,
        boundary999.newEnemyCount,
        boundary999.executionEnabled
    ], [999, 999, 999, true]);
    assert.deepEqual([
        boundary1000.rawSubjectCount,
        boundary1000.previewSubjectCount,
        boundary1000.newEnemyCount,
        boundary1000.executionEnabled
    ], [1000, 1000, 1000, true]);
    assert.deepEqual({
        rawSubjectCount: boundary1001.rawSubjectCount,
        eligibleSubjectCount: boundary1001.eligibleSubjectCount,
        previewSubjectCount: boundary1001.previewSubjectCount,
        newEnemyCount: boundary1001.newEnemyCount,
        subjectBudget: boundary1001.subjectBudget,
        countExact: boundary1001.countExact,
        capacityValidity: boundary1001.capacityValidity.valid,
        executionEnabled: boundary1001.executionEnabled,
        executionDisabledReason: boundary1001.executionDisabledReason
    }, {
        rawSubjectCount: 1001,
        eligibleSubjectCount: 1001,
        previewSubjectCount: 0,
        newEnemyCount: 0,
        subjectBudget: 1000,
        countExact: false,
        capacityValidity: false,
        executionEnabled: false,
        executionDisabledReason: 'SUBJECT_BUDGET_EXCEEDED'
    });
    const boundaryOneShort = estimateBoundary(1000, {
        availableBodies: 999
    });
    assert.equal(boundaryOneShort.capacityValidity.valid, false);
    assert.equal(boundaryOneShort.executionEnabled, false);
    assert.equal(
        boundaryOneShort.executionDisabledReason,
        'DESTINATION_CAPACITY_EXCEEDED'
    );
    const cooldownActive = estimateBoundary(999, {
        availableBodies: 1000,
        cooldownRemainingTicks: 1
    });
    assert.equal(cooldownActive.executionEnabled, false);
    assert.equal(cooldownActive.executionDisabledReason, 'COOLDOWN_ACTIVE');
    const dangerousButValid = estimateBoundary(999, {
        availableBodies: 1000,
        dangerThreshold: 1
    });
    assert.equal(dangerousButValid.dangerous, true);
    assert.equal(dangerousButValid.executionEnabled, true);
    assert.equal(dangerousButValid.executionDisabledReason, null);
});

test('GPU recovery는 Gold와 Word slots를 보존하고 old completion만 격리한다', () => {
    const wordSystem = new WordSystem({ loadout: R3_SHOWCASE_SENTENCE_LOADOUT });
    const slotsBefore = wordSystem.getSlotViews().map((slot) => ({
        slotId: slot.slotId,
        compiledAbilityId: slot.compiledAbilityId
    }));
    const fixture = createKillFixture({ bountyBudget: 4 });
    const { goldLedger, director } = createBountyHarness();
    director.observeCompletedEvents(fixture.snapshot, fixture.registry);
    director.observeLifecycle(playerKillCommit(fixture), 5);
    director.resetGpuBinding(2);
    director.observeLifecycle(playerKillCommit(fixture), 6);
    const slotsAfter = wordSystem.getSlotViews().map((slot) => ({
        slotId: slot.slotId,
        compiledAbilityId: slot.compiledAbilityId
    }));
    assert.equal(goldLedger.getBalance(), 4);
    assert.deepEqual(slotsAfter, slotsBefore);
});

test('production endpoint는 exact TARGET_DIED Player provenance에만 PLAYER_KILL을 부여한다', () => {
    assert.match(ENDPOINT_SOURCE, /isAuthenticatedPlayerLethalEvent/);
    assert.match(ENDPOINT_SOURCE,
        /TARGET_DIED[\s\S]*GAMEPLAY_TEAM_ID\.PLAYER[\s\S]*GAMEPLAY_TEAM_ID\.HOSTILE/);
    assert.match(ENDPOINT_SOURCE,
        /lethalDisposition[\s\S]*ENEMY_LIFECYCLE_DISPOSITION_ID\.PLAYER_KILL/);
});
