const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const TITLE_GRADIENT_COLOR_COUNT = 5;
const TITLE_GRADIENT_TIME_WRAP_SECONDS = 4096;
const TITLE_GRADIENT_UNIFORM_FLOAT_COUNT = 24;
const TITLE_GRADIENT_UNIFORM_BYTE_SIZE = TITLE_GRADIENT_UNIFORM_FLOAT_COUNT
    * Float32Array.BYTES_PER_ELEMENT;
const TAU = Math.PI * 2;
const OPAQUE_BLACK_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

const POINT_MOTION_PROFILES = Object.freeze([
    Object.freeze({
        primaryPeriodSeconds: 53,
        primaryPhase: 0.31,
        primaryAmplitudeUv: 0.009,
        primaryRotation: 0.17,
        secondaryPeriodSeconds: 83,
        secondaryPhase: 2.11,
        secondaryAmplitudeUv: 0.005,
        secondaryRotation: 1.03
    }),
    Object.freeze({
        primaryPeriodSeconds: 61,
        primaryPhase: 1.17,
        primaryAmplitudeUv: 0.009,
        primaryRotation: 0.61,
        secondaryPeriodSeconds: 89,
        secondaryPhase: 2.73,
        secondaryAmplitudeUv: 0.005,
        secondaryRotation: 1.47
    }),
    Object.freeze({
        primaryPeriodSeconds: 47,
        primaryPhase: 2.29,
        primaryAmplitudeUv: 0.009,
        primaryRotation: 1.21,
        secondaryPeriodSeconds: 73,
        secondaryPhase: 0.67,
        secondaryAmplitudeUv: 0.005,
        secondaryRotation: 2.03
    }),
    Object.freeze({
        primaryPeriodSeconds: 67,
        primaryPhase: 1.83,
        primaryAmplitudeUv: 0.009,
        primaryRotation: 2.41,
        secondaryPeriodSeconds: 79,
        secondaryPhase: 0.43,
        secondaryAmplitudeUv: 0.005,
        secondaryRotation: 0.79
    }),
    Object.freeze({
        primaryPeriodSeconds: 59,
        primaryPhase: 0.91,
        primaryAmplitudeUv: 0.009,
        primaryRotation: 1.73,
        secondaryPeriodSeconds: 71,
        secondaryPhase: 2.47,
        secondaryAmplitudeUv: 0.005,
        secondaryRotation: 2.83
    })
]);

const LUMINANCE_MOTION = Object.freeze({
    periodSeconds: 71,
    phase: 0.79,
    maximumDelta: 0.02
});

const SATURATION_MOTION = Object.freeze({
    periodSeconds: 89,
    phase: 2.17,
    maximumDelta: 0.015
});

/** 타이틀 WebGPU gradient의 시각/수명주기 계약 상수입니다. */
export const TITLE_WEBGPU_GRADIENT_CONSTANTS = Object.freeze({
    COLOR_COUNT: TITLE_GRADIENT_COLOR_COUNT,
    TIME_WRAP_SECONDS: TITLE_GRADIENT_TIME_WRAP_SECONDS,
    MIN_MOTION_PERIOD_SECONDS: 45,
    MAX_MOTION_PERIOD_SECONDS: 90,
    MAX_POINT_DISPLACEMENT_UV: 0.015,
    MAX_LUMINANCE_DELTA: LUMINANCE_MOTION.maximumDelta,
    MAX_SATURATION_DELTA: SATURATION_MOTION.maximumDelta,
    UNIFORM_BYTE_SIZE: TITLE_GRADIENT_UNIFORM_BYTE_SIZE,
    POINT_MOTION_PERIODS_SECONDS: Object.freeze(POINT_MOTION_PROFILES.flatMap((profile) => [
        profile.primaryPeriodSeconds,
        profile.secondaryPeriodSeconds
    ])),
    LUMINANCE_PERIOD_SECONDS: LUMINANCE_MOTION.periodSeconds,
    SATURATION_PERIOD_SECONDS: SATURATION_MOTION.periodSeconds
});

const MOTION_PROFILE_WGSL = POINT_MOTION_PROFILES.map((profile, index) => `
        if (index == ${index}u) {
            return PointMotionProfile(
                vec4<f32>(
                    ${profile.primaryPeriodSeconds}.0,
                    ${profile.primaryPhase},
                    ${profile.primaryAmplitudeUv},
                    ${profile.primaryRotation}
                ),
                vec4<f32>(
                    ${profile.secondaryPeriodSeconds}.0,
                    ${profile.secondaryPhase},
                    ${profile.secondaryAmplitudeUv},
                    ${profile.secondaryRotation}
                )
            );
        }`).join('');

