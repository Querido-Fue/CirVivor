import { cloneHexaHiveLayout } from '../object/enemy/_hexa_hive_layout.js';
import {
    assignPointSnapshot,
    clonePointSnapshot
} from './game_scene_shadow_snapshot_entities.js';

/**
 * 적 상태 패치를 현재 미러 적에 병합합니다.
 * @param {object} currentEnemy - 현재 미러 적입니다.
 * @param {object} enemyState - 병합할 적 상태 패치입니다.
 * @returns {object} 병합된 적 상태입니다.
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
 * 적 상태 패치 목록을 ID 기준으로 현재 미러 적 배열에 병합합니다.
 * @param {object[]} [currentEnemies=[]] - 현재 미러 적 배열입니다.
 * @param {object[]} [enemyStates=[]] - 병합할 적 상태 패치 목록입니다.
 * @param {object} [options={}] - 병합 옵션입니다.
 * @param {Map<number, number>} [options.enemyIndexMap] - 재사용할 적 ID 인덱스 맵입니다.
 * @param {Function} [options.createEnemy] - 새 적 상태 생성 함수입니다.
 * @returns {object[]} 병합된 적 배열입니다.
 */
export function mergeShadowEnemyStates(currentEnemies = [], enemyStates = [], options = {}) {
    if (!Array.isArray(enemyStates) || enemyStates.length === 0) {
        return Array.isArray(currentEnemies) ? currentEnemies : [];
    }

    const nextEnemies = Array.isArray(currentEnemies) ? currentEnemies : [];
    const enemyIndexMap = options.enemyIndexMap instanceof Map ? options.enemyIndexMap : new Map();
    const createEnemy = typeof options.createEnemy === 'function' ? options.createEnemy : () => null;
    enemyIndexMap.clear();
    for (let i = 0; i < nextEnemies.length; i++) {
        const enemy = nextEnemies[i];
        if (!enemy || !Number.isInteger(enemy.id)) {
            continue;
        }
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
            : createEnemy(enemyState);
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
 * @param {object} currentProjectile - 현재 미러 투사체입니다.
 * @param {object} projectileState - 병합할 투사체 상태 패치입니다.
 * @returns {object} 병합된 투사체 상태입니다.
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
 * @param {object[]} [currentProjectiles=[]] - 현재 미러 투사체 배열입니다.
 * @param {object[]} [projectileStates=[]] - 병합할 투사체 상태 패치 목록입니다.
 * @param {object} [options={}] - 병합 옵션입니다.
 * @param {Map<number, number>} [options.projectileIndexMap] - 재사용할 투사체 ID 인덱스 맵입니다.
 * @returns {object[]} 병합된 투사체 배열입니다.
 */
export function mergeShadowProjectileStates(
    currentProjectiles = [],
    projectileStates = [],
    options = {}
) {
    if (!Array.isArray(projectileStates) || projectileStates.length === 0) {
        return Array.isArray(currentProjectiles) ? currentProjectiles : [];
    }

    const nextProjectiles = Array.isArray(currentProjectiles) ? currentProjectiles : [];
    const projectileIndexMap = options.projectileIndexMap instanceof Map ? options.projectileIndexMap : new Map();
    projectileIndexMap.clear();
    for (let i = 0; i < nextProjectiles.length; i++) {
        const projectile = nextProjectiles[i];
        if (!projectile || !Number.isInteger(projectile.id)) {
            continue;
        }
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
