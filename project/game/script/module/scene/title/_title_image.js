import { getWW, getWH, getUIWW, render } from 'display/display_system.js';
import { animate } from 'animation/animation_system.js';

/**
 * @class TitleImage
 * @description 타이틀 화면의 로고 및 메인 이미지를 관리하는 클래스입니다.
 */
export class TitleImage {
    /**
     * @param {TitleScene} TitleScene - 타이틀 씬 인스턴스
     */
    constructor(TitleScene) {
        this.TitleScene = TitleScene;
        this.image = new Image();
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this._magneticPoint = { x: 0, y: 0 };
        this.image.src = "image/title.png";
        const imageW = this._getImageWidth();
        this.imageX = -imageW;
        this.alpha = 0;
        animate(this, { variable: 'imageX', startValue: -imageW, endValue: this.UIWW * 0.1, type: "easeOutExpo", duration: 0.6 });
        animate(this, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.6 });
    }

    update() {
    }

    resize() {
        const prevUIWW = this.UIWW || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        const ratio = this.UIWW / Math.max(1, prevUIWW);
        this.imageX *= ratio;
    }

    draw() {
        const imageW = this._getImageWidth();
        const imageH = imageW * this.image.height / this.image.width;
        render('ui', {
            shape: 'image',
            image: this.image,
            x: this.imageX,
            y: this.WH / 2 - imageH / 2,
            w: imageW,
            h: imageH,
            alpha: this.alpha
        });
    }

    /**
     * 로고의 자석 효과 중심점을 반환합니다.
     * @returns {{x:number, y:number}} 자석 효과 중심점
     */
    getMagneticPoint() {
        const w = this._getImageWidth();
        this._magneticPoint.x = this.imageX + w;
        this._magneticPoint.y = this.WH / 2;
        return this._magneticPoint;
    }

    _getImageWidth() {
        return this.UIWW * 0.3;
    }
}
