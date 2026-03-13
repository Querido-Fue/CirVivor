import { compileShader, createProgram, DEFAULT_VERTEX_SHADER, DEFAULT_FRAGMENT_SHADER } from './_shader_utils.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { ShapeGeometryBuilder } from './_shape_geometry_builder.js';
import { ShapeDrawer } from 'display/_shape_drawer.js';
import { OverlayEffectRenderer } from './_overlay_effect_renderer.js';
import { EffectRenderer } from './_effect_renderer.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const WEBGL_CONSTANTS = getData('WEBGL_CONSTANTS');
const ENEMY_WEBGL_SHAPES = getData('ENEMY_WEBGL_SHAPES');

/**
 * @class ShapeTextureCache
 * @description 도형 아틀라스 텍스처를 캐시합니다.
 */
class ShapeTextureCache {
    constructor(gl) {
        this.gl = gl;
        this.textureSize = WEBGL_CONSTANTS.SHAPE_TEXTURE_SIZE;
        this.shapeOrder = [
            'rect',
            'square',
            'circle',
            'triangle',
            'pentagon',
            'hexagon',
            'octagon',
            'arrow',
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

/**
 * @class WebGLBatch
 * @description 동일 텍스처 기준의 스프라이트 배치를 처리합니다.
 */
class WebGLBatch {
    constructor(gl) {
        this.gl = gl;
        this.maxSprites = GLOBAL_CONSTANTS.WEBGL_MAX_SPRITES;
        this.vertexSize = WEBGL_CONSTANTS.BATCH_VERTEX_SIZE;
        this.vertices = new Float32Array(this.maxSprites * 4 * this.vertexSize);
        this.spriteCount = 0;
        this.currentTexture = null;
        this.textureCache = new Map();
        this.colorCache = new Map();
        this.geometryBuffer = new Float32Array(8);
        this.shapeCache = new ShapeTextureCache(gl);

        this.#init();
    }

    /**
     * 배치 시작 전 상태를 초기화합니다.
     * @param {number} width - 화면 너비입니다.
     * @param {number} height - 화면 높이입니다.
     */
    begin(width, height) {
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.uniform2f(this.uResolution, width, height);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        const stride = this.vertexSize * 4;
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.aTexCoord);
        gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, stride, 2 * 4);

        gl.enableVertexAttribArray(this.aColor);
        gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 4 * 4);

        this.spriteCount = 0;
        this.currentTexture = null;
    }

