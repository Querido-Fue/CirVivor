import { enemyAI } from '../object/enemy/ai/_enemy_ai.js';
import { PhysicsSystem } from '../physics/physics_system.js';
import { getSimulationSetting } from './simulation_runtime.js';
import { GAME_SCENE_COMMAND_TYPES } from './game_scene_simulation_protocol.js';
import {
    assignShadowCollisionStats,
    cloneShadowAIStats,
    createDefaultAIStats,
    createDefaultCollisionStats,
    resetShadowAIStats
} from './game_scene_shadow_stats.js';
import {
    buildAuthorityShadowHexaMergeCandidatesById,
    buildAuthorityShadowHexaHiveSpawnData,
    clearShadowHexaHiveContactPairsForEnemyIds,
    collectAuthorityShadowHexaHiveMergeGroups,
    syncAuthorityShadowHexaHiveMergeState
} from './game_scene_shadow_hexa_hive_merge.js';
import {
    DEFAULT_AI_DECISION_GROUP_COUNT,
    assignShadowEnemySystem,
    cloneEnemySystemSnapshot,
    createDefaultEnemySystemState,
    getShadowEnemyDecisionGroup
} from './game_scene_shadow_enemy_system.js';
import {
    assignShadowPlayerFromData,
    createShadowEnemyFromSpawnData,
    createShadowPlayerFromData,
    createShadowProjectileFromData,
    createShadowWallFromData
} from './game_scene_shadow_snapshot_entities.js';
import {
    appendShadowItemsInPlace,
    compactShadowItemsByIdSet,
    fillReusableIntegerIdSet,
    replaceShadowItemsInPlace
} from './game_scene_shadow_collection_utils.js';
import {
    assignShadowCounters,
    assignShadowViewport,
    syncShadowStateViewportFromRuntime
} from './game_scene_shadow_viewport_state.js';
import {
    mergeShadowEnemyStates,
    mergeShadowProjectileStates
} from './game_scene_shadow_state_merge.js';
import {
    cloneShadowEnemyAIStateForWorkerTransfer,
    createShadowEnemyAIPlayerSummary,
    createShadowEnemyAIWorkerEnemySummary
} from './game_scene_shadow_enemy_ai_worker_payload.js';
import {
    cullAuthorityShadowEnemies,
    cullAuthorityShadowProjectiles,
    updateAuthorityPresentationState
} from './game_scene_shadow_authority_lifecycle.js';
import {
    advanceAuthorityShadowProjectiles,
    collectAuthorityShadowHexaMergeActors,
    configureAuthorityShadowAIContext,
    fillAuthorityShadowProjectileActors
} from './game_scene_shadow_authority_step_helpers.js';
import {
    advanceShadowEnemy,
    advanceShadowProjectile,
    clearShadowEnemyStatus,
    recoverShadowEnemyAxisResistance,
    updateShadowEnemyAngularMotion
} from './game_scene_shadow_motion.js';
import {
    createShadowEnemySimulationActor,
    createShadowProjectileSimulationActor,
    getShadowEnemyMetadata,
    getShadowEnemyRenderHeight,
    markShadowEnemyTopologyDirty,
    markShadowPhysicsWallsDirty,
    reconcileGameSceneShadowMetadata,
    shadowGameSceneMetadata,
    syncShadowActiveEnemyIds
} from './game_scene_shadow_metadata.js';

const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});
const shadowPhysicsSystem = new PhysicsSystem();

/**
 * 워커 권한 시뮬레이션 사용 여부를 반환합니다.
 * @returns {boolean}
 */
function isSimulationWorkerAuthorityModeEnabled() {
    return getSimulationSetting(SIMULATION_WORKER_AUTHORITY_SETTING_KEY, false) === true;
}

/**
 * 권한 모드 게임 씬 진입 시 적 AI 워커 풀을 미리 시작합니다.
 * @returns {boolean} 워커 시작 요청 성공 여부입니다.
 */
function warmupAuthorityEnemyAIWorkers() {
    if (!isSimulationWorkerAuthorityModeEnabled()) {
        return false;
    }

    const coordinator = shadowGameSceneMetadata.enemyAIWorkerCoordinator;
    if (!coordinator || typeof coordinator.ensureStarted !== 'function') {
        return false;
    }

    return coordinator.ensureStarted();
}

/**
 * 현재 타입에 대응하는 AI 구현을 반환합니다.
 * @param {string|null|undefined} aiId
 * @returns {object|null}
 */
function resolveGameSceneAI(aiId) {
    if (typeof aiId !== 'string' || aiId.length === 0) {
        return null;
    }

    return GAME_SCENE_AI_BY_ID[aiId] || null;
}

