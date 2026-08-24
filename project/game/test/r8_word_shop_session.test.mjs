import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE
} = await loadGameModule('data/word/r8_word_shop_catalog_data.js');
const {
    WORD_DEFINITION_ID
} = await loadGameModule('ingame/contract/word_sentence_contract.js');
const {
    fingerprintUnlockedWordPool,
    WORD_SHOP_RESULT_CODE
} = await loadGameModule('ingame/contract/word_shop_contract.js');
const {
    SHOP_RUNTIME_CONFIGURATION_MODE
} = await loadGameModule(
    'ingame/contract/shop_runtime_configuration_contract.js'
);
const {
    RUN_COMMERCE_RESULT_CODE,
    RunCommerceState
} = await loadGameModule('ingame/state/run_commerce_state.js');
const {
    WordShopSession
} = await loadGameModule('ingame/word/word_shop_session.js');

function createOpenShop(options = {}) {
    const commerce = new RunCommerceState({
        runSessionId: options.runSessionId ?? `run.shop.${options.runSeed ?? 1}`,
        initialGold: options.initialGold ?? 100
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runtimeMode: options.runtimeMode
            ?? SHOP_RUNTIME_CONFIGURATION_MODE.QA,
        runSeed: options.runSeed ?? 1,
        unlockedWordDefinitionIds: options.unlockedWordDefinitionIds
            ?? R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(
            options.unlockedWordDefinitionIds
                ?? R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        ),
        allowEconomicallyRedundantOffers:
            options.allowEconomicallyRedundantOffers ?? true,
        historyCapacity: options.historyCapacity
    });
    const open = shop.open({
        transactionId: options.openTransactionId ?? 'shop.open.1',
        shopSessionOrdinal: options.shopSessionOrdinal ?? 1,
        expectedCommerceRevision: commerce.getRevision()
    });
    return { commerce, shop, open };
}

function rowAction(shop, overrides = {}) {
    const status = shop.getStatus();
    return {
        transactionId: 'shop.action.1',
        rowFingerprint: status.row.rowFingerprint,
        expectedCommerceRevision: status.commerceRevision,
        expectedInventoryRevision: status.inventoryRevision,
        ...overrides
    };
}

test('R8 Shop은 동일 seed/pool/catalog에서 1,000회 byte-equivalent unique 5-card row를 만든다', () => {
    let expected = null;
    for (let index = 0; index < 1000; index++) {
        const { shop, open } = createOpenShop({
            runSeed: 0x10203040,
            runSessionId: `run.determinism.${index}`
        });
        assert.equal(open.code, WORD_SHOP_RESULT_CODE.OPENED);
        const row = shop.getStatus().row;
        assert.equal(row.offers.length, 5);
        assert.equal(
            new Set(row.offers.map((offer) => offer.definitionId)).size,
            5
        );
        const serialized = JSON.stringify(row);
        expected ??= serialized;
        assert.equal(serialized, expected);
        shop.destroy();
    }
});

test('weighted selection은 여러 seed에서 catalog 항목을 관측하되 중복 offer를 만들지 않는다', () => {
    const observed = new Set();
    for (let seed = 1; seed <= 512; seed++) {
        const { shop } = createOpenShop({ runSeed: seed });
        const offers = shop.getStatus().row.offers;
        assert.equal(new Set(offers.map(({ definitionId }) => definitionId)).size, 5);
        offers.forEach(({ definitionId }) => observed.add(definitionId));
        shop.destroy();
    }
    assert.deepEqual(
        Array.from(observed).sort(),
        Array.from(R8_ALL_UNLOCKED_WORD_DEFINITION_IDS).sort()
    );
});

test('Shop open은 5개 미만 pool을 duplicate로 채우지 않고 명시적으로 거절한다', () => {
    const commerce = new RunCommerceState({
        runSessionId: 'run.small-pool',
        initialGold: 100
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.QA,
        runSeed: 7,
        unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(
            R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        ),
        allowEconomicallyRedundantOffers: true
    });
    const receipt = shop.open({
        transactionId: 'shop.open.small',
        shopSessionOrdinal: 1,
        expectedCommerceRevision: commerce.getRevision(),
        unlockedWordDefinitionIds:
            R8_ALL_UNLOCKED_WORD_DEFINITION_IDS.slice(0, 4)
    });
    assert.equal(receipt.code, WORD_SHOP_RESULT_CODE.INSUFFICIENT_OFFER_POOL);
    assert.equal(shop.getStatus().active, false);
    assert.equal(shop.getStatus().offerCount, 0);
});

