import { TITLE_WEBGPU_BASE_CHECKPOINT_ID } from './_title_webgpu_checkpoint_registry.js';

const DEFAULT_BLUR_ALGORITHM_ID = 'gaussian-quality';
const DEFAULT_MAX_LIVE_STAGES = 4;
const DEFAULT_MAX_RECEIPTS = 64;
const DEFAULT_COLOR_SPACE = 'srgb-compat';
const DEFAULT_ALPHA_MODE = 'premultiplied';

/** Title overlay의 고정 합성 순서입니다. 같은 kind 안에서는 order와 등록 순서를 유지합니다. */
export const TITLE_WEBGPU_OVERLAY_STAGE_KIND = Object.freeze({
    VIGNETTE: 'vignette',
    TITLE_MENU: 'titleMenu',
    DIM: 'dim',
    ROOT: 'root',
    FLOATING: 'floating',
    TOOLTIP: 'tooltip'
});

export const TITLE_WEBGPU_OVERLAY_STAGE_ORDER = Object.freeze([
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.VIGNETTE,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.TITLE_MENU,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.DIM,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.ROOT,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.FLOATING,
    TITLE_WEBGPU_OVERLAY_STAGE_KIND.TOOLTIP
]);

export const TITLE_WEBGPU_OVERLAY_DEFAULT_BLUR_ALGORITHM_ID
    = DEFAULT_BLUR_ALGORITHM_ID;

const STAGE_RANK = new Map(
    TITLE_WEBGPU_OVERLAY_STAGE_ORDER.map((kind, index) => [kind, index])
);

/**
 * title overlay를 logical layer-stack으로 조립하고, blur가 필요한 순간에만 ROI를
 * materialize합니다. 이 클래스는 texture/pass 구현을 소유하지 않는 orchestration 계층입니다.
 */
export class TitleWebGpuOverlayGraph {
    /**
     * @param {object} options - composer/pass/blur 의존성입니다.
     * @param {object} options.framePort - active composer contributor port입니다.
     * @param {object} options.blurPort - synchronous frame-local blur port입니다.
     * @param {object} options.materializePass - logical checkpoint를 ROI texture로 만드는 pass입니다.
     * @param {object} options.stagePass - overlay record를 logical layer node로 만드는 pass입니다.
     * @param {object} options.presentPass - final checkpoint를 canvas pass에 기록하는 pass입니다.
     * @param {object} [options.compactPass] - live-stage cap 초과 시 stack을 한 node로 접는 pass입니다.
     * @param {Function} [options.cutoverStatusProvider] - full cutover 상태 snapshot provider입니다.
     * @param {string} [options.blurAlgorithmId='gaussian-quality'] - 기본 blur algorithm ID입니다.
     * @param {number} [options.maxLiveStages=4] - compaction 뒤 유지할 최대 logical stage 수입니다.
     * @param {number} [options.maxReceipts=64] - drain 전 보존할 완료 receipt 상한입니다.
     */
    constructor(options = {}) {
        this.framePort = requireFramePort(options.framePort);
        this.blurPort = requireEncodePort(options.blurPort, 'blurPort');
        this.materializePass = requireEncodePort(
            options.materializePass,
            'materializePass'
        );
        this.stagePass = requireEncodePort(options.stagePass, 'stagePass');
        this.presentPass = requireEncodePort(options.presentPass, 'presentPass');
        this.compactPass = options.compactPass == null
            ? null
            : requireEncodePort(options.compactPass, 'compactPass');
        this.cutoverStatusProvider = options.cutoverStatusProvider == null
            ? () => null
            : requireFunction(options.cutoverStatusProvider, 'cutoverStatusProvider');
        this.blurAlgorithmId = requireNonEmptyString(
            options.blurAlgorithmId ?? DEFAULT_BLUR_ALGORITHM_ID,
            'blurAlgorithmId'
        );
        this.maxLiveStages = requirePositiveSafeInteger(
            options.maxLiveStages ?? DEFAULT_MAX_LIVE_STAGES,
            'maxLiveStages'
        );
        this.maxReceipts = requirePositiveSafeInteger(
            options.maxReceipts ?? DEFAULT_MAX_RECEIPTS,
            'maxReceipts'
        );

        this.activeFrame = null;
        this.destroyed = false;
        this.receipts = [];
        this.textureIds = new WeakMap();
        this.nextTextureId = 0;
        this.nextReceiptSequence = 0;

        this.beginAttemptCount = 0;
        this.beginCount = 0;
        this.recordCount = 0;
        this.finalizeAttemptCount = 0;
        this.encodeSuccessCount = 0;
        this.commitCount = 0;
        this.abortCount = 0;
        this.cancelCount = 0;
        this.failureCount = 0;
        this.missingCheckpointRejectCount = 0;
        this.staleCheckpointRejectCount = 0;
        this.generationCheckpointRejectCount = 0;
        this.incompatibleCheckpointRejectCount = 0;
        this.materializationRequestCount = 0;
        this.materializationCount = 0;
        this.materializationCacheHitCount = 0;
        this.blurRequestCount = 0;
        this.blurEncodeCount = 0;
        this.sharedBlurHitCount = 0;
        this.checkpointAdvanceCount = 0;
        this.compactionCount = 0;
        this.presentPassCount = 0;
        this.cutoverQualifiedCount = 0;
        this.cutoverProviderFailureCount = 0;
        this.droppedReceiptCount = 0;
        this.maxRetainedLiveStageCount = 0;
        this.lastFrameId = null;
        this.lastDeviceGeneration = null;
        this.lastCheckpointRevision = null;
        this.lastFailure = null;
    }

