const DEFAULT_CHECKPOINT_ID = 'root';
const DEFAULT_EDGE_MODE = 'clamp';
const DEFAULT_COLOR_SPACE = 'srgb';
const DEFAULT_TEXTURE_FORMAT = 'rgba8unorm';
const DEFAULT_MAX_PREPARED_ENTRIES = 256;

/**
 * WebGPU frame composer 안에서만 blur algorithm command를 encode하는 공유 서비스입니다.
 * swapchain 획득, command encoder 종료, queue submit, canvas 상태 표시는 composer 소유입니다.
 */
export class WebGpuBlurService {
    /**
     * @param {object} options - service 의존성입니다.
     * @param {{encodeCommands:Function}} options.composerPort - composer contributor port입니다.
     * @param {Map<string,Function>|Object.<string,Function>} options.algorithmFactories - algorithm factory registry입니다.
     * @param {number} [options.maxPreparedEntries=256] - generation-local prepare LRU 상한입니다.
     */
    constructor(options = {}) {
        if (!options.composerPort
            || typeof options.composerPort.encodeCommands !== 'function') {
            throw new TypeError('WebGpuBlurService composerPort.encodeCommands가 필요합니다.');
        }

        this.composerPort = options.composerPort;
        this.algorithmFactories = normalizeAlgorithmFactories(options.algorithmFactories);
        this.maxPreparedEntries = normalizeMaxPreparedEntries(options.maxPreparedEntries);
        this.algorithmInstances = new Map();
        this.algorithmDiagnostics = new Map();
        this.preparedCache = new Map();
        this.frameOutputs = new Map();
        this.sourceTextureIds = new WeakMap();
        this.nextSourceTextureId = 1;
        this.device = null;
        this.deviceGeneration = null;
        this.currentFrameId = null;
        this.destroyed = false;

        this.requestCount = 0;
        this.encodedOutputCount = 0;
        this.sharedOutputHitCount = 0;
        this.prepareCount = 0;
        this.prepareCacheHitCount = 0;
        this.preparedCacheEvictionCount = 0;
        this.algorithmCreateCount = 0;
        this.algorithmDestroyCount = 0;
        this.algorithmDestroyFailureCount = 0;
        this.algorithmFailureCount = 0;
        this.generationChangeCount = 0;
        this.staleGenerationRejectCount = 0;
        this.staleFrameRejectCount = 0;
        this.invalidContextRejectCount = 0;
        this.inactiveFrameRejectCount = 0;
        this.destroyedRejectCount = 0;
        this.lastRequestKey = null;
        this.lastRejectReason = null;
        this.lastFailureReason = null;

        const service = this;
        this.port = Object.freeze({
            encode(request) {
                return service.encode(request);
            },
            hasAlgorithm(algorithmId) {
                return service.hasAlgorithm(algorithmId);
            },
            getSnapshot() {
                return service.getSnapshot();
            }
        });
    }

    /**
     * 현재 composer frame에 blur command를 encode하고 공유 output을 반환합니다.
     * @param {object} request - blur 요청입니다.
     * @returns {*} algorithm output이며 active/stale frame 거부 시 null입니다.
     */
    encode(request) {
        this.requestCount += 1;
        if (this.destroyed) {
            this.destroyedRejectCount += 1;
            this.lastRejectReason = 'service-destroyed';
            return null;
        }

        const normalizedRequest = this.#normalizeRequest(request);
        const sourceTextureId = this.#getSourceTextureId(normalizedRequest.sourceTexture);
        const outputKey = this.#createOutputKey(normalizedRequest, sourceTextureId);
        const preparationKey = this.#createPreparationKey(
            normalizedRequest,
            sourceTextureId
        );
        this.lastRequestKey = outputKey;

