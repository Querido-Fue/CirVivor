import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const [settingsSource, baseOverlaySource] = await Promise.all([
    readFile(
        new URL('../script/module/overlay/title/_settings_overlay.js', import.meta.url),
        'utf8'
    ),
    readFile(
        new URL('../script/module/overlay/_base_overlay.js', import.meta.url),
        'utf8'
    )
]);

function sourceBetween(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `시작 marker를 찾을 수 없습니다: ${startMarker}`);
    assert.ok(end > start, `종료 marker를 찾을 수 없습니다: ${endMarker}`);
    return source.slice(start, end);
}

test('설정 overlay는 닫힘·release가 끝난 뒤 benchmark scene을 시작한다', () => {
    const startSection = sourceBetween(
        settingsSource,
        'async #startBenchmarkScene()',
        '_buildLeftColumn(handler)'
    );
    assert.match(startSection, /this\.#benchmarkScenePending = true/);
    assert.match(
        startSection,
        /if \(this\.#benchmarkScenePending\) \{[\s\S]*?if \(!this\.lockInteractions\(\)\) \{[\s\S]*?this\.#benchmarkScenePending = true;[\s\S]*?await this\.#flushPendingPreview\(\)/
    );
    assert.match(startSection, /await this\.#flushPendingPreview\(\)/);
    assert.match(startSection, /this\.rollbackOnClose = false/);
    assert.match(startSection, /this\.close\(\)/);
    assert.doesNotMatch(startSection, /benchmarkStart/);

    const closeSection = sourceBetween(
        settingsSource,
        'onCloseComplete()',
        '\n    }\n}'
    );
    assert.match(
        closeSection,
        /if \(this\.#benchmarkScenePending\)[\s\S]*?Promise\.resolve\(\)\.then\(\(\) => titleScene\?\.benchmarkStart\?\.\(\)\);[\s\S]*?return;/
    );
    assert.match(
        baseOverlaySource,
        /this\.onCloseComplete\(\);[\s\S]*?this\.closeHandler\(this\);/
    );
});
