import {
    getDisplaySystem,
    getWebGpuBlurPort,
    getWebGpuFrameContributorPort
} from 'display/display_system.js';
import { TitleBackGround } from './_title_background.js';
import { TitleGradientBackground } from './_title_gradient_background.js';
import { TITLE_PIPELINE_MODE } from './_title_gpu_rollout.js';
import { TitleLoadingSequence } from './_title_loading_sequence.js';
import { TitleSceneIntroSequence } from './_title_scene_intro_sequence.js';
import {
    getTitleWebGpuBaseGraphBlurAlgorithmId,
    TitleWebGpuBaseGraph
} from './webgpu/_title_webgpu_base_graph.js';
import {
    beginTitleWebGpuOverlayCapture,
    endTitleWebGpuOverlayCapture
} from './webgpu/_title_webgpu_overlay_capture_gate.js';
import { createTitleWebGpuOverlayPipeline } from './webgpu/_title_webgpu_overlay_pipeline.js';

/**
 * 타이틀 배경과 현재 foreground content를 한 수명 주기로 묶어 LoadingScene→TitleScene에 넘깁니다.
 */
export class TitleScenePresentation {
    /**
     * @param {import('./_title_scene_controller.js').TitleSceneController} controller - 안정적인 타이틀 action 소유자입니다.
     * @param {object} [options={}] - session 생성 시 고정할 presentation 옵션입니다.
     * @param {Readonly<object>|null} [options.titleGpuRolloutProfile=null] - Loading이 만든 동일 identity rollout profile입니다.
     * @param {object|null} [options.webGpuFramePort] - 테스트 또는 Display 주입 frame port입니다.
     * @param {object|null} [options.webGpuBlurPort] - 테스트 또는 Display 주입 blur port입니다.
     * @param {Set<string>|null} [options.availableBlurAlgorithmIds] - 등록 완료 blur algorithm ID입니다.
     * @param {Function|null} [options.titleWebGpuBaseGraphFactory] - 테스트 graph factory입니다.
     * @param {Function|null} [options.titleWebGpuOverlayPipelineFactory] - 테스트 overlay pipeline factory입니다.
     * @param {object|null} [options.displaySystem] - 테스트 또는 현재 DisplaySystem identity입니다.
     */
    constructor(controller, {
        titleGpuRolloutProfile = null,
        webGpuFramePort = undefined,
        webGpuBlurPort = undefined,
        availableBlurAlgorithmIds = null,
        titleWebGpuBaseGraphFactory = null,
        titleWebGpuOverlayPipelineFactory = null,
        displaySystem = undefined
    } = {}) {
        this.controller = controller;
        this.titleGpuRolloutProfile = titleGpuRolloutProfile;
        this.titleGradientBackground = new TitleGradientBackground();
        this.titleBackground = new TitleBackGround(controller, {
            drawBackgroundFill: false,
            simulationMode: titleGpuRolloutProfile?.simulationMode ?? 'cpu'
        });
        this.content = new TitleLoadingSequence(controller);
        this.titleWebGpuBaseGraph = null;
        this.titleWebGpuOverlayCoordinator = null;
        this.titleWebGpuOverlayFrame = null;
        this.titleLegacyFallbackRedrawReady = false;
        this.titleWebGpuSurfaceBuffer = [];
        this.titleWebGpuDynamicSurfaceBuffer = [];
        this.titleWebGpuOverlayFailureCount = 0;
        this.titleWebGpuOverlayLastFailure = null;
        this.titleWebGpuOverlayState = Object.freeze({
            status: 'overlay-not-initialized',
            reason: null
        });
        this.titleWebGpuShadowFailureCount = 0;
        this.titleWebGpuShadowLastFailure = null;
        this.titleWebGpuShadowRetryEnabled = true;
        this.titleWebGpuShadowConfig = Object.seal({
            webGpuFramePort,
            webGpuBlurPort,
            availableBlurAlgorithmIds,
            titleWebGpuBaseGraphFactory,
            titleWebGpuOverlayPipelineFactory,
            displaySystem
        });
        this.titleWebGpuShadowInput = Object.seal({
            presentationSeconds: 0,
            gradientColors: null,
            titleBackground: null,
            centerCircle: null,
            titleLogo: null,
            introBlur: 0
        });
        this.titleWebGpuShadowState = this.#initializeWebGpuShadowGraph();
        if (titleGpuRolloutProfile?.simulationMode === 'gpu'
            && (!this.titleWebGpuBaseGraph || !this.titleWebGpuOverlayCoordinator)) {
            this.#fallbackGpuSimulation('webgpu-title-pipeline-unavailable');
        }
        this.controller.setTitleContent(this.content);
    }

