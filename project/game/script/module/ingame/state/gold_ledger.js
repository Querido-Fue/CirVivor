const DEFAULT_TRANSACTION_HISTORY_CAPACITY = 65536;

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

/**
 * GPU world 교체와 독립된 CPU run-domain Gold authority입니다. 모든 증가는
 * stable transaction ID로 멱등 처리되며 감소/임의 set API는 R3에 노출하지 않습니다.
 */
export class GoldLedger {
    constructor(options = {}) {
        this.balance = requireNonNegativeSafeInteger(
            options.initialGold ?? 0,
            'initialGold'
        );
        this.transactionHistoryCapacity = requirePositiveSafeInteger(
            options.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_HISTORY_CAPACITY,
            'transactionHistoryCapacity'
        );
        this.knownTransactionIds = new Set();
        this.transactionOrder = [];
        this.totalCredited = 0;
        this.creditCount = 0;
        this.lastCredit = null;
        this.destroyed = false;
    }

    /** 인증된 CPU domain producer만 stable transaction을 credit합니다. */
    credit(source = {}) {
        if (this.destroyed) {
            return Object.freeze({ accepted: false, reason: 'destroyed' });
        }
        const transactionId = requireNonEmptyString(
            source.transactionId,
            'gold transactionId'
        );
        const amount = requireNonNegativeSafeInteger(
            source.amount,
            'gold amount'
        );
        const fixedTick = requireNonNegativeSafeInteger(
            source.fixedTick ?? 0,
            'gold fixedTick'
        );
        if (this.knownTransactionIds.has(transactionId)) {
            return Object.freeze({
                accepted: false,
                duplicate: true,
                reason: 'duplicate-transaction',
                transactionId,
                balance: this.balance
            });
        }
        if (this.balance > Number.MAX_SAFE_INTEGER - amount
            || this.totalCredited > Number.MAX_SAFE_INTEGER - amount) {
            throw new RangeError('Gold 안전한 정수 범위를 초과합니다.');
        }
        this.knownTransactionIds.add(transactionId);
        this.transactionOrder.push(transactionId);
        while (this.transactionOrder.length > this.transactionHistoryCapacity) {
            const retired = this.transactionOrder.shift();
            this.knownTransactionIds.delete(retired);
        }
        this.balance += amount;
        this.totalCredited += amount;
        this.creditCount++;
        this.lastCredit = Object.freeze({
            transactionId,
            amount,
            fixedTick,
            sourceKind: source.sourceKind ?? null,
            sourceEntityId: source.sourceEntityId ?? null,
            sourceIncarnation: source.sourceIncarnation ?? null,
            targetEntityId: source.targetEntityId ?? null,
            targetIncarnation: source.targetIncarnation ?? null,
            balance: this.balance
        });
        return Object.freeze({
            accepted: true,
            duplicate: false,
            transactionId,
            amount,
            balance: this.balance
        });
    }

    getBalance() {
        return this.destroyed ? 0 : this.balance;
    }

    getStatus() {
        return Object.freeze({
            gold: this.getBalance(),
            totalCredited: this.totalCredited,
            creditCount: this.creditCount,
            rememberedTransactionCount: this.knownTransactionIds.size,
            lastCredit: this.lastCredit,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.knownTransactionIds.clear();
        this.transactionOrder.length = 0;
        this.lastCredit = null;
    }
}