    /**
     * 누적된 배치를 GPU에 반영합니다.
     */
    flush() {
        if (this.spriteCount === 0) {
            return;
        }

        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
        gl.uniform1i(this.uImage, 0);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.spriteCount * 4 * this.vertexSize));
        gl.drawElements(gl.TRIANGLES, this.spriteCount * 6, gl.UNSIGNED_SHORT, 0);

        this.spriteCount = 0;
    }

    /**
     * 배치에 스프라이트를 추가합니다.
     * @param {object} options - 스프라이트 렌더링 옵션입니다.
     */
    render(options) {
        let texture;
        let u0 = 0;
        let v0 = 0;
        let u1 = 1;
        let v1 = 1;

        if (options.shape) {
            const textureInfo = this.shapeCache.getTextureInfo(options.shape);
            texture = textureInfo.texture;
            u0 = textureInfo.u0;
            v0 = textureInfo.v0;
            u1 = textureInfo.u1;
            v1 = textureInfo.v1;
        } else if (options.image) {
            texture = this.#getTexture(options.image);
        } else {
            return;
        }

        if (this.currentTexture !== texture || this.spriteCount >= this.maxSprites) {
            this.flush();
            this.currentTexture = texture;
        }

        let r = 1;
        let g = 1;
        let b = 1;
        let a = 1;
        if (options.fill) {
            const cachedColor = typeof options.fill === 'string'
                ? this.#getCachedColor(options.fill)
                : this.#normalizeColor(options.fill);
            r = cachedColor[0];
            g = cachedColor[1];
            b = cachedColor[2];
            a = cachedColor[3];
        }

        if (options.alpha !== undefined) {
            a *= options.alpha;
        }

        const geometry = ShapeGeometryBuilder.buildInto(options, this.geometryBuffer);
        const index = this.spriteCount * 4 * this.vertexSize;
        const vertices = this.vertices;

        vertices[index] = geometry[0];
        vertices[index + 1] = geometry[1];
        vertices[index + 2] = u0;
        vertices[index + 3] = v0;
        vertices[index + 4] = r;
        vertices[index + 5] = g;
        vertices[index + 6] = b;
        vertices[index + 7] = a;

        vertices[index + 8] = geometry[2];
        vertices[index + 9] = geometry[3];
        vertices[index + 10] = u1;
        vertices[index + 11] = v0;
        vertices[index + 12] = r;
        vertices[index + 13] = g;
        vertices[index + 14] = b;
        vertices[index + 15] = a;

        vertices[index + 16] = geometry[4];
        vertices[index + 17] = geometry[5];
        vertices[index + 18] = u1;
        vertices[index + 19] = v1;
        vertices[index + 20] = r;
        vertices[index + 21] = g;
        vertices[index + 22] = b;
        vertices[index + 23] = a;

        vertices[index + 24] = geometry[6];
        vertices[index + 25] = geometry[7];
        vertices[index + 26] = u0;
        vertices[index + 27] = v1;
        vertices[index + 28] = r;
        vertices[index + 29] = g;
        vertices[index + 30] = b;
        vertices[index + 31] = a;

        this.spriteCount++;
    }

    /**
     * @private
     * 배치 렌더러를 초기화합니다.
     */
    #init() {
        const gl = this.gl;
        const vertexShader = compileShader(gl, DEFAULT_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, DEFAULT_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);

        this.program = createProgram(gl, vertexShader, fragmentShader);
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        const indices = new Uint16Array(this.maxSprites * 6);
        for (let spriteIndex = 0, vertexIndex = 0; spriteIndex < this.maxSprites; spriteIndex++, vertexIndex += 4) {
            indices[spriteIndex * 6] = vertexIndex;
            indices[spriteIndex * 6 + 1] = vertexIndex + 1;
            indices[spriteIndex * 6 + 2] = vertexIndex + 2;
            indices[spriteIndex * 6 + 3] = vertexIndex;
            indices[spriteIndex * 6 + 4] = vertexIndex + 2;
            indices[spriteIndex * 6 + 5] = vertexIndex + 3;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.aPosition = gl.getAttribLocation(this.program, 'a_position');
        this.aTexCoord = gl.getAttribLocation(this.program, 'a_texCoord');
        this.aColor = gl.getAttribLocation(this.program, 'a_color');
        this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
        this.uImage = gl.getUniformLocation(this.program, 'u_image');
    }

    /**
     * @private
     * 문자열 색상을 캐시된 vec4로 반환합니다.
     * @param {string} fill - CSS 색상 문자열입니다.
     * @returns {Float32Array} 정규화된 색상 벡터입니다.
     */
    #getCachedColor(fill) {
        let cached = this.colorCache.get(fill);
        if (cached) {
            return cached;
        }

        cached = this.#normalizeColor(fill);
        this.colorCache.set(fill, cached);

        if (this.colorCache.size > WEBGL_CONSTANTS.COLOR_CACHE_LIMIT) {
            this.colorCache.clear();
            this.colorCache.set(fill, cached);
        }

        return cached;
    }

    /**
     * @private
     * 이미지에서 텍스처를 가져옵니다.
     * @param {CanvasImageSource} image - 소스 이미지입니다.
     * @returns {WebGLTexture} 생성된 텍스처입니다.
     */
    #getTexture(image) {
        if (this.textureCache.has(image)) {
            return this.textureCache.get(image);
        }

        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (image.complete && image.naturalWidth > 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        }

        this.textureCache.set(image, texture);
        return texture;
    }

    /**
     * @private
     * 색상 입력을 정규화합니다.
     * @param {string|object} fill - 색상 입력입니다.
     * @returns {Float32Array} vec4 색상입니다.
     */
    #normalizeColor(fill) {
        const rgb = colorUtil().cssToRgb(fill);
        return new Float32Array([rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.a]);
    }
}

/**
 * @class WebGLHandler
 * @description 정적 WebGL 레이어와 동적 overlay effect surface를 함께 관리합니다.
 */
export class WebGLHandler {
    /**
     * @param {Object.<string, WebGLRenderingContext>} glContexts - 초기 WebGL 레이어 맵입니다.
     */
    constructor(glContexts = {}) {
        this.glContexts = new Map();
        this.layerModes = new Map();
        this.layerRenderers = new Map();
        this.width = 0;
        this.height = 0;
        this.backgroundColor = [...WEBGL_CONSTANTS.DEFAULT_BACKGROUND_COLOR];

        for (const [layerName, context] of Object.entries(glContexts)) {
            this.registerLayer(layerName, context, { mode: 'batch' });
        }
    }

