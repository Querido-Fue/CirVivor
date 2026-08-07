import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// 공유 의존성을 먼저 평가해 VM module graph의 중복 링크를 피합니다.
const abi = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const reference = await loadGameModule('ingame/physics/gpu/gpu_collision_reference.js');

const {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    packGpuCircleInteractionMeta,
    packGpuCirclePhysicsMeta,
    packGpuCircleSimulationMeta
} = abi;
const {
    GPU_COLLISION_NEIGHBOR_OFFSETS,
    GPU_COLLISION_REFERENCE,
    buildGpuCollisionReferenceGrid,
    interpolateStrictGpuCirclePosition,
    isGpuCircleInteractionPairEnabled,
    isGpuCirclePhysicalPairEnabled,
    predictReferenceGpuCirclePosition,
    solveGpuCollisionReference
} = reference;

const NUMERIC_EPSILON = 2e-5;
const DEFAULT_OPTIONS = Object.freeze({
    worldSize: Object.freeze({ x: 100, y: 100 }),
    gridCellSize: Object.freeze({ x: 10, y: 10 }),
    dt: 1 / 60
});

/**
 * 두 수가 oracle 허용 오차 안인지 검증합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} message - 실패 메시지입니다.
 */
function assertNear(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= NUMERIC_EPSILON,
        `${message}: expected=${expected}, actual=${actual}`
    );
}

/**
 * VM context에서 발생한 오류를 realm 독립적으로 검증합니다.
 * @param {Function} callback - 오류를 발생시킬 함수입니다.
 * @param {string} expectedName - 기대 오류 이름입니다.
 */
function assertThrowsNamed(callback, expectedName) {
    assert.throws(callback, (error) => error?.name === expectedName);
}

/**
 * collision reference body를 만듭니다.
 * @param {*} options - override입니다.
 * @returns {*} body 입력입니다.
 */
function makeBody(options = {}) {
    const position = options.position ?? { x: 40, y: 50 };
    const previousPosition = options.previousPosition ?? position;
    const predictedPosition = options.predictedPosition ?? position;
    const layerMask = options.layerMask ?? 1;
    const interactionLayer = options.interactionLayer ?? layerMask;
    return {
        position: { x: position.x, y: position.y },
        previousPosition: { x: previousPosition.x, y: previousPosition.y },
        predictedPosition: { x: predictedPosition.x, y: predictedPosition.y },
        velocity: {
            x: options.velocity?.x ?? 0,
            y: options.velocity?.y ?? 0
        },
        radius: options.radius ?? 1,
        inverseMass: options.inverseMass ?? 1,
        physicsMeta: options.physicsMeta
            ?? packGpuCirclePhysicsMeta(layerMask, options.collisionMask ?? 1),
        interactionMeta: options.interactionMeta
            ?? packGpuCircleInteractionMeta(
                interactionLayer,
                options.interactionMask ?? 0
            ),
        simulationMeta: options.simulationMeta
            ?? packGpuCircleSimulationMeta(options.alive === false ? 0 : 1)
    };
}

// Physical/interaction pair는 서로 독립이며 각각 reciprocal mask를 요구합니다.
const enemyPhysical = packGpuCirclePhysicsMeta(1, 1 | 64);
const proxyPhysical = packGpuCirclePhysicsMeta(64, 1);
const projectilePhysical = packGpuCirclePhysicsMeta(2, 0);
const enemyInteraction = packGpuCircleInteractionMeta(1, 2);
const projectileInteraction = packGpuCircleInteractionMeta(2, 1);
const noInteraction = packGpuCircleInteractionMeta(64, 0);
assert.equal(isGpuCirclePhysicalPairEnabled(enemyPhysical, proxyPhysical), true);
assert.equal(isGpuCircleInteractionPairEnabled(enemyInteraction, noInteraction), false);
assert.equal(isGpuCirclePhysicalPairEnabled(enemyPhysical, projectilePhysical), false);
assert.equal(
    isGpuCircleInteractionPairEnabled(enemyInteraction, projectileInteraction),
    true
);
assert.equal(
    isGpuCirclePhysicalPairEnabled(
        packGpuCirclePhysicsMeta(1, 2),
        packGpuCirclePhysicsMeta(2, 0)
    ),
    false
);