        let callbackInvoked = false;
        let callbackResult = null;
        let callbackError = null;
        let composerResult;
        try {
            composerResult = this.composerPort.encodeCommands((context) => {
                callbackInvoked = true;
                try {
                    callbackResult = this.#encodeInComposerContext(
                        context,
                        normalizedRequest,
                        outputKey,
                        preparationKey
                    );
                    return callbackResult;
                } catch (error) {
                    callbackError = error;
                    throw error;
                }
            });
        } catch (error) {
            this.#recordFailure('composer-encode-commands', error);
            throw error;
        }

        // Composer는 contributor callback 오류를 자체 진단 후 삼킬 수 있습니다.
        // 호출자에게 algorithm 실패를 숨기지 않도록 원본 오류를 다시 전달합니다.
        if (callbackError) {
            throw callbackError;
        }
        if (!callbackInvoked || composerResult === false) {
            this.inactiveFrameRejectCount += 1;
            this.lastRejectReason = 'composer-frame-inactive';
            return null;
        }
        return callbackResult;
    }

    /**
     * encode/getSnapshot만 노출하는 안정적인 port를 반환합니다.
     * @returns {Readonly<object>} blur service port입니다.
     */
    getPort() {
        return this.port;
    }

    /**
     * 초기 instance 생성 여부와 무관하게 registry에 algorithm이 등록되어 있는지 반환합니다.
     * @param {string} algorithmId - 확인할 blur algorithm ID입니다.
     * @returns {boolean} 현재 service registry 등록 여부입니다.
     */
    hasAlgorithm(algorithmId) {
        if (this.destroyed || typeof algorithmId !== 'string' || !algorithmId.trim()) {
            return false;
        }
        return this.algorithmFactories.has(algorithmId.trim());
    }

    /**
     * cache와 algorithm lifecycle 진단을 반환합니다.
     * @returns {Readonly<object>} immutable diagnostics snapshot입니다.
     */
    getSnapshot() {
        const algorithms = [];
        for (const [algorithmId, diagnostics] of this.algorithmDiagnostics.entries()) {
            algorithms.push(Object.freeze({
                algorithmId,
                createCount: diagnostics.createCount,
                destroyCount: diagnostics.destroyCount,
                prepareCount: diagnostics.prepareCount,
                prepareCacheHitCount: diagnostics.prepareCacheHitCount,
                encodeCount: diagnostics.encodeCount,
                sharedOutputHitCount: diagnostics.sharedOutputHitCount,
                failureCount: diagnostics.failureCount
            }));
        }
        algorithms.sort((left, right) => left.algorithmId.localeCompare(right.algorithmId));

        return Object.freeze({
            status: this.destroyed ? 'destroyed' : 'ready',
            registeredAlgorithmCount: this.algorithmFactories.size,
            algorithmInstanceCount: this.algorithmInstances.size,
            maxPreparedEntries: this.maxPreparedEntries,
            preparedCacheEntryCount: this.preparedCache.size,
            preparedCacheEvictionCount: this.preparedCacheEvictionCount,
            frameOutputCount: this.frameOutputs.size,
            deviceGeneration: this.deviceGeneration,
            currentFrameId: this.currentFrameId,
            requestCount: this.requestCount,
            encodedOutputCount: this.encodedOutputCount,
            sharedOutputHitCount: this.sharedOutputHitCount,
            prepareCount: this.prepareCount,
            prepareCacheHitCount: this.prepareCacheHitCount,
            algorithmCreateCount: this.algorithmCreateCount,
            algorithmDestroyCount: this.algorithmDestroyCount,
            algorithmDestroyFailureCount: this.algorithmDestroyFailureCount,
            algorithmFailureCount: this.algorithmFailureCount,
            generationChangeCount: this.generationChangeCount,
            staleGenerationRejectCount: this.staleGenerationRejectCount,
            staleFrameRejectCount: this.staleFrameRejectCount,
            invalidContextRejectCount: this.invalidContextRejectCount,
            inactiveFrameRejectCount: this.inactiveFrameRejectCount,
            destroyedRejectCount: this.destroyedRejectCount,
            lastRequestKey: this.lastRequestKey,
            lastRejectReason: this.lastRejectReason,
            lastFailureReason: this.lastFailureReason,
            algorithms: Object.freeze(algorithms)
        });
    }

    /**
     * 모든 generation-owned algorithm/resource cache를 idempotent하게 폐기합니다.
     * @returns {void}
     */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.#destroyGenerationAlgorithms('service-destroyed');
        this.preparedCache.clear();
        this.frameOutputs.clear();
        this.device = null;
        this.deviceGeneration = null;
        this.currentFrameId = null;
    }

    #normalizeRequest(request) {
        if (!request || typeof request !== 'object') {
            throw new TypeError('WebGPU blur request는 객체여야 합니다.');
        }
        const algorithmId = normalizeRequiredId(request.algorithmId, 'algorithmId');
        if (!this.algorithmFactories.has(algorithmId)) {
            throw new Error(`등록되지 않은 WebGPU blur algorithm입니다: ${algorithmId}`);
        }
        const sourceTexture = request.sourceTexture;
        if ((typeof sourceTexture !== 'object' || sourceTexture === null)
            && typeof sourceTexture !== 'function') {
            throw new TypeError('WebGPU blur sourceTexture identity가 필요합니다.');
        }

        return Object.freeze({
            algorithmId,
            sourceTexture,
            sourceRevision: normalizeNonNegativeInteger(request.sourceRevision),
            checkpointId: normalizeString(request.checkpointId, DEFAULT_CHECKPOINT_ID),
            bounds: normalizeBounds(request.bounds),
            halo: normalizeHalo(request.halo),
            sigma: normalizeNonNegativeNumber(request.sigma),
            edgeMode: normalizeString(request.edgeMode, DEFAULT_EDGE_MODE, true),
            colorSpace: normalizeString(request.colorSpace, DEFAULT_COLOR_SPACE, true),
            format: normalizeString(request.format, DEFAULT_TEXTURE_FORMAT, true)
        });
    }

    #getSourceTextureId(sourceTexture) {
        let sourceTextureId = this.sourceTextureIds.get(sourceTexture);
        if (sourceTextureId === undefined) {
            sourceTextureId = this.nextSourceTextureId++;
            this.sourceTextureIds.set(sourceTexture, sourceTextureId);
        }
        return sourceTextureId;
    }

    #createOutputKey(request, sourceTextureId) {
        // 같은 frame에서 실제 pixel 결과를 공유할 수 있는 경우만 합칩니다.
        return JSON.stringify([
            1,
            request.algorithmId,
            sourceTextureId,
            request.sourceRevision,
            request.checkpointId,
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

    #createPreparationKey(request, sourceTextureId) {
        // Pipeline/kernel topology는 frame-local content identity와 screen-space
        // origin에 의존하지 않습니다. 크기/halo/profile은 보수적으로 분리합니다.
        return JSON.stringify([
            1,
            request.algorithmId,
            sourceTextureId,
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

    #encodeInComposerContext(context, request, outputKey, preparationKey) {
        if (!this.#acceptComposerContext(context)) {
            return null;
        }

        if (this.frameOutputs.has(outputKey)) {
            const cachedOutput = this.frameOutputs.get(outputKey);
            this.sharedOutputHitCount += 1;
            this.#getAlgorithmDiagnostics(request.algorithmId).sharedOutputHitCount += 1;
            return cachedOutput;
        }

        const algorithm = this.#getOrCreateAlgorithm(request.algorithmId, context);
        let prepared;
        if (this.preparedCache.has(preparationKey)) {
            prepared = this.preparedCache.get(preparationKey);
            // Map insertion order를 recency로 사용해 deterministic LRU를 유지합니다.
            this.preparedCache.delete(preparationKey);
            this.preparedCache.set(preparationKey, prepared);
            this.prepareCacheHitCount += 1;
            this.#getAlgorithmDiagnostics(request.algorithmId).prepareCacheHitCount += 1;
        } else {
            try {
                prepared = algorithm.prepare(Object.freeze({
                    context,
                    request,
                    key: preparationKey,
                    preparationKey
                }));
                assertSynchronousValue(prepared, 'algorithm.prepare');
            } catch (error) {
                this.#recordAlgorithmFailure(request.algorithmId, 'algorithm-prepare', error);
                throw error;
            }
            this.#cachePreparedValue(preparationKey, prepared);
            this.prepareCount += 1;
            this.#getAlgorithmDiagnostics(request.algorithmId).prepareCount += 1;
        }

        let output;
        try {
            output = algorithm.encode(Object.freeze({
                context,
                request,
                key: outputKey,
                outputKey,
                preparationKey,
                prepared
            }));
            assertSynchronousValue(output, 'algorithm.encode');
        } catch (error) {
            this.#recordAlgorithmFailure(request.algorithmId, 'algorithm-encode', error);
            throw error;
        }
        this.frameOutputs.set(outputKey, output);
        this.encodedOutputCount += 1;
        this.#getAlgorithmDiagnostics(request.algorithmId).encodeCount += 1;
        this.lastRejectReason = null;
        return output;
    }

    #cachePreparedValue(key, prepared) {
        this.preparedCache.set(key, prepared);
        if (this.preparedCache.size <= this.maxPreparedEntries) {
            return;
        }
        const oldestKey = this.preparedCache.keys().next().value;
        this.preparedCache.delete(oldestKey);
        // Prepared resource의 파괴는 algorithm generation lifecycle만 소유합니다.
        this.preparedCacheEvictionCount += 1;
    }

    #acceptComposerContext(context) {
        let device;
        let generation;
        let frameId;
        let encoder;
        let target;
        let format;
        let width;
        let height;
        let targetDevice;
        let targetGeneration;
        let targetFormat;
        let targetWidth;
        let targetHeight;
        try {
            device = context?.device;
            generation = context?.deviceGeneration;
            frameId = context?.frameId;
            encoder = context?.encoder;
            target = context?.target;
            format = context?.format;
            width = context?.width;
            height = context?.height;
            targetDevice = target?.device;
            targetGeneration = target?.deviceGeneration;
            targetFormat = target?.format;
            targetWidth = target?.width;
            targetHeight = target?.height;
        } catch {
            this.invalidContextRejectCount += 1;
            this.lastRejectReason = 'invalid-composer-context';
            return false;
        }

        if (!isIdentityObject(context)
            || !isIdentityObject(device)
            || !isIdentityObject(encoder)
            || !isIdentityObject(target)
            || !Number.isSafeInteger(generation)
            || generation < 0
            || !Number.isSafeInteger(frameId)
            || frameId < 0
            || typeof format !== 'string'
            || format.trim().length === 0
            || !Number.isSafeInteger(width)
            || width <= 0
            || !Number.isSafeInteger(height)
            || height <= 0
            || targetDevice !== device
            || targetGeneration !== generation
            || targetFormat !== format
            || targetWidth !== width
            || targetHeight !== height) {
            this.invalidContextRejectCount += 1;
            this.lastRejectReason = 'invalid-composer-context';
            return false;
        }

        if (this.deviceGeneration !== null && generation < this.deviceGeneration) {
            this.staleGenerationRejectCount += 1;
            this.lastRejectReason = 'stale-device-generation';
            return false;
        }

        if (this.deviceGeneration === null || generation > this.deviceGeneration) {
            if (this.deviceGeneration !== null) {
                this.generationChangeCount += 1;
                this.#destroyGenerationAlgorithms('device-generation-drift');
                this.preparedCache.clear();
                this.frameOutputs.clear();
            }
            this.device = device;
            this.deviceGeneration = generation;
            this.currentFrameId = null;
        } else if (device !== this.device) {
            this.invalidContextRejectCount += 1;
            this.lastRejectReason = 'device-identity-drift-without-generation';
            return false;
        }

        if (this.currentFrameId !== null && frameId < this.currentFrameId) {
            this.staleFrameRejectCount += 1;
            this.lastRejectReason = 'stale-frame';
            return false;
        }
        if (this.currentFrameId === null || frameId > this.currentFrameId) {
            this.currentFrameId = frameId;
            this.frameOutputs.clear();
        }
        return true;
    }

    #getOrCreateAlgorithm(algorithmId, context) {
        const existing = this.algorithmInstances.get(algorithmId);
        if (existing) {
            return existing;
        }

        const factory = this.algorithmFactories.get(algorithmId);
        let algorithm;
        try {
            algorithm = factory(Object.freeze({
                device: context.device,
                deviceGeneration: context.deviceGeneration
            }));
        } catch (error) {
            this.#recordAlgorithmFailure(algorithmId, 'algorithm-factory', error);
            throw error;
        }
        if (!algorithm
            || typeof algorithm.prepare !== 'function'
            || typeof algorithm.encode !== 'function'
            || typeof algorithm.destroy !== 'function') {
            const error = new TypeError(
                `WebGPU blur algorithm 계약이 불완전합니다: ${algorithmId}`
            );
            this.#recordAlgorithmFailure(algorithmId, 'algorithm-factory-contract', error);
            throw error;
        }

        this.algorithmInstances.set(algorithmId, algorithm);
        this.algorithmCreateCount += 1;
        this.#getAlgorithmDiagnostics(algorithmId).createCount += 1;
        return algorithm;
    }

    #destroyGenerationAlgorithms(reason) {
        for (const [algorithmId, algorithm] of this.algorithmInstances.entries()) {
            try {
                algorithm.destroy();
                this.algorithmDestroyCount += 1;
                this.#getAlgorithmDiagnostics(algorithmId).destroyCount += 1;
            } catch (error) {
                this.algorithmDestroyFailureCount += 1;
                this.#recordAlgorithmFailure(
                    algorithmId,
                    `algorithm-destroy:${reason}`,
                    error
                );
            }
        }
        this.algorithmInstances.clear();
    }

    #getAlgorithmDiagnostics(algorithmId) {
        let diagnostics = this.algorithmDiagnostics.get(algorithmId);
        if (!diagnostics) {
            diagnostics = {
                createCount: 0,
                destroyCount: 0,
                prepareCount: 0,
                prepareCacheHitCount: 0,
                encodeCount: 0,
                sharedOutputHitCount: 0,
                failureCount: 0
            };
            this.algorithmDiagnostics.set(algorithmId, diagnostics);
        }
        return diagnostics;
    }

    #recordAlgorithmFailure(algorithmId, operation, error) {
        this.algorithmFailureCount += 1;
        this.#getAlgorithmDiagnostics(algorithmId).failureCount += 1;
        this.#recordFailure(operation, error);
    }

    #recordFailure(operation, error) {
        this.lastFailureReason = `${operation}:${formatError(error)}`;
    }
}

