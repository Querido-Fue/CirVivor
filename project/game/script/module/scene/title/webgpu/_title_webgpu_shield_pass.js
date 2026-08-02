import {
    TITLE_SHIELD_PRESENTATION_MAX_DENTS,
    TITLE_SHIELD_PRESENTATION_MAX_IMPACTS
} from '../shield/_title_shield_render_command.js';
import { TITLE_WEBGPU_SHIELD_INTERACTION_ABI } from './_title_webgpu_shield_interaction_abi.js';

const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const COLOR_WRITE_ALL = 0x0F;
const UNIFORM_FLOAT_COUNT = 140;
const UNIFORM_BYTE_SIZE = UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const IMPACT_FLOAT_OFFSET = 28;
const DENT_FLOAT_OFFSET = IMPACT_FLOAT_OFFSET + (TITLE_SHIELD_PRESENTATION_MAX_IMPACTS * 4);
const IMPACT_UNIFORM_BYTE_OFFSET = IMPACT_FLOAT_OFFSET * Float32Array.BYTES_PER_ELEMENT;
const DENT_UNIFORM_BYTE_OFFSET = DENT_FLOAT_OFFSET * Float32Array.BYTES_PER_ELEMENT;
const COUNT_UNIFORM_BYTE_OFFSET = 10 * Uint32Array.BYTES_PER_ELEMENT;
const COUNT_UNIFORM_BYTE_SIZE = 2 * Uint32Array.BYTES_PER_ELEMENT;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const DEFAULT_SHADOW_COLOR = Object.freeze([0.07, 0.04, 0.25]);
const DEFAULT_LOW_COLOR = Object.freeze([0.60, 0.36, 0.98]);
const DEFAULT_HIGH_COLOR = Object.freeze([0.70, 0.93, 1.0]);
const DEFAULT_HIGHLIGHT_COLOR = Object.freeze([0.96, 0.995, 1.0]);

/** WebGPU magnetic shield pass의 고정 ABI와 shader 처리 한계입니다. */
export const TITLE_WEBGPU_SHIELD_PASS_CONSTANTS = Object.freeze({
    MAX_IMPACTS: TITLE_SHIELD_PRESENTATION_MAX_IMPACTS,
    MAX_DENTS: TITLE_SHIELD_PRESENTATION_MAX_DENTS,
    UNIFORM_BYTE_SIZE
});

/**
 * 기존 WebGL magnetic shield 수식을 premultiplied-alpha WebGPU pass로 옮긴 WGSL입니다.
 */
