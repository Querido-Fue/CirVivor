/**
 * WebGPU frame composer의 외부 상태입니다.
 */
export const WEBGPU_FRAME_COMPOSER_STATUS = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    COMMITTED: 'committed',
    ABORTED: 'aborted',
    DESTROYED: 'destroyed'
});

/** title WebGPU frame graph 전체를 나타내는 전용 GPU timestamp scope입니다. */
export const WEBGPU_FRAME_GPU_TELEMETRY_SCOPE = 'title.webgpu_graph.gpu_ms';

const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
const TIMESTAMP_QUERY_FEATURE = 'timestamp-query';
const TIMESTAMP_QUERY_COUNT = 2;
const TIMESTAMP_RESULT_BYTE_LENGTH = 16;
const TIMESTAMP_TO_MILLISECONDS = 1 / 1_000_000;
const GPU_TELEMETRY_RING_SIZE = 16;
const GPU_TELEMETRY_SAMPLE_CAPACITY = 8192;
const BUFFER_USAGE_MAP_READ = 0x0001;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_QUERY_RESOLVE = 0x0200;
const MAP_MODE_READ = 0x0001;
const REQUIRED_PLATFORM_METHODS = Object.freeze([
    'getState',
    'getDevice',
    'acquireFrameTarget',
    'markCanvasDrawn',
    'markCanvasCleared'
]);

/**
 * 오류를 진단 가능한 짧은 문자열로 변환합니다.
 * @param {unknown} error - 변환할 오류입니다.
 * @returns {string} 오류 메시지입니다.
 */
function formatErrorMessage(error) {
    if (error && typeof error.message === 'string') {
        return error.message;
    }
    return String(error ?? 'unknown');
}

function hasWebGpuFeature(features, featureName) {
    if (!features || typeof featureName !== 'string') {
        return false;
    }
    try {
        if (typeof features.has === 'function') {
            return features.has(featureName);
        }
        return Array.from(features.values ? features.values() : features).includes(featureName);
    } catch {
        return false;
    }
}

/**
 * frame composer 누적 진단 초기값을 만듭니다.
 * @returns {object} mutable 내부 진단입니다.
 */
function createDiagnostics() {
    return {
        framesBegun: 0,
        framesCommitted: 0,
        framesAborted: 0,
        noWorkCommits: 0,
        acquireCount: 0,
        encoderCount: 0,
        contributionCount: 0,
        canvasPassCount: 0,
        clearPassCount: 0,
        submitCount: 0,
        canvasDrawnMarkCount: 0,
        canvasClearedMarkCount: 0,
        duplicateCommitCount: 0,
        invalidTransitionCount: 0,
        acquireFailureCount: 0,
        encodeFailureCount: 0,
        submitFailureCount: 0,
        driftFailureCount: 0,
        signalFailureCount: 0,
        callbackFailureCount: 0,
        destroyCount: 0
    };
}

function createGpuTelemetryDiagnostics() {
    return {
        scopeBeginCount: 0,
        scopeEndCount: 0,
        timestampSubmitCount: 0,
        sampleCount: 0,
        droppedSlotCount: 0,
        bufferedSampleDropCount: 0,
        apiFailureCount: 0,
        mapFailureCount: 0,
        invalidTimestampCount: 0,
        uncapturedErrorCount: 0,
        resourceCreateCount: 0,
        resourceDestroyCount: 0
    };
}

function createGpuTelemetrySlot(index) {
    return {
        index,
        state: 'idle',
        device: null,
        deviceGeneration: null,
        querySet: null,
        resolveBuffer: null,
        readBuffer: null,
        frameId: null,
        token: 0
    };
}

/**
 * 한 canvas의 여러 WebGPU contributor를 단일 frame target, encoder, submit으로 합성합니다.
 */
export class WebGpuFrameComposer {
    /**
     * @param {object} platformPort - WebGPU platform service의 제한 port입니다.
     */
    constructor(platformPort) {
        for (const methodName of REQUIRED_PLATFORM_METHODS) {
            if (typeof platformPort?.[methodName] !== 'function') {
                throw new TypeError(`WebGPU platform port에 ${methodName}()가 없습니다.`);
            }
        }

        this.platformPort = platformPort;
        this.destroyed = false;
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.IDLE;
        this.lastFrameId = null;
        this.frame = null;
        this.diagnostics = createDiagnostics();
        this.lastFailure = null;
        this.lastCallbackFailure = null;
        this.gpuTelemetry = {
            enabled: false,
            status: 'disabled',
            lifecycleGeneration: 0,
            supported: null,
            reason: null,
            nextSlotIndex: 0,
            slots: Array.from(
                { length: GPU_TELEMETRY_RING_SIZE },
                (_, index) => createGpuTelemetrySlot(index)
            ),
            samples: [],
            lastSample: null,
            faultDeviceGeneration: null,
            observedDevice: null,
            observedDeviceGeneration: null,
            uncapturedErrorListener: null,
            uncapturedErrorMessages: [],
            diagnostics: createGpuTelemetryDiagnostics()
        };

        const composer = this;
        this.contributorPort = Object.freeze({
            isFrameActive() {
                return composer.isFrameActive();
            },
            encodeCommands(callback) {
                return composer.encodeCommands(callback);
            },
            encodeCanvasPass(callback, options) {
                return composer.encodeCanvasPass(callback, options);
            },
            clearCanvas(clearValue) {
                return composer.clearCanvas(clearValue);
            },
            deferFrameCallbacks(callbacks) {
                return composer.deferFrameCallbacks(callbacks);
            }
        });
        this.gpuTelemetryPort = Object.freeze({
            setEnabled(enabled) {
                return composer.setGpuTelemetryEnabled(enabled);
            },
            drainSamples() {
                return composer.drainGpuTelemetrySamples();
            },
            getSnapshot() {
                return composer.getGpuTelemetrySnapshot();
            }
        });
    }

