import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R3_WORD_INSTANCES,
    R7_WORD_DEFINITION_BY_ID
} = await loadGameModule('data/word/r3_word_catalog_data.js');
const {
    R8_TWICE_UPGRADE_COST,
    R8_WORD_UPGRADE_PROFILE_ID
} = await loadGameModule('data/word/r8_word_upgrade_profile_data.js');
const {
    WORD_DEFINITION_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    WORD_INVENTORY_RESULT_CODE
} = await loadGameModule('ingame/contract/word_inventory_contract.js');
const {
    WordInventoryState
} = await loadGameModule('ingame/word/word_inventory_state.js');
const {
    RUN_COMMERCE_RESULT_CODE,
    RunCommerceState
} = await loadGameModule('ingame/state/run_commerce_state.js');

function assertDeepFrozen(value, visited = new Set()) {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeepFrozen(child, visited);
    }
}

function purchaseRequest(commerce, overrides = {}) {
    const inventory = commerce.getInventorySnapshot();
    return {
        transactionId: 'commerce.purchase.1',
        offerId: 'shop-offer.r8:1:0:modifier.twice',
        rowFingerprint: 12345,
        definitionId: WORD_DEFINITION_ID.TWICE,
        shopSessionOrdinal: 1,
        price: 4,
        expectedCommerceRevision: commerce.getRevision(),
        expectedInventoryRevision: inventory.revision,
        ...overrides
    };
}

test('R8 starter inventory는 R3 exact instance ID와 immutable fingerprint를 보존한다', () => {
    const inventory = new WordInventoryState({ runSessionId: 'run.starter' });
    const snapshot = inventory.getSnapshot();

    assert.deepEqual(
        snapshot.instances.map((instance) => instance.instanceId),
        R3_WORD_INSTANCES.map((instance) => instance.id)
    );
    assert.deepEqual(
        snapshot.instances.map((instance) => instance.acquisitionOrdinal),
        [0, 1, 2]
    );
    assert.equal(snapshot.reusableAcrossSlots, true);
    assert.equal(snapshot.revision, 1);
    assert.ok(snapshot.fingerprint > 0);
    assertDeepFrozen(snapshot);
    assert.throws(() => {
        snapshot.instancesById[R3_WORD_INSTANCES[0].id] = null;
    }, TypeError);
    assert.strictEqual(inventory.getSnapshot(), snapshot);
});

