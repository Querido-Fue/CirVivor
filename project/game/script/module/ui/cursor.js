
import { getWW, getWH, render, shadowOn, shadowOff } from '../display/_display_system.js';
import { getDelta } from '../../time_handler.js';
import { animate, remove } from '../animation/_animation_system.js';
import { getMouseInput } from '../input/_input_system.js';
import { ColorSchemes } from '../display/theme_handler.js';

export class Cursor {
    constructor() {
        this._x = 0;
        this._y = 0;

        this.WW = getWW();
        this.WH = getWH();
        this._defaultSubCircleRadius = this.WH * 0.015;
        this._subCircleRadius = this._defaultSubCircleRadius;
        this._defaultSubCircleAlpha = 0.5;
        this._subCircleAlpha = this._defaultSubCircleAlpha;
        this._lineLong = 8;
        this._lineShort = 3;
        this._type = 'normal'
        this._normalAnimTime = 0;
        this._attackAnimTime = 0;
        this._normalAnimDuration = 0.5;
        this._attackAnimDuration = 0.3;
        this._normalRadiusAnimId = -1;
        this._normalAlphaAnimId = -1;
        this._clicking = false;

    }

    /**
     * 커서 상태를 업데이트합니다.
     * 마우스 입력에 따라 애니메이션을 처리합니다.
     */
    update() {
        this._x = getMouseInput("x");
        this._y = getMouseInput("y");

        if (getMouseInput("leftClicking")) {
            if (this._type === 'normal') {
                if (!this._clicking) {
                    remove(this._normalRadiusAnimId);
                    remove(this._normalAlphaAnimId);
                    this._normalRadiusAnimId = animate(this, { variable: '_subCircleRadius', startValue: 'current', endValue: this._defaultSubCircleRadius * 0.7, type: "easeOutExpo", duration: this._normalAnimDuration - this._normalAnimTime }).id;
                    this._normalAlphaAnimId = animate(this, { variable: '_subCircleAlpha', startValue: 'current', endValue: this._defaultSubCircleAlpha * 1.5, type: "easeOutExpo", duration: this._normalAnimDuration - this._normalAnimTime }).id;
                }
                this._normalAnimTime += getDelta();
                if (this._normalAnimTime >= this._normalAnimDuration) {
                    this._normalAnimTime = this._normalAnimDuration;
                }
                this._clicking = true;
            }
            else if (this._type === 'attack') {
                //this.attackAnimLongId = Animator.addPersist(this, 'lineLong', 12, 8, "easeOutExpo", "easeOutExpo", duration);
                //this.attackAnimShortId = Animator.addPersist(this, 'lineShort', 7, 3, "easeOutExpo", "easeOutExpo", duration);
            }
        } else {
            if (this._type === 'normal') {
                if (this._clicking) {
                    remove(this._normalRadiusAnimId);
                    remove(this._normalAlphaAnimId);
                    this._normalRadiusAnimId = animate(this, { variable: '_subCircleRadius', startValue: 'current', endValue: this._defaultSubCircleRadius, type: "easeOutExpo", duration: this._normalAnimTime }).id;
                    this._normalAlphaAnimId = animate(this, { variable: '_subCircleAlpha', startValue: 'current', endValue: this._defaultSubCircleAlpha, type: "easeOutExpo", duration: this._normalAnimTime }).id;
                }
                this._normalAnimTime -= getDelta();
                if (this._normalAnimTime <= 0) {
                    this._normalAnimTime = 0;
                }
                this._clicking = false;
            }
            else if (this._type === 'attack') {
            }
        }
    }

    /**
     * 커서를 그립니다.
     */
    draw() {
        if (this._type === 'normal') {
            const angle = 330;
            const angleRad = angle * Math.PI / 180;
            const sizeBig = this.WH * 0.015;
            const offsetX1 = (sizeBig / 2) * Math.sin(angleRad);
            const offsetY1 = (-sizeBig / 2) * Math.cos(angleRad);
            render('top', {
                shape: 'arrow',
                x: this._x - offsetX1,
                y: this._y - offsetY1,
                w: sizeBig,
                h: sizeBig,
                rotation: angle,
                fill: ColorSchemes.Cursor.Fill
            });


            const sizeSmall = this.WH * 0.014;
            const offsetX2 = (sizeSmall / 2) * Math.sin(angleRad);
            const offsetY2 = (-sizeSmall / 2) * Math.cos(angleRad);
            render('top', {
                shape: 'arrow',
                x: this._x - offsetX2,
                y: this._y - offsetY2,
                w: sizeSmall,
                h: sizeSmall,
                rotation: angle,
                fill: ColorSchemes.Cursor.Active,
            });
            render('top', {
                shape: 'circle',
                x: this._x + this._subCircleRadius / 2 + this.WH * 0.01,
                y: this._y + this._subCircleRadius / 2 + this.WH * 0.02,
                radius: this._subCircleRadius,
                fill: ColorSchemes.Cursor.Active,
                alpha: this._subCircleAlpha
            });
        } else if (this._type === 'attack') {
            shadowOn('top', 10, ColorSchemes.Cursor.White);
            render('top', { shape: 'circle', x: this._x, y: this._y, radius: 2, fill: ColorSchemes.Cursor.Active });
            render('top', { shape: 'line', x1: this._x - this._lineLong, y1: this._y, x2: this._x - this._lineShort, y2: this._y, stroke: ColorSchemes.Cursor.Active, lineWidth: 1 });
            render('top', { shape: 'line', x1: this._x + this._lineShort, y1: this._y, x2: this._x + this._lineLong, y2: this._y, stroke: ColorSchemes.Cursor.Active, lineWidth: 1 });
            render('top', { shape: 'line', x1: this._x, y1: this._y - this._lineLong, x2: this._x, y2: this._y - this._lineShort, stroke: ColorSchemes.Cursor.Active, lineWidth: 1 });
            render('top', { shape: 'line', x1: this._x, y1: this._y + this._lineShort, x2: this._x, y2: this._y + this._lineLong, stroke: ColorSchemes.Cursor.Active, lineWidth: 1 });
            shadowOff('top');
        }
    }

    /**
     * 커서를 초기화합니다.
     */
    init() { return Promise.resolve(); }
}