import { WebGpuTransientTexturePool } from './webgpu_transient_texture_pool.js';

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const PYRAMID_PASS_COUNT = 4;
const FIXED_TOTAL_PASS_COUNT = 5;
const UNIFORM_FLOATS_PER_PASS = 4;
const UNIFORM_BUFFER_SIZE = PYRAMID_PASS_COUNT
    * UNIFORM_FLOATS_PER_PASS
    * Float32Array.BYTES_PER_ELEMENT;
const RECONSTRUCTION_UNIFORM_BUFFER_SIZE = 4 * Float32Array.BYTES_PER_ELEMENT;
const DOWNSAMPLE_AXIS_VARIANCE = 0.25;
const FIXED_DOWNSAMPLE_PASS_COUNT = 2;
const FIXED_FILTER_PASS_COUNT = 2;
const FIXED_ALIGNMENT_DIVISOR = 4;
const RECONSTRUCTION_PHASE_AXIS_VARIANCE = Object.freeze([3.75, 1.75, 1.75, 3.75]);
const BASE_PYRAMID_AXIS_VARIANCE = 4;
const BASE_PYRAMID_EXACT_SUPPORT = 5;
const MIN_FILTER_OFFSET = 0.5;
const FILTER_CENTER_MIX_CAP = 0.625;
const SIGMA_QUANTIZATION_STEP = 1 / 16;
const MAX_SOURCE_SIGMA = 16;
const HALO_SIGMA_MULTIPLIER = 3;
const HALO_SAFETY_PADDING = 2;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const SUPPORTED_TEXTURE_FORMATS = Object.freeze([
    'rgba8unorm',
    'bgra8unorm'
]);

/** WebGpuBlurService registry에서 사용하는 최적화 Kawase algorithm ID입니다. */
export const WEBGPU_OPTIMIZED_KAWASE_BLUR_ALGORITHM_ID = 'kawase-optimized';

/**
 * 시각 sigma 기반 최적화 Kawase topology와 품질 상한입니다.
 * compatibility 알고리즘의 legacy blur strength와는 단위가 다릅니다.
 */
export const WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS = Object.freeze({
    SIGMA_QUANTIZATION_STEP,
    MAX_SOURCE_SIGMA,
    MAX_PASS_COUNT: FIXED_TOTAL_PASS_COUNT,
    PYRAMID_PASS_COUNT,
    FIXED_DOWNSAMPLE_PASS_COUNT,
    FIXED_FILTER_PASS_COUNT,
    FIXED_ALIGNMENT_DIVISOR,
    BASE_PYRAMID_AXIS_VARIANCE,
    MIN_FILTER_OFFSET,
    FILTER_CENTER_MIX_CAP,
    HALO_SIGMA_MULTIPLIER,
    HALO_SAFETY_PADDING,
    SUPPORTED_TEXTURE_FORMATS,
    TEXTURE_USAGE: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT
});

/**
 * downsample은 normalized 5-tap dual filter, filter는 네 대각선 bilinear tap을 사용합니다.
 * 작은 sigma에서는 filter residual을 0으로 두고 reconstruction blurWeight를 0으로
 * 수렴시켜 sigma 0 identity와 연속으로 연결합니다.
 * 모든 가중치는 양수이고 합이 1이라 premultiplied RGBA를 그대로 보존합니다.
 */
