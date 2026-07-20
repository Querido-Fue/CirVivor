import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DEBUG_ROOT = fileURLToPath(new URL('../script/module/debug/', import.meta.url));
const DEBUG_SYSTEM_PATH = path.join(DEBUG_ROOT, 'debug_system.js');
const ERROR_HANDLER_PATH = path.join(DEBUG_ROOT, '_error_handler.js');
const [debugSystemSource, errorHandlerSource] = await Promise.all([
    readFile(DEBUG_SYSTEM_PATH, 'utf8'),
    readFile(ERROR_HANDLER_PATH, 'utf8')
]);

const EXECUTABLE_SOURCE_HASHES = Object.freeze({
    debugSystem: '5b4a29d20b16e35b3656bc4235ffe2d620bc3753e94164bd369b4bd1a22026a1',
    errorHandler: '72e14003640956d4818134babcb04dda2c74afde326ab93fd194f5b058e761dd'
});

/**
 * JSDoc을 제거한 production 실행 소스의 안정적인 해시를 계산합니다.
 * @param {string} source - production 소스입니다.
 * @returns {string} SHA-256 해시입니다.
 */
function hashExecutableSource(source) {
    const allJsDocStarts = source.match(/\/\*\*/g) ?? [];
    const standaloneJsDocStarts = source.match(/^[ \t]*\/\*\*/gm) ?? [];
    assert.equal(
        standaloneJsDocStarts.length,
        allJsDocStarts.length,
        '해시 제거 대상이 아닌 문자열·인라인 JSDoc 표식이 있습니다.'
    );
    const executableSource = source
        .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*(?:\r?\n|$)/gm, '')
        .replace(/\r\n/g, '\n');
    return createHash('sha256').update(executableSource).digest('hex');
}

/**
 * 특정 선언 바로 앞의 JSDoc 본문을 찾습니다.
 * @param {string} source - 검색할 production 소스입니다.
 * @param {string} escapedDeclaration - 정규식용 선언 패턴입니다.
 * @returns {string} JSDoc 본문입니다.
 */
