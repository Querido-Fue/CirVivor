import { ScreenHandler } from './_screen_handler.js';
import { DrawHandler2D } from './_draw_handler_2d.js';
import { WebGLHandler } from './webgl/_webgl_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { ThemeHandler, setTheme } from 'display/_theme_handler.js';
import { getSetting } from 'save/save_system.js';
import { CanvasSurfacePool } from './_surface_pool.js';
import { VignetteRenderer } from './_vignette_renderer.js';

let displaySystemInstance = null;

/**
 * @typedef {object} DisplaySurfaceDescriptor
 * @property {string} id - surface 식별자입니다.
 * @property {'2d'|'webgl'} type - surface 타입입니다.
 * @property {'batch'|'overlay-effect'|'effect'} mode - WebGL 모드 또는 기본 모드입니다.
 * @property {HTMLCanvasElement} canvas - DOM 캔버스입니다.
 * @property {CanvasRenderingContext2D|WebGLRenderingContext|null} context - 연결된 컨텍스트입니다.
 * @property {number} order - 표시 순서입니다.
 * @property {boolean} dynamic - 동적 surface 여부입니다.
 * @property {boolean} persistent - 프레임 초기화에서 제외할 정적 surface 여부입니다.
 * @property {boolean} includeInComposite - blur 캡처 포함 여부입니다.
 * @property {number} compositeOpacityFactor - blur 캡처 시 적용할 opacity 배율입니다.
 */

/**
 * @class DisplaySystem
 * @description 정적 레이어와 동적 surface를 함께 관리하는 디스플레이 시스템입니다.
 */
export class DisplaySystem {
    constructor() {
        displaySystemInstance = this;
        this.screenHandler = new ScreenHandler();
        this.drawHandler = new DrawHandler2D();
        this.webGLHandler = new WebGLHandler();
        this.themeHandler = new ThemeHandler();

        this.surfaceMap = new Map();
        this.staticSurfaceIds = [];
        this.dynamicSurfaceIds = [];
        this.dynamicSequence = 0;
        this.dynamic2DPool = new CanvasSurfacePool('2d');
        this.dynamicWebGLPool = new CanvasSurfacePool('webgl');
        this.vignetteRenderer = new VignetteRenderer();
    }

