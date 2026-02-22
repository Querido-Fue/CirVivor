import { Cursor } from './cursor.js';
import { LanguageHandler } from './lang/language_handler.js';
import { ExitOverlay } from 'ui/overlay/exit_overlay.js';
import { UIDataParser } from './ui_data_parser.js';

let uiSystemInstance;

export class UISystem {
    constructor() {
        uiSystemInstance = this;
        this.cursor = new Cursor(this);
        this.languageHandler = new LanguageHandler(this);
        this.exitConfirmOverlay = null;

        // UI 데이터 파서 초기화
        this.uiDataParser = new UIDataParser();
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
     * 오버레이가 있다면 업데이트합니다.
     */
    update() {
        this.cursor.update();
        if (this.exitConfirmOverlay) {
            this.exitConfirmOverlay.update();
        }
    }

    /**
     * 커서를 그립니다.
     * 오버레이가 있다면 그립니다.
     */
    draw() {
        if (this.exitConfirmOverlay) {
            this.exitConfirmOverlay.draw();
        }
        this.cursor.draw(); // 커서는 항상 최상위
    }

    /**
     * 게임 종료 확인 오버레이를 표시합니다.
     */
    showExitConfirmation() {
        if (this.exitConfirmOverlay) return; // 이미 떠있으면 무시

        this.exitConfirmOverlay = new ExitOverlay();

        // 오버레이 닫힘 처리
        this.exitConfirmOverlay.onCloseComplete = () => {
            this.exitConfirmOverlay = null;
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

export const parseUIData = (data, uiScale = 1) => {
    return uiSystemInstance.uiDataParser.parse(data, uiScale);
}
