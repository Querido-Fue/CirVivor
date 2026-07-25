import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// VM test loader가 공유 의존성을 동시에 링크하지 않도록 공통 graph를 아래에서 위로 평가합니다.
for (const modulePath of [
    'util/number_util.js',
    'physics/collision_math_constants.js',
    'physics/collision_body_layout.js',
    'physics/collision_soa_layout.js',
    'physics/_collision_rules.js',
    'physics/collision_pair_rule_guard.js',
    'physics/_collision_resolve_tuning.js',
    'physics/collision_broad_phase_filter.js',
    'physics/collision_manifold_writer.js',
    'physics/collision_body_translation.js',
    'physics/collision_pair_resolver.js',
    'physics/collision_enemy_circle_pair_soa.js',
    'physics/collision_enemy_pair_budget.js',
    'physics/collision_enemy_sleep_state.js'
]) {
    await loadGameModule(modulePath);
}

const processorModule = await loadGameModule('physics/collision_candidate_pair_processor.js');
const pairBufferModule = await loadGameModule('physics/collision_candidate_pair_buffer.js');
const broadphaseModule = await loadGameModule('physics/collision_broadphase_buffer.js');
const detectorModule = await loadGameModule('physics/_collision_detector.js');
const bodyDetectorModule = await loadGameModule('physics/collision_body_detector.js');
const pairResolverModule = await loadGameModule('physics/collision_pair_resolver.js');
const pairRuleModule = await loadGameModule('physics/collision_pair_rule_guard.js');
const bodyTranslationModule = await loadGameModule('physics/collision_body_translation.js');
const scratchModule = await loadGameModule('physics/collision_scratch_objects.js');
const soaModule = await loadGameModule('physics/collision_soa_layout.js');
const tuningModule = await loadGameModule('physics/_collision_resolve_tuning.js');
const pairBudgetModule = await loadGameModule('physics/collision_enemy_pair_budget.js');

const { processCollisionCandidatePairs } = processorModule;
const { CollisionCandidatePairBuffer } = pairBufferModule;
const { CollisionBroadphaseBuffer } = broadphaseModule;
const { CollisionDetector } = detectorModule;
const { detectCollisionBodies } = bodyDetectorModule;
const { applyCollisionPairResolution } = pairResolverModule;
const { areCollisionBodiesSameEntity, getCollisionPassRule } = pairRuleModule;
const { applyCollisionBodyTranslation } = bodyTranslationModule;
const { createCollisionManifold } = scratchModule;
const {
    COLLISION_BODY_KIND_PLAYER,
    COLLISION_BROAD_STRIDE,
    COLLISION_RELATION_BROAD_STRIDE,
    COLLISION_RELATION_INDEX
} = soaModule;
const { ENEMY_PAIR_COLLISION_RADIUS_SCALE } = tuningModule;
const { getCollisionEnemyPairProcessBudget } = pairBudgetModule;

const EPSILON = 1e-8;

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
 * 테스트용 적 원본 객체를 생성합니다.
 * @param {number} x - X 좌표입니다.
 * @param {number} y - Y 좌표입니다.
 * @returns {object} 적 원본 객체입니다.
 */
function createEnemyRef(x, y) {
    return {
        type: 'square',
        position: { x, y },
        prevPosition: { x, y }
    };
}

/**
 * fast path와 범용 원형 판정이 같은 geometry를 사용하도록 적 body를 구성합니다.
 * @param {object} options - body 옵션입니다.
 * @returns {object} 테스트용 원형 적 body입니다.
 */
function createEnemyBody({ id, x, y = 0, radius = 10, ref = null }) {
    const enemyPairRadius = radius * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
    const enemyRef = ref || createEnemyRef(x, y);
    return {
        id,
        kind: 'enemy',
        shape: 'circle',
        ref: enemyRef,
        weight: 1,
        movable: true,
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
        boundRadius: radius,
        broadRadius: radius,
        resolveRadius: radius,
        velocityX: 0,
        velocityY: 0,
        enemyPairMinX: x - enemyPairRadius,
        enemyPairMaxX: x + enemyPairRadius,
        enemyPairMinY: y - enemyPairRadius,
        enemyPairMaxY: y + enemyPairRadius,
        enemyPairBroadRadius: enemyPairRadius,
        projectileMinX: x - radius,
        projectileMaxX: x + radius,
        projectileMinY: y - radius,
        projectileMaxY: y + radius,
        projectileBroadRadius: radius,
        circleParts: null,
        circlePartCount: 0,
        mergeLock: false,
        _sleeping: false,
        _sleepObservationIncomplete: false,
        _broadDataIndex: -1,
        _candidatePairCount: 0,
        _resolvedPairCount: 0,
        _passPairProcessCount: 0,
        _frameResolveMoved: 0,
        _frameResolveMax: Number.POSITIVE_INFINITY
    };
}

