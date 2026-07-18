/**
 * production Enemy AI flow-field JS 원문과 WASM runtime을 대규모 결정적 입력으로
 * 원시 바이트 비교하고, WAT export가 ABI 허용 범위 밖을 쓰지 않는지 canary로 검사합니다.
 *
 * 실행:
 *   node --experimental-vm-modules game/test/stress/enemy_ai_flow_field_stress.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { loadGameModule } from '../support/source_module_loader.mjs';

const FUZZ_SEED = 0x71c0ffee;
const FUZZ_CASE_COUNT = 1000;
const EXPECTED_FUZZ_CELL_COUNT = 3_824_454;
const MAX_FUZZ_COLS = 137;
const MAX_FUZZ_ROWS = 113;
const DENSITY_BUCKET_COUNT = 101;
const DENSITY_SAMPLE_SCALE = 10_000;
const MEMORY_ALIGNMENT_BYTES = 64;
const WASM_PAGE_BYTES = 64 * 1024;
const ABI_CANARY_BYTE = 0xa5;
const RESULT_PLANES = Object.freeze(['integration', 'dirX', 'dirY']);
const ABI_CANARY_GRIDS = Object.freeze([
    Object.freeze({ cols: 1, rows: 1 }),
    Object.freeze({ cols: 32, rows: 32 }),
    Object.freeze({ cols: 257, rows: 193 })
]);

const GAME_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NAVIGATION_PATH = path.join(
    GAME_ROOT,
    'script',
    'module',
    'object',
    'enemy',
    'ai',
    '_enemy_ai_navigation.js'
);

/**
 * 소스에서 두 고유 마커 사이의 production 코드 구간을 추출합니다.
 * @param {string} source - 전체 production 소스입니다.
 * @param {string} startMarker - 포함할 시작 마커입니다.
 * @param {string} endMarker - 포함하지 않을 종료 마커입니다.
 * @returns {string} 추출된 코드 구간입니다.
 */
function extractSourceSection(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.notEqual(start, -1, `production oracle 시작 마커를 찾지 못했습니다: ${startMarker}`);
    assert.notEqual(end, -1, `production oracle 종료 마커를 찾지 못했습니다: ${endMarker}`);
    return source.slice(start, end);
}

/**
 * 현재 `_enemy_ai_navigation.js`의 실제 heap helper와 buildFlowField 원문으로 oracle을 만듭니다.
 * @param {string} source - navigation production 소스입니다.
 * @param {object} constants - 현재 production Enemy AI 상수입니다.
 * @returns {(grid:object,goalCell:object)=>object} production JS flow-field oracle입니다.
 */
