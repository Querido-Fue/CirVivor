import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const sharedEnemyData = await loadGameModule(
    'data/object/enemy/main_gpu_enemy_definition_data.js'
);
const basicEnemyData = await loadGameModule(
    'data/object/enemy/basic_circle_enemy_data.js'
);
const {
    ARCHER_ATTACK_DEFINITION_ID,
    ARCHER_ENEMY_DATA,
    ARCHER_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/archer_enemy_data.js');
const {
    ARCHER_ATTACK_DATA,
    HOSTILE_ATTACK_DEFINITION_BY_ID
} = await loadGameModule('data/object/enemy/archer_attack_data.js');
const {
    HOSTILE_BASIC_BULLET_COLOR_RGBA,
    HOSTILE_BASIC_BULLET_DATA,
    HOSTILE_BASIC_BULLET_PRODUCER_ID
} = await loadGameModule(
    'data/object/projectile/hostile_basic_bullet_data.js'
);
const {
    BASIC_BULLET_PROJECTILE_DATA
} = await loadGameModule('data/object/projectile/basic_bullet_data.js');
const {
    CORRIDOR_EIGHT_WAVE_01_DATA
} = await loadGameModule('data/scene/game/corridor_eight_wave_01_data.js');
const {
    CORRIDOR_EIGHT_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');
const { createTileMap } = await loadGameModule('ingame/map/tile_map.js');

const NORMAL_WAVE_DEFINITION_IDS = Object.freeze([
    basicEnemyData.BASIC_SQUARE_ENEMY_DATA.id,
    basicEnemyData.BASIC_TRIANGLE_ENEMY_DATA.id,
    basicEnemyData.BASIC_ARROW_ENEMY_DATA.id,
    basicEnemyData.BASIC_PENTA_ENEMY_DATA.id,
    basicEnemyData.BASIC_HEXA_ENEMY_DATA.id,
    basicEnemyData.BASIC_GEN_ENEMY_DATA.id
]);
const PRODUCTION_WAVE_DEFINITION_IDS = Object.freeze([
    ...NORMAL_WAVE_DEFINITION_IDS,
    ARCHER_ENEMY_DATA.id
]);
const PRODUCTION_ARCHER_SPAWN_INDEXES = Object.freeze([6, 13, 20, 27]);
const PRODUCTION_ARCHER_LOCAL_FIXED_TICKS = Object.freeze([31, 66, 101, 136]);

test('Archer는 shared main enemy 수치를 쓰는 별도 frozen definition으로 catalog에만 등록된다', () => {
    assert.strictEqual(
        basicEnemyData.MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES,
        sharedEnemyData.MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
    );
    assert.strictEqual(
        basicEnemyData.MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
        sharedEnemyData.MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
    );
    assert.strictEqual(
        basicEnemyData.MAIN_GPU_ENEMY_COLOR_RGBA,
        sharedEnemyData.MAIN_GPU_ENEMY_COLOR_RGBA
    );

    assert.equal(ARCHER_ENEMY_DEFINITION_ID, 'archer_01');
    assert.equal(ARCHER_ATTACK_DEFINITION_ID, 'archer_basic_shot_01');
    assert.equal(ARCHER_ENEMY_DATA.id, ARCHER_ENEMY_DEFINITION_ID);
    assert.equal(ARCHER_ENEMY_DATA.shapeType, 'arrow');
    assert.equal(ARCHER_ENEMY_DATA.moveSpeedTilesPerSecond, 2.5);
    assert.equal(
        ARCHER_ENEMY_DATA.collisionRadiusTiles,
        sharedEnemyData.MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
    );
    assert.equal(ARCHER_ENEMY_DATA.collisionWeight, 1);
    assert.equal(ARCHER_ENEMY_DATA.maxHealth, 1);
    assert.equal(ARCHER_ENEMY_DATA.radiusScale, 1);
    assert.equal(
        ARCHER_ENEMY_DATA.attackDefinitionId,
        ARCHER_ATTACK_DEFINITION_ID
    );
    assert.strictEqual(
        ARCHER_ENEMY_DATA.colorRgba,
        sharedEnemyData.MAIN_GPU_ENEMY_COLOR_RGBA
    );
    assert.equal(Object.isFrozen(ARCHER_ENEMY_DATA), true);
    assert.equal(Object.isFrozen(ARCHER_ENEMY_DATA.colorRgba), true);

    assert.equal(basicEnemyData.INGAME_ENEMY_DEFINITIONS.length, 6);
    assert.deepEqual(
        Array.from(
            basicEnemyData.INGAME_ENEMY_DEFINITIONS,
            ({ id }) => id
        ),
        Array.from(NORMAL_WAVE_DEFINITION_IDS)
    );
    assert.strictEqual(
        basicEnemyData.INGAME_ENEMY_DEFINITION_BY_ID[ARCHER_ENEMY_DATA.id],
        ARCHER_ENEMY_DATA
    );
    const catalogIds = Object.keys(
        basicEnemyData.INGAME_ENEMY_DEFINITION_BY_ID
    );
    assert.equal(catalogIds.length, 8);
    assert.equal(new Set(catalogIds).size, catalogIds.length);
    assert.equal(
        Object.isFrozen(basicEnemyData.INGAME_ENEMY_DEFINITION_BY_ID),
        true
    );

    assert.notStrictEqual(ARCHER_ENEMY_DATA, basicEnemyData.BASIC_ARROW_ENEMY_DATA);
    assert.equal(
        'attackDefinitionId' in basicEnemyData.BASIC_ARROW_ENEMY_DATA,
        false
    );
    assert.equal(basicEnemyData.BASIC_ARROW_ENEMY_DATA.id, 'basic_arrow_01');
});

test('production corridor wave는 기존 32/5 계약에 Archer를 7번째로 추가한다', () => {
    const phase = CORRIDOR_EIGHT_WAVE_01_DATA.phases[0];
    const group = phase.spawnGroups[0];
    assert.equal(phase.startTick, 1);
    assert.equal(phase.durationTicks, 156);
    assert.equal(group.count, 32);
    assert.equal(group.intervalTicks, 5);
    assert.deepEqual(
        Array.from(group.enemyDefinitionIds),
        Array.from(PRODUCTION_WAVE_DEFINITION_IDS)
    );
    assert.deepEqual(
        Array.from(group.enemyDefinitionIds).slice(0, 6),
        Array.from(NORMAL_WAVE_DEFINITION_IDS)
    );
    assert.equal(group.enemyDefinitionId, basicEnemyData.BASIC_SQUARE_ENEMY_DATA.id);
    assert.equal(group.policyId, 'corebound');
    assert.deepEqual(Array.from(group.laneOffsetsTiles), [-1.8, -0.6, 0.6, 1.8]);

    const director = new WaveDirector();
    assert.equal(director.init(createTileMap(CORRIDOR_EIGHT_MAP_DATA.id)), true);
    assert.equal(director.schedule.length, 32);
    assert.equal(Object.isFrozen(director.schedule), true);
    for (let index = 0; index < director.schedule.length; index++) {
        const entry = director.schedule[index];
        assert.equal(entry.targetFixedTick, 1 + (index * 5));
        assert.equal(entry.intent.spawnSequence, index);
        assert.equal(
            entry.intent.definitionId,
            PRODUCTION_WAVE_DEFINITION_IDS[
                index % PRODUCTION_WAVE_DEFINITION_IDS.length
            ]
        );
        assert.equal(
            entry.commandId,
            `corridor_eight_wave_01:0:0:${index}`
        );
    }
    const archerEntries = director.schedule
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.intent.definitionId === ARCHER_ENEMY_DATA.id);
    assert.deepEqual(
        Array.from(archerEntries, ({ index }) => index),
        Array.from(PRODUCTION_ARCHER_SPAWN_INDEXES)
    );
    assert.deepEqual(
        Array.from(archerEntries, ({ entry }) => entry.targetFixedTick),
        Array.from(PRODUCTION_ARCHER_LOCAL_FIXED_TICKS)
    );
    assert.equal(archerEntries.length, 4);
    assert.equal(
        director.schedule.filter(({ intent }) => (
            intent.definitionId === basicEnemyData.BASIC_ARROW_ENEMY_DATA.id
        )).length,
        5,
        'basic_arrow_01과 Archer는 별도 cycle identity여야 합니다.'
    );
    assert.strictEqual(
        basicEnemyData.INGAME_ENEMY_DEFINITION_BY_ID[
            archerEntries[0].entry.intent.definitionId
        ],
        ARCHER_ENEMY_DATA
    );
    director.destroy();

    const fixedTickOffset = 500;
    const replacementDirector = new WaveDirector({ fixedTickOffset });
    assert.equal(
        replacementDirector.init(createTileMap(CORRIDOR_EIGHT_MAP_DATA.id)),
        true
    );
    const replacementArcherEntries = replacementDirector.schedule
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.intent.definitionId === ARCHER_ENEMY_DATA.id);
    assert.deepEqual(
        Array.from(replacementArcherEntries, ({ index }) => index),
        Array.from(PRODUCTION_ARCHER_SPAWN_INDEXES)
    );
    assert.deepEqual(
        Array.from(
            replacementArcherEntries,
            ({ entry }) => entry.targetFixedTick
        ),
        PRODUCTION_ARCHER_LOCAL_FIXED_TICKS.map((tick) => tick + fixedTickOffset)
    );
    assert.deepEqual(
        Array.from(replacementArcherEntries, ({ entry }) => entry.commandId),
        PRODUCTION_ARCHER_SPAWN_INDEXES.map(
            (index) => `corridor_eight_wave_01:0:0:${index}`
        )
    );
    replacementDirector.destroy();
});