    /**
     * 디스플레이 시스템을 초기화합니다.
     */
    async init() {
        await this.themeHandler.init();
        setTheme(getSetting('theme'));

        this.overlayLayerHost = document.getElementById('overlaylayerhost');

        this.#registerStaticSurface('background', 'background', 'webgl', { alpha: false, mode: 'batch' });
        this.#registerStaticSurface('object', 'object', 'webgl', { alpha: true, mode: 'batch' });
        this.#registerStaticSurface('effect', 'effect', 'webgl', { alpha: true, mode: 'effect' });
        this.#registerStaticSurface('texteffect', 'texteffect', '2d');
        this.#registerStaticSurface('ui', 'ui', '2d');
        this.#registerStaticSurface('vignette', 'vignette', '2d', {
            order: 50,
            includeInComposite: false,
            persistent: true
        });
        this.#registerStaticSurface('top', 'top', '2d', { includeInComposite: false });

        if (ColorSchemes.Background) {
            const rgb = colorUtil().cssToRgb(ColorSchemes.Background);
            this.webGLHandler.setBackgroundColor(rgb.r / 255, rgb.g / 255, rgb.b / 255);
        }

        await this.screenHandler.init();

        for (const descriptor of this.surfaceMap.values()) {
            descriptor.canvas.width = this.screenHandler.width;
            descriptor.canvas.height = this.screenHandler.height;
        }

        this.resize();
    }

    /**
     * 동적 surface를 생성합니다.
     * @param {{type: '2d'|'webgl', order: number, mode?: 'batch'|'overlay-effect'|'effect', includeInComposite?: boolean, compositeOpacityFactor?: number}} options - 생성 옵션입니다.
     * @returns {DisplaySurfaceDescriptor} 생성된 surface descriptor입니다.
     */
    createDynamicSurface(options) {
        const type = options.type === 'webgl' ? 'webgl' : '2d';
        const mode = options.mode || (type === 'webgl' ? 'overlay-effect' : 'batch');
        const pool = type === 'webgl' ? this.dynamicWebGLPool : this.dynamic2DPool;
        const entry = pool.acquire();
        const surfaceId = `dynamic:${type}:${++this.dynamicSequence}`;

        entry.canvas.width = this.screenHandler.width;
        entry.canvas.height = this.screenHandler.height;
        entry.canvas.dataset.surfaceId = surfaceId;

        const descriptor = {
            id: surfaceId,
            type,
            mode,
            canvas: entry.canvas,
            context: entry.context,
            order: options.order,
            sequence: this.dynamicSequence,
            dynamic: true,
            persistent: false,
            includeInComposite: options.includeInComposite !== false,
            compositeOpacityFactor: Number.isFinite(options.compositeOpacityFactor)
                ? Math.max(0, options.compositeOpacityFactor)
                : 1
        };

        this.surfaceMap.set(surfaceId, descriptor);
        this.dynamicSurfaceIds.push(surfaceId);
        this.#registerDescriptor(descriptor);
        this.#applyCanvasStyle(descriptor);
        this.#syncDynamicHostOrder();
        return descriptor;
    }

    /**
     * 동적 surface를 회수합니다.
     * @param {string} surfaceId - 회수할 surface 식별자입니다.
     */
    releaseDynamicSurface(surfaceId) {
        const descriptor = this.surfaceMap.get(surfaceId);
        if (!descriptor || !descriptor.dynamic) {
            return;
        }

        this.#unregisterDescriptor(descriptor);
        this.surfaceMap.delete(surfaceId);
        this.dynamicSurfaceIds = this.dynamicSurfaceIds.filter((id) => id !== surfaceId);

        if (descriptor.canvas.parentNode === this.overlayLayerHost) {
            this.overlayLayerHost.removeChild(descriptor.canvas);
        }

        const pool = descriptor.type === 'webgl' ? this.dynamicWebGLPool : this.dynamic2DPool;
        pool.release({ canvas: descriptor.canvas, context: descriptor.context });
    }

    /**
     * surface descriptor를 반환합니다.
     * @param {string} surfaceId - 조회할 surface 식별자입니다.
     * @returns {DisplaySurfaceDescriptor|null} 조회 결과입니다.
     */
    getSurface(surfaceId) {
        return this.surfaceMap.get(surfaceId) || null;
    }

    /**
     * 현재 등록된 모든 캔버스를 순서대로 반환합니다.
     * @returns {HTMLCanvasElement[]} 캔버스 목록입니다.
     */
    getAllCanvases() {
        return this.#getSortedSurfaceDescriptors()
            .map((descriptor) => descriptor.canvas);
    }

    /**
     * 동적 캔버스 풀 사용 현황을 반환합니다.
     * @returns {{twoD: {activeCount: number, createdCount: number, availableCount: number}, webgl: {activeCount: number, createdCount: number, availableCount: number}}} 캔버스 풀 통계입니다.
     */
    getCanvasPoolStats() {
        let active2DCount = 0;
        let activeWebGLCount = 0;

        for (const descriptor of this.surfaceMap.values()) {
            if (!descriptor.dynamic) {
                continue;
            }

            if (descriptor.type === 'webgl') {
                activeWebGLCount += 1;
                continue;
            }

            active2DCount += 1;
        }

        const twoDStats = this.dynamic2DPool.getStats();
        const webGLStats = this.dynamicWebGLPool.getStats();

        return {
            twoD: {
                activeCount: active2DCount,
                createdCount: twoDStats.createdCount,
                availableCount: twoDStats.availableCount
            },
            webgl: {
                activeCount: activeWebGLCount,
                createdCount: webGLStats.createdCount,
                availableCount: webGLStats.availableCount
            }
        };
    }

    /**
     * 동적 캔버스 풀을 미리 워밍업합니다.
     * @param {number} twoDCount - 2D surface 풀 사전 생성 개수입니다.
     * @param {number} webGLCount - WebGL surface 풀 사전 생성 개수입니다.
     */
    warmupCanvasPools(twoDCount, webGLCount) {
        this.dynamic2DPool.warmUp(twoDCount);
        this.dynamicWebGLPool.warmUp(webGLCount);
    }

    /**
     * 특정 surface보다 아래에 있는 합성 소스를 반환합니다.
     * @param {string} surfaceId - 기준 surface 식별자입니다.
     * @returns {Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number}>} 합성 소스 목록입니다.
     */
    getCompositeSourcesBeforeSurface(surfaceId) {
        const target = this.surfaceMap.get(surfaceId);
        if (!target) {
            return [];
        }

        const sources = [];
        for (const descriptor of this.#getSortedSurfaceDescriptors()) {
            if (!descriptor.includeInComposite || descriptor.id === target.id) {
                continue;
            }
            if (!descriptor.dynamic || descriptor.order < target.order) {
                if (!descriptor.dynamic && descriptor.id === 'top') {
                    continue;
                }
                if (descriptor.dynamic && descriptor.order >= target.order) {
                    continue;
                }
                sources.push({
                    kind: 'canvas',
                    canvas: descriptor.canvas,
                    opacity: (descriptor.dynamic
                        ? Number.parseFloat(descriptor.canvas.style.opacity || '1')
                        : 1) * descriptor.compositeOpacityFactor
                });
            }
        }

        return sources;
    }

    /**
     * overlay effect blur 캐시를 무효화합니다.
     * @param {string} surfaceId - 대상 effect surface 식별자입니다.
     */
    markOverlayEffectDirty(surfaceId) {
        this.webGLHandler.markDirty(surfaceId);
    }

    /**
     * 화면 크기 변경을 반영합니다.
     */
    resize() {
        const renderTargetChanged = this.screenHandler.resize();

        if (renderTargetChanged) {
            for (const descriptor of this.surfaceMap.values()) {
                descriptor.canvas.width = this.screenHandler.width;
                descriptor.canvas.height = this.screenHandler.height;
            }
        }

        for (const descriptor of this.surfaceMap.values()) {
            this.#applyCanvasStyle(descriptor);
        }

        if (this.overlayLayerHost) {
            Object.assign(this.overlayLayerHost.style, {
                left: `${this.screenHandler.cssLeft}px`,
                top: `${this.screenHandler.cssTop}px`,
                width: `${this.screenHandler.cssWidth}px`,
                height: `${this.screenHandler.cssHeight}px`
            });
        }

        if (this.webGLHandler) {
            this.webGLHandler.resize(this.screenHandler.width, this.screenHandler.height);
        }

        if (this.vignetteRenderer) {
            this.vignetteRenderer.resize(
                this.screenHandler.width,
                this.screenHandler.height
            );
        }
    }

    /**
     * 현재 프레임의 비네팅 레이어를 렌더링합니다.
     */
    drawVignettes() {
        if (!this.vignetteRenderer) {
            return;
        }

        this.vignetteRenderer.draw(this.drawHandler);
    }

    /**
     * @private
     * 정적 surface를 등록합니다.
     * @param {string} surfaceId - 등록할 식별자입니다.
     * @param {string} domId - 연결할 DOM id입니다.
     * @param {'2d'|'webgl'} type - surface 타입입니다.
     * @param {{alpha?: boolean, mode?: 'batch'|'overlay-effect'|'effect', includeInComposite?: boolean, compositeOpacityFactor?: number, order?: number, persistent?: boolean}} [options] - 옵션입니다.
     */
    #registerStaticSurface(surfaceId, domId, type, options = {}) {
        const canvas = document.getElementById(domId);
        const context = type === 'webgl'
            ? canvas.getContext('webgl', { alpha: options.alpha !== false, preserveDrawingBuffer: false })
            : canvas.getContext('2d');

        const orderMap = {
            background: 0,
            object: 10,
            effect: 20,
            texteffect: 30,
            ui: 40,
            top: 1000
        };

        const descriptor = {
            id: surfaceId,
            type,
            mode: options.mode || (type === 'webgl' ? 'batch' : 'batch'),
            canvas,
            context,
            order: Number.isFinite(options.order) ? options.order : (orderMap[surfaceId] || 0),
            dynamic: false,
            persistent: options.persistent === true,
            includeInComposite: options.includeInComposite !== false,
            compositeOpacityFactor: Number.isFinite(options.compositeOpacityFactor)
                ? Math.max(0, options.compositeOpacityFactor)
                : 1
        };

        this.surfaceMap.set(surfaceId, descriptor);
        this.staticSurfaceIds.push(surfaceId);
        this.#registerDescriptor(descriptor);
    }

    /**
     * @private
     * descriptor를 각 핸들러에 등록합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 등록할 descriptor입니다.
     */
    #registerDescriptor(descriptor) {
        if (descriptor.type === '2d') {
            this.drawHandler.registerLayer(descriptor.id, descriptor.context, {
                persistent: descriptor.persistent === true
            });
            return;
        }

        this.webGLHandler.registerLayer(descriptor.id, descriptor.context, { mode: descriptor.mode });
    }

    /**
     * @private
     * descriptor를 각 핸들러에서 해제합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 해제할 descriptor입니다.
     */
    #unregisterDescriptor(descriptor) {
        if (descriptor.type === '2d') {
            this.drawHandler.unregisterLayer(descriptor.id);
            return;
        }

        this.webGLHandler.unregisterLayer(descriptor.id);
    }

    /**
     * @private
     * 캔버스 CSS 스타일을 현재 화면 상태에 맞춥니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 스타일을 적용할 surface descriptor입니다.
     */
    #applyCanvasStyle(descriptor) {
        const canvas = descriptor.canvas;
        const left = descriptor.dynamic ? 0 : this.screenHandler.cssLeft;
        const top = descriptor.dynamic ? 0 : this.screenHandler.cssTop;

        Object.assign(canvas.style, {
            width: `${this.screenHandler.cssWidth}px`,
            height: `${this.screenHandler.cssHeight}px`,
            left: `${left}px`,
            top: `${top}px`,
            position: 'absolute'
        });
    }

    /**
     * @private
     * 동적 host 내부의 DOM 순서를 surface order와 맞춥니다.
     */
    #syncDynamicHostOrder() {
        if (!this.overlayLayerHost) {
            return;
        }

        const dynamicDescriptors = this.dynamicSurfaceIds
            .map((id) => this.surfaceMap.get(id))
            .filter(Boolean)
            .sort((left, right) => {
                if (left.order !== right.order) {
                    return left.order - right.order;
                }
                return (left.sequence || 0) - (right.sequence || 0);
            });

        for (const descriptor of dynamicDescriptors) {
            descriptor.canvas.style.zIndex = `${descriptor.order}`;
            this.overlayLayerHost.appendChild(descriptor.canvas);
        }
    }

    /**
     * @private
     * 순서 기준으로 정렬된 descriptor 목록을 반환합니다.
     * @returns {DisplaySurfaceDescriptor[]} 정렬된 descriptor 목록입니다.
     */
    #getSortedSurfaceDescriptors() {
        return Array.from(this.surfaceMap.values()).sort((left, right) => {
            const leftGroup = this.#getSurfaceSortGroup(left);
            const rightGroup = this.#getSurfaceSortGroup(right);
            if (leftGroup !== rightGroup) {
                return leftGroup - rightGroup;
            }

            if (left.order !== right.order) {
                return left.order - right.order;
            }

            return (left.sequence || 0) - (right.sequence || 0);
        });
    }

    /**
     * @private
     * surface의 정렬 그룹을 반환합니다.
     * @param {DisplaySurfaceDescriptor} descriptor - 평가할 descriptor입니다.
     * @returns {number} 정렬 그룹 값입니다.
     */
    #getSurfaceSortGroup(descriptor) {
        if (descriptor.id === 'top') {
            return 2;
        }
        if (descriptor.dynamic) {
            return 1;
        }
        return 0;
    }
}

