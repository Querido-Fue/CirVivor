import { SaveSystem } from 'save/save_system.js';
import { DisplaySystem } from 'display/display_system.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { InputSystem } from 'input/input_system.js';
import { ObjectSystem } from 'object/object_system.js';
import { SceneSystem } from 'scene/scene_system.js';
import { UISystem } from 'ui/ui_system.js';
import { OverlaySystem } from 'overlay/overlay_system.js';
import { DebugSystem } from 'debug/debug_system.js';
import { SoundSystem } from 'sound/sound_system.js';
import { getTimeHandler } from 'game/time_handler.js';
import { warmupUIPools } from 'ui/_ui_pool.js';

/**
 * @class SystemHandler
 * @description 게임의 핵심 서브 시스템(저장, 표시, 입력, UI, 씬 등)의 생성/초기화/업데이트 순서를 총괄합니다.
 */
export class SystemHandler {
    constructor() { }
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
        this.sceneSystem = new SceneSystem();
        await this.sceneSystem.init();
        this.logDebugInfo("SceneSystem 로드");

        // 9. OverlaySystem (오버레이 초기화)
        this.overlaySystem = new OverlaySystem();
        await this.overlaySystem.init();
        this.logDebugInfo("OverlaySystem 로드");

        // 10. DebugSystem (디버그 초기화)
        this.debugSystem = new DebugSystem();
        await this.debugSystem.init();
        this.logDebugInfo("DebugSystem 로드");

        // 11. 풀 워밍업
        await this.animationSystem.warmup();
        warmupUIPools();
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
     * 매 프레임 실행되는 메인 틱 함수입니다.
     * 단일 루프에서 고정 스텝 처리 후 가변 업데이트/렌더를 순차 실행합니다.
     * @param {object} [frameContext={}] 프레임 컨텍스트
     * @param {number} [frameContext.frameDeltaSeconds] 가변 프레임 델타(초)
     * @param {number} [frameContext.fixedStepSeconds] 고정 스텝 델타(초)
     * @param {number} [frameContext.fixedStepCount] 이번 프레임에 처리할 고정 스텝 횟수
     * @param {number} [frameContext.fixedAlpha] 렌더 보간 계수(0~1)
     */
    tick(frameContext = {}) {
        const timeHandler = getTimeHandler();
        const frameDeltaSeconds = Number.isFinite(frameContext.frameDeltaSeconds) && frameContext.frameDeltaSeconds > 0
            ? frameContext.frameDeltaSeconds
            : undefined;
        const fixedStepSeconds = Number.isFinite(frameContext.fixedStepSeconds) && frameContext.fixedStepSeconds > 0
            ? frameContext.fixedStepSeconds
            : (timeHandler?.fixedStepSeconds ?? (1 / 60));
        const fixedStepCount = Number.isInteger(frameContext.fixedStepCount) && frameContext.fixedStepCount > 0
            ? frameContext.fixedStepCount
            : 0;
        const fixedAlpha = Number.isFinite(frameContext.fixedAlpha)
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

        this.displaySystem.drawHandler.clearAll();
        if (this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.clearAll();
        }
        this.update(frameDeltaSeconds);
        this.draw();
        if (this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.flushAll();
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
        if (this.overlaySystem) {
            this.overlaySystem.resize();
        }
        if (this.sceneSystem && typeof this.sceneSystem.resize === 'function') {
            this.sceneSystem.resize();
        }
    }

    /**
     * 모든 시스템의 업데이트 로직을 호출합니다.
     * @param {number} [frameDeltaSeconds] 가변 프레임 델타(초)
     */
    update(frameDeltaSeconds) {
        const timeHandler = getTimeHandler();
        if (timeHandler && typeof timeHandler.update === 'function') {
            timeHandler.update(frameDeltaSeconds);
        }
        this.soundSystem.update();
        this.animationSystem.update({ useFixedTick: false });
        this.inputSystem.update();
        this.uiSystem.update();
        this.overlaySystem.update();
        this.objectSystem.update();
        this.sceneSystem.update();
        this.debugSystem.update();
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
     */
    draw() {
        this.inputSystem.draw();
        this.objectSystem.draw();
        this.sceneSystem.draw();
        // 오버레이(glass blur)가 하위 캔버스를 샘플링할 때만 중간 flush를 수행합니다.
        // 오버레이가 없을 때는 프레임 말미 flush만 사용해 불필요한 동기화를 줄입니다.
        const needsOverlayComposite = this.overlaySystem?.activeOverlay || this.overlaySystem?.exitConfirmOverlay;
        if (needsOverlayComposite && this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.flushAll();
        }
        this.uiSystem.draw(); // UI는 Scene 내용 반영
        this.overlaySystem.draw(); // 오버레이는 가장 상위에 그려져야 함
        this.debugSystem.draw();
        this.soundSystem.draw();
    }
}
