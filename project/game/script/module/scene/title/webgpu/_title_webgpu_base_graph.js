import { WebGpuTransientTexturePool } from 'display/webgpu/webgpu_transient_texture_pool.js';
import { WebGpuUiAtlasRegistry } from 'display/webgpu/webgpu_ui_atlas_registry.js';
import { WEBGPU_KAWASE_BLUR_ALGORITHM_ID } from 'display/webgpu/webgpu_kawase_blur_algorithm.js';
import { colorUtil } from 'util/color_util.js';
import {
    TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY,
    TitleCpuEnemyPresentationAdapter
} from './_title_cpu_enemy_presentation_adapter.js';
import { TitleWebGpuCheckpointRegistry } from './_title_webgpu_checkpoint_registry.js';
import {
    TITLE_WEBGPU_BASE_CHECKPOINT_ID,
    TITLE_WEBGPU_CENTER_BACKDROP_ID
} from './_title_webgpu_checkpoint_registry.js';
import { TitleWebGpuCompositePass } from './_title_webgpu_composite_pass.js';
import { TitleWebGpuGradientPass } from './_title_webgpu_gradient_pass.js';
import {
    TITLE_WEBGPU_ENEMY_PASS_CONSTANTS,
    TitleWebGpuEnemyPass
} from './_title_webgpu_enemy_pass.js';
import { TitleWebGpuShieldPass } from './_title_webgpu_shield_pass.js';
import { TitleWebGpuCenterCirclePass } from './_title_webgpu_center_circle_pass.js';

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const GRAPH_TEXTURE_USAGE = TEXTURE_USAGE_TEXTURE_BINDING | TEXTURE_USAGE_RENDER_ATTACHMENT;
const GRAPH_TEXTURE_POOL_CAPACITY = 24;
const GRAPH_TEXTURE_MAX_IDLE_FRAMES = 2;
const WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID = 'gaussian-quality';
const CENTER_BLUR_SIGMA_FALLBACK = 6.5;
const CENTER_KAWASE_BLUR_FALLBACK = 0.1;
const BLUR_HALO_SIGMA_MULTIPLIER = 3;
const ENEMY_PALETTE_ENTRY_COUNT = TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY * 2;
const TRANSPARENT = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const OPAQUE_BLACK_RGB = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

if (TITLE_WEBGPU_ENEMY_PASS_CONSTANTS.PALETTE_ENTRY_COUNT
    !== ENEMY_PALETTE_ENTRY_COUNT) {
    throw new Error('title enemy adapter/pass palette layer ABI가 일치하지 않습니다.');
}

/** M3 shadow graph에서 현재 검증된 blur algorithm 기본값입니다. */
export const TITLE_WEBGPU_BASE_GRAPH_DEFAULT_BLUR_ALGORITHM_ID
    = WEBGPU_KAWASE_BLUR_ALGORITHM_ID;

/** pipeline rollout mode를 등록될 blur algorithm ID에 명시적으로 연결합니다. */
export const TITLE_WEBGPU_BASE_GRAPH_BLUR_ALGORITHM_BY_PIPELINE = Object.freeze({
    'webgpu-kawase': WEBGPU_KAWASE_BLUR_ALGORITHM_ID,
    'webgpu-gaussian': WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID
});

/** @returns {string|null} graph가 지원하는 pipeline mode의 blur algorithm ID입니다. */
export function getTitleWebGpuBaseGraphBlurAlgorithmId(pipelineMode) {
    return TITLE_WEBGPU_BASE_GRAPH_BLUR_ALGORITHM_BY_PIPELINE[pipelineMode] ?? null;
}

/**
 * gradient/enemy base와 shield/center effect, logo를 offscreen checkpoint로 조립합니다.
 * swapchain canvas에는 쓰지 않고 composer의 command contribution만 사용합니다.
 */
