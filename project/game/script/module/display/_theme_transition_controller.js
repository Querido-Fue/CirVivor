import { animate, remove } from 'animation/animation_system.js';

const THEME_TRANSITION_DATA = Object.freeze({
    LAYER: 'top',
    START_ALPHA: 1,
    END_ALPHA: 0,
    DURATION_SECONDS: 0.4,
    EASING: 'linear'
});
let themeTransitionControllerInstance = null;

/**
 * @class ThemeTransitionController
 * @description 이전 테마 배경색 veil을 최상단 surface에서 감쇠해 런타임 테마 전환을 표시합니다.
 */
export class ThemeTransitionController {
    #animationId = -1;
    #animationToken = 0;

    /**
     * @param {object} options - 렌더 의존성입니다.
     * @param {(layer:string, command:object) => void} options.render - 2D 렌더 함수입니다.
     * @param {() => number} options.getWidth - 현재 내부 화면 너비 getter입니다.
     * @param {() => number} options.getHeight - 현재 내부 화면 높이 getter입니다.
     */
    constructor({ render, getWidth, getHeight }) {
        this.renderCommand = {
            shape: 'rect',
            x: 0,
            y: 0,
            w: 0,
            h: 0,
            fill: '#000000',
            alpha: 0
        };
        this.renderFrame = render;
        this.getWidth = getWidth;
        this.getHeight = getHeight;
        this.alpha = 0;
        this.active = false;
        themeTransitionControllerInstance = this;
    }

    /**
     * 이전 테마 배경색 veil을 완전 불투명 상태에서 0으로 감쇠합니다.
     * 진행 중 재요청은 이전 완료 콜백을 무효화하고 새 색상으로 즉시 재시작합니다.
     * 전체 화면 복사본을 만들지 않으므로 GPU readback이나 canvas 합성을 유발하지 않습니다.
     * @param {string} previousBackground - 교체 직전 테마 배경색입니다.
     * @returns {boolean} 전환 시작 여부입니다.
     */
    start(previousBackground) {
        if (typeof previousBackground !== 'string' || previousBackground.length === 0) {
            return false;
        }

        const animationToken = ++this.#animationToken;
        if (this.#animationId >= 0) {
            remove(this.#animationId);
        }

        this.renderCommand.fill = previousBackground;
        this.alpha = THEME_TRANSITION_DATA.START_ALPHA;
        this.active = true;

        const animation = animate(this, {
            variable: 'alpha',
            startValue: THEME_TRANSITION_DATA.START_ALPHA,
            endValue: THEME_TRANSITION_DATA.END_ALPHA,
            duration: THEME_TRANSITION_DATA.DURATION_SECONDS,
            type: THEME_TRANSITION_DATA.EASING
        });
        this.#animationId = animation.id;
        animation.promise.then(() => {
            if (animationToken !== this.#animationToken) {
                return;
            }
            this.#animationId = -1;
            this.alpha = THEME_TRANSITION_DATA.END_ALPHA;
            this.active = false;
        });
        return true;
    }

    /**
     * 활성 전환을 모든 UI보다 위인 공용 top surface에 그립니다.
     * @returns {void}
     */
    draw() {
        if (!this.active || this.alpha <= 0) {
            return;
        }

        const command = this.renderCommand;
        command.w = this.getWidth();
        command.h = this.getHeight();
        command.alpha = this.alpha;
        this.renderFrame(THEME_TRANSITION_DATA.LAYER, command);
    }
}

/**
 * 준비된 controller에서 테마 veil 페이드를 시작합니다. 초기화 전 호출은 아무 작업도 하지 않습니다.
 * @param {string} previousBackground - 교체 직전 테마 배경색입니다.
 * @returns {boolean} 전환 시작 여부입니다.
 */
export function beginThemeTransition(previousBackground) {
    return themeTransitionControllerInstance?.start(previousBackground) ?? false;
}
