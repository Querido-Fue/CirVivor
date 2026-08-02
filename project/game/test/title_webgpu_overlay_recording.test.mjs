import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { recordTitleWebGpuOverlayFrame } = await loadGameModule(
    'scene/title/webgpu/_title_webgpu_overlay_recording.js'
);

function createGraph() {
    const calls = [];
    const graph = {};
    for (const method of ['recordVignette', 'recordTitleMenu', 'recordRoot', 'recordTooltip']) {
        graph[method] = (input) => {
            calls.push({ method, input });
            return true;
        };
    }
    return { graph, calls };
}

function surface(id, order, overrides = {}) {
    return {
        id,
        order,
        type: overrides.type ?? '2d',
        mode: overrides.mode ?? 'batch',
        canvas: overrides.canvas ?? { id: `${id}:canvas`, width: 400, height: 240, style: {} },
        width: overrides.width ?? 400,
        height: overrides.height ?? 240,
        opacity: overrides.opacity ?? 1,
        contentRevision: overrides.contentRevision ?? order,
        isEmpty: overrides.isEmpty === true,
        dynamic: true
    };
}

function sessionSnapshot({
    frameId = 9,
    identity = 'overlay-session:1',
    baseOrder = 10000,
    dimAlpha = 0.3,
    rootCommands = [],
    floatingCommands = [],
    rootContentBounds = null,
    floatingContentBounds = null,
    contentBlur = 0,
    contentScale = 0.9,
    withDim = true
} = {}) {
    const rootEffect = surface(`${identity}:root-effect`, baseOrder);
    const rootUi = surface(`${identity}:root-ui`, baseOrder + 1);
    const floatingEffect = surface(`${identity}:floating-effect`, baseOrder + 2, {
        isEmpty: floatingCommands.length === 0
    });
    const floatingUi = surface(`${identity}:floating-ui`, baseOrder + 3, {
        isEmpty: floatingCommands.length === 0
    });
    return {
        frameId,
        sessionIdentity: identity,
        sortOrderBase: baseOrder,
        presentation: {
            effectiveDim: 0.5,
            dimAlpha: 0.6,
            contentBlur,
            contentScale,
            contentOrigin: { x: 0.25, y: 0.75 }
        },
        dim: withDim ? {
            order: baseOrder - 1,
            surface: surface(`${identity}:dim`, baseOrder - 1),
            commands: [{ alpha: dimAlpha }]
        } : null,
        root: {
            order: baseOrder,
            effectSurface: rootEffect,
            uiSurface: rootUi,
            glassCommands: rootCommands,
            contentBoundsAuthority: createPanelContentBoundsAuthority(rootContentBounds)
        },
        floating: {
            order: baseOrder + 2,
            effectSurface: floatingEffect,
            uiSurface: floatingUi,
            glassCommands: floatingCommands,
            contentBoundsAuthority: createPanelContentBoundsAuthority(
                floatingContentBounds
            )
        }
    };
}

function createPanelContentBoundsAuthority(bounds) {
    if (!Array.isArray(bounds)) return null;
    return Object.freeze({
        kind: 'panel-content-bounds-v1',
        space: 'presented-screen',
        bounds: Object.freeze(bounds.map((entry) => Object.freeze({
            lineWidth: 0,
            shadowBlur: 0,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
            ...entry
        })))
    });
}

