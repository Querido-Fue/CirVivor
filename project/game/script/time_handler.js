/**
 * @class TimeHandler
 * @description 게임의 시간 델타(delta time)를 관리하는 클래스입니다.
 * 싱글톤 패턴으로 구현되어 전역적으로 접근 가능합니다.
 */

let timeHandlerInstance = null;

export class TimeHandler {
    constructor() {
        timeHandlerInstance = this;
        this.timeBefore = performance.now();
        this.timeBeforeFixed = this.timeBefore;
        this.fixedStepSeconds = 1 / 60;
        this.lastFrameTimeDelta = 0;
        this.lastFixedTimeDelta = this.fixedStepSeconds;
    }

    /**
     * 매 프레임 호출되어 시간 델타를 업데이트합니다.
     */
    update() {
        const now = performance.now();
        const delta = now - this.timeBefore;
        this.timeBefore = now;
        this.lastFrameTimeDelta = this._normalizeDeltaMs(delta);
    }

    /**
     * 고정 틱 루프에서 호출되어 시간 델타를 업데이트합니다.
     */
    updateFixed() {
        const now = performance.now();
        const delta = now - this.timeBeforeFixed;
        this.timeBeforeFixed = now;
        this.lastFixedTimeDelta = this._normalizeDeltaMs(delta);
    }

    /**
     * 델타 값을 안전 범위로 보정하고 초 단위로 변환합니다.
     * @param {number} deltaMs
     * @returns {number}
     * @private
     */
    _normalizeDeltaMs(deltaMs) {
        let safeDelta = deltaMs;

        // 델타 값이 너무 튀는 것을 방지 (최대 0.1초)
        if (safeDelta > 100) safeDelta = 100;

        // 너무 짧은 프레임 델타 방지 (0으로 수렴하여 물리/애니가 멈추거나 튀는 현상 방지)
        // 렌더 루프 지연 후 연속 호출 시 delta가 1~2ms로 튀는 현상 방어
        // 최소 2ms (약 500fps 한계) 보장
        if (safeDelta < 2) safeDelta = 2;

        return safeDelta / 1000;
    }
}

/**
 * TimeHandler 싱글톤 인스턴스를 반환합니다.
 * @returns {TimeHandler|null} 현재 TimeHandler 인스턴스
 */
export function getTimeHandler() {
    return timeHandlerInstance;
}

/**
 * 가변 프레임 델타(초)를 반환합니다.
 * @returns {number} 마지막 프레임 델타
 */
export function getDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.lastFrameTimeDelta;
    }
    return 0;
}

/**
 * 고정 프레임 델타(초)를 반환합니다.
 * @returns {number} 마지막 고정 틱 델타
 */
export function getFixedDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.lastFixedTimeDelta;
    }
    return 0;
}

/**
 * 현재 프레임에서 사용할 고정 틱 보간 계수(0~1)를 반환합니다.
 * @returns {number}
 */
export function getFixedInterpolationAlpha() {
    if (!timeHandlerInstance) return 1;

    const stepSeconds = Number.isFinite(timeHandlerInstance.lastFixedTimeDelta) && timeHandlerInstance.lastFixedTimeDelta > 0
        ? timeHandlerInstance.lastFixedTimeDelta
        : timeHandlerInstance.fixedStepSeconds;
    const elapsedSeconds = (performance.now() - timeHandlerInstance.timeBeforeFixed) / 1000;
    if (!Number.isFinite(elapsedSeconds) || stepSeconds <= 0) return 1;

    const alpha = elapsedSeconds / stepSeconds;
    if (alpha <= 0) return 0;
    if (alpha >= 1) return 1;
    return alpha;
}
