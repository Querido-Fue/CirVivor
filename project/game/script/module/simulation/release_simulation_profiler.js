import { getData } from 'data/data_handler.js';

const PROFILER_CONSTANTS = getData('DEBUG_CONSTANTS').RELEASE_SIMULATION_PROFILER;
const RATE_WINDOW_MS = PROFILER_CONSTANTS.RATE_WINDOW_MS;
const QUANTILE_WINDOW_MS = PROFILER_CONSTANTS.QUANTILE_WINDOW_MS;
const SNAPSHOT_INTERVAL_MS = PROFILER_CONSTANTS.SNAPSHOT_INTERVAL_MS;
const QUANTILE_P50 = PROFILER_CONSTANTS.QUANTILE_P50;
const QUANTILE_P95 = PROFILER_CONSTANTS.QUANTILE_P95;
const QUANTILE_P99 = PROFILER_CONSTANTS.QUANTILE_P99;

/**
 * @class ReleaseSimulationProfiler
 * @description debugMode의 객체 기반 상세 계측과 분리된 저오버헤드 시뮬레이션 계측기입니다.
 */
export class ReleaseSimulationProfiler {
    /**
     * @param {object} [options={}] - 테스트 또는 런타임 용량 설정입니다.
     */
    constructor(options = {}) {
        this.frameCapacity = normalizePositiveInteger(
            options.frameCapacity,
            PROFILER_CONSTANTS.FRAME_RING_CAPACITY
        );
        this.fixedCapacity = normalizePositiveInteger(
            options.fixedCapacity,
            PROFILER_CONSTANTS.FIXED_RING_CAPACITY
        );
        this.rateWindowMs = normalizePositiveNumber(options.rateWindowMs, RATE_WINDOW_MS);
        this.quantileWindowMs = Math.max(
            this.rateWindowMs,
            normalizePositiveNumber(options.quantileWindowMs, QUANTILE_WINDOW_MS)
        );
        this.snapshotIntervalMs = normalizePositiveNumber(
            options.snapshotIntervalMs,
            SNAPSHOT_INTERVAL_MS
        );

        this.frameTimestamps = new Float64Array(this.frameCapacity);
        this.frameCpuDurations = new Float64Array(this.frameCapacity);
        this.frameIntervals = new Float64Array(this.frameCapacity);
        this.fixedTimestamps = new Float64Array(this.fixedCapacity);
        this.fixedCpuDurations = new Float64Array(this.fixedCapacity);
        this.frameCpuScratch = new Float64Array(this.frameCapacity);
        this.frameIntervalScratch = new Float64Array(this.frameCapacity);
        this.fixedCpuScratch = new Float64Array(this.fixedCapacity);
        this.snapshot = createEmptySnapshot();

        this.enabled = false;
        this.active = false;
        this.fixedStepSeconds = 1 / 60;
        this.reset(0);
    }

    /**
     * 계측 활성 상태를 전환합니다.
     * @param {boolean} enabled - 활성 여부입니다.
     * @param {number} [timestampMs=0] - 활성화 시각입니다.
     * @returns {boolean} 최종 활성 상태입니다.
     */
    setEnabled(enabled, timestampMs = 0) {
        const nextEnabled = enabled === true;
        if (nextEnabled === this.enabled) {
            return this.enabled;
        }

        this.enabled = nextEnabled;
        this.active = nextEnabled;
        this.reset(timestampMs);
        this.snapshot.enabled = nextEnabled;
        this.snapshot.active = nextEnabled;
        return this.enabled;
    }

    /**
     * 누적 지표와 rolling 표본을 초기화합니다.
     * @param {number} [timestampMs=0] - 초기화 시각입니다.
     */
    reset(timestampMs = 0) {
        this.frameWriteIndex = 0;
        this.frameSampleCount = 0;
        this.fixedWriteIndex = 0;
        this.fixedSampleCount = 0;
        this.totalFrameCount = 0;
        this.totalScheduledFixedStepCount = 0;
        this.totalCompletedFixedStepCount = 0;
        this.totalFailedFixedStepCount = 0;
        this.totalDroppedFixedStepCount = 0;
        this.totalDroppedDebtSeconds = 0;
        this.totalFrameDeltaClampLossSeconds = 0;
        this.totalActiveWallSeconds = 0;
        this.totalCpuBoundFrameCount = 0;
        this.totalCpuBoundEntryCount = 0;
        this.previousCpuBound = false;
        this.segmentActiveWallSeconds = 0;
        this.snapshotWindowElapsedSeconds = 0;
        this.snapshotWindowDroppedFixedStepCount = 0;
        this.snapshotWindowCpuBoundFrameCount = 0;
        this.snapshotWindowFrameCount = 0;
        this.lastSnapshotTimestampMs = normalizeTimestamp(timestampMs, 0);
        this.#resetSnapshot();
    }

