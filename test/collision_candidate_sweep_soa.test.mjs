import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// VM test loader가 공유 의존성을 동시에 링크하지 않도록 공통 graph를 아래에서 위로 평가합니다.
for (const modulePath of [
    'util/number_util.js',
    'physics/collision_math_constants.js',
    'physics/collision_soa_layout.js',
    'physics/_collision_resolve_tuning.js'
]) {
    await loadGameModule(modulePath);
}

const broadphaseModule = await loadGameModule('physics/collision_broadphase_buffer.js');
const soaModule = await loadGameModule('physics/collision_soa_layout.js');
const tuningModule = await loadGameModule('physics/_collision_resolve_tuning.js');

const { CollisionBroadphaseBuffer } = broadphaseModule;
const {
    COLLISION_BODY_SHAPE_CIRCLE_PARTS,
    COLLISION_CANDIDATE_SWEEP_INDEX: INDEX,
    COLLISION_CANDIDATE_SWEEP_STRIDE: STRIDE
} = soaModule;
const { COLLISION_CANDIDATE_SWEEP_PAD_SCALE: PAD_SCALE } = tuningModule;

const EPSILON = 1e-9;

/**
 * 숫자 두 개가 허용 오차 안에서 같은지 검증합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} message - 실패 메시지입니다.
 * @param {number} [epsilon=EPSILON] - 허용 오차입니다.
 */
function assertNear(actual, expected, message, epsilon = EPSILON) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `${message}: expected=${expected}, actual=${actual}`
    );
}

/**
 * 테스트용 enemy body를 생성합니다.
 * @param {object} [overrides={}] - 덮어쓸 body 필드입니다.
 * @returns {object} 후보 sweep writer 입력 body입니다.
 */
function createEnemyBody(overrides = {}) {
    const x = Number.isFinite(overrides.x) ? overrides.x : 0;
    const y = Number.isFinite(overrides.y) ? overrides.y : 0;
    const radius = Number.isFinite(overrides.radius) ? overrides.radius : 5;
    const body = {
        id: 1,
        kind: 'enemy',
        shape: 'circle',
        ref: { position: { x, y }, prevPosition: { x, y } },
        centerX: x,
        centerY: y,
        x,
        y,
        radius,
        minX: x - radius,
        maxX: x + radius,
        minY: y - radius,
        maxY: y + radius,
        sweepMinX: x - radius,
        sweepMaxX: x + radius,
        sweepMinY: y - radius,
        sweepMaxY: y + radius,
        enemyPairMinX: x - radius,
        enemyPairMaxX: x + radius,
        enemyPairMinY: y - radius,
        enemyPairMaxY: y + radius,
        enemyPairBroadRadius: radius,
        broadRadius: radius,
        boundRadius: radius,
        projectileBroadRadius: radius,
        movable: true,
        _broadDataIndex: -1
    };
    return Object.assign(body, overrides);
}

/**
 * candidate sweep record의 한 필드를 읽습니다.
 * @param {CollisionBroadphaseBuffer} buffer - 대상 버퍼입니다.
 * @param {number} bodyIndex - body 인덱스입니다.
 * @param {number} fieldIndex - record 필드 인덱스입니다.
 * @returns {number} 저장된 값입니다.
 */
function readCandidate(buffer, bodyIndex, fieldIndex) {
    return buffer.candidateSweepData[(bodyIndex * STRIDE) + fieldIndex];
}

/**
 * 실제 enemy prefix fast path와 같은 inclusive AABB 비교를 수행합니다.
 * @param {CollisionBroadphaseBuffer} buffer - 대상 버퍼입니다.
 * @param {number} indexA - 첫 body 인덱스입니다.
 * @param {number} indexB - 둘째 body 인덱스입니다.
 * @returns {boolean} 후보 sweep AABB가 겹치면 true입니다.
 */
