import { getData } from 'data/data_handler.js';

const MAGNETIC_EFFECT_CONSTANTS = getData('PHYSICS_CONSTANTS').MAGNETIC_EFFECT;
const DEFAULT_MOTION_SCALE = MAGNETIC_EFFECT_CONSTANTS.DEFAULT_MOTION_SCALE;
const DEFAULT_IMPULSE_SCALE = MAGNETIC_EFFECT_CONSTANTS.DEFAULT_IMPULSE_SCALE;

/**
 * 자기력 motion scale을 옵션, 대상 fallback 순서로 조회합니다.
 * @param {object} target - 자기력 영향을 받을 대상입니다.
 * @param {object} options - 추가 제어 옵션입니다.
 * @returns {number} 유한 숫자로 보정한 motion scale입니다.
 */
function resolveMagneticMotionScale(target, options) {
    if (Number.isFinite(options.motionScale)) {
        return options.motionScale;
    }
    return Number.isFinite(target._titleParallaxMotionScale)
        ? target._titleParallaxMotionScale
        : DEFAULT_MOTION_SCALE;
}

/**
 * 자기력 impulse scale을 옵션 fallback으로 조회합니다.
 * @param {object} options - 추가 제어 옵션입니다.
 * @returns {number} 유한 숫자로 보정한 impulse scale입니다.
 */
function resolveMagneticImpulseScale(options) {
    return Number.isFinite(options.impulseScale) ? options.impulseScale : DEFAULT_IMPULSE_SCALE;
}

/**
 * 자기력 점 효과를 대상의 속도 버퍼에 누적합니다.
 * @param {object} target - 자기력 영향을 받을 대상입니다.
 * @param {{x:number, y:number}|null} pointPos - 자기장 중심점입니다.
 * @param {number} strength - 자기력 세기입니다.
 * @param {number} distanceLimit - 자기력이 유효한 최대 거리입니다.
 * @param {number} stepDelta - 고정 스텝 델타 시간입니다.
 * @param {{velocity?: {x:number, y:number}, motionScale?: number, impulseScale?: number}} [options={}] - 추가 제어 옵션입니다.
 */
export const applyMagneticPoint = (target, pointPos, strength, distanceLimit, stepDelta, options = {}) => {
    if (!target || !pointPos || strength <= 0 || distanceLimit <= 0) {
        return;
    }

    const velocity = options.velocity ?? target._titleMagVel;
    if (!velocity || !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) {
        return;
    }

    const dx = target.position.x - pointPos.x;
    const dy = target.position.y - pointPos.y;
    const distSq = dx * dx + dy * dy;
    const limitSq = distanceLimit * distanceLimit;

    if (distSq >= limitSq || distSq === 0) {
        return;
    }

    const distance = Math.sqrt(distSq);
    let strengthFactor = (distanceLimit - distance) / distanceLimit;
    strengthFactor = strengthFactor * strengthFactor * strengthFactor;

    const motionScale = resolveMagneticMotionScale(target, options);
    const impulseScale = resolveMagneticImpulseScale(options);
    const effectiveStrength = strength * strengthFactor * motionScale;
    const invLength = 1 / distance;
    const impulse = effectiveStrength * stepDelta * impulseScale;

    velocity.x += dx * invLength * impulse;
    velocity.y += dy * invLength * impulse;
};