test('vignette/main/manager를 고정 rank와 실제 manager DOM order로 record한다', () => {
    const fixture = createGraph();
    const main = sessionSnapshot({
        identity: 'main-menu',
        baseOrder: 10000,
        withDim: false,
        contentBlur: 2,
        rootCommands: [{ x: 20, y: 20, w: 80, h: 60, blur: 4 }]
    });
    const manager = sessionSnapshot({
        identity: 'manager-overlay',
        baseOrder: 15020,
        rootCommands: [{ x: 120, y: 60, w: 100, h: 80, blur: 6.5 }],
        rootContentBounds: [{ x: 120, y: 60, width: 100, height: 80 }],
        floatingCommands: [{
            x: 250,
            y: 70,
            w: 80,
            h: 50,
            blur: 3,
            sampleBackdrop: true
        }],
        contentBlur: 2
    });
    manager.dim.surface.opacity = 0.25;
    const result = recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        blurPort: { getRequiredHalo: ({ sigma }) => Math.ceil(sigma * 3) },
        vignettePacket: {
            visible: true,
            color: new Float32Array([0.1, 0.2, 0.3, 0.4]),
            edgeWidth: 32,
            cornerRadius: 20
        },
        mainSnapshot: main,
        managerSnapshots: [manager],
        dynamicSurfaces: []
    });

    assert.equal(result.complete, true);
    assert.deepEqual(fixture.calls.map(({ method, input }) => [method, input.id]), [
        ['recordVignette', 'title:vignette'],
        ['recordTitleMenu', 'main-menu:root'],
        ['recordRoot', 'manager-overlay:dim'],
        ['recordRoot', 'manager-overlay:root'],
        ['recordRoot', 'manager-overlay:floating']
    ]);
    const dim = fixture.calls[2].input.payload.analyticNodes[0];
    assert.deepEqual({
        kind: dim.kind,
        color: Array.from(dim.color),
        opacity: dim.opacity
    }, { kind: 'dim', color: [0, 0, 0, 0.3], opacity: 1 });
    const managerRoot = fixture.calls[3].input;
    const mainRoot = fixture.calls[1].input;
    assert.deepEqual({ ...mainRoot.contentBlurs[0].bounds }, {
        x: 0,
        y: 0,
        width: 400,
        height: 240
    });
    assert.deepEqual({ ...mainRoot.contentBlurs[0].halo }, {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
    });
    assert.deepEqual({ ...mainRoot.contentBlurs[0].contentRoi }, {
        mode: 'full-screen',
        reason: 'panel-content-roi-disabled'
    });
    assert.equal(managerRoot.contentBlurs[0].sigma, 2);
    assert.deepEqual({ ...managerRoot.contentBlurs[0].contentRoi }, {
        mode: 'panel',
        reason: null
    });
    assert.deepEqual({ ...managerRoot.contentBlurs[0].bounds }, {
        x: 118,
        y: 58,
        width: 104,
        height: 84
    });
    assert.deepEqual({ ...managerRoot.contentBlurs[0].halo }, {
        left: 22,
        top: 10,
        right: 18,
        bottom: 18
    });
    assert.equal(managerRoot.payload.uiSurfaces[0].contentScale, 0.9);
    assert.deepEqual({ ...managerRoot.payload.uiSurfaces[0].contentOrigin }, {
        x: 0.25,
        y: 0.75
    });
    assert.equal(result.glassPanelCount, 3);
    assert.equal(result.dimNodeCount, 1);
});

test('manager content ROI는 glass scissor의 shadow/refraction 범위를 공유하고 algorithm ID를 보존한다', () => {
    for (const blurAlgorithmId of ['gaussian-quality', 'kawase-optimized']) {
        const fixture = createGraph();
        const haloCalls = [];
        const snapshot = sessionSnapshot({
            identity: `content-${blurAlgorithmId}`,
            withDim: false,
            contentBlur: 2,
            rootCommands: [{
                x: 100,
                y: 50,
                w: 80,
                h: 40,
                blur: 4,
                lineWidth: 1,
                refractionStrength: 5,
                shadowRadius: 4,
                shadowOffsetX: 3,
                shadowOffsetY: -2,
                shadowColor: 'transparent'
            }],
            rootContentBounds: [{ x: 100, y: 50, width: 80, height: 40 }]
        });
        recordTitleWebGpuOverlayFrame({
            graph: fixture.graph,
            frameId: 9,
            width: 400,
            height: 240,
            blurAlgorithmId,
            blurPort: {
                getRequiredHalo(input) {
                    haloCalls.push(input);
                    return 8;
                }
            },
            vignettePacket: { visible: false, color: [0, 0, 0, 0] },
            mainSnapshot: null,
            managerSnapshots: [snapshot]
        });

        const root = fixture.calls.find(
            ({ input }) => input.id === `content-${blurAlgorithmId}:root`
        ).input;
        assert.deepEqual({ ...root.contentBlurs[0].bounds }, {
            x: 84,
            y: 34,
            width: 112,
            height: 72
        });
        assert.deepEqual({ ...root.contentBlurs[0].halo }, {
            left: 20,
            top: 18,
            right: 12,
            bottom: 22
        });
        assert.equal(
            haloCalls.some((entry) => entry.algorithmId === blurAlgorithmId),
            true
        );
    }
});