/**
 * 적 AI 워커 결과를 현재 적 상태에 반영합니다.
 * @param {object|null|undefined} enemy
 * @param {object|null|undefined} simulationActor
 * @param {object|null|undefined} result
 */
function applyRemoteEnemyAIResult(enemy, simulationActor, result) {
    if (!enemy || typeof enemy !== 'object' || !result || typeof result !== 'object') {
        return;
    }

    const actor = simulationActor ?? createShadowEnemySimulationActor(enemy);
    const accX = Number.isFinite(result.acc?.x) ? result.acc.x : 0;
    const accY = Number.isFinite(result.acc?.y) ? result.acc.y : 0;
    enemy.acc.x = accX;
    enemy.acc.y = accY;
    enemy.accSpeed = Number.isFinite(result.accSpeed) ? result.accSpeed : enemy.accSpeed;
    if (Number.isFinite(result.rotation)) {
        enemy.rotation = result.rotation;
    }
    if (Number.isFinite(result.angularVelocity)) {
        enemy.angularVelocity = result.angularVelocity;
    }
    if (Number.isFinite(result.angularDeceleration)) {
        enemy.angularDeceleration = result.angularDeceleration;
    }
    if (actor && result.enemyAIState && typeof result.enemyAIState === 'object') {
        actor._enemyAIState = cloneShadowEnemyAIStateForWorkerTransfer(result.enemyAIState);
    }
}

/**
 * 현재 authority fixed step 기준 적 AI 원격 계산 배치를 요청합니다.
 * @param {object} nextState
 * @param {object} aiContext
 * @param {number} decisionGroupCount
 * @param {number} stepDelta
 */
function requestAuthorityShadowEnemyAIBatch(nextState, aiContext, decisionGroupCount, stepDelta) {
    const coordinator = shadowGameSceneMetadata.enemyAIWorkerCoordinator;
    if (!coordinator || typeof coordinator.requestBatch !== 'function') {
        return;
    }

    const enemySummaries = [];
    for (let i = 0; i < nextState.enemies.length; i++) {
        const enemy = nextState.enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const ai = resolveGameSceneAI(enemy.aiId);
        if (!ai || ai.id !== 'enemyAI') {
            continue;
        }

        const shouldUpdateDecision = getShadowEnemyDecisionGroup(enemy, i, decisionGroupCount) === aiContext.decisionGroup;
        const metadata = getShadowEnemyMetadata(enemy.id);
        const summary = createShadowEnemyAIWorkerEnemySummary({
            enemy,
            shouldUpdateDecision,
            enemyAIState: metadata.enemyAIState,
            renderHeightPx: getShadowEnemyRenderHeight(enemy)
        });
        if (summary) {
            enemySummaries.push(summary);
        }
    }

    if (enemySummaries.length === 0) {
        return;
    }

    coordinator.requestBatch({
        stepDelta,
        decisionInterval: aiContext.decisionInterval,
        decisionGroup: aiContext.decisionGroup,
        wallsVersion: aiContext.wallsVersion,
        enemyTopologyVersion: aiContext.enemyTopologyVersion,
        enemyAIQualityProfile: aiContext.enemyAIQualityProfile,
        player: createShadowEnemyAIPlayerSummary(aiContext.player),
        walls: Array.isArray(aiContext.walls)
            ? aiContext.walls.map((wall) => createShadowWallFromData(wall)).filter(Boolean)
            : [],
        enemies: enemySummaries
    });
}

/**
 * 현재 씬 상태로부터 물리 벽 배열을 캐시해 반환합니다.
 * @param {object|null|undefined} nextState
 * @returns {object[]}
 */
function getShadowPhysicsWalls(nextState) {
    const walls = shadowGameSceneMetadata.physicsWalls;
    if (shadowGameSceneMetadata.physicsWallsDirty !== true) {
        return walls;
    }

    walls.length = 0;
    const staticWalls = Array.isArray(nextState?.staticWalls) ? nextState.staticWalls : [];
    const boxWalls = Array.isArray(nextState?.boxWalls) ? nextState.boxWalls : [];
    for (let i = 0; i < staticWalls.length; i++) {
        const wall = staticWalls[i];
        if (wall) {
            walls.push(wall);
        }
    }
    for (let i = 0; i < boxWalls.length; i++) {
        const wall = boxWalls[i];
        if (wall) {
            walls.push(wall);
        }
    }

    shadowGameSceneMetadata.physicsWallsDirty = false;
    return walls;
}

