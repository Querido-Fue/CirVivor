import { getData } from 'data/data_handler.js';
import { ShapeDrawer } from 'display/_shape_drawer.js';

const WEBGL_CONSTANTS = getData('WEBGL_CONSTANTS');
const ENEMY_WEBGL_SHAPES = getData('ENEMY_WEBGL_SHAPES');

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
        this.atlasCanvas = document.createElement('canvas');
        this.atlasContext = this.atlasCanvas.getContext('2d');
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
        const atlasWidth = size * this.shapeOrder.length;
        const atlasHeight = size;
        const context = this.atlasContext;
        const halfTexelU = 0.5 / atlasWidth;
        const halfTexelV = 0.5 / atlasHeight;

        this.atlasCanvas.width = atlasWidth;
        this.atlasCanvas.height = atlasHeight;
        context.clearRect(0, 0, atlasWidth, atlasHeight);
        context.fillStyle = '#FFFFFF';

        for (let index = 0; index < this.shapeOrder.length; index++) {
            const shape = this.shapeOrder[index];
            const offsetX = index * size;

            this.shapeDrawer.drawShape(context, shape, offsetX, 0, size);
            this.textureInfoCache.set(shape, {
                texture: null,
                u0: (offsetX / atlasWidth) + halfTexelU,
                v0: halfTexelV,
                u1: ((offsetX + size) / atlasWidth) - halfTexelU,
                v1: 1 - halfTexelV
            });
        }

        const atlasTexture = this.#createTextureFromCanvas(this.atlasCanvas);
        for (const textureInfo of this.textureInfoCache.values()) {
            textureInfo.texture = atlasTexture;
        }

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
