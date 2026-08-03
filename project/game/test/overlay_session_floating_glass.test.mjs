import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../script/module/overlay/_overlay_session.js', import.meta.url), 'utf8');
const renders = [];
const created = [];
const released = [];
const animations = [];
let nextSurfaceId = 0;

function animate(owner, properties) {
    let resolve;
    const animation = {
        id: animations.length + 1,
        owner,
        properties,
        promise: new Promise((done) => { resolve = done; }),
        setProgress(value) { owner[properties.variable] = value; },
        complete() { owner[properties.variable] = properties.endValue; resolve(); }
    };
    animations.push(animation);
    return animation;
}

function remove(id) {
    animations.find((animation) => animation.id === id)?.complete();
}

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
}

const context = vm.createContext({ console });
const sessionModule = new vm.SourceTextModule(source, { context, identifier: '_overlay_session.js' });
const dependencies = new Map([
    ['display/display_system.js', createSyntheticModule(context, {
        render: (layer, command) => renders.push({ type: '2d', layer, command }),
        renderGL: (layer, command) => renders.push({ type: 'webgl', layer, command })
    })],
    ['animation/animation_system.js', createSyntheticModule(context, { animate, remove })],
    ['display/webgl/_overlay_render_geometry.js', createSyntheticModule(context, {
        resolveOverlayContentSurfaceStyles: () => ({
            transformOrigin: 'center', uiTransform: 'none', effectTransform: 'none', uiFilter: 'none', effectFilter: 'none'
        })
    })],
    ['display/webgl/_webgl_constants.js', createSyntheticModule(context, {
        OVERLAY_RENDER_CONSTANTS: {
            BACKDROP_SAMPLING_ENABLED: true,
            GLASS_TRANSITION_DURATION_SECONDS: 0.4,
            GLASS_TRANSITION_EASING: 'easeOutExpo'
        }
    })],
    ['util/number_util.js', createSyntheticModule(context, {
        clampFiniteNumber: (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback,
        clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
    })],
    ['scene/title/webgpu/_title_webgpu_overlay_capture_gate.js', createSyntheticModule(context, {
        getTitleWebGpuOverlayCaptureToken: () => null
    })],
    ['./_overlay_effect_registry.js', createSyntheticModule(context, { createOverlayEffectState: () => null })]
]);
await sessionModule.link((specifier) => dependencies.get(specifier));
await sessionModule.evaluate();

const displaySystem = {
    createDynamicSurface(options) {
        const id = `surface-${++nextSurfaceId}`;
        const surface = { id, ...options, isEmpty: false, contentRevision: 1, canvas: { style: {} } };
        created.push(surface);
        return surface;
    },
    releaseDynamicSurface(id) { released.push(id); },
    markSurfaceCompositeChanged() {},
    markOverlayEffectDirty() {},
    setSurfaceCompositeSolidOpacity() {},
    getCompositeSourcesBeforeSurface(id) {
        return { snapshotIdentity: `before:${id}`, sourceRevision: 7, sources: [{ kind: 'canvas', canvas: { id } }] };
    }
};

const { OverlaySession } = sessionModule.namespace;
const session = new OverlaySession({ displaySystem, layer: 3, transparent: true, glOverlay: false, disableTransparency: false });
assert.deepEqual(created.map(({ type, order }) => ({ type, order })), [
    { type: 'webgl', order: 3000 },
    { type: '2d', order: 3001 }
]);

assert.equal(session.getGlassMix(), 1);
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 0);
assert.equal(session.requiresBackdropComposite(), true);
assert.equal(session.renderFloatingGlassPanel({ x: 1, y: 2, w: 3, h: 4 }), true);
assert.equal(session.getFloatingUILayerId(), 'surface-4');
assert.deepEqual(created.slice(2).map(({ type, order }) => ({ type, order })), [
    { type: 'webgl', order: 3002 },
    { type: '2d', order: 3003 }
]);
const floatingGlass = renders.find(({ type }) => type === 'webgl');
assert.equal(floatingGlass.layer, 'surface-3');
assert.equal(floatingGlass.command.sourceProvider().snapshotIdentity, 'before:surface-3');

session.setDisableTransparency(true);
assert.equal(session.getGlassMix(), 1);
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 0);
animations.at(-1).setProgress(0.25);
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 0.75);
assert.equal(session.requiresBackdropComposite(), true);
animations.at(-1).complete();
await Promise.resolve();
assert.equal(session.getGlassMix(), 0);
assert.equal(session.getGlassPanelAlpha(), 0);
assert.equal(session.getOpaquePanelAlpha(), 1);
assert.equal(session.requiresBackdropComposite(), false);
assert.deepEqual(released, ['surface-1', 'surface-3', 'surface-4']);

session.setDisableTransparency(false);
assert.equal(session.getGlassMix(), 0);
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 1);
assert.equal(session.requiresBackdropComposite(), true);
animations.at(-1).setProgress(0.25);
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 0.75);
animations.at(-1).complete();
await Promise.resolve();
assert.equal(session.getGlassPanelAlpha(), 1);
assert.equal(session.getOpaquePanelAlpha(), 0);
assert.equal(session.requiresBackdropComposite(), true);

console.log('overlay session floating glass contract: ok');
