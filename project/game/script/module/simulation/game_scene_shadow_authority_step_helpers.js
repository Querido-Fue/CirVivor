import { isHexaMergeEnemyType } from '../object/enemy/_hexa_hive_layout.js';
import { DEFAULT_AI_DECISION_INTERVAL_SECONDS } from './game_scene_shadow_enemy_system.js';

/**
 * 권한 모드 fixed step에서 투사체 위치를 전진시킵니다.
 * @param {object[]} projectiles - 투사체 목록입니다.
 * @param {number} fixedStepSeconds - 고정 스텝 시간입니다.
 */
export function advanceAuthorityShadowProjectiles(projectiles, fixedStepSeconds) {
    if (!Array.isArray(projectiles) || !Number.isFinite(fixedStepSeconds) || fixedStepSeconds <= 0) {
        return;
    }

    for (let i = 0; i < projectiles.length; i++) {
        const projectile = projectiles[i];
        if (!projectile || projectile.active === false) {
            continue;
        }

        projectile.prevPosition.x = projectile.position.x;
        projectile.prevPosition.y = projectile.position.y;
        projectile.position.x += projectile.speed.x * fixedStepSeconds;
        projectile.position.y += projectile.speed.y * fixedStepSeconds;
    }
}

/**
 * 권한 모드 적 AI 공유 문맥을 fixed step 기준으로 초기화합니다.
 * @param {object} options - AI 문맥 초기화 옵션입니다.
 * @param {object} options.aiContext - 재사용할 AI 문맥입니다.
 * @param {object} options.nextState - 게임 씬 shadow 상태입니다.
 * @param {object[]} options.walls - 물리 벽 목록입니다.
 * @param {object} options.enemySystem - 적 시스템 상태입니다.
 * @param {number} options.decisionGroup - 현재 decision group입니다.
 * @param {number} options.wallTopologyVersion - 벽 토폴로지 버전입니다.
 * @param {number} options.enemyTopologyVersion - 적 토폴로지 버전입니다.
 * @returns {object}
 */
export function configureAuthorityShadowAIContext(options) {
    const aiContext = options.aiContext;
    const enemySystem = options.enemySystem;
    aiContext.player = options.nextState.player;
    aiContext.walls = options.walls;
    aiContext.enemies = options.nextState.enemies;
    aiContext.shouldUpdateDecision = false;
    aiContext.decisionInterval = Number.isFinite(enemySystem.aiDecisionIntervalSeconds)
        ? enemySystem.aiDecisionIntervalSeconds
        : DEFAULT_AI_DECISION_INTERVAL_SECONDS;
    aiContext.decisionGroup = options.decisionGroup;
    aiContext.wallsVersion = options.wallTopologyVersion;
    aiContext.enemyTopologyVersion = options.enemyTopologyVersion;
    aiContext.aiDebugStats = options.nextState.aiStats;
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
    return aiContext;
}

/**
 * 적 actor 목록에서 육각 합체 후보 actor만 수집합니다.
 * @param {object[]} enemyActors - 물리 적 actor 목록입니다.
 * @returns {object[]}
 */
export function collectAuthorityShadowHexaMergeActors(enemyActors) {
    const hexaMergeActors = [];
    if (!Array.isArray(enemyActors) || enemyActors.length === 0) {
        return hexaMergeActors;
    }

    for (let i = 0; i < enemyActors.length; i++) {
        const actor = enemyActors[i];
        if (actor && isHexaMergeEnemyType(actor.type)) {
            hexaMergeActors.push(actor);
        }
    }

    return hexaMergeActors;
}

/**
 * 충돌 처리용 투사체 actor 목록을 재사용 버퍼에 채웁니다.
 * @param {object[]} projectiles - 투사체 상태 목록입니다.
 * @param {object[]} projectileActors - 재사용할 actor 버퍼입니다.
 * @param {(projectile: object) => object|null} createProjectileActor - 투사체 actor 생성 함수입니다.
 * @returns {object[]}
 */
export function fillAuthorityShadowProjectileActors(projectiles, projectileActors, createProjectileActor) {
    projectileActors.length = 0;
    if (!Array.isArray(projectiles) || typeof createProjectileActor !== 'function') {
        return projectileActors;
    }

    for (let i = 0; i < projectiles.length; i++) {
        const actor = createProjectileActor(projectiles[i]);
        if (actor) {
            projectileActors.push(actor);
        }
    }

    return projectileActors;
}
