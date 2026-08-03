const DEFAULT_QUERY_CAPACITY = 8;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

const TIMER_STATUS = Object.freeze({
    READY: 'ready',
    DISABLED: 'disabled',
    FAULTED: 'faulted',
    DESTROYED: 'destroyed'
});

const SLOT_STATE = Object.freeze({
    FREE: 'free',
    ACTIVE: 'active',
    PENDING: 'pending'
});

/**
 * WebGL timer query 슬롯을 생성합니다.
 * @returns {{query: object|null, state: string, scope: string|null, frameId: *, rendererId: string|null, trialGeneration: number, invalidated: boolean}} 빈 슬롯입니다.
 */
function createQuerySlot() {
    return {
        query: null,
        state: SLOT_STATE.FREE,
        scope: null,
        frameId: null,
        rendererId: null,
        trialGeneration: 0,
        invalidated: false
    };
}

/**
 * 양의 정수 query 용량을 반환합니다.
 * @param {*} value - 입력 값입니다.
 * @returns {number} 정규화된 용량입니다.
 */
function normalizeCapacity(value) {
    return Number.isFinite(value) && value > 0
        ? Math.max(1, Math.floor(value))
        : DEFAULT_QUERY_CAPACITY;
}

/**
 * 오류 값을 짧은 진단 문자열로 변환합니다.
 * @param {*} error - 원본 오류입니다.
 * @returns {string} 진단 문자열입니다.
 */
function resolveErrorMessage(error) {
    if (typeof error?.message === 'string' && error.message.length > 0) {
        return error.message;
    }
    try {
        const message = String(error);
        return message.length > 0 ? message : 'unknown-error';
    } catch {
        return 'unknown-error';
    }
}

/**
 * WebGL2 EXT_disjoint_timer_query_webgl2 adapter를 생성합니다.
 * @param {WebGL2RenderingContext} gl - 대상 컨텍스트입니다.
 * @param {object|null} extension - timer query 확장입니다.
 * @returns {object|null} 지원되는 adapter입니다.
 */
function createWebGL2TimerAdapter(gl, extension) {
    if (!extension
        || typeof gl.createQuery !== 'function'
        || typeof gl.deleteQuery !== 'function'
        || typeof gl.beginQuery !== 'function'
        || typeof gl.endQuery !== 'function'
        || typeof gl.getQueryParameter !== 'function'
        || typeof gl.getParameter !== 'function'
        || !Number.isFinite(extension.TIME_ELAPSED_EXT)
        || !Number.isFinite(extension.GPU_DISJOINT_EXT)
        || !Number.isFinite(gl.QUERY_RESULT_AVAILABLE)
        || !Number.isFinite(gl.QUERY_RESULT)) {
        return null;
    }

    return {
        api: 'webgl2',
        createQuery: () => gl.createQuery(),
        deleteQuery: (query) => gl.deleteQuery(query),
        beginQuery: (query) => gl.beginQuery(extension.TIME_ELAPSED_EXT, query),
        endQuery: () => gl.endQuery(extension.TIME_ELAPSED_EXT),
        isResultAvailable: (query) => gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
        getResultNanoseconds: (query) => gl.getQueryParameter(query, gl.QUERY_RESULT),
        isDisjoint: () => gl.getParameter(extension.GPU_DISJOINT_EXT)
    };
}

/**
 * WebGL1 EXT_disjoint_timer_query adapter를 생성합니다.
 * @param {WebGLRenderingContext} gl - 대상 컨텍스트입니다.
 * @param {object|null} extension - timer query 확장입니다.
 * @returns {object|null} 지원되는 adapter입니다.
 */
