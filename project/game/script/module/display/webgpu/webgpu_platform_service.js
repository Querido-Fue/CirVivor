/**
 * WebGPU 플랫폼 준비 상태입니다.
 */
export const WEBGPU_PLATFORM_STATUS = Object.freeze({
    IDLE: 'idle',
    PROBING: 'probing',
    READY: 'ready',
    UNSUPPORTED: 'unsupported',
    LOST: 'lost',
    DESTROYED: 'destroyed'
});

const WEBGPU_LIMIT_KEYS = Object.freeze([
    'maxBufferSize',
    'maxStorageBufferBindingSize',
    'maxStorageBuffersPerShaderStage',
    'maxStorageTexturesPerShaderStage',
    'maxBindGroups',
    'maxBindingsPerBindGroup',
    'maxComputeWorkgroupSizeX',
    'maxComputeInvocationsPerWorkgroup',
    'maxComputeWorkgroupsPerDimension',
    'maxComputeWorkgroupStorageSize',
    'maxTextureDimension2D',
    'minStorageBufferOffsetAlignment',
    'minUniformBufferOffsetAlignment'
]);
const TRANSPARENT_CLEAR_VALUE = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });

/**
 * DisplaySystem 수명의 WebGPU adapter/device와 투명 canvas context를 관리합니다.
 */
export class WebGpuPlatformService {
    /**
     * @param {object} options - 플랫폼 생성 옵션입니다.
     * @param {HTMLCanvasElement|null} options.canvas - WebGPU 전용 캔버스입니다.
     * @param {Navigator|null} [options.navigatorObject] - capability probe에 사용할 navigator입니다.
     * @param {boolean} [options.secureContext] - secure context 여부입니다.
     * @param {Function} [options.onStateChange] - 플랫폼 상태 변경 callback입니다.
     * @param {Function} [options.onCanvasDrawn] - 인자 없는 canvas draw 완료 callback입니다.
     * @param {Function} [options.onCanvasCleared] - 인자 없는 투명 clear 완료 callback입니다.
     */
    constructor(options = {}) {
        this.canvas = options.canvas ?? null;
        this.navigatorObject = options.navigatorObject === undefined
            ? (globalThis.navigator ?? null)
            : options.navigatorObject;
        this.secureContext = options.secureContext === undefined
            ? globalThis.isSecureContext === true
            : options.secureContext === true;
        this.onStateChange = typeof options.onStateChange === 'function'
            ? options.onStateChange
            : null;
        this.onCanvasDrawn = typeof options.onCanvasDrawn === 'function'
            ? options.onCanvasDrawn
            : null;
        this.onCanvasCleared = typeof options.onCanvasCleared === 'function'
            ? options.onCanvasCleared
            : null;

        this.status = WEBGPU_PLATFORM_STATUS.IDLE;
        this.reason = 'not-initialized';
        this.adapter = null;
        this.device = null;
        this.context = null;
        this.format = null;
        this.limits = Object.freeze({});
        this.features = Object.freeze([]);
        this.adapterInfo = null;
        this.deviceGeneration = 0;
        this.lostInfo = null;
        this.configuredWidth = 0;
        this.configuredHeight = 0;
        this.initPromise = null;
        this.probeSerial = 0;
        this.recoveryScheduled = false;
        this.destroyed = false;
        this.stateListeners = new Set();

        const service = this;
        this.port = Object.freeze({
            getState() {
                return service.getState();
            },
            getDevice() {
                return service.getDevice();
            },
            getCanvasContext() {
                return service.getCanvasContext();
            },
            getCanvasFormat() {
                return service.getCanvasFormat();
            },
            getDeviceGeneration() {
                return service.deviceGeneration;
            },
            acquireFrameTarget() {
                return service.acquireFrameTarget();
            },
            clearCanvas(clearValue) {
                return service.clearCanvas(clearValue);
            },
            markCanvasDrawn() {
                return service.markCanvasDrawn();
            },
            markCanvasCleared() {
                return service.markCanvasCleared();
            },
            subscribe(listener) {
                return service.subscribe(listener);
            }
        });
    }

