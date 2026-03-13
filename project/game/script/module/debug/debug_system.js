import { MouseDebugger } from "./_mouse_debugger.js";
import { ErrorHandler } from "./_error_handler.js";
import { PoolDebugger } from "./_pool_debug.js";
import { getSetting } from "save/save_system.js";
import { runtimeTool } from "util/runtime_tool.js";

let debugSystemInstance = null;

/**
 * @class DebugSystem
 * @description 게임의 디버그 기능(마우스, 풀 디버깅 및 에러 핸들링)을 총괄하는 시스템입니다.
 */
export class DebugSystem {
    constructor() {
        debugSystemInstance = this;
    }

    /**
     * 디버그 시스템을 초기화합니다.
     * 에러 핸들러, 마우스 디버거, 풀 디버거를 생성합니다.
     */
    async init() {
        this.errorHandler = new ErrorHandler();
        this.mouseDebugger = new MouseDebugger();
        this.poolDebugger = new PoolDebugger();

        if (getSetting('debugMode')) {
            runtimeTool().openDebugWindow();
        }
    }

    /**
     * 디버그 정보를 업데이트합니다.
     * 디버그 모드가 켜져 있을 때만 동작합니다.
     */
    update() {
        if (getSetting('debugMode')) {
            this.mouseDebugger.update();
            this.poolDebugger.update();
        }
    }

    /**
     * 디버그 정보를 화면에 그립니다.
     * 디버그 모드가 켜져 있을 때만 동작합니다.
     */
    draw() {
        if (getSetting('debugMode')) {
            this.mouseDebugger.draw();
            this.poolDebugger.draw();
        }
    }

    /**
     * 런타임 설정 변경 중 디버그 관련 변경을 즉시 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.debugMode !== true) {
            return;
        }

        const tool = runtimeTool();
        if (tool && typeof tool.openDebugWindow === 'function') {
            tool.openDebugWindow();
        }
    }
}

export function errThrow(e, message, level) {
    debugSystemInstance.errorHandler.errThrow(e, message, level);
}