test('Production meaningful pool은 owned UNIQUE를 제외하고 twice만 반복 허용한다', () => {
    const commerce = new RunCommerceState({
        runSessionId: 'run.production.meaningful',
        initialGold: 100
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION,
        runSeed: 0x10203040,
        unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(
            R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        )
    });
    const opened = shop.open({
        transactionId: 'production.meaningful.open',
        shopSessionOrdinal: 1,
        expectedCommerceRevision: commerce.getRevision()
    });
    assert.equal(opened.code, WORD_SHOP_RESULT_CODE.OPENED);
    const definitions = opened.row.offers.map(({ definitionId }) => definitionId);
    assert.equal(new Set(definitions).size, 5);
    assert.equal(definitions.includes(WORD_DEFINITION_ID.TOWER), false);
    assert.equal(definitions.includes(WORD_DEFINITION_ID.ENEMY), false);
    assert.equal(definitions.includes(WORD_DEFINITION_ID.SHOOT), false);
    assert.equal(definitions.includes(WORD_DEFINITION_ID.TWICE), true);

    const uniqueOffer = opened.row.offers.find(
        ({ definitionId }) => definitionId !== WORD_DEFINITION_ID.TWICE
    );
    const purchased = shop.purchaseOffer(rowAction(shop, {
        transactionId: 'production.meaningful.purchase',
        offerId: uniqueOffer.offerId
    }));
    assert.equal(purchased.accepted, true);
    const beforeReroll = shop.getStatus();
    const rejected = shop.reroll(rowAction(shop, {
        transactionId: 'production.meaningful.reroll'
    }));
    const afterReroll = shop.getStatus();
    assert.equal(
        rejected.code,
        WORD_SHOP_RESULT_CODE.INSUFFICIENT_MEANINGFUL_OFFER_POOL
    );
    assert.equal(afterReroll.gold, beforeReroll.gold);
    assert.strictEqual(afterReroll.row, beforeReroll.row);
    assert.equal(afterReroll.meaningfulOfferPool.count, 4);
});

test('Production pool 부족과 redundant override는 fail-closed이고 Disabled open은 mutation 0이다', () => {
    const smallPool = Object.freeze([
        WORD_DEFINITION_ID.TOWER,
        WORD_DEFINITION_ID.ENEMY,
        WORD_DEFINITION_ID.SHOOT,
        WORD_DEFINITION_ID.MERGE,
        WORD_DEFINITION_ID.TWICE
    ]);
    const commerce = new RunCommerceState({
        runSessionId: 'run.production.small',
        initialGold: 100
    });
    assert.throws(() => new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION,
        runSeed: 7,
        unlockedWordDefinitionIds: smallPool,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(smallPool),
        allowEconomicallyRedundantOffers: true
    }), /QA mode/u);
    const production = new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.PRODUCTION,
        runSeed: 7,
        unlockedWordDefinitionIds: smallPool,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(smallPool)
    });
    const rejected = production.open({
        transactionId: 'production.small.open',
        shopSessionOrdinal: 1,
        expectedCommerceRevision: commerce.getRevision()
    });
    assert.equal(
        rejected.code,
        WORD_SHOP_RESULT_CODE.INSUFFICIENT_MEANINGFUL_OFFER_POOL
    );
    assert.equal(production.getStatus().active, false);
    assert.equal(production.getStatus().openCount, 0);

    const disabled = new WordShopSession({ commerceState: commerce });
    const disabledReceipt = disabled.open({
        transactionId: 'disabled.open',
        shopSessionOrdinal: 1,
        expectedCommerceRevision: commerce.getRevision()
    });
    assert.equal(disabledReceipt.code, WORD_SHOP_RESULT_CODE.SHOP_NOT_CONFIGURED);
    assert.equal(disabledReceipt.mutationCount, 0);
    assert.equal(disabled.getStatus().active, false);
});

