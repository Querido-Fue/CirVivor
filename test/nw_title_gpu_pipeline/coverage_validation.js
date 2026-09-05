export const TITLE_GPU_TARGET_METRIC = 'title.overlay_blur_composite.gpu_ms';

const FRAME_ERROR_FIELDS = Object.freeze({
    failedBlurRefresh: 'failedBlurRefreshCount',
    failedGlassDraw: 'failedGlassDrawCount',
    sourceProviderFailure: 'sourceProviderFailureCount',
    captureTargetFailure: 'captureTargetFailureCount',
    sourceUploadFailure: 'sourceUploadFailureCount'
});

export function getTelemetryFrameIdentity(sample) {
    const valid = Number.isSafeInteger(sample?.trialGeneration)
        && sample.trialGeneration >= 0
        && Number.isSafeInteger(sample?.frameId)
        && sample.frameId >= 0;
    return valid ? `${sample.trialGeneration}:${sample.frameId}` : null;
}

function createFrameErrorCounts() {
    return Object.fromEntries(Object.keys(FRAME_ERROR_FIELDS).map((key) => [key, 0]));
}

function accumulateFrameErrors(errorCounts, sample) {
    for (const [diagnosticKey, sampleKey] of Object.entries(FRAME_ERROR_FIELDS)) {
        const value = sample?.[sampleKey];
        if (Number.isFinite(value) && value > 0) {
            errorCounts[diagnosticKey] += value;
        }
    }
}

export function buildGlobalFrameDiagnostics(frameSamples) {
    const diagnostics = {
        sampleCount: 0,
        collectedRouteSampleCount: 0,
        nonCollectedRouteSampleCount: 0,
        unroutedSampleCount: 0,
        invalidFrameIdentitySampleCount: 0,
        errorCounts: createFrameErrorCounts(),
        byPhase: {}
    };

    for (const sample of frameSamples) {
        diagnostics.sampleCount += 1;
        if (getTelemetryFrameIdentity(sample) === null) {
            diagnostics.invalidFrameIdentitySampleCount += 1;
        }
        if (sample.routeFound !== true) {
            diagnostics.unroutedSampleCount += 1;
        } else if (sample.routeCollect === true) {
            diagnostics.collectedRouteSampleCount += 1;
        } else {
            diagnostics.nonCollectedRouteSampleCount += 1;
        }
        accumulateFrameErrors(diagnostics.errorCounts, sample);

        const phase = typeof sample.routePhase === 'string' && sample.routePhase.length > 0
            ? sample.routePhase
            : 'unrouted';
        diagnostics.byPhase[phase] ??= {
            sampleCount: 0,
            errorCounts: createFrameErrorCounts()
        };
        diagnostics.byPhase[phase].sampleCount += 1;
        accumulateFrameErrors(diagnostics.byPhase[phase].errorCounts, sample);
    }
    return diagnostics;
}

function summarizeUniqueFrames(samples, predicate = () => true) {
    const frameIdentities = new Set();
    let totalSampleCount = 0;
    let validIdentitySampleCount = 0;
    let invalidFrameIdentitySampleCount = 0;
    let invalidGpuDurationSampleCount = 0;

    for (const sample of samples) {
        if (!predicate(sample)) {
            continue;
        }
        totalSampleCount += 1;
        if (!Number.isFinite(sample.gpuMs) || sample.gpuMs < 0) {
            invalidGpuDurationSampleCount += 1;
            continue;
        }
        const frameIdentity = getTelemetryFrameIdentity(sample);
        if (frameIdentity === null) {
            invalidFrameIdentitySampleCount += 1;
            continue;
        }
        validIdentitySampleCount += 1;
        frameIdentities.add(frameIdentity);
    }

    return {
        totalSampleCount,
        validIdentitySampleCount,
        uniqueFrameCount: frameIdentities.size,
        duplicateFrameSampleCount: validIdentitySampleCount - frameIdentities.size,
        invalidFrameIdentitySampleCount,
        invalidGpuDurationSampleCount
    };
}

function getRendererIdentity(sample) {
    if (typeof sample?.rendererId === 'string' && sample.rendererId.length > 0) {
        return sample.rendererId;
    }
    if (Number.isSafeInteger(sample?.rendererId)) {
        return String(sample.rendererId);
    }
    return null;
}

function addRendererFrame(rendererFrames, sample) {
    const frameIdentity = getTelemetryFrameIdentity(sample);
    if (frameIdentity === null) {
        return;
    }
    const rendererId = getRendererIdentity(sample);
    if (!rendererFrames.has(rendererId)) {
        rendererFrames.set(rendererId, new Set());
    }
    rendererFrames.get(rendererId).add(frameIdentity);
}

