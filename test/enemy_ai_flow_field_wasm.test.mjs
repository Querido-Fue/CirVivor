/**
 * 현재 `_enemy_ai_flow_field_store.js`의 buildFlowField 원문과 WASM 커널의 Float32 결과를
 * 정상·차단·대각선 모서리·도달 불가·소형 전수·장축·대형·결정적 난수·목표 경계 조건에서
 * 바이트 단위로 검증합니다.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { loadGameModule } from './support/source_module_loader.mjs';

const GAME_ROOT = fileURLToPath(new URL('../project/game/', import.meta.url));
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
const WAT_PATH = path.join(
    GAME_ROOT,
    'script',
    'module',
    'object',
    'enemy',
    'ai',
    'wasm',
    '_enemy_ai_flow_field.wat'
);
const BUILD_SCRIPT_PATH = fileURLToPath(new URL(
    './support/build_enemy_ai_flow_field_wasm.mjs', import.meta.url
));

const runtimeModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_runtime.js'
);
const bytesModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_bytes.js'
);
const wasmRuntime = await runtimeModule.createEnemyAIFlowFieldWasmRuntime();
const flowFieldStoreSource = (
    await readFile(FLOW_FIELD_STORE_PATH, 'utf8')
).replace(/\r\n/g, '\n');

/**
 * 소스에서 두 고유 마커 사이의 코드 구간을 추출합니다.
 * @param {string} source - 전체 소스입니다.
 * @param {string} startMarker - 포함할 시작 마커입니다.
 * @param {string} endMarker - 포함하지 않을 종료 마커입니다.
 * @returns {string} 추출된 코드 구간입니다.
 */
function extractSourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `기준 구현 시작 마커를 찾지 못했습니다: ${startMarker}`);
    assert.notEqual(end, -1, `기준 구현 종료 마커를 찾지 못했습니다: ${endMarker}`);
    return source.slice(start, end);
}

/**
 * 프로덕션 파일의 실제 buildFlowField와 heap helper 원문을 격리 실행합니다.
 * @param {string} source - `_enemy_ai_flow_field_store.js` 전체 소스입니다.
 * @returns {{build:(grid:object,goalCell:object)=>object,buildWithHeapStats:(grid:object,goalCell:object)=>{result:object,stats:{tieComparisons:number,decreaseCalls:number}},inf:number}} JS 기준 buildFlowField와 heap 계측 진입점입니다.
 */
function createReferenceBuildFlowField(source) {
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
    const instrumentedHeapAndFieldSource = heapAndFieldSource
        .replace(
            '    const rightCost = integration[rightIndex];',
            `    const rightCost = integration[rightIndex];
    if (leftIndex !== rightIndex && leftCost === rightCost) {
        flowHeapStats.tieComparisons++;
    }`
        )
        .replace(
            `function decreaseFlowHeapNode(heap, positions, integration, cellIndex) {
    let position = positions[cellIndex];`,
            `function decreaseFlowHeapNode(heap, positions, integration, cellIndex) {
    flowHeapStats.decreaseCalls++;
    let position = positions[cellIndex];`
        );
    assert.match(
        instrumentedHeapAndFieldSource,
        /flowHeapStats\.tieComparisons\+\+/,
        'heap 동률 계측 코드를 기준 구현에 주입하지 못했습니다.'
    );
    assert.match(
        instrumentedHeapAndFieldSource,
        /flowHeapStats\.decreaseCalls\+\+/,
        'heap decrease-key 계측 코드를 기준 구현에 주입하지 못했습니다.'
    );
    const isolatedSource = `
        ${flowMathConstantsSource}
        ${directionsSource}
        const flowOpenHeap = [];
        let flowOpenPositions = new Int32Array(0);
        const flowHeapStats = { tieComparisons: 0, decreaseCalls: 0 };
        ${toIndexSource}
        ${isBlockedCellSource}
        ${instrumentedHeapAndFieldSource}
        globalThis.__referenceBuildFlowField = buildFlowField;
        globalThis.__referenceBuildFlowFieldWithHeapStats = (grid, goalCell) => {
            flowHeapStats.tieComparisons = 0;
            flowHeapStats.decreaseCalls = 0;
            const result = buildFlowField(grid, goalCell);
            return {
                result,
                stats: {
                    tieComparisons: flowHeapStats.tieComparisons,
                    decreaseCalls: flowHeapStats.decreaseCalls
                }
            };
        };
    `;
    const context = vm.createContext({});
    vm.runInContext(isolatedSource, context, {
        filename: '_enemy_ai_flow_field_store.build_flow_field.reference.js'
    });
    return {
        build: context.__referenceBuildFlowField,
        buildWithHeapStats: context.__referenceBuildFlowFieldWithHeapStats,
        inf: vm.runInContext('INF', context)
    };
}

