import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const POLICY_PATH = fileURLToPath(new URL(
    '../script/module/simulation/fixed_step_catch_up_policy.js',
    import.meta.url
));
const TITLE_SEGMENTS_PATH = fileURLToPath(new URL(
    '../script/module/scene/title/loading/_title_scene_transition_segments.js',
    import.meta.url
));
const OVERLAY_GEOMETRY_PATH = fileURLToPath(new URL(
    '../script/module/display/webgl/_overlay_render_geometry.js',
    import.meta.url
));
const [policySource, titleSegmentsSource, overlayGeometrySource] = await Promise.all([
    readFile(POLICY_PATH, 'utf8'),
    readFile(TITLE_SEGMENTS_PATH, 'utf8'),
    readFile(OVERLAY_GEOMETRY_PATH, 'utf8')
]);

function hashExecutableSource(source, expectedJsDocCount) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(allJsDocStarts.length, expectedJsDocCount);
    assert.equal(standaloneJsDocStarts.length, allJsDocStarts.length);
    const executableSource = source
        .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

function findLeadingJsDoc(source, declaration) {
    const match = source.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${declaration}`)
    );
    assert.ok(match, `${declaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

test('scheduler·title transition·overlay geometry JSDoc은 실행문과 관찰 계약을 고정한다', () => {
    assert.equal(
        hashExecutableSource(policySource, 8),
        '1dfec38e00eabfee4571745d0fd9e2a6dda377ad13d3134ab691a72f48a4d37e'
    );
    assert.equal(
        hashExecutableSource(titleSegmentsSource, 1),
        'aac5d9180d417fe6c9798284fa65fe02d6ca55efc15a2f251c3c3c43699f2414'
    );
    assert.equal(
        hashExecutableSource(overlayGeometrySource, 2),
        'a9434807367ca50ccdcf59f87ebf144a07880ca70978f59a5a4094599a2c3fcc'
    );

    const maxStepsDoc = findLeadingJsDoc(
        policySource,
        'resolveMaxSteps\\(previousFrameCpuSeconds, frameIntervalSeconds, fixedStepSeconds\\)'
    );
    assert.match(maxStepsDoc, /문자열·객체를 숫자로 강제 변환하지 않습니다/);
    assert.match(maxStepsDoc, /fixed step과 안전한 frame 간격 중 큰 값/);
    assert.match(maxStepsDoc, /연속 `recoveryFrames`회일 때만/);
    assert.match(maxStepsDoc, /여유 프레임 수만 0으로/);

    const wholeStepsDoc = findLeadingJsDoc(
        policySource,
        'export function countWholeFixedSteps\\(accumulatorSeconds, fixedStepSeconds\\)'
    );
    assert.match(wholeStepsDoc, /문자열·객체를 숫자로 강제 변환하지 않습니다/);

    const titleSegmentsDoc = findLeadingJsDoc(
        titleSegmentsSource,
        'export function buildTitleSceneTransitionSegments\\(\\{ startValue, endValue, motion \\}\\)'
    );
    assert.match(titleSegmentsDoc, /canonical `easeInExpo → linear → easeOutExpo`/);
    assert.match(titleSegmentsDoc, /경계 속도 연속성은 보장하지 않습니다/);
    assert.match(titleSegmentsDoc, /호출마다 새로 생성/);
    assert.match(titleSegmentsDoc, /공유하거나 동결하지 않습니다/);

    const surfaceStylesDoc = findLeadingJsDoc(
        overlayGeometrySource,
        'export function resolveOverlayContentSurfaceStyles\\('
    );
    assert.match(surfaceStylesDoc, /문자열·객체를 강제 변환하지 않습니다/);
    assert.match(
        surfaceStylesDoc,
        /`transformOrigin → uiTransform → effectTransform → uiFilter → effectFilter` 순서/
    );

    const textureRectDoc = findLeadingJsDoc(
        overlayGeometrySource,
        'export function resolveOverlayEffectTextureRect\\(panelRect, effectTextureRect, out = null\\)'
    );
    assert.match(textureRectDoc, /`Number\(\)`로 강제 변환/);
    assert.match(textureRectDoc, /최소 1px인 전체 패널 영역/);
    assert.match(textureRectDoc, /X\/Y를 읽지 않고/);
    assert.match(textureRectDoc, /`x → y → w → h` 순서/);
    assert.match(textureRectDoc, /앞선 기록은 되돌리지 않습니다/);
});
