import { Cursor } from './cursor.js';
import { LanguageHandler } from './lang/language_handler.js';
import { ExitOverlay } from 'ui/overlay/exit_overlay.js';

let uiSystemInstance;

export class UISystem {
    constructor() {
        uiSystemInstance = this;
        this.cursor = new Cursor(this);
        this.languageHandler = new LanguageHandler(this);
        this.activeOverlay = null; // 현재 활성화된 전역 오버레이
    }

    /**
     * UI 시스템을 초기화합니다.
     * 커서를 초기화합니다.
     */
    async init() {
        await this.cursor.init();
    }

    /**
     * 커서를 업데이트합니다.
     * 활성화된 오버레이가 있다면 업데이트합니다.
     */
    update() {
        this.cursor.update();
        if (this.activeOverlay) {
            this.activeOverlay.update();
        }
    }

    /**
     * 커서를 그립니다.
     * 활성화된 오버레이가 있다면 그립니다.
     */
    draw() {
        if (this.activeOverlay) {
            this.activeOverlay.draw();
        }
        this.cursor.draw(); // 커서는 항상 최상위
    }

    /**
     * 게임 종료 확인 오버레이를 표시합니다.
     */
    showExitConfirmation() {
        if (this.activeOverlay instanceof ExitOverlay) return; // 이미 떠있으면 무시

        if (this.activeOverlay) {
            this.activeOverlay.close();
        }

        this.activeOverlay = new ExitOverlay();

        // 오버레이가 닫힐 때 참조를 해제하기 위해 기존 콜백을 래핑합니다.
        const originalClose = this.activeOverlay.onCloseComplete.bind(this.activeOverlay);
        this.activeOverlay.onCloseComplete = () => {
            originalClose();
            if (this.activeOverlay === this.activeOverlay) { // 자신이 여전히 active라면 해제
                this.activeOverlay = null;
            }
        };
    }
}

/**
 * 키에 해당하는 언어 문자열을 반환합니다.
 * @param {string} key - 언어 키
 * @returns {string} 번역된 문자열
 */
export const getLangString = (key) => {
    return uiSystemInstance.languageHandler.getString(key);
}

export const showExitConfirmation = () => {
    if (uiSystemInstance) {
        uiSystemInstance.showExitConfirmation();
    }
}