    /** 기존 gradient→content→enemy background 갱신 순서를 보존합니다. */
    update() {
        this.titleGradientBackground?.update();
        this.content?.update();
        this.titleBackground?.update(
            this.content?.getEnemyShieldLayout?.() || null,
            this.content?.isEnemySpawnReady?.() === true
        );
    }

    /** 기존 gradient→enemy background→foreground 렌더 순서를 보존합니다. */
    draw() {
        this.titleLegacyFallbackRedrawReady = false;
        if (this.#beginWebGpuOverlayPresentation() !== true) {
            this.#fallbackGpuSimulation('overlay-begin-failed');
        }
        const legacyDrawRequired = this.titleWebGpuOverlayFrame
            ?.legacyDrawRequired !== false;
        try {
            if (legacyDrawRequired) {
                this.titleGradientBackground?.draw();
                this.titleBackground?.draw();
            } else {
                this.titleGradientBackground?.prepareFrame?.();
            }
            this.content?.draw({ legacyDrawRequired });
            if (this.#encodeWebGpuShadowGraph() !== true) {
                if (this.titleWebGpuOverlayFrame) {
                    this.abortWebGpuPresentation('base-graph-encode-failed');
                }
                this.#fallbackGpuSimulation('base-graph-encode-failed');
            }
            this.titleLegacyFallbackRedrawReady = legacyDrawRequired;
        } catch (error) {
            this.abortWebGpuPresentation('title-draw-threw');
            throw error;
        }
    }

    /** 타이틀 배경 적의 fixed tick을 갱신합니다. */
    fixedUpdate() {
        this.titleBackground?.fixedUpdate();
    }

    /** viewport와 모든 타이틀 시각 컴포넌트 배치를 갱신합니다. */
    resize() {
        this.abortWebGpuPresentation('title-resize');
        this.titleWebGpuOverlayCoordinator?.restoreNow?.('title-resize');
        this.controller.syncViewportMetrics();
        this.titleGradientBackground?.resize();
        this.titleBackground?.resize();
        this.content?.resize();
    }

    /**
     * 설정 변경을 기존 순서로 배경과 foreground에 전달합니다.
     * @param {object} [changedSettings={}] - 변경된 설정입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.theme !== undefined
            && this.titleBackground
            && typeof this.titleBackground.applyTheme === 'function') {
            this.titleBackground.applyTheme();
        }
        this.content?.applyRuntimeSettings?.(changedSettings);
    }

    /** @returns {boolean} loading content가 이동 직전 handoff 경계에 도달했는지 여부입니다. */
    isTitleSceneHandoffReady() {
        return this.content?.isTitleSceneHandoffReady?.() === true;
    }

    /**
     * Loading에서 session에 고정한 rollout profile을 같은 identity로 반환합니다.
     * @returns {Readonly<object>|null} presentation이 보관한 rollout profile입니다.
     */
    getTitleGpuRolloutProfile() {
        return this.titleGpuRolloutProfile;
    }

