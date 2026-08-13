import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
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
    /if \(this\.startRequested \|\| !selectedMap\) \{[\s\S]*?this\.startRequested = true;[\s\S]*?this\.pendingStartMapId = selectedMap\.id;[\s\S]*?this\.close\(\);/
);
assert.match(
    mapSelectOverlaySource,
    /onCloseComplete\(\) \{[\s\S]*?const mapId = this\.pendingStartMapId;[\s\S]*?queueMicrotask\(\(\) => \{[\s\S]*?titleScene\?\.gameStart\?\.\(mapId\);/
);

const titleSceneSource = await readFile(
    new URL('../script/module/scene/title/_title_scene.js', import.meta.url),
    'utf8'
);
assert.match(
    titleSceneSource,
    /gameStart\(mapId\) \{\s*this\.sceneSystem\.gameStart\(mapId\);\s*\}/
);

const titleSceneControllerSource = await readFile(
    new URL('../script/module/scene/title/_title_scene_controller.js', import.meta.url),
    'utf8'
);
assert.match(
    titleSceneControllerSource,
    /gameStart\(mapId\) \{\s*this\.sceneSystem\.gameStart\(mapId\);\s*\}/
);

const sceneSystemSource = await readFile(
    new URL('../script/module/scene/scene_system.js', import.meta.url),
    'utf8'
);
assert.match(
    sceneSystemSource,
    /gameStart\(mapId\)[\s\S]*?new GameScene\(this, \{[\s\S]*?mode: GAME_SCENE_MODES\.PLAY,[\s\S]*?createProductionGameStartOptions\(mapId\)[\s\S]*?\}\)/
);

const overlayRuntimeTrace = [];
const overlayRuntimeContext = vm.createContext({
    console,
    queueMicrotask
});
let capturedStartClick = null;

class TitleOverlayStub {
    constructor(titleScene) {
        this.titleScene = titleScene;
        this.UIWW = 100;
        this.WH = 100;
        this.positioningHandler = {
            parseUnit() {
                return 1;
            }
        };
        this.staticItems = null;
        this.dynamicItems = null;
    }

    close() {
        overlayRuntimeTrace.push('close-requested');
    }

    finishClose() {
        this.onCloseComplete();
        overlayRuntimeTrace.push('overlay-released');
    }

    _releaseElements() {
        this.staticItems = null;
        this.dynamicItems = null;
    }
}

class LayoutHandlerStub {
    constructor() {
        this.currentItemId = null;
    }

    item(_type, id) {
        this.currentItemId = id;
        return this;
    }

    onClick(callback) {
        if (this.currentItemId === 'map_select_start') {
            capturedStartClick = callback;
        }
        return this;
    }

    build() {
        return {
            staticItems: [],
            dynamicItems: [],
            components: {}
        };
    }
}

for (const methodName of [
    'space',
    'group',
    'justifyContent',
    'width',
    'textStyle',
    'text',
    'fill',
    'vAlign',
    'spacer',
    'endGroup',
    'height',
    'buttonText',
    'prop',
    'bottomSpace',
    'bottomGroup',
    'align',
    'buttonStyle',
    'buttonColor',
    'icon'
]) {
    LayoutHandlerStub.prototype[methodName] = function chainLayout() {
        return this;
    };
}

const overlayRuntimeModule = new vm.SourceTextModule(mapSelectOverlaySource, {
    context: overlayRuntimeContext,
    identifier: '_map_select_overlay.js'
});
const overlayRuntimeDependencies = new Map([
    ['data/scene/game/game_map_data.js', new vm.SyntheticModule(
        ['GAME_MAP_DATA'],
        function initializeGameMapData() {
            this.setExport('GAME_MAP_DATA', GAME_MAP_DATA);
        },
        { context: overlayRuntimeContext }
    )],
    ['display/_theme_handler.js', new vm.SyntheticModule(
        ['ColorSchemes'],
        function initializeColorSchemes() {
            this.setExport('ColorSchemes', {
                Game: { Map: {} },
                Cursor: { Active: '#fff' },
                Overlay: {
                    Panel: { Divider: '#fff' },
                    Control: { Inactive: '#000' },
                    Text: { Item: '#fff' },
                    Button: { Cancel: '#000' }
                },
                Title: { TextDark: '#fff' }
            });
        },
        { context: overlayRuntimeContext }
    )],
    ['display/display_system.js', new vm.SyntheticModule(
        ['render'],
        function initializeRender() {
            this.setExport('render', () => {});
        },
        { context: overlayRuntimeContext }
    )],
    ['scene/game/map/game_map_grid.js', new vm.SyntheticModule(
        ['isResolvedGameMapFloorCell', 'resolveGameMapDefinition'],
        function initializeGameMapGrid() {
            this.setExport('isResolvedGameMapFloorCell', () => true);
            this.setExport('resolveGameMapDefinition', (mapId) => (
                GAME_MAP_DATA.MAPS.find(({ id }) => id === mapId)
                ?? GAME_MAP_DATA.MAPS[0]
                ?? null
            ));
        },
        { context: overlayRuntimeContext }
    )],
    ['ui/layout/_layout_handler.js', new vm.SyntheticModule(
        ['LayoutHandler'],
        function initializeLayoutHandler() {
            this.setExport('LayoutHandler', LayoutHandlerStub);
        },
        { context: overlayRuntimeContext }
    )],
    ['ui/style/component_styles.js', new vm.SyntheticModule(
        ['BUTTON_STYLE'],
        function initializeButtonStyle() {
            this.setExport('BUTTON_STYLE', { OVERLAY_INTERACT: 'overlay' });
        },
        { context: overlayRuntimeContext }
    )],
    ['ui/style/typography.js', new vm.SyntheticModule(
        ['TYPOGRAPHY'],
        function initializeTypography() {
            this.setExport('TYPOGRAPHY', { H3: 'h3', H5: 'h5' });
        },
        { context: overlayRuntimeContext }
    )],
    ['ui/ui_system.js', new vm.SyntheticModule(
        ['getLangString'],
        function initializeUiSystem() {
            this.setExport('getLangString', (key) => key);
        },
        { context: overlayRuntimeContext }
    )],
    ['../_overlay_confirm_icon.js', new vm.SyntheticModule(
        ['applyOverlayConfirmButtonIcon'],
        function initializeConfirmIcon() {
            this.setExport('applyOverlayConfirmButtonIcon', () => {});
        },
        { context: overlayRuntimeContext }
    )],
    ['../_overlay_layout_recipes.js', new vm.SyntheticModule(
        ['addOverlayPageHeader'],
        function initializeLayoutRecipes() {
            this.setExport('addOverlayPageHeader', (handler) => handler);
        },
        { context: overlayRuntimeContext }
    )],
    ['./_title_overlay.js', new vm.SyntheticModule(
        ['TitleOverlay'],
        function initializeTitleOverlay() {
            this.setExport('TitleOverlay', TitleOverlayStub);
        },
        { context: overlayRuntimeContext }
    )]
]);

await overlayRuntimeModule.link((specifier) => {
    const dependency = overlayRuntimeDependencies.get(specifier);
    if (!dependency) {
        throw new Error(`예상하지 못한 MapSelectOverlay import입니다: ${specifier}`);
    }
    return dependency;
});
await overlayRuntimeModule.evaluate();

const titleStartCalls = [];
const MapSelectOverlayRuntime = overlayRuntimeModule.namespace.MapSelectOverlay;
const mapSelectOverlayRuntime = new MapSelectOverlayRuntime({
    gameStart(mapId) {
        overlayRuntimeTrace.push(`game-start:${mapId}`);
        titleStartCalls.push(mapId);
    }
});
mapSelectOverlayRuntime._generateLayout();
assert.equal(typeof capturedStartClick, 'function');
capturedStartClick();
assert.deepEqual(titleStartCalls, []);
assert.deepEqual(overlayRuntimeTrace, ['close-requested']);

mapSelectOverlayRuntime.finishClose();
assert.deepEqual(titleStartCalls, []);
assert.deepEqual(overlayRuntimeTrace, [
    'close-requested',
    'overlay-released'
]);
await new Promise((resolve) => queueMicrotask(resolve));
assert.deepEqual(titleStartCalls, [GAME_MAP_DATA.DEFAULT_MAP_ID]);
assert.deepEqual(overlayRuntimeTrace, [
    'close-requested',
    'overlay-released',
    `game-start:${GAME_MAP_DATA.DEFAULT_MAP_ID}`
]);

console.log('map select flow contract: ok');
