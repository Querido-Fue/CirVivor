import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_ACTION_ACTIVATION_POLICY,
    ACTOR_ACTION_PROFILE_ID,
    ACTOR_ACTION_SPAWN_ANCHOR_POLICY,
    ACTOR_ACTION_TARGET_SNAPSHOT_POLICY,
    ACTOR_ACTION_TRANSIT_POLICY
} = await loadGameModule('ingame/contract/actor_action_contract.js');
const {
    ACTOR_PAYLOAD_CODE,
    ABILITY_SLOT_ID,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_RUNTIME_SUPPORT,
    isFixedHostileEnemyPayload,
    isFixedPlayerTowerPayload,
    normalizeSentenceDefinition,
    normalizeWordDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');
const {
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    R3_ENEMY_ACTOR_PAYLOAD_DEFINITION
} = await loadGameModule('ingame/contract/actor_payload_contract.js');
const {
    THE_TOWER_DEFINITION_ID
} = await loadGameModule('data/object/tower/the_tower_data.js');
const {
    BASIC_CIRCLE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    R5_ACTOR_ACTION_PROFILES,
    R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE,
    R5_EMIT_ACTOR_ACTION_PROFILE,
    R5_SHOOT_ACTOR_ACTION_PROFILE,
    R5_SUMMON_ACTOR_ACTION_PROFILE,
    R5_THROW_ACTOR_ACTION_PROFILE
} = await loadGameModule('data/word/r5_actor_action_profile_data.js');
const {
    EMIT_VERB_WORD_DEFINITION,
    ENEMY_ENTITY_WORD_DEFINITION,
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE,
    R3_ENEMY_WORD_INSTANCE,
    R3_SHOOT_WORD_INSTANCE,
    R3_TOWER_SHOOTS_ENEMY_SENTENCE,
    R3_TOWER_WORD_INSTANCE,
    R5_EMIT_WORD_INSTANCE,
    R5_ENEMIES_SHOOT_TOWER_SENTENCE,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R5_SUMMON_WORD_INSTANCE,
    R5_THROW_WORD_INSTANCE,
    R5_TOWER_SHOOTS_TOWER_SENTENCE,
    R5_WORD_DEFINITION_BY_ID,
    R5_WORD_DEFINITIONS,
    R5_WORD_INSTANCE_BY_ID,
    SUMMON_VERB_WORD_DEFINITION,
    THROW_VERB_WORD_DEFINITION,
    TOWER_ENTITY_WORD_DEFINITION
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    createProductionGameStartOptions
} = await loadGameModule('scene/game/production_game_start_route.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    SentenceRuntimeEstimator
} = await loadGameModule('ingame/word/sentence_runtime_estimator.js');

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function createSentence(subject, verb, payload, suffix = 'fixture') {
    return normalizeSentenceDefinition({
        id: `sentence.r5.${subject.id}.${verb.id}.${payload.id}.${suffix}`,
        subjectWordInstanceId: subject.id,
        verbWordInstanceId: verb.id,
        payloadWordInstanceId: payload.id,
        modifierWordInstanceIds: []
    });
}

test('R5 stable verb/action/payload identity는 기존 값을 보존하고 append-only로 확장된다', () => {
    assert.deepEqual({ ...WORD_DEFINITION_ID }, {
        TOWER: 'word.entity.tower',
        ENEMY: 'word.entity.enemy',
        SHOOT: 'verb.shoot',
        THROW: 'verb.throw',
        EMIT: 'verb.emit',
        SUMMON: 'verb.summon'
    });
    assert.deepEqual({ ...SENTENCE_ACTION_CODE }, {
        SHOOT: 1,
        THROW: 2,
        EMIT: 3,
        SUMMON: 4
    });
    assert.deepEqual({ ...ACTOR_PAYLOAD_CODE }, { ENEMY: 1, TOWER: 2 });
    assert.equal(WORD_RUNTIME_SUPPORT.R3, 'r3');
    assert.equal(WORD_RUNTIME_SUPPORT.FUTURE_R5, 'future-r5');
    assert.equal(WORD_RUNTIME_SUPPORT.R5, 'r5');

    assert.equal(TOWER_ENTITY_WORD_DEFINITION.payload.definitionId,
        THE_TOWER_DEFINITION_ID);
    assert.equal(TOWER_ENTITY_WORD_DEFINITION.payload.runtimeSupport,
        WORD_RUNTIME_SUPPORT.R5);
    assert.equal(TOWER_ENTITY_WORD_DEFINITION.payload.allegiancePolicy,
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER);
    assert.equal(isFixedPlayerTowerPayload(TOWER_ENTITY_WORD_DEFINITION), true);
    assert.equal(ENEMY_ENTITY_WORD_DEFINITION.payload.definitionId,
        BASIC_CIRCLE_ENEMY_DATA.id);
    assert.equal(isFixedHostileEnemyPayload(ENEMY_ENTITY_WORD_DEFINITION), true);
    assert.equal(THROW_VERB_WORD_DEFINITION.actionCode,
        SENTENCE_ACTION_CODE.THROW);
    assert.equal(EMIT_VERB_WORD_DEFINITION.actionCode,
        SENTENCE_ACTION_CODE.EMIT);
    assert.equal(SUMMON_VERB_WORD_DEFINITION.actionCode,
        SENTENCE_ACTION_CODE.SUMMON);
    assertDeepFrozen(R5_WORD_DEFINITIONS);
});

test('R5 actor-action profile catalog는 placement/activation/transit 숫자의 단일 불변 권위다', () => {
    assert.equal(R5_ACTOR_ACTION_PROFILES.length, 4);
    assert.equal(new Set(R5_ACTOR_ACTION_PROFILES.map(({ id }) => id)).size, 4);
    assert.equal(new Set(R5_ACTOR_ACTION_PROFILES.map(
        ({ actionCode }) => actionCode
    )).size, 4);
    for (const profile of R5_ACTOR_ACTION_PROFILES) {
        assert.strictEqual(
            R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE[profile.actionCode],
            profile
        );
        assert.equal(
            profile.targetSnapshotPolicy,
            ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START
        );
    }
    assert.equal(R5_SHOOT_ACTOR_ACTION_PROFILE.id,
        ACTOR_ACTION_PROFILE_ID.SHOOT);
    assert.equal(R5_SHOOT_ACTOR_ACTION_PROFILE.spawnAnchorPolicy,
        ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE);
    assert.equal(R5_THROW_ACTOR_ACTION_PROFILE.activationPolicy,
        ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING);
    assert.equal(R5_THROW_ACTOR_ACTION_PROFILE.transit.policy,
        ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH);
    assert.equal(R5_THROW_ACTOR_ACTION_PROFILE.transit.suspendControl, true);
    assert.equal(R5_THROW_ACTOR_ACTION_PROFILE.transit.suppressContact, true);
    assert.equal(R5_EMIT_ACTOR_ACTION_PROFILE.launchSpeed, 0);
    assert.equal(R5_SUMMON_ACTOR_ACTION_PROFILE.spawnAnchorPolicy,
        ACTOR_ACTION_SPAWN_ANCHOR_POLICY.TARGET_POINT);
    assert.equal(R5_SUMMON_ACTOR_ACTION_PROFILE.summonLatticeSpacing,
        Math.fround(1.0625));
    assert.equal(R3_ENEMY_ACTOR_PAYLOAD_DEFINITION.launchSpeed,
        R5_SHOOT_ACTOR_ACTION_PROFILE.launchSpeed);
    assert.equal(R3_ENEMY_ACTOR_PAYLOAD_DEFINITION.surfaceGap,
        R5_SHOOT_ACTOR_ACTION_PROFILE.surfaceGap);
    assertDeepFrozen(R5_ACTOR_ACTION_PROFILES);
});

test('Tower/Enemy Subject × 4 verbs × Tower/Enemy Payload 16개가 immutable plan으로 compile된다', () => {
    const compiler = new SentenceCompiler();
    const subjects = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
    const verbs = [
        R3_SHOOT_WORD_INSTANCE,
        R5_THROW_WORD_INSTANCE,
        R5_EMIT_WORD_INSTANCE,
        R5_SUMMON_WORD_INSTANCE
    ];
    const payloads = [R3_TOWER_WORD_INSTANCE, R3_ENEMY_WORD_INSTANCE];
    const compiledIds = new Set();

    for (const subject of subjects) {
        for (const verb of verbs) {
            for (const payload of payloads) {
                const sentence = createSentence(subject, verb, payload);
                const result = compiler.tryCompile(sentence);
                assert.equal(result.valid, true, result.message);
                const ability = result.compiledAbility;
                const profile = R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE[
                    ability.actionCode
                ];
                assert.equal(ability.actorActionProfileId, profile.id);
                assert.strictEqual(ability.actorActionProfile, profile);
                assert.equal(ability.targetSnapshotPolicy,
                    ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START);
                assert.equal(ability.executionPolicy.atomic, true);
                assert.equal(
                    ability.executionPolicy.generatedSubjectsJoinCurrentExecution,
                    false
                );
                assert.equal(ability.budgets.subjectCount, 1000);
                assert.equal(ability.budgets.generatedBodyCount, 1000);
                assert.equal(ability.budgets.generation, 65535);
                assert.equal(
                    ability.subjectSelector.code,
                    subject === R3_TOWER_WORD_INSTANCE
                        ? SUBJECT_SELECTOR_CODE.TOWER
                        : SUBJECT_SELECTOR_CODE.ENEMY
                );
                assert.equal(
                    ability.payloadCode,
                    payload === R3_TOWER_WORD_INSTANCE
                        ? ACTOR_PAYLOAD_CODE.TOWER
                        : ACTOR_PAYLOAD_CODE.ENEMY
                );
                assert.equal(
                    ability.allegiancePolicy,
                    payload === R3_TOWER_WORD_INSTANCE
                        ? GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
                        : GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
                );
                assertDeepFrozen(ability);
                compiledIds.add(ability.compiledAbilityId);
            }
        }
    }
    assert.equal(compiledIds.size, 16);
    assert.equal(compiler.getCacheSize(), 16);
});

test('R3 Q/E identity와 cache/command fingerprint replay는 유지되고 verb 변경은 분리된다', () => {
    const compiler = new SentenceCompiler();
    const q = compiler.compile(R3_TOWER_SHOOTS_ENEMY_SENTENCE);
    const qReplay = compiler.compile(R3_TOWER_SHOOTS_ENEMY_SENTENCE);
    const e = compiler.compile(R3_ENEMIES_SHOOT_ENEMIES_SENTENCE);
    assert.strictEqual(qReplay, q);
    assert.equal(q.compiledAbilityId,
        'compiled-ability.r3:word.entity.tower:verb.shoot:word.entity.enemy:abi1');
    assert.equal(e.compiledAbilityId,
        'compiled-ability.r3:word.entity.enemy:verb.shoot:word.entity.enemy:abi1');
    assert.equal(q.actorActionProfileId, ACTOR_ACTION_PROFILE_ID.SHOOT);

    const throwAbility = compiler.compile(createSentence(
        R3_TOWER_WORD_INSTANCE,
        R5_THROW_WORD_INSTANCE,
        R3_ENEMY_WORD_INSTANCE,
        'fingerprint'
    ));
    const commandSource = {
        executionId: 'execution.r5.fingerprint',
        executionOrdinal: 1,
        targetFixedTick: 1,
        aimPoint: { x: 3, y: 4 }
    };
    const qCommand = normalizeAbilityExecutionCommand({
        ...commandSource,
        compiledAbility: q
    });
    const qCommandReplay = normalizeAbilityExecutionCommand({
        ...commandSource,
        compiledAbility: qReplay
    });
    const throwCommand = normalizeAbilityExecutionCommand({
        ...commandSource,
        compiledAbility: throwAbility
    });
    assert.equal(qCommandReplay.fingerprint, qCommand.fingerprint);
    assert.notEqual(throwCommand.fingerprint, qCommand.fingerprint);
});

test('localized text는 R5 semantic identity와 무관하고 modifier는 계속 구조적으로 거절된다', () => {
    const localizedDefinitions = R5_WORD_DEFINITIONS.map((definition) => (
        normalizeWordDefinition({
            ...definition,
            display: {
                test: {
                    singular: `${definition.id}.one`,
                    plural: `${definition.id}.many`
                }
            }
        })
    ));
    const localizedCompiler = new SentenceCompiler({
        wordDefinitionsById: Object.freeze(Object.fromEntries(
            localizedDefinitions.map((definition) => [definition.id, definition])
        )),
        wordInstancesById: R5_WORD_INSTANCE_BY_ID
    });
    const canonicalCompiler = new SentenceCompiler();
    const sentence = createSentence(
        R3_ENEMY_WORD_INSTANCE,
        R5_SUMMON_WORD_INSTANCE,
        R3_TOWER_WORD_INSTANCE,
        'localized'
    );
    assert.equal(
        localizedCompiler.compile(sentence).compiledAbilityId,
        canonicalCompiler.compile(sentence).compiledAbilityId
    );
    const dangerous = canonicalCompiler.tryCompile(
        R5_ENEMIES_SHOOT_TOWER_SENTENCE
    );
    assert.equal(dangerous.valid, true);
    assert.doesNotMatch(JSON.stringify(dangerous.compiledAbility),
        /harmful|suicide|exploit|recommended/i);
    assert.equal(canonicalCompiler.tryCompile({
        ...sentence,
        id: 'sentence.r5.modifier.unsupported',
        modifierWordInstanceIds: ['word-instance.modifier.unknown']
    }).code, SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER);
});

test('production loadout은 SHIFT/SPACE R5, Q/E R3, empty PRIMARY compatibility를 고정한다', () => {
    assert.strictEqual(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.SHIFT],
        R5_TOWER_SHOOTS_TOWER_SENTENCE
    );
    assert.strictEqual(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.SPACE],
        R5_ENEMIES_SHOOT_TOWER_SENTENCE
    );
    assert.strictEqual(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.Q],
        R3_TOWER_SHOOTS_ENEMY_SENTENCE
    );
    assert.strictEqual(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.E],
        R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
    );
    assert.equal(
        R5_SHOWCASE_SENTENCE_LOADOUT[ABILITY_SLOT_ID.PRIMARY_POINTER],
        undefined
    );
    const options = createProductionGameStartOptions(
        CORRIDOR_EIGHT_MAP_DATA.id
    );
    assert.strictEqual(options.wordSystemOptions.loadout,
        R5_SHOWCASE_SENTENCE_LOADOUT);
});

