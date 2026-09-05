import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const ANIMATION_CATEGORY = Object.freeze({ UI: 'ui' });

function createSyntheticModule(context, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function initialize() {
        for (const [name, value] of Object.entries(exports)) {
            this.setExport(name, value);
        }
    }, { context });
}

async function loadOverlaySession() {
    const [source, captureGateSource] = await Promise.all([
        readFile(
            new URL('../project/game/script/module/overlay/_overlay_session.js', import.meta.url),
            'utf8'
        ),
        readFile(
            new URL(
                '../project/game/script/module/scene/title/webgpu/_title_webgpu_overlay_capture_gate.js',
                import.meta.url
            ),
            'utf8'
        )
    ]);
    const renders = [];
    const context = vm.createContext({ console });
    const captureGateModule = new vm.SourceTextModule(captureGateSource, {
        context,
        identifier: '_title_webgpu_overlay_capture_gate.js'
    });
    await captureGateModule.link(() => {
        throw new Error('capture gate에는 외부 의존성이 없어야 합니다.');
    });
    await captureGateModule.evaluate();
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: '_overlay_session.js'
    });
    const dependencies = new Map([
        ['display/display_system.js', createSyntheticModule(context, {
            render: (layer, command) => renders.push({ type: '2d', layer, command }),
            renderGL: (layer, command) => renders.push({ type: 'webgl', layer, command })
        })],
        ['animation/animation_system.js', createSyntheticModule(context, {
            ANIMATION_CATEGORY,
            animate: () => ({ id: 1, promise: new Promise(() => {}) }),
            remove: () => {}
        })],
        ['display/webgl/_overlay_render_geometry.js', createSyntheticModule(context, {
            resolveOverlayContentSurfaceStyles: (scale, originX, originY, blur) => ({
                transformOrigin: `${originX * 100}% ${originY * 100}%`,
                uiTransform: `scale(${scale})`,
                effectTransform: `scale(${scale})`,
                uiFilter: `blur(${blur}px)`,
                effectFilter: `blur(${blur}px)`
            })
        })],
        ['display/webgl/_webgl_constants.js', createSyntheticModule(context, {
            OVERLAY_RENDER_CONSTANTS: {
                BACKDROP_SAMPLING_ENABLED: true,
                GLASS_TRANSITION_DURATION_SECONDS: 0.4,
                GLASS_TRANSITION_EASING: 'easeOutExpo'
            }
        })],
        ['util/number_util.js', createSyntheticModule(context, {
            clampFiniteNumber: (value, min, max, fallback) => Number.isFinite(value)
                ? Math.max(min, Math.min(max, value))
                : fallback,
            clampNumber: (value, min, max) => Math.max(min, Math.min(max, value))
        })],
        ['./_overlay_effect_registry.js', createSyntheticModule(context, {
            createOverlayEffectState: () => null
        })],
        [
            'scene/title/webgpu/_title_webgpu_overlay_capture_gate.js',
            captureGateModule
        ]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return {
        OverlaySession: module.namespace.OverlaySession,
        beginCapture: captureGateModule.namespace.beginTitleWebGpuOverlayCapture,
        endCapture: captureGateModule.namespace.endTitleWebGpuOverlayCapture,
        getCaptureToken: captureGateModule.namespace.getTitleWebGpuOverlayCaptureToken,
        renders
    };
}

function createDisplaySystem(frameId = 1) {
    let nextSurfaceId = 0;
    const surfaces = new Map();
    return {
        webGpuFrameSerial: frameId,
        surfaces,
        createDynamicSurface(options) {
            nextSurfaceId += 1;
            const id = `surface-${nextSurfaceId}`;
            const surface = {
                id,
                ...options,
                sequence: nextSurfaceId,
                dynamic: true,
                persistent: false,
                contentRevision: nextSurfaceId * 10,
                compositeStateRevision: nextSurfaceId * 10 + 1,
                compositeSolidOpacity: 0,
                isEmpty: false,
                canvas: {
                    width: 800,
                    height: 450,
                    style: {}
                }
            };
            surfaces.set(id, surface);
            return surface;
        },
        releaseDynamicSurface(id) {
            surfaces.delete(id);
        },
        getSurface(id) {
            return surfaces.get(id) ?? null;
        },
        markSurfaceCompositeChanged(id) {
            const surface = surfaces.get(id);
            if (surface) surface.compositeStateRevision += 1;
        },
        markOverlayEffectDirty() {},
        setSurfaceCompositeSolidOpacity(id, opacity) {
            const surface = surfaces.get(id);
            if (surface) surface.compositeSolidOpacity = opacity;
        },
        getCompositeSourcesBeforeSurface(id) {
            return {
                snapshotIdentity: `before:${id}`,
                sourceRevision: 1,
                sources: []
            };
        }
    };
}

test('OverlaySession은 같은 frame의 모든 dim/root/floating 의미 명령을 alias 없이 보존한다', async () => {
    const { OverlaySession, beginCapture, endCapture, renders } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(41);
    const captureToken = beginCapture(displaySystem, 41);
    assert.ok(captureToken);
    const session = new OverlaySession({
        displaySystem,
        layer: 3,
        orderSequence: 2,
        dim: 0.2,
        transparent: true,
        glOverlay: false,
        disableTransparency: false
    });
    session.setAlpha(0.7);
    session.setDimAlpha(0.5);
    session.setContentScale(0.92);
    session.setContentBlur(3.5);
    session.setContentScaleOrigin(0.2, 0.8);

    session.renderDim();
    const effectTextureCanvas = { id: 'effect-texture-canvas' };
    const transformMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        5, 6, 0, 1
    ]);
    const reusableOptions = {
        x: 10,
        y: 20,
        w: 100,
        h: 80,
        radius: 12,
        blur: 6.5,
        alpha: 0.8,
        sampleBackdrop: true,
        transformMatrix,
        projectedQuad: [[10, 20], [110, 20], [110, 100], [10, 100]],
        effectTextureCanvas
    };
    session.renderGlassPanel(reusableOptions);
    reusableOptions.x = 30;
    reusableOptions.blur = 2;
    reusableOptions.projectedQuad[0][0] = 30;
    transformMatrix[12] = 99;
    session.renderGlassPanel(reusableOptions);
    assert.equal(session.renderFloatingGlassPanel({
        x: 50,
        y: 60,
        w: 70,
        h: 40,
        radius: 8,
        blur: 4,
        alpha: 0.6,
        sampleBackdrop: true,
        effectTextureCanvas
    }), true);

    const snapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(snapshot.frameId, 41);
    assert.equal(snapshot.sortOrderBase, 3020);
    assert.deepEqual({ ...snapshot.presentation.contentOrigin }, { x: 0.2, y: 0.8 });
    assert.equal(snapshot.presentation.alpha, 0.7);
    assert.equal(snapshot.presentation.contentScale, 0.92);
    assert.equal(snapshot.presentation.contentBlur, 3.5);
    assert.equal(snapshot.presentation.effectiveTransparent, true);
    assert.deepEqual({ ...snapshot.presentation.surfaceOpacities }, {
        dim: 1,
        rootEffect: 0.7,
        rootUi: 0.7,
        floatingEffect: 0.7,
        floatingUi: 0.7
    });
    assert.equal(snapshot.dim.commands.length, 1);
    assert.ok(Math.abs(snapshot.dim.commands[0].alpha - 0.22) < 1e-12);
    assert.equal(snapshot.root.glassCommands.length, 2);
    assert.equal(snapshot.root.glassCommands[0].x, 10);
    assert.equal(snapshot.root.glassCommands[0].blur, 6.5);
    assert.equal(snapshot.root.glassCommands[0].sampleBackdrop, true);
    assert.equal(snapshot.root.glassCommands[0].transformMatrix[12], 5);
    assert.equal(snapshot.root.glassCommands[0].projectedQuad[0][0], 10);
    assert.equal(snapshot.root.glassCommands[1].x, 30);
    assert.equal(snapshot.root.glassCommands[1].blur, 2);
    assert.equal(snapshot.root.glassCommands[0].effectTextureCanvas, effectTextureCanvas);
    assert.equal(snapshot.floating.glassCommands.length, 1);
    assert.equal(snapshot.floating.glassCommands[0].effectTextureCanvas, effectTextureCanvas);
    assert.equal(snapshot.root.effectSurface.order, 3020);
    assert.equal(snapshot.root.uiSurface.order, 3021);
    assert.equal(snapshot.floating.effectSurface.order, 3022);
    assert.equal(snapshot.floating.uiSurface.order, 3023);
    assert.equal(snapshot.revisions.blur, session.blurRevision);
    assert.equal(snapshot.revisions.rootUiContent, session.uiSurface.contentRevision);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.root.glassCommands), true);
    assert.equal(Object.isFrozen(snapshot.root.glassCommands[0].transformMatrix), true);
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), snapshot);
    assert.equal(renders.filter(({ type }) => type === 'webgl').length, 3);

    assert.equal(endCapture(displaySystem, captureToken), true);
    displaySystem.webGpuFrameSerial = 42;
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    const nextCaptureToken = beginCapture(displaySystem, 42);
    assert.ok(nextCaptureToken);
    const nextFrame = session.getTitleWebGpuPresentationSnapshot();
    assert.notEqual(nextFrame, snapshot);
    assert.equal(nextFrame.frameId, 42);
    assert.equal(nextFrame.dim.commands.length, 0);
    assert.equal(nextFrame.root.glassCommands.length, 0);
    assert.equal(nextFrame.floating.glassCommands.length, 0);
    assert.equal(snapshot.root.glassCommands.length, 2);
    assert.equal(endCapture(displaySystem, nextCaptureToken), true);
});

