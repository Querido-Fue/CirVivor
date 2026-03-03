import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { getSetting, setSetting } from 'save/save_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { isNwRuntime, nw } from 'util/nw_bridge.js';

/**
 * @class ScreenHandler
 * @description 창 모드/렌더 스케일 설정을 반영해 내부 해상도와 CSS 표시 영역을 계산합니다.
 */
export class ScreenHandler {
    constructor() {
        this.width = window.screen.width;
        this.height = window.screen.height;
        this.baseWidth = this.width;
        this.baseHeight = this.height;
        this.uiWidth = this.width;
        this.uiOffsetX = 0;
        this.viewportMode = 'native16by9';

        this.cssWidth = 0;
        this.cssHeight = 0;
        this.cssLeft = 0;
        this.cssTop = 0;
        this.scaleRatio = 1;
        this._nwScreenInited = false;
    }

    _toDevicePx(cssPx, scaleFactor) {
        const sf = (typeof scaleFactor === 'number' && Number.isFinite(scaleFactor) && scaleFactor > 0)
            ? scaleFactor
            : (window.devicePixelRatio || 1);
        return Math.max(1, Math.floor((cssPx * sf) + 1e-6));
    }

    _getNwDisplayMetrics() {
        if (!isNwRuntime() || !nw?.Screen) return null;

        try {
            if (!this._nwScreenInited) {
                nw.Screen.Init();
                this._nwScreenInited = true;
            }

            const screens = nw.Screen.screens || [];
            if (screens.length === 0) return null;

            const win = nw.Window.get();
            const winW = Math.max(1, window.innerWidth);
            const winH = Math.max(1, window.innerHeight);
            const centerX = (typeof win.x === 'number' ? win.x : 0) + (winW / 2);
            const centerY = (typeof win.y === 'number' ? win.y : 0) + (winH / 2);

            let current = screens.find((s) => {
                const b = s.bounds || {};
                return centerX >= b.x
                    && centerX < (b.x + b.width)
                    && centerY >= b.y
                    && centerY < (b.y + b.height);
            });

            if (!current) {
                current = screens[0];
            }

            const bounds = current.bounds || {};
            const workArea = current.work_area || current.workArea || bounds;
            const scaleFactor = (typeof current.scaleFactor === 'number' && current.scaleFactor > 0)
                ? current.scaleFactor
                : (window.devicePixelRatio || 1);

            return {
                scaleFactor,
                boundsWidthCss: Math.max(1, bounds.width || window.screen.width || 1),
                boundsHeightCss: Math.max(1, bounds.height || window.screen.height || 1),
                workWidthCss: Math.max(1, workArea.width || window.screen.availWidth || window.screen.width || 1),
                workHeightCss: Math.max(1, workArea.height || window.screen.availHeight || window.screen.height || 1)
            };
        } catch {
            return null;
        }
    }

    _recalculateRenderTarget(isNw, windowMode) {
        const gameRatio = GLOBAL_CONSTANTS.ASPECT_RATIO.RATIO;
        const renderScale = getSetting("renderScale") || 100;
        const scaleFactor = renderScale / 100;
        const nwDisplay = this._getNwDisplayMetrics();

        const displayScaleFactor = nwDisplay?.scaleFactor || window.devicePixelRatio || 1;
        const monitorWidthCss = nwDisplay?.boundsWidthCss || window.screen.width;
        const monitorHeightCss = nwDisplay?.boundsHeightCss || window.screen.height;
        const monitorWorkWidthCss = nwDisplay?.workWidthCss || window.screen.availWidth || window.screen.width;
        const monitorWorkHeightCss = nwDisplay?.workHeightCss || window.screen.availHeight || window.screen.height;

        const monitorWidth = this._toDevicePx(monitorWidthCss, displayScaleFactor);
        const monitorHeight = this._toDevicePx(monitorHeightCss, displayScaleFactor);
        const monitorWorkWidth = this._toDevicePx(monitorWorkWidthCss, displayScaleFactor);
        const monitorWorkHeight = this._toDevicePx(monitorWorkHeightCss, displayScaleFactor);
        const windowWidth = this._toDevicePx(window.innerWidth, displayScaleFactor);
        const windowHeight = this._toDevicePx(window.innerHeight, displayScaleFactor);

        const useMonitorSource = isNw && (windowMode === 'fullscreen' || windowMode === 'borderless');
        const sourceWidth = useMonitorSource ? monitorWidth : windowWidth;
        const sourceHeight = useMonitorSource ? monitorHeight : windowHeight;

        // 최대화 상태에서 OS 경계/반올림 오차로 1px 초과되는 값을 워크영역으로 캡핑합니다.
        const cappedSourceWidth = useMonitorSource ? sourceWidth : Math.min(sourceWidth, monitorWorkWidth);
        const cappedSourceHeight = useMonitorSource ? sourceHeight : Math.min(sourceHeight, monitorWorkHeight);

        const finalSourceWidth = Math.max(1, cappedSourceWidth);
        const finalSourceHeight = Math.max(1, cappedSourceHeight);
        const sourceRatio = finalSourceWidth / finalSourceHeight;

        let baseWidth;
        let baseHeight;
        let viewportMode;

        if (sourceRatio < gameRatio) {
            // 16:9보다 세로가 긴 화면: 상하 레터박스 유지
            baseWidth = finalSourceWidth;
            baseHeight = baseWidth / gameRatio;
            viewportMode = 'letterboxTall';
        } else {
            // 16:9 또는 그보다 가로가 긴 화면: 전체 화면 사용
            baseWidth = finalSourceWidth;
            baseHeight = finalSourceHeight;
            viewportMode = sourceRatio > gameRatio ? 'widescreen' : 'native16by9';
        }

        const nextBaseWidth = Math.max(1, Math.floor(baseWidth));
        const nextBaseHeight = Math.max(1, Math.floor(baseHeight));
        const nextWidth = Math.max(1, Math.floor(nextBaseWidth * scaleFactor));
        const nextHeight = Math.max(1, Math.floor(nextBaseHeight * scaleFactor));
        const nextUiWidth = Math.max(1, Math.floor(Math.min(nextWidth, nextHeight * gameRatio)));
        const nextUiOffsetX = (nextWidth - nextUiWidth) / 2;

        const changed = this.baseWidth !== nextBaseWidth
            || this.baseHeight !== nextBaseHeight
            || this.width !== nextWidth
            || this.height !== nextHeight
            || this.uiWidth !== nextUiWidth
            || this.uiOffsetX !== nextUiOffsetX
            || this.viewportMode !== viewportMode;

        this.baseWidth = nextBaseWidth;
        this.baseHeight = nextBaseHeight;
        this.width = nextWidth;
        this.height = nextHeight;
        this.uiWidth = nextUiWidth;
        this.uiOffsetX = nextUiOffsetX;
        this.viewportMode = viewportMode;

        return changed;
    }