const pairMatrix = [
    {
        name: 'physical-only',
        physicalA: packGpuCirclePhysicsMeta(1, 2),
        physicalB: packGpuCirclePhysicsMeta(2, 1),
        interactionA: packGpuCircleInteractionMeta(1, 0),
        interactionB: packGpuCircleInteractionMeta(2, 0),
        solver: true,
        event: false
    },
    {
        name: 'interaction-only',
        physicalA: packGpuCirclePhysicsMeta(1, 0),
        physicalB: packGpuCirclePhysicsMeta(2, 0),
        interactionA: packGpuCircleInteractionMeta(1, 2),
        interactionB: packGpuCircleInteractionMeta(2, 1),
        solver: false,
        event: true
    },
    {
        name: 'physical-and-interaction',
        physicalA: packGpuCirclePhysicsMeta(1, 2),
        physicalB: packGpuCirclePhysicsMeta(2, 1),
        interactionA: packGpuCircleInteractionMeta(1, 2),
        interactionB: packGpuCircleInteractionMeta(2, 1),
        solver: true,
        event: true
    },
    {
        name: 'neither',
        physicalA: packGpuCirclePhysicsMeta(1, 0),
        physicalB: packGpuCirclePhysicsMeta(2, 0),
        interactionA: packGpuCircleInteractionMeta(1, 0),
        interactionB: packGpuCircleInteractionMeta(2, 0),
        solver: false,
        event: false
    },
    {
        name: 'projectile-to-enemy',
        physicalA: projectilePhysical,
        physicalB: enemyPhysical,
        interactionA: projectileInteraction,
        interactionB: enemyInteraction,
        solver: false,
        event: true
    },
    {
        name: 'benchmark-proxy-to-enemy',
        physicalA: proxyPhysical,
        physicalB: enemyPhysical,
        interactionA: noInteraction,
        interactionB: enemyInteraction,
        solver: true,
        event: false
    }
];
for (const entry of pairMatrix) {
    assert.equal(
        isGpuCirclePhysicalPairEnabled(entry.physicalA, entry.physicalB),
        entry.solver,
        `${entry.name} solver predicate`
    );
    assert.equal(
        isGpuCircleInteractionPairEnabled(entry.interactionA, entry.interactionB),
        entry.event,
        `${entry.name} event predicate`
    );
}

// candidate scan 순서는 원본의 row-major 주변 9셀 순서입니다.
const expectedNeighbors = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [0, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
];
assert.equal(GPU_COLLISION_NEIGHBOR_OFFSETS.length, expectedNeighbors.length);
for (let index = 0; index < expectedNeighbors.length; index += 1) {
    assert.equal(GPU_COLLISION_NEIGHBOR_OFFSETS[index].x, expectedNeighbors[index][0]);
    assert.equal(GPU_COLLISION_NEIGHBOR_OFFSETS[index].y, expectedNeighbors[index][1]);
}
assert.equal(GPU_COLLISION_REFERENCE.CELL_CAPACITY, 64);
assert.equal(GPU_COLLISION_REFERENCE.SOLVER_ITERATIONS, 6);

// 두 equal-mass 원은 6회 Jacobi 뒤 대칭적으로 분리되고 입력은 변경되지 않습니다.
const equalMassInput = [
    makeBody({ position: { x: 40, y: 50 } }),
    makeBody({ position: { x: 41, y: 50 } })
];
const equalMassBefore = JSON.stringify(equalMassInput);
const equalMassResult = solveGpuCollisionReference(equalMassInput, DEFAULT_OPTIONS);
assert.equal(JSON.stringify(equalMassInput), equalMassBefore);
assert.equal(equalMassResult.stats.gridBuildCount, 1);
assert.equal(equalMassResult.stats.solverIterations, 6);
assert.equal(equalMassResult.stats.smallOverflowCount, 0);
assert.equal(equalMassResult.stats.bigOverflowCount, 0);
const equalA = equalMassResult.bodies[0];
const equalB = equalMassResult.bodies[1];
assertNear(equalA.position.x, 39.5, 'equal mass body A corrected x');
assertNear(equalB.position.x, 41.5, 'equal mass body B corrected x');
assertNear(equalA.position.y, 50, 'equal mass body A y');
assertNear(equalB.position.y, 50, 'equal mass body B y');
assertNear(equalA.position.x + equalB.position.x, 81, 'equal mass center conservation');
assert.ok(equalB.position.x - equalA.position.x > 1.9996);
assert.equal(equalA.previousPosition.x, 40);
assert.equal(equalB.previousPosition.x, 41);
assertNear(
    equalA.velocity.x,
    (equalA.predictedPosition.x - equalA.previousPosition.x) / DEFAULT_OPTIONS.dt,
    'velocity rebuild A'
);
assertNear(
    equalB.velocity.x,
    (equalB.predictedPosition.x - equalB.previousPosition.x) / DEFAULT_OPTIONS.dt,
    'velocity rebuild B'
);

