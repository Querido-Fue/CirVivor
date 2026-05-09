import { enemyAI } from '../object/enemy/ai/_enemy_ai.js';
import { getSimulationSetting } from './simulation_runtime.js';
import { getShadowEnemyDecisionGroup } from './game_scene_shadow_enemy_system.js';
import { createShadowWallFromData } from './game_scene_shadow_snapshot_entities.js';
import {
    cloneShadowEnemyAIStateForWorkerTransfer,
    createShadowEnemyAIPlayerSummary,
    createShadowEnemyAIWorkerEnemySummary
} from './game_scene_shadow_enemy_ai_worker_payload.js';
import {
    createShadowEnemySimulationActor,
    getShadowEnemyMetadata,
    getShadowEnemyRenderHeight,
    shadowGameSceneMetadata
} from './game_scene_shadow_metadata.js';

const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const GAME_SCENE_AI_BY_ID = Object.freeze({
    enemyAI,
    tempAI: enemyAI
});

/**
 * 워커 권한 시뮬레이션 사용 여부를 반환합니다.
 * @returns {boolean} 워커 권한 모드 여부입니다.
 */
export function isSimulationWorkerAuthorityModeEnabled() {
    return getSimulationSetting(SIMULATION_WORKER_AUTHORITY_SETTING_KEY, false) === true;
}

/**
 * 권한 모드 게임 씬 진입 시 적 AI 워커 풀을 미리 시작합니다.
 * @returns {boolean} 워커 시작 요청 성공 여부입니다.
 */
export function warmupAuthorityEnemyAIWorkers() {
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
 * @param {string|null|undefined} aiId - AI 식별자입니다.
 * @returns {object|null} AI 구현체입니다.
 */
export function resolveGameSceneAI(aiId) {
    if (typeof aiId !== 'string' || aiId.length === 0) {
        return null;
    }

    return GAME_SCENE_AI_BY_ID[aiId] || null;
}

/**
 * 적 AI 워커 결과를 현재 적 상태에 반영합니다.
 * @param {object|null|undefined} enemy - 대상 적 상태입니다.
 * @param {object|null|undefined} simulationActor - 시뮬레이션 actor입니다.
 * @param {object|null|undefined} result - 워커 결과입니다.
 */
export function applyRemoteEnemyAIResult(enemy, simulationActor, result) {
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
 * @param {object} nextState - 현재 shadow state입니다.
 * @param {object} aiContext - AI context입니다.
 * @param {number} decisionGroupCount - decision group 수입니다.
 * @param {number} stepDelta - fixed step delta입니다.
 */
export function requestAuthorityShadowEnemyAIBatch(nextState, aiContext, decisionGroupCount, stepDelta) {
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