function createWebGL1TimerAdapter(gl, extension) {
    if (!extension
        || typeof extension.createQueryEXT !== 'function'
        || typeof extension.deleteQueryEXT !== 'function'
        || typeof extension.beginQueryEXT !== 'function'
        || typeof extension.endQueryEXT !== 'function'
        || typeof extension.getQueryObjectEXT !== 'function'
        || typeof gl.getParameter !== 'function'
        || !Number.isFinite(extension.TIME_ELAPSED_EXT)
        || !Number.isFinite(extension.GPU_DISJOINT_EXT)
        || !Number.isFinite(extension.QUERY_RESULT_AVAILABLE_EXT)
        || !Number.isFinite(extension.QUERY_RESULT_EXT)) {
        return null;
    }

    return {
        api: 'webgl1',
        createQuery: () => extension.createQueryEXT(),
        deleteQuery: (query) => extension.deleteQueryEXT(query),
        beginQuery: (query) => extension.beginQueryEXT(extension.TIME_ELAPSED_EXT, query),
        endQuery: () => extension.endQueryEXT(extension.TIME_ELAPSED_EXT),
        isResultAvailable: (query) => extension.getQueryObjectEXT(
            query,
            extension.QUERY_RESULT_AVAILABLE_EXT
        ),
        getResultNanoseconds: (query) => extension.getQueryObjectEXT(
            query,
            extension.QUERY_RESULT_EXT
        ),
        isDisjoint: () => gl.getParameter(extension.GPU_DISJOINT_EXT)
    };
}

/**
 * 컨텍스트에서 사용 가능한 timer query API를 탐색합니다.
 * WebGL2 전용 확장을 먼저 확인한 뒤 WebGL1 확장으로 폴백합니다.
 * @param {WebGLRenderingContext|WebGL2RenderingContext|null|undefined} gl - 대상 컨텍스트입니다.
 * @returns {{adapter: object|null, reason: string|null, error: *}} 탐색 결과입니다.
 */
function resolveTimerAdapter(gl) {
    if (!gl || typeof gl.getExtension !== 'function') {
        return { adapter: null, reason: 'context-unavailable', error: null };
    }

    try {
        const webGL2Extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        const webGL2Adapter = createWebGL2TimerAdapter(gl, webGL2Extension);
        if (webGL2Adapter) {
            return { adapter: webGL2Adapter, reason: null, error: null };
        }

        const webGL1Extension = gl.getExtension('EXT_disjoint_timer_query');
        const webGL1Adapter = createWebGL1TimerAdapter(gl, webGL1Extension);
        if (webGL1Adapter) {
            return { adapter: webGL1Adapter, reason: null, error: null };
        }

        const reason = webGL2Extension || webGL1Extension
            ? 'timer-query-api-incomplete'
            : 'timer-query-extension-unavailable';
        return { adapter: null, reason, error: null };
    } catch (error) {
        return { adapter: null, reason: 'api-failure:get-extension', error };
    }
}

const TIMER_CONTEXT_COORDINATORS = new WeakMap();

/**
 * 한 WebGL context의 TIME_ELAPSED 활성 scope와 context-wide disjoint 판정을 공유합니다.
 * @class WebGLGpuTimerQueryContextCoordinator
 */
class WebGLGpuTimerQueryContextCoordinator {
    constructor(gl) {
        this.gl = gl;
        this.rings = new Set();
        this.activeRing = null;
        this.polling = false;
        this.invalidated = false;
        const resolution = resolveTimerAdapter(gl);
        this.adapter = resolution.adapter;
        this.reason = resolution.reason;
        this.error = resolution.error;
    }

    register(ring) {
        if (!this.invalidated && this.adapter) {
            this.rings.add(ring);
        }
    }

    unregister(ring) {
        this.rings.delete(ring);
        if (this.activeRing === ring) {
            this.activeRing = null;
        }
    }

    begin(ring, query) {
        if (this.invalidated || !this.adapter) {
            throw new Error('timer query context coordinator is unavailable');
        }
        if (this.activeRing && this.activeRing !== ring) {
            throw new Error('timer query scope overlaps another ring on the same context');
        }
        this.adapter.beginQuery(query);
        this.activeRing = ring;
    }

    end(ring) {
        if (this.invalidated || !this.adapter) {
            throw new Error('timer query context coordinator is unavailable');
        }
        if (this.activeRing !== ring) {
            throw new Error('timer query ring does not own the active context scope');
        }
        this.adapter.endQuery();
        this.activeRing = null;
    }