function areCandidateAabbsOverlapping(buffer, indexA, indexB) {
    const offsetA = indexA * STRIDE;
    const offsetB = indexB * STRIDE;
    const data = buffer.candidateSweepData;
    return data[offsetA + INDEX.MIN_X] <= data[offsetB + INDEX.MAX_X]
        && data[offsetA + INDEX.MAX_X] >= data[offsetB + INDEX.MIN_X]
        && data[offsetA + INDEX.MIN_Y] <= data[offsetB + INDEX.MAX_Y]
        && data[offsetA + INDEX.MAX_Y] >= data[offsetB + INDEX.MIN_Y];
}

/**
 * 실제 enemy prefix fast path와 같은 inclusive sweep circle 비교를 수행합니다.
 * @param {CollisionBroadphaseBuffer} buffer - 대상 버퍼입니다.
 * @param {number} indexA - 첫 body 인덱스입니다.
 * @param {number} indexB - 둘째 body 인덱스입니다.
 * @param {number} epsilon - 판정 보정값입니다.
 * @returns {boolean} 후보 sweep circle이 겹치면 true입니다.
 */
function areCandidateCirclesOverlapping(buffer, indexA, indexB, epsilon) {
    const offsetA = indexA * STRIDE;
    const offsetB = indexB * STRIDE;
    const data = buffer.candidateSweepData;
    const dx = data[offsetB + INDEX.CENTER_X] - data[offsetA + INDEX.CENTER_X];
    const dy = data[offsetB + INDEX.CENTER_Y] - data[offsetA + INDEX.CENTER_Y];
    const radiusSum = data[offsetA + INDEX.RADIUS]
        + data[offsetB + INDEX.RADIUS]
        + data[offsetA + INDEX.PAD]
        + data[offsetB + INDEX.PAD]
        + epsilon;
    return ((dx * dx) + (dy * dy)) <= (radiusSum * radiusSum);
}

const buffer = new CollisionBroadphaseBuffer(1);
buffer.ensure(10);
assert.equal(buffer.candidateSweepData.BYTES_PER_ELEMENT, 8);
assert.ok(buffer.candidateSweepData.length >= 10 * STRIDE);
assert.ok(buffer.candidateSweepValidity.length >= 10);

// relation AABB와 fixed-frame sweep의 보수적 확장값을 Float64 record에 기록합니다.
const asymmetricBody = createEnemyBody({
    minX: -10,
    maxX: 10,
    minY: -8,
    maxY: 8,
    enemyPairMinX: -7.65,
    enemyPairMaxX: 7.65,
    enemyPairMinY: -6,
    enemyPairMaxY: 6,
    sweepMinX: -12,
    sweepMaxX: 12,
    sweepMinY: -9,
    sweepMaxY: 9,
    enemyPairBroadRadius: 5
});
buffer.write(0, asymmetricBody);
assert.equal(buffer.candidateSweepValidity[0], 1);
assertNear(readCandidate(buffer, 0, INDEX.MIN_X), -27.76875, 'asymmetric.minX');
assertNear(readCandidate(buffer, 0, INDEX.MAX_X), 27.76875, 'asymmetric.maxX');
assertNear(readCandidate(buffer, 0, INDEX.MIN_Y), -19.875, 'asymmetric.minY');
assertNear(readCandidate(buffer, 0, INDEX.MAX_Y), 19.875, 'asymmetric.maxY');
assertNear(readCandidate(buffer, 0, INDEX.PAD), 9.25, 'asymmetric.pad');

// AABB 한 변 접촉과 sweep circle 접선은 포함하고, 극소량 분리되면 거부합니다.
const boundaryDistance = 10 + 1e-6;
buffer.write(0, createEnemyBody({ id: 10, x: 0 }));
buffer.write(1, createEnemyBody({ id: 11, x: 10 }));
assert.equal(areCandidateAabbsOverlapping(buffer, 0, 1), true);
buffer.write(1, createEnemyBody({ id: 11, x: 10 + 1e-9 }));
assert.equal(areCandidateAabbsOverlapping(buffer, 0, 1), false);
buffer.write(1, createEnemyBody({ id: 11, x: boundaryDistance }));
assert.equal(areCandidateCirclesOverlapping(buffer, 0, 1, 1e-6), true);
buffer.write(1, createEnemyBody({ id: 11, x: boundaryDistance + 1e-9 }));
assert.equal(areCandidateCirclesOverlapping(buffer, 0, 1, 1e-6), false);

