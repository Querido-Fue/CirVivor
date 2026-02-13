import { SaveSystem } from './save/_save_system.js';
import { DisplaySystem } from './display/_display_system.js';
import { AnimationSystem } from './animation/_animation_system.js';
import { InputSystem } from './input/_input_system.js';
import { ObjectSystem } from './object/_object_system.js';
import { SceneSystem } from './scene/_scene_system.js';
import { UISystem } from './ui/_ui_system.js';
import { DebugSystem } from './debug/_debug_system.js';
import { getTimeHandler } from '../time_handler.js';
import { ThemeHandler, setTheme } from './display/theme_handler.js';

export class SystemHandler {
    constructor() {
        this.themeHandler = new ThemeHandler();
    }

    /**
     * 모든 시스템을 초기화합니다.
     * 각 시스템의 init 메서드를 순차적으로 호출하여 의존성을 보장합니다.
     */
    async init() {
        this.loadTime = performance.now().toFixed(1);
        this.themeHandler.init();
        this.saveSystem = new SaveSystem();
        await this.saveSystem.init();
        setTheme(this.saveSystem.getSetting("darkMode"));
        this.logDebugInfo("SaveSystem");
        this.displaySystem = new DisplaySystem();
        await this.displaySystem.init(this.saveSystem);
        this.logDebugInfo("DisplaySystem");
        this.animationSystem = new AnimationSystem();
        await this.animationSystem.init();
        this.logDebugInfo("AnimationSystem");
        this.inputSystem = new InputSystem();
        await this.inputSystem.init();
        this.logDebugInfo("InputSystem");
        this.uiSystem = new UISystem();
        await this.uiSystem.init();
        this.logDebugInfo("UISystem");
        this.objectSystem = new ObjectSystem();
        await this.objectSystem.init();
        this.logDebugInfo("ObjectSystem");
        this.sceneSystem = new SceneSystem();
        await this.sceneSystem.init();
        this.logDebugInfo("SceneSystem");
        this.debugSystem = new DebugSystem();
        await this.debugSystem.init();
        this.logDebugInfo("DebugSystem");
        this.logDebugInfo("SystemHandler");
        delete this.loadTime;
    }

    logDebugInfo(loadedModule) {
        if (this.saveSystem.getSetting("debugMode")) {
            console.log(loadedModule + " 로드 완료 | timestamp: " + (performance.now() - this.loadTime).toFixed(1) + "ms");
        }
    }

    /**
     * 매 프레임 실행되는 메인 틱 함수입니다.
     * 화면을 클리어하고 업데이트 및 그리기 로직을 수행합니다.
     */
    tick() {
        this.displaySystem.drawHandler.clearAll();
        getTimeHandler().markUpdateStart();
        this.update();
        getTimeHandler().markUpdateEnd();
        getTimeHandler().markDrawStart();
        this.draw();
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
        this.animationSystem._update();
        this.inputSystem._update();
        this.uiSystem.update();
        this.objectSystem.update();
        this.sceneSystem.update();
        this.debugSystem.update();
    }

    /**
     * 모든 시스템의 그리기 로직을 호출합니다.
     */
    draw() {
        //this.animationSystem.draw();
        this.inputSystem._draw();
        this.uiSystem.draw();
        this.objectSystem.draw();
        this.sceneSystem.draw();
        this.debugSystem.draw();
    }
}