// 서로 다른 inverse mass는 correction 비율에도 그대로 반영됩니다.
const unequalResult = solveGpuCollisionReference([
    makeBody({ position: { x: 40, y: 50 }, inverseMass: 1 }),
    makeBody({ position: { x: 41, y: 50 }, inverseMass: 0.5 })
], DEFAULT_OPTIONS);
const movementA = 40 - unequalResult.bodies[0].position.x;
const movementB = unequalResult.bodies[1].position.x - 41;
assertNear(movementA / movementB, 2, 'inverse mass correction ratio');
assertNear(unequalResult.bodies[0].position.x, 39.33333206176758, 'unequal body A x');
assertNear(unequalResult.bodies[1].position.x, 41.33333206176758, 'unequal body B x');

// static small 원은 candidate로 남되 움직이지 않고 dynamic 원만 해소합니다.
const staticResult = solveGpuCollisionReference([
    makeBody({ position: { x: 40, y: 50 }, inverseMass: 1 }),
    makeBody({ position: { x: 41, y: 50 }, inverseMass: 0 })
], DEFAULT_OPTIONS);
assertNear(staticResult.bodies[0].position.x, 39, 'dynamic against static x');
assert.equal(staticResult.bodies[1].position.x, 41);
assert.equal(staticResult.bodies[1].velocity.x, 0);

// benchmark player proxy는 기존 small-grid solver에서 enemy만 밀고 자신은 고정됩니다.
const benchmarkEnemyRadius = 0.5939696961966999 * 0.5;
const benchmarkPlayerRadius = 0.72;
const benchmarkProxyResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 32.2, y: 18 },
        radius: benchmarkEnemyRadius,
        layerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
    }),
    makeBody({
        position: { x: 32, y: 18 },
        radius: benchmarkPlayerRadius,
        inverseMass: 0,
        layerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
    })
], {
    worldSize: { x: 64, y: 36 },
    gridCellSize: { x: 1.5, y: 1.5 },
    dt: 1 / 60
});
assert.ok(
    Math.hypot(
        benchmarkProxyResult.bodies[0].position.x
            - benchmarkProxyResult.bodies[1].position.x,
        benchmarkProxyResult.bodies[0].position.y
            - benchmarkProxyResult.bodies[1].position.y
    ) >= benchmarkEnemyRadius + benchmarkPlayerRadius - NUMERIC_EPSILON
);
assert.equal(benchmarkProxyResult.bodies[1].position.x, 32);
assert.equal(benchmarkProxyResult.bodies[1].position.y, 18);
assert.equal(benchmarkProxyResult.stats.smallOverflowCount, 0);
assert.equal(benchmarkProxyResult.stats.bigOverflowCount, 0);

// 큰 static 후보가 있어도 작은 dynamic body는 primary bucket에 남아 보정됩니다.
const largeStaticResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 5, y: 5 },
        radius: 0.25,
        inverseMass: 1,
        entityId: 31
    }),
    makeBody({
        position: { x: 5.5, y: 5 },
        radius: 0.9,
        inverseMass: 0,
        entityId: 32
    })
], {
    worldSize: { x: 10, y: 10 },
    gridCellSize: { x: 1, y: 1 },
    dt: 1 / 60
});
assert.ok(
    largeStaticResult.bodies[1].position.x
        - largeStaticResult.bodies[0].position.x
        >= 1.149
);
assert.equal(largeStaticResult.bodies[1].position.x, 5.5);
assert.ok(largeStaticResult.grid.counts.some((_, index) => (
    index % 2 === 1 && largeStaticResult.grid.counts[index] > 0
)));

