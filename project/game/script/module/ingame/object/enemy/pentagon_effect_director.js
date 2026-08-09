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

        this.entityIds = new Uint32Array(this.capacity);
        this.incarnations = new Uint32Array(this.capacity);
        this.nextPulseTicks = new Float64Array(this.capacity);
        this.pulseSequences = new Float64Array(this.capacity);
        this.pendingTicks = new Float64Array(this.capacity);
        this.pendingPhases = new Uint8Array(this.capacity);
        this.profileIds = new Array(this.capacity).fill(null);
        this.effectDefinitionIds = new Array(this.capacity).fill(null);
        this.indexByExactHandle = new Map();
        this.indexByEntityId = new Map();
        this.count = 0;

        this.pendingBatchIdByTick = new Map();
        this.pendingBatchCountByTick = new Map();
        this.staleSubmittedCommandById = new Map();
        this.lastCompletedSourceTick = 0;
        this.lastStageResult = createEmptyStageResult();
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
            zeroTargetCompletionCount: 0,
            capacityRejectedStageCount: 0,
            capacityRejectedCompletionCount: 0,
            staleCompletionCount: 0,
            replayedStageCount: 0
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
                const capacityRejected = resultCode
                    === GPU_EFFECT_PULSE_PROGRAM_RESULT.CAPACITY_REJECTED;
                if (result.commandId !== expectedCommandId
                    || observedCommandIds.has(expectedCommandId)
                    || (!applied
                        && !zeroTarget
                        && !sourceInvalid
                        && !capacityRejected)
                    || (applied
                        ? appliedCount <= 0 || candidateCount !== appliedCount
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
                    if ((!sourceInvalid && !capacityRejected)
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
                        capacityRejected
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
                const nextSequence = capacityRejected
                    ? pulseSequence
                    : pulseSequence + 1;
                const nextPulseTick = capacityRejected
                    ? observationTick
                    : sourceTick + profile.pulseIntervalTicks;
                if (!Number.isSafeInteger(nextSequence)
                    || !Number.isSafeInteger(nextPulseTick)) {
                    throw new RangeError('Effect pulse cadence 정수 공간이 고갈되었습니다.');
                }
                completionPlans.push(Object.freeze({
                    kind: 'active',
                    index,
                    sourceTick,
                    nextSequence,
                    nextPulseTick,
                    zeroTarget,
                    capacityRejected
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
                    if (plan.capacityRejected) {
                        this.telemetry.capacityRejectedCompletionCount++;
                    }
                    continue;
                }
                this.pulseSequences[plan.index] = plan.nextSequence;
                this.nextPulseTicks[plan.index] = plan.nextPulseTick;
                this.pendingTicks[plan.index] = 0;
                this.pendingPhases[plan.index] = PULSE_PENDING_PHASE.NONE;
                this.lastCompletedSourceTick = Math.max(
                    this.lastCompletedSourceTick,
                    plan.sourceTick
                );
                this.telemetry.completedPulseCount++;
                if (plan.zeroTarget) {
                    this.telemetry.zeroTargetCompletionCount++;
                }
                if (plan.capacityRejected) {
                    this.telemetry.capacityRejectedCompletionCount++;
                }
            }
        } catch (error) {
            this.#fail(
                'effect-completion-cadence',
                String(error?.message ?? error)
            );
        }
        return this.getStatus();
    }

    /** 같은 tick의 모든 due P를 한 번의 atomic batch로만 요청합니다. */
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

        const dueIndexes = [];
        try {
            for (let index = 0; index < this.count;) {
                const disposition = this.#getExactDisposition(index);
                if (disposition === 'stale') {
                    this.#removeAt(index);
                    continue;
                }
                if (disposition === 'desync') {
                    throw new RangeError('Effect roster registry/backend identity가 불일치합니다.');
                }
                if (this.pendingPhases[index] === PULSE_PENDING_PHASE.NONE) {
                    if (this.nextPulseTicks[index] < tick) {
                        throw new RangeError(
                            `Effect pulse cadence를 지나쳤습니다: ${this.nextPulseTicks[index]}/${tick}`
                        );
                    }
                    if (this.nextPulseTicks[index] === tick) {
                        dueIndexes.push(index);
                    }
                }
                index++;
            }
        } catch (error) {
            this.#fail('effect-stage-preflight', String(error?.message ?? error));
            return this.stageForFixedTick({ targetFixedTick: tick });
        }
        if (dueIndexes.length === 0) {
            this.lastStageResult = createEmptyStageResult(tick);
            return this.lastStageResult;
        }
        dueIndexes.sort((left, right) => (
            this.entityIds[left] - this.entityIds[right]
                || this.incarnations[left] - this.incarnations[right]
                || this.pulseSequences[left] - this.pulseSequences[right]
        ));
        const commands = dueIndexes.map((index) => {
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
                for (const index of dueIndexes) {
                    this.nextPulseTicks[index] = tick + 1;
                }
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
        for (const index of dueIndexes) {
            this.pendingTicks[index] = tick;
            this.pendingPhases[index] = PULSE_PENDING_PHASE.QUEUED;
        }
        this.pendingBatchIdByTick.set(tick, batchId);
        this.pendingBatchCountByTick.set(tick, commands.length);
        this.telemetry.stagedBatchCount++;
        this.telemetry.stagedPulseCount += commands.length;
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
        this.lastCompletedSourceTick = 0;
        this.lastStageResult = createEmptyStageResult();
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
        const backendHas = this.endpoint.hasBody(handle);
        if (registryHas !== backendHas) {
            throw new RangeError('spawned Effect source registry/backend identity가 불일치합니다.');
        }
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
        this.profileIds[index] = profile.id;
        this.effectDefinitionIds[index] = definition.id;
        this.indexByExactHandle.set(key, index);
        this.indexByEntityId.set(handle.entityId, index);
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
        this.profileIds[lastIndex] = null;
        this.effectDefinitionIds[lastIndex] = null;
        this.count--;
        this.telemetry.removed++;
    }

    #getExactDisposition(index) {
        const handle = {
            entityId: this.entityIds[index],
            incarnation: this.incarnations[index]
        };
        const registryHas = this.registry.has(handle);
        const backendHas = this.endpoint.hasBody(handle);
        if (registryHas !== backendHas) {
            return 'desync';
        }
        if (!registryHas) {
            return 'stale';
        }
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

    #readProfileAt(index) {
        const profile = this.effectEmitterProfileById[this.profileIds[index]];
        if (!profile) {
            throw new RangeError('Effect roster profile이 catalog에 없습니다.');
        }
        return profile;
    }

    #clearRoster() {
        this.entityIds.fill(0);
        this.incarnations.fill(0);
        this.nextPulseTicks.fill(0);
        this.pulseSequences.fill(0);
        this.pendingTicks.fill(0);
        this.pendingPhases.fill(PULSE_PENDING_PHASE.NONE);
        this.profileIds.fill(null);
        this.effectDefinitionIds.fill(null);
        this.indexByExactHandle.clear();
        this.indexByEntityId.clear();
        this.count = 0;
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
