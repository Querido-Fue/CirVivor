import {
    TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY,
    TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
    TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS,
    TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT,
    TITLE_CPU_ENEMY_STYLE_SHAPE_MASK,
    TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT
} from './_title_cpu_enemy_presentation_adapter.js';
import {
    TitleWebGpuEnemyShapeAtlas,
    TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS
} from './_title_webgpu_enemy_shape_atlas.js';

const BUFFER_USAGE_COPY_DST = 0x08;
const BUFFER_USAGE_UNIFORM = 0x40;
const BUFFER_USAGE_STORAGE = 0x80;
const COLOR_WRITE_ALL = 0x0F;
const PALETTE_ENTRIES_PER_LAYER = 2;
const PALETTE_ENTRY_COUNT = TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY
    * PALETTE_ENTRIES_PER_LAYER;
const UNIFORM_HEADER_FLOATS = 4;
const UNIFORM_FLOAT_COUNT = UNIFORM_HEADER_FLOATS + (PALETTE_ENTRY_COUNT * 4);
const UNIFORM_BYTE_SIZE = UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const RECORD_BUFFER_BYTE_SIZE = TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS
    * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

/** 타이틀 CPU 적 instanced pass의 고정 buffer/palette ABI입니다. */
export const TITLE_WEBGPU_ENEMY_PASS_CONSTANTS = Object.freeze({
    MAX_RECORDS: TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS,
    RECORD_STRIDE_BYTES: TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES,
    RECORD_BUFFER_BYTE_SIZE,
    PALETTE_ENTRY_COUNT,
    PALETTE_ENTRIES_PER_LAYER,
    CORE_PALETTE_OFFSET: 0,
    SOFTNESS_PALETTE_OFFSET: 1,
    UNIFORM_BYTE_SIZE
});

/**
 * adapter의 32-byte record를 instance index로 직접 읽고, style code로
 * shape/layer/softness palette를 복원하는 premultiplied-alpha WGSL입니다.
 */
