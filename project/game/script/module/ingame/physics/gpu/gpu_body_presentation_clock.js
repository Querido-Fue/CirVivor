/**
 * GPU 원형 바디가 사용할 표현 위치 정책입니다.
 * 원본의 명칭과 실제 동작(전방 외삽)을 구분해 문자열로 고정합니다.
 */
export const GPU_BODY_PRESENTATION_PROFILE = Object.freeze({
    STRICT_INTERPOLATION: 'strict-interpolation',
    REFERENCE_CLOCK_EXTRAPOLATION: 'reference-clock-extrapolation',
    CAPPED_ACCUMULATOR_EXTRAPOLATION: 'capped-accumulator-extrapolation'
});

/** 셰이더의 `presentation_mode` 값입니다. */
export const GPU_BODY_PRESENTATION_SHADER_MODE = Object.freeze({
    STRICT_INTERPOLATION: 0,
    EXTRAPOLATION: 1
});

const PROFILE_VALUES = new Set(Object.values(GPU_BODY_PRESENTATION_PROFILE));

function normalizeNonNegativeFinite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function normalizeFrameId(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function differenceU32Milliseconds(renderSeconds, simulationSeconds) {
    const renderMilliseconds = Math.round(renderSeconds * 1000) >>> 0;
    const simulationMilliseconds = Math.round(simulationSeconds * 1000) >>> 0;
    return Math.fround(((renderMilliseconds - simulationMilliseconds) >>> 0) * 0.001);
}

/**
 * @class GpuBodyPresentationClock
 * @description 물리 clock과 표현 clock을 분리하며 authoritative 물리 상태를 변경하지 않습니다.
 */
export class GpuBodyPresentationClock {
    /**
     * @param {{profile?:string}} [options={}] - 초기 표현 정책입니다.
     */
    constructor(options = {}) {
        const profile = options.profile
            ?? GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION;
        if (!PROFILE_VALUES.has(profile)) {
            throw new RangeError(`지원하지 않는 GPU body presentation profile입니다: ${profile}`);
        }
        this.profile = profile;
        this.simulationTime = 0;
        this.renderTime = 0;
        this.lastRenderedFrame = 0;
        this.autoFrameId = 0;
        this.fixedDelta = 0;
        this.interpolationAlpha = 0;
        this.predictionDelta = 0;
        this.shaderState = {
            presentationMode: GPU_BODY_PRESENTATION_SHADER_MODE.EXTRAPOLATION,
            predictionDelta: 0,
            interpolationAlpha: 0
        };
    }

    /**
     * 물리 틱 직후 원본처럼 render clock을 simulation clock에 다시 맞춥니다.
     * @param {number} fixedDelta - 초 단위 fixed delta입니다.
     * @param {number} [renderFrameId] - 현재 렌더 프레임 식별자입니다.
     * @returns {void}
     */
    advancePhysics(fixedDelta, renderFrameId = this.lastRenderedFrame) {
        const delta = normalizeNonNegativeFinite(fixedDelta, NaN);
        if (!(delta > 0)) {
            throw new RangeError(`GPU body fixed delta는 양수여야 합니다: ${fixedDelta}`);
        }
        const frameId = normalizeFrameId(renderFrameId, this.lastRenderedFrame);
        this.fixedDelta = delta;
        this.simulationTime += delta;
        this.renderTime = this.simulationTime;
        this.lastRenderedFrame = frameId;
        this.autoFrameId = Math.max(this.autoFrameId, frameId);
        this.predictionDelta = 0;
    }

    /**
     * 렌더 프레임의 표현 계수를 계산합니다. reference profile은 같은 frame ID에서 두 번 진행하지 않습니다.
     * @param {{frameDelta?:number,fixedDelta?:number,fixedAlpha?:number,renderFrameId?:number}} [frame={}] - 프레임 입력입니다.
     * @returns {{presentationMode:number,predictionDelta:number,interpolationAlpha:number}} 셰이더 입력 snapshot입니다.
     */
    advanceRender(frame = {}) {
        const implicitFrameId = this.autoFrameId + 1;
        const frameId = normalizeFrameId(frame.renderFrameId, implicitFrameId);
        this.autoFrameId = Math.max(this.autoFrameId, frameId);
        this.interpolationAlpha = Math.min(
            1,
            normalizeNonNegativeFinite(frame.fixedAlpha, 0)
        );

        if (this.profile === GPU_BODY_PRESENTATION_PROFILE.REFERENCE_CLOCK_EXTRAPOLATION) {
            if (frameId > this.lastRenderedFrame) {
                this.renderTime += normalizeNonNegativeFinite(frame.frameDelta, 0);
                this.lastRenderedFrame = frameId;
            }
            this.predictionDelta = differenceU32Milliseconds(
                this.renderTime,
                this.simulationTime
            );
        } else if (
            this.profile
            === GPU_BODY_PRESENTATION_PROFILE.CAPPED_ACCUMULATOR_EXTRAPOLATION
        ) {
            const fixedDelta = normalizeNonNegativeFinite(
                frame.fixedDelta,
                this.fixedDelta
            );
            this.predictionDelta = Math.min(
                fixedDelta,
                Math.max(0, this.interpolationAlpha * fixedDelta)
            );
            this.lastRenderedFrame = Math.max(this.lastRenderedFrame, frameId);
        } else {
            this.predictionDelta = 0;
            this.lastRenderedFrame = Math.max(this.lastRenderedFrame, frameId);
        }

        return this.getShaderState(this.shaderState);
    }

    /**
     * pause, teleport, session reset에서 남은 예측 시간을 제거합니다.
     * @param {number} [renderFrameId] - 동기화할 렌더 프레임 식별자입니다.
     * @returns {void}
     */
    synchronize(renderFrameId = this.lastRenderedFrame) {
        const frameId = normalizeFrameId(renderFrameId, this.lastRenderedFrame);
        this.renderTime = this.simulationTime;
        this.predictionDelta = 0;
        this.lastRenderedFrame = frameId;
        this.autoFrameId = Math.max(this.autoFrameId, frameId);
    }

    /**
     * 셰이더 uniform용 표현 상태를 재사용 객체에 기록합니다.
     * @param {object} [out={}] - 기록 대상입니다.
     * @returns {{presentationMode:number,predictionDelta:number,interpolationAlpha:number}} 같은 대상입니다.
     */
    getShaderState(out = {}) {
        out.presentationMode = this.profile === GPU_BODY_PRESENTATION_PROFILE.STRICT_INTERPOLATION
            ? GPU_BODY_PRESENTATION_SHADER_MODE.STRICT_INTERPOLATION
            : GPU_BODY_PRESENTATION_SHADER_MODE.EXTRAPOLATION;
        out.predictionDelta = this.predictionDelta;
        out.interpolationAlpha = this.interpolationAlpha;
        return out;
    }

    /**
     * 진단용 clock snapshot을 재사용 객체에 기록합니다.
     * @param {object} [out={}] - 기록 대상입니다.
     * @returns {object} 같은 대상입니다.
     */
    getClockState(out = {}) {
        out.profile = this.profile;
        out.simulationTime = this.simulationTime;
        out.renderTime = this.renderTime;
        out.lastRenderedFrame = this.lastRenderedFrame;
        out.fixedDelta = this.fixedDelta;
        out.predictionDelta = this.predictionDelta;
        out.interpolationAlpha = this.interpolationAlpha;
        return out;
    }
}
