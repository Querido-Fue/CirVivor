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
    RunCommerceState
} = await loadGameModule('ingame/state/run_commerce_state.js');
const {
    WordShopSession
} = await loadGameModule('ingame/word/word_shop_session.js');

function createQaShop(runSessionId) {
    const commerce = new RunCommerceState({
        runSessionId,
        initialGold: R8_WORD_SHOP_BALANCE.QA_INITIAL_GOLD
    });
    const shop = new WordShopSession({
        commerceState: commerce,
        runtimeMode: SHOP_RUNTIME_CONFIGURATION_MODE.QA,
        runSeed: R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
        unlockedWordDefinitionIds: R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
        unlockedPoolFingerprint: fingerprintUnlockedWordPool(
            R8_ALL_UNLOCKED_WORD_DEFINITION_IDS
        ),
        allowEconomicallyRedundantOffers: true
    });
    const opened = shop.open({
        transactionId: `${runSessionId}.open.1`,
        shopSessionOrdinal: 1,
        expectedCommerceRevision: commerce.getRevision()
    });
    return { commerce, shop, opened };
}

test('--r8-qa 첫 deterministic 5-card row는 exact scenario의 twice 구매를 보장한다', () => {
    const left = createQaShop('run.r8.acceptance.left');
    const right = createQaShop('run.r8.acceptance.right');
    assert.equal(left.opened.code, WORD_SHOP_RESULT_CODE.OPENED);
    assert.equal(left.opened.row.offers.length, 5);
    assert.equal(
        new Set(left.opened.row.offers.map(({ definitionId }) => definitionId)).size,
        5
    );
    assert.ok(left.opened.row.offers.some(
        ({ definitionId }) => definitionId === WORD_DEFINITION_ID.TWICE
    ));
    assert.deepEqual(left.opened.row, right.opened.row);
    left.shop.destroy();
    left.commerce.destroy();
    right.shop.destroy();
    right.commerce.destroy();
});

test('R8 production scope와 actual acceptance entrypoint는 Wave/save/meta 확장을 만들지 않는다', async () => {
    const packageJson = JSON.parse(await readFile(
        new URL('../../package.json', import.meta.url),
        'utf8'
    ));
    assert.equal(
        packageJson.scripts['test:webgpu:r8-shop-editor'],
        'node game/test/support/run_nw_r8_shop_editor.mjs'
    );
    const productionFiles = [
        '../script/data/word/r8_word_shop_catalog_data.js',
        '../script/data/word/r8_word_upgrade_profile_data.js',
        '../script/module/ingame/contract/r8_fingerprint_contract.js',
        '../script/module/ingame/contract/sentence_board_contract.js',
        '../script/module/ingame/contract/shop_ui_command_contract.js',
        '../script/module/ingame/contract/word_inventory_contract.js',
        '../script/module/ingame/contract/word_shop_contract.js',
        '../script/module/ingame/contract/word_upgrade_contract.js',
        '../script/module/ingame/flow/shop_phase_coordinator.js',
        '../script/module/ingame/flow/shop_ui_command_executor.js',
        '../script/module/ingame/state/run_commerce_state.js',
        '../script/module/ingame/word/deterministic_shop_rng.js',
        '../script/module/ingame/word/runtime_word_catalog_view.js',
        '../script/module/ingame/word/sentence_board_state.js',
        '../script/module/ingame/word/word_inventory_state.js',
        '../script/module/ingame/word/word_shop_session.js'
    ];
    for (const relativePath of productionFiles) {
        const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /Math\.random/u, relativePath);
        assert.doesNotMatch(source, /WaveDirector/u, relativePath);
        assert.doesNotMatch(source, /\bOvertime\b/u, relativePath);
        assert.doesNotMatch(
            source,
            /localStorage|sessionStorage|indexedDB|writeFile(?:Sync)?|showSaveFilePicker/u,
            relativePath
        );
        assert.doesNotMatch(
            source,
            /(?:unlockMap|mapUnlock|map-unlock|metaProgression)/u,
            relativePath
        );
    }
    const runner = await readFile(new URL(
        './nw_webgpu_capability/r8_shop_editor_runner.js',
        import.meta.url
    ), 'utf8');
    for (const scenario of [
        'enemy-100-x2',
        'enemy-50-x4',
        'tower-1-x2',
        'summon-128-x2'
    ]) {
        assert.match(runner, new RegExp(scenario, 'u'));
    }
    assert.match(runner, /r8-shop-editor-actual-webgpu/u);
    assert.match(runner, /WARM_SAMPLE_COUNT_PER_SCENARIO/u);
});
