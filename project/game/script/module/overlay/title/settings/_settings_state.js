import { getLangString } from 'ui/ui_system.js';
import { getSetting } from 'save/save_system.js';
import { clampNumber } from 'util/number_util.js';

export const SETTING_LABEL_KEYS = Object.freeze({
    windowMode: 'title_settings_window_mode',
    widescreenSupport: 'title_settings_widescreen_support',
    renderScale: 'title_settings_render_scale',
    uiScale: 'title_settings_ui_scale',
    disableTransparency: 'title_settings_disable_transparency',
    tooltipDelaySeconds: 'title_settings_tooltip_delay',
    language: 'title_settings_language',
    theme: 'title_settings_theme',
    bgmVolume: 'title_settings_bgm',
    sfxVolume: 'title_settings_sfx'
});

/**
 * 설정 오버레이가 표시할 초기 임시 설정 스냅샷을 생성합니다.
 * @param {{availableLanguages: object[], defaultThemeKey: string}} options - 초기 상태 생성 옵션입니다.
 * @returns {object} 설정 오버레이 임시 상태입니다.
 */
export function createSettingsInitialState(options) {
    const availableLanguages = Array.isArray(options?.availableLanguages) ? options.availableLanguages : [];
    const savedLanguage = getSetting('language');
    const fallbackLanguage = availableLanguages.length > 0 ? availableLanguages[0].key : 'korean';
    const normalizedLanguage = availableLanguages.some((lang) => lang.key === savedLanguage)
        ? savedLanguage
        : fallbackLanguage;

    return {
        windowMode: getNormalizedWindowMode(getSetting('windowMode')),
        widescreenSupport: getSetting('widescreenSupport') !== false,
        renderScale: getSetting('renderScale') || 100,
        uiScale: getSetting('uiScale') || 100,
        disableTransparency: getSetting('disableTransparency') || false,
        tooltipDelaySeconds: normalizeTooltipDelaySeconds(
            getSetting('tooltipDelaySeconds') !== undefined ? getSetting('tooltipDelaySeconds') : 0.7
        ),
        language: normalizedLanguage,
        theme: getSetting('theme') || options?.defaultThemeKey,
        bgmVolume: getSetting('bgmVolume') !== undefined ? getSetting('bgmVolume') : 100,
        sfxVolume: getSetting('sfxVolume') !== undefined ? getSetting('sfxVolume') : 100
    };
}

/**
 * 저장된 창 모드 값을 오버레이에서 사용하는 값으로 정규화합니다.
 * @param {string} windowMode - 저장된 창 모드입니다.
 * @returns {'windowed'|'fullscreen'} 정규화된 창 모드입니다.
 */
export function getNormalizedWindowMode(windowMode) {
    return windowMode === 'windowed' ? 'windowed' : 'fullscreen';
}

/**
 * 현재 임시 설정과 초기 설정의 차이를 판정합니다.
 * @param {object} initialSettings - 초기 설정 스냅샷입니다.
 * @param {object} tempSettings - 현재 임시 설정입니다.
 * @returns {boolean} 하나라도 변경된 설정이 있으면 true입니다.
 */
export function hasSettingsChanges(initialSettings, tempSettings) {
    return Object.keys(initialSettings || {}).some((settingKey) => tempSettings?.[settingKey] !== initialSettings[settingKey]);
}

/**
 * 초기 스냅샷 대비 실제로 변경된 설정만 추려 반환합니다.
 * @param {object} initialSettings - 초기 설정 스냅샷입니다.
 * @param {object} tempSettings - 현재 임시 설정입니다.
 * @returns {object} 변경된 설정 키와 값입니다.
 */
export function getChangedSettings(initialSettings, tempSettings) {
    const changedSettings = {};

    for (const settingKey of Object.keys(initialSettings || {})) {
        if (tempSettings?.[settingKey] === initialSettings[settingKey]) {
            continue;
        }
        changedSettings[settingKey] = tempSettings?.[settingKey];
    }

    return changedSettings;
}

/**
 * 현재 변경분을 초기 스냅샷 값으로 되돌리는 설정 객체를 반환합니다.
 * @param {object} initialSettings - 초기 설정 스냅샷입니다.
 * @param {object} tempSettings - 현재 임시 설정입니다.
 * @returns {object} 복원할 설정 키와 값입니다.
 */
export function getRevertedSettings(initialSettings, tempSettings) {
    const revertedSettings = {};

    for (const settingKey of Object.keys(initialSettings || {})) {
        if (tempSettings?.[settingKey] === initialSettings[settingKey]) {
            continue;
        }
        revertedSettings[settingKey] = initialSettings[settingKey];
    }

    return revertedSettings;
}

/**
 * 가상 설정 키를 실제 저장 키 묶음으로 확장합니다.
 * 현재 설정 UI는 모두 실제 저장 키와 1:1로 매핑되므로 복사본만 반환합니다.
 * @param {object} [changedSettings={}] - UI에서 변경된 설정 객체입니다.
 * @returns {object} 저장/미리보기에 사용할 실제 설정 객체입니다.
 */
export function expandCompositeSettings(changedSettings = {}) {
    return { ...changedSettings };
}

/**
 * 설정 항목 라벨의 UI 요소 id를 반환합니다.
 * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 설정 키입니다.
 * @returns {string} 라벨 UI 요소 id입니다.
 */
export function getSettingLabelId(settingKey) {
    return `setting_label_${settingKey}`;
}

/**
 * 설정 항목 라벨 텍스트를 변경 상태에 맞춰 반환합니다.
 * @param {object} initialSettings - 초기 설정 스냅샷입니다.
 * @param {object} tempSettings - 현재 임시 설정입니다.
 * @param {keyof typeof SETTING_LABEL_KEYS} settingKey - 설정 키입니다.
 * @param {string} labelKey - 다국어 라벨 키입니다.
 * @returns {string} 표시할 라벨 텍스트입니다.
 */
export function getSettingLabelText(initialSettings, tempSettings, settingKey, labelKey) {
    const label = getLangString(labelKey);
    return tempSettings?.[settingKey] !== initialSettings?.[settingKey] ? `${label}*` : label;
}

/**
 * 현재 언어 설정에 맞춰 툴팁 지연 시간을 포맷합니다.
 * @param {number} value - 표시할 지연 시간입니다.
 * @param {string} language - 현재 언어 키입니다.
 * @returns {string} 포맷된 표시 문자열입니다.
 */
export function formatTooltipDelayValue(value, language) {
    const normalizedValue = normalizeTooltipDelaySeconds(value);
    const suffix = language === 'korean' ? '초' : 's';
    return `${normalizedValue.toFixed(1)}${suffix}`;
}

/**
 * 툴팁 지연 시간을 0.1초 단위 값으로 정규화합니다.
 * @param {number} value - 정규화할 값입니다.
 * @returns {number} 0.1초 단위로 보정된 값입니다.
 */
export function normalizeTooltipDelaySeconds(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0.7;
    }

    return Number(clampNumber(numericValue, 0, 2).toFixed(1));
}
