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
    BASIC_OCTA_ORBIT_CAPACITY_POLICY
} from 'data/object/enemy/basic_octa_enemy_data.js';
import {
    ARCHER_ENEMY_DATA
} from 'data/object/enemy/archer_enemy_data.js';
import {
    AUTHORED_FORMATION_COORDINATE_SYSTEM,
    AUTHORED_FORMATION_SPAWN_MODE,
    AUTHORED_WAVE_TIMELINE_COMMAND_TYPE
} from 'ingame/flow/authored_wave_timeline_contract.js';
import {
    CORRIDOR_EIGHT_MAP_DATA
} from './corridor_eight_map_data.js';
import {
    CORRIDOR_EIGHT_WAVE_01_DATA
} from './corridor_eight_wave_01_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA,
    R2_ENEMY_SHOWCASE_ROUTE_SET_ID
} from './r2_enemy_showcase_map_data.js';

export const R2_ENEMY_SHOWCASE_WAVE_01_ID = 'r2_enemy_showcase_wave_01';
export const R2_ENEMY_SHOWCASE_WAVE_02_ID = 'r2_enemy_showcase_wave_02';
export const R2_ENEMY_SHOWCASE_WAVE_03_ID = 'r2_enemy_showcase_wave_03';
export const R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O = 4;

if (R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O
    > BASIC_OCTA_ORBIT_CAPACITY_POLICY.maximumSimultaneousActors) {
    throw new RangeError('R2 showcase O authoring이 bounded orbit capacity를 초과합니다.');
}

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

const ROUTE_SET_BINDING = Object.freeze({
    routeSetId: R2_ENEMY_SHOWCASE_ROUTE_SET_ID
});

const WAVE_01_TIMELINE = Object.freeze([
    Object.freeze({
        timelineEntryId: 'baseline-c-pressure',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: Object.freeze({
            groupId: 'baseline-c-pressure-group',
            enemyDefinitionId: BASIC_CIRCLE_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'corebound',
            count: 4,
            laneOffsetsTiles: Object.freeze([-1.8, -0.6, 0.6, 1.8])
        })
    }),
    Object.freeze({
        timelineEntryId: 'baseline-to-specialist-gap',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 2
    }),
    Object.freeze({
        timelineEntryId: 'row-introduction-t-a-m-p',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: Object.freeze({
            groupId: 'row-introduction-formation',
            memberCount: 5,
            rows: 2,
            columns: 3,
            coordinateSystem:
                AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE,
            spawnMode: AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
            rowDelayTicks: 15,
            keepFormation: false,
            layout: Object.freeze(['CTA', 'MP.']),
            symbolMap: Object.freeze({
                C: BASIC_CIRCLE_ENEMY_DATA.id,
                T: BASIC_TRIANGLE_ENEMY_DATA.id,
                A: BASIC_ARROW_ENEMY_DATA.id,
                M: BASIC_RHOM_ENEMY_DATA.id,
                P: BASIC_PENTA_ENEMY_DATA.id
            }),
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-row-introduction',
            rowSpacingTiles: 1.2,
            columnSpacingTiles: 1.2,
            anchorOffsetTiles: Object.freeze({ x: 0.5, y: 0 })
        })
    })
]);

const WAVE_02_TIMELINE = Object.freeze([
    Object.freeze({
        timelineEntryId: 'hexa-six-ring-sequential-rows',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: Object.freeze({
            groupId: 'hexa-six-ring-showcase',
            memberCount: 6,
            rows: 3,
            columns: 3,
            coordinateSystem: AUTHORED_FORMATION_COORDINATE_SYSTEM.HEX_AXIAL,
            spawnMode: AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
            rowDelayTicks: 8,
            keepFormation: true,
            layout: Object.freeze(['.HH', 'H.H', 'HH.']),
            symbolMap: Object.freeze({ H: BASIC_HEXA_ENEMY_DATA.id }),
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-hexa-merge',
            rowSpacingTiles: 1,
            columnSpacingTiles: 1,
            anchorOffsetTiles: Object.freeze({ x: 0, y: 0 })
        })
    }),
    Object.freeze({
        timelineEntryId: 'hexa-to-orbit-gap',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 3
    }),
    Object.freeze({
        timelineEntryId: 'bounded-octagon-orbit',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: Object.freeze({
            groupId: 'bounded-octagon-orbit-group',
            enemyDefinitionId: BASIC_OCTA_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-orbit-defense',
            count: R2_ENEMY_SHOWCASE_MAX_AUTHORED_SIMULTANEOUS_O,
            laneOffsetsTiles: Object.freeze([-1.8, -0.6, 0.6, 1.8])
        })
    }),
    Object.freeze({
        timelineEntryId: 'orbit-to-lineage-gap',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 3
    }),
    Object.freeze({
        timelineEntryId: 'jorang-lineage-pair',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: Object.freeze({
            groupId: 'jorang-lineage-pair-group',
            enemyDefinitionId: BASIC_JORANG_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-lineage',
            count: 2,
            laneOffsetsTiles: Object.freeze([-0.8, 0.8])
        })
    }),
    Object.freeze({
        timelineEntryId: 'lineage-to-capture-gap',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 2
    }),
    Object.freeze({
        timelineEntryId: 'ring-capture-pair',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: Object.freeze({
            groupId: 'ring-capture-pair-group',
            enemyDefinitionId: BASIC_RING_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-projectile-capture',
            count: 2,
            laneOffsetsTiles: Object.freeze([-0.8, 0.8])
        })
    })
]);

