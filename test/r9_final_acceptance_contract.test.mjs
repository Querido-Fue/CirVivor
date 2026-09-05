import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadGameModule } from './support/source_module_loader.mjs';

const R9_CPU_OWNER_URLS = Object.freeze([
    new URL(
        '../project/game/script/module/ingame/flow/wave_run_coordinator.js',
        import.meta.url
    ),
    new URL(
        '../project/game/script/module/ingame/flow/core_overtime_pressure_director.js',
        import.meta.url
    ),
    new URL(
        '../project/game/script/module/ingame/flow/wave_settlement_coordinator.js',
        import.meta.url
    ),
    new URL(
        '../project/game/script/module/ingame/flow/r9_recovery_continuity_contract.js',
        import.meta.url
    )
]);

const R9_GPU_FORBIDDEN_SOURCE = /\b(?:GPUBufferUsage|GPUMapMode|GPUTextureUsage|navigator\.gpu|createBuffer|mapAsync|copyBufferToBuffer)\b/u;
const STEADY_FULL_SCAN_FORBIDDEN_SOURCE = /\b(?:copyActiveHandlesInto|copyActiveBodiesInto|forEachActiveEnemy|scanFullRegistry)\s*\(/u;

test('R9 CPU owner는 GPU ABI/readback을 추가하지 않고 steady hostile full scan을 소유하지 않는다', async () => {
    const sources = await Promise.all(R9_CPU_OWNER_URLS.map(
        async (url) => Object.freeze({
            url,
            source: await readFile(url, 'utf8')
        })
    ));
    for (const { url, source } of sources) {
        assert.doesNotMatch(source, R9_GPU_FORBIDDEN_SOURCE, url.pathname);
        assert.doesNotMatch(
            source,
            STEADY_FULL_SCAN_FORBIDDEN_SOURCE,
            url.pathname
        );
    }
});

test('R9 actual gate와 Post-R8 production exposure는 exact APPROVED 계약이다', async () => {
    const [packageSource, runnerSource, productionData] = await Promise.all([
        readFile(new URL('../project/package.json', import.meta.url), 'utf8'),
        readFile(new URL(
            './support/run_nw_r9_wave_settlement.mjs',
            import.meta.url
        ), 'utf8'),
        loadGameModule('data/scene/game/r9_production_run_data.js')
    ]);
    const packageJson = JSON.parse(packageSource);
    assert.equal(
        packageJson.scripts['test:webgpu:r9-wave-settlement'],
        'node ../test/support/run_nw_r9_wave_settlement.mjs'
    );
    assert.equal(
        productionData.R9_POST_R8_PRODUCTION_SHOP_EXPOSURE.status,
        'APPROVED'
    );
    assert.equal(
        productionData.R9_POST_R8_PRODUCTION_SHOP_EXPOSURE
            .automaticWaveSettlementShopAllowed,
        true
    );
    for (const requiredEvidence of [
        'newProductionStorageBindingCount',
        'extraPerSubjectFullBodyReadbackCount',
        'partialPublicationCount',
        'gridOverflowCount',
        'protocolRecoveryFailureCount',
        'uncapturedErrorCount',
        'deviceLostReasons'
    ]) {
        assert.match(runnerSource, new RegExp(requiredEvidence, 'u'));
    }
});
