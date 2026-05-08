import { getData } from 'data/data_handler.js';
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
        this.width = 0;
        this.height = 0;
        this.backgroundColor = [...WEBGL_CONSTANTS.DEFAULT_BACKGROUND_COLOR];

        for (const [layerName, context] of Object.entries(glContexts)) {
            this.registerLayer(layerName, context, { mode: 'batch' });
        }
    }

    /**
     * 레이어를 등록합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {WebGLRenderingContext} gl - 연결할 WebGL 컨텍스트입니다.
     * @param {{mode?: 'batch'|'overlay-effect'|'effect'}} [options] - 레이어 모드 옵션입니다.
     */
    registerLayer(layerName, gl, options = {}) {
        if (!layerName || !gl) {
            return;
        }

        const mode = options.mode || 'batch';
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this.glContexts.set(layerName, gl);
        this.layerModes.set(layerName, mode);
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
        destroyWebGLLayerRenderer(this.layerRenderers.get(layerName));
        this.glContexts.delete(layerName);
        this.layerModes.delete(layerName);
        this.layerRenderers.delete(layerName);
    }

    /**
     * 배경 색상을 갱신합니다.
     * @param {number} r - red 채널입니다.
     * @param {number} g - green 채널입니다.
     * @param {number} b - blue 채널입니다.
     */
    setBackgroundColor(r, g, b) {
        this.backgroundColor = [r, g, b, 1];
    }

    /**
     * 모든 WebGL 레이어를 프레임 시작 상태로 초기화합니다.
     */
    clearAll() {
        for (const [layerName, gl] of this.glContexts.entries()) {
            const mode = this.layerModes.get(layerName);
            const renderer = this.layerRenderers.get(layerName);

            if (layerName === 'background') {
                gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], this.backgroundColor[3]);
            } else {
                gl.clearColor(0, 0, 0, 0);
            }

            gl.clear(gl.COLOR_BUFFER_BIT);

            beginWebGLLayerFrame(renderer, mode, this.width, this.height);
        }
    }

    /**
     * 배치형 레이어를 flush합니다.
     */
    flushAll() {
        for (const renderer of this.layerRenderers.values()) {
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
            gl.viewport(0, 0, width, height);
            resizeWebGLLayerRenderer(this.layerRenderers.get(layerName), width, height);
        }
    }

    /**
     * 특정 레이어에 렌더 명령을 전달합니다.
     * @param {string} layerName - 대상 레이어 식별자입니다.
     * @param {object} options - 렌더링 옵션입니다.
     */
    render(layerName, options) {
        const renderer = this.layerRenderers.get(layerName);
        if (!renderer) {
            return;
        }

        renderer.render(options);
    }

    /**
     * blur 캐시를 무효화합니다.
     * @param {string} layerName - 대상 overlay effect 레이어입니다.
     */
    markDirty(layerName) {
        markOverlayLayerRendererDirty(this.layerRenderers.get(layerName));
    }
}
