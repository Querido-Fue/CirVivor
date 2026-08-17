import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    ABILITY_CREATION_ORIGIN_CODE,
    createAbilityEntityMetadata,
    normalizeAbilityExecutionCommand
} = await loadGameModule('ingame/contract/ability_execution_contract.js');
const {
    GAMEPLAY_NOUN_MASK,
    SUBJECT_SELECTOR_CODE
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI,
    GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION
} = await loadGameModule(
    'ingame/physics/gpu/gpu_ability_subject_snapshot_abi.js'
);
const {
    GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_SUBJECT_CAPACITY,
    GPU_ABILITY_SUBJECT_SNAPSHOT_STORAGE_BINDING_COUNT,
    GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL
} = await loadGameModule(
    'ingame/physics/gpu/gpu_ability_subject_snapshot_runtime.js'
);
const {
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE,
    R3_TOWER_SHOOTS_ENEMY_SENTENCE
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const { SentenceCompiler } = await loadGameModule(
    'ingame/word/sentence_compiler.js'
);
const compiler = new SentenceCompiler();
const R3_COMPILED_TOWER_TO_ENEMY_ABILITY = compiler.compile(
    R3_TOWER_SHOOTS_ENEMY_SENTENCE
);
const R3_COMPILED_ENEMY_TO_ENEMY_ABILITY = compiler.compile(
    R3_ENEMIES_SHOOT_ENEMIES_SENTENCE
);

const BACKEND_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/enemy_simulation_backend.js',
    import.meta.url
), 'utf8');
const ENDPOINT_SOURCE = await readFile(new URL(
    '../script/module/ingame/object/enemy/gpu_enemy_simulation_endpoint.js',
    import.meta.url
), 'utf8');
const RUNTIME_SOURCE = await readFile(new URL(
    '../script/module/ingame/physics/gpu/gpu_ability_subject_snapshot_runtime.js',
    import.meta.url
), 'utf8');

function registryView(kindId, definitionId, metadata = null) {
    return {
        entityId: 7,
        incarnation: 3,
        kindId,
        definitionId,
        createdAtTick: 11,
        metadata
    };
}

test('Ability metadata/snapshot ABI는 Body ABI와 독립된 고정 plane이다', () => {
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI_VERSION, 1);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.ENTITY_METADATA.STRIDE, 48);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.COMMAND.STRIDE, 96);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE, 64);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.SNAPSHOT_RECORD.STRIDE, 112);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_DEFAULT_SUBJECT_CAPACITY, 1000);
    assert.match(ENDPOINT_SOURCE, /createAbilityEntityMetadata/);
    assert.doesNotMatch(ENDPOINT_SOURCE, /readbackBodies\(\)/);
});

test('Tower/Enemy selector는 Team+noun+alive를 읽고 physical layer를 의미로 쓰지 않는다', () => {
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /selector_code == TOWER_SELECTOR[\s\S]*noun_mask == TOWER_NOUN[\s\S]*team_id == PLAYER_TEAM/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /selector_code == ENEMY_SELECTOR[\s\S]*noun_mask == ENEMY_NOUN[\s\S]*team_id == HOSTILE_TEAM/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /\(flags & ALIVE_FLAG\) == 0u/);
    assert.doesNotMatch(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /physical_meta[\s\S]{0,120}(TOWER_NOUN|ENEMY_NOUN)/);
});

test('natural Tower/Enemy와 sentence-created Enemy metadata가 같은 noun plane에 놓인다', () => {
    const tower = createAbilityEntityMetadata(
        registryView('tower', 'tower.player.v1')
    );
    const naturalEnemy = createAbilityEntityMetadata(
        registryView('enemy', 'basic_circle_01')
    );
    const createdEnemy = createAbilityEntityMetadata(
        registryView('enemy', 'basic_circle_01', {
            abilityCreationOriginCode:
                ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
            sourceExecutionOrdinal: 41,
            visibleFromExecutionOrdinal: 42,
            abilityGeneration: 1
        })
    );
    assert.equal(tower.nounMask, GAMEPLAY_NOUN_MASK.TOWER);
    assert.equal(naturalEnemy.nounMask, GAMEPLAY_NOUN_MASK.ENEMY);
    assert.equal(createdEnemy.nounMask, GAMEPLAY_NOUN_MASK.ENEMY);
    assert.equal(createdEnemy.sourceExecutionOrdinal, 41);
    assert.equal(createdEnemy.visibleFromExecutionOrdinal, 42);
    assert.equal(createdEnemy.generation, 1);
});