export const TITLE_WEBGPU_ENEMY_SHADER = `
    const SHAPE_COUNT: u32 = ${TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.SHAPE_COUNT}u;
    const LAYER_COUNT: u32 = ${TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY}u;
    const SHAPE_MASK: u32 = ${TITLE_CPU_ENEMY_STYLE_SHAPE_MASK}u;
    const SOFTNESS_BIT: u32 = ${TITLE_CPU_ENEMY_STYLE_SOFTNESS_BIT}u;
    const LAYER_SHIFT: u32 = ${TITLE_CPU_ENEMY_STYLE_LAYER_SHIFT}u;

    struct EnemyRecord {
        positionAndSize: vec4<f32>,
        rotationAlphaStyle: vec4<f32>,
    };

    struct EnemyParameters {
        targetAndAtlasSize: vec4<f32>,
        palette: array<vec4<f32>, ${PALETTE_ENTRY_COUNT}>,
    };

    struct EnemyVertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) uv: vec2<f32>,
        @location(1) @interpolate(flat) paletteColor: vec4<f32>,
    };

    @group(0) @binding(0) var<storage, read> records: array<EnemyRecord>;
    @group(0) @binding(1) var shapeAtlas: texture_2d<f32>;
    @group(0) @binding(2) var shapeSampler: sampler;
    @group(0) @binding(3) var<uniform> parameters: EnemyParameters;

    @vertex
    fn title_enemy_vertex(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) instanceIndex: u32
    ) -> EnemyVertexOutput {
        let corners = array<vec2<f32>, 6>(
            vec2<f32>(0.0, 0.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(0.0, 1.0),
            vec2<f32>(1.0, 0.0),
            vec2<f32>(1.0, 1.0)
        );
        let corner = corners[vertexIndex];
        let record = records[instanceIndex];
        let local = (corner - vec2<f32>(0.5)) * record.positionAndSize.zw;
        let rotationCos = record.rotationAlphaStyle.x;
        let rotationSin = record.rotationAlphaStyle.y;
        let rotated = vec2<f32>(
            (local.x * rotationCos) - (local.y * rotationSin),
            (local.x * rotationSin) + (local.y * rotationCos)
        );
        let pixel = record.positionAndSize.xy + rotated;
        let targetSize = max(parameters.targetAndAtlasSize.xy, vec2<f32>(1.0));
        let ndc = vec2<f32>(
            (pixel.x / targetSize.x) * 2.0 - 1.0,
            1.0 - (pixel.y / targetSize.y) * 2.0
        );

        let styleCode = u32(max(0.0, record.rotationAlphaStyle.w) + 0.5);
        let shapeCode = styleCode & SHAPE_MASK;
        let layerIndex = styleCode >> LAYER_SHIFT;
        let softnessIndex = select(0u, 1u, (styleCode & SOFTNESS_BIT) != 0u);
        let validStyle = shapeCode < SHAPE_COUNT && layerIndex < LAYER_COUNT;
        let safeLayerIndex = min(layerIndex, LAYER_COUNT - 1u);
        let paletteIndex = (safeLayerIndex * ${PALETTE_ENTRIES_PER_LAYER}u) + softnessIndex;
        let sourceColor = parameters.palette[paletteIndex];
        let styleAlpha = select(0.0, 1.0, validStyle);
        let alpha = clamp(record.rotationAlphaStyle.z, 0.0, 1.0)
            * clamp(sourceColor.a, 0.0, 1.0)
            * styleAlpha;

        let atlasSize = parameters.targetAndAtlasSize.zw;
        let cellSize = atlasSize.y;
        let atlasPixel = vec2<f32>(
            (f32(shapeCode) * cellSize) + 0.5 + (corner.x * (cellSize - 1.0)),
            0.5 + (corner.y * (cellSize - 1.0))
        );

        var output: EnemyVertexOutput;
        output.position = vec4<f32>(ndc, 0.0, 1.0);
        output.uv = atlasPixel / atlasSize;
        output.paletteColor = vec4<f32>(sourceColor.rgb, alpha);
        return output;
    }

    @fragment
    fn title_enemy_fragment(input: EnemyVertexOutput) -> @location(0) vec4<f32> {
        let mask = textureSample(shapeAtlas, shapeSampler, input.uv).a;
        let alpha = clamp(mask * input.paletteColor.a, 0.0, 1.0);
        return vec4<f32>(input.paletteColor.rgb * alpha, alpha);
    }
`;

/**
 * CPU title enemy packet을 caller-owned scene texture에 한 instanced render pass로 기록합니다.
 * presentation texture 획득, encoder 생성/완료, queue submit 및 surface signal은 수행하지 않습니다.
 */
export class TitleWebGpuEnemyPass {
    /**
     * @param {{atlasOptions?:object}} [options={}] - atlas raster 의존성 옵션입니다.
     */
    constructor(options = {}) {
        this.shapeAtlas = new TitleWebGpuEnemyShapeAtlas(options.atlasOptions);
        this.device = null;
        this.deviceGeneration = null;
        this.shaderModule = null;
        this.sampler = null;
        this.pipelineByFormat = new Map();
        this.recordBuffer = null;
        this.uniformBuffer = null;
        this.uniformScratch = new Float32Array(UNIFORM_FLOAT_COUNT);
        this.lastEncodedFrameId = null;
        this.destroyed = false;
        this.encodeCount = 0;
        this.skipCount = 0;
        this.pipelineCreateCount = 0;
        this.recordBufferCreateCount = 0;
        this.uniformBufferCreateCount = 0;
        this.cleanupFailureCount = 0;
    }

