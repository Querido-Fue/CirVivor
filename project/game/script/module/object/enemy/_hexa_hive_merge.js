import { enemyAI } from './ai/_enemy_ai.js';
import {
    collectHexaWorldCellsFromEnemy,
    createHexaHiveLayoutFromWorldCells,
    getHexaHiveType,
    isHexaMergeEnemyType,
    snapHexaRotationDegToSymmetry
} from './_hexa_hive_layout.js';
import { getSimulationObjectWH } from 'simulation/simulation_runtime.js';

const HEXA_HIVE_MERGE_CONTACT_SECONDS = 0.5;
const HEXA_HIVE_MOVE_SPEED_DECAY = 0.95;
const HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO = 0.5;
const HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL = 0.5;
const HEXA_HIVE_MERGE_PENDING_WEIGHT = 100000;
const HEXA_HIVE_EPSILON = 1e-6;
const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * 현재 적 목록에서 육각형 합체 후보만 수집합니다.
 * @param {object[]} enemies - 검사 대상 적 목록입니다.
 * @returns {object[]} 육각형 합체 후보 목록입니다.
 */
export function collectHexaMergeCandidates(enemies) {
    const mergeCandidates = [];
    if (!Array.isArray(enemies)) {
        return mergeCandidates;
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false || !isHexaMergeEnemyType(enemy.type)) {
            continue;
        }

        mergeCandidates.push(enemy);
    }
    return mergeCandidates;
}

/**
 * 특정 적 ID와 연결된 합체 접촉 타이머를 제거합니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {Set<number>} enemyIds - 제거 대상 적 ID 집합입니다.
 * @returns {void}
 */
export function clearHexaHiveContactPairsForEnemyIds(contactSecondsByPair, enemyIds) {
    if (!(contactSecondsByPair instanceof Map) || !(enemyIds instanceof Set) || enemyIds.size === 0) {
        return;
    }

    for (const pairKey of contactSecondsByPair.keys()) {
        const [enemyIdA, enemyIdB] = _parseHexaHivePairKey(pairKey);
        if (enemyIds.has(enemyIdA) || enemyIds.has(enemyIdB)) {
            contactSecondsByPair.delete(pairKey);
        }
    }
}

/**
 * 합체 후보 접촉 타이머와 merge pending 상태를 현재 접촉 쌍 기준으로 동기화합니다.
 * @param {object} options - 동기화 옵션입니다.
 * @param {object[]} options.enemies - 현재 활성 적 목록입니다.
 * @param {Map<string, number>} options.contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {number} options.delta - 고정 틱 델타입니다.
 * @param {{enemyA: object, enemyB: object}[]} options.contactPairs - 현재 접촉 쌍입니다.
 * @returns {Map<number, object>} 활성 합체 후보 맵입니다.
 */
export function syncHexaHiveMergeState({
    enemies,
    contactSecondsByPair,
    delta,
    contactPairs
}) {
    const activeMergeCandidatesById = buildActiveHexaMergeCandidatesById(enemies);
    _updateHexaHiveContactTimers(activeMergeCandidatesById, contactSecondsByPair, delta, contactPairs);
    _applyHexaHiveMergePendingState(activeMergeCandidatesById, contactSecondsByPair);
    return activeMergeCandidatesById;
}

/**
 * 현재 활성 합체 후보를 ID 맵으로 구성합니다.
 * @param {object[]} enemies - 현재 적 목록입니다.
 * @returns {Map<number, object>} 활성 합체 후보 맵입니다.
 */
export function buildActiveHexaMergeCandidatesById(enemies) {
    const activeMergeCandidatesById = new Map();
    if (!Array.isArray(enemies)) {
        return activeMergeCandidatesById;
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false || !isHexaMergeEnemyType(enemy.type) || !Number.isInteger(enemy.id)) {
            continue;
        }

        activeMergeCandidatesById.set(enemy.id, enemy);
    }

    return activeMergeCandidatesById;
}

/**
 * 접촉 시간이 기준 이상 누적된 합체 후보들을 연결 그룹으로 묶습니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @returns {object[][]} 합체 그룹 목록입니다.
 */
export function collectHexaHiveMergeGroups(contactSecondsByPair, activeMergeCandidatesById) {
    if (!(contactSecondsByPair instanceof Map)
        || !(activeMergeCandidatesById instanceof Map)
        || activeMergeCandidatesById.size === 0) {
        return [];
    }

    const adjacency = new Map();
    for (const [pairKey, contactSeconds] of contactSecondsByPair.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds < HEXA_HIVE_MERGE_CONTACT_SECONDS) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseHexaHivePairKey(pairKey);
        if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
            continue;
        }

        if (!adjacency.has(enemyIdA)) adjacency.set(enemyIdA, new Set());
        if (!adjacency.has(enemyIdB)) adjacency.set(enemyIdB, new Set());
        adjacency.get(enemyIdA).add(enemyIdB);
        adjacency.get(enemyIdB).add(enemyIdA);
    }

    const visited = new Set();
    const mergeGroups = [];
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
 * 합체 그룹을 새 hexa hive 적 스폰 데이터로 변환합니다.
 * @param {object[]} mergeGroup - 합체 대상 적 그룹입니다.
 * @returns {object|null} hexa hive 스폰 데이터입니다.
 */
