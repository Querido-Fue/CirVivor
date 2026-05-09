import {
    ENEMY_ASPECT_RATIO,
    ENEMY_DRAW_HEIGHT_RATIO,
    ENEMY_HEIGHT_SCALE
} from '../../data/object/enemy/enemy_shape_data.js';
import { EnemyAIWorkerCoordinator } from './enemy_ai_worker_coordinator.js';
import { DEFAULT_AI_DECISION_INTERVAL_SECONDS } from './game_scene_shadow_enemy_system.js';
import {
    addShadowEnemyAngularImpulse,
    applyShadowEnemyAxisResistance,
    clearShadowEnemyStatus,
    registerShadowEnemyProjectileHit
} from './game_scene_shadow_motion.js';
import { getSimulationObjectWH } from './simulation_runtime.js';

const WORKER_ENEMY_AI_QUALITY_PROFILE = 'worker_balanced';

/**
 * 게임 씬 shadow 런타임에서 재사용하는 메타데이터입니다.
 * @type {object}
 */
export const shadowGameSceneMetadata = {
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
 * 적 렌더 높이를 계산합니다.
 * @param {object|null|undefined} enemy - 기준 적 상태입니다.
 * @returns {number} 렌더 높이(px)입니다.
 */
export function getShadowEnemyRenderHeight(enemy) {
    const objectWH = getSimulationObjectWH();
    const size = Number.isFinite(enemy?.size) ? enemy.size : 1;
    return objectWH * ENEMY_DRAW_HEIGHT_RATIO * size;
}

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
 * 현재 씬 상태에 맞지 않는 내부 시뮬레이션 메타데이터를 제거합니다.
 * @param {object|null|undefined} state - 기준 shadow state입니다.
 */
export function reconcileGameSceneShadowMetadata(state) {
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
export function markShadowPhysicsWallsDirty() {
    shadowGameSceneMetadata.physicsWallsDirty = true;
    shadowGameSceneMetadata.wallTopologyVersion++;
}

/**
 * 적 토폴로지 버전을 증가시킵니다.
 */
export function markShadowEnemyTopologyDirty() {
    shadowGameSceneMetadata.enemyTopologyVersion++;
}

/**
 * 현재 상태 기준 활성 적 ID 집합을 동기화하고, 변경 시 토폴로지 버전을 갱신합니다.
 * @param {object|null|undefined} state - 기준 shadow state입니다.
 */
export function syncShadowActiveEnemyIds(state) {
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
 * @param {number|null|undefined} enemyId - 적 ID입니다.
 * @returns {{enemyAIState: object|null, actor: object|null, actorTarget: object|null, methods: object}}
 */
export function getShadowEnemyMetadata(enemyId) {
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
 * @param {number|null|undefined} projectileId - 투사체 ID입니다.
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
 * 적 상태를 enemyAI/물리에서 사용할 프록시로 감쌉니다.
 * @param {object|null|undefined} enemy - 원본 적 상태입니다.
 * @returns {object|null} 시뮬레이션 actor입니다.
 */
export function createShadowEnemySimulationActor(enemy) {
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
 * @param {object|null|undefined} projectile - 원본 투사체 상태입니다.
 * @returns {object|null} 시뮬레이션 actor입니다.
 */
export function createShadowProjectileSimulationActor(projectile) {
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
