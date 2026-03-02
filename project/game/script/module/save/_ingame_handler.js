import { fsPromises, path, isNwRuntime } from 'util/nw_bridge.js';

/**
 * @class IngameHandler
 * @description 인게임 상태(JSON) 데이터를 로드/병합/저장합니다.
 * NW.js는 파일 저장, 브라우저는 localStorage 저장을 사용합니다.
 */
export class IngameHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.isNwRuntime = isNwRuntime();
        this.filePath = this.isNwRuntime ? path.join(this.dataDir, 'ingame.dat') : null;
        this.storageKey = 'cirvivor.save.ingame';
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
        await this._load();
    }

    /**
     * @private
     * 인게임 데이터 파일을 로드합니다.
     */
    async _load() {
        if (this.isNwRuntime) {
            let fileExists = false;
            try {
                await fsPromises.access(this.filePath);
                fileExists = true;
            } catch {
                fileExists = false;
            }

            if (fileExists) {
                try {
                    this.data = JSON.parse(await fsPromises.readFile(this.filePath, 'utf-8'));

                    // 병합 로직 (새로운 키가 추가되었을 경우를 대비)
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
                    console.error("Failed to load ingame data:", e);
                    this.data = JSON.parse(JSON.stringify(this.defaultData));
                }
            } else {
                this.data = JSON.parse(JSON.stringify(this.defaultData));
                await this.save();
            }
            return;
        }

        try {
            const raw = window.localStorage.getItem(this.storageKey);
            if (!raw) {
                this.data = JSON.parse(JSON.stringify(this.defaultData));
                await this.save();
                return;
            }

            this.data = JSON.parse(raw);
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
            console.error("Failed to load ingame data from localStorage:", e);
            this.data = JSON.parse(JSON.stringify(this.defaultData));
            await this.save();
        }
    }

    /**
     * 인게임 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    async save() {
        if (this.isNwRuntime) {
            try {
                await fsPromises.access(this.dataDir);
            } catch (e) {
                try {
                    await fsPromises.mkdir(this.dataDir, { recursive: true });
                } catch (mkdirError) {
                    console.error("Failed to create ingame data directory:", mkdirError);
                    throw mkdirError;
                }
            }
        }

        const dataStr = JSON.stringify(this.data, null, 4);

        if (this.isNwRuntime) {
            try {
                await fsPromises.writeFile(this.filePath, dataStr);
            } catch (err) {
                console.error("Failed to save ingame data:", err);
                throw err;
            }
            return;
        }

        try {
            window.localStorage.setItem(this.storageKey, dataStr);
        } catch (err) {
            console.error("Failed to save ingame data to localStorage:", err);
            throw err;
        }
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
