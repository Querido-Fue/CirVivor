import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../script/', import.meta.url));
const HUD_PATH = path.join(SCRIPT_ROOT, 'module', 'debug', '_release_simulation_profiler_hud.js');
const PROFILER_PATH = path.join(SCRIPT_ROOT, 'module', 'simulation', 'release_simulation_profiler.js');
const [hudSource, profilerSource] = await Promise.all([
    readFile(HUD_PATH, 'utf8'),
    readFile(PROFILER_PATH, 'utf8')
]);

const HUD_EXECUTABLE_SOURCE_HASH = '66289414ea265d70fdda7bf78da1d84d7c7a19436d7c1188fc3b0a230648c3cb';
const PROFILER_EXECUTABLE_SOURCE_HASH = '2851f8a00e77906269ec67d3bce7f268de65af0f00b15af934d18887b82f3a4e';

/**
 * 독립된 줄의 JSDoc을 제거한 production 실행 소스를 해시합니다.
 * @param {string} source - production 소스입니다.
 * @param {number} expectedJsDocCount - 예상 JSDoc 블록 수입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(source, expectedJsDocCount) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(allJsDocStarts.length, expectedJsDocCount, 'production JSDoc 개수가 바뀌었습니다.');
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    const executableSource = source
        .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞의 JSDoc 본문을 반환합니다.
 * @param {string} source - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(source, escapedDeclaration) {
    const match = source.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

test('release simulation profiler 구현 상수는 전용 코드 모듈을 사용한다', () => {
    assert.equal(hashExecutableSource(hudSource, 5), HUD_EXECUTABLE_SOURCE_HASH);
    assert.equal(hashExecutableSource(profilerSource, 29), PROFILER_EXECUTABLE_SOURCE_HASH);
    assert.doesNotMatch(hudSource, /data\/data_handler\.js/);
    assert.doesNotMatch(profilerSource, /data\/data_handler\.js/);
    assert.match(hudSource, /RELEASE_SIMULATION_PROFILER_CONSTANTS/);
    assert.match(hudSource, /const HUD_CONSTANTS = RELEASE_SIMULATION_PROFILER_CONSTANTS\.HUD;/);
    assert.match(profilerSource, /RELEASE_SIMULATION_PROFILER_CONSTANTS/);
});

test('ReleaseSimulationProfiler constructor JSDoc은 실제 option 속성을 명시한다', () => {
    const constructorDoc = findLeadingJsDoc(profilerSource, 'constructor\\(options = \\{\\}\\)');
    for (const propertyName of [
        'frameCapacity',
        'fixedCapacity',
        'rateWindowMs',
        'quantileWindowMs',
        'snapshotIntervalMs'
    ]) {
        assert.match(constructorDoc, new RegExp(`@param \\{number\\} \\[options\\.${propertyName}\\]`));
    }
});

test('profiler와 HUD의 void 함수 JSDoc은 반환값이 없음을 명시한다', () => {
    const voidDeclarations = [
        [hudSource, 'export function drawReleaseSimulationProfilerHud\\(\\)'],
        [hudSource, 'function updateHudCommands\\(snapshot, ww, wh\\)'],
        [profilerSource, 'reset\\(timestampMs = 0\\)'],
        [profilerSource, 'suspend\\(\\)'],
        [profilerSource, 'resume\\(timestampMs = 0\\)'],
        [profilerSource, 'recordFixedStep\\(timestampMs, durationMs, completed\\)'],
        [profilerSource, 'recordFrame\\(\\s*timestampMs,[\\s\\S]*?cpuBound\\s*\\)'],
        [profilerSource, '#publishSnapshot\\(timestampMs\\)'],
        [profilerSource, '#resetSnapshot\\(\\)'],
        [profilerSource, 'export function suspendReleaseSimulationProfiler\\(\\)'],
        [profilerSource, 'export function resumeReleaseSimulationProfiler\\(timestampMs = performance\\.now\\(\\)\\)'],
        [profilerSource, 'export function recordReleaseSimulationFixedStep\\(timestampMs, durationMs, completed\\)'],
        [profilerSource, 'export function recordReleaseSimulationFrame\\(\\s*timestampMs,[\\s\\S]*?cpuBound\\s*\\)'],
        [profilerSource, 'function sortScratch\\(scratch, count\\)']
    ];

    for (const [source, declaration] of voidDeclarations) {
        assert.match(findLeadingJsDoc(source, declaration), /@returns \{void\}/);
    }
});