test('full cutover capture는 semantic과 UI source를 유지하고 legacy dim/WebGL sink만 생략한다', async () => {
    const { OverlaySession, beginCapture, endCapture, renders } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(43);
    const captureToken = beginCapture(displaySystem, 43, {
        legacyDrawRequired: false
    });
    const session = new OverlaySession({
        displaySystem,
        layer: 3,
        orderSequence: 2,
        dim: 0.2,
        transparent: true,
        glOverlay: false,
        disableTransparency: false
    });

    assert.equal(session.requiresBackdropComposite(), false);
    session.renderDim();
    session.renderGlassPanel({ x: 10, y: 20, w: 100, h: 80, blur: 4, alpha: 1 });
    assert.equal(session.renderFloatingGlassPanel({
        x: 20,
        y: 30,
        w: 60,
        h: 40,
        blur: 3,
        alpha: 1
    }), true);
    session.renderPanel({ shape: 'text', text: 'atlas source', x: 1, y: 2 });

    const snapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(snapshot.dim.commands.length, 1);
    assert.equal(snapshot.root.glassCommands.length, 1);
    assert.equal(snapshot.floating.glassCommands.length, 1);
    assert.equal(renders.filter(({ type }) => type === 'webgl').length, 0);
    assert.equal(renders.filter(({ type }) => type === '2d').length, 1);
    assert.equal(endCapture(displaySystem, captureToken), true);

    const legacyToken = beginCapture(displaySystem, 44, {
        legacyDrawRequired: true
    });
    assert.equal(session.requiresBackdropComposite(), true);
    session.renderGlassPanel({ x: 1, y: 2, w: 3, h: 4, blur: 1, alpha: 1 });
    assert.equal(renders.filter(({ type }) => type === 'webgl').length, 1);
    assert.equal(endCapture(displaySystem, legacyToken), true);
});

