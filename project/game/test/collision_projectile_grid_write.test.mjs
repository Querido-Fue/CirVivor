import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// VM loader가 공유 의존성을 안정적으로 재사용하도록 leaf 모듈부터 평가합니다.
for (const modulePath of [
    'data/data_handler.js',
    'util/number_util.js',
    'physics/collision_soa_layout.js',
    'physics/_collision_resolve_tuning.js'
]) {
    await loadGameModule(modulePath);
}

const broadphaseModule = await loadGameModule('physics/collision_broadphase_buffer.js');
const soaModule = await loadGameModule('physics/collision_soa_layout.js');

const { CollisionBroadphaseBuffer } = broadphaseModule;
const { COLLISION_BROAD_STRIDE } = soaModule;

/**
 * grid-only writer 계약 검증용 body를 생성합니다.
 * @param {object} [overrides={}] - 기본 필드를 덮어쓸 값입니다.
 * @returns {object}
 */
function createBody(overrides = {}) {
    return {
        kind: 'enemy',
        shape: 'circle',
        minX: -11.25,
        maxX: 12.5,
        minY: -13.75,
        maxY: 14.125,
        centerX: 0.625,
        centerY: -0.875,
        x: 0.625,
        y: -0.875,
        radius: 7.25,
        boundRadius: 9.5,
        broadRadius: 10.75,
        projectileMinX: -21.5,
        projectileMaxX: 22.25,
        projectileMinY: -23.5,
        projectileMaxY: 24.75,
        projectileBroadRadius: 18.625,
        enemyPairMinX: -15,
        enemyPairMaxX: 16,
        enemyPairMinY: -17,
        enemyPairMaxY: 18,
        enemyPairBroadRadius: 12,
        sweepMinX: -20,
        sweepMaxX: 21,
        sweepMinY: -22,
        sweepMaxY: 23,
        ...overrides
    };
}

/**
 * `Object.is` 기준으로 숫자 배열이 정확히 같은지 검증합니다.
 * @param {ArrayLike<number>} actual - 실제 배열입니다.
 * @param {ArrayLike<number>} expected - 기대 배열입니다.
 * @param {string} label - 오류 label입니다.
 */
function assertExactNumberArray(actual, expected, label) {
    assert.equal(actual.length, expected.length, `${label}.length`);
    for (let i = 0; i < actual.length; i++) {
        assert.ok(
            Object.is(actual[i], expected[i]),
            `${label}[${i}]: expected=${String(expected[i])}, actual=${String(actual[i])}`
        );
    }
}

/**
 * 범용 write와 grid-only write의 공통 결과를 비교합니다.
 * @param {object} bodyData - 양쪽 writer에 전달할 body 필드입니다.
 * @param {'default'|'enemyPair'|'projectile'} gridMode - 비교할 grid 계산 모드입니다.
 * @param {string} label - case label입니다.
 */
function assertGridOnlyWriteEquivalent(bodyData, gridMode, label) {
    const genericBuffer = new CollisionBroadphaseBuffer(4);
    const gridOnlyBuffer = new CollisionBroadphaseBuffer(4);
    const genericBody = createBody(bodyData);
    const gridOnlyBody = createBody(bodyData);
    const index = 2;

    genericBuffer.write(index, genericBody, gridMode);
    gridOnlyBuffer.writeGridOnly(index, gridOnlyBody, gridMode);

    const start = index * COLLISION_BROAD_STRIDE;
    assertExactNumberArray(
        gridOnlyBuffer.broadData.subarray(start, start + COLLISION_BROAD_STRIDE),
        genericBuffer.broadData.subarray(start, start + COLLISION_BROAD_STRIDE),
        `${label}.broadData`
    );
    assert.equal(gridOnlyBuffer.bodyKindCodes[index], genericBuffer.bodyKindCodes[index], `${label}.kind`);
    assert.equal(gridOnlyBuffer.bodyShapeCodes[index], genericBuffer.bodyShapeCodes[index], `${label}.shape`);
    assert.equal(gridOnlyBody._broadDataIndex, genericBody._broadDataIndex, `${label}.index`);
}

