import { fsPromises, path } from 'util/nw_bridge.js';
import { INGAME_DEFAULT_DATA } from 'data/save/save_defaults.js';
import { cloneJsonData, ensureSaveDirectory, pathExists } from './_save_file_helper.js';

/**
 * @class IngameHandler
 * @description 인게임 상태(JSON) 데이터를 NW.js 로컬 파일로 로드/병합/저장합니다.
 * @param {string} dataDir - `ingame.dat`을 저장할 디렉터리 경로입니다.
 */
export class IngameHandler {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.filePath = path.join(this.dataDir, 'ingame.dat');
        this.data = {};
        this.defaultData = cloneJsonData(INGAME_DEFAULT_DATA);
    }

    /**
     * 인게임 데이터를 로드하고 누락된 기본 최상위 키를 보완합니다.
     * 내부 객체를 교체하므로 이전 `getData()` 반환 참조는 stale 상태가 됩니다.
     * @returns {Promise<void>} 로드와 필요한 기본 데이터 저장이 끝나면 이행됩니다.
     */
    async init() {
        await this.#load();
    }

    /**
     * @private
     * JSON 파일을 로드하고 값이 `undefined`인 기본 최상위 키만 직접 보완합니다.
     * 중첩 병합은 하지 않으며 `null`·`false`·`0`과 알 수 없는 키는 보존합니다.
     * 보완한 기본 배열·객체는 `defaultData`의 값과 같은 참조이고, 보완이 있으면 파일을 다시 저장합니다.
     * 읽기·파싱·병합·자동 보완 저장 실패 시 메모리를 기본 데이터 복사본으로 교체하므로 이전 live 참조는 stale 상태가 됩니다.
     * @returns {Promise<void>} 로드 또는 파일 부재 시 기본 데이터 저장이 끝나면 이행됩니다.
     */
    async #load() {
        const fileExists = await pathExists(this.filePath);

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
                console.error('인게임 데이터 로드 실패:', e);
                this.data = cloneJsonData(this.defaultData);
            }
        } else {
            this.data = cloneJsonData(this.defaultData);
            await this.save();
        }
    }

    /**
     * 저장 디렉터리를 준비하고 현재 live 객체를 4칸 들여쓰기 JSON으로 직렬화해 저장합니다.
     * 직렬화 오류와 파일 쓰기 오류는 호출자에게 전파되며, 파일 쓰기 오류만 여기서 로그를 남깁니다.
     * @returns {Promise<void>} 파일 쓰기가 끝나면 이행됩니다.
     */
    async save() {
        await ensureSaveDirectory(this.dataDir, '인게임 데이터');

        const dataStr = JSON.stringify(this.data, null, 4);

        try {
            await fsPromises.writeFile(this.filePath, dataStr);
        } catch (err) {
            console.error('인게임 데이터 저장 실패:', err);
            throw err;
        }
    }

    /**
     * 현재 내부 인게임 데이터 객체의 live 참조를 반환합니다.
     * 반환 객체 변경은 메모리에 즉시 반영되지만 자동 저장하지 않습니다.
     * 이후 `init()`이 객체를 교체하면 이전 참조는 stale 상태가 됩니다.
     * @returns {object} 현재 내부 인게임 데이터 객체의 live 참조입니다.
     */
    getData() {
        return this.data;
    }

    /**
     * 현재 live 객체의 단일 최상위 키를 변경하며 자동 저장하지 않습니다.
     * @param {string} key - 저장할 키입니다.
     * @param {*} value - 저장할 값입니다.
     * @returns {void}
     */
    setData(key, value) {
        this.data[key] = value;
    }

    /**
     * 특정 최상위 키의 값을 반환합니다. 객체나 배열 값은 내부의 live 참조입니다.
     * @param {string} key - 조회할 키입니다.
     * @returns {*} 해당하는 인게임 값 또는 live 객체·배열 참조입니다.
     */
    getValue(key) {
        return this.data[key];
    }
}