const {
    build: referenceBuildFlowField,
    buildWithHeapStats: referenceBuildFlowFieldWithHeapStats,
    inf: referenceFlowFieldInf
} = createReferenceBuildFlowField(flowFieldStoreSource);

/**
 * 지정 크기의 직접 제어 가능한 네비게이션 그리드를 생성합니다.
 * @param {number} cols - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @returns {{cols:number,rows:number,size:number,blocked:Uint8Array}} 그리드입니다.
 */
function createGrid(cols, rows) {
    const size = cols * rows;
    return { cols, rows, size, blocked: new Uint8Array(size) };
}

/**
 * 그리드 셀을 지정한 non-zero 바이트로 차단합니다.
 * @param {{cols:number,blocked:Uint8Array}} grid - 대상 그리드입니다.
 * @param {number} cx - 셀 X입니다.
 * @param {number} cy - 셀 Y입니다.
 * @param {number} [value=1] - 기록할 차단 바이트입니다.
 * @returns {void}
 */
function blockCell(grid, cx, cy, value = 1) {
    grid.blocked[(cy * grid.cols) + cx] = value;
}

/**
 * typed array의 원시 바이트를 복사해 Node Buffer로 변환합니다.
 * @param {ArrayBufferView} view - 변환할 typed array입니다.
 * @returns {Buffer} 원시 바이트 복사본입니다.
 */
function toByteBuffer(view) {
    return Buffer.from(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

/**
 * 두 typed array에서 처음 다른 바이트 위치를 반환합니다.
 * @param {ArrayBufferView} expected - JS 기준 배열입니다.
 * @param {ArrayBufferView} actual - WASM 결과 배열입니다.
 * @returns {number} 첫 불일치 바이트 위치이며 같으면 -1입니다.
 */
function findFirstByteMismatch(expected, actual) {
    const expectedBytes = new Uint8Array(
        expected.buffer,
        expected.byteOffset,
        expected.byteLength
    );
    const actualBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    const length = Math.min(expectedBytes.length, actualBytes.length);
    for (let i = 0; i < length; i++) {
        if (expectedBytes[i] !== actualBytes[i]) return i;
    }
    return expectedBytes.length === actualBytes.length ? -1 : length;
}

/**
 * flow field의 모든 Float32 평면과 목표 인덱스가 완전히 같은지 검사합니다.
 * @param {string} label - 실패 진단용 케이스 이름입니다.
 * @param {object} expected - JS 기준 결과입니다.
 * @param {object} actual - WASM 결과입니다.
 * @returns {void}
 */
function assertFlowFieldByteParity(label, expected, actual) {
    assert.equal(actual.goalIndex, expected.goalIndex, `${label}: goalIndex 불일치`);
    for (const plane of ['integration', 'dirX', 'dirY']) {
        assert.equal(
            actual[plane].length,
            expected[plane].length,
            `${label}: ${plane} 길이 불일치`
        );
        const mismatch = findFirstByteMismatch(expected[plane], actual[plane]);
        if (mismatch >= 0) {
            const cellIndex = Math.floor(mismatch / Float32Array.BYTES_PER_ELEMENT);
            assert.fail(
                `${label}: ${plane}의 ${mismatch}번 바이트(셀 ${cellIndex})가 다릅니다. `
                + `JS=${toByteBuffer(expected[plane]).subarray(mismatch, mismatch + 4).toString('hex')} `
                + `WASM=${toByteBuffer(actual[plane]).subarray(mismatch, mismatch + 4).toString('hex')}`
            );
        }
    }
}

/**
 * 한 입력을 프로덕션 JS 원문과 WASM에 각각 실행해 byte parity를 검사합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {object} grid - 네비게이션 그리드입니다.
 * @param {{cx:number,cy:number}} goalCell - 목표 셀입니다.
 * @returns {{expected:object,actual:object}} 두 실행 결과입니다.
 */
function runParityCase(label, grid, goalCell) {
    const expected = referenceBuildFlowField(grid, goalCell);
    const actual = wasmRuntime.buildFlowField(grid, goalCell);
    assertFlowFieldByteParity(label, expected, actual);
    return { expected, actual };
}

/**
 * 한 입력에서 JS heap 동작을 계측하면서 WASM byte parity도 함께 검사합니다.
 * @param {string} label - 케이스 이름입니다.
 * @param {object} grid - 네비게이션 그리드입니다.
 * @param {{cx:number,cy:number}} goalCell - 목표 셀입니다.
 * @returns {{result:object,stats:{tieComparisons:number,decreaseCalls:number}}} JS 결과와 heap 계측값입니다.
 */
function runHeapInstrumentedParityCase(label, grid, goalCell) {
    const measured = referenceBuildFlowFieldWithHeapStats(grid, goalCell);
    const actual = wasmRuntime.buildFlowField(grid, goalCell);
    assertFlowFieldByteParity(label, measured.result, actual);
    return measured;
}

/**
 * xorshift32 기반 결정적 난수 생성기를 만듭니다.
 * @param {number} seed - 0이 아닌 32비트 seed입니다.
 * @returns {() => number} 0 이상 1 미만 난수 생성 함수입니다.
 */
function createDeterministicRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 0x100000000;
    };
}

