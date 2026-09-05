/**
 * 프로덕션 flow-field JS 원문과 WASM runtime의 end-to-end 비용을 비교합니다.
 *
 * 실행:
 *   node ../test/benchmark/enemy_ai_flow_field_wasm.bench.mjs
 *
 * 일반 테스트 glob 밖의 `.bench.mjs` 파일이므로 `npm test`에는 자동 포함되지 않습니다.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_ROOT = fileURLToPath(new URL('../../project/game/', import.meta.url));
const FLOW_FIELD_STORE_PATH = path.join(
    GAME_ROOT,
    'script',
    'module',
    'object',
    'enemy',
    'ai',
    'navigation',
    '_enemy_ai_flow_field_store.js'
);
const WASM_BYTES_PATH = path.join(
    GAME_ROOT,
    'script',
    'module',
    'object',
    'enemy',
    'ai',
    'wasm',
    '_enemy_ai_flow_field_wasm_bytes.js'
);
const WASM_RUNTIME_PATH = path.join(
    GAME_ROOT,
    'script',
    'module',
    'object',
    'enemy',
    'ai',
    'wasm',
    '_enemy_ai_flow_field_wasm_runtime.js'
);

const GRID_SIZES = Object.freeze([64, 128, 223]);
const WARMUP_ITERATIONS = 5;
const MEASURED_ITERATIONS = 15;
const RESULT_PLANES = Object.freeze(['integration', 'dirX', 'dirY']);

/**
 * 문자열 또는 바이트 입력의 SHA-256을 계산합니다.
 * @param {string|Uint8Array} value - 해시할 값입니다.
 * @returns {string} 소문자 16진수 SHA-256입니다.
 */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * 소스에서 두 고유 마커 사이의 원문을 추출합니다.
 * @param {string} source - 전체 소스입니다.
 * @param {string} startMarker - 포함할 시작 마커입니다.
 * @param {string} endMarker - 포함하지 않을 종료 마커입니다.
 * @returns {string} 추출된 코드입니다.
 */
function extractSourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) {
        throw new Error(`프로덕션 JS 원문 마커를 찾지 못했습니다: ${startMarker}`);
    }
    return source.slice(start, end);
}

/**
 * 프로덕션 buildFlowField와 heap helper 원문을 현재 realm의 Function으로 실행합니다.
 * @param {string} source - `_enemy_ai_flow_field_store.js` 원문입니다.
 * @returns {(grid:object,goalCell:object)=>object} JS 기준 구현입니다.
 */
function createSameRealmReferenceBuildFlowField(source) {
    const flowMathConstantsSource = extractSourceSection(
        source,
        'const EPSILON = ',
        '\nconst CLEARANCE_BUCKET_STEP'
    );
    const directionsSource = extractSourceSection(
        source,
        'const DIRS = Object.freeze([',
        '\n\nconst navGridCache'
    );
    const toIndexSource = extractSourceSection(
        source,
        'export const toIndex',
        '\n\n/**\n * 벽/그리드 설정'
    ).replace('export const toIndex', 'const toIndex');
    const isBlockedCellSource = extractSourceSection(
        source,
        'export const isBlockedCell',
        '\n\n/**\n * 가장 가까운 보행 가능 셀'
    ).replace('export const isBlockedCell', 'const isBlockedCell');
    const heapAndFieldSource = extractSourceSection(
        source,
        'function prepareFlowOpenHeap',
        '\n\n/**\n * 목표 좌표 기준 flow field'
    );
    const executableSource = `
        "use strict";
        ${flowMathConstantsSource}
        ${directionsSource}
        const flowOpenHeap = [];
        let flowOpenPositions = new Int32Array(0);
        ${toIndexSource}
        ${isBlockedCellSource}
        ${heapAndFieldSource}
        return buildFlowField;
    `;
    return new Function(executableSource)();
}

/**
 * 생성된 WASM 바이트 모듈 원문을 현재 realm에서 실행합니다.
 * @param {string} source - 생성된 바이트 모듈 원문입니다.
 * @returns {Uint8Array} 체크인된 WASM 바이트입니다.
 */
function createSameRealmWasmBytes(source) {
    const executableSource = source.replace(/^export const /gm, 'const ');
    return new Function(
        `"use strict";\n${executableSource}\nreturn ENEMY_AI_FLOW_FIELD_WASM_BYTES;`
    )();
}

