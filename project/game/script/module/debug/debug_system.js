import { FrameDebugger } from "./_frame_debugger.js";
import { MouseDebugger } from "./_mouse_debugger.js";
import { ErrorHandler } from "./_error_handler.js";
import { PoolDebugger } from "./_pool_debug.js";
import { getSetting } from "save/save_system.js";
import { runtimeTool } from "util/runtime_tool.js";

let debugSystemInstance = null;

/**
 * @class DebugSystem
 * @description 게임의 디버그 기능(프레임, 마우스, 풀 디버깅 및 에러 핸들링)을 총괄하는 시스템입니다.
 */
export class DebugSystem {
    constructor() {
        debugSystemInstance = this;
    }

    /**
     * 디버그 시스템을 초기화합니다.
     * 프레임 디버거, 에러 핸들러, 마우스 디버거, 풀 디버거를 생성합니다.
     */
    async init() {
        this.frameDebugger = new FrameDebugger();
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
            this.frameDebugger.update();
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
            this.frameDebugger.draw();
            this.mouseDebugger.draw();
            this.poolDebugger.draw();
        }
    }
}

export function errThrow(e, message, level) {
    debugSystemInstance.errorHandler.errThrow(e, message, level);
}