import {
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
     * @param {Set<string>|null} [options.availableBlurAlgorithmIds] - Kawase 외 등록 완료 algorithm ID입니다.
     * @param {Function|null} [options.titleWebGpuBaseGraphFactory] - 테스트 graph factory입니다.
     */
    constructor(controller, {
        titleGpuRolloutProfile = null,
        webGpuFramePort = undefined,
        webGpuBlurPort = undefined,
        availableBlurAlgorithmIds = null,
        titleWebGpuBaseGraphFactory = null
    } = {}) {
        this.controller = controller;
        this.titleGpuRolloutProfile = titleGpuRolloutProfile;
        this.titleGradientBackground = new TitleGradientBackground();
        this.titleBackground = new TitleBackGround(controller, { drawBackgroundFill: false });
        this.content = new TitleLoadingSequence(controller);
        this.titleWebGpuBaseGraph = null;
        this.titleWebGpuShadowFailureCount = 0;
        this.titleWebGpuShadowLastFailure = null;
        this.titleWebGpuShadowRetryEnabled = true;
        this.titleWebGpuShadowConfig = Object.seal({
            webGpuFramePort,
            webGpuBlurPort,
            availableBlurAlgorithmIds,
            titleWebGpuBaseGraphFactory
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
        this.titleGradientBackground?.draw();
        this.titleBackground?.draw();
        this.content?.draw();
        this.#encodeWebGpuShadowGraph();
    }

    /** 타이틀 배경 적의 fixed tick을 갱신합니다. */
    fixedUpdate() {
        this.titleBackground?.fixedUpdate();
    }

    /** viewport와 모든 타이틀 시각 컴포넌트 배치를 갱신합니다. */
    resize() {
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
            graph: this.titleWebGpuBaseGraph?.getDiagnostics?.() ?? null
        });
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
        this.titleWebGpuBaseGraph?.destroy?.();
        this.titleWebGpuBaseGraph = null;
        this.titleWebGpuShadowInput = null;
        this.titleWebGpuShadowConfig = null;
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
        let blurAlgorithmRegistered = false;
        try {
            blurAlgorithmRegistered = blurPort.hasAlgorithm?.(blurAlgorithmId) === true;
        } catch {
            blurAlgorithmRegistered = false;
        }
        const gaussianAvailable = pipelineMode !== TITLE_PIPELINE_MODE.WEBGPU_GAUSSIAN
            || config?.availableBlurAlgorithmIds?.has?.(blurAlgorithmId) === true
            || blurAlgorithmRegistered;
        if (!gaussianAvailable) {
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
}