    /**
     * @private
     * 화면 크기를 초기화합니다.
     */
    async _init() {
        const isNw = isNwRuntime();
        let windowMode = getSetting("windowMode") || (isNw ? 'fullscreen' : 'browserMode');
        const settingWidth = getSetting("width");
        const settingHeight = getSetting("height");

        if (!isNw && windowMode !== 'browserMode') {
            windowMode = 'browserMode';
            await setSetting("windowMode", "browserMode");
        }

        if (isNw) {
            runtimeTool().setZoomLevel(-1);

            const screenModeChanged = getSetting("screenModeChanged") || false;

            if (screenModeChanged) {
                runtimeTool().setFullScreen(false);
                runtimeTool().leaveKioskMode();

                await new Promise(resolve => setTimeout(resolve, 30));

                await setSetting("screenModeChanged", false);
            }

            if (windowMode === 'fullscreen') {
                runtimeTool().setFullScreen(true);
            } else if (windowMode === 'borderless') {
                runtimeTool().enterKioskMode();
            } else {
                // 창 모드에서는 매번 강제 크기 적용하지 않고, 모드 전환 직후에만 적용합니다.
                if (screenModeChanged) {
                    runtimeTool().setWindowSize(settingWidth, settingHeight);
                    runtimeTool().setWindowPositionCenter();
                }
            }

            // NW 창 상태 반영(전체화면/키오스크/창 전환) 직후 측정 오차를 줄이기 위해 한 프레임 대기
            await this._waitForWindowSettle();
        }

        this._recalculateRenderTarget(isNw, windowMode);
    }

    /**
     * 화면 크기 변경 시 호출되어 내부 해상도와 CSS 스타일을 다시 계산합니다.
     */
    resize() {
        const isNw = isNwRuntime();
        let windowMode = getSetting("windowMode") || (isNw ? 'fullscreen' : 'browserMode');
        if (!isNw) {
            windowMode = 'browserMode';
        }
        const renderTargetChanged = this._recalculateRenderTarget(isNw, windowMode);

        const windowWidth = Math.max(1, window.innerWidth);
        const windowHeight = Math.max(1, window.innerHeight);
        const windowRatio = windowWidth / windowHeight;
        const renderRatio = this.width / this.height;
        const epsilon = 0.0001;

        // CSS 표시 비율은 항상 내부 렌더 타깃 비율을 따라가야 늘어짐(stretch)이 발생하지 않습니다.
        if (windowRatio > renderRatio + epsilon) {
            this.cssHeight = windowHeight;
            this.cssWidth = this.cssHeight * renderRatio;
            this.cssTop = 0;
            this.cssLeft = (windowWidth - this.cssWidth) / 2;
        } else if (windowRatio < renderRatio - epsilon) {
            this.cssWidth = windowWidth;
            this.cssHeight = this.cssWidth / renderRatio;
            this.cssLeft = 0;
            this.cssTop = (windowHeight - this.cssHeight) / 2;
        } else {
            this.cssWidth = windowWidth;
            this.cssHeight = windowHeight;
            this.cssLeft = 0;
            this.cssTop = 0;
        }

        this.scaleRatio = this.width / Math.max(1, this.cssWidth);
        return renderTargetChanged;
    }

    /**
     * 화면 너비를 반환합니다.
     * @returns {number} 너비
     */
    get WW() {
        return this.width;
    }

    /**
     * 화면 높이를 반환합니다.
     * @returns {number} 높이
     */
    get WH() {
        return this.height;
    }

    /**
     * UI 크기 계산에 사용하는 16:9 기준 가상 너비를 반환합니다.
     * 와이드 화면에서는 WH * 16/9 값으로 고정되어 UI 체감 크기를 유지합니다.
     * @returns {number} UI 기준 너비
     */
    get UIWW() {
        return this.uiWidth;
    }

    /**
     * UI 기준 영역이 실제 렌더 타깃에서 시작하는 X 오프셋을 반환합니다.
     * @returns {number} X 오프셋
     */
    get UIOffsetX() {
        return this.uiOffsetX;
    }

    /**
     * 창 모드 전환 직후 NW.js 레이아웃이 안정화될 시간을 확보합니다.
     * @returns {Promise<void>}
     */
    _waitForWindowSettle() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }
}
