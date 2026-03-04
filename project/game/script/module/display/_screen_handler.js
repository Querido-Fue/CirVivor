import { getData } from 'data/data_handler.js';
import { getSetting, setSetting } from 'save/save_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { isNwRuntime, nw } from 'util/nw_bridge.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');

/**
 * @class ScreenHandler
 * @description 창 모드/렌더 스케일 설정을 반영해 내부 해상도와 CSS 표시 영역을 계산합니다.
 */
export class ScreenHandler {
    #nwScreenInited = false;

    constructor() {
        this.width = window.screen.width;
        this.height = window.screen.height;
        this.baseWidth = this.width;
        this.baseHeight = this.height;
        this.objectHeight = this.height;
        this.objectOffsetY = 0;
        this.uiWidth = this.width;
        this.uiOffsetX = 0;
        this.viewportMode = 'native16by9';

        this.cssWidth = 0;
        this.cssHeight = 0;
        this.cssLeft = 0;
        this.cssTop = 0;
        this.scaleRatio = 1;
    }

    /**
         * 논리 픽셀을 디바이스 화면 배율이 적용된 물리 픽셀로 변환합니다.
         * @param {number} cssPx 변환할 CSS 픽셀 값
         * @param {number} [scaleFactor] 적용할 스케일 배율 (생략 시 devicePixelRatio 사용)
         * @returns {number} 디바이스 픽셀로 변환된 값
         */
    #toDevicePx(cssPx, scaleFactor) {
        const sf = (typeof scaleFactor === 'number' && Number.isFinite(scaleFactor) && scaleFactor > 0)
            ? scaleFactor
            : (window.devicePixelRatio || 1);
        return Math.max(1, Math.floor((cssPx * sf) + 1e-6));
    }

    /**
         * 데스크톱 앱(NW.js 환경)일 경우 활성 디스플레이의 해상도 수치를 반환합니다.
         * @returns {object|null} 디스플레이 메트릭스 또는 확인 불가 시 null
         */
    #getNwDisplayMetrics() {
        if (!isNwRuntime() || !nw?.Screen) return null;

        try {
            if (!this.#nwScreenInited) {
                nw.Screen.Init();
                this.#nwScreenInited = true;
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

    /**
         * 현재 화면 모드 상태 및 디스플레이 크기를 기준으로 내부 렌더 타깃을 재계산합니다.
         * @param {boolean} isNw NW.js 환경인지 여부
     * @param {string} windowMode 화면 모드 상태 ('fullscreen' | 'windowed')
     * @returns {boolean} 설정 변경 여부 (재렌더링 필요 시 true 반환)
     */
    #recalculateRenderTarget(isNw, windowMode) {
        const gameRatio = GLOBAL_CONSTANTS.ASPECT_RATIO.RATIO;
        const renderScale = getSetting("renderScale") || 100;
        const widescreenSupport = getSetting("widescreenSupport") !== false;
        const scaleFactor = renderScale / 100;
        const nwDisplay = this.#getNwDisplayMetrics();

        const displayScaleFactor = nwDisplay?.scaleFactor || window.devicePixelRatio || 1;
        const monitorWidthCss = nwDisplay?.boundsWidthCss || window.screen.width;
        const monitorHeightCss = nwDisplay?.boundsHeightCss || window.screen.height;
        const monitorWorkWidthCss = nwDisplay?.workWidthCss || window.screen.availWidth || window.screen.width;
        const monitorWorkHeightCss = nwDisplay?.workHeightCss || window.screen.availHeight || window.screen.height;

        const monitorWidth = this.#toDevicePx(monitorWidthCss, displayScaleFactor);
        const monitorHeight = this.#toDevicePx(monitorHeightCss, displayScaleFactor);
        const monitorWorkWidth = this.#toDevicePx(monitorWorkWidthCss, displayScaleFactor);
        const monitorWorkHeight = this.#toDevicePx(monitorWorkHeightCss, displayScaleFactor);
        const windowWidth = this.#toDevicePx(window.innerWidth, displayScaleFactor);
        const windowHeight = this.#toDevicePx(window.innerHeight, displayScaleFactor);

        const useMonitorSource = isNw && (windowMode === 'fullscreen');
        const sourceWidth = useMonitorSource ? monitorWidth : windowWidth;
        const sourceHeight = useMonitorSource ? monitorHeight : windowHeight;

        const isWindowedNw = isNw && windowMode === 'windowed';
        const nearWorkAreaWidth = Math.abs(sourceWidth - monitorWorkWidth) <= 2;
        const nearWorkAreaHeight = Math.abs(sourceHeight - monitorWorkHeight) <= 2;
        const shouldClampWindowedWorkArea = isWindowedNw && (nearWorkAreaWidth || nearWorkAreaHeight);

        // 창 모드에서 작업영역 경계 근처(최대화/OS 경계 오차)일 때만 캡핑합니다.
        const cappedSourceWidth = useMonitorSource
            ? sourceWidth
            : (shouldClampWindowedWorkArea ? Math.min(sourceWidth, monitorWorkWidth) : sourceWidth);
        const cappedSourceHeight = useMonitorSource
            ? sourceHeight
            : (shouldClampWindowedWorkArea ? Math.min(sourceHeight, monitorWorkHeight) : sourceHeight);

        const finalSourceWidth = Math.max(1, cappedSourceWidth);
        const finalSourceHeight = Math.max(1, cappedSourceHeight);
        const sourceRatio = finalSourceWidth / finalSourceHeight;

        let baseWidth;
        let baseHeight;
        let viewportMode;

        if (!widescreenSupport) {
            if (sourceRatio < gameRatio) {
                // 16:9보다 세로가 긴 화면: 상하 레터박스
                baseWidth = finalSourceWidth;
                baseHeight = baseWidth / gameRatio;
                viewportMode = 'letterboxTall';
            } else {
                // 16:9보다 가로가 긴 화면: 좌우 레터박스
                baseHeight = finalSourceHeight;
                baseWidth = baseHeight * gameRatio;
                viewportMode = 'letterboxWide';
            }
        } else if (sourceRatio < gameRatio) {
            // 16:9보다 세로가 긴 화면: 상하 레터박스 유지
            baseWidth = finalSourceWidth;
            baseHeight = baseWidth / gameRatio;
            viewportMode = 'letterboxTall';
        } else {
            // 16:9 또는 그보다 가로가 긴 화면: 전체 화면 사용(와이드 확장)
            baseWidth = finalSourceWidth;
            baseHeight = finalSourceHeight;
            viewportMode = sourceRatio > gameRatio ? 'widescreen' : 'native16by9';
        }

        const nextBaseWidth = Math.max(1, Math.floor(baseWidth));
        const nextBaseHeight = Math.max(1, Math.floor(baseHeight));
        const nextWidth = Math.max(1, Math.floor(nextBaseWidth * scaleFactor));
        const nextHeight = Math.max(1, Math.floor(nextBaseHeight * scaleFactor));
        const isWidescreen = viewportMode === 'widescreen';
        const nextObjectHeight = isWidescreen
            ? Math.max(1, Math.floor(nextWidth / gameRatio))
            : nextHeight;
        const nextObjectOffsetY = isWidescreen
            ? (nextObjectHeight - nextHeight) / 2
            : 0;
        const nextUiWidth = Math.max(1, Math.floor(Math.min(nextWidth, nextHeight * gameRatio)));
        const nextUiOffsetX = (nextWidth - nextUiWidth) / 2;

        const changed = this.baseWidth !== nextBaseWidth
            || this.baseHeight !== nextBaseHeight
            || this.width !== nextWidth
            || this.height !== nextHeight
            || this.objectHeight !== nextObjectHeight
            || this.objectOffsetY !== nextObjectOffsetY
            || this.uiWidth !== nextUiWidth
            || this.uiOffsetX !== nextUiOffsetX
            || this.viewportMode !== viewportMode;

        this.baseWidth = nextBaseWidth;
        this.baseHeight = nextBaseHeight;
        this.width = nextWidth;
        this.height = nextHeight;
        this.objectHeight = nextObjectHeight;
        this.objectOffsetY = nextObjectOffsetY;
        this.uiWidth = nextUiWidth;
        this.uiOffsetX = nextUiOffsetX;
        this.viewportMode = viewportMode;

        return changed;
    }

    /**
     * 화면 크기를 초기화합니다.
     */
    async init() {
        const isNw = isNwRuntime();
        let windowMode = getSetting("windowMode") || (isNw ? 'fullscreen' : 'windowed');
        const settingWidth = getSetting("width");
        const settingHeight = getSetting("height");

        if (!isNw && windowMode !== 'windowed') {
            windowMode = 'windowed';
            await setSetting("windowMode", "windowed");
        }

        if (isNw) {
            runtimeTool().setZoomLevel(windowMode === 'fullscreen' ? -1 : 0);

            const screenModeChanged = getSetting("screenModeChanged") || false;

            if (screenModeChanged) {
                runtimeTool().setFullScreen(false);

                await new Promise(resolve => setTimeout(resolve, 30));

                await setSetting("screenModeChanged", false);
            }

            if (windowMode === 'fullscreen') {
                runtimeTool().setFullScreen(true);
            }

            // NW 창 상태 반영(전체화면/창 전환) 직후 측정 오차를 줄이기 위해 한 프레임 대기
            await this.#waitForWindowSettle();
        }

        this.#recalculateRenderTarget(isNw, windowMode);
    }

    /**
     * 화면 크기 변경 시 호출되어 내부 해상도와 CSS 스타일을 다시 계산합니다.
     */
    resize() {
        const isNw = isNwRuntime();
        let windowMode = getSetting("windowMode") || (isNw ? 'fullscreen' : 'windowed');
        if (!isNw) {
            windowMode = 'windowed';
        }
        const renderTargetChanged = this.#recalculateRenderTarget(isNw, windowMode);

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
     * 오브젝트(월드) 렌더링에 사용하는 논리 높이를 반환합니다.
     * 와이드 화면에서는 16:9 기준으로 확장된 높이를 사용하여 상하를 크롭합니다.
     * @returns {number} 오브젝트 기준 높이
     */
    get ObjectWH() {
        return this.objectHeight;
    }

    /**
     * 오브젝트 렌더링 시 화면 중심 크롭을 위한 Y 오프셋을 반환합니다.
     * @returns {number} 오브젝트 Y 오프셋
     */
    get ObjectOffsetY() {
        return this.objectOffsetY;
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
    #waitForWindowSettle() {
        return new Promise((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    }

    /**
     * 창 모드에서 목표 내부 해상도(innerWidth/innerHeight)에 맞도록 NW 창 크기를 보정합니다.
     * @param {number} targetWidth 목표 내부 너비(CSS px)
     * @param {number} targetHeight 목표 내부 높이(CSS px)
     * @returns {Promise<void>}
     */
    async #fitWindowedInnerSize(targetWidth, targetHeight) {
        if (!isNwRuntime() || !nw?.Window) return;

        const desiredW = Math.max(1, Math.floor(targetWidth || 1));
        const desiredH = Math.max(1, Math.floor(targetHeight || 1));
        const win = nw.Window.get();

        for (let attempt = 0; attempt < 4; attempt++) {
            const currentW = Math.max(1, Math.round(window.innerWidth));
            const currentH = Math.max(1, Math.round(window.innerHeight));
            const diffW = desiredW - currentW;
            const diffH = desiredH - currentH;

            if (Math.abs(diffW) <= 1 && Math.abs(diffH) <= 1) {
                return;
            }

            win.resizeTo(
                Math.max(320, Math.round(win.width + diffW)),
                Math.max(240, Math.round(win.height + diffH))
            );
            await this.#waitForWindowSettle();
        }
    }
}
