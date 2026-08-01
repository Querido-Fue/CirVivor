import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    requestGpuBenchmarkEnemyBatch
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_enemy_spawn_adapter.js'
);
const {
    createGpuBenchmarkNavigationSource
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_navigation_source.js'
);
const {
    BASIC_CIRCLE_ENEMY_DATA
} = await loadGameModule(
    'data/object/enemy/basic_circle_enemy_data.js'
);

const LANE_OFFSETS_TILES = Object.freeze([-3, -1.5, 0, 1.5, 3]);

function assertDiagnostic(result, expected) {
    assert.deepEqual({ ...result }, expected);
}

function createRoute(gateId, pathId, entryX, entryY) {
    return Object.freeze({
        gateId,
        pathId,
        waypoints: Object.freeze([
            Object.freeze({ x: entryX, y: entryY }),
            Object.freeze({ x: entryX + 10, y: entryY })
        ])
    });
}

function createBenchmarkChild({
    nextGpuLifecycleFixedTick = 42,
    routes = [
        createRoute('west-gate', 'west-path', 10, 10),
        createRoute('east-gate', 'east-path', 30, 10)
    ],
    capacity = 256,
    activeCount = 0,
    reservedCount = 0,
    pendingCommandCount = 0,
    state = 'gpu-deferred',
    recoveryRequired = false,
    requestSpawnResult = Object.freeze({ accepted: true })
} = {}) {
    const calls = [];
    const lifecycleCalls = [];
    const endpoint = {
        getStatus() {
            return Object.freeze({
                state,
                destroyed: false,
                recoveryRequired,
                capacity,
                activeCount,
                reservedCount,
                pendingCommandCount
            });
        },
        requestSpawn(intent, targetFixedTick, commandId) {
            calls.push({ intent, targetFixedTick, commandId });
            return requestSpawnResult;
        },
        commitAtFixedBoundary() {
            lifecycleCalls.push('commitAtFixedBoundary');
        },
        fixedUpdate() {
            lifecycleCalls.push('fixedUpdate');
        },
        updatePresentation() {
            lifecycleCalls.push('updatePresentation');
        },
        draw() {
            lifecycleCalls.push('draw');
        },
        synchronizePresentation() {
            lifecycleCalls.push('synchronizePresentation');
        },
        destroy() {
            lifecycleCalls.push('destroy');
        }
    };
    const gameObjectSystem = {
        getEnemySpawnRoutes() {
            return routes;
        }
    };
    const gameSystem = {
        getObjectSystem() {
            return gameObjectSystem;
        },
        getNextGpuLifecycleFixedTick() {
            return nextGpuLifecycleFixedTick;
        }
    };
    return {
        calls,
        lifecycleCalls,
        gameScene: {
            getGameSystem() {
                return gameSystem;
            },
            getNextGpuLifecycleFixedTick() {
                return gameSystem.getNextGpuLifecycleFixedTick();
            },
            getEnemySimulationEndpoint() {
                return endpoint;
            }
        }
    };
}

test('GPU benchmark spawn adapter는 deferred 첫 배치 100개를 다음 fixed tick에 결정적으로 예약한다', () => {
    const fixture = createBenchmarkChild();
    const result = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 100,
        sessionGeneration: 7,
        batchSequence: 3,
        spawnSequence: 900
    });

    assert.equal(Object.isFrozen(result), true);
    assertDiagnostic(result, {
        accepted: true,
        requestedCount: 100,
        queuedCount: 100,
        targetFixedTick: 42,
        reason: 'queued',
        nextSpawnSequence: 1000
    });
    assert.equal(fixture.calls.length, 100);
    assert.deepEqual(
        new Set(fixture.calls.map(({ targetFixedTick }) => targetFixedTick)),
        new Set([42])
    );
    assert.equal(
        new Set(fixture.calls.map(({ commandId }) => commandId)).size,
        100
    );
    assert.equal(
        new Set(fixture.calls.map(({ intent }) => (
            `${intent.position.x.toFixed(6)}:${intent.position.y.toFixed(6)}`
        ))).size,
        100,
        '동일 위치 spawn은 zero-distance solver 퇴화를 다시 만들 수 있습니다.'
    );
    for (let index = 0; index < fixture.calls.length; index++) {
        const { intent, commandId } = fixture.calls[index];
        assert.equal(commandId.includes(':7:3:'), true);
        assert.equal(intent.enemyDefinitionId, 'basic_circle_01');
        assert.equal(intent.spawnSequence, 900 + index);
        assert.equal(intent.waypointIndex, 1);
    }

    const routeCounts = new Map();
    const laneCounts = new Map();
    for (const { intent } of fixture.calls) {
        routeCounts.set(intent.pathId, (routeCounts.get(intent.pathId) ?? 0) + 1);
        const laneOffset = Number((intent.position.y - 10).toFixed(1));
        laneCounts.set(laneOffset, (laneCounts.get(laneOffset) ?? 0) + 1);
    }
    assert.deepEqual([...routeCounts.values()].sort((left, right) => left - right), [50, 50]);
    assert.equal(laneCounts.size, LANE_OFFSETS_TILES.length);
    for (const laneOffset of LANE_OFFSETS_TILES) {
        assert.equal(laneCounts.get(laneOffset), 20);
    }
    assert.deepEqual(fixture.lifecycleCalls, []);
});

