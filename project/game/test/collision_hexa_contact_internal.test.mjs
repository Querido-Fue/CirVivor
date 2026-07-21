import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// VM loader가 공유 의존성을 안정적으로 재사용하도록 collision graph를 leaf부터 평가합니다.
for (const modulePath of [
    'data/data_handler.js',
    'physics/_collision_detector.js',
    'util/number_util.js',
    'physics/_collision_resolve_tuning.js',
    'physics/wasm/_collision_contact_wasm_bytes.js',
    'physics/wasm/_collision_contact_wasm_runtime.js',
    'physics/wasm/_collision_contact_backend.js',
    'physics/_collision_projectile_effect.js',
    'physics/collision_broad_phase_filter.js',
    'physics/collision_manifold_writer.js',
    'physics/collision_body_detector.js',
    'physics/collision_contact_boolean_detector.js',
    'physics/collision_soa_layout.js',
    'physics/collision_broadphase_buffer.js',
    'physics/collision_scratch_objects.js',
    'physics/collision_body_pool.js',
    'physics/collision_candidate_admission.js',
    'physics/collision_candidate_pair_buffer.js',
    'physics/collision_candidate_density.js',
    'physics/collision_body_translation.js',
    'physics/collision_pair_resolver.js',
    'physics/collision_enemy_circle_pair_soa.js',
    'physics/collision_enemy_pair_budget.js',
    'physics/_collision_rules.js',
    'physics/collision_pair_rule_guard.js',
    'physics/collision_enemy_sleep_state.js',
    'physics/collision_candidate_pair_processor.js',
    'physics/collision_enemy_body_cache.js',
    'simulation/simulation_runtime.js',
    'physics/_collision_enemy_geometry.js',
    'physics/collision_enemy_body_builder.js',
    'physics/collision_grid_bucket_pool.js',
    'physics/collision_grid_cell_size.js',
    'physics/collision_grid_query_buffer.js',
    'physics/collision_player_body_builder.js',
    'physics/collision_projectile_sweep_body.js',
    'physics/collision_wall_body_builder.js',
    'physics/collision_frame_stats.js',
    'physics/collision_profile_recorder.js'
]) {
    await loadGameModule(modulePath);
}

const { getData } = await loadGameModule('data/data_handler.js');
const { ENEMY_PAIR_COLLISION_RADIUS_SCALE } = await loadGameModule(
    'physics/_collision_resolve_tuning.js'
);
const { CollisionProfileRecorder } = await loadGameModule(
    'physics/collision_profile_recorder.js'
);
const { CollisionHandler } = await loadGameModule('physics/_collision_handler.js');
const {
    CollisionContactBackend,
    getCollisionContactBackendStatus
} = await loadGameModule('physics/wasm/_collision_contact_backend.js');
const { PhysicsSystem } = await loadGameModule('physics/physics_system.js');
const { collectObjectSystemHexaHiveContactPairs } = await loadGameModule(
    'object/object_system_hexa_hive_orchestration.js'
);

const EPSILON = getData('COLLISION_CONSTANTS').EPSILON;
const FIXED_DELTA = 1 / 60;

/**
 * 실제 body builder를 통과할 테스트용 hexa 계열 적을 생성합니다.
 * @param {number} id
 * @param {'hexa'|'hexa_hive'} type
 * @param {number} y
 * @param {number} [partCount=1]
 * @returns {object}
 */
function createHexaEnemy(id, type, y, partCount = 1) {
    const position = { x: 0, y };
    const enemy = {
        id,
        type,
        active: true,
        position,
        prevPosition: { ...position },
        speed: { x: 0, y: 0 },
        size: 1,
        aspectRatio: 1,
        heightScale: 1,
        rotation: 0,
        weight: 1,
        getRenderHeightPx() {
            return 20;
        }
    };
    if (type === 'hexa_hive') {
        const centers = Array.from({ length: partCount }, (_, index) => ({
            x: index * 0.2,
            y: 0
        }));
        enemy.hexaHiveLayout = {
            visibleLocalCenters: centers.slice(),
            filledLocalCenters: centers
        };
    }
    return enemy;
}

/**
 * 양수 Float32의 바로 이전 표현값을 반환합니다.
 * @param {number} value
 * @returns {number}
 */
function previousPositiveFloat32(value) {
    const values = new Float32Array(1);
    const bits = new Uint32Array(values.buffer);
    values[0] = value;
    bits[0]--;
    return values[0];
}

/**
 * prepared hive의 특정 world-circle part를 덮어씁니다.
 * @param {object} enemy
 * @param {number} partIndex
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 */
function writePreparedPart(enemy, partIndex, x, y, radius) {
    const parts = enemy.__collisionWorldCircles;
    assert.ok(ArrayBuffer.isView(parts), `enemy ${enemy.id} prepared part buffer`);
    const offset = partIndex * 3;
    parts[offset] = x;
    parts[offset + 1] = y;
    parts[offset + 2] = radius;
}

