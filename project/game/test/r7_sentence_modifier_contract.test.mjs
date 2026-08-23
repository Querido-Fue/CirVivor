import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_MODIFIER_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    WORD_DEFINITION_ID,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND,
    WORD_RUNTIME_SUPPORT,
    normalizeSentenceDefinition,
    normalizeWordDefinition
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    MODIFIER_APPLICATION_PHASE,
    MODIFIER_PROFILE_ABI_VERSION,
    MODIFIER_PROFILE_ID,
    MODIFIER_SCOPE,
    MODIFIER_STACKING_POLICY,
    modifierProfileFingerprint,
    normalizeModifierProfile
} = await loadGameModule('ingame/contract/sentence_modifier_contract.js');
const {
    R7_SENTENCE_MODIFIER_PROFILE_BY_CODE,
    R7_SENTENCE_MODIFIER_PROFILE_BY_ID,
    R7_SENTENCE_MODIFIER_PROFILES,
    R7_TWICE_MODIFIER_PROFILE
} = await loadGameModule('data/word/r7_sentence_modifier_profile_data.js');
const {
    R3_SENTENCE_DEFINITIONS,
    R5_SENTENCE_DEFINITIONS,
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R6_QA_SENTENCE_LOADOUT,
    R6_SENTENCE_DEFINITIONS,
    R6_TOWERS_MERGE_SENTENCE,
    R6_WORD_DEFINITIONS,
    R6_WORD_INSTANCES,
    R6_WORD_PROTOCOL_DATA,
    R7_ENEMIES_THROW_ENEMIES_TWICE_SENTENCE,
    R7_SENTENCE_DEFINITION_BY_ID,
    R7_SENTENCE_DEFINITIONS,
    R7_TOWERS_MERGE_TWICE_SENTENCE,
    R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE,
    R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE,
    R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE,
    R7_TOWER_SUMMONS_ENEMIES_TWICE_SENTENCE,
    R7_TWICE_WORD_INSTANCE_1,
    R7_TWICE_WORD_INSTANCE_2,
    R7_TWICE_WORD_INSTANCE_3,
    R7_WORD_DEFINITION_BY_ID,
    R7_WORD_DEFINITIONS,
    R7_WORD_INSTANCE_BY_ID,
    R7_WORD_INSTANCES,
    R7_WORD_PROTOCOL_DATA,
    TWICE_MODIFIER_WORD_DEFINITION
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    SentenceCompiler
} = await loadGameModule('ingame/word/sentence_compiler.js');
const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    createProductionGameStartOptions
} = await loadGameModule('scene/game/production_game_start_route.js');

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const GAME_DIRECTORY = dirname(TEST_DIRECTORY);

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function mutableModifierProfile(overrides = {}) {
    const {
        modifierProfileFingerprint: ignoredFingerprint,
        ...source
    } = R7_TWICE_MODIFIER_PROFILE;
    return {
        ...source,
        supportedActionCodes: [
            ...R7_TWICE_MODIFIER_PROFILE.supportedActionCodes
        ],
        supportedPayloadCodes: [
            ...R7_TWICE_MODIFIER_PROFILE.supportedPayloadCodes
        ],
        ...overrides
    };
}

function abilitySha256(ability) {
    return createHash('sha256').update(JSON.stringify(ability)).digest('hex');
}

function collectJavaScriptFiles(directory, result = []) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            collectJavaScriptFiles(path, result);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            result.push(path);
        }
    }
    return result;
}

function importSpecifiers(source) {
    const result = [];
    for (const pattern of [
        /\bfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]/g
    ]) {
        for (const match of source.matchAll(pattern)) result.push(match[1]);
    }
    return result;
}

