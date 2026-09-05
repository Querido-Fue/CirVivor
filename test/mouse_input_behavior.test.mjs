import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MOUSE_HANDLER_PATH = fileURLToPath(new URL('../project/game/script/module/input/_mouse_input_handler.js', import.meta.url));
const NUMBER_UTIL_PATH = fileURLToPath(new URL('../project/game/script/util/number_util.js', import.meta.url));
const [mouseHandlerSource, numberUtilSource] = await Promise.all([
    readFile(MOUSE_HANDLER_PATH, 'utf8'), readFile(NUMBER_UTIL_PATH, 'utf8')
]);

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

function createController(raw = { scale: 2, x: 10, y: 20 }) {
    return { readScale: () => raw.scale, readOffsetX: () => raw.x, readOffsetY: () => raw.y };
}

test('bubbling mousemove performs one allocation-free projection per event', async () => {
    let reads = 0;
    const runtime = await loadMouseRuntime({
        ...createController(), readScale: () => { reads++; return 2; }
    });
    const handler = new runtime.MouseInputHandler();
    const event = { clientX: 15, clientY: 26 };
    for (const target of [runtime.documentTarget, runtime.windowTarget]) {
        for (let i = 0; i < target.count('mousemove'); i++) target.get('mousemove', i)(event);
    }
    assert.equal(reads, 1);
    assert.deepEqual({ ...handler.mousePos }, { x: 10, y: 12 });
});

test('pointer projection handles offsets, numeric settings, and finite fallbacks', async () => {
    const raw = {};
    const runtime = await loadMouseRuntime(createController(raw));
    const handler = new runtime.MouseInputHandler();
    const move = runtime.windowTarget.get('mousemove');
    for (const [scale, x, y, clientX, clientY, expected] of [
        [2, 10, 20, 15, 26, { x: 10, y: 12 }],
        [0.5, -20, 30, 0, -10, { x: 10, y: -20 }],
        ['2.5', '-4', '8', '12', '-4', { x: 40, y: -30 }],
        [Infinity, NaN, -Infinity, NaN, Infinity, { x: 0, y: 0 }]
    ]) {
        Object.assign(raw, { scale, x, y });
        move({ clientX, clientY });
        assert.deepEqual({ ...handler.mousePos }, expected);
    }
});

test('resize reprojects the last pointer without another DOM event or replacing its object', async () => {
    const raw = { scale: 2, x: 10, y: 20 };
    const runtime = await loadMouseRuntime(createController(raw));
    const handler = new runtime.MouseInputHandler();
    const position = handler.getMouseInput('pos');
    assert.equal(handler.refreshMousePosition(), false);
    runtime.windowTarget.get('mousemove')({ clientX: 30, clientY: 50 });
    Object.assign(raw, { scale: 3, x: 5, y: 10 });
    assert.equal(handler.refreshMousePosition(), true);
    assert.equal(handler.getMouseInput('pos'), position);
    assert.deepEqual({ ...position }, { x: 75, y: 120 });
});

test('button events update the pointer and queue exact press/release edges', async () => {
    const runtime = await loadMouseRuntime(createController());
    const handler = new runtime.MouseInputHandler();
    runtime.windowTarget.get('mousedown')({ clientX: 19, clientY: 32, button: 0, timeStamp: 101 });
    assert.deepEqual({ ...handler.mousePos }, { x: 18, y: 24 });
    runtime.windowTarget.get('mouseup')({ clientX: 21, clientY: 35, button: 0, timeStamp: 202 });
    assert.deepEqual({ ...handler.mousePos }, { x: 22, y: 30 });
    assert.deepEqual(handler.buttonStateMachine.calls, [
        ['queueButtonStateChange', 0, 'press', 101],
        ['queueButtonStateChange', 0, 'release', 202]
    ]);
});

test('focus loss clears buttons while a focused document exit resets them', async () => {
    const runtime = await loadMouseRuntime(createController());
    const handler = new runtime.MouseInputHandler();
    runtime.windowTarget.get('blur')();
    runtime.documentTarget.target.hidden = true;
    runtime.documentTarget.get('visibilitychange')();
    runtime.documentTarget.target.hidden = false;
    runtime.documentTarget.get('visibilitychange')();
    runtime.documentTarget.get('mouseleave')();
    assert.deepEqual(handler.buttonStateMachine.calls, [
        ['setAllButtonsInactive'], ['setAllButtonsInactive'], ['resetAllButtons']
    ]);
});
