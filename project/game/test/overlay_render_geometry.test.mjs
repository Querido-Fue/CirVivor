import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const geometryModule = await loadGameModule(
    'display/webgl/_overlay_render_geometry.js'
);
const shaderModule = await loadGameModule('display/webgl/_shader_utils.js');
const {
    resolveOverlayContentSurfaceStyles,
    resolveOverlayEffectTextureRect
} = geometryModule;
const { PANEL_TEXTURE_FRAGMENT_SHADER } = shaderModule;

let surfaceStyles = resolveOverlayContentSurfaceStyles(
    0.9,
    0.25,
    0.75,
    20
);
assert.equal(surfaceStyles.transformOrigin, '25% 75%');
assert.equal(surfaceStyles.uiTransform, 'scale(0.9)');
assert.equal(surfaceStyles.effectTransform, 'none');
assert.equal(surfaceStyles.uiFilter, 'blur(20px)');
assert.equal(surfaceStyles.effectFilter, 'blur(20px)');

surfaceStyles = resolveOverlayContentSurfaceStyles(
    1,
    0.5,
    0.5,
    0,
    surfaceStyles
);
assert.equal(surfaceStyles.transformOrigin, '50% 50%');
assert.equal(surfaceStyles.uiTransform, 'none');
assert.equal(surfaceStyles.effectTransform, 'none');
assert.equal(surfaceStyles.uiFilter, 'none');
assert.equal(surfaceStyles.effectFilter, 'none');

const panelRect = { x: 300, y: 120, w: 900, h: 620 };
let textureRect = resolveOverlayEffectTextureRect(
    panelRect,
    { x: 630, y: 340, w: 240, h: 180 }
);
assert.equal(textureRect.x, 330);
assert.equal(textureRect.y, 220);
assert.equal(textureRect.w, 240);
assert.equal(textureRect.h, 180);

textureRect = resolveOverlayEffectTextureRect(panelRect, null, textureRect);
assert.equal(textureRect.x, 0);
assert.equal(textureRect.y, 0);
assert.equal(textureRect.w, panelRect.w);
assert.equal(textureRect.h, panelRect.h);

textureRect = resolveOverlayEffectTextureRect(
    { x: 300, y: 80, w: 700, h: 800 },
    { x: 150, y: 330, w: 1000, h: 300 },
    textureRect
);
assert.equal(textureRect.x, -150);
assert.equal(textureRect.y, 250);
assert.equal(textureRect.w, 1000);
assert.equal(textureRect.h, 300);

assert.match(PANEL_TEXTURE_FRAGMENT_SHADER, /uniform vec4 u_textureRect;/);
assert.match(PANEL_TEXTURE_FRAGMENT_SHADER, /textureLocal = v_panelLocal - u_textureRect\.xy/);

const rendererSource = await readFile(
    new URL('../script/module/display/webgl/_overlay_effect_renderer.js', import.meta.url),
    'utf8'
);
assert.match(rendererSource, /'u_textureRect'/);
assert.match(rendererSource, /uniform4f\(\s*this\.panelTextureProgram\.uniforms\.u_textureRect/);

console.log('overlay render geometry contract: ok');
