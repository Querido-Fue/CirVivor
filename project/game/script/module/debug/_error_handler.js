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
     * 에러를 처리하고 기록합니다.
     * @param {Error} e - 에러 객체
     * @param {string} message - 커스텀 에러 메시지
     * @param {string} level - 에러 레벨 ('error', 'warning', 'info')
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
     * @param {Error|null} e - 원본 에러 객체입니다.
     * @param {string} message - 출력할 에러 메시지입니다.
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
