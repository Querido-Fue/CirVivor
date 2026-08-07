import {
    GPU_CIRCLE_BODY_COLLISION_LAYER
} from 'ingame/physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_BENCHMARK_ARENA_LAYOUT
} from './gpu_benchmark_navigation_source.js';

const GPU_BENCHMARK_PLAYER_PROXY_COMMAND_NAMESPACE =
    'gpu-benchmark-player-proxy';
const HIDDEN_RENDER_COLOR = Object.freeze([0, 0, 0, 0]);

export const GPU_BENCHMARK_PLAYER_PROXY_KIND_ID =
    'benchmark-player-proxy';

function readNonNegativeSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readPositiveSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function createDiagnostic({
    accepted = false,
    queuedCount = 0,
    targetFixedTick = null,
    reason
}) {
    return Object.freeze({
        accepted,
        requestedCount: 1,
        queuedCount,
        targetFixedTick,
        reason
    });
}

function resolveLifecycleTickReader(gameScene, gameSystem) {
    const candidates = [
        [gameScene, gameScene?.getNextGpuLifecycleFixedTick],
        [gameSystem, gameSystem?.getNextGpuLifecycleFixedTick],
        [gameScene, gameScene?.getNextEnemyLifecycleFixedTick],
        [gameSystem, gameSystem?.getNextEnemyLifecycleFixedTick]
    ];
    for (const [owner, method] of candidates) {
        if (typeof method === 'function') {
            return () => method.call(owner);
        }
    }
    return null;
}

function resolveBenchmarkSession(gameScene) {
    if (!gameScene || typeof gameScene !== 'object') {
        return null;
    }
    try {
        const gameSystem = typeof gameScene.getGameSystem === 'function'
            ? gameScene.getGameSystem()
            : null;
        const endpoint = typeof gameScene.getGpuSimulationEndpoint === 'function'
            ? gameScene.getGpuSimulationEndpoint()
            : gameScene.getEnemySimulationEndpoint?.();
        const readNextGpuLifecycleFixedTick = resolveLifecycleTickReader(
            gameScene,
            gameSystem
        );
        if (!endpoint
            || typeof endpoint.requestSpawn !== 'function'
            || !readNextGpuLifecycleFixedTick) {
            return null;
        }
        return { endpoint, readNextGpuLifecycleFixedTick };
    } catch {
        return null;
    }
}

function createPlayerProxySpawnIntent() {
    const collider = GPU_BENCHMARK_ARENA_LAYOUT.playerCollider;
    return Object.freeze({
        kindId: GPU_BENCHMARK_PLAYER_PROXY_KIND_ID,
        definitionId: GPU_BENCHMARK_PLAYER_PROXY_KIND_ID,
        position: collider.position,
        velocity: Object.freeze({ x: 0, y: 0 }),
        radius: collider.radius,
        inverseMass: 0,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE,
        interactionMask: 0,
        health: 1,
        lifetime: -1,
        alive: true,
        renderStyle: Object.freeze({
            color: HIDDEN_RENDER_COLOR,
            radiusScale: 1,
            visible: false
        })
    });
}

/**
 * 중앙 CPU player와 같은 위치에 보이지 않는 정적 GPU 충돌 proxy를 예약합니다.
 * lifecycle 실행은 자식 GameScene이 소유하며 이 adapter는 공개 request만 수행합니다.
 *
 * @param {{gameScene:object,sessionGeneration:number}} options
 * @returns {{accepted:boolean,requestedCount:number,queuedCount:number,targetFixedTick:number|null,reason:string}}
 */
export function requestGpuBenchmarkPlayerProxy(options = {}) {
    const sessionGeneration = readNonNegativeSafeInteger(
        options.sessionGeneration
    );
    if (sessionGeneration === null) {
        return createDiagnostic({ reason: 'invalid-session-generation' });
    }

    const session = resolveBenchmarkSession(options.gameScene);
    if (!session) {
        return createDiagnostic({ reason: 'invalid-game-scene' });
    }

    let targetFixedTick;
    try {
        targetFixedTick = readPositiveSafeInteger(
            session.readNextGpuLifecycleFixedTick()
        );
    } catch {
        targetFixedTick = null;
    }
    if (targetFixedTick === null) {
        return createDiagnostic({ reason: 'invalid-fixed-tick' });
    }

    let result;
    try {
        result = session.endpoint.requestSpawn(
            createPlayerProxySpawnIntent(),
            targetFixedTick,
            `${GPU_BENCHMARK_PLAYER_PROXY_COMMAND_NAMESPACE}:${sessionGeneration}`
        );
    } catch {
        return createDiagnostic({
            targetFixedTick,
            reason: 'spawn-request-error'
        });
    }
    if (result?.accepted !== true) {
        return createDiagnostic({
            targetFixedTick,
            reason: 'spawn-request-rejected'
        });
    }

    return createDiagnostic({
        accepted: true,
        queuedCount: 1,
        targetFixedTick,
        reason: 'queued'
    });
}
