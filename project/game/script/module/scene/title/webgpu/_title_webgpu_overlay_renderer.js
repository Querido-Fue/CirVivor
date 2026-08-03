import { WebGpuTransientTexturePool } from 'display/webgpu/webgpu_transient_texture_pool.js';
import { WebGpuUiAtlasRegistry } from 'display/webgpu/webgpu_ui_atlas_registry.js';
import { TitleWebGpuLayerStackPass } from './_title_webgpu_layer_stack_pass.js';
import { TitleWebGpuOverlayGlassPass } from './_title_webgpu_overlay_glass_pass.js';

const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_RENDER_ATTACHMENT = 0x10;
const TRANSIENT_TEXTURE_USAGE = TEXTURE_USAGE_TEXTURE_BINDING
    | TEXTURE_USAGE_RENDER_ATTACHMENT;
const ROI_ALIGNMENT = 16;
const DEFAULT_MAX_TEXTURES = 8;
const DEFAULT_MAX_UI_ENTRIES = 12;
const DEFAULT_MAX_LAYER_NODES = 64;
const TRANSPARENT_CLEAR = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const FULL_CONTENT_ORIGIN = Object.freeze({ x: 0.5, y: 0.5 });

/** ROI materialization과 final overlay draw가 공유하는 정렬 단위입니다. */
export const TITLE_WEBGPU_OVERLAY_ROI_ALIGNMENT = ROI_ALIGNMENT;

/**
 * TitleWebGpuOverlayGraph의 concrete pass bundle입니다. GPU 제출과 canvas texture
 * 획득은 하지 않고, composer가 제공한 encoder/pass에만 명령을 기록합니다.
 */
export class TitleWebGpuOverlayRenderer {
    constructor({
        framePort,
        blurPort,
        maxTextures = DEFAULT_MAX_TEXTURES,
        maxUiEntries = DEFAULT_MAX_UI_ENTRIES
    } = {}) {
        this.framePort = requireFramePort(framePort);
        this.blurPort = requireBlurPort(blurPort);
        this.maxTextures = requirePositiveSafeInteger(maxTextures, 'maxTextures');
        this.maxUiEntries = requirePositiveSafeInteger(maxUiEntries, 'maxUiEntries');
        this.texturePool = new WebGpuTransientTexturePool({
            maxTextures: this.maxTextures,
            maxIdleFrames: 2,
            allowFrameOverflow: true
        });
        this.uiAtlas = new WebGpuUiAtlasRegistry({
            maxEntries: this.maxUiEntries,
            allowFrameOverflow: true
        });
        this.layerPasses = new Map();
        this.glassPass = null;
        this.device = null;
        this.deviceGeneration = null;
        this.presentationFormat = null;
        this.activeFrame = null;
        this.destroyed = false;
        this.resourcesDestroyed = false;

        this.beginAttemptCount = 0;
        this.beginCount = 0;
        this.commitCount = 0;
        this.abortCount = 0;
        this.failureCount = 0;
        this.materializeCount = 0;
        this.stageCount = 0;
        this.presentCount = 0;
        this.compactCount = 0;
        this.roiMaterializeCount = 0;
        this.fullScreenMaterializeFallbackCount = 0;
        this.stageTextureCount = 0;
        this.stageRoiCropCount = 0;
        this.stageRoiCroppedPixelCount = 0;
        this.analyticPassthroughStageCount = 0;
        this.analyticPassthroughNodeCount = 0;
        this.emptyAnalyticBasePassElisionCount = 0;
        this.glassFirstWriterClearCount = 0;
        this.uiFirstWriterClearCount = 0;
        this.emptyStageFallbackClearCount = 0;
        this.contentRoiCropCount = 0;
        this.contentRoiCroppedPixelCount = 0;
        this.contentFullScreenSourceCount = 0;
        this.contentFullScreenSourceReasons = new Map();
        this.glassPanelCount = 0;
        this.flatGlassPanelCount = 0;
        this.missingBackdropFallbackCount = 0;
        this.uiSurfaceCount = 0;
        this.externalUploadCount = 0;
        this.externalUploadedPixelCount = 0;
        this.uiUploadCount = 0;
        this.uiCacheHitCount = 0;
        this.steadyUiCacheHitCount = 0;
        this.effectTextureUploadCount = 0;
        this.effectTextureUploadedPixelCount = 0;
        this.effectTextureCacheHitCount = 0;
        this.steadyEffectTextureCacheHitCount = 0;
        this.transparentFallbackCreateCount = 0;
        this.generationRecreateCount = 0;
        this.passDestroyCount = 0;
        this.lastFailure = null;
        this.lastSettledFrame = null;

        const renderer = this;
        this.ports = Object.freeze({
            materializePass: Object.freeze({
                encode(context, input) {
                    return renderer.#encodeMaterialize(context, input);
                }
            }),
            stagePass: Object.freeze({
                encode(context, input) {
                    return renderer.#encodeStage(context, input);
                }
            }),
            presentPass: Object.freeze({
                encode(pass, context, input) {
                    return renderer.#encodePresent(pass, context, input);
                }
            }),
            compactPass: Object.freeze({
                encode(context, input) {
                    return renderer.#encodeCompact(context, input);
                }
            })
        });
    }

    /** composer frame outcome에 transient resource cleanup을 묶습니다. */
    beginFrame(frameId) {
        this.beginAttemptCount += 1;
        if (this.destroyed
            || this.activeFrame
            || this.framePort.isFrameActive() !== true) {
            return this.#fail('renderer-unavailable-or-frame-inactive');
        }
        let normalizedFrameId;
        try {
            normalizedFrameId = requireNonNegativeSafeInteger(frameId, 'frameId');
        } catch (error) {
            return this.#fail('invalid-frame-id', error);
        }

        const frame = createFrameState(normalizedFrameId);
        let accepted = false;
        try {
            accepted = this.framePort.deferFrameCallbacks(Object.freeze({
                committed: (outcome) => this.#settleFrame(frame, 'committed', outcome),
                aborted: (outcome) => this.#settleFrame(frame, 'aborted', outcome)
            })) === true;
        } catch (error) {
            return this.#fail('frame-callback-registration-threw', error);
        }
        if (!accepted) {
            return this.#fail('frame-callback-registration-failed');
        }

        this.activeFrame = frame;
        this.beginCount += 1;
        this.lastFailure = null;
        return true;
    }

    /** TitleWebGpuOverlayGraph constructor에 그대로 전달할 concrete ports입니다. */
    getPorts() {
        return this.ports;
    }

