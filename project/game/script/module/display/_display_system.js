import { ScreenHandler } from "./screen_handler.js";
import { DrawHandler } from "./draw_handler.js";

let displaySystemInstance = null;

export class DisplaySystem {
    constructor() {
        displaySystemInstance = this;
        this._screenHandler = new ScreenHandler();
        this.drawHandler = null;
    }

    /**
     * 디스플레이 시스템을 초기화합니다.
     * 캔버스 요소들을 가져오고 컨텍스트를 설정하며, 화면 크기를 맞춥니다.
     * @param {SaveSystem} saveSystem - 저장 시스템 (설정 접근용)
     */
    async init(saveSystem) {
        this.mainCanvas = document.getElementById("main");
        this.overlayCanvas = document.getElementById("overlay");
        this.topCanvas = document.getElementById("top");
        this.backgroundCanvas = document.getElementById("background");
        this.mainCanvas2 = document.getElementById("main2");
        this.overlayCanvas2 = document.getElementById("overlay2");
        this.topCanvas2 = document.getElementById("top2");
        this.backgroundCanvas2 = document.getElementById("background2");

        this.ctx = this.mainCanvas.getContext("2d");
        this.otx = this.overlayCanvas.getContext("2d");
        this.ttx = this.topCanvas.getContext("2d");
        this.btx = this.backgroundCanvas.getContext("2d");
        this.ctx2 = this.mainCanvas2.getContext("2d");
        this.otx2 = this.overlayCanvas2.getContext("2d");
        this.ttx2 = this.topCanvas2.getContext("2d");
        this.btx2 = this.backgroundCanvas2.getContext("2d");

        this.allCanvases = [
            this.mainCanvas, this.overlayCanvas, this.topCanvas, this.backgroundCanvas,
            this.mainCanvas2, this.overlayCanvas2, this.topCanvas2, this.backgroundCanvas2
        ];

        this.allContexts = {
            main: this.ctx, overlay: this.otx, top: this.ttx, background: this.btx,
            main2: this.ctx2, overlay2: this.otx2, top2: this.ttx2, background2: this.btx2,
        };
        this.drawHandler = new DrawHandler(this.allContexts);
        await this._screenHandler._init(saveSystem);

        // 캔버스 내부 해상도 고정
        for (const canvas of this.allCanvases) {
            canvas.width = this._screenHandler.width;
            canvas.height = this._screenHandler.height;
        }

        // 초기 CSS 적용
        this.resize();
    }

    resize() {
        this._screenHandler.resize();

        const style = {
            width: `${this._screenHandler.cssWidth}px`,
            height: `${this._screenHandler.cssHeight}px`,
            left: `${this._screenHandler.cssLeft}px`,
            top: `${this._screenHandler.cssTop}px`,
            position: 'absolute'
        };

        for (const canvas of this.allCanvases) {
            Object.assign(canvas.style, style);
        }
    }

    /**
     * 특정 캔버스에 블러 효과를 적용합니다.
     * @param {string} layerName - 블러를 적용할 레이어 이름
     * @param {number} blur - 블러 강도 (픽셀 단위)
     */
    applyBlur(layerName, blur) {
        switch (layerName) {
            case "background":
                this.backgroundCanvas.style.filter = 'blur(' + blur + 'px)';
                break;
            case "main":
                this.mainCanvas.style.filter = 'blur(' + blur + 'px)';
                break;
            case "overlay":
                this.overlayCanvas.style.filter = 'blur(' + blur + 'px)';
                break;
            case "top":
                this.topCanvas.style.filter = 'blur(' + blur + 'px)';
                break;
            case "background2":
                this.backgroundCanvas2.style.filter = 'blur(' + blur + 'px)';
                break;
            case "main2":
                this.mainCanvas2.style.filter = 'blur(' + blur + 'px)';
                break;
            case "overlay2":
                this.overlayCanvas2.style.filter = 'blur(' + blur + 'px)';
                break;
            case "top2":
                this.topCanvas2.style.filter = 'blur(' + blur + 'px)';
                break;
            default:
                console.error("Invalid canvas layer: " + layerName);
                break;
        }
    }
}

/**
 * 화면 너비(Window Width)를 반환합니다.
 * @returns {number} 화면 너비
 */
export const getWW = () => displaySystemInstance._screenHandler.width;
/**
 * 화면 높이(Window Height)를 반환합니다.
 * @returns {number} 화면 높이
 */
export const getWH = () => displaySystemInstance._screenHandler.height;
/**
 * 렌더 스케일 적용 전 기본 너비를 반환합니다.
 * @returns {number} 기본 너비
 */
export const getBaseWW = () => displaySystemInstance._screenHandler.baseWidth;
/**
 * 렌더 스케일 적용 전 기본 높이를 반환합니다.
 * @returns {number} 기본 높이
 */
export const getBaseWH = () => displaySystemInstance._screenHandler.baseHeight;
/**
 * 현재 스케일 비율을 반환합니다. (내부해상도 / CSS해상도)
 * @returns {number} 스케일 비율
 */
export const getScaleRatio = () => displaySystemInstance._screenHandler.scaleRatio;
/**
 * 캔버스의 CSS 오프셋(위치)을 반환합니다.
 * @returns {object} {x, y} 오프셋
 */
export const getCanvasOffset = () => ({ x: displaySystemInstance._screenHandler.cssLeft, y: displaySystemInstance._screenHandler.cssTop });
/**
 * 메인 캔버스(배경 컨텐츠가 있는) 요소를 반환합니다.
 * @returns {HTMLCanvasElement} 메인 캔버스
 */
export const getMainCanvas = () => displaySystemInstance.mainCanvas;
/**
 * 배경 캔버스 요소를 반환합니다.
 * @returns {HTMLCanvasElement} 배경 캔버스
 */
export const getBackgroundCanvas = () => displaySystemInstance.backgroundCanvas;

/**
 * 특정 레이어에 그리기 작업을 수행합니다.
 * @param {string} layerName - 레이어 이름 (main, overlay, top 등)
 * @param {object} options - 그리기 옵션 (형태, 좌표, 색상 등)
 */
export const render = (layerName, options) => displaySystemInstance.drawHandler.render(layerName, options);
/**
 * 특정 레이어에 그림자를 적용합니다.
 * @param {string} layerName - 레이어 이름
 * @param {number} blur - 그림자 블러 강도
 * @param {string} color - 그림자 색상
 */
export const shadowOn = (layerName, blur, color) => displaySystemInstance.drawHandler.shadowOn(layerName, blur, color);
/**
 * 특정 레이어의 그림자 효과를 끕니다.
 * @param {string} layerName - 레이어 이름
 */
export const shadowOff = (layerName) => displaySystemInstance.drawHandler.shadowOff(layerName);
/**
 * 특정 캔버스에 필터 블러를 적용합니다.
 * @param {string} layerName - 캔버스 레이어 이름
 * @param {number} blur - 블러 강도
 */
export const applyBlur = (layerName, blur) => displaySystemInstance.applyBlur(layerName, blur);

/**
 * 텍스트의 너비를 측정합니다.
 * @param {string} text - 측정할 텍스트
 * @param {string} font - 폰트 스타일
 * @returns {number} 텍스트 너비
 */
export const measureText = (text, font) => displaySystemInstance.drawHandler.measureText(text, font);
