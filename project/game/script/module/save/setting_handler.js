const fs = require('fs');
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
            debugMode: false,
            darkMode: true,
            disableTransparency: false,
            reducePhysics: false,
            language: defaultLang,
            fullScreen: true,
            width: 1280,
            height: 720,
            renderScale: 100,
            colorBlindMode: false,
            uiScale: 100
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
            // 저장 경로가 존재하지 않으면 생성
            if (!fs.existsSync(this.dataDir)) {
                try {
                    fs.mkdirSync(this.dataDir, { recursive: true });
                } catch (e) {
                    console.error("Failed to create settings directory:", e);
                    reject(e);
                    return;
                }
            }

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
        }
        return this.save();
    }
}
