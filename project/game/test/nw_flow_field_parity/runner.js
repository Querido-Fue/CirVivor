import { ENEMY_AI_CONSTANTS } from '../../script/data/object/enemy/enemy_ai_constants.js';
import { createEnemyAIFlowFieldWasmRuntimeSync } from '../../script/module/object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_runtime.js';

const statusElement = document.querySelector('#status');
const navigationUrl = new URL(
    '../../script/module/object/enemy/ai/_enemy_ai_navigation.js',
    import.meta.url
);
const backendUrl = new URL(
    '../../script/module/object/enemy/ai/wasm/_enemy_ai_flow_field_backend.js',
    import.meta.url
);

/**
 * 소스의 두 고유 마커 사이 구간을 추출합니다.
 * @param {string} source - 전체 소스입니다.
 * @param {string} startMarker - 포함할 시작 마커입니다.
 * @param {string} endMarker - 포함하지 않을 종료 마커입니다.
 * @returns {string} 추출된 구간입니다.
 */
function extractSourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) throw new Error(`기준 구현 마커 누락: ${startMarker}`);
    return source.slice(start, end);
}

/**
 * 현재 프로덕션 JS 원문으로 브라우저 realm 기준 구현을 만듭니다.
 * @param {string} source - navigation 전체 소스입니다.
 * @returns {(grid:object,goalCell:object)=>object} 기준 구현입니다.
 */
function createReferenceBuildFlowField(source) {
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
    return Function('constants', `
        "use strict";
        const EPSILON = constants.EPSILON;
        const INF = constants.INF;
        const DIAGONAL_COST = constants.DIAGONAL_COST;
        ${directionsSource}
        const flowOpenHeap = [];
        let flowOpenPositions = new Int32Array(0);
        ${toIndexSource}
        ${isBlockedCellSource}
        ${heapAndFieldSource}
        return buildFlowField;
    `)(ENEMY_AI_CONSTANTS);
}

/**
 * 직접 제어 가능한 그리드를 생성합니다.
 * @param {number} cols - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @returns {{cols:number,rows:number,size:number,blocked:Uint8Array}} 그리드입니다.
 */
function createGrid(cols, rows) {
    return { cols, rows, size: cols * rows, blocked: new Uint8Array(cols * rows) };
}

/**
 * 실제 게임 크기 성능 검사용 결정적 차단 패턴을 만듭니다.
 * @param {number} cols - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @param {number} seed - xorshift32 seed입니다.
 * @returns {{grid:object,goalCell:object,blockedRatio:number}} 입력입니다.
 */
function createBenchmarkInput(cols, rows, seed) {
    const grid = createGrid(cols, rows);
    let state = seed >>> 0;
    let blockedCount = 0;
    for (let index = 0; index < grid.size; index++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const blocked = (state >>> 0) % 100 < 20;
        grid.blocked[index] = blocked ? 255 : 0;
        if (blocked) blockedCount++;
    }
    const goalCell = { cx: cols - 2, cy: rows - 2 };
    const goalIndex = (goalCell.cy * cols) + goalCell.cx;
    if (grid.blocked[goalIndex]) {
        grid.blocked[goalIndex] = 0;
        blockedCount--;
    }
    return { grid, goalCell, blockedRatio: blockedCount / grid.size };
}

/**
 * 숫자 배열의 중앙값을 반환합니다.
 * @param {number[]} values - 측정값입니다.
 * @returns {number} 중앙값입니다.
 */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 동기 builder를 여러 번 호출하고 호출당 시간을 반환합니다.
 * @param {Function} builder - 측정할 함수입니다.
 * @param {object} grid - 입력 grid입니다.
 * @param {object} goalCell - 목표 셀입니다.
 * @param {number} iterations - sample 내부 반복 횟수입니다.
 * @returns {{milliseconds:number,result:object}} 시간과 마지막 결과입니다.
 */
function measureBuilder(builder, grid, goalCell, iterations) {
    const startedAt = performance.now();
    let result = null;
    for (let iteration = 0; iteration < iterations; iteration++) {
        result = builder(grid, goalCell);
    }
    return {
        milliseconds: (performance.now() - startedAt) / iterations,
        result
    };
}

/**
 * 같은 realm의 production JS와 backend를 교차 순서로 측정합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {object} input - grid, goalCell, blockedRatio입니다.
 * @param {Function} referenceBuild - 프로덕션 JS 원문 builder입니다.
 * @param {Function} backendBuild - 프로덕션 backend builder입니다.
 * @param {number} iterations - sample 내부 반복 횟수입니다.
 * @returns {{label:string,blockedRatio:number,jsP50:number,wasmP50:number,speedup:number}} 결과입니다.
 */
