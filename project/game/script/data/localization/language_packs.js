import { english } from './english.js';
import { korean } from './korean.js';
import { userLanguage } from './user_language.js';

/** 저장된 언어 설정이 없거나 알 수 없는 경우 사용할 언어 키입니다. */
export const DEFAULT_LANGUAGE_KEY = 'korean';

/** UI에서 사용할 수 있는 언어팩 데이터입니다. */
export const LANGUAGE_PACKS = Object.freeze({
    korean,
    english,
    userLanguage
});

/** 설정 검증에 사용하는 등록 언어 키 목록입니다. */
export const LANGUAGE_KEYS = Object.freeze(Object.keys(LANGUAGE_PACKS));
