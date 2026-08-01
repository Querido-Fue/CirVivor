import {
    drainRetiredWebGLGpuTelemetry,
    getRetiredWebGLGpuTelemetrySnapshot,
    getWebGLGpuTelemetryFrameId,
    getWebGLGpuTelemetryTrialGeneration,
    resetRetiredWebGLGpuTelemetry,
    resetWebGLGpuTelemetryFrameId,
    setWebGLGpuTelemetryEnabled
} from 'display/webgl/_webgl_gpu_telemetry_state.js';
import { fsPromises, nw, path } from 'util/nw_bridge.js';
import {
    buildGlobalFrameDiagnostics,
    buildGpuCoverageDiagnostics,
    formatGpuCoverageFailure,
    getTelemetryFrameIdentity
} from './coverage_validation.js';
import { getTitleRuntimeState, snapshotOverlayStack } from './title_harness_adapter.js';
import { ensureTitleReady, runTitleScenario } from './scenario_driver.js';

const FRAME_WAIT_TIMEOUT_MS = 10_000;
const GAME_ASSIGNMENT_TIMEOUT_MS = 30_000;
const QUERY_DRAIN_FRAME_LIMIT = 120;
const RESULT_SCHEMA_VERSION = 1;
const { Buffer } = window.require('buffer');

const harnessBridge = globalThis.__CIRVIVOR_TITLE_GPU_HARNESS__;
const config = harnessBridge?.config || {};
const resultPath = process.env.CIRVIVOR_TITLE_GPU_RESULT_PATH;
const artifactDirectory = process.env.CIRVIVOR_TITLE_GPU_ARTIFACT_DIR;
const progressPath = resultPath ? `${resultPath}.progress` : null;

/**
 * 진행 단계를 launcher sidecar에 기록합니다.
 * @param {string} stage - 현재 단계입니다.
 * @returns {void}
 */
function writeProgress(stage) {
    if (!progressPath) {
        return;
    }
    try {
        window.require('fs').writeFileSync(progressPath, `${stage}\n`, 'utf8');
    } catch {
        // progress sidecar 실패는 측정 결과를 바꾸지 않습니다.
    }
}

/**
 * nearest-rank percentile을 계산합니다.
 * @param {number[]} values - raw valid samples입니다.
 * @param {number} percentile - 0~1 percentile입니다.
 * @returns {number|null} percentile 값입니다.
 */
function nearestRank(values, percentile) {
    if (!Array.isArray(values) || values.length === 0) {
        return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.max(1, Math.ceil(percentile * sorted.length));
    return sorted[Math.min(sorted.length - 1, rank - 1)];
}

/**
 * raw sample 통계를 만듭니다.
 * @param {number[]} values - raw samples입니다.
 * @returns {object} 통계입니다.
 */
function summarize(values) {
    const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
    return {
        count: valid.length,
        p50: nearestRank(valid, 0.50),
        p95: nearestRank(valid, 0.95),
        p99: nearestRank(valid, 0.99),
        max: valid.length > 0 ? Math.max(...valid) : null
    };
}

function createScenarioRecord(id) {
    return {
        id,
        firstTrialGeneration: null,
        lastTrialGeneration: null,
        firstFrameId: null,
        lastFrameId: null,
        cpuFrameMs: [],
        rafIntervalMs: [],
        gpuSamples: [],
        frameSamples: [],
        state: null,
        artifact: null
    };
}

/**
 * production App 할당을 real-time timeout으로 기다립니다.
 * @returns {Promise<object>} App입니다.
 */
function waitForGame() {
    const current = harnessBridge?.getGame?.();
    if (current) {
        return Promise.resolve(current);
    }
    return new Promise((resolve, reject) => {
        let unsubscribe = null;
        const timeoutId = setTimeout(() => {
            unsubscribe?.();
            reject(new Error(`production window.Game 할당 제한시간 초과: ${GAME_ASSIGNMENT_TIMEOUT_MS}ms`));
        }, GAME_ASSIGNMENT_TIMEOUT_MS);
        unsubscribe = harnessBridge?.onGameAssigned?.((game) => {
            clearTimeout(timeoutId);
            unsubscribe?.();
            resolve(game);
        });
        if (!unsubscribe) {
            clearTimeout(timeoutId);
            reject(new Error('title GPU bootstrap bridge를 찾지 못했습니다.'));
        }
    });
}

/**
 * production App frame 뒤에 실행되는 rAF callback을 기다립니다.
 * @returns {Promise<number>} synthetic timestamp입니다.
 */
function waitForAnimationFrame() {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(`animation frame 제한시간 초과: ${FRAME_WAIT_TIMEOUT_MS}ms`));
        }, FRAME_WAIT_TIMEOUT_MS);
        requestAnimationFrame((timestamp) => {
            clearTimeout(timeoutId);
            resolve(timestamp);
        });
    });
}