/**
 * 현재 DisplaySystem 인스턴스를 반환합니다.
 * @returns {DisplaySystem|null} DisplaySystem 인스턴스입니다.
 */
export const getDisplaySystem = () => displaySystemInstance;

/**
 * 화면 너비를 반환합니다.
 * @returns {number} 내부 렌더 해상도 너비입니다.
 */
export const getWW = () => displaySystemInstance.screenHandler.width;

/**
 * 화면 높이를 반환합니다.
 * @returns {number} 내부 렌더 해상도 높이입니다.
 */
export const getWH = () => displaySystemInstance.screenHandler.height;

/**
 * 오브젝트 기준 높이를 반환합니다.
 * @returns {number} 오브젝트 기준 높이입니다.
 */
export const getObjectWH = () => displaySystemInstance.screenHandler.objectHeight;

/**
 * 오브젝트 Y 오프셋을 반환합니다.
 * @returns {number} 오브젝트 오프셋입니다.
 */
export const getObjectOffsetY = () => displaySystemInstance.screenHandler.objectOffsetY;

/**
 * UI 기준 너비를 반환합니다.
 * @returns {number} UI 기준 너비입니다.
 */
export const getUIWW = () => displaySystemInstance.screenHandler.uiWidth;

/**
 * UI 기준 X 오프셋을 반환합니다.
 * @returns {number} UI 기준 X 오프셋입니다.
 */
