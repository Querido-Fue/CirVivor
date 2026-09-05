import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const WEBGL_HANDLER_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgl/_webgl_handler.js',
    import.meta.url
));
const webGLHandlerSource = await readFile(WEBGL_HANDLER_SOURCE_PATH, 'utf8');
const { WebGLHandler } = await loadGameModule('display/webgl/_webgl_handler.js');

/**
 * 동기 호출에서 던져진 값을 반환합니다.
 * @param {Function} action - 실행할 동기 함수입니다.
 * @returns {*} 던져진 값입니다.
 */
function captureThrown(action) {
    let didThrow = false;
    let thrownValue;
    try {
        action();
    } catch (error) {
        didThrow = true;
        thrownValue = error;
    }
    assert.equal(didThrow, true, '동기 예외가 발생해야 합니다.');
    return thrownValue;
}

/**
 * clearAll의 정상 호출 및 단계별 예외 순서를 기록하는 hostile harness를 생성합니다.
 * @param {string|null} throwAt - 예외를 발생시킬 checkpoint입니다.
 * @param {{includeLater?: boolean}} [options] - 뒤 레이어 포함 여부입니다.
 * @returns {{handler: WebGLHandler, trace: string[], error: object}}
 */
function createCheckpointHarness(throwAt = null, options = {}) {
    const trace = [];
    const error = Object.freeze({ stage: throwAt });
    const checkpoint = (stage) => {
        trace.push(stage);
        if (stage === throwAt) {
            throw error;
        }
    };
    const ignoredThenable = {};
    Object.defineProperty(ignoredThenable, 'then', {
        get() {
            throw new Error('return thenable must not be observed');
        }
    });

    const handler = new WebGLHandler();
    let widthReads = 0;
    let heightReads = 0;
    Object.defineProperty(handler, 'width', {
        configurable: true,
        get() {
            const stage = widthReads++ === 0 ? 'handler.width:viewport' : 'handler.width:begin';
            checkpoint(stage);
            return 640;
        }
    });
    Object.defineProperty(handler, 'height', {
        configurable: true,
        get() {
            const stage = heightReads++ === 0 ? 'handler.height:viewport' : 'handler.height:begin';
            checkpoint(stage);
            return 360;
        }
    });

    const colors = [0.1, 0.2, 0.3, 0.4];
    let colorProviderReads = 0;
    Object.defineProperty(handler, 'backgroundColor', {
        configurable: true,
        get() {
            const channel = colorProviderReads++;
            checkpoint(`handler.backgroundColor:${channel}`);
            const provider = {};
            Object.defineProperty(provider, String(channel), {
                get() {
                    checkpoint(`backgroundColor[${channel}]`);
                    return colors[channel];
                }
            });
            return provider;
        }
    });

    const gl = {};
    Object.defineProperty(gl, 'FRAMEBUFFER', {
        get() {
            checkpoint('gl.FRAMEBUFFER:get');
            return 0x8D40;
        }
    });
    Object.defineProperty(gl, 'COLOR_BUFFER_BIT', {
        get() {
            checkpoint('gl.COLOR_BUFFER_BIT:get');
            return 0x4000;
        }
    });
    Object.defineProperty(gl, 'bindFramebuffer', {
        get() {
            checkpoint('gl.bindFramebuffer:get');
            return function bindFramebuffer(...args) {
                assert.strictEqual(this, gl);
                assert.deepEqual(args, [0x8D40, null]);
                checkpoint('gl.bindFramebuffer:call');
                return ignoredThenable;
            };
        }
    });
    Object.defineProperty(gl, 'viewport', {
        get() {
            checkpoint('gl.viewport:get');
            return function viewport(...args) {
                assert.strictEqual(this, gl);
                assert.deepEqual(args, [0, 0, 640, 360]);
                checkpoint('gl.viewport:call');
                return ignoredThenable;
            };
        }
    });
    Object.defineProperty(gl, 'clearColor', {
        get() {
            checkpoint('gl.clearColor:get');
            return function clearColor(...args) {
                assert.strictEqual(this, gl);
                assert.deepEqual(args, colors);
                checkpoint('gl.clearColor:call');
                return ignoredThenable;
            };
        }
    });
    Object.defineProperty(gl, 'clear', {
        get() {
            checkpoint('gl.clear:get');
            return function clear(...args) {
                assert.strictEqual(this, gl);
                assert.deepEqual(args, [0x4000]);
                checkpoint('gl.clear:call');
                return ignoredThenable;
            };
        }
    });

    const renderer = {};
    Object.defineProperty(renderer, 'begin', {
        get() {
            checkpoint('renderer.begin:get');
            return function begin(...args) {
                assert.strictEqual(this, renderer);
                assert.deepEqual(args, [640, 360]);
                checkpoint('renderer.begin:call');
                return ignoredThenable;
            };
        }
    });
    const callbackRecord = {};
    Object.defineProperty(callbackRecord, 'onFrameClear', {
        get() {
            checkpoint('callback.onFrameClear:get');
            return function onFrameClear(...args) {
                assert.strictEqual(this, callbackRecord);
                assert.deepEqual(args, [true]);
                checkpoint('callback.onFrameClear:call');
                return ignoredThenable;
            };
        }
    });

    const lostTable = {};
    Object.defineProperty(lostTable, 'has', {
        get() {
            checkpoint('contextLostLayers.has:get');
            return function has(layerName) {
                assert.strictEqual(this, lostTable);
                assert.equal(layerName, 'background');
                checkpoint('contextLostLayers.has:call');
                return false;
            };
        }
    });
    Object.defineProperty(handler, 'contextLostLayers', {
        configurable: true,
        get() {
            checkpoint('handler.contextLostLayers:get');
            return lostTable;
        }
    });

    const modeTable = {};
    Object.defineProperty(modeTable, 'get', {
        get() {
            checkpoint('layerModes.get:get');
            return function get(layerName) {
                assert.strictEqual(this, modeTable);
                assert.equal(layerName, 'background');
                checkpoint('layerModes.get:call');
                return 'batch';
            };
        }
    });
    Object.defineProperty(handler, 'layerModes', {
        configurable: true,
        get() {
            checkpoint('handler.layerModes:get');
            return modeTable;
        }
    });

    const rendererTable = {};
    Object.defineProperty(rendererTable, 'get', {
        get() {
            checkpoint('layerRenderers.get:get');
            return function get(layerName) {
                assert.strictEqual(this, rendererTable);
                assert.equal(layerName, 'background');
                checkpoint('layerRenderers.get:call');
                return renderer;
            };
        }
    });
    Object.defineProperty(handler, 'layerRenderers', {
        configurable: true,
        get() {
            checkpoint('handler.layerRenderers:get');
            return rendererTable;
        }
    });

    const callbackTable = {};
    Object.defineProperty(callbackTable, 'get', {
        get() {
            checkpoint('layerCallbacks.get:get');
            return function get(layerName) {
                assert.strictEqual(this, callbackTable);
                assert.equal(layerName, 'background');
                checkpoint('layerCallbacks.get:call');
                return callbackRecord;
            };
        }
    });
    Object.defineProperty(handler, 'layerCallbacks', {
        configurable: true,
        get() {
            checkpoint('handler.layerCallbacks:get');
            return callbackTable;
        }
    });

    const layerEntries = new Map([['background', gl]]);
    if (options.includeLater) {
        const laterGl = {
            FRAMEBUFFER: 0x8D40,
            COLOR_BUFFER_BIT: 0x4000,
            bindFramebuffer() {
                trace.push('later:bindFramebuffer');
            },
            viewport() {},
            clearColor() {},
            clear() {}
        };
        layerEntries.set('later', laterGl);
    }
    const contextTable = {};
    Object.defineProperty(contextTable, 'entries', {
        get() {
            checkpoint('glContexts.entries:get');
            return function entries() {
                assert.strictEqual(this, contextTable);
                checkpoint('glContexts.entries:call');
                return layerEntries.entries();
            };
        }
    });
    Object.defineProperty(handler, 'glContexts', {
        configurable: true,
        get() {
            checkpoint('handler.glContexts:get');
            return contextTable;
        }
    });

    return { handler, trace, error };
}

