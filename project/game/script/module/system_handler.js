import { SaveSystem } from 'save/save_system.js';
import { DisplaySystem } from 'display/display_system.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { InputSystem } from 'input/input_system.js';
import { ObjectSystem } from 'object/object_system.js';
import { SceneSystem } from 'scene/scene_system.js';
import { UISystem } from 'ui/ui_system.js';
import { OverlayManager } from 'overlay/overlay_system.js';
import {
    DebugSystem,
    beginPerformanceSection,
    endPerformanceSection
} from 'debug/debug_system.js';
import { SoundSystem } from 'sound/sound_system.js';
import { getTimeHandler } from 'game/time_handler.js';
import { warmupUIPools } from 'ui/_ui_pool.js';
import { drainSimulationCommands } from 'simulation/simulation_command_queue.js';
import { syncSimulationRuntime } from 'simulation/simulation_runtime.js';
import {
    isReleaseSimulationProfilerCollecting,
    recordReleaseSimulationFixedStep,
    shouldRecordReleaseSimulationForFrameMode
} from 'simulation/release_simulation_profiler.js';
import { drawReleaseSimulationProfilerHud } from 'debug/_release_simulation_profiler_hud.js';

const DISPLAY_REFRESH_SETTING_KEYS = new Set(['windowMode', 'widescreenSupport', 'renderScale']);
const SIMULATION_RUNTIME_SETTING_KEYS = Object.freeze(['debugMode']);
const DEFAULT_FRAME_EXECUTION_POLICY = Object.freeze({
    keepLoopRunning: true,
    runFrameTimeUpdate: true,
    runFixedStep: true,
    runSoundUpdate: true,
    runAnimationUpdate: true,
    runInputUpdate: true,
    runUiUpdate: true,
    runOverlayUpdate: true,
    runObjectUpdate: true,
    runSceneUpdate: true,
    runSimulationCommandApply: true,
    runDebugUpdate: true,
    renderFrame: true,
    renderInput: true,
    renderObject: true,
    renderScene: true,
    renderUi: true,
    renderOverlay: true,
    renderDebug: true,
    renderSound: true,
    pauseBgm: false,
    resetInputOnEnter: false,
    setMouseInactiveOnEnter: false
});
const FRAME_EXECUTION_DISABLE_KEYS = Object.freeze([
    'keepLoopRunning',
    'runFrameTimeUpdate',
    'runFixedStep',
    'runSoundUpdate',
    'runAnimationUpdate',
    'runInputUpdate',
    'runUiUpdate',
    'runOverlayUpdate',
    'runObjectUpdate',
    'runSceneUpdate',
    'runSimulationCommandApply',
    'runDebugUpdate',
    'renderFrame',
    'renderInput',
    'renderObject',
    'renderScene',
    'renderUi',
    'renderOverlay',
    'renderDebug',
    'renderSound'
]);
const CANVAS_POOL_WARMUP_COUNTS = Object.freeze({
    CANVAS_2D: 16,
    CANVAS_WEBGL: 0
});
const FRAME_ANIMATION_UPDATE_OPTIONS = Object.freeze({ useFixedTick: false });
const FIXED_ANIMATION_UPDATE_OPTIONS = Object.freeze({ useFixedTick: true });
const EMPTY_FRAME_CONTEXT = Object.freeze({});
const RUNNING_DEBUG_FRAME_CONTROL = Object.freeze({ mode: 'running' });
const DEBUG_FRAME_MODES = Object.freeze(new Set(['running', 'paused', 'step']));
const DEBUG_PAUSED_EXECUTION_DISABLE_KEYS = Object.freeze([
    'runFrameTimeUpdate',
    'runFixedStep',
    'runSoundUpdate',
    'runAnimationUpdate',
    'runObjectUpdate',
    'runSceneUpdate',
    'runSimulationCommandApply'
]);

/**
 * @class SystemHandler
 * @description 게임의 핵심 서브 시스템(저장, 표시, 입력, UI, 씬 등)의 생성/초기화/업데이트 순서를 총괄합니다.
 */
