import { LANGUAGE_KEYS } from 'data/localization/language_packs.js';
import { DEFAULT_THEME_KEY, THEME_KEYS } from 'data/theme/theme_registry.js';

/**
 * 설정의 기본값과 선언형 검증 범위입니다.
 * 값 변환, 마이그레이션, 저장 및 즉시 적용 정책은 SettingHandler가 소유합니다.
 */
export const SETTING_DEFINITIONS = Object.freeze({
    theme: Object.freeze({
        type: 'string',
        defaultValue: DEFAULT_THEME_KEY,
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: THEME_KEYS
    }),
    disableTransparency: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: false
    }),
    language: Object.freeze({
        type: 'string',
        defaultValue: 'english',
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: LANGUAGE_KEYS
    }),
    windowMode: Object.freeze({
        type: 'string',
        defaultValue: 'fullscreen',
        min: -1,
        max: -1,
        hidden: false,
        allowedValues: Object.freeze(['fullscreen', 'windowed'])
    }),
    widescreenSupport: Object.freeze({
        type: 'bool', defaultValue: true, min: -1, max: -1, hidden: false
    }),
    width: Object.freeze({
        type: 'int', defaultValue: 1280, min: 1280, max: -1, hidden: false
    }),
    height: Object.freeze({
        type: 'int', defaultValue: 720, min: 720, max: -1, hidden: false
    }),
    renderScale: Object.freeze({
        type: 'int', defaultValue: 100, min: 75, max: 100, hidden: false
    }),
    uiScale: Object.freeze({
        type: 'int', defaultValue: 100, min: 75, max: 150, hidden: false
    }),
    tooltipDelaySeconds: Object.freeze({
        type: 'float', defaultValue: 0.3, min: 0, max: 2, hidden: false
    }),
    bgmVolume: Object.freeze({
        type: 'int', defaultValue: 25, min: 0, max: 100, hidden: false
    }),
    sfxVolume: Object.freeze({
        type: 'int', defaultValue: 40, min: 0, max: 100, hidden: false
    }),
    screenModeChanged: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: true
    }),
    debugMode: Object.freeze({
        type: 'bool', defaultValue: false, min: -1, max: -1, hidden: true
    })
});