export class TitleWebGpuBaseGraph {
    /**
     * @param {object} options - graph 의존성과 테스트 대역입니다.
     * @param {object} options.framePort - Display-owned frame contributor port입니다.
     * @param {object} options.blurPort - Display-owned shared blur port입니다.
     * @param {string} [options.blurAlgorithmId] - 등록 확인 뒤 session에 고정한 algorithm ID입니다.
     */
    constructor(options = {}) {
        this.framePort = requireFramePort(options.framePort);
        this.blurPort = requireBlurPort(options.blurPort);
        this.blurAlgorithmId = requireNonEmptyString(
            options.blurAlgorithmId ?? TITLE_WEBGPU_BASE_GRAPH_DEFAULT_BLUR_ALGORITHM_ID,
            'blurAlgorithmId'
        );
        this.texturePool = options.texturePool ?? new WebGpuTransientTexturePool({
            maxTextures: GRAPH_TEXTURE_POOL_CAPACITY,
            maxIdleFrames: GRAPH_TEXTURE_MAX_IDLE_FRAMES
        });
        this.checkpoints = options.checkpointRegistry ?? new TitleWebGpuCheckpointRegistry();
        this.uiAtlas = options.uiAtlas ?? new WebGpuUiAtlasRegistry({ maxEntries: 1 });
        this.enemyAdapter = options.enemyAdapter ?? new TitleCpuEnemyPresentationAdapter();
        this.gradientPass = options.gradientPass ?? new TitleWebGpuGradientPass();
        this.enemyPass = options.enemyPass ?? new TitleWebGpuEnemyPass();
        this.shieldPass = options.shieldPass ?? new TitleWebGpuShieldPass();
        this.centerPass = options.centerPass ?? new TitleWebGpuCenterCirclePass();
        this.compositePass = options.compositePass ?? new TitleWebGpuCompositePass({ maxLayers: 3 });

        this.activeFrame = null;
        this.lastFrameId = null;
        this.lastDeviceGeneration = null;
        this.lastDevice = null;
        this.revision = 0;
        this.destroyed = false;
        this.destroyPending = false;
        this.resourcesDestroyed = false;
        this.encodeAttemptCount = 0;
        this.encodeSuccessCount = 0;
        this.commitCount = 0;
        this.abortCount = 0;
        this.failureCount = 0;
        this.shieldInactiveSkipCount = 0;
        this.lastFailure = null;
        this.lastOutputCheckpoint = null;
        this.lastRoi = null;

        this.enemyPalette = new Float32Array(ENEMY_PALETTE_ENTRY_COUNT * 4);
        this.enemyPaletteCssSignatures = new Array(ENEMY_PALETTE_ENTRY_COUNT).fill(null);
        this.enemyPaletteLayerEnemies = new Array(
            TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY
        ).fill(null);
        this.cropLayers = Object.freeze([createCompositeLayer()]);
        this.finalLayers = Object.freeze([
            createCompositeLayer(),
            createCompositeLayer()
        ]);
        this.finalLayerSets = Object.freeze([
            Object.freeze([]),
            Object.freeze([this.finalLayers[0]]),
            this.finalLayers
        ]);
        this.centerBoundsScratch = createRect();
        this.shieldBoundsScratch = createRect();
        this.effectBoundsScratch = createRect();
        this.effectRoiScratch = createRect();
        this.textureDescriptorScratch = Array.from(
            { length: 3 },
            () => createTextureDescriptor(1, 1, 'rgba8unorm')
        );
        this.roiState = {
            roi: this.effectRoiScratch,
            bounds: createRect(),
            halo: { left: 0, top: 0, right: 0, bottom: 0 },
            centerBlurSigma: 0
        };
        this.frameState = createReusableFrameState();
        this.pendingInput = Object.seal({
            presentationSeconds: 0,
            gradientColors: null,
            enemyPacket: null,
            enemyPalette: null,
            centerCommand: null,
            shieldCommand: null,
            shieldActive: false,
            introBlur: 0,
            logoPacket: null
        });
        this.frameCallbacks = Object.freeze({
            committed: (outcome) => this.#finishFrame('committed', outcome),
            aborted: (outcome) => this.#finishFrame('aborted', outcome)
        });
        this.initialEncodeCallback = (context) => this.#encodeInitial(context);
        this.centerEncodeCallback = (context) => this.#encodeCenter(context);
        this.finalEncodeCallback = (context) => this.#encodeFinal(context);
    }

