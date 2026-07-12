import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

// 공유 의존성을 먼저 평가해 VM module graph의 중복 링크를 피합니다.
for (const modulePath of [
    'data/data_handler.js',
    'util/number_util.js',
    'util/math_util.js',
    'simulation/simulation_runtime.js',
    'physics/_collision_resolve_tuning.js'
]) {
    await loadGameModule(modulePath);
}

const { BaseEnemy } = await loadGameModule('object/enemy/_base_enemy.js');
const { applyCollisionBodyTranslation } = await loadGameModule('physics/collision_body_translation.js');
const { shouldUseCollisionNarrowphaseBroadCircleFilter } = await loadGameModule(
    'physics/collision_broad_phase_filter.js'
);
const { collectHexaWorldCellsFromEnemy } = await loadGameModule(
    'object/enemy/_hexa_hive_layout_accessors.js'
);
const { acquireObjectSystemEnemy } = await loadGameModule('object/object_system_enemy_lifecycle.js');

const EPSILON = 1e-9;

/**
 * 두 숫자가 허용 오차 안에서 같은지 검증합니다.
 * @param {number} actual - 실제 값입니다.
 * @param {number} expected - 기대 값입니다.
 * @param {string} message - 실패 메시지입니다.
 */
function assertNear(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) <= EPSILON,
        `${message}: expected=${expected}, actual=${actual}`
    );
}

// 위치·회전·합체 pull은 같은 fixed alpha로 마지막 두 authoritative 상태를 보간합니다.
const enemy = new BaseEnemy();
enemy.active = true;
enemy.position.x = 0;
enemy.position.y = 0;
enemy.rotation = 359;
enemy.snapRenderTransform();
enemy.beginFixedStep();
enemy.position.x = 10;
enemy.position.y = -4;
enemy.rotation = 1;
enemy.setMergePullOffset(8, -6);
enemy.interpolatePosition(0.5);
assertNear(enemy.renderPosition.x, 5, 'position.x midpoint');
assertNear(enemy.renderPosition.y, -2, 'position.y midpoint');
assertNear(enemy.renderRotation, 360, 'rotation shortest midpoint');
assertNear(enemy.mergePullOffset.x, 4, 'merge pull x midpoint');
assertNear(enemy.mergePullOffset.y, -3, 'merge pull y midpoint');

// 다음 fixed에서는 직전 목표가 시작점이 되고 clear도 즉시 점프하지 않습니다.
enemy.beginFixedStep();
enemy.position.x = 14;
enemy.rotation = 3;
enemy.clearMergePullOffset();
enemy.interpolatePosition(0.5);
assertNear(enemy.renderPosition.x, 12, 'second fixed position midpoint');
assertNear(enemy.renderRotation, 2, 'second fixed rotation midpoint');
assertNear(enemy.mergePullOffset.x, 4, 'merge pull clear midpoint');
assertNear(enemy.mergePullOffset.y, -3, 'merge pull clear midpoint y');

// 합체 settle은 최초 draw 전에 줄지 않고 이후 가변 시간축에서 cubic으로 감쇠합니다.
enemy.startMergeSettleOffset(8, -4, 0.18);
enemy.updateMergeSettleOffset(0.09);
assertNear(enemy.mergeSettleOffset.x, 8, 'settle first render x');
assertNear(enemy.mergeSettleOffset.y, -4, 'settle first render y');
enemy.updateMergeSettleOffset(0.09);
assertNear(enemy.mergeSettleOffset.x, 1, 'settle half x');
assertNear(enemy.mergeSettleOffset.y, -0.5, 'settle half y');
enemy.updateMergeSettleOffset(0.09);
assert.equal(enemy.mergeSettleOffset.x, 0);
assert.equal(enemy.mergeSettleOffset.y, 0);

