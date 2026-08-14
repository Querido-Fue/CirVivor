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
     * 입력은 `Number.isFinite()`로 검사하며 문자열·객체를 숫자로 강제 변환하지 않습니다.
     * CPU 비율의 기준 간격은 안전한 fixed step과 안전한 frame 간격 중 큰 값입니다.
     * 진입 기준 이상이면 `cpuBound`를 먼저 켜고 여유 프레임 수를 0으로 만들며,
     * 포화 중 해제 기준 이하가 연속 `recoveryFrames`회일 때만 정상 상태로 돌아갑니다.
     * 포화 상태에서 두 기준 사이의 프레임은 누적된 여유 프레임 수만 0으로 되돌립니다.
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
     * 현재 catch-up 정책이 CPU 포화 상태인지 반환합니다.
     * @returns {boolean} CPU 포화 상태입니다.
     */
    isCpuBound() {
        return this.cpuBound === true;
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
 * accumulator에 남은 정수 fixed tick 수를 계산합니다.
 * 입력은 `Number.isFinite()`로 검사하며 문자열·객체를 숫자로 강제 변환하지 않습니다.
 * @param {number} accumulatorSeconds - 누적된 simulation 시간입니다.
 * @param {number} fixedStepSeconds - fixed tick 단위 시간입니다.
 * @returns {number} accumulator에 포함된 정수 tick 수입니다.
 */
export function countWholeFixedSteps(accumulatorSeconds, fixedStepSeconds) {
    const safeFixedStep = normalizePositiveNumber(fixedStepSeconds, 1 / 60);
    const safeAccumulator = Number.isFinite(accumulatorSeconds)
        ? Math.max(0, accumulatorSeconds)
        : 0;
    if (safeAccumulator < safeFixedStep) {
        return 0;
    }
    return Math.max(1, Math.floor(safeAccumulator / safeFixedStep));
}

/**
 * GPU readback/backpressure 때문에 완료되지 않은 fixed tick의 시간을 accumulator에 되돌립니다.
 * 완료 수가 예약 수보다 크면 예약 수로 제한하고, 유효한 정수가 아니면 호환성을 위해 전부 완료된 것으로 봅니다.
 * @param {number} accumulatorSeconds - 예약 tick을 선차감한 뒤 남은 simulation 시간입니다.
 * @param {number} scheduledFixedStepCount - 이번 frame에 예약한 fixed tick 수입니다.
 * @param {number} completedFixedStepCount - 실제로 완료한 fixed tick 수입니다.
 * @param {number} fixedStepSeconds - fixed tick 단위 시간입니다.
 * @returns {number} 미완료 fixed tick 시간을 복원한 accumulator입니다.
 */
export function restoreUncompletedFixedStepDebt(
    accumulatorSeconds,
    scheduledFixedStepCount,
    completedFixedStepCount,
    fixedStepSeconds
) {
    const safeAccumulator = Number.isFinite(accumulatorSeconds)
        ? Math.max(0, accumulatorSeconds)
        : 0;
    const safeFixedStep = normalizePositiveNumber(fixedStepSeconds, 1 / 60);
    const safeScheduledCount = Number.isInteger(scheduledFixedStepCount)
        ? Math.max(0, scheduledFixedStepCount)
        : 0;
    const safeCompletedCount = Number.isInteger(completedFixedStepCount)
        ? Math.min(safeScheduledCount, Math.max(0, completedFixedStepCount))
        : safeScheduledCount;
    return safeAccumulator
        + ((safeScheduledCount - safeCompletedCount) * safeFixedStep);
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