    /**
     * 창 비활성화처럼 main loop가 멈추는 구간을 rolling 통계에서 제외합니다.
     */
    suspend() {
        if (!this.enabled) {
            return;
        }
        this.active = false;
        this.snapshot.active = false;
    }

    /**
     * 새 활성 구간을 시작하고 pause 이전 rolling 표본을 제거합니다.
     * @param {number} [timestampMs=0] - 재개 시각입니다.
     */
    resume(timestampMs = 0) {
        if (!this.enabled) {
            return;
        }
        this.active = true;
        this.snapshot.active = true;
        this.frameWriteIndex = 0;
        this.frameSampleCount = 0;
        this.fixedWriteIndex = 0;
        this.fixedSampleCount = 0;
        this.segmentActiveWallSeconds = 0;
        this.snapshotWindowElapsedSeconds = 0;
        this.snapshotWindowDroppedFixedStepCount = 0;
        this.snapshotWindowCpuBoundFrameCount = 0;
        this.snapshotWindowFrameCount = 0;
        this.previousCpuBound = false;
        this.lastSnapshotTimestampMs = normalizeTimestamp(timestampMs, this.lastSnapshotTimestampMs);
    }

    /**
     * 현재 fixed tick을 계측해야 하는지 반환합니다.
     * @returns {boolean} 수집 여부입니다.
     */
    isCollecting() {
        return this.enabled === true && this.active === true;
    }

    /**
     * fixed tick 한 번의 실제 완료 여부와 CPU 시간을 기록합니다.
     * @param {number} timestampMs - tick 종료 시각입니다.
     * @param {number} durationMs - tick 전체 CPU 시간입니다.
     * @param {boolean} completed - tick 정상 완료 여부입니다.
     */
    recordFixedStep(timestampMs, durationMs, completed) {
        if (!this.isCollecting()) {
            return;
        }

        if (completed !== true) {
            this.totalFailedFixedStepCount++;
            return;
        }

        const safeTimestamp = normalizeTimestamp(timestampMs, 0);
        const safeDuration = normalizeNonNegativeNumber(durationMs, 0);
        const writeIndex = this.fixedWriteIndex;
        this.fixedTimestamps[writeIndex] = safeTimestamp;
        this.fixedCpuDurations[writeIndex] = safeDuration;
        this.fixedWriteIndex = (writeIndex + 1) % this.fixedCapacity;
        this.fixedSampleCount = Math.min(this.fixedCapacity, this.fixedSampleCount + 1);
        this.totalCompletedFixedStepCount++;
    }

