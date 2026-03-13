import { SaveSystem } from 'save/save_system.js';
import { DisplaySystem } from 'display/display_system.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { InputSystem } from 'input/input_system.js';
import { ObjectSystem } from 'object/object_system.js';
import { SceneSystem } from 'scene/scene_system.js';
import { UISystem } from 'ui/ui_system.js';
import { OverlayManager } from 'overlay/overlay_system.js';
import { DebugSystem } from 'debug/debug_system.js';
import { SoundSystem } from 'sound/sound_system.js';
import { getTimeHandler } from 'game/time_handler.js';
import { warmupUIPools } from 'ui/_ui_pool.js';
import { getData } from 'data/data_handler.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const DISPLAY_REFRESH_SETTING_KEYS = new Set(['windowMode', 'widescreenSupport', 'renderScale']);
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

/**
 * @class SystemHandler
 * @description 게임의 핵심 서브 시스템(저장, 표시, 입력, UI, 씬 등)의 생성/초기화/업데이트 순서를 총괄합니다.
 */
export class SystemHandler {
    constructor() {
        this.pauseReasons = new Map();
        this.frameExecutionPolicy = this.createPausePolicy();
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
        this.logDebugInfo("AnimationSystem 로드");

        // 5. InputSystem (입력 초기화)
        this.inputSystem = new InputSystem();
        await this.inputSystem.init();
        this.logDebugInfo("InputSystem 로드");

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
            GLOBAL_CONSTANTS.POOL_WARMUP.CANVAS_2D,
            GLOBAL_CONSTANTS.POOL_WARMUP.CANVAS_WEBGL
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
        return hadReason !== isActive;
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
     * 매 프레임 실행되는 메인 틱 함수입니다.
     * 단일 루프에서 고정 스텝 처리 후 가변 업데이트/렌더를 순차 실행합니다.
     * @param {object} [frameContext={}] 프레임 컨텍스트
     * @param {number} [frameContext.frameDeltaSeconds] 가변 프레임 델타(초)
     * @param {number} [frameContext.fixedStepSeconds] 고정 스텝 델타(초)
     * @param {number} [frameContext.fixedStepCount] 이번 프레임에 처리할 고정 스텝 횟수
     * @param {number} [frameContext.fixedAlpha] 렌더 보간 계수(0~1)
     */
    tick(frameContext = {}) {
        const executionPolicy = this.frameExecutionPolicy || DEFAULT_FRAME_EXECUTION_POLICY;
        const timeHandler = getTimeHandler();
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
        const fixedAlpha = executionPolicy.runFixedStep && Number.isFinite(frameContext.fixedAlpha)
            ? frameContext.fixedAlpha
            : 0;

        for (let i = 0; i < fixedStepCount; i++) {
            if (timeHandler && typeof timeHandler.updateFixed === 'function') {
                timeHandler.updateFixed(fixedStepSeconds);
            }
            this.#runFixedStep();
        }

        if (timeHandler && typeof timeHandler.setFixedInterpolationAlpha === 'function') {
            timeHandler.setFixedInterpolationAlpha(fixedAlpha);
        }

        if (executionPolicy.renderFrame) {
            this.displaySystem.drawHandler.clearAll();
            if (this.displaySystem.webGLHandler) {
                this.displaySystem.webGLHandler.clearAll();
            }
        }

        this.update(frameDeltaSeconds, executionPolicy);

        if (executionPolicy.renderFrame) {
            this.draw(executionPolicy);
            if (this.displaySystem.webGLHandler) {
                this.displaySystem.webGLHandler.flushAll();
            }
        }
    }

    /**
     * 화면 크기 변경 시 디스플레이 시스템을 갱신합니다.
     */
    resize() {
        this.displaySystem.resize();
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

        if (this.overlayManager && typeof this.overlayManager.applyRuntimeSettings === 'function') {
            this.overlayManager.applyRuntimeSettings(changedSettings);
        }

        if (changedKeys.some((settingKey) => DISPLAY_REFRESH_SETTING_KEYS.has(settingKey))) {
            this.resize();
        }

        if (this.sceneSystem && typeof this.sceneSystem.applyRuntimeSettings === 'function') {
            this.sceneSystem.applyRuntimeSettings(changedSettings);
        }
    }

    /**
     * 모든 시스템의 업데이트 로직을 호출합니다.
     * @param {number} [frameDeltaSeconds] 가변 프레임 델타(초)
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     */
    update(frameDeltaSeconds, executionPolicy = this.frameExecutionPolicy) {
        const timeHandler = getTimeHandler();
        if (executionPolicy.runFrameTimeUpdate && timeHandler && typeof timeHandler.update === 'function') {
            timeHandler.update(frameDeltaSeconds);
        }
        if (executionPolicy.runSoundUpdate) {
            this.soundSystem.update();
        }
        if (executionPolicy.runAnimationUpdate) {
            this.animationSystem.update({ useFixedTick: false });
        }
        if (executionPolicy.runInputUpdate) {
            this.inputSystem.update();
        }
        if (executionPolicy.runUiUpdate) {
            this.uiSystem.update();
        }
        if (executionPolicy.runOverlayUpdate) {
            this.overlayManager.update();
        }
        if (executionPolicy.runObjectUpdate) {
            this.objectSystem.update();
        }
        if (executionPolicy.runSceneUpdate) {
            this.sceneSystem.update();
        }
        if (executionPolicy.runDebugUpdate) {
            this.debugSystem.update();
        }
    }

    /**
     * @private
     * 고정 스텝에서 실행되는 업데이트 로직입니다.
     * 물리/전투 등 고정 시간 축이 필요한 모듈만 갱신합니다.
     */
    #runFixedStep() {
        if (this.animationSystem && typeof this.animationSystem.update === 'function') {
            this.animationSystem.update({ useFixedTick: true });
        }

        if (this.objectSystem && typeof this.objectSystem.fixedUpdate === 'function') {
            this.objectSystem.fixedUpdate();
        }

        if (this.sceneSystem && typeof this.sceneSystem.fixedUpdate === 'function') {
            this.sceneSystem.fixedUpdate();
        }

        if (this.gameManager && typeof this.gameManager.fixedUpdate === 'function') {
            this.gameManager.fixedUpdate();
        }
    }

    /**
     * 모든 시스템의 그리기 로직을 호출합니다.
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     */
    draw(executionPolicy = this.frameExecutionPolicy) {
        if (executionPolicy.renderInput) {
            this.inputSystem.draw();
        }
        if (executionPolicy.renderObject) {
            this.objectSystem.draw();
        }
        if (executionPolicy.renderScene) {
            this.sceneSystem.draw();
        }
        // 오버레이(glass blur)가 하위 캔버스를 샘플링할 때만 중간 flush를 수행합니다.
        // 오버레이가 없을 때는 프레임 말미 flush만 사용해 불필요한 동기화를 줄입니다.
        const needsOverlayComposite = executionPolicy.renderOverlay && this.overlayManager?.hasAnyOverlay();
        if (needsOverlayComposite && this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.flushAll();
        }
        if (executionPolicy.renderUi) {
            this.uiSystem.draw();
        }
        this.displaySystem.drawVignettes();
        if (executionPolicy.renderOverlay) {
            this.overlayManager.draw();
        }
        if (executionPolicy.renderDebug) {
            this.debugSystem.draw();
        }
        if (executionPolicy.renderSound) {
            this.soundSystem.draw();
        }
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
}
