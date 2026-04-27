import {
    ENEMY_ASPECT_RATIO,
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_HEIGHT_SCALE
} from '../../data/object/enemy/enemy_shape_data.js';
import {
    cloneHexaHiveLayout,
    createHexaHiveLayoutFromWorldCells,
    getHexaHiveType,
    isHexaMergeEnemyType,
    snapHexaRotationDegToSymmetry
} from '../object/enemy/_hexa_hive_layout.js';
import { enemyAI } from '../object/enemy/ai/_enemy_ai.js';
import { PhysicsSystem } from '../physics/physics_system.js';
import {
    getSimulationObjectOffsetY,
    getSimulationObjectWH,
    getSimulationSetting,
    getSimulationWH,
    getSimulationWW
} from './simulation_runtime.js';
import { GAME_SCENE_COMMAND_TYPES } from './game_scene_simulation_protocol.js';
import { EnemyAIWorkerCoordinator } from './enemy_ai_worker_coordinator.js';

const AXIS_RESISTANCE_RECOVERY_SECONDS = 1;
const AXIS_RESISTANCE_EPSILON = 1e-4;
const DEFAULT_AI_DECISION_GROUP_COUNT = 60;
const DEFAULT_AI_DECISION_INTERVAL_SECONDS = 1;
const WORKER_ENEMY_AI_QUALITY_PROFILE = 'worker_balanced';
const DEFAULT_OUTSIDE_CULL_RATIO = 0.1;
const PROJECTILE_CULL_MARGIN_RATIO = 0.2;
const MAX_ANGULAR_VELOCITY = 720;
const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const SHADOW_HEXA_HIVE_TYPE = getHexaHiveType();
const SHADOW_HEXA_HIVE_MERGE_CONTACT_SECONDS = 0.5;
const SHADOW_HEXA_HIVE_MOVE_SPEED_DECAY = 0.95;
const SHADOW_HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO = 0.5;
const SHADOW_HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL = 0.5;
const SHADOW_HEXA_HIVE_MERGE_PENDING_WEIGHT = 100000;
const SHADOW_HEXA_HIVE_EPSILON = 1e-6;
const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});
const COLLISION_STAT_FIELD_NAMES = Object.freeze([
    'collisionCheckCount',
    'aabbPassCount',
    'aabbRejectCount',
    'circlePassCount',
    'circleRejectCount',
    'polygonChecks',
    'enemyTotalMs',
    'enemyBodyBuildMs',
    'playerBodyBuildMs',
    'wallBodyBuildMs',
    'enemyPositionSolveMs',
    'enemyStabilizeMs',
    'enemyNonPositionMs',
    'solveGridMs',
    'solvePairScanMs',
    'solveCandidateBuildMs',
    'solvePairProcessMs',
    'projectileTotalMs',
    'projectileEnemyBodyBuildMs',
    'projectileGridBuildMs',
    'projectileScanMs',
    'projectileCandidateQueryMs',
    'projectileNarrowphaseMs',
    'contactTotalMs',
    'contactBodyBuildMs',
    'contactGridBuildMs',
    'contactPairScanMs',
    'solveBucketPairCount',
    'solveCandidatePairCount',
    'solveDuplicatePairSkipCount',
    'solveRuleRejectCount'
]);
const shadowPhysicsSystem = new PhysicsSystem();
const shadowGameSceneMetadata = {
    enemyAIStateById: new Map(),
    enemyAIWorkerCoordinator: new EnemyAIWorkerCoordinator(),
    projectileStateById: new Map(),
    enemyIndexMap: new Map(),
    projectileIndexMap: new Map(),
    physicsWalls: [],
    physicsPlayers: [],
    enemyActors: [],
    projectileActors: [],
    physicsWallsDirty: true,
    wallTopologyVersion: 0,
    enemyTopologyVersion: 0,
    activeEnemyIds: new Set(),
    nextActiveEnemyIds: new Set(),
    activeProjectileIds: new Set(),
    despawnEnemyIds: new Set(),
    despawnProjectileIds: new Set(),
    hexaHiveContactSecondsByPair: new Map(),
    authorityAiContext: {
        player: null,
        walls: null,
        shouldUpdateDecision: false,
        decisionInterval: DEFAULT_AI_DECISION_INTERVAL_SECONDS,
        decisionGroup: 0,
        enemyAIQualityProfile: WORKER_ENEMY_AI_QUALITY_PROFILE,
        sharedFlowFieldByKey: new Map(),
        sharedDirectPathByKey: new Map(),
        sharedDensityFieldByKey: new Map(),
        sharedPolicyTargetByKey: new Map(),
        aiDebugStats: null,
        wallsVersion: 0,
        enemyTopologyVersion: 0
    }
};

/**
 * 적 메타데이터 기본값을 생성합니다.
 * @returns {{enemyAIState: object|null, actor: object|null, actorTarget: object|null, methods: object}}
 */
function createShadowEnemyMetadata() {
    const metadata = {
        enemyAIState: null,
        actor: null,
        actorTarget: null,
        methods: {}
    };

    metadata.methods = {
        setAcc: (x, y) => {
            const target = metadata.actorTarget;
            if (!target) {
                return;
            }

            target.acc.x = Number.isFinite(x) ? x : 0;
            target.acc.y = Number.isFinite(y) ? y : 0;
        },
        clearStatus: () => {
            clearShadowEnemyStatus(metadata.actorTarget);
        },
        applyAxisResistance: (factorX = 1, factorY = 1) => {
            applyShadowEnemyAxisResistance(metadata.actorTarget, factorX, factorY);
        },
        registerProjectileHit: () => registerShadowEnemyProjectileHit(metadata.actorTarget),
        addAngularImpulse: (impulse, decaySeconds = 1) => {
            addShadowEnemyAngularImpulse(metadata.actorTarget, impulse, decaySeconds);
        },
        getRenderHeightPx: () => getShadowEnemyRenderHeight(metadata.actorTarget)
    };

    return metadata;
}

/**
 * 투사체 메타데이터 기본값을 생성합니다.
 * @returns {{hitEnemyIds: Set<number>, actor: object|null, actorTarget: object|null, methods: object}}
 */
function createShadowProjectileMetadata() {
    const metadata = {
        hitEnemyIds: new Set(),
        actor: null,
        actorTarget: null,
        methods: {}
    };

    metadata.methods = {
        hasHitEnemy: (enemyId) => Number.isInteger(enemyId) && metadata.hitEnemyIds.has(enemyId),
        markEnemyHit: (enemyId) => {
            if (Number.isInteger(enemyId)) {
                metadata.hitEnemyIds.add(enemyId);
            }
        },
        clearHitHistory: () => {
            metadata.hitEnemyIds.clear();
        }
    };

    return metadata;
}

/**
 * 적 시스템 상태의 기본값을 생성합니다.
 * @returns {{aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number}}
 */
function createDefaultEnemySystemState() {
    return {
        aiDecisionGroupCursor: 0,
        aiDecisionGroupCount: DEFAULT_AI_DECISION_GROUP_COUNT,
        aiDecisionIntervalSeconds: DEFAULT_AI_DECISION_INTERVAL_SECONDS,
        enemyCullOutsideRatio: DEFAULT_OUTSIDE_CULL_RATIO
    };
}

/**
 * 충돌 통계 기본값을 생성합니다.
 * @returns {object}
 */
function createDefaultCollisionStats() {
    const stats = {};
    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        stats[COLLISION_STAT_FIELD_NAMES[i]] = 0;
    }
    return stats;
}

/**
 * AI 디버그 통계 기본값을 생성합니다.
 * @returns {{enabled: boolean, totalMs: number, enemyUpdateCount: number, heavyDecisionCount: number, localDirectPathReuseCount: number, sharedDirectPathCacheHitCount: number, sharedFlowFieldCacheHitCount: number, sharedDensityFieldCacheHitCount: number, sharedPolicyTargetCacheHitCount: number, densityFieldBuildCount: number, flowRefreshCount: number, policyCounts: object, policyMs: object}}
 */
function createDefaultAIStats() {
    return {
        enabled: false,
        totalMs: 0,
        enemyUpdateCount: 0,
        heavyDecisionCount: 0,
        localDirectPathReuseCount: 0,
        sharedDirectPathCacheHitCount: 0,
        sharedFlowFieldCacheHitCount: 0,
        sharedDensityFieldCacheHitCount: 0,
        sharedPolicyTargetCacheHitCount: 0,
        densityFieldBuildCount: 0,
        flowRefreshCount: 0,
        policyCounts: {
            chase: 0,
            chargeChase: 0,
            keepRange: 0,
            clusterJoin: 0,
            allyDensitySeek: 0,
            formationFollow: 0
        },
        policyMs: {
            chase: 0,
            chargeChase: 0,
            keepRange: 0,
            clusterJoin: 0,
            allyDensitySeek: 0,
            formationFollow: 0
        }
    };
}

/**
 * AI 통계를 현재 프레임 기준으로 초기화합니다.
 * @param {object|null|undefined} aiStats
 * @param {boolean} enabled
 * @returns {object}
 */
function resetShadowAIStats(aiStats, enabled) {
    const nextAIStats = aiStats && typeof aiStats === 'object'
        ? aiStats
        : createDefaultAIStats();

    nextAIStats.enabled = enabled === true;
    nextAIStats.totalMs = 0;
    nextAIStats.enemyUpdateCount = 0;
    nextAIStats.heavyDecisionCount = 0;
    nextAIStats.localDirectPathReuseCount = 0;
    nextAIStats.sharedDirectPathCacheHitCount = 0;
    nextAIStats.sharedFlowFieldCacheHitCount = 0;
    nextAIStats.sharedDensityFieldCacheHitCount = 0;
    nextAIStats.sharedPolicyTargetCacheHitCount = 0;
    nextAIStats.densityFieldBuildCount = 0;
    nextAIStats.flowRefreshCount = 0;
    nextAIStats.policyCounts = nextAIStats.policyCounts && typeof nextAIStats.policyCounts === 'object'
        ? nextAIStats.policyCounts
        : createDefaultAIStats().policyCounts;
    nextAIStats.policyMs = nextAIStats.policyMs && typeof nextAIStats.policyMs === 'object'
        ? nextAIStats.policyMs
        : createDefaultAIStats().policyMs;

    nextAIStats.policyCounts.chase = 0;
    nextAIStats.policyCounts.chargeChase = 0;
    nextAIStats.policyCounts.keepRange = 0;
    nextAIStats.policyCounts.clusterJoin = 0;
    nextAIStats.policyCounts.allyDensitySeek = 0;
    nextAIStats.policyCounts.formationFollow = 0;

    nextAIStats.policyMs.chase = 0;
    nextAIStats.policyMs.chargeChase = 0;
    nextAIStats.policyMs.keepRange = 0;
    nextAIStats.policyMs.clusterJoin = 0;
    nextAIStats.policyMs.allyDensitySeek = 0;
    nextAIStats.policyMs.formationFollow = 0;

    return nextAIStats;
}

/**
 * AI 통계를 얕은 읽기 전용 스냅샷으로 복제합니다.
 * @param {object|null|undefined} aiStats
 * @returns {object}
 */
