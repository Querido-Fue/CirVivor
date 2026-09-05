import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { WebGLHandler } = await loadGameModule(
    'display/webgl/_webgl_handler.js'
);
const { OverlayEffectRenderer } = await loadGameModule(
    'display/webgl/_overlay_effect_renderer.js'
);
const { EffectRenderer } = await loadGameModule(
    'display/webgl/_effect_renderer.js'
);

/**
 * OverlayEffectRenderer 생성 및 resize 계약에 필요한 WebGL 스텁을 생성합니다.
 * @param {Array<object>} calls - 기록할 호출 목록입니다.
 * @returns {object} WebGL 컨텍스트 스텁입니다.
 */
function createOverlayRendererGl(calls) {
    let handleSerial = 0;
    let boundFramebuffer = null;
    const createHandle = (kind) => ({ kind, id: ++handleSerial });
    return {
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88E4,
        VERTEX_SHADER: 0x8B31,
        FRAGMENT_SHADER: 0x8B30,
        COMPILE_STATUS: 0x8B81,
        LINK_STATUS: 0x8B82,
        TEXTURE_2D: 0x0DE1,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        CLAMP_TO_EDGE: 0x812F,
        LINEAR: 0x2601,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        FRAMEBUFFER: 0x8D40,
        COLOR_BUFFER_BIT: 0x4000,
        COLOR_ATTACHMENT0: 0x8CE0,
        createShader: () => createHandle('shader'),
        shaderSource() {},
        compileShader() {},
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        deleteShader() {},
        createProgram: () => createHandle('program'),
        attachShader() {},
        linkProgram() {},
        getProgramParameter: () => true,
        getProgramInfoLog: () => '',
        deleteProgram() {},
        getUniformLocation: (_program, name) => name,
        getAttribLocation: () => 0,
        createBuffer: () => createHandle('buffer'),
        bindBuffer() {},
        bufferData() {},
        deleteBuffer() {},
        createTexture: () => createHandle('texture'),
        bindTexture() {},
        texParameteri() {},
        texImage2D() {},
        deleteTexture() {},
        createFramebuffer() {
            const framebuffer = createHandle('framebuffer');
            calls.push({ name: 'createFramebuffer', framebuffer });
            return framebuffer;
        },
        bindFramebuffer(target, framebuffer) {
            boundFramebuffer = framebuffer;
            calls.push({ name: 'bindFramebuffer', target, framebuffer });
        },
        framebufferTexture2D() {},
        deleteFramebuffer() {},
        viewport(x, y, width, height) {
            calls.push({ name: 'viewport', x, y, width, height });
        },
        clearColor(red, green, blue, alpha) {
            calls.push({ name: 'clearColor', red, green, blue, alpha });
        },
        clear(mask) {
            calls.push({ name: 'clear', mask, framebuffer: boundFramebuffer });
        }
    };
}

/**
 * WebGLHandler clear와 EffectRenderer frame begin의 통합 순서를 기록하는 GL 스텁을 생성합니다.
 * @param {Array<object>} calls - 기록할 호출 목록입니다.
 * @param {number} drawingBufferWidth - 실제 drawing-buffer 너비입니다.
 * @param {number} drawingBufferHeight - 실제 drawing-buffer 높이입니다.
 * @returns {object} WebGL 컨텍스트 스텁입니다.
 */
function createEffectFrameGl(calls, drawingBufferWidth, drawingBufferHeight) {
    let boundFramebuffer = null;
    return {
        FRAMEBUFFER: 0x8D40,
        COLOR_BUFFER_BIT: 0x4000,
        drawingBufferWidth,
        drawingBufferHeight,
        bindFramebuffer(target, framebuffer) {
            boundFramebuffer = framebuffer;
            calls.push({ name: 'bindFramebuffer', target, framebuffer });
        },
        viewport(x, y, width, height) {
            calls.push({ name: 'viewport', x, y, width, height });
        },
        clearColor(red, green, blue, alpha) {
            calls.push({ name: 'clearColor', red, green, blue, alpha });
        },
        clear(mask) {
            calls.push({ name: 'clear', mask, framebuffer: boundFramebuffer });
        }
    };
}