    /**
     * 표시 프레임과 scheduler의 debt 정보를 기록합니다.
     * @param {number} timestampMs - 프레임 작업 종료 시각입니다.
     * @param {number} frameCpuMs - 계측기 집계 직전까지의 프레임 CPU 시간입니다.
     * @param {number} frameIntervalSeconds - raw rAF 간격입니다.
     * @param {number} scheduledFixedStepCount - 이번 프레임에 예약한 fixed tick 수입니다.
     * @param {number} droppedFixedStepCount - modulo로 폐기한 정수 tick 수입니다.
     * @param {number} frameDeltaClampLossSeconds - max frame delta 제한으로 폐기한 시간입니다.
     * @param {number} fixedStepSeconds - fixed tick 단위 시간입니다.
     * @param {boolean} cpuBound - catch-up 정책의 실제 CPU 포화 상태입니다.
     */
    recordFrame(
        timestampMs,
        frameCpuMs,
        frameIntervalSeconds,
        scheduledFixedStepCount,
        droppedFixedStepCount,
        frameDeltaClampLossSeconds,
        fixedStepSeconds,
        cpuBound
    ) {
        if (!this.isCollecting()) {
            return;
        }

        const safeIntervalSeconds = normalizePositiveNumber(frameIntervalSeconds, 0);
        if (safeIntervalSeconds <= 0) {
            return;
        }

        const safeTimestamp = normalizeTimestamp(timestampMs, 0);
        const safeFrameCpuMs = normalizeNonNegativeNumber(frameCpuMs, 0);
        const safeScheduledCount = normalizeNonNegativeInteger(scheduledFixedStepCount, 0);
        const safeDroppedCount = normalizeNonNegativeInteger(droppedFixedStepCount, 0);
        const safeClampLossSeconds = normalizeNonNegativeNumber(frameDeltaClampLossSeconds, 0);
        const safeFixedStepSeconds = normalizePositiveNumber(fixedStepSeconds, this.fixedStepSeconds);
        const isCpuBound = cpuBound === true;
        this.fixedStepSeconds = safeFixedStepSeconds;

        const writeIndex = this.frameWriteIndex;
        this.frameTimestamps[writeIndex] = safeTimestamp;
        this.frameCpuDurations[writeIndex] = safeFrameCpuMs;
        this.frameIntervals[writeIndex] = safeIntervalSeconds * 1000;
        this.frameWriteIndex = (writeIndex + 1) % this.frameCapacity;
        this.frameSampleCount = Math.min(this.frameCapacity, this.frameSampleCount + 1);

        this.totalFrameCount++;
        this.totalScheduledFixedStepCount += safeScheduledCount;
        this.totalDroppedFixedStepCount += safeDroppedCount;
        this.totalDroppedDebtSeconds += safeDroppedCount * safeFixedStepSeconds;
        this.totalFrameDeltaClampLossSeconds += safeClampLossSeconds;
        this.totalActiveWallSeconds += safeIntervalSeconds;
        this.segmentActiveWallSeconds += safeIntervalSeconds;
        this.snapshotWindowElapsedSeconds += safeIntervalSeconds;
        this.snapshotWindowDroppedFixedStepCount += safeDroppedCount;
        this.snapshotWindowFrameCount++;

        if (isCpuBound) {
            this.totalCpuBoundFrameCount++;
            this.snapshotWindowCpuBoundFrameCount++;
            if (!this.previousCpuBound) {
                this.totalCpuBoundEntryCount++;
            }
        }
        this.previousCpuBound = isCpuBound;

        if ((safeTimestamp - this.lastSnapshotTimestampMs) >= this.snapshotIntervalMs) {
            this.#publishSnapshot(safeTimestamp);
        }
    }

    /**
     * 마지막으로 계산된 읽기 전용 스냅샷 객체를 반환합니다.
     * 호출자는 객체를 수정하지 않습니다.
     * @returns {object} 캐시된 계측 스냅샷입니다.
     */
    getSnapshot() {
        return this.snapshot;
    }

    /**
     * @private
     * @param {number} timestampMs - snapshot 기준 시각입니다.
     */
    #publishSnapshot(timestampMs) {
        const rateThreshold = timestampMs - this.rateWindowMs;
        const quantileThreshold = timestampMs - this.quantileWindowMs;
        let rateFrameCount = 0;
        let quantileFrameCount = 0;
        let rateFixedCount = 0;
        let quantileFixedCount = 0;

        for (let i = 0; i < this.frameSampleCount; i++) {
            const index = resolveRingIndex(this.frameWriteIndex, this.frameSampleCount, this.frameCapacity, i);
            const timestamp = this.frameTimestamps[index];
            if (timestamp > rateThreshold) {
                rateFrameCount++;
            }
            if (timestamp > quantileThreshold) {
                this.frameCpuScratch[quantileFrameCount] = this.frameCpuDurations[index];
                this.frameIntervalScratch[quantileFrameCount] = this.frameIntervals[index];
                quantileFrameCount++;
            }
        }

        for (let i = 0; i < this.fixedSampleCount; i++) {
            const index = resolveRingIndex(this.fixedWriteIndex, this.fixedSampleCount, this.fixedCapacity, i);
            const timestamp = this.fixedTimestamps[index];
            if (timestamp > rateThreshold) {
                rateFixedCount++;
            }
            if (timestamp > quantileThreshold) {
                this.fixedCpuScratch[quantileFixedCount++] = this.fixedCpuDurations[index];
            }
        }

