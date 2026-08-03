import { ShapeDrawer } from 'display/_shape_drawer.js';
import { WEBGL_CONSTANTS } from 'display/webgl/_webgl_constants.js';
import { getEnemyShapeKey } from 'object/enemy/_enemy_shape_assets.js';
import { TITLE_CPU_ENEMY_STYLE_TYPES } from './_title_cpu_enemy_presentation_adapter.js';

const TEXTURE_USAGE_COPY_DST = 0x02;
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const ATLAS_FORMAT = 'rgba8unorm';

/** packet shape code와 같은 순서로 배치되는 7개 적 마스크 키입니다. */
export const TITLE_WEBGPU_ENEMY_SHAPE_KEYS = Object.freeze(
    TITLE_CPU_ENEMY_STYLE_TYPES.map((type) => getEnemyShapeKey(type))
);

const ATLAS_CELL_SIZE = WEBGL_CONSTANTS.SHAPE_TEXTURE_SIZE;
const ATLAS_WIDTH = ATLAS_CELL_SIZE * TITLE_WEBGPU_ENEMY_SHAPE_KEYS.length;
const ATLAS_HEIGHT = ATLAS_CELL_SIZE;

/** 타이틀 적 전용 흰색 마스크 atlas의 고정 layout입니다. */
export const TITLE_WEBGPU_ENEMY_SHAPE_ATLAS_CONSTANTS = Object.freeze({
    SHAPE_COUNT: TITLE_WEBGPU_ENEMY_SHAPE_KEYS.length,
    CELL_SIZE: ATLAS_CELL_SIZE,
    WIDTH: ATLAS_WIDTH,
    HEIGHT: ATLAS_HEIGHT,
    FORMAT: ATLAS_FORMAT
});

/**
 * 레거시 ShapeDrawer 권위로 7개 적 모양을 한 줄 atlas에 rasterize하고,
 * device generation마다 정확히 한 번 WebGPU texture로 업로드합니다.
 */
export class TitleWebGpuEnemyShapeAtlas {
    /**
     * @param {{canvasFactory?:(width:number,height:number)=>object, shapeDrawerFactory?:()=>object}} [options={}] - 테스트 가능한 raster 의존성입니다.
     */
    constructor(options = {}) {
        this.canvasFactory = typeof options.canvasFactory === 'function'
            ? options.canvasFactory
            : createDefaultAtlasCanvas;
        this.shapeDrawerFactory = typeof options.shapeDrawerFactory === 'function'
            ? options.shapeDrawerFactory
            : () => new ShapeDrawer();
        this.sourceCanvas = null;
        this.device = null;
        this.deviceGeneration = null;
        this.texture = null;
        this.view = null;
        this.record = null;
        this.destroyed = false;
        this.rasterizeCount = 0;
        this.textureCreateCount = 0;
        this.uploadCount = 0;
        this.cleanupFailureCount = 0;
    }

    /**
     * 현재 device generation에 대응하는 atlas texture/view를 반환합니다.
     * @param {GPUDevice} device - Display가 소유한 현재 device입니다.
     * @param {number} deviceGeneration - 현재 device generation입니다.
     * @returns {Readonly<object>} atlas texture, view 및 layout metadata입니다.
     */
    ensure(device, deviceGeneration) {
        if (this.destroyed) {
            throw new Error('destroy된 title WebGPU enemy atlas는 사용할 수 없습니다.');
        }
        requireAtlasDevice(device);
        requireDeviceGeneration(deviceGeneration);

        if (this.deviceGeneration !== null && deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title WebGPU enemy atlas device generation입니다.');
        }
        if (this.deviceGeneration === deviceGeneration) {
            if (device !== this.device) {
                throw new Error('generation 변경 없는 title WebGPU enemy atlas device drift입니다.');
            }
            return this.record;
        }

        this.#releaseTexture();
        const canvas = this.#getSourceCanvas();
        const texture = device.createTexture({
            label: `title-webgpu-enemy-shape-atlas:g${deviceGeneration}`,
            size: {
                width: ATLAS_WIDTH,
                height: ATLAS_HEIGHT,
                depthOrArrayLayers: 1
            },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            format: ATLAS_FORMAT,
            usage: TEXTURE_USAGE_COPY_DST
                | TEXTURE_USAGE_TEXTURE_BINDING
                | TEXTURE_USAGE_RENDER_ATTACHMENT
        });
        this.textureCreateCount += 1;

        let view;
        try {
            device.queue.copyExternalImageToTexture(
                { source: canvas },
                { texture },
                {
                    width: ATLAS_WIDTH,
                    height: ATLAS_HEIGHT,
                    depthOrArrayLayers: 1
                }
            );
            this.uploadCount += 1;
            view = texture.createView({
                label: `title-webgpu-enemy-shape-atlas-view:g${deviceGeneration}`,
                dimension: '2d',
                baseMipLevel: 0,
                mipLevelCount: 1,
                baseArrayLayer: 0,
                arrayLayerCount: 1
            });
        } catch (error) {
            safeDestroy(texture, this);
            throw error;
        }

        this.device = device;
        this.deviceGeneration = deviceGeneration;
        this.texture = texture;
        this.view = view;
        this.record = Object.freeze({
            texture,
            view,
            format: ATLAS_FORMAT,
            width: ATLAS_WIDTH,
            height: ATLAS_HEIGHT,
            cellSize: ATLAS_CELL_SIZE,
            shapeCount: TITLE_WEBGPU_ENEMY_SHAPE_KEYS.length
        });
        return this.record;
    }

