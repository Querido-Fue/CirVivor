import { getCanvas } from 'display/display_system.js';
import { compileShader, createProgram } from 'display/webgl/_shader_utils.js';
import { getDelta } from 'game/time_handler.js';
import { ColorSchemes } from 'display/_theme_handler.js';
import { colorUtil } from 'util/color_util.js';

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
        this.positionBuffer = null;
        this.aPosition = -1;
        this.uTime = null;
        this.uResolution = null;
        this.uColors = null;
        this.elapsed = 0;
        this.width = 1;
        this.height = 1;
        this.cachedPaletteSignature = '';
        this.colorData = new Float32Array(TITLE_GRADIENT_COLOR_COUNT * 3);

        this.#init();
    }

    /**
     * 프레임 시간에 맞춰 내부 시간 축을 갱신합니다.
     */
    update() {
        const delta = getDelta();
        if (!Number.isFinite(delta) || delta <= 0) {
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

        this.#syncResolution();
        this.#syncThemeColors();

        const gl = this.gl;

        gl.disable(gl.BLEND);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.viewport(0, 0, this.width, this.height);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.uniform1f(this.uTime, this.elapsed);
        gl.uniform2f(this.uResolution, this.width, this.height);
        gl.uniform3fv(this.uColors, this.colorData);
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

        if (!vertexShader || !fragmentShader) {
            if (vertexShader) {
                this.gl.deleteShader(vertexShader);
            }
            if (fragmentShader) {
                this.gl.deleteShader(fragmentShader);
            }
            return;
        }

        this.program = createProgram(this.gl, vertexShader, fragmentShader);
        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);

        if (!this.program) {
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
        this.uTime = this.gl.getUniformLocation(this.program, 'uTime');
        this.uResolution = this.gl.getUniformLocation(this.program, 'uResolution');
        this.uColors = this.gl.getUniformLocation(this.program, 'uColors');

        this.#syncResolution();
        this.#syncThemeColors();
    }

    /**
     * 현재 배경 캔버스 해상도를 내부 상태에 반영합니다.
     * @private
     */
    #syncResolution() {
        if (!this.canvas) {
            return;
        }

        this.width = Math.max(1, this.canvas.width || 1);
        this.height = Math.max(1, this.canvas.height || 1);
    }

    /**
     * 현재 테마의 타이틀 그라디언트 팔레트를 uniform 데이터로 변환합니다.
     * @private
     */
    #syncThemeColors() {
        const gradientColors = this.#resolveGradientColors();
        const paletteSignature = gradientColors.join('|');

        if (paletteSignature === this.cachedPaletteSignature) {
            return;
        }

        const util = colorUtil();
        for (let index = 0; index < TITLE_GRADIENT_COLOR_COUNT; index++) {
            const rgb = util
                ? util.cssToRgb(gradientColors[index])
                : { r: 0, g: 0, b: 0 };
            const baseIndex = index * 3;

            this.colorData[baseIndex] = rgb.r / 255;
            this.colorData[baseIndex + 1] = rgb.g / 255;
            this.colorData[baseIndex + 2] = rgb.b / 255;
        }

        this.cachedPaletteSignature = paletteSignature;
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

        const fallbackColor = ColorSchemes?.Title?.Background || ColorSchemes?.Background;
        if (typeof fallbackColor === 'string' && fallbackColor) {
            return Array(TITLE_GRADIENT_COLOR_COUNT).fill(fallbackColor);
        }
        return [];
    }
}
