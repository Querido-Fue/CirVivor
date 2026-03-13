import { getData } from 'data/data_handler.js';
import { colorUtil } from 'util/color_util.js';
import {
    COMPOSITE_TEXTURE_FRAGMENT_SHADER,
    compileShader,
    createProgram,
    FULLSCREEN_VERTEX_SHADER,
    GLASS_PANEL_FRAGMENT_SHADER,
    GLASS_PANEL_VERTEX_SHADER,
    KAWASE_DOWNSAMPLE_FRAGMENT_SHADER,
    KAWASE_UPSAMPLE_FRAGMENT_SHADER,
    PANEL_TEXTURE_FRAGMENT_SHADER,
    SHADOW_PANEL_FRAGMENT_SHADER,
    SOLID_COLOR_FRAGMENT_SHADER
} from './_shader_utils.js';

const OVERLAY_RENDER_CONSTANTS = getData('OVERLAY_RENDER_CONSTANTS');

/**
 * @class OverlayEffectRenderer
 * @description transparent overlay 전용 blur 캡처와 glass 패널 합성을 담당합니다.
 */
export class OverlayEffectRenderer {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     */
    constructor(gl) {
        this.gl = gl;
        this.width = 0;
        this.height = 0;
        this.blurDirty = true;
        this.lastBlurRevision = -1;
        this.finalBlurTexture = null;
        this.sceneTexture = null;
        this.sceneTarget = null;
        this.downTargets = [];
        this.upTargets = [];
        this.sourceTexture = null;
        this.panelTexture = null;
        this.emptyTexture = null;

        this.#initPrograms();
        this.#initBuffers();
    }

    /**
     * 렌더 타깃 크기를 갱신합니다.
     * @param {number} width - 새 너비입니다.
     * @param {number} height - 새 높이입니다.
     */
    resize(width, height) {
        const nextWidth = Math.max(1, Math.floor(width));
        const nextHeight = Math.max(1, Math.floor(height));
        if (this.width === nextWidth && this.height === nextHeight) {
            return;
        }

        this.width = nextWidth;
        this.height = nextHeight;

        this.#rebuildTargets();
        this.markBlurDirty();
    }

    /**
     * blur 캐시를 강제로 무효화합니다.
     */
    markBlurDirty() {
        this.blurDirty = true;
    }

    /**
     * 프레임 시작 시 렌더 타깃을 초기화합니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    beginFrame(width, height) {
        this.resize(width, height);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.width, this.height);
        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }

    /**
     * glass 패널 명령을 렌더링합니다.
     * @param {object} command - glass 패널 명령입니다.
     */
    render(command) {
        if (!command || command.shape !== 'glassPanel' || this.width <= 0 || this.height <= 0) {
            return;
        }

        if (command.sampleBackdrop !== false) {
            this.#ensureBlurTexture(command);
        }
        this.#drawGlassPanel(command);
    }

    /**
     * 사용이 끝난 GL 자원을 정리합니다.
     */
    destroy() {
        const gl = this.gl;

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
            gl.deleteTexture(this.sourceTexture);
            this.sourceTexture = null;
        }

        if (this.panelTexture) {
            gl.deleteTexture(this.panelTexture);
            this.panelTexture = null;
        }

        if (this.emptyTexture) {
            gl.deleteTexture(this.emptyTexture);
            this.emptyTexture = null;
        }

        if (this.sceneTexture) {
            this.sceneTexture = null;
        }

        if (this.fullscreenBuffer) {
            gl.deleteBuffer(this.fullscreenBuffer);
            this.fullscreenBuffer = null;
        }

        if (this.unitQuadBuffer) {
            gl.deleteBuffer(this.unitQuadBuffer);
            this.unitQuadBuffer = null;
        }

