/**
 * 한 GameSystem session에서 물리 권위를 고정하는 mode입니다.
 * device loss는 GPU world를 재생성할 뿐 이 값을 바꾸지 않습니다.
 */
export const GAME_WORLD_SESSION_MODE = Object.freeze({
    GPU_WORLD: 'gpu-world',
    CPU_NO_WAVE_FALLBACK: 'cpu-no-wave-fallback'
});

/** enter 경계의 platform snapshot으로 session mode를 한 번 선택합니다. */
export function selectGameWorldSessionMode(webGpuPlatformPort) {
    return webGpuPlatformPort?.getState?.().ready === true
        ? GAME_WORLD_SESSION_MODE.GPU_WORLD
        : GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK;
}

/** 외부/테스트 입력 mode를 canonical 값으로 검증합니다. */
export function assertGameWorldSessionMode(mode) {
    if (mode !== GAME_WORLD_SESSION_MODE.GPU_WORLD
        && mode !== GAME_WORLD_SESSION_MODE.CPU_NO_WAVE_FALLBACK) {
        throw new RangeError(`지원하지 않는 game world session mode입니다: ${mode}`);
    }
    return mode;
}

/** mode와 선택적 wave/diagnostic 옵션의 관계를 한 곳에서 확정합니다. */
export function resolveGameWorldSessionPolicy(mode, options = {}) {
    const sessionMode = assertGameWorldSessionMode(mode);
    const gpuWorld = sessionMode === GAME_WORLD_SESSION_MODE.GPU_WORLD;
    return Object.freeze({
        sessionMode,
        gpuWorld,
        gameplayWorldActorsEnabled: gpuWorld
            && options.gameplayWorldActorsEnabled !== false,
        enemyWaveEnabled: gpuWorld && options.enemyWaveEnabled !== false
    });
}
