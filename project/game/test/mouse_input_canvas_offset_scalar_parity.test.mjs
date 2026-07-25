import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const GAME_DIRECTORY = resolve(TEST_DIRECTORY, '..');
const MOUSE_HANDLER_PATH = resolve(
    GAME_DIRECTORY,
    'script/module/input/_mouse_input_handler.js'
);
const DISPLAY_SYSTEM_PATH = resolve(
    GAME_DIRECTORY,
    'script/module/display/display_system.js'
);
const NUMBER_UTIL_PATH = resolve(GAME_DIRECTORY, 'script/util/number_util.js');

const [mouseHandlerSource, displaySystemSource, numberUtilSource] = await Promise.all([
    readFile(MOUSE_HANDLER_PATH, 'utf8'),
    readFile(DISPLAY_SYSTEM_PATH, 'utf8'),
    readFile(NUMBER_UTIL_PATH, 'utf8')
]);

const resolveFiniteNumberLegacy = (value, fallback) => (
    Number.isFinite(value) ? value : fallback
);

/**
 * 변경 전 좌표 변환 본문을 독립 오라클로 고정합니다.
 * Error.stack은 함수명과 소스 위치에 의존하는 V8 비표준 진단 정보이므로 비교하지 않습니다.
 * 대신 예외 identity/name/message, 부작용 순서와 부분 기록 상태를 모두 비교합니다.
 *
 * @param {{x: number, y: number}} mousePos
 * @param {unknown} event
 * @param {{getScaleRatio: Function, getCanvasOffset: Function}} displayApi
 * @returns {void}
 */
function updateMousePositionLegacy(mousePos, event, displayApi) {
    const scale = resolveFiniteNumberLegacy(Number(displayApi.getScaleRatio()), 1);
    const offset = displayApi.getCanvasOffset();
    const offsetX = resolveFiniteNumberLegacy(Number(offset?.x), 0);
    const offsetY = resolveFiniteNumberLegacy(Number(offset?.y), 0);
    const clientX = resolveFiniteNumberLegacy(Number(event?.clientX), offsetX);
    const clientY = resolveFiniteNumberLegacy(Number(event?.clientY), offsetY);
    mousePos.x = (clientX - offsetX) * scale;
    mousePos.y = (clientY - offsetY) * scale;
}

function createListenerTarget(extraProperties = {}) {
    const listeners = new Map();
    return {
        target: {
            ...extraProperties,
            addEventListener(type, listener) {
                const entries = listeners.get(type) ?? [];
                entries.push(listener);
                listeners.set(type, entries);
            }
        },
        get(type, index = 0) {
            const listener = listeners.get(type)?.[index];
            assert.equal(typeof listener, 'function', `missing ${type} listener ${index}`);
            return listener;
        },
        count(type) {
            return listeners.get(type)?.length ?? 0;
        }
    };
}

function createDisplayApi(controller, { forbidAggregate = false } = {}) {
    return {
        getScaleRatio() {
            return controller.readScale();
        },
        getCanvasOffsetX() {
            return controller.readOffsetX();
        },
        getCanvasOffsetY() {
            return controller.readOffsetY();
        },
        getCanvasOffset() {
            if (forbidAggregate) {
                throw new Error('hot path called allocating getCanvasOffset()');
            }
            const x = controller.readOffsetX();
            const y = controller.readOffsetY();
            return { x, y };
        }
    };
}

