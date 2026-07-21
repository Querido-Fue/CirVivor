import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const [baseOverlaySource, panelInteractionSource] = await Promise.all([
    readFile(new URL('../script/module/overlay/_base_overlay.js', import.meta.url), 'utf8'),
    readFile(new URL('../script/module/overlay/overlay_panel_interaction_update.js', import.meta.url), 'utf8')
]);

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context });
}

const animationPreset = Object.freeze({
    open: Object.freeze({
        alpha: Object.freeze({ from: 0, to: 1, easing: 'easeOutExpo', duration: 0.5 }),
        scale: Object.freeze({ from: 0.9, to: 1, easing: 'easeOutExpo', duration: 0.5 }),
        blur: Object.freeze({ from: 10, to: 0, easing: 'easeOutExpo', duration: 0.5 })
    }),
    close: Object.freeze({
        alpha: Object.freeze({ to: 0, easing: 'easeInExpo', duration: 0.5 }),
        scale: Object.freeze({ to: 0.9, easing: 'easeInExpo', duration: 0.5 }),
        blur: Object.freeze({ to: 10, easing: 'easeInExpo', duration: 0.5 })
    })
});

const baseContext = vm.createContext({ console });
const panelInteractionOptions = [];
let animationId = 0;
const baseModule = new vm.SourceTextModule(baseOverlaySource, {
    context: baseContext,
    identifier: '_base_overlay.js'
});
const baseDependencies = new Map([
    ['animation/animation_system.js', createSyntheticModule(baseContext, {
        animate: () => ({ id: animationId++, promise: new Promise(() => {}) }),
        remove: () => {}
    })],
    ['debug/debug_system.js', createSyntheticModule(baseContext, {
        beginPerformanceSection: () => 0,
        endPerformanceSection: () => {}
    })],
    ['display/display_system.js', createSyntheticModule(baseContext, {
        getWH: () => 1080,
        getUIWW: () => 1920,
        getWW: () => 1920,
        render: () => {},
        shadowOff: () => {},
        shadowOn: () => {}
    })],
    ['display/_theme_handler.js', createSyntheticModule(baseContext, { ColorSchemes: {} })],
    ['input/input_system.js', createSyntheticModule(baseContext, {
        getMouseFocus: () => ['ui'],
        setMouseFocus: () => {}
    })],
    ['ui/_ui_pool.js', createSyntheticModule(baseContext, { releaseUIItem: () => {} })],
    ['ui/layout/_positioning_handler.js', createSyntheticModule(baseContext, {
        PositioningHandler: class PositioningHandler {
            resize() {}
        }
    })],
    ['save/save_system.js', createSyntheticModule(baseContext, { getSetting: () => 100 })],
    ['util/number_util.js', createSyntheticModule(baseContext, {
        clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
    })],
    ['./_animation_presets.js', createSyntheticModule(baseContext, {
        getOverlayAnimationPreset: () => animationPreset
    })],
    ['./overlay_panel_region.js', createSyntheticModule(baseContext, {
        DEFAULT_OVERLAY_PANEL_ID: 'root',
        createOverlayPanelMap: () => new Map(),
        getOverlayPresentationOrigin: (_overlay, target) => Object.assign(target, { x: 0, y: 0 }),
        getOverlayPresentedPanelRegion: (panel) => panel,
        resolveOverlayPanelRegion: (definition) => definition
    })],
    ['./overlay_panel_interaction_state.js', createSyntheticModule(baseContext, {
        syncOverlayPanelInteractionStates: () => {}
    })],
    ['./overlay_panel_effect_canvas.js', createSyntheticModule(baseContext, {
        buildOverlayPanelEffectCanvas: () => null
    })],
    ['./overlay_panel_interaction_update.js', createSyntheticModule(baseContext, {
        updateOverlayPanelInteractions: (options) => panelInteractionOptions.push({ ...options })
    })]
]);
await baseModule.link((specifier) => baseDependencies.get(specifier));
await baseModule.evaluate();

