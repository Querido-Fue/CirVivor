import { getData } from 'data/data_handler.js';
import { toRadians } from 'util/math_util.js';
import {
    beginWebGLLayerFrame,
    createWebGLLayerRenderer,
    destroyWebGLLayerRenderer,
    flushWebGLLayerRenderer,
    initializeWebGLLayerRendererSize,
    markOverlayLayerRendererDirty,
    resizeWebGLLayerRenderer
} from './_webgl_layer_renderer.js';

const WEBGL_CONSTANTS = getData('WEBGL_CONSTANTS');
const DISPLAY_WEBGL_RENDER_MODES = getData('DISPLAY_SURFACE_DATA').WEBGL_RENDER_MODES;
const WEBGL_BACKGROUND_LAYER_ID = 'background';

/**
 * @class WebGLHandler
 * @description 정적 WebGL 레이어와 동적 overlay effect surface를 함께 관리합니다.
 */
export class WebGLHandler {
    /**
     * @param {Object.<string, WebGLRenderingContext>} glContexts - 초기 WebGL 레이어 맵입니다.
     */
    constructor(glContexts = {}) {
        this.glContexts = new Map();
        this.layerModes = new Map();
        this.layerRenderers = new Map();
        this.layerCallbacks = new Map();
        this.layerContextListeners = new Map();
        this.contextLostLayers = new Set();
        this.width = 0;
        this.height = 0;
        this.backgroundColor = [...WEBGL_CONSTANTS.DEFAULT_BACKGROUND_COLOR];

        for (const [layerName, context] of Object.entries(glContexts)) {
            this.registerLayer(layerName, context, { mode: DISPLAY_WEBGL_RENDER_MODES.BATCH });
        }
    }

    /**
     * 레이어를 등록합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {WebGLRenderingContext} gl - 연결할 WebGL 컨텍스트입니다.
     * @param {{mode?: 'batch'|'overlay-effect'|'effect', onDraw?: Function, onFrameClear?: Function, onContextLost?: Function, onContextRestored?: Function}} [options] - 레이어 모드 옵션입니다.
     */
    registerLayer(layerName, gl, options = {}) {
        if (!layerName || !gl) {
            return;
        }

        const mode = options.mode || DISPLAY_WEBGL_RENDER_MODES.BATCH;
        this.glContexts.set(layerName, gl);
        this.layerModes.set(layerName, mode);
        this.layerCallbacks.set(layerName, {
            onDraw: typeof options.onDraw === 'function' ? options.onDraw : null,
            onFrameClear: typeof options.onFrameClear === 'function' ? options.onFrameClear : null,
            onContextLost: typeof options.onContextLost === 'function' ? options.onContextLost : null,
            onContextRestored: typeof options.onContextRestored === 'function' ? options.onContextRestored : null
        });
        this.#attachContextLifecycle(layerName, gl);

        if (typeof gl.isContextLost === 'function' && gl.isContextLost()) {
            this.contextLostLayers.add(layerName);
            return;
        }

        this.#configureContext(gl);
        this.layerRenderers.set(layerName, createWebGLLayerRenderer(mode, gl));

        if (this.width > 0 && this.height > 0) {
            gl.viewport(0, 0, this.width, this.height);
            initializeWebGLLayerRendererSize(
                this.layerRenderers.get(layerName),
                this.width,
                this.height
            );
        }
    }

    /**
     * 레이어를 해제합니다.
     * @param {string} layerName - 해제할 레이어 식별자입니다.
     */
    unregisterLayer(layerName) {
        const gl = this.glContexts.get(layerName);
        const listeners = this.layerContextListeners.get(layerName);
        if (gl?.canvas && listeners) {
            gl.canvas.removeEventListener('webglcontextlost', listeners.onLost);
            gl.canvas.removeEventListener('webglcontextrestored', listeners.onRestored);
        }

        if (!this.contextLostLayers.has(layerName)) {
            destroyWebGLLayerRenderer(this.layerRenderers.get(layerName));
        }
        this.glContexts.delete(layerName);
        this.layerModes.delete(layerName);
        this.layerRenderers.delete(layerName);
        this.layerCallbacks.delete(layerName);
        this.layerContextListeners.delete(layerName);
        this.contextLostLayers.delete(layerName);
    }