function cloneShadowAIStats(aiStats) {
    const defaults = createDefaultAIStats();
    return {
        enabled: aiStats?.enabled === true,
        totalMs: Number.isFinite(aiStats?.totalMs) ? aiStats.totalMs : defaults.totalMs,
        enemyUpdateCount: Number.isFinite(aiStats?.enemyUpdateCount) ? aiStats.enemyUpdateCount : defaults.enemyUpdateCount,
        heavyDecisionCount: Number.isFinite(aiStats?.heavyDecisionCount) ? aiStats.heavyDecisionCount : defaults.heavyDecisionCount,
        localDirectPathReuseCount: Number.isFinite(aiStats?.localDirectPathReuseCount)
            ? aiStats.localDirectPathReuseCount
            : defaults.localDirectPathReuseCount,
        sharedDirectPathCacheHitCount: Number.isFinite(aiStats?.sharedDirectPathCacheHitCount)
            ? aiStats.sharedDirectPathCacheHitCount
            : defaults.sharedDirectPathCacheHitCount,
        sharedFlowFieldCacheHitCount: Number.isFinite(aiStats?.sharedFlowFieldCacheHitCount)
            ? aiStats.sharedFlowFieldCacheHitCount
            : defaults.sharedFlowFieldCacheHitCount,
        sharedDensityFieldCacheHitCount: Number.isFinite(aiStats?.sharedDensityFieldCacheHitCount)
            ? aiStats.sharedDensityFieldCacheHitCount
            : defaults.sharedDensityFieldCacheHitCount,
        sharedPolicyTargetCacheHitCount: Number.isFinite(aiStats?.sharedPolicyTargetCacheHitCount)
            ? aiStats.sharedPolicyTargetCacheHitCount
            : defaults.sharedPolicyTargetCacheHitCount,
        densityFieldBuildCount: Number.isFinite(aiStats?.densityFieldBuildCount)
            ? aiStats.densityFieldBuildCount
            : defaults.densityFieldBuildCount,
        flowRefreshCount: Number.isFinite(aiStats?.flowRefreshCount) ? aiStats.flowRefreshCount : defaults.flowRefreshCount,
        policyCounts: {
            ...defaults.policyCounts,
            ...(aiStats?.policyCounts && typeof aiStats.policyCounts === 'object' ? aiStats.policyCounts : {})
        },
        policyMs: {
            ...defaults.policyMs,
            ...(aiStats?.policyMs && typeof aiStats.policyMs === 'object' ? aiStats.policyMs : {})
        }
    };
}

/**
 * 적 시스템 상태 스냅샷을 정규화합니다.
 * @param {object|null|undefined} enemySystem
 * @returns {{aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number}}
 */
function cloneEnemySystemSnapshot(enemySystem) {
    const defaults = createDefaultEnemySystemState();
    return {
        aiDecisionGroupCursor: Number.isInteger(enemySystem?.aiDecisionGroupCursor)
            ? Math.max(0, enemySystem.aiDecisionGroupCursor)
            : defaults.aiDecisionGroupCursor,
        aiDecisionGroupCount: Number.isInteger(enemySystem?.aiDecisionGroupCount) && enemySystem.aiDecisionGroupCount > 0
            ? enemySystem.aiDecisionGroupCount
            : defaults.aiDecisionGroupCount,
        aiDecisionIntervalSeconds: Number.isFinite(enemySystem?.aiDecisionIntervalSeconds) && enemySystem.aiDecisionIntervalSeconds > 0
            ? enemySystem.aiDecisionIntervalSeconds
            : defaults.aiDecisionIntervalSeconds,
        enemyCullOutsideRatio: Number.isFinite(enemySystem?.enemyCullOutsideRatio) && enemySystem.enemyCullOutsideRatio >= 0
            ? enemySystem.enemyCullOutsideRatio
            : defaults.enemyCullOutsideRatio
    };
}

/**
 * 좌표 객체를 단순 스냅샷으로 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point
 * @returns {{x: number, y: number}}
 */
function clonePointSnapshot(point) {
    return {
        x: Number.isFinite(point?.x) ? point.x : 0,
        y: Number.isFinite(point?.y) ? point.y : 0
    };
}

/**
 * 좌표 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {{x: number, y: number}} targetPoint
 * @param {{x?: number, y?: number}|null|undefined} sourcePoint
 * @returns {{x: number, y: number}}
 */
function assignPointSnapshot(targetPoint, sourcePoint) {
    if (!targetPoint || typeof targetPoint !== 'object') {
        return clonePointSnapshot(sourcePoint);
    }

    targetPoint.x = Number.isFinite(sourcePoint?.x) ? sourcePoint.x : 0;
    targetPoint.y = Number.isFinite(sourcePoint?.y) ? sourcePoint.y : 0;
    return targetPoint;
}

/**
 * 플레이어 스냅샷을 정규화합니다.
 * @param {object|null|undefined} player
 * @returns {object|null}
 */
function createShadowPlayerFromData(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(player.position);
    const prevPosition = player.prevPosition ? clonePointSnapshot(player.prevPosition) : { ...position };
    return {
        id: Number.isInteger(player.id) ? player.id : null,
        active: player.active !== false,
        radius: Number.isFinite(player.radius) ? player.radius : 0,
        weight: Number.isFinite(player.weight) ? player.weight : 0,
        position,
        prevPosition,
        speed: clonePointSnapshot(player.speed)
    };
}

/**
 * 플레이어 스냅샷을 기존 미러 객체에 in-place로 반영합니다.
 * @param {object|null|undefined} currentPlayer
 * @param {object|null|undefined} player
 * @returns {object|null}
 */
function assignShadowPlayerFromData(currentPlayer, player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const nextPlayer = currentPlayer && typeof currentPlayer === 'object'
        ? currentPlayer
        : createShadowPlayerFromData(player);
    if (!nextPlayer) {
        return null;
    }

    nextPlayer.id = Number.isInteger(player.id) ? player.id : null;
    nextPlayer.active = player.active !== false;
    nextPlayer.radius = Number.isFinite(player.radius) ? player.radius : 0;
    nextPlayer.weight = Number.isFinite(player.weight) ? player.weight : 0;
    nextPlayer.position = assignPointSnapshot(nextPlayer.position, player.position);
    nextPlayer.prevPosition = assignPointSnapshot(nextPlayer.prevPosition, player.prevPosition ?? player.position);
    nextPlayer.speed = assignPointSnapshot(nextPlayer.speed, player.speed);
    return nextPlayer;
}

/**
 * 벽 스냅샷을 정규화합니다.
 * @param {object|null|undefined} wall
 * @returns {object|null}
 */
function createShadowWallFromData(wall) {
    if (!wall || typeof wall !== 'object') {
        return null;
    }

    return {
        id: Number.isInteger(wall.id) ? wall.id : null,
        active: wall.active !== false,
        x: Number.isFinite(wall.x) ? wall.x : 0,
        y: Number.isFinite(wall.y) ? wall.y : 0,
        w: Number.isFinite(wall.w) ? wall.w : 0,
        h: Number.isFinite(wall.h) ? wall.h : 0,
        origin: typeof wall.origin === 'string' ? wall.origin : 'center'
    };
}

/**
 * 투사체 스냅샷을 정규화합니다.
 * @param {object|null|undefined} projectile
 * @returns {object|null}
 */
function createShadowProjectileFromData(projectile) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(projectile.position);
    const prevPosition = projectile.prevPosition ? clonePointSnapshot(projectile.prevPosition) : { ...position };
    return {
        id: Number.isInteger(projectile.id) ? projectile.id : null,
        active: projectile.active !== false,
        radius: Number.isFinite(projectile.radius) ? projectile.radius : 0,
        weight: Number.isFinite(projectile.weight) ? projectile.weight : 0,
        impactForce: Number.isFinite(projectile.impactForce) ? projectile.impactForce : 0,
        piercing: projectile.piercing === true,
        position,
        prevPosition,
        speed: clonePointSnapshot(projectile.speed)
    };
}

/**
 * 현재 씬 상태에 맞지 않는 내부 시뮬레이션 메타데이터를 제거합니다.
 * @param {object|null|undefined} state
 */
function reconcileGameSceneShadowMetadata(state) {
    if (!state || typeof state !== 'object') {
        if (shadowGameSceneMetadata.activeEnemyIds.size > 0) {
            markShadowEnemyTopologyDirty();
        }
        shadowGameSceneMetadata.enemyAIStateById.clear();
        shadowGameSceneMetadata.enemyAIWorkerCoordinator.reconcileActiveEnemyIds(new Set());
        shadowGameSceneMetadata.projectileStateById.clear();
        shadowGameSceneMetadata.physicsWalls.length = 0;
        shadowGameSceneMetadata.physicsPlayers.length = 0;
        shadowGameSceneMetadata.enemyActors.length = 0;
        shadowGameSceneMetadata.projectileActors.length = 0;
        shadowGameSceneMetadata.activeEnemyIds.clear();
        shadowGameSceneMetadata.nextActiveEnemyIds.clear();
        shadowGameSceneMetadata.activeProjectileIds.clear();
        shadowGameSceneMetadata.despawnEnemyIds.clear();
        shadowGameSceneMetadata.despawnProjectileIds.clear();
        shadowGameSceneMetadata.physicsWallsDirty = true;
        return;
    }

    syncShadowActiveEnemyIds(state);

    const activeEnemyIds = shadowGameSceneMetadata.activeEnemyIds;
    const activeProjectileIds = shadowGameSceneMetadata.activeProjectileIds;
    activeProjectileIds.clear();
    if (Array.isArray(state.projectiles)) {
        for (let i = 0; i < state.projectiles.length; i++) {
            const projectileId = state.projectiles[i]?.id;
            if (Number.isInteger(projectileId)) {
                activeProjectileIds.add(projectileId);
            }
        }
    }

    for (const enemyId of shadowGameSceneMetadata.enemyAIStateById.keys()) {
        if (!activeEnemyIds.has(enemyId)) {
            shadowGameSceneMetadata.enemyAIStateById.delete(enemyId);
        }
    }
    for (const projectileId of shadowGameSceneMetadata.projectileStateById.keys()) {
        if (!activeProjectileIds.has(projectileId)) {
            shadowGameSceneMetadata.projectileStateById.delete(projectileId);
        }
    }
    shadowGameSceneMetadata.enemyAIWorkerCoordinator.reconcileActiveEnemyIds(activeEnemyIds);
}

/**
 * 물리 벽 캐시를 다음 접근 시 다시 만들도록 표시합니다.
 */
function markShadowPhysicsWallsDirty() {
    shadowGameSceneMetadata.physicsWallsDirty = true;
    shadowGameSceneMetadata.wallTopologyVersion++;
}

/**
 * 적 토폴로지 버전을 증가시킵니다.
 */
function markShadowEnemyTopologyDirty() {
    shadowGameSceneMetadata.enemyTopologyVersion++;
}

/**
 * 현재 상태 기준 활성 적 ID 집합을 동기화하고, 변경 시 토폴로지 버전을 갱신합니다.
 * @param {object|null|undefined} state
 */
