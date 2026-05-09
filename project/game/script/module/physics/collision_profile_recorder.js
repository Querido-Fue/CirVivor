/**
 * 충돌 핸들러의 프레임별 계측 값을 기록합니다.
 */
export class CollisionProfileRecorder {
    /**
     * @param {object} frameStats - 기록 대상 프레임 통계 객체입니다.
     */
    constructor(frameStats) {
        this.frameStats = frameStats;
        this.enabled = false;
    }

    /**
     * 세부 계측 활성 상태를 설정합니다.
     * @param {boolean} enabled - 세부 계측 활성 여부입니다.
     */
    setEnabled(enabled) {
        this.enabled = enabled === true;
    }

    /**
     * 계측 시작 시각을 반환합니다.
     * @returns {number|null} 시작 시각입니다.
     */
    startTimer() {
        return this.enabled ? performance.now() : null;
    }

    /**
     * 계측 시간을 누적합니다.
     * @param {string} fieldName - 기록할 통계 필드명입니다.
     * @param {number|null} startTime - 시작 시각입니다.
     */
    recordDuration(fieldName, startTime) {
        if (!Number.isFinite(startTime)) {
            return;
        }

        const durationMs = performance.now() - startTime;
        this.frameStats[fieldName] = (Number.isFinite(this.frameStats[fieldName]) ? this.frameStats[fieldName] : 0) + durationMs;
    }

    /**
     * 계측 카운터를 누적합니다.
     * @param {string} fieldName - 기록할 통계 필드명입니다.
     * @param {number} [amount=1] - 누적할 값입니다.
     */
    recordCount(fieldName, amount = 1) {
        if (!this.enabled) {
            return;
        }

        const safeAmount = Number.isFinite(amount) ? amount : 1;
        this.frameStats[fieldName] = (Number.isFinite(this.frameStats[fieldName]) ? this.frameStats[fieldName] : 0) + safeAmount;
    }

    /**
     * 계측 값을 현재 프레임 값으로 기록합니다.
     * @param {string} fieldName - 기록할 통계 필드명입니다.
     * @param {number} value - 기록할 값입니다.
     */
    recordValue(fieldName, value) {
        if (!this.enabled || !Number.isFinite(value)) {
            return;
        }

        this.frameStats[fieldName] = value;
    }

    /**
     * 원형 part 상세 검사 횟수를 누적합니다.
     */
    recordPartCheck() {
        this.frameStats.partChecks++;
    }
}
