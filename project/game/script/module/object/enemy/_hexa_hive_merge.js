import { enemyAI } from './ai/_enemy_ai.js';
import { getData } from 'data/data_handler.js';
import {
    collectHexaWorldCellsFromEnemy,
    createHexaHiveLayoutFromWorldCells,
    getHexaHiveType,
    getHexaMergeMemberCount,
    isHexaMergeEnemyType,
    snapHexaRotationDegToSymmetry
} from './_hexa_hive_layout.js';
import { getSimulationObjectWH } from 'simulation/simulation_runtime.js';

const ENEMY_CONSTANTS = getData('ENEMY_CONSTANTS');
const ENEMY_DRAW_HEIGHT_RATIO = getData('ENEMY_DRAW_HEIGHT_RATIO');
const HEXA_HIVE_MERGE_CONSTANTS = ENEMY_CONSTANTS.HEXA_HIVE.MERGE;
const ENEMY_ANGLE_CONSTANTS = ENEMY_CONSTANTS.ANGLE;
const HEXA_HIVE_MERGE_CONTACT_SECONDS = HEXA_HIVE_MERGE_CONSTANTS.CONTACT_SECONDS;
const HEXA_HIVE_MAX_MEMBER_COUNT = Number.isInteger(HEXA_HIVE_MERGE_CONSTANTS.MAX_MEMBER_COUNT)
    ? Math.max(2, HEXA_HIVE_MERGE_CONSTANTS.MAX_MEMBER_COUNT)
    : Number.POSITIVE_INFINITY;
const HEXA_HIVE_MERGE_PRESENTATION = HEXA_HIVE_MERGE_CONSTANTS.PRESENTATION ?? Object.freeze({});
const HEXA_HIVE_MERGE_PULL_DISTANCE_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.PULL_DISTANCE_RATIO)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.PULL_DISTANCE_RATIO)
    : 0.18;
const HEXA_HIVE_MERGE_MAX_PULL_HEIGHT_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.MAX_PULL_HEIGHT_RATIO)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.MAX_PULL_HEIGHT_RATIO)
    : 0.32;
const HEXA_HIVE_MERGE_PULL_SAFE_CELL_DISTANCE_RATIO = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.PULL_SAFE_CELL_DISTANCE_RATIO)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.PULL_SAFE_CELL_DISTANCE_RATIO)
    : 0.82;
const HEXA_HIVE_MERGE_MIN_EFFECT_PROGRESS = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.MIN_EFFECT_PROGRESS)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.MIN_EFFECT_PROGRESS)
    : 0.04;
const HEXA_HIVE_MERGE_MAX_EFFECT_COMMANDS = Number.isInteger(HEXA_HIVE_MERGE_PRESENTATION.MAX_EFFECT_COMMANDS)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.MAX_EFFECT_COMMANDS)
    : 24;
const HEXA_HIVE_MERGE_SETTLE_SECONDS = Number.isFinite(HEXA_HIVE_MERGE_PRESENTATION.SETTLE_SECONDS)
    ? Math.max(0, HEXA_HIVE_MERGE_PRESENTATION.SETTLE_SECONDS)
    : 0.18;
const HEXA_HIVE_MOVE_SPEED_DECAY = HEXA_HIVE_MERGE_CONSTANTS.MOVE_SPEED_DECAY;
const HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO = HEXA_HIVE_MERGE_CONSTANTS.MOVE_SPEED_FLOOR_RATIO;
const HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL = HEXA_HIVE_MERGE_CONSTANTS.WEIGHT_SCALE_PER_EXTRA_CELL;
const HEXA_HIVE_MERGE_PENDING_WEIGHT = HEXA_HIVE_MERGE_CONSTANTS.PENDING_WEIGHT;
const HEXA_HIVE_HP_RECOVERY_RATIO = HEXA_HIVE_MERGE_CONSTANTS.HP_RECOVERY_RATIO;
const HEXA_HIVE_EPSILON = HEXA_HIVE_MERGE_CONSTANTS.EPSILON;
const DEGREES_TO_RADIANS = ENEMY_ANGLE_CONSTANTS.DEGREES_TO_RADIANS;
const RADIANS_TO_DEGREES = ENEMY_ANGLE_CONSTANTS.RADIANS_TO_DEGREES;
const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * hexa hive 접촉 시간이 합체 기준에 도달했는지 확인합니다.
 * @param {number} contactSeconds - 누적 접촉 시간입니다.
 * @returns {boolean} 합체 가능한 접촉 시간 여부입니다.
 */