export class SystemHandler {
    constructor() {
        this.pauseReasons = new Map();
        this.frameExecutionPolicy = this.createPausePolicy();
        this.debugPausedFrameExecutionPolicy = { ...this.frameExecutionPolicy };
        this.debugPresentationPaused = false;
        this.simulationRuntimeSnapshot = {
            viewport: {
                ww: 0,
                wh: 0,
                objectWH: 0,
                objectOffsetY: 0,
                uiww: 0,
                uiOffsetX: 0
            },
            input: {
                mousePos: { x: 0, y: 0 },
                wheel: { x: 0, y: 0 },
                mouseButtons: { left: [], right: [], middle: [] },
                focusList: [],
                actionStates: {},
                keys: {}
            },
            settings: {}
        };
    }
    /**
     * 모든 시스템을 초기화합니다.
     * 각 시스템의 init 메서드를 순차적으로 호출하여 의존성을 보장합니다.
     */
    async init() {
        this.loadTime = performance.now().toFixed(1);

        // 1. SaveSystem (설정 로드)
        this.saveSystem = new SaveSystem();
        await this.saveSystem.init();
        this.logDebugInfo("SaveSystem 로드");

        // 2. SoundSystem (사운드 초기화 - 설정 의존)
        this.soundSystem = new SoundSystem();
        await this.soundSystem.init();
        this.logDebugInfo("SoundSystem 로드");

        // 3. DisplaySystem (화면/WebGL 초기화 - 설정 의존)
        this.displaySystem = new DisplaySystem();
        await this.displaySystem.init();
        this.logDebugInfo("DisplaySystem 로드");

        // 4. AnimationSystem (애니메이션 초기화)
        this.animationSystem = new AnimationSystem();
        await this.animationSystem.init();
        this.displaySystem.initializeThemeTransition();
        this.logDebugInfo("AnimationSystem 로드");

        // 5. InputSystem (입력 초기화)
        this.inputSystem = new InputSystem({
            bindings: this.saveSystem.getSetting('inputBindings')
        });
        await this.inputSystem.init();
        this.logDebugInfo("InputSystem 로드");
        this.#syncSimulationRuntime();

        // 6. UISystem (UI 초기화)
        this.uiSystem = new UISystem();
        await this.uiSystem.init();
        this.logDebugInfo("UISystem 로드");

        // 7. ObjectSystem (오브젝트 초기화)
        this.objectSystem = new ObjectSystem();
        await this.objectSystem.init();
        this.logDebugInfo("ObjectSystem 로드");

        // 8. SceneSystem (씬 초기화)
        this.sceneSystem = new SceneSystem(this);
        await this.sceneSystem.init();
        this.logDebugInfo("SceneSystem 로드");

        // 9. OverlayManager (오버레이 초기화)
        this.overlayManager = new OverlayManager();
        await this.overlayManager.init();
        this.logDebugInfo("OverlayManager 로드");

        // 10. DebugSystem (디버그 초기화)
        this.debugSystem = new DebugSystem();
        await this.debugSystem.init();
        this.logDebugInfo("DebugSystem 로드");

        // 11. 풀 워밍업
        await this.animationSystem.warmup();
        warmupUIPools();
        this.displaySystem.warmupCanvasPools(
            CANVAS_POOL_WARMUP_COUNTS.CANVAS_2D,
            CANVAS_POOL_WARMUP_COUNTS.CANVAS_WEBGL
        );
        this.logDebugInfo("풀 워밍업");
        this.logDebugInfo("모든 모듈 로드");
        delete this.loadTime;
    }

    /**
     * 디버그 모드에서 각 모듈 로드 완료 시 소요 시간을 콘솔에 출력합니다.
     * @param {string} loadedModule - 로드된 모듈 이름
     */
    logDebugInfo(loadedModule) {
        if (this.saveSystem.getSetting("debugMode")) {
            console.log("[" + (performance.now() - this.loadTime).toFixed(1) + "ms] " + loadedModule + " 완료");
        }
    }