/**
 * 대형 경로 탐색과 unreachable 영역을 함께 포함하는 줄무늬 그리드를 만듭니다.
 * @param {number} cols - 열 수입니다.
 * @param {number} rows - 행 수입니다.
 * @returns {{cols:number,rows:number,size:number,blocked:Uint8Array}} 대형 그리드입니다.
 */
function createLargeStripedGrid(cols, rows) {
    const grid = createGrid(cols, rows);
    let stripe = 0;
    for (let cx = 13; cx < cols - 1; cx += 19) {
        const gapStart = (stripe * 37) % Math.max(1, rows - 3);
        for (let cy = 0; cy < rows; cy++) {
            if (cy >= gapStart && cy <= gapStart + 2) continue;
            blockCell(grid, cx, cy, stripe % 2 === 0 ? 1 : 255);
        }
        stripe++;
    }
    return grid;
}

/**
 * 문자열 또는 바이트 입력의 SHA-256을 계산합니다.
 * @param {string|Uint8Array} value - 해시할 값입니다.
 * @returns {string} 소문자 16진수 SHA-256입니다.
 */
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

test('정상 개방 그리드와 대칭 동률 heap 순서가 JS와 byte-for-byte 동일하다', () => {
    const { stats } = runHeapInstrumentedParityCase(
        'normal-open-heap-ties',
        createGrid(17, 11),
        { cx: 8, cy: 5 }
    );
    assert.ok(stats.tieComparisons > 0, '대칭 동률 heap 비교가 실제로 발생해야 합니다.');
});

test('우회 경로가 기존 open node 비용을 낮추는 decrease-key 사례도 완전히 동일하다', () => {
    const blockedRows = [
        '1100010',
        '0010110',
        '0010000',
        '0100000',
        '0001000',
        '1000000',
        '0101011'
    ];
    const grid = createGrid(7, 7);
    for (let cy = 0; cy < blockedRows.length; cy++) {
        for (let cx = 0; cx < blockedRows[cy].length; cx++) {
            if (blockedRows[cy][cx] === '1') blockCell(grid, cx, cy);
        }
    }

    const { stats } = runHeapInstrumentedParityCase(
        'explicit-decrease-key',
        grid,
        { cx: 0, cy: 4 }
    );
    assert.ok(stats.decreaseCalls > 0, 'indexed heap의 decrease-key가 실제로 발생해야 합니다.');
});

test('차단물과 non-zero 차단 바이트가 JS와 byte-for-byte 동일하다', () => {
    const grid = createGrid(13, 9);
    for (let cy = 1; cy < grid.rows - 1; cy++) {
        if (cy === 4) continue;
        blockCell(grid, 6, cy, cy % 2 === 0 ? 1 : 255);
    }
    blockCell(grid, 3, 3);
    blockCell(grid, 3, 4);
    blockCell(grid, 4, 3);
    runParityCase('blocked-obstacles', grid, { cx: 11, cy: 7 });
});