function createProductionFlowFieldOracle(source, constants) {
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
        const EPSILON = ${JSON.stringify(constants.EPSILON)};
        const INF = ${JSON.stringify(constants.INF)};
        const DIAGONAL_COST = ${JSON.stringify(constants.DIAGONAL_COST)};
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
 * xorshift32 기반 고정 seed 난수 생성기를 만듭니다.
 * @param {number} seed - 0이 아닌 uint32 seed입니다.
 * @returns {() => number} 다음 uint32를 반환하는 함수입니다.
 */
function createDeterministicUint32(seed) {
    let state = seed >>> 0;
    assert.notEqual(state, 0, 'fuzz seed는 0일 수 없습니다.');
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
}

/**
 * 두 typed array의 첫 원시 바이트 불일치 위치를 반환합니다.
 * @param {ArrayBufferView} expected - production JS 결과입니다.
 * @param {ArrayBufferView} actual - WASM 결과입니다.
 * @returns {number} 첫 불일치 바이트이며 완전히 같으면 -1입니다.
 */
function findFirstByteMismatch(expected, actual) {
    const expectedBytes = new Uint8Array(
        expected.buffer,
        expected.byteOffset,
        expected.byteLength
    );
    const actualBytes = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
    const sharedLength = Math.min(expectedBytes.length, actualBytes.length);
    for (let index = 0; index < sharedLength; index++) {
        if (expectedBytes[index] !== actualBytes[index]) return index;
    }
    return expectedBytes.length === actualBytes.length ? -1 : sharedLength;
}

/**
 * flow-field 세 Float32 평면과 goalIndex가 원시 바이트까지 같은지 검사합니다.
 * @param {string} label - 실패 위치를 식별할 입력 이름입니다.
 * @param {object} expected - production JS 결과입니다.
 * @param {object} actual - WASM 결과입니다.
 * @returns {void}
 */
function assertFlowFieldByteParity(label, expected, actual) {
    assert.equal(actual.goalIndex, expected.goalIndex, `${label}: goalIndex 불일치`);
    for (const plane of RESULT_PLANES) {
        assert.equal(
            actual[plane].byteLength,
            expected[plane].byteLength,
            `${label}: ${plane} byteLength 불일치`
        );
        const mismatch = findFirstByteMismatch(expected[plane], actual[plane]);
        assert.equal(
            mismatch,
            -1,
            `${label}: ${plane}의 ${mismatch}번 원시 바이트가 다릅니다.`
        );
    }
}

/**
 * 고정 seed로 크기, 차단 밀도, 차단 바이트와 goal을 생성해 exact fuzz를 수행합니다.
 * 매 네 번째 입력은 blocked goal을 그대로 유지합니다.
 * @param {(grid:object,goalCell:object)=>object} oracle - production JS oracle입니다.
 * @param {{buildFlowField:Function}} wasmRuntime - production WASM runtime입니다.
 * @returns {{caseCount:number,cellCount:number,elapsedMs:number}} fuzz 실행 통계입니다.
 */
function runDeterministicFuzz(oracle, wasmRuntime) {
    const nextUint32 = createDeterministicUint32(FUZZ_SEED);
    let cellCount = 0;
    const startedAt = performance.now();

    for (let caseIndex = 0; caseIndex < FUZZ_CASE_COUNT; caseIndex++) {
        const cols = 1 + (nextUint32() % MAX_FUZZ_COLS);
        const rows = 1 + (nextUint32() % MAX_FUZZ_ROWS);
        const size = cols * rows;
        const blocked = new Uint8Array(size);
        const density = (nextUint32() % DENSITY_BUCKET_COUNT) / 100;

        for (let index = 0; index < size; index++) {
            if ((nextUint32() % DENSITY_SAMPLE_SCALE) < density * DENSITY_SAMPLE_SCALE) {
                blocked[index] = (nextUint32() & 1) === 0 ? 255 : 1;
            }
        }

        const goalCell = {
            cx: nextUint32() % cols,
            cy: nextUint32() % rows
        };
        if ((caseIndex & 3) !== 0) {
            blocked[(goalCell.cy * cols) + goalCell.cx] = 0;
        }

        const grid = { cols, rows, size, blocked };
        assertFlowFieldByteParity(
            `fuzz-${caseIndex}-${cols}x${rows}`,
            oracle(grid, goalCell),
            wasmRuntime.buildFlowField(grid, goalCell)
        );
        cellCount += size;
    }

    assert.equal(
        cellCount,
        EXPECTED_FUZZ_CELL_COUNT,
        '고정 seed fuzz의 총 셀 수가 바뀌었습니다.'
    );
    return {
        caseCount: FUZZ_CASE_COUNT,
        cellCount,
        elapsedMs: performance.now() - startedAt
    };
}

/**
 * 바이트 오프셋을 flow-field ABI의 64바이트 경계로 올림합니다.
 * @param {number} value - 정렬할 바이트 오프셋입니다.
 * @returns {number} 정렬된 바이트 오프셋입니다.
 */
function alignMemoryOffset(value) {
    return Math.ceil(value / MEMORY_ALIGNMENT_BYTES) * MEMORY_ALIGNMENT_BYTES;
}

/**
 * production runtime과 같은 flow-field linear-memory 배치를 계산합니다.
 * @param {number} size - grid 셀 수입니다.
 * @returns {{blockedOffset:number,integrationOffset:number,dirXOffset:number,dirYOffset:number,heapOffset:number,positionsOffset:number,requiredBytes:number,writableRanges:Array<{start:number,end:number}>}} ABI 배치입니다.
 */
function createCanaryMemoryLayout(size) {
    const floatPlaneBytes = size * Float32Array.BYTES_PER_ELEMENT;
    const blockedOffset = 0;
    const integrationOffset = alignMemoryOffset(blockedOffset + size);
    const dirXOffset = alignMemoryOffset(integrationOffset + floatPlaneBytes);
    const dirYOffset = alignMemoryOffset(dirXOffset + floatPlaneBytes);
    const heapOffset = alignMemoryOffset(dirYOffset + floatPlaneBytes);
    const positionsOffset = alignMemoryOffset(heapOffset + floatPlaneBytes);
    const requiredBytes = positionsOffset + floatPlaneBytes;
    return {
        blockedOffset,
        integrationOffset,
        dirXOffset,
        dirYOffset,
        heapOffset,
        positionsOffset,
        requiredBytes,
        writableRanges: [
            { start: blockedOffset, end: blockedOffset + size },
            { start: integrationOffset, end: integrationOffset + floatPlaneBytes },
            { start: dirXOffset, end: dirXOffset + floatPlaneBytes },
            { start: dirYOffset, end: dirYOffset + floatPlaneBytes },
            { start: heapOffset, end: heapOffset + floatPlaneBytes },
            { start: positionsOffset, end: positionsOffset + floatPlaneBytes }
        ]
    };
}

/**
 * 지정 범위가 초기 canary 바이트를 그대로 유지하는지 검사합니다.
 * @param {Uint8Array} bytes - 전체 WASM memory byte view입니다.
 * @param {number} start - 검사 시작 오프셋입니다.
 * @param {number} end - 검사 종료 오프셋입니다.
 * @param {string} label - 실패 진단용 grid 이름입니다.
 * @returns {void}
 */
function assertCanaryRange(bytes, start, end, label) {
    for (let offset = start; offset < end; offset++) {
        assert.equal(
            bytes[offset],
            ABI_CANARY_BYTE,
            `${label}: ABI 허용 범위 밖 ${offset}번 바이트가 변경되었습니다.`
        );
    }
}

/**
 * WAT export가 입력·출력·scratch plane 외 padding과 guard tail을 쓰지 않는지 검사합니다.
 * @param {Uint8Array} wasmBytesRaw - 체크인된 production WASM 바이트입니다.
 * @returns {{layoutCount:number,elapsedMs:number}} canary 실행 통계입니다.
 */
function runAbiCanaries(wasmBytesRaw) {
    const wasmBytes = Uint8Array.from(wasmBytesRaw);
    assert.equal(WebAssembly.validate(wasmBytes), true, 'production WASM 바이트가 유효하지 않습니다.');
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const startedAt = performance.now();

    for (const { cols, rows } of ABI_CANARY_GRIDS) {
        const size = cols * rows;
        const layout = createCanaryMemoryLayout(size);
        const initialPages = Math.ceil((layout.requiredBytes + WASM_PAGE_BYTES) / WASM_PAGE_BYTES);
        const memory = new WebAssembly.Memory({ initial: initialPages });
        const instance = new WebAssembly.Instance(wasmModule, { env: { memory } });
        const bytes = new Uint8Array(memory.buffer);
        const label = `${cols}x${rows}`;
        bytes.fill(ABI_CANARY_BYTE);

        const blocked = new Uint8Array(memory.buffer, layout.blockedOffset, size);
        blocked.fill(0);
        for (let index = 17; index < size - 1; index += 37) {
            blocked[index] = (index & 1) === 0 ? 1 : 255;
        }
        const blockedSnapshot = blocked.slice();

        const status = instance.exports.build_flow_field(
            layout.blockedOffset,
            layout.integrationOffset,
            layout.dirXOffset,
            layout.dirYOffset,
            layout.heapOffset,
            layout.positionsOffset,
            cols,
            rows,
            cols - 1,
            rows - 1
        );
        assert.equal(status, 0, `${label}: WAT export 상태 코드가 0이 아닙니다.`);
        assert.deepEqual(blocked, blockedSnapshot, `${label}: blocked 입력 plane이 변경되었습니다.`);

        let guardStart = 0;
        for (const range of layout.writableRanges) {
            assertCanaryRange(bytes, guardStart, range.start, label);
            guardStart = range.end;
        }
        assertCanaryRange(bytes, guardStart, bytes.length, label);
    }

    return {
        layoutCount: ABI_CANARY_GRIDS.length,
        elapsedMs: performance.now() - startedAt
    };
}

const totalStartedAt = performance.now();
const runtimeModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_runtime.js'
);
const constantsModule = await loadGameModule('data/object/enemy/enemy_ai_constants.js');
const bytesModule = await loadGameModule(
    'object/enemy/ai/wasm/_enemy_ai_flow_field_wasm_bytes.js'
);
const navigationSource = (await readFile(NAVIGATION_PATH, 'utf8')).replace(/\r\n/g, '\n');
const oracle = createProductionFlowFieldOracle(
    navigationSource,
    constantsModule.ENEMY_AI_CONSTANTS
);
const wasmRuntime = runtimeModule.createEnemyAIFlowFieldWasmRuntimeSync();
const fuzz = runDeterministicFuzz(oracle, wasmRuntime);
const canary = runAbiCanaries(bytesModule.ENEMY_AI_FLOW_FIELD_WASM_BYTES);
const totalElapsedMs = performance.now() - totalStartedAt;

console.log('Enemy AI flow-field stress PASS');
console.log(`seed: 0x${FUZZ_SEED.toString(16)}`);
console.log(
    `fuzz: ${fuzz.caseCount.toLocaleString('en-US')} cases, `
    + `${fuzz.cellCount.toLocaleString('en-US')} cells, ${fuzz.elapsedMs.toFixed(2)} ms`
);
console.log(
    `ABI canary: ${canary.layoutCount} layouts `
    + '(1x1, 32x32, 257x193), '
    + `${canary.elapsedMs.toFixed(2)} ms`
);
console.log(`total: ${totalElapsedMs.toFixed(2)} ms`);