    /**
     * 레이어를 등록합니다.
     * @param {string} layerName - 레이어 식별자입니다.
     * @param {WebGLRenderingContext} gl - 연결할 WebGL 컨텍스트입니다.
     * @param {{mode?: 'batch'|'overlay-effect'|'effect'}} [options] - 레이어 모드 옵션입니다.
     */
    registerLayer(layerName, gl, options = {}) {
        if (!layerName || !gl) {
            return;
        }

        const mode = options.mode || 'batch';
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        this.glContexts.set(layerName, gl);
        this.layerModes.set(layerName, mode);

        if (mode === 'overlay-effect') {
            this.layerRenderers.set(layerName, new OverlayEffectRenderer(gl));
        } else if (mode === 'effect') {
            this.layerRenderers.set(layerName, new EffectRenderer(gl));
        } else {
            this.layerRenderers.set(layerName, new WebGLBatch(gl));
        }

        if (this.width > 0 && this.height > 0) {
            gl.viewport(0, 0, this.width, this.height);
            const renderer = this.layerRenderers.get(layerName);
            if (renderer instanceof OverlayEffectRenderer) {
                renderer.resize(this.width, this.height);
            } else if (renderer instanceof EffectRenderer) {
                renderer.resize(this.width, this.height);
            } else {
                renderer.begin(this.width, this.height);
            }
        }
    }

    /**
     * 레이어를 해제합니다.
     * @param {string} layerName - 해제할 레이어 식별자입니다.
     */
    unregisterLayer(layerName) {
        const renderer = this.layerRenderers.get(layerName);
        if (renderer && typeof renderer.destroy === 'function') {
            renderer.destroy();
        }
        this.glContexts.delete(layerName);
        this.layerModes.delete(layerName);
        this.layerRenderers.delete(layerName);
    }

    /**
     * 배경 색상을 갱신합니다.
     * @param {number} r - red 채널입니다.
     * @param {number} g - green 채널입니다.
     * @param {number} b - blue 채널입니다.
     */
    setBackgroundColor(r, g, b) {
        this.backgroundColor = [r, g, b, 1];
    }

    /**
     * 모든 WebGL 레이어를 프레임 시작 상태로 초기화합니다.
     */
    clearAll() {
        for (const [layerName, gl] of this.glContexts.entries()) {
            const mode = this.layerModes.get(layerName);
            const renderer = this.layerRenderers.get(layerName);

            if (layerName === 'background') {
                gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], this.backgroundColor[3]);
            } else {
                gl.clearColor(0, 0, 0, 0);
            }

            gl.clear(gl.COLOR_BUFFER_BIT);

            if (!renderer || this.width <= 0 || this.height <= 0) {
                continue;
            }

            if (mode === 'overlay-effect' || mode === 'effect') {
                renderer.beginFrame(this.width, this.height);
            } else {
                renderer.begin(this.width, this.height);
            }
        }
    }

    /**
     * 배치형 레이어를 flush합니다.
     */
    flushAll() {
        for (const renderer of this.layerRenderers.values()) {
            if (renderer instanceof WebGLBatch) {
                renderer.flush();
                continue;
            }

            if (renderer instanceof EffectRenderer) {
                renderer.flush();
            }
        }
    }

    /**
     * 화면 크기 변경을 각 레이어에 반영합니다.
     * @param {number} width - 새 너비입니다.
     * @param {number} height - 새 높이입니다.
     */
    resize(width, height) {
        this.width = width;
        this.height = height;

        for (const [layerName, gl] of this.glContexts.entries()) {
            gl.viewport(0, 0, width, height);
            const renderer = this.layerRenderers.get(layerName);
            if (renderer instanceof OverlayEffectRenderer) {
                renderer.resize(width, height);
            } else if (renderer instanceof EffectRenderer) {
                renderer.resize(width, height);
            }
        }
    }

    /**
     * 특정 레이어에 렌더 명령을 전달합니다.
     * @param {string} layerName - 대상 레이어 식별자입니다.
     * @param {object} options - 렌더링 옵션입니다.
     */
    render(layerName, options) {
        const renderer = this.layerRenderers.get(layerName);
        if (!renderer) {
            return;
        }

        renderer.render(options);
    }

    /**
     * blur 캐시를 무효화합니다.
     * @param {string} layerName - 대상 overlay effect 레이어입니다.
     */
    markDirty(layerName) {
        const renderer = this.layerRenderers.get(layerName);
        if (renderer instanceof OverlayEffectRenderer) {
            renderer.markBlurDirty();
        }
    }
}
