import { getCanvas, getWW, getWH, render, shadowOn, shadowOff } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { animate, remove } from 'animation/animation_system.js';
import { getMouseInput, isMousePressing } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { toRadians } from 'util/math_util.js';
import { clampFiniteNumber, resolveFiniteNumber } from 'util/number_util.js';

const CURSOR_CONSTANTS = getData('CURSOR_CONSTANTS');
const NORMAL_CURSOR_CONSTANTS = CURSOR_CONSTANTS.NORMAL;
const ATTACK_CURSOR_CONSTANTS = CURSOR_CONSTANTS.ATTACK;
const CURSOR_LAYER = 'top';
const NORMAL_CURSOR_TYPE = 'normal';
const ATTACK_CURSOR_TYPE = 'attack';
const NORMAL_CURSOR_ANIMATION_TYPE = 'easeOutExpo';

/**
 * @class UICursor
 * @description 게임 내 커서의 위치/상태를 업데이트하고 현재 커서 타입에 맞게 그립니다.
 */
export class UICursor {
    #x;
    #y;
    #defaultSubCircleRadius;
    #defaultSubCircleAlpha;
    #lineLong;
    #lineShort;
    #type;
    #normalAnimTime;
    #normalAnimDuration;
    #normalRadiusAnimId;
    #normalAlphaAnimId;
    #clicking;
    #visible;

    /**
     * UI 커서 상태를 생성합니다.
     */
    constructor() {
        this.#x = 0;
        this.#y = 0;

        this.WW = getWW();
        this.WH = getWH();
        this.#defaultSubCircleRadius = this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_RADIUS_WH_RATIO;
        this._subCircleRadius = this.#defaultSubCircleRadius;
        this.#defaultSubCircleAlpha = NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_ALPHA;
        this._subCircleAlpha = this.#defaultSubCircleAlpha;
        this.#lineLong = ATTACK_CURSOR_CONSTANTS.LINE_LONG_PX;
        this.#lineShort = ATTACK_CURSOR_CONSTANTS.LINE_SHORT_PX;
        this.#type = NORMAL_CURSOR_TYPE;
        this.#normalAnimTime = 0;
        this.#normalAnimDuration = NORMAL_CURSOR_CONSTANTS.ANIM_DURATION;
        this.#normalRadiusAnimId = -1;
        this.#normalAlphaAnimId = -1;
        this.#clicking = false;
        this.#visible = true;
    }

    /**
     * 해상도 변경 시 커서 내부 원 크기 등의 배율을 새 WH 기준으로 재계산합니다.
     */
    resize() {
        this.WW = getWW();
        this.WH = getWH();
        this.#defaultSubCircleRadius = this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_RADIUS_WH_RATIO;
        this.#syncNormalCursorSizeForResolution();
    }

    /**
     * 커서 상태를 업데이트합니다.
     * 마우스 입력에 따라 애니메이션을 처리합니다.
     */
    update() {
        if (!this.#visible) {
            return;
        }

        this.#x = resolveFiniteNumber(Number(getMouseInput('x')), 0);
        this.#y = resolveFiniteNumber(Number(getMouseInput('y')), 0);

        if (isMousePressing('left')) {
            if (this.#type === NORMAL_CURSOR_TYPE) {
                if (!this.#clicking) {
                    remove(this.#normalRadiusAnimId);
                    remove(this.#normalAlphaAnimId);
                    const duration = this.#normalAnimDuration - this.#normalAnimTime;
                    this.#normalRadiusAnimId = this._startNormalCursorAnimation(
                        '_subCircleRadius',
                        this.#defaultSubCircleRadius * NORMAL_CURSOR_CONSTANTS.CLICK_RADIUS_MULTIPLIER,
                        duration
                    );
                    this.#normalAlphaAnimId = this._startNormalCursorAnimation(
                        '_subCircleAlpha',
                        this.#defaultSubCircleAlpha * NORMAL_CURSOR_CONSTANTS.CLICK_ALPHA_MULTIPLIER,
                        duration
                    );
                }
                this.#normalAnimTime += getDelta();
                if (this.#normalAnimTime >= this.#normalAnimDuration) {
                    this.#normalAnimTime = this.#normalAnimDuration;
                }
                this.#clicking = true;
            }
        } else {
            if (this.#type === NORMAL_CURSOR_TYPE) {
                if (this.#clicking) {
                    remove(this.#normalRadiusAnimId);
                    remove(this.#normalAlphaAnimId);
                    this.#normalRadiusAnimId = this._startNormalCursorAnimation(
                        '_subCircleRadius',
                        this.#defaultSubCircleRadius,
                        this.#normalAnimTime
                    );
                    this.#normalAlphaAnimId = this._startNormalCursorAnimation(
                        '_subCircleAlpha',
                        this.#defaultSubCircleAlpha,
                        this.#normalAnimTime
                    );
                }
                this.#normalAnimTime -= getDelta();
                if (this.#normalAnimTime <= 0) {
                    this.#normalAnimTime = 0;
                }
                this.#clicking = false;
            }
        }
    }

