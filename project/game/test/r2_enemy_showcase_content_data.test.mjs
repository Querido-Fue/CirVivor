import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_CORK_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DATA,
    BASIC_JORANG_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_PENTA_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_RING_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} = await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const {
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID
} = await loadGameModule('data/object/enemy/basic_hexa_enemy_data.js');
const {
    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE,
    BASIC_OCTA_ORBIT_CAPACITY_POLICY
} = await loadGameModule('data/object/enemy/basic_octa_enemy_data.js');
const {
    CORRIDOR_EIGHT_MAP_DATA,
    INGAME_MAP_DATA
} = await loadGameModule('data/scene/game/corridor_eight_map_data.js');
const {
    R2_ENEMY_SHOWCASE_MAP_DATA,
    R2_ENEMY_SHOWCASE_MAP_ID,
    R2_ENEMY_SHOWCASE_ORBIT_CLEARANCE_MACRO_CELLS,
    R2_ENEMY_SHOWCASE_ROUTE_SET_ID,
    R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL
} = await loadGameModule('data/scene/game/r2_enemy_showcase_map_data.js');
const {
    PERFORMANCE_SERPENTINE_MAP_DATA
} = await loadGameModule(
    'data/scene/game/performance_serpentine_map_data.js'
);
const {
    R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT,
    R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O,
    R2_ENEMY_SHOWCASE_STAGE_ONE_ENEMY_DEFINITION_IDS,
    R2_ENEMY_SHOWCASE_STAGE_ONE_PERFORMANCE_SESSION,
    R2_ENEMY_SHOWCASE_STAGE_ONE_SPAWN_INTERVAL_TICKS,
    R2_ENEMY_SHOWCASE_STAGE_ONE_TOTAL_SPAWN_COUNT,
    R2_ENEMY_SHOWCASE_STAGE_MANIFEST,
    R2_ENEMY_SHOWCASE_WAVE_TWO_AUTHORED_SIMULTANEOUS_O,
    R2_ENEMY_SHOWCASE_WAVE_01_DATA,
    R2_ENEMY_SHOWCASE_WAVE_02_DATA,
    R2_ENEMY_SHOWCASE_WAVE_03_DATA,
    R2_ENEMY_SHOWCASE_WAVES
} = await loadGameModule('data/scene/game/r2_enemy_showcase_wave_data.js');
const {
    createGpuSignedDistanceFieldSnapshot,
    sampleGpuWorldSignedDistance
} = await loadGameModule('ingame/physics/gpu/gpu_signed_distance_field.js');
const { TileMap } = await loadGameModule('ingame/map/tile_map.js');
const { WaveDirector } = await loadGameModule('ingame/flow/wave_director.js');

test('showcase map은 two-route Cork graph와 radius-6 O 8-slot clear floor를 함께 제공한다', () => {
    assert.equal(R2_ENEMY_SHOWCASE_MAP_ID, 'r2_enemy_showcase_01');
    assert.equal(R2_ENEMY_SHOWCASE_MAP_DATA.id, R2_ENEMY_SHOWCASE_MAP_ID);
    assert.equal(R2_ENEMY_SHOWCASE_MAP_DATA.pathWidthTiles, 6);
    assert.deepEqual(R2_ENEMY_SHOWCASE_MAP_DATA.towerSpawnMacroCell,
        R2_ENEMY_SHOWCASE_TOWER_MACRO_CELL);
    assert.equal(R2_ENEMY_SHOWCASE_MAP_DATA.enemySpawnRoutes.length, 2);
    assert.equal(R2_ENEMY_SHOWCASE_MAP_DATA.routeGraph.routeSets[0].id,
        R2_ENEMY_SHOWCASE_ROUTE_SET_ID);
    assert.equal(R2_ENEMY_SHOWCASE_MAP_DATA.routeGraph.closures.length, 2);

    const routeCellKeys = new Set(
        R2_ENEMY_SHOWCASE_MAP_DATA.enemySpawnRoutes.flatMap(({ macroCells }) => (
            macroCells.map(([row, column]) => `${row}:${column}`)
        ))
    );
    assert.equal(R2_ENEMY_SHOWCASE_ORBIT_CLEARANCE_MACRO_CELLS.length, 9);
    assert.equal(new Set(R2_ENEMY_SHOWCASE_ORBIT_CLEARANCE_MACRO_CELLS.map(
        ([row, column]) => `${row}:${column}`
    )).size, 9);
    for (const [row, column] of R2_ENEMY_SHOWCASE_ORBIT_CLEARANCE_MACRO_CELLS) {
        assert.equal(routeCellKeys.has(`${row}:${column}`), true);
    }

    const tileMap = new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA);
    const tower = tileMap.getTowerSpawnPosition();
    const sdf = createGpuSignedDistanceFieldSnapshot(tileMap.getNavigationGrid());
    const radius = BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit.orbitRadiusTiles;
    for (let slot = 0; slot < 8; slot++) {
        const angle = Math.PI + (slot * Math.PI / 4);
        const position = {
            x: tower.x + (Math.cos(angle) * radius),
            y: tower.y + (Math.sin(angle) * radius)
        };
        const tile = tileMap.worldToTile(position.x, position.y, {});
        assert.equal(tile.inside, true);
        assert.equal(tileMap.isWalkableTile(tile.row, tile.column), true);
        assert.ok(sampleGpuWorldSignedDistance(
            sdf,
            tileMap.getWorldBounds(),
            position.x,
            position.y
        ) > 0.5);
    }
});