// 동일 위치 epsilon branch는 entity/body identity 기반 반대칭 normal을 사용합니다.
const coincidentResult = solveGpuCollisionReference([
    makeBody({ position: { x: 40, y: 50 } }),
    makeBody({ position: { x: 40, y: 50 } })
], DEFAULT_OPTIONS);
assert.ok(coincidentResult.bodies[0].position.x > 40);
assertNear(
    coincidentResult.bodies[0].position.x + coincidentResult.bodies[1].position.x,
    80,
    'coincident center conservation'
);
assertNear(coincidentResult.bodies[0].position.x, 41, 'coincident body A x');
assertNear(coincidentResult.bodies[1].position.x, 39, 'coincident body B x');
assert.equal(coincidentResult.bodies[0].position.y, 50);

// 서로 다른 셀의 원도 row-major 9-cell scan으로 경계를 넘어 해소됩니다.
const boundaryResult = solveGpuCollisionReference([
    makeBody({ position: { x: 9.75, y: 50 }, radius: 0.5 }),
    makeBody({ position: { x: 10.25, y: 50 }, radius: 0.5 })
], DEFAULT_OPTIONS);
assert.ok(boundaryResult.bodies[0].position.x < 9.75);
assert.ok(boundaryResult.bodies[1].position.x > 10.25);
assert.ok(
    boundaryResult.bodies[1].position.x - boundaryResult.bodies[0].position.x > 0.9996
);

// dead 슬롯은 primary/candidate 어느 쪽에서도 pair solve에 참여하지 않습니다.
const deadResult = solveGpuCollisionReference([
    makeBody({ position: { x: 40, y: 50 }, alive: false }),
    makeBody({ position: { x: 41, y: 50 }, inverseMass: 0 })
], DEFAULT_OPTIONS);
assert.equal(deadResult.bodies[0].position.x, 40);
assert.equal(deadResult.bodies[1].position.x, 41);
assert.equal(deadResult.grid.counts.reduce((sum, value) => sum + value, 0), 1);

const deadCandidateResult = solveGpuCollisionReference([
    makeBody({ position: { x: 40, y: 50 } }),
    makeBody({ position: { x: 41, y: 50 }, alive: false })
], DEFAULT_OPTIONS);
assert.equal(deadCandidateResult.bodies[0].position.x, 40);
assert.equal(deadCandidateResult.bodies[1].position.x, 41);
assert.equal(deadCandidateResult.grid.counts.reduce((sum, value) => sum + value, 0), 1);

// cell cap만큼의 active 슬롯 뒤 tombstone이 와도 거짓 overflow/halt를 만들지 않습니다.
const capacityBodiesWithTombstone = Array.from({ length: 64 }, (_, index) => makeBody({
    position: { x: 5 + (index * 0.001), y: 5 },
    radius: 0
}));
capacityBodiesWithTombstone.push(makeBody({
    position: { x: 5.5, y: 5 },
    radius: 0,
    alive: false
}));
const capacityWithTombstoneResult = solveGpuCollisionReference(capacityBodiesWithTombstone, {
    ...DEFAULT_OPTIONS,
    haltOnGridOverflow: true
});
assert.equal(capacityWithTombstoneResult.grid.counts[0], 64);
assert.equal(capacityWithTombstoneResult.stats.smallOverflowCount, 0);
assert.equal(capacityWithTombstoneResult.stats.haltedOnOverflow, false);
assert.equal(capacityWithTombstoneResult.bodies[64].gridIndex, -1);

// inactive big dynamic 슬롯도 WGSL처럼 big/static 검증과 grid 삽입 전에 제외됩니다.
const inactiveBigGrid = buildGpuCollisionReferenceGrid([
    makeBody({ radius: 10, inverseMass: 1, alive: false })
], DEFAULT_OPTIONS);
assert.equal(inactiveBigGrid.counts.reduce((sum, value) => sum + value, 0), 0);