test('명시적으로 opt-in한 session만 presented panel content bounds authority를 snapshot한다', async () => {
    const { OverlaySession, beginCapture, endCapture } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(51);
    const captureToken = beginCapture(displaySystem, 51);
    const authorized = new OverlaySession({
        displaySystem,
        layer: 3,
        orderSequence: 1,
        dim: 0,
        transparent: false,
        glOverlay: false,
        titleWebGpuContentBoundsAuthority: 'panels'
    });
    authorized.setContentBlur(4);
    assert.equal(authorized.recordTitleWebGpuPanelContentBounds({
        x: 120,
        y: 80,
        w: 300,
        h: 180,
        lineWidth: 2,
        shadowBlur: 12,
        shadowOffsetX: 3,
        shadowOffsetY: -4
    }), true);
    const snapshot = authorized.getTitleWebGpuPresentationSnapshot();
    assert.equal(snapshot.root.contentBoundsAuthority.kind, 'panel-content-bounds-v1');
    assert.equal(snapshot.root.contentBoundsAuthority.space, 'presented-screen');
    assert.deepEqual({ ...snapshot.root.contentBoundsAuthority.bounds[0] }, {
        x: 120,
        y: 80,
        width: 300,
        height: 180,
        lineWidth: 2,
        shadowBlur: 12,
        shadowOffsetX: 3,
        shadowOffsetY: -4
    });
    assert.equal(Object.isFrozen(snapshot.root.contentBoundsAuthority), true);
    assert.equal(Object.isFrozen(snapshot.root.contentBoundsAuthority.bounds), true);

    const unauthorized = new OverlaySession({
        displaySystem,
        layer: 4,
        orderSequence: 2,
        dim: 0,
        transparent: false,
        glOverlay: false
    });
    assert.equal(unauthorized.recordTitleWebGpuPanelContentBounds({
        x: 0,
        y: 0,
        w: 10,
        h: 10
    }), false);
    assert.equal(
        unauthorized.getTitleWebGpuPresentationSnapshot().root.contentBoundsAuthority,
        null
    );
    assert.equal(endCapture(displaySystem, captureToken), true);
});

