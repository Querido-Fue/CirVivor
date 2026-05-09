import { animate, remove } from 'animation/animation_system.js';
import { requestTooltip } from 'ui/ui_system.js';

const NO_ANIMATION_ID = -1;
const DEFAULT_SCALE = 1;
const DEFAULT_HOVER_VALUE = 0;
const DEFAULT_PRESS_SCALE_MULTIPLIER = 0.95;
const DEFAULT_HOVER_SCALE_MULTIPLIER = 1;
const SCALE_ANIMATION_DURATION = 0.2;
const HOVER_ANIMATION_DURATION = 0.5;
const INTERACTION_ANIMATION_TYPE = 'easeOutExpo';

/**
 * @class BaseUIElement
 * @description 모든 UI 요소가 공통으로 사용하는 기본 속성과 상호작용 애니메이션 로직을 제공합니다.
 */
export class BaseUIElement {
    #targetScale;
    #targetHoverValue;
    #hoverTooltipContent;
    #isHovering;

    /**
     * 공통 UI 요소의 애니메이션 ID 기본값을 설정합니다.
     * @param {object} properties - 하위 클래스 생성자가 전달하는 속성 객체입니다.
     */
    constructor(properties) {
        // 서브클래스의 private 필드 초기화를 위해 생성자에서 init()이 호출되지 않습니다.
        this.scaleAnimId = NO_ANIMATION_ID;
        this.hoverAnimId = NO_ANIMATION_ID;
    }

    /**
     * 전달된 속성을 바탕으로 요소의 초기 상태를 설정합니다.
     * @param {object} properties - 초기화 속성입니다.
     * @override
     */
    init(properties) {
        if (!properties) return;
        this.id = this.id || crypto.randomUUID();

        this.parent = properties.parent || null;
        this.layer = properties.layer || 'main';
        this.x = properties.x || 0;
        this.y = properties.y || 0;
        this.alpha = properties.alpha === undefined ? 1 : properties.alpha;
        this.shadow = properties.shadow || null;
        this.visible = true;
        this.clickAble = properties.clickAble === undefined ? true : properties.clickAble;
        this.tooltip = properties.tooltip;
        this.#hoverTooltipContent = null;
        this.#isHovering = false;

        // 공통 애니메이션 상태
        this.scale = DEFAULT_SCALE;
        this.#targetScale = DEFAULT_SCALE;
        this.isPressed = false;
        this.hoverValue = DEFAULT_HOVER_VALUE;
        this.#targetHoverValue = DEFAULT_HOVER_VALUE;

        this._stopScaleAnimation();
        this._stopHoverAnimation();
    }

    /**
     * 요소를 초기 기본 상태로 되돌리고 애니메이션 훅을 파괴합니다.
     * @override
     */
    reset() {
        this._stopScaleAnimation();
        this._stopHoverAnimation();
        this.tooltip = null;
        this.#hoverTooltipContent = null;
        this.#isHovering = false;
    }

    /**
     * 자식 클래스들의 update()에서 공통적으로 호출하여
     * Hover와 Pressed 애니메이션 값을 계산하는 함수입니다.
     * @param {boolean} isHovered
     * @param {boolean} isLeftClicking
     * @param {Function} [onHoverFn] - 호버 시 실행할 콜백 (선택)
     */
    _handleInteractionState(isHovered, isLeftClicking, onHoverFn) {
        this.#updateTooltipState(isHovered, onHoverFn);

        if (!this.clickAble) return;

        const targetValue = isHovered ? 1 : 0;
        const shouldBePressed = isHovered && isLeftClicking;
        const targetScale = this._resolveTargetScale(isHovered, shouldBePressed);

        if (this.#targetScale !== targetScale) {
            this.#targetScale = targetScale;
            this.isPressed = shouldBePressed;
            this.scaleAnimId = this._startInteractionAnimation('scale', this.scale, targetScale, SCALE_ANIMATION_DURATION);
        }

        if (targetValue !== this.#targetHoverValue) {
            this.#targetHoverValue = targetValue;
            this.hoverAnimId = this._startInteractionAnimation(
                'hoverValue',
                this.hoverValue,
                this.#targetHoverValue,
                HOVER_ANIMATION_DURATION
            );
        }
    }

