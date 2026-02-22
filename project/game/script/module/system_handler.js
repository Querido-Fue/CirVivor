import { SaveSystem } from 'save/_save_system.js';
import { DisplaySystem } from 'display/_display_system.js';
import { AnimationSystem } from 'animation/_animation_system.js';
import { InputSystem } from 'input/_input_system.js';
import { ObjectSystem } from 'object/_object_system.js';
import { SceneSystem } from 'scene/_scene_system.js';
import { UISystem } from 'ui/_ui_system.js';
import { DebugSystem } from 'debug/_debug_system.js';
import { getTimeHandler } from 'game/time_handler.js';

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
        this.logDebugInfo("SaveSystem");

        // 2. DisplaySystem (화면/WebGL 초기화 - 설정 의존)
        this.displaySystem = new DisplaySystem();
        await this.displaySystem.init();
        this.logDebugInfo("DisplaySystem");

        // 3. AnimationSystem (애니메이션 초기화)
        this.animationSystem = new AnimationSystem();
        await this.animationSystem.init();
        this.logDebugInfo("AnimationSystem");

        // 4. InputSystem (입력 초기화)
        this.inputSystem = new InputSystem();
        await this.inputSystem.init();
        this.logDebugInfo("InputSystem");

        // 5. UISystem (UI 초기화)
        this.uiSystem = new UISystem();
        await this.uiSystem.init();
        this.logDebugInfo("UISystem");

        // 6. ObjectSystem (오브젝트 초기화)
        this.objectSystem = new ObjectSystem();
        await this.objectSystem.init();
        this.logDebugInfo("ObjectSystem");

        // 7. SceneSystem (씬 초기화)
        this.sceneSystem = new SceneSystem();
        await this.sceneSystem.init();
        this.logDebugInfo("SceneSystem");

        // 8. DebugSystem (디버그 초기화)
        this.debugSystem = new DebugSystem();
        await this.debugSystem.init();
        this.logDebugInfo("DebugSystem");
        this.logDebugInfo("모든 모듈");
        delete this.loadTime;
    }

    logDebugInfo(loadedModule) {
        if (this.saveSystem.getSetting("debugMode")) {
            console.log("[" + (performance.now() - this.loadTime).toFixed(1) + "ms] " + loadedModule + " 로드 완료");
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
        this.uiSystem.draw(); // UI와 오버레이는 가장 상위에 그려져야 함 (Scene 내용 반영 위해)
        this.debugSystem.draw();
    }
}