import { UICursor } from './cursor/ui_cursor.js';
import { LanguageHandler } from './lang/_language_handler.js';
import { parseUIData as parseUIDataWithPositioning } from './layout/_positioning_handler.js';
import { UITooltipSystem } from './tooltip/ui_tooltip.js';

let uiSystemInstance;

/**
 * @class UISystem
 * @description 커서와 다국어 등 UI 관련 하위 모듈을 관리하는 시스템입니다.
 */
export class UISystem {
    constructor() {
        uiSystemInstance = this;
        this.cursor = new UICursor(this);
        this.languageHandler = new LanguageHandler(this);
        this.tooltip = new UITooltipSystem();
    }

    /**
     * UI 시스템을 초기화합니다.
     * 커서를 초기화합니다.
     */
    async init() {
        await this.cursor.init();
        await this.tooltip.init();
    }

    /**
     * 커서를 업데이트합니다.
     * 오버레이가 있다면 업데이트합니다.
     */
    update() {
        this.tooltip.beginFrame();
        this.cursor.update();
    }

    /**
         * 화면 크기 변경 시 커서 등 하위 시스템의 리사이즈를 호출합니다.
         */
    resize() {
        if (this.cursor && typeof this.cursor.resize === 'function') {
            this.cursor.resize();
        }
    }

    /**
     * UI 시스템의 현재 언어를 교체합니다.
     * @param {string} languageKey - 적용할 언어 키입니다.
     */
    setLanguage(languageKey) {
        if (this.languageHandler && typeof this.languageHandler.setLanguage === 'function') {
            this.languageHandler.setLanguage(languageKey);
        }
    }

    /**
     * 커서를 그립니다.
     * 오버레이가 있다면 그립니다.
     */
    draw() {
        this.tooltip.draw();
        this.cursor.draw(); // 커서는 항상 최상위
    }

    /**
     * 런타임 상태에 맞춰 UI 커서 표시 여부를 전환합니다.
     * @param {boolean} isVisible - 커서 표시 여부입니다.
     */
    setCursorVisible(isVisible) {
        if (this.cursor && typeof this.cursor.setVisible === 'function') {
            this.cursor.setVisible(isVisible);
        }
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
 * 현재 프레임에 툴팁 표시를 요청합니다.
 * @param {string|string[]|object|null|undefined} content - 표시할 툴팁 콘텐츠입니다.
 */
export const requestTooltip = (content) => {
    uiSystemInstance?.tooltip?.request(content);
}

/**
 * 현재 툴팁 요청을 초기화합니다.
 */
export const clearTooltip = () => {
    uiSystemInstance?.tooltip?.clear();
}

/**
 * 문자열 기반 UI 상수 데이터를 실제 값으로 변환합니다.
 * @param {string|object|number} data - 파싱할 UI 데이터
 * @param {number} [uiScale=1] - UI 스케일 배율
 * @returns {number} 파싱된 수치 값
 */
export const parseUIData = (data, uiScale = 1) => {
    return parseUIDataWithPositioning(data, uiScale);
}
