const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const UNIFORM_SLOT_SIZE = 256;
const UNIFORM_FLOATS_PER_SLOT = UNIFORM_SLOT_SIZE / Float32Array.BYTES_PER_ELEMENT;
const UNIFORM_BINDING_SIZE = 80;
const DEFAULT_MAX_NODES = 64;
const DEFAULT_VIGNETTE_EDGE_RATIO = 0.18;
const DEFAULT_VIGNETTE_CORNER_RATIO = 0.2;
const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const SUPPORTED_FORMATS = Object.freeze(['rgba8unorm', 'bgra8unorm']);
const NODE_KINDS = Object.freeze(['texture', 'dim', 'vignette']);

/** texture, solid dim, deterministic vignette를 premultiplied 순서로 합성하는 shader입니다. */
export const TITLE_WEBGPU_LAYER_STACK_SHADER = `
    struct LayerParameters {
        targetSize: vec2<f32>,
        screenOrigin: vec2<f32>,
        screenSize: vec2<f32>,
        sourceLogicalOrigin: vec2<f32>,
        sourceLogicalSize: vec2<f32>,
        contentOrigin: vec2<f32>,
        color: vec4<f32>,
        // x: opacity, y: content scale, z: vignette edge width, w: corner radius.
        values: vec4<f32>,
    };

    struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) sourceLogicalPosition: vec2<f32>,
        @location(1) screenPosition: vec2<f32>,
    };

    @group(0) @binding(0) var layerSampler: sampler;
    @group(0) @binding(1) var layerTexture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> parameters: LayerParameters;

    @vertex
    fn layer_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        let corners = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(1.0, 1.0)
        );
        let corner = corners[vertexIndex];
        let contentScale = parameters.values.y;
        let scaleOrigin = parameters.contentOrigin * parameters.targetSize;
        let scaledOrigin = scaleOrigin
            + (parameters.screenOrigin - scaleOrigin) * contentScale;
        let pixel = scaledOrigin + corner * parameters.screenSize * contentScale;
        let ndc = vec2<f32>(
            (pixel.x / parameters.targetSize.x) * 2.0 - 1.0,
            1.0 - (pixel.y / parameters.targetSize.y) * 2.0
        );
        var output: VertexOutput;
        output.position = vec4<f32>(ndc, 0.0, 1.0);
        output.sourceLogicalPosition = parameters.screenOrigin
            + corner * parameters.screenSize;
        output.screenPosition = pixel;
        return output;
    }

    @fragment
    fn texture_fragment(input: VertexOutput) -> @location(0) vec4<f32> {
        let sourceUv = clamp(
            (input.sourceLogicalPosition - parameters.sourceLogicalOrigin)
                / parameters.sourceLogicalSize,
            vec2<f32>(0.0),
            vec2<f32>(1.0)
        );
        return textureSampleLevel(layerTexture, layerSampler, sourceUv, 0.0)
            * parameters.values.x;
    }

    @fragment
    fn dim_fragment(_input: VertexOutput) -> @location(0) vec4<f32> {
        let alpha = parameters.color.a * parameters.values.x;
        return vec4<f32>(parameters.color.rgb * alpha, alpha);
    }

    @fragment
    fn vignette_fragment(input: VertexOutput) -> @location(0) vec4<f32> {
        let logicalTargetSize = max(
            parameters.sourceLogicalSize,
            vec2<f32>(1.0)
        );
        let logicalScreenPosition = input.screenPosition
            + parameters.sourceLogicalOrigin;
        let halfSize = logicalTargetSize * 0.5;
        let radius = clamp(
            parameters.values.w,
            0.0,
            min(halfSize.x, halfSize.y)
        );
        let rounded = abs(logicalScreenPosition - halfSize)
            - (halfSize - vec2<f32>(radius));
        let signedDistance = length(max(rounded, vec2<f32>(0.0)))
            + min(max(rounded.x, rounded.y), 0.0)
            - radius;
        let inwardDistance = max(0.0, -signedDistance);
        let edge = 1.0 - smoothstep(
            0.0,
            max(parameters.values.z, 0.0001),
            inwardDistance
        );
        let alpha = parameters.color.a * parameters.values.x * edge;
        return vec4<f32>(parameters.color.rgb * alpha, alpha);
    }
`;

