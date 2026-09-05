import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BASE_OVERLAY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/_base_overlay.js',
    import.meta.url
));
const COLLECTION_OVERLAY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/title/_collection.js',
    import.meta.url
));
const EXIT_OVERLAY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/_exit_overlay.js',
    import.meta.url
));
const MAP_SELECT_OVERLAY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/title/_map_select_overlay.js',
    import.meta.url
));
const SETTINGS_OVERLAY_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/title/_settings_overlay.js',
    import.meta.url
));
const [
    baseOverlaySource,
    collectionOverlaySource,
    exitOverlaySource,
    mapSelectOverlaySource,
    settingsOverlaySource
] = await Promise.all([
    readFile(BASE_OVERLAY_PATH, 'utf8'),
    readFile(COLLECTION_OVERLAY_PATH, 'utf8'),
    readFile(EXIT_OVERLAY_PATH, 'utf8'),
    readFile(MAP_SELECT_OVERLAY_PATH, 'utf8'),
    readFile(SETTINGS_OVERLAY_PATH, 'utf8')
]);

test('BaseOverlay 하위 클래스 소스와 내부 dispatch가 protected 확장 지점을 사용한다', () => {
    assert.match(collectionOverlaySource, /this\._calculateGeometry\(\)/);
    assert.match(exitOverlaySource, /\n\s*_onResize\(\)\s*\{/);
    assert.match(exitOverlaySource, /\n\s*_generateLayout\(\)\s*\{/);
    assert.match(mapSelectOverlaySource, /\n\s*_drawOverlayDecorations\(\)\s*\{/);
    assert.match(settingsOverlaySource, /\n\s*onCloseComplete\(\)\s*\{/);

    assert.match(
        baseOverlaySource,
        /resize\(\)\s*\{[\s\S]*?this\._onResize\(\);[\s\S]*?this\._calculateGeometry\(\);[\s\S]*?this\._generateLayout\(\);/
    );
    assert.match(baseOverlaySource, /this\._drawOverlayDecorations\(\);/);
    assert.match(baseOverlaySource, /this\.onCloseComplete\(\);/);
    assert.match(baseOverlaySource, /const definitions = this\._getPanelDefinitions\(\);/);
    assert.match(baseOverlaySource, /this\._releaseElements\(\);/);
});
