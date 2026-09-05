import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BENCHMARK_PROJECTILE_BATCH_COUNT,
    GPU_BENCHMARK_PROJECTILE_DEFINITION,
    requestGpuBenchmarkProjectileBatch
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_projectile_spawn_adapter.js'
);

function assertDiagnostic(result, expected) {
    assert.deepEqual({ ...result }, expected);
}

function createBenchmarkChild({
    nextGpuLifecycleFixedTick = 42,
    capacity = 256,
    activeCount = 0,
    reservedCount = 0,
    pendingCommandCount = 0,
    state = 'gpu-ready',
    recoveryRequired = false,
    requestSpawnBatchResult = null,
    legacyEndpointOnly = false
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
        requestSpawnBatch(requests) {
            const normalizedRequests = Array.from(requests);
            calls.push(Object.freeze({ requests: normalizedRequests }));
            if (typeof requestSpawnBatchResult === 'function') {
                return requestSpawnBatchResult(
                    normalizedRequests,
                    calls.length - 1
                );
            }
            return requestSpawnBatchResult ?? Object.freeze({
                accepted: true,
                requestedCount: normalizedRequests.length,
                queuedCount: normalizedRequests.length
            });
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
        }
    };
    const gameSystem = {
        getNextGpuLifecycleFixedTick() {
            return nextGpuLifecycleFixedTick;
        }
    };
    const gameScene = {
        getGameSystem() {
            return gameSystem;
        },
        getNextGpuLifecycleFixedTick() {
            return gameSystem.getNextGpuLifecycleFixedTick();
        },
        ...(legacyEndpointOnly ? {
            getEnemySimulationEndpoint() {
                return endpoint;
            }
        } : {
            getGpuSimulationEndpoint() {
                return endpoint;
            },
            getEnemySimulationEndpoint() {
                throw new Error('generic endpoint accessor를 우선해야 합니다.');
            }
        })
    };
    return { calls, endpoint, gameScene, lifecycleCalls };
}

test('중앙 목표에서 10발을 동일 next tick에 균등 방사형으로 예약한다', () => {
    const fixture = createBenchmarkChild();
    const result = requestGpuBenchmarkProjectileBatch({
        gameScene: fixture.gameScene,
        sessionGeneration: 7,
        batchSequence: 3,
        spawnSequence: 900
    });

    assert.equal(GPU_BENCHMARK_PROJECTILE_BATCH_COUNT, 10);
    assert.equal(Object.isFrozen(GPU_BENCHMARK_PROJECTILE_DEFINITION), true);
    assertDiagnostic(result, {
        accepted: true,
        requestedCount: 10,
        queuedCount: 10,
        targetFixedTick: 42,
        reason: 'queued',
        nextSpawnSequence: 910
    });
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.lifecycleCalls, []);

    const requests = fixture.calls[0].requests;
    assert.equal(requests.length, 10);
    for (let index = 0; index < requests.length; index++) {
        const { intent, targetFixedTick, commandId } = requests[index];
        const angle = (Math.PI / 12) + ((Math.PI * 2 * index) / 10);
        assert.equal(targetFixedTick, 42);
        assert.equal(
            commandId,
            `gpu-benchmark-projectile:7:3:${900 + index}:${index}`
        );
        assert.equal(intent.kindId, 'projectile');
        assert.equal(intent.definitionId, 'benchmark_radial_projectile_01');
        assert.equal(intent.spawnSequence, 900 + index);
        assert.equal(intent.position.x, 32);
        assert.equal(intent.position.y, 18);
        assert.ok(Math.abs(intent.velocity.x - (Math.cos(angle) * 14)) < 1e-10);
        assert.ok(Math.abs(intent.velocity.y - (Math.sin(angle) * 14)) < 1e-10);
        assert.ok(Math.abs(Math.hypot(
            intent.velocity.x,
            intent.velocity.y
        ) - 14) < 1e-10);
        assert.equal(intent.radius, 0.18);
        assert.equal(intent.inverseMass, 1);
        assert.equal(intent.bodyLayer, 2);
        assert.equal(intent.collisionMask, 0);
        assert.equal(intent.interactionLayer, 2);
        assert.equal(intent.interactionMask, 129);
        assert.equal('layerMask' in intent, false);
        assert.equal('sensorMask' in intent, false);
        assert.equal(intent.health, 1);
        assert.equal(intent.lifetime, 2.5);
        assert.equal(intent.contactHandler.damageSelf, 1);
        assert.equal(intent.contactHandler.damageOther, 1);
        assert.equal(intent.contactHandler.flags, 11);
        assert.deepEqual(
            Array.from(intent.renderStyle.color),
            [0.08, 0.72, 1, 1]
        );
    }
});