/** caller-owned target/pass에 title/overlay layer stack을 기록합니다. */
export class TitleWebGpuLayerStackPass {
    /** @param {{device:object,format:string,maxNodes?:number}} options */
    constructor(options = {}) {
        this.device = requireDevice(options.device);
        this.format = requireFormat(options.format);
        this.maxNodes = requirePositiveInteger(
            options.maxNodes ?? DEFAULT_MAX_NODES,
            'maxNodes'
        );
        this.deviceGeneration = null;
        this.currentFrameId = null;
        this.frameEncodeCount = 0;
        this.destroyed = false;
        this.shaderModule = null;
        this.sampler = null;
        this.pipelineSets = new Map();
        this.uniformBuffers = [];
        this.uniformScratch = new Float32Array(
            this.maxNodes * UNIFORM_FLOATS_PER_SLOT
        );
        this.normalizedNodes = Array.from(
            { length: this.maxNodes },
            () => createNormalizedNode()
        );
        this.textureBindGroupCache = new WeakMap();
        this.analyticBindGroupCache = new WeakMap();
        this.encodeCount = 0;
        this.offscreenEncodeCount = 0;
        this.renderPassEncodeCount = 0;
        this.drawCount = 0;
        this.pipelineCreateCount = 0;
        this.bindGroupCreateCount = 0;
        this.uniformBufferCreateCount = 0;
    }

