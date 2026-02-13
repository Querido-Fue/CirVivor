const fs = require('fs');
const path = require('path');

export class ProgressHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'progress.dat');
        this.data = null;
        this.defaultData = Buffer.alloc(128).fill(0);
    }

    /**
     * 진행 데이터를 로드합니다.
     */
    async init() {
        this._load();
    }

    /**
     * @private
     * 진행 데이터 파일을 로드합니다.
     */
    _load() {
        if (fs.existsSync(this.filePath)) {
            try {
                this.data = fs.readFileSync(this.filePath);
            } catch (e) {
                console.error("Failed to load progress data:", e);
                this.data = Buffer.from(this.defaultData);
            }
        } else {
            this.data = Buffer.from(this.defaultData);
            this.save();
        }
    }

    /**
     * 진행 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    save() {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.filePath, this.data, (err) => {
                if (err) {
                    console.error("Failed to save progress data:", err);
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

    setData(data) {
        this.data = data;
    }
}