/**
 * 고수준 순서 검증용 WebGL 스텁을 생성합니다.
 * @param {string[]} trace - 기록할 trace입니다.
 * @param {string} label - 레이어 label입니다.
 * @returns {object} WebGL 스텁입니다.
 */
function createSimpleGl(trace, label) {
    return {
        FRAMEBUFFER: 0x8D40,
        COLOR_BUFFER_BIT: 0x4000,
        bindFramebuffer() {
            trace.push(`${label}:bind`);
        },
        viewport(_x, _y, width, height) {
            trace.push(`${label}:viewport:${String(width)}x${String(height)}`);
        },
        clearColor(red, green, blue, alpha) {
            trace.push(`${label}:color:${red},${green},${blue},${alpha}`);
        },
        clear() {
            trace.push(`${label}:clear`);
        }
    };
}

test('actual clearAll follows the major live getter, argument, receiver, call, and callback order', () => {
    const { handler, trace } = createCheckpointHarness();

    assert.equal(handler.clearAll(), undefined);
    assert.deepEqual(trace, [
        'handler.glContexts:get',
        'glContexts.entries:get',
        'glContexts.entries:call',
        'handler.contextLostLayers:get',
        'contextLostLayers.has:get',
        'contextLostLayers.has:call',
        'handler.layerModes:get',
        'layerModes.get:get',
        'layerModes.get:call',
        'handler.layerRenderers:get',
        'layerRenderers.get:get',
        'layerRenderers.get:call',
        'gl.bindFramebuffer:get',
        'gl.FRAMEBUFFER:get',
        'gl.bindFramebuffer:call',
        'gl.viewport:get',
        'handler.width:viewport',
        'handler.height:viewport',
        'gl.viewport:call',
        'gl.clearColor:get',
        'handler.backgroundColor:0',
        'backgroundColor[0]',
        'handler.backgroundColor:1',
        'backgroundColor[1]',
        'handler.backgroundColor:2',
        'backgroundColor[2]',
        'handler.backgroundColor:3',
        'backgroundColor[3]',
        'gl.clearColor:call',
        'gl.clear:get',
        'gl.COLOR_BUFFER_BIT:get',
        'gl.clear:call',
        'handler.width:begin',
        'handler.height:begin',
        'renderer.begin:get',
        'renderer.begin:call',
        'handler.layerCallbacks:get',
        'layerCallbacks.get:get',
        'layerCallbacks.get:call',
        'callback.onFrameClear:get',
        'callback.onFrameClear:call'
    ]);
});

