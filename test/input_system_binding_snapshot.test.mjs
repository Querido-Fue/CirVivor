import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const INPUT_ROOT = path.join(SCRIPT_ROOT, 'module', 'input');
const INPUT_SYSTEM_PATH = path.join(INPUT_ROOT, 'input_system.js');
const INPUT_BINDING_MAP_PATH = path.join(INPUT_ROOT, '_input_binding_map.js');
const INPUT_BINDING_CONSTANTS_PATH = path.join(
    INPUT_ROOT,
    '_input_binding_constants.js'
);

test('InputSystem snapshot은 물리 코드를 숨기고 설정된 의미 action과 누적 wheel만 전달한다', async () => {
    const context = vm.createContext({ console });
    const keyboardInstances = [];
    const mouseInstances = [];

    class KeyboardInputHandler {
        constructor() {
            this.downCodes = new Set();
            this.pressedCodes = new Set();
            keyboardInstances.push(this);
        }

        update() {}
        resetKeyboardInput() {
            this.downCodes.clear();
            this.pressedCodes.clear();
        }
        isCodePressed(code) {
            return this.downCodes.has(code);
        }
        consumeCodePress(code) {
            const consumed = this.pressedCodes.has(code);
            this.pressedCodes.delete(code);
            return consumed;
        }
    }

    class MouseInputHandler {
        constructor() {
            this.mousePos = { x: 120, y: 80 };
            this.wheelTotals = { x: 0.5, y: -2 };
            this.mouseButtons = {
                left: { state: ['idle'] },
                right: { state: ['idle'] },
                middle: { state: ['idle'] }
            };
            this.focusList = ['ui', 'object'];
            mouseInstances.push(this);
        }

        update() {}
        resetMouseInput() {}
        copyWheelTotalsInto(out) {
            Object.assign(out, this.wheelTotals);
            return out;
        }
        getMouseInput() {
            return null;
        }
        hasButtonState() {
            return false;
        }
        consumeButtonState() {
            return false;
        }
        setFocus() {}
        addFocus() {}
        removeFocus() {}
    }

    const createSyntheticModule = (identifier, exports) => new vm.SyntheticModule(
        Object.keys(exports),
        function initialize() {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        },
        { context, identifier }
    );
    const keyboardModule = createSyntheticModule(
        '_keyboard_input_handler.js',
        { KeyboardInputHandler }
    );
    const mouseModule = createSyntheticModule(
        '_mouse_input_handler.js',
        { MouseInputHandler }
    );
    const numberModule = createSyntheticModule(
        'util/number_util.js',
        {
            resolveFiniteNumber(value, fallback) {
                return Number.isFinite(value) ? value : fallback;
            }
        }
    );
    const bindingConstantsModule = new vm.SourceTextModule(
        await readFile(INPUT_BINDING_CONSTANTS_PATH, 'utf8'),
        { context, identifier: INPUT_BINDING_CONSTANTS_PATH }
    );
    const bindingMapModule = new vm.SourceTextModule(
        await readFile(INPUT_BINDING_MAP_PATH, 'utf8'),
        { context, identifier: INPUT_BINDING_MAP_PATH }
    );
    const inputSystemModule = new vm.SourceTextModule(
        await readFile(INPUT_SYSTEM_PATH, 'utf8'),
        { context, identifier: INPUT_SYSTEM_PATH }
    );

    await inputSystemModule.link(async (specifier, referencingModule) => {
        if (specifier === './_mouse_input_handler.js') return mouseModule;
        if (specifier === './_keyboard_input_handler.js') return keyboardModule;
        if (specifier === './_input_binding_map.js') return bindingMapModule;
        if (specifier === './_input_binding_constants.js') {
            return bindingConstantsModule;
        }
        if (specifier === 'util/number_util.js') return numberModule;
        throw new Error(
            `unexpected input import ${specifier} from ${referencingModule.identifier}`
        );
    });
    await inputSystemModule.evaluate();

    const api = inputSystemModule.namespace;
    const system = new api.InputSystem({
        bindings: { moveUp: ['KeyZ'] }
    });
    const keyboard = keyboardInstances[0];
    const mouse = mouseInstances[0];
    keyboard.downCodes.add('KeyZ');
    keyboard.pressedCodes.add('KeyZ');

    const snapshot = system.getSimulationInputSnapshot();
    assert.equal(snapshot.mousePos.x, 120);
    assert.equal(snapshot.mousePos.y, 80);
    assert.deepEqual({ ...snapshot.wheel }, { x: 0.5, y: -2 });
    assert.equal(snapshot.actionStates.moveUp, true);
    assert.equal(snapshot.keys.moveUp, true);
    assert.equal('KeyZ' in snapshot.actionStates, false);
    assert.equal('KeyZ' in snapshot.keys, false);
    assert.equal(api.getKeyboardInput('moveUp'), true);
    assert.equal(api.consumeKeyboardPress('moveUp'), true);
    assert.equal(api.consumeKeyboardPress('moveUp'), false);

    keyboard.pressedCodes.add('KeyQ');
    system.setBindings({ moveUp: ['KeyX'] });
    assert.equal(keyboard.downCodes.size, 0);
    assert.equal(keyboard.pressedCodes.size, 0);
    assert.equal(system.isActionPressed('moveUp'), false);
    keyboard.downCodes.add('KeyX');
    assert.equal(system.isActionPressed('moveUp'), true);

    mouse.wheelTotals.y = -3;
    const reusedWheel = snapshot.wheel;
    const reusedActionStates = snapshot.actionStates;
    assert.strictEqual(system.getSimulationInputSnapshot(snapshot), snapshot);
    assert.strictEqual(snapshot.wheel, reusedWheel);
    assert.strictEqual(snapshot.actionStates, reusedActionStates);
    assert.equal(snapshot.wheel.y, -3);
});
