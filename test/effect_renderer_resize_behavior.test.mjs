import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const EFFECT_RENDERER_SOURCE_PATH = fileURLToPath(new URL(
    '../project/game/script/module/display/webgl/_effect_renderer.js',
    import.meta.url
));
const effectRendererSource = await readFile(EFFECT_RENDERER_SOURCE_PATH, 'utf8');
const { EffectRenderer } = await loadGameModule('display/webgl/_effect_renderer.js');

/**
 * constructor의 GL 초기화를 우회하고 actual prototype method만 사용하는 receiver를 생성합니다.
 * @param {number} [width=0] - 초기 너비입니다.
 * @param {number} [height=0] - 초기 높이입니다.
 * @returns {EffectRenderer} 최소 receiver입니다.
 */
function createBareRenderer(width = 0, height = 0) {
    const renderer = Object.create(EffectRenderer.prototype);
    renderer.width = width;
    renderer.height = height;
    return renderer;
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

/**
 * `Object.is`로 number 결과를 비교합니다.
 * @param {number} actual - 실제 결과입니다.
 * @param {number} expected - 예상 결과입니다.
 * @param {string} label - assertion 문맥입니다.
 */
function assertSameNumber(actual, expected, label) {
    assert.equal(Object.is(actual, expected), true, `${label}: ${String(actual)} !== ${String(expected)}`);
}

test('actual resize preserves exact Math.floor and Math.max edge results on both axes', () => {
    const cases = [
        { input: Number.NEGATIVE_INFINITY, expected: 1 },
        { input: -Number.MAX_VALUE, expected: 1 },
        { input: -1.1, expected: 1 },
        { input: -0, expected: 1 },
        { input: 0, expected: 1 },
        { input: Number.MIN_VALUE, expected: 1 },
        { input: 0.9999999999999999, expected: 1 },
        { input: 1, expected: 1 },
        { input: 1.0000000000000002, expected: 1 },
        { input: 1.9999999999999998, expected: 1 },
        { input: 2, expected: 2 },
        { input: 2.9999999999999996, expected: 2 },
        { input: Number.MAX_VALUE, expected: Number.MAX_VALUE },
        { input: Number.POSITIVE_INFINITY, expected: Number.POSITIVE_INFINITY },
        { input: Number.NaN, expected: Number.NaN },
        { input: undefined, expected: Number.NaN },
        { input: null, expected: 1 },
        { input: false, expected: 1 },
        { input: true, expected: 1 },
        { input: '', expected: 1 },
        { input: '   ', expected: 1 },
        { input: '3.9', expected: 3 },
        { input: '0x10', expected: 16 },
        { input: 'Infinity', expected: Number.POSITIVE_INFINITY }
    ];

    for (const { input, expected } of cases) {
        const widthRenderer = createBareRenderer(91, 92);
        assert.equal(widthRenderer.resize(input, 7.9), undefined);
        assertSameNumber(widthRenderer.width, expected, `width ${String(input)}`);
        assertSameNumber(widthRenderer.height, 7, `height control ${String(input)}`);

        const heightRenderer = createBareRenderer(91, 92);
        assert.equal(heightRenderer.resize(6.9, input), undefined);
        assertSameNumber(heightRenderer.width, 6, `width control ${String(input)}`);
        assertSameNumber(heightRenderer.height, expected, `height ${String(input)}`);
    }
});

test('actual resize follows standard ToPrimitive number hint and valueOf-toString fallback order', () => {
    const trace = [];
    const widthInput = {};
    Object.defineProperty(widthInput, Symbol.toPrimitive, {
        get() {
            assert.strictEqual(this, widthInput);
            trace.push('width:toPrimitive:get');
            return function toPrimitive(hint) {
                assert.strictEqual(this, widthInput);
                trace.push(`width:toPrimitive:call:${hint}`);
                return '4.9';
            };
        }
    });
    const heightInput = {
        valueOf() {
            assert.strictEqual(this, heightInput);
            trace.push('height:valueOf');
            return {};
        },
        toString() {
            assert.strictEqual(this, heightInput);
            trace.push('height:toString');
            return '5.9';
        }
    };
    const renderer = createBareRenderer();

    assert.equal(renderer.resize(widthInput, heightInput), undefined);
    assert.equal(renderer.width, 4);
    assert.equal(renderer.height, 5);
    assert.deepEqual(trace, [
        'width:toPrimitive:get',
        'width:toPrimitive:call:number',
        'height:valueOf',
        'height:toString'
    ]);
});

test('resize converts and assigns width before beginning height and preserves exact receiver', () => {
    const trace = [];
    const target = {};
    let receiver;
    receiver = new Proxy(target, {
        set(targetObject, property, value, setReceiver) {
            assert.strictEqual(setReceiver, receiver);
            trace.push(`set:${String(property)}:${String(value)}`);
            targetObject[property] = value;
            return true;
        }
    });
    const widthInput = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'number');
            trace.push('coerce:width');
            return 8.9;
        }
    };
    const heightInput = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'number');
            trace.push('coerce:height');
            return 9.9;
        }
    };

    assert.equal(Reflect.apply(EffectRenderer.prototype.resize, receiver, [widthInput, heightInput]), undefined);
    assert.deepEqual(trace, [
        'coerce:width',
        'set:width:8',
        'coerce:height',
        'set:height:9'
    ]);
    assert.equal(target.width, 8);
    assert.equal(target.height, 9);
});

