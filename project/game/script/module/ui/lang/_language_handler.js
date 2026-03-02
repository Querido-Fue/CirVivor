import { korean } from './_korean.js';
import { english } from './_english.js';
import { userLanguage } from './_usertranslation.js';
import { getSetting } from 'save/save_system.js';

let languageHandlerInstance = null;

/**
 * @class LanguageHandler
 * @description 현재 언어 설정을 기준으로 문자열 리소스를 조회합니다.
 */
export class LanguageHandler {
    constructor(uiSystem) {
        if (languageHandlerInstance) {
            return languageHandlerInstance;
        }
        languageHandlerInstance = this;
        this.uiSystem = uiSystem;
        this.languages = { korean, english, userLanguage };

        const langSetting = getSetting('language') || 'korean';
        this.currentLanguage = this.languages[langSetting];
    }

    /**
     * 키에 해당하는 번역된 문자열을 가져옵니다.
     * @param {string} key - 언어 키
     * @returns {string} 번역된 문자열 (키를 찾지 못하면 키 자체 반환)
     */
    getString(key) {
        if (this.currentLanguage[key]) {
            return this.currentLanguage[key];
        }
        console.warn(`언어 키 '${key}'를 찾을 수 없습니다.`);
        return key;
    }
}

/**
 * 사용자에게 표시 가능한 언어 목록을 반환합니다.
 * @returns {string[]} 표시 가능한 언어 키 목록
 */
export function getAvailableLanguages() {
    if (!languageHandlerInstance) {
        return [];
    }
    return Object.keys(languageHandlerInstance.languages).filter(lang => languageHandlerInstance.languages[lang].hidden !== 'true');
}
