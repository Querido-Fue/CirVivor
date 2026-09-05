import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    GPU_BENCHMARK_PLAYER_PROXY_KIND_ID,
    requestGpuBenchmarkPlayerProxy
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_player_proxy_spawn_adapter.js'
);
const {
    GPU_BENCHMARK_ARENA_LAYOUT
} = await loadGameModule(
    'scene/benchmark/gpu_benchmark_navigation_source.js'
);
const {
    GPU_CIRCLE_BODY_COLLISION_LAYER
} = await loadGameModule('ingame/physics/gpu/gpu_circle_body_abi.js');
const {
    GAMEPLAY_TEAM_ID
} = await loadGameModule('ingame/contract/gameplay_team_contract.js');

function createBenchmarkChild({
    nextGpuLifecycleFixedTick = 42,
    requestSpawnResult = Object.freeze({ accepted: true }),
    legacyAccessorsOnly = false
} = {}) {
    const calls = [];
    const lifecycleCalls = [];
    const endpoint = {
        requestSpawn(intent, targetFixedTick, commandId) {
            calls.push({ intent, targetFixedTick, commandId });
            if (requestSpawnResult instanceof Error) {
                throw requestSpawnResult;
            }
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
        }
    };
    const gameSystem = {
        getNextEnemyLifecycleFixedTick() {
            return nextGpuLifecycleFixedTick;
        }
    };
    const gameScene = {
        getGameSystem() {
            return gameSystem;
        },
        ...(legacyAccessorsOnly ? {
            getNextEnemyLifecycleFixedTick() {
                return nextGpuLifecycleFixedTick;
            },
            getEnemySimulationEndpoint() {
                return endpoint;
            }
        } : {
            getNextGpuLifecycleFixedTick() {
                return nextGpuLifecycleFixedTick;
            },
            getGpuSimulationEndpoint() {
                return endpoint;
            },
            getEnemySimulationEndpoint() {
                throw new Error('generic endpoint accessor를 우선해야 합니다.');
            }
        })
    };
    return { calls, gameScene, lifecycleCalls };
}

test('중앙 player와 일치하는 정적 hidden GPU proxy를 next fixed tick에 예약한다', () => {
    const fixture = createBenchmarkChild();
    const result = requestGpuBenchmarkPlayerProxy({
        gameScene: fixture.gameScene,
        sessionGeneration: 7
    });

    assert.deepEqual({ ...result }, {
        accepted: true,
        requestedCount: 1,
        queuedCount: 1,
        targetFixedTick: 42,
        reason: 'queued'
    });
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.lifecycleCalls, []);

    const { intent, targetFixedTick, commandId } = fixture.calls[0];
    assert.equal(targetFixedTick, 42);
    assert.equal(commandId, 'gpu-benchmark-player-proxy:7');
    assert.equal(GPU_BENCHMARK_PLAYER_PROXY_KIND_ID, 'benchmark-player-proxy');
    assert.equal(intent.kindId, GPU_BENCHMARK_PLAYER_PROXY_KIND_ID);
    assert.equal(intent.definitionId, GPU_BENCHMARK_PLAYER_PROXY_KIND_ID);
    assert.strictEqual(
        intent.position,
        GPU_BENCHMARK_ARENA_LAYOUT.playerCollider.position
    );
    assert.equal(intent.position.x, 32);
    assert.equal(intent.position.y, 18);
    assert.equal(intent.velocity.x, 0);
    assert.equal(intent.velocity.y, 0);
    assert.equal(intent.radius, GPU_BENCHMARK_ARENA_LAYOUT.playerCollider.radius);
    assert.equal(intent.radius, 0.72);
    assert.equal(intent.inverseMass, 0);
    assert.equal(intent.teamId, GAMEPLAY_TEAM_ID.PLAYER);
    assert.equal(
        intent.bodyLayer,
        GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
    );
    assert.equal(intent.collisionMask, GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY);
    assert.equal(
        intent.interactionLayer,
        GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
    );
    assert.equal(
        intent.interactionLayer
            & GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
        0,
        'PLAYER Team인 benchmark proxy도 player-damageable capability가 아닙니다.'
    );
    assert.equal(intent.interactionMask, 0);
    const hostileTowerTargetMask =
        GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    assert.equal(
        hostileTowerTargetMask & intent.interactionLayer,
        0,
        'hostile Tower-target projectile는 benchmark proxy layer를 수락하지 않습니다.'
    );
    assert.equal(
        intent.interactionMask & GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE,
        0,
        'benchmark proxy는 projectile interaction을 reciprocal하게 수락하지 않습니다.'
    );
    assert.equal('layerMask' in intent, false);
    assert.equal('sensorMask' in intent, false);
    assert.equal(intent.health, 1);
    assert.equal(intent.lifetime, -1);
    assert.equal(intent.alive, true);
    assert.equal(intent.renderStyle.visible, false);
    assert.equal(intent.renderStyle.radiusScale, 1);
    assert.deepEqual(Array.from(intent.renderStyle.color), [0, 0, 0, 0]);
    assert.equal(Object.isFrozen(intent), true);
    assert.equal(Object.isFrozen(intent.renderStyle), true);
});

test('session generation은 command ID를 안정적으로 분리하고 legacy accessor도 지원한다', () => {
    const first = createBenchmarkChild({ legacyAccessorsOnly: true });
    const second = createBenchmarkChild({ legacyAccessorsOnly: true });

    const firstResult = requestGpuBenchmarkPlayerProxy({
        gameScene: first.gameScene,
        sessionGeneration: 3
    });
    const secondResult = requestGpuBenchmarkPlayerProxy({
        gameScene: second.gameScene,
        sessionGeneration: 4
    });

    assert.equal(firstResult.accepted, true);
    assert.equal(secondResult.accepted, true);
    assert.equal(first.calls[0].commandId, 'gpu-benchmark-player-proxy:3');
    assert.equal(second.calls[0].commandId, 'gpu-benchmark-player-proxy:4');
    assert.deepEqual(first.lifecycleCalls, []);
    assert.deepEqual(second.lifecycleCalls, []);
});

test('잘못된 session/tick/scene과 endpoint 거절은 fail-closed 진단을 반환한다', () => {
    const valid = createBenchmarkChild();
    const invalidSession = requestGpuBenchmarkPlayerProxy({
        gameScene: valid.gameScene,
        sessionGeneration: -1
    });
    assert.equal(invalidSession.reason, 'invalid-session-generation');
    assert.deepEqual(valid.calls, []);

    const invalidTick = createBenchmarkChild({ nextGpuLifecycleFixedTick: 0 });
    assert.equal(requestGpuBenchmarkPlayerProxy({
        gameScene: invalidTick.gameScene,
        sessionGeneration: 1
    }).reason, 'invalid-fixed-tick');
    assert.deepEqual(invalidTick.calls, []);

    assert.equal(requestGpuBenchmarkPlayerProxy({
        gameScene: {},
        sessionGeneration: 1
    }).reason, 'invalid-game-scene');

    const rejected = createBenchmarkChild({
        requestSpawnResult: Object.freeze({ accepted: false })
    });
    assert.equal(requestGpuBenchmarkPlayerProxy({
        gameScene: rejected.gameScene,
        sessionGeneration: 1
    }).reason, 'spawn-request-rejected');

    const failed = createBenchmarkChild({
        requestSpawnResult: new Error('request failed')
    });
    assert.equal(requestGpuBenchmarkPlayerProxy({
        gameScene: failed.gameScene,
        sessionGeneration: 1
    }).reason, 'spawn-request-error');
});
