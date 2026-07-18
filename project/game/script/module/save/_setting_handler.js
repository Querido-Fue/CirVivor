import { fsPromises, path } from 'util/nw_bridge.js';
import { setTheme } from 'display/_theme_handler.js';
import { MathUtil } from 'util/math_util.js';
import { getData } from 'data/data_handler.js';
import { LANGUAGE_REGISTRY } from 'ui/lang/_language_registry.js';
import { ensureSaveDirectory, pathExists } from './_save_file_helper.js';

const THEME_KEYS = getData('THEME_KEYS');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const AVAILABLE_LANGUAGE_KEYS = Object.keys(LANGUAGE_REGISTRY);
const FALLBACK_LANGUAGE_KEY = AVAILABLE_LANGUAGE_KEYS.includes('english')
    ? 'english'
    : (AVAILABLE_LANGUAGE_KEYS[0] || 'korean');

/**
 * @typedef {'bool'|'int'|'float'|'string'} SettingSchemaType
 */

/**
 * @typedef {object} SettingSchemaEntry
 * @property {SettingSchemaType} type - 외부 값을 변환할 스키마 타입입니다.
 * @property {*} value - 현재 메모리에 보관된 값입니다.
 * @property {number} min - 숫자 하한이며 `-1`은 제한 없음입니다.
 * @property {number} max - 숫자 상한이며 `-1`은 제한 없음입니다.
 * @property {boolean} hidden - 옵션 UI 비노출 및 조건부 파일 저장 여부입니다.
 */

/**
 * @typedef {Record<string, *>} SettingValueMap
 */

/**
 * @class SettingHandler
 * @description 설정 스키마를 로드/검증/저장하고 테마 같은 즉시 반영 항목을 처리합니다.
 */
export class SettingHandler {
    #mathUtil;
    #presentHiddenKeys;