assertGridOnlyWriteEquivalent({}, 'projectile', 'projectile.enemy-circle');
assertGridOnlyWriteEquivalent({
    shape: 'circleParts',
    projectileMinX: Number.NaN,
    projectileMaxX: Number.POSITIVE_INFINITY,
    projectileMinY: -0,
    projectileMaxY: 16_777_216.25,
    projectileBroadRadius: Number.NaN,
    broadRadius: -0
}, 'projectile', 'projectile.enemy-parts-edge');
assertGridOnlyWriteEquivalent({
    kind: 'player',
    shape: 'rect',
    minX: Number.NEGATIVE_INFINITY,
    maxX: Number.POSITIVE_INFINITY,
    projectileMinX: -1,
    projectileMaxX: 1
}, 'projectile', 'projectile.non-enemy');
assertGridOnlyWriteEquivalent({
    kind: 'unregistered-kind',
    shape: 'unregistered-shape',
    centerX: Number.NaN,
    centerY: -0,
    boundRadius: Number.POSITIVE_INFINITY
}, 'projectile', 'projectile.unknown-codes');

const projectileAliasBuffer = new CollisionBroadphaseBuffer(1);
const projectileHelperBuffer = new CollisionBroadphaseBuffer(1);
const projectileAliasBody = createBody();
const projectileHelperBody = createBody();
projectileAliasBuffer.writeProjectileGrid(0, projectileAliasBody);
projectileHelperBuffer.writeGridOnly(0, projectileHelperBody, 'projectile');
assertExactNumberArray(
    projectileAliasBuffer.broadData,
    projectileHelperBuffer.broadData,
    'projectile.alias.broadData'
);
assert.equal(projectileAliasBuffer.bodyKindCodes[0], projectileHelperBuffer.bodyKindCodes[0]);
assert.equal(projectileAliasBuffer.bodyShapeCodes[0], projectileHelperBuffer.bodyShapeCodes[0]);
assert.equal(projectileAliasBody._broadDataIndex, projectileHelperBody._broadDataIndex);

assertGridOnlyWriteEquivalent({}, 'enemyPair', 'enemy-pair.enemy-circle');
assertGridOnlyWriteEquivalent({
    shape: 'circleParts',
    enemyPairMinX: Number.NaN,
    enemyPairMaxX: Number.POSITIVE_INFINITY,
    enemyPairMinY: -0,
    enemyPairMaxY: 16_777_216.25,
    enemyPairBroadRadius: Number.NaN,
    broadRadius: -0
}, 'enemyPair', 'enemy-pair.edge');

// grid-only writer는 현재 grid 소비자가 읽지 않는 relation/candidate plane을 건드리지 않습니다.
const planeBuffer = new CollisionBroadphaseBuffer(2);
planeBuffer.relationData.fill(123.5);
planeBuffer.candidateSweepData.fill(-234.5);
planeBuffer.candidateSweepValidity.fill(7);
const relationBefore = planeBuffer.relationData.slice();
const candidateBefore = planeBuffer.candidateSweepData.slice();
const validityBefore = planeBuffer.candidateSweepValidity.slice();
planeBuffer.writeGridOnly(0, createBody(), 'projectile');
assertExactNumberArray(planeBuffer.relationData, relationBefore, 'projectile.relation-untouched');
assertExactNumberArray(planeBuffer.candidateSweepData, candidateBefore, 'projectile.candidate-untouched');
assertExactNumberArray(planeBuffer.candidateSweepValidity, validityBefore, 'projectile.validity-untouched');

