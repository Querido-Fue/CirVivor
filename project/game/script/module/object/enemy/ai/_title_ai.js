import { getData } from 'data/data_handler.js';
import { applyMagneticPoint } from 'physics/_magnetic_effect.js';
import {
    getSimulationMouseFocus,
    getSimulationMouseInput,
    isSimulationMousePressing
} from 'simulation/simulation_runtime.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_ACCEL_RESPONSE = 6;
const TITLE_PARALLAX_DEFAULT_SCALE = 1;
const TITLE_SPEED_CAP_EASEOUT_EXPO_RATE = Number.isFinite(TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_EASEOUT_EXPO_RATE)
    ? Math.max(0, TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_EASEOUT_EXPO_RATE)
    : 0;
const TITLE_BURST_EASEOUT_EXPO_RATE = Number.isFinite(TITLE_CONSTANTS.TITLE_AI.BURST_VELOCITY_EASEOUT_EXPO_RATE)
    ? Math.max(0, TITLE_CONSTANTS.TITLE_AI.BURST_VELOCITY_EASEOUT_EXPO_RATE)
    : 0;
const TITLE_BURST_ACCEL_RESPONSE_MULTIPLIER = Number.isFinite(TITLE_CONSTANTS.TITLE_AI.BURST_ACCEL_RESPONSE_MULTIPLIER)
    ? Math.max(1, TITLE_CONSTANTS.TITLE_AI.BURST_ACCEL_RESPONSE_MULTIPLIER)
    : 1;
const TITLE_BURST_MAX_SPEED_CAP_MULTIPLIER = Number.isFinite(TITLE_CONSTANTS.TITLE_AI.BURST_MAX_SPEED_CAP_MULTIPLIER)
    ? Math.max(1, TITLE_CONSTANTS.TITLE_AI.BURST_MAX_SPEED_CAP_MULTIPLIER)
    : 1;

/**
 * 마우스 포커스가 타이틀 적이 그려지는 오브젝트 레이어에 존재하는지 판별합니다.
 * @returns {boolean} 오브젝트 레이어 포커스 여부
 */
const hasObjectFocus = () => {
    const focus = getSimulationMouseFocus();
    return Array.isArray(focus) && focus.includes('object');
};

/**
 * 주어진 속도 벡터가 최대 속도를 넘으면 easeOutExpo 형태로 상한 쪽으로 감쇠합니다.
 * @param {number} vx - x축 속도입니다.
 * @param {number} vy - y축 속도입니다.
 * @param {number} maxSpeed - 허용할 최대 속도입니다.
 * @param {number} stepDelta - 현재 고정 틱 델타입니다.
 * @returns {{x:number, y:number}} 감쇠가 적용된 속도 벡터입니다.
 */
const easeOutExpoVelocityToMaxSpeed = (vx, vy, maxSpeed, stepDelta) => {
    if (!(Number.isFinite(maxSpeed) && maxSpeed > 0)) {
        return { x: vx, y: vy };
    }

    const speed = Math.hypot(vx, vy);
    if (!(speed > maxSpeed)) {
        return { x: vx, y: vy };
    }

    const easedOverflow = TITLE_SPEED_CAP_EASEOUT_EXPO_RATE > 0
        ? (speed - maxSpeed) * Math.pow(2, -(TITLE_SPEED_CAP_EASEOUT_EXPO_RATE * Math.max(0, stepDelta)))
        : 0;
    const nextSpeed = maxSpeed + easedOverflow;
    const scale = nextSpeed / speed;
    return {
        x: vx * scale,
        y: vy * scale
    };
};

/**
 * 현재 적의 기본 이동속도 크기를 반환합니다.
 * @param {object} enemy - 계산 대상 적 인스턴스입니다.
 * @returns {number} 기본 이동속도 크기입니다.
 */
const getTitleEnemyBaseSpeedMagnitude = (enemy) => {
    const baseSpeedX = Number.isFinite(enemy?._titleBaseSpeed?.x) ? enemy._titleBaseSpeed.x : 0;
    const baseSpeedY = Number.isFinite(enemy?._titleBaseSpeed?.y) ? enemy._titleBaseSpeed.y : 0;
    return Math.hypot(baseSpeedX, baseSpeedY);
};

