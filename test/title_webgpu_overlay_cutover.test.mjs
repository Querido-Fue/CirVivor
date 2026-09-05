import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL(
    '../project/game/script/module/scene/title/webgpu/_title_webgpu_overlay_cutover.js',
    import.meta.url
);

function createSurface(id, options = {}) {
    return {
        id,
        dynamic: options.dynamic === true,
        group: options.group,
        canvas: {
            style: {
                visibility: options.visibility ?? '',
                display: options.display ?? '',
                opacity: options.opacity ?? '',
                transform: options.transform ?? '',
                transformOrigin: options.transformOrigin ?? '',
                filter: options.filter ?? ''
            }
        }
    };
}

function createHarness() {
    const surfaces = [
        createSurface('background'),
        createSurface('gpu-object', { visibility: 'hidden' }),
        createSurface('object'),
        createSurface('effect'),
        createSurface('texteffect'),
        createSurface('ui'),
        createSurface('vignette'),
        createSurface('top', {
            opacity: '0.75',
            transform: 'translateX(1px)',
            filter: 'brightness(1.1)'
        }),
        createSurface('dynamic:webgl:1', {
            dynamic: true,
            opacity: '0.4',
            transform: 'scale(0.9)',
            transformOrigin: '50% 50%',
            filter: 'blur(8px)'
        }),
        createSurface('dynamic:2d:2', {
            group: 'dynamic',
            opacity: '0.4',
            transform: 'scale(0.9)',
            transformOrigin: '50% 50%',
            filter: 'blur(8px)'
        })
    ];
    const ownerToken = Object.freeze({ owner: 'presentation' });
    return { surfaces, ownerToken };
}

function qualifyingReceipt(overrides = {}) {
    return {
        frameId: 17,
        deviceGeneration: 3,
        committed: true,
        baseCheckpointConsumed: true,
        vignetteIncluded: true,
        fullScenePresented: true,
        finalCanvasPassCount: 1,
        ...overrides
    };
}

test('첫 qualifying commit 뒤 legacy/dynamic만 숨기고 WebGPU와 top을 보존한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const topBefore = { ...harness.surfaces.find((surface) => surface.id === 'top').canvas.style };
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    assert.deepEqual(cutover.beginFrame(harness.ownerToken), {
        legacyDrawRequired: true,
        fullCutoverActive: false,
        fallbackRecovered: false
    });
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'gpu-object')
            .canvas.style.visibility,
        'hidden'
    );
    const status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(status.fullCutoverActive, true);
    assert.equal(status.legacyVisibleSurfaceCount, 0);
    assert.equal(status.webGpuSurfaceVisible, true);
    assert.equal(status.topControlSurfacePreserved, true);
    assert.equal(status.cssPresentationNeutralized, true);

    for (const surface of harness.surfaces) {
        if (surface.id === 'gpu-object') {
            assert.equal(surface.canvas.style.visibility, 'visible');
        } else if (surface.id === 'top') {
            assert.deepEqual(surface.canvas.style, topBefore);
        } else {
            assert.equal(surface.canvas.style.visibility, 'hidden');
        }
    }
    for (const id of ['dynamic:webgl:1', 'dynamic:2d:2']) {
        const style = harness.surfaces.find((surface) => surface.id === id).canvas.style;
        assert.equal(style.opacity, '0.4');
        assert.equal(style.transform, 'scale(0.9)');
        assert.equal(style.transformOrigin, '50% 50%');
        assert.equal(style.filter, 'blur(8px)');
    }
});

