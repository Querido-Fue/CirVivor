import { CORRIDOR_EIGHT_MAP_DATA } from 'data/scene/game/corridor_eight_map_data.js';
import {
    R2_ENEMY_SHOWCASE_MAP_DATA
} from 'data/scene/game/r2_enemy_showcase_map_data.js';
import {
    R2_ENEMY_SHOWCASE_WAVE_01_DATA
} from 'data/scene/game/r2_enemy_showcase_wave_data.js';
import { TileMap } from 'ingame/map/tile_map.js';

/** 타이틀 맵 선택의 첫 production 카드가 유지하는 preview/selection identity입니다. */
export const PRODUCTION_STAGE_ONE_SELECTION_MAP_ID = CORRIDOR_EIGHT_MAP_DATA.id;

/** 첫 production 카드가 실제로 여는 Post-R2 showcase gameplay map입니다. */
export const PRODUCTION_STAGE_ONE_RUNTIME_MAP_ID = R2_ENEMY_SHOWCASE_MAP_DATA.id;

/**
 * 타이틀의 선택 map ID를 실제 GameScene 세션 옵션으로 변환합니다.
 *
 * 첫 카드의 preview identity는 호환성을 위해 corridor로 유지하지만, 실제 세션은
 * R2 showcase map과 Wave 1을 함께 고정합니다. 다른/직접 호출 map ID는 기존
 * resolver 경로를 그대로 사용합니다.
 * @param {string|null|undefined} selectedMapId - 타이틀에서 선택한 map ID입니다.
 * @returns {object} GameScene constructor에 전달할 세션 옵션입니다.
 */
export function createProductionGameStartOptions(selectedMapId) {
    if (selectedMapId !== PRODUCTION_STAGE_ONE_SELECTION_MAP_ID) {
        return {
            mapId: selectedMapId
        };
    }
    return {
        mapId: PRODUCTION_STAGE_ONE_RUNTIME_MAP_ID,
        tileNavigationSource: new TileMap(R2_ENEMY_SHOWCASE_MAP_DATA),
        enemyWaveEnabled: true,
        gameplayWorldActorsEnabled: true,
        enemyRecoveryEnabled: true,
        waveDefinition: R2_ENEMY_SHOWCASE_WAVE_01_DATA
    };
}