    getDiagnostics() {
        const layerPasses = [];
        for (const [format, pass] of this.layerPasses.entries()) {
            layerPasses.push(Object.freeze({ format, ...pass.getDiagnostics() }));
        }
        layerPasses.sort((left, right) => left.format.localeCompare(right.format));
        let blur = null;
        try {
            blur = typeof this.blurPort.getSnapshot === 'function'
                ? this.blurPort.getSnapshot()
                : null;
        } catch {
            blur = null;
        }
        return Object.freeze({
            status: this.destroyed
                ? 'destroyed'
                : (this.activeFrame ? 'active' : 'ready'),
            resourcesDestroyed: this.resourcesDestroyed,
            activeFrameId: this.activeFrame?.frameId ?? null,
            deviceGeneration: this.deviceGeneration,
            presentationFormat: this.presentationFormat,
            maxTextures: this.maxTextures,
            maxUiEntries: this.maxUiEntries,
            beginAttemptCount: this.beginAttemptCount,
            beginCount: this.beginCount,
            commitCount: this.commitCount,
            abortCount: this.abortCount,
            failureCount: this.failureCount,
            materializeCount: this.materializeCount,
            stageCount: this.stageCount,
            presentCount: this.presentCount,
            compactCount: this.compactCount,
            roiMaterializeCount: this.roiMaterializeCount,
            fullScreenMaterializeFallbackCount:
                this.fullScreenMaterializeFallbackCount,
            stageTextureCount: this.stageTextureCount,
            stageRoiCropCount: this.stageRoiCropCount,
            stageRoiCroppedPixelCount: this.stageRoiCroppedPixelCount,
            analyticPassthroughStageCount: this.analyticPassthroughStageCount,
            analyticPassthroughNodeCount: this.analyticPassthroughNodeCount,
            emptyAnalyticBasePassElisionCount:
                this.emptyAnalyticBasePassElisionCount,
            glassFirstWriterClearCount: this.glassFirstWriterClearCount,
            uiFirstWriterClearCount: this.uiFirstWriterClearCount,
            emptyStageFallbackClearCount: this.emptyStageFallbackClearCount,
            contentRoiCropCount: this.contentRoiCropCount,
            contentRoiCroppedPixelCount: this.contentRoiCroppedPixelCount,
            contentFullScreenSourceCount: this.contentFullScreenSourceCount,
            contentFullScreenSourceReasons: snapshotCountMap(
                this.contentFullScreenSourceReasons
            ),
            glassPanelCount: this.glassPanelCount,
            flatGlassPanelCount: this.flatGlassPanelCount,
            missingBackdropFallbackCount: this.missingBackdropFallbackCount,
            uiSurfaceCount: this.uiSurfaceCount,
            externalUploadCount: this.externalUploadCount,
            externalUploadedPixelCount: this.externalUploadedPixelCount,
            uiUploadCount: this.uiUploadCount,
            uiCacheHitCount: this.uiCacheHitCount,
            steadyUiCacheHitCount: this.steadyUiCacheHitCount,
            effectTextureUploadCount: this.effectTextureUploadCount,
            effectTextureUploadedPixelCount: this.effectTextureUploadedPixelCount,
            effectTextureCacheHitCount: this.effectTextureCacheHitCount,
            steadyEffectTextureCacheHitCount:
                this.steadyEffectTextureCacheHitCount,
            transparentFallbackCreateCount: this.transparentFallbackCreateCount,
            generationRecreateCount: this.generationRecreateCount,
            passDestroyCount: this.passDestroyCount,
            lastSettledFrame: this.lastSettledFrame,
            lastFailure: this.lastFailure,
            texturePool: this.texturePool.getDiagnostics(),
            uiAtlas: this.uiAtlas.getDiagnostics(),
            layerPasses: Object.freeze(layerPasses),
            glassPass: this.glassPass?.getDiagnostics() ?? null,
            blur
        });
    }

    destroy() {
        if (this.destroyed) return false;
        this.destroyed = true;
        // active encoder가 참조한 texture/buffer는 submit/abort outcome 전에는
        // 폐기할 수 없습니다. 등록된 frame callback이 teardown까지 마칩니다.
        if (!this.activeFrame) this.#destroyOwnedResources();
        return true;
    }

    #encodeMaterialize(context, input = {}) {
        const frame = this.#acceptContext(context);
        const checkpoint = requireCheckpoint(input.checkpoint);
        let logicalBounds = calculateAlignedRoi(
            input.bounds,
            input.halo,
            checkpoint.width,
            checkpoint.height
        );
        const sourceNodes = flattenCheckpoint(checkpoint);
        if (requiresFullScreenCropFallback(
            sourceNodes,
            logicalBounds,
            checkpoint.width,
            checkpoint.height
        )) {
            logicalBounds = Object.freeze({
                x: 0,
                y: 0,
                width: checkpoint.width,
                height: checkpoint.height
            });
            this.fullScreenMaterializeFallbackCount += 1;
        } else {
            this.roiMaterializeCount += 1;
        }

