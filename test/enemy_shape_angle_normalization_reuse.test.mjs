import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

for (const modulePath of [
    'util/number_util.js',
    'util/math_util.js',
    'simulation/simulation_runtime.js',
    'physics/_collision_resolve_tuning.js'
]) {
    await loadGameModule(modulePath);
}

const { normalizeDegrees } = await loadGameModule('util/math_util.js');
const { BaseEnemy } = await loadGameModule('object/enemy/_base_enemy.js');

const FULL_TURN_DEG = 360;
const STRAIGHT_DEG = 180;
const MASK_64 = (1n << 64n) - 1n;
const RANDOM_FLOAT_CASE_COUNT = 200_000;
const RANDOM_DELTA_CASE_COUNT = 200_000;
const floatView = new DataView(new ArrayBuffer(8));

/**
 * ShapeEnemy가 사용하던 로컬 각도 정규화 오라클입니다.
 * @param {number} angle - 정규화할 각도입니다.
 * @returns {number} 기존 구현의 결과입니다.
 */
function normalizeShapeAngleLegacy(angle) {
    if (!Number.isFinite(angle)) return 0;
    let out = angle % FULL_TURN_DEG;
    if (out > STRAIGHT_DEG) out -= FULL_TURN_DEG;
    if (out < -STRAIGHT_DEG) out += FULL_TURN_DEG;
    return out;
}

/**
 * BaseEnemy가 렌더 보간에서 사용 중인 각도 델타 오라클입니다.
 * @param {number} previousRotation - 이전 회전값입니다.
 * @param {number} currentRotation - 현재 회전값입니다.
 * @returns {number} 기존 구현의 결과입니다.
 */
function normalizeInterpolationDeltaLegacy(previousRotation, currentRotation) {
    let rotationDelta = (currentRotation - previousRotation) % FULL_TURN_DEG;
    if (rotationDelta > STRAIGHT_DEG) rotationDelta -= FULL_TURN_DEG;
    if (rotationDelta < -STRAIGHT_DEG) rotationDelta += FULL_TURN_DEG;
    return rotationDelta;
}

/**
 * 부호 있는 0과 NaN까지 구분해 두 결과의 완전 동일성을 검사합니다.
 * @param {number} angle - 검사 입력입니다.
 * @param {string} label - 실패 시 표시할 케이스 이름입니다.
 */
function assertShapeNormalizationEqual(angle, label) {
    const legacy = normalizeShapeAngleLegacy(angle);
    const shared = normalizeDegrees(angle);
    assert.ok(
        Object.is(shared, legacy),
        `${label}: input=${String(angle)}, legacy=${String(legacy)}, shared=${String(shared)}`
    );
}

/**
 * 주어진 숫자 바로 다음의 표현 가능한 IEEE-754 배정밀도 값을 반환합니다.
 * @param {number} value - 기준 값입니다.
 * @returns {number} 다음 표현 가능 값입니다.
 */
function nextUp(value) {
    if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
    if (Object.is(value, -0) || value === 0) return Number.MIN_VALUE;
    floatView.setFloat64(0, value, false);
    const bits = floatView.getBigUint64(0, false);
    floatView.setBigUint64(0, value > 0 ? bits + 1n : bits - 1n, false);
    return floatView.getFloat64(0, false);
}

/**
 * 주어진 숫자 바로 이전의 표현 가능한 IEEE-754 배정밀도 값을 반환합니다.
 * @param {number} value - 기준 값입니다.
 * @returns {number} 이전 표현 가능 값입니다.
 */
