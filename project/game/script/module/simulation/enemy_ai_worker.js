import {
    ENEMY_AI_WORKER_MESSAGE_TYPES,
    createEnemyAIWorkerMessage,
    isEnemyAIWorkerMessage
} from './enemy_ai_worker_protocol.js';
import {
    attachEnemyAISharedTransport,
    beginEnemyAISharedResultWrite,
    beginEnemyAISharedResultRangeWrite,
    commitEnemyAISharedResultWrite,
    writeEnemyAISharedResult
} from './enemy_ai_shared_transport.js';
import {
    attachEnemyAISharedInputTransport,
    readEnemyAISharedInputSnapshot
} from './enemy_ai_shared_input_transport.js';
import { syncSimulationRuntime } from './simulation_runtime.js';
import { fixedUpdateEnemyAI } from '../object/enemy/ai/_enemy_ai_core.js';

let enemyAISharedTransport = null;
let enemyAISharedInputTransport = null;
let enemyAIWorkerIndex = -1;

/**
 * 수치 값을 안전하게 정규화합니다.
 * @param {number|null|undefined} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function normalizeNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/**
 * 좌표 객체를 구조화 복제 가능한 값으로 정규화합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function clonePoint(point) {
    return {
        x: normalizeNumber(point?.x, 0),
        y: normalizeNumber(point?.y, 0)
    };
}

/**
 * 적 AI 상태를 전송용 최소 필드만 남겨 정규화합니다.
 * @param {object|null|undefined} state
 * @returns {object|null}
 */
function cloneEnemyAIStateForTransfer(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }

    return {
        __initialized: state.__initialized === true,
        __schemaVersion: Number.isInteger(state.__schemaVersion) ? state.__schemaVersion : 0,
        policyId: typeof state.policyId === 'string' ? state.policyId : '',
        dirX: normalizeNumber(state.dirX, 1),
        dirY: normalizeNumber(state.dirY, 0),
        baseDesiredSpeed: normalizeNumber(state.baseDesiredSpeed, 40),
        desiredSpeed: normalizeNumber(state.desiredSpeed, 40),
        baseAccelResponse: normalizeNumber(state.baseAccelResponse, 0),
        accelResponse: normalizeNumber(state.accelResponse, 0),
        targetX: normalizeNumber(state.targetX, Number.NaN),
        targetY: normalizeNumber(state.targetY, Number.NaN),
        flowPolicyKey: typeof state.flowPolicyKey === 'string' ? state.flowPolicyKey : '',
        flowKey: typeof state.flowKey === 'string' ? state.flowKey : '',
        lastTargetCellX: Number.isInteger(state.lastTargetCellX) ? state.lastTargetCellX : 0,
        lastTargetCellY: Number.isInteger(state.lastTargetCellY) ? state.lastTargetCellY : 0,
        lastDecisionGroup: Number.isInteger(state.lastDecisionGroup) ? state.lastDecisionGroup : -1,
        hasDirectPathResult: state.hasDirectPathResult === true,
        lastDirectPath: state.lastDirectPath === true,
        lastDirectPathWallsVersion: Number.isInteger(state.lastDirectPathWallsVersion) ? state.lastDirectPathWallsVersion : -1,
        lastDirectPathPadBucket: Number.isInteger(state.lastDirectPathPadBucket) ? state.lastDirectPathPadBucket : -1,
        lastDirectPathStartCx: Number.isInteger(state.lastDirectPathStartCx) ? state.lastDirectPathStartCx : 0,
        lastDirectPathStartCy: Number.isInteger(state.lastDirectPathStartCy) ? state.lastDirectPathStartCy : 0,
        lastDirectPathTargetCx: Number.isInteger(state.lastDirectPathTargetCx) ? state.lastDirectPathTargetCx : 0,
        lastDirectPathTargetCy: Number.isInteger(state.lastDirectPathTargetCy) ? state.lastDirectPathTargetCy : 0,
        orbitDirection: state.orbitDirection === -1 ? -1 : 1,
        chargeState: typeof state.chargeState === 'string' ? state.chargeState : 'idle',
        chargeCooldownRemaining: normalizeNumber(state.chargeCooldownRemaining, 0),
        chargeDurationRemaining: normalizeNumber(state.chargeDurationRemaining, 0),
        chargeRecoverRemaining: normalizeNumber(state.chargeRecoverRemaining, 0),
        chargeTargetX: normalizeNumber(state.chargeTargetX, 0),
        chargeTargetY: normalizeNumber(state.chargeTargetY, 0)
    };
}

