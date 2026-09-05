import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME_ROOT = fileURLToPath(new URL('../project/game/', import.meta.url));
const SCRIPT_ROOT = path.join(GAME_ROOT, 'script');
const HANDLER_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'display',
    '_draw_handler_2d.js'
);
const HANDLER_URL = pathToFileURL(HANDLER_PATH).href;
const HANDLER_SOURCE = await readFile(HANDLER_PATH, 'utf8');

const LEGACY_RESET_CALL =
    'this.#resetLayerState(layerName, context, { applyTransform: false });';
const OPTIMIZED_RESET_CALL = 'this.#resetLayerState(layerName, context);';

const LEGACY_RESET_METHOD = `    /**
     * @private
     * 레이어 컨텍스트와 스타일 캐시를 프레임 기본 상태로 되돌립니다.
     * \`render()\` 캐시를 우회하는 직접 캔버스 드로잉이 있어도 다음 프레임이
     * 항상 동일한 시작 상태에서 렌더링되도록 보장합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 초기화할 컨텍스트입니다.
     * @param {{applyTransform?: boolean}} [options={}] - 초기화 후 레이어 transform을 복원할지 여부입니다.
     */
    #resetLayerState(layerName, context, options = {}) {
        resetDrawContextState(context);
        this.#stateCaches.set(layerName, {});
        if (options.applyTransform !== false) {
            this.#applyLayerTransform(layerName, context);
        }
    }`;

const OPTIMIZED_RESET_METHOD = `    /**
     * @private
     * 레이어 컨텍스트와 스타일 캐시를 프레임 기본 상태로 되돌립니다.
     * \`render()\` 캐시를 우회하는 직접 캔버스 드로잉이 있어도 다음 프레임이
     * 항상 동일한 시작 상태에서 렌더링되도록 보장합니다.
     * @param {string} layerName - 초기화할 레이어 식별자입니다.
     * @param {CanvasRenderingContext2D} context - 초기화할 컨텍스트입니다.
     */
    #resetLayerState(layerName, context) {
        resetDrawContextState(context);
        this.#stateCaches.set(layerName, {});
    }`;

const RESET_STYLE_PROPERTIES = Object.freeze([
    'globalAlpha',
    'globalCompositeOperation',
    'shadowBlur',
    'shadowColor',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'filter',
    'textAlign',
    'textBaseline',
    'font'
]);

const DRAW_STYLE_PROPERTIES = Object.freeze([
    'fillStyle',
    'strokeStyle',
    'globalAlpha',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'shadowBlur',
    'shadowColor',
    'font',
    'textAlign',
    'textBaseline'
]);

const DEFAULT_CONTEXT_STATE = Object.freeze({
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowBlur: 0,
    shadowColor: 'rgba(0,0,0,0)',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    filter: 'none',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    font: '10px sans-serif'
});

/**
 * 소스 문자열의 정확한 출현 횟수를 확인한 뒤 전부 치환합니다.
 * @param {string} source - 원본 소스입니다.
 * @param {string} from - 찾을 블록입니다.
 * @param {string} to - 대체 블록입니다.
 * @param {number} expectedCount - 요구되는 출현 횟수입니다.
 * @returns {string} 치환된 소스입니다.
 */
function replaceExact(source, from, to, expectedCount) {
    const count = source.split(from).length - 1;
    assert.equal(count, expectedCount, '예상하지 못한 소스 구조 변경');
    return source.split(from).join(to);
}

/**
 * 현재 생산 소스에서 legacy/optimized 비교 쌍을 생성합니다.
 * @param {string} source - 현재 생산 소스입니다.
 * @returns {{legacySource:string, optimizedSource:string}} 비교 소스 쌍입니다.
 */