test('OverlaySession은 effect가 없는 UI-only session도 root surface snapshot으로 노출한다', async () => {
    const { OverlaySession, beginCapture, endCapture } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(77);
    const captureToken = beginCapture(displaySystem, 77);
    const session = new OverlaySession({
        displaySystem,
        layer: 1,
        orderSequence: 4,
        dim: 0,
        transparent: false,
        glOverlay: false,
        effects: {}
    });

    const snapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(snapshot.frameId, 77);
    assert.equal(snapshot.dim, null);
    assert.equal(snapshot.root.effectSurface, null);
    assert.equal(snapshot.root.uiSurface.id, session.uiLayerId);
    assert.equal(snapshot.root.glassCommands.length, 0);
    assert.equal(snapshot.floating.effectSurface, null);
    assert.equal(snapshot.floating.uiSurface, null);
    assert.equal(snapshot.presentation.effectiveTransparent, false);

    session.release();
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    assert.equal(endCapture(displaySystem, captureToken), true);
});

test('title overlay capture gate는 DisplaySystem identity와 owner token을 분리한다', async () => {
    const {
        beginCapture,
        endCapture,
        getCaptureToken
    } = await loadOverlaySession();
    const firstDisplay = createDisplaySystem(3);
    const secondDisplay = createDisplaySystem(8);
    const firstToken = beginCapture(firstDisplay, 3);
    const secondToken = beginCapture(secondDisplay, 8);
    let endCleanupCount = 0;

    assert.equal(getCaptureToken(firstDisplay, () => {
        endCleanupCount += 1;
        throw new Error('cleanup failure must be isolated');
    }), firstToken);
    assert.equal(getCaptureToken(secondDisplay), secondToken);
    assert.equal(beginCapture(firstDisplay, 4), null);
    assert.equal(endCapture(firstDisplay, secondToken), false);
    assert.equal(getCaptureToken(firstDisplay), firstToken);
    assert.equal(endCapture(firstDisplay, firstToken), true);
    assert.equal(endCleanupCount, 1);
    assert.equal(getCaptureToken(firstDisplay), null);
    assert.equal(getCaptureToken(secondDisplay), secondToken);
    assert.equal(endCapture(secondDisplay, secondToken), true);
});