function syncShadowActiveEnemyIds(state) {
    const activeEnemyIds = shadowGameSceneMetadata.activeEnemyIds;
    const nextActiveEnemyIds = shadowGameSceneMetadata.nextActiveEnemyIds;
    nextActiveEnemyIds.clear();

    let matchedActiveEnemyCount = 0;
    let topologyChanged = false;
    const enemies = Array.isArray(state?.enemies) ? state.enemies : [];
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const enemyId = enemy?.id;
        if (!Number.isInteger(enemyId) || enemy?.active === false || nextActiveEnemyIds.has(enemyId)) {
            continue;
        }

        nextActiveEnemyIds.add(enemyId);
        if (activeEnemyIds.has(enemyId)) {
            matchedActiveEnemyCount++;
        } else {
            topologyChanged = true;
        }
    }

    if (!topologyChanged && matchedActiveEnemyCount !== activeEnemyIds.size) {
        topologyChanged = true;
    }
    if (!topologyChanged && nextActiveEnemyIds.size !== activeEnemyIds.size) {
        topologyChanged = true;
    }

    activeEnemyIds.clear();
    for (const enemyId of nextActiveEnemyIds) {
        activeEnemyIds.add(enemyId);
    }
    nextActiveEnemyIds.clear();

    if (topologyChanged) {
        markShadowEnemyTopologyDirty();
    }
}

/**
 * 적 AI 메타데이터를 반환합니다.
 * @param {number|null|undefined} enemyId
 * @returns {{enemyAIState: object|null, actor: object|null, actorTarget: object|null, methods: object}}
 */
function getShadowEnemyMetadata(enemyId) {
    if (!Number.isInteger(enemyId)) {
        return createShadowEnemyMetadata();
    }

    if (!shadowGameSceneMetadata.enemyAIStateById.has(enemyId)) {
        shadowGameSceneMetadata.enemyAIStateById.set(enemyId, createShadowEnemyMetadata());
    }

    return shadowGameSceneMetadata.enemyAIStateById.get(enemyId);
}

/**
 * 투사체 메타데이터를 반환합니다.
 * @param {number|null|undefined} projectileId
 * @returns {{hitEnemyIds: Set<number>, actor: object|null, actorTarget: object|null, methods: object}}
 */
function getShadowProjectileMetadata(projectileId) {
    if (!Number.isInteger(projectileId)) {
        return createShadowProjectileMetadata();
    }

    if (!shadowGameSceneMetadata.projectileStateById.has(projectileId)) {
        shadowGameSceneMetadata.projectileStateById.set(projectileId, createShadowProjectileMetadata());
    }

    return shadowGameSceneMetadata.projectileStateById.get(projectileId);
}

/**
 * 워커 권한 시뮬레이션 사용 여부를 반환합니다.
 * @returns {boolean}
 */
