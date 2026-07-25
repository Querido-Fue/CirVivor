import { ENEMY_AI_DATA } from 'data/object/enemy/enemy_ai_data.js';
import { normalizeDegrees } from 'util/math_util.js';
import { clampNumber } from 'util/number_util.js';
import { getHexaHiveType } from '../_hexa_hive_layout.js';

const DEFAULT_AI_PROFILE = ENEMY_AI_DATA.QUALITY_PROFILES[ENEMY_AI_DATA.DEFAULT_QUALITY_PROFILE];
const HEXA_HIVE_TYPE = getHexaHiveType();
const ROTATION_EPSILON = 1e-6;
const STRAIGHT_DEG = 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * 현재 각도에서 목표 각도까지의 최단 회전 차이를 반환합니다.
 * @param {number} targetDeg - 목표 각도입니다.
 * @param {number} currentDeg - 현재 각도입니다.
 * @returns {number} 최단 회전 차이입니다.
 */
const getShortestAngleDeltaDeg = (targetDeg, currentDeg) => normalizeDegrees(targetDeg - currentDeg, true);

/**
 * 180도 대칭인 주축 기준으로 가장 짧은 회전 차이를 반환합니다.
 * @param {number} targetDeg - 목표 회전 각도입니다.
 * @param {number} currentDeg - 현재 회전 각도입니다.
 * @returns {number} 대칭을 반영한 회전 차이입니다.
 */
const getSymmetricAxisDeltaDeg = (targetDeg, currentDeg) => {
    const directDelta = getShortestAngleDeltaDeg(targetDeg, currentDeg);
    const flippedDelta = getShortestAngleDeltaDeg(targetDeg + STRAIGHT_DEG, currentDeg);
    return Math.abs(flippedDelta) < Math.abs(directDelta) ? flippedDelta : directDelta;
};

/**
 * 기본 AI 프로필에서 숫자 fallback을 읽습니다.
 * @param {string} key - 읽을 프로필 키입니다.
 * @returns {number} 기본 프로필 값입니다.
 */
const readDefaultProfileNumber = (key) => {
    const value = DEFAULT_AI_PROFILE?.[key];
    return Number.isFinite(value) ? value : 0;
};

/**
 * 프로필에서 양수 값을 읽습니다.
 * @param {object|null|undefined} profile - AI 품질 프로필입니다.
 * @param {string} key - 읽을 키입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 양수 프로필 값입니다.
 */
