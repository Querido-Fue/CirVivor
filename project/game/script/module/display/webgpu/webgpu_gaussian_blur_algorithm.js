import { WebGpuTransientTexturePool } from './webgpu_transient_texture_pool.js';

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const UNIFORM_SLOT_ALIGNMENT = 256;
const UNIFORM_FLOATS_PER_SLOT = UNIFORM_SLOT_ALIGNMENT / Float32Array.BYTES_PER_ELEMENT;
const GAUSSIAN_TRUNCATION_SIGMA = 3;
const GAUSSIAN_HALO_SAFETY_PADDING = 2;
const MAX_EFFECTIVE_SIGMA = 4;
const MIN_DOWNSAMPLE_SCALE = 1 / 4;
const MAX_SOURCE_SIGMA = MAX_EFFECTIVE_SIGMA / MIN_DOWNSAMPLE_SCALE;
const MAX_UNDOWNSAMPLED_SIGMA = 13 / 4;
const MAX_KERNEL_RADIUS = Math.ceil(GAUSSIAN_TRUNCATION_SIGMA * MAX_EFFECTIVE_SIGMA);
const MAX_PAIRED_TAP_COUNT = Math.ceil(MAX_KERNEL_RADIUS / 2);
const MAX_PASS_COUNT = 3;
const GAUSSIAN_VARIANCE_SOLVE_ITERATIONS = 24;
const GAUSSIAN_UNIFORM_SIZE = (1 + MAX_PAIRED_TAP_COUNT) * 16;
const SUBPIXEL_IDENTITY_SIGMA_CUTOFF = 1 / 8;
const SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE = SUBPIXEL_IDENTITY_SIGMA_CUTOFF
    * SUBPIXEL_IDENTITY_SIGMA_CUTOFF;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const SUPPORTED_TEXTURE_FORMATS = Object.freeze([
    'rgba8unorm',
    'bgra8unorm'
]);
// 3.25에서 full-resolution 6번째 paired fetch를 피하고, 중간 scale로 면적 절벽을 분산합니다.
// source offset 끝값은 다음 bucket 시작값과 같아 downsample PSF가 경계에서 튀지 않습니다.
const DOWNSAMPLE_SCALE_BUCKETS = Object.freeze([
    Object.freeze({
        minSourceSigma: 0,
        maxSourceSigma: MAX_UNDOWNSAMPLED_SIGMA,
        scale: 1,
        minDispatchRadius: 1,
        startSourceOffset: 0,
        endSourceOffset: 0
    }),
    Object.freeze({
        minSourceSigma: MAX_UNDOWNSAMPLED_SIGMA,
        maxSourceSigma: 13 / 3,
        scale: 3 / 4,
        minDispatchRadius: 8,
        startSourceOffset: 0,
        endSourceOffset: 1 / 2
    }),
    Object.freeze({
        minSourceSigma: 13 / 3,
        maxSourceSigma: 13 / 2,
        scale: 1 / 2,
        minDispatchRadius: 10,
        startSourceOffset: 1 / 2,
        endSourceOffset: 2 / 3
    }),
    Object.freeze({
        minSourceSigma: 13 / 2,
        maxSourceSigma: 26 / 3,
        scale: 3 / 8,
        minDispatchRadius: 10,
        startSourceOffset: 2 / 3,
        endSourceOffset: 1
    }),
    Object.freeze({
        minSourceSigma: 26 / 3,
        maxSourceSigma: MAX_SOURCE_SIGMA,
        scale: MIN_DOWNSAMPLE_SCALE,
        minDispatchRadius: 10,
        startSourceOffset: 1,
        endSourceOffset: 1
    })
]);

/** WebGpuBlurService registry에서 사용하는 고품질 Gaussian algorithm ID입니다. */
export const WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID = 'gaussian-quality';

/**
 * 소스 픽셀 공간에서 Gaussian convolution을 identity로 접는 inclusive sigma 상한입니다.
 * 이 범위의 연속 Gaussian PSF는 축별 RMS가 최대 1/8 px이고 분산은 최대 1/64 px²라서,
 * 화면 샘플 격자에서 구분하기 어려운 효과에 H/V pass를 지불하지 않습니다.
 */
export const WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_SIGMA_CUTOFF
    = SUBPIXEL_IDENTITY_SIGMA_CUTOFF;

/** identity cutoff가 허용하는 최대 소스-space PSF 분산(px²)입니다. */
export const WEBGPU_GAUSSIAN_SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE
    = SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE;

/**
 * Gaussian quality profile의 format, scale, kernel, pass 상한입니다.
 * 고정된 다섯 scale bucket이 4/8 경계의 급격한 해상도 변화를 분산합니다.
 * source sigma는 16 이하, 축소율은 1/4 이상, 유효 sigma는 4 이하입니다.
 */
export const WEBGPU_GAUSSIAN_BLUR_CONSTANTS = Object.freeze({
    GAUSSIAN_TRUNCATION_SIGMA,
    GAUSSIAN_HALO_SAFETY_PADDING,
    MAX_EFFECTIVE_SIGMA,
    MIN_DOWNSAMPLE_SCALE,
    MAX_SOURCE_SIGMA,
    MAX_UNDOWNSAMPLED_SIGMA,
    MAX_KERNEL_RADIUS,
    MAX_PAIRED_TAP_COUNT,
    MAX_PASS_COUNT,
    SUBPIXEL_IDENTITY_SIGMA_CUTOFF,
    SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE,
    DOWNSAMPLE_SCALE_BUCKETS,
    DOWNSAMPLE_SAMPLE_COUNT: 4,
    SUPPORTED_TEXTURE_FORMATS,
    TEXTURE_USAGE: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT
});

/**
 * 한 번의 축소와 두 축의 separable Gaussian을 같은 fullscreen pipeline 계열로 기록합니다.
 * RGBA는 premultiplied 상태로 누적하며, 인접 논리 tap 둘은 bilinear sample 하나로 합칩니다.
 */
