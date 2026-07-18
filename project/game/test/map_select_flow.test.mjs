import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const { TITLE_MENU_DATA } = await loadGameModule(
    'data/scene/title/title_menu_data.js'
);
const startCard = TITLE_MENU_DATA.CARD_DEFINITIONS.find((card) => card.id === 'start');
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
assert.match(mapSelectOverlaySource, /isGameMapFloorCell\(selectedMap, row, column\)/);
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
