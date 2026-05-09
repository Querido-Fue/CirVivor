import { getHexaHiveType } from './enemy/_hexa_hive_layout.js';
import {
    buildActiveHexaMergeCandidatesById,
    buildHexaHiveSpawnData,
    clearHexaHiveContactPairsForEnemyIds,
    collectHexaHiveMergeGroups,
    collectHexaMergeCandidates
} from './enemy/_hexa_hive_merge.js';

const HEXA_HIVE_TYPE = getHexaHiveType();

/**
 * 현재 접촉 중인 육각형/합체 육각형 쌍을 exact 판정으로 수집합니다.
 * @param {object} options - 접촉 쌍 수집 옵션입니다.
 * @param {object[]} options.enemies - 현재 적 목록입니다.
 * @param {object|null|undefined} options.physicsSystem - 충돌 판정 시스템입니다.
 * @param {number} options.delta - 고정 스텝 시간입니다.
 * @returns {{enemyA: object, enemyB: object}[]}
 */
export function collectObjectSystemHexaHiveContactPairs(options) {
    const enemies = Array.isArray(options?.enemies) ? options.enemies : [];
    const physicsSystem = options?.physicsSystem ?? null;
    const delta = Number.isFinite(options?.delta) ? options.delta : 0;
    const mergeCandidates = collectHexaMergeCandidates(enemies);
    if (mergeCandidates.length < 2
        || !physicsSystem
        || typeof physicsSystem.collectEnemyContactPairs !== 'function') {
        return [];
    }

    return physicsSystem.collectEnemyContactPairs(mergeCandidates, { delta });
}

/**
 * 합체 그룹에서 제거할 적 ID와 새 스폰 데이터를 구성합니다.
 * @param {object[][]} mergeGroups - 합체 그룹 목록입니다.
 * @returns {{releaseIds: Set<number>, spawnDataList: object[]}}
 */
function buildObjectSystemHexaHiveMergePlan(mergeGroups) {
    const releaseIds = new Set();
    const spawnDataList = [];
    for (let i = 0; i < mergeGroups.length; i++) {
        const mergeGroup = mergeGroups[i];
        if (!Array.isArray(mergeGroup) || mergeGroup.length < 2) {
            continue;
        }

        const spawnData = buildHexaHiveSpawnData(mergeGroup);
        if (!spawnData) {
            continue;
        }

        spawnDataList.push(spawnData);
        for (let j = 0; j < mergeGroup.length; j++) {
            const enemyId = mergeGroup[j]?.id;
            if (Number.isInteger(enemyId)) {
                releaseIds.add(enemyId);
            }
        }
    }

    return {
        releaseIds,
        spawnDataList
    };
}

/**
 * 제거할 적 ID에 해당하는 인덱스를 뒤에서부터 처리되도록 정렬해 반환합니다.
 * @param {object[]} enemies - 현재 적 목록입니다.
 * @param {Set<number>} releaseIds - 제거 대상 적 ID 집합입니다.
 * @returns {number[]}
 */
function collectObjectSystemHexaHiveReleaseIndices(enemies, releaseIds) {
    const releaseIndices = [];
    if (!Array.isArray(enemies) || !(releaseIds instanceof Set) || releaseIds.size === 0) {
        return releaseIndices;
    }

    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (enemy && releaseIds.has(enemy.id)) {
            releaseIndices.push(i);
        }
    }

    releaseIndices.sort((left, right) => right - left);
    return releaseIndices;
}

/**
 * 누적 접촉 시간을 기준으로 육각형 그룹 합체를 수행합니다.
 * @param {object} options - 합체 처리 옵션입니다.
 * @param {object[]} options.enemies - 현재 적 목록입니다.
 * @param {Map<string, number>} options.contactSecondsByPair - pair key별 접촉 시간 맵입니다.
 * @param {Map<number, object>|null} [options.activeMergeCandidatesById=null] - 활성 합체 후보 맵입니다.
 * @param {(index: number) => void} options.releaseEnemyAt - 적 반납 콜백입니다.
 * @param {(type: string, data: object) => object|null} options.spawnEnemy - 적 생성 콜백입니다.
 * @returns {number}
 */
export function resolveObjectSystemHexaHiveMerges(options) {
    const enemies = Array.isArray(options?.enemies) ? options.enemies : [];
    const contactSecondsByPair = options?.contactSecondsByPair;
    const releaseEnemyAt = typeof options?.releaseEnemyAt === 'function'
        ? options.releaseEnemyAt
        : null;
    const spawnEnemy = typeof options?.spawnEnemy === 'function'
        ? options.spawnEnemy
        : null;
    const mergeGroups = collectHexaHiveMergeGroups(
        contactSecondsByPair,
        options?.activeMergeCandidatesById instanceof Map
            ? options.activeMergeCandidatesById
            : buildActiveHexaMergeCandidatesById(enemies)
    );
    if (mergeGroups.length === 0 || !releaseEnemyAt || !spawnEnemy) {
        return 0;
    }

    const mergePlan = buildObjectSystemHexaHiveMergePlan(mergeGroups);
    if (mergePlan.spawnDataList.length === 0 || mergePlan.releaseIds.size === 0) {
        return 0;
    }

    clearHexaHiveContactPairsForEnemyIds(contactSecondsByPair, mergePlan.releaseIds);

    const releaseIndices = collectObjectSystemHexaHiveReleaseIndices(enemies, mergePlan.releaseIds);
    for (let i = 0; i < releaseIndices.length; i++) {
        releaseEnemyAt(releaseIndices[i]);
    }

    let mergedCount = 0;
    for (let i = 0; i < mergePlan.spawnDataList.length; i++) {
        const hexaHive = spawnEnemy(HEXA_HIVE_TYPE, mergePlan.spawnDataList[i]);
        if (!hexaHive) {
            continue;
        }

        mergedCount++;
    }

    return mergedCount;
}
