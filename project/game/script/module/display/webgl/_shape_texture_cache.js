import { ShapeDrawer } from 'display/_shape_drawer.js';
import { ENEMY_WEBGL_SHAPES } from 'object/enemy/_enemy_shape_assets.js';
import { WEBGL_CONSTANTS } from './_webgl_constants.js';

/**
 * 적 전용 도형 앞에 배치되는 기본 WebGL 도형 아틀라스 순서입니다.
 */
const BASE_SHAPE_ATLAS_ORDER = Object.freeze([
    'rect',
    'square',
    'circle',
    'triangle',
    'pentagon',
    'hexagon',
    'octagon',
    'arrow'
]);

/**
 * 기존 WebGL 도형의 UV ABI를 보존하는 고정 atlas page 슬롯 수입니다.
 * R2 Turn 8까지의 base/enemy 16개 도형은 page 0의 같은 열에 남고,
 * 이후 도형은 동일 규격의 overflow page에 append됩니다.
 */
const SHAPE_ATLAS_PAGE_CAPACITY = 16;

/**
 * @class ShapeTextureCache
 * @description 도형 아틀라스 텍스처를 캐시합니다.
 */
export class ShapeTextureCache {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.textureSize = WEBGL_CONSTANTS.SHAPE_TEXTURE_SIZE;
        this.shapeOrder = [
            ...BASE_SHAPE_ATLAS_ORDER,
            ...ENEMY_WEBGL_SHAPES
        ];
        this.shapeDrawer = new ShapeDrawer();
        this.atlasCanvases = [];
        this.atlasContexts = [];
        this.atlasTextures = [];
        this.atlasCanvas = null;
        this.atlasContext = null;
        this.textureInfoCache = new Map();
        this.defaultTextureInfo = null;

        this.#initAtlas();
    }

    /**
     * 도형별 텍스처 정보를 반환합니다.
     * @param {string} shape - 도형 이름입니다.
     * @returns {{texture: WebGLTexture, u0: number, v0: number, u1: number, v1: number}}
     */
    getTextureInfo(shape) {
        return this.textureInfoCache.get(shape) || this.defaultTextureInfo;
    }

    /**
     * @private
     * 아틀라스 텍스처를 초기화합니다.
     */
    #initAtlas() {
        const size = this.textureSize;
        const atlasWidth = size * SHAPE_ATLAS_PAGE_CAPACITY;
        const atlasHeight = size;
        const halfTexelU = 0.5 / atlasWidth;
        const halfTexelV = 0.5 / atlasHeight;
        const pageCount = Math.ceil(this.shapeOrder.length / SHAPE_ATLAS_PAGE_CAPACITY);

        for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            const firstShapeIndex = pageIndex * SHAPE_ATLAS_PAGE_CAPACITY;
            const lastShapeIndex = Math.min(
                firstShapeIndex + SHAPE_ATLAS_PAGE_CAPACITY,
                this.shapeOrder.length
            );
            const pageTextureInfos = [];

            canvas.width = atlasWidth;
            canvas.height = atlasHeight;
            context.clearRect(0, 0, atlasWidth, atlasHeight);
            context.fillStyle = '#FFFFFF';

            for (let shapeIndex = firstShapeIndex; shapeIndex < lastShapeIndex; shapeIndex++) {
                const shape = this.shapeOrder[shapeIndex];
                const columnIndex = shapeIndex - firstShapeIndex;
                const offsetX = columnIndex * size;
                const textureInfo = {
                    texture: null,
                    u0: (offsetX / atlasWidth) + halfTexelU,
                    v0: halfTexelV,
                    u1: ((offsetX + size) / atlasWidth) - halfTexelU,
                    v1: 1 - halfTexelV
                };

                this.shapeDrawer.drawShape(context, shape, offsetX, 0, size);
                this.textureInfoCache.set(shape, textureInfo);
                pageTextureInfos.push(textureInfo);
            }

            const texture = this.#createTextureFromCanvas(canvas);
            for (const textureInfo of pageTextureInfos) {
                textureInfo.texture = texture;
            }
            this.atlasCanvases.push(canvas);
            this.atlasContexts.push(context);
            this.atlasTextures.push(texture);
        }

        this.atlasCanvas = this.atlasCanvases[0] ?? null;
        this.atlasContext = this.atlasContexts[0] ?? null;
        this.defaultTextureInfo = this.textureInfoCache.get('rect');
    }

    /**
     * @private
     * 캔버스로부터 텍스처를 생성합니다.
     * @param {HTMLCanvasElement} canvas - 소스 캔버스입니다.
     * @returns {WebGLTexture} 생성된 텍스처입니다.
     */
    #createTextureFromCanvas(canvas) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        return texture;
    }
}
