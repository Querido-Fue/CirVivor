import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGameModule } from './support/source_module_loader.mjs';

const DESCRIPTOR_SOURCE_PATH = fileURLToPath(new URL(
    '../script/module/display/display_surface_descriptor.js',
    import.meta.url
));
const descriptorSource = await readFile(DESCRIPTOR_SOURCE_PATH, 'utf8');
const productionDescriptorModule = await loadGameModule('display/display_surface_descriptor.js');
const EXECUTABLE_SOURCE_HASH = '14896625bfa4afffcfc99baee78361948cb53c5a180fcbebc3e37d790c8a9f2d';

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
 * 상속 getter의 receiver를 통해 private static order 맵을 캡처합니다.
 * @returns {object} production descriptor가 직접 소유한 frozen order 맵입니다.
 */
function captureProductionStaticOrderMap() {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const mapPrototype = getOrder('__proto__');
    const probeKey = Symbol('capture-static-order-map');
    const probeValue = { source: 'capture-static-order-map' };
    let capturedMap;

    try {
        Object.defineProperty(mapPrototype, probeKey, {
            configurable: true,
            get() {
                capturedMap = this;
                return probeValue;
            }
        });
        assert.equal(getOrder(probeKey), probeValue);
    } finally {
        assert.equal(Reflect.deleteProperty(mapPrototype, probeKey), true);
    }

    assert.ok(capturedMap);
    return capturedMap;
}

const productionStaticOrderMap = captureProductionStaticOrderMap();

test('static surface order JSDoc 변경은 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(hashExecutableSource(descriptorSource), EXECUTABLE_SOURCE_HASH);
});

test('order JSDoc은 PropertyKey·상속·truthy/falsy fallback과 실제 반환 타입을 명시한다', () => {
    const orderDoc = findLeadingJsDoc(
        descriptorSource,
        'export function getDisplayStaticSurfaceOrder\\(surfaceId\\)'
    );
    const normalizedOrderDoc = orderDoc
        .replace(/^[ \t]*\*[ \t]?/gm, '')
        .replace(/\s+/g, ' ')
        .trim();

    assert.match(normalizedOrderDoc, /@param \{\*\} surfaceId/);
    assert.equal(
        normalizedOrderDoc.includes(
            '`surfaceId`는 조회 과정에서 PropertyKey로 변환되며 '
            + '상속 프로퍼티도 조회에 포함됩니다.'
        ),
        true
    );
    assert.equal(
        normalizedOrderDoc.includes(
            '조회 결과가 truthy이면 타입을 제한하지 않고 그대로 반환하며, '
            + 'falsy이면 숫자 0을 반환합니다.'
        ),
        true
    );
    assert.equal(
        normalizedOrderDoc.includes(
            'PropertyKey 변환 또는 프로퍼티 조회 중 발생한 예외는 그대로 동기 전파됩니다.'
        ),
        true
    );
    assert.match(normalizedOrderDoc, /@returns \{\*\}/);
});

test('실제 frozen order 맵은 own 숫자와 ordinary prototype의 상속 값을 그대로 노출한다', () => {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionStaticOrderMap);

    assert.equal(Object.isFrozen(productionStaticOrderMap), true);
    assert.notEqual(mapPrototype, null);
    assert.equal(Object.getPrototypeOf(mapPrototype), null);
    assert.deepEqual(
        Reflect.ownKeys(productionStaticOrderMap),
        ['background', 'object', 'effect', 'texteffect', 'ui', 'top']
    );
    for (const [surfaceId, order] of [
        ['background', 0],
        ['object', 10],
        ['effect', 20],
        ['texteffect', 30],
        ['ui', 40],
        ['top', 1000]
    ]) {
        assert.equal(productionStaticOrderMap[surfaceId], order);
        assert.equal(getOrder(surfaceId), order);
    }

    assert.equal(Object.hasOwn(productionStaticOrderMap, 'toString'), false);
    assert.equal(getOrder('toString'), mapPrototype.toString);
    assert.equal(getOrder('valueOf'), mapPrototype.valueOf);
    assert.equal(getOrder('constructor'), mapPrototype.constructor);
    assert.equal(getOrder('__proto__'), mapPrototype);
});

