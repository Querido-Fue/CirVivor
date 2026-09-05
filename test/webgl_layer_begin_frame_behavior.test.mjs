import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const WEBGL_LAYER_RENDERER_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgl/_webgl_layer_renderer.js',
    import.meta.url
));
const webGLLayerRendererSource = await readFile(WEBGL_LAYER_RENDERER_SOURCE_PATH, 'utf8');

const { DISPLAY_WEBGL_RENDER_MODES } = await loadGameModule(
    'display/display_surface_descriptor.js'
);
const context = vm.createContext({ console });
const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
    Object.keys(exports),
    function initializeSyntheticModule() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    },
    { context, identifier }
);
const webGLLayerRendererModule = new vm.SourceTextModule(webGLLayerRendererSource, {
    context,
    identifier: WEBGL_LAYER_RENDERER_SOURCE_PATH
});
const dependencies = new Map([
    ['./_effect_renderer.js', createSyntheticModule('./_effect_renderer.js', {
        EffectRenderer: class EffectRenderer {}
    })],
    ['./_overlay_effect_renderer.js', createSyntheticModule('./_overlay_effect_renderer.js', {
        OverlayEffectRenderer: class OverlayEffectRenderer {}
    })],
    ['./_webgl_batch.js', createSyntheticModule('./_webgl_batch.js', {
        WebGLBatch: class WebGLBatch {}
    })],
    ['../display_surface_descriptor.js', createSyntheticModule(
        '../display_surface_descriptor.js',
        { DISPLAY_WEBGL_RENDER_MODES }
    )]
]);
await webGLLayerRendererModule.link((specifier) => dependencies.get(specifier));
await webGLLayerRendererModule.evaluate();
const { beginWebGLLayerFrame } = webGLLayerRendererModule.namespace;

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

test('WebGL layer renderer는 feature-local mode 상수를 사용하고 중앙 data registry에 의존하지 않는다', () => {

    assert.doesNotMatch(webGLLayerRendererSource, /data\/data_handler\.js/);
    assert.match(
        webGLLayerRendererSource,
        /DISPLAY_WEBGL_RENDER_MODES.*from '\.\.\/display_surface_descriptor\.js'/s
    );
    assert.equal(DISPLAY_WEBGL_RENDER_MODES.BATCH, 'batch');
    assert.equal(DISPLAY_WEBGL_RENDER_MODES.OVERLAY_EFFECT, 'overlay-effect');
    assert.equal(DISPLAY_WEBGL_RENDER_MODES.EFFECT, 'effect');
});

test('falsy renderer returns before either dimension can be coerced or inspected', () => {
    const falsyRenderers = [undefined, null, false, 0, -0, 0n, Number.NaN, ''];

    for (const renderer of falsyRenderers) {
        const trace = [];
        const width = {
            [Symbol.toPrimitive]() {
                trace.push('width');
                throw new Error('width must not be coerced');
            }
        };
        const height = {
            [Symbol.toPrimitive]() {
                trace.push('height');
                throw new Error('height must not be coerced');
            }
        };

        assert.equal(
            beginWebGLLayerFrame(renderer, DISPLAY_WEBGL_RENDER_MODES.EFFECT, width, height),
            undefined
        );
        assert.deepEqual(trace, []);
    }
});

test('dimension guards use ordered native <= comparisons and short-circuit at the first non-positive axis', () => {
    const nonPositiveWidths = [0, -0, -1, '', '0', '-1', null, false, 0n, -1n];
    for (const width of nonPositiveWidths) {
        let heightConversions = 0;
        let methodReads = 0;
        const height = {
            [Symbol.toPrimitive]() {
                heightConversions += 1;
                throw new Error('height must be short-circuited');
            }
        };
        const renderer = {};
        Object.defineProperty(renderer, 'begin', {
            get() {
                methodReads += 1;
                throw new Error('begin must not be read');
            }
        });

        assert.equal(beginWebGLLayerFrame(renderer, 'batch', width, height), undefined);
        assert.equal(heightConversions, 0);
        assert.equal(methodReads, 0);
    }

    const trace = [];
    const renderer = {};
    Object.defineProperty(renderer, 'begin', {
        get() {
            trace.push('begin:get');
            throw new Error('begin must not be read');
        }
    });
    const width = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'number');
            trace.push('width:convert');
            return 1;
        }
    };
    const height = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'number');
            trace.push('height:convert');
            return 0;
        }
    };

    assert.equal(beginWebGLLayerFrame(renderer, 'batch', width, height), undefined);
    assert.deepEqual(trace, ['width:convert', 'height:convert']);
});