function nextDown(value) {
    if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return value;
    if (Object.is(value, -0) || value === 0) return -Number.MIN_VALUE;
    floatView.setFloat64(0, value, false);
    const bits = floatView.getBigUint64(0, false);
    floatView.setBigUint64(0, value > 0 ? bits - 1n : bits + 1n, false);
    return floatView.getFloat64(0, false);
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

assert.equal(FULL_TURN_DEG, 360, '적 회전 구현은 360도를 한 바퀴로 사용해야 합니다.');
assert.equal(STRAIGHT_DEG, 180, '적 회전 구현은 180도를 직선각으로 사용해야 합니다.');

const explicitCases = [
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
    -179.5,
    179.5,
    -180,
    180,
    -360,
    360,
    -720,
    720,
    -1e308,
    1e308
];

for (let index = 0; index < explicitCases.length; index++) {
    assertShapeNormalizationEqual(explicitCases[index], `explicit[${index}]`);
}

let boundaryCaseCount = 0;
for (let turns = -4096; turns <= 4096; turns++) {
    const boundary = turns * STRAIGHT_DEG;
    for (const value of [nextDown(boundary), boundary, nextUp(boundary)]) {
        assertShapeNormalizationEqual(value, `boundary[${turns}:${boundaryCaseCount}]`);
        boundaryCaseCount++;
    }
}

let randomState = 0xD1B54A32D192ED03n;
for (let index = 0; index < RANDOM_FLOAT_CASE_COUNT; index++) {
    randomState = nextRandomBits(randomState);
    assertShapeNormalizationEqual(floatFromBits(randomState), `raw-bits[${index}]`);
}

for (let index = 0; index < RANDOM_DELTA_CASE_COUNT; index++) {
    randomState = nextRandomBits(randomState);
    const fromDeg = floatFromBits(randomState);
    randomState = nextRandomBits(randomState);
    const toDeg = floatFromBits(randomState);
    assertShapeNormalizationEqual(toDeg - fromDeg, `delta[${index}]`);
}

// BaseEnemy의 극값 오버플로 계약은 공용 함수와 다르므로 직접 치환 대상에서 제외합니다.
const overflowDelta = Number.MAX_VALUE - (-Number.MAX_VALUE);
assert.equal(overflowDelta, Number.POSITIVE_INFINITY);
assert.ok(Number.isNaN(normalizeInterpolationDeltaLegacy(-Number.MAX_VALUE, Number.MAX_VALUE)));
assert.equal(normalizeDegrees(overflowDelta), 0);
const overflowEnemy = new BaseEnemy();
overflowEnemy.prevRotation = -Number.MAX_VALUE;
overflowEnemy.rotation = Number.MAX_VALUE;
overflowEnemy.interpolatePosition(0.5);
assert.ok(Number.isNaN(overflowEnemy.renderRotation), '정방향 극값 오버플로는 기존 NaN 계약을 유지합니다.');
overflowEnemy.prevRotation = Number.MAX_VALUE;
overflowEnemy.rotation = -Number.MAX_VALUE;
overflowEnemy.interpolatePosition(0.5);
assert.ok(Number.isNaN(overflowEnemy.renderRotation), '역방향 극값 오버플로는 기존 NaN 계약을 유지합니다.');

const shapeEnemyPath = fileURLToPath(new URL('../project/game/script/module/object/enemy/_shape_enemy.js', import.meta.url));
const shapeEnemySource = await readFile(shapeEnemyPath, 'utf8');
assert.match(
    shapeEnemySource,
    /import\s*\{[^}]*\bnormalizeDegrees\b[^}]*\}\s*from\s*['\"]util\/math_util\.js['\"]/,
    'ShapeEnemy는 검증된 공용 각도 정규화 함수를 가져와야 합니다.'
);
assert.doesNotMatch(
    shapeEnemySource,
    /#normalizeAngle\s*\(/,
    'ShapeEnemy에 로컬 각도 정규화 구현이 다시 생기면 안 됩니다.'
);

console.log(
    `enemy shape angle normalization reuse: ${explicitCases.length} explicit + `
    + `${boundaryCaseCount} boundary + ${RANDOM_FLOAT_CASE_COUNT} raw-bit + `
    + `${RANDOM_DELTA_CASE_COUNT} delta cases exact`
);
