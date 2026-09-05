import assert from 'node:assert/strict';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R9_WAVE_FLOW_SEMANTIC_SURFACE,
    createR9WaveFlowPresentation
} = await loadGameModule(
    'scene/game/render/r9_wave_flow_presentation_model.js'
);
const {
    R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION,
    R9_GPU_RECOVERY_MATRIX_STATES,
    auditR9RecoveryContinuity,
    createR9RecoveryContinuitySnapshot
} = await loadGameModule('ingame/flow/r9_recovery_continuity_contract.js');

function createFlow(overrides = {}) {
    return Object.freeze({
        configured: true,
        waveOrdinal: 1,
        totalWaveCount: 3,
        waveId: 'wave-1',
        waveState: 'WAVE_ACTIVE',
        elapsedTicks: 20,
        remainingTicks: 40,
        deadlineReached: false,
        hostileActorCount: 7,
        siegeWeight: 7.5,
        overtimeActive: false,
        overtimePulseOrdinal: 0,
        ticksUntilNextPulse: 0,
        projectedNextDamageFixedPoint: 0,
        settlementCode: null,
        perEnemyUiObjectCount: 0,
        shopPreview: Object.freeze({
            completedWaveOrdinal: 0,
            completedWaveId: null,
            clearType: null,
            overtimePulseCount: 0,
            overtimeDamageTotalFixedPoint: 0,
            nextWaveId: null,
            finalWave: false,
            mapClearReady: false
        }),
        ...overrides
    });
}

test('R9 presentation model은 여섯 semantic surface와 전환 문구를 bounded immutable model로 만든다', () => {
    const active = createR9WaveFlowPresentation(createFlow());
    assert.equal(active.primarySemanticSurface,
        R9_WAVE_FLOW_SEMANTIC_SURFACE.HUD_WAVE_ACTIVE);
    assert.equal(active.primaryText, 'WAVE 1/3');
    assert.equal(Object.isFrozen(active), true);
    assert.equal(Object.isFrozen(active.semanticSurfaces), true);

    const overtime = createR9WaveFlowPresentation(createFlow({
        waveState: 'OVERTIME',
        overtimeActive: true,
        ticksUntilNextPulse: 3,
        projectedNextDamageFixedPoint: 1200
    }));
    assert.equal(overtime.primarySemanticSurface,
        R9_WAVE_FLOW_SEMANTIC_SURFACE.HUD_OVERTIME);
    assert.match(overtime.secondaryText, /NEXT CORE PRESSURE 3 TICKS/u);
    assert.equal(overtime.accented, true);

    const normalShop = createR9WaveFlowPresentation(createFlow({
        waveState: 'SHOP_OPENING',
        shopPreview: Object.freeze({
            completedWaveOrdinal: 1,
            clearType: 'NORMAL',
            overtimePulseCount: 0,
            overtimeDamageTotalFixedPoint: 0,
            nextWaveId: 'wave-2',
            finalWave: false,
            mapClearReady: false
        })
    }));
    assert.deepEqual(Array.from(normalShop.semanticSurfaces), [
        R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_WAVE_NORMAL_CLEAR
    ]);
    assert.equal(normalShop.secondaryText, 'NEXT WAVE wave-2');

    const overtimeShop = createR9WaveFlowPresentation(createFlow({
        waveState: 'SHOP',
        shopPreview: Object.freeze({
            completedWaveOrdinal: 2,
            clearType: 'OVERTIME',
            overtimePulseCount: 4,
            overtimeDamageTotalFixedPoint: 5000,
            nextWaveId: 'wave-3',
            finalWave: false,
            mapClearReady: false
        })
    }));
    assert.deepEqual(Array.from(overtimeShop.semanticSurfaces), [
        R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_WAVE_OVERTIME_CLEAR
    ]);

    const finalShop = createR9WaveFlowPresentation(createFlow({
        waveOrdinal: 3,
        waveState: 'SHOP',
        shopPreview: Object.freeze({
            completedWaveOrdinal: 3,
            clearType: 'NORMAL',
            overtimePulseCount: 0,
            overtimeDamageTotalFixedPoint: 0,
            nextWaveId: null,
            finalWave: true,
            mapClearReady: false
        })
    }));
    assert.deepEqual(Array.from(finalShop.semanticSurfaces), [
        R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_WAVE_NORMAL_CLEAR,
        R9_WAVE_FLOW_SEMANTIC_SURFACE.SHOP_FINAL_WAVE
    ]);

    const mapClear = createR9WaveFlowPresentation(createFlow({
        waveOrdinal: 3,
        waveState: 'MAP_CLEAR_READY',
        shopPreview: Object.freeze({ mapClearReady: true })
    }));
    assert.deepEqual(Array.from(mapClear.semanticSurfaces), [
        R9_WAVE_FLOW_SEMANTIC_SURFACE.MAP_CLEAR_READY
    ]);
    assert.equal(mapClear.primaryText, 'MAP CLEAR READY');
});