    /** 현재 composer frame의 overlay 기록을 엽니다. */
    beginFrame(frameId) {
        this.beginAttemptCount += 1;
        if (this.destroyed
            || this.activeFrame
            || this.framePort.isFrameActive() !== true) {
            return this.#fail(null, 'graph-unavailable-or-frame-inactive');
        }
        let normalizedFrameId;
        try {
            normalizedFrameId = requireNonNegativeSafeInteger(frameId, 'frameId');
        } catch (error) {
            return this.#fail(null, 'invalid-frame-id', error);
        }

        this.activeFrame = createFrameState(normalizedFrameId);
        this.beginCount += 1;
        this.lastFailure = null;
        return true;
    }

    /** kind별 wrapper가 공유하는 record 진입점입니다. */
    recordStage(kind, input = {}) {
        const frame = this.activeFrame;
        if (!frame || frame.finalizing || frame.settled || this.destroyed) {
            return this.#fail(frame, 'record-frame-unavailable');
        }
        if (!STAGE_RANK.has(kind)) {
            return this.#fail(frame, 'unknown-stage-kind');
        }
        if (!input || typeof input !== 'object') {
            return this.#fail(frame, 'invalid-stage-input');
        }

        const sequence = frame.nextSequence;
        frame.nextSequence += 1;
        frame.records.push(Object.freeze({
            id: normalizeOptionalId(input.id)
                ?? `${kind}:${sequence}`,
            kind,
            order: normalizeFiniteNumber(input.order, 0),
            sequence,
            bounds: input.bounds ?? null,
            backdropBlurs: freezeRequestList(
                input.backdropBlurs ?? input.backdropBlur ?? null
            ),
            contentBlurs: freezeRequestList(
                input.contentBlurs ?? input.contentBlur ?? null
            ),
            payload: input.payload ?? input
        }));
        this.recordCount += 1;
        return true;
    }