const readPositiveProfileNumber = (profile, key, fallback) => {
    const value = profile?.[key];
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

/**
 * 프로필에서 0 이상 1 이하 값을 읽습니다.
 * @param {object|null|undefined} profile - AI 품질 프로필입니다.
 * @param {string} key - 읽을 키입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 프로필 값입니다.
 */
const readUnitProfileNumber = (profile, key, fallback) => {
    const value = profile?.[key];
    return Number.isFinite(value) ? clampNumber(value, 0, 1) : fallback;
};

/**
 * 회전 목표를 잡을 진행 방향의 각도를 계산합니다.
 * @param {object|null|undefined} enemy - 적 객체입니다.
 * @param {object|null|undefined} state - 적 AI 상태입니다.
 * @param {{x?: number, y?: number}|null|undefined} steeringDir - 현재 조향 방향입니다.
 * @returns {number|null} 정규화된 진행 방향의 radians 또는 유효한 방향이 없을 때 null입니다.
 */
const resolveRotationTargetAngleRadians = (enemy, state, steeringDir) => {
    const steeringX = Number.isFinite(steeringDir?.x) ? steeringDir.x : 0;
    const steeringY = Number.isFinite(steeringDir?.y) ? steeringDir.y : 0;
    const targetX = Number.isFinite(state?.targetX) && Number.isFinite(enemy?.position?.x)
        ? state.targetX - enemy.position.x
        : 0;
    const targetY = Number.isFinite(state?.targetY) && Number.isFinite(enemy?.position?.y)
        ? state.targetY - enemy.position.y
        : 0;
    const speedX = Number.isFinite(enemy?.speed?.x) ? enemy.speed.x : 0;
    const speedY = Number.isFinite(enemy?.speed?.y) ? enemy.speed.y : 0;
    const stateDirX = Number.isFinite(state?.dirX) ? state.dirX : 0;
    const stateDirY = Number.isFinite(state?.dirY) ? state.dirY : 0;

    let length = Math.hypot(steeringX, steeringY);
    if (!(length <= ROTATION_EPSILON)) {
        const normalizedX = steeringX / length;
        const normalizedY = steeringY / length;
        return Math.atan2(normalizedY, normalizedX);
    }

    length = Math.hypot(targetX, targetY);
    if (!(length <= ROTATION_EPSILON)) {
        const normalizedX = targetX / length;
        const normalizedY = targetY / length;
        return Math.atan2(normalizedY, normalizedX);
    }

    length = Math.hypot(speedX, speedY);
    if (!(length <= ROTATION_EPSILON)) {
        const normalizedX = speedX / length;
        const normalizedY = speedY / length;
        return Math.atan2(normalizedY, normalizedX);
    }

    length = Math.hypot(stateDirX, stateDirY);
    if (!(length <= ROTATION_EPSILON)) {
        const normalizedX = stateDirX / length;
        const normalizedY = stateDirY / length;
        return Math.atan2(normalizedY, normalizedX);
    }

    return null;
};

/**
 * 합체 육각형이 자신의 긴 축을 진행 방향으로 맞추도록 각속도 의도를 적용합니다.
 * @param {object|null|undefined} enemy - 적 객체입니다.
 * @param {object|null|undefined} state - 적 AI 상태입니다.
 * @param {{x?: number, y?: number}|null|undefined} steeringDir - 현재 조향 방향입니다.
 * @param {object|null|undefined} footprintMetrics - AI footprint 메트릭입니다.
 * @param {object|null|undefined} profile - AI 품질 프로필입니다.
 * @returns {void}
 */
export function applyEnemyAIRotationIntent(enemy, state, steeringDir, footprintMetrics, profile) {
    if (!enemy || enemy.type !== HEXA_HIVE_TYPE) {
        return;
    }
    if (state?.hexaHiveArrivalBrake === true) {
        enemy.angularVelocity = 0;
        enemy.angularDeceleration = 0;
        return;
    }

    const axisAnisotropy = Number.isFinite(footprintMetrics?.axisAnisotropy)
        ? footprintMetrics.axisAnisotropy
        : (Number.isFinite(enemy.navigationAxisAnisotropy) ? enemy.navigationAxisAnisotropy : 0);
    const minAnisotropy = readUnitProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_MIN_ANISOTROPY_RATIO',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_MIN_ANISOTROPY_RATIO')
    );
    if (axisAnisotropy < minAnisotropy) {
        return;
    }

    const targetMoveRadians = resolveRotationTargetAngleRadians(enemy, state, steeringDir);
    if (targetMoveRadians === null) {
        return;
    }

    const currentRotation = Number.isFinite(enemy.rotation) ? enemy.rotation : 0;
    enemy.rotation = currentRotation;

    const axisLocalDeg = Number.isFinite(footprintMetrics?.axisLocalDeg)
        ? footprintMetrics.axisLocalDeg
        : (Number.isFinite(enemy.navigationAxisLocalDeg) ? enemy.navigationAxisLocalDeg : 0);
    const targetMoveDeg = targetMoveRadians * RADIANS_TO_DEGREES;
    const targetRotation = targetMoveDeg - axisLocalDeg;
    const deltaDeg = getSymmetricAxisDeltaDeg(targetRotation, currentRotation);
    const absDeltaDeg = Math.abs(deltaDeg);
    const deadZoneDeg = readPositiveProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_DEAD_ZONE_DEG',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_DEAD_ZONE_DEG')
    );
    if (absDeltaDeg <= deadZoneDeg) {
        enemy.angularVelocity = 0;
        enemy.angularDeceleration = 0;
        return;
    }

    const maxDegPerSec = readPositiveProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_MAX_DEG_PER_SEC',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_MAX_DEG_PER_SEC')
    );
    const dampStartDeg = readPositiveProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_DAMP_START_DEG',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_DAMP_START_DEG')
    );
    const responseRatio = readUnitProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_RESPONSE_RATIO',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_RESPONSE_RATIO')
    );
    const gainPerSecond = readPositiveProfileNumber(
        profile,
        'HEXA_HIVE_AI_ROTATION_GAIN_PER_SEC',
        readDefaultProfileNumber('HEXA_HIVE_AI_ROTATION_GAIN_PER_SEC')
    );
    const rampedMaxDegPerSec = maxDegPerSec * clampNumber(absDeltaDeg / dampStartDeg, 0, 1);
    const targetAngularVelocity = clampNumber(
        deltaDeg * gainPerSecond,
        -rampedMaxDegPerSec,
        rampedMaxDegPerSec
    );
    const currentAngularVelocity = Number.isFinite(enemy.angularVelocity) ? enemy.angularVelocity : 0;
    const nextAngularVelocity = (currentAngularVelocity * (1 - responseRatio))
        + (targetAngularVelocity * responseRatio);

    enemy.angularVelocity = clampNumber(nextAngularVelocity, -maxDegPerSec, maxDegPerSec);
    enemy.angularDeceleration = 0;
}