function normalizeAlgorithmFactories(value) {
    let entries = [];
    if (value && typeof value.entries === 'function') {
        try {
            entries = Array.from(value.entries());
        } catch {
            entries = [];
        }
    } else if (value && typeof value === 'object') {
        entries = Object.entries(value);
    }
    if (entries.length === 0) {
        throw new TypeError('WebGpuBlurService algorithmFactories가 비어 있습니다.');
    }
    const factories = new Map();
    for (const [rawId, factory] of entries) {
        const algorithmId = normalizeRequiredId(rawId, 'algorithm factory id');
        if (typeof factory !== 'function') {
            throw new TypeError(`WebGPU blur algorithm factory가 함수가 아닙니다: ${algorithmId}`);
        }
        if (factories.has(algorithmId)) {
            throw new TypeError(`WebGPU blur algorithm factory ID가 중복됩니다: ${algorithmId}`);
        }
        factories.set(algorithmId, factory);
    }
    return factories;
}

function normalizeMaxPreparedEntries(value) {
    if (value === undefined) {
        return DEFAULT_MAX_PREPARED_ENTRIES;
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError('maxPreparedEntries는 양의 안전한 정수여야 합니다.');
    }
    return value;
}

function isIdentityObject(value) {
    return (typeof value === 'object' && value !== null)
        || typeof value === 'function';
}