    recordVignette(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.VIGNETTE, input);
    }

    recordTitleMenu(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.TITLE_MENU, input);
    }

    recordDim(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.DIM, input);
    }

    recordRoot(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.ROOT, input);
    }

    recordFloating(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.FLOATING, input);
    }

    recordTooltip(input = {}) {
        return this.recordStage(TITLE_WEBGPU_OVERLAY_STAGE_KIND.TOOLTIP, input);
    }

    /**
     * C0를 consume해 logical graph를 완성하고 canvas pass를 정확히 한 번 기록합니다.
     * receipt는 이 메서드가 아니라 composer committed/aborted callback에서 발행됩니다.
     */
    finalize(baseCheckpoint) {
        this.finalizeAttemptCount += 1;
        const frame = this.activeFrame;
        if (!frame
            || frame.finalizing
            || frame.settled
            || this.destroyed
            || this.framePort.isFrameActive() !== true) {
            return this.#fail(frame, 'finalize-frame-unavailable');
        }

        frame.finalizing = true;
        const callbacks = Object.freeze({
            committed: (outcome) => this.#settleFrame(frame, 'committed', outcome),
            aborted: (outcome) => this.#settleFrame(frame, 'aborted', outcome)
        });

        try {
            if (this.framePort.deferFrameCallbacks(callbacks) !== true) {
                return this.#fail(frame, 'frame-callback-registration-failed');
            }
            const graphAccepted = this.framePort.encodeCommands((context) => {
                this.#encodeGraph(frame, context, baseCheckpoint);
            });
            if (graphAccepted !== true) {
                return this.#fail(frame, 'overlay-command-encode-failed');
            }
            const presentAccepted = this.framePort.encodeCanvasPass(
                (pass, context) => this.#encodePresent(frame, pass, context),
                { label: `title-overlay-final:${frame.frameId}` }
            );
            if (presentAccepted !== true) {
                return this.#fail(frame, 'overlay-canvas-pass-failed');
            }
        } catch (error) {
            return this.#fail(frame, 'overlay-finalize-threw', error);
        }

        if (frame.settled) {
            return false;
        }
        frame.encoded = true;
        this.encodeSuccessCount += 1;
        this.lastFailure = null;
        return true;
    }

    /** 완료/폐기 callback이 발행한 bounded receipt를 꺼내고 내부 queue를 비웁니다. */
    drainReceipts() {
        if (this.receipts.length === 0) return Object.freeze([]);
        const drained = Object.freeze(this.receipts.splice(0, this.receipts.length));
        return drained;
    }

    /**
     * record/finalize 전처리가 실패했을 때 composer callback 없이 열린 logical frame을
     * 폐기합니다. 이미 등록된 callback이 늦게 도착해도 settled guard가 이중 정산을 막습니다.
     */
    cancelActiveFrame(reason = 'external-cancel') {
        const frame = this.activeFrame;
        if (!frame || frame.settled || this.destroyed) return false;

        this.#fail(
            frame,
            'frame-cancelled',
            new Error(normalizeFailureReason(reason))
        );
        frame.settled = true;
        frame.materializationCache.clear();
        frame.blurCache.clear();
        frame.records.length = 0;
        frame.finalCheckpoint = null;
        frame.checkpoint = null;
        this.activeFrame = null;
        this.abortCount += 1;
        this.cancelCount += 1;
        this.lastFrameId = frame.frameId;
        return true;
    }

    /** rollout과 테스트에서 사용할 immutable counter snapshot입니다. */
    getDiagnostics() {
        return Object.freeze({
            status: this.destroyed
                ? 'destroyed'
                : (this.activeFrame ? 'active' : 'ready'),
            blurAlgorithmId: this.blurAlgorithmId,
            maxLiveStages: this.maxLiveStages,
            maxReceipts: this.maxReceipts,
            beginAttemptCount: this.beginAttemptCount,
            beginCount: this.beginCount,
            recordCount: this.recordCount,
            finalizeAttemptCount: this.finalizeAttemptCount,
            encodeSuccessCount: this.encodeSuccessCount,
            commitCount: this.commitCount,
            abortCount: this.abortCount,
            cancelCount: this.cancelCount,
            failureCount: this.failureCount,
            missingCheckpointRejectCount: this.missingCheckpointRejectCount,
            staleCheckpointRejectCount: this.staleCheckpointRejectCount,
            generationCheckpointRejectCount: this.generationCheckpointRejectCount,
            incompatibleCheckpointRejectCount: this.incompatibleCheckpointRejectCount,
            materializationRequestCount: this.materializationRequestCount,
            materializationCount: this.materializationCount,
            materializationCacheHitCount: this.materializationCacheHitCount,
            blurRequestCount: this.blurRequestCount,
            blurEncodeCount: this.blurEncodeCount,
            sharedBlurHitCount: this.sharedBlurHitCount,
            checkpointAdvanceCount: this.checkpointAdvanceCount,
            compactionCount: this.compactionCount,
            presentPassCount: this.presentPassCount,
            maxRetainedLiveStageCount: this.maxRetainedLiveStageCount,
            cutoverQualifiedCount: this.cutoverQualifiedCount,
            cutoverProviderFailureCount: this.cutoverProviderFailureCount,
            queuedReceiptCount: this.receipts.length,
            droppedReceiptCount: this.droppedReceiptCount,
            lastFrameId: this.lastFrameId,
            lastDeviceGeneration: this.lastDeviceGeneration,
            lastCheckpointRevision: this.lastCheckpointRevision,
            lastFailure: this.lastFailure
        });
    }

    /** injected GPU resources의 ownership은 건드리지 않고 새 frame 진입만 닫습니다. */
    destroy() {
        if (this.destroyed) return false;
        this.destroyed = true;
        return true;
    }

    #encodeGraph(frame, context, baseCheckpoint) {
        this.#assertBaseCheckpoint(frame, context, baseCheckpoint);
        frame.device = context.device;
        frame.deviceGeneration = context.deviceGeneration;
        frame.target = context.target;
        frame.format = context.format;
        frame.width = context.width;
        frame.height = context.height;
        frame.checkpoint = createBaseLogicalCheckpoint(baseCheckpoint);
        frame.finalCheckpoint = frame.checkpoint;
        frame.baseCheckpointConsumed = true;

        const records = frame.records.slice().sort(compareStageRecords);
        frame.vignetteIncluded = records.some((record) => (
            record.kind === TITLE_WEBGPU_OVERLAY_STAGE_KIND.VIGNETTE
        ));
        for (const record of records) {
            this.#encodeStage(frame, context, record);
        }
        frame.graphEncoded = true;
    }

    #encodeStage(frame, context, record) {
        const sourceCheckpoint = frame.checkpoint;
        const backdropOutputs = [];
        for (const rawRequest of record.backdropBlurs) {
            backdropOutputs.push(this.#encodeBackdropBlur(
                frame,
                context,
                record,
                sourceCheckpoint,
                rawRequest
            ));
        }

        const stageResult = this.stagePass.encode(context, Object.freeze({
            frameId: frame.frameId,
            record,
            sourceCheckpoint,
            backdropOutputs: Object.freeze(backdropOutputs.slice())
        }));
        if (!stageResult || (typeof stageResult !== 'object'
            && typeof stageResult !== 'function')) {
            this.#throwFrameFailure(
                frame,
                'stage-pass-output-missing',
                `${record.kind} stage pass가 logical node를 반환하지 않았습니다.`
            );
        }

        const contentOutputs = [];
        if (record.contentBlurs.length > 0) {
            const contentSource = getContentSource(stageResult);
            if (!contentSource) {
                this.#throwFrameFailure(
                    frame,
                    'content-blur-source-missing',
                    `${record.kind} content blur source가 없습니다.`
                );
            }
            const contentCheckpoint = Object.freeze({
                id: `title:overlay:content:${frame.frameId}:${record.sequence}`,
                revision: nextCheckpointRevision(sourceCheckpoint.revision),
                colorSpace: contentSource.colorSpace
                    ?? sourceCheckpoint.colorSpace
                    ?? DEFAULT_COLOR_SPACE,
                format: contentSource.format ?? context.format
            });
            for (const rawRequest of record.contentBlurs) {
                const request = normalizeBlurRequest(rawRequest, {
                    bounds: record.bounds,
                    width: contentSource.width,
                    height: contentSource.height,
                    algorithmId: this.blurAlgorithmId,
                    colorSpace: contentCheckpoint.colorSpace,
                    format: contentCheckpoint.format
                });
                contentOutputs.push(this.#encodeBlur(
                    frame,
                    record,
                    'content',
                    contentCheckpoint,
                    contentSource,
                    request
                ));
            }
        }

        const logicalNode = Object.freeze({
            type: 'title-overlay-stage',
            id: record.id,
            kind: record.kind,
            order: record.order,
            sequence: record.sequence,
            layer: stageResult.node ?? stageResult,
            contentBlurOutputs: Object.freeze(contentOutputs.slice())
        });
        let nextCheckpoint = appendLogicalNode(sourceCheckpoint, logicalNode);
        this.checkpointAdvanceCount += 1;
        frame.stageOrder.push(record.kind);
        frame.stageSources.push(Object.freeze({
            stageId: record.id,
            kind: record.kind,
            sourceCheckpointId: sourceCheckpoint.id,
            sourceCheckpointRevision: sourceCheckpoint.revision,
            outputCheckpointId: nextCheckpoint.id,
            outputCheckpointRevision: nextCheckpoint.revision
        }));

        if (nextCheckpoint.liveStageCount > this.maxLiveStages) {
            nextCheckpoint = this.#compactCheckpoint(frame, context, nextCheckpoint);
        }
        this.maxRetainedLiveStageCount = Math.max(
            this.maxRetainedLiveStageCount,
            nextCheckpoint.liveStageCount
        );
        frame.maxRetainedLiveStageCount = Math.max(
            frame.maxRetainedLiveStageCount,
            nextCheckpoint.liveStageCount
        );
        frame.checkpoint = nextCheckpoint;
        frame.finalCheckpoint = nextCheckpoint;
    }

    #encodeBackdropBlur(frame, context, record, checkpoint, rawRequest) {
        const request = normalizeBlurRequest(rawRequest, {
            bounds: record.bounds,
            width: checkpoint.width,
            height: checkpoint.height,
            algorithmId: this.blurAlgorithmId,
            colorSpace: checkpoint.colorSpace,
            format: checkpoint.format
        });
        this.materializationRequestCount += 1;
        const materializationKey = makeMaterializationKey(checkpoint, request);
        let source = frame.materializationCache.get(materializationKey);
        let materializationShared = true;
        if (!source) {
            materializationShared = false;
            source = this.materializePass.encode(context, Object.freeze({
                frameId: frame.frameId,
                stageId: record.id,
                stageKind: record.kind,
                checkpoint,
                bounds: request.bounds,
                halo: request.halo,
                format: request.format,
                colorSpace: request.colorSpace,
                label: `title-overlay-roi:${frame.frameId}:${checkpoint.revision}`
            }));
            source = requireTextureResource(source, 'materializePass output');
            frame.materializationCache.set(materializationKey, source);
            this.materializationCount += 1;
        } else {
            this.materializationCacheHitCount += 1;
        }

        return this.#encodeBlur(
            frame,
            record,
            'backdrop',
            checkpoint,
            source,
            request,
            materializationShared
        );
    }

    #encodeBlur(
        frame,
        record,
        purpose,
        checkpoint,
        source,
        request,
        materializationShared = false
    ) {
        const normalizedSource = requireTextureResource(source, `${purpose} blur source`);
        this.blurRequestCount += 1;
        const textureId = this.#getTextureId(normalizedSource.texture);
        const cacheKey = makeBlurKey(checkpoint, textureId, request);
        let output = frame.blurCache.get(cacheKey);
        const shared = Boolean(output);
        if (!output) {
            output = this.blurPort.encode(Object.freeze({
                algorithmId: request.algorithmId,
                sourceTexture: normalizedSource.texture,
                sourceRevision: checkpoint.revision,
                checkpointId: checkpoint.id,
                bounds: request.bounds,
                halo: request.halo,
                sigma: request.sigma,
                edgeMode: request.edgeMode,
                colorSpace: request.colorSpace,
                format: request.format
            }));
            output = requireTextureResource(output, `${purpose} blur output`);
            output = inheritSourceLogicalBounds(output, normalizedSource);
            frame.blurCache.set(cacheKey, output);
            this.blurEncodeCount += 1;
        } else {
            this.sharedBlurHitCount += 1;
        }
        frame.blurReceipts.push(Object.freeze({
            stageId: record.id,
            stageKind: record.kind,
            purpose,
            checkpointId: checkpoint.id,
            checkpointRevision: checkpoint.revision,
            algorithmId: request.algorithmId,
            sigma: request.sigma,
            shared,
            materializationShared
        }));
        return output;
    }

    #compactCheckpoint(frame, context, checkpoint) {
        if (!this.compactPass) {
            this.#throwFrameFailure(
                frame,
                'live-stage-cap-exceeded',
                `logical stage ${checkpoint.liveStageCount}개가 cap ${this.maxLiveStages}를 초과했습니다.`
            );
        }
        const compactResult = this.compactPass.encode(context, Object.freeze({
            frameId: frame.frameId,
            checkpoint,
            maxLiveStages: this.maxLiveStages,
            reason: 'live-stage-cap'
        }));
        if (!compactResult || (typeof compactResult !== 'object'
            && typeof compactResult !== 'function')) {
            this.#throwFrameFailure(
                frame,
                'compaction-output-missing',
                'compactPass가 materialized logical node를 반환하지 않았습니다.'
            );
        }
        this.compactionCount += 1;
        frame.compactionCount += 1;
        return Object.freeze({
            ...checkpoint,
            nodes: Object.freeze([Object.freeze({
                type: 'title-overlay-compacted',
                revision: checkpoint.revision,
                layer: compactResult.node ?? compactResult
            })]),
            liveStageCount: 1,
            compacted: true
        });
    }

    #encodePresent(frame, pass, context) {
        this.#assertStableContext(frame, context);
        if (!frame.graphEncoded || !frame.finalCheckpoint) {
            this.#throwFrameFailure(
                frame,
                'final-checkpoint-missing',
                'final canvas pass 전에 logical checkpoint가 완성되지 않았습니다.'
            );
        }
        if (frame.presentPassCount !== 0) {
            this.#throwFrameFailure(
                frame,
                'duplicate-final-present',
                'title overlay final canvas pass는 frame당 한 번만 허용됩니다.'
            );
        }
        const result = this.presentPass.encode(pass, context, Object.freeze({
            frameId: frame.frameId,
            checkpoint: frame.finalCheckpoint,
            stageOrder: Object.freeze(frame.stageOrder.slice())
        }));
        if (result === false) {
            this.#throwFrameFailure(
                frame,
                'present-pass-rejected',
                'presentPass가 final checkpoint 기록을 거부했습니다.'
            );
        }
        frame.presentPassCount = 1;
        this.presentPassCount += 1;
    }

    #assertBaseCheckpoint(frame, context, checkpoint) {
        requireFrameContext(context);
        if (!checkpoint || typeof checkpoint !== 'object') {
            this.missingCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'missing-base-checkpoint',
                'title:overlay:0 checkpoint가 필요합니다.'
            );
        }
        if (checkpoint.id !== TITLE_WEBGPU_BASE_CHECKPOINT_ID) {
            this.missingCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'invalid-base-checkpoint-id',
                `예상하지 않은 base checkpoint입니다: ${String(checkpoint.id)}`
            );
        }
        if (context.frameId !== frame.frameId || checkpoint.frameId !== context.frameId) {
            this.staleCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'stale-base-checkpoint',
                'base checkpoint와 composer frameId가 일치하지 않습니다.'
            );
        }
        if (checkpoint.deviceGeneration !== context.deviceGeneration) {
            this.generationCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'generation-mismatched-base-checkpoint',
                'base checkpoint와 composer deviceGeneration이 일치하지 않습니다.'
            );
        }
        try {
            requireTextureResource(checkpoint, 'base checkpoint');
            requirePositiveSafeInteger(checkpoint.width, 'base checkpoint width');
            requirePositiveSafeInteger(checkpoint.height, 'base checkpoint height');
            requireNonEmptyString(checkpoint.format, 'base checkpoint format');
            requireNonNegativeSafeInteger(checkpoint.revision, 'base checkpoint revision');
        } catch (error) {
            this.incompatibleCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'invalid-base-checkpoint-resource',
                error.message
            );
        }
        if (checkpoint.width !== context.width
            || checkpoint.height !== context.height
            || checkpoint.format !== context.format
            || (checkpoint.lifetime != null && checkpoint.lifetime !== 'frame')) {
            this.incompatibleCheckpointRejectCount += 1;
            this.#throwFrameFailure(
                frame,
                'incompatible-base-checkpoint',
                'base checkpoint의 크기/format/lifetime이 composer target과 다릅니다.'
            );
        }
    }

    #assertStableContext(frame, context) {
        requireFrameContext(context);
        if (context.frameId !== frame.frameId
            || context.deviceGeneration !== frame.deviceGeneration
            || context.device !== frame.device
            || context.target !== frame.target
            || context.format !== frame.format
            || context.width !== frame.width
            || context.height !== frame.height) {
            this.#throwFrameFailure(
                frame,
                'composer-context-drift',
                'command encode와 final canvas pass 사이 composer context가 변경됐습니다.'
            );
        }
    }

    #settleFrame(frame, status, outcome = {}) {
        if (frame.settled) return false;
        frame.settled = true;
        const committed = status === 'committed';
        if (committed) this.commitCount += 1;
        else this.abortCount += 1;

        let cutoverQualified = false;
        let cutoverStatus = null;
        const fullScenePresented = committed
            && outcome?.submitted === true
            && frame.encoded
            && frame.baseCheckpointConsumed
            && frame.vignetteIncluded
            && frame.presentPassCount === 1
            && !frame.failure;
        if (fullScenePresented) {
            try {
                cutoverStatus = this.cutoverStatusProvider(Object.freeze({
                    frameId: frame.frameId,
                    deviceGeneration: frame.deviceGeneration,
                    checkpointId: frame.finalCheckpoint?.id ?? null,
                    checkpointRevision: frame.finalCheckpoint?.revision ?? null,
                    outcome
                }));
                cutoverQualified = isFullyCutOver(cutoverStatus);
            } catch (error) {
                this.cutoverProviderFailureCount += 1;
                this.lastFailure = Object.freeze({
                    reason: 'cutover-status-provider-threw',
                    message: formatError(error)
                });
            }
        }
        if (cutoverQualified) this.cutoverQualifiedCount += 1;

        const receipt = Object.freeze({
            sequence: this.nextReceiptSequence,
            status,
            committed,
            frameId: frame.frameId,
            deviceGeneration: frame.deviceGeneration,
            submitted: committed && outcome?.submitted === true,
            finalOverlayIncluded: committed && cutoverQualified,
            baseCheckpointConsumed: frame.baseCheckpointConsumed,
            vignetteIncluded: frame.vignetteIncluded,
            fullScenePresented,
            finalCanvasPassCount: frame.presentPassCount,
            finalCheckpointId: frame.finalCheckpoint?.id ?? null,
            finalCheckpointRevision: frame.finalCheckpoint?.revision ?? null,
            presentPassCount: frame.presentPassCount,
            stageOrder: Object.freeze(frame.stageOrder.slice()),
            stageSources: Object.freeze(frame.stageSources.slice()),
            blurRequests: Object.freeze(frame.blurReceipts.slice()),
            compactionCount: frame.compactionCount,
            maxRetainedLiveStageCount: frame.maxRetainedLiveStageCount,
            failure: frame.failure,
            abortReason: committed ? null : (outcome?.reason ?? null),
            cutoverStatus: snapshotCutoverStatus(cutoverStatus)
        });
        this.nextReceiptSequence += 1;
        this.#enqueueReceipt(receipt);
        this.lastFrameId = frame.frameId;
        this.lastDeviceGeneration = frame.deviceGeneration;
        this.lastCheckpointRevision = frame.finalCheckpoint?.revision ?? null;

        frame.materializationCache.clear();
        frame.blurCache.clear();
        frame.records.length = 0;
        frame.finalCheckpoint = null;
        frame.checkpoint = null;
        if (this.activeFrame === frame) this.activeFrame = null;
        return true;
    }

    #enqueueReceipt(receipt) {
        if (this.receipts.length >= this.maxReceipts) {
            this.receipts.shift();
            this.droppedReceiptCount += 1;
        }
        this.receipts.push(receipt);
    }

    #getTextureId(texture) {
        let id = this.textureIds.get(texture);
        if (id !== undefined) return id;
        this.nextTextureId += 1;
        id = this.nextTextureId;
        this.textureIds.set(texture, id);
        return id;
    }

    #throwFrameFailure(frame, reason, message) {
        this.#fail(frame, reason, new Error(message));
        const error = new Error(message);
        error.titleWebGpuOverlayReason = reason;
        throw error;
    }

    #fail(frame, reason, error = null) {
        const firstFrameFailure = !frame || frame.failure == null;
        if (firstFrameFailure) {
            this.failureCount += 1;
        }
        if (frame && frame.failure == null) frame.failure = reason;
        if (frame && !firstFrameFailure) return false;
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
        device: null,
        deviceGeneration: null,
        target: null,
        format: null,
        width: 0,
        height: 0,
        finalizing: false,
        settled: false,
        graphEncoded: false,
        encoded: false,
        baseCheckpointConsumed: false,
        vignetteIncluded: false,
        failure: null,
        records: [],
        nextSequence: 0,
        checkpoint: null,
        finalCheckpoint: null,
        stageOrder: [],
        stageSources: [],
        blurReceipts: [],
        materializationCache: new Map(),
        blurCache: new Map(),
        presentPassCount: 0,
        compactionCount: 0,
        maxRetainedLiveStageCount: 0
    };
}