/**
 * 재사용 contact 결과를 안정적인 ID pair 배열로 복사합니다.
 * @param {{enemyA: object, enemyB: object}[]} pairs
 * @returns {string[]}
 */
function snapshotPairIds(pairs) {
    return Array.from(pairs, (pair) => `${pair.enemyA.id}:${pair.enemyB.id}`);
}

const enemies = [
    createHexaEnemy(1, 'hexa', 0),
    createHexaEnemy(2, 'hexa_hive', 0),
    createHexaEnemy(3, 'hexa_hive', 1000, 2),
    createHexaEnemy(4, 'hexa_hive', 1000),
    createHexaEnemy(5, 'hexa_hive', 2000),
    createHexaEnemy(6, 'hexa_hive', 2000),
    createHexaEnemy(7, 'hexa_hive', 3000),
    createHexaEnemy(8, 'hexa_hive', 3000),
    createHexaEnemy(9, 'hexa_hive', 4000),
    createHexaEnemy(10, 'hexa_hive', 4000),
    createHexaEnemy(11, 'hexa_hive', 5000),
    createHexaEnemy(12, 'hexa', 5000),
    createHexaEnemy(13, 'hexa', 6000),
    createHexaEnemy(14, 'hexa', 6000)
];

const physicsSystem = new PhysicsSystem();
physicsSystem.beginFrame();
assert.equal(
    physicsSystem.prepareEnemyCollisionFrame(enemies, { delta: FIXED_DELTA }),
    enemies.length
);

// 첫 part는 invalid지만 다음 part가 유효한 pair를 유지해야 합니다.
writePreparedPart(enemies[2], 0, Number.NaN, 1000, 10);
writePreparedPart(enemies[2], 1, 0, 1000, 10);
writePreparedPart(enemies[3], 0, 0, 1000, 10);

const radiusSum = 20 * ENEMY_PAIR_COLLISION_RADIUS_SCALE;
const tangentDistance = Math.fround(radiusSum);
const epsilonRejectedDistance = previousPositiveFloat32(tangentDistance);
const epsilonAcceptedDistance = previousPositiveFloat32(epsilonRejectedDistance);
assert.ok((radiusSum - epsilonRejectedDistance) <= EPSILON, 'epsilon-rejected edge setup');
assert.ok((radiusSum - epsilonAcceptedDistance) > EPSILON, 'epsilon-accepted edge setup');

for (const [enemyA, enemyB, y, distance] of [
    [enemies[4], enemies[5], 2000, tangentDistance],
    [enemies[6], enemies[7], 3000, epsilonRejectedDistance],
    [enemies[8], enemies[9], 4000, epsilonAcceptedDistance]
]) {
    writePreparedPart(enemyA, 0, 0, y, 10);
    writePreparedPart(enemyB, 0, distance, y, 10);
}

const originalRecordPartCheck = CollisionProfileRecorder.prototype.recordPartCheck;
let partCheckCalls = 0;
CollisionProfileRecorder.prototype.recordPartCheck = function recordPartCheckSpy() {
    partCheckCalls++;
    return originalRecordPartCheck.call(this);
};

try {
    const internalPairIds = snapshotPairIds(
        physicsSystem.collectPreparedHexaHiveContactPairs(enemies, { delta: FIXED_DELTA })
    );
    assert.deepEqual(internalPairIds, ['1:2', '3:4', '9:10', '11:12', '13:14']);
    assert.equal(partCheckCalls, 0, 'prepared boolean path must not call the legacy recorder');
    const wasmStatus = getCollisionContactBackendStatus();
    assert.equal(wasmStatus.state, 'wasm-ready');
    assert.ok(wasmStatus.wasmScanCount > 0, 'prepared path must execute the production WASM batch');

    const publicPairIds = snapshotPairIds(
        physicsSystem.collectEnemyContactPairs(enemies, { delta: FIXED_DELTA })
    );
    assert.deepEqual(publicPairIds, internalPairIds, 'public legacy result and pair order');
    assert.ok(partCheckCalls > 0, 'public contact API must keep the legacy detector/recorder path');
} finally {
    CollisionProfileRecorder.prototype.recordPartCheck = originalRecordPartCheck;
}

// ObjectSystem은 internal API가 있으면 우선 사용하고, 없으면 기존 공개 API로 복구합니다.
const selectionEnemies = [
    createHexaEnemy(101, 'hexa', 0),
    createHexaEnemy(102, 'hexa', 0)
];
const internalSentinel = [{ enemyA: selectionEnemies[0], enemyB: selectionEnemies[1] }];
const selectionTrace = [];
assert.strictEqual(collectObjectSystemHexaHiveContactPairs({
    enemies: selectionEnemies,
    delta: FIXED_DELTA,
    physicsSystem: {
        prepareEnemyCollisionFrame() {
            selectionTrace.push('prepare');
        },
        collectPreparedHexaHiveContactPairs() {
            selectionTrace.push('internal');
            return internalSentinel;
        },
        collectEnemyContactPairs() {
            selectionTrace.push('public');
            return [];
        }
    }
}), internalSentinel);
assert.deepEqual(selectionTrace, ['prepare', 'internal']);

