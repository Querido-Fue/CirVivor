import { korean } from './korean.js';
import { english } from './english.js';
import { getSetting, setSetting } from 'save/_save_system.js';

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
        return this.currentLanguage[key] || key; // Return key if string not found
    }

    /**
     * 언어를 설정하고 저장합니다.
     * @param {string} lang - 언어 코드 (korean, english)
     */
    setLanguage(lang) {
        if (this.languages[lang]) {
            this.currentLanguage = this.languages[lang];
            setSetting('language', lang);
            console.log(`Language changed to: ${lang}`);
        } else {
            console.error(`Language '${lang}' not found.`);
        }
    }
}