test('overlay layer frame은 기본 FBO를 viewport에 맞춰 한 번만 clear한다', () => {
    const calls = [];
    const previousFramebuffer = { id: 'previous-offscreen-fbo' };
    const gl = createOverlayRendererGl(calls);
    const renderer = new OverlayEffectRenderer(gl);
    renderer.resize(640, 360);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    calls.length = 0;
    const originalBeginFrame = renderer.beginFrame.bind(renderer);
    renderer.beginFrame = (width, height) => {
        calls.push({ name: 'beginFrame', width, height });
        originalBeginFrame(width, height);
    };
    const handler = new WebGLHandler();
    handler.width = 640;
    handler.height = 360;
    handler.glContexts.set('overlay', gl);
    handler.layerModes.set('overlay', 'overlay-effect');
    handler.layerRenderers.set('overlay', renderer);
    handler.layerCallbacks.set('overlay', {
        onFrameClear(isBackground) {
            calls.push({ name: 'onFrameClear', isBackground });
        }
    });

    handler.clearAll();

    const bindCallIndex = calls.findIndex((call) => call.name === 'bindFramebuffer');
    const viewportCallIndex = calls.findIndex((call) => call.name === 'viewport');
    const clearCallIndex = calls.findIndex((call) => call.name === 'clear');
    const beginFrameCallIndex = calls.findIndex((call) => call.name === 'beginFrame');
    const clearCalls = calls.filter((call) => call.name === 'clear');

    assert.ok(bindCallIndex >= 0);
    assert.ok(bindCallIndex < viewportCallIndex);
    assert.ok(viewportCallIndex < clearCallIndex);
    assert.ok(clearCallIndex < beginFrameCallIndex);
    assert.equal(calls[bindCallIndex].framebuffer, null);
    assert.deepEqual(
        calls[viewportCallIndex],
        { name: 'viewport', x: 0, y: 0, width: 640, height: 360 }
    );
    assert.equal(clearCalls.length, 1);
    assert.equal(clearCalls[0].framebuffer, null);
    assert.equal(clearCalls[0].mask, gl.COLOR_BUFFER_BIT);
    assert.deepEqual(
        calls[beginFrameCallIndex],
        { name: 'beginFrame', width: 640, height: 360 }
    );
    assert.equal(renderer.frameSerial, 1);
    assert.deepEqual(calls.at(-1), { name: 'onFrameClear', isBackground: false });
});

test('OverlayEffectRenderer.beginFrame은 resize와 frameSerial만 갱신한다', () => {
    const calls = [];
    const renderer = new OverlayEffectRenderer(createOverlayRendererGl(calls));
    calls.length = 0;

    renderer.beginFrame(320.9, 180.8);

    assert.equal(renderer.width, 320);
    assert.equal(renderer.height, 180);
    assert.equal(renderer.frameSerial, 1);
    assert.equal(calls.filter((call) => call.name === 'createFramebuffer').length, 8);
    assert.equal(calls.filter((call) => call.name === 'clear').length, 0);

    calls.length = 0;
    renderer.beginFrame(320, 180);

    assert.equal(renderer.width, 320);
    assert.equal(renderer.height, 180);
    assert.equal(renderer.frameSerial, 2);
    assert.equal(calls.filter((call) => call.name === 'createFramebuffer').length, 0);
    assert.equal(calls.filter((call) => call.name === 'clear').length, 0);
});

