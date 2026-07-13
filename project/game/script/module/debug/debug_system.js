import { consumeKeyboardPress } from 'input/input_system.js';
import { getSetting } from 'save/save_system.js';
import { AnimationDebugController } from './_animation_debug_controller.js';
import { ErrorHandler } from './_error_handler.js';
import { PerformanceDebugger } from './_performance_debug.js';
import { PoolDebugger } from './_pool_debug.js';

const DEBUG_CONTROL_OPTION_KEYS = new Set([
    'frameTime',
    'poolInfo',
    'hitboxes',
    'animationDebug'
]);

let debugSystemInstance = null;

/**
 * @class DebugSystem
 * @description 게임의 디버그 표시, 프레임 제어 및 에러 핸들링을 총괄하는 시스템입니다.
 */
export class DebugSystem {
    constructor() {
        debugSystemInstance = this;
        this.controlState = {
            frameTime: true,
            poolInfo: true,
            hitboxes: true,
            animationDebug: false
        };
        this.animationDebugController = new AnimationDebugController();
    }

    /**
     * 디버그 시스템을 초기화합니다.
     * 에러 핸들러, 성능 디버거, 풀 디버거를 생성합니다.
     */
    async init() {
        this.errorHandler = new ErrorHandler();
        this.performanceDebugger = new PerformanceDebugger();
        this.poolDebugger = new PoolDebugger();
        this.performanceDebugger.setEnabled(
            this._isDebugModeEnabled() && this.controlState.frameTime
        );
    }

    /**
     * 디버그 정보를 업데이트합니다.
     * 디버그 모드가 켜져 있을 때만 동작합니다.
     */
    update() {
        if (this._isDebugModeEnabled()) {
            if (this.controlState.frameTime) {
                this.performanceDebugger.update();
            }
            if (this.controlState.poolInfo) {
                this.poolDebugger.update();
            }
        }
    }

    /**
     * 디버그 정보를 화면에 그립니다.
     * 디버그 모드가 켜져 있을 때만 동작합니다.
     */
    draw() {
        if (this._isDebugModeEnabled()) {
            if (this.controlState.frameTime) {
                this.performanceDebugger.draw();
            }
            if (this.controlState.poolInfo) {
                this.poolDebugger.draw();
            }
        }
    }

    /**
     * 디버그 패널이 표시할 런타임 제어 상태를 반환합니다.
     * @returns {{frameTime:boolean, poolInfo:boolean, hitboxes:boolean, animationDebug:boolean}}
     */
    getControlState() {
        return { ...this.controlState };
    }

    /**
     * 디버그 패널의 개별 런타임 옵션을 변경합니다.
     * @param {'frameTime'|'poolInfo'|'hitboxes'|'animationDebug'} optionKey - 옵션 키입니다.
     * @param {boolean} enabled - 활성화 여부입니다.
     * @returns {boolean} 유효한 옵션이 변경되었는지 여부입니다.
     */
    setControlOption(optionKey, enabled) {
        if (!DEBUG_CONTROL_OPTION_KEYS.has(optionKey)) {
            return false;
        }

        const nextEnabled = enabled === true;
        this.controlState[optionKey] = nextEnabled;
        if (optionKey === 'frameTime') {
            this.performanceDebugger?.setEnabled?.(
                this._isDebugModeEnabled() && nextEnabled
            );
        } else if (optionKey === 'animationDebug') {
            this.animationDebugController.setEnabled(
                this._isDebugModeEnabled() && nextEnabled
            );
        }
        return true;
    }

    /**
     * App 스케줄러가 이번 rAF에 적용할 애니메이션 디버그 제어 상태를 준비합니다.
     * @returns {{mode:'running'|'paused'|'step'}} 프레임 제어 상태입니다.
     */
    prepareFrameControl() {
        return this.animationDebugController.prepareFrame(consumeKeyboardPress);
    }

    /**
     * 애니메이션 디버그가 현재 업데이트를 정지한 상태인지 반환합니다.
     * @returns {boolean} 정지 여부입니다.
     */
    isAnimationFramePaused() {
        return this.animationDebugController.isPaused();
    }

    /**
     * 지정한 표시 옵션이 현재 실제로 활성인지 반환합니다.
     * @param {'frameTime'|'poolInfo'|'hitboxes'|'animationDebug'} optionKey - 옵션 키입니다.
     * @returns {boolean} 디버그 모드와 옵션이 모두 켜져 있으면 true입니다.
     */
    isControlOptionActive(optionKey) {
        return this._isDebugModeEnabled() && this.controlState[optionKey] === true;
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
            this.controlState.animationDebug = false;
            this.animationDebugController.setEnabled(false);
            return;
        }

        if (changedSettings.debugMode !== true) {
            return;
        }

        this.performanceDebugger.setEnabled(this.controlState.frameTime);
        this.animationDebugController.setEnabled(this.controlState.animationDebug);
    }

    /**
     * 현재 디버그 모드 활성 여부를 반환합니다.
     * @returns {boolean} 디버그 모드 활성 여부입니다.
     * @private
     */
    _isDebugModeEnabled() {
        return getSetting('debugMode') === true;
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
 * 현재 디버그 시스템 인스턴스를 반환합니다.
 * @returns {DebugSystem|null} 디버그 시스템 인스턴스입니다.
 */
export function getDebugSystem() {
    return debugSystemInstance;
}

/**
 * 적 충돌 히트박스 표시 여부를 반환합니다.
 * @returns {boolean} 히트박스를 그려야 하면 true입니다.
 */
export function shouldShowHitboxes() {
    return debugSystemInstance?.isControlOptionActive?.('hitboxes') === true;
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

/**
 * 콜백을 만들지 않고 성능 구간 시작 시각을 반환합니다.
 * @returns {number} 프로파일러 비활성 시 -1, 활성 시 시작 시각입니다.
 */
export function beginPerformanceSection() {
    const performanceDebugger = getPerformanceDebugger();
    return performanceDebugger?.isEnabled?.() === true
        ? performance.now()
        : -1;
}

/**
 * beginPerformanceSection으로 시작한 구간을 기록합니다.
 * @param {string} sectionName - 기록할 섹션 이름입니다.
 * @param {number} startTime - 구간 시작 시각 또는 -1입니다.
 */
export function endPerformanceSection(sectionName, startTime) {
    if (!Number.isFinite(startTime) || startTime < 0) {
        return;
    }

    const performanceDebugger = getPerformanceDebugger();
    if (!performanceDebugger?.isEnabled?.()) {
        return;
    }

    const endTime = performance.now();
    performanceDebugger.recordSample(sectionName, endTime - startTime, endTime);
}
