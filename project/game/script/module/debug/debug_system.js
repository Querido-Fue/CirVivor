import { MouseDebugger } from "./_mouse_debugger.js";
import { ErrorHandler } from "./_error_handler.js";
import { PoolDebugger } from "./_pool_debug.js";
import { PerformanceDebugger } from "./_performance_debug.js";
import { getSetting } from "save/save_system.js";
import { runtimeTool } from "util/runtime_tool.js";

let debugSystemInstance = null;

/**
 * @class DebugSystem
 * @description 게임의 디버그 기능(성능, 마우스, 풀 디버깅 및 에러 핸들링)을 총괄하는 시스템입니다.
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
        this.performanceDebugger = new PerformanceDebugger();
        this.mouseDebugger = new MouseDebugger();
        this.poolDebugger = new PoolDebugger();
        this.performanceDebugger.setEnabled(getSetting('debugMode') === true);

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
            this.performanceDebugger.update();
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
            this.performanceDebugger.draw();
            this.mouseDebugger.draw();
            this.poolDebugger.draw();
        }
    }

    /**
     * 성능 프로파일링이 필요한지 반환합니다.
     * @returns {boolean} 디버그 모드에서만 true를 반환합니다.
     */
    shouldTrackPerformance() {
        return this.performanceDebugger?.isEnabled?.() === true;
    }

    /**
     * 지정한 섹션의 샘플을 기록합니다.
     * @param {string} sectionName - 기록할 섹션 이름입니다.
     * @param {number} durationMs - 기록할 소요 시간(ms)입니다.
     * @param {number} [timestamp=performance.now()] - 샘플 기록 시각(ms)입니다.
     */
    recordPerformanceSample(sectionName, durationMs, timestamp = performance.now()) {
        if (!this.shouldTrackPerformance()) {
            return;
        }

        this.performanceDebugger.recordSample(sectionName, durationMs, timestamp);
    }

    /**
     * 런타임 설정 변경 중 디버그 관련 변경을 즉시 반영합니다.
     * @param {object} [changedSettings={}] - 변경된 설정 키와 값입니다.
     */
    applyRuntimeSettings(changedSettings = {}) {
        if (changedSettings.debugMode === false) {
            this.performanceDebugger.setEnabled(false);
            return;
        }

        if (changedSettings.debugMode !== true) {
            return;
        }

        this.performanceDebugger.setEnabled(true);
        const tool = runtimeTool();
        if (tool && typeof tool.openDebugWindow === 'function') {
            tool.openDebugWindow();
        }
    }
}

export function errThrow(e, message, level) {
    debugSystemInstance.errorHandler.errThrow(e, message, level);
}

/**
 * 현재 활성화된 성능 디버거를 반환합니다.
 * @returns {PerformanceDebugger|null} 활성 성능 디버거입니다.
 */
export function getPerformanceDebugger() {
    return debugSystemInstance?.performanceDebugger || null;
}

/**
 * 지정한 섹션의 실행 시간을 자동으로 계측합니다.
 * @template T
 * @param {string} sectionName - 계측할 섹션 이름입니다.
 * @param {() => T} callback - 계측하며 실행할 콜백입니다.
 * @returns {T} 콜백 실행 결과입니다.
 */
export function measurePerformanceSection(sectionName, callback) {
    const performanceDebugger = getPerformanceDebugger();
    if (!performanceDebugger || !performanceDebugger.isEnabled()) {
        return callback();
    }

    return performanceDebugger.measureSection(sectionName, callback);
}
