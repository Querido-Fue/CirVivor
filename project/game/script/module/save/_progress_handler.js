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
        await this.#load();
    }

    /**
     * @private
     * 진행 데이터 파일을 로드합니다.
     */
    async #load() {
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
                    this.data = this.#fitDataLength(this.#normalizeData(readData));
                } catch (e) {
                    console.error('진행 데이터 로드 실패:', e);
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

            this.data = this.#fitDataLength(this.#decodeBase64(encoded));
        } catch (e) {
            console.error('localStorage에서 진행 데이터 로드 실패:', e);
            this.data = new Uint8Array(this.defaultData);
            await this.save();
        }
    }

    /**
         * @private
         * 입력된 진행 데이터를 항상 Uint8Array 꼴로 정규화합니다.
         * @param {*} data 정규화할 원본 데이터
         * @returns {Uint8Array} 정규화된 바이트 배열
         */
    #normalizeData(data) {
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

    /**
         * @private
         * 데이터의 크기를 디폴트 데이터 배열 크기(128바이트)에 맞게 강제 맞춥니다.
         * @param {Uint8Array} data 원본 배열
         * @returns {Uint8Array} 크기가 맞춰진 배열
         */
    #fitDataLength(data) {
        const fixed = new Uint8Array(this.defaultData);
        fixed.set(data.subarray(0, fixed.length));
        return fixed;
    }

    /**
         * @private
         * 바이너리 데이터를 Base64 텍스트로 인코딩합니다 (브라우저 또는 Buffer 사용).
         * @param {Uint8Array} uint8 인코딩할 데이터
         * @returns {string} Base64 문자열
         */
    #encodeBase64(uint8) {
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

        throw new Error('Base64 인코더를 사용할 수 없습니다.');
    }

    /**
         * @private
         * Base64 텍스트를 바이너리 배열로 디코딩합니다.
         * @param {string} base64Text 디코딩할 Base64 문자열
         * @returns {Uint8Array} 디코딩된 바이트 배열
         */
    #decodeBase64(base64Text) {
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

        throw new Error('Base64 디코더를 사용할 수 없습니다.');
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
                    console.error('진행 데이터 디렉토리 생성 실패:', e);
                    throw e;
                }
            }

            try {
                await fsPromises.writeFile(this.filePath, this.data);
            } catch (err) {
                console.error('진행 데이터 저장 실패:', err);
                throw err;
            }
        } else {
            try {
                window.localStorage.setItem(this.storageKey, this.#encodeBase64(this.data));
            } catch (err) {
                console.error('localStorage에 진행 데이터 저장 실패:', err);
                throw err;
            }
        }
    }

    /**
         * 현재 로드된 진행 데이터 배열을 가져옵니다.
         * @returns {Uint8Array} 진행 데이터 배열
         */
    getData() {
        return this.data;
    }

    /**
         * 외부에서 덮어쓸 새로운 진행 데이터를 적용하고 길이와 타입을 정규화합니다.
         * @param {Uint8Array|Array} data 새로운 진행 데이터
         */
    setData(data) {
        this.data = this.#fitDataLength(this.#normalizeData(data));
    }
}