    /**
     * 배경 색상을 갱신합니다.
     * @param {number} r - red 채널입니다.
     * @param {number} g - green 채널입니다.
     * @param {number} b - blue 채널입니다.
     */
    setBackgroundColor(r, g, b) {
        this.backgroundColor[0] = r;
        this.backgroundColor[1] = g;
        this.backgroundColor[2] = b;
        this.backgroundColor[3] = 1;
    }

    /**
     * 모든 WebGL 레이어의 기본 framebuffer를 프레임당 한 번 clear합니다.
     */
    clearAll() {
        for (const [layerName, gl] of this.glContexts.entries()) {
            if (this.contextLostLayers.has(layerName)) {
                continue;
            }
            const mode = this.layerModes.get(layerName);
            const renderer = this.layerRenderers.get(layerName);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, this.width, this.height);

            if (layerName === WEBGL_BACKGROUND_LAYER_ID) {
                gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], this.backgroundColor[3]);
            } else {
                gl.clearColor(0, 0, 0, 0);
            }

            gl.clear(gl.COLOR_BUFFER_BIT);

            beginWebGLLayerFrame(renderer, mode, this.width, this.height);
            this.layerCallbacks.get(layerName)?.onFrameClear?.(layerName === WEBGL_BACKGROUND_LAYER_ID);
        }
    }

    /**
     * 배치형 레이어를 flush합니다.
     */
    flushAll() {
        for (const [layerName, renderer] of this.layerRenderers.entries()) {
            if (this.contextLostLayers.has(layerName)) {
                continue;
            }
            flushWebGLLayerRenderer(renderer);
        }
    }

    /**
     * 화면 크기 변경을 각 레이어에 반영합니다.
     * @param {number} width - 새 너비입니다.
     * @param {number} height - 새 높이입니다.
     */
    resize(width, height) {
        this.width = width;
        this.height = height;

        for (const [layerName, gl] of this.glContexts.entries()) {
            if (this.contextLostLayers.has(layerName)) {
                continue;
            }
            gl.viewport(0, 0, width, height);
            resizeWebGLLayerRenderer(this.layerRenderers.get(layerName), width, height);
        }
    }

    /**
     * 등록된 WebGL renderer에 값을 전달하고 정상 완료 뒤 현재 onDraw callback을 알립니다.
     * `layerName`은 PropertyKey로 변환하지 않으며, 기본 Set/Map에서는 SameValueZero key로 비교됩니다.
     * context-lost key이거나 renderer 조회 결과가 falsy이면 이후 단계를 실행하지 않고 `undefined`를 반환합니다.
     * renderer의 live `render`를 원래 receiver와 `options` identity로 동기 호출합니다.
     * renderer가 정상 반환한 뒤 최신 callback Map과 record의 `onDraw`를 조회해 record receiver로 인자 없이 호출합니다.
     * 하위 renderer가 내부적으로 no-op해도 정상 반환이면 callback 통지를 수행합니다.
     * renderer와 callback의 반환값 및 thenable은 관찰하지 않고 폐기하며, 조회·getter·호출 중 발생한 예외는 그대로 동기 전파됩니다.
     * callback 조회 또는 호출 실패는 앞서 완료된 renderer 부수효과를 되돌리지 않습니다.
     *
     * @param {*} layerName - context-lost Set과 renderer/callback Map에서 조회할 key입니다.
     * @param {*} options - renderer의 `render()`에 그대로 전달할 값입니다.
     * @returns {undefined} 정상 완료 시 항상 `undefined`입니다.
     */
    render(layerName, options) {
        if (this.contextLostLayers.has(layerName)) {
            return;
        }
        const renderer = this.layerRenderers.get(layerName);
        if (!renderer) {
            return;
        }

        renderer.render(options);
        this.layerCallbacks.get(layerName)?.onDraw?.();
    }

    /**
     * 동일 shape/style의 local center 목록을 가능한 경우 batch bulk writer로 전달합니다.
     * bulk API가 없는 renderer에서는 기존 단건 render 호출로 fallback합니다.
     * @param {string} layerName - 대상 레이어 식별자입니다.
     * @param {object} options - 공통 shape 렌더 옵션입니다.
     * @param {Array<{x:number, y:number}>} localCenters - 원점 기준 local center 목록입니다.
     * @param {number} originX - 월드 원점 X 좌표입니다.
     * @param {number} originY - 월드 원점 Y 좌표입니다.
     * @param {number} localScale - local center 좌표 배율입니다.
     * @returns {number} renderer에 전달한 instance 수입니다.
     */
    renderShapeInstances(layerName, options, localCenters, originX, originY, localScale) {
        if (this.contextLostLayers.has(layerName)
            || !options?.shape
            || !Array.isArray(localCenters)
            || localCenters.length === 0) {
            return 0;
        }

        const renderer = this.layerRenderers.get(layerName);
        if (!renderer) {
            return 0;
        }

        let renderedCount = 0;
        if (typeof renderer.renderShapeInstances === 'function') {
            renderedCount = renderer.renderShapeInstances(
                options,
                localCenters,
                originX,
                originY,
                localScale
            );
        } else {
            const hasPrecomputedTrig = Number.isFinite(options.rotationCos)
                && Number.isFinite(options.rotationSin);
            const rotationRadians = hasPrecomputedTrig
                ? 0
                : toRadians(Number.isFinite(options.rotation) ? options.rotation : 0);
            const rotationCos = hasPrecomputedTrig ? options.rotationCos : Math.cos(rotationRadians);
            const rotationSin = hasPrecomputedTrig ? options.rotationSin : Math.sin(rotationRadians);
            const resolvedOriginX = Number.isFinite(originX) ? originX : 0;
            const resolvedOriginY = Number.isFinite(originY) ? originY : 0;
            const resolvedLocalScale = Number.isFinite(localScale) ? localScale : 1;
            const localScaleCos = resolvedLocalScale * rotationCos;
            const localScaleSin = resolvedLocalScale * rotationSin;

            for (let centerIndex = 0; centerIndex < localCenters.length; centerIndex++) {
                const localCenter = localCenters[centerIndex];
                if (!localCenter || !Number.isFinite(localCenter.x) || !Number.isFinite(localCenter.y)) {
                    continue;
                }

                const x = resolvedOriginX
                    + (localCenter.x * localScaleCos)
                    - (localCenter.y * localScaleSin);
                const y = resolvedOriginY
                    + (localCenter.x * localScaleSin)
                    + (localCenter.y * localScaleCos);
                // effect renderer는 명령 참조를 flush까지 보관하므로 폴백에서만 좌표 snapshot을 분리합니다.
                renderer.render({ ...options, x, y });
                renderedCount += 1;
            }
        }

        if (renderedCount > 0) {
            this.layerCallbacks.get(layerName)?.onDraw?.();
        }
        return renderedCount;
    }

    /**
     * blur 캐시를 무효화합니다.
     * @param {string} layerName - 대상 overlay effect 레이어입니다.
     */
    markDirty(layerName) {
        markOverlayLayerRendererDirty(this.layerRenderers.get(layerName));
    }

    /**
     * WebGL 컨텍스트의 공통 렌더 상태를 초기화합니다.
     * @param {WebGLRenderingContext} gl - 초기화할 컨텍스트입니다.
     * @private
     */
    #configureContext(gl) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    /**
     * 캔버스의 context loss/restore 이벤트를 레이어 수명주기와 연결합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
     * @private
     */
    #attachContextLifecycle(layerName, gl) {
        const canvas = gl?.canvas;
        if (!canvas || typeof canvas.addEventListener !== 'function') {
            return;
        }

        const onLost = (event) => {
            event.preventDefault();
            this.contextLostLayers.add(layerName);
            this.layerCallbacks.get(layerName)?.onContextLost?.();
        };
        const onRestored = () => {
            this.#restoreLayerRenderer(layerName);
        };
        canvas.addEventListener('webglcontextlost', onLost);
        canvas.addEventListener('webglcontextrestored', onRestored);
        this.layerContextListeners.set(layerName, { onLost, onRestored });
    }

    /**
     * 복구된 WebGL 컨텍스트의 renderer와 GPU 자원을 다시 생성합니다.
     * @param {string} layerName - 복구할 레이어 식별자입니다.
     * @private
     */
    #restoreLayerRenderer(layerName) {
        const gl = this.glContexts.get(layerName);
        const mode = this.layerModes.get(layerName);
        if (!gl || !mode) {
            return;
        }

        this.#configureContext(gl);
        const renderer = createWebGLLayerRenderer(mode, gl);
        this.layerRenderers.set(layerName, renderer);
        this.contextLostLayers.delete(layerName);

        if (this.width > 0 && this.height > 0) {
            gl.viewport(0, 0, this.width, this.height);
            initializeWebGLLayerRendererSize(renderer, this.width, this.height);
        }

        this.layerCallbacks.get(layerName)?.onContextRestored?.();
    }
}
