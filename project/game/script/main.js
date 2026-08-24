
import { SystemHandler } from 'game/module/system_handler.js';
import { TimeHandler } from 'game/time_handler.js';
import { MathUtil } from 'util/math_util.js';
import { ColorUtil } from 'util/color_util.js';
import { RuntimeTool, runtimeTool } from 'util/runtime_tool.js';
import {
    countExcessFixedStepDebt,
    FixedStepCatchUpPolicy,
    restoreUncompletedFixedStepDebt
} from 'simulation/fixed_step_catch_up_policy.js';
import {
    isReleaseSimulationProfilerCollecting,
    recordReleaseSimulationFrame,
    resumeReleaseSimulationProfiler,
    shouldRecordReleaseSimulationForFrameMode,
    suspendReleaseSimulationProfiler
} from 'simulation/release_simulation_profiler.js';
import { advanceWebGLGpuTelemetryFrame } from 'display/webgl/_webgl_gpu_telemetry_state.js';

let systemHandler;
let Game;
const APP_PAUSE_REASONS = Object.freeze({
    APP_INACTIVE: 'app-inactive'
});
const APP_INACTIVE_PAUSE_POLICY = Object.freeze({
    keepLoopRunning: false,
    pauseBgm: true,
    resetInputOnEnter: true,
    setMouseInactiveOnEnter: true
});

/**
 * 게임의 메인 진입점입니다.
 * 리소스 로딩, 시스템 초기화, 게임 루프 시작을 담당합니다.
 */
window.onload = async () => {
    try {
        // 시간 핸들러 초기화
        new TimeHandler();

        // 유틸리티 클래스 초기화
        new MathUtil();
        new ColorUtil();
        new RuntimeTool();

        // 시스템 핸들러 초기화 및 모듈 로딩
        systemHandler = new SystemHandler();
        await systemHandler.init();

        // 게임 앱 인스턴스 생성 및 글로벌 변수 등록
        Game = new App(systemHandler);
        window.Game = Game;

        // 비동기 시스템 초기화 중 발생해 전달되지 못한 전체화면/zoom resize를
        // 첫 프레임 전에 현재 window metrics로 한 번 수렴시킵니다.
        Game.resize();

        // 단일 프레임 루프 시작 (고정 스텝 + 렌더 순차 처리)
        Game.start();
    } catch (e) {
        console.warn("게임 초기화 중 오류가 발생했습니다\n", e);
    }
}


/**
 * 창 크기 변경 시 호출되는 이벤트 핸들러입니다.
 * 게임 화면을 리로드하여 크기 변경에 대응합니다.
 */
window.addEventListener('resize', () => {
    if (Game) {
        Game.resize();
    }
});

/**
 * @class App
 * @description 게임의 최상위 애플리케이션 클래스입니다.
 * SystemHandler를 통해 게임의 전반적인 상태를 관리하고, 종료 로직을 수행합니다.
 */
export class App {
    /**
     * App 클래스의 생성자입니다.
     * @param {SystemHandler} systemHandler - 게임 시스템들을 관리하는 핸들러 인스턴스
     */
    constructor(systemHandler) {
        this.systemHandler = systemHandler;
        this.loopRequestId = null;
        this.running = false;
        this.forceCloseRequested = false;
        this.fixedStepSeconds = 1 / 60;
        this.maxFrameDeltaSeconds = 0.1;
        this.maximumRetainedFixedStepDebtSteps = 32;
        this.fixedStepCatchUpPolicy = new FixedStepCatchUpPolicy();
        this.lastFrameCpuSeconds = 0;
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = 0;
        this._boundLoop = this.loop.bind(this);
        this._boundWindowActivityChange = this._handleWindowActivityChange.bind(this);
        this._attachWindowActivityListeners();
    }

    /**
     * 커서와 창 비활성 pause 상태를 동기화한 뒤 현재 실행 정책이 허용하면 메인 루프를 시작합니다.
     * 강제 종료가 예약됐거나 정책이 루프 유지를 막으면 재개하지 않습니다.
     * @returns {void}
     */
    start() {
        if (this.forceCloseRequested) return;
        this._syncCursorPresentation();
        this._syncWindowActivityPauseState();
        if (!this.systemHandler.shouldKeepLoopRunning()) {
            return;
        }
        this.#resumeLoop();
    }

