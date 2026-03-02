import { compileShader, createProgram, DEFAULT_VERTEX_SHADER, DEFAULT_FRAGMENT_SHADER } from "./_shader_utils.js";
import { GLOBAL_CONSTANTS } from "data/global/global_constants.js";
import { colorUtil } from "util/color_util.js";
import { ShapeGeometryBuilder } from "./_shape_geometry_builder.js";

/**
 * @class ShapeTextureCache
 * @description 도형을 오프스크린 캔버스에 그려 텍스처로 캐싱합니다.
 */
class ShapeTextureCache {
    constructor(gl) {
        this.gl = gl;
        this.cache = new Map();
        this.canvas = document.createElement("canvas");
        this.ctx = this.canvas.getContext("2d");
        this.textureSize = 64; // 도형 텍스처 크기
        this.canvas.width = this.textureSize;
        this.canvas.height = this.textureSize;
    }

    getTexture(shape) {
        if (this.cache.has(shape)) {
            return this.cache.get(shape);
        }

        const ctx = this.ctx;
        const size = this.textureSize;
        const half = size / 2;
        const radius = size * 0.45;

        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = "#FFFFFF"; // 흰색으로 그리고 셰이더에서 색상 곱함
        ctx.beginPath();

        switch (shape) {
            case 'rect':
            case 'square':
                ctx.fillRect(0, 0, size, size);
                break;
            case 'circle':
                ctx.arc(half, half, radius, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'triangle':
                this.drawPolygon(ctx, half, half, radius, 3);
                break;
            case 'pentagon':
                this.drawPolygon(ctx, half, half, radius, 5);
                break;
            case 'hexagon':
                this.drawPolygon(ctx, half, half, radius, 6);
                break;
            case 'octagon':
                this.drawPolygon(ctx, half, half, radius, 8);
                break;
            case 'arrow':
                this.drawArrow(ctx, half, half, radius);
                break;
            default:
                ctx.fillRect(0, 0, size, size); // 기본 사각형
                break;
        }

        const texture = this.createTextureFromCanvas();
        this.cache.set(shape, texture);
        return texture;
    }

    drawPolygon(ctx, x, y, radius, sides) {
        const angleStep = (Math.PI * 2) / sides;
        const angleOffset = -Math.PI / 2;
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = angleOffset + i * angleStep;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
    }

    drawArrow(ctx, x, y, radius) {
        // 단순 화살표
        ctx.beginPath();
        ctx.moveTo(x - radius * 0.7, y + radius * 0.7);
        ctx.lineTo(x, y - radius * 0.7);
        ctx.lineTo(x + radius * 0.7, y + radius * 0.7);
        ctx.lineTo(x, y + radius * 0.3);
        ctx.closePath();
        ctx.fill();
    }

    createTextureFromCanvas() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
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
        this.vertexSize = 8; // x, y, u, v, r, g, b, a
        this.vertices = new Float32Array(this.maxSprites * 4 * this.vertexSize);
        this.spriteCount = 0;
        this.currentTexture = null;
        this.textureCache = new Map();
        this.shapeCache = new ShapeTextureCache(gl);

        this.init();
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

        // 이미지 로딩이 완료되었는지 확인 (HTMLImageElement)
        if (image.complete && image.naturalWidth > 0) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        } else {
            // 1x1 투명 텍스처로 대체하고 로드되면 업데이트 (여기서는 단순화)
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        }

        this.textureCache.set(image, texture);
        return texture;
    }

    render(options) {
        let texture;
        if (options.shape) {
            texture = this.shapeCache.getTexture(options.shape);
        } else if (options.image) {
            texture = this.getTexture(options.image);
        } else {
            return;
        }

        if (this.currentTexture !== texture || this.spriteCount >= this.maxSprites) {
            this.flush();
            this.currentTexture = texture;
        }

        const x = options.x;
        const y = options.y;

        let r = 1, g = 1, b = 1, a = 1;
        if (options.fill) {
            const rgb = colorUtil().cssToRgb(options.fill);
            r = rgb.r / 255;
            g = rgb.g / 255;
            b = rgb.b / 255;
            a = rgb.a;
        }
        if (options.alpha !== undefined) {
            a *= options.alpha;
        }

        // 도형 좌표 계산 유틸리티에 위임
        const { x1, y1, x2, y2, x3, y3, x4, y4 } = ShapeGeometryBuilder.build(options);

        const i = this.spriteCount * 4 * this.vertexSize;
        const v = this.vertices;

        // 사각형(정점 4개)
        // 정점 순서: 반시계 0-1-2 / 0-2-3

        // 정점 0 (좌상단)
        v[i] = x1; v[i + 1] = y1; v[i + 2] = 0.0; v[i + 3] = 0.0;
        v[i + 4] = r; v[i + 5] = g; v[i + 6] = b; v[i + 7] = a;

        // 정점 1 (우상단)
        v[i + 8] = x2; v[i + 9] = y2; v[i + 10] = 1.0; v[i + 11] = 0.0;
        v[i + 12] = r; v[i + 13] = g; v[i + 14] = b; v[i + 15] = a;

        // 정점 2 (우하단)
        v[i + 16] = x3; v[i + 17] = y3; v[i + 18] = 1.0; v[i + 19] = 1.0;
        v[i + 20] = r; v[i + 21] = g; v[i + 22] = b; v[i + 23] = a;

        // 정점 3 (좌하단)
        v[i + 24] = x4; v[i + 25] = y4; v[i + 26] = 0.0; v[i + 27] = 1.0;
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
        this.backgroundColor = [0.125, 0.125, 0.125, 1.0]; // 기본값 #202020

        this.init();
    }

    init() {
        for (const layerName in this.glContexts) {
            const gl = this.glContexts[layerName];
            if (!gl) {
                console.error(`WebGL Context not found for layer: ${layerName}`);
                continue;
            }

            // 기본 WebGL 설정
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            this.batches[layerName] = new WebGLBatch(gl);
        }
    }

    setBackgroundColor(r, g, b) {
        this.backgroundColor = [r, g, b, 1.0];
    }

    /**
     * 모든 WebGL 레이어를 지웁니다.
     */
    clearAll() {
        for (const layerName in this.glContexts) {
            const gl = this.glContexts[layerName];
            if (gl) {
                if (layerName === 'background') {
                    gl.clearColor(this.backgroundColor[0], this.backgroundColor[1], this.backgroundColor[2], this.backgroundColor[3]);
                } else {
                    gl.clearColor(0.0, 0.0, 0.0, 0.0);
                }

                gl.clear(gl.COLOR_BUFFER_BIT);

                // 배치 초기화 (begin 호출)
                // 주의: clearAll은 매 프레임 시작 시 호출된다고 가정
                if (this.batches[layerName] && this.width > 0 && this.height > 0) {
                    this.batches[layerName].begin(this.width, this.height);
                }
            }
        }
    }

    /**
     * 프레임 끝에 호출하여 남은 배치를 그립니다.
     */
    flushAll() {
        for (const layerName in this.batches) {
            this.batches[layerName].flush();
        }
    }

    /**
     * 뷰포트 크기를 설정합니다.
     * @param {number} width 
     * @param {number} height 
     */
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

    /**
     * 이미지를 그립니다.
     * @param {string} layerName 
     * @param {object} options 
     */
    render(layerName, options) {
        const batch = this.batches[layerName];
        if (batch) {
            batch.render(options);
        }
    }
}
