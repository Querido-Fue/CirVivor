import {
    cloneSnapshotPoint,
    createCollisionStatsSnapshot,
    normalizeSnapshotNumber
} from '../game_scene_snapshot_utils.js';

/**
 * 뷰포트 스냅샷을 생성합니다.
 * @param {{ww?: number, wh?: number, objectWH?: number, objectOffsetY?: number}} [viewport={}] - 뷰포트 원본 값입니다.
 * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number}}
 */
function createViewportSnapshot(viewport = {}) {
    return {
        ww: viewport?.ww,
        wh: viewport?.wh,
        objectWH: viewport?.objectWH,
        objectOffsetY: viewport?.objectOffsetY
    };
}

/**
 * 일반 스냅샷 카운터 값을 생성합니다.
 * @param {object|null|undefined} objectSystemSnapshot - 오브젝트 시스템 스냅샷입니다.
 * @param {number} wallIdCounter - 다음 벽 ID입니다.
 * @param {number} projIdCounter - 다음 투사체 ID입니다.
 * @returns {{enemyIdCounter: number, wallIdCounter: number, projIdCounter: number}}
 */
function createSimulationCountersSnapshot(objectSystemSnapshot, wallIdCounter, projIdCounter) {
    return {
        enemyIdCounter: Number.isInteger(objectSystemSnapshot?.enemyIdCounter)
            ? objectSystemSnapshot.enemyIdCounter
            : 0,
        wallIdCounter,
        projIdCounter
    };
}

/**
 * 프레임 스냅샷 카운터 값을 생성합니다.
 * @param {object|null|undefined} objectSystemFrameSnapshot - 오브젝트 시스템 프레임 스냅샷입니다.
 * @param {number} wallIdCounter - 다음 벽 ID입니다.
 * @param {number} projIdCounter - 다음 투사체 ID입니다.
 * @returns {{enemyIdCounter: number, wallIdCounter: number, projIdCounter: number}}
 */
function createFrameCountersSnapshot(objectSystemFrameSnapshot, wallIdCounter, projIdCounter) {
    return {
        enemyIdCounter: Number.isInteger(objectSystemFrameSnapshot?.enemyIdCounter)
            ? objectSystemFrameSnapshot.enemyIdCounter
            : 0,
        wallIdCounter,
        projIdCounter
    };
}

/**
 * 적 시스템 스냅샷을 생성합니다.
 * @param {object|null|undefined} objectSystemSnapshot - 오브젝트 시스템 스냅샷입니다.
 * @returns {{aiDecisionGroupCursor: number, aiDecisionGroupCount: number, aiDecisionIntervalSeconds: number, enemyCullOutsideRatio: number}}
 */
function createEnemySystemSnapshot(objectSystemSnapshot) {
    return {
        aiDecisionGroupCursor: Number.isInteger(objectSystemSnapshot?.aiDecisionGroupCursor)
            ? objectSystemSnapshot.aiDecisionGroupCursor
            : 0,
        aiDecisionGroupCount: Number.isInteger(objectSystemSnapshot?.aiDecisionGroupCount)
            ? objectSystemSnapshot.aiDecisionGroupCount
            : 60,
        aiDecisionIntervalSeconds: Number.isFinite(objectSystemSnapshot?.aiDecisionIntervalSeconds)
            ? objectSystemSnapshot.aiDecisionIntervalSeconds
            : 1,
        enemyCullOutsideRatio: Number.isFinite(objectSystemSnapshot?.enemyCullOutsideRatio)
            ? objectSystemSnapshot.enemyCullOutsideRatio
            : 0.1
    };
}

/**
 * 플레이어 스냅샷을 생성합니다.
 * @param {object|null|undefined} player - 플레이어 엔티티입니다.
 * @returns {object|null}
 */
function createPlayerSnapshot(player) {
    if (!player) {
        return null;
    }

    const prevPosition = player.prevPosition ?? player.position;
    return {
        id: player.id ?? null,
        active: player.active !== false,
        radius: normalizeSnapshotNumber(player.radius, 0),
        weight: normalizeSnapshotNumber(player.weight, 0),
        position: cloneSnapshotPoint(player.position),
        prevPosition: cloneSnapshotPoint(prevPosition),
        speed: cloneSnapshotPoint(player.speed)
    };
}

/**
 * 벽 스냅샷을 생성합니다.
 * @param {object|null|undefined} wall - 벽 엔티티입니다.
 * @returns {object|null}
 */
