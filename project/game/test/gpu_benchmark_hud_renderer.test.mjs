import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const HUD_SOURCE = await readFile(
    new URL(
        '../script/module/scene/benchmark/render/gpu_benchmark_hud_renderer.js',
        import.meta.url
    ),
    'utf8'
);

function createSyntheticModule(context, identifier, exports) {
    const exportNames = Object.keys(exports);
    return new vm.SyntheticModule(exportNames, function initialize() {
        for (const exportName of exportNames) {
            this.setExport(exportName, exports[exportName]);
        }
    }, { context, identifier });
}

async function createHudHarness() {
    const calls = [];
    const context = vm.createContext({ console });
    const module = new vm.SourceTextModule(HUD_SOURCE, {
        context,
        identifier: 'gpu_benchmark_hud_renderer.js'
    });
    const dependencies = new Map([
        ['display/_theme_handler.js', createSyntheticModule(
            context,
            'theme_handler.js',
            { ColorSchemes: { Game: { Font: '#ffffff' } } }
        )],
        ['display/display_system.js', createSyntheticModule(
            context,
            'display_system.js',
            {
                render(layer, options) {
                    calls.push({ layer, options: { ...options } });
                }
            }
        )],
        ['util/font_util.js', createSyntheticModule(
            context,
            'font_util.js',
            {
                createFontString({ weight, sizePx }) {
                    return `${weight} ${sizePx}px sans-serif`;
                }
            }
        )]
    ]);
    await module.link((specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`예상하지 못한 HUD import입니다: ${specifier}`);
        }
        return dependency;
    });
    await module.evaluate();
    return { calls, drawGpuBenchmarkHud: module.namespace.drawGpuBenchmarkHud };
}

test('HUD는 mixed-body kind/event telemetry와 dynamic box SDF 제한을 표시한다', async () => {
    const harness = await createHudHarness();
    harness.drawGpuBenchmarkHud({
        presentationProfile: 'strict-interpolation',
        backendState: 'gpu-ready',
        platformStatus: 'ready',
        activeCount: 23,
        enemyActiveCount: 19,
        projectileActiveCount: 4,
        reservedCount: 2,
        pendingCommandCount: 3,
        totalQueuedEnemySpawnCount: 100,
        totalQueuedProjectileSpawnCount: 10,
        lastEnemySpawnBatchReason: 'queued',
        lastProjectileSpawnBatchReason: 'queued',
        gpuContactCount: 8,
        gpuAppliedEventCount: 6,
        gpuDeathEventCount: 2,
        gpuContactOverflowCount: 1,
        gpuAppliedEventOverflowCount: 2,
        gpuDeathEventOverflowCount: 3,
        gpuEventSubmittedTickWatermark: 40,
        gpuEventCompletedTickWatermark: 39,
        fixedTick: 41,
        overflowSmallCount: 0,
        overflowBigCount: 1,
        cpuProjectileCount: 0,
        boxCount: 4,
        recoveryRequired: false,
        sessionGeneration: 2,
        restartCount: 1
    }, { ww: 1920, wh: 1080 });

    const texts = harness.calls.map(({ options }) => options.text);
    assert.match(texts[0], /GPU Mixed Bodies/);
    assert.ok(texts.some((text) => (
        text.includes('19 enemy + 4 projectile = 23 mixed bodies')
    )));
    assert.ok(texts.some((text) => (
        text.includes('8 contact | 6 applied | 2 death')
    )));
    assert.ok(texts.some((text) => (
        text.includes('event overflow C/A/D: 1/2/3 | watermark 40→39')
    )));
    assert.ok(texts.some((text) => (
        text.includes('CPU tools: 0 projectiles + 4 boxes')
    )));
    assert.ok(texts.some((text) => (
        text.includes('dynamic Spawn Box remains CPU-only')
    )));
});