    /** targetView에 정확히 한 render pass를 열어 node 순서대로 합성합니다. */
    encodeOffscreen(context, input = {}) {
        this.#acceptContext(context);
        if (!context?.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title layer stack offscreen encode에는 composer encoder가 필요합니다.');
        }
        const targetView = requireIdentity(input.targetView, 'targetView');
        const width = requirePositiveInteger(input.width, 'width');
        const height = requirePositiveInteger(input.height, 'height');
        const nodeCount = this.#normalizeNodes(input.nodes, width, height);
        const uniformBuffer = nodeCount > 0
            ? this.#prepareUniformBuffer(context, width, height, nodeCount)
            : null;
        const clear = normalizeClear(input.clear);
        const renderPass = context.encoder.beginRenderPass({
            label: input.label || `title-layer-stack:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: clear.value,
                loadOp: clear.enabled ? 'clear' : 'load',
                storeOp: 'store'
            }]
        });
        const drawCount = this.#encodeNormalizedNodes(
            renderPass,
            uniformBuffer,
            nodeCount
        );
        renderPass.end();
        this.encodeCount += 1;
        this.offscreenEncodeCount += 1;
        return drawCount;
    }

    /** caller-owned render pass를 끝내지 않고 node 순서대로 합성합니다. */
    encodeRenderPass(renderPass, context, input = {}) {
        this.#acceptContext(context);
        requireRenderPass(renderPass);
        const width = requirePositiveInteger(input.width, 'width');
        const height = requirePositiveInteger(input.height, 'height');
        const nodeCount = this.#normalizeNodes(input.nodes, width, height);
        const uniformBuffer = nodeCount > 0
            ? this.#prepareUniformBuffer(context, width, height, nodeCount)
            : null;
        const drawCount = this.#encodeNormalizedNodes(
            renderPass,
            uniformBuffer,
            nodeCount
        );
        this.encodeCount += 1;
        this.renderPassEncodeCount += 1;
        return drawCount;
    }

    /** fixed device가 소유한 generation resource를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        for (const buffer of this.uniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                // teardown은 best-effort입니다.
            }
        }
        this.uniformBuffers.length = 0;
        this.pipelineSets.clear();
        this.shaderModule = null;
        this.sampler = null;
        this.textureBindGroupCache = new WeakMap();
        this.analyticBindGroupCache = new WeakMap();
        this.currentFrameId = null;
        this.frameEncodeCount = 0;
        this.destroyed = true;
        return true;
    }

    /** allocation, stable-order encode 진단 snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            format: this.format,
            deviceGeneration: this.deviceGeneration,
            maxNodes: this.maxNodes,
            pipelineCount: this.pipelineSets.size,
            uniformBufferCount: this.uniformBuffers.length,
            encodeCount: this.encodeCount,
            offscreenEncodeCount: this.offscreenEncodeCount,
            renderPassEncodeCount: this.renderPassEncodeCount,
            drawCount: this.drawCount,
            pipelineCreateCount: this.pipelineCreateCount,
            bindGroupCreateCount: this.bindGroupCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount
        });
    }

    #acceptContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU layer stack pass는 사용할 수 없습니다.');
        }
        if (context?.device !== this.device) {
            throw new Error('title layer stack device drift가 감지되었습니다.');
        }
        const generation = requireNonNegativeInteger(
            context?.deviceGeneration,
            'deviceGeneration'
        );
        const frameId = requireNonNegativeInteger(context?.frameId, 'frameId');
        if (context?.format !== undefined && requireFormat(context.format) !== this.format) {
            throw new Error('title layer stack format drift가 감지되었습니다.');
        }
        if (this.deviceGeneration === null) {
            this.deviceGeneration = generation;
        } else if (generation !== this.deviceGeneration) {
            throw new Error('title layer stack device generation drift가 감지되었습니다.');
        }
        if (this.currentFrameId !== null && frameId < this.currentFrameId) {
            throw new Error('stale title layer stack frame입니다.');
        }
        if (frameId !== this.currentFrameId) {
            this.currentFrameId = frameId;
            this.frameEncodeCount = 0;
        }
    }

    #normalizeNodes(value, width, height) {
        if (!Array.isArray(value)) {
            throw new TypeError('title layer stack nodes 배열이 필요합니다.');
        }
        if (value.length > this.maxNodes) {
            throw new RangeError(`title layer stack node 상한을 초과했습니다: ${this.maxNodes}`);
        }
        for (let index = 0; index < value.length; index++) {
            const input = value[index];
            const node = this.normalizedNodes[index];
            node.kind = requireNodeKind(input?.kind, index);
            node.view = null;
            node.screenX = 0;
            node.screenY = 0;
            node.screenWidth = width;
            node.screenHeight = height;
            node.sourceX = 0;
            node.sourceY = 0;
            node.sourceWidth = width;
            node.sourceHeight = height;
            node.opacity = clamp01(input?.opacity ?? 1, `nodes[${index}].opacity`);
            node.contentScale = 1;
            node.contentOriginX = 0.5;
            node.contentOriginY = 0.5;
            node.edgeWidth = 0;
            node.cornerRadius = 0;
            normalizeColor(input?.color, node.color, index);

            if (node.kind === 'texture') {
                node.view = requireIdentity(input?.view, `nodes[${index}].view`);
                const bounds = input?.screenBounds;
                node.screenX = requireFinite(bounds?.x, `nodes[${index}].screenBounds.x`);
                node.screenY = requireFinite(bounds?.y, `nodes[${index}].screenBounds.y`);
                node.screenWidth = requirePositiveFinite(
                    bounds?.width,
                    `nodes[${index}].screenBounds.width`
                );
                node.screenHeight = requirePositiveFinite(
                    bounds?.height,
                    `nodes[${index}].screenBounds.height`
                );
                const sourceOrigin = input?.sourceLogicalOrigin;
                node.sourceX = requireFinite(
                    sourceOrigin?.x,
                    `nodes[${index}].sourceLogicalOrigin.x`
                );
                node.sourceY = requireFinite(
                    sourceOrigin?.y,
                    `nodes[${index}].sourceLogicalOrigin.y`
                );
                const sourceSize = input?.sourceLogicalSize;
                node.sourceWidth = requirePositiveFinite(
                    sourceSize?.width,
                    `nodes[${index}].sourceLogicalSize.width`
                );
                node.sourceHeight = requirePositiveFinite(
                    sourceSize?.height,
                    `nodes[${index}].sourceLogicalSize.height`
                );
                node.contentScale = requirePositiveFinite(
                    input?.contentScale ?? 1,
                    `nodes[${index}].contentScale`
                );
                const contentOrigin = input?.contentOrigin;
                node.contentOriginX = clamp01(
                    contentOrigin?.x ?? 0.5,
                    `nodes[${index}].contentOrigin.x`
                );
                node.contentOriginY = clamp01(
                    contentOrigin?.y ?? 0.5,
                    `nodes[${index}].contentOrigin.y`
                );
            } else {
                const logicalOrigin = input?.sourceLogicalOrigin;
                node.sourceX = requireFinite(
                    logicalOrigin?.x ?? 0,
                    `nodes[${index}].sourceLogicalOrigin.x`
                );
                node.sourceY = requireFinite(
                    logicalOrigin?.y ?? 0,
                    `nodes[${index}].sourceLogicalOrigin.y`
                );
                const logicalSize = input?.sourceLogicalSize;
                node.sourceWidth = requirePositiveFinite(
                    logicalSize?.width ?? width,
                    `nodes[${index}].sourceLogicalSize.width`
                );
                node.sourceHeight = requirePositiveFinite(
                    logicalSize?.height ?? height,
                    `nodes[${index}].sourceLogicalSize.height`
                );
            }
            if (node.kind === 'vignette') {
                const minDimension = Math.min(
                    node.sourceWidth,
                    node.sourceHeight
                );
                node.edgeWidth = requirePositiveFinite(
                    input?.edgeWidth ?? minDimension * DEFAULT_VIGNETTE_EDGE_RATIO,
                    `nodes[${index}].edgeWidth`
                );
                node.cornerRadius = requireNonNegativeFinite(
                    input?.cornerRadius ?? minDimension * DEFAULT_VIGNETTE_CORNER_RATIO,
                    `nodes[${index}].cornerRadius`
                );
            }
        }
        return value.length;
    }

    #prepareUniformBuffer(context, width, height, nodeCount) {
        const bufferIndex = this.frameEncodeCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-layer-stack-uniform-buffer:${bufferIndex}`,
                size: this.maxNodes * UNIFORM_SLOT_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
            this.uniformBufferCreateCount += 1;
        }
        this.uniformScratch.fill(0);
        for (let index = 0; index < nodeCount; index++) {
            const node = this.normalizedNodes[index];
            const offset = index * UNIFORM_FLOATS_PER_SLOT;
            this.uniformScratch[offset] = width;
            this.uniformScratch[offset + 1] = height;
            this.uniformScratch[offset + 2] = node.screenX;
            this.uniformScratch[offset + 3] = node.screenY;
            this.uniformScratch[offset + 4] = node.screenWidth;
            this.uniformScratch[offset + 5] = node.screenHeight;
            this.uniformScratch[offset + 6] = node.sourceX;
            this.uniformScratch[offset + 7] = node.sourceY;
            this.uniformScratch[offset + 8] = node.sourceWidth;
            this.uniformScratch[offset + 9] = node.sourceHeight;
            this.uniformScratch[offset + 10] = node.contentOriginX;
            this.uniformScratch[offset + 11] = node.contentOriginY;
            this.uniformScratch[offset + 12] = node.color[0];
            this.uniformScratch[offset + 13] = node.color[1];
            this.uniformScratch[offset + 14] = node.color[2];
            this.uniformScratch[offset + 15] = node.color[3];
            this.uniformScratch[offset + 16] = node.opacity;
            this.uniformScratch[offset + 17] = node.contentScale;
            this.uniformScratch[offset + 18] = node.edgeWidth;
            this.uniformScratch[offset + 19] = node.cornerRadius;
        }
        const used = nodeCount * UNIFORM_FLOATS_PER_SLOT;
        context.device.queue.writeBuffer(
            buffer,
            0,
            this.uniformScratch.subarray(0, used)
        );
        return buffer;
    }

    #encodeNormalizedNodes(renderPass, uniformBuffer, nodeCount) {
        for (let index = 0; index < nodeCount; index++) {
            const node = this.normalizedNodes[index];
            const pipelineSet = this.#getPipelineSet(node.kind);
            const offset = index * UNIFORM_SLOT_SIZE;
            const bindGroup = node.kind === 'texture'
                ? this.#getTextureBindGroup(pipelineSet, node.view, uniformBuffer, offset)
                : this.#getAnalyticBindGroup(pipelineSet, uniformBuffer, offset);
            renderPass.setPipeline(pipelineSet.pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(6, 1, 0, 0);
            this.drawCount += 1;
        }
        return nodeCount;
    }

    #getPipelineSet(kind) {
        const cached = this.pipelineSets.get(kind);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-layer-stack-shader',
                code: TITLE_WEBGPU_LAYER_STACK_SHADER
            });
        }
        if (kind === 'texture' && !this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-layer-stack-linear-clamp-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest'
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-layer-stack-${kind}-pipeline:${this.format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'layer_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: `${kind}_fragment`,
                targets: [{
                    format: this.format,
                    blend: createPremultipliedBlendState(),
                    writeMask: 0xF
                }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const pipelineSet = Object.freeze({
            kind,
            pipeline,
            bindGroupLayout: pipeline.getBindGroupLayout(0)
        });
        this.pipelineSets.set(kind, pipelineSet);
        this.pipelineCreateCount += 1;
        return pipelineSet;
    }

    #getTextureBindGroup(pipelineSet, view, buffer, offset) {
        let buffers = this.textureBindGroupCache.get(view);
        if (!buffers) {
            buffers = new WeakMap();
            this.textureBindGroupCache.set(view, buffers);
        }
        let offsets = buffers.get(buffer);
        if (!offsets) {
            offsets = new Map();
            buffers.set(buffer, offsets);
        }
        let bindGroup = offsets.get(offset);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                label: `title-layer-stack-texture-bind-group:${offset}`,
                layout: pipelineSet.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: view },
                    {
                        binding: 2,
                        resource: { buffer, offset, size: UNIFORM_BINDING_SIZE }
                    }
                ]
            });
            offsets.set(offset, bindGroup);
            this.bindGroupCreateCount += 1;
        }
        return bindGroup;
    }

    #getAnalyticBindGroup(pipelineSet, buffer, offset) {
        let buffers = this.analyticBindGroupCache.get(pipelineSet.pipeline);
        if (!buffers) {
            buffers = new WeakMap();
            this.analyticBindGroupCache.set(pipelineSet.pipeline, buffers);
        }
        let offsets = buffers.get(buffer);
        if (!offsets) {
            offsets = new Map();
            buffers.set(buffer, offsets);
        }
        let bindGroup = offsets.get(offset);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                label: `title-layer-stack-${pipelineSet.kind}-bind-group:${offset}`,
                layout: pipelineSet.bindGroupLayout,
                entries: [{
                    binding: 2,
                    resource: { buffer, offset, size: UNIFORM_BINDING_SIZE }
                }]
            });
            offsets.set(offset, bindGroup);
            this.bindGroupCreateCount += 1;
        }
        return bindGroup;
    }
}