function getTelemetryRenderers(game) {
    const renderers = [];
    const rendererMap = game?.systemHandler?.displaySystem?.webGLHandler?.layerRenderers;
    if (!(rendererMap instanceof Map)) {
        return renderers;
    }
    for (const [layerId, renderer] of rendererMap.entries()) {
        if (typeof renderer?.drainGpuTelemetry !== 'function'
            || typeof renderer?.getGpuTelemetrySnapshot !== 'function') {
            continue;
        }
        renderers.push({ layerId, renderer, rendererId: renderer.rendererId || layerId });
    }
    return renderers;
}

function createCollector(game, scenarioRecords) {
    const frameRoutes = new Map();
    const globalFrameSamples = [];
    const latestRendererSnapshots = new Map();
    const retiredCollectorSnapshots = new Map();
    let latestRetiredState = getRetiredWebGLGpuTelemetrySnapshot();
    let activeScenarioId = null;
    let lastWallFrameTime = null;
    let invalidGpuSampleIdentityCount = 0;

    function createRouteKey(trialGeneration, frameId) {
        return `${trialGeneration}:${frameId}`;
    }

    function getSampleRoute(sample) {
        const frameIdentity = getTelemetryFrameIdentity(sample);
        if (frameIdentity === null) {
            return null;
        }
        return {
            trialGeneration: sample.trialGeneration,
            route: frameRoutes.get(frameIdentity)
        };
    }

    function routeGpuSample(sample) {
        const sampleRoute = getSampleRoute(sample);
        if (sampleRoute === null) {
            invalidGpuSampleIdentityCount += 1;
            return;
        }
        const { route, trialGeneration } = sampleRoute;
        if (!route?.collect || !route.scenarioId) {
            return;
        }
        scenarioRecords.get(route.scenarioId)?.gpuSamples.push({
            rendererId: sample.rendererId,
            trialGeneration,
            frameId: sample.frameId,
            scope: sample.scope,
            gpuMs: sample.gpuMs,
            phase: route.phase,
            metadata: route.metadata
        });
    }

    function routeFrameSample(sample) {
        const sampleRoute = getSampleRoute(sample);
        const route = sampleRoute?.route;
        globalFrameSamples.push({
            ...sample,
            routeFound: Boolean(route),
            routeCollect: route?.collect === true,
            routePhase: route?.phase || null
        });
        if (sampleRoute === null) {
            return;
        }
        const { trialGeneration } = sampleRoute;
        if (!route?.collect || !route.scenarioId) {
            return;
        }
        scenarioRecords.get(route.scenarioId)?.frameSamples.push({
            ...sample,
            trialGeneration,
            phase: route.phase,
            metadata: route.metadata
        });
    }

    function drainRetiredCollectors() {
        const retired = drainRetiredWebGLGpuTelemetry();
        for (const sample of retired.gpuSamples || []) {
            routeGpuSample(sample);
        }
        for (const sample of retired.frameSamples || []) {
            routeFrameSample(sample);
        }
        for (const snapshot of retired.collectorSnapshots || []) {
            retiredCollectorSnapshots.set(snapshot.collectorId, snapshot);
        }
        latestRetiredState = retired.state || getRetiredWebGLGpuTelemetrySnapshot();
    }

    function drainRenderers() {
        latestRendererSnapshots.clear();
        for (const { layerId, renderer, rendererId } of getTelemetryRenderers(game)) {
            const telemetry = renderer.drainGpuTelemetry();
            for (const sample of telemetry.gpuSamples || []) {
                routeGpuSample({
                    ...sample,
                    rendererId: sample.rendererId || rendererId
                });
            }
            for (const sample of telemetry.frameSamples || []) {
                routeFrameSample({ ...sample, rendererId: sample.rendererId || rendererId });
            }
            latestRendererSnapshots.set(layerId, {
                ...renderer.getGpuTelemetrySnapshot(),
                rendererId,
                layerId
            });
        }
        drainRetiredCollectors();
    }

    async function nextFrame(metadata = {}) {
        await waitForAnimationFrame();
        const wallTime = performance.now();
        const frameId = getWebGLGpuTelemetryFrameId();
        const trialGeneration = getWebGLGpuTelemetryTrialGeneration();
        const collect = config.timing !== false
            && metadata.collect === true
            && Boolean(activeScenarioId);
        const routeMetadata = { ...metadata };
        delete routeMetadata.collect;
        delete routeMetadata.preserveRoute;
        if (metadata.preserveRoute !== true) {
            frameRoutes.set(createRouteKey(trialGeneration, frameId), {
                scenarioId: activeScenarioId,
                collect,
                phase: metadata.phase || null,
                metadata: routeMetadata
            });
        }
        if (frameRoutes.size > 8192) {
            const oldestRouteKey = frameRoutes.keys().next().value;
            frameRoutes.delete(oldestRouteKey);
        }

        if (collect) {
            const record = scenarioRecords.get(activeScenarioId);
            record.firstTrialGeneration ??= trialGeneration;
            record.lastTrialGeneration = trialGeneration;
            record.firstFrameId ??= frameId;
            record.lastFrameId = frameId;
            record.cpuFrameMs.push(Math.max(0, Number(game.lastFrameCpuSeconds) * 1000 || 0));
            if (lastWallFrameTime !== null) {
                record.rafIntervalMs.push(Math.max(0, wallTime - lastWallFrameTime));
            }
        }
        lastWallFrameTime = wallTime;
        drainRenderers();
        return { frameId, trialGeneration, wallTime };
    }

    async function drainAllPendingQueries() {
        setWebGLGpuTelemetryEnabled(false);
        for (let frame = 0; frame < QUERY_DRAIN_FRAME_LIMIT; frame++) {
            await nextFrame({
                collect: false,
                phase: 'final-query-drain',
                preserveRoute: true
            });
            const renderers = getTelemetryRenderers(game);
            const livePending = renderers.some(({ renderer }) => {
                const timer = renderer.getGpuTelemetrySnapshot()?.timer || {};
                return timer.active === true
                    || (timer.pendingCount || 0) > 0
                    || (timer.sampleCount || 0) > 0;
            });
            const retiredState = latestRetiredState || getRetiredWebGLGpuTelemetrySnapshot();
            const retiredPending = (retiredState.collectorCount || 0) > 0
                || (retiredState.pendingQueryCount || 0) > 0
                || (retiredState.bufferedGpuSampleCount || 0) > 0
                || (retiredState.bufferedFrameSampleCount || 0) > 0;
            if (!livePending && !retiredPending) {
                drainRenderers();
                return frame + 1;
            }
        }
        throw new Error('최종 GPU query가 비동기 drain 한도 안에 완료되지 않았습니다.');
    }

    return {
        nextFrame,
        drainAllPendingQueries,
        drainRenderers,
        setActiveScenario(id) {
            activeScenarioId = id;
        },
        getRendererSnapshots() {
            drainRenderers();
            return [...latestRendererSnapshots.values()];
        },
        getRetiredDiagnostics() {
            return {
                state: { ...latestRetiredState },
                collectorSnapshots: [...retiredCollectorSnapshots.values()]
            };
        },
        getDiagnostics() {
            return {
                invalidGpuSampleIdentityCount,
                globalFrame: buildGlobalFrameDiagnostics(globalFrameSamples)
            };
        }
    };
}

