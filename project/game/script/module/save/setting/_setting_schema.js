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
const UNSAFE_SETTING_OBJECT_KEYS = Object.freeze(new Set([
    '__proto__',
    'constructor',
    'prototype'
]));
const MAX_SETTING_OBJECT_DEPTH = 8;
const MAX_SETTING_OBJECT_ENTRIES = 256;

/**
 * 설정 파일의 배열·plain object를 안전한 새 컨테이너로 복제합니다.
 * 함수·symbol·순환 참조·과도한 깊이와 prototype 오염 키는 포함하지 않습니다.
 * @param {*} value - 복제할 설정 값입니다.
 * @param {number} [depth=0] - 현재 재귀 깊이입니다.
 * @param {Set<object>} [ancestors=new Set()] - 현재 경로의 순환 검사용 객체 집합입니다.
 * @returns {*} 복제한 값이며 지원하지 않는 값은 undefined입니다.
 */
function cloneSafeSettingObject(value, depth = 0, ancestors = new Set()) {
    if (value === null
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'boolean') {
        return value;
    }
    if (depth >= MAX_SETTING_OBJECT_DEPTH
        || !value
        || typeof value !== 'object'
        || ancestors.has(value)) {
        return undefined;
    }

    ancestors.add(value);
    if (Array.isArray(value)) {
        const result = [];
        const length = Math.min(value.length, MAX_SETTING_OBJECT_ENTRIES);
        for (let index = 0; index < length; index++) {
            const clonedValue = cloneSafeSettingObject(value[index], depth + 1, ancestors);
            if (clonedValue !== undefined) {
                result.push(clonedValue);
            }
        }
        ancestors.delete(value);
        return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
        ancestors.delete(value);
        return undefined;
    }

    const result = {};
    const keys = Object.keys(value);
    const length = Math.min(keys.length, MAX_SETTING_OBJECT_ENTRIES);
    for (let index = 0; index < length; index++) {
        const key = keys[index];
        if (UNSAFE_SETTING_OBJECT_KEYS.has(key)) {
            continue;
        }
        const clonedValue = cloneSafeSettingObject(value[key], depth + 1, ancestors);
        if (clonedValue !== undefined) {
            result[key] = clonedValue;
        }
    }
    ancestors.delete(value);
    return result;
}

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
                value: key === 'language'
                    ? defaultLanguage
                    : (definition.type === 'object'
                        ? cloneSafeSettingObject(definition.defaultValue)
                        : definition.defaultValue)
            }
        ])
    );
}

/**
 * 이미 범위 제한된 숫자를 설정 정의의 step 격자와 canonical 정밀도로 정규화합니다.
 * step midpoint는 SliderElement와 동일하게 `Math.round()` 규칙을 사용합니다.
 * @param {number} cappedValue - min/max 범위로 제한된 유한 숫자입니다.
 * @param {{min?:number,step?:number,precision?:number}} entry - 숫자 설정 스키마 항목입니다.
 * @returns {number} step과 precision이 적용된 숫자입니다.
 */
export function quantizeSettingNumericValue(cappedValue, entry) {
    const step = Number(entry?.step);
    const precision = Number(entry?.precision);
    let quantizedValue = cappedValue;

    if (Number.isFinite(step) && step > 0) {
        const origin = Number.isFinite(entry?.min) && entry.min !== -1
            ? entry.min
            : 0;
        quantizedValue = origin + (Math.round((cappedValue - origin) / step) * step);
    }

    if (Number.isInteger(precision) && precision >= 0 && precision <= 100) {
        return Number(quantizedValue.toFixed(precision));
    }
    return quantizedValue;
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
        } else if (entry.type === 'object') {
            const clonedValue = cloneSafeSettingObject(value);
            if (!clonedValue || Array.isArray(clonedValue)) {
                return cloneSafeSettingObject(entry.value)
                    || cloneSafeSettingObject(entry.defaultValue)
                    || {};
            }
            return clonedValue;
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
            const quantizedValue = quantizeSettingNumericValue(cappedValue, entry);
            return this.#mathUtil.cap(quantizedValue, entry.min, entry.max);
        }

        return processedValue;
    }
}