    /**
     * 기본 프레임 실행 정책을 기반으로 새 정책 객체를 생성합니다.
     * 추후 인게임 일시정지 메뉴는 이 정책에서 필요한 플래그만 끄면 됩니다.
     * @param {object} [overrides={}] - 덮어쓸 실행 정책입니다.
     * @returns {object} 정규화된 실행 정책입니다.
     */
    createPausePolicy(overrides = {}) {
        const policy = { ...DEFAULT_FRAME_EXECUTION_POLICY };

        FRAME_EXECUTION_DISABLE_KEYS.forEach((key) => {
            if (overrides[key] === false) {
                policy[key] = false;
            }
        });

        policy.pauseBgm = overrides.pauseBgm === true;
        policy.resetInputOnEnter = overrides.resetInputOnEnter === true;
        policy.setMouseInactiveOnEnter = overrides.setMouseInactiveOnEnter === true;
        return policy;
    }

    /**
     * 지정한 이유의 프레임 실행 정책을 활성/비활성화합니다.
     * @param {string} reasonKey - 일시정지 이유 식별자입니다.
     * @param {boolean} isActive - 이유 활성화 여부입니다.
     * @param {object} [policy={}] - 활성화 시 사용할 실행 정책입니다.
     * @returns {boolean} 실제 상태가 바뀌었는지 여부입니다.
     */
    setPauseReason(reasonKey, isActive, policy = {}) {
        if (typeof reasonKey !== 'string' || reasonKey.length === 0) {
            return false;
        }

        const hadReason = this.pauseReasons.has(reasonKey);
        if (isActive) {
            const nextPolicy = this.createPausePolicy(policy);
            this.pauseReasons.set(reasonKey, nextPolicy);
            if (!hadReason && nextPolicy.resetInputOnEnter === true) {
                this.inputSystem?.resetAllInputState?.({
                    mouseInactive: nextPolicy.setMouseInactiveOnEnter === true
                });
            }
        } else if (hadReason) {
            this.pauseReasons.delete(reasonKey);
        } else {
            return false;
        }

        this.frameExecutionPolicy = this.#buildFrameExecutionPolicy();
        this.#applyPauseSideEffects();
        const didChange = hadReason !== this.pauseReasons.has(reasonKey);
        if (didChange) {
            this.sceneSystem?.synchronizePresentation?.();
        }
        return didChange;
    }

    /**
     * 지정한 이유의 일시정지를 해제합니다.
     * @param {string} reasonKey - 해제할 일시정지 이유 식별자입니다.
     * @returns {boolean} 실제 상태가 바뀌었는지 여부입니다.
     */
    clearPauseReason(reasonKey) {
        return this.setPauseReason(reasonKey, false);
    }

    /**
     * 특정 일시정지 이유가 활성 상태인지 반환합니다.
     * @param {string} reasonKey - 검사할 일시정지 이유 식별자입니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isPauseReasonActive(reasonKey) {
        return this.pauseReasons.has(reasonKey);
    }

    /**
     * 현재 실행 정책상 메인 루프를 계속 유지해야 하는지 반환합니다.
     * @returns {boolean} 루프 유지 여부입니다.
     */
    shouldKeepLoopRunning() {
        return this.frameExecutionPolicy.keepLoopRunning === true;
    }

    /**
     * 현재 병합된 프레임 실행 정책 스냅샷을 반환합니다.
     * @returns {object} 현재 프레임 실행 정책입니다.
     */
    getFrameExecutionPolicy() {
        return { ...this.frameExecutionPolicy };
    }

    /**
     * 현재 실행 정책상 고정 스텝을 진행해야 하는지 반환합니다.
     * @returns {boolean} 고정 스텝 진행 여부입니다.
     */
    shouldRunFixedStep() {
        return this.frameExecutionPolicy.runFixedStep === true;
    }

    /**
     * 현재 디버그 시스템의 프레임 실행 제어 요청을 반환합니다.
     * @returns {{mode:'running'|'paused'|'step'}} 정규화된 프레임 제어 상태입니다.
     */
    prepareDebugFrameControl() {
        const frameControl = this.debugSystem?.prepareFrameControl?.();
        return DEBUG_FRAME_MODES.has(frameControl?.mode)
            ? frameControl
            : RUNNING_DEBUG_FRAME_CONTROL;
    }