function isSimulationWorkerAuthorityModeEnabled() {
    return getSimulationSetting(SIMULATION_WORKER_AUTHORITY_SETTING_KEY, false) === true;
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
 * 적 렌더 높이를 계산합니다.
 * @param {object|null|undefined} enemy
 * @returns {number}
 */
function getShadowEnemyRenderHeight(enemy) {
    const objectWH = getSimulationObjectWH();
    const size = Number.isFinite(enemy?.size) ? enemy.size : 1;
    return objectWH * ENEMY_DRAW_HEIGHT_RATIO * size;
}

/**
 * 적 AI 상태를 워커 전송용 최소 필드만 남겨 복제합니다.
 * @param {object|null|undefined} state
 * @returns {object|null}
 */
function cloneEnemyAIStateForWorkerTransfer(state) {
    if (!state || typeof state !== 'object') {
        return null;
    }

    return {
        __initialized: state.__initialized === true,
        __schemaVersion: Number.isInteger(state.__schemaVersion) ? state.__schemaVersion : 0,
        policyId: typeof state.policyId === 'string' ? state.policyId : '',
        dirX: Number.isFinite(state.dirX) ? state.dirX : 1,
        dirY: Number.isFinite(state.dirY) ? state.dirY : 0,
        baseDesiredSpeed: Number.isFinite(state.baseDesiredSpeed) ? state.baseDesiredSpeed : 40,
        desiredSpeed: Number.isFinite(state.desiredSpeed) ? state.desiredSpeed : 40,
        baseAccelResponse: Number.isFinite(state.baseAccelResponse) ? state.baseAccelResponse : 0,
        accelResponse: Number.isFinite(state.accelResponse) ? state.accelResponse : 0,
        targetX: Number.isFinite(state.targetX) ? state.targetX : Number.NaN,
        targetY: Number.isFinite(state.targetY) ? state.targetY : Number.NaN,
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
        chargeCooldownRemaining: Number.isFinite(state.chargeCooldownRemaining) ? state.chargeCooldownRemaining : 0,
        chargeDurationRemaining: Number.isFinite(state.chargeDurationRemaining) ? state.chargeDurationRemaining : 0,
        chargeRecoverRemaining: Number.isFinite(state.chargeRecoverRemaining) ? state.chargeRecoverRemaining : 0,
        chargeTargetX: Number.isFinite(state.chargeTargetX) ? state.chargeTargetX : 0,
        chargeTargetY: Number.isFinite(state.chargeTargetY) ? state.chargeTargetY : 0
    };
}

/**
 * 적 AI 워커용 플레이어 요약 정보를 생성합니다.
 * @param {object|null|undefined} player
 * @returns {object|null}
 */
function createShadowEnemyAIPlayerSummary(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    return {
        active: player.active !== false,
        position: clonePointSnapshot(player.position)
    };
}

/**
 * 적 AI 워커용 적 요약 정보를 생성합니다.
 * @param {object|null|undefined} enemy
 * @param {boolean} shouldUpdateDecision
 * @returns {object|null}
 */
function createShadowEnemyAIWorkerEnemySummary(enemy, shouldUpdateDecision) {
    if (!enemy || typeof enemy !== 'object' || enemy.active === false || !Number.isInteger(enemy.id)) {
        return null;
    }

    const metadata = getShadowEnemyMetadata(enemy.id);
    return {
        id: enemy.id,
        active: enemy.active !== false,
        type: typeof enemy.type === 'string' ? enemy.type : 'square',
        position: clonePointSnapshot(enemy.position),
        speed: clonePointSnapshot(enemy.speed),
        accSpeed: Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0,
        renderHeightPx: getShadowEnemyRenderHeight(enemy),
        shouldUpdateDecision: shouldUpdateDecision === true,
        enemyAIState: cloneEnemyAIStateForWorkerTransfer(metadata.enemyAIState)
    };
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
    if (actor && result.enemyAIState && typeof result.enemyAIState === 'object') {
        actor._enemyAIState = cloneEnemyAIStateForWorkerTransfer(result.enemyAIState);
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
        const summary = createShadowEnemyAIWorkerEnemySummary(enemy, shouldUpdateDecision);
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
 * 적 상태 이상을 초기화합니다.
 * @param {object|null|undefined} enemy
 */
function clearShadowEnemyStatus(enemy) {
    if (!enemy?.status || typeof enemy.status !== 'object') {
        return;
    }

    enemy.status.id = null;
    enemy.status.type = 'none';
    enemy.status.time = 0;
    enemy.status.remainingTime = 0;
    enemy.status.factor = {};
}

/**
 * 적 스폰 커맨드나 전체/프레임 스냅샷으로부터 미러 적 상태를 생성합니다.
 * @param {object|null|undefined} enemyData
 * @returns {object|null}
 */
function createShadowEnemyFromSpawnData(enemyData) {
    if (!enemyData || typeof enemyData !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(enemyData.position);
    const prevPosition = enemyData.prevPosition ? clonePointSnapshot(enemyData.prevPosition) : { ...position };
    const renderPosition = enemyData.renderPosition ? clonePointSnapshot(enemyData.renderPosition) : { ...position };
    return {
        id: Number.isInteger(enemyData.id) ? enemyData.id : null,
        active: enemyData.active !== false,
        type: typeof enemyData.type === 'string' ? enemyData.type : 'none',
        aiId: typeof enemyData.aiId === 'string' ? enemyData.aiId : null,
        mergeBaseMoveSpeed: Number.isFinite(enemyData.mergeBaseMoveSpeed) ? enemyData.mergeBaseMoveSpeed : null,
        hp: Number.isFinite(enemyData.hp) ? enemyData.hp : 0,
        maxHp: Number.isFinite(enemyData.maxHp) ? enemyData.maxHp : 0,
        atk: Number.isFinite(enemyData.atk) ? enemyData.atk : 0,
        moveSpeed: Number.isFinite(enemyData.moveSpeed) ? enemyData.moveSpeed : 0,
        accSpeed: Number.isFinite(enemyData.accSpeed) ? enemyData.accSpeed : 0,
        size: Number.isFinite(enemyData.size) ? enemyData.size : 1,
        weight: Number.isFinite(enemyData.weight) ? enemyData.weight : 0,
        rotationResistance: Number.isFinite(enemyData.rotationResistance) ? enemyData.rotationResistance : 1,
        projectileHitsToKill: Number.isFinite(enemyData.projectileHitsToKill) ? enemyData.projectileHitsToKill : 0,
        projectileHitCount: Number.isFinite(enemyData.projectileHitCount) ? enemyData.projectileHitCount : 0,
        position,
        prevPosition,
        renderPosition,
        speed: clonePointSnapshot(enemyData.speed),
        acc: clonePointSnapshot(enemyData.acc),
        status: enemyData.status && typeof enemyData.status === 'object'
            ? {
                id: enemyData.status.id ?? null,
                type: typeof enemyData.status.type === 'string' ? enemyData.status.type : 'none',
                time: Number.isFinite(enemyData.status.time) ? enemyData.status.time : 0,
                remainingTime: Number.isFinite(enemyData.status.remainingTime) ? enemyData.status.remainingTime : 0,
                factor: enemyData.status.factor && typeof enemyData.status.factor === 'object'
                    ? { ...enemyData.status.factor }
                    : {}
            }
            : {
                id: null,
                type: 'none',
                time: 0,
                remainingTime: 0,
                factor: {}
            },
        fill: typeof enemyData.fill === 'string' ? enemyData.fill : null,
        alpha: Number.isFinite(enemyData.alpha) ? enemyData.alpha : null,
        rotation: Number.isFinite(enemyData.rotation) ? enemyData.rotation : null,
        hexaHiveLayout: cloneHexaHiveLayout(enemyData.hexaHiveLayout),
        angularVelocity: Number.isFinite(enemyData.angularVelocity) ? enemyData.angularVelocity : 0,
        angularDeceleration: Number.isFinite(enemyData.angularDeceleration) ? enemyData.angularDeceleration : 0,
        hexaHiveMergePending: enemyData.hexaHiveMergePending === true,
        hexaHiveMergePendingWeight: Number.isFinite(enemyData.hexaHiveMergePendingWeight)
            ? enemyData.hexaHiveMergePendingWeight
            : null,
        axisResistanceX: Number.isFinite(enemyData.axisResistanceX) ? enemyData.axisResistanceX : 1,
        axisResistanceY: Number.isFinite(enemyData.axisResistanceY) ? enemyData.axisResistanceY : 1,
        axisResistanceRecoverySeconds: Number.isFinite(enemyData.axisResistanceRecoverySeconds)
            ? enemyData.axisResistanceRecoverySeconds
            : AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverDelaySeconds: Number.isFinite(enemyData.axisResistanceRecoverDelaySeconds)
            ? enemyData.axisResistanceRecoverDelaySeconds
            : 0,
        axisResistanceRecoverHoldX: Number.isFinite(enemyData.axisResistanceRecoverHoldX) ? enemyData.axisResistanceRecoverHoldX : 0,
        axisResistanceRecoverHoldY: Number.isFinite(enemyData.axisResistanceRecoverHoldY) ? enemyData.axisResistanceRecoverHoldY : 0,
        axisResistanceRecoverElapsedX: Number.isFinite(enemyData.axisResistanceRecoverElapsedX)
            ? enemyData.axisResistanceRecoverElapsedX
            : AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverElapsedY: Number.isFinite(enemyData.axisResistanceRecoverElapsedY)
            ? enemyData.axisResistanceRecoverElapsedY
            : AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverStartX: Number.isFinite(enemyData.axisResistanceRecoverStartX) ? enemyData.axisResistanceRecoverStartX : 1,
        axisResistanceRecoverStartY: Number.isFinite(enemyData.axisResistanceRecoverStartY) ? enemyData.axisResistanceRecoverStartY : 1
    };
}

/**
 * 적 상태 패치를 현재 미러 적에 병합합니다.
 * @param {object} currentEnemy
 * @param {object} enemyState
 * @returns {object}
 */
function mergeShadowEnemyState(currentEnemy, enemyState) {
    Object.assign(currentEnemy, enemyState);
    if (enemyState.hexaHiveLayout !== undefined) {
        currentEnemy.hexaHiveLayout = cloneHexaHiveLayout(enemyState.hexaHiveLayout);
    }
    if (enemyState.position) {
        currentEnemy.position = assignPointSnapshot(currentEnemy.position, enemyState.position);
    }
    if (enemyState.prevPosition) {
        currentEnemy.prevPosition = assignPointSnapshot(currentEnemy.prevPosition, enemyState.prevPosition);
    }
    if (enemyState.renderPosition) {
        currentEnemy.renderPosition = assignPointSnapshot(currentEnemy.renderPosition, enemyState.renderPosition);
    }
    if (enemyState.speed) {
        currentEnemy.speed = assignPointSnapshot(currentEnemy.speed, enemyState.speed);
    }
    if (enemyState.acc) {
        currentEnemy.acc = assignPointSnapshot(currentEnemy.acc, enemyState.acc);
    }
    if (enemyState.status) {
        currentEnemy.status = {
            id: enemyState.status.id ?? null,
            type: typeof enemyState.status.type === 'string' ? enemyState.status.type : 'none',
            time: Number.isFinite(enemyState.status.time) ? enemyState.status.time : 0,
            remainingTime: Number.isFinite(enemyState.status.remainingTime) ? enemyState.status.remainingTime : 0,
            factor: enemyState.status.factor && typeof enemyState.status.factor === 'object'
                ? { ...enemyState.status.factor }
                : {}
        };
    }
    currentEnemy.rotationResistance = Number.isFinite(enemyState.rotationResistance)
        ? enemyState.rotationResistance
        : (Number.isFinite(currentEnemy.rotationResistance) ? currentEnemy.rotationResistance : 1);
    return currentEnemy;
}

/**
 * 축 저항을 메인 시뮬레이션과 같은 방식으로 서서히 복구합니다.
 * @param {object} enemy
 * @param {number} delta
 */
function recoverShadowEnemyAxisResistance(enemy, delta) {
    if (!Number.isFinite(delta) || delta <= 0 || !enemy) {
        return;
    }

    const recoverySeconds = Number.isFinite(enemy.axisResistanceRecoverySeconds) && enemy.axisResistanceRecoverySeconds > 0
        ? enemy.axisResistanceRecoverySeconds
        : AXIS_RESISTANCE_RECOVERY_SECONDS;

    if ((1 - enemy.axisResistanceX) <= AXIS_RESISTANCE_EPSILON) {
        enemy.axisResistanceX = 1;
        enemy.axisResistanceRecoverStartX = 1;
        enemy.axisResistanceRecoverElapsedX = recoverySeconds;
        enemy.axisResistanceRecoverHoldX = 0;
    } else if (enemy.axisResistanceRecoverHoldX > 0) {
        enemy.axisResistanceRecoverHoldX = Math.max(0, enemy.axisResistanceRecoverHoldX - delta);
    } else {
        const nextElapsedX = Math.min(recoverySeconds, enemy.axisResistanceRecoverElapsedX + delta);
        enemy.axisResistanceRecoverElapsedX = nextElapsedX;
        const tx = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedX / recoverySeconds);
        const smoothX = tx * tx * (3 - (2 * tx));
        const startX = Number.isFinite(enemy.axisResistanceRecoverStartX) ? enemy.axisResistanceRecoverStartX : enemy.axisResistanceX;
        enemy.axisResistanceX = startX + ((1 - startX) * smoothX);
        if ((1 - enemy.axisResistanceX) <= AXIS_RESISTANCE_EPSILON || tx >= 1) {
            enemy.axisResistanceX = 1;
            enemy.axisResistanceRecoverStartX = 1;
            enemy.axisResistanceRecoverElapsedX = recoverySeconds;
        }
    }

    if ((1 - enemy.axisResistanceY) <= AXIS_RESISTANCE_EPSILON) {
        enemy.axisResistanceY = 1;
        enemy.axisResistanceRecoverStartY = 1;
        enemy.axisResistanceRecoverElapsedY = recoverySeconds;
        enemy.axisResistanceRecoverHoldY = 0;
    } else if (enemy.axisResistanceRecoverHoldY > 0) {
        enemy.axisResistanceRecoverHoldY = Math.max(0, enemy.axisResistanceRecoverHoldY - delta);
    } else {
        const nextElapsedY = Math.min(recoverySeconds, enemy.axisResistanceRecoverElapsedY + delta);
        enemy.axisResistanceRecoverElapsedY = nextElapsedY;
        const ty = recoverySeconds <= AXIS_RESISTANCE_EPSILON ? 1 : (nextElapsedY / recoverySeconds);
        const smoothY = ty * ty * (3 - (2 * ty));
        const startY = Number.isFinite(enemy.axisResistanceRecoverStartY) ? enemy.axisResistanceRecoverStartY : enemy.axisResistanceY;
        enemy.axisResistanceY = startY + ((1 - startY) * smoothY);
        if ((1 - enemy.axisResistanceY) <= AXIS_RESISTANCE_EPSILON || ty >= 1) {
            enemy.axisResistanceY = 1;
            enemy.axisResistanceRecoverStartY = 1;
            enemy.axisResistanceRecoverElapsedY = recoverySeconds;
        }
    }
}

/**
 * 회전 반동 감쇠를 메인 시뮬레이션과 같은 방식으로 적용합니다.
 * @param {object} enemy
 * @param {number} delta
 */
function updateShadowEnemyAngularMotion(enemy, delta) {
    if (!Number.isFinite(delta) || delta <= 0 || !enemy) {
        return;
    }

    if (!Number.isFinite(enemy.angularVelocity) || enemy.angularVelocity === 0) {
        return;
    }

    if (Number.isFinite(enemy.rotation)) {
        enemy.rotation += enemy.angularVelocity * delta;
    }

    const decel = Math.max(0, Number.isFinite(enemy.angularDeceleration) ? enemy.angularDeceleration : 0);
    const step = decel * delta;
    if (step <= 0) {
        return;
    }

    if (Math.abs(enemy.angularVelocity) <= step) {
        enemy.angularVelocity = 0;
        enemy.angularDeceleration = 0;
        return;
    }

    enemy.angularVelocity -= Math.sign(enemy.angularVelocity) * step;
}

/**
 * 적 하나를 AI/충돌 이전 순수 적분 구간만큼 전진시킵니다.
 * 메인 스레드 프레임 패치가 이후에 보정하므로, 여기서는 순수 상태 머신만 재생합니다.
 * @param {object|null|undefined} enemy
 * @param {number} fixedStepSeconds
 * @param {number} fixedStepCount
 * @returns {object|null}
 */
function advanceShadowEnemy(enemy, fixedStepSeconds, fixedStepCount) {
    if (!enemy || typeof enemy !== 'object') {
        return null;
    }

    enemy.position = enemy.position && typeof enemy.position === 'object'
        ? enemy.position
        : clonePointSnapshot(null);
    enemy.prevPosition = enemy.prevPosition && typeof enemy.prevPosition === 'object'
        ? enemy.prevPosition
        : clonePointSnapshot(enemy.position);
    enemy.renderPosition = enemy.renderPosition && typeof enemy.renderPosition === 'object'
        ? enemy.renderPosition
        : clonePointSnapshot(enemy.position);
    enemy.speed = enemy.speed && typeof enemy.speed === 'object'
        ? enemy.speed
        : clonePointSnapshot(null);
    enemy.acc = enemy.acc && typeof enemy.acc === 'object'
        ? enemy.acc
        : clonePointSnapshot(null);
    if (!enemy.status || typeof enemy.status !== 'object') {
        enemy.status = {
            id: null,
            type: 'none',
            time: 0,
            remainingTime: 0,
            factor: {}
        };
    }
    if (enemy.active === false) {
        return enemy;
    }

    const moveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : 0;
    const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
    for (let stepIndex = 0; stepIndex < fixedStepCount; stepIndex++) {
        enemy.prevPosition.x = enemy.position.x;
        enemy.prevPosition.y = enemy.position.y;

        if (enemy.status && enemy.status.remainingTime > 0) {
            enemy.status.remainingTime = Math.max(0, enemy.status.remainingTime - fixedStepSeconds);
            if (enemy.status.remainingTime === 0) {
                enemy.status.id = null;
                enemy.status.type = 'none';
                enemy.status.time = 0;
                enemy.status.remainingTime = 0;
                enemy.status.factor = {};
            }
        }

        recoverShadowEnemyAxisResistance(enemy, fixedStepSeconds);

        enemy.speed.x += enemy.acc.x * accSpeed * fixedStepSeconds;
        enemy.speed.y += enemy.acc.y * accSpeed * fixedStepSeconds;
        enemy.position.x += enemy.speed.x * enemy.axisResistanceX * moveSpeed * fixedStepSeconds;
        enemy.position.y += enemy.speed.y * enemy.axisResistanceY * moveSpeed * fixedStepSeconds;

        updateShadowEnemyAngularMotion(enemy, fixedStepSeconds);
    }

    enemy.renderPosition.x = enemy.position.x;
    enemy.renderPosition.y = enemy.position.y;

    return enemy;
}

/**
 * 적 상태 패치 목록을 ID 기준으로 현재 미러 적 배열에 병합합니다.
 * @param {object[]} [currentEnemies=[]]
 * @param {object[]} [enemyStates=[]]
 * @returns {object[]}
 */
function mergeShadowEnemyStates(currentEnemies = [], enemyStates = []) {
    if (!Array.isArray(enemyStates) || enemyStates.length === 0) {
        return Array.isArray(currentEnemies) ? currentEnemies : [];
    }

    const nextEnemies = Array.isArray(currentEnemies) ? currentEnemies : [];
    const enemyIndexMap = shadowGameSceneMetadata.enemyIndexMap;
    enemyIndexMap.clear();
    for (let i = 0; i < nextEnemies.length; i++) {
        const enemy = nextEnemies[i];
        if (!enemy || !Number.isInteger(enemy.id)) continue;
        enemyIndexMap.set(enemy.id, i);
    }

    for (let i = 0; i < enemyStates.length; i++) {
        const enemyState = enemyStates[i];
        if (!enemyState || !Number.isInteger(enemyState.id)) {
            continue;
        }

        const enemyIndex = enemyIndexMap.get(enemyState.id);
        const currentEnemy = Number.isInteger(enemyIndex)
            ? nextEnemies[enemyIndex]
            : createShadowEnemyFromSpawnData(enemyState);
        if (!currentEnemy) {
            continue;
        }

        const mergedEnemy = mergeShadowEnemyState(currentEnemy, enemyState);
        if (Number.isInteger(enemyIndex)) {
            nextEnemies[enemyIndex] = mergedEnemy;
            continue;
        }

        enemyIndexMap.set(enemyState.id, nextEnemies.length);
        nextEnemies.push(mergedEnemy);
    }

    return nextEnemies;
}

/**
 * 투사체 상태 패치를 현재 미러 투사체에 병합합니다.
 * @param {object} currentProjectile
 * @param {object} projectileState
 * @returns {object}
 */
function mergeShadowProjectileState(currentProjectile, projectileState) {
    Object.assign(currentProjectile, projectileState);
    if (projectileState.position) {
        currentProjectile.position = assignPointSnapshot(currentProjectile.position, projectileState.position);
    }
    if (projectileState.prevPosition) {
        currentProjectile.prevPosition = assignPointSnapshot(currentProjectile.prevPosition, projectileState.prevPosition);
    }
    if (projectileState.speed) {
        currentProjectile.speed = assignPointSnapshot(currentProjectile.speed, projectileState.speed);
    }
    return currentProjectile;
}

/**
 * 투사체 상태 패치 목록을 ID 기준으로 현재 미러 투사체 배열에 병합합니다.
 * @param {object[]} [currentProjectiles=[]]
 * @param {object[]} [projectileStates=[]]
 * @returns {object[]}
 */
function mergeShadowProjectileStates(currentProjectiles = [], projectileStates = []) {
    if (!Array.isArray(projectileStates) || projectileStates.length === 0) {
        return Array.isArray(currentProjectiles) ? currentProjectiles : [];
    }

    const nextProjectiles = Array.isArray(currentProjectiles) ? currentProjectiles : [];
    const projectileIndexMap = shadowGameSceneMetadata.projectileIndexMap;
    projectileIndexMap.clear();
    for (let i = 0; i < nextProjectiles.length; i++) {
        const projectile = nextProjectiles[i];
        if (!projectile || !Number.isInteger(projectile.id)) continue;
        projectileIndexMap.set(projectile.id, i);
    }

    for (let i = 0; i < projectileStates.length; i++) {
        const projectileState = projectileStates[i];
        if (!projectileState || !Number.isInteger(projectileState.id)) {
            continue;
        }

        const projectileIndex = projectileIndexMap.get(projectileState.id);
        const currentProjectile = Number.isInteger(projectileIndex)
            ? nextProjectiles[projectileIndex]
            : {
            id: projectileState.id,
            active: projectileState.active === true,
            position: clonePointSnapshot(projectileState.position),
            prevPosition: clonePointSnapshot(projectileState.prevPosition),
            speed: clonePointSnapshot(projectileState.speed)
        };
        const mergedProjectile = mergeShadowProjectileState(currentProjectile, projectileState);
        if (Number.isInteger(projectileIndex)) {
            nextProjectiles[projectileIndex] = mergedProjectile;
            continue;
        }

        projectileIndexMap.set(projectileState.id, nextProjectiles.length);
        nextProjectiles.push(mergedProjectile);
    }

    return nextProjectiles;
}

/**
 * 투사체 하나를 지정한 고정 스텝 횟수만큼 전진시킵니다.
 * @param {object|null|undefined} projectile
 * @param {number} fixedStepSeconds
 * @param {number} fixedStepCount
 * @returns {object|null}
 */
function advanceShadowProjectile(projectile, fixedStepSeconds, fixedStepCount) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    projectile.position = projectile.position && typeof projectile.position === 'object'
        ? projectile.position
        : clonePointSnapshot(null);
    projectile.prevPosition = projectile.prevPosition && typeof projectile.prevPosition === 'object'
        ? projectile.prevPosition
        : clonePointSnapshot(projectile.position);
    projectile.speed = projectile.speed && typeof projectile.speed === 'object'
        ? projectile.speed
        : clonePointSnapshot(null);

    if (projectile.active === false) {
        return projectile;
    }

    for (let stepIndex = 0; stepIndex < fixedStepCount; stepIndex++) {
        projectile.prevPosition.x = projectile.position.x;
        projectile.prevPosition.y = projectile.position.y;
        projectile.position.x += projectile.speed.x * fixedStepSeconds;
        projectile.position.y += projectile.speed.y * fixedStepSeconds;
    }

    return projectile;
}

/**
 * 충돌 저항을 즉시 낮추고 복구 타이머를 갱신합니다.
 * @param {object|null|undefined} enemy
 * @param {number} [factorX=1]
 * @param {number} [factorY=1]
 */
function applyShadowEnemyAxisResistance(enemy, factorX = 1, factorY = 1) {
    if (!enemy || typeof enemy !== 'object') {
        return;
    }

    const fx = Number.isFinite(factorX) ? Math.max(0, Math.min(1, factorX)) : 1;
    const fy = Number.isFinite(factorY) ? Math.max(0, Math.min(1, factorY)) : 1;
    const currentX = Number.isFinite(enemy.axisResistanceX) ? enemy.axisResistanceX : 1;
    const currentY = Number.isFinite(enemy.axisResistanceY) ? enemy.axisResistanceY : 1;
    const nextX = Math.min(currentX, fx);
    const nextY = Math.min(currentY, fy);
    const recoverSeconds = Number.isFinite(enemy.axisResistanceRecoverySeconds) && enemy.axisResistanceRecoverySeconds > 0
        ? enemy.axisResistanceRecoverySeconds
        : AXIS_RESISTANCE_RECOVERY_SECONDS;
    const recoverDelay = Number.isFinite(enemy.axisResistanceRecoverDelaySeconds) && enemy.axisResistanceRecoverDelaySeconds > 0
        ? enemy.axisResistanceRecoverDelaySeconds
        : 0;

    if (nextX < (currentX - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceX = nextX;
        enemy.axisResistanceRecoverStartX = nextX;
        enemy.axisResistanceRecoverElapsedX = 0;
    }
    if (nextY < (currentY - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceY = nextY;
        enemy.axisResistanceRecoverStartY = nextY;
        enemy.axisResistanceRecoverElapsedY = 0;
    }

    if (nextX < (1 - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceRecoverHoldX = recoverDelay;
        enemy.axisResistanceRecoverElapsedX = Math.min(
            Number.isFinite(enemy.axisResistanceRecoverElapsedX) ? enemy.axisResistanceRecoverElapsedX : 0,
            recoverSeconds
        );
    }
    if (nextY < (1 - AXIS_RESISTANCE_EPSILON)) {
        enemy.axisResistanceRecoverHoldY = recoverDelay;
        enemy.axisResistanceRecoverElapsedY = Math.min(
            Number.isFinite(enemy.axisResistanceRecoverElapsedY) ? enemy.axisResistanceRecoverElapsedY : 0,
            recoverSeconds
        );
    }
}

/**
 * 투사체 피격 카운트를 반영합니다.
 * @param {object|null|undefined} enemy
 * @returns {boolean}
 */
function registerShadowEnemyProjectileHit(enemy) {
    if (!enemy || typeof enemy !== 'object') {
        return false;
    }

    const threshold = Number.isFinite(enemy.projectileHitsToKill)
        ? Math.max(0, Math.floor(enemy.projectileHitsToKill))
        : 0;
    if (threshold <= 0) {
        return false;
    }

    enemy.projectileHitCount = (Number.isFinite(enemy.projectileHitCount) ? enemy.projectileHitCount : 0) + 1;
    if (enemy.projectileHitCount < threshold) {
        return false;
    }

    enemy.active = false;
    return true;
}

/**
 * 적 회전 반동을 반영합니다.
 * @param {object|null|undefined} enemy
 * @param {number} impulse
 * @param {number} [decaySeconds=1]
 */
function addShadowEnemyAngularImpulse(enemy, impulse, decaySeconds = 1) {
    if (!enemy || typeof enemy !== 'object' || !Number.isFinite(impulse) || impulse === 0) {
        return;
    }

    const rotationResistance = Math.max(
        1,
        Number.isFinite(enemy.rotationResistance) ? enemy.rotationResistance : 1
    );
    enemy.angularVelocity = Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0;
    enemy.angularVelocity += impulse / rotationResistance;
    if (enemy.angularVelocity > MAX_ANGULAR_VELOCITY) enemy.angularVelocity = MAX_ANGULAR_VELOCITY;
    if (enemy.angularVelocity < -MAX_ANGULAR_VELOCITY) enemy.angularVelocity = -MAX_ANGULAR_VELOCITY;
    const safeDecay = Math.max(0.016, Number.isFinite(decaySeconds) ? decaySeconds : 1);
    enemy.angularDeceleration = Math.abs(enemy.angularVelocity) / safeDecay;
}

/**
 * 적 상태를 enemyAI/물리에서 사용할 프록시로 감쌉니다.
 * @param {object|null|undefined} enemy
 * @returns {object|null}
 */
function createShadowEnemySimulationActor(enemy) {
    if (!enemy || typeof enemy !== 'object') {
        return null;
    }

    const metadata = getShadowEnemyMetadata(enemy.id);
    if (metadata.actor && metadata.actorTarget === enemy) {
        return metadata.actor;
    }
    metadata.actorTarget = enemy;

    metadata.actor = new Proxy(enemy, {
        get(target, prop, receiver) {
            if (prop === '_enemyAIState') {
                return metadata.enemyAIState ?? null;
            }
            if (prop === 'aspectRatio') {
                return ENEMY_ASPECT_RATIO[target.type] ?? 1;
            }
            if (prop === 'heightScale') {
                return ENEMY_HEIGHT_SCALE[target.type] ?? 1;
            }
            if (prop === 'setAcc') {
                return metadata.methods.setAcc;
            }
            if (prop === 'clearStatus') {
                return metadata.methods.clearStatus;
            }
            if (prop === 'applyAxisResistance') {
                return metadata.methods.applyAxisResistance;
            }
            if (prop === 'registerProjectileHit') {
                return metadata.methods.registerProjectileHit;
            }
            if (prop === 'addAngularImpulse') {
                return metadata.methods.addAngularImpulse;
            }
            if (prop === 'getRenderHeightPx') {
                return metadata.methods.getRenderHeightPx;
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
            if (prop === '_enemyAIState') {
                metadata.enemyAIState = value && typeof value === 'object' ? value : null;
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        }
    });
    return metadata.actor;
}

/**
 * 투사체 상태를 충돌 처리용 프록시로 감쌉니다.
 * @param {object|null|undefined} projectile
 * @returns {object|null}
 */
function createShadowProjectileSimulationActor(projectile) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    const metadata = getShadowProjectileMetadata(projectile.id);
    if (metadata.actor && metadata.actorTarget === projectile) {
        return metadata.actor;
    }
    metadata.actorTarget = projectile;

    metadata.actor = new Proxy(projectile, {
        get(target, prop, receiver) {
            if (prop === 'hasHitEnemy') {
                return metadata.methods.hasHitEnemy;
            }
            if (prop === 'markEnemyHit') {
                return metadata.methods.markEnemyHit;
            }
            if (prop === 'clearHitHistory') {
                return metadata.methods.clearHitHistory;
            }
            if (prop === 'hitEnemyIds') {
                return metadata.hitEnemyIds;
            }
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, value, receiver) {
            if (prop === 'hitEnemyIds') {
                metadata.hitEnemyIds.clear();
                if (value instanceof Set) {
                    value.forEach((enemyId) => {
                        if (Number.isInteger(enemyId)) {
                            metadata.hitEnemyIds.add(enemyId);
                        }
                    });
                }
                return true;
            }
            return Reflect.set(target, prop, value, receiver);
        }
    });
    return metadata.actor;
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
 * 정수 ID 배열을 재사용 가능한 Set에 채웁니다.
 * @param {Set<number>} targetSet
 * @param {number[]|null|undefined} ids
 * @returns {number}
 */
function fillReusableIntegerIdSet(targetSet, ids) {
    targetSet.clear();
    if (!Array.isArray(ids) || ids.length === 0) {
        return 0;
    }

    let count = 0;
    for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (!Number.isInteger(id)) {
            continue;
        }

        targetSet.add(id);
        count++;
    }

    return count;
}

/**
 * ID Set에 포함된 적을 제외하도록 배열을 in-place compaction합니다.
 * @param {object[]} enemies
 * @param {Set<number>} despawnIds
 */
function compactShadowEnemiesByIdSet(enemies, despawnIds) {
    if (!Array.isArray(enemies) || enemies.length === 0 || !(despawnIds instanceof Set) || despawnIds.size === 0) {
        return;
    }

    let nextCount = 0;
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || despawnIds.has(enemy.id)) {
            continue;
        }

        enemies[nextCount] = enemy;
        nextCount++;
    }

    enemies.length = nextCount;
}

/**
 * ID Set에 포함된 투사체를 제외하도록 배열을 in-place compaction합니다.
 * @param {object[]} projectiles
 * @param {Set<number>} despawnIds
 */
function compactShadowProjectilesByIdSet(projectiles, despawnIds) {
    if (!Array.isArray(projectiles) || projectiles.length === 0 || !(despawnIds instanceof Set) || despawnIds.size === 0) {
        return;
    }

    let nextCount = 0;
    for (let i = 0; i < projectiles.length; i++) {
        const projectile = projectiles[i];
        if (!projectile || despawnIds.has(projectile.id)) {
            continue;
        }

        projectiles[nextCount] = projectile;
        nextCount++;
    }

    projectiles.length = nextCount;
}

/**
 * 현재 런타임 뷰포트를 씬 스냅샷에 반영합니다.
 * @param {object|null|undefined} state
 */
function syncShadowStateViewportFromRuntime(state) {
    if (!state || typeof state !== 'object') {
        return;
    }

    state.viewport = state.viewport && typeof state.viewport === 'object'
        ? state.viewport
        : {
            ww: 0,
            wh: 0,
            objectWH: 0,
            objectOffsetY: 0
        };
    state.viewport.ww = getSimulationWW();
    state.viewport.wh = getSimulationWH();
    state.viewport.objectWH = getSimulationObjectWH();
    state.viewport.objectOffsetY = getSimulationObjectOffsetY();
}

/**
 * 뷰포트 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {object} targetViewport
 * @param {object|null|undefined} sourceViewport
 */
function assignShadowViewport(targetViewport, sourceViewport) {
    if (!targetViewport || !sourceViewport || typeof sourceViewport !== 'object') {
        return;
    }

    if (Number.isFinite(sourceViewport.ww)) targetViewport.ww = sourceViewport.ww;
    if (Number.isFinite(sourceViewport.wh)) targetViewport.wh = sourceViewport.wh;
    if (Number.isFinite(sourceViewport.objectWH)) targetViewport.objectWH = sourceViewport.objectWH;
    if (Number.isFinite(sourceViewport.objectOffsetY)) targetViewport.objectOffsetY = sourceViewport.objectOffsetY;
}

/**
 * 카운터 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {object} targetCounters
 * @param {object|null|undefined} sourceCounters
 */
function assignShadowCounters(targetCounters, sourceCounters) {
    if (!targetCounters || !sourceCounters || typeof sourceCounters !== 'object') {
        return;
    }

    if (Number.isInteger(sourceCounters.enemyIdCounter)) targetCounters.enemyIdCounter = sourceCounters.enemyIdCounter;
    if (Number.isInteger(sourceCounters.wallIdCounter)) targetCounters.wallIdCounter = sourceCounters.wallIdCounter;
    if (Number.isInteger(sourceCounters.projIdCounter)) targetCounters.projIdCounter = sourceCounters.projIdCounter;
}

/**
 * 충돌 통계를 기존 객체에 in-place로 반영합니다.
 * @param {object} targetStats
 * @param {object|null|undefined} sourceStats
 */
function assignShadowCollisionStats(targetStats, sourceStats) {
    if (!targetStats || !sourceStats || typeof sourceStats !== 'object') {
        return;
    }

    for (let i = 0; i < COLLISION_STAT_FIELD_NAMES.length; i++) {
        const fieldName = COLLISION_STAT_FIELD_NAMES[i];
        if (Number.isFinite(sourceStats[fieldName])) {
            targetStats[fieldName] = sourceStats[fieldName];
        }
    }
    for (const [fieldName, value] of Object.entries(sourceStats)) {
        if (Number.isFinite(value)) {
            targetStats[fieldName] = value;
        }
    }
}

/**
 * 적 시스템 상태를 기존 객체에 in-place로 반영합니다.
 * @param {object} targetEnemySystem
 * @param {object|null|undefined} sourceEnemySystem
 */
function assignShadowEnemySystem(targetEnemySystem, sourceEnemySystem) {
    if (!targetEnemySystem || !sourceEnemySystem || typeof sourceEnemySystem !== 'object') {
        return;
    }

    targetEnemySystem.aiDecisionGroupCursor = Number.isInteger(sourceEnemySystem.aiDecisionGroupCursor)
        ? Math.max(0, sourceEnemySystem.aiDecisionGroupCursor)
        : 0;
    targetEnemySystem.aiDecisionGroupCount = Number.isInteger(sourceEnemySystem.aiDecisionGroupCount)
        && sourceEnemySystem.aiDecisionGroupCount > 0
        ? sourceEnemySystem.aiDecisionGroupCount
        : DEFAULT_AI_DECISION_GROUP_COUNT;
    targetEnemySystem.aiDecisionIntervalSeconds = Number.isFinite(sourceEnemySystem.aiDecisionIntervalSeconds)
        && sourceEnemySystem.aiDecisionIntervalSeconds > 0
        ? sourceEnemySystem.aiDecisionIntervalSeconds
        : DEFAULT_AI_DECISION_INTERVAL_SECONDS;
    targetEnemySystem.enemyCullOutsideRatio = Number.isFinite(sourceEnemySystem.enemyCullOutsideRatio)
        && sourceEnemySystem.enemyCullOutsideRatio >= 0
        ? sourceEnemySystem.enemyCullOutsideRatio
        : DEFAULT_OUTSIDE_CULL_RATIO;
}

/**
 * 생성 함수를 이용해 대상 배열을 in-place로 교체합니다.
 * @param {object[]} targetArray
 * @param {object[]|null|undefined} sourceArray
 * @param {(value: object) => object|null} createItem
 * @returns {object[]}
 */
function replaceShadowItemsInPlace(targetArray, sourceArray, createItem) {
    targetArray.length = 0;
    if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
        return targetArray;
    }

    for (let i = 0; i < sourceArray.length; i++) {
        const nextItem = createItem(sourceArray[i]);
        if (nextItem) {
            targetArray.push(nextItem);
        }
    }

    return targetArray;
}

/**
 * 생성 함수를 이용해 대상 배열에 항목을 이어붙입니다.
 * @param {object[]} targetArray
 * @param {object[]|null|undefined} sourceArray
 * @param {(value: object) => object|null} createItem
 * @returns {object[]}
 */
function appendShadowItemsInPlace(targetArray, sourceArray, createItem) {
    if (!Array.isArray(sourceArray) || sourceArray.length === 0) {
        return targetArray;
    }

    for (let i = 0; i < sourceArray.length; i++) {
        const nextItem = createItem(sourceArray[i]);
        if (nextItem) {
            targetArray.push(nextItem);
        }
    }

    return targetArray;
}

/**
 * 적의 렌더 좌표를 보간합니다.
 * @param {object|null|undefined} enemy
 * @param {number} alpha
 */
function interpolateShadowEnemyRenderPosition(enemy, alpha) {
    if (!enemy || typeof enemy !== 'object') {
        return;
    }

    const t = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    enemy.renderPosition.x = enemy.prevPosition.x + ((enemy.position.x - enemy.prevPosition.x) * t);
    enemy.renderPosition.y = enemy.prevPosition.y + ((enemy.position.y - enemy.prevPosition.y) * t);
}

/**
 * 적 ID를 바탕으로 AI 결정 그룹을 계산합니다.
 * @param {object|null|undefined} enemy
 * @param {number} fallbackIndex
 * @param {number} decisionGroupCount
 * @returns {number}
 */
function getShadowEnemyDecisionGroup(enemy, fallbackIndex, decisionGroupCount) {
    const safeCount = Number.isInteger(decisionGroupCount) && decisionGroupCount > 0
        ? decisionGroupCount
        : DEFAULT_AI_DECISION_GROUP_COUNT;
    const sourceId = Number.isInteger(enemy?.id) ? enemy.id : fallbackIndex;
    const mod = sourceId % safeCount;
    return mod < 0 ? mod + safeCount : mod;
}

/**
 * 합체 적의 기준 이동 속도를 반환합니다.
 * @param {object|null|undefined} enemy
 * @returns {number}
 */
function getShadowHexaHiveBaseMoveSpeed(enemy) {
    if (Number.isFinite(enemy?.mergeBaseMoveSpeed) && enemy.mergeBaseMoveSpeed > 0) {
        return enemy.mergeBaseMoveSpeed;
    }
    if (Number.isFinite(enemy?.moveSpeed) && enemy.moveSpeed > 0) {
        return enemy.moveSpeed;
    }
    return 0;
}

/**
 * 육각 합체 접촉 쌍 키를 생성합니다.
 * @param {number} enemyIdA
 * @param {number} enemyIdB
 * @returns {string}
 */
function buildShadowHexaHivePairKey(enemyIdA, enemyIdB) {
    const firstId = enemyIdA < enemyIdB ? enemyIdA : enemyIdB;
    const secondId = enemyIdA < enemyIdB ? enemyIdB : enemyIdA;
    return `${firstId}:${secondId}`;
}

/**
 * 육각 합체 접촉 쌍 키를 파싱합니다.
 * @param {string} pairKey
 * @returns {number[]}
 */
function parseShadowHexaHivePairKey(pairKey) {
    if (typeof pairKey !== 'string') {
        return [];
    }

    const [left, right] = pairKey.split(':');
    const enemyIdA = Number.parseInt(left, 10);
    const enemyIdB = Number.parseInt(right, 10);
    if (!Number.isInteger(enemyIdA) || !Number.isInteger(enemyIdB)) {
        return [];
    }
    return [enemyIdA, enemyIdB];
}

/**
 * 지정한 적 ID와 연결된 접촉 타이머를 제거합니다.
 * @param {Set<number>} enemyIds
 */
function clearShadowHexaHiveContactPairsForEnemyIds(enemyIds) {
    if (!(enemyIds instanceof Set) || enemyIds.size === 0) {
        return;
    }

    const timers = shadowGameSceneMetadata.hexaHiveContactSecondsByPair;
    for (const pairKey of timers.keys()) {
        const [enemyIdA, enemyIdB] = parseShadowHexaHivePairKey(pairKey);
        if (enemyIds.has(enemyIdA) || enemyIds.has(enemyIdB)) {
            timers.delete(pairKey);
        }
    }
}

/**
 * 그림자 적 상태에서 현재 보이는 육각 조각의 월드 중심을 수집합니다.
 * @param {object|null|undefined} enemy
 * @returns {{x: number, y: number}[]}
 */
function collectShadowHexaWorldCellsFromEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object' || enemy.active === false || !isHexaMergeEnemyType(enemy.type)) {
        return [];
    }

    const positionX = Number.isFinite(enemy.position?.x) ? enemy.position.x : 0;
    const positionY = Number.isFinite(enemy.position?.y) ? enemy.position.y : 0;
    if (enemy.type !== SHADOW_HEXA_HIVE_TYPE || !Array.isArray(enemy.hexaHiveLayout?.visibleLocalCenters)) {
        return [{ x: positionX, y: positionY }];
    }

    const baseHeight = getShadowEnemyRenderHeight(enemy);
    if (!(baseHeight > SHADOW_HEXA_HIVE_EPSILON)) {
        return [{ x: positionX, y: positionY }];
    }

    const rotationRadians = (Number.isFinite(enemy.rotation) ? enemy.rotation : 0) * (Math.PI / 180);
    const cos = Math.cos(rotationRadians);
    const sin = Math.sin(rotationRadians);
    const worldCells = [];
    for (let i = 0; i < enemy.hexaHiveLayout.visibleLocalCenters.length; i++) {
        const localCenter = enemy.hexaHiveLayout.visibleLocalCenters[i];
        const localX = (Number.isFinite(localCenter?.x) ? localCenter.x : 0) * baseHeight;
        const localY = (Number.isFinite(localCenter?.y) ? localCenter.y : 0) * baseHeight;
        worldCells.push({
            x: positionX + ((localX * cos) - (localY * sin)),
            y: positionY + ((localX * sin) + (localY * cos))
        });
    }

    return worldCells.length > 0 ? worldCells : [{ x: positionX, y: positionY }];
}

/**
 * 권한 모드에서 현재 활성 육각 합체 후보 맵을 생성합니다.
 * @param {object} nextState
 * @returns {Map<number, object>}
 */
function buildAuthorityShadowHexaMergeCandidatesById(nextState) {
    const activeMergeCandidatesById = new Map();
    for (let i = 0; i < nextState.enemies.length; i++) {
        const enemy = nextState.enemies[i];
        if (!enemy || enemy.active === false || !Number.isInteger(enemy.id) || !isHexaMergeEnemyType(enemy.type)) {
            continue;
        }

        activeMergeCandidatesById.set(enemy.id, enemy);
    }

    return activeMergeCandidatesById;
}

/**
 * 권한 모드에서 육각 합체 접촉 타이머를 갱신합니다.
 * @param {Map<number, object>} activeMergeCandidatesById
 * @param {number} delta
 * @param {{enemyA: object, enemyB: object}[]} contactPairs
 */
function updateAuthorityShadowHexaHiveContactTimers(activeMergeCandidatesById, delta, contactPairs) {
    const activePairKeys = new Set();
    const timers = shadowGameSceneMetadata.hexaHiveContactSecondsByPair;
    if (Array.isArray(contactPairs)) {
        for (let i = 0; i < contactPairs.length; i++) {
            const pair = contactPairs[i];
            const enemyA = pair?.enemyA;
            const enemyB = pair?.enemyB;
            if (!enemyA || !enemyB || enemyA === enemyB) {
                continue;
            }
            if (!activeMergeCandidatesById.has(enemyA.id) || !activeMergeCandidatesById.has(enemyB.id)) {
                continue;
            }

            const pairKey = buildShadowHexaHivePairKey(enemyA.id, enemyB.id);
            activePairKeys.add(pairKey);
            timers.set(pairKey, (timers.get(pairKey) || 0) + delta);
        }
    }

    for (const pairKey of [...timers.keys()]) {
        if (!activePairKeys.has(pairKey)) {
            timers.delete(pairKey);
        }
    }
}

/**
 * 권한 모드에서 합체 대기 중인 육각형의 임시 고중량 상태를 동기화합니다.
 * @param {Map<number, object>} activeMergeCandidatesById
 */
function applyAuthorityShadowHexaHivePendingState(activeMergeCandidatesById) {
    const pendingEnemyIds = new Set();
    const timers = shadowGameSceneMetadata.hexaHiveContactSecondsByPair;
    for (const [pairKey, contactSeconds] of timers.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds <= 0) {
            continue;
        }

        const [enemyIdA, enemyIdB] = parseShadowHexaHivePairKey(pairKey);
        if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
            continue;
        }

        pendingEnemyIds.add(enemyIdA);
        pendingEnemyIds.add(enemyIdB);
    }

    for (const enemy of activeMergeCandidatesById.values()) {
        enemy.hexaHiveMergePending = pendingEnemyIds.has(enemy.id);
        enemy.hexaHiveMergePendingWeight = enemy.hexaHiveMergePending
            ? SHADOW_HEXA_HIVE_MERGE_PENDING_WEIGHT
            : null;
    }
}

