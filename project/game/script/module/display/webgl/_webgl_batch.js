import {
    compileShader,
    createProgram,
    DEFAULT_FRAGMENT_SHADER,
    DEFAULT_VERTEX_SHADER
} from './_shader_utils.js';
import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import { toRadians } from 'util/math_util.js';
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
 * 명시적 정적 instance vertex 캐시가 보관할 최대 레코드 수입니다.
 */
const SHAPE_INSTANCE_VERTEX_CACHE_LIMIT = 16;

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
        this.shapeInstanceVertexCache = new Map();
        this.geometryBuffer = new Float32Array(GEOMETRY_BUFFER_COMPONENTS);
        this.shapeCache = new ShapeTextureCache(gl);
        this.frameWidth = 1;
        this.frameHeight = 1;

        this.#init();
    }

    /**
     * 프레임 해상도와 CPU-side 배치 큐를 초기화합니다.
     * GL 상태는 실제 제출 직전 {@link flush}에서 복구합니다.
     * @param {number} width - 화면 너비입니다.
     * @param {number} height - 화면 높이입니다.
     * @returns {void}
     */
    begin(width, height) {
        this.frameWidth = width;
        this.frameHeight = height;
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
     * 동일 shape/style을 사용하는 여러 local center를 vertex buffer에 직접 기록합니다.
     * shape texture, 색상, 회전 corner offset은 호출당 한 번만 계산합니다.
     * @param {object} options - 공통 shape 렌더 옵션입니다.
     * @param {Array<{x:number, y:number}>} localCenters - 원점 기준 local center 목록입니다.
     * @param {number} originX - 월드 원점 X 좌표입니다.
     * @param {number} originY - 월드 원점 Y 좌표입니다.
     * @param {number} localScale - local center 좌표 배율입니다.
     * @param {*} [cacheKey=null] - canonical immutable 입력에만 사용하는 명시적 prepared vertex 캐시 키입니다.
     * @returns {number} 실제 기록한 sprite 수입니다.
     */
    renderShapeInstances(options, localCenters, originX, originY, localScale, cacheKey = null) {
        if (!options?.shape || !Array.isArray(localCenters) || localCenters.length === 0) {
            return 0;
        }

        const cacheEnabled = cacheKey !== null && cacheKey !== undefined;
        const cachedRecord = cacheEnabled ? this.shapeInstanceVertexCache.get(cacheKey) : null;
        if (cachedRecord && this.#matchesShapeInstanceVertexCache(
            cachedRecord,
            options,
            localCenters,
            originX,
            originY,
            localScale
        )) {
            if (this.currentTexture !== cachedRecord.texture
                || this.spriteCount + cachedRecord.spriteCount > this.maxSprites) {
                this.flush();
                this.currentTexture = cachedRecord.texture;
            }

            const vertexOffset = this.spriteCount * VERTICES_PER_SPRITE * this.vertexSize;
            this.vertices.set(cachedRecord.vertices, vertexOffset);
            this.spriteCount += cachedRecord.spriteCount;
            return cachedRecord.spriteCount;
        }

        const textureInfo = this.shapeCache.getTextureInfo(options.shape);
        const texture = textureInfo.texture;
        if (this.currentTexture !== texture) {
            this.flush();
            this.currentTexture = texture;
        }

        let r = 1;
        let g = 1;
        let b = 1;
        let a = 1;
        if (options.fill) {
            const color = typeof options.fill === 'string'
                ? this.#getCachedColor(options.fill)
                : this.#normalizeColor(options.fill);
            r = color[0];
            g = color[1];
            b = color[2];
            a = color[3];
        }
        if (options.alpha !== undefined) {
            a *= options.alpha;
        }

        let width = options.w;
        let height = options.h;
        if (width === undefined && options.radius !== undefined) {
            width = options.radius * 2;
            height = options.radius * 2;
        }
        height = height || width;

        const halfWidth = width * 0.5;
        const halfHeight = height * 0.5;
        const hasPrecomputedTrig = Number.isFinite(options.rotationCos)
            && Number.isFinite(options.rotationSin);
        const rotationRadians = hasPrecomputedTrig
            ? 0
            : toRadians(Number.isFinite(options.rotation) ? options.rotation : 0);
        const rotationCos = hasPrecomputedTrig ? options.rotationCos : Math.cos(rotationRadians);
        const rotationSin = hasPrecomputedTrig ? options.rotationSin : Math.sin(rotationRadians);

        const cornerX1 = (-halfWidth * rotationCos) + (halfHeight * rotationSin);
        const cornerY1 = (-halfWidth * rotationSin) - (halfHeight * rotationCos);
        const cornerX2 = (halfWidth * rotationCos) + (halfHeight * rotationSin);
        const cornerY2 = (halfWidth * rotationSin) - (halfHeight * rotationCos);
        const cornerX3 = (halfWidth * rotationCos) - (halfHeight * rotationSin);
        const cornerY3 = (halfWidth * rotationSin) + (halfHeight * rotationCos);
        const cornerX4 = (-halfWidth * rotationCos) - (halfHeight * rotationSin);
        const cornerY4 = (-halfWidth * rotationSin) + (halfHeight * rotationCos);

        const resolvedOriginX = Number.isFinite(originX) ? originX : 0;
        const resolvedOriginY = Number.isFinite(originY) ? originY : 0;
        const resolvedLocalScale = Number.isFinite(localScale) ? localScale : 1;
        const localScaleCos = resolvedLocalScale * rotationCos;
        const localScaleSin = resolvedLocalScale * rotationSin;
        const vertices = this.vertices;
        const vertexSize = this.vertexSize;
        const u0 = textureInfo.u0;
        const v0 = textureInfo.v0;
        const u1 = textureInfo.u1;
        const v1 = textureInfo.v1;
        let writtenCount = 0;
        let cacheStartSpriteIndex = 0;
        let expectedCachedSpriteCount = 0;

        if (cacheEnabled) {
            for (let centerIndex = 0; centerIndex < localCenters.length; centerIndex++) {
                const localCenter = localCenters[centerIndex];
                if (localCenter && Number.isFinite(localCenter.x) && Number.isFinite(localCenter.y)) {
                    expectedCachedSpriteCount += 1;
                }
            }

            if (expectedCachedSpriteCount > 0 && expectedCachedSpriteCount <= this.maxSprites) {
                if (this.spriteCount + expectedCachedSpriteCount > this.maxSprites) {
                    this.flush();
                    this.currentTexture = texture;
                }
                cacheStartSpriteIndex = this.spriteCount;
            } else {
                expectedCachedSpriteCount = 0;
            }
        }

        for (let centerIndex = 0; centerIndex < localCenters.length; centerIndex++) {
            const localCenter = localCenters[centerIndex];
            if (!localCenter || !Number.isFinite(localCenter.x) || !Number.isFinite(localCenter.y)) {
                continue;
            }

            if (this.spriteCount >= this.maxSprites) {
                this.flush();
                this.currentTexture = texture;
            }

            const centerX = resolvedOriginX
                + (localCenter.x * localScaleCos)
                - (localCenter.y * localScaleSin);
            const centerY = resolvedOriginY
                + (localCenter.x * localScaleSin)
                + (localCenter.y * localScaleCos);
            const index = this.spriteCount * VERTICES_PER_SPRITE * vertexSize;

            vertices[index] = centerX + cornerX1;
            vertices[index + 1] = centerY + cornerY1;
            vertices[index + 2] = u0;
            vertices[index + 3] = v0;
            vertices[index + 4] = r;
            vertices[index + 5] = g;
            vertices[index + 6] = b;
            vertices[index + 7] = a;

            vertices[index + 8] = centerX + cornerX2;
            vertices[index + 9] = centerY + cornerY2;
            vertices[index + 10] = u1;
            vertices[index + 11] = v0;
            vertices[index + 12] = r;
            vertices[index + 13] = g;
            vertices[index + 14] = b;
            vertices[index + 15] = a;

            vertices[index + 16] = centerX + cornerX3;
            vertices[index + 17] = centerY + cornerY3;
            vertices[index + 18] = u1;
            vertices[index + 19] = v1;
            vertices[index + 20] = r;
            vertices[index + 21] = g;
            vertices[index + 22] = b;
            vertices[index + 23] = a;

            vertices[index + 24] = centerX + cornerX4;
            vertices[index + 25] = centerY + cornerY4;
            vertices[index + 26] = u0;
            vertices[index + 27] = v1;
            vertices[index + 28] = r;
            vertices[index + 29] = g;
            vertices[index + 30] = b;
            vertices[index + 31] = a;

            this.spriteCount += 1;
            writtenCount += 1;
        }

        if (cacheEnabled
            && expectedCachedSpriteCount > 0
            && writtenCount === expectedCachedSpriteCount) {
            const start = cacheStartSpriteIndex * VERTICES_PER_SPRITE * vertexSize;
            const end = start + (writtenCount * VERTICES_PER_SPRITE * vertexSize);
            this.#storeShapeInstanceVertexCache(cacheKey, {
                options,
                localCenters,
                originX,
                originY,
                localScale,
                texture,
                spriteCount: writtenCount,
                vertices: this.vertices.slice(start, end)
            });
        }

        return writtenCount;
    }

    /**
     * prepared vertex 레코드가 현재 canonical instance 입력과 같은지 확인합니다.
     * local center 배열과 내부 항목은 캐시 수명 동안 불변이라는 호출자 계약을 따릅니다.
     * @param {object} record - 캐시 레코드입니다.
     * @param {object} options - 현재 공통 shape 렌더 옵션입니다.
     * @param {Array<{x:number, y:number}>} localCenters - 현재 local center 목록입니다.
     * @param {number} originX - 현재 월드 원점 X 좌표입니다.
     * @param {number} originY - 현재 월드 원점 Y 좌표입니다.
     * @param {number} localScale - 현재 local center 좌표 배율입니다.
     * @returns {boolean} 재사용 가능한 레코드이면 true입니다.
     * @private
     */
    #matchesShapeInstanceVertexCache(record, options, localCenters, originX, originY, localScale) {
        return record.localCenters === localCenters
            && record.localCenterCount === localCenters.length
            && record.shape === options.shape
            && record.fill === options.fill
            && record.alpha === options.alpha
            && record.w === options.w
            && record.h === options.h
            && record.radius === options.radius
            && record.rotation === options.rotation
            && record.rotationCos === options.rotationCos
            && record.rotationSin === options.rotationSin
            && record.originX === originX
            && record.originY === originY
            && record.localScale === localScale;
    }

    /**
     * prepared vertex 레코드를 제한된 삽입 순서 캐시에 저장합니다.
     * @param {*} cacheKey - 호출자가 재사용하는 명시적 캐시 키입니다.
     * @param {object} data - 현재 입력과 완성된 Float32 vertex 데이터입니다.
     * @returns {void}
     * @private
     */
    #storeShapeInstanceVertexCache(cacheKey, data) {
        if (!this.shapeInstanceVertexCache.has(cacheKey)
            && this.shapeInstanceVertexCache.size >= SHAPE_INSTANCE_VERTEX_CACHE_LIMIT) {
            const oldestKey = this.shapeInstanceVertexCache.keys().next().value;
            this.shapeInstanceVertexCache.delete(oldestKey);
        }

        const options = data.options;
        this.shapeInstanceVertexCache.set(cacheKey, {
            localCenters: data.localCenters,
            localCenterCount: data.localCenters.length,
            shape: options.shape,
            fill: options.fill,
            alpha: options.alpha,
            w: options.w,
            h: options.h,
            radius: options.radius,
            rotation: options.rotation,
            rotationCos: options.rotationCos,
            rotationSin: options.rotationSin,
            originX: data.originX,
            originY: data.originY,
            localScale: data.localScale,
            texture: data.texture,
            spriteCount: data.spriteCount,
            vertices: data.vertices
        });
    }

    /**
     * @private
     * 배치 렌더러를 초기화합니다.
     */
    #init() {
        const gl = this.gl;
        const vertexShader = compileShader(gl, DEFAULT_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, DEFAULT_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);

        this.program = vertexShader && fragmentShader
            ? createProgram(gl, vertexShader, fragmentShader)
            : null;
        if (vertexShader) {
            gl.deleteShader(vertexShader);
        }
        if (fragmentShader) {
            gl.deleteShader(fragmentShader);
        }
        if (!this.program) {
            throw new Error('WebGL batch 셰이더 프로그램을 생성하지 못했습니다.');
        }
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
        const gl = this.gl;
        let record = this.textureCache.get(image);
        if (!record) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            record = {
                texture,
                fallbackUploaded: false,
                sourceUploaded: false
            };
            this.textureCache.set(image, record);
        }

        gl.bindTexture(gl.TEXTURE_2D, record.texture);
        const sourceReady = image.complete === true && image.naturalWidth > 0;
        if (sourceReady && !record.sourceUploaded) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
            record.sourceUploaded = true;
            return record.texture;
        }

        if (!record.sourceUploaded && !record.fallbackUploaded) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, TRANSPARENT_TEXTURE_PIXEL);
            record.fallbackUploaded = true;
        }

        return record.texture;
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
