import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const glassPanelModule = await loadGameModule(
    'scene/title/menu/_title_menu_glass_panel_render.js'
);
const {
    renderTitleMenuGlassPanel,
    resolveTitleMenuConnectedFrontPanelStyle
} = glassPanelModule;

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
const connectedFrontStyle = resolveTitleMenuConnectedFrontPanelStyle(baseStyle, true, true);
assert.notEqual(connectedFrontStyle, baseStyle);
assert.equal(connectedFrontStyle.sampleBackdrop, true);
assert.ok(connectedFrontStyle.blur > 0);
assert.equal(baseStyle.sampleBackdrop, false);
assert.equal(baseStyle.blur, 0);
assert.equal(resolveTitleMenuConnectedFrontPanelStyle(baseStyle, false, true), baseStyle);
assert.equal(resolveTitleMenuConnectedFrontPanelStyle(baseStyle, true, false), baseStyle);

const panelRect = Object.freeze({ x: 10, y: 20, w: 300, h: 180, radius: 16 });
const transformMatrix = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 0, 1]);
const perspective = Object.freeze({ distance: 900 });
const effectTextureCanvas = Object.freeze({ width: 120, height: 80 });
const effectTextureRect = Object.freeze({ x: 100, y: 80, w: 120, h: 80 });
let renderedCommand = null;
const session = {
    renderGlassPanel(command) {
        renderedCommand = command;
    }
};

renderTitleMenuGlassPanel(session, {
    panelRect,
    panelStyle: connectedFrontStyle,
    alpha: 0.75,
    transformMatrix,
    perspective,
    effectTextureCanvas,
    effectTextureRect
});

assert.equal(renderedCommand.sampleBackdrop, true);
assert.ok(renderedCommand.blur > 0);
assert.equal(renderedCommand.x, panelRect.x);
assert.equal(renderedCommand.y, panelRect.y);
assert.equal(renderedCommand.w, panelRect.w);
assert.equal(renderedCommand.h, panelRect.h);
assert.equal(renderedCommand.transformMatrix, transformMatrix);
assert.equal(renderedCommand.perspective, perspective);
assert.equal(renderedCommand.effectTextureCanvas, effectTextureCanvas);
assert.equal(renderedCommand.effectTextureRect, effectTextureRect);

console.log('title menu connected front glass contract: ok');
