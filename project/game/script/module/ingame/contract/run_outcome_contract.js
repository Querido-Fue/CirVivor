import { RUN_OUTCOME_STATE } from '../state/run_outcome.js';

/** @param {*} outcome - 검사할 CPU run outcome입니다. */
export function isRunOutcome(outcome) {
    return Boolean(
        outcome
        && typeof outcome === 'object'
        && typeof outcome.isRunning === 'function'
        && typeof outcome.isDefeated === 'function'
        && typeof outcome.getState === 'function'
        && typeof outcome.getRunFailedFact === 'function'
        && typeof outcome.transitionToDefeated === 'function'
        && typeof outcome.getStatus === 'function'
        && (outcome.getState() === RUN_OUTCOME_STATE.RUNNING
            || outcome.getState() === RUN_OUTCOME_STATE.DEFEATED)
    );
}

/** @param {*} outcome - 검사할 CPU run outcome입니다. */
export function assertRunOutcome(outcome) {
    if (!isRunOutcome(outcome)) {
        throw new TypeError('IRunOutcome 계약을 만족하지 않는 component입니다.');
    }
    return outcome;
}
