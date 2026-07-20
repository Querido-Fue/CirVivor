import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const WEBGL_HANDLER_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/webgl/_webgl_handler.js',
    import.meta.url
));
const webGLHandlerSource = await readFile(WEBGL_HANDLER_SOURCE_PATH, 'utf8');
const { WebGLHandler } = await loadGameModule('display/webgl/_webgl_handler.js');
const EXECUTABLE_SOURCE_HASH = '80706f8f581167d4316f1e5ab3c7ec6c4d6e14d3906927dbd9a14999cf3d4f03';

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
 * @param {string} productionSource - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(productionSource) {
    const allJsDocStarts = productionSource.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = productionSource.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    assert.equal(standaloneJsDocStarts.length, 14, 'production standalone JSDoc 개수가 바뀌었습니다.');
    const executableSource = productionSource
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} productionSource - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(productionSource, escapedDeclaration) {
    const match = productionSource.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

/**
 * 실제 production class의 빈 handler를 생성합니다.
 * @returns {WebGLHandler} 테스트용 handler입니다.
 */
function createHandler() {
    return new WebGLHandler();
}

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

test('WebGLHandler executable source remains unchanged while its JSDoc is corrected', () => {
    assert.equal(hashExecutableSource(webGLHandlerSource), EXECUTABLE_SOURCE_HASH);
});

test('WebGLHandler.render JSDoc describes key, gate, live dispatch, callback, error, and return contracts', () => {
    const jsDoc = findLeadingJsDoc(webGLHandlerSource, 'render\\(layerName, options\\)');

    assert.match(jsDoc, /등록된 WebGL renderer에 값을 전달하고 정상 완료 뒤 현재 onDraw callback을 알립니다\./u);
    assert.match(jsDoc, /`layerName`은 PropertyKey로 변환하지 않으며, 기본 Set\/Map에서는 SameValueZero key로 비교됩니다\./u);
    assert.match(jsDoc, /context-lost key이거나 renderer 조회 결과가 falsy이면 이후 단계를 실행하지 않고 `undefined`를 반환합니다\./u);
    assert.match(jsDoc, /renderer의 live `render`를 원래 receiver와 `options` identity로 동기 호출합니다\./u);
    assert.match(jsDoc, /renderer가 정상 반환한 뒤 최신 callback Map과 record의 `onDraw`를 조회해 record receiver로 인자 없이 호출합니다\./u);
    assert.match(jsDoc, /하위 renderer가 내부적으로 no-op해도 정상 반환이면 callback 통지를 수행합니다\./u);
    assert.match(jsDoc, /renderer와 callback의 반환값 및 thenable은 관찰하지 않고 폐기하며, 조회·getter·호출 중 발생한 예외는 그대로 동기 전파됩니다\./u);
    assert.match(jsDoc, /callback 조회 또는 호출 실패는 앞서 완료된 renderer 부수효과를 되돌리지 않습니다\./u);
    assert.match(jsDoc, /@param \{\*\} layerName/u);
    assert.match(jsDoc, /@param \{\*\} options/u);
    assert.match(jsDoc, /@returns \{undefined\}/u);
    assert.doesNotMatch(jsDoc, /@param \{string\} layerName/u);
    assert.doesNotMatch(jsDoc, /@param \{object\} options/u);
});

test('actual render uses uncoerced SameValueZero keys and forwards arbitrary options by exact identity', () => {
    const throwingKey = {
        [Symbol.toPrimitive]() {
            throw new Error('layer key must not be coerced');
        }
    };
    const objectKey = {};
    const symbolKey = Symbol('layer');
    const optionProxy = new Proxy({}, {
        get() {
            throw new Error('options must not be inspected by the handler');
        },
        ownKeys() {
            throw new Error('options must not be enumerated by the handler');
        }
    });
    const keyCases = [
        { stored: 'effect', queried: 'effect', options: undefined },
        { stored: Number.NaN, queried: Number.NaN, options: null },
        { stored: -0, queried: +0, options: false },
        { stored: objectKey, queried: objectKey, options: -0 },
        { stored: symbolKey, queried: symbolKey, options: Number.NaN },
        { stored: throwingKey, queried: throwingKey, options: 0n },
        { stored: undefined, queried: undefined, options: Symbol('options') },
        { stored: null, queried: null, options: optionProxy },
        { stored: 7n, queried: 7n, options() {} }
    ];

    for (const { stored, queried, options } of keyCases) {
        const handler = createHandler();
        const calls = [];
        const renderer = {
            render(...args) {
                calls.push({ type: 'render', receiver: this, args });
            }
        };
        const callbackRecord = {
            onDraw(...args) {
                calls.push({ type: 'onDraw', receiver: this, args });
            }
        };
        handler.layerRenderers.set(stored, renderer);
        handler.layerCallbacks.set(stored, callbackRecord);

        const returned = Reflect.apply(handler.render, handler, [queried, options, 'ignored-extra']);

        assert.equal(returned, undefined);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].type, 'render');
        assert.strictEqual(calls[0].receiver, renderer);
        assert.equal(calls[0].args.length, 1);
        assert.strictEqual(calls[0].args[0], options);
        assert.equal(calls[1].type, 'onDraw');
        assert.strictEqual(calls[1].receiver, callbackRecord);
        assert.equal(calls[1].args.length, 0);
    }
});

