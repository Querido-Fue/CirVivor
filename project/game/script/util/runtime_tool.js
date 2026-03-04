import { nw, isNwRuntime } from './nw_bridge.js';

let runtimeToolInstance = null;

/**
 * @class RuntimeTool
 * @description 런타임 환경(NW.js) 관련 유틸리티 클래스입니다.
 * 브라우저 기능 제어 및 런타임 관련 기능을 제공합니다.
 */
export class RuntimeTool {
    constructor() {
        runtimeToolInstance = this;
    }

    /**
     * URL을 외부 브라우저에서 엽니다.
     * @param {string} url - 열고자 하는 URL
     */
    openURL(url) {
        if (isNwRuntime()) {
            nw.Shell.openExternal(url);
            return;
        }

        window.open(url, '_blank');
    }

    /**
     * 창을 전체 화면으로 설정합니다.
     * @param {boolean} isFullScreen - 전체 화면 여부
     */
    setFullScreen(isFullScreen) {
        if (!isNwRuntime()) {
            return;
        }

        if (isFullScreen) {
            nw.Window.get().enterFullscreen();
        } else {
            nw.Window.get().leaveFullscreen();
        }
    }

    /**
     * 창 크기를 설정합니다.
     * @param {number} width - 너비
     * @param {number} height - 높이
     */
    setWindowSize(width, height) {
        if (!isNwRuntime()) {
            return;
        }
        nw.Window.get().resizeTo(width, height);
    }

    /**
     * 창 위치를 설정합니다.
     * @param {number} x - x 좌표
     * @param {number} y - y 좌표
     */
    setWindowPosition(x, y) {
        if (!isNwRuntime()) {
            return;
        }
        nw.Window.get().moveTo(x, y);
    }

    /**
     * 창을 화면 중앙으로 이동합니다.
     */
    setWindowPositionCenter() {
        if (!isNwRuntime()) {
            return;
        }

        const width = nw.Window.get().width;
        const height = nw.Window.get().height;
        const x = Math.round((window.screen.width - width) / 2);
        const y = Math.round((window.screen.height - height) / 2);
        nw.Window.get().moveTo(x, y);
    }

    /**
     * 창을 닫습니다.
     */
    closeWindow() {
        if (!isNwRuntime()) {
            window.close();
            return;
        }
        nw.Window.get().close(true);
    }

    /**
     * 줌 레벨을 설정합니다.
     * @param {number} zoomLevel - 줌 레벨
     */
    setZoomLevel(zoomLevel) {
        if (!isNwRuntime()) {
            return;
        }
        nw.Window.get().zoomLevel = zoomLevel;
    }

    /**
     * 디버그 창을 엽니다.
     */
    openDebugWindow() {
        if (!isNwRuntime()) {
            return;
        }
        nw.Window.get().showDevTools();
    }
}

/**
 * runtimeTool 싱글톤 인스턴스를 반환합니다.
 * @returns {RuntimeTool} RuntimeTool 인스턴스
 */
export function runtimeTool() {
    return runtimeToolInstance;
}
