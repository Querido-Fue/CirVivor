import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TitleMenuCardRegistry } = await loadGameModule(
    'scene/title/menu/_title_menu_card_registry.js'
);
const { GAME_MAP_DATA } = await loadGameModule(
    'data/scene/game/game_map_data.js'
);
assert.equal(resolveDefaultMapId(), GAME_MAP_DATA.DEFAULT_MAP_ID);

/**
 * 맵 선택 화면의 초기 선택값으로 사용할 등록 기본 맵 ID를 반환합니다.
 * @returns {string|null} 등록된 기본 맵 ID입니다.
 */
function resolveDefaultMapId() {
    return GAME_MAP_DATA.MAPS.find(({ id }) => id === GAME_MAP_DATA.DEFAULT_MAP_ID)?.id ?? null;
}

const titleMenuCardRegistry = new TitleMenuCardRegistry();
const startCard = titleMenuCardRegistry.getById('start');
assert.equal(startCard?.actionType, 'overlay');
assert.equal(startCard?.actionKey, 'mapSelect');

const overlaySystemSource = await readFile(
    new URL('../script/module/overlay/overlay_system.js', import.meta.url),
    'utf8'
);
assert.match(overlaySystemSource, /mapSelect:\s*\(titleScene\)\s*=>\s*new MapSelectOverlay\(titleScene\)/);

const mapSelectOverlaySource = await readFile(
    new URL('../script/module/overlay/title/_map_select_overlay.js', import.meta.url),
    'utf8'
);
assert.match(
    mapSelectOverlaySource,
    /this\.selectedMapId\s*=\s*resolveGameMapDefinition\(GAME_MAP_DATA\.DEFAULT_MAP_ID\)\?\.id[\s\S]*?\?\? GAME_MAP_DATA\.MAPS\[0\]\?\.id[\s\S]*?\?\? null/
);
assert.match(
    mapSelectOverlaySource,
    /isResolvedGameMapFloorCell\(selectedMap, row, column\)/
);
assert.match(
    mapSelectOverlaySource,
    /if \(this\.startRequested \|\| !selectedMap\) \{[\s\S]*?this\.startRequested = true;[\s\S]*?this\.titleScene\.gameStart\(selectedMap\.id\);/
);

const titleSceneSource = await readFile(
    new URL('../script/module/scene/title/_title_scene.js', import.meta.url),
    'utf8'
);
assert.match(
    titleSceneSource,
    /gameStart\(mapId\) \{\s*this\.sceneSystem\.gameStart\(mapId\);\s*\}/
);

const sceneSystemSource = await readFile(
    new URL('../script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
assert.match(
    sceneSystemSource,
    /gameStart\(mapId\)[\s\S]*?new GameScene\(this, \{[\s\S]*?mode: GAME_SCENE_MODES\.PLAY,[\s\S]*?mapId[\s\S]*?\}\)/
);

console.log('map select flow contract: ok');
