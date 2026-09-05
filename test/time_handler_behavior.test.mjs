import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = fileURLToPath(new URL('../project/game/script/', import.meta.url));
const TIME_HANDLER_PATH = path.join(SCRIPT_ROOT, 'time_handler.js');
const NUMBER_UTIL_PATH = path.join(SCRIPT_ROOT, 'util', 'number_util.js');
const [timeHandlerSource, numberUtilSource] = await Promise.all([
    readFile(TIME_HANDLER_PATH, 'utf8'),
    readFile(NUMBER_UTIL_PATH, 'utf8')
]);

/**
 * 실제 TimeHandler와 숫자 유틸 production 모듈을 새 VM realm에 로드합니다.
 * @param {number} [initialNow=0] - 초기 performance.now 반환값입니다.
 * @returns {Promise<object>} 테스트 하네스입니다.
 */
async function createTimeHarness(initialNow = 0) {
    let nowImplementation = () => initialNow;
    let nowCallCount = 0;
    const performanceApi = {
        now() {
            nowCallCount += 1;
            return nowImplementation();
        }
    };
    const context = vm.createContext({ performance: performanceApi });
    const numberUtilModule = new vm.SourceTextModule(numberUtilSource, {
        context,
        identifier: NUMBER_UTIL_PATH
    });
    const timeHandlerModule = new vm.SourceTextModule(timeHandlerSource, {
        context,
        identifier: TIME_HANDLER_PATH
    });
    await timeHandlerModule.link((specifier) => {
        assert.equal(specifier, 'util/number_util.js');
        return numberUtilModule;
    });
    await timeHandlerModule.evaluate();

    return {
        context,
        namespace: timeHandlerModule.namespace,
        getNowCallCount: () => nowCallCount,
        setNowImplementation(replacement) {
            nowImplementation = replacement;
        }
    };
}

test('생성 전 export 기본값과 생성·교체·부분 초기화 싱글톤 계약을 보존한다', async () => {
    const harness = await createTimeHarness(125);
    const api = harness.namespace;
    assert.equal(api.getTimeHandler(), null);
    assert.equal(api.getDelta(), 0);
    assert.equal(api.getFixedDelta(), 0);
    assert.equal(api.getFixedInterpolationAlpha(), 1);

    const first = new api.TimeHandler();
    assert.equal(harness.getNowCallCount(), 1);
    assert.equal(api.getTimeHandler(), first);
    assert.equal(first.timeBefore, 125);
    assert.equal(first.fixedStepSeconds, 1 / 60);
    assert.equal(first.lastFrameTimeDelta, 1 / 60);
    assert.equal(first.lastFixedTimeDelta, 1 / 60);
    assert.equal(first.fixedInterpolationAlpha, 0);
    assert.equal(api.getDelta(), 1 / 60);
    assert.equal(api.getFixedDelta(), 1 / 60);
    assert.equal(api.getFixedInterpolationAlpha(), 0);

    harness.setNowImplementation(() => 250);
    const second = new api.TimeHandler();
    assert.equal(api.getTimeHandler(), second);
    assert.notEqual(second, first);
    assert.equal(second.timeBefore, 250);
    assert.equal(first.timeBefore, 125);

    const failureHarness = await createTimeHarness();
    const constructorToken = new Error('performance.now constructor sentinel');
    failureHarness.setNowImplementation(() => {
        throw constructorToken;
    });
    assert.throws(
        () => new failureHarness.namespace.TimeHandler(),
        (error) => error === constructorToken
    );
    const partialInstance = failureHarness.namespace.getTimeHandler();
    assert.ok(partialInstance instanceof failureHarness.namespace.TimeHandler);
    assert.equal(Object.hasOwn(partialInstance, 'timeBefore'), false);
    assert.equal(failureHarness.namespace.getDelta(), undefined);
    assert.equal(failureHarness.namespace.getFixedDelta(), undefined);
    assert.equal(failureHarness.namespace.getFixedInterpolationAlpha(), undefined);

    const reentryHarness = await createTimeHarness();
    let innerInstance;
    let isOuterSample = true;
    reentryHarness.setNowImplementation(() => {
        if (isOuterSample) {
            isOuterSample = false;
            innerInstance = new reentryHarness.namespace.TimeHandler();
            return 300;
        }
        return 200;
    });
    const outerInstance = new reentryHarness.namespace.TimeHandler();
    assert.equal(outerInstance.timeBefore, 300);
    assert.equal(innerInstance.timeBefore, 200);
    assert.equal(reentryHarness.namespace.getTimeHandler(), innerInstance);
});