        const format = requireFormat(input.format ?? checkpoint.format);
        const lease = this.#acquireTexture(frame, {
            width: logicalBounds.width,
            height: logicalBounds.height,
            format
        });
        const nodes = adaptNodesForCrop(
            sourceNodes,
            logicalBounds,
            checkpoint.width,
            checkpoint.height
        );
        this.#getLayerPass(format).encodeOffscreen(
            withTargetFormat(context, format),
            {
                targetView: lease.view,
                width: logicalBounds.width,
                height: logicalBounds.height,
                nodes,
                clear: TRANSPARENT_CLEAR,
                label: input.label ?? `title-overlay-materialize:${context.frameId}`
            }
        );

        const resource = this.#createTrackedResource(frame, {
            lease,
            width: logicalBounds.width,
            height: logicalBounds.height,
            format,
            context,
            logicalBounds,
            colorSpace: input.colorSpace ?? checkpoint.colorSpace
        });
        frame.backdropLogicalBounds.set(
            createBackdropPlanKey(input.stageId, input.bounds, input.halo),
            logicalBounds
        );
        let stageResources = frame.materializationResources.get(input.stageId);
        if (!stageResources) {
            stageResources = new Set();
            frame.materializationResources.set(input.stageId, stageResources);
        }
        stageResources.add(resource);
        this.materializeCount += 1;
        return resource;
    }

    #encodeStage(context, input = {}) {
        const frame = this.#acceptContext(context);
        const record = requireRecord(input.record);
        const sourceCheckpoint = requireCheckpoint(input.sourceCheckpoint);
        const payload = normalizePayload(record.payload);
        const backdropOutputs = Array.isArray(input.backdropOutputs)
            ? input.backdropOutputs
            : [];
        const analyticNodes = normalizeNodeList(payload.analyticNodes);
        const glassPanels = normalizeEntryList(payload.glassPanels);
        const uiSurfaces = normalizeEntryList(payload.uiSurfaces);
        const stageOpacity = clamp01(payload.opacity ?? 1, 'payload.opacity');
        const stageContentScale = requirePositiveFinite(
            payload.contentScale ?? 1,
            'payload.contentScale'
        );
        const stageContentOrigin = normalizeContentOrigin(payload.contentOrigin);
        const stageLogicalBounds = resolveStageRenderBounds({
            requestedBounds: payload.renderBounds,
            contentBlurs: record.contentBlurs,
            contentScale: stageContentScale,
            width: context.width,
            height: context.height
        });
        const stageIsCropped = !isFullScreenBounds(
            stageLogicalBounds,
            context.width,
            context.height
        );
        const stageWidth = stageLogicalBounds.width;
        const stageHeight = stageLogicalBounds.height;

        if (isPureAnalyticStage({
            record,
            backdropOutputs,
            analyticNodes,
            glassPanels,
            uiSurfaces,
            stageOpacity,
            stageContentScale
        })) {
            const node = Object.freeze(analyticNodes.slice());
            this.stageCount += 1;
            this.analyticPassthroughStageCount += 1;
            this.analyticPassthroughNodeCount += node.length;
            this.#releaseStageMaterializations(frame, record.id);
            return Object.freeze({ node, contentSource: null });
        }

        const lease = this.#acquireTexture(frame, {
            width: stageWidth,
            height: stageHeight,
            format: context.format
        });
        let stageTargetWritten = false;
        if (analyticNodes.length > 0) {
            this.#getLayerPass(context.format).encodeOffscreen(context, {
                targetView: lease.view,
                width: stageWidth,
                height: stageHeight,
                nodes: stageIsCropped
                    ? adaptNodesForCrop(
                        analyticNodes,
                        stageLogicalBounds,
                        context.width,
                        context.height
                    )
                    : analyticNodes,
                clear: TRANSPARENT_CLEAR,
                label: `title-overlay-stage-base:${context.frameId}:${record.id}`
            });
            stageTargetWritten = true;
        } else {
            this.emptyAnalyticBasePassElisionCount += 1;
        }

        const glassBatchEntries = [];
        let sampledPanelOrdinal = 0;
        for (const entry of glassPanels) {
            const panel = requirePanel(entry?.panel ?? entry);
            const samplesBackdrop = panel.sampleBackdrop !== false;
            const hasExplicitBackdropIndex = Boolean(entry?.panel)
                && Object.prototype.hasOwnProperty.call(entry, 'backdropIndex');
            const missingBackdrop = samplesBackdrop
                && hasExplicitBackdropIndex
                && entry.backdropIndex == null;
            let backdrop;
            let backdropIndex = null;
            if (samplesBackdrop && !missingBackdrop) {
                backdropIndex = entry?.panel
                    ? normalizeOptionalIndex(entry.backdropIndex, sampledPanelOrdinal)
                    : normalizeOptionalIndex(panel.backdropIndex, sampledPanelOrdinal);
                sampledPanelOrdinal += 1;
                backdrop = requireTextureResource(
                    backdropOutputs[backdropIndex],
                    `glass backdropOutputs[${backdropIndex}]`
                );
            } else {
                backdrop = this.#getTransparentFallback(context, frame);
                if (missingBackdrop) this.missingBackdropFallbackCount += 1;
                else this.flatGlassPanelCount += 1;
            }

            const request = samplesBackdrop && !missingBackdrop
                ? normalizeStageBackdropRequest(
                    record.backdropBlurs[backdropIndex],
                    record.bounds
                )
                : null;
            const logicalBounds = samplesBackdrop && !missingBackdrop
                ? this.#resolveBackdropLogicalBounds(
                    frame,
                    record.id,
                    request,
                    backdrop,
                    sourceCheckpoint
                )
                : Object.freeze({
                    x: 0,
                    y: 0,
                    width: context.width,
                    height: context.height
                });
            const effectTexture = panel.effectTextureCanvas
                ? this.#uploadEffectTexture(context, frame, payload, panel)
                : null;
            const panelOpacity = entry?.panel ? entry.opacity : panel.opacity;
            glassBatchEntries.push(Object.freeze({
                backdropView: backdrop.view,
                backdropWidth: backdrop.width,
                backdropHeight: backdrop.height,
                backdropLogicalBounds: toGlassBounds(logicalBounds),
                panel,
                opacity: panelOpacity ?? 1,
                effectTextureView: effectTexture?.view,
                effectTextureWidth: effectTexture?.width,
                effectTextureHeight: effectTexture?.height,
                effectTextureFlipY:
                    panel.effectTextureCanvas?.__overlayTextureFlipY === true,
                effectTextureRect: normalizeEffectTextureRect(
                    panel.effectTextureRect
                )
            }));
            this.glassPanelCount += 1;
        }
        if (glassBatchEntries.length > 0) {
            const glassWasFirstWriter = !stageTargetWritten;
            const glassDrawCount = this.#getGlassPass(context).encodeBatch(context, {
                targetView: lease.view,
                targetWidth: stageWidth,
                targetHeight: stageHeight,
                targetOriginX: stageLogicalBounds.x,
                targetOriginY: stageLogicalBounds.y,
                logicalTargetWidth: context.width,
                logicalTargetHeight: context.height,
                entries: glassBatchEntries,
                clear: glassWasFirstWriter
            });
            if (glassDrawCount > 0) {
                stageTargetWritten = true;
                if (glassWasFirstWriter) this.glassFirstWriterClearCount += 1;
            }
        }

        const uiNodes = [];
        for (const uiSurface of uiSurfaces) {
            uiNodes.push(this.#uploadUiSurface(
                context,
                frame,
                uiSurface,
                payload.bounds ?? record.bounds
            ));
            this.uiSurfaceCount += 1;
        }
        if (uiNodes.length > 0) {
            const uiWasFirstWriter = !stageTargetWritten;
            this.#getLayerPass(context.format).encodeOffscreen(context, {
                targetView: lease.view,
                width: stageWidth,
                height: stageHeight,
                nodes: stageIsCropped
                    ? adaptNodesForCrop(
                        uiNodes,
                        stageLogicalBounds,
                        context.width,
                        context.height
                    )
                    : uiNodes,
                clear: uiWasFirstWriter ? TRANSPARENT_CLEAR : false,
                label: `title-overlay-stage-ui:${context.frameId}:${record.id}`
            });
            stageTargetWritten = true;
            if (uiWasFirstWriter) this.uiFirstWriterClearCount += 1;
        }

        if (!stageTargetWritten) {
            this.#getLayerPass(context.format).encodeOffscreen(context, {
                targetView: lease.view,
                width: stageWidth,
                height: stageHeight,
                nodes: [],
                clear: TRANSPARENT_CLEAR,
                label: `title-overlay-stage-empty:${context.frameId}:${record.id}`
            });
            this.emptyStageFallbackClearCount += 1;
        }

        const resource = this.#createTrackedResource(frame, {
            lease,
            width: stageWidth,
            height: stageHeight,
            format: context.format,
            context,
            logicalBounds: stageLogicalBounds,
            colorSpace: sourceCheckpoint.colorSpace
        });
        const node = Object.freeze({
            kind: 'texture',
            texture: resource.texture,
            view: resource.view,
            resource,
            screenBounds: stageLogicalBounds,
            sourceLogicalOrigin: Object.freeze({
                x: stageLogicalBounds.x,
                y: stageLogicalBounds.y
            }),
            sourceLogicalSize: Object.freeze({
                width: stageWidth,
                height: stageHeight
            }),
            opacity: stageOpacity,
            contentScale: stageContentScale,
            contentOrigin: stageContentOrigin
        });
        this.stageCount += 1;
        this.stageTextureCount += 1;
        if (stageIsCropped) {
            this.stageRoiCropCount += 1;
            this.stageRoiCroppedPixelCount += stageWidth * stageHeight;
        }
        const contentSource = this.#encodeContentSourceCrop(
            context,
            frame,
            record,
            resource
        );
        // 같은 encoder 안에서 backdrop의 마지막 read가 이미 기록됐으므로 이후
        // stage가 exact descriptor texture를 안전하게 재사용할 수 있습니다.
        this.#releaseStageMaterializations(frame, record.id);
        return Object.freeze({ node, contentSource });
    }

    /**
     * recording이 증명한 단일 content ROI만 full stage에서 잘라 blur source로 만듭니다.
     * 다중/누락/full-screen 요청은 의미가 불명확하므로 기존 full source를 유지합니다.
     */
    #encodeContentSourceCrop(context, frame, record, stageResource) {
        const requests = Array.isArray(record.contentBlurs)
            ? record.contentBlurs
            : [];
        if (requests.length === 0) return stageResource;
        if (requests.length !== 1) {
            this.#recordContentFullScreenSource('content-blur-request-count-not-one');
            return stageResource;
        }
        const logicalBounds = calculateAlignedRoi(
            requests[0]?.bounds,
            requests[0]?.halo,
            context.width,
            context.height
        );
        if (isFullScreenBounds(logicalBounds, context.width, context.height)) {
            const roiDiagnostic = requests[0]?.contentRoi;
            this.#recordContentFullScreenSource(
                normalizeContentRoiFallbackReason(roiDiagnostic?.reason)
                    ?? (roiDiagnostic?.mode === 'panel'
                        ? 'panel-roi-expanded-to-full-screen'
                        : 'full-screen-request')
            );
            return stageResource;
        }

        const lease = this.#acquireTexture(frame, {
            width: logicalBounds.width,
            height: logicalBounds.height,
            format: context.format
        });
        const sourceNode = resourceToTextureNode(
            stageResource,
            context.width,
            context.height
        );
        this.#getLayerPass(context.format).encodeOffscreen(context, {
            targetView: lease.view,
            width: logicalBounds.width,
            height: logicalBounds.height,
            nodes: adaptNodesForCrop(
                [sourceNode],
                logicalBounds,
                context.width,
                context.height
            ),
            clear: TRANSPARENT_CLEAR,
            label: `title-overlay-content-roi:${context.frameId}:${record.id}`
        });
        this.contentRoiCropCount += 1;
        this.contentRoiCroppedPixelCount += logicalBounds.width * logicalBounds.height;
        return this.#createTrackedResource(frame, {
            lease,
            width: logicalBounds.width,
            height: logicalBounds.height,
            format: context.format,
            context,
            logicalBounds,
            colorSpace: stageResource.colorSpace
        });
    }

    #recordContentFullScreenSource(reason) {
        const normalizedReason = normalizeContentRoiFallbackReason(reason)
            ?? 'full-screen-request';
        this.contentFullScreenSourceCount += 1;
        this.contentFullScreenSourceReasons.set(
            normalizedReason,
            (this.contentFullScreenSourceReasons.get(normalizedReason) ?? 0) + 1
        );
    }

    #encodePresent(pass, context, input = {}) {
        const frame = this.#acceptContext(context);
        requireRenderPass(pass);
        if (frame.presentCount !== 0) {
            throw new Error('title overlay renderer final present는 frame당 한 번만 허용됩니다.');
        }
        const checkpoint = requireCheckpoint(input.checkpoint);
        const nodes = flattenCheckpoint(checkpoint);
        const drawCount = this.#getLayerPass(context.format).encodeRenderPass(
            pass,
            context,
            {
                width: context.width,
                height: context.height,
                nodes
            }
        );
        // final pass보다 뒤에 이 private pool의 read는 없습니다. 실제 texture
        // 폐기는 하지 않고 idle lease로만 돌려 다음 logical frame에 재사용합니다.
        this.#releaseCheckpointResources(frame, checkpoint);
        frame.presentCount = 1;
        this.presentCount += 1;
        return drawCount >= 0;
    }

    #encodeCompact(context, input = {}) {
        const frame = this.#acceptContext(context);
        const checkpoint = requireCheckpoint(input.checkpoint);
        const lease = this.#acquireTexture(frame, {
            width: context.width,
            height: context.height,
            format: context.format
        });
        this.#getLayerPass(context.format).encodeOffscreen(context, {
            targetView: lease.view,
            width: context.width,
            height: context.height,
            nodes: flattenCheckpoint(checkpoint),
            clear: TRANSPARENT_CLEAR,
            label: `title-overlay-compact:${context.frameId}:${checkpoint.revision}`
        });
        const resource = this.#createTrackedResource(frame, {
            lease,
            width: context.width,
            height: context.height,
            format: context.format,
            context,
            logicalBounds: Object.freeze({
                x: 0,
                y: 0,
                width: context.width,
                height: context.height
            }),
            colorSpace: checkpoint.colorSpace
        });
        // compaction pass가 이전 stack을 읽은 뒤에는 compact texture 하나만
        // checkpoint authority가 되므로 입력 stage lease를 즉시 idle로 돌립니다.
        this.#releaseCheckpointResources(frame, checkpoint);
        this.compactCount += 1;
        return Object.freeze({
            node: Object.freeze({
                kind: 'texture',
                texture: resource.texture,
                view: resource.view,
                resource,
                screenBounds: Object.freeze({
                    x: 0,
                    y: 0,
                    width: context.width,
                    height: context.height
                }),
                sourceLogicalOrigin: Object.freeze({ x: 0, y: 0 }),
                sourceLogicalSize: Object.freeze({
                    width: context.width,
                    height: context.height
                }),
                opacity: 1,
                contentScale: 1,
                contentOrigin: FULL_CONTENT_ORIGIN
            })
        });
    }

    #acceptContext(context) {
        const frame = this.activeFrame;
        if (this.destroyed || !frame || frame.settled) {
            throw new Error('title overlay renderer frame이 열려 있지 않습니다.');
        }
        const normalized = requireFrameContext(context);
        if (normalized.frameId !== frame.frameId) {
            throw new Error('title overlay renderer composer frameId drift입니다.');
        }
        if (frame.context) {
            assertStableFrameContext(frame.context, normalized);
            return frame;
        }
        if (this.deviceGeneration !== null
            && normalized.deviceGeneration < this.deviceGeneration) {
            throw new Error('stale title overlay renderer device generation입니다.');
        }
        if (this.deviceGeneration === normalized.deviceGeneration
            && this.device !== null
            && normalized.device !== this.device) {
            throw new Error('generation 변경 없는 title overlay renderer device drift입니다.');
        }

        const generationDrift = this.deviceGeneration !== null
            && (normalized.deviceGeneration !== this.deviceGeneration
                || normalized.device !== this.device);
        const formatDrift = this.presentationFormat !== null
            && normalized.format !== this.presentationFormat;
        if (generationDrift || formatDrift) {
            this.#destroyPasses();
            this.generationRecreateCount += 1;
        }
        if (generationDrift) {
            this.uiAtlas.destroy();
            this.uiAtlas = new WebGpuUiAtlasRegistry({
                maxEntries: this.maxUiEntries,
                allowFrameOverflow: true
            });
        }
        this.device = normalized.device;
        this.deviceGeneration = normalized.deviceGeneration;
        this.presentationFormat = normalized.format;
        this.texturePool.beginFrame(normalized);
        frame.poolOpened = true;
        this.uiAtlas.beginFrame(normalized);
        frame.atlasOpened = true;
        frame.context = normalized;
        return frame;
    }

    #getLayerPass(format) {
        let pass = this.layerPasses.get(format);
        if (!pass) {
            pass = new TitleWebGpuLayerStackPass({
                device: this.device,
                format,
                maxNodes: DEFAULT_MAX_LAYER_NODES
            });
            this.layerPasses.set(format, pass);
        }
        return pass;
    }

    #getGlassPass(context) {
        if (!this.glassPass) {
            this.glassPass = new TitleWebGpuOverlayGlassPass({
                device: context.device,
                format: context.format
            });
        }
        return this.glassPass;
    }

    #acquireTexture(frame, { width, height, format }) {
        const lease = this.texturePool.acquire({
            width: requirePositiveSafeInteger(width, 'texture width'),
            height: requirePositiveSafeInteger(height, 'texture height'),
            depthOrArrayLayers: 1,
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            format: requireFormat(format),
            usage: TRANSIENT_TEXTURE_USAGE,
            viewDimension: '2d'
        });
        frame.leases.add(lease);
        return lease;
    }

    #getTransparentFallback(context, frame) {
        if (frame.transparentFallback) return frame.transparentFallback;
        const lease = this.#acquireTexture(frame, {
            width: 1,
            height: 1,
            format: context.format
        });
        const renderPass = context.encoder.beginRenderPass({
            label: `title-overlay-transparent-fallback:${context.frameId}`,
            colorAttachments: [{
                view: lease.view,
                clearValue: TRANSPARENT_CLEAR,
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        renderPass.end();
        frame.transparentFallback = this.#createTrackedResource(frame, {
            lease,
            width: 1,
            height: 1,
            format: context.format,
            context,
            logicalBounds: Object.freeze({
                x: 0,
                y: 0,
                width: context.width,
                height: context.height
            }),
            colorSpace: 'srgb-compat'
        });
        this.transparentFallbackCreateCount += 1;
        return frame.transparentFallback;
    }

    #createTrackedResource(frame, input) {
        const resource = createTextureResource(input);
        frame.resourceLeases.set(resource, input.lease);
        return resource;
    }

    #releaseStageMaterializations(frame, stageId) {
        const resources = frame.materializationResources.get(stageId);
        if (!resources) return;
        for (const resource of resources) {
            this.#releaseResource(frame, resource);
        }
        resources.clear();
        frame.materializationResources.delete(stageId);
    }

    #releaseCheckpointResources(frame, checkpoint) {
        if (!Array.isArray(checkpoint?.nodes)) return;
        for (const logicalNode of checkpoint.nodes) {
            this.#releaseLayerResource(frame, logicalNode?.resource);
            this.#releaseLayerResource(frame, logicalNode?.layer);
        }
    }

    #releaseLayerResource(frame, layer) {
        if (Array.isArray(layer)) {
            for (const entry of layer) this.#releaseLayerResource(frame, entry);
            return;
        }
        if (!layer || typeof layer !== 'object') return;
        this.#releaseResource(frame, layer.resource ?? layer);
    }

    #releaseResource(frame, resource) {
        if (!resource || typeof resource !== 'object') return false;
        const lease = frame.resourceLeases.get(resource);
        if (!lease) return false;
        frame.resourceLeases.delete(resource);
        if (!frame.leases.delete(lease)) return false;
        return this.texturePool.release(lease);
    }

    #uploadUiSurface(context, frame, rawSurface, fallbackBounds) {
        const surface = requireUiSurface(rawSurface);
        const bounds = normalizeScreenBounds(
            surface.bounds ?? fallbackBounds,
            context.width,
            context.height
        );
        const packet = this.#uploadAtlasSource(context, frame, {
            source: surface.canvas,
            revision: surface.revision,
            width: surface.width,
            height: surface.height,
            capacityWidth: surface.capacityWidth,
            capacityHeight: surface.capacityHeight
        }, 'ui');
        return Object.freeze({
            kind: 'texture',
            texture: packet.texture,
            view: packet.view,
            screenBounds: bounds,
            sourceLogicalOrigin: Object.freeze({ x: bounds.x, y: bounds.y }),
            sourceLogicalSize: Object.freeze({
                width: bounds.width / packet.uvScaleX,
                height: bounds.height / packet.uvScaleY
            }),
            opacity: clamp01(surface.opacity ?? 1, 'uiSurface.opacity'),
            contentScale: requirePositiveFinite(
                surface.contentScale ?? 1,
                'uiSurface.contentScale'
            ),
            contentOrigin: normalizeContentOrigin(surface.contentOrigin)
        });
    }

    #uploadEffectTexture(context, frame, payload, panel) {
        const source = panel.effectTextureCanvas;
        const width = requirePositiveSafeInteger(
            panel.effectTextureWidth ?? source?.width,
            'effect texture width'
        );
        const height = requirePositiveSafeInteger(
            panel.effectTextureHeight ?? source?.height,
            'effect texture height'
        );
        return this.#uploadAtlasSource(context, frame, {
            source,
            revision: requireNonNegativeSafeInteger(
                panel.effectTextureRevision
                    ?? payload.effectTextureRevision
                    ?? source?.__overlayTextureRevision
                    ?? frame.frameId,
                'effect texture revision'
            ),
            width,
            height
        }, 'effect');
    }

    #uploadAtlasSource(context, frame, input, purpose) {
        const before = this.uiAtlas.getDiagnostics();
        const packet = this.uiAtlas.getOrUpload({
            context,
            source: requireIdentity(input.source, `${purpose} canvas`),
            revision: requireNonNegativeSafeInteger(
                input.revision,
                `${purpose} revision`
            ),
            width: input.width,
            height: input.height,
            capacityWidth: input.capacityWidth,
            capacityHeight: input.capacityHeight
        });
        const after = this.uiAtlas.getDiagnostics();
        const uploadDelta = after.uploadCount - before.uploadCount;
        const pixelDelta = after.uploadedPixelCount - before.uploadedPixelCount;
        const cacheHitDelta = after.cacheHitCount - before.cacheHitCount;
        this.externalUploadCount += uploadDelta;
        this.externalUploadedPixelCount += pixelDelta;
        frame.externalUploadCount += uploadDelta;
        if (purpose === 'effect') {
            this.effectTextureUploadCount += uploadDelta;
            this.effectTextureUploadedPixelCount += pixelDelta;
            this.effectTextureCacheHitCount += cacheHitDelta;
            this.steadyEffectTextureCacheHitCount += cacheHitDelta;
        } else {
            this.uiUploadCount += uploadDelta;
            this.uiCacheHitCount += cacheHitDelta;
            this.steadyUiCacheHitCount += cacheHitDelta;
        }
        return packet;
    }

    #resolveBackdropLogicalBounds(
        frame,
        stageId,
        request,
        backdrop,
        sourceCheckpoint
    ) {
        if (backdrop.logicalBounds) {
            return normalizeScreenBounds(
                backdrop.logicalBounds,
                sourceCheckpoint.width,
                sourceCheckpoint.height
            );
        }
        const key = createBackdropPlanKey(stageId, request?.bounds, request?.halo);
        const cached = frame.backdropLogicalBounds.get(key);
        if (cached) return cached;
        return calculateAlignedRoi(
            request?.bounds,
            request?.halo,
            sourceCheckpoint.width,
            sourceCheckpoint.height
        );
    }

    #settleFrame(frame, status, outcome = {}) {
        if (frame.settled) return false;
        frame.settled = true;
        if (frame.poolOpened && !this.texturePool.getDiagnostics().destroyed) {
            for (const lease of frame.leases) {
                this.texturePool.release(lease);
            }
            try {
                this.texturePool.endFrame();
            } catch (error) {
                this.#fail('texture-pool-end-frame-failed', error);
            }
        }
        if (frame.atlasOpened && !this.uiAtlas.getDiagnostics().destroyed) {
            try {
                this.uiAtlas.endFrame();
            } catch (error) {
                this.#fail('ui-atlas-end-frame-failed', error);
            }
        }
        if (status === 'committed') this.commitCount += 1;
        else this.abortCount += 1;
        this.lastSettledFrame = Object.freeze({
            status,
            frameId: frame.frameId,
            deviceGeneration: frame.context?.deviceGeneration ?? null,
            submitted: status === 'committed' && outcome?.submitted === true,
            presentCount: frame.presentCount,
            externalUploadCount: frame.externalUploadCount,
            reason: status === 'aborted' ? (outcome?.reason ?? null) : null
        });
        frame.leases.clear();
        frame.materializationResources.clear();
        frame.backdropLogicalBounds.clear();
        frame.transparentFallback = null;
        if (this.activeFrame === frame) this.activeFrame = null;
        if (this.destroyed) this.#destroyOwnedResources();
        return true;
    }

    #destroyOwnedResources() {
        if (this.resourcesDestroyed) return false;
        this.#destroyPasses();
        this.texturePool.destroy();
        this.uiAtlas.destroy();
        this.device = null;
        this.deviceGeneration = null;
        this.presentationFormat = null;
        this.resourcesDestroyed = true;
        return true;
    }

    #destroyPasses() {
        for (const pass of this.layerPasses.values()) {
            if (pass.destroy()) this.passDestroyCount += 1;
        }
        this.layerPasses.clear();
        if (this.glassPass) {
            if (this.glassPass.destroy()) this.passDestroyCount += 1;
            this.glassPass = null;
        }
    }

    #fail(reason, error = null) {
        this.failureCount += 1;
        this.lastFailure = Object.freeze({
            reason,
            message: error ? formatError(error) : null
        });
        return false;
    }
}

