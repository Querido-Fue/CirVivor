import { cloneHexaHiveLayout } from '../object/enemy/_hexa_hive_layout.js';
import { DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS } from './game_scene_shadow_enemy_defaults.js';

/**
 * 좌표 객체를 단순 스냅샷으로 복제합니다.
 * @param {{x?: number, y?: number}|null|undefined} point - 원본 좌표입니다.
 * @returns {{x: number, y: number}}
 */
export function clonePointSnapshot(point) {
    return {
        x: Number.isFinite(point?.x) ? point.x : 0,
        y: Number.isFinite(point?.y) ? point.y : 0
    };
}

/**
 * 좌표 스냅샷을 기존 객체에 in-place로 반영합니다.
 * @param {{x: number, y: number}} targetPoint - 갱신할 좌표 객체입니다.
 * @param {{x?: number, y?: number}|null|undefined} sourcePoint - 원본 좌표입니다.
 * @returns {{x: number, y: number}}
 */
export function assignPointSnapshot(targetPoint, sourcePoint) {
    if (!targetPoint || typeof targetPoint !== 'object') {
        return clonePointSnapshot(sourcePoint);
    }

    targetPoint.x = Number.isFinite(sourcePoint?.x) ? sourcePoint.x : 0;
    targetPoint.y = Number.isFinite(sourcePoint?.y) ? sourcePoint.y : 0;
    return targetPoint;
}

/**
 * 플레이어 스냅샷을 정규화합니다.
 * @param {object|null|undefined} player - 원본 플레이어 데이터입니다.
 * @returns {object|null}
 */
export function createShadowPlayerFromData(player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(player.position);
    const prevPosition = player.prevPosition ? clonePointSnapshot(player.prevPosition) : { ...position };
    return {
        id: Number.isInteger(player.id) ? player.id : null,
        active: player.active !== false,
        radius: Number.isFinite(player.radius) ? player.radius : 0,
        weight: Number.isFinite(player.weight) ? player.weight : 0,
        position,
        prevPosition,
        speed: clonePointSnapshot(player.speed)
    };
}

/**
 * 플레이어 스냅샷을 기존 미러 객체에 in-place로 반영합니다.
 * @param {object|null|undefined} currentPlayer - 현재 미러 플레이어입니다.
 * @param {object|null|undefined} player - 원본 플레이어 데이터입니다.
 * @returns {object|null}
 */
export function assignShadowPlayerFromData(currentPlayer, player) {
    if (!player || typeof player !== 'object') {
        return null;
    }

    const nextPlayer = currentPlayer && typeof currentPlayer === 'object'
        ? currentPlayer
        : createShadowPlayerFromData(player);
    if (!nextPlayer) {
        return null;
    }

    nextPlayer.id = Number.isInteger(player.id) ? player.id : null;
    nextPlayer.active = player.active !== false;
    nextPlayer.radius = Number.isFinite(player.radius) ? player.radius : 0;
    nextPlayer.weight = Number.isFinite(player.weight) ? player.weight : 0;
    nextPlayer.position = assignPointSnapshot(nextPlayer.position, player.position);
    nextPlayer.prevPosition = assignPointSnapshot(nextPlayer.prevPosition, player.prevPosition ?? player.position);
    nextPlayer.speed = assignPointSnapshot(nextPlayer.speed, player.speed);
    return nextPlayer;
}

/**
 * 벽 스냅샷을 정규화합니다.
 * @param {object|null|undefined} wall - 원본 벽 데이터입니다.
 * @returns {object|null}
 */
export function createShadowWallFromData(wall) {
    if (!wall || typeof wall !== 'object') {
        return null;
    }

    return {
        id: Number.isInteger(wall.id) ? wall.id : null,
        active: wall.active !== false,
        x: Number.isFinite(wall.x) ? wall.x : 0,
        y: Number.isFinite(wall.y) ? wall.y : 0,
        w: Number.isFinite(wall.w) ? wall.w : 0,
        h: Number.isFinite(wall.h) ? wall.h : 0,
        origin: typeof wall.origin === 'string' ? wall.origin : 'center'
    };
}

/**
 * 투사체 스냅샷을 정규화합니다.
 * @param {object|null|undefined} projectile - 원본 투사체 데이터입니다.
 * @returns {object|null}
 */
