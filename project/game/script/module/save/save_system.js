import { path } from 'util/nw_bridge.js';
import { ProgressHandler } from './_progress_handler.js';
import { IngameHandler } from './_ingame_handler.js';
import { SettingHandler } from './_setting_handler.js';
import { ensureSaveDirectory } from './_save_file_helper.js';

let saveSystemInstance;

/**
 * @class SaveSystem
 * @description 게임 시스템의 설정/진행도/인게임 데이터를 NW.js 로컬 파일에 저장합니다.
 */
export class SaveSystem {
    constructor() {
        saveSystemInstance = this;
        this.dataDir = path.join(process.cwd(), 'save');

        this.settingHandler = new SettingHandler(this.dataDir);
        this.progressHandler = new ProgressHandler(this.dataDir);
        this.ingameHandler = new IngameHandler(this.dataDir);
    }

    /**
     * 저장 시스템을 초기화하고 데이터를 로드합니다.
     * @returns {Promise<void>} 저장 폴더와 모든 데이터 핸들러 초기화가 끝나면 이행됩니다.
     */
    async init() {
        await ensureSaveDirectory(this.dataDir, '저장 데이터');
        await this.settingHandler.init();
        await this.progressHandler.init();
        await this.ingameHandler.init();
    }

    /**
     * 지원되는 설정 값을 변경하고 저장합니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @param {*} value - 설정할 원시 값입니다.
     * @returns {Promise<void>} 저장 완료 Promise입니다.
     */
    setSetting(key, value) {
        return this.settingHandler.set(key, value);
    }

    /**
     * 지원되는 여러 설정 값을 일괄 반영하고 저장합니다.
     * 반영할 지원 키가 없어도 현재 설정 파일 저장은 수행합니다.
     * @param {Record<string, *>} settings - 설정 키와 원시 값입니다.
     * @returns {Promise<void>} 저장 완료 Promise입니다.
     */
    setSettingBatch(settings) {
        return this.settingHandler.setBatch(settings);
    }

    /**
     * 여러 설정 값을 메모리에 임시 반영합니다.
     * 이 호출 자체는 파일을 쓰지 않고, `theme`은 보정 후 즉시 적용됩니다.
     * 메모리 값은 이후 저장 호출에서 파일에 기록될 수 있습니다.
     * @param {Record<string, *>} settings - 설정 키와 원시 값입니다.
     * @returns {void}
     */
    previewSettingBatch(settings) {
        this.settingHandler.previewBatch(settings);
    }

    /**
     * 지원되는 설정 값을 가져옵니다.
     * @param {string} key - 지원되는 설정 키입니다.
     * @returns {*} 현재 설정 값입니다.
     */
    getSetting(key) {
        return this.settingHandler.get(key);
    }

    /**
     * 모든 데이터를 저장합니다.
     * @returns {Promise<void>} 모든 저장 완료 Promise입니다.
     */
    async saveAll() {
        await this.settingHandler.save();
        await this.progressHandler.save();
        await this.ingameHandler.save();
    }
}

/**
 * 지원되는 설정 값을 반환합니다.
 * @param {string} key - 지원되는 설정 키입니다.
 * @returns {*} 현재 설정 값입니다.
 */
export const getSetting = (key) => {
    return saveSystemInstance.getSetting(key);
};

/**
 * 지원되는 설정 값을 변경하고 저장합니다.
 * @param {string} key - 지원되는 설정 키입니다.
 * @param {*} value - 설정할 원시 값입니다.
 * @returns {Promise<void>} 저장 완료 Promise입니다.
 */
export const setSetting = (key, value) => {
    return saveSystemInstance.setSetting(key, value);
};

/**
 * 지원되는 여러 설정 값을 일괄 반영하고 저장합니다.
 * 반영할 지원 키가 없어도 현재 설정 파일 저장은 수행합니다.
 * @param {Record<string, *>} settings - 설정 키와 원시 값입니다.
 * @returns {Promise<void>} 저장 완료 Promise입니다.
 */
export const setSettingBatch = (settings) => {
    return saveSystemInstance.setSettingBatch(settings);
};

/**
 * 여러 설정 값을 메모리에 임시 반영합니다.
 * 이 호출 자체는 파일을 쓰지 않고, `theme`은 보정 후 즉시 적용됩니다.
 * 메모리 값은 이후 저장 호출에서 파일에 기록될 수 있습니다.
 * @param {Record<string, *>} settings - 설정 키와 원시 값입니다.
 * @returns {void}
 */
export const previewSettingBatch = (settings) => {
    saveSystemInstance.previewSettingBatch(settings);
};

/**
 * 지원되는 설정 키의 live 스키마 항목을 내부 참조 그대로 반환합니다.
 * 호출자는 반환 객체를 읽기 전용으로 취급해야 합니다.
 * @param {string} key - 지원되는 설정 키입니다.
 * @returns {{type: 'bool'|'int'|'float'|'string', value: *, min: number, max: number, hidden: boolean}}
 * 해당 키의 live 스키마 항목입니다.
 */
export const getSettingSchema = (key) => {
    return saveSystemInstance.settingHandler.getSchema(key);
};

/**
 * SaveSystem의 싱글톤 인스턴스를 반환합니다.
 * @returns {SaveSystem|undefined} 생성된 SaveSystem 인스턴스이며, 생성 전에는 `undefined`입니다.
 */
export const getSaveSystemInstance = () => {
    return saveSystemInstance;
};