export const WEBGPU_GAUSSIAN_BLUR_SHADER = `
    const MAX_PAIRED_TAP_COUNT: u32 = ${MAX_PAIRED_TAP_COUNT}u;

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
    };

    struct GaussianParameters {
        // xy: normalized sample step, z: center weight, w: active paired tap count.
        header: vec4<f32>,
        // x: positive offset in texels, y: combined pair weight.
        pairedTaps: array<vec4<f32>, ${MAX_PAIRED_TAP_COUNT}>,
    };

    @group(0) @binding(0) var sourceSampler: sampler;
    @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> parameters: GaussianParameters;

    @vertex
    fn fullscreen_vertex(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
        let positions = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(3.0, -1.0),
            vec2<f32>(-1.0, 3.0)
        );
        let position = positions[vertexIndex];
        var output: FullscreenVertexOutput;
        output.position = vec4<f32>(position, 0.0, 1.0);
        output.uv = vec2<f32>((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
        return output;
    }

    @fragment
    fn gaussian_downsample(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let step = parameters.header.xy;
        var color = textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-step.x, -step.y)
        );
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(step.x, -step.y)
        );
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-step.x, step.y)
        );
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(step.x, step.y)
        );
        return color * 0.25;
    }

    @fragment
    fn gaussian_directional(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        var color = textureSample(sourceTexture, sourceSampler, input.uv)
            * parameters.header.z;
        let pairCount = u32(parameters.header.w);
        for (var index = 0u; index < MAX_PAIRED_TAP_COUNT; index += 1u) {
            if (index >= pairCount) {
                break;
            }
            let tap = parameters.pairedTaps[index];
            let offset = parameters.header.xy * tap.x;
            color += textureSample(sourceTexture, sourceSampler, input.uv + offset) * tap.y;
            color += textureSample(sourceTexture, sourceSampler, input.uv - offset) * tap.y;
        }
        return color;
    }
`;

/**
 * source crop 전에 Gaussian topology의 유한 support를 보수적으로 계산합니다.
 * 3-sigma 시각 반경과 실제 quantized kernel/downsample support 중 큰 값에
 * bilinear/downsample 경계 안전 여유를 더합니다. identity cutoff는 정확히 0입니다.
 * @param {number} value - source-space sigma입니다.
 * @returns {number} source 픽셀 단위 정수 halo입니다.
 */
export function getWebGpuGaussianRequiredHalo(value) {
    const sourceSigma = normalizeSourceSigma(value);
    if (isIdentitySigma(sourceSigma)) {
        return 0;
    }

    const scaleSelection = selectDownsampleScaleBucket(sourceSigma);
    const downsampleScale = scaleSelection.bucket.scale;
    const downsampleSourceOffset = resolveDownsampleSourceOffset(
        sourceSigma,
        scaleSelection.bucket
    );
    const residualSourceVariance = Math.max(
        0,
        sourceSigma * sourceSigma
            - downsampleSourceOffset * downsampleSourceOffset
    );
    const effectiveSigma = Math.fround(
        Math.sqrt(residualSourceVariance) * downsampleScale
    );
    const kernelRadius = Math.min(
        MAX_KERNEL_RADIUS,
        Math.max(1, Math.ceil(GAUSSIAN_TRUNCATION_SIGMA * effectiveSigma))
    );
    const exactSourceSupport = downsampleSourceOffset
        + (kernelRadius / downsampleScale);
    return Math.ceil(Math.max(
        sourceSigma * GAUSSIAN_TRUNCATION_SIGMA,
        exactSourceSupport
    ) + GAUSSIAN_HALO_SAFETY_PADDING);
}

/**
 * WebGpuBlurService에 등록할 generation factory를 생성합니다.
 * 외부 pool을 주입하면 해당 pool은 이 factory의 알고리즘에서 독점 사용해야 합니다.
 * @param {object} options - composer와 texture pool 설정입니다.
 * @param {{deferFrameCallbacks:Function}} options.composerPort - frame 완료 callback port입니다.
 * @param {WebGpuTransientTexturePool} [options.texturePool] - 외부 소유 exclusive pool입니다.
 * @param {Function} [options.texturePoolFactory] - generation별 pool factory입니다.
 * @param {object} [options.texturePoolOptions] - 기본 pool 생성 옵션입니다.
 * @returns {Function} `({device,deviceGeneration}) => algorithm` factory입니다.
 */
export function createWebGpuGaussianBlurAlgorithmFactory(options = {}) {
    requireComposerPort(options.composerPort);
    if (options.texturePool && options.texturePoolFactory) {
        throw new TypeError('texturePool과 texturePoolFactory는 동시에 지정할 수 없습니다.');
    }
    if (options.texturePool) {
        requireTexturePool(options.texturePool);
    }
    if (options.texturePoolFactory !== undefined
        && typeof options.texturePoolFactory !== 'function') {
        throw new TypeError('texturePoolFactory는 함수여야 합니다.');
    }

    const composerPort = options.composerPort;
    const sharedTexturePool = options.texturePool || null;
    const texturePoolFactory = options.texturePoolFactory || null;
    const texturePoolOptions = options.texturePoolOptions
        ? Object.freeze({ ...options.texturePoolOptions })
        : undefined;

    const factory = ({ device, deviceGeneration }) => {
        let texturePool = sharedTexturePool;
        let ownsTexturePool = false;
        if (!texturePool) {
            texturePool = texturePoolFactory
                ? texturePoolFactory(Object.freeze({ device, deviceGeneration }))
                : new WebGpuTransientTexturePool(texturePoolOptions);
            requireTexturePool(texturePool);
            ownsTexturePool = true;
        }
        return new WebGpuGaussianBlurAlgorithm({
            device,
            deviceGeneration,
            composerPort,
            texturePool,
            ownsTexturePool
        });
    };
    Object.defineProperty(factory, 'getRequiredHalo', {
        value: ({ sigma }) => getWebGpuGaussianRequiredHalo(sigma)
    });
    return factory;
}

