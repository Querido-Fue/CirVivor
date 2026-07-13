import { easeOutExpo } from 'util/number_util.js';

const CONNECTED_PRESENTATION_KIND = 'overlay-connected-card';
const DEFAULT_DURATION_SECONDS = 0.4;
const DEFAULT_SWITCH_PROGRESS = 0.5;
const DEFAULT_PERSPECTIVE = 1180;

/**
 * 연결 전환에 사용할 사각형을 정규화합니다.
 * @param {object|null|undefined} rect - 원본 사각형입니다.
 * @returns {{x:number,y:number,w:number,h:number,radius:number}|null} 정규화된 사각형입니다.
 */
function normalizeRect(rect) {
    if (!rect) {
        return null;
    }

    const x = Number(rect.x);
    const y = Number(rect.y);
    const w = Number(rect.w);
    const h = Number(rect.h);
    const radius = Number(rect.radius);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) {
        return null;
    }

    return {
        x,
        y,
        w,
        h,
        radius: Number.isFinite(radius) ? Math.max(0, radius) : 0
    };
}

/**
 * 0~1 값을 제한합니다.
 * @param {number} value - 제한할 값입니다.
 * @returns {number} 제한된 값입니다.
 */
function clampProgress(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

/**
 * 면 교체 지점을 기준으로 지수형 Y축 회전 진행률을 계산합니다.
 * 전반부는 edge-on 상태로 가속하고 후반부는 최종 면으로 감속합니다.
 * @param {number} progress - 전체 0~1 진행률입니다.
 * @param {number} switchProgress - 앞면과 뒷면의 교체 시점입니다.
 * @returns {number} 0~1 회전 진행률입니다.
 */
function getRotationProgress(progress, switchProgress) {
    const value = clampProgress(progress);
    if (value < switchProgress) {
        const localProgress = value / switchProgress;
        const easedProgress = 1 - easeOutExpo(1 - localProgress);
        return easedProgress * 0.5;
    }

    const localProgress = (value - switchProgress) / (1 - switchProgress);
    return 0.5 + (easeOutExpo(localProgress) * 0.5);
}

/**
 * 두 값 사이를 보간합니다.
 * @param {number} start - 시작값입니다.
 * @param {number} end - 종료값입니다.
 * @param {number} progress - 보간 진행률입니다.
 * @returns {number} 보간값입니다.
 */
function lerp(start, end, progress) {
    return start + ((end - start) * progress);
}

/**
 * 카드에서 오버레이로 이어지는 공유 프레젠테이션 상태를 생성합니다.
 * @param {object} options - 생성 옵션입니다.
 * @param {object} options.sourceRect - 출발 카드 영역입니다.
 * @param {number} [options.durationSeconds=0.4] - 전체 전환 시간입니다.
 * @param {number} [options.switchProgress=0.5] - 카드/오버레이 면 교체 시점입니다.
 * @param {number} [options.perspective=1180] - 원근 거리입니다.
 * @returns {object} 연결 프레젠테이션 상태입니다.
 */
export function createOverlayConnectedPresentation({
    sourceRect,
    durationSeconds = DEFAULT_DURATION_SECONDS,
    switchProgress = DEFAULT_SWITCH_PROGRESS,
    perspective = DEFAULT_PERSPECTIVE
}) {
    return {
        kind: CONNECTED_PRESENTATION_KIND,
        sourceRect: normalizeRect(sourceRect),
        targetRect: null,
        durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
            ? durationSeconds
            : DEFAULT_DURATION_SECONDS,
        switchProgress: Number.isFinite(switchProgress)
            ? Math.min(0.9, Math.max(0.1, switchProgress))
            : DEFAULT_SWITCH_PROGRESS,
        perspective: Number.isFinite(perspective) && perspective > 0
            ? perspective
            : DEFAULT_PERSPECTIVE,
        progress: 0,
        motionProgress: 0,
        rotationY: 0,
        ready: false,
        completed: false,
        cancelled: false
    };
}

/**
 * 값이 연결 프레젠테이션 상태인지 반환합니다.
 * @param {object|null|undefined} presentation - 검사할 값입니다.
 * @returns {boolean} 연결 프레젠테이션 여부입니다.
 */
export function isOverlayConnectedPresentation(presentation) {
    return presentation?.kind === CONNECTED_PRESENTATION_KIND;
}

/**
 * 현재 레이아웃의 출발 카드 영역을 동기화합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @param {object} sourceRect - 최신 출발 영역입니다.
 * @returns {boolean} 동기화 성공 여부입니다.
 */
export function setOverlayConnectedPresentationSource(presentation, sourceRect) {
    if (!isOverlayConnectedPresentation(presentation)) {
        return false;
    }

    const normalized = normalizeRect(sourceRect);
    if (!normalized) {
        return false;
    }
    presentation.sourceRect = normalized;
    return true;
}

/**
 * 실제 오버레이의 목표 패널 영역을 연결 프레젠테이션에 설정합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @param {object} targetRect - 목표 패널 영역입니다.
 * @returns {boolean} 설정 성공 여부입니다.
 */
export function setOverlayConnectedPresentationTarget(presentation, targetRect) {
    if (!isOverlayConnectedPresentation(presentation)) {
        return false;
    }

    const normalized = normalizeRect(targetRect);
    if (!normalized) {
        return false;
    }
    presentation.targetRect = normalized;
    presentation.ready = Boolean(presentation.sourceRect);
    return presentation.ready;
}

/**
 * 연결 프레젠테이션 시간축을 진행합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @param {number} deltaSeconds - 가변 프레임 델타 초입니다.
 * @returns {boolean} 이번 호출에서 완료 지점에 도달했는지 여부입니다.
 */
export function advanceOverlayConnectedPresentation(presentation, deltaSeconds) {
    if (!isOverlayConnectedPresentation(presentation)
        || !presentation.ready
        || presentation.cancelled
        || presentation.completed) {
        return false;
    }

    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const previousProgress = presentation.progress;
    presentation.progress = clampProgress(
        previousProgress + (delta / presentation.durationSeconds)
    );
    presentation.motionProgress = easeOutExpo(presentation.progress);
    presentation.rotationY = Math.PI * getRotationProgress(
        presentation.progress,
        presentation.switchProgress
    );
    presentation.completed = presentation.progress >= 1;
    return previousProgress < 1 && presentation.completed;
}

/**
 * 현재 전환 면의 화면 사각형을 계산합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @param {object|null} [out=null] - 재사용할 출력 객체입니다.
 * @returns {{x:number,y:number,w:number,h:number,radius:number}|null} 현재 사각형입니다.
 */
export function getOverlayConnectedPresentationRect(presentation, out = null) {
    if (!isOverlayConnectedPresentation(presentation)
        || !presentation.sourceRect
        || !presentation.targetRect) {
        return null;
    }

    const result = out && typeof out === 'object'
        ? out
        : { x: 0, y: 0, w: 0, h: 0, radius: 0 };
    const progress = presentation.motionProgress;
    result.x = lerp(presentation.sourceRect.x, presentation.targetRect.x, progress);
    result.y = lerp(presentation.sourceRect.y, presentation.targetRect.y, progress);
    result.w = lerp(presentation.sourceRect.w, presentation.targetRect.w, progress);
    result.h = lerp(presentation.sourceRect.h, presentation.targetRect.h, progress);
    result.radius = lerp(
        presentation.sourceRect.radius,
        presentation.targetRect.radius,
        progress
    );
    return result;
}

/**
 * 앞면 콘텐츠를 원래 크기로 현재 전환 패널 중앙에 고정할 영역을 계산합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @param {object} currentRect - 현재 전환 패널 영역입니다.
 * @param {object|null} [out=null] - 재사용할 출력 객체입니다.
 * @returns {{x:number,y:number,w:number,h:number,radius:number}|null} 고정 콘텐츠 영역입니다.
 */
export function getOverlayConnectedPresentationFrontContentRect(
    presentation,
    currentRect,
    out = null
) {
    if (!isOverlayConnectedPresentation(presentation)
        || !presentation.sourceRect
        || !currentRect
        || !Number.isFinite(currentRect.x)
        || !Number.isFinite(currentRect.y)
        || !Number.isFinite(currentRect.w)
        || !Number.isFinite(currentRect.h)
        || currentRect.w <= 0
        || currentRect.h <= 0) {
        return null;
    }

    const result = out && typeof out === 'object'
        ? out
        : { x: 0, y: 0, w: 0, h: 0, radius: 0 };
    const sourceRect = presentation.sourceRect;
    result.x = currentRect.x + ((currentRect.w - sourceRect.w) * 0.5);
    result.y = currentRect.y + ((currentRect.h - sourceRect.h) * 0.5);
    result.w = sourceRect.w;
    result.h = sourceRect.h;
    result.radius = sourceRect.radius;
    return result;
}

/**
 * 현재 카드 앞면을 표시할 구간인지 반환합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @returns {boolean} 카드 앞면 표시 여부입니다.
 */
export function isOverlayConnectedPresentationFrontFace(presentation) {
    return isOverlayConnectedPresentation(presentation)
        && presentation.progress < presentation.switchProgress;
}

/**
 * 후반부 오버레이 면에 적용할 Y 회전각을 반환합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 * @returns {number} -PI/2~0 범위 회전각입니다.
 */
export function getOverlayConnectedPresentationBackRotationY(presentation) {
    if (!isOverlayConnectedPresentation(presentation)) {
        return 0;
    }
    return presentation.rotationY - Math.PI;
}

/**
 * 연결 프레젠테이션을 취소합니다.
 * @param {object} presentation - 연결 프레젠테이션 상태입니다.
 */
export function cancelOverlayConnectedPresentation(presentation) {
    if (!isOverlayConnectedPresentation(presentation)) {
        return;
    }
    presentation.cancelled = true;
}