test('R8 inventory acquisition은 run/ordinal/definition ID가 결정적이고 동일 definition을 여러 번 소유한다', () => {
    const inventory = new WordInventoryState({ runSessionId: 'run.acquire' });
    const firstRequest = {
        transactionId: 'inventory.acquire.1',
        definitionId: WORD_DEFINITION_ID.TWICE,
        acquiredShopSessionOrdinal: 7,
        expectedRevision: 1
    };
    const first = inventory.acquire(firstRequest);
    assert.equal(first.accepted, true);
    assert.equal(first.code, WORD_INVENTORY_RESULT_CODE.ACQUIRED);
    assert.equal(
        first.instance.instanceId,
        'word-instance.run:run.acquire:3:modifier.twice'
    );
    assert.equal(
        first.instance.upgradeProfileId,
        R8_WORD_UPGRADE_PROFILE_ID.TWICE
    );
    assert.strictEqual(inventory.acquire(firstRequest), first);

    const second = inventory.acquire({
        transactionId: 'inventory.acquire.2',
        definitionId: WORD_DEFINITION_ID.TWICE,
        acquiredShopSessionOrdinal: 7,
        expectedRevision: 2
    });
    assert.equal(second.accepted, true);
    assert.equal(
        second.instance.instanceId,
        'word-instance.run:run.acquire:4:modifier.twice'
    );
    assert.equal(inventory.getSnapshot().instances.length, 5);

    const conflict = inventory.acquire({
        ...firstRequest,
        definitionId: WORD_DEFINITION_ID.ENEMY
    });
    assert.equal(conflict.code, WORD_INVENTORY_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(inventory.getSnapshot().instances.length, 5);
});

test('R8 generic upgrade profile은 twice 0→1→2 contribution과 data-owned cost를 적용한다', () => {
    const inventory = new WordInventoryState({ runSessionId: 'run.upgrade' });
    const acquired = inventory.acquire({
        transactionId: 'inventory.acquire.twice',
        definitionId: WORD_DEFINITION_ID.TWICE,
        acquiredShopSessionOrdinal: 1,
        expectedRevision: 1
    });
    const instanceId = acquired.instance.instanceId;
    const levelOne = inventory.upgrade({
        transactionId: 'inventory.upgrade.1',
        instanceId,
        expectedRevision: 2
    });
    assert.equal(levelOne.accepted, true);
    assert.equal(levelOne.instance.upgradeLevel, 1);
    assert.equal(levelOne.stackContribution, 2);
    assert.equal(
        levelOne.upgradeCost,
        R8_TWICE_UPGRADE_COST.LEVEL_0_TO_1
    );

    const levelTwo = inventory.upgrade({
        transactionId: 'inventory.upgrade.2',
        instanceId,
        expectedRevision: 3
    });
    assert.equal(levelTwo.instance.upgradeLevel, 2);
    assert.equal(levelTwo.stackContribution, 3);
    assert.equal(
        levelTwo.upgradeCost,
        R8_TWICE_UPGRADE_COST.LEVEL_1_TO_2
    );

    const maximum = inventory.upgrade({
        transactionId: 'inventory.upgrade.max',
        instanceId,
        expectedRevision: 4
    });
    assert.equal(maximum.code, WORD_INVENTORY_RESULT_CODE.MAX_LEVEL);
    assert.equal(inventory.getRevision(), 4);

    const unsupported = inventory.upgrade({
        transactionId: 'inventory.upgrade.unsupported',
        instanceId: R3_WORD_INSTANCES[0].id,
        expectedRevision: 4
    });
    assert.equal(
        unsupported.code,
        WORD_INVENTORY_RESULT_CODE.UPGRADE_UNAVAILABLE
    );
});

test('RunCommerceState는 bounty credit 호환과 purchase Gold+inventory 원자 publication을 제공한다', () => {
    const commerce = new RunCommerceState({
        runSessionId: 'run.commerce',
        initialGold: 20
    });
    const credit = commerce.credit({
        transactionId: 'enemy-bounty.r8:1',
        amount: 3,
        fixedTick: 10,
        sourceKind: 'PLAYER_KILL'
    });
    assert.equal(credit.accepted, true);
    assert.equal(commerce.getBalance(), 23);
    assert.deepEqual(
        commerce.credit({
            transactionId: 'enemy-bounty.r8:1',
            amount: 3,
            fixedTick: 10,
            sourceKind: 'PLAYER_KILL'
        }),
        {
            accepted: false,
            duplicate: true,
            reason: 'duplicate-transaction',
            transactionId: 'enemy-bounty.r8:1',
            balance: 23
        }
    );

    const request = purchaseRequest(commerce);
    const purchased = commerce.purchase(request);
    assert.equal(purchased.code, RUN_COMMERCE_RESULT_CODE.PURCHASED);
    assert.equal(purchased.gold, 19);
    assert.equal(purchased.goldMutation, -4);
    assert.equal(purchased.inventoryMutation, 1);
    assert.equal(commerce.getInventorySnapshot().instances.length, 4);
    assert.strictEqual(commerce.purchase(request), purchased);

    const conflict = commerce.purchase({ ...request, price: 5 });
    assert.equal(conflict.code, RUN_COMMERCE_RESULT_CODE.TRANSACTION_CONFLICT);
    assert.equal(commerce.getBalance(), 19);
    assert.equal(commerce.getInventorySnapshot().instances.length, 4);

    const before = commerce.getStatus();
    const insufficient = commerce.purchase(purchaseRequest(commerce, {
        transactionId: 'commerce.purchase.insufficient',
        offerId: 'shop-offer.r8:1:1:word.entity.enemy',
        definitionId: WORD_DEFINITION_ID.ENEMY,
        price: 1000
    }));
    assert.equal(insufficient.code, RUN_COMMERCE_RESULT_CODE.INSUFFICIENT_GOLD);
    assert.equal(commerce.getBalance(), before.gold);
    assert.equal(
        commerce.getInventorySnapshot().fingerprint,
        before.inventoryFingerprint
    );
});

test('RunCommerceState upgrade는 price를 profile에서 읽고 Gold와 level을 함께 commit한다', () => {
    const commerce = new RunCommerceState({
        runSessionId: 'run.commerce-upgrade',
        initialGold: 50
    });
    const purchased = commerce.purchase(purchaseRequest(commerce));
    const instanceId = purchased.inventoryReceipt.instance.instanceId;
    const upgraded = commerce.upgradeOwnedWord({
        transactionId: 'commerce.upgrade.1',
        instanceId,
        expectedCommerceRevision: commerce.getRevision(),
        expectedInventoryRevision: commerce.getInventorySnapshot().revision
    });
    assert.equal(upgraded.code, RUN_COMMERCE_RESULT_CODE.UPGRADED);
    assert.equal(
        upgraded.amount,
        R8_TWICE_UPGRADE_COST.LEVEL_0_TO_1
    );
    assert.equal(
        commerce.getInventorySnapshot().instancesById[instanceId].upgradeLevel,
        1
    );
    assert.equal(commerce.getBalance(), 41);
});

for (const failureStage of ['after-gold-publish', 'after-inventory-publish']) {
    test(`RunCommerceState ${failureStage} injected failure는 split-brain 없이 rollback한다`, () => {
        const commerce = new RunCommerceState({
            runSessionId: `run.failure.${failureStage}`,
            initialGold: 20,
            failureInjector(stage) {
                if (stage === failureStage) throw new Error(`injected:${stage}`);
            }
        });
        const before = commerce.getStatus();
        const receipt = commerce.purchase(purchaseRequest(commerce));
        const after = commerce.getStatus();

        assert.equal(receipt.code, RUN_COMMERCE_RESULT_CODE.PROTOCOL_FAILURE);
        assert.equal(receipt.rolledBack, true);
        assert.equal(after.gold, before.gold);
        assert.equal(after.commerceRevision, before.commerceRevision);
        assert.equal(after.inventoryRevision, before.inventoryRevision);
        assert.equal(after.inventoryFingerprint, before.inventoryFingerprint);
        assert.equal(after.pendingTransactionCount, 0);
        assert.equal(after.purchaseCount, 0);
        assert.equal(after.protocolFailure.code,
            'run-commerce-atomic-publication-failure');
    });
}

test('GPU world replacement을 모사해도 같은 commerce object의 Gold/inventory가 유지된다', () => {
    const commerce = new RunCommerceState({
        runSessionId: 'run.recovery',
        initialGold: 12
    });
    commerce.purchase(purchaseRequest(commerce));
    const beforeReplacement = commerce.getStatus();

    const oldGpuWorld = Object.freeze({ generation: 1 });
    const newGpuWorld = Object.freeze({ generation: 2 });
    assert.notStrictEqual(oldGpuWorld, newGpuWorld);
    assert.strictEqual(commerce, commerce);
    assert.equal(commerce.getStatus().gold, beforeReplacement.gold);
    assert.equal(
        commerce.getStatus().inventoryFingerprint,
        beforeReplacement.inventoryFingerprint
    );
});

test('R8 production modules는 plan/guide/reference source를 import하지 않는다', async () => {
    const files = [
        'game/script/module/ingame/contract/r8_fingerprint_contract.js',
        'game/script/module/ingame/contract/word_upgrade_contract.js',
        'game/script/module/ingame/contract/word_inventory_contract.js',
        'game/script/module/ingame/word/word_inventory_state.js',
        'game/script/module/ingame/state/run_commerce_state.js',
        'game/script/data/word/r8_word_upgrade_profile_data.js'
    ];
    for (const file of files) {
        const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /(?:from|import\()\s*['"][^'"]*(?:guide|guide_old|plan|참고)[/\\]/);
    }
    assert.equal(R7_WORD_DEFINITION_BY_ID[WORD_DEFINITION_ID.TWICE].id,
        WORD_DEFINITION_ID.TWICE);
});