test('R7 vocabulary와 Modifier Word는 기존 identity 뒤에 append-only로 추가된다', () => {
    assert.equal(WORD_DEFINITION_ID.TOWER, 'word.entity.tower');
    assert.equal(WORD_DEFINITION_ID.MERGE, 'verb.merge');
    assert.equal(WORD_DEFINITION_ID.TWICE, 'modifier.twice');
    assert.equal(WORD_KIND.MODIFIER, 'modifier');
    assert.equal(WORD_GRAMMATICAL_ROLE.MODIFIER, 'modifier');
    assert.equal(WORD_RUNTIME_SUPPORT.R7, 'r7');
    assert.equal(SENTENCE_MODIFIER_CODE.TWICE, 1);
    assert.strictEqual(R7_WORD_PROTOCOL_DATA, R6_WORD_PROTOCOL_DATA);

    assert.equal(R7_WORD_DEFINITIONS.length, R6_WORD_DEFINITIONS.length + 1);
    for (let index = 0; index < R6_WORD_DEFINITIONS.length; index++) {
        assert.strictEqual(R7_WORD_DEFINITIONS[index], R6_WORD_DEFINITIONS[index]);
    }
    assert.strictEqual(
        R7_WORD_DEFINITION_BY_ID[WORD_DEFINITION_ID.TWICE],
        TWICE_MODIFIER_WORD_DEFINITION
    );
    assert.deepEqual(Object.keys(TWICE_MODIFIER_WORD_DEFINITION), [
        'id',
        'kind',
        'roles',
        'display',
        'shopEligible',
        'modifier'
    ]);
    assert.deepEqual(Array.from(TWICE_MODIFIER_WORD_DEFINITION.roles), [
        WORD_GRAMMATICAL_ROLE.MODIFIER
    ]);
    assert.equal(TWICE_MODIFIER_WORD_DEFINITION.display.english.singular, 'twice');
    assert.equal(TWICE_MODIFIER_WORD_DEFINITION.display.korean.singular, '두 배로');
    assert.deepEqual(TWICE_MODIFIER_WORD_DEFINITION.modifier, {
        modifierCode: SENTENCE_MODIFIER_CODE.TWICE,
        profileId: MODIFIER_PROFILE_ID.TWICE,
        runtimeSupport: WORD_RUNTIME_SUPPORT.R7
    });
    for (const forbidden of [
        'subject',
        'payload',
        'actionCode',
        'payloadRequirement'
    ]) {
        assert.equal(Object.hasOwn(TWICE_MODIFIER_WORD_DEFINITION, forbidden), false);
    }

    assert.equal(R7_WORD_INSTANCES.length, R6_WORD_INSTANCES.length + 3);
    const instances = [
        R7_TWICE_WORD_INSTANCE_1,
        R7_TWICE_WORD_INSTANCE_2,
        R7_TWICE_WORD_INSTANCE_3
    ];
    assert.equal(new Set(instances.map(({ id }) => id)).size, 3);
    assert.deepEqual(instances.map(({ id }) => id), [
        'word-instance.r7.twice.1',
        'word-instance.r7.twice.2',
        'word-instance.r7.twice.3'
    ]);
    for (const instance of instances) {
        assert.equal(instance.definitionId, WORD_DEFINITION_ID.TWICE);
        assert.strictEqual(R7_WORD_INSTANCE_BY_ID[instance.id], instance);
    }
    assertDeepFrozen(R7_WORD_DEFINITIONS);
    assertDeepFrozen(R7_WORD_INSTANCES);
});