/**
 * 테스트용 충돌 통계를 생성합니다.
 * @returns {object} 기본 통계 객체입니다.
 */
function createFrameStats() {
    return {
        collisionCheckCount: 0,
        aabbPassCount: 0,
        aabbRejectCount: 0,
        circlePassCount: 0,
        circleRejectCount: 0,
        partChecks: 0
    };
}

/**
 * 후보 처리 프로파일 기록을 메모리 카운터로 대체합니다.
 * @returns {object} 프로파일 기록 stub입니다.
 */
function createProfileRecorder() {
    const counts = Object.create(null);
    return {
        counts,
        startTimer() {
            return null;
        },
        recordDuration() {},
        recordCount(fieldName, amount = 1) {
            counts[fieldName] = (counts[fieldName] || 0) + amount;
        }
    };
}

/**
 * 실제 범용 object pair 경로와 같은 순서로 원형 적 pair를 처리합니다.
 * @param {object} detector - 충돌 detector입니다.
 * @param {object} detectorContext - body detector context입니다.
 * @param {object} broadphaseBuffer - broad-phase buffer입니다.
 * @returns {Function} processObjectPair callback입니다.
 */
function createGenericPairProcessor(detector, detectorContext, broadphaseBuffer) {
    return (bodyA, bodyB, resolvePositions, applyNonPosition, resolveBoost, pairRule) => {
        if (areCollisionBodiesSameEntity(bodyA, bodyB)) return 0;
        const rule = pairRule || getCollisionPassRule(bodyA, bodyB, applyNonPosition);
        if (!rule?.check || (!rule.resolve && !applyNonPosition)) return 0;

        if (resolvePositions) {
            bodyA._candidatePairCount = (bodyA._candidatePairCount || 0) + 1;
            bodyB._candidatePairCount = (bodyB._candidatePairCount || 0) + 1;
        }

        const manifold = detectCollisionBodies(bodyA, bodyB, detectorContext);
        if (!manifold) return 0;

        if (resolvePositions) {
            bodyA._resolvedPairCount = (bodyA._resolvedPairCount || 0) + 1;
            bodyB._resolvedPairCount = (bodyB._resolvedPairCount || 0) + 1;
        }
        if (!rule.resolve || !resolvePositions) return 1;

        applyCollisionPairResolution(
            detector,
            manifold,
            bodyA,
            bodyB,
            rule.movableA,
            rule.movableB,
            resolveBoost,
            broadphaseBuffer
        );
        return 1;
    };
}

/**
 * fast 또는 강제 범용 분기로 후보 pair를 처리할 harness를 생성합니다.
 * @param {object[]} bodies - 충돌 body 목록입니다.
 * @param {object} [options={}] - 처리 옵션입니다.
 * @returns {object} 처리 harness입니다.
 */
function createPairHarness(bodies, options = {}) {
    const candidatePairs = new CollisionCandidatePairBuffer(8, 8);
    candidatePairs.reset(bodies.length);
    const pairs = Array.isArray(options.pairs) ? options.pairs : [[0, 1]];
    for (let i = 0; i < pairs.length; i++) {
        candidatePairs.append(pairs[i][0], pairs[i][1], true);
    }

    const broadphaseBuffer = new CollisionBroadphaseBuffer(8);
    broadphaseBuffer.ensure(bodies.length);
    for (let i = 0; i < bodies.length; i++) {
        broadphaseBuffer.write(i, bodies[i]);
    }
    if (options.forceGeneric === true) {
        broadphaseBuffer.bodyKindCodes[1] = COLLISION_BODY_KIND_PLAYER;
    }

    const detector = new CollisionDetector();
    const profileRecorder = createProfileRecorder();
    const detectorContext = {
        manifold: createCollisionManifold(),
        candidateManifold: createCollisionManifold(),
        bestManifold: createCollisionManifold(),
        profileRecorder
    };
    let genericCallbackCount = 0;
    const genericProcessor = createGenericPairProcessor(
        detector,
        detectorContext,
        broadphaseBuffer
    );
    const context = {
        bodies,
        candidatePairs,
        broadphaseBuffer,
        frameStats: createFrameStats(),
        profileRecorder,
        pairBudget: Number.isFinite(options.pairBudget)
            ? options.pairBudget
            : Number.POSITIVE_INFINITY,
        resolvePositions: options.resolvePositions !== false,
        applyNonPosition: false,
        resolveBoost: 1,
        detector,
        scratchManifold: createCollisionManifold(),
        processObjectPair(...args) {
            genericCallbackCount++;
            return genericProcessor(...args);
        },
        epsilon: 1e-6,
        pairStartToken: Number.isFinite(options.pairStartToken)
            ? options.pairStartToken
            : 0
    };

    return {
        bodies,
        broadphaseBuffer,
        context,
        profileRecorder,
        process() {
            return processCollisionCandidatePairs(context);
        },
        getGenericCallbackCount() {
            return genericCallbackCount;
        }
    };
}