test('manager panel envelope나 algorithm halo를 증명할 수 없으면 content blur를 full-screen으로 되돌린다', () => {
    const fixture = createGraph();
    const snapshot = sessionSnapshot({
        identity: 'invalid-content-roi',
        withDim: false,
        contentBlur: 6,
        rootCommands: [{ x: 40, y: 30, w: 0, h: 80, blur: 4 }],
        rootContentBounds: [{ x: 40, y: 30, width: 120, height: 80 }]
    });
    recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        managerSnapshots: [snapshot]
    });

    const root = fixture.calls.find(
        ({ input }) => input.id === 'invalid-content-roi:root'
    ).input;
    assert.deepEqual({ ...root.contentBlurs[0].bounds }, {
        x: 0,
        y: 0,
        width: 400,
        height: 240
    });
    assert.deepEqual({ ...root.contentBlurs[0].halo }, {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0
    });
    assert.equal(
        root.contentBlurs[0].contentRoi.reason,
        'glass-panel-projection-invalid'
    );

    const missingHaloFixture = createGraph();
    const missingHaloSnapshot = sessionSnapshot({
        identity: 'missing-halo-authority',
        withDim: false,
        contentBlur: 6,
        rootCommands: [{ x: 40, y: 30, w: 120, h: 80, blur: 4 }],
        rootContentBounds: [{ x: 40, y: 30, width: 120, height: 80 }]
    });
    recordTitleWebGpuOverlayFrame({
        graph: missingHaloFixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'kawase-optimized',
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        managerSnapshots: [missingHaloSnapshot]
    });
    const missingHaloRoot = missingHaloFixture.calls.find(
        ({ input }) => input.id === 'missing-halo-authority:root'
    ).input;
    assert.deepEqual({ ...missingHaloRoot.contentBlurs[0].bounds }, {
        x: 0,
        y: 0,
        width: 400,
        height: 240
    });
    assert.equal(
        missingHaloRoot.contentBlurs[0].contentRoi.reason,
        'algorithm-halo-resolver-missing'
    );
});

test('manager는 explicit panel authority가 없으면 full-screen이고 halo=0 identity만 request를 생략한다', () => {
    const missingAuthorityFixture = createGraph();
    const missingAuthoritySnapshot = sessionSnapshot({
        identity: 'missing-explicit-authority',
        withDim: false,
        contentBlur: 4,
        rootCommands: [{ x: 80, y: 60, w: 120, h: 80, blur: 3 }]
    });
    recordTitleWebGpuOverlayFrame({
        graph: missingAuthorityFixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        blurPort: { getRequiredHalo: () => 14 },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        managerSnapshots: [missingAuthoritySnapshot]
    });
    const missingAuthorityRoot = missingAuthorityFixture.calls.find(
        ({ input }) => input.id === 'missing-explicit-authority:root'
    ).input;
    assert.deepEqual({ ...missingAuthorityRoot.contentBlurs[0].bounds }, {
        x: 0,
        y: 0,
        width: 400,
        height: 240
    });
    assert.equal(
        missingAuthorityRoot.contentBlurs[0].contentRoi.reason,
        'explicit-content-authority-missing'
    );

    const identityFixture = createGraph();
    const identitySnapshot = sessionSnapshot({
        identity: 'gaussian-subpixel-identity',
        withDim: false,
        contentBlur: 0.1,
        rootCommands: [{ x: 80, y: 60, w: 120, h: 80, blur: 3 }],
        rootContentBounds: [{ x: 80, y: 60, width: 120, height: 80 }]
    });
    recordTitleWebGpuOverlayFrame({
        graph: identityFixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        blurPort: { getRequiredHalo: () => 0 },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        managerSnapshots: [identitySnapshot]
    });
    const identityRoot = identityFixture.calls.find(
        ({ input }) => input.id === 'gaussian-subpixel-identity:root'
    ).input;
    assert.equal(identityRoot.contentBlurs.length, 0);

    const kawaseFixture = createGraph();
    recordTitleWebGpuOverlayFrame({
        graph: kawaseFixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'kawase-optimized',
        blurPort: { getRequiredHalo: () => 7 },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        managerSnapshots: [identitySnapshot]
    });
    const kawaseRoot = kawaseFixture.calls.find(
        ({ input }) => input.id === 'gaussian-subpixel-identity:root'
    ).input;
    assert.equal(kawaseRoot.contentBlurs.length, 1);
    assert.equal(kawaseRoot.contentBlurs[0].contentRoi.mode, 'panel');
});