test('ARMED begin은 처음 visible인 WebGPU candidate도 submit 전에 숨긴다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const gpuSurface = harness.surfaces.find((surface) => surface.id === 'gpu-object');
    gpuSurface.canvas.style.visibility = '';
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    assert.equal(cutover.beginFrame(harness.ownerToken).legacyDrawRequired, true);
    assert.equal(gpuSurface.canvas.style.visibility, 'hidden');
    assert.equal(
        cutover.commitFrame(qualifyingReceipt(), harness.ownerToken).fullCutoverActive,
        true
    );
    assert.equal(gpuSurface.canvas.style.visibility, 'visible');
    assert.equal(cutover.abortFrame('visible-candidate-abort', harness.ownerToken), true);
    assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);
    assert.equal(cutover.completeFallbackRedraw(
        'visible-candidate-redrawn',
        harness.ownerToken
    ), true);
    assert.equal(gpuSurface.canvas.style.visibility, 'hidden');
    assert.equal(cutover.destroy(harness.ownerToken), true);
    assert.equal(gpuSurface.canvas.style.visibility, '');
});

test('ARMED candidate가 legacy와 canvas identity를 공유하면 어떤 surface도 숨기지 않는다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const background = harness.surfaces.find((surface) => surface.id === 'background');
    const gpu = harness.surfaces.find((surface) => surface.id === 'gpu-object');
    gpu.canvas = background.canvas;
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    const begin = cutover.beginFrame(harness.ownerToken);
    assert.equal(begin.legacyDrawRequired, true);
    assert.equal(begin.fullCutoverActive, false);
    assert.equal(background.canvas.style.visibility, '');
    assert.match(cutover.getStatus().fallbackReason, /canvas identity/u);
});

test('미완료/잘못된 receipt는 cutover를 활성화하지 않는다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    for (const overrides of [
        { committed: false },
        { baseCheckpointConsumed: false },
        { vignetteIncluded: false },
        { fullScenePresented: false },
        { finalCanvasPassCount: 0 },
        { finalCanvasPassCount: 2 },
        { frameId: -1 },
        { deviceGeneration: Number.NaN }
    ]) {
        const harness = createHarness();
        const cutover = new TitleWebGpuOverlayCutover({
            surfaceProvider: () => harness.surfaces,
            ownerToken: harness.ownerToken
        });
        const status = cutover.commitFrame(
            qualifyingReceipt(overrides),
            harness.ownerToken
        );
        assert.equal(status.fullCutoverActive, false);
        assert.equal(status.counters.rejectedCommitCount, 1);
        assert.equal(harness.surfaces[0].canvas.style.visibility, '');
    }
});

test('ACTIVE는 순서를 판정할 수 없는 invalid receipt에서 fail-closed fallback한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const invalidReceipts = [
        ['null receipt', null],
        ['identity가 없는 receipt', {}],
        ['frameId 누락', qualifyingReceipt({ frameId: undefined })],
        ['deviceGeneration 누락', qualifyingReceipt({ deviceGeneration: undefined })],
        ['frameId NaN', qualifyingReceipt({ frameId: Number.NaN })],
        ['deviceGeneration NaN', qualifyingReceipt({ deviceGeneration: Number.NaN })]
    ];

    for (const [label, invalidReceipt] of invalidReceipts) {
        const harness = createHarness();
        const cutover = new TitleWebGpuOverlayCutover({
            surfaceProvider: () => harness.surfaces,
            ownerToken: harness.ownerToken
        });
        cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);

        const status = cutover.commitFrame(invalidReceipt, harness.ownerToken);
        assert.equal(status.fallbackPending, true, label);
        assert.match(status.fallbackReason, /invalid-unorderable-receipt/, label);
        assert.equal(status.lastCommittedDeviceGeneration, 3, label);
        assert.equal(status.lastCommittedFrameId, 17, label);
        assert.equal(status.counters.rejectedCommitCount, 1, label);
        assert.equal(status.counters.fallbackCount, 1, label);
        assert.equal(
            harness.surfaces.find((surface) => surface.id === 'background')
                .canvas.style.visibility,
            'hidden',
            `${label}: commit callback에서는 즉시 복구하지 않음`
        );
        const redraw = cutover.beginFrame(harness.ownerToken);
        assert.equal(redraw.fallbackRecovered, false, label);
        assert.equal(redraw.fallbackRedrawPending, true, label);
        assert.equal(
            harness.surfaces.find((surface) => surface.id === 'background')
                .canvas.style.visibility,
            'hidden',
            `${label}: fallback redraw 동안 마지막 GPU 화면을 유지`
        );
        assert.equal(cutover.completeFallbackRedraw('fallback-redraw', harness.ownerToken), true);
        assert.equal(harness.surfaces[0].canvas.style.visibility, '');
    }
});

