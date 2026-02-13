import { FrameDebugger } from "./frame_debugger.js";
import { MouseDebugger } from "./mouse_debugger.js";
import { ErrorHandler } from "./error_handler.js";
import { getSetting } from "../save/_save_system.js";

let debugSystemInstance = null;

export class DebugSystem {
    constructor() {
        debugSystemInstance = this;
    }

    /**
     * 디버그 시스템을 초기화합니다.
     * 프레임 디버거, 에러 핸들러, 마우스 디버거를 생성합니다.
     */
    async init() {
        this.frameDebugger = new FrameDebugger();
        this.errorHandler = new ErrorHandler();
        this.mouseDebugger = new MouseDebugger();
    }

    /**
     * 디버그 정보를 업데이트합니다.
     * 디버그 모드가 켜져 있을 때만 동작합니다.
     */
    update() {
        if (getSetting('debugMode')) {
            this.frameDebugger.update();
            this.mouseDebugger.update();
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
        }
    }
}