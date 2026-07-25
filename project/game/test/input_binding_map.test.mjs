import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { InputBindingMap } = await loadGameModule('input/_input_binding_map.js');
const {
    DEFAULT_KEYBOARD_BINDINGS,
    INPUT_ACTION_IDS
} = await loadGameModule('input/_input_binding_constants.js');
const { SETTING_DEFINITIONS } = await loadGameModule(
    'data/settings/setting_definitions.js'
);
const {
    createSettingSchema,
    SettingValueCoercer
} = await loadGameModule('save/setting/_setting_schema.js');

test('InputBindingMap은 KeyboardEvent.code 오버라이드를 검증하고 기본 배치와 병합한다', () => {
    const bindingMap = new InputBindingMap({
        [INPUT_ACTION_IDS.MOVE_UP]: [
            'KeyZ',
            'KeyZ',
            'invalid-code',
            'Digit1',
            'Numpad8',
            'KeyX',
            'KeyY'
        ],
        [INPUT_ACTION_IDS.MOVE_DOWN]: [],
        [INPUT_ACTION_IDS.MOVE_LEFT]: 'not-an-array',
        unknownAction: ['KeyQ']
    });
    const bindings = bindingMap.getBindings();

    assert.deepEqual(
        Array.from(bindings[INPUT_ACTION_IDS.MOVE_UP]),
        ['KeyZ', 'Digit1', 'Numpad8', 'KeyX']
    );
    assert.deepEqual(Array.from(bindings[INPUT_ACTION_IDS.MOVE_DOWN]), []);
    assert.deepEqual(
        Array.from(bindings[INPUT_ACTION_IDS.MOVE_LEFT]),
        Array.from(DEFAULT_KEYBOARD_BINDINGS[INPUT_ACTION_IDS.MOVE_LEFT])
    );
    assert.equal('unknownAction' in bindings, false);

    bindings[INPUT_ACTION_IDS.MOVE_UP].push('KeyQ');
    assert.equal(
        bindingMap.getBindings()[INPUT_ACTION_IDS.MOVE_UP].includes('KeyQ'),
        false
    );
});

test('의미 action 조회와 edge 소비는 물리 코드를 외부 action payload로 노출하지 않는다', () => {
    const bindingMap = new InputBindingMap();
    const downCodes = new Set(['KeyW']);
    const pressedCodes = new Set(['KeyW', 'ArrowUp']);
    const keyboard = {
        isCodePressed(code) {
            return downCodes.has(code);
        },
        consumeCodePress(code) {
            const hadCode = pressedCodes.has(code);
            pressedCodes.delete(code);
            return hadCode;
        }
    };

    assert.equal(
        bindingMap.isActionPressed(INPUT_ACTION_IDS.MOVE_UP, keyboard),
        true
    );
    assert.equal(bindingMap.isActionPressed('up', keyboard), true);
    assert.equal(bindingMap.consumeActionPress('up', keyboard), true);
    assert.equal(pressedCodes.size, 0);
    assert.equal(bindingMap.consumeActionPress('up', keyboard), false);

    const actionStates = bindingMap.writeActionStates(keyboard, {
        staleAction: true
    });
    assert.equal('staleAction' in actionStates, false);
    assert.equal(actionStates[INPUT_ACTION_IDS.MOVE_UP], true);
    assert.equal('KeyW' in actionStates, false);
});

test('inputBindings 설정은 안전한 plain object 오버라이드로 복제된다', () => {
    assert.equal(SETTING_DEFINITIONS.inputBindings.type, 'object');
    assert.equal(SETTING_DEFINITIONS.inputBindings.hidden, false);

    const firstSchema = createSettingSchema('english');
    const secondSchema = createSettingSchema('english');
    assert.notStrictEqual(
        firstSchema.inputBindings.value,
        secondSchema.inputBindings.value
    );

    const maliciousBindings = JSON.parse(
        '{"moveUp":["KeyZ"],"__proto__":{"polluted":true},"constructor":{"bad":true}}'
    );
    maliciousBindings.moveDown = ['KeyS', () => 'unsafe'];
    const coercer = new SettingValueCoercer();
    const normalized = coercer.coerce(
        firstSchema,
        'inputBindings',
        maliciousBindings
    );

    assert.equal(Object.prototype.toString.call(normalized), '[object Object]');
    assert.equal(Object.getPrototypeOf(Object.getPrototypeOf(normalized)), null);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, '__proto__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(normalized, 'constructor'), false);
    assert.deepEqual(Array.from(normalized.moveUp), ['KeyZ']);
    assert.deepEqual(Array.from(normalized.moveDown), ['KeyS']);
});