function buildRendererCoverage(frameSamples, targetSamples) {
    const expectedFrames = new Map();
    const observedFrames = new Map();
    for (const sample of frameSamples) {
        if (Number.isFinite(sample.blurRefreshCount) && sample.blurRefreshCount > 0) {
            addRendererFrame(expectedFrames, sample);
        }
    }
    for (const sample of targetSamples) {
        if (Number.isFinite(sample.gpuMs) && sample.gpuMs >= 0) {
            addRendererFrame(observedFrames, sample);
        }
    }

    const rendererIds = new Set([...expectedFrames.keys(), ...observedFrames.keys()]);
    return [...rendererIds]
        .map((rendererId) => {
            const expected = expectedFrames.get(rendererId) || new Set();
            const observed = observedFrames.get(rendererId) || new Set();
            const missing = [...expected].filter((frameIdentity) => !observed.has(frameIdentity));
            return {
                rendererId,
                expectedFrameCount: expected.size,
                observedTargetFrameCount: observed.size,
                matchedExpectedFrameCount: expected.size - missing.length,
                missingFrameCount: missing.length,
                missingFrameIdentityExamples: missing.slice(0, 32),
                satisfied: missing.length === 0
            };
        })
        .sort((left, right) => String(left.rendererId).localeCompare(String(right.rendererId)));
}

/**
 * GPU target metric의 실제 unique-frame 표본 수를 검증합니다.
 * @param {object} options - coverage 입력입니다.
 * @param {Iterable<object>} options.scenarioRecords - scenario별 raw GPU sample record입니다.
 * @param {number} options.requestedSamples - scenario/transition별 요구 표본 수입니다.
 * @param {boolean} options.required - 부족 시 run을 실패시킬지 여부입니다.
 * @param {string} [options.targetMetric] - 검증할 GPU telemetry scope입니다.
 * @returns {object} JSON 결과에 남길 coverage 진단입니다.
 */
export function buildGpuCoverageDiagnostics({
    scenarioRecords,
    requestedSamples,
    required,
    targetMetric = TITLE_GPU_TARGET_METRIC
}) {
    if (!Number.isSafeInteger(requestedSamples) || requestedSamples < 1) {
        throw new TypeError(`requestedSamples가 양의 정수가 아닙니다: ${requestedSamples}`);
    }

    const scenarios = [];
    for (const record of scenarioRecords) {
        const targetSamples = (record.gpuSamples || [])
            .filter((sample) => sample.scope === targetMetric);
        const frameCoverage = summarizeUniqueFrames(targetSamples);
        const rendererCoverage = buildRendererCoverage(record.frameSamples || [], targetSamples);
        const transition = record.id === 'T4'
            ? {
                close: summarizeUniqueFrames(
                    targetSamples,
                    (sample) => sample.metadata?.transition === 'close'
                ),
                open: summarizeUniqueFrames(
                    targetSamples,
                    (sample) => sample.metadata?.transition === 'open'
                )
            }
            : null;
        if (transition) {
            transition.close.requestedSamples = requestedSamples;
            transition.close.missingUniqueFrames = Math.max(
                0,
                requestedSamples - transition.close.uniqueFrameCount
            );
            transition.close.satisfied = transition.close.uniqueFrameCount >= requestedSamples;
            transition.open.requestedSamples = requestedSamples;
            transition.open.missingUniqueFrames = Math.max(
                0,
                requestedSamples - transition.open.uniqueFrameCount
            );
            transition.open.satisfied = transition.open.uniqueFrameCount >= requestedSamples;
            transition.closeSampleFrames = transition.close.uniqueFrameCount;
            transition.openSampleFrames = transition.open.uniqueFrameCount;
        }

        const frameCoverageSatisfied = frameCoverage.uniqueFrameCount >= requestedSamples;
        const transitionCoverageSatisfied = !transition
            || (transition.close.satisfied && transition.open.satisfied);
        const rendererCoverageSatisfied = rendererCoverage.every((entry) => entry.satisfied);
        scenarios.push({
            id: record.id,
            targetMetric,
            requestedSamples,
            ...frameCoverage,
            missingUniqueFrames: Math.max(
                0,
                requestedSamples - frameCoverage.uniqueFrameCount
            ),
            frameCoverageSatisfied,
            transitionCoverageSatisfied,
            rendererCoverageSatisfied,
            satisfied: frameCoverageSatisfied
                && transitionCoverageSatisfied
                && rendererCoverageSatisfied,
            rendererCoverage,
            transition
        });
    }

    const satisfied = scenarios.every((scenario) => scenario.satisfied);
    return {
        targetMetric,
        requestedSamples,
        required: required === true,
        scenarioCount: scenarios.length,
        satisfied,
        gatePassed: required !== true || satisfied,
        scenarios
    };
}

export function formatGpuCoverageFailure(coverage) {
    const deficits = coverage.scenarios
        .filter((scenario) => !scenario.satisfied)
        .map((scenario) => {
            const transitionDeficit = scenario.transition
                ? `, close=${scenario.transition.closeSampleFrames}/${scenario.requestedSamples}`
                    + `, open=${scenario.transition.openSampleFrames}/${scenario.requestedSamples}`
                : '';
            const rendererDeficit = scenario.rendererCoverage
                .filter((entry) => !entry.satisfied)
                .map((entry) => `${entry.rendererId ?? '<missing>'}`
                    + `=${entry.matchedExpectedFrameCount}/${entry.expectedFrameCount}`)
                .join(',');
            return `${scenario.id}=${scenario.uniqueFrameCount}/${scenario.requestedSamples}`
                + transitionDeficit
                + (rendererDeficit ? `, rendererExpected=[${rendererDeficit}]` : '');
        });
    return `GPU target metric unique-frame coverage가 부족합니다: ${deficits.join('; ')}`;
}