function createSourceVariants(source) {
    if (source.includes(OPTIMIZED_RESET_METHOD)) {
        let legacySource = replaceExact(
            source,
            OPTIMIZED_RESET_CALL,
            LEGACY_RESET_CALL,
            2
        );
        legacySource = replaceExact(
            legacySource,
            OPTIMIZED_RESET_METHOD,
            LEGACY_RESET_METHOD,
            1
        );
        return { legacySource, optimizedSource: source };
    }

    assert.ok(source.includes(LEGACY_RESET_METHOD), '알 수 없는 reset 구현');
    let optimizedSource = replaceExact(
        source,
        LEGACY_RESET_CALL,
        OPTIMIZED_RESET_CALL,
        2
    );
    optimizedSource = replaceExact(
        optimizedSource,
        LEGACY_RESET_METHOD,
        OPTIMIZED_RESET_METHOD,
        1
    );
    return { legacySource: source, optimizedSource };
}

/**
 * importmap의 util 별칭과 상대 경로를 테스트 모듈 URL로 변환합니다.
 * @param {string} specifier - import 경로입니다.
 * @param {string} parentUrl - 요청 모듈 URL입니다.
 * @returns {string} 해석된 파일 URL입니다.
 */
function resolveModuleUrl(specifier, parentUrl) {
    if (specifier.startsWith('.')) {
        return new URL(specifier, parentUrl).href;
    }
    if (specifier.startsWith('util/')) {
        return pathToFileURL(path.join(SCRIPT_ROOT, 'util', specifier.slice(5))).href;
    }
    throw new Error(`지원하지 않는 테스트 import입니다: ${specifier}`);
}

/**
 * 실제 의존 소스와 지정된 DrawHandler2D 소스를 격리된 VM에서 평가합니다.
 * @param {string} handlerSource - 평가할 DrawHandler2D 소스입니다.
 * @param {string} label - 모듈 식별용 라벨입니다.
 * @returns {Promise<{DrawHandler2D:Function, context:vm.Context}>} 평가 결과입니다.
 */
async function loadHandlerVariant(handlerSource, label) {
    class TracePath2D {
        constructor() {
            this.kind = 'path2d';
        }

        moveTo() {}
        lineTo() {}
        closePath() {}
    }

    const documentStub = {
        createElement(tagName) {
            assert.equal(tagName, 'canvas');
            return {
                getContext(contextType) {
                    assert.equal(contextType, '2d');
                    return {
                        font: '',
                        measureText(text) {
                            return { width: String(text).length * 7 };
                        }
                    };
                }
            };
        }
    };
    const context = vm.createContext({
        console,
        document: documentStub,
        Path2D: TracePath2D
    });
    const moduleCache = new Map();
    const entryUrl = `${HANDLER_URL}?variant=${label}`;

    const getModule = (moduleUrl) => {
        if (!moduleCache.has(moduleUrl)) {
            moduleCache.set(moduleUrl, (async () => {
                const source = moduleUrl === entryUrl
                    ? handlerSource
                    : await readFile(fileURLToPath(moduleUrl), 'utf8');
                return new vm.SourceTextModule(source, {
                    context,
                    identifier: moduleUrl,
                    initializeImportMeta(meta) {
                        meta.url = moduleUrl;
                    }
                });
            })());
        }
        return moduleCache.get(moduleUrl);
    };

    const entryModule = await getModule(entryUrl);
    await entryModule.link((specifier, referencingModule) => {
        return getModule(resolveModuleUrl(specifier, referencingModule.identifier));
    });
    await entryModule.evaluate();
    return {
        DrawHandler2D: entryModule.namespace.DrawHandler2D,
        context
    };
}

/**
 * VM 간 객체 identity 차이를 제거한 trace 값을 반환합니다.
 * @param {*} value - 기록할 값입니다.
 * @returns {*} 정규화된 값입니다.
 */
function normalizeTraceValue(value) {
    if (value && value.kind === 'gradient') {
        return {
            kind: 'gradient',
            coordinates: [...value.coordinates],
            stops: value.stops.map((stop) => [...stop])
        };
    }
    if (value && value.kind === 'path2d') {
        return { kind: 'path2d' };
    }
    if (value && value.kind === 'image') {
        return { kind: 'image' };
    }
    return value;
}