    /** shadow graph rollout, 실패 및 allocation/upload 상태를 반환합니다. */
    getTitleWebGpuShadowDiagnostics() {
        return Object.freeze({
            ...this.titleWebGpuShadowState,
            failureCount: this.titleWebGpuShadowFailureCount,
            lastFailure: this.titleWebGpuShadowLastFailure,
            graph: this.titleWebGpuBaseGraph?.getDiagnostics?.() ?? null,
            simulation: this.titleBackground?.getSimulationDiagnostics?.() ?? null,
            overlay: Object.freeze({
                ...this.titleWebGpuOverlayState,
                failureCount: this.titleWebGpuOverlayFailureCount,
                lastFailure: this.titleWebGpuOverlayLastFailure,
                coordinator: this.titleWebGpuOverlayCoordinator
                    ?.getDiagnostics?.() ?? null
            })
        });
    }

    /** UI/overlay draw와 최종 WebGL flush 뒤 같은 composer frame의 단일 canvas pass를 완성합니다. */
    finalizeWebGpuPresentation({ overlaySnapshots = null } = {}) {
        const frame = this.titleWebGpuOverlayFrame;
        const coordinator = this.titleWebGpuOverlayCoordinator;
        if (!frame || !coordinator) {
            this.#fallbackGpuSimulation('overlay-frame-unavailable');
            return false;
        }

        try {
            if (!Array.isArray(overlaySnapshots)) {
                throw new Error('manager overlay snapshot capture가 불완전합니다.');
            }
            const titleMenuSession = this.content?.titleMenu?.session ?? null;
            const mainSnapshot = titleMenuSession
                ?.getTitleWebGpuPresentationSnapshot?.() ?? null;
            if (titleMenuSession && !mainSnapshot) {
                throw new Error('main title-menu snapshot capture가 불완전합니다.');
            }
            const result = coordinator.finalizeFrame({
                frameId: frame.frameId,
                vignettePacket: frame.displaySystem.vignetteRenderer
                    ?.getWebGpuPresentationPacket?.() ?? null,
                mainSnapshot,
                managerSnapshots: overlaySnapshots,
                dynamicSurfaces: this.#collectDynamicSurfaces(frame.displaySystem)
            });
            if (result?.accepted !== true) {
                this.titleWebGpuOverlayFailureCount += 1;
                this.titleWebGpuOverlayLastFailure = Object.freeze({
                    reason: result?.reason ?? 'overlay-finalize-rejected',
                    message: result?.message ?? null
                });
                this.#fallbackGpuSimulation('overlay-finalize-rejected');
                return false;
            }
            this.titleWebGpuOverlayLastFailure = null;
            return true;
        } catch (error) {
            coordinator.abortFrame?.('overlay-finalize-threw');
            this.titleWebGpuOverlayFailureCount += 1;
            this.titleWebGpuOverlayLastFailure = Object.freeze({
                reason: 'overlay-finalize-threw',
                message: error?.message ?? String(error)
            });
            this.#fallbackGpuSimulation('overlay-finalize-threw');
            return false;
        } finally {
            endTitleWebGpuOverlayCapture(
                frame.displaySystem,
                frame.captureToken
            );
            this.titleWebGpuOverlayFrame = null;
        }
    }

    /** 숨겨진 legacy 전체 draw와 SystemHandler의 최종 WebGL flush가 끝난 경우에만 fallback을 노출합니다. */
    completePresentationFallback() {
        if (!this.titleLegacyFallbackRedrawReady) {
            return false;
        }
        this.titleLegacyFallbackRedrawReady = false;
        return this.titleWebGpuOverlayCoordinator
            ?.completeFallbackRedraw?.('post-final-flush') === true;
    }

    /** composer abort/scene 경계에서 semantic capture와 logical overlay frame을 함께 닫습니다. */
    abortWebGpuPresentation(reason = 'title-presentation-aborted') {
        const frame = this.titleWebGpuOverlayFrame;
        const aborted = this.titleWebGpuOverlayCoordinator?.abortFrame?.(reason) === true;
        if (!frame) return aborted;
        endTitleWebGpuOverlayCapture(frame.displaySystem, frame.captureToken);
        this.titleWebGpuOverlayFrame = null;
        return true;
    }