test('inactive capture는 legacy draw를 유지하면서 이전 의미 명령을 보관하지 않는다', async () => {
    const {
        OverlaySession,
        beginCapture,
        endCapture,
        renders
    } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(0);
    const session = new OverlaySession({
        displaySystem,
        layer: 2,
        orderSequence: 1,
        dim: 0.2,
        transparent: true,
        glOverlay: false,
        disableTransparency: false
    });

    for (let index = 0; index < 64; index++) {
        session.renderDim();
        session.renderGlassPanel({
            x: index,
            y: 10,
            w: 100,
            h: 40,
            blur: 4,
            alpha: 1
        });
    }
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    assert.equal(renders.length, 128);

    const captureToken = beginCapture(displaySystem, 91);
    const cleanSnapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(cleanSnapshot.frameId, 91);
    assert.equal(cleanSnapshot.dim.commands.length, 0);
    assert.equal(cleanSnapshot.root.glassCommands.length, 0);
    session.renderDim();
    session.renderGlassPanel({ x: 1, y: 2, w: 3, h: 4, blur: 0, alpha: 1 });
    const capturedSnapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(capturedSnapshot.dim.commands.length, 1);
    assert.equal(capturedSnapshot.root.glassCommands.length, 1);

    assert.equal(endCapture(displaySystem, captureToken), true);
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    const nextToken = beginCapture(displaySystem, 92);
    const nextSnapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.equal(nextSnapshot.dim.commands.length, 0);
    assert.equal(nextSnapshot.root.glassCommands.length, 0);
    assert.equal(endCapture(displaySystem, nextToken), true);
});

test('semantic deep-copy 실패는 legacy WebGL draw를 중단하지 않고 해당 capture만 폐기한다', async () => {
    const {
        OverlaySession,
        beginCapture,
        endCapture,
        renders
    } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(12);
    const captureToken = beginCapture(displaySystem, 12, {
        legacyDrawRequired: false
    });
    const session = new OverlaySession({
        displaySystem,
        layer: 1,
        orderSequence: 1,
        dim: 0,
        transparent: true,
        glOverlay: false,
        disableTransparency: false
    });
    const throwingMatrix = {
        toFloat64Array() {
            throw new Error('synthetic matrix copy failure');
        }
    };

    assert.doesNotThrow(() => session.renderGlassPanel({
        x: 1,
        y: 2,
        w: 30,
        h: 40,
        blur: 2,
        alpha: 1,
        transformMatrix: throwingMatrix
    }));
    assert.equal(renders.filter(({ type }) => type === 'webgl').length, 1);
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    assert.equal(endCapture(displaySystem, captureToken), true);

    const recoveryToken = beginCapture(displaySystem, 13);
    session.renderGlassPanel({ x: 1, y: 2, w: 30, h: 40, blur: 2, alpha: 1 });
    assert.equal(
        session.getTitleWebGpuPresentationSnapshot().root.glassCommands.length,
        1
    );
    assert.equal(endCapture(displaySystem, recoveryToken), true);
});