    /**
     * 커서를 그립니다.
     */
    draw() {
        if (!this.#visible) {
            return;
        }

        if (this.#type === NORMAL_CURSOR_TYPE) {
            this._drawNormalCursor();
        } else if (this.#type === ATTACK_CURSOR_TYPE) {
            this._drawAttackCursor();
        }
    }

    /**
     * 커서를 초기화합니다.
     */
    init() { return Promise.resolve(); }

    /**
     * 커서 가시성을 설정합니다.
     * 비표시 전환 시 마지막 프레임 잔상을 제거하기 위해 top 캔버스를 즉시 비웁니다.
     * @param {boolean} isVisible - 표시 여부입니다.
     */
    setVisible(isVisible) {
        const nextVisible = isVisible === true;
        if (this.#visible === nextVisible) {
            return;
        }

        this.#visible = nextVisible;
        if (!nextVisible) {
            this.#clearCursorLayer();
        }
    }

    /**
     * normal 커서 애니메이션을 시작합니다.
     * @param {string} variable - 애니메이션 대상 속성 이름입니다.
     * @param {number} endValue - 애니메이션 종료 값입니다.
     * @param {number} duration - 애니메이션 지속 시간입니다.
     * @returns {number} 생성된 애니메이션 ID입니다.
     */
    _startNormalCursorAnimation(variable, endValue, duration) {
        return animate(this, {
            variable,
            startValue: 'current',
            endValue,
            type: NORMAL_CURSOR_ANIMATION_TYPE,
            duration: clampFiniteNumber(Number(duration), 0, Infinity, 0)
        }).id;
    }

    /**
     * normal 커서를 렌더링합니다.
     */
    _drawNormalCursor() {
        const angle = NORMAL_CURSOR_CONSTANTS.ARROW_ROTATION_DEG;
        const angleRad = toRadians(angle);
        this._drawNormalCursorArrow(
            NORMAL_CURSOR_CONSTANTS.LARGE_ARROW_SIZE_WH_RATIO,
            angle,
            angleRad,
            ColorSchemes.Cursor.Fill
        );
        this._drawNormalCursorArrow(
            NORMAL_CURSOR_CONSTANTS.SMALL_ARROW_SIZE_WH_RATIO,
            angle,
            angleRad,
            ColorSchemes.Cursor.Active
        );
        const subCircleX = this.#x
            + (this._subCircleRadius / 2)
            + (this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_OFFSET_X_WH_RATIO);
        const subCircleY = this.#y
            + (this._subCircleRadius / 2)
            + (this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_OFFSET_Y_WH_RATIO);
        render(CURSOR_LAYER, {
            shape: 'circle',
            x: subCircleX,
            y: subCircleY,
            radius: this._subCircleRadius,
            fill: ColorSchemes.Cursor.Active,
            alpha: this._subCircleAlpha
        });
    }