    /**
     * 다음 animation frame을 먼저 예약하고 frame delta를 보정·상한 처리한 뒤 디버그 pause/step과
     * 고정 스텝 catch-up 정책을 적용해 `SystemHandler.tick()`을 호출합니다. catch-up 상한을 넘은 정수
     * fixed debt는 bounded 창 안에서 보존하고 GPU backpressure로 완료되지 않은 예약 tick도
     * accumulator에 되돌린 뒤, 창을 넘은 정수 debt만 폐기합니다.
     * 프레임 오류와 무관하게 CPU·release profiler 표본을 마무리합니다.
     * @param {number} now - requestAnimationFrame에서 전달되는 현재 시각(ms)입니다.
     * @returns {void}
     */
    loop(now) {
        if (!this.running) return;
        advanceWebGLGpuTelemetryFrame();
        this.loopRequestId = requestAnimationFrame(this._boundLoop);
        const shouldMeasurePerformance = this.systemHandler?.debugSystem?.shouldTrackPerformance?.() === true;
        const shouldMeasureReleaseSimulation = isReleaseSimulationProfilerCollecting();
        const frameMeasureStart = performance.now();
        let rawFrameDeltaSeconds = 0;
        let fixedStepCount = 0;
        let droppedFixedStepCount = 0;
        let frameDeltaClampLossSeconds = 0;
        let debugFrameMode = 'running';
        let fixedStepBatchReceipt = normalizeFixedStepBatchReceipt(
            undefined,
            0
        );
        try {
            if (!Number.isFinite(this.lastFrameTimestamp) || this.lastFrameTimestamp <= 0) {
                this.lastFrameTimestamp = now;
            }

            rawFrameDeltaSeconds = (now - this.lastFrameTimestamp) / 1000;
            let frameDeltaSeconds = rawFrameDeltaSeconds;
            this.lastFrameTimestamp = now;

            if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) {
                frameDeltaSeconds = this.fixedStepSeconds;
            } else if (frameDeltaSeconds > this.maxFrameDeltaSeconds) {
                frameDeltaSeconds = this.maxFrameDeltaSeconds;
            }
            if (Number.isFinite(rawFrameDeltaSeconds) && rawFrameDeltaSeconds > frameDeltaSeconds) {
                frameDeltaClampLossSeconds = rawFrameDeltaSeconds - frameDeltaSeconds;
            }

            const debugFrameControl = this.systemHandler.prepareDebugFrameControl();
            debugFrameMode = debugFrameControl.mode;
            const shouldAdvanceFixedStep = this.systemHandler.shouldRunFixedStep();
            let fixedAlpha = 0;

            if (debugFrameMode === 'paused') {
                frameDeltaSeconds = 0;
                this.accumulatorSeconds = 0;
                this.fixedStepCatchUpPolicy.reset();
                fixedAlpha = 1;
            } else if (debugFrameMode === 'step') {
                frameDeltaSeconds = this.fixedStepSeconds;
                fixedStepCount = shouldAdvanceFixedStep ? 1 : 0;
                this.accumulatorSeconds = 0;
                this.fixedStepCatchUpPolicy.reset();
                fixedAlpha = 1;
            } else if (shouldAdvanceFixedStep) {
                this.accumulatorSeconds += frameDeltaSeconds;
                const maxFixedStepsThisFrame = this.fixedStepCatchUpPolicy.resolveMaxSteps(
                    this.lastFrameCpuSeconds,
                    rawFrameDeltaSeconds,
                    this.fixedStepSeconds
                );

                while (this.accumulatorSeconds >= this.fixedStepSeconds && fixedStepCount < maxFixedStepsThisFrame) {
                    this.accumulatorSeconds -= this.fixedStepSeconds;
                    fixedStepCount++;
                }

                fixedAlpha = Math.min(
                    1,
                    this.accumulatorSeconds / this.fixedStepSeconds
                );
            } else {
                this.accumulatorSeconds = 0;
                this.fixedStepCatchUpPolicy.reset();
                fixedAlpha = 1;
            }

            fixedStepBatchReceipt = normalizeFixedStepBatchReceipt(
                this.systemHandler.tick({
                frameDeltaSeconds,
                previousFrameCpuSeconds: this.lastFrameCpuSeconds,
                fixedStepSeconds: this.fixedStepSeconds,
                fixedStepCount,
                fixedAlpha,
                debugFrameMode
                }),
                fixedStepCount
            );
            if (debugFrameMode === 'running') {
                const intentionalPauseActive = !this.systemHandler
                    .shouldRunFixedStep();
                if (fixedStepBatchReceipt.intentionalPauseCount > 0
                    || intentionalPauseActive) {
                    this.accumulatorSeconds = 0;
                    this.fixedStepCatchUpPolicy.reset();
                } else if (fixedStepBatchReceipt.deferredBackpressureCount > 0) {
                    this.accumulatorSeconds = restoreUncompletedFixedStepDebt(
                        this.accumulatorSeconds,
                        fixedStepBatchReceipt.completedFixedStepCount
                            + fixedStepBatchReceipt.deferredBackpressureCount,
                        fixedStepBatchReceipt.completedFixedStepCount,
                        this.fixedStepSeconds
                    );
                }
                if (fixedStepBatchReceipt.intentionalPauseCount === 0
                    && !intentionalPauseActive) {
                    droppedFixedStepCount = countExcessFixedStepDebt(
                        this.accumulatorSeconds,
                        this.fixedStepSeconds,
                        this.maximumRetainedFixedStepDebtSteps
                    );
                    if (droppedFixedStepCount > 0) {
                        this.accumulatorSeconds = Math.max(
                            0,
                            this.accumulatorSeconds
                                - (droppedFixedStepCount * this.fixedStepSeconds)
                        );
                    }
                }
            }
        } catch (e) {
            console.warn("프레임 루프 중 오류가 발생했습니다\n", e);
        } finally {
            const frameWorkEnd = performance.now();
            const frameWorkCpuMs = Math.max(0, frameWorkEnd - frameMeasureStart);
            const shouldRecordReleaseFrame = shouldMeasureReleaseSimulation
                && shouldRecordReleaseSimulationForFrameMode(debugFrameMode);
            if (shouldRecordReleaseFrame) {
                recordReleaseSimulationFrame(
                    frameWorkEnd,
                    frameWorkCpuMs,
                    rawFrameDeltaSeconds,
                    fixedStepCount,
                    droppedFixedStepCount,
                    frameDeltaClampLossSeconds,
                    this.fixedStepSeconds,
                    this.fixedStepCatchUpPolicy.isCpuBound(),
                    fixedStepBatchReceipt.intentionalPauseCount
                );
            }
            const frameMeasureEnd = shouldRecordReleaseFrame
                ? performance.now()
                : frameWorkEnd;
            this.lastFrameCpuSeconds = Math.max(0, (frameMeasureEnd - frameMeasureStart) / 1000);
            if (shouldMeasurePerformance) {
                this.systemHandler?.debugSystem?.recordPerformanceSample(
                    'frame.cpu',
                    frameMeasureEnd - frameMeasureStart,
                    frameMeasureEnd
                );
            }
        }
    }

    /**
     * 실행 중인 메인 루프와 release profiler를 정지하고 예약된 frame 및 시간 누적 상태를 초기화합니다.
     * 이미 정지된 상태에서는 아무 작업도 하지 않습니다.
     * @returns {void}
     */
    stop() {
        if (!this.running) return;
        this.running = false;
        suspendReleaseSimulationProfiler();
        if (this.loopRequestId !== null) {
            cancelAnimationFrame(this.loopRequestId);
            this.loopRequestId = null;
        }
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = 0;
        this.lastFrameCpuSeconds = 0;
        this.fixedStepCatchUpPolicy.reset();
    }

    /**
     * 게임 화면 크기를 변경합니다.
     */
    resize() {
        this.systemHandler.resize();
    }

    /**
     * 지정한 이유의 일시정지 상태를 갱신합니다.
     * 추후 인게임 일시정지 메뉴도 같은 인터페이스로 연결할 수 있습니다.
     * @param {string} reasonKey - 일시정지 이유 식별자입니다.
     * @param {boolean} isActive - 이유 활성화 여부입니다.
     * @param {object} [policy={}] - 실행 정책 오버라이드입니다.
     */
    setPauseReason(reasonKey, isActive, policy = {}) {
        this.systemHandler.setPauseReason(reasonKey, isActive, policy);
        this._syncLoopExecutionState();
    }

    /**
     * 지정한 이유의 일시정지를 해제합니다.
     * @param {string} reasonKey - 해제할 일시정지 이유 식별자입니다.
     */
    clearPauseReason(reasonKey) {
        this.setPauseReason(reasonKey, false);
    }

    /**
     * 기본 실행 정책을 기반으로 새 일시정지 정책 객체를 만듭니다.
     * @param {object} [overrides={}] - 덮어쓸 실행 정책입니다.
     * @returns {object} 정규화된 일시정지 정책입니다.
     */
    createPausePolicy(overrides = {}) {
        return this.systemHandler.createPausePolicy(overrides);
    }

    /**
     * 특정 일시정지 이유가 활성 상태인지 반환합니다.
     * @param {string} reasonKey - 검사할 일시정지 이유 식별자입니다.
     * @returns {boolean} 활성 여부입니다.
     */
    isPauseReasonActive(reasonKey) {
        return this.systemHandler.isPauseReasonActive(reasonKey);
    }

    /**
     * 게임 종료를 시도합니다.
     * 종료 확인 오버레이를 열고, 생성할 수 없으면 저장 후 강제 종료 경로로 전환합니다.
     * @returns {boolean} 현재 창 닫기 요청을 애플리케이션이 처리했는지 여부입니다.
     */
    tryClose() {
        if (this.forceCloseRequested) {
            return false;
        }

        const overlayManager = this.systemHandler?.overlayManager;
        if (!overlayManager || typeof overlayManager.openExitOverlay !== 'function') {
            this.close();
            return true;
        }

        try {
            const overlayId = overlayManager.openExitOverlay();
            if (overlayId !== null && overlayId !== undefined) {
                return true;
            }
        } catch (e) {
            console.warn("종료 확인 오버레이를 여는 중 오류가 발생했습니다\n", e);
        }

        this.close();
        return true;
    }

    /**
     * 창 닫기 확인을 우회하고 실제 종료를 진행 중인지 반환합니다.
     * @returns {boolean} 강제 종료 진행 여부입니다.
     */
    shouldForceCloseWindow() {
        return this.forceCloseRequested;
    }

    /**
     * 게임을 종료합니다.
     * 모든 데이터 저장을 시도한 뒤 성공 여부와 관계없이 창을 닫습니다.
     */
    close() {
        if (this.forceCloseRequested) {
            return;
        }

        this.forceCloseRequested = true;
        this.stop();
        const closeWindow = () => {
            setTimeout(() => runtimeTool().closeWindow(), 100);
        };

        let savePromise;
        try {
            savePromise = this.systemHandler.saveSystem.saveAll();
        } catch (error) {
            console.warn('게임 종료 전 저장을 시작하지 못했습니다.', error);
            closeWindow();
            return;
        }

        Promise.resolve(savePromise)
            .catch((error) => {
                console.warn('게임 종료 전 저장에 실패했습니다.', error);
            })
            .finally(closeWindow);
    }

    /**
     * @private
     * 창 활성 상태 관련 이벤트 리스너를 등록합니다.
     */
    _attachWindowActivityListeners() {
        window.addEventListener('focus', this._boundWindowActivityChange);
        window.addEventListener('blur', this._boundWindowActivityChange);
        document.addEventListener('visibilitychange', this._boundWindowActivityChange);
    }

    /**
     * @private
     * 현재 창이 게임 진행이 가능한 활성 상태인지 반환합니다.
     * @returns {boolean} 창 활성 여부입니다.
     */
    _isWindowActive() {
        const isDocumentVisible = typeof document.hidden === 'boolean' ? !document.hidden : true;
        const hasDocumentFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
        return isDocumentVisible && hasDocumentFocus;
    }

    /**
     * @private
     * 현재 창 활성 상태를 공통 일시정지 이유에 반영합니다.
     */
    _syncWindowActivityPauseState() {
        const isWindowActive = this._isWindowActive();
        this.systemHandler.setPauseReason(
            APP_PAUSE_REASONS.APP_INACTIVE,
            !isWindowActive,
            APP_INACTIVE_PAUSE_POLICY
        );
    }

    /**
     * @private
     * 창 활성 상태 변경에 맞춰 루프 실행 여부를 동기화합니다.
     */
    _handleWindowActivityChange() {
        this._syncCursorPresentation();
        this._syncWindowActivityPauseState();
        this._syncLoopExecutionState();
    }

    /**
     * @private
     * 현재 창 활성 상태에 맞춰 시스템 커서와 UI 커서의 표시 방식을 전환합니다.
     */
    _syncCursorPresentation() {
        const isWindowActive = this._isWindowActive();
        const root = document.documentElement;
        if (root?.style) {
            root.style.cursor = isWindowActive ? 'none' : 'auto';
        }

        const uiSystem = this.systemHandler?.uiSystem;
        if (uiSystem && typeof uiSystem.setCursorVisible === 'function') {
            uiSystem.setCursorVisible(isWindowActive);
        }
    }

    /**
     * @private
     * 현재 실행 정책에 맞춰 프레임 루프를 정지하거나 재개합니다.
     */
    _syncLoopExecutionState() {
        if (this.forceCloseRequested) {
            return;
        }

        if (this.systemHandler.shouldKeepLoopRunning()) {
            this.#resumeLoop();
            return;
        }

        this.stop();
    }

    /**
     * @private
     * 시간·catch-up 상태를 초기화하고 release profiler를 재개한 뒤 첫 animation frame을 예약합니다.
     * 이미 실행 중이면 중복 frame을 예약하지 않습니다.
     * @returns {void}
     */
    #resumeLoop() {
        if (this.running) return;
        this.running = true;
        this.accumulatorSeconds = 0;
        this.lastFrameTimestamp = performance.now();
        this.lastFrameCpuSeconds = 0;
        this.fixedStepCatchUpPolicy.reset();
        resumeReleaseSimulationProfiler(this.lastFrameTimestamp);
        this.loopRequestId = requestAnimationFrame(this._boundLoop);
    }
}