function benchmarkBackend(label, input, referenceBuild, backendBuild, iterations) {
    const warmupCount = 8;
    const sampleCount = 31;
    for (let warmup = 0; warmup < warmupCount; warmup++) {
        assertByteParity(
            `${label}-warmup-${warmup}`,
            referenceBuild(input.grid, input.goalCell),
            backendBuild(input.grid, input.goalCell)
        );
    }

    const jsSamples = [];
    const wasmSamples = [];
    for (let sample = 0; sample < sampleCount; sample++) {
        let jsMeasurement;
        let wasmMeasurement;
        if ((sample & 1) === 0) {
            jsMeasurement = measureBuilder(
                referenceBuild,
                input.grid,
                input.goalCell,
                iterations
            );
            wasmMeasurement = measureBuilder(
                backendBuild,
                input.grid,
                input.goalCell,
                iterations
            );
        } else {
            wasmMeasurement = measureBuilder(
                backendBuild,
                input.grid,
                input.goalCell,
                iterations
            );
            jsMeasurement = measureBuilder(
                referenceBuild,
                input.grid,
                input.goalCell,
                iterations
            );
        }
        assertByteParity(
            `${label}-sample-${sample}`,
            jsMeasurement.result,
            wasmMeasurement.result
        );
        jsSamples.push(jsMeasurement.milliseconds);
        wasmSamples.push(wasmMeasurement.milliseconds);
    }

    const jsP50 = median(jsSamples);
    const wasmP50 = median(wasmSamples);
    return {
        label,
        blockedRatio: input.blockedRatio,
        jsP50,
        wasmP50,
        speedup: jsP50 / wasmP50
    };
}

/**
 * 두 flow field를 모든 Float32 원시 바이트로 비교합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {object} expected - JS 결과입니다.
 * @param {object} actual - WASM 결과입니다.
 * @returns {void}
 */
function assertByteParity(label, expected, actual) {
    if (expected.goalIndex !== actual.goalIndex) {
        throw new Error(`${label}: goalIndex 불일치`);
    }
    for (const plane of ['integration', 'dirX', 'dirY']) {
        const expectedBytes = new Uint8Array(expected[plane].buffer);
        const actualBytes = new Uint8Array(actual[plane].buffer);
        if (expectedBytes.length !== actualBytes.length) {
            throw new Error(`${label}: ${plane} 길이 불일치`);
        }
        for (let i = 0; i < expectedBytes.length; i++) {
            if (expectedBytes[i] !== actualBytes[i]) {
                throw new Error(`${label}: ${plane} ${i}번 바이트 불일치`);
            }
        }
    }
}

/**
 * 브라우저가 진행 상태를 그릴 기회를 한 번 제공합니다.
 * @returns {Promise<void>} 다음 animation frame 완료 Promise입니다.
 */
function yieldFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function run() {
    const response = await fetch(navigationUrl);
    if (!response.ok) throw new Error(`navigation 원문 로드 실패: ${response.status}`);
    const source = (await response.text()).replace(/\r\n/g, '\n');
    const referenceBuild = createReferenceBuildFlowField(source);
    const runtimeInitStartedAt = performance.now();
    const wasmRuntime = createEnemyAIFlowFieldWasmRuntimeSync();
    const runtimeInitMilliseconds = performance.now() - runtimeInitStartedAt;
    let caseCount = 0;

    const backendModule = await import(backendUrl.href);
    const backendBuild = (grid, goalCell) => backendModule.buildEnemyAIFlowField(
        grid,
        goalCell,
        referenceBuild
    );
    const initialBackendStatus = backendModule.getEnemyAIFlowFieldBackendStatus();
    if (initialBackendStatus.state !== 'wasm-ready') {
        throw new Error(`production backend 준비 실패: ${JSON.stringify(initialBackendStatus)}`);
    }

    const belowThresholdInput = createBenchmarkInput(31, 33, 0x07190001);
    const beforeBelowThreshold = backendModule.getEnemyAIFlowFieldBackendStatus();
    assertByteParity(
        'production-backend-1023-cells',
        referenceBuild(belowThresholdInput.grid, belowThresholdInput.goalCell),
        backendBuild(belowThresholdInput.grid, belowThresholdInput.goalCell)
    );
    const afterBelowThreshold = backendModule.getEnemyAIFlowFieldBackendStatus();
    if (
        afterBelowThreshold.jsBuildCount !== beforeBelowThreshold.jsBuildCount + 1
        || afterBelowThreshold.wasmBuildCount !== beforeBelowThreshold.wasmBuildCount
    ) {
        throw new Error('1,023셀 production backend가 JS 경로를 사용하지 않았습니다.');
    }

    const thresholdInput = createBenchmarkInput(32, 32, 0x07190002);
    const beforeThreshold = backendModule.getEnemyAIFlowFieldBackendStatus();
    const coldThresholdStartedAt = performance.now();
    const coldThresholdActual = backendBuild(thresholdInput.grid, thresholdInput.goalCell);
    const coldThresholdMilliseconds = performance.now() - coldThresholdStartedAt;
    assertByteParity(
        'production-backend-1024-cells',
        referenceBuild(thresholdInput.grid, thresholdInput.goalCell),
        coldThresholdActual
    );
    const afterThreshold = backendModule.getEnemyAIFlowFieldBackendStatus();
    if (
        afterThreshold.wasmBuildCount !== beforeThreshold.wasmBuildCount + 1
        || afterThreshold.jsBuildCount !== beforeThreshold.jsBuildCount
    ) {
        throw new Error('1,024셀 production backend가 WASM 경로를 사용하지 않았습니다.');
    }

    const gameSizeInput = createBenchmarkInput(80, 45, 0x07190003);
    const coldGameSizeStartedAt = performance.now();
    const coldGameSizeActual = backendBuild(gameSizeInput.grid, gameSizeInput.goalCell);
    const coldGameSizeMilliseconds = performance.now() - coldGameSizeStartedAt;
    assertByteParity(
        'production-backend-80x45-first-grow',
        referenceBuild(gameSizeInput.grid, gameSizeInput.goalCell),
        coldGameSizeActual
    );

    const benchmarkResults = [
        benchmarkBackend('32×32 threshold', thresholdInput, referenceBuild, backendBuild, 8),
        benchmarkBackend('80×45 game', gameSizeInput, referenceBuild, backendBuild, 4)
    ];
    for (const result of benchmarkResults) {
        if (result.speedup < 1) {
            throw new Error(
                `${result.label}: NW.js p50에서 WASM이 JS보다 느립니다 (${result.speedup.toFixed(2)}x).`
            );
        }
    }

    for (let mask = 0; mask < 512; mask++) {
        const grid = createGrid(3, 3);
        for (let index = 0; index < grid.size; index++) {
            grid.blocked[index] = (mask >>> index) & 1 ? 255 : 0;
        }
        for (let goalIndex = 0; goalIndex < grid.size; goalIndex++) {
            const goalCell = { cx: goalIndex % 3, cy: Math.floor(goalIndex / 3) };
            assertByteParity(
                `3x3-mask-${mask}-goal-${goalIndex}`,
                referenceBuild(grid, goalCell),
                wasmRuntime.buildFlowField(grid, goalCell)
            );
            caseCount++;
        }
        if ((mask & 63) === 63) {
            statusElement.textContent = `3×3 전수 검사 ${mask + 1}/512 mask…`;
            await yieldFrame();
        }
    }

    const largeGrid = createGrid(257, 193);
    for (let cx = 13, stripe = 0; cx < largeGrid.cols - 1; cx += 19, stripe++) {
        const gapStart = (stripe * 37) % (largeGrid.rows - 3);
        for (let cy = 0; cy < largeGrid.rows; cy++) {
            if (cy >= gapStart && cy <= gapStart + 2) continue;
            largeGrid.blocked[(cy * largeGrid.cols) + cx] = stripe % 2 === 0 ? 1 : 255;
        }
    }
    assertByteParity(
        'large-striped',
        referenceBuild(largeGrid, { cx: 256, cy: 192 }),
        wasmRuntime.buildFlowField(largeGrid, { cx: 256, cy: 192 })
    );
    caseCount++;

    document.title = 'PASS — Flow-field NW.js parity';
    statusElement.className = 'pass';
    statusElement.textContent = [
        'PASS',
        `동일성 케이스: ${caseCount.toLocaleString('en-US')}`,
        '비교 단위: integration / dirX / dirY 전체 원시 바이트 + goalIndex',
        'production dispatch: 1,023셀→JS / 1,024셀→WASM / 80×45 first growth exact',
        `WASM init: ${runtimeInitMilliseconds.toFixed(3)}ms, cold 32×32: ${coldThresholdMilliseconds.toFixed(3)}ms, cold 80×45: ${coldGameSizeMilliseconds.toFixed(3)}ms`,
        ...benchmarkResults.map((result) => (
            `${result.label} (${(result.blockedRatio * 100).toFixed(1)}% blocked): `
            + `JS ${result.jsP50.toFixed(3)}ms / WASM ${result.wasmP50.toFixed(3)}ms / ${result.speedup.toFixed(2)}x`
        )),
        `엔진: ${navigator.userAgent}`
    ].join('\n');
}

run().catch((error) => {
    document.title = 'FAIL — Flow-field NW.js parity';
    statusElement.className = 'fail';
    statusElement.textContent = `FAIL\n${error?.stack ?? error}`;
});