/**
 * 최대 4배 고정 quantized 축소와 bilinear-paired separable Gaussian을 제공하는 adapter입니다.
 * presentation target이나 command 제출을 소유하지 않고 composer encoder에만 pass를 기록합니다.
 */
export class WebGpuGaussianBlurAlgorithm {
    /**
     * @param {object} options - generation dependency입니다.
     * @param {GPUDevice} options.device - 이 instance가 소유하는 device identity입니다.
     * @param {number} options.deviceGeneration - platform device generation입니다.
     * @param {{deferFrameCallbacks:Function}} options.composerPort - frame callback port입니다.
     * @param {WebGpuTransientTexturePool} [options.texturePool] - exclusive transient pool입니다.
     * @param {boolean} [options.ownsTexturePool] - destroy 시 pool도 폐기할지 여부입니다.
     */
    constructor(options = {}) {
        requireDevice(options.device);
        requireDeviceGeneration(options.deviceGeneration);
        requireComposerPort(options.composerPort);

        this.device = options.device;
        this.deviceGeneration = options.deviceGeneration;
        this.composerPort = options.composerPort;
        this.texturePool = options.texturePool || new WebGpuTransientTexturePool();
        requireTexturePool(this.texturePool);
        this.ownsTexturePool = options.texturePool
            ? options.ownsTexturePool === true
            : true;

        this.destroyed = false;
        this.shaderModule = null;
        this.sampler = null;
        this.pipelineSets = new Map();
        this.sourceViews = new WeakMap();
        this.bindGroupCache = new WeakMap();
        this.uniformBuffers = [];
        this.uniformScratch = new Float32Array(MAX_PASS_COUNT * UNIFORM_FLOATS_PER_SLOT);
        this.activeFrameState = null;
        this.encodeCount = 0;
        this.identityEncodeCount = 0;
        this.subpixelIdentityEncodeCount = 0;
        this.passCount = 0;
        this.completedFrameCount = 0;
        this.abortedFrameCount = 0;
        this.staleFrameCleanupCount = 0;
        this.cleanupFailureCount = 0;
    }

    /**
     * request topology에 맞는 scale, 정규화 kernel, pipeline을 generation cache에 준비합니다.
     * sourceRevision/checkpoint에는 의존하지 않으며 transient lease도 획득하지 않습니다.
     * @param {{context:object,request:object,key:string}} input - service prepare 입력입니다.
     * @returns {Readonly<object>} generation/topology prepared state입니다.
     */
    prepare(input) {
        const context = input?.context;
        const request = input?.request;
        this.#assertContext(context);
        const sourceTexture = requireSourceTexture(request?.sourceTexture);
        requireQualityProfile(request);
        const sourceFormat = requireSupportedTextureFormat(
            sourceTexture.format,
            'source texture'
        );
        const sourceWidth = resolveTextureExtent(sourceTexture, 'width', request, true);
        const sourceHeight = resolveTextureExtent(sourceTexture, 'height', request, false);
        const sourceSigma = normalizeSourceSigma(request?.sigma);
        const format = resolveTextureFormat(request?.format, sourceFormat);
        const plan = createGaussianPlan(sourceWidth, sourceHeight, sourceSigma, format);
        const pipelineSet = plan.passes.length > 0
            ? this.#getPipelineSet(format)
            : null;

        return Object.freeze({
            key: input?.key,
            sourceWidth,
            sourceHeight,
            sourceSigma,
            identity: plan.identity,
            subpixelIdentity: plan.subpixelIdentity,
            effectiveSigma: plan.effectiveSigma,
            residualSourceSigma: plan.residualSourceSigma,
            reconstructedSourceSigma: plan.reconstructedSourceSigma,
            downsampleScale: plan.downsampleScale,
            downsampleFactor: plan.downsampleFactor,
            downsampleSourceOffset: plan.downsampleSourceOffset,
            scaleBucketIndex: plan.scaleBucketIndex,
            sourcePsfVariance: plan.sourcePsfVariance,
            sourcePsfExcessKurtosis: plan.sourcePsfExcessKurtosis,
            fetchCountPerOutputPixel: plan.fetchCountPerOutputPixel,
            normalizedFetchWork: plan.normalizedFetchWork,
            format,
            kernel: plan.kernel,
            passes: plan.passes,
            finalWidth: plan.finalWidth,
            finalHeight: plan.finalHeight,
            pipelineSet
        });
    }