test('미등록 primitive와 객체 key의 falsy lookup은 항상 양의 0으로 fallback한다', () => {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const missingSymbol = Symbol('missing-order');
    const missingObject = {};

    for (const input of [
        '',
        'missing',
        null,
        undefined,
        0,
        -0,
        17,
        17n,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        true,
        false,
        missingSymbol,
        missingObject
    ]) {
        const result = getOrder(input);
        assert.equal(result, 0);
        assert.equal(Object.is(result, 0), true);
    }
});

test('표준 ToPropertyKey 순서·Symbol 결과와 key 변환 오류 identity를 보존한다', () => {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const directTrace = [];
    const directKey = {
        [Symbol.toPrimitive](hint) {
            directTrace.push(['toPrimitive', hint]);
            return 'top';
        }
    };
    assert.equal(getOrder(directKey), 1000);
    assert.deepEqual(directTrace, [['toPrimitive', 'string']]);

    const shortCircuitTrace = [];
    const shortCircuitKey = {
        toString() {
            shortCircuitTrace.push('toString');
            return 'ui';
        },
        valueOf() {
            shortCircuitTrace.push('valueOf');
            return 'unused';
        }
    };
    assert.equal(getOrder(shortCircuitKey), 40);
    assert.deepEqual(shortCircuitTrace, ['toString']);

    const fallbackTrace = [];
    const valueOfFallbackKey = {
        toString() {
            fallbackTrace.push('toString');
            return {};
        },
        valueOf() {
            fallbackTrace.push('valueOf');
            return 'effect';
        }
    };
    assert.equal(getOrder(valueOfFallbackKey), 20);
    assert.deepEqual(fallbackTrace, ['toString', 'valueOf']);

    const reentryTrace = [];
    const reentrantKey = {
        [Symbol.toPrimitive](hint) {
            reentryTrace.push(['toPrimitive', hint]);
            reentryTrace.push(['nestedOrder', getOrder('ui')]);
            return 'top';
        }
    };
    assert.equal(getOrder(reentrantKey), 1000);
    assert.deepEqual(reentryTrace, [
        ['toPrimitive', 'string'],
        ['nestedOrder', 40]
    ]);

    const missingSymbol = Symbol('produced-missing-order');
    const symbolKey = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'string');
            return missingSymbol;
        }
    };
    assert.equal(getOrder(symbolKey), 0);

    const keyToken = new Error('order key sentinel');
    const throwingKey = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'string');
            throw keyToken;
        }
    };
    assert.throws(() => getOrder(throwingKey), (error) => error === keyToken);

    const toStringToken = new Error('order toString sentinel');
    const toStringTrace = [];
    const throwingToStringKey = {
        toString() {
            toStringTrace.push('toString');
            throw toStringToken;
        },
        valueOf() {
            toStringTrace.push('valueOf');
            return 'top';
        }
    };
    assert.throws(
        () => getOrder(throwingToStringKey),
        (error) => error === toStringToken
    );
    assert.deepEqual(toStringTrace, ['toString']);

    const valueOfToken = new Error('order valueOf sentinel');
    const valueOfTrace = [];
    const throwingValueOfKey = {
        toString() {
            valueOfTrace.push('toString');
            return {};
        },
        valueOf() {
            valueOfTrace.push('valueOf');
            throw valueOfToken;
        }
    };
    assert.throws(
        () => getOrder(throwingValueOfKey),
        (error) => error === valueOfToken
    );
    assert.deepEqual(valueOfTrace, ['toString', 'valueOf']);

    const invalidPrimitiveKey = {
        [Symbol.toPrimitive]() {
            return {};
        }
    };
    assert.throws(
        () => getOrder(invalidPrimitiveKey),
        (error) => error?.name === 'TypeError'
    );

    const nullPrototypeKey = Object.create(null);
    assert.throws(
        () => getOrder(nullPrototypeKey),
        (error) => error?.name === 'TypeError'
    );
});

