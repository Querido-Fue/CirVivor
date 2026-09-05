import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const DESCRIPTOR_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/display_surface_descriptor.js',
    import.meta.url
));
const DISPLAY_SYSTEM_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/display_system.js',
    import.meta.url
));
const [descriptorSource, displaySystemSource] = await Promise.all([
    readFile(DESCRIPTOR_SOURCE_PATH, 'utf8'),
    readFile(DISPLAY_SYSTEM_SOURCE_PATH, 'utf8')
]);
const productionDescriptorModule = await loadGameModule(
    'display/display_surface_descriptor.js'
);

/**
 * 상속 getter의 receiver를 통해 private WebGL alias 맵을 캡처합니다.
 * @returns {object} production descriptor가 직접 소유한 frozen alias 맵입니다.
 */
function captureProductionLayerNameMap() {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    const mapPrototype = resolve('__proto__');
    const probeKey = Symbol('capture-layer-name-map');
    const probeValue = { source: 'capture-layer-name-map' };
    let capturedMap;

    try {
        Object.defineProperty(mapPrototype, probeKey, {
            configurable: true,
            get() {
                capturedMap = this;
                return probeValue;
            }
        });
        assert.equal(resolve(probeKey), probeValue);
    } finally {
        assert.equal(Reflect.deleteProperty(mapPrototype, probeKey), true);
    }

    assert.ok(capturedMap);
    return capturedMap;
}

const productionLayerNameMap = captureProductionLayerNameMap();

/**
 * 지정된 realm에 synthetic dependency를 만듭니다.
 * @param {vm.Context} context - 대상 VM context입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {object} exports - 노출할 export입니다.
 * @returns {vm.SyntheticModule} synthetic 모듈입니다.
 */
function createSyntheticModule(context, identifier, exports) {
    return new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
}

/**
 * 실제 resolver와 실제 공개 render caller를 같은 모듈 그래프에서 평가합니다.
 * @returns {Promise<{namespace: vm.ModuleNamespace, descriptorNamespace: vm.ModuleNamespace, instance: object}>} caller namespace, descriptor namespace와 최신 인스턴스입니다.
 */