/**
 * 현재 적의 기본 이동속도를 기준으로 최대 속도 상한을 계산합니다.
 * @param {object} enemy - 계산 대상 적 인스턴스입니다.
 * @returns {number} 최대 속도 상한입니다.
 */
const getTitleEnemySpeedCap = (enemy) => {
    const baseSpeedMagnitude = getTitleEnemyBaseSpeedMagnitude(enemy);
    const capMultiplier = Number.isFinite(TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_MULTIPLIER)
        ? Math.max(1, TITLE_CONSTANTS.TITLE_AI.MAX_SPEED_CAP_MULTIPLIER)
        : 1;
    if (!(baseSpeedMagnitude > 0)) {
        return 0;
    }

    const burstSpeedMagnitude = Math.hypot(
        Number.isFinite(enemy?._titleBurstVel?.x) ? enemy._titleBurstVel.x : 0,
        Number.isFinite(enemy?._titleBurstVel?.y) ? enemy._titleBurstVel.y : 0
    );
    const burstInfluence = Math.max(0, Math.min(1, burstSpeedMagnitude / Math.max(1, baseSpeedMagnitude)));
    const burstCapMultiplier = Math.max(capMultiplier, TITLE_BURST_MAX_SPEED_CAP_MULTIPLIER);
    const resolvedCapMultiplier = capMultiplier + ((burstCapMultiplier - capMultiplier) * burstInfluence);
    return baseSpeedMagnitude * resolvedCapMultiplier;
};

/**
 * 버스트가 살아있는 동안 실제 속도 추종 응답을 높여 급격한 감쇠 곡선이 보이도록 만듭니다.
 * @param {object} enemy - 계산 대상 적 인스턴스입니다.
 * @returns {number} 현재 틱에서 사용할 가속 응답입니다.
 */
const getTitleBurstAccelResponse = (enemy) => {
    const baseAccelResponse = Number.isFinite(enemy?._titleAccelResponse) && enemy._titleAccelResponse > 0
        ? enemy._titleAccelResponse
        : TITLE_ACCEL_RESPONSE;
    if (!(TITLE_BURST_ACCEL_RESPONSE_MULTIPLIER > 1)) {
        return baseAccelResponse;
    }

    const burstSpeedMagnitude = Math.hypot(
        Number.isFinite(enemy?._titleBurstVel?.x) ? enemy._titleBurstVel.x : 0,
        Number.isFinite(enemy?._titleBurstVel?.y) ? enemy._titleBurstVel.y : 0
    );
    if (!(burstSpeedMagnitude > 0)) {
        return baseAccelResponse;
    }

    const baseSpeedMagnitude = Math.max(1, getTitleEnemyBaseSpeedMagnitude(enemy));
    const burstInfluence = Math.max(0, Math.min(1, burstSpeedMagnitude / baseSpeedMagnitude));
    return baseAccelResponse * (1 + ((TITLE_BURST_ACCEL_RESPONSE_MULTIPLIER - 1) * burstInfluence));
};

/**
 * 일반 적 객체 내부에 타이틀 전용 변수 풀이 존재하도록 보장/초기화합니다.
 * @param {object} enemy 검사할 적 인스턴스
 */
