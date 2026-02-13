import { getWW, getWH, render } from '../../display/_display_system.js';
import { animate } from '../../animation/_animation_system.js';
import { Vector2 } from '../../../util/vector2.js';

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
        this.image.src = "image/title.png";
        this.imageX = - this.WW * 0.3;
        this.alpha = 0;
        animate(this, { variable: 'imageX', startValue: -this.WW * 0.3, endValue: this.WW * 0.1, type: "easeOutExpo", duration: 0.6 });
        animate(this, { variable: 'alpha', startValue: 0, endValue: 1, type: "easeOutExpo", duration: 0.6 });
    }

    update() {
    }

    draw() {
        render('main', {
            shape: 'image',
            image: this.image,
            x: this.imageX,
            y: this.WH / 2 - this.WW * 0.3 * this.image.height / this.image.width / 2,
            w: this.WW * 0.3,
            h: this.WW * 0.3 * this.image.height / this.image.width,
            alpha: this.alpha
        });
    }

    /**
     * 로고의 자석 효과 중심점을 반환합니다.
     * @returns {Vector2} 자석 효과 중심점
     */
    getMagneticPoint() {
        const w = this.WW * 0.3;
        return new Vector2(this.imageX + w, this.WH / 2);
    }
}