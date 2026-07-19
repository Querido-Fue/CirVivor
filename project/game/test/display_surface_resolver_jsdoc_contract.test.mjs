import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const DESCRIPTOR_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/display_surface_descriptor.js',
    import.meta.url
));
const DISPLAY_SYSTEM_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/display_system.js',
    import.meta.url
));
const [descriptorSource, displaySystemSource] = await Promise.all([
    readFile(DESCRIPTOR_SOURCE_PATH, 'utf8'),
    readFile(DISPLAY_SYSTEM_SOURCE_PATH, 'utf8')
]);
const [productionDescriptorModule, productionSurfaceDataModule] = await Promise.all([
    loadGameModule('display/display_surface_descriptor.js'),
    loadGameModule('data/display/display_surface_data.js')
]);
const productionSurfaceData = productionSurfaceDataModule.DISPLAY_SURFACE_DATA;
const productionLayerNameMap = productionSurfaceData.WEBGL_LAYER_NAME_MAP;
const EXECUTABLE_SOURCE_HASH = '76be28d1edda8705df26284b47aa4b6c0657d7db22d902e0dcc6c9d08c6a215f';

/**
 * 테스트용 display surface 정적 데이터를 생성합니다.
 * @param {object} layerNameMap - WebGL alias 조회에 사용할 일반 객체 또는 Proxy입니다.
 * @returns {object} production getData 응답과 같은 최소 데이터입니다.
 */
function createDisplaySurfaceData(layerNameMap) {
    return {
        WEBGL_RENDER_MODES: {
            BATCH: 'batch',
            OVERLAY_EFFECT: 'overlay-effect',
            EFFECT: 'effect'
        },
        WEBGL_LAYER_NAME_MAP: layerNameMap,
        NATIVE_2D_SURFACE_IDS: ['texteffect', 'ui', 'vignette', 'top'],
        STATIC_SURFACE_ORDER_MAP: {
            background: 0,
            object: 10,
            effect: 20,
            texteffect: 30,
            ui: 40,
            top: 1000
        }
    };
}

/**
 * production과 같은 WebGL alias 맵을 새 일반 객체로 생성합니다.
 * @returns {object} alias 맵입니다.
 */
function createProductionLayerNameMap() {
    return {
        main: 'object',
        mainGL: 'object',
        backgroundGL: 'background',
        effectGL: 'effect'
    };
}

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
 * 실제 descriptor production 소스를 지정 alias 맵으로 평가합니다.
 * @param {object} layerNameMap - 모듈 초기화 때 캡처할 alias 맵입니다.
 * @returns {Promise<vm.ModuleNamespace>} production namespace입니다.
 */
async function loadDescriptorModule(layerNameMap = createProductionLayerNameMap()) {
    const context = vm.createContext({ console });
    const displaySurfaceData = createDisplaySurfaceData(layerNameMap);
    const dataModule = createSyntheticModule(context, 'data/data_handler.js', {
        getData(key) {
            if (key !== 'DISPLAY_SURFACE_DATA') {
                throw new Error(`지원하지 않는 테스트 데이터입니다: ${key}`);
            }
            return displaySurfaceData;
        }
    });
    const descriptorModule = new vm.SourceTextModule(
        descriptorSource,
        { context, identifier: DESCRIPTOR_SOURCE_PATH }
    );
    await descriptorModule.link((specifier) => {
        if (specifier !== 'data/data_handler.js') {
            throw new Error(`지원하지 않는 descriptor import입니다: ${specifier}`);
        }
        return dataModule;
    });
    await descriptorModule.evaluate();
    return descriptorModule.namespace;
}

/**
 * 실제 resolver와 실제 공개 render caller를 같은 모듈 그래프에서 평가합니다.
 * @param {object} layerNameMap - resolver가 캡처할 alias 맵입니다.
 * @returns {Promise<{namespace: vm.ModuleNamespace, instance: object}>} caller namespace와 최신 인스턴스입니다.
 */
async function loadDisplaySystemCaller(layerNameMap = createProductionLayerNameMap()) {
    const context = vm.createContext({ console });
    const displaySurfaceData = createDisplaySurfaceData(layerNameMap);
    const dependencies = new Map();
    dependencies.set('data/data_handler.js', createSyntheticModule(
        context,
        'data/data_handler.js',
        {
            getData(key) {
                if (key !== 'DISPLAY_SURFACE_DATA') {
                    throw new Error(`지원하지 않는 테스트 데이터입니다: ${key}`);
                }
                return displaySurfaceData;
            }
        }
    ));
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
    return { namespace: displaySystemModule.namespace, instance };
}

test('WebGL layer resolver JSDoc 변경은 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(descriptorSource), EXECUTABLE_SOURCE_HASH);
});

