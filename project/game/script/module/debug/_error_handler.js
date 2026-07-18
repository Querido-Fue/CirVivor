/**
 * 에러 핸들러가 지원하는 로그 레벨입니다.
 * @type {Readonly<{ERROR:string, WARNING:string, INFO:string}>}
 */
const ERROR_LOG_LEVEL = Object.freeze({
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
});

/**
 * @class ErrorHandler
 * @description 공통 에러/경고/정보 로그 출력과 예외 발생을 담당합니다.
 */
export class ErrorHandler {
    constructor() {
    }

    /**
     * 메시지를 정규화한 뒤 strict level 값에 따라 오류·경고·정보를 처리합니다.
     * string이 아닌 message는 level을 검사하기 전에 `String(message ?? '')`로 변환합니다.
     * `error`에서는 truthy인 e를 로그한 뒤 그대로 던지고, falsy이면 새 Error를 만듭니다.
     * `warning`/`info`에서는 prefix를 먼저 기록하고 truthy인 e만 두 번째로 기록합니다.
     * 알 수 없는 level은 메시지 변환 뒤 로그를 남기지 않고 종료합니다.
     * @param {*} e - truthy이면 상세 로그 및 error level의 원본 throw 값으로 쓰입니다.
     * @param {*} message - string이 아니면 nullish 기본값을 거쳐 문자열로 변환할 메시지입니다.
     * @param {*} level - strict 비교할 `'error'`, `'warning'`, `'info'` 또는 미지원 값입니다.
     * @returns {void}
     * @throws {*} error level의 원본/새 Error 또는 변환·console·stack capture에서 발생한 예외입니다.
     */
    errThrow(e, message, level) {
        const safeMessage = typeof message === 'string' ? message : String(message ?? '');
        switch (level) {
            case ERROR_LOG_LEVEL.ERROR:
                this._throwError(e, safeMessage);
                return;
            case ERROR_LOG_LEVEL.WARNING:
                console.warn(`[WARNING] ${safeMessage}`);
                if (e) console.warn(e);
                return;
            case ERROR_LOG_LEVEL.INFO:
                console.info(`[INFO] ${safeMessage}`);
                if (e) console.info(e);
                return;
            default:
                return;
        }
    }

    /**
     * 에러 로그를 출력하고 예외를 던집니다.
     * @param {*} e - truthy이면 그대로 로그하고 던질 원본 값입니다.
     * @param {string} message - 출력할 에러 메시지입니다.
     * @returns {never}
     * @throws {*} truthy 원본 값, 새 Error 또는 console·stack capture에서 발생한 예외입니다.
     * @private
     */
    _throwError(e, message) {
        console.error(`[ERROR] ${message}`);
        if (e) {
            console.error(e);
            throw e;
        }

        const err = new Error(message);
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(err, this.errThrow);
        }
        throw err;
    }
}
