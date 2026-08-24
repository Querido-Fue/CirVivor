import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import { WAVE_RUN_STATE } from '../contract/wave_run_state_contract.js';

export const R9_GPU_RECOVERY_MATRIX_STATES = Object.freeze([
    WAVE_RUN_STATE.WAVE_ACTIVE,
    WAVE_RUN_STATE.DEADLINE_SPAWN_DRAIN,
    WAVE_RUN_STATE.OVERTIME,
    WAVE_RUN_STATE.SETTLEMENT_PENDING,
    WAVE_RUN_STATE.SHOP_OPENING,
    WAVE_RUN_STATE.SHOP,
    WAVE_RUN_STATE.NEXT_WAVE_PREPARE
]);

const RECOVERY_MATRIX_STATE_SET = new Set(R9_GPU_RECOVERY_MATRIX_STATES);

export const R9_RECOVERY_CONTINUITY_RESULT_CODE = Object.freeze({
    PRESERVED: 'PRESERVED',
    CPU_STATE_CHANGED: 'CPU_STATE_CHANGED'
});

export const R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
    = 'CURRENT_WAVE_TRANSIENT_ACTORS_REARM_FROM_EXISTING_POLICY_NO_FULL_GPU_CHECKPOINT';

function nonNegativeSafeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function nullableString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function freezeWordSlots(slots) {
    if (!Array.isArray(slots)) return Object.freeze([]);
    if (slots.length > 5) {
        throw new RangeError('R9 recovery word slot snapshot은 최대 5개입니다.');
    }
    return Object.freeze(slots.map((slot) => Object.freeze({
        slotId: nullableString(slot?.slotId),
        compiledAbilityId: nullableString(slot?.compiledAbilityId),
        remainingTicks: nonNegativeSafeInteger(slot?.cooldown?.remainingTicks),
        nextEligibleFixedTick: nonNegativeSafeInteger(
            slot?.cooldown?.nextEligibleFixedTick
        )
    })));
}

/** restartable GPU world 교체 전후에 비교할 bounded CPU-only 상태입니다. */
export function createR9RecoveryContinuitySnapshot(source = {}) {
    const waveState = nullableString(source.wave?.state)
        ?? WAVE_RUN_STATE.INACTIVE;
    const cpuState = Object.freeze({
        fixedTick: nonNegativeSafeInteger(source.fixedTick),
        wave: Object.freeze({
            state: waveState,
            waveOrdinal: nonNegativeSafeInteger(source.wave?.waveOrdinal),
            waveId: nullableString(source.wave?.waveId),
            elapsedCombatTicks: nonNegativeSafeInteger(
                source.wave?.elapsedCombatTicks
            ),
            deadlineReached: source.wave?.deadlineReached === true,
            overtimeStarted: source.wave?.overtimeStarted === true,
            completionRevision: nonNegativeSafeInteger(
                source.wave?.completionRevision
            ),
            factRevision: nonNegativeSafeInteger(source.wave?.factRevision)
        }),
        pressure: Object.freeze({
            overtimePulseOrdinal: nonNegativeSafeInteger(
                source.pressure?.overtimePulseOrdinal
            ),
            overtimeDamageTotalFixedPoint: nonNegativeSafeInteger(
                source.pressure?.overtimeDamageTotalFixedPoint
            ),
            nextPulseFixedTick: nonNegativeSafeInteger(
                source.pressure?.nextPulseFixedTick
            )
        }),
        settlement: Object.freeze({
            activeTransactionId: nullableString(
                source.settlement?.activeTransactionId
            ),
            activeStage: nullableString(source.settlement?.activeStage),
            settlementOrdinal: nonNegativeSafeInteger(
                source.settlement?.settlementOrdinal
            ),
            commitCount: nonNegativeSafeInteger(
                source.settlement?.commitCount
            ),
            openRequestCount: nonNegativeSafeInteger(
                source.settlement?.openRequestCount
            ),
            openCount: nonNegativeSafeInteger(source.settlement?.openCount),
            rewardPublished: source.settlement?.rewardPublished === true,
            shopOpened: source.settlement?.shopOpened === true,
            lastReceiptCode: nullableString(
                source.settlement?.lastReceipt?.code
            )
        }),
        shopPhase: Object.freeze({
            phase: nullableString(source.shopPhase?.phase),
            pendingOpenTransactionId: nullableString(
                source.shopPhase?.pendingOpenRequest?.transactionId
            ),
            pendingCloseTransactionId: nullableString(
                source.shopPhase?.pendingCloseTransactionId
            ),
            openCount: nonNegativeSafeInteger(source.shopPhase?.openCount),
            closeCount: nonNegativeSafeInteger(source.shopPhase?.closeCount)
        }),
        shop: Object.freeze({
            active: source.shop?.active === true,
            revision: nonNegativeSafeInteger(source.shop?.revision),
            shopSessionOrdinal: nonNegativeSafeInteger(
                source.shop?.shopSessionOrdinal
            ),
            rerollOrdinal: nonNegativeSafeInteger(source.shop?.rerollOrdinal),
            rowFingerprint: nonNegativeSafeInteger(
                source.shop?.row?.rowFingerprint
            ),
            openCount: nonNegativeSafeInteger(source.shop?.openCount),
            closeCount: nonNegativeSafeInteger(source.shop?.closeCount)
        }),
        commerce: Object.freeze({
            gold: nonNegativeSafeInteger(source.commerce?.gold),
            commerceRevision: nonNegativeSafeInteger(
                source.commerce?.commerceRevision
            ),
            inventoryRevision: nonNegativeSafeInteger(
                source.commerce?.inventoryRevision
            ),
            inventoryFingerprint: nonNegativeSafeInteger(
                source.commerce?.inventoryFingerprint
            ),
            creditCount: nonNegativeSafeInteger(source.commerce?.creditCount),
            purchaseCount: nonNegativeSafeInteger(
                source.commerce?.purchaseCount
            ),
            upgradeCount: nonNegativeSafeInteger(
                source.commerce?.upgradeCount
            ),
            pendingTransactionCount: nonNegativeSafeInteger(
                source.commerce?.pendingTransactionCount
            )
        }),
        board: Object.freeze({
            boardRevision: nonNegativeSafeInteger(
                source.board?.boardRevision
            ),
            draftRevision: nonNegativeSafeInteger(
                source.board?.draftRevision
            ),
            inventoryRevision: nonNegativeSafeInteger(
                source.board?.inventoryRevision
            ),
            boardFingerprint: nonNegativeSafeInteger(
                source.board?.boardFingerprint
            ),
            draftOpen: source.board?.draftSlots !== null
                && source.board?.draftSlots !== undefined
        }),
        words: Object.freeze({
            phase: nullableString(source.words?.phase),
            pendingActivationCount: nonNegativeSafeInteger(
                source.words?.pendingActivationCount
            ),
            slots: freezeWordSlots(source.words?.slots)
        }),
        core: Object.freeze({
            currentIntegrity: nonNegativeSafeInteger(
                source.core?.currentIntegrity
            ),
            maxIntegrity: nonNegativeSafeInteger(source.core?.maxIntegrity),
            runOutcomeState: nullableString(source.core?.runOutcomeState)
        }),
        progression: Object.freeze({
            pendingShopClose: source.progression?.pendingShopClose === true,
            pendingNextWaveOrdinal: nonNegativeSafeInteger(
                source.progression?.pendingNextWaveOrdinal
            ),
            pendingNextTransactionId: nullableString(
                source.progression?.pendingNextTransactionId
            )
        })
    });
    return Object.freeze({
        waveState,
        matrixStateCovered: RECOVERY_MATRIX_STATE_SET.has(waveState),
        fingerprint: fingerprintR8Record(
            'r9-gpu-recovery-cpu-continuity',
            cpuState
        ),
        cpuState,
        transientRearmLimitation:
            R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
    });
}

