import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import test from 'node:test';

import {
    buildGlobalFrameDiagnostics,
    buildGpuCoverageDiagnostics,
    formatGpuCoverageFailure,
    getTelemetryFrameIdentity,
    TITLE_GPU_TARGET_METRIC
} from './nw_title_gpu_pipeline/coverage_validation.js';

function gpuSample({
    trialGeneration = 1,
    frameId,
    scope = TITLE_GPU_TARGET_METRIC,
    gpuMs = 0.25,
    transition
}) {
    return {
        trialGeneration,
        frameId,
        scope,
        gpuMs,
        metadata: transition ? { transition } : {}
    };
}

function frameSample({
    rendererId = 'overlay',
    trialGeneration = 1,
    frameId,
    blurRefreshCount = 1,
    ...counters
}) {
    return {
        rendererId,
        trialGeneration,
        frameId,
        blurRefreshCount,
        ...counters
    };
}

test('GPU coverage는 target metric의 generation/frame identity만 unique 표본으로 센다', () => {
    const diagnostics = buildGpuCoverageDiagnostics({
        scenarioRecords: [{
            id: 'T5',
            gpuSamples: [
                gpuSample({ frameId: 10 }),
                gpuSample({ frameId: 10 }),
                gpuSample({ trialGeneration: 2, frameId: 10 }),
                gpuSample({ frameId: 11, scope: 'title.unrelated.gpu_ms' }),
                gpuSample({ frameId: 12, gpuMs: Number.NaN }),
                gpuSample({ frameId: undefined })
            ]
        }],
        requestedSamples: 2,
        required: true
    });

    const scenario = diagnostics.scenarios[0];
    assert.equal(scenario.totalSampleCount, 5);
    assert.equal(scenario.validIdentitySampleCount, 3);
    assert.equal(scenario.uniqueFrameCount, 2);
    assert.equal(scenario.duplicateFrameSampleCount, 1);
    assert.equal(scenario.invalidGpuDurationSampleCount, 1);
    assert.equal(scenario.invalidFrameIdentitySampleCount, 1);
    assert.equal(scenario.satisfied, true);
    assert.equal(diagnostics.gatePassed, true);
});

test('T4 coverage는 metadata.transition close/open을 각각 requestedSamples까지 요구한다', () => {
    const diagnostics = buildGpuCoverageDiagnostics({
        scenarioRecords: [{
            id: 'T4',
            gpuSamples: [
                gpuSample({ frameId: 1, transition: 'close' }),
                gpuSample({ frameId: 1, transition: 'close' }),
                gpuSample({ frameId: 2, transition: 'close' }),
                gpuSample({ frameId: 3, transition: 'open' }),
                gpuSample({ frameId: 4, transition: 'open' })
            ]
        }],
        requestedSamples: 2,
        required: true
    });

    const scenario = diagnostics.scenarios[0];
    assert.equal(scenario.transition.closeSampleFrames, 2);
    assert.equal(scenario.transition.openSampleFrames, 2);
    assert.equal(scenario.transition.close.duplicateFrameSampleCount, 1);
    assert.equal(scenario.transitionCoverageSatisfied, true);
    assert.equal(diagnostics.gatePassed, true);
});

test('T4 전체 표본이 충분해도 close/open 한쪽이 부족하면 full gate를 실패시킨다', () => {
    const diagnostics = buildGpuCoverageDiagnostics({
        scenarioRecords: [{
            id: 'T4',
            gpuSamples: [
                gpuSample({ frameId: 1, transition: 'close' }),
                gpuSample({ frameId: 2, transition: 'open' }),
                gpuSample({ frameId: 3, transition: 'open' })
            ]
        }],
        requestedSamples: 2,
        required: true
    });

    const scenario = diagnostics.scenarios[0];
    assert.equal(scenario.frameCoverageSatisfied, true);
    assert.equal(scenario.transition.close.satisfied, false);
    assert.equal(scenario.transition.open.satisfied, true);
    assert.equal(scenario.satisfied, false);
    assert.equal(diagnostics.gatePassed, false);
    assert.match(formatGpuCoverageFailure(diagnostics), /T4=3\/2, close=1\/2, open=2\/2/);
});

test('비필수 profile도 coverage 부족 진단을 남기되 gate는 통과한다', () => {
    const diagnostics = buildGpuCoverageDiagnostics({
        scenarioRecords: [{ id: 'T5', gpuSamples: [] }],
        requestedSamples: 4,
        required: false
    });

    assert.equal(diagnostics.satisfied, false);
    assert.equal(diagnostics.gatePassed, true);
    assert.equal(diagnostics.scenarios[0].missingUniqueFrames, 4);
});