        const rateWindowSeconds = Math.max(
            Number.EPSILON,
            Math.min(this.rateWindowMs / 1000, this.segmentActiveWallSeconds)
        );
        const snapshotWindowSeconds = Math.max(Number.EPSILON, this.snapshotWindowElapsedSeconds);
        const totalSimulationSeconds = this.totalCompletedFixedStepCount * this.fixedStepSeconds;
        const failedSimulationSeconds = this.totalFailedFixedStepCount * this.fixedStepSeconds;
        const totalLostSimulationSeconds = this.totalDroppedDebtSeconds
            + this.totalFrameDeltaClampLossSeconds
            + failedSimulationSeconds;
        sortScratch(this.frameIntervalScratch, quantileFrameCount);
        sortScratch(this.frameCpuScratch, quantileFrameCount);
        sortScratch(this.fixedCpuScratch, quantileFixedCount);
        const snapshot = this.snapshot;
        snapshot.enabled = this.enabled;
        snapshot.active = this.active;
        snapshot.revision++;
        snapshot.rateWindowSeconds = rateWindowSeconds;
        snapshot.quantileWindowSeconds = Math.min(
            this.quantileWindowMs / 1000,
            this.segmentActiveWallSeconds
        );
        snapshot.frameRate = rateFrameCount / rateWindowSeconds;
        snapshot.actualFixedTicksPerSecond = rateFixedCount / rateWindowSeconds;
        snapshot.cumulativeFixedTicksPerSecond = this.totalActiveWallSeconds > 0
            ? this.totalCompletedFixedStepCount / this.totalActiveWallSeconds
            : 0;
        snapshot.droppedFixedStepsPerSecond = this.snapshotWindowDroppedFixedStepCount / snapshotWindowSeconds;
        snapshot.windowDroppedFixedStepCount = this.snapshotWindowDroppedFixedStepCount;
        snapshot.totalDroppedFixedStepCount = this.totalDroppedFixedStepCount;
        snapshot.totalFailedFixedStepCount = this.totalFailedFixedStepCount;
        snapshot.totalScheduledFixedStepCount = this.totalScheduledFixedStepCount;
        snapshot.totalCompletedFixedStepCount = this.totalCompletedFixedStepCount;
        snapshot.totalDroppedDebtSeconds = this.totalDroppedDebtSeconds;
        snapshot.totalFrameDeltaClampLossSeconds = this.totalFrameDeltaClampLossSeconds;
        snapshot.totalLostSimulationSeconds = totalLostSimulationSeconds;
        snapshot.totalActiveWallSeconds = this.totalActiveWallSeconds;
        snapshot.totalSimulationSeconds = totalSimulationSeconds;
        snapshot.simulationProgressRatio = this.totalActiveWallSeconds > 0
            ? totalSimulationSeconds / this.totalActiveWallSeconds
            : 0;
        snapshot.cpuBoundFramePercent = this.snapshotWindowFrameCount > 0
            ? (this.snapshotWindowCpuBoundFrameCount / this.snapshotWindowFrameCount) * 100
            : 0;
        snapshot.totalCpuBoundEntryCount = this.totalCpuBoundEntryCount;
        snapshot.frameSampleCount = quantileFrameCount;
        snapshot.fixedSampleCount = quantileFixedCount;
        snapshot.frameIntervalP50Ms = resolveNearestRankQuantile(
            this.frameIntervalScratch,
            quantileFrameCount,
            QUANTILE_P50
        );
        snapshot.frameIntervalP95Ms = resolveNearestRankQuantile(
            this.frameIntervalScratch,
            quantileFrameCount,
            QUANTILE_P95
        );
        snapshot.frameIntervalP99Ms = resolveNearestRankQuantile(
            this.frameIntervalScratch,
            quantileFrameCount,
            QUANTILE_P99
        );
        snapshot.frameCpuP50Ms = resolveNearestRankQuantile(
            this.frameCpuScratch,
            quantileFrameCount,
            QUANTILE_P50
        );
        snapshot.frameCpuP95Ms = resolveNearestRankQuantile(
            this.frameCpuScratch,
            quantileFrameCount,
            QUANTILE_P95
        );
        snapshot.frameCpuP99Ms = resolveNearestRankQuantile(
            this.frameCpuScratch,
            quantileFrameCount,
            QUANTILE_P99
        );
        snapshot.fixedCpuP50Ms = resolveNearestRankQuantile(
            this.fixedCpuScratch,
            quantileFixedCount,
            QUANTILE_P50
        );
        snapshot.fixedCpuP95Ms = resolveNearestRankQuantile(
            this.fixedCpuScratch,
            quantileFixedCount,
            QUANTILE_P95
        );
        snapshot.fixedCpuP99Ms = resolveNearestRankQuantile(
            this.fixedCpuScratch,
            quantileFixedCount,
            QUANTILE_P99
        );

