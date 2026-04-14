import { nw } from './nw_bridge.js';

let runtimeToolInstance = null;

/**
 * @class RuntimeTool
 * @description 런타임 환경(NW.js) 관련 유틸리티 클래스입니다.
 * NW.js 창 및 외부 연동 기능을 제공합니다.
 */
export class RuntimeTool {
    constructor() {
        runtimeToolInstance = this;
        this._externalURLHandler = null;
    }

    /**
     * 외부 링크 열기 요청에 대한 확인 핸들러를 등록합니다.
     * @param {(url: string) => (string|null|boolean|undefined)|null} handler - 외부 링크 확인 처리 함수입니다.
     */
    setExternalURLHandler(handler) {
        this._externalURLHandler = typeof handler === 'function' ? handler : null;
    }

    /**
     * URL을 외부 시스템 브라우저에서 엽니다.
     * @param {string} url - 열고자 하는 URL
     * @returns {string|boolean|null} 처리 결과입니다.
     */
    openURL(url) {
        const normalizedUrl = typeof url === 'string' ? url.trim() : '';
        if (!normalizedUrl) {
            return false;
        }

        if (typeof this._externalURLHandler === 'function') {
            const handledResult = this._externalURLHandler(normalizedUrl);
            if (handledResult !== null && handledResult !== undefined && handledResult !== false) {
                return handledResult;
            }
        }

        return this._openURLDirect(normalizedUrl);
    }

    /**
     * 확인 절차 없이 URL을 외부 시스템 브라우저에서 즉시 엽니다.
     * @param {string} url - 열고자 하는 URL
     * @returns {boolean} 브라우저 열기 시도 여부입니다.
     */
    _openURLDirect(url) {
        const normalizedUrl = typeof url === 'string' ? url.trim() : '';
        if (!normalizedUrl) {
            return false;
        }

        nw.Shell.openExternal(normalizedUrl);
        return true;
    }

    /**
     * 창을 전체 화면으로 설정합니다.
     * @param {boolean} isFullScreen - 전체 화면 여부
     */
    setFullScreen(isFullScreen) {
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
        nw.Window.get().resizeTo(width, height);
    }

    /**
     * 창 위치를 설정합니다.
     * @param {number} x - x 좌표
     * @param {number} y - y 좌표
     */
    setWindowPosition(x, y) {
        nw.Window.get().moveTo(x, y);
    }

    /**
     * 창을 화면 중앙으로 이동합니다.
     */
    setWindowPositionCenter() {
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
        nw.Window.get().close(true);
    }

    /**
     * 줌 레벨을 설정합니다.
     * @param {number} zoomLevel - 줌 레벨
     */
    setZoomLevel(zoomLevel) {
        nw.Window.get().zoomLevel = zoomLevel;
    }

    /**
     * 디버그 창을 엽니다.
     */
    openDebugWindow() {
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
