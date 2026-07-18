import { ErrorHandler } from '../../script/module/debug/_error_handler.js';

const statusElement = document.querySelector('#status');

/**
 * 조건이 거짓이면 계약 오류를 던집니다.
 * @param {boolean} condition - 확인할 조건입니다.
 * @param {string} message - 실패 메시지입니다.
 * @returns {void}
 */
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

/**
 * 호출이 던진 값을 반환합니다.
 * @param {Function} callback - 실행할 함수입니다.
 * @returns {*} 던져진 값입니다.
 */
function captureThrown(callback) {
    try {
        callback();
    } catch (error) {
        return error;
    }
    throw new Error('expected throw did not occur');
}

/**
 * 세 console 기록을 초기화합니다.
 * @param {object} calls - console 기록입니다.
 * @returns {void}
 */
function resetCalls(calls) {
    calls.error.length = 0;
    calls.info.length = 0;
    calls.warn.length = 0;
}

/**
 * 실제 NW.js realm에서 production ErrorHandler의 브라우저 전용 계약을 검사합니다.
 * @returns {void}
 */
function run() {
    const calls = { error: [], info: [], warn: [] };
    const originalConsole = {
        error: console.error,
        info: console.info,
        warn: console.warn
    };
    const originalCaptureStackTrace = Error.captureStackTrace;
    let captureStackTraceChecked = false;
    let captureStackTraceReplaced = false;
    let failure = null;
    let passLines = null;

    console.error = (...args) => calls.error.push(args);
    console.info = (...args) => calls.info.push(args);
    console.warn = (...args) => calls.warn.push(args);

    try {
        assert(document.all !== null, 'document.all must not be strict null');
        assert(document.all !== undefined, 'document.all must not be strict undefined');
        assert(Boolean(document.all) === false, 'document.all must be falsy');
        assert(typeof document.all === 'undefined', 'document.all typeof must be undefined');

        const handler = new ErrorHandler();
        const documentAllError = captureThrown(() => {
            handler.errThrow(document.all, 'document-all-error', 'error');
        });
        assert(documentAllError !== document.all, 'falsy document.all must not be rethrown');
        assert(documentAllError instanceof Error, 'falsy document.all must create Error');
        assert(documentAllError.message === 'document-all-error', 'new Error message mismatch');
        assert(calls.error.length === 1, 'document.all error must log prefix only');
        assert(calls.error[0][0] === '[ERROR] document-all-error', 'error prefix mismatch');

        resetCalls(calls);
        const documentAllMessage = String(document.all);
        handler.errThrow(null, document.all, 'warning');
        assert(calls.warn.length === 1, 'document.all message must log once');
        assert(
            calls.warn[0][0] === `[WARNING] ${documentAllMessage}`,
            'document.all message must use String(document.all)'
        );

        resetCalls(calls);
        const conversionTrace = [];
        const message = {
            [Symbol.toPrimitive](hint) {
                conversionTrace.push(hint);
                return 'converted-before-level';
            }
        };
        handler.errThrow(null, message, Symbol('unsupported-level'));
        assert(conversionTrace.length === 1, 'unsupported level must convert message once');
        assert(conversionTrace[0] === 'string', 'String conversion hint mismatch');
        assert(calls.error.length + calls.warn.length + calls.info.length === 0, 'unsupported level logged');

        resetCalls(calls);
        const original = { id: 'truthy-original' };
        const identityError = captureThrown(() => {
            handler.errThrow(original, 'identity', 'error');
        });
        assert(identityError === original, 'truthy original identity changed');
        assert(calls.error.length === 2, 'truthy original must produce two error logs');
        assert(calls.error[0][0] === '[ERROR] identity', 'truthy prefix mismatch');
        assert(calls.error[1][0] === original, 'truthy detail identity mismatch');

        const captureDescriptor = Object.getOwnPropertyDescriptor(Error, 'captureStackTrace');
        if (typeof originalCaptureStackTrace === 'function' && captureDescriptor?.writable) {
            resetCalls(calls);
            const captureCalls = [];
            Error.captureStackTrace = (...args) => captureCalls.push(args);
            captureStackTraceReplaced = true;
            const createdError = captureThrown(() => {
                handler.errThrow(null, 'capture', 'error');
            });
            assert(captureCalls.length === 1, 'captureStackTrace call count mismatch');
            assert(captureCalls[0][0] === createdError, 'captureStackTrace error identity mismatch');
            assert(captureCalls[0][1] === handler.errThrow, 'captureStackTrace constructor option mismatch');
            captureStackTraceChecked = true;
        }

        passLines = [
            'PASS',
            'production ErrorHandler: actual module',
            `document.all: typeof=${typeof document.all}, Boolean=${Boolean(document.all)}`,
            `String(document.all): ${JSON.stringify(documentAllMessage)}`,
            'e=document.all: falsy → new Error exact',
            'message=document.all: strict nullish 아님 → String exact',
            'unsupported level: message coercion 1회, console 0회',
            'truthy e: console 순서와 throw identity exact',
            `captureStackTrace: ${captureStackTraceChecked ? 'exact' : 'engine unavailable'}`,
            `engine: ${navigator.userAgent}`
        ];
    } catch (error) {
        failure = error;
    }

    try {
        if (captureStackTraceReplaced) {
            Error.captureStackTrace = originalCaptureStackTrace;
        }
        console.error = originalConsole.error;
        console.info = originalConsole.info;
        console.warn = originalConsole.warn;
    } catch (error) {
        failure ??= error;
    }

    if (failure) {
        document.title = 'FAIL — Debug error contract';
        statusElement.className = 'fail';
        statusElement.textContent = `FAIL\n${failure?.stack ?? failure}`;
        return;
    }

    document.title = 'PASS — Debug error contract';
    statusElement.className = 'pass';
    statusElement.textContent = passLines.join('\n');
}

run();
