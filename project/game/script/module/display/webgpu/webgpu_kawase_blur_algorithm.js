import { OVERLAY_RENDER_CONSTANTS } from '../webgl/_webgl_constants.js';
import { WebGpuTransientTexturePool } from './webgpu_transient_texture_pool.js';

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const UNIFORM_SLOT_ALIGNMENT = 256;
const UNIFORM_FLOATS_PER_SLOT = UNIFORM_SLOT_ALIGNMENT / Float32Array.BYTES_PER_ELEMENT;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

/** WebGpuBlurService registry에서 사용하는 compatibility algorithm ID입니다. */
export const WEBGPU_KAWASE_BLUR_ALGORITHM_ID = 'kawase-compatibility';

/**
 * 기존 WebGL Kawase 경로와 맞추는 고정 pass topology입니다.
 */
export const WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS = Object.freeze({
    DOWN_PASS_COUNT: Math.min(
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_DOWN_PASSES,
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_UP_PASSES
    ),
    UP_PASS_COUNT: Math.max(0, Math.min(
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_DOWN_PASSES,
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_UP_PASSES
    ) - 1),
    MIN_SIZE: OVERLAY_RENDER_CONSTANTS.KAWASE_MIN_SIZE,
    PASS_COUNT: Math.min(
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_DOWN_PASSES,
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_UP_PASSES
    ) + Math.max(0, Math.min(
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_DOWN_PASSES,
        OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_UP_PASSES
    ) - 1),
    OUTPUT_LEVEL: 2,
    TEXTURE_USAGE: TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT
});

/**
 * WebGL compatibility kernel을 WebGPU fullscreen triangle로 옮긴 WGSL입니다.
 * down은 중심 0.25 + 대각선 4 * 0.1875, up은 중심 0.4 + 축 4 * 0.15입니다.
 */
export const WEBGPU_KAWASE_COMPATIBILITY_SHADER = `
    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
    };

    struct KawaseParameters {
        texelSize: vec2<f32>,
        offset: f32,
        padding: f32,
    };

    @group(0) @binding(0) var sourceSampler: sampler;
    @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> parameters: KawaseParameters;

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
    fn kawase_down(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let sampleOffset = parameters.texelSize * parameters.offset;
        var color = textureSample(sourceTexture, sourceSampler, input.uv) * 0.25;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(sampleOffset.x, sampleOffset.y)
        ) * 0.1875;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-sampleOffset.x, sampleOffset.y)
        ) * 0.1875;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(sampleOffset.x, -sampleOffset.y)
        ) * 0.1875;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-sampleOffset.x, -sampleOffset.y)
        ) * 0.1875;
        return color;
    }

    @fragment
    fn kawase_up(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let sampleOffset = parameters.texelSize * parameters.offset;
        var color = textureSample(sourceTexture, sourceSampler, input.uv) * 0.4;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(sampleOffset.x, 0.0)
        ) * 0.15;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(-sampleOffset.x, 0.0)
        ) * 0.15;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(0.0, sampleOffset.y)
        ) * 0.15;
        color += textureSample(
            sourceTexture,
            sourceSampler,
            input.uv + vec2<f32>(0.0, -sampleOffset.y)
        ) * 0.15;
        return color;
    }
`;

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
export function createWebGpuKawaseBlurAlgorithmFactory(options = {}) {
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

    return ({ device, deviceGeneration }) => {
        let texturePool = sharedTexturePool;
        let ownsTexturePool = false;
        if (!texturePool) {
            texturePool = texturePoolFactory
                ? texturePoolFactory(Object.freeze({ device, deviceGeneration }))
                : new WebGpuTransientTexturePool(texturePoolOptions);
            requireTexturePool(texturePool);
            ownsTexturePool = true;
        }
        return new WebGpuKawaseBlurAlgorithm({
            device,
            deviceGeneration,
            composerPort,
            texturePool,
            ownsTexturePool
        });
    };
}

/**
 * 기존 4-down/3-up Kawase blur의 algorithm adapter입니다.
 * presentation target 획득과 command 제출은 하지 않고 composer encoder에만 pass를 기록합니다.
 */
