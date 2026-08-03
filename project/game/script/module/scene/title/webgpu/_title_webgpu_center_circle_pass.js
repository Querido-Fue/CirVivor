const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const COLOR_WRITE_ALL = 0x0F;
const UNIFORM_FLOAT_COUNT = 36;
const UNIFORM_BYTE_SIZE = UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const DEFAULT_BASE_COLOR = Object.freeze([0.086, 0.435, 0.984]);
const DEFAULT_DEEP_COLOR = Object.freeze([0.016, 0.176, 0.62]);
const DEFAULT_RIM_COLOR = Object.freeze([0.4, 0.737, 1]);
const DEFAULT_HIGHLIGHT_COLOR = Object.freeze([0.94, 0.99, 1]);

/** Title center circle pass의 고정 uniform ABI입니다. */
export const TITLE_WEBGPU_CENTER_CIRCLE_PASS_CONSTANTS = Object.freeze({
    UNIFORM_BYTE_SIZE
});

/**
 * 기존 TITLE_LOADING_CIRCLE GLSL의 glass, refraction, rim, glow 수식을 WebGPU로 옮긴 WGSL입니다.
 * target과 backdrop의 screen-space origin/논리 크기를 분리해 저해상도 blur 결과도
 * 원래 backdrop ROI에 정확히 대응시킵니다.
 */