test('active abort는 다음 beginFrame 직전에만 legacy style을 원복한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const dynamic = harness.surfaces.find((surface) => surface.id === 'dynamic:webgl:1');
    const originalDynamicStyle = { ...dynamic.canvas.style };
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);

    assert.equal(cutover.abortFrame('device-lost', harness.ownerToken), true);
    assert.equal(cutover.getStatus().fallbackPending, true);
    assert.equal(dynamic.canvas.style.visibility, 'hidden', 'abort callback에서는 즉시 복구하지 않음');

    assert.deepEqual(cutover.beginFrame(harness.ownerToken), {
        legacyDrawRequired: true,
        fullCutoverActive: false,
        fallbackRecovered: false,
        fallbackRedrawPending: true
    });
    assert.equal(dynamic.canvas.style.visibility, 'hidden');
    assert.equal(cutover.completeFallbackRedraw('fallback-redraw', harness.ownerToken), true);
    assert.deepEqual(dynamic.canvas.style, originalDynamicStyle);
    assert.equal(harness.surfaces[0].canvas.style.visibility, '');
    assert.equal(cutover.getStatus().lastRestoreReason, 'fallback-redraw');
});

test('active 중 늦게 생성된 dynamic/tooltip surface도 synchronize에서 숨긴다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    const lateSurface = createSurface('dynamic:2d:tooltip', {
        dynamic: true,
        opacity: '0.6',
        transform: 'translateY(2px)',
        filter: 'blur(2px)'
    });
    harness.surfaces.push(lateSurface);

    assert.equal(cutover.synchronize(harness.ownerToken), true);
    assert.equal(lateSurface.canvas.style.visibility, 'hidden');
    assert.equal(lateSurface.canvas.style.opacity, '0.6');
    assert.equal(lateSurface.canvas.style.transform, 'translateY(2px)');
    assert.equal(lateSurface.canvas.style.filter, 'blur(2px)');
    assert.equal(cutover.getStatus().fullCutoverActive, true);
});

test('stale owner는 commit/abort/restore/destroy를 바꾸지 못한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const stale = Object.freeze({ owner: 'stale' });
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    assert.equal(cutover.commitFrame(qualifyingReceipt(), stale).fullCutoverActive, false);
    assert.equal(cutover.abortFrame('stale', stale), false);
    assert.equal(cutover.restoreNow('stale', stale), false);
    assert.equal(cutover.destroy(stale), false);
    assert.equal(cutover.getStatus().destroyed, false);
    assert.equal(cutover.getStatus().counters.staleOwnerRejectCount, 4);
});

test('device/scene 경계 restoreNow와 destroy는 original style을 idempotent하게 복구한다', async () => {
    const {
        TitleWebGpuOverlayCutover,
        TITLE_WEBGPU_OVERLAY_CUTOVER_STATE
    } = await import(MODULE_URL.href);
    const harness = createHarness();
    const originals = new Map(harness.surfaces.map(
        (surface) => [surface.id, { ...surface.canvas.style }]
    ));
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(cutover.restoreNow('resize-generation-drift', harness.ownerToken), true);
    for (const surface of harness.surfaces) {
        assert.deepEqual(surface.canvas.style, originals.get(surface.id));
    }

    cutover.commitFrame(qualifyingReceipt({ frameId: 18 }), harness.ownerToken);
    assert.equal(cutover.destroy(harness.ownerToken), true);
    assert.equal(cutover.destroy(harness.ownerToken), false);
    assert.equal(cutover.getStatus().state, TITLE_WEBGPU_OVERLAY_CUTOVER_STATE.DESTROYED);
    for (const surface of harness.surfaces) {
        assert.deepEqual(surface.canvas.style, originals.get(surface.id));
    }
});

