import { getData } from 'data/data_handler.js';
import { clamp01 } from 'util/number_util.js';
import {
    COMPOSITE_TEXTURE_FRAGMENT_SHADER,
    compileShader,
    createProgram,
    FULLSCREEN_VERTEX_SHADER,
    KAWASE_DOWNSAMPLE_FRAGMENT_SHADER,
    KAWASE_UPSAMPLE_FRAGMENT_SHADER,
    TITLE_LOADING_CIRCLE_FRAGMENT_SHADER
} from './_shader_utils.js';

const OVERLAY_RENDER_CONSTANTS = getData('OVERLAY_RENDER_CONSTANTS');
const TITLE_LOADING = getData('TITLE_CONSTANTS').TITLE_LOADING;
const DEFAULT_CIRCLE_SHADER_COLORS = TITLE_LOADING.CIRCLE_SHADER.COLORS;

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
        this.width = 0;
        this.height = 0;
        this.sceneTarget = null;
        this.sceneTexture = null;
        this.sourceTexture = null;
        this.finalBlurTexture = null;
        this.emptyTexture = null;
        this.downTargets = [];
        this.upTargets = [];
        this.compositeProgram = this.#createAuxiliaryProgramInfo(COMPOSITE_TEXTURE_FRAGMENT_SHADER, [
            'u_texture',
            'u_opacity'
        ]);
        this.downsampleProgram = this.#createAuxiliaryProgramInfo(KAWASE_DOWNSAMPLE_FRAGMENT_SHADER, [
            'u_texture',
            'u_texelSize',
            'u_offset'
        ]);
        this.upsampleProgram = this.#createAuxiliaryProgramInfo(KAWASE_UPSAMPLE_FRAGMENT_SHADER, [
            'u_texture',
            'u_texelSize',
            'u_offset'
        ]);
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
        const alpha = Number.isFinite(command.alpha) ? clamp01(command.alpha) : 1;
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

        const blurTexture = this.#prepareBackdropBlur(command, renderWidth, renderHeight);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, renderWidth, renderHeight);
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
        gl.uniform1f(
            this.programInfo.uniforms.u_brightnessBoost,
            Number.isFinite(command.brightnessBoost) ? Math.max(0, command.brightnessBoost) : 0.08
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, blurTexture || this.#getEmptyTexture());
        gl.uniform1i(this.programInfo.uniforms.u_backdropBlurTexture, 0);
        gl.uniform1f(this.programInfo.uniforms.u_hasBackdropBlurTexture, blurTexture ? 1 : 0);
        gl.uniform1f(
            this.programInfo.uniforms.u_bodyRadiusExpandOutlineRatio,
            Number.isFinite(command.bodyRadiusExpandOutlineRatio)
                ? Math.max(0, command.bodyRadiusExpandOutlineRatio)
                : 0.38
        );
        gl.uniform1f(
            this.programInfo.uniforms.u_backdropBlurStrength,
            Number.isFinite(command.backdropBlurStrength) ? Math.max(0, command.backdropBlurStrength) : 0.16
        );
        gl.uniform1f(
            this.programInfo.uniforms.u_backdropRefractionStrength,
            Number.isFinite(command.backdropRefractionStrength) ? Math.max(0, command.backdropRefractionStrength) : 4.5
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

        this.#destroyTargets(this.downTargets);
        this.#destroyTargets(this.upTargets);
        this.downTargets = [];
        this.upTargets = [];

        if (this.sceneTarget) {
            this.#destroyTargets([this.sceneTarget]);
            this.sceneTarget = null;
            this.sceneTexture = null;
        }

        if (this.sourceTexture) {
            this.gl.deleteTexture(this.sourceTexture);
            this.sourceTexture = null;
        }

        if (this.emptyTexture) {
            this.gl.deleteTexture(this.emptyTexture);
            this.emptyTexture = null;
        }

        if (this.programInfo?.program) {
            this.gl.deleteProgram(this.programInfo.program);
            this.programInfo = null;
        }

        this.#deleteProgramInfo(this.compositeProgram);
        this.#deleteProgramInfo(this.downsampleProgram);
        this.#deleteProgramInfo(this.upsampleProgram);
        this.compositeProgram = null;
        this.downsampleProgram = null;
        this.upsampleProgram = null;
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
                u_brightnessBoost: gl.getUniformLocation(program, 'u_brightnessBoost'),
                u_backdropBlurTexture: gl.getUniformLocation(program, 'u_backdropBlurTexture'),
                u_hasBackdropBlurTexture: gl.getUniformLocation(program, 'u_hasBackdropBlurTexture'),
                u_bodyRadiusExpandOutlineRatio: gl.getUniformLocation(program, 'u_bodyRadiusExpandOutlineRatio'),
                u_backdropBlurStrength: gl.getUniformLocation(program, 'u_backdropBlurStrength'),
                u_backdropRefractionStrength: gl.getUniformLocation(program, 'u_backdropRefractionStrength'),
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
     * 보조 fullscreen pass 프로그램 정보를 생성합니다.
     * @param {string} fragmentSource - 프래그먼트 셰이더 소스입니다.
     * @param {string[]} uniformNames - 조회할 uniform 이름 목록입니다.
     * @returns {{program: WebGLProgram, uniforms: Object.<string, WebGLUniformLocation>, attributes: Object.<string, number>}|null} 프로그램 정보입니다.
     * @private
     */
    #createAuxiliaryProgramInfo(fragmentSource, uniformNames) {
        const gl = this.gl;
        const vertexShader = compileShader(gl, FULLSCREEN_VERTEX_SHADER, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
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
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        if (!program) {
            return null;
        }

        const uniforms = {};
        for (const uniformName of uniformNames) {
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }

        return {
            program,
            uniforms,
            attributes: {
                a_position: gl.getAttribLocation(program, 'a_position')
            }
        };
    }

    /**
     * 프로그램 리소스를 해제합니다.
     * @param {{program: WebGLProgram}|null|undefined} programInfo - 해제할 프로그램 정보입니다.
     * @private
     */
    #deleteProgramInfo(programInfo) {
        if (programInfo?.program) {
            this.gl.deleteProgram(programInfo.program);
        }
    }

    /**
     * 메뉴 glass 패널과 동일한 Kawase blur 텍스처를 준비합니다.
     * @param {object} command - 렌더링 명령입니다.
     * @param {number} width - 렌더 타깃 너비입니다.
     * @param {number} height - 렌더 타깃 높이입니다.
     * @returns {WebGLTexture|null} blur 결과 텍스처입니다.
     * @private
     */
    #prepareBackdropBlur(command, width, height) {
        if (
            !this.compositeProgram?.program
            || !this.downsampleProgram?.program
            || !this.upsampleProgram?.program
            || !(Number.isFinite(command.backdropBlurStrength) ? command.backdropBlurStrength > 0 : true)
        ) {
            return null;
        }

        const sources = Array.isArray(command.blurSourceCanvases)
            ? command.blurSourceCanvases
            : [];
        if (sources.length === 0) {
            return null;
        }

        this.#resizeBlurTargets(width, height);
        if (!this.sceneTarget || !this.sceneTexture) {
            return null;
        }

        if (!this.#captureBlurSources(sources)) {
            return null;
        }

        this.#runKawaseBlur(Number.isFinite(command.backdropBlur) ? Math.max(0, command.backdropBlur) : 0.1);
        return this.finalBlurTexture || this.sceneTexture;
    }

    /**
     * 하위 WebGL 캔버스들을 blur scene target에 합성합니다.
     * @param {HTMLCanvasElement[]} sources - 합성할 캔버스 목록입니다.
     * @returns {boolean} 하나 이상의 캔버스를 합성했는지 여부입니다.
     * @private
     */
    #captureBlurSources(sources) {
        const gl = this.gl;
        let captured = false;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        for (const canvas of sources) {
            if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
                continue;
            }

            if (!this.#uploadSourceCanvas(canvas)) {
                continue;
            }

            this.#drawCompositeTexturePass(1);
            captured = true;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return captured;
    }

    /**
     * 현재 source canvas를 재사용 텍스처에 업로드합니다.
     * @param {HTMLCanvasElement} canvas - 업로드할 캔버스입니다.
     * @returns {boolean} 업로드 성공 여부입니다.
     * @private
     */
    #uploadSourceCanvas(canvas) {
        const gl = this.gl;
        if (!this.sourceTexture) {
            this.sourceTexture = this.#createTexture(Math.max(1, canvas.width), Math.max(1, canvas.height));
        }

        this.#flushSourceCanvas(canvas);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        try {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            return true;
        } catch {
            return false;
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
    }

    /**
     * 다른 WebGL 레이어 캔버스를 텍스처로 읽기 전에 대기 중인 렌더 명령을 제출합니다.
     * @param {HTMLCanvasElement} canvas - 읽어올 소스 캔버스입니다.
     * @private
     */
    #flushSourceCanvas(canvas) {
        if (typeof canvas?.getContext !== 'function') {
            return;
        }

        const sourceContext = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (sourceContext && typeof sourceContext.flush === 'function') {
            sourceContext.flush();
        }
    }

    /**
     * 업로드된 source texture를 scene target에 합성합니다.
     * @param {number} opacity - 적용할 투명도입니다.
     * @private
     */
    #drawCompositeTexturePass(opacity) {
        const gl = this.gl;
        gl.useProgram(this.compositeProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.compositeProgram.attributes.a_position);
        gl.vertexAttribPointer(this.compositeProgram.attributes.a_position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.uniform1i(this.compositeProgram.uniforms.u_texture, 0);
        gl.uniform1f(this.compositeProgram.uniforms.u_opacity, opacity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * downsample/upsample 다중 패스로 blur 텍스처를 생성합니다.
     * @param {number} blur - blur 강도입니다.
     * @private
     */
    #runKawaseBlur(blur) {
        const gl = this.gl;
        if (this.downTargets.length === 0 || blur <= 0) {
            this.finalBlurTexture = this.sceneTexture;
            return;
        }

        let readTexture = this.sceneTexture;
        let readWidth = this.width;
        let readHeight = this.height;
        const blurScale = Math.max(0.5, blur / 8);

        for (let index = 0; index < this.downTargets.length; index++) {
            const target = this.downTargets[index];
            this.#drawFullscreenPass({
                programInfo: this.downsampleProgram,
                sourceTexture: readTexture,
                sourceWidth: readWidth,
                sourceHeight: readHeight,
                target,
                offset: (index + 1) * blurScale
            });
            readTexture = target.texture;
            readWidth = target.width;
            readHeight = target.height;
        }

        let currentTexture = readTexture;
        let currentWidth = readWidth;
        let currentHeight = readHeight;

        for (let index = this.upTargets.length - 1; index >= 0; index--) {
            const target = this.upTargets[index];
            this.#drawFullscreenPass({
                programInfo: this.upsampleProgram,
                sourceTexture: currentTexture,
                sourceWidth: currentWidth,
                sourceHeight: currentHeight,
                target,
                offset: (index + 1) * blurScale
            });
            currentTexture = target.texture;
            currentWidth = target.width;
            currentHeight = target.height;
        }

        this.finalBlurTexture = currentTexture;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * fullscreen blur pass 하나를 실행합니다.
     * @param {object} options - pass 옵션입니다.
     * @private
     */
    #drawFullscreenPass({ programInfo, sourceTexture, sourceWidth, sourceHeight, target, offset }) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.useProgram(programInfo.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(programInfo.attributes.a_position);
        gl.vertexAttribPointer(programInfo.attributes.a_position, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(programInfo.uniforms.u_texture, 0);
        gl.uniform2f(programInfo.uniforms.u_texelSize, 1 / Math.max(1, sourceWidth), 1 / Math.max(1, sourceHeight));
        gl.uniform1f(programInfo.uniforms.u_offset, offset);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * blur용 렌더 타깃 크기를 현재 화면에 맞춥니다.
     * @param {number} width - 렌더 타깃 너비입니다.
     * @param {number} height - 렌더 타깃 높이입니다.
     * @private
     */
    #resizeBlurTargets(width, height) {
        const nextWidth = Math.max(1, Math.floor(width));
        const nextHeight = Math.max(1, Math.floor(height));
        if (this.width === nextWidth && this.height === nextHeight && this.sceneTarget) {
            return;
        }

        this.width = nextWidth;
        this.height = nextHeight;
        this.#destroyTargets(this.downTargets);
        this.#destroyTargets(this.upTargets);
        this.downTargets = [];
        this.upTargets = [];

        if (this.sceneTarget) {
            this.#destroyTargets([this.sceneTarget]);
        }

        this.sceneTarget = this.#createRenderTarget(this.width, this.height);
        this.sceneTexture = this.sceneTarget.texture;
        this.finalBlurTexture = null;

        let levelWidth = this.width;
        let levelHeight = this.height;
        const maxPasses = Math.min(
            OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_DOWN_PASSES,
            OVERLAY_RENDER_CONSTANTS.KAWASE_DEFAULT_UP_PASSES
        );

        for (let passIndex = 0; passIndex < maxPasses; passIndex++) {
            levelWidth = Math.max(OVERLAY_RENDER_CONSTANTS.KAWASE_MIN_SIZE, Math.floor(levelWidth * 0.5));
            levelHeight = Math.max(OVERLAY_RENDER_CONSTANTS.KAWASE_MIN_SIZE, Math.floor(levelHeight * 0.5));
            this.downTargets.push(this.#createRenderTarget(levelWidth, levelHeight));
        }

        for (let passIndex = this.downTargets.length - 2; passIndex >= 0; passIndex--) {
            this.upTargets.push(this.#createRenderTarget(this.downTargets[passIndex].width, this.downTargets[passIndex].height));
        }

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    /**
     * 렌더 타깃 배열을 정리합니다.
     * @param {Array<{texture: WebGLTexture, framebuffer: WebGLFramebuffer}>} targets - 정리할 타깃 목록입니다.
     * @private
     */
    #destroyTargets(targets) {
        const gl = this.gl;
        for (const target of targets) {
            if (target?.texture) {
                gl.deleteTexture(target.texture);
            }
            if (target?.framebuffer) {
                gl.deleteFramebuffer(target.framebuffer);
            }
        }
    }

    /**
     * 텍스처 하나를 생성합니다.
     * @param {number} width - 텍스처 너비입니다.
     * @param {number} height - 텍스처 높이입니다.
     * @returns {WebGLTexture} 생성된 텍스처입니다.
     * @private
     */
    #createTexture(width, height) {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Math.max(1, width), Math.max(1, height), 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return texture;
    }

    /**
     * 렌더 타깃 하나를 생성합니다.
     * @param {number} width - 너비입니다.
     * @param {number} height - 높이입니다.
     * @returns {{texture: WebGLTexture, framebuffer: WebGLFramebuffer, width: number, height: number}} 렌더 타깃입니다.
     * @private
     */
    #createRenderTarget(width, height) {
        const gl = this.gl;
        const texture = this.#createTexture(width, height);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        return { texture, framebuffer, width, height };
    }

    /**
     * blur 샘플링 비활성 시 사용할 투명 텍스처를 반환합니다.
     * @returns {WebGLTexture} 1x1 투명 텍스처입니다.
     * @private
     */
    #getEmptyTexture() {
        if (this.emptyTexture) {
            return this.emptyTexture;
        }

        const gl = this.gl;
        this.emptyTexture = this.#createTexture(1, 1);
        gl.bindTexture(gl.TEXTURE_2D, this.emptyTexture);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 0])
        );
        return this.emptyTexture;
    }

    /**
     * 셰이더 색상 uniform을 업로드합니다.
     * @param {{base:number[], deep:number[], rim:number[], highlight:number[], surface:number[]}|undefined} colors - 색상 벡터 묶음입니다.
     * @private
     */
    #uploadColors(colors) {
        const gl = this.gl;
        gl.uniform3fv(this.programInfo.uniforms.u_baseColor, colors?.base || DEFAULT_CIRCLE_SHADER_COLORS.base);
        gl.uniform3fv(this.programInfo.uniforms.u_deepColor, colors?.deep || DEFAULT_CIRCLE_SHADER_COLORS.deep);
        gl.uniform3fv(this.programInfo.uniforms.u_rimColor, colors?.rim || DEFAULT_CIRCLE_SHADER_COLORS.rim);
        gl.uniform3fv(this.programInfo.uniforms.u_highlightColor, colors?.highlight || DEFAULT_CIRCLE_SHADER_COLORS.highlight);
        gl.uniform3fv(this.programInfo.uniforms.u_surfaceColor, colors?.surface || DEFAULT_CIRCLE_SHADER_COLORS.surface);
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