test('대각선 corner-cut이 금지되고 고립 셀은 unreachable로 남는다', () => {
    const grid = createGrid(4, 4);
    blockCell(grid, 1, 0);
    blockCell(grid, 0, 1);
    const { expected } = runParityCase('corner-cut', grid, { cx: 1, cy: 1 });
    assert.ok(expected.integration[0] >= referenceFlowFieldInf * 0.5);
    assert.equal(expected.dirX[0], 0);
    assert.equal(expected.dirY[0], 0);
});

test('완전 장벽 뒤 unreachable 영역과 영벡터가 정확히 동일하다', () => {
    const grid = createGrid(19, 13);
    for (let cy = 0; cy < grid.rows; cy++) blockCell(grid, 9, cy);
    const { expected } = runParityCase('unreachable-wall', grid, { cx: 15, cy: 6 });
    const unreachableIndex = (6 * grid.cols) + 3;
    assert.ok(
        expected.integration[unreachableIndex]
        >= referenceFlowFieldInf * 0.5
    );
    assert.equal(expected.dirX[unreachableIndex], 0);
    assert.equal(expected.dirY[unreachableIndex], 0);
});

test('경계·단일 행·단일 열·차단된 목표 셀 edge case가 모두 동일하다', () => {
    const cases = [
        ['single-cell', createGrid(1, 1), { cx: 0, cy: 0 }],
        ['single-row-left-goal', createGrid(9, 1), { cx: 0, cy: 0 }],
        ['single-column-bottom-goal', createGrid(1, 9), { cx: 0, cy: 8 }],
        ['top-left-goal', createGrid(6, 5), { cx: 0, cy: 0 }],
        ['bottom-right-goal', createGrid(6, 5), { cx: 5, cy: 4 }]
    ];
    for (const [label, grid, goal] of cases) runParityCase(label, grid, goal);

    const blockedGoalGrid = createGrid(7, 7);
    blockCell(blockedGoalGrid, 3, 3, 255);
    const { expected } = runParityCase(
        'blocked-goal',
        blockedGoalGrid,
        { cx: 3, cy: 3 }
    );
    assert.equal(expected.integration[(3 * blockedGoalGrid.cols) + 3], 0);
    assert.equal(expected.dirX[(3 * blockedGoalGrid.cols) + 3], 0);
    assert.equal(expected.dirY[(3 * blockedGoalGrid.cols) + 3], 0);
});

test('모든 셀이 차단된 그리드도 목표 외 INF 및 영벡터를 동일하게 보존한다', () => {
    const grid = createGrid(8, 8);
    grid.blocked.fill(255);
    runParityCase('all-blocked', grid, { cx: 4, cy: 4 });
});

test('1x1부터 3x3까지 모든 차단 mask와 모든 목표 셀이 byte-for-byte 동일하다', () => {
    let caseCount = 0;
    for (let rows = 1; rows <= 3; rows++) {
        for (let cols = 1; cols <= 3; cols++) {
            const size = cols * rows;
            const maskCount = 1 << size;
            for (let mask = 0; mask < maskCount; mask++) {
                const grid = createGrid(cols, rows);
                for (let index = 0; index < size; index++) {
                    if ((mask & (1 << index)) !== 0) {
                        grid.blocked[index] = index % 2 === 0 ? 1 : 255;
                    }
                }
                for (let goalIndex = 0; goalIndex < size; goalIndex++) {
                    runParityCase(
                        `exhaustive-${cols}x${rows}-mask-${mask}-goal-${goalIndex}`,
                        grid,
                        { cx: goalIndex % cols, cy: Math.floor(goalIndex / cols) }
                    );
                    caseCount++;
                }
            }
        }
    }
    assert.equal(caseCount, 5506, '소형 전수 검증 케이스 수가 달라졌습니다.');
});