    /**
     * 디버그 모드와 실행 정책을 정규화하고 시뮬레이션 스냅샷을 동기화한 뒤 fixed step 반복,
     * 보간 alpha 설정, surface clear, 가변 update, draw, 최종 WebGL flush 순서로 한 프레임을 실행합니다.
     * release profiler가 활성화된 fixed step은 `try/finally`로 성공 여부와 소요 시간을 기록합니다.
     * @param {object} [frameContext={}] 프레임 컨텍스트입니다.
     * @param {number} [frameContext.frameDeltaSeconds] 가변 프레임 델타(초)입니다.
     * @param {number} [frameContext.fixedStepSeconds] 고정 스텝 델타(초)입니다.
     * @param {number} [frameContext.fixedStepCount] 이번 프레임에 처리할 고정 스텝 횟수입니다.
     * @param {number} [frameContext.fixedAlpha] 렌더 보간 계수(0~1)입니다.
     * @param {'running'|'paused'|'step'} [frameContext.debugFrameMode='running'] 디버그 프레임 제어 상태입니다.
     * @returns {void}
     */
    tick(frameContext = EMPTY_FRAME_CONTEXT) {
        const debugFrameMode = DEBUG_FRAME_MODES.has(frameContext.debugFrameMode)
            ? frameContext.debugFrameMode
            : 'running';
        this.#synchronizeDebugPresentationPauseState(debugFrameMode);
        const executionPolicy = this.#resolveFrameExecutionPolicy(debugFrameMode);
        const timeHandler = getTimeHandler();
        if (debugFrameMode === 'paused' && typeof timeHandler?.freezeFrameDelta === 'function') {
            timeHandler.freezeFrameDelta();
        }
        this.#syncSimulationRuntime();
        const frameDeltaSeconds = executionPolicy.runFrameTimeUpdate
            && Number.isFinite(frameContext.frameDeltaSeconds)
            && frameContext.frameDeltaSeconds > 0
            ? frameContext.frameDeltaSeconds
            : undefined;
        const fixedStepSeconds = Number.isFinite(frameContext.fixedStepSeconds) && frameContext.fixedStepSeconds > 0
            ? frameContext.fixedStepSeconds
            : (timeHandler?.fixedStepSeconds ?? (1 / 60));
        const fixedStepCount = executionPolicy.runFixedStep
            && Number.isInteger(frameContext.fixedStepCount)
            && frameContext.fixedStepCount > 0
            ? frameContext.fixedStepCount
            : 0;
        const fixedAlpha = debugFrameMode !== 'running'
            ? 1
            : (executionPolicy.runFixedStep && Number.isFinite(frameContext.fixedAlpha)
                ? frameContext.fixedAlpha
                : 0);
        const shouldMeasureReleaseSimulation = isReleaseSimulationProfilerCollecting()
            && shouldRecordReleaseSimulationForFrameMode(debugFrameMode);

        if (fixedStepCount > 0) {
            const fixedTotalStart = beginPerformanceSection();
            for (let i = 0; i < fixedStepCount; i++) {
                if (!shouldMeasureReleaseSimulation) {
                    if (timeHandler && typeof timeHandler.updateFixed === 'function') {
                        const fixedTimeStart = beginPerformanceSection();
                        timeHandler.updateFixed(fixedStepSeconds);
                        endPerformanceSection('fixed.time', fixedTimeStart);
                    }
                    this.#runFixedStep();
                    continue;
                }

                const releaseFixedStart = performance.now();
                let completedReleaseFixedStep = false;
                try {
                    if (timeHandler && typeof timeHandler.updateFixed === 'function') {
                        const fixedTimeStart = beginPerformanceSection();
                        timeHandler.updateFixed(fixedStepSeconds);
                        endPerformanceSection('fixed.time', fixedTimeStart);
                    }
                    this.#runFixedStep();
                    completedReleaseFixedStep = true;
                } finally {
                    if (shouldMeasureReleaseSimulation) {
                        const releaseFixedEnd = performance.now();
                        recordReleaseSimulationFixedStep(
                            releaseFixedEnd,
                            releaseFixedEnd - releaseFixedStart,
                            completedReleaseFixedStep
                        );
                    }
                }
            }
            endPerformanceSection('frame.fixed.total', fixedTotalStart);
        }

        if (timeHandler && typeof timeHandler.setFixedInterpolationAlpha === 'function') {
            timeHandler.setFixedInterpolationAlpha(fixedAlpha);
        }

        if (executionPolicy.renderFrame) {
            const clearStart = beginPerformanceSection();
            this.displaySystem.drawHandler.clearAll();
            if (this.displaySystem.webGLHandler) {
                this.displaySystem.webGLHandler.clearAll();
            }
            endPerformanceSection('frame.clear', clearStart);
        }

        const updateStart = beginPerformanceSection();
        this.update(frameDeltaSeconds, executionPolicy);
        endPerformanceSection('frame.update.total', updateStart);

        if (executionPolicy.renderFrame) {
            const webGpuFrameStarted = this.displaySystem.beginWebGpuFrame?.() === true;
            let presentationCompleted = false;
            let webGpuPresentationAccepted = true;
            try {
                const drawStart = beginPerformanceSection();
                this.draw(executionPolicy);
                endPerformanceSection('frame.draw.total', drawStart);
                if (this.displaySystem.webGLHandler) {
                    const flushStart = beginPerformanceSection();
                    this.displaySystem.webGLHandler.flushAll();
                    endPerformanceSection('frame.flush.final', flushStart);
                }
                if (webGpuFrameStarted) {
                    const webGpuFinalizeStart = beginPerformanceSection();
                    const finalizeResult = this.sceneSystem?.finalizeWebGpuPresentation?.({
                        overlaySnapshots: this.overlayManager
                            ?.getTitleWebGpuPresentationSnapshots?.()
                    });
                    webGpuPresentationAccepted = finalizeResult !== false;
                    endPerformanceSection(
                        'frame.draw.webgpuPresentationFinalize',
                        webGpuFinalizeStart
                    );
                }
                presentationCompleted = webGpuPresentationAccepted;
            } finally {
                if (webGpuFrameStarted) {
                    if (!presentationCompleted) {
                        this.sceneSystem?.abortWebGpuPresentation?.(
                            'presentation-incomplete'
                        );
                    }
                    this.displaySystem.endWebGpuFrame?.(presentationCompleted);
                }
            }
        }
    }

