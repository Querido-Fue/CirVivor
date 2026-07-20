import { clampFiniteNumber } from 'util/number_util.js';


let timeHandlerInstance = null;

/**
 * @class TimeHandler
 * @description 게임의 가변·고정 시간 델타와 렌더 보간 계수를 관리합니다.
 * 가장 최근에 생성이 시작된 인스턴스를 모듈 싱글톤으로 노출합니다.
 */
export class TimeHandler {
    /**
     * 현재 객체를 싱글톤으로 등록한 뒤 기준 시각을 `performance.now()`로 샘플링합니다.
     * 가변·고정 델타와 기본 fixed step은 `1 / 60`초, 보간 계수는 0으로 초기화합니다.
     * 시각 샘플링이 실패하면 예외가 전파되며, 먼저 등록된 부분 초기화 인스턴스는
     * `getTimeHandler()`에서 계속 관찰될 수 있습니다.
     * @throws {*} `performance.now()`가 던진 예외입니다.
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
     * 매 렌더 프레임의 가변 델타를 갱신합니다.
     * `Number(deltaSeconds)` 변환 결과가 양수 유한 값이면 주입값을 사용하고,
     * 그 밖의 값이나 생략된 인수는 `performance.now()`와 `timeBefore`의 차이를 사용합니다.
     * 선택된 밀리초 값은 2~100ms로 제한한 뒤 초로 저장합니다. 양수 주입 경로는
     * `timeBefore`를 갱신하지 않지만 시각 fallback 경로는 샘플한 시각으로 갱신합니다.
     * @param {*} [deltaSeconds] - 초 단위 주입 델타로 변환할 값입니다.
     * @returns {void}
     * @throws {*} 입력 숫자 변환, `performance.now()`, 시각 차이 계산 또는 델타 정규화에서
     * 발생한 예외입니다.
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
     * 디버그 정지 프레임에서 가변 델타를 0으로 고정합니다.
     * `performance.now()`를 먼저 샘플링해 기준 시각을 갱신하므로 재개 후 fallback
     * 시간 계산에 정지 구간이 누적되지 않습니다.
     * @returns {void}
     * @throws {*} `performance.now()`가 던진 예외입니다. 이 경우 두 필드는 변경되지 않습니다.
     */
    freezeFrameDelta() {
        this.timeBefore = performance.now();
        this.lastFrameTimeDelta = 0;
    }

    /**
     * 고정 틱 루프의 델타를 갱신합니다.
     * `Number(fixedStepSeconds)` 변환 결과가 양수 유한 값이면 그대로 사용하고,
     * 0 이하이거나 비유한 값이면 현재 `this.fixedStepSeconds`로 되돌립니다.
     * `Number()` 변환이 성공하면 fallback 인수 평가로 `this.fixedStepSeconds`를 한 번 읽습니다.
     * 인수를 생략하거나 `undefined`를 전달하면 기본 인수 평가에서 그 전에 한 번 더 읽고,
     * 정규화된 값이 0 이하이면 복귀 분기에서 현재 값을 다시 한 번 읽습니다.
     * 숫자 변환이 먼저 실패한 명시적 인수는 fallback 필드를 읽지 않습니다.
     * 생성 시 기본 fixed step은 `1 / 60`초입니다.
     * @param {*} [fixedStepSeconds=this.fixedStepSeconds] - 초 단위 고정 스텝으로 변환할 값입니다.
     * @returns {void}
     * @throws {*} 숫자 변환 또는 `this.fixedStepSeconds` 접근에서 발생한 예외입니다.
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
     * 현재 렌더 프레임의 고정 틱 보간 계수를 갱신합니다.
     * `Number(alpha)`로 변환한 유한 값은 0~1로 제한하고, 비유한 값은 0으로 저장합니다.
     * @param {*} alpha - 보간 계수로 변환할 값입니다.
     * @returns {void}
     * @throws {*} 숫자 변환에서 발생한 예외입니다.
     */
    setFixedInterpolationAlpha(alpha) {
        this.fixedInterpolationAlpha = clampFiniteNumber(Number(alpha), 0, 1, 0);
    }

    /**
     * `Number(deltaMs)`로 변환한 유한 값을 2~100ms로 제한해 초 단위로 반환합니다.
     * 비유한 값은 2ms fallback을 사용합니다.
     * @param {*} deltaMs - 밀리초 델타로 변환할 값입니다.
     * @returns {number} 0.002~0.1초 범위의 정규화된 델타입니다.
     * @throws {*} 숫자 변환에서 발생한 예외입니다.
     * @private
     */
    _normalizeDeltaMs(deltaMs) {
        const safeDelta = clampFiniteNumber(Number(deltaMs), 2, 100, 2);

        return safeDelta / 1000;
    }
}

/**
 * 가장 최근에 생성이 시작된 TimeHandler 싱글톤을 반환하며, 생성 전에는 `null`입니다.
 * 생성 중 시각 샘플링이 실패한 경우 부분 초기화 인스턴스일 수 있습니다.
 * @returns {TimeHandler|null} 현재 TimeHandler 인스턴스입니다.
 */
export function getTimeHandler() {
    return timeHandlerInstance;
}

/**
 * 마지막 가변 프레임 델타(초)를 반환하며, 인스턴스 생성 전에는 0입니다.
 * @returns {*} 저장된 필드 값 또는 부분 초기화 상태의 `undefined`입니다.
 */
export function getDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.lastFrameTimeDelta;
    }
    return 0;
}

/**
 * 마지막 고정 틱 델타(초)를 반환하며, 인스턴스 생성 전에는 0입니다.
 * @returns {*} 저장된 필드 값 또는 부분 초기화 상태의 `undefined`입니다.
 */
export function getFixedDelta() {
    if (timeHandlerInstance) {
        return timeHandlerInstance.lastFixedTimeDelta;
    }
    return 0;
}

/**
 * 현재 렌더 프레임의 고정 틱 보간 계수를 반환합니다.
 * 인스턴스 생성 전에는 1, 정상 생성 직후에는 0이며 이후 저장된 값을 그대로 반환합니다.
 * @returns {*} 저장된 필드 값 또는 부분 초기화 상태의 `undefined`입니다.
 */
export function getFixedInterpolationAlpha() {
    if (!timeHandlerInstance) return 1;
    return timeHandlerInstance.fixedInterpolationAlpha;
}