function _isHexaHiveContactReady(contactSeconds) {
    return Number.isFinite(contactSeconds) && contactSeconds >= HEXA_HIVE_MERGE_CONTACT_SECONDS;
}

/**
 * 합체 후보 adjacency 맵에 양방향 연결을 추가합니다.
 * @param {Map<number, Set<number>>} adjacency - 후보 ID별 인접 ID 맵입니다.
 * @param {number} enemyIdA - 첫 번째 적 ID입니다.
 * @param {number} enemyIdB - 두 번째 적 ID입니다.
 * @returns {void}
 */
function _addHexaHiveAdjacencyLink(adjacency, enemyIdA, enemyIdB) {
    if (!adjacency.has(enemyIdA)) adjacency.set(enemyIdA, new Set());
    if (!adjacency.has(enemyIdB)) adjacency.set(enemyIdB, new Set());
    adjacency.get(enemyIdA).add(enemyIdB);
    adjacency.get(enemyIdB).add(enemyIdA);
}

/**
 * 육각형 계열 적이 추가 합체를 받을 수 있는지 확인합니다.
 * @param {object|null|undefined} enemy - 검사 대상 적입니다.
 * @returns {boolean} 추가 합체 가능 여부입니다.
 */
function _canHexaHiveEnemyAcceptMerge(enemy) {
    const memberCount = getHexaMergeMemberCount(enemy);
    return memberCount > 0 && memberCount < HEXA_HIVE_MAX_MEMBER_COUNT;
}

/**
 * 합체 후보 쌍이 최대 구성원 수 안에 들어오는지 확인합니다.
 * @param {object|null|undefined} enemyA - 첫 번째 적입니다.
 * @param {object|null|undefined} enemyB - 두 번째 적입니다.
 * @returns {boolean} 합체 가능 여부입니다.
 */
function _canHexaHiveMergePairFitLimit(enemyA, enemyB) {
    const memberCountA = getHexaMergeMemberCount(enemyA);
    const memberCountB = getHexaMergeMemberCount(enemyB);
    return memberCountA > 0
        && memberCountB > 0
        && memberCountA + memberCountB <= HEXA_HIVE_MAX_MEMBER_COUNT;
}

/**
 * 합체 예열 진행도를 0~1 범위로 반환합니다.
 * @param {number} contactSeconds - 누적 접촉 시간입니다.
 * @returns {number} 정규화된 진행도입니다.
 */
function _getHexaHiveMergeProgress(contactSeconds) {
    if (!Number.isFinite(contactSeconds) || contactSeconds <= 0 || HEXA_HIVE_MERGE_CONTACT_SECONDS <= 0) {
        return 0;
    }

    return Math.min(1, contactSeconds / HEXA_HIVE_MERGE_CONTACT_SECONDS);
}

/**
 * 합체 예열 진행도를 부드러운 보간값으로 변환합니다.
 * @param {number} progress - 0~1 범위 진행도입니다.
 * @returns {number} 보간된 진행도입니다.
 */
function _smoothHexaHiveMergeProgress(progress) {
    const t = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
    return t * t * (3 - (2 * t));
}

/**
 * 적의 표시 전용 합체 오프셋 합계를 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x:number, y:number}} 표시 오프셋입니다.
 */
function _getHexaHivePresentationOffset(enemy) {
    return {
        x: (Number.isFinite(enemy?.mergePullOffset?.x) ? enemy.mergePullOffset.x : 0)
            + (Number.isFinite(enemy?.mergeSettleOffset?.x) ? enemy.mergeSettleOffset.x : 0),
        y: (Number.isFinite(enemy?.mergePullOffset?.y) ? enemy.mergePullOffset.y : 0)
            + (Number.isFinite(enemy?.mergeSettleOffset?.y) ? enemy.mergeSettleOffset.y : 0)
    };
}

/**
 * 적의 마지막 렌더 위치까지 포함한 합체 표시 오프셋을 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {{x:number, y:number}} 렌더 기준 표시 오프셋입니다.
 */
