import { korean } from './_korean.js';
import { english } from './_english.js';
import { userLanguage } from './_usertranslation.js';

export const DEFAULT_LANGUAGE_KEY = 'korean';

export const LANGUAGE_REGISTRY = Object.freeze({
    korean,
    english,
    userLanguage
});

const isLanguageHidden = (languagePack) => {
    return languagePack?.hidden === true || languagePack?.hidden === 'true';
};

export const getLanguagePack = (languageKey) => {
    if (typeof languageKey === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGE_REGISTRY, languageKey)) {
        return LANGUAGE_REGISTRY[languageKey];
    }
    return LANGUAGE_REGISTRY[DEFAULT_LANGUAGE_KEY];
};

export const getAvailableLanguageEntries = () => {
    return Object.entries(LANGUAGE_REGISTRY)
        .filter(([, languagePack]) => !isLanguageHidden(languagePack))
        .map(([key, languagePack]) => ({
            key,
            languageName: languagePack.language_name || key
        }));
};
