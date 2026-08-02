import {
    createTitleWebGpuOverlayRectToQuadHomography,
    invertTitleWebGpuOverlayMatrix3,
    resolveTitleWebGpuOverlayGlassVisualHalo,
    resolveTitleWebGpuOverlayProjectedQuad,
    resolveTitleWebGpuOverlayProjectedScissor
} from './_title_webgpu_overlay_projection.js';

const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const COLOR_WRITE_ALL = 0x0F;
const UNIFORM_FLOAT_COUNT = 64;
const UNIFORM_BYTE_SIZE = UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const TARGET_BACKDROP_RESOLUTION_OFFSET = 0;
const BACKDROP_LOGICAL_BOUNDS_OFFSET = 4;
const PANEL_RECT_OFFSET = 8;
const INVERSE_HOMOGRAPHY_ROW_0_OFFSET = 12;
const INVERSE_HOMOGRAPHY_ROW_1_OFFSET = 16;
const INVERSE_HOMOGRAPHY_ROW_2_OFFSET = 20;
const GLASS_PARAMETERS_OFFSET = 24;
const STYLE_PARAMETERS_OFFSET = 28;
const SHADOW_PARAMETERS_OFFSET = 32;
const FILL_COLOR_OFFSET = 36;
const STROKE_COLOR_OFFSET = 40;
const TINT_COLOR_OFFSET = 44;
const EDGE_COLOR_OFFSET = 48;
const SHADOW_COLOR_OFFSET = 52;
const EFFECT_TEXTURE_PARAMETERS_OFFSET = 56;
const EFFECT_TEXTURE_RECT_OFFSET = 60;
const DEFAULT_AA_WIDTH = 1.0;
const DEFAULT_TINT_STRENGTH = 0.18;
const DEFAULT_EDGE_STRENGTH = 0.55;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const TRANSPARENT_WHITE = Object.freeze([1, 1, 1, 0]);
const OPAQUE_WHITE = Object.freeze([1, 1, 1, 1]);
const TRANSPARENT_BLACK = Object.freeze([0, 0, 0, 0]);

/** Title overlay glass pass의 vec4 정렬 uniform ABI입니다. */
export const TITLE_WEBGPU_OVERLAY_GLASS_PASS_CONSTANTS = Object.freeze({
    UNIFORM_FLOAT_COUNT,
    UNIFORM_BYTE_SIZE,
    TARGET_BACKDROP_RESOLUTION_OFFSET,
    BACKDROP_LOGICAL_BOUNDS_OFFSET,
    PANEL_RECT_OFFSET,
    INVERSE_HOMOGRAPHY_ROW_0_OFFSET,
    INVERSE_HOMOGRAPHY_ROW_1_OFFSET,
    INVERSE_HOMOGRAPHY_ROW_2_OFFSET,
    GLASS_PARAMETERS_OFFSET,
    STYLE_PARAMETERS_OFFSET,
    SHADOW_PARAMETERS_OFFSET,
    FILL_COLOR_OFFSET,
    STROKE_COLOR_OFFSET,
    TINT_COLOR_OFFSET,
    EDGE_COLOR_OFFSET,
    SHADOW_COLOR_OFFSET,
    EFFECT_TEXTURE_PARAMETERS_OFFSET,
    EFFECT_TEXTURE_RECT_OFFSET
});

/**
 * 기존 WebGL glassPanel의 fill/tint/edge/refraction/shadow 의미론을 한 번의
 * premultiplied WebGPU 합성으로 옮긴 WGSL입니다.
 */