        this.snapshotWindowElapsedSeconds = 0;
        this.snapshotWindowDroppedFixedStepCount = 0;
        this.snapshotWindowCpuBoundFrameCount = 0;
        this.snapshotWindowFrameCount = 0;
        this.lastSnapshotTimestampMs = timestampMs;
    }

    /**
     * @private
     */
    #resetSnapshot() {
        const enabled = this.enabled === true;
        const active = this.active === true;
        Object.assign(this.snapshot, createEmptySnapshot());
        this.snapshot.enabled = enabled;
        this.snapshot.active = active;
    }
}

const releaseSimulationProfiler = new ReleaseSimulationProfiler();

/**
 * 전역 릴리스 시뮬레이션 계측 상태를 전환합니다.
 * @param {boolean} enabled - 활성 여부입니다.
 * @param {number} [timestampMs=performance.now()] - 전환 시각입니다.
 * @returns {boolean} 최종 활성 상태입니다.
 */
export function setReleaseSimulationProfilerEnabled(enabled, timestampMs = performance.now()) {
    return releaseSimulationProfiler.setEnabled(enabled, timestampMs);
}

/**
 * 현재 릴리스 시뮬레이션 계측이 활성 구간인지 반환합니다.
 * @returns {boolean} 수집 여부입니다.
 */
export function isReleaseSimulationProfilerCollecting() {
    return releaseSimulationProfiler.isCollecting();
}

/**
 * 현재 프레임 제어 모드가 release simulation profiler 기록 대상인지 반환합니다.
 * 애니메이션 디버그의 정지·단일 스텝은 인위적인 프레임이므로 frame/fixed 샘플과
 * scheduler debt 및 frame delta clamp 손실을 모두 기록하지 않습니다.
 * @param {'running'|'paused'|'step'|string|undefined} frameMode - 디버그 프레임 제어 모드입니다.
 * @returns {boolean} 일반 실행 프레임을 기록해야 하면 true입니다.
 */
export function shouldRecordReleaseSimulationForFrameMode(frameMode) {
    return frameMode !== 'paused' && frameMode !== 'step';
}

/**
 * main loop 일시정지 구간을 계측에서 제외합니다.
 */
export function suspendReleaseSimulationProfiler() {
    releaseSimulationProfiler.suspend();
}

/**
 * main loop 재개 뒤 새 rolling 구간을 시작합니다.
 * @param {number} [timestampMs=performance.now()] - 재개 시각입니다.
 */
export function resumeReleaseSimulationProfiler(timestampMs = performance.now()) {
    releaseSimulationProfiler.resume(timestampMs);
}

/**
 * fixed tick 계측값을 전역 수집기에 기록합니다.
 * @param {number} timestampMs - tick 종료 시각입니다.
 * @param {number} durationMs - tick CPU 시간입니다.
 * @param {boolean} completed - 정상 완료 여부입니다.
 */
export function recordReleaseSimulationFixedStep(timestampMs, durationMs, completed) {
    releaseSimulationProfiler.recordFixedStep(timestampMs, durationMs, completed);
}

/**
 * frame/scheduler 계측값을 전역 수집기에 기록합니다.
 * @param {number} timestampMs - 프레임 작업 종료 시각입니다.
 * @param {number} frameCpuMs - 프레임 CPU 시간입니다.
 * @param {number} frameIntervalSeconds - raw rAF 간격입니다.
 * @param {number} scheduledFixedStepCount - 예약 fixed tick 수입니다.
 * @param {number} droppedFixedStepCount - 폐기 fixed tick 수입니다.
 * @param {number} frameDeltaClampLossSeconds - frame delta clamp 손실 시간입니다.
 * @param {number} fixedStepSeconds - fixed tick 시간입니다.
 * @param {boolean} cpuBound - CPU 포화 상태입니다.
 */
