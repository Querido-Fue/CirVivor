const ACTIVE_CAPTURE_BY_DISPLAY = new WeakMap();
const END_CLEANUPS_BY_TOKEN = new WeakMap();
let nextCaptureEpoch = 0;

/**
 * 특정 DisplaySystem에 대해 동기 title overlay 의미 캡처 구간을 엽니다.
 * 이미 열린 구간이 있으면 기존 owner를 덮어쓰지 않고 null을 반환합니다.
 * @param {object|Function} displaySystem - 캡처 대상 DisplaySystem identity입니다.
 * @param {number} frameId - composer와 공유할 frame identity입니다.
 * @param {object} [options={}] - 현재 presentation 정책입니다.
 * @param {boolean} [options.legacyDrawRequired=true] - 레거시 raster를 함께 생성해야 하는지 여부입니다.
 * @returns {Readonly<{frameId:number, epoch:number, legacyDrawRequired:boolean}>|null} 종료에 사용할 opaque token입니다.
 */
export function beginTitleWebGpuOverlayCapture(
    displaySystem,
    frameId,
    { legacyDrawRequired = true } = {}
) {
    requireDisplayIdentity(displaySystem);
    requireFrameId(frameId);
    if (ACTIVE_CAPTURE_BY_DISPLAY.has(displaySystem)) {
        return null;
    }

    nextCaptureEpoch += 1;
    if (!Number.isSafeInteger(nextCaptureEpoch)) {
        throw new RangeError('title WebGPU overlay capture epoch 범위를 초과했습니다.');
    }
    const token = Object.freeze({
        frameId,
        epoch: nextCaptureEpoch,
        legacyDrawRequired: legacyDrawRequired !== false
    });
    ACTIVE_CAPTURE_BY_DISPLAY.set(displaySystem, token);
    END_CLEANUPS_BY_TOKEN.set(token, new Set());
    return token;
}

/**
 * begin에서 받은 동일 token의 캡처 구간만 닫습니다.
 * @param {object|Function} displaySystem - 캡처 대상 DisplaySystem identity입니다.
 * @param {object|Function} token - begin이 반환한 opaque token입니다.
 * @returns {boolean} 활성 구간을 실제로 닫았으면 true입니다.
 */
export function endTitleWebGpuOverlayCapture(displaySystem, token) {
    requireDisplayIdentity(displaySystem);
    const activeToken = ACTIVE_CAPTURE_BY_DISPLAY.get(displaySystem) ?? null;
    if (!activeToken || activeToken !== token) {
        return false;
    }
    ACTIVE_CAPTURE_BY_DISPLAY.delete(displaySystem);
    const endCleanups = END_CLEANUPS_BY_TOKEN.get(token);
    END_CLEANUPS_BY_TOKEN.delete(token);
    if (endCleanups) {
        for (const cleanup of endCleanups) {
            try {
                cleanup(token);
            } catch {
                // capture 정리는 presentation 종료나 legacy draw를 중단시키지 않습니다.
            }
        }
        endCleanups.clear();
    }
    return true;
}

/**
 * DisplaySystem에 현재 열린 title overlay 의미 캡처 token을 반환합니다.
 * @param {object|Function} displaySystem - 조회할 DisplaySystem identity입니다.
 * @param {Function|null} [onCaptureEnd=null] - token 종료 즉시 보관 데이터를 비울 callback입니다.
 * @returns {Readonly<{frameId:number, epoch:number, legacyDrawRequired:boolean}>|null} 활성 token입니다.
 */
export function getTitleWebGpuOverlayCaptureToken(displaySystem, onCaptureEnd = null) {
    if (!displaySystem
        || (typeof displaySystem !== 'object' && typeof displaySystem !== 'function')) {
        return null;
    }
    const token = ACTIVE_CAPTURE_BY_DISPLAY.get(displaySystem) ?? null;
    if (token && typeof onCaptureEnd === 'function') {
        END_CLEANUPS_BY_TOKEN.get(token)?.add(onCaptureEnd);
    }
    return token;
}

function requireDisplayIdentity(displaySystem) {
    if (!displaySystem
        || (typeof displaySystem !== 'object' && typeof displaySystem !== 'function')) {
        throw new TypeError('title WebGPU overlay capture DisplaySystem identity가 필요합니다.');
    }
    return displaySystem;
}

function requireFrameId(frameId) {
    if (!Number.isSafeInteger(frameId) || frameId < 0) {
        throw new RangeError('title WebGPU overlay capture frameId는 0 이상의 안전한 정수여야 합니다.');
    }
    return frameId;
}
