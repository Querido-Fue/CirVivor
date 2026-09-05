import { fsPromises } from 'util/nw_bridge.js';

/**
 * 파일 또는 디렉터리에 접근할 수 있는지 확인합니다.
 * 파일 부재(ENOENT)만 false로 처리하고 권한·I/O 오류는 호출자에게 전파합니다.
 * @param {string} targetPath - 확인할 경로입니다.
 * @returns {Promise<boolean>} 접근 가능하면 true, 경로가 없으면 false입니다.
 */
export const pathExists = async (targetPath) => {
    try {
        await fsPromises.access(targetPath);
        return true;
    } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
    }
};

/**
 * 접근 가능한 경로가 없으면 `mkdir({ recursive: true })`로 저장 디렉터리를 생성합니다.
 * 접근 가능한 경로는 `stat()` 없이 반환하므로 실제 디렉터리인지 확인하지 않습니다.
 * 접근 오류는 생성 시도 없이 전파하며, 생성 실패는 로그 후 호출자에게 전파됩니다.
 * @param {string} dataDir - 저장 디렉터리 경로입니다.
 * @param {string} errorLabel - 실패 로그에 사용할 데이터 이름입니다.
 * @returns {Promise<void>} 접근 가능한 경로 확인 또는 디렉터리 생성이 끝나면 이행됩니다.
 */
export const ensureSaveDirectory = async (dataDir, errorLabel) => {
    if (await pathExists(dataDir)) {
        return;
    }

    try {
        await fsPromises.mkdir(dataDir, { recursive: true });
    } catch (error) {
        console.error(`${errorLabel} 디렉토리 생성 실패:`, error);
        throw error;
    }
};

/**
 * 데이터를 `JSON.stringify()`와 `JSON.parse()`로 왕복해 복제합니다.
 * 배열과 JSON 원시값도 허용하며, JSON 규칙에 따라 값이 변환·제거될 수 있습니다.
 * getter·`toJSON()`·Proxy 등 사용자 직렬화 동작이 던진 예외도 그대로 전파합니다.
 * @param {*} data - JSON 왕복할 값입니다.
 * @returns {*} JSON 파싱으로 생성된 복제 값입니다.
 * @throws {TypeError|SyntaxError} 순환 참조·`BigInt`를 직렬화할 수 없거나 stringify 결과를 파싱할 수 없을 때 발생합니다.
 */
export const cloneJsonData = (data) => JSON.parse(JSON.stringify(data));
