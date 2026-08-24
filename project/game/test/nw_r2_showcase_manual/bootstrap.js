import {
    installR2ShowcaseManualLauncher
} from '../support/r2_showcase_manual_launcher.js';
import {
    PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS,
    PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT
} from 'data/scene/game/performance_serpentine_wave_data.js';
import {
    getReleaseSimulationProfilerSnapshot,
    setReleaseSimulationProfilerEnabled
} from 'simulation/release_simulation_profiler.js';
import { getWebGpuFrameTelemetryPort } from 'display/display_system.js';
import { fsPromises, path } from 'util/nw_bridge.js';

const AUTO_SOAK_RESULT_PREFIX = 'R2_AUTO_SOAK_RESULT ';
const AUTO_SOAK_POLL_INTERVAL_MS = 250;
const AUTO_SOAK_READY_TIMEOUT_MS = 30_000;
const AUTO_SOAK_RECEIPT_IDENTITY_ENV
    = 'CIRVIVOR_R2_SHOWCASE_RECEIPT_IDENTITY';
const AUTO_SOAK_EVIDENCE_DIRECTORY_ENV
    = 'CIRVIVOR_R2_SHOWCASE_EVIDENCE_DIR';
const AUTO_SOAK_COMPLETION_METHODS = Object.freeze({
    projectileCapture:
        'commitCompletedProjectileCaptureProgramsAtFixedBoundary',
    projectileRelease:
        'commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary',
    atomicTransform:
        'commitCompletedAtomicTransformProgramsAtFixedBoundary',
    effect: 'commitCompletedEffectProgramsAtFixedBoundary',
    formation: 'commitCompletedFormationProgramsAtFixedBoundary',
    routeAvailability:
        'commitCompletedRouteAvailabilityProgramsAtFixedBoundary',
    genericEvents: 'commitCompletedEventsAtFixedBoundary'
});
const PERFORMANCE_DEFINITION_SPAWN_COUNT
    = PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT
        / PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS.length;
const PERFORMANCE_DEFINITION_SPAWN_COUNTS = Object.freeze(Object.fromEntries(
    PERFORMANCE_SERPENTINE_ENEMY_DEFINITION_IDS.map((definitionId) => [
        definitionId,
        PERFORMANCE_DEFINITION_SPAWN_COUNT
    ])
));

function getRuntimeProcess() {
    return globalThis.nw?.process ?? globalThis.process;
}

function readAutoSoakDurationMs() {
    const runtimeProcess = getRuntimeProcess();
    const seconds = Number(
        runtimeProcess?.env?.CIRVIVOR_R2_SHOWCASE_AUTO_SOAK_SECONDS ?? 0
    );
    return Number.isFinite(seconds) && seconds > 0
        ? Math.min(600, seconds) * 1000
        : 0;
}

function readAutoSoakTarget() {
    const runtimeProcess = getRuntimeProcess();
    return runtimeProcess?.env?.CIRVIVOR_R2_SHOWCASE_AUTO_TARGET
        === 'performance-map-2'
        ? 'performance-map-2'
        : 'showcase-wave-1';
}

function readAutoSoakReceiptIdentity() {
    const serialized = getRuntimeProcess()?.env?.[AUTO_SOAK_RECEIPT_IDENTITY_ENV];
    if (typeof serialized !== 'string' || serialized.length === 0) {
        throw new Error('자동 soak receipt에 Git/worktree identity가 없습니다.');
    }
    const identity = JSON.parse(serialized);
    for (const key of [
        'headCommit',
        'headTree',
        'worktreeContentKey',
        'mapContentKey',
        'waveContentKey',
        'workloadContentKey'
    ]) {
        if (typeof identity?.[key] !== 'string' || identity[key].length === 0) {
            throw new Error(`자동 soak receipt identity ${key}가 유효하지 않습니다.`);
        }
    }
    return Object.freeze({ ...identity });
}

async function persistAutoSoakReceipt(result) {
    const evidenceDirectory = getRuntimeProcess()?.env
        ?.[AUTO_SOAK_EVIDENCE_DIRECTORY_ENV];
    if (typeof evidenceDirectory !== 'string' || evidenceDirectory.length === 0) {
        throw new Error('자동 soak receipt evidence directory가 없습니다.');
    }
    const revisionKey = result.identity.worktreeContentKey
        .replace(/^sha256:/, '')
        .slice(0, 16);
    const receiptPath = path.join(
        evidenceDirectory,
        `r2-performance-receipt-${result.mapId}-${result.waveId}-${revisionKey}.json`
    );
    const receipt = Object.freeze({ ...result, receiptPath });
    await fsPromises.mkdir(evidenceDirectory, { recursive: true });
    await fsPromises.writeFile(
        receiptPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        'utf8'
    );
    return receipt;
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values, ratio) {
    if (values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * ratio) - 1)
    )];
}