export const ensureTitleEnemyState = (enemy) => {
    if (!enemy) return;

    if (!enemy._titleMagVel || typeof enemy._titleMagVel !== 'object') {
        enemy._titleMagVel = { x: 0, y: 0 };
    } else {
        if (!Number.isFinite(enemy._titleMagVel.x)) enemy._titleMagVel.x = 0;
        if (!Number.isFinite(enemy._titleMagVel.y)) enemy._titleMagVel.y = 0;
    }

    if (!Number.isFinite(enemy._spawnBoost)) {
        enemy._spawnBoost = 1;
    }

    if (!Number.isFinite(enemy._spawnBoostDecayRate) || enemy._spawnBoostDecayRate < 0) {
        enemy._spawnBoostDecayRate = 0;
    }

    if (!enemy._titleBaseSpeed || typeof enemy._titleBaseSpeed !== 'object') {
        enemy._titleBaseSpeed = { x: 0, y: 0 };
    } else {
        if (!Number.isFinite(enemy._titleBaseSpeed.x)) enemy._titleBaseSpeed.x = 0;
        if (!Number.isFinite(enemy._titleBaseSpeed.y)) enemy._titleBaseSpeed.y = 0;
    }

    if (!enemy._titleBurstVel || typeof enemy._titleBurstVel !== 'object') {
        enemy._titleBurstVel = { x: 0, y: 0 };
    } else {
        if (!Number.isFinite(enemy._titleBurstVel.x)) enemy._titleBurstVel.x = 0;
        if (!Number.isFinite(enemy._titleBurstVel.y)) enemy._titleBurstVel.y = 0;
    }

    if (!Number.isFinite(enemy._titleBurstDecayRate) || enemy._titleBurstDecayRate < 0) {
        enemy._titleBurstDecayRate = TITLE_BURST_EASEOUT_EXPO_RATE;
    }

    if (!Number.isFinite(enemy._titleAccelResponse) || enemy._titleAccelResponse <= 0) {
        enemy._titleAccelResponse = TITLE_ACCEL_RESPONSE;
    }

    if (!Number.isFinite(enemy._titleParallaxMotionScale) || enemy._titleParallaxMotionScale < 0) {
        enemy._titleParallaxMotionScale = TITLE_PARALLAX_DEFAULT_SCALE;
    }
};

/**
 * 타이틀 화면 적 전용 AI입니다.
 * 기본 물리 이동을 대체하고, 기존 자석/부스트 이동 공식을 유지합니다.
 */