function normalizeRequiredId(value, label) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        throw new TypeError(`${label}는 비어 있지 않은 문자열이어야 합니다.`);
    }
    return normalized;
}

function normalizeString(value, fallback, lowercase = false) {
    const normalized = typeof value === 'string' && value.trim()
        ? value.trim()
        : fallback;
    return lowercase ? normalized.toLowerCase() : normalized;
}

function normalizeNonNegativeInteger(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value));
}

function normalizeNonNegativeNumber(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return Number(value);
}

function normalizeBounds(value) {
    const bounds = value && typeof value === 'object' ? value : {};
    return Object.freeze({
        x: normalizeInteger(bounds.x),
        y: normalizeInteger(bounds.y),
        width: normalizeExtent(bounds.width ?? bounds.w),
        height: normalizeExtent(bounds.height ?? bounds.h)
    });
}

function normalizeHalo(value) {
    if (Number.isFinite(value)) {
        const extent = normalizeExtent(value);
        return Object.freeze({
            left: extent,
            top: extent,
            right: extent,
            bottom: extent
        });
    }
    const halo = value && typeof value === 'object' ? value : {};
    const horizontal = halo.x ?? halo.horizontal;
    const vertical = halo.y ?? halo.vertical;
    return Object.freeze({
        left: normalizeExtent(halo.left ?? horizontal),
        top: normalizeExtent(halo.top ?? vertical),
        right: normalizeExtent(halo.right ?? horizontal),
        bottom: normalizeExtent(halo.bottom ?? vertical)
    });
}

function normalizeInteger(value) {
    return Number.isFinite(value) ? Math.floor(value) : 0;
}

function normalizeExtent(value) {
    return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0;
}

function assertSynchronousValue(value, operation) {
    if (value && typeof value.then === 'function') {
        throw new TypeError(`${operation}은 Promise를 반환할 수 없습니다.`);
    }
}

function formatError(error) {
    if (typeof error?.message === 'string' && error.message) {
        return error.message;
    }
    try {
        return String(error);
    } catch {
        return 'unknown-error';
    }
}