    /**
     * packet 순서를 바꾸지 않고 instance index 순서로 target에 렌더합니다.
     * palette 순서는 `[far core, far softness, mid core, mid softness, near core, near softness]`이며
     * 각 항목은 정규화된 RGBA 4개입니다.
     * @param {object} context - composer callback의 고정 frame context입니다.
     * @param {object} input - caller-owned target, packet 및 palette입니다.
     * @param {object} input.packet - `TitleCpuEnemyPresentationAdapter.writePacket()` 결과입니다.
     * @param {GPUTextureView} input.targetView - caller-owned scene texture view입니다.
     * @param {number} input.targetWidth - target 너비입니다.
     * @param {number} input.targetHeight - target 높이입니다.
     * @param {ArrayLike<number>|Array<ArrayLike<number>>} input.palette - RGBA 6색입니다.
     * @param {string} [input.format] - target texture format입니다.
     * @param {'load'|'clear'} [input.loadOp='load'] - target 기존 내용 처리 방식입니다.
     * @param {{r:number,g:number,b:number,a:number}} [input.clearValue] - clear 색입니다.
     * @returns {boolean} 실제 instanced draw를 기록했으면 true입니다.
     */
    encode(context, input = {}) {
        this.#assertUsableContext(context);
        const packet = validatePacket(input.packet);
        if (packet.recordCount === 0) {
            this.skipCount += 1;
            return false;
        }

        const targetView = requireIdentity(input.targetView, 'targetView');
        const targetWidth = requirePositiveInteger(input.targetWidth, 'targetWidth');
        const targetHeight = requirePositiveInteger(input.targetHeight, 'targetHeight');
        const format = requireFormat(input.format ?? context.format);
        const loadOp = normalizeLoadOp(input.loadOp);
        this.#stageUniforms(targetWidth, targetHeight, input.palette);
        this.#ensureGeneration(context.device, context.deviceGeneration);
        this.#assertFrameOrder(context.frameId);

        const atlas = this.shapeAtlas.ensure(context.device, context.deviceGeneration);
        this.#ensureFixedBuffers();
        const pipelineRecord = this.#getPipeline(format, atlas.view);
        const usedRecordFloatCount = packet.recordCount
            * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS;
        context.device.queue.writeBuffer(
            this.recordBuffer,
            0,
            packet.records,
            0,
            usedRecordFloatCount
        );
        context.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformScratch);

        const renderPass = context.encoder.beginRenderPass({
            label: `title-webgpu-enemy-pass:${context.frameId}`,
            colorAttachments: [{
                view: targetView,
                clearValue: input.clearValue ?? TRANSPARENT_CLEAR_VALUE,
                loadOp,
                storeOp: 'store'
            }]
        });
        renderPass.setPipeline(pipelineRecord.pipeline);
        renderPass.setBindGroup(0, pipelineRecord.bindGroup);
        renderPass.draw(6, packet.recordCount, 0, 0);
        renderPass.end();