test('update 양수 주입 경로는 performance 시각을 건드리지 않고 2~100ms로 정규화한다', async () => {
    const harness = await createTimeHarness(1000);
    const handler = new harness.namespace.TimeHandler();
    const cases = [
        [Number.MIN_VALUE, 0.002],
        [0.001, 0.002],
        [0.002, 0.002],
        [0.025, 0.025],
        [0.1, 0.1],
        [0.10000000000000002, 0.1],
        [1, 0.1],
        [Number.MAX_VALUE, 0.002],
        ['0.04', 0.04],
        [true, 0.1],
        [1n, 0.1]
    ];

    for (const [input, expected] of cases) {
        assert.equal(handler.update(input), undefined);
        assert.equal(handler.lastFrameTimeDelta, expected, `input=${String(input)}`);
        assert.equal(handler.timeBefore, 1000);
    }
    assert.equal(harness.getNowCallCount(), 1);
});

test('update fallback·coercion·예외는 시각 갱신 순서와 이전 델타를 보존한다', async () => {
    const harness = await createTimeHarness(100);
    const handler = new harness.namespace.TimeHandler();
    let now = 101;
    harness.setNowImplementation(() => now);

    assert.equal(handler.update(0), undefined);
    assert.equal(handler.timeBefore, 101);
    assert.equal(handler.lastFrameTimeDelta, 0.002);
    now = 301;
    assert.equal(handler.update(Number.NaN), undefined);
    assert.equal(handler.timeBefore, 301);
    assert.equal(handler.lastFrameTimeDelta, 0.1);
    now = 326;
    assert.equal(handler.update(undefined), undefined);
    assert.equal(handler.timeBefore, 326);
    assert.equal(handler.lastFrameTimeDelta, 0.025);
    for (const input of [null, false, -0, -1, Infinity, -Infinity]) {
        assert.equal(handler.update(input), undefined);
        assert.equal(handler.timeBefore, 326);
        assert.equal(handler.lastFrameTimeDelta, 0.002);
    }

    const coercionTrace = [];
    const coercible = {
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(hint);
            return '0.03';
        }
    };
    assert.equal(handler.update(coercible), undefined);
    assert.deepEqual(coercionTrace, ['number']);
    assert.equal(handler.lastFrameTimeDelta, 0.03);
    assert.equal(handler.timeBefore, 326);

    const coercionToken = new Error('delta coercion sentinel');
    assert.throws(
        () => handler.update({
            [Symbol.toPrimitive]() {
                throw coercionToken;
            }
        }),
        (error) => error === coercionToken
    );

    const reentryTrace = [];
    assert.equal(handler.update({
        [Symbol.toPrimitive](hint) {
            reentryTrace.push(['outer-coerce', hint]);
            handler.update(0.02);
            reentryTrace.push(['inner-delta', handler.lastFrameTimeDelta]);
            return 0.04;
        }
    }), undefined);
    assert.deepEqual(reentryTrace, [
        ['outer-coerce', 'number'],
        ['inner-delta', 0.02]
    ]);
    assert.equal(handler.lastFrameTimeDelta, 0.04);
    assert.equal(handler.timeBefore, 326);

    const previousDelta = handler.lastFrameTimeDelta;
    const previousTime = handler.timeBefore;
    const previousNowCalls = harness.getNowCallCount();
    for (const invalid of [Symbol('delta'), Object.create(null)]) {
        assert.throws(() => handler.update(invalid), (error) => error?.name === 'TypeError');
        assert.equal(handler.lastFrameTimeDelta, previousDelta);
        assert.equal(handler.timeBefore, previousTime);
        assert.equal(harness.getNowCallCount(), previousNowCalls);
    }
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.throws(() => handler.update(proxy), (error) => error?.name === 'TypeError');
    assert.equal(handler.lastFrameTimeDelta, previousDelta);
    assert.equal(handler.timeBefore, previousTime);
});

test('update fallback은 역행·비유한 clock과 정규화 예외의 부분 쓰기 순서를 보존한다', async () => {
    const harness = await createTimeHarness(100);
    const handler = new harness.namespace.TimeHandler();
    harness.setNowImplementation(() => 90);
    handler.lastFrameTimeDelta = 0.05;
    assert.equal(handler.update(0), undefined);
    assert.equal(handler.timeBefore, 90);
    assert.equal(handler.lastFrameTimeDelta, 0.002);

    for (const clockValue of [Infinity, -Infinity, Number.NaN]) {
        harness.setNowImplementation(() => clockValue);
        assert.equal(handler.update(undefined), undefined);
        assert.equal(Object.is(handler.timeBefore, clockValue), true);
        assert.equal(handler.lastFrameTimeDelta, 0.002);
    }

    const normalizationToken = new Error('delta normalization sentinel');
    handler.timeBefore = 500;
    handler.lastFrameTimeDelta = 0.07;
    handler._normalizeDeltaMs = () => {
        throw normalizationToken;
    };
    harness.setNowImplementation(() => 525);
    assert.throws(() => handler.update(null), (error) => error === normalizationToken);
    assert.equal(handler.timeBefore, 525);
    assert.equal(handler.lastFrameTimeDelta, 0.07);
});

