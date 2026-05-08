import { ENEMY_DRAW_HEIGHT_RATIO } from '../../data/object/enemy/enemy_shape_data.js';
import {
    createHexaHiveLayoutFromWorldCells,
    getHexaHiveType,
    isHexaMergeEnemyType,
    snapHexaRotationDegToSymmetry
} from '../object/enemy/_hexa_hive_layout.js';
import { getSimulationObjectWH } from './simulation_runtime.js';

const SHADOW_HEXA_HIVE_TYPE = getHexaHiveType();
const SHADOW_HEXA_HIVE_MERGE_CONTACT_SECONDS = 0.5;
const SHADOW_HEXA_HIVE_MOVE_SPEED_DECAY = 0.95;
const SHADOW_HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO = 0.5;
const SHADOW_HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL = 0.5;
const SHADOW_HEXA_HIVE_MERGE_PENDING_WEIGHT = 100000;
const SHADOW_HEXA_HIVE_EPSILON = 1e-6;

/**
 * 지정한 적 ID와 연결된 접촉 타이머를 제거합니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {Set<number>} enemyIds - 제거할 적 ID 집합입니다.
 * @returns {void}
 */
export function clearShadowHexaHiveContactPairsForEnemyIds(contactSecondsByPair, enemyIds) {
    if (!(contactSecondsByPair instanceof Map) || !(enemyIds instanceof Set) || enemyIds.size === 0) {
        return;
    }

    for (const pairKey of contactSecondsByPair.keys()) {
        const [enemyIdA, enemyIdB] = _parseShadowHexaHivePairKey(pairKey);
        if (enemyIds.has(enemyIdA) || enemyIds.has(enemyIdB)) {
            contactSecondsByPair.delete(pairKey);
        }
    }
}

/**
 * 권한 모드에서 현재 활성 육각 합체 후보 맵을 생성합니다.
 * @param {object[]} enemies - 현재 적 목록입니다.
 * @returns {Map<number, object>} 활성 육각 합체 후보 맵입니다.
 */
export function buildAuthorityShadowHexaMergeCandidatesById(enemies) {
    const activeMergeCandidatesById = new Map();
    if (!Array.isArray(enemies)) {
        return activeMergeCandidatesById;
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (!enemy || enemy.active === false || !Number.isInteger(enemy.id) || !isHexaMergeEnemyType(enemy.type)) {
            continue;
        }

        activeMergeCandidatesById.set(enemy.id, enemy);
    }

    return activeMergeCandidatesById;
}

/**
 * 권한 모드에서 합체 접촉 상태를 한 번에 동기화합니다.
 * @param {object} options - 동기화 옵션입니다.
 * @param {object[]} options.enemies - 현재 적 목록입니다.
 * @param {Map<string, number>} options.contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {number} options.delta - 고정 틱 델타입니다.
 * @param {{enemyA: object, enemyB: object}[]} options.contactPairs - 현재 접촉 쌍입니다.
 * @returns {Map<number, object>} 활성 육각 합체 후보 맵입니다.
 */
export function syncAuthorityShadowHexaHiveMergeState({
    enemies,
    contactSecondsByPair,
    delta,
    contactPairs
}) {
    const activeMergeCandidatesById = buildAuthorityShadowHexaMergeCandidatesById(enemies);
    _updateAuthorityShadowHexaHiveContactTimers(
        activeMergeCandidatesById,
        contactSecondsByPair,
        delta,
        contactPairs
    );
    _applyAuthorityShadowHexaHivePendingState(activeMergeCandidatesById, contactSecondsByPair);
    return activeMergeCandidatesById;
}

/**
 * 권한 모드에서 접촉 시간 기준 육각 합체 그룹을 수집합니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 육각 합체 후보 맵입니다.
 * @returns {object[][]} 합체 그룹 목록입니다.
 */
