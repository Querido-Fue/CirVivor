import {
    DEFAULT_LANGUAGE_KEY,
    LANGUAGE_PACKS
} from 'data/localization/language_packs.js';

export { DEFAULT_LANGUAGE_KEY };

/**
 * UI 언어팩을 언어 키로 조회하기 위한 레지스트리입니다.
 * @type {Readonly<Record<string, object>>}
 */
export const LANGUAGE_REGISTRY = LANGUAGE_PACKS;

/**
 * 등록된 언어 키인지 확인합니다.
 * @param {unknown} languageKey
 * @returns {boolean}
 */
const hasLanguagePack = (languageKey) => {
    return typeof languageKey === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_REGISTRY, languageKey);
};

/**
 * 설정 화면에서 숨겨야 하는 언어팩인지 확인합니다.
 * @param {object|undefined|null} languagePack
 * @returns {boolean}
 */
const isLanguageHidden = (languagePack) => {
    return languagePack?.hidden === true || languagePack?.hidden === 'true';
};

/**
 * 언어 키에 해당하는 언어팩을 반환합니다.
 * @param {unknown} languageKey
 * @returns {object}
 */
export const getLanguagePack = (languageKey) => {
    if (hasLanguagePack(languageKey)) {
        return LANGUAGE_REGISTRY[languageKey];
    }
    return LANGUAGE_REGISTRY[DEFAULT_LANGUAGE_KEY];
};

/**
 * 설정 UI에 표시할 수 있는 언어 목록을 반환합니다.
 * @returns {{key:string, languageName:string}[]}
 */
export const getAvailableLanguageEntries = () => {
    return Object.entries(LANGUAGE_REGISTRY)
        .filter(([, languagePack]) => !isLanguageHidden(languagePack))
        .map(([key, languagePack]) => ({
            key,
            languageName: languagePack.language_name || key
        }));
};