/**
 * legacy t=0 gradient 식과 bounded low-frequency motion을 합친 fullscreen WGSL입니다.
 */
export const TITLE_WEBGPU_GRADIENT_SHADER = `
    const COLOR_COUNT: u32 = ${TITLE_GRADIENT_COLOR_COUNT}u;
    const TAU: f32 = 6.283185307179586;

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) @interpolate(flat) point0: vec2<f32>,
        @location(2) @interpolate(flat) point1: vec2<f32>,
        @location(3) @interpolate(flat) point2: vec2<f32>,
        @location(4) @interpolate(flat) point3: vec2<f32>,
        @location(5) @interpolate(flat) point4: vec2<f32>,
        @location(6) @interpolate(flat) modulation: vec2<f32>,
        @location(7) @interpolate(flat) linearColor0: vec3<f32>,
        @location(8) @interpolate(flat) linearColor1: vec3<f32>,
        @location(9) @interpolate(flat) linearColor2: vec3<f32>,
        @location(10) @interpolate(flat) linearColor3: vec3<f32>,
        @location(11) @interpolate(flat) linearColor4: vec3<f32>,
    };

    struct GradientParameters {
        resolution: vec2<f32>,
        wrappedTime: f32,
        padding: f32,
        colors: array<vec4<f32>, ${TITLE_GRADIENT_COLOR_COUNT}>,
    };

    struct PointMotionProfile {
        primary: vec4<f32>,
        secondary: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> parameters: GradientParameters;

    @vertex
    fn title_gradient_vertex(
        @builtin(vertex_index) vertexIndex: u32
    ) -> FullscreenVertexOutput {
        let positions = array<vec2<f32>, 3>(
            vec2<f32>(-1.0, -1.0),
            vec2<f32>(3.0, -1.0),
            vec2<f32>(-1.0, 3.0)
        );
        let position = positions[vertexIndex];
        var output: FullscreenVertexOutput;
        output.position = vec4<f32>(position, 0.0, 1.0);
        output.uv = (position * 0.5) + vec2<f32>(0.5);
        output.point0 = legacy_point_at_zero(0u)
            + point_motion_delta(0u, parameters.wrappedTime);
        output.point1 = legacy_point_at_zero(1u)
            + point_motion_delta(1u, parameters.wrappedTime);
        output.point2 = legacy_point_at_zero(2u)
            + point_motion_delta(2u, parameters.wrappedTime);
        output.point3 = legacy_point_at_zero(3u)
            + point_motion_delta(3u, parameters.wrappedTime);
        output.point4 = legacy_point_at_zero(4u)
            + point_motion_delta(4u, parameters.wrappedTime);
        output.modulation = vec2<f32>(
            scalar_motion_delta(
                parameters.wrappedTime,
                ${LUMINANCE_MOTION.periodSeconds}.0,
                ${LUMINANCE_MOTION.phase},
                ${LUMINANCE_MOTION.maximumDelta}
            ),
            scalar_motion_delta(
                parameters.wrappedTime,
                ${SATURATION_MOTION.periodSeconds}.0,
                ${SATURATION_MOTION.phase},
                ${SATURATION_MOTION.maximumDelta}
            )
        );
        output.linearColor0 = to_linear(parameters.colors[0].xyz);
        output.linearColor1 = to_linear(parameters.colors[1].xyz);
        output.linearColor2 = to_linear(parameters.colors[2].xyz);
        output.linearColor3 = to_linear(parameters.colors[3].xyz);
        output.linearColor4 = to_linear(parameters.colors[4].xyz);
        return output;
    }

    fn to_linear(color: vec3<f32>) -> vec3<f32> {
        return pow(color, vec3<f32>(2.2));
    }

    fn to_gamma(color: vec3<f32>) -> vec3<f32> {
        return pow(color, vec3<f32>(1.0 / 2.2));
    }

    fn interleaved_gradient_noise(pixel: vec2<f32>) -> f32 {
        return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715))));
    }

    fn legacy_point_at_zero(index: u32) -> vec2<f32> {
        if (index == 0u) {
            return vec2<f32>(
                0.16 + (sin(0.2) * 0.10) + (cos(1.1) * 0.03),
                0.18 + (cos(0.8) * 0.08) + (sin(2.2) * 0.03)
            );
        }
        if (index == 1u) {
            return vec2<f32>(
                0.78 + (cos(1.7) * 0.09) + (sin(0.5) * 0.04),
                0.20 + (sin(1.1) * 0.07) + (cos(2.7) * 0.03)
            );
        }
        if (index == 2u) {
            return vec2<f32>(
                0.24 + (cos(2.4) * 0.11) + (sin(0.6) * 0.03),
                0.76 + (sin(0.4) * 0.09) + (cos(1.9) * 0.03)
            );
        }
        if (index == 3u) {
            return vec2<f32>(
                0.84 + (sin(1.3) * 0.10) + (cos(2.6) * 0.03),
                0.72 + (cos(2.0) * 0.08) + (sin(0.7) * 0.03)
            );
        }
        return vec2<f32>(
            0.50 + (sin(0.9) * 0.08) + (cos(2.4) * 0.03),
            0.48 + (cos(1.6) * 0.08) + (sin(0.1) * 0.03)
        );
    }

    fn get_motion_profile(index: u32) -> PointMotionProfile {${MOTION_PROFILE_WGSL}
        return PointMotionProfile(
            vec4<f32>(53.0, 0.0, 0.0, 0.0),
            vec4<f32>(83.0, 0.0, 0.0, 0.0)
        );
    }

    fn orbit_position(angle: f32, rotation: f32) -> vec2<f32> {
        let rotatedAngle = angle + rotation;
        return vec2<f32>(cos(rotatedAngle), sin(rotatedAngle));
    }

    fn orbit_delta(time: f32, profile: vec4<f32>) -> vec2<f32> {
        let angle = profile.y + (TAU * time / profile.x);
        return (
            orbit_position(angle, profile.w)
            - orbit_position(profile.y, profile.w)
        ) * (profile.z * 0.5);
    }

    fn point_motion_delta(index: u32, time: f32) -> vec2<f32> {
        if (time == 0.0) {
            return vec2<f32>(0.0);
        }
        let profile = get_motion_profile(index);
        return orbit_delta(time, profile.primary) + orbit_delta(time, profile.secondary);
    }

    fn scalar_motion_delta(time: f32, period: f32, phase: f32, maximum: f32) -> f32 {
        if (time == 0.0) {
            return 0.0;
        }
        return maximum * 0.5 * (
            sin(phase + (TAU * time / period)) - sin(phase)
        );
    }

    fn gradient_point(input: FullscreenVertexOutput, index: u32) -> vec2<f32> {
        if (index == 0u) {
            return input.point0;
        }
        if (index == 1u) {
            return input.point1;
        }
        if (index == 2u) {
            return input.point2;
        }
        if (index == 3u) {
            return input.point3;
        }
        return input.point4;
    }

    fn gradient_linear_color(input: FullscreenVertexOutput, index: u32) -> vec3<f32> {
        if (index == 0u) {
            return input.linearColor0;
        }
        if (index == 1u) {
            return input.linearColor1;
        }
        if (index == 2u) {
            return input.linearColor2;
        }
        if (index == 3u) {
            return input.linearColor3;
        }
        return input.linearColor4;
    }

    @fragment
    fn title_gradient_fragment(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let aspect = parameters.resolution.x / max(1.0, parameters.resolution.y);
        var color = vec3<f32>(0.0);
        var totalWeight = 0.0;

        for (var index = 0u; index < COLOR_COUNT; index = index + 1u) {
            let point = gradient_point(input, index);
            var delta = input.uv - point;
            delta.x *= aspect;

            let distanceSquared = dot(delta, delta);
            let weight = 1.0 / (0.08 + (distanceSquared * (5.4 + (f32(index) * 0.65))));
            color += gradient_linear_color(input, index) * weight;
            totalWeight += weight;
        }

        color /= max(totalWeight, 0.0001);

        let centered = vec2<f32>((input.uv.x - 0.5) * aspect, input.uv.y - 0.5);
        let vignette = 1.0 - smoothstep(0.15, 1.05, length(centered));
        color *= mix(0.9, 1.06, vignette);

        let luminance = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
        color = mix(vec3<f32>(luminance), color, 1.0 + input.modulation.y);
        color *= 1.0 + input.modulation.x;

        color = to_gamma(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)));
        let legacyPixel = vec2<f32>(
            input.position.x,
            parameters.resolution.y - input.position.y
        );
        color += vec3<f32>(
            (interleaved_gradient_noise(legacyPixel) - 0.5) * (0.6 / 255.0)
        );
        return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
    }
`;

