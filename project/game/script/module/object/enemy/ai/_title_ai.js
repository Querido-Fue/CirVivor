import { getMouseInput, getMouseFocus } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * 마우스 포커스가 화면 배경(타이틀 등)에 존재하는지 판별합니다.
 * @returns {boolean} 백그라운드 포커스 여부
 */
const hasBackgroundFocus = () => {
    const focus = getMouseFocus();
    return Array.isArray(focus) && focus.includes('background');
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

    if (typeof enemy._titleIntroActive !== 'boolean') {
        enemy._titleIntroActive = false;
    }

    if (!Number.isFinite(enemy._titleIntroOffsetX)) {
        enemy._titleIntroOffsetX = 0;
    }

    if (!Number.isFinite(enemy._titleIntroPrevOffsetX)) {
        enemy._titleIntroPrevOffsetX = 0;
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
    },

    reset(enemy) {
        if (!enemy) return;
        ensureTitleEnemyState(enemy);
        enemy._titleMagVel.x = 0;
        enemy._titleMagVel.y = 0;
        enemy._spawnBoost = 1;
        enemy._titleIntroActive = false;
        enemy._titleIntroOffsetX = 0;
        enemy._titleIntroPrevOffsetX = 0;
    },

    resize(enemy, context = {}) {
        ensureTitleEnemyState(enemy);
        const ratioX = Number.isFinite(context.ratioX) ? context.ratioX : 1;
        const ratioY = Number.isFinite(context.ratioY) ? context.ratioY : 1;
        enemy._titleMagVel.x *= ratioX;
        enemy._titleMagVel.y *= ratioY;
        enemy._titleIntroOffsetX *= ratioX;
        enemy._titleIntroPrevOffsetX *= ratioX;
    },

    update(enemy, stepDelta, context = {}) {
        ensureTitleEnemyState(enemy);

        if (enemy._titleIntroActive) {
            enemy._titleMagVel.x = 0;
            enemy._titleMagVel.y = 0;
            const boost = enemy._spawnBoost || 1;
            const introOffsetDelta = enemy._titleIntroOffsetX - enemy._titleIntroPrevOffsetX;
            enemy._titleIntroPrevOffsetX = enemy._titleIntroOffsetX;
            enemy.position.x += (enemy.speed.x * boost * stepDelta) + introOffsetDelta;
            enemy.position.y += enemy.speed.y * boost * stepDelta;
            return {
                skipAcceleration: true,
                skipDefaultMovement: true
            };
        }

        const uiww = Number.isFinite(context.uiww) ? context.uiww : 0;
        const logoMagneticPoint = context.logoMagneticPoint ?? null;
        const backgroundFocused = typeof context.backgroundFocused === 'boolean' ? context.backgroundFocused : hasBackgroundFocus();
        const leftClicking = typeof context.leftClicking === 'boolean' ? context.leftClicking : Boolean(getMouseInput('leftClicking'));
        const mousePos = context.mousePos ?? getMouseInput('pos');

        let mouseStrength = 0;
        let mouseDistance = 0;
        if (backgroundFocused) {
            mouseStrength = leftClicking
                ? TITLE_CONSTANTS.TITLE_AI.MOUSE_CLICK_STRENGTH
                : TITLE_CONSTANTS.TITLE_AI.MOUSE_IDLE_STRENGTH;
            mouseDistance = leftClicking
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
        enemy.position.x += ((enemy.speed.x * boost) + enemy._titleMagVel.x) * stepDelta;
        enemy.position.y += ((enemy.speed.y * boost) + enemy._titleMagVel.y) * stepDelta;

        const damping = Math.max(0, 1 - (stepDelta * TITLE_CONSTANTS.TITLE_AI.MAGNETIC_DAMPING));
        enemy._titleMagVel.x *= damping;
        enemy._titleMagVel.y *= damping;

        return {
            skipAcceleration: true,
            skipDefaultMovement: true
        };
    }
};