test('TWICE ModifierProfile은 integer rational과 canonical set fingerprint를 고정한다', () => {
    assert.equal(MODIFIER_PROFILE_ABI_VERSION, 1);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.id, MODIFIER_PROFILE_ID.TWICE);
    assert.equal(
        R7_TWICE_MODIFIER_PROFILE.applicationPhase,
        MODIFIER_APPLICATION_PHASE.EXECUTION_CARDINALITY
    );
    assert.equal(R7_TWICE_MODIFIER_PROFILE.scope, MODIFIER_SCOPE.ACTOR_ACTION);
    assert.equal(
        R7_TWICE_MODIFIER_PROFILE.stackingPolicy,
        MODIFIER_STACKING_POLICY.MULTIPLY
    );
    assert.equal(R7_TWICE_MODIFIER_PROFILE.factorNumerator, 2);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.factorDenominator, 1);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.maxStacks, 3);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.priority, 100);
    assert.deepEqual(Array.from(R7_TWICE_MODIFIER_PROFILE.supportedActionCodes), [
        SENTENCE_ACTION_CODE.SHOOT,
        SENTENCE_ACTION_CODE.THROW,
        SENTENCE_ACTION_CODE.EMIT,
        SENTENCE_ACTION_CODE.SUMMON
    ]);
    assert.deepEqual(Array.from(R7_TWICE_MODIFIER_PROFILE.supportedPayloadCodes), [
        ACTOR_PAYLOAD_CODE.ENEMY,
        ACTOR_PAYLOAD_CODE.TOWER
    ]);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.conflictGroup, null);
    assert.equal(R7_TWICE_MODIFIER_PROFILE.persistentOnSpawnedActor, false);
    assert.equal(
        R7_TWICE_MODIFIER_PROFILE.modifierProfileFingerprint,
        modifierProfileFingerprint(R7_TWICE_MODIFIER_PROFILE)
    );
    assert.strictEqual(
        R7_SENTENCE_MODIFIER_PROFILE_BY_ID[MODIFIER_PROFILE_ID.TWICE],
        R7_TWICE_MODIFIER_PROFILE
    );
    assert.strictEqual(
        R7_SENTENCE_MODIFIER_PROFILE_BY_CODE[SENTENCE_MODIFIER_CODE.TWICE],
        R7_TWICE_MODIFIER_PROFILE
    );

    const reordered = normalizeModifierProfile(mutableModifierProfile({
        supportedActionCodes: [
            SENTENCE_ACTION_CODE.SUMMON,
            SENTENCE_ACTION_CODE.EMIT,
            SENTENCE_ACTION_CODE.THROW,
            SENTENCE_ACTION_CODE.SHOOT
        ],
        supportedPayloadCodes: [
            ACTOR_PAYLOAD_CODE.TOWER,
            ACTOR_PAYLOAD_CODE.ENEMY
        ]
    }));
    assert.deepEqual(reordered, R7_TWICE_MODIFIER_PROFILE);
    assertDeepFrozen(R7_SENTENCE_MODIFIER_PROFILES);
});

test('ModifierProfile normalizer는 unknown/getter/symbol/Proxy drift와 잘못된 수치를 fail-fast한다', () => {
    assert.throws(() => normalizeModifierProfile(mutableModifierProfile({
        unknownField: 1
    })), /unknownField|지원하지 않는 필드/);

    let getterReads = 0;
    const getterSource = mutableModifierProfile();
    Object.defineProperty(getterSource, 'priority', {
        enumerable: true,
        get() {
            getterReads++;
            return 100;
        }
    });
    assert.throws(() => normalizeModifierProfile(getterSource), /data property/);
    assert.equal(getterReads, 0);

    const symbolSource = mutableModifierProfile();
    symbolSource[Symbol('modifier-profile-extra')] = 1;
    assert.throws(() => normalizeModifierProfile(symbolSource), /symbol key/);

    let proxyReads = 0;
    const proxied = new Proxy(mutableModifierProfile(), {
        get() {
            proxyReads++;
            throw new Error('normalizer must not invoke Proxy get');
        }
    });
    assert.deepEqual(normalizeModifierProfile(proxied), R7_TWICE_MODIFIER_PROFILE);
    assert.equal(proxyReads, 0);

    for (const [overrides, pattern] of [
        [{ factorNumerator: Number.POSITIVE_INFINITY }, /factorNumerator/],
        [{ factorNumerator: 0xffffffff, maxStacks: 2 }, /uint32를 초과/],
        [{ factorDenominator: 2 }, /factorDenominator/],
        [{ applicationPhase: 'RUNTIME_STATUS_EFFECT' }, /applicationPhase/],
        [{ supportedActionCodes: [SENTENCE_ACTION_CODE.MERGE] },
            /supportedActionCodes/],
        [{ supportedPayloadCodes: [ACTOR_PAYLOAD_CODE.ENEMY,
            ACTOR_PAYLOAD_CODE.ENEMY] }, /supportedPayloadCodes/]
    ]) {
        assert.throws(() => normalizeModifierProfile(
            mutableModifierProfile(overrides)
        ), pattern);
    }

    const actionGetter = [];
    actionGetter.length = 1;
    Object.defineProperty(actionGetter, '0', {
        enumerable: true,
        get() {
            throw new Error('nested array getter must not run');
        }
    });
    assert.throws(() => normalizeModifierProfile(mutableModifierProfile({
        supportedActionCodes: actionGetter
    })), /data property/);
});

