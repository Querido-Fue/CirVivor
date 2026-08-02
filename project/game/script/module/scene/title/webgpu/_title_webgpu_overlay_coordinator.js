import { TITLE_WEBGPU_BASE_CHECKPOINT_ID } from './_title_webgpu_checkpoint_registry.js';
import { recordTitleWebGpuOverlayFrame } from './_title_webgpu_overlay_recording.js';

const DEFAULT_BLUR_ALGORITHM_ID = 'gaussian-quality';

/**
 * base graph 이후 overlay graph의 frame-local lifecycle과 atomic cutover를 묶습니다.
 * acquire/submit/present ownership은 계속 Display의 공유 frame composer에만 있습니다.
 */
export class TitleWebGpuOverlayCoordinator {
    constructor(options = {}) {
        this.baseGraph = requireMethod(options.baseGraph, 'getCheckpoint', 'baseGraph');
        this.graph = requireOverlayGraph(options.graph);
        this.renderer = requireRenderer(options.renderer);
        this.cutover = requireCutover(options.cutover);
        this.blurPort = options.blurPort ?? null;
        this.blurAlgorithmId = requireNonEmptyString(
            options.blurAlgorithmId ?? DEFAULT_BLUR_ALGORITHM_ID,
            'blurAlgorithmId'
        );
        this.recordFrame = typeof options.recordFrame === 'function'
            ? options.recordFrame
            : recordTitleWebGpuOverlayFrame;

        this.activeFrame = null;
        this.destroyed = false;
        this.lastBeginResult = null;
        this.lastRecordingReceipt = null;
        this.lastGraphReceipt = null;
        this.lastFailure = null;
        this.beginCount = 0;
        this.finalizeCount = 0;
        this.abortCount = 0;
        this.restoreCount = 0;
        this.receiptCommitCount = 0;
        this.receiptAbortCount = 0;
        this.incompleteRecordingCount = 0;
    }

    /** scene draw 직전에 호출해 이전 receipt를 반영하고 이번 logical frame을 엽니다. */
    beginFrame(input = {}) {
        if (this.destroyed || this.activeFrame) {
            return this.#beginFailure('coordinator-unavailable');
        }

        const frameId = normalizeNonNegativeInteger(input.frameId, 'frameId');
        const width = normalizePositiveInteger(input.width, 'width');
        const height = normalizePositiveInteger(input.height, 'height');
        this.#consumeGraphReceipts();

        const cutoverFrame = this.cutover.beginFrame();
        try {
            if (this.graph.beginFrame(frameId) !== true) {
                throw new Error('overlay graph beginFrame이 거부되었습니다.');
            }
            if (this.renderer.beginFrame(frameId) !== true) {
                throw new Error('overlay renderer beginFrame이 거부되었습니다.');
            }
        } catch (error) {
            this.graph.cancelActiveFrame?.('coordinator-begin-failed');
            this.#restoreLegacy('coordinator-begin-failed');
            return this.#beginFailure('begin-failed', error, cutoverFrame);
        }

        this.activeFrame = {
            frameId,
            width,
            height,
            fullCutoverActive: cutoverFrame.fullCutoverActive === true
        };
        this.beginCount += 1;
        this.lastFailure = null;
        this.lastBeginResult = freezeBeginResult({
            accepted: true,
            frameId,
            legacyDrawRequired: cutoverFrame.legacyDrawRequired !== false,
            fullCutoverActive: cutoverFrame.fullCutoverActive === true,
            fallbackRecovered: cutoverFrame.fallbackRecovered === true,
            reason: null
        });
        return this.lastBeginResult;
    }

    /** 모든 legacy draw가 끝난 뒤 snapshot을 기록하고 C0 뒤 final canvas pass를 예약합니다. */
    finalizeFrame(input = {}) {
        const frame = this.activeFrame;
        if (!frame || this.destroyed) {
            return this.#finalizeFailure('frame-unavailable');
        }
        if (input.frameId !== undefined && input.frameId !== frame.frameId) {
            return this.#abortFrame('stale-finalize-frame');
        }

        try {
            const recording = this.recordFrame({
                graph: this.graph,
                frameId: frame.frameId,
                width: frame.width,
                height: frame.height,
                blurAlgorithmId: this.blurAlgorithmId,
                blurPort: this.blurPort,
                vignettePacket: input.vignettePacket ?? null,
                mainSnapshot: input.mainSnapshot ?? null,
                managerSnapshots: input.managerSnapshots ?? [],
                dynamicSurfaces: input.dynamicSurfaces ?? []
            });
            if (!recording || recording.complete !== true) {
                this.incompleteRecordingCount += 1;
                const missing = Array.isArray(recording?.unclaimedSurfaceIds)
                    ? recording.unclaimedSurfaceIds.join(',')
                    : 'unknown';
                throw new Error(`overlay surface capture가 불완전합니다: ${missing}`);
            }

            const checkpoint = input.baseCheckpoint
                ?? this.baseGraph.getCheckpoint(TITLE_WEBGPU_BASE_CHECKPOINT_ID);
            if (!checkpoint) {
                throw new Error('title base checkpoint C0가 없습니다.');
            }
            if (this.graph.finalize(checkpoint) !== true) {
                throw new Error('overlay graph finalize가 거부되었습니다.');
            }

            const synchronized = frame.fullCutoverActive
                ? this.cutover.synchronize() === true
                : false;
            this.activeFrame = null;
            this.finalizeCount += 1;
            this.lastRecordingReceipt = recording;
            this.lastFailure = null;
            return Object.freeze({
                accepted: true,
                frameId: frame.frameId,
                fullCutoverActive: frame.fullCutoverActive,
                cutoverSynchronized: synchronized,
                recording
            });
        } catch (error) {
            return this.#abortFrame('finalize-failed', error);
        }
    }