    /**
     * 현재 composer frame에 shadow-only base graph를 정확히 한 번 기록합니다.
     * @param {object} input - legacy draw 직후의 resolved presentation state입니다.
     * @returns {boolean} overlay:0 checkpoint까지 기록했으면 true입니다.
     */
    encode(input = {}) {
        this.encodeAttemptCount += 1;
        if (this.destroyed || this.activeFrame || this.framePort.isFrameActive() !== true) {
            return this.#fail('graph-unavailable-or-frame-inactive');
        }

        try {
            this.#stageInput(input);
        } catch (error) {
            return this.#fail('invalid-frame-input', error);
        }
        try {
            if (this.framePort.deferFrameCallbacks(this.frameCallbacks) !== true) {
                return this.#fail('frame-callback-registration-failed');
            }
            if (this.framePort.encodeCommands(this.initialEncodeCallback) !== true) {
                return this.#fail('initial-encode-failed');
            }
        } catch (error) {
            return this.#fail('initial-encode-threw', error);
        }

        const frame = this.activeFrame;
        if (!frame) {
            return this.#fail('initial-frame-state-missing');
        }

        try {
            if (frame.centerCheckpoint) {
                frame.centerBlurOutput = this.blurPort.encode({
                    algorithmId: this.blurAlgorithmId,
                    sourceTexture: frame.centerCheckpoint.texture,
                    sourceRevision: frame.centerCheckpoint.revision,
                    checkpointId: TITLE_WEBGPU_CENTER_BACKDROP_ID,
                    bounds: frame.blurBounds,
                    halo: frame.blurHalo,
                    sigma: frame.centerBlurSigma,
                    edgeMode: 'clamp',
                    colorSpace: 'srgb',
                    format: frame.format
                });
                if (!frame.centerBlurOutput) {
                    return this.#fail('center-blur-unavailable');
                }
                if (this.framePort.encodeCommands(this.centerEncodeCallback) !== true) {
                    return this.#fail('center-encode-failed');
                }
            }

            frame.effectOutput = frame.effectLease;
            if (frame.effectLease && frame.introBlur > 0.001) {
                frame.effectOutput = this.blurPort.encode({
                    algorithmId: this.blurAlgorithmId,
                    sourceTexture: frame.effectLease.texture,
                    sourceRevision: frame.sourceRevision,
                    checkpointId: 'title:intro-effect',
                    bounds: frame.blurBounds,
                    halo: frame.blurHalo,
                    sigma: frame.introBlur,
                    edgeMode: 'clamp',
                    colorSpace: 'srgb',
                    format: frame.format
                });
                if (!frame.effectOutput) {
                    return this.#fail('intro-group-blur-unavailable');
                }
            }

            if (this.framePort.encodeCommands(this.finalEncodeCallback) !== true) {
                return this.#fail('final-encode-failed');
            }
        } catch (error) {
            return this.#fail('graph-encode-threw', error);
        }

        this.encodeSuccessCount += 1;
        this.lastFailure = null;
        return true;
    }

    /** frame-local checkpoint를 후속 title overlay graph에 노출합니다. */
    getCheckpoint(id, context = null) {
        return this.checkpoints.get(id, context);
    }