/**
 * 플레이어 요약 정보를 정규화합니다.
 * @param {object|null|undefined} player
 * @returns {object|null}
 */
function normalizePlayerSummary(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    return {
        active: player.active !== false,
        position: clonePoint(player.position)
    };
}

/**
 * 벽 요약 정보를 정규화합니다.
 * @param {object|null|undefined} wall
 * @returns {object|null}
 */
function normalizeWallSummary(wall) {
    if (!wall || typeof wall !== 'object') {
        return null;
    }

    return {
        active: wall.active !== false,
        x: normalizeNumber(wall.x, 0),
        y: normalizeNumber(wall.y, 0),
        w: normalizeNumber(wall.w, 0),
        h: normalizeNumber(wall.h, 0),
        origin: typeof wall.origin === 'string' ? wall.origin : 'center'
    };
}

/**
 * 적 요약 정보를 정규화합니다.
 * @param {object|null|undefined} enemy
 * @returns {object|null}
 */
function normalizeEnemySummary(enemy) {
    if (!enemy || typeof enemy !== 'object' || !Number.isInteger(enemy.id)) {
        return null;
    }

    return {
        id: enemy.id,
        active: enemy.active !== false,
        type: typeof enemy.type === 'string' ? enemy.type : 'square',
        position: clonePoint(enemy.position),
        speed: clonePoint(enemy.speed),
        accSpeed: normalizeNumber(enemy.accSpeed, 0),
        renderHeightPx: normalizeNumber(enemy.renderHeightPx, 24),
        navigationRadiusPx: normalizeNumber(enemy.navigationRadiusPx, 0),
        navigationHalfWidthPx: normalizeNumber(enemy.navigationHalfWidthPx, 0),
        navigationHalfHeightPx: normalizeNumber(enemy.navigationHalfHeightPx, 0),
        rotation: normalizeNumber(enemy.rotation, 0),
        angularVelocity: normalizeNumber(enemy.angularVelocity, 0),
        angularDeceleration: normalizeNumber(enemy.angularDeceleration, 0),
        navigationAxisLocalDeg: normalizeNumber(enemy.navigationAxisLocalDeg, 0),
        navigationAxisAnisotropy: normalizeNumber(enemy.navigationAxisAnisotropy, 0),
        shouldUpdateDecision: enemy.shouldUpdateDecision === true,
        enemyAIState: cloneEnemyAIStateForTransfer(enemy.enemyAIState)
    };
}

/**
 * 적 AI 계산용 가벼운 actor를 생성합니다.
 * @param {object} summary
 * @returns {object}
 */
function createEnemyAIActor(summary) {
    const actor = {
        id: summary.id,
        active: summary.active,
        type: summary.type,
        position: clonePoint(summary.position),
        speed: clonePoint(summary.speed),
        acc: { x: 0, y: 0 },
        accSpeed: normalizeNumber(summary.accSpeed, 0),
        navigationRadiusPx: normalizeNumber(summary.navigationRadiusPx, 0),
        navigationHalfWidthPx: normalizeNumber(summary.navigationHalfWidthPx, 0),
        navigationHalfHeightPx: normalizeNumber(summary.navigationHalfHeightPx, 0),
        rotation: normalizeNumber(summary.rotation, 0),
        angularVelocity: normalizeNumber(summary.angularVelocity, 0),
        angularDeceleration: normalizeNumber(summary.angularDeceleration, 0),
        navigationAxisLocalDeg: normalizeNumber(summary.navigationAxisLocalDeg, 0),
        navigationAxisAnisotropy: normalizeNumber(summary.navigationAxisAnisotropy, 0),
        _enemyAIState: cloneEnemyAIStateForTransfer(summary.enemyAIState),
        setAcc(x, y) {
            this.acc.x = normalizeNumber(x, 0);
            this.acc.y = normalizeNumber(y, 0);
        },
        getRenderHeightPx() {
            return summary.renderHeightPx;
        }
    };
    return actor;
}