function createFrameState(frameId) {
    return {
        frameId,
        context: null,
        poolOpened: false,
        atlasOpened: false,
        settled: false,
        leases: new Set(),
        resourceLeases: new WeakMap(),
        materializationResources: new Map(),
        presentCount: 0,
        externalUploadCount: 0,
        transparentFallback: null,
        backdropLogicalBounds: new Map()
    };
}

function createTextureResource({
    lease,
    width,
    height,
    format,
    context,
    logicalBounds,
    colorSpace
}) {
    return Object.freeze({
        texture: lease.texture,
        view: lease.view,
        width,
        height,
        format,
        frameId: context.frameId,
        deviceGeneration: context.deviceGeneration,
        frameLifetime: 'until-frame-complete',
        logicalBounds,
        colorSpace: colorSpace ?? 'srgb-compat',
        alphaMode: 'premultiplied'
    });
}

function flattenCheckpoint(checkpoint) {
    if (!Array.isArray(checkpoint.nodes)) {
        throw new TypeError('title overlay checkpoint nodes 배열이 필요합니다.');
    }
    const result = [];
    for (const logicalNode of checkpoint.nodes) {
        if (logicalNode?.type === 'title-overlay-base') {
            result.push(resourceToTextureNode(
                requireTextureResource(logicalNode.resource, 'base resource'),
                checkpoint.width,
                checkpoint.height
            ));
            continue;
        }
        if (logicalNode?.type === 'title-overlay-stage') {
            const contentOutputs = logicalNode.contentBlurOutputs;
            const replacement = Array.isArray(contentOutputs) && contentOutputs.length > 0
                ? contentOutputs[contentOutputs.length - 1]
                : null;
            appendLayerNode(result, logicalNode.layer, replacement);
            continue;
        }
        if (logicalNode?.type === 'title-overlay-compacted') {
            appendLayerNode(result, logicalNode.layer, null);
            continue;
        }
        appendLayerNode(result, logicalNode?.layer ?? logicalNode, null);
    }
    return result;
}