function createNormalizedNode() {
    return {
        kind: 'dim',
        view: null,
        screenX: 0,
        screenY: 0,
        screenWidth: 1,
        screenHeight: 1,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 1,
        sourceHeight: 1,
        opacity: 1,
        contentScale: 1,
        contentOriginX: 0.5,
        contentOriginY: 0.5,
        edgeWidth: 0,
        cornerRadius: 0,
        color: new Float32Array([0, 0, 0, 1])
    };
}

function createPremultipliedBlendState() {
    return {
        color: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha'
        },
        alpha: {
            operation: 'add',
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha'
        }
    };
}

function normalizeClear(value) {
    if (value === false) {
        return { enabled: false, value: TRANSPARENT };
    }
    if (value && typeof value === 'object') {
        return {
            enabled: true,
            value: {
                r: clamp01(value.r, 'clear.r'),
                g: clamp01(value.g, 'clear.g'),
                b: clamp01(value.b, 'clear.b'),
                a: clamp01(value.a, 'clear.a')
            }
        };
    }
    return { enabled: true, value: TRANSPARENT };
}

function normalizeColor(value, out, index) {
    const color = value ?? [0, 0, 0, 1];
    if (!Array.isArray(color) && !ArrayBuffer.isView(color)) {
        throw new TypeError(`nodes[${index}].color RGBA 배열이 필요합니다.`);
    }
    if (color.length !== 4) {
        throw new RangeError(`nodes[${index}].color는 RGBA 4개 값이어야 합니다.`);
    }
    for (let channel = 0; channel < 4; channel++) {
        out[channel] = clamp01(color[channel], `nodes[${index}].color[${channel}]`);
    }
}