test('같은 capture frame에서도 surface revision 변화는 UI-only snapshot cache를 갱신한다', async () => {
    const { OverlaySession, beginCapture, endCapture } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(20);
    const captureToken = beginCapture(displaySystem, 20);
    const session = new OverlaySession({
        displaySystem,
        layer: 1,
        orderSequence: 1,
        dim: 0,
        transparent: false,
        glOverlay: false,
        effects: {}
    });

    const firstSnapshot = session.getTitleWebGpuPresentationSnapshot();
    session.uiSurface.contentRevision += 1;
    const contentChangedSnapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.notEqual(contentChangedSnapshot, firstSnapshot);
    assert.equal(
        contentChangedSnapshot.revisions.rootUiContent,
        firstSnapshot.revisions.rootUiContent + 1
    );

    session.uiSurface.compositeStateRevision += 1;
    const compositeChangedSnapshot = session.getTitleWebGpuPresentationSnapshot();
    assert.notEqual(compositeChangedSnapshot, contentChangedSnapshot);
    assert.equal(
        compositeChangedSnapshot.revisions.rootUiComposite,
        contentChangedSnapshot.revisions.rootUiComposite + 1
    );
    assert.equal(endCapture(displaySystem, captureToken), true);
});

test('release 또는 pool 재사용으로 canvas identity가 바뀌면 snapshot은 fail-closed 된다', async () => {
    const { OverlaySession, beginCapture, endCapture } = await loadOverlaySession();
    const displaySystem = createDisplaySystem(30);
    const captureToken = beginCapture(displaySystem, 30);
    const session = new OverlaySession({
        displaySystem,
        layer: 1,
        orderSequence: 1,
        dim: 0,
        transparent: false,
        glOverlay: false,
        effects: {}
    });
    assert.ok(session.getTitleWebGpuPresentationSnapshot());

    const staleSurface = session.uiSurface;
    displaySystem.surfaces.set(staleSurface.id, {
        ...staleSurface,
        canvas: { width: 800, height: 450, style: {} }
    });
    assert.equal(session.getTitleWebGpuPresentationSnapshot(), null);
    assert.equal(endCapture(displaySystem, captureToken), true);
});

async function loadOverlayManager() {
    const [source, captureGateSource] = await Promise.all([
        readFile(
            new URL('../project/game/script/module/overlay/overlay_system.js', import.meta.url),
            'utf8'
        ),
        readFile(
            new URL(
                '../project/game/script/module/scene/title/webgpu/_title_webgpu_overlay_capture_gate.js',
                import.meta.url
            ),
            'utf8'
        )
    ]);
    const context = vm.createContext({ console });
    const captureGateModule = new vm.SourceTextModule(captureGateSource, {
        context,
        identifier: '_title_webgpu_overlay_capture_gate.js'
    });
    await captureGateModule.link(() => {
        throw new Error('capture gate에는 외부 의존성이 없어야 합니다.');
    });
    await captureGateModule.evaluate();
    const module = new vm.SourceTextModule(source, {
        context,
        identifier: 'overlay_system.js'
    });
    class EmptyController {}
    const dependencies = new Map([
        ['display/display_system.js', createSyntheticModule(context, {
            getDisplaySystem: () => null
        })],
        ['debug/debug_system.js', createSyntheticModule(context, {
            beginPerformanceSection: () => 0,
            endPerformanceSection: () => {}
        })],
        ['save/save_system.js', createSyntheticModule(context, {
            getSetting: () => false
        })],
        [
            'scene/title/webgpu/_title_webgpu_overlay_capture_gate.js',
            captureGateModule
        ],
        ['util/runtime_tool.js', createSyntheticModule(context, {
            runtimeTool: () => null
        })],
        ['./_overlay_session.js', createSyntheticModule(context, {
            OverlaySession: class {}
        })],
        ['./_debug_overlay.js', createSyntheticModule(context, { DebugOverlay: EmptyController })],
        ['./_exit_overlay.js', createSyntheticModule(context, { ExitOverlay: EmptyController })],
        ['./_external_link_warning_overlay.js', createSyntheticModule(context, {
            ExternalLinkWarningOverlay: EmptyController
        })],
        ['./title/_deck.js', createSyntheticModule(context, { DeckOverlay: EmptyController })],
        ['./title/_settings_overlay.js', createSyntheticModule(context, {
            SettingsOverlay: EmptyController
        })],
        ['./title/_credits.js', createSyntheticModule(context, { CreditsOverlay: EmptyController })],
        ['./title/_quick_start.js', createSyntheticModule(context, {
            QuickStartOverlay: EmptyController
        })],
        ['./title/_records.js', createSyntheticModule(context, { RecordsOverlay: EmptyController })],
        ['./title/_research.js', createSyntheticModule(context, { ResearchOverlay: EmptyController })],
        ['./title/_achievements.js', createSyntheticModule(context, {
            AchievementsOverlay: EmptyController
        })],
        ['./title/_map_select_overlay.js', createSyntheticModule(context, {
            MapSelectOverlay: EmptyController
        })]
    ]);
    await module.link((specifier) => dependencies.get(specifier));
    await module.evaluate();
    return {
        OverlayManager: module.namespace.OverlayManager,
        beginCapture: captureGateModule.namespace.beginTitleWebGpuOverlayCapture,
        endCapture: captureGateModule.namespace.endTitleWebGpuOverlayCapture
    };
}