test('Archer attack baseline과 exact-ID catalog는 deep immutable data contract를 유지한다', () => {
    assert.equal(ARCHER_ATTACK_DATA.id, 'archer_basic_shot_01');
    assert.equal(ARCHER_ATTACK_DATA.sourceEnemyDefinitionId, 'archer_01');
    assert.equal(
        ARCHER_ATTACK_DATA.projectileDefinitionId,
        'hostile_basic_bullet_01'
    );
    assert.equal(ARCHER_ATTACK_DATA.launchSpeed, 12);
    assert.deepEqual({ ...ARCHER_ATTACK_DATA.positionOffset }, { x: 0, y: 0 });
    assert.deepEqual({ ...ARCHER_ATTACK_DATA.targetOffset }, { x: 0, y: 0 });
    assert.equal(ARCHER_ATTACK_DATA.initialDelayTicks, 30);
    assert.equal(ARCHER_ATTACK_DATA.intervalTicks, 90);
    assert.equal(ARCHER_ATTACK_DATA.phaseSpreadTicks, 30);
    assert.equal(ARCHER_ATTACK_DATA.maximumStartsPerFixedTick, 4);
    assert.equal(
        ARCHER_ATTACK_DATA.targetPolicy,
        'current-single-living-tower'
    );
    assert.equal(
        ARCHER_ATTACK_DATA.targetSnapshotPolicy,
        'cast-start-exact-handle'
    );
    assert.equal(ARCHER_ATTACK_DATA.allegiancePolicy, 'inherit-subject');
    assert.equal(
        ARCHER_ATTACK_DATA.targetPolicyId,
        'player-damageable-and-terrain'
    );
    assert.equal(
        ARCHER_ATTACK_DATA.producerId,
        HOSTILE_BASIC_BULLET_PRODUCER_ID
    );
    assert.equal(
        ARCHER_ATTACK_DATA.sourceAbilityId,
        'enemy.archer.shoot.basic-bullet'
    );
    assert.equal(Object.isFrozen(ARCHER_ATTACK_DATA), true);
    assert.equal(Object.isFrozen(ARCHER_ATTACK_DATA.positionOffset), true);
    assert.equal(Object.isFrozen(ARCHER_ATTACK_DATA.targetOffset), true);
    assert.equal(Object.isFrozen(HOSTILE_ATTACK_DEFINITION_BY_ID), true);
    assert.strictEqual(
        HOSTILE_ATTACK_DEFINITION_BY_ID[ARCHER_ATTACK_DATA.id],
        ARCHER_ATTACK_DATA
    );
    assert.deepEqual(Object.keys(HOSTILE_ATTACK_DEFINITION_BY_ID), [
        ARCHER_ATTACK_DATA.id
    ]);

    for (const value of [
        ARCHER_ATTACK_DATA.launchSpeed,
        ARCHER_ATTACK_DATA.positionOffset.x,
        ARCHER_ATTACK_DATA.positionOffset.y,
        ARCHER_ATTACK_DATA.targetOffset.x,
        ARCHER_ATTACK_DATA.targetOffset.y
    ]) {
        assert.equal(Number.isFinite(value), true);
        assert.equal(Number.isFinite(Math.fround(value)), true);
    }
    for (const value of [
        ARCHER_ATTACK_DATA.initialDelayTicks,
        ARCHER_ATTACK_DATA.intervalTicks,
        ARCHER_ATTACK_DATA.phaseSpreadTicks,
        ARCHER_ATTACK_DATA.maximumStartsPerFixedTick
    ]) {
        assert.equal(Number.isSafeInteger(value), true);
        assert.ok(value > 0);
    }
});

