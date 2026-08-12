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
    R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT,
    R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O,
    R2_ENEMY_SHOWCASE_STAGE_MANIFEST,
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

test('세 showcase wave는 기초→고급→closure로 staged되고 첫 wave에 전부 동시 투입하지 않는다', () => {
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

    const firstWaveSource = JSON.stringify(R2_ENEMY_SHOWCASE_WAVE_01_DATA);
    for (const advanced of [
        BASIC_HEXA_ENEMY_DATA.id,
        BASIC_OCTA_ENEMY_DATA.id,
        BASIC_JORANG_ENEMY_DATA.id,
        BASIC_RING_ENEMY_DATA.id,
        BASIC_CORK_ENEMY_DATA.id
    ]) {
        assert.equal(firstWaveSource.includes(advanced), false);
    }
    assert.ok(R2_ENEMY_SHOWCASE_WAVE_01_DATA.timeline.some(
        ({ type }) => type === 'SPAWN_FORMATION'
    ));
    assert.ok(R2_ENEMY_SHOWCASE_WAVE_02_DATA.timeline.some(
        ({ type }) => type === 'WAIT'
    ));
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_03_DATA.timeline[0]
        .spawnGroup.enemyDefinitionId, BASIC_CORK_ENEMY_DATA.id);
    assert.equal(R2_ENEMY_SHOWCASE_WAVE_03_DATA.timeline[1].durationSeconds, 15);
});

test('showcase staged placement는 C/T/A/M/P/H→HX/O/J/R/Z와 formation을 전수 증명한다', () => {
    const collectAuthoredDefinitionIds = (wave) => new Set(
        wave.timeline.flatMap((entry) => {
            if (entry.spawnGroup) {
                return [entry.spawnGroup.enemyDefinitionId];
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
        BASIC_PENTA_ENEMY_DATA.id,
        BASIC_RHOM_ENEMY_DATA.id,
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
            'baseline-c-t-pressure',
            'arrow-charge-recoil',
            'rhom-core-priority-fire',
            'penta-boost',
            'formation-sequential-rows'
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

test('showcase authored O는 8-slot 미만이고 overflow는 whole-batch normal rejection이다', () => {
    const authoredOEntries = R2_ENEMY_SHOWCASE_WAVES.flatMap(({ timeline }) => (
        timeline.filter(({ spawnGroup }) => (
            spawnGroup?.enemyDefinitionId === BASIC_OCTA_ENEMY_DATA.id
        ))
    ));
    assert.equal(authoredOEntries.length, 1);
    assert.equal(authoredOEntries[0].spawnGroup.count,
        R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O);
    assert.equal(R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O, 4);
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

test('default production은 그대로이고 advanced content placement는 injection-only다', async () => {
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.defaultProduction.mapId,
        CORRIDOR_EIGHT_MAP_DATA.id);
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.showcase.mapId,
        R2_ENEMY_SHOWCASE_MAP_ID);
    assert.equal(R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT.showcase.accessPolicyId,
        'showcase-injection-only');
    assert.equal(INGAME_MAP_DATA.MAPS.includes(R2_ENEMY_SHOWCASE_MAP_DATA), false);
    assert.deepEqual(Array.from(
        INGAME_MAP_DATA.MAPS,
        (map) => map.id
    ), [CORRIDOR_EIGHT_MAP_DATA.id]);

    const source = await readFile(new URL(
        '../script/data/scene/game/r2_enemy_showcase_wave_data.js',
        import.meta.url
    ), 'utf8');
    assert.doesNotMatch(source, /Math\.random|crypto\.getRandomValues/);
});