// cell cap 64를 넘으면 raw occupancy/overflow를 보존하되 65번째는 gridIndex=-1입니다.
const overflowBodies = Array.from({ length: 65 }, (_, index) => makeBody({
    position: { x: 5 + (index * 0.0001), y: 5 },
    radius: 0.1
}));
const overflowResult = solveGpuCollisionReference(overflowBodies, DEFAULT_OPTIONS);
assert.equal(overflowResult.grid.counts[0], 65);
assert.equal(overflowResult.stats.smallOverflowCount, 1);
assert.equal(overflowResult.bodies.filter((body) => body.gridIndex >= 0).length, 64);
assert.equal(overflowResult.bodies[64].gridIndex, -1);
for (const body of overflowResult.bodies) {
    assert.ok(Number.isFinite(body.position.x));
    assert.ok(Number.isFinite(body.position.y));
}
const haltedOverflowResult = solveGpuCollisionReference(overflowBodies, {
    ...DEFAULT_OPTIONS,
    haltOnGridOverflow: true
});
assert.equal(haltedOverflowResult.stats.haltedOnOverflow, true);
assert.equal(haltedOverflowResult.stats.solverIterations, 0);
assert.equal(haltedOverflowResult.bodies[0].position.x, 5);

const haltedOverflowWithTombstone = solveGpuCollisionReference([
    ...overflowBodies,
    makeBody({
        position: { x: 20, y: 30 },
        previousPosition: { x: 10, y: 12 },
        predictedPosition: { x: 25, y: 35 },
        velocity: { x: 7, y: -3 },
        alive: false
    })
], {
    ...DEFAULT_OPTIONS,
    haltOnGridOverflow: true
});
const overflowTombstone = haltedOverflowWithTombstone.bodies[65];
assert.equal(overflowTombstone.position.x, 20);
assert.equal(overflowTombstone.position.y, 30);
assert.equal(overflowTombstone.predictedPosition.x, 25);
assert.equal(overflowTombstone.predictedPosition.y, 35);
assert.equal(overflowTombstone.velocity.x, 7);
assert.equal(overflowTombstone.velocity.y, -3);
assert.equal(overflowTombstone.gridIndex, -1);

// out-of-bounds body는 stale grid slot을 갖지 않으며 enemy clamp가 render previous를 바꾸지 않습니다.
const outOfBoundsResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 99, y: 50 },
        previousPosition: { x: 99, y: 50 },
        predictedPosition: { x: 120, y: 50 }
    })
], DEFAULT_OPTIONS);
const clampedBody = outOfBoundsResult.bodies[0];
assert.equal(clampedBody.gridIndex, -1);
assertNear(clampedBody.position.x, 99.9, 'out-of-world clamp x');
assert.equal(clampedBody.previousPosition.x, 99);
assert.equal(clampedBody.predictedPosition.x, 120);
assert.equal(clampedBody.velocity.x, 0);
const outOfBoundsGrid = buildGpuCollisionReferenceGrid([
    makeBody({ position: { x: -1, y: 50 } })
], DEFAULT_OPTIONS);
assert.equal(outOfBoundsGrid.counts.reduce((sum, value) => sum + value, 0), 0);

// big body는 static-only이며 overflow된 raw big count도 solver에서 64로 clamp되어 OOB가 없습니다.
assertThrowsNamed(() => solveGpuCollisionReference([
    makeBody({ radius: 10, inverseMass: 1 })
], DEFAULT_OPTIONS), 'RangeError');
assertThrowsNamed(() => solveGpuCollisionReference([
    makeBody({ inverseMass: GPU_COLLISION_REFERENCE.MASS_EPSILON })
], DEFAULT_OPTIONS), 'RangeError');
assertThrowsNamed(() => solveGpuCollisionReference([
    makeBody({
        position: { x: -20, y: 50 },
        radius: 10,
        inverseMass: 1
    })
], DEFAULT_OPTIONS), 'RangeError');
const manyBigBodies = [makeBody({ position: { x: 50, y: 40 }, radius: 1 })];
for (let index = 0; index < 65; index += 1) {
    manyBigBodies.push(makeBody({
        position: { x: 50 + (index * 0.001), y: 50 },
        radius: 10,
        inverseMass: 0
    }));
}
const bigOverflowResult = solveGpuCollisionReference(manyBigBodies, DEFAULT_OPTIONS);
assert.ok(bigOverflowResult.stats.bigOverflowCount > 0);
assert.ok(Number.isFinite(bigOverflowResult.bodies[0].position.x));
assert.ok(Number.isFinite(bigOverflowResult.bodies[0].position.y));