    /**
     * contributor가 공유할 안정적이고 immutable한 port를 반환합니다.
     * @returns {object} frame contribution port입니다.
     */
    getPort() {
        return this.contributorPort;
    }

    /**
     * WebGL timer와 분리된 composer-owned timestamp 진단 port를 반환합니다.
     * @returns {Readonly<object>} 안정적인 telemetry port입니다.
     */
    getGpuTelemetryPort() {
        return this.gpuTelemetryPort;
    }

    /**
     * 이후 제출 프레임의 WebGPU timestamp 기록 여부를 설정합니다.
     * 이미 제출된 readback은 비활성화 뒤에도 안전하게 drain됩니다.
     * @param {boolean} enabled - 계측 활성화 여부입니다.
     * @returns {boolean} 정규화된 활성 상태입니다.
     */
    setGpuTelemetryEnabled(enabled) {
        const telemetry = this.gpuTelemetry;
        if (this.destroyed) {
            telemetry.enabled = false;
            return false;
        }
        telemetry.enabled = enabled === true;
        if (telemetry.enabled) {
            if (telemetry.status === 'disabled') {
                telemetry.status = 'armed';
                telemetry.reason = null;
            }
        } else {
            telemetry.status = 'disabled';
        }
        return telemetry.enabled;
    }

    /**
     * 완료된 WebGPU timestamp sample을 반환하고 내부 queue에서 제거합니다.
     * @returns {ReadonlyArray<object>} WebGL sample과 identity가 섞이지 않는 sample입니다.
     */
    drainGpuTelemetrySamples() {
        if (this.gpuTelemetry.samples.length === 0) {
            return [];
        }
        return this.gpuTelemetry.samples.splice(0, this.gpuTelemetry.samples.length);
    }

    /**
     * timestamp 지원/대기/실패 상태를 직렬화 가능한 immutable snapshot으로 반환합니다.
     * @returns {object} WebGPU frame telemetry 진단입니다.
     */
    getGpuTelemetrySnapshot() {
        const telemetry = this.gpuTelemetry;
        let pendingCount = 0;
        let encodingCount = 0;
        let faultedSlotCount = 0;
        for (const slot of telemetry.slots) {
            if (slot.state === 'pending') pendingCount += 1;
            if (slot.state === 'encoding' || slot.state === 'encoded') encodingCount += 1;
            if (slot.state === 'faulted') faultedSlotCount += 1;
        }
        return Object.freeze({
            source: 'webgpu-frame-composer',
            scope: WEBGPU_FRAME_GPU_TELEMETRY_SCOPE,
            enabled: telemetry.enabled,
            status: telemetry.status,
            supported: telemetry.supported,
            reason: telemetry.reason,
            ringSize: telemetry.slots.length,
            pendingCount,
            encodingCount,
            faultedSlotCount,
            bufferedSampleCount: telemetry.samples.length,
            counters: Object.freeze({ ...telemetry.diagnostics }),
            uncapturedErrorMessages: Object.freeze([...telemetry.uncapturedErrorMessages]),
            lastSample: telemetry.lastSample
        });
    }

    /**
     * active frame 존재 여부를 side effect 없이 반환합니다.
     * @returns {boolean} contribution/commit 가능한 frame이면 true입니다.
     */
    isFrameActive() {
        return this.status === WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE && this.frame !== null;
    }

