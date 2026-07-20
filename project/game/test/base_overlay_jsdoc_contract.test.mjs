import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const BASE_OVERLAY_PATH = fileURLToPath(new URL(
    '../script/module/overlay/_base_overlay.js',
    import.meta.url
));
const COLLECTION_OVERLAY_PATH = fileURLToPath(new URL(
    '../script/module/overlay/title/_collection.js',
    import.meta.url
));
const EXIT_OVERLAY_PATH = fileURLToPath(new URL(
    '../script/module/overlay/_exit_overlay.js',
    import.meta.url
));
const MAP_SELECT_OVERLAY_PATH = fileURLToPath(new URL(
    '../script/module/overlay/title/_map_select_overlay.js',
    import.meta.url
));
const SETTINGS_OVERLAY_PATH = fileURLToPath(new URL(
    '../script/module/overlay/title/_settings_overlay.js',
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
const EXECUTABLE_SOURCE_HASH = '069d9783cad249e2198e7f75950aa61326ab0f70e034b7c27712bccd5e352f7d';

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
 * @param {string} productionSource - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(productionSource) {
    const allJsDocStarts = productionSource.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = productionSource.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    const executableSource = productionSource
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 메서드 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} methodName - 검색할 메서드 이름입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findMethodJsDoc(methodName) {
    const escapedMethodName = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = baseOverlaySource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedMethodName}\\(`)
    );
    assert.ok(match, `${methodName} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

test('BaseOverlay JSDoc 변경은 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(baseOverlaySource), EXECUTABLE_SOURCE_HASH);
});

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

test('BaseOverlay 확장 지점 JSDoc은 protected 계약을 빠짐없이 명시한다', () => {
    for (const methodName of [
        '_calculateGeometry',
        '_onResize',
        '_generateLayout',
        '_getPanelDefinitions',
        '_drawOverlayDecorations',
        'onCloseComplete',
        '_releaseElements'
    ]) {
        const jsDoc = findMethodJsDoc(methodName);
        assert.match(jsDoc, /@protected/);
        assert.doesNotMatch(jsDoc, /@private/);
    }
});

test('BaseOverlay void 확장 지점 JSDoc은 반환값이 없음을 명시한다', () => {
    for (const methodName of [
        '_calculateGeometry',
        '_onResize',
        '_generateLayout',
        '_drawOverlayDecorations',
        'onCloseComplete',
        '_releaseElements'
    ]) {
        const jsDoc = findMethodJsDoc(methodName);
        assert.match(jsDoc, /@returns \{void\}/);
    }
});
