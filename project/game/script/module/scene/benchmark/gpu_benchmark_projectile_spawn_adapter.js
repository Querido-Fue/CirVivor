import {
    createGpuProjectileSpawnIntent
} from 'ingame/gpu_simulation_endpoint.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from 'ingame/contract/gameplay_team_contract.js';
import {
    GPU_BENCHMARK_ARENA_LAYOUT
} from './gpu_benchmark_navigation_source.js';

const GPU_SPAWNABLE_STATES = new Set([
    'gpu-deferred',
    'gpu-ready',
    'gpu-backpressure'
]);
const GPU_BENCHMARK_PROJECTILE_SPEED = 14;
// 15° 위상은 균등 간격을 유지하면서 고정 벽과 세 initial box 방향을 통과합니다.
const GPU_BENCHMARK_PROJECTILE_RADIAL_PHASE = Math.PI / 12;
const GPU_BENCHMARK_PROJECTILE_COMMAND_NAMESPACE =
    'gpu-benchmark-projectile';

export const GPU_BENCHMARK_PROJECTILE_BATCH_COUNT = 10;
export const GPU_BENCHMARK_PROJECTILE_DEFINITION = Object.freeze({
    id: 'benchmark_radial_projectile_01',
    collisionRadius: 0.18,
    inverseMass: 1,
    penetration: 1,
    damage: 1,
    damageSelf: 1,
    lifetimeSeconds: 2.5,
    killOnTerrain: true,
    closestOnly: true,
    colorRgba: Object.freeze([0.08, 0.72, 1, 1]),
    radiusScale: 1,
    visible: true
});

function readPositiveSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readNonNegativeSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function createDiagnostic({
    accepted = false,
    requestedCount = 0,
    queuedCount = 0,
    targetFixedTick = null,
    reason,
    nextSpawnSequence = null
}) {
    return Object.freeze({
        accepted,
        requestedCount,
        queuedCount,
        targetFixedTick,
        reason,
        nextSpawnSequence
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

function resolveBenchmarkEndpoint(gameScene) {
    if (typeof gameScene?.getGpuSimulationEndpoint === 'function') {
        return gameScene.getGpuSimulationEndpoint();
    }
    if (typeof gameScene?.getEnemySimulationEndpoint === 'function') {
        return gameScene.getEnemySimulationEndpoint();
    }
    return null;
}

function resolveBenchmarkSession(gameScene) {
    if (!gameScene || typeof gameScene.getGameSystem !== 'function') {
        return null;
    }
    try {
        const gameSystem = gameScene.getGameSystem();
        const endpoint = resolveBenchmarkEndpoint(gameScene);
        const readNextGpuLifecycleFixedTick = resolveLifecycleTickReader(
            gameScene,
            gameSystem
        );
        if (!gameSystem
            || !readNextGpuLifecycleFixedTick
            || !endpoint
            || typeof endpoint.getStatus !== 'function'
            || typeof endpoint.requestSpawnBatch !== 'function') {
            return null;
        }
        return { endpoint, readNextGpuLifecycleFixedTick };
    } catch {
        return null;
    }
}

function resolveTargetFixedTick(readNextGpuLifecycleFixedTick) {
    try {
        return readPositiveSafeInteger(readNextGpuLifecycleFixedTick());
    } catch {
        return null;
    }
}

function resolveEndpointCapacityStatus(endpoint) {
    try {
        const status = endpoint.getStatus();
        if (!status || typeof status !== 'object') {
            return null;
        }
        const capacity = readPositiveSafeInteger(status.capacity);
        const activeCount = readNonNegativeSafeInteger(status.activeCount);
        const reservedCount = readNonNegativeSafeInteger(status.reservedCount);
        const pendingCommandCount = readNonNegativeSafeInteger(
            status.pendingCommandCount
        );
        if (capacity === null
            || activeCount === null
            || reservedCount === null
            || pendingCommandCount === null) {
            return null;
        }
        return {
            ready: GPU_SPAWNABLE_STATES.has(status.state)
                && status.destroyed !== true
                && (status.recoveryRequired !== true
                    || status.state === 'gpu-backpressure'),
            capacity,
            activeCount,
            reservedCount,
            pendingCommandCount
        };
    } catch {
        return null;
    }
}

function hasBatchCapacity(status, requestedCount) {
    const occupiedCount = status.activeCount
        + status.reservedCount
        + status.pendingCommandCount;
    return Number.isSafeInteger(occupiedCount)
        && occupiedCount <= status.capacity
        && requestedCount <= status.capacity - occupiedCount;
}

function createCommandId(
    sessionGeneration,
    batchSequence,
    spawnSequence,
    itemIndex
) {
    return `${GPU_BENCHMARK_PROJECTILE_COMMAND_NAMESPACE}:${sessionGeneration}:${batchSequence}:${spawnSequence}:${itemIndex}`;
}

function createRadialSpawnOptions(itemIndex, requestedCount) {
    const angle = GPU_BENCHMARK_PROJECTILE_RADIAL_PHASE
        + ((Math.PI * 2 * itemIndex) / requestedCount);
    return Object.freeze({
        definition: GPU_BENCHMARK_PROJECTILE_DEFINITION,
        position: GPU_BENCHMARK_ARENA_LAYOUT.targetPosition,
        velocity: Object.freeze({
            x: Math.cos(angle) * GPU_BENCHMARK_PROJECTILE_SPEED,
            y: Math.sin(angle) * GPU_BENCHMARK_PROJECTILE_SPEED
        })
    });
}

/**
 * 중앙 목표에서 균등 방사형 GPU 투사체 batch를 다음 fixed 경계에 예약합니다.
 * endpoint lifecycle 실행은 자식 GameSystem만 소유하며 이 adapter는 request만 수행합니다.
 *
 * @param {{gameScene:object,count?:number,sessionGeneration:number,batchSequence:number,spawnSequence:number}} options
 * @returns {{accepted:boolean,requestedCount:number,queuedCount:number,targetFixedTick:number|null,reason:string,nextSpawnSequence:number|null}}
 */
export function requestGpuBenchmarkProjectileBatch(options = {}) {
    const requestedCount = readPositiveSafeInteger(
        options.count ?? GPU_BENCHMARK_PROJECTILE_BATCH_COUNT
    );
    const initialSpawnSequence = readNonNegativeSafeInteger(
        options.spawnSequence
    );
    if (requestedCount === null) {
        return createDiagnostic({
            reason: 'invalid-count',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    if (initialSpawnSequence === null
        || requestedCount > Number.MAX_SAFE_INTEGER - initialSpawnSequence) {
        return createDiagnostic({
            requestedCount,
            reason: 'invalid-spawn-sequence',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    const sessionGeneration = readNonNegativeSafeInteger(
        options.sessionGeneration
    );
    const batchSequence = readNonNegativeSafeInteger(options.batchSequence);
    if (sessionGeneration === null || batchSequence === null) {
        return createDiagnostic({
            requestedCount,
            reason: 'invalid-batch-identity',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    const session = resolveBenchmarkSession(options.gameScene);
    if (!session) {
        return createDiagnostic({
            requestedCount,
            reason: 'invalid-game-scene',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    const targetFixedTick = resolveTargetFixedTick(
        session.readNextGpuLifecycleFixedTick
    );
    if (targetFixedTick === null) {
        return createDiagnostic({
            requestedCount,
            reason: 'invalid-fixed-tick',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    const capacityStatus = resolveEndpointCapacityStatus(session.endpoint);
    if (!capacityStatus) {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'invalid-endpoint',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    if (!capacityStatus.ready) {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'endpoint-unavailable',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    if (!hasBatchCapacity(capacityStatus, requestedCount)) {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'capacity-insufficient',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    const requests = [];
    try {
        for (let itemIndex = 0; itemIndex < requestedCount; itemIndex++) {
            const spawnSequence = initialSpawnSequence + itemIndex;
            const radial = createRadialSpawnOptions(itemIndex, requestedCount);
            requests.push(Object.freeze({
                intent: createGpuProjectileSpawnIntent({
                    ...radial,
                    spawnSequence,
                    teamId: GAMEPLAY_TEAM_ID.PLAYER,
                    allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
                }),
                targetFixedTick,
                commandId: createCommandId(
                    sessionGeneration,
                    batchSequence,
                    spawnSequence,
                    itemIndex
                )
            }));
        }
    } catch {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'spawn-request-error',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    let result;
    try {
        result = session.endpoint.requestSpawnBatch(requests);
    } catch {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'spawn-request-error',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    if (result?.accepted !== true
        || result.requestedCount !== requestedCount
        || result.queuedCount !== requestedCount) {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'spawn-request-rejected',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    return createDiagnostic({
        accepted: true,
        requestedCount,
        queuedCount: requestedCount,
        targetFixedTick,
        reason: 'queued',
        nextSpawnSequence: initialSpawnSequence + requestedCount
    });
}