export const WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER = `
    const PYRAMID_PASS_COUNT: u32 = ${PYRAMID_PASS_COUNT}u;

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) @interpolate(flat) passIndex: u32,
    };

    struct KawaseParameters {
        // xy: normalized texel step, z: diagonal offset, w: diagonal center mix.
        passes: array<vec4<f32>, ${PYRAMID_PASS_COUNT}>,
    };

    struct ReconstructionParameters {
        // x: normalized original/blur convex mix weight.
        values: vec4<f32>,
    };

    @group(0) @binding(0) var sourceSampler: sampler;
    @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> parameters: KawaseParameters;
    @group(0) @binding(3) var blurTexture: texture_2d<f32>;
    @group(0) @binding(4) var<uniform> reconstructionParameters: ReconstructionParameters;

    @vertex
    fn fullscreen_vertex(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
    ) -> FullscreenVertexOutput {
        let positions = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(3.0, -1.0),
            vec2<f32>(-1.0, 3.0)
        );
        let position = positions[vertexIndex];
        var output: FullscreenVertexOutput;
        output.position = vec4<f32>(position, 0.0, 1.0);
        output.uv = vec2<f32>((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
        output.passIndex = min(instanceIndex, PYRAMID_PASS_COUNT - 1u);
        return output;
    }

    @fragment
    fn kawase_downsample(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let passData = parameters.passes[input.passIndex];
        // ceil extent에서도 2:1 pixel-center phase를 고정합니다. normalized extent
        // 비율을 사용하면 odd source에서 sigma bucket과 무관한 phase drift가 생깁니다.
        let sourceUv = input.position.xy * passData.xy * 2.0;
        let offset = passData.xy * 0.5;
        var color = textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0) * 0.5;
        color += textureSampleLevel(
            sourceTexture,
            sourceSampler,
            sourceUv + vec2<f32>(offset.x, offset.y),
            0.0
        ) * 0.125;
        color += textureSampleLevel(
            sourceTexture,
            sourceSampler,
            sourceUv + vec2<f32>(-offset.x, offset.y),
            0.0
        ) * 0.125;
        color += textureSampleLevel(
            sourceTexture,
            sourceSampler,
            sourceUv + vec2<f32>(offset.x, -offset.y),
            0.0
        ) * 0.125;
        color += textureSampleLevel(
            sourceTexture,
            sourceSampler,
            sourceUv + vec2<f32>(-offset.x, -offset.y),
            0.0
        ) * 0.125;
        return color;
    }

    @fragment
    fn kawase_filter(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let passData = parameters.passes[input.passIndex];
        let offset = passData.xy * passData.z;
        var diagonal = textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(offset.x, offset.y)
        );
        diagonal += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-offset.x, offset.y)
        );
        diagonal += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(offset.x, -offset.y)
        );
        diagonal += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-offset.x, -offset.y)
        );
        diagonal *= 0.25;

        let centerMix = clamp(passData.w, 0.0, 1.0);
        if (centerMix >= 0.999999) {
            return diagonal;
        }
        // passIndex는 instance별 uniform이지만 정적 분석상 non-uniform일 수 있으므로,
        // 조건부 center fetch는 implicit derivative가 필요 없는 explicit LOD를 사용합니다.
        let center = textureSampleLevel(sourceTexture, sourceSampler, input.uv, 0.0);
        return center * (1.0 - centerMix) + diagonal * centerMix;
    }

    @fragment
    fn kawase_reconstruct(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let sourceExtent = vec2<f32>(textureDimensions(sourceTexture));
        let blurExtent = vec2<f32>(textureDimensions(blurTexture));
        let sourceUv = clamp(
            input.position.xy / sourceExtent,
            vec2<f32>(0.0),
            vec2<f32>(1.0)
        );
        // quarter texel q represents source center 4q + 1.5. Sampling at
        // (pixel + 0.5) / (4 * quarterExtent) reconstructs that fixed lattice.
        let blurUv = clamp(
            input.position.xy / (blurExtent * 4.0),
            vec2<f32>(0.0),
            vec2<f32>(1.0)
        );
        let original = textureSampleLevel(sourceTexture, sourceSampler, sourceUv, 0.0);
        let blurred = textureSampleLevel(blurTexture, sourceSampler, blurUv, 0.0);
        let blurWeight = clamp(reconstructionParameters.values.x, 0.0, 1.0);
        return original * (1.0 - blurWeight) + blurred * blurWeight;
    }
`;

/** 양수 sigma를 1/16px bucket으로 정규화하고 0은 정확히 보존합니다. */
export function quantizeWebGpuOptimizedKawaseSigma(value) {
    const sigma = normalizeSourceSigma(value);
    if (sigma <= 0) {
        return 0;
    }
    return Math.fround(Math.max(
        SIGMA_QUANTIZATION_STEP,
        Math.round(sigma / SIGMA_QUANTIZATION_STEP) * SIGMA_QUANTIZATION_STEP
    ));
}

/** source crop 전에 quantized topology의 정확한 support halo를 계산합니다. */
export function getWebGpuOptimizedKawaseRequiredHalo(value) {
    return getWebGpuOptimizedKawaseMetrics(value).requiredHalo;
}

/** plan, shader uniform, halo preflight가 함께 사용하는 immutable pure metrics입니다. */
export function getWebGpuOptimizedKawaseMetrics(value) {
    const sigma = quantizeWebGpuOptimizedKawaseSigma(value);
    return createOptimizedKawaseMetrics(sigma);
}

/** WebGpuBlurService에 등록할 generation factory를 생성합니다. */
export function createWebGpuOptimizedKawaseBlurAlgorithmFactory(options = {}) {
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
        return new WebGpuOptimizedKawaseBlurAlgorithm({
            device,
            deviceGeneration,
            composerPort,
            texturePool,
            ownsTexturePool
        });
    };
    Object.defineProperties(factory, {
        getPreparationSigma: {
            value: quantizeWebGpuOptimizedKawaseSigma
        },
        getRequiredHalo: {
            value: ({ sigma }) => getWebGpuOptimizedKawaseRequiredHalo(sigma)
        }
    });
    return factory;
}

/**
 * 고정 4-pass quarter pyramid와 1-pass full reconstruction을 쓰는 Kawase adapter입니다.
 * presentation 획득·finish·submit·canvas mark는 하지 않습니다.
 */