function buildGpuSummary(samples) {
    const byScope = new Map();
    const perFrameScope = new Map();
    const legacyPerFrame = new Map();
    for (const sample of samples) {
        if (!Number.isFinite(sample.gpuMs) || sample.gpuMs < 0) {
            continue;
        }
        const frameIdentity = getTelemetryFrameIdentity(sample);
        if (frameIdentity === null) {
            continue;
        }
        if (!byScope.has(sample.scope)) {
            byScope.set(sample.scope, []);
        }
        byScope.get(sample.scope).push(sample);
        const scopeFrameKey = `${sample.scope}\u0000${frameIdentity}`;
        perFrameScope.set(scopeFrameKey, (perFrameScope.get(scopeFrameKey) || 0) + sample.gpuMs);
        legacyPerFrame.set(frameIdentity, (legacyPerFrame.get(frameIdentity) || 0) + sample.gpuMs);
    }

    const scopes = {};
    for (const [scope, scopeSamples] of byScope.entries()) {
        const rawQueryValues = scopeSamples.map((sample) => sample.gpuMs);
        const rawFrameTotals = [];
        for (const [key, value] of perFrameScope.entries()) {
            if (key.startsWith(`${scope}\u0000`)) {
                rawFrameTotals.push(value);
            }
        }
        scopes[scope] = {
            query: summarize(rawQueryValues),
            frameTotal: summarize(rawFrameTotals),
            rawQuerySamples: scopeSamples,
            rawFrameTotals
        };
    }
    const legacyTotals = [...legacyPerFrame.entries()].map(([frameIdentity, gpuMs]) => ({
        trialGeneration: Number(frameIdentity.slice(0, frameIdentity.indexOf(':'))),
        frameId: Number(frameIdentity.slice(frameIdentity.indexOf(':') + 1)),
        gpuMs
    }));
    return {
        scopes,
        legacySequentialSum: {
            diagnosticOnly: true,
            stats: summarize(legacyTotals.map((sample) => sample.gpuMs)),
            rawFrameTotals: legacyTotals
        }
    };
}