test('4,097x2 및 2x4,097 장축형 그리드도 stride 방향과 무관하게 동일하다', () => {
    const horizontal = createGrid(4097, 2);
    for (let cx = 3; cx < horizontal.cols - 1; cx += 97) {
        blockCell(horizontal, cx, Math.floor(cx / 97) % 2, 255);
    }
    runParityCase(
        'elongated-horizontal',
        horizontal,
        { cx: horizontal.cols - 1, cy: 1 }
    );

    const vertical = createGrid(2, 4097);
    for (let cy = 3; cy < vertical.rows - 1; cy += 97) {
        blockCell(vertical, Math.floor(cy / 97) % 2, cy, 255);
    }
    runParityCase(
        'elongated-vertical',
        vertical,
        { cx: 1, cy: vertical.rows - 1 }
    );
});

test('49,601셀 대형 줄무늬 그리드가 JS와 byte-for-byte 동일하다', () => {
    const grid = createLargeStripedGrid(257, 193);
    runParityCase('large-striped', grid, { cx: 256, cy: 192 });
});

test('64개 결정적 난수·밀도 조합이 JS와 byte-for-byte 동일하다', () => {
    const densities = [0, 0.08, 0.23, 0.47, 0.72];
    for (let caseIndex = 1; caseIndex <= 64; caseIndex++) {
        const random = createDeterministicRandom((0x9e3779b9 ^ caseIndex) >>> 0);
        const cols = 4 + (caseIndex % 29);
        const rows = 4 + ((caseIndex * 7) % 23);
        const density = densities[caseIndex % densities.length];
        const grid = createGrid(cols, rows);
        for (let index = 0; index < grid.size; index++) {
            if (random() < density) grid.blocked[index] = random() < 0.5 ? 1 : 255;
        }
        const goalCell = {
            cx: Math.floor(random() * cols),
            cy: Math.floor(random() * rows)
        };
        grid.blocked[(goalCell.cy * cols) + goalCell.cx] = 0;
        runParityCase(`random-${caseIndex}`, grid, goalCell);
    }
});

test('같은 입력의 반복 실행 결과는 호출 순서와 무관하게 결정적이다', () => {
    const grid = createLargeStripedGrid(83, 61);
    const goalCell = { cx: 75, cy: 52 };
    const first = wasmRuntime.buildFlowField(grid, goalCell);

    runParityCase('intervening-call', createGrid(5, 7), { cx: 2, cy: 3 });
    const second = wasmRuntime.buildFlowField(grid, goalCell);
    assertFlowFieldByteParity('repeat-determinism', first, second);
});

test('작은 결과는 page growth 대형 호출과 작은 재호출 뒤에도 바뀌지 않는다', async () => {
    const isolatedRuntime = await runtimeModule.createEnemyAIFlowFieldWasmRuntime();
    const smallGrid = createGrid(3, 3);
    blockCell(smallGrid, 1, 0, 255);
    blockCell(smallGrid, 0, 1);
    const smallGoal = { cx: 2, cy: 2 };
    const expectedSmall = referenceBuildFlowField(smallGrid, smallGoal);
    const firstSmall = isolatedRuntime.buildFlowField(smallGrid, smallGoal);
    assertFlowFieldByteParity('growth-small-before', expectedSmall, firstSmall);
    const firstSnapshot = Object.fromEntries(
        ['integration', 'dirX', 'dirY'].map((plane) => [
            plane,
            Buffer.from(toByteBuffer(firstSmall[plane]))
        ])
    );

    const largeGrid = createLargeStripedGrid(257, 193);
    const expectedLarge = referenceBuildFlowField(largeGrid, { cx: 256, cy: 192 });
    const large = isolatedRuntime.buildFlowField(largeGrid, { cx: 256, cy: 192 });
    assertFlowFieldByteParity('growth-large', expectedLarge, large);
    assert.ok(
        large.integration.byteLength > 64 * 1024,
        '대형 입력의 단일 출력 평면부터 초기 WASM 한 페이지를 넘어야 합니다.'
    );
    for (const plane of ['integration', 'dirX', 'dirY']) {
        assert.deepEqual(
            toByteBuffer(firstSmall[plane]),
            firstSnapshot[plane],
            `대형 호출 뒤 이전 ${plane} 반환 배열이 변경되었습니다.`
        );
    }

    const secondSmall = isolatedRuntime.buildFlowField(smallGrid, smallGoal);
    assertFlowFieldByteParity('growth-small-after', expectedSmall, secondSmall);
    for (const plane of ['integration', 'dirX', 'dirY']) {
        assert.deepEqual(
            toByteBuffer(firstSmall[plane]),
            firstSnapshot[plane],
            `작은 재호출 뒤 이전 ${plane} 반환 배열이 변경되었습니다.`
        );
        assert.notStrictEqual(
            firstSmall[plane].buffer,
            secondSmall[plane].buffer,
            `${plane} 반환 배열이 호출 간 scratch buffer를 공유합니다.`
        );
    }
});