function appendLayerNode(target, value, replacementResource) {
    if (Array.isArray(value)) {
        for (const entry of value) appendLayerNode(target, entry, replacementResource);
        return;
    }
    if (!value || typeof value !== 'object') {
        throw new TypeError('title overlay logical layer node가 필요합니다.');
    }
    if (value.kind === 'texture') {
        if (!replacementResource) {
            target.push(value);
            return;
        }
        const resource = requireTextureResource(
            replacementResource,
            'content blur output'
        );
        const logicalBounds = resource.logicalBounds
            ? normalizeScreenBounds(
                resource.logicalBounds,
                resource.width,
                resource.height
            )
            : null;
        target.push(Object.freeze(logicalBounds
            ? {
                ...value,
                texture: resource.texture,
                view: resource.view,
                resource,
                screenBounds: logicalBounds,
                sourceLogicalOrigin: Object.freeze({
                    x: logicalBounds.x,
                    y: logicalBounds.y
                }),
                sourceLogicalSize: Object.freeze({
                    width: logicalBounds.width,
                    height: logicalBounds.height
                })
            }
            : {
                ...value,
                texture: resource.texture,
                view: resource.view,
                resource
            }));
        return;
    }
    if (value.kind === 'dim' || value.kind === 'vignette') {
        if (replacementResource) {
            throw new Error('analytic layer에는 content blur output을 치환할 수 없습니다.');
        }
        target.push(value);
        return;
    }
    if (value.resource || value.texture) {
        const resource = requireTextureResource(
            replacementResource ?? value.resource ?? value,
            'logical texture layer'
        );
        target.push(resourceToTextureNode(
            resource,
            resource.logicalBounds?.width ?? resource.width,
            resource.logicalBounds?.height ?? resource.height
        ));
        return;
    }
    throw new TypeError(`지원하지 않는 title overlay layer입니다: ${String(value.kind)}`);
}

