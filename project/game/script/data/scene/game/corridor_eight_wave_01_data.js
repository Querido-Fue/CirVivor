import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_RHOM_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    ARCHER_ENEMY_DATA
} from 'data/object/enemy/archer_enemy_data.js';
import { CORRIDOR_EIGHT_MAP_DATA } from './corridor_eight_map_data.js';

const FIRST_ROUTE = CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0];
const SPAWN_COUNT = 32;
const SPAWN_INTERVAL_TICKS = 5;
const SPAWN_DURATION_SECONDS = (
    (((SPAWN_COUNT - 1) * SPAWN_INTERVAL_TICKS) + 1) / 60
);
const LANE_OFFSETS_TILES = Object.freeze([-1.8, -0.6, 0.6, 1.8]);
const ENEMY_DEFINITION_ID_CYCLE = Object.freeze([
    BASIC_CIRCLE_ENEMY_DATA.id,
    BASIC_TRIANGLE_ENEMY_DATA.id,
    BASIC_ARROW_ENEMY_DATA.id,
    BASIC_RHOM_ENEMY_DATA.id,
    BASIC_CIRCLE_ENEMY_DATA.id,
    BASIC_TRIANGLE_ENEMY_DATA.id,
    ARCHER_ENEMY_DATA.id
]);

/** Production wave는 profile base를 바꾸지 않는 explicit identity modifier를 갖습니다. */
const CORRIDOR_EIGHT_WAVE_01_ENEMY_MODIFIERS = Object.freeze({
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

const CORRIDOR_EIGHT_WAVE_01_TIMELINE = Object.freeze([
    Object.freeze({
        timelineEntryId: 'main-authored-duration',
        type: 'SPAWN_FOR_DURATION',
        durationSeconds: SPAWN_DURATION_SECONDS,
        spawnGroups: Object.freeze([
            Object.freeze({
                // singular ID는 이전 WaveDefinition 소비자의 fallback 계약입니다.
                groupId: 'main-deterministic-cycle',
                enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
                enemyDefinitionIds: ENEMY_DEFINITION_ID_CYCLE,
                routeBinding: Object.freeze({
                    gateId: FIRST_ROUTE.gateId,
                    pathId: FIRST_ROUTE.pathId
                }),
                count: SPAWN_COUNT,
                intervalTicks: SPAWN_INTERVAL_TICKS,
                policyId: 'corebound',
                laneOffsetsTiles: LANE_OFFSETS_TILES
            })
        ])
    })
]);

/**
 * GPU 충돌·route 이동 수직 슬라이스용 첫 scheduling wave입니다.
 * count/interval은 기존 production 권한이 없어 신규 콘텐츠 값으로 선언합니다.
 * Core 접촉, 피해, 사망, 완료 판정은 의도적으로 이 데이터의 책임이 아닙니다.
 */
export const CORRIDOR_EIGHT_WAVE_01_DATA = Object.freeze({
    waveId: 'corridor_eight_wave_01',
    mapId: CORRIDOR_EIGHT_MAP_DATA.id,
    enemyModifiers: CORRIDOR_EIGHT_WAVE_01_ENEMY_MODIFIERS,
    timeline: CORRIDOR_EIGHT_WAVE_01_TIMELINE
});
