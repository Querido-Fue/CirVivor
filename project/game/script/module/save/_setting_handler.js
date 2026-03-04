import { fsPromises, path, isNwRuntime } from 'util/nw_bridge.js';
import { setTheme } from 'display/_theme_handler.js';
import { MathUtil } from 'util/math_util.js';
import { getData } from 'data/data_handler.js';
import { LANGUAGE_REGISTRY } from 'ui/lang/_language_registry.js';

const THEME_KEYS = getData('THEME_KEYS');
const DEFAULT_THEME_KEY = getData('DEFAULT_THEME_KEY');
const AVAILABLE_LANGUAGE_KEYS = Object.keys(LANGUAGE_REGISTRY);
const FALLBACK_LANGUAGE_KEY = AVAILABLE_LANGUAGE_KEYS.includes('english')
    ? 'english'
    : (AVAILABLE_LANGUAGE_KEYS[0] || 'korean');

/**
 * @class SettingHandler
 * @description 설정 스키마를 로드/검증/저장하고 테마 같은 즉시 반영 항목을 처리합니다.
 * NW.js는 파일 저장, 브라우저는 localStorage 저장을 사용합니다.
 */
export class SettingHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.isNwRuntime = isNwRuntime();
        this.storageKey = 'cirvivor.save.settings';
        this.filePath = this.isNwRuntime ? path.join(this.dataDir, 'settings.json') : null;

        let defaultLang = FALLBACK_LANGUAGE_KEY;
        if (typeof navigator !== 'undefined' && navigator.language) {
            if (navigator.language.startsWith('ko') && AVAILABLE_LANGUAGE_KEYS.includes('korean')) {
                defaultLang = 'korean';
            }
        }

        /**
         * 설정 스키마 정의
         * type: 데이터 타입 ('bool' | 'int' | 'string')
         * value: 기본값, min: 최솟값 (-1=제한없음), max: 최댓값 (-1=제한없음), hidden: UI 옵션 메뉴에 표시하지 않음 (파일에는 조건부 저장됨)
         */
        this.schema = {
            theme: { type: 'string', value: DEFAULT_THEME_KEY, min: -1, max: -1, hidden: false },
            disableTransparency: { type: 'bool', value: false, min: -1, max: -1, hidden: false },
            language: { type: 'string', value: defaultLang, min: -1, max: -1, hidden: false },
            windowMode: { type: 'string', value: this.isNwRuntime ? 'fullscreen' : 'browserMode', min: -1, max: -1, hidden: false },
            width: { type: 'int', value: 1280, min: 1280, max: -1, hidden: false },
            height: { type: 'int', value: 720, min: 720, max: -1, hidden: false },
            renderScale: { type: 'int', value: 100, min: 75, max: 100, hidden: false },
            uiScale: { type: 'int', value: 100, min: 75, max: 125, hidden: false },
            physicsAccuracy: { type: 'int', value: 8, min: 4, max: 10, hidden: false },
            bgmVolume: { type: 'int', value: 100, min: 0, max: 100, hidden: false },
            sfxVolume: { type: 'int', value: 100, min: 0, max: 100, hidden: false },
            screenModeChanged: { type: 'bool', value: false, min: -1, max: -1, hidden: true },
            debugMode: { type: 'bool', value: false, min: -1, max: -1, hidden: true },
        };

        this._mathUtil = new MathUtil();

        // 현재 유지해야 할 hidden 키 목록 (파일에 존재하거나 명시적으로 설정된 경우)
        this._presentHiddenKeys = new Set();
    }

    /**
     * 설정 데이터를 로드합니다.
     */
    async init() {
        await this._load();
    }

    /**
     * @private
     * 스키마에서 기본값만 추출한 객체를 반환합니다.
     */
    _getDefaults() {
        const defaults = {};
        for (const key in this.schema) {
            defaults[key] = this.schema[key].value;
        }
        return defaults;
    }

    /**
         * @private
         * 스키마(min, max, type)에 기반하여 입력값이 범위를 벗어나지 않도록 보정(Cap)합니다.
         * @param {string} key 보정할 설정 키
         * @param {*} value 외부로부터 받은 원시 값
         * @returns {*} 보정된 안전한 값
         */
    _capValue(key, value) {
        const entry = this.schema[key];
        if (!entry) return value;

        // 타입 캐스팅
        let processedValue = value;
        if (entry.type === 'int') {
            processedValue = parseInt(value, 10);
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
        if (key === 'language') {
            if (AVAILABLE_LANGUAGE_KEYS.includes(processedValue)) {
                return processedValue;
            }
            return FALLBACK_LANGUAGE_KEY;
        }

        // 숫자 타입인 경우 min/max 캡 적용
        if (entry.type === 'int') {
            return this._mathUtil.cap(processedValue, entry.min, entry.max);
        }

        return processedValue;
    }

    /**
     * @private
     * 설정 데이터 파일을 비동기로 로드합니다.
     */
    async _load() {
        let fileData = {};

        let fileExists = false;
        if (this.isNwRuntime) {
            try {
                await fsPromises.access(this.filePath);
                fileExists = true;
            } catch {
                fileExists = false;
            }

            if (fileExists) {
                try {
                    fileData = JSON.parse(await fsPromises.readFile(this.filePath, 'utf-8'));
                } catch (e) {
                    console.error("설정 파일 로드 실패:", e);
                    fileExists = false;
                }
            }
        } else {
            try {
                const raw = window.localStorage.getItem(this.storageKey);
                if (raw) {
                    fileData = JSON.parse(raw);
                    fileExists = true;
                }
            } catch (e) {
                console.error("localStorage 설정 로드 실패:", e);
                fileExists = false;
            }
        }

        let needsSave = false;

        // 구버전 키 마이그레이션: physicsFps -> physicsAccuracy
        if (fileData.physicsAccuracy === undefined && fileData.physicsFps !== undefined) {
            fileData.physicsAccuracy = fileData.physicsFps;
            needsSave = true;
        }
        // 구버전 키 마이그레이션: borderless -> fullscreen (키오스크 모드 제거)
        if (fileData.windowMode === 'borderless') {
            fileData.windowMode = 'fullscreen';
            needsSave = true;
        }
        // 구버전 키 마이그레이션: darkMode(bool) -> theme(string)
        if (fileData.theme === undefined && typeof fileData.darkMode === 'boolean') {
            fileData.theme = fileData.darkMode ? 'dark' : 'light';
            needsSave = true;
        }

        // 스키마 기준으로 값 병합: 파일 값 우선, 없으면 기본값 사용
        for (const key in this.schema) {
            if (fileData[key] !== undefined) {
                this.schema[key].value = this._capValue(key, fileData[key]);
                if (this.schema[key].hidden) {
                    this._presentHiddenKeys.add(key);
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
     * 설정 데이터를 비동기로 저장합니다. hidden=true 항목은 파일에 쓰지 않습니다.
     * @returns {Promise}
     */
    async save() {
        if (this.isNwRuntime) {
            try {
                await fsPromises.access(this.dataDir);
            } catch (e) {
                try {
                    await fsPromises.mkdir(this.dataDir, { recursive: true });
                } catch (mkdirError) {
                    console.error("설정 디렉토리 생성 실패:", mkdirError);
                    throw mkdirError;
                }
            }
        }

        const out = {};
        for (const key in this.schema) {
            // 숨김 항목이 아니거나, 숨김 항목이어도 파일에 명시되어 있던 경우에만 저장
            if (!this.schema[key].hidden || this._presentHiddenKeys.has(key)) {
                out[key] = this.schema[key].value;
            }
        }

        if (this.isNwRuntime) {
            try {
                await fsPromises.writeFile(this.filePath, JSON.stringify(out, null, 4));
            } catch (err) {
                console.error("설정 파일 저장 실패:", err);
                throw err;
            }
            return;
        }

        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify(out));
        } catch (err) {
            console.error("localStorage 설정 저장 실패:", err);
            throw err;
        }
    }

    /**
     * 설정 값을 반환합니다.
     * @param {string} key - 설정 키
     * @returns {*} 설정 값
     */
    get(key) {
        return this.schema[key]?.value;
    }

    /**
     * 특정 키의 스키마 전체를 반환합니다.
     * @param {string} key - 설정 키
     * @returns {{ value: any, min: number, max: number, hidden: boolean }|undefined}
     */
    getSchema(key) {
        return this.schema[key];
    }

    /**
     * 설정 값을 설정하고 저장합니다.
     * @param {string} key - 설정 키
     * @param {*} value - 설정 값
     * @returns {Promise}
     */
    set(key, value) {

        if (!this.schema[key]) return Promise.resolve();
        this.schema[key].value = this._capValue(key, value);

        if (this.schema[key].hidden) {
            this._presentHiddenKeys.add(key);
        }

        if (key === 'theme') {
            setTheme(this.schema.theme.value);
        }
        return this.save();
    }

    /**
     * 설정 값을 일괄 설정하고 저장합니다.
     * @param {object} settings - 설정 객체
     * @returns {Promise}
     */
    setBatch(settings) {
        for (const key in settings) {
            if (this.schema[key]) {
                this.schema[key].value = this._capValue(key, settings[key]);
                if (this.schema[key].hidden) {
                    this._presentHiddenKeys.add(key);
                }
            }
        }

        if (settings.theme !== undefined) {
            setTheme(this.schema.theme.value);
        }
        return this.save();
    }
}
