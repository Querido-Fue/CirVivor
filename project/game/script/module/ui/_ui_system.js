import { Cursor } from './cursor.js';
import { LanguageHandler } from './lang/language_handler.js';

let uiSystemInstance;

export class UISystem {
    constructor() {
        uiSystemInstance = this;
        this.cursor = new Cursor(this);
        this.languageHandler = new LanguageHandler(this);
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
     */
    update() {
        this.cursor.update();
    }

    /**
     * 커서를 그립니다.
     */
    draw() {
        this.cursor.draw();
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