function createBaseLogicalCheckpoint(checkpoint) {
    return Object.freeze({
        id: checkpoint.id,
        frameId: checkpoint.frameId,
        deviceGeneration: checkpoint.deviceGeneration,
        width: checkpoint.width,
        height: checkpoint.height,
        format: checkpoint.format,
        revision: checkpoint.revision,
        colorSpace: checkpoint.colorSpace ?? DEFAULT_COLOR_SPACE,
        alphaMode: checkpoint.alphaMode ?? DEFAULT_ALPHA_MODE,
        lifetime: 'frame',
        nodes: Object.freeze([Object.freeze({
            type: 'title-overlay-base',
            id: checkpoint.id,
            resource: checkpoint
        })]),
        liveStageCount: 0,
        compacted: false
    });
}

function appendLogicalNode(checkpoint, node) {
    const revision = nextCheckpointRevision(checkpoint.revision);
    return Object.freeze({
        ...checkpoint,
        id: `title:overlay:${checkpoint.liveStageCount + 1}:${revision}`,
        revision,
        nodes: Object.freeze([...checkpoint.nodes, node]),
        liveStageCount: checkpoint.liveStageCount + 1
    });
}

function nextCheckpointRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 0
        || revision >= Number.MAX_SAFE_INTEGER) {
        throw new RangeError('title overlay checkpoint revision을 안전하게 증가시킬 수 없습니다.');
    }
    return revision + 1;
}

