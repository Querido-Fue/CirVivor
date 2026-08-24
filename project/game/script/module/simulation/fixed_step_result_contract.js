export const FIXED_STEP_RESULT = Object.freeze({
    COMPLETED: 'COMPLETED',
    DEFERRED_BACKPRESSURE: 'DEFERRED_BACKPRESSURE',
    INTENTIONAL_PAUSE: 'INTENTIONAL_PAUSE'
});

const FIXED_STEP_RESULTS = new Set(Object.values(FIXED_STEP_RESULT));

/**
 * Legacy boolean fixed-step 결과와 새 typed 결과를 단일 의미로 정규화합니다.
 * `true`/`undefined`는 완료, `false`는 retry 가능한 backpressure입니다.
 * @param {boolean|string|undefined} result - fixed-step owner의 반환값입니다.
 * @returns {string} 정규화된 FIXED_STEP_RESULT 값입니다.
 */
export function normalizeFixedStepResult(result) {
    if (result === true || result === undefined) {
        return FIXED_STEP_RESULT.COMPLETED;
    }
    if (result === false) {
        return FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE;
    }
    if (FIXED_STEP_RESULTS.has(result)) {
        return result;
    }
    throw new RangeError(`알려지지 않은 fixed-step 결과입니다: ${String(result)}`);
}