const WAVE_03_TIMELINE = Object.freeze([
    Object.freeze({
        timelineEntryId: 'single-cork-owner',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_GROUP,
        spawnGroup: Object.freeze({
            groupId: 'single-cork-owner-group',
            enemyDefinitionId: BASIC_CORK_ENEMY_DATA.id,
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-route-closure',
            count: 1,
            laneOffsetsTiles: Object.freeze([0])
        })
    }),
    Object.freeze({
        timelineEntryId: 'wait-for-cork-expansion',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.WAIT,
        durationSeconds: 15
    }),
    Object.freeze({
        timelineEntryId: 'formation-through-route-availability',
        type: AUTHORED_WAVE_TIMELINE_COMMAND_TYPE.SPAWN_FORMATION,
        formation: Object.freeze({
            groupId: 'route-availability-row-formation',
            memberCount: 8,
            rows: 3,
            columns: 3,
            coordinateSystem:
                AUTHORED_FORMATION_COORDINATE_SYSTEM.PATH_RELATIVE,
            spawnMode: AUTHORED_FORMATION_SPAWN_MODE.SEQUENTIAL_ROWS,
            rowDelayTicks: 10,
            keepFormation: false,
            layout: Object.freeze(['CTC', 'T.T', 'CTC']),
            symbolMap: Object.freeze({
                C: BASIC_CIRCLE_ENEMY_DATA.id,
                T: BASIC_TRIANGLE_ENEMY_DATA.id
            }),
            routeBinding: ROUTE_SET_BINDING,
            policyId: 'showcase-route-reroute-formation',
            rowSpacingTiles: 1,
            columnSpacingTiles: 1,
            anchorOffsetTiles: Object.freeze({ x: 0.5, y: 0 })
        })
    })
]);

function createWave(waveId, timeline) {
    return Object.freeze({
        waveId,
        mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
        enemyModifiers: IDENTITY_ENEMY_MODIFIERS,
        timeline
    });
}

export const R2_ENEMY_SHOWCASE_WAVE_01_DATA = createWave(
    R2_ENEMY_SHOWCASE_WAVE_01_ID,
    WAVE_01_TIMELINE
);
export const R2_ENEMY_SHOWCASE_WAVE_02_DATA = createWave(
    R2_ENEMY_SHOWCASE_WAVE_02_ID,
    WAVE_02_TIMELINE
);
export const R2_ENEMY_SHOWCASE_WAVE_03_DATA = createWave(
    R2_ENEMY_SHOWCASE_WAVE_03_ID,
    WAVE_03_TIMELINE
);

export const R2_ENEMY_SHOWCASE_WAVES = Object.freeze([
    R2_ENEMY_SHOWCASE_WAVE_01_DATA,
    R2_ENEMY_SHOWCASE_WAVE_02_DATA,
    R2_ENEMY_SHOWCASE_WAVE_03_DATA
]);

/** 첫 production 카드의 preview ID와 실제 R2 showcase runtime 배치를 함께 기록합니다. */
export const R2_ENEMY_SHOWCASE_CONTENT_PLACEMENT = Object.freeze({
    defaultProduction: Object.freeze({
        mapId: CORRIDOR_EIGHT_MAP_DATA.id,
        waveIds: Object.freeze([CORRIDOR_EIGHT_WAVE_01_DATA.waveId]),
        enemyDefinitionIds: Object.freeze([
            BASIC_CIRCLE_ENEMY_DATA.id,
            BASIC_TRIANGLE_ENEMY_DATA.id,
            BASIC_ARROW_ENEMY_DATA.id,
            BASIC_RHOM_ENEMY_DATA.id,
            ARCHER_ENEMY_DATA.id
        ])
    }),
    showcase: Object.freeze({
        mapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
        waveIds: Object.freeze(R2_ENEMY_SHOWCASE_WAVES.map(({ waveId }) => waveId)),
        enemyDefinitionIds: Object.freeze([
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
        ]),
        accessPolicyId: 'production-stage-one-and-manual-injection'
    }),
    productionStageOne: Object.freeze({
        selectionMapId: CORRIDOR_EIGHT_MAP_DATA.id,
        runtimeMapId: R2_ENEMY_SHOWCASE_MAP_DATA.id,
        waveId: R2_ENEMY_SHOWCASE_WAVE_01_DATA.waveId
    })
});

export const R2_ENEMY_SHOWCASE_STAGE_MANIFEST = Object.freeze([
    Object.freeze({
        waveId: R2_ENEMY_SHOWCASE_WAVE_01_ID,
        mechanics: Object.freeze([
            'baseline-c-t-pressure',
            'arrow-charge-recoil',
            'rhom-core-priority-fire',
            'penta-boost',
            'formation-sequential-rows'
        ])
    }),
    Object.freeze({
        waveId: R2_ENEMY_SHOWCASE_WAVE_02_ID,
        mechanics: Object.freeze([
            'hexa-group-merge-to-hx',
            'octagon-orbit-directional-defense',
            'jorang-split-regrowth',
            'ring-projectile-capture'
        ])
    }),
    Object.freeze({
        waveId: R2_ENEMY_SHOWCASE_WAVE_03_ID,
        mechanics: Object.freeze([
            'cork-route-closure',
            'route-availability-formation-reroute'
        ])
    })
]);
