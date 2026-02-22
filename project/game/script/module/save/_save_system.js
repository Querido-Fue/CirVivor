const fs = require('fs');
const path = require('path');
import { ProgressHandler } from './progress_handler.js';
import { IngameHandler } from './ingame_handler.js';
import { SettingHandler } from './setting_handler.js';

let saveSystemInstance;

export class SaveSystem {
    constructor() {
        saveSystemInstance = this;
        this.dataDir = path.join(process.cwd(), 'save');
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir);
        }

        this.settingHandler = new SettingHandler(this.dataDir);
        this.progressHandler = new ProgressHandler(this.dataDir);
        this.ingameHandler = new IngameHandler(this.dataDir);
    }

    /**
     * 저장 시스템을 초기화하고 데이터를 로드합니다.
     */
    async init() {
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

export const getSetting = (key) => {
    return saveSystemInstance.getSetting(key);
}

export const setSetting = (key, value) => {
    return saveSystemInstance.setSetting(key, value);
}

export const setSettingBatch = (settings) => {
    return saveSystemInstance.setSettingBatch(settings);
}

export const getSaveSystemInstance = () => {
    return saveSystemInstance;
}