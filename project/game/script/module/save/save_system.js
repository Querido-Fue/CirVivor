import { fsPromises, path, isNwRuntime } from 'util/nw_bridge.js';
import { ProgressHandler } from './_progress_handler.js';
import { IngameHandler } from './_ingame_handler.js';
import { SettingHandler } from './_setting_handler.js';

let saveSystemInstance;

/**
 * @class SaveSystem
 * @description 게임 시스템의 설정/진행도/인게임 데이터를 저장합니다.
 * NW.js에서는 로컬 파일을, 브라우저에서는 localStorage를 사용합니다.
 */
export class SaveSystem {
    constructor() {
        saveSystemInstance = this;
        this.isNwRuntime = isNwRuntime();
        this.dataDir = this.isNwRuntime ? path.join(process.cwd(), 'save') : null;

        this.settingHandler = new SettingHandler(this.dataDir);
        this.progressHandler = new ProgressHandler(this.dataDir);
        this.ingameHandler = new IngameHandler(this.dataDir);
    }

    /**
     * 저장 시스템을 초기화하고 데이터를 로드합니다.
     */
    async init() {
        if (this.isNwRuntime) {
            await fsPromises.mkdir(this.dataDir, { recursive: true });
        }

        await this.settingHandler.init();
        await this.progressHandler.init();
        await this.ingameHandler.init();
    }

    /**
     * 특정 설정 값을 변경하고 저장합니다.
     * @param {string} key - 설정 키
     * @param {any} value - 설정 값
     */
    setSetting(key, value) {
        return this.settingHandler.set(key, value);
    }

    /**
     * 여러 설정 값을 한 번에 변경하고 저장합니다.
     * @param {object} settings - {key: value} 형태의 설정 객체
     * @returns {Promise} 저장 완료 Promise
     */
    setSettingBatch(settings) {
        return this.settingHandler.setBatch(settings);
    }

    /**
     * 특정 설정 값을 가져옵니다.
     * @param {string} key - 설정 키
     * @returns {any} 설정 값. 키가 없으면 undefined 반환.
     */
    getSetting(key) {
        return this.settingHandler.get(key);
    }

    /**
     * 모든 데이터를 저장합니다.
     * @returns {Promise} 모든 저장 완료 Promise
     */
    async saveAll() {
        await this.settingHandler.save();
        await this.progressHandler.save();
        await this.ingameHandler.save();
    }
}

/**
 * 특정 설정 값을 반환합니다.
 * @param {string} key - 설정 키
 * @returns {any} 설정 값
 */
export const getSetting = (key) => {
    return saveSystemInstance.getSetting(key);
}

/**
 * 특정 설정 값을 변경하고 저장합니다.
 * @param {string} key - 설정 키
 * @param {any} value - 설정 값
 * @returns {Promise} 저장 완료 Promise
 */
export const setSetting = (key, value) => {
    return saveSystemInstance.setSetting(key, value);
}

/**
 * 여러 설정 값을 한 번에 변경하고 저장합니다.
 * @param {object} settings - {key: value} 형태의 설정 객체
 * @returns {Promise} 저장 완료 Promise
 */
export const setSettingBatch = (settings) => {
    return saveSystemInstance.setSettingBatch(settings);
}

/**
 * 특정 설정 키의 스키마(value, min, max, hidden)를 반환합니다.
 * @param {string} key - 설정 키
 * @returns {{ value: any, min: number, max: number, hidden: boolean }|undefined}
 */
export const getSettingSchema = (key) => {
    return saveSystemInstance.settingHandler.getSchema(key);
}

/**
 * SaveSystem의 싱글톤 인스턴스를 반환합니다.
 * @returns {SaveSystem} SaveSystem 인스턴스
 */
export const getSaveSystemInstance = () => {
    return saveSystemInstance;
}