export function buildHexaHiveSpawnData(mergeGroup) {
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
        const enemyCells = collectHexaWorldCellsFromEnemy(enemy);
        if (enemyCells.length === 0) {
            continue;
        }

        const enemyWeight = Math.max(HEXA_HIVE_EPSILON, Number.isFinite(enemy.weight) ? enemy.weight : 1);
        const cellMass = enemyWeight / enemyCells.length;
        const baseMoveSpeed = _getHexaHiveBaseMoveSpeed(enemy);
        const currentMoveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : baseMoveSpeed;
        const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
        const size = Number.isFinite(enemy.size) ? enemy.size : 1;
        const baseHeight = typeof enemy.getRenderHeightPx === 'function'
            ? enemy.getRenderHeightPx()
            : (getSimulationObjectWH() * 0.03 * size);
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
        totalProjectileHitsToKill += Number.isFinite(enemy.projectileHitsToKill) ? enemy.projectileHitsToKill : 0;
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

    if (worldCells.length === 0 || totalMass <= HEXA_HIVE_EPSILON || totalCells <= 0) {
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
        mergedBaseMoveSpeed * HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO,
        mergedCurrentMoveSpeed * HEXA_HIVE_MOVE_SPEED_DECAY
    );
    const mergedWeight = totalWeight * (1 + ((Math.max(1, totalCells) - 1) * HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL));
    const mergedMaxHp = totalMaxHp;
    const mergedHp = Math.min(mergedMaxHp, totalHp + (mergedMaxHp * 0.1));
    const mergedLayout = createHexaHiveLayoutFromWorldCells(worldCells, {
        originX: centerX,
        originY: centerY,
        baseHeight,
        rotationDeg: mergedRotation
    });

    return {
        type: HEXA_HIVE_TYPE,
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
            x: weightedSpeedX / Math.max(HEXA_HIVE_EPSILON, totalWeight),
            y: weightedSpeedY / Math.max(HEXA_HIVE_EPSILON, totalWeight)
        },
        acc: { x: 0, y: 0 },
        ai: enemyAI,
        fill: preferredFill,
        alpha: alphaWeight > 0 ? (weightedAlpha / alphaWeight) : 1,
        rotation: mergedRotation,
        angularVelocity: weightedAngularVelocity / Math.max(HEXA_HIVE_EPSILON, totalWeight),
        angularDeceleration: Math.abs(weightedAngularVelocity / Math.max(HEXA_HIVE_EPSILON, totalWeight)),
        hexaHiveLayout: mergedLayout
    };
}

/**
 * 합체 후보의 기준 이동 속도를 반환합니다.
 * @param {object} enemy - 검사 대상 적입니다.
 * @returns {number} 기준 이동 속도입니다.
 */
function _getHexaHiveBaseMoveSpeed(enemy) {
    if (Number.isFinite(enemy?.mergeBaseMoveSpeed) && enemy.mergeBaseMoveSpeed > 0) {
        return enemy.mergeBaseMoveSpeed;
    }
    if (Number.isFinite(enemy?.moveSpeed) && enemy.moveSpeed > 0) {
        return enemy.moveSpeed;
    }
    return 0;
}

/**
 * hexa hive 합체 후보 pair key를 생성합니다.
 * @param {number} enemyIdA - 첫 번째 적 ID입니다.
 * @param {number} enemyIdB - 두 번째 적 ID입니다.
 * @returns {string} 정렬된 pair key입니다.
 */
function _buildHexaHivePairKey(enemyIdA, enemyIdB) {
    const firstId = enemyIdA < enemyIdB ? enemyIdA : enemyIdB;
    const secondId = enemyIdA < enemyIdB ? enemyIdB : enemyIdA;
    return `${firstId}:${secondId}`;
}

/**
 * hexa hive 합체 후보 pair key를 적 ID 배열로 분해합니다.
 * @param {string} pairKey - pair key입니다.
 * @returns {number[]} 적 ID 쌍입니다.
 */
function _parseHexaHivePairKey(pairKey) {
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
 * 현재 접촉 쌍 기준으로 hexa hive 접촉 타이머를 갱신합니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {number} delta - 고정 틱 델타입니다.
 * @param {{enemyA: object, enemyB: object}[]} contactPairs - 현재 접촉 쌍입니다.
 * @returns {void}
 */
function _updateHexaHiveContactTimers(activeMergeCandidatesById, contactSecondsByPair, delta, contactPairs) {
    const activePairKeys = new Set();
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

            const pairKey = _buildHexaHivePairKey(enemyA.id, enemyB.id);
            activePairKeys.add(pairKey);
            contactSecondsByPair.set(
                pairKey,
                (contactSecondsByPair.get(pairKey) || 0) + delta
            );
        }
    }

    for (const pairKey of [...contactSecondsByPair.keys()]) {
        if (!activePairKeys.has(pairKey)) {
            contactSecondsByPair.delete(pairKey);
        }
    }
}

/**
 * 접촉 중인 hexa hive 후보에 merge pending 상태를 반영합니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @returns {void}
 */
function _applyHexaHiveMergePendingState(activeMergeCandidatesById, contactSecondsByPair) {
    const pendingEnemyIds = new Set();
    for (const [pairKey, contactSeconds] of contactSecondsByPair.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds <= 0) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseHexaHivePairKey(pairKey);
        if (!activeMergeCandidatesById.has(enemyIdA) || !activeMergeCandidatesById.has(enemyIdB)) {
            continue;
        }

        pendingEnemyIds.add(enemyIdA);
        pendingEnemyIds.add(enemyIdB);
    }

    for (const enemy of activeMergeCandidatesById.values()) {
        enemy.hexaHiveMergePending = pendingEnemyIds.has(enemy.id);
        enemy.hexaHiveMergePendingWeight = enemy.hexaHiveMergePending
            ? HEXA_HIVE_MERGE_PENDING_WEIGHT
            : null;
    }
}