test('동일 sigma의 가까운 panel ROI만 1.35x 정책으로 합치고 halo를 8/16px에 정렬한다', () => {
    const fixture = createGraph();
    const snapshot = sessionSnapshot({
        identity: 'roi',
        withDim: false,
        rootCommands: [
            { x: 30, y: 40, w: 80, h: 60, blur: 6, refractionStrength: 3 },
            { x: 110, y: 40, w: 50, h: 60, blur: 6, refractionStrength: 1 },
            { x: 300, y: 160, w: 60, h: 50, blur: 6 },
            { x: 10, y: 10, w: 20, h: 20, blur: 6, sampleBackdrop: false }
        ]
    });
    const haloCalls = [];
    recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'kawase-optimized',
        blurPort: {
            getRequiredHalo(input) {
                haloCalls.push(input);
                return 20;
            }
        },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        mainSnapshot: snapshot,
        managerSnapshots: []
    });

    const root = fixture.calls.find(({ input }) => input.id === 'roi:root').input;
    assert.equal(root.backdropBlurs.length, 2);
    assert.deepEqual({ ...root.backdropBlurs[0].bounds }, {
        x: 30,
        y: 40,
        width: 130,
        height: 60
    });
    assert.deepEqual({ ...root.backdropBlurs[0].halo }, {
        left: 30,
        top: 24,
        right: 32,
        bottom: 28
    });
    assert.equal(root.payload.glassPanels[0].backdropIndex, 0);
    assert.equal(root.payload.glassPanels[1].backdropIndex, 0);
    assert.equal(root.payload.glassPanels[2].backdropIndex, 1);
    assert.equal(root.payload.glassPanels[3].backdropIndex, null);
    assert.equal(haloCalls.every(({ algorithmId }) => algorithmId === 'kawase-optimized'), true);
});

test('legacy panel blur strength를 visual sigma 경로에서만 가시적인 sigma로 변환한다', () => {
    for (const [blurAlgorithmId, expectedSigma] of [
        ['gaussian-quality', 13.5],
        ['kawase-optimized', 9],
        ['kawase-compatibility', 0.1]
    ]) {
        const fixture = createGraph();
        const haloCalls = [];
        const snapshot = sessionSnapshot({
            identity: `legacy-panel-${blurAlgorithmId}`,
            withDim: false,
            rootCommands: [
                { x: 30, y: 40, w: 80, h: 60, blur: 0.1 },
                { x: 140, y: 40, w: 80, h: 60, blur: 0 },
                { x: 250, y: 40, w: 80, h: 60, blur: 4 }
            ]
        });
        recordTitleWebGpuOverlayFrame({
            graph: fixture.graph,
            frameId: 9,
            width: 400,
            height: 240,
            blurAlgorithmId,
            blurPort: {
                getRequiredHalo(input) {
                    haloCalls.push(input);
                    return Math.ceil(input.sigma * 3);
                }
            },
            vignettePacket: { visible: false, color: [0, 0, 0, 0] },
            mainSnapshot: snapshot,
            managerSnapshots: []
        });

        const root = fixture.calls.find(
            ({ input }) => input.id === `legacy-panel-${blurAlgorithmId}:root`
        ).input;
        assert.deepEqual(
            Array.from(root.backdropBlurs, ({ sigma }) => sigma),
            [expectedSigma, 0, 4]
        );
        assert.deepEqual(
            haloCalls.map(({ sigma }) => sigma),
            [expectedSigma, 0, 4]
        );
    }
});