export const TITLE_WEBGPU_SHIELD_SHADER = `
    const TWO_PI: f32 = 6.283185307179586;

    struct ShieldParameters {
        resolution: vec2<f32>,
        center: vec2<f32>,
        radius: f32,
        fieldRadius: f32,
        time: f32,
        alpha: f32,
        ringThickness: f32,
        glowWidth: f32,
        impactCount: u32,
        dentCount: u32,
        shadowColor: vec4<f32>,
        lowColor: vec4<f32>,
        highColor: vec4<f32>,
        highlightColor: vec4<f32>,
        impacts: array<vec4<f32>, ${TITLE_SHIELD_PRESENTATION_MAX_IMPACTS}>,
        dents: array<vec4<f32>, ${TITLE_SHIELD_PRESENTATION_MAX_DENTS}>,
    };

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> parameters: ShieldParameters;

    fn saturate(value: f32) -> f32 {
        return clamp(value, 0.0, 1.0);
    }

    fn gaussian(value: f32, sigma: f32) -> f32 {
        let safeSigma = max(0.0001, sigma);
        let normalized = value / safeSigma;
        return exp(-(normalized * normalized));
    }

    fn angular_delta(angleA: f32, angleB: f32) -> f32 {
        let delta = angleA - angleB;
        return delta - (round(delta / TWO_PI) * TWO_PI);
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
    fn magnetic_shield_fragment(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let fragCoord = min(input.position.xy, parameters.resolution);
        let toPixel = fragCoord - parameters.center;
        let distanceFromCenter = length(toPixel);
        let angle = atan2(toPixel.y, toPixel.x);

        var dentOffset = 0.0;
        var dentField = 0.0;
        for (var index: u32 = 0u; index < ${TITLE_SHIELD_PRESENTATION_MAX_DENTS}u; index += 1u) {
            if (index >= parameters.dentCount) {
                break;
            }

            let dent = parameters.dents[index];
            let dentMask = gaussian(angular_delta(angle, dent.x), dent.z) * dent.w;
            dentOffset += dent.y * dentMask;
            dentField = max(dentField, dentMask);
        }

        let shellWave = sin(
            (angle * 7.5)
            - (parameters.time * 2.4)
            + (sin((angle * 3.4) + (parameters.time * 1.45)) * 0.7)
        );
        let shellRipple = shellWave * (1.0 + (dentField * 1.35)) * 1.4;
        let shieldRadius = max(1.0, parameters.radius - dentOffset + shellRipple);
        let fieldRadius = max(shieldRadius, parameters.fieldRadius);
        let fieldRange = max(1.0, fieldRadius - shieldRadius);
        let ringDistance = abs(distanceFromCenter - shieldRadius);
        let ringCore = exp(-pow(ringDistance / max(1.0, parameters.ringThickness), 2.0));
        let outerGlow = exp(-pow(
            max(distanceFromCenter - shieldRadius, 0.0) / max(1.0, parameters.glowWidth),
            2.0
        ));
        let innerGlow = exp(-pow(
            max(shieldRadius - distanceFromCenter, 0.0) / max(1.0, parameters.glowWidth * 0.42),
            2.0
        )) * 0.16;

        let angleLight = 0.5 + (0.5 * cos(angle + 0.85));
        let ringNoise = 0.5 + (0.5 * sin(
            (angle * 5.0)
            - (parameters.time * 1.7)
            + (sin((angle * 3.0) + (parameters.time * 0.9)) * 0.4)
        ));
        let shimmer = mix(0.92, 1.08, angleLight) * mix(0.96, 1.04, ringNoise);

        let shadowColor = parameters.shadowColor.xyz;
        let lowColor = parameters.lowColor.xyz;
        let highColor = parameters.highColor.xyz;
        let highlightColor = parameters.highlightColor.xyz;
        var baseColor = mix(lowColor, highColor, angleLight);
        baseColor = mix(baseColor, highlightColor, pow(angleLight, 6.0) * 0.55);
        let ringColor = mix(shadowColor, baseColor, saturate(ringCore + (outerGlow * 0.7)));
        let fieldSignedDistance = distanceFromCenter - shieldRadius;
        let fieldDistance = max(fieldSignedDistance, 0.0);
        let fieldFade = 1.0 - smoothstep(0.0, fieldRange, fieldDistance);
        let fieldTransition = max(1.0, parameters.ringThickness * 2.4);
        let fieldMask = smoothstep(
            -fieldTransition * 0.35,
            fieldTransition,
            fieldSignedDistance
        );
        let fieldNoise = 0.55 + (0.45 * sin(
            (angle * 2.2)
            - (parameters.time * 0.65)
            + (ringNoise * 1.8)
        ));
        let fieldVeil = pow(fieldFade, 1.18);
        let fieldBloom = exp(-pow(
            fieldDistance / max(1.0, fieldRange * 0.34),
            1.28
        ));
        var fieldAlpha = ((fieldVeil * 0.32) + (fieldBloom * 0.06))
            * fieldMask
            * mix(0.82, 1.12, fieldNoise);
        var fieldColor = mix(shadowColor, baseColor, 0.88);
        fieldColor = mix(fieldColor, highColor, fieldBloom * 0.065);
        fieldColor = mix(fieldColor, highlightColor, pow(fieldFade, 2.2) * 0.18);

        var impactAlpha = 0.0;
        var impactColor = vec3<f32>(0.0);
        var impactActivity = 0.0;
        for (var index: u32 = 0u; index < ${TITLE_SHIELD_PRESENTATION_MAX_IMPACTS}u; index += 1u) {
            if (index >= parameters.impactCount) {
                break;
            }

            let impact = parameters.impacts[index];
            let progress = saturate(impact.w);
            let fade = pow(1.0 - progress, 1.4);
            let angularMask = gaussian(angular_delta(angle, impact.x), impact.z);
            let radialCenter = shieldRadius + mix(-1.0, 8.0, progress);
            let radialMask = gaussian(
                distanceFromCenter - radialCenter,
                (parameters.ringThickness * 2.2) + 5.0
            );
            let flare = angularMask * radialMask * impact.y * fade * 0.72;
            impactAlpha += flare;
            impactActivity = max(impactActivity, angularMask * impact.y * fade);
            impactColor += mix(highColor, highlightColor, 0.58) * flare;
        }

        let approachActivity = saturate(dentField * 1.2);
        let localActivity = saturate(max(approachActivity, impactActivity * 0.92));
        let activityNoise = 0.88 + (0.12 * sin(
            (angle * 4.0)
            + (parameters.time * 3.1)
            + (shellWave * 0.7)
        ));
        var baseAlpha = ((ringCore * 0.82) + (outerGlow * 0.18) + (innerGlow * 0.05)) * shimmer;
        baseAlpha *= localActivity * activityNoise;
        baseAlpha += approachActivity * outerGlow * 0.08;
        fieldAlpha *= max(approachActivity, impactActivity * 0.55);
        let color = (fieldColor * fieldAlpha) + (ringColor * baseAlpha) + impactColor;
        let alpha = saturate(fieldAlpha + baseAlpha + (impactAlpha * 0.85)) * parameters.alpha;
        let premultipliedColor = min(color * parameters.alpha, vec3<f32>(alpha));
        return vec4<f32>(premultipliedColor, alpha);
    }
`;

