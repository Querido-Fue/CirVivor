import { SaveSystem } from 'save/save_system.js';
import { DisplaySystem } from 'display/display_system.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { InputSystem } from 'input/input_system.js';
import { ObjectSystem } from 'object/object_system.js';
import { SceneSystem } from 'scene/scene_system.js';
import { UISystem } from 'ui/ui_system.js';
import { OverlaySystem } from 'overlay/overlay_system.js';
import { DebugSystem } from 'debug/debug_system.js';
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

        // 2. DisplaySystem (화면/WebGL 초기화 - 설정 의존)
        this.displaySystem = new DisplaySystem();
        await this.displaySystem.init();
        this.logDebugInfo("DisplaySystem 로드");

        // 3. AnimationSystem (애니메이션 초기화)
        this.animationSystem = new AnimationSystem();
        await this.animationSystem.init();
        this.logDebugInfo("AnimationSystem 로드");

        // 4. InputSystem (입력 초기화)
        this.inputSystem = new InputSystem();
        await this.inputSystem.init();
        this.logDebugInfo("InputSystem 로드");

        // 5. UISystem (UI 초기화)
        this.uiSystem = new UISystem();
        await this.uiSystem.init();
        this.logDebugInfo("UISystem 로드");

        // 6. ObjectSystem (오브젝트 초기화)
        this.objectSystem = new ObjectSystem();
        await this.objectSystem.init();
        this.logDebugInfo("ObjectSystem 로드");

        // 7. SceneSystem (씬 초기화)
        this.sceneSystem = new SceneSystem();
        await this.sceneSystem.init();
        this.logDebugInfo("SceneSystem 로드");

        // 8. OverlaySystem (오버레이 초기화)
        this.overlaySystem = new OverlaySystem();
        await this.overlaySystem.init();
        this.logDebugInfo("OverlaySystem 로드");

        // 9. DebugSystem (디버그 초기화)
        this.debugSystem = new DebugSystem();
        await this.debugSystem.init();
        this.logDebugInfo("DebugSystem 로드");

        // 10. 풀 워밍업
        await this.animationSystem._warmup();
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
     * 화면을 클리어하고 업데이트 및 그리기 로직을 수행합니다.
     */
    tick() {
        this.displaySystem.drawHandler.clearAll();
        if (this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.clearAll();
        }
        getTimeHandler().markUpdateStart();
        this.update();
        getTimeHandler().markUpdateEnd();
        getTimeHandler().markDrawStart();
        this.draw();
        if (this.displaySystem.webGLHandler) {
            this.displaySystem.webGLHandler.flushAll();
        }
        getTimeHandler().markDrawEnd();
    }

    /**
     * 화면 크기 변경 시 디스플레이 시스템을 갱신합니다.
     */
    resize() {
        this.displaySystem.resize();
    }

    /**
     * 모든 시스템의 업데이트 로직을 호출합니다.
     */
    update() {
        getTimeHandler().update();
        this.animationSystem.update();
        this.inputSystem.update();
        this.uiSystem.update();
        this.overlaySystem.update();
        this.objectSystem.update();
        this.sceneSystem.update();
        this.debugSystem.update();
    }

    /**
     * 모든 시스템의 고정 프레임 업데이트 로직을 호출합니다.
     */
    fixedUpdate() {
        getTimeHandler().fixedUpdate();
        this.animationSystem.fixedUpdate();
        this.objectSystem.fixedUpdate();
    }

    /**
     * 모든 시스템의 그리기 로직을 호출합니다.
     */
    draw() {
        this.inputSystem._draw();
        this.objectSystem.draw();
        this.sceneSystem.draw();
        this.uiSystem.draw(); // UI는 Scene 내용 반영
        this.overlaySystem.draw(); // 오버레이는 가장 상위에 그려져야 함
        this.debugSystem.draw();
    }
}