test('viewport and frame begin read independent live dimensions around GL clear work', () => {
    const trace = [];
    const handler = new WebGLHandler();
    let currentWidth = 640;
    let currentHeight = 360;
    Object.defineProperty(handler, 'width', {
        get() {
            trace.push(`width:${currentWidth}`);
            return currentWidth;
        }
    });
    Object.defineProperty(handler, 'height', {
        get() {
            trace.push(`height:${currentHeight}`);
            return currentHeight;
        }
    });
    const gl = createSimpleGl(trace, 'layer');
    gl.viewport = (_x, _y, width, height) => {
        trace.push(`layer:viewport:${width}x${height}`);
        currentWidth = 801;
        currentHeight = 451;
    };
    const renderer = {
        begin(width, height) {
            trace.push(`begin:${width}x${height}`);
        }
    };
    handler.glContexts.set('layer', gl);
    handler.layerModes.set('layer', 'batch');
    handler.layerRenderers.set('layer', renderer);
    handler.layerCallbacks.set('layer', {
        onFrameClear() {
            trace.push('callback');
        }
    });

    assert.equal(handler.clearAll(), undefined);
    assert.deepEqual(trace, [
        'layer:bind',
        'width:640',
        'height:360',
        'layer:viewport:640x360',
        'layer:color:0,0,0,0',
        'layer:clear',
        'width:801',
        'height:451',
        'begin:801x451',
        'callback'
    ]);
});