    /**
     * WebGPU capability를 non-fatal 방식으로 확인하고 canvas context를 구성합니다.
     * unsupported 환경이나 probe 오류도 reject하지 않고 상태 snapshot으로 반환합니다.
     * @returns {Promise<object>} 최종 플랫폼 상태입니다.
     */
    init() {
        if (this.destroyed || this.status === WEBGPU_PLATFORM_STATUS.READY
            || this.status === WEBGPU_PLATFORM_STATUS.UNSUPPORTED) {
            return Promise.resolve(this.getState());
        }
        if (this.initPromise) {
            return this.initPromise;
        }

        const probeSerial = ++this.probeSerial;
        const initPromise = this.#probe(probeSerial)
            .catch((error) => {
                if (!this.destroyed && probeSerial === this.probeSerial) {
                    this.#setUnsupported('probe-failed', error);
                }
                return this.getState();
            })
            .finally(() => {
                if (this.initPromise === initPromise) {
                    this.initPromise = null;
                }
            });
        this.initPromise = initPromise;
        return initPromise;
    }

    /**
     * 현재 device를 폐기하고 capability probe를 다시 수행합니다.
     * @returns {Promise<object>} 재초기화 뒤 플랫폼 상태입니다.
     */
    reinitialize() {
        if (this.destroyed) {
            return Promise.resolve(this.getState());
        }

        this.#releaseCurrentDevice(true);
        this.status = WEBGPU_PLATFORM_STATUS.IDLE;
        this.reason = 'reinitializing';
        this.lostInfo = null;
        this.initPromise = null;
        return this.init();
    }

    /**
     * 세션에 주입할 제한된 WebGPU 플랫폼 port를 반환합니다.
     * @returns {object} 안정적인 플랫폼 port입니다.
     */
    getPort() {
        return this.port;
    }

    /**
     * 외부에서 직렬화 가능한 현재 플랫폼 상태를 반환합니다.
     * @returns {object} immutable 상태 snapshot입니다.
     */
    getState() {
        return Object.freeze({
            status: this.status,
            reason: this.reason,
            ready: this.status === WEBGPU_PLATFORM_STATUS.READY,
            secureContext: this.secureContext,
            deviceGeneration: this.deviceGeneration,
            format: this.format,
            limits: Object.freeze({ ...this.limits }),
            features: Object.freeze([...this.features]),
            adapterInfo: this.adapterInfo
                ? Object.freeze({ ...this.adapterInfo })
                : null,
            lostInfo: this.lostInfo
                ? Object.freeze({ ...this.lostInfo })
                : null,
            width: this.canvas?.width ?? 0,
            height: this.canvas?.height ?? 0
        });
    }

    /**
     * 준비된 device를 반환합니다.
     * @returns {GPUDevice|null} READY 상태의 device입니다.
     */
    getDevice() {
        return this.status === WEBGPU_PLATFORM_STATUS.READY ? this.device : null;
    }

    /**
     * 준비된 WebGPU canvas context를 반환합니다.
     * @returns {GPUCanvasContext|null} READY 상태의 context입니다.
     */
    getCanvasContext() {
        return this.status === WEBGPU_PLATFORM_STATUS.READY ? this.context : null;
    }

    /**
     * 현재 canvas format을 반환합니다.
     * @returns {GPUTextureFormat|null} 구성된 canvas format입니다.
     */
    getCanvasFormat() {
        return this.status === WEBGPU_PLATFORM_STATUS.READY ? this.format : null;
    }

    /**
     * canvas backing 크기를 동기화하고 READY 상태라면 context를 재구성합니다.
     * @param {number} width - backing store 너비입니다.
     * @param {number} height - backing store 높이입니다.
     * @returns {boolean} backing 또는 context 구성이 바뀌었으면 true입니다.
     */
    resize(width, height) {
        if (this.destroyed || !this.canvas) {
            return false;
        }

        const nextWidth = Math.max(1, Math.floor(Number.isFinite(width) ? width : 1));
        const nextHeight = Math.max(1, Math.floor(Number.isFinite(height) ? height : 1));
        let changed = false;
        if (this.canvas.width !== nextWidth) {
            this.canvas.width = nextWidth;
            changed = true;
        }
        if (this.canvas.height !== nextHeight) {
            this.canvas.height = nextHeight;
            changed = true;
        }

        if (this.status !== WEBGPU_PLATFORM_STATUS.READY) {
            return changed;
        }
        if (!changed
            && this.configuredWidth === nextWidth
            && this.configuredHeight === nextHeight) {
            return false;
        }

        try {
            this.#configureCanvas(this.context, this.device, this.format);
            this.#notifyCanvasCleared();
            return true;
        } catch (error) {
            this.#handleRuntimeFailure('canvas-reconfigure-failed', error);
            return false;
        }
    }

