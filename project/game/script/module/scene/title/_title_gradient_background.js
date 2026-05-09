import { getCanvas } from 'display/display_system.js';
import { compileShader, createProgram } from 'display/webgl/_shader_utils.js';
import { getDelta } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';
import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 타이틀 그라디언트에서 사용하는 색상 개수입니다.
 * @type {number}
 */
const TITLE_GRADIENT_COLOR_COUNT = 5;

/**
 * 시간 누적 값의 래핑 주기입니다.
 * @type {number}
 */
const TITLE_GRADIENT_TIME_WRAP = 4096;

/**
 * 타이틀 그라디언트의 시간 배속입니다.
 * @type {number}
 */
const TITLE_GRADIENT_TIME_SCALE = 1;

/**
 * 테마 색상 조회가 모두 실패했을 때 사용하는 최종 fallback 색상입니다.
 * @type {string}
 */
const TITLE_GRADIENT_FALLBACK_COLOR = '#000000';

/**
 * 타이틀 전용 풀스크린 버텍스 셰이더입니다.
 * @type {string}
 */
const TITLE_GRADIENT_VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
    vUv = (aPosition * 0.5) + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * 타이틀 전용 풀스크린 프래그먼트 셰이더입니다.
 * @type {string}
 */
const TITLE_GRADIENT_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

const int COLOR_COUNT = ${TITLE_GRADIENT_COLOR_COUNT};

varying vec2 vUv;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[COLOR_COUNT];

vec3 toLinear(vec3 color) {
    return pow(color, vec3(2.2));
}

vec3 toGamma(vec3 color) {
    return pow(color, vec3(1.0 / 2.2));
}

float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec2 getPoint(int index, float t) {
    float localTime = t * 0.35;

    if (index == 0) {
        return vec2(
            0.16 + (sin(localTime * 0.92 + 0.2) * 0.10) + (cos(localTime * 0.43 + 1.1) * 0.03),
            0.18 + (cos(localTime * 0.78 + 0.8) * 0.08) + (sin(localTime * 0.31 + 2.2) * 0.03)
        );
    }
    if (index == 1) {
        return vec2(
            0.78 + (cos(localTime * 0.74 + 1.7) * 0.09) + (sin(localTime * 0.36 + 0.5) * 0.04),
            0.20 + (sin(localTime * 0.88 + 1.1) * 0.07) + (cos(localTime * 0.29 + 2.7) * 0.03)
        );
    }
    if (index == 2) {
        return vec2(
            0.24 + (cos(localTime * 0.66 + 2.4) * 0.11) + (sin(localTime * 0.27 + 0.6) * 0.03),
            0.76 + (sin(localTime * 0.72 + 0.4) * 0.09) + (cos(localTime * 0.34 + 1.9) * 0.03)
        );
    }
    if (index == 3) {
        return vec2(
            0.84 + (sin(localTime * 0.61 + 1.3) * 0.10) + (cos(localTime * 0.25 + 2.6) * 0.03),
            0.72 + (cos(localTime * 0.69 + 2.0) * 0.08) + (sin(localTime * 0.33 + 0.7) * 0.03)
        );
    }
    return vec2(
        0.50 + (sin(localTime * 0.84 + 0.9) * 0.08) + (cos(localTime * 0.38 + 2.4) * 0.03),
        0.48 + (cos(localTime * 0.63 + 1.6) * 0.08) + (sin(localTime * 0.24 + 0.1) * 0.03)
    );
}