test('background uses four live color providers while every other strict key avoids backgroundColor', () => {
    {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        let provider = 0;
        Object.defineProperty(handler, 'backgroundColor', {
            get() {
                const channel = provider++;
                trace.push(`provider:${channel}`);
                return new Proxy({}, {
                    get(_target, property) {
                        trace.push(`index:${String(property)}`);
                        return channel + 0.25;
                    }
                });
            }
        });
        const gl = createSimpleGl(trace, 'background');
        handler.glContexts.set('background', gl);
        handler.layerModes.set('background', 'batch');
        handler.layerRenderers.set('background', { begin() {} });

        handler.clearAll();
        assert.deepEqual(trace.slice(1, 10), [
            'background:viewport:1x1',
            'provider:0',
            'index:0',
            'provider:1',
            'index:1',
            'provider:2',
            'index:2',
            'provider:3',
            'index:3'
        ]);
        assert.ok(trace.includes('background:color:0.25,1.25,2.25,3.25'));
    }

    const nonBackgroundKeys = [
        new String('background'),
        'Background',
        Symbol('background'),
        Number.NaN,
        null,
        undefined
    ];
    for (const layerName of nonBackgroundKeys) {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        Object.defineProperty(handler, 'backgroundColor', {
            get() {
                throw new Error('non-background must not read backgroundColor');
            }
        });
        const gl = createSimpleGl(trace, 'layer');
        handler.glContexts.set(layerName, gl);
        handler.layerModes.set(layerName, 'batch');
        handler.layerRenderers.set(layerName, { begin() {} });

        assert.equal(handler.clearAll(), undefined);
        assert.ok(trace.includes('layer:color:0,0,0,0'));
    }
});

test('context-lost keys skip mode, renderer, GL, and callback work without key coercion', () => {
    const handler = new WebGLHandler();
    const hostileKey = {
        [Symbol.toPrimitive]() {
            throw new Error('layer key must not be coerced');
        }
    };
    const skippedGl = new Proxy({}, {
        get() {
            throw new Error('lost GL must not be observed');
        }
    });
    handler.glContexts.set(hostileKey, skippedGl);
    handler.contextLostLayers.add(hostileKey);
    Object.defineProperty(handler, 'layerModes', {
        get() {
            throw new Error('lost mode must not be observed');
        }
    });

    assert.equal(handler.clearAll(), undefined);
});

test('falsy renderer and non-positive dimensions skip only frame begin after clear and before callback', () => {
    const createHostileDimension = (label) => ({
        [Symbol.toPrimitive]() {
            throw new Error(`${label} must not be coerced`);
        }
    });
    const falsyRenderers = [undefined, null, false, 0, -0, 0n, Number.NaN, ''];
    for (const renderer of falsyRenderers) {
        const trace = [];
        const handler = new WebGLHandler();
        const hostileDimension = {
            [Symbol.toPrimitive]() {
                throw new Error('falsy renderer must short-circuit dimension coercion');
            }
        };
        handler.width = hostileDimension;
        handler.height = hostileDimension;
        handler.glContexts.set('layer', {
            FRAMEBUFFER: 0x8D40,
            COLOR_BUFFER_BIT: 0x4000,
            bindFramebuffer() {
                trace.push('layer:bind');
            },
            viewport() {
                trace.push('layer:viewport');
            },
            clearColor() {
                trace.push('layer:color');
            },
            clear() {
                trace.push('layer:clear');
            }
        });
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', renderer);
        handler.layerCallbacks.set('layer', { onFrameClear() { trace.push('callback'); } });

        assert.equal(handler.clearAll(), undefined);
        assert.equal(trace.filter((entry) => entry === 'layer:clear').length, 1);
        assert.equal(trace.at(-1), 'callback');
    }

    for (const { renderer, width } of [
        { renderer: null, width: createHostileDimension('falsy renderer') },
        { renderer: {}, width: 0 }
    ]) {
        const dimensionTrace = [];
        const handler = new WebGLHandler();
        const height = createHostileDimension('short-circuited height');
        Object.defineProperty(handler, 'width', {
            get() {
                dimensionTrace.push('width');
                return width;
            }
        });
        Object.defineProperty(handler, 'height', {
            get() {
                dimensionTrace.push('height');
                return height;
            }
        });
        handler.glContexts.set('layer', {
            FRAMEBUFFER: 0x8D40,
            COLOR_BUFFER_BIT: 0x4000,
            bindFramebuffer() {},
            viewport() {},
            clearColor() {},
            clear() {}
        });
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', renderer);

        assert.equal(handler.clearAll(), undefined);
        assert.deepEqual(dimensionTrace, ['width', 'height', 'width', 'height']);
    }

    for (const [width, height] of [[0, 1], [-1, 1], [1, 0], [null, 1], [1, 0n]]) {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = width;
        handler.height = height;
        handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
        handler.layerModes.set('layer', 'batch');
        const renderer = {};
        Object.defineProperty(renderer, 'begin', {
            get() {
                throw new Error('non-positive dimensions must skip begin lookup');
            }
        });
        handler.layerRenderers.set('layer', renderer);
        handler.layerCallbacks.set('layer', { onFrameClear() { trace.push('callback'); } });

        assert.equal(handler.clearAll(), undefined);
        assert.ok(trace.includes('layer:clear'));
        assert.equal(trace.at(-1), 'callback');
    }
});