test('resolver JSDoc은 PropertyKey 조회·상속·truthy fallback과 실제 반환 타입을 명시한다', () => {
    const resolverDoc = findLeadingJsDoc(
        descriptorSource,
        'export function resolveDisplayWebGLLayerName\\(layerName\\)'
    );
    const normalizedResolverDoc = resolverDoc
        .replace(/^[ \t]*\*[ \t]?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    assert.match(normalizedResolverDoc, /@param \{\*\} layerName/);
    assert.equal(
        normalizedResolverDoc.includes(
            '`layerName`은 조회 과정에서 PropertyKey로 변환되며 '
            + '상속 프로퍼티도 조회에 포함됩니다.'
        ),
        true
    );
    assert.equal(
        normalizedResolverDoc.includes(
            '조회 결과가 truthy이면 해당 값을 반환하고, falsy이면 '
            + '변환 전 원래 입력 identity를 반환합니다.'
        ),
        true
    );
    assert.equal(
        normalizedResolverDoc.includes(
            'PropertyKey 변환 또는 프로퍼티 조회 중 발생한 예외는 그대로 동기 전파됩니다.'
        ),
        true
    );
    assert.match(normalizedResolverDoc, /@returns \{\*\}/);
});

test('실제 production alias와 미등록 값은 mapped 값 또는 원래 identity를 반환한다', () => {
    const { resolveDisplayWebGLLayerName: resolve } = productionDescriptorModule;
    assert.equal(Object.isFrozen(productionSurfaceData), true);
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

test('lookup의 truthy 결과만 채택하고 falsy 결과는 원래 key identity로 되돌린다', async () => {
    const inheritedTarget = { source: 'prototype' };
    let inheritedGetterReceiver;
    const mapPrototype = {};
    Object.defineProperty(mapPrototype, 'inheritedAlias', {
        get() {
            inheritedGetterReceiver = this;
            return inheritedTarget;
        }
    });
    const layerNameMap = Object.create(mapPrototype);
    const mappedObject = {
        source: 'own-getter',
        valueOf() {
            throw new Error('truthy object를 Boolean 변환하며 valueOf를 호출했습니다.');
        },
        toString() {
            throw new Error('truthy object를 Boolean 변환하며 toString을 호출했습니다.');
        }
    };
    let getterReceiver;
    let getterReadCount = 0;
    Object.defineProperty(layerNameMap, 'mapped', {
        get() {
            getterReceiver = this;
            getterReadCount += 1;
            return mappedObject;
        },
        enumerable: true
    });
    for (const [key, value] of [
        ['zero', 0],
        ['negativeZero', -0],
        ['empty', ''],
        ['false', false],
        ['nan', Number.NaN],
        ['bigintZero', 0n],
        ['null', null],
        ['undefined', undefined]
    ]) {
        layerNameMap[key] = value;
    }

    const { resolveDisplayWebGLLayerName: resolve } = await loadDescriptorModule(layerNameMap);
    assert.equal(resolve('mapped'), mappedObject);
    assert.equal(getterReceiver, layerNameMap);
    assert.equal(getterReadCount, 1);
    assert.equal(resolve('inheritedAlias'), inheritedTarget);
    assert.equal(inheritedGetterReceiver, layerNameMap);

    for (const key of [
        'zero',
        'negativeZero',
        'empty',
        'false',
        'nan',
        'bigintZero',
        'null',
        'undefined'
    ]) {
        assert.equal(resolve(key), key);
    }

    const objectKey = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'string');
            return 'zero';
        }
    };
    assert.equal(resolve(objectKey), objectKey);

    layerNameMap.constructMapped = mappedObject;
    assert.equal(new resolve('constructMapped'), mappedObject);
    const missingObjectKey = {
        toString() {
            return 'missing-constructor-key';
        }
    };
    assert.equal(new resolve(missingObjectKey), missingObjectKey);
    const missingPrimitiveResult = new resolve('missing-constructor-key');
    assert.equal(missingPrimitiveResult instanceof resolve, true);
});