test('actual map prototype의 live getter는 receiver·truthy/falsy·재진입·예외를 보존한다', () => {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionStaticOrderMap);
    const liveKey = Symbol('live-inherited-order');
    const reentryKey = Symbol('reentrant-inherited-order');
    const throwingKey = Symbol('throwing-inherited-order');
    const trace = [];
    const truthyObject = { source: 'inherited-order' };
    const reentryObject = { source: 'reentrant-order' };
    const getterToken = new Error('order getter sentinel');
    let liveValue = truthyObject;
    let liveReceiver;
    let liveReadCount = 0;

    try {
        Object.defineProperty(mapPrototype, liveKey, {
            configurable: true,
            get() {
                liveReceiver = this;
                liveReadCount += 1;
                trace.push(['liveGet', liveValue]);
                return liveValue;
            }
        });
        Object.defineProperty(mapPrototype, reentryKey, {
            configurable: true,
            get() {
                trace.push(['reentryGet']);
                trace.push(['nestedOrder', getOrder('top')]);
                return reentryObject;
            }
        });
        Object.defineProperty(mapPrototype, throwingKey, {
            configurable: true,
            get() {
                trace.push(['throwingGet']);
                throw getterToken;
            }
        });

        assert.equal(getOrder(liveKey), truthyObject);
        assert.equal(liveReceiver, productionStaticOrderMap);
        assert.equal(liveReadCount, 1);
        assert.deepEqual(trace, [['liveGet', truthyObject]]);

        for (const falsyValue of [0, -0, '', false, Number.NaN, 0n, null, undefined]) {
            trace.length = 0;
            liveValue = falsyValue;
            const result = getOrder(liveKey);
            assert.equal(Object.is(result, 0), true);
            assert.deepEqual(trace, [['liveGet', falsyValue]]);
        }

        const truthySymbol = Symbol('truthy-order-value');
        for (const truthyValue of [-1, Number.POSITIVE_INFINITY, 1n, truthySymbol]) {
            trace.length = 0;
            liveValue = truthyValue;
            assert.equal(getOrder(liveKey), truthyValue);
            assert.deepEqual(trace, [['liveGet', truthyValue]]);
        }

        trace.length = 0;
        assert.equal(getOrder(reentryKey), reentryObject);
        assert.deepEqual(trace, [
            ['reentryGet'],
            ['nestedOrder', 1000]
        ]);

        trace.length = 0;
        assert.throws(() => getOrder(throwingKey), (error) => error === getterToken);
        assert.deepEqual(trace, [['throwingGet']]);

        trace.length = 0;
        liveValue = truthyObject;
        const coercingKey = {
            [Symbol.toPrimitive](hint) {
                trace.push(['toPrimitive', hint]);
                return liveKey;
            }
        };
        assert.equal(getOrder(coercingKey), truthyObject);
        assert.deepEqual(trace, [
            ['toPrimitive', 'string'],
            ['liveGet', truthyObject]
        ]);
    } finally {
        assert.equal(Reflect.deleteProperty(mapPrototype, liveKey), true);
        assert.equal(Reflect.deleteProperty(mapPrototype, reentryKey), true);
        assert.equal(Reflect.deleteProperty(mapPrototype, throwingKey), true);
        assert.equal(Object.hasOwn(mapPrototype, liveKey), false);
        assert.equal(Object.hasOwn(mapPrototype, reentryKey), false);
        assert.equal(Object.hasOwn(mapPrototype, throwingKey), false);
    }
});