// 충돌 보정은 현재 물리 위치만 옮기고 fixed 시작 렌더 이력은 보존합니다.
const collisionRef = {
    position: { x: 10, y: 20 },
    prevPosition: { x: 7, y: 17 }
};
const collisionBody = {
    kind: 'wall',
    movable: true,
    ref: collisionRef,
    centerX: 10,
    centerY: 20,
    x: 10,
    y: 20,
    minX: 9,
    maxX: 11,
    minY: 19,
    maxY: 21,
    boundRadius: 1,
    _frameResolveMax: 100,
    _frameResolveMoved: 0
};
assert.equal(applyCollisionBodyTranslation(collisionBody, 2, -3), true);
assert.deepEqual(collisionRef.position, { x: 12, y: 17 });
assert.deepEqual(collisionRef.prevPosition, { x: 7, y: 17 });
assertNear(collisionBody.centerX, 12, 'collision body center x');
assertNear(collisionBody.centerY, 17, 'collision body center y');

// 실제 solve 직전 broad circle은 최대 N×M part loop를 막는 aggregate 쌍만 사용합니다.
const circle = { shape: 'circle' };
const circleParts = { shape: 'circleParts' };
const rect = { shape: 'rect' };
assert.equal(shouldUseCollisionNarrowphaseBroadCircleFilter(circleParts, circleParts), true);
assert.equal(shouldUseCollisionNarrowphaseBroadCircleFilter(circleParts, circle), false);
assert.equal(shouldUseCollisionNarrowphaseBroadCircleFilter(circle, circleParts), false);
assert.equal(shouldUseCollisionNarrowphaseBroadCircleFilter(circleParts, rect), false);
assert.equal(shouldUseCollisionNarrowphaseBroadCircleFilter(circle, rect), false);

// 표시용 hexa cell은 물리 transform 대신 보간 transform override를 사용할 수 있습니다.
const hive = {
    active: true,
    type: 'hexa_hive',
    position: { x: 0, y: 0 },
    rotation: 0,
    getRenderHeightPx: () => 10,
    hexaHiveLayout: {
        visibleLocalCenters: [{ x: 1, y: 0 }]
    }
};
const presentedCells = collectHexaWorldCellsFromEnemy(hive, { x: 5, y: 6 }, 90);
assert.equal(presentedCells.length, 1);
assertNear(presentedCells[0].x, 5, 'presented hive cell x');
assertNear(presentedCells[0].y, 16, 'presented hive cell y');

// 합체 settle 생성 payload가 lifecycle 화이트리스트에서 유실되지 않습니다.
let capturedInitData = null;
const pooledEnemy = {
    init(data) {
        capturedInitData = data;
        return this;
    }
};
const acquireResult = acquireObjectSystemEnemy({
    enemyPools: { hexa_hive: { get: () => pooledEnemy } },
    type: 'hexa_hive',
    data: {
        id: 42,
        position: { x: 1, y: 2 },
        mergeSettleOffset: { x: 3, y: 4 },
        mergeSettleDurationSeconds: 0.18
    },
    enemyIdCounter: 0,
    enemyDefaultWeight: { hexa_hive: 1 }
});
assert.equal(acquireResult.enemy, pooledEnemy);
assert.deepEqual(capturedInitData.mergeSettleOffset, { x: 3, y: 4 });
assert.equal(capturedInitData.mergeSettleDurationSeconds, 0.18);

enemy.reset();
assert.equal(enemy.prevRotation, 0);
assert.equal(enemy.renderRotation, 0);
assert.equal(enemy.mergePullOffset.x, 0);
assert.equal(enemy.mergePullOffset.y, 0);
assert.equal(enemy.mergePullPreviousOffset.x, 0);
assert.equal(enemy.mergePullPreviousOffset.y, 0);
assert.equal(enemy.mergePullTargetOffset.x, 0);
assert.equal(enemy.mergePullTargetOffset.y, 0);
assert.equal(enemy.mergeSettlePendingFirstRender, false);

console.log('enemy render interpolation contract: ok');
