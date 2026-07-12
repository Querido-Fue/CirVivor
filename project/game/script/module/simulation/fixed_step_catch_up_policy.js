/**
 * fixed-step catch-up이 CPU 과부하를 증폭하지 않도록 프레임별 실행 상한을 관리합니다.
 */
export class FixedStepCatchUpPolicy {
    /**
     * @param {object} [options={}] - catch-up 정책 튜닝입니다.
     * @param {number} [options.normalMaxSteps=2] - CPU 여유가 있을 때 프레임당 최대 fixed step 수입니다.
     * @param {number} [options.cpuBoundMaxSteps=1] - CPU 포화 상태의 프레임당 최대 fixed step 수입니다.
     * @param {number} [options.enterRatio=0.9] - 직전 CPU 시간이 프레임 간격에서 차지하는 포화 진입 비율입니다.
     * @param {number} [options.exitRatio=0.7] - 포화 해제 후보로 인정할 CPU 비율입니다.
     * @param {number} [options.recoveryFrames=3] - 포화 해제에 필요한 연속 여유 프레임 수입니다.
     */
    constructor(options = {}) {
        this.normalMaxSteps = normalizePositiveInteger(options.normalMaxSteps, 2);
        this.cpuBoundMaxSteps = Math.min(
            this.normalMaxSteps,
            normalizePositiveInteger(options.cpuBoundMaxSteps, 1)
        );
        this.enterRatio = normalizePositiveNumber(options.enterRatio, 0.9);
        this.exitRatio = Math.min(
            this.enterRatio,
            normalizePositiveNumber(options.exitRatio, 0.7)
        );
        this.recoveryFrames = normalizePositiveInteger(options.recoveryFrames, 3);
        this.cpuBound = false;
        this.headroomFrameCount = 0;
    }

    /**
     * 직전 프레임 CPU 시간과 현재 rAF 간격을 비교해 이번 프레임의 fixed step 상한을 반환합니다.
     * @param {number} previousFrameCpuSeconds - 직전 프레임 전체 CPU 시간입니다.
     * @param {number} frameIntervalSeconds - 현재 rAF 프레임 간격입니다.
     * @param {number} fixedStepSeconds - fixed step 단위 시간입니다.
     * @returns {number} 이번 프레임에 허용할 최대 fixed step 수입니다.
     */
    resolveMaxSteps(previousFrameCpuSeconds, frameIntervalSeconds, fixedStepSeconds) {
        const safeFixedStep = normalizePositiveNumber(fixedStepSeconds, 1 / 60);
        const safeFrameInterval = normalizePositiveNumber(frameIntervalSeconds, safeFixedStep);
        const safePreviousCpu = Number.isFinite(previousFrameCpuSeconds)
            ? Math.max(0, previousFrameCpuSeconds)
            : 0;
        const referenceInterval = Math.max(safeFixedStep, safeFrameInterval);
        const cpuRatio = safePreviousCpu / referenceInterval;

        if (cpuRatio >= this.enterRatio) {
            this.cpuBound = true;
            this.headroomFrameCount = 0;
        } else if (this.cpuBound) {
            if (cpuRatio <= this.exitRatio) {
                this.headroomFrameCount++;
                if (this.headroomFrameCount >= this.recoveryFrames) {
                    this.cpuBound = false;
                    this.headroomFrameCount = 0;
                }
            } else {
                this.headroomFrameCount = 0;
            }
        }

        return this.cpuBound ? this.cpuBoundMaxSteps : this.normalMaxSteps;
    }

    /**
     * 앱 일시정지·재개 시 이전 포화 판정을 제거합니다.
     */
    reset() {
        this.cpuBound = false;
        this.headroomFrameCount = 0;
    }
}

/**
 * 유한한 양수를 반환합니다.
 * @param {number} value - 입력 값입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 양수입니다.
 */
function normalizePositiveNumber(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 유한한 양의 정수를 반환합니다.
 * @param {number} value - 입력 값입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 양의 정수입니다.
 */
function normalizePositiveInteger(value, fallback) {
    return Number.isFinite(value) && value > 0
        ? Math.max(1, Math.floor(value))
        : fallback;
}
