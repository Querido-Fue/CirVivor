import { GAME_SCENE_COMMAND_TYPES } from 'simulation/game_scene_simulation_protocol.js';

/**
 * 오브젝트 시스템의 시뮬레이션 명령 큐 상태를 생성합니다.
 * @returns {{enemyDespawnIds: number[], enemySpawnSnapshots: object[]}} 명령 큐 상태입니다.
 */
export function createObjectSystemSimulationCommandState() {
    return {
        enemyDespawnIds: [],
        enemySpawnSnapshots: []
    };
}

/**
 * 적 despawn 명령 후보를 큐에 추가합니다.
 * @param {{enemyDespawnIds: number[]}} commandState - 명령 큐 상태입니다.
 * @param {number|null|undefined} enemyId - 제거할 적 ID입니다.
 * @returns {void}
 */
export function queueObjectSystemEnemyDespawn(commandState, enemyId) {
    if (!commandState || !Array.isArray(commandState.enemyDespawnIds) || !Number.isInteger(enemyId)) {
        return;
    }

    commandState.enemyDespawnIds.push(enemyId);
}

/**
 * 적 spawn 명령 후보를 큐에 추가합니다.
 * @param {{enemySpawnSnapshots: object[]}} commandState - 명령 큐 상태입니다.
 * @param {object|null|undefined} enemy - 생성된 적 객체입니다.
 * @returns {void}
 */
export function queueObjectSystemEnemySpawn(commandState, enemy) {
    if (!commandState || !Array.isArray(commandState.enemySpawnSnapshots)) {
        return;
    }
    if (!enemy || typeof enemy.createSimulationSnapshot !== 'function') {
        return;
    }

    commandState.enemySpawnSnapshots.push(enemy.createSimulationSnapshot());
}

/**
 * 워커 미러 동기화에 사용할 구조 변경 명령을 생성하고 큐를 비웁니다.
 * @param {{enemyDespawnIds: number[], enemySpawnSnapshots: object[]}} commandState - 명령 큐 상태입니다.
 * @param {number} nextEnemyIdCounter - 다음 적 ID 카운터입니다.
 * @returns {object[]} 워커 미러 구조 변경 명령 목록입니다.
 */
export function consumeObjectSystemSimulationCommands(commandState, nextEnemyIdCounter) {
    if (!commandState || typeof commandState !== 'object') {
        return [];
    }

    const spawnSnapshots = Array.isArray(commandState.enemySpawnSnapshots)
        ? commandState.enemySpawnSnapshots
        : [];
    const despawnIds = Array.isArray(commandState.enemyDespawnIds)
        ? commandState.enemyDespawnIds
        : [];
    const commands = [];
    if (spawnSnapshots.length > 0) {
        commands.push({
            type: GAME_SCENE_COMMAND_TYPES.SPAWN_ENEMY_BATCH,
            enemies: [...spawnSnapshots],
            nextEnemyIdCounter
        });
    }

    const uniqueEnemyIds = [...new Set(despawnIds)];
    if (uniqueEnemyIds.length > 0) {
        commands.push({
            type: GAME_SCENE_COMMAND_TYPES.DESPAWN_ENEMY_BATCH,
            enemyIds: uniqueEnemyIds,
            nextEnemyIdCounter
        });
    }

    spawnSnapshots.length = 0;
    despawnIds.length = 0;
    commandState.enemySpawnSnapshots = spawnSnapshots;
    commandState.enemyDespawnIds = despawnIds;
    return commands;
}