function summarizeDurationSamples(values) {
    return Object.freeze({
        count: values.length,
        totalMs: values.reduce((sum, value) => sum + value, 0),
        p50Ms: percentile(values, 0.5),
        p95Ms: percentile(values, 0.95),
        p99Ms: percentile(values, 0.99),
        maximumMs: values.length > 0 ? Math.max(...values) : null
    });
}

function requestAutoSoakForeground() {
    const appWindow = globalThis.nw?.Window?.get?.();
    appWindow?.show?.();
    appWindow?.focus?.();
    window.focus();
    window.Game?.start?.();
    return document.hasFocus();
}

function installAutoSoakDiagnostics() {
    const game = window.Game;
    const systemHandler = game?.systemHandler;
    const gameSystem = systemHandler?.sceneSystem?.scene?.getGameSystem?.();
    const endpoint = gameSystem?.getGpuSimulationEndpoint?.();
    const objectSystem = gameSystem?.getObjectSystem?.();
    const frameTelemetryPort = getWebGpuFrameTelemetryPort();
    if (!systemHandler
        || !gameSystem
        || !objectSystem
        || !endpoint
        || !frameTelemetryPort) {
        throw new Error('자동 soak diagnostics에 actual Game/System/endpoint가 필요합니다.');
    }
    const counters = {
        renderFrameCount: 0,
        frameDeltaSecondsTotal: 0,
        rafTimestampDeltaMsTotal: 0,
        wallTimestampDeltaMsTotal: 0,
        rafFrameDeltaMs: [],
        wallFrameDeltaMs: [],
        longFrameSamples: [],
        debugFrameModeHistogram: {},
        previousFrameCpuMs: [],
        scheduledFixedStepHistogram: {},
        scheduledFixedStepCount: 0,
        completedFixedStepCount: 0,
        partialFixedFrameCount: 0,
        gameFixedAttemptCount: 0,
        gameFixedAdvancedCount: 0,
        endpointSubmitCount: 0,
        endpointSubmitDeferredCount: 0,
        acceptedSpawnCountByDefinitionId: {},
        catchUpMaximumStepHistogram: {},
        phaseDurationSamplesMs: {
            gameFixedAdvanced: [],
            gameFixedDeferred: [],
            endpointFixedSubmitted: [],
            endpointFixedDeferred: [],
            lifecycleCommit: [],
            endpointDraw: []
        },
        detailedPhaseDurationSamplesMs: {},
        completion: Object.fromEntries(
            Object.keys(AUTO_SOAK_COMPLETION_METHODS).map((label) => [label, {
                callCount: 0,
                pendingCount: 0,
                protocolFailureCount: 0,
                readyDurationSamplesMs: [],
                pendingDurationSamplesMs: []
            }])
        )
    };
    let lastRafTimestamp = Number(game.lastFrameTimestamp);
    let lastWallTimestamp = performance.now();
    const restorers = [];
    if (frameTelemetryPort.setEnabled(true) !== true) {
        throw new Error('자동 soak WebGPU frame telemetry를 활성화하지 못했습니다.');
    }
    restorers.push(() => frameTelemetryPort.setEnabled(false));
    const wrap = (owner, methodName, wrapper) => {
        const original = owner?.[methodName];
        if (typeof original !== 'function') {
            return;
        }
        owner[methodName] = function wrappedAutoSoakMethod(...args) {
            return wrapper(original, this, args);
        };
        restorers.push(() => {
            owner[methodName] = original;
        });
    };
    const wrapTimed = (owner, methodName, label) => {
        wrap(owner, methodName, (original, receiver, args) => {
            const startedAt = performance.now();
            try {
                return original.apply(receiver, args);
            } finally {
                const samples = counters.detailedPhaseDurationSamplesMs[label]
                    ?? (counters.detailedPhaseDurationSamplesMs[label] = []);
                samples.push(performance.now() - startedAt);
            }
        });
    };
    const recordAcceptedSpawn = (request) => {
        const intent = request?.intent;
        const definitionId = intent?.enemyDefinitionId ?? intent?.definitionId;
        if (typeof definitionId !== 'string'
            || definitionId.length === 0
            || typeof intent?.waveId !== 'string') {
            return;
        }
        counters.acceptedSpawnCountByDefinitionId[definitionId]
            = (counters.acceptedSpawnCountByDefinitionId[definitionId] ?? 0) + 1;
    };

    wrap(endpoint, 'requestSpawn', (original, receiver, args) => {
        const result = original.apply(receiver, args);
        if (result?.accepted === true) {
            recordAcceptedSpawn({ intent: args[0] });
        }
        return result;
    });
    wrap(endpoint, 'requestSpawnBatch', (original, receiver, args) => {
        const result = original.apply(receiver, args);
        if (result?.accepted === true && Array.isArray(args[0])) {
            for (const request of args[0]) {
                recordAcceptedSpawn(request);
            }
        }
        return result;
    });

    for (const [owner, methodName, label] of [
        [objectSystem, 'fixedUpdate', 'objectFixed'],
        [objectSystem.waveDirector, 'queueSpawnsForFixedTick', 'waveQueueSpawns'],
        [objectSystem.actorPayloadMaterializer, 'observeCompleted',
            'actorPayloadObserveCompleted'],
        [objectSystem.actorPayloadMaterializer, 'stageReadyForFixedTick',
            'actorPayloadStageReady'],
        [objectSystem.abilityRuntime, 'observeCompletedSubjectSnapshots',
            'abilityObserveCompleted'],
        [objectSystem.abilityRuntime, 'stageForFixedTick', 'abilityStage'],
        [objectSystem.projectileCaptureDirector,
            'observeCompletedCapturePrograms', 'projectileCaptureObserve'],
        [objectSystem.projectileCaptureDirector,
            'observeCompletedReleasePrograms', 'projectileReleaseObserve'],
        [objectSystem.projectileCaptureDirector, 'observeCompletedEvents',
            'projectileEventObserve'],
        [objectSystem.projectileCaptureDirector, 'stageForFixedTick',
            'projectileCaptureStage'],
        [objectSystem.jorangSplitLineageDirector, 'observeCompletedPreparations',
            'atomicTransformObserve'],
        [objectSystem.jorangSplitLineageDirector, 'observeCompletedEvents',
            'jorangEventObserve'],
        [objectSystem.jorangSplitLineageDirector, 'stageForFixedTick',
            'atomicTransformStage'],
        [objectSystem.pentagonEffectDirector, 'observeCompletedEvents',
            'effectObserve'],
        [objectSystem.pentagonEffectDirector, 'stageForFixedTick', 'effectStage'],
        [objectSystem.formationRuntimeDirector, 'observeCompletedPreparations',
            'formationObserve'],
        [objectSystem.formationRuntimeDirector, 'stageForFixedTick',
            'formationStage'],
        [objectSystem.hostileAttackDirector, 'observeCompletedEvents',
            'hostileObserve'],
        [objectSystem.hostileAttackDirector, 'stageForFixedTick', 'hostileStage'],
        [objectSystem.enemyCoreImpactDirector, 'observeCompletedEvents',
            'coreImpactObserve'],
        [objectSystem.enemyCoreImpactDirector, 'stageForFixedTick',
            'coreImpactStage'],
        [objectSystem.bountyRewardDirector, 'observeCompletedEvents',
            'bountyObserve']
    ]) {
        wrapTimed(owner, methodName, label);
    }

    wrap(systemHandler, 'tick', (original, receiver, args) => {
        counters.renderFrameCount++;
        const rafTimestamp = Number(game.lastFrameTimestamp);
        const wallTimestamp = performance.now();
        let rafDeltaMs = null;
        let wallDeltaMs = null;
        if (Number.isFinite(rafTimestamp) && Number.isFinite(lastRafTimestamp)) {
            rafDeltaMs = Math.max(
                0,
                rafTimestamp - lastRafTimestamp
            );
            counters.rafTimestampDeltaMsTotal += rafDeltaMs;
            counters.rafFrameDeltaMs.push(rafDeltaMs);
        }
        wallDeltaMs = Math.max(
            0,
            wallTimestamp - lastWallTimestamp
        );
        counters.wallTimestampDeltaMsTotal += wallDeltaMs;
        counters.wallFrameDeltaMs.push(wallDeltaMs);
        if (Math.max(rafDeltaMs ?? 0, wallDeltaMs) >= 50
            && counters.longFrameSamples.length < 64) {
            const fixedTick = Number(gameSystem.getFixedTick?.());
            counters.longFrameSamples.push(Object.freeze({
                fixedTick: Number.isInteger(fixedTick) ? fixedTick : null,
                pulsePhase: Number.isInteger(fixedTick) ? fixedTick % 120 : null,
                rafDeltaMs,
                wallDeltaMs
            }));
        }
        lastRafTimestamp = rafTimestamp;
        lastWallTimestamp = wallTimestamp;
        const frameDeltaSeconds = Number(args[0]?.frameDeltaSeconds);
        if (Number.isFinite(frameDeltaSeconds) && frameDeltaSeconds >= 0) {
            counters.frameDeltaSecondsTotal += frameDeltaSeconds;
        }
        const previousFrameCpuSeconds = Number(game.lastFrameCpuSeconds);
        if (Number.isFinite(previousFrameCpuSeconds) && previousFrameCpuSeconds >= 0) {
            counters.previousFrameCpuMs.push(previousFrameCpuSeconds * 1000);
        }
        const scheduled = Number.isInteger(args[0]?.fixedStepCount)
            ? Math.max(0, args[0].fixedStepCount)
            : 0;
        const debugFrameMode = String(args[0]?.debugFrameMode ?? 'missing');
        counters.debugFrameModeHistogram[debugFrameMode]
            = (counters.debugFrameModeHistogram[debugFrameMode] ?? 0) + 1;
        counters.scheduledFixedStepHistogram[scheduled]
            = (counters.scheduledFixedStepHistogram[scheduled] ?? 0) + 1;
        counters.scheduledFixedStepCount += scheduled;
        const completed = original.apply(receiver, args);
        const normalizedCompleted = Number.isInteger(completed)
            ? Math.min(scheduled, Math.max(0, completed))
            : scheduled;
        counters.completedFixedStepCount += normalizedCompleted;
        if (normalizedCompleted < scheduled) {
            counters.partialFixedFrameCount++;
        }
        return completed;
    });
    wrap(game.fixedStepCatchUpPolicy, 'resolveMaxSteps', (original, receiver, args) => {
        const maximumSteps = original.apply(receiver, args);
        counters.catchUpMaximumStepHistogram[maximumSteps]
            = (counters.catchUpMaximumStepHistogram[maximumSteps] ?? 0) + 1;
        return maximumSteps;
    });
    wrap(gameSystem, 'fixedUpdate', (original, receiver, args) => {
        counters.gameFixedAttemptCount++;
        const startedAt = performance.now();
        const advanced = original.apply(receiver, args);
        const elapsedMs = performance.now() - startedAt;
        if (advanced === true) {
            counters.gameFixedAdvancedCount++;
            counters.phaseDurationSamplesMs.gameFixedAdvanced.push(elapsedMs);
        } else {
            counters.phaseDurationSamplesMs.gameFixedDeferred.push(elapsedMs);
        }
        return advanced;
    });
    wrap(endpoint, 'fixedUpdate', (original, receiver, args) => {
        counters.endpointSubmitCount++;
        const startedAt = performance.now();
        const submitted = original.apply(receiver, args);
        const elapsedMs = performance.now() - startedAt;
        if (submitted !== true) {
            counters.endpointSubmitDeferredCount++;
            counters.phaseDurationSamplesMs.endpointFixedDeferred.push(elapsedMs);
        } else {
            counters.phaseDurationSamplesMs.endpointFixedSubmitted.push(elapsedMs);
        }
        return submitted;
    });
    wrap(endpoint, 'commitAtFixedBoundary', (original, receiver, args) => {
        const startedAt = performance.now();
        const result = original.apply(receiver, args);
        counters.phaseDurationSamplesMs.lifecycleCommit.push(
            performance.now() - startedAt
        );
        return result;
    });
    wrap(endpoint, 'draw', (original, receiver, args) => {
        const startedAt = performance.now();
        const result = original.apply(receiver, args);
        counters.phaseDurationSamplesMs.endpointDraw.push(
            performance.now() - startedAt
        );
        return result;
    });
    for (const [label, methodName] of Object.entries(AUTO_SOAK_COMPLETION_METHODS)) {
        wrap(endpoint, methodName, (original, receiver, args) => {
            const startedAt = performance.now();
            const result = original.apply(receiver, args);
            const elapsedMs = performance.now() - startedAt;
            const counter = counters.completion[label];
            counter.callCount++;
            if (result?.pending === true) {
                counter.pendingCount++;
                counter.pendingDurationSamplesMs.push(elapsedMs);
            } else {
                counter.readyDurationSamplesMs.push(elapsedMs);
            }
            if (result?.protocolFailure) {
                counter.protocolFailureCount++;
            }
            return result;
        });
    }

    return Object.freeze({
        reset() {
            counters.renderFrameCount = 0;
            counters.frameDeltaSecondsTotal = 0;
            counters.rafTimestampDeltaMsTotal = 0;
            counters.wallTimestampDeltaMsTotal = 0;
            counters.rafFrameDeltaMs.length = 0;
            counters.wallFrameDeltaMs.length = 0;
            counters.longFrameSamples.length = 0;
            counters.debugFrameModeHistogram = {};
            counters.previousFrameCpuMs.length = 0;
            counters.scheduledFixedStepHistogram = {};
            counters.scheduledFixedStepCount = 0;
            counters.completedFixedStepCount = 0;
            counters.partialFixedFrameCount = 0;
            counters.gameFixedAttemptCount = 0;
            counters.gameFixedAdvancedCount = 0;
            counters.endpointSubmitCount = 0;
            counters.endpointSubmitDeferredCount = 0;
            counters.catchUpMaximumStepHistogram = {};
            for (const samples of Object.values(
                counters.phaseDurationSamplesMs
            )) {
                samples.length = 0;
            }
            for (const samples of Object.values(
                counters.detailedPhaseDurationSamplesMs
            )) {
                samples.length = 0;
            }
            lastRafTimestamp = Number(game.lastFrameTimestamp);
            lastWallTimestamp = performance.now();
            for (const counter of Object.values(counters.completion)) {
                counter.callCount = 0;
                counter.pendingCount = 0;
                counter.protocolFailureCount = 0;
                counter.readyDurationSamplesMs.length = 0;
                counter.pendingDurationSamplesMs.length = 0;
            }
        },
        snapshot() {
            const snapshot = JSON.parse(JSON.stringify(counters));
            snapshot.phaseTimings = Object.freeze(Object.fromEntries(
                Object.entries(counters.phaseDurationSamplesMs).map(
                    ([label, samples]) => [
                        label,
                        summarizeDurationSamples(samples)
                    ]
                )
            ));
            delete snapshot.phaseDurationSamplesMs;
            snapshot.detailedPhaseTimings = Object.freeze(Object.fromEntries(
                Object.entries(counters.detailedPhaseDurationSamplesMs).map(
                    ([label, samples]) => [
                        label,
                        summarizeDurationSamples(samples)
                    ]
                )
            ));
            delete snapshot.detailedPhaseDurationSamplesMs;
            for (const [label, counter] of Object.entries(
                snapshot.completion
            )) {
                counter.readyTiming = summarizeDurationSamples(
                    counters.completion[label].readyDurationSamplesMs
                );
                counter.pendingTiming = summarizeDurationSamples(
                    counters.completion[label].pendingDurationSamplesMs
                );
                delete counter.readyDurationSamplesMs;
                delete counter.pendingDurationSamplesMs;
            }
            return snapshot;
        },
        routeRuntimeSnapshot() {
            return endpoint.getRouteAvailabilityRuntimeStatus();
        },
        restore() {
            for (let index = restorers.length - 1; index >= 0; index--) {
                restorers[index]();
            }
        }
    });
}

