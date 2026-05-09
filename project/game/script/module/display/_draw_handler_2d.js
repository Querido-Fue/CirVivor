import {
    createDrawArrowPath,
    renderDrawArrow,
    renderDrawCircle,
    renderDrawImage,
    renderDrawLine,
    renderDrawRect,
    renderDrawRoundRect,
    renderDrawText
} from './draw_2d_shapes.js';
import {
    applyDraw2DStyles,
    applyDrawLayerTransform,
    createDrawShadowState,
    normalizeDrawLayerTransform,
    resetDrawContextState
} from './draw_2d_layer_state.js';

/**
 * @class DrawHandler2D
 * @description 2D 캔버스 레이어를 동적으로 등록하고 그리기 상태를 관리합니다.
 */
export class DrawHandler2D {
    #contexts;
    #stateCaches;
    #shadowState;
    #pathCache;
    #measureCtx;
    #layerOptions;
    #layerTransforms;

    /**
     * @param {Object.<string, CanvasRenderingContext2D>} contexts - 초기 레이어 컨텍스트 맵입니다.
     */
    constructor(contexts = {}) {
        this.#contexts = new Map();
        this.#stateCaches = new Map();
        this.#shadowState = new Map();
        this.#pathCache = new Map();
        this.#layerOptions = new Map();
        this.#layerTransforms = new Map();

        this.#generatePaths();

        const measureCanvas = document.createElement('canvas');
        this.#measureCtx = measureCanvas.getContext('2d');

        for (const [layerName, context] of Object.entries(contexts)) {
            this.registerLayer(layerName, context);
        }
    }

    /**
     * 레이어를 등록합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 연결할 2D 컨텍스트입니다.
     * @param {{persistent?: boolean, transformScaleX?: number, transformScaleY?: number}} [options={}] - 레이어 동작 옵션입니다.
     */
    registerLayer(layerName, context, options = {}) {
        if (!layerName || !context) {
            return;
        }

        this.#contexts.set(layerName, context);
        this.#stateCaches.set(layerName, {});
        this.#shadowState.set(layerName, createDrawShadowState());
        this.#layerOptions.set(layerName, {
            persistent: options.persistent === true
        });
        this.#layerTransforms.set(layerName, normalizeDrawLayerTransform(options));
        this.#applyLayerTransform(layerName, context);
    }

    /**
     * 레이어를 해제합니다.
     * @param {string} layerName - 해제할 레이어 식별자입니다.
     */
    unregisterLayer(layerName) {
        this.#contexts.delete(layerName);
        this.#stateCaches.delete(layerName);
        this.#shadowState.delete(layerName);
        this.#layerOptions.delete(layerName);
        this.#layerTransforms.delete(layerName);
    }

    /**
     * 레이어별 좌표계 transform을 설정합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {number} scaleX - X축 배율입니다.
     * @param {number} scaleY - Y축 배율입니다.
     */
    setLayerTransform(layerName, scaleX = 1, scaleY = 1) {
        if (!this.#contexts.has(layerName)) {
            return;
        }

        this.#layerTransforms.set(layerName, normalizeDrawLayerTransform({
            transformScaleX: scaleX,
            transformScaleY: scaleY
        }));
        this.#stateCaches.set(layerName, {});
        this.#applyLayerTransform(layerName, this.#contexts.get(layerName));
    }

    /**
     * 텍스트 너비를 측정합니다.
     * @param {string} text - 측정할 문자열입니다.
     * @param {string} font - 사용할 폰트 문자열입니다.
     * @returns {number} 측정된 텍스트 너비입니다.
     */
    measureText(text, font) {
        this.#measureCtx.font = font;
        return this.#measureCtx.measureText(text).width;
    }

    /**
     * 특정 레이어의 지속 그림자 상태를 설정합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {number} blur - 그림자 블러입니다.
     * @param {string} color - 그림자 색상입니다.
     */
    shadowOn(layerName, blur, color) {
        if (!this.#shadowState.has(layerName)) {
            return;
        }

        this.#shadowState.set(layerName, createDrawShadowState(blur, color));
    }

    /**
     * 특정 레이어의 지속 그림자 상태를 초기화합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     */
    shadowOff(layerName) {
        if (!this.#shadowState.has(layerName)) {
            return;
        }

        this.#shadowState.set(layerName, createDrawShadowState());
    }

    /**
     * 지정된 레이어에 2D 명령을 렌더링합니다.
     * @param {string} layerName - 대상 레이어 식별자입니다.
     * @param {object} options - 렌더링 옵션입니다.
     */
    render(layerName, options) {
        const context = this.#contexts.get(layerName);
        const cache = this.#stateCaches.get(layerName);
        if (!context || !cache || !options) {
            return;
        }

        applyDraw2DStyles(
            context,
            cache,
            options,
            this.#shadowState.get(layerName) || createDrawShadowState()
        );

        switch (options.shape) {
            case 'rect':
                renderDrawRect(context, options);
                break;
            case 'roundRect':
                renderDrawRoundRect(context, options);
                break;
            case 'circle':
                renderDrawCircle(context, options);
                break;
            case 'line':
                renderDrawLine(context, options);
                break;
            case 'image':
                renderDrawImage(context, options);
                break;
            case 'text':
                renderDrawText(context, options);
                break;
            case 'arrow':
                renderDrawArrow(context, options, this.#pathCache.get('arrow'));
                break;
            default:
                break;
        }
    }

    /**
     * 특정 레이어를 초기화합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     */
    clear(layerName) {
        const context = this.#contexts.get(layerName);
        if (!context) {
            return;
        }

        this.#resetLayerState(layerName, context, { applyTransform: false });
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        this.#applyLayerTransform(layerName, context);
    }

    /**
     * 현재 등록된 모든 레이어를 초기화합니다.
     */
    clearAll() {
        for (const [layerName, context] of this.#contexts.entries()) {
            const layerOptions = this.#layerOptions.get(layerName);
            if (layerOptions?.persistent === true) {
                continue;
            }
            this.#resetLayerState(layerName, context, { applyTransform: false });
            context.clearRect(0, 0, context.canvas.width, context.canvas.height);
            this.#applyLayerTransform(layerName, context);
        }
    }

    /**
     * @private
     * 레이어 컨텍스트와 스타일 캐시를 프레임 기본 상태로 되돌립니다.
     * `render()` 캐시를 우회하는 직접 캔버스 드로잉이 있어도 다음 프레임이
     * 항상 동일한 시작 상태에서 렌더링되도록 보장합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 초기화할 컨텍스트입니다.
     * @param {{applyTransform?: boolean}} [options={}] - 초기화 후 레이어 transform을 복원할지 여부입니다.
     */
    #resetLayerState(layerName, context, options = {}) {
        resetDrawContextState(context);
        this.#stateCaches.set(layerName, {});
        if (options.applyTransform !== false) {
            this.#applyLayerTransform(layerName, context);
        }
    }

    /**
     * 등록된 레이어 transform을 컨텍스트에 적용합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 대상 컨텍스트입니다.
     * @private
     */
    #applyLayerTransform(layerName, context) {
        const transform = this.#layerTransforms.get(layerName) || { scaleX: 1, scaleY: 1 };
        applyDrawLayerTransform(context, transform);
    }

    /**
     * @private
     * 캐시 가능한 도형 경로를 생성합니다.
     */
    #generatePaths() {
        this.#pathCache.set('arrow', createDrawArrowPath());
    }
}
