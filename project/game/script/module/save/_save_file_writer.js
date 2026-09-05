import { fsPromises, randomUUID } from 'util/nw_bridge.js';

const pendingWrites = new Map();

/**
 * 호출 시점의 데이터를 같은 디렉터리의 임시 파일에 쓴 뒤 rename으로 교체합니다.
 * 동일 경로의 저장은 호출 순서를 지키며, 실패한 요청은 이후 저장을 막지 않습니다.
 * @param {string} filePath - 저장할 파일 경로입니다.
 * @param {string|Uint8Array} data - 직렬화된 JSON 또는 진행도 바이트입니다.
 * @returns {Promise<void>} 이 요청의 파일 교체가 끝나면 이행됩니다.
 */
export function writeSaveFile(filePath, data) {
    const snapshot = typeof data === 'string' ? data : new Uint8Array(data);
    const previous = pendingWrites.get(filePath) ?? Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
        const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
        let temporaryPathOwned = false;
        try {
            try {
                await fsPromises.writeFile(temporaryPath, snapshot, { flag: 'wx' });
                temporaryPathOwned = true;
            } catch (error) {
                // 배타적 생성이 거부된 파일은 이 요청이 만든 파일이 아닙니다.
                temporaryPathOwned = error?.code !== 'EEXIST';
                throw error;
            }
            await fsPromises.rename(temporaryPath, filePath);
        } finally {
            if (temporaryPathOwned) {
                await fsPromises.unlink(temporaryPath).catch(() => {});
            }
        }
    });
    pendingWrites.set(filePath, write);
    return write.finally(() => {
        if (pendingWrites.get(filePath) === write) pendingWrites.delete(filePath);
    });
}