function createHarnessValidationError(message, validation) {
    const error = new Error(message);
    error.validation = validation;
    return error;
}

function sumFrameCounters(frameSamples) {
    const sums = {};
    for (const sample of frameSamples) {
        for (const [key, value] of Object.entries(sample)) {
            if (key === 'frameId'
                || key === 'trialGeneration'
                || key === 'rendererId'
                || key === 'phase'
                || key === 'metadata') {
                continue;
            }
            if (Number.isFinite(value)) {
                sums[key] = (sums[key] || 0) + value;
            }
        }
    }
    return sums;
}

function collectInvalidDiagnostics(rendererSnapshots, retiredDiagnostics, collectorDiagnostics) {
    const invalid = {
        unsupportedRendererCount: 0,
        rejectedBegin: 0,
        disabledBegin: 0,
        invalidScope: 0,
        overlappingBegin: 0,
        destroyedBegin: 0,
        timerFault: 0,
        faultedBegin: 0,
        faultDiscardedQuery: 0,
        disjoint: 0,
        capacityOverflow: 0,
        apiFailure: 0,
        discardedQuery: 0,
        droppedFrameSample: 0,
        contextLoss: retiredDiagnostics.state.contextLossCount || 0,
        contextInvalidation: 0,
        contextDiscardedQuery: 0,
        failedBlurRefresh: 0,
        failedGlassDraw: 0,
        sourceProviderFailure: 0,
        captureTargetFailure: 0,
        sourceUploadFailure: 0,
        invalidGpuSampleIdentity: collectorDiagnostics.invalidGpuSampleIdentityCount || 0,
        invalidFrameSampleIdentity:
            collectorDiagnostics.globalFrame.invalidFrameIdentitySampleCount || 0,
        unresolvedPending: 0,
        retiredCapacityEviction: retiredDiagnostics.state.capacityEvictionCount || 0,
        retiredExpiration: retiredDiagnostics.state.expirationCount || 0,
        retiredPollFailure: retiredDiagnostics.state.pollFailureCount || 0,
        retiredDroppedGpuSample: retiredDiagnostics.state.droppedGpuSampleCount || 0,
        retiredDroppedFrameSample: retiredDiagnostics.state.droppedFrameSampleCount || 0,
        retiredSourceDroppedFrameSample: retiredDiagnostics.state.sourceDroppedFrameSampleCount || 0,
        retiredUnresolvedCollector: retiredDiagnostics.state.collectorCount || 0,
        retiredUnresolvedPending: retiredDiagnostics.state.pendingQueryCount || 0,
        retiredBufferedGpuSample: retiredDiagnostics.state.bufferedGpuSampleCount || 0,
        retiredBufferedFrameSample: retiredDiagnostics.state.bufferedFrameSampleCount || 0
    };

    function accumulateTimer(snapshot) {
        const timer = snapshot.timer || {};
        if (timer.supported !== true) invalid.unsupportedRendererCount += 1;
        invalid.rejectedBegin += timer.rejectedBeginCount || 0;
        invalid.disabledBegin += timer.disabledBeginCount || 0;
        invalid.invalidScope += timer.invalidScopeCount || 0;
        invalid.overlappingBegin += timer.overlappingBeginCount || 0;
        invalid.destroyedBegin += timer.destroyedBeginCount || 0;
        if (timer.status === 'faulted') invalid.timerFault += 1;
        invalid.faultedBegin += timer.faultedBeginCount || 0;
        invalid.faultDiscardedQuery += timer.faultDiscardedQueryCount || 0;
        invalid.disjoint += timer.disjointCount || 0;
        invalid.capacityOverflow += timer.capacityOverflowCount || 0;
        invalid.apiFailure += timer.apiFailureCount || 0;
        invalid.discardedQuery += timer.discardedQueryCount || 0;
        invalid.contextInvalidation += timer.contextInvalidationCount || 0;
        invalid.contextDiscardedQuery += timer.contextDiscardedQueryCount || 0;
        invalid.droppedFrameSample += snapshot.droppedFrameSampleCount || 0;
        invalid.unresolvedPending += timer.pendingCount || 0;
    }
    for (const snapshot of rendererSnapshots) {
        accumulateTimer(snapshot);
    }
    for (const snapshot of retiredDiagnostics.collectorSnapshots) {
        accumulateTimer(snapshot);
    }
    const globalFrameErrors = collectorDiagnostics.globalFrame.errorCounts;
    invalid.failedBlurRefresh = globalFrameErrors.failedBlurRefresh;
    invalid.failedGlassDraw = globalFrameErrors.failedGlassDraw;
    invalid.sourceProviderFailure = globalFrameErrors.sourceProviderFailure;
    invalid.captureTargetFailure = globalFrameErrors.captureTargetFailure;
    invalid.sourceUploadFailure = globalFrameErrors.sourceUploadFailure;
    return invalid;
}