test('Tower Payload preview는 R4 seam을 사용하되 count/placement가 없으면 exact를 주장하지 않는다', () => {
    const compiledAbility = new SentenceCompiler().compile(
        R5_ENEMIES_SHOOT_TOWER_SENTENCE
    );
    let previewCalls = 0;
    const inexact = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 1,
            liveHostileActorCount: 3,
            hostileSubjectCountExact: false,
            registryAvailable: 16,
            bodyAvailable: 16
        }),
        previewTowerCreation: () => {
            previewCalls++;
            return { executionEnabled: true };
        }
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(previewCalls, 0);
    assert.equal(inexact.countExact, false);
    assert.equal(inexact.placementExact, false);
    assert.equal(inexact.previewExact, false);
    assert.equal(inexact.executionEnabled, false);
    assert.equal(inexact.executionDisabledReason, 'SUBJECT_COUNT_NOT_EXACT');
    assert.equal(inexact.towerCreationPreview, null);

    const missingCount = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 1,
            liveHostileActorCount: null,
            hostileSubjectCountExact: true,
            registryAvailable: 16,
            bodyAvailable: 16
        }),
        previewTowerCreation: () => {
            previewCalls++;
            return { executionEnabled: true };
        }
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(missingCount.rawSubjectCount, 0);
    assert.equal(missingCount.countExact, false);
    assert.equal(missingCount.previewExact, false);
    assert.equal(previewCalls, 0);

    const towerPlan = Object.freeze({
        accepted: true,
        executionEnabled: true,
        reason: null,
        livingShareUnits: 1_000_000_000,
        lostShareUnits: 0,
        capacity: Object.freeze({
            currentTowerCount: 1,
            childCount: 3,
            requiredTowerCount: 4,
            productionTowerCapacity: 256
        })
    });
    const exact = new SentenceRuntimeEstimator({
        getRuntimeState: () => ({
            livingTowerCount: 1,
            liveHostileActorCount: 3,
            hostileSubjectCountExact: true,
            registryAvailable: 16,
            bodyAvailable: 16
        }),
        previewTowerCreation: ({ childCount }) => {
            previewCalls++;
            assert.equal(childCount, 3);
            return towerPlan;
        }
    }).estimate(compiledAbility, { cooldown: { remainingTicks: 0 } });
    assert.equal(previewCalls, 1);
    assert.equal(exact.formulaId, 'preview.actor-payload.tower.v1');
    assert.equal(exact.actorActionProfileId, ACTOR_ACTION_PROFILE_ID.SHOOT);
    assert.equal(exact.payloadCode, ACTOR_PAYLOAD_CODE.TOWER);
    assert.equal(exact.newEnemyCount, 0);
    assert.equal(exact.newTowerCount, 3);
    assert.equal(exact.currentTowerCount, 1);
    assert.equal(exact.resultingTowerCount, 4);
    assert.equal(exact.allegiance.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(exact.allegiance.policy,
        GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER);
    assert.strictEqual(exact.towerCreationPreview, towerPlan);
    assert.equal(exact.dangerous, true);
    assert.equal(exact.warningCode, 'TOWER_SHARE_DILUTION');
    assert.equal(exact.executionEnabled, true);
    assert.equal(exact.placementExact, false);
    assertDeepFrozen(exact);
});
