import { EffectRenderer } from './_effect_renderer.js';
import { OverlayEffectRenderer } from './_overlay_effect_renderer.js';
import { WebGLBatch } from './_webgl_batch.js';
import { getData } from 'data/data_handler.js';

const DISPLAY_WEBGL_RENDER_MODES = getData('DISPLAY_SURFACE_DATA').WEBGL_RENDER_MODES;

/**
 * renderer가 별도 resize 계약을 가진 WebGL 레이어 renderer인지 확인합니다.
 * @param {object|null|undefined} renderer - 확인할 renderer입니다.
 * @returns {boolean} resize 계약을 가진 renderer 여부입니다.
 */
function _isResizableWebGLLayerRenderer(renderer) {
    return renderer instanceof OverlayEffectRenderer || renderer instanceof EffectRenderer;
}

/**
 * WebGL 레이어 모드에 맞는 renderer를 생성합니다.
 * @param {'batch'|'overlay-effect'|'effect'} mode - 레이어 렌더링 모드입니다.
 * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
 * @returns {object} 생성된 레이어 renderer입니다.
 */
export function createWebGLLayerRenderer(mode, gl) {
    if (mode === DISPLAY_WEBGL_RENDER_MODES.OVERLAY_EFFECT) {
        return new OverlayEffectRenderer(gl);
    }
    if (mode === DISPLAY_WEBGL_RENDER_MODES.EFFECT) {
        return new EffectRenderer(gl);
    }
    return new WebGLBatch(gl);
}

/**
 * renderer가 사용한 리소스를 해제합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 */
export function destroyWebGLLayerRenderer(renderer) {
    if (renderer && typeof renderer.destroy === 'function') {
        renderer.destroy();
    }
}

/**
 * renderer의 프레임 시작 상태를 구성합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 * @param {'batch'|'overlay-effect'|'effect'} mode - 레이어 렌더링 모드입니다.
 * @param {number} width - 프레임 너비입니다.
 * @param {number} height - 프레임 높이입니다.
 */
export function beginWebGLLayerFrame(renderer, mode, width, height) {
    if (!renderer || width <= 0 || height <= 0) {
        return;
    }

    if (
        mode === DISPLAY_WEBGL_RENDER_MODES.OVERLAY_EFFECT
        || mode === DISPLAY_WEBGL_RENDER_MODES.EFFECT
    ) {
        renderer.beginFrame(width, height);
        return;
    }

    renderer.begin(width, height);
}

/**
 * renderer에 화면 크기 변경을 반영합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 * @param {number} width - 새 너비입니다.
 * @param {number} height - 새 높이입니다.
 */
export function resizeWebGLLayerRenderer(renderer, width, height) {
    if (_isResizableWebGLLayerRenderer(renderer)) {
        renderer.resize(width, height);
    }
}

/**
 * 등록 직후 현재 surface 크기를 renderer에 반영합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 * @param {number} width - 현재 surface 너비입니다.
 * @param {number} height - 현재 surface 높이입니다.
 */
export function initializeWebGLLayerRendererSize(renderer, width, height) {
    if (!renderer || width <= 0 || height <= 0) {
        return;
    }

    if (_isResizableWebGLLayerRenderer(renderer)) {
        renderer.resize(width, height);
        return;
    }

    renderer.begin(width, height);
}

/**
 * renderer의 대기 중인 배치/효과 명령을 flush합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 */
export function flushWebGLLayerRenderer(renderer) {
    if (renderer instanceof WebGLBatch || renderer instanceof EffectRenderer) {
        renderer.flush();
    }
}

/**
 * overlay effect renderer의 blur 캐시를 무효화합니다.
 * @param {object|null|undefined} renderer - 대상 renderer입니다.
 */
export function markOverlayLayerRendererDirty(renderer) {
    if (renderer instanceof OverlayEffectRenderer) {
        renderer.markBlurDirty();
    }
}