    poll(requestingRing) {
        if (this.invalidated || !this.adapter || this.polling) {
            return 0;
        }
        this.polling = true;
        const rings = [...this.rings];
        const collectedCounts = new Map();
        try {
            let disjoint;
            try {
                disjoint = Boolean(this.adapter.isDisjoint());
            } catch (error) {
                for (const ring of rings) {
                    ring._handleContextCoordinatorFault('read-disjoint-state', error);
                }
                return 0;
            }
            for (const ring of rings) {
                collectedCounts.set(ring, ring._pollFromContextCoordinator(disjoint));
            }
            return collectedCounts.get(requestingRing) || 0;
        } finally {
            this.polling = false;
        }
    }

    invalidate(reason) {
        if (this.invalidated) {
            return;
        }
        this.invalidated = true;
        const rings = [...this.rings];
        this.rings.clear();
        this.activeRing = null;
        for (const ring of rings) {
            ring._handleContextInvalidation(reason);
        }
    }
}

function getTimerContextCoordinator(gl) {
    const canUseWeakMap = (typeof gl === 'object' && gl !== null)
        || typeof gl === 'function';
    if (!canUseWeakMap) {
        return new WebGLGpuTimerQueryContextCoordinator(gl);
    }
    let coordinator = TIMER_CONTEXT_COORDINATORS.get(gl);
    if (!coordinator || coordinator.invalidated) {
        coordinator = new WebGLGpuTimerQueryContextCoordinator(gl);
        TIMER_CONTEXT_COORDINATORS.set(gl, coordinator);
    }
    return coordinator;
}

/**
 * context loss 시 해당 context의 모든 live/retiring timer ring을 한 번에 무효화합니다.
 * @param {WebGLRenderingContext|WebGL2RenderingContext|null} gl - 잃은 context입니다.
 * @param {string} [reason='webgl-context-lost'] - 진단 이유입니다.
 * @returns {void}
 */
export function invalidateWebGLGpuTimerQueryContext(gl, reason = 'webgl-context-lost') {
    const coordinator = gl && TIMER_CONTEXT_COORDINATORS.get(gl);
    coordinator?.invalidate(reason);
    if (gl) {
        TIMER_CONTEXT_COORDINATORS.delete(gl);
    }
}

/**
 * @class WebGLGpuTimerQueryRing
 * @description WebGL1/2 disjoint timer query를 동기 대기 없이 순차 수집합니다.
 */
export class WebGLGpuTimerQueryRing {
    /**
     * @param {WebGLRenderingContext|WebGL2RenderingContext|null|undefined} gl - 대상 컨텍스트입니다.
     * @param {{capacity?: number}} [options] - 고정 query/sample ring 옵션입니다.
     */
    constructor(gl, options = {}) {
        this.capacity = normalizeCapacity(options.capacity);
        this.slots = Array.from({ length: this.capacity }, createQuerySlot);
        this.pendingSlotIndices = new Int32Array(this.capacity);
        this.samples = new Array(this.capacity);
        this.pendingReadIndex = 0;
        this.pendingWriteIndex = 0;
        this.pendingCount = 0;
        this.sampleReadIndex = 0;
        this.sampleWriteIndex = 0;
        this.sampleCount = 0;
        this.nextSlotSearchIndex = 0;
        this.activeSlotIndex = -1;
        this.disjointLatched = false;
        this.status = TIMER_STATUS.DISABLED;
        this.reason = null;
        this.lastFailureReason = null;
        this.adapter = null;
        this.contextCoordinator = null;
        this.totalBeginCount = 0;
        this.totalEndCount = 0;
        this.totalSampleCount = 0;
        this.rejectedBeginCount = 0;
        this.disabledBeginCount = 0;
        this.faultedBeginCount = 0;
        this.destroyedBeginCount = 0;
        this.invalidScopeCount = 0;
        this.overlappingBeginCount = 0;
        this.capacityOverflowCount = 0;
        this.endWithoutBeginCount = 0;
        this.disjointCount = 0;
        this.discardedQueryCount = 0;
        this.abortedQueryCount = 0;
        this.faultDiscardedQueryCount = 0;
        this.destroyDiscardedPendingQueryCount = 0;
        this.destroyDiscardedSampleCount = 0;
        this.destroyAbortedActiveQueryCount = 0;
        this.contextInvalidationCount = 0;
        this.contextDiscardedQueryCount = 0;
        this.apiFailureCount = 0;

        const coordinator = getTimerContextCoordinator(gl);
        this.contextCoordinator = coordinator;
        if (coordinator.adapter) {
            this.adapter = coordinator.adapter;
            this.status = TIMER_STATUS.READY;
            coordinator.register(this);
        } else {
            this.reason = coordinator.reason;
            this.lastFailureReason = coordinator.reason;
            if (coordinator.error) {
                this.status = TIMER_STATUS.FAULTED;
                this.apiFailureCount = 1;
                this.reason = `${coordinator.reason}:${resolveErrorMessage(coordinator.error)}`;
                this.lastFailureReason = this.reason;
            }
        }
    }

