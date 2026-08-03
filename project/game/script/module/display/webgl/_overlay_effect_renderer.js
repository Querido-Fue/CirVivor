import { colorUtil } from 'util/color_util.js';
import { clamp01 } from 'util/number_util.js';
import { resolveOverlayEffectTextureRect } from './_overlay_render_geometry.js';
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
import { OVERLAY_RENDER_CONSTANTS, WEBGL_CONSTANTS } from './_webgl_constants.js';
import {
    invalidateWebGLGpuTimerQueryContext,
    WebGLGpuTimerQueryRing
} from './_webgl_gpu_timer_query_ring.js';
import {
    getWebGLGpuTelemetryTrialGeneration,
    getWebGLGpuTelemetryFrameId,
    isWebGLGpuTelemetryEnabled,
    recordWebGLGpuTelemetryContextLoss,
    retireWebGLGpuTelemetryCollector,
    setWebGLGpuTelemetryEnabled
} from './_webgl_gpu_telemetry_state.js';

/**
 * @class OverlayEffectRenderer
 * @description transparent overlay 전용 blur 캡처와 glass 패널 합성을 담당합니다.
 */
export class OverlayEffectRenderer {
    /**
     * @param {WebGLRenderingContext} gl - 대상 WebGL 컨텍스트입니다.
     * @param {object} [options={}] - renderer 식별과 진단 옵션입니다.
     * @param {string} [options.rendererId='overlay-effect'] - telemetry에서 사용할 renderer 식별자입니다.
     */
    constructor(gl, options = {}) {
        this.gl = gl;
        const canvasRendererId = gl?.canvas?.dataset?.surfaceId;
        this.rendererId = typeof options.rendererId === 'string' && options.rendererId
            ? options.rendererId
            : (canvasRendererId || 'overlay-effect');
        this.width = 0;
        this.height = 0;
        this.blurDirty = true;
        this.lastBlurRevision = -1;
        this.lastBlurSourceIdentity = null;
        this.lastBlurSourceRevision = -1;
        this.lastBlurRadius = Number.NaN;
        this.lastBlurOutputScaleSignature = '';
        this.lastBlurQualityPreset = '';
        this.lastBlurPassSignature = '';
        this.finalBlurTexture = null;
        this.sceneTexture = null;
        this.sceneTarget = null;
        this.downTargets = [];
        this.upTargets = [];
        this.sourceTextureCache = new WeakMap();
        this.sourceTextureRecords = new Set();
        this.activeSourceTexture = null;
        this.panelTexture = null;
        this.panelTextureCache = new WeakMap();
        this.panelTextureRecords = new Set();
        this.activePanelTexture = null;
        this.emptyTexture = null;
        this.frameSerial = 0;
        this.lastBlurFrameSerial = -1;
        this.blurOutputScaleSignature = '';
        this.blurPassSignature = '';
        this.panelRectScratch = { x: 0, y: 0, w: 0, h: 0 };
        this.effectTextureRectScratch = { x: 0, y: 0, w: 0, h: 0 };
        this.expandedRectScratch = { x: 0, y: 0, w: 0, h: 0 };
        this.transformMatrixScratch = new Float32Array(16);
        this.transparentColor = new Float32Array([0, 0, 0, 0]);
        this.colorStringCache = new Map();
        this.colorObjectCache = new WeakMap();
        this.gpuTimerQueryRing = null;
        this.gpuTelemetryEnabled = isWebGLGpuTelemetryEnabled();
        this.gpuTelemetryFrame = null;
        this.gpuTelemetryFrameSamples = null;
        this.gpuTelemetryFrameSampleReadIndex = 0;
        this.gpuTelemetryFrameSampleWriteIndex = 0;
        this.gpuTelemetryFrameSampleCount = 0;
        this.gpuTelemetryDroppedFrameSampleCount = 0;
        this.gpuTelemetryPendingFrameId = null;
        this.gpuTelemetryCurrentFrameId = 0;
        this.gpuTelemetryCurrentTrialGeneration = getWebGLGpuTelemetryTrialGeneration();
        this.gpuTelemetryContextLossListener = null;

        if (this.gpuTelemetryEnabled) {
            this.#attachGpuTelemetryContextLossListener();
            this.#ensureGpuTimerQueryRing();
        }

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
     * 프레임 시작 시 surface 크기와 frame serial을 갱신합니다.
     * @param {number} width - 현재 surface 너비입니다.
     * @param {number} height - 현재 surface 높이입니다.
     */
    beginFrame(width, height) {
        this.#finalizeGpuTelemetryFrame();
        this.#applyGpuTelemetryEnabled(isWebGLGpuTelemetryEnabled());
        this.gpuTimerQueryRing?.poll();
        this.resize(width, height);
        this.frameSerial += 1;
        if (this.frameSerial >= Number.MAX_SAFE_INTEGER) {
            this.frameSerial = 1;
        }
        const appFrameId = isWebGLGpuTelemetryEnabled()
            ? getWebGLGpuTelemetryFrameId()
            : null;
        if (Number.isSafeInteger(this.gpuTelemetryPendingFrameId)
            && this.gpuTelemetryPendingFrameId >= 0) {
            this.gpuTelemetryCurrentFrameId = this.gpuTelemetryPendingFrameId;
        } else if (Number.isSafeInteger(appFrameId) && appFrameId > 0) {
            this.gpuTelemetryCurrentFrameId = appFrameId;
        } else {
            this.gpuTelemetryCurrentFrameId = this.frameSerial;
        }
        this.gpuTelemetryPendingFrameId = null;
        this.gpuTelemetryCurrentTrialGeneration = getWebGLGpuTelemetryTrialGeneration();
    }

    /**
     * 여러 WebGL context가 공유할 다음 표시 프레임 식별자를 설정합니다.
     * @param {number} frameId - WebGLHandler가 발급한 공통 frame ID입니다.
     * @returns {void}
     */
    setGpuTelemetryFrameId(frameId) {
        this.gpuTelemetryPendingFrameId = Number.isSafeInteger(frameId) && frameId >= 0
            ? frameId
            : null;
    }

    /**
     * 동적 surface 등록 이름을 telemetry renderer 식별자로 설정합니다.
     * @param {string} rendererId - surface 또는 renderer 식별자입니다.
     * @returns {void}
     */
    setGpuTelemetryRendererId(rendererId) {
        if (typeof rendererId === 'string' && rendererId) {
            this.rendererId = rendererId;
        }
    }

    /**
     * 비동기 GPU query와 프레임 카운터 수집을 전환합니다.
     * 일반 게임에서는 기본적으로 꺼져 있으며 성능 하네스가 명시적으로 활성화합니다.
     * @param {boolean} enabled - 수집 활성 여부입니다.
     * @returns {boolean} 최종 활성 상태입니다.
     */
    setGpuTelemetryEnabled(enabled) {
        const nextEnabled = enabled === true;
        setWebGLGpuTelemetryEnabled(nextEnabled);
        this.#applyGpuTelemetryEnabled(nextEnabled);
        return nextEnabled;
    }

    /**
     * 완료된 비동기 GPU 시간과 프레임별 작업량 표본을 반환하고 내부 완료 큐를 비웁니다.
     * GPU 완료를 기다리거나 동기 readback을 수행하지 않습니다.
     * @returns {{gpuSamples:Array<object>, frameSamples:Array<object>}} 완료된 telemetry 표본입니다.
     */
    drainGpuTelemetry() {
        this.gpuTimerQueryRing?.poll();
        const rawGpuSamples = this.gpuTimerQueryRing?.drainSamples() || [];
        const gpuSamples = new Array(rawGpuSamples.length);
        for (let index = 0; index < rawGpuSamples.length; index++) {
            gpuSamples[index] = Object.freeze({ ...rawGpuSamples[index] });
        }
        const frameSamples = this.#drainGpuTelemetryFrameSamples();
        return {
            gpuSamples,
            frameSamples
        };
    }

    /**
     * 현재 비동기 query와 frame-counter ring 상태를 반환합니다.
     * @returns {object} telemetry 상태 스냅샷입니다.
     */
    getGpuTelemetrySnapshot() {
        this.gpuTimerQueryRing?.poll();
        return Object.freeze({
            rendererId: this.rendererId,
            enabled: this.gpuTelemetryEnabled,
            timer: this.gpuTimerQueryRing?.getSnapshot()
                || OverlayEffectRenderer.DISABLED_GPU_TIMER_SNAPSHOT,
            completedFrameSampleCount: this.gpuTelemetryFrameSampleCount,
            droppedFrameSampleCount: this.gpuTelemetryDroppedFrameSampleCount
        });
    }

    /**
     * glass 패널 명령을 렌더링합니다.
     * @param {object} command - glass 패널 명령입니다.
     */
    render(command) {
        if (!command || command.shape !== 'glassPanel' || this.width <= 0 || this.height <= 0) {
            return;
        }

        const telemetryFrame = this.#getGpuTelemetryFrame();
        if (telemetryFrame) {
            telemetryFrame.renderCallCount += 1;
        }

        if (command.sampleBackdrop !== false) {
            this.#ensureBlurTexture(command);
        }
        const timerStarted = this.#beginGpuTimer('title.overlay_glass_draw.gpu_ms');
        let drawCompleted = false;
        try {
            this.#drawGlassPanel(command);
            drawCompleted = true;
        } finally {
            this.#endGpuTimer(timerStarted, drawCompleted, 'glass-draw-aborted');
            if (!drawCompleted && telemetryFrame) {
                telemetryFrame.failedGlassDrawCount += 1;
            }
        }
    }

    /**
     * 사용이 끝난 GL 자원을 정리합니다.
     */
    destroy() {
        const gl = this.gl;

        this.#detachGpuTelemetryContextLossListener();
        this.#finalizeGpuTelemetryFrame();
        this.gpuTelemetryEnabled = false;
        const frameSamples = this.#drainGpuTelemetryFrameSamples();
        retireWebGLGpuTelemetryCollector({
            rendererId: this.rendererId,
            timerQueryRing: this.gpuTimerQueryRing,
            frameSamples,
            droppedFrameSampleCount: this.gpuTelemetryDroppedFrameSampleCount
        });
        this.gpuTimerQueryRing = null;

        this.#destroyTargets(this.downTargets);
        this.#destroyTargets(this.upTargets);
        this.downTargets = [];
        this.upTargets = [];

        if (this.sceneTarget) {
            this.#destroyTargets([this.sceneTarget]);
            this.sceneTarget = null;
            this.sceneTexture = null;
        }

        for (const record of this.sourceTextureRecords) {
            if (record.texture) {
                gl.deleteTexture(record.texture);
            }
        }
        this.sourceTextureRecords.clear();
        this.sourceTextureCache = new WeakMap();
        this.activeSourceTexture = null;

        for (const record of this.panelTextureRecords) {
            if (record.texture) {
                gl.deleteTexture(record.texture);
            }
        }
        this.panelTextureRecords.clear();
        this.panelTextureCache = new WeakMap();
        this.panelTexture = null;
        this.activePanelTexture = null;

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

        this.#deleteProgramInfo(this.downsampleProgram);
        this.#deleteProgramInfo(this.upsampleProgram);
        this.#deleteProgramInfo(this.compositeProgram);
        this.#deleteProgramInfo(this.solidColorProgram);
        this.#deleteProgramInfo(this.shadowProgram);
        this.#deleteProgramInfo(this.panelTextureProgram);
        this.#deleteProgramInfo(this.glassProgram);
        this.colorStringCache.clear();
        this.colorObjectCache = new WeakMap();
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
            'u_textureRect',
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
        const telemetryFrame = this.#getGpuTelemetryFrame();
        const blurUpdateMode = command.blurUpdateMode || OVERLAY_RENDER_CONSTANTS.BLUR_UPDATE_MODE.DIRTY;
        const blurRevision = Number.isFinite(command.blurRevision) ? command.blurRevision : 0;
        let providedSnapshot;
        try {
            providedSnapshot = typeof command.sourceProvider === 'function'
                ? command.sourceProvider()
                : OverlayEffectRenderer.EMPTY_SOURCE_SNAPSHOT;
        } catch (error) {
            if (telemetryFrame) {
                telemetryFrame.sourceProviderFailureCount += 1;
                telemetryFrame.failedBlurRefreshCount += 1;
            }
            throw error;
        }
        const sources = Array.isArray(providedSnapshot)
            ? providedSnapshot
            : (Array.isArray(providedSnapshot?.sources)
                ? providedSnapshot.sources
                : OverlayEffectRenderer.EMPTY_SOURCES);
        const sourceIdentity = providedSnapshot?.snapshotIdentity ?? sources;
        const sourceRevision = Number.isFinite(providedSnapshot?.sourceRevision)
            ? providedSnapshot.sourceRevision
            : blurRevision;
        const blurRadius = Number.isFinite(command.blur) ? Math.max(0, command.blur) : 0;
        const qualityPreset = command.blurQualityPreset
            || OVERLAY_RENDER_CONSTANTS.KAWASE_COMPATIBILITY_QUALITY_PRESET;
        const passSignature = command.blurPassSignature || this.blurPassSignature;
        const outputScaleSignature = command.blurOutputScale || this.blurOutputScaleSignature;
        const needsFrameRefresh = blurUpdateMode === OVERLAY_RENDER_CONSTANTS.BLUR_UPDATE_MODE.ALWAYS
            && this.lastBlurFrameSerial !== this.frameSerial;
        const shouldRefresh = command.forceBlurRefresh === true
            || needsFrameRefresh
            || this.blurDirty
            || this.lastBlurRevision !== blurRevision
            || this.lastBlurSourceIdentity !== sourceIdentity
            || this.lastBlurSourceRevision !== sourceRevision
            || this.lastBlurRadius !== blurRadius
            || this.lastBlurOutputScaleSignature !== outputScaleSignature
            || this.lastBlurQualityPreset !== qualityPreset
            || this.lastBlurPassSignature !== passSignature
            || !this.finalBlurTexture;

        if (!shouldRefresh) {
            if (telemetryFrame) {
                telemetryFrame.blurCacheHitCount += 1;
            }
            return;
        }

        if (telemetryFrame) {
            telemetryFrame.blurRefreshCount += 1;
            telemetryFrame.lastBlurRadius = blurRadius;
            telemetryFrame.lastBlurQualityPreset = qualityPreset;
        }
        const timerStarted = this.#beginGpuTimer('title.overlay_blur_composite.gpu_ms');
        let blurCompleted = false;
        try {
            const captureCompleted = this.#captureSources(sources);
            this.#runKawaseBlur(command);
            blurCompleted = captureCompleted;
        } finally {
            this.#endGpuTimer(timerStarted, blurCompleted, 'blur-composite-aborted');
            if (!blurCompleted && telemetryFrame) {
                telemetryFrame.failedBlurRefreshCount += 1;
            }
        }
        if (!blurCompleted) {
            this.blurDirty = true;
            return;
        }

        this.lastBlurRevision = blurRevision;
        this.lastBlurSourceIdentity = sourceIdentity;
        this.lastBlurSourceRevision = sourceRevision;
        this.lastBlurRadius = blurRadius;
        this.lastBlurOutputScaleSignature = outputScaleSignature;
        this.lastBlurQualityPreset = qualityPreset;
        this.lastBlurPassSignature = passSignature;
        this.lastBlurFrameSerial = this.frameSerial;
        this.blurDirty = false;
    }

    /**
     * @private
     * 현재 오버레이보다 아래에 있는 화면을 GPU 합성 경로로 scene texture에 누적합니다.
     * @param {Array<{kind: string, canvas?: HTMLCanvasElement, opacity?: number}>} sources - 합성할 소스 목록입니다.
     * @returns {boolean} 모든 유효 canvas source를 업로드했으면 true입니다.
     */
    #captureSources(sources) {
        const gl = this.gl;
        if (!this.sceneTarget) {
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.captureTargetFailureCount += 1;
            }
            return false;
        }
        const telemetryFrame = this.#getGpuTelemetryFrame();
        let captureCompleted = true;

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