test('GPU benchmark 적은 production 정의를 바꾸지 않고 물리·렌더 반지름을 정확히 절반으로 사용한다', () => {
    const productionRadius = BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles;
    const productionRadiusScale = BASIC_CIRCLE_ENEMY_DATA.radiusScale;
    const fixture = createBenchmarkChild();
    const result = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 1,
        sessionGeneration: 1,
        batchSequence: 0,
        spawnSequence: 0
    });

    assert.equal(result.accepted, true);
    assert.equal(fixture.calls.length, 1);
    const { intent } = fixture.calls[0];
    assert.equal(intent.definitionId, BASIC_CIRCLE_ENEMY_DATA.id);
    assert.equal(intent.enemyDefinitionId, BASIC_CIRCLE_ENEMY_DATA.id);
    assert.equal(intent.radius, productionRadius * 0.5);
    assert.equal(intent.renderStyle.radiusScale, productionRadiusScale);
    assert.equal(
        intent.radius * intent.renderStyle.radiusScale,
        productionRadius * productionRadiusScale * 0.5
    );
    assert.equal(BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles, productionRadius);
    assert.equal(BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles, 0.5939696961966999);
    assert.equal(BASIC_CIRCLE_ENEMY_DATA.radiusScale, 1);
});

test('pending submit 중에는 공개 lifecycle tick API가 연 N+2 경계에 예약한다', () => {
    const fixture = createBenchmarkChild({
        nextGpuLifecycleFixedTick: 43,
        state: 'gpu-backpressure',
        recoveryRequired: true
    });
    const result = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 1,
        sessionGeneration: 7,
        batchSequence: 4,
        spawnSequence: 1000
    });

    assert.equal(result.accepted, true);
    assert.equal(result.targetFixedTick, 43);
    assert.equal(fixture.calls[0].targetFixedTick, 43);
});

test('전용 arena의 100개 spawn은 경계 안에 분산되고 초기 grid cell cap을 만들지 않는다', () => {
    const navigationSource = createGpuBenchmarkNavigationSource();
    const bounds = navigationSource.getWorldBounds();
    const fixture = createBenchmarkChild({
        routes: navigationSource.getSpawnRoutes()
    });
    const result = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 100,
        sessionGeneration: 1,
        batchSequence: 0,
        spawnSequence: 0
    });

    assert.equal(result.accepted, true);
    assert.equal(fixture.calls.length, 100);
    const occupancyByCell = new Map();
    const uniquePositions = new Set();
    for (const { intent } of fixture.calls) {
        const { x, y } = intent.position;
        assert.ok(x >= bounds.minX + intent.radius);
        assert.ok(x <= bounds.maxX - intent.radius);
        assert.ok(y >= bounds.minY + intent.radius);
        assert.ok(y <= bounds.maxY - intent.radius);
        const tile = navigationSource.worldToTile(x, y, {});
        assert.equal(
            navigationSource.isWalkableTile(tile.row, tile.column),
            true,
            `spawn이 blocked cell에 놓였습니다: ${x}, ${y}`
        );
        uniquePositions.add(`${x.toFixed(6)}:${y.toFixed(6)}`);
        const cellKey = `${Math.floor(x)}:${Math.floor(y)}`;
        occupancyByCell.set(cellKey, (occupancyByCell.get(cellKey) ?? 0) + 1);
    }
    assert.equal(uniquePositions.size, 100);
    assert.ok(Math.max(...occupancyByCell.values()) < 64);
});

test('GPU benchmark spawn adapter는 보수적 capacity preflight 실패 시 requestSpawn 없이 batch 전체를 거절한다', () => {
    const fixture = createBenchmarkChild({
        capacity: 10,
        activeCount: 4,
        reservedCount: 2,
        pendingCommandCount: 3
    });
    const result = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 2,
        sessionGeneration: 8,
        batchSequence: 1,
        spawnSequence: 50
    });

    assert.equal(Object.isFrozen(result), true);
    assertDiagnostic(result, {
        accepted: false,
        requestedCount: 2,
        queuedCount: 0,
        targetFixedTick: 42,
        reason: 'capacity-insufficient',
        nextSpawnSequence: 50
    });
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.lifecycleCalls, []);
});

test('GPU benchmark spawn adapter는 malformed child 또는 unavailable endpoint를 mutation 없이 거절한다', () => {
    const malformedResult = requestGpuBenchmarkEnemyBatch({
        gameScene: {},
        count: 1,
        sessionGeneration: 1,
        batchSequence: 0,
        spawnSequence: 0
    });
    assert.equal(Object.isFrozen(malformedResult), true);
    assertDiagnostic(malformedResult, {
        accepted: false,
        requestedCount: 1,
        queuedCount: 0,
        targetFixedTick: null,
        reason: 'invalid-game-scene',
        nextSpawnSequence: 0
    });

    const fixture = createBenchmarkChild({ state: 'gpu-failed' });
    const unavailableResult = requestGpuBenchmarkEnemyBatch({
        gameScene: fixture.gameScene,
        count: 1,
        sessionGeneration: 1,
        batchSequence: 1,
        spawnSequence: 0
    });
    assert.equal(unavailableResult.reason, 'endpoint-unavailable');
    assert.deepEqual(fixture.calls, []);
    assert.deepEqual(fixture.lifecycleCalls, []);
});
