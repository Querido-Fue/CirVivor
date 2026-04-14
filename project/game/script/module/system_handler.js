import { SaveSystem } from 'save/save_system.js';
import { DisplaySystem } from 'display/display_system.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { InputSystem } from 'input/input_system.js';
import { ObjectSystem } from 'object/object_system.js';
import { SceneSystem } from 'scene/scene_system.js';
import { UISystem } from 'ui/ui_system.js';
import { OverlayManager } from 'overlay/overlay_system.js';
import { DebugSystem, measurePerformanceSection } from 'debug/debug_system.js';
import { SoundSystem } from 'sound/sound_system.js';
import { getTimeHandler } from 'game/time_handler.js';
import { warmupUIPools } from 'ui/_ui_pool.js';
import { getData } from 'data/data_handler.js';
import { drainSimulationCommands } from 'simulation/simulation_command_queue.js';
import { getSimulationRuntimeSnapshot, syncSimulationRuntime } from 'simulation/simulation_runtime.js';
import { SimulationWorkerBridge } from 'simulation/simulation_worker_bridge.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const DISPLAY_REFRESH_SETTING_KEYS = new Set(['windowMode', 'widescreenSupport', 'renderScale']);
const SIMULATION_WORKER_SHADOW_SETTING_KEY = 'simulationWorkerShadowMode';
const SIMULATION_WORKER_PRESENTATION_SETTING_KEY = 'simulationWorkerPresentationMode';
const SIMULATION_WORKER_AUTHORITY_SETTING_KEY = 'simulationWorkerAuthorityMode';
const SIMULATION_RUNTIME_SETTING_KEYS = Object.freeze([
    'physicsAccuracy',
    SIMULATION_WORKER_SHADOW_SETTING_KEY,
    SIMULATION_WORKER_AUTHORITY_SETTING_KEY
]);
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
        this.lastAppliedSimulationCommands = [];
        this.simulationWorkerBridge = null;
        this.lastSimulationWorkerSceneState = null;
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

        // 11. 시뮬레이션 워커 브리지 초기화
        const enableSimulationWorkerShadow = this.#isSimulationWorkerShadowModeEnabled();
        const simulationWorkerBootstrapSnapshot = enableSimulationWorkerShadow
            ? this.createSimulationSnapshot()
            : null;
        this.simulationWorkerBridge = new SimulationWorkerBridge();
        this.simulationWorkerBridge.init({
            enabled: enableSimulationWorkerShadow,
            bootstrapSnapshot: simulationWorkerBootstrapSnapshot
        });
        this.lastSimulationWorkerSceneState = enableSimulationWorkerShadow
            ? (simulationWorkerBootstrapSnapshot?.scene?.sceneState ?? null)
            : null;
        this.logDebugInfo("SimulationWorkerBridge 로드");

        // 12. 풀 워밍업
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
     * 현재 시뮬레이션 워커 브리지 상태를 반환합니다.
     * @returns {{supported: boolean, enabled: boolean, running: boolean, ready: boolean, lastFrameId: number, lastAckFrameId: number, lastCommandCount: number, lastError: string|null, lastReadyAt: number, lastMessageAt: number, hasPresentationSnapshot: boolean, workerSnapshot: object|null}|null}
     */
    getSimulationWorkerStatus() {
        if (!this.simulationWorkerBridge || typeof this.simulationWorkerBridge.getStatusSnapshot !== 'function') {
            return null;
        }

        return this.simulationWorkerBridge.getStatusSnapshot();
    }

    /**
     * 현재 프레임 기준 워커 요청/활성 상태를 요약해 반환합니다.
     * @returns {{shadowEnabled: boolean, presentationEnabled: boolean, authorityRequested: boolean, authorityActive: boolean, presentationActive: boolean}}
     */
    getSimulationWorkerRuntimeStatus() {
        return {
            shadowEnabled: this.#isSimulationWorkerShadowModeEnabled(),
            presentationEnabled: this.#isSimulationWorkerPresentationModeEnabled(),
            authorityRequested: this.#isSimulationWorkerAuthorityModeEnabled(),
            authorityActive: this.#shouldUseSimulationWorkerAuthority(),
            presentationActive: this.#getSimulationWorkerPresentationScene() !== null
        };
    }

    /**
     * 워커 경계 전환을 위한 현재 시뮬레이션 스냅샷을 생성합니다.
     * @returns {{runtime: {viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}, settings: Record<string, any>}, scene: {sceneState: string, scene: object|null}|null}}
     */
    createSimulationSnapshot() {
        this.#syncSimulationRuntime();
        return {
            runtime: getSimulationRuntimeSnapshot(),
            scene: this.sceneSystem && typeof this.sceneSystem.createSimulationSnapshot === 'function'
                ? this.sceneSystem.createSimulationSnapshot()
                : null
        };
    }

    /**
     * 워커의 프레임 동기화용 동적 시뮬레이션 스냅샷을 생성합니다.
     * @returns {{runtime: {viewport: {ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}, input: {mousePos: {x: number, y: number}, mouseButtons: {left: string[], right: string[], middle: string[]}, focusList: string[], keys: Record<string, boolean>}, settings: Record<string, any>}, scene: {sceneState: string, scene: object|null}|null}}
     */
    createSimulationFrameSnapshot() {
        this.#syncSimulationRuntime();
        return {
            runtime: getSimulationRuntimeSnapshot(),
            scene: this.sceneSystem && typeof this.sceneSystem.createSimulationFrameSnapshot === 'function'
                ? this.sceneSystem.createSimulationFrameSnapshot()
                : null
        };
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
        this.lastAppliedSimulationCommands = [];
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
        const fixedAlpha = executionPolicy.runFixedStep && Number.isFinite(frameContext.fixedAlpha)
            ? frameContext.fixedAlpha
            : 0;

        if (fixedStepCount > 0) {
            measurePerformanceSection('frame.fixed.total', () => {
                for (let i = 0; i < fixedStepCount; i++) {
                    if (timeHandler && typeof timeHandler.updateFixed === 'function') {
                        measurePerformanceSection('fixed.time', () => {
                            timeHandler.updateFixed(fixedStepSeconds);
                        });
                    }
                    this.#runFixedStep();
                }
            });
        }

        if (timeHandler && typeof timeHandler.setFixedInterpolationAlpha === 'function') {
            timeHandler.setFixedInterpolationAlpha(fixedAlpha);
        }

        if (executionPolicy.renderFrame) {
            measurePerformanceSection('frame.clear', () => {
                this.displaySystem.drawHandler.clearAll();
                if (this.displaySystem.webGLHandler) {
                    this.displaySystem.webGLHandler.clearAll();
                }
            });
        }

        measurePerformanceSection('frame.update.total', () => {
            this.update(frameDeltaSeconds, executionPolicy);
        });

        if (this.simulationWorkerBridge && this.simulationWorkerBridge.isRunning()) {
            measurePerformanceSection('frame.update.simulationWorkerBridge', () => {
                this.#syncSimulationWorkerFrame(
                    {
                        frameDeltaSeconds,
                        fixedStepSeconds,
                        fixedStepCount,
                        fixedAlpha
                    },
                    executionPolicy
                );
            });
        } else {
            this.lastAppliedSimulationCommands = [];
        }

        if (executionPolicy.renderFrame) {
            measurePerformanceSection('frame.draw.total', () => {
                this.draw(executionPolicy);
            });
            if (this.displaySystem.webGLHandler) {
                measurePerformanceSection('frame.flush.final', () => {
                    this.displaySystem.webGLHandler.flushAll();
                });
            }
        }
    }

    /**
     * 화면 크기 변경 시 디스플레이 시스템을 갱신합니다.
     */
    resize() {
        this.displaySystem.resize();
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
        this.#refreshSimulationWorkerBridge();
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

        this.#syncSimulationRuntime();

        if (this.sceneSystem && typeof this.sceneSystem.applyRuntimeSettings === 'function') {
            this.sceneSystem.applyRuntimeSettings(changedSettings);
        }

        this.#refreshSimulationWorkerBridge();
    }

    /**
     * 모든 시스템의 업데이트 로직을 호출합니다.
     * @param {number} [frameDeltaSeconds] 가변 프레임 델타(초)
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     */
    update(frameDeltaSeconds, executionPolicy = this.frameExecutionPolicy) {
        const timeHandler = getTimeHandler();
        const useSimulationWorkerAuthority = this.#shouldUseSimulationWorkerAuthority();
        if (executionPolicy.runFrameTimeUpdate && timeHandler && typeof timeHandler.update === 'function') {
            measurePerformanceSection('frame.update.time', () => {
                timeHandler.update(frameDeltaSeconds);
            });
        }
        if (executionPolicy.runSoundUpdate) {
            measurePerformanceSection('frame.update.sound', () => {
                this.soundSystem.update();
            });
        }
        if (executionPolicy.runAnimationUpdate) {
            measurePerformanceSection('frame.update.animation', () => {
                this.animationSystem.update({ useFixedTick: false });
            });
        }
        if (executionPolicy.runInputUpdate) {
            measurePerformanceSection('frame.update.input', () => {
                this.inputSystem.update();
            });
        }
        if (executionPolicy.runUiUpdate) {
            measurePerformanceSection('frame.update.ui', () => {
                this.uiSystem.update();
            });
        }
        if (executionPolicy.runOverlayUpdate) {
            measurePerformanceSection('frame.update.overlay', () => {
                this.overlayManager.update();
            });
        }
        if (executionPolicy.runObjectUpdate && !useSimulationWorkerAuthority) {
            measurePerformanceSection('frame.update.object', () => {
                this.objectSystem.update();
            });
        }
        if (executionPolicy.runSceneUpdate) {
            measurePerformanceSection('frame.update.scene', () => {
                this.sceneSystem.update({
                    simulationWorkerAuthority: useSimulationWorkerAuthority
                });
            });
        }
        const drainedSimulationCommands = drainSimulationCommands();
        this.lastAppliedSimulationCommands = drainedSimulationCommands;
        if (!useSimulationWorkerAuthority
            && drainedSimulationCommands.length > 0
            && this.sceneSystem
            && typeof this.sceneSystem.applySimulationCommands === 'function') {
            measurePerformanceSection('frame.update.simulationCommands', () => {
                this.sceneSystem.applySimulationCommands(drainedSimulationCommands);
            });
        }
        if (!useSimulationWorkerAuthority
            && this.sceneSystem
            && typeof this.sceneSystem.consumeSimulationCommands === 'function') {
            const sceneSimulationCommands = this.sceneSystem.consumeSimulationCommands();
            if (Array.isArray(sceneSimulationCommands) && sceneSimulationCommands.length > 0) {
                this.lastAppliedSimulationCommands = [
                    ...this.lastAppliedSimulationCommands,
                    ...sceneSimulationCommands
                ];
            }
        }
        if (!useSimulationWorkerAuthority
            && this.objectSystem
            && typeof this.objectSystem.consumeSimulationCommands === 'function') {
            const objectSimulationCommands = this.objectSystem.consumeSimulationCommands();
            if (Array.isArray(objectSimulationCommands) && objectSimulationCommands.length > 0) {
                this.lastAppliedSimulationCommands = [
                    ...this.lastAppliedSimulationCommands,
                    ...objectSimulationCommands
                ];
            }
        }
        if (executionPolicy.runDebugUpdate) {
            measurePerformanceSection('frame.update.debug', () => {
                this.debugSystem.update();
            });
        }
    }

    /**
     * @private
     * 고정 스텝에서 실행되는 업데이트 로직입니다.
     * 물리/전투 등 고정 시간 축이 필요한 모듈만 갱신합니다.
     */
    #runFixedStep() {
        const useSimulationWorkerAuthority = this.#shouldUseSimulationWorkerAuthority();
        measurePerformanceSection('fixed.step.total', () => {
            if (this.animationSystem && typeof this.animationSystem.update === 'function') {
                measurePerformanceSection('fixed.animation', () => {
                    this.animationSystem.update({ useFixedTick: true });
                });
            }

            if (!useSimulationWorkerAuthority
                && this.objectSystem
                && typeof this.objectSystem.fixedUpdate === 'function') {
                measurePerformanceSection('fixed.object', () => {
                    this.objectSystem.fixedUpdate();
                });
            }

            if (!useSimulationWorkerAuthority
                && this.sceneSystem
                && typeof this.sceneSystem.fixedUpdate === 'function') {
                measurePerformanceSection('fixed.scene', () => {
                    this.sceneSystem.fixedUpdate();
                });
            }

            if (this.gameManager && typeof this.gameManager.fixedUpdate === 'function') {
                measurePerformanceSection('fixed.gameManager', () => {
                    this.gameManager.fixedUpdate();
                });
            }
        });
    }

    /**
     * 모든 시스템의 그리기 로직을 호출합니다.
     * @param {object} [executionPolicy=this.frameExecutionPolicy] - 현재 프레임 실행 정책입니다.
     */
    draw(executionPolicy = this.frameExecutionPolicy) {
        if (executionPolicy.renderInput) {
            measurePerformanceSection('frame.draw.input', () => {
                this.inputSystem.draw();
            });
        }
        const simulationWorkerPresentationScene = this.#getSimulationWorkerPresentationScene();
        const shouldDrawFromSimulationWorker = simulationWorkerPresentationScene
            && (executionPolicy.renderObject || executionPolicy.renderScene);

        if (shouldDrawFromSimulationWorker) {
            let drewFromSimulationWorker = false;
            measurePerformanceSection('frame.draw.simulationWorkerPresentation', () => {
                drewFromSimulationWorker = this.sceneSystem.drawSimulationSnapshot(
                    simulationWorkerPresentationScene,
                    {
                        renderEnemyObjects: executionPolicy.renderObject === true,
                        renderSceneObjects: executionPolicy.renderScene === true
                    }
                );
            });

            if (!drewFromSimulationWorker) {
                if (executionPolicy.renderObject) {
                    measurePerformanceSection('frame.draw.object', () => {
                        this.objectSystem.draw();
                    });
                }
                if (executionPolicy.renderScene) {
                    measurePerformanceSection('frame.draw.scene', () => {
                        this.sceneSystem.draw();
                    });
                }
            }
        } else {
            if (executionPolicy.renderObject) {
                measurePerformanceSection('frame.draw.object', () => {
                    this.objectSystem.draw();
                });
            }
            if (executionPolicy.renderScene) {
                measurePerformanceSection('frame.draw.scene', () => {
                    this.sceneSystem.draw();
                });
            }
        }
        // 오버레이(glass blur)가 하위 캔버스를 샘플링할 때만 중간 flush를 수행합니다.
        // 오버레이가 없을 때는 프레임 말미 flush만 사용해 불필요한 동기화를 줄입니다.
        const needsOverlayComposite = executionPolicy.renderOverlay && this.overlayManager?.hasAnyOverlay();
        if (needsOverlayComposite && this.displaySystem.webGLHandler) {
            measurePerformanceSection('frame.flush.overlayComposite', () => {
                this.displaySystem.webGLHandler.flushAll();
            });
        }
        if (executionPolicy.renderUi) {
            measurePerformanceSection('frame.draw.ui', () => {
                this.uiSystem.draw();
            });
        }
        measurePerformanceSection('frame.draw.vignette', () => {
            this.displaySystem.drawVignettes();
        });
        if (executionPolicy.renderOverlay) {
            measurePerformanceSection('frame.draw.overlay', () => {
                this.overlayManager.draw();
            });
        }
        if (executionPolicy.renderDebug) {
            measurePerformanceSection('frame.draw.debug', () => {
                this.debugSystem.draw();
            });
        }
        if (executionPolicy.renderSound) {
            measurePerformanceSection('frame.draw.sound', () => {
                this.soundSystem.draw();
            });
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

    /**
     * @private
     * 메인 스레드의 최신 뷰포트/입력/설정을 시뮬레이션 런타임에 복제합니다.
     */
    #syncSimulationRuntime() {
        if (!this.displaySystem || !this.inputSystem || !this.saveSystem) {
            return;
        }

        syncSimulationRuntime({
            viewport: this.#buildSimulationViewportSnapshot(),
            input: typeof this.inputSystem.getSimulationInputSnapshot === 'function'
                ? this.inputSystem.getSimulationInputSnapshot()
                : {},
            settings: this.#buildSimulationSettingsSnapshot()
        });
    }

    /**
     * @private
     * 시뮬레이션에 필요한 화면 정보를 추출합니다.
     * @returns {{ww: number, wh: number, objectWH: number, objectOffsetY: number, uiww: number, uiOffsetX: number}}
     */
    #buildSimulationViewportSnapshot() {
        const screenHandler = this.displaySystem?.screenHandler;
        if (!screenHandler) {
            return {
                ww: 0,
                wh: 0,
                objectWH: 0,
                objectOffsetY: 0,
                uiww: 0,
                uiOffsetX: 0
            };
        }

        return {
            ww: screenHandler.width,
            wh: screenHandler.height,
            objectWH: screenHandler.objectHeight,
            objectOffsetY: screenHandler.objectOffsetY,
            uiww: screenHandler.uiWidth,
            uiOffsetX: screenHandler.uiOffsetX
        };
    }

    /**
     * @private
     * 시뮬레이션 경로에서 참조하는 설정만 선별해 추출합니다.
     * @returns {Record<string, any>}
     */
    #buildSimulationSettingsSnapshot() {
        const settings = {};
        if (!this.saveSystem || typeof this.saveSystem.getSetting !== 'function') {
            return settings;
        }

        for (const key of SIMULATION_RUNTIME_SETTING_KEYS) {
            settings[key] = this.saveSystem.getSetting(key);
        }

        return settings;
    }

    /**
     * @private
     * 섀도우 시뮬레이션 워커 사용 여부를 설정에서 확인합니다.
     * @returns {boolean}
     */
    #isSimulationWorkerShadowModeEnabled() {
        return this.saveSystem?.getSetting?.(SIMULATION_WORKER_SHADOW_SETTING_KEY) === true;
    }

    /**
     * @private
     * 워커 프레젠테이션 스냅샷 기반 렌더링 사용 여부를 설정에서 확인합니다.
     * @returns {boolean}
     */
    #isSimulationWorkerPresentationModeEnabled() {
        return this.saveSystem?.getSetting?.(SIMULATION_WORKER_PRESENTATION_SETTING_KEY) === true;
    }

    /**
     * @private
     * 워커 권한 시뮬레이션 사용 여부를 설정에서 확인합니다.
     * @returns {boolean}
     */
    #isSimulationWorkerAuthorityModeEnabled() {
        return this.saveSystem?.getSetting?.(SIMULATION_WORKER_AUTHORITY_SETTING_KEY) === true;
    }

    /**
     * @private
     * 현재 프레임에서 워커를 권한 있는 시뮬레이터로 사용할 수 있는지 반환합니다.
     * @returns {boolean}
     */
    #shouldUseSimulationWorkerAuthority() {
        if (!this.#isSimulationWorkerAuthorityModeEnabled()) {
            return false;
        }
        if (!this.#isSimulationWorkerShadowModeEnabled() || !this.#isSimulationWorkerPresentationModeEnabled()) {
            return false;
        }
        if (!this.simulationWorkerBridge || !this.simulationWorkerBridge.isRunning()) {
            return false;
        }

        const bridgeStatus = this.simulationWorkerBridge.getStatusSnapshot?.() ?? null;
        if (bridgeStatus?.ready !== true || bridgeStatus?.hasPresentationSnapshot !== true) {
            return false;
        }

        const presentationSnapshot = this.simulationWorkerBridge.getPresentationSnapshot?.() ?? null;
        if (presentationSnapshot?.sceneState && presentationSnapshot.sceneState !== this.sceneSystem?.sceneState) {
            return false;
        }

        return presentationSnapshot?.scene?.sceneType === 'game'
            && this.sceneSystem?.sceneState === 'inGame';
    }

    /**
     * @private
     * 현재 프레임에서 사용할 워커 프레젠테이션 스냅샷을 반환합니다.
     * @returns {{sceneState?: string|null, scene?: object|null}|null}
     */
    #getSimulationWorkerPresentationScene() {
        if (!this.#isSimulationWorkerPresentationModeEnabled()) {
            return null;
        }

        if (!this.simulationWorkerBridge || !this.simulationWorkerBridge.isRunning()) {
            return null;
        }

        const bridgeStatus = this.simulationWorkerBridge.getStatusSnapshot?.() ?? null;
        if (bridgeStatus?.ready !== true || bridgeStatus?.hasPresentationSnapshot !== true) {
            return null;
        }

        const presentationSnapshot = this.simulationWorkerBridge.getPresentationSnapshot?.() ?? null;
        if (!presentationSnapshot || typeof presentationSnapshot !== 'object') {
            return null;
        }

        if (presentationSnapshot.sceneState && presentationSnapshot.sceneState !== this.sceneSystem?.sceneState) {
            return null;
        }

        return presentationSnapshot;
    }

    /**
     * @private
     * 현재 모드에 맞는 워커 프레임 스냅샷을 생성합니다.
     * 권한 모드에서는 런타임과 씬 상태 식별자만 전송하고, 실제 동적 상태는 워커가 유지합니다.
     * @param {boolean} useSimulationWorkerAuthority
     * @returns {{runtime: object, scene: {sceneState: string|null, scene: object|null}}}
     */
    #createSimulationWorkerFrameSnapshot(useSimulationWorkerAuthority) {
        if (!useSimulationWorkerAuthority) {
            return this.createSimulationFrameSnapshot();
        }

        this.#syncSimulationRuntime();
        return {
            runtime: getSimulationRuntimeSnapshot(),
            scene: {
                sceneState: this.sceneSystem?.sceneState ?? null,
                scene: null
            }
        };
    }

    /**
     * @private
     * 현재 프레임 상태를 시뮬레이션 워커로 전달합니다.
     * @param {object} frameContext
     * @param {object} executionPolicy
     */
    #syncSimulationWorkerFrame(frameContext, executionPolicy) {
        if (!this.simulationWorkerBridge || !this.simulationWorkerBridge.isRunning()) {
            this.lastAppliedSimulationCommands = [];
            return;
        }

        const useSimulationWorkerAuthority = this.#shouldUseSimulationWorkerAuthority();
        const frameSnapshot = this.#createSimulationWorkerFrameSnapshot(useSimulationWorkerAuthority);
        const currentSceneState = frameSnapshot.scene?.sceneState ?? null;
        if (currentSceneState !== this.lastSimulationWorkerSceneState) {
            this.simulationWorkerBridge.bootstrap(this.createSimulationSnapshot());
            this.lastSimulationWorkerSceneState = currentSceneState;
            this.lastAppliedSimulationCommands = [];
            return;
        }

        this.simulationWorkerBridge.syncFrame({
            frameContext,
            executionPolicy,
            frameSnapshot,
            commands: this.lastAppliedSimulationCommands
        });
        this.lastAppliedSimulationCommands = [];
    }

    /**
     * @private
     * 설정과 현재 씬 상태에 맞춰 시뮬레이션 워커 브리지를 재동기화합니다.
     */
    #refreshSimulationWorkerBridge() {
        if (!this.simulationWorkerBridge) {
            return;
        }

        const shouldEnableShadowWorker = this.#isSimulationWorkerShadowModeEnabled();
        if (!shouldEnableShadowWorker) {
            this.simulationWorkerBridge.setEnabled(false);
            this.lastSimulationWorkerSceneState = null;
            return;
        }

        const bootstrapSnapshot = this.createSimulationSnapshot();
        if (!this.simulationWorkerBridge.isRunning()) {
            this.simulationWorkerBridge.setEnabled(true, bootstrapSnapshot);
            this.lastSimulationWorkerSceneState = bootstrapSnapshot.scene?.sceneState ?? null;
            return;
        }

        this.simulationWorkerBridge.bootstrap(bootstrapSnapshot);
        this.lastSimulationWorkerSceneState = bootstrapSnapshot.scene?.sceneState ?? null;
    }
}
