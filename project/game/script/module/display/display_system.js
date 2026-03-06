import { ScreenHandler } from "./_screen_handler.js";
import { DrawHandler2D } from "./_draw_handler_2d.js";
import { WebGLHandler } from "./webgl/_webgl_handler.js";
import { ColorSchemes } from "display/_theme_handler.js";
import { colorUtil } from "util/color_util.js";
import { ThemeHandler, setTheme } from "display/_theme_handler.js";
import { getSetting } from "save/save_system.js";
import { initBlurCanvas } from "./_blur_canvas.js";

let displaySystemInstance = null;

/**
 * @class DisplaySystem
 * @description 캔버스/컨텍스트 초기화, 화면 리사이즈, 2D·WebGL 렌더 호출을 통합 관리합니다.
 */
export class DisplaySystem {
    constructor() {
        displaySystemInstance = this;
        this.screenHandler = new ScreenHandler();
        this.drawHandler = null;
        this.webGLHandler = null;
        this.themeHandler = new ThemeHandler();
    }

    /**
     * 디스플레이 시스템을 초기화합니다.
     * 캔버스 요소들을 가져오고 컨텍스트를 설정하며, 화면 크기를 맞춥니다.
     */
    async init() {
        // 테마 핸들러 초기화
        await this.themeHandler.init();
        setTheme(getSetting("theme")); // 로드된 설정값 기준으로 최종 테마 적용

        // 1. Background (WebGL)
        this.backgroundCanvas = document.getElementById("background");
        this.glBackground = this.backgroundCanvas.getContext("webgl", { alpha: false, preserveDrawingBuffer: false });

        // 2. Object (WebGL)
        this.objectCanvas = document.getElementById("object");
        this.glObject = this.objectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: false });

        // 3. Effect (WebGL)
        this.effectCanvas = document.getElementById("effect");
        this.glEffect = this.effectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: false });

        // 4. TextEffect (2D)
        this.textEffectCanvas = document.getElementById("texteffect");
        this.ctxTextEffect = this.textEffectCanvas.getContext("2d");

        // 5. UI (2D)
        this.uiCanvas = document.getElementById("ui");
        this.ctxUi = this.uiCanvas.getContext("2d");

        // 6. Overlay (2D)
        this.overlayCanvas = document.getElementById("overlay");
        this.ctxOverlay = this.overlayCanvas.getContext("2d");
        this.overlayDim = document.getElementById("overlaydim");

        // 7. OverlayEffect (WebGL)
        this.overlayEffectCanvas = document.getElementById("overlayeffect");
        this.glOverlayEffect = this.overlayEffectCanvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: false });

        // 8. Popup (2D) - 게임 종료 확인 및 토스트 알림 팝업
        this.popupCanvas = document.getElementById("popup");
        this.ctxPopup = this.popupCanvas.getContext("2d");
        this.popupDim = document.getElementById("popupdim");

        // 9. Top (2D) - 마우스 커서, 디버그 정보
        this.topCanvas = document.getElementById("top");
        this.ctxTop = this.topCanvas.getContext("2d");

        // 캔버스 컬렉션 구성

        this.canvasMap = {
            background: { type: "webgl", canvas: this.backgroundCanvas, context: this.glBackground },
            object: { type: "webgl", canvas: this.objectCanvas, context: this.glObject },
            effect: { type: "webgl", canvas: this.effectCanvas, context: this.glEffect },
            texteffect: { type: "2d", canvas: this.textEffectCanvas, context: this.ctxTextEffect },
            ui: { type: "2d", canvas: this.uiCanvas, context: this.ctxUi },
            overlay: { type: "2d", canvas: this.overlayCanvas, context: this.ctxOverlay },
            overlayeffect: { type: "webgl", canvas: this.overlayEffectCanvas, context: this.glOverlayEffect },
            popup: { type: "2d", canvas: this.popupCanvas, context: this.ctxPopup },
            top: { type: "2d", canvas: this.topCanvas, context: this.ctxTop }
        };

        this.all2DCanvases = Object.values(this.canvasMap)
            .filter(canvas => canvas.type === "2d")
            .map(canvas => canvas.canvas);

        this.allGLCanvases = Object.values(this.canvasMap)
            .filter(canvas => canvas.type === "webgl")
            .map(canvas => canvas.canvas);

        this.allCanvases = Object.values(this.canvasMap)
            .map(canvas => canvas.canvas);

        this.all2DContexts = Object.fromEntries(
            Object.entries(this.canvasMap)
                .filter(([key, val]) => val.type === "2d")
                .map(([key, val]) => [key, val.context])
        );

        this.allGLContexts = Object.fromEntries(
            Object.entries(this.canvasMap)
                .filter(([key, val]) => val.type === "webgl")
                .map(([key, val]) => [key, val.context])
        );

        this.drawHandler = new DrawHandler2D(this.all2DContexts);
        this.webGLHandler = new WebGLHandler(this.allGLContexts);

        // 초기 배경색 설정
        if (ColorSchemes.Background) {
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
            this.webGLHandler.setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }

        await this.screenHandler.init();

        // 캔버스 내부 해상도 고정
        for (const canvas of this.allCanvases) {
            canvas.width = this.screenHandler.width;
            canvas.height = this.screenHandler.height;
        }

        initBlurCanvas(this.screenHandler.width, this.screenHandler.height);

        // 초기 CSS 적용
        this.resize();
    }

    /**
     * 모든 캔버스 요소의 배열을 반환합니다.
     * @returns {HTMLCanvasElement[]}
     */
    getAllCanvases() {
        return this.allCanvases;
    }

    /**
     * 특정 레이어보다 아래에 있는 캔버스 목록을 반환합니다. (GlassRect 합성용)
     * @param {string} layerName - 기준 레이어 이름
     * @returns {HTMLCanvasElement[]} 해당 레이어보다 아래 캔버스 배열
     */
    getBehindCanvases(layerName) {
        const targetCanvas = this.canvasMap[layerName]?.canvas;
        const index = this.allCanvases.indexOf(targetCanvas);
        if (index <= 0) return [];
        return this.allCanvases.slice(0, index);
    }

    /**
     * 화면 크기에 맞게 모든 캔버스의 CSS 스타일을 갱신합니다.
     */
    resize() {
        const renderTargetChanged = this.screenHandler.resize();

        if (renderTargetChanged) {
            for (const canvas of this.allCanvases) {
                canvas.width = this.screenHandler.width;
                canvas.height = this.screenHandler.height;
            }
            initBlurCanvas(this.screenHandler.width, this.screenHandler.height);
        }

        const style = {
            width: `${this.screenHandler.cssWidth}px`,
            height: `${this.screenHandler.cssHeight}px`,
            left: `${this.screenHandler.cssLeft}px`,
            top: `${this.screenHandler.cssTop}px`,
            position: 'absolute'
        };

        for (const canvas of this.allCanvases) {
            Object.assign(canvas.style, style);
        }

        if (this.webGLHandler) {
            this.webGLHandler.resize(this.screenHandler.width, this.screenHandler.height);
        }
    }

    /**
     * 특정 캔버스에 블러 효과를 적용합니다.
     * @param {string} layerName - 블러를 적용할 레이어 이름
     * @param {number} blur - 블러 강도 (픽셀 단위)
     */
    applyBlur(layerName, blur) {
        const canvas = this.canvasMap[layerName].canvas;
        if (canvas) {
            canvas.style.filter = 'blur(' + blur + 'px)';
        } else {
            console.warn('블러를 적용할 수 없습니다. 유효하지 않은 캔버스 레이어: ' + layerName);
        }
    }
}

