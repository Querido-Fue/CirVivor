import {
    TOWER_MERGE_LIFECYCLE_DISPOSITION,
    TOWER_MERGE_REASON,
    TOWER_MERGE_RESULT,
    requirePositiveSafeInteger
} from './tower_group_contract.js';

const DEFAULT_HISTORY_CAPACITY = 1024;

const REQUIRED_BACKEND_METHODS = Object.freeze([
    'canStageTowerMerge',
    'stageTowerMergeTransaction',
    'drainCompletedTowerMergeTransactions',
    'finalizeTowerMergeTransaction',
    'cleanupTowerMergeTransaction',
    'cancelAllTowerMerges',
    'getTowerMergeRuntimeStatus',
    'getEventProtocolState'
]);

const REQUIRED_REGISTRY_METHODS = Object.freeze([
    'has',
    'remove',
    'getStatus'
]);

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function exactHandleKey(handle) {
    return `${Number(handle?.entityId)}:${Number(handle?.incarnation)}`;
}

function freezeFailure(stage, error) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error)
    });
}

function terminalReceipt(result, reason, source = {}) {
    return Object.freeze({
        accepted: result === TOWER_MERGE_RESULT.COMMITTED,
        committed: result === TOWER_MERGE_RESULT.COMMITTED,
        result,
        reason,
        recoveryRequired: result === TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
        mutationCount: 0,
        disposition: result === TOWER_MERGE_RESULT.COMMITTED
            ? TOWER_MERGE_LIFECYCLE_DISPOSITION
            : null,
        cleanupReceipts: Object.freeze([]),
        pending: false,
        staged: false,
        terminal: true,
        ...source
    });
}

/**
 * CPU TowerGroup plan, one GPU merge program, exact body cleanup, registry 제거,
 * ledger commit을 owner fixed boundary에서 직렬화합니다.
 */
