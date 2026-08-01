const RETIRED_COLLECTOR_CAPACITY = 128;
const RETIRED_COLLECTOR_MAX_AGE_FRAMES = 4096;

let enabled = false;
let frameId = 0;
let trialGeneration = 0;
let retiredCollectorSerial = 0;
let retiredCollectors = [];
let retiredHandoffCount = 0;
let retiredCompletedCount = 0;
let retiredCapacityEvictionCount = 0;
let retiredExpirationCount = 0;
let retiredPollFailureCount = 0;
let retiredDroppedGpuSampleCount = 0;
let retiredDroppedFrameSampleCount = 0;
let retiredSourceDroppedFrameSampleCount = 0;
let webGLContextLossCount = 0;

/**
 * WebGL GPU telemetry의 app-wide 활성 상태를 전환합니다.
 * 모든 live renderer는 다음 beginFrame에서 이 단일 authority에 수렴합니다.
 * @param {boolean} value - 활성 여부입니다.
 * @returns {boolean} 최종 활성 상태입니다.
 */
export function setWebGLGpuTelemetryEnabled(value) {
    enabled = value === true;
    return enabled;
}

/**
 * 현재 WebGL GPU telemetry 활성 상태를 반환합니다.
 * @returns {boolean} 활성 여부입니다.
 */
export function isWebGLGpuTelemetryEnabled() {
    return enabled;
}

/**
 * 활성 성능 실행의 공통 표시 frame ID를 한 번 전진시킵니다.
 * 비활성 상태에서는 카운터를 변경하지 않습니다. retiring query는 GPU를 기다리지 않고 poll합니다.
 * @returns {number} 현재 frame ID입니다.
 */
export function advanceWebGLGpuTelemetryFrame() {
    if (!enabled) {
        return frameId;
    }
    frameId += 1;
    if (frameId >= Number.MAX_SAFE_INTEGER) {
        frameId = 1;
    }
    serviceRetiredCollectors();
    return frameId;
}

/**
 * 모든 WebGL context가 공유하는 현재 표시 frame ID를 반환합니다.
 * @returns {number} 현재 frame ID입니다.
 */
export function getWebGLGpuTelemetryFrameId() {
    return frameId;
}

/**
 * 현재 trial 세대를 반환합니다. frame ID reset 전후의 늦은 query 결과를 구분합니다.
 * @returns {number} 단조 증가 trial 세대입니다.
 */
export function getWebGLGpuTelemetryTrialGeneration() {
    return trialGeneration;
}

/**
 * 독립 trial이 같은 frame 번호에서 시작하도록 공통 시계를 초기화하고 세대를 전진시킵니다.
 * retiring query는 그대로 유지되어 이전 세대 identity로 안전하게 배출됩니다.
 * @returns {void}
 */
export function resetWebGLGpuTelemetryFrameId() {
    frameId = 0;
    trialGeneration += 1;
    if (trialGeneration >= Number.MAX_SAFE_INTEGER) {
        trialGeneration = 1;
    }
}

/**
 * telemetry 실행 중 WebGL context loss를 전역 trial-invalid 신호로 기록합니다.
 * @returns {number} 누적 context loss 수입니다.
 */
export function recordWebGLGpuTelemetryContextLoss() {
    webGLContextLossCount += 1;
    return webGLContextLossCount;
}

/**
 * surface에서 분리되는 timer ring과 마지막 frame counter의 소유권을 중앙 collector로 넘깁니다.
 * query 완료를 기다리거나 동기 readback을 수행하지 않습니다.
 * @param {object} options - retiring renderer 자료입니다.
 * @param {string} options.rendererId - query를 시작한 renderer 식별자입니다.
 * @param {object|null} options.timerQueryRing - 분리할 WebGLGpuTimerQueryRing입니다.
 * @param {Array<object>} [options.frameSamples=[]] - renderer가 아직 발행하지 않은 frame 표본입니다.
 * @param {number} [options.droppedFrameSampleCount=0] - renderer-local ring에서 이미 손실된 표본 수입니다.
 * @returns {boolean} 중앙 collector가 진단 또는 미완료 자료를 인수했으면 true입니다.
 */