/**
 * body의 이동 가능한 상태를 비교합니다.
 * @param {object} actual - 실제 body입니다.
 * @param {object} expected - 기대 body입니다.
 * @param {string} label - 비교 label입니다.
 */
function assertEquivalentBody(actual, expected, label) {
    const fields = [
        'centerX', 'centerY', 'x', 'y',
        'minX', 'maxX', 'minY', 'maxY',
        'enemyPairMinX', 'enemyPairMaxX', 'enemyPairMinY', 'enemyPairMaxY',
        '_frameResolveMoved', '_candidatePairCount', '_resolvedPairCount',
        '_passPairProcessCount'
    ];
    for (let i = 0; i < fields.length; i++) {
        const fieldName = fields[i];
        assertNear(actual[fieldName], expected[fieldName], `${label}.${fieldName}`);
    }
    assertNear(actual.ref.position.x, expected.ref.position.x, `${label}.ref.position.x`);
    assertNear(actual.ref.position.y, expected.ref.position.y, `${label}.ref.position.y`);
    assertNear(actual.ref.prevPosition.x, expected.ref.prevPosition.x, `${label}.ref.prevPosition.x`);
    assertNear(actual.ref.prevPosition.y, expected.ref.prevPosition.y, `${label}.ref.prevPosition.y`);
}

/**
 * 이동 후 body와 broad/relation SoA 좌표가 같은지 검증합니다.
 * @param {object} harness - 처리 harness입니다.
 * @param {number} bodyIndex - body 인덱스입니다.
 */
function assertBroadphaseSynchronized(harness, bodyIndex) {
    const body = harness.bodies[bodyIndex];
    const broadData = harness.broadphaseBuffer.broadData;
    const broadOffset = bodyIndex * COLLISION_BROAD_STRIDE;
    assertNear(broadData[broadOffset], body.minX, 'broad.minX', 1e-5);
    assertNear(broadData[broadOffset + 1], body.maxX, 'broad.maxX', 1e-5);
    assertNear(broadData[broadOffset + 2], body.minY, 'broad.minY', 1e-5);
    assertNear(broadData[broadOffset + 3], body.maxY, 'broad.maxY', 1e-5);
    assertNear(broadData[broadOffset + 8], body.centerX, 'broad.centerX', 1e-5);
    assertNear(broadData[broadOffset + 9], body.centerY, 'broad.centerY', 1e-5);

    const relationData = harness.broadphaseBuffer.relationData;
    const relationOffset = bodyIndex * COLLISION_RELATION_BROAD_STRIDE;
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.MIN_X],
        body.enemyPairMinX,
        'relation.minX'
    );
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.MAX_X],
        body.enemyPairMaxX,
        'relation.maxX'
    );
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.MIN_Y],
        body.enemyPairMinY,
        'relation.minY'
    );
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.MAX_Y],
        body.enemyPairMaxY,
        'relation.maxY'
    );
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.CENTER_X],
        body.centerX,
        'relation.centerX'
    );
    assertNear(
        relationData[relationOffset + COLLISION_RELATION_INDEX.CENTER_Y],
        body.centerY,
        'relation.centerY'
    );
}

/**
 * fast path와 강제 범용 path 결과를 비교합니다.
 * @param {string} caseName - case 이름입니다.
 * @param {() => object[]} createBodies - 새 body 목록 생성 함수입니다.
 * @param {number} expectedResolvedCount - 기대 처리 pair 수입니다.
 */
function assertFastPathMatchesGeneric(caseName, createBodies, expectedResolvedCount) {
    const fastHarness = createPairHarness(createBodies());
    const genericHarness = createPairHarness(createBodies(), { forceGeneric: true });
    const fastResolvedCount = fastHarness.process();
    const genericResolvedCount = genericHarness.process();

    assert.equal(fastResolvedCount, expectedResolvedCount, `${caseName}.fast resolved`);
    assert.equal(genericResolvedCount, expectedResolvedCount, `${caseName}.generic resolved`);
    assert.equal(
        genericHarness.getGenericCallbackCount(),
        expectedResolvedCount > 0 ? 1 : 0,
        `${caseName}.generic callback count`
    );
    assert.deepEqual(fastHarness.context.frameStats, genericHarness.context.frameStats);
    for (let i = 0; i < fastHarness.bodies.length; i++) {
        assertEquivalentBody(
            fastHarness.bodies[i],
            genericHarness.bodies[i],
            `${caseName}.body${i}`
        );
        assertBroadphaseSynchronized(fastHarness, i);
        assertBroadphaseSynchronized(genericHarness, i);
    }
}

