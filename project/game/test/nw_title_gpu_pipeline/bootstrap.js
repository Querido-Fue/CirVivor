import {
    resetRetiredWebGLGpuTelemetry,
    resetWebGLGpuTelemetryFrameId,
    setWebGLGpuTelemetryEnabled
} from 'display/webgl/_webgl_gpu_telemetry_state.js';

const DEFAULT_SEED = 0x719;
const DEFAULT_CLOCK_STEP_MS = 1000 / 60;

/**
 * launcher가 전달한 JSON 설정을 동기적으로 읽습니다.
 * production module 평가 전에 seed와 telemetry 상태를 고정해야 하므로 파일 I/O를 사용하지 않습니다.
 * @returns {object} 하네스 설정입니다.
 */
function readHarnessConfig() {
    const source = globalThis.process?.env?.CIRVIVOR_TITLE_GPU_CONFIG;
    if (!source) {
        return {};
    }
    try {
        return JSON.parse(source);
    } catch (error) {
        throw new Error(`타이틀 GPU 하네스 설정 JSON이 올바르지 않습니다: ${error.message}`);
    }
}

/**
 * 32-bit seed 기반 mulberry32 난수 함수를 만듭니다.
 * @param {number} seed - unsigned 32-bit seed입니다.
 * @returns {() => number} [0, 1) 난수 함수입니다.
 */
function createMulberry32(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * production MathUtil이 사용하는 전역 Math.random을 deterministic PRNG로 교체합니다.
 * @param {number} seed - 고정 seed입니다.
 * @returns {void}
 */
function installSeededRandom(seed) {
    Math.random = createMulberry32(seed);
}

/**
 * production App 할당을 첫 frame 전에 관찰할 수 있는 bridge를 설치합니다.
 * @returns {object} bridge API입니다.
 */
function installGameAssignmentBridge() {
    let gameValue;
    const listeners = new Set();
    const bridge = {
        getGame: () => gameValue,
        onGameAssigned(listener) {
            if (typeof listener !== 'function') {
                throw new TypeError('Game listener는 함수여야 합니다.');
            }
            listeners.add(listener);
            if (gameValue) {
                listener(gameValue);
            }
            return () => listeners.delete(listener);
        }
    };

    Object.defineProperty(window, 'Game', {
        configurable: true,
        enumerable: true,
        get() {
            return gameValue;
        },
        set(value) {
            gameValue = value;
            for (const listener of listeners) {
                listener(value);
            }
        }
    });
    return bridge;
}

/**
 * native rAF cadence를 유지하면서 presentation timestamp만 고정 간격으로 전진시킵니다.
 * 같은 native frame의 callback들은 반드시 같은 timestamp를 받습니다.
 * @param {number} stepMs - 합성 frame 간격입니다.
 * @param {object} bridge - Game 조회 bridge입니다.
 * @returns {void}
 */
function installSyntheticRafClock(stepMs, bridge) {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    let previousNativeTimestamp = null;
    let syntheticTimestamp = null;

    window.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((nativeTimestamp) => {
        if (previousNativeTimestamp === null || Math.abs(nativeTimestamp - previousNativeTimestamp) > 0.001) {
            if (syntheticTimestamp === null) {
                const gameTimestamp = Number(bridge.getGame()?.lastFrameTimestamp);
                syntheticTimestamp = Number.isFinite(gameTimestamp) && gameTimestamp > 0
                    ? gameTimestamp + stepMs
                    : nativeTimestamp;
            } else {
                syntheticTimestamp += stepMs;
            }
            previousNativeTimestamp = nativeTimestamp;
        }
        callback(syntheticTimestamp);
    });
    window.cancelAnimationFrame = (requestId) => nativeCancelAnimationFrame(requestId);
}

const config = readHarnessConfig();
const seed = Number.isFinite(config.seed) ? Number(config.seed) : DEFAULT_SEED;
const clockStepMs = Number.isFinite(config.clockStepMs) && config.clockStepMs > 0
    ? Number(config.clockStepMs)
    : DEFAULT_CLOCK_STEP_MS;

resetRetiredWebGLGpuTelemetry();
resetWebGLGpuTelemetryFrameId();
setWebGLGpuTelemetryEnabled(config.timing === true);
installSeededRandom(seed);
const bridge = installGameAssignmentBridge();
installSyntheticRafClock(clockStepMs, bridge);

globalThis.__CIRVIVOR_TITLE_GPU_HARNESS__ = Object.freeze({
    config: Object.freeze({ ...config, seed, clockStepMs, rngAlgorithm: 'mulberry32-v1' }),
    getGame: bridge.getGame,
    onGameAssigned: bridge.onGameAssigned
});
