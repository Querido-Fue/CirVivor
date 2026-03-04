import { compileShader, createProgram, DEFAULT_VERTEX_SHADER, DEFAULT_FRAGMENT_SHADER } from "./_shader_utils.js";
import { getData } from "data/data_handler.js";
import { colorUtil } from "util/color_util.js";
import { ShapeGeometryBuilder } from "./_shape_geometry_builder.js";
import { ShapeDrawer } from "display/_shape_drawer.js";

const GLOBAL_CONSTANTS = getData('GLOBAL_CONSTANTS');
const WEBGL_CONSTANTS = getData('WEBGL_CONSTANTS');
const ENEMY_WEBGL_SHAPES = getData('ENEMY_WEBGL_SHAPES');

/**
 * @class ShapeTextureCache
 * @description 도형을 하나의 아틀라스 텍스처에 그려 UV 정보와 함께 제공합니다.
 */
class ShapeTextureCache {
    constructor(gl) {
        this.gl = gl;
        this.textureSize = WEBGL_CONSTANTS.SHAPE_TEXTURE_SIZE;
        this.shapeOrder = [
            "rect",
            "square",
            "circle",
            "triangle",
            "pentagon",
            "hexagon",
            "octagon",
            "arrow",
            ...ENEMY_WEBGL_SHAPES
        ];
        this.shapeDrawer = new ShapeDrawer();
        this.atlasCanvas = document.createElement("canvas");
        this.atlasCtx = this.atlasCanvas.getContext("2d");
        this.textureInfoCache = new Map();
        this.defaultTextureInfo = null;

        this.initAtlas();
    }

    initAtlas() {
        const size = this.textureSize;
        const atlasWidth = size * this.shapeOrder.length;
        const atlasHeight = size;
        const ctx = this.atlasCtx;
        const halfTexelU = 0.5 / atlasWidth;
        const halfTexelV = 0.5 / atlasHeight;

        this.atlasCanvas.width = atlasWidth;
        this.atlasCanvas.height = atlasHeight;
        ctx.clearRect(0, 0, atlasWidth, atlasHeight);
        ctx.fillStyle = "#FFFFFF";

        for (let i = 0; i < this.shapeOrder.length; i++) {
            const shape = this.shapeOrder[i];
            const ox = i * size;

            this.shapeDrawer.drawShape(ctx, shape, ox, 0, size);

            this.textureInfoCache.set(shape, {
                texture: null,
                u0: (ox / atlasWidth) + halfTexelU,
                v0: halfTexelV,
                u1: ((ox + size) / atlasWidth) - halfTexelU,
                v1: 1 - halfTexelV
            });
        }

        const atlasTexture = this.createTextureFromCanvas(this.atlasCanvas);
        for (const textureInfo of this.textureInfoCache.values()) {
            textureInfo.texture = atlasTexture;
        }
        this.defaultTextureInfo = this.textureInfoCache.get("rect");
    }

    getTextureInfo(shape) {
        return this.textureInfoCache.get(shape) || this.defaultTextureInfo;
    }