        if (this.downsampleProgram?.program) {
            gl.deleteProgram(this.downsampleProgram.program);
        }
        if (this.upsampleProgram?.program) {
            gl.deleteProgram(this.upsampleProgram.program);
        }
        if (this.compositeProgram?.program) {
            gl.deleteProgram(this.compositeProgram.program);
        }
        if (this.solidColorProgram?.program) {
            gl.deleteProgram(this.solidColorProgram.program);
        }
        if (this.shadowProgram?.program) {
            gl.deleteProgram(this.shadowProgram.program);
        }
        if (this.panelTextureProgram?.program) {
            gl.deleteProgram(this.panelTextureProgram.program);
        }
        if (this.glassProgram?.program) {
            gl.deleteProgram(this.glassProgram.program);
        }
    }

    /**
     * @private
     * 셰이더 프로그램을 준비합니다.
     */
    #initPrograms() {
        this.compositeProgram = this.#createProgramInfo(FULLSCREEN_VERTEX_SHADER, COMPOSITE_TEXTURE_FRAGMENT_SHADER, [
            'u_texture',
            'u_opacity'
        ]);
        this.solidColorProgram = this.#createProgramInfo(FULLSCREEN_VERTEX_SHADER, SOLID_COLOR_FRAGMENT_SHADER, [
            'u_color'
        ]);
        this.downsampleProgram = this.#createProgramInfo(FULLSCREEN_VERTEX_SHADER, KAWASE_DOWNSAMPLE_FRAGMENT_SHADER, [
            'u_texture',
            'u_texelSize',
            'u_offset'
        ]);
        this.upsampleProgram = this.#createProgramInfo(FULLSCREEN_VERTEX_SHADER, KAWASE_UPSAMPLE_FRAGMENT_SHADER, [
            'u_texture',
            'u_texelSize',
            'u_offset'
        ]);
        this.shadowProgram = this.#createProgramInfo(GLASS_PANEL_VERTEX_SHADER, SHADOW_PANEL_FRAGMENT_SHADER, [
            'u_drawRect',
            'u_panelRect',
            'u_resolution',
            'u_transform',
            'u_perspective',
            'u_radius',
            'u_alpha',
            'u_shadowRadius',
            'u_shadowOffset',
            'u_shadowColor'
        ], ['a_unit']);
        this.panelTextureProgram = this.#createProgramInfo(GLASS_PANEL_VERTEX_SHADER, PANEL_TEXTURE_FRAGMENT_SHADER, [
            'u_drawRect',
            'u_panelRect',
            'u_resolution',
            'u_transform',
            'u_perspective',
            'u_texture',
            'u_radius',
            'u_alpha'
        ], ['a_unit']);
        this.glassProgram = this.#createProgramInfo(GLASS_PANEL_VERTEX_SHADER, GLASS_PANEL_FRAGMENT_SHADER, [
            'u_drawRect',
            'u_panelRect',
            'u_resolution',
            'u_transform',
            'u_perspective',
            'u_blurTexture',
            'u_radius',
            'u_alpha',
            'u_lineWidth',
            'u_fillColor',
            'u_strokeColor',
            'u_tintColor',
            'u_tintStrength',
            'u_edgeColor',
            'u_edgeStrength',
            'u_refractionStrength'
        ], ['a_unit']);
    }

    /**
     * @private
     * 공용 버퍼를 준비합니다.
     */
    #initBuffers() {
        const gl = this.gl;

        this.fullscreenBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]), gl.STATIC_DRAW);

        this.unitQuadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            1, 1
        ]), gl.STATIC_DRAW);
    }

    /**
     * @private
     * blur texture를 최신 상태로 맞춥니다.
     * @param {object} command - 현재 glass 패널 명령입니다.
     */
    #ensureBlurTexture(command) {
        const blurUpdateMode = command.blurUpdateMode || OVERLAY_RENDER_CONSTANTS.BLUR_UPDATE_MODE.DIRTY;
        const blurRevision = Number.isFinite(command.blurRevision) ? command.blurRevision : 0;
        const shouldRefresh = command.forceBlurRefresh === true
            || blurUpdateMode === OVERLAY_RENDER_CONSTANTS.BLUR_UPDATE_MODE.ALWAYS
            || this.blurDirty
            || this.lastBlurRevision !== blurRevision
            || !this.finalBlurTexture;

        if (!shouldRefresh) {
            return;
        }

        const sources = typeof command.sourceProvider === 'function'
            ? command.sourceProvider()
            : [];

        this.#captureSources(sources);
        this.#runKawaseBlur(command);

        this.lastBlurRevision = blurRevision;
        this.blurDirty = false;
    }

    /**
     * @private
     * 현재 오버레이보다 아래에 있는 화면을 GPU 합성 경로로 scene texture에 누적합니다.
     * @param {Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number}>} sources - 합성할 소스 목록입니다.
     */
    #captureSources(sources) {
        const gl = this.gl;
        if (!this.sceneTarget) {
            return;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        for (const source of sources) {
            if (!source) {
                continue;
            }

            if (source.kind === 'dim') {
                const opacity = Math.max(0, Math.min(1, source.opacity || 0));
                if (opacity > 0) {
                    this.#drawSolidColorPass(new Float32Array([0, 0, 0, opacity]));
                }
                continue;
            }

            if (source.kind !== 'canvas' || !source.canvas || source.canvas.width <= 0 || source.canvas.height <= 0) {
                continue;
            }

            this.#uploadSourceCanvas(source.canvas);
            this.#drawCompositeTexturePass(Math.max(0, Math.min(1, source.opacity === undefined ? 1 : source.opacity)));
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
    }

    /**
     * @private
     * downsample/upsample 다중 패스로 Kawase blur를 생성합니다.
     * @param {object} command - 현재 명령입니다.
     */
    #runKawaseBlur(command) {
        const gl = this.gl;
        const passCount = this.downTargets.length;
        if (passCount <= 0 || !Number.isFinite(command.blur) || command.blur <= 0) {
            this.finalBlurTexture = this.sceneTexture;
            return;
        }

        let readTexture = this.sceneTexture;
        let readWidth = this.width;
        let readHeight = this.height;
        const blurScale = Math.max(0.5, (command.blur || 1) / 8);

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
        gl.viewport(0, 0, this.width, this.height);
    }

    /**
     * @private
     * 풀스크린 pass 하나를 실행합니다.
     * @param {object} options - pass 실행 옵션입니다.
     */
    #drawFullscreenPass(options) {
        const {
            programInfo,
            sourceTexture,
            sourceWidth,
            sourceHeight,
            target,
            offset
        } = options;
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
     * @private
     * 업로드된 source texture를 scene target에 합성합니다.
     * @param {number} opacity - 적용할 투명도입니다.
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
     * @private
     * 단색 dim 레이어를 scene target에 합성합니다.
     * @param {Float32Array} color - premultiplied alpha를 기대하지 않는 RGBA 색상입니다.
     */
    #drawSolidColorPass(color) {
        const gl = this.gl;
        gl.useProgram(this.solidColorProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.solidColorProgram.attributes.a_position);
        gl.vertexAttribPointer(this.solidColorProgram.attributes.a_position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4fv(this.solidColorProgram.uniforms.u_color, color);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * @private
     * 현재 source canvas를 재사용 텍스처에 업로드합니다.
     * @param {HTMLCanvasElement} canvas - 업로드할 캔버스입니다.
     */
    #uploadSourceCanvas(canvas) {
        const gl = this.gl;
        if (!this.sourceTexture) {
            this.sourceTexture = this.#createTexture(Math.max(1, canvas.width), Math.max(1, canvas.height));
        }

        gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    /**
     * @private
     * 패널 effect용 오프스크린 캔버스를 텍스처로 업로드합니다.
     * @param {HTMLCanvasElement} canvas - 업로드할 effect 캔버스입니다.
     */
    #uploadPanelTexture(canvas) {
        const gl = this.gl;
        if (!this.panelTexture) {
            this.panelTexture = this.#createTexture(Math.max(1, canvas.width), Math.max(1, canvas.height));
        }

        gl.bindTexture(gl.TEXTURE_2D, this.panelTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    }

    /**
     * @private
     * glass 패널을 렌더링합니다.
     * @param {object} command - 렌더링 명령입니다.
     */
    #drawGlassPanel(command) {
        const gl = this.gl;
        const panelRect = this.#buildPanelRect(command);
        const shadowRadius = Math.max(0, command.shadowRadius || 0);
        const perspective = Number.isFinite(command.perspective) ? Math.max(1, command.perspective) : 1000;
        const shadowOffset = {
            x: Number.isFinite(command.shadowOffsetX) ? command.shadowOffsetX : 0,
            y: Number.isFinite(command.shadowOffsetY) ? command.shadowOffsetY : 0
        };
        const fillColor = this.#normalizeColor(command.fill || 'rgba(255,255,255,0)');
        const strokeColor = this.#normalizeColor(command.stroke || 'rgba(255,255,255,0)');
        const tintColor = this.#normalizeColor(command.tintColor || OVERLAY_RENDER_CONSTANTS.GLASS_TINT_COLOR);
        const edgeColor = this.#normalizeColor(command.edgeColor || OVERLAY_RENDER_CONSTANTS.GLASS_EDGE_COLOR);
        const shadowColor = this.#normalizeColor(command.shadowColor || 'rgba(0,0,0,0)');
        const transformMatrix = Array.isArray(command.transformMatrix) && command.transformMatrix.length === 16
            ? new Float32Array(command.transformMatrix)
            : OverlayEffectRenderer.IDENTITY_MATRIX;

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        if (shadowRadius > 0 && shadowColor[3] > 0) {
            this.#drawPanelShadow({
                alpha: command.alpha === undefined ? 1 : command.alpha,
                panelRect,
                transformMatrix,
                perspective,
                radius: Math.max(0, command.radius || 0),
                shadowRadius,
                shadowColor,
                shadowOffset
            });
        }

        gl.useProgram(this.glassProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);

        gl.enableVertexAttribArray(this.glassProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.glassProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);

        this.#setPanelUniforms(this.glassProgram, panelRect, panelRect, transformMatrix, perspective);
        gl.uniform1f(this.glassProgram.uniforms.u_radius, Math.max(0, command.radius || 0));
        gl.uniform1f(this.glassProgram.uniforms.u_alpha, command.alpha === undefined ? 1 : command.alpha);
        gl.uniform1f(this.glassProgram.uniforms.u_lineWidth, Math.max(1, command.lineWidth || 1));
        gl.uniform4fv(this.glassProgram.uniforms.u_fillColor, fillColor);
        gl.uniform4fv(this.glassProgram.uniforms.u_strokeColor, strokeColor);
        gl.uniform4fv(this.glassProgram.uniforms.u_tintColor, tintColor);
        gl.uniform1f(
            this.glassProgram.uniforms.u_tintStrength,
            command.tintStrength === undefined ? OVERLAY_RENDER_CONSTANTS.GLASS_TINT_STRENGTH : command.tintStrength
        );
        gl.uniform4fv(this.glassProgram.uniforms.u_edgeColor, edgeColor);
        gl.uniform1f(
            this.glassProgram.uniforms.u_edgeStrength,
            command.edgeStrength === undefined ? OVERLAY_RENDER_CONSTANTS.GLASS_EDGE_STRENGTH : command.edgeStrength
        );
        gl.uniform1f(
            this.glassProgram.uniforms.u_refractionStrength,
            command.refractionStrength === undefined ? OVERLAY_RENDER_CONSTANTS.GLASS_REFRACTION_STRENGTH : command.refractionStrength
        );

        const backdropTexture = command.sampleBackdrop === false
            ? this.#getEmptyTexture()
            : (this.finalBlurTexture || this.sceneTexture);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, backdropTexture);
        gl.uniform1i(this.glassProgram.uniforms.u_blurTexture, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (command.effectTextureCanvas) {
            this.#drawPanelTexture({
                alpha: command.alpha === undefined ? 1 : command.alpha,
                canvas: command.effectTextureCanvas,
                panelRect,
                perspective,
                radius: Math.max(0, command.radius || 0),
                transformMatrix
            });
        }
    }

    /**
     * @private
     * 패널 뒤에 soft shadow를 렌더링합니다.
     * @param {object} options - shadow 렌더링 옵션입니다.
     */
    #drawPanelShadow(options) {
        const gl = this.gl;
        const drawRect = this.#buildExpandedRect(options.panelRect, options.shadowRadius, options.shadowOffset);
        gl.useProgram(this.shadowProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
        gl.enableVertexAttribArray(this.shadowProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.shadowProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);
        this.#setPanelUniforms(this.shadowProgram, drawRect, options.panelRect, options.transformMatrix, options.perspective);
        gl.uniform1f(this.shadowProgram.uniforms.u_radius, options.radius);
        gl.uniform1f(this.shadowProgram.uniforms.u_alpha, options.alpha);
        gl.uniform1f(this.shadowProgram.uniforms.u_shadowRadius, options.shadowRadius);
        gl.uniform2f(this.shadowProgram.uniforms.u_shadowOffset, options.shadowOffset.x, options.shadowOffset.y);
        gl.uniform4fv(this.shadowProgram.uniforms.u_shadowColor, options.shadowColor);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * @private
     * 패널 내부 effect 텍스처를 현재 패널 변형과 함께 합성합니다.
     * @param {object} options - 텍스처 합성 옵션입니다.
     */
    #drawPanelTexture(options) {
        const gl = this.gl;
        this.#uploadPanelTexture(options.canvas);

        gl.useProgram(this.panelTextureProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
        gl.enableVertexAttribArray(this.panelTextureProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.panelTextureProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);
        this.#setPanelUniforms(
            this.panelTextureProgram,
            options.panelRect,
            options.panelRect,
            options.transformMatrix,
            options.perspective
        );
        gl.uniform1f(this.panelTextureProgram.uniforms.u_radius, options.radius);
        gl.uniform1f(this.panelTextureProgram.uniforms.u_alpha, options.alpha);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.panelTexture);
        gl.uniform1i(this.panelTextureProgram.uniforms.u_texture, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * @private
     * backdrop 샘플링을 비활성화할 때 사용할 투명 텍스처를 반환합니다.
     * @returns {WebGLTexture} 1x1 투명 텍스처입니다.
     */
    #getEmptyTexture() {
        if (this.emptyTexture) {
            return this.emptyTexture;
        }

        const gl = this.gl;
        this.emptyTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.emptyTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
     * @private
     * 패널 draw/panel rect 공통 uniform을 설정합니다.
     * @param {object} programInfo - 대상 프로그램 정보입니다.
     * @param {{x:number, y:number, w:number, h:number}} drawRect - 실제 그릴 rect입니다.
     * @param {{x:number, y:number, w:number, h:number}} panelRect - 패널 기준 rect입니다.
     * @param {Float32Array} transformMatrix - 적용할 transform 행렬입니다.
     * @param {number} perspective - 적용할 원근 거리입니다.
     */
    #setPanelUniforms(programInfo, drawRect, panelRect, transformMatrix, perspective) {
        const gl = this.gl;
        gl.uniform4f(programInfo.uniforms.u_drawRect, drawRect.x, drawRect.y, drawRect.w, drawRect.h);
        gl.uniform4f(programInfo.uniforms.u_panelRect, panelRect.x, panelRect.y, panelRect.w, panelRect.h);
        gl.uniform2f(programInfo.uniforms.u_resolution, this.width, this.height);
        gl.uniformMatrix4fv(programInfo.uniforms.u_transform, false, transformMatrix);
        gl.uniform1f(programInfo.uniforms.u_perspective, perspective);
    }

    /**
     * @private
     * command를 panel rect 형식으로 정규화합니다.
     * @param {object} command - 원본 패널 명령입니다.
     * @returns {{x:number, y:number, w:number, h:number}} 패널 rect입니다.
     */
    #buildPanelRect(command) {
        return {
            x: command.x || 0,
            y: command.y || 0,
            w: Math.max(0, command.w || 0),
            h: Math.max(0, command.h || 0)
        };
    }

    /**
     * @private
     * shadow를 포함할 수 있도록 rect를 확장합니다.
     * @param {{x:number, y:number, w:number, h:number}} panelRect - 기준 패널 rect입니다.
     * @param {number} shadowRadius - shadow blur 반경입니다.
     * @param {{x:number, y:number}} shadowOffset - shadow 오프셋입니다.
     * @returns {{x:number, y:number, w:number, h:number}} 확장된 draw rect입니다.
     */
    #buildExpandedRect(panelRect, shadowRadius, shadowOffset) {
        const pad = Math.max(0, shadowRadius * 3.0) + Math.max(Math.abs(shadowOffset.x), Math.abs(shadowOffset.y));
        return {
            x: panelRect.x - pad,
            y: panelRect.y - pad,
            w: panelRect.w + (pad * 2),
            h: panelRect.h + (pad * 2)
        };
    }

    /**
     * @private
     * 프로그램과 attribute/uniform 위치를 묶어 생성합니다.
     * @param {string} vertexSource - 버텍스 셰이더 소스입니다.
     * @param {string} fragmentSource - 프래그먼트 셰이더 소스입니다.
     * @param {string[]} uniformNames - 조회할 uniform 이름 목록입니다.
     * @param {string[]} [attributeNames=['a_position']] - 조회할 attribute 이름 목록입니다.
     * @returns {{program: WebGLProgram, uniforms: Object.<string, WebGLUniformLocation>, attributes: Object.<string, number>}}
     */
    #createProgramInfo(vertexSource, fragmentSource, uniformNames, attributeNames = ['a_position']) {
        const gl = this.gl;
        const vertexShader = compileShader(gl, vertexSource, gl.VERTEX_SHADER);
        const fragmentShader = compileShader(gl, fragmentSource, gl.FRAGMENT_SHADER);
        const program = createProgram(gl, vertexShader, fragmentShader);

        const uniforms = {};
        for (const uniformName of uniformNames) {
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }

        const attributes = {};
        for (const attributeName of attributeNames) {
            attributes[attributeName] = gl.getAttribLocation(program, attributeName);
        }

        return { program, uniforms, attributes };
    }

    /**
     * @private
     * blur용 텍스처/FBO 체인을 다시 생성합니다.
     */
    #rebuildTargets() {
        const gl = this.gl;
        this.#destroyTargets(this.downTargets);
        this.#destroyTargets(this.upTargets);
        this.downTargets = [];
        this.upTargets = [];

        if (this.sceneTarget) {
            this.#destroyTargets([this.sceneTarget]);
            this.sceneTarget = null;
        }
        this.sceneTarget = this.#createRenderTarget(this.width, this.height);
        this.sceneTexture = this.sceneTarget.texture;

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

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * @private
     * 렌더 타깃 배열을 정리합니다.
     * @param {Array<{texture: WebGLTexture, framebuffer: WebGLFramebuffer}>} targets - 정리할 타깃 목록입니다.
     */
    #destroyTargets(targets) {
        const gl = this.gl;
        for (const target of targets) {
            if (target.texture) {
                gl.deleteTexture(target.texture);
            }
            if (target.framebuffer) {
                gl.deleteFramebuffer(target.framebuffer);
            }
        }
    }

    /**
     * @private
     * 텍스처 하나를 생성합니다.
     * @param {number} width - 텍스처 너비입니다.
     * @param {number} height - 텍스처 높이입니다.
     * @returns {WebGLTexture} 생성된 텍스처입니다.
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
     * @private
     * 렌더 타깃 하나를 생성합니다.
     * @param {number} width - 너비입니다.
     * @param {number} height - 높이입니다.
     * @returns {{texture: WebGLTexture, framebuffer: WebGLFramebuffer, width: number, height: number}}
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
     * @private
     * 색상 입력을 vec4 형식으로 정규화합니다.
     * @param {string|number[]|Float32Array} value - 정규화할 색상입니다.
     * @returns {Float32Array} vec4 색상입니다.
     */
    #normalizeColor(value) {
        if (value === false || value === null || value === undefined) {
            return new Float32Array([0, 0, 0, 0]);
        }

        if (value instanceof Float32Array && value.length === 4) {
            return value;
        }

        if (Array.isArray(value) && value.length === 4) {
            return new Float32Array(value);
        }

        const parsed = colorUtil().cssToRgb(value);
        return new Float32Array([
            parsed.r / 255,
            parsed.g / 255,
            parsed.b / 255,
            parsed.a
        ]);
    }
}

/**
 * @readonly
 * @type {Float32Array}
 */
OverlayEffectRenderer.IDENTITY_MATRIX = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
]);