const fallbackSentinel = [{ enemyA: selectionEnemies[1], enemyB: selectionEnemies[0] }];
const fallbackTrace = [];
assert.strictEqual(collectObjectSystemHexaHiveContactPairs({
    enemies: selectionEnemies,
    delta: FIXED_DELTA,
    physicsSystem: {
        prepareEnemyCollisionFrame() {
            fallbackTrace.push('prepare');
        },
        collectEnemyContactPairs() {
            fallbackTrace.push('public');
            return fallbackSentinel;
        }
    }
}), fallbackSentinel);
assert.deepEqual(fallbackTrace, ['prepare', 'public']);

// 초기화 실패는 재시도 없이 영구 JS 상태로 남습니다.
let initializationAttempts = 0;
const initializationFailureBackend = new CollisionContactBackend({
    runtimeFactory() {
        initializationAttempts++;
        throw new Error('expected initialization failure');
    }
});
assert.equal(initializationFailureBackend.getStatus().failure?.stage, 'initialization');
assert.equal(
    initializationFailureBackend.scanPreparedContacts([], new Int32Array(), new Int32Array(), 0),
    null
);
assert.equal(initializationAttempts, 1);

// 실패 진단 getter와 문자열화가 다시 throw해도 영구 JS fallback 계약을 깨지 않습니다.
const hostileInitializationError = Object.defineProperties({}, {
    name: {
        get() {
            throw new Error('hostile name getter');
        }
    },
    message: {
        get() {
            return 'diagnostic message survives';
        }
    }
});
const hostileInitializationBackend = new CollisionContactBackend({
    runtimeFactory() {
        throw hostileInitializationError;
    }
});
assert.deepEqual({ ...hostileInitializationBackend.getStatus().failure }, {
    stage: 'initialization',
    name: 'Error',
    message: 'diagnostic message survives'
});

const unstringifiableExecutionError = new Proxy({}, {
    get(target, property, receiver) {
        if (property === 'message' || property === Symbol.toPrimitive || property === 'toString') {
            throw new Error(`hostile ${String(property)}`);
        }
        return Reflect.get(target, property, receiver);
    }
});
const hostileExecutionBackend = new CollisionContactBackend({
    runtimeFactory() {
        return {
            scanPreparedContacts() {
                throw unstringifiableExecutionError;
            }
        };
    }
});
assert.equal(
    hostileExecutionBackend.scanPreparedContacts([], new Int32Array(), new Int32Array(), 0),
    null
);
assert.deepEqual({ ...hostileExecutionBackend.getStatus().failure }, {
    stage: 'execution',
    name: 'Error',
    message: 'Unknown error'
});
assert.equal(hostileExecutionBackend.getStatus().state, 'js-permanent');

// 실행 trap 뒤에는 성공 전 append 없이 같은 batch를 JS boolean으로 처음부터 복구합니다.
let executionAttempts = 0;
const executionFailureBackend = new CollisionContactBackend({
    runtimeFactory() {
        return {
            scanPreparedContacts() {
                executionAttempts++;
                throw new WebAssembly.RuntimeError('expected execution trap');
            }
        };
    }
});
const fallbackCollisionHandler = new CollisionHandler({
    contactBackend: executionFailureBackend
});
const executionFallbackEnemies = [
    createHexaEnemy(201, 'hexa', 0),
    createHexaEnemy(202, 'hexa_hive', 0)
];
fallbackCollisionHandler.resetFrameStats();
assert.equal(
    fallbackCollisionHandler.prepareEnemyCollisionFrame(
        executionFallbackEnemies,
        { delta: FIXED_DELTA }
    ),
    executionFallbackEnemies.length
);
assert.deepEqual(
    snapshotPairIds(fallbackCollisionHandler.collectPreparedHexaHiveContactPairs(
        executionFallbackEnemies,
        { delta: FIXED_DELTA }
    )),
    ['201:202']
);
assert.deepEqual(
    snapshotPairIds(fallbackCollisionHandler.collectPreparedHexaHiveContactPairs(
        executionFallbackEnemies,
        { delta: FIXED_DELTA }
    )),
    ['201:202']
);
assert.equal(executionAttempts, 1, 'execution failure must never retry WASM');
assert.equal(executionFailureBackend.getStatus().failure?.stage, 'execution');

console.log('prepared hexa WASM contact contract: ok');