    /**
     * 디스플레이 크기를 갱신하고 시뮬레이션 viewport 스냅샷을 동기화한 뒤 오브젝트, UI,
     * overlay, 활성 씬 순서로 resize를 전파합니다.
     * @returns {void}
     */
    resize() {
        this.displaySystem.resize();
        this.inputSystem?.refreshMousePosition?.();
        this.#syncSimulationRuntime();
        if (this.objectSystem && typeof this.objectSystem.resize === 'function') {
            this.objectSystem.resize();
        }
        if (this.uiSystem && typeof this.uiSystem.resize === 'function') {
            this.uiSystem.resize();
        }
        if (this.overlayManager) {
            this.overlayManager.resize();
        }
        if (this.sceneSystem && typeof this.sceneSystem.resize === 'function') {
            this.sceneSystem.resize();
        }
    }

    /**
     * 저장 직후 런타임 설정 변경을 관련 시스템에 즉시 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     * @returns {Promise<void>}
     */
    async applyRuntimeSettings(changedSettings = {}) {
        const changedKeys = Object.keys(changedSettings);
        if (changedKeys.length === 0) {
            return;
        }

        if (changedSettings.language !== undefined
            && this.uiSystem
            && typeof this.uiSystem.setLanguage === 'function') {
            this.uiSystem.setLanguage(changedSettings.language);
        }

        if (changedSettings.windowMode !== undefined
            && this.displaySystem?.screenHandler
            && typeof this.displaySystem.screenHandler.applyWindowMode === 'function') {
            await this.displaySystem.screenHandler.applyWindowMode();
        }

        if (changedSettings.bgmVolume !== undefined
            && this.soundSystem
            && typeof this.soundSystem.setBgmVolume === 'function') {
            this.soundSystem.setBgmVolume(changedSettings.bgmVolume);
        }

        if (changedSettings.inputBindings !== undefined
            && this.inputSystem
            && typeof this.inputSystem.setBindings === 'function') {
            this.inputSystem.setBindings(changedSettings.inputBindings);
        }

        if (this.overlayManager && typeof this.overlayManager.applyRuntimeSettings === 'function') {
            this.overlayManager.applyRuntimeSettings(changedSettings);
        }

        if (changedKeys.some((settingKey) => DISPLAY_REFRESH_SETTING_KEYS.has(settingKey))) {
            this.resize();
        }

        this.#syncSimulationRuntime();

        if (this.sceneSystem && typeof this.sceneSystem.applyRuntimeSettings === 'function') {
            this.sceneSystem.applyRuntimeSettings(changedSettings);
        }
    }