    /**
     * @param {string} dataDir - `settings.json`을 저장할 데이터 디렉터리입니다.
     */
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'settings.json');

        let defaultLang = FALLBACK_LANGUAGE_KEY;
        if (typeof navigator !== 'undefined' && navigator.language) {
            if (navigator.language.startsWith('ko') && AVAILABLE_LANGUAGE_KEYS.includes('korean')) {
                defaultLang = 'korean';
            }
        }

        /**
         * 설정 키별 타입, 현재 값, 숫자 범위 및 hidden 정책입니다.
         * hidden 항목은 파일에 이미 존재했거나 영구 설정 API로 명시된 경우에만 저장 대상에 포함됩니다.
         * @type {Record<string, SettingSchemaEntry>}
         */
        this.schema = {
            theme: { type: 'string', value: DEFAULT_THEME_KEY, min: -1, max: -1, hidden: false },
            disableTransparency: { type: 'bool', value: false, min: -1, max: -1, hidden: false },
            language: { type: 'string', value: defaultLang, min: -1, max: -1, hidden: false },
            windowMode: { type: 'string', value: 'fullscreen', min: -1, max: -1, hidden: false },
            widescreenSupport: { type: 'bool', value: true, min: -1, max: -1, hidden: false },
            width: { type: 'int', value: 1280, min: 1280, max: -1, hidden: false },
            height: { type: 'int', value: 720, min: 720, max: -1, hidden: false },
            renderScale: { type: 'int', value: 100, min: 75, max: 100, hidden: false },
            uiScale: { type: 'int', value: 100, min: 75, max: 150, hidden: false },
            tooltipDelaySeconds: { type: 'float', value: 0.7, min: 0, max: 2, hidden: false },
            bgmVolume: { type: 'int', value: 100, min: 0, max: 100, hidden: false },
            sfxVolume: { type: 'int', value: 100, min: 0, max: 100, hidden: false },
            screenModeChanged: { type: 'bool', value: false, min: -1, max: -1, hidden: true },
            debugMode: { type: 'bool', value: false, min: -1, max: -1, hidden: true },
        };

        this.#mathUtil = new MathUtil();

        // 현재 유지해야 할 hidden 키 목록 (파일에 존재하거나 명시적으로 설정된 경우)
        this.#presentHiddenKeys = new Set();
    }

    /**
     * 설정 파일을 로드·마이그레이션·정규화하고 필요하면 다시 저장한 뒤 현재 테마를 적용합니다.
     * @returns {Promise<void>} 초기 설정 반영이 끝나면 이행됩니다.
     */
    async init() {
        await this.#load();
    }

    /**
     * 각 스키마 항목의 호출 시점 `value`를 새 객체에 복사합니다.
     * @returns {SettingValueMap} 현재 설정 값 복사본입니다.
     * @private
     */
    #getDefaults() {
        const defaults = {};
        for (const key in this.schema) {
            defaults[key] = this.schema[key].value;
        }
        return defaults;
    }

    /**
     * 등록된 스키마의 타입 변환, 열거형 fallback, 숫자 범위 제한 및 항목별 보정을 적용합니다.
     * 스키마 조회 결과가 없으면 입력값을 그대로 반환합니다.
     * @param {string} key - 보정할 설정 키입니다.
     * @param {*} value - 외부 원시 값입니다.
     * @returns {*} 보정된 값입니다.
     * @private
     */
    #capValue(key, value) {
        const entry = this.schema[key];
        if (!entry) return value;

        // 타입 캐스팅
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
            if (processedValue === 'borderless') processedValue = 'fullscreen';
            if (processedValue === 'fullscreen' || processedValue === 'windowed') {
                return processedValue;
            }
            return 'fullscreen';
        }
        if (key === 'language') {
            if (AVAILABLE_LANGUAGE_KEYS.includes(processedValue)) {
                return processedValue;
            }
            return FALLBACK_LANGUAGE_KEY;
        }

        // 숫자 타입인 경우 min/max 캡 적용
        if (entry.type === 'int' || entry.type === 'float') {
            const cappedValue = this.#mathUtil.cap(processedValue, entry.min, entry.max);
            if (key === 'tooltipDelaySeconds') {
                return Number(cappedValue.toFixed(1));
            }
            return cappedValue;
        }

        return processedValue;
    }

    /**
     * 설정 파일을 읽어 레거시 키를 마이그레이션하고 스키마 값을 정규화합니다.
     * 누락된 공개 항목이나 마이그레이션이 있으면 파일을 다시 저장한 뒤 현재 테마를 적용합니다.
     * @returns {Promise<void>} 로드와 필요한 저장 및 테마 반영이 끝나면 이행됩니다.
     * @private
     */
    async #load() {
        let fileData = {};
        let fileExists = await pathExists(this.filePath);

        if (fileExists) {
            try {
                fileData = JSON.parse(await fsPromises.readFile(this.filePath, 'utf-8'));
            } catch (e) {
                console.error("설정 파일 로드 실패:", e);
                fileExists = false;
            }
        }

        let needsSave = false;

        if (fileData.physicsAccuracy !== undefined || fileData.physicsFps !== undefined) {
            delete fileData.physicsAccuracy;
            delete fileData.physicsFps;
            needsSave = true;
        }
        // 구버전 키 마이그레이션: borderless -> fullscreen (키오스크 모드 제거)
        if (fileData.windowMode === 'borderless') {
            fileData.windowMode = 'fullscreen';
            needsSave = true;
        } else if (fileData.windowMode !== undefined
            && fileData.windowMode !== 'fullscreen'
            && fileData.windowMode !== 'windowed') {
            fileData.windowMode = 'windowed';
            needsSave = true;
        }
        // 구버전 키 마이그레이션: darkMode(bool) -> theme(string)
        if (fileData.theme === undefined && typeof fileData.darkMode === 'boolean') {
            fileData.theme = fileData.darkMode ? 'dark' : 'light';
            needsSave = true;
        }
        if (fileData.simulationWorkerAuthorityMode !== undefined
            || fileData.simulationWorkerShadowMode !== undefined
            || fileData.simulationWorkerPresentationMode !== undefined) {
            delete fileData.simulationWorkerAuthorityMode;
            delete fileData.simulationWorkerShadowMode;
            delete fileData.simulationWorkerPresentationMode;
            needsSave = true;
        }

        // 스키마 기준으로 값 병합: 파일 값 우선, 없으면 기본값 사용
        for (const key in this.schema) {
            if (fileData[key] !== undefined) {
                this.schema[key].value = this.#capValue(key, fileData[key]);
                if (this.schema[key].hidden) {
                    this.#presentHiddenKeys.add(key);
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
        await ensureSaveDirectory(this.dataDir, '설정');

        const out = {};
        for (const key in this.schema) {
            // 숨김 항목이 아니거나, 숨김 항목이어도 파일에 명시되어 있던 경우에만 저장
            if (!this.schema[key].hidden || this.#presentHiddenKeys.has(key)) {
                out[key] = this.schema[key].value;
            }
        }

        try {
            await fsPromises.writeFile(this.filePath, JSON.stringify(out, null, 4));
        } catch (err) {
            console.error("설정 파일 저장 실패:", err);
            throw err;
        }
    }

    /**
     * 지원되는 설정 키의 현재 메모리 값을 반환합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @returns {*} 현재 설정 값입니다.
     */
    get(key) {
        return this.schema[key]?.value;
    }

    /**
     * 지원되는 설정 키의 내부 스키마 항목 참조를 반환합니다.
     * 반환 객체는 복제하거나 동결하지 않으며, 직접 변경하면 이후 조회·검증·저장에도 반영됩니다.
     * 호출자는 읽기 전용으로 취급해야 합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @returns {SettingSchemaEntry} 해당 키의 live 스키마 항목입니다.
     */
    getSchema(key) {
        return this.schema[key];
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

        if (!this.schema[key]) return Promise.resolve();
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

        for (const key in settings) {
            if (!this.schema[key]) {
                continue;
            }

            this.schema[key].value = this.#capValue(key, settings[key]);
            if (markHidden && this.schema[key].hidden) {
                this.#presentHiddenKeys.add(key);
            }
        }

        if (settings.theme !== undefined) {
            setTheme(this.schema.theme.value);
        }
    }
}
