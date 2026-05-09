/**
 * 프레임 통계 필드의 현재 유한 누적값을 반환합니다.
 * @param {object} frameStats - 조회할 프레임 통계 객체입니다.
 * @param {string} fieldName - 조회할 통계 필드명입니다.
 * @returns {number} 유한하지 않으면 0으로 보정한 현재 값입니다.
 */
function getCollisionFrameStatValue(frameStats, fieldName) {
    return Number.isFinite(frameStats[fieldName]) ? frameStats[fieldName] : 0;
}

/**
 * 프레임 통계 필드에 유한값을 누적합니다.
 * @param {object} frameStats - 기록 대상 프레임 통계 객체입니다.
 * @param {string} fieldName - 기록할 통계 필드명입니다.
 * @param {number} amount - 누적할 값입니다.
 */
function addCollisionFrameStatValue(frameStats, fieldName, amount) {
    frameStats[fieldName] = getCollisionFrameStatValue(frameStats, fieldName) + amount;
}

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
        addCollisionFrameStatValue(this.frameStats, fieldName, durationMs);
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
        addCollisionFrameStatValue(this.frameStats, fieldName, safeAmount);
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
        addCollisionFrameStatValue(this.frameStats, 'partChecks', 1);
    }
}