function createWallSnapshot(wall) {
    if (!wall) {
        return null;
    }

    return {
        id: wall.id ?? null,
        active: wall.active !== false,
        x: normalizeSnapshotNumber(wall.x, 0),
        y: normalizeSnapshotNumber(wall.y, 0),
        w: normalizeSnapshotNumber(wall.w, 0),
        h: normalizeSnapshotNumber(wall.h, 0),
        origin: typeof wall.origin === 'string' ? wall.origin : 'center'
    };
}

/**
 * 투사체 스냅샷을 생성합니다.
 * @param {object|null|undefined} projectile - 투사체 엔티티입니다.
 * @returns {object|null}
 */
function createProjectileSnapshot(projectile) {
    if (!projectile) {
        return null;
    }

    return {
        id: projectile.id ?? null,
        active: projectile.active !== false,
        radius: normalizeSnapshotNumber(projectile.radius, 0),
        weight: normalizeSnapshotNumber(projectile.weight, 0),
        impactForce: normalizeSnapshotNumber(projectile.impactForce, 0),
        piercing: projectile.piercing === true,
        position: cloneSnapshotPoint(projectile.position),
        prevPosition: cloneSnapshotPoint(projectile.prevPosition),
        speed: cloneSnapshotPoint(projectile.speed)
    };
}

/**
 * 버튼 스냅샷을 생성합니다.
 * @param {object|null|undefined} button - 버튼 상태입니다.
 * @returns {object|null}
 */
function createButtonSnapshot(button) {
    if (!button) {
        return null;
    }

    return {
        id: typeof button.id === 'string' ? button.id : '',
        label: typeof button.label === 'string' ? button.label : '',
        x: normalizeSnapshotNumber(button.x, 0),
        y: normalizeSnapshotNumber(button.y, 0),
        w: normalizeSnapshotNumber(button.w, 0),
        h: normalizeSnapshotNumber(button.h, 0)
    };
}

/**
 * 항목 목록을 스냅샷 목록으로 변환합니다.
 * @param {object[]} sourceList - 원본 목록입니다.
 * @param {Function} snapshotFactory - 항목 스냅샷 생성 함수입니다.
 * @returns {object[]}
 */
function createSnapshotList(sourceList, snapshotFactory) {
    return Array.isArray(sourceList)
        ? sourceList.map((item) => snapshotFactory(item)).filter(Boolean)
        : [];
}

/**
 * 전체 게임 씬 시뮬레이션 스냅샷을 생성합니다.
 * @param {object} options - 스냅샷 생성 옵션입니다.
 * @returns {object}
 */
export function createGameSceneSimulationSnapshot(options) {
    const objectSystemSnapshot = options?.objectSystemSnapshot ?? null;

    return {
        sceneType: 'game',
        viewport: createViewportSnapshot(options?.viewport),
        counters: createSimulationCountersSnapshot(
            objectSystemSnapshot,
            options?.wallIdCounter,
            options?.projIdCounter
        ),
        enemySystem: createEnemySystemSnapshot(objectSystemSnapshot),
        player: createPlayerSnapshot(options?.player),
        staticWalls: createSnapshotList(options?.staticWalls, createWallSnapshot),
        boxWalls: createSnapshotList(options?.boxWalls, createWallSnapshot),
        projectiles: createSnapshotList(options?.projectiles, createProjectileSnapshot),
        enemies: Array.isArray(objectSystemSnapshot?.enemies) ? objectSystemSnapshot.enemies : [],
        collisionStats: createCollisionStatsSnapshot(options?.collisionStats),
        buttons: createSnapshotList(options?.buttons, createButtonSnapshot)
    };
}

/**
 * 게임 씬 프레임 스냅샷을 생성합니다.
 * @param {object} options - 프레임 스냅샷 생성 옵션입니다.
 * @returns {object}
 */
export function createGameSceneSimulationFrameSnapshot(options) {
    const objectSystemFrameSnapshot = options?.objectSystemFrameSnapshot ?? null;

    return {
        sceneType: 'game',
        viewport: createViewportSnapshot(options?.viewport),
        counters: createFrameCountersSnapshot(
            objectSystemFrameSnapshot,
            options?.wallIdCounter,
            options?.projIdCounter
        ),
        player: createPlayerSnapshot(options?.player),
        enemyStates: Array.isArray(objectSystemFrameSnapshot?.enemies) ? objectSystemFrameSnapshot.enemies : [],
        collisionStats: createCollisionStatsSnapshot(options?.collisionStats)
    };
}