export function retireWebGLGpuTelemetryCollector(options = {}) {
    const rendererId = typeof options.rendererId === 'string' && options.rendererId
        ? options.rendererId
        : 'overlay-effect';
    const timerQueryRing = options.timerQueryRing ?? null;
    const frameSamples = Array.isArray(options.frameSamples)
        ? Array.from(options.frameSamples)
        : [];
    const sourceDroppedFrameSampleCount = normalizeNonNegativeInteger(
        options.droppedFrameSampleCount
    );
    const timerSnapshot = readTimerSnapshot(timerQueryRing);
    const hasTimerWork = timerSnapshot === null
        ? timerQueryRing !== null
        : countBufferedGpuWork(timerSnapshot) > 0;
    const hasDiagnostics = sourceDroppedFrameSampleCount > 0
        || hasInvalidTimerDiagnostics(timerSnapshot);

    if (!hasTimerWork && frameSamples.length === 0 && !hasDiagnostics) {
        destroyTimerRing(timerQueryRing);
        return false;
    }

    if (retiredCollectors.length >= RETIRED_COLLECTOR_CAPACITY) {
        const evicted = retiredCollectors.shift();
        retiredCapacityEvictionCount += 1;
        discardRetiredCollector(evicted);
    }

    retiredCollectorSerial += 1;
    if (retiredCollectorSerial >= Number.MAX_SAFE_INTEGER) {
        retiredCollectorSerial = 1;
    }
    retiredHandoffCount += 1;
    retiredSourceDroppedFrameSampleCount += sourceDroppedFrameSampleCount;
    retiredCollectors.push({
        collectorId: retiredCollectorSerial,
        rendererId,
        timerQueryRing,
        frameSamples,
        sourceDroppedFrameSampleCount,
        retiredAtTrialGeneration: trialGeneration,
        retiredAtFrameId: frameId,
        ageFrames: 0,
        terminalReason: null
    });
    return true;
}

/**
 * retiring renderer의 준비된 GPU/frame 표본을 비동기로 배출합니다.
 * pending query가 남은 collector는 다음 호출까지 보존합니다.
 * @returns {{gpuSamples:Array<object>,frameSamples:Array<object>,collectorSnapshots:Array<object>,state:object}} 배출 결과입니다.
 */
export function drainRetiredWebGLGpuTelemetry() {
    const gpuSamples = [];
    const frameSamples = [];
    const collectorSnapshots = [];
    const retained = [];

    for (let index = 0; index < retiredCollectors.length; index++) {
        const collector = retiredCollectors[index];
        pollRetiredCollector(collector);
        const rawGpuSamples = drainTimerSamples(collector);
        for (let sampleIndex = 0; sampleIndex < rawGpuSamples.length; sampleIndex++) {
            const sample = rawGpuSamples[sampleIndex];
            gpuSamples.push(Object.freeze({
                ...sample,
                rendererId: sample?.rendererId || collector.rendererId
            }));
        }
        for (let sampleIndex = 0; sampleIndex < collector.frameSamples.length; sampleIndex++) {
            const sample = collector.frameSamples[sampleIndex];
            frameSamples.push(Object.freeze({
                ...sample,
                rendererId: sample?.rendererId || collector.rendererId
            }));
        }
        collector.frameSamples.length = 0;

        const timer = readTimerSnapshot(collector.timerQueryRing);
        const completed = collector.timerQueryRing === null
            || (timer !== null && countBufferedGpuWork(timer) === 0);
        collectorSnapshots.push(Object.freeze({
            collectorId: collector.collectorId,
            rendererId: collector.rendererId,
            retiredAtTrialGeneration: collector.retiredAtTrialGeneration,
            retiredAtFrameId: collector.retiredAtFrameId,
            ageFrames: collector.ageFrames,
            sourceDroppedFrameSampleCount: collector.sourceDroppedFrameSampleCount,
            terminalReason: collector.terminalReason,
            completed,
            timer
        }));

        if (completed) {
            destroyTimerRing(collector.timerQueryRing);
            collector.timerQueryRing = null;
            retiredCompletedCount += 1;
        } else {
            retained.push(collector);
        }
    }

    retiredCollectors = retained;
    return Object.freeze({
        gpuSamples,
        frameSamples,
        collectorSnapshots,
        state: getRetiredWebGLGpuTelemetrySnapshot()
    });
}

/**
 * retiring collector의 bounded 상태와 명시적 손실 카운터를 반환합니다.
 * @returns {Readonly<object>} 직렬화 가능한 상태입니다.
 */
export function getRetiredWebGLGpuTelemetrySnapshot() {
    let pendingQueryCount = 0;
    let bufferedGpuSampleCount = 0;
    let bufferedFrameSampleCount = 0;
    for (let index = 0; index < retiredCollectors.length; index++) {
        const collector = retiredCollectors[index];
        const timer = readTimerSnapshot(collector.timerQueryRing);
        pendingQueryCount += normalizeNonNegativeInteger(timer?.pendingCount)
            + (timer?.active === true ? 1 : 0);
        bufferedGpuSampleCount += normalizeNonNegativeInteger(timer?.sampleCount);
        bufferedFrameSampleCount += collector.frameSamples.length;
    }
    return Object.freeze({
        capacity: RETIRED_COLLECTOR_CAPACITY,
        maxAgeFrames: RETIRED_COLLECTOR_MAX_AGE_FRAMES,
        collectorCount: retiredCollectors.length,
        pendingQueryCount,
        bufferedGpuSampleCount,
        bufferedFrameSampleCount,
        handoffCount: retiredHandoffCount,
        completedCount: retiredCompletedCount,
        capacityEvictionCount: retiredCapacityEvictionCount,
        expirationCount: retiredExpirationCount,
        pollFailureCount: retiredPollFailureCount,
        droppedGpuSampleCount: retiredDroppedGpuSampleCount,
        droppedFrameSampleCount: retiredDroppedFrameSampleCount,
        sourceDroppedFrameSampleCount: retiredSourceDroppedFrameSampleCount,
        contextLossCount: webGLContextLossCount
    });
}