async function waitForReadySnapshot(api) {
    const deadline = performance.now() + AUTO_SOAK_READY_TIMEOUT_MS;
    let lastSnapshotError = null;
    let previousActiveSnapshot = null;
    while (performance.now() < deadline) {
        try {
            requestAutoSoakForeground();
            const snapshot = api.getSnapshot();
            const active = snapshot.fixedTick > 0
                && snapshot.endpoint.runtimeState === 'gpu-ready'
                && snapshot.windowFocused === true
                && snapshot.loopRunning === true
                && snapshot.recoveryRequired === false;
            if (active
                && previousActiveSnapshot
                && snapshot.fixedTick > previousActiveSnapshot.fixedTick
                && snapshot.frameTiming.lastFrameTimestamp
                    > previousActiveSnapshot.frameTiming.lastFrameTimestamp) {
                return snapshot;
            }
            previousActiveSnapshot = active ? snapshot : null;
            lastSnapshotError = null;
        } catch (error) {
            lastSnapshotError = error;
            previousActiveSnapshot = null;
        }
        await wait(AUTO_SOAK_POLL_INTERVAL_MS);
    }
    throw new Error([
        '자동 soak가 30초 안에 GPU-ready fixed tick을 관찰하지 못했습니다.',
        lastSnapshotError ? String(lastSnapshotError?.message ?? lastSnapshotError) : ''
    ].filter(Boolean).join(' '));
}

