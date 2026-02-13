const fs = require('fs');
const path = require('path');
import { setTheme } from '../display/theme_handler.js';

export class SettingHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'settings.json');
        this.data = {};
        this.defaultData = {
            debugMode: false,
            darkMode: false,
            disableTransparency: false,
            reducePhysics: false,
            language: 'korean',
            fullScreen: true,
            width: 1280,
            height: 720,
            renderScale: 100
        };
    }

    /**
     * 설정 데이터를 로드합니다.
     */
    async init() {
        this._load();
    }

    /**
     * @private
     * 설정 데이터 파일을 로드합니다.
     */
    _load() {
        if (fs.existsSync(this.filePath)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

                // 병합 로직
                let updated = false;
                for (const key in this.defaultData) {
                    if (this.data[key] === undefined) {
                        this.data[key] = this.defaultData[key];
                        updated = true;
                    }
                }

                if (updated) {
                    this.save();
                }

            } catch (e) {
                console.error("Failed to load settings:", e);
                this.data = JSON.parse(JSON.stringify(this.defaultData));
                this.save();
            }
        } else {
            this.data = JSON.parse(JSON.stringify(this.defaultData));
            this.save();
        }
    }

    /**
     * 설정 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    save() {
        return new Promise((resolve, reject) => {
            const dataStr = JSON.stringify(this.data, null, 4);
            fs.writeFile(this.filePath, dataStr, (err) => {
                if (err) {
                    console.error("Failed to save settings:", err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    getData() {
        return this.data;
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
        if (key === 'darkMode') {
            setTheme(value);
        }
        return this.save();
    }

    setBatch(settings) {
        for (const key in settings) {
            this.data[key] = settings[key];
            if (key === 'darkMode') {
                setTheme(settings[key]);
            }
        }
        return this.save();
    }
}
