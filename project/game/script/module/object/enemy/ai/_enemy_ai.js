import {
    ensureEnemyAIState,
    fixedUpdateEnemyAI,
    resetEnemyAIState
} from './_enemy_ai_core.js';

/**
 * 전투 적 공용 AI 어댑터
 * - 현재 런타임 계약을 유지하면서 코어 구현을 감쌉니다.
 * @type {{id: string, init: Function, reset: Function, fixedUpdate: Function}}
 */
export const enemyAI = {
    id: 'enemyAI',

    /**
     * 적 AI 상태를 초기화합니다.
     * @param {object} enemy - 적 인스턴스입니다.
     * @returns {void}
     */
    init(enemy) {
        ensureEnemyAIState(enemy);
    },

    /**
     * 적 AI 상태를 초기화 상태로 되돌립니다.
     * @param {object|null|undefined} enemy - 적 인스턴스입니다.
     * @returns {void}
     */
    reset(enemy) {
        resetEnemyAIState(enemy);
    },

    /**
     * 적 AI 고정 스텝을 실행합니다.
     * @param {object} enemy - 적 인스턴스입니다.
     * @param {number} stepDelta - fixedUpdate 델타입니다.
     * @param {object} [context={}] - AI fixedUpdate 문맥입니다.
     * @returns {void}
     */
    fixedUpdate(enemy, stepDelta, context = {}) {
        fixedUpdateEnemyAI(enemy, stepDelta, context);
    }
};