/**
 * 현재 씬 상태의 플레이어 배열을 재사용 버퍼로 반환합니다.
 * @param {object|null|undefined} nextState
 * @returns {object[]}
 */
function getShadowPhysicsPlayers(nextState) {
    const players = shadowGameSceneMetadata.physicsPlayers;
    players.length = 0;
    if (nextState?.player) {
        players.push(nextState.player);
    }
    return players;
}

/**
 * 권한 fixed step 중 비활성화된 적을 즉시 제거합니다.
 * @param {object|null|undefined} nextState
 * @returns {boolean} 제거된 적이 있었는지 여부입니다.
 */
function compactAuthorityShadowInactiveEnemies(nextState) {
    const enemies = Array.isArray(nextState?.enemies) ? nextState.enemies : null;
    if (!enemies || enemies.length === 0) {
        return false;
    }

    const removedEnemyIds = shadowGameSceneMetadata.despawnEnemyIds;
    removedEnemyIds.clear();
    let nextCount = 0;
    let removed = false;
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false) {
            if (Number.isInteger(enemy?.id)) {
                removedEnemyIds.add(enemy.id);
            }
            removed = true;
            continue;
        }

        enemies[nextCount] = enemy;
        nextCount++;
    }

    if (!removed) {
        removedEnemyIds.clear();
        return false;
    }

    enemies.length = nextCount;
    clearShadowHexaHiveContactPairsForEnemyIds(
        shadowGameSceneMetadata.hexaHiveContactSecondsByPair,
        removedEnemyIds
    );
    syncShadowActiveEnemyIds(nextState);
    removedEnemyIds.clear();
    return true;
}

/**
 * 권한 모드에서 누적 접촉 시간을 기준으로 육각 합체를 처리합니다.
 * @param {object} nextState
 * @param {Map<number, object>|null} [activeMergeCandidatesById=null]
 * @returns {number}
 */
function resolveAuthorityShadowHexaHiveMerges(nextState, activeMergeCandidatesById = null) {
    const mergeGroups = collectAuthorityShadowHexaHiveMergeGroups(
        shadowGameSceneMetadata.hexaHiveContactSecondsByPair,
        activeMergeCandidatesById instanceof Map
            ? activeMergeCandidatesById
            : buildAuthorityShadowHexaMergeCandidatesById(nextState.enemies)
    );
    if (mergeGroups.length === 0) {
        return 0;
    }

    const releaseIds = new Set();
    const mergedEnemies = [];
    for (let i = 0; i < mergeGroups.length; i++) {
        const mergeGroup = mergeGroups[i];
        if (!Array.isArray(mergeGroup) || mergeGroup.length < 2) {
            continue;
        }

        const spawnData = buildAuthorityShadowHexaHiveSpawnData(mergeGroup);
        if (!spawnData) {
            continue;
        }

        const nextEnemyId = Number.isInteger(nextState.counters?.enemyIdCounter)
            ? nextState.counters.enemyIdCounter
            : 0;
        if (!nextState.counters || typeof nextState.counters !== 'object') {
            nextState.counters = { enemyIdCounter: nextEnemyId };
        }
        nextState.counters.enemyIdCounter = nextEnemyId + 1;
        spawnData.id = nextEnemyId;

        const mergedEnemy = createShadowEnemyFromSpawnData(spawnData);
        if (mergedEnemy) {
            mergedEnemies.push(mergedEnemy);
        }

        for (let j = 0; j < mergeGroup.length; j++) {
            const enemyId = mergeGroup[j]?.id;
            if (Number.isInteger(enemyId)) {
                releaseIds.add(enemyId);
            }
        }
    }

    if (mergedEnemies.length === 0 || releaseIds.size === 0) {
        return 0;
    }

    clearShadowHexaHiveContactPairsForEnemyIds(
        shadowGameSceneMetadata.hexaHiveContactSecondsByPair,
        releaseIds
    );
    compactShadowItemsByIdSet(nextState.enemies, releaseIds);
    for (let i = 0; i < mergedEnemies.length; i++) {
        nextState.enemies.push(mergedEnemies[i]);
    }

    return mergedEnemies.length;
}

/**
 * 권한 모드에서 적 1개를 고정 스텝만큼 전진시킵니다.
 * @param {object|null|undefined} enemy
 * @param {object|null|undefined} simulationActor
 * @param {number} delta
 * @param {object} aiContext
 * @param {boolean} shouldUpdateDecision
 */
function updateAuthorityShadowEnemy(enemy, simulationActor, delta, aiContext, shouldUpdateDecision) {
    if (!enemy || typeof enemy !== 'object' || enemy.active === false) {
        return;
    }

    enemy.prevPosition.x = enemy.position.x;
    enemy.prevPosition.y = enemy.position.y;

    if (enemy.status && enemy.status.remainingTime > 0) {
        enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - delta);
        if (enemy.status.remainingTime === 0) {
            clearShadowEnemyStatus(enemy);
        }
    }

    recoverShadowEnemyAxisResistance(enemy, delta);

    const ai = resolveGameSceneAI(enemy.aiId);
    const remoteAIResult = ai?.id === 'enemyAI'
        ? shadowGameSceneMetadata.enemyAIWorkerCoordinator.getResult(
            enemy.id,
            aiContext?.wallsVersion,
            aiContext?.enemyTopologyVersion
        )
        : null;
    if (remoteAIResult) {
        applyRemoteEnemyAIResult(enemy, simulationActor, remoteAIResult);
    } else if (ai && typeof ai.fixedUpdate === 'function') {
        if (ai.id === 'enemyAI') {
            shadowGameSceneMetadata.enemyAIWorkerCoordinator.recordFallback();
        }
        aiContext.shouldUpdateDecision = shouldUpdateDecision === true;
        ai.fixedUpdate(
            simulationActor ?? createShadowEnemySimulationActor(enemy),
            delta,
            aiContext
        );
    }

    const moveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : 0;
    const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
    enemy.speed.x += enemy.acc.x * accSpeed * delta;
    enemy.speed.y += enemy.acc.y * accSpeed * delta;
    enemy.position.x += enemy.speed.x * enemy.axisResistanceX * moveSpeed * delta;
    enemy.position.y += enemy.speed.y * enemy.axisResistanceY * moveSpeed * delta;
    updateShadowEnemyAngularMotion(enemy, delta);
}

/**
 * 권한 모드에서 고정 스텝 기반 시뮬레이션을 수행합니다.
 * @param {object} nextState
 * @param {number} fixedStepSeconds
 * @param {number} fixedStepCount
 */
function runAuthorityFixedSteps(nextState, fixedStepSeconds, fixedStepCount) {
    if (fixedStepCount <= 0 || fixedStepSeconds <= 0) {
        return;
    }

    const aiDebugEnabled = getSimulationSetting('debugMode', false) === true;
    nextState.aiStats = resetShadowAIStats(nextState.aiStats, aiDebugEnabled);
    const walls = getShadowPhysicsWalls(nextState);
    const players = getShadowPhysicsPlayers(nextState);
    shadowPhysicsSystem.setWalls(walls);

    for (let stepIndex = 0; stepIndex < fixedStepCount; stepIndex++) {
        shadowPhysicsSystem.beginFrame();
        const enemyActors = shadowGameSceneMetadata.enemyActors;
        const projectileActors = shadowGameSceneMetadata.projectileActors;
        enemyActors.length = 0;
        projectileActors.length = 0;

        advanceAuthorityShadowProjectiles(nextState.projectiles, fixedStepSeconds);

        const enemySystem = nextState.enemySystem || createDefaultEnemySystemState();
        const decisionGroupCount = Number.isInteger(enemySystem.aiDecisionGroupCount) && enemySystem.aiDecisionGroupCount > 0
            ? enemySystem.aiDecisionGroupCount
            : DEFAULT_AI_DECISION_GROUP_COUNT;
        const decisionGroup = Number.isInteger(enemySystem.aiDecisionGroupCursor)
            ? enemySystem.aiDecisionGroupCursor % decisionGroupCount
            : 0;
        enemySystem.aiDecisionGroupCursor = (decisionGroup + 1) % decisionGroupCount;
        nextState.enemySystem = enemySystem;
        syncShadowActiveEnemyIds(nextState);

        const aiContext = configureAuthorityShadowAIContext({
            aiContext: shadowGameSceneMetadata.authorityAiContext,
            nextState,
            walls,
            enemySystem,
            decisionGroup,
            wallTopologyVersion: shadowGameSceneMetadata.wallTopologyVersion,
            enemyTopologyVersion: shadowGameSceneMetadata.enemyTopologyVersion
        });
        requestAuthorityShadowEnemyAIBatch(nextState, aiContext, decisionGroupCount, fixedStepSeconds);

        for (let i = 0; i < nextState.enemies.length; i++) {
            const enemy = nextState.enemies[i];
            if (!enemy || enemy.active === false) {
                continue;
            }

            const actor = createShadowEnemySimulationActor(enemy);
            updateAuthorityShadowEnemy(
                enemy,
                actor,
                fixedStepSeconds,
                aiContext,
                getShadowEnemyDecisionGroup(enemy, i, decisionGroupCount) === decisionGroup
            );

            if (actor) {
                enemyActors.push(actor);
            }
        }

        const hexaMergeActors = collectAuthorityShadowHexaMergeActors(enemyActors);
        const hexaContactPairs = hexaMergeActors.length >= 2
            ? shadowPhysicsSystem.collectEnemyContactPairs(hexaMergeActors, { delta: fixedStepSeconds })
            : [];
        const hexaMergeCandidatesById = syncAuthorityShadowHexaHiveMergeState({
            enemies: nextState.enemies,
            contactSecondsByPair: shadowGameSceneMetadata.hexaHiveContactSecondsByPair,
            delta: fixedStepSeconds,
            contactPairs: hexaContactPairs
        });

        if (enemyActors.length > 0) {
            shadowPhysicsSystem.resolveEnemyCollisions(enemyActors, {
                delta: fixedStepSeconds,
                players
            });
        }

        if (nextState.projectiles.length > 0 && enemyActors.length > 0) {
            fillAuthorityShadowProjectileActors(
                nextState.projectiles,
                projectileActors,
                createShadowProjectileSimulationActor
            );
            shadowPhysicsSystem.resolveProjectileVsEnemies(projectileActors, enemyActors, fixedStepSeconds);
        }

        const removedInactiveEnemies = compactAuthorityShadowInactiveEnemies(nextState);
        resolveAuthorityShadowHexaHiveMerges(
            nextState,
            removedInactiveEnemies
                ? buildAuthorityShadowHexaMergeCandidatesById(nextState.enemies)
                : hexaMergeCandidatesById
        );

        assignShadowCollisionStats(nextState.collisionStats, shadowPhysicsSystem.getCollisionStats());
    }
}

