import { clamp01 } from 'util/number_util.js';
import {
    compileShader,
    createProgram,
    FULLSCREEN_VERTEX_SHADER,
    HEXA_MERGE_BOUNDARY_FRAGMENT_SHADER
} from './_shader_utils.js';

/**
 * @class HexaMergeBoundaryEffectPass
 * @description 육각형 적 합체 경계면의 WebGL 빛 번짐을 렌더링합니다.
 */
export class HexaMergeBoundaryEffectPass {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.programInfo = this.#createProgramInfo();
        this.fullscreenBuffer = this.#createFullscreenBuffer();
    }

    /**
     * 합체 경계 이펙트 명령 하나를 렌더링합니다.
     * @param {object} command - 렌더링 명령입니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    draw(command, width, height) {
        if (!this.programInfo || !command) {
            return;
        }

        const x1 = Number.isFinite(command.x1) ? command.x1 : 0;
        const y1 = Number.isFinite(command.y1) ? command.y1 : 0;
        const x2 = Number.isFinite(command.x2) ? command.x2 : 0;
        const y2 = Number.isFinite(command.y2) ? command.y2 : 0;
        const segmentLength = Math.hypot(x2 - x1, y2 - y1);
        if (segmentLength <= 0.5) {
            return;
        }

        const gl = this.gl;
        const renderWidth = Math.max(1, gl.drawingBufferWidth || width);
        const renderHeight = Math.max(1, gl.drawingBufferHeight || height);
        const lineWidth = Number.isFinite(command.lineWidth) ? Math.max(0.5, command.lineWidth) : 3;
        const glowWidth = Number.isFinite(command.glowWidth) ? Math.max(lineWidth, command.glowWidth) : 14;
        const scissorRect = this.#buildScissorRect(x1, y1, x2, y2, glowWidth + (lineWidth * 2), renderWidth, renderHeight);
        if (!scissorRect) {
            return;
        }

        gl.useProgram(this.programInfo.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.programInfo.attributes.a_position);
        gl.vertexAttribPointer(this.programInfo.attributes.a_position, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.programInfo.uniforms.u_resolution, renderWidth, renderHeight);
        gl.uniform2f(this.programInfo.uniforms.u_start, x1, y1);
        gl.uniform2f(this.programInfo.uniforms.u_end, x2, y2);
        gl.uniform1f(this.programInfo.uniforms.u_lineWidth, lineWidth);
        gl.uniform1f(this.programInfo.uniforms.u_glowWidth, glowWidth);
        gl.uniform1f(this.programInfo.uniforms.u_progress, Number.isFinite(command.progress) ? clamp01(command.progress) : 0);
        gl.uniform1f(this.programInfo.uniforms.u_time, Number.isFinite(command.time) ? command.time : 0);
        gl.uniform1f(this.programInfo.uniforms.u_alpha, Number.isFinite(command.alpha) ? clamp01(command.alpha) : 1);
        gl.uniform3fv(this.programInfo.uniforms.u_coreColor, command.coreColor || [0.58, 0.96, 1.0]);
        gl.uniform3fv(this.programInfo.uniforms.u_glowColor, command.glowColor || [0.20, 0.66, 1.0]);
        gl.uniform3fv(this.programInfo.uniforms.u_highlightColor, command.highlightColor || [0.98, 1.0, 0.82]);

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
        const fragmentShader = compileShader(gl, HEXA_MERGE_BOUNDARY_FRAGMENT_SHADER, gl.FRAGMENT_SHADER);
        if (!vertexShader || !fragmentShader) {
            return null;
        }

        const program = createProgram(gl, vertexShader, fragmentShader);
        if (!program) {
            return null;
        }

        return {
            program,
            uniforms: {
                u_resolution: gl.getUniformLocation(program, 'u_resolution'),
                u_start: gl.getUniformLocation(program, 'u_start'),
                u_end: gl.getUniformLocation(program, 'u_end'),
                u_lineWidth: gl.getUniformLocation(program, 'u_lineWidth'),
                u_glowWidth: gl.getUniformLocation(program, 'u_glowWidth'),
                u_progress: gl.getUniformLocation(program, 'u_progress'),
                u_time: gl.getUniformLocation(program, 'u_time'),
                u_alpha: gl.getUniformLocation(program, 'u_alpha'),
                u_coreColor: gl.getUniformLocation(program, 'u_coreColor'),
                u_glowColor: gl.getUniformLocation(program, 'u_glowColor'),
                u_highlightColor: gl.getUniformLocation(program, 'u_highlightColor')
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
     * 선분 이펙트가 보일 수 있는 화면 영역을 scissor 사각형으로 계산합니다.
     * @param {number} x1 - 시작 X 좌표입니다.
     * @param {number} y1 - 시작 Y 좌표입니다.
     * @param {number} x2 - 끝 X 좌표입니다.
     * @param {number} y2 - 끝 Y 좌표입니다.
     * @param {number} padding - 이펙트 여백입니다.
     * @param {number} width - 렌더 타깃 너비입니다.
     * @param {number} height - 렌더 타깃 높이입니다.
     * @returns {{x:number, y:number, w:number, h:number}|null} scissor 사각형입니다.
     * @private
     */
    #buildScissorRect(x1, y1, x2, y2, padding, width, height) {
        const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
        const left = Math.max(0, Math.floor(Math.min(x1, x2) - safePadding));
        const top = Math.max(0, Math.floor(Math.min(y1, y2) - safePadding));
        const right = Math.min(width, Math.ceil(Math.max(x1, x2) + safePadding));
        const bottom = Math.min(height, Math.ceil(Math.max(y1, y2) + safePadding));
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