test('캡처된 alias 맵의 live 값과 표준 ToPropertyKey fallback 순서를 보존한다', async () => {
    const mapPrototype = { live: 'prototype-first' };
    const layerNameMap = Object.create(mapPrototype);
    layerNameMap.live = 'own-first';
    const symbolProperty = Symbol('mapped-symbol');
    layerNameMap[symbolProperty] = 'symbol-target';
    const { resolveDisplayWebGLLayerName: resolve } = await loadDescriptorModule(layerNameMap);

    assert.equal(resolve('live'), 'own-first');
    layerNameMap.live = 'own-second';
    assert.equal(resolve('live'), 'own-second');
    delete layerNameMap.live;
    assert.equal(resolve('live'), 'prototype-first');
    mapPrototype.live = 'prototype-second';
    assert.equal(resolve('live'), 'prototype-second');

    const shortCircuitTrace = [];
    const shortCircuitKey = {
        toString() {
            shortCircuitTrace.push('toString');
            return 'live';
        },
        valueOf() {
            shortCircuitTrace.push('valueOf');
            return 'unused';
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
            return 'live';
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
});

test('PropertyKey coercion·Proxy get·재진입 순서와 receiver를 그대로 보존한다', async () => {
    const trace = [];
    let proxy;
    let resolve;
    let insideOuterGet = false;
    const target = {
        inner: 'inner-target',
        outer: 'outer-target'
    };
    proxy = new Proxy(target, {
        get(receiverTarget, property, receiver) {
            trace.push(['get', property, receiver === proxy]);
            if (property === 'outer' && !insideOuterGet) {
                insideOuterGet = true;
                trace.push(['getReentry', resolve('inner')]);
                insideOuterGet = false;
            }
            return Reflect.get(receiverTarget, property, receiver);
        }
    });
    ({ resolveDisplayWebGLLayerName: resolve } = await loadDescriptorModule(proxy));
    const reentrantKey = {
        [Symbol.toPrimitive](hint) {
            trace.push(['toPrimitive', hint]);
            trace.push(['innerResult', resolve('inner')]);
            return 'outer';
        }
    };

    assert.equal(resolve(reentrantKey), 'outer-target');
    assert.deepEqual(trace, [
        ['toPrimitive', 'string'],
        ['get', 'inner', true],
        ['innerResult', 'inner-target'],
        ['get', 'outer', true],
        ['get', 'inner', true],
        ['getReentry', 'inner-target']
    ]);

    trace.length = 0;
    const symbolKey = Symbol('direct');
    assert.equal(resolve(symbolKey), symbolKey);
    assert.deepEqual(trace, [['get', symbolKey, true]]);

    for (const [input, expectedProperty] of [
        [null, 'null'],
        [undefined, 'undefined'],
        [-0, '0'],
        [17n, '17'],
        [Number.NaN, 'NaN'],
        [Number.POSITIVE_INFINITY, 'Infinity'],
        [Number.NEGATIVE_INFINITY, '-Infinity'],
        [true, 'true'],
        [false, 'false']
    ]) {
        trace.length = 0;
        const result = resolve(input);
        assert.equal(Object.is(result, input), true);
        assert.deepEqual(trace, [['get', expectedProperty, true]]);
    }
});

test('key coercion과 map 조회 오류는 같은 identity로 동기 전파된다', async () => {
    const getToken = new Error('get sentinel');
    const keyToken = new Error('key sentinel');
    const trace = [];
    const layerNameMap = new Proxy({}, {
        get(_target, property) {
            trace.push(['get', property]);
            if (property === 'explode') {
                throw getToken;
            }
            return undefined;
        }
    });
    const { resolveDisplayWebGLLayerName: resolve } = await loadDescriptorModule(layerNameMap);
    const throwingKey = {
        [Symbol.toPrimitive](hint) {
            trace.push(['toPrimitive', hint]);
            throw keyToken;
        }
    };

    assert.throws(() => resolve(throwingKey), (error) => error === keyToken);
    assert.deepEqual(trace, [['toPrimitive', 'string']]);
    assert.throws(() => resolve('explode'), (error) => error === getToken);
    assert.deepEqual(trace, [
        ['toPrimitive', 'string'],
        ['get', 'explode']
    ]);
});

test('실제 renderGL caller는 resolver 결과를 그대로 전달하고 하위 반환값 계약을 보존한다', async () => {
    const { namespace, instance } = await loadDisplaySystemCaller();
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
    assert.equal(calls[3][2], Object.prototype.toString);
    assert.equal(calls[3][3], options);
    assert.equal(calls[3].length, 4);
    assert.equal(calls.length, 4);
});

test('실제 caller는 resolver 뒤 handler·method를 live 조회하고 오류 identity를 보존한다', async () => {
    const trace = [];
    const layerNameMap = new Proxy(createProductionLayerNameMap(), {
        get(target, property, receiver) {
            trace.push(['mapGet', property]);
            return Reflect.get(target, property, receiver);
        }
    });
    const { namespace, instance } = await loadDisplaySystemCaller(layerNameMap);
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

    assert.equal(namespace.renderGL('main', options), undefined);
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
    assert.throws(() => namespace.renderGL('main', options), (error) => error === handlerToken);
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
    assert.throws(() => namespace.renderGL('main', options), (error) => error === methodToken);
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
    assert.throws(() => namespace.renderGL('main', options), (error) => error === callToken);
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
        () => namespace.renderGL('main', options),
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
        () => namespace.renderGLShapeInstances('main', options, [], 0, 0, 1),
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
        () => namespace.renderGLShapeInstances('main', options, [], 0, 0, 1),
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
        () => namespace.renderGLShapeInstances('main', options, [], 0, 0, 1),
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
        () => namespace.renderGLShapeInstances('main', options, [], -0, Number.NaN, 1),
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