export function createShadowProjectileFromData(projectile) {
    if (!projectile || typeof projectile !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(projectile.position);
    const prevPosition = projectile.prevPosition ? clonePointSnapshot(projectile.prevPosition) : { ...position };
    return {
        id: Number.isInteger(projectile.id) ? projectile.id : null,
        active: projectile.active !== false,
        radius: Number.isFinite(projectile.radius) ? projectile.radius : 0,
        weight: Number.isFinite(projectile.weight) ? projectile.weight : 0,
        impactForce: Number.isFinite(projectile.impactForce) ? projectile.impactForce : 0,
        piercing: projectile.piercing === true,
        position,
        prevPosition,
        speed: clonePointSnapshot(projectile.speed)
    };
}

/**
 * 적 스폰 커맨드나 전체/프레임 스냅샷으로부터 미러 적 상태를 생성합니다.
 * @param {object|null|undefined} enemyData - 원본 적 데이터입니다.
 * @returns {object|null} 정규화된 적 미러 상태입니다.
 */
export function createShadowEnemyFromSpawnData(enemyData) {
    if (!enemyData || typeof enemyData !== 'object') {
        return null;
    }

    const position = clonePointSnapshot(enemyData.position);
    const prevPosition = enemyData.prevPosition ? clonePointSnapshot(enemyData.prevPosition) : { ...position };
    const renderPosition = enemyData.renderPosition ? clonePointSnapshot(enemyData.renderPosition) : { ...position };
    return {
        id: Number.isInteger(enemyData.id) ? enemyData.id : null,
        active: enemyData.active !== false,
        type: typeof enemyData.type === 'string' ? enemyData.type : 'none',
        aiId: typeof enemyData.aiId === 'string' ? enemyData.aiId : null,
        mergeBaseMoveSpeed: Number.isFinite(enemyData.mergeBaseMoveSpeed) ? enemyData.mergeBaseMoveSpeed : null,
        hp: Number.isFinite(enemyData.hp) ? enemyData.hp : 0,
        maxHp: Number.isFinite(enemyData.maxHp) ? enemyData.maxHp : 0,
        atk: Number.isFinite(enemyData.atk) ? enemyData.atk : 0,
        moveSpeed: Number.isFinite(enemyData.moveSpeed) ? enemyData.moveSpeed : 0,
        accSpeed: Number.isFinite(enemyData.accSpeed) ? enemyData.accSpeed : 0,
        size: Number.isFinite(enemyData.size) ? enemyData.size : 1,
        weight: Number.isFinite(enemyData.weight) ? enemyData.weight : 0,
        rotationResistance: Number.isFinite(enemyData.rotationResistance) ? enemyData.rotationResistance : 1,
        projectileHitsToKill: Number.isFinite(enemyData.projectileHitsToKill) ? enemyData.projectileHitsToKill : 0,
        projectileHitCount: Number.isFinite(enemyData.projectileHitCount) ? enemyData.projectileHitCount : 0,
        position,
        prevPosition,
        renderPosition,
        speed: clonePointSnapshot(enemyData.speed),
        acc: clonePointSnapshot(enemyData.acc),
        status: enemyData.status && typeof enemyData.status === 'object'
            ? {
                id: enemyData.status.id ?? null,
                type: typeof enemyData.status.type === 'string' ? enemyData.status.type : 'none',
                time: Number.isFinite(enemyData.status.time) ? enemyData.status.time : 0,
                remainingTime: Number.isFinite(enemyData.status.remainingTime) ? enemyData.status.remainingTime : 0,
                factor: enemyData.status.factor && typeof enemyData.status.factor === 'object'
                    ? { ...enemyData.status.factor }
                    : {}
            }
            : {
                id: null,
                type: 'none',
                time: 0,
                remainingTime: 0,
                factor: {}
            },
        fill: typeof enemyData.fill === 'string' ? enemyData.fill : null,
        alpha: Number.isFinite(enemyData.alpha) ? enemyData.alpha : null,
        rotation: Number.isFinite(enemyData.rotation) ? enemyData.rotation : null,
        hexaHiveLayout: cloneHexaHiveLayout(enemyData.hexaHiveLayout),
        angularVelocity: Number.isFinite(enemyData.angularVelocity) ? enemyData.angularVelocity : 0,
        angularDeceleration: Number.isFinite(enemyData.angularDeceleration) ? enemyData.angularDeceleration : 0,
        hexaHiveMergePending: enemyData.hexaHiveMergePending === true,
        hexaHiveMergePendingWeight: Number.isFinite(enemyData.hexaHiveMergePendingWeight)
            ? enemyData.hexaHiveMergePendingWeight
            : null,
        axisResistanceX: Number.isFinite(enemyData.axisResistanceX) ? enemyData.axisResistanceX : 1,
        axisResistanceY: Number.isFinite(enemyData.axisResistanceY) ? enemyData.axisResistanceY : 1,
        axisResistanceRecoverySeconds: Number.isFinite(enemyData.axisResistanceRecoverySeconds)
            ? enemyData.axisResistanceRecoverySeconds
            : DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverDelaySeconds: Number.isFinite(enemyData.axisResistanceRecoverDelaySeconds)
            ? enemyData.axisResistanceRecoverDelaySeconds
            : 0,
        axisResistanceRecoverHoldX: Number.isFinite(enemyData.axisResistanceRecoverHoldX) ? enemyData.axisResistanceRecoverHoldX : 0,
        axisResistanceRecoverHoldY: Number.isFinite(enemyData.axisResistanceRecoverHoldY) ? enemyData.axisResistanceRecoverHoldY : 0,
        axisResistanceRecoverElapsedX: Number.isFinite(enemyData.axisResistanceRecoverElapsedX)
            ? enemyData.axisResistanceRecoverElapsedX
            : DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverElapsedY: Number.isFinite(enemyData.axisResistanceRecoverElapsedY)
            ? enemyData.axisResistanceRecoverElapsedY
            : DEFAULT_SHADOW_AXIS_RESISTANCE_RECOVERY_SECONDS,
        axisResistanceRecoverStartX: Number.isFinite(enemyData.axisResistanceRecoverStartX) ? enemyData.axisResistanceRecoverStartX : 1,
        axisResistanceRecoverStartY: Number.isFinite(enemyData.axisResistanceRecoverStartY) ? enemyData.axisResistanceRecoverStartY : 1
    };
}
