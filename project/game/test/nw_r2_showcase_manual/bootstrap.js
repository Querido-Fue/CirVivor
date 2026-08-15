import {
    installR2ShowcaseManualLauncher
} from '../support/r2_showcase_manual_launcher.js';

const AUTO_SOAK_RESULT_PREFIX = 'R2_AUTO_SOAK_RESULT ';
const AUTO_SOAK_POLL_INTERVAL_MS = 250;
const AUTO_SOAK_READY_TIMEOUT_MS = 30_000;
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

function readAutoSoakDurationMs() {
    const runtimeProcess = globalThis.nw?.process ?? globalThis.process;
    const seconds = Number(
        runtimeProcess?.env?.CIRVIVOR_R2_SHOWCASE_AUTO_SOAK_SECONDS ?? 0
    );
    return Number.isFinite(seconds) && seconds > 0
        ? Math.min(600, seconds) * 1000
        : 0;
}

function readAutoSoakTarget() {
    const runtimeProcess = globalThis.nw?.process ?? globalThis.process;
    return runtimeProcess?.env?.CIRVIVOR_R2_SHOWCASE_AUTO_TARGET
        === 'performance-map-2'
        ? 'performance-map-2'
        : 'showcase-wave-1';
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
    if (!systemHandler || !gameSystem || !endpoint) {
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
        catchUpMaximumStepHistogram: {},
        completion: Object.fromEntries(
            Object.keys(AUTO_SOAK_COMPLETION_METHODS).map((label) => [label, {
                callCount: 0,
                pendingCount: 0,
                protocolFailureCount: 0
            }])
        )
    };
    let lastRafTimestamp = Number(game.lastFrameTimestamp);
    let lastWallTimestamp = performance.now();
    const restorers = [];
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
        const advanced = original.apply(receiver, args);
        if (advanced === true) {
            counters.gameFixedAdvancedCount++;
        }
        return advanced;
    });
    wrap(endpoint, 'fixedUpdate', (original, receiver, args) => {
        counters.endpointSubmitCount++;
        const submitted = original.apply(receiver, args);
        if (submitted !== true) {
            counters.endpointSubmitDeferredCount++;
        }
        return submitted;
    });
    for (const [label, methodName] of Object.entries(AUTO_SOAK_COMPLETION_METHODS)) {
        wrap(endpoint, methodName, (original, receiver, args) => {
            const result = original.apply(receiver, args);
            const counter = counters.completion[label];
            counter.callCount++;
            if (result?.pending === true) {
                counter.pendingCount++;
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
            lastRafTimestamp = Number(game.lastFrameTimestamp);
            lastWallTimestamp = performance.now();
            for (const counter of Object.values(counters.completion)) {
                counter.callCount = 0;
                counter.pendingCount = 0;
                counter.protocolFailureCount = 0;
            }
        },
        snapshot() {
            return JSON.parse(JSON.stringify(counters));
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
    while (performance.now() < deadline) {
        try {
            const snapshot = api.getSnapshot();
            if (snapshot.fixedTick > 0
                && snapshot.endpoint.runtimeState === 'gpu-ready'
                && snapshot.recoveryRequired === false) {
                return snapshot;
            }
            lastSnapshotError = null;
        } catch (error) {
            lastSnapshotError = error;
        }
        await wait(AUTO_SOAK_POLL_INTERVAL_MS);
    }
    throw new Error([
        '자동 soak가 30초 안에 GPU-ready fixed tick을 관찰하지 못했습니다.',
        lastSnapshotError ? String(lastSnapshotError?.message ?? lastSnapshotError) : ''
    ].filter(Boolean).join(' '));
}

async function runAutoSoak(api, durationMs, diagnostics) {
    const startSnapshot = await waitForReadySnapshot(api);
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
    return Object.freeze({
        status: endSnapshot.recoveryRequired === false
                && endSnapshot.recovery.restartCount === 0
                && endSnapshot.recovery.failureCount === 0
            ? 'pass'
            : 'fail',
        mapId: endSnapshot.mapId,
        waveId: endSnapshot.waveId,
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
        })
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
        if (autoSoakTarget === 'performance-map-2') {
            api.selectPerformanceMap();
        } else {
            api.selectWave(1);
        }
        const diagnostics = installAutoSoakDiagnostics();
        try {
            const result = await runAutoSoak(api, autoSoakDurationMs, diagnostics);
            console.log(`${AUTO_SOAK_RESULT_PREFIX}${JSON.stringify(result)}`);
        } finally {
            diagnostics.restore();
        }
    } finally {
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
