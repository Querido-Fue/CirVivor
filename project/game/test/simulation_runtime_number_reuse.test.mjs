import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const { resolveFiniteNumber } = await loadGameModule('util/number_util.js');
const {
    SimulationRuntime,
    copySimulationWheelTotalsInto,
    isSimulationInputActionPressed
} = await loadGameModule('simulation/simulation_runtime.js');

const MASK_64 = (1n << 64n) - 1n;
const RANDOM_PAIR_CASE_COUNT = 250_000;
const RUNTIME_RAW_CASE_COUNT = 25_000;
const floatView = new DataView(new ArrayBuffer(8));

/**
 * SimulationRuntime이 사용하던 로컬 숫자 정규화 오라클입니다.
 * @param {unknown} value - 검사할 값입니다.
 * @param {unknown} [fallback=0] - 유효하지 않은 값의 대체값입니다.
 * @returns {unknown} 기존 구현의 결과입니다.
 */
function normalizeRuntimeNumberLegacy(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 결정적 xorshift64 상태를 다음 값으로 전진시킵니다.
 * @param {bigint} state - 현재 64비트 상태입니다.
 * @returns {bigint} 다음 64비트 상태입니다.
 */
function nextRandomBits(state) {
    let next = state & MASK_64;
    next ^= (next << 13n) & MASK_64;
    next ^= next >> 7n;
    next ^= (next << 17n) & MASK_64;
    return next & MASK_64;
}

/**
 * 임의의 64비트 패턴을 IEEE-754 배정밀도 숫자로 해석합니다.
 * @param {bigint} bits - 원시 64비트 패턴입니다.
 * @returns {number} 해석된 숫자입니다.
 */
function floatFromBits(bits) {
    floatView.setBigUint64(0, bits & MASK_64, false);
    return floatView.getFloat64(0, false);
}

/**
 * 부호 있는 0과 NaN까지 구분해 공용 함수가 legacy 오라클과 같은지 검사합니다.
 * @param {unknown} value - 검사할 값입니다.
 * @param {unknown} fallback - 대체값입니다.
 * @param {string} label - 실패 케이스 이름입니다.
 */
function assertSharedNormalizationEqual(value, fallback, label) {
    const legacy = normalizeRuntimeNumberLegacy(value, fallback);
    const shared = resolveFiniteNumber(value, fallback);
    assert.ok(
        Object.is(shared, legacy),
        `${label}: legacy=${String(legacy)}, shared=${String(shared)}`
    );
}

const explicitValues = [
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    -Number.MAX_VALUE,
    Number.MAX_VALUE,
    -Number.MIN_VALUE,
    Number.MIN_VALUE,
    -Number.EPSILON,
    Number.EPSILON,
    -0,
    0,
    -1,
    1,
    -1e308,
    1e308,
    undefined,
    null,
    false,
    true,
    '',
    '0',
    '1',
    0n,
    1n,
    Symbol('simulation-runtime-number'),
    {},
    [],
    () => 1
];
const explicitFallbacks = [null, Number.NaN, -0, 0, Number.MIN_VALUE, Number.MAX_VALUE, 'fallback', {}];

// 로컬 helper의 기본 인자와 공용 함수의 차이는 확인하되, 실제 16개 호출은 모두 fallback을 명시합니다.
assert.equal(normalizeRuntimeNumberLegacy(Number.NaN, undefined), 0);
assert.equal(resolveFiniteNumber(Number.NaN, undefined), undefined);

for (let valueIndex = 0; valueIndex < explicitValues.length; valueIndex++) {
    for (let fallbackIndex = 0; fallbackIndex < explicitFallbacks.length; fallbackIndex++) {
        assertSharedNormalizationEqual(
            explicitValues[valueIndex],
            explicitFallbacks[fallbackIndex],
            `explicit[${valueIndex}:${fallbackIndex}]`
        );
    }
}

let randomState = 0x9E3779B97F4A7C15n;
for (let index = 0; index < RANDOM_PAIR_CASE_COUNT; index++) {
    randomState = nextRandomBits(randomState);
    const value = floatFromBits(randomState);
    randomState = nextRandomBits(randomState);
    const fallback = floatFromBits(randomState);
    assertSharedNormalizationEqual(value, fallback, `raw-pair[${index}]`);
}

const runtime = new SimulationRuntime();
const defaultViewport = runtime.getViewportSnapshot();
const defaultInput = runtime.getInputSnapshot();
const viewportFields = ['ww', 'wh', 'objectWH', 'objectOffsetY', 'uiww', 'uiOffsetX'];

runtime.sync({
    input: {
        wheel: { x: 1.25, y: -2.5 },
        actionStates: { moveUp: true, moveDown: false },
        keys: { legacyAction: true }
    }
});
const wheelSnapshot = {};
assert.strictEqual(copySimulationWheelTotalsInto(wheelSnapshot), wheelSnapshot);
assert.deepEqual(wheelSnapshot, { x: 1.25, y: -2.5 });
assert.equal(isSimulationInputActionPressed('moveUp'), true);
assert.equal(isSimulationInputActionPressed('moveDown'), false);
assert.equal(isSimulationInputActionPressed('legacyAction'), true);

/**
 * 실제 SimulationRuntime 동기화·복제 경로의 결과를 legacy 오라클과 비교합니다.
 * @param {unknown} value - 모든 숫자 필드에 주입할 값입니다.
 * @param {string} label - 실패 케이스 이름입니다.
 */
function assertRuntimeSnapshotEqual(value, label) {
    const viewport = {};
    for (let fieldIndex = 0; fieldIndex < viewportFields.length; fieldIndex++) {
        viewport[viewportFields[fieldIndex]] = value;
    }
    runtime.sync({
        viewport,
        input: { mousePos: { x: value, y: value } }
    });

    const actualViewport = runtime.getViewportSnapshot();
    for (let fieldIndex = 0; fieldIndex < viewportFields.length; fieldIndex++) {
        const fieldName = viewportFields[fieldIndex];
        const expected = normalizeRuntimeNumberLegacy(value, defaultViewport[fieldName]);
        assert.ok(
            Object.is(actualViewport[fieldName], expected),
            `${label}.${fieldName}: expected=${String(expected)}, actual=${String(actualViewport[fieldName])}`
        );
    }

    const actualInput = runtime.getInputSnapshot();
    const expectedX = normalizeRuntimeNumberLegacy(value, defaultInput.mousePos.x);
    const expectedY = normalizeRuntimeNumberLegacy(value, defaultInput.mousePos.y);
    assert.ok(Object.is(actualInput.mousePos.x, expectedX), `${label}.mousePos.x`);
    assert.ok(Object.is(actualInput.mousePos.y, expectedY), `${label}.mousePos.y`);
}

for (let index = 0; index < explicitValues.length; index++) {
    assertRuntimeSnapshotEqual(explicitValues[index], `runtime-explicit[${index}]`);
}

for (let index = 0; index < RUNTIME_RAW_CASE_COUNT; index++) {
    randomState = nextRandomBits(randomState);
    assertRuntimeSnapshotEqual(floatFromBits(randomState), `runtime-raw[${index}]`);
}

let viewportReadCount = 0;
const accessorViewport = {};
for (let fieldIndex = 0; fieldIndex < viewportFields.length; fieldIndex++) {
    Object.defineProperty(accessorViewport, viewportFields[fieldIndex], {
        enumerable: true,
        get() {
            viewportReadCount++;
            return Number.NaN;
        }
    });
}
let mouseReadCount = 0;
const accessorMousePosition = {};
for (const fieldName of ['x', 'y']) {
    Object.defineProperty(accessorMousePosition, fieldName, {
        enumerable: true,
        get() {
            mouseReadCount++;
            return Number.NaN;
        }
    });
}
runtime.sync({ viewport: accessorViewport, input: { mousePos: accessorMousePosition } });
assert.equal(viewportReadCount, viewportFields.length, '뷰포트 getter는 필드당 정확히 한 번만 읽어야 합니다.');
assert.equal(mouseReadCount, 2, '마우스 getter는 좌표당 정확히 한 번만 읽어야 합니다.');

const runtimePath = fileURLToPath(new URL('../script/module/simulation/simulation_runtime.js', import.meta.url));
const runtimeSource = await readFile(runtimePath, 'utf8');
assert.match(
    runtimeSource,
    /import\s*\{[^}]*\bresolveFiniteNumber\b[^}]*\}\s*from\s*['"]util\/number_util\.js['"]/,
    'SimulationRuntime은 검증된 공용 숫자 정규화 함수를 가져와야 합니다.'
);
assert.doesNotMatch(
    runtimeSource,
    /\bfunction\s+normalizeNumber\s*\(/,
    'SimulationRuntime에 로컬 숫자 정규화 구현이 다시 생기면 안 됩니다.'
);
assert.doesNotMatch(
    runtimeSource,
    /\bnormalizeNumber\s*\(/,
    'SimulationRuntime 호출부는 공용 함수로 직접 통합되어야 합니다.'
);
const copyMousePositionSource = runtimeSource.match(
    /export function copySimulationMousePositionInto\(target\) \{[\s\S]*?\n\}/u
)?.[0];
assert.ok(copyMousePositionSource, '마우스 out-copy 함수 본문을 찾을 수 있어야 합니다.');
const copyWheelTotalsSource = runtimeSource.match(
    /export function copySimulationWheelTotalsInto\(target\) \{[\s\S]*?\n\}/u
)?.[0];
assert.ok(copyWheelTotalsSource, 'wheel out-copy 함수 본문을 찾을 수 있어야 합니다.');
assert.equal(
    runtimeSource
        .replace(copyMousePositionSource, '')
        .replace(copyWheelTotalsSource, '')
        .match(/\bresolveFiniteNumber\s*\(/g)?.length,
    23,
    'viewport·pointer·wheel 동기화 호출은 모두 공용 함수와 명시적 fallback을 사용해야 합니다.'
);
assert.equal(
    copyMousePositionSource.match(/\bresolveFiniteNumber\s*\(/g)?.length,
    2,
    '마우스 out-copy는 x/y를 공용 숫자 정규화 함수로 각각 한 번 처리해야 합니다.'
);
assert.equal(
    copyWheelTotalsSource.match(/\bresolveFiniteNumber\s*\(/g)?.length,
    2,
    'wheel out-copy는 x/y를 공용 숫자 정규화 함수로 각각 한 번 처리해야 합니다.'
);
assert.ok(
    copyMousePositionSource.indexOf('target.x =') < copyMousePositionSource.indexOf('target.y ='),
    '마우스 out-copy는 기존 좌표 복제 계약과 같이 x 다음 y를 기록해야 합니다.'
);

console.log(
    `simulation runtime number reuse: ${explicitValues.length * explicitFallbacks.length} explicit pairs + `
    + `${RANDOM_PAIR_CASE_COUNT} raw pairs + ${explicitValues.length} runtime explicit + `
    + `${RUNTIME_RAW_CASE_COUNT} runtime raw cases exact`
);
