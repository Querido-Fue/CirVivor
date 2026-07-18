import { fsPromises, path } from 'util/nw_bridge.js';
import { ensureSaveDirectory, pathExists } from './_save_file_helper.js';

/**
 * @class ProgressHandler
 * @description 진행도 바이너리 데이터를 NW.js 로컬 파일로 로드/저장합니다.
 * @param {string} dataDir - `progress.dat`을 저장할 디렉터리 경로입니다.
 */
export class ProgressHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'progress.dat');
        this.defaultData = new Uint8Array(128);
        this.data = new Uint8Array(this.defaultData);
    }

    /**
     * 진행 데이터를 로드하며, 파일이 없으면 기본 128바이트 데이터를 생성해 저장합니다.
     * 내부 배열을 교체하므로 이전 `getData()` 반환 참조는 stale 상태가 됩니다.
     * @returns {Promise<void>} 로드 또는 파일 부재 시 기본 데이터 저장이 끝나면 이행됩니다.
     */
    async init() {
        await this.#load();
    }

    /**
     * @private
     * 진행 데이터 파일을 새 배열로 로드하고 기본 길이에 맞춥니다.
     * 파일 부재 시 기본값을 저장하지만, 기존 파일 읽기 실패 시 메모리만 기본값으로 복구합니다.
     * 어느 경우든 `this.data`를 교체하므로 이전 live 참조는 stale 상태가 됩니다.
     * @returns {Promise<void>} 로드 또는 필요한 기본 데이터 저장이 끝나면 이행됩니다.
     */
    async #load() {
        const fileExists = await pathExists(this.filePath);

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
     * 현재 realm의 `Uint8Array`, 일반 배열 또는 `Buffer.isBuffer()`로 확인되는 Buffer를 새 `Uint8Array`로 복제·변환합니다.
     * 다른 realm의 일반 `Uint8Array`를 포함한 나머지 값은 기본 데이터 사본으로 대체합니다.
     * @param {*} data - 정규화할 원본 데이터입니다.
     * @returns {Uint8Array} 입력과 별개인 정규화된 바이트 배열입니다.
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
     * 현재 기본 데이터 길이(기본 128바이트)의 새 배열을 만들고 입력 초과분은 자르며 부족분은 기본값으로 채웁니다.
     * @param {Uint8Array} data - 복사할 원본 배열입니다.
     * @returns {Uint8Array} 현재 기본 데이터 길이에 맞춘 새 배열입니다.
     */
    #fitDataLength(data) {
        const fixed = new Uint8Array(this.defaultData);
        fixed.set(data.subarray(0, fixed.length));
        return fixed;
    }

    /**
     * 저장 디렉터리를 준비한 뒤 그 시점의 live 진행 데이터 배열을 파일에 씁니다.
     * 디렉터리 준비 또는 파일 쓰기 실패는 호출자에게 전파됩니다.
     * @returns {Promise<void>} 파일 쓰기가 끝나면 이행됩니다.
     */
    async save() {
        await ensureSaveDirectory(this.dataDir, '진행 데이터');

        try {
            await fsPromises.writeFile(this.filePath, this.data);
        } catch (err) {
            console.error('진행 데이터 저장 실패:', err);
            throw err;
        }
    }

    /**
     * 현재 내부 진행 데이터의 live 참조를 반환합니다.
     * 반환 배열 변경은 메모리에 즉시 반영되지만 자동 저장하지 않습니다.
     * 이후 `init()` 또는 `setData()`가 배열을 교체하면 이전 참조는 stale 상태가 됩니다.
     * @returns {Uint8Array} 현재 내부 진행 데이터 배열의 live 참조입니다.
     */
    getData() {
        return this.data;
    }

    /**
     * 값을 새 `Uint8Array`로 정규화해 내부 배열을 교체하며 자동 저장하지 않습니다.
     * 현재 realm의 `Uint8Array`, 일반 배열과 식별 가능한 Buffer 외의 값은 기본 데이터 사본으로 대체합니다.
     * @param {*} data - 적용할 진행 데이터입니다.
     * @returns {void}
     */
    setData(data) {
        this.data = this.#fitDataLength(this.#normalizeData(data));
    }
}
