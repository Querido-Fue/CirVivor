import { clampFiniteNumber } from 'util/number_util.js';

/**
 * @class TimeHandler
 * @description 게임의 시간 델타(delta time)를 관리하는 클래스입니다.
 * 싱글톤 패턴으로 구현되어 전역적으로 접근 가능합니다.
 */

let timeHandlerInstance = null;

export class TimeHandler {
    /**
     * TimeHandler 인스턴스를 생성하고 기본 시간 상태를 초기화합니다.
     */
    constructor() {
        timeHandlerInstance = this;
        this.timeBefore = performance.now();
        this.fixedStepSeconds = 1 / 60;
        this.lastFrameTimeDelta = this.fixedStepSeconds;
        this.lastFixedTimeDelta = this.fixedStepSeconds;
        this.fixedInterpolationAlpha = 0;
    }

    /**
     * 매 프레임 호출되어 시간 델타를 업데이트합니다.
     * @param {number} [deltaSeconds] - 프레임 루프에서 계산한 초 단위 델타(선택)
     */
    update(deltaSeconds) {
        const injectedDeltaSeconds = clampFiniteNumber(Number(deltaSeconds), 0, Infinity, 0);
        if (injectedDeltaSeconds > 0) {
            this.lastFrameTimeDelta = this._normalizeDeltaMs(injectedDeltaSeconds * 1000);
            return;
        }

        const now = performance.now();
        const delta = now - this.timeBefore;
        this.timeBefore = now;
        this.lastFrameTimeDelta = this._normalizeDeltaMs(delta);
    }

    /**
     * 고정 틱 루프에서 호출되어 시간 델타를 업데이트합니다.
     * 고정 틱은 단일 루프에서 고정 스텝 값으로 주입됩니다.
     * @param {number} [fixedStepSeconds] - 고정 스텝(초)
     */
    updateFixed(fixedStepSeconds = this.fixedStepSeconds) {
        const safeFixedStepSeconds = clampFiniteNumber(Number(fixedStepSeconds), 0, Infinity, this.fixedStepSeconds);
        if (safeFixedStepSeconds <= 0) {
            this.lastFixedTimeDelta = this.fixedStepSeconds;
            return;
        }
        this.lastFixedTimeDelta = safeFixedStepSeconds;
    }

    /**
     * 현재 프레임에서 사용할 고정 틱 보간 계수를 갱신합니다.
     * @param {number} alpha - 0~1 범위의 보간 계수
     */
    setFixedInterpolationAlpha(alpha) {
        this.fixedInterpolationAlpha = clampFiniteNumber(Number(alpha), 0, 1, 0);
    }

    /**
     * 델타 값을 안전 범위로 보정하고 초 단위로 변환합니다.
     * @param {number} deltaMs
     * @returns {number}
     * @private
     */
    _normalizeDeltaMs(deltaMs) {
        const safeDelta = clampFiniteNumber(Number(deltaMs), 2, 100, 2);

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
    return timeHandlerInstance.fixedInterpolationAlpha;
}
