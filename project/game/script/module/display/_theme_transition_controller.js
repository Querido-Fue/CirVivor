import { animate, remove } from 'animation/animation_system.js';
import { colorUtil } from 'util/color_util.js';

const THEME_TRANSITION_DATA = Object.freeze({
    LAYER: 'top',
    START_ALPHA: 0.82,
    LIGHT_START_ALPHA: 0.55,
    LIGHT_LUMINANCE_THRESHOLD: 0.6,
    END_ALPHA: 0,
    DURATION_SECONDS: 0.4,
    EASING: 'linear'
});
let themeTransitionControllerInstance = null;

/**
 * 밝은 이전 배경은 낮은 veil 알파로 시작해 light -> dark 전환의 흰색 플래시를 억제합니다.
 * 공용 CSS 색상 파서를 사용하며, 파서가 준비되지 않았거나 유효한 RGB를 주지 않으면
 * 보수적인 기본값을 사용합니다.
 * @param {string} background - 교체 직전 배경색입니다.
 * @returns {number} 전환 시작 알파입니다.
 */
function getStartAlpha(background) {
    const rgb = colorUtil()?.cssToRgb?.(background);
    if (!rgb
        || !Number.isFinite(rgb.r)
        || !Number.isFinite(rgb.g)
        || !Number.isFinite(rgb.b)) {
        return THEME_TRANSITION_DATA.START_ALPHA;
    }

    const luminance = ((rgb.r * 0.2126) + (rgb.g * 0.7152) + (rgb.b * 0.0722)) / 255;
    return luminance >= THEME_TRANSITION_DATA.LIGHT_LUMINANCE_THRESHOLD
        ? THEME_TRANSITION_DATA.LIGHT_START_ALPHA
        : THEME_TRANSITION_DATA.START_ALPHA;
}

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
     * 이전 테마 배경색 veil을 밝기에 맞춘 제한 알파에서 0으로 감쇠합니다.
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

        const startAlpha = getStartAlpha(previousBackground);
        this.renderCommand.fill = previousBackground;
        this.alpha = startAlpha;
        this.active = true;

        const animation = animate(this, {
            variable: 'alpha',
            startValue: startAlpha,
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