export class WebGpuOptimizedKawaseBlurAlgorithm {
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
        this.reconstructionBindGroupCache = new WeakMap();
        this.uniformBuffers = [];
        this.uniformScratch = new Float32Array(
            PYRAMID_PASS_COUNT * UNIFORM_FLOATS_PER_PASS
        );
        this.reconstructionUniformBuffers = [];
        this.reconstructionUniformScratch = new Float32Array(4);
        this.passDescriptorScratch = Array.from(
            { length: PYRAMID_PASS_COUNT },
            (_, index) => createRenderPassDescriptor(index)
        );
        this.reconstructionPassDescriptor = createRenderPassDescriptor('reconstruct');
        this.frameState = {
            frameId: null,
            device: null,
            deviceGeneration: null,
            activeLeases: new Set(),
            uniformRequestCount: 0,
            reconstructionUniformRequestCount: 0,
            cleaned: true,
            cleanupReason: null
        };
        this.activeFrameState = null;
        this.frameCallbacks = Object.freeze({
            committed: () => {
                this.completedFrameCount += 1;
                this.#cleanupFrameState(this.frameState, 'committed');
            },
            aborted: () => {
                this.abortedFrameCount += 1;
                this.#cleanupFrameState(this.frameState, 'aborted');
            }
        });