function compareStageRecords(a, b) {
    const rankDelta = STAGE_RANK.get(a.kind) - STAGE_RANK.get(b.kind);
    if (rankDelta !== 0) return rankDelta;
    const orderDelta = a.order - b.order;
    return orderDelta !== 0 ? orderDelta : a.sequence - b.sequence;
}

function normalizeBlurRequest(rawRequest, defaults) {
    const raw = rawRequest && typeof rawRequest === 'object'
        ? rawRequest
        : { sigma: rawRequest };
    const sigma = Number(raw.sigma ?? raw.radius ?? 0);
    if (!Number.isFinite(sigma) || sigma < 0) {
        throw new RangeError('blur sigma는 0 이상의 유한수여야 합니다.');
    }
    const bounds = normalizeBounds(
        raw.bounds ?? defaults.bounds,
        defaults.width,
        defaults.height
    );
    const halo = normalizeHalo(raw.halo);
    return Object.freeze({
        algorithmId: requireNonEmptyString(
            raw.algorithmId ?? defaults.algorithmId,
            'blur algorithmId'
        ),
        bounds,
        halo,
        sigma,
        edgeMode: requireNonEmptyString(raw.edgeMode ?? 'clamp', 'blur edgeMode'),
        colorSpace: requireNonEmptyString(
            raw.colorSpace ?? defaults.colorSpace ?? DEFAULT_COLOR_SPACE,
            'blur colorSpace'
        ),
        format: requireNonEmptyString(raw.format ?? defaults.format, 'blur format')
    });
}