test('steady floating stage만 glass visual envelope의 16px aligned render ROI를 기록한다', () => {
    const fixture = createGraph();
    const snapshot = sessionSnapshot({
        identity: 'floating-stage-roi',
        withDim: false,
        contentScale: 1,
        floatingCommands: [{
            x: 250,
            y: 70,
            w: 80,
            h: 50,
            blur: 0.1,
            lineWidth: 1,
            sampleBackdrop: true
        }]
    });
    recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        blurPort: { getRequiredHalo: () => 24 },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        mainSnapshot: snapshot,
        managerSnapshots: []
    });

    const root = fixture.calls.find(
        ({ input }) => input.id === 'floating-stage-roi:root'
    ).input;
    const floating = fixture.calls.find(
        ({ input }) => input.id === 'floating-stage-roi:floating'
    ).input;
    assert.equal(root.payload.renderBounds, undefined);
    assert.deepEqual({ ...floating.payload.renderBounds }, {
        x: 240,
        y: 64,
        width: 96,
        height: 64
    });

    const transitioningFixture = createGraph();
    recordTitleWebGpuOverlayFrame({
        graph: transitioningFixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        blurPort: { getRequiredHalo: () => 24 },
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        mainSnapshot: sessionSnapshot({
            identity: 'floating-stage-full',
            withDim: false,
            contentScale: 0.9,
            floatingCommands: snapshot.floating.glassCommands
        }),
        managerSnapshots: []
    });
    const transitioningFloating = transitioningFixture.calls.find(
        ({ input }) => input.id === 'floating-stage-full:floating'
    ).input;
    assert.equal(transitioningFloating.payload.renderBounds, undefined);
});

test('numeric projectedQuad와 transform/perspective가 glass pass와 동일한 ROI를 만든다', () => {
    const fixture = createGraph();
    const snapshot = sessionSnapshot({
        identity: 'projected-roi',
        withDim: false,
        rootCommands: [
            {
                x: 20,
                y: 20,
                w: 80,
                h: 40,
                blur: 4,
                projectedQuad: [10, 15, 115, 25, 105, 90, 5, 70]
            },
            {
                x: 180,
                y: 80,
                w: 80,
                h: 40,
                blur: 8,
                perspective: 200,
                transformMatrix: [
                    1, 0, 0.5, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    20, -10, 0, 1
                ]
            }
        ]
    });
    recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        vignettePacket: { visible: false, color: [0, 0, 0, 0] },
        mainSnapshot: snapshot,
        managerSnapshots: []
    });

    const root = fixture.calls.find(({ input }) => input.id === 'projected-roi:root').input;
    assert.deepEqual({ ...root.backdropBlurs[0].bounds }, {
        x: 5,
        y: 15,
        width: 110,
        height: 75
    });
    assert.deepEqual({ ...root.backdropBlurs[1].bounds }, {
        x: 201,
        y: 66,
        width: 86,
        height: 46
    });
});

test('manager 밖 dynamic canvas를 tooltip fallback으로 포함하고 stale snapshot은 거부한다', () => {
    const fixture = createGraph();
    const snapshot = sessionSnapshot({ identity: 'claimed', withDim: false });
    const tooltip = surface('dynamic:tooltip', 190000, { opacity: 0.6 });
    const empty = surface('dynamic:empty', 200000, { isEmpty: true });
    const result = recordTitleWebGpuOverlayFrame({
        graph: fixture.graph,
        frameId: 9,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        vignettePacket: { visible: true, color: [0, 0, 0, 0.5] },
        mainSnapshot: snapshot,
        managerSnapshots: [],
        dynamicSurfaces: [
            snapshot.root.effectSurface,
            snapshot.root.uiSurface,
            tooltip,
            empty
        ]
    });
    assert.equal(result.complete, true);
    assert.ok(result.claimedSurfaceIds.includes('dynamic:tooltip'));
    const tooltipCall = fixture.calls.find(({ method }) => method === 'recordTooltip');
    assert.equal(tooltipCall.input.id, 'title:dynamic:dynamic:tooltip');
    assert.strictEqual(tooltipCall.input.payload.uiSurfaces[0].canvas, tooltip.canvas);

    assert.throws(() => recordTitleWebGpuOverlayFrame({
        graph: createGraph().graph,
        frameId: 10,
        width: 400,
        height: 240,
        blurAlgorithmId: 'gaussian-quality',
        mainSnapshot: snapshot
    }), /stale title overlay snapshot/);
});