test('context-lost and missing or falsy renderers stop every downstream lookup', () => {
    {
        const handler = createHandler();
        const layerKey = {};
        let rendererTableReads = 0;
        handler.contextLostLayers.add(layerKey);
        Object.defineProperty(handler, 'layerRenderers', {
            configurable: true,
            get() {
                rendererTableReads += 1;
                throw new Error('lost gate leaked into renderer lookup');
            }
        });

        assert.equal(handler.render(layerKey, {}), undefined);
        assert.equal(rendererTableReads, 0);
    }

    {
        const handler = createHandler();
        const layerKey = Symbol('missing');
        let callbackTableReads = 0;
        Object.defineProperty(handler, 'layerCallbacks', {
            configurable: true,
            get() {
                callbackTableReads += 1;
                throw new Error('missing renderer leaked into callback lookup');
            }
        });

        assert.equal(handler.render(layerKey, {}), undefined);
        assert.equal(callbackTableReads, 0);
    }

    const falsyRenderers = [undefined, null, false, 0, -0, 0n, Number.NaN, ''];
    for (const falsyRenderer of falsyRenderers) {
        const handler = createHandler();
        const layerKey = {};
        let callbackTableReads = 0;
        handler.layerRenderers.set(layerKey, falsyRenderer);
        Object.defineProperty(handler, 'layerCallbacks', {
            configurable: true,
            get() {
                callbackTableReads += 1;
                throw new Error('falsy renderer leaked into callback lookup');
            }
        });

        assert.equal(handler.render(layerKey, {}), undefined);
        assert.equal(callbackTableReads, 0);
    }
});

