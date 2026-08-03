const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const UNIFORM_SLOT_SIZE = 256;
const UNIFORM_FLOATS_PER_SLOT = UNIFORM_SLOT_SIZE / Float32Array.BYTES_PER_ELEMENT;
const UNIFORM_BINDING_SIZE = 48;
const DEFAULT_MAX_LAYERS = 8;
const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

export const TITLE_WEBGPU_COMPOSITE_SHADER = `
    struct CompositeParameters {
        targetSize: vec2<f32>,
        destinationOrigin: vec2<f32>,
        destinationSize: vec2<f32>,
        uvOrigin: vec2<f32>,
        uvSize: vec2<f32>,
        opacity: f32,
        padding: f32,
    };

    struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
    };

    @group(0) @binding(0) var sourceSampler: sampler;
    @group(0) @binding(1) var sourceTexture: texture_2d<f32>;
    @group(0) @binding(2) var<uniform> parameters: CompositeParameters;

    @vertex
    fn composite_vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
        let corners = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(1.0, 1.0)
        );
        let corner = corners[vertexIndex];
        let pixel = parameters.destinationOrigin + corner * parameters.destinationSize;
        let ndc = vec2<f32>(
            (pixel.x / parameters.targetSize.x) * 2.0 - 1.0,
            1.0 - (pixel.y / parameters.targetSize.y) * 2.0
        );
        var output: VertexOutput;
        output.position = vec4<f32>(ndc, 0.0, 1.0);
        output.uv = parameters.uvOrigin + corner * parameters.uvSize;
        return output;
    }

    @fragment
    fn composite_fragment(input: VertexOutput) -> @location(0) vec4<f32> {
        return textureSample(sourceTexture, sourceSampler, input.uv) * parameters.opacity;
    }
`;

/** 여러 premultiplied texture/atlas rect를 caller-owned target에 순서대로 합성합니다. */
export class TitleWebGpuCompositePass {
    /** @param {{maxLayers?:number}} [options={}] - 한 encode에서 허용할 layer 상한입니다. */
    constructor(options = {}) {
        this.maxLayers = requirePositiveInteger(
            options.maxLayers ?? DEFAULT_MAX_LAYERS,
            'maxLayers'
        );
        this.device = null;
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.sampler = null;
        this.pipelineSets = new Map();
        this.uniformBuffers = [];
        this.uniformScratch = new Float32Array(
            this.maxLayers * UNIFORM_FLOATS_PER_SLOT
        );
        this.normalizedLayers = Array.from({ length: this.maxLayers }, () => ({
            view: null,
            destX: 0,
            destY: 0,
            destWidth: 0,
            destHeight: 0,
            uvX: 0,
            uvY: 0,
            uvWidth: 1,
            uvHeight: 1,
            opacity: 1
        }));
        this.scissorScratch = { x: 0, y: 0, width: 0, height: 0 };
        this.bindGroupCache = new WeakMap();
        this.currentFrameId = null;
        this.frameEncodeCount = 0;
        this.destroyed = false;
        this.encodeCount = 0;
        this.drawCount = 0;
        this.pipelineCreateCount = 0;
        this.uniformBufferCreateCount = 0;
    }