/**
 * 권한 모드에서 합체 접촉 상태를 한 번에 동기화합니다.
 * @param {object} nextState
 * @param {number} delta
 * @param {{enemyA: object, enemyB: object}[]} contactPairs
 * @returns {Map<number, object>}
 */
function syncAuthorityShadowHexaHiveMergeState(nextState, delta, contactPairs) {
    const activeMergeCandidatesById = buildAuthorityShadowHexaMergeCandidatesById(nextState);
    updateAuthorityShadowHexaHiveContactTimers(activeMergeCandidatesById, delta, contactPairs);
    applyAuthorityShadowHexaHivePendingState(activeMergeCandidatesById);
    return activeMergeCandidatesById;
}

/**
 * 권한 모드에서 접촉 시간 기준 육각 합체 그룹을 수집합니다.
 * @param {Map<number, object>} activeMergeCandidatesById
 * @returns {object[][]}
 */
function collectAuthorityShadowHexaHiveMergeGroups(activeMergeCandidatesById) {
    if (!(activeMergeCandidatesById instanceof Map) || activeMergeCandidatesById.size === 0) {
        return [];
    }

    const timers = shadowGameSceneMetadata.hexaHiveContactSecondsByPair;

    const adjacency = new Map();
    for (const [pairKey, contactSeconds] of timers.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds < SHADOW_HEXA_HIVE_MERGE_CONTACT_SECONDS) {
            continue;
        }

        const [enemyIdA, enemyIdB] = parseShadowHexaHivePairKey(pairKey);
        if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
            continue;
        }

        if (!adjacency.has(enemyIdA)) adjacency.set(enemyIdA, new Set());
        if (!adjacency.has(enemyIdB)) adjacency.set(enemyIdB, new Set());
        adjacency.get(enemyIdA).add(enemyIdB);
        adjacency.get(enemyIdB).add(enemyIdA);
    }

    const mergeGroups = [];
    const visited = new Set();
    for (const [enemyId, enemy] of activeMergeCandidatesById.entries()) {
        if (visited.has(enemyId) || !adjacency.has(enemyId)) {
            continue;
        }

        const queue = [enemyId];
        const mergeGroup = [];
        visited.add(enemyId);
        while (queue.length > 0) {
            const currentId = queue.shift();
            const currentEnemy = activeMergeCandidatesById.get(currentId);
            if (currentEnemy) {
                mergeGroup.push(currentEnemy);
            }

            const neighbors = adjacency.get(currentId);
            if (!neighbors) {
                continue;
            }

            for (const neighborId of neighbors) {
                if (visited.has(neighborId)) {
                    continue;
                }

                visited.add(neighborId);
                queue.push(neighborId);
            }
        }

        if (mergeGroup.length >= 2) {
            mergeGroups.push(mergeGroup);
        }
    }

    return mergeGroups;
}