    /**
     * 새 logical frame을 시작합니다.
     * active frame이 있으면 기존 command를 암묵적으로 폐기하지 않고 실패합니다.
     * @param {number} frameId - 상위 display frame의 안전한 정수 id입니다.
     * @returns {boolean} frame을 시작했으면 true입니다.
     */
    beginFrame(frameId) {
        if (this.destroyed) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }
        if (this.status === WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }
        if (!Number.isSafeInteger(frameId) || frameId < 0) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }

        this.lastFrameId = frameId;
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE;
        this.frame = {
            frameId,
            state: null,
            device: null,
            deviceGeneration: null,
            target: null,
            format: null,
            width: 0,
            height: 0,
            encoder: null,
            context: null,
            contributionCount: 0,
            canvasWriteCount: 0,
            drawIntent: false,
            clearIntent: false,
            deferredCallbacks: [],
            gpuTimestampSlot: null
        };
        this.diagnostics.framesBegun += 1;
        return true;
    }

    /**
     * contributor의 임의 compute/copy command를 현재 frame encoder에 기록합니다.
     * 이 함수 자체는 canvas draw intent를 만들지 않습니다.
     * @param {Function} callback - 고정된 frame context를 받는 동기 encoder callback입니다.
     * @returns {boolean} command 기록 성공 여부입니다.
     */
    encodeCommands(callback) {
        if (typeof callback !== 'function') {
            return this.#failEncoding('encode-callback-invalid', new TypeError('callback 필요'));
        }
        const frame = this.#ensureFrameResources();
        if (!frame) {
            return false;
        }

        try {
            const result = callback(frame.context);
            if (result && typeof result.then === 'function') {
                throw new TypeError('WebGPU encode callback은 동기 함수여야 합니다.');
            }
            frame.contributionCount += 1;
            this.diagnostics.contributionCount += 1;
        } catch (error) {
            return this.#failEncoding('encode-commands-failed', error);
        }
        return this.#validateCurrentFrame('post-encode-commands-drift');
    }

    /**
     * 현재 canvas target에 render pass를 기록합니다.
     * frame의 첫 canvas write는 clear, 후속 write는 load로 강제됩니다.
     * @param {Function} callback - `(passEncoder, frameContext)` 동기 callback입니다.
     * @param {object} [options] - render pass 옵션입니다.
     * @param {string} [options.label] - pass label입니다.
     * @param {{r:number,g:number,b:number,a:number}} [options.clearValue] - 첫 clear 색입니다.
     * @returns {boolean} render pass 기록 성공 여부입니다.
     */
    encodeCanvasPass(callback, options = {}) {
        if (typeof callback !== 'function') {
            return this.#failEncoding(
                'canvas-pass-callback-invalid',
                new TypeError('callback 필요')
            );
        }
        const frame = this.#ensureFrameResources();
        if (!frame) {
            return false;
        }

        const firstCanvasWrite = frame.canvasWriteCount === 0;
        try {
            const pass = frame.encoder.beginRenderPass({
                label: options.label || `display-webgpu-frame-pass:${frame.frameId}`,
                colorAttachments: [{
                    view: frame.target.view,
                    clearValue: options.clearValue || TRANSPARENT_CLEAR_VALUE,
                    loadOp: firstCanvasWrite ? 'clear' : 'load',
                    storeOp: 'store'
                }]
            });
            const result = callback(pass, frame.context);
            if (result && typeof result.then === 'function') {
                throw new TypeError('WebGPU canvas pass callback은 동기 함수여야 합니다.');
            }
            pass.end();
            frame.canvasWriteCount += 1;
            frame.contributionCount += 1;
            frame.drawIntent = true;
            frame.clearIntent = false;
            this.diagnostics.canvasPassCount += 1;
            this.diagnostics.contributionCount += 1;
        } catch (error) {
            return this.#failEncoding('encode-canvas-pass-failed', error);
        }
        return this.#validateCurrentFrame('post-canvas-pass-drift');
    }

    /**
     * 투명 canvas clear contribution을 기록합니다.
     * 후속 canvas pass가 없으면 commit 뒤 clear signal만 한 번 보냅니다.
     * @param {{r:number,g:number,b:number,a:number}} [clearValue] - clear 색입니다.
     * @returns {boolean} clear pass 기록 성공 여부입니다.
     */
    clearCanvas(clearValue = TRANSPARENT_CLEAR_VALUE) {
        const frame = this.#ensureFrameResources();
        if (!frame) {
            return false;
        }

        try {
            const pass = frame.encoder.beginRenderPass({
                label: `display-webgpu-frame-clear:${frame.frameId}`,
                colorAttachments: [{
                    view: frame.target.view,
                    clearValue,
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            pass.end();
            frame.canvasWriteCount += 1;
            frame.contributionCount += 1;
            frame.drawIntent = false;
            frame.clearIntent = true;
            this.diagnostics.clearPassCount += 1;
            this.diagnostics.contributionCount += 1;
        } catch (error) {
            return this.#failEncoding('encode-clear-pass-failed', error);
        }
        return this.#validateCurrentFrame('post-clear-pass-drift');
    }

    /**
     * GPU submit 결과에 종속된 contributor local 상태 callback을 등록합니다.
     * @param {object} callbacks - 완료 또는 폐기 callback입니다.
     * @param {Function} [callbacks.committed] - 성공한 commit 뒤 한 번 호출됩니다.
     * @param {Function} [callbacks.aborted] - frame 폐기 뒤 한 번 호출됩니다.
     * @returns {boolean} active frame에 등록했으면 true입니다.
     */
    deferFrameCallbacks(callbacks = {}) {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }
        const committed = typeof callbacks.committed === 'function'
            ? callbacks.committed
            : null;
        const aborted = typeof callbacks.aborted === 'function'
            ? callbacks.aborted
            : null;
        if (!committed && !aborted) {
            return false;
        }
        this.frame.deferredCallbacks.push({ committed, aborted });
        return true;
    }

    /**
     * 현재 frame command를 정확히 한 번 finish/submit하고 canvas signal을 보냅니다.
     * @returns {boolean} logical commit 성공 여부입니다.
     */
    commit() {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            if (this.status === WEBGPU_FRAME_COMPOSER_STATUS.COMMITTED) {
                this.diagnostics.duplicateCommitCount += 1;
            } else {
                this.diagnostics.invalidTransitionCount += 1;
            }
            return false;
        }

        const frame = this.frame;
        if (!frame.encoder) {
            this.diagnostics.noWorkCommits += 1;
            this.#completeFrame(frame, false);
            return true;
        }
        if (!this.#validateCurrentFrame('pre-finish-drift')) {
            return false;
        }
        this.#encodeGpuTimestampEnd(frame);

        let commandBuffer;
        try {
            commandBuffer = frame.encoder.finish();
        } catch (error) {
            return this.#abortActiveFrame('encoder-finish-failed', error, 'encode');
        }
        if (!this.#validateCurrentFrame('pre-submit-drift')) {
            return false;
        }
        try {
            frame.device.queue.submit([commandBuffer]);
            this.diagnostics.submitCount += 1;
        } catch (error) {
            return this.#abortActiveFrame('queue-submit-failed', error, 'submit');
        }

        this.#scheduleGpuTimestampReadback(frame);
        this.#completeFrame(frame, true);
        return true;
    }

    /**
     * 현재 frame의 미제출 command를 폐기합니다.
     * @param {string} [reason] - 진단용 폐기 이유입니다.
     * @returns {boolean} active frame을 폐기했으면 true입니다.
     */
    abort(reason = 'explicit-abort') {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }
        this.#abortActiveFrame(reason, null, null);
        return true;
    }

    /**
     * active frame과 composer-owned timestamp 자원을 idempotent하게 폐기합니다.
     * 이미 시작된 mapAsync completion은 lifecycle generation과 slot token으로 무효화합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.diagnostics.destroyCount += 1;
        if (this.status === WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE && this.frame) {
            this.#abortActiveFrame('composer-destroyed', null, null);
        } else {
            this.frame = null;
        }

        const telemetry = this.gpuTelemetry;
        telemetry.enabled = false;
        telemetry.lifecycleGeneration += 1;
        telemetry.status = 'destroyed';
        telemetry.reason = 'composer-destroyed';
        telemetry.faultDeviceGeneration = null;
        telemetry.nextSlotIndex = 0;
        this.#detachGpuTelemetryDeviceObserver();
        for (const slot of telemetry.slots) {
            this.#destroyGpuTelemetrySlotResources(slot);
            slot.state = 'destroyed';
        }
        telemetry.samples.length = 0;
        telemetry.lastSample = null;
        telemetry.uncapturedErrorMessages.length = 0;
        this.platformPort = null;
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.DESTROYED;
    }

    /**
     * 직렬화 가능하고 깊이 동결된 현재 진단 snapshot을 반환합니다.
     * @returns {object} composer 진단 snapshot입니다.
     */
    getDiagnostics() {
        const activeFrame = this.frame
            ? Object.freeze({
                frameId: this.frame.frameId,
                acquired: this.frame.encoder !== null,
                deviceGeneration: this.frame.deviceGeneration,
                format: this.frame.format,
                contributionCount: this.frame.contributionCount,
                canvasWriteCount: this.frame.canvasWriteCount,
                drawIntent: this.frame.drawIntent,
                clearIntent: this.frame.clearIntent,
                deferredCallbackCount: this.frame.deferredCallbacks.length,
                gpuTimestampActive: this.frame.gpuTimestampSlot !== null
            })
            : null;
        return Object.freeze({
            status: this.status,
            frameId: this.lastFrameId,
            activeFrame,
            counters: Object.freeze({ ...this.diagnostics }),
            lastFailure: this.lastFailure
                ? Object.freeze({ ...this.lastFailure })
                : null,
            lastCallbackFailure: this.lastCallbackFailure
                ? Object.freeze({ ...this.lastCallbackFailure })
                : null,
            gpuTelemetry: this.getGpuTelemetrySnapshot()
        });
    }

    /**
     * 첫 contribution에서만 platform target과 command encoder를 획득합니다.
     * @returns {object|null} active frame 또는 실패 시 null입니다.
     * @private
     */
    #ensureFrameResources() {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            this.diagnostics.invalidTransitionCount += 1;
            return null;
        }
        if (this.frame.encoder) {
            return this.#validateCurrentFrame('pre-contribution-drift')
                ? this.frame
                : null;
        }

        const frame = this.frame;
        try {
            const initialState = this.platformPort.getState();
            const device = this.platformPort.getDevice();
            const target = this.platformPort.acquireFrameTarget();
            const acquiredState = this.platformPort.getState();
            const acquiredDevice = this.platformPort.getDevice();
            if (!target
                || initialState?.ready !== true
                || acquiredState?.ready !== true
                || !device
                || acquiredDevice !== device
                || target.device !== device
                || acquiredState.deviceGeneration !== initialState.deviceGeneration
                || target.deviceGeneration !== initialState.deviceGeneration
                || acquiredState.format !== initialState.format
                || target.format !== initialState.format
                || acquiredState.width !== initialState.width
                || acquiredState.height !== initialState.height
                || target.width !== initialState.width
                || target.height !== initialState.height) {
                this.#abortActiveFrame('frame-target-acquire-drift', null, 'drift');
                return null;
            }
            const encoder = device.createCommandEncoder({
                label: `display-webgpu-frame-encoder:${frame.frameId}`
            });
            frame.state = initialState;
            frame.device = device;
            frame.deviceGeneration = initialState.deviceGeneration;
            frame.target = target;
            frame.format = initialState.format;
            frame.width = target.width;
            frame.height = target.height;
            frame.encoder = encoder;
            frame.context = Object.freeze({
                frameId: frame.frameId,
                device,
                deviceGeneration: frame.deviceGeneration,
                encoder,
                target,
                format: frame.format,
                width: frame.width,
                height: frame.height
            });
            this.diagnostics.acquireCount += 1;
            this.diagnostics.encoderCount += 1;
            this.#encodeGpuTimestampBegin(frame);
            return frame;
        } catch (error) {
            this.diagnostics.acquireFailureCount += 1;
            this.#abortActiveFrame('frame-target-acquire-failed', error, null);
            return null;
        }
    }

    /**
     * 첫 contribution 직전에 timestamp begin과 generation 전용 readback slot을 준비합니다.
     * 계측 실패는 presentation command를 중단시키지 않고 telemetry만 fail-closed합니다.
     * @param {object} frame - acquired composer frame입니다.
     * @returns {void}
     * @private
     */
    #encodeGpuTimestampBegin(frame) {
        const telemetry = this.gpuTelemetry;
        if (!telemetry.enabled) {
            return;
        }
        if (telemetry.status === 'faulted'
            && telemetry.faultDeviceGeneration === frame.deviceGeneration) {
            return;
        }
        if (!hasWebGpuFeature(frame.state?.features, TIMESTAMP_QUERY_FEATURE)) {
            telemetry.status = 'unsupported';
            telemetry.supported = false;
            telemetry.reason = 'timestamp-query-unavailable';
            telemetry.faultDeviceGeneration = null;
            return;
        }
        this.#observeGpuTelemetryDevice(frame.device, frame.deviceGeneration);
        if (typeof frame.device?.createQuerySet !== 'function'
            || typeof frame.device?.createBuffer !== 'function'
            || typeof frame.encoder?.beginComputePass !== 'function'
            || typeof frame.encoder?.resolveQuerySet !== 'function'
            || typeof frame.encoder?.copyBufferToBuffer !== 'function') {
            this.#faultGpuTelemetry(
                frame.deviceGeneration,
                'timestamp-api-unavailable',
                null,
                'api'
            );
            return;
        }

        const slot = this.#acquireGpuTelemetrySlot(frame);
        if (!slot) {
            telemetry.diagnostics.droppedSlotCount += 1;
            return;
        }
        try {
            const timestampPass = frame.encoder.beginComputePass({
                label: `display-webgpu-frame-timestamp-begin:${frame.frameId}`,
                timestampWrites: {
                    querySet: slot.querySet,
                    beginningOfPassWriteIndex: 0
                }
            });
            timestampPass.end();
            slot.state = 'encoding';
            slot.frameId = frame.frameId;
            frame.gpuTimestampSlot = slot;
            telemetry.status = 'active';
            telemetry.supported = true;
            telemetry.reason = null;
            telemetry.faultDeviceGeneration = null;
            telemetry.diagnostics.scopeBeginCount += 1;
        } catch (error) {
            slot.state = 'faulted';
            slot.frameId = null;
            frame.gpuTimestampSlot = null;
            this.#faultGpuTelemetry(
                frame.deviceGeneration,
                'timestamp-begin-failed',
                error,
                'api'
            );
        }
    }

    /**
     * frame의 모든 contribution 뒤 timestamp end/resolve/copy를 같은 encoder에 기록합니다.
     * @param {object} frame - finish 직전 composer frame입니다.
     * @returns {void}
     * @private
     */
    #encodeGpuTimestampEnd(frame) {
        const slot = frame.gpuTimestampSlot;
        if (!slot || slot.state !== 'encoding') {
            return;
        }
        try {
            const timestampPass = frame.encoder.beginComputePass({
                label: `display-webgpu-frame-timestamp-end:${frame.frameId}`,
                timestampWrites: {
                    querySet: slot.querySet,
                    endOfPassWriteIndex: 1
                }
            });
            timestampPass.end();
            frame.encoder.resolveQuerySet(
                slot.querySet,
                0,
                TIMESTAMP_QUERY_COUNT,
                slot.resolveBuffer,
                0
            );
            frame.encoder.copyBufferToBuffer(
                slot.resolveBuffer,
                0,
                slot.readBuffer,
                0,
                TIMESTAMP_RESULT_BYTE_LENGTH
            );
            slot.state = 'encoded';
            this.gpuTelemetry.diagnostics.scopeEndCount += 1;
        } catch (error) {
            slot.state = 'faulted';
            slot.frameId = null;
            frame.gpuTimestampSlot = null;
            this.#faultGpuTelemetry(
                frame.deviceGeneration,
                'timestamp-end-resolve-failed',
                error,
                'api'
            );
        }
    }

    /**
     * 성공한 queue submit 뒤 readback map을 비동기로 시작합니다.
     * @param {object} frame - 제출된 composer frame입니다.
     * @returns {void}
     * @private
     */
    #scheduleGpuTimestampReadback(frame) {
        const slot = frame.gpuTimestampSlot;
        frame.gpuTimestampSlot = null;
        if (!slot || slot.state !== 'encoded') {
            return;
        }
        slot.state = 'pending';
        slot.token += 1;
        const token = slot.token;
        const lifecycleGeneration = this.gpuTelemetry.lifecycleGeneration;
        this.gpuTelemetry.diagnostics.timestampSubmitCount += 1;

        let mapPromise;
        try {
            mapPromise = slot.readBuffer.mapAsync(
                MAP_MODE_READ,
                0,
                TIMESTAMP_RESULT_BYTE_LENGTH
            );
        } catch (error) {
            this.#handleGpuTimestampMapFailure(
                slot,
                token,
                lifecycleGeneration,
                error
            );
            return;
        }
        Promise.resolve(mapPromise).then(
            () => this.#consumeGpuTimestamp(slot, token, lifecycleGeneration),
            (error) => this.#handleGpuTimestampMapFailure(
                slot,
                token,
                lifecycleGeneration,
                error
            )
        );
    }

    /** @private */
    #acquireGpuTelemetrySlot(frame) {
        const telemetry = this.gpuTelemetry;
        const slotCount = telemetry.slots.length;
        for (let offset = 0; offset < slotCount; offset += 1) {
            const slotIndex = (telemetry.nextSlotIndex + offset) % slotCount;
            const slot = telemetry.slots[slotIndex];
            const recoverableFault = slot.state === 'faulted'
                && slot.deviceGeneration !== frame.deviceGeneration;
            if (slot.state !== 'idle' && !recoverableFault) {
                continue;
            }
            telemetry.nextSlotIndex = (slotIndex + 1) % slotCount;
            if (slot.device !== frame.device
                || slot.deviceGeneration !== frame.deviceGeneration
                || !slot.querySet
                || !slot.resolveBuffer
                || !slot.readBuffer) {
                this.#destroyGpuTelemetrySlotResources(slot);
                try {
                    slot.querySet = frame.device.createQuerySet({
                        label: `display-webgpu-frame-timestamp-query:${slot.index}`,
                        type: 'timestamp',
                        count: TIMESTAMP_QUERY_COUNT
                    });
                    slot.resolveBuffer = frame.device.createBuffer({
                        label: `display-webgpu-frame-timestamp-resolve:${slot.index}`,
                        size: TIMESTAMP_RESULT_BYTE_LENGTH,
                        usage: BUFFER_USAGE_QUERY_RESOLVE | BUFFER_USAGE_COPY_SRC
                    });
                    slot.readBuffer = frame.device.createBuffer({
                        label: `display-webgpu-frame-timestamp-read:${slot.index}`,
                        size: TIMESTAMP_RESULT_BYTE_LENGTH,
                        usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ
                    });
                    slot.device = frame.device;
                    slot.deviceGeneration = frame.deviceGeneration;
                    telemetry.diagnostics.resourceCreateCount += 1;
                } catch (error) {
                    this.#destroyGpuTelemetrySlotResources(slot);
                    slot.state = 'faulted';
                    slot.deviceGeneration = frame.deviceGeneration;
                    this.#faultGpuTelemetry(
                        frame.deviceGeneration,
                        'timestamp-resource-create-failed',
                        error,
                        'api'
                    );
                    return null;
                }
            }
            slot.state = 'idle';
            slot.frameId = null;
            return slot;
        }
        return null;
    }

    /** @private */
    #consumeGpuTimestamp(slot, token, lifecycleGeneration) {
        if (this.destroyed
            || this.gpuTelemetry.lifecycleGeneration !== lifecycleGeneration
            || slot.token !== token
            || slot.state !== 'pending') {
            return;
        }
        let startTimestamp;
        let endTimestamp;
        try {
            const range = slot.readBuffer.getMappedRange(0, TIMESTAMP_RESULT_BYTE_LENGTH);
            if (!range || range.byteLength < TIMESTAMP_RESULT_BYTE_LENGTH) {
                throw new Error('timestamp readback byte length가 부족합니다.');
            }
            const timestamps = new BigUint64Array(range, 0, TIMESTAMP_QUERY_COUNT);
            startTimestamp = timestamps[0];
            endTimestamp = timestamps[1];
            slot.readBuffer.unmap();
        } catch (error) {
            try {
                slot.readBuffer?.unmap?.();
            } catch {
                // 실패한 map의 unmap은 best-effort입니다.
            }
            this.#handleGpuTimestampMapFailure(
                slot,
                token,
                lifecycleGeneration,
                error
            );
            return;
        }

        if (typeof startTimestamp !== 'bigint'
            || typeof endTimestamp !== 'bigint'
            || endTimestamp < startTimestamp) {
            this.gpuTelemetry.diagnostics.invalidTimestampCount += 1;
            slot.state = 'idle';
            slot.frameId = null;
            return;
        }
        const gpuMs = Number(endTimestamp - startTimestamp) * TIMESTAMP_TO_MILLISECONDS;
        if (!Number.isFinite(gpuMs) || gpuMs < 0) {
            this.gpuTelemetry.diagnostics.invalidTimestampCount += 1;
            slot.state = 'idle';
            slot.frameId = null;
            return;
        }

        const sample = Object.freeze({
            source: 'webgpu-frame-composer',
            scope: WEBGPU_FRAME_GPU_TELEMETRY_SCOPE,
            deviceGeneration: slot.deviceGeneration,
            frameId: slot.frameId,
            gpuMs
        });
        const telemetry = this.gpuTelemetry;
        telemetry.lastSample = sample;
        telemetry.diagnostics.sampleCount += 1;
        if (telemetry.samples.length < GPU_TELEMETRY_SAMPLE_CAPACITY) {
            telemetry.samples.push(sample);
        } else {
            telemetry.diagnostics.bufferedSampleDropCount += 1;
        }
        slot.state = 'idle';
        slot.frameId = null;
    }

    /** @private */
    #handleGpuTimestampMapFailure(slot, token, lifecycleGeneration, error) {
        if (this.destroyed
            || this.gpuTelemetry.lifecycleGeneration !== lifecycleGeneration
            || slot.token !== token
            || slot.state !== 'pending') {
            return;
        }
        try {
            slot.readBuffer?.unmap?.();
        } catch {
            // reject된 map의 unmap은 best-effort입니다.
        }
        slot.state = 'faulted';
        slot.frameId = null;
        this.#faultGpuTelemetry(
            slot.deviceGeneration,
            'timestamp-map-failed',
            error,
            'map'
        );
    }

    /** @private */
    #releaseUnsubmittedGpuTimestamp(frame) {
        const slot = frame?.gpuTimestampSlot;
        if (!slot) {
            return;
        }
        frame.gpuTimestampSlot = null;
        if (slot.state === 'encoding' || slot.state === 'encoded') {
            slot.state = 'idle';
            slot.frameId = null;
        }
    }

    /** @private */
    #destroyGpuTelemetrySlotResources(slot) {
        const mapWasPending = slot.state === 'pending';
        slot.token += 1;
        if (mapWasPending) {
            try {
                slot.readBuffer?.unmap?.();
            } catch {
                // pending map 취소 실패와 무관하게 token invalidation이 정합성을 보장합니다.
            }
        }
        let destroyed = false;
        for (const resource of [slot.querySet, slot.resolveBuffer, slot.readBuffer]) {
            if (!resource) {
                continue;
            }
            destroyed = true;
            try {
                resource.destroy?.();
            } catch {
                // stale generation 진단 자원 정리는 best-effort입니다.
            }
        }
        if (destroyed) {
            this.gpuTelemetry.diagnostics.resourceDestroyCount += 1;
        }
        slot.querySet = null;
        slot.resolveBuffer = null;
        slot.readBuffer = null;
        slot.device = null;
        slot.deviceGeneration = null;
        slot.frameId = null;
    }

    /** @private */
    #faultGpuTelemetry(deviceGeneration, reason, error, kind) {
        if (this.destroyed) {
            return;
        }
        const telemetry = this.gpuTelemetry;
        telemetry.status = 'faulted';
        telemetry.supported = false;
        telemetry.reason = error
            ? `${reason}:${formatErrorMessage(error)}`
            : reason;
        telemetry.faultDeviceGeneration = deviceGeneration;
        if (kind === 'map') {
            telemetry.diagnostics.mapFailureCount += 1;
        } else {
            telemetry.diagnostics.apiFailureCount += 1;
        }
    }

    /** @private */
    #observeGpuTelemetryDevice(device, deviceGeneration) {
        const telemetry = this.gpuTelemetry;
        if (telemetry.observedDevice === device
            && telemetry.observedDeviceGeneration === deviceGeneration) {
            return;
        }
        this.#detachGpuTelemetryDeviceObserver();
        const listener = (event) => {
            if (this.destroyed
                || telemetry.observedDevice !== device
                || telemetry.observedDeviceGeneration !== deviceGeneration) {
                return;
            }
            telemetry.diagnostics.uncapturedErrorCount += 1;
            if (telemetry.uncapturedErrorMessages.length < 32) {
                telemetry.uncapturedErrorMessages.push(
                    formatErrorMessage(event?.error ?? event)
                );
            }
        };
        telemetry.observedDevice = device;
        telemetry.observedDeviceGeneration = deviceGeneration;
        telemetry.uncapturedErrorListener = listener;
        try {
            device.addEventListener?.('uncapturederror', listener);
        } catch {
            // listener 미지원은 timestamp query 자체의 지원 여부를 바꾸지 않습니다.
        }
    }

    /** @private */
    #detachGpuTelemetryDeviceObserver() {
        const telemetry = this.gpuTelemetry;
        if (telemetry.observedDevice && telemetry.uncapturedErrorListener) {
            try {
                telemetry.observedDevice.removeEventListener?.(
                    'uncapturederror',
                    telemetry.uncapturedErrorListener
                );
            } catch {
                // stale device listener 정리는 best-effort입니다.
            }
        }
        telemetry.observedDevice = null;
        telemetry.observedDeviceGeneration = null;
        telemetry.uncapturedErrorListener = null;
    }

    /**
     * acquired frame이 현재 platform generation/device/format과 같은지 확인합니다.
     * @param {string} reason - drift 실패 이유입니다.
     * @returns {boolean} frame이 여전히 제출 가능하면 true입니다.
     * @private
     */
    #validateCurrentFrame(reason) {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            return false;
        }
        const frame = this.frame;
        try {
            const state = this.platformPort.getState();
            const device = this.platformPort.getDevice();
            if (state?.ready !== true
                || device !== frame.device
                || state.deviceGeneration !== frame.deviceGeneration
                || state.format !== frame.format
                || state.width !== frame.width
                || state.height !== frame.height) {
                this.#abortActiveFrame(reason, null, 'drift');
                return false;
            }
            return true;
        } catch (error) {
            this.#abortActiveFrame(reason, error, 'drift');
            return false;
        }
    }

    /**
     * callback 실행 중 encoding 실패를 active frame 폐기로 변환합니다.
     * @param {string} reason - 실패 이유입니다.
     * @param {unknown} error - 원본 오류입니다.
     * @returns {false} 항상 false입니다.
     * @private
     */
    #failEncoding(reason, error) {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            this.diagnostics.invalidTransitionCount += 1;
            return false;
        }
        this.#abortActiveFrame(reason, error, 'encode');
        return false;
    }

    /**
     * submit 성공 또는 no-work commit을 완료하고 callback/signal을 한 번 처리합니다.
     * @param {object} frame - 완료할 내부 frame입니다.
     * @param {boolean} submitted - 실제 queue submit 여부입니다.
     * @returns {void}
     * @private
     */
    #completeFrame(frame, submitted) {
        if (!submitted) {
            this.#releaseUnsubmittedGpuTimestamp(frame);
        }
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.COMMITTED;
        this.frame = null;
        this.diagnostics.framesCommitted += 1;

        if (submitted && frame.drawIntent) {
            this.#signalCanvas('drawn');
        } else if (submitted && frame.clearIntent) {
            this.#signalCanvas('cleared');
        }
        this.#invokeDeferredCallbacks(frame, 'committed', {
            frameId: frame.frameId,
            submitted,
            reason: null
        });
    }

    /**
     * active frame을 submit/mark 없이 폐기합니다.
     * @param {string} reason - 폐기 이유입니다.
     * @param {unknown} error - 원본 오류입니다.
     * @param {'encode'|'submit'|'drift'|null} failureKind - 진단 counter 종류입니다.
     * @returns {false} 호출부의 실패 반환을 위한 false입니다.
     * @private
     */
    #abortActiveFrame(reason, error, failureKind) {
        if (this.status !== WEBGPU_FRAME_COMPOSER_STATUS.ACTIVE || !this.frame) {
            return false;
        }
        const frame = this.frame;
        this.#releaseUnsubmittedGpuTimestamp(frame);
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.ABORTED;
        this.frame = null;
        this.diagnostics.framesAborted += 1;
        if (failureKind === 'encode') this.diagnostics.encodeFailureCount += 1;
        if (failureKind === 'submit') this.diagnostics.submitFailureCount += 1;
        if (failureKind === 'drift') this.diagnostics.driftFailureCount += 1;
        this.lastFailure = {
            frameId: frame.frameId,
            reason,
            message: error ? formatErrorMessage(error) : null
        };
        this.#invokeDeferredCallbacks(frame, 'aborted', {
            frameId: frame.frameId,
            submitted: false,
            reason
        });
        return false;
    }

    /**
     * canvas draw/clear signal을 submit 뒤 best-effort로 전송합니다.
     * @param {'drawn'|'cleared'} signal - 전송할 signal입니다.
     * @returns {void}
     * @private
     */
    #signalCanvas(signal) {
        try {
            if (signal === 'drawn') {
                this.platformPort.markCanvasDrawn();
                this.diagnostics.canvasDrawnMarkCount += 1;
            } else {
                this.platformPort.markCanvasCleared();
                this.diagnostics.canvasClearedMarkCount += 1;
            }
        } catch (error) {
            this.diagnostics.signalFailureCount += 1;
            this.lastFailure = {
                frameId: this.lastFrameId,
                reason: `canvas-${signal}-signal-failed`,
                message: formatErrorMessage(error)
            };
        }
    }

    /**
     * 등록된 한쪽 deferred callback을 순서대로 정확히 한 번 호출합니다.
     * callback 오류는 frame 상태를 변경하지 않고 별도 진단으로만 기록합니다.
     * @param {object} frame - callback을 소유한 frame입니다.
     * @param {'committed'|'aborted'} callbackName - 호출할 callback 이름입니다.
     * @param {object} event - immutable callback event입니다.
     * @returns {void}
     * @private
     */
    #invokeDeferredCallbacks(frame, callbackName, event) {
        const frozenEvent = Object.freeze({ ...event });
        for (const callbacks of frame.deferredCallbacks) {
            const callback = callbacks[callbackName];
            if (!callback) {
                continue;
            }
            try {
                callback(frozenEvent);
            } catch (error) {
                this.diagnostics.callbackFailureCount += 1;
                this.lastCallbackFailure = {
                    frameId: frame.frameId,
                    callback: callbackName,
                    message: formatErrorMessage(error)
                };
            }
        }
        frame.deferredCallbacks.length = 0;
    }
}