    /**
     * 현재 프레임의 texture와 view를 획득합니다.
     * 호출자는 동일 프레임의 compute/render command를 제출한 뒤 `markCanvasDrawn()`을 호출합니다.
     * @returns {{device:GPUDevice, context:GPUCanvasContext, texture:GPUTexture, view:GPUTextureView, format:GPUTextureFormat, deviceGeneration:number, width:number, height:number}|null} 프레임 target입니다.
     */
    acquireFrameTarget() {
        if (this.status !== WEBGPU_PLATFORM_STATUS.READY
            || !this.device || !this.context || !this.format) {
            return null;
        }

        try {
            const texture = this.context.getCurrentTexture();
            const view = texture.createView();
            return {
                device: this.device,
                context: this.context,
                texture,
                view,
                format: this.format,
                deviceGeneration: this.deviceGeneration,
                width: this.canvas?.width ?? 0,
                height: this.canvas?.height ?? 0
            };
        } catch (error) {
            this.#handleRuntimeFailure('canvas-texture-acquire-failed', error);
            return null;
        }
    }

    /**
     * 전용 canvas를 한 번의 render pass로 초기화합니다.
     * @param {{r:number,g:number,b:number,a:number}} [clearValue] - clear 색상입니다.
     * @returns {boolean} command 제출 여부입니다.
     */
    clearCanvas(clearValue = TRANSPARENT_CLEAR_VALUE) {
        const target = this.acquireFrameTarget();
        if (!target) {
            return false;
        }

        try {
            const encoder = target.device.createCommandEncoder({
                label: 'display-webgpu-clear-encoder'
            });
            const pass = encoder.beginRenderPass({
                label: 'display-webgpu-clear-pass',
                colorAttachments: [{
                    view: target.view,
                    clearValue,
                    loadOp: 'clear',
                    storeOp: 'store'
                }]
            });
            pass.end();
            target.device.queue.submit([encoder.finish()]);
            this.#notifyCanvasCleared();
            return true;
        } catch (error) {
            this.#handleRuntimeFailure('canvas-clear-failed', error);
            return false;
        }
    }

    /**
     * 세션 renderer가 canvas draw command를 제출했음을 DisplaySystem에 알립니다.
     * @returns {boolean} READY 상태에서 통지했으면 true입니다.
     */
    markCanvasDrawn() {
        if (this.status !== WEBGPU_PLATFORM_STATUS.READY) {
            return false;
        }
        // GPU draw pass는 투명 clear와 instance draw를 한 pass에서 수행합니다.
        // Display surface의 frame draw counter를 먼저 재무장한 뒤 draw를 기록합니다.
        this.#notifyCanvasCleared();
        this.#invokeSignal(this.onCanvasDrawn);
        return true;
    }

    /**
     * 세션 renderer가 canvas를 투명 clear했음을 DisplaySystem에 알립니다.
     * @returns {boolean} READY 상태에서 통지했으면 true입니다.
     */
    markCanvasCleared() {
        if (this.status !== WEBGPU_PLATFORM_STATUS.READY) {
            return false;
        }
        this.#notifyCanvasCleared();
        return true;
    }

    /**
     * 플랫폼 상태 변경을 구독합니다.
     * @param {Function} listener - 상태 snapshot을 받을 callback입니다.
     * @returns {Function} 구독 해제 함수입니다.
     */
    subscribe(listener) {
        if (typeof listener !== 'function') {
            return () => {};
        }
        this.stateListeners.add(listener);
        this.#invokeObserver(listener, this.getState());
        return () => {
            this.stateListeners.delete(listener);
        };
    }