test('NaN-like dimensions pass the guard and original dimension identities reach the selected method', () => {
    const passingPrimitiveCases = [
        [Number.NaN, 1],
        [undefined, 1],
        ['not-a-number', 1],
        [1, Number.NaN],
        [1, undefined],
        [1n, 2n]
    ];

    for (const [width, height] of passingPrimitiveCases) {
        const calls = [];
        const renderer = {
            begin(...args) {
                calls.push({ receiver: this, args });
            }
        };

        assert.equal(beginWebGLLayerFrame(renderer, 'batch', width, height), undefined);
        assert.equal(calls.length, 1);
        assert.strictEqual(calls[0].receiver, renderer);
        assert.strictEqual(calls[0].args[0], width);
        assert.strictEqual(calls[0].args[1], height);
    }

    const trace = [];
    const width = {
        [Symbol.toPrimitive]() {
            trace.push('width:convert');
            return Number.NaN;
        }
    };
    const height = {
        [Symbol.toPrimitive]() {
            trace.push('height:convert');
            return 2;
        }
    };
    const renderer = {
        begin(receivedWidth, receivedHeight) {
            trace.push('begin:call');
            assert.strictEqual(receivedWidth, width);
            assert.strictEqual(receivedHeight, height);
        }
    };

    assert.equal(beginWebGLLayerFrame(renderer, 'batch', width, height), undefined);
    assert.deepEqual(trace, ['width:convert', 'height:convert', 'begin:call']);
});

test('dimension conversion errors preserve identity and block method lookup at the exact axis', () => {
    {
        const error = Object.freeze({ stage: 'width conversion' });
        let heightConversions = 0;
        let methodReads = 0;
        const renderer = {};
        Object.defineProperty(renderer, 'begin', {
            get() {
                methodReads += 1;
                return () => {};
            }
        });
        const width = {
            [Symbol.toPrimitive]() {
                throw error;
            }
        };
        const height = {
            [Symbol.toPrimitive]() {
                heightConversions += 1;
                return 1;
            }
        };

        assert.strictEqual(
            captureThrown(() => beginWebGLLayerFrame(renderer, 'batch', width, height)),
            error
        );
        assert.equal(heightConversions, 0);
        assert.equal(methodReads, 0);
    }

    {
        const error = Object.freeze({ stage: 'height conversion' });
        let methodReads = 0;
        const renderer = {};
        Object.defineProperty(renderer, 'begin', {
            get() {
                methodReads += 1;
                return () => {};
            }
        });
        const height = {
            [Symbol.toPrimitive]() {
                throw error;
            }
        };

        assert.strictEqual(
            captureThrown(() => beginWebGLLayerFrame(renderer, 'batch', 1, height)),
            error
        );
        assert.equal(methodReads, 0);
    }

    const symbolWidthError = captureThrown(() => {
        beginWebGLLayerFrame({ begin() {} }, 'batch', Symbol('width'), 1);
    });
    assert.equal(symbolWidthError?.name, 'TypeError');

    const symbolHeightError = captureThrown(() => {
        beginWebGLLayerFrame({ begin() {} }, 'batch', 1, Symbol('height'));
    });
    assert.equal(symbolHeightError?.name, 'TypeError');
});

test('ordinary dimension coercion keeps valueOf-toString order and rejects non-primitive results', () => {
    const trace = [];
    const width = {
        valueOf() {
            trace.push('width:valueOf');
            return {};
        },
        toString() {
            trace.push('width:toString');
            return '2';
        }
    };
    const renderer = {
        begin(receivedWidth, receivedHeight) {
            assert.strictEqual(receivedWidth, width);
            assert.equal(receivedHeight, 1);
            trace.push('begin');
        }
    };

    assert.equal(beginWebGLLayerFrame(renderer, 'batch', width, 1), undefined);
    assert.deepEqual(trace, ['width:valueOf', 'width:toString', 'begin']);

    let methodReads = 0;
    const invalidWidth = {
        valueOf() {
            return {};
        },
        toString() {
            return {};
        }
    };
    const invalidRenderer = {};
    Object.defineProperty(invalidRenderer, 'begin', {
        get() {
            methodReads += 1;
            return () => {};
        }
    });
    const thrown = captureThrown(() => beginWebGLLayerFrame(
        invalidRenderer,
        'batch',
        invalidWidth,
        1
    ));
    assert.equal(thrown?.name, 'TypeError');
    assert.equal(methodReads, 0);
});