test('freezeFrameDelta는 시각을 먼저 샘플링하고 성공한 경우에만 델타를 0으로 만든다', async () => {
    const harness = await createTimeHarness(10);
    const handler = new harness.namespace.TimeHandler();
    handler.lastFrameTimeDelta = 0.08;
    harness.setNowImplementation(() => 77);
    assert.equal(handler.freezeFrameDelta(), undefined);
    assert.equal(handler.timeBefore, 77);
    assert.equal(handler.lastFrameTimeDelta, 0);

    const token = new Error('freeze performance sentinel');
    handler.timeBefore = 88;
    handler.lastFrameTimeDelta = 0.04;
    harness.setNowImplementation(() => {
        throw token;
    });
    assert.throws(() => handler.freezeFrameDelta(), (error) => error === token);
    assert.equal(handler.timeBefore, 88);
    assert.equal(handler.lastFrameTimeDelta, 0.04);
});

test('updateFixed는 Number 변환 후 양수 유한값만 채택하고 현재 fixedStep으로 fallback한다', async () => {
    const harness = await createTimeHarness();
    const handler = new harness.namespace.TimeHandler();
    handler.fixedStepSeconds = 0.02;

    for (const invalid of [undefined, null, false, 0, -0, -1, Number.NaN, Infinity, -Infinity, '']) {
        handler.lastFixedTimeDelta = 0.5;
        assert.equal(handler.updateFixed(invalid), undefined);
        assert.equal(handler.lastFixedTimeDelta, 0.02, `input=${String(invalid)}`);
    }

    const positiveCases = [
        [Number.MIN_VALUE, Number.MIN_VALUE],
        [0.5, 0.5],
        ['0.25', 0.25],
        [true, 1],
        [1n, 1],
        [Number.MAX_VALUE, Number.MAX_VALUE]
    ];
    for (const [input, expected] of positiveCases) {
        assert.equal(handler.updateFixed(input), undefined);
        assert.equal(handler.lastFixedTimeDelta, expected);
    }

    const coercionTrace = [];
    const coercible = {
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(hint);
            return 0.125;
        }
    };
    handler.updateFixed(coercible);
    assert.deepEqual(coercionTrace, ['number']);
    assert.equal(handler.lastFixedTimeDelta, 0.125);

    const previous = handler.lastFixedTimeDelta;
    for (const invalid of [Symbol('fixed'), Object.create(null)]) {
        assert.throws(() => handler.updateFixed(invalid), (error) => error?.name === 'TypeError');
        assert.equal(handler.lastFixedTimeDelta, previous);
    }
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.throws(() => handler.updateFixed(proxy), (error) => error?.name === 'TypeError');
    assert.equal(handler.lastFixedTimeDelta, previous);
});

test('updateFixed는 fallback 필드를 eager 평가하고 0 이하 분기에서 다시 읽는다', async () => {
    const harness = await createTimeHarness();
    const handler = new harness.namespace.TimeHandler();
    const values = [];
    let reads = 0;
    Object.defineProperty(handler, 'fixedStepSeconds', {
        configurable: true,
        get() {
            reads += 1;
            values.push(reads);
            return reads === 1 ? 0.02 : 0.03;
        }
    });

    handler.updateFixed(0.5);
    assert.equal(reads, 1);
    assert.equal(handler.lastFixedTimeDelta, 0.5);

    reads = 0;
    values.length = 0;
    handler.updateFixed(0);
    assert.equal(reads, 2);
    assert.deepEqual(values, [1, 2]);
    assert.equal(handler.lastFixedTimeDelta, 0.03);

    reads = 0;
    values.length = 0;
    handler.updateFixed();
    assert.equal(reads, 2);
    assert.deepEqual(values, [1, 2]);
    assert.equal(handler.lastFixedTimeDelta, 0.02);

    reads = 0;
    values.length = 0;
    Object.defineProperty(handler, 'fixedStepSeconds', {
        configurable: true,
        get() {
            reads += 1;
            values.push(reads);
            return reads === 3 ? 0.04 : 0;
        }
    });
    handler.updateFixed();
    assert.equal(reads, 3);
    assert.deepEqual(values, [1, 2, 3]);
    assert.equal(handler.lastFixedTimeDelta, 0.04);

    reads = 0;
    Object.defineProperty(handler, 'fixedStepSeconds', {
        configurable: true,
        get() {
            reads += 1;
            return 0.02;
        }
    });
    const coercionToken = new Error('fixed conversion sentinel');
    assert.throws(
        () => handler.updateFixed({
            [Symbol.toPrimitive]() {
                throw coercionToken;
            }
        }),
        (error) => error === coercionToken
    );
    assert.equal(reads, 0);

    const fallbackToken = new Error('fixed fallback getter sentinel');
    Object.defineProperty(handler, 'fixedStepSeconds', {
        configurable: true,
        get() {
            throw fallbackToken;
        }
    });
    const previous = handler.lastFixedTimeDelta;
    assert.throws(() => handler.updateFixed(0.5), (error) => error === fallbackToken);
    assert.equal(handler.lastFixedTimeDelta, previous);
});

