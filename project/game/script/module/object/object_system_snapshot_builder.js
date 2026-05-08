/**
 * 적 프레임 스냅샷을 생성합니다.
 * @param {object|null|undefined} enemy - 적 인스턴스입니다.
 * @returns {object|null}
 */
function createEnemyFrameSnapshot(enemy) {
    if (!enemy || enemy.active === false) {
        return null;
    }

    if (typeof enemy.createSimulationFrameSnapshot === 'function') {
        return enemy.createSimulationFrameSnapshot();
    }

    return {
        id: enemy.id ?? null,
        active: enemy.active === true
    };
}

/**
 * 적 전체 시뮬레이션 스냅샷을 생성합니다.
 * @param {object|null|undefined} enemy - 적 인스턴스입니다.
 * @returns {object|null}
 */
function createEnemySimulationSnapshot(enemy) {
    if (!enemy || enemy.active === false) {
        return null;
    }

    if (typeof enemy.createSimulationSnapshot === 'function') {
        return enemy.createSimulationSnapshot();
    }

    return {
        id: enemy.id ?? null,
        active: enemy.active === true,
        type: enemy.type ?? 'none'
    };
}

/**
 * 적 목록을 스냅샷 목록으로 변환합니다.
 * @param {object[]} enemies - 적 인스턴스 목록입니다.
 * @param {Function} snapshotFactory - 적 스냅샷 생성 함수입니다.
 * @returns {object[]}
 */
function createEnemySnapshotList(enemies, snapshotFactory) {
    const snapshots = [];
    if (!Array.isArray(enemies)) {
        return snapshots;
    }

    for (let i = 0; i < enemies.length; i++) {
        const snapshot = snapshotFactory(enemies[i]);
        if (snapshot) {
            snapshots.push(snapshot);
        }
    }
    return snapshots;
}

/**
 * 오브젝트 시스템 프레임 동기화용 적 스냅샷을 생성합니다.
 * @param {{enemyIdCounter: number, enemies: object[]}} options - 스냅샷 생성 옵션입니다.
 * @returns {{enemyIdCounter: number, enemies: object[]}}
 */
export function createObjectSystemSimulationFrameSnapshot(options) {
    return {
        enemyIdCounter: options?.enemyIdCounter,
        enemies: createEnemySnapshotList(options?.enemies, createEnemyFrameSnapshot)
    };
}

/**
 * 오브젝트 시스템 전체 시뮬레이션 스냅샷을 생성합니다.
 * @param {object} options - 스냅샷 생성 옵션입니다.
 * @returns {{showcaseEnabled: boolean, enemyIdCounter: number, aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number, enemies: object[]}}
 */
export function createObjectSystemSimulationSnapshot(options) {
    return {
        showcaseEnabled: options?.showcaseEnabled === true,
        enemyIdCounter: options?.enemyIdCounter,
        aiDecisionGroupCursor: options?.aiDecisionGroupCursor,
        aiDecisionGroupCount: options?.aiDecisionGroupCount,
        aiDecisionIntervalSeconds: options?.aiDecisionIntervalSeconds,
        enemyCullOutsideRatio: options?.enemyCullOutsideRatio,
        enemies: createEnemySnapshotList(options?.enemies, createEnemySimulationSnapshot)
    };
}