test('live dispatch preserves exact lookup order, receivers, arity, and post-render callback lookup', () => {
    const handler = createHandler();
    const trace = [];
    const layerKey = {};
    const options = new Proxy({}, {
        get() {
            throw new Error('options inspection is forbidden');
        }
    });
    const ignoredRendererReturn = {};
    const ignoredCallbackReturn = {};
    Object.defineProperty(ignoredRendererReturn, 'then', {
        get() {
            throw new Error('renderer thenable must not be observed');
        }
    });
    Object.defineProperty(ignoredCallbackReturn, 'then', {
        get() {
            throw new Error('callback thenable must not be observed');
        }
    });

    const lostTable = {};
    Object.defineProperty(lostTable, 'has', {
        get() {
            assert.strictEqual(this, lostTable);
            trace.push('lost.has:get');
            return function has(key) {
                assert.strictEqual(this, lostTable);
                assert.strictEqual(key, layerKey);
                trace.push('lost.has:call');
                return false;
            };
        }
    });

    const renderer = {};
    Object.defineProperty(renderer, 'render', {
        get() {
            assert.strictEqual(this, renderer);
            trace.push('renderer.render:get');
            return function render(...args) {
                assert.strictEqual(this, renderer);
                assert.equal(args.length, 1);
                assert.strictEqual(args[0], options);
                trace.push('renderer.render:call');
                currentCallbackTable = liveCallbackTable;
                return ignoredRendererReturn;
            };
        }
    });
    const rendererTable = {};
    Object.defineProperty(rendererTable, 'get', {
        get() {
            assert.strictEqual(this, rendererTable);
            trace.push('renderers.get:get');
            return function get(key) {
                assert.strictEqual(this, rendererTable);
                assert.strictEqual(key, layerKey);
                trace.push('renderers.get:call');
                return renderer;
            };
        }
    });

    const callbackRecord = {};
    Object.defineProperty(callbackRecord, 'onDraw', {
        get() {
            assert.strictEqual(this, callbackRecord);
            trace.push('callback.onDraw:get');
            return function onDraw(...args) {
                assert.strictEqual(this, callbackRecord);
                assert.equal(args.length, 0);
                trace.push('callback.onDraw:call');
                return ignoredCallbackReturn;
            };
        }
    });
    const staleCallbackTable = {
        get() {
            throw new Error('callback table must be looked up after renderer completion');
        }
    };
    const liveCallbackTable = {};
    Object.defineProperty(liveCallbackTable, 'get', {
        get() {
            assert.strictEqual(this, liveCallbackTable);
            trace.push('callbacks.get:get');
            return function get(key) {
                assert.strictEqual(this, liveCallbackTable);
                assert.strictEqual(key, layerKey);
                trace.push('callbacks.get:call');
                return callbackRecord;
            };
        }
    });
    let currentCallbackTable = staleCallbackTable;

    Object.defineProperty(handler, 'contextLostLayers', {
        configurable: true,
        get() {
            assert.strictEqual(this, handler);
            trace.push('handler.contextLostLayers:get');
            return lostTable;
        }
    });
    Object.defineProperty(handler, 'layerRenderers', {
        configurable: true,
        get() {
            assert.strictEqual(this, handler);
            trace.push('handler.layerRenderers:get');
            return rendererTable;
        }
    });
    Object.defineProperty(handler, 'layerCallbacks', {
        configurable: true,
        get() {
            assert.strictEqual(this, handler);
            trace.push('handler.layerCallbacks:get');
            return currentCallbackTable;
        }
    });

    assert.equal(handler.render(layerKey, options), undefined);
    assert.deepEqual(trace, [
        'handler.contextLostLayers:get',
        'lost.has:get',
        'lost.has:call',
        'handler.layerRenderers:get',
        'renderers.get:get',
        'renderers.get:call',
        'renderer.render:get',
        'renderer.render:call',
        'handler.layerCallbacks:get',
        'callbacks.get:get',
        'callbacks.get:call',
        'callback.onDraw:get',
        'callback.onDraw:call'
    ]);
});

test('renderer and callback returns, including promises and hostile thenables, are discarded', () => {
    const hostileThenable = {};
    Object.defineProperty(hostileThenable, 'then', {
        get() {
            throw new Error('then must not be read');
        }
    });
    const returnValues = [
        undefined,
        null,
        false,
        0,
        {},
        Promise.resolve('settled'),
        hostileThenable
    ];

    for (const rendererReturn of returnValues) {
        for (const callbackReturn of returnValues) {
            const handler = createHandler();
            const layerKey = {};
            let callbackCalls = 0;
            handler.layerRenderers.set(layerKey, {
                render() {
                    return rendererReturn;
                }
            });
            handler.layerCallbacks.set(layerKey, {
                onDraw() {
                    callbackCalls += 1;
                    return callbackReturn;
                }
            });

            assert.equal(handler.render(layerKey, {}), undefined);
            assert.equal(callbackCalls, 1, 'a normally returning no-op renderer must still notify onDraw');
        }
    }
});

test('callback optional chaining skips nullish paths but rejects non-callable non-nullish onDraw values', () => {
    const callbackRecordsWithoutOnDraw = [null, undefined, false, 0, -0, 0n, Number.NaN, '', Symbol('record')];
    for (const callbackRecord of callbackRecordsWithoutOnDraw) {
        const handler = createHandler();
        const layerKey = {};
        let renderCalls = 0;
        handler.layerRenderers.set(layerKey, {
            render() {
                renderCalls += 1;
            }
        });
        handler.layerCallbacks.set(layerKey, callbackRecord);

        assert.equal(handler.render(layerKey, {}), undefined);
        assert.equal(renderCalls, 1);
    }

    for (const onDraw of [null, undefined]) {
        const handler = createHandler();
        const layerKey = {};
        handler.layerRenderers.set(layerKey, { render() {} });
        handler.layerCallbacks.set(layerKey, { onDraw });
        assert.equal(handler.render(layerKey, {}), undefined);
    }

    for (const onDraw of [false, 0, '', {}, Symbol('non-callable')]) {
        const handler = createHandler();
        const layerKey = {};
        let renderCalls = 0;
        handler.layerRenderers.set(layerKey, {
            render() {
                renderCalls += 1;
            }
        });
        handler.layerCallbacks.set(layerKey, { onDraw });

        const thrown = captureThrown(() => handler.render(layerKey, {}));
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(renderCalls, 1, 'callback type failure must not roll back renderer work');
    }
});