// 지름이 cell을 넘는 static proxy는 단일 small slot이 아니라 big coverage를 사용합니다.
const staticProxyGrid = buildGpuCollisionReferenceGrid([
    makeBody({ position: { x: 50, y: 50 }, radius: 6, inverseMass: 0 })
], DEFAULT_OPTIONS);
assert.equal(staticProxyGrid.counts[0], 0);
assert.ok(staticProxyGrid.counts.some((count, index) => index % 2 === 1 && count > 0));

// optional SDF hook은 terrain mask body를 world gradient 방향으로 radius 이하 보정합니다.
const sdfResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 0.5, y: 50 },
        radius: 1,
        collisionMask: GPU_COLLISION_REFERENCE.TERRAIN_LAYER_MASK
    })
], {
    ...DEFAULT_OPTIONS,
    sdfSample(x) {
        return { distance: x, gradientX: 1, gradientY: 0 };
    }
});
assertNear(sdfResult.bodies[0].position.x, 1, 'SDF world correction x');
assert.equal(sdfResult.bodies[0].position.y, 50);
assert.equal(sdfResult.bodies[0].previousPosition.x, 0.5);
assertNear(sdfResult.bodies[0].velocity.x, 30, 'SDF velocity rebuild');

// terrain pass는 같은 iteration에서 먼저 누적된 body-body delta까지 평가합니다.
const combinedConstraintResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 1.1, y: 50 },
        radius: 1,
        collisionMask: 1 | GPU_COLLISION_REFERENCE.TERRAIN_LAYER_MASK
    }),
    makeBody({
        position: { x: 2.5, y: 50 },
        radius: 1,
        inverseMass: 0
    })
], {
    ...DEFAULT_OPTIONS,
    sdfSample(x) {
        return { distance: x, gradientX: 1, gradientY: 0 };
    }
});
assertNear(
    combinedConstraintResult.bodies[0].position.x,
    1,
    'body delta and terrain constraint compose in one iteration'
);
assert.equal(combinedConstraintResult.bodies[1].position.x, 2.5);

// tombstone은 SDF, delta apply, velocity rebuild/final output 어느 단계에서도 변경되지 않습니다.
let inactiveSdfSampleCount = 0;
const inactivePipelineResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 20, y: 30 },
        previousPosition: { x: 10, y: 12 },
        predictedPosition: { x: 0.25, y: 30 },
        velocity: { x: 7, y: -3 },
        collisionMask: GPU_COLLISION_REFERENCE.TERRAIN_LAYER_MASK,
        alive: false
    })
], {
    ...DEFAULT_OPTIONS,
    sdfSample() {
        inactiveSdfSampleCount += 1;
        return { distance: -10, gradientX: 1, gradientY: 0 };
    }
});
const inactivePipelineBody = inactivePipelineResult.bodies[0];
assert.equal(inactiveSdfSampleCount, 0);
assert.equal(inactivePipelineBody.gridIndex, -1);
assert.equal(inactivePipelineBody.position.x, 20);
assert.equal(inactivePipelineBody.position.y, 30);
assert.equal(inactivePipelineBody.previousPosition.x, 10);
assert.equal(inactivePipelineBody.previousPosition.y, 12);
assert.equal(inactivePipelineBody.predictedPosition.x, 0.25);
assert.equal(inactivePipelineBody.predictedPosition.y, 30);
assert.equal(inactivePipelineBody.positionDelta.x, 0);
assert.equal(inactivePipelineBody.positionDelta.y, 0);
assert.equal(inactivePipelineBody.velocity.x, 7);
assert.equal(inactivePipelineBody.velocity.y, -3);

