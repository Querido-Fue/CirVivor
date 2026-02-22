const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
import { setTheme } from 'display/theme_handler.js';

export class SettingHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'settings.json');
        this.data = {};

        // 시스템 언어 감지
        let defaultLang = 'english';
        if (typeof navigator !== 'undefined' && navigator.language) {
            if (navigator.language.startsWith('ko')) {
                defaultLang = 'korean';
            }
        }

        this.defaultData = {
            darkMode: true,
            disableTransparency: false,
            language: defaultLang,
            windowMode: 'fullscreen',
            width: 1280,
            height: 720,
            renderScale: 100,
            resolution: 5,
            uiScale: 100,
            physicsFps: 60
        };
    }

    /**
     * 설정 데이터를 로드합니다.
     */
    async init() {
        await this._load();
    }

    /**
     * @private
     * 설정 데이터 파일을 비동기로 로드합니다.
     */
    async _load() {
        let fileExists = false;
        try {
            await fsPromises.access(this.filePath);
            fileExists = true;
        } catch (err) {
            fileExists = false;
        }

        if (fileExists) {
            try {
                this.data = JSON.parse(await fsPromises.readFile(this.filePath, 'utf-8'));

                // 병합 로직
                let updated = false;
                for (const key in this.defaultData) {
                    if (this.data[key] === undefined) {
                        this.data[key] = this.defaultData[key];
                        updated = true;
                    }
                }

                if (updated) {
                    await this.save();
                }

            } catch (e) {
                console.error("Failed to load settings:", e);
                this.data = JSON.parse(JSON.stringify(this.defaultData));
                await this.save();
            }
        } else {
            this.data = JSON.parse(JSON.stringify(this.defaultData));
            await this.save();
        }
    }

    /**
     * 설정 데이터를 비동기로 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    async save() {
        // 저장 경로가 존재하지 않으면 생성
        try {
            await fsPromises.access(this.dataDir);
        } catch (err) {
            try {
                await fsPromises.mkdir(this.dataDir, { recursive: true });
            } catch (e) {
                console.error("Failed to create settings directory:", e);
                throw e;
            }
        }

        const dataStr = JSON.stringify(this.data, null, 4);
        try {
            await fsPromises.writeFile(this.filePath, dataStr);
        } catch (err) {
            console.error("Failed to save settings:", err);
            throw err;
        }
    }

    /**
     * 설정 데이터를 반환합니다.
     * @returns {object} 설정 데이터
     */
    getData() {
        return this.data;
    }

    /**
     * 설정 값을 반환합니다.
     * @param {string} key - 설정 키
     * @returns {*} 설정 값
     */
    get(key) {
        // 숨김 데이터(디버그모드) 처리
        if (key === 'debugMode') {
            if (this.data.debugMode && this.data.debugMode === true) {
                return true;
            } else {
                return false;
            }
        } else {
            return this.data[key];
        }
    }

    /**
     * 설정 값을 설정합니다.
     * @param {string} key - 설정 키
     * @param {*} value - 설정 값
     * @returns {Promise} 저장 완료 Promise
     */
    set(key, value) {
        this.data[key] = value;
        if (key === 'darkMode') {
            setTheme(value);
        }
        return this.save();
    }

    /**
     * 설정 값을 일괄 설정합니다.
     * @param {object} settings - 설정 객체
     * @returns {Promise} 저장 완료 Promise
     */
    setBatch(settings) {
        for (const key in settings) {
            this.data[key] = settings[key];
        }
        return this.save();
    }
}