function _getHexaHiveRenderPresentationOffset(enemy) {
    const baseOffset = _getHexaHivePresentationOffset(enemy);
    const renderPosition = enemy?.renderPosition || enemy?.position || { x: 0, y: 0 };
    const position = enemy?.position || renderPosition;

    return {
        x: baseOffset.x
            + ((Number.isFinite(renderPosition.x) ? renderPosition.x : 0)
                - (Number.isFinite(position.x) ? position.x : 0)),
        y: baseOffset.y
            + ((Number.isFinite(renderPosition.y) ? renderPosition.y : 0)
                - (Number.isFinite(position.y) ? position.y : 0))
    };
}

/**
 * 적의 현재 렌더 높이를 안전하게 반환합니다.
 * @param {object|null|undefined} enemy - 대상 적입니다.
 * @returns {number} 렌더 높이입니다.
 */
function _getHexaHiveEnemyRenderHeight(enemy) {
    if (typeof enemy?.getRenderHeightPx === 'function') {
        const height = enemy.getRenderHeightPx();
        if (Number.isFinite(height) && height > HEXA_HIVE_EPSILON) {
            return height;
        }
    }

    return getSimulationObjectWH() * ENEMY_DRAW_HEIGHT_RATIO;
}

/**
 * 적 ID별 합체 예열 오프셋을 누적합니다.
 * @param {Map<number, {x:number, y:number, maxDistance:number}>} pullOffsetById - 오프셋 누적 맵입니다.
 * @param {object} enemy - 대상 적입니다.
 * @param {number} offsetX - X축 추가 오프셋입니다.
 * @param {number} offsetY - Y축 추가 오프셋입니다.
 * @param {number} maxDistance - 적별 최대 오프셋 거리입니다.
 */
function _addHexaHivePullOffset(pullOffsetById, enemy, offsetX, offsetY, maxDistance) {
    if (!Number.isInteger(enemy?.id)) {
        return;
    }

    const current = pullOffsetById.get(enemy.id) || {
        x: 0,
        y: 0,
        maxDistance: Number.POSITIVE_INFINITY
    };
    current.x += Number.isFinite(offsetX) ? offsetX : 0;
    current.y += Number.isFinite(offsetY) ? offsetY : 0;
    current.maxDistance = Math.min(current.maxDistance, Number.isFinite(maxDistance) ? maxDistance : 0);
    pullOffsetById.set(enemy.id, current);
}

/**
 * 누적된 합체 예열 오프셋을 적 인스턴스에 반영합니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @param {Map<number, {x:number, y:number, maxDistance:number}>} pullOffsetById - 오프셋 누적 맵입니다.
 */
function _applyHexaHivePullOffsets(activeMergeCandidatesById, pullOffsetById) {
    for (const [enemyId, pullOffset] of pullOffsetById.entries()) {
        const enemy = activeMergeCandidatesById.get(enemyId);
        if (!enemy) {
            continue;
        }

        let offsetX = Number.isFinite(pullOffset.x) ? pullOffset.x : 0;
        let offsetY = Number.isFinite(pullOffset.y) ? pullOffset.y : 0;
        const distance = Math.hypot(offsetX, offsetY);
        const maxDistance = Number.isFinite(pullOffset.maxDistance) ? Math.max(0, pullOffset.maxDistance) : 0;
        if (distance > maxDistance && distance > HEXA_HIVE_EPSILON && maxDistance > 0) {
            const scale = maxDistance / distance;
            offsetX *= scale;
            offsetY *= scale;
        }

        if (typeof enemy.setMergePullOffset === 'function') {
            enemy.setMergePullOffset(offsetX, offsetY);
        }
    }
}

/**
 * 합체 그룹의 총 구성원 수를 반환합니다.
 * @param {object[]} mergeGroup - 합체 후보 그룹입니다.
 * @returns {number} 총 구성원 수입니다.
 */
function _getHexaHiveMergeGroupMemberCount(mergeGroup) {
    if (!Array.isArray(mergeGroup)) {
        return 0;
    }

    let memberCount = 0;
    for (let i = 0; i < mergeGroup.length; i++) {
        memberCount += getHexaMergeMemberCount(mergeGroup[i]);
    }
    return memberCount;
}