function normalizeBounds(value, fallbackWidth, fallbackHeight) {
    const bounds = value ?? {
        x: 0,
        y: 0,
        width: fallbackWidth,
        height: fallbackHeight
    };
    const x = Number(bounds?.x ?? 0);
    const y = Number(bounds?.y ?? 0);
    const width = Number(bounds?.width ?? fallbackWidth);
    const height = Number(bounds?.height ?? fallbackHeight);
    if (![x, y, width, height].every(Number.isFinite)
        || width <= 0
        || height <= 0) {
        throw new RangeError('blur bounds에는 유효한 x/y/양수 width/height가 필요합니다.');
    }
    return Object.freeze({ x, y, width, height });
}

function normalizeHalo(value) {
    const halo = value ?? {};
    const left = Number(halo.left ?? 0);
    const top = Number(halo.top ?? 0);
    const right = Number(halo.right ?? 0);
    const bottom = Number(halo.bottom ?? 0);
    if (![left, top, right, bottom].every((entry) => (
        Number.isFinite(entry) && entry >= 0
    ))) {
        throw new RangeError('blur halo는 0 이상의 유한수여야 합니다.');
    }
    return Object.freeze({ left, top, right, bottom });
}

function freezeRequestList(value) {
    if (value == null) return Object.freeze([]);
    const list = Array.isArray(value) ? value : [value];
    return Object.freeze(list.slice());
}

