/**
 * 설정 파일 객체에 지원이 끝난 키와 값을 현재 형식으로 마이그레이션합니다.
 * @param {Record<string, *>} fileData - JSON에서 읽은 설정 객체입니다.
 * @returns {boolean} 다시 저장해야 하는 변경이 발생했는지 여부입니다.
 */
export function migrateLegacySettingData(fileData) {
    let needsSave = false;

    if (fileData.physicsAccuracy !== undefined || fileData.physicsFps !== undefined) {
        delete fileData.physicsAccuracy;
        delete fileData.physicsFps;
        needsSave = true;
    }

    if (fileData.windowMode === 'borderless') {
        fileData.windowMode = 'fullscreen';
        needsSave = true;
    } else if (fileData.windowMode !== undefined
        && fileData.windowMode !== 'fullscreen'
        && fileData.windowMode !== 'windowed') {
        fileData.windowMode = 'windowed';
        needsSave = true;
    }

    if (fileData.theme === undefined && typeof fileData.darkMode === 'boolean') {
        fileData.theme = fileData.darkMode ? 'dark' : 'light';
        needsSave = true;
    }

    if (fileData.simulationWorkerAuthorityMode !== undefined
        || fileData.simulationWorkerShadowMode !== undefined
        || fileData.simulationWorkerPresentationMode !== undefined) {
        delete fileData.simulationWorkerAuthorityMode;
        delete fileData.simulationWorkerShadowMode;
        delete fileData.simulationWorkerPresentationMode;
        needsSave = true;
    }

    return needsSave;
}