void main() {
    float aspect = uResolution.x / max(1.0, uResolution.y);
    vec2 uv = vUv;

    vec3 color = vec3(0.0);
    float totalWeight = 0.0;

    for (int index = 0; index < COLOR_COUNT; index++) {
        vec2 point = getPoint(index, uTime);
        vec2 delta = uv - point;
        delta.x *= aspect;

        float dist2 = dot(delta, delta);
        float weight = 1.0 / (0.08 + (dist2 * (5.4 + (float(index) * 0.65))));
        color += toLinear(uColors[index]) * weight;
        totalWeight += weight;
    }

    color /= max(totalWeight, 0.0001);

    vec2 centered = vec2((vUv.x - 0.5) * aspect, vUv.y - 0.5);
    float vignette = smoothstep(1.05, 0.15, length(centered));
    color *= mix(0.9, 1.06, vignette);

    color = toGamma(clamp(color, 0.0, 1.0));
    color += (interleavedGradientNoise(gl_FragCoord.xy) - 0.5) * (0.6 / 255.0);

    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

/**
 * baked 그라디언트 텍스처를 화면에 복사하는 프래그먼트 셰이더입니다.
 * @type {string}
 */
const TITLE_GRADIENT_BLIT_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform sampler2D uTexture;

void main() {
    gl_FragColor = texture2D(uTexture, vUv);
}
`;

/**
 * @class TitleGradientBackground
 * @description 타이틀 화면 전용 풀스크린 WebGL 그라디언트 패스를 관리합니다.
 */
export class TitleGradientBackground {
    /**
     * 타이틀 전용 배경 패스를 생성합니다.
     */
    constructor() {
        this.canvas = getCanvas('background');
        this.gl = this.canvas ? this.canvas.getContext('webgl') : null;
        this.program = null;
        this.blitProgram = null;
        this.positionBuffer = null;
        this.aPosition = -1;
        this.blitAPosition = -1;
        this.uTime = null;
        this.uResolution = null;
        this.uColors = null;
        this.uTexture = null;
        this.elapsed = 0;
        this.width = 1;
        this.height = 1;
        this.cachedPaletteSignature = '';
        this.colorData = new Float32Array(TITLE_GRADIENT_COLOR_COUNT * 3);
        this.bakedTexture = null;
        this.bakeFramebuffer = null;
        this.bakedWidth = 0;
        this.bakedHeight = 0;
        this.bakeDirty = true;

        this.#init();
    }

    /**
     * 프레임 시간에 맞춰 내부 시간 축을 갱신합니다.
     */
    update() {
        const delta = clampFiniteNumber(getDelta(), 0, Infinity, 0);
        if (delta <= 0) {
            return;
        }

        this.elapsed = (this.elapsed + (delta * TITLE_GRADIENT_TIME_SCALE)) % TITLE_GRADIENT_TIME_WRAP;
    }

    /**
     * 화면 크기 변경 시 렌더 타깃 해상도를 다시 읽어옵니다.
     */
    resize() {
        this.#syncResolution();
    }

    /**
     * 현재 테마 색상으로 풀스크린 그라디언트를 렌더링합니다.
     */
    draw() {
        if (!this.gl || !this.program || !this.positionBuffer || this.aPosition < 0) {
            return;
        }

        const resolutionChanged = this.#syncResolution();
        const paletteChanged = this.#syncThemeColors();
        if (resolutionChanged || paletteChanged || !this.bakedTexture) {
            this.bakeDirty = true;
        }

        if (this.bakeDirty) {
            this.#bakeGradientTexture();
        }
        this.#drawBakedTexture();
    }

    /**
     * 다음 draw 시 그라디언트 bake를 다시 수행하도록 표시합니다.
     */
    markDirty() {
        this.bakeDirty = true;
    }

    /**
     * 현재 bake texture가 유효한지 반환합니다.
     * @returns {boolean} bake texture 유효 여부입니다.
     */
    isBakeReady() {
        return Boolean(this.bakedTexture && this.bakedWidth === this.width && this.bakedHeight === this.height);
    }

    /**
     * 현재 bake texture 해상도 정보를 반환합니다.
     * @returns {{width:number, height:number, dirty:boolean}} bake 상태입니다.
     */
    getBakeState() {
        return {
            width: this.bakedWidth,
            height: this.bakedHeight,
            dirty: this.bakeDirty
        };
    }

    /**
     * 현재 테마와 해상도를 FBO texture에 굽습니다.
     * @private
     */
    #bakeGradientTexture() {
        if (!this.#ensureBakeTarget()) {
            return;
        }

        const gl = this.gl;

        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFramebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(this.uTime, this.elapsed);
        gl.uniform2f(this.uResolution, this.width, this.height);
        gl.uniform3fv(this.uColors, this.colorData);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.bakeDirty = false;
    }

    /**
     * baked texture를 현재 배경 surface에 복사합니다.
     * @private
     */
    #drawBakedTexture() {
        if (!this.gl || !this.blitProgram || !this.positionBuffer || this.blitAPosition < 0 || !this.bakedTexture) {
            return;
        }

        const gl = this.gl;

        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.blitProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.blitAPosition);
        gl.vertexAttribPointer(this.blitAPosition, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.bakedTexture);
        gl.uniform1i(this.uTexture, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.enable(gl.BLEND);
    }

    /**
     * 생성한 WebGL 리소스를 해제합니다.
     */
    destroy() {
        if (!this.gl) {
            return;
        }

        if (this.positionBuffer) {
            this.gl.deleteBuffer(this.positionBuffer);
            this.positionBuffer = null;
        }

        if (this.program) {
            this.gl.deleteProgram(this.program);
            this.program = null;
        }
        if (this.blitProgram) {
            this.gl.deleteProgram(this.blitProgram);
            this.blitProgram = null;
        }
        if (this.bakedTexture) {
            this.gl.deleteTexture(this.bakedTexture);
            this.bakedTexture = null;
        }
        if (this.bakeFramebuffer) {
            this.gl.deleteFramebuffer(this.bakeFramebuffer);
            this.bakeFramebuffer = null;
        }
    }

    /**
     * WebGL 프로그램과 정점 버퍼를 초기화합니다.
     * @private
     */
    #init() {
        if (!this.gl) {
            return;
        }

        const vertexShader = compileShader(this.gl, TITLE_GRADIENT_VERTEX_SHADER, this.gl.VERTEX_SHADER);
        const fragmentShader = compileShader(this.gl, TITLE_GRADIENT_FRAGMENT_SHADER, this.gl.FRAGMENT_SHADER);
        const blitFragmentShader = compileShader(this.gl, TITLE_GRADIENT_BLIT_FRAGMENT_SHADER, this.gl.FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader || !blitFragmentShader) {
            if (vertexShader) {
                this.gl.deleteShader(vertexShader);
            }
            if (fragmentShader) {
                this.gl.deleteShader(fragmentShader);
            }
            if (blitFragmentShader) {
                this.gl.deleteShader(blitFragmentShader);
            }
            return;
        }

        this.program = createProgram(this.gl, vertexShader, fragmentShader);
        this.blitProgram = createProgram(this.gl, vertexShader, blitFragmentShader);
        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);
        this.gl.deleteShader(blitFragmentShader);

        if (!this.program || !this.blitProgram) {
            if (this.program) {
                this.gl.deleteProgram(this.program);
                this.program = null;
            }
            if (this.blitProgram) {
                this.gl.deleteProgram(this.blitProgram);
                this.blitProgram = null;
            }
            return;
        }

        this.positionBuffer = this.gl.createBuffer();
        if (!this.positionBuffer) {
            this.gl.deleteProgram(this.program);
            this.program = null;
            return;
        }

        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
        this.gl.bufferData(
            this.gl.ARRAY_BUFFER,
            new Float32Array([
                -1, -1,
                1, -1,
                -1, 1,
                1, 1
            ]),
            this.gl.STATIC_DRAW
        );

        this.aPosition = this.gl.getAttribLocation(this.program, 'aPosition');
        this.blitAPosition = this.gl.getAttribLocation(this.blitProgram, 'aPosition');
        this.uTime = this.gl.getUniformLocation(this.program, 'uTime');
        this.uResolution = this.gl.getUniformLocation(this.program, 'uResolution');
        this.uColors = this.gl.getUniformLocation(this.program, 'uColors');
        this.uTexture = this.gl.getUniformLocation(this.blitProgram, 'uTexture');

        this.#syncResolution();
        this.#syncThemeColors();
    }

    /**
     * 현재 배경 캔버스 해상도를 내부 상태에 반영합니다.
     * @returns {boolean} 해상도가 변경되었는지 여부입니다.
     * @private
     */
    #syncResolution() {
        if (!this.canvas) {
            return false;
        }

        const nextWidth = clampFiniteNumber(Number(this.canvas.width), 1, Infinity, 1);
        const nextHeight = clampFiniteNumber(Number(this.canvas.height), 1, Infinity, 1);
        const changed = nextWidth !== this.width || nextHeight !== this.height;
        this.width = nextWidth;
        this.height = nextHeight;
        if (changed) {
            this.bakeDirty = true;
        }
        return changed;
    }

    /**
     * 현재 테마의 타이틀 그라디언트 팔레트를 uniform 데이터로 변환합니다.
     * @returns {boolean} 팔레트가 변경되었는지 여부입니다.
     * @private
     */
    #syncThemeColors() {
        const gradientColors = this.#resolveGradientColors();
        const paletteSignature = gradientColors.join('|');

        if (paletteSignature === this.cachedPaletteSignature) {
            return false;
        }

        const util = colorUtil();
        for (let index = 0; index < TITLE_GRADIENT_COLOR_COUNT; index++) {
            const rgb = util
                ? util.cssToRgb(gradientColors[index])
                : { r: 0, g: 0, b: 0 };
            const baseIndex = index * 3;

            this.colorData[baseIndex] = clampFiniteNumber(Number(rgb.r), 0, 255, 0) / 255;
            this.colorData[baseIndex + 1] = clampFiniteNumber(Number(rgb.g), 0, 255, 0) / 255;
            this.colorData[baseIndex + 2] = clampFiniteNumber(Number(rgb.b), 0, 255, 0) / 255;
        }

        this.cachedPaletteSignature = paletteSignature;
        this.bakeDirty = true;
        return true;
    }

    /**
     * 현재 해상도에 맞는 bake texture와 framebuffer를 준비합니다.
     * @returns {boolean} bake target 준비 성공 여부입니다.
     * @private
     */
    #ensureBakeTarget() {
        if (!this.gl || this.width <= 0 || this.height <= 0) {
            return false;
        }

        const gl = this.gl;
        if (!this.bakedTexture) {
            this.bakedTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.bakedTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } else {
            gl.bindTexture(gl.TEXTURE_2D, this.bakedTexture);
        }

        if (this.bakedWidth !== this.width || this.bakedHeight !== this.height) {
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                this.width,
                this.height,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                null
            );
            this.bakedWidth = this.width;
            this.bakedHeight = this.height;
        }

        if (!this.bakeFramebuffer) {
            this.bakeFramebuffer = gl.createFramebuffer();
        }
        if (!this.bakeFramebuffer || !this.bakedTexture) {
            return false;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFramebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bakedTexture, 0);
        const ready = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return ready;
    }

    /**
     * 현재 테마에서 사용할 타이틀 그라디언트 색상 목록을 반환합니다.
     * @returns {string[]} 5색 그라디언트 색상 배열
     * @private
     */
    #resolveGradientColors() {
        const themeColors = ColorSchemes?.Title?.Gradient?.Colors;
        if (Array.isArray(themeColors) && themeColors.length >= TITLE_GRADIENT_COLOR_COUNT) {
            return themeColors.slice(0, TITLE_GRADIENT_COLOR_COUNT);
        }

        const themeFallbackColors = ColorSchemes?.Title?.Gradient?.FallbackColors;
        if (Array.isArray(themeFallbackColors) && themeFallbackColors.length >= TITLE_GRADIENT_COLOR_COUNT) {
            return themeFallbackColors.slice(0, TITLE_GRADIENT_COLOR_COUNT);
        }

        const fallbackColor = ColorSchemes?.Title?.Background
            || ColorSchemes?.Background
            || TITLE_GRADIENT_FALLBACK_COLOR;
        return Array(TITLE_GRADIENT_COLOR_COUNT).fill(fallbackColor);
    }
}