/**
 * 모든 Canvas 접근 순서와 현재 그리기 상태를 기록하는 컨텍스트를 생성합니다.
 * @param {string} label - 레이어 라벨입니다.
 * @param {object} [options={}] - 컨텍스트 옵션입니다.
 * @param {boolean} [options.hasResetTransform=true] - resetTransform 제공 여부입니다.
 * @param {Array<object>} [options.trace=[]] - 공유 trace입니다.
 * @returns {object} 추적 컨텍스트입니다.
 */
function createTraceContext(label, options = {}) {
    const trace = options.trace || [];
    const state = { ...DEFAULT_CONTEXT_STATE };
    const controller = {
        eventIndex: 0,
        throwAt: -1,
        throwValue: null,
        hookAt: -1,
        hook: null
    };
    const context = {};

    const record = (operation, args = []) => {
        const eventIndex = controller.eventIndex;
        controller.eventIndex += 1;
        trace.push({
            layer: label,
            operation,
            args: args.map(normalizeTraceValue)
        });
        if (eventIndex === controller.hookAt && controller.hook) {
            const hook = controller.hook;
            controller.hookAt = -1;
            controller.hook = null;
            hook({ context, eventIndex, operation });
        }
        if (eventIndex === controller.throwAt) {
            throw controller.throwValue;
        }
    };

    const makeMethodGetter = (name, implementation) => () => {
        record(`get:${name}`);
        return function traceMethod(...args) {
            record(`call:${name}`, [...args, this === context]);
            return implementation?.(...args);
        };
    };

    Object.defineProperty(context, 'resetTransform', {
        configurable: true,
        get: options.hasResetTransform === false
            ? () => {
                record('get:resetTransform');
                return undefined;
            }
            : makeMethodGetter('resetTransform')
    });
    Object.defineProperty(context, 'setTransform', {
        configurable: true,
        get: makeMethodGetter('setTransform')
    });
    Object.defineProperty(context, 'clearRect', {
        configurable: true,
        get: makeMethodGetter('clearRect')
    });

    const canvas = {};
    Object.defineProperty(canvas, 'width', {
        configurable: true,
        get() {
            record('get:canvas.width');
            return 640;
        }
    });
    Object.defineProperty(canvas, 'height', {
        configurable: true,
        get() {
            record('get:canvas.height');
            return 360;
        }
    });
    Object.defineProperty(context, 'canvas', {
        configurable: true,
        get() {
            record('get:canvas');
            return canvas;
        }
    });

    for (const propertyName of Object.keys(DEFAULT_CONTEXT_STATE)) {
        Object.defineProperty(context, propertyName, {
            configurable: true,
            get() {
                return state[propertyName];
            },
            set(value) {
                record(`set:${propertyName}`, [value]);
                state[propertyName] = value;
            }
        });
    }

    const simpleMethods = [
        'beginPath',
        'roundRect',
        'strokeRect',
        'arc',
        'moveTo',
        'lineTo',
        'drawImage',
        'save',
        'translate',
        'rotate',
        'scale',
        'restore'
    ];
    for (const methodName of simpleMethods) {
        context[methodName] = (...args) => record(`call:${methodName}`, args);
    }
    context.fill = (...args) => record('call:fill', args);
    context.stroke = (...args) => record('call:stroke', args);
    context.fillRect = (...args) => record('call:fillRect', [...args, state.fillStyle]);
    context.fillText = (...args) => record('call:fillText', [...args, state.fillStyle]);
    context.createLinearGradient = (...coordinates) => {
        record('call:createLinearGradient', coordinates);
        const gradient = {
            kind: 'gradient',
            coordinates,
            stops: [],
            addColorStop(offset, color) {
                record('call:addColorStop', [offset, color]);
                this.stops.push([offset, color]);
            }
        };
        return gradient;
    };

    Object.defineProperties(context, {
        __controller: { value: controller },
        __record: { value: record },
        __resetTrace: {
            value() {
                trace.length = 0;
                controller.eventIndex = 0;
                controller.throwAt = -1;
                controller.throwValue = null;
                controller.hookAt = -1;
                controller.hook = null;
            }
        },
        __snapshot: {
            value() {
                return Object.fromEntries(
                    Object.entries(state).map(([propertyName, value]) => [
                        propertyName,
                        normalizeTraceValue(value)
                    ])
                );
            }
        },
        __trace: { value: trace }
    });
    return context;
}