test('completed coercion and selected method side effects remain after later guard or call failure', () => {
    {
        const state = [];
        const error = Object.freeze({ stage: 'height' });
        const width = {
            [Symbol.toPrimitive]() {
                state.push('width:effect');
                return 1;
            }
        };
        const height = {
            [Symbol.toPrimitive]() {
                state.push('height:effect');
                throw error;
            }
        };
        assert.strictEqual(
            captureThrown(() => beginWebGLLayerFrame({ begin() {} }, 'batch', width, height)),
            error
        );
        assert.deepEqual(state, ['width:effect', 'height:effect']);
    }

    {
        const state = [];
        const width = {
            [Symbol.toPrimitive]() {
                state.push('width:effect');
                return 1;
            }
        };
        const height = {
            [Symbol.toPrimitive]() {
                state.push('height:effect');
                return 0;
            }
        };
        assert.equal(beginWebGLLayerFrame({ begin() { state.push('begin'); } }, 'batch', width, height), undefined);
        assert.deepEqual(state, ['width:effect', 'height:effect']);
    }

    {
        const state = [];
        const error = Object.freeze({ stage: 'begin' });
        const renderer = {
            begin() {
                state.push('begin:effect');
                throw error;
            }
        };
        assert.strictEqual(
            captureThrown(() => beginWebGLLayerFrame(renderer, 'batch', 1, 1)),
            error
        );
        assert.deepEqual(state, ['begin:effect']);
    }
});

test('truthy primitive renderers reach selected property lookup instead of an object-type guard', () => {
    for (const renderer of [true, 1, 1n, 'renderer', Symbol('renderer')]) {
        const thrown = captureThrown(() => beginWebGLLayerFrame(renderer, 'batch', 1, 1));
        assert.equal(thrown?.name, 'TypeError');
    }
});

test('mode dispatch uses strict equality without coercion and reads only the selected live method', () => {
    const modeCases = [
        [DISPLAY_WEBGL_RENDER_MODES.OVERLAY_EFFECT, 'beginFrame'],
        [DISPLAY_WEBGL_RENDER_MODES.EFFECT, 'beginFrame'],
        [DISPLAY_WEBGL_RENDER_MODES.BATCH, 'begin'],
        [undefined, 'begin'],
        [null, 'begin'],
        [new String(DISPLAY_WEBGL_RENDER_MODES.EFFECT), 'begin']
    ];

    for (const [mode, expectedMethod] of modeCases) {
        const trace = [];
        const renderer = {};
        for (const methodName of ['beginFrame', 'begin']) {
            Object.defineProperty(renderer, methodName, {
                get() {
                    trace.push(`${methodName}:get`);
                    if (methodName !== expectedMethod) {
                        throw new Error(`unexpected ${methodName} read`);
                    }
                    return function (...args) {
                        assert.strictEqual(this, renderer);
                        assert.deepEqual(args, [3, 4]);
                        trace.push(`${methodName}:call`);
                    };
                }
            });
        }

        assert.equal(beginWebGLLayerFrame(renderer, mode, 3, 4), undefined);
        assert.deepEqual(trace, [`${expectedMethod}:get`, `${expectedMethod}:call`]);
    }

    const hostileMode = {
        [Symbol.toPrimitive]() {
            throw new Error('mode must not be coerced');
        }
    };
    let batchCalls = 0;
    assert.equal(beginWebGLLayerFrame({ begin() { batchCalls += 1; } }, hostileMode, 1, 1), undefined);
    assert.equal(batchCalls, 1);
});

test('dimension conversion completes before the selected method is looked up', () => {
    const trace = [];
    const renderer = {};
    let currentBeginFrame = function staleBeginFrame() {
        throw new Error('stale beginFrame must not run');
    };
    Object.defineProperty(renderer, 'beginFrame', {
        get() {
            trace.push('beginFrame:get');
            return currentBeginFrame;
        }
    });
    const width = {
        [Symbol.toPrimitive]() {
            trace.push('width:convert');
            return 2;
        }
    };
    const height = {
        [Symbol.toPrimitive]() {
            trace.push('height:convert');
            currentBeginFrame = function liveBeginFrame(receivedWidth, receivedHeight) {
                assert.strictEqual(this, renderer);
                assert.strictEqual(receivedWidth, width);
                assert.strictEqual(receivedHeight, height);
                trace.push('beginFrame:call');
            };
            return 3;
        }
    };

    assert.equal(
        beginWebGLLayerFrame(renderer, DISPLAY_WEBGL_RENDER_MODES.EFFECT, width, height),
        undefined
    );
    assert.deepEqual(trace, [
        'width:convert',
        'height:convert',
        'beginFrame:get',
        'beginFrame:call'
    ]);
});