function requireNodeKind(value, index) {
    if (!NODE_KINDS.includes(value)) {
        throw new RangeError(`nodes[${index}].kind가 지원되지 않습니다: ${String(value)}`);
    }
    return value;
}

function requireRenderPass(value) {
    for (const method of ['setPipeline', 'setBindGroup', 'draw']) {
        if (typeof value?.[method] !== 'function') {
            throw new TypeError(`title layer stack render pass에 ${method}()가 필요합니다.`);
        }
    }
}

function requireDevice(device) {
    for (const method of [
        'createShaderModule',
        'createSampler',
        'createRenderPipeline',
        'createBuffer',
        'createBindGroup'
    ]) {
        if (typeof device?.[method] !== 'function') {
            throw new TypeError(`title layer stack device에 ${method}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title layer stack device.queue.writeBuffer()가 필요합니다.');
    }
    return device;
}

function requireFormat(value) {
    if (!SUPPORTED_FORMATS.includes(value)) {
        throw new RangeError(
            `title layer stack format은 ${SUPPORTED_FORMATS.join(', ')}만 지원합니다: ${String(value)}`
        );
    }
    return value;
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${name} identity가 필요합니다.`);
    }
    return value;
}

function requirePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireFinite(value, name) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${name}은 유한수여야 합니다.`);
    }
    return Number(value);
}

function requirePositiveFinite(value, name) {
    const number = requireFinite(value, name);
    if (number <= 0) {
        throw new RangeError(`${name}은 0보다 커야 합니다.`);
    }
    return number;
}

function requireNonNegativeFinite(value, name) {
    const number = requireFinite(value, name);
    if (number < 0) {
        throw new RangeError(`${name}은 0 이상이어야 합니다.`);
    }
    return number;
}

function clamp01(value, name) {
    return Math.max(0, Math.min(1, requireFinite(value, name)));
}