/**
 * 테스트/trial 경계에서 retiring collector와 누적 진단을 초기화합니다.
 * 호출 전 정상 하네스는 bounded tail drain으로 collectorCount 0을 확인해야 합니다.
 * @returns {void}
 */
export function resetRetiredWebGLGpuTelemetry() {
    for (let index = 0; index < retiredCollectors.length; index++) {
        discardRetiredCollector(retiredCollectors[index]);
    }
    retiredCollectors = [];
    retiredCollectorSerial = 0;
    retiredHandoffCount = 0;
    retiredCompletedCount = 0;
    retiredCapacityEvictionCount = 0;
    retiredExpirationCount = 0;
    retiredPollFailureCount = 0;
    retiredDroppedGpuSampleCount = 0;
    retiredDroppedFrameSampleCount = 0;
    retiredSourceDroppedFrameSampleCount = 0;
    webGLContextLossCount = 0;
}

function serviceRetiredCollectors() {
    for (let index = 0; index < retiredCollectors.length; index++) {
        const collector = retiredCollectors[index];
        collector.ageFrames += 1;
        pollRetiredCollector(collector);
        if (collector.ageFrames <= RETIRED_COLLECTOR_MAX_AGE_FRAMES
            || collector.timerQueryRing === null) {
            continue;
        }
        retiredExpirationCount += 1;
        const timer = readTimerSnapshot(collector.timerQueryRing);
        retiredDroppedGpuSampleCount += countBufferedGpuWork(timer);
        destroyTimerRing(collector.timerQueryRing);
        collector.timerQueryRing = null;
        collector.terminalReason = 'retired-query-expired';
    }
}

function pollRetiredCollector(collector) {
    if (!collector?.timerQueryRing || collector.terminalReason) {
        return;
    }
    try {
        collector.timerQueryRing.poll?.();
    } catch {
        retiredPollFailureCount += 1;
        const timer = readTimerSnapshot(collector.timerQueryRing);
        retiredDroppedGpuSampleCount += countBufferedGpuWork(timer);
        destroyTimerRing(collector.timerQueryRing);
        collector.timerQueryRing = null;
        collector.terminalReason = 'retired-query-poll-failed';
    }
}

function drainTimerSamples(collector) {
    if (!collector?.timerQueryRing || collector.terminalReason) {
        return [];
    }
    try {
        const samples = collector.timerQueryRing.drainSamples?.();
        return Array.isArray(samples) ? samples : Array.from(samples || []);
    } catch {
        retiredPollFailureCount += 1;
        const timer = readTimerSnapshot(collector.timerQueryRing);
        retiredDroppedGpuSampleCount += countBufferedGpuWork(timer);
        destroyTimerRing(collector.timerQueryRing);
        collector.timerQueryRing = null;
        collector.terminalReason = 'retired-query-drain-failed';
        return [];
    }
}

function discardRetiredCollector(collector) {
    if (!collector) {
        return;
    }
    const timer = readTimerSnapshot(collector.timerQueryRing);
    retiredDroppedGpuSampleCount += countBufferedGpuWork(timer);
    retiredDroppedFrameSampleCount += collector.frameSamples?.length ?? 0;
    destroyTimerRing(collector.timerQueryRing);
    collector.timerQueryRing = null;
}

function readTimerSnapshot(timerQueryRing) {
    if (!timerQueryRing || typeof timerQueryRing.getSnapshot !== 'function') {
        return null;
    }
    try {
        return timerQueryRing.getSnapshot();
    } catch {
        return null;
    }
}

function destroyTimerRing(timerQueryRing) {
    try {
        timerQueryRing?.destroy?.();
    } catch {
        // 진단 정리는 앱의 surface destroy를 중단하지 않습니다.
    }
}

function countBufferedGpuWork(snapshot) {
    if (!snapshot) {
        return 0;
    }
    return normalizeNonNegativeInteger(snapshot.pendingCount)
        + normalizeNonNegativeInteger(snapshot.sampleCount)
        + (snapshot.active === true ? 1 : 0);
}

function hasInvalidTimerDiagnostics(snapshot) {
    if (!snapshot) {
        return false;
    }
    return snapshot.status === 'faulted'
        || normalizeNonNegativeInteger(snapshot.rejectedBeginCount) > 0
        || normalizeNonNegativeInteger(snapshot.disjointCount) > 0
        || normalizeNonNegativeInteger(snapshot.discardedQueryCount) > 0
        || normalizeNonNegativeInteger(snapshot.apiFailureCount) > 0;
}

function normalizeNonNegativeInteger(value) {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