test('NaN-like dimensions reach begin, while Symbol conversion fails after clear and before callback', () => {
    for (const [width, height] of [[Number.NaN, 1], [undefined, 1], [1, Number.NaN]]) {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = width;
        handler.height = height;
        handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', {
            begin(receivedWidth, receivedHeight) {
                assert.strictEqual(receivedWidth, width);
                assert.strictEqual(receivedHeight, height);
                trace.push('begin');
            }
        });
        handler.layerCallbacks.set('layer', { onFrameClear() { trace.push('callback'); } });

        assert.equal(handler.clearAll(), undefined);
        assert.deepEqual(trace.slice(-3), ['layer:clear', 'begin', 'callback']);
    }

    const trace = [];
    const handler = new WebGLHandler();
    handler.width = Symbol('width');
    handler.height = 1;
    handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
    handler.layerModes.set('layer', 'batch');
    handler.layerRenderers.set('layer', { begin() { trace.push('begin'); } });
    handler.layerCallbacks.set('layer', { onFrameClear() { trace.push('callback'); } });

    const thrown = captureThrown(() => handler.clearAll());
    assert.equal(thrown?.name, 'TypeError');
    assert.equal(trace.at(-1), 'layer:clear');
    assert.equal(trace.includes('begin'), false);
    assert.equal(trace.includes('callback'), false);
});

test('live Map iteration observes value updates, appended keys, pure deletion, and property replacement timing', () => {
    const trace = [];
    const handler = new WebGLHandler();
    handler.width = 1;
    handler.height = 1;
    const firstGl = createSimpleGl(trace, 'first');
    const staleSecondGl = createSimpleGl(trace, 'second-stale');
    const liveSecondGl = createSimpleGl(trace, 'second-live');
    const deletedGl = createSimpleGl(trace, 'deleted');
    const thirdGl = createSimpleGl(trace, 'third');
    const replacementOnlyGl = createSimpleGl(trace, 'replacement-only');

    handler.glContexts.set('first', firstGl);
    handler.glContexts.set('second', staleSecondGl);
    handler.glContexts.set('deleted', deletedGl);
    for (const key of ['first', 'second', 'deleted', 'third', 'replacement-only']) {
        handler.layerModes.set(key, 'batch');
        handler.layerRenderers.set(key, { begin() { trace.push(`${key}:begin`); } });
    }
    handler.layerCallbacks.set('first', {
        onFrameClear() {
            trace.push('first:callback');
            handler.glContexts.set('second', liveSecondGl);
            handler.glContexts.delete('deleted');
            handler.glContexts.set('third', thirdGl);
            handler.glContexts = new Map([['replacement-only', replacementOnlyGl]]);
        }
    });
    handler.layerCallbacks.set('second', { onFrameClear() { trace.push('second:callback'); } });
    handler.layerCallbacks.set('third', { onFrameClear() { trace.push('third:callback'); } });

    assert.equal(handler.clearAll(), undefined);
    assert.ok(trace.includes('first:clear'));
    assert.ok(trace.includes('second-live:clear'));
    assert.ok(trace.includes('third:clear'));
    assert.equal(trace.includes('second-stale:clear'), false);
    assert.equal(trace.includes('deleted:clear'), false);
    assert.equal(trace.includes('replacement-only:clear'), false);
    assert.ok(trace.indexOf('first:callback') < trace.indexOf('second-live:bind'));
    assert.ok(trace.indexOf('second:callback') < trace.indexOf('third:bind'));
});