test('Inventory/Commerce/Shop revision snapshot은 무변경 호출 identity를 재사용한다', () => {
    const { commerce, shop } = createOpenShop({ runSeed: 0x55667788 });
    const inventoryLeft = commerce.getInventorySnapshot();
    const inventoryRight = commerce.getInventorySnapshot();
    const commerceLeft = commerce.getStatus();
    const commerceRight = commerce.getStatus();
    const shopLeft = shop.getStatus();
    const shopRight = shop.getStatus();
    assert.strictEqual(inventoryLeft, inventoryRight);
    assert.strictEqual(commerceLeft, commerceRight);
    assert.strictEqual(shopLeft, shopRight);

    commerce.credit({
        transactionId: 'snapshot.credit',
        amount: 1,
        fixedTick: 1
    });
    assert.notStrictEqual(commerce.getStatus(), commerceLeft);
    assert.notStrictEqual(shop.getStatus(), shopLeft);
    assert.strictEqual(commerce.getInventorySnapshot(), inventoryLeft);
});

test('purchase는 Gold/inventory/sold를 exact commit하고 replay/conflict/stale를 분리한다', () => {
    const { commerce, shop } = createOpenShop({ runSeed: 33, initialGold: 100 });
    const initial = shop.getStatus();
    const offer = initial.row.offers[0];
    const request = rowAction(shop, {
        transactionId: 'shop.purchase.1',
        offerId: offer.offerId
    });
    const purchased = shop.purchaseOffer(request);
    assert.equal(purchased.code, WORD_SHOP_RESULT_CODE.PURCHASED);
    assert.equal(purchased.commerceReceipt.code, RUN_COMMERCE_RESULT_CODE.PURCHASED);
    assert.equal(commerce.getBalance(), 100 - offer.price);
    assert.equal(commerce.getInventorySnapshot().instances.length, 4);
    assert.equal(
        shop.getStatus().row.offers.find(({ offerId }) => offerId === offer.offerId).sold,
        true
    );
    assert.strictEqual(shop.purchaseOffer(request), purchased);

    const conflict = shop.purchaseOffer({
        ...request,
        offerId: initial.row.offers[1].offerId
    });
    assert.equal(conflict.code, WORD_SHOP_RESULT_CODE.TRANSACTION_CONFLICT);

    const sold = shop.purchaseOffer(rowAction(shop, {
        transactionId: 'shop.purchase.sold',
        offerId: offer.offerId
    }));
    assert.equal(sold.code, WORD_SHOP_RESULT_CODE.SOLD_OFFER);
});

test('insufficient Gold purchase는 offer/Gold/inventory mutation을 모두 0으로 유지한다', () => {
    const { commerce, shop } = createOpenShop({ runSeed: 9, initialGold: 0 });
    const before = shop.getStatus();
    const offer = before.row.offers[0];
    const receipt = shop.purchaseOffer(rowAction(shop, {
        transactionId: 'shop.purchase.insufficient',
        offerId: offer.offerId
    }));
    const after = shop.getStatus();

    assert.equal(receipt.code, WORD_SHOP_RESULT_CODE.COMMERCE_REJECTED);
    assert.equal(
        receipt.commerceCode,
        RUN_COMMERCE_RESULT_CODE.INSUFFICIENT_GOLD
    );
    assert.equal(after.gold, before.gold);
    assert.equal(after.inventoryFingerprint, before.inventoryFingerprint);
    assert.equal(after.row.rowFingerprint, before.row.rowFingerprint);
    assert.equal(after.row.offers[0].sold, false);
});

test('reroll은 exact data cost를 지불하고 deterministic 새 row를 게시하며 old row를 stale 처리한다', () => {
    const left = createOpenShop({ runSeed: 77, initialGold: 100 });
    const right = createOpenShop({ runSeed: 77, initialGold: 100 });
    const oldStatus = left.shop.getStatus();
    const leftReceipt = left.shop.reroll(rowAction(left.shop, {
        transactionId: 'shop.reroll.1'
    }));
    const rightReceipt = right.shop.reroll(rowAction(right.shop, {
        transactionId: 'shop.reroll.1'
    }));

    assert.equal(leftReceipt.code, WORD_SHOP_RESULT_CODE.REROLLED);
    assert.equal(leftReceipt.rerollOrdinal, 1);
    assert.equal(
        left.commerce.getBalance(),
        100 - R8_WORD_SHOP_BALANCE.REROLL_COST
    );
    assert.deepEqual(leftReceipt.row, rightReceipt.row);
    assert.notEqual(leftReceipt.row.rowFingerprint, oldStatus.row.rowFingerprint);

    const stale = left.shop.purchaseOffer({
        transactionId: 'shop.purchase.old-row',
        offerId: oldStatus.row.offers[0].offerId,
        rowFingerprint: oldStatus.row.rowFingerprint,
        expectedCommerceRevision: left.shop.getStatus().commerceRevision,
        expectedInventoryRevision: left.shop.getStatus().inventoryRevision
    });
    assert.equal(stale.code, WORD_SHOP_RESULT_CODE.STALE_ROW);
});