test('effect layer clear는 handler clear 뒤 실제 drawing-buffer viewport와 queue clear를 적용한다', () => {
    const calls = [];
    const gl = createEffectFrameGl(calls, 801.9, 451.9);
    const queueBacking = [{ id: 1 }, { id: 2 }];
    const commands = new Proxy(queueBacking, {
        set(target, property, value, receiver) {
            calls.push({ name: 'commands:set', property, value });
            return Reflect.set(target, property, value, receiver);
        }
    });
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.gl = gl;
    renderer.width = 0;
    renderer.height = 0;
    renderer.commands = commands;
    Object.defineProperty(renderer, 'frameSerial', {
        get() {
            throw new Error('EffectRenderer must not read frameSerial');
        },
        set() {
            throw new Error('EffectRenderer must not write frameSerial');
        }
    });

    const handler = new WebGLHandler();
    handler.width = 640;
    handler.height = 360;
    handler.glContexts.set('effect-layer', gl);
    handler.layerModes.set('effect-layer', 'effect');
    handler.layerRenderers.set('effect-layer', renderer);
    handler.layerCallbacks.set('effect-layer', {
        onFrameClear(isBackground) {
            calls.push({ name: 'onFrameClear', isBackground });
        }
    });

    assert.equal(handler.clearAll(), undefined);
    assert.equal(renderer.width, 801);
    assert.equal(renderer.height, 451);
    assert.equal(queueBacking.length, 0);
    assert.deepEqual(calls, [
        { name: 'bindFramebuffer', target: gl.FRAMEBUFFER, framebuffer: null },
        { name: 'viewport', x: 0, y: 0, width: 640, height: 360 },
        { name: 'clearColor', red: 0, green: 0, blue: 0, alpha: 0 },
        { name: 'clear', mask: gl.COLOR_BUFFER_BIT, framebuffer: null },
        { name: 'bindFramebuffer', target: gl.FRAMEBUFFER, framebuffer: null },
        { name: 'viewport', x: 0, y: 0, width: 801, height: 451 },
        { name: 'commands:set', property: 'length', value: 0 },
        { name: 'onFrameClear', isBackground: false }
    ]);
});

test('effect begin 실패는 callback과 뒤 WebGL layer 처리를 중단하고 같은 오류를 전파한다', () => {
    const calls = [];
    const laterCalls = [];
    const error = Object.freeze({ stage: 'effect queue clear' });
    const gl = createEffectFrameGl(calls, 320, 180);
    const commands = new Proxy([{ id: 1 }], {
        set(_target, property, value) {
            calls.push({ name: 'commands:set', property, value });
            throw error;
        }
    });
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.gl = gl;
    renderer.width = 0;
    renderer.height = 0;
    renderer.commands = commands;

    const laterGl = createEffectFrameGl(laterCalls, 320, 180);
    const handler = new WebGLHandler();
    handler.width = 320;
    handler.height = 180;
    handler.glContexts.set('effect-layer', gl);
    handler.glContexts.set('later-layer', laterGl);
    handler.layerModes.set('effect-layer', 'effect');
    handler.layerModes.set('later-layer', 'batch');
    handler.layerRenderers.set('effect-layer', renderer);
    handler.layerRenderers.set('later-layer', {
        begin() {
            laterCalls.push({ name: 'begin' });
        }
    });
    let callbackCalls = 0;
    handler.layerCallbacks.set('effect-layer', {
        onFrameClear() {
            callbackCalls += 1;
        }
    });
    handler.layerCallbacks.set('later-layer', {
        onFrameClear() {
            callbackCalls += 1;
        }
    });

    let thrown;
    try {
        handler.clearAll();
    } catch (caught) {
        thrown = caught;
    }
    assert.strictEqual(thrown, error);
    assert.deepEqual(calls, [
        { name: 'bindFramebuffer', target: gl.FRAMEBUFFER, framebuffer: null },
        { name: 'viewport', x: 0, y: 0, width: 320, height: 180 },
        { name: 'clearColor', red: 0, green: 0, blue: 0, alpha: 0 },
        { name: 'clear', mask: gl.COLOR_BUFFER_BIT, framebuffer: null },
        { name: 'bindFramebuffer', target: gl.FRAMEBUFFER, framebuffer: null },
        { name: 'viewport', x: 0, y: 0, width: 320, height: 180 },
        { name: 'commands:set', property: 'length', value: 0 }
    ]);
    assert.equal(callbackCalls, 0);
    assert.deepEqual(laterCalls, []);
});