test('strict coverage는 renderer별 blur refresh frame과 같은 renderer GPU frame을 대조한다', () => {
    const diagnostics = buildGpuCoverageDiagnostics({
        scenarioRecords: [{
            id: 'T5',
            frameSamples: [
                frameSample({ rendererId: 'overlay-a', frameId: 1 }),
                frameSample({ rendererId: 'overlay-a', frameId: 2 })
            ],
            gpuSamples: [
                gpuSample({ frameId: 1 }),
                { ...gpuSample({ frameId: 2 }), rendererId: 'overlay-b' }
            ].map((sample, index) => ({
                rendererId: sample.rendererId || (index === 0 ? 'overlay-a' : 'overlay-b'),
                ...sample
            }))
        }],
        requestedSamples: 2,
        required: true
    });

    const scenario = diagnostics.scenarios[0];
    const overlayA = scenario.rendererCoverage
        .find((entry) => entry.rendererId === 'overlay-a');
    assert.equal(scenario.frameCoverageSatisfied, true);
    assert.equal(overlayA.expectedFrameCount, 2);
    assert.equal(overlayA.matchedExpectedFrameCount, 1);
    assert.equal(overlayA.missingFrameCount, 1);
    assert.deepEqual(overlayA.missingFrameIdentityExamples, ['1:2']);
    assert.equal(scenario.rendererCoverageSatisfied, false);
    assert.equal(diagnostics.gatePassed, false);
    assert.match(formatGpuCoverageFailure(diagnostics), /rendererExpected=\[overlay-a=1\/2\]/);
});

test('collect=false frame 오류도 phase별 global diagnostics에 누적한다', () => {
    const diagnostics = buildGlobalFrameDiagnostics([
        {
            ...frameSample({ frameId: 1, sourceProviderFailureCount: 1 }),
            routeFound: true,
            routeCollect: false,
            routePhase: 'warmup'
        },
        {
            ...frameSample({ frameId: 2, captureTargetFailureCount: 2 }),
            routeFound: true,
            routeCollect: false,
            routePhase: 'setup'
        },
        {
            ...frameSample({
                trialGeneration: null,
                frameId: 3,
                sourceUploadFailureCount: 3,
                failedBlurRefreshCount: 4,
                failedGlassDrawCount: 5
            }),
            routeFound: false,
            routeCollect: false,
            routePhase: null
        }
    ]);

    assert.equal(diagnostics.sampleCount, 3);
    assert.equal(diagnostics.nonCollectedRouteSampleCount, 2);
    assert.equal(diagnostics.unroutedSampleCount, 1);
    assert.equal(diagnostics.invalidFrameIdentitySampleCount, 1);
    assert.deepEqual(diagnostics.errorCounts, {
        failedBlurRefresh: 4,
        failedGlassDraw: 5,
        sourceProviderFailure: 1,
        captureTargetFailure: 2,
        sourceUploadFailure: 3
    });
    assert.equal(diagnostics.byPhase.warmup.errorCounts.sourceProviderFailure, 1);
    assert.equal(diagnostics.byPhase.setup.errorCounts.captureTargetFailure, 2);
    assert.equal(diagnostics.byPhase.unrouted.errorCounts.failedGlassDraw, 5);
});

test('누락된 trialGeneration/frameId는 유효 identity로 보정하지 않는다', () => {
    assert.equal(getTelemetryFrameIdentity({ trialGeneration: 3, frameId: 4 }), '3:4');
    assert.equal(getTelemetryFrameIdentity({ frameId: 4 }), null);
    assert.equal(getTelemetryFrameIdentity({ trialGeneration: 3 }), null);
    assert.equal(getTelemetryFrameIdentity({ trialGeneration: -1, frameId: 4 }), null);
});

test('runner는 coverage gate와 실패 진단을 연결하고 launcher는 helper를 stage한다', async () => {
    const [runnerSource, launcherSource] = await Promise.all([
        fs.readFile(new URL('./nw_title_gpu_pipeline/runner.js', import.meta.url), 'utf8'),
        fs.readFile(new URL('./support/run_nw_title_gpu_pipeline.mjs', import.meta.url), 'utf8')
    ]);

    assert.match(runnerSource, /buildGpuCoverageDiagnostics\(\{/);
    assert.match(runnerSource, /if \(!coverage\.gatePassed\)/);
    assert.match(runnerSource, /validation: error\?\.validation/);
    assert.match(runnerSource, /invalidGpuSampleIdentityCount \+= 1/);
    assert.doesNotMatch(
        runnerSource,
        /sample\?\.trialGeneration[\s\S]{0,100}getWebGLGpuTelemetryTrialGeneration/
    );
    assert.match(launcherSource, /'coverage_validation\.js'/);
});