    /** presentation 예외/scene handoff에서 열린 frame을 취소하고 legacy를 즉시 복구합니다. */
    abortFrame(reason = 'presentation-aborted') {
        if (!this.activeFrame || this.destroyed) return false;
        this.#abortFrame(normalizeReason(reason));
        return true;
    }

    /** device loss/resize/handoff 경계의 즉시 복원 진입점입니다. */
    restoreNow(reason = 'coordinator-restore') {
        if (this.destroyed) return false;
        if (this.activeFrame) {
            this.graph.cancelActiveFrame?.(normalizeReason(reason));
            this.activeFrame = null;
            this.abortCount += 1;
        }
        return this.#restoreLegacy(reason);
    }

    getDiagnostics() {
        return Object.freeze({
            status: this.destroyed
                ? 'destroyed'
                : (this.activeFrame ? 'active' : 'ready'),
            blurAlgorithmId: this.blurAlgorithmId,
            beginCount: this.beginCount,
            finalizeCount: this.finalizeCount,
            abortCount: this.abortCount,
            restoreCount: this.restoreCount,
            receiptCommitCount: this.receiptCommitCount,
            receiptAbortCount: this.receiptAbortCount,
            incompleteRecordingCount: this.incompleteRecordingCount,
            activeFrameId: this.activeFrame?.frameId ?? null,
            lastBeginResult: this.lastBeginResult,
            lastRecordingReceipt: this.lastRecordingReceipt,
            lastGraphReceipt: this.lastGraphReceipt,
            lastFailure: this.lastFailure,
            cutover: this.cutover.getStatus(),
            graph: this.graph.getDiagnostics?.() ?? null,
            renderer: this.renderer.getDiagnostics?.() ?? null
        });
    }

    destroy() {
        if (this.destroyed) return false;
        this.restoreNow('coordinator-destroy');
        this.graph.destroy?.();
        this.renderer.destroy?.();
        this.cutover.destroy?.();
        this.destroyed = true;
        return true;
    }

    #consumeGraphReceipts() {
        const receipts = this.graph.drainReceipts();
        for (const receipt of receipts) {
            this.lastGraphReceipt = receipt;
            if (receipt?.committed === true) {
                this.cutover.commitFrame(receipt);
                this.receiptCommitCount += 1;
            } else {
                this.cutover.abortFrame(
                    receipt?.abortReason ?? receipt?.failure ?? 'overlay-frame-aborted'
                );
                this.receiptAbortCount += 1;
            }
        }
    }

    #abortFrame(reason, error = null) {
        const frameId = this.activeFrame?.frameId ?? null;
        this.graph.cancelActiveFrame?.(reason);
        this.activeFrame = null;
        this.abortCount += 1;
        this.#restoreLegacy(reason);
        this.lastFailure = Object.freeze({
            reason,
            message: error ? formatError(error) : null,
            frameId
        });
        return Object.freeze({
            accepted: false,
            frameId,
            reason,
            message: this.lastFailure.message
        });
    }

    #restoreLegacy(reason) {
        const restored = this.cutover.restoreNow(normalizeReason(reason)) === true;
        if (restored) this.restoreCount += 1;
        return restored;
    }

    #beginFailure(reason, error = null, cutoverFrame = null) {
        this.lastFailure = Object.freeze({
            reason,
            message: error ? formatError(error) : null,
            frameId: null
        });
        this.lastBeginResult = freezeBeginResult({
            accepted: false,
            frameId: null,
            legacyDrawRequired: true,
            fullCutoverActive: false,
            fallbackRecovered: cutoverFrame?.fallbackRecovered === true,
            reason
        });
        return this.lastBeginResult;
    }

    #finalizeFailure(reason) {
        this.lastFailure = Object.freeze({ reason, message: null, frameId: null });
        return Object.freeze({
            accepted: false,
            frameId: null,
            reason,
            message: null
        });
    }
}

function requireOverlayGraph(graph) {
    for (const method of [
        'beginFrame',
        'finalize',
        'drainReceipts',
        'cancelActiveFrame'
    ]) {
        requireMethod(graph, method, 'graph');
    }
    return graph;
}

function requireRenderer(renderer) {
    requireMethod(renderer, 'beginFrame', 'renderer');
    return renderer;
}

function requireCutover(cutover) {
    for (const method of [
        'beginFrame',
        'commitFrame',
        'abortFrame',
        'restoreNow',
        'synchronize',
        'getStatus'
    ]) {
        requireMethod(cutover, method, 'cutover');
    }
    return cutover;
}

function requireMethod(value, method, label) {
    if (!value || typeof value[method] !== 'function') {
        throw new TypeError(`${label}.${method}()가 필요합니다.`);
    }
    return value;
}

function normalizeNonNegativeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function normalizePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`${label} 문자열이 필요합니다.`);
    }
    return value.trim();
}

function normalizeReason(value) {
    return typeof value === 'string' && value.trim()
        ? value.trim()
        : 'coordinator-aborted';
}

function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}

function freezeBeginResult(value) {
    return Object.freeze({
        accepted: value.accepted === true,
        frameId: value.frameId,
        legacyDrawRequired: value.legacyDrawRequired !== false,
        fullCutoverActive: value.fullCutoverActive === true,
        fallbackRecovered: value.fallbackRecovered === true,
        reason: value.reason ?? null
    });
}
