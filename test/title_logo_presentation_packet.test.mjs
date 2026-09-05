import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const cacheSource = await readFile(
    new URL('../project/game/script/module/scene/title/logo/_title_logo_render_cache.js', import.meta.url),
    'utf8'
);
const logoSource = await readFile(
    new URL('../project/game/script/module/scene/title/_title_logo.js', import.meta.url),
    'utf8'
);

function createCanvas() {
    const canvas = {
        width: 0,
        height: 0,
        getContext() {
            if (!this.context) {
                this.context = {
                    canvas: this,
                    clearRect() {},
                    save() {},
                    restore() {},
                    scale() {},
                    translate() {},
                    fillRect() {},
                    drawImage() {},
                    globalCompositeOperation: 'source-over',
                    globalAlpha: 1,
                    filter: 'none'
                };
            }
            return this.context;
        }
    };
    return canvas;
}

test('TitleLogoRenderCache revision/source packet은 성공한 rebuild에서만 바뀐다', async () => {
    const context = vm.createContext({
        console,
        document: {
            createElement() {
                return createCanvas();
            }
        }
    });
    const module = new vm.SourceTextModule(cacheSource, { context });
    const dependencies = new Map([
        ['display/_svg_drawer.js', new vm.SyntheticModule(['SVGDrawer'], function init() {
            this.setExport('SVGDrawer', class SVGDrawer {
                drawAnimatedPaths() {}
            });
        }, { context })],
        ['util/number_util.js', new vm.SyntheticModule(['easeOutExpo'], function init() {
            this.setExport('easeOutExpo', (value) => value);
        }, { context })],
        ['./_title_logo_cache.js', new vm.SyntheticModule([
            'calculateTitleLogoCachePadding',
            'getTitleLogoShadowPasses',
            'resizeTitleLogoCacheCanvas'
        ], function init() {
            this.setExport('calculateTitleLogoCachePadding', () => ({
                left: 2,
                right: 3,
                top: 4,
                bottom: 5
            }));
            this.setExport('getTitleLogoShadowPasses', () => []);
            this.setExport('resizeTitleLogoCacheCanvas', (canvas, width, height) => {
                canvas.width = width;
                canvas.height = height;
            });
        }, { context })],
        ['./_title_logo_asset.js', new vm.SyntheticModule(['TITLE_LOGO_ASSET'], function init() {
            this.setExport('TITLE_LOGO_ASSET', { GROUPS: [], STROKE_DURATION: 1 });
        }, { context })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    const cache = new module.namespace.TitleLogoRenderCache();
    const ensureOptions = {
        scale: 1,
        logoWidth: 10,
        logoHeight: 20,
        elapsed: 0,
        logoColor: '#fff',
        shadowColor: '#000'
    };

    assert.equal(cache.getPresentationSource(), null);
    cache.ensure(ensureOptions);
    const first = cache.getPresentationSource();
    assert.strictEqual(first.canvas, cache.renderCanvas);
    assert.equal(first.revision, 1);
    assert.equal(first.width, 15);
    assert.equal(first.height, 29);
    assert.equal(first.offsetX, 2);
    assert.equal(first.offsetY, 4);
    assert.equal(Object.isFrozen(first), true);

    cache.ensure(ensureOptions);
    assert.strictEqual(cache.getPresentationSource(), first);
    cache.markDirty();
    cache.ensure(ensureOptions);
    assert.equal(cache.getPresentationSource().revision, 2);
    assert.notStrictEqual(cache.getPresentationSource(), first);
    cache.destroy();
    assert.equal(cache.getPresentationSource(), null);
});

test('TitleLogo presentation packet은 legacy cache bitmap과 draw destination을 그대로 재사용한다', async () => {
    const uiCanvas = createCanvas();
    const context = vm.createContext({ console });
    class FakeRenderCache {
        constructor() {
            this.ensureCount = 0;
            this.source = Object.freeze({
                canvas: { width: 64, height: 32 },
                revision: 7,
                width: 64,
                height: 32,
                offsetX: 7,
                offsetY: 9
            });
        }

        markDirty() {}
        ensure() { this.ensureCount += 1; }
        hasRenderableCanvas() { return true; }
        getPresentationSource() { return this.source; }
        drawTo() {}
        destroy() { this.destroyed = true; }
    }
    const module = new vm.SourceTextModule(logoSource, { context });
    const dependencies = new Map([
        ['display/display_system.js', new vm.SyntheticModule([
            'getCanvas',
            'getDisplaySystem',
            'getUIOffsetX',
            'getUIWW',
            'getWH'
        ], function init() {
            this.setExport('getCanvas', () => uiCanvas);
            this.setExport('getDisplaySystem', () => ({ markSurfaceDirectDraw() {} }));
            this.setExport('getUIOffsetX', () => 100);
            this.setExport('getUIWW', () => 1600);
            this.setExport('getWH', () => 900);
        }, { context })],
        ['game/time_handler.js', new vm.SyntheticModule(['getDelta'], function init() {
            this.setExport('getDelta', () => 0);
        }, { context })],
        ['./logo/_title_logo_playback.js', new vm.SyntheticModule([
            'advanceTitleLogoPlayback',
            'calculateTitleLogoPlaybackProgress',
            'calculateTitleLogoRemainingTimeToProgress'
        ], function init() {
            this.setExport('advanceTitleLogoPlayback', (value) => ({
                ...value,
                elapsedChanged: false
            }));
            this.setExport('calculateTitleLogoPlaybackProgress', () => 0);
            this.setExport('calculateTitleLogoRemainingTimeToProgress', () => 0);
        }, { context })],
        ['./logo/_title_logo_render_cache.js', new vm.SyntheticModule(['TitleLogoRenderCache'], function init() {
            this.setExport('TitleLogoRenderCache', FakeRenderCache);
        }, { context })],
        ['./logo/_title_logo_asset.js', new vm.SyntheticModule(['TITLE_LOGO_ASSET'], function init() {
            this.setExport('TITLE_LOGO_ASSET', { VIEWBOX: { width: 100, height: 50 } });
        }, { context })],
        ['./logo/_title_logo_theme.js', new vm.SyntheticModule([
            'getDefaultLogoColor',
            'getDefaultLogoShadowColor'
        ], function init() {
            this.setExport('getDefaultLogoColor', () => '#fff');
            this.setExport('getDefaultLogoShadowColor', () => '#000');
        }, { context })],
        ['./_title_runtime_constants.js', new vm.SyntheticModule(['TITLE_IMAGE_LAYOUT'], function init() {
            this.setExport('TITLE_IMAGE_LAYOUT', {
                WIDTH_RATIO: 0.2,
                ENTER_X_RATIO: 0.1
            });
        }, { context })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    const logo = new module.namespace.TitleLogo({});

    const first = logo.getPresentationPacket();
    assert.equal(first.revision, 7);
    assert.equal(first.destX, 253);
    assert.equal(first.destY, 361);
    assert.equal(first.width, 64);
    assert.equal(first.height, 32);
    assert.strictEqual(logo.getPresentationPacket(), first);

    logo.setPlacement({ x: 500, width: 200, centerY: 400 });
    const moved = logo.getPresentationPacket();
    assert.strictEqual(moved, first);
    assert.equal(moved.destX, 493);
    assert.equal(moved.destY, 341);
    logo.destroy();
    assert.equal(logo.presentationPacket.canvas, null);
});