test('Hostile Basic Bullet은 Player Basic Bullet과 분리된 frozen hostile projectile data다', () => {
    assert.equal(HOSTILE_BASIC_BULLET_DATA.id, 'hostile_basic_bullet_01');
    assert.equal(HOSTILE_BASIC_BULLET_DATA.collisionRadius, 0.18);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.inverseMass, 1);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.penetration, 1);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.damage, 5);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.damageSelf, 1);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.lifetimeSeconds, 3);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.killOnTerrain, true);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.closestOnly, true);
    assert.equal(
        HOSTILE_BASIC_BULLET_DATA.targetPolicyId,
        'player-damageable-and-terrain'
    );
    assert.equal(
        HOSTILE_BASIC_BULLET_DATA.producerId,
        'enemy-archer-basic-shot'
    );
    assert.strictEqual(
        HOSTILE_BASIC_BULLET_DATA.colorRgba,
        HOSTILE_BASIC_BULLET_COLOR_RGBA
    );
    assert.strictEqual(
        HOSTILE_BASIC_BULLET_COLOR_RGBA,
        sharedEnemyData.MAIN_GPU_ENEMY_COLOR_RGBA
    );
    assert.equal(HOSTILE_BASIC_BULLET_DATA.radiusScale, 1);
    assert.equal(HOSTILE_BASIC_BULLET_DATA.visible, true);
    assert.equal('teamId' in HOSTILE_BASIC_BULLET_DATA, false);
    assert.equal(Object.isFrozen(HOSTILE_BASIC_BULLET_DATA), true);
    assert.equal(Object.isFrozen(HOSTILE_BASIC_BULLET_DATA.colorRgba), true);

    assert.notStrictEqual(
        HOSTILE_BASIC_BULLET_DATA,
        BASIC_BULLET_PROJECTILE_DATA
    );
    assert.equal(BASIC_BULLET_PROJECTILE_DATA.id, 'basic_bullet_01');
    assert.equal(BASIC_BULLET_PROJECTILE_DATA.damage, 10);
    assert.equal(BASIC_BULLET_PROJECTILE_DATA.lifetimeSeconds, 2);
    assert.equal(Object.isFrozen(BASIC_BULLET_PROJECTILE_DATA), true);
});