/**
 * 타이틀 magnetic shield를 caller 소유 transparent target에 기록하는 WebGPU pass입니다.
 * device-generation 리소스를 재사용하며 presentation surface의 획득과 제출은 소유하지 않습니다.
 */
export class TitleWebGpuShieldPass {
    constructor() {
        this.device = null;
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.pipelines = new Map();
        this.uniformBuffers = [];
        this.bindGroupCaches = new Map();
        this.uniformBytes = new ArrayBuffer(UNIFORM_BYTE_SIZE);
        this.uniformFloats = new Float32Array(this.uniformBytes);
        this.uniformUints = new Uint32Array(this.uniformBytes);
        this.activeFrameId = null;
        this.frameUniformCount = 0;
        this.encodeCount = 0;
        this.skipCount = 0;
        this.gpuInteractionCopyCount = 0;
        this.cleanupFailureCount = 0;
        this.destroyed = false;
    }

    /**
     * caller가 제공한 encoder와 target view에 실드 pass 하나를 기록합니다.
     * origin은 target의 좌상단 screen-space 좌표이며 command의 중심을 target-local 좌표로 변환합니다.
     * @param {object} context - composer frame context입니다.
     * @param {object} input - target과 magnetic shield presentation 명령입니다.
     * @param {object} input.command - `TitleShieldEffect.getPresentationCommand()` 결과입니다.
     * @param {GPUTextureView} input.targetView - caller 소유 effect target view입니다.
     * @param {number} input.targetWidth - effect target 너비입니다.
     * @param {number} input.targetHeight - effect target 높이입니다.
     * @param {number} [input.originX=0] - target 좌상단의 screen-space X입니다.
     * @param {number} [input.originY=0] - target 좌상단의 screen-space Y입니다.
     * @param {'clear'|'load'} [input.loadOp='clear'] - target 기존 내용 처리 방식입니다.
     * @param {GPUTextureFormat} [input.format=context.format] - effect target format입니다.
     * @returns {boolean} 실제 draw pass를 기록했으면 true입니다.
     */
    encode(context, input = {}) {
        this.#assertUsableContext(context);

        const command = input.command;
        const gpuInteractionBuffer = normalizeGpuInteractionBuffer(input.gpuInteractionBuffer);
        if (!hasRenderableShieldActivity(command, gpuInteractionBuffer)) {
            this.skipCount += 1;
            return false;
        }
        this.#ensureDeviceGeneration(context.device, context.deviceGeneration);
        this.#assertFreshFrameId(context.frameId);

        const targetView = requireTargetView(input.targetView);
        const targetWidth = normalizeTargetExtent(input.targetWidth, 'targetWidth');
        const targetHeight = normalizeTargetExtent(input.targetHeight, 'targetHeight');
        const originX = Number.isFinite(input.originX) ? input.originX : 0;
        const originY = Number.isFinite(input.originY) ? input.originY : 0;
        const loadOp = normalizeLoadOp(input.loadOp);
        const format = resolveTargetFormat(input.format, context.format);
        const centerX = Number.isFinite(command.x) ? command.x : 0;
        const centerY = Number.isFinite(command.y) ? command.y : 0;
        const ringThickness = Number.isFinite(command.ringThickness)
            ? Math.max(1, command.ringThickness)
            : 6;
        const glowWidth = Number.isFinite(command.glowWidth)
            ? Math.max(1, command.glowWidth)
            : 24;
        const fieldRadius = Number.isFinite(command.fieldRadius)
            ? Math.max(command.radius, command.fieldRadius)
            : command.radius;
        const boundsRadius = Math.max(
            fieldRadius,
            command.radius + (glowWidth * 3) + (ringThickness * 8) + 16
        );
        const roi = buildTargetLocalRoi(
            centerX,
            centerY,
            boundsRadius,
            originX,
            originY,
            targetWidth,
            targetHeight
        );
        if (!roi) {
            this.skipCount += 1;
            return false;
        }

        const pipelineState = this.#getPipeline(format);
        const uniformBuffer = this.#acquireUniformBuffer(context.frameId);
        this.#writeUniforms({
            command,
            targetWidth,
            targetHeight,
            centerX: centerX - originX,
            centerY: centerY - originY,
            fieldRadius,
            ringThickness,
            glowWidth
        });
        context.device.queue.writeBuffer(uniformBuffer, 0, this.uniformBytes);
        if (gpuInteractionBuffer) {
            this.#copyGpuInteractions(context.encoder, gpuInteractionBuffer, uniformBuffer);
        }
        const bindGroup = this.#getBindGroup(pipelineState, uniformBuffer);
        const renderPass = context.encoder.beginRenderPass({
            label: `title-magnetic-shield-pass:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: TRANSPARENT_CLEAR_VALUE,
                loadOp,
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(pipelineState.pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.setViewport(roi.x, roi.y, roi.width, roi.height, 0, 1);
        renderPass.setScissorRect(roi.x, roi.y, roi.width, roi.height);
        renderPass.draw(3, 1, 0, 0);
        renderPass.end();
        this.encodeCount += 1;
        return true;
    }

    /**
     * 현재 generation의 GPU buffer 참조를 정리합니다.
     * @returns {boolean} 최초 destroy이면 true입니다.
     */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#releaseGenerationResources();
        this.device = null;
        this.deviceGeneration = null;
        this.activeFrameId = null;
        this.frameUniformCount = 0;
        this.destroyed = true;
        return true;
    }

    /**
     * rollout 및 단위 테스트용 immutable resource snapshot을 반환합니다.
     * @returns {Readonly<object>} pass 상태입니다.
     */
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
            cleanupFailureCount: this.cleanupFailureCount
        });
    }

    #assertUsableContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU shield pass는 사용할 수 없습니다.');
        }
        requireDevice(context?.device);
        if (!Number.isSafeInteger(context?.deviceGeneration) || context.deviceGeneration < 0) {
            throw new RangeError('title WebGPU shield deviceGeneration은 0 이상의 정수여야 합니다.');
        }
        if (!Number.isSafeInteger(context?.frameId) || context.frameId < 0) {
            throw new RangeError('title WebGPU shield frameId는 0 이상의 정수여야 합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title WebGPU shield에는 caller 소유 command encoder가 필요합니다.');
        }
    }

    #ensureDeviceGeneration(device, deviceGeneration) {
        if (this.deviceGeneration !== null && deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title WebGPU shield device generation입니다.');
        }
        if (this.deviceGeneration === null || deviceGeneration > this.deviceGeneration) {
            if (this.deviceGeneration !== null) {
                this.#releaseGenerationResources();
            }
            this.device = device;
            this.deviceGeneration = deviceGeneration;
            this.activeFrameId = null;
            this.frameUniformCount = 0;
            return;
        }
        if (device !== this.device) {
            throw new Error('generation 변경 없는 title WebGPU shield device drift입니다.');
        }
    }

    #assertFreshFrameId(frameId) {
        if (this.activeFrameId !== null && frameId < this.activeFrameId) {
            throw new Error('stale title WebGPU shield frame입니다.');
        }
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
        this.bindGroupCaches.clear();
        this.shaderModule = null;
    }

    #getPipeline(format) {
        const cached = this.pipelines.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-magnetic-shield-shader',
                code: TITLE_WEBGPU_SHIELD_SHADER
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-magnetic-shield-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'magnetic_shield_fragment',
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
        const pipelineState = Object.freeze({
            pipeline,
            bindGroupLayout: pipeline.getBindGroupLayout(0)
        });
        this.pipelines.set(format, pipelineState);
        this.bindGroupCaches.set(pipeline, new WeakMap());
        return pipelineState;
    }

    #acquireUniformBuffer(frameId) {
        if (this.activeFrameId !== frameId) {
            this.activeFrameId = frameId;
            this.frameUniformCount = 0;
        }
        const bufferIndex = this.frameUniformCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-magnetic-shield-uniform:${bufferIndex}`,
                size: UNIFORM_BYTE_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
        }
        return buffer;
    }

    #getBindGroup(pipelineState, uniformBuffer) {
        const cache = this.bindGroupCaches.get(pipelineState.pipeline);
        let bindGroup = cache.get(uniformBuffer);
        if (bindGroup) {
            return bindGroup;
        }
        bindGroup = this.device.createBindGroup({
            label: 'title-magnetic-shield-bind-group',
            layout: pipelineState.bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                    offset: 0,
                    size: UNIFORM_BYTE_SIZE
                }
            }]
        });
        cache.set(uniformBuffer, bindGroup);
        return bindGroup;
    }

    #writeUniforms({
        command,
        targetWidth,
        targetHeight,
        centerX,
        centerY,
        fieldRadius,
        ringThickness,
        glowWidth
    }) {
        const floats = this.uniformFloats;
        floats.fill(0);
        floats[0] = targetWidth;
        floats[1] = targetHeight;
        floats[2] = centerX;
        floats[3] = centerY;
        floats[4] = command.radius;
        floats[5] = fieldRadius;
        floats[6] = Number.isFinite(command.time) ? command.time : 0;
        floats[7] = clamp01(Number.isFinite(command.alpha) ? command.alpha : 1);
        floats[8] = ringThickness;
        floats[9] = glowWidth;

        writeColor(floats, 12, command.shadowColor, DEFAULT_SHADOW_COLOR);
        writeColor(floats, 16, command.lowColor, DEFAULT_LOW_COLOR);
        writeColor(floats, 20, command.highColor, DEFAULT_HIGH_COLOR);
        writeColor(floats, 24, command.highlightColor, DEFAULT_HIGHLIGHT_COLOR);
        this.uniformUints[10] = writeImpacts(floats, command.impacts);
        this.uniformUints[11] = writeDents(floats, command.dents);
    }

    #copyGpuInteractions(encoder, sourceBuffer, uniformBuffer) {
        if (typeof encoder?.copyBufferToBuffer !== 'function') {
            throw new TypeError('GPU title shield interaction에는 encoder.copyBufferToBuffer()가 필요합니다.');
        }
        encoder.copyBufferToBuffer(
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.HEADER_BYTE_OFFSET,
            uniformBuffer,
            COUNT_UNIFORM_BYTE_OFFSET,
            COUNT_UNIFORM_BYTE_SIZE
        );
        encoder.copyBufferToBuffer(
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.IMPACT_BYTE_OFFSET,
            uniformBuffer,
            IMPACT_UNIFORM_BYTE_OFFSET,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.IMPACT_BYTE_SIZE
        );
        encoder.copyBufferToBuffer(
            sourceBuffer,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.DENT_BYTE_OFFSET,
            uniformBuffer,
            DENT_UNIFORM_BYTE_OFFSET,
            TITLE_WEBGPU_SHIELD_INTERACTION_ABI.DENT_BYTE_SIZE
        );
        this.gpuInteractionCopyCount += 1;
    }
}

