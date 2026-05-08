import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';

/**
 * 게임 씬 pending command 상태를 생성합니다.
 * @returns {{projectileDespawnIds: number[]}}
 */
export function createGameScenePendingCommandState() {
    return {
        projectileDespawnIds: []
    };
}

/**
 * 투사체 제거 ID 큐를 보장합니다.
 * @param {object|null|undefined} state - pending command 상태입니다.
 * @returns {number[]}
 */
function ensureProjectileDespawnIds(state) {
    if (!state) {
        return [];
    }
    if (!Array.isArray(state.projectileDespawnIds)) {
        state.projectileDespawnIds = [];
    }
    return state.projectileDespawnIds;
}

/**
 * pending command 상태를 비웁니다.
 * @param {object|null|undefined} state - pending command 상태입니다.
 */
export function clearGameScenePendingCommandState(state) {
    const projectileDespawnIds = ensureProjectileDespawnIds(state);
    projectileDespawnIds.length = 0;
}

/**
 * 투사체 제거 명령 후보를 큐에 추가합니다.
 * @param {object|null|undefined} state - pending command 상태입니다.
 * @param {number|null|undefined} projectileId - 제거할 투사체 ID입니다.
 * @returns {boolean}
 */
export function queueGameSceneProjectileDespawn(state, projectileId) {
    if (!state || !Number.isInteger(projectileId)) {
        return false;
    }

    ensureProjectileDespawnIds(state).push(projectileId);
    return true;
}

/**
 * pending command 상태에서 시뮬레이션 명령 목록을 소비합니다.
 * @param {object|null|undefined} state - pending command 상태입니다.
 * @param {{projIdCounter?: number}} [options={}] - 명령 생성 옵션입니다.
 * @returns {object[]}
 */
export function consumeGameScenePendingCommands(state, options = {}) {
    const commands = [];
    const projectileDespawnIds = ensureProjectileDespawnIds(state);
    const uniqueProjectileIds = [...new Set(projectileDespawnIds)];
    if (uniqueProjectileIds.length > 0) {
        commands.push({
            type: GAME_SCENE_COMMAND_TYPES.DESPAWN_PROJECTILE_BATCH,
            projectileIds: uniqueProjectileIds,
            nextProjIdCounter: options?.projIdCounter
        });
    }

    projectileDespawnIds.length = 0;
    return commands;
}