test('twice purchase 후 Shop upgrade command는 level contribution과 Gold를 commerce에 위임한다', () => {
    const fiveWithTwice = [
        WORD_DEFINITION_ID.TOWER,
        WORD_DEFINITION_ID.ENEMY,
        WORD_DEFINITION_ID.SHOOT,
        WORD_DEFINITION_ID.THROW,
        WORD_DEFINITION_ID.TWICE
    ];
    const { commerce, shop } = createOpenShop({
        runSeed: 81,
        initialGold: 100,
        unlockedWordDefinitionIds: fiveWithTwice
    });
    const twiceOffer = shop.getStatus().row.offers.find(
        ({ definitionId }) => definitionId === WORD_DEFINITION_ID.TWICE
    );
    const purchased = shop.purchaseOffer(rowAction(shop, {
        transactionId: 'shop.purchase.twice',
        offerId: twiceOffer.offerId
    }));
    const instanceId = purchased.commerceReceipt.inventoryReceipt.instance.instanceId;
    const goldBeforeUpgrade = commerce.getBalance();
    const upgraded = shop.upgradeOwnedWord(rowAction(shop, {
        transactionId: 'shop.upgrade.twice.1',
        instanceId
    }));

    assert.equal(upgraded.code, WORD_SHOP_RESULT_CODE.UPGRADED);
    assert.equal(
        commerce.getInventorySnapshot().instancesById[instanceId].upgradeLevel,
        1
    );
    assert.equal(
        commerce.getBalance(),
        goldBeforeUpgrade - upgraded.commerceReceipt.amount
    );
});

test('external commerce revision drift는 row mutation 전에 reject되고 close/reopen ordinal은 단조롭다', () => {
    const { commerce, shop } = createOpenShop({ runSeed: 91 });
    const staleSnapshot = shop.getStatus();
    commerce.credit({
        transactionId: 'external.bounty.1',
        amount: 1,
        fixedTick: 1
    });
    const stale = shop.purchaseOffer({
        transactionId: 'shop.purchase.stale-commerce',
        offerId: staleSnapshot.row.offers[0].offerId,
        rowFingerprint: staleSnapshot.row.rowFingerprint,
        expectedCommerceRevision: staleSnapshot.commerceRevision,
        expectedInventoryRevision: staleSnapshot.inventoryRevision
    });
    assert.equal(stale.code, WORD_SHOP_RESULT_CODE.STALE_COMMERCE_REVISION);

    const closed = shop.close({ transactionId: 'shop.close.1' });
    assert.equal(closed.code, WORD_SHOP_RESULT_CODE.CLOSED);
    const reopened = shop.open({
        transactionId: 'shop.open.2',
        shopSessionOrdinal: 2,
        expectedCommerceRevision: commerce.getRevision()
    });
    assert.equal(reopened.code, WORD_SHOP_RESULT_CODE.OPENED);
    assert.equal(reopened.shopSessionOrdinal, 2);
    assert.notEqual(
        reopened.row.rowFingerprint,
        staleSnapshot.row.rowFingerprint
    );
});

test('Shop history/status는 bounded immutable이고 production source에 random/Wave completion caller가 없다', async () => {
    const { shop } = createOpenShop({ runSeed: 101, historyCapacity: 2 });
    shop.close({ transactionId: 'shop.close.bound' });
    shop.open({
        transactionId: 'shop.open.bound.2',
        shopSessionOrdinal: 2,
        expectedCommerceRevision: shop.getStatus().commerceRevision
    });
    const status = shop.getStatus();
    assert.equal(status.rememberedTransactionCount, 2);
    assert.equal(Object.isFrozen(status), true);
    assert.equal(Object.isFrozen(status.row), true);
    assert.equal(Object.isFrozen(status.row.offers), true);

    const files = [
        'game/script/module/ingame/contract/word_shop_contract.js',
        'game/script/data/word/r8_word_shop_catalog_data.js',
        'game/script/module/ingame/word/deterministic_shop_rng.js',
        'game/script/module/ingame/word/word_shop_session.js'
    ];
    for (const file of files) {
        const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /Math\.random/u);
        assert.doesNotMatch(source, /WaveDirector|completionOwned/u);
    }
});