export const TITLE_WEBGPU_OVERLAY_GLASS_SHADER = `
    struct GlassPanelParameters {
        targetBackdropResolution: vec4<f32>,
        backdropLogicalBounds: vec4<f32>,
        panelRect: vec4<f32>,
        inverseHomographyRow0: vec4<f32>,
        inverseHomographyRow1: vec4<f32>,
        inverseHomographyRow2: vec4<f32>,
        glassParameters: vec4<f32>,
        styleParameters: vec4<f32>,
        shadowParameters: vec4<f32>,
        fillColor: vec4<f32>,
        strokeColor: vec4<f32>,
        tintColor: vec4<f32>,
        edgeColor: vec4<f32>,
        shadowColor: vec4<f32>,
        effectTextureParameters: vec4<f32>,
        effectTextureRect: vec4<f32>,
    };

    struct FullscreenVertexOutput {
        @builtin(position) position: vec4<f32>,
    };

    @group(0) @binding(0) var<uniform> parameters: GlassPanelParameters;
    @group(0) @binding(1) var backdropSampler: sampler;
    @group(0) @binding(2) var backdropTexture: texture_2d<f32>;
    @group(0) @binding(3) var effectTexture: texture_2d<f32>;

    fn rounded_rect_sdf(position: vec2<f32>, size: vec2<f32>, radiusValue: f32) -> f32 {
        let safeSize = max(size, vec2<f32>(0.0001));
        let radius = clamp(radiusValue, 0.0, min(safeSize.x, safeSize.y) * 0.5);
        let centered = position - (safeSize * 0.5);
        let q = abs(centered) - ((safeSize * 0.5) - vec2<f32>(radius));
        return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - radius;
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
    fn glass_panel_fragment(input: FullscreenVertexOutput) -> @location(0) vec4<f32> {
        let targetResolution = max(parameters.targetBackdropResolution.xy, vec2<f32>(1.0));
        let backdropResolution = max(parameters.targetBackdropResolution.zw, vec2<f32>(1.0));
        let screenPosition = clamp(input.position.xy, vec2<f32>(0.0), targetResolution);
        let screenPoint = vec3<f32>(screenPosition, 1.0);
        let homographyDenominator = dot(parameters.inverseHomographyRow2.xyz, screenPoint);
        if (abs(homographyDenominator) <= 0.00001) {
            discard;
        }

        let panelLocal = vec2<f32>(
            dot(parameters.inverseHomographyRow0.xyz, screenPoint),
            dot(parameters.inverseHomographyRow1.xyz, screenPoint)
        ) / homographyDenominator;
        let panelSize = max(parameters.panelRect.zw, vec2<f32>(0.0001));
        let radius = parameters.glassParameters.x;
        let lineWidth = parameters.glassParameters.y;
        let opacity = parameters.glassParameters.z;
        let refractionStrength = parameters.glassParameters.w;
        let panelSdf = rounded_rect_sdf(panelLocal, panelSize, radius);
        let panelAa = max(parameters.styleParameters.w, fwidth(panelSdf));
        let panelMask = 1.0 - smoothstep(-panelAa, panelAa, panelSdf);

        let shadowRadius = parameters.shadowParameters.x;
        let shadowOffset = parameters.shadowParameters.yz;
        let shadowSdf = rounded_rect_sdf(panelLocal - shadowOffset, panelSize, radius);
        let shadowAa = max(parameters.styleParameters.w, fwidth(shadowSdf));
        let shadowMask = 1.0 - smoothstep(
            (-shadowRadius * 0.2) - shadowAa,
            max(1.0, shadowRadius) + shadowAa,
            shadowSdf
        );
        let panelOcclusion = 1.0 - smoothstep(-panelAa, panelAa, panelSdf);
        let shadowAlpha = shadowMask
            * (1.0 - panelOcclusion)
            * parameters.shadowColor.a
            * opacity
            * select(0.0, 1.0, shadowRadius > 0.0);
        let shadowPremultiplied = parameters.shadowColor.rgb * shadowAlpha;

        var glassAlpha = 0.0;
        var glassPremultiplied = vec3<f32>(0.0);
        if (panelMask > 0.0001) {
            var backdropColor = vec4<f32>(0.0);
            if (parameters.styleParameters.z > 0.5) {
                let centeredPanelUv = (panelLocal / panelSize) - vec2<f32>(0.5);
                let refractionOffset = centeredPanelUv * refractionStrength;
                let logicalPosition = screenPosition
                    - parameters.backdropLogicalBounds.xy
                    + refractionOffset;
                let roiUv = logicalPosition
                    / max(parameters.backdropLogicalBounds.zw, vec2<f32>(1.0));
                let halfBackdropTexel = vec2<f32>(0.5) / backdropResolution;
                let backdropUv = clamp(
                    roiUv,
                    halfBackdropTexel,
                    vec2<f32>(1.0) - halfBackdropTexel
                );
                backdropColor = textureSampleLevel(
                    backdropTexture,
                    backdropSampler,
                    backdropUv,
                    0.0
                );
            }

            var glassColor = backdropColor.rgb;
            let fillBlend = mix(
                min(parameters.fillColor.a, 0.24),
                1.0,
                select(0.0, 1.0, parameters.fillColor.a >= 0.999)
            );
            let tintBlend = clamp(
                parameters.styleParameters.x * parameters.tintColor.a,
                0.0,
                1.0
            );
            glassColor = mix(glassColor, parameters.fillColor.rgb, fillBlend);
            glassColor = mix(glassColor, parameters.tintColor.rgb, tintBlend);

            let insideDistance = max(0.0, -panelSdf);
            let edgeFactor = panelMask * (1.0 - smoothstep(
                0.0,
                max(1.0, lineWidth * 1.5),
                insideDistance
            ));
            let strokeFactor = panelMask * (1.0 - smoothstep(
                lineWidth,
                lineWidth + panelAa,
                insideDistance
            ));
            let centeredPanelUv = (panelLocal / panelSize) - vec2<f32>(0.5);
            let highlight = pow(1.0 - abs(centeredPanelUv.y), 3.0) * 0.35;
            let edgeLighting = parameters.edgeColor.rgb
                * edgeFactor
                * parameters.styleParameters.y;
            let topHighlight = parameters.edgeColor.rgb
                * highlight
                * parameters.styleParameters.y
                * 0.4;
            let fillLayer = vec4<f32>(
                glassColor + edgeLighting + topHighlight,
                max(backdropColor.a, parameters.fillColor.a)
            );
            let strokeLayer = parameters.strokeColor * strokeFactor;
            let finalLayer = mix(fillLayer, strokeLayer, strokeLayer.a);
            glassAlpha = max(fillLayer.a, strokeLayer.a) * panelMask * opacity;
            glassPremultiplied = finalLayer.rgb * glassAlpha;
        }

        let oneMinusGlassAlpha = 1.0 - glassAlpha;
        let baseAlpha = glassAlpha + (shadowAlpha * oneMinusGlassAlpha);
        let basePremultiplied = glassPremultiplied
            + (shadowPremultiplied * oneMinusGlassAlpha);

        var effectAlpha = 0.0;
        var effectPremultiplied = vec3<f32>(0.0);
        let effectLocal = panelLocal - parameters.effectTextureRect.xy;
        if (parameters.effectTextureParameters.z > 0.5
            && panelMask > 0.0001
            && effectLocal.x >= 0.0
            && effectLocal.y >= 0.0
            && effectLocal.x <= parameters.effectTextureRect.z
            && effectLocal.y <= parameters.effectTextureRect.w) {
            let effectResolution = max(
                parameters.effectTextureParameters.xy,
                vec2<f32>(1.0)
            );
            let rawEffectUv = effectLocal
                / max(parameters.effectTextureRect.zw, vec2<f32>(1.0));
            let effectUv = vec2<f32>(
                rawEffectUv.x,
                select(
                    rawEffectUv.y,
                    1.0 - rawEffectUv.y,
                    parameters.effectTextureParameters.w > 0.5
                )
            );
            let halfEffectTexel = vec2<f32>(0.5) / effectResolution;
            let clampedEffectUv = clamp(
                effectUv,
                halfEffectTexel,
                vec2<f32>(1.0) - halfEffectTexel
            );
            let effectColor = textureSampleLevel(
                effectTexture,
                backdropSampler,
                clampedEffectUv,
                0.0
            );
            let effectCoverage = panelMask * opacity;
            effectAlpha = effectColor.a * effectCoverage;
            effectPremultiplied = effectColor.rgb * effectCoverage;
        }

        let oneMinusEffectAlpha = 1.0 - effectAlpha;
        let outputAlpha = effectAlpha + (baseAlpha * oneMinusEffectAlpha);
        if (outputAlpha <= 0.0001) {
            discard;
        }
        let outputPremultiplied = effectPremultiplied
            + (basePremultiplied * oneMinusEffectAlpha);
        return vec4<f32>(outputPremultiplied, outputAlpha);
    }
`;