test('Modifier Word shape는 실행 함수와 Entity/Verb field를 허용하지 않는다', () => {
    const validSource = {
        id: WORD_DEFINITION_ID.TWICE,
        kind: WORD_KIND.MODIFIER,
        roles: [WORD_GRAMMATICAL_ROLE.MODIFIER],
        display: {
            english: { singular: 'twice', plural: 'twice' },
            korean: { singular: '두 배로', plural: '두 배로' }
        },
        shopEligible: true,
        modifier: {
            modifierCode: SENTENCE_MODIFIER_CODE.TWICE,
            profileId: MODIFIER_PROFILE_ID.TWICE,
            runtimeSupport: WORD_RUNTIME_SUPPORT.R7
        }
    };
    assert.deepEqual(normalizeWordDefinition(validSource),
        TWICE_MODIFIER_WORD_DEFINITION);
    for (const forbidden of [
        { subject: null },
        { payload: null },
        { actionCode: SENTENCE_ACTION_CODE.SHOOT },
        { payloadRequirement: SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED },
        { execute: () => undefined }
    ]) {
        assert.throws(() => normalizeWordDefinition({
            ...validSource,
            ...forbidden
        }), /Modifier Word|지원하지 않는 필드/);
    }
    assert.throws(() => normalizeWordDefinition({
        ...validSource,
        modifier: {
            ...validSource.modifier,
            runtimeSupport: WORD_RUNTIME_SUPPORT.R6
        }
    }), /runtimeSupport/);
});

test('R7 modifier fixtures는 immutable schema이고 ActorAction compile 경계로 연결된다', () => {
    const actorFixtures = [
        R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE,
        R7_TOWER_SHOOTS_TOWERS_TWICE_SENTENCE,
        R7_ENEMIES_THROW_ENEMIES_TWICE_SENTENCE,
        R7_TOWER_SUMMONS_ENEMIES_TWICE_SENTENCE,
        R7_TOWER_SHOOTS_ENEMIES_TWICE_TWICE_SENTENCE
    ];
    const compiler = new SentenceCompiler({
        wordDefinitionsById: R7_WORD_DEFINITION_BY_ID,
        wordInstancesById: R7_WORD_INSTANCE_BY_ID,
        protocol: R7_WORD_PROTOCOL_DATA
    });
    for (const fixture of actorFixtures) {
        assert.strictEqual(R7_SENTENCE_DEFINITION_BY_ID[fixture.id], fixture);
        assert.equal(compiler.tryCompile(fixture).code, 'VALID');
        assertDeepFrozen(fixture);
    }
    assert.equal(
        compiler.tryCompile(R7_TOWERS_MERGE_TWICE_SENTENCE).code,
        SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER_FOR_OPERATION
    );
    assertDeepFrozen(R7_TOWERS_MERGE_TWICE_SENTENCE);
    assert.equal(
        R7_TOWERS_MERGE_TWICE_SENTENCE.payloadWordInstanceId,
        null
    );

    const sameInstanceDuplicate = normalizeSentenceDefinition({
        ...R7_TOWER_SHOOTS_ENEMIES_TWICE_SENTENCE,
        id: 'sentence.r7.same-instance-duplicate-schema',
        modifierWordInstanceIds: [
            R7_TWICE_WORD_INSTANCE_1.id,
            R7_TWICE_WORD_INSTANCE_1.id
        ]
    });
    assert.deepEqual(sameInstanceDuplicate.modifierWordInstanceIds, [
        R7_TWICE_WORD_INSTANCE_1.id,
        R7_TWICE_WORD_INSTANCE_1.id
    ]);
    assert.equal(
        compiler.tryCompile(sameInstanceDuplicate).code,
        SENTENCE_COMPILE_ERROR_CODE.DUPLICATE_MODIFIER_INSTANCE
    );
});