// gradient callback을 생략하면 원본처럼 world ±1 sample을 UV epsilon으로 나눕니다.
const nonSquareSdfResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 50, y: 50 },
        radius: 1,
        collisionMask: GPU_COLLISION_REFERENCE.TERRAIN_LAYER_MASK
    })
], {
    worldSize: { x: 200, y: 100 },
    gridCellSize: { x: 10, y: 10 },
    dt: 1 / 60,
    sdfSample(x, y) {
        return x + y - 99.5;
    }
});
assertNear(nonSquareSdfResult.bodies[0].position.x, 50.44721221923828, 'UV SDF x');
assertNear(nonSquareSdfResult.bodies[0].position.y, 50.22360610961914, 'UV SDF y');
assertNear(
    (nonSquareSdfResult.bodies[0].position.x - 50)
        / (nonSquareSdfResult.bodies[0].position.y - 50),
    2,
    'UV SDF aspect ratio'
);

// production scale에서도 원본 UV-gradient 비율과 scale된 clamp inset을 유지합니다.
const scaledClampResult = solveGpuCollisionReference([
    makeBody({
        position: { x: 99, y: 50 },
        previousPosition: { x: 99, y: 50 },
        predictedPosition: { x: 120, y: 50 }
    })
], {
    ...DEFAULT_OPTIONS,
    sourceWorldUnitScale: 0.125
});
assertNear(scaledClampResult.bodies[0].position.x, 99.9875, 'scaled clamp x');
assert.equal(scaledClampResult.bodies[0].predictedPosition.x, 120);

// strict interpolation은 alpha 0/0.5/1을 정확히 따르고 범위 밖 alpha를 거부합니다.
const previous = { x: -4, y: 8 };
const current = { x: 6, y: -2 };
const interpolation0 = interpolateStrictGpuCirclePosition(previous, current, 0);
const interpolationHalf = interpolateStrictGpuCirclePosition(previous, current, 0.5);
const interpolation1 = interpolateStrictGpuCirclePosition(previous, current, 1);
assert.equal(interpolation0.x, -4);
assert.equal(interpolation0.y, 8);
assert.equal(interpolationHalf.x, 1);
assert.equal(interpolationHalf.y, 3);
assert.equal(interpolation1.x, 6);
assert.equal(interpolation1.y, -2);
assertThrowsNamed(
    () => interpolateStrictGpuCirclePosition(previous, current, 1.01),
    'RangeError'
);

// 원본 render-clock helper는 current에서 양의 clock gap만큼만 velocity 외삽합니다.
const predicted = predictReferenceGpuCirclePosition(
    { x: 10, y: -4 },
    { x: 2, y: -8 },
    1000,
    1025
);
assertNear(predicted.predictionSeconds, 0.025, 'reference prediction seconds');
assertNear(predicted.x, 10.05, 'reference prediction x');
assertNear(predicted.y, -4.2, 'reference prediction y');
const noBackwardsPrediction = predictReferenceGpuCirclePosition(
    { x: 10, y: -4 },
    { x: 2, y: -8 },
    1000,
    990
);
assert.equal(noBackwardsPrediction.predictionSeconds, 0);
assert.equal(noBackwardsPrediction.x, 10);
assert.equal(noBackwardsPrediction.y, -4);

// invalid solver/profile 입력은 reference 동작을 바꾸지 않고 명시적으로 실패합니다.
assertThrowsNamed(() => solveGpuCollisionReference([
    makeBody({ position: { x: Number.NaN, y: 0 } })
], DEFAULT_OPTIONS), 'TypeError');
assertThrowsNamed(() => solveGpuCollisionReference([], {
    ...DEFAULT_OPTIONS,
    dt: 0
}), 'RangeError');
assertThrowsNamed(() => solveGpuCollisionReference([], {
    ...DEFAULT_OPTIONS,
    cellCapacity: 32
}), 'RangeError');
assertThrowsNamed(() => solveGpuCollisionReference([], {
    ...DEFAULT_OPTIONS,
    solverIterations: 5
}), 'RangeError');

console.log('gpu collision Float32 reference: ok');