// enemyPair 반경이 비정상이면 circle radius를 broadRadius보다 먼저 사용합니다.
const radiusFallbackBody = createEnemyBody({
    radius: 1,
    enemyPairBroadRadius: Number.NaN,
    broadRadius: 100,
    boundRadius: 200
});
buffer.write(2, radiusFallbackBody);
assert.equal(buffer.candidateSweepValidity[2], 1);
assert.equal(readCandidate(buffer, 2, INDEX.RADIUS), 1);

// fail-open이 필요한 비정상 record와 non-enemy는 fast path에서 제외합니다.
buffer.write(3, createEnemyBody({
    centerX: Number.NaN,
    x: Number.NaN
}));
assert.equal(buffer.candidateSweepValidity[3], 0);
buffer.write(4, createEnemyBody({
    radius: 0,
    enemyPairBroadRadius: 0
}));
assert.equal(buffer.candidateSweepValidity[4], 0);
buffer.write(5, createEnemyBody({ kind: 'wall', shape: 'rect' }));
assert.equal(buffer.candidateSweepValidity[5], 0);

// 큰 좌표의 소수부가 Float32로 축소되지 않아야 합니다.
const largeCoordinate = 16_777_216.25;
buffer.write(6, createEnemyBody({ x: largeCoordinate, centerX: largeCoordinate }));
assert.equal(readCandidate(buffer, 6, INDEX.CENTER_X), largeCoordinate);

// translate는 fixed-frame sweep를 움직이지 않고 record를 무효화하며, 다음 write가 정확히 복구합니다.
const translatedBody = createEnemyBody({
    radius: 1,
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
    enemyPairMinX: -1,
    enemyPairMaxX: 1,
    enemyPairMinY: -1,
    enemyPairMaxY: 1,
    sweepMinX: -3,
    sweepMaxX: 3,
    sweepMinY: -1,
    sweepMaxY: 1,
    enemyPairBroadRadius: 1
});
buffer.write(7, translatedBody);
assertNear(readCandidate(buffer, 7, INDEX.MIN_X), -10.25, 'translate.before.minX');
assertNear(readCandidate(buffer, 7, INDEX.MAX_X), 10.25, 'translate.before.maxX');
assertNear(readCandidate(buffer, 7, INDEX.PAD), 2 * PAD_SCALE, 'translate.before.pad');

translatedBody.centerX += 1;
translatedBody.x += 1;
translatedBody.minX += 1;
translatedBody.maxX += 1;
translatedBody.enemyPairMinX += 1;
translatedBody.enemyPairMaxX += 1;
buffer.translateBody(translatedBody, 1, 0);
assert.equal(translatedBody.sweepMinX, -3);
assert.equal(translatedBody.sweepMaxX, 3);
assert.equal(buffer.candidateSweepValidity[7], 0);

buffer.write(7, translatedBody);
assert.equal(buffer.candidateSweepValidity[7], 1);
assertNear(readCandidate(buffer, 7, INDEX.MIN_X), -13.875, 'translate.after.minX');
assertNear(readCandidate(buffer, 7, INDEX.MAX_X), 6.625, 'translate.after.maxX');
assertNear(readCandidate(buffer, 7, INDEX.PAD), 3 * PAD_SCALE, 'translate.after.pad');

// 같은 index를 다른 shape로 다시 쓰면 shape code와 candidate record를 함께 갱신합니다.
translatedBody.shape = 'circleParts';
translatedBody.enemyPairBroadRadius = Number.NaN;
translatedBody.broadRadius = 4;
buffer.write(7, translatedBody);
assert.equal(buffer.bodyShapeCodes[7], COLLISION_BODY_SHAPE_CIRCLE_PARTS);
assert.equal(readCandidate(buffer, 7, INDEX.RADIUS), 4);

console.log('collision candidate sweep SoA contract: ok');