    /**
     * normal 커서의 화살표 한 겹을 렌더링합니다.
     * @param {number} sizeRatio - WH 기준 크기 비율입니다.
     * @param {number} angle - 회전 각도입니다.
     * @param {number} angleRad - 회전 라디안입니다.
     * @param {string} fill - 채움 색상입니다.
     */
    _drawNormalCursorArrow(sizeRatio, angle, angleRad, fill) {
        const size = this.WH * sizeRatio;
        const offsetX = (size / 2) * Math.sin(angleRad);
        const offsetY = (-size / 2) * Math.cos(angleRad);
        render(CURSOR_LAYER, {
            shape: 'arrow',
            x: this.#x - offsetX,
            y: this.#y - offsetY,
            w: size,
            h: size,
            rotation: angle,
            fill
        });
    }

    /**
     * attack 커서를 렌더링합니다.
     */
    _drawAttackCursor() {
        shadowOn(CURSOR_LAYER, ATTACK_CURSOR_CONSTANTS.SHADOW_BLUR_PX, ColorSchemes.Cursor.White);
        render(CURSOR_LAYER, {
            shape: 'circle',
            x: this.#x,
            y: this.#y,
            radius: ATTACK_CURSOR_CONSTANTS.CENTER_DOT_RADIUS_PX,
            fill: ColorSchemes.Cursor.Active
        });
        this._drawAttackCursorLine(-this.#lineLong, 0, -this.#lineShort, 0);
        this._drawAttackCursorLine(this.#lineShort, 0, this.#lineLong, 0);
        this._drawAttackCursorLine(0, -this.#lineLong, 0, -this.#lineShort);
        this._drawAttackCursorLine(0, this.#lineShort, 0, this.#lineLong);
        shadowOff(CURSOR_LAYER);
    }

    /**
     * attack 커서의 십자선 한 조각을 렌더링합니다.
     * @param {number} startOffsetX - 시작점 X 오프셋입니다.
     * @param {number} startOffsetY - 시작점 Y 오프셋입니다.
     * @param {number} endOffsetX - 끝점 X 오프셋입니다.
     * @param {number} endOffsetY - 끝점 Y 오프셋입니다.
     */
    _drawAttackCursorLine(startOffsetX, startOffsetY, endOffsetX, endOffsetY) {
        render(CURSOR_LAYER, {
            shape: 'line',
            x1: this.#x + startOffsetX,
            y1: this.#y + startOffsetY,
            x2: this.#x + endOffsetX,
            y2: this.#y + endOffsetY,
            stroke: ColorSchemes.Cursor.Active,
            lineWidth: ATTACK_CURSOR_CONSTANTS.LINE_WIDTH_PX
        });
    }

    /**
     * 해상도 변경 직후 남아 있는 커서 애니메이션 값을 새 기준 크기에 맞춥니다.
     * @private
     */
    #syncNormalCursorSizeForResolution() {
        remove(this.#normalRadiusAnimId);
        remove(this.#normalAlphaAnimId);
        this.#normalRadiusAnimId = -1;
        this.#normalAlphaAnimId = -1;

        if (this.#type !== NORMAL_CURSOR_TYPE) {
            return;
        }

        const isClicking = this.#clicking === true || isMousePressing('left');
        this._subCircleRadius = this.#defaultSubCircleRadius * (
            isClicking
                ? NORMAL_CURSOR_CONSTANTS.CLICK_RADIUS_MULTIPLIER
                : 1
        );
        this._subCircleAlpha = this.#defaultSubCircleAlpha * (
            isClicking
                ? NORMAL_CURSOR_CONSTANTS.CLICK_ALPHA_MULTIPLIER
                : 1
        );
        this.#normalAnimTime = isClicking ? this.#normalAnimDuration : 0;
        this.#clicking = isClicking;
    }

    /**
     * @private
     * 커서가 그려지는 top 캔버스를 즉시 비웁니다.
     */
    #clearCursorLayer() {
        const canvas = getCanvas('top');
        const context = canvas?.getContext?.('2d');
        if (!canvas || !context) {
            return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
    }
}