    createTextureFromCanvas(canvas) {
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
 * @description 동일 텍스처 단위로 스프라이트를 배치 렌더링합니다.
 */
class WebGLBatch {
    constructor(gl) {
        this.gl = gl;
        this.maxSprites = GLOBAL_CONSTANTS.WEBGL_MAX_SPRITES;
        this.vertexSize = WEBGL_CONSTANTS.BATCH_VERTEX_SIZE; // x, y, u, v, r, g, b, a
        this.vertices = new Float32Array(this.maxSprites * 4 * this.vertexSize);
        this.spriteCount = 0;
        this.currentTexture = null;
        this.textureCache = new Map();
        this.colorCache = new Map();
        this.geometryBuffer = new Float32Array(8);
        this.shapeCache = new ShapeTextureCache(gl);

        this.init();
    }

    getCachedColor(fill) {
        let cached = this.colorCache.get(fill);
        if (cached) return cached;

        const rgb = colorUtil().cssToRgb(fill);
        cached = new Float32Array([rgb.r / 255, rgb.g / 255, rgb.b / 255, rgb.a]);
        this.colorCache.set(fill, cached);

        if (this.colorCache.size > WEBGL_CONSTANTS.COLOR_CACHE_LIMIT) {
            this.colorCache.clear();
            this.colorCache.set(fill, cached);
        }

        return cached;
    }

    init() {
        const gl = this.gl;

        const vertexShader = compileShader(gl, DEFAULT_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, DEFAULT_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
        this.program = createProgram(gl, vertexShader, fragmentShader);

        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);

        this.indexBuffer = gl.createBuffer();
        const indices = new Uint16Array(this.maxSprites * 6);
        for (let i = 0, j = 0; i < this.maxSprites; i++, j += 4) {
            indices[i * 6 + 0] = j + 0;
            indices[i * 6 + 1] = j + 1;
            indices[i * 6 + 2] = j + 2;
            indices[i * 6 + 3] = j + 0;
            indices[i * 6 + 4] = j + 2;
            indices[i * 6 + 5] = j + 3;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

        this.aPosition = gl.getAttribLocation(this.program, "a_position");
        this.aTexCoord = gl.getAttribLocation(this.program, "a_texCoord");
        this.aColor = gl.getAttribLocation(this.program, "a_color");

        this.uResolution = gl.getUniformLocation(this.program, "u_resolution");
        this.uImage = gl.getUniformLocation(this.program, "u_image");
    }

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

    flush() {
        if (this.spriteCount === 0) return;

        const gl = this.gl;

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
        gl.uniform1i(this.uImage, 0);

        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertices.subarray(0, this.spriteCount * 4 * this.vertexSize));

        gl.drawElements(gl.TRIANGLES, this.spriteCount * 6, gl.UNSIGNED_SHORT, 0);

        this.spriteCount = 0;
    }

    getTexture(image) {
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

    render(options) {
        let texture;
        let u0 = 0.0, v0 = 0.0, u1 = 1.0, v1 = 1.0;

        if (options.shape) {
            const textureInfo = this.shapeCache.getTextureInfo(options.shape);
            texture = textureInfo.texture;
            u0 = textureInfo.u0;
            v0 = textureInfo.v0;
            u1 = textureInfo.u1;
            v1 = textureInfo.v1;
        } else if (options.image) {
            texture = this.getTexture(options.image);
        } else {
            return;
        }

        if (this.currentTexture !== texture || this.spriteCount >= this.maxSprites) {
            this.flush();
            this.currentTexture = texture;
        }

        let r = 1, g = 1, b = 1, a = 1;
        if (options.fill) {
            if (typeof options.fill === "string") {
                const cachedColor = this.getCachedColor(options.fill);
                r = cachedColor[0];
                g = cachedColor[1];
                b = cachedColor[2];
                a = cachedColor[3];
            } else {
                const rgb = colorUtil().cssToRgb(options.fill);
                r = rgb.r / 255;
                g = rgb.g / 255;
                b = rgb.b / 255;
                a = rgb.a;
            }
        }
        if (options.alpha !== undefined) {
            a *= options.alpha;
        }

        const geom = ShapeGeometryBuilder.buildInto(options, this.geometryBuffer);

        const i = this.spriteCount * 4 * this.vertexSize;
        const v = this.vertices;

        v[i] = geom[0]; v[i + 1] = geom[1]; v[i + 2] = u0; v[i + 3] = v0;
        v[i + 4] = r; v[i + 5] = g; v[i + 6] = b; v[i + 7] = a;

        v[i + 8] = geom[2]; v[i + 9] = geom[3]; v[i + 10] = u1; v[i + 11] = v0;
        v[i + 12] = r; v[i + 13] = g; v[i + 14] = b; v[i + 15] = a;

        v[i + 16] = geom[4]; v[i + 17] = geom[5]; v[i + 18] = u1; v[i + 19] = v1;
        v[i + 20] = r; v[i + 21] = g; v[i + 22] = b; v[i + 23] = a;

        v[i + 24] = geom[6]; v[i + 25] = geom[7]; v[i + 26] = u0; v[i + 27] = v1;
        v[i + 28] = r; v[i + 29] = g; v[i + 30] = b; v[i + 31] = a;

        this.spriteCount++;
    }
}

/**
 * @class WebGLHandler
 * @description WebGL 레이어별 배치를 초기화하고 프레임 단위로 clear/render/flush를 관리합니다.
 */
export class WebGLHandler {
    /**
     * @param {Object.<string, WebGLRenderingContext>} glContexts - WebGL 컨텍스트 객체
     */
    constructor(glContexts) {
        this.glContexts = glContexts;
        this.batches = {};
        this.width = 0;
        this.height = 0;
        this.backgroundColor = [...WEBGL_CONSTANTS.DEFAULT_BACKGROUND_COLOR];

        this.init();
    }

    init() {
        for (const layerName in this.glContexts) {
            const gl = this.glContexts[layerName];
            if (!gl) {
                console.error(`WebGL Context not found for layer: ${layerName}`);
                continue;
            }

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            this.batches[layerName] = new WebGLBatch(gl);
        }
    }

    setBackgroundColor(r, g, b) {
        this.backgroundColor = [r, g, b, 1.0];
    }

    clearAll() {
        for (const layerName in this.glContexts) {
            const gl = this.glContexts[layerName];
            if (!gl) continue;

            if (layerName === 'background') {
                gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], this.backgroundColor[3]);
            } else {
                gl.clearColor(0.0, 0.0, 0.0, 0.0);
            }

            gl.clear(gl.COLOR_BUFFER_BIT);

            if (this.batches[layerName] && this.width > 0 && this.height > 0) {
                this.batches[layerName].begin(this.width, this.height);
            }
        }
    }

    flushAll() {
        for (const layerName in this.batches) {
            this.batches[layerName].flush();
        }
    }

    resize(width, height) {
        this.width = width;
        this.height = height;

        for (const layerName in this.glContexts) {
            const gl = this.glContexts[layerName];
            if (gl) {
                gl.viewport(0, 0, width, height);
            }
        }
    }

    render(layerName, options) {
        const batch = this.batches[layerName];
        if (batch) {
            batch.render(options);
        }
    }
}