export const titleAI = {
    id: 'titleAI',

    init(enemy) {
        ensureTitleEnemyState(enemy);
        enemy._titleBaseSpeed.x = Number.isFinite(enemy.speed?.x) ? enemy.speed.x : 0;
        enemy._titleBaseSpeed.y = Number.isFinite(enemy.speed?.y) ? enemy.speed.y : 0;
    },

    reset(enemy) {
        if (!enemy) return;
        ensureTitleEnemyState(enemy);
        enemy._titleMagVel.x = 0;
        enemy._titleMagVel.y = 0;
        enemy._spawnBoost = 1;
        enemy._spawnBoostDecayRate = 0;
        enemy._titleBaseSpeed.x = 0;
        enemy._titleBaseSpeed.y = 0;
        enemy._titleBurstVel.x = 0;
        enemy._titleBurstVel.y = 0;
        enemy._titleBurstDecayRate = TITLE_BURST_EASEOUT_EXPO_RATE;
        enemy._titleAccelResponse = TITLE_ACCEL_RESPONSE;
        enemy._titleParallaxMotionScale = TITLE_PARALLAX_DEFAULT_SCALE;
        enemy.setAcc(0, 0);
    },

    resize(enemy, context = {}) {
        ensureTitleEnemyState(enemy);
        const ratioX = Number.isFinite(context.ratioX) ? context.ratioX : 1;
        const ratioY = Number.isFinite(context.ratioY) ? context.ratioY : 1;
        enemy._titleMagVel.x *= ratioX;
        enemy._titleMagVel.y *= ratioY;
        enemy._titleBaseSpeed.x *= ratioX;
        enemy._titleBaseSpeed.y *= ratioY;
        enemy._titleBurstVel.x *= ratioX;
        enemy._titleBurstVel.y *= ratioY;
    },

    fixedUpdate(enemy, stepDelta, context = {}) {
        ensureTitleEnemyState(enemy);

        const uiww = Number.isFinite(context.uiww) ? context.uiww : 0;
        const logoMagneticPoint = context.logoMagneticPoint ?? null;
        const logoMagneticDistance = Number.isFinite(context.logoMagneticDistance)
            ? Math.max(0, context.logoMagneticDistance)
            : 0;
        const objectFocused = typeof context.objectFocused === 'boolean' ? context.objectFocused : hasObjectFocus();
        const leftPressing = typeof context.leftPressing === 'boolean' ? context.leftPressing : isSimulationMousePressing('left');
        const mousePos = context.mousePos ?? getSimulationMouseInput('pos');

        let mouseStrength = 0;
        let mouseDistance = 0;
        const magneticOptions = {
            velocity: enemy._titleMagVel,
            motionScale: enemy._titleParallaxMotionScale,
            impulseScale: TITLE_CONSTANTS.TITLE_AI.MAGNETIC_IMPULSE
        };
        if (objectFocused) {
            mouseStrength = leftPressing
                ? TITLE_CONSTANTS.TITLE_AI.MOUSE_CLICK_STRENGTH
                : TITLE_CONSTANTS.TITLE_AI.MOUSE_IDLE_STRENGTH;
            mouseDistance = leftPressing
                ? uiww * TITLE_CONSTANTS.TITLE_AI.MOUSE_CLICK_DISTANCE_RATIO
                : uiww * TITLE_CONSTANTS.TITLE_AI.MOUSE_IDLE_DISTANCE_RATIO;
        }

        applyMagneticPoint(enemy, mousePos, mouseStrength, mouseDistance, stepDelta, magneticOptions);
        if (logoMagneticPoint) {
            applyMagneticPoint(
                enemy,
                logoMagneticPoint,
                TITLE_CONSTANTS.TITLE_AI.LOGO_STRENGTH,
                logoMagneticDistance > 0
                    ? logoMagneticDistance
                    : uiww * TITLE_CONSTANTS.TITLE_AI.LOGO_DISTANCE_RATIO,
                stepDelta,
                magneticOptions
            );
        }

        const boost = enemy._spawnBoost || 1;
        const burstVelX = Number.isFinite(enemy._titleBurstVel.x) ? enemy._titleBurstVel.x : 0;
        const burstVelY = Number.isFinite(enemy._titleBurstVel.y) ? enemy._titleBurstVel.y : 0;
        const unclampedTargetVx = (enemy._titleBaseSpeed.x * boost) + burstVelX + enemy._titleMagVel.x;
        const unclampedTargetVy = (enemy._titleBaseSpeed.y * boost) + burstVelY + enemy._titleMagVel.y;
        const clampedTargetVelocity = easeOutExpoVelocityToMaxSpeed(
            unclampedTargetVx,
            unclampedTargetVy,
            getTitleEnemySpeedCap(enemy),
            stepDelta
        );
        enemy.setAcc(
            clampedTargetVelocity.x - enemy.speed.x,
            clampedTargetVelocity.y - enemy.speed.y
        );
        enemy.accSpeed = getTitleBurstAccelResponse(enemy);

        const damping = Math.max(0, 1 - (stepDelta * TITLE_CONSTANTS.TITLE_AI.MAGNETIC_DAMPING));
        enemy._titleMagVel.x *= damping;
        enemy._titleMagVel.y *= damping;

        if (enemy._spawnBoost > 1 && enemy._spawnBoostDecayRate > 0) {
            const nextBoostOverflow = (enemy._spawnBoost - 1) * Math.pow(2, -(enemy._spawnBoostDecayRate * stepDelta));
            enemy._spawnBoost = 1 + nextBoostOverflow;
            if ((enemy._spawnBoost - 1) < 0.001) {
                enemy._spawnBoost = 1;
                enemy._spawnBoostDecayRate = 0;
            }
        }

        if (enemy._titleBurstDecayRate > 0) {
            const burstDecayFactor = Math.pow(2, -(enemy._titleBurstDecayRate * stepDelta));
            enemy._titleBurstVel.x *= burstDecayFactor;
            enemy._titleBurstVel.y *= burstDecayFactor;
            if (Math.abs(enemy._titleBurstVel.x) < 0.01) enemy._titleBurstVel.x = 0;
            if (Math.abs(enemy._titleBurstVel.y) < 0.01) enemy._titleBurstVel.y = 0;
        }
    }
};