/**
 * 테스트 레이어를 등록하고 초기 transform trace를 제거합니다.
 * @param {Function} DrawHandler2D - 테스트할 클래스입니다.
 * @param {object} [options={}] - 레이어 옵션입니다.
 * @returns {{handler:object, context:object, trace:Array<object>}} 하네스입니다.
 */
function createSingleLayerHarness(DrawHandler2D, options = {}) {
    const trace = [];
    const context = createTraceContext('main', {
        trace,
        hasResetTransform: options.hasResetTransform
    });
    const handler = new DrawHandler2D();
    handler.registerLayer('main', context, {
        persistent: options.persistent,
        transformScaleX: options.transformScaleX ?? 1.5,
        transformScaleY: options.transformScaleY ?? 0.75,
        onDraw() {
            context.__record('callback:onDraw');
        },
        onFrameClear() {
            context.__record('callback:onFrameClear');
        }
    });
    context.__resetTrace();
    return { handler, context, trace };
}

const { legacySource, optimizedSource } = createSourceVariants(HANDLER_SOURCE);
const legacyVariant = await loadHandlerVariant(legacySource, 'legacy');
const optimizedVariant = await loadHandlerVariant(optimizedSource, 'optimized');

test('생산 clear hot path는 옵션 객체와 죽은 transform 분기를 제거한다', () => {
    assert.equal(HANDLER_SOURCE.split(OPTIMIZED_RESET_CALL).length - 1, 2);
    assert.equal(HANDLER_SOURCE.includes(LEGACY_RESET_CALL), false);
    assert.equal(HANDLER_SOURCE.includes('applyTransform'), false);
    assert.ok(HANDLER_SOURCE.includes(OPTIMIZED_RESET_METHOD));
    assert.equal(
        HANDLER_SOURCE.split('this.#stateCaches.set(layerName, {});').length - 1,
        3,
        '렌더 재진입 격리에 필요한 fresh cache 교체를 유지해야 합니다.'
    );
});

test('clear는 resetTransform과 fallback 경로에서 독립 oracle 순서를 보존한다', () => {
    for (const hasResetTransform of [true, false]) {
        const run = (DrawHandler2D) => {
            const harness = createSingleLayerHarness(DrawHandler2D, { hasResetTransform });
            harness.handler.clear('main');
            return harness.trace;
        };
        const legacyTrace = run(legacyVariant.DrawHandler2D);
        const optimizedTrace = run(optimizedVariant.DrawHandler2D);
        assert.deepEqual(optimizedTrace, legacyTrace);

        const expectedOperations = hasResetTransform
            ? ['get:resetTransform', 'get:resetTransform', 'call:resetTransform']
            : [
                'get:resetTransform',
                'get:setTransform',
                'get:setTransform',
                'call:setTransform'
            ];
        expectedOperations.push(
            ...RESET_STYLE_PROPERTIES.map((propertyName) => `set:${propertyName}`),
            'get:clearRect',
            'get:canvas',
            'get:canvas.width',
            'get:canvas',
            'get:canvas.height',
            'call:clearRect',
            'get:setTransform',
            'get:setTransform',
            'call:setTransform',
            'callback:onFrameClear'
        );
        assert.deepEqual(
            optimizedTrace.map((event) => event.operation),
            expectedOperations
        );
        const clearCall = optimizedTrace.find((event) => event.operation === 'call:clearRect');
        assert.deepEqual(clearCall.args, [0, 0, 640, 360, true]);
        const transformCalls = optimizedTrace.filter(
            (event) => event.operation === 'call:setTransform'
        );
        assert.deepEqual(
            transformCalls.at(-1).args,
            [1.5, 0, 0, 0.75, 0, 0, true]
        );
    }
});

