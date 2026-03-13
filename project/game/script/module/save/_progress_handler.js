import { fsPromises, path } from 'util/nw_bridge.js';

/**
 * @class ProgressHandler
 * @description 진행도 바이너리 데이터를 NW.js 로컬 파일로 로드/저장합니다.
 */
export class ProgressHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'progress.dat');
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
     * 진행 데이터를 저장합니다.
     * @returns {Promise} 저장 완료 Promise
     */
    async save() {
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