/**
 * presentation seconds를 gradient uniform 범위로 정규화합니다.
 * @param {number} presentationSeconds - caller 소유 presentation clock입니다.
 * @returns {number} `[0, 4096)` wrapped seconds입니다.
 */
export function wrapTitleWebGpuGradientTime(presentationSeconds) {
    if (!Number.isFinite(presentationSeconds)) {
        return 0;
    }
    const remainder = Number(presentationSeconds) % TITLE_GRADIENT_TIME_WRAP_SECONDS;
    if (remainder === 0) {
        return 0;
    }
    return remainder < 0
        ? remainder + TITLE_GRADIENT_TIME_WRAP_SECONDS
        : remainder;
}

/**
 * shader와 같은 motion 식을 CPU에서 평가해 parity/bounds 검증에 제공합니다.
 * production render는 이 결과를 업로드하지 않고 GPU가 wrapped time으로 직접 계산합니다.
 * @param {number} presentationSeconds - caller 소유 presentation clock입니다.
 * @returns {Readonly<object>} wrapped time과 bounded modulation입니다.
 */
export function evaluateTitleWebGpuGradientMotion(presentationSeconds) {
    const wrappedSeconds = wrapTitleWebGpuGradientTime(presentationSeconds);
    const pointDeltas = POINT_MOTION_PROFILES.map((profile) => {
        if (wrappedSeconds === 0) {
            return Object.freeze({ x: 0, y: 0 });
        }
        const primary = evaluateOrbitDelta(
            wrappedSeconds,
            profile.primaryPeriodSeconds,
            profile.primaryPhase,
            profile.primaryAmplitudeUv,
            profile.primaryRotation
        );
        const secondary = evaluateOrbitDelta(
            wrappedSeconds,
            profile.secondaryPeriodSeconds,
            profile.secondaryPhase,
            profile.secondaryAmplitudeUv,
            profile.secondaryRotation
        );
        return Object.freeze({
            x: primary.x + secondary.x,
            y: primary.y + secondary.y
        });
    });

    return Object.freeze({
        wrappedSeconds,
        pointDeltas: Object.freeze(pointDeltas),
        luminanceDelta: evaluateScalarMotion(wrappedSeconds, LUMINANCE_MOTION),
        saturationDelta: evaluateScalarMotion(wrappedSeconds, SATURATION_MOTION)
    });
}