function requireDevice(device) {
    for (const methodName of [
        'createShaderModule',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer'
    ]) {
        if (typeof device?.[methodName] !== 'function') {
            throw new TypeError(`title WebGPU shield device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title WebGPU shield device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireTargetView(targetView) {
    if (!targetView || (typeof targetView !== 'object' && typeof targetView !== 'function')) {
        throw new TypeError('title WebGPU shield targetView가 필요합니다.');
    }
    return targetView;
}

function normalizeTargetExtent(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`title WebGPU shield ${name}는 양수여야 합니다.`);
    }
    return Math.max(1, Math.floor(value));
}

function normalizeLoadOp(value) {
    if (value === undefined) {
        return 'clear';
    }
    if (value !== 'clear' && value !== 'load') {
        throw new TypeError('title WebGPU shield loadOp은 clear 또는 load여야 합니다.');
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
    throw new TypeError('title WebGPU shield target format이 필요합니다.');
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

function writeImpacts(target, impacts) {
    const source = Array.isArray(impacts) ? impacts : [];
    let writeCount = 0;
    for (let index = 0;
        index < source.length && writeCount < TITLE_SHIELD_PRESENTATION_MAX_IMPACTS;
        index++) {
        const impact = source[index];
        if (!impact) {
            continue;
        }
        const offset = IMPACT_FLOAT_OFFSET + (writeCount * 4);
        target[offset] = Number.isFinite(impact.angle) ? impact.angle : 0;
        target[offset + 1] = Number.isFinite(impact.intensity) ? impact.intensity : 0;
        target[offset + 2] = Number.isFinite(impact.width) ? impact.width : 0.12;
        target[offset + 3] = Number.isFinite(impact.progress) ? impact.progress : 0;
        writeCount += 1;
    }
    return writeCount;
}

function writeDents(target, dents) {
    const source = Array.isArray(dents) ? dents : [];
    let writeCount = 0;
    for (let index = 0;
        index < source.length && writeCount < TITLE_SHIELD_PRESENTATION_MAX_DENTS;
        index++) {
        const dent = source[index];
        if (!dent) {
            continue;
        }
        const offset = DENT_FLOAT_OFFSET + (writeCount * 4);
        target[offset] = Number.isFinite(dent.angle) ? dent.angle : 0;
        target[offset + 1] = Number.isFinite(dent.depth) ? dent.depth : 0;
        target[offset + 2] = Number.isFinite(dent.width) ? dent.width : 0.18;
        target[offset + 3] = Number.isFinite(dent.strength) ? dent.strength : 0;
        writeCount += 1;
    }
    return writeCount;
}

function hasRenderableShieldActivity(command, gpuInteractionBuffer = null) {
    if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
        return false;
    }
    if (gpuInteractionBuffer) {
        return true;
    }
    return hasPresentEntry(command.impacts) || hasPresentEntry(command.dents);
}

function normalizeGpuInteractionBuffer(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'object' && typeof value !== 'function') {
        throw new TypeError('title WebGPU shield gpuInteractionBuffer identity가 필요합니다.');
    }
    return value;
}

function hasPresentEntry(value) {
    if (!Array.isArray(value)) {
        return false;
    }
    for (let index = 0; index < value.length; index++) {
        if (value[index]) {
            return true;
        }
    }
    return false;
}