export class WebGpuKawaseBlurAlgorithm {
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
        this.uniformScratch = new Float32Array(
            WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.PASS_COUNT * UNIFORM_FLOATS_PER_SLOT
        );
        this.activeFrameState = null;
        this.encodeCount = 0;
        this.passCount = 0;
        this.completedFrameCount = 0;
        this.abortedFrameCount = 0;
        this.staleFrameCleanupCount = 0;
        this.cleanupFailureCount = 0;
    }

    /**
     * request key에 캐시 가능한 topology와 generation pipeline을 준비합니다.
     * transient texture lease는 이 단계에서 획득하지 않습니다.
     * @param {{context:object,request:object,key:string}} input - service prepare 입력입니다.
     * @returns {Readonly<object>} generation/key prepared state입니다.
     */
    prepare(input) {
        const context = input?.context;
        const request = input?.request;
        this.#assertContext(context);
        const sourceTexture = requireSourceTexture(request?.sourceTexture);
        requireCompatibilityProfile(request);
        const sourceWidth = resolveTextureExtent(sourceTexture, 'width', request, true);
        const sourceHeight = resolveTextureExtent(sourceTexture, 'height', request, false);
        const blur = normalizeBlur(request?.sigma);
        const format = resolveTextureFormat(request?.format, sourceTexture.format);
        const plan = createCompatibilityPlan(sourceWidth, sourceHeight, blur);
        const pipelineSet = plan.passes.length > 0
            ? this.#getPipelineSet(format)
            : null;

        return Object.freeze({
            key: input?.key,
            sourceWidth,
            sourceHeight,
            blur,
            blurScale: plan.blurScale,
            format,
            passes: plan.passes,
            finalWidth: plan.finalWidth,
            finalHeight: plan.finalHeight,
            pipelineSet
        });
    }

    /**
     * 준비된 7개 pass를 composer encoder에 기록하고 frame-lifetime 출력을 반환합니다.
     * @param {{context:object,request:object,key:string,prepared:object}} input - service encode 입력입니다.
     * @returns {Readonly<object>} blur output texture/view와 크기 metadata입니다.
     */
    encode(input) {
        const context = input?.context;
        const request = input?.request;
        const prepared = input?.prepared;
        this.#assertContext(context);
        const sourceTexture = requireSourceTexture(request?.sourceTexture);
        this.#validatePrepared(prepared, sourceTexture, request);

        if (prepared.passes.length === 0) {
            return Object.freeze({
                texture: sourceTexture,
                view: this.#getSourceView(sourceTexture),
                width: prepared.sourceWidth,
                height: prepared.sourceHeight,
                format: prepared.format,
                frameId: context.frameId,
                deviceGeneration: this.deviceGeneration,
                frameLifetime: 'source-owned',
                passCount: 0,
                blur: prepared.blur,
                blurScale: prepared.blurScale,
                bounds: request.bounds,
                halo: request.halo,
                edgeMode: 'clamp',
                colorSpace: request.colorSpace
            });
        }

        const frameState = this.#ensureFrameState(context);
        const uniformBuffer = this.#prepareUniformBuffer(frameState, prepared.passes);
        let readView = this.#getSourceView(sourceTexture);
        let readLease = null;

        for (let index = 0; index < prepared.passes.length; index++) {
            const passPlan = prepared.passes[index];
            const targetLease = this.texturePool.acquire(createPoolDescriptor(
                passPlan.targetWidth,
                passPlan.targetHeight,
                prepared.format
            ));
            frameState.activeLeases.add(targetLease);

            const pipeline = passPlan.direction === 'down'
                ? prepared.pipelineSet.down
                : prepared.pipelineSet.up;
            const bindGroup = this.#getBindGroup(
                pipeline,
                readView,
                uniformBuffer,
                index * UNIFORM_SLOT_ALIGNMENT
            );
            const renderPass = context.encoder.beginRenderPass({
                label: `title-kawase-${passPlan.direction}-pass:${context.frameId}:${index}`,
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
            texture: readLease.texture,
            view: readLease.view,
            width: prepared.finalWidth,
            height: prepared.finalHeight,
            format: prepared.format,
            frameId: context.frameId,
            deviceGeneration: this.deviceGeneration,
            frameLifetime: 'until-frame-complete',
            passCount: prepared.passes.length,
            blur: prepared.blur,
            blurScale: prepared.blurScale,
            bounds: request.bounds,
            halo: request.halo,
            edgeMode: 'clamp',
            colorSpace: request.colorSpace
        });
    }

    /**
     * 알고리즘과 generation resource를 idempotent하게 정리합니다.
     * @returns {boolean} 최초 destroy 호출이면 true입니다.
     */
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

    /**
     * 테스트와 rollout 진단용 immutable snapshot을 반환합니다.
     * @returns {Readonly<object>} algorithm/pool 상태입니다.
     */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            pipelineFormatCount: this.pipelineSets.size,
            uniformBufferCount: this.uniformBuffers.length,
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
            throw new Error('destroy된 WebGPU Kawase blur algorithm은 사용할 수 없습니다.');
        }
        if (!context
            || context.device !== this.device
            || context.deviceGeneration !== this.deviceGeneration) {
            this.destroy();
            throw new Error('WebGPU Kawase blur device/generation drift가 감지되었습니다.');
        }
        if (!Number.isSafeInteger(context.frameId) || context.frameId < 0) {
            throw new TypeError('WebGPU Kawase blur에는 유효한 composer frameId가 필요합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('WebGPU Kawase blur에는 composer command encoder가 필요합니다.');
        }
    }

    #validatePrepared(prepared, sourceTexture, request) {
        if (!prepared || !Array.isArray(prepared.passes)) {
            throw new TypeError('WebGPU Kawase blur prepared state가 필요합니다.');
        }
        const sourceWidth = resolveTextureExtent(sourceTexture, 'width', request, true);
        const sourceHeight = resolveTextureExtent(sourceTexture, 'height', request, false);
        if (prepared.sourceWidth !== sourceWidth || prepared.sourceHeight !== sourceHeight) {
            throw new Error('WebGPU Kawase blur source 크기가 prepare 이후 변경되었습니다.');
        }
        if (prepared.passes.length > 0 && !prepared.pipelineSet) {
            throw new Error('WebGPU Kawase blur pipeline prepared state가 없습니다.');
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
                label: 'title-kawase-compatibility-shader',
                code: WEBGPU_KAWASE_COMPATIBILITY_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-kawase-linear-clamp-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest'
            });
        }

        const downPipeline = this.device.createRenderPipeline({
            label: `title-kawase-down-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'kawase_down',
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const upPipeline = this.device.createRenderPipeline({
            label: `title-kawase-up-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'kawase_up',
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const pipelineSet = Object.freeze({
            format,
            down: Object.freeze({
                pipeline: downPipeline,
                bindGroupLayout: downPipeline.getBindGroupLayout(0)
            }),
            up: Object.freeze({
                pipeline: upPipeline,
                bindGroupLayout: upPipeline.getBindGroupLayout(0)
            })
        });
        this.pipelineSets.set(format, pipelineSet);
        return pipelineSet;
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
            label: `title-kawase-${pipeline.pipeline.entryPoint || 'pass'}-bind-group:${uniformOffset}`,
            layout: pipeline.bindGroupLayout,
            entries: [
                { binding: 0, resource: this.sampler },
                { binding: 1, resource: readView },
                {
                    binding: 2,
                    resource: {
                        buffer: uniformBuffer,
                        offset: uniformOffset,
                        size: 16
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
            throw new Error('WebGPU Kawase blur frame cleanup callback 등록에 실패했습니다.');
        }
        return frameState;
    }

    #prepareUniformBuffer(frameState, passes) {
        const bufferIndex = frameState.uniformRequestCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-kawase-uniform-buffer:${bufferIndex}`,
                size: WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.PASS_COUNT
                    * UNIFORM_SLOT_ALIGNMENT,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
        }

        this.uniformScratch.fill(0);
        for (let index = 0; index < passes.length; index++) {
            const pass = passes[index];
            const floatOffset = index * UNIFORM_FLOATS_PER_SLOT;
            this.uniformScratch[floatOffset] = 1 / Math.max(1, pass.sourceWidth);
            this.uniformScratch[floatOffset + 1] = 1 / Math.max(1, pass.sourceHeight);
            this.uniformScratch[floatOffset + 2] = pass.offset;
        }
        this.device.queue.writeBuffer(buffer, 0, this.uniformScratch);
        return buffer;
    }

    #releaseFrameLease(frameState, lease) {
        if (!frameState.activeLeases.has(lease)) {
            throw new Error('WebGPU Kawase blur가 소유하지 않은 texture lease입니다.');
        }
        if (this.texturePool.release(lease) !== true) {
            throw new Error('WebGPU Kawase blur texture lease 반환에 실패했습니다.');
        }
        frameState.activeLeases.delete(lease);
    }

    #cleanupFrameState(frameState, reason) {
        if (!frameState || frameState.cleaned) {
            return;
        }
        frameState.cleaned = true;
        for (const lease of Array.from(frameState.activeLeases)) {
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

function createCompatibilityPlan(sourceWidth, sourceHeight, blur) {
    if (blur <= 0) {
        return Object.freeze({
            blurScale: Math.max(0.5, blur / 8),
            passes: Object.freeze([]),
            finalWidth: sourceWidth,
            finalHeight: sourceHeight
        });
    }

    const blurScale = Math.max(0.5, blur / 8);
    const downTargets = [];
    let levelWidth = sourceWidth;
    let levelHeight = sourceHeight;
    for (let index = 0;
        index < WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.DOWN_PASS_COUNT;
        index++) {
        levelWidth = Math.max(
            WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.MIN_SIZE,
            Math.floor(levelWidth * 0.5)
        );
        levelHeight = Math.max(
            WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.MIN_SIZE,
            Math.floor(levelHeight * 0.5)
        );
        downTargets.push(Object.freeze({ width: levelWidth, height: levelHeight }));
    }

    const upTargets = [];
    for (let index = downTargets.length - 2; index >= 0; index--) {
        upTargets.push(downTargets[index]);
    }

    const passes = [];
    let readWidth = sourceWidth;
    let readHeight = sourceHeight;
    for (let index = 0; index < downTargets.length; index++) {
        const target = downTargets[index];
        passes.push(Object.freeze({
            direction: 'down',
            legacyIndex: index,
            sourceWidth: readWidth,
            sourceHeight: readHeight,
            targetWidth: target.width,
            targetHeight: target.height,
            offset: (index + 1) * blurScale
        }));
        readWidth = target.width;
        readHeight = target.height;
    }

    for (let index = upTargets.length - 1; index >= 0; index--) {
        const target = upTargets[index];
        passes.push(Object.freeze({
            direction: 'up',
            legacyIndex: index,
            sourceWidth: readWidth,
            sourceHeight: readHeight,
            targetWidth: target.width,
            targetHeight: target.height,
            offset: (index + 1) * blurScale
        }));
        readWidth = target.width;
        readHeight = target.height;
    }

    return Object.freeze({
        blurScale,
        passes: Object.freeze(passes),
        finalWidth: readWidth,
        finalHeight: readHeight
    });
}

function createPoolDescriptor(width, height, format) {
    return {
        width,
        height,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format,
        usage: WEBGPU_KAWASE_COMPATIBILITY_CONSTANTS.TEXTURE_USAGE,
        viewDimension: '2d'
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
            throw new TypeError(`WebGPU Kawase blur device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('WebGPU Kawase blur device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireDeviceGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('WebGPU Kawase blur deviceGeneration은 0 이상의 정수여야 합니다.');
    }
}

function requireComposerPort(port) {
    if (!port || typeof port.deferFrameCallbacks !== 'function') {
        throw new TypeError('WebGPU Kawase blur composerPort.deferFrameCallbacks()가 필요합니다.');
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
            throw new TypeError(`WebGPU Kawase blur texture pool에 ${methodName}()가 없습니다.`);
        }
    }
}

function requireSourceTexture(texture) {
    if ((!texture || (typeof texture !== 'object' && typeof texture !== 'function'))
        || typeof texture.createView !== 'function') {
        throw new TypeError('WebGPU Kawase blur sourceTexture.createView()가 필요합니다.');
    }
    return texture;
}

function requireCompatibilityProfile(request) {
    if (request?.edgeMode !== 'clamp') {
        throw new Error(
            `WebGPU Kawase compatibility는 edgeMode=clamp만 지원합니다: ${String(request?.edgeMode)}`
        );
    }
    if (request?.colorSpace !== 'srgb') {
        throw new Error(
            `WebGPU Kawase compatibility는 colorSpace=srgb만 지원합니다: ${String(request?.colorSpace)}`
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
    throw new RangeError(`WebGPU Kawase blur sourceTexture.${property}가 유효하지 않습니다.`);
}

function resolveTextureFormat(requestFormat, sourceFormat) {
    if (typeof requestFormat === 'string' && requestFormat) {
        return requestFormat;
    }
    if (typeof sourceFormat === 'string' && sourceFormat) {
        return sourceFormat;
    }
    throw new TypeError('WebGPU Kawase blur output format이 필요합니다.');
}

function normalizeBlur(value) {
    return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}