export const TITLE_WEBGPU_CENTER_CIRCLE_SHADER = `
    struct CenterCircleParameters {
        targetResolution: vec2<f32>,
        center: vec2<f32>,
        backdropResolution: vec2<f32>,
        backdropLogicalSize: vec2<f32>,
        targetToBackdropOffset: vec2<f32>,
        radius: f32,
        outlineWidth: f32,
        time: f32,
        alpha: f32,
        glowStrength: f32,
        glassStrength: f32,
        brightnessBoost: f32,
        bodyRadiusExpandOutlineRatio: f32,
        backdropBlurStrength: f32,
        backdropRefractionStrength: f32,
        baseColor: vec4<f32>,
        deepColor: vec4<f32>,
        rimColor: vec4<f32>,
        highlightColor: vec4<f32>,
    };

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> parameters: CenterCircleParameters;
    @group(0) @binding(1) var backdropSampler: sampler;
    @group(0) @binding(2) var backdropTexture: texture_2d<f32>;

    fn saturate(value: f32) -> f32 {
        return clamp(value, 0.0, 1.0);
    }

    fn ellipse_mask(position: vec2<f32>, center: vec2<f32>, radius: vec2<f32>, rotation: f32) -> f32 {
        let sine = sin(rotation);
        let cosine = cos(rotation);
        let offset = position - center;
        let rotated = vec2<f32>(
            (offset.x * cosine) - (offset.y * sine),
            (offset.x * sine) + (offset.y * cosine)
        ) / max(radius, vec2<f32>(0.0001));
        return exp(-dot(rotated, rotated) * 2.25);
    }

    @vertex
    fn fullscreen_vertex(@builtin(vertex_index) vertexIndex: u32) -> FullscreenVertexOutput {
        let positions = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(3.0, -1.0),
            vec2<f32>(-1.0, 3.0)
        );
        var output: FullscreenVertexOutput;
        output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
        return output;
    }

    @fragment
    fn center_circle_fragment(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let fragCoord = clamp(
            input.position.xy,
            vec2<f32>(0.0),
            parameters.targetResolution
        );
        let radius = max(1.0, parameters.radius);
        let bodyRadius = radius
            + (max(0.0, parameters.bodyRadiusExpandOutlineRatio) * max(1.0, parameters.outlineWidth));
        let local = fragCoord - parameters.center;
        let normalized = local / bodyRadius;
        let distanceFromCenter = length(local);
        let edgeSoftness = 1.35;
        let circleMask = 1.0 - smoothstep(
            bodyRadius - edgeSoftness,
            bodyRadius + edgeSoftness,
            distanceFromCenter
        );
        let outsideDistance = max(distanceFromCenter - radius, 0.0);
        let fillMask = circleMask;

        let normal = vec3<f32>(
            normalized,
            sqrt(max(0.0, 1.0 - dot(normalized, normalized)))
        );
        let lightDirection = normalize(vec3<f32>(-0.45, -0.68, 0.58));
        let light = saturate(dot(normal, lightDirection));
        let upperLight = saturate(-normalized.y);
        let lowerDepth = saturate((normalized.y + 0.15) * 0.82);
        let sphericalDepth = smoothstep(0.18, 1.0, distanceFromCenter / bodyRadius);
        var bodyColor = parameters.baseColor.xyz * (0.76 + (normal.z * 0.22) + (light * 0.16));
        bodyColor = mix(
            bodyColor,
            parameters.deepColor.xyz,
            (lowerDepth * 0.26) + (sphericalDepth * 0.08)
        );

        let broadTopSheen = pow(upperLight, 3.0) * 0.09 * parameters.glassStrength;
        let compactHighlight = ellipse_mask(
            normalized,
            vec2<f32>(-0.25, -0.56),
            vec2<f32>(0.42, 0.095),
            -0.34
        ) * 0.19 * parameters.glassStrength;
        let edgeGlint = pow(saturate(
            1.0 - abs(distanceFromCenter - (radius * 0.86)) / max(1.0, radius * 0.16)
        ), 2.4) * pow(upperLight, 4.5) * 0.12 * parameters.glassStrength;
        var fillColor = bodyColor
            + (parameters.highlightColor.xyz * (broadTopSheen + compactHighlight + edgeGlint));
        fillColor = min(
            vec3<f32>(1.0),
            (fillColor * (1.0 + saturate(parameters.brightnessBoost)))
                + (parameters.highlightColor.xyz * saturate(parameters.brightnessBoost) * 0.18)
        );

        let backdropLocal = fragCoord + parameters.targetToBackdropOffset;
        let refractionOffset = normalized * parameters.backdropRefractionStrength;
        let roiUv = (backdropLocal + refractionOffset)
            / max(parameters.backdropLogicalSize, vec2<f32>(1.0));
        let halfBackdropTexel = vec2<f32>(0.5)
            / max(parameters.backdropResolution, vec2<f32>(1.0));
        let backdropUv = clamp(
            roiUv,
            halfBackdropTexel,
            vec2<f32>(1.0) - halfBackdropTexel
        );
        let backdropBlurColor = textureSample(
            backdropTexture,
            backdropSampler,
            backdropUv
        ).rgb;
        let backdropBlend = saturate(parameters.backdropBlurStrength)
            * fillMask
            * (0.72 + (upperLight * 0.18));
        fillColor = mix(fillColor, backdropBlurColor, backdropBlend);

        let outlineDistance = abs(distanceFromCenter - radius);
        let outlineSoftness = max(0.42, edgeSoftness * 0.38);
        let outlineCore = 1.0 - smoothstep(
            max(0.24, parameters.outlineWidth * 0.22),
            max(0.42, parameters.outlineWidth * 0.22) + outlineSoftness,
            outlineDistance
        );
        let innerRim = exp(-pow(
            max(radius - distanceFromCenter, 0.0) / max(1.0, parameters.outlineWidth * 4.0),
            2.0
        )) * circleMask * 0.04;
        let angle = atan2(normalized.y, normalized.x);
        let rimLight = pow(saturate(cos(angle + 2.18) * 0.5 + 0.5), 3.0);
        let rimBaseColor = mix(parameters.deepColor.xyz, parameters.baseColor.xyz, 0.58);
        let rimColor = mix(rimBaseColor, parameters.highlightColor.xyz, rimLight * 0.16);
        let outlineAlpha = outlineCore * 0.36;

        let glowPulse = 0.94 + (sin(parameters.time) * 0.06);
        let glowAlpha = exp(-pow(
            outsideDistance / max(1.0, radius * 0.42),
            2.0
        )) * (1.0 - circleMask) * parameters.glowStrength * glowPulse;
        let glowColor = mix(parameters.deepColor.xyz, parameters.baseColor.xyz, 0.48);

        let fillAlpha = fillMask;
        var premultipliedColor = (fillColor * fillAlpha)
            + (rimColor * (outlineAlpha + innerRim))
            + (glowColor * glowAlpha);
        var alpha = saturate(fillAlpha + outlineAlpha + innerRim + glowAlpha);
        alpha = saturate(alpha * parameters.alpha);
        premultipliedColor *= parameters.alpha;

        if (alpha <= 0.001) {
            discard;
        }

        premultipliedColor = min(premultipliedColor, vec3<f32>(alpha));
        return vec4<f32>(premultipliedColor, alpha);
    }
`;

/**
 * 타이틀 중앙 원을 caller-owned transparent effect target에 합성하는 WebGPU ROI pass입니다.
 * presentation texture 획득, encoder finish/submit, canvas mark와 blur 생성은 caller가 소유합니다.
 */
export class TitleWebGpuCenterCirclePass {
    constructor() {
        this.device = null;
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.sampler = null;
        this.pipelines = new Map();
        this.uniformBuffers = [];
        this.uniformBytes = new ArrayBuffer(UNIFORM_BYTE_SIZE);
        this.uniformFloats = new Float32Array(this.uniformBytes);
        this.activeFrameId = null;
        this.frameUniformCount = 0;
        this.encodeCount = 0;
        this.skipCount = 0;
        this.generationChangeCount = 0;
        this.pipelineCreateCount = 0;
        this.uniformBufferCreateCount = 0;
        this.bindGroupCreateCount = 0;
        this.cleanupFailureCount = 0;
        this.destroyed = false;
    }

    /**
     * caller 소유 encoder에 center circle ROI render pass 하나를 기록합니다.
     * @param {object} context - composer callback의 고정 frame context입니다.
     * @param {object} input - 명령과 caller 소유 texture view 정보입니다.
     * @param {object} input.command - `TitleCenterCircle.getPresentationCommand()` 결과입니다.
     * @param {GPUTextureView} input.backdropView - blur service가 만든 backdrop texture view입니다.
     * @param {number} input.backdropWidth - backdrop texture 너비입니다.
     * @param {number} input.backdropHeight - backdrop texture 높이입니다.
     * @param {number} [input.backdropLogicalWidth=input.targetWidth] - backdrop가 나타내는 screen-space 너비입니다.
     * @param {number} [input.backdropLogicalHeight=input.targetHeight] - backdrop가 나타내는 screen-space 높이입니다.
     * @param {number} [input.backdropOriginX=input.originX] - backdrop 논리 영역 좌상단의 screen-space X입니다.
     * @param {number} [input.backdropOriginY=input.originY] - backdrop 논리 영역 좌상단의 screen-space Y입니다.
     * @param {GPUTextureView} input.targetView - caller 소유 transparent effect target view입니다.
     * @param {number} input.targetWidth - effect target 너비입니다.
     * @param {number} input.targetHeight - effect target 높이입니다.
     * @param {number} [input.originX=0] - target 좌상단의 screen-space X입니다.
     * @param {number} [input.originY=0] - target 좌상단의 screen-space Y입니다.
     * @param {'load'|'clear'} [input.loadOp='load'] - 기존 target 내용을 보존하거나 지울지 선택합니다.
     * @param {GPUTextureFormat} [input.format=context.format] - effect target format입니다.
     * @returns {boolean} 실제 render pass를 기록했으면 true입니다.
     */
    encode(context, input = {}) {
        this.#assertUsableContext(context);

        const command = input.command;
        if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
            this.skipCount += 1;
            return false;
        }

        const alpha = clamp01(Number.isFinite(command.alpha) ? command.alpha : 1);
        if (alpha <= 0) {
            this.skipCount += 1;
            return false;
        }

        const targetView = requireTextureView(input.targetView, 'targetView');
        const backdropView = requireTextureView(input.backdropView, 'backdropView');
        if (targetView === backdropView) {
            throw new Error('title WebGPU center circle target과 backdrop view는 분리되어야 합니다.');
        }
        const targetWidth = normalizeExtent(input.targetWidth, 'targetWidth');
        const targetHeight = normalizeExtent(input.targetHeight, 'targetHeight');
        const backdropWidth = normalizeExtent(input.backdropWidth, 'backdropWidth');
        const backdropHeight = normalizeExtent(input.backdropHeight, 'backdropHeight');
        const originX = Number.isFinite(input.originX) ? input.originX : 0;
        const originY = Number.isFinite(input.originY) ? input.originY : 0;
        const backdropLogicalWidth = normalizeExtent(
            input.backdropLogicalWidth ?? targetWidth,
            'backdropLogicalWidth'
        );
        const backdropLogicalHeight = normalizeExtent(
            input.backdropLogicalHeight ?? targetHeight,
            'backdropLogicalHeight'
        );
        const backdropOriginX = Number.isFinite(input.backdropOriginX)
            ? input.backdropOriginX
            : originX;
        const backdropOriginY = Number.isFinite(input.backdropOriginY)
            ? input.backdropOriginY
            : originY;
        const loadOp = normalizeLoadOp(input.loadOp);
        const format = resolveTargetFormat(input.format, context.format);
        const centerX = Number.isFinite(command.x) ? command.x : 0;
        const centerY = Number.isFinite(command.y) ? command.y : 0;
        const radius = Math.max(1, command.radius);
        const outlineWidth = Number.isFinite(command.outlineWidth)
            ? Math.max(1, command.outlineWidth)
            : Math.max(1, radius * 0.025);
        const scissorPadding = Math.max(
            Number.isFinite(command.scissorPaddingMin) ? command.scissorPaddingMin : 28,
            radius * (
                Number.isFinite(command.scissorPaddingRatio)
                    ? Math.max(0, command.scissorPaddingRatio)
                    : 0.86
            )
        );
        const roi = buildTargetLocalRoi(
            centerX,
            centerY,
            radius + scissorPadding + (outlineWidth * 4),
            originX,
            originY,
            targetWidth,
            targetHeight
        );
        if (!roi) {
            this.skipCount += 1;
            return false;
        }

        this.#bindGeneration(context);
        const pipelineRecord = this.#getPipeline(format);
        const uniformIndex = this.#nextUniformIndex(context.frameId);
        const uniformBuffer = this.#getUniformBuffer(uniformIndex);
        this.#stageUniforms({
            command,
            targetWidth,
            targetHeight,
            backdropWidth,
            backdropHeight,
            backdropLogicalWidth,
            backdropLogicalHeight,
            targetToBackdropOffsetX: originX - backdropOriginX,
            targetToBackdropOffsetY: originY - backdropOriginY,
            centerX: centerX - originX,
            centerY: centerY - originY,
            radius,
            outlineWidth,
            alpha
        });
        context.device.queue.writeBuffer(uniformBuffer, 0, this.uniformBytes);
        const bindGroup = this.#getBindGroup(
            pipelineRecord,
            uniformBuffer,
            backdropView,
            uniformIndex
        );

        const renderPass = context.encoder.beginRenderPass({
            label: `title-center-circle-pass:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: TRANSPARENT_CLEAR_VALUE,
                loadOp,
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(pipelineRecord.pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.setViewport(roi.x, roi.y, roi.width, roi.height, 0, 1);
        renderPass.setScissorRect(roi.x, roi.y, roi.width, roi.height);
        renderPass.draw(3, 1, 0, 0);
        renderPass.end();
        this.encodeCount += 1;
        return true;
    }

    /** generation resource를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#releaseGenerationResources();
        this.device = null;
        this.deviceGeneration = null;
        this.destroyed = true;
        return true;
    }

    /** 테스트와 rollout 진단용 immutable snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            pipelineFormatCount: this.pipelines.size,
            uniformBufferCount: this.uniformBuffers.length,
            activeFrameId: this.activeFrameId,
            frameUniformCount: this.frameUniformCount,
            encodeCount: this.encodeCount,
            skipCount: this.skipCount,
            generationChangeCount: this.generationChangeCount,
            pipelineCreateCount: this.pipelineCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount,
            bindGroupCreateCount: this.bindGroupCreateCount,
            cleanupFailureCount: this.cleanupFailureCount
        });
    }

    #assertUsableContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU center circle pass는 사용할 수 없습니다.');
        }
        requireDevice(context?.device);
        if (!Number.isSafeInteger(context?.deviceGeneration) || context.deviceGeneration < 0) {
            throw new RangeError('title WebGPU center circle deviceGeneration은 0 이상의 정수여야 합니다.');
        }
        if (!Number.isSafeInteger(context?.frameId) || context.frameId < 0) {
            throw new RangeError('title WebGPU center circle frameId는 0 이상의 정수여야 합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title WebGPU center circle에는 caller 소유 command encoder가 필요합니다.');
        }
    }

    #bindGeneration(context) {
        if (!this.device) {
            this.device = context.device;
            this.deviceGeneration = context.deviceGeneration;
            return;
        }
        if (context.deviceGeneration === this.deviceGeneration) {
            if (context.device !== this.device) {
                this.#releaseGenerationResources();
                this.device = null;
                this.deviceGeneration = null;
                throw new Error('title WebGPU center circle device identity가 generation 변경 없이 바뀌었습니다.');
            }
            return;
        }
        if (context.deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title WebGPU center circle device generation입니다.');
        }

        this.#releaseGenerationResources();
        this.device = context.device;
        this.deviceGeneration = context.deviceGeneration;
        this.generationChangeCount += 1;
    }

    #getPipeline(format) {
        const cached = this.pipelines.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-center-circle-shader',
                code: TITLE_WEBGPU_CENTER_CIRCLE_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-center-circle-backdrop-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                minFilter: 'linear',
                magFilter: 'linear'
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-center-circle-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'center_circle_fragment',
                targets: [{
                    format,
                    blend: {
                        color: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add'
                        }
                    },
                    writeMask: COLOR_WRITE_ALL
                }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const record = Object.freeze({
            pipeline,
            bindGroupLayout: pipeline.getBindGroupLayout(0),
            bindGroupsByBuffer: new WeakMap()
        });
        this.pipelines.set(format, record);
        this.pipelineCreateCount += 1;
        return record;
    }

    #nextUniformIndex(frameId) {
        if (this.activeFrameId !== frameId) {
            this.activeFrameId = frameId;
            this.frameUniformCount = 0;
        }
        return this.frameUniformCount++;
    }

    #getUniformBuffer(index) {
        let buffer = this.uniformBuffers[index];
        if (buffer) {
            return buffer;
        }
        buffer = this.device.createBuffer({
            label: `title-center-circle-uniform:${index}`,
            size: UNIFORM_BYTE_SIZE,
            usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
        });
        this.uniformBuffers[index] = buffer;
        this.uniformBufferCreateCount += 1;
        return buffer;
    }

    #getBindGroup(pipelineRecord, uniformBuffer, backdropView, uniformIndex) {
        let bindGroupsByBackdrop = pipelineRecord.bindGroupsByBuffer.get(uniformBuffer);
        if (!bindGroupsByBackdrop) {
            bindGroupsByBackdrop = new WeakMap();
            pipelineRecord.bindGroupsByBuffer.set(uniformBuffer, bindGroupsByBackdrop);
        }
        const cached = bindGroupsByBackdrop.get(backdropView);
        if (cached) {
            return cached;
        }
        const bindGroup = this.device.createBindGroup({
            label: `title-center-circle-bind-group:${uniformIndex}`,
            layout: pipelineRecord.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: uniformBuffer,
                        offset: 0,
                        size: UNIFORM_BYTE_SIZE
                    }
                },
                { binding: 1, resource: this.sampler },
                { binding: 2, resource: backdropView }
            ]
        });
        bindGroupsByBackdrop.set(backdropView, bindGroup);
        this.bindGroupCreateCount += 1;
        return bindGroup;
    }

    #stageUniforms({
        command,
        targetWidth,
        targetHeight,
        backdropWidth,
        backdropHeight,
        backdropLogicalWidth,
        backdropLogicalHeight,
        targetToBackdropOffsetX,
        targetToBackdropOffsetY,
        centerX,
        centerY,
        radius,
        outlineWidth,
        alpha
    }) {
        const floats = this.uniformFloats;
        floats.fill(0);
        floats[0] = targetWidth;
        floats[1] = targetHeight;
        floats[2] = centerX;
        floats[3] = centerY;
        floats[4] = backdropWidth;
        floats[5] = backdropHeight;
        floats[6] = backdropLogicalWidth;
        floats[7] = backdropLogicalHeight;
        floats[8] = targetToBackdropOffsetX;
        floats[9] = targetToBackdropOffsetY;
        floats[10] = radius;
        floats[11] = outlineWidth;
        floats[12] = Number.isFinite(command.time) ? command.time : 0;
        floats[13] = alpha;
        floats[14] = Number.isFinite(command.glowStrength) ? Math.max(0, command.glowStrength) : 0.24;
        floats[15] = Number.isFinite(command.glassStrength) ? Math.max(0, command.glassStrength) : 0.72;
        floats[16] = Number.isFinite(command.brightnessBoost) ? Math.max(0, command.brightnessBoost) : 0.08;
        floats[17] = Number.isFinite(command.bodyRadiusExpandOutlineRatio)
            ? Math.max(0, command.bodyRadiusExpandOutlineRatio)
            : 0.38;
        floats[18] = Number.isFinite(command.backdropBlurStrength)
            ? Math.max(0, command.backdropBlurStrength)
            : 0.16;
        floats[19] = Number.isFinite(command.backdropRefractionStrength)
            ? Math.max(0, command.backdropRefractionStrength)
            : 4.5;
        writeColor(floats, 20, command.colors?.base, DEFAULT_BASE_COLOR);
        writeColor(floats, 24, command.colors?.deep, DEFAULT_DEEP_COLOR);
        writeColor(floats, 28, command.colors?.rim, DEFAULT_RIM_COLOR);
        writeColor(floats, 32, command.colors?.highlight, DEFAULT_HIGHLIGHT_COLOR);
    }

    #releaseGenerationResources() {
        for (const buffer of this.uniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        this.uniformBuffers.length = 0;
        this.pipelines.clear();
        this.shaderModule = null;
        this.sampler = null;
        this.activeFrameId = null;
        this.frameUniformCount = 0;
    }
}

function requireDevice(device) {
    for (const methodName of [
        'createShaderModule',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer',
        'createSampler'
    ]) {
        if (typeof device?.[methodName] !== 'function') {
            throw new TypeError(`title WebGPU center circle device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title WebGPU center circle device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireTextureView(view, name) {
    if (!view || (typeof view !== 'object' && typeof view !== 'function')) {
        throw new TypeError(`title WebGPU center circle ${name}가 필요합니다.`);
    }
    return view;
}

function normalizeExtent(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`title WebGPU center circle ${name}는 양수여야 합니다.`);
    }
    return Math.max(1, Math.floor(value));
}