assertFastPathMatchesGeneric(
    'overlap',
    () => [
        createEnemyBody({ id: 1, x: 0 }),
        createEnemyBody({ id: 2, x: 10 })
    ],
    1
);
assertFastPathMatchesGeneric(
    'separated',
    () => [
        createEnemyBody({ id: 1, x: 0 }),
        createEnemyBody({ id: 2, x: 40 })
    ],
    0
);
assertFastPathMatchesGeneric(
    'same-ref',
    () => {
        const sharedRef = createEnemyRef(0, 0);
        return [
            createEnemyBody({ id: 1, x: 0, ref: sharedRef }),
            createEnemyBody({ id: 2, x: 10, ref: sharedRef })
        ];
    },
    0
);
assertFastPathMatchesGeneric(
    'same-id',
    () => [
        createEnemyBody({ id: 7, x: 0 }),
        createEnemyBody({ id: 7, x: 10 })
    ],
    0
);
assertFastPathMatchesGeneric(
    'negative-placeholder-id',
    () => [
        createEnemyBody({ id: -1, x: 0 }),
        createEnemyBody({ id: -1, x: 10 })
    ],
    1
);

const sharedRef = createEnemyRef(0, 0);
const sameRefBodyA = createEnemyBody({ id: 1, x: 0, ref: sharedRef });
const sameRefBodyB = createEnemyBody({ id: 2, x: 10, ref: sharedRef });
assert.equal(areCollisionBodiesSameEntity(sameRefBodyA, sameRefBodyB), true);
assert.equal(getCollisionPassRule(sameRefBodyA, sameRefBodyB, false), null);
const sameIdBodyA = createEnemyBody({ id: 4, x: 0 });
const sameIdBodyB = createEnemyBody({ id: 4, x: 10 });
assert.equal(areCollisionBodiesSameEntity(sameIdBodyA, sameIdBodyB), true);
assert.equal(getCollisionPassRule(sameIdBodyA, sameIdBodyB, false), null);

// Grid/candidate rebuild 없이 body translation만 수행해도 다음 pass의 SoA 판정이 최신 위치를 봐야 합니다.
const translatedHarness = createPairHarness([
    createEnemyBody({ id: 11, x: 0 }),
    createEnemyBody({ id: 12, x: 10 })
], { resolvePositions: false });
assert.equal(translatedHarness.process(), 1);
assert.equal(
    applyCollisionBodyTranslation(
        translatedHarness.bodies[1],
        100,
        0,
        1,
        translatedHarness.broadphaseBuffer
    ),
    true
);
assertBroadphaseSynchronized(translatedHarness, 1);
assert.equal(translatedHarness.process(), 0);
assert.equal(
    applyCollisionBodyTranslation(
        translatedHarness.bodies[1],
        -100,
        0,
        1,
        translatedHarness.broadphaseBuffer
    ),
    true
);
assertBroadphaseSynchronized(translatedHarness, 1);
assert.equal(translatedHarness.process(), 1);

assert.equal(getCollisionEnemyPairProcessBudget(true, false, 1), 14);
assert.equal(getCollisionEnemyPairProcessBudget(true, false, 1.1), 10);
assert.equal(getCollisionEnemyPairProcessBudget(true, true, 1), 8);

// Pair process budget이 한 body에 걸릴 때 시작 token에 따라 처리 pair가 회전해야 합니다.
for (let startToken = 0; startToken < 3; startToken++) {
    const budgetHarness = createPairHarness([
        createEnemyBody({ id: 20, x: 0 }),
        createEnemyBody({ id: 21, x: 6 }),
        createEnemyBody({ id: 22, x: 8 }),
        createEnemyBody({ id: 23, x: 10 })
    ], {
        pairs: [[0, 1], [0, 2], [0, 3]],
        pairBudget: 1,
        pairStartToken: startToken
    });
    assert.equal(budgetHarness.process(), 1, `budget token ${startToken} resolved count`);
    assert.equal(budgetHarness.context.frameStats.collisionCheckCount, 1);
    assert.equal(budgetHarness.profileRecorder.counts.solveBudgetSkipCount, 2);

    const processedHighIndex = startToken + 1;
    for (let highIndex = 1; highIndex <= 3; highIndex++) {
        const body = budgetHarness.bodies[highIndex];
        assert.equal(
            body._passPairProcessCount,
            highIndex === processedHighIndex ? 1 : 0,
            `budget token ${startToken}, high ${highIndex} process count`
        );
        assert.equal(
            body._sleepObservationIncomplete,
            highIndex !== processedHighIndex,
            `budget token ${startToken}, high ${highIndex} sleep observation`
        );
    }
    assert.equal(budgetHarness.bodies[0]._sleepObservationIncomplete, true);
}

console.log('collision enemy fast path contract: ok');
