import {
    TimeHandler,
    getDelta,
    getFixedDelta,
    getFixedInterpolationAlpha,
    getTimeHandler
} from '../../script/time_handler.js';

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
 * 실제 NW.js realm에서 production TimeHandler의 브라우저 전용 계약을 검사합니다.
 * @returns {void}
 */
function run() {
    try {
        assert(document.all !== null, 'document.all must not be strict null');
        assert(document.all !== undefined, 'document.all must not be strict undefined');
        assert(Boolean(document.all) === false, 'document.all must be falsy');
        assert(typeof document.all === 'undefined', 'document.all typeof must be undefined');
        assert(Number.isNaN(Number(document.all)), 'Number(document.all) must be NaN');

        assert(getTimeHandler() === null, 'preconstruction handler must be null');
        assert(getDelta() === 0, 'preconstruction frame delta must be 0');
        assert(getFixedDelta() === 0, 'preconstruction fixed delta must be 0');
        assert(getFixedInterpolationAlpha() === 1, 'preconstruction alpha must be 1');

        const handler = new TimeHandler();
        assert(getTimeHandler() === handler, 'constructed handler identity mismatch');
        assert(getDelta() === 1 / 60, 'initial frame delta mismatch');
        assert(getFixedDelta() === 1 / 60, 'initial fixed delta mismatch');
        assert(getFixedInterpolationAlpha() === 0, 'initial alpha mismatch');

        assert(
            handler._normalizeDeltaMs(document.all) === 0.002,
            'document.all milliseconds must use 2ms fallback'
        );
        handler.lastFixedTimeDelta = 0.5;
        handler.updateFixed(document.all);
        assert(getFixedDelta() === 1 / 60, 'document.all fixed delta must use current fixed step');

        handler.setFixedInterpolationAlpha(0.75);
        handler.setFixedInterpolationAlpha(document.all);
        assert(getFixedInterpolationAlpha() === 0, 'document.all alpha must use zero fallback');

        handler.timeBefore = performance.now() - 1000;
        handler.lastFrameTimeDelta = 0.05;
        handler.update(document.all);
        assert(getDelta() === 0.1, 'document.all update must use clock fallback and 100ms cap');

        document.title = 'PASS — TimeHandler contract';
        statusElement.className = 'pass';
        statusElement.textContent = [
            'PASS',
            'production TimeHandler + number_util: actual modules',
            `document.all: typeof=${typeof document.all}, Boolean=${Boolean(document.all)}`,
            `Number(document.all): ${String(Number(document.all))}`,
            'preconstruction: handler null, delta 0/0, alpha 1',
            'construction: delta 1/60, alpha 0, identity exact',
            '_normalizeDeltaMs(document.all): 0.002 exact',
            'updateFixed(document.all): current 1/60 fallback exact',
            'setFixedInterpolationAlpha(document.all): 0 exact',
            'update(document.all): clock fallback, 0.1 cap exact',
            `engine: ${navigator.userAgent}`
        ].join('\n');
    } catch (error) {
        document.title = 'FAIL — TimeHandler contract';
        statusElement.className = 'fail';
        statusElement.textContent = `FAIL\n${error?.stack ?? error}`;
    }
}

run();