/**
 * 합체 그룹으로부터 그림자 합체 적 스폰 데이터를 생성합니다.
 * @param {object[]} mergeGroup
 * @returns {object|null}
 */
function buildAuthorityShadowHexaHiveSpawnData(mergeGroup) {
    if (!Array.isArray(mergeGroup) || mergeGroup.length < 2) {
        return null;
    }

    const worldCells = [];
    let totalMass = 0;
    let weightedCenterX = 0;
    let weightedCenterY = 0;
    let weightedRotationSin = 0;
    let weightedRotationCos = 0;
    let weightedSpeedX = 0;
    let weightedSpeedY = 0;
    let weightedAngularVelocity = 0;
    let weightedBaseMoveSpeed = 0;
    let weightedCurrentMoveSpeed = 0;
    let weightedAccSpeed = 0;
    let weightedSize = 0;
    let weightedBaseHeight = 0;
    let weightedAlpha = 0;
    let alphaWeight = 0;
    let totalWeight = 0;
    let totalMaxHp = 0;
    let totalHp = 0;
    let totalAtk = 0;
    let totalProjectileHitsToKill = 0;
    let totalCells = 0;
    let preferredFill = null;

    for (let i = 0; i < mergeGroup.length; i++) {
        const enemy = mergeGroup[i];
        const enemyCells = collectShadowHexaWorldCellsFromEnemy(enemy);
        if (enemyCells.length === 0) {
            continue;
        }

        const enemyWeight = Math.max(
            SHADOW_HEXA_HIVE_EPSILON,
            Number.isFinite(enemy.weight) ? enemy.weight : 1
        );
        const cellMass = enemyWeight / enemyCells.length;
        const baseMoveSpeed = getShadowHexaHiveBaseMoveSpeed(enemy);
        const currentMoveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : baseMoveSpeed;
        const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
        const size = Number.isFinite(enemy.size) ? enemy.size : 1;
        const baseHeight = getShadowEnemyRenderHeight(enemy);
        const rotationRadians = (Number.isFinite(enemy.rotation) ? enemy.rotation : 0) * (Math.PI / 180);

        for (let j = 0; j < enemyCells.length; j++) {
            worldCells.push(enemyCells[j]);
            totalMass += cellMass;
            weightedCenterX += enemyCells[j].x * cellMass;
            weightedCenterY += enemyCells[j].y * cellMass;
        }

        totalCells += enemyCells.length;
        totalWeight += enemyWeight;
        totalMaxHp += Number.isFinite(enemy.maxHp) ? enemy.maxHp : 0;
        totalHp += Number.isFinite(enemy.hp) ? enemy.hp : 0;
        totalAtk += Number.isFinite(enemy.atk) ? enemy.atk : 0;
        totalProjectileHitsToKill += Number.isFinite(enemy.projectileHitsToKill)
            ? enemy.projectileHitsToKill
            : 0;
        weightedRotationSin += Math.sin(rotationRadians) * enemyWeight;
        weightedRotationCos += Math.cos(rotationRadians) * enemyWeight;
        weightedSpeedX += (Number.isFinite(enemy.speed?.x) ? enemy.speed.x : 0) * enemyWeight;
        weightedSpeedY += (Number.isFinite(enemy.speed?.y) ? enemy.speed.y : 0) * enemyWeight;
        weightedAngularVelocity += (Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0) * enemyWeight;
        weightedBaseMoveSpeed += baseMoveSpeed * enemyCells.length;
        weightedCurrentMoveSpeed += currentMoveSpeed * enemyCells.length;
        weightedAccSpeed += accSpeed * enemyCells.length;
        weightedSize += size * enemyCells.length;
        weightedBaseHeight += baseHeight * enemyCells.length;
        if (Number.isFinite(enemy.alpha)) {
            weightedAlpha += enemy.alpha * enemyCells.length;
            alphaWeight += enemyCells.length;
        }
        if (preferredFill === null && typeof enemy.fill === 'string') {
            preferredFill = enemy.fill;
        }
    }

    if (worldCells.length === 0 || totalMass <= SHADOW_HEXA_HIVE_EPSILON || totalCells <= 0) {
        return null;
    }

    const centerX = weightedCenterX / totalMass;
    const centerY = weightedCenterY / totalMass;
    const baseHeight = weightedBaseHeight / totalCells;
    const mergedRotation = snapHexaRotationDegToSymmetry(
        Math.atan2(weightedRotationSin, weightedRotationCos) * (180 / Math.PI)
    );
    const mergedBaseMoveSpeed = weightedBaseMoveSpeed / totalCells;
    const mergedCurrentMoveSpeed = weightedCurrentMoveSpeed / totalCells;
    const mergedMoveSpeed = Math.max(
        mergedBaseMoveSpeed * SHADOW_HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO,
        mergedCurrentMoveSpeed * SHADOW_HEXA_HIVE_MOVE_SPEED_DECAY
    );
    const mergedWeight = totalWeight * (1 + ((Math.max(1, totalCells) - 1) * SHADOW_HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL));
    const mergedMaxHp = totalMaxHp;
    const mergedHp = Math.min(mergedMaxHp, totalHp + (mergedMaxHp * 0.1));
    const mergedAngularVelocity = weightedAngularVelocity / Math.max(SHADOW_HEXA_HIVE_EPSILON, totalWeight);

    return {
        type: SHADOW_HEXA_HIVE_TYPE,
        hp: mergedHp,
        maxHp: mergedMaxHp,
        atk: totalAtk,
        moveSpeed: mergedMoveSpeed,
        mergeBaseMoveSpeed: mergedBaseMoveSpeed,
        accSpeed: weightedAccSpeed / totalCells,
        size: weightedSize / totalCells,
        weight: mergedWeight,
        rotationResistance: Math.max(1, totalCells),
        projectileHitsToKill: Math.max(0, Math.round(totalProjectileHitsToKill)),
        position: { x: centerX, y: centerY },
        speed: {
            x: weightedSpeedX / Math.max(SHADOW_HEXA_HIVE_EPSILON, totalWeight),
            y: weightedSpeedY / Math.max(SHADOW_HEXA_HIVE_EPSILON, totalWeight)
        },
        acc: { x: 0, y: 0 },
        aiId: 'enemyAI',
        fill: preferredFill,
        alpha: alphaWeight > 0 ? (weightedAlpha / alphaWeight) : 1,
        rotation: mergedRotation,
        angularVelocity: mergedAngularVelocity,
        angularDeceleration: Math.abs(mergedAngularVelocity),
        hexaHiveLayout: createHexaHiveLayoutFromWorldCells(worldCells, {
            originX: centerX,
            originY: centerY,
            baseHeight,
            rotationDeg: mergedRotation
        })
    };
}

