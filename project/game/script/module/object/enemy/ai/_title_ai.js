import { getData } from 'data/data_handler.js';
import { applyMagneticPoint } from 'physics/_magnetic_effect.js';
import {
    getSimulationMouseFocus,
    getSimulationMouseInput,
    isSimulationMousePressing
} from 'simulation/simulation_runtime.js';
import { clamp01 } from 'util/number_util.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_AI_CONSTANTS = TITLE_CONSTANTS.TITLE_AI;
const TITLE_ACCEL_RESPONSE = TITLE_AI_CONSTANTS.ACCEL_RESPONSE;
const TITLE_PARALLAX_DEFAULT_SCALE = TITLE_AI_CONSTANTS.PARALLAX_DEFAULT_SCALE;
const TITLE_AI_ID = TITLE_AI_CONSTANTS.ID;
const SPAWN_BOOST_SETTLE_EPSILON = TITLE_AI_CONSTANTS.SPAWN_BOOST_SETTLE_EPSILON;
const BURST_VELOCITY_SETTLE_EPSILON = TITLE_AI_CONSTANTS.BURST_VELOCITY_SETTLE_EPSILON;
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
 * 주어진 속도 벡터가 최대 속도를 넘으면 easeOutExpo 형태로 상한 쪽으로 감쇠할 배율을 계산합니다.
 * @param {number} vx - x축 속도입니다.
 * @param {number} vy - y축 속도입니다.
 * @param {number} maxSpeed - 허용할 최대 속도입니다.
 * @param {number} stepDelta - 현재 고정 틱 델타입니다.
 * @returns {number} 원래 속도 벡터에 곱할 감쇠 배율입니다.
 */
