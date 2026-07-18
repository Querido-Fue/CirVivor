import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAME_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT_ROOT = path.join(GAME_ROOT, 'script');
const HANDLER_PATH = path.join(
    SCRIPT_ROOT,
    'module',
    'display',
    '_draw_handler_2d.js'
);
const HANDLER_URL = pathToFileURL(HANDLER_PATH).href;
const HANDLER_SOURCE = await readFile(HANDLER_PATH, 'utf8');

const IMPORT_ANCHOR = "} from './draw_2d_layer_state.js';";
const DEFAULT_SHADOW_CALL = 'createDrawShadowState()';
const DEFAULT_SHADOW_REFERENCE = 'DEFAULT_DRAW_SHADOW_STATE';
const DEFAULT_SHADOW_DECLARATION =
    '/** 모듈 내부에서 공유하는 기본 지속 그림자 상태입니다. */\n' +
    `const ${DEFAULT_SHADOW_REFERENCE} = ${DEFAULT_SHADOW_CALL};`;

const DEFAULT_REFERENCE_SITES = Object.freeze([
    `this.#shadowState.set(layerName, ${DEFAULT_SHADOW_REFERENCE});`,
    `this.#shadowState.get(layerName) || ${DEFAULT_SHADOW_REFERENCE}`
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
    assert.equal(count, expectedCount, `예상하지 못한 소스 구조 변경: ${from}`);
    return source.split(from).join(to);
}

/**
 * 현재 생산 소스에서 호출별 할당 legacy와 singleton 후보를 생성합니다.
 * @param {string} source - 현재 생산 소스입니다.
 * @returns {{legacySource:string, optimizedSource:string}} 비교 소스 쌍입니다.
 */
function createSourceVariants(source) {
    if (source.includes(DEFAULT_SHADOW_DECLARATION)) {
        let legacySource = replaceExact(
            source,
            `${DEFAULT_SHADOW_DECLARATION}\n\n`,
            '',
            1
        );
        legacySource = replaceExact(
            legacySource,
            DEFAULT_SHADOW_REFERENCE,
            DEFAULT_SHADOW_CALL,
            3
        );
        return { legacySource, optimizedSource: source };
    }

    let optimizedSource = replaceExact(
        source,
        DEFAULT_SHADOW_CALL,
        DEFAULT_SHADOW_REFERENCE,
        3
    );
    optimizedSource = replaceExact(
        optimizedSource,
        IMPORT_ANCHOR,
        `${IMPORT_ANCHOR}\n\n${DEFAULT_SHADOW_DECLARATION}`,
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
 * 실제 의존 소스와 지정된 handler 소스를 격리된 VM에서 평가합니다.
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
    const entryUrl = `${HANDLER_URL}?shadow-variant=${label}`;

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
 * VM 간 identity 차이를 제거한 trace 값을 반환합니다.
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
 * Canvas 접근 순서와 최종 스타일을 추적하는 컨텍스트를 생성합니다.
 * @param {string} label - 레이어 라벨입니다.
 * @param {Array<object>} trace - 공유 trace입니다.
 * @returns {object} 추적 컨텍스트입니다.
 */
function createTraceContext(label, trace) {
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

    for (const methodName of [
        'resetTransform',
        'setTransform',
        'clearRect',
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
        'restore',
        'fill',
        'stroke',
        'fillRect',
        'fillText'
    ]) {
        Object.defineProperty(context, methodName, {
            configurable: true,
            get: makeMethodGetter(methodName)
        });
    }

    Object.defineProperty(context, 'createLinearGradient', {
        configurable: true,
        get: makeMethodGetter('createLinearGradient', (...coordinates) => {
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
        })
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
        }
    });
    return context;
}

/**
 * 레이어를 등록하고 초기 transform trace를 제거합니다.
 * @param {Function} DrawHandler2D - 테스트할 클래스입니다.
 * @param {string} [layerName='main'] - 레이어 이름입니다.
 * @returns {{handler:object, context:object, trace:Array<object>}} 하네스입니다.
 */
function createHarness(DrawHandler2D, layerName = 'main') {
    const trace = [];
    const context = createTraceContext(layerName, trace);
    const handler = new DrawHandler2D();
    handler.registerLayer(layerName, context, {
        transformScaleX: 1.5,
        transformScaleY: 0.75,
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

/**
 * 모든 shape와 스타일 분기를 포함하는 렌더 옵션을 반환합니다.
 * @returns {Array<object>} 렌더 옵션 목록입니다.
 */
function createShapeOptions() {
    const gradient = {
        type: 'linear',
        x1: -3,
        y1: 5,
        x2: 21,
        y2: 34,
        stops: [
            { offset: 0, color: '#000000' },
            { offset: 0.375, color: '#abcdef' },
            { offset: 1, color: '#ffffff' }
        ]
    };
    const common = {
        x: 11,
        y: 13,
        w: 29,
        h: 31,
        x1: -7,
        y1: 9,
        x2: 23,
        y2: -17,
        radius: 8,
        fill: gradient,
        stroke: '#123456',
        alpha: 0.625,
        lineWidth: 3,
        lineCap: 'round',
        lineJoin: 'bevel'
    };
    return [
        { ...common, shape: 'rect' },
        { ...common, shape: 'rect', fill: false },
        { ...common, shape: 'roundRect' },
        { ...common, shape: 'roundRect', fill: false, radius: -5 },
        { ...common, shape: 'circle' },
        { ...common, shape: 'circle', fill: false },
        { ...common, shape: 'line' },
        { ...common, shape: 'image', image: { kind: 'image' } },
        {
            ...common,
            shape: 'text',
            text: 'shadow parity',
            font: '700 19px sans-serif',
            align: 'center',
            baseline: 'middle'
        },
        {
            ...common,
            shape: 'text',
            text: 'rotated',
            rotation: -37,
            font: 'italic 17px serif',
            align: 'right',
            baseline: 'top'
        },
        { ...common, shape: 'arrow', rotation: 123 },
        { ...common, shape: 'arrow', rotation: 0, fill: false },
        { ...common, shape: 'unknown' },
        { ...common, shape: undefined }
    ];
}

/**
 * draw options의 own data property를 동일 값을 반환하는 관찰 getter로 감쌉니다.
 * gradient와 color stop도 재귀적으로 감싸되 Canvas 인수 정규화용 kind 객체는
 * trace 기록 중 재진입을 만들지 않도록 원본을 유지합니다.
 * @param {*} value - 관찰할 값입니다.
 * @param {string} pathLabel - trace에 기록할 속성 경로입니다.
 * @param {object} context - trace 컨텍스트입니다.
 * @param {WeakMap<object, object>} [observedValues=new WeakMap()] - 순환 참조 캐시입니다.
 * @returns {*} 관찰 getter로 감싼 값입니다.
 */
function createGetterObservedValue(
    value,
    pathLabel,
    context,
    observedValues = new WeakMap()
) {
    if (!value || typeof value !== 'object' || value.kind) {
        return value;
    }
    if (observedValues.has(value)) {
        return observedValues.get(value);
    }

    if (Array.isArray(value)) {
        const observedArray = [];
        observedValues.set(value, observedArray);
        for (const [index, item] of value.entries()) {
            observedArray.push(createGetterObservedValue(
                item,
                `${pathLabel}.${index}`,
                context,
                observedValues
            ));
        }
        return observedArray;
    }

    const observedObject = {};
    observedValues.set(value, observedObject);
    for (const propertyName of Reflect.ownKeys(value)) {
        const propertyValue = createGetterObservedValue(
            value[propertyName],
            `${pathLabel}.${String(propertyName)}`,
            context,
            observedValues
        );
        Object.defineProperty(observedObject, propertyName, {
            configurable: true,
            enumerable: true,
            get() {
                context.__record(`get:${pathLabel}.${String(propertyName)}`);
                return propertyValue;
            }
        });
    }
    if (pathLabel === 'options') {
        for (const optionalPropertyName of ['shadowBlur', 'shadowColor']) {
            if (Object.hasOwn(value, optionalPropertyName)) {
                continue;
            }
            Object.defineProperty(observedObject, optionalPropertyName, {
                configurable: true,
                enumerable: false,
                get() {
                    context.__record(`get:${pathLabel}.${optionalPropertyName}`);
                    return undefined;
                }
            });
        }
    }
    return observedObject;
}

const { legacySource, optimizedSource } = createSourceVariants(HANDLER_SOURCE);
const legacyVariant = await loadHandlerVariant(legacySource, 'legacy');
const optimizedVariant = await loadHandlerVariant(optimizedSource, 'optimized');

test('생산 handler는 기본 그림자 객체를 세 경로에서 재사용한다', () => {
    assert.ok(HANDLER_SOURCE.includes(DEFAULT_SHADOW_DECLARATION));
    assert.equal(
        HANDLER_SOURCE.split(DEFAULT_SHADOW_CALL).length - 1,
        1,
        '기본 그림자 생성은 모듈 평가 시 한 번이어야 합니다.'
    );
    assert.equal(
        HANDLER_SOURCE.split(DEFAULT_SHADOW_REFERENCE).length - 1,
        4,
        '선언 1회와 register/shadowOff/render 기본 경로 3회만 참조해야 합니다.'
    );
    assert.equal(
        HANDLER_SOURCE.includes(`Object.freeze(${DEFAULT_SHADOW_CALL})`),
        false,
        '변조 가능한 전역 Object.freeze 호출을 새 관찰 지점으로 만들지 않습니다.'
    );
    assert.equal(
        HANDLER_SOURCE.split(DEFAULT_REFERENCE_SITES[0]).length - 1,
        2
    );
    assert.equal(
        HANDLER_SOURCE.split(DEFAULT_REFERENCE_SITES[1]).length - 1,
        1
    );
});

test('등록·shadowOn/off·재등록과 모든 shape의 trace 및 상태가 exact 일치한다', () => {
    const run = (DrawHandler2D) => {
        const harness = createHarness(DrawHandler2D);
        for (const options of createShapeOptions()) {
            harness.handler.render('main', options);
        }
        harness.handler.shadowOn('main', 17, '#fedcba');
        harness.handler.render('main', {
            shape: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#111111'
        });
        harness.handler.render('main', {
            shape: 'rect', x: 2, y: 3, w: 4, h: 5, fill: '#222222',
            shadowBlur: -0, shadowColor: ''
        });
        harness.handler.shadowOff('main');
        harness.handler.shadowOff('main');
        harness.handler.render('main', {
            shape: 'text', text: 'default again', x: 7, y: 8, fill: '#333333'
        });
        harness.handler.clear('main');
        harness.handler.render('main', {
            shape: 'circle', x: 9, y: 10, radius: 11, fill: '#444444'
        });
        harness.handler.unregisterLayer('missing');
        harness.handler.shadowOff('missing');
        harness.handler.shadowOn('missing', 1, '#fff');
        harness.handler.render('missing', { shape: 'rect' });
        harness.handler.render('main', null);
        harness.handler.unregisterLayer('main');
        harness.handler.registerLayer('main', harness.context, {
            transformScaleX: 2,
            transformScaleY: 3,
            onDraw() {
                harness.context.__record('callback:replacement:onDraw');
            }
        });
        harness.handler.render('main', {
            shape: 'rect', x: 0, y: 0, w: 1, h: 1, fill: '#555555'
        });
        return {
            trace: harness.trace,
            state: harness.context.__snapshot(),
            measure: harness.handler.measureText('abc', '12px sans-serif')
        };
    };

    const legacyResult = run(legacyVariant.DrawHandler2D);
    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.equal(optimizedResult.state.shadowBlur, 0);
    assert.equal(optimizedResult.state.shadowColor, 'rgba(0,0,0,0)');
    assert.ok(optimizedResult.trace.some(
        (event) => event.operation === 'set:shadowBlur' && event.args[0] === 17
    ));
});

/**
 * 지정 shape 렌더의 한 관찰 지점에 예외를 주입합니다.
 * @param {Function} DrawHandler2D - 테스트할 클래스입니다.
 * @param {object} drawOptions - 렌더 옵션입니다.
 * @param {number} throwAt - 예외 trace 인덱스입니다.
 * @param {Error} token - 던질 토큰입니다.
 * @returns {object} 예외 이후 trace와 상태입니다.
 */
function runRenderExceptionScenario(DrawHandler2D, drawOptions, throwAt, token) {
    const harness = createHarness(DrawHandler2D);
    harness.handler.shadowOn('main', 9, '#aa00bb');
    harness.handler.shadowOff('main');
    harness.context.__controller.throwAt = throwAt;
    harness.context.__controller.throwValue = token;
    const observedOptions = createGetterObservedValue(
        drawOptions,
        'options',
        harness.context
    );
    let thrown = null;
    try {
        harness.handler.render('main', observedOptions);
    } catch (error) {
        thrown = error;
    }
    const eventCount = harness.context.__controller.eventIndex;
    harness.context.__controller.throwAt = -1;
    harness.context.__controller.throwValue = null;
    harness.trace.push({ layer: 'test', operation: 'separator', args: [] });
    harness.handler.shadowOff('main');
    harness.handler.render('main', {
        shape: 'rect', x: 0, y: 0, w: 2, h: 3, fill: '#010203'
    });
    return {
        trace: harness.trace,
        state: harness.context.__snapshot(),
        threwToken: thrown === token,
        eventCount
    };
}

test('모든 shape의 사용자 getter와 Canvas 관찰 지점 예외가 부분 캐시를 보존한다', () => {
    const observedGetterOperations = new Set();
    for (const [shapeIndex, drawOptions] of createShapeOptions().entries()) {
        const baseline = runRenderExceptionScenario(
            optimizedVariant.DrawHandler2D,
            drawOptions,
            -1,
            new Error('baseline')
        );
        for (const event of baseline.trace) {
            if (event.operation.startsWith('get:options.')) {
                observedGetterOperations.add(event.operation);
            }
        }
        for (let throwAt = 0; throwAt < baseline.eventCount; throwAt += 1) {
            const token = new Error(`shape ${shapeIndex}, event ${throwAt}`);
            const legacyResult = runRenderExceptionScenario(
                legacyVariant.DrawHandler2D,
                drawOptions,
                throwAt,
                token
            );
            const optimizedResult = runRenderExceptionScenario(
                optimizedVariant.DrawHandler2D,
                drawOptions,
                throwAt,
                token
            );
            assert.equal(legacyResult.threwToken, true);
            assert.equal(optimizedResult.threwToken, true);
            assert.deepEqual(
                optimizedResult,
                legacyResult,
                `shape ${shapeIndex}, 예외 위치 ${throwAt}`
            );
        }
    }

    for (const propertyPath of [
        'fill',
        'fill.type',
        'fill.x1',
        'fill.y1',
        'fill.x2',
        'fill.y2',
        'fill.stops',
        'fill.stops.0.offset',
        'fill.stops.0.color',
        'stroke',
        'alpha',
        'lineWidth',
        'lineCap',
        'lineJoin',
        'shadowBlur',
        'shadowColor',
        'shape',
        'x',
        'y',
        'w',
        'h',
        'x1',
        'y1',
        'x2',
        'y2',
        'radius',
        'image',
        'text',
        'font',
        'align',
        'baseline',
        'rotation'
    ]) {
        assert.ok(
            observedGetterOperations.has(`get:options.${propertyPath}`),
            `예외 sweep에서 options.${propertyPath} getter를 관찰해야 합니다.`
        );
    }
});

test('shadow setter와 스타일 getter 재진입은 현재 호출과 다음 호출 순서를 보존한다', () => {
    const run = (DrawHandler2D) => {
        const harness = createHarness(DrawHandler2D);
        harness.handler.shadowOff('main');
        const shadowBlurEventIndex = 7;
        harness.context.__controller.hookAt = shadowBlurEventIndex;
        harness.context.__controller.hook = ({ operation }) => {
            assert.equal(operation, 'set:shadowBlur');
            harness.handler.shadowOn('main', 23, '#hooked');
            harness.context.__record('hook:shadowOn');
        };
        let fillReadCount = 0;
        const style = {
            shape: 'rect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            get fill() {
                fillReadCount += 1;
                harness.context.__record('getter:fill', [fillReadCount]);
                if (fillReadCount === 1) {
                    harness.handler.shadowOff('main');
                }
                return '#abcdef';
            },
            stroke: '#123456',
            alpha: 0.5,
            lineWidth: 2,
            lineCap: 'round',
            lineJoin: 'bevel'
        };
        harness.handler.render('main', style);
        harness.handler.render('main', {
            shape: 'rect', x: 5, y: 6, w: 7, h: 8, fill: '#fedcba'
        });
        return {
            trace: harness.trace,
            state: harness.context.__snapshot(),
            fillReadCount
        };
    };

    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    const legacyResult = run(legacyVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.equal(
        optimizedResult.trace.filter(
            (event) => event.operation === 'hook:shadowOn'
        ).length,
        1
    );
    assert.equal(optimizedResult.state.shadowBlur, 23);
    assert.equal(optimizedResult.state.shadowColor, '#hooked');
    assert.equal(optimizedResult.fillReadCount, 3);
});

test('render가 잡은 custom 그림자 스냅샷과 다음 기본 상태를 exact 보존한다', () => {
    const run = (DrawHandler2D) => {
        const harness = createHarness(DrawHandler2D);
        harness.handler.shadowOn('main', 13, '#snapshot');
        let fillReadCount = 0;
        harness.handler.render('main', {
            shape: 'rect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            get fill() {
                fillReadCount += 1;
                harness.context.__record('getter:snapshot-fill', [fillReadCount]);
                harness.handler.shadowOff('main');
                return '#123456';
            }
        });
        harness.context.__record('separator:next-render');
        harness.handler.render('main', {
            shape: 'rect', x: 5, y: 6, w: 7, h: 8, fill: '#654321'
        });
        return {
            trace: harness.trace,
            state: harness.context.__snapshot(),
            fillReadCount
        };
    };

    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    const legacyResult = run(legacyVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.deepEqual(
        optimizedResult.trace
            .filter((event) => event.operation === 'set:shadowBlur')
            .map((event) => event.args[0]),
        [13, 0]
    );
    assert.deepEqual(
        optimizedResult.trace
            .filter((event) => event.operation === 'set:shadowColor')
            .map((event) => event.args[0]),
        ['#snapshot', 'rgba(0,0,0,0)']
    );
    assert.equal(optimizedResult.fillReadCount, 3);
    assert.equal(optimizedResult.state.shadowBlur, 0);
    assert.equal(optimizedResult.state.shadowColor, 'rgba(0,0,0,0)');
});

test('한 레이어의 custom 그림자는 다른 레이어의 공유 기본 상태와 격리된다', () => {
    const run = (DrawHandler2D) => {
        const handler = new DrawHandler2D();
        const trace = [];
        const alphaContext = createTraceContext('alpha', trace);
        const betaContext = createTraceContext('beta', trace);
        handler.registerLayer('alpha', alphaContext);
        handler.registerLayer('beta', betaContext);
        trace.length = 0;
        alphaContext.__controller.eventIndex = 0;
        betaContext.__controller.eventIndex = 0;

        handler.render('alpha', {
            shape: 'rect',
            x: 1,
            y: 2,
            w: 3,
            h: 4,
            fill: '#101010',
            shadowBlur: 53,
            shadowColor: '#alpha-local'
        });
        const duringAlphaLocalOverride = {
            alpha: alphaContext.__snapshot(),
            beta: betaContext.__snapshot()
        };
        handler.render('alpha', {
            shape: 'rect', x: 2, y: 3, w: 4, h: 5, fill: '#202020'
        });
        handler.render('beta', {
            shape: 'rect', x: 3, y: 4, w: 5, h: 6, fill: '#303030'
        });
        const afterAlphaLocalOverride = {
            alpha: alphaContext.__snapshot(),
            beta: betaContext.__snapshot()
        };

        handler.shadowOn('alpha', 41, '#alpha-only');
        handler.render('alpha', {
            shape: 'rect', x: 5, y: 6, w: 7, h: 8, fill: '#111111'
        });
        handler.render('beta', {
            shape: 'rect', x: 9, y: 10, w: 11, h: 12, fill: '#222222'
        });
        const betaAfterAlphaCustom = betaContext.__snapshot();
        handler.shadowOff('alpha');
        handler.render('alpha', {
            shape: 'rect', x: 13, y: 14, w: 15, h: 16, fill: '#333333'
        });
        handler.render('beta', {
            shape: 'rect', x: 9, y: 10, w: 11, h: 12, fill: '#222222'
        });
        return {
            trace,
            duringAlphaLocalOverride,
            afterAlphaLocalOverride,
            alphaState: alphaContext.__snapshot(),
            betaAfterAlphaCustom,
            betaState: betaContext.__snapshot()
        };
    };

    const optimizedResult = run(optimizedVariant.DrawHandler2D);
    const legacyResult = run(legacyVariant.DrawHandler2D);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.equal(
        optimizedResult.duringAlphaLocalOverride.alpha.shadowBlur,
        53
    );
    assert.equal(
        optimizedResult.duringAlphaLocalOverride.alpha.shadowColor,
        '#alpha-local'
    );
    assert.equal(
        optimizedResult.duringAlphaLocalOverride.beta.shadowBlur,
        0
    );
    for (const state of Object.values(optimizedResult.afterAlphaLocalOverride)) {
        assert.equal(state.shadowBlur, 0);
        assert.equal(state.shadowColor, 'rgba(0,0,0,0)');
    }
    assert.equal(optimizedResult.betaAfterAlphaCustom.shadowBlur, 0);
    assert.equal(
        optimizedResult.betaAfterAlphaCustom.shadowColor,
        'rgba(0,0,0,0)'
    );
    assert.equal(optimizedResult.alphaState.shadowBlur, 0);
    assert.equal(optimizedResult.alphaState.shadowColor, 'rgba(0,0,0,0)');
    assert.deepEqual(optimizedResult.betaState, optimizedResult.betaAfterAlphaCustom);
});

test('VM Object.prototype 그림자 getter 오염과 재진입에서도 exact 일치한다', () => {
    const run = (variant) => {
        const harness = createHarness(variant.DrawHandler2D);
        variant.context.__shadowParityHandler = harness.handler;
        const pollutedStyle = vm.runInContext(`(() => {
            Object.defineProperty(Object.prototype, 'shadowBlur', {
                configurable: true,
                get() {
                    __shadowParityBlurReads += 1;
                    __shadowParityHandler.shadowOff('main');
                    return 27;
                },
                set(value) {
                    Object.defineProperty(this, 'shadowBlur', {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value
                    });
                }
            });
            Object.defineProperty(Object.prototype, 'shadowColor', {
                configurable: true,
                get() {
                    __shadowParityColorReads += 1;
                    __shadowParityHandler.shadowOn('main', 31, '#prototype-next');
                    return '#prototype-current';
                },
                set(value) {
                    Object.defineProperty(this, 'shadowColor', {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value
                    });
                }
            });
            globalThis.__shadowParityBlurReads = 0;
            globalThis.__shadowParityColorReads = 0;
            return { shape: 'rect', x: 1, y: 2, w: 3, h: 4, fill: '#999999' };
        })()`, variant.context);
        try {
            harness.handler.render('main', pollutedStyle);
            harness.handler.render('main', {
                shape: 'rect', x: 5, y: 6, w: 7, h: 8, fill: '#888888'
            });
            const vmReadCounts = vm.runInContext(`(() => {
                const result = {
                    shadowBlur: __shadowParityBlurReads,
                    shadowColor: __shadowParityColorReads
                };
                delete Object.prototype.shadowBlur;
                delete Object.prototype.shadowColor;
                return result;
            })()`, variant.context);
            const getterReadCounts = {
                shadowBlur: vmReadCounts.shadowBlur,
                shadowColor: vmReadCounts.shadowColor
            };
            harness.context.__record('separator:prototype-cleanup');
            harness.handler.render('main', {
                shape: 'rect', x: 9, y: 10, w: 11, h: 12, fill: '#777777'
            });
            return {
                trace: harness.trace,
                state: harness.context.__snapshot(),
                getterReadCounts
            };
        } finally {
            vm.runInContext(`
                delete Object.prototype.shadowBlur;
                delete Object.prototype.shadowColor;
                delete globalThis.__shadowParityHandler;
                delete globalThis.__shadowParityBlurReads;
                delete globalThis.__shadowParityColorReads;
            `, variant.context);
        }
    };

    const optimizedResult = run(optimizedVariant);
    const legacyResult = run(legacyVariant);
    assert.deepEqual(optimizedResult, legacyResult);
    assert.deepEqual(optimizedResult.getterReadCounts, {
        shadowBlur: 4,
        shadowColor: 4
    });
    assert.equal(optimizedResult.state.shadowBlur, 31);
    assert.equal(optimizedResult.state.shadowColor, '#prototype-next');
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

test('50,000개 결정적 mixed 명령의 trace와 최종 상태가 exact 일치한다', () => {
    const layerNames = ['alpha', 'beta', 'gamma', 'delta'];
    const legacyTrace = [];
    const optimizedTrace = [];
    const legacyHandler = new legacyVariant.DrawHandler2D();
    const optimizedHandler = new optimizedVariant.DrawHandler2D();
    const legacyContexts = new Map(layerNames.map((layerName, index) => [
        layerName,
        createTraceContext(`${index}:${layerName}`, legacyTrace)
    ]));
    const optimizedContexts = new Map(layerNames.map((layerName, index) => [
        layerName,
        createTraceContext(`${index}:${layerName}`, optimizedTrace)
    ]));
    const random = createRandom(0x0719d2d);
    const blurValues = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, -7, 19, '5', null];
    const colorValues = ['rgba(0,0,0,0)', '', '#abcdef', null, undefined, 17];
    const shapes = ['rect', 'roundRect', 'circle', 'line', 'image', 'text', 'arrow', 'unknown'];
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
        const operation = (randomValue >>> 2) % 12;
        if (operation === 0) {
            const persistent = ((randomValue >>> 7) & 1) === 1;
            const scaleX = ((randomValue >>> 8) % 7 + 1) / 3;
            const scaleY = ((randomValue >>> 12) % 9 + 1) / 4;
            register(legacyHandler, legacyContexts, layerName, persistent, scaleX, scaleY);
            register(optimizedHandler, optimizedContexts, layerName, persistent, scaleX, scaleY);
        } else if (operation === 1) {
            legacyHandler.unregisterLayer(layerName);
            optimizedHandler.unregisterLayer(layerName);
        } else if (operation === 2) {
            const scaleX = ((randomValue >>> 9) % 11 - 2) / 3;
            const scaleY = ((randomValue >>> 15) % 13 - 3) / 5;
            legacyHandler.setLayerTransform(layerName, scaleX, scaleY);
            optimizedHandler.setLayerTransform(layerName, scaleX, scaleY);
        } else if (operation === 3) {
            const blur = blurValues[(randomValue >>> 10) % blurValues.length];
            const color = colorValues[(randomValue >>> 14) % colorValues.length];
            legacyHandler.shadowOn(layerName, blur, color);
            optimizedHandler.shadowOn(layerName, blur, color);
        } else if (operation === 4 || operation === 5) {
            legacyHandler.shadowOff(layerName);
            optimizedHandler.shadowOff(layerName);
        } else if (operation === 6) {
            legacyHandler.clear(layerName);
            optimizedHandler.clear(layerName);
        } else if (operation === 7) {
            legacyHandler.clearAll();
            optimizedHandler.clearAll();
        } else {
            const shape = shapes[(randomValue >>> 6) % shapes.length];
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
                x1: -1,
                y1: 2,
                x2: 30,
                y2: -40,
                radius: (randomValue >>> 18) % 20,
                rotation: (randomValue >>> 20) % 360,
                text: `shadow-${commandIndex}`,
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
            if ((randomValue & 0x2000) !== 0) {
                drawOptions.shadowBlur = blurValues[(randomValue >>> 5) % blurValues.length];
            }
            if ((randomValue & 0x4000) !== 0) {
                drawOptions.shadowColor = colorValues[(randomValue >>> 9) % colorValues.length];
            }
            legacyHandler.render(layerName, drawOptions);
            optimizedHandler.render(layerName, drawOptions);
        }

        assert.deepEqual(
            optimizedTrace,
            legacyTrace,
            `mixed 명령 ${commandIndex}`
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