test('surface provider 실패는 activation을 fallback-pending으로 격리한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const ownerToken = Object.freeze({ owner: 'provider-failure' });
    let shouldThrow = true;
    const cutover = new TitleWebGpuOverlayCutover({
        ownerToken,
        surfaceProvider() {
            if (shouldThrow) throw new Error('forced-provider-failure');
            return [];
        }
    });
    const status = cutover.commitFrame(qualifyingReceipt(), ownerToken);
    assert.equal(status.fallbackPending, true);
    assert.match(status.fallbackReason, /forced-provider-failure/);
    shouldThrow = false;
    assert.equal(cutover.beginFrame(ownerToken).fallbackRedrawPending, true);
    assert.equal(cutover.completeFallbackRedraw('provider-recovered', ownerToken), true);
});

test('dynamic presentation CSS의 live 변경은 cutover와 fallback을 통과해도 유지된다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const dynamic = harness.surfaces.find((surface) => surface.id === 'dynamic:webgl:1');
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);

    Object.assign(dynamic.canvas.style, {
        opacity: '0.83',
        transform: 'translate3d(4px, 5px, 0) scale(1.1)',
        transformOrigin: '12px 18px',
        filter: 'blur(3px) brightness(1.2)'
    });
    assert.equal(cutover.synchronize(harness.ownerToken), true);
    assert.deepEqual(dynamic.canvas.style, {
        visibility: 'hidden',
        display: '',
        opacity: '0.83',
        transform: 'translate3d(4px, 5px, 0) scale(1.1)',
        transformOrigin: '12px 18px',
        filter: 'blur(3px) brightness(1.2)'
    });

    cutover.abortFrame('live-css-fallback', harness.ownerToken);
    assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);
    assert.equal(dynamic.canvas.style.visibility, 'hidden');
    assert.equal(cutover.completeFallbackRedraw('live-css-redrawn', harness.ownerToken), true);
    assert.deepEqual(dynamic.canvas.style, {
        visibility: '',
        display: '',
        opacity: '0.83',
        transform: 'translate3d(4px, 5px, 0) scale(1.1)',
        transformOrigin: '12px 18px',
        filter: 'blur(3px) brightness(1.2)'
    });
});

test('필수 legacy/WebGPU/top descriptor가 하나라도 없으면 ACTIVE가 되지 않는다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const requiredIds = [
        'background',
        'object',
        'effect',
        'texteffect',
        'ui',
        'vignette',
        'gpu-object',
        'top'
    ];

    for (const missingId of requiredIds) {
        const harness = createHarness();
        const missingIndex = harness.surfaces.findIndex((surface) => surface.id === missingId);
        harness.surfaces.splice(missingIndex, 1);
        const cutover = new TitleWebGpuOverlayCutover({
            surfaceProvider: () => harness.surfaces,
            ownerToken: harness.ownerToken
        });

        const status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
        assert.equal(status.fullCutoverActive, false, `${missingId} 누락`);
        assert.equal(status.fallbackPending, true, `${missingId} 누락`);
        assert.equal(status.surfaceTopologyQualified, false, `${missingId} 누락`);
        assert.equal(status.counters.activationCount, 0, `${missingId} 누락`);
        for (const surface of harness.surfaces) {
            if (surface.id === 'gpu-object') {
                assert.equal(surface.canvas.style.visibility, 'hidden', `${missingId} 누락`);
            } else {
                assert.notEqual(surface.canvas.style.visibility, 'hidden', `${missingId} 누락`);
            }
        }
        assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);
        assert.equal(cutover.completeFallbackRedraw('missing-topology-redrawn', harness.ownerToken), true);
    }
});