test('typed execution command는 selector/limit/aim/fingerprint를 semantic 값으로 고정한다', () => {
    for (const [compiledAbility, expectedSelector] of [
        [R3_COMPILED_TOWER_TO_ENEMY_ABILITY, SUBJECT_SELECTOR_CODE.TOWER],
        [R3_COMPILED_ENEMY_TO_ENEMY_ABILITY, SUBJECT_SELECTOR_CODE.ENEMY]
    ]) {
        const command = normalizeAbilityExecutionCommand({
            compiledAbility,
            executionId: `execution-${expectedSelector}`,
            executionOrdinal: expectedSelector,
            targetFixedTick: 17,
            aimPoint: { x: 3.25, y: 9.5 }
        });
        assert.equal(command.selectorCode, expectedSelector);
        assert.equal(command.subjectLimit, 1000);
        assert.equal(command.generationLimit, 65535);
        assert.ok(command.fingerprint > 0);
        assert.deepEqual(command.aimPoint, { x: 3.25, y: 9.5 });
        assert.ok(Object.isFrozen(command));
    }
});

test('snapshot 순서는 private slot 오름차순이며 exact incarnation과 시작 transform을 기록한다', () => {
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /for \(var body_slot = 0u; body_slot < counts\.body_count; body_slot\+\+\)/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /body_slot,[\s\S]*simulation\.entity_id,[\s\S]*simulation\.incarnation/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /body_physics\.position\.x[\s\S]*body_physics\.velocity\.x/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /bitcast<u32>\(body_physics\.radius\)[\s\S]*route\.profile_code/);
    assert.match(BACKEND_SOURCE,
        /slotActive\?\.\[activeSlot\] === 1[\s\S]*slotHandles\?\.\[activeSlot\]\?\.incarnation[\s\S]*=== incarnation/);
    assert.match(BACKEND_SOURCE,
        /slotActive\?\.\[pendingSlot\] === 2[\s\S]*pendingSlotHandles\?\.\[pendingSlot\]\?\.incarnation[\s\S]*=== incarnation/);
});

test('execution ordinal barrier는 같은 execution의 생성 actor 재귀 참여를 막는다', () => {
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /metadata\.visible_from_execution_ordinal <= execution_ordinal/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /metadata\.generation < generation_limit/);
    assert.match(RUNTIME_SOURCE, /snapshotToken/);
    assert.match(RUNTIME_SOURCE, /retainedSnapshotTokens/);
});

test('zero/exact/-1/+1 subject demand는 aggregate status로만 CPU에 돌아온다', () => {
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /if \(demand == 0u\)[\s\S]*STATUS_ZERO_SUBJECT/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /demand > subject_limit \|\| demand > snapshot_capacity/);
    assert.match(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL,
        /STATUS_CAPACITY_REJECTED[\s\S]*ERROR_SUBJECT_CAPACITY/);
    assert.equal(GPU_ABILITY_SUBJECT_SNAPSHOT_ABI.AGGREGATE.STRIDE, 64);
    assert.match(RUNTIME_SOURCE, /aggregateReadbackByteSize/);
    assert.doesNotMatch(RUNTIME_SOURCE,
        /copyBufferToBuffer\([\s\S]{0,180}snapshotRegionByteSize/);
});

test('snapshot 이후 source death는 GPU record를 지우지 않고 token release까지 보존한다', () => {
    assert.match(RUNTIME_SOURCE, /getSnapshotGpuBinding\(token\)/);
    assert.match(RUNTIME_SOURCE, /releaseSnapshot\(token\)/);
    assert.doesNotMatch(RUNTIME_SOURCE,
        /releaseSnapshot\(token\)[\s\S]{0,300}(hasBody|ALIVE_FLAG)/);
});

test('readback ring 포화는 execution만 defer하고 recovery를 세우지 않는다', () => {
    assert.match(RUNTIME_SOURCE, /ringDeferredCount \+= eligibleRemaining/);
    assert.match(RUNTIME_SOURCE,
        /submittedCount: 0,[\s\S]{0,100}deferredCount: eligibleRemaining/);
    assert.doesNotMatch(RUNTIME_SOURCE,
        /ringDeferredCount[\s\S]{0,100}state = 'failed'/);
});

test('Ability subject compute는 storage binding 9개 이하를 유지한다', () => {
    const bindings = Array.from(GPU_ABILITY_SUBJECT_SNAPSHOT_WGSL.matchAll(
        /@group\(0\)\s+@binding\((\d+)\)\s+var<storage/g
    ), (match) => Number(match[1]));
    assert.deepEqual(bindings, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(
        GPU_ABILITY_SUBJECT_SNAPSHOT_STORAGE_BINDING_COUNT,
        bindings.length
    );
    assert.ok(bindings.length <= 9);
});
