import { GLOBAL_CONSTANTS } from 'data/global/global_constants.js';
import { getSetting, setSetting } from 'save/save_system.js';
import { runtimeTool } from 'util/runtime_tool.js';
import { isNwRuntime } from 'util/nw_bridge.js';

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

        this.cssWidth = 0;
        this.cssHeight = 0;
        this.cssLeft = 0;
        this.cssTop = 0;
        this.scaleRatio = 1;
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
        const renderScale = getSetting("renderScale") || 100;
        const scaleFactor = renderScale / 100;

        const monitorWidth = Math.max(1, Math.round(window.screen.width * window.devicePixelRatio));
        const monitorHeight = Math.max(1, Math.round(window.screen.height * window.devicePixelRatio));

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
                runtimeTool().setWindowSize(settingWidth, settingHeight);
                runtimeTool().setWindowPositionCenter();
            }
        }

        const gameRatio = GLOBAL_CONSTANTS.ASPECT_RATIO.RATIO;
        let baseWidth, baseHeight;
        const sourceWidth = isNw ? monitorWidth : Math.max(1, Math.round(window.innerWidth * window.devicePixelRatio));
        const sourceHeight = isNw ? monitorHeight : Math.max(1, Math.round(window.innerHeight * window.devicePixelRatio));

        if (sourceWidth / sourceHeight > gameRatio) {
            baseHeight = sourceHeight;
            baseWidth = baseHeight * gameRatio;
        } else {
            baseWidth = sourceWidth;
            baseHeight = baseWidth / gameRatio;
        }

        this.baseWidth = Math.floor(baseWidth);
        this.baseHeight = Math.floor(baseHeight);

        this.width = Math.floor(baseWidth * scaleFactor);
        this.height = Math.floor(baseHeight * scaleFactor);
    }

    /**
     * 화면 크기 변경 시 호출되어 CSS 스타일을 다시 계산합니다.
     */
    resize() {
        const windowRatio = window.innerWidth / window.innerHeight;
        const gameRatio = GLOBAL_CONSTANTS.ASPECT_RATIO.RATIO;

        if (windowRatio > gameRatio) {
            this.cssHeight = window.innerHeight;
            this.cssWidth = this.cssHeight * gameRatio;
            this.cssTop = 0;
            this.cssLeft = (window.innerWidth - this.cssWidth) / 2;
        } else {
            this.cssWidth = window.innerWidth;
            this.cssHeight = this.cssWidth / gameRatio;
            this.cssLeft = 0;
            this.cssTop = (window.innerHeight - this.cssHeight) / 2;
        }

        this.scaleRatio = this.width / this.cssWidth;
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
}
