import {
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
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} from 'ingame/flow/authored_wave_timeline_contract.js';
import {
    PERFORMANCE_SERPENTINE_GATE_ID,
    PERFORMANCE_SERPENTINE_MAP_DATA,
    PERFORMANCE_SERPENTINE_PATH_ID
} from './performance_serpentine_map_data.js';

export const PERFORMANCE_SERPENTINE_WAVE_01_ID
    = 'performance_serpentine_wave_01';
export const PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT = 10_000;
export const PERFORMANCE_SERPENTINE_SPAWN_INTERVAL_TICKS = 1;
export const PERFORMANCE_SERPENTINE_SESSION = Object.freeze({
    towerMaxHp: 20_000_000,
    coreMaxIntegrity: 20_000_000
});

export const PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS = Object.freeze([
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

// Bounded O/R/Z와 transform H/J, projectile-producing M, global-effect P는
// opening census에서 실제 경로를 한 번 통과합니다. 나머지 대량 부하는 C/T/A를
// 순환해 10,000 active-body 성능과 Arrow easeOutExpo 비용을 직접 측정합니다.
const PERFORMANCE_BULK_DEFINITION_IDS = Object.freeze([
    BASIC_CIRCLE_ENEMY_DATA.id,
    BASIC_TRIANGLE_ENEMY_DATA.id,
    BASIC_ARROW_ENEMY_DATA.id
]);
const PERFORMANCE_ROUTE_BINDING = Object.freeze({
    gateId: PERFORMANCE_SERPENTINE_GATE_ID,
    pathId: PERFORMANCE_SERPENTINE_PATH_ID
});
export const PERFORMANCE_SERPENTINE_LANE_OFFSETS_TILES = Object.freeze([
    -4,
    -3.1,
    -2.2,
    -1.3,
    -0.45,
    0.45,
    1.3,
    2.2,
    3.1,
    4
]);

const IDENTITY_ENEMY_MODIFIERS = Object.freeze({
    global: Object.freeze({
        multipliers: Object.freeze({
            maxHealth: 1,
            moveSpeedTilesPerSecond: 1,
            weight: 1,
            towerContactDamage: 1,
            coreImpactDamage: 1,
            bountyBudget: 1
        }),
        absolute: Object.freeze({})
    }),
    byEnemyDefinitionId: Object.freeze({})
});

function createSequentialEntry({ id, groupId, definitionIds, count }) {
    return Object.freeze({
        timelineEntryId: id,
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FOR_DURATION,
        durationSeconds: (
            count * PERFORMANCE_SERPENTINE_SPAWN_INTERVAL_TICKS
        ) / 60,
        spawnGroups: Object.freeze([Object.freeze({
            groupId,
            enemyDefinitionId: definitionIds[0],
            enemyDefinitionIds: definitionIds,
            routeBinding: PERFORMANCE_ROUTE_BINDING,
            policyId: 'performance-serpentine-corebound',
            count,
            intervalTicks: PERFORMANCE_SERPENTINE_SPAWN_INTERVAL_TICKS,
            laneOffsetsTiles: PERFORMANCE_SERPENTINE_LANE_OFFSETS_TILES
        })])
    });
}

const OPENING_COUNT = PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS.length;
const PERFORMANCE_TIMELINE = Object.freeze([
    createSequentialEntry({
        id: 'performance-all-enemy-opening-census',
        groupId: 'performance-all-enemy-opening-census-group',
        definitionIds: PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS,
        count: OPENING_COUNT
    }),
    createSequentialEntry({
        id: 'performance-ten-thousand-body-stream',
        groupId: 'performance-ten-thousand-body-stream-group',
        definitionIds: PERFORMANCE_BULK_DEFINITION_IDS,
        count: PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT - OPENING_COUNT
    })
]);

export const PERFORMANCE_SERPENTINE_WAVE_01_DATA = Object.freeze({
    waveId: PERFORMANCE_SERPENTINE_WAVE_01_ID,
    mapId: PERFORMANCE_SERPENTINE_MAP_DATA.id,
    enemyModifiers: IDENTITY_ENEMY_MODIFIERS,
    timeline: PERFORMANCE_TIMELINE
});