/**
 * 화면 너비(Window Width)를 반환합니다.
 * @returns {number} 화면 너비
 */
export const getWW = () => displaySystemInstance.screenHandler.width;
/**
 * 화면 높이(Window Height)를 반환합니다.
 * @returns {number} 화면 높이
 */
export const getWH = () => displaySystemInstance.screenHandler.height;
/**
 * 오브젝트(월드) 렌더링 기준 높이를 반환합니다.
 * 와이드 화면에서는 16:9 기준 높이로 계산됩니다.
 * @returns {number} 오브젝트 기준 높이
 */
export const getObjectWH = () => displaySystemInstance.screenHandler.objectHeight;
/**
 * 오브젝트 레이어 렌더링 시 중앙 크롭을 위한 Y 오프셋을 반환합니다.
 * @returns {number} 오브젝트 Y 오프셋
 */
export const getObjectOffsetY = () => displaySystemInstance.screenHandler.objectOffsetY;
/**
 * UI 크기 계산에 사용하는 16:9 기준 너비를 반환합니다.
 * @returns {number} UI 기준 너비
 */
export const getUIWW = () => displaySystemInstance.screenHandler.uiWidth;
/**
 * UI 기준 영역의 X 오프셋을 반환합니다.
 * @returns {number} UI 기준 영역 X 시작점
 */
export const getUIOffsetX = () => displaySystemInstance.screenHandler.uiOffsetX;
/**
 * 렌더 스케일 적용 전 기본 너비를 반환합니다.
 * @returns {number} 기본 너비
 */
export const getBaseWW = () => displaySystemInstance.screenHandler.baseWidth;
/**
 * 렌더 스케일 적용 전 기본 높이를 반환합니다.
 * @returns {number} 기본 높이
 */
export const getBaseWH = () => displaySystemInstance.screenHandler.baseHeight;
/**
 * 현재 스케일 비율을 반환합니다. (내부해상도 / CSS해상도)
 * @returns {number} 스케일 비율
 */
export const getScaleRatio = () => displaySystemInstance.screenHandler.scaleRatio;
/**
 * 캔버스의 CSS 오프셋(위치)을 반환합니다.
 * @returns {object} {x, y} 오프셋
 */
export const getCanvasOffset = () => ({ x: displaySystemInstance.screenHandler.cssLeft, y: displaySystemInstance.screenHandler.cssTop });
/**
 * 배경 캔버스 요소를 반환합니다.
 * @returns {HTMLCanvasElement} 배경 캔버스
 */
export const getBehindCanvases = (layerName) => displaySystemInstance.getBehindCanvases(layerName);

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
    // 현재는 직접 매핑이지만, 확장성/로깅을 위해 매핑 함수를 유지합니다.
    // 과거 코드에서 'mainGL' 등을 호출하는 경우를 호환합니다.
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
    console.warn(`WebGL 레이어를 찾을 수 없습니다: ${targetLayer} (원래 레이어: ${layerName})`);
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

/**
 * 특정 레이어의 캔버스를 가져옵니다.
 * @param {string} layerName - 레이어 이름
 * @returns {HTMLCanvasElement} 캔버스 요소
 */
export const getCanvas = (layerName) => displaySystemInstance.canvasMap[layerName].canvas;

/**
 * 특정 dim 레이어의 반투명도를 설정합니다.
 * @param {'overlay'|'popup'} layer - dim 레이어 이름
 * @param {number} opacity - 불투명도 (0~1)
 */
export const setDim = (layer, opacity) => {
    switch (layer) {
        case 'overlay':
            displaySystemInstance.overlayDim.style.opacity = opacity;
            break;
        case 'popup':
            displaySystemInstance.popupDim.style.opacity = opacity;
            break;
        default:
            console.warn(`레이어 Dim 설정 중 오류가 발생했습니다. ${layer} 레이어가 없습니다.`);
            break;
    }
};
