import {
    BASIC_CORK_ENEMY_DATA,
    BASIC_SQUARE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    CORK_DUAL_ROUTE_MAP_DATA,
    CORK_DUAL_ROUTE_ROUTE_SET_ID
} from './cork_dual_route_map_data.js';

export const CORK_DUAL_ROUTE_WAVE_01_ID = 'cork_dual_route_wave_01';
export const CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS = 15;

const CORK_DUAL_ROUTE_WAVE_01_ENEMY_MODIFIERS = Object.freeze({
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

const ROUTE_SET_BINDING = Object.freeze({
    routeSetId: CORK_DUAL_ROUTE_ROUTE_SET_ID
});

const CORK_DUAL_ROUTE_WAVE_01_TIMELINE = Object.freeze([
    Object.freeze({
        timelineEntryId: 'spawn-cork-at-first-boundary',
        type: 'SPAWN_GROUP',
        spawnGroup: Object.freeze({
            groupId: 'cork-route-closure-owner',
            enemyDefinitionId: BASIC_CORK_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'route-closure',
            count: 1,
            laneOffsetsTiles: Object.freeze([0])
        })
    }),
    Object.freeze({
        timelineEntryId: 'wait-for-travel-and-expansion',
        type: 'WAIT',
        durationSeconds: CORK_DUAL_ROUTE_FOLLOWUP_WAIT_SECONDS
    }),
    Object.freeze({
        timelineEntryId: 'spawn-future-route-followers',
        type: 'SPAWN_GROUP',
        spawnGroup: Object.freeze({
            groupId: 'future-route-followers',
            enemyDefinitionId: BASIC_SQUARE_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'corebound',
            count: 2,
            laneOffsetsTiles: Object.freeze([-0.6, 0.6])
        })
    })
]);

/** Turn 8 acceptance 전용 injection wave이며 production wave 선택에는 등록하지 않습니다. */
export const CORK_DUAL_ROUTE_WAVE_01_DATA = Object.freeze({
    waveId: CORK_DUAL_ROUTE_WAVE_01_ID,
    mapId: CORK_DUAL_ROUTE_MAP_DATA.id,
    enemyModifiers: CORK_DUAL_ROUTE_WAVE_01_ENEMY_MODIFIERS,
    timeline: CORK_DUAL_ROUTE_WAVE_01_TIMELINE
});