function makeMaterializationKey(checkpoint, request) {
    return JSON.stringify([
        checkpoint.id,
        checkpoint.revision,
        request.bounds.x,
        request.bounds.y,
        request.bounds.width,
        request.bounds.height,
        request.halo.left,
        request.halo.top,
        request.halo.right,
        request.halo.bottom,
        request.colorSpace,
        request.format
    ]);
}

function makeBlurKey(checkpoint, textureId, request) {
    return JSON.stringify([
        checkpoint.id,
        checkpoint.revision,
        textureId,
        request.algorithmId,
        request.bounds.x,
        request.bounds.y,
        request.bounds.width,
        request.bounds.height,
        request.halo.left,
        request.halo.top,
        request.halo.right,
        request.halo.bottom,
        request.sigma,
        request.edgeMode,
        request.colorSpace,
        request.format
    ]);
}

function getContentSource(stageResult) {
    const source = stageResult.contentSource ?? stageResult.resource ?? null;
    return source ? requireTextureResource(source, 'stage content source') : null;
}

function inheritSourceLogicalBounds(output, source) {
    if (output.logicalBounds || !source.logicalBounds) return output;
    const logicalBounds = normalizeBounds(
        source.logicalBounds,
        source.width,
        source.height
    );
    return Object.freeze({
        ...output,
        logicalBounds
    });
}