test('OverlayManager는 manager entry snapshot만 layer/sequence 순서로 반환한다', async () => {
    const { OverlayManager, beginCapture, endCapture } = await loadOverlayManager();
    const manager = new OverlayManager();
    manager.displaySystem = createDisplaySystem(99);
    const captureToken = beginCapture(manager.displaySystem, 99);
    const calls = [];
    const makeSession = (id, snapshot) => ({
        getTitleWebGpuPresentationSnapshot() {
            calls.push(id);
            return snapshot;
        }
    });
    manager.entries.set('late', {
        order: 5,
        sequence: 1,
        session: makeSession('late', Object.freeze({ frameId: 99, sessionIdentity: 'late' }))
    });
    manager.entries.set('same-order-late', {
        order: 2,
        sequence: 9,
        session: makeSession(
            'same-order-late',
            Object.freeze({ frameId: 99, sessionIdentity: 'same-order-late' })
        )
    });
    manager.entries.set('same-order-early', {
        order: 2,
        sequence: 3,
        session: makeSession(
            'same-order-early',
            Object.freeze({ frameId: 99, sessionIdentity: 'same-order-early' })
        )
    });
    manager.sortedEntriesDirty = true;

    const snapshots = manager.getTitleWebGpuPresentationSnapshots();
    assert.deepEqual(calls, ['same-order-early', 'same-order-late', 'late']);
    assert.deepEqual(
        Array.from(snapshots, ({ sessionIdentity }) => sessionIdentity),
        ['same-order-early', 'same-order-late', 'late']
    );
    assert.equal(Object.isFrozen(snapshots), true);
    assert.equal(endCapture(manager.displaySystem, captureToken), true);
    assert.equal(manager.getTitleWebGpuPresentationSnapshots(), null);
});

test('OverlayManager는 active session snapshot 하나라도 없거나 stale이면 fail-closed 된다', async () => {
    const { OverlayManager, beginCapture, endCapture } = await loadOverlayManager();
    const manager = new OverlayManager();
    manager.displaySystem = createDisplaySystem(10);
    const captureToken = beginCapture(manager.displaySystem, 10);
    manager.entries.set('valid', {
        order: 1,
        sequence: 1,
        session: {
            getTitleWebGpuPresentationSnapshot: () => Object.freeze({ frameId: 10 })
        }
    });
    manager.entries.set('failed', {
        order: 2,
        sequence: 2,
        session: { getTitleWebGpuPresentationSnapshot: () => null }
    });
    manager.sortedEntriesDirty = true;
    assert.equal(manager.getTitleWebGpuPresentationSnapshots(), null);

    manager.entries.get('failed').session.getTitleWebGpuPresentationSnapshot = () => (
        Object.freeze({ frameId: 9 })
    );
    assert.equal(manager.getTitleWebGpuPresentationSnapshots(), null);
    assert.equal(endCapture(manager.displaySystem, captureToken), true);
});
