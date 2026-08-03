import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL(
    '../script/module/display/_vignette_renderer.js',
    import.meta.url
), 'utf8');

async function loadVignetteModule(theme) {
    const context = vm.createContext({
        console,
        document: {
            createElement() {
                return {
                    width: 0,
                    height: 0,
                    getContext() {
                        return {};
                    }
                };
            }
        }
    });
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: 'vignette-renderer'
    });
    await module.link((specifier) => {
        if (specifier === 'display/_theme_handler.js') {
            return new vm.SyntheticModule(
                ['ColorSchemes', 'getCurrentThemeKey'],
                function initialize() {
                    this.setExport('ColorSchemes', theme);
                    this.setExport('getCurrentThemeKey', () => 'test-theme');
                },
                { context, identifier: 'theme-handler' }
            );
        }
        if (specifier === 'util/number_util.js') {
            return new vm.SyntheticModule(
                ['clampNumber'],
                function initialize() {
                    this.setExport('clampNumber', (value, minimum, maximum) => (
                        Math.max(minimum, Math.min(maximum, value))
                    ));
                },
                { context, identifier: 'number-util' }
            );
        }
        throw new Error(`unexpected import: ${specifier}`);
    });
    await module.evaluate();
    return module.namespace;
}

test('vignette WebGPU packet은 theme/viewport 의미를 allocation-free analytic 값으로 노출한다', async () => {
    const theme = {
        Vignette: {
            WORLD: {
                RGB: [32, 64, 128],
                AlphaMultiplier: 0.5
            }
        }
    };
    const { VignetteRenderer } = await loadVignetteModule(theme);
    const renderer = new VignetteRenderer();
    renderer.width = 1920;
    renderer.height = 1080;

    const first = renderer.getWebGpuPresentationPacket();
    const firstColor = first.color;
    const firstRevision = first.revision;
    assert.equal(first.visible, true);
    assert.ok(Math.abs(first.color[0] - (32 / 255)) < 1e-6);
    assert.ok(Math.abs(first.color[1] - (64 / 255)) < 1e-6);
    assert.ok(Math.abs(first.color[2] - (128 / 255)) < 1e-6);
    assert.ok(Math.abs(first.color[3] - 0.34) < 1e-6);
    assert.ok(first.edgeWidth > 0);
    assert.ok(first.cornerRadius > 0);

    const stable = renderer.getWebGpuPresentationPacket();
    assert.strictEqual(stable, first);
    assert.strictEqual(stable.color, firstColor);
    assert.equal(stable.revision, firstRevision);

    theme.Vignette.WORLD.RGB[0] = 96;
    const changed = renderer.getWebGpuPresentationPacket();
    assert.strictEqual(changed, first);
    assert.equal(changed.revision, firstRevision + 1);
    assert.ok(Math.abs(changed.color[0] - (96 / 255)) < 1e-6);
});