function isFullyCutOver(status) {
    return Boolean(status
        && typeof status === 'object'
        && status.fullCutoverActive === true
        && status.legacyVisibleSurfaceCount === 0
        && status.webGpuSurfaceVisible === true
        && status.topControlSurfacePreserved === true
        && status.cssPresentationNeutralized === true
        && status.fallbackPending !== true
        && status.destroyed !== true);
}

function snapshotCutoverStatus(status) {
    if (!status || typeof status !== 'object') return null;
    return Object.freeze({
        fullCutoverActive: status.fullCutoverActive === true,
        legacyVisibleSurfaceCount: Number.isSafeInteger(status.legacyVisibleSurfaceCount)
            ? status.legacyVisibleSurfaceCount
            : null,
        webGpuSurfaceVisible: status.webGpuSurfaceVisible === true,
        topControlSurfacePreserved: status.topControlSurfacePreserved === true,
        cssPresentationNeutralized: status.cssPresentationNeutralized === true,
        fallbackPending: status.fallbackPending === true,
        destroyed: status.destroyed === true
    });
}

function requireFramePort(port) {
    if (!port || typeof port !== 'object') {
        throw new TypeError('framePort가 필요합니다.');
    }
    for (const method of [
        'isFrameActive',
        'deferFrameCallbacks',
        'encodeCommands',
        'encodeCanvasPass'
    ]) {
        if (typeof port[method] !== 'function') {
            throw new TypeError(`framePort.${method}()가 필요합니다.`);
        }
    }
    return port;
}

function requireEncodePort(port, name) {
    if (!port || typeof port.encode !== 'function') {
        throw new TypeError(`${name}.encode()가 필요합니다.`);
    }
    return port;
}

function requireTextureResource(resource, name) {
    if (!resource || typeof resource !== 'object') {
        throw new TypeError(`${name} descriptor가 필요합니다.`);
    }
    requireIdentity(resource.texture, `${name} texture`);
    requireIdentity(resource.view, `${name} view`);
    requirePositiveSafeInteger(resource.width, `${name} width`);
    requirePositiveSafeInteger(resource.height, `${name} height`);
    requireNonEmptyString(resource.format, `${name} format`);
    return resource;
}

function requireFrameContext(context) {
    requireNonNegativeSafeInteger(context?.frameId, 'context frameId');
    requireNonNegativeSafeInteger(
        context?.deviceGeneration,
        'context deviceGeneration'
    );
    requireIdentity(context?.device, 'context device');
    requireIdentity(context?.target, 'context target');
    requirePositiveSafeInteger(context?.width, 'context width');
    requirePositiveSafeInteger(context?.height, 'context height');
    requireNonEmptyString(context?.format, 'context format');
    return context;
}

function requireIdentity(value, name) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new TypeError(`${name} identity가 필요합니다.`);
    }
    return value;
}

function requireFunction(value, name) {
    if (typeof value !== 'function') {
        throw new TypeError(`${name} 함수가 필요합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, name) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${name} 문자열이 필요합니다.`);
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

function normalizeOptionalId(value) {
    if (value == null) return null;
    return requireNonEmptyString(value, 'stage id');
}

function normalizeFiniteNumber(value, fallback) {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) ? number : fallback;
}

function formatError(error) {
    if (error instanceof Error) return error.message;
    return String(error);
}

function normalizeFailureReason(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : 'external-cancel';
}
