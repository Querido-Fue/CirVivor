import { getData } from 'data/data_handler.js';
import { getSetting, setSetting } from 'save/save_system.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const DEBUG_MODE_TOGGLE = GLOBAL_CONSTANTS.DEBUG_MODE_TOGGLE;

/**
 * @class DebugModeToggleHandler
 * @description 마우스 휠클릭 시퀀스를 이용한 디버그 모드 토글을 관리합니다.
 */
export class DebugModeToggleHandler {
    constructor() {
        this.clickTimestamps = [];
        this.toggleJob = Promise.resolve();
    }

    /**
     * 휠클릭 완료 시각을 기록하고 조건 충족 시 디버그 모드 토글을 예약합니다.
     * @param {number} eventTimestamp - 클릭이 완료된 시각(ms)입니다.
     */
    registerClick(eventTimestamp) {
        const normalizedTimestamp = this.#normalizeEventTimestamp(eventTimestamp);
        this.#pruneClicks(normalizedTimestamp);
        this.clickTimestamps.push(normalizedTimestamp);

        if (this.clickTimestamps.length < DEBUG_MODE_TOGGLE.REQUIRED_MIDDLE_CLICKS) {
            return;
        }

        this.reset();
        this.#queueToggle();
    }

    /**
     * 디버그 모드 토글용 휠클릭 시퀀스를 초기화합니다.
     */
    reset() {
        this.clickTimestamps.length = 0;
    }

    /**
     * @private
     * 디버그 모드 토글 판정에 사용할 이벤트 시각을 정규화합니다.
     * @param {number} eventTimestamp - 원본 이벤트 시각(ms)입니다.
     * @returns {number} 정규화된 시각(ms)입니다.
     */
    #normalizeEventTimestamp(eventTimestamp) {
        return Number.isFinite(eventTimestamp) ? eventTimestamp : performance.now();
    }

    /**
     * @private
     * 디버그 토글 판정에 필요한 최근 휠클릭 시각만 유지합니다.
     * @param {number} referenceTimestamp - 비교 기준 시각(ms)입니다.
     */
    #pruneClicks(referenceTimestamp) {
        const minimumTimestamp = referenceTimestamp - DEBUG_MODE_TOGGLE.CLICK_WINDOW_MS;
        while (
            this.clickTimestamps.length > 0
            && this.clickTimestamps[0] < minimumTimestamp
        ) {
            this.clickTimestamps.shift();
        }
    }

    /**
     * @private
     * 디버그 모드 토글 저장과 런타임 반영을 직렬화하여 처리합니다.
     */
    #queueToggle() {
        this.toggleJob = this.toggleJob
            .catch(() => undefined)
            .then(async () => {
                const nextDebugMode = !Boolean(getSetting('debugMode'));
                await setSetting('debugMode', nextDebugMode);

                const systemHandler = window.Game?.systemHandler;
                if (systemHandler && typeof systemHandler.applyRuntimeSettings === 'function') {
                    await systemHandler.applyRuntimeSettings({ debugMode: nextDebugMode });
                }
                if (systemHandler?.debugSystem && typeof systemHandler.debugSystem.applyRuntimeSettings === 'function') {
                    systemHandler.debugSystem.applyRuntimeSettings({ debugMode: nextDebugMode });
                }
            })
            .catch((error) => {
                console.warn('디버그 모드 토글 처리 중 오류가 발생했습니다.', error);
            });
    }
}