test('pending submit 중에는 공개 lifecycle tick API가 연 N+2 경계에 예약한다', () => {
    const fixture = createBenchmarkChild({
        nextGpuLifecycleFixedTick: 43,
        state: 'gpu-backpressure',
        recoveryRequired: true
    });
    const result = requestGpuBenchmarkProjectileBatch({
        gameScene: fixture.gameScene,
        count: 1,
        sessionGeneration: 7,
        batchSequence: 4,
        spawnSequence: 1000
    });

    assert.equal(result.accepted, true);
    assert.equal(result.targetFixedTick, 43);
    assert.equal(fixture.calls[0].requests[0].targetFixedTick, 43);
});

test('동일 session/batch/spawn 입력은 재생성해도 같은 command ID를 만든다', () => {
    const first = createBenchmarkChild();
    const second = createBenchmarkChild();
    const options = {
        sessionGeneration: 2,
        batchSequence: 5,
        spawnSequence: 17,
        count: 3
    };

    requestGpuBenchmarkProjectileBatch({ ...options, gameScene: first.gameScene });
    requestGpuBenchmarkProjectileBatch({ ...options, gameScene: second.gameScene });

    assert.deepEqual(
        first.calls[0].requests.map(({ commandId }) => commandId),
        second.calls[0].requests.map(({ commandId }) => commandId)
    );
    assert.deepEqual(
        first.calls[0].requests.map(({ intent }) => intent.spawnSequence),
        [17, 18, 19]
    );
});

test('capacity preflight 실패는 batch를 zero-partial로 거절한다', () => {
    const fixture = createBenchmarkChild({
        capacity: 10,
        activeCount: 4,
        reservedCount: 2,
        pendingCommandCount: 3
    });
    const result = requestGpuBenchmarkProjectileBatch({
        gameScene: fixture.gameScene,
        count: 2,
        sessionGeneration: 8,
        batchSequence: 1,
        spawnSequence: 50
    });

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

test('batch ingress 거절은 prefix 없이 0 또는 N diagnostic만 반환한다', () => {
    const fixture = createBenchmarkChild({
        requestSpawnBatchResult: Object.freeze({
            accepted: false,
            requestedCount: 10,
            queuedCount: 0,
            reason: 'duplicate-command'
        })
    });
    const result = requestGpuBenchmarkProjectileBatch({
        gameScene: fixture.gameScene,
        sessionGeneration: 9,
        batchSequence: 2,
        spawnSequence: 80
    });

    assertDiagnostic(result, {
        accepted: false,
        requestedCount: 10,
        queuedCount: 0,
        targetFixedTick: 42,
        reason: 'spawn-request-rejected',
        nextSpawnSequence: 80
    });
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].requests.length, 10);
    assert.deepEqual(fixture.lifecycleCalls, []);

    const incompleteFixture = createBenchmarkChild({
        requestSpawnBatchResult: Object.freeze({
            accepted: true,
            requestedCount: 10,
            queuedCount: 9
        })
    });
    const incomplete = requestGpuBenchmarkProjectileBatch({
        gameScene: incompleteFixture.gameScene,
        sessionGeneration: 9,
        batchSequence: 3,
        spawnSequence: 90
    });
    assert.equal(incomplete.accepted, false);
    assert.equal(incomplete.queuedCount, 0);
    assert.equal(incomplete.nextSpawnSequence, 90);
    assert.equal(incompleteFixture.calls.length, 1);
    assert.equal(incompleteFixture.calls[0].requests.length, 10);
});

test('legacy enemy endpoint accessor fallback과 unavailable fail-closed를 지원한다', () => {
    const legacyFixture = createBenchmarkChild({ legacyEndpointOnly: true });
    const accepted = requestGpuBenchmarkProjectileBatch({
        gameScene: legacyFixture.gameScene,
        count: 1,
        sessionGeneration: 1,
        batchSequence: 0,
        spawnSequence: 0
    });
    assert.equal(accepted.accepted, true);
    assert.equal(legacyFixture.calls.length, 1);

    const unavailableFixture = createBenchmarkChild({ state: 'gpu-failed' });
    const unavailable = requestGpuBenchmarkProjectileBatch({
        gameScene: unavailableFixture.gameScene,
        count: 1,
        sessionGeneration: 1,
        batchSequence: 1,
        spawnSequence: 1
    });
    assert.equal(unavailable.reason, 'endpoint-unavailable');
    assert.deepEqual(unavailableFixture.calls, []);

    const malformed = requestGpuBenchmarkProjectileBatch({
        gameScene: {},
        count: 1,
        sessionGeneration: 1,
        batchSequence: 2,
        spawnSequence: 2
    });
    assert.equal(malformed.reason, 'invalid-game-scene');
});