async function loadMouseRuntime(controller) {
    const windowTarget = createListenerTarget();
    const documentTarget = createListenerTarget({
        hidden: false,
        hasFocus: () => true
    });
    const context = vm.createContext({
        console,
        window: windowTarget.target,
        document: documentTarget.target
    });
    const stateMachines = [];

    class DebugModeToggleHandler {}

    class MouseButtonStateMachine {
        constructor() {
            this.mouseButtons = [];
            this.calls = [];
            stateMachines.push(this);
        }

        queueButtonStateChange(...args) {
            this.calls.push(['queueButtonStateChange', ...args]);
        }

        setAllButtonsInactive() {
            this.calls.push(['setAllButtonsInactive']);
        }

        resetAllButtons() {
            this.calls.push(['resetAllButtons']);
        }

        updateAll() {
            this.calls.push(['updateAll']);
        }

        getButtonState(name) {
            return `state:${name}`;
        }

        hasButtonState() {
            return false;
        }

        consumeButtonState() {
            return false;
        }
    }

    const displayApi = createDisplayApi(controller, { forbidAggregate: true });
    const displayModule = new vm.SyntheticModule(
        ['getScaleRatio', 'getCanvasOffset', 'getCanvasOffsetX', 'getCanvasOffsetY'],
        function initializeDisplayModule() {
            this.setExport('getScaleRatio', displayApi.getScaleRatio);
            this.setExport('getCanvasOffset', displayApi.getCanvasOffset);
            this.setExport('getCanvasOffsetX', displayApi.getCanvasOffsetX);
            this.setExport('getCanvasOffsetY', displayApi.getCanvasOffsetY);
        },
        { context, identifier: 'display/display_system.js' }
    );
    const debugModule = new vm.SyntheticModule(
        ['DebugModeToggleHandler'],
        function initializeDebugModule() {
            this.setExport('DebugModeToggleHandler', DebugModeToggleHandler);
        },
        { context, identifier: 'input/_debug_mode_toggle_handler.js' }
    );
    const buttonModule = new vm.SyntheticModule(
        ['MouseButtonStateMachine'],
        function initializeButtonModule() {
            this.setExport('MouseButtonStateMachine', MouseButtonStateMachine);
        },
        { context, identifier: 'input/_mouse_button_state_machine.js' }
    );
    const numberModule = new vm.SourceTextModule(numberUtilSource, {
        context,
        identifier: pathToFileURL(NUMBER_UTIL_PATH).href
    });
    const mouseModule = new vm.SourceTextModule(mouseHandlerSource, {
        context,
        identifier: pathToFileURL(MOUSE_HANDLER_PATH).href
    });

    await mouseModule.link((specifier) => {
        if (specifier === 'display/display_system.js') return displayModule;
        if (specifier === './_debug_mode_toggle_handler.js') return debugModule;
        if (specifier === './_mouse_button_state_machine.js') return buttonModule;
        if (specifier === 'util/number_util.js') return numberModule;
        throw new Error(`unexpected import: ${specifier}`);
    });
    await mouseModule.evaluate();

    return {
        MouseInputHandler: mouseModule.namespace.MouseInputHandler,
        windowTarget,
        documentTarget,
        stateMachines
    };
}

function capture(action) {
    try {
        action();
        return { ok: true, error: null };
    } catch (error) {
        return { ok: false, error };
    }
}

function assertSameOutcome(actual, expected, label) {
    assert.equal(actual.ok, expected.ok, `${label}: completion kind`);
    if (actual.ok) return;
    assert.equal(actual.error?.name, expected.error?.name, `${label}: error name`);
    assert.equal(actual.error?.message, expected.error?.message, `${label}: error message`);
    assert.equal(
        actual.error?.constructor?.name,
        expected.error?.constructor?.name,
        `${label}: error constructor`
    );
}

function assertSameNumber(actual, expected, label) {
    assert.ok(
        Object.is(actual, expected),
        `${label}: expected ${String(expected)}, received ${String(actual)}`
    );
}

async function loadActualDisplaySystem() {
    const context = vm.createContext({ console });
    const fixture = { screenHandler: null };

    class ScreenHandler {
        constructor() {
            return fixture.screenHandler;
        }
    }

    class NoopHandler {}

    class CanvasSurfacePool {
        getStats() {
            return { createdCount: 0, availableCount: 0 };
        }
    }

    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initializeSyntheticModule() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
    const modules = new Map([
        ['./_screen_handler.js', createSyntheticModule('display/_screen_handler.js', {
            ScreenHandler
        })],
        ['./_draw_handler_2d.js', createSyntheticModule('display/_draw_handler_2d.js', {
            DrawHandler2D: NoopHandler
        })],
        ['./webgl/_webgl_handler.js', createSyntheticModule('display/webgl/_webgl_handler.js', {
            WebGLHandler: NoopHandler
        })],
        ['display/_theme_handler.js', createSyntheticModule('display/_theme_handler.js', {
            ColorSchemes: {},
            ThemeHandler: NoopHandler,
            setTheme: () => {}
        })],
        ['util/color_util.js', createSyntheticModule('util/color_util.js', {
            colorUtil: () => ({ cssToRgb: () => ({ r: 0, g: 0, b: 0 }) })
        })],
        ['save/save_system.js', createSyntheticModule('save/save_system.js', {
            getSetting: () => undefined
        })],
        ['./_surface_pool.js', createSyntheticModule('display/_surface_pool.js', {
            CanvasSurfacePool
        })],
        ['./_vignette_renderer.js', createSyntheticModule('display/_vignette_renderer.js', {
            VignetteRenderer: NoopHandler
        })],
        ['./_theme_transition_controller.js', createSyntheticModule(
            'display/_theme_transition_controller.js',
            { ThemeTransitionController: NoopHandler }
        )],
        ['./display_surface_descriptor.js', createSyntheticModule(
            'display/display_surface_descriptor.js',
            {
                DISPLAY_WEBGL_RENDER_MODES: Object.freeze({
                    BATCH: 'batch',
                    OVERLAY_EFFECT: 'overlay-effect',
                    EFFECT: 'effect'
                }),
                compareDisplaySurfaceDescriptors: () => 0,
                createDisplaySurfaceDescriptor: (value) => value,
                resolveDisplayWebGLLayerName: (value) => value,
                usesNativeDisplay2DResolution: () => false
            }
        )]
    ]);
    const displayModule = new vm.SourceTextModule(displaySystemSource, {
        context,
        identifier: pathToFileURL(DISPLAY_SYSTEM_PATH).href
    });
    await displayModule.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) throw new Error(`unexpected display import: ${specifier}`);
        return dependency;
    });
    await displayModule.evaluate();

    return {
        namespace: displayModule.namespace,
        objectPrototype: vm.runInContext('Object.prototype', context),
        createDisplaySystem(screenHandler) {
            fixture.screenHandler = screenHandler;
            return new displayModule.namespace.DisplaySystem();
        }
    };
}