export const getUIOffsetX = () => displaySystemInstance.screenHandler.uiOffsetX;

/**
 * 기본 렌더 너비를 반환합니다.
 * @returns {number} 기본 렌더 너비입니다.
 */
export const getBaseWW = () => displaySystemInstance.screenHandler.baseWidth;

/**
 * 기본 렌더 높이를 반환합니다.
 * @returns {number} 기본 렌더 높이입니다.
 */
export const getBaseWH = () => displaySystemInstance.screenHandler.baseHeight;

/**
 * 화면 스케일 비율을 반환합니다.
 * @returns {number} 내부 해상도 대비 CSS 해상도 비율입니다.
 */
export const getScaleRatio = () => displaySystemInstance.screenHandler.scaleRatio;

/**
 * 캔버스 CSS 오프셋을 반환합니다.
 * @returns {{x: number, y: number}} 캔버스 오프셋입니다.
 */
export const getCanvasOffset = () => ({
    x: displaySystemInstance.screenHandler.cssLeft,
    y: displaySystemInstance.screenHandler.cssTop
});

/**
 * 특정 레이어에 2D 렌더 명령을 실행합니다.
 * @param {string} layerName - 대상 레이어 식별자입니다.
 * @param {object} options - 렌더링 옵션입니다.
 */
