const MULTICORE_SETTING_KEY = 'simulationWorkerAuthorityMode';

/**
 * 씬에서 시스템 핸들러를 반환합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 * @returns {object|null}
 */
export function getGameSceneSystemHandler(scene) {
    return scene?.sceneSystem?.systemHandler ?? null;
}

/**
 * 벤치마크 멀티코어 설정 활성 여부를 반환합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 * @returns {boolean}
 */
function isGameSceneBenchmarkMulticoreEnabled(scene) {
    const systemHandler = getGameSceneSystemHandler(scene);
    const saveSystem = systemHandler?.saveSystem;
    if (!saveSystem || typeof saveSystem.getSetting !== 'function') {
        return false;
    }

    return saveSystem.getSetting(MULTICORE_SETTING_KEY) === true;
}

/**
 * 벤치마크 멀티코어 버튼 라벨을 반환합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 * @returns {string}
 */
function getGameSceneBenchmarkMulticoreButtonLabel(scene) {
    return isGameSceneBenchmarkMulticoreEnabled(scene)
        ? 'Multicore: ON'
        : 'Multicore: OFF';
}

/**
 * 벤치마크 버튼 목록의 설정 의존 라벨을 동기화합니다.
 * @param {object|null|undefined} scene - 게임 씬 인스턴스입니다.
 */
export function syncGameSceneBenchmarkButtons(scene) {
    const buttons = Array.isArray(scene?.buttons) ? scene.buttons : [];
    for (let i = 0; i < buttons.length; i++) {
        const button = buttons[i];
        if (!button) continue;

        if (button.id === 'toggleMulticore') {
            button.label = getGameSceneBenchmarkMulticoreButtonLabel(scene);
        }
    }
}

/**
 * 벤치마크 멀티코어 설정을 토글하고 런타임 설정을 반영합니다.
 * @param {object} scene - 게임 씬 인스턴스입니다.
 * @param {() => void} resetBenchmarkWorld - 설정 적용 후 월드를 재생성할 콜백입니다.
 * @returns {Promise<void>}
 */
export async function toggleGameSceneBenchmarkMulticore(scene, resetBenchmarkWorld) {
    if (!scene || scene.isSimulationWorkerTogglePending) {
        return;
    }

    const systemHandler = getGameSceneSystemHandler(scene);
    const saveSystem = systemHandler?.saveSystem;
    if (!systemHandler
        || !saveSystem
        || typeof saveSystem.setSettingBatch !== 'function'
        || typeof systemHandler.applyRuntimeSettings !== 'function') {
        return;
    }

    const nextEnabled = !isGameSceneBenchmarkMulticoreEnabled(scene);
    const changedSettings = {
        [MULTICORE_SETTING_KEY]: nextEnabled
    };

    scene.isSimulationWorkerTogglePending = true;
    syncGameSceneBenchmarkButtons(scene);

    try {
        await saveSystem.setSettingBatch(changedSettings);
        syncGameSceneBenchmarkButtons(scene);
        await systemHandler.applyRuntimeSettings(changedSettings);
        if (typeof resetBenchmarkWorld === 'function') {
            resetBenchmarkWorld();
        }
    } catch (error) {
        console.error('벤치마크 멀티코어 토글 적용 실패:', error);
    } finally {
        scene.isSimulationWorkerTogglePending = false;
        syncGameSceneBenchmarkButtons(scene);
    }
}
