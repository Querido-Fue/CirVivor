import { getMouseInput, getMouseFocus, isMousePressing } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');
const TITLE_ACCEL_RESPONSE = 6;

/**
 * 마우스 포커스가 타이틀 적이 그려지는 오브젝트 레이어에 존재하는지 판별합니다.
 * @returns {boolean} 오브젝트 레이어 포커스 여부
 */
const hasObjectFocus = () => {
    const focus = getMouseFocus();
    return Array.isArray(focus) && focus.includes('object');
};

/**
 * 적에게 자기적으로 끌려오거나 밀려나는 관성 효과를 누적합니다.
 * @param {object} enemy 대상 적 객체
 * @param {object} pointPos 자력 중심점 좌표 {x, y}
 * @param {number} strength 인력/척력 강도 (양수, 음수 가능)
 * @param {number} distanceLimit 자력 효과가 닿는 한계 거리
 * @param {number} stepDelta 프레임/스텝별 시간 단위
 */
const applyMagneticPoint = (enemy, pointPos, strength, distanceLimit, stepDelta) => {
    if (!pointPos || strength <= 0 || distanceLimit <= 0) return;

    const dx = enemy.position.x - pointPos.x;
    const dy = enemy.position.y - pointPos.y;
    const distSq = dx * dx + dy * dy;
    const limitSq = distanceLimit * distanceLimit;

    if (distSq >= limitSq || distSq === 0) return;

    const distance = Math.sqrt(distSq);
    let strengthFactor = (distanceLimit - distance) / distanceLimit;
    strengthFactor = strengthFactor * strengthFactor * strengthFactor;

    const effectiveStrength = strength * strengthFactor;
    const invLength = 1 / distance;
    const impulse = effectiveStrength * stepDelta * TITLE_CONSTANTS.TITLE_AI.MAGNETIC_IMPULSE;

    enemy._titleMagVel.x += dx * invLength * impulse;
    enemy._titleMagVel.y += dy * invLength * impulse;
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

    if (!enemy._titleBaseSpeed || typeof enemy._titleBaseSpeed !== 'object') {
        enemy._titleBaseSpeed = { x: 0, y: 0 };
    } else {
        if (!Number.isFinite(enemy._titleBaseSpeed.x)) enemy._titleBaseSpeed.x = 0;
        if (!Number.isFinite(enemy._titleBaseSpeed.y)) enemy._titleBaseSpeed.y = 0;
    }

    if (!Number.isFinite(enemy._titleAccelResponse) || enemy._titleAccelResponse <= 0) {
        enemy._titleAccelResponse = TITLE_ACCEL_RESPONSE;
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
        enemy._titleBaseSpeed.x = 0;
        enemy._titleBaseSpeed.y = 0;
        enemy._titleAccelResponse = TITLE_ACCEL_RESPONSE;
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
    },

    fixedUpdate(enemy, stepDelta, context = {}) {
        ensureTitleEnemyState(enemy);

        const uiww = Number.isFinite(context.uiww) ? context.uiww : 0;
        const logoMagneticPoint = context.logoMagneticPoint ?? null;
        const objectFocused = typeof context.objectFocused === 'boolean' ? context.objectFocused : hasObjectFocus();
        const leftPressing = typeof context.leftPressing === 'boolean' ? context.leftPressing : isMousePressing('left');
        const mousePos = context.mousePos ?? getMouseInput('pos');

        let mouseStrength = 0;
        let mouseDistance = 0;
        if (objectFocused) {
            mouseStrength = leftPressing
                ? TITLE_CONSTANTS.TITLE_AI.MOUSE_CLICK_STRENGTH
                : TITLE_CONSTANTS.TITLE_AI.MOUSE_IDLE_STRENGTH;
            mouseDistance = leftPressing
                ? uiww * TITLE_CONSTANTS.TITLE_AI.MOUSE_CLICK_DISTANCE_RATIO
                : uiww * TITLE_CONSTANTS.TITLE_AI.MOUSE_IDLE_DISTANCE_RATIO;
        }

        applyMagneticPoint(enemy, mousePos, mouseStrength, mouseDistance, stepDelta);
        if (logoMagneticPoint) {
            applyMagneticPoint(
                enemy,
                logoMagneticPoint,
                TITLE_CONSTANTS.TITLE_AI.LOGO_STRENGTH,
                uiww * TITLE_CONSTANTS.TITLE_AI.LOGO_DISTANCE_RATIO,
                stepDelta
            );
        }

        const boost = enemy._spawnBoost || 1;
        const targetVx = (enemy._titleBaseSpeed.x * boost) + enemy._titleMagVel.x;
        const targetVy = (enemy._titleBaseSpeed.y * boost) + enemy._titleMagVel.y;
        enemy.setAcc(targetVx - enemy.speed.x, targetVy - enemy.speed.y);
        enemy.accSpeed = enemy._titleAccelResponse;

        const damping = Math.max(0, 1 - (stepDelta * TITLE_CONSTANTS.TITLE_AI.MAGNETIC_DAMPING));
        enemy._titleMagVel.x *= damping;
        enemy._titleMagVel.y *= damping;
    }
};
