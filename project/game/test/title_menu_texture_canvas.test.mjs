import assert from 'node:assert/strict';
import { loadGameModule } from './support/source_module_loader.mjs';

const textureCanvasModule = await loadGameModule(
    'scene/title/menu/_title_menu_texture_canvas.js'
);
const {
    beginTitleMenuTextureClip,
    ensureTitleMenuTextureCanvas,
    resolveTitleMenuTextureRasterSize
} = textureCanvasModule;

const panelRect = Object.freeze({ w: 200.25, h: 100.5, radius: 12 });
let rasterSize = resolveTitleMenuTextureRasterSize(panelRect, {
    width: 900.1,
    height: 600.2
});
assert.equal(rasterSize.width, 901);
assert.equal(rasterSize.height, 601);

rasterSize = resolveTitleMenuTextureRasterSize(panelRect, {
    width: 100,
    height: 50
});
assert.equal(rasterSize.width, 201);
assert.equal(rasterSize.height, 101);

rasterSize = resolveTitleMenuTextureRasterSize(panelRect, {
    width: Number.NaN,
    height: Number.NaN
});
assert.equal(rasterSize.width, 201);
assert.equal(rasterSize.height, 101);

const existingContext = {};
const existingCanvas = { width: 1, height: 1 };
const textureOwner = {
    textureCanvas: existingCanvas,
    textureContext: existingContext
};
const ensuredTexture = ensureTitleMenuTextureCanvas(
    textureOwner,
    'textureCanvas',
    'textureContext',
    900.1,
    600.2
);
assert.equal(ensuredTexture.canvas, existingCanvas);
assert.equal(ensuredTexture.context, existingContext);
assert.equal(ensuredTexture.width, 901);
assert.equal(ensuredTexture.height, 601);
assert.equal(existingCanvas.width, 901);
assert.equal(existingCanvas.height, 601);

const calls = [];
const context = {
    setTransform(...args) {
        calls.push(['setTransform', ...args]);
    },
    clearRect(...args) {
        calls.push(['clearRect', ...args]);
    },
    save() {
        calls.push(['save']);
    },
    beginPath() {
        calls.push(['beginPath']);
    },
    roundRect(...args) {
        calls.push(['roundRect', ...args]);
    },
    clip() {
        calls.push(['clip']);
    }
};

beginTitleMenuTextureClip(
    context,
    1000,
    600,
    { w: 200, h: 100, radius: 12 }
);

assert.deepEqual(calls, [
    ['setTransform', 1, 0, 0, 1, 0, 0],
    ['clearRect', 0, 0, 1000, 600],
    ['save'],
    ['setTransform', 5, 0, 0, -6, 0, 600],
    ['beginPath'],
    ['roundRect', 0, 0, 200, 100, 12],
    ['clip']
]);

console.log('title menu texture raster contract: ok');
