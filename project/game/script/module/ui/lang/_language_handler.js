import { getSetting } from 'save/save_system.js';
import {
    LANGUAGE_REGISTRY,
    DEFAULT_LANGUAGE_KEY,
    getLanguagePack,
    getAvailableLanguageEntries
} from './_language_registry.js';

let languageHandlerInstance = null;

/**
 * 언어팩에 비어 있지 않은 문자열 리소스가 등록되어 있는지 확인합니다.
 * @param {object|null|undefined} languagePack
 * @param {string} key
 * @returns {boolean}
 */
function hasLanguageValue(languagePack, key) {
    return Boolean(
        languagePack
        && Object.prototype.hasOwnProperty.call(languagePack, key)
        && languagePack[key] !== ''
    );
}

/**
 * @class LanguageHandler
 * @description 현재 언어 설정을 기준으로 문자열 리소스를 조회합니다.
 */
export class LanguageHandler {
    /**
     * @param {object} uiSystem - 상위 UI 시스템입니다.
     */
    constructor(uiSystem) {
        if (languageHandlerInstance) {
            return languageHandlerInstance;
        }
        languageHandlerInstance = this;
        this.uiSystem = uiSystem;
        this.languages = LANGUAGE_REGISTRY;

        const langSetting = getSetting('language');
        this.currentLanguage = getLanguagePack(langSetting || DEFAULT_LANGUAGE_KEY);
        this.defaultLanguage = getLanguagePack(DEFAULT_LANGUAGE_KEY);
    }

    /**
     * 키에 해당하는 번역된 문자열을 가져옵니다.
     * @param {string} key - 언어 키
     * @returns {string} 번역된 문자열 (키를 찾지 못하면 키 자체 반환)
     */
    getString(key) {
        if (hasLanguageValue(this.currentLanguage, key)) {
            return this.currentLanguage[key];
        }
        if (hasLanguageValue(this.defaultLanguage, key)) {
            return this.defaultLanguage[key];
        }
        console.warn(`언어 키 '${key}'를 찾을 수 없습니다.`);
        return key;
    }

    /**
     * 현재 활성 언어팩을 즉시 교체합니다.
     * @param {string} languageKey - 적용할 언어 키입니다.
     */
    setLanguage(languageKey) {
        this.currentLanguage = getLanguagePack(languageKey || DEFAULT_LANGUAGE_KEY);
    }
}

/**
 * 사용자에게 표시 가능한 언어 목록을 반환합니다.
 * @returns {{key:string, languageName:string}[]} 표시 가능한 언어 목록
 */
export function getAvailableLanguages() {
    return getAvailableLanguageEntries();
}
