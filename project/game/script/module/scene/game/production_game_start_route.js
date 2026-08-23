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
    R5_SHOWCASE_SENTENCE_LOADOUT,
    R6_QA_SENTENCE_LOADOUT,
    R7_QA_SENTENCE_LOADOUT
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} from 'data/word/r8_word_shop_catalog_data.js';
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

export const R6_QA_LAUNCH_ARGUMENT = '--r6-qa';
export const R7_QA_LAUNCH_ARGUMENT = '--r7-qa';
export const R8_QA_LAUNCH_ARGUMENT = '--r8-qa';

/** 실제 executable에서만 쓰는 명시적 QA launcher 선택 seam입니다. */
export function isR6QaLaunchRequested(
    argv = globalThis.nw?.App?.argv ?? []
) {
    return Array.isArray(argv) && argv.includes(R6_QA_LAUNCH_ARGUMENT);
}

/** R7 modifier QA는 exact launcher argument에서만 활성화됩니다. */
export function isR7QaLaunchRequested(
    argv = globalThis.nw?.App?.argv ?? []
) {
    return Array.isArray(argv) && argv.includes(R7_QA_LAUNCH_ARGUMENT);
}

/** R8 Shop/editor QA는 exact launcher argument에서만 활성화됩니다. */
export function isR8QaLaunchRequested(
    argv = globalThis.nw?.App?.argv ?? []
) {
    return Array.isArray(argv) && argv.includes(R8_QA_LAUNCH_ARGUMENT);
}

function createPlayableSessionOptions(
    mapData,
    waveDefinition,
    session,
    loadout = R5_SHOWCASE_SENTENCE_LOADOUT
) {
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
            loadout
        })
    };
}

function createGameStartOptions(selectedMapId, loadout) {
    if (selectedMapId === PRODUCTION_STAGE_ONE_SELECTION_MAP_ID) {
        return createPlayableSessionOptions(
            R2_ENEMY_SHOWCASE_MAP_DATA,
            R2_ENEMY_SHOWCASE_WAVE_01_DATA,
            R2_ENEMY_SHOWCASE_STAGE_ONE_PERFORMANCE_SESSION,
            loadout
        );
    }
    if (selectedMapId === PRODUCTION_PERFORMANCE_SELECTION_MAP_ID) {
        return createPlayableSessionOptions(
            PERFORMANCE_SERPENTINE_MAP_DATA,
            PERFORMANCE_SERPENTINE_WAVE_01_DATA,
            PERFORMANCE_SERPENTINE_SESSION,
            loadout
        );
    }
    return {
        mapId: selectedMapId
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
    if (isR8QaLaunchRequested()) {
        return createR8QaGameStartOptions(selectedMapId);
    }
    return createGameStartOptions(
        selectedMapId,
        isR7QaLaunchRequested()
            ? R7_QA_SENTENCE_LOADOUT
            : isR6QaLaunchRequested()
                ? R6_QA_SENTENCE_LOADOUT
                : R5_SHOWCASE_SENTENCE_LOADOUT
    );
}

/** Permanent key 없이 실제 GameScene에 Merge slot을 주입하는 QA launcher입니다. */
export function createR6QaGameStartOptions(
    selectedMapId = PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
) {
    return createGameStartOptions(selectedMapId, R6_QA_SENTENCE_LOADOUT);
}

/** Permanent key 없이 실제 GameScene에 R7 modifier 문장을 주입합니다. */
export function createR7QaGameStartOptions(
    selectedMapId = PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
) {
    return createGameStartOptions(selectedMapId, R7_QA_SENTENCE_LOADOUT);
}

/** Starter board와 data-owned Gold/pool로 frozen Shop을 자동 여는 R8 QA route입니다. */
export function createR8QaGameStartOptions(
    selectedMapId = PRODUCTION_STAGE_ONE_SELECTION_MAP_ID
) {
    return {
        ...createGameStartOptions(
            selectedMapId,
            R5_SHOWCASE_SENTENCE_LOADOUT
        ),
        enemyWaveEnabled: false,
        initialGold: R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD,
        r8ShopOptions: Object.freeze({
            autoOpen: true,
            sourceId: 'launcher.--r8-qa',
            runSessionId: 'run.r8.qa',
            runSeed: R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            unlockedWordDefinitionIds:
                R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        })
    };
}