/**
 * 게임 씬 미러 상태의 기본 골격을 생성합니다.
 * @returns {{sceneType: string, viewport: object, counters: object, enemySystem: object, player: object|null, staticWalls: object[], boxWalls: object[], projectiles: object[], enemies: object[], collisionStats: object, aiStats: object, buttons: object[]}}
 */
export function createEmptyGameSceneShadowState() {
    return {
        sceneType: 'game',
        viewport: {
            ww: 0,
            wh: 0,
            objectWH: 0,
            objectOffsetY: 0
        },
        counters: {
            enemyIdCounter: 0,
            wallIdCounter: 0,
            projIdCounter: 0
        },
        enemySystem: createDefaultEnemySystemState(),
        player: null,
        staticWalls: [],
        boxWalls: [],
        projectiles: [],
        enemies: [],
        collisionStats: createDefaultCollisionStats(),
        aiStats: createDefaultAIStats(),
        buttons: []
    };
}

/**
 * 현재 상태를 in-place 업데이트 가능한 게임 씬 미러 상태로 정규화합니다.
 * @param {object|null|undefined} currentState
 * @returns {object}
 */
function getMutableGameSceneShadowState(currentState) {
    if (!currentState || typeof currentState !== 'object') {
        const nextState = createEmptyGameSceneShadowState();
        reconcileGameSceneShadowMetadata(nextState);
        return nextState;
    }

    currentState.sceneType = 'game';
    currentState.viewport = currentState.viewport && typeof currentState.viewport === 'object'
        ? currentState.viewport
        : {
            ww: 0,
            wh: 0,
            objectWH: 0,
            objectOffsetY: 0
        };
    currentState.counters = currentState.counters && typeof currentState.counters === 'object'
        ? currentState.counters
        : {
            enemyIdCounter: 0,
            wallIdCounter: 0,
            projIdCounter: 0
        };
    currentState.enemySystem = currentState.enemySystem && typeof currentState.enemySystem === 'object'
        ? currentState.enemySystem
        : createDefaultEnemySystemState();
    currentState.player = currentState.player ?? null;
    currentState.staticWalls = Array.isArray(currentState.staticWalls) ? currentState.staticWalls : [];
    currentState.boxWalls = Array.isArray(currentState.boxWalls) ? currentState.boxWalls : [];
    currentState.projectiles = Array.isArray(currentState.projectiles) ? currentState.projectiles : [];
    currentState.enemies = Array.isArray(currentState.enemies) ? currentState.enemies : [];
    const collisionStats = createDefaultCollisionStats();
    if (currentState.collisionStats && typeof currentState.collisionStats === 'object') {
        assignShadowCollisionStats(collisionStats, currentState.collisionStats);
    }
    currentState.collisionStats = collisionStats;
    currentState.aiStats = currentState.aiStats && typeof currentState.aiStats === 'object'
        ? currentState.aiStats
        : createDefaultAIStats();
    currentState.buttons = Array.isArray(currentState.buttons) ? currentState.buttons : [];
    return currentState;
}

