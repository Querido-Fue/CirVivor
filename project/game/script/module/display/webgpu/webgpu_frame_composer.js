/**
 * WebGPU frame composer의 외부 상태입니다.
 */
export const WEBGPU_FRAME_COMPOSER_STATUS = Object.freeze({
    IDLE: 'idle',
    ACTIVE: 'active',
    COMMITTED: 'committed',
    ABORTED: 'aborted'
});

const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
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
        callbackFailureCount: 0
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
        this.status = WEBGPU_FRAME_COMPOSER_STATUS.IDLE;
        this.lastFrameId = null;
        this.frame = null;
        this.diagnostics = createDiagnostics();
        this.lastFailure = null;
        this.lastCallbackFailure = null;

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
    }

    /**
     * contributor가 공유할 안정적이고 immutable한 port를 반환합니다.
     * @returns {object} frame contribution port입니다.
     */
    getPort() {
        return this.contributorPort;
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
            deferredCallbacks: []
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
                deferredCallbackCount: this.frame.deferredCallbacks.length
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
                : null
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
            return frame;
        } catch (error) {
            this.diagnostics.acquireFailureCount += 1;
            this.#abortActiveFrame('frame-target-acquire-failed', error, null);
            return null;
        }
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