test('첫 showcase wave는 R2 10종 10,000개를 five-tick sequential performance stream으로 선언한다', () => {
    assert.equal(R2_ENEMY_SHOWCASE_WAVES.length, 3);
    assert.deepEqual(Array.from(
        R2_ENEMY_SHOWCASE_WAVES,
        ({ waveId }) => waveId
    ), [
        'r2_enemy_showcase_wave_01',
        'r2_enemy_showcase_wave_02',
        'r2_enemy_showcase_wave_03'
    ]);
    assert.ok(R2_ENEMY_SHOWCASE_WAVES.every(({ mapId }) => (
        mapId === R2_ENEMY_SHOWCASE_MAP_ID
    )));
    assert.equal(R2_ENEMY_SHOWCASE_STAGE_MANIFEST.length, 3);
    assert.deepEqual(Array.from(
        R2_ENEMY_SHOWCASE_STAGE_MANIFEST,
        ({ waveId }) => waveId
    ), Array.from(R2_ENEMY_SHOWCASE_WAVES, ({ waveId }) => waveId));

    assert.equal(R2_ENEMY_SHOWCASE_STAGE_ONE_TOTAL_SPAWN_COUNT, 10_000);
    assert.equal(R2_ENEMY_SHOWCASE_STAGE_ONE_SPAWN_INTERVAL_TICKS, 5);
    assert.deepEqual(Array.from(
        R2_ENEMY_SHOWCASE_STAGE_ONE_ENEMY_DEFINITION_IDS
    ), [
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id,
        BASIC_ARROW_ENEMY_DATA.id,
        BASIC_RHOM_ENEMY_DATA.id,
        BASIC_PENTA_ENEMY_DATA.id,
        BASIC_HEXA_ENEMY_DATA.id,
        BASIC_OCTA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id
    ]);
    assert.equal(Object.isFrozen(
        R2_ENEMY_SHOWCASE_STAGE_ONE_ENEMY_DEFINITION_IDS
    ), true);
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_01_DATA.timeline.length, 2);
    assert.ok(R2_ENEMY_SHOWCASE_WAVE_01_DATA.timeline.every(
        ({ type }) => type === 'SPAWN_FOR_DURATION'
    ));
    const performanceGroups = R2_ENEMY_SHOWCASE_WAVE_01_DATA.timeline.flatMap(
        ({ spawnGroups }) => spawnGroups
    );
    assert.equal(performanceGroups.reduce(
        (total, { count }) => total + count,
        0
    ), R2_ENEMY_SHOWCASE_STAGE_ONE_TOTAL_SPAWN_COUNT);
    assert.ok(performanceGroups.every(({ intervalTicks }) => (
        intervalTicks === R2_ENEMY_SHOWCASE_STAGE_ONE_SPAWN_INTERVAL_TICKS
    )));
    assert.deepEqual({ ...R2_ENEMY_SHOWCASE_STAGE_ONE_PERFORMANCE_SESSION }, {
        towerMaxHp: 20_000_000,
        coreMaxIntegrity: 20_000_000
    });
    assert.ok(R2_ENEMY_SHOWCASE_WAVE_02_DATA.timeline.some(
        ({ type }) => type === 'WAIT'
    ));
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_03_DATA.timeline[0]
        .spawnGroup.enemyDefinitionId, BASIC_CORK_ENEMY_DATA.id);
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_03_DATA.timeline[1].durationSeconds, 15);
});