/**
 * 공유 입력 target range와 별도 전송된 AI 상태를 결합합니다.
 * @param {object[]} enemies
 * @param {object[]|null|undefined} targetEnemyStates
 * @returns {object[]}
 */
function attachTargetEnemyAIStates(enemies, targetEnemyStates) {
    if (!Array.isArray(enemies) || enemies.length === 0) {
        return [];
    }

    const stateByEnemyId = new Map();
    if (Array.isArray(targetEnemyStates)) {
        for (let i = 0; i < targetEnemyStates.length; i++) {
            const entry = targetEnemyStates[i];
            if (!Number.isInteger(entry?.id)) {
                continue;
            }

            stateByEnemyId.set(entry.id, cloneEnemyAIStateForTransfer(entry.enemyAIState));
        }
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!Number.isInteger(enemy?.id)) {
            continue;
        }

        enemy.enemyAIState = stateByEnemyId.get(enemy.id) ?? null;
    }
    return enemies;
}

/**
 * 공유 입력 스냅샷에서 이번 chunk의 AI 입력을 복원합니다.
 * @param {object} message
 * @returns {{player: object|null, walls: object[], enemies: object[], targetEnemies: object[]}|null}
 */
function readSharedEnemyAIBatchInput(message) {
    if (!enemyAISharedInputTransport || !message?.sharedInputDescriptor) {
        return null;
    }

    const sharedInput = readEnemyAISharedInputSnapshot(
        enemyAISharedInputTransport,
        message.sharedInputDescriptor,
        Array.isArray(message.enemyTypeTable) ? message.enemyTypeTable : []
    );
    if (!sharedInput) {
        return null;
    }

    const enemies = Array.isArray(sharedInput.enemies) ? sharedInput.enemies : [];
    const targetStart = Number.isInteger(message.targetRangeStart)
        ? Math.max(0, Math.min(enemies.length, message.targetRangeStart))
        : 0;
    const targetCount = Number.isInteger(message.targetRangeCount)
        ? Math.max(0, message.targetRangeCount)
        : enemies.length;
    const targetEnd = Math.max(targetStart, Math.min(enemies.length, targetStart + targetCount));
    const targetEnemies = attachTargetEnemyAIStates(
        enemies.slice(targetStart, targetEnd),
        message.targetEnemyStates
    );

    return {
        player: normalizePlayerSummary(sharedInput.player),
        walls: sharedInput.walls.map((wall) => normalizeWallSummary(wall)).filter(Boolean),
        enemies: enemies.map((enemy) => normalizeEnemySummary(enemy)).filter(Boolean),
        targetEnemies: targetEnemies.map((enemy) => normalizeEnemySummary(enemy)).filter(Boolean)
    };
}

/**
 * 메시지에서 AI 입력을 기존 message 경로 또는 공유 입력 경로로 정규화합니다.
 * @param {object} message
 * @returns {{player: object|null, walls: object[], enemies: object[], targetEnemies: object[]}}
 */