// 다음 범용 write는 전용 writer가 남긴 plane과 broad record를 모두 새 body 기준으로 덮어씁니다.
const reusedBuffer = new CollisionBroadphaseBuffer(2);
const freshBuffer = new CollisionBroadphaseBuffer(2);
for (const buffer of [reusedBuffer, freshBuffer]) {
    buffer.relationData.fill(31.25);
    buffer.candidateSweepData.fill(-47.5);
    buffer.candidateSweepValidity.fill(3);
}
reusedBuffer.writeGridOnly(0, createBody(), 'enemyPair');
const nextReusedBody = createBody({
    centerX: 50,
    centerY: 60,
    minX: 41,
    maxX: 59,
    minY: 51,
    maxY: 69,
    enemyPairMinX: 38,
    enemyPairMaxX: 62,
    enemyPairMinY: 48,
    enemyPairMaxY: 72,
    sweepMinX: 35,
    sweepMaxX: 65,
    sweepMinY: 45,
    sweepMaxY: 75
});
const nextFreshBody = createBody({ ...nextReusedBody });
reusedBuffer.write(0, nextReusedBody, 'enemyPair');
freshBuffer.write(0, nextFreshBody, 'enemyPair');
assertExactNumberArray(reusedBuffer.broadData, freshBuffer.broadData, 'overwrite.broadData');
assertExactNumberArray(reusedBuffer.relationData, freshBuffer.relationData, 'overwrite.relationData');
assertExactNumberArray(reusedBuffer.candidateSweepData, freshBuffer.candidateSweepData, 'overwrite.candidateData');
assertExactNumberArray(reusedBuffer.candidateSweepValidity, freshBuffer.candidateSweepValidity, 'overwrite.validity');
assertExactNumberArray(reusedBuffer.bodyKindCodes, freshBuffer.bodyKindCodes, 'overwrite.kind');
assertExactNumberArray(reusedBuffer.bodyShapeCodes, freshBuffer.bodyShapeCodes, 'overwrite.shape');
assert.equal(nextReusedBody._broadDataIndex, nextFreshBody._broadDataIndex, 'overwrite.index');

/**
 * body property 접근 순서를 추적하는 Proxy를 생성합니다.
 * @param {string[]} trace - 접근 기록 배열입니다.
 * @param {string|null} [throwProperty=null] - 읽을 때 예외를 던질 property입니다.
 * @returns {object}
 */
function createTrackedBody(trace, throwProperty = null) {
    const target = createBody();
    return new Proxy(target, {
        get(object, property, receiver) {
            trace.push(`get:${String(property)}`);
            if (property === throwProperty) {
                throw new Error(`throw:${String(property)}`);
            }
            return Reflect.get(object, property, receiver);
        },
        set(object, property, value, receiver) {
            trace.push(`set:${String(property)}`);
            return Reflect.set(object, property, value, receiver);
        }
    });
}

// 범용 write의 relation/candidate 추가 조회 전까지 공통 property 접근 순서가 동일해야 합니다.
for (const gridMode of ['projectile', 'enemyPair']) {
    const genericTrace = [];
    const gridOnlyTrace = [];
    new CollisionBroadphaseBuffer(1).write(0, createTrackedBody(genericTrace), gridMode);
    new CollisionBroadphaseBuffer(1).writeGridOnly(0, createTrackedBody(gridOnlyTrace), gridMode);
    assert.deepEqual(
        genericTrace.slice(0, gridOnlyTrace.length),
        gridOnlyTrace,
        `${gridMode}.property-order`
    );
}

// 공통 broad record 중간에 예외가 나도 접근 순서와 부분 write 상태가 같아야 합니다.
function captureCenterYThrow(useGridOnlyWriter) {
    const trace = [];
    const buffer = new CollisionBroadphaseBuffer(1);
    buffer.broadData.fill(91.25);
    const body = createTrackedBody(trace, 'centerY');
    let error = null;
    try {
        if (useGridOnlyWriter) {
            buffer.writeGridOnly(0, body, 'projectile');
        } else {
            buffer.write(0, body, 'projectile');
        }
    } catch (caught) {
        error = caught;
    }
    return { trace, buffer, body, error };
}

const genericThrow = captureCenterYThrow(false);
const projectileThrow = captureCenterYThrow(true);
assert.equal(genericThrow.error?.message, 'throw:centerY');
assert.equal(projectileThrow.error?.message, genericThrow.error?.message);
assert.deepEqual(projectileThrow.trace, genericThrow.trace);
assertExactNumberArray(projectileThrow.buffer.broadData, genericThrow.buffer.broadData, 'throw.broadData');
assertExactNumberArray(projectileThrow.buffer.bodyKindCodes, genericThrow.buffer.bodyKindCodes, 'throw.kind');
assertExactNumberArray(projectileThrow.buffer.bodyShapeCodes, genericThrow.buffer.bodyShapeCodes, 'throw.shape');
assert.equal(projectileThrow.body._broadDataIndex, genericThrow.body._broadDataIndex, 'throw.index');

console.log('collision grid-only write contract: ok');
