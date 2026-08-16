import { CORRIDOR_EIGHT_MAP_DATA } from 'data/scene/game/corridor_eight_map_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA
} from 'data/scene/game/r2_enemy_showcase_map_data.js';
import {
    R2_ENEMY_SHOWCASE_STAGE_ONE_PERFORMANCE_SESSION,
    R2_ENEMY_SHOWCASE_WAVE_01_DATA
} from 'data/scene/game/r2_enemy_showcase_wave_data.js';
import {
    PERFORMANCE_SERPENTINE_MAP_DATA
} from 'data/scene/game/performance_serpentine_map_data.js';
import {
    PERFORMANCE_SERPENTINE_SESSION,
    PERFORMANCE_SERPENTINE_WAVE_01_DATA
} from 'data/scene/game/performance_serpentine_wave_data.js';
import {
    R3_SHOWCASE_SENTENCE_LOADOUT
} from 'data/word/r3_word_catalog_data.js';
import { TileMap } from 'ingame/map/tile_map.js';

/** 타이틀 맵 선택의 첫 production 카드가 유지하는 preview/selection identity입니다. */
export const PRODUCTION_STAGE_ONE_SELECTION_MAP_ID = CORRIDOR_EIGHT_MAP_DATA.id;

/** 첫 production 카드가 실제로 여는 Post-R2 performance showcase gameplay map입니다. */
export const PRODUCTION_STAGE_ONE_RUNTIME_MAP_ID = R2_ENEMY_SHOWCASE_MAP_DATA.id;

/** 맵 선택의 두 번째 카드가 여는 실제 10,000-body 성능 map identity입니다. */
export const PRODUCTION_PERFORMANCE_SELECTION_MAP_ID
    = PERFORMANCE_SERPENTINE_MAP_DATA.id;
export const PRODUCTION_PERFORMANCE_RUNTIME_MAP_ID
    = PERFORMANCE_SERPENTINE_MAP_DATA.id;

function createPlayableSessionOptions(mapData, waveDefinition, session) {
    return {
        mapId: mapData.id,
        tileNavigationSource: new TileMap(mapData),
        enemyWaveEnabled: true,
        gameplayWorldActorsEnabled: true,
        enemyRecoveryEnabled: true,
        towerMaxHp: session.towerMaxHp,
        coreMaxIntegrity: session.coreMaxIntegrity,
        waveDefinition,
        wordSystemOptions: Object.freeze({
            loadout: R3_SHOWCASE_SENTENCE_LOADOUT
        })
    };
}

/**
 * 타이틀의 선택 map ID를 실제 GameScene 세션 옵션으로 변환합니다.
 *
 * 첫 카드의 preview identity는 호환성을 위해 corridor로 유지하지만, 실제 세션은
 * R2 showcase map과 10,000-spawn performance Wave 1을 함께 고정합니다. 다른/직접 호출 map ID는 기존
 * resolver 경로를 그대로 사용합니다.
 * @param {string|null|undefined} selectedMapId - 타이틀에서 선택한 map ID입니다.
 * @returns {object} GameScene constructor에 전달할 세션 옵션입니다.
 */
export function createProductionGameStartOptions(selectedMapId) {
    if (selectedMapId === PRODUCTION_STAGE_ONE_SELECTION_MAP_ID) {
        return createPlayableSessionOptions(
            R2_ENEMY_SHOWCASE_MAP_DATA,
            R2_ENEMY_SHOWCASE_WAVE_01_DATA,
            R2_ENEMY_SHOWCASE_STAGE_ONE_PERFORMANCE_SESSION
        );
    }
    if (selectedMapId === PRODUCTION_PERFORMANCE_SELECTION_MAP_ID) {
        return createPlayableSessionOptions(
            PERFORMANCE_SERPENTINE_MAP_DATA,
            PERFORMANCE_SERPENTINE_WAVE_01_DATA,
            PERFORMANCE_SERPENTINE_SESSION
        );
    }
    return {
        mapId: selectedMapId
    };
}