function resolveEnemyAIBatchInput(message) {
    const sharedInput = readSharedEnemyAIBatchInput(message);
    if (sharedInput) {
        return sharedInput;
    }

    const enemies = Array.isArray(message.enemies)
        ? message.enemies.map((enemy) => normalizeEnemySummary(enemy)).filter(Boolean)
        : [];
    return {
        player: normalizePlayerSummary(message.player),
        walls: Array.isArray(message.walls)
            ? message.walls.map((wall) => normalizeWallSummary(wall)).filter(Boolean)
            : [],
        enemies,
        targetEnemies: Array.isArray(message.targetEnemies)
            ? message.targetEnemies.map((enemy) => normalizeEnemySummary(enemy)).filter(Boolean)
            : enemies
    };
}

/**
 * 워커 내부 오류를 상위 워커에 보고합니다.
 * @param {unknown} error
 */
function reportEnemyAIWorkerError(error) {
    const message = error instanceof Error
        ? error.message
        : String(error);
    const stack = error instanceof Error && typeof error.stack === 'string'
        ? error.stack
        : null;
    console.error('[enemy-ai-worker]', message, error);
    self.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.ERROR, {
        error: message,
        stack,
        workerIndex: enemyAIWorkerIndex
    }));
}

/**
 * 적 AI 배치를 계산합니다.
 * @param {object} message
 * @returns {{requestId: number, requestGroupId: number, chunkIndex: number, chunkCount: number, workerIndex: number, wallsVersion: number, enemyTopologyVersion: number, enemyCount: number, durationMs: number, sharedResult: boolean, sharedResultVersion: number, sharedResultSlot: number, sharedResultOffset: number, sharedResultCount: number, results: object[]}}
 */
function computeEnemyAIBatch(message) {
    if (message.runtimeSnapshot) {
        syncSimulationRuntime(message.runtimeSnapshot);
    }

    const batchInput = resolveEnemyAIBatchInput(message);
    const player = batchInput.player;
    const walls = batchInput.walls;
    const enemies = batchInput.enemies;
    const targetEnemies = batchInput.targetEnemies;

    const aiContext = {
        player,
        walls,
        enemies,
        shouldUpdateDecision: false,
        decisionInterval: normalizeNumber(message.decisionInterval, 1),
        decisionGroup: Number.isInteger(message.decisionGroup) ? message.decisionGroup : 0,
        wallsVersion: Number.isInteger(message.wallsVersion) ? message.wallsVersion : 0,
        enemyAIQualityProfile: typeof message.enemyAIQualityProfile === 'string'
            ? message.enemyAIQualityProfile
            : 'worker_balanced',
        sharedFlowFieldByKey: new Map(),
        sharedDirectPathByKey: new Map(),
        sharedDensityFieldByKey: new Map(),
        sharedPolicyTargetByKey: new Map(),
        aiDebugStats: null
    };

    const stepDelta = normalizeNumber(message.stepDelta, 0);
    const startTime = performance.now();
    const shouldUseSharedRange = enemyAISharedTransport
        && Number.isInteger(message.sharedResultSlot)
        && Number.isInteger(message.sharedResultOffset)
        && Number.isInteger(message.sharedResultCapacity);
    const sharedWriteState = shouldUseSharedRange
        ? beginEnemyAISharedResultRangeWrite(enemyAISharedTransport, {
            slotIndex: message.sharedResultSlot,
            resultOffset: message.sharedResultOffset,
            resultCapacity: message.sharedResultCapacity
        })
        : (enemyAISharedTransport ? beginEnemyAISharedResultWrite(enemyAISharedTransport) : null);
    const results = sharedWriteState ? null : [];
    let resultCount = 0;
    for (let i = 0; i < targetEnemies.length; i++) {
        const summary = targetEnemies[i];
        if (!summary || summary.active === false) {
            continue;
        }

        aiContext.shouldUpdateDecision = summary.shouldUpdateDecision === true;
        const actor = createEnemyAIActor(summary);
        fixedUpdateEnemyAI(actor, stepDelta, aiContext);
        const result = {
            id: actor.id,
            acc: clonePoint(actor.acc),
            accSpeed: normalizeNumber(actor.accSpeed, 0),
            rotation: normalizeNumber(actor.rotation, 0),
            angularVelocity: normalizeNumber(actor.angularVelocity, 0),
            angularDeceleration: normalizeNumber(actor.angularDeceleration, 0),
            enemyAIState: cloneEnemyAIStateForTransfer(actor._enemyAIState)
        };
        if (sharedWriteState) {
            if (writeEnemyAISharedResult(sharedWriteState, result)) {
                resultCount++;
            }
            continue;
        }

        results.push(result);
        resultCount++;
    }

    const sharedResult = sharedWriteState && !shouldUseSharedRange
        ? commitEnemyAISharedResultWrite(
            sharedWriteState,
            message.requestId,
            message.wallsVersion,
            message.enemyTopologyVersion
        )
        : null;

    return {
        requestId: Number.isInteger(message.requestId) ? message.requestId : 0,
        requestGroupId: Number.isInteger(message.requestGroupId) ? message.requestGroupId : 0,
        chunkIndex: Number.isInteger(message.chunkIndex) ? message.chunkIndex : 0,
        chunkCount: Number.isInteger(message.chunkCount) ? message.chunkCount : 1,
        workerIndex: Number.isInteger(message.workerIndex) ? message.workerIndex : enemyAIWorkerIndex,
        wallsVersion: Number.isInteger(message.wallsVersion) ? message.wallsVersion : 0,
        enemyTopologyVersion: Number.isInteger(message.enemyTopologyVersion) ? message.enemyTopologyVersion : 0,
        enemyCount: sharedResult ? sharedResult.resultCount : resultCount,
        durationMs: Math.max(0, performance.now() - startTime),
        sharedResult: sharedResult !== null,
        sharedResultVersion: Number.isInteger(sharedResult?.version) ? sharedResult.version : 0,
        sharedResultSlot: shouldUseSharedRange && Number.isInteger(message.sharedResultSlot)
            ? message.sharedResultSlot
            : (Number.isInteger(sharedResult?.slotIndex) ? sharedResult.slotIndex : -1),
        sharedResultOffset: shouldUseSharedRange && Number.isInteger(message.sharedResultOffset)
            ? message.sharedResultOffset
            : 0,
        sharedResultCount: shouldUseSharedRange ? resultCount : 0,
        results: Array.isArray(results) ? results : []
    };
}