test('runtime wrapper가 잘못된 차원·blocked·goal·size를 명시적으로 거부한다', () => {
    const grid = createGrid(4, 4);
    for (const [label, cols, rows, message] of [
        ['zero-cols', 0, 1, /1 이상/],
        ['zero-rows', 1, 0, /1 이상/],
        ['fractional-cols', 1.5, 1, /정수/],
        ['fractional-rows', 1, 1.5, /정수/],
        ['nan-cols', Number.NaN, 1, /정수/],
        ['nan-rows', 1, Number.NaN, /정수/],
        ['infinite-cols', Number.POSITIVE_INFINITY, 1, /정수/],
        ['infinite-rows', 1, Number.POSITIVE_INFINITY, /정수/]
    ]) {
        assert.throws(
            () => wasmRuntime.buildFlowField(
                { cols, rows, size: 1, blocked: new Uint8Array(1) },
                { cx: 0, cy: 0 }
            ),
            message,
            label
        );
    }

    assert.throws(
        () => wasmRuntime.buildFlowField(
            { ...grid, blocked: new Uint16Array(grid.size) },
            { cx: 0, cy: 0 }
        ),
        /Uint8Array/
    );
    assert.throws(
        () => wasmRuntime.buildFlowField(
            { ...grid, blocked: new Uint8Array(grid.size - 1) },
            { cx: 0, cy: 0 }
        ),
        /Uint8Array/
    );
    assert.throws(
        () => wasmRuntime.buildFlowField(grid, { cx: -1, cy: 0 }),
        /goalCell은 그리드 범위 안/
    );
    assert.throws(
        () => wasmRuntime.buildFlowField(grid, { cx: grid.cols, cy: 0 }),
        /goalCell은 그리드 범위 안/
    );
    assert.throws(
        () => wasmRuntime.buildFlowField(grid, { cx: 0, cy: grid.rows }),
        /goalCell은 그리드 범위 안/
    );
    for (const goalCell of [
        { cx: 1.5, cy: 0 },
        { cx: 0, cy: 1.5 },
        { cx: Number.NaN, cy: 0 },
        { cx: 0, cy: Number.POSITIVE_INFINITY }
    ]) {
        assert.throws(
            () => wasmRuntime.buildFlowField(grid, goalCell),
            /goalCell\.cx와 goalCell\.cy는 정수/
        );
    }
    assert.throws(
        () => wasmRuntime.buildFlowField(
            { cols: 4, rows: 4, size: 15, blocked: new Uint8Array(16) },
            { cx: 0, cy: 0 }
        ),
        /grid.size/
    );
});

test('WAT 원문 해시·WASM 바이트 해시·WebAssembly 유효성이 생성물과 일치한다', async () => {
    const watSource = (await readFile(WAT_PATH, 'utf8')).replace(/\r\n/g, '\n');
    const wasmBytes = bytesModule.ENEMY_AI_FLOW_FIELD_WASM_BYTES;
    assert.equal(sha256(watSource), bytesModule.ENEMY_AI_FLOW_FIELD_WAT_SHA256);
    assert.equal(sha256(wasmBytes), bytesModule.ENEMY_AI_FLOW_FIELD_WASM_SHA256);
    assert.equal(WebAssembly.validate(wasmBytes), true);
});

test(
    '고정 WABT 버전 재빌드가 체크인된 JS 바이트 모듈과 완전히 동일하다',
    () => {
        const output = execFileSync(
            process.execPath,
            [BUILD_SCRIPT_PATH, '--check'],
            { encoding: 'utf8', windowsHide: true }
        );
        assert.match(output, /재현성 검사 통과/);
    }
);