    /**
     * 순차 GPU 시간 scope를 시작합니다. 이미 활성 scope가 있거나 ring이 가득 차면 거부합니다.
     * @param {string} scopeName - sample에 기록할 scope 이름입니다.
     * @param {*} frameId - sample에 그대로 기록할 프레임 식별자입니다.
     * @param {{rendererId?:string,trialGeneration?:number}} [metadata] - begin 시 복사할 immutable identity입니다.
     * @returns {boolean} query 시작 성공 여부입니다.
     */
    begin(scopeName, frameId, metadata = {}) {
        if (this.status !== TIMER_STATUS.READY) {
            this.rejectedBeginCount++;
            if (this.status === TIMER_STATUS.DISABLED) {
                this.disabledBeginCount++;
            } else if (this.status === TIMER_STATUS.FAULTED) {
                this.faultedBeginCount++;
            } else if (this.status === TIMER_STATUS.DESTROYED) {
                this.destroyedBeginCount++;
            }
            return false;
        }
        if (typeof scopeName !== 'string' || scopeName.length === 0) {
            this.rejectedBeginCount++;
            this.invalidScopeCount++;
            this.#recordOperationalFailure('invalid-scope');
            return false;
        }
        if (this.activeSlotIndex >= 0) {
            this.rejectedBeginCount++;
            this.overlappingBeginCount++;
            this.#recordOperationalFailure('scope-already-active');
            return false;
        }

        const slotIndex = this.#findFreeSlotIndex();
        if (slotIndex < 0) {
            this.rejectedBeginCount++;
            this.capacityOverflowCount++;
            this.#recordOperationalFailure('capacity-overflow');
            return false;
        }

        const slot = this.slots[slotIndex];
        if (!slot.query) {
            try {
                slot.query = this.adapter.createQuery();
            } catch (error) {
                this.rejectedBeginCount++;
                this.#transitionToFault('create-query', error, false);
                return false;
            }
            if (!slot.query) {
                this.rejectedBeginCount++;
                this.#transitionToFault(
                    'create-query',
                    new Error('query creation returned null'),
                    false
                );
                return false;
            }
        }

        slot.state = SLOT_STATE.ACTIVE;
        slot.scope = scopeName;
        slot.frameId = frameId;
        slot.rendererId = typeof metadata?.rendererId === 'string'
            ? metadata.rendererId
            : null;
        slot.trialGeneration = Number.isSafeInteger(metadata?.trialGeneration)
            && metadata.trialGeneration >= 0
            ? metadata.trialGeneration
            : 0;
        slot.invalidated = false;
        this.activeSlotIndex = slotIndex;
        try {
            this.contextCoordinator.begin(this, slot.query);
        } catch (error) {
            this.rejectedBeginCount++;
            this.#transitionToFault('begin-query', error, false);
            return false;
        }

