import assert from 'node:assert/strict';
import test from 'node:test';

import {
    validateR8Result
} from './support/run_nw_r8_shop_editor.mjs';

const SCENARIO_IDS = Object.freeze([
    'enemy-100-x2',
    'enemy-50-x4',
    'tower-1-x2',
    'summon-128-x2'
]);

function createApprovedResult() {
    return {
        status: 'pass',
        r8ShopEditor: {
            scenario: 'r8-shop-editor-actual-webgpu',
            shop: {
                initialOfferCount: 5,
                initialUniqueOfferCount: 5,
                purchasedTwice: true,
                multiplePurchaseCount: 2,
                staleOldOfferRejected: true,
                rerollRowChanged: true,
                secondSessionRowChanged: true
            },
            editor: {
                previewCopiesPerSubject: 4,
                boardCommitted: true
            },
            editedAbility: {
                subjectCount: 1,
                copiesPerSubject: 4,
                generatedCount: 4
            },
            phase: {
                shopFixedSubmitDelta: 0,
                recoveryShopFixedSubmitDelta: 0,
                finalPhase: 'COMBAT'
            },
            recovery: {
                statePreserved: true,
                oldDestroyed: true,
                rehydratedTowerCount: 1
            },
            storageMaximum: 9,
            extraPerSubjectReadbackCount: 0,
            partialPublicationCount: 0,
            gridOverflowCount: 0,
            protocolFailureCount: 0,
            recoveryFailureCount: 0,
            destroyedTeardown: true
        },
        performance: {
            timestampQuerySupported: true,
            productionExposure: 'APPROVED',
            warmSuccessful: {
                sampleCount: 100,
                materializationGpuMs: { p50: 1, p95: 2 },
                placementGpuMs: { p50: 1, p95: 2 },
                overallGpuMs: { p50: 2, p95: 4 },
                fullFixedBoundaryWallMs: { p50: 3, p95: 5 },
                droppedFixedTimeMs: 0,
                p95WithinBudget: true,
                scenarios: Object.fromEntries(SCENARIO_IDS.map((id) => [
                    id,
                    { sampleCount: 25 }
                ]))
            }
        },
        uncapturedErrorCount: 0,
        deviceLostReason: 'destroyed'
    };
}

test('R8 wrapper는 warm p95와 production exposure를 hard gate로 사용한다', () => {
    assert.doesNotThrow(() => validateR8Result(createApprovedResult()));

    const overBudget = createApprovedResult();
    overBudget.performance.warmSuccessful.p95WithinBudget = false;
    assert.throws(() => validateR8Result(overBudget), /결과 계약 실패/u);

    const partial = createApprovedResult();
    partial.performance.productionExposure = 'PARTIAL';
    assert.throws(() => validateR8Result(partial), /결과 계약 실패/u);

    const noTimestampQuery = createApprovedResult();
    noTimestampQuery.performance.timestampQuerySupported = false;
    assert.throws(() => validateR8Result(noTimestampQuery), /결과 계약 실패/u);
});
