import {
    BASIC_ARROW_ENEMY_DATA,
    BASIC_CIRCLE_ENEMY_DATA,
    BASIC_TRIANGLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    WAVE_RUN_FINAL_CONTINUE_RESULT
} from 'ingame/contract/wave_run_state_contract.js';
import {
    createWaveRunPlan,
    createWaveRunPlanCatalog
} from 'ingame/contract/wave_run_plan_contract.js';
import {
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} from 'ingame/flow/authored_wave_timeline_contract.js';
import { CORRIDOR_EIGHT_MAP_DATA } from './corridor_eight_map_data.js';
import { CORRIDOR_EIGHT_WAVE_01_DATA } from './corridor_eight_wave_01_data.js';
import { PERFORMANCE_SERPENTINE_MAP_DATA } from './performance_serpentine_map_data.js';
import {
    PERFORMANCE_SERPENTINE_WAVE_01_DATA
} from './performance_serpentine_wave_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA,
    R2_ENEMY_SHOWCASE_ROUTE_SET_ID
} from './r2_enemy_showcase_map_data.js';
import {
    R2_ENEMY_SHOWCASE_WAVE_01_DATA
} from './r2_enemy_showcase_wave_data.js';
import {
    R9_WAVE_RESOLUTION_PROFILE_BY_ID,
    R9_WAVE_RESOLUTION_PROFILE_ID
} from './r9_wave_resolution_profile_data.js';

export const R9_WAVE_RUN_PLAN_ID = Object.freeze({
    CORRIDOR_PRODUCTION: 'r9-corridor-production-run',
    R2_SHOWCASE_PRODUCTION: 'r9-r2-showcase-production-run',
    PERFORMANCE_PRODUCTION: 'r9-performance-production-run',
    QA_THREE_WAVE: 'r9-qa-three-wave-run'
});

export const R9_QA_WAVE_ID = Object.freeze({
    NORMAL: 'r9_qa_wave_01_normal',
    OVERTIME: 'r9_qa_wave_02_overtime',
    FINAL: 'r9_qa_wave_03_final'
});

const QA_ROUTE_BINDING = Object.freeze({
    routeSetId: R2_ENEMY_SHOWCASE_ROUTE_SET_ID
});
const QA_LANE_OFFSETS_TILES = Object.freeze([0]);
const QA_IDENTITY_ENEMY_MODIFIERS = Object.freeze({
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

function createQaWave(waveId, enemyDefinitionId, ordinal) {
    return Object.freeze({
        waveId,
        mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
        enemyModifiers: QA_IDENTITY_ENEMY_MODIFIERS,
        timeline: Object.freeze([Object.freeze({
            timelineEntryId: `r9-qa-wave-${ordinal}-single-hostile`,
            type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
            spawnGroup: Object.freeze({
                groupId: `r9-qa-wave-${ordinal}-group`,
                enemyDefinitionId,
                routeBinding: QA_ROUTE_BINDING,
                policyId: 'r9-qa-corebound',
                count: 1,
                laneOffsetsTiles: QA_LANE_OFFSETS_TILES
            })
        })])
    });
}

export const R9_QA_WAVE_01_DATA = createQaWave(
    R9_QA_WAVE_ID.NORMAL,
    BASIC_CIRCLE_ENEMY_DATA.id,
    1
);
export const R9_QA_WAVE_02_DATA = createQaWave(
    R9_QA_WAVE_ID.OVERTIME,
    BASIC_TRIANGLE_ENEMY_DATA.id,
    2
);
export const R9_QA_WAVE_03_DATA = createQaWave(
    R9_QA_WAVE_ID.FINAL,
    BASIC_ARROW_ENEMY_DATA.id,
    3
);

function createPlan({ planId, mapId, waves }) {
    return createWaveRunPlan({
        planId,
        mapId,
        waves,
        shopAfterEveryWave: true,
        finalContinueResult: WAVE_RUN_FINAL_CONTINUE_RESULT.MAP_CLEAR_READY
    }, {
        resolutionProfileById: R9_WAVE_RESOLUTION_PROFILE_BY_ID
    });
}

export const R9_CORRIDOR_PRODUCTION_WAVE_RUN_PLAN = createPlan({
    planId: R9_WAVE_RUN_PLAN_ID.CORRIDOR_PRODUCTION,
    mapId: CORRIDOR_EIGHT_MAP_DATA.id,
    waves: [{
        waveOrdinal: 1,
        waveDefinition: CORRIDOR_EIGHT_WAVE_01_DATA,
        resolutionProfileId: R9_WAVE_RESOLUTION_PROFILE_ID.CORRIDOR_PRODUCTION
    }]
});

export const R9_R2_SHOWCASE_PRODUCTION_WAVE_RUN_PLAN = createPlan({
    planId: R9_WAVE_RUN_PLAN_ID.R2_SHOWCASE_PRODUCTION,
    mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
    waves: [{
        waveOrdinal: 1,
        waveDefinition: R2_ENEMY_SHOWCASE_WAVE_01_DATA,
        resolutionProfileId:
            R9_WAVE_RESOLUTION_PROFILE_ID.R2_SHOWCASE_PRODUCTION
    }]
});

export const R9_PERFORMANCE_PRODUCTION_WAVE_RUN_PLAN = createPlan({
    planId: R9_WAVE_RUN_PLAN_ID.PERFORMANCE_PRODUCTION,
    mapId: PERFORMANCE_SERPENTINE_MAP_DATA.id,
    waves: [{
        waveOrdinal: 1,
        waveDefinition: PERFORMANCE_SERPENTINE_WAVE_01_DATA,
        resolutionProfileId:
            R9_WAVE_RESOLUTION_PROFILE_ID.PERFORMANCE_PRODUCTION
    }]
});

export const R9_QA_THREE_WAVE_RUN_PLAN = createPlan({
    planId: R9_WAVE_RUN_PLAN_ID.QA_THREE_WAVE,
    mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
    waves: [
        {
            waveOrdinal: 1,
            waveDefinition: R9_QA_WAVE_01_DATA,
            resolutionProfileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_NORMAL
        },
        {
            waveOrdinal: 2,
            waveDefinition: R9_QA_WAVE_02_DATA,
            resolutionProfileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_OVERTIME
        },
        {
            waveOrdinal: 3,
            waveDefinition: R9_QA_WAVE_03_DATA,
            resolutionProfileId: R9_WAVE_RESOLUTION_PROFILE_ID.QA_FINAL
        }
    ]
});

// QA plan은 이 all-contract catalog에는 존재하지만 production selection map에는
// 의도적으로 등록하지 않습니다.
export const R9_PRODUCTION_WAVE_RUN_PLANS = Object.freeze([
    R9_CORRIDOR_PRODUCTION_WAVE_RUN_PLAN,
    R9_R2_SHOWCASE_PRODUCTION_WAVE_RUN_PLAN,
    R9_PERFORMANCE_PRODUCTION_WAVE_RUN_PLAN
]);

export const R9_PRODUCTION_WAVE_RUN_PLAN_BY_MAP_ID = Object.freeze(
    Object.fromEntries(R9_PRODUCTION_WAVE_RUN_PLANS.map((plan) => [plan.mapId, plan]))
);

export const R9_WAVE_RUN_PLAN_CATALOG = createWaveRunPlanCatalog([
    ...R9_PRODUCTION_WAVE_RUN_PLANS,
    R9_QA_THREE_WAVE_RUN_PLAN
]);