test('deleting and reinserting an unvisited key moves it behind newly appended keys', () => {
    const trace = [];
    const handler = new WebGLHandler();
    handler.width = 1;
    handler.height = 1;
    handler.glContexts.set('first', createSimpleGl(trace, 'first'));
    handler.glContexts.set('second', createSimpleGl(trace, 'second-stale'));
    for (const key of ['first', 'second', 'third']) {
        handler.layerModes.set(key, 'batch');
        handler.layerRenderers.set(key, { begin() {} });
    }
    handler.layerCallbacks.set('first', {
        onFrameClear() {
            handler.glContexts.delete('second');
            handler.glContexts.set('third', createSimpleGl(trace, 'third'));
            handler.glContexts.set('second', createSimpleGl(trace, 'second-live'));
        }
    });

    handler.clearAll();
    const clearOrder = trace.filter((entry) => entry.endsWith(':clear'));
    assert.deepEqual(clearOrder, ['first:clear', 'third:clear', 'second-live:clear']);
});

test('renderer begin observes and can replace the callback table before its late lookup', () => {
    const trace = [];
    const handler = new WebGLHandler();
    handler.width = 1;
    handler.height = 1;
    const layerName = {};
    const staleCallbacks = handler.layerCallbacks;
    const liveCallbacks = new Map();
    staleCallbacks.set(layerName, {
        onFrameClear() {
            throw new Error('stale callback must not run');
        }
    });
    const liveRecord = {
        onFrameClear(isBackground) {
            assert.strictEqual(this, liveRecord);
            assert.equal(isBackground, false);
            trace.push('live:callback');
            return Object.defineProperty({}, 'then', {
                get() {
                    throw new Error('callback thenable must not be observed');
                }
            });
        }
    };
    liveCallbacks.set(layerName, liveRecord);
    handler.glContexts.set(layerName, createSimpleGl(trace, 'layer'));
    handler.layerModes.set(layerName, 'batch');
    handler.layerRenderers.set(layerName, {
        begin() {
            trace.push('begin');
            handler.layerCallbacks = liveCallbacks;
        }
    });

    assert.equal(handler.clearAll(), undefined);
    assert.deepEqual(trace.slice(-3), ['layer:clear', 'begin', 'live:callback']);
});