    /**
     * canvas 구성과 device를 idempotent하게 폐기합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.probeSerial += 1;
        this.recoveryScheduled = false;
        this.initPromise = null;
        this.#releaseCurrentDevice(true);
        this.context = null;
        this.format = null;
        this.status = WEBGPU_PLATFORM_STATUS.DESTROYED;
        this.reason = 'destroyed';
        this.lostInfo = null;
        this.#notifyCanvasCleared();
        this.#notifyStateChange();
        this.stateListeners.clear();
        this.onStateChange = null;
        this.onCanvasDrawn = null;
        this.onCanvasCleared = null;
    }

    async #probe(probeSerial) {
        this.status = WEBGPU_PLATFORM_STATUS.PROBING;
        this.reason = null;
        this.#notifyStateChange();

        if (!this.secureContext) {
            return this.#setUnsupported('insecure-context');
        }
        const gpu = this.navigatorObject?.gpu;
        if (!gpu || typeof gpu.requestAdapter !== 'function') {
            return this.#setUnsupported('navigator-gpu-unavailable');
        }
        if (!this.canvas || typeof this.canvas.getContext !== 'function') {
            return this.#setUnsupported('canvas-unavailable');
        }

        let adapter;
        try {
            adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        } catch (error) {
            return this.#setUnsupported('adapter-request-failed', error);
        }
        if (!this.#isProbeCurrent(probeSerial)) {
            return this.getState();
        }
        if (!adapter) {
            return this.#setUnsupported('adapter-unavailable');
        }

        let device;
        try {
            device = await adapter.requestDevice();
        } catch (error) {
            return this.#setUnsupported('device-request-failed', error);
        }
        if (!this.#isProbeCurrent(probeSerial)) {
            device?.destroy?.();
            return this.getState();
        }

        let context;
        let format;
        try {
            context = this.canvas.getContext('webgpu');
            if (!context) {
                device.destroy?.();
                return this.#setUnsupported('canvas-webgpu-context-unavailable');
            }
            format = gpu.getPreferredCanvasFormat();
            if (!format) {
                device.destroy?.();
                return this.#setUnsupported('canvas-format-unavailable');
            }
            this.#configureCanvas(context, device, format);
        } catch (error) {
            device.destroy?.();
            return this.#setUnsupported('canvas-configure-failed', error);
        }
        if (!this.#isProbeCurrent(probeSerial)) {
            try {
                context.unconfigure?.();
            } catch {
                // 폐기 중인 probe의 context 정리는 best-effort입니다.
            }
            device.destroy?.();
            return this.getState();
        }

        let limits;
        let features;
        let adapterInfo;
        try {
            limits = Object.freeze(serializeWebGpuLimits(device.limits ?? adapter.limits));
            features = Object.freeze(serializeWebGpuFeatures(device.features ?? adapter.features));
            adapterInfo = serializeWebGpuAdapterInfo(adapter);
        } catch (error) {
            try {
                context.unconfigure?.();
            } catch {
                // 실패한 probe의 context 정리는 best-effort입니다.
            }
            device.destroy?.();
            return this.#setUnsupported('capability-read-failed', error);
        }

        this.adapter = adapter;
        this.device = device;
        this.context = context;
        this.format = format;
        this.limits = limits;
        this.features = features;
        this.adapterInfo = adapterInfo;
        this.deviceGeneration += 1;
        this.lostInfo = null;
        this.status = WEBGPU_PLATFORM_STATUS.READY;
        this.reason = null;
        this.#watchDeviceLoss(device, this.deviceGeneration);
        this.#notifyCanvasCleared();
        this.#notifyStateChange();
        return this.getState();
    }

    #configureCanvas(context, device, format) {
        context.configure({
            device,
            format,
            alphaMode: 'premultiplied'
        });
        this.configuredWidth = this.canvas?.width ?? 0;
        this.configuredHeight = this.canvas?.height ?? 0;
    }

    #watchDeviceLoss(device, generation) {
        Promise.resolve(device.lost).then(
            (info) => this.#handleDeviceLoss(device, generation, info),
            (error) => this.#handleDeviceLoss(device, generation, {
                reason: 'unknown',
                message: formatErrorMessage(error)
            })
        );
    }

    #handleDeviceLoss(device, generation, info) {
        if (this.destroyed || this.device !== device || this.deviceGeneration !== generation) {
            return;
        }

        try {
            this.context?.unconfigure?.();
        } catch {
            // 이미 잃은 context의 unconfigure는 best-effort입니다.
        }
        this.adapter = null;
        this.device = null;
        this.format = null;
        this.#resetCapabilities();
        this.configuredWidth = 0;
        this.configuredHeight = 0;
        this.lostInfo = {
            reason: info?.reason ?? 'unknown',
            message: info?.message ?? ''
        };
        this.status = WEBGPU_PLATFORM_STATUS.LOST;
        this.reason = `device-lost:${this.lostInfo.reason}`;
        this.#notifyCanvasCleared();
        this.#notifyStateChange();
        this.#scheduleRecovery();
    }

    #scheduleRecovery() {
        if (this.destroyed || this.recoveryScheduled) {
            return;
        }
        this.recoveryScheduled = true;
        Promise.resolve().then(() => {
            this.recoveryScheduled = false;
            if (this.destroyed || this.status !== WEBGPU_PLATFORM_STATUS.LOST) {
                return;
            }
            this.initPromise = null;
            void this.init();
        });
    }

    #handleRuntimeFailure(reason, error) {
        if (this.destroyed) {
            return;
        }
        this.#releaseCurrentDevice(true);
        this.status = WEBGPU_PLATFORM_STATUS.UNSUPPORTED;
        this.reason = `${reason}:${formatErrorMessage(error)}`;
        this.#notifyCanvasCleared();
        this.#notifyStateChange();
    }

    #releaseCurrentDevice(destroyDevice) {
        const device = this.device;
        this.device = null;
        this.adapter = null;
        this.format = null;
        this.#resetCapabilities();
        this.configuredWidth = 0;
        this.configuredHeight = 0;
        try {
            this.context?.unconfigure?.();
        } catch {
            // context 정리는 best-effort입니다.
        }
        if (destroyDevice) {
            try {
                device?.destroy?.();
            } catch {
                // device 정리는 best-effort입니다.
            }
        }
    }

    #setUnsupported(reason, error = null) {
        if (this.destroyed) {
            return this.getState();
        }
        this.status = WEBGPU_PLATFORM_STATUS.UNSUPPORTED;
        this.reason = error ? `${reason}:${formatErrorMessage(error)}` : reason;
        this.#resetCapabilities();
        this.#notifyStateChange();
        return this.getState();
    }

    #resetCapabilities() {
        this.limits = Object.freeze({});
        this.features = Object.freeze([]);
        this.adapterInfo = null;
    }

    #isProbeCurrent(probeSerial) {
        return !this.destroyed && probeSerial === this.probeSerial;
    }

    #notifyCanvasCleared() {
        this.#invokeSignal(this.onCanvasCleared);
    }

    #notifyStateChange() {
        const state = this.getState();
        this.#invokeObserver(this.onStateChange, state);
        for (const listener of this.stateListeners) {
            this.#invokeObserver(listener, state);
        }
    }

    #invokeObserver(observer, state) {
        if (typeof observer !== 'function') {
            return;
        }
        try {
            observer(state);
        } catch (error) {
            console.warn('WebGPU platform observer failed.', error);
        }
    }

    #invokeSignal(observer) {
        if (typeof observer !== 'function') {
            return;
        }
        try {
            observer();
        } catch (error) {
            console.warn('WebGPU platform observer failed.', error);
        }
    }
}

function serializeWebGpuLimits(limits) {
    if (!limits) {
        return {};
    }
    return Object.fromEntries(WEBGPU_LIMIT_KEYS.map((key) => [
        key,
        Number(limits[key] ?? 0)
    ]));
}

function serializeWebGpuFeatures(features) {
    if (!features) {
        return [];
    }
    try {
        return Array.from(features.values ? features.values() : features).sort();
    } catch {
        return [];
    }
}

function serializeWebGpuAdapterInfo(adapter) {
    const info = adapter?.info;
    if (!info) {
        return null;
    }
    return {
        vendor: info.vendor || '',
        architecture: info.architecture || '',
        device: info.device || '',
        description: info.description || ''
    };
}

function formatErrorMessage(error) {
    if (typeof error?.message === 'string' && error.message.length > 0) {
        return error.message;
    }
    return String(error);
}