        this.nextSlotSearchIndex = (slotIndex + 1) % this.capacity;
        this.totalBeginCount++;
        return true;
    }

    /**
     * 현재 GPU 시간 scope를 종료해 비동기 결과 대기열에 넣습니다.
     * @returns {boolean} query 종료 성공 여부입니다.
     */
    end() {
        if (this.status !== TIMER_STATUS.READY) {
            return false;
        }
        if (this.activeSlotIndex < 0) {
            this.endWithoutBeginCount++;
            this.#recordOperationalFailure('end-without-begin');
            return false;
        }

        const slotIndex = this.activeSlotIndex;
        const slot = this.slots[slotIndex];
        try {
            this.contextCoordinator.end(this);
        } catch (error) {
            this.#transitionToFault('end-query', error, true);
            return false;
        }

        this.activeSlotIndex = -1;
        this.totalEndCount++;
        if (slot.invalidated) {
            this.discardedQueryCount++;
            if (!this.#deleteAndResetSlot(slot, 'delete-disjoint-active-query')) {
                return false;
            }
            return true;
        }

        slot.state = SLOT_STATE.PENDING;
        this.pendingSlotIndices[this.pendingWriteIndex] = slotIndex;
        this.pendingWriteIndex = (this.pendingWriteIndex + 1) % this.capacity;
        this.pendingCount++;
        return true;
    }

    /**
     * 예외로 중단된 활성 scope를 닫고 결과를 표본으로 발행하지 않은 채 폐기합니다.
     * @param {string} [reason='scope-aborted'] - 최신 진단 이유입니다.
     * @returns {boolean} 활성 query를 정상적으로 닫고 폐기했으면 true입니다.
     */
    abort(reason = 'scope-aborted') {
        if (this.status !== TIMER_STATUS.READY) {
            return false;
        }
        if (this.activeSlotIndex < 0) {
            this.endWithoutBeginCount++;
            this.#recordOperationalFailure('abort-without-begin');
            return false;
        }

        const slotIndex = this.activeSlotIndex;
        const slot = this.slots[slotIndex];
        try {
            this.contextCoordinator.end(this);
        } catch (error) {
            this.#transitionToFault('abort-query', error, true);
            return false;
        }

        this.activeSlotIndex = -1;
        this.totalEndCount++;
        this.abortedQueryCount++;
        this.discardedQueryCount++;
        this.#recordOperationalFailure(
            typeof reason === 'string' && reason ? reason : 'scope-aborted'
        );
        return this.#deleteAndResetSlot(slot, 'delete-aborted-query');
    }

    /**
     * 준비된 oldest query 결과만 수집합니다. GPU 완료를 기다리거나 finish를 호출하지 않습니다.
     * @returns {number} 이번 호출에서 sample ring으로 이동한 결과 수입니다.
     */
    poll() {
        if (this.status !== TIMER_STATUS.READY) {
            return 0;
        }
        if (this.pendingCount === 0 && this.activeSlotIndex < 0) {
            return 0;
        }
        return this.contextCoordinator.poll(this);
    }

    /** @internal context coordinator만 호출합니다. */
    _pollFromContextCoordinator(disjoint) {
        if (this.status !== TIMER_STATUS.READY
            || (this.pendingCount === 0 && this.activeSlotIndex < 0)) {
            return 0;
        }
        if (disjoint) {
            if (!this.disjointLatched) {
                this.disjointCount++;
            }
            this.disjointLatched = true;
            this.#recordOperationalFailure('gpu-disjoint');
            if (!this.#discardPendingQueries()) {
                return 0;
            }
            if (this.activeSlotIndex >= 0) {
                this.slots[this.activeSlotIndex].invalidated = true;
            }
            return 0;
        }
        this.disjointLatched = false;

        let collectedCount = 0;
        while (this.pendingCount > 0 && this.sampleCount < this.capacity) {
            const slotIndex = this.pendingSlotIndices[this.pendingReadIndex];
            const slot = this.slots[slotIndex];
            let available = false;
            try {
                available = Boolean(this.adapter.isResultAvailable(slot.query));
            } catch (error) {
                this.#transitionToFault('read-query-availability', error, true);
                return collectedCount;
            }
            if (!available) {
                break;
            }

            let resultNanoseconds;
            try {
                resultNanoseconds = Number(this.adapter.getResultNanoseconds(slot.query));
            } catch (error) {
                this.#transitionToFault('read-query-result', error, true);
                return collectedCount;
            }
            if (!Number.isFinite(resultNanoseconds) || resultNanoseconds < 0) {
                this.#transitionToFault(
                    'read-query-result',
                    new Error('query result is not a finite non-negative number'),
                    true
                );
                return collectedCount;
            }

            this.pendingReadIndex = (this.pendingReadIndex + 1) % this.capacity;
            this.pendingCount--;
            this.samples[this.sampleWriteIndex] = {
                scope: slot.scope,
                frameId: slot.frameId,
                rendererId: slot.rendererId,
                trialGeneration: slot.trialGeneration,
                gpuMs: resultNanoseconds / NANOSECONDS_PER_MILLISECOND
            };
            this.sampleWriteIndex = (this.sampleWriteIndex + 1) % this.capacity;
            this.sampleCount++;
            this.totalSampleCount++;
            this.#resetSlotMetadata(slot);
            collectedCount++;
        }
        return collectedCount;
    }

    /** @internal context-wide disjoint 조회 실패를 모든 ring에 전파합니다. */
    _handleContextCoordinatorFault(operation, error) {
        if (this.status === TIMER_STATUS.READY) {
            this.#transitionToFault(operation, error, true);
        }
    }

    /** @internal context loss/restore 경계에서 pending과 active query를 무효화합니다. */
    _handleContextInvalidation(reason) {
        if (this.status === TIMER_STATUS.DESTROYED) {
            return;
        }
        const discardedQueryCount = this.pendingCount + (this.activeSlotIndex >= 0 ? 1 : 0);
        this.contextInvalidationCount += 1;
        this.contextDiscardedQueryCount += discardedQueryCount;
        this.discardedQueryCount += discardedQueryCount;
        this.reason = typeof reason === 'string' && reason ? reason : 'context-invalidated';
        this.lastFailureReason = this.reason;
        this.#deleteAllQueriesForCleanup('context-invalidation-delete-query');
        this.#clearPendingQueue();
        this.activeSlotIndex = -1;
        this.status = TIMER_STATUS.FAULTED;
    }

    /**
     * 지금까지 poll이 수집한 sample을 발행 순서대로 반환하고 sample ring을 비웁니다.
     * @returns {Array<{scope: string, frameId: *, gpuMs: number}>} 배출된 sample입니다.
     */
    drainSamples() {
        const drained = new Array(this.sampleCount);
        for (let index = 0; index < drained.length; index++) {
            drained[index] = this.samples[this.sampleReadIndex];
            this.samples[this.sampleReadIndex] = undefined;
            this.sampleReadIndex = (this.sampleReadIndex + 1) % this.capacity;
        }
        this.sampleCount = 0;
        this.sampleWriteIndex = this.sampleReadIndex;
        return drained;
    }

    /**
     * 현재 지원 상태와 누적 진단 카운터를 반환합니다.
     * @returns {Readonly<object>} 읽기 전용 상태 스냅샷입니다.
     */
    getSnapshot() {
        const activeSlot = this.activeSlotIndex >= 0
            ? this.slots[this.activeSlotIndex]
            : null;
        let allocatedQueryCount = 0;
        for (let index = 0; index < this.slots.length; index++) {
            if (this.slots[index].query) {
                allocatedQueryCount++;
            }
        }

        return Object.freeze({
            status: this.status,
            supported: this.adapter !== null,
            enabled: this.status === TIMER_STATUS.READY,
            api: this.adapter?.api ?? null,
            reason: this.reason,
            lastFailureReason: this.lastFailureReason,
            capacity: this.capacity,
            active: activeSlot !== null,
            activeScope: activeSlot?.scope ?? null,
            activeFrameId: activeSlot?.frameId ?? null,
            pendingCount: this.pendingCount,
            sampleCount: this.sampleCount,
            allocatedQueryCount,
            totalBeginCount: this.totalBeginCount,
            totalEndCount: this.totalEndCount,
            totalSampleCount: this.totalSampleCount,
            rejectedBeginCount: this.rejectedBeginCount,
            disabledBeginCount: this.disabledBeginCount,
            faultedBeginCount: this.faultedBeginCount,
            destroyedBeginCount: this.destroyedBeginCount,
            invalidScopeCount: this.invalidScopeCount,
            overlappingBeginCount: this.overlappingBeginCount,
            capacityOverflowCount: this.capacityOverflowCount,
            endWithoutBeginCount: this.endWithoutBeginCount,
            disjointCount: this.disjointCount,
            discardedQueryCount: this.discardedQueryCount,
            abortedQueryCount: this.abortedQueryCount,
            faultDiscardedQueryCount: this.faultDiscardedQueryCount,
            destroyDiscardedPendingQueryCount: this.destroyDiscardedPendingQueryCount,
            destroyDiscardedSampleCount: this.destroyDiscardedSampleCount,
            destroyAbortedActiveQueryCount: this.destroyAbortedActiveQueryCount,
            contextInvalidationCount: this.contextInvalidationCount,
            contextDiscardedQueryCount: this.contextDiscardedQueryCount,
            apiFailureCount: this.apiFailureCount
        });
    }

    /**
     * 활성 query를 닫고 생성된 query와 대기/sample ring을 정리합니다.
     * 여러 번 호출해도 첫 호출 이후 추가 GL 작업을 하지 않습니다.
     * @returns {void}
     */
    destroy() {
        if (this.status === TIMER_STATUS.DESTROYED) {
            return;
        }

        if (this.activeSlotIndex >= 0 && this.adapter) {
            this.destroyAbortedActiveQueryCount++;
            this.discardedQueryCount++;
            try {
                this.contextCoordinator.end(this);
                this.totalEndCount++;
            } catch (error) {
                this.#recordCleanupApiFailure('destroy-end-query', error);
            }
        }
        this.destroyDiscardedPendingQueryCount += this.pendingCount;
        this.discardedQueryCount += this.pendingCount;
        this.destroyDiscardedSampleCount += this.sampleCount;
        this.#deleteAllQueriesForCleanup('destroy-delete-query');
        this.#clearPendingQueue();
        this.activeSlotIndex = -1;
        for (let index = 0; index < this.samples.length; index++) {
            this.samples[index] = undefined;
        }
        this.sampleReadIndex = 0;
        this.sampleWriteIndex = 0;
        this.sampleCount = 0;
        this.disjointLatched = false;
        this.contextCoordinator?.unregister(this);
        this.status = TIMER_STATUS.DESTROYED;
        this.reason = 'destroyed';
    }

    /**
     * @private
     * @returns {number} 다음 free query 슬롯 index 또는 -1입니다.
     */
    #findFreeSlotIndex() {
        for (let offset = 0; offset < this.capacity; offset++) {
            const index = (this.nextSlotSearchIndex + offset) % this.capacity;
            if (this.slots[index].state === SLOT_STATE.FREE) {
                return index;
            }
        }
        return -1;
    }

    /**
     * @private
     * @returns {boolean} 모든 pending query 폐기 성공 여부입니다.
     */
    #discardPendingQueries() {
        while (this.pendingCount > 0) {
            const slotIndex = this.pendingSlotIndices[this.pendingReadIndex];
            const slot = this.slots[slotIndex];
            this.pendingReadIndex = (this.pendingReadIndex + 1) % this.capacity;
            this.pendingCount--;
            this.discardedQueryCount++;
            if (!this.#deleteAndResetSlot(slot, 'delete-disjoint-query')) {
                this.#clearPendingQueue();
                return false;
            }
        }
        this.pendingWriteIndex = this.pendingReadIndex;
        return true;
    }

    /**
     * @private
     * @param {object} slot - 초기화할 query 슬롯입니다.
     * @param {string} operation - 실패 진단용 작업 이름입니다.
     * @returns {boolean} 삭제 성공 여부입니다.
     */
    #deleteAndResetSlot(slot, operation) {
        if (slot.query) {
            try {
                this.adapter.deleteQuery(slot.query);
            } catch (error) {
                this.#transitionToFault(operation, error, true);
                return false;
            }
        }
        slot.query = null;
        this.#resetSlotMetadata(slot);
        return true;
    }

    /**
     * @private
     * @param {object} slot - 초기화할 query 슬롯입니다.
     * @returns {void}
     */
    #resetSlotMetadata(slot) {
        slot.state = SLOT_STATE.FREE;
        slot.scope = null;
        slot.frameId = null;
        slot.rendererId = null;
        slot.trialGeneration = 0;
        slot.invalidated = false;
    }

    /**
     * @private
     * @returns {void}
     */
    #clearPendingQueue() {
        this.pendingReadIndex = 0;
        this.pendingWriteIndex = 0;
        this.pendingCount = 0;
    }

    /**
     * @private
     * @param {string} reason - 최신 비정상 상태 이유입니다.
     * @returns {void}
     */
    #recordOperationalFailure(reason) {
        this.reason = reason;
        this.lastFailureReason = reason;
    }

    /**
     * @private
     * @param {string} operation - 실패한 GL 작업입니다.
     * @param {*} error - 원본 오류입니다.
     * @param {boolean} attemptEndActive - 활성 query 종료를 최선 노력으로 시도할지 여부입니다.
     * @returns {void}
     */
    #transitionToFault(operation, error, attemptEndActive) {
        this.apiFailureCount++;
        const failureReason = `api-failure:${operation}:${resolveErrorMessage(error)}`;
        this.reason = failureReason;
        this.lastFailureReason = failureReason;

        const activeQueryCount = this.activeSlotIndex >= 0 ? 1 : 0;
        const discardedQueryCount = this.pendingCount + activeQueryCount;
        this.faultDiscardedQueryCount += discardedQueryCount;
        this.discardedQueryCount += discardedQueryCount;

        if (attemptEndActive && this.activeSlotIndex >= 0 && this.adapter) {
            try {
                this.contextCoordinator.end(this);
                this.totalEndCount++;
            } catch (cleanupError) {
                this.#recordCleanupApiFailure('fault-end-query', cleanupError, false);
            }
        }
        this.#deleteAllQueriesForCleanup('fault-delete-query');
        this.#clearPendingQueue();
        this.activeSlotIndex = -1;
        this.contextCoordinator?.unregister(this);
        this.status = TIMER_STATUS.FAULTED;
    }

    /**
     * @private
     * @param {string} operation - cleanup 작업 이름입니다.
     * @returns {void}
     */
    #deleteAllQueriesForCleanup(operation) {
        if (!this.adapter) {
            for (let index = 0; index < this.slots.length; index++) {
                this.slots[index].query = null;
                this.#resetSlotMetadata(this.slots[index]);
            }
            return;
        }

        for (let index = 0; index < this.slots.length; index++) {
            const slot = this.slots[index];
            if (slot.query) {
                try {
                    this.adapter.deleteQuery(slot.query);
                } catch (error) {
                    this.#recordCleanupApiFailure(operation, error, false);
                }
            }
            slot.query = null;
            this.#resetSlotMetadata(slot);
        }
    }

    /**
     * @private
     * @param {string} operation - 실패한 cleanup 작업입니다.
     * @param {*} error - 원본 오류입니다.
     * @param {boolean} [replaceReason=true] - 현재 reason을 교체할지 여부입니다.
     * @returns {void}
     */
    #recordCleanupApiFailure(operation, error, replaceReason = true) {
        this.apiFailureCount++;
        const failureReason = `api-failure:${operation}:${resolveErrorMessage(error)}`;
        this.lastFailureReason = failureReason;
        if (replaceReason) {
            this.reason = failureReason;
        }
    }
}