export class TowerMergeCoordinator {
    constructor(options = {}) {
        const state = options.towerGroupState;
        for (const method of [
            'planMerge',
            'previewMerge',
            'refreshPendingMerge',
            'commitMerge',
            'rejectMerge',
            'getTowerRecords'
        ]) {
            if (typeof state?.[method] !== 'function') {
                throw new TypeError(`TowerMergeCoordinator state.${method}()가 필요합니다.`);
            }
        }
        for (const method of REQUIRED_BACKEND_METHODS) {
            if (typeof options.backend?.[method] !== 'function') {
                throw new TypeError(`Tower merge backend.${method}()가 필요합니다.`);
            }
        }
        for (const method of REQUIRED_REGISTRY_METHODS) {
            if (typeof options.registry?.[method] !== 'function') {
                throw new TypeError(`Tower merge registry.${method}()가 필요합니다.`);
            }
        }
        this.towerGroupState = state;
        this.backend = options.backend;
        this.registry = options.registry;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'Tower merge coordinator historyCapacity'
        );
        this.pending = null;
        this.history = new Map();
        this.historyOrder = [];
        this.lastResult = null;
        this.failure = null;
        this.destroyed = false;
        this.requestedCount = 0;
        this.stagedCount = 0;
        this.committedCount = 0;
        this.rejectedCount = 0;
        this.replayedCount = 0;
        this.protocolFailureCount = 0;
        this.cleanupCount = 0;
    }

    requestTowerMerge(source = {}) {
        if (this.destroyed || this.failure) {
            return terminalReceipt(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                this.destroyed
                    ? TOWER_MERGE_REASON.DESTROYED
                    : 'RECOVERY_REQUIRED',
                { failure: this.failure }
            );
        }
        this.requestedCount++;
        let plan;
        try {
            plan = this.towerGroupState.planMerge(source);
        } catch (error) {
            return this.#latchProtocolFailure('tower-merge-plan', error);
        }
        const transactionId = plan?.transactionId
            ?? source?.transactionId
            ?? null;
        const known = typeof transactionId === 'string'
            ? this.history.get(transactionId)
            : null;
        if (known) {
            if (plan === known.plan
                || (plan?.fingerprint
                    && plan.fingerprint === known.plan?.fingerprint)) {
                this.replayedCount++;
                return known.receipt;
            }
            if (plan?.result === TOWER_MERGE_RESULT.PROTOCOL_FAILURE) {
                this.protocolFailureCount++;
            }
            return plan;
        }
        if (plan?.accepted !== true) {
            const receipt = terminalReceipt(
                plan?.result ?? TOWER_MERGE_RESULT.REJECTED,
                plan?.reason ?? TOWER_MERGE_REASON.REJECTED,
                { ...plan }
            );
            this.rejectedCount++;
            this.#remember(transactionId, plan, receipt);
            this.lastResult = receipt;
            return receipt;
        }
        if (this.pending) {
            const rejected = this.towerGroupState.rejectMerge(
                plan,
                TOWER_MERGE_REASON.MERGE_TRANSACTION_PENDING,
                TOWER_MERGE_RESULT.REJECTED_CONFLICTING_TRANSACTION
            );
            const receipt = terminalReceipt(
                rejected.result,
                rejected.reason,
                { ...rejected }
            );
            this.rejectedCount++;
            this.#remember(transactionId, plan, receipt);
            this.lastResult = receipt;
            return receipt;
        }
        const receipt = Object.freeze({
            ...plan,
            pending: true,
            staged: false,
            terminal: false,
            phase: 'planned'
        });
        this.pending = {
            plan,
            protocol: null,
            stageReceipt: null,
            phase: 'planned'
        };
        this.#remember(transactionId, plan, receipt);
        this.lastResult = receipt;
        return receipt;
    }

    previewTowerMerge(source = {}) {
        if (this.destroyed || this.failure) {
            return terminalReceipt(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                this.destroyed
                    ? TOWER_MERGE_REASON.DESTROYED
                    : 'RECOVERY_REQUIRED',
                { failure: this.failure, executionEnabled: false }
            );
        }
        const plan = this.towerGroupState.previewMerge(source);
        const available = plan?.accepted === true
            && this.pending === null
            && this.backend.canStageTowerMerge();
        const runtime = this.backend.getTowerMergeRuntimeStatus();
        return Object.freeze({
            ...plan,
            accepted: available,
            executionEnabled: available,
            reason: plan?.accepted !== true
                ? plan.reason
                : this.pending
                    ? TOWER_MERGE_REASON.MERGE_TRANSACTION_PENDING
                    : runtime?.requiresRecovery
                        ? 'PROGRAM_RECOVERY_REQUIRED'
                        : available
                            ? null
                            : 'PROGRAM_CAPACITY',
            runtime
        });
    }

    stageForFixedTick(proposedFixedTick) {
        const tick = requirePositiveSafeInteger(
            proposedFixedTick,
            'Tower merge proposedFixedTick'
        );
        if (!this.pending || this.destroyed || this.failure) {
            return this.lastResult;
        }
        if (this.pending.phase !== 'planned') {
            return this.#pendingReceipt();
        }
        if (tick < this.pending.plan.requestedFixedTick) {
            return this.#pendingReceipt();
        }
        const refreshed = this.towerGroupState.refreshPendingMerge(
            this.pending.plan
        );
        if (refreshed?.accepted !== true) {
            const receipt = terminalReceipt(
                refreshed?.result ?? TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED,
                refreshed?.reason ?? TOWER_MERGE_REASON.SOURCE_CHANGED,
                { ...refreshed }
            );
            this.rejectedCount++;
            this.#complete(receipt);
            return receipt;
        }
        if (refreshed !== this.pending.plan) {
            this.pending.plan = refreshed;
            const entry = this.history.get(refreshed.transactionId);
            if (entry) entry.plan = refreshed;
        }
        if (!this.backend.canStageTowerMerge()) {
            const status = this.backend.getTowerMergeRuntimeStatus();
            if (status?.requiresRecovery) {
                return this.#latchProtocolFailure(
                    'tower-merge-runtime-unavailable',
                    status?.failure ?? status
                );
            }
            return this.#pendingReceipt('program-capacity');
        }
        const protocol = this.backend.getEventProtocolState();
        let staged;
        try {
            staged = this.backend.stageTowerMergeTransaction({
                plan: refreshed,
                sourceTick: tick
            });
        } catch (error) {
            return this.#latchProtocolFailure('tower-merge-stage', error);
        }
        if (staged?.accepted !== true) {
            if (staged?.recoveryRequired === true) {
                return this.#latchProtocolFailure(
                    'tower-merge-stage',
                    staged.failure ?? staged
                );
            }
            if (staged?.reason === 'tower-merge-source-changed') {
                const rejected = this.towerGroupState.rejectMerge(
                    refreshed,
                    TOWER_MERGE_REASON.SOURCE_CHANGED,
                    TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED
                );
                const receipt = terminalReceipt(
                    rejected.result,
                    rejected.reason,
                    { ...rejected }
                );
                this.rejectedCount++;
                this.#complete(receipt);
                return receipt;
            }
            return this.#pendingReceipt(staged?.reason ?? 'program-capacity');
        }
        this.pending.protocol = protocol;
        this.pending.stageReceipt = staged;
        this.pending.phase = 'gpu-staged';
        this.stagedCount++;
        const receipt = this.#pendingReceipt();
        this.#setHistoryReceipt(refreshed.transactionId, receipt);
        this.lastResult = receipt;
        return receipt;
    }

    observeCompletedAtFixedBoundary(proposedFixedTick) {
        const tick = requirePositiveSafeInteger(
            proposedFixedTick,
            'Tower merge completion fixedTick'
        );
        if (!this.pending || this.destroyed || this.failure) {
            return this.lastResult;
        }
        if (this.pending.phase !== 'gpu-staged') {
            return this.#pendingReceipt();
        }
        const completions = this.backend
            .drainCompletedTowerMergeTransactions([]);
        if (completions.length === 0) return this.#pendingReceipt();
        if (completions.length !== 1) {
            return this.#latchProtocolFailure(
                'tower-merge-completion-cardinality',
                new Error(`completionCount=${completions.length}`)
            );
        }
        const completion = completions[0];
        const pending = this.pending;
        const authentic = tick > pending.stageReceipt.sourceTick
            && completion?.transactionId === pending.plan.transactionId
            && completion.planFingerprint === pending.plan.fingerprint
            && completion.sourceTick === pending.stageReceipt.sourceTick
            && completion.sourceCount === pending.plan.sourceCount
            && sameProtocol(completion, pending.protocol)
            && completion.survivorHandle?.entityId
                === pending.plan.survivor.exactGpuBinding.entityId
            && completion.survivorHandle?.incarnation
                === pending.plan.survivor.exactGpuBinding.incarnation;
        if (!authentic || completion.recoveryRequired === true) {
            try {
                this.backend.finalizeTowerMergeTransaction({
                    transactionId: pending.plan.transactionId,
                    planFingerprint: pending.plan.fingerprint,
                    committed: false,
                    recoveryRequired: true
                });
            } catch { /* recovery latch below */ }
            return this.#latchProtocolFailure(
                'tower-merge-completion-protocol',
                completion
            );
        }
        if (completion.rejectedSourceChanged === true) {
            const backend = this.backend.finalizeTowerMergeTransaction({
                transactionId: pending.plan.transactionId,
                planFingerprint: pending.plan.fingerprint,
                committed: false,
                recoveryRequired: false
            });
            const ledger = this.towerGroupState.rejectMerge(
                pending.plan,
                TOWER_MERGE_REASON.SOURCE_CHANGED,
                TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED
            );
            if (backend?.accepted !== true
                || backend?.requiresRecovery === true
                || ledger?.result === TOWER_MERGE_RESULT.PROTOCOL_FAILURE) {
                return this.#latchProtocolFailure(
                    'tower-merge-rejection-rollback',
                    backend?.failure ?? ledger
                );
            }
            const receipt = terminalReceipt(
                ledger.result,
                ledger.reason,
                {
                    ...ledger,
                    sourceTick: completion.sourceTick,
                    evidence: completion.evidence
                }
            );
            this.rejectedCount++;
            this.#complete(receipt);
            return receipt;
        }
        if (completion.committed !== true) {
            return this.#latchProtocolFailure(
                'tower-merge-unknown-completion',
                completion
            );
        }

        const consumedHandles = pending.plan.consumed.map(
            (record) => record.exactGpuBinding
        );
        if (consumedHandles.some((handle) => !this.registry.has(handle))) {
            return this.#latchProtocolFailure(
                'tower-merge-registry-preflight',
                new Error('consumed exact registry identity가 stale입니다.')
            );
        }
        const finalized = this.backend.finalizeTowerMergeTransaction({
            transactionId: pending.plan.transactionId,
            planFingerprint: pending.plan.fingerprint,
            committed: true,
            recoveryRequired: false
        });
        if (finalized?.accepted !== true
            || finalized?.committed !== true
            || !finalized.cleanupToken) {
            return this.#latchProtocolFailure(
                'tower-merge-backend-finalize',
                finalized?.failure ?? finalized
            );
        }
        const cleanup = this.backend.cleanupTowerMergeTransaction(
            finalized.cleanupToken
        );
        if (cleanup?.accepted !== true
            || cleanup.cleanedCount !== consumedHandles.length
            || cleanup.disposition !== TOWER_MERGE_LIFECYCLE_DISPOSITION) {
            return this.#latchProtocolFailure(
                'tower-merge-body-cleanup',
                cleanup?.failure ?? cleanup
            );
        }
        const cleanupReceipts = [];
        for (const handle of consumedHandles) {
            if (!this.registry.remove(handle)) {
                return this.#latchProtocolFailure(
                    'tower-merge-registry-cleanup',
                    new Error(`registry remove failed: ${exactHandleKey(handle)}`)
                );
            }
            cleanupReceipts.push(Object.freeze({
                handle: Object.freeze({
                    entityId: handle.entityId,
                    incarnation: handle.incarnation
                }),
                disposition: TOWER_MERGE_LIFECYCLE_DISPOSITION,
                deathEventCount: 0,
                rewardMutationCount: 0
            }));
        }
        const ledger = this.towerGroupState.commitMerge(pending.plan);
        if (ledger?.accepted !== true
            || ledger.result !== TOWER_MERGE_RESULT.COMMITTED
            || ledger.consumedCount !== consumedHandles.length) {
            return this.#latchProtocolFailure(
                'tower-merge-ledger-commit',
                ledger
            );
        }
        const receipt = terminalReceipt(
            TOWER_MERGE_RESULT.COMMITTED,
            null,
            {
                ...ledger,
                accepted: true,
                committed: true,
                mutationCount: ledger.mutationCount,
                sourceTick: completion.sourceTick,
                submittedTick: completion.submittedTick,
                cleanupFixedTick: tick,
                disposition: TOWER_MERGE_LIFECYCLE_DISPOSITION,
                cleanupReceipts: Object.freeze(cleanupReceipts),
                survivorHandle: completion.survivorHandle,
                evidence: completion.evidence,
                deathEventCount: 0,
                lostShareMutationCount: 0,
                goldMutationCount: 0,
                rewardMutationCount: 0
            }
        );
        this.cleanupCount += cleanupReceipts.length;
        this.committedCount++;
        this.#complete(receipt);
        return receipt;
    }

    getStatus() {
        return Object.freeze({
            destroyed: this.destroyed,
            failure: this.failure,
            requiresRecovery: this.failure !== null,
            pending: this.pending ? Object.freeze({
                transactionId: this.pending.plan.transactionId,
                planFingerprint: this.pending.plan.fingerprint,
                sourceCount: this.pending.plan.sourceCount,
                phase: this.pending.phase,
                sourceTick: this.pending.stageReceipt?.sourceTick ?? 0
            }) : null,
            requestedCount: this.requestedCount,
            stagedCount: this.stagedCount,
            committedCount: this.committedCount,
            rejectedCount: this.rejectedCount,
            replayedCount: this.replayedCount,
            protocolFailureCount: this.protocolFailureCount,
            cleanupCount: this.cleanupCount,
            rememberedTransactionCount: this.history.size,
            historyCapacity: this.historyCapacity,
            runtime: this.backend?.getTowerMergeRuntimeStatus?.() ?? null,
            lastResult: this.lastResult
        });
    }

    requiresRecovery() {
        return this.failure !== null
            || this.backend?.getTowerMergeRuntimeStatus?.()
                ?.requiresRecovery === true;
    }

    cancelPending(reason = 'cancelled') {
        if (!this.pending) {
            return Object.freeze({
                accepted: true,
                cancelledCount: 0,
                reason,
                recoveryRequired: false
            });
        }
        const pending = this.pending;
        const backend = this.backend.cancelAllTowerMerges(reason);
        let ledger;
        try {
            ledger = this.towerGroupState.rejectMerge(
                pending.plan,
                TOWER_MERGE_REASON.REJECTED,
                backend?.requiresRecovery
                    ? TOWER_MERGE_RESULT.PROTOCOL_FAILURE
                    : TOWER_MERGE_RESULT.REJECTED
            );
        } catch (error) {
            ledger = error;
        }
        this.pending = null;
        if (backend?.requiresRecovery === true
            || ledger?.result === TOWER_MERGE_RESULT.PROTOCOL_FAILURE
            || ledger instanceof Error) {
            return this.#latchProtocolFailure(
                'tower-merge-cancel',
                backend?.failure ?? ledger
            );
        }
        const receipt = terminalReceipt(
            TOWER_MERGE_RESULT.REJECTED,
            TOWER_MERGE_REASON.REJECTED,
            { transactionId: pending.plan.transactionId }
        );
        this.rejectedCount++;
        this.#setHistoryReceipt(pending.plan.transactionId, receipt);
        this.lastResult = receipt;
        return Object.freeze({
            accepted: true,
            cancelledCount: 1,
            reason,
            recoveryRequired: false,
            receipt
        });
    }

    destroy() {
        if (this.destroyed) return;
        try { this.cancelPending('destroyed'); } catch { /* teardown */ }
        this.destroyed = true;
        this.pending = null;
        this.history.clear();
        this.historyOrder.length = 0;
    }

    #pendingReceipt(deferredReason = null) {
        if (!this.pending) return this.lastResult;
        return Object.freeze({
            ...this.pending.plan,
            pending: true,
            staged: this.pending.phase === 'gpu-staged',
            terminal: false,
            phase: this.pending.phase,
            sourceTick: this.pending.stageReceipt?.sourceTick ?? 0,
            deferredReason,
            recoveryRequired: false
        });
    }

    #remember(transactionId, plan, receipt) {
        if (typeof transactionId !== 'string' || transactionId.length === 0) {
            return;
        }
        this.history.set(transactionId, { plan, receipt });
        this.historyOrder.push(transactionId);
        while (this.historyOrder.length > this.historyCapacity) {
            const retired = this.historyOrder.shift();
            if (retired !== transactionId) this.history.delete(retired);
        }
    }

    #setHistoryReceipt(transactionId, receipt) {
        const entry = this.history.get(transactionId);
        if (entry) entry.receipt = receipt;
    }

    #complete(receipt) {
        const transactionId = this.pending?.plan.transactionId
            ?? receipt?.transactionId;
        this.#setHistoryReceipt(transactionId, receipt);
        this.pending = null;
        this.lastResult = receipt;
    }

    #latchProtocolFailure(stage, evidence) {
        const pending = this.pending;
        if (pending) {
            try {
                this.backend.cancelAllTowerMerges(stage);
            } catch { /* recovery latch */ }
            try {
                this.towerGroupState.rejectMerge(
                    pending.plan,
                    TOWER_MERGE_REASON.SOURCE_CHANGED,
                    TOWER_MERGE_RESULT.PROTOCOL_FAILURE
                );
            } catch { /* recovery latch */ }
        }
        this.failure = freezeFailure(stage, evidence);
        this.protocolFailureCount++;
        const receipt = terminalReceipt(
            TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
            stage,
            {
                transactionId: pending?.plan.transactionId ?? null,
                planFingerprint: pending?.plan.fingerprint ?? null,
                failure: this.failure
            }
        );
        if (pending) this.#setHistoryReceipt(pending.plan.transactionId, receipt);
        this.pending = null;
        this.lastResult = receipt;
        return receipt;
    }
}