test('width and height conversion failures preserve exact partial state and error identity', () => {
    const widthError = Object.freeze({ stage: 'width conversion' });
    const widthRenderer = createBareRenderer(11, 12);
    let heightCoercions = 0;
    const throwingWidth = {
        [Symbol.toPrimitive]() {
            throw widthError;
        }
    };
    const observedHeight = {
        [Symbol.toPrimitive]() {
            heightCoercions += 1;
            return 99;
        }
    };

    assert.strictEqual(captureThrown(() => widthRenderer.resize(throwingWidth, observedHeight)), widthError);
    assert.equal(widthRenderer.width, 11);
    assert.equal(widthRenderer.height, 12);
    assert.equal(heightCoercions, 0);

    const heightError = Object.freeze({ stage: 'height conversion' });
    const heightRenderer = createBareRenderer(21, 22);
    const throwingHeight = {
        [Symbol.toPrimitive]() {
            throw heightError;
        }
    };

    assert.strictEqual(captureThrown(() => heightRenderer.resize(7.9, throwingHeight)), heightError);
    assert.equal(heightRenderer.width, 7);
    assert.equal(heightRenderer.height, 22);

    for (const invalidWidth of [Symbol('size'), 1n]) {
        const renderer = createBareRenderer(31, 32);
        const thrown = captureThrown(() => renderer.resize(invalidWidth, 40));
        assert.equal(thrown?.name, 'TypeError');
        assert.equal(renderer.width, 31);
        assert.equal(renderer.height, 32);
    }

    const invalidPrimitiveRenderer = createBareRenderer(41, 42);
    const invalidPrimitive = {
        [Symbol.toPrimitive]() {
            return {};
        }
    };
    const invalidPrimitiveError = captureThrown(() => invalidPrimitiveRenderer.resize(invalidPrimitive, 50));
    assert.equal(invalidPrimitiveError?.name, 'TypeError');
    assert.equal(invalidPrimitiveRenderer.width, 41);
    assert.equal(invalidPrimitiveRenderer.height, 42);
});

test('assignment failures stop later work without rolling back an earlier width assignment', () => {
    const widthSetError = Object.freeze({ stage: 'width set' });
    let heightCoercions = 0;
    const widthFailReceiver = {};
    Object.defineProperty(widthFailReceiver, 'width', {
        set(value) {
            assert.equal(value, 3);
            throw widthSetError;
        }
    });
    const observedHeight = {
        [Symbol.toPrimitive]() {
            heightCoercions += 1;
            return 4;
        }
    };

    assert.strictEqual(
        captureThrown(() => Reflect.apply(EffectRenderer.prototype.resize, widthFailReceiver, [3.9, observedHeight])),
        widthSetError
    );
    assert.equal(heightCoercions, 0);

    const heightSetError = Object.freeze({ stage: 'height set' });
    let assignedWidth;
    const heightFailReceiver = {};
    Object.defineProperties(heightFailReceiver, {
        width: {
            set(value) {
                assignedWidth = value;
            }
        },
        height: {
            set(value) {
                assert.equal(value, 6);
                throw heightSetError;
            }
        }
    });

    assert.strictEqual(
        captureThrown(() => Reflect.apply(EffectRenderer.prototype.resize, heightFailReceiver, [5.9, 6.9])),
        heightSetError
    );
    assert.equal(assignedWidth, 5);
});

test('resize coercion can reenter and the outer sequential assignments win without a guard', () => {
    const renderer = createBareRenderer(0, 0);
    const trace = [];
    let didReenter = false;
    const outerWidth = {
        [Symbol.toPrimitive]() {
            trace.push('outer-width:coerce');
            if (!didReenter) {
                didReenter = true;
                trace.push('nested:start');
                assert.equal(renderer.resize(10.9, 20.9), undefined);
                trace.push(`nested:end:${renderer.width}:${renderer.height}`);
            }
            return 3.9;
        }
    };
    const outerHeight = {
        [Symbol.toPrimitive]() {
            trace.push('outer-height:coerce');
            return 4.9;
        }
    };

    assert.equal(renderer.resize(outerWidth, outerHeight), undefined);
    assert.deepEqual(trace, [
        'outer-width:coerce',
        'nested:start',
        'nested:end:10:20',
        'outer-height:coerce'
    ]);
    assert.equal(renderer.width, 3);
    assert.equal(renderer.height, 4);
});