        this.lastEncodedFrameId = context.frameId;
        this.encodeCount += 1;
        return true;
    }

    /** generation-owned atlas/pipeline/buffer를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#releaseGenerationResources();
        this.shapeAtlas.destroy();
        this.device = null;
        this.deviceGeneration = null;
        this.destroyed = true;
        return true;
    }

    /** @returns {Readonly<object>} resource reuse 및 encode 진단입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            pipelineFormatCount: this.pipelineByFormat.size,
            hasRecordBuffer: Boolean(this.recordBuffer),
            hasUniformBuffer: Boolean(this.uniformBuffer),
            lastEncodedFrameId: this.lastEncodedFrameId,
            encodeCount: this.encodeCount,
            skipCount: this.skipCount,
            pipelineCreateCount: this.pipelineCreateCount,
            recordBufferCreateCount: this.recordBufferCreateCount,
            uniformBufferCreateCount: this.uniformBufferCreateCount,
            cleanupFailureCount: this.cleanupFailureCount,
            atlas: this.shapeAtlas.getDiagnostics()
        });
    }

    #assertUsableContext(context) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU enemy pass는 사용할 수 없습니다.');
        }
        requirePassDevice(context?.device);
        if (!Number.isSafeInteger(context?.deviceGeneration) || context.deviceGeneration < 0) {
            throw new RangeError('title WebGPU enemy deviceGeneration은 0 이상의 정수여야 합니다.');
        }
        if (!Number.isSafeInteger(context?.frameId) || context.frameId < 0) {
            throw new RangeError('title WebGPU enemy frameId는 0 이상의 정수여야 합니다.');
        }
        if (!context.encoder || typeof context.encoder.beginRenderPass !== 'function') {
            throw new TypeError('title WebGPU enemy에는 composer encoder가 필요합니다.');
        }
    }

    #ensureGeneration(device, deviceGeneration) {
        if (this.deviceGeneration !== null && deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title WebGPU enemy device generation입니다.');
        }
        if (this.deviceGeneration === deviceGeneration) {
            if (device !== this.device) {
                throw new Error('generation 변경 없는 title WebGPU enemy device drift입니다.');
            }
            return;
        }

        this.#releaseGenerationResources();
        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.lastEncodedFrameId = null;
    }

    #assertFrameOrder(frameId) {
        if (this.lastEncodedFrameId !== null && frameId < this.lastEncodedFrameId) {
            throw new Error('stale title WebGPU enemy frame입니다.');
        }
        if (frameId === this.lastEncodedFrameId) {
            throw new Error('title WebGPU enemy pass는 프레임당 한 번만 encode할 수 있습니다.');
        }
    }

    #stageUniforms(targetWidth, targetHeight, palette) {
        const scratch = this.uniformScratch;
        scratch.fill(0);
        scratch[0] = targetWidth;
        scratch[1] = targetHeight;
        scratch[2] = TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.WIDTH;
        scratch[3] = TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS.HEIGHT;
        writePalette(palette, scratch, UNIFORM_HEADER_FLOATS);
    }

    #ensureFixedBuffers() {
        if (!this.recordBuffer) {
            this.recordBuffer = this.device.createBuffer({
                label: 'title-webgpu-enemy-record-buffer',
                size: RECORD_BUFFER_BYTE_SIZE,
                usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST
            });
            this.recordBufferCreateCount += 1;
        }
        if (!this.uniformBuffer) {
            this.uniformBuffer = this.device.createBuffer({
                label: 'title-webgpu-enemy-uniform-buffer',
                size: UNIFORM_BYTE_SIZE,
                usage: BUFFER_USAGE_UNIFORM | BUFFER_USAGE_COPY_DST
            });
            this.uniformBufferCreateCount += 1;
        }
    }

    #getPipeline(format, atlasView) {
        const cached = this.pipelineByFormat.get(format);
        if (cached) {
            return cached;
        }
        if (!this.shaderModule) {
            this.shaderModule = this.device.createShaderModule({
                label: 'title-webgpu-enemy-shader',
                code: TITLE_WEBGPU_ENEMY_SHADER
            });
        }
        if (!this.sampler) {
            this.sampler = this.device.createSampler({
                label: 'title-webgpu-enemy-shape-sampler',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'linear',
                minFilter: 'linear',
                mipmapFilter: 'nearest'
            });
        }
        const pipeline = this.device.createRenderPipeline({
            label: `title-webgpu-enemy-pipeline:${format}`,
            layout: 'auto',
            vertex: {
                module: this.shaderModule,
                entryPoint: 'title_enemy_vertex'
            },
            fragment: {
                module: this.shaderModule,
                entryPoint: 'title_enemy_fragment',
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
                    writeMask: COLOR_WRITE_ALL
                }]
            },
            primitive: { topology: 'triangle-list' }
        });
        const bindGroup = this.device.createBindGroup({
            label: `title-webgpu-enemy-bind-group:${format}`,
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.recordBuffer,
                        offset: 0,
                        size: RECORD_BUFFER_BYTE_SIZE
                    }
                },
                { binding: 1, resource: atlasView },
                { binding: 2, resource: this.sampler },
                {
                    binding: 3,
                    resource: {
                        buffer: this.uniformBuffer,
                        offset: 0,
                        size: UNIFORM_BYTE_SIZE
                    }
                }
            ]
        });
        const record = Object.freeze({ pipeline, bindGroup });
        this.pipelineByFormat.set(format, record);
        this.pipelineCreateCount += 1;
        return record;
    }

    #releaseGenerationResources() {
        safeDestroy(this.recordBuffer, this);
        safeDestroy(this.uniformBuffer, this);
        this.recordBuffer = null;
        this.uniformBuffer = null;
        this.pipelineByFormat.clear();
        this.shaderModule = null;
        this.sampler = null;
        this.lastEncodedFrameId = null;
    }
}

function validatePacket(packet) {
    if (!packet || typeof packet !== 'object') {
        throw new TypeError('title WebGPU enemy presentation packet이 필요합니다.');
    }
    if (!(packet.records instanceof Float32Array)) {
        throw new TypeError('title WebGPU enemy packet.records는 Float32Array여야 합니다.');
    }
    if (packet.records.length !== TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS
        * TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS) {
        throw new RangeError('title WebGPU enemy packet.records 용량이 840 records가 아닙니다.');
    }
    if (packet.recordStrideFloats !== TITLE_CPU_ENEMY_PRESENTATION_RECORD_FLOATS
        || packet.recordStrideBytes !== TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES
        || packet.maxRecordCount !== TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS) {
        throw new RangeError('title WebGPU enemy packet ABI가 일치하지 않습니다.');
    }
    if (!Number.isSafeInteger(packet.recordCount)
        || packet.recordCount < 0
        || packet.recordCount > TITLE_CPU_ENEMY_PRESENTATION_MAX_RECORDS) {
        throw new RangeError('title WebGPU enemy packet recordCount가 범위를 벗어났습니다.');
    }
    const expectedByteLength = packet.recordCount * TITLE_CPU_ENEMY_PRESENTATION_RECORD_BYTES;
    if (packet.usedByteLength !== expectedByteLength) {
        throw new RangeError('title WebGPU enemy packet usedByteLength가 recordCount와 다릅니다.');
    }
    return packet;
}

function writePalette(colors, target, targetOffset) {
    const isFlat = ArrayBuffer.isView(colors)
        || (Array.isArray(colors) && typeof colors[0] === 'number');
    if (isFlat) {
        if (colors.length !== PALETTE_ENTRY_COUNT * 4) {
            throw new RangeError('title WebGPU enemy flat palette는 RGBA 24개여야 합니다.');
        }
        for (let index = 0; index < colors.length; index++) {
            target[targetOffset + index] = requireNormalizedChannel(colors[index], index);
        }
        return;
    }
    if (!Array.isArray(colors) || colors.length !== PALETTE_ENTRY_COUNT) {
        throw new RangeError('title WebGPU enemy palette는 6색이어야 합니다.');
    }
    for (let colorIndex = 0; colorIndex < PALETTE_ENTRY_COUNT; colorIndex++) {
        const color = colors[colorIndex];
        if (!color || (color.length !== 3 && color.length !== 4)) {
            throw new RangeError(`title WebGPU enemy palette[${colorIndex}]는 RGB 또는 RGBA여야 합니다.`);
        }
        const offset = targetOffset + (colorIndex * 4);
        target[offset] = requireNormalizedChannel(color[0], offset);
        target[offset + 1] = requireNormalizedChannel(color[1], offset + 1);
        target[offset + 2] = requireNormalizedChannel(color[2], offset + 2);
        target[offset + 3] = color.length === 4
            ? requireNormalizedChannel(color[3], offset + 3)
            : 1;
    }
}

function requirePassDevice(device) {
    for (const methodName of [
        'createShaderModule',
        'createRenderPipeline',
        'createBindGroup',
        'createBuffer',
        'createSampler'
    ]) {
        if (typeof device?.[methodName] !== 'function') {
            throw new TypeError(`title WebGPU enemy device에 ${methodName}()가 없습니다.`);
        }
    }
    if (typeof device?.queue?.writeBuffer !== 'function') {
        throw new TypeError('title WebGPU enemy device.queue.writeBuffer()가 필요합니다.');
    }
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`title WebGPU enemy ${name} identity가 필요합니다.`);
    }
    return value;
}

function requirePositiveInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`title WebGPU enemy ${name}는 양의 정수여야 합니다.`);
    }
    return value;
}

function requireFormat(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('title WebGPU enemy target format이 필요합니다.');
    }
    return value.trim();
}

function normalizeLoadOp(value) {
    if (value === undefined) {
        return 'load';
    }
    if (value !== 'load' && value !== 'clear') {
        throw new TypeError('title WebGPU enemy loadOp은 load 또는 clear여야 합니다.');
    }
    return value;
}

function requireNormalizedChannel(value, index) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(`title WebGPU enemy palette channel ${index}는 0..1이어야 합니다.`);
    }
    return Number(value);
}

function safeDestroy(resource, owner) {
    if (!resource || typeof resource.destroy !== 'function') {
        return;
    }
    try {
        resource.destroy();
    } catch {
        owner.cleanupFailureCount += 1;
    }
}