    /**
     * LoadingScene 자산 identity를 보존한 채 TitleScene 전용 이동 단계를 시작합니다.
     * @returns {boolean} 타이틀 단계 시작 성공 여부입니다.
     */
    beginTitleScenePhase() {
        const introAssets = this.content?.releaseTitleIntroAssets?.() || null;
        if (!introAssets) return false;
        const titleIntro = new TitleSceneIntroSequence(this.controller, introAssets);
        this.content = titleIntro;
        this.controller.setTitleContent(titleIntro);
        return true;
    }

    /**
     * 완료된 TitleScene 인트로의 실제 컴포넌트를 정상 content로 승격합니다.
     * @returns {boolean} 완료 content 승격 여부입니다.
     */
    promoteCompletedTitleIntro() {
        const completedContent = this.content?.releaseCompletedContent?.() || null;
        if (!completedContent) return false;
        this.content = completedContent;
        this.controller.setTitleContent(completedContent);
        return true;
    }

    /** 모든 타이틀 시각 리소스를 기존 소유 순서로 정리합니다. */
    destroy() {
        this.abortWebGpuPresentation('title-destroy');
        this.titleWebGpuOverlayCoordinator?.destroy?.();
        this.titleWebGpuOverlayCoordinator = null;
        this.titleWebGpuBaseGraph?.destroy?.();
        this.titleWebGpuBaseGraph = null;
        this.titleWebGpuShadowInput = null;
        this.titleWebGpuShadowConfig = null;
        this.titleWebGpuSurfaceBuffer = null;
        this.titleWebGpuDynamicSurfaceBuffer = null;
        this.titleLegacyFallbackRedrawReady = false;
        this.titleWebGpuShadowRetryEnabled = false;
        this.titleGradientBackground?.destroy();
        this.titleGradientBackground = null;
        this.titleBackground?.destroy();
        this.titleBackground = null;
        this.content?.destroy();
        this.content = null;
        this.controller?.setTitleContent(null);
        this.titleGpuRolloutProfile = null;
    }

    #initializeWebGpuShadowGraph() {
        const config = this.titleWebGpuShadowConfig;
        const pipelineMode = this.titleGpuRolloutProfile?.pipelineMode
            ?? TITLE_PIPELINE_MODE.LEGACY_WEBGL;
        if (pipelineMode === TITLE_PIPELINE_MODE.LEGACY_WEBGL) {
            this.titleWebGpuShadowRetryEnabled = false;
            return Object.freeze({ status: 'legacy-visible', reason: 'legacy-profile', pipelineMode });
        }

        const blurAlgorithmId = getTitleWebGpuBaseGraphBlurAlgorithmId(pipelineMode);
        if (!blurAlgorithmId) {
            this.titleWebGpuShadowRetryEnabled = false;
            return Object.freeze({ status: 'shadow-unavailable', reason: 'unknown-pipeline', pipelineMode });
        }

        const framePort = config?.webGpuFramePort === undefined
            ? getWebGpuFrameContributorPort()
            : config?.webGpuFramePort;
        const blurPort = config?.webGpuBlurPort === undefined
            ? getWebGpuBlurPort()
            : config?.webGpuBlurPort;
        if (!framePort || !blurPort) {
            return Object.freeze({
                status: 'shadow-unavailable',
                reason: 'display-webgpu-port-unavailable',
                pipelineMode,
                blurAlgorithmId
            });
        }
        const configuredAlgorithmIds = config?.availableBlurAlgorithmIds;
        const hasConfiguredRegistry = typeof configuredAlgorithmIds?.has === 'function';
        const hasPortRegistry = typeof blurPort.hasAlgorithm === 'function';
        let blurAlgorithmRegistered = hasConfiguredRegistry
            && configuredAlgorithmIds.has(blurAlgorithmId) === true;
        if (hasPortRegistry) {
            try {
                blurAlgorithmRegistered = blurAlgorithmRegistered
                    || blurPort.hasAlgorithm(blurAlgorithmId) === true;
            } catch {
                // authoritative port probe 실패는 미등록으로 처리합니다.
            }
        }
        if ((hasConfiguredRegistry || hasPortRegistry) && !blurAlgorithmRegistered) {
            this.titleWebGpuShadowRetryEnabled = false;
            return Object.freeze({
                status: 'shadow-unavailable',
                reason: 'blur-algorithm-not-registered',
                pipelineMode,
                blurAlgorithmId
            });
        }