function createRecoverySource(state, overrides = {}) {
    return {
        fixedTick: 90,
        wave: {
            state,
            waveOrdinal: 2,
            waveId: 'wave-2',
            elapsedCombatTicks: 30,
            deadlineReached: state !== 'WAVE_ACTIVE',
            overtimeStarted: state === 'OVERTIME',
            completionRevision: 1,
            factRevision: 4
        },
        pressure: {
            overtimePulseOrdinal: state === 'OVERTIME' ? 2 : 0,
            overtimeDamageTotalFixedPoint: state === 'OVERTIME' ? 2400 : 0,
            nextPulseFixedTick: state === 'OVERTIME' ? 93 : 0
        },
        settlement: {
            activeTransactionId: 'settlement-2',
            activeStage: 'OPENED',
            settlementOrdinal: 2,
            commitCount: 2,
            openRequestCount: 2,
            openCount: 2,
            rewardPublished: true,
            shopOpened: true,
            lastReceipt: { code: 'OPENED' }
        },
        shopPhase: {
            phase: state === 'SHOP' ? 'SHOP' : 'COMBAT',
            pendingOpenRequest: null,
            pendingCloseTransactionId: null,
            openCount: 2,
            closeCount: 1
        },
        shop: {
            active: state === 'SHOP',
            revision: 5,
            shopSessionOrdinal: 2,
            rerollOrdinal: 0,
            row: { rowFingerprint: 1234 },
            openCount: 2,
            closeCount: 1
        },
        commerce: {
            gold: 150,
            commerceRevision: 2,
            inventoryRevision: 1,
            inventoryFingerprint: 42,
            creditCount: 2,
            purchaseCount: 0,
            upgradeCount: 0,
            pendingTransactionCount: 0
        },
        board: {
            boardRevision: 1,
            draftRevision: 0,
            inventoryRevision: 1,
            boardFingerprint: 88,
            draftSlots: null
        },
        words: {
            phase: state === 'SHOP' ? 'PAUSE' : 'COMBAT',
            pendingActivationCount: 0,
            slots: [{
                slotId: 'Q',
                compiledAbilityId: 'ability-q',
                cooldown: {
                    remainingTicks: 12,
                    nextEligibleFixedTick: 102
                }
            }]
        },
        core: {
            currentIntegrity: 9000,
            maxIntegrity: 10_000,
            runOutcomeState: 'RUNNING'
        },
        progression: {
            pendingShopClose: false,
            pendingNextWaveOrdinal: 0,
            pendingNextTransactionId: null
        },
        ...overrides
    };
}

test('일곱 GPU recovery matrix state는 CPU clock/reward/Shop/cooldown을 exact 보존한다', () => {
    assert.deepEqual(Array.from(R9_GPU_RECOVERY_MATRIX_STATES), [
        'WAVE_ACTIVE',
        'DEADLINE_SPAWN_DRAIN',
        'OVERTIME',
        'SETTLEMENT_PENDING',
        'SHOP_OPENING',
        'SHOP',
        'NEXT_WAVE_PREPARE'
    ]);
    for (const state of R9_GPU_RECOVERY_MATRIX_STATES) {
        const before = createR9RecoveryContinuitySnapshot(
            createRecoverySource(state)
        );
        const after = createR9RecoveryContinuitySnapshot(
            createRecoverySource(state)
        );
        const receipt = auditR9RecoveryContinuity(before, after);
        assert.equal(before.matrixStateCovered, true, state);
        assert.equal(receipt.preserved, true, state);
        assert.equal(receipt.rewardDuplicateCount, 0, state);
        assert.equal(receipt.shopDuplicateCount, 0, state);
        assert.equal(receipt.mapClearDuplicateCount, 0, state);
        assert.equal(receipt.rollbackDetected, false, state);
        assert.equal(receipt.automaticRestartCount, 0, state);
        assert.equal(receipt.restartStormDetected, false, state);
        assert.equal(
            receipt.transientRearmLimitation,
            R9_CURRENT_WAVE_TRANSIENT_REARM_LIMITATION,
            state
        );
    }
});

test('recovery audit은 elapsed/pulse rollback과 duplicate reward를 숨기지 않는다', () => {
    const before = createR9RecoveryContinuitySnapshot(
        createRecoverySource('OVERTIME')
    );
    const changedSource = createRecoverySource('OVERTIME');
    changedSource.wave.elapsedCombatTicks = 29;
    changedSource.pressure.overtimePulseOrdinal = 1;
    changedSource.commerce.creditCount = 3;
    const changed = createR9RecoveryContinuitySnapshot(changedSource);
    const receipt = auditR9RecoveryContinuity(before, changed);
    assert.equal(receipt.preserved, false);
    assert.equal(receipt.elapsedRollback, true);
    assert.equal(receipt.pulseRollback, true);
    assert.equal(receipt.rewardDuplicateCount, 1);
});