async function runAutoSoak(
    api,
    durationMs,
    diagnostics,
    autoSoakTarget,
    receiptIdentity
) {
    const startSnapshot = await waitForReadySnapshot(api);
    setReleaseSimulationProfilerEnabled(true, performance.now());
    diagnostics.reset();
    const startedAt = performance.now();
    const cpuSamplesMs = [];
    let maximumActiveBodyCount = startSnapshot.endpoint.activeBodyCount;
    let maximumPendingCommandCount = startSnapshot.endpoint.pendingCommandCount;
    let routeRuntimeStatus = diagnostics.routeRuntimeSnapshot();
    let routeClosedSteadyStateSampleCount = 0;
    let routeReadbackBypassEligibleSampleCount = 0;
    let routeProjectileThreatSampleCount = 0;
    let maximumRouteProjectileThreatBodyCount = 0;
    let maximumRoutePendingReadbackCount = 0;
    let sampleCount = 0;
    let endSnapshot = startSnapshot;
    while ((performance.now() - startedAt) < durationMs) {
        requestAutoSoakForeground();
        await wait(AUTO_SOAK_POLL_INTERVAL_MS);
        endSnapshot = api.getSnapshot();
        sampleCount++;
        maximumActiveBodyCount = Math.max(
            maximumActiveBodyCount,
            endSnapshot.endpoint.activeBodyCount
        );
        maximumPendingCommandCount = Math.max(
            maximumPendingCommandCount,
            endSnapshot.endpoint.pendingCommandCount
        );
        routeRuntimeStatus = diagnostics.routeRuntimeSnapshot();
        routeClosedSteadyStateSampleCount += Number(
            routeRuntimeStatus.closedSteadyState === true
        );
        routeReadbackBypassEligibleSampleCount += Number(
            routeRuntimeStatus.readbackBypassEligible === true
        );
        routeProjectileThreatSampleCount += Number(
            routeRuntimeStatus.projectileThreatBodyCount > 0
        );
        maximumRouteProjectileThreatBodyCount = Math.max(
            maximumRouteProjectileThreatBodyCount,
            routeRuntimeStatus.projectileThreatBodyCount
        );
        maximumRoutePendingReadbackCount = Math.max(
            maximumRoutePendingReadbackCount,
            routeRuntimeStatus.pendingReadbackCount
        );
        const cpuSeconds = endSnapshot.frameTiming.lastFrameCpuSeconds;
        if (Number.isFinite(cpuSeconds) && cpuSeconds >= 0) {
            cpuSamplesMs.push(cpuSeconds * 1000);
        }
    }
    const elapsedSeconds = Math.max(
        Number.EPSILON,
        (performance.now() - startedAt) / 1000
    );
    const advancedFixedTickCount = Math.max(
        0,
        endSnapshot.fixedTick - startSnapshot.fixedTick
    );
    const schedulerDiagnostics = diagnostics.snapshot();
    const allFrameCpuValues = schedulerDiagnostics.previousFrameCpuMs;
    const rafFrameDeltaValues = schedulerDiagnostics.rafFrameDeltaMs;
    const wallFrameDeltaValues = schedulerDiagnostics.wallFrameDeltaMs;
    delete schedulerDiagnostics.previousFrameCpuMs;
    delete schedulerDiagnostics.rafFrameDeltaMs;
    delete schedulerDiagnostics.wallFrameDeltaMs;
    const activeSimulationSeconds = Math.max(
        Number.EPSILON,
        schedulerDiagnostics.frameDeltaSecondsTotal
    );
    const releaseProfiler = Object.freeze({
        ...getReleaseSimulationProfilerSnapshot()
    });
    const observedDefinitionSpawnCounts = Object.freeze({
        ...schedulerDiagnostics.acceptedSpawnCountByDefinitionId
    });
    const expectedDefinitionSpawnCounts = autoSoakTarget === 'performance-map-2'
        ? PERFORMANCE_DEFINITION_SPAWN_COUNTS
        : null;
    const definitionSpawnCountsMatch = expectedDefinitionSpawnCounts === null
        || Object.entries(expectedDefinitionSpawnCounts).every(
            ([definitionId, expectedCount]) => (
                observedDefinitionSpawnCounts[definitionId] === expectedCount
            )
        );
    const requiredWorkloadCompleted = endSnapshot.wave.allSpawnsQueued === true
        && endSnapshot.wave.remainingSpawnCount === 0
        && endSnapshot.wave.blockedSpawnCount === 0
        && endSnapshot.endpoint.pendingCommandCount === 0
        && (autoSoakTarget !== 'performance-map-2'
            || (endSnapshot.wave.totalSpawnCount
                    === PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT
                && endSnapshot.wave.queuedSpawnCount
                    === PERFORMANCE_SERPENTINE_TOTAL_SPAWN_COUNT
                && definitionSpawnCountsMatch));
    const completionProtocolFailureCount = Object.values(
        schedulerDiagnostics.completion
    ).reduce((sum, entry) => sum + entry.protocolFailureCount, 0);
    const endpointProtocolFailureCount = Number(
        endSnapshot.endpoint.eventProtocolFailure !== null
    );
    const protocolFailureCount = completionProtocolFailureCount
        + endpointProtocolFailureCount;
    const uncapturedErrorCount = Number(
        endSnapshot.performanceTelemetry.frameComposer
            ?.counters?.uncapturedErrorCount ?? -1
    );
    const unexpectedCapacityOverflowCount = Number(
        endSnapshot.performanceTelemetry.unexpectedCapacityOverflowCount
    );
    const requiredStorageBuffersPerShaderStage = Number(
        endSnapshot.performanceTelemetry
            .requiredStorageBuffersPerShaderStage
    );
    const passed = requiredWorkloadCompleted
        && releaseProfiler.totalCompletedFixedStepCount > 0
        && releaseProfiler.totalFailedFixedStepCount === 0
        && releaseProfiler.totalDroppedFixedStepCount === 0
        && releaseProfiler.totalLostSimulationSeconds === 0
        && endSnapshot.recoveryRequired === false
        && endSnapshot.recovery.restartCount === 0
        && endSnapshot.recovery.failureCount === 0
        && protocolFailureCount === 0
        && uncapturedErrorCount === 0
        && unexpectedCapacityOverflowCount === 0
        && requiredStorageBuffersPerShaderStage > 0
        && requiredStorageBuffersPerShaderStage <= 9;
    return Object.freeze({
        status: passed ? 'pass' : 'fail',
        identity: receiptIdentity,
        mapId: endSnapshot.mapId,
        waveId: endSnapshot.waveId,
        mapContentKey: receiptIdentity.mapContentKey,
        waveContentKey: receiptIdentity.waveContentKey,
        workloadContentKey: receiptIdentity.workloadContentKey,
        elapsedSeconds,
        sampleCount,
        startFixedTick: startSnapshot.fixedTick,
        endFixedTick: endSnapshot.fixedTick,
        advancedFixedTickCount,
        fixedTicksPerSecond: advancedFixedTickCount / elapsedSeconds,
        activeSimulationSeconds,
        fixedTicksPerActiveSimulationSecond:
            advancedFixedTickCount / activeSimulationSeconds,
        foregroundCoverageRatio: Math.min(
            1,
            activeSimulationSeconds / elapsedSeconds
        ),
        startActiveBodyCount: startSnapshot.endpoint.activeBodyCount,
        endActiveBodyCount: endSnapshot.endpoint.activeBodyCount,
        maximumActiveBodyCount,
        maximumPendingCommandCount,
        queuedSpawnCount: endSnapshot.wave.queuedSpawnCount,
        remainingSpawnCount: endSnapshot.wave.remainingSpawnCount,
        workload: Object.freeze({
            requiredCompleted: requiredWorkloadCompleted,
            totalSpawnCount: endSnapshot.wave.totalSpawnCount,
            queuedSpawnCount: endSnapshot.wave.queuedSpawnCount,
            remainingSpawnCount: endSnapshot.wave.remainingSpawnCount,
            blockedSpawnCount: endSnapshot.wave.blockedSpawnCount,
            allSpawnsQueued: endSnapshot.wave.allSpawnsQueued,
            expectedDefinitionSpawnCounts,
            observedDefinitionSpawnCounts,
            definitionSpawnCountsMatch
        }),
        highWater: Object.freeze({
            body: endSnapshot.performanceTelemetry.bodyHighWater,
            activeBody: endSnapshot.performanceTelemetry.activeBodyHighWater,
            projectile: endSnapshot.performanceTelemetry.projectileHighWater,
            contact: endSnapshot.performanceTelemetry.contactHighWater,
            effect: endSnapshot.performanceTelemetry.effectHighWater,
            pentagonPulse: endSnapshot.performanceTelemetry.pentagonPulse
        }),
        fixed: Object.freeze({
            scheduled: releaseProfiler.totalScheduledFixedStepCount,
            completed: releaseProfiler.totalCompletedFixedStepCount,
            deferred: releaseProfiler.totalDeferredFixedStepCount,
            failed: releaseProfiler.totalFailedFixedStepCount,
            dropped: releaseProfiler.totalDroppedFixedStepCount,
            lostSimulationSeconds:
                releaseProfiler.totalLostSimulationSeconds,
            actualFixedTicksPerSecond:
                releaseProfiler.actualFixedTicksPerSecond,
            cumulativeFixedTicksPerSecond:
                releaseProfiler.cumulativeFixedTicksPerSecond,
            simulationProgressRatio:
                releaseProfiler.simulationProgressRatio
        }),
        cpu: Object.freeze({
            frameMs: Object.freeze({
                p50: releaseProfiler.frameCpuP50Ms,
                p95: releaseProfiler.frameCpuP95Ms,
                p99: releaseProfiler.frameCpuP99Ms
            }),
            fixedMs: Object.freeze({
                p50: releaseProfiler.fixedCpuP50Ms,
                p95: releaseProfiler.fixedCpuP95Ms,
                p99: releaseProfiler.fixedCpuP99Ms
            })
        }),
        gpu: Object.freeze({
            requiredStorageBuffersPerShaderStage,
            limits: endSnapshot.performanceTelemetry.platform.limits,
            adapterInfo: endSnapshot.performanceTelemetry.platform.adapterInfo,
            deviceGeneration:
                endSnapshot.performanceTelemetry.platform.deviceGeneration,
            lostInfo: endSnapshot.performanceTelemetry.platform.lostInfo,
            uncapturedErrorCount,
            unexpectedCapacityOverflow:
                endSnapshot.performanceTelemetry.unexpectedCapacityOverflow,
            unexpectedCapacityOverflowCount
        }),
        failures: Object.freeze({
            recoveryRequired: endSnapshot.recoveryRequired,
            recoveryRestartCount: endSnapshot.recovery.restartCount,
            recoveryFailureCount: endSnapshot.recovery.failureCount,
            protocolFailureCount,
            completionProtocolFailureCount,
            endpointProtocolFailureCount,
            firstRecoveryFailure: endSnapshot.recovery.firstFailure
        }),
        recoveryRequired: endSnapshot.recoveryRequired,
        recoveryRestartCount: endSnapshot.recovery.restartCount,
        recoveryFailureCount: endSnapshot.recovery.failureCount,
        firstRecoveryFailure: endSnapshot.recovery.firstFailure,
        backendState: endSnapshot.endpoint.backendState,
        backendGpuState: endSnapshot.endpoint.backendGpuState,
        routeRuntimeStatus,
        routeDiagnostics: Object.freeze({
            routeClosedSteadyStateSampleCount,
            routeReadbackBypassEligibleSampleCount,
            routeProjectileThreatSampleCount,
            maximumRouteProjectileThreatBodyCount,
            maximumRoutePendingReadbackCount
        }),
        schedulerDiagnostics,
        endFramePolicy: endSnapshot.framePolicy,
        endPauseReasons: endSnapshot.pauseReasons,
        frameCpuMs: Object.freeze({
            p50: percentile(cpuSamplesMs, 0.5),
            p95: percentile(cpuSamplesMs, 0.95),
            p99: percentile(cpuSamplesMs, 0.99),
            maximum: cpuSamplesMs.length > 0 ? Math.max(...cpuSamplesMs) : null
        }),
        allFrameCpuMs: Object.freeze({
            p50: percentile(allFrameCpuValues, 0.5),
            p95: percentile(allFrameCpuValues, 0.95),
            p99: percentile(allFrameCpuValues, 0.99),
            maximum: allFrameCpuValues.length > 0
                ? Math.max(...allFrameCpuValues)
                : null
        }),
        frameGapMs: Object.freeze({
            rafP99: percentile(rafFrameDeltaValues, 0.99),
            rafMaximum: rafFrameDeltaValues.length > 0
                ? Math.max(...rafFrameDeltaValues)
                : null,
            wallP99: percentile(wallFrameDeltaValues, 0.99),
            wallMaximum: wallFrameDeltaValues.length > 0
                ? Math.max(...wallFrameDeltaValues)
                : null
        }),
        releaseProfiler
    });
}