/**
 * caller 소유 target/backdrop/encoder에 glass panel 합성 명령만 기록합니다.
 * presentation texture 획득과 command buffer 제출은 상위 composer가 소유합니다.
 */
export class TitleWebGpuOverlayGlassPass {
    constructor({ device, format } = {}) {
        requireDevice(device);
        this.device = device;
        this.format = requireFormat(format);
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.sampler = null;
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.bindGroupsByBuffer = new WeakMap();
        this.uniformBuffers = [];
        this.uniformBytes = new ArrayBuffer(UNIFORM_BYTE_SIZE);
        this.uniformFloats = new Float32Array(this.uniformBytes);
        this.quadScratch = new Float64Array(8);
        this.homographyScratch = new Float64Array(9);
        this.inverseHomographyScratch = new Float64Array(9);
        this.shadowColorScratch = new Float32Array(4);
        this.colorScratch = new Float32Array(4);
        this.effectTextureRectScratch = { x: 0, y: 0, w: 0, h: 0 };
        this.colorStringCache = new Map();
        this.activeFrameId = null;
        this.frameUniformCount = 0;
        this.encodeCount = 0;
        this.batchEncodeCount = 0;
        this.renderPassCount = 0;
        this.clearBatchCount = 0;
        this.loadBatchCount = 0;
        this.skipCount = 0;
        this.driftFailureCount = 0;
        this.pipelineCreateCount = 0;
        this.shaderModuleCreateCount = 0;
        this.samplerCreateCount = 0;
        this.uniformBufferCreateCount = 0;
        this.bindGroupCreateCount = 0;
        this.cleanupFailureCount = 0;
        this.lastHalo = 0;
        this.lastScissor = null;
        this.lastBatchDrawCount = 0;
        this.lastBatchLoadOp = null;
        this.invalidated = false;
        this.invalidationReason = null;
        this.destroyed = false;

        try {
            this.#warmResources();
        } catch (error) {
            this.#releaseResources();
            throw error;
        }
    }

    /**
     * glass panel을 caller 소유 target에 기록합니다.
     * @param {object} context - device/deviceGeneration/frameId/encoder를 가진 frame context입니다.
     * @param {object} input - caller 소유 texture view와 패널 파라미터입니다.
     * @param {GPUTextureView} [input.effectTextureView] - 선택적 premultiplied panel effect view입니다.
     * @param {number} [input.effectTextureWidth] - effect texture 실제 너비입니다.
     * @param {number} [input.effectTextureHeight] - effect texture 실제 높이입니다.
     * @param {{x?:number,y?:number,w?:number,h?:number}} [input.effectTextureRect] - 절대 화면 좌표 표시 영역입니다.
     * @returns {boolean} 실제 render pass를 기록했으면 true입니다.
     */
    encode(context, input = {}) {
        const drawCount = this.encodeBatch(context, {
            targetView: input.targetView,
            targetWidth: input.targetWidth,
            targetHeight: input.targetHeight,
            clear: input.clear,
            entries: [Object.freeze({
                backdropView: input.backdropView,
                backdropWidth: input.backdropWidth,
                backdropHeight: input.backdropHeight,
                backdropLogicalBounds: input.backdropLogicalBounds,
                effectTextureView: input.effectTextureView,
                effectTextureWidth: input.effectTextureWidth,
                effectTextureHeight: input.effectTextureHeight,
                effectTextureFlipY: input.effectTextureFlipY,
                effectTextureRect: input.effectTextureRect,
                panel: input.panel,
                opacity: input.opacity
            })]
        });
        return drawCount > 0;
    }

