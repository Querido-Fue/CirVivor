import {
    compileShader,
    createProgram,
    FULLSCREEN_VERTEX_SHADER,
    TITLE_LOADING_CIRCLE_FRAGMENT_SHADER
} from './_shader_utils.js';

const DEFAULT_BASE_COLOR = Object.freeze([0.086, 0.435, 0.984]);
const DEFAULT_DEEP_COLOR = Object.freeze([0.016, 0.176, 0.62]);
const DEFAULT_RIM_COLOR = Object.freeze([0.4, 0.737, 1]);
const DEFAULT_HIGHLIGHT_COLOR = Object.freeze([0.94, 0.99, 1]);
const DEFAULT_SURFACE_COLOR = Object.freeze([0.84, 0.973, 1]);

/**
 * @class TitleLoadingCircleEffectPass
 * @description 타이틀 로딩 원형 UI를 WebGL 셰이더로 렌더링합니다.
 */
export class TitleLoadingCircleEffectPass {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.programInfo = this.#createProgramInfo();
        this.fullscreenBuffer = this.#createFullscreenBuffer();
    }

    /**
     * 타이틀 로딩 원형 명령 하나를 렌더링합니다.
     * @param {object} command - 렌더링 명령입니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    draw(command, width, height) {
        if (!command || !Number.isFinite(command.radius) || command.radius <= 0 || !this.programInfo?.program) {
            return;
        }

        const gl = this.gl;
        const renderWidth = Math.max(1, gl.drawingBufferWidth || width);
        const renderHeight = Math.max(1, gl.drawingBufferHeight || height);
        const centerX = Number.isFinite(command.x) ? command.x : 0;
        const centerY = Number.isFinite(command.y) ? command.y : 0;
        const radius = Math.max(1, command.radius);
        const outlineWidth = Number.isFinite(command.outlineWidth)
            ? Math.max(1, command.outlineWidth)
            : Math.max(1, radius * 0.025);
        const alpha = Number.isFinite(command.alpha) ? Math.max(0, Math.min(1, command.alpha)) : 1;
        const scissorPadding = Math.max(
            Number.isFinite(command.scissorPaddingMin) ? command.scissorPaddingMin : 28,
            radius * (Number.isFinite(command.scissorPaddingRatio) ? Math.max(0, command.scissorPaddingRatio) : 0.86)
        );
        const scissorRect = this.#buildScissorRect(
            centerX,
            centerY,
            radius + scissorPadding + (outlineWidth * 4),
            renderWidth,
            renderHeight
        );
        if (!scissorRect || alpha <= 0) {
            return;
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.useProgram(this.programInfo.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.programInfo.attributes.a_position);
        gl.vertexAttribPointer(this.programInfo.attributes.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.programInfo.uniforms.u_resolution, renderWidth, renderHeight);
        gl.uniform2f(this.programInfo.uniforms.u_center, centerX, centerY);
        gl.uniform1f(this.programInfo.uniforms.u_radius, radius);
        gl.uniform1f(this.programInfo.uniforms.u_progress, Number.isFinite(command.progress) ? command.progress : 0);
        gl.uniform1f(this.programInfo.uniforms.u_outlineWidth, outlineWidth);
        gl.uniform1f(this.programInfo.uniforms.u_wavePhase, Number.isFinite(command.wavePhase) ? command.wavePhase : 0);
        gl.uniform1f(
            this.programInfo.uniforms.u_secondaryWavePhase,
            Number.isFinite(command.secondaryWavePhase) ? command.secondaryWavePhase : 0
        );
        gl.uniform1f(this.programInfo.uniforms.u_time, Number.isFinite(command.time) ? command.time : 0);
        gl.uniform1f(this.programInfo.uniforms.u_alpha, alpha);
        gl.uniform1f(
            this.programInfo.uniforms.u_glowStrength,
            Number.isFinite(command.glowStrength) ? Math.max(0, command.glowStrength) : 0.24
        );
        gl.uniform1f(
            this.programInfo.uniforms.u_glassStrength,
            Number.isFinite(command.glassStrength) ? Math.max(0, command.glassStrength) : 0.72
        );
        this.#uploadColors(command.colors);

        this.#applyScissorRect(scissorRect, renderHeight);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.SCISSOR_TEST);
    }

    /**
     * GL 리소스를 해제합니다.
     */
    destroy() {
        if (this.fullscreenBuffer) {
            this.gl.deleteBuffer(this.fullscreenBuffer);
            this.fullscreenBuffer = null;
        }

        if (this.programInfo?.program) {
            this.gl.deleteProgram(this.programInfo.program);
            this.programInfo = null;
        }
    }

    /**
     * @private
     * @returns {{program: WebGLProgram, uniforms: Object.<string, WebGLUniformLocation>, attributes: Object.<string, number>}|null}
     */
    #createProgramInfo() {
        const gl = this.gl;
        const vertexShader = compileShader(gl, FULLSCREEN_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, TITLE_LOADING_CIRCLE_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
        if (!vertexShader || !fragmentShader) {
            if (vertexShader) {
                gl.deleteShader(vertexShader);
            }
            if (fragmentShader) {
                gl.deleteShader(fragmentShader);
            }
            return null;
        }

        const program = createProgram(gl, vertexShader, fragmentShader);

        if (vertexShader) {
            gl.deleteShader(vertexShader);
        }
        if (fragmentShader) {
            gl.deleteShader(fragmentShader);
        }
        if (!program) {
            return null;
        }

        return {
            program,
            uniforms: {
                u_resolution: gl.getUniformLocation(program, 'u_resolution'),
                u_center: gl.getUniformLocation(program, 'u_center'),
                u_radius: gl.getUniformLocation(program, 'u_radius'),
                u_progress: gl.getUniformLocation(program, 'u_progress'),
                u_outlineWidth: gl.getUniformLocation(program, 'u_outlineWidth'),
                u_wavePhase: gl.getUniformLocation(program, 'u_wavePhase'),
                u_secondaryWavePhase: gl.getUniformLocation(program, 'u_secondaryWavePhase'),
                u_time: gl.getUniformLocation(program, 'u_time'),
                u_alpha: gl.getUniformLocation(program, 'u_alpha'),
                u_glowStrength: gl.getUniformLocation(program, 'u_glowStrength'),
                u_glassStrength: gl.getUniformLocation(program, 'u_glassStrength'),
                u_baseColor: gl.getUniformLocation(program, 'u_baseColor'),
                u_deepColor: gl.getUniformLocation(program, 'u_deepColor'),
                u_rimColor: gl.getUniformLocation(program, 'u_rimColor'),
                u_highlightColor: gl.getUniformLocation(program, 'u_highlightColor'),
                u_surfaceColor: gl.getUniformLocation(program, 'u_surfaceColor')
            },
            attributes: {
                a_position: gl.getAttribLocation(program, 'a_position')
            }
        };
    }

    /**
     * @private
     * @returns {WebGLBuffer} 풀스크린 쿼드 버퍼입니다.
     */
    #createFullscreenBuffer() {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]), gl.STATIC_DRAW);
        return buffer;
    }

    /**
     * 셰이더 색상 uniform을 업로드합니다.
     * @param {{base:number[], deep:number[], rim:number[], highlight:number[], surface:number[]}|undefined} colors - 색상 벡터 묶음입니다.
     * @private
     */
    #uploadColors(colors) {
        const gl = this.gl;
        gl.uniform3fv(this.programInfo.uniforms.u_baseColor, colors?.base || DEFAULT_BASE_COLOR);
        gl.uniform3fv(this.programInfo.uniforms.u_deepColor, colors?.deep || DEFAULT_DEEP_COLOR);
        gl.uniform3fv(this.programInfo.uniforms.u_rimColor, colors?.rim || DEFAULT_RIM_COLOR);
        gl.uniform3fv(this.programInfo.uniforms.u_highlightColor, colors?.highlight || DEFAULT_HIGHLIGHT_COLOR);
        gl.uniform3fv(this.programInfo.uniforms.u_surfaceColor, colors?.surface || DEFAULT_SURFACE_COLOR);
    }

    /**
     * 실제로 보일 수 있는 화면 영역을 scissor 사각형으로 계산합니다.
     * @param {number} centerX - 중심 X 좌표입니다.
     * @param {number} centerY - 중심 Y 좌표입니다.
     * @param {number} boundsRadius - 렌더링 경계 반경입니다.
     * @param {number} width - 렌더 타깃 너비입니다.
     * @param {number} height - 렌더 타깃 높이입니다.
     * @returns {{x:number, y:number, w:number, h:number}|null} scissor 사각형입니다.
     * @private
     */
    #buildScissorRect(centerX, centerY, boundsRadius, width, height) {
        if (!(Number.isFinite(boundsRadius) && boundsRadius > 0)) {
            return null;
        }

        const left = Math.max(0, Math.floor(centerX - boundsRadius));
        const top = Math.max(0, Math.floor(centerY - boundsRadius));
        const right = Math.min(width, Math.ceil(centerX + boundsRadius));
        const bottom = Math.min(height, Math.ceil(centerY + boundsRadius));
        const rectWidth = right - left;
        const rectHeight = bottom - top;
        if (rectWidth <= 0 || rectHeight <= 0) {
            return null;
        }

        return {
            x: left,
            y: top,
            w: rectWidth,
            h: rectHeight
        };
    }

    /**
     * WebGL 하단 원점 좌표계에 맞춰 scissor 영역을 적용합니다.
     * @param {{x:number, y:number, w:number, h:number}} rect - 상단 원점 기준 scissor 영역입니다.
     * @param {number} renderHeight - 렌더 타깃 높이입니다.
     * @private
     */
    #applyScissorRect(rect, renderHeight) {
        const gl = this.gl;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(
            rect.x,
            Math.max(0, renderHeight - rect.y - rect.h),
            rect.w,
            rect.h
        );
    }
}