/**
 * 적 AI 워커 현재 통계 스냅샷을 반환합니다.
 * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, waitMs: number, lastEnemyCount: number, poolSize: number, chunkCount: number, completedChunkCount: number, chunkResponseCount: number, sharedResultRangeCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
 */
export function getGameSceneEnemyAIWorkerStatsSnapshot() {
    return shadowGameSceneMetadata.enemyAIWorkerCoordinator.getStatsSnapshot();
}

/**
 * 적 AI 워커 코디네이터를 중지합니다.
 */
export function shutdownGameSceneEnemyAIWorkerCoordinator() {
    shadowGameSceneMetadata.enemyAIWorkerCoordinator.stop();
}

/**
 * 현재 게임 씬 미러 상태를 전체 스냅샷으로 교체합니다.
 * @param {object|null|undefined} snapshot
 * @returns {object}
 */
export function replaceGameSceneShadowState(snapshot) {
    const baseState = createEmptyGameSceneShadowState();
    if (!snapshot || typeof snapshot !== 'object') {
        markShadowEnemyTopologyDirty();
        reconcileGameSceneShadowMetadata(baseState);
        return baseState;
    }

    const collisionStats = createDefaultCollisionStats();
    if (snapshot.collisionStats && typeof snapshot.collisionStats === 'object') {
        assignShadowCollisionStats(collisionStats, snapshot.collisionStats);
    }

    const nextState = {
        ...baseState,
        ...snapshot,
        viewport: snapshot.viewport ? { ...snapshot.viewport } : baseState.viewport,
        counters: snapshot.counters ? { ...snapshot.counters } : baseState.counters,
        enemySystem: snapshot.enemySystem ? cloneEnemySystemSnapshot(snapshot.enemySystem) : baseState.enemySystem,
        player: createShadowPlayerFromData(snapshot.player),
        staticWalls: Array.isArray(snapshot.staticWalls)
            ? snapshot.staticWalls.map((wall) => createShadowWallFromData(wall)).filter(Boolean)
            : [],
        boxWalls: Array.isArray(snapshot.boxWalls)
            ? snapshot.boxWalls.map((wall) => createShadowWallFromData(wall)).filter(Boolean)
            : [],
        projectiles: Array.isArray(snapshot.projectiles)
            ? snapshot.projectiles.map((projectile) => createShadowProjectileFromData(projectile)).filter(Boolean)
            : [],
        enemies: Array.isArray(snapshot.enemies)
            ? snapshot.enemies.map((enemy) => createShadowEnemyFromSpawnData(enemy)).filter(Boolean)
            : [],
        collisionStats,
        aiStats: cloneShadowAIStats(snapshot.aiStats),
        buttons: Array.isArray(snapshot.buttons) ? [...snapshot.buttons] : []
    };

    markShadowPhysicsWallsDirty();
    markShadowEnemyTopologyDirty();
    reconcileGameSceneShadowMetadata(nextState);
    warmupAuthorityEnemyAIWorkers();
    return nextState;
}

/**
 * 게임 씬 미러 상태를 프레임 컨텍스트의 고정 스텝만큼 전진시킵니다.
 * 현재는 적/투사체처럼 순수 데이터만으로 재생 가능한 항목만 처리합니다.
 * @param {object|null|undefined} currentState
 * @param {{fixedStepSeconds?: number, fixedStepCount?: number}|null|undefined} [frameContext={}]
 * @param {{runFixedStep?: boolean, runObjectUpdate?: boolean, runSceneUpdate?: boolean}|null|undefined} [executionPolicy={}]
 * @returns {object}
 */
