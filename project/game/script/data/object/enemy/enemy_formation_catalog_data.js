import {
    FORMATION_COORDINATE_SYSTEM,
    FORMATION_COORDINATE_SYSTEM_CODE,
    normalizeEnemyFormationCatalog
} from 'ingame/contract/enemy_formation_contract.js';
import {
    MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES
} from './enemy_profile_catalog_data.js';

/** 0은 Formation 없음이며 production definition code는 append-only입니다. */
export const GPU_ENEMY_FORMATION_DEFINITION_CODE = Object.freeze({
    NONE: 0,
    HEXA_HIVE_SIX_RING: 1
});

export const HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID = (
    'hexa-hive-six-ring-01'
);

const HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_SOURCE = Object.freeze({
    id: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID,
    definitionCode: GPU_ENEMY_FORMATION_DEFINITION_CODE.HEXA_HIVE_SIX_RING,
    coordinateSystemId: FORMATION_COORDINATE_SYSTEM.HEX_AXIAL,
    coordinateSystemCode: FORMATION_COORDINATE_SYSTEM_CODE.HEX_AXIAL,
    // Empty-center six-slot axial ring. Slot index is stable and append-only.
    slotCoordinates: Object.freeze([
        Object.freeze({ q: 1, r: 0 }),
        Object.freeze({ q: 1, r: -1 }),
        Object.freeze({ q: 0, r: -1 }),
        Object.freeze({ q: -1, r: 0 }),
        Object.freeze({ q: -1, r: 1 }),
        Object.freeze({ q: 0, r: 1 })
    ]),
    neighborMasks: Object.freeze([34, 5, 10, 20, 40, 17]),
    emptyCenterRequired: true,
    maximumMemberCount: 6,
    mergeSeekRadiusTiles: 4,
    mergeCommitDistanceTiles: MAIN_GPU_ENEMY_COLLISION_RADIUS_TILES * 2,
    maximumSdfSegmentSamples: 64,
    corridorClearanceRadiusScale: 1,
    compositeHealthBarPolicy: 'hx-separate-health-bar'
});

export const ENEMY_FORMATION_CATALOG = normalizeEnemyFormationCatalog(
    Object.freeze({
        definitions: Object.freeze([
            HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_SOURCE
        ])
    })
);

export const ENEMY_FORMATION_DEFINITION_BY_ID = (
    ENEMY_FORMATION_CATALOG.definitionById
);
export const ENEMY_FORMATION_DEFINITION_BY_CODE = (
    ENEMY_FORMATION_CATALOG.definitionByCode
);
export const HEXA_HIVE_SIX_RING_FORMATION_DEFINITION = (
    ENEMY_FORMATION_DEFINITION_BY_ID[
        HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID
    ]
);
