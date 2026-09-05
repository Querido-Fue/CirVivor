import { fsPromises, path } from 'util/nw_bridge.js';
import { ensureSaveDirectory, pathExists } from '../_save_file_helper.js';

/**
 * @class SettingRepository
 * @description settings.json I/O와 hidden 설정의 파일 포함 상태를 관리합니다.
 */
export class SettingRepository {
    #getDataDir;
    #getFilePath;
    #getSchema;
    #presentHiddenKeys;

    /**
     * @param {string} dataDir - `settings.json` 경로를 만들 초기 데이터 디렉터리입니다.
     * @param {object} providers - facade의 최신 공개 상태를 읽는 provider입니다.
     * @param {() => string} providers.getDataDir - 현재 데이터 디렉터리를 반환합니다.
     * @param {() => string} providers.getFilePath - 현재 설정 파일 경로를 반환합니다.
     * @param {() => Record<string, object>} providers.getSchema - 현재 런타임 스키마를 반환합니다.
     */
    constructor(dataDir, { getDataDir, getFilePath, getSchema }) {
        this.filePath = path.join(dataDir, 'settings.json');
        this.#getDataDir = getDataDir;
        this.#getFilePath = getFilePath;
        this.#getSchema = getSchema;
        this.#presentHiddenKeys = new Set();
    }

    /**
     * 설정 파일을 읽고 파싱합니다. 파일 부재나 잘못된 JSON 객체는 기본값으로 복구합니다.
     * I/O 오류는 기존 설정을 덮어쓰지 않도록 기록한 뒤 전파합니다.
     * @returns {Promise<{fileData: Record<string, *>, fileExists: boolean}>} 파일 데이터와 유효한 파일 존재 여부입니다.
     */
    async load() {
        let fileData = {};
        let fileExists = await pathExists(this.#getFilePath());

        if (fileExists) {
            let source;
            try {
                source = await fsPromises.readFile(this.#getFilePath(), 'utf-8');
            } catch (error) {
                console.error("설정 파일 로드 실패:", error);
                throw error;
            }
            try {
                fileData = JSON.parse(source);
                if (!fileData || typeof fileData !== 'object' || Array.isArray(fileData)) {
                    throw new TypeError('설정 파일의 최상위 값은 객체여야 합니다.');
                }
            } catch (error) {
                console.error("설정 파일 로드 실패:", error);
                fileData = {};
                fileExists = false;
            }
        }

        return { fileData, fileExists };
    }

    /**
     * hidden 설정 키를 이후 파일 저장 대상에 포함합니다.
     * 로드 파일에 실제로 존재했거나 영구 설정 API로 명시된 키만 등록해야 합니다.
     * @param {string} key - 저장 대상에 유지할 hidden 설정 키입니다.
     * @returns {void}
     */
    markHiddenKeyPresent(key) {
        this.#presentHiddenKeys.add(key);
    }

    /**
     * 현재 스키마 값을 `settings.json`에 비동기로 저장합니다.
     * 공개 항목은 항상 포함하고, hidden 항목은 파일에 존재했거나 영구 설정 API로
     * 명시되어 저장 대상에 등록된 경우에만 포함합니다.
     * @returns {Promise<void>} 파일 쓰기가 끝나면 이행됩니다.
     */
    async save() {
        await ensureSaveDirectory(this.#getDataDir(), '설정');

        const out = {};
        for (const key of Object.keys(this.#getSchema())) {
            if (!this.#getSchema()[key].hidden || this.#presentHiddenKeys.has(key)) {
                out[key] = this.#getSchema()[key].value;
            }
        }

        try {
            await fsPromises.writeFile(this.#getFilePath(), JSON.stringify(out, null, 4));
        } catch (error) {
            console.error("설정 파일 저장 실패:", error);
            throw error;
        }
    }
}
