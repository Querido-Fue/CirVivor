import { ScreenHandler } from "./screen_handler.js";
import { DrawHandler2D } from "./draw_handler_2d.js";
import { WebGLHandler } from "./webgl/webgl_handler.js";
import { ColorSchemes } from "display/theme_handler.js";
import { cssToRgb } from "util/color_util.js";

let displaySystemInstance = null;

export class DisplaySystem {
    constructor() {
        displaySystemInstance = this;
        this._screenHandler = new ScreenHandler();
        this.drawHandler = null;
        this.webGLHandler = null;
    }

    /**
     * 디스플레이 시스템을 초기화합니다.
     * 캔버스 요소들을 가져오고 컨텍스트를 설정하며, 화면 크기를 맞춥니다.
     * @param {SaveSystem} saveSystem - 저장 시스템 (설정 접근용)
     */
    async init(saveSystem) {
        // 1. Background (WebGL)
        this.backgroundCanvas = document.getElementById("background");
        this.glBackground = this.backgroundCanvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: true });

        // 2. Object (WebGL)
        this.objectCanvas = document.getElementById("object");
        this.glObject = this.objectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: true });

        // 3. Effect (WebGL)
        this.effectCanvas = document.getElementById("effect");
        this.glEffect = this.effectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: true });

        // 4. TextEffect (2D)
        this.textEffectCanvas = document.getElementById("texteffect");
        this.ctxTextEffect = this.textEffectCanvas.getContext("2d");

        // 5. UI (2D)
        this.uiCanvas = document.getElementById("ui");
        this.ctxUi = this.uiCanvas.getContext("2d");

        // 6. Overlay (2D)
        this.overlayCanvas = document.getElementById("overlay");
        this.ctxOverlay = this.overlayCanvas.getContext("2d");

        // 7. OverlayEffect (WebGL)
        this.overlayEffectCanvas = document.getElementById("overlayeffect");
        this.glOverlayEffect = this.overlayEffectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: true });

        // 8. OverlayHigh (2D)
        this.overlayHighCanvas = document.getElementById("overlayhigh");
        this.ctxOverlayHigh = this.overlayHighCanvas.getContext("2d");

        // 9. Top (2D)
        this.topCanvas = document.getElementById("top");
        this.ctxTop = this.topCanvas.getContext("2d");

        // Canvas Collections
        this.all2DCanvases = [
            this.textEffectCanvas,
            this.uiCanvas,
            this.overlayCanvas,
            this.overlayHighCanvas,
            this.topCanvas
        ];

        this.allGLCanvases = [
            this.backgroundCanvas,
            this.objectCanvas,
            this.effectCanvas,
            this.overlayEffectCanvas
        ];

        // 호환성 매핑 (전체 리팩토링 전까지 하위 호환성 유지)

        this.allContexts = {
            texteffect: this.ctxTextEffect,
            ui: this.ctxUi,
            overlay: this.ctxOverlay,
            overlayhigh: this.ctxOverlayHigh,
            top: this.ctxTop,
            // 레거시 매핑
            main: this.ctxUi,
            top: this.ctxTop
        };

        this.glContexts = {
            background: this.glBackground,
            object: this.glObject,
            effect: this.glEffect,
            overlayeffect: this.glOverlayEffect
        };

        this.drawHandler = new DrawHandler2D(this.allContexts);
        this.webGLHandler = new WebGLHandler(this.glContexts);

        // 초기 배경색 설정
        if (ColorSchemes.Background) {
            const rgb = cssToRgb(ColorSchemes.Background);
            this.webGLHandler.setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }

        await this._screenHandler._init(saveSystem);

        // 캔버스 내부 해상도 고정
        for (const canvas of this.allCanvases) {
            canvas.width = this._screenHandler.width;
            canvas.height = this._screenHandler.height;
        }

        // 초기 CSS 적용
        this.resize();
    }

    get allCanvases() {
        return [...this.all2DCanvases, ...this.allGLCanvases];
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

        if (this.webGLHandler) {
            this.webGLHandler.resize(this._screenHandler.width, this._screenHandler.height);
        }
    }

    /**
     * 화면을 지웁니다.
     */
    clear() {
        this._clearCanvas(this.ctxTextEffect);
        this._clearCanvas(this.ctxUi);
        this._clearCanvas(this.ctxOverlay);
        this._clearCanvas(this.ctxOverlayHigh);
        this._clearCanvas(this.ctxTop);

        // WebGL clearing is handled by WebGLHandler.begin()
    }

    _clearCanvas(ctx) {
        if (ctx) ctx.clearRect(0, 0, this.uiCanvas.width, this.uiCanvas.height);
    }

    /**
     * 특정 캔버스에 블러 효과를 적용합니다.
     * @param {string} layerName - 블러를 적용할 레이어 이름
     * @param {number} blur - 블러 강도 (픽셀 단위)
     */
    applyBlur(layerName, blur) {
        const canvasMap = {
            background: this.backgroundCanvas,
            object: this.objectCanvas,
            effect: this.effectCanvas,
            texteffect: this.textEffectCanvas,
            ui: this.uiCanvas,
            overlay: this.overlayCanvas,
            overlayeffect: this.overlayEffectCanvas,
            overlayhigh: this.overlayHighCanvas,
            top: this.topCanvas
        };

        const canvas = canvasMap[layerName];
        if (canvas) {
            canvas.style.filter = 'blur(' + blur + 'px)';
        } else {
            console.warn("Invalid canvas layer for blur: " + layerName);
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
 * 메인 WebGL 캔버스 요소를 반환합니다.
 * @returns {HTMLCanvasElement} 메인 WebGL 캔버스
 */
export const getMainGLCanvas = () => displaySystemInstance.objectCanvas; // Legacy support
export const getBackgroundGLCanvas = () => displaySystemInstance.backgroundCanvas; // Legacy support

export const getObjectCanvas = () => displaySystemInstance.objectCanvas;
export const getEffectCanvas = () => displaySystemInstance.effectCanvas;
export const getTextEffectCanvas = () => displaySystemInstance.textEffectCanvas;
export const getUiCanvas = () => displaySystemInstance.uiCanvas;
export const getOverlayCanvas = () => displaySystemInstance.overlayCanvas;
export const getOverlayEffectCanvas = () => displaySystemInstance.overlayEffectCanvas;
export const getOverlayHighCanvas = () => displaySystemInstance.overlayHighCanvas;
export const getTopCanvas = () => displaySystemInstance.topCanvas;

/**
 * 특정 레이어에 그리기 작업을 수행합니다.
 * @param {string} layerName - 레이어 이름 (main, overlay, top 등)
 * @param {object} options - 그리기 옵션 (형태, 좌표, 색상 등)
 */
export const render = (layerName, options) => displaySystemInstance.drawHandler.render(layerName, options);

/**
 * 특정 레이어를 WebGL로 렌더링합니다.
 * @param {string} layerName - 레이어 이름
 * @param {object} options - 그리기 옵션
 */
export const renderGL = (layerName, options) => {
    // Direct mapping now, but keeping function for extensibility/logging if needed.
    // Legacy mapping if any old code calls 'mainGL' etc.
    const glMapping = {
        'main': 'object',
        'mainGL': 'object',
        'backgroundGL': 'background',
        'overlayGL': 'overlayeffect',
        'effectGL': 'effect'
    };
    const targetLayer = glMapping[layerName] || layerName;

    if (displaySystemInstance.webGLHandler && displaySystemInstance.webGLHandler.batches[targetLayer]) {
        return displaySystemInstance.webGLHandler.render(targetLayer, options);
    }
    console.warn(`WebGL Layer not found: ${targetLayer} (original: ${layerName})`);
};
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
 * 배경 색상을 설정합니다.
 * @param {number} r - Red (0~1)
 * @param {number} g - Green (0~1)
 * @param {number} b - Blue (0~1)
 */
export const setBackgroundColor = (r, g, b) => {
    if (displaySystemInstance.webGLHandler) {
        displaySystemInstance.webGLHandler.setBackgroundColor(r, g, b);
    }
};

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

