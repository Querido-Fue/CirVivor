import { Cursor } from './_cursor.js';
import { LanguageHandler } from './lang/_language_handler.js';
import { UIDataParser } from './_ui_data_parser.js';

let uiSystemInstance;

/**
 * @class UISystem
 * @description 커서, 다국어, UI 데이터 파싱 등 UI 관련 하위 모듈을 관리하는 시스템입니다.
 */
export class UISystem {
    constructor() {
        uiSystemInstance = this;
        this.cursor = new Cursor(this);
        this.languageHandler = new LanguageHandler(this);

        // 인터페이스 데이터 파서 초기화
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
    }

    resize() {
        if (this.cursor && typeof this.cursor.resize === 'function') {
            this.cursor.resize();
        }
    }

    /**
     * 커서를 그립니다.
     * 오버레이가 있다면 그립니다.
     */
    draw() {
        this.cursor.draw(); // 커서는 항상 최상위
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

/**
 * 문자열 기반 UI 상수 데이터를 실제 값으로 변환합니다.
 * @param {string|object|number} data - 파싱할 UI 데이터
 * @param {number} [uiScale=1] - UI 스케일 배율
 * @returns {number} 파싱된 수치 값
 */
export const parseUIData = (data, uiScale = 1) => {
    return uiSystemInstance.uiDataParser.parse(data, uiScale);
}