/**
 * caller 소유 offscreen texture view에 gradient fullscreen pass 하나를 encode합니다.
 * presentation target 획득/encoder 완료/queue submit/surface signal은 상위 composer만 소유합니다.
 */
export class TitleWebGpuGradientPass {
    constructor() {
        this.device = null;
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.pipelineByFormat = new Map();
        this.uniformBuffers = [];
        this.uniformScratch = new Float32Array(TITLE_GRADIENT_UNIFORM_FLOAT_COUNT);
        this.outputMetadata = Object.seal({
            frameId: 0,
            deviceGeneration: 0,
            targetView: null,
            format: '',
            width: 0,
            height: 0,
            wrappedSeconds: 0,
            passCount: 1
        });
        this.currentFrameId = null;
        this.currentFrameEncodeCount = 0;
        this.destroyed = false;
        this.encodeCount = 0;
        this.generationChangeCount = 0;
        this.pipelineCreateCount = 0;
        this.uniformBufferCreateCount = 0;
        this.cleanupFailureCount = 0;
    }

    /**
     * 현재 composer encoder에 offscreen gradient render pass를 기록합니다.
     * @param {object} input - frame context와 caller-owned target 정보입니다.
     * @param {object} input.context - composer callback의 고정 frame context입니다.
     * @param {GPUTextureView} input.targetView - caller가 소유하는 render target view입니다.
     * @param {string} [input.format] - target texture format입니다.
     * @param {number} input.width - target 너비입니다.
     * @param {number} input.height - target 높이입니다.
     * @param {number} input.presentationSeconds - variable presentation clock입니다.
     * @param {ArrayLike<number>|Array<ArrayLike<number>>} input.colors - 정규화된 RGB 5색입니다.
     * @returns {Readonly<object>} encoded pass metadata입니다.
     */
    encode(input = {}) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU gradient pass는 사용할 수 없습니다.');
        }
        const context = requireFrameContext(input.context);
        const targetView = requireTargetView(input.targetView);
        const format = requireTextureFormat(input.format || context.format);
        const width = requireExtent(input.width, 'width');
        const height = requireExtent(input.height, 'height');
        const wrappedSeconds = wrapTitleWebGpuGradientTime(input.presentationSeconds);
        this.#stageUniforms(width, height, wrappedSeconds, input.colors);

        this.#bindGeneration(context);
        const pipelineRecord = this.#getPipeline(format);
        const uniformIndex = this.#nextUniformIndex(context.frameId);
        const uniformBuffer = this.#getUniformBuffer(uniformIndex);
        this.device.queue.writeBuffer(uniformBuffer, 0, this.uniformScratch);
        const bindGroup = this.#getBindGroup(pipelineRecord, uniformBuffer, uniformIndex);

        const renderPass = context.encoder.beginRenderPass({
            label: `title-webgpu-gradient-pass:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: OPAQUE_BLACK_CLEAR_VALUE,
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(pipelineRecord.pipeline);
        renderPass.setBindGroup(0, bindGroup);
        renderPass.draw(3, 1, 0, 0);
        renderPass.end();
        this.encodeCount += 1;

        const output = this.outputMetadata;
        output.frameId = context.frameId;
        output.deviceGeneration = context.deviceGeneration;
        output.targetView = targetView;
        output.format = format;
        output.width = width;
        output.height = height;
        output.wrappedSeconds = wrappedSeconds;
        return output;
    }

    /** generation resource와 uniform buffer를 idempotent하게 정리합니다. */
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
            pipelineFormatCount: this.pipelineByFormat.size,
            uniformBufferCount: this.uniformBuffers.length,
            currentFrameId: this.currentFrameId,
            currentFrameEncodeCount: this.currentFrameEncodeCount,
            encodeCount: this.encodeCount,
            generationChangeCount: this.generationChangeCount,
            pipelineCreateCount: this.pipelineCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount,
            cleanupFailureCount: this.cleanupFailureCount
        });
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
                throw new Error('title WebGPU gradient device identity가 generation 변경 없이 바뀌었습니다.');
            }
            return;
        }

        if (context.deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title WebGPU gradient device generation입니다.');
        }

        this.#releaseGenerationResources();
        this.device = context.device;
        this.deviceGeneration = context.deviceGeneration;
        this.generationChangeCount += 1;
    }

    #getPipeline(format) {
        const cached = this.pipelineByFormat.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-webgpu-gradient-shader',
                code: TITLE_WEBGPU_GRADIENT_SHADER
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-webgpu-gradient-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'title_gradient_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'title_gradient_fragment',
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const record = {
            pipeline,
            bindGroupLayout: pipeline.getBindGroupLayout(0),
            bindGroups: new Map()
        };
        this.pipelineByFormat.set(format, record);
        this.pipelineCreateCount += 1;
        return record;
    }

    #nextUniformIndex(frameId) {
        if (this.currentFrameId !== frameId) {
            this.currentFrameId = frameId;
            this.currentFrameEncodeCount = 0;
        }
        return this.currentFrameEncodeCount++;
    }

    #getUniformBuffer(index) {
        let buffer = this.uniformBuffers[index];
        if (buffer) {
            return buffer;
        }
        buffer = this.device.createBuffer({
            label: `title-webgpu-gradient-uniform:${index}`,
            size: TITLE_GRADIENT_UNIFORM_BYTE_SIZE,
            usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
        });
        this.uniformBuffers[index] = buffer;
        this.uniformBufferCreateCount += 1;
        return buffer;
    }

    #stageUniforms(width, height, wrappedSeconds, colors) {
        const scratch = this.uniformScratch;
        scratch.fill(0);
        scratch[0] = width;
        scratch[1] = height;
        scratch[2] = wrappedSeconds;
        writePalette(colors, scratch, 4);
    }

    #getBindGroup(pipelineRecord, uniformBuffer, uniformIndex) {
        const cached = pipelineRecord.bindGroups.get(uniformBuffer);
        if (cached) {
            return cached;
        }
        const bindGroup = this.device.createBindGroup({
            label: `title-webgpu-gradient-bind-group:${uniformIndex}`,
            layout: pipelineRecord.bindGroupLayout,
            entries: [{
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                    offset: 0,
                    size: TITLE_GRADIENT_UNIFORM_BYTE_SIZE
                }
            }]
        });
        pipelineRecord.bindGroups.set(uniformBuffer, bindGroup);
        return bindGroup;
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
        this.pipelineByFormat.clear();
        this.shaderModule = null;
        this.currentFrameId = null;
        this.currentFrameEncodeCount = 0;
    }
}

function evaluateOrbitDelta(time, period, phase, amplitude, rotation) {
    const baseAngle = phase + rotation;
    const angle = phase + ((TAU * time) / period) + rotation;
    return {
        x: (Math.cos(angle) - Math.cos(baseAngle)) * amplitude * 0.5,
        y: (Math.sin(angle) - Math.sin(baseAngle)) * amplitude * 0.5
    };
}

function evaluateScalarMotion(time, profile) {
    if (time === 0) {
        return 0;
    }
    return profile.maximumDelta * 0.5 * (
        Math.sin(profile.phase + ((TAU * time) / profile.periodSeconds))
        - Math.sin(profile.phase)
    );
}

function requireFrameContext(context) {
    if (!context || typeof context !== 'object') {
        throw new TypeError('title WebGPU gradient composer context가 필요합니다.');
    }
    if (!Number.isSafeInteger(context.frameId) || context.frameId < 0) {
        throw new RangeError('title WebGPU gradient frameId는 0 이상의 정수여야 합니다.');
    }
    if (!Number.isSafeInteger(context.deviceGeneration) || context.deviceGeneration < 0) {
        throw new RangeError('title WebGPU gradient deviceGeneration은 0 이상의 정수여야 합니다.');
    }
    for (const methodName of [
        'createShaderModule',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer'
    ]) {
        if (typeof context.device?.[methodName] !== 'function') {
            throw new TypeError(`title WebGPU gradient device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof context.device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title WebGPU gradient device.queue.writeBuffer()가 필요합니다.');
    }
    if (typeof context.encoder?.beginRenderPass !== 'function') {
        throw new TypeError('title WebGPU gradient composer encoder가 필요합니다.');
    }
    return context;
}