test('WebGPU surface 사후조건이 실패하면 activation과 active beginFrame 모두 legacy로 복구한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);

    const activationHarness = createHarness();
    activationHarness.surfaces.find(
        (surface) => surface.id === 'gpu-object'
    ).canvas.style.display = 'none';
    const activationCutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => activationHarness.surfaces,
        ownerToken: activationHarness.ownerToken
    });
    const failedActivation = activationCutover.commitFrame(
        qualifyingReceipt(),
        activationHarness.ownerToken
    );
    assert.equal(failedActivation.surfaceTopologyQualified, true);
    assert.equal(failedActivation.fullCutoverActive, false);
    assert.equal(failedActivation.fallbackPending, true);
    assert.equal(failedActivation.counters.activationCount, 0);
    assert.equal(activationCutover.beginFrame(
        activationHarness.ownerToken
    ).fallbackRedrawPending, true);
    assert.equal(activationCutover.completeFallbackRedraw(
        'activation-fallback-redrawn',
        activationHarness.ownerToken
    ), true);
    assert.equal(
        activationHarness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        ''
    );

    const activeHarness = createHarness();
    const activeCutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => activeHarness.surfaces,
        ownerToken: activeHarness.ownerToken
    });
    activeCutover.commitFrame(qualifyingReceipt(), activeHarness.ownerToken);
    activeHarness.surfaces.find(
        (surface) => surface.id === 'gpu-object'
    ).canvas.style.opacity = '0';
    assert.deepEqual(activeCutover.beginFrame(activeHarness.ownerToken), {
        legacyDrawRequired: true,
        fullCutoverActive: false,
        fallbackRecovered: false,
        fallbackRedrawPending: true
    });
    assert.equal(activeCutover.completeFallbackRedraw(
        'active-postcondition-redrawn',
        activeHarness.ownerToken
    ), true);
    assert.equal(activeCutover.getStatus().state, 'armed');
    assert.equal(
        activeHarness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        ''
    );
});

test('receipt는 generation/frame 단조성을 지키고 invalid newer에서 fallback-pending으로 전이한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    let status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(status.counters.activationCount, 1);
    const synchronizedAtActivation = status.counters.synchronizeCount;

    status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(status.fullCutoverActive, true, 'exact duplicate는 idempotent');
    assert.equal(status.counters.activationCount, 1);
    assert.equal(status.counters.synchronizeCount, synchronizedAtActivation);
    assert.equal(status.counters.rejectedCommitCount, 0);

    status = cutover.commitFrame(qualifyingReceipt({ frameId: 16 }), harness.ownerToken);
    assert.equal(status.fullCutoverActive, true, 'stale receipt는 현재 ACTIVE를 해제하지 않음');
    assert.equal(status.fallbackPending, false, '유효한 stale receipt는 fallback이 아님');
    assert.equal(status.counters.fallbackCount, 0, '유효한 stale receipt 정책 유지');
    assert.equal(status.counters.rejectedCommitCount, 1);
    assert.equal(status.lastCommittedFrameId, 17);

    status = cutover.commitFrame(
        qualifyingReceipt({ frameId: 18, vignetteIncluded: false }),
        harness.ownerToken
    );
    assert.equal(status.fallbackPending, true);
    assert.equal(status.counters.fallbackCount, 1);
    assert.equal(status.counters.rejectedCommitCount, 2);

    status = cutover.commitFrame(qualifyingReceipt({ frameId: 19 }), harness.ownerToken);
    assert.equal(status.fallbackPending, true, 'fallback-pending에서는 commit 금지');
    assert.equal(status.lastCommittedFrameId, 17);
    assert.equal(status.counters.rejectedCommitCount, 3);

    assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);
    assert.equal(cutover.completeFallbackRedraw('receipt-fallback-redrawn', harness.ownerToken), true);
    status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(status.state, 'armed', '복구 뒤 exact duplicate도 재활성화하지 않음');
    assert.equal(status.counters.activationCount, 1);

    status = cutover.commitFrame(qualifyingReceipt({ frameId: 18 }), harness.ownerToken);
    assert.equal(status.fullCutoverActive, true);
    assert.equal(status.counters.activationCount, 2, 'ARMED→ACTIVE에서만 증가');

    status = cutover.commitFrame(
        qualifyingReceipt({ frameId: 999, deviceGeneration: 2 }),
        harness.ownerToken
    );
    assert.equal(status.lastCommittedDeviceGeneration, 3);
    assert.equal(status.lastCommittedFrameId, 18);
    assert.equal(status.fullCutoverActive, true);

    status = cutover.commitFrame(
        qualifyingReceipt({ frameId: 0, deviceGeneration: 4 }),
        harness.ownerToken
    );
    assert.equal(status.lastCommittedDeviceGeneration, 4);
    assert.equal(status.lastCommittedFrameId, 0);
    assert.equal(status.counters.activationCount, 2, 'ACTIVE의 newer commit은 재활성화가 아님');

    status = cutover.commitFrame(
        qualifyingReceipt({ frameId: -1, deviceGeneration: 5 }),
        harness.ownerToken
    );
    assert.equal(status.fallbackPending, true, 'newer generation의 malformed receipt도 fallback');
});