    /**
     * 준비된 최대 3개 pass를 composer encoder에 기록하고 frame-lifetime 출력을 반환합니다.
     * @param {{context:object,request:object,key:string,prepared:object}} input - service encode 입력입니다.
     * @returns {Readonly<object>} blur output texture/view와 scale metadata입니다.
     */
    encode(input) {
        const context = input?.context;
        const request = input?.request;
        const prepared = input?.prepared;
        this.#assertContext(context);
        const sourceTexture = requireSourceTexture(request?.sourceTexture);
        this.#validatePrepared(prepared, sourceTexture, request);

        if (prepared.passes.length === 0) {
            this.encodeCount += 1;
            this.identityEncodeCount += 1;
            if (prepared.subpixelIdentity) {
                this.subpixelIdentityEncodeCount += 1;
            }
            return Object.freeze({
                algorithmId: WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID,
                texture: sourceTexture,
                view: this.#getSourceView(sourceTexture),
                width: prepared.sourceWidth,
                height: prepared.sourceHeight,
                format: prepared.format,
                frameId: context.frameId,
                deviceGeneration: this.deviceGeneration,
                frameLifetime: 'source-owned',
                passCount: 0,
                identity: true,
                subpixelIdentity: prepared.subpixelIdentity,
                sourceSigma: prepared.sourceSigma,
                effectiveSigma: 0,
                residualSourceSigma: 0,
                reconstructedSourceSigma: 0,
                downsampleScale: 1,
                downsampleFactor: 1,
                downsampleSourceOffset: 0,
                scaleBucketIndex: 0,
                kernelRadius: 0,
                kernelDispatchRadius: 0,
                pairedTapCount: 0,
                samplesPerGaussianPass: 0,
                sourcePsfVariance: 0,
                sourcePsfExcessKurtosis: 0,
                fetchCountPerOutputPixel: 0,
                normalizedFetchWork: 0,
                bounds: request.bounds,
                halo: request.halo,
                edgeMode: 'clamp',
                colorSpace: 'srgb'
            });
        }

        const frameState = this.#ensureFrameState(context);
        const uniformBuffer = this.#prepareUniformBuffer(frameState, prepared);
        let readView = this.#getSourceView(sourceTexture);
        let readLease = null;

        for (let index = 0; index < prepared.passes.length; index++) {
            const passPlan = prepared.passes[index];
            const targetLease = this.texturePool.acquire(passPlan.poolDescriptor);
            frameState.activeLeases.add(targetLease);
            const pipeline = passPlan.kind === 'downsample'
                ? prepared.pipelineSet.downsample
                : prepared.pipelineSet.directional;
            const bindGroup = this.#getBindGroup(
                pipeline,
                readView,
                uniformBuffer,
                index * UNIFORM_SLOT_ALIGNMENT
            );
            const renderPass = context.encoder.beginRenderPass({
                label: `title-gaussian-${passPlan.kind}-pass:${context.frameId}:${index}`,
                colorAttachments: [{
                    view: targetLease.view,
                    clearValue: TRANSPARENT_CLEAR_VALUE,
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            renderPass.setPipeline(pipeline.pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(3, 1, 0, 0);
            renderPass.end();
            this.passCount += 1;

            if (readLease) {
                this.#releaseFrameLease(frameState, readLease);
            }
            readLease = targetLease;
            readView = targetLease.view;
        }

        this.encodeCount += 1;
        return Object.freeze({
            algorithmId: WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID,
            texture: readLease.texture,
            view: readLease.view,
            width: prepared.finalWidth,
            height: prepared.finalHeight,
            format: prepared.format,
            frameId: context.frameId,
            deviceGeneration: this.deviceGeneration,
            frameLifetime: 'until-frame-complete',
            passCount: prepared.passes.length,
            identity: false,
            subpixelIdentity: false,
            sourceSigma: prepared.sourceSigma,
            effectiveSigma: prepared.effectiveSigma,
            residualSourceSigma: prepared.residualSourceSigma,
            reconstructedSourceSigma: prepared.reconstructedSourceSigma,
            downsampleScale: prepared.downsampleScale,
            downsampleFactor: prepared.downsampleFactor,
            downsampleSourceOffset: prepared.downsampleSourceOffset,
            scaleBucketIndex: prepared.scaleBucketIndex,
            kernelRadius: prepared.kernel.radius,
            kernelDispatchRadius: prepared.kernel.dispatchRadius,
            pairedTapCount: prepared.kernel.pairCount,
            samplesPerGaussianPass: prepared.kernel.hardwareSampleCount,
            sourcePsfVariance: prepared.sourcePsfVariance,
            sourcePsfExcessKurtosis: prepared.sourcePsfExcessKurtosis,
            fetchCountPerOutputPixel: prepared.fetchCountPerOutputPixel,
            normalizedFetchWork: prepared.normalizedFetchWork,
            bounds: request.bounds,
            halo: request.halo,
            edgeMode: 'clamp',
            colorSpace: 'srgb'
        });
    }

    /** 알고리즘과 generation resource를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        if (this.activeFrameState) {
            this.#cleanupFrameState(this.activeFrameState, 'destroy');
        }
        for (const buffer of this.uniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        this.uniformBuffers.length = 0;
        if (this.ownsTexturePool) {
            try {
                this.texturePool.destroy();
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        this.pipelineSets.clear();
        this.shaderModule = null;
        this.sampler = null;
        this.sourceViews = new WeakMap();
        this.bindGroupCache = new WeakMap();
        this.destroyed = true;
        return true;
    }

    /** 테스트와 rollout 진단용 immutable snapshot을 반환합니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            pipelineFormatCount: this.pipelineSets.size,
            uniformBufferCount: this.uniformBuffers.length,
            activeFrameId: this.activeFrameState?.frameId ?? null,
            encodeCount: this.encodeCount,
            identityEncodeCount: this.identityEncodeCount,
            subpixelIdentityEncodeCount: this.subpixelIdentityEncodeCount,
            subpixelIdentitySigmaCutoff: SUBPIXEL_IDENTITY_SIGMA_CUTOFF,
            subpixelIdentityMaxPsfVariance: SUBPIXEL_IDENTITY_MAX_PSF_VARIANCE,
            passCount: this.passCount,
            completedFrameCount: this.completedFrameCount,
            abortedFrameCount: this.abortedFrameCount,
            staleFrameCleanupCount: this.staleFrameCleanupCount,
            cleanupFailureCount: this.cleanupFailureCount,
            pool: this.texturePool.getDiagnostics()
        });
    }

    #assertContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 WebGPU Gaussian blur algorithm은 사용할 수 없습니다.');
        }
        if (!context
            || context.device !== this.device
            || context.deviceGeneration !== this.deviceGeneration) {
            this.destroy();
            throw new Error('WebGPU Gaussian blur device/generation drift가 감지되었습니다.');
        }
        if (!Number.isSafeInteger(context.frameId) || context.frameId < 0) {
            throw new TypeError('WebGPU Gaussian blur에는 유효한 composer frameId가 필요합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('WebGPU Gaussian blur에는 composer command encoder가 필요합니다.');
        }
    }

    #validatePrepared(prepared, sourceTexture, request) {
        if (!prepared || !Array.isArray(prepared.passes)) {
            throw new TypeError('WebGPU Gaussian blur prepared state가 필요합니다.');
        }
        requireQualityProfile(request);
        const sourceFormat = requireSupportedTextureFormat(
            sourceTexture.format,
            'source texture'
        );
        const sourceWidth = resolveTextureExtent(sourceTexture, 'width', request, true);
        const sourceHeight = resolveTextureExtent(sourceTexture, 'height', request, false);
        if (prepared.sourceWidth !== sourceWidth || prepared.sourceHeight !== sourceHeight) {
            throw new Error('WebGPU Gaussian blur source 크기가 prepare 이후 변경되었습니다.');
        }
        const sourceSigma = normalizeSourceSigma(request?.sigma);
        if (prepared.sourceSigma !== sourceSigma) {
            throw new Error('WebGPU Gaussian blur sigma가 prepare 이후 변경되었습니다.');
        }
        const identity = isIdentitySigma(sourceSigma);
        const subpixelIdentity = identity && sourceSigma > 0;
        if (prepared.identity !== identity
            || prepared.subpixelIdentity !== subpixelIdentity
            || (prepared.passes.length === 0) !== identity) {
            throw new Error('WebGPU Gaussian blur identity cutoff prepared state가 일치하지 않습니다.');
        }
        const format = resolveTextureFormat(request?.format, sourceFormat);
        if (prepared.format !== format) {
            throw new Error('WebGPU Gaussian blur format이 prepare 이후 변경되었습니다.');
        }
        if (prepared.passes.length > 0 && (!prepared.pipelineSet || !prepared.kernel)) {
            throw new Error('WebGPU Gaussian blur pipeline/kernel prepared state가 없습니다.');
        }
    }

    #getSourceView(sourceTexture) {
        let view = this.sourceViews.get(sourceTexture);
        if (!view) {
            view = sourceTexture.createView({ dimension: '2d' });
            this.sourceViews.set(sourceTexture, view);
        }
        return view;
    }

    #getPipelineSet(format) {
        const cached = this.pipelineSets.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-gaussian-quality-shader',
                code: WEBGPU_GAUSSIAN_BLUR_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-gaussian-linear-clamp-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest'
            });
        }

        const downsamplePipeline = this.#createPipeline(
            format,
            'gaussian_downsample',
            'title-gaussian-downsample'
        );
        const directionalPipeline = this.#createPipeline(
            format,
            'gaussian_directional',
            'title-gaussian-directional'
        );
        const pipelineSet = Object.freeze({
            format,
            downsample: Object.freeze({
                pipeline: downsamplePipeline,
                bindGroupLayout: downsamplePipeline.getBindGroupLayout(0)
            }),
            directional: Object.freeze({
                pipeline: directionalPipeline,
                bindGroupLayout: directionalPipeline.getBindGroupLayout(0)
            })
        });
        this.pipelineSets.set(format, pipelineSet);
        return pipelineSet;
    }

    #createPipeline(format, entryPoint, label) {
        return this.device.createRenderPipeline({
            label: `${label}-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint,
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' }
        });
    }

    #getBindGroup(pipeline, readView, uniformBuffer, uniformOffset) {
        let views = this.bindGroupCache.get(pipeline.pipeline);
        if (!views) {
            views = new WeakMap();
            this.bindGroupCache.set(pipeline.pipeline, views);
        }
        let buffers = views.get(readView);
        if (!buffers) {
            buffers = new WeakMap();
            views.set(readView, buffers);
        }
        let offsets = buffers.get(uniformBuffer);
        if (!offsets) {
            offsets = new Map();
            buffers.set(uniformBuffer, offsets);
        }
        const cached = offsets.get(uniformOffset);
        if (cached) {
            return cached;
        }
        const bindGroup = this.device.createBindGroup({
            label: `title-gaussian-${pipeline.pipeline.entryPoint || 'pass'}-bind-group:${uniformOffset}`,
            layout: pipeline.bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: readView },
                {
                    binding: 2,
                    resource: {
                        buffer: uniformBuffer,
                        offset: uniformOffset,
                        size: GAUSSIAN_UNIFORM_SIZE
                    }
                }
            ]
        });
        offsets.set(uniformOffset, bindGroup);
        return bindGroup;
    }

    #ensureFrameState(context) {
        const active = this.activeFrameState;
        if (active
            && active.frameId === context.frameId
            && active.device === context.device
            && active.deviceGeneration === context.deviceGeneration) {
            return active;
        }
        if (active) {
            this.staleFrameCleanupCount += 1;
            this.#cleanupFrameState(active, 'stale-frame');
        }

        this.texturePool.beginFrame({
            device: context.device,
            deviceGeneration: context.deviceGeneration,
            frameId: context.frameId
        });
        const frameState = {
            frameId: context.frameId,
            device: context.device,
            deviceGeneration: context.deviceGeneration,
            activeLeases: new Set(),
            uniformRequestCount: 0,
            cleaned: false
        };
        this.activeFrameState = frameState;

        let callbacksRegistered = false;
        try {
            callbacksRegistered = this.composerPort.deferFrameCallbacks({
                committed: () => {
                    this.completedFrameCount += 1;
                    this.#cleanupFrameState(frameState, 'committed');
                },
                aborted: () => {
                    this.abortedFrameCount += 1;
                    this.#cleanupFrameState(frameState, 'aborted');
                }
            }) === true;
        } catch (error) {
            this.#cleanupFrameState(frameState, 'callback-registration-failed');
            throw error;
        }
        if (!callbacksRegistered) {
            this.#cleanupFrameState(frameState, 'callback-registration-rejected');
            throw new Error('WebGPU Gaussian blur frame cleanup callback 등록에 실패했습니다.');
        }
        return frameState;
    }

    #prepareUniformBuffer(frameState, prepared) {
        const bufferIndex = frameState.uniformRequestCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-gaussian-uniform-buffer:${bufferIndex}`,
                size: MAX_PASS_COUNT * UNIFORM_SLOT_ALIGNMENT,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
        }

        this.uniformScratch.fill(0);
        for (let index = 0; index < prepared.passes.length; index++) {
            const pass = prepared.passes[index];
            const floatOffset = index * UNIFORM_FLOATS_PER_SLOT;
            this.uniformScratch[floatOffset] = pass.sampleStepX;
            this.uniformScratch[floatOffset + 1] = pass.sampleStepY;
            if (pass.kind === 'downsample') {
                continue;
            }
            this.uniformScratch[floatOffset + 2] = prepared.kernel.centerWeight;
            this.uniformScratch[floatOffset + 3] = prepared.kernel.pairCount;
            for (let tapIndex = 0; tapIndex < prepared.kernel.pairCount; tapIndex++) {
                const tap = prepared.kernel.pairedTaps[tapIndex];
                const tapOffset = floatOffset + 4 + tapIndex * 4;
                this.uniformScratch[tapOffset] = tap.offset;
                this.uniformScratch[tapOffset + 1] = tap.weight;
            }
        }
        this.device.queue.writeBuffer(buffer, 0, this.uniformScratch);
        return buffer;
    }

    #releaseFrameLease(frameState, lease) {
        if (!frameState.activeLeases.has(lease)) {
            throw new Error('WebGPU Gaussian blur가 소유하지 않은 texture lease입니다.');
        }
        if (this.texturePool.release(lease) !== true) {
            throw new Error('WebGPU Gaussian blur texture lease 반환에 실패했습니다.');
        }
        frameState.activeLeases.delete(lease);
    }

    #cleanupFrameState(frameState, reason) {
        if (!frameState || frameState.cleaned) {
            return;
        }
        frameState.cleaned = true;
        for (const lease of frameState.activeLeases) {
            try {
                this.texturePool.release(lease);
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        frameState.activeLeases.clear();
        try {
            if (this.texturePool.getDiagnostics().frameActive) {
                this.texturePool.endFrame();
            }
        } catch {
            this.cleanupFailureCount += 1;
        }
        frameState.cleanupReason = reason;
        if (this.activeFrameState === frameState) {
            this.activeFrameState = null;
        }
    }
}

function createGaussianPlan(sourceWidth, sourceHeight, sourceSigma, format) {
    if (isIdentitySigma(sourceSigma)) {
        return Object.freeze({
            identity: true,
            subpixelIdentity: sourceSigma > 0,
            effectiveSigma: 0,
            residualSourceSigma: 0,
            reconstructedSourceSigma: 0,
            downsampleScale: 1,
            downsampleFactor: 1,
            downsampleSourceOffset: 0,
            scaleBucketIndex: 0,
            sourcePsfVariance: 0,
            sourcePsfExcessKurtosis: 0,
            fetchCountPerOutputPixel: 0,
            normalizedFetchWork: 0,
            kernel: null,
            passes: Object.freeze([]),
            finalWidth: sourceWidth,
            finalHeight: sourceHeight
        });
    }

    const scaleSelection = selectDownsampleScaleBucket(sourceSigma);
    const downsampleScale = scaleSelection.bucket.scale;
    const downsampleFactor = 1 / downsampleScale;
    const downsampleSourceOffset = resolveDownsampleSourceOffset(
        sourceSigma,
        scaleSelection.bucket
    );
    const residualSourceVariance = Math.max(
        0,
        sourceSigma * sourceSigma
            - downsampleSourceOffset * downsampleSourceOffset
    );
    const residualSourceSigma = Math.sqrt(residualSourceVariance);
    const effectiveSigma = Math.fround(residualSourceSigma * downsampleScale);
    const finalWidth = Math.max(1, Math.ceil(sourceWidth * downsampleScale));
    const finalHeight = Math.max(1, Math.ceil(sourceHeight * downsampleScale));
    const kernel = createGaussianKernel(
        effectiveSigma,
        scaleSelection.bucket.minDispatchRadius
    );
    const poolDescriptor = createPoolDescriptor(finalWidth, finalHeight, format);
    const passes = [];

    if (downsampleScale < 1) {
        passes.push(Object.freeze({
            kind: 'downsample',
            sourceWidth,
            sourceHeight,
            targetWidth: finalWidth,
            targetHeight: finalHeight,
            sampleStepX: Math.fround(downsampleSourceOffset / sourceWidth),
            sampleStepY: Math.fround(downsampleSourceOffset / sourceHeight),
            sourceOffsetPixels: downsampleSourceOffset,
            sampleCount: WEBGPU_GAUSSIAN_BLUR_CONSTANTS.DOWNSAMPLE_SAMPLE_COUNT,
            poolDescriptor
        }));
    }
    passes.push(Object.freeze({
        kind: 'horizontal',
        sourceWidth: finalWidth,
        sourceHeight: finalHeight,
        targetWidth: finalWidth,
        targetHeight: finalHeight,
        sampleStepX: Math.fround(1 / finalWidth),
        sampleStepY: 0,
        sampleCount: kernel.hardwareSampleCount,
        poolDescriptor
    }));
    passes.push(Object.freeze({
        kind: 'vertical',
        sourceWidth: finalWidth,
        sourceHeight: finalHeight,
        targetWidth: finalWidth,
        targetHeight: finalHeight,
        sampleStepX: 0,
        sampleStepY: Math.fround(1 / finalHeight),
        sampleCount: kernel.hardwareSampleCount,
        poolDescriptor
    }));

    const sourceKernelVariance = kernel.variance
        / (downsampleScale * downsampleScale);
    const sourcePsfVariance = sourceKernelVariance
        + downsampleSourceOffset * downsampleSourceOffset;
    const sourcePsfFourthMoment = kernel.fourthMoment
        / Math.pow(downsampleScale, 4)
        + 6 * sourceKernelVariance
            * downsampleSourceOffset * downsampleSourceOffset
        + Math.pow(downsampleSourceOffset, 4);
    const sourcePsfExcessKurtosis = sourcePsfVariance > 0
        ? sourcePsfFourthMoment / (sourcePsfVariance * sourcePsfVariance) - 3
        : 0;
    const fetchCountPerOutputPixel = passes.reduce(
        (sum, pass) => sum + pass.sampleCount,
        0
    );
    const normalizedPixelArea = (finalWidth * finalHeight) / (sourceWidth * sourceHeight);

    return Object.freeze({
        identity: false,
        subpixelIdentity: false,
        effectiveSigma,
        residualSourceSigma,
        reconstructedSourceSigma: Math.sqrt(sourcePsfVariance),
        downsampleScale,
        downsampleFactor,
        downsampleSourceOffset,
        scaleBucketIndex: scaleSelection.index,
        sourcePsfVariance,
        sourcePsfExcessKurtosis,
        fetchCountPerOutputPixel,
        normalizedFetchWork: fetchCountPerOutputPixel * normalizedPixelArea,
        kernel,
        passes: Object.freeze(passes),
        finalWidth,
        finalHeight
    });
}

function isIdentitySigma(sourceSigma) {
    return sourceSigma <= SUBPIXEL_IDENTITY_SIGMA_CUTOFF;
}

function selectDownsampleScaleBucket(sourceSigma) {
    for (let index = 0; index < DOWNSAMPLE_SCALE_BUCKETS.length; index++) {
        const bucket = DOWNSAMPLE_SCALE_BUCKETS[index];
        if (sourceSigma <= bucket.maxSourceSigma) {
            return Object.freeze({ index, bucket });
        }
    }
    return Object.freeze({
        index: DOWNSAMPLE_SCALE_BUCKETS.length - 1,
        bucket: DOWNSAMPLE_SCALE_BUCKETS[DOWNSAMPLE_SCALE_BUCKETS.length - 1]
    });
}

function resolveDownsampleSourceOffset(sourceSigma, bucket) {
    if (bucket.scale >= 1) {
        return 0;
    }
    const range = bucket.maxSourceSigma - bucket.minSourceSigma;
    const progress = range > 0
        ? Math.max(0, Math.min(1, (sourceSigma - bucket.minSourceSigma) / range))
        : 1;
    return bucket.startSourceOffset
        + (bucket.endSourceOffset - bucket.startSourceOffset) * progress;
}

function createGaussianKernel(sigma, minDispatchRadius = 1) {
    const radius = Math.min(
        MAX_KERNEL_RADIUS,
        Math.max(1, Math.ceil(GAUSSIAN_TRUNCATION_SIGMA * sigma))
    );
    const dispatchRadius = Math.min(
        MAX_KERNEL_RADIUS,
        Math.max(radius, minDispatchRadius)
    );
    const weightSigma = solveGaussianWeightSigma(sigma, radius);
    // 저해상도 pass의 0-weight padding은 PSF를 바꾸지 않으면서 경계 fetch 수를 고정합니다.
    const logicalWeights = new Array(dispatchRadius + 1).fill(0);
    logicalWeights[0] = 1;
    let normalization = 1;
    const inverseTwoSigmaSquared = 1 / (2 * weightSigma * weightSigma);
    for (let index = 1; index <= radius; index++) {
        const weight = Math.exp(-(index * index) * inverseTwoSigmaSquared);
        logicalWeights[index] = weight;
        normalization += weight * 2;
    }
    for (let index = 0; index <= radius; index++) {
        logicalWeights[index] = Math.fround(logicalWeights[index] / normalization);
    }

    const pairedTaps = [];
    let pairedTailWeight = 0;
    for (let index = 1; index <= dispatchRadius; index += 2) {
        const firstWeight = logicalWeights[index];
        const secondWeight = index + 1 <= dispatchRadius
            ? logicalWeights[index + 1]
            : 0;
        const combinedWeight = Math.fround(firstWeight + secondWeight);
        const offset = Math.fround(
            combinedWeight > 0
                ? (index * firstWeight + (index + 1) * secondWeight) / combinedWeight
                : index
        );
        pairedTaps.push(Object.freeze({
            firstIndex: index,
            secondIndex: index + 1 <= dispatchRadius ? index + 1 : null,
            offset,
            weight: combinedWeight
        }));
        pairedTailWeight += combinedWeight;
    }

    const centerWeight = Math.fround(Math.max(0, 1 - pairedTailWeight * 2));
    logicalWeights[0] = centerWeight;
    const normalizedWeightSum = centerWeight + pairedTailWeight * 2;
    let variance = 0;
    let fourthMoment = 0;
    for (let index = 1; index <= radius; index++) {
        const symmetricWeight = logicalWeights[index] * 2;
        variance += index * index * symmetricWeight;
        fourthMoment += Math.pow(index, 4) * symmetricWeight;
    }
    return Object.freeze({
        sigma,
        weightSigma,
        radius,
        dispatchRadius,
        logicalTapCount: radius * 2 + 1,
        dispatchTapCount: dispatchRadius * 2 + 1,
        pairCount: pairedTaps.length,
        hardwareSampleCount: pairedTaps.length * 2 + 1,
        centerWeight,
        normalizedWeightSum,
        variance,
        fourthMoment,
        logicalWeights: Object.freeze(logicalWeights),
        pairedTaps: Object.freeze(pairedTaps)
    });
}

function solveGaussianWeightSigma(targetSigma, radius) {
    const targetVariance = targetSigma * targetSigma;
    if (!(targetVariance > Number.MIN_VALUE)) {
        return Math.max(targetSigma, Number.MIN_VALUE);
    }

    let lower = Number.MIN_VALUE;
    let upper = Math.max(0.5, targetSigma);
    let upperVariance = calculateGaussianVariance(upper, radius);
    while (upperVariance < targetVariance && upper < MAX_EFFECTIVE_SIGMA * 4) {
        upper *= 2;
        upperVariance = calculateGaussianVariance(upper, radius);
    }
    if (upperVariance < targetVariance) {
        return upper;
    }

    // 3-sigma truncation 뒤의 실제 discrete variance가 요청 variance와 같아지도록 보정합니다.
    for (let iteration = 0;
        iteration < GAUSSIAN_VARIANCE_SOLVE_ITERATIONS;
        iteration++) {
        const midpoint = (lower + upper) * 0.5;
        const variance = calculateGaussianVariance(midpoint, radius);
        if (variance < targetVariance) {
            lower = midpoint;
        } else {
            upper = midpoint;
        }
    }
    return (lower + upper) * 0.5;
}

function calculateGaussianVariance(sigma, radius) {
    if (!(sigma > 0)) {
        return 0;
    }
    const inverseTwoSigmaSquared = 1 / (2 * sigma * sigma);
    let normalization = 1;
    let weightedVariance = 0;
    for (let index = 1; index <= radius; index++) {
        const weight = Math.exp(-(index * index) * inverseTwoSigmaSquared);
        normalization += weight * 2;
        weightedVariance += index * index * weight * 2;
    }
    return weightedVariance / normalization;
}

function createPoolDescriptor(width, height, format) {
    return Object.freeze({
        width,
        height,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format,
        usage: WEBGPU_GAUSSIAN_BLUR_CONSTANTS.TEXTURE_USAGE,
        viewDimension: '2d'
    });
}

function requireDevice(device) {
    for (const methodName of [
        'createShaderModule',
        'createSampler',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer',
        'createTexture'
    ]) {
        if (typeof device?.[methodName] !== 'function') {
            throw new TypeError(`WebGPU Gaussian blur device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('WebGPU Gaussian blur device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireDeviceGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('WebGPU Gaussian blur deviceGeneration은 0 이상의 정수여야 합니다.');
    }
}

function requireComposerPort(port) {
    if (!port || typeof port.deferFrameCallbacks !== 'function') {
        throw new TypeError('WebGPU Gaussian blur composerPort.deferFrameCallbacks()가 필요합니다.');
    }
}

function requireTexturePool(pool) {
    for (const methodName of [
        'beginFrame',
        'acquire',
        'release',
        'endFrame',
        'getDiagnostics',
        'destroy'
    ]) {
        if (typeof pool?.[methodName] !== 'function') {
            throw new TypeError(`WebGPU Gaussian blur texture pool에 ${methodName}()가 없습니다.`);
        }
    }
}

function requireSourceTexture(texture) {
    if ((!texture || (typeof texture !== 'object' && typeof texture !== 'function'))
        || typeof texture.createView !== 'function') {
        throw new TypeError('WebGPU Gaussian blur sourceTexture.createView()가 필요합니다.');
    }
    return texture;
}

function requireQualityProfile(request) {
    if (request?.edgeMode !== 'clamp') {
        throw new Error(
            `WebGPU Gaussian quality는 edgeMode=clamp만 지원합니다: ${String(request?.edgeMode)}`
        );
    }
    if (request?.colorSpace !== 'srgb') {
        throw new Error(
            `WebGPU Gaussian quality는 colorSpace=srgb만 지원합니다: ${String(request?.colorSpace)}`
        );
    }
}

function resolveTextureExtent(texture, property, request, horizontal) {
    const direct = texture?.[property];
    if (Number.isFinite(direct) && direct > 0) {
        return Math.max(1, Math.floor(direct));
    }
    const boundsExtent = horizontal ? request?.bounds?.width : request?.bounds?.height;
    const leadingHalo = horizontal ? request?.halo?.left : request?.halo?.top;
    const trailingHalo = horizontal ? request?.halo?.right : request?.halo?.bottom;
    const fallback = Number(boundsExtent || 0)
        + Number(leadingHalo || 0)
        + Number(trailingHalo || 0);
    if (Number.isFinite(fallback) && fallback > 0) {
        return Math.max(1, Math.ceil(fallback));
    }
    throw new RangeError(`WebGPU Gaussian blur sourceTexture.${property}가 유효하지 않습니다.`);
}

function resolveTextureFormat(requestFormat, sourceFormat) {
    let format = '';
    if (typeof requestFormat === 'string' && requestFormat) {
        format = requestFormat;
    } else if (typeof sourceFormat === 'string' && sourceFormat) {
        format = sourceFormat;
    }
    return requireSupportedTextureFormat(format, 'output');
}

function requireSupportedTextureFormat(format, role) {
    if (typeof format !== 'string' || !format) {
        throw new TypeError(`WebGPU Gaussian blur ${role} format이 필요합니다.`);
    }
    if (!SUPPORTED_TEXTURE_FORMATS.includes(format)) {
        throw new RangeError(
            `WebGPU Gaussian blur ${role} format은 ${SUPPORTED_TEXTURE_FORMATS.join(', ')}만 지원합니다: ${format}`
        );
    }
    return format;
}

function normalizeSourceSigma(value) {
    const sigma = Number.isFinite(value) && value > 0 ? Number(value) : 0;
    if (sigma > MAX_SOURCE_SIGMA) {
        throw new RangeError(
            `WebGPU Gaussian quality sigma는 ${MAX_SOURCE_SIGMA} 이하여야 합니다: ${sigma}`
        );
    }
    return sigma;
}