/**
 * 권한 모드에서 누적 접촉 시간을 기준으로 육각 합체를 처리합니다.
 * @param {object} nextState
 * @param {Map<number, object>|null} [activeMergeCandidatesById=null]
 * @returns {number}
 */
function resolveAuthorityShadowHexaHiveMerges(nextState, activeMergeCandidatesById = null) {
    const mergeGroups = collectAuthorityShadowHexaHiveMergeGroups(
        activeMergeCandidatesById instanceof Map
            ? activeMergeCandidatesById
            : buildAuthorityShadowHexaMergeCandidatesById(nextState)
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

    clearShadowHexaHiveContactPairsForEnemyIds(releaseIds);
    compactShadowEnemiesByIdSet(nextState.enemies, releaseIds);
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

        for (let i = 0; i < nextState.projectiles.length; i++) {
            const projectile = nextState.projectiles[i];
            if (!projectile || projectile.active === false) {
                continue;
            }

            projectile.prevPosition.x = projectile.position.x;
            projectile.prevPosition.y = projectile.position.y;
            projectile.position.x += projectile.speed.x * fixedStepSeconds;
            projectile.position.y += projectile.speed.y * fixedStepSeconds;
        }

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

        const aiContext = shadowGameSceneMetadata.authorityAiContext;
        aiContext.player = nextState.player;
        aiContext.walls = walls;
        aiContext.enemies = nextState.enemies;
        aiContext.shouldUpdateDecision = false;
        aiContext.decisionInterval = Number.isFinite(enemySystem.aiDecisionIntervalSeconds)
            ? enemySystem.aiDecisionIntervalSeconds
            : DEFAULT_AI_DECISION_INTERVAL_SECONDS;
        aiContext.decisionGroup = decisionGroup;
        aiContext.wallsVersion = shadowGameSceneMetadata.wallTopologyVersion;
        aiContext.enemyTopologyVersion = shadowGameSceneMetadata.enemyTopologyVersion;
        aiContext.aiDebugStats = nextState.aiStats;
        if (aiContext.sharedFlowFieldByKey instanceof Map) {
            aiContext.sharedFlowFieldByKey.clear();
        }
        if (aiContext.sharedDirectPathByKey instanceof Map) {
            aiContext.sharedDirectPathByKey.clear();
        }
        if (aiContext.sharedDensityFieldByKey instanceof Map) {
            aiContext.sharedDensityFieldByKey.clear();
        }
        if (aiContext.sharedPolicyTargetByKey instanceof Map) {
            aiContext.sharedPolicyTargetByKey.clear();
        }
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

        const hexaMergeActors = [];
        for (let i = 0; i < enemyActors.length; i++) {
            const actor = enemyActors[i];
            if (actor && isHexaMergeEnemyType(actor.type)) {
                hexaMergeActors.push(actor);
            }
        }
        const hexaContactPairs = hexaMergeActors.length >= 2
            ? shadowPhysicsSystem.collectEnemyContactPairs(hexaMergeActors, { delta: fixedStepSeconds })
            : [];
        const hexaMergeCandidatesById = syncAuthorityShadowHexaHiveMergeState(
            nextState,
            fixedStepSeconds,
            hexaContactPairs
        );

        if (enemyActors.length > 0) {
            shadowPhysicsSystem.resolveEnemyCollisions(enemyActors, {
                delta: fixedStepSeconds,
                players
            });
        }

        if (nextState.projectiles.length > 0 && enemyActors.length > 0) {
            for (let i = 0; i < nextState.projectiles.length; i++) {
                const actor = createShadowProjectileSimulationActor(nextState.projectiles[i]);
                if (actor) {
                    projectileActors.push(actor);
                }
            }
            shadowPhysicsSystem.resolveProjectileVsEnemies(projectileActors, enemyActors, fixedStepSeconds);
        }

        resolveAuthorityShadowHexaHiveMerges(nextState, hexaMergeCandidatesById);

        assignShadowCollisionStats(nextState.collisionStats, shadowPhysicsSystem.getCollisionStats());
    }
}