    /**
     * 같은 target에 그리는 glass panel들을 하나의 load/store render pass로 기록합니다.
     * backdrop/effect view, uniform, scissor는 entry별로 독립적이며 입력 순서가 곧
     * premultiplied source-over draw 순서입니다.
     * @returns {number} 실제 기록한 panel draw 수입니다.
     */
    encodeBatch(context, {
        targetView,
        targetWidth,
        targetHeight,
        clear = false,
        entries = []
    } = {}) {
        this.#assertUsableContext(context);
        if (typeof clear !== 'boolean') {
            throw new TypeError('title WebGPU glass clear는 boolean이어야 합니다.');
        }
        if (!Array.isArray(entries)) {
            throw new TypeError('title WebGPU glass batch entries 배열이 필요합니다.');
        }

        const candidates = [];
        for (const entry of entries) {
            const panel = entry?.panel;
            if (!panel || !Number.isFinite(panel.w) || !Number.isFinite(panel.h)
                || panel.w <= 0 || panel.h <= 0) {
                this.skipCount += 1;
                continue;
            }
            const panelOpacity = clamp01(Number.isFinite(panel.alpha) ? panel.alpha : 1);
            const passOpacity = clamp01(Number.isFinite(entry?.opacity) ? entry.opacity : 1);
            const finalOpacity = panelOpacity * passOpacity;
            if (finalOpacity <= 0) {
                this.skipCount += 1;
                continue;
            }
            candidates.push({ entry, panel, finalOpacity });
        }
        if (candidates.length === 0) {
            this.lastBatchDrawCount = 0;
            this.lastBatchLoadOp = null;
            return 0;
        }

        const resolvedTargetView = requireTextureView(targetView, 'targetView');
        const resolvedTargetWidth = normalizeTextureExtent(targetWidth, 'targetWidth');
        const resolvedTargetHeight = normalizeTextureExtent(targetHeight, 'targetHeight');
        const commands = [];
        for (const candidate of candidates) {
            const { entry, panel, finalOpacity } = candidate;
            const resolvedBackdropView = requireTextureView(
                entry.backdropView,
                'backdropView'
            );
            if (resolvedTargetView === resolvedBackdropView) {
                throw new Error('title WebGPU glass target과 backdrop view는 분리되어야 합니다.');
            }
            const resolvedBackdropWidth = normalizeTextureExtent(
                entry.backdropWidth,
                'backdropWidth'
            );
            const resolvedBackdropHeight = normalizeTextureExtent(
                entry.backdropHeight,
                'backdropHeight'
            );
            const hasEffectTexture = entry.effectTextureView !== undefined
                && entry.effectTextureView !== null;
            const resolvedEffectTextureView = hasEffectTexture
                ? requireTextureView(entry.effectTextureView, 'effectTextureView')
                : resolvedBackdropView;
            if (resolvedEffectTextureView === resolvedTargetView) {
                throw new Error('title WebGPU glass target과 effect texture view는 분리되어야 합니다.');
            }
            const resolvedEffectTextureWidth = hasEffectTexture
                ? normalizeTextureExtent(entry.effectTextureWidth, 'effectTextureWidth')
                : resolvedBackdropWidth;
            const resolvedEffectTextureHeight = hasEffectTexture
                ? normalizeTextureExtent(entry.effectTextureHeight, 'effectTextureHeight')
                : resolvedBackdropHeight;
            const logicalBounds = normalizeLogicalBounds(entry.backdropLogicalBounds);
            const panelX = Number.isFinite(panel.x) ? panel.x : 0;
            const panelY = Number.isFinite(panel.y) ? panel.y : 0;
            const panelWidth = panel.w;
            const panelHeight = panel.h;
            const resolvedEffectTextureRect = resolveEffectTextureRect(
                panelX,
                panelY,
                panelWidth,
                panelHeight,
                entry.effectTextureRect,
                this.effectTextureRectScratch
            );

            if (!resolveTitleWebGpuOverlayProjectedQuad(
                panel,
                panelX,
                panelY,
                panelWidth,
                panelHeight,
                this.quadScratch
            ) || !createTitleWebGpuOverlayRectToQuadHomography(
                panelWidth,
                panelHeight,
                this.quadScratch,
                this.homographyScratch
            ) || !invertTitleWebGpuOverlayMatrix3(
                this.homographyScratch,
                this.inverseHomographyScratch
            )) {
                this.skipCount += 1;
                continue;
            }

            this.#resolveColor(panel.shadowColor, TRANSPARENT_BLACK, this.shadowColorScratch);
            const radius = clampFinite(
                panel.radius,
                0,
                Math.min(panelWidth, panelHeight) * 0.5,
                0
            );
            const lineWidth = Math.max(0, finiteOr(panel.lineWidth, 1));
            const refractionStrength = finiteOr(panel.refractionStrength, 0);
            const shadowRadius = Math.max(0, finiteOr(panel.shadowRadius, 0));
            const shadowOffsetX = finiteOr(panel.shadowOffsetX, 0);
            const shadowOffsetY = finiteOr(panel.shadowOffsetY, 0);
            const hasShadow = shadowRadius > 0 && this.shadowColorScratch[3] > 0;
            const halo = resolveTitleWebGpuOverlayGlassVisualHalo(panel, {
                shadowVisible: hasShadow,
                aaWidth: DEFAULT_AA_WIDTH
            });
            const scissor = resolveTitleWebGpuOverlayProjectedScissor(
                this.homographyScratch,
                panelWidth,
                panelHeight,
                halo,
                resolvedTargetWidth,
                resolvedTargetHeight
            );
            if (!scissor) {
                this.skipCount += 1;
                continue;
            }

            const uniformIndex = this.#nextUniformIndex(context.frameId);
            const uniformBuffer = this.#getUniformBuffer(uniformIndex);
            this.#stageUniforms({
                panel,
                panelX,
                panelY,
                panelWidth,
                panelHeight,
                radius,
                lineWidth,
                finalOpacity,
                refractionStrength,
                shadowRadius,
                shadowOffsetX,
                shadowOffsetY,
                halo,
                targetWidth: resolvedTargetWidth,
                targetHeight: resolvedTargetHeight,
                backdropWidth: resolvedBackdropWidth,
                backdropHeight: resolvedBackdropHeight,
                logicalBounds,
                effectTextureWidth: resolvedEffectTextureWidth,
                effectTextureHeight: resolvedEffectTextureHeight,
                effectTextureEnabled: hasEffectTexture,
                effectTextureFlipY: entry.effectTextureFlipY === true,
                effectTextureRect: resolvedEffectTextureRect
            });
            this.device.queue.writeBuffer(uniformBuffer, 0, this.uniformBytes);
            commands.push({
                bindGroup: this.#getBindGroup(
                    uniformBuffer,
                    resolvedBackdropView,
                    resolvedEffectTextureView,
                    uniformIndex
                ),
                scissor,
                halo
            });
        }
        if (commands.length === 0) {
            this.lastBatchDrawCount = 0;
            this.lastBatchLoadOp = null;
            return 0;
        }

        const loadOp = clear ? 'clear' : 'load';
        const renderPass = context.encoder.beginRenderPass({
            label: `title-overlay-glass-pass:${context.frameId}`,
            colorAttachments: [{
                view: resolvedTargetView,
                clearValue: TRANSPARENT_CLEAR_VALUE,
                loadOp,
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(this.pipeline);
        renderPass.setViewport(0, 0, resolvedTargetWidth, resolvedTargetHeight, 0, 1);
        for (const command of commands) {
            renderPass.setBindGroup(0, command.bindGroup);
            renderPass.setScissorRect(
                command.scissor.x,
                command.scissor.y,
                command.scissor.width,
                command.scissor.height
            );
            renderPass.draw(3, 1, 0, 0);
        }
        renderPass.end();

        const lastCommand = commands[commands.length - 1];
        this.lastHalo = lastCommand.halo;
        this.lastScissor = lastCommand.scissor;
        this.lastBatchDrawCount = commands.length;
        this.lastBatchLoadOp = loadOp;
        this.encodeCount += commands.length;
        this.batchEncodeCount += 1;
        this.renderPassCount += 1;
        if (clear) this.clearBatchCount += 1;
        else this.loadBatchCount += 1;
        return commands.length;
    }

    /** GPU buffer를 포함한 pass 소유 리소스를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#releaseResources();
        this.device = null;
        this.destroyed = true;
        return true;
    }

    /** 테스트와 rollout 진단용 immutable snapshot입니다. */
    getDiagnostics() {
        const lastScissor = this.lastScissor
            ? Object.freeze({ ...this.lastScissor })
            : null;
        return Object.freeze({
            destroyed: this.destroyed,
            invalidated: this.invalidated,
            invalidationReason: this.invalidationReason,
            format: this.format,
            deviceGeneration: this.deviceGeneration,
            warmCacheReady: Boolean(
                this.shaderModule
                && this.sampler
                && this.pipeline
                && this.uniformBuffers[0]
            ),
            uniformBufferCount: this.uniformBuffers.length,
            activeFrameId: this.activeFrameId,
            frameUniformCount: this.frameUniformCount,
            encodeCount: this.encodeCount,
            batchEncodeCount: this.batchEncodeCount,
            renderPassCount: this.renderPassCount,
            clearBatchCount: this.clearBatchCount,
            loadBatchCount: this.loadBatchCount,
            skipCount: this.skipCount,
            driftFailureCount: this.driftFailureCount,
            pipelineCreateCount: this.pipelineCreateCount,
            shaderModuleCreateCount: this.shaderModuleCreateCount,
            samplerCreateCount: this.samplerCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount,
            bindGroupCreateCount: this.bindGroupCreateCount,
            cleanupFailureCount: this.cleanupFailureCount,
            colorCacheSize: this.colorStringCache.size,
            lastHalo: this.lastHalo,
            lastScissor,
            lastBatchDrawCount: this.lastBatchDrawCount,
            lastBatchLoadOp: this.lastBatchLoadOp
        });
    }

    #warmResources() {
        this.shaderModule = this.device.createShaderModule({
            label: 'title-overlay-glass-shader',
            code: TITLE_WEBGPU_OVERLAY_GLASS_SHADER
        });
        this.shaderModuleCreateCount += 1;
        this.sampler = this.device.createSampler({
            label: 'title-overlay-glass-backdrop-sampler',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'nearest'
        });
        this.samplerCreateCount += 1;
        this.pipeline = this.device.createRenderPipeline({
            label: `title-overlay-glass-pipeline:${this.format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'fullscreen_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'glass_panel_fragment',
                targets: [{
                    format: this.format,
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
        if (typeof this.pipeline?.getBindGroupLayout !== 'function') {
            throw new TypeError('title WebGPU glass pipeline bind group layout을 얻을 수 없습니다.');
        }
        this.bindGroupLayout = this.pipeline.getBindGroupLayout(0);
        this.pipelineCreateCount += 1;
        this.#getUniformBuffer(0);
    }

    #assertUsableContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU glass pass는 사용할 수 없습니다.');
        }
        if (this.invalidated) {
            throw new Error(`무효화된 title WebGPU glass pass입니다: ${this.invalidationReason}`);
        }
        if (!context || context.device !== this.device) {
            this.#failForDrift('device identity drift');
        }
        if (context.format !== undefined && context.format !== this.format) {
            this.#failForDrift('target format drift');
        }
        if (!Number.isSafeInteger(context.deviceGeneration) || context.deviceGeneration < 0) {
            throw new RangeError('title WebGPU glass deviceGeneration은 0 이상의 정수여야 합니다.');
        }
        if (this.deviceGeneration === null) {
            this.deviceGeneration = context.deviceGeneration;
        } else if (context.deviceGeneration !== this.deviceGeneration) {
            const direction = context.deviceGeneration < this.deviceGeneration ? 'stale' : 'advanced';
            this.#failForDrift(`${direction} device generation`);
        }
        if (!Number.isSafeInteger(context.frameId) || context.frameId < 0) {
            throw new RangeError('title WebGPU glass frameId는 0 이상의 정수여야 합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title WebGPU glass에는 caller 소유 command encoder가 필요합니다.');
        }
    }

    #failForDrift(reason) {
        this.invalidated = true;
        this.invalidationReason = reason;
        this.driftFailureCount += 1;
        this.#releaseResources();
        throw new Error(`title WebGPU glass ${reason}; 새 pass가 필요합니다.`);
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
            label: `title-overlay-glass-uniform:${index}`,
            size: UNIFORM_BYTE_SIZE,
            usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
        });
        this.uniformBuffers[index] = buffer;
        this.uniformBufferCreateCount += 1;
        return buffer;
    }

    #getBindGroup(uniformBuffer, backdropView, effectTextureView, uniformIndex) {
        let bindGroupsByBackdrop = this.bindGroupsByBuffer.get(uniformBuffer);
        if (!bindGroupsByBackdrop) {
            bindGroupsByBackdrop = new WeakMap();
            this.bindGroupsByBuffer.set(uniformBuffer, bindGroupsByBackdrop);
        }
        let bindGroupsByEffect = bindGroupsByBackdrop.get(backdropView);
        if (!bindGroupsByEffect) {
            bindGroupsByEffect = new WeakMap();
            bindGroupsByBackdrop.set(backdropView, bindGroupsByEffect);
        }
        const cached = bindGroupsByEffect.get(effectTextureView);
        if (cached) {
            return cached;
        }
        const bindGroup = this.device.createBindGroup({
            label: `title-overlay-glass-bind-group:${uniformIndex}`,
            layout: this.bindGroupLayout,
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
                { binding: 2, resource: backdropView },
                { binding: 3, resource: effectTextureView }
            ]
        });
        bindGroupsByEffect.set(effectTextureView, bindGroup);
        this.bindGroupCreateCount += 1;
        return bindGroup;
    }

    #stageUniforms({
        panel,
        panelX,
        panelY,
        panelWidth,
        panelHeight,
        radius,
        lineWidth,
        finalOpacity,
        refractionStrength,
        shadowRadius,
        shadowOffsetX,
        shadowOffsetY,
        halo,
        targetWidth,
        targetHeight,
        backdropWidth,
        backdropHeight,
        logicalBounds,
        effectTextureWidth,
        effectTextureHeight,
        effectTextureEnabled,
        effectTextureFlipY,
        effectTextureRect
    }) {
        const floats = this.uniformFloats;
        const inverse = this.inverseHomographyScratch;
        floats.fill(0);
        floats[TARGET_BACKDROP_RESOLUTION_OFFSET] = targetWidth;
        floats[TARGET_BACKDROP_RESOLUTION_OFFSET + 1] = targetHeight;
        floats[TARGET_BACKDROP_RESOLUTION_OFFSET + 2] = backdropWidth;
        floats[TARGET_BACKDROP_RESOLUTION_OFFSET + 3] = backdropHeight;
        floats[BACKDROP_LOGICAL_BOUNDS_OFFSET] = logicalBounds.x;
        floats[BACKDROP_LOGICAL_BOUNDS_OFFSET + 1] = logicalBounds.y;
        floats[BACKDROP_LOGICAL_BOUNDS_OFFSET + 2] = logicalBounds.w;
        floats[BACKDROP_LOGICAL_BOUNDS_OFFSET + 3] = logicalBounds.h;
        floats[PANEL_RECT_OFFSET] = panelX;
        floats[PANEL_RECT_OFFSET + 1] = panelY;
        floats[PANEL_RECT_OFFSET + 2] = panelWidth;
        floats[PANEL_RECT_OFFSET + 3] = panelHeight;
        floats[INVERSE_HOMOGRAPHY_ROW_0_OFFSET] = inverse[0];
        floats[INVERSE_HOMOGRAPHY_ROW_0_OFFSET + 1] = inverse[1];
        floats[INVERSE_HOMOGRAPHY_ROW_0_OFFSET + 2] = inverse[2];
        floats[INVERSE_HOMOGRAPHY_ROW_1_OFFSET] = inverse[3];
        floats[INVERSE_HOMOGRAPHY_ROW_1_OFFSET + 1] = inverse[4];
        floats[INVERSE_HOMOGRAPHY_ROW_1_OFFSET + 2] = inverse[5];
        floats[INVERSE_HOMOGRAPHY_ROW_2_OFFSET] = inverse[6];
        floats[INVERSE_HOMOGRAPHY_ROW_2_OFFSET + 1] = inverse[7];
        floats[INVERSE_HOMOGRAPHY_ROW_2_OFFSET + 2] = inverse[8];
        floats[GLASS_PARAMETERS_OFFSET] = radius;
        floats[GLASS_PARAMETERS_OFFSET + 1] = lineWidth;
        floats[GLASS_PARAMETERS_OFFSET + 2] = finalOpacity;
        floats[GLASS_PARAMETERS_OFFSET + 3] = refractionStrength;
        floats[STYLE_PARAMETERS_OFFSET] = Math.max(0, finiteOr(panel.tintStrength, DEFAULT_TINT_STRENGTH));
        floats[STYLE_PARAMETERS_OFFSET + 1] = Math.max(0, finiteOr(panel.edgeStrength, DEFAULT_EDGE_STRENGTH));
        floats[STYLE_PARAMETERS_OFFSET + 2] = panel.sampleBackdrop === false ? 0 : 1;
        floats[STYLE_PARAMETERS_OFFSET + 3] = DEFAULT_AA_WIDTH;
        floats[SHADOW_PARAMETERS_OFFSET] = shadowRadius;
        floats[SHADOW_PARAMETERS_OFFSET + 1] = shadowOffsetX;
        floats[SHADOW_PARAMETERS_OFFSET + 2] = shadowOffsetY;
        floats[SHADOW_PARAMETERS_OFFSET + 3] = halo;
        this.#writeColor(FILL_COLOR_OFFSET, panel.fill ?? panel.fillColor, TRANSPARENT_WHITE);
        this.#writeColor(STROKE_COLOR_OFFSET, panel.stroke ?? panel.strokeColor, TRANSPARENT_WHITE);
        this.#writeColor(TINT_COLOR_OFFSET, panel.tintColor, OPAQUE_WHITE);
        this.#writeColor(EDGE_COLOR_OFFSET, panel.edgeColor, OPAQUE_WHITE);
        for (let index = 0; index < 4; index++) {
            floats[SHADOW_COLOR_OFFSET + index] = this.shadowColorScratch[index];
        }
        floats[EFFECT_TEXTURE_PARAMETERS_OFFSET] = effectTextureWidth;
        floats[EFFECT_TEXTURE_PARAMETERS_OFFSET + 1] = effectTextureHeight;
        floats[EFFECT_TEXTURE_PARAMETERS_OFFSET + 2] = effectTextureEnabled ? 1 : 0;
        floats[EFFECT_TEXTURE_PARAMETERS_OFFSET + 3] = effectTextureFlipY ? 1 : 0;
        floats[EFFECT_TEXTURE_RECT_OFFSET] = effectTextureRect.x;
        floats[EFFECT_TEXTURE_RECT_OFFSET + 1] = effectTextureRect.y;
        floats[EFFECT_TEXTURE_RECT_OFFSET + 2] = effectTextureRect.w;
        floats[EFFECT_TEXTURE_RECT_OFFSET + 3] = effectTextureRect.h;
    }

    #writeColor(offset, source, fallback) {
        const normalized = this.colorScratch;
        this.#resolveColor(source, fallback, normalized);
        for (let index = 0; index < 4; index++) {
            this.uniformFloats[offset + index] = normalized[index];
        }
    }

    #resolveColor(source, fallback, target) {
        const value = source === undefined || source === null || source === false
            ? fallback
            : source;
        if ((Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === 4) {
            for (let index = 0; index < 4; index++) {
                target[index] = Number.isFinite(value[index]) ? value[index] : fallback[index];
            }
            return;
        }
        if (typeof value === 'string') {
            let cached = this.colorStringCache.get(value);
            if (!cached) {
                cached = parseCssColor(value);
                this.colorStringCache.set(value, cached);
                if (this.colorStringCache.size > 256) {
                    this.colorStringCache.clear();
                    this.colorStringCache.set(value, cached);
                }
            }
            target.set(cached);
            return;
        }
        target.set(fallback);
    }

    #releaseResources() {
        for (const buffer of this.uniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                this.cleanupFailureCount += 1;
            }
        }
        this.uniformBuffers.length = 0;
        this.bindGroupsByBuffer = new WeakMap();
        this.pipeline = null;
        this.bindGroupLayout = null;
        this.shaderModule = null;
        this.sampler = null;
        this.activeFrameId = null;
        this.frameUniformCount = 0;
        this.lastScissor = null;
        this.lastHalo = 0;
        this.lastBatchDrawCount = 0;
        this.lastBatchLoadOp = null;
        this.colorStringCache.clear();
    }
}

function requireDevice(device) {
    for (const methodName of [
        'createShaderModule',
        'createSampler',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer'
    ]) {
        if (typeof device?.[methodName] !== 'function') {
            throw new TypeError(`title WebGPU glass device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title WebGPU glass device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireFormat(format) {
    if (typeof format !== 'string' || !format) {
        throw new TypeError('title WebGPU glass target format이 필요합니다.');
    }
    return format;
}

function requireTextureView(view, name) {
    if (!view || (typeof view !== 'object' && typeof view !== 'function')) {
        throw new TypeError(`title WebGPU glass ${name}가 필요합니다.`);
    }
    return view;
}

function normalizeTextureExtent(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`title WebGPU glass ${name}는 양수여야 합니다.`);
    }
    return Math.max(1, Math.floor(value));
}

function normalizeLogicalBounds(bounds) {
    if (!bounds || typeof bounds !== 'object') {
        throw new TypeError('title WebGPU glass backdropLogicalBounds가 필요합니다.');
    }
    const x = Number.isFinite(bounds.x) ? bounds.x : 0;
    const y = Number.isFinite(bounds.y) ? bounds.y : 0;
    const w = bounds.w ?? bounds.width;
    const h = bounds.h ?? bounds.height;
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
        throw new RangeError('title WebGPU glass backdropLogicalBounds 크기는 양수여야 합니다.');
    }
    return { x, y, w, h };
}

function resolveEffectTextureRect(
    panelX,
    panelY,
    panelWidth,
    panelHeight,
    effectTextureRect,
    target
) {
    const textureWidth = Number(effectTextureRect?.w);
    const textureHeight = Number(effectTextureRect?.h);
    if (!Number.isFinite(textureWidth) || textureWidth <= 0
        || !Number.isFinite(textureHeight) || textureHeight <= 0) {
        target.x = 0;
        target.y = 0;
        target.w = Math.max(1, panelWidth);
        target.h = Math.max(1, panelHeight);
        return target;
    }
    target.x = (Number(effectTextureRect?.x) || 0) - panelX;
    target.y = (Number(effectTextureRect?.y) || 0) - panelY;
    target.w = textureWidth;
    target.h = textureHeight;
    return target;
}

function parseCssColor(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'transparent') {
        return new Float32Array([0, 0, 0, 0]);
    }
    if (normalized === 'white') {
        return new Float32Array([1, 1, 1, 1]);
    }
    if (normalized === 'black') {
        return new Float32Array([0, 0, 0, 1]);
    }
    if (normalized[0] === '#') {
        const hex = normalized.slice(1);
        if (hex.length === 3 || hex.length === 4) {
            const red = parseInt(hex[0] + hex[0], 16);
            const green = parseInt(hex[1] + hex[1], 16);
            const blue = parseInt(hex[2] + hex[2], 16);
            const alpha = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
            if ([red, green, blue, alpha].every(Number.isFinite)) {
                return new Float32Array([red / 255, green / 255, blue / 255, alpha]);
            }
        }
        if (hex.length === 6 || hex.length === 8) {
            const red = parseInt(hex.slice(0, 2), 16);
            const green = parseInt(hex.slice(2, 4), 16);
            const blue = parseInt(hex.slice(4, 6), 16);
            const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            if ([red, green, blue, alpha].every(Number.isFinite)) {
                return new Float32Array([red / 255, green / 255, blue / 255, alpha]);
            }
        }
    }
    const components = normalized.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g);
    if ((normalized.startsWith('rgb(') || normalized.startsWith('rgba('))
        && components?.length >= 3) {
        const red = Number(components[0]);
        const green = Number(components[1]);
        const blue = Number(components[2]);
        const alpha = components.length >= 4 ? Number(components[3]) : 1;
        if ([red, green, blue, alpha].every(Number.isFinite)) {
            return new Float32Array([red / 255, green / 255, blue / 255, alpha]);
        }
    }
    return new Float32Array([0, 0, 0, 1]);
}

function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function clampFinite(value, minimum, maximum, fallback) {
    return Math.max(minimum, Math.min(maximum, finiteOr(value, fallback)));
}

function clamp01(value) {
    return Math.max(0, Math.min(1, value));
}