test('newer cutover owner가 lease를 인계받으면 stale instance destroy가 style을 복구하지 못한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const originals = new Map(harness.surfaces.map(
        (surface) => [surface.id, { ...surface.canvas.style }]
    ));
    const firstOwner = Object.freeze({ owner: 'first-cutover' });
    const secondOwner = Object.freeze({ owner: 'second-cutover' });
    const first = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: firstOwner
    });
    first.commitFrame(qualifyingReceipt(), firstOwner);

    const second = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: secondOwner
    });
    assert.equal(second.commitFrame(qualifyingReceipt(), secondOwner).fullCutoverActive, true);
    assert.equal(first.getStatus().fullCutoverActive, false, 'lease는 newer epoch에 속함');

    assert.equal(first.destroy(firstOwner), true);
    assert.equal(second.getStatus().fullCutoverActive, true);
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        'hidden'
    );
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'gpu-object')
            .canvas.style.visibility,
        'visible'
    );

    assert.equal(second.restoreNow('new-owner-handoff', secondOwner), true);
    for (const surface of harness.surfaces) {
        assert.deepEqual(surface.canvas.style, originals.get(surface.id));
    }
});

test('pool 재사용 canvas와 같은 ID의 교체 canvas는 stale snapshot 복구 대상이 아니다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);

    const dynamicIndex = harness.surfaces.findIndex(
        (surface) => surface.id === 'dynamic:webgl:1'
    );
    const reusedCanvas = harness.surfaces[dynamicIndex].canvas;
    Object.assign(reusedCanvas.style, {
        visibility: '',
        opacity: '0.91',
        transform: 'translateX(9px)',
        transformOrigin: '9px 0px',
        filter: 'contrast(1.4)'
    });
    harness.surfaces.splice(dynamicIndex, 1, {
        id: 'dynamic:webgl:reused',
        dynamic: true,
        canvas: reusedCanvas
    });

    const effectIndex = harness.surfaces.findIndex((surface) => surface.id === 'effect');
    const replacementEffect = createSurface('effect', {
        visibility: 'visible',
        opacity: '0.72',
        transform: 'scale(1.03)',
        filter: 'saturate(1.2)'
    });
    harness.surfaces.splice(effectIndex, 1, replacementEffect);
    const reusedStyleBefore = { ...reusedCanvas.style };
    const replacementStyleBefore = { ...replacementEffect.canvas.style };

    assert.equal(cutover.restoreNow('pool-reuse', harness.ownerToken), true);
    assert.deepEqual(reusedCanvas.style, reusedStyleBefore);
    assert.deepEqual(replacementEffect.canvas.style, replacementStyleBefore);
});