async function loadDisplaySystemCaller() {
    const context = vm.createContext({ console });
    const dependencies = new Map();
    dependencies.set('save/save_system.js', createSyntheticModule(
        context,
        'save/save_system.js',
        { getSetting() {} }
    ));
    dependencies.set('util/color_util.js', createSyntheticModule(
        context,
        'util/color_util.js',
        { colorUtil() { return null; } }
    ));

    class ScreenHandler {}
    class DrawHandler2D {}
    class WebGLHandler {}
    class ThemeHandler {}
    class CanvasSurfacePool {}
    class VignetteRenderer {}

    dependencies.set('./_screen_handler.js', createSyntheticModule(
        context,
        './_screen_handler.js',
        { ScreenHandler }
    ));
    dependencies.set('./_draw_handler_2d.js', createSyntheticModule(
        context,
        './_draw_handler_2d.js',
        { DrawHandler2D }
    ));
    dependencies.set('./webgl/_webgl_handler.js', createSyntheticModule(
        context,
        './webgl/_webgl_handler.js',
        { WebGLHandler }
    ));
    dependencies.set('display/_theme_handler.js', createSyntheticModule(
        context,
        'display/_theme_handler.js',
        { ThemeHandler, setTheme() {}, ColorSchemes: {} }
    ));
    dependencies.set('./_surface_pool.js', createSyntheticModule(
        context,
        './_surface_pool.js',
        { CanvasSurfacePool }
    ));
    dependencies.set('./_vignette_renderer.js', createSyntheticModule(
        context,
        './_vignette_renderer.js',
        { VignetteRenderer }
    ));
    dependencies.set('./_theme_transition_controller.js', createSyntheticModule(
        context,
        './_theme_transition_controller.js',
        { ThemeTransitionController: class ThemeTransitionController {} }
    ));

    const descriptorModule = new vm.SourceTextModule(
        descriptorSource,
        { context, identifier: DESCRIPTOR_SOURCE_PATH }
    );
    dependencies.set('./display_surface_descriptor.js', descriptorModule);

    const displaySystemModule = new vm.SourceTextModule(
        displaySystemSource,
        { context, identifier: DISPLAY_SYSTEM_SOURCE_PATH }
    );
    const linker = (specifier) => {
        const dependency = dependencies.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 DisplaySystem import입니다: ${specifier}`);
        }
        return dependency;
    };
    await displaySystemModule.link(linker);
    await displaySystemModule.evaluate();
    const instance = new displaySystemModule.namespace.DisplaySystem();
    return {
        namespace: displaySystemModule.namespace,
        descriptorNamespace: descriptorModule.namespace,
        instance
    };
}

test('실제 production alias와 미등록 값은 mapped 값 또는 원래 identity를 반환한다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    assert.doesNotMatch(descriptorSource, /data\/data_handler\.js/);
    assert.match(
        descriptorSource,
        /export const DISPLAY_WEBGL_RENDER_MODES = Object\.freeze\(\{/
    );
    assert.match(
        descriptorSource,
        /const DISPLAY_WEBGL_LAYER_NAME_MAP = Object\.freeze\(\{/
    );
    assert.equal(Object.isFrozen(productionLayerNameMap), true);
    assert.notEqual(Object.getPrototypeOf(productionLayerNameMap), null);
    assert.deepEqual(
        Reflect.ownKeys(productionLayerNameMap),
        ['main', 'mainGL', 'backgroundGL', 'effectGL']
    );
    assert.equal(Object.hasOwn(productionLayerNameMap, 'toString'), false);
    assert.equal(resolve('main'), 'object');
    assert.equal(resolve('mainGL'), 'object');
    assert.equal(resolve('backgroundGL'), 'background');
    assert.equal(resolve('effectGL'), 'effect');
    assert.equal(resolve('missing'), 'missing');
    assert.equal(resolve(''), '');

    const symbolKey = Symbol('missing');
    const objectKey = {};
    assert.equal(resolve(symbolKey), symbolKey);
    assert.equal(resolve(objectKey), objectKey);
    assert.equal(resolve(null), null);
    assert.equal(resolve(undefined), undefined);
    assert.equal(Object.is(resolve(-0), -0), true);
    assert.equal(resolve(17n), 17n);
    assert.equal(Object.is(resolve(Number.NaN), Number.NaN), true);
    assert.equal(resolve(Number.POSITIVE_INFINITY), Number.POSITIVE_INFINITY);
    assert.equal(resolve(Number.NEGATIVE_INFINITY), Number.NEGATIVE_INFINITY);
    assert.equal(resolve(true), true);
    assert.equal(resolve(false), false);

    const inheritedToString = resolve('toString');
    const inheritedValueOf = resolve('valueOf');
    const inheritedConstructor = resolve('constructor');
    const inheritedPrototype = resolve('__proto__');
    assert.equal(typeof inheritedToString, 'function');
    assert.equal(typeof inheritedValueOf, 'function');
    assert.equal(inheritedConstructor.name, 'Object');
    assert.equal(Object.getPrototypeOf(productionLayerNameMap), inheritedPrototype);
    assert.equal(inheritedPrototype.toString, inheritedToString);
    assert.equal(inheritedPrototype.valueOf, inheritedValueOf);

    assert.equal(resolve.name, 'resolveDisplayWebGLLayerName');
    assert.equal(resolve.length, 1);
    assert.equal(Object.hasOwn(resolve, 'prototype'), true);
    const constructed = new resolve('main');
    assert.equal(constructed instanceof resolve, true);
    assert.equal(resolve.call({ ignored: true }, 'main', 'extra'), 'object');
});

test('lookup의 truthy 결과만 채택하고 falsy 결과는 원래 key identity로 되돌린다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionLayerNameMap);
    const inheritedKey = Symbol('inherited-alias');
    const mappedKey = Symbol('mapped-alias');
    const constructMappedKey = Symbol('construct-mapped-alias');
    const falsyEntries = [
        [Symbol('zero-alias'), 0],
        [Symbol('negative-zero-alias'), -0],
        [Symbol('empty-alias'), ''],
        [Symbol('false-alias'), false],
        [Symbol('nan-alias'), Number.NaN],
        [Symbol('bigint-zero-alias'), 0n],
        [Symbol('null-alias'), null],
        [Symbol('undefined-alias'), undefined]
    ];
    const definedKeys = [inheritedKey, mappedKey, constructMappedKey];
    const inheritedTarget = { source: 'prototype' };
    const mappedObject = {
        source: 'getter',
        valueOf() {
            throw new Error('truthy object를 Boolean 변환하며 valueOf를 호출했습니다.');
        },
        toString() {
            throw new Error('truthy object를 Boolean 변환하며 toString을 호출했습니다.');
        }
    };
    let inheritedGetterReceiver;
    let getterReceiver;
    let getterReadCount = 0;

    try {
        Object.defineProperty(mapPrototype, inheritedKey, {
            configurable: true,
            get() {
                inheritedGetterReceiver = this;
                return inheritedTarget;
            }
        });
        Object.defineProperty(mapPrototype, mappedKey, {
            configurable: true,
            get() {
                getterReceiver = this;
                getterReadCount += 1;
                return mappedObject;
            }
        });
        Object.defineProperty(mapPrototype, constructMappedKey, {
            configurable: true,
            value: mappedObject
        });
        for (const [key, value] of falsyEntries) {
            definedKeys.push(key);
            Object.defineProperty(mapPrototype, key, {
                configurable: true,
                value
            });
        }

        assert.equal(resolve(mappedKey), mappedObject);
        assert.equal(getterReceiver, productionLayerNameMap);
        assert.equal(getterReadCount, 1);
        assert.equal(resolve(inheritedKey), inheritedTarget);
        assert.equal(inheritedGetterReceiver, productionLayerNameMap);

        for (const [key] of falsyEntries) {
            assert.equal(resolve(key), key);
        }

        const objectKey = {
            [Symbol.toPrimitive](hint) {
                assert.equal(hint, 'string');
                return falsyEntries[0][0];
            }
        };
        assert.equal(resolve(objectKey), objectKey);

        assert.equal(new resolve(constructMappedKey), mappedObject);
        const missingSymbol = Symbol('missing-constructor-key');
        const missingObjectKey = {
            [Symbol.toPrimitive]() {
                return missingSymbol;
            }
        };
        assert.equal(new resolve(missingObjectKey), missingObjectKey);
        const missingPrimitiveResult = new resolve(missingSymbol);
        assert.equal(missingPrimitiveResult instanceof resolve, true);
    } finally {
        for (const key of definedKeys) {
            assert.equal(Reflect.deleteProperty(mapPrototype, key), true);
        }
    }
});

test('캡처된 alias 맵의 live 값과 표준 ToPropertyKey fallback 순서를 보존한다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionLayerNameMap);
    const liveKey = Symbol('live-alias');
    const symbolProperty = Symbol('mapped-symbol');
    const definedKeys = [liveKey, symbolProperty];

    try {
        Object.defineProperty(mapPrototype, liveKey, {
            configurable: true,
            writable: true,
            value: 'prototype-first'
        });
        Object.defineProperty(mapPrototype, symbolProperty, {
            configurable: true,
            value: 'symbol-target'
        });

        assert.equal(resolve(liveKey), 'prototype-first');
        mapPrototype[liveKey] = 'prototype-second';
        assert.equal(resolve(liveKey), 'prototype-second');

        const shortCircuitTrace = [];
        const shortCircuitKey = {
            toString() {
                shortCircuitTrace.push('toString');
                return liveKey;
            },
            valueOf() {
                shortCircuitTrace.push('valueOf');
                return Symbol('unused');
            }
        };
        assert.equal(resolve(shortCircuitKey), 'prototype-second');
        assert.deepEqual(shortCircuitTrace, ['toString']);

        const fallbackTrace = [];
        const valueOfFallbackKey = {
            toString() {
                fallbackTrace.push('toString');
                return {};
            },
            valueOf() {
                fallbackTrace.push('valueOf');
                return liveKey;
            }
        };
        assert.equal(resolve(valueOfFallbackKey), 'prototype-second');
        assert.deepEqual(fallbackTrace, ['toString', 'valueOf']);

        const symbolProducingKey = {
            [Symbol.toPrimitive](hint) {
                assert.equal(hint, 'string');
                return symbolProperty;
            }
        };
        assert.equal(resolve(symbolProducingKey), 'symbol-target');

        const invalidPrimitiveKey = {
            [Symbol.toPrimitive]() {
                return {};
            }
        };
        assert.throws(
            () => resolve(invalidPrimitiveKey),
            (error) => error?.name === 'TypeError'
        );
    } finally {
        for (const key of definedKeys) {
            assert.equal(Reflect.deleteProperty(mapPrototype, key), true);
        }
    }
});

test('PropertyKey coercion·상속 getter·재진입 순서와 receiver를 그대로 보존한다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionLayerNameMap);
    const innerKey = Symbol('inner-alias');
    const outerKey = Symbol('outer-alias');
    const directFalsyKey = Symbol('direct-falsy-alias');
    const trace = [];
    let insideOuterGet = false;

    try {
        Object.defineProperty(mapPrototype, innerKey, {
            configurable: true,
            get() {
                trace.push(['get', innerKey, this === productionLayerNameMap]);
                return 'inner-target';
            }
        });
        Object.defineProperty(mapPrototype, outerKey, {
            configurable: true,
            get() {
                trace.push(['get', outerKey, this === productionLayerNameMap]);
                if (!insideOuterGet) {
                    insideOuterGet = true;
                    trace.push(['getReentry', resolve(innerKey)]);
                    insideOuterGet = false;
                }
                return 'outer-target';
            }
        });
        Object.defineProperty(mapPrototype, directFalsyKey, {
            configurable: true,
            get() {
                trace.push(['get', directFalsyKey, this === productionLayerNameMap]);
                return undefined;
            }
        });
        const reentrantKey = {
            [Symbol.toPrimitive](hint) {
                trace.push(['toPrimitive', hint]);
                trace.push(['innerResult', resolve(innerKey)]);
                return outerKey;
            }
        };

        assert.equal(resolve(reentrantKey), 'outer-target');
        assert.deepEqual(trace, [
            ['toPrimitive', 'string'],
            ['get', innerKey, true],
            ['innerResult', 'inner-target'],
            ['get', outerKey, true],
            ['get', innerKey, true],
            ['getReentry', 'inner-target']
        ]);

        trace.length = 0;
        assert.equal(resolve(directFalsyKey), directFalsyKey);
        assert.deepEqual(trace, [['get', directFalsyKey, true]]);
    } finally {
        for (const key of [innerKey, outerKey, directFalsyKey]) {
            assert.equal(Reflect.deleteProperty(mapPrototype, key), true);
        }
    }
});

test('key coercion과 map 조회 오류는 같은 identity로 동기 전파된다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionLayerNameMap);
    const throwingGetKey = Symbol('throwing-get-alias');
    const getToken = new Error('get sentinel');
    const keyToken = new Error('key sentinel');
    const trace = [];

    try {
        Object.defineProperty(mapPrototype, throwingGetKey, {
            configurable: true,
            get() {
                trace.push(['get', throwingGetKey, this === productionLayerNameMap]);
                throw getToken;
            }
        });
        const throwingKey = {
            [Symbol.toPrimitive](hint) {
                trace.push(['toPrimitive', hint]);
                throw keyToken;
            }
        };

        assert.throws(() => resolve(throwingKey), (error) => error === keyToken);
        assert.deepEqual(trace, [['toPrimitive', 'string']]);
        assert.throws(() => resolve(throwingGetKey), (error) => error === getToken);
        assert.deepEqual(trace, [
            ['toPrimitive', 'string'],
            ['get', throwingGetKey, true]
        ]);
    } finally {
        assert.equal(Reflect.deleteProperty(mapPrototype, throwingGetKey), true);
    }
});

test('실제 renderGL caller는 resolver 결과를 그대로 전달하고 하위 반환값 계약을 보존한다', async () => {
    const { namespace, descriptorNamespace, instance } = await loadDisplaySystemCaller();
    const calls = [];
    const bulkResult = { rendered: 7 };
    const webGLHandler = {
        render(...args) {
            calls.push(['render', this, ...args]);
            return { ignored: true };
        },
        renderShapeInstances(...args) {
            calls.push(['bulk', this, ...args]);
            return bulkResult;
        }
    };
    instance.webGLHandler = webGLHandler;
    const rejectInspection = (label) => ({
        defineProperty() {
            throw new Error(`caller가 ${label} 프로퍼티를 정의했습니다.`);
        },
        deleteProperty() {
            throw new Error(`caller가 ${label} 프로퍼티를 삭제했습니다.`);
        },
        get() {
            throw new Error(`caller가 ${label} 프로퍼티를 읽었습니다.`);
        },
        getOwnPropertyDescriptor() {
            throw new Error(`caller가 ${label} descriptor를 읽었습니다.`);
        },
        getPrototypeOf() {
            throw new Error(`caller가 ${label} prototype을 읽었습니다.`);
        },
        has() {
            throw new Error(`caller가 ${label} membership을 검사했습니다.`);
        },
        isExtensible() {
            throw new Error(`caller가 ${label} extensibility를 검사했습니다.`);
        },
        ownKeys() {
            throw new Error(`caller가 ${label}를 열거했습니다.`);
        },
        preventExtensions() {
            throw new Error(`caller가 ${label} 확장을 막았습니다.`);
        },
        set() {
            throw new Error(`caller가 ${label} 프로퍼티를 변경했습니다.`);
        },
        setPrototypeOf() {
            throw new Error(`caller가 ${label} prototype을 변경했습니다.`);
        }
    });
    const options = new Proxy({ shape: 'circle' }, rejectInspection('options'));
    const localCenters = new Proxy(
        [{ x: 1, y: 2 }],
        rejectInspection('localCenters')
    );
    const cacheKey = Object.freeze({ id: 'prepared-vertices' });

    assert.equal(namespace.renderGL('main', options), undefined);
    assert.equal(calls[0][0], 'render');
    assert.equal(calls[0][1], webGLHandler);
    assert.equal(calls[0][2], 'object');
    assert.equal(calls[0][3], options);
    assert.equal(calls[0].length, 4);

    assert.equal(
        namespace.renderGLShapeInstances(
            'mainGL',
            options,
            localCenters,
            -0,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            cacheKey
        ),
        bulkResult
    );
    assert.equal(calls[1][0], 'bulk');
    assert.equal(calls[1][1], webGLHandler);
    assert.equal(calls[1][2], 'object');
    assert.equal(calls[1][3], options);
    assert.equal(calls[1][4], localCenters);
    assert.equal(Object.is(calls[1][5], -0), true);
    assert.equal(Object.is(calls[1][6], Number.NaN), true);
    assert.equal(calls[1][7], Number.POSITIVE_INFINITY);
    assert.equal(calls[1][8], cacheKey);
    assert.equal(calls[1].length, 9);

    const objectKey = {};
    assert.equal(
        namespace.renderGLShapeInstances(objectKey, options, localCenters, 3, 4, 5),
        bulkResult
    );
    assert.equal(calls[2][0], 'bulk');
    assert.equal(calls[2][1], webGLHandler);
    assert.equal(calls[2][2], objectKey);
    assert.equal(calls[2][3], options);
    assert.equal(calls[2][4], localCenters);
    assert.equal(calls[2][5], 3);
    assert.equal(calls[2][6], 4);
    assert.equal(calls[2][7], 5);
    assert.equal(calls[2][8], null);
    assert.equal(calls[2].length, 9);

    assert.equal(namespace.renderGL('toString', options), undefined);
    assert.equal(calls[3][1], webGLHandler);
    assert.equal(
        calls[3][2],
        descriptorNamespace.resolveDisplayWebGLLayerName('toString')
    );
    assert.equal(calls[3][3], options);
    assert.equal(calls[3].length, 4);
    assert.equal(calls.length, 4);
});

test('실제 caller는 resolver 뒤 handler·method를 live 조회하고 오류 identity를 보존한다', async () => {
    const trace = [];
    const layerNameKey = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'string');
            trace.push(['mapGet', 'main']);
            return 'main';
        }
    };
    const { namespace, instance } = await loadDisplaySystemCaller();
    const options = { id: 'options' };
    const handler = {};
    Object.defineProperty(handler, 'render', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'render']);
            return function renderMethod(targetLayer, receivedOptions) {
                trace.push([
                    'call',
                    this === handler,
                    targetLayer,
                    receivedOptions === options
                ]);
                return { ignored: true };
            };
        }
    });
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            return handler;
        }
    });

    assert.equal(namespace.renderGL(layerNameKey, options), undefined);
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'render'],
        ['call', true, 'object', true]
    ]);

    const handlerToken = new Error('handler getter sentinel');
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            throw handlerToken;
        }
    });
    trace.length = 0;
    assert.throws(() => namespace.renderGL(layerNameKey, options), (error) => error === handlerToken);
    assert.deepEqual(trace, [['mapGet', 'main'], ['handlerGet']]);

    const methodToken = new Error('method getter sentinel');
    Object.defineProperty(handler, 'render', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'render']);
            throw methodToken;
        }
    });
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            return handler;
        }
    });
    trace.length = 0;
    assert.throws(() => namespace.renderGL(layerNameKey, options), (error) => error === methodToken);
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'render']
    ]);

    const callToken = new Error('render call sentinel');
    Object.defineProperty(handler, 'render', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'render']);
            return function throwingRender() {
                trace.push(['call', this === handler]);
                throw callToken;
            };
        }
    });
    trace.length = 0;
    assert.throws(() => namespace.renderGL(layerNameKey, options), (error) => error === callToken);
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'render'],
        ['call', true]
    ]);

    Object.defineProperty(handler, 'render', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'render']);
            return null;
        }
    });
    trace.length = 0;
    assert.throws(
        () => namespace.renderGL(layerNameKey, options),
        (error) => error?.name === 'TypeError'
    );
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'render']
    ]);

    const bulkHandlerToken = new Error('bulk handler getter sentinel');
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            throw bulkHandlerToken;
        }
    });
    trace.length = 0;
    assert.throws(
        () => namespace.renderGLShapeInstances(layerNameKey, options, [], 0, 0, 1),
        (error) => error === bulkHandlerToken
    );
    assert.deepEqual(trace, [['mapGet', 'main'], ['handlerGet']]);

    const bulkMethodToken = new Error('bulk method getter sentinel');
    Object.defineProperty(handler, 'renderShapeInstances', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'bulk']);
            throw bulkMethodToken;
        }
    });
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            return handler;
        }
    });
    trace.length = 0;
    assert.throws(
        () => namespace.renderGLShapeInstances(layerNameKey, options, [], 0, 0, 1),
        (error) => error === bulkMethodToken
    );
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'bulk']
    ]);

    Object.defineProperty(handler, 'renderShapeInstances', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'bulk']);
            return null;
        }
    });
    trace.length = 0;
    assert.throws(
        () => namespace.renderGLShapeInstances(layerNameKey, options, [], 0, 0, 1),
        (error) => error?.name === 'TypeError'
    );
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'bulk']
    ]);

    const bulkToken = new Error('bulk call sentinel');
    Object.defineProperty(handler, 'renderShapeInstances', {
        configurable: true,
        get() {
            trace.push(['methodGet', 'bulk']);
            return function throwingBulk() {
                trace.push(['callBulk', this === handler]);
                throw bulkToken;
            };
        }
    });
    trace.length = 0;
    assert.throws(
        () => namespace.renderGLShapeInstances(layerNameKey, options, [], -0, Number.NaN, 1),
        (error) => error === bulkToken
    );
    assert.deepEqual(trace, [
        ['mapGet', 'main'],
        ['handlerGet'],
        ['methodGet', 'bulk'],
        ['callBulk', true]
    ]);
});

test('PropertyKey 변환 중 singleton 교체가 일어나면 실제 caller는 최신 DisplaySystem을 사용한다', async () => {
    const trace = [];
    const { namespace, instance: oldInstance } = await loadDisplaySystemCaller();
    Object.defineProperty(oldInstance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['oldHandlerGet']);
            return { render() { trace.push(['oldCall']); } };
        }
    });

    let latestInstance;
    const latestHandler = {};
    Object.defineProperty(latestHandler, 'render', {
        get() {
            trace.push(['latestMethodGet']);
            return function latestRender(targetLayer, options) {
                trace.push([
                    'latestCall',
                    this === latestHandler,
                    targetLayer,
                    options?.id
                ]);
            };
        }
    });
    const swappingRenderKey = {
        [Symbol.toPrimitive](hint) {
            trace.push(['toPrimitive', 'render', hint]);
            trace.push(['singletonSwapStart']);
            latestInstance = new namespace.DisplaySystem();
            Object.defineProperty(latestInstance, 'webGLHandler', {
                get() {
                    trace.push(['latestHandlerGet']);
                    return latestHandler;
                }
            });
            trace.push(['singletonSwapEnd']);
            return 'main';
        }
    };

    assert.equal(
        namespace.renderGL(swappingRenderKey, { id: 'latest-options' }),
        undefined
    );
    assert.ok(latestInstance);
    assert.deepEqual(trace, [
        ['toPrimitive', 'render', 'string'],
        ['singletonSwapStart'],
        ['singletonSwapEnd'],
        ['latestHandlerGet'],
        ['latestMethodGet'],
        ['latestCall', true, 'object', 'latest-options']
    ]);

    trace.length = 0;
    const staleBulkResult = { source: 'stale-instance' };
    Object.defineProperty(latestHandler, 'renderShapeInstances', {
        get() {
            trace.push(['staleBulkMethodGet']);
            return function staleBulk() {
                trace.push(['staleBulkCall', this === latestHandler]);
                return staleBulkResult;
            };
        }
    });
    const newestBulkResult = { source: 'newest-instance' };
    const newestHandler = {};
    Object.defineProperty(newestHandler, 'renderShapeInstances', {
        get() {
            trace.push(['newestBulkMethodGet']);
            return function newestBulk(
                targetLayer,
                receivedOptions,
                receivedCenters,
                cameraX,
                cameraY,
                scale
            ) {
                trace.push([
                    'newestBulkCall',
                    this === newestHandler,
                    targetLayer,
                    receivedOptions?.id,
                    receivedCenters?.[0]?.id,
                    Object.is(cameraX, -0),
                    Object.is(cameraY, Number.NaN),
                    scale
                ]);
                return newestBulkResult;
            };
        }
    });
    let newestInstance;
    const swappingBulkKey = {
        [Symbol.toPrimitive](hint) {
            trace.push(['toPrimitive', 'bulk', hint]);
            trace.push(['bulkSingletonSwapStart']);
            newestInstance = new namespace.DisplaySystem();
            Object.defineProperty(newestInstance, 'webGLHandler', {
                get() {
                    trace.push(['newestHandlerGet']);
                    return newestHandler;
                }
            });
            trace.push(['bulkSingletonSwapEnd']);
            return 'mainGL';
        }
    };
    const bulkOptions = { id: 'newest-options' };
    const bulkCenters = [{ id: 'newest-center' }];

    assert.equal(
        namespace.renderGLShapeInstances(
            swappingBulkKey,
            bulkOptions,
            bulkCenters,
            -0,
            Number.NaN,
            Number.POSITIVE_INFINITY
        ),
        newestBulkResult
    );
    assert.ok(newestInstance);
    assert.deepEqual(trace, [
        ['toPrimitive', 'bulk', 'string'],
        ['bulkSingletonSwapStart'],
        ['bulkSingletonSwapEnd'],
        ['newestHandlerGet'],
        ['newestBulkMethodGet'],
        [
            'newestBulkCall',
            true,
            'object',
            'newest-options',
            'newest-center',
            true,
            true,
            Number.POSITIVE_INFINITY
        ]
    ]);
});

test('실제 render caller는 resolver 오류 전에 WebGL handler를 호출하지 않는다', async () => {
    const token = new Error('resolver gate sentinel');
    const trace = [];
    const { namespace, instance } = await loadDisplaySystemCaller();
    const createThrowingKey = (label) => ({
        [Symbol.toPrimitive](hint) {
            trace.push(['toPrimitive', label, hint]);
            throw token;
        }
    });
    const webGLHandler = {
        render() {
            trace.push(['render']);
        },
        renderShapeInstances() {
            trace.push(['bulk']);
        }
    };
    Object.defineProperty(instance, 'webGLHandler', {
        configurable: true,
        get() {
            trace.push(['handlerGet']);
            return webGLHandler;
        }
    });

    assert.throws(
        () => namespace.renderGL(createThrowingKey('render'), {}),
        (error) => error === token
    );
    assert.deepEqual(trace, [['toPrimitive', 'render', 'string']]);
    trace.length = 0;
    assert.throws(
        () => namespace.renderGLShapeInstances(
            createThrowingKey('bulk'),
            {},
            [],
            0,
            0,
            1
        ),
        (error) => error === token
    );
    assert.deepEqual(trace, [['toPrimitive', 'bulk', 'string']]);
});