const getEaseOutExpoVelocityScale = (vx, vy, maxSpeed, stepDelta) => {
    if (!(Number.isFinite(maxSpeed) && maxSpeed > 0)) {
        return 1;
    }

    const speed = Math.hypot(vx, vy);
    if (!(speed > maxSpeed)) {
        return 1;
    }

    const easedOverflow = TITLE_SPEED_CAP_EASEOUT_EXPO_RATE > 0
        ? (speed - maxSpeed) * Math.pow(2, -(TITLE_SPEED_CAP_EASEOUT_EXPO_RATE * Math.max(0, stepDelta)))
        : 0;
    const nextSpeed = maxSpeed + easedOverflow;
    return nextSpeed / speed;
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
    const burstInfluence = clamp01(burstSpeedMagnitude / Math.max(1, baseSpeedMagnitude));
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
    const burstInfluence = clamp01(burstSpeedMagnitude / baseSpeedMagnitude);
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
    id: TITLE_AI_ID,

    /**
     * AI가 적에 연결될 때 타이틀 전용 상태를 보장하고 현재 속도를 기본 이동속도로 캡처합니다.
     * 유효하지 않은 속도 축은 `0`으로 저장하며 적의 현재 속도 자체는 변경하지 않습니다.
     * `BaseEnemy.setAI()`에서 호출된 뒤 타이틀 스폰 경로가 별도 기본 속도로 덮어쓸 수 있습니다.
     * @param {object} enemy - 타이틀 AI를 연결할 적 인스턴스입니다.
     * @returns {void}
     * @throws {TypeError} 적이 필수 타이틀 상태를 보관할 수 없는 값이면 발생합니다.
     */
    init(enemy) {
        ensureTitleEnemyState(enemy);
        enemy._titleBaseSpeed.x = Number.isFinite(enemy.speed?.x) ? enemy.speed.x : 0;
        enemy._titleBaseSpeed.y = Number.isFinite(enemy.speed?.y) ? enemy.speed.y : 0;
    },

    /**
     * 풀 반환이나 AI 교체 전에 타이틀 전용 누적 상태를 기본값으로 되돌립니다.
     * falsy 적은 그대로 무시하고, 유효한 적은 마지막에 `setAcc(0, 0)`으로 가속도를 초기화합니다.
     * 현재 속도, 위치와 `accSpeed`는 이 훅에서 변경하지 않습니다.
     * @param {object|null|undefined} enemy - 초기화할 적 인스턴스입니다.
     * @returns {void}
     * @throws {TypeError} truthy 적이 호환 상태 또는 `setAcc()`를 제공하지 않으면 발생합니다.
     */
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

    /**
     * 화면 크기 변경 비율을 자력·기본 속도·버스트 속도 벡터에 축별로 적용합니다.
     * 각 비율이 유한수가 아니면 해당 축은 배율 `1`을 사용하며 위치와 현재 물리 속도는 변경하지 않습니다.
     * @param {object} enemy - 내부 타이틀 속도 벡터를 재조정할 적 인스턴스입니다.
     * @param {object} [context={}] - 리사이즈 문맥입니다.
     * @param {number} [context.ratioX=1] - X축 배율입니다.
     * @param {number} [context.ratioY=1] - Y축 배율입니다.
     * @returns {void}
     * @throws {TypeError} 적이 호환 상태를 제공하지 않거나 context가 `null`이면 발생합니다.
     */
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

    /**
     * 한 고정 틱의 마우스·로고 자력, 기본/버스트 목표 속도와 감쇠 상태를 계산합니다.
     * 결과는 적의 가속도와 `accSpeed`, 타이틀 전용 누적 벡터에 기록하며 위치와 현재 속도 적분은 호출자가 수행합니다.
     * 포커스·버튼 값이 불리언이 아니거나 마우스 위치가 `null` 또는 `undefined`이면 simulation runtime의 현재 스냅샷을 사용합니다.
     * stepDelta는 호출자가 양의 유한 초 단위 값으로 보장하며 이 메서드는 별도로 검증하지 않습니다.
     * @param {object} enemy - 갱신할 타이틀 적 인스턴스입니다.
     * @param {number} stepDelta - 현재 고정 틱 델타입니다.
     * @param {object} [context={}] - 타이틀 배경이 공유하는 AI 문맥입니다.
     * @param {number} [context.uiww=0] - UI 기준 너비입니다.
     * @param {{x:number,y:number}|null} [context.logoMagneticPoint=null] - 오브젝트 좌표계 로고 자력점입니다.
     * @param {number} [context.logoMagneticDistance=0] - 양수이면 사용할 로고 자력 거리이며, 그 외에는 UI 너비 비율로 대체됩니다.
     * @param {boolean} [context.objectFocused] - 오브젝트 레이어 포커스 스냅샷입니다.
     * @param {boolean} [context.leftPressing] - 왼쪽 버튼 입력 스냅샷입니다.
     * @param {{x:number,y:number}|null} [context.mousePos] - 오브젝트 좌표계 마우스 위치이며, `null` 또는 `undefined`이면 runtime 입력으로 대체됩니다.
     * @returns {void}
     * @throws {TypeError} 적이 호환 상태를 제공하지 않거나 context가 `null`이면 발생합니다.
     */
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
        const targetVelocityScale = getEaseOutExpoVelocityScale(
            unclampedTargetVx,
            unclampedTargetVy,
            getTitleEnemySpeedCap(enemy),
            stepDelta
        );
        const clampedTargetVx = unclampedTargetVx * targetVelocityScale;
        const clampedTargetVy = unclampedTargetVy * targetVelocityScale;
        enemy.setAcc(
            clampedTargetVx - enemy.speed.x,
            clampedTargetVy - enemy.speed.y
        );
        enemy.accSpeed = getTitleBurstAccelResponse(enemy);

        const damping = Math.max(0, 1 - (stepDelta * TITLE_CONSTANTS.TITLE_AI.MAGNETIC_DAMPING));
        enemy._titleMagVel.x *= damping;
        enemy._titleMagVel.y *= damping;

        if (enemy._spawnBoost > 1 && enemy._spawnBoostDecayRate > 0) {
            const nextBoostOverflow = (enemy._spawnBoost - 1) * Math.pow(2, -(enemy._spawnBoostDecayRate * stepDelta));
            enemy._spawnBoost = 1 + nextBoostOverflow;
            if ((enemy._spawnBoost - 1) < SPAWN_BOOST_SETTLE_EPSILON) {
                enemy._spawnBoost = 1;
                enemy._spawnBoostDecayRate = 0;
            }
        }

        if (enemy._titleBurstDecayRate > 0) {
            const burstDecayFactor = Math.pow(2, -(enemy._titleBurstDecayRate * stepDelta));
            enemy._titleBurstVel.x *= burstDecayFactor;
            enemy._titleBurstVel.y *= burstDecayFactor;
            if (Math.abs(enemy._titleBurstVel.x) < BURST_VELOCITY_SETTLE_EPSILON) enemy._titleBurstVel.x = 0;
            if (Math.abs(enemy._titleBurstVel.y) < BURST_VELOCITY_SETTLE_EPSILON) enemy._titleBurstVel.y = 0;
        }
    }
};
