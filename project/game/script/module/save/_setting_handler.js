import { ColorSchemes, setTheme } from 'display/_theme_handler.js';
import { beginThemeTransition } from 'display/_theme_transition_controller.js';
import {
    createSettingSchema,
    resolveDefaultSettingLanguage,
    SettingValueCoercer
} from './setting/_setting_schema.js';
import { migrateLegacySettingData } from './setting/_setting_legacy_migration.js';
import { SettingRepository } from './setting/_setting_repository.js';

/**
 * @typedef {'bool'|'int'|'float'|'string'|'object'} SettingSchemaType
 */

/**
 * @typedef {object} SettingSchemaEntry
 * @property {SettingSchemaType} type - 외부 값을 변환할 스키마 타입입니다.
 * @property {*} value - 현재 메모리에 보관된 값입니다.
 * @property {number} min - 숫자 하한이며 `-1`은 제한 없음입니다.
 * @property {number} max - 숫자 상한이며 `-1`은 제한 없음입니다.
 * @property {number} [step] - 숫자 설정의 양자화 간격입니다.
 * @property {number} [precision] - 숫자 canonicalization에 사용할 소수 자릿수입니다.
 * @property {boolean} hidden - 옵션 UI 비노출 및 조건부 파일 저장 여부입니다.
 * @property {*} defaultValue - 설정 정의에 선언된 정적 기본값입니다.
 * @property {ReadonlyArray<*>} [allowedValues] - 허용된 열거형 값 목록입니다.
 */

/**
 * @typedef {Record<string, *>} SettingValueMap
 */

/**
 * @class SettingHandler
 * @description 설정 스키마를 로드/검증/저장하고 테마 같은 즉시 반영 항목을 처리합니다.
 */
export class SettingHandler {
    #coercer;
    #repository;

