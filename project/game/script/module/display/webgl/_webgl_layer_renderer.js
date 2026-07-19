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
 * renderer와 크기 guard를 통과한 경우 mode별 프레임 시작 메서드를 동기 호출합니다.
 * renderer가 falsy이면 helper 본문은 전달된 width·height를 비교·강제변환하지 않고 `undefined`를 반환합니다.
 * truthy renderer에서는 `width <= 0` 뒤 `height <= 0`을 native relational comparison으로 평가합니다.
 * `NaN`처럼 비교 결과가 false인 값은 통과하며, 강제 변환 예외는 그대로 전파됩니다.
 * overlay-effect와 effect mode는 strict equality로 선택해 live `beginFrame`을, 나머지는 live `begin`을 원래 renderer receiver로 호출합니다.
 * 원본 width·height identity를 그대로 전달하고 하위 반환값과 thenable은 관찰하지 않습니다.
 * 별도 재진입 guard나 rollback 없이 조회·변환·호출 예외와 이미 완료된 하위 부수효과를 그대로 유지합니다.
 *
 * @param {*} renderer - truthiness guard와 mode별 메서드 조회에 사용할 값입니다.
 * @param {*} mode - strict equality로 분기할 렌더링 mode 값입니다.
 * @param {*} width - native `<= 0` 비교 뒤 원본 그대로 전달할 너비입니다.
 * @param {*} height - native `<= 0` 비교 뒤 원본 그대로 전달할 높이입니다.
 * @returns {undefined} 일반 함수 호출의 guard 또는 정상 완료 시 항상 `undefined`입니다.
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
 * 현재 module constructor의 `instanceof` 기준으로 WebGLBatch 또는 EffectRenderer만 동기 flush합니다.
 * 두 `instanceof` 판정이 모두 false로 정상 완료된 OverlayEffectRenderer, 다른 renderer와 falsy 값은 `flush` 프로퍼티를 읽지 않고 no-op합니다.
 * 지원 renderer의 live `flush`를 원래 receiver로 호출하며 반환값과 thenable은 관찰하지 않습니다.
 * `instanceof` 판정·`flush` 조회·호출 예외는 변환하지 않고 그대로 전파하며 별도 재진입 guard가 없습니다.
 *
 * @param {*} renderer - 지원 renderer 여부를 판정하고 flush할 값입니다.
 * @returns {undefined} 일반 함수 호출의 정상 완료 시 항상 `undefined`입니다.
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