function calculateQueryResolveRate(rendererSnapshots, retiredCollectorSnapshots) {
    let ended = 0;
    let resolved = 0;
    for (const snapshot of [...rendererSnapshots, ...retiredCollectorSnapshots]) {
        ended += snapshot.timer?.totalEndCount || 0;
        resolved += snapshot.timer?.totalSampleCount || 0;
    }
    return ended > 0 ? resolved / ended : null;
}

function capturePagePng() {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('NW capturePage 제한시간 초과')), 10_000);
        nw.Window.get().capturePage((data) => {
            clearTimeout(timeoutId);
            resolve(typeof data === 'string' ? Buffer.from(data, 'base64') : Buffer.from(data));
        }, { format: 'png', datatype: 'buffer' });
    });
}

async function captureScenarioCheckpoint(game, scenarioId) {
    if (config.capture !== true || !artifactDirectory) {
        return null;
    }
    game.stop();
    try {
        await fsPromises.mkdir(artifactDirectory, { recursive: true });
        const filePath = path.join(artifactDirectory, `${scenarioId}.png`);
        await fsPromises.writeFile(filePath, await capturePagePng());
        return filePath;
    } finally {
        game.start();
    }
}

function collectRuntimeProfile(game) {
    const displaySystem = game?.systemHandler?.displaySystem;
    const titleRuntimeState = getTitleRuntimeState(game);
    const webglContexts = [];
    for (const [layerId, gl] of displaySystem?.webGLHandler?.glContexts?.entries?.() || []) {
        const debugInfo = gl.getExtension?.('WEBGL_debug_renderer_info');
        webglContexts.push({
            layerId,
            version: gl.getParameter?.(gl.VERSION) || null,
            vendor: gl.getParameter?.(gl.VENDOR) || null,
            renderer: gl.getParameter?.(gl.RENDERER) || null,
            unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null
        });
    }
    return {
        platform: process.platform,
        arch: process.arch,
        nw: process.versions.nw,
        chromium: process.versions.chromium,
        node: process.versions.node,
        userAgent: navigator.userAgent,
        secureContext: globalThis.isSecureContext === true,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        webgpuPlatformState: displaySystem?.getWebGpuPlatformState?.() || null,
        webgpuBlurState: displaySystem?.getWebGpuBlurPort?.()?.getSnapshot?.() || null,
        titleGpuRolloutProfile: titleRuntimeState.scene?.titleGpuRolloutProfile || null,
        titleWebGpuShadowDiagnostics:
            titleRuntimeState.presentation?.getTitleWebGpuShadowDiagnostics?.() || null,
        webglContexts
    };
}