function normalizeLoadOp(value) {
    if (value === undefined) {
        return 'load';
    }
    if (value !== 'load' && value !== 'clear') {
        throw new TypeError('title WebGPU center circle loadOp은 load 또는 clear여야 합니다.');
    }
    return value;
}

function resolveTargetFormat(inputFormat, contextFormat) {
    if (typeof inputFormat === 'string' && inputFormat) {
        return inputFormat;
    }
    if (typeof contextFormat === 'string' && contextFormat) {
        return contextFormat;
    }
    throw new TypeError('title WebGPU center circle target format이 필요합니다.');
}

function buildTargetLocalRoi(
    centerX,
    centerY,
    boundsRadius,
    originX,
    originY,
    targetWidth,
    targetHeight
) {
    if (!Number.isFinite(boundsRadius) || boundsRadius <= 0) {
        return null;
    }
    const left = Math.max(0, Math.floor(centerX - boundsRadius - originX));
    const top = Math.max(0, Math.floor(centerY - boundsRadius - originY));
    const right = Math.min(targetWidth, Math.ceil(centerX + boundsRadius - originX));
    const bottom = Math.min(targetHeight, Math.ceil(centerY + boundsRadius - originY));
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x: left, y: top, width, height };
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}

function writeColor(target, offset, source, fallback) {
    for (let index = 0; index < 3; index++) {
        target[offset + index] = Number.isFinite(source?.[index])
            ? source[index]
            : fallback[index];
    }
    target[offset + 3] = 0;
}