test('R3/R5/R6 empty-modifier compiled identity와 production loadout은 바뀌지 않는다', () => {
    const baselineHashes = new Map([
        ['sentence.r3.tower-shoots-enemy',
            '9f2a7fa8f3d729468aa4e9b63de6f09b6efc7d2d93d0b427cb2f927da898ddc0'],
        ['sentence.r3.enemies-shoot-enemies',
            'db8da920fe6f11645f05c31382a1e75bfd9251a7ec0bfb43f964455e5b2dd473'],
        ['sentence.r5.tower-shoots-tower',
            'f8ba80bb5f552bbf408576bf08021d9645fe12b5dd7a6d9ac3f9bd57ea2c07c0'],
        ['sentence.r5.enemies-shoot-tower',
            '27899a002ccfdd56ee161d9c28f86a5142ef12ef071bf450c506f725542ffabe']
    ]);
    const baselineCompiler = new SentenceCompiler();
    const r7Compiler = new SentenceCompiler({
        wordDefinitionsById: R7_WORD_DEFINITION_BY_ID,
        wordInstancesById: R7_WORD_INSTANCE_BY_ID,
        protocol: R7_WORD_PROTOCOL_DATA
    });
    for (const sentence of R6_SENTENCE_DEFINITIONS) {
        assert.equal(sentence.modifierWordInstanceIds.length, 0);
        const baseline = baselineCompiler.compile(sentence);
        const throughR7Catalog = r7Compiler.compile(sentence);
        assert.deepEqual(throughR7Catalog, baseline);
        const expectedHash = baselineHashes.get(sentence.id);
        if (expectedHash) assert.equal(abilitySha256(baseline), expectedHash);
    }
    assert.equal(R3_SENTENCE_DEFINITIONS.length, 2);
    assert.equal(R5_SENTENCE_DEFINITIONS.length, 4);
    assert.equal(
        baselineCompiler.compile(R6_TOWERS_MERGE_SENTENCE).compiledAbilityId,
        'compiled-ability.r6:word.entity.tower:verb.merge:'
            + 'tower-group-operation.merge.v1:abi1'
    );

    const startOptions = createProductionGameStartOptions(
        CORRIDOR_EIGHT_MAP_DATA.id
    );
    assert.strictEqual(
        startOptions.wordSystemOptions.loadout,
        R5_SHOWCASE_SENTENCE_LOADOUT
    );
    for (const loadout of [R5_SHOWCASE_SENTENCE_LOADOUT, R6_QA_SENTENCE_LOADOUT]) {
        for (const sentence of Object.values(loadout)) {
            assert.equal(sentence.modifierWordInstanceIds.length, 0);
        }
    }
});

test('word data는 runtime/DOM을 import하지 않고 production은 참고/guide/plan을 import하지 않는다', () => {
    const wordDataDirectory = join(GAME_DIRECTORY, 'script', 'data', 'word');
    for (const path of collectJavaScriptFiles(wordDataDirectory)) {
        const source = readFileSync(path, 'utf8');
        assert.doesNotMatch(source, /\b(?:window|document|HTMLElement)\b/);
        for (const specifier of importSpecifiers(source)) {
            assert.equal(
                specifier.startsWith('data/')
                    || specifier.startsWith('ingame/contract/'),
                true,
                `${path} runtime import: ${specifier}`
            );
        }
    }

    const forbiddenImports = [];
    const scriptDirectory = join(GAME_DIRECTORY, 'script');
    for (const path of collectJavaScriptFiles(scriptDirectory)) {
        const source = readFileSync(path, 'utf8');
        for (const specifier of importSpecifiers(source)) {
            if (/(?:^|[/\\])(?:참고|guide_old|guide|plan)(?:[/\\]|$)/.test(
                specifier
            )) {
                forbiddenImports.push(`${path}: ${specifier}`);
            }
        }
    }
    assert.deepEqual(forbiddenImports, []);
});