const { BaseOverlay } = baseModule.namespace;
const overlay = new BaseOverlay();
const dynamicTrace = [];
overlay.dynamicItems = [
    {
        item: {
            update() {
                dynamicTrace.push('close');
                overlay.close();
            }
        }
    },
    {
        item: {
            update() {
                dynamicTrace.push('after-close');
            }
        }
    }
];

overlay.update();
assert.deepEqual(dynamicTrace, ['close']);
assert.equal(overlay.isInteractionLocked(), true);
assert.equal(panelInteractionOptions.at(-1).interactionsEnabled, true);

overlay.update();
assert.deepEqual(dynamicTrace, ['close']);
assert.equal(panelInteractionOptions.at(-1).interactionsEnabled, false);
assert.equal(overlay.lockInteractions(), false);

overlay.open();
assert.equal(overlay.isInteractionLocked(), false);
overlay.dynamicItems = [{ item: { update: () => dynamicTrace.push('reopened') } }];
overlay.update();
assert.deepEqual(dynamicTrace, ['close', 'reopened']);

const panelContext = vm.createContext({ console, Math });
const panelModule = new vm.SourceTextModule(panelInteractionSource, {
    context: panelContext,
    identifier: 'overlay_panel_interaction_update.js'
});
const panelDependencies = new Map([
    ['game/time_handler.js', createSyntheticModule(panelContext, { getDelta: () => 1 / 60 })],
    ['input/input_system.js', createSyntheticModule(panelContext, {
        getMouseFocus: () => ['overlay-ui'],
        getMouseInput: (key) => key === 'x' ? 5 : 5,
        hasMouseState: () => true
    })],
    ['util/number_util.js', createSyntheticModule(panelContext, {
        clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
    })],
    ['./_panel_effect_math.js', createSyntheticModule(panelContext, {
        createRectToQuadHomography: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
        createTiltMatrix: () => new Float32Array(16),
        getDeltaLerpFactor: () => 1,
        invertMat3: (matrix) => matrix,
        isPointInsideQuad: () => true,
        isPointInsideRoundedRect: () => true,
        lerpNumber: (start, end, progress) => start + ((end - start) * progress),
        mapScreenPointToPanelLocal: () => ({ x: 5, y: 5 }),
        projectPanelQuad: () => [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    })],
    ['./overlay_panel_region.js', createSyntheticModule(panelContext, {
        getOverlayPresentedPanelRegion: (panel) => panel
    })]
]);
await panelModule.link((specifier) => panelDependencies.get(specifier));
await panelModule.evaluate();

const panelClickTrace = [];
const panelOverlay = {
    locked: false,
    isInteractionLocked() {
        return this.locked;
    },
    lockInteractions() {
        this.locked = true;
    }
};
const panels = [
    {
        id: 'first', visible: true, x: 0, y: 0, w: 10, h: 10, radius: 0,
        onClick() {
            panelClickTrace.push('first');
            panelOverlay.lockInteractions();
        }
    },
    {
        id: 'second', visible: true, x: 0, y: 0, w: 10, h: 10, radius: 0,
        onClick() {
            panelClickTrace.push('second');
        }
    }
];
const createInteractionState = () => ({
    hovered: false,
    wasHovered: false,
    localX: 0,
    localY: 0,
    normalizedX: 0,
    normalizedY: 0,
    rotateX: 0,
    rotateY: 0,
    targetRotateX: 0,
    targetRotateY: 0,
    spotlightAlpha: 0,
    borderAlpha: 0,
    particleAlpha: 0,
    particles: [],
    ripples: []
});
const panelInteractionMap = new Map(panels.map((panel) => [panel.id, createInteractionState()]));
panelModule.namespace.updateOverlayPanelInteractions({
    overlay: panelOverlay,
    session: { getEffectOptions: () => null },
    layer: 'overlay-ui',
    alpha: 1,
    panelRegions: panels,
    panelInteractionMap,
    interactionsEnabled: true
});
assert.deepEqual(panelClickTrace, ['first']);

console.log('overlay interaction lock: ok');