function resourceToTextureNode(resource, fallbackWidth, fallbackHeight) {
    const logicalBounds = normalizeScreenBounds(
        resource.logicalBounds,
        fallbackWidth,
        fallbackHeight
    );
    return Object.freeze({
        kind: 'texture',
        texture: resource.texture,
        view: resource.view,
        resource,
        screenBounds: logicalBounds,
        sourceLogicalOrigin: Object.freeze({
            x: logicalBounds.x,
            y: logicalBounds.y
        }),
        sourceLogicalSize: Object.freeze({
            width: logicalBounds.width,
            height: logicalBounds.height
        }),
        opacity: 1,
        contentScale: 1,
        contentOrigin: FULL_CONTENT_ORIGIN
    });
}

function adaptNodesForCrop(nodes, crop, fullWidth, fullHeight) {
    return nodes.map((node) => {
        if (node.kind === 'dim' || node.kind === 'vignette') {
            return Object.freeze({
                ...node,
                // Analytic shader는 작은 render target 안에서도 full logical
                // screen 좌표로 같은 pixel 값을 계산합니다.
                sourceLogicalOrigin: Object.freeze({ x: crop.x, y: crop.y }),
                sourceLogicalSize: Object.freeze({
                    width: fullWidth,
                    height: fullHeight
                })
            });
        }
        if (node.kind !== 'texture') return node;
        const bounds = normalizeScreenBounds(node.screenBounds, fullWidth, fullHeight);
        const origin = normalizePoint(node.sourceLogicalOrigin, 0, 0);
        const size = normalizeSize(node.sourceLogicalSize, fullWidth, fullHeight);
        const contentScale = requirePositiveFinite(
            node.contentScale ?? 1,
            'node.contentScale'
        );
        let contentOrigin = FULL_CONTENT_ORIGIN;
        if (contentScale !== 1) {
            const originalOrigin = normalizeContentOrigin(node.contentOrigin);
            contentOrigin = Object.freeze({
                x: ((originalOrigin.x * fullWidth) - crop.x) / crop.width,
                y: ((originalOrigin.y * fullHeight) - crop.y) / crop.height
            });
        }
        return Object.freeze({
            ...node,
            screenBounds: Object.freeze({
                x: bounds.x - crop.x,
                y: bounds.y - crop.y,
                width: bounds.width,
                height: bounds.height
            }),
            sourceLogicalOrigin: Object.freeze({
                x: origin.x - crop.x,
                y: origin.y - crop.y
            }),
            sourceLogicalSize: size,
            contentOrigin
        });
    });
}