    /** rollout 및 allocation/upload 검증용 immutable snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            status: this.destroyed
                ? (this.destroyPending ? 'destroy-pending' : 'destroyed')
                : (this.activeFrame ? 'active' : 'ready'),
            blurAlgorithmId: this.blurAlgorithmId,
            encodeAttemptCount: this.encodeAttemptCount,
            encodeSuccessCount: this.encodeSuccessCount,
            commitCount: this.commitCount,
            abortCount: this.abortCount,
            failureCount: this.failureCount,
            shieldInactiveSkipCount: this.shieldInactiveSkipCount,
            lastFailure: this.lastFailure,
            lastFrameId: this.lastFrameId,
            lastDeviceGeneration: this.lastDeviceGeneration,
            lastRoi: this.lastRoi ? Object.freeze({ ...this.lastRoi }) : null,
            hasOverlayCheckpoint: Boolean(this.lastOutputCheckpoint),
            texturePool: this.texturePool.getDiagnostics?.() ?? null,
            uiAtlas: this.uiAtlas.getDiagnostics?.() ?? null
        });
    }

    /** frame callback 뒤 generation resources를 정확히 한 번 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return false;
        }
        this.destroyed = true;
        if (this.activeFrame) {
            this.destroyPending = true;
            return true;
        }
        this.#destroyResources();
        return true;
    }

    #stageInput(input) {
        const pending = this.pendingInput;
        pending.presentationSeconds = Number.isFinite(input.presentationSeconds)
            ? input.presentationSeconds
            : 0;
        pending.gradientColors = input.gradientColors;
        pending.enemyPacket = input.enemyPacket
            ?? input.titleBackground?.getWebGpuEnemyPresentationPacket?.(this.enemyAdapter)
            ?? this.enemyAdapter.writePacket([], []);
        pending.enemyPalette = input.enemyPalette
            ?? this.#writeEnemyPalette(input.titleBackground?.titleEnemies);
        pending.centerCommand = input.centerCommand
            ?? input.centerCircle?.getPresentationCommand?.()
            ?? null;
        pending.shieldCommand = input.shieldCommand
            ?? input.titleBackground?.shieldEffect?.getPresentationCommand?.()
            ?? null;
        pending.shieldActive = hasRenderableShieldActivity(pending.shieldCommand);
        if (pending.shieldCommand && !pending.shieldActive) {
            this.shieldInactiveSkipCount += 1;
        }
        pending.introBlur = Number.isFinite(input.introBlur)
            ? Math.max(0, input.introBlur)
            : Math.max(0, Number(input.centerCircle?.introBlur) || 0);
        pending.logoPacket = input.logoPacket
            ?? input.titleLogo?.getPresentationPacket?.()
            ?? null;
    }

    #encodeInitial(context) {
        this.#assertFreshContext(context);
        this.texturePool.beginFrame(context);
        try {
            if (this.checkpoints.beginFrame(context) !== true) {
                throw new Error('title checkpoint frame을 열 수 없습니다.');
            }
        } catch (error) {
            this.texturePool.endFrame();
            throw error;
        }

        const sourceRevision = nextSafeRevision(this.revision);
        this.revision = sourceRevision;
        const frame = this.frameState;
        frame.frameId = context.frameId;
        frame.device = context.device;
        frame.deviceGeneration = context.deviceGeneration;
        frame.target = context.target;
        frame.format = context.format;
        frame.width = context.width;
        frame.height = context.height;
        frame.sourceRevision = sourceRevision;
        frame.sceneLease = null;
        frame.centerLease = null;
        frame.centerCheckpoint = null;
        frame.centerBlurOutput = null;
        frame.effectLease = null;
        frame.effectOutput = null;
        frame.outputCheckpoint = null;
        frame.introBlur = this.pendingInput.introBlur;
        this.lastRoi = null;
        this.activeFrame = frame;

        frame.sceneLease = this.texturePool.acquire(setTextureDescriptor(
            this.textureDescriptorScratch[0],
            context.width,
            context.height,
            context.format
        ));
        this.checkpoints.assertWritable(frame.sceneLease.texture);
        this.gradientPass.encode({
            context,
            targetView: frame.sceneLease.view,
            width: context.width,
            height: context.height,
            format: context.format,
            presentationSeconds: this.pendingInput.presentationSeconds,
            colors: this.pendingInput.gradientColors
        });
        this.checkpoints.assertWritable(frame.sceneLease.texture);
        this.enemyPass.encode(context, {
            packet: this.pendingInput.enemyPacket,
            targetView: frame.sceneLease.view,
            targetWidth: context.width,
            targetHeight: context.height,
            palette: this.pendingInput.enemyPalette,
            format: context.format,
            loadOp: 'load'
        });

        const roiState = this.#calculateEffectRoi(
            this.pendingInput.centerCommand,
            this.pendingInput.shieldActive ? this.pendingInput.shieldCommand : null,
            frame.introBlur,
            context.width,
            context.height
        );
        if (!roiState) {
            return;
        }
        copyRect(roiState.roi, frame.effectRoi);
        copyRect(roiState.bounds, frame.blurBounds);
        copyHalo(roiState.halo, frame.blurHalo);
        frame.centerBlurSigma = roiState.centerBlurSigma;
        this.lastRoi = frame.effectRoi;

        if (this.pendingInput.centerCommand) {
            frame.centerLease = this.texturePool.acquire(setTextureDescriptor(
                this.textureDescriptorScratch[1],
                frame.effectRoi.width,
                frame.effectRoi.height,
                frame.format
            ));
            this.checkpoints.assertWritable(frame.centerLease.texture);
            const cropLayer = this.cropLayers[0];
            setCompositeLayer(cropLayer, {
                view: frame.sceneLease.view,
                destX: 0,
                destY: 0,
                destWidth: frame.effectRoi.width,
                destHeight: frame.effectRoi.height,
                uvX: frame.effectRoi.x / frame.width,
                uvY: frame.effectRoi.y / frame.height,
                uvWidth: frame.effectRoi.width / frame.width,
                uvHeight: frame.effectRoi.height / frame.height
            });
            this.compositePass.encode(context, {
                targetView: frame.centerLease.view,
                targetWidth: frame.effectRoi.width,
                targetHeight: frame.effectRoi.height,
                format: frame.format,
                loadOp: 'clear',
                layers: this.cropLayers,
                label: `title-center-backdrop-crop:${frame.frameId}`
            });
            frame.centerCheckpoint = this.checkpoints.seal(
                TITLE_WEBGPU_CENTER_BACKDROP_ID,
                {
                    texture: frame.centerLease.texture,
                    view: frame.centerLease.view,
                    width: frame.effectRoi.width,
                    height: frame.effectRoi.height,
                    format: frame.format,
                    colorSpace: 'srgb',
                    alphaMode: 'premultiplied'
                }
            );
        }

        frame.effectLease = this.texturePool.acquire(setTextureDescriptor(
            this.textureDescriptorScratch[2],
            frame.effectRoi.width,
            frame.effectRoi.height,
            frame.format
        ));
        this.checkpoints.assertWritable(frame.effectLease.texture);
        const shieldEncoded = this.pendingInput.shieldActive
            ? this.shieldPass.encode(context, {
                command: this.pendingInput.shieldCommand,
                targetView: frame.effectLease.view,
                targetWidth: frame.effectRoi.width,
                targetHeight: frame.effectRoi.height,
                originX: frame.effectRoi.x,
                originY: frame.effectRoi.y,
                loadOp: 'clear',
                format: frame.format
            })
            : false;
        if (!shieldEncoded) {
            this.compositePass.encode(context, {
                targetView: frame.effectLease.view,
                targetWidth: frame.effectRoi.width,
                targetHeight: frame.effectRoi.height,
                format: frame.format,
                loadOp: 'clear',
                clearValue: TRANSPARENT,
                layers: [],
                label: `title-effect-clear:${frame.frameId}`
            });
        }
    }

    #encodeCenter(context) {
        const frame = this.#requireMatchingFrame(context);
        if (!frame.centerCheckpoint || !frame.centerBlurOutput || !frame.effectLease) {
            return;
        }
        this.checkpoints.assertWritable(frame.effectLease.texture);
        this.centerPass.encode(context, {
            command: this.pendingInput.centerCommand,
            backdropView: frame.centerBlurOutput.view,
            backdropWidth: frame.centerBlurOutput.width,
            backdropHeight: frame.centerBlurOutput.height,
            targetView: frame.effectLease.view,
            targetWidth: frame.effectRoi.width,
            targetHeight: frame.effectRoi.height,
            originX: frame.effectRoi.x,
            originY: frame.effectRoi.y,
            loadOp: 'load',
            format: frame.format
        });
    }

    #encodeFinal(context) {
        const frame = this.#requireMatchingFrame(context);
        let logoAtlasPacket = null;
        const logo = this.pendingInput.logoPacket;
        if (logo?.canvas && Number.isSafeInteger(logo.revision) && logo.revision >= 0
            && Number.isSafeInteger(logo.width) && logo.width > 0
            && Number.isSafeInteger(logo.height) && logo.height > 0) {
            logoAtlasPacket = this.uiAtlas.getOrUpload({
                context,
                source: logo.canvas,
                revision: logo.revision,
                width: logo.width,
                height: logo.height
            });
        }

        let layerCount = 0;
        if (frame.effectOutput && frame.effectRoi) {
            setCompositeLayer(this.finalLayers[layerCount++], {
                view: frame.effectOutput.view,
                destX: frame.effectRoi.x,
                destY: frame.effectRoi.y,
                destWidth: frame.effectRoi.width,
                destHeight: frame.effectRoi.height
            });
        }
        if (logoAtlasPacket) {
            setCompositeLayer(this.finalLayers[layerCount++], {
                view: logoAtlasPacket.view,
                destX: logo.destX,
                destY: logo.destY,
                destWidth: logo.width,
                destHeight: logo.height,
                uvWidth: logoAtlasPacket.uvScaleX,
                uvHeight: logoAtlasPacket.uvScaleY
            });
        }
        if (layerCount > 0) {
            this.checkpoints.assertWritable(frame.sceneLease.texture);
            this.compositePass.encode(context, {
                targetView: frame.sceneLease.view,
                targetWidth: frame.width,
                targetHeight: frame.height,
                format: frame.format,
                loadOp: 'load',
                layers: this.finalLayerSets[layerCount],
                label: `title-base-checkpoint:${frame.frameId}`
            });
        }
        frame.outputCheckpoint = this.checkpoints.seal(TITLE_WEBGPU_BASE_CHECKPOINT_ID, {
            texture: frame.sceneLease.texture,
            view: frame.sceneLease.view,
            width: frame.width,
            height: frame.height,
            format: frame.format,
            colorSpace: 'srgb',
            alphaMode: 'premultiplied'
        });
        this.lastOutputCheckpoint = frame.outputCheckpoint;
    }

    #calculateEffectRoi(centerCommand, shieldCommand, introBlur, width, height) {
        const centerBounds = calculateCenterBounds(
            centerCommand,
            width,
            height,
            this.centerBoundsScratch
        );
        const shieldBounds = calculateShieldBounds(
            shieldCommand,
            width,
            height,
            this.shieldBoundsScratch
        );
        const contentBounds = unionRects(
            centerBounds,
            shieldBounds,
            this.effectBoundsScratch
        );
        if (!contentBounds) {
            return null;
        }
        const centerBlurSigma = centerCommand
            ? resolveCenterBlurSigma(centerCommand.backdropBlur, this.blurAlgorithmId)
            : 0;
        const refraction = centerCommand
            ? Math.max(0, Number(centerCommand.backdropRefractionStrength) || 0)
            : 0;
        const centerHalo = centerCommand
            ? Math.ceil(Math.max(2, centerBlurSigma * BLUR_HALO_SIGMA_MULTIPLIER, refraction + 2))
            : 0;
        const introHalo = introBlur > 0.001
            ? Math.ceil(introBlur * BLUR_HALO_SIGMA_MULTIPLIER)
            : 0;
        const haloSize = Math.max(centerHalo, introHalo);
        const roi = expandRect(contentBounds, haloSize, width, height, this.effectRoiScratch);
        if (!roi) {
            return null;
        }
        const state = this.roiState;
        state.centerBlurSigma = centerBlurSigma;
        state.bounds.x = contentBounds.x - roi.x;
        state.bounds.y = contentBounds.y - roi.y;
        state.bounds.width = contentBounds.width;
        state.bounds.height = contentBounds.height;
        state.halo.left = contentBounds.x - roi.x;
        state.halo.top = contentBounds.y - roi.y;
        state.halo.right = (roi.x + roi.width) - (contentBounds.x + contentBounds.width);
        state.halo.bottom = (roi.y + roi.height) - (contentBounds.y + contentBounds.height);
        return state;
    }

    #writeEnemyPalette(enemies) {
        const palette = this.enemyPalette;
        const source = Array.isArray(enemies) ? enemies : [];
        const util = colorUtil();
        const layerEnemies = this.enemyPaletteLayerEnemies;
        layerEnemies.fill(null);
        let remainingLayers = TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY;
        for (let index = 0; index < source.length && remainingLayers > 0; index++) {
            const candidate = source[index];
            const candidateLayer = Number.isInteger(candidate?._titleParallaxLayerIndex)
                ? candidate._titleParallaxLayerIndex
                : 0;
            if (candidate?.active === false
                || candidateLayer < 0
                || candidateLayer >= TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY
                || layerEnemies[candidateLayer]) {
                continue;
            }
            layerEnemies[candidateLayer] = candidate;
            remainingLayers -= 1;
        }

        for (let layerIndex = 0;
            layerIndex < TITLE_CPU_ENEMY_PRESENTATION_LAYER_CAPACITY;
            layerIndex++) {
            const enemy = layerEnemies[layerIndex];
            writeCssColorIfChanged(
                palette,
                layerIndex * 8,
                layerIndex * 2,
                enemy?._titleParallaxFill ?? enemy?.fill,
                util,
                this.enemyPaletteCssSignatures
            );
            writeCssColorIfChanged(
                palette,
                (layerIndex * 8) + 4,
                (layerIndex * 2) + 1,
                enemy?._titleParallaxBlurFill ?? enemy?._titleParallaxFill ?? enemy?.fill,
                util,
                this.enemyPaletteCssSignatures
            );
        }
        return palette;
    }

    #assertFreshContext(context) {
        requireFrameContext(context);
        if (this.lastDeviceGeneration !== null) {
            if (context.deviceGeneration < this.lastDeviceGeneration) {
                throw new Error('stale title base graph device generation입니다.');
            }
            if (context.deviceGeneration === this.lastDeviceGeneration
                && this.lastDevice !== null
                && context.device !== this.lastDevice) {
                throw new Error('generation 변경 없는 title base graph device drift입니다.');
            }
            if (context.deviceGeneration === this.lastDeviceGeneration
                && this.lastFrameId !== null
                && context.frameId <= this.lastFrameId) {
                throw new Error('title base graph frame은 generation마다 한 번만 증가해야 합니다.');
            }
        }
    }

    #requireMatchingFrame(context) {
        requireFrameContext(context);
        const frame = this.activeFrame;
        if (!frame
            || context.frameId !== frame.frameId
            || context.device !== frame.device
            || context.deviceGeneration !== frame.deviceGeneration
            || context.target !== frame.target
            || context.format !== frame.format
            || context.width !== frame.width
            || context.height !== frame.height) {
            throw new Error('title base graph frame/generation/resize drift입니다.');
        }
        return frame;
    }

    #finishFrame(outcome) {
        const frame = this.activeFrame;
        if (frame) {
            this.lastFrameId = frame.frameId;
            this.lastDeviceGeneration = frame.deviceGeneration;
            this.lastDevice = frame.device;
        }
        try {
            this.checkpoints.endFrame();
        } catch (error) {
            this.#fail('checkpoint-cleanup-failed', error);
        }
        try {
            if (this.texturePool.getDiagnostics?.().frameActive === true) {
                this.texturePool.endFrame();
            }
        } catch (error) {
            this.#fail('texture-pool-cleanup-failed', error);
        }
        this.activeFrame = null;
        this.lastOutputCheckpoint = null;
        if (outcome === 'committed') {
            this.commitCount += 1;
        } else {
            this.abortCount += 1;
        }
        if (this.destroyPending) {
            this.destroyPending = false;
            this.#destroyResources();
        }
    }

    #destroyResources() {
        if (this.resourcesDestroyed) {
            return;
        }
        this.resourcesDestroyed = true;
        for (const resource of [
            this.gradientPass,
            this.enemyPass,
            this.shieldPass,
            this.centerPass,
            this.compositePass,
            this.uiAtlas,
            this.texturePool
        ]) {
            try {
                resource?.destroy?.();
            } catch (error) {
                this.#fail('resource-destroy-failed', error);
            }
        }
    }

    #fail(reason, error = null) {
        this.failureCount += 1;
        this.lastFailure = Object.freeze({
            reason,
            message: error?.message ?? (error ? String(error) : null)
        });
        return false;
    }
}

function createTextureDescriptor(width, height, format) {
    return {
        width,
        height,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        format,
        usage: GRAPH_TEXTURE_USAGE,
        viewDimension: '2d'
    };
}

function setTextureDescriptor(descriptor, width, height, format) {
    descriptor.width = width;
    descriptor.height = height;
    descriptor.format = format;
    return descriptor;
}

function createCompositeLayer() {
    return {
        view: null,
        destX: 0,
        destY: 0,
        destWidth: 1,
        destHeight: 1,
        uvX: 0,
        uvY: 0,
        uvWidth: 1,
        uvHeight: 1,
        opacity: 1
    };
}

function setCompositeLayer(layer, input) {
    layer.view = input.view;
    layer.destX = input.destX;
    layer.destY = input.destY;
    layer.destWidth = input.destWidth;
    layer.destHeight = input.destHeight;
    layer.uvX = input.uvX ?? 0;
    layer.uvY = input.uvY ?? 0;
    layer.uvWidth = input.uvWidth ?? 1;
    layer.uvHeight = input.uvHeight ?? 1;
    layer.opacity = input.opacity ?? 1;
}

function calculateCenterBounds(command, width, height, out) {
    if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
        return null;
    }
    const radius = Math.max(1, command.radius);
    const outlineWidth = Number.isFinite(command.outlineWidth)
        ? Math.max(1, command.outlineWidth)
        : Math.max(1, radius * 0.025);
    const padding = Math.max(
        Number.isFinite(command.scissorPaddingMin) ? command.scissorPaddingMin : 28,
        radius * (Number.isFinite(command.scissorPaddingRatio)
            ? Math.max(0, command.scissorPaddingRatio)
            : 0.86)
    );
    return circleToClippedRect(
        Number(command.x) || 0,
        Number(command.y) || 0,
        radius + padding + (outlineWidth * 4),
        width,
        height,
        out
    );
}

function calculateShieldBounds(command, width, height, out) {
    if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
        return null;
    }
    const ringThickness = Number.isFinite(command.ringThickness)
        ? Math.max(1, command.ringThickness)
        : 6;
    const glowWidth = Number.isFinite(command.glowWidth)
        ? Math.max(1, command.glowWidth)
        : 24;
    const fieldRadius = Number.isFinite(command.fieldRadius)
        ? Math.max(command.radius, command.fieldRadius)
        : command.radius;
    const boundsRadius = Math.max(
        fieldRadius,
        command.radius + (glowWidth * 3) + (ringThickness * 8) + 16
    );
    return circleToClippedRect(
        Number(command.x) || 0,
        Number(command.y) || 0,
        boundsRadius,
        width,
        height,
        out
    );
}

function circleToClippedRect(centerX, centerY, radius, width, height, out) {
    const left = Math.max(0, Math.floor(centerX - radius));
    const top = Math.max(0, Math.floor(centerY - radius));
    const right = Math.min(width, Math.ceil(centerX + radius));
    const bottom = Math.min(height, Math.ceil(centerY + radius));
    if (right <= left || bottom <= top) {
        return null;
    }
    out.x = left;
    out.y = top;
    out.width = right - left;
    out.height = bottom - top;
    return out;
}

function unionRects(left, right, out) {
    if (!left && !right) return null;
    if (!left) return copyRect(right, out);
    if (!right) return copyRect(left, out);
    const x = Math.min(left.x, right.x);
    const y = Math.min(left.y, right.y);
    const maxX = Math.max(left.x + left.width, right.x + right.width);
    const maxY = Math.max(left.y + left.height, right.y + right.height);
    out.x = x;
    out.y = y;
    out.width = maxX - x;
    out.height = maxY - y;
    return out;
}

function expandRect(rect, halo, width, height, out) {
    const x = Math.max(0, rect.x - halo);
    const y = Math.max(0, rect.y - halo);
    const maxX = Math.min(width, rect.x + rect.width + halo);
    const maxY = Math.min(height, rect.y + rect.height + halo);
    if (maxX <= x || maxY <= y) return null;
    out.x = x;
    out.y = y;
    out.width = maxX - x;
    out.height = maxY - y;
    return out;
}

function copyRect(source, target) {
    target.x = source.x;
    target.y = source.y;
    target.width = source.width;
    target.height = source.height;
    return target;
}

function createRect() {
    return { x: 0, y: 0, width: 0, height: 0 };
}

function createReusableFrameState() {
    return {
        frameId: 0,
        device: null,
        deviceGeneration: 0,
        target: null,
        format: '',
        width: 0,
        height: 0,
        sourceRevision: 0,
        sceneLease: null,
        centerLease: null,
        centerCheckpoint: null,
        centerBlurOutput: null,
        effectLease: null,
        effectOutput: null,
        outputCheckpoint: null,
        effectRoi: createRect(),
        blurBounds: createRect(),
        blurHalo: { left: 0, top: 0, right: 0, bottom: 0 },
        centerBlurSigma: 0,
        introBlur: 0
    };
}

function copyHalo(source, target) {
    target.left = source.left;
    target.top = source.top;
    target.right = source.right;
    target.bottom = source.bottom;
    return target;
}

function resolveCenterBlurSigma(value, algorithmId) {
    const rawValue = Number.isFinite(value)
        ? Math.max(0, Number(value))
        : (algorithmId === WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID
            ? CENTER_BLUR_SIGMA_FALLBACK
            : CENTER_KAWASE_BLUR_FALLBACK);
    if (algorithmId === WEBGPU_GAUSSIAN_BLUR_ALGORITHM_ID) {
        return rawValue > 1 ? rawValue : CENTER_BLUR_SIGMA_FALLBACK;
    }
    return rawValue;
}

function hasRenderableShieldActivity(command) {
    if (!command || !Number.isFinite(command.radius) || command.radius <= 0) {
        return false;
    }
    return hasPresentEntry(command.impacts) || hasPresentEntry(command.dents);
}

function hasPresentEntry(value) {
    if (!Array.isArray(value)) {
        return false;
    }
    for (let index = 0; index < value.length; index++) {
        if (value[index]) {
            return true;
        }
    }
    return false;
}

function writeCssColorIfChanged(target, offset, signatureIndex, cssColor, util, signatures) {
    const signature = typeof cssColor === 'string' ? cssColor : '';
    if (signatures[signatureIndex] === signature) {
        return;
    }
    signatures[signatureIndex] = signature;
    const color = util?.cssToRgb?.(cssColor) ?? OPAQUE_BLACK_RGB;
    target[offset] = clampColor(color.r / 255);
    target[offset + 1] = clampColor(color.g / 255);
    target[offset + 2] = clampColor(color.b / 255);
    target[offset + 3] = clampColor(Number.isFinite(color.a) ? color.a : 1);
}

function clampColor(value) {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function nextSafeRevision(value) {
    return Number.isSafeInteger(value) && value < Number.MAX_SAFE_INTEGER ? value + 1 : 1;
}

function requireFramePort(port) {
    for (const method of ['isFrameActive', 'encodeCommands', 'deferFrameCallbacks']) {
        if (typeof port?.[method] !== 'function') {
            throw new TypeError(`title base graph framePort.${method}()가 필요합니다.`);
        }
    }
    return port;
}

function requireBlurPort(port) {
    if (typeof port?.encode !== 'function') {
        throw new TypeError('title base graph blurPort.encode()가 필요합니다.');
    }
    return port;
}

function requireFrameContext(context) {
    if (!Number.isSafeInteger(context?.frameId) || context.frameId < 0
        || !Number.isSafeInteger(context?.deviceGeneration) || context.deviceGeneration < 0
        || !Number.isSafeInteger(context?.width) || context.width <= 0
        || !Number.isSafeInteger(context?.height) || context.height <= 0
        || !context?.device || !context?.encoder || !context?.target
        || typeof context.format !== 'string' || context.format.length === 0) {
        throw new TypeError('title base graph composer context가 유효하지 않습니다.');
    }
    return context;
}

function requireNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`title base graph ${name}가 필요합니다.`);
    }
    return value.trim();
}