test('actual descriptor 생성의 기본 order 경로는 resolver 결과와 변환 순서를 보존한다', () => {
    const {
        createDisplaySurfaceDescriptor: createDescriptor
    } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionStaticOrderMap);
    const inheritedCallerKey = '__display_order_contract_inherited_caller__';
    const inheritedOrder = { source: 'caller-inherited-order' };

    assert.equal(createDescriptor({ id: 'background' }).order, 0);
    assert.equal(createDescriptor({ id: 'top' }).order, 1000);
    assert.equal(createDescriptor({ id: 'toString' }).order, mapPrototype.toString);

    const defaultTrace = [];
    let defaultConversionCount = 0;
    const defaultId = {
        [Symbol.toPrimitive](hint) {
            defaultConversionCount += 1;
            defaultTrace.push(['toPrimitive', hint, defaultConversionCount]);
            return defaultConversionCount === 1 ? 'top' : 'display-id';
        }
    };
    const defaultDescriptor = createDescriptor({ id: defaultId });
    assert.equal(defaultDescriptor.id, defaultId);
    assert.equal(defaultDescriptor.order, 1000);
    assert.equal(defaultDescriptor.compositeSnapshot.snapshotIdentity, 'before:display-id');
    assert.deepEqual(defaultTrace, [
        ['toPrimitive', 'string', 1],
        ['toPrimitive', 'string', 2]
    ]);

    const explicitTrace = [];
    const explicitId = {
        [Symbol.toPrimitive](hint) {
            explicitTrace.push(['toPrimitive', hint]);
            return 'explicit-id';
        }
    };
    const explicitDescriptor = createDescriptor({ id: explicitId, order: -0 });
    assert.equal(Object.is(explicitDescriptor.order, -0), true);
    assert.equal(explicitDescriptor.compositeSnapshot.snapshotIdentity, 'before:explicit-id');
    assert.deepEqual(explicitTrace, [['toPrimitive', 'string']]);

    assert.equal(Object.hasOwn(mapPrototype, inheritedCallerKey), false);
    try {
        Object.defineProperty(mapPrototype, inheritedCallerKey, {
            configurable: true,
            get() {
                assert.equal(this, productionStaticOrderMap);
                return inheritedOrder;
            }
        });
        const inheritedDescriptor = createDescriptor({ id: inheritedCallerKey });
        assert.equal(inheritedDescriptor.order, inheritedOrder);
        assert.equal(
            inheritedDescriptor.compositeSnapshot.snapshotIdentity,
            `before:${inheritedCallerKey}`
        );
    } finally {
        assert.equal(Reflect.deleteProperty(mapPrototype, inheritedCallerKey), true);
        assert.equal(Object.hasOwn(mapPrototype, inheritedCallerKey), false);
    }

    const keyToken = new Error('descriptor order key sentinel');
    const throwingId = {
        [Symbol.toPrimitive](hint) {
            assert.equal(hint, 'string');
            throw keyToken;
        }
    };
    assert.throws(
        () => createDescriptor({ id: throwingId }),
        (error) => error === keyToken
    );
});

test('order resolver의 함수 shape·this 무시·constructability를 현재 실행 의미로 고정한다', () => {
    const { getDisplayStaticSurfaceOrder: getOrder } = productionDescriptorModule;
    const mapPrototype = Object.getPrototypeOf(productionStaticOrderMap);

    assert.equal(getOrder.name, 'getDisplayStaticSurfaceOrder');
    assert.equal(getOrder.length, 1);
    assert.equal(Object.hasOwn(getOrder, 'prototype'), true);
    assert.equal(getOrder.call({ ignored: true }, 'top', 'extra'), 1000);
    assert.equal(new getOrder('__proto__'), mapPrototype);

    const constructedFromPrimitive = new getOrder('top');
    assert.equal(constructedFromPrimitive instanceof getOrder, true);
    const constructedFromFallback = new getOrder('missing');
    assert.equal(constructedFromFallback instanceof getOrder, true);
});