function requiresFullScreenCropFallback(nodes, crop, fullWidth, fullHeight) {
    if (crop.x === 0 && crop.y === 0
        && crop.width === fullWidth && crop.height === fullHeight) {
        return false;
    }
    for (const node of nodes) {
        if (node.kind !== 'texture' || (node.contentScale ?? 1) === 1) continue;
        const origin = normalizeContentOrigin(node.contentOrigin);
        const localX = ((origin.x * fullWidth) - crop.x) / crop.width;
        const localY = ((origin.y * fullHeight) - crop.y) / crop.height;
        if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return true;
    }
    return false;
}

function resolveStageRenderBounds({
    requestedBounds,
    contentBlurs,
    contentScale,
    width,
    height
}) {
    if (!requestedBounds
        || (Array.isArray(contentBlurs) && contentBlurs.length > 0)
        || contentScale !== 1) {
        return Object.freeze({ x: 0, y: 0, width, height });
    }
    return calculateAlignedRoi(requestedBounds, 0, width, height);
}

function calculateAlignedRoi(boundsValue, haloValue, fullWidth, fullHeight) {
    const bounds = normalizeScreenBounds(boundsValue, fullWidth, fullHeight, false);
    const halo = normalizeHalo(haloValue);
    const left = Math.max(
        0,
        Math.floor((bounds.x - halo.left) / ROI_ALIGNMENT) * ROI_ALIGNMENT
    );
    const top = Math.max(
        0,
        Math.floor((bounds.y - halo.top) / ROI_ALIGNMENT) * ROI_ALIGNMENT
    );
    const right = Math.min(
        fullWidth,
        Math.ceil((bounds.x + bounds.width + halo.right) / ROI_ALIGNMENT)
            * ROI_ALIGNMENT
    );
    const bottom = Math.min(
        fullHeight,
        Math.ceil((bounds.y + bounds.height + halo.bottom) / ROI_ALIGNMENT)
            * ROI_ALIGNMENT
    );
    if (right <= left || bottom <= top) {
        throw new RangeError('title overlay materialize ROI가 viewport와 겹치지 않습니다.');
    }
    return Object.freeze({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    });
}

function isFullScreenBounds(bounds, width, height) {
    return bounds.x === 0
        && bounds.y === 0
        && bounds.width === width
        && bounds.height === height;
}

function createBackdropPlanKey(stageId, boundsValue, haloValue) {
    const bounds = boundsValue && typeof boundsValue === 'object'
        ? boundsValue
        : {};
    const halo = normalizeHalo(haloValue);
    return JSON.stringify([
        String(stageId ?? ''),
        numberOr(bounds.x, 0),
        numberOr(bounds.y, 0),
        numberOr(bounds.width ?? bounds.w, 0),
        numberOr(bounds.height ?? bounds.h, 0),
        halo.left,
        halo.top,
        halo.right,
        halo.bottom
    ]);
}

function normalizeHalo(value) {
    if (Number.isFinite(value)) {
        const amount = Math.max(0, Number(value));
        return Object.freeze({
            left: amount,
            top: amount,
            right: amount,
            bottom: amount
        });
    }
    const halo = value && typeof value === 'object' ? value : {};
    const horizontal = halo.x ?? halo.horizontal ?? 0;
    const vertical = halo.y ?? halo.vertical ?? 0;
    return Object.freeze({
        left: requireNonNegativeFinite(halo.left ?? horizontal, 'halo.left'),
        top: requireNonNegativeFinite(halo.top ?? vertical, 'halo.top'),
        right: requireNonNegativeFinite(halo.right ?? horizontal, 'halo.right'),
        bottom: requireNonNegativeFinite(halo.bottom ?? vertical, 'halo.bottom')
    });
}

function normalizeScreenBounds(value, fallbackWidth, fallbackHeight, useFallback = true) {
    const bounds = value && typeof value === 'object' ? value : {};
    const widthFallback = useFallback ? fallbackWidth : undefined;
    const heightFallback = useFallback ? fallbackHeight : undefined;
    const x = numberOr(bounds.x, 0);
    const y = numberOr(bounds.y, 0);
    const width = requirePositiveFinite(
        bounds.width ?? bounds.w ?? widthFallback,
        'bounds.width'
    );
    const height = requirePositiveFinite(
        bounds.height ?? bounds.h ?? heightFallback,
        'bounds.height'
    );
    return Object.freeze({ x, y, width, height });
}

function normalizePoint(value, fallbackX, fallbackY) {
    return Object.freeze({
        x: numberOr(value?.x, fallbackX),
        y: numberOr(value?.y, fallbackY)
    });
}

function normalizeSize(value, fallbackWidth, fallbackHeight) {
    return Object.freeze({
        width: requirePositiveFinite(value?.width ?? value?.w ?? fallbackWidth, 'size.width'),
        height: requirePositiveFinite(value?.height ?? value?.h ?? fallbackHeight, 'size.height')
    });
}

function normalizeContentOrigin(value) {
    return Object.freeze({
        x: clamp01(value?.x ?? 0.5, 'contentOrigin.x'),
        y: clamp01(value?.y ?? 0.5, 'contentOrigin.y')
    });
}