    /**
     * 실행 정책에 따라 time, sound, animation, input, UI, overlay, object, scene을 순서대로 갱신하고,
     * scene update 뒤 simulation command를 drain·적용한 다음 debug update를 수행합니다.
     * @param {number} [frameDeltaSeconds] 가변 프레임 델타(초)입니다.
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     * @returns {void}
     */
    update(frameDeltaSeconds, executionPolicy = this.frameExecutionPolicy) {
        const timeHandler = getTimeHandler();
        if (executionPolicy.runFrameTimeUpdate && timeHandler && typeof timeHandler.update === 'function') {
            const startTime = beginPerformanceSection();
            timeHandler.update(frameDeltaSeconds);
            endPerformanceSection('frame.update.time', startTime);
        }
        if (executionPolicy.runSoundUpdate) {
            const startTime = beginPerformanceSection();
            this.soundSystem.update();
            endPerformanceSection('frame.update.sound', startTime);
        }
        if (executionPolicy.runAnimationUpdate) {
            const startTime = beginPerformanceSection();
            this.animationSystem.update(FRAME_ANIMATION_UPDATE_OPTIONS);
            endPerformanceSection('frame.update.animation', startTime);
        }
        if (executionPolicy.runInputUpdate) {
            const startTime = beginPerformanceSection();
            this.inputSystem.update();
            endPerformanceSection('frame.update.input', startTime);
        }
        if (executionPolicy.runUiUpdate) {
            const startTime = beginPerformanceSection();
            this.uiSystem.update();
            endPerformanceSection('frame.update.ui', startTime);
        }
        if (executionPolicy.runOverlayUpdate) {
            const startTime = beginPerformanceSection();
            this.overlayManager.update();
            endPerformanceSection('frame.update.overlay', startTime);
        }
        if (executionPolicy.runObjectUpdate) {
            const startTime = beginPerformanceSection();
            this.objectSystem.update();
            endPerformanceSection('frame.update.object', startTime);
        }
        if (executionPolicy.runSceneUpdate) {
            const startTime = beginPerformanceSection();
            this.sceneSystem.update();
            endPerformanceSection('frame.update.scene', startTime);
        }
        if (executionPolicy.runSimulationCommandApply) {
            const drainedSimulationCommands = drainSimulationCommands();
            if (drainedSimulationCommands.length > 0
                && this.sceneSystem
                && typeof this.sceneSystem.applySimulationCommands === 'function') {
                const startTime = beginPerformanceSection();
                this.sceneSystem.applySimulationCommands(drainedSimulationCommands);
                endPerformanceSection('frame.update.simulationCommands', startTime);
            }
        }
        if (executionPolicy.runDebugUpdate) {
            const startTime = beginPerformanceSection();
            this.debugSystem.update();
            endPerformanceSection('frame.update.debug', startTime);
        }
    }

    /**
     * @private
     * 고정 시간 축에서 animation, object, scene, 선택적 game manager 순서로 갱신합니다.
     * @returns {void}
     */
    #runFixedStep() {
        const totalStart = beginPerformanceSection();
        if (this.animationSystem && typeof this.animationSystem.update === 'function') {
            const startTime = beginPerformanceSection();
            this.animationSystem.update(FIXED_ANIMATION_UPDATE_OPTIONS);
            endPerformanceSection('fixed.animation', startTime);
        }

        if (this.objectSystem
            && typeof this.objectSystem.fixedUpdate === 'function') {
            const startTime = beginPerformanceSection();
            this.objectSystem.fixedUpdate();
            endPerformanceSection('fixed.object', startTime);
        }