export function advanceGameSceneShadowState(currentState, frameContext = {}, executionPolicy = {}) {
    const nextState = getMutableGameSceneShadowState(currentState);
    syncShadowStateViewportFromRuntime(nextState);

    if (isSimulationWorkerAuthorityModeEnabled()) {
        warmupAuthorityEnemyAIWorkers();
        const fixedStepCount = Number.isInteger(frameContext?.fixedStepCount)
            ? Math.max(0, frameContext.fixedStepCount)
            : 0;
        const fixedStepSeconds = Number.isFinite(frameContext?.fixedStepSeconds) && frameContext.fixedStepSeconds > 0
            ? frameContext.fixedStepSeconds
            : 0;
        const fixedAlpha = Number.isFinite(frameContext?.fixedAlpha) ? frameContext.fixedAlpha : 0;

        if (executionPolicy?.runFixedStep !== false) {
            runAuthorityFixedSteps(nextState, fixedStepSeconds, fixedStepCount);
        }
        if (executionPolicy?.runSceneUpdate === true) {
            cullAuthorityShadowProjectiles(nextState);
        }
        if (executionPolicy?.runObjectUpdate === true) {
            cullAuthorityShadowEnemies(nextState);
            updateAuthorityPresentationState(nextState, fixedAlpha);
        }

        reconcileGameSceneShadowMetadata(nextState);
        return nextState;
    }

    shadowGameSceneMetadata.enemyAIWorkerCoordinator.stop();

    if (executionPolicy?.runFixedStep === false) {
        return nextState;
    }

    const fixedStepCount = Number.isInteger(frameContext?.fixedStepCount)
        ? Math.max(0, frameContext.fixedStepCount)
        : 0;
    const fixedStepSeconds = Number.isFinite(frameContext?.fixedStepSeconds) && frameContext.fixedStepSeconds > 0
        ? frameContext.fixedStepSeconds
        : 0;
    const hasSteppableEnemies = nextState.enemies.length > 0;
    const hasSteppableProjectiles = nextState.projectiles.length > 0;
    if (fixedStepCount <= 0 || fixedStepSeconds <= 0 || (!hasSteppableEnemies && !hasSteppableProjectiles)) {
        return nextState;
    }

    if (hasSteppableProjectiles) {
        for (let i = 0; i < nextState.projectiles.length; i++) {
            advanceShadowProjectile(nextState.projectiles[i], fixedStepSeconds, fixedStepCount);
        }
    }
    if (hasSteppableEnemies) {
        for (let i = 0; i < nextState.enemies.length; i++) {
            advanceShadowEnemy(nextState.enemies[i], fixedStepSeconds, fixedStepCount);
        }
    }
    return nextState;
}

/**
 * 게임 씬 전체 스냅샷 위에 프레임 단위 동적 상태를 덮어씁니다.
 * @param {object|null|undefined} currentState
 * @param {object|null|undefined} frameSnapshot
 * @returns {object}
 */
export function applyGameSceneFrameSnapshot(currentState, frameSnapshot) {
    const nextState = getMutableGameSceneShadowState(currentState);
    if (!frameSnapshot || typeof frameSnapshot !== 'object') {
        return nextState;
    }

    if (frameSnapshot.viewport && typeof frameSnapshot.viewport === 'object') {
        assignShadowViewport(nextState.viewport, frameSnapshot.viewport);
    }
    if (frameSnapshot.counters && typeof frameSnapshot.counters === 'object') {
        assignShadowCounters(nextState.counters, frameSnapshot.counters);
    }
    if (frameSnapshot.enemySystem && typeof frameSnapshot.enemySystem === 'object') {
        assignShadowEnemySystem(nextState.enemySystem, frameSnapshot.enemySystem);
    }
    if (frameSnapshot.player !== undefined) {
        nextState.player = assignShadowPlayerFromData(nextState.player, frameSnapshot.player);
    }
    if (Array.isArray(frameSnapshot.projectiles)) {
        replaceShadowItemsInPlace(nextState.projectiles, frameSnapshot.projectiles, createShadowProjectileFromData);
    }
    if (Array.isArray(frameSnapshot.projectileStates)) {
        mergeShadowProjectileStates(
            nextState.projectiles,
            frameSnapshot.projectileStates,
            { projectileIndexMap: shadowGameSceneMetadata.projectileIndexMap }
        );
    }
    if (Array.isArray(frameSnapshot.enemyStates)) {
        mergeShadowEnemyStates(
            nextState.enemies,
            frameSnapshot.enemyStates,
            {
                enemyIndexMap: shadowGameSceneMetadata.enemyIndexMap,
                createEnemy: createShadowEnemyFromSpawnData
            }
        );
    } else if (Array.isArray(frameSnapshot.enemies)) {
        markShadowEnemyTopologyDirty();
        replaceShadowItemsInPlace(nextState.enemies, frameSnapshot.enemies, createShadowEnemyFromSpawnData);
    }
    if (frameSnapshot.collisionStats && typeof frameSnapshot.collisionStats === 'object') {
        assignShadowCollisionStats(nextState.collisionStats, frameSnapshot.collisionStats);
    }
    if (frameSnapshot.aiStats && typeof frameSnapshot.aiStats === 'object') {
        nextState.aiStats = cloneShadowAIStats(frameSnapshot.aiStats);
    }

    reconcileGameSceneShadowMetadata(nextState);
    return nextState;
}

/**
 * 게임 씬 커맨드 배치를 미러 상태에 반영합니다.
 * @param {object|null|undefined} currentState
 * @param {object[]} [commands=[]]
 * @returns {object}
 */