async function writeResult(result) {
    if (!resultPath) {
        throw new Error('CIRVIVOR_TITLE_GPU_RESULT_PATH가 없습니다.');
    }
    await fsPromises.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

async function runHarness() {
    if (!harnessBridge) {
        throw new Error('title GPU bootstrap이 production main보다 먼저 실행되지 않았습니다.');
    }
    writeProgress('window-focus');
    nw.Window.get().focus();
    const game = await waitForGame();
    const scenarioRecords = new Map(
        config.scenarios.map((scenarioId) => [scenarioId, createScenarioRecord(scenarioId)])
    );
    const collector = createCollector(game, scenarioRecords);
    const shared = { externalEntry: null };
    const context = {
        game,
        config,
        shared,
        nextFrame: collector.nextFrame
    };

    if (!config.scenarios.includes('T0')) {
        writeProgress('title-ready');
        await ensureTitleReady(context);
    }

    let warmedUp = false;
    if (!config.scenarios.includes('T0')) {
        const warmupFrames = Math.ceil(config.warmupMs / config.clockStepMs);
        writeProgress(`warmup:${warmupFrames}`);
        for (let frame = 0; frame < warmupFrames; frame++) {
            await collector.nextFrame({ collect: false, phase: 'warmup' });
        }
        warmedUp = true;
    }
    for (const scenarioId of config.scenarios) {
        writeProgress(`scenario:${scenarioId}`);
        collector.setActiveScenario(scenarioId);
        const record = scenarioRecords.get(scenarioId);
        record.state = await runTitleScenario(scenarioId, context);
        record.artifact = await captureScenarioCheckpoint(game, scenarioId);

        if (!warmedUp && (scenarioId === 'T0' || getTitleRuntimeState(game).menuReady)) {
            collector.setActiveScenario(null);
            const warmupFrames = Math.ceil(config.warmupMs / config.clockStepMs);
            writeProgress(`warmup:${warmupFrames}`);
            for (let frame = 0; frame < warmupFrames; frame++) {
                await collector.nextFrame({ collect: false, phase: 'warmup' });
            }
            warmedUp = true;
        }
    }
    collector.setActiveScenario(null);
    writeProgress('query-drain');
    const queryDrainFrames = await collector.drainAllPendingQueries();
    const rendererSnapshots = collector.getRendererSnapshots();
    const retiredDiagnostics = collector.getRetiredDiagnostics();
    const collectorDiagnostics = collector.getDiagnostics();
    const invalid = collectInvalidDiagnostics(
        rendererSnapshots,
        retiredDiagnostics,
        collectorDiagnostics
    );
    const unexpectedRejectedBegin = Math.max(0, invalid.rejectedBegin - invalid.disabledBegin);
    const hasOperationalFailure = invalid.timerFault > 0
        || unexpectedRejectedBegin > 0
        || invalid.invalidScope > 0
        || invalid.overlappingBegin > 0
        || invalid.destroyedBegin > 0
        || invalid.faultedBegin > 0
        || invalid.faultDiscardedQuery > 0
        || invalid.disjoint > 0
        || invalid.capacityOverflow > 0
        || invalid.apiFailure > 0
        || invalid.discardedQuery > 0
        || invalid.droppedFrameSample > 0
        || invalid.contextLoss > 0
        || invalid.contextInvalidation > 0
        || invalid.contextDiscardedQuery > 0
        || invalid.failedBlurRefresh > 0
        || invalid.failedGlassDraw > 0
        || invalid.sourceProviderFailure > 0
        || invalid.captureTargetFailure > 0
        || invalid.sourceUploadFailure > 0
        || invalid.invalidGpuSampleIdentity > 0
        || invalid.invalidFrameSampleIdentity > 0
        || invalid.unresolvedPending > 0
        || invalid.retiredCapacityEviction > 0
        || invalid.retiredExpiration > 0
        || invalid.retiredPollFailure > 0
        || invalid.retiredDroppedGpuSample > 0
        || invalid.retiredDroppedFrameSample > 0
        || invalid.retiredSourceDroppedFrameSample > 0
        || invalid.retiredUnresolvedCollector > 0
        || invalid.retiredUnresolvedPending > 0
        || invalid.retiredBufferedGpuSample > 0
        || invalid.retiredBufferedFrameSample > 0;
    const participatingSnapshots = [
        ...rendererSnapshots,
        ...retiredDiagnostics.collectorSnapshots
    ];
    const gpuSupported = participatingSnapshots
        .some((snapshot) => snapshot.timer?.supported === true);
    const allGpuSupported = participatingSnapshots.length > 0
        && participatingSnapshots.every((snapshot) => snapshot.timer?.supported === true);
    const queryResolveRate = calculateQueryResolveRate(
        rendererSnapshots,
        retiredDiagnostics.collectorSnapshots
    );
    const coverage = buildGpuCoverageDiagnostics({
        scenarioRecords: scenarioRecords.values(),
        requestedSamples: config.requestedSamples,
        required: config.requireGpuTimestamps === true
    });
    const titleWebGpuShadowDiagnostics =
        getTitleRuntimeState(game).presentation?.getTitleWebGpuShadowDiagnostics?.() || null;
    const webGpuFrameComposerDiagnostics =
        game?.systemHandler?.displaySystem?.webGpuFrameComposer?.getDiagnostics?.() || null;
    const validation = {
        percentileDefinition: 'nearest-rank',
        queryDrainFrames,
        queryResolveRate,
        gpuSupported,
        allGpuSupported,
        coverage,
        collectorTelemetry: collectorDiagnostics,
        invalid,
        rendererSnapshots,
        retiredTelemetry: retiredDiagnostics,
        webGpuFrameComposerDiagnostics,
        titleWebGpuShadowDiagnostics,
        overlayStack: snapshotOverlayStack(game)
    };
    if (config.pipelineMode !== 'legacy-webgl') {
        const graphDiagnostics = titleWebGpuShadowDiagnostics?.graph;
        if (titleWebGpuShadowDiagnostics?.status !== 'shadow-ready'
            || !graphDiagnostics
            || (graphDiagnostics.encodeSuccessCount || 0) <= 0
            || (titleWebGpuShadowDiagnostics.failureCount || 0) > 0) {
            throw createHarnessValidationError(
                `요청한 ${String(config.pipelineMode)} shadow graph가 정상 인코딩되지 않았습니다.`,
                validation
            );
        }
    }
    if (config.requireGpuTimestamps === true
        && (!allGpuSupported || invalid.rejectedBegin > 0)) {
        throw createHarnessValidationError(
            'full profile의 모든 참여 renderer가 누락 없이 GPU timestamp를 지원해야 합니다.',
            validation
        );
    }
    if (config.requireGpuTimestamps === true && queryResolveRate !== 1) {
        throw createHarnessValidationError(
            `full profile GPU query resolve rate가 1이 아닙니다: ${queryResolveRate}`,
            validation
        );
    }
    if (hasOperationalFailure) {
        throw createHarnessValidationError(
            `GPU telemetry operational failure: ${JSON.stringify(invalid)}`,
            validation
        );
    }
    if (!coverage.gatePassed) {
        throw createHarnessValidationError(
            formatGpuCoverageFailure(coverage),
            validation
        );
    }

    const scenarios = [];
    for (const record of scenarioRecords.values()) {
        scenarios.push({
            id: record.id,
            timingWindow: {
                firstTrialGeneration: record.firstTrialGeneration,
                lastTrialGeneration: record.lastTrialGeneration,
                firstFrameId: record.firstFrameId,
                lastFrameId: record.lastFrameId
            },
            cpu: {
                frame: summarize(record.cpuFrameMs),
                rafInterval: summarize(record.rafIntervalMs),
                rawFrameMs: record.cpuFrameMs,
                rawRafIntervalMs: record.rafIntervalMs
            },
            gpu: buildGpuSummary(record.gpuSamples),
            counters: {
                sums: sumFrameCounters(record.frameSamples),
                rawFrames: record.frameSamples
            },
            state: record.state,
            artifact: record.artifact
        });
    }

    const result = {
        schemaVersion: RESULT_SCHEMA_VERSION,
        runId: config.runId,
        status: 'pass',
        profile: config.profile,
        coldStartIndex: config.coldStartIndex,
        build: { revision: process.env.CIRVIVOR_TITLE_GPU_BUILD_REVISION || 'working-tree' },
        runtime: collectRuntimeProfile(game),
        config,
        scenarios,
        validation
    };
    resetRetiredWebGLGpuTelemetry();
    resetWebGLGpuTelemetryFrameId();
    writeProgress('write-result');
    await writeResult(result);
    writeProgress('done');
    return result;
}

async function main() {
    let result;
    try {
        result = await runHarness();
    } catch (error) {
        setWebGLGpuTelemetryEnabled(false);
        resetRetiredWebGLGpuTelemetry();
        resetWebGLGpuTelemetryFrameId();
        result = {
            schemaVersion: RESULT_SCHEMA_VERSION,
            runId: config.runId,
            status: 'fail',
            profile: config.profile,
            validation: error?.validation,
            error: error?.stack || error?.message || String(error)
        };
        try {
            await writeResult(result);
        } catch (writeError) {
            console.error(writeError);
        }
    } finally {
        setTimeout(() => nw.App.quit(), 50);
    }
}

void main();
