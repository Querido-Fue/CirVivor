import {
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    createGpuEffectPulseBatchId,
    createGpuEffectPulseCommandId
} from './gpu_effect_command_owner.js';
import {
    GPU_EFFECT_PULSE_PROGRAM_RESULT
} from '../../physics/gpu/gpu_effect_runtime_abi.js';

const PULSE_PENDING_PHASE = Object.freeze({
    NONE: 0,
    QUEUED: 1,
    SUBMITTED: 2
});
const EFFECT_COMMAND_PIPELINE_DEPTH = 4;
const MAXIMUM_EFFECT_SOURCE_AUDITS_PER_FIXED_TICK = 8;

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function normalizeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    return Object.freeze({
        entityId: requirePositiveSafeInteger(source.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(
            source.incarnation,
            `${label}.incarnation`
        )
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function assertEndpoint(endpoint) {
    for (const methodName of ['hasBody', 'getCapacity', 'getStatus']) {
        if (typeof endpoint?.[methodName] !== 'function') {
            throw new TypeError(`PentagonEffectDirector endpoint.${methodName}()가 필요합니다.`);
        }
    }
    return endpoint;
}

function assertRegistry(registry) {
    for (const methodName of ['has', 'copyEntityView']) {
        if (typeof registry?.[methodName] !== 'function') {
            throw new TypeError(`PentagonEffectDirector registry.${methodName}()가 필요합니다.`);
        }
    }
    return registry;
}

function assertEffectCommandPort(port) {
    if (!port || typeof port.requestPulseBatch !== 'function') {
        throw new TypeError('effectCommandPort.requestPulseBatch()가 필요합니다.');
    }
    return port;
}

function createEmptyStageResult(fixedTick = 0) {
    return Object.freeze({
        accepted: true,
        targetFixedTick: fixedTick,
        batchId: null,
        stagedCount: 0,
        replayed: false,
        recoveryRequired: false
    });
}

function pushMinHeap(heap, entry, compare) {
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
        const parentIndex = (index - 1) >> 1;
        const parent = heap[parentIndex];
        if (compare(parent, entry) <= 0) {
            break;
        }
        heap[index] = parent;
        index = parentIndex;
    }
    heap[index] = entry;
}

function popMinHeap(heap, compare) {
    if (heap.length === 0) return null;
    const root = heap[0];
    const tail = heap.pop();
    if (heap.length === 0) return root;
    let index = 0;
    const halfLength = heap.length >> 1;
    while (index < halfLength) {
        let childIndex = (index << 1) + 1;
        let child = heap[childIndex];
        const rightIndex = childIndex + 1;
        if (rightIndex < heap.length
            && compare(heap[rightIndex], child) < 0) {
            childIndex = rightIndex;
            child = heap[rightIndex];
        }
        if (compare(tail, child) <= 0) {
            break;
        }
        heap[index] = child;
        index = childIndex;
    }
    heap[index] = tail;
    return root;
}

function comparePulseScheduleEntry(left, right) {
    return left.nextPulseTick - right.nextPulseTick
        || left.entityId - right.entityId
        || left.incarnation - right.incarnation
        || left.pulseSequence - right.pulseSequence;
}

function comparePulseIdentity(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation
        || left.pulseSequence - right.pulseSequence;
}

function mergeSortedPulseEntries(leftEntries, rightEntries) {
    if (leftEntries.length === 0) return rightEntries;
    if (rightEntries.length === 0) return leftEntries;
    const merged = new Array(leftEntries.length + rightEntries.length);
    let leftIndex = 0;
    let rightIndex = 0;
    let writeIndex = 0;
    while (leftIndex < leftEntries.length
        && rightIndex < rightEntries.length) {
        if (comparePulseIdentity(
            leftEntries[leftIndex],
            rightEntries[rightIndex]
        ) <= 0) {
            merged[writeIndex++] = leftEntries[leftIndex++];
        } else {
            merged[writeIndex++] = rightEntries[rightIndex++];
        }
    }
    while (leftIndex < leftEntries.length) {
        merged[writeIndex++] = leftEntries[leftIndex++];
    }
    while (rightIndex < rightEntries.length) {
        merged[writeIndex++] = rightEntries[rightIndex++];
    }
    return merged;
}

/**
 * Pentagon Effect capability의 exact-handle roster와 pulse cadence만 소유합니다.
 * Effect instance/summary/pose는 GPU authority이며 roster는 bounded SoA입니다.
 */
export class PentagonEffectDirector {
    constructor(options = {}) {
        this.endpoint = assertEndpoint(options.endpoint);
        this.registry = assertRegistry(
            options.registry ?? options.endpoint?.getRegistry?.()
        );
        this.effectCommandPort = assertEffectCommandPort(
            options.effectCommandPort
        );
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration
                ?? this.endpoint.getStatus().sessionGeneration,
            'sessionGeneration'
        );
        this.capacity = requirePositiveSafeInteger(
            options.capacity ?? this.endpoint.getCapacity(),
            'PentagonEffectDirector.capacity'
        );
        this.effectEmitterProfileById = options.effectEmitterProfileById
            ?? ENEMY_EFFECT_EMITTER_PROFILE_BY_ID;
        this.effectDefinitionById = options.effectDefinitionById
            ?? ENEMY_EFFECT_DEFINITION_BY_ID;
        const endpointStatus = this.endpoint.getStatus();
        const endpointEffectCommandCapacity = Number(
            endpointStatus?.effectCommandCapacity
        );
        const defaultPulseAdmission = Number.isSafeInteger(
            endpointEffectCommandCapacity
        ) && endpointEffectCommandCapacity > 0
            ? Math.max(
                1,
                Math.floor(
                    endpointEffectCommandCapacity
                        / EFFECT_COMMAND_PIPELINE_DEPTH
                )
            )
            : this.capacity;
        this.maximumPulseProgramsPerFixedTick = requirePositiveSafeInteger(
            options.maximumPulseProgramsPerFixedTick
                ?? defaultPulseAdmission,
            'maximumPulseProgramsPerFixedTick'
        );
        if (Number.isSafeInteger(endpointEffectCommandCapacity)
            && endpointEffectCommandCapacity > 0
            && this.maximumPulseProgramsPerFixedTick
                > endpointEffectCommandCapacity) {
            throw new RangeError(
                'maximumPulseProgramsPerFixedTick은 Effect command capacity를 초과할 수 없습니다.'
            );
        }
        this.currentPulseProgramsPerFixedTick
            = this.maximumPulseProgramsPerFixedTick;

        this.entityIds = new Uint32Array(this.capacity);
        this.incarnations = new Uint32Array(this.capacity);
        this.nextPulseTicks = new Float64Array(this.capacity);
        this.pulseSequences = new Float64Array(this.capacity);
        this.pendingTicks = new Float64Array(this.capacity);
        this.pendingPhases = new Uint8Array(this.capacity);
        this.consecutiveDeferCounts = new Uint32Array(this.capacity);
        this.scheduleVersions = new Float64Array(this.capacity);
        this.lastLivenessAuditTicks = new Float64Array(this.capacity);
        this.profileIds = new Array(this.capacity).fill(null);
        this.effectDefinitionIds = new Array(this.capacity).fill(null);
        this.indexByExactHandle = new Map();
        this.indexByEntityId = new Map();
        this.count = 0;
        this.pulseScheduleHeap = [];
        this.duePulseBacklog = [];
        this.sourceAuditIterator = null;
        this.maximumSourceAuditsPerFixedTick = Math.min(
            this.maximumPulseProgramsPerFixedTick,
            MAXIMUM_EFFECT_SOURCE_AUDITS_PER_FIXED_TICK
        );

        this.pendingBatchIdByTick = new Map();
        this.pendingBatchCountByTick = new Map();
        this.staleSubmittedCommandById = new Map();
        // 다른 GPU readback이 같은 fixed boundary를 보류하면 Effect owner는
        // 동일한 frozen completion snapshot을 그대로 replay합니다. Director가
        // 이미 적용한 snapshot을 다시 cadence mutation으로 해석하지 않습니다.
        this.observedCompletionSnapshots = new WeakSet();
        this.lastCompletedSourceTick = 0;
        this.lastStageResult = createEmptyStageResult();
        this.nextDueCursor = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.ingressCloseReason = null;
        this.terminalFinalFixedTick = 0;
        this.terminalFixedCommitObserved = false;
        this.terminalLifecycleObserved = false;
        this.terminalRosterSealed = false;
        this.destroyed = false;
        this.telemetry = {
            registered: 0,
            removed: 0,
            stagedBatchCount: 0,
            stagedPulseCount: 0,
            completedPulseCount: 0,
            duePulseCount: 0,
            quotaDeferredPulseCount: 0,
            maximumDuePulseCount: 0,
            maximumStagedPulseCount: 0,
            appliedPulseCount: 0,
            deferredPulseCount: 0,
            maxTargetsPerPulse: 0,
            maxConsecutiveDeferCount: 0,
            zeroTargetCompletionCount: 0,
            capacityRejectedStageCount: 0,
            capacityRejectedCompletionCount: 0,
            staleCompletionCount: 0,
            replayedStageCount: 0,
            capacityFeedbackBatchCount: 0,
            admissionLimitReductionCount: 0,
            admissionLimitIncreaseCount: 0,
            minimumPulseAdmissionLimit:
                this.maximumPulseProgramsPerFixedTick,
            currentPulseAdmissionLimit:
                this.maximumPulseProgramsPerFixedTick
        };
    }

    /** Exact lifecycle commit 결과만 사용해 SoA roster를 갱신합니다. */
    observeLifecycle(lifecycleResult = {}, fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.recoveryRequired) {
            return this.getStatus();
        }
        if (!this.ingressOpen) {
            return this.#observeTerminalLifecycle(lifecycleResult, tick);
        }
        if (lifecycleResult.recoveryRequired === true) {
            this.#fail(
                'effect-lifecycle-recovery',
                'recovery-required lifecycle result를 Effect roster에 적용할 수 없습니다.'
            );
            return this.getStatus();
        }
        const despawned = Array.isArray(lifecycleResult.despawned)
            ? lifecycleResult.despawned
            : [];
        const spawned = Array.isArray(lifecycleResult.spawned)
            ? lifecycleResult.spawned
            : [];
        try {
            for (const entry of despawned) {
                const handle = normalizeHandle(
                    entry?.handle,
                    'effectLifecycle.despawned.handle'
                );
                this.#removeExactHandle(handle);
            }
            for (const entry of spawned) {
                const handle = normalizeHandle(
                    entry?.handle,
                    'effectLifecycle.spawned.handle'
                );
                this.#registerIfEmitter(handle, tick);
            }
        } catch (error) {
            this.#fail(
                'effect-lifecycle-contract',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    /** GPU Effect completion으로만 sequence와 다음 cadence를 전진시킵니다. */
    observeCompletedEvents(snapshot = {}) {
        this.#assertUsable();
        if (!this.ingressOpen || this.recoveryRequired) {
            return this.getStatus();
        }
        let observationTick;
        try {
            observationTick = requirePositiveSafeInteger(
                snapshot.fixedTick,
                'effectCompletion.fixedTick'
            );
        } catch (error) {
            this.#fail(
                'effect-completion-cadence',
                String(error?.message ?? error)
            );
            return this.getStatus();
        }
        if (snapshot.protocolFailure) {
            this.#fail(
                snapshot.protocolFailure.code ?? 'effect-completion-protocol',
                snapshot.protocolFailure.message
                    ?? 'Effect completion protocol failure가 발생했습니다.'
            );
            return this.getStatus();
        }
        if (this.observedCompletionSnapshots.has(snapshot)) {
            return this.getStatus();
        }
        const results = Array.isArray(snapshot.results) ? snapshot.results : [];
        try {
            const completionPlans = [];
            const observedCommandIds = new Set();
            for (const result of results) {
                const sourceHandle = normalizeHandle(
                    result?.sourceHandle,
                    'effectCompletion.sourceHandle'
                );
                const sourceTick = requirePositiveSafeInteger(
                    result.sourceTick,
                    'effectCompletion.sourceTick'
                );
                if (sourceTick >= observationTick) {
                    throw new RangeError(
                        'Effect completion sourceTick은 관찰 fixedTick보다 과거여야 합니다.'
                    );
                }
                const pulseSequence = requireNonNegativeSafeInteger(
                    result.pulseSequence,
                    'effectCompletion.pulseSequence'
                );
                const expectedCommandId = createGpuEffectPulseCommandId(
                    this.sessionGeneration,
                    sourceTick,
                    sourceHandle,
                    pulseSequence
                );
                const resultCode = requireNonNegativeSafeInteger(
                    result.resultCode,
                    'effectCompletion.resultCode'
                );
                const candidateCount = requireNonNegativeSafeInteger(
                    result.candidateCount,
                    'effectCompletion.candidateCount'
                );
                const appliedCount = requireNonNegativeSafeInteger(
                    result.appliedCount,
                    'effectCompletion.appliedCount'
                );
                const applied = resultCode
                    === GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED;
                const zeroTarget = resultCode
                    === GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET;
                const sourceInvalid = resultCode
                    === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID;
                const deferredCapacity = resultCode
                    === GPU_EFFECT_PULSE_PROGRAM_RESULT.DEFERRED_CAPACITY;
                if (result.commandId !== expectedCommandId
                    || observedCommandIds.has(expectedCommandId)
                    || (!applied
                        && !zeroTarget
                        && !sourceInvalid
                        && !deferredCapacity)
                    || (applied
                        ? appliedCount <= 0 || candidateCount !== appliedCount
                        : deferredCapacity
                            ? appliedCount !== 0
                            : candidateCount !== 0 || appliedCount !== 0)) {
                    throw new RangeError(
                        `Effect completion result/code/count가 올바르지 않습니다: ${result.commandId}`
                    );
                }
                observedCommandIds.add(expectedCommandId);
                const index = this.indexByExactHandle.get(handleKey(sourceHandle));
                if (index === undefined) {
                    const staleProof = this.staleSubmittedCommandById.get(
                        expectedCommandId
                    );
                    if ((!sourceInvalid && !deferredCapacity)
                        || !staleProof
                        || staleProof.sourceTick !== sourceTick
                        || staleProof.pulseSequence !== pulseSequence
                        || handleKey(staleProof.sourceHandle)
                            !== handleKey(sourceHandle)) {
                        throw new RangeError(
                            'stale Effect completion에 exact submitted-despawn proof가 없습니다.'
                        );
                    }
                    completionPlans.push(Object.freeze({
                        kind: 'stale',
                        commandId: expectedCommandId,
                        sourceTick,
                        deferredCapacity,
                        candidateCount
                    }));
                    continue;
                }
                if (sourceInvalid
                    || this.pendingPhases[index] !== PULSE_PENDING_PHASE.SUBMITTED
                    || this.pendingTicks[index] !== sourceTick
                    || this.pulseSequences[index] !== pulseSequence) {
                    throw new RangeError(
                        `Effect completion이 pending cadence와 다릅니다: ${result.commandId}`
                    );
                }
                const profile = this.#readProfileAt(index);
                const nextSequence = deferredCapacity
                    ? pulseSequence
                    : pulseSequence + 1;
                const nextPulseTick = deferredCapacity
                    ? observationTick
                    : sourceTick + profile.pulseIntervalTicks;
                const consecutiveDeferCount = deferredCapacity
                    ? this.consecutiveDeferCounts[index] + 1
                    : 0;
                if (!Number.isSafeInteger(nextSequence)
                    || !Number.isSafeInteger(nextPulseTick)
                    || !Number.isSafeInteger(consecutiveDeferCount)
                    || consecutiveDeferCount > 0xffffffff) {
                    throw new RangeError('Effect pulse cadence 정수 공간이 고갈되었습니다.');
                }
                completionPlans.push(Object.freeze({
                    kind: 'active',
                    index,
                    sourceTick,
                    nextSequence,
                    nextPulseTick,
                    zeroTarget,
                    applied,
                    deferredCapacity,
                    candidateCount,
                    consecutiveDeferCount
                }));
            }
            for (const plan of completionPlans) {
                if (plan.kind === 'stale') {
                    this.staleSubmittedCommandById.delete(plan.commandId);
                    this.lastCompletedSourceTick = Math.max(
                        this.lastCompletedSourceTick,
                        plan.sourceTick
                    );
                    this.telemetry.staleCompletionCount++;
                    this.telemetry.maxTargetsPerPulse = Math.max(
                        this.telemetry.maxTargetsPerPulse,
                        plan.candidateCount
                    );
                    if (plan.deferredCapacity) {
                        this.telemetry.deferredPulseCount++;
                    }
                    continue;
                }
                this.pulseSequences[plan.index] = plan.nextSequence;
                this.pendingTicks[plan.index] = 0;
                this.pendingPhases[plan.index] = PULSE_PENDING_PHASE.NONE;
                this.consecutiveDeferCounts[plan.index]
                    = plan.consecutiveDeferCount;
                this.#schedulePulseAt(plan.index, plan.nextPulseTick);
                this.lastCompletedSourceTick = Math.max(
                    this.lastCompletedSourceTick,
                    plan.sourceTick
                );
                this.telemetry.completedPulseCount++;
                if (plan.zeroTarget) {
                    this.telemetry.zeroTargetCompletionCount++;
                }
                if (plan.applied) {
                    this.telemetry.appliedPulseCount++;
                }
                this.telemetry.maxTargetsPerPulse = Math.max(
                    this.telemetry.maxTargetsPerPulse,
                    plan.candidateCount
                );
                if (plan.deferredCapacity) {
                    this.telemetry.deferredPulseCount++;
                    this.telemetry.capacityRejectedCompletionCount++;
                    this.telemetry.maxConsecutiveDeferCount = Math.max(
                        this.telemetry.maxConsecutiveDeferCount,
                        plan.consecutiveDeferCount
                    );
                }
            }
            this.#applyCapacityFeedback(completionPlans);
            this.observedCompletionSnapshots.add(snapshot);
        } catch (error) {
            this.#fail(
                'effect-completion-cadence',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    /** 같은 tick due P를 한 batch로 보내되 GPU 결과는 pulse별 atomic입니다. */
    stageForFixedTick(options = {}) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(
            options.targetFixedTick,
            'targetFixedTick'
        );
        if (!this.ingressOpen) {
            return Object.freeze({
                accepted: false,
                targetFixedTick: tick,
                batchId: null,
                stagedCount: 0,
                reason: this.ingressCloseReason ?? 'effect-ingress-closed',
                recoveryRequired: false
            });
        }
        if (this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                targetFixedTick: tick,
                batchId: null,
                stagedCount: 0,
                reason: this.failure?.code ?? 'effect-runtime-recovery-required',
                recoveryRequired: true
            });
        }
        if (this.lastStageResult.accepted === false
            && this.lastStageResult.targetFixedTick === tick
            && [
                'effect-command-capacity',
                'effect-command-history-capacity'
            ].includes(this.lastStageResult.reason)) {
            this.telemetry.replayedStageCount++;
            return Object.freeze({
                ...this.lastStageResult,
                replayed: true
            });
        }

        const queuedBatchId = this.pendingBatchIdByTick.get(tick) ?? null;
        if (queuedBatchId !== null) {
            this.telemetry.replayedStageCount++;
            this.lastStageResult = Object.freeze({
                accepted: true,
                targetFixedTick: tick,
                batchId: queuedBatchId,
                stagedCount: this.pendingBatchCountByTick.get(tick) ?? 0,
                replayed: true,
                recoveryRequired: false
            });
            return this.lastStageResult;
        }

        let dueEntries;
        try {
            this.#auditSources(tick);
            dueEntries = mergeSortedPulseEntries(
                this.#takeDueBacklogEntries(tick),
                this.#takeDuePulseEntries(tick)
            );
        } catch (error) {
            this.#fail('effect-stage-preflight', String(error?.message ?? error));
            return this.stageForFixedTick({ targetFixedTick: tick });
        }
        if (dueEntries.length === 0) {
            this.lastStageResult = createEmptyStageResult(tick);
            return this.lastStageResult;
        }
        const stagedEntryLimit = Math.min(
            dueEntries.length,
            this.currentPulseProgramsPerFixedTick
        );
        const startCursor = dueEntries.length <= stagedEntryLimit
            ? 0
            : this.nextDueCursor % dueEntries.length;
        const stagedEntries = [];
        let deferredEntries;
        try {
            for (let offset = 0;
                offset < dueEntries.length
                    && stagedEntries.length
                        < this.currentPulseProgramsPerFixedTick;
                offset++) {
                const entry = dueEntries[
                    (startCursor + offset) % dueEntries.length
                ];
                const index = this.#resolveScheduledPulseIndex(entry);
                if (index < 0) {
                    continue;
                }
                const disposition = this.lastLivenessAuditTicks[index] === tick
                    ? 'active'
                    : this.#getExactLivenessDisposition(index);
                if (disposition === 'stale') {
                    this.#removeAt(index);
                    continue;
                }
                if (disposition === 'desync') {
                    throw new RangeError(
                        'Effect roster registry/backend identity가 불일치합니다.'
                    );
                }
                this.lastLivenessAuditTicks[index] = tick;
                entry.selectedForStage = true;
                stagedEntries.push(entry);
            }
            deferredEntries = [];
            for (const entry of dueEntries) {
                if (entry.selectedForStage) {
                    entry.selectedForStage = false;
                    continue;
                }
                const index = this.#resolveScheduledPulseIndex(entry);
                if (index >= 0) {
                    this.#deferPulseEntryAt(index, entry, tick + 1);
                    deferredEntries.push(entry);
                }
            }
            this.duePulseBacklog = deferredEntries;
        } catch (error) {
            this.#fail('effect-stage-preflight', String(error?.message ?? error));
            return this.stageForFixedTick({ targetFixedTick: tick });
        }
        const dueCount = stagedEntries.length + deferredEntries.length;
        if (dueCount === 0) {
            this.lastStageResult = createEmptyStageResult(tick);
            return this.lastStageResult;
        }
        this.telemetry.duePulseCount += dueCount;
        this.telemetry.maximumDuePulseCount = Math.max(
            this.telemetry.maximumDuePulseCount,
            dueCount
        );
        if (deferredEntries.length > 0) {
            this.telemetry.quotaDeferredPulseCount +=
                deferredEntries.length;
        }
        stagedEntries.sort(comparePulseIdentity);
        const commands = stagedEntries.map((entry) => {
            const index = this.#resolveScheduledPulseIndex(entry);
            if (index < 0) {
                throw new RangeError(
                    'Effect staged source schedule identity가 유실되었습니다.'
                );
            }
            const sourceHandle = Object.freeze({
                entityId: this.entityIds[index],
                incarnation: this.incarnations[index]
            });
            const pulseSequence = this.pulseSequences[index];
            return Object.freeze({
                commandId: createGpuEffectPulseCommandId(
                    this.sessionGeneration,
                    tick,
                    sourceHandle,
                    pulseSequence
                ),
                targetFixedTick: tick,
                sourceHandle,
                effectEmitterProfileId: this.profileIds[index],
                effectDefinitionId: this.effectDefinitionIds[index],
                pulseSequence
            });
        });
        const batchId = createGpuEffectPulseBatchId(
            this.sessionGeneration,
            tick,
            commands
        );
        const receipt = this.effectCommandPort.requestPulseBatch(
            Object.freeze({
                batchId,
                targetFixedTick: tick,
                commands: Object.freeze(commands)
            })
        );
        if (receipt?.accepted !== true
            || receipt.batchId !== batchId
            || receipt.targetFixedTick !== tick
            || receipt.queuedCount !== commands.length) {
            const retryableCapacity = receipt !== null
                && typeof receipt === 'object'
                && receipt.accepted === false
                && receipt.batchId === batchId
                && receipt.targetFixedTick === tick
                && receipt.queuedCount === 0
                && receipt.replayed === undefined
                && [
                    'accepted',
                    'batchId',
                    'queuedCount',
                    'reason',
                    'targetFixedTick'
                ].every((key) => Object.hasOwn(receipt, key))
                && Object.keys(receipt).length === 5
                && [
                    'effect-command-capacity',
                    'effect-command-history-capacity'
                ].includes(receipt.reason);
            if (retryableCapacity) {
                const retryEntries = [];
                for (const entry of stagedEntries) {
                    const index = this.#resolveScheduledPulseIndex(entry);
                    if (index >= 0) {
                        this.#deferPulseEntryAt(index, entry, tick + 1);
                        retryEntries.push(entry);
                    }
                }
                this.duePulseBacklog = mergeSortedPulseEntries(
                    this.duePulseBacklog,
                    retryEntries
                );
                this.telemetry.capacityRejectedStageCount++;
            } else if (receipt?.reason !== 'effect-command-port-revoked') {
                this.#fail(
                    receipt?.reason ?? 'effect-command-rejected',
                    'Effect owner가 whole-tick pulse batch를 거절했습니다.'
                );
            }
            this.lastStageResult = Object.freeze({
                accepted: false,
                targetFixedTick: tick,
                batchId,
                stagedCount: 0,
                reason: receipt?.reason ?? 'effect-command-rejected',
                replayed: false,
                recoveryRequired: this.recoveryRequired
            });
            return this.lastStageResult;
        }
        for (const entry of stagedEntries) {
            const index = this.#resolveScheduledPulseIndex(entry);
            if (index < 0) {
                this.#fail(
                    'effect-stage-pending',
                    'Effect accepted source schedule identity가 유실되었습니다.'
                );
                break;
            }
            this.pendingTicks[index] = tick;
            this.pendingPhases[index] = PULSE_PENDING_PHASE.QUEUED;
        }
        this.nextDueCursor = dueCount <= stagedEntries.length
            ? 0
            : (startCursor + stagedEntries.length) % dueCount;
        this.pendingBatchIdByTick.set(tick, batchId);
        this.pendingBatchCountByTick.set(tick, commands.length);
        this.telemetry.stagedBatchCount++;
        this.telemetry.stagedPulseCount += commands.length;
        this.telemetry.maximumStagedPulseCount = Math.max(
            this.telemetry.maximumStagedPulseCount,
            commands.length
        );
        this.lastStageResult = Object.freeze({
            accepted: true,
            targetFixedTick: tick,
            batchId,
            stagedCount: commands.length,
            replayed: receipt.replayed === true,
            recoveryRequired: false
        });
        return this.lastStageResult;
    }

    /** Endpoint lifecycle→fixed→effect commit 결과가 staged batch 전체와 같은지 검증합니다. */
    observeFixedCommit(lifecycleResult = {}, fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.recoveryRequired) {
            return this.getStatus();
        }
        if (!this.ingressOpen) {
            return this.#observeTerminalFixedCommit(lifecycleResult, tick);
        }
        const effectPrograms = lifecycleResult.effectPrograms ?? null;
        const expectedBatchId = this.pendingBatchIdByTick.get(tick) ?? null;
        const expectedCount = this.pendingBatchCountByTick.get(tick) ?? 0;
        const programs = Array.isArray(effectPrograms?.programs)
            ? effectPrograms.programs
            : [];
        try {
            if (expectedBatchId === null) {
                if (programs.length !== 0 || effectPrograms?.batchId) {
                    throw new RangeError('요청하지 않은 Effect program이 commit되었습니다.');
                }
                return this.getStatus();
            }
            if (lifecycleResult.recoveryRequired === true
                || effectPrograms?.recoveryRequired === true
                || effectPrograms?.state !== 'committed'
                || effectPrograms.batchId !== expectedBatchId
                || programs.length !== expectedCount) {
                throw new RangeError('Effect whole-tick commit evidence가 staged batch와 다릅니다.');
            }
            const observedCommandIds = new Set();
            for (const program of programs) {
                const sourceHandle = normalizeHandle(
                    program?.sourceHandle,
                    'effectProgram.sourceHandle'
                );
                const index = this.indexByExactHandle.get(handleKey(sourceHandle));
                if (index === undefined
                    || this.pendingPhases[index] !== PULSE_PENDING_PHASE.QUEUED
                    || this.pendingTicks[index] !== tick
                    || program.pulseSequence !== this.pulseSequences[index]) {
                    throw new RangeError('Effect program source/cadence가 roster와 다릅니다.');
                }
                const expectedCommandId = createGpuEffectPulseCommandId(
                    this.sessionGeneration,
                    tick,
                    sourceHandle,
                    this.pulseSequences[index]
                );
                if (program.commandId !== expectedCommandId
                    || observedCommandIds.has(program.commandId)) {
                    throw new RangeError('Effect program command identity가 중복 또는 불일치합니다.');
                }
                observedCommandIds.add(program.commandId);
                this.pendingPhases[index] = PULSE_PENDING_PHASE.SUBMITTED;
            }
            if (observedCommandIds.size !== expectedCount) {
                throw new RangeError('Effect program commit count가 정확하지 않습니다.');
            }
            this.pendingBatchIdByTick.delete(tick);
            this.pendingBatchCountByTick.delete(tick);
        } catch (error) {
            this.#fail(
                'effect-fixed-commit-evidence',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    closeForTerminal(finalFixedTick, reason = 'run-defeated') {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(finalFixedTick, 'finalFixedTick');
        if (this.terminalFinalFixedTick !== 0
            && this.terminalFinalFixedTick !== tick) {
            this.#fail(
                'effect-terminal-tick-mismatch',
                'Pentagon Effect terminal close tick replay가 다릅니다.'
            );
            return this.getStatus();
        }
        if (this.ingressOpen) {
            this.ingressOpen = false;
            this.ingressCloseReason = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated';
            this.terminalFinalFixedTick = tick;
            this.terminalFixedCommitObserved = false;
            this.terminalLifecycleObserved = false;
            this.terminalRosterSealed = false;
        }
        this.pendingBatchIdByTick.clear();
        this.pendingBatchCountByTick.clear();
        this.staleSubmittedCommandById.clear();
        for (let index = 0; index < this.count; index++) {
            this.pendingTicks[index] = 0;
            this.pendingPhases[index] = PULSE_PENDING_PHASE.NONE;
        }
        this.pulseScheduleHeap.length = 0;
        this.duePulseBacklog.length = 0;
        this.sourceAuditIterator = null;
        return Object.freeze({
            closed: true,
            reason: this.ingressCloseReason,
            finalFixedTick: tick
        });
    }

    resetGpuBinding() {
        this.#assertUsable();
        this.#clearRoster();
        this.pendingBatchIdByTick.clear();
        this.pendingBatchCountByTick.clear();
        this.staleSubmittedCommandById.clear();
        this.observedCompletionSnapshots = new WeakSet();
        this.lastCompletedSourceTick = 0;
        this.lastStageResult = createEmptyStageResult();
        this.nextDueCursor = 0;
        this.currentPulseProgramsPerFixedTick
            = this.maximumPulseProgramsPerFixedTick;
        this.telemetry.currentPulseAdmissionLimit
            = this.currentPulseProgramsPerFixedTick;
        this.recoveryRequired = false;
        this.failure = null;
        return true;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        let pendingPulseCount = 0;
        for (let index = 0; index < this.count; index++) {
            pendingPulseCount += this.pendingPhases[index] === PULSE_PENDING_PHASE.NONE
                ? 0
                : 1;
        }
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            capacity: this.capacity,
            activeEmitterCount: this.count,
            pendingPulseCount,
            pendingBatchCount: this.pendingBatchIdByTick.size,
            pendingStaleCompletionCount: this.staleSubmittedCommandById.size,
            lastCompletedSourceTick: this.lastCompletedSourceTick,
            maximumPulseProgramsPerFixedTick:
                this.maximumPulseProgramsPerFixedTick,
            currentPulseProgramsPerFixedTick:
                this.currentPulseProgramsPerFixedTick,
            nextDueCursor: this.nextDueCursor,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
            terminal: Object.freeze({
                finalFixedTick: this.terminalFinalFixedTick,
                fixedCommitObserved: this.terminalFixedCommitObserved,
                lifecycleObserved: this.terminalLifecycleObserved,
                rosterSealed: this.terminalRosterSealed
            }),
            lastStageResult: this.lastStageResult,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.ingressOpen = false;
        this.ingressCloseReason ??= 'destroyed';
        this.#clearRoster();
        this.pendingBatchIdByTick.clear();
        this.pendingBatchCountByTick.clear();
        this.staleSubmittedCommandById.clear();
        this.effectCommandPort = null;
        this.endpoint = null;
        this.registry = null;
        this.destroyed = true;
    }

    #registerIfEmitter(handle, fixedTick) {
        const registryHas = this.registry.has(handle);
        if (!registryHas) {
            throw new RangeError('spawned Effect source exact identity가 active하지 않습니다.');
        }
        const view = this.registry.copyEntityView(handle, {});
        const metadata = view?.metadata;
        if (!view || view.kindId !== 'enemy' || !metadata) {
            return false;
        }
        const isEmitter = hasEnemyCapability(
            metadata.capabilityMask,
            ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
            'effectSource.capabilityMask'
        );
        if (!isEmitter) {
            if (metadata.effectEmitterProfileId !== null
                && metadata.effectEmitterProfileId !== undefined) {
                throw new RangeError('비-Emitter enemy에 effect profile metadata가 있습니다.');
            }
            return false;
        }
        // Lifecycle에는 Formation transform destination처럼 host registry에 먼저
        // 공개되고 같은 GPU submit에서 body가 materialize되는 비-Emitter spawn도
        // 포함됩니다. Effect capability를 확인하기 전 backend parity를 강제하면
        // unrelated H transform을 Effect desync로 오판합니다. 실제 Emitter만
        // exact GPU body 존재를 요구해 roster authority를 유지합니다.
        if (!this.endpoint.hasBody(handle)) {
            throw new RangeError('spawned Effect source registry/backend identity가 불일치합니다.');
        }
        const profile = this.effectEmitterProfileById[
            metadata.effectEmitterProfileId
        ];
        const definition = profile
            ? this.effectDefinitionById[profile.effectDefinitionId]
            : null;
        if (!profile
            || !definition
            || metadata.effectEmitterDefinitionCode
                !== profile.emitterDefinitionCode
            || metadata.effectDefinitionId !== definition.id
            || metadata.effectDefinitionCode !== definition.effectDefinitionCode
            || profile.effectDefinitionCode !== definition.effectDefinitionCode
            || metadata.effectSelfTargetAllowed !== profile.selfTargetAllowed
            || metadata.effectPentaTargetAllowed !== profile.pentaTargetAllowed
            || metadata.effectClusterRetargetIntervalTicks
                !== profile.retargetIntervalTicks
            || metadata.effectTowerContactDamageModifiable
                !== definition.towerContactDamageEffectModifiable
            || metadata.effectProjectileTowerDamageModifiable
                !== definition.projectileTowerDamageEffectModifiable
            || metadata.effectDirectCoreImpactDamageModifiable
                !== definition.directCoreImpactDamageEffectModifiable
            || metadata.effectProjectileCoreDamageModifiable
                !== definition.typedProjectileCoreDamageEffectModifiable) {
            throw new RangeError('Effect source profile/definition metadata가 catalog와 다릅니다.');
        }
        const key = handleKey(handle);
        const existing = this.indexByExactHandle.get(key);
        if (existing !== undefined) {
            return true;
        }
        const existingEntityIndex = this.indexByEntityId.get(handle.entityId);
        if (existingEntityIndex !== undefined) {
            throw new RangeError('Effect roster entityId가 다른 incarnation으로 중복되었습니다.');
        }
        if (this.count >= this.capacity) {
            throw new RangeError('Pentagon Effect roster capacity를 초과했습니다.');
        }
        const nextPulseTick = fixedTick + profile.initialPulseDelayTicks;
        if (!Number.isSafeInteger(nextPulseTick)) {
            throw new RangeError('Effect initial pulse tick 정수 공간이 고갈되었습니다.');
        }
        const index = this.count++;
        this.entityIds[index] = handle.entityId;
        this.incarnations[index] = handle.incarnation;
        this.nextPulseTicks[index] = nextPulseTick;
        this.pulseSequences[index] = 0;
        this.pendingTicks[index] = 0;
        this.pendingPhases[index] = PULSE_PENDING_PHASE.NONE;
        this.consecutiveDeferCounts[index] = 0;
        this.scheduleVersions[index] = 0;
        this.lastLivenessAuditTicks[index] = 0;
        this.profileIds[index] = profile.id;
        this.effectDefinitionIds[index] = definition.id;
        this.indexByExactHandle.set(key, index);
        this.indexByEntityId.set(handle.entityId, index);
        this.#schedulePulseAt(index, nextPulseTick);
        this.telemetry.registered++;
        return true;
    }

    #removeExactHandle(handle) {
        const index = this.indexByExactHandle.get(handleKey(handle));
        if (index === undefined) {
            return false;
        }
        this.#removeAt(index);
        return true;
    }

    #removeAt(index) {
        const lastIndex = this.count - 1;
        const removedEntityId = this.entityIds[index];
        const removedHandle = Object.freeze({
            entityId: removedEntityId,
            incarnation: this.incarnations[index]
        });
        const removedKey = handleKey(removedHandle);
        if (this.pendingPhases[index] === PULSE_PENDING_PHASE.SUBMITTED) {
            const sourceTick = this.pendingTicks[index];
            const pulseSequence = this.pulseSequences[index];
            const commandId = createGpuEffectPulseCommandId(
                this.sessionGeneration,
                sourceTick,
                removedHandle,
                pulseSequence
            );
            if (!this.staleSubmittedCommandById.has(commandId)
                && this.staleSubmittedCommandById.size >= this.capacity) {
                throw new RangeError(
                    'stale submitted Effect provenance capacity를 초과했습니다.'
                );
            }
            this.staleSubmittedCommandById.set(commandId, Object.freeze({
                sourceHandle: removedHandle,
                sourceTick,
                pulseSequence
            }));
        }
        this.indexByExactHandle.delete(removedKey);
        this.indexByEntityId.delete(removedEntityId);
        if (index !== lastIndex) {
            this.entityIds[index] = this.entityIds[lastIndex];
            this.incarnations[index] = this.incarnations[lastIndex];
            this.nextPulseTicks[index] = this.nextPulseTicks[lastIndex];
            this.pulseSequences[index] = this.pulseSequences[lastIndex];
            this.pendingTicks[index] = this.pendingTicks[lastIndex];
            this.pendingPhases[index] = this.pendingPhases[lastIndex];
            this.consecutiveDeferCounts[index]
                = this.consecutiveDeferCounts[lastIndex];
            this.scheduleVersions[index] = this.scheduleVersions[lastIndex];
            this.lastLivenessAuditTicks[index]
                = this.lastLivenessAuditTicks[lastIndex];
            this.profileIds[index] = this.profileIds[lastIndex];
            this.effectDefinitionIds[index] = this.effectDefinitionIds[lastIndex];
            const movedKey = `${this.entityIds[index]}:${this.incarnations[index]}`;
            this.indexByExactHandle.set(movedKey, index);
            this.indexByEntityId.set(this.entityIds[index], index);
        }
        this.entityIds[lastIndex] = 0;
        this.incarnations[lastIndex] = 0;
        this.nextPulseTicks[lastIndex] = 0;
        this.pulseSequences[lastIndex] = 0;
        this.pendingTicks[lastIndex] = 0;
        this.pendingPhases[lastIndex] = PULSE_PENDING_PHASE.NONE;
        this.consecutiveDeferCounts[lastIndex] = 0;
        this.scheduleVersions[lastIndex] = 0;
        this.lastLivenessAuditTicks[lastIndex] = 0;
        this.profileIds[lastIndex] = null;
        this.effectDefinitionIds[lastIndex] = null;
        this.count--;
        this.telemetry.removed++;
    }

    #getExactDisposition(index) {
        const livenessDisposition = this.#getExactLivenessDisposition(index);
        if (livenessDisposition !== 'active') {
            return livenessDisposition;
        }
        const handle = {
            entityId: this.entityIds[index],
            incarnation: this.incarnations[index]
        };
        const profile = this.#readProfileAt(index);
        const definition = this.effectDefinitionById[
            this.effectDefinitionIds[index]
        ];
        const view = this.registry.copyEntityView(handle, {});
        const metadata = view?.metadata;
        if (!view
            || !metadata
            || metadata.effectEmitterProfileId !== profile.id
            || metadata.effectEmitterDefinitionCode !== profile.emitterDefinitionCode
            || metadata.effectDefinitionId !== definition?.id
            || metadata.effectDefinitionCode !== definition?.effectDefinitionCode
            || metadata.effectSelfTargetAllowed !== profile.selfTargetAllowed
            || metadata.effectPentaTargetAllowed !== profile.pentaTargetAllowed
            || metadata.effectClusterRetargetIntervalTicks
                !== profile.retargetIntervalTicks
            || metadata.effectTowerContactDamageModifiable
                !== definition?.towerContactDamageEffectModifiable
            || metadata.effectProjectileTowerDamageModifiable
                !== definition?.projectileTowerDamageEffectModifiable
            || metadata.effectDirectCoreImpactDamageModifiable
                !== definition?.directCoreImpactDamageEffectModifiable
            || metadata.effectProjectileCoreDamageModifiable
                !== definition?.typedProjectileCoreDamageEffectModifiable) {
            return 'desync';
        }
        return 'active';
    }

    #getExactLivenessDisposition(index) {
        const handle = {
            entityId: this.entityIds[index],
            incarnation: this.incarnations[index]
        };
        const registryHas = this.registry.has(handle);
        const backendHas = this.endpoint.hasBody(handle);
        if (registryHas !== backendHas) {
            return 'desync';
        }
        return registryHas ? 'active' : 'stale';
    }

    #readProfileAt(index) {
        const profile = this.effectEmitterProfileById[this.profileIds[index]];
        if (!profile) {
            throw new RangeError('Effect roster profile이 catalog에 없습니다.');
        }
        return profile;
    }

    #applyCapacityFeedback(completionPlans) {
        const feedbackBySourceTick = new Map();
        for (const plan of completionPlans) {
            if (plan.kind !== 'active' && !plan.deferredCapacity) {
                continue;
            }
            let feedback = feedbackBySourceTick.get(plan.sourceTick);
            if (feedback === undefined) {
                feedback = {
                    admittedCount: 0,
                    deferredCapacityCount: 0
                };
                feedbackBySourceTick.set(plan.sourceTick, feedback);
            }
            if (plan.deferredCapacity) {
                feedback.deferredCapacityCount++;
            } else {
                feedback.admittedCount++;
            }
        }
        const sourceTicks = Array.from(feedbackBySourceTick.keys())
            .sort((left, right) => left - right);
        for (const sourceTick of sourceTicks) {
            const feedback = feedbackBySourceTick.get(sourceTick);
            const currentLimit = this.currentPulseProgramsPerFixedTick;
            this.telemetry.capacityFeedbackBatchCount++;
            if (feedback.deferredCapacityCount > 0) {
                const nextLimit = Math.max(
                    1,
                    Math.min(currentLimit, feedback.admittedCount)
                );
                if (nextLimit < currentLimit) {
                    this.currentPulseProgramsPerFixedTick = nextLimit;
                    this.telemetry.admissionLimitReductionCount++;
                    this.telemetry.minimumPulseAdmissionLimit = Math.min(
                        this.telemetry.minimumPulseAdmissionLimit,
                        nextLimit
                    );
                }
            } else if (feedback.admittedCount >= currentLimit
                && currentLimit < this.maximumPulseProgramsPerFixedTick) {
                this.currentPulseProgramsPerFixedTick = currentLimit + 1;
                this.telemetry.admissionLimitIncreaseCount++;
            }
        }
        this.telemetry.currentPulseAdmissionLimit
            = this.currentPulseProgramsPerFixedTick;
    }

    #clearRoster() {
        this.entityIds.fill(0);
        this.incarnations.fill(0);
        this.nextPulseTicks.fill(0);
        this.pulseSequences.fill(0);
        this.pendingTicks.fill(0);
        this.pendingPhases.fill(PULSE_PENDING_PHASE.NONE);
        this.consecutiveDeferCounts.fill(0);
        this.scheduleVersions.fill(0);
        this.lastLivenessAuditTicks.fill(0);
        this.profileIds.fill(null);
        this.effectDefinitionIds.fill(null);
        this.indexByExactHandle.clear();
        this.indexByEntityId.clear();
        this.pulseScheduleHeap.length = 0;
        this.duePulseBacklog.length = 0;
        this.sourceAuditIterator = null;
        this.count = 0;
        this.nextDueCursor = 0;
    }

    #schedulePulseAt(index, nextPulseTick) {
        const tick = requirePositiveSafeInteger(
            nextPulseTick,
            'nextPulseTick'
        );
        const previousVersion = this.scheduleVersions[index];
        if (!Number.isSafeInteger(previousVersion)
            || previousVersion >= Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Effect pulse schedule version 공간이 고갈되었습니다.');
        }
        const version = previousVersion + 1;
        const entityId = this.entityIds[index];
        const incarnation = this.incarnations[index];
        const pulseSequence = this.pulseSequences[index];
        this.nextPulseTicks[index] = tick;
        this.scheduleVersions[index] = version;
        const entry = {};
        entry.key = `${entityId}:${incarnation}`;
        entry.entityId = entityId;
        entry.incarnation = incarnation;
        entry.pulseSequence = pulseSequence;
        entry.nextPulseTick = tick;
        entry.version = version;
        entry.selectedForStage = false;
        pushMinHeap(
            this.pulseScheduleHeap,
            entry,
            comparePulseScheduleEntry
        );
    }

    #deferPulseEntryAt(index, entry, nextPulseTick) {
        const tick = requirePositiveSafeInteger(
            nextPulseTick,
            'nextPulseTick'
        );
        this.nextPulseTicks[index] = tick;
        entry.nextPulseTick = tick;
    }

    #resolveScheduledPulseIndex(entry) {
        const index = this.indexByExactHandle.get(entry.key);
        return index !== undefined
            && this.scheduleVersions[index] === entry.version
            && this.pendingPhases[index] === PULSE_PENDING_PHASE.NONE
            && this.nextPulseTicks[index] === entry.nextPulseTick
            && this.pulseSequences[index] === entry.pulseSequence
            && this.entityIds[index] === entry.entityId
            && this.incarnations[index] === entry.incarnation
            ? index
            : -1;
    }

    #takeDuePulseEntries(fixedTick) {
        const dueEntries = [];
        while (this.pulseScheduleHeap.length > 0) {
            const entry = this.pulseScheduleHeap[0];
            if (this.#resolveScheduledPulseIndex(entry) < 0) {
                popMinHeap(
                    this.pulseScheduleHeap,
                    comparePulseScheduleEntry
                );
                continue;
            }
            if (entry.nextPulseTick < fixedTick) {
                throw new RangeError(
                    `Effect pulse cadence를 지나쳤습니다: ${entry.nextPulseTick}/${fixedTick}`
                );
            }
            if (entry.nextPulseTick > fixedTick) {
                break;
            }
            dueEntries.push(popMinHeap(
                this.pulseScheduleHeap,
                comparePulseScheduleEntry
            ));
        }
        return dueEntries;
    }

    #takeDueBacklogEntries(fixedTick) {
        const entries = this.duePulseBacklog;
        this.duePulseBacklog = [];
        for (const entry of entries) {
            if (entry.nextPulseTick !== fixedTick) {
                throw new RangeError(
                    `Effect pulse backlog cadence가 다릅니다: ${entry.nextPulseTick}/${fixedTick}`
                );
            }
        }
        return entries;
    }

    #auditSources(fixedTick) {
        const auditCount = Math.min(
            this.count,
            this.maximumSourceAuditsPerFixedTick
        );
        if (auditCount === 0) {
            this.sourceAuditIterator = null;
            return;
        }
        if (this.sourceAuditIterator === null) {
            this.sourceAuditIterator = this.indexByExactHandle.keys();
        }
        for (let offset = 0; offset < auditCount; offset++) {
            const next = this.sourceAuditIterator.next();
            if (next.done) {
                this.sourceAuditIterator = null;
                break;
            }
            const index = this.indexByExactHandle.get(next.value);
            if (index === undefined) {
                continue;
            }
            const disposition = this.#getExactDisposition(index);
            if (disposition === 'desync') {
                throw new RangeError(
                    'Effect roster registry/backend identity가 불일치합니다.'
                );
            }
            if (disposition === 'stale') {
                this.#removeAt(index);
                continue;
            }
            this.lastLivenessAuditTicks[index] = fixedTick;
        }
    }

    #observeTerminalFixedCommit(lifecycleResult, fixedTick) {
        try {
            if (this.terminalFinalFixedTick !== fixedTick
                || this.terminalFixedCommitObserved
                || this.terminalRosterSealed) {
                throw new RangeError(
                    'terminal Effect fixed commit은 final tick에 정확히 한 번만 관찰해야 합니다.'
                );
            }
            const effectPrograms = lifecycleResult?.effectPrograms;
            const programs = Array.isArray(effectPrograms?.programs)
                ? effectPrograms.programs
                : [];
            if (lifecycleResult?.fixedTick !== fixedTick
                || lifecycleResult?.recoveryRequired === true
                || effectPrograms?.recoveryRequired === true
                || effectPrograms?.state !== 'committed'
                || effectPrograms?.batchId !== null
                || programs.length !== 0) {
                throw new RangeError(
                    'terminal final commit에 신규 Effect program이 존재합니다.'
                );
            }
            this.terminalFixedCommitObserved = true;
        } catch (error) {
            this.#fail(
                'effect-terminal-fixed-commit',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    #observeTerminalLifecycle(lifecycleResult, fixedTick) {
        try {
            if (this.terminalFinalFixedTick !== fixedTick
                || !this.terminalFixedCommitObserved
                || this.terminalLifecycleObserved
                || this.terminalRosterSealed) {
                throw new RangeError(
                    'terminal Effect lifecycle은 final fixed commit 후 정확히 한 번만 관찰해야 합니다.'
                );
            }
            const spawned = Array.isArray(lifecycleResult?.spawned)
                ? lifecycleResult.spawned
                : [];
            const despawned = Array.isArray(lifecycleResult?.despawned)
                ? lifecycleResult.despawned
                : [];
            if (lifecycleResult?.fixedTick !== fixedTick
                || lifecycleResult?.recoveryRequired === true
                || spawned.length !== 0) {
                throw new RangeError(
                    'terminal final lifecycle은 신규 spawn 없이 commit되어야 합니다.'
                );
            }
            const handles = [];
            const observedKeys = new Set();
            for (const entry of despawned) {
                const handle = normalizeHandle(
                    entry?.handle,
                    'terminalEffectLifecycle.despawned.handle'
                );
                const key = handleKey(handle);
                if (observedKeys.has(key)) {
                    throw new RangeError(
                        'terminal final lifecycle despawn exact identity가 중복되었습니다.'
                    );
                }
                if (this.registry.has(handle) || this.endpoint.hasBody(handle)) {
                    throw new RangeError(
                        'terminal final lifecycle despawn이 registry/backend에 exact commit되지 않았습니다.'
                    );
                }
                observedKeys.add(key);
                handles.push(handle);
            }
            for (let index = 0; index < this.count; index++) {
                const key = `${this.entityIds[index]}:${this.incarnations[index]}`;
                if (!observedKeys.has(key)
                    && this.#getExactDisposition(index) !== 'active') {
                    throw new RangeError(
                        'terminal final lifecycle에 누락된 stale/desynced Effect source가 있습니다.'
                    );
                }
            }
            for (const handle of handles) {
                this.#removeExactHandle(handle);
            }
            this.terminalLifecycleObserved = true;
            this.terminalRosterSealed = true;
        } catch (error) {
            this.#fail(
                'effect-terminal-lifecycle',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    #fail(code, message) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            stage: 'pentagon-effect-director',
            code,
            name: 'PentagonEffectDirectorProtocolViolation',
            message
        });
        return this.failure;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 PentagonEffectDirector는 사용할 수 없습니다.');
        }
    }
}