function requireTargetView(targetView) {
    if (!targetView || (typeof targetView !== 'object' && typeof targetView !== 'function')) {
        throw new TypeError('title WebGPU gradient caller-owned targetView가 필요합니다.');
    }
    return targetView;
}

function requireTextureFormat(format) {
    if (typeof format !== 'string' || !format) {
        throw new TypeError('title WebGPU gradient target format이 필요합니다.');
    }
    return format;
}

function requireExtent(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`title WebGPU gradient ${name}는 양의 정수여야 합니다.`);
    }
    return value;
}

function writePalette(colors, target, targetOffset) {
    const flat = ArrayBuffer.isView(colors)
        || (Array.isArray(colors) && typeof colors[0] === 'number');
    if (flat) {
        if (colors.length !== TITLE_GRADIENT_COLOR_COUNT * 3) {
            throw new RangeError('title WebGPU gradient flat colors는 RGB 15개여야 합니다.');
        }
        for (let index = 0; index < TITLE_GRADIENT_COLOR_COUNT; index++) {
            const sourceOffset = index * 3;
            const uniformOffset = targetOffset + (index * 4);
            target[uniformOffset] = requireNormalizedColor(colors[sourceOffset]);
            target[uniformOffset + 1] = requireNormalizedColor(colors[sourceOffset + 1]);
            target[uniformOffset + 2] = requireNormalizedColor(colors[sourceOffset + 2]);
        }
        return;
    }

    if (!Array.isArray(colors) || colors.length !== TITLE_GRADIENT_COLOR_COUNT) {
        throw new RangeError('title WebGPU gradient colors는 RGB 5색이어야 합니다.');
    }
    for (let index = 0; index < TITLE_GRADIENT_COLOR_COUNT; index++) {
        const color = colors[index];
        if (!color || color.length !== 3) {
            throw new RangeError(`title WebGPU gradient colors[${index}]는 RGB 3개여야 합니다.`);
        }
        const uniformOffset = targetOffset + (index * 4);
        target[uniformOffset] = requireNormalizedColor(color[0]);
        target[uniformOffset + 1] = requireNormalizedColor(color[1]);
        target[uniformOffset + 2] = requireNormalizedColor(color[2]);
    }
}

function requireNormalizedColor(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError('title WebGPU gradient color channel은 0..1 범위여야 합니다.');
    }
    return Number(value);
}
