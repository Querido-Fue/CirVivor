import { assertCoreIntegrity } from '../contract/core_integrity_contract.js';

/**
 * 0 이상의 유한 damage/heal 양을 반환합니다.
 * @param {*} value - 정규화할 값입니다.
 * @returns {number} 안전한 양입니다.
 */
function normalizeIntegrityAmount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

/**
 * @class CoreIntegrity
 * @description GameSystem이 소유하는 The Core 전용 생존 자원 component입니다.
 */
export class CoreIntegrity {
    /**
     * @param {object} options - 생성 옵션입니다.
     * @param {number} options.maxIntegrity - 최대 Integrity입니다.
     * @param {number} [options.currentIntegrity] - 현재 Integrity입니다.
     */
    constructor(options) {
        const maxIntegrity = Number(options?.maxIntegrity);
        const requestedCurrent = Number(options?.currentIntegrity);
        if (!Number.isFinite(maxIntegrity) || maxIntegrity <= 0) {
            throw new RangeError('Core maxIntegrity는 양의 유한수여야 합니다.');
        }

        this.coreIntegrityId = 'the-core:integrity';
        this.maxIntegrity = maxIntegrity;
        this.currentIntegrity = Number.isFinite(requestedCurrent)
            ? Math.min(maxIntegrity, Math.max(0, requestedCurrent))
            : maxIntegrity;
        // Core가 한 번 소진된 run은 회복으로 다시 열리지 않습니다. 비-terminal
        // 회복은 이전처럼 허용하되, depletion은 RunOutcome과 같은 단방향 경계입니다.
        this.terminalSealed = this.currentIntegrity <= 0;
        assertCoreIntegrity(this);
    }

    /** @returns {number} 현재 Integrity입니다. */
    getCurrentIntegrity() {
        return this.currentIntegrity;
    }

    /** @returns {number} 최대 Integrity입니다. */
    getMaxIntegrity() {
        return this.maxIntegrity;
    }

    /** @returns {boolean} Integrity가 모두 소진되었는지 여부입니다. */
    isDepleted() {
        return this.currentIntegrity <= 0;
    }

    /** @returns {boolean} Core depletion으로 더 이상 회복할 수 없는 terminal 상태인지 여부입니다. */
    isTerminallySealed() {
        return this.terminalSealed === true;
    }

    /**
     * 검증된 전투 경계가 전달한 damage를 반영합니다.
     * @param {*} amount - 피해량입니다.
     * @returns {number} 실제 감소한 Integrity입니다.
     */
    applyIntegrityDamage(amount) {
        if (this.terminalSealed) {
            return 0;
        }
        const safeAmount = normalizeIntegrityAmount(amount);
        const applied = Math.min(this.currentIntegrity, safeAmount);
        this.currentIntegrity -= applied;
        if (this.currentIntegrity <= 0) {
            this.currentIntegrity = 0;
            this.terminalSealed = true;
        }
        return applied;
    }

    /**
     * Integrity를 최대값 이내로 회복합니다.
     * @param {*} amount - 회복량입니다.
     * @returns {number} 실제 회복한 Integrity입니다.
     */
    restoreIntegrity(amount) {
        if (this.terminalSealed) {
            return 0;
        }
        const safeAmount = normalizeIntegrityAmount(amount);
        const restored = Math.min(this.maxIntegrity - this.currentIntegrity, safeAmount);
        this.currentIntegrity += restored;
        return restored;
    }
}