    /**
     * @param {string} dataDir - `settings.json`을 저장할 데이터 디렉터리입니다.
     */
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.#repository = new SettingRepository(this.dataDir, {
            getDataDir: () => this.dataDir,
            getFilePath: () => this.filePath,
            getSchema: () => this.schema
        });
        this.filePath = this.#repository.filePath;

        /**
         * 설정 키별 타입, 현재 값, 숫자 범위 및 hidden 정책입니다.
         * hidden 항목은 파일에 이미 존재했거나 영구 설정 API로 명시된 경우에만 저장 대상에 포함됩니다.
         * @type {Record<string, SettingSchemaEntry>}
         */
        this.schema = createSettingSchema(resolveDefaultSettingLanguage());
        this.#coercer = new SettingValueCoercer();
    }

    /**
     * 설정 파일을 로드·마이그레이션·정규화하고 필요하면 다시 저장한 뒤 현재 테마를 적용합니다.
     * @returns {Promise<void>} 초기 설정 반영이 끝나면 이행됩니다.
     */
    async init() {
        await this.#load();
    }

    /**
     * 설정 파일을 읽어 레거시 키를 마이그레이션하고 스키마 값을 정규화합니다.
     * 누락된 공개 항목이나 마이그레이션이 있으면 파일을 다시 저장한 뒤 현재 테마를 적용합니다.
     * @returns {Promise<void>} 로드와 필요한 저장 및 테마 반영이 끝나면 이행됩니다.
     * @private
     */
    async #load() {
        const { fileData, fileExists } = await this.#repository.load();
        let needsSave = migrateLegacySettingData(fileData);

        // 스키마 기준으로 값 병합: 파일 값 우선, 없으면 기본값 사용
        for (const key of Object.keys(this.schema)) {
            if (Object.hasOwn(fileData, key) && fileData[key] !== undefined) {
                this.schema[key].value = this.#capValue(key, fileData[key]);
                if (this.schema[key].hidden) {
                    this.#repository.markHiddenKeyPresent(key);
                }
            } else if (!this.schema[key].hidden) {
                // 숨김 항목이 아닌 값은 파일에 없을 때 새로 저장해야 함
                needsSave = true;
            }
        }

        if (!fileExists || needsSave) {
            await this.save();
        }

        // 테마 초기값 반영
        setTheme(this.schema.theme.value);
    }

    /**
     * 현재 스키마 값을 `settings.json`에 비동기로 저장합니다.
     * 공개 항목은 항상 포함하고, hidden 항목은 로드 당시 파일에 존재했거나
     * `set()`/`setBatch()`로 저장 유지 대상에 등록된 경우에만 포함합니다.
     * 포함되는 hidden 항목에는 저장 시점의 현재 메모리 값이 기록됩니다.
     * @returns {Promise<void>} 파일 쓰기가 끝나면 이행됩니다.
     */
    async save() {
        await this.#repository.save();
    }

    /**
     * 지원되는 설정 키의 현재 메모리 값을 반환합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @returns {*} 현재 설정 값입니다.
     */
    get(key) {
        return Object.hasOwn(this.schema, key) ? this.schema[key].value : undefined;
    }

    /**
     * 지원되는 설정 키의 내부 스키마 항목 참조를 반환합니다.
     * 반환 객체는 복제하거나 동결하지 않으며, 직접 변경하면 이후 조회·검증·저장에도 반영됩니다.
     * 호출자는 읽기 전용으로 취급해야 합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @returns {SettingSchemaEntry} 해당 키의 live 스키마 항목입니다.
     */
    getSchema(key) {
        return Object.hasOwn(this.schema, key) ? this.schema[key] : undefined;
    }

    /**
     * 호출 시점의 최신 공개 스키마를 기준으로 설정 값을 보정합니다.
     * @param {string} key - 보정할 설정 키입니다.
     * @param {*} value - 외부 원시 값입니다.
     * @returns {*} 보정된 값입니다.
     * @private
     */
    #capValue(key, value) {
        return this.#coercer.coerce(this.schema, key, value);
    }

    /**
     * 지원되는 설정 하나를 보정해 메모리에 반영하고 저장합니다.
     * hidden 키는 이후 저장 유지 대상으로 등록되며, `theme` 값이 `undefined`가 아니면
     * 보정된 현재 테마를 파일 쓰기 전에 즉시 적용합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @param {*} value - 설정할 원시 값입니다.
     * @returns {Promise<void>} 설정 파일 쓰기가 끝나면 이행됩니다.
     */
    set(key, value) {

        if (!Object.hasOwn(this.schema, key)) return Promise.resolve();
        this.#applyValues({ [key]: value }, { markHidden: true });
        return this.save();
    }

    /**
     * 지원되는 설정들을 일괄 보정해 메모리에 반영하고 저장합니다.
     * hidden 키는 이후 저장 유지 대상으로 등록되며, 입력의 `theme` 값이 `undefined`가 아니면
     * 보정된 현재 테마를 파일 쓰기 전에 즉시 적용합니다.
     * 반영할 지원 키가 없어도 현재 설정 파일 저장은 수행합니다.
     * @param {SettingValueMap} settings - 설정 키와 원시 값입니다.
     * @returns {Promise<void>} 설정 파일 쓰기가 끝나면 이행됩니다.
     */
    setBatch(settings) {
        this.#applyValues(settings, { markHidden: true });
        return this.save();
    }

    /**
     * 지원되는 설정들을 보정해 메모리에 즉시 반영합니다.
     * 이 호출 자체는 파일을 쓰거나 새 hidden 키를 저장 유지 대상으로 등록하지 않습니다.
     * 입력의 `theme` 값이 `undefined`가 아니면 보정된 현재 테마를 즉시 적용합니다.
     * 변경된 메모리 값은 이후 `save()`, `setBatch()` 또는 `saveAll()`에서 저장될 수 있습니다.
     * @param {SettingValueMap} settings - 미리보기할 설정 키와 원시 값입니다.
     * @returns {void}
     */
    previewBatch(settings) {
        this.#applyValues(settings, { markHidden: false });
    }

    /**
     * 전달 객체의 열거 가능한 설정 값을 스키마 메모리에 반영하고 필요한 테마 효과를 적용합니다.
     * `markHidden`이 정확히 `false`가 아닐 때 hidden 키를 이후 저장 유지 대상으로 등록합니다.
     * @param {SettingValueMap} settings - 반영할 설정 값입니다.
     * @param {{markHidden?: boolean}} [options={}] - hidden 저장 유지 등록 여부입니다.
     * @returns {void}
     * @private
     */
    #applyValues(settings, options = {}) {
        const markHidden = options.markHidden !== false;
        const previousTheme = this.schema.theme.value;
        const previousThemeBackground = ColorSchemes.Background;
        const hasTheme = Object.hasOwn(settings, 'theme') && settings.theme !== undefined;
        const nextTheme = !hasTheme
            ? previousTheme
            : this.#capValue('theme', settings.theme);

        if (nextTheme !== previousTheme) {
            beginThemeTransition(previousThemeBackground);
        }

        for (const key of Object.keys(settings)) {
            if (!Object.hasOwn(this.schema, key)) {
                continue;
            }

            this.schema[key].value = this.#capValue(key, settings[key]);
            if (markHidden && this.schema[key].hidden) {
                this.#repository.markHiddenKeyPresent(key);
            }
        }

        if (hasTheme) {
            setTheme(this.schema.theme.value);
        }
    }
}