test('보간 setter/getter는 생성 경계와 Number 변환·0~1 clamp를 보존한다', async () => {
    const harness = await createTimeHarness();
    assert.equal(harness.namespace.getFixedInterpolationAlpha(), 1);
    const handler = new harness.namespace.TimeHandler();
    assert.equal(harness.namespace.getFixedInterpolationAlpha(), 0);

    const cases = [
        [undefined, 0],
        [null, 0],
        [false, 0],
        [-1, 0],
        [-0, 0],
        [Number.NaN, 0],
        [Infinity, 0],
        [-Infinity, 0],
        [0.25, 0.25],
        ['0.75', 0.75],
        [true, 1],
        [1n, 1],
        [2, 1]
    ];
    for (const [input, expected] of cases) {
        assert.equal(handler.setFixedInterpolationAlpha(input), undefined);
        assert.equal(handler.fixedInterpolationAlpha, expected);
        assert.equal(harness.namespace.getFixedInterpolationAlpha(), expected);
        if (Object.is(input, -0)) {
            assert.equal(Object.is(handler.fixedInterpolationAlpha, 0), true);
            assert.equal(Object.is(handler.fixedInterpolationAlpha, -0), false);
        }
    }

    const coercionTrace = [];
    handler.setFixedInterpolationAlpha({
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(hint);
            return 0.625;
        }
    });
    assert.deepEqual(coercionTrace, ['number']);
    assert.equal(handler.fixedInterpolationAlpha, 0.625);

    const previous = handler.fixedInterpolationAlpha;
    assert.throws(
        () => handler.setFixedInterpolationAlpha(Symbol('alpha')),
        (error) => error?.name === 'TypeError'
    );
    assert.equal(handler.fixedInterpolationAlpha, previous);

    handler.fixedInterpolationAlpha = 7;
    assert.equal(harness.namespace.getFixedInterpolationAlpha(), 7);
});

test('_normalizeDeltaMs는 Number 변환 뒤 비유한값을 2ms로 바꾸고 초 단위로 반환한다', async () => {
    const harness = await createTimeHarness();
    const handler = new harness.namespace.TimeHandler();
    const cases = [
        [undefined, 0.002],
        [null, 0.002],
        [false, 0.002],
        [-1, 0.002],
        [-0, 0.002],
        [Number.NaN, 0.002],
        [Infinity, 0.002],
        [-Infinity, 0.002],
        [2, 0.002],
        [25, 0.025],
        ['50', 0.05],
        [100, 0.1],
        [101, 0.1],
        [1n, 0.002]
    ];
    for (const [input, expected] of cases) {
        assert.equal(handler._normalizeDeltaMs(input), expected, `input=${String(input)}`);
    }

    const coercionTrace = [];
    assert.equal(handler._normalizeDeltaMs({
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(hint);
            return 40;
        }
    }), 0.04);
    assert.deepEqual(coercionTrace, ['number']);
    assert.throws(
        () => handler._normalizeDeltaMs(Symbol('milliseconds')),
        (error) => error?.name === 'TypeError'
    );
});

test('공개 delta getter는 저장 필드를 재검증하지 않고 값·identity·예외를 그대로 노출한다', async () => {
    const harness = await createTimeHarness();
    const handler = new harness.namespace.TimeHandler();
    const frameValue = { kind: 'frame' };
    const fixedValue = { kind: 'fixed' };
    const alphaValue = { kind: 'alpha' };
    handler.lastFrameTimeDelta = frameValue;
    handler.lastFixedTimeDelta = fixedValue;
    handler.fixedInterpolationAlpha = alphaValue;
    assert.equal(harness.namespace.getDelta(), frameValue);
    assert.equal(harness.namespace.getFixedDelta(), fixedValue);
    assert.equal(harness.namespace.getFixedInterpolationAlpha(), alphaValue);

    const getterToken = new Error('live getter sentinel');
    Object.defineProperty(handler, 'lastFrameTimeDelta', {
        configurable: true,
        get() {
            throw getterToken;
        }
    });
    assert.throws(() => harness.namespace.getDelta(), (error) => error === getterToken);
});