function normalizeFixedStepBatchReceipt(source, requestedFixedStepCount) {
    const requested = Number.isInteger(requestedFixedStepCount)
        ? Math.max(0, requestedFixedStepCount)
        : 0;
    if (typeof source === 'number' && Number.isInteger(source)) {
        const completed = Math.min(requested, Math.max(0, source));
        return Object.freeze({
            requestedFixedStepCount: requested,
            completedFixedStepCount: completed,
            deferredBackpressureCount: requested - completed,
            intentionalPauseCount: 0,
            consumedFixedStepCount: completed
        });
    }
    if (!source || typeof source !== 'object') {
        return Object.freeze({
            requestedFixedStepCount: requested,
            completedFixedStepCount: requested,
            deferredBackpressureCount: 0,
            intentionalPauseCount: 0,
            consumedFixedStepCount: requested
        });
    }
    const completed = Number.isInteger(source.completedFixedStepCount)
        ? Math.min(requested, Math.max(0, source.completedFixedStepCount))
        : 0;
    const maximumDeferred = requested - completed;
    const deferred = Number.isInteger(source.deferredBackpressureCount)
        ? Math.min(maximumDeferred, Math.max(0, source.deferredBackpressureCount))
        : 0;
    const intentional = Number.isInteger(source.intentionalPauseCount)
        ? Math.min(
            requested - completed - deferred,
            Math.max(0, source.intentionalPauseCount)
        )
        : 0;
    return Object.freeze({
        requestedFixedStepCount: requested,
        completedFixedStepCount: completed,
        deferredBackpressureCount: deferred,
        intentionalPauseCount: intentional,
        consumedFixedStepCount: completed + intentional
    });
}