test('ACTIVE synchronize 예외는 외부로 throw하지 않고 같은 beginFrame에서 fallback을 복구한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    let throwNextProviderRead = false;
    const cutover = new TitleWebGpuOverlayCutover({
        ownerToken: harness.ownerToken,
        surfaceProvider() {
            if (throwNextProviderRead) {
                throwNextProviderRead = false;
                throw new Error('active-sync-provider-failure');
            }
            return harness.surfaces;
        }
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);

    throwNextProviderRead = true;
    assert.deepEqual(cutover.beginFrame(harness.ownerToken), {
        legacyDrawRequired: true,
        fullCutoverActive: false,
        fallbackRecovered: false,
        fallbackRedrawPending: true
    });
    assert.equal(cutover.completeFallbackRedraw(
        'active-sync-redrawn',
        harness.ownerToken
    ), true);
    let status = cutover.getStatus();
    assert.equal(status.state, 'armed');
    assert.equal(status.counters.providerFailureCount, 1);
    assert.equal(status.counters.fallbackCount, 1);
    assert.equal(status.counters.activationCount, 1);
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        ''
    );

    cutover.commitFrame(qualifyingReceipt({ frameId: 18 }), harness.ownerToken);
    throwNextProviderRead = true;
    assert.equal(cutover.synchronize(harness.ownerToken), false);
    status = cutover.getStatus();
    assert.equal(status.fallbackPending, true);
    assert.equal(cutover.commitFrame(
        qualifyingReceipt({ frameId: 19 }),
        harness.ownerToken
    ).lastCommittedFrameId, 18);
    assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);
    assert.equal(cutover.completeFallbackRedraw(
        'explicit-sync-fallback-redrawn',
        harness.ownerToken
    ), true);
});

test('fallback legacy style 복구가 중간 실패하면 모든 변경을 되돌리고 마지막 GPU를 유지한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });
    cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    cutover.abortFrame('style-rollback', harness.ownerToken);
    assert.equal(cutover.beginFrame(harness.ownerToken).fallbackRedrawPending, true);

    const objectStyle = harness.surfaces.find(
        (surface) => surface.id === 'object'
    ).canvas.style;
    let objectVisibility = objectStyle.visibility;
    let throwOnRestore = true;
    Object.defineProperty(objectStyle, 'visibility', {
        configurable: true,
        get() {
            return objectVisibility;
        },
        set(value) {
            if (throwOnRestore && value === '') {
                throw new Error('forced-legacy-restore-failure');
            }
            objectVisibility = value;
        }
    });

    assert.equal(cutover.completeFallbackRedraw(
        'style-rollback-failed',
        harness.ownerToken
    ), false);
    assert.equal(cutover.getStatus().fallbackPending, true);
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'gpu-object')
            .canvas.style.visibility,
        'visible'
    );
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        'hidden'
    );

    throwOnRestore = false;
    assert.equal(cutover.completeFallbackRedraw(
        'style-rollback-retry',
        harness.ownerToken
    ), true);
    assert.equal(objectStyle.visibility, '');
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'gpu-object')
            .canvas.style.visibility,
        'hidden'
    );
});

test('첫 cutover visibility 변경이 중간 실패하면 ARMED 표시 상태로 원자적으로 롤백한다', async () => {
    const { TitleWebGpuOverlayCutover } = await import(MODULE_URL.href);
    const harness = createHarness();
    const objectStyle = harness.surfaces.find(
        (surface) => surface.id === 'object'
    ).canvas.style;
    let objectVisibility = objectStyle.visibility;
    Object.defineProperty(objectStyle, 'visibility', {
        configurable: true,
        get() {
            return objectVisibility;
        },
        set(value) {
            if (value === 'hidden') {
                throw new Error('forced-cutover-style-failure');
            }
            objectVisibility = value;
        }
    });
    const cutover = new TitleWebGpuOverlayCutover({
        surfaceProvider: () => harness.surfaces,
        ownerToken: harness.ownerToken
    });

    const status = cutover.commitFrame(qualifyingReceipt(), harness.ownerToken);
    assert.equal(status.fallbackPending, true);
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'gpu-object')
            .canvas.style.visibility,
        'hidden'
    );
    assert.equal(
        harness.surfaces.find((surface) => surface.id === 'background')
            .canvas.style.visibility,
        ''
    );
    assert.equal(objectStyle.visibility, '');
});
