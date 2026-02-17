const fs = require('fs');
const path = require('path');

export class IngameHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'ingame.dat');
        this.data = {};
        this.defaultData = {
            current_level: 0,
            current_xp: 0,
            items: []
        };
    }

    /**
     * 인게임 데이터를 로드합니다.
     */
    async init() {
        this._load();
    }

    /**
     * @private
     * 인게임 데이터 파일을 로드합니다.
     */
    _load() {
        if (fs.existsSync(this.filePath)) {
            try {
                this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));

                // 병합 로직 (새로운 키가 추가되었을 경우를 대비)
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
                console.error("Failed to load ingame data:", e);
                this.data = JSON.parse(JSON.stringify(this.defaultData));
            }
        } else {
            this.data = JSON.parse(JSON.stringify(this.defaultData));
            this.save();
        }
    }

    /**
     * 인게임 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    save() {
        return new Promise((resolve, reject) => {
            // 저장 경로가 존재하지 않으면 생성
            if (!fs.existsSync(this.dataDir)) {
                try {
                    fs.mkdirSync(this.dataDir, { recursive: true });
                } catch (e) {
                    console.error("Failed to create ingame data directory:", e);
                    reject(e);
                    return;
                }
            }

            const dataStr = JSON.stringify(this.data, null, 4);
            fs.writeFile(this.filePath, dataStr, (err) => {
                if (err) {
                    console.error("Failed to save ingame data:", err);
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

    setData(key, value) {
        this.data[key] = value;
    }

    getValue(key) {
        return this.data[key];
    }
}