test('callback optional chaining observes primitive prototypes, skips nullish links, and rejects non-callable methods after begin', () => {
    const callbackRecordsWithoutMethod = [null, undefined, false, 0, -0, 0n, Number.NaN, '', Symbol('record')];
    for (const callbackRecord of callbackRecordsWithoutMethod) {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', { begin() { trace.push('begin'); } });
        handler.layerCallbacks.set('layer', callbackRecord);

        assert.equal(handler.clearAll(), undefined);
        assert.equal(trace.at(-1), 'begin');
    }

    const productionBooleanPrototype = WebGLHandler.constructor('return Boolean.prototype')();
    const previousBooleanCallback = Object.getOwnPropertyDescriptor(productionBooleanPrototype, 'onFrameClear');
    const primitiveTrace = [];
    try {
        Object.defineProperty(productionBooleanPrototype, 'onFrameClear', {
            configurable: true,
            get() {
                primitiveTrace.push('prototype:get');
                return function onPrimitiveFrameClear(isBackground) {
                    primitiveTrace.push(`prototype:call:${String(isBackground)}`);
                };
            }
        });
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        handler.glContexts.set('layer', createSimpleGl(primitiveTrace, 'layer'));
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', { begin() { primitiveTrace.push('begin'); } });
        handler.layerCallbacks.set('layer', false);

        assert.equal(handler.clearAll(), undefined);
        assert.deepEqual(primitiveTrace.slice(-3), ['begin', 'prototype:get', 'prototype:call:false']);
    } finally {
        if (previousBooleanCallback) {
            Object.defineProperty(productionBooleanPrototype, 'onFrameClear', previousBooleanCallback);
        } else {
            delete productionBooleanPrototype.onFrameClear;
        }
    }

    for (const onFrameClear of [null, undefined]) {
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        handler.glContexts.set('layer', createSimpleGl([], 'layer'));
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', { begin() {} });
        handler.layerCallbacks.set('layer', { onFrameClear });
        assert.equal(handler.clearAll(), undefined);
    }

    for (const onFrameClear of [false, 0, '', {}, Symbol('method')]) {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
        handler.layerModes.set('layer', 'batch');
        handler.layerRenderers.set('layer', { begin() { trace.push('begin'); } });
        handler.layerCallbacks.set('layer', { onFrameClear });

        const thrown = captureThrown(() => handler.clearAll());
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(trace.at(-1), 'begin');
    }
});

test('every major live lookup and call checkpoint propagates exact error identity and stops later layers', () => {
    const stages = [
        'handler.glContexts:get',
        'glContexts.entries:get',
        'glContexts.entries:call',
        'handler.contextLostLayers:get',
        'contextLostLayers.has:get',
        'contextLostLayers.has:call',
        'handler.layerModes:get',
        'layerModes.get:get',
        'layerModes.get:call',
        'handler.layerRenderers:get',
        'layerRenderers.get:get',
        'layerRenderers.get:call',
        'gl.bindFramebuffer:get',
        'gl.FRAMEBUFFER:get',
        'gl.bindFramebuffer:call',
        'gl.viewport:get',
        'handler.width:viewport',
        'handler.height:viewport',
        'gl.viewport:call',
        'gl.clearColor:get',
        'handler.backgroundColor:0',
        'backgroundColor[0]',
        'handler.backgroundColor:1',
        'backgroundColor[1]',
        'handler.backgroundColor:2',
        'backgroundColor[2]',
        'handler.backgroundColor:3',
        'backgroundColor[3]',
        'gl.clearColor:call',
        'gl.clear:get',
        'gl.COLOR_BUFFER_BIT:get',
        'gl.clear:call',
        'handler.width:begin',
        'handler.height:begin',
        'renderer.begin:get',
        'renderer.begin:call',
        'handler.layerCallbacks:get',
        'layerCallbacks.get:get',
        'layerCallbacks.get:call',
        'callback.onFrameClear:get',
        'callback.onFrameClear:call'
    ];

    for (const stage of stages) {
        const { handler, trace, error } = createCheckpointHarness(stage, { includeLater: true });
        const thrown = captureThrown(() => handler.clearAll());
        assert.strictEqual(thrown, error, `${stage} error identity가 바뀌었습니다.`);
        assert.equal(trace.at(-1), stage, `${stage} 뒤 관찰이 발생했습니다.`);
        assert.equal(trace.includes('later:bindFramebuffer'), false, `${stage} 뒤 레이어가 실행됐습니다.`);
    }
});

