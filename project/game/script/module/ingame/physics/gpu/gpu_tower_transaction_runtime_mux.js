function assertRuntime(runtime, label) {
    for (const method of [
        'canAccept',
        'getStagedTransaction',
        'encode',
        'encodeReadback',
        'markSubmitted',
        'failEncoded',
        'getStatus',
        'retire'
    ]) {
        if (typeof runtime?.[method] !== 'function') {
            throw new TypeError(`${label}.${method}()가 필요합니다.`);
        }
    }
    return runtime;
}

/**
 * GpuCircleBodySimulation의 기존 Tower creation fixed hook을 그대로 보존하면서
 * creation 또는 merge 중 정확히 하나만 같은 main encoder에 싣는 좁은 mux입니다.
 */
export class GpuTowerTransactionRuntimeMux {
    constructor(creationRuntime, mergeRuntime) {
        this.creationRuntime = assertRuntime(
            creationRuntime,
            'Tower transaction creationRuntime'
        );
        this.mergeRuntime = assertRuntime(
            mergeRuntime,
            'Tower transaction mergeRuntime'
        );
        this.activeRuntime = null;
    }

    canStageCreation() {
        return this.mergeRuntime.getStagedTransaction() === null
            && this.mergeRuntime.getStatus?.().pendingTransaction == null;
    }

    canStageMerge() {
        return this.creationRuntime.getStagedTransaction() === null
            && this.creationRuntime.getStatus?.().pendingTransaction == null;
    }

    getStagedTransaction() {
        const creation = this.creationRuntime.getStagedTransaction();
        const merge = this.mergeRuntime.getStagedTransaction();
        if (creation && merge) {
            throw new Error('Tower creation/merge transaction이 동시에 stage되었습니다.');
        }
        this.activeRuntime = creation
            ? this.creationRuntime
            : merge
                ? this.mergeRuntime
                : null;
        return creation ?? merge ?? null;
    }

    encode(pass, sourceTick) {
        const runtime = this.#resolveActiveRuntime(sourceTick, 'encode');
        return runtime.encode(pass, sourceTick);
    }

    encodeReadback(encoder, sourceTick) {
        const runtime = this.#resolveActiveRuntime(sourceTick, 'copy');
        return runtime.encodeReadback(encoder, sourceTick);
    }

    markSubmitted(sourceTick) {
        const runtime = this.#resolveActiveRuntime(sourceTick, 'submit');
        const result = runtime.markSubmitted(sourceTick);
        this.activeRuntime = null;
        return result;
    }

    failEncoded(error) {
        const runtime = this.activeRuntime;
        this.activeRuntime = null;
        return runtime?.failEncoded(error) ?? false;
    }

    /** 기존 creation status shape를 보존하면서 merge 상태를 함께 노출합니다. */
    getStatus() {
        const creation = this.creationRuntime.getStatus();
        const merge = this.mergeRuntime.getStatus();
        const creationPending = creation.pendingTransaction ?? null;
        const mergePending = merge.pendingTransaction ?? null;
        return Object.freeze({
            ...creation,
            pendingTransaction: creationPending ?? mergePending,
            transactionKind: creationPending
                ? 'creation'
                : mergePending
                    ? 'merge'
                    : null,
            mergeState: merge.state,
            mergePendingReadbackCount: merge.pendingReadbackCount ?? 0,
            mergeRequiresRecovery: merge.requiresRecovery === true,
            requiresRecovery: creation.requiresRecovery === true
                || merge.requiresRecovery === true
        });
    }

    /** simulation resource retirement는 결합된 두 runtime lease를 함께 폐기합니다. */
    retire(reason = 'simulation-resource-retired') {
        this.activeRuntime = null;
        this.creationRuntime.retire(reason);
        this.mergeRuntime.retire(reason);
        return true;
    }

    #resolveActiveRuntime(sourceTick, stage) {
        const tick = Number(sourceTick);
        const runtime = this.activeRuntime;
        const envelope = runtime?.getStagedTransaction?.()
            ?? runtime?.getStatus?.().pendingTransaction
            ?? null;
        if (!runtime || envelope?.sourceTick !== tick) {
            throw new Error(`Tower transaction mux ${stage} 순서가 유효하지 않습니다.`);
        }
        return runtime;
    }
}