test('clear 뒤 동일 text 스타일은 11개 캐시 필드를 모두 다시 적용한다', () => {
    const style = {
        shape: 'text',
        text: 'cache reset',
        x: 10,
        y: 20,
        fill: '#eeddcc',
        stroke: '#123456',
        alpha: 0.375,
        lineWidth: 3,
        lineCap: 'round',
        lineJoin: 'bevel',
        shadowBlur: 8,
        shadowColor: '#abcdef',
        font: '700 19px sans-serif',
        align: 'center',
        baseline: 'middle'
    };
    const run = (DrawHandler2D) => {
        const harness = createSingleLayerHarness(DrawHandler2D);
        harness.handler.render('main', style);
        harness.context.__resetTrace();
        harness.handler.clear('main');
        harness.context.__resetTrace();
        harness.handler.render('main', style);
        return {
            trace: harness.trace,
            state: harness.context.__snapshot()
        };
    };
    const legacyResult = run(legacyVariant.DrawHandler2D);
    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    const reappliedProperties = optimizedResult.trace
        .filter((event) => event.operation.startsWith('set:'))
        .map((event) => event.operation.slice(4));
    assert.deepEqual(reappliedProperties, DRAW_STYLE_PROPERTIES);
});

test('clearAll은 persistent skip과 live Map iterator 변경을 보존한다', () => {
    const run = (DrawHandler2D) => {
        const trace = [];
        const handler = new DrawHandler2D();
        const first = createTraceContext('first', { trace });
        const skipped = createTraceContext('skipped', { trace });
        const removed = createTraceContext('removed', { trace });
        const added = createTraceContext('added', { trace });
        handler.registerLayer('first', first, {
            onFrameClear() {
                first.__record('callback:onFrameClear');
                handler.unregisterLayer('removed');
                handler.registerLayer('added', added, {
                    transformScaleX: 2,
                    transformScaleY: 3,
                    onFrameClear() {
                        added.__record('callback:onFrameClear');
                    }
                });
            }
        });
        handler.registerLayer('skipped', skipped, { persistent: true });
        handler.registerLayer('removed', removed);
        trace.length = 0;
        for (const context of [first, skipped, removed, added]) {
            context.__controller.eventIndex = 0;
        }
        handler.clearAll();
        return trace;
    };
    const legacyTrace = run(legacyVariant.DrawHandler2D);
    const optimizedTrace = run(optimizedVariant.DrawHandler2D);
    assert.deepEqual(optimizedTrace, legacyTrace);
    assert.equal(optimizedTrace.some((event) => event.layer === 'skipped'), false);
    assert.equal(optimizedTrace.some((event) => event.layer === 'removed'), false);
    assert.ok(optimizedTrace.some((event) => event.layer === 'added'));
    assert.deepEqual(
        optimizedTrace
            .filter((event) => event.operation === 'callback:onFrameClear')
            .map((event) => event.layer),
        ['first', 'added']
    );
});

test('clearAll의 첫 레이어 예외는 뒤 레이어를 건드리지 않고 즉시 중단한다', () => {
    const token = new Error('first layer reset failure');
    const run = (DrawHandler2D) => {
        const trace = [];
        const handler = new DrawHandler2D();
        const first = createTraceContext('first', { trace });
        const second = createTraceContext('second', { trace });
        handler.registerLayer('first', first);
        handler.registerLayer('second', second);
        trace.length = 0;
        first.__controller.eventIndex = 0;
        second.__controller.eventIndex = 0;
        first.__controller.throwAt = 4;
        first.__controller.throwValue = token;
        let thrown = null;
        try {
            handler.clearAll();
        } catch (error) {
            thrown = error;
        }
        first.__controller.throwAt = -1;
        first.__controller.throwValue = null;
        trace.push({ layer: 'test', operation: 'separator', args: [] });
        handler.render('first', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            fill: '#111'
        });
        return {
            trace,
            firstState: first.__snapshot(),
            secondState: second.__snapshot(),
            threwToken: thrown === token
        };
    };
    const legacyResult = run(legacyVariant.DrawHandler2D);
    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    assert.equal(optimizedResult.threwToken, true);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.equal(
        optimizedResult.trace.some((event) => event.layer === 'second'),
        false
    );
});