self.addEventListener('message', (event) => {
    try {
        const message = event.data;
        if (!isEnemyAIWorkerMessage(message)) {
            return;
        }

        switch (message.type) {
            case ENEMY_AI_WORKER_MESSAGE_TYPES.BOOTSTRAP:
                enemyAIWorkerIndex = Number.isInteger(message.workerIndex) ? message.workerIndex : enemyAIWorkerIndex;
                if (message.runtimeSnapshot) {
                    syncSimulationRuntime(message.runtimeSnapshot);
                }
                enemyAISharedTransport = message.sharedResultBuffers
                    ? attachEnemyAISharedTransport(message.sharedResultBuffers)
                    : null;
                enemyAISharedInputTransport = message.sharedInputBuffers
                    ? attachEnemyAISharedInputTransport(message.sharedInputBuffers)
                    : null;
                self.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.READY, {
                    bootstrapped: true,
                    workerIndex: enemyAIWorkerIndex
                }));
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.COMPUTE_BATCH:
                self.postMessage(createEnemyAIWorkerMessage(
                    ENEMY_AI_WORKER_MESSAGE_TYPES.RESULT_BATCH,
                    computeEnemyAIBatch(message)
                ));
                break;
            case ENEMY_AI_WORKER_MESSAGE_TYPES.SHUTDOWN:
                self.close();
                break;
        }
    } catch (error) {
        reportEnemyAIWorkerError(error);
    }
});

self.postMessage(createEnemyAIWorkerMessage(ENEMY_AI_WORKER_MESSAGE_TYPES.READY, {
    bootstrapped: false,
    workerIndex: enemyAIWorkerIndex
}));