export function recordReleaseSimulationFrame(
    timestampMs,
    frameCpuMs,
    frameIntervalSeconds,
    scheduledFixedStepCount,
    droppedFixedStepCount,
    frameDeltaClampLossSeconds,
    fixedStepSeconds,
    cpuBound
) {
    releaseSimulationProfiler.recordFrame(
        timestampMs,
        frameCpuMs,
        frameIntervalSeconds,
        scheduledFixedStepCount,
        droppedFixedStepCount,
        frameDeltaClampLossSeconds,
        fixedStepSeconds,
        cpuBound
    );
}

/**
 * 캐시된 릴리스 시뮬레이션 지표를 반환합니다.
 * @returns {object} 읽기 전용 스냅샷입니다.
 */
export function getReleaseSimulationProfilerSnapshot() {
    return releaseSimulationProfiler.getSnapshot();
}

/**
 * 빈 계측 스냅샷을 생성합니다.
 * @returns {object} 초기 스냅샷입니다.
 */
function createEmptySnapshot() {
    return {
        enabled: false,
        active: false,
        revision: 0,
        rateWindowSeconds: 0,
        quantileWindowSeconds: 0,
        frameRate: 0,
        actualFixedTicksPerSecond: 0,
        cumulativeFixedTicksPerSecond: 0,
        droppedFixedStepsPerSecond: 0,
        windowDroppedFixedStepCount: 0,
        totalDroppedFixedStepCount: 0,
        totalFailedFixedStepCount: 0,
        totalScheduledFixedStepCount: 0,
        totalCompletedFixedStepCount: 0,
        totalDroppedDebtSeconds: 0,
        totalFrameDeltaClampLossSeconds: 0,
        totalLostSimulationSeconds: 0,
        totalActiveWallSeconds: 0,
        totalSimulationSeconds: 0,
        simulationProgressRatio: 0,
        cpuBoundFramePercent: 0,
        totalCpuBoundEntryCount: 0,
        frameSampleCount: 0,
        fixedSampleCount: 0,
        frameIntervalP50Ms: 0,
        frameIntervalP95Ms: 0,
        frameIntervalP99Ms: 0,
        frameCpuP50Ms: 0,
        frameCpuP95Ms: 0,
        frameCpuP99Ms: 0,
        fixedCpuP50Ms: 0,
        fixedCpuP95Ms: 0,
        fixedCpuP99Ms: 0
    };
}

/**
 * ring의 오래된 표본부터 순서대로 실제 index를 반환합니다.
 * @param {number} writeIndex - 다음 쓰기 위치입니다.
 * @param {number} count - 보유 표본 수입니다.
 * @param {number} capacity - ring 용량입니다.
 * @param {number} ordinal - 오래된 순서 기준 index입니다.
 * @returns {number} 실제 배열 index입니다.
 */
function resolveRingIndex(writeIndex, count, capacity, ordinal) {
    const firstIndex = count < capacity ? 0 : writeIndex;
    return (firstIndex + ordinal) % capacity;
}

/**
 * nearest-rank 분위수를 계산합니다.
 * @param {Float64Array} scratch - 정렬할 재사용 배열입니다.
 * @param {number} count - 유효 표본 수입니다.
 * @param {number} quantile - 0~1 분위수입니다.
 * @returns {number} 분위수 값입니다.
 */
function resolveNearestRankQuantile(scratch, count, quantile) {
    if (count <= 0) {
        return 0;
    }
    const rank = Math.max(1, Math.ceil(quantile * count));
    return scratch[Math.min(count - 1, rank - 1)];
}

/**
 * 재사용 scratch의 유효 범위만 오름차순 정렬합니다.
 * @param {Float64Array} scratch - 정렬할 배열입니다.
 * @param {number} count - 유효 표본 수입니다.
 */
function sortScratch(scratch, count) {
    if (count > 1) {
        scratch.subarray(0, count).sort();
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
 * 유한한 0 이상 숫자를 반환합니다.
 * @param {number} value - 입력 값입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 숫자입니다.
 */
function normalizeNonNegativeNumber(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
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

/**
 * 유한한 0 이상 정수를 반환합니다.
 * @param {number} value - 입력 값입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 정수입니다.
 */
function normalizeNonNegativeInteger(value, fallback) {
    return Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : fallback;
}

/**
 * 유한한 timestamp를 반환합니다.
 * @param {number} value - 입력 timestamp입니다.
 * @param {number} fallback - 기본값입니다.
 * @returns {number} 정규화된 timestamp입니다.
 */
function normalizeTimestamp(value, fallback) {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}