        this.encodeCount = 0;
        this.passCount = 0;
        this.completedFrameCount = 0;
        this.abortedFrameCount = 0;
        this.staleFrameCleanupCount = 0;
        this.cleanupFailureCount = 0;
        this.lastRequestedSigma = null;
        this.lastQuantizedSigma = null;
        this.lastTopology = null;
        this.lastRequiredHalo = null;
    }

    /** request의 크기·시각 sigma에 맞는 immutable topology를 준비합니다. */
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
        const requestedSigma = normalizeSourceSigma(request?.sigma);
        const quantizedSigma = quantizeWebGpuOptimizedKawaseSigma(requestedSigma);
        const format = resolveTextureFormat(request?.format, sourceFormat);
        const plan = createOptimizedKawasePlan(
            sourceWidth,
            sourceHeight,
            quantizedSigma,
            format
        );
        const pipelineSet = plan.passes.length > 0
            ? this.#getPipelineSet(format)
            : null;

        this.lastRequestedSigma = requestedSigma;
        this.lastQuantizedSigma = quantizedSigma;
        this.lastTopology = plan.topology;
        this.lastRequiredHalo = plan.requiredHalo;
        return Object.freeze({
            key: input?.key,
            sourceWidth,
            sourceHeight,
            requestedSigma,
            quantizedSigma,
            sigmaQuantizationStep: SIGMA_QUANTIZATION_STEP,
            topology: plan.topology,
            workingScale: plan.workingScale,
            alignmentDivisor: plan.alignmentDivisor,
            downsamplePassCount: plan.downsamplePassCount,
            filterPassCount: plan.filterPassCount,
            downsampleVariance: plan.downsampleVariance,
            residualVariance: plan.residualVariance,
            basePyramidAxisVariance: plan.basePyramidAxisVariance,
            blurWeight: plan.blurWeight,
            phaseVariance: plan.phaseVariance,
            targetFilterAxisVariance: plan.targetFilterAxisVariance,
            diagonalAxisVariance: plan.diagonalAxisVariance,
            reconstructedSigma: plan.reconstructedSigma,
            filterOffset: plan.filterOffset,
            centerMix: plan.centerMix,
            exactKernelSupport: plan.exactKernelSupport,
            requiredHalo: plan.requiredHalo,
            format,
            passes: plan.passes,
            reconstructionPass: plan.reconstructionPass,
            finalWidth: plan.finalWidth,
            finalHeight: plan.finalHeight,
            totalPassCount: plan.totalPassCount,
            sourcePixelEquivalentSamplesPerOutputPixel:
                plan.sourcePixelEquivalentSamplesPerOutputPixel,
            finalOutputFetchesPerOutputPixel:
                plan.finalOutputFetchesPerOutputPixel,
            totalHardwareSamplesPerOutputPixel:
                plan.totalHardwareSamplesPerOutputPixel,
            pipelineSet
        });
    }

    /** 준비된 pass를 composer encoder에 기록하고 frame-lifetime 출력을 반환합니다. */
    encode(input) {
        const context = input?.context;
        const request = input?.request;
        const prepared = input?.prepared;
        this.#assertContext(context);
        const sourceTexture = requireSourceTexture(request?.sourceTexture);
        this.#validatePrepared(prepared, sourceTexture, request);

        if (prepared.passes.length === 0) {
            return Object.freeze({
                algorithmId: WEBGPU_OPTIMIZED_KAWASE_BLUR_ALGORITHM_ID,
                texture: sourceTexture,
                view: this.#getSourceView(sourceTexture),
                width: prepared.sourceWidth,
                height: prepared.sourceHeight,
                format: prepared.format,
                frameId: context.frameId,
                deviceGeneration: this.deviceGeneration,
                frameLifetime: 'source-owned',
                passCount: 0,
                totalPassCount: 0,
                requestedSigma: prepared.requestedSigma,
                quantizedSigma: 0,
                sigmaQuantizationStep: SIGMA_QUANTIZATION_STEP,
                topology: 'identity',
                workingScale: 1,
                alignmentDivisor: 1,
                basePyramidAxisVariance: 0,
                blurWeight: 0,
                phaseVariance: Object.freeze([]),
                exactKernelSupport: 0,
                requiredHalo: 0,
                sourcePixelEquivalentSamplesPerOutputPixel: 0,
                finalOutputFetchesPerOutputPixel: 0,
                bounds: request.bounds,
                halo: request.halo,
                edgeMode: 'clamp',
                colorSpace: 'srgb'
            });
        }

        const frameState = this.#ensureFrameState(context);
        const uniformBuffer = this.#prepareUniformBuffer(frameState, prepared.passes);
        const sourceView = this.#getSourceView(sourceTexture);
        let readView = sourceView;
        let readLease = null;

        for (let index = 0; index < prepared.passes.length; index++) {
            const passPlan = prepared.passes[index];
            const targetLease = this.texturePool.acquire(passPlan.poolDescriptor);
            frameState.activeLeases.add(targetLease);
            const pipeline = passPlan.kind === 'downsample'
                ? prepared.pipelineSet.downsample
                : prepared.pipelineSet.filter;
            const bindGroup = this.#getBindGroup(
                pipeline,
                readView,
                uniformBuffer
            );
            const descriptor = this.passDescriptorScratch[index];
            descriptor.colorAttachments[0].view = targetLease.view;
            const renderPass = context.encoder.beginRenderPass(descriptor);
            renderPass.setPipeline(pipeline.pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(3, 1, 0, index);
            renderPass.end();
            this.passCount += 1;

            if (readLease) {
                this.#releaseFrameLease(frameState, readLease);
            }
            readLease = targetLease;
            readView = targetLease.view;
        }

        const reconstructionUniformBuffer = this.#prepareReconstructionUniformBuffer(
            frameState,
            prepared.blurWeight
        );
        const reconstructionLease = this.texturePool.acquire(
            prepared.reconstructionPass.poolDescriptor
        );
        frameState.activeLeases.add(reconstructionLease);
        const reconstructionBindGroup = this.#getReconstructionBindGroup(
            prepared.pipelineSet.reconstruct,
            sourceView,
            readView,
            reconstructionUniformBuffer
        );
        this.reconstructionPassDescriptor.colorAttachments[0].view = reconstructionLease.view;
        const reconstructionRenderPass = context.encoder.beginRenderPass(
            this.reconstructionPassDescriptor
        );
        reconstructionRenderPass.setPipeline(prepared.pipelineSet.reconstruct.pipeline);
        reconstructionRenderPass.setBindGroup(0, reconstructionBindGroup);
        reconstructionRenderPass.draw(3, 1, 0, 0);
        reconstructionRenderPass.end();
        this.passCount += 1;
        this.#releaseFrameLease(frameState, readLease);
        readLease = reconstructionLease;
        readView = reconstructionLease.view;

        this.encodeCount += 1;
        return Object.freeze({
            algorithmId: WEBGPU_OPTIMIZED_KAWASE_BLUR_ALGORITHM_ID,
            texture: readLease.texture,
            view: readLease.view,
            width: prepared.finalWidth,
            height: prepared.finalHeight,
            format: prepared.format,
            frameId: context.frameId,
            deviceGeneration: this.deviceGeneration,
            frameLifetime: 'until-frame-complete',
            passCount: prepared.totalPassCount,
            totalPassCount: prepared.totalPassCount,
            requestedSigma: prepared.requestedSigma,
            quantizedSigma: prepared.quantizedSigma,
            sigmaQuantizationStep: SIGMA_QUANTIZATION_STEP,
            topology: prepared.topology,
            workingScale: prepared.workingScale,
            alignmentDivisor: prepared.alignmentDivisor,
            basePyramidAxisVariance: prepared.basePyramidAxisVariance,
            blurWeight: prepared.blurWeight,
            phaseVariance: prepared.phaseVariance,
            reconstructedSigma: prepared.reconstructedSigma,
            filterOffset: prepared.filterOffset,
            centerMix: prepared.centerMix,
            exactKernelSupport: prepared.exactKernelSupport,
            requiredHalo: prepared.requiredHalo,
            sourcePixelEquivalentSamplesPerOutputPixel:
                prepared.sourcePixelEquivalentSamplesPerOutputPixel,
            finalOutputFetchesPerOutputPixel:
                prepared.finalOutputFetchesPerOutputPixel,
            totalHardwareSamplesPerOutputPixel:
                prepared.totalHardwareSamplesPerOutputPixel,
            bounds: request.bounds,
            halo: request.halo,
            edgeMode: 'clamp',
            colorSpace: 'srgb'
        });
    }

    /** generation-owned resource를 idempotent하게 정리합니다. */
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
        for (const buffer of this.reconstructionUniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        this.reconstructionUniformBuffers.length = 0;
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
        this.reconstructionBindGroupCache = new WeakMap();
        this.destroyed = true;
        return true;
    }

    /** rollout, quantization, topology 및 warm resource 진단 snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            sigmaQuantizationStep: SIGMA_QUANTIZATION_STEP,
            lastRequestedSigma: this.lastRequestedSigma,
            lastQuantizedSigma: this.lastQuantizedSigma,
            lastTopology: this.lastTopology,
            lastRequiredHalo: this.lastRequiredHalo,
            pipelineFormatCount: this.pipelineSets.size,
            uniformBufferCount: this.uniformBuffers.length
                + this.reconstructionUniformBuffers.length,
            pyramidUniformBufferCount: this.uniformBuffers.length,
            reconstructionUniformBufferCount: this.reconstructionUniformBuffers.length,
            activeFrameId: this.activeFrameState?.frameId ?? null,
            encodeCount: this.encodeCount,
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
            throw new Error('destroy된 WebGPU optimized Kawase blur는 사용할 수 없습니다.');
        }
        if (!context
            || context.device !== this.device
            || context.deviceGeneration !== this.deviceGeneration) {
            this.destroy();
            throw new Error('WebGPU optimized Kawase device/generation drift가 감지되었습니다.');
        }
        if (!Number.isSafeInteger(context.frameId) || context.frameId < 0) {
            throw new TypeError('WebGPU optimized Kawase에는 유효한 composer frameId가 필요합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('WebGPU optimized Kawase에는 composer command encoder가 필요합니다.');
        }
    }

    #validatePrepared(prepared, sourceTexture, request) {
        if (!prepared || !Array.isArray(prepared.passes)) {
            throw new TypeError('WebGPU optimized Kawase prepared state가 필요합니다.');
        }
        requireQualityProfile(request);
        const sourceFormat = requireSupportedTextureFormat(
            sourceTexture.format,
            'source texture'
        );
        const sourceWidth = resolveTextureExtent(sourceTexture, 'width', request, true);
        const sourceHeight = resolveTextureExtent(sourceTexture, 'height', request, false);
        if (prepared.sourceWidth !== sourceWidth || prepared.sourceHeight !== sourceHeight) {
            throw new Error('WebGPU optimized Kawase source 크기가 prepare 이후 변경되었습니다.');
        }
        const quantizedSigma = quantizeWebGpuOptimizedKawaseSigma(request?.sigma);
        if (prepared.quantizedSigma !== quantizedSigma) {
            throw new Error('WebGPU optimized Kawase sigma bucket이 prepare 이후 변경되었습니다.');
        }
        const format = resolveTextureFormat(request?.format, sourceFormat);
        if (prepared.format !== format) {
            throw new Error('WebGPU optimized Kawase format이 prepare 이후 변경되었습니다.');
        }
        if (prepared.passes.length > 0 && !prepared.pipelineSet) {
            throw new Error('WebGPU optimized Kawase pipeline prepared state가 없습니다.');
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
                label: 'title-kawase-optimized-shader',
                code: WEBGPU_OPTIMIZED_KAWASE_BLUR_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-kawase-optimized-linear-clamp-sampler',
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
            'kawase_downsample',
            'title-kawase-optimized-downsample'
        );
        const filterPipeline = this.#createPipeline(
            format,
            'kawase_filter',
            'title-kawase-optimized-filter'
        );
        const reconstructionPipeline = this.#createPipeline(
            format,
            'kawase_reconstruct',
            'title-kawase-optimized-reconstruct'
        );
        const pipelineSet = Object.freeze({
            format,
            downsample: Object.freeze({
                pipeline: downsamplePipeline,
                bindGroupLayout: downsamplePipeline.getBindGroupLayout(0)
            }),
            filter: Object.freeze({
                pipeline: filterPipeline,
                bindGroupLayout: filterPipeline.getBindGroupLayout(0)
            }),
            reconstruct: Object.freeze({
                pipeline: reconstructionPipeline,
                bindGroupLayout: reconstructionPipeline.getBindGroupLayout(0)
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

    #getBindGroup(pipeline, readView, uniformBuffer) {
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
        let bindGroup = buffers.get(uniformBuffer);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                label: 'title-kawase-optimized-bind-group',
                layout: pipeline.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: readView },
                    {
                        binding: 2,
                        resource: {
                            buffer: uniformBuffer,
                            offset: 0,
                            size: UNIFORM_BUFFER_SIZE
                        }
                    }
                ]
            });
            buffers.set(uniformBuffer, bindGroup);
        }
        return bindGroup;
    }

    #getReconstructionBindGroup(pipeline, sourceView, blurView, uniformBuffer) {
        let blurViews = this.reconstructionBindGroupCache.get(sourceView);
        if (!blurViews) {
            blurViews = new WeakMap();
            this.reconstructionBindGroupCache.set(sourceView, blurViews);
        }
        let buffers = blurViews.get(blurView);
        if (!buffers) {
            buffers = new WeakMap();
            blurViews.set(blurView, buffers);
        }
        let bindGroup = buffers.get(uniformBuffer);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                label: 'title-kawase-optimized-reconstruct-bind-group',
                layout: pipeline.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: sourceView },
                    { binding: 3, resource: blurView },
                    {
                        binding: 4,
                        resource: {
                            buffer: uniformBuffer,
                            offset: 0,
                            size: RECONSTRUCTION_UNIFORM_BUFFER_SIZE
                        }
                    }
                ]
            });
            buffers.set(uniformBuffer, bindGroup);
        }
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

        this.texturePool.beginFrame(context);
        const frameState = this.frameState;
        frameState.frameId = context.frameId;
        frameState.device = context.device;
        frameState.deviceGeneration = context.deviceGeneration;
        frameState.activeLeases.clear();
        frameState.uniformRequestCount = 0;
        frameState.reconstructionUniformRequestCount = 0;
        frameState.cleaned = false;
        frameState.cleanupReason = null;
        this.activeFrameState = frameState;

        let callbacksRegistered = false;
        try {
            callbacksRegistered = this.composerPort.deferFrameCallbacks(
                this.frameCallbacks
            ) === true;
        } catch (error) {
            this.#cleanupFrameState(frameState, 'callback-registration-failed');
            throw error;
        }
        if (!callbacksRegistered) {
            this.#cleanupFrameState(frameState, 'callback-registration-rejected');
            throw new Error('WebGPU optimized Kawase frame cleanup callback 등록에 실패했습니다.');
        }
        return frameState;
    }

    #prepareUniformBuffer(frameState, passes) {
        const bufferIndex = frameState.uniformRequestCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-kawase-optimized-uniform-buffer:${bufferIndex}`,
                size: UNIFORM_BUFFER_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
        }
        this.uniformScratch.fill(0);
        for (let index = 0; index < passes.length; index++) {
            const pass = passes[index];
            const offset = index * UNIFORM_FLOATS_PER_PASS;
            this.uniformScratch[offset] = pass.sampleStepX;
            this.uniformScratch[offset + 1] = pass.sampleStepY;
            this.uniformScratch[offset + 2] = pass.offset;
            this.uniformScratch[offset + 3] = pass.centerMix;
        }
        this.device.queue.writeBuffer(buffer, 0, this.uniformScratch);
        return buffer;
    }

    #prepareReconstructionUniformBuffer(frameState, blurWeight) {
        const bufferIndex = frameState.reconstructionUniformRequestCount++;
        let buffer = this.reconstructionUniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-kawase-optimized-reconstruct-uniform-buffer:${bufferIndex}`,
                size: RECONSTRUCTION_UNIFORM_BUFFER_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.reconstructionUniformBuffers[bufferIndex] = buffer;
        }
        this.reconstructionUniformScratch.fill(0);
        this.reconstructionUniformScratch[0] = blurWeight;
        this.device.queue.writeBuffer(buffer, 0, this.reconstructionUniformScratch);
        return buffer;
    }

    #releaseFrameLease(frameState, lease) {
        if (!frameState.activeLeases.has(lease)) {
            throw new Error('WebGPU optimized Kawase가 소유하지 않은 texture lease입니다.');
        }
        if (this.texturePool.release(lease) !== true) {
            throw new Error('WebGPU optimized Kawase texture lease 반환에 실패했습니다.');
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

function createOptimizedKawasePlan(sourceWidth, sourceHeight, sigma, format) {
    if (sigma <= 0) {
        return Object.freeze({
            topology: 'identity',
            workingScale: 1,
            alignmentDivisor: 1,
            downsamplePassCount: 0,
            filterPassCount: 0,
            downsampleVariance: 0,
            basePyramidAxisVariance: 0,
            residualVariance: 0,
            blurWeight: 0,
            phaseVariance: Object.freeze([]),
            targetFilterAxisVariance: 0,
            diagonalAxisVariance: 0,
            reconstructedSigma: 0,
            filterOffset: 0,
            centerMix: 0,
            exactKernelSupport: 0,
            requiredHalo: 0,
            totalPassCount: 0,
            sourcePixelEquivalentSamplesPerOutputPixel: 0,
            finalOutputFetchesPerOutputPixel: 0,
            totalHardwareSamplesPerOutputPixel: 0,
            passes: Object.freeze([]),
            reconstructionPass: null,
            finalWidth: sourceWidth,
            finalHeight: sourceHeight
        });
    }

    const metrics = createOptimizedKawaseMetrics(sigma);
    const passes = [];
    let readWidth = sourceWidth;
    let readHeight = sourceHeight;
    let pyramidHardwareFetchCount = 0;

    for (let index = 0; index < FIXED_DOWNSAMPLE_PASS_COUNT; index++) {
        const targetWidth = Math.max(1, Math.ceil(readWidth * 0.5));
        const targetHeight = Math.max(1, Math.ceil(readHeight * 0.5));
        passes.push(Object.freeze({
            kind: 'downsample',
            sourceWidth: readWidth,
            sourceHeight: readHeight,
            targetWidth,
            targetHeight,
            sampleStepX: Math.fround(1 / readWidth),
            sampleStepY: Math.fround(1 / readHeight),
            offset: 0.5,
            centerMix: 0.5,
            hardwareSampleCount: 5,
            poolDescriptor: createPoolDescriptor(targetWidth, targetHeight, format)
        }));
        pyramidHardwareFetchCount += 5 * targetWidth * targetHeight;
        readWidth = targetWidth;
        readHeight = targetHeight;
    }

    const filterDescriptor = createPoolDescriptor(readWidth, readHeight, format);
    for (let index = 0; index < FIXED_FILTER_PASS_COUNT; index++) {
        passes.push(Object.freeze({
            kind: 'filter',
            sourceWidth: readWidth,
            sourceHeight: readHeight,
            targetWidth: readWidth,
            targetHeight: readHeight,
            sampleStepX: Math.fround(1 / readWidth),
            sampleStepY: Math.fround(1 / readHeight),
            offset: metrics.filterOffset,
            centerMix: metrics.centerMix,
            hardwareSampleCount: 5,
            poolDescriptor: filterDescriptor
        }));
        pyramidHardwareFetchCount += 5 * readWidth * readHeight;
    }

    const finalOutputFetchesPerOutputPixel = 2;
    const finalPixelCount = sourceWidth * sourceHeight;
    const finalHardwareFetchCount = finalOutputFetchesPerOutputPixel * finalPixelCount;
    const sourcePixelEquivalentSamplesPerOutputPixel = Math.fround(
        (pyramidHardwareFetchCount + finalHardwareFetchCount) / finalPixelCount
    );
    const reconstructionPass = Object.freeze({
        kind: 'reconstruct',
        sourceWidth: readWidth,
        sourceHeight: readHeight,
        targetWidth: sourceWidth,
        targetHeight: sourceHeight,
        hardwareSampleCount: finalOutputFetchesPerOutputPixel,
        poolDescriptor: createPoolDescriptor(sourceWidth, sourceHeight, format)
    });

    return Object.freeze({
        topology: metrics.topology.id,
        workingScale: metrics.workingScale,
        alignmentDivisor: metrics.topology.alignmentDivisor,
        downsamplePassCount: FIXED_DOWNSAMPLE_PASS_COUNT,
        filterPassCount: FIXED_FILTER_PASS_COUNT,
        downsampleVariance: Math.fround(metrics.downsampleVariance),
        basePyramidAxisVariance: metrics.basePyramidAxisVariance,
        residualVariance: Math.fround(metrics.residualVariance),
        blurWeight: metrics.blurWeight,
        phaseVariance: metrics.phaseVariance,
        targetFilterAxisVariance: Math.fround(metrics.targetFilterAxisVariance),
        diagonalAxisVariance: Math.fround(metrics.diagonalAxisVariance),
        reconstructedSigma: metrics.reconstructedSigma,
        filterOffset: metrics.filterOffset,
        centerMix: metrics.centerMix,
        exactKernelSupport: Math.fround(metrics.exactKernelSupport),
        requiredHalo: metrics.requiredHalo,
        totalPassCount: FIXED_TOTAL_PASS_COUNT,
        sourcePixelEquivalentSamplesPerOutputPixel,
        finalOutputFetchesPerOutputPixel,
        totalHardwareSamplesPerOutputPixel: sourcePixelEquivalentSamplesPerOutputPixel,
        passes: Object.freeze(passes),
        reconstructionPass,
        finalWidth: sourceWidth,
        finalHeight: sourceHeight
    });
}

function createOptimizedKawaseMetrics(sigma) {
    if (sigma <= 0) {
        return Object.freeze({
            topology: Object.freeze({
                id: 'identity',
                alignmentDivisor: 1,
                downsamplePassCount: 0,
                filterPassCount: 0,
                reconstructionPassCount: 0
            }),
            workingScale: 1,
            downsampleVariance: 0,
            basePyramidAxisVariance: 0,
            residualVariance: 0,
            targetFilterAxisVariance: 0,
            filterOffset: 0,
            diagonalAxisVariance: 0,
            centerMix: 0,
            blurWeight: 0,
            reconstructedSigma: 0,
            phaseVariance: Object.freeze([]),
            exactKernelSupport: 0,
            requiredHalo: 0
        });
    }
    const topology = Object.freeze({
        id: 'fixed-quarter-pyramid-reconstruct',
        alignmentDivisor: FIXED_ALIGNMENT_DIVISOR,
        downsamplePassCount: FIXED_DOWNSAMPLE_PASS_COUNT,
        filterPassCount: FIXED_FILTER_PASS_COUNT,
        reconstructionPassCount: 1
    });
    const workingScale = 1 / FIXED_ALIGNMENT_DIVISOR;
    const downsampleVariance = downsamplePyramidVariance();
    const residualVariance = Math.max(0, (sigma * sigma) - BASE_PYRAMID_AXIS_VARIANCE);
    const targetFilterAxisVariance = residualVariance
        * workingScale
        * workingScale
        / FIXED_FILTER_PASS_COUNT;
    const filterOffset = Math.fround(Math.max(
        MIN_FILTER_OFFSET,
        Math.sqrt(targetFilterAxisVariance / FILTER_CENTER_MIX_CAP)
    ));
    const diagonalAxisVariance = calculateBilinearDiagonalAxisVariance(filterOffset);
    const centerMix = Math.fround(Math.min(
        FILTER_CENTER_MIX_CAP,
        targetFilterAxisVariance / diagonalAxisVariance
    ));
    const filteredResidualVariance = FIXED_FILTER_PASS_COUNT
        * diagonalAxisVariance
        * centerMix
        / (workingScale * workingScale);
    const blurWeight = Math.fround(Math.min(
        1,
        (sigma * sigma) / BASE_PYRAMID_AXIS_VARIANCE
    ));
    const reconstructedVariance = (
        BASE_PYRAMID_AXIS_VARIANCE + filteredResidualVariance
    ) * blurWeight;
    const phaseVariance = createPhaseVarianceMetrics(filteredResidualVariance, blurWeight);
    const exactKernelSupport = BASE_PYRAMID_EXACT_SUPPORT
        + (centerMix > 0
            ? FIXED_FILTER_PASS_COUNT
                * Math.ceil(filterOffset)
                * FIXED_ALIGNMENT_DIVISOR
            : 0);
    const requiredHalo = Math.ceil(Math.max(
        sigma * HALO_SIGMA_MULTIPLIER,
        exactKernelSupport
    ) + HALO_SAFETY_PADDING);
    return Object.freeze({
        topology,
        workingScale,
        downsampleVariance,
        basePyramidAxisVariance: BASE_PYRAMID_AXIS_VARIANCE,
        residualVariance,
        targetFilterAxisVariance,
        filterOffset,
        diagonalAxisVariance,
        centerMix,
        blurWeight,
        reconstructedSigma: Math.fround(Math.sqrt(reconstructedVariance)),
        phaseVariance,
        exactKernelSupport,
        requiredHalo
    });
}

function createPhaseVarianceMetrics(filteredResidualVariance, blurWeight) {
    const downsampleVariance = downsamplePyramidVariance();
    return Object.freeze(RECONSTRUCTION_PHASE_AXIS_VARIANCE.map(
        (reconstructionVariance, phase) => {
            const baseVariance = downsampleVariance + reconstructionVariance;
            const reconstructedVariance = (
                baseVariance + filteredResidualVariance
            ) * blurWeight;
            return Object.freeze({
                phase,
                reconstructionVariance,
                baseVariance,
                reconstructedVariance: Math.fround(reconstructedVariance),
                reconstructedSigma: Math.fround(Math.sqrt(reconstructedVariance)),
                centroidOffset: 0
            });
        }
    ));
}

function downsamplePyramidVariance() {
    let inputScale = 1;
    let variance = 0;
    for (let index = 0; index < FIXED_DOWNSAMPLE_PASS_COUNT; index++) {
        variance += DOWNSAMPLE_AXIS_VARIANCE / (inputScale * inputScale);
        inputScale *= 0.5;
    }
    return variance;
}

function calculateBilinearDiagonalAxisVariance(offset) {
    const integerOffset = Math.floor(offset);
    const fraction = offset - integerOffset;
    return offset * offset + fraction * (1 - fraction);
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
        usage: WEBGPU_OPTIMIZED_KAWASE_BLUR_CONSTANTS.TEXTURE_USAGE,
        viewDimension: '2d'
    });
}

function createRenderPassDescriptor(index) {
    return {
        label: `title-kawase-optimized-pass:${index}`,
        colorAttachments: [{
            view: null,
            clearValue: TRANSPARENT_CLEAR_VALUE,
            loadOp: 'clear',
            storeOp: 'store'
        }]
    };
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
            throw new TypeError(`WebGPU optimized Kawase device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('WebGPU optimized Kawase device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireDeviceGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('WebGPU optimized Kawase deviceGeneration은 0 이상의 정수여야 합니다.');
    }
}

function requireComposerPort(port) {
    if (!port || typeof port.deferFrameCallbacks !== 'function') {
        throw new TypeError('WebGPU optimized Kawase composerPort.deferFrameCallbacks()가 필요합니다.');
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
            throw new TypeError(`WebGPU optimized Kawase texture pool에 ${methodName}()가 없습니다.`);
        }
    }
}

function requireSourceTexture(texture) {
    if ((!texture || (typeof texture !== 'object' && typeof texture !== 'function'))
        || typeof texture.createView !== 'function') {
        throw new TypeError('WebGPU optimized Kawase sourceTexture.createView()가 필요합니다.');
    }
    return texture;
}

function requireQualityProfile(request) {
    if (request?.edgeMode !== 'clamp') {
        throw new Error(
            `WebGPU optimized Kawase는 edgeMode=clamp만 지원합니다: ${String(request?.edgeMode)}`
        );
    }
    if (request?.colorSpace !== 'srgb') {
        throw new Error(
            `WebGPU optimized Kawase는 colorSpace=srgb만 지원합니다: ${String(request?.colorSpace)}`
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
    throw new RangeError(`WebGPU optimized Kawase sourceTexture.${property}가 유효하지 않습니다.`);
}

function resolveTextureFormat(requestFormat, sourceFormat) {
    const format = typeof requestFormat === 'string' && requestFormat
        ? requestFormat
        : sourceFormat;
    return requireSupportedTextureFormat(format, 'output');
}

function requireSupportedTextureFormat(format, role) {
    if (typeof format !== 'string' || !format) {
        throw new TypeError(`WebGPU optimized Kawase ${role} format이 필요합니다.`);
    }
    if (!SUPPORTED_TEXTURE_FORMATS.includes(format)) {
        throw new RangeError(
            `WebGPU optimized Kawase ${role} format은 ${SUPPORTED_TEXTURE_FORMATS.join(', ')}만 지원합니다: ${format}`
        );
    }
    return format;
}

function normalizeSourceSigma(value) {
    const sigma = Number.isFinite(value) && value > 0 ? Number(value) : 0;
    if (sigma > MAX_SOURCE_SIGMA) {
        throw new RangeError(
            `WebGPU optimized Kawase sigma는 ${MAX_SOURCE_SIGMA} 이하여야 합니다: ${sigma}`
        );
    }
    return sigma;
}