test('showcase placement는 stage-one 전 종류와 후속 capability wave를 전수 증명한다', () => {
    const collectAuthoredDefinitionIds = (wave) => new Set(
        wave.timeline.flatMap((entry) => {
            if (entry.spawnGroups) {
                return entry.spawnGroups.flatMap((group) => (
                    group.enemyDefinitionIds ?? [group.enemyDefinitionId]
                ));
            }
            if (entry.spawnGroup) {
                return entry.spawnGroup.enemyDefinitionIds
                    ?? [entry.spawnGroup.enemyDefinitionId];
            }
            return entry.formation
                ? Object.values(entry.formation.symbolMap)
                : [];
        })
    );
    const waveDefinitionIds = R2_ENEMY_SHOWCASE_WAVES.map(
        collectAuthoredDefinitionIds
    );
    assert.deepEqual([...waveDefinitionIds[0]].sort(), [
        BASIC_ARROW_ENEMY_DATA.id,
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id,
        BASIC_HEXA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_OCTA_ENEMY_DATA.id,
        BASIC_PENTA_ENEMY_DATA.id,
        BASIC_RHOM_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id
    ].sort());
    assert.deepEqual([...waveDefinitionIds[1]].sort(), [
        BASIC_HEXA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_OCTA_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id
    ].sort());
    assert.deepEqual([...waveDefinitionIds[2]].sort(), [
        BASIC_CIRCLE_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id,
        BASIC_TRIANGLE_ENEMY_DATA.id
    ].sort());

    const mechanicsByWave = Array.from(R2_ENEMY_SHOWCASE_STAGE_MANIFEST,
        ({ mechanics }) => Array.from(mechanics)
    );
    assert.deepEqual(mechanicsByWave, [
        [
            'sequential-ten-thousand-all-r2-enemies',
            'arrow-ease-out-expo-charge-recoil',
            'rhom-core-priority-fire',
            'penta-boost',
            'hexa-group-merge-to-hx',
            'octagon-orbit-directional-defense',
            'jorang-split-regrowth',
            'ring-projectile-capture',
            'cork-route-closure'
        ],
        [
            'hexa-group-merge-to-hx',
            'octagon-orbit-directional-defense',
            'jorang-split-regrowth',
            'ring-projectile-capture'
        ],
        [
            'cork-route-closure',
            'route-availability-formation-reroute'
        ]
    ]);
    assert.equal(BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID, 'basic_hexa_hive_01');
    assert.equal(
        R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.showcase.enemyDefinitionIds
            .includes(BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID),
        false,
        'HX는 자연 spawn content가 아니라 H의 terminal transform result여야 합니다.'
    );
});

test('showcase O는 Stage 1 tail 1, Wave 2 동시 4이며 capacity 8 overflow는 whole-batch normal rejection이다', () => {
    const authoredOEntries = R2_ENEMY_SHOWCASE_WAVES.flatMap(({ timeline }) => (
        timeline.filter(({ spawnGroup }) => (
            spawnGroup?.enemyDefinitionId === BASIC_OCTA_ENEMY_DATA.id
        ))
    ));
    assert.equal(authoredOEntries.length, 1);
    assert.equal(authoredOEntries[0].spawnGroup.count,
        R2_ENEMY_SHOWCASE_WAVE_TWO_AUTHORED_SIMULTANEOUS_O);
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_TWO_AUTHORED_SIMULTANEOUS_O, 4);
    assert.equal(R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O, 8);
    assert.ok(R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O
        <= BASIC_OCTA_ORBIT_CAPACITY_POLICY.maximumSimultaneousActors);
    assert.deepEqual({
        maximum: BASIC_OCTA_ORBIT_CAPACITY_POLICY.maximumSimultaneousActors,
        zeroMutation: BASIC_OCTA_ORBIT_CAPACITY_POLICY.wholeBatchZeroMutation,
        recoveryRequired: BASIC_OCTA_ORBIT_CAPACITY_POLICY.recoveryRequired
    }, {
        maximum: 8,
        zeroMutation: true,
        recoveryRequired: false
    });
});