    /**
     * layer 배열 순서로 한 render pass에 quad를 합성합니다.
     * @param {object} context - composer의 고정 frame context입니다.
     * @param {object} input - target과 source layer 목록입니다.
     * @returns {boolean} pass를 encode했으면 true입니다.
     */
    encode(context, input = {}) {
        this.#acceptContext(context);
        const targetView = requireIdentity(input.targetView, 'targetView');
        const targetWidth = requirePositiveInteger(input.targetWidth, 'targetWidth');
        const targetHeight = requirePositiveInteger(input.targetHeight, 'targetHeight');
        const format = requireFormat(input.format ?? context.format);
        const layerCount = this.#normalizeLayers(input.layers);
        const layers = this.normalizedLayers;
        const pipelineSet = this.#getPipelineSet(format);
        const uniformBuffer = this.#prepareUniformBuffer(
            context,
            targetWidth,
            targetHeight,
            layers,
            layerCount
        );
        const renderPass = context.encoder.beginRenderPass({
            label: input.label || `title-composite:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: input.clearValue ?? TRANSPARENT,
                loadOp: input.loadOp === 'load' ? 'load' : 'clear',
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(pipelineSet.pipeline);
        for (let index = 0; index < layerCount; index++) {
            const layer = layers[index];
            const scissor = calculateScissor(
                layer,
                targetWidth,
                targetHeight,
                this.scissorScratch
            );
            if (!scissor) {
                continue;
            }
            renderPass.setScissorRect(
                scissor.x,
                scissor.y,
                scissor.width,
                scissor.height
            );
            renderPass.setBindGroup(0, this.#getBindGroup(
                pipelineSet,
                layer.view,
                uniformBuffer,
                index * UNIFORM_SLOT_SIZE
            ));
            renderPass.draw(6, 1, 0, 0);
            this.drawCount += 1;
        }
        renderPass.end();
        this.encodeCount += 1;
        return true;
    }

    /** generation-owned pipeline/buffer를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#destroyGenerationResources();
        this.device = null;
        this.deviceGeneration = null;
        this.destroyed = true;
        return true;
    }

    /** @returns {Readonly<object>} allocation/encode 진단입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            pipelineFormatCount: this.pipelineSets.size,
            uniformBufferCount: this.uniformBuffers.length,
            encodeCount: this.encodeCount,
            drawCount: this.drawCount,
            pipelineCreateCount: this.pipelineCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount
        });
    }

    #normalizeLayers(value) {
        if (!Array.isArray(value)) {
            throw new TypeError('title composite layers 배열이 필요합니다.');
        }
        if (value.length > this.maxLayers) {
            throw new RangeError(`title composite layer 상한을 초과했습니다: ${this.maxLayers}`);
        }
        for (let index = 0; index < value.length; index++) {
            const input = value[index];
            const layer = this.normalizedLayers[index];
            layer.view = requireIdentity(input?.view, `layers[${index}].view`);
            layer.destX = requireFinite(input?.destX, `layers[${index}].destX`);
            layer.destY = requireFinite(input?.destY, `layers[${index}].destY`);
            layer.destWidth = requirePositiveFinite(
                input?.destWidth,
                `layers[${index}].destWidth`
            );
            layer.destHeight = requirePositiveFinite(
                input?.destHeight,
                `layers[${index}].destHeight`
            );
            layer.uvX = requireFinite(input?.uvX ?? 0, `layers[${index}].uvX`);
            layer.uvY = requireFinite(input?.uvY ?? 0, `layers[${index}].uvY`);
            layer.uvWidth = requirePositiveFinite(
                input?.uvWidth ?? 1,
                `layers[${index}].uvWidth`
            );
            layer.uvHeight = requirePositiveFinite(
                input?.uvHeight ?? 1,
                `layers[${index}].uvHeight`
            );
            layer.opacity = clamp01(input?.opacity ?? 1);
        }
        return value.length;
    }

    #acceptContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU composite pass는 사용할 수 없습니다.');
        }
        const device = requireDevice(context?.device);
        const generation = requireNonNegativeInteger(
            context?.deviceGeneration,
            'deviceGeneration'
        );
        const frameId = requireNonNegativeInteger(context?.frameId, 'frameId');
        if (!context?.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title composite pass에는 composer encoder가 필요합니다.');
        }
        if (this.deviceGeneration !== null && generation < this.deviceGeneration) {
            throw new Error('stale title composite device generation입니다.');
        }
        if (this.deviceGeneration === null || generation > this.deviceGeneration) {
            if (this.deviceGeneration !== null) {
                this.#destroyGenerationResources();
            }
            this.device = device;
            this.deviceGeneration = generation;
            this.currentFrameId = null;
        } else if (device !== this.device) {
            throw new Error('generation 변경 없는 title composite device drift입니다.');
        }
        if (this.currentFrameId !== null && frameId < this.currentFrameId) {
            throw new Error('stale title composite frame입니다.');
        }
        if (frameId !== this.currentFrameId) {
            this.currentFrameId = frameId;
            this.frameEncodeCount = 0;
        }
    }

    #getPipelineSet(format) {
        const cached = this.pipelineSets.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-texture-composite-shader',
                code: TITLE_WEBGPU_COMPOSITE_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-texture-composite-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest'
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-texture-composite-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'composite_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'composite_fragment',
                targets: [{
                    format,
                    blend: {
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
                    },
                    writeMask: 0xF
                }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const pipelineSet = Object.freeze({
            pipeline,
            bindGroupLayout: pipeline.getBindGroupLayout(0)
        });
        this.pipelineSets.set(format, pipelineSet);
        this.pipelineCreateCount += 1;
        return pipelineSet;
    }

    #prepareUniformBuffer(context, targetWidth, targetHeight, layers, layerCount) {
        const bufferIndex = this.frameEncodeCount++;
        let buffer = this.uniformBuffers[bufferIndex];
        if (!buffer) {
            buffer = this.device.createBuffer({
                label: `title-composite-uniform-buffer:${bufferIndex}`,
                size: this.maxLayers * UNIFORM_SLOT_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBuffers[bufferIndex] = buffer;
            this.uniformBufferCreateCount += 1;
        }
        this.uniformScratch.fill(0);
        for (let index = 0; index < layerCount; index++) {
            const layer = layers[index];
            const offset = index * UNIFORM_FLOATS_PER_SLOT;
            this.uniformScratch[offset] = targetWidth;
            this.uniformScratch[offset + 1] = targetHeight;
            this.uniformScratch[offset + 2] = layer.destX;
            this.uniformScratch[offset + 3] = layer.destY;
            this.uniformScratch[offset + 4] = layer.destWidth;
            this.uniformScratch[offset + 5] = layer.destHeight;
            this.uniformScratch[offset + 6] = layer.uvX;
            this.uniformScratch[offset + 7] = layer.uvY;
            this.uniformScratch[offset + 8] = layer.uvWidth;
            this.uniformScratch[offset + 9] = layer.uvHeight;
            this.uniformScratch[offset + 10] = layer.opacity;
        }
        context.device.queue.writeBuffer(buffer, 0, this.uniformScratch);
        return buffer;
    }

    #getBindGroup(pipelineSet, view, buffer, offset) {
        let buffers = this.bindGroupCache.get(view);
        if (!buffers) {
            buffers = new WeakMap();
            this.bindGroupCache.set(view, buffers);
        }
        let offsets = buffers.get(buffer);
        if (!offsets) {
            offsets = new Map();
            buffers.set(buffer, offsets);
        }
        let bindGroup = offsets.get(offset);
        if (!bindGroup) {
            bindGroup = this.device.createBindGroup({
                label: `title-texture-composite-bind-group:${offset}`,
                layout: pipelineSet.bindGroupLayout,
                entries: [
                    { binding: 0, resource: this.sampler },
                    { binding: 1, resource: view },
                    {
                        binding: 2,
                        resource: {
                            buffer,
                            offset,
                            size: UNIFORM_BINDING_SIZE
                        }
                    }
                ]
            });
            offsets.set(offset, bindGroup);
        }
        return bindGroup;
    }

    #destroyGenerationResources() {
        for (const buffer of this.uniformBuffers) {
            try {
                buffer?.destroy?.();
            } catch {
                // generation teardown은 best-effort입니다.
            }
        }
        this.uniformBuffers.length = 0;
        this.pipelineSets.clear();
        this.shaderModule = null;
        this.sampler = null;
        this.bindGroupCache = new WeakMap();
        this.currentFrameId = null;
        this.frameEncodeCount = 0;
    }
}

function calculateScissor(layer, targetWidth, targetHeight, out) {
    const left = Math.max(0, Math.floor(layer.destX));
    const top = Math.max(0, Math.floor(layer.destY));
    const right = Math.min(targetWidth, Math.ceil(layer.destX + layer.destWidth));
    const bottom = Math.min(targetHeight, Math.ceil(layer.destY + layer.destHeight));
    if (right <= left || bottom <= top) {
        return null;
    }
    out.x = left;
    out.y = top;
    out.width = right - left;
    out.height = bottom - top;
    return out;
}

function requireDevice(device) {
    for (const name of [
        'createShaderModule',
        'createSampler',
        'createRenderPipeline',
        'createBuffer',
        'createBindGroup'
    ]) {
        if (typeof device?.[name] !== 'function') {
            throw new TypeError(`title composite device에 ${name}()가 없습니다.`);
        }
    }
    if (typeof device.queue?.writeBuffer !== 'function') {
        throw new TypeError('title composite device.queue.writeBuffer()가 필요합니다.');
    }
    return device;
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${name} identity가 필요합니다.`);
    }
    return value;
}

function requireFormat(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('title composite format이 필요합니다.');
    }
    return value.trim();
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

function clamp01(value) {
    const number = requireFinite(value, 'opacity');
    return Math.max(0, Math.min(1, number));
}