        try {
            const factory = typeof config?.titleWebGpuBaseGraphFactory === 'function'
                ? config.titleWebGpuBaseGraphFactory
                : (dependencies) => new TitleWebGpuBaseGraph(dependencies);
            this.titleWebGpuBaseGraph = factory({
                framePort,
                blurPort,
                blurAlgorithmId
            });
            if (!this.titleWebGpuBaseGraph
                || typeof this.titleWebGpuBaseGraph.encode !== 'function') {
                throw new TypeError('title WebGPU base graph factory 결과가 유효하지 않습니다.');
            }
            this.titleWebGpuOverlayState = this.#initializeWebGpuOverlayPipeline({
                framePort,
                blurPort,
                blurAlgorithmId
            });
            this.titleWebGpuShadowRetryEnabled = false;
            return Object.freeze({
                status: 'shadow-ready',
                reason: null,
                pipelineMode,
                blurAlgorithmId
            });
        } catch (error) {
            this.titleWebGpuBaseGraph = null;
            this.titleWebGpuShadowRetryEnabled = false;
            return Object.freeze({
                status: 'shadow-unavailable',
                reason: `graph-init-failed:${error?.message ?? String(error)}`,
                pipelineMode,
                blurAlgorithmId
            });
        }
    }

    #encodeWebGpuShadowGraph() {
        if (!this.titleWebGpuBaseGraph && this.titleWebGpuShadowRetryEnabled) {
            this.titleWebGpuShadowState = this.#initializeWebGpuShadowGraph();
        }
        const graph = this.titleWebGpuBaseGraph;
        if (!graph) {
            return false;
        }
        try {
            const input = this.titleWebGpuShadowInput;
            input.presentationSeconds = this.titleGradientBackground?.elapsed ?? 0;
            input.gradientColors = this.titleGradientBackground?.colorData ?? null;
            input.titleBackground = this.titleBackground;
            input.centerCircle = this.content?.centerCircle ?? null;
            input.titleLogo = this.content?.titleLogo ?? null;
            input.introBlur = this.content?.centerCircle?.introBlur ?? 0;
            const encoded = graph.encode(input);
            if (encoded !== true) {
                this.titleWebGpuShadowFailureCount += 1;
                this.titleWebGpuShadowLastFailure = graph.getDiagnostics?.().lastFailure
                    ?? Object.freeze({ reason: 'shadow-encode-rejected', message: null });
            } else {
                this.titleWebGpuShadowLastFailure = null;
            }
            return encoded === true;
        } catch (error) {
            this.titleWebGpuShadowFailureCount += 1;
            this.titleWebGpuShadowLastFailure = Object.freeze({
                reason: 'shadow-encode-threw',
                message: error?.message ?? String(error)
            });
            return false;
        }
    }

    #initializeWebGpuOverlayPipeline({ framePort, blurPort, blurAlgorithmId }) {
        const config = this.titleWebGpuShadowConfig;
        const displaySystem = config?.displaySystem === undefined
            ? getDisplaySystem()
            : config.displaySystem;
        if (!displaySystem?.surfaceMap || typeof displaySystem.surfaceMap.values !== 'function') {
            return Object.freeze({
                status: 'overlay-unavailable',
                reason: 'display-surface-registry-unavailable',
                blurAlgorithmId
            });
        }

        try {
            const factory = typeof config?.titleWebGpuOverlayPipelineFactory === 'function'
                ? config.titleWebGpuOverlayPipelineFactory
                : createTitleWebGpuOverlayPipeline;
            this.titleWebGpuOverlayCoordinator = factory({
                baseGraph: this.titleWebGpuBaseGraph,
                framePort,
                blurPort,
                blurAlgorithmId,
                surfaceProvider: () => this.#collectSurfaces(displaySystem)
            });
            if (!this.titleWebGpuOverlayCoordinator
                || typeof this.titleWebGpuOverlayCoordinator.beginFrame !== 'function'
                || typeof this.titleWebGpuOverlayCoordinator.finalizeFrame !== 'function') {
                throw new TypeError('title WebGPU overlay pipeline 결과가 유효하지 않습니다.');
            }
            return Object.freeze({
                status: 'overlay-ready',
                reason: null,
                blurAlgorithmId
            });
        } catch (error) {
            this.titleWebGpuOverlayCoordinator?.destroy?.();
            this.titleWebGpuOverlayCoordinator = null;
            return Object.freeze({
                status: 'overlay-unavailable',
                reason: `overlay-init-failed:${error?.message ?? String(error)}`,
                blurAlgorithmId
            });
        }
    }

    #fallbackGpuSimulation(reason) {
        return this.titleBackground?.fallbackToCpuSimulation?.(reason) === true;
    }

    #beginWebGpuOverlayPresentation() {
        const coordinator = this.titleWebGpuOverlayCoordinator;
        const config = this.titleWebGpuShadowConfig;
        const displaySystem = config?.displaySystem === undefined
            ? getDisplaySystem()
            : config?.displaySystem;
        if (!coordinator || !displaySystem || this.titleWebGpuOverlayFrame) {
            return false;
        }
        const frameId = displaySystem.webGpuFrameSerial;
        const targetCanvas = displaySystem.getSurface?.('gpu-object')?.canvas ?? null;
        const width = targetCanvas?.width;
        const height = targetCanvas?.height;
        if (!Number.isSafeInteger(frameId)
            || frameId < 0
            || !Number.isSafeInteger(width)
            || width <= 0
            || !Number.isSafeInteger(height)
            || height <= 0) {
            return false;
        }

        try {
            const begin = coordinator.beginFrame({ frameId, width, height });
            if (begin?.accepted !== true) return false;
            const legacyDrawRequired = begin.legacyDrawRequired !== false;
            const captureToken = beginTitleWebGpuOverlayCapture(displaySystem, frameId, {
                legacyDrawRequired
            });
            if (!captureToken) {
                coordinator.abortFrame?.('overlay-capture-token-unavailable');
                return false;
            }
            this.titleWebGpuOverlayFrame = Object.seal({
                frameId,
                displaySystem,
                captureToken,
                legacyDrawRequired
            });
            return true;
        } catch (error) {
            coordinator.abortFrame?.('overlay-begin-threw');
            this.titleWebGpuOverlayFailureCount += 1;
            this.titleWebGpuOverlayLastFailure = Object.freeze({
                reason: 'overlay-begin-threw',
                message: error?.message ?? String(error)
            });
            return false;
        }
    }

    #collectSurfaces(displaySystem) {
        const surfaces = this.titleWebGpuSurfaceBuffer;
        surfaces.length = 0;
        for (const surface of displaySystem.surfaceMap.values()) {
            surfaces.push(surface);
        }
        return surfaces;
    }

    #collectDynamicSurfaces(displaySystem) {
        const surfaces = this.titleWebGpuDynamicSurfaceBuffer;
        surfaces.length = 0;
        for (const surface of displaySystem.surfaceMap.values()) {
            if (surface?.dynamic === true) surfaces.push(surface);
        }
        return surfaces;
    }
}