test('showcase waves는 실제 TileMap/WaveDirector compiler에서 bounded schedule을 만든다', () => {
    for (const waveDefinition of R2_ENEMY_SHOWCASE_WAVES) {
        const director = new WaveDirector({ waveDefinition });
        assert.equal(director.init(new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA)), true);
        assert.ok(director.schedule.length > 0);
        assert.ok(director.schedule.every((entry) => (
            entry.routeSetId === R2_ENEMY_SHOWCASE_ROUTE_SET_ID
        )));
        assert.ok(director.schedule.every((entry) => (
            entry.targetFixedTick > 0
        )));
        director.destroy();
    }

    const performanceDirector = new WaveDirector({
        waveDefinition: R2_ENEMY_SHOWCASE_WAVE_01_DATA
    });
    assert.equal(performanceDirector.init(
        new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA)
    ), true);
    const performanceSchedule = performanceDirector.schedule;
    assert.equal(
        performanceSchedule.length,
        R2_ENEMY_SHOWCASE_STAGE_ONE_TOTAL_SPAWN_COUNT
    );
    assert.equal(performanceSchedule[0].targetFixedTick, 1);
    assert.equal(performanceSchedule.at(-1).targetFixedTick, 49_996);
    for (let index = 0; index < performanceSchedule.length; index++) {
        const entry = performanceSchedule[index];
        assert.equal(entry.spawnSequence, index);
        if (index > 0) {
            assert.equal(
                entry.targetFixedTick
                    - performanceSchedule[index - 1].targetFixedTick,
                R2_ENEMY_SHOWCASE_STAGE_ONE_SPAWN_INTERVAL_TICKS
            );
        }
    }
    assert.deepEqual(
        performanceSchedule.slice(0, 12).map(({ definition }) => definition.id),
        [
            BASIC_CIRCLE_ENEMY_DATA.id,
            BASIC_TRIANGLE_ENEMY_DATA.id,
            BASIC_ARROW_ENEMY_DATA.id,
            BASIC_RHOM_ENEMY_DATA.id,
            BASIC_PENTA_ENEMY_DATA.id,
            BASIC_HEXA_ENEMY_DATA.id,
            BASIC_OCTA_ENEMY_DATA.id,
            BASIC_JORANG_ENEMY_DATA.id,
            BASIC_RING_ENEMY_DATA.id,
            BASIC_CORK_ENEMY_DATA.id,
            BASIC_CIRCLE_ENEMY_DATA.id,
            BASIC_TRIANGLE_ENEMY_DATA.id
        ]
    );
    assert.deepEqual(
        performanceSchedule.slice(0, 10).map(({ definition }) => definition.id),
        Array.from(R2_ENEMY_SHOWCASE_STAGE_ONE_ENEMY_DEFINITION_IDS)
    );
    const definitionCounts = performanceSchedule.reduce((counts, entry) => {
        const id = entry.definition.id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
        return counts;
    }, new Map());
    assert.deepEqual(Object.fromEntries(definitionCounts), {
        [BASIC_CIRCLE_ENEMY_DATA.id]: 1_429,
        [BASIC_TRIANGLE_ENEMY_DATA.id]: 1_428,
        [BASIC_ARROW_ENEMY_DATA.id]: 1_428,
        [BASIC_RHOM_ENEMY_DATA.id]: 1_428,
        [BASIC_PENTA_ENEMY_DATA.id]: 1_428,
        [BASIC_HEXA_ENEMY_DATA.id]: 1_428,
        [BASIC_JORANG_ENEMY_DATA.id]: 1_428,
        [BASIC_OCTA_ENEMY_DATA.id]: 1,
        [BASIC_RING_ENEMY_DATA.id]: 1,
        [BASIC_CORK_ENEMY_DATA.id]: 1
    });
    performanceDirector.destroy();

    const hexaEntries = (() => {
        const director = new WaveDirector({
            waveDefinition: R2_ENEMY_SHOWCASE_WAVE_02_DATA
        });
        director.init(new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA));
        const entries = director.schedule.filter(
            ({ definition }) => definition.id === BASIC_HEXA_ENEMY_DATA.id
        );
        director.destroy();
        return entries;
    })();
    assert.equal(hexaEntries.length, 6);
    assert.deepEqual(
        [...new Set(hexaEntries.map(({ targetFixedTick }) => targetFixedTick))],
        [1, 9, 17]
    );
    assert.ok(hexaEntries.every(({ formationProvenance }) => (
        formationProvenance?.formationAuthoredMemberCount === 6
    )));
});

test('첫 production 카드가 showcase Wave 1을 열고 corridor 데이터 자체는 불변이다', async () => {
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.defaultProduction.mapId,
        CORRIDOR_EIGHT_MAP_DATA.id);
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.showcase.mapId,
        R2_ENEMY_SHOWCASE_MAP_ID);
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.showcase.accessPolicyId,
        'production-stage-one-and-manual-injection');
    assert.deepEqual({
        ...R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.productionStageOne
    }, {
        selectionMapId: CORRIDOR_EIGHT_MAP_DATA.id,
        runtimeMapId: R2_ENEMY_SHOWCASE_MAP_ID,
        waveId: R2_ENEMY_SHOWCASE_WAVE_01_DATA.waveId
    });
    assert.equal(INGAME_MAP_DATA.MAPS.includes(R2_ENEMY_SHOWCASE_MAP_DATA), false);
    assert.deepEqual(Array.from(
        INGAME_MAP_DATA.MAPS,
        (map) => map.id
    ), [
        CORRIDOR_EIGHT_MAP_DATA.id,
        PERFORMANCE_SERPENTINE_MAP_DATA.id
    ]);

    const source = await readFile(new URL(
        '../script/data/scene/game/r2_enemy_showcase_wave_data.js',
        import.meta.url
    ), 'utf8');
    assert.doesNotMatch(source, /Math\.random|crypto\.getRandomValues/);
});