    /** generation texture와 CPU raster 참조를 idempotent하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.#releaseTexture();
        this.sourceCanvas = null;
        this.destroyed = true;
        return true;
    }

    /** @returns {Readonly<object>} atlas 생성/업로드 진단입니다. */
    getDiagnostics() {
        return Object.freeze({
            destroyed: this.destroyed,
            deviceGeneration: this.deviceGeneration,
            rasterizeCount: this.rasterizeCount,
            textureCreateCount: this.textureCreateCount,
            uploadCount: this.uploadCount,
            cleanupFailureCount: this.cleanupFailureCount
        });
    }

    #getSourceCanvas() {
        if (this.sourceCanvas) {
            return this.sourceCanvas;
        }
        const canvas = this.canvasFactory(ATLAS_WIDTH, ATLAS_HEIGHT);
        if (!canvas || typeof canvas.getContext !== 'function') {
            throw new TypeError('title WebGPU enemy atlas canvas가 필요합니다.');
        }
        canvas.width = ATLAS_WIDTH;
        canvas.height = ATLAS_HEIGHT;
        const context = canvas.getContext('2d');
        if (!context || typeof context.clearRect !== 'function') {
            throw new TypeError('title WebGPU enemy atlas 2D context가 필요합니다.');
        }
        const drawer = this.shapeDrawerFactory();
        if (!drawer || typeof drawer.drawShape !== 'function') {
            throw new TypeError('title WebGPU enemy atlas ShapeDrawer가 필요합니다.');
        }

        context.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
        context.fillStyle = '#FFFFFF';
        for (let index = 0; index < TITLE_WEBGPU_ENEMY_SHAPE_KEYS.length; index++) {
            drawer.drawShape(
                context,
                TITLE_WEBGPU_ENEMY_SHAPE_KEYS[index],
                index * ATLAS_CELL_SIZE,
                0,
                ATLAS_CELL_SIZE
            );
        }
        this.sourceCanvas = canvas;
        this.rasterizeCount += 1;
        return canvas;
    }

    #releaseTexture() {
        safeDestroy(this.texture, this);
        this.texture = null;
        this.view = null;
        this.record = null;
        this.device = null;
        this.deviceGeneration = null;
    }
}

function createDefaultAtlasCanvas(width, height) {
    if (typeof OffscreenCanvas === 'function') {
        return new OffscreenCanvas(width, height);
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }
    throw new Error('title WebGPU enemy atlas canvas를 생성할 수 없습니다.');
}

function requireAtlasDevice(device) {
    if (typeof device?.createTexture !== 'function') {
        throw new TypeError('title WebGPU enemy atlas device.createTexture()가 필요합니다.');
    }
    if (typeof device?.queue?.copyExternalImageToTexture !== 'function') {
        throw new TypeError('title WebGPU enemy atlas queue.copyExternalImageToTexture()가 필요합니다.');
    }
}

function requireDeviceGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError('title WebGPU enemy atlas deviceGeneration은 0 이상의 정수여야 합니다.');
    }
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