/**
 * clear의 지정 trace 위치에 예외를 주입하고 후속 render 상태까지 반환합니다.
 * @param {Function} DrawHandler2D - 테스트할 클래스입니다.
 * @param {boolean} hasResetTransform - resetTransform 경로 여부입니다.
 * @param {number} throwAt - 예외 trace 인덱스입니다.
 * @param {Error} token - 던질 토큰입니다.
 * @returns {object} 예외와 후속 상태입니다.
 */
function runClearExceptionScenario(DrawHandler2D, hasResetTransform, throwAt, token) {
    const harness = createSingleLayerHarness(DrawHandler2D, { hasResetTransform });
    const style = {
        shape: 'text',
        text: 'exception cache',
        x: 1,
        y: 2,
        fill: '#f00',
        stroke: '#0f0',
        alpha: 0.25,
        lineWidth: 4,
        lineCap: 'round',
        lineJoin: 'bevel',
        shadowBlur: 5,
        shadowColor: '#00f',
        font: '20px serif',
        align: 'right',
        baseline: 'top'
    };
    harness.handler.render('main', style);
    harness.context.__resetTrace();
    harness.context.__controller.throwAt = throwAt;
    harness.context.__controller.throwValue = token;
    let thrown = null;
    try {
        harness.handler.clear('main');
    } catch (error) {
        thrown = error;
    }
    const clearEventCount = harness.context.__controller.eventIndex;
    harness.context.__controller.throwAt = -1;
    harness.trace.push({ layer: 'test', operation: 'separator', args: [] });
    harness.handler.render('main', style);
    return {
        trace: harness.trace,
        state: harness.context.__snapshot(),
        threwToken: thrown === token,
        clearEventCount
    };
}

test('clear의 모든 관찰 지점 예외는 부분 상태와 캐시 시점을 exact 보존한다', () => {
    for (const hasResetTransform of [true, false]) {
        const baselineToken = new Error('baseline-not-thrown');
        const baseline = runClearExceptionScenario(
            optimizedVariant.DrawHandler2D,
            hasResetTransform,
            -1,
            baselineToken
        );
        for (let throwAt = 0; throwAt < baseline.clearEventCount; throwAt += 1) {
            const token = new Error(`clear throw ${hasResetTransform}:${throwAt}`);
            const legacyResult = runClearExceptionScenario(
                legacyVariant.DrawHandler2D,
                hasResetTransform,
                throwAt,
                token
            );
            const optimizedResult = runClearExceptionScenario(
                optimizedVariant.DrawHandler2D,
                hasResetTransform,
                throwAt,
                token
            );
            assert.equal(legacyResult.threwToken, true);
            assert.equal(optimizedResult.threwToken, true);
            assert.deepEqual(
                optimizedResult,
                legacyResult,
                `clear 예외 위치 ${hasResetTransform}:${throwAt}`
            );
        }
    }
});

test('reset setter의 unregister/re-register 재진입은 현재 레이어 맵 계약을 보존한다', () => {
    const run = (DrawHandler2D) => {
        const trace = [];
        const handler = new DrawHandler2D();
        const primary = createTraceContext('primary', { trace });
        const replacement = createTraceContext('replacement', { trace });
        handler.registerLayer('main', primary, {
            transformScaleX: 1.25,
            transformScaleY: 1.5
        });
        primary.__resetTrace();
        const probe = createSingleLayerHarness(DrawHandler2D);
        probe.handler.clear('main');
        const globalAlphaIndex = probe.trace.findIndex(
            (event) => event.operation === 'set:globalAlpha'
        );
        primary.__controller.hookAt = globalAlphaIndex;
        primary.__controller.hook = () => {
            handler.unregisterLayer('main');
            handler.registerLayer('main', replacement, {
                transformScaleX: 2,
                transformScaleY: 3,
                onDraw() {
                    replacement.__record('callback:onDraw');
                },
                onFrameClear() {
                    replacement.__record('callback:onFrameClear');
                }
            });
            handler.render('main', {
                shape: 'rect',
                x: 0,
                y: 0,
                w: 4,
                h: 5,
                fill: '#123'
            });
        };
        handler.clear('main');
        handler.render('main', {
            shape: 'rect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            fill: '#456'
        });
        return {
            trace,
            primaryState: primary.__snapshot(),
            replacementState: replacement.__snapshot()
        };
    };
    assert.deepEqual(
        run(optimizedVariant.DrawHandler2D),
        run(legacyVariant.DrawHandler2D)
    );
});

