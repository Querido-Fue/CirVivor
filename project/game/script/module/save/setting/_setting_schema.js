import { MathUtil } from 'util/math_util.js';
import { SETTING_DEFINITIONS } from 'data/settings/setting_definitions.js';

const THEME_KEYS = SETTING_DEFINITIONS.theme.allowedValues;
const DEFAULT_THEME_KEY = SETTING_DEFINITIONS.theme.defaultValue;
const AVAILABLE_LANGUAGE_KEYS = SETTING_DEFINITIONS.language.allowedValues;
const WINDOW_MODE_VALUES = SETTING_DEFINITIONS.windowMode.allowedValues;
const DEFAULT_WINDOW_MODE = SETTING_DEFINITIONS.windowMode.defaultValue;
const FALLBACK_LANGUAGE_KEY = AVAILABLE_LANGUAGE_KEYS.includes(SETTING_DEFINITIONS.language.defaultValue)
    ? SETTING_DEFINITIONS.language.defaultValue
    : (AVAILABLE_LANGUAGE_KEYS[0] || 'korean');

/**
 * 실행 환경과 설정 정의를 기준으로 최초 언어 값을 결정합니다.
 * @returns {string} 초기 언어 키입니다.
 */
export function resolveDefaultSettingLanguage() {
    let defaultLanguage = FALLBACK_LANGUAGE_KEY;
    if (typeof navigator !== 'undefined' && navigator.language) {
        if (navigator.language.startsWith('ko') && AVAILABLE_LANGUAGE_KEYS.includes('korean')) {
            defaultLanguage = 'korean';
        }
    }
    return defaultLanguage;
}

/**
 * 불변 설정 정의를 현재 값을 보관할 가변 런타임 스키마로 복제합니다.
 * @param {string} defaultLanguage - 현재 환경에 적용할 기본 언어 키입니다.
 * @returns {Record<string, object>} 새 설정 스키마입니다.
 */
export function createSettingSchema(defaultLanguage) {
    return Object.fromEntries(
        Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => [
            key,
            {
                ...definition,
                value: key === 'language' ? defaultLanguage : definition.defaultValue
            }
        ])
    );
}

/**
 * @class SettingValueCoercer
 * @description 런타임 설정 스키마를 기준으로 외부 값을 타입·열거형·범위 규칙에 맞게 보정합니다.
 */
export class SettingValueCoercer {
    #mathUtil;

    constructor() {
        this.#mathUtil = new MathUtil();
    }

    /**
     * 등록된 스키마의 타입 변환, 열거형 fallback, 숫자 범위 제한 및 항목별 보정을 적용합니다.
     * 스키마 조회 결과가 없으면 입력값을 그대로 반환합니다.
     * @param {Record<string, object>} schema - 현재 값을 포함한 가변 런타임 설정 스키마입니다.
     * @param {string} key - 보정할 설정 키입니다.
     * @param {*} value - 외부 원시 값입니다.
     * @returns {*} 보정된 값입니다.
     */
    coerce(schema, key, value) {
        const entry = schema[key];
        if (!entry) return value;

        let processedValue = value;
        if (entry.type === 'int') {
            processedValue = parseInt(value, 10);
            if (isNaN(processedValue)) return entry.value;
        } else if (entry.type === 'float') {
            processedValue = parseFloat(value);
            if (isNaN(processedValue)) return entry.value;
        } else if (entry.type === 'bool') {
            processedValue = Boolean(value);
        } else if (entry.type === 'string') {
            processedValue = String(value);
        }

        if (key === 'theme') {
            if (THEME_KEYS.includes(processedValue)) {
                return processedValue;
            }
            return DEFAULT_THEME_KEY;
        }
        if (key === 'windowMode') {
            if (processedValue === 'borderless') processedValue = DEFAULT_WINDOW_MODE;
            if (WINDOW_MODE_VALUES.includes(processedValue)) {
                return processedValue;
            }
            return DEFAULT_WINDOW_MODE;
        }
        if (key === 'language') {
            if (AVAILABLE_LANGUAGE_KEYS.includes(processedValue)) {
                return processedValue;
            }
            return FALLBACK_LANGUAGE_KEY;
        }

        if (entry.type === 'int' || entry.type === 'float') {
            const cappedValue = this.#mathUtil.cap(processedValue, entry.min, entry.max);
            if (key === 'tooltipDelaySeconds') {
                return Number(cappedValue.toFixed(1));
            }
            return cappedValue;
        }

        return processedValue;
    }
}