function normalizeContentRoiFallbackReason(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function snapshotCountMap(value) {
    const entries = Array.from(value.entries());
    entries.sort(([left], [right]) => left.localeCompare(right));
    return Object.freeze(Object.fromEntries(entries));
}

function normalizePayload(value) {
    return value && typeof value === 'object' ? value : {};
}

function normalizeStageBackdropRequest(value, fallbackBounds) {
    const request = value && typeof value === 'object' ? value : {};
    return Object.freeze({
        bounds: request.bounds ?? fallbackBounds,
        halo: request.halo
    });
}

function normalizeNodeList(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw new TypeError('payload.analyticNodes 배열이 필요합니다.');
    }
    return value.slice();
}

function isPureAnalyticStage({
    record,
    backdropOutputs,
    analyticNodes,
    glassPanels,
    uiSurfaces,
    stageOpacity,
    stageContentScale
}) {
    return analyticNodes.length > 0
        && analyticNodes.every((node) => (
            node?.kind === 'dim' || node?.kind === 'vignette'
        ))
        && glassPanels.length === 0
        && uiSurfaces.length === 0
        && record.backdropBlurs.length === 0
        && backdropOutputs.length === 0
        && (!Array.isArray(record.contentBlurs) || record.contentBlurs.length === 0)
        // Offscreen 합성 결과 전체에 opacity/scale을 적용하는 의미는 개별
        // analytic draw로 분배할 수 없으므로 identity transform만 직결합니다.
        && stageOpacity === 1
        && stageContentScale === 1;
}

function normalizeEntryList(value) {
    if (value == null) return [];
    if (!Array.isArray(value)) {
        throw new TypeError('title overlay stage payload 목록은 배열이어야 합니다.');
    }
    return value;
}

function requireUiSurface(surface) {
    if (!surface || typeof surface !== 'object') {
        throw new TypeError('title overlay UI surface descriptor가 필요합니다.');
    }
    requireIdentity(surface.canvas, 'uiSurface.canvas');
    requireNonNegativeSafeInteger(surface.revision, 'uiSurface.revision');
    return surface;
}

function requirePanel(panel) {
    if (!panel || typeof panel !== 'object') {
        throw new TypeError('title overlay glass panel descriptor가 필요합니다.');
    }
    return panel;
}

function requireRecord(record) {
    if (!record || typeof record !== 'object') {
        throw new TypeError('title overlay stage record가 필요합니다.');
    }
    if (!Array.isArray(record.backdropBlurs)) {
        throw new TypeError('title overlay stage record.backdropBlurs 배열이 필요합니다.');
    }
    return record;
}

function requireCheckpoint(checkpoint) {
    if (!checkpoint || typeof checkpoint !== 'object') {
        throw new TypeError('title overlay logical checkpoint가 필요합니다.');
    }
    requirePositiveSafeInteger(checkpoint.width, 'checkpoint.width');
    requirePositiveSafeInteger(checkpoint.height, 'checkpoint.height');
    requireFormat(checkpoint.format);
    return checkpoint;
}

function requireTextureResource(resource, name) {
    if (!resource || typeof resource !== 'object') {
        throw new TypeError(`${name} descriptor가 필요합니다.`);
    }
    requireIdentity(resource.texture, `${name}.texture`);
    requireIdentity(resource.view, `${name}.view`);
    requirePositiveSafeInteger(resource.width, `${name}.width`);
    requirePositiveSafeInteger(resource.height, `${name}.height`);
    requireFormat(resource.format);
    return resource;
}

function requireFrameContext(context) {
    const device = requireIdentity(context?.device, 'context.device');
    if (typeof device.createTexture !== 'function') {
        throw new TypeError('context.device.createTexture()가 필요합니다.');
    }
    if (!context?.encoder || typeof context.encoder.beginRenderPass !== 'function') {
        throw new TypeError('context.encoder가 필요합니다.');
    }
    return Object.freeze({
        ...context,
        device,
        encoder: context.encoder,
        target: requireIdentity(context.target, 'context.target'),
        frameId: requireNonNegativeSafeInteger(context.frameId, 'context.frameId'),
        deviceGeneration: requireNonNegativeSafeInteger(
            context.deviceGeneration,
            'context.deviceGeneration'
        ),
        width: requirePositiveSafeInteger(context.width, 'context.width'),
        height: requirePositiveSafeInteger(context.height, 'context.height'),
        format: requireFormat(context.format)
    });
}

function assertStableFrameContext(expected, current) {
    if (expected.device !== current.device
        || expected.encoder !== current.encoder
        || expected.target !== current.target
        || expected.frameId !== current.frameId
        || expected.deviceGeneration !== current.deviceGeneration
        || expected.width !== current.width
        || expected.height !== current.height
        || expected.format !== current.format) {
        throw new Error('title overlay renderer frame context drift입니다.');
    }
}

function withTargetFormat(context, format) {
    return format === context.format ? context : Object.freeze({ ...context, format });
}

function requireFramePort(port) {
    if (!port || typeof port !== 'object') {
        throw new TypeError('framePort가 필요합니다.');
    }
    for (const method of ['isFrameActive', 'deferFrameCallbacks']) {
        if (typeof port[method] !== 'function') {
            throw new TypeError(`framePort.${method}()가 필요합니다.`);
        }
    }
    return port;
}

function requireBlurPort(port) {
    if (!port || typeof port.encode !== 'function') {
        throw new TypeError('blurPort.encode()가 필요합니다.');
    }
    return port;
}

function requireRenderPass(pass) {
    for (const method of ['setPipeline', 'setBindGroup', 'draw']) {
        if (typeof pass?.[method] !== 'function') {
            throw new TypeError(`final render pass.${method}()가 필요합니다.`);
        }
    }
    return pass;
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${name} identity가 필요합니다.`);
    }
    return value;
}

function requireFormat(value) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError('WebGPU texture format이 필요합니다.');
    }
    return value.trim();
}

function requirePositiveSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requirePositiveFinite(value, name) {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name}은 0보다 큰 유한수여야 합니다.`);
    }
    return Number(value);
}

function requireNonNegativeFinite(value, name) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name}은 0 이상의 유한수여야 합니다.`);
    }
    return Number(value);
}

function clamp01(value, name) {
    if (!Number.isFinite(value)) {
        throw new RangeError(`${name}은 유한수여야 합니다.`);
    }
    return Math.max(0, Math.min(1, Number(value)));
}

function normalizeOptionalIndex(value, fallback) {
    const index = value ?? fallback;
    if (!Number.isSafeInteger(index) || index < 0) {
        throw new RangeError('glass backdropIndex는 0 이상의 안전한 정수여야 합니다.');
    }
    return index;
}

function numberOr(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function toGlassBounds(bounds) {
    return Object.freeze({
        x: bounds.x,
        y: bounds.y,
        w: bounds.width,
        h: bounds.height
    });
}

function normalizeEffectTextureRect(value) {
    if (!value || typeof value !== 'object') return null;
    const width = value.w ?? value.width;
    const height = value.h ?? value.height;
    return Object.freeze({
        x: numberOr(value.x, 0),
        y: numberOr(value.y, 0),
        w: requirePositiveFinite(width, 'effectTextureRect.w'),
        h: requirePositiveFinite(height, 'effectTextureRect.h')
    });
}

function formatError(error) {
    if (error instanceof Error) return error.message;
    return String(error);
}