test('fresh cache 교체는 clear 재진입 중인 render의 후속 쓰기를 격리한다', () => {
    const run = (DrawHandler2D) => {
        const harness = createSingleLayerHarness(DrawHandler2D);
        let shouldReenter = true;
        const reentrantStyle = {
            shape: 'rect',
            x: 0,
            y: 0,
            w: 20,
            h: 10,
            get fill() {
                if (shouldReenter) {
                    shouldReenter = false;
                    harness.handler.clear('main');
                }
                return '#ff0000';
            }
        };
        harness.handler.render('main', reentrantStyle);
        harness.context.fillStyle = '#0000ff';
        harness.context.__resetTrace();
        harness.handler.render('main', {
            shape: 'rect',
            x: 0,
            y: 0,
            w: 20,
            h: 10,
            fill: '#ff0000'
        });
        return {
            trace: harness.trace,
            state: harness.context.__snapshot()
        };
    };
    const legacyResult = run(legacyVariant.DrawHandler2D);
    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.ok(optimizedResult.trace.some(
        (event) => event.operation === 'set:fillStyle' && event.args[0] === '#ff0000'
    ));
    const drawCall = optimizedResult.trace.find(
        (event) => event.operation === 'call:fillRect'
    );
    assert.equal(drawCall.args.at(-1), '#ff0000');
});

/**
 * xorshift32 결정적 난수를 반환합니다.
 * @param {number} seed - 초기 seed입니다.
 * @returns {() => number} uint32 생성기입니다.
 */
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
}