function findLeadingJsDoc(source, escapedDeclaration) {
    const match = source.match(
        new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*${escapedDeclaration}`)
    );
    assert.ok(match, `${escapedDeclaration} 선언 앞 JSDoc을 찾을 수 없습니다.`);
    return match[1];
}

/**
 * synthetic ESM을 만듭니다.
 * @param {vm.Context} context - VM 문맥입니다.
 * @param {string} identifier - 모듈 식별자입니다.
 * @param {Record<string, *>} exports - 노출할 export입니다.
 * @returns {vm.SyntheticModule} synthetic module입니다.
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
 * 실제 debug/error production 모듈을 관찰 가능한 console과 함께 로드합니다.
 * @param {{debugMode?:boolean}} [options={}] - 저장된 디버그 모드 초기값입니다.
 * @returns {Promise<object>} 테스트 하네스입니다.
 */
async function createDebugHarness({ debugMode = false } = {}) {
    const calls = {
        error: [],
        info: [],
        warn: []
    };
    const settingCalls = [];
    const consoleApi = {
        error(...args) {
            calls.error.push(args);
        },
        info(...args) {
            calls.info.push(args);
        },
        warn(...args) {
            calls.warn.push(args);
        }
    };
    const context = vm.createContext({
        console: consoleApi,
        performance: { now: () => 0 }
    });

    class AnimationDebugControllerStub {
        isPaused() {
            return false;
        }

        prepareFrame() {
            return { mode: 'running' };
        }

        setEnabled() {
        }
    }

    class PerformanceDebuggerStub {
        isEnabled() {
            return false;
        }

        setEnabled() {
        }
    }

    class PoolDebuggerStub {
    }

    const modules = new Map();
    modules.set('input/input_system.js', createSyntheticModule(
        context,
        'input/input_system.js',
        { consumeKeyboardPress: () => false }
    ));
    modules.set('save/save_system.js', createSyntheticModule(
        context,
        'save/save_system.js',
        {
            getSetting(settingKey) {
                settingCalls.push(settingKey);
                return settingKey === 'debugMode' ? debugMode : false;
            }
        }
    ));
    modules.set('./_animation_debug_controller.js', createSyntheticModule(
        context,
        './_animation_debug_controller.js',
        { AnimationDebugController: AnimationDebugControllerStub }
    ));
    modules.set('./_performance_debug.js', createSyntheticModule(
        context,
        './_performance_debug.js',
        { PerformanceDebugger: PerformanceDebuggerStub }
    ));
    modules.set('./_pool_debug.js', createSyntheticModule(
        context,
        './_pool_debug.js',
        { PoolDebugger: PoolDebuggerStub }
    ));

    const errorHandlerModule = new vm.SourceTextModule(errorHandlerSource, {
        context,
        identifier: ERROR_HANDLER_PATH
    });
    const debugSystemModule = new vm.SourceTextModule(debugSystemSource, {
        context,
        identifier: DEBUG_SYSTEM_PATH
    });
    modules.set('./_error_handler.js', errorHandlerModule);

    await debugSystemModule.link((specifier) => {
        const dependency = modules.get(specifier);
        if (!dependency) {
            throw new Error(`지원하지 않는 테스트 import입니다: ${specifier}`);
        }
        return dependency;
    });
    await debugSystemModule.evaluate();

    return {
        calls,
        settingCalls,
        consoleApi,
        context,
        debug: debugSystemModule.namespace,
        ErrorHandler: errorHandlerModule.namespace.ErrorHandler,
        realm: {
            Error: vm.runInContext('Error', context),
            String: vm.runInContext('String', context)
        }
    };
}

/**
 * 세 console 기록 배열을 비웁니다.
 * @param {object} calls - console 호출 기록입니다.
 * @returns {void}
 */
function resetConsoleCalls(calls) {
    calls.error.length = 0;
    calls.info.length = 0;
    calls.warn.length = 0;
}

test('debug error JSDoc 변경은 두 production 실행 소스 SHA-256을 보존한다', () => {
    assert.equal(
        hashExecutableSource(debugSystemSource),
        EXECUTABLE_SOURCE_HASHES.debugSystem
    );
    assert.equal(
        hashExecutableSource(errorHandlerSource),
        EXECUTABLE_SOURCE_HASHES.errorHandler
    );
});

test('debug error JSDoc은 변환·level·identity·초기화와 반환 계약을 명시한다', () => {
    const handlerDoc = findLeadingJsDoc(
        errorHandlerSource,
        'errThrow\\(e, message, level\\)'
    );
    assert.match(handlerDoc, /@param \{\*\} e/);
    assert.match(handlerDoc, /@param \{\*\} message/);
    assert.match(handlerDoc, /@param \{\*\} level/);
    assert.match(handlerDoc, /String\(message \?\? ''\)/);
    assert.match(handlerDoc, /level.*검사.*전에/);
    assert.match(handlerDoc, /truthy.*그대로.*던/);
    assert.match(handlerDoc, /알 수 없는.*level.*로그.*남기지/);
    assert.match(handlerDoc, /@returns \{void\}/);
    assert.match(handlerDoc, /@throws \{\*\}/);

    const throwDoc = findLeadingJsDoc(
        errorHandlerSource,
        '_throwError\\(e, message\\)'
    );
    assert.match(throwDoc, /@param \{\*\} e/);
    assert.match(throwDoc, /@returns \{never\}/);
    assert.match(throwDoc, /@throws \{\*\}/);

    const publicDoc = findLeadingJsDoc(
        debugSystemSource,
        'export function errThrow\\(e, message, level\\)'
    );
    assert.match(publicDoc, /DebugSystem\.init\(\)/);
    assert.match(publicDoc, /errorHandler.*준비/);
    assert.match(publicDoc, /하위 반환값.*전달하지/);
    assert.match(publicDoc, /@param \{\*\} e/);
    assert.match(publicDoc, /@param \{\*\} message/);
    assert.match(publicDoc, /@param \{\*\} level/);
    assert.match(publicDoc, /@returns \{void\}/);
    assert.match(publicDoc, /@throws \{\*\}/);
});

test('hitbox cache는 생성과 초기화에서만 설정을 읽고 반복 조회에는 저장소를 방문하지 않는다', async () => {
    const harness = await createDebugHarness({ debugMode: true });
    const { DebugSystem, shouldShowHitboxes } = harness.debug;
    const debugSystem = new DebugSystem();
    await debugSystem.init();

    assert.equal(shouldShowHitboxes(), true);
    assert.deepEqual(harness.settingCalls, ['debugMode', 'debugMode']);
    for (let index = 0; index < 5; index += 1) {
        assert.equal(shouldShowHitboxes(), true);
    }
    assert.equal(harness.settingCalls.length, 2);
});

test('hitbox 옵션 변경은 표시 cache를 즉시 갱신한다', async () => {
    const harness = await createDebugHarness({ debugMode: true });
    const { DebugSystem, shouldShowHitboxes } = harness.debug;
    const debugSystem = new DebugSystem();
    await debugSystem.init();

    debugSystem.setControlOption('hitboxes', false);
    assert.equal(shouldShowHitboxes(), false);
    debugSystem.setControlOption('hitboxes', true);
    assert.equal(shouldShowHitboxes(), true);
});

test('runtime debugMode 변경은 현재 인스턴스의 hitbox cache만 전환한다', async () => {
    const harness = await createDebugHarness({ debugMode: true });
    const { DebugSystem, shouldShowHitboxes } = harness.debug;
    const debugSystem = new DebugSystem();
    await debugSystem.init();

    debugSystem.applyRuntimeSettings({ debugMode: false });
    assert.equal(shouldShowHitboxes(), false);
    debugSystem.applyRuntimeSettings({ debugMode: true });
    assert.equal(shouldShowHitboxes(), true);

    const currentDebugSystem = new DebugSystem();
    await currentDebugSystem.init();
    debugSystem.setControlOption('hitboxes', false);
    debugSystem.applyRuntimeSettings({ debugMode: false });
    assert.equal(shouldShowHitboxes(), true);
});

test('ErrorHandler는 message를 level 검사 전에 정확히 한 번 정규화한다', async () => {
    const harness = await createDebugHarness();
    const handler = new harness.ErrorHandler();
    const stringCalls = [];
    harness.context.String = (value) => {
        stringCalls.push(value);
        return `converted:${stringCalls.length}`;
    };

    assert.equal(handler.errThrow(null, 'already-string', 'warning'), undefined);
    assert.deepEqual(stringCalls, []);
    assert.deepEqual(harness.calls.warn, [['[WARNING] already-string']]);

    resetConsoleCalls(harness.calls);
    assert.equal(handler.errThrow(null, null, 'unknown'), undefined);
    assert.deepEqual(stringCalls, ['']);
    assert.deepEqual(harness.calls, { error: [], info: [], warn: [] });

    const message = { id: 'message' };
    const levelCoercionToken = new Error('level coercion must not run');
    const level = {
        [Symbol.toPrimitive]() {
            throw levelCoercionToken;
        }
    };
    assert.equal(handler.errThrow(null, message, level), undefined);
    assert.equal(stringCalls[1], message);
    assert.deepEqual(harness.calls, { error: [], info: [], warn: [] });

    const conversionToken = new Error('message conversion sentinel');
    harness.context.String = () => {
        throw conversionToken;
    };
    assert.throws(
        () => handler.errThrow(null, {}, 'unknown'),
        (error) => error === conversionToken
    );
    assert.deepEqual(harness.calls, { error: [], info: [], warn: [] });
});

test('message 명시 edge와 level strict 비교는 실제 String/ToBoolean 계약을 보존한다', async () => {
    const harness = await createDebugHarness();
    const handler = new harness.ErrorHandler();
    const messageCases = [
        [undefined, ''],
        [null, ''],
        [false, 'false'],
        [0, '0'],
        [-0, '0'],
        [Number.NaN, 'NaN'],
        [0n, '0'],
        [Symbol('message'), 'Symbol(message)']
    ];

    for (const [message, expected] of messageCases) {
        resetConsoleCalls(harness.calls);
        assert.equal(handler.errThrow(null, message, 'warning'), undefined);
        assert.deepEqual(harness.calls.warn, [[`[WARNING] ${expected}`]]);
    }

    const coercionTrace = [];
    const coercibleMessage = {
        [Symbol.toPrimitive](hint) {
            coercionTrace.push(hint);
            return 'custom-message';
        }
    };
    resetConsoleCalls(harness.calls);
    handler.errThrow(null, coercibleMessage, 'info');
    assert.deepEqual(coercionTrace, ['string']);
    assert.deepEqual(harness.calls.info, [['[INFO] custom-message']]);

    const nullPrototypeMessage = Object.create(null);
    assert.throws(
        () => handler.errThrow(null, nullPrototypeMessage, 'unknown'),
        (error) => error?.name === 'TypeError'
    );
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assert.throws(
        () => handler.errThrow(null, proxy, 'unknown'),
        (error) => error?.name === 'TypeError'
    );

    for (const unsupportedLevel of [
        'ERROR',
        'warn',
        new String('error'),
        {},
        Symbol('error'),
        null,
        undefined
    ]) {
        resetConsoleCalls(harness.calls);
        assert.equal(handler.errThrow(null, 'strict-level', unsupportedLevel), undefined);
        assert.deepEqual(harness.calls, { error: [], info: [], warn: [] });
    }
});

test('warning/info는 prefix 뒤 truthy 원본만 같은 console 메서드에 기록한다', async () => {
    const harness = await createDebugHarness();
    const handler = new harness.ErrorHandler();
    const warningDetail = { kind: 'warning' };
    const infoDetail = Symbol('info');

    assert.equal(handler.errThrow(warningDetail, 'watch', 'warning'), undefined);
    assert.deepEqual(harness.calls.warn, [
        ['[WARNING] watch'],
        [warningDetail]
    ]);
    assert.deepEqual(harness.calls.info, []);
    assert.deepEqual(harness.calls.error, []);

    resetConsoleCalls(harness.calls);
    assert.equal(handler.errThrow(infoDetail, 'ready', 'info'), undefined);
    assert.deepEqual(harness.calls.info, [
        ['[INFO] ready'],
        [infoDetail]
    ]);

    resetConsoleCalls(harness.calls);
    assert.equal(handler.errThrow(0, undefined, 'warning'), undefined);
    assert.deepEqual(harness.calls.warn, [['[WARNING] ']]);

    resetConsoleCalls(harness.calls);
    const consoleToken = new Error('console warning sentinel');
    harness.consoleApi.warn = () => {
        throw consoleToken;
    };
    assert.throws(
        () => handler.errThrow(warningDetail, 'throws first', 'warning'),
        (error) => error === consoleToken
    );
    assert.deepEqual(harness.calls.warn, []);
});

test('두 번째 console 호출 예외는 원본 e throw보다 먼저 전파된다', async () => {
    const warningHarness = await createDebugHarness();
    const warningHandler = new warningHarness.ErrorHandler();
    const warningDetail = { id: 'warning detail' };
    const warningConsoleToken = new Error('second warning console sentinel');
    const warningCalls = [];
    warningHarness.consoleApi.warn = (...args) => {
        warningCalls.push(args);
        if (warningCalls.length === 2) throw warningConsoleToken;
    };
    assert.throws(
        () => warningHandler.errThrow(warningDetail, 'warning', 'warning'),
        (error) => error === warningConsoleToken
    );
    assert.deepEqual(warningCalls, [
        ['[WARNING] warning'],
        [warningDetail]
    ]);

    const errorHarness = await createDebugHarness();
    const errorHandler = new errorHarness.ErrorHandler();
    const original = { id: 'original error' };
    const errorConsoleToken = new Error('second error console sentinel');
    const errorCalls = [];
    errorHarness.consoleApi.error = (...args) => {
        errorCalls.push(args);
        if (errorCalls.length === 2) throw errorConsoleToken;
    };
    assert.throws(
        () => errorHandler.errThrow(original, 'error', 'error'),
        (error) => error === errorConsoleToken
    );
    assert.deepEqual(errorCalls, [
        ['[ERROR] error'],
        [original]
    ]);
});

test('error level은 truthy 원본 identity를 로그한 뒤 그대로 던진다', async () => {
    const harness = await createDebugHarness();
    const handler = new harness.ErrorHandler();

    for (const original of [
        new Error('original'),
        { kind: 'plain object' },
        'primitive rejection',
        new Boolean(false)
    ]) {
        resetConsoleCalls(harness.calls);
        assert.throws(
            () => handler.errThrow(original, 'fatal', 'error'),
            (error) => error === original
        );
        assert.deepEqual(harness.calls.error, [
            ['[ERROR] fatal'],
            [original]
        ]);
    }
});

test('error level의 falsy 원본은 새 Error와 captureStackTrace 순서를 보존한다', async () => {
    const falsyValues = [null, undefined, false, 0, -0, Number.NaN, '', 0n];
    for (const original of falsyValues) {
        const harness = await createDebugHarness();
        const handler = new harness.ErrorHandler();
        const captureCalls = [];
        harness.realm.Error.captureStackTrace = (...args) => {
            captureCalls.push(args);
        };

        let thrown;
        try {
            handler.errThrow(original, 17, 'error');
            assert.fail('error level은 반드시 예외를 던져야 합니다.');
        } catch (error) {
            thrown = error;
        }
        assert.equal(thrown?.name, 'Error');
        assert.equal(thrown?.message, '17');
        assert.deepEqual(harness.calls.error, [['[ERROR] 17']]);
        assert.equal(captureCalls.length, 1);
        assert.equal(captureCalls[0][0], thrown);
        assert.equal(captureCalls[0][1], handler.errThrow);
    }

    const harness = await createDebugHarness();
    const handler = new harness.ErrorHandler();
    const captureToken = new Error('capture sentinel');
    harness.realm.Error.captureStackTrace = () => {
        throw captureToken;
    };
    assert.throws(
        () => handler.errThrow(null, 'capture failure', 'error'),
        (error) => error === captureToken
    );
    assert.deepEqual(harness.calls.error, [['[ERROR] capture failure']]);
});

test('공개 errThrow adapter는 초기화 경계·receiver·void 반환을 보존한다', async () => {
    const harness = await createDebugHarness();
    const { DebugSystem, errThrow } = harness.debug;

    assert.throws(
        () => errThrow(null, 'before construction', 'warning'),
        (error) => error?.name === 'TypeError'
    );

    const debugSystem = new DebugSystem();
    assert.throws(
        () => errThrow(null, 'before init', 'warning'),
        (error) => error?.name === 'TypeError'
    );

    const initPromise = debugSystem.init();
    assert.equal(errThrow(null, 'ready', 'warning'), undefined);
    assert.deepEqual(harness.calls.warn, [['[WARNING] ready']]);
    await initPromise;

    const sentinel = { id: 'return value' };
    const args = [{ id: 'error' }, { id: 'message' }, { id: 'level' }];
    let receiver;
    let observedArgs;
    debugSystem.errorHandler.errThrow = function replacement(...actualArgs) {
        receiver = this;
        observedArgs = actualArgs;
        return sentinel;
    };
    assert.equal(errThrow(...args), undefined);
    assert.equal(receiver, debugSystem.errorHandler);
    assert.deepEqual(observedArgs, args);

    const thrownToken = new Error('adapter sentinel');
    debugSystem.errorHandler.errThrow = () => {
        throw thrownToken;
    };
    assert.throws(
        () => errThrow(null, 'throw', 'error'),
        (error) => error === thrownToken
    );

    const secondDebugSystem = new DebugSystem();
    assert.throws(
        () => errThrow(null, 'shadowed by uninitialized instance', 'warning'),
        (error) => error?.name === 'TypeError'
    );
    await secondDebugSystem.init();
    resetConsoleCalls(harness.calls);
    assert.equal(errThrow(null, 'second instance ready', 'info'), undefined);
    assert.deepEqual(harness.calls.info, [['[INFO] second instance ready']]);
});
