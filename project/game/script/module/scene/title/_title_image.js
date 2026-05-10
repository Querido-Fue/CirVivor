import { getWW, getWH, getUIWW, render } from 'display/display_system.js';
import { animate } from 'animation/animation_system.js';
import { getData } from 'data/data_handler.js';
import { clampFiniteNumber } from 'util/number_util.js';

const TITLE_CONSTANTS = getData('TITLE_CONSTANTS');

/**
 * @class TitleImage
 * @description 타이틀 화면의 로고 및 메인 이미지를 관리하는 클래스입니다.
 */
export class TitleImage {
    #magneticPoint;

    /**
     * @param {TitleScene} TitleScene - 타이틀 씬 인스턴스
     */
    constructor(TitleScene) {
        this.TitleScene = TitleScene;
        this.image = new Image();
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        this.#magneticPoint = { x: 0, y: 0 };
        this.image.src = TITLE_CONSTANTS.TITLE_IMAGE.SRC;
        const imageW = this.#getImageWidth();
        this.imageX = -imageW;
        this.alpha = 0;
        animate(this, {
            variable: 'imageX',
            startValue: -imageW,
            endValue: this.UIWW * TITLE_CONSTANTS.TITLE_IMAGE.ENTER_X_RATIO,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_IMAGE.ENTER_DURATION
        });
        animate(this, {
            variable: 'alpha',
            startValue: 0,
            endValue: 1,
            type: "easeOutExpo",
            duration: TITLE_CONSTANTS.TITLE_IMAGE.ENTER_ALPHA_DURATION
        });
    }

    /**
     * 프레임별 타이틀 이미지 갱신 로직입니다.
     */
    update() {
    }

    /**
     * 화면 크기 변경 시 타이틀 스케일 및 X좌표를 보정합니다.
     */
    resize() {
        const prevUIWW = this.UIWW || 1;
        this.WW = getWW();
        this.WH = getWH();
        this.UIWW = getUIWW();
        const ratio = this.UIWW / clampFiniteNumber(Number(prevUIWW), 1, Infinity, 1);
        this.imageX *= ratio;
    }

    /**
     * 타이틀 이미지를 캔버스 UI 레이어에 렌더링합니다.
     */
    draw() {
        const imageW = this.#getImageWidth();
        const imageAspectRatio = this.image.width > 0
            ? this.image.height / this.image.width
            : 0;
        const imageH = imageW * imageAspectRatio;
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
        const w = this.#getImageWidth();
        this.#magneticPoint.x = this.imageX + w;
        this.#magneticPoint.y = this.WH / 2;
        return this.#magneticPoint;
    }

    /**
     * 현재 UI 폭 기준 타이틀 이미지 너비를 반환합니다.
     * @returns {number} 타이틀 이미지 렌더 너비입니다.
     */
    #getImageWidth() {
        return this.UIWW * TITLE_CONSTANTS.TITLE_IMAGE.WIDTH_RATIO;
    }
}
