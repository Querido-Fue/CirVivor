import { fsPromises, path, isNwRuntime } from 'util/nw_bridge.js';

/**
 * @class ProgressHandler
 * @description 진행도 바이너리 데이터를 로드/저장합니다.
 * NW.js는 파일 저장, 브라우저는 localStorage(Base64) 저장을 사용합니다.
 */
export class ProgressHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.isNwRuntime = isNwRuntime();
        this.filePath = this.isNwRuntime ? path.join(this.dataDir, 'progress.dat') : null;
        this.storageKey = 'cirvivor.save.progress';
        this.defaultData = new Uint8Array(128);
        this.data = new Uint8Array(this.defaultData);
    }

    /**
     * 진행 데이터를 로드합니다.
     */
    async init() {
        await this._load();
    }

    /**
     * @private
     * 진행 데이터 파일을 로드합니다.
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
                    const readData = await fsPromises.readFile(this.filePath);
                    this.data = this._fitDataLength(this._normalizeData(readData));
                } catch (e) {
                    console.error("Failed to load progress data:", e);
                    this.data = new Uint8Array(this.defaultData);
                }
            } else {
                this.data = new Uint8Array(this.defaultData);
                await this.save();
            }
            return;
        }

        try {
            const encoded = window.localStorage.getItem(this.storageKey);
            if (!encoded) {
                this.data = new Uint8Array(this.defaultData);
                await this.save();
                return;
            }

            this.data = this._fitDataLength(this._decodeBase64(encoded));
        } catch (e) {
            console.error("Failed to load progress data from localStorage:", e);
            this.data = new Uint8Array(this.defaultData);
            await this.save();
        }
    }

    _normalizeData(data) {
        if (data instanceof Uint8Array) {
            return new Uint8Array(data);
        }

        if (Array.isArray(data)) {
            return Uint8Array.from(data);
        }

        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
            return new Uint8Array(data);
        }

        return new Uint8Array(this.defaultData);
    }

    _fitDataLength(data) {
        const fixed = new Uint8Array(this.defaultData);
        fixed.set(data.subarray(0, fixed.length));
        return fixed;
    }

    _encodeBase64(uint8) {
        if (typeof btoa === 'function') {
            let binary = '';
            for (let i = 0; i < uint8.length; i++) {
                binary += String.fromCharCode(uint8[i]);
            }
            return btoa(binary);
        }

        if (typeof Buffer !== 'undefined') {
            return Buffer.from(uint8).toString('base64');
        }

        throw new Error('Base64 encoder is not available.');
    }

    _decodeBase64(base64Text) {
        if (typeof atob === 'function') {
            const binary = atob(base64Text);
            const uint8 = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                uint8[i] = binary.charCodeAt(i);
            }
            return uint8;
        }

        if (typeof Buffer !== 'undefined') {
            return new Uint8Array(Buffer.from(base64Text, 'base64'));
        }

        throw new Error('Base64 decoder is not available.');
    }

    /**
     * 진행 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    async save() {
        if (this.isNwRuntime) {
            try {
                await fsPromises.access(this.dataDir);
            } catch {
                try {
                    await fsPromises.mkdir(this.dataDir, { recursive: true });
                } catch (e) {
                    console.error("Failed to create progress directory:", e);
                    throw e;
                }
            }

            try {
                await fsPromises.writeFile(this.filePath, this.data);
            } catch (err) {
                console.error("Failed to save progress data:", err);
                throw err;
            }
        } else {
            try {
                window.localStorage.setItem(this.storageKey, this._encodeBase64(this.data));
            } catch (err) {
                console.error("Failed to save progress data to localStorage:", err);
                throw err;
            }
        }
    }

    getData() {
        return this.data;
    }

    setData(data) {
        this.data = this._fitDataLength(this._normalizeData(data));
    }
}