    /**
     * 현재 hover/pressed 상태에 맞는 scale 목표값을 계산합니다.
     * @param {boolean} isHovered - 현재 hover 여부입니다.
     * @param {boolean} shouldBePressed - 눌림 상태로 표시할지 여부입니다.
     * @returns {number} 목표 scale 값입니다.
     */
    _resolveTargetScale(isHovered, shouldBePressed) {
        if (shouldBePressed) {
            return this.pressScaleMultiplier !== undefined
                ? this.pressScaleMultiplier
                : DEFAULT_PRESS_SCALE_MULTIPLIER;
        }
        if (isHovered) {
            return this.hoverScaleMultiplier !== undefined
                ? this.hoverScaleMultiplier
                : DEFAULT_HOVER_SCALE_MULTIPLIER;
        }
        return DEFAULT_SCALE;
    }

    /**
     * 상호작용 애니메이션을 시작합니다.
     * @param {string} variable - 애니메이션 대상 속성 이름입니다.
     * @param {number} startValue - 시작 값입니다.
     * @param {number} endValue - 종료 값입니다.
     * @param {number} duration - 지속 시간입니다.
     * @returns {number} 생성된 애니메이션 ID입니다.
     */
    _startInteractionAnimation(variable, startValue, endValue, duration) {
        if (variable === 'scale') {
            this._stopScaleAnimation();
        } else if (variable === 'hoverValue') {
            this._stopHoverAnimation();
        }

        return animate(this, {
            variable,
            startValue,
            endValue,
            type: INTERACTION_ANIMATION_TYPE,
            duration
        }).id;
    }

    /**
     * scale 애니메이션을 제거합니다.
     */
    _stopScaleAnimation() {
        if (this._isActiveAnimationId(this.scaleAnimId)) {
            remove(this.scaleAnimId);
        }
        this.scaleAnimId = NO_ANIMATION_ID;
    }

    /**
     * hover 애니메이션을 제거합니다.
     */
    _stopHoverAnimation() {
        if (this._isActiveAnimationId(this.hoverAnimId)) {
            remove(this.hoverAnimId);
        }
        this.hoverAnimId = NO_ANIMATION_ID;
    }

    /**
     * 애니메이션 시스템에서 제거 가능한 ID인지 확인합니다.
     * @param {number} animationId - 검사할 애니메이션 ID입니다.
     * @returns {boolean} 제거 가능한 애니메이션 ID 여부입니다.
     */
    _isActiveAnimationId(animationId) {
        return Number.isInteger(animationId) && animationId >= 0;
    }

    /**
     * @private
     * hover 진입 시점과 유지 시간을 추적해 툴팁 표시 가능 여부를 계산합니다.
     * @param {boolean} isHovered - 현재 hover 여부입니다.
     * @param {Function|undefined} [onHoverFn] - hover 시작 시 실행할 콜백입니다.
     */
    #updateTooltipState(isHovered, onHoverFn) {
        if (!isHovered) {
            this.#isHovering = false;
            this.#hoverTooltipContent = null;
            return;
        }

        if (!this.#isHovering) {
            this.#isHovering = true;
            if (onHoverFn) {
                const hoverResult = onHoverFn();
                this.#hoverTooltipContent = hoverResult !== undefined && hoverResult !== null && hoverResult !== false
                    ? hoverResult
                    : null;
            }
        }

        const tooltipContent = this.#resolveTooltipContent();
        if (tooltipContent) {
            requestTooltip(tooltipContent);
        }
    }

    /**
     * @private
     * 현재 hover 상태에서 노출할 툴팁 콘텐츠를 계산합니다.
     * @returns {string|string[]|object|null} 요청할 툴팁 콘텐츠입니다.
     */
    #resolveTooltipContent() {
        const tooltipSource = this.tooltip !== undefined && this.tooltip !== null
            ? this.tooltip
            : this.#hoverTooltipContent;
        if (tooltipSource === undefined || tooltipSource === null || tooltipSource === false) {
            return null;
        }

        if (typeof tooltipSource === 'function') {
            return tooltipSource(this);
        }

        return tooltipSource;
    }

    /**
     * 매 프레임마다 요소의 상태 변화나 상호작용 피드백을 계산합니다.
     */
    update() {
        // 하위 클래스에서 구현
    }

    /**
     * 설정된 레이어 캔버스에 이 요소를 그래픽으로 그립니다.
     */
    draw() {
        // 하위 클래스에서 구현
    }
}