        if (this.sceneSystem
            && typeof this.sceneSystem.fixedUpdate === 'function') {
            const startTime = beginPerformanceSection();
            this.sceneSystem.fixedUpdate();
            endPerformanceSection('fixed.scene', startTime);
        }

        if (this.gameManager && typeof this.gameManager.fixedUpdate === 'function') {
            const startTime = beginPerformanceSection();
            this.gameManager.fixedUpdate();
            endPerformanceSection('fixed.gameManager', startTime);
        }
        endPerformanceSection('fixed.step.total', totalStart);
    }

    /**
     * input, object, scene을 그린 뒤 overlay backdrop 합성이 필요할 때만 중간 WebGL flush를 수행하고,
     * UI, vignette, overlay, release profiler HUD, debug, sound 순서로 렌더 명령을 발행합니다.
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     * @returns {void}
     */
    draw(executionPolicy = this.frameExecutionPolicy) {
        if (executionPolicy.renderInput) {
            const startTime = beginPerformanceSection();
            this.inputSystem.draw();
            endPerformanceSection('frame.draw.input', startTime);
        }
        if (executionPolicy.renderObject) {
            const startTime = beginPerformanceSection();
            this.objectSystem.draw();
            endPerformanceSection('frame.draw.object', startTime);
        }
        if (executionPolicy.renderScene) {
            const startTime = beginPerformanceSection();
            this.sceneSystem.draw();
            endPerformanceSection('frame.draw.scene', startTime);
        }
        // 오버레이(glass blur)가 하위 캔버스를 샘플링할 때만 중간 flush를 수행합니다.
        // 오버레이가 없을 때는 프레임 말미 flush만 사용해 불필요한 동기화를 줄입니다.
        const needsOverlayComposite = executionPolicy.renderOverlay
            && this.overlayManager?.requiresBackdropComposite?.();
        if (needsOverlayComposite && this.displaySystem.webGLHandler) {
            const startTime = beginPerformanceSection();
            this.displaySystem.webGLHandler.flushAll();
            endPerformanceSection('frame.flush.overlayComposite', startTime);
        }
        if (executionPolicy.renderUi) {
            const startTime = beginPerformanceSection();
            this.uiSystem.draw();
            endPerformanceSection('frame.draw.ui', startTime);
        }
        const vignetteStart = beginPerformanceSection();
        this.displaySystem.drawVignettes();
        endPerformanceSection('frame.draw.vignette', vignetteStart);
        if (executionPolicy.renderOverlay) {
            const startTime = beginPerformanceSection();
            this.overlayManager.draw();
            endPerformanceSection('frame.draw.overlay', startTime);
        }
        drawReleaseSimulationProfilerHud();
        if (executionPolicy.renderDebug) {
            const startTime = beginPerformanceSection();
            this.debugSystem.draw();
            endPerformanceSection('frame.draw.debug', startTime);
        }
        if (executionPolicy.renderSound) {
            const startTime = beginPerformanceSection();
            this.soundSystem.draw();
            endPerformanceSection('frame.draw.sound', startTime);
        }
        this.displaySystem.drawThemeTransition();
    }

    /**
     * 디버그 정지 프레임에 적용할 일회성 실행 정책을 반환합니다.
     * 입력·UI·오버레이·디버그와 렌더 정책은 현재 병합 정책을 그대로 유지합니다.
     * @param {'running'|'paused'|'step'} debugFrameMode - 현재 디버그 프레임 제어 상태입니다.
     * @returns {object} 이번 프레임에 사용할 실행 정책입니다.
     * @private
     */
    #resolveFrameExecutionPolicy(debugFrameMode) {
        const basePolicy = this.frameExecutionPolicy || DEFAULT_FRAME_EXECUTION_POLICY;
        if (debugFrameMode !== 'paused') {
            return basePolicy;
        }

        Object.assign(this.debugPausedFrameExecutionPolicy, basePolicy);
        for (const key of DEBUG_PAUSED_EXECUTION_DISABLE_KEYS) {
            this.debugPausedFrameExecutionPolicy[key] = false;
        }
        return this.debugPausedFrameExecutionPolicy;
    }

    /**
     * 디버그 정지 진입·해제 경계에서만 활성 씬의 presentation clock을 동기화합니다.
     * scene update 실행 여부와 무관하게 tick 초입에서 호출됩니다.
     * @param {'running'|'paused'|'step'} debugFrameMode - 정규화된 디버그 프레임 제어 상태입니다.
     * @returns {void}
     * @private
     */
    #synchronizeDebugPresentationPauseState(debugFrameMode) {
        const isPaused = debugFrameMode === 'paused';
        if (isPaused === this.debugPresentationPaused) {
            return;
        }

        this.debugPresentationPaused = isPaused;
        this.sceneSystem?.synchronizePresentation?.();
    }

    /**
     * @private
     * 활성화된 일시정지 이유들의 정책을 병합합니다.
     * @returns {object} 병합된 프레임 실행 정책입니다.
     */
    #buildFrameExecutionPolicy() {
        const mergedPolicy = this.createPausePolicy();

        for (const policy of this.pauseReasons.values()) {
            FRAME_EXECUTION_DISABLE_KEYS.forEach((key) => {
                if (policy[key] === false) {
                    mergedPolicy[key] = false;
                }
            });

            if (policy.pauseBgm === true) {
                mergedPolicy.pauseBgm = true;
            }
            if (policy.setMouseInactiveOnEnter === true) {
                mergedPolicy.setMouseInactiveOnEnter = true;
            }
        }

        return mergedPolicy;
    }

    /**
     * @private
     * 일시정지 정책에 따라 입력 초기화와 BGM 정지/재개를 반영합니다.
     */
    #applyPauseSideEffects() {
        if (!this.soundSystem) {
            return;
        }

        const shouldPauseBgm = this.frameExecutionPolicy.pauseBgm === true;
        if (typeof this.soundSystem.setRuntimeSuspended === 'function') {
            this.soundSystem.setRuntimeSuspended(shouldPauseBgm);
            return;
        }

        if (shouldPauseBgm) {
            this.soundSystem.pauseBgm();
            return;
        }

        void this.soundSystem.playBgm();
    }

    /**
     * @private
     * 메인 스레드의 최신 뷰포트/입력/설정을 시뮬레이션 런타임에 복제합니다.
     */
    #syncSimulationRuntime() {
        if (!this.displaySystem || !this.inputSystem || !this.saveSystem) {
            return;
        }

        const snapshot = this.simulationRuntimeSnapshot;
        this.#buildSimulationViewportSnapshot(snapshot.viewport);
        if (typeof this.inputSystem.getSimulationInputSnapshot === 'function') {
            this.inputSystem.getSimulationInputSnapshot(snapshot.input);
        }
        this.#buildSimulationSettingsSnapshot(snapshot.settings);
        syncSimulationRuntime(snapshot);
    }

    /**
     * @private
     * 시뮬레이션에 필요한 화면 정보를 추출합니다.
     * @param {object} [out={}] - 갱신할 재사용 스냅샷입니다.
     * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}}
     */
    #buildSimulationViewportSnapshot(out = {}) {
        const screenHandler = this.displaySystem?.screenHandler;
        if (!screenHandler) {
            out.ww = 0;
            out.wh = 0;
            out.objectWH = 0;
            out.objectOffsetY = 0;
            out.uiww = 0;
            out.uiOffsetX = 0;
            return out;
        }

        out.ww = screenHandler.width;
        out.wh = screenHandler.height;
        out.objectWH = screenHandler.objectHeight;
        out.objectOffsetY = screenHandler.objectOffsetY;
        out.uiww = screenHandler.uiWidth;
        out.uiOffsetX = screenHandler.uiOffsetX;
        return out;
    }

    /**
     * @private
     * 시뮬레이션 경로에서 참조하는 설정만 선별해 추출합니다.
     * @param {Record<string, any>} [settings={}] - 갱신할 재사용 설정 객체입니다.
     * @returns {Record<string, any>}
     */
    #buildSimulationSettingsSnapshot(settings = {}) {
        if (!this.saveSystem || typeof this.saveSystem.getSetting !== 'function') {
            return settings;
        }

        for (const key of SIMULATION_RUNTIME_SETTING_KEYS) {
            settings[key] = this.saveSystem.getSetting(key);
        }

        return settings;
    }
}