            if (telemetryFrame) {
                telemetryFrame.sourceCount += 1;
            }

            if (source.kind === 'dim') {
                const opacity = clamp01(source.opacity || 0);
                if (opacity > 0) {
                    this.#drawSolidColorPass(opacity);
                    if (telemetryFrame) {
                        telemetryFrame.compositeDrawCount += 1;
                    }
                }
                continue;
            }

            if (source.kind !== 'canvas' || !source.canvas || source.canvas.width <= 0 || source.canvas.height <= 0) {
                continue;
            }

            if (!this.#uploadSourceCanvas(source)) {
                captureCompleted = false;
                if (telemetryFrame) {
                    telemetryFrame.sourceUploadFailureCount += 1;
                }
                continue;
            }
            this.#drawCompositeTexturePass(clamp01(source.opacity === undefined ? 1 : source.opacity));
            if (telemetryFrame) {
                telemetryFrame.compositeDrawCount += 1;
            }
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        return captureCompleted;
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
            this.#drawFullscreenPass(
                this.downsampleProgram,
                readTexture,
                readWidth,
                readHeight,
                target,
                (index + 1) * blurScale
            );
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.blurDownPassCount += 1;
            }

            readTexture = target.texture;
            readWidth = target.width;
            readHeight = target.height;
        }

        let currentTexture = readTexture;
        let currentWidth = readWidth;
        let currentHeight = readHeight;

        for (let index = this.upTargets.length - 1; index >= 0; index--) {
            const target = this.upTargets[index];
            this.#drawFullscreenPass(
                this.upsampleProgram,
                currentTexture,
                currentWidth,
                currentHeight,
                target,
                (index + 1) * blurScale
            );
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.blurUpPassCount += 1;
            }

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
     * @param {object} programInfo - 사용할 프로그램입니다.
     * @param {WebGLTexture} sourceTexture - 입력 텍스처입니다.
     * @param {number} sourceWidth - 입력 너비입니다.
     * @param {number} sourceHeight - 입력 높이입니다.
     * @param {object} target - 출력 렌더 타깃입니다.
     * @param {number} offset - Kawase 샘플 오프셋입니다.
     */
    #drawFullscreenPass(programInfo, sourceTexture, sourceWidth, sourceHeight, target, offset) {
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
        gl.bindTexture(gl.TEXTURE_2D, this.activeSourceTexture);
        gl.uniform1i(this.compositeProgram.uniforms.u_texture, 0);
        gl.uniform1f(this.compositeProgram.uniforms.u_opacity, opacity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * @private
     * 단색 dim 레이어를 scene target에 합성합니다.
     * @param {number} opacity - 검은색 dim의 opacity입니다.
     */
    #drawSolidColorPass(opacity) {
        const gl = this.gl;
        gl.useProgram(this.solidColorProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenBuffer);
        gl.enableVertexAttribArray(this.solidColorProgram.attributes.a_position);
        gl.vertexAttribPointer(this.solidColorProgram.attributes.a_position, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(this.solidColorProgram.uniforms.u_color, 0, 0, 0, opacity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * @private
     * 현재 source canvas를 canvas별 재사용 텍스처에 업로드합니다.
     * @param {{canvas: HTMLCanvasElement, revision?: number}} source - 업로드할 source 레코드입니다.
     * @returns {boolean} 업로드 또는 기존 텍스처 재사용 성공 여부입니다.
     */
    #uploadSourceCanvas(source) {
        const gl = this.gl;
        const canvas = source.canvas;
        let record = this.sourceTextureCache.get(canvas);
        if (!record) {
            record = {
                texture: this.#createTextureParameters(),
                width: 0,
                height: 0,
                revision: Number.NaN
            };
            this.sourceTextureCache.set(canvas, record);
            this.sourceTextureRecords.add(record);
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.sourceTextureAllocationCount += 1;
            }
        }

        const revision = Number.isFinite(source.revision) ? source.revision : Number.NaN;
        const sizeChanged = record.width !== canvas.width || record.height !== canvas.height;
        const needsUpload = sizeChanged || !Number.isFinite(revision) || record.revision !== revision;
        this.activeSourceTexture = record.texture;
        gl.bindTexture(gl.TEXTURE_2D, record.texture);
        if (!needsUpload) {
            return true;
        }

        try {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            if (sizeChanged) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            } else {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            }
            record.width = canvas.width;
            record.height = canvas.height;
            record.revision = revision;
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.sourceUploadCount += 1;
                telemetryFrame.sourceUploadPixelCount += canvas.width * canvas.height;
                if (sizeChanged) {
                    telemetryFrame.sourceFullUploadCount += 1;
                } else {
                    telemetryFrame.sourceSubUploadCount += 1;
                }
            }
            return true;
        } catch {
            return false;
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
    }

    /**
     * @private
     * 패널 effect용 오프스크린 캔버스를 텍스처로 업로드합니다.
     * @param {HTMLCanvasElement} canvas - 업로드할 effect 캔버스입니다.
     */
    #uploadPanelTexture(canvas) {
        const gl = this.gl;
        let record = this.panelTextureCache.get(canvas);
        if (!record) {
            record = {
                texture: this.#createTextureParameters(),
                width: 0,
                height: 0,
                revision: Number.NaN
            };
            this.panelTextureCache.set(canvas, record);
            this.panelTextureRecords.add(record);
            const telemetryFrame = this.#getGpuTelemetryFrame();
            if (telemetryFrame) {
                telemetryFrame.panelTextureAllocationCount += 1;
            }
        }

        const revision = Number.isFinite(canvas.__overlayTextureRevision)
            ? canvas.__overlayTextureRevision
            : Number.NaN;
        const needsUpload = record.width !== canvas.width
            || record.height !== canvas.height
            || !Number.isFinite(revision)
            || record.revision !== revision;

        gl.bindTexture(gl.TEXTURE_2D, record.texture);
        if (!needsUpload) {
            this.activePanelTexture = record.texture;
            return;
        }

        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        try {
            if (record.width !== canvas.width || record.height !== canvas.height) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            } else {
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            }
        } finally {
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        }
        record.width = canvas.width;
        record.height = canvas.height;
        record.revision = revision;
        this.activePanelTexture = record.texture;
        const telemetryFrame = this.#getGpuTelemetryFrame();
        if (telemetryFrame) {
            telemetryFrame.panelUploadCount += 1;
            telemetryFrame.panelUploadPixelCount += canvas.width * canvas.height;
        }
    }

    /**
     * @private
     * glass 패널을 렌더링합니다.
     * @param {object} command - 렌더링 명령입니다.
     */
    #drawGlassPanel(command) {
        const gl = this.gl;
        const panelRect = this.#buildPanelRect(command);
        const alpha = command.alpha === undefined ? 1 : command.alpha;
        const radius = Math.max(0, command.radius || 0);
        const shadowRadius = Math.max(0, command.shadowRadius || 0);
        const perspective = Number.isFinite(command.perspective) ? Math.max(1, command.perspective) : 1000;
        const shadowOffsetX = Number.isFinite(command.shadowOffsetX) ? command.shadowOffsetX : 0;
        const shadowOffsetY = Number.isFinite(command.shadowOffsetY) ? command.shadowOffsetY : 0;
        const fillColor = this.#normalizeColor(command.fill || 'rgba(255,255,255,0)');
        const strokeColor = this.#normalizeColor(command.stroke || 'rgba(255,255,255,0)');
        const tintColor = this.#normalizeColor(command.tintColor || OVERLAY_RENDER_CONSTANTS.GLASS_TINT_COLOR);
        const edgeColor = this.#normalizeColor(command.edgeColor || OVERLAY_RENDER_CONSTANTS.GLASS_EDGE_COLOR);
        const shadowColor = this.#normalizeColor(command.shadowColor || 'rgba(0,0,0,0)');
        const transformMatrix = this.#resolveTransformMatrix(command.transformMatrix);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        if (shadowRadius > 0 && shadowColor[3] > 0) {
            this.#drawPanelShadow(
                alpha,
                panelRect,
                transformMatrix,
                perspective,
                radius,
                shadowRadius,
                shadowColor,
                shadowOffsetX,
                shadowOffsetY
            );
        }

        gl.useProgram(this.glassProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);

        gl.enableVertexAttribArray(this.glassProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.glassProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);

        this.#setPanelUniforms(this.glassProgram, panelRect, panelRect, transformMatrix, perspective);
        gl.uniform1f(this.glassProgram.uniforms.u_radius, radius);
        gl.uniform1f(this.glassProgram.uniforms.u_alpha, alpha);
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
        const telemetryFrame = this.#getGpuTelemetryFrame();
        if (telemetryFrame) {
            telemetryFrame.glassDrawCount += 1;
        }

        if (command.effectTextureCanvas) {
            this.#drawPanelTexture(
                alpha,
                command.effectTextureCanvas,
                panelRect,
                perspective,
                radius,
                transformMatrix,
                command.effectTextureRect
            );
        }
    }

    /**
     * @private
     * 패널 뒤에 soft shadow를 렌더링합니다.
     * @param {number} alpha - 패널 alpha입니다.
     * @param {object} panelRect - 패널 영역입니다.
     * @param {Float32Array} transformMatrix - 패널 변환 행렬입니다.
     * @param {number} perspective - 원근 거리입니다.
     * @param {number} radius - 패널 반경입니다.
     * @param {number} shadowRadius - 그림자 반경입니다.
     * @param {Float32Array} shadowColor - 그림자 색상입니다.
     * @param {number} shadowOffsetX - 그림자 X 오프셋입니다.
     * @param {number} shadowOffsetY - 그림자 Y 오프셋입니다.
     */
    #drawPanelShadow(alpha, panelRect, transformMatrix, perspective, radius, shadowRadius, shadowColor, shadowOffsetX, shadowOffsetY) {
        const gl = this.gl;
        const drawRect = this.#buildExpandedRect(panelRect, shadowRadius, shadowOffsetX, shadowOffsetY);
        gl.useProgram(this.shadowProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
        gl.enableVertexAttribArray(this.shadowProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.shadowProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);
        this.#setPanelUniforms(this.shadowProgram, drawRect, panelRect, transformMatrix, perspective);
        gl.uniform1f(this.shadowProgram.uniforms.u_radius, radius);
        gl.uniform1f(this.shadowProgram.uniforms.u_alpha, alpha);
        gl.uniform1f(this.shadowProgram.uniforms.u_shadowRadius, shadowRadius);
        gl.uniform2f(this.shadowProgram.uniforms.u_shadowOffset, shadowOffsetX, shadowOffsetY);
        gl.uniform4fv(this.shadowProgram.uniforms.u_shadowColor, shadowColor);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const telemetryFrame = this.#getGpuTelemetryFrame();
        if (telemetryFrame) {
            telemetryFrame.shadowDrawCount += 1;
        }
    }

    /**
     * @private
     * 패널 내부 effect 텍스처를 현재 패널 변형과 함께 합성합니다.
     * @param {number} alpha - 패널 alpha입니다.
     * @param {HTMLCanvasElement} canvas - effect 캔버스입니다.
     * @param {object} panelRect - 패널 영역입니다.
     * @param {number} perspective - 원근 거리입니다.
     * @param {number} radius - 패널 반경입니다.
     * @param {Float32Array} transformMatrix - 패널 변환 행렬입니다.
     * @param {object|null|undefined} effectTextureRect - 절대 화면 좌표의 텍스처 표시 영역입니다.
     */
    #drawPanelTexture(
        alpha,
        canvas,
        panelRect,
        perspective,
        radius,
        transformMatrix,
        effectTextureRect
    ) {
        const gl = this.gl;
        this.#uploadPanelTexture(canvas);
        const textureRect = resolveOverlayEffectTextureRect(
            panelRect,
            effectTextureRect,
            this.effectTextureRectScratch
        );

        gl.useProgram(this.panelTextureProgram.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.unitQuadBuffer);
        gl.enableVertexAttribArray(this.panelTextureProgram.attributes.a_unit);
        gl.vertexAttribPointer(this.panelTextureProgram.attributes.a_unit, 2, gl.FLOAT, false, 0, 0);
        this.#setPanelUniforms(
            this.panelTextureProgram,
            panelRect,
            panelRect,
            transformMatrix,
            perspective
        );
        gl.uniform1f(this.panelTextureProgram.uniforms.u_radius, radius);
        gl.uniform1f(this.panelTextureProgram.uniforms.u_alpha, alpha);
        gl.uniform4f(
            this.panelTextureProgram.uniforms.u_textureRect,
            textureRect.x,
            textureRect.y,
            textureRect.w,
            textureRect.h
        );
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.activePanelTexture);
        gl.uniform1i(this.panelTextureProgram.uniforms.u_texture, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const telemetryFrame = this.#getGpuTelemetryFrame();
        if (telemetryFrame) {
            telemetryFrame.panelTextureDrawCount += 1;
        }
    }

    /**
     * 현재 frame의 비동기 GPU timer scope를 시작합니다.
     * @param {string} scope - 고정 metric 이름입니다.
     * @returns {boolean} query 시작 성공 여부입니다.
     * @private
     */
    #beginGpuTimer(scope) {
        return this.gpuTelemetryEnabled
            && this.gpuTimerQueryRing?.begin(scope, this.gpuTelemetryCurrentFrameId, {
                rendererId: this.rendererId,
                trialGeneration: this.gpuTelemetryCurrentTrialGeneration
            }) === true;
    }

    /**
     * 성공적으로 시작한 GPU timer scope를 정상 종료하거나 partial 결과를 폐기합니다.
     * @param {boolean} started - begin 성공 여부입니다.
     * @param {boolean} completed - 측정 대상 draw가 예외 없이 완료되었는지 여부입니다.
     * @param {string} abortReason - 폐기 진단 이유입니다.
     * @returns {void}
     * @private
     */
    #endGpuTimer(started, completed, abortReason) {
        if (!started) {
            return;
        }
        if (completed) {
            this.gpuTimerQueryRing?.end();
        } else {
            this.gpuTimerQueryRing?.abort(abortReason);
        }
    }

    /**
     * app-wide telemetry authority를 renderer-local 수집 상태에 적용합니다.
     * @param {boolean} enabled - 적용할 전역 활성 상태입니다.
     * @returns {void}
     * @private
     */
    #applyGpuTelemetryEnabled(enabled) {
        const nextEnabled = enabled === true;
        if (this.gpuTelemetryEnabled === nextEnabled) {
            return;
        }
        if (!nextEnabled) {
            this.#finalizeGpuTelemetryFrame();
        } else {
            this.#attachGpuTelemetryContextLossListener();
            this.#ensureGpuTimerQueryRing();
        }
        this.gpuTelemetryEnabled = nextEnabled;
    }

    /**
     * context loss에서 기존 renderer가 교체되기 전에 pending query를 명시적으로 무효화합니다.
     * @returns {void}
     * @private
     */
    #handleGpuTelemetryContextLoss() {
        this.#detachGpuTelemetryContextLossListener();
        if (!this.gpuTelemetryEnabled
            && !isWebGLGpuTelemetryEnabled()
            && !this.gpuTimerQueryRing) {
            return;
        }

        this.#finalizeGpuTelemetryFrame();
        invalidateWebGLGpuTimerQueryContext(this.gl, 'webgl-context-lost');
        recordWebGLGpuTelemetryContextLoss();
        this.gpuTelemetryEnabled = false;
        retireWebGLGpuTelemetryCollector({
            rendererId: this.rendererId,
            timerQueryRing: this.gpuTimerQueryRing,
            frameSamples: this.#drainGpuTelemetryFrameSamples(),
            droppedFrameSampleCount: this.gpuTelemetryDroppedFrameSampleCount
        });
        this.gpuTimerQueryRing = null;
    }

    /**
     * telemetry를 실제로 사용한 renderer에만 context-loss listener를 설치합니다.
     * @returns {void}
     * @private
     */
    #attachGpuTelemetryContextLossListener() {
        if (this.gpuTelemetryContextLossListener
            || typeof this.gl?.canvas?.addEventListener !== 'function') {
            return;
        }
        this.gpuTelemetryContextLossListener = () => {
            this.#handleGpuTelemetryContextLoss();
        };
        this.gl.canvas.addEventListener(
            'webglcontextlost',
            this.gpuTelemetryContextLossListener
        );
    }

    /**
     * 교체되거나 폐기된 renderer가 canvas event로 유지되지 않도록 listener를 제거합니다.
     * @returns {void}
     * @private
     */
    #detachGpuTelemetryContextLossListener() {
        if (!this.gpuTelemetryContextLossListener) {
            return;
        }
        this.gl?.canvas?.removeEventListener?.(
            'webglcontextlost',
            this.gpuTelemetryContextLossListener
        );
        this.gpuTelemetryContextLossListener = null;
    }

    /**
     * telemetry가 실제로 켜질 때만 query ring과 256개 slot metadata를 생성합니다.
     * @returns {WebGLGpuTimerQueryRing} 현재 query ring입니다.
     * @private
     */
    #ensureGpuTimerQueryRing() {
        if (!this.gpuTimerQueryRing) {
            this.gpuTimerQueryRing = new WebGLGpuTimerQueryRing(this.gl, {
                capacity: WEBGL_CONSTANTS.GPU_TIMER_QUERY_CAPACITY
            });
        }
        return this.gpuTimerQueryRing;
    }

    /**
     * 활성화된 telemetry의 현재 frame counter를 지연 생성합니다.
     * @returns {object|null} 현재 frame counter입니다.
     * @private
     */
    #getGpuTelemetryFrame() {
        if (!this.gpuTelemetryEnabled) {
            return null;
        }
        if (this.gpuTelemetryFrame?.frameId === this.gpuTelemetryCurrentFrameId
            && this.gpuTelemetryFrame?.trialGeneration
                === this.gpuTelemetryCurrentTrialGeneration) {
            return this.gpuTelemetryFrame;
        }
        this.#finalizeGpuTelemetryFrame();
        this.gpuTelemetryFrame = {
            rendererId: this.rendererId,
            frameId: this.gpuTelemetryCurrentFrameId,
            trialGeneration: this.gpuTelemetryCurrentTrialGeneration,
            renderCallCount: 0,
            blurRefreshCount: 0,
            failedBlurRefreshCount: 0,
            sourceProviderFailureCount: 0,
            captureTargetFailureCount: 0,
            sourceUploadFailureCount: 0,
            blurCacheHitCount: 0,
            lastBlurRadius: 0,
            lastBlurQualityPreset: '',
            sourceCount: 0,
            sourceTextureAllocationCount: 0,
            sourceUploadCount: 0,
            sourceFullUploadCount: 0,
            sourceSubUploadCount: 0,
            sourceUploadPixelCount: 0,
            compositeDrawCount: 0,
            blurDownPassCount: 0,
            blurUpPassCount: 0,
            glassDrawCount: 0,
            failedGlassDrawCount: 0,
            shadowDrawCount: 0,
            panelTextureAllocationCount: 0,
            panelUploadCount: 0,
            panelUploadPixelCount: 0,
            panelTextureDrawCount: 0
        };
        return this.gpuTelemetryFrame;
    }

    /**
     * 현재 frame counter를 bounded 완료 ring에 보관합니다.
     * @returns {void}
     * @private
     */
    #finalizeGpuTelemetryFrame() {
        if (!this.gpuTelemetryFrame) {
            return;
        }
        if (this.gpuTelemetryFrameSampleCount
            >= WEBGL_CONSTANTS.GPU_TELEMETRY_FRAME_RING_CAPACITY) {
            this.gpuTelemetryFrameSamples[this.gpuTelemetryFrameSampleReadIndex] = undefined;
            this.gpuTelemetryFrameSampleReadIndex = (
                this.gpuTelemetryFrameSampleReadIndex + 1
            ) % WEBGL_CONSTANTS.GPU_TELEMETRY_FRAME_RING_CAPACITY;
            this.gpuTelemetryFrameSampleCount -= 1;
            this.gpuTelemetryDroppedFrameSampleCount += 1;
        }
        if (!this.gpuTelemetryFrameSamples) {
            this.gpuTelemetryFrameSamples = new Array(
                WEBGL_CONSTANTS.GPU_TELEMETRY_FRAME_RING_CAPACITY
            );
        }
        this.gpuTelemetryFrameSamples[this.gpuTelemetryFrameSampleWriteIndex]
            = Object.freeze(this.gpuTelemetryFrame);
        this.gpuTelemetryFrameSampleWriteIndex = (
            this.gpuTelemetryFrameSampleWriteIndex + 1
        ) % WEBGL_CONSTANTS.GPU_TELEMETRY_FRAME_RING_CAPACITY;
        this.gpuTelemetryFrameSampleCount += 1;
        this.gpuTelemetryFrame = null;
    }

    /**
     * 완료 frame 원형 버퍼를 오래된 순서대로 비웁니다.
     * @returns {Array<object>} 완료 frame 표본입니다.
     * @private
     */
    #drainGpuTelemetryFrameSamples() {
        if (!this.gpuTelemetryFrameSamples || this.gpuTelemetryFrameSampleCount === 0) {
            return [];
        }
        const samples = new Array(this.gpuTelemetryFrameSampleCount);
        for (let index = 0; index < samples.length; index++) {
            samples[index] = this.gpuTelemetryFrameSamples[
                this.gpuTelemetryFrameSampleReadIndex
            ];
            this.gpuTelemetryFrameSamples[this.gpuTelemetryFrameSampleReadIndex] = undefined;
            this.gpuTelemetryFrameSampleReadIndex = (
                this.gpuTelemetryFrameSampleReadIndex + 1
            ) % WEBGL_CONSTANTS.GPU_TELEMETRY_FRAME_RING_CAPACITY;
        }
        this.gpuTelemetryFrameSampleCount = 0;
        this.gpuTelemetryFrameSampleWriteIndex = this.gpuTelemetryFrameSampleReadIndex;
        return samples;
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
        const rect = this.panelRectScratch;
        rect.x = command.x || 0;
        rect.y = command.y || 0;
        rect.w = Math.max(0, command.w || 0);
        rect.h = Math.max(0, command.h || 0);
        return rect;
    }

    /**
     * @private
     * shadow를 포함할 수 있도록 rect를 확장합니다.
     * @param {{x:number, y:number, w:number, h:number}} panelRect - 기준 패널 rect입니다.
     * @param {number} shadowRadius - shadow blur 반경입니다.
     * @param {number} shadowOffsetX - shadow X 오프셋입니다.
     * @param {number} shadowOffsetY - shadow Y 오프셋입니다.
     * @returns {{x:number, y:number, w:number, h:number}} 확장된 draw rect입니다.
     */
    #buildExpandedRect(panelRect, shadowRadius, shadowOffsetX, shadowOffsetY) {
        const pad = Math.max(0, shadowRadius * 3.0) + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY));
        const rect = this.expandedRectScratch;
        rect.x = panelRect.x - pad;
        rect.y = panelRect.y - pad;
        rect.w = panelRect.w + (pad * 2);
        rect.h = panelRect.h + (pad * 2);
        return rect;
    }

    /**
     * command 행렬을 uniform 업로드용 재사용 버퍼로 정규화합니다.
     * @param {number[]|Float32Array|null|undefined} value - 원본 행렬입니다.
     * @returns {Float32Array} 사용할 행렬입니다.
     * @private
     */
    #resolveTransformMatrix(value) {
        if (value instanceof Float32Array && value.length === 16) {
            return value;
        }
        if (Array.isArray(value) && value.length === 16) {
            this.transformMatrixScratch.set(value);
            return this.transformMatrixScratch;
        }
        return OverlayEffectRenderer.IDENTITY_MATRIX;
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

        const finalTarget = this.upTargets[0] || this.downTargets[this.downTargets.length - 1] || this.sceneTarget;
        this.blurOutputScaleSignature = `${finalTarget.width}x${finalTarget.height}/${this.width}x${this.height}`;
        this.blurPassSignature = `down:${this.downTargets.length}|up:${this.upTargets.length}|order:reverse`;

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
     * WebGL 프로그램 정보를 정리합니다.
     * @param {{program?: WebGLProgram}|null|undefined} programInfo - 삭제할 프로그램 정보입니다.
     */
    #deleteProgramInfo(programInfo) {
        if (programInfo?.program) {
            this.gl.deleteProgram(programInfo.program);
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
        const texture = this.#createTextureParameters();
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Math.max(1, width), Math.max(1, height), 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return texture;
    }

    /**
     * storage를 할당하지 않은 clamp/linear 2D 텍스처를 생성합니다.
     * @returns {WebGLTexture} 생성된 텍스처입니다.
     * @private
     */
    #createTextureParameters() {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
            return this.transparentColor;
        }

        if (value instanceof Float32Array && value.length === 4) {
            return value;
        }

        if (Array.isArray(value) && value.length === 4) {
            let cachedArrayColor = this.colorObjectCache.get(value);
            if (!cachedArrayColor) {
                cachedArrayColor = new Float32Array(value);
                this.colorObjectCache.set(value, cachedArrayColor);
            } else if (cachedArrayColor[0] !== value[0]
                || cachedArrayColor[1] !== value[1]
                || cachedArrayColor[2] !== value[2]
                || cachedArrayColor[3] !== value[3]) {
                cachedArrayColor.set(value);
            }
            return cachedArrayColor;
        }

        if (typeof value === 'string') {
            const cachedStringColor = this.colorStringCache.get(value);
            if (cachedStringColor) {
                return cachedStringColor;
            }

            const parsed = colorUtil().cssToRgb(value);
            const normalized = new Float32Array([
                parsed.r / 255,
                parsed.g / 255,
                parsed.b / 255,
                parsed.a
            ]);
            this.colorStringCache.set(value, normalized);
            if (this.colorStringCache.size > WEBGL_CONSTANTS.COLOR_CACHE_LIMIT) {
                this.colorStringCache.clear();
                this.colorStringCache.set(value, normalized);
            }
            return normalized;
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

OverlayEffectRenderer.EMPTY_SOURCES = Object.freeze([]);
OverlayEffectRenderer.EMPTY_SOURCE_SNAPSHOT = Object.freeze({
    snapshotIdentity: 'empty',
    sourceRevision: 0,
    sources: OverlayEffectRenderer.EMPTY_SOURCES
});
OverlayEffectRenderer.DISABLED_GPU_TIMER_SNAPSHOT = Object.freeze({
    status: 'disabled',
    supported: false,
    enabled: false,
    reason: 'telemetry-not-enabled',
    capacity: 0,
    pendingCount: 0,
    sampleCount: 0
});
