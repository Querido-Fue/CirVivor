import { getWW, getWH, render, shadowOn, shadowOff } from 'display/display_system.js';
import { getDelta } from 'game/time_handler.js';
import { animate, remove } from 'animation/animation_system.js';
import { getMouseInput } from 'input/input_system.js';
import { getData } from 'data/data_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';

const CURSOR_CONSTANTS = getData('CURSOR_CONSTANTS');
const NORMAL_CURSOR_CONSTANTS = CURSOR_CONSTANTS.NORMAL;
const ATTACK_CURSOR_CONSTANTS = CURSOR_CONSTANTS.ATTACK;

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
    #attackAnimTime;
    #normalAnimDuration;
    #attackAnimDuration;
    #normalRadiusAnimId;
    #normalAlphaAnimId;
    #clicking;

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
        this.#type = 'normal';
        this.#normalAnimTime = 0;
        this.#attackAnimTime = 0;
        this.#normalAnimDuration = NORMAL_CURSOR_CONSTANTS.ANIM_DURATION;
        this.#attackAnimDuration = ATTACK_CURSOR_CONSTANTS.ANIM_DURATION;
        this.#normalRadiusAnimId = -1;
        this.#normalAlphaAnimId = -1;
        this.#clicking = false;
    }

    /**
         * 해상도 변경 시 커서 내부 원 크기 등의 배율을 새 WH 기준으로 재계산합니다.
         */
    resize() {
        const prevWH = this.WH || 1;
        this.WW = getWW();
        this.WH = getWH();
        const ratio = this.WH / Math.max(1, prevWH);
        this.#defaultSubCircleRadius = this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_RADIUS_WH_RATIO;
        this._subCircleRadius = Math.max(0, this._subCircleRadius * ratio);
    }

    /**
     * 커서 상태를 업데이트합니다.
     * 마우스 입력에 따라 애니메이션을 처리합니다.
     */
    update() {
        this.#x = getMouseInput("x");
        this.#y = getMouseInput("y");

        if (getMouseInput("leftClicking")) {
            if (this.#type === 'normal') {
                if (!this.#clicking) {
                    remove(this.#normalRadiusAnimId);
                    remove(this.#normalAlphaAnimId);
                    this.#normalRadiusAnimId = animate(this, { variable: '_subCircleRadius', startValue: 'current', endValue: this.#defaultSubCircleRadius * NORMAL_CURSOR_CONSTANTS.CLICK_RADIUS_MULTIPLIER, type: "easeOutExpo", duration: this.#normalAnimDuration - this.#normalAnimTime }).id;
                    this.#normalAlphaAnimId = animate(this, { variable: '_subCircleAlpha', startValue: 'current', endValue: this.#defaultSubCircleAlpha * NORMAL_CURSOR_CONSTANTS.CLICK_ALPHA_MULTIPLIER, type: "easeOutExpo", duration: this.#normalAnimDuration - this.#normalAnimTime }).id;
                }
                this.#normalAnimTime += getDelta();
                if (this.#normalAnimTime >= this.#normalAnimDuration) {
                    this.#normalAnimTime = this.#normalAnimDuration;
                }
                this.#clicking = true;
            }
            else if (this.#type === 'attack') {
            }
        } else {
            if (this.#type === 'normal') {
                if (this.#clicking) {
                    remove(this.#normalRadiusAnimId);
                    remove(this.#normalAlphaAnimId);
                    this.#normalRadiusAnimId = animate(this, { variable: '_subCircleRadius', startValue: 'current', endValue: this.#defaultSubCircleRadius, type: "easeOutExpo", duration: this.#normalAnimTime }).id;
                    this.#normalAlphaAnimId = animate(this, { variable: '_subCircleAlpha', startValue: 'current', endValue: this.#defaultSubCircleAlpha, type: "easeOutExpo", duration: this.#normalAnimTime }).id;
                }
                this.#normalAnimTime -= getDelta();
                if (this.#normalAnimTime <= 0) {
                    this.#normalAnimTime = 0;
                }
                this.#clicking = false;
            }
            else if (this.#type === 'attack') {
            }
        }
    }

    /**
     * 커서를 그립니다.
     */
    draw() {
        if (this.#type === 'normal') {
            const angle = NORMAL_CURSOR_CONSTANTS.ARROW_ROTATION_DEG;
            const angleRad = angle * Math.PI / 180;
            const sizeBig = this.WH * NORMAL_CURSOR_CONSTANTS.LARGE_ARROW_SIZE_WH_RATIO;
            const offsetX1 = (sizeBig / 2) * Math.sin(angleRad);
            const offsetY1 = (-sizeBig / 2) * Math.cos(angleRad);
            render('top', {
                shape: 'arrow',
                x: this.#x - offsetX1,
                y: this.#y - offsetY1,
                w: sizeBig,
                h: sizeBig,
                rotation: angle,
                fill: ColorSchemes.Cursor.Fill
            });


            const sizeSmall = this.WH * NORMAL_CURSOR_CONSTANTS.SMALL_ARROW_SIZE_WH_RATIO;
            const offsetX2 = (sizeSmall / 2) * Math.sin(angleRad);
            const offsetY2 = (-sizeSmall / 2) * Math.cos(angleRad);
            render('top', {
                shape: 'arrow',
                x: this.#x - offsetX2,
                y: this.#y - offsetY2,
                w: sizeSmall,
                h: sizeSmall,
                rotation: angle,
                fill: ColorSchemes.Cursor.Active,
            });
            render('top', {
                shape: 'circle',
                x: this.#x + this._subCircleRadius / 2 + this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_OFFSET_X_WH_RATIO,
                y: this.#y + this._subCircleRadius / 2 + this.WH * NORMAL_CURSOR_CONSTANTS.SUB_CIRCLE_OFFSET_Y_WH_RATIO,
                radius: this._subCircleRadius,
                fill: ColorSchemes.Cursor.Active,
                alpha: this._subCircleAlpha
            });
        } else if (this.#type === 'attack') {
            shadowOn('top', ATTACK_CURSOR_CONSTANTS.SHADOW_BLUR_PX, ColorSchemes.Cursor.White);
            render('top', {
                shape: 'circle',
                x: this.#x,
                y: this.#y,
                radius: ATTACK_CURSOR_CONSTANTS.CENTER_DOT_RADIUS_PX,
                fill: ColorSchemes.Cursor.Active
            });
            render('top', {
                shape: 'line',
                x1: this.#x - this.#lineLong,
                y1: this.#y,
                x2: this.#x - this.#lineShort,
                y2: this.#y,
                stroke: ColorSchemes.Cursor.Active,
                lineWidth: ATTACK_CURSOR_CONSTANTS.LINE_WIDTH_PX
            });
            render('top', {
                shape: 'line',
                x1: this.#x + this.#lineShort,
                y1: this.#y,
                x2: this.#x + this.#lineLong,
                y2: this.#y,
                stroke: ColorSchemes.Cursor.Active,
                lineWidth: ATTACK_CURSOR_CONSTANTS.LINE_WIDTH_PX
            });
            render('top', {
                shape: 'line',
                x1: this.#x,
                y1: this.#y - this.#lineLong,
                x2: this.#x,
                y2: this.#y - this.#lineShort,
                stroke: ColorSchemes.Cursor.Active,
                lineWidth: ATTACK_CURSOR_CONSTANTS.LINE_WIDTH_PX
            });
            render('top', {
                shape: 'line',
                x1: this.#x,
                y1: this.#y + this.#lineShort,
                x2: this.#x,
                y2: this.#y + this.#lineLong,
                stroke: ColorSchemes.Cursor.Active,
                lineWidth: ATTACK_CURSOR_CONSTANTS.LINE_WIDTH_PX
            });
            shadowOff('top');
        }
    }

    /**
     * 커서를 초기화합니다.
     */
    init() { return Promise.resolve(); }
}
