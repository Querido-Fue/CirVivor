import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    createGpuEnemySpawnIntent
} from 'ingame/gpu_simulation_endpoint.js';

const GPU_SPAWNABLE_STATES = new Set([
    'gpu-deferred',
    'gpu-ready',
    'gpu-backpressure'
]);
const GPU_BENCHMARK_ENEMY_RADIUS_FACTOR = 0.5;
const GPU_BENCHMARK_ENEMY_DEFINITION = Object.freeze({
    ...BASIC_CIRCLE_ENEMY_DATA,
    collisionRadiusTiles: BASIC_CIRCLE_ENEMY_DATA.collisionRadiusTiles
        * GPU_BENCHMARK_ENEMY_RADIUS_FACTOR
});
const LANE_OFFSETS_TILES = Object.freeze([-3, -1.5, 0, 1.5, 3]);
const LONGITUDINAL_SPACING_TILES = 1.5;

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

function resolveBenchmarkSession(gameScene) {
    if (!gameScene
        || typeof gameScene.getGameSystem !== 'function') {
        return null;
    }

    try {
        const gameSystem = gameScene.getGameSystem();
        if (!gameSystem
            || typeof gameSystem.getObjectSystem !== 'function') {
            return null;
        }
        const readNextGpuLifecycleFixedTick = resolveLifecycleTickReader(
            gameScene,
            gameSystem
        );
        if (!readNextGpuLifecycleFixedTick) {
            return null;
        }
        const gameObjectSystem = gameSystem.getObjectSystem();
        if (!gameObjectSystem
            || typeof gameObjectSystem.getEnemySpawnRoutes !== 'function') {
            return null;
        }
        const endpoint = typeof gameScene.getGpuSimulationEndpoint === 'function'
            ? gameScene.getGpuSimulationEndpoint()
            : gameScene.getEnemySimulationEndpoint?.();
        if (!endpoint
            || typeof endpoint.getStatus !== 'function'
            || typeof endpoint.requestSpawn !== 'function') {
            return null;
        }
        return {
            gameObjectSystem,
            endpoint,
            readNextGpuLifecycleFixedTick
        };
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
        const pendingCommandCount = readNonNegativeSafeInteger(status.pendingCommandCount);
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

function createCommandId(sessionGeneration, batchSequence, itemIndex) {
    return `gpu-benchmark:${sessionGeneration}:${batchSequence}:${itemIndex}`;
}

function createDistributedSpawnIntent(route, spawnSequence, routeLocalIndex) {
    const laneIndex = routeLocalIndex % LANE_OFFSETS_TILES.length;
    const longitudinalIndex = Math.floor(
        routeLocalIndex / LANE_OFFSETS_TILES.length
    );
    const intent = createGpuEnemySpawnIntent({
        definition: GPU_BENCHMARK_ENEMY_DEFINITION,
        route,
        spawnSequence,
        laneOffsetTiles: LANE_OFFSETS_TILES[laneIndex]
    });
    const entry = route.waypoints[0];
    const next = route.waypoints[1];
    const directionX = next.x - entry.x;
    const directionY = next.y - entry.y;
    const directionLength = Math.hypot(directionX, directionY);
    const longitudinalOffset = longitudinalIndex
        * LONGITUDINAL_SPACING_TILES;
    return Object.freeze({
        ...intent,
        position: Object.freeze({
            x: intent.position.x
                + ((directionX / directionLength) * longitudinalOffset),
            y: intent.position.y
                + ((directionY / directionLength) * longitudinalOffset)
        })
    });
}

/**
 * frame-end command drain에서만 benchmark GPU enemy batch를 다음 fixed 경계에 예약합니다.
 * 자식 GameScene의 owner lifecycle에는 관여하지 않고 공개 endpoint.requestSpawn()만 사용합니다.
 *
 * @param {{gameScene:object,count:number,sessionGeneration:number,batchSequence:number,spawnSequence:number}} options
 * @returns {{accepted:boolean,requestedCount:number,queuedCount:number,targetFixedTick:number|null,reason:string,nextSpawnSequence:number|null}}
 */
export function requestGpuBenchmarkEnemyBatch(options = {}) {
    const requestedCount = readPositiveSafeInteger(options.count);
    const initialSpawnSequence = readNonNegativeSafeInteger(options.spawnSequence);
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

    const sessionGeneration = readNonNegativeSafeInteger(options.sessionGeneration);
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

    let routes;
    try {
        routes = session.gameObjectSystem.getEnemySpawnRoutes();
    } catch {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'invalid-routes',
            nextSpawnSequence: initialSpawnSequence
        });
    }
    if (!Array.isArray(routes) || routes.length === 0) {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'no-routes',
            nextSpawnSequence: initialSpawnSequence
        });
    }

    const requests = [];
    try {
        for (let itemIndex = 0; itemIndex < requestedCount; itemIndex++) {
            const routeIndex = itemIndex % routes.length;
            const routeLocalIndex = Math.floor(itemIndex / routes.length);
            requests.push(Object.freeze({
                intent: createDistributedSpawnIntent(
                    routes[routeIndex],
                    initialSpawnSequence + itemIndex,
                    routeLocalIndex
                ),
                commandId: createCommandId(
                    sessionGeneration,
                    batchSequence,
                    itemIndex
                )
            }));
        }
    } catch {
        return createDiagnostic({
            requestedCount,
            targetFixedTick,
            reason: 'invalid-spawn-intent',
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

    let queuedCount = 0;
    for (const request of requests) {
        let result;
        try {
            result = session.endpoint.requestSpawn(
                request.intent,
                targetFixedTick,
                request.commandId
            );
        } catch {
            return createDiagnostic({
                requestedCount,
                queuedCount,
                targetFixedTick,
                reason: 'spawn-request-error',
                nextSpawnSequence: initialSpawnSequence + queuedCount
            });
        }
        if (result?.accepted !== true) {
            return createDiagnostic({
                requestedCount,
                queuedCount,
                targetFixedTick,
                reason: 'spawn-request-rejected',
                nextSpawnSequence: initialSpawnSequence + queuedCount
            });
        }
        queuedCount++;
    }

    return createDiagnostic({
        accepted: true,
        requestedCount,
        queuedCount,
        targetFixedTick,
        reason: 'queued',
        nextSpawnSequence: initialSpawnSequence + queuedCount
    });
}