async function bootstrap() {
    const api = await installR2ShowcaseManualLauncher();
    const autoSoakDurationMs = readAutoSoakDurationMs();
    if (autoSoakDurationMs <= 0) {
        return;
    }
    try {
        const autoSoakTarget = readAutoSoakTarget();
        const receiptIdentity = readAutoSoakReceiptIdentity();
        if (autoSoakTarget === 'performance-map-2') {
            api.selectPerformanceMap();
        } else {
            api.selectWave(1);
        }
        const diagnostics = installAutoSoakDiagnostics();
        try {
            const result = await runAutoSoak(
                api,
                autoSoakDurationMs,
                diagnostics,
                autoSoakTarget,
                receiptIdentity
            );
            const receipt = await persistAutoSoakReceipt(result);
            console.log(`${AUTO_SOAK_RESULT_PREFIX}${JSON.stringify(receipt)}`);
        } finally {
            diagnostics.restore();
        }
    } finally {
        setReleaseSimulationProfilerEnabled(false, performance.now());
        api.safeExit();
    }
}

bootstrap().catch((error) => {
    console.error('Post-R2 manual showcase bootstrap failed:', error);
    const failure = document.createElement('pre');
    failure.id = 'r2-manual-bootstrap-failure';
    failure.textContent = `SHOWCASE BOOTSTRAP FAILED\n${error?.stack ?? error}`;
    document.body.appendChild(failure);
});