export const render = (layerName, options) => displaySystemInstance.drawHandler.render(layerName, options);

/**
 * 특정 레이어에 WebGL 렌더 명령을 실행합니다.
 * @param {string} layerName - 대상 레이어 식별자입니다.
 * @param {object} options - 렌더링 옵션입니다.
 */
export const renderGL = (layerName, options) => {
    const glMapping = {
        main: 'object',
        mainGL: 'object',
        backgroundGL: 'background',
        effectGL: 'effect'
    };
    const targetLayer = glMapping[layerName] || layerName;
    displaySystemInstance.webGLHandler.render(targetLayer, options);
};

/**
 * 레이어의 지속 그림자를 켭니다.
 * @param {string} layerName - 레이어 식별자입니다.
 * @param {number} blur - 그림자 블러입니다.
 * @param {string} color - 그림자 색상입니다.
 */
export const shadowOn = (layerName, blur, color) => displaySystemInstance.drawHandler.shadowOn(layerName, blur, color);

/**
 * 레이어의 지속 그림자를 끕니다.
 * @param {string} layerName - 레이어 식별자입니다.
 */
export const shadowOff = (layerName) => displaySystemInstance.drawHandler.shadowOff(layerName);

/**
 * 배경 색상을 변경합니다.
 * @param {number} r - red 채널입니다.
 * @param {number} g - green 채널입니다.
 * @param {number} b - blue 채널입니다.
 */
export const setBackgroundColor = (r, g, b) => displaySystemInstance.webGLHandler.setBackgroundColor(r, g, b);

/**
 * 텍스트 너비를 측정합니다.
 * @param {string} text - 측정할 문자열입니다.
 * @param {string} font - 사용할 폰트입니다.
 * @returns {number} 측정된 너비입니다.
 */
export const measureText = (text, font) => displaySystemInstance.drawHandler.measureText(text, font);

/**
 * 캔버스 요소를 반환합니다.
 * @param {string} layerName - 조회할 레이어 식별자입니다.
 * @returns {HTMLCanvasElement|null} 해당 레이어의 캔버스입니다.
 */
export const getCanvas = (layerName) => displaySystemInstance.surfaceMap.get(layerName)?.canvas || null;

/**
 * 동적 캔버스 풀 통계를 반환합니다.
 * @returns {{twoD: {activeCount: number, createdCount: number, availableCount: number}, webgl: {activeCount: number, createdCount: number, availableCount: number}}} 캔버스 풀 통계입니다.
 */
export const getCanvasPoolStats = () => displaySystemInstance
    ? displaySystemInstance.getCanvasPoolStats()
    : {
        twoD: { activeCount: 0, createdCount: 0, availableCount: 0 },
        webgl: { activeCount: 0, createdCount: 0, availableCount: 0 }
    };
