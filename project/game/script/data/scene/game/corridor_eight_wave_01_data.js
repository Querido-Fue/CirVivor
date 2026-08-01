import { BASIC_CIRCLE_ENEMY_DATA } from 'data/object/enemy/basic_circle_enemy_data.js';
import { CORRIDOR_EIGHT_MAP_DATA } from './corridor_eight_map_data.js';

const FIRST_ROUTE = CORRIDOR_EIGHT_MAP_DATA.enemySpawnRoutes[0];
const SPAWN_COUNT = 32;
const SPAWN_INTERVAL_TICKS = 3;

/**
 * GPU 충돌·route 이동 수직 슬라이스용 첫 scheduling wave입니다.
 * count/interval은 기존 production 권한이 없어 신규 콘텐츠 값으로 선언합니다.
 * Core 접촉, 피해, 사망, 완료 판정은 의도적으로 이 데이터의 책임이 아닙니다.
 */
export const CORRIDOR_EIGHT_WAVE_01_DATA = Object.freeze({
    waveId: 'corridor_eight_wave_01',
    mapId: CORRIDOR_EIGHT_MAP_DATA.id,
    phases: Object.freeze([
        Object.freeze({
            startTick: 1,
            durationTicks: ((SPAWN_COUNT - 1) * SPAWN_INTERVAL_TICKS) + 1,
            spawnGroups: Object.freeze([
                Object.freeze({
                    enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
                    gateId: FIRST_ROUTE.gateId,
                    pathChoicePolicy: 'fixed-route',
                    count: SPAWN_COUNT,
                    intervalTicks: SPAWN_INTERVAL_TICKS,
                    policyId: 'corebound',
                    laneOffsetsTiles: Object.freeze([-1.8, -0.6, 0.6, 1.8])
                })
            ])
        })
    ])
});
