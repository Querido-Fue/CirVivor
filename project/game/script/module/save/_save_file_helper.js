import { fsPromises } from 'util/nw_bridge.js';

/**
 * 파일 또는 디렉터리가 존재하는지 확인합니다.
 * @param {string} targetPath - 확인할 경로입니다.
 * @returns {Promise<boolean>} 접근 가능하면 true입니다.
 */
export const pathExists = async (targetPath) => {
    try {
        await fsPromises.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

/**
 * 저장 디렉터리가 없으면 생성합니다.
 * @param {string} dataDir - 저장 디렉터리 경로입니다.
 * @param {string} errorLabel - 실패 로그에 사용할 데이터 이름입니다.
 * @returns {Promise<void>}
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
 * JSON 직렬화 가능한 데이터를 깊은 복사합니다.
 * @param {object} data - 복사할 데이터입니다.
 * @returns {object} 복사된 데이터입니다.
 */
export const cloneJsonData = (data) => JSON.parse(JSON.stringify(data));