test('non-callable GL methods evaluate their live arguments before throwing TypeError', () => {
    {
        const trace = [];
        const handler = new WebGLHandler();
        handler.glContexts.set('layer', {
            get FRAMEBUFFER() {
                trace.push('FRAMEBUFFER');
                return 1;
            },
            bindFramebuffer: 0
        });
        const thrown = captureThrown(() => handler.clearAll());
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, ['FRAMEBUFFER']);
    }

    {
        const trace = [];
        const handler = new WebGLHandler();
        Object.defineProperty(handler, 'width', { get() { trace.push('width'); return 1; } });
        Object.defineProperty(handler, 'height', { get() { trace.push('height'); return 1; } });
        handler.glContexts.set('layer', {
            FRAMEBUFFER: 1,
            bindFramebuffer() {},
            viewport: 0
        });
        const thrown = captureThrown(() => handler.clearAll());
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, ['width', 'height']);
    }

    {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        let reads = 0;
        Object.defineProperty(handler, 'backgroundColor', {
            get() {
                trace.push(`color:${reads}`);
                return [1, 2, 3, 4];
            }
        });
        handler.glContexts.set('background', {
            FRAMEBUFFER: 1,
            bindFramebuffer() {},
            viewport() {},
            clearColor: 0
        });
        const thrown = captureThrown(() => handler.clearAll());
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, ['color:0', 'color:0', 'color:0', 'color:0']);
    }

    {
        const trace = [];
        const handler = new WebGLHandler();
        handler.width = 1;
        handler.height = 1;
        handler.glContexts.set('layer', {
            FRAMEBUFFER: 1,
            bindFramebuffer() {},
            viewport() {},
            clearColor() {},
            get COLOR_BUFFER_BIT() {
                trace.push('COLOR_BUFFER_BIT');
                return 1;
            },
            clear: 0
        });
        const thrown = captureThrown(() => handler.clearAll());
        assert.equal(thrown?.name, 'TypeError');
        assert.deepEqual(trace, ['COLOR_BUFFER_BIT']);
    }
});

test('abrupt layer failure closes a custom entries iterator before propagating the same error', () => {
    const trace = [];
    const error = Object.freeze({ stage: 'bind' });
    const gl = {
        FRAMEBUFFER: 1,
        bindFramebuffer() {
            trace.push('bind');
            throw error;
        }
    };
    let nextCalls = 0;
    const iterator = {
        next() {
            nextCalls += 1;
            trace.push(`next:${nextCalls}`);
            return nextCalls === 1
                ? { done: false, value: ['layer', gl] }
                : { done: true };
        },
        return() {
            trace.push('iterator:return');
            return { done: true };
        },
        [Symbol.iterator]() {
            return this;
        }
    };
    const handler = new WebGLHandler();
    handler.glContexts = { entries() { return iterator; } };

    assert.strictEqual(captureThrown(() => handler.clearAll()), error);
    assert.deepEqual(trace, ['next:1', 'bind', 'iterator:return']);
});

test('clearAll reentry has no guard and outer processing resumes after the nested pass', () => {
    const trace = [];
    const handler = new WebGLHandler();
    handler.width = 1;
    handler.height = 1;
    handler.glContexts.set('layer', createSimpleGl(trace, 'layer'));
    handler.layerModes.set('layer', 'batch');
    handler.layerRenderers.set('layer', { begin() { trace.push('begin'); } });
    let depth = 0;
    handler.layerCallbacks.set('layer', {
        onFrameClear() {
            if (depth === 0) {
                trace.push('outer:callback:start');
                depth = 1;
                handler.clearAll();
                depth = 0;
                trace.push('outer:callback:end');
                return;
            }
            trace.push('nested:callback');
        }
    });

    assert.equal(handler.clearAll(), undefined);
    assert.deepEqual(trace.filter((entry) => (
        entry === 'layer:clear'
        || entry === 'begin'
        || entry.includes('callback')
    )), [
        'layer:clear',
        'begin',
        'outer:callback:start',
        'layer:clear',
        'begin',
        'nested:callback',
        'outer:callback:end'
    ]);
});

test('clearAll remains a zero-argument non-constructable class method', () => {
    const method = WebGLHandler.prototype.clearAll;
    assert.equal(method.name, 'clearAll');
    assert.equal(method.length, 0);
    assert.equal(Object.hasOwn(method, 'prototype'), false);
    const thrown = captureThrown(() => Reflect.construct(method, []));
    assert.equal(thrown?.name, 'TypeError');
});
