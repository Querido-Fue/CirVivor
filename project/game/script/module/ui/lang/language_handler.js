import { korean } from './korean.js';
import { english } from './english.js';
import { getSetting } from 'save/_save_system.js';

export class LanguageHandler {
    constructor(uiSystem) {
        this.uiSystem = uiSystem;
        this.languages = { korean, english };

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