export function auditR9RecoveryContinuity(before, after) {
    if (!before?.cpuState || !after?.cpuState) {
        throw new TypeError('R9 recovery continuity snapshot 두 개가 필요합니다.');
    }
    const rewardDuplicateCount = Math.max(
        0,
        after.cpuState.commerce.creditCount
            - before.cpuState.commerce.creditCount
    );
    const shopDuplicateCount = Math.max(
        0,
        after.cpuState.shopPhase.openCount
            - before.cpuState.shopPhase.openCount
    );
    const mapClearDuplicateCount = Math.max(
        0,
        after.cpuState.wave.factRevision
            - before.cpuState.wave.factRevision
    );
    const elapsedRollback = after.cpuState.wave.elapsedCombatTicks
        < before.cpuState.wave.elapsedCombatTicks;
    const pulseRollback = after.cpuState.pressure.overtimePulseOrdinal
        < before.cpuState.pressure.overtimePulseOrdinal;
    const preserved = before.fingerprint === after.fingerprint;
    return Object.freeze({
        accepted: preserved,
        code: preserved
            ? R9_RECOVERY_CONTINUITY_RESULT_CODE.PRESERVED
            : R9_RECOVERY_CONTINUITY_RESULT_CODE.CPU_STATE_CHANGED,
        preserved,
        beforeFingerprint: before.fingerprint,
        afterFingerprint: after.fingerprint,
        waveStateBefore: before.waveState,
        waveStateAfter: after.waveState,
        matrixStateCovered:
            before.matrixStateCovered && after.matrixStateCovered,
        rewardDuplicateCount,
        shopDuplicateCount,
        mapClearDuplicateCount,
        elapsedRollback,
        pulseRollback,
        rollbackDetected: elapsedRollback || pulseRollback,
        oldCallbackIsolationPolicy: 'GPU_WORLD_GENERATION_GUARD',
        automaticRestartCount: 0,
        restartStormDetected: false,
        transientRearmLimitation:
            R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION
    });
}