/**
 * 인접 후보 ID를 작은 구성원 수 우선으로 정렬해 반환합니다.
 * @param {Set<number>|null|undefined} neighbors - 인접 후보 ID 집합입니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @returns {number[]} 정렬된 후보 ID 목록입니다.
 */
function _getSortedHexaHiveNeighborIds(neighbors, activeMergeCandidatesById) {
    if (!(neighbors instanceof Set) || neighbors.size === 0) {
        return [];
    }

    return [...neighbors].sort((leftId, rightId) => {
        const leftCount = getHexaMergeMemberCount(activeMergeCandidatesById.get(leftId));
        const rightCount = getHexaMergeMemberCount(activeMergeCandidatesById.get(rightId));
        return (leftCount - rightCount) || (leftId - rightId);
    });
}

/**
 * adjacency 맵에서 시작 ID와 연결된 합체 후보 그룹을 수집합니다.
 * @param {number} startEnemyId - 시작 적 ID입니다.
 * @param {Map<number, Set<number>>} adjacency - 후보 ID별 인접 ID 맵입니다.
 * @param {Map<number, object>} activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @param {Set<number>} visited - 이미 방문한 후보 ID 집합입니다.
 * @returns {object[]} 연결된 합체 후보 그룹입니다.
 */
function _collectHexaHiveConnectedGroup(startEnemyId, adjacency, activeMergeCandidatesById, visited) {
    const startEnemy = activeMergeCandidatesById.get(startEnemyId);
    const startMemberCount = getHexaMergeMemberCount(startEnemy);
    if (!startEnemy || startMemberCount <= 0 || startMemberCount > HEXA_HIVE_MAX_MEMBER_COUNT) {
        visited.add(startEnemyId);
        return [];
    }

    const queue = [startEnemyId];
    const mergeGroup = [startEnemy];
    let memberCount = startMemberCount;
    visited.add(startEnemyId);

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const currentId = queue[queueIndex];
        const neighborIds = _getSortedHexaHiveNeighborIds(
            adjacency.get(currentId),
            activeMergeCandidatesById
        );
        if (neighborIds.length === 0) {
            continue;
        }

        for (let i = 0; i < neighborIds.length; i++) {
            const neighborId = neighborIds[i];
            if (visited.has(neighborId)) {
                continue;
            }
            const neighborEnemy = activeMergeCandidatesById.get(neighborId);
            const neighborMemberCount = getHexaMergeMemberCount(neighborEnemy);
            if (!neighborEnemy
                || neighborMemberCount <= 0
                || memberCount + neighborMemberCount > HEXA_HIVE_MAX_MEMBER_COUNT) {
                continue;
            }

            visited.add(neighborId);
            queue.push(neighborId);
            mergeGroup.push(neighborEnemy);
            memberCount += neighborMemberCount;
        }
    }

    return mergeGroup;
}

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
        if (!_canHexaHiveEnemyAcceptMerge(enemy)) {
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
 * 합체 예열 중인 후보들의 표시 오프셋과 WebGL 이펙트 페어를 동기화합니다.
 * @param {object} options - 동기화 옵션입니다.
 * @param {Map<number, object>} options.activeMergeCandidatesById - 활성 합체 후보 맵입니다.
 * @param {Map<string, number>} options.contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @returns {{enemyA: object, enemyB: object, progress: number}[]} 합체 경계 이펙트 페어입니다.
 */
export function syncHexaHiveMergePresentationState({
    activeMergeCandidatesById,
    contactSecondsByPair
}) {
    const effectPairs = [];
    if (!(activeMergeCandidatesById instanceof Map)) {
        return effectPairs;
    }

    for (const enemy of activeMergeCandidatesById.values()) {
        if (typeof enemy?.clearMergePullOffset === 'function') {
            enemy.clearMergePullOffset();
        }
    }

    if (!(contactSecondsByPair instanceof Map) || contactSecondsByPair.size === 0) {
        return effectPairs;
    }

    const pullOffsetById = new Map();
    for (const [pairKey, contactSeconds] of contactSecondsByPair.entries()) {
        const progress = _getHexaHiveMergeProgress(contactSeconds);
        if (progress <= 0) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseHexaHivePairKey(pairKey);
        const enemyA = activeMergeCandidatesById.get(enemyIdA);
        const enemyB = activeMergeCandidatesById.get(enemyIdB);
        if (!enemyA || !enemyB || !_canHexaHiveMergePairFitLimit(enemyA, enemyB)) {
            continue;
        }

        const dx = (Number.isFinite(enemyB.position?.x) ? enemyB.position.x : 0)
            - (Number.isFinite(enemyA.position?.x) ? enemyA.position.x : 0);
        const dy = (Number.isFinite(enemyB.position?.y) ? enemyB.position.y : 0)
            - (Number.isFinite(enemyA.position?.y) ? enemyA.position.y : 0);
        const distance = Math.hypot(dx, dy);
        if (distance <= HEXA_HIVE_EPSILON) {
            continue;
        }

        const dirX = dx / distance;
        const dirY = dy / distance;
        const baseHeight = Math.min(
            _getHexaHiveEnemyRenderHeight(enemyA),
            _getHexaHiveEnemyRenderHeight(enemyB)
        );
        const maxPullDistance = baseHeight * HEXA_HIVE_MERGE_MAX_PULL_HEIGHT_RATIO;
        const safeCellDistance = baseHeight * HEXA_HIVE_MERGE_PULL_SAFE_CELL_DISTANCE_RATIO;
        const noOverlapPairPullDistance = Math.max(0, (distance - safeCellDistance) * 0.5);
        const pullDistance = Math.min(
            distance * HEXA_HIVE_MERGE_PULL_DISTANCE_RATIO,
            maxPullDistance,
            noOverlapPairPullDistance
        ) * _smoothHexaHiveMergeProgress(progress);

        const pairMaxPullDistance = Math.min(maxPullDistance, noOverlapPairPullDistance);

        _addHexaHivePullOffset(pullOffsetById, enemyA, dirX * pullDistance, dirY * pullDistance, pairMaxPullDistance);
        _addHexaHivePullOffset(pullOffsetById, enemyB, -dirX * pullDistance, -dirY * pullDistance, pairMaxPullDistance);

        if (progress >= HEXA_HIVE_MERGE_MIN_EFFECT_PROGRESS
            && effectPairs.length < HEXA_HIVE_MERGE_MAX_EFFECT_COMMANDS) {
            effectPairs.push({ enemyA, enemyB, progress });
        }
    }

    _applyHexaHivePullOffsets(activeMergeCandidatesById, pullOffsetById);
    return effectPairs;
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
        if (!enemy
            || enemy.active === false
            || !isHexaMergeEnemyType(enemy.type)
            || !Number.isInteger(enemy.id)
            || !_canHexaHiveEnemyAcceptMerge(enemy)) {
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
        if (!_isHexaHiveContactReady(contactSeconds)) {
            continue;
        }

        const [enemyIdA, enemyIdB] = _parseHexaHivePairKey(pairKey);
        const enemyA = activeMergeCandidatesById.get(enemyIdA);
        const enemyB = activeMergeCandidatesById.get(enemyIdB);
        if (!enemyA || !enemyB || !_canHexaHiveMergePairFitLimit(enemyA, enemyB)) {
            continue;
        }

        _addHexaHiveAdjacencyLink(adjacency, enemyIdA, enemyIdB);
    }

    const visited = new Set();
    const mergeGroups = [];
    for (const [enemyId, enemy] of activeMergeCandidatesById.entries()) {
        if (visited.has(enemyId) || !adjacency.has(enemyId)) {
            continue;
        }

        const mergeGroup = _collectHexaHiveConnectedGroup(
            enemyId,
            adjacency,
            activeMergeCandidatesById,
            visited
        );

        if (mergeGroup.length >= 2
            && _getHexaHiveMergeGroupMemberCount(mergeGroup) <= HEXA_HIVE_MAX_MEMBER_COUNT) {
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
    if (!Array.isArray(mergeGroup)
        || mergeGroup.length < 2
        || _getHexaHiveMergeGroupMemberCount(mergeGroup) > HEXA_HIVE_MAX_MEMBER_COUNT) {
        return null;
    }

    const worldCells = [];
    let totalMass = 0;
    let weightedCenterX = 0;
    let weightedCenterY = 0;
    let weightedPresentationCenterX = 0;
    let weightedPresentationCenterY = 0;
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
        const presentationOffset = _getHexaHiveRenderPresentationOffset(enemy);
        const baseMoveSpeed = _getHexaHiveBaseMoveSpeed(enemy);
        const currentMoveSpeed = Number.isFinite(enemy.moveSpeed) ? enemy.moveSpeed : baseMoveSpeed;
        const accSpeed = Number.isFinite(enemy.accSpeed) ? enemy.accSpeed : 0;
        const size = Number.isFinite(enemy.size) ? enemy.size : 1;
        const baseHeight = typeof enemy.getRenderHeightPx === 'function'
            ? enemy.getRenderHeightPx()
            : (getSimulationObjectWH() * ENEMY_DRAW_HEIGHT_RATIO * size);
        const rotationRadians = (Number.isFinite(enemy.rotation) ? enemy.rotation : 0) * DEGREES_TO_RADIANS;

        for (let j = 0; j < enemyCells.length; j++) {
            worldCells.push(enemyCells[j]);
            totalMass += cellMass;
            weightedCenterX += enemyCells[j].x * cellMass;
            weightedCenterY += enemyCells[j].y * cellMass;
            weightedPresentationCenterX += (enemyCells[j].x + presentationOffset.x) * cellMass;
            weightedPresentationCenterY += (enemyCells[j].y + presentationOffset.y) * cellMass;
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
    const presentationCenterX = weightedPresentationCenterX / totalMass;
    const presentationCenterY = weightedPresentationCenterY / totalMass;
    const mergeSettleOffsetX = presentationCenterX - centerX;
    const mergeSettleOffsetY = presentationCenterY - centerY;
    const shouldSettleMergeOffset = HEXA_HIVE_MERGE_SETTLE_SECONDS > 0
        && Math.hypot(mergeSettleOffsetX, mergeSettleOffsetY) > HEXA_HIVE_EPSILON;
    const baseHeight = weightedBaseHeight / totalCells;
    const mergedRotation = snapHexaRotationDegToSymmetry(
        Math.atan2(weightedRotationSin, weightedRotationCos) * RADIANS_TO_DEGREES
    );
    const mergedBaseMoveSpeed = weightedBaseMoveSpeed / totalCells;
    const mergedCurrentMoveSpeed = weightedCurrentMoveSpeed / totalCells;
    const mergedMoveSpeed = Math.max(
        mergedBaseMoveSpeed * HEXA_HIVE_MOVE_SPEED_FLOOR_RATIO,
        mergedCurrentMoveSpeed * HEXA_HIVE_MOVE_SPEED_DECAY
    );
    const mergedWeight = totalWeight * (1 + ((Math.max(1, totalCells) - 1) * HEXA_HIVE_WEIGHT_SCALE_PER_EXTRA_CELL));
    const mergedMaxHp = totalMaxHp;
    const mergedHp = Math.min(mergedMaxHp, totalHp + (mergedMaxHp * HEXA_HIVE_HP_RECOVERY_RATIO));
    const safeTotalWeight = Math.max(HEXA_HIVE_EPSILON, totalWeight);
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
            x: weightedSpeedX / safeTotalWeight,
            y: weightedSpeedY / safeTotalWeight
        },
        acc: { x: 0, y: 0 },
        ai: enemyAI,
        fill: preferredFill,
        alpha: alphaWeight > 0 ? (weightedAlpha / alphaWeight) : 1,
        rotation: mergedRotation,
        angularVelocity: weightedAngularVelocity / safeTotalWeight,
        angularDeceleration: Math.abs(weightedAngularVelocity / safeTotalWeight),
        mergeSettleOffset: shouldSettleMergeOffset
            ? { x: mergeSettleOffsetX, y: mergeSettleOffsetY }
            : null,
        mergeSettleDurationSeconds: shouldSettleMergeOffset ? HEXA_HIVE_MERGE_SETTLE_SECONDS : 0,
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
            if (!_canHexaHiveMergePairFitLimit(enemyA, enemyB)) {
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
        const enemyA = activeMergeCandidatesById.get(enemyIdA);
        const enemyB = activeMergeCandidatesById.get(enemyIdB);
        if (!enemyA || !enemyB || !_canHexaHiveMergePairFitLimit(enemyA, enemyB)) {
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