test('50,000개 결정적 mixed layer 명령은 trace와 최종 상태가 exact 일치한다', () => {
    const layerNames = ['alpha', 'beta', 'gamma', 'delta'];
    const legacyTrace = [];
    const optimizedTrace = [];
    const legacyHandler = new legacyVariant.DrawHandler2D();
    const optimizedHandler = new optimizedVariant.DrawHandler2D();
    const legacyContexts = new Map(layerNames.map((layerName, index) => [
        layerName,
        createTraceContext(`${index}:${layerName}`, {
            trace: legacyTrace,
            hasResetTransform: index % 2 === 0
        })
    ]));
    const optimizedContexts = new Map(layerNames.map((layerName, index) => [
        layerName,
        createTraceContext(`${index}:${layerName}`, {
            trace: optimizedTrace,
            hasResetTransform: index % 2 === 0
        })
    ]));
    const registered = new Set();
    const random = createRandom(0x0719d2d);
    const image = { kind: 'image' };

    const register = (handler, contexts, layerName, persistent, scaleX, scaleY) => {
        const context = contexts.get(layerName);
        handler.registerLayer(layerName, context, {
            persistent,
            transformScaleX: scaleX,
            transformScaleY: scaleY,
            onDraw() {
                context.__record('callback:onDraw');
            },
            onFrameClear() {
                context.__record('callback:onFrameClear');
            }
        });
    };

    for (let commandIndex = 0; commandIndex < 50_000; commandIndex += 1) {
        legacyTrace.length = 0;
        optimizedTrace.length = 0;
        for (const context of legacyContexts.values()) {
            context.__controller.eventIndex = 0;
        }
        for (const context of optimizedContexts.values()) {
            context.__controller.eventIndex = 0;
        }

        const randomValue = random();
        const layerName = layerNames[randomValue & 3];
        const operation = (randomValue >>> 2) % 10;
        if (operation === 0) {
            const persistent = ((randomValue >>> 7) & 1) === 1;
            const scaleX = ((randomValue >>> 8) % 7 + 1) / 3;
            const scaleY = ((randomValue >>> 12) % 9 + 1) / 4;
            register(legacyHandler, legacyContexts, layerName, persistent, scaleX, scaleY);
            register(optimizedHandler, optimizedContexts, layerName, persistent, scaleX, scaleY);
            registered.add(layerName);
        } else if (operation === 1) {
            legacyHandler.unregisterLayer(layerName);
            optimizedHandler.unregisterLayer(layerName);
            registered.delete(layerName);
        } else if (operation === 2) {
            const scaleX = ((randomValue >>> 9) % 11 - 2) / 3;
            const scaleY = ((randomValue >>> 15) % 13 - 3) / 5;
            legacyHandler.setLayerTransform(layerName, scaleX, scaleY);
            optimizedHandler.setLayerTransform(layerName, scaleX, scaleY);
        } else if (operation === 3) {
            legacyHandler.shadowOn(layerName, (randomValue >>> 11) % 20, `#${randomValue.toString(16)}`);
            optimizedHandler.shadowOn(layerName, (randomValue >>> 11) % 20, `#${randomValue.toString(16)}`);
        } else if (operation === 4) {
            legacyHandler.shadowOff(layerName);
            optimizedHandler.shadowOff(layerName);
        } else if (operation === 5) {
            legacyHandler.clear(layerName);
            optimizedHandler.clear(layerName);
        } else if (operation === 6) {
            legacyHandler.clearAll();
            optimizedHandler.clearAll();
        } else {
            const shapeSelector = (randomValue >>> 6) % 7;
            const shape = ['rect', 'roundRect', 'circle', 'line', 'image', 'text', 'arrow'][shapeSelector];
            const fill = (randomValue & 0x80) === 0
                ? `#${(randomValue & 0xffffff).toString(16).padStart(6, '0')}`
                : {
                    type: 'linear',
                    x1: 0,
                    y1: 0,
                    x2: 10,
                    y2: 10,
                    stops: [
                        { offset: 0, color: '#000' },
                        { offset: 1, color: '#fff' }
                    ]
                };
            const drawOptions = {
                shape,
                x: (randomValue >>> 8) % 100,
                y: (randomValue >>> 15) % 100,
                w: (randomValue >>> 4) % 50 + 1,
                h: (randomValue >>> 10) % 50 + 1,
                x1: 1,
                y1: 2,
                x2: 30,
                y2: 40,
                radius: (randomValue >>> 18) % 20,
                rotation: (randomValue >>> 20) % 360,
                text: `frame-${commandIndex}`,
                image,
                fill,
                stroke: (randomValue & 0x100) === 0 ? '#abcdef' : false,
                alpha: ((randomValue >>> 16) & 0xff) / 255,
                lineWidth: (randomValue >>> 24) % 5 + 1,
                lineCap: (randomValue & 0x200) === 0 ? 'round' : 'butt',
                lineJoin: (randomValue & 0x400) === 0 ? 'bevel' : 'miter',
                font: `${12 + (randomValue % 8)}px sans-serif`,
                align: (randomValue & 0x800) === 0 ? 'left' : 'center',
                baseline: (randomValue & 0x1000) === 0 ? 'top' : 'alphabetic'
            };
            legacyHandler.render(layerName, drawOptions);
            optimizedHandler.render(layerName, drawOptions);
        }

        assert.deepEqual(
            optimizedTrace,
            legacyTrace,
            `mixed 명령 ${commandIndex}, 등록=${[...registered].join(',')}`
        );
        for (const currentLayerName of layerNames) {
            assert.deepEqual(
                optimizedContexts.get(currentLayerName).__snapshot(),
                legacyContexts.get(currentLayerName).__snapshot(),
                `mixed 상태 ${commandIndex}:${currentLayerName}`
            );
        }
    }
});