/**
 * 프로덕션 WASM runtime 원문을 현재 realm에서 실행해 동기 runtime을 생성합니다.
 * @param {string} source - WASM runtime 모듈 원문입니다.
 * @param {Uint8Array} wasmBytes - 체크인된 WASM 바이트입니다.
 * @returns {{buildFlowField:(grid:object,goalCell:object)=>object}} WASM runtime입니다.
 */
function createSameRealmWasmRuntime(source, wasmBytes) {
    const executableSource = source
        .replace(/^import .*_enemy_ai_flow_field_wasm_bytes\.js';\r?\n/m, '')
        .replace(/^export /gm, '');
    const createRuntime = new Function(
        'ENEMY_AI_FLOW_FIELD_WASM_BYTES',
        `"use strict";\n${executableSource}\nreturn createEnemyAIFlowFieldWasmRuntimeSync;`
    )(wasmBytes);
    return createRuntime();
}

/**
 * 지정 크기의 빈 네비게이션 그리드를 생성합니다.
 * @param {number} cols - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @returns {{cols:number,rows:number,size:number,blocked:Uint8Array}} 그리드입니다.
 */
function createGrid(cols, rows) {
    const size = cols * rows;
    return { cols, rows, size, blocked: new Uint8Array(size) };
}

/**
 * xorshift32 기반 결정적 난수 생성기를 만듭니다.
 * @param {number} seed - 0이 아닌 32비트 seed입니다.
 * @returns {() => number} 0 이상 1 미만 난수 생성 함수입니다.
 */
function createDeterministicRandom(seed) {
    let state = seed >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

/**
 * 고정 seed로 약 20%의 셀을 차단한 그리드를 생성합니다.
 * @param {number} size - 한 변의 셀 수입니다.
 * @returns {{grid:object,goalCell:object}} 벤치마크 입력입니다.
 */
function createDeterministicRandomCase(size) {
    const grid = createGrid(size, size);
    const seed = (
        0xc1a0f13d
        ^ Math.imul(size, 0x9e3779b1)
        ^ Math.imul(size, 0x85ebca6b)
    ) >>> 0;
    const random = createDeterministicRandom(seed);
    for (let index = 0; index < grid.size; index++) {
        if (random() < 0.2) {
            grid.blocked[index] = random() < 0.5 ? 1 : 255;
        }
    }
    const goalCell = {
        cx: Math.floor(size * 0.5),
        cy: Math.floor(size * 0.5)
    };
    for (let cy = goalCell.cy - 1; cy <= goalCell.cy + 1; cy++) {
        const rowOffset = cy * size;
        for (let cx = goalCell.cx - 1; cx <= goalCell.cx + 1; cx++) {
            grid.blocked[rowOffset + cx] = 0;
        }
    }
    return { grid, goalCell };
}

/**
 * 위쪽 절반을 연속 차단해 정확히 floor(전체 셀/2)를 막은 구조적 입력을 만듭니다.
 * @param {number} size - 한 변의 셀 수입니다.
 * @returns {{grid:object,goalCell:object}} 벤치마크 입력입니다.
 */
function createStructuredHalfBlockedCase(size) {
    const grid = createGrid(size, size);
    grid.blocked.fill(1, 0, Math.floor(grid.size * 0.5));
    return {
        grid,
        goalCell: { cx: size - 1, cy: size - 1 }
    };
}

/**
 * 모든 벤치마크 입력을 고정 순서로 생성합니다.
 * @returns {Array<{label:string,grid:object,goalCell:object}>} 입력 목록입니다.
 */
function createBenchmarkCases() {
    const cases = [];
    for (const size of GRID_SIZES) {
        const openGrid = createGrid(size, size);
        cases.push({
            label: 'open',
            grid: openGrid,
            goalCell: { cx: size - 1, cy: size - 1 }
        });

        const randomCase = createDeterministicRandomCase(size);
        cases.push({ label: 'deterministic-20%', ...randomCase });

        const structuredCase = createStructuredHalfBlockedCase(size);
        cases.push({ label: 'structured-50%', ...structuredCase });
    }
    return cases;
}

/**
 * 한 함수를 고해상도 시계로 측정합니다.
 * @param {() => object} callback - 측정할 호출입니다.
 * @returns {{elapsedMs:number,result:object}} 경과 시간과 결과입니다.
 */
function measureCall(callback) {
    const start = process.hrtime.bigint();
    const result = callback();
    const end = process.hrtime.bigint();
    return {
        elapsedMs: Number(end - start) / 1e6,
        result
    };
}

/**
 * 두 flow-field 결과의 모든 출력 바이트가 같은지 검증합니다.
 * @param {string} label - 진단용 케이스 이름입니다.
 * @param {object} expected - JS 기준 결과입니다.
 * @param {object} actual - WASM 결과입니다.
 * @param {number|string} iteration - 반복 번호입니다.
 * @returns {void}
 */
function assertFlowFieldByteParity(label, expected, actual, iteration) {
    if (expected.goalIndex !== actual.goalIndex) {
        throw new Error(`${label} #${iteration}: goalIndex byte parity 실패`);
    }

    for (const plane of RESULT_PLANES) {
        const expectedView = expected[plane];
        const actualView = actual[plane];
        if (expectedView.byteLength !== actualView.byteLength) {
            throw new Error(`${label} #${iteration}: ${plane} byteLength 불일치`);
        }
        const expectedBytes = new Uint8Array(
            expectedView.buffer,
            expectedView.byteOffset,
            expectedView.byteLength
        );
        const actualBytes = new Uint8Array(
            actualView.buffer,
            actualView.byteOffset,
            actualView.byteLength
        );
        for (let byteIndex = 0; byteIndex < expectedBytes.length; byteIndex++) {
            if (expectedBytes[byteIndex] !== actualBytes[byteIndex]) {
                const cellIndex = Math.floor(byteIndex / Float32Array.BYTES_PER_ELEMENT);
                throw new Error(
                    `${label} #${iteration}: ${plane} 셀 ${cellIndex}, 바이트 ${byteIndex} 불일치`
                );
            }
        }
    }
}

/**
 * 샘플의 산술 평균을 계산합니다.
 * @param {number[]} samples - 밀리초 표본입니다.
 * @returns {number} 평균입니다.
 */
function calculateMean(samples) {
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

/**
 * 홀수 개 표본의 p50을 계산합니다.
 * @param {number[]} samples - 밀리초 표본입니다.
 * @returns {number} 중앙값입니다.
 */
function calculateP50(samples) {
    const sorted = [...samples].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length * 0.5)];
}

/**
 * 차단 배열의 non-zero 비율을 계산합니다.
 * @param {Uint8Array} blocked - 차단 평면입니다.
 * @returns {number} 0 이상 1 이하 차단 비율입니다.
 */
function calculateBlockedRatio(blocked) {
    let blockedCount = 0;
    for (let index = 0; index < blocked.length; index++) {
        if (blocked[index] !== 0) blockedCount++;
    }
    return blockedCount / blocked.length;
}

/**
 * 한 입력을 warmup한 뒤 JS/WASM 순서를 번갈아 반복 측정합니다.
 * 모든 timed pair는 측정 직후 byte parity를 검사합니다.
 * @param {object} benchmarkCase - 측정 입력입니다.
 * @param {Function} jsBuilder - 프로덕션 JS 원문 함수입니다.
 * @param {object} wasmRuntime - 프로덕션 WASM runtime입니다.
 * @returns {object} 통계 결과입니다.
 */
function runBenchmarkCase(benchmarkCase, jsBuilder, wasmRuntime) {
    const { label, grid, goalCell } = benchmarkCase;
    const caseLabel = `${grid.cols}x${grid.rows}/${label}`;

    for (let iteration = 0; iteration < WARMUP_ITERATIONS; iteration++) {
        const expected = jsBuilder(grid, goalCell);
        const actual = wasmRuntime.buildFlowField(grid, goalCell);
        assertFlowFieldByteParity(caseLabel, expected, actual, `warmup-${iteration + 1}`);
    }

    const jsSamples = [];
    const wasmSamples = [];
    for (let iteration = 0; iteration < MEASURED_ITERATIONS; iteration++) {
        let jsMeasurement;
        let wasmMeasurement;
        if ((iteration & 1) === 0) {
            jsMeasurement = measureCall(() => jsBuilder(grid, goalCell));
            wasmMeasurement = measureCall(() => wasmRuntime.buildFlowField(grid, goalCell));
        } else {
            wasmMeasurement = measureCall(() => wasmRuntime.buildFlowField(grid, goalCell));
            jsMeasurement = measureCall(() => jsBuilder(grid, goalCell));
        }
        assertFlowFieldByteParity(
            caseLabel,
            jsMeasurement.result,
            wasmMeasurement.result,
            iteration + 1
        );
        jsSamples.push(jsMeasurement.elapsedMs);
        wasmSamples.push(wasmMeasurement.elapsedMs);
    }

    const jsP50 = calculateP50(jsSamples);
    const jsMean = calculateMean(jsSamples);
    const wasmP50 = calculateP50(wasmSamples);
    const wasmMean = calculateMean(wasmSamples);
    return {
        grid: `${grid.cols}x${grid.rows}`,
        pattern: label,
        density: calculateBlockedRatio(grid.blocked),
        inputHash: sha256(grid.blocked).slice(0, 12),
        jsP50,
        jsMean,
        wasmP50,
        wasmMean,
        p50Speedup: jsP50 / wasmP50,
        meanSpeedup: jsMean / wasmMean
    };
}

/**
 * 벤치마크 결과를 고정 폭 표로 출력합니다.
 * @param {object[]} rows - 케이스별 통계입니다.
 * @returns {void}
 */
function printResults(rows) {
    const header = [
        'grid'.padEnd(9),
        'pattern'.padEnd(20),
        'blocked'.padStart(8),
        'input sha'.padEnd(12),
        'JS p50'.padStart(10),
        'JS mean'.padStart(10),
        'WASM p50'.padStart(10),
        'WASM mean'.padStart(10),
        'p50 speed'.padStart(10),
        'mean speed'.padStart(11)
    ].join('  ');
    console.log(header);
    console.log('-'.repeat(header.length));
    for (const row of rows) {
        console.log([
            row.grid.padEnd(9),
            row.pattern.padEnd(20),
            `${(row.density * 100).toFixed(2)}%`.padStart(8),
            row.inputHash.padEnd(12),
            `${row.jsP50.toFixed(3)} ms`.padStart(10),
            `${row.jsMean.toFixed(3)} ms`.padStart(10),
            `${row.wasmP50.toFixed(3)} ms`.padStart(10),
            `${row.wasmMean.toFixed(3)} ms`.padStart(10),
            `${row.p50Speedup.toFixed(2)}x`.padStart(10),
            `${row.meanSpeedup.toFixed(2)}x`.padStart(11)
        ].join('  '));
    }
}

const [flowFieldStoreSourceRaw, wasmBytesSource, wasmRuntimeSource] = (
    await Promise.all([
        readFile(FLOW_FIELD_STORE_PATH, 'utf8'),
        readFile(WASM_BYTES_PATH, 'utf8'),
        readFile(WASM_RUNTIME_PATH, 'utf8')
    ])
);
const flowFieldStoreSource = flowFieldStoreSourceRaw.replace(/\r\n/g, '\n');
const jsBuilder = createSameRealmReferenceBuildFlowField(flowFieldStoreSource);
const wasmBytes = createSameRealmWasmBytes(wasmBytesSource);
const wasmRuntime = createSameRealmWasmRuntime(wasmRuntimeSource, wasmBytes);

console.log('Enemy AI flow-field JS ↔ WASM benchmark');
console.log(`runtime: Node ${process.version}, V8 ${process.versions.v8}, ${process.platform}/${process.arch}`);
console.log(`warmup: ${WARMUP_ITERATIONS}, measured pairs: ${MEASURED_ITERATIONS} per case`);
console.log(`JS source sha256: ${sha256(flowFieldStoreSource)}`);
console.log(`WASM sha256:      ${sha256(wasmBytes)}`);
console.log('');

const results = createBenchmarkCases().map((benchmarkCase) => (
    runBenchmarkCase(benchmarkCase, jsBuilder, wasmRuntime)
));
printResults(results);
console.log('');
console.log(
    `byte parity 통과: ${results.length * MEASURED_ITERATIONS} measured pairs `
    + `(${results.length * MEASURED_ITERATIONS * 2} timed calls)`
);
