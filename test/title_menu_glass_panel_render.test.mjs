import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const glassPanelModule = await loadGameModule(
    'scene/title/menu/_title_menu_glass_panel_render.js'
);
const { renderTitleMenuGlassPanel } = glassPanelModule;

const baseStyle = Object.freeze({
    sampleBackdrop: false,
    blur: 0,
    fill: '#111111',
    stroke: '#ffffff',
    lineWidth: 1,
    tintColor: '#ffffff',
    edgeColor: '#ffffff',
    tintStrength: 0.2,
    edgeStrength: 0.1,
    refractionStrength: 0
});
const panelRect = Object.freeze({ x: 10, y: 20, w: 300, h: 180, radius: 16 });
const transformMatrix = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 0, 1]);
const perspective = Object.freeze({ distance: 900 });
const effectTextureCanvas = Object.freeze({ width: 120, height: 80 });
let renderedCommand = null;
const recordedBounds = [];
const session = {
    recordTitleWebGpuPanelContentBounds(bounds) {
        recordedBounds.push(bounds);
    },
    renderGlassPanel(command) {
        renderedCommand = command;
    }
};

renderTitleMenuGlassPanel(session, {
    panelRect,
    panelStyle: baseStyle,
    alpha: 0.75,
    transformMatrix,
    perspective,
    effectTextureCanvas
});

assert.equal(renderedCommand.sampleBackdrop, false);
assert.equal(renderedCommand.blur, 0);
assert.equal(renderedCommand.x, panelRect.x);
assert.equal(renderedCommand.y, panelRect.y);
assert.equal(renderedCommand.w, panelRect.w);
assert.equal(renderedCommand.h, panelRect.h);
assert.equal(renderedCommand.transformMatrix, transformMatrix);
assert.equal(renderedCommand.perspective, perspective);
assert.equal(renderedCommand.effectTextureCanvas, effectTextureCanvas);
assert.deepEqual(recordedBounds, [panelRect]);

const mixedCommands = [];
const mixedSession = {
    getGlassPanelAlpha: () => 1,
    getOpaquePanelAlpha: () => 0.75,
    recordTitleWebGpuPanelContentBounds(bounds) {
        recordedBounds.push(bounds);
    },
    renderGlassPanel(command) {
        mixedCommands.push(command);
    }
};
const glassStyle = { ...baseStyle, sampleBackdrop: true, blur: 14, fill: '#224466' };
const opaqueStyle = { ...baseStyle, sampleBackdrop: false, blur: 0, fill: '#101010' };
renderTitleMenuGlassPanel(mixedSession, {
    panelRect,
    panelStyle: glassStyle,
    opaquePanelStyle: opaqueStyle,
    alpha: 0.8,
    transformMatrix,
    perspective,
    effectTextureCanvas
});

assert.equal(mixedCommands.length, 2);
assert.deepEqual(
    mixedCommands.map(({ sampleBackdrop, blur, fill, alpha }) => ({ sampleBackdrop, blur, fill, alpha })),
    [
        { sampleBackdrop: true, blur: 14, fill: '#224466', alpha: 0.8 },
        { sampleBackdrop: false, blur: 0, fill: '#101010', alpha: 0.6000000000000001 }
    ]
);
assert.equal(mixedCommands[0].transformMatrix, transformMatrix);
assert.equal(mixedCommands[1].effectTextureCanvas, effectTextureCanvas);
assert.deepEqual(recordedBounds, [panelRect, panelRect]);

console.log('title menu glass panel render contract: ok');