/**
 * 화면 밖으로 벗어난 적을 제거합니다.
 * @param {object} nextState
 */
function cullAuthorityShadowEnemies(nextState) {
    const ww = Number.isFinite(nextState.viewport?.ww) ? nextState.viewport.ww : getSimulationWW();
    const objectWH = Number.isFinite(nextState.viewport?.objectWH) ? nextState.viewport.objectWH : getSimulationObjectWH();
    const outsideRatio = Number.isFinite(nextState.enemySystem?.enemyCullOutsideRatio)
        ? nextState.enemySystem.enemyCullOutsideRatio
        : DEFAULT_OUTSIDE_CULL_RATIO;
    const marginX = ww * outsideRatio;
    const marginY = objectWH * outsideRatio;

    let nextEnemyCount = 0;
    for (let i = 0; i < nextState.enemies.length; i++) {
        const enemy = nextState.enemies[i];
        if (!enemy || enemy.active === false) {
            continue;
        }

        const isOutside = enemy.position.x < -marginX
            || enemy.position.x > ww + marginX
            || enemy.position.y < -marginY
            || enemy.position.y > objectWH + marginY;
        if (isOutside) {
            continue;
        }

        nextState.enemies[nextEnemyCount] = enemy;
        nextEnemyCount++;
    }
    nextState.enemies.length = nextEnemyCount;
}

/**
 * 화면 밖으로 벗어난 투사체를 제거합니다.
 * @param {object} nextState
 */
function cullAuthorityShadowProjectiles(nextState) {
    const ww = Number.isFinite(nextState.viewport?.ww) ? nextState.viewport.ww : getSimulationWW();
    const objectWH = Number.isFinite(nextState.viewport?.objectWH) ? nextState.viewport.objectWH : getSimulationObjectWH();
    const cullMinX = -ww * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxX = ww * (1 + PROJECTILE_CULL_MARGIN_RATIO);
    const cullMinY = -objectWH * PROJECTILE_CULL_MARGIN_RATIO;
    const cullMaxY = objectWH * (1 + PROJECTILE_CULL_MARGIN_RATIO);

    let nextProjectileCount = 0;
    for (let i = 0; i < nextState.projectiles.length; i++) {
        const projectile = nextState.projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        const x = projectile.position.x;
        const y = projectile.position.y;
        const isOutside = x < cullMinX || x > cullMaxX || y < cullMinY || y > cullMaxY;
        if (isOutside) {
            continue;
        }

        nextState.projectiles[nextProjectileCount] = projectile;
        nextProjectileCount++;
    }
    nextState.projectiles.length = nextProjectileCount;
}

/**
 * 권한 모드 프레젠테이션용 렌더 좌표를 계산합니다.
 * @param {object} nextState
 * @param {number} fixedAlpha
 */
function updateAuthorityPresentationState(nextState, fixedAlpha) {
    for (let i = 0; i < nextState.enemies.length; i++) {
        interpolateShadowEnemyRenderPosition(nextState.enemies[i], fixedAlpha);
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
 * @returns {{supported: boolean, running: boolean, ready: boolean, requestCount: number, responseCount: number, fallbackCount: number, staleDropCount: number, lastRequestId: number, lastCompletedRequestId: number, lastLatencyMs: number, lastEnemyCount: number, latestRequestedWallsVersion: number, latestRequestedEnemyTopologyVersion: number, lastWallsVersion: number, lastEnemyTopologyVersion: number, transportSupported: boolean, transportMode: string, lastSharedResultVersion: number, lastError: string|null}}
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
        mergeShadowProjectileStates(nextState.projectiles, frameSnapshot.projectileStates);
    }
    if (Array.isArray(frameSnapshot.enemyStates)) {
        mergeShadowEnemyStates(nextState.enemies, frameSnapshot.enemyStates);
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
                        compactShadowProjectilesByIdSet(nextState.projectiles, despawnProjectileIds);
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
                        clearShadowHexaHiveContactPairsForEnemyIds(despawnIds);
                        compactShadowEnemiesByIdSet(nextState.enemies, despawnIds);
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
