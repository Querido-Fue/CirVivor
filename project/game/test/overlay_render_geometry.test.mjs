import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadGameModule } from './support/source_module_loader.mjs';

const geometryModule = await loadGameModule(
    'display/webgl/_overlay_render_geometry.js'
);
const shaderModule = await loadGameModule('display/webgl/_shader_utils.js');
const {
    multiplyOverlayTransformMatrices,
    resolveOverlayContentSurfaceStyles,
    resolveOverlayEffectTextureRect,
    writeOverlayContentTransformMatrix
} = geometryModule;
const { PANEL_TEXTURE_FRAGMENT_SHADER } = shaderModule;

const transform = {
    translateXRatio: 0.1,
    translateYRatio: -0.2,
    scaleX: 0.5,
    scaleY: 0.75,
    rotateY: -Math.PI * 0.5
};
const matrix = writeOverlayContentTransformMatrix(transform, 1000, 500);
assert.ok(Math.abs(matrix[0]) < 1e-12);
assert.equal(matrix[2], 1);
assert.equal(matrix[5], 0.75);
assert.equal(matrix[8], -0.5);
assert.ok(Math.abs(matrix[10]) < 1e-12);
assert.equal(matrix[12], 100);
assert.equal(matrix[13], -100);
assert.equal(matrix[15], 1);

const identity = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);
const combined = multiplyOverlayTransformMatrices(matrix, identity);
for (let index = 0; index < 16; index++) {
    assert.equal(combined[index], matrix[index]);
}

const baseTransform = new Float32Array([
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, -1, 0, 0,
    30, 40, 50, 1
]);
const orderedCombined = multiplyOverlayTransformMatrices(matrix, baseTransform);
const transformPoint = (targetMatrix, point) => {
    return [0, 1, 2, 3].map((row) => {
        return targetMatrix[row] * point[0]
            + targetMatrix[4 + row] * point[1]
            + targetMatrix[8 + row] * point[2]
            + targetMatrix[12 + row] * point[3];
    });
};
const point = [7, 11, 13, 1];
const sequentialPoint = transformPoint(matrix, transformPoint(baseTransform, point));
const combinedPoint = transformPoint(orderedCombined, point);
for (let index = 0; index < 4; index++) {
    assert.ok(Math.abs(combinedPoint[index] - sequentialPoint[index]) < 1e-5);
}

const contentTransform = {
    originXRatio: 0.6,
    originYRatio: 0.4,
    translateXRatio: 0.1,
    translateYRatio: -0.2,
    scaleX: 0.5,
    scaleY: 0.75,
    rotateY: -0.25,
    perspectiveRatio: 0.8
};
let surfaceStyles = resolveOverlayContentSurfaceStyles(
    contentTransform,
    false,
    1,
    0.5,
    0.5
);
assert.equal(surfaceStyles.transformOrigin, '60% 40%');
assert.match(surfaceStyles.uiTransform, /^perspective\(80vw\)/);
assert.equal(surfaceStyles.effectTransform, 'none');

surfaceStyles = resolveOverlayContentSurfaceStyles(
    contentTransform,
    true,
    1,
    0.5,
    0.5,
    surfaceStyles
);
assert.equal(surfaceStyles.effectTransform, surfaceStyles.uiTransform);

surfaceStyles = resolveOverlayContentSurfaceStyles(
    null,
    true,
    1.1,
    0.25,
    0.75,
    surfaceStyles
);
assert.equal(surfaceStyles.transformOrigin, '25% 75%');
assert.equal(surfaceStyles.uiTransform, 'scale(1.1)');
assert.equal(surfaceStyles.effectTransform, 'none');

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
