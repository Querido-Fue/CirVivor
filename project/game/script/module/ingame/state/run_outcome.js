export const RUN_OUTCOME_STATE = Object.freeze({
    RUNNING: 'RUNNING',
    DEFEATED: 'DEFEATED'
});

export const RUN_OUTCOME_FACT_TYPE = Object.freeze({
    RUN_FAILED: 'RunFailed'
});

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function optionalNonEmptyString(value, fallback = null) {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function createRunFailedFact(options) {
    return Object.freeze({
        type: RUN_OUTCOME_FACT_TYPE.RUN_FAILED,
        outcome: RUN_OUTCOME_STATE.DEFEATED,
        fixedTick: requireNonNegativeSafeInteger(options?.fixedTick ?? 0, 'fixedTick'),
        sourceType: optionalNonEmptyString(options?.sourceType, 'CoreDepleted'),
        sourceEventKey: optionalNonEmptyString(options?.sourceEventKey),
        coreImpactKey: optionalNonEmptyString(options?.coreImpactKey)
    });
}

/**
 * @class RunOutcome
 * @description GameSystem이 소유하는 CPU run-domain의 단방향 결과 상태입니다.
 */
export class RunOutcome {
    constructor() {
        this.state = RUN_OUTCOME_STATE.RUNNING;
        this.runFailedFact = null;
        this.destroyed = false;
    }

    /** @returns {boolean} gameplay을 계속 수락할 수 있는 run인지 여부입니다. */
    isRunning() {
        return !this.destroyed && this.state === RUN_OUTCOME_STATE.RUNNING;
    }

    /** @returns {boolean} Core depletion으로 종료된 run인지 여부입니다. */
    isDefeated() {
        return !this.destroyed && this.state === RUN_OUTCOME_STATE.DEFEATED;
    }

    /** @returns {string} 현재 stable outcome state입니다. */
    getState() {
        return this.state;
    }

    /** @returns {Readonly<object>|null} 정확히 한 번만 생성되는 RunFailed 사실입니다. */
    getRunFailedFact() {
        return this.runFailedFact;
    }

    /**
     * RUNNING에서만 DEFEATED로 전이합니다. 이미 defeat된 run은 같은 immutable fact를 유지합니다.
     * @returns {Readonly<{transitioned:boolean,fact:Readonly<object>|null}>}
     */
    transitionToDefeated(options = {}) {
        this.#assertUsable();
        if (this.state !== RUN_OUTCOME_STATE.RUNNING) {
            return Object.freeze({
                transitioned: false,
                fact: this.runFailedFact
            });
        }
        const fact = createRunFailedFact(options);
        this.state = RUN_OUTCOME_STATE.DEFEATED;
        this.runFailedFact = fact;
        return Object.freeze({ transitioned: true, fact });
    }

    /** HUD·테스트용 bounded immutable 상태입니다. */
    getStatus() {
        return Object.freeze({
            state: this.state,
            running: this.isRunning(),
            defeated: this.isDefeated(),
            runFailedFact: this.runFailedFact,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 RunOutcome은 전이할 수 없습니다.');
        }
    }
}
