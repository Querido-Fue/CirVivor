import { animate, remove } from "animation/animation_system.js";

/**
 * @class BaseUIElement
 * @description 모든 UI 요소가 공통으로 사용하는 기본 속성과 상호작용 애니메이션 로직을 제공합니다.
 */
export class BaseUIElement {
    constructor(properties) {
        this.init(properties);
    }

    /**
         * @override
         * 전달된 속성을 바탕으로 요소의 초기 상태를 설정합니다.
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

        // 공통 애니메이션 상태
        this.scale = 1;
        this._targetScale = 1;
        this.isPressed = false;
        this.hoverValue = 0;
        this._targetHoverValue = 0;

        if (this.scaleAnimId) { remove(this.scaleAnimId); this.scaleAnimId = null; }
        if (this.hoverAnimId !== -1) { remove(this.hoverAnimId); this.hoverAnimId = -1; }
    }

    /**
         * @override
         * 요소를 초기 기본 상태로 되돌리고 애니메이션 훅을 파괴합니다.
         */
    reset() {
        if (this.scaleAnimId) { remove(this.scaleAnimId); this.scaleAnimId = null; }
        if (this.hoverAnimId !== -1) { remove(this.hoverAnimId); this.hoverAnimId = -1; }
    }

    /**
     * 자식 클래스들의 update()에서 공통적으로 호출하여
     * Hover와 Pressed 애니메이션 값을 계산하는 함수입니다.
     * @param {boolean} isHovered
     * @param {boolean} isLeftClicking
     * @param {Function} [onHoverFn] - 호버 시 실행할 콜백 (선택)
     */
    _handleInteractionState(isHovered, isLeftClicking, onHoverFn) {
        if (!this.clickAble) return;

        const targetValue = isHovered ? 1.0 : 0.0;
        const shouldBePressed = isHovered && isLeftClicking;

        let targetScale = 1.0;
        if (shouldBePressed) {
            targetScale = this.pressScaleMultiplier !== undefined ? this.pressScaleMultiplier : 0.95;
        } else if (isHovered) {
            targetScale = this.hoverScaleMultiplier !== undefined ? this.hoverScaleMultiplier : 1.0;
        }

        // 스케일 애니메이션
        if (this._targetScale !== targetScale) {
            this._targetScale = targetScale;
            this.isPressed = shouldBePressed;

            if (this.scaleAnimId) {
                remove(this.scaleAnimId);
                this.scaleAnimId = null;
            }

            this.scaleAnimId = animate(this, { variable: 'scale', startValue: this.scale, endValue: targetScale, type: "easeOutExpo", duration: 0.2 }).id;
        }

        // 호버 애니메이션
        if (targetValue !== this._targetHoverValue) {
            this._targetHoverValue = targetValue;

            if (this.hoverAnimId !== -1) {
                remove(this.hoverAnimId);
                this.hoverAnimId = -1;
            }

            const animObj = animate(this, {
                variable: 'hoverValue',
                startValue: this.hoverValue,
                endValue: this._targetHoverValue,
                type: 'easeOutExpo',
                duration: 0.5
            });
            this.hoverAnimId = animObj.id;

            if (isHovered && onHoverFn) {
                onHoverFn();
            }
        }
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