export function applyGameSceneCommands(currentState, commands = []) {
    let nextState = getMutableGameSceneShadowState(currentState);
    if (!Array.isArray(commands) || commands.length === 0) {
        return nextState;
    }

    for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        if (!command || typeof command.type !== 'string') {
            continue;
        }

        switch (command.type) {
            case GAME_SCENE_COMMAND_TYPES.REPLACE_WORLD:
                nextState.player = assignShadowPlayerFromData(nextState.player, command.player);
                replaceShadowItemsInPlace(nextState.staticWalls, command.staticWalls, createShadowWallFromData);
                replaceShadowItemsInPlace(nextState.boxWalls, command.boxWalls, createShadowWallFromData);
                replaceShadowItemsInPlace(nextState.projectiles, command.projectiles, createShadowProjectileFromData);
                nextState.enemies.length = 0;
                shadowGameSceneMetadata.hexaHiveContactSecondsByPair.clear();
                nextState.counters.wallIdCounter = Number.isInteger(command.nextWallIdCounter)
                    ? command.nextWallIdCounter
                    : nextState.counters.wallIdCounter;
                nextState.counters.projIdCounter = Number.isInteger(command.nextProjIdCounter)
                    ? command.nextProjIdCounter
                    : nextState.counters.projIdCounter;
                markShadowPhysicsWallsDirty();
                markShadowEnemyTopologyDirty();
                break;
            case GAME_SCENE_COMMAND_TYPES.APPEND_BOX_WALLS:
                if (Array.isArray(command.walls) && command.walls.length > 0) {
                    appendShadowItemsInPlace(nextState.boxWalls, command.walls, createShadowWallFromData);
                    markShadowPhysicsWallsDirty();
                }
                if (Number.isInteger(command.nextWallIdCounter)) {
                    nextState.counters.wallIdCounter = command.nextWallIdCounter;
                }
                break;
            case GAME_SCENE_COMMAND_TYPES.APPEND_PROJECTILES:
                if (Array.isArray(command.projectiles) && command.projectiles.length > 0) {
                    appendShadowItemsInPlace(nextState.projectiles, command.projectiles, createShadowProjectileFromData);
                }
                if (Number.isInteger(command.nextProjIdCounter)) {
                    nextState.counters.projIdCounter = command.nextProjIdCounter;
                }
                break;
            case GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH:
                if (Array.isArray(command.projectileIds) && command.projectileIds.length > 0) {
                    const despawnProjectileIds = shadowGameSceneMetadata.despawnProjectileIds;
                    if (fillReusableIntegerIdSet(despawnProjectileIds, command.projectileIds) > 0) {
                        compactShadowItemsByIdSet(nextState.projectiles, despawnProjectileIds);
                    }
                }
                if (Number.isInteger(command.nextProjIdCounter)) {
                    nextState.counters.projIdCounter = command.nextProjIdCounter;
                }
                break;
            case GAME_SCENE_COMMAND_TYPES.DESTROY_WORLD:
                nextState = createEmptyGameSceneShadowState();
                shadowGameSceneMetadata.hexaHiveContactSecondsByPair.clear();
                markShadowPhysicsWallsDirty();
                markShadowEnemyTopologyDirty();
                break;
            case GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH:
                if (Array.isArray(command.enemies) && command.enemies.length > 0) {
                    appendShadowItemsInPlace(nextState.enemies, command.enemies, createShadowEnemyFromSpawnData);
                }
                if (Number.isInteger(command.nextEnemyIdCounter)) {
                    nextState.counters.enemyIdCounter = command.nextEnemyIdCounter;
                }
                break;
            case GAME_SCENE_COMMAND_TYPES.DESPAWN_ENEMY_BATCH:
                if (Array.isArray(command.enemyIds) && command.enemyIds.length > 0) {
                    const despawnIds = shadowGameSceneMetadata.despawnEnemyIds;
                    if (fillReusableIntegerIdSet(despawnIds, command.enemyIds) > 0) {
                        clearShadowHexaHiveContactPairsForEnemyIds(
                            shadowGameSceneMetadata.hexaHiveContactSecondsByPair,
                            despawnIds
                        );
                        compactShadowItemsByIdSet(nextState.enemies, despawnIds);
                    }
                }
                if (Number.isInteger(command.nextEnemyIdCounter)) {
                    nextState.counters.enemyIdCounter = command.nextEnemyIdCounter;
                }
                break;
        }
    }

    reconcileGameSceneShadowMetadata(nextState);
    return nextState;
}