export function collectAuthorityShadowHexaHiveMergeGroups(contactSecondsByPair, activeMergeCandidatesById) {
    if (!(contactSecondsByPair instanceof Map)
        || !(activeMergeCandidatesById instanceof Map)
        || activeMergeCandidatesById.size === 0) {
        return [];
    }

    const adjacency = new Map();
    for (const [pairKey, contactSeconds] of contactSecondsByPair.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds < SHADOW_HEXA_HIVE_MERGE_CONTACT_SECONDS) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseShadowHexaHivePairKey(pairKey);
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
 * @param {object[]} mergeGroup - 합체 대상 적 그룹입니다.
 * @returns {object|null} 그림자 합체 적 스폰 데이터입니다.
 */
export function buildAuthorityShadowHexaHiveSpawnData(mergeGroup) {
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
        const enemyCells = _collectShadowHexaWorldCellsFromEnemy(enemy);
        if (enemyCells.length === 0) {
            continue;
        }

        const enemyWeight = Math.max(
            SHADOW_HEXA_HIVE_EPSILON,
            Number.isFinite(enemy.weight) ? enemy.weight : 1
        );
        const cellMass = enemyWeight / enemyCells.length;
        const baseMoveSpeed = _getShadowHexaHiveBaseMoveSpeed(enemy);
        const currentMoveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : baseMoveSpeed;
        const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
        const size = Number.isFinite(enemy.size) ? enemy.size : 1;
        const baseHeight = _getShadowEnemyRenderHeight(enemy);
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
 * 합체 적의 기준 이동 속도를 반환합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {number} 기준 이동 속도입니다.
 */
function _getShadowHexaHiveBaseMoveSpeed(enemy) {
    if (Number.isFinite(enemy?.mergeBaseMoveSpeed) && enemy.mergeBaseMoveSpeed > 0) {
        return enemy.mergeBaseMoveSpeed;
    }
    if (Number.isFinite(enemy?.moveSpeed) && enemy.moveSpeed > 0) {
        return enemy.moveSpeed;
    }
    return 0;
}

/**
 * 적 렌더 높이를 계산합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {number} 렌더 높이입니다.
 */
function _getShadowEnemyRenderHeight(enemy) {
    const objectWH = getSimulationObjectWH();
    const size = Number.isFinite(enemy?.size) ? enemy.size : 1;
    return objectWH * ENEMY_DRAW_HEIGHT_RATIO * size;
}

/**
 * 육각 합체 접촉 쌍 키를 생성합니다.
 * @param {number} enemyIdA - 첫 번째 적 ID입니다.
 * @param {number} enemyIdB - 두 번째 적 ID입니다.
 * @returns {string} 정렬된 pair key입니다.
 */
function _buildShadowHexaHivePairKey(enemyIdA, enemyIdB) {
    const firstId = enemyIdA < enemyIdB ? enemyIdA : enemyIdB;
    const secondId = enemyIdA < enemyIdB ? enemyIdB : enemyIdA;
    return `${firstId}:${secondId}`;
}

/**
 * 육각 합체 접촉 쌍 키를 파싱합니다.
 * @param {string} pairKey - pair key입니다.
 * @returns {number[]} 적 ID 쌍입니다.
 */
function _parseShadowHexaHivePairKey(pairKey) {
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
 * 그림자 적 상태에서 현재 보이는 육각 조각의 월드 중심을 수집합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {{x: number, y: number}[]} 월드 셀 중심 목록입니다.
 */
function _collectShadowHexaWorldCellsFromEnemy(enemy) {
    if (!enemy || typeof enemy !== 'object' || enemy.active === false || !isHexaMergeEnemyType(enemy.type)) {
        return [];
    }

    const positionX = Number.isFinite(enemy.position?.x) ? enemy.position.x : 0;
    const positionY = Number.isFinite(enemy.position?.y) ? enemy.position.y : 0;
    if (enemy.type !== SHADOW_HEXA_HIVE_TYPE || !Array.isArray(enemy.hexaHiveLayout?.visibleLocalCenters)) {
        return [{ x: positionX, y: positionY }];
    }

    const baseHeight = _getShadowEnemyRenderHeight(enemy);
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
 * 권한 모드에서 육각 합체 접촉 타이머를 갱신합니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 육각 합체 후보 맵입니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {number} delta - 고정 틱 델타입니다.
 * @param {{enemyA: object, enemyB: object}[]} contactPairs - 현재 접촉 쌍입니다.
 * @returns {void}
 */
function _updateAuthorityShadowHexaHiveContactTimers(
    activeMergeCandidatesById,
    contactSecondsByPair,
    delta,
    contactPairs
) {
    if (!(contactSecondsByPair instanceof Map)) {
        return;
    }

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

            const pairKey = _buildShadowHexaHivePairKey(enemyA.id, enemyB.id);
            activePairKeys.add(pairKey);
            contactSecondsByPair.set(pairKey, (contactSecondsByPair.get(pairKey) || 0) + delta);
        }
    }

    for (const pairKey of [...contactSecondsByPair.keys()]) {
        if (!activePairKeys.has(pairKey)) {
            contactSecondsByPair.delete(pairKey);
        }
    }
}

/**
 * 권한 모드에서 합체 대기 중인 육각형의 임시 고중량 상태를 동기화합니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 육각 합체 후보 맵입니다.
 * @param {Map<string, number>} contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @returns {void}
 */
function _applyAuthorityShadowHexaHivePendingState(activeMergeCandidatesById, contactSecondsByPair) {
    if (!(contactSecondsByPair instanceof Map)) {
        return;
    }

    const pendingEnemyIds = new Set();
    for (const [pairKey, contactSeconds] of contactSecondsByPair.entries()) {
        if (!Number.isFinite(contactSeconds) || contactSeconds <= 0) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseShadowHexaHivePairKey(pairKey);
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