test('canvas offset scalar path preserves the allocating public API and source evaluation order', async () => {
    assert.match(
        displaySystemSource,
        /export const getCanvasOffsetX = \(\) => displaySystemInstance\.screenHandler\.cssLeft;/
    );
    assert.match(
        displaySystemSource,
        /export const getCanvasOffsetY = \(\) => displaySystemInstance\.screenHandler\.cssTop;/
    );
    assert.match(
        displaySystemSource,
        /export const getCanvasOffset = \(\) => \(\{\s*x: displaySystemInstance\.screenHandler\.cssLeft,\s*y: displaySystemInstance\.screenHandler\.cssTop\s*\}\);/
    );

    const updateStart = mouseHandlerSource.indexOf('#updateMousePosition(event)');
    const updateEnd = mouseHandlerSource.indexOf('\n    }', updateStart);
    assert.ok(updateStart >= 0 && updateEnd > updateStart, 'mouse update body must exist');
    const updateBody = mouseHandlerSource.slice(updateStart, updateEnd);
    assert.doesNotMatch(updateBody, /\bgetCanvasOffset\s*\(/);
    assert.doesNotMatch(updateBody, /canvasOffsetScratch|\{\s*x\s*:/);
    const rawXIndex = updateBody.indexOf('const rawOffsetX = getCanvasOffsetX();');
    const rawYIndex = updateBody.indexOf('const rawOffsetY = getCanvasOffsetY();');
    const numberXIndex = updateBody.indexOf('Number(rawOffsetX)');
    const numberYIndex = updateBody.indexOf('Number(rawOffsetY)');
    assert.ok(rawXIndex >= 0, 'raw X scalar read must exist');
    assert.ok(rawXIndex < rawYIndex, 'raw X must be read before raw Y');
    assert.ok(rawYIndex < numberXIndex, 'both raw offsets must be read before X coercion');
    assert.ok(numberXIndex < numberYIndex, 'X coercion must precede Y coercion');

    const displayRuntime = await loadActualDisplaySystem();
    const helpers = displayRuntime.namespace;
    const trace = [];
    const screenHandler = {};
    Object.defineProperties(screenHandler, {
        cssLeft: {
            get() {
                trace.push('cssLeft.get');
                return -0;
            }
        },
        cssTop: {
            get() {
                trace.push('cssTop.get');
                return 17;
            }
        }
    });
    const display = displayRuntime.createDisplaySystem(screenHandler);
    Object.defineProperty(display, 'screenHandler', {
        configurable: true,
        get() {
            trace.push('screenHandler.get');
            return screenHandler;
        }
    });

    const scalarX = helpers.getCanvasOffsetX({ ignored: true });
    const scalarY = helpers.getCanvasOffsetY({ ignored: true });
    assert.ok(Object.is(scalarX, -0));
    assert.equal(scalarY, 17);
    assert.deepEqual(trace, [
        'screenHandler.get', 'cssLeft.get',
        'screenHandler.get', 'cssTop.get'
    ]);
    assert.equal(helpers.getCanvasOffsetX.length, 0);
    assert.equal(helpers.getCanvasOffsetY.length, 0);

    trace.length = 0;
    const ignoredTarget = { x: 'sentinel-x', y: 'sentinel-y' };
    const ignoredTargetBefore = { ...ignoredTarget };
    const first = helpers.getCanvasOffset(ignoredTarget);
    const second = helpers.getCanvasOffset();
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first, ignoredTarget);
    assert.deepEqual(ignoredTarget, ignoredTargetBefore);
    assert.strictEqual(Object.getPrototypeOf(first), displayRuntime.objectPrototype);
    assert.deepEqual(Array.from(Object.keys(first)), ['x', 'y']);
    for (const key of ['x', 'y']) {
        const descriptor = Object.getOwnPropertyDescriptor(first, key);
        assert.equal(descriptor?.writable, true, `${key} writable`);
        assert.equal(descriptor?.enumerable, true, `${key} enumerable`);
        assert.equal(descriptor?.configurable, true, `${key} configurable`);
    }
    assert.ok(Object.is(first.x, -0));
    assert.equal(first.y, 17);
    assert.equal(helpers.getCanvasOffset.length, 0);

    function createSwitchingDisplay(switchTrace) {
        const secondScreen = {
            get cssTop() {
                switchTrace.push('B.cssTop');
                return 29;
            }
        };
        const switchToSecondDisplay = () => {
            const secondDisplay = displayRuntime.createDisplaySystem(secondScreen);
            Object.defineProperty(secondDisplay, 'screenHandler', {
                configurable: true,
                get() {
                    switchTrace.push('B.screenHandler');
                    return secondScreen;
                }
            });
        };
        const firstScreen = {
            get cssLeft() {
                switchTrace.push('A.cssLeft');
                switchToSecondDisplay();
                return 11;
            },
            get cssTop() {
                throw new Error('stale display cssTop was read');
            }
        };
        const firstDisplay = displayRuntime.createDisplaySystem(firstScreen);
        Object.defineProperty(firstDisplay, 'screenHandler', {
            configurable: true,
            get() {
                switchTrace.push('A.screenHandler');
                return firstScreen;
            }
        });
        return firstDisplay;
    }

    const scalarSwitchTrace = [];
    createSwitchingDisplay(scalarSwitchTrace);
    const switchedX = helpers.getCanvasOffsetX();
    const switchedY = helpers.getCanvasOffsetY();
    const aggregateSwitchTrace = [];
    createSwitchingDisplay(aggregateSwitchTrace);
    const switchedAggregate = helpers.getCanvasOffset();
    assert.equal(switchedX, switchedAggregate.x);
    assert.equal(switchedY, switchedAggregate.y);
    assert.deepEqual(scalarSwitchTrace, aggregateSwitchTrace);
});

test('mouse scalar offsets exactly match legacy primitives and coercion edge cases', async () => {
    const candidateRaw = { scale: 1, x: 0, y: 0 };
    const legacyRaw = { scale: 1, x: 0, y: 0 };
    const candidateController = {
        readScale: () => candidateRaw.scale,
        readOffsetX: () => candidateRaw.x,
        readOffsetY: () => candidateRaw.y
    };
    const legacyController = {
        readScale: () => legacyRaw.scale,
        readOffsetX: () => legacyRaw.x,
        readOffsetY: () => legacyRaw.y
    };
    const runtime = await loadMouseRuntime(candidateController);
    const handler = new runtime.MouseInputHandler();
    const move = runtime.windowTarget.get('mousemove');
    const legacyPosition = { x: 0, y: 0 };
    const legacyApi = createDisplayApi(legacyController);

    const cases = [
        ['ordinary', () => ({ scale: 2, x: 10, y: 20, event: { clientX: 15, clientY: 26 } })],
        ['signed zero', () => ({ scale: -0, x: -0, y: 0, event: { clientX: 0, clientY: -0 } })],
        ['non-finite fallback', () => ({ scale: Infinity, x: NaN, y: -Infinity, event: { clientX: NaN, clientY: Infinity } })],
        ['largest overflow', () => ({ scale: Number.MAX_VALUE, x: -Number.MAX_VALUE, y: Number.MIN_VALUE, event: { clientX: Number.MAX_VALUE, clientY: -Number.MIN_VALUE } })],
        ['numeric strings', () => ({ scale: '2.5', x: '-4', y: '8', event: { clientX: '11', clientY: '-3' } })],
        ['null boolean bigint', () => ({ scale: true, x: null, y: 3n, event: { clientX: false, clientY: 9n } })],
        ['undefined event', () => ({ scale: 4, x: 3, y: -7, event: undefined })],
        ['null event', () => ({ scale: 4, x: 3, y: -7, event: null })],
        ['boxed values', () => ({ scale: new Number(2), x: new Number(-3), y: new Number(4), event: { clientX: new Number(7), clientY: new Number(11) } })],
        ['custom primitive conversion', () => ({
            scale: { [Symbol.toPrimitive]: () => '3' },
            x: { [Symbol.toPrimitive]: () => '-2' },
            y: { valueOf: () => 5 },
            event: {
                clientX: { [Symbol.toPrimitive]: () => 4 },
                clientY: { valueOf: () => -1 }
            }
        })],
        ['scale symbol exception', () => ({ scale: Symbol('scale'), x: 1, y: 2, event: { clientX: 3, clientY: 4 } })],
        ['offset x symbol exception', () => ({ scale: 1, x: Symbol('x'), y: 2, event: { clientX: 3, clientY: 4 } })],
        ['offset y symbol exception', () => ({ scale: 1, x: 1, y: Symbol('y'), event: { clientX: 3, clientY: 4 } })],
        ['client x symbol exception', () => ({ scale: 1, x: 1, y: 2, event: { clientX: Symbol('x'), clientY: 4 } })],
        ['client y symbol exception', () => ({ scale: 1, x: 1, y: 2, event: { clientX: 3, clientY: Symbol('y') } })]
    ];

    for (const [name, makeCase] of cases) {
        const candidateCase = makeCase();
        const legacyCase = makeCase();
        Object.assign(candidateRaw, {
            scale: candidateCase.scale,
            x: candidateCase.x,
            y: candidateCase.y
        });
        Object.assign(legacyRaw, {
            scale: legacyCase.scale,
            x: legacyCase.x,
            y: legacyCase.y
        });
        handler.mousePos.x = 37;
        handler.mousePos.y = -41;
        legacyPosition.x = 37;
        legacyPosition.y = -41;

        const actual = capture(() => move(candidateCase.event));
        const expected = capture(() => updateMousePositionLegacy(
            legacyPosition,
            legacyCase.event,
            legacyApi
        ));
        assertSameOutcome(actual, expected, name);
        assertSameNumber(handler.mousePos.x, legacyPosition.x, `${name}: x`);
        assertSameNumber(handler.mousePos.y, legacyPosition.y, `${name}: y`);
    }
});

test('all four coordinate listeners avoid the aggregate offset-object path', async () => {
    const raw = { scale: 2, x: 10, y: 20 };
    const controller = {
        readScale: () => raw.scale,
        readOffsetX: () => raw.x,
        readOffsetY: () => raw.y
    };
    const runtime = await loadMouseRuntime(controller);
    const handler = new runtime.MouseInputHandler();
    const legacyPosition = { x: 0, y: 0 };
    const legacyApi = createDisplayApi(controller);
    const dispatches = [
        [runtime.windowTarget.get('mousemove'), { clientX: 15, clientY: 26 }],
        [runtime.documentTarget.get('mousemove'), { clientX: 17, clientY: 29 }],
        [runtime.windowTarget.get('mousedown'), {
            clientX: 19,
            clientY: 32,
            button: 0,
            timeStamp: 101
        }],
        [runtime.windowTarget.get('mouseup'), {
            clientX: 21,
            clientY: 35,
            button: 0,
            timeStamp: 202
        }]
    ];

    assert.equal(runtime.windowTarget.count('mousemove'), 1);
    assert.equal(runtime.documentTarget.count('mousemove'), 1);
    assert.equal(runtime.windowTarget.count('mousedown'), 1);
    assert.equal(runtime.windowTarget.count('mouseup'), 1);

    for (const [listener, event] of dispatches) {
        listener(event);
        updateMousePositionLegacy(legacyPosition, event, legacyApi);
        assertSameNumber(handler.mousePos.x, legacyPosition.x, 'listener x');
        assertSameNumber(handler.mousePos.y, legacyPosition.y, 'listener y');
    }
    assert.deepEqual(handler.buttonStateMachine.calls, [
        ['queueButtonStateChange', 0, 'press', 101],
        ['queueButtonStateChange', 0, 'release', 202]
    ]);
});

test('wheel 입력은 deltaMode별 무차원 누적값과 최신 pointer 좌표를 보존한다', async () => {
    const raw = { scale: 2, x: 10, y: 20 };
    const controller = {
        readScale: () => raw.scale,
        readOffsetX: () => raw.x,
        readOffsetY: () => raw.y
    };
    const runtime = await loadMouseRuntime(controller);
    const handler = new runtime.MouseInputHandler();
    const wheel = runtime.windowTarget.get('wheel');
    const totals = {};

    wheel({
        clientX: 30,
        clientY: 50,
        deltaX: -50,
        deltaY: 100,
        deltaMode: 0
    });
    assert.equal(handler.mousePos.x, 40);
    assert.equal(handler.mousePos.y, 60);
    assert.strictEqual(handler.copyWheelTotalsInto(totals), totals);
    assert.deepEqual(totals, { x: -0.5, y: 1 });

    wheel({
        clientX: 32,
        clientY: 52,
        deltaX: 0,
        deltaY: 3,
        deltaMode: 1
    });
    wheel({
        clientX: 34,
        clientY: 54,
        deltaX: 0,
        deltaY: -1,
        deltaMode: 2
    });
    handler.copyWheelTotalsInto(totals);
    assert.deepEqual(totals, { x: -0.5, y: 1 });

    wheel({
        clientX: 36,
        clientY: 56,
        deltaX: Number.POSITIVE_INFINITY,
        deltaY: 100000,
        deltaMode: 0
    });
    handler.copyWheelTotalsInto(totals);
    assert.deepEqual(totals, { x: -0.5, y: 5 });
    assert.equal(runtime.windowTarget.count('wheel'), 1);
});

function createObservedScenario(failAt = null) {
    const trace = [];
    const sentinel = new RangeError(`sentinel:${failAt}`);
    const values = { x: 37, y: -41 };
    const mark = (label, value) => {
        trace.push(label);
        if (failAt === label) throw sentinel;
        return value;
    };
    const coercible = (label, value) => ({
        [Symbol.toPrimitive](hint) {
            return mark(`${label}.toPrimitive:${hint}`, value);
        }
    });
    const controller = {
        readScale: () => mark('scale.get', coercible('scale', 2)),
        readOffsetX: () => mark('left.get', coercible('left', 10)),
        readOffsetY: () => mark('top.get', coercible('top', 20))
    };
    const event = { button: 1, timeStamp: 123.5 };
    Object.defineProperties(event, {
        clientX: {
            get: () => mark('clientX.get', coercible('clientX', 15))
        },
        clientY: {
            get: () => mark('clientY.get', coercible('clientY', 26))
        }
    });
    const instrumentPosition = (position) => {
        Object.defineProperties(position, {
            x: {
                configurable: true,
                enumerable: true,
                get: () => values.x,
                set(value) {
                    mark('mousePos.x.set', value);
                    values.x = value;
                }
            },
            y: {
                configurable: true,
                enumerable: true,
                get: () => values.y,
                set(value) {
                    mark('mousePos.y.set', value);
                    values.y = value;
                }
            }
        });
    };
    return { controller, event, instrumentPosition, sentinel, trace, values };
}

test('getter, coercion, exception, partial-write, and button ordering match the legacy oracle', async () => {
    let activeCandidateScenario;
    const candidateController = {
        readScale: () => activeCandidateScenario.controller.readScale(),
        readOffsetX: () => activeCandidateScenario.controller.readOffsetX(),
        readOffsetY: () => activeCandidateScenario.controller.readOffsetY()
    };
    const runtime = await loadMouseRuntime(candidateController);
    const handler = new runtime.MouseInputHandler();
    const mouseDown = runtime.windowTarget.get('mousedown');
    const stateMachine = handler.buttonStateMachine;
    const failPoints = [
        null,
        'scale.get',
        'scale.toPrimitive:number',
        'left.get',
        'top.get',
        'left.toPrimitive:number',
        'top.toPrimitive:number',
        'clientX.get',
        'clientX.toPrimitive:number',
        'clientY.get',
        'clientY.toPrimitive:number',
        'mousePos.x.set',
        'mousePos.y.set'
    ];
    const successTrace = [
        'scale.get',
        'scale.toPrimitive:number',
        'left.get',
        'top.get',
        'left.toPrimitive:number',
        'top.toPrimitive:number',
        'clientX.get',
        'clientX.toPrimitive:number',
        'clientY.get',
        'clientY.toPrimitive:number',
        'mousePos.x.set',
        'mousePos.y.set'
    ];

    for (const failAt of failPoints) {
        const label = failAt ?? 'success';
        const candidate = createObservedScenario(failAt);
        const legacy = createObservedScenario(failAt);
        activeCandidateScenario = candidate;
        candidate.instrumentPosition(handler.mousePos);
        const legacyPosition = {};
        legacy.instrumentPosition(legacyPosition);
        stateMachine.calls.length = 0;
        const legacyButtonCalls = [];

        const actual = capture(() => mouseDown(candidate.event));
        const expected = capture(() => {
            updateMousePositionLegacy(
                legacyPosition,
                legacy.event,
                createDisplayApi(legacy.controller)
            );
            legacyButtonCalls.push([
                'queueButtonStateChange',
                legacy.event.button,
                'press',
                legacy.event.timeStamp
            ]);
        });

        assertSameOutcome(actual, expected, label);
        if (failAt !== null) {
            assert.strictEqual(actual.error, candidate.sentinel, `${label}: candidate sentinel`);
            assert.strictEqual(expected.error, legacy.sentinel, `${label}: legacy sentinel`);
        }
        assert.deepEqual(candidate.trace, legacy.trace, `${label}: trace`);
        assertSameNumber(candidate.values.x, legacy.values.x, `${label}: x state`);
        assertSameNumber(candidate.values.y, legacy.values.y, `${label}: y state`);
        assert.deepEqual(stateMachine.calls, legacyButtonCalls, `${label}: button calls`);
        if (failAt === null) assert.deepEqual(candidate.trace, successTrace);
    }
});

function createReentrantScenario(reentryPoint) {
    const trace = [];
    const snapshots = [];
    let phase = 'outer';
    let entered = false;
    let triggerInner = () => {
        throw new Error('inner trigger was not installed');
    };
    const values = { x: 0, y: 0 };
    const states = {
        outer: { scale: 2, x: null, y: 20 },
        inner: { scale: 3, x: 100, y: 200 }
    };
    const innerEvent = { clientX: 106, clientY: 209 };
    const outerEvent = { clientX: 15, clientY: 26 };

    const runInner = (label) => {
        if (entered) return;
        entered = true;
        trace.push(`${label}:enter`);
        phase = 'inner';
        try {
            triggerInner(innerEvent);
            snapshots.push({ x: values.x, y: values.y });
        } finally {
            phase = 'outer';
            trace.push(`${label}:exit`);
        }
    };
    states.outer.x = {
        [Symbol.toPrimitive](hint) {
            trace.push(`outer.x.toPrimitive:${hint}`);
            if (reentryPoint === 'x-coercion') runInner('x-coercion');
            return 10;
        }
    };
    const controller = {
        readScale() {
            trace.push(`${phase}.scale`);
            return states[phase].scale;
        },
        readOffsetX() {
            trace.push(`${phase}.left`);
            return states[phase].x;
        },
        readOffsetY() {
            trace.push(`${phase}.top`);
            const value = states[phase].y;
            if (phase === 'outer' && reentryPoint === 'top-read') runInner('top-read');
            return value;
        }
    };
    const position = {};
    Object.defineProperties(position, {
        x: {
            configurable: true,
            enumerable: true,
            get: () => values.x,
            set(value) {
                trace.push(`${phase}.setX:${String(value)}`);
                values.x = value;
            }
        },
        y: {
            configurable: true,
            enumerable: true,
            get: () => values.y,
            set(value) {
                trace.push(`${phase}.setY:${String(value)}`);
                values.y = value;
            }
        }
    });
    return {
        controller,
        outerEvent,
        innerEvent,
        position,
        snapshots,
        trace,
        values,
        installTrigger(trigger) {
            triggerInner = trigger;
        }
    };
}

test('same-handler reentry during top read and X coercion preserves suspended outer values', async () => {
    for (const reentryPoint of ['top-read', 'x-coercion']) {
        const candidate = createReentrantScenario(reentryPoint);
        const legacy = createReentrantScenario(reentryPoint);
        const runtime = await loadMouseRuntime(candidate.controller);
        const handler = new runtime.MouseInputHandler();
        const originalMousePosition = handler.getMouseInput('pos');
        Object.defineProperties(handler.mousePos, Object.getOwnPropertyDescriptors(candidate.position));
        const candidateMove = runtime.windowTarget.get('mousemove');
        candidate.installTrigger((event) => candidateMove(event));
        legacy.installTrigger((event) => updateMousePositionLegacy(
            legacy.position,
            event,
            createDisplayApi(legacy.controller)
        ));

        candidateMove(candidate.outerEvent);
        updateMousePositionLegacy(
            legacy.position,
            legacy.outerEvent,
            createDisplayApi(legacy.controller)
        );

        assert.strictEqual(handler.getMouseInput('pos'), originalMousePosition);
        assert.deepEqual(candidate.trace, legacy.trace, `${reentryPoint}: trace`);
        assert.deepEqual(candidate.snapshots, legacy.snapshots, `${reentryPoint}: snapshots`);
        assert.deepEqual(candidate.snapshots, [{ x: 18, y: 27 }]);
        assertSameNumber(candidate.values.x, legacy.values.x, `${reentryPoint}: final x`);
        assertSameNumber(candidate.values.y, legacy.values.y, `${reentryPoint}: final y`);
        assertSameNumber(candidate.values.x, 10, `${reentryPoint}: expected outer x`);
        assertSameNumber(candidate.values.y, 12, `${reentryPoint}: expected outer y`);
    }
});

function createCrossHandlerScenario() {
    const trace = [];
    const snapshots = [];
    const values = {
        A: { x: 0, y: 0 },
        B: { x: 0, y: 0 }
    };
    const states = {
        A: { scale: 2, x: null, y: 20 },
        B: { scale: 3, x: 100, y: 200 }
    };
    const events = {
        A: { clientX: 15, clientY: 26 },
        B: { clientX: 106, clientY: 209 }
    };
    let phase = 'A';
    let entered = false;
    let triggerB = () => {
        throw new Error('B trigger was not installed');
    };
    states.A.x = {
        [Symbol.toPrimitive](hint) {
            trace.push(`A.x.toPrimitive:${hint}`);
            if (!entered) {
                entered = true;
                phase = 'B';
                trace.push('cross:enter');
                try {
                    triggerB(events.B);
                    snapshots.push({ ...values.B });
                } finally {
                    phase = 'A';
                    trace.push('cross:exit');
                }
            }
            return 10;
        }
    };
    const controller = {
        readScale() {
            trace.push(`${phase}.scale`);
            return states[phase].scale;
        },
        readOffsetX() {
            trace.push(`${phase}.left`);
            return states[phase].x;
        },
        readOffsetY() {
            trace.push(`${phase}.top`);
            return states[phase].y;
        }
    };
    const createPosition = (owner) => {
        const position = {};
        Object.defineProperties(position, {
            x: {
                configurable: true,
                enumerable: true,
                get: () => values[owner].x,
                set(value) {
                    trace.push(`${owner}.setX:${String(value)}`);
                    values[owner].x = value;
                }
            },
            y: {
                configurable: true,
                enumerable: true,
                get: () => values[owner].y,
                set(value) {
                    trace.push(`${owner}.setY:${String(value)}`);
                    values[owner].y = value;
                }
            }
        });
        return position;
    };
    return {
        controller,
        events,
        positions: {
            A: createPosition('A'),
            B: createPosition('B')
        },
        snapshots,
        trace,
        values,
        installTriggerB(trigger) {
            triggerB = trigger;
        }
    };
}

test('cross-handler reentry cannot contaminate either suspended coordinate conversion', async () => {
    const candidate = createCrossHandlerScenario();
    const legacy = createCrossHandlerScenario();
    const runtime = await loadMouseRuntime(candidate.controller);
    const handlerA = new runtime.MouseInputHandler();
    const handlerB = new runtime.MouseInputHandler();
    Object.defineProperties(
        handlerA.mousePos,
        Object.getOwnPropertyDescriptors(candidate.positions.A)
    );
    Object.defineProperties(
        handlerB.mousePos,
        Object.getOwnPropertyDescriptors(candidate.positions.B)
    );
    const moveA = runtime.windowTarget.get('mousemove', 0);
    const moveB = runtime.windowTarget.get('mousemove', 1);
    candidate.installTriggerB((event) => moveB(event));
    const legacyApi = createDisplayApi(legacy.controller);
    legacy.installTriggerB((event) => updateMousePositionLegacy(
        legacy.positions.B,
        event,
        legacyApi
    ));

    moveA(candidate.events.A);
    updateMousePositionLegacy(legacy.positions.A, legacy.events.A, legacyApi);

    assert.deepEqual(candidate.trace, legacy.trace);
    assert.deepEqual(candidate.snapshots, legacy.snapshots);
    assert.deepEqual(candidate.snapshots, [{ x: 18, y: 27 }]);
    for (const owner of ['A', 'B']) {
        assertSameNumber(candidate.values[owner].x, legacy.values[owner].x, `${owner}: x`);
        assertSameNumber(candidate.values[owner].y, legacy.values[owner].y, `${owner}: y`);
    }
    assert.deepEqual(candidate.values, {
        A: { x: 10, y: 12 },
        B: { x: 18, y: 27 }
    });
});

test('50,000 deterministic raw IEEE-754 cases are Object.is-identical to legacy', async () => {
    const candidateRaw = { scale: 1, x: 0, y: 0 };
    const legacyRaw = { scale: 1, x: 0, y: 0 };
    const candidateController = {
        readScale: () => candidateRaw.scale,
        readOffsetX: () => candidateRaw.x,
        readOffsetY: () => candidateRaw.y
    };
    const legacyController = {
        readScale: () => legacyRaw.scale,
        readOffsetX: () => legacyRaw.x,
        readOffsetY: () => legacyRaw.y
    };
    const runtime = await loadMouseRuntime(candidateController);
    const handler = new runtime.MouseInputHandler();
    const move = runtime.windowTarget.get('mousemove');
    const legacyPosition = { x: 0, y: 0 };
    const legacyApi = createDisplayApi(legacyController);
    const candidateEvent = { clientX: 0, clientY: 0 };
    const legacyEvent = { clientX: 0, clientY: 0 };
    const bytes = new ArrayBuffer(8);
    const view = new DataView(bytes);
    const mask = (1n << 64n) - 1n;
    let randomState = 0x9e3779b97f4a7c15n;
    const nextFloat = () => {
        randomState ^= (randomState << 13n) & mask;
        randomState ^= randomState >> 7n;
        randomState ^= (randomState << 17n) & mask;
        randomState &= mask;
        view.setBigUint64(0, randomState, true);
        return view.getFloat64(0, true);
    };

    for (let index = 0; index < 50_000; index += 1) {
        candidateRaw.scale = nextFloat();
        candidateRaw.x = nextFloat();
        candidateRaw.y = nextFloat();
        candidateEvent.clientX = nextFloat();
        candidateEvent.clientY = nextFloat();
        Object.assign(legacyRaw, candidateRaw);
        legacyEvent.clientX = candidateEvent.clientX;
        legacyEvent.clientY = candidateEvent.clientY;

        move(candidateEvent);
        updateMousePositionLegacy(legacyPosition, legacyEvent, legacyApi);
        if (!Object.is(handler.mousePos.x, legacyPosition.x)
            || !Object.is(handler.mousePos.y, legacyPosition.y)) {
            assert.fail(`raw IEEE-754 parity mismatch at case ${index}`);
        }
    }
});
