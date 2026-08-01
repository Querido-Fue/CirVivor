/** 타이틀 표시 파이프라인의 상호 배타적인 rollout mode입니다. */
export const TITLE_PIPELINE_MODE = Object.freeze({
    LEGACY_WEBGL: 'legacy-webgl',
    WEBGPU_KAWASE: 'webgpu-kawase',
    WEBGPU_GAUSSIAN: 'webgpu-gaussian'
});

/** 타이틀 배경 body simulation의 상호 배타적인 rollout mode입니다. */
export const TITLE_SIMULATION_MODE = Object.freeze({
    CPU: 'cpu',
    GPU: 'gpu'
});

const VALID_PIPELINE_MODES = new Set(Object.values(TITLE_PIPELINE_MODE));
const VALID_SIMULATION_MODES = new Set(Object.values(TITLE_SIMULATION_MODE));

/** production은 최종 성능·시각 승인 전까지 기존 경로를 유지합니다. */
export const DEFAULT_TITLE_GPU_ROLLOUT_PROFILE = Object.freeze({
    pipelineMode: TITLE_PIPELINE_MODE.LEGACY_WEBGL,
    simulationMode: TITLE_SIMULATION_MODE.CPU,
    source: 'production-default'
});

let testOverride = null;

/**
 * 새 Loading→Title session에 고정할 immutable rollout profile을 만듭니다.
 * @returns {Readonly<{pipelineMode:string,simulationMode:string,source:string}>} session profile입니다.
 */
export function createTitleGpuRolloutProfile() {
    if (!testOverride) {
        return DEFAULT_TITLE_GPU_ROLLOUT_PROFILE;
    }
    return Object.freeze({ ...testOverride });
}

/**
 * 성능/계약 하네스 전용 다음 session override를 설정합니다.
 * production 호출부는 이 API를 사용하지 않으며 null은 override를 해제합니다.
 * @param {{pipelineMode:string,simulationMode:string}|null} profile - 검증할 profile입니다.
 * @returns {Readonly<object>|null} 정규화된 override입니다.
 */
export function setTitleGpuRolloutTestOverride(profile) {
    if (profile === null) {
        testOverride = null;
        return null;
    }
    testOverride = validateTitleGpuRolloutProfile(profile, 'test-override');
    return testOverride;
}

/**
 * 외부 입력을 fail-closed로 검증하고 mode 조합 제약을 적용합니다.
 * @param {object} profile - 검사할 pipeline/simulation mode입니다.
 * @param {string} [source='validated'] - 결과 진단 source입니다.
 * @returns {Readonly<object>} 검증된 immutable profile입니다.
 */
export function validateTitleGpuRolloutProfile(profile, source = 'validated') {
    if (!profile || typeof profile !== 'object') {
        throw new TypeError('Title GPU rollout profile must be an object.');
    }
    const pipelineMode = profile.pipelineMode;
    const simulationMode = profile.simulationMode;
    if (!VALID_PIPELINE_MODES.has(pipelineMode)) {
        throw new RangeError(`Unsupported title pipeline mode: ${String(pipelineMode)}`);
    }
    if (!VALID_SIMULATION_MODES.has(simulationMode)) {
        throw new RangeError(`Unsupported title simulation mode: ${String(simulationMode)}`);
    }
    if (simulationMode === TITLE_SIMULATION_MODE.GPU
        && pipelineMode === TITLE_PIPELINE_MODE.LEGACY_WEBGL) {
        throw new RangeError('GPU title simulation requires a WebGPU title pipeline.');
    }
    return Object.freeze({
        pipelineMode,
        simulationMode,
        source: typeof source === 'string' && source ? source : 'validated'
    });
}