test('selected method returns and hostile thenables are discarded without observation', () => {
    const hostileThenable = {};
    Object.defineProperty(hostileThenable, 'then', {
        get() {
            throw new Error('then must not be observed');
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

    for (const returnedValue of returnValues) {
        assert.equal(beginWebGLLayerFrame({
            beginFrame() {
                return returnedValue;
            }
        }, DISPLAY_WEBGL_RENDER_MODES.EFFECT, 1, 1), undefined);

        assert.equal(beginWebGLLayerFrame({
            begin() {
                return returnedValue;
            }
        }, DISPLAY_WEBGL_RENDER_MODES.BATCH, 1, 1), undefined);
    }
});

test('selected method lookup and call failures propagate synchronously without translation', () => {
    for (const [mode, methodName] of [
        [DISPLAY_WEBGL_RENDER_MODES.EFFECT, 'beginFrame'],
        [DISPLAY_WEBGL_RENDER_MODES.BATCH, 'begin']
    ]) {
        {
            const error = Object.freeze({ stage: `${methodName} getter` });
            const renderer = {};
            Object.defineProperty(renderer, methodName, {
                get() {
                    throw error;
                }
            });
            assert.strictEqual(
                captureThrown(() => beginWebGLLayerFrame(renderer, mode, 1, 1)),
                error
            );
        }

        {
            const error = Object.freeze({ stage: `${methodName} call` });
            const renderer = {
                [methodName]() {
                    throw error;
                }
            };
            assert.strictEqual(
                captureThrown(() => beginWebGLLayerFrame(renderer, mode, 1, 1)),
                error
            );
        }

        {
            const renderer = { [methodName]: 0 };
            const thrown = captureThrown(() => beginWebGLLayerFrame(renderer, mode, 1, 1));
            assert.equal(thrown?.name, 'TypeError');
        }
    }
});

test('reentry has no guard and outer dispatch resumes with the latest method', () => {
    const trace = [];
    const nestedRenderer = {
        begin() {
            trace.push('nested:begin');
        }
    };
    const outerRenderer = {};
    let outerBegin = function staleOuterBegin() {
        throw new Error('stale outer begin must not run');
    };
    Object.defineProperty(outerRenderer, 'begin', {
        get() {
            trace.push('outer:begin:get');
            return outerBegin;
        }
    });
    const width = {
        [Symbol.toPrimitive]() {
            trace.push('outer:width:start');
            assert.equal(beginWebGLLayerFrame(nestedRenderer, 'batch', 1, 1), undefined);
            outerBegin = function liveOuterBegin() {
                assert.strictEqual(this, outerRenderer);
                trace.push('outer:begin:call');
            };
            trace.push('outer:width:end');
            return 2;
        }
    };

    assert.equal(beginWebGLLayerFrame(outerRenderer, 'batch', width, 2), undefined);
    assert.deepEqual(trace, [
        'outer:width:start',
        'nested:begin',
        'outer:width:end',
        'outer:begin:get',
        'outer:begin:call'
    ]);
});

test('selected method getter can reenter before the outer call uses its returned function', () => {
    const trace = [];
    const nestedRenderer = {
        begin() {
            trace.push('nested:begin');
        }
    };
    const outerRenderer = {};
    Object.defineProperty(outerRenderer, 'begin', {
        get() {
            trace.push('outer:begin:get:start');
            beginWebGLLayerFrame(nestedRenderer, 'batch', 1, 1);
            trace.push('outer:begin:get:end');
            return function begin() {
                assert.strictEqual(this, outerRenderer);
                trace.push('outer:begin:call');
            };
        }
    });

    assert.equal(beginWebGLLayerFrame(outerRenderer, 'batch', 1, 1), undefined);
    assert.deepEqual(trace, [
        'outer:begin:get:start',
        'nested:begin',
        'outer:begin:get:end',
        'outer:begin:call'
    ]);
});