test('every live lookup and call error propagates by identity and blocks only later stages', () => {
    const cases = [
        {
            label: 'contextLostLayers property',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                Object.defineProperty(handler, 'contextLostLayers', { get() { throw error; } });
            }
        },
        {
            label: 'has getter',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                const table = {};
                Object.defineProperty(table, 'has', { get() { throw error; } });
                handler.contextLostLayers = table;
            }
        },
        {
            label: 'has call',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                handler.contextLostLayers = { has() { throw error; } };
            }
        },
        {
            label: 'layerRenderers property',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                Object.defineProperty(handler, 'layerRenderers', { get() { throw error; } });
            }
        },
        {
            label: 'renderer get getter',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                const table = {};
                Object.defineProperty(table, 'get', { get() { throw error; } });
                handler.layerRenderers = table;
            }
        },
        {
            label: 'renderer get call',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                handler.layerRenderers = { get() { throw error; } };
            }
        },
        {
            label: 'renderer render getter',
            expectedRenderCalls: 0,
            expectedCallbackCalls: 0,
            configure({ handler, layerKey, error }) {
                const renderer = {};
                Object.defineProperty(renderer, 'render', { get() { throw error; } });
                handler.layerRenderers.set(layerKey, renderer);
            }
        },
        {
            label: 'renderer render call',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 0,
            configure({ handler, layerKey, error, counters }) {
                handler.layerRenderers.set(layerKey, {
                    render() {
                        counters.render += 1;
                        throw error;
                    }
                });
            }
        },
        {
            label: 'layerCallbacks property',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                Object.defineProperty(handler, 'layerCallbacks', { get() { throw error; } });
            }
        },
        {
            label: 'callback get getter',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                const table = {};
                Object.defineProperty(table, 'get', { get() { throw error; } });
                handler.layerCallbacks = table;
            }
        },
        {
            label: 'callback get call',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 0,
            configure({ handler, error }) {
                handler.layerCallbacks = { get() { throw error; } };
            }
        },
        {
            label: 'onDraw getter',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 0,
            configure({ handler, layerKey, error }) {
                const record = {};
                Object.defineProperty(record, 'onDraw', { get() { throw error; } });
                handler.layerCallbacks.set(layerKey, record);
            }
        },
        {
            label: 'onDraw call',
            expectedRenderCalls: 1,
            expectedCallbackCalls: 1,
            configure({ handler, layerKey, error, counters }) {
                handler.layerCallbacks.set(layerKey, {
                    onDraw() {
                        counters.callback += 1;
                        throw error;
                    }
                });
            }
        }
    ];

    for (const errorCase of cases) {
        const handler = createHandler();
        const layerKey = {};
        const error = Object.freeze({ stage: errorCase.label });
        const counters = { render: 0, callback: 0 };
        handler.layerRenderers.set(layerKey, {
            render() {
                counters.render += 1;
            }
        });
        handler.layerCallbacks.set(layerKey, {
            onDraw() {
                counters.callback += 1;
            }
        });
        errorCase.configure({ handler, layerKey, error, counters });

        const thrown = captureThrown(() => handler.render(layerKey, {}));
        assert.strictEqual(thrown, error, `${errorCase.label} error identity가 바뀌었습니다.`);
        assert.equal(counters.render, errorCase.expectedRenderCalls, `${errorCase.label} renderer count`);
        assert.equal(counters.callback, errorCase.expectedCallbackCalls, `${errorCase.label} callback count`);
    }
});

