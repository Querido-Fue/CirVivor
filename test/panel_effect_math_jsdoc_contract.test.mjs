import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PANEL_EFFECT_MATH_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/overlay/_panel_effect_math.js',
    import.meta.url
));
const panelEffectMathSource = await readFile(PANEL_EFFECT_MATH_SOURCE_PATH, 'utf8');
const EXECUTABLE_SOURCE_HASH = '0df8166ca45b39ea9d27b6d690cea8c8756ebedf638e95ea14ec9b4de40a3a1c';

function hashExecutableSource(productionSource) {
    const allJsDocStarts = productionSource.match(/\/\*\*/gu) ?? [];
    const standaloneJsDocStarts = productionSource.match(/^[ \t]*\/\*\*/gmu) ?? [];
    assert.equal(standaloneJsDocStarts.length, allJsDocStarts.length);
    assert.equal(standaloneJsDocStarts.length, 13);
    return createHash('sha256')
        .update(productionSource.replace(/\/\*\*[\s\S]*?\*\//gu, '').replace(/\r\n/gu, '\n'))
        .digest('hex');
}

function findLeadingJsDoc(productionSource, escapedDeclaration) {
    const match = productionSource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`, 'u')
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

test('panel effect math 실행 소스는 JSDoc 정정 전과 exact 동일하다', () => {
    assert.equal(hashExecutableSource(panelEffectMathSource), EXECUTABLE_SOURCE_HASH);
});

test('projection·homography JSDoc은 fresh identity와 live 배열 복제 계약을 명시한다', () => {
    const projectJsDoc = findLeadingJsDoc(
        panelEffectMathSource,
        'export function projectPanelQuad\\(panelRect, transformMatrix, perspective\\)'
    );
    assert.match(projectJsDoc, /x→w→y→h와 네 w→h 쌍/u);
    assert.match(projectJsDoc, /live `Array\.prototype\.map`/u);
    assert.match(projectJsDoc, /입력은 변경하지 않습니다/u);
    assert.match(projectJsDoc, /호출마다 새로 생성한/u);

    const homographyJsDoc = findLeadingJsDoc(
        panelEffectMathSource,
        'export function createRectToQuadHomography\\(width, height, quad\\)'
    );
    assert.match(homographyJsDoc, /fresh 계수 행렬/u);
    assert.match(homographyJsDoc, /입력 quad는 변경하지 않습니다/u);
    assert.match(homographyJsDoc, /각 row의 `Symbol\.iterator`/u);
    assert.match(homographyJsDoc, /fresh 3x3 호모그래피/u);

    const solverJsDoc = findLeadingJsDoc(
        panelEffectMathSource,
        'function solveLinearSystem\\(matrix, values\\)'
    );
    assert.match(solverJsDoc, /live `matrix\.map\(\)`/u);
    assert.match(solverJsDoc, /matrix, row, values는 변경하지 않습니다/u);
    assert.match(solverJsDoc, /fresh 해 벡터/u);

    assert.match(panelEffectMathSource, /const\s+corners\s*=\s*\[/u);
    assert.match(panelEffectMathSource, /return\s+corners\.map/u);
    assert.match(panelEffectMathSource, /matrix\.map\(\(row, index\)\s*=>\s*\[\.\.\.row, values\[index\]\]\)/u);
});
