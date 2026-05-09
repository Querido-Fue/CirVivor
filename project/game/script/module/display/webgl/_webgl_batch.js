import {
    compileShader,
    createProgram,
    DEFAULT_FRAGMENT_SHADER,
    DEFAULT_VERTEX_SHADER
} from './_shader_utils.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { ShapeGeometryBuilder } from './_shape_geometry_builder.js';
import { ShapeTextureCache } from './_shape_texture_cache.js';

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const WEBGL_CONSTANTS = getData('WEBGL_CONSTANTS');

/**
 * 하나의 스프라이트를 구성하는 정점 수입니다.
 */
const VERTICES_PER_SPRITE = 4;

/**
 * 하나의 스프라이트를 구성하는 인덱스 수입니다.
 */
const INDICES_PER_SPRITE = 6;

/**
 * WebGL batch geometry buffer에 저장하는 좌표 컴포넌트 수입니다.
 */
const GEOMETRY_BUFFER_COMPONENTS = 8;

/**
 * WebGL attribute offset 계산에 사용하는 float byte 크기입니다.
 */
const FLOAT_BYTES = Float32Array.BYTES_PER_ELEMENT;

/**
 * 아직 로드되지 않은 이미지 텍스처에 사용하는 투명 fallback 픽셀입니다.
 */
const TRANSPARENT_TEXTURE_PIXEL = new Uint8Array([0, 0, 0, 0]);

/**
 * @class WebGLBatch
 * @description 동일 텍스처 기준의 스프라이트 배치를 처리합니다.
 */
export class WebGLBatch {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.maxSprites = GLOBAL_CONSTANTS.WEBGL_MAX_SPRITES;
        this.vertexSize = WEBGL_CONSTANTS.BATCH_VERTEX_SIZE;
        this.vertices = new Float32Array(this.maxSprites * VERTICES_PER_SPRITE * this.vertexSize);
        this.spriteCount = 0;
        this.currentTexture = null;
        this.textureCache = new Map();
        this.colorCache = new Map();
        this.geometryBuffer = new Float32Array(GEOMETRY_BUFFER_COMPONENTS);
        this.shapeCache = new ShapeTextureCache(gl);
        this.frameWidth = 1;
        this.frameHeight = 1;

        this.#init();
    }

    /**
     * 배치 시작 전 상태를 초기화합니다.
     * @param {number} width - 화면 너비입니다.
     * @param {number} height - 화면 높이입니다.
     */
    begin(width, height) {
        this.frameWidth = width;
        this.frameHeight = height;
        this.#bindRenderState();
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
        this.#bindRenderState();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
        gl.uniform1i(this.uImage, 0);
        gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            this.vertices.subarray(0, this.spriteCount * VERTICES_PER_SPRITE * this.vertexSize)
        );
        gl.drawElements(gl.TRIANGLES, this.spriteCount * INDICES_PER_SPRITE, gl.UNSIGNED_SHORT, 0);

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
        const index = this.spriteCount * VERTICES_PER_SPRITE * this.vertexSize;
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
        const indices = this.#createSpriteIndexBufferData();
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
     * 사각형 스프라이트용 인덱스 버퍼 데이터를 생성합니다.
     * @returns {Uint16Array} WebGL element array buffer에 전달할 인덱스 데이터입니다.
     */
    #createSpriteIndexBufferData() {
        const indices = new Uint16Array(this.maxSprites * INDICES_PER_SPRITE);

        for (
            let spriteIndex = 0, vertexIndex = 0;
            spriteIndex < this.maxSprites;
            spriteIndex++, vertexIndex += VERTICES_PER_SPRITE
        ) {
            const indexOffset = spriteIndex * INDICES_PER_SPRITE;
            indices[indexOffset] = vertexIndex;
            indices[indexOffset + 1] = vertexIndex + 1;
            indices[indexOffset + 2] = vertexIndex + 2;
            indices[indexOffset + 3] = vertexIndex;
            indices[indexOffset + 4] = vertexIndex + 2;
            indices[indexOffset + 5] = vertexIndex + 3;
        }

        return indices;
    }

    /**
     * 외부 WebGL 패스가 바꾼 프로그램/버퍼 상태를 배치 렌더링용으로 복구합니다.
     * @private
     */
    #bindRenderState() {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.uniform2f(this.uResolution, this.frameWidth, this.frameHeight);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

        const stride = this.vertexSize * FLOAT_BYTES;
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.aTexCoord);
        gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, stride, 2 * FLOAT_BYTES);

        gl.enableVertexAttribArray(this.aColor);
        gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 4 * FLOAT_BYTES);
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
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, TRANSPARENT_TEXTURE_PIXEL);
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