test('non-callable dispatch members throw TypeError at their exact stage', () => {
    const cases = [
        {
            label: 'has',
            expectedRenderCalls: 0,
            configure({ handler }) {
                handler.contextLostLayers = { has: 0 };
            }
        },
        {
            label: 'renderer get',
            expectedRenderCalls: 0,
            configure({ handler }) {
                handler.layerRenderers = { get: 0 };
            }
        },
        {
            label: 'renderer render',
            expectedRenderCalls: 0,
            configure({ handler, layerKey }) {
                handler.layerRenderers.set(layerKey, { render: 0 });
            }
        },
        {
            label: 'callback get',
            expectedRenderCalls: 1,
            configure({ handler }) {
                handler.layerCallbacks = { get: 0 };
            }
        }
    ];

    for (const errorCase of cases) {
        const handler = createHandler();
        const layerKey = {};
        let renderCalls = 0;
        handler.layerRenderers.set(layerKey, {
            render() {
                renderCalls += 1;
            }
        });
        handler.layerCallbacks.set(layerKey, { onDraw() {} });
        errorCase.configure({ handler, layerKey });

        const thrown = captureThrown(() => handler.render(layerKey, {}));
        assert.equal(thrown?.name, 'TypeError', `${errorCase.label} must throw TypeError`);
        assert.equal(renderCalls, errorCase.expectedRenderCalls, `${errorCase.label} renderer count`);
    }
});

test('renderer and callback reentry has no guard and observes callback Map replacement or deletion', () => {
    const handler = createHandler();
    const outerKey = {};
    const rendererNestedKey = {};
    const callbackNestedKey = {};
    const outerOptions = {};
    const rendererNestedOptions = {};
    const callbackNestedOptions = {};
    const trace = [];

    const initialCallbacks = handler.layerCallbacks;
    const replacementCallbacks = new Map();
    initialCallbacks.set(outerKey, {
        onDraw() {
            throw new Error('stale outer callback must not run');
        }
    });
    initialCallbacks.set(rendererNestedKey, {
        onDraw() {
            trace.push('renderer-nested:onDraw');
        }
    });
    replacementCallbacks.set(outerKey, {
        onDraw() {
            trace.push('outer:onDraw:start');
            assert.equal(handler.render(callbackNestedKey, callbackNestedOptions), undefined);
            trace.push('outer:onDraw:end');
        }
    });
    replacementCallbacks.set(callbackNestedKey, {
        onDraw() {
            trace.push('callback-nested:onDraw');
        }
    });

    handler.layerRenderers.set(outerKey, {
        render(options) {
            assert.strictEqual(options, outerOptions);
            trace.push('outer:render:start');
            assert.equal(handler.render(rendererNestedKey, rendererNestedOptions), undefined);
            handler.layerCallbacks = replacementCallbacks;
            trace.push('outer:render:end');
        }
    });
    handler.layerRenderers.set(rendererNestedKey, {
        render(options) {
            assert.strictEqual(options, rendererNestedOptions);
            trace.push('renderer-nested:render');
        }
    });
    handler.layerRenderers.set(callbackNestedKey, {
        render(options) {
            assert.strictEqual(options, callbackNestedOptions);
            trace.push('callback-nested:render');
        }
    });

    assert.equal(handler.render(outerKey, outerOptions), undefined);
    assert.deepEqual(trace, [
        'outer:render:start',
        'renderer-nested:render',
        'renderer-nested:onDraw',
        'outer:render:end',
        'outer:onDraw:start',
        'callback-nested:render',
        'callback-nested:onDraw',
        'outer:onDraw:end'
    ]);

    const deletingHandler = createHandler();
    const deletingKey = {};
    let deletedCallbackCalls = 0;
    deletingHandler.layerCallbacks.set(deletingKey, {
        onDraw() {
            deletedCallbackCalls += 1;
        }
    });
    deletingHandler.layerRenderers.set(deletingKey, {
        render() {
            deletingHandler.layerCallbacks.delete(deletingKey);
        }
    });

    assert.equal(deletingHandler.render(deletingKey, {}), undefined);
    assert.equal(deletedCallbackCalls, 0);
});

test('render function shape remains a two-argument non-constructable class method', () => {
    const method = WebGLHandler.prototype.render;
    assert.equal(method.name, 'render');
    assert.equal(method.length, 2);
    assert.equal(Object.hasOwn(method, 'prototype'), false);

    const thrown = captureThrown(() => Reflect.construct(method, []));
    assert.equal(thrown?.name, 'TypeError');
});
