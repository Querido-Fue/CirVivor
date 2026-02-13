export class ErrorHandler {
    constructor() {
        this.errors = [];
    }

    /**
     * 에러를 처리하고 기록합니다.
     * @param {Error} e - 에러 객체
     * @param {string} message - 커스텀 에러 메시지
     * @param {string} level - 에러 레벨 ('error', 'warning', 'info')
     */
    errThrow(e, message, level) {
        if (level === 'error') {
            console.error(`[ERROR] ${message}`);
            if (e) {
                console.error(e);
                throw e;
            } else {
                const err = new Error(message);
                if (Error.captureStackTrace) {
                    Error.captureStackTrace(err, this.errThrow);
                }
                throw err;
            }
        } else if (level === 'warning') {
            console.warn(`[WARNING] ${message}`);
            if (e) console.warn(e);
        } else if (level === 'info') {
            console.info(`[INFO] ${message}`);
            if (e) console.info(e);
        }
    }

    /**
     * 기록된 에러를 로그에 출력합니다.
     */
    logErrors() {
        for (const error of this.errors) {
            console.error(error);
        }
    }
}