import {
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    GPU_CIRCLE_BODY_COLLISION_LAYER
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_EVENT_TYPE,
    GPU_EFFECT_PULSE_PROGRAM_FLAG,
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_PULSE_PROGRAM_RESULT,
    GPU_EFFECT_RUNTIME_STATUS,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_effect_runtime_abi.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 256;
const DEFAULT_HISTORY_CAPACITY = 65536;
const DEFAULT_COMPLETION_BATCH_CAPACITY = 256;
const NORMAL_COMPLETION_RESULTS = new Set([
    GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED,
    GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET,
    GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID
]);
const VALID_EFFECT_EVENT_TYPES = new Set(Object.values(GPU_EFFECT_EVENT_TYPE));

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number <= 0
        || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < 0
        || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 0 이상의 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || !(number > 0)) {
        throw new RangeError(`${label}은 양의 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new RangeError(`${label}은 유한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function requireInt32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < -0x80000000
        || number > 0x7fffffff) {
        throw new RangeError(`${label}은 int32 정수여야 합니다.`);
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

function compareCommands(left, right) {
    return left.sourceHandle.entityId - right.sourceHandle.entityId
        || left.sourceHandle.incarnation - right.sourceHandle.incarnation
        || left.pulseSequence - right.pulseSequence;
}

function stableFingerprint(value, ancestors = new Set()) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (ancestors.has(value)) {
        throw new TypeError('effect command payload에 순환 참조가 있습니다.');
    }
    ancestors.add(value);
    let fingerprint;
    if (Array.isArray(value)) {
        fingerprint = `[${value.map((entry) => (
            stableFingerprint(entry, ancestors)
        )).join(',')}]`;
    } else {
        const keys = Object.keys(value).sort();
        fingerprint = `{${keys.map((key) => (
            `${JSON.stringify(key)}:${stableFingerprint(value[key], ancestors)}`
        )).join(',')}}`;
    }
    ancestors.delete(value);
    return fingerprint;
}

function createNonZeroUint32Fingerprint(value) {
    const source = typeof value === 'string' ? value : stableFingerprint(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index++) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    const result = hash >>> 0;
    return result === 0 || result === INVALID_HANDLE_COMPONENT ? 1 : result;
}

function createPulseProgramFlags(profile, definition) {
    let flags = 0;
    if (profile.selfTargetAllowed) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.SELF_TARGET_ALLOWED;
    }
    if (profile.pentaTargetAllowed) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.PENTA_TARGET_ALLOWED;
    }
    if (definition.towerContactDamageEffectModifiable) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.TOWER_CONTACT_DAMAGE_MODIFIABLE;
    }
    if (definition.projectileTowerDamageEffectModifiable) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_TOWER_DAMAGE_MODIFIABLE;
    }
    if (definition.directCoreImpactDamageEffectModifiable) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.DIRECT_CORE_IMPACT_DAMAGE_MODIFIABLE;
    }
    if (definition.typedProjectileCoreDamageEffectModifiable) {
        flags |= GPU_EFFECT_PULSE_PROGRAM_FLAG.PROJECTILE_CORE_DAMAGE_MODIFIABLE;
    }
    return flags >>> 0;
}

function assertPlainLookup(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} lookup 객체가 필요합니다.`);
    }
    return source;
}

function assertBackend(backend) {
    for (const methodName of [
        'hasBody',
        'stageEffectPulseProgramBatch',
        'drainCompletedEffectProgramBatches',
        'cancelPendingEffectProgramsForTerminal',
        'getEffectRuntimeStatus',
        'getEventProtocolState'
    ]) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`effect command backend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function assertRegistry(registry) {
    for (const methodName of ['has', 'copyEntityView']) {
        if (typeof registry?.[methodName] !== 'function') {
            throw new TypeError(`effect command registry.${methodName}()가 필요합니다.`);
        }
    }
    return registry;
}

function normalizeProtocol(source, label) {
    const sessionGeneration = Number(source?.sessionGeneration);
    const deviceGeneration = Number(source?.deviceGeneration);
    const authoritativeEpoch = Number(source?.authoritativeEpoch);
    if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration <= 0
        || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0
        || !Number.isSafeInteger(authoritativeEpoch) || authoritativeEpoch < 0) {
        throw new RangeError(`${label} generation/epoch가 유효하지 않습니다.`);
    }
    return Object.freeze({
        sessionGeneration,
        deviceGeneration,
        authoritativeEpoch
    });
}

function protocolKey(protocol) {
    return [
        protocol.sessionGeneration,
        protocol.deviceGeneration,
        protocol.authoritativeEpoch
    ].join(':');
}

function sameProtocol(left, right) {
    return left.sessionGeneration === right.sessionGeneration
        && left.deviceGeneration === right.deviceGeneration
        && left.authoritativeEpoch === right.authoritativeEpoch;
}

function compareProtocolGeneration(left, right) {
    if (left.sessionGeneration !== right.sessionGeneration) {
        return left.sessionGeneration < right.sessionGeneration ? -1 : 1;
    }
    if (left.deviceGeneration !== right.deviceGeneration) {
        return left.deviceGeneration < right.deviceGeneration ? -1 : 1;
    }
    if (left.authoritativeEpoch !== right.authoritativeEpoch) {
        return left.authoritativeEpoch < right.authoritativeEpoch ? -1 : 1;
    }
    return 0;
}

function createEmptyCompletionSnapshot(fixedTick = 0, completedThroughTick = 0) {
    return Object.freeze({
        fixedTick,
        completedThroughTick,
        batchCount: 0,
        results: Object.freeze([]),
        events: Object.freeze([]),
        staleBatchCount: 0,
        protocolFailure: null
    });
}

/** Stable public pulse command identity입니다. */
export function createGpuEffectPulseCommandId(
    sessionGeneration,
    targetFixedTick,
    sourceHandle,
    pulseSequence
) {
    const session = requirePositiveSafeInteger(
        sessionGeneration,
        'sessionGeneration'
    );
    const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
    const handle = normalizeHandle(sourceHandle, 'sourceHandle');
    const sequence = requireNonNegativeSafeInteger(
        pulseSequence,
        'pulseSequence'
    );
    return [
        'effect-pulse',
        session,
        tick,
        handle.entityId,
        handle.incarnation,
        sequence
    ].join(':');
}

/** Ordered exact source list 전체를 포함하는 whole-tick batch identity입니다. */
export function createGpuEffectPulseBatchId(
    sessionGeneration,
    targetFixedTick,
    commands
) {
    const session = requirePositiveSafeInteger(
        sessionGeneration,
        'sessionGeneration'
    );
    const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
    if (!Array.isArray(commands) || commands.length === 0) {
        throw new TypeError('effect pulse batch에는 하나 이상의 command가 필요합니다.');
    }
    const orderedIdentity = commands.map((command, index) => {
        const handle = normalizeHandle(
            command?.sourceHandle,
            `commands[${index}].sourceHandle`
        );
        return [
            handle.entityId,
            handle.incarnation,
            requireNonNegativeSafeInteger(
                command?.pulseSequence,
                `commands[${index}].pulseSequence`
            )
        ];
    });
    const fingerprint = createNonZeroUint32Fingerprint(orderedIdentity)
        .toString(16)
        .padStart(8, '0');
    return `effect-pulse-batch:${session}:${tick}:${fingerprint}`;
}

/**
 * Endpoint가 소유하는 bounded generic Effect command/replay/completion owner입니다.
 * Pentagon 정책은 알지 못하며 catalog primitive를 GPU program으로 한 번 materialize합니다.
 */
export class GpuEffectCommandOwner {
    #lifecycleCommitProofPort;

    constructor(backend, registry, options = {}) {
        this.backend = assertBackend(backend);
        this.registry = assertRegistry(registry);
        const lifecycleCommitProofPort = options.lifecycleCommitProofPort ?? null;
        if (lifecycleCommitProofPort !== null
            && typeof lifecycleCommitProofPort?.isAuthenticCommit !== 'function') {
            throw new TypeError(
                'lifecycleCommitProofPort.isAuthenticCommit()가 필요합니다.'
            );
        }
        this.#lifecycleCommitProofPort = lifecycleCommitProofPort;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.effectEmitterProfileById = assertPlainLookup(
            options.effectEmitterProfileById,
            'effectEmitterProfileById'
        );
        this.effectDefinitionById = assertPlainLookup(
            options.effectDefinitionById,
            'effectDefinitionById'
        );
        this.commandCapacity = requirePositiveSafeInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'effectCommandCapacity'
        );
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'effectCommandHistoryCapacity'
        );
        this.completionBatchCapacity = requirePositiveSafeInteger(
            options.completionBatchCapacity ?? DEFAULT_COMPLETION_BATCH_CAPACITY,
            'effectCompletionBatchCapacity'
        );
        this.pendingBatchByTick = new Map();
        this.inFlightBatchByTick = new Map();
        this.knownBatchById = new Map();
        this.knownCommandById = new Map();
        this.completedHistory = [];
        this.completedHistoryHead = 0;
        this.deferredCompletionBatches = [];
        this.completionScratch = [];
        this.knownCompletionBatchFingerprints = new Map();
        this.completedBatchKeys = [];
        this.completedBatchKeyHead = 0;
        this.lastCompletionSourceTick = 0;
        this.lastCompletionSubmittedTick = 0;
        this.lastCompletionProtocolKey = null;
        this.completedThroughTick = 0;
        this.lastCommitResult = null;
        this.lastCompletionResult = createEmptyCompletionSnapshot();
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.ingressCloseReason = null;
        this.terminalCancelResult = null;
        this.destroyed = false;
        this.telemetry = {
            requestedBatchCount: 0,
            requestedProgramCount: 0,
            replayedBatchCount: 0,
            completedBatchCount: 0,
            completedProgramCount: 0,
            zeroTargetCount: 0,
            sourceInvalidCount: 0,
            staleBatchCount: 0,
            conflictCount: 0,
            capacityRejectedCount: 0
        };
        const portState = { revoked: false };
        this.portState = portState;
        this.commandPort = Object.freeze({
            requestPulseBatch: (batch) => {
                if (portState.revoked || this.destroyed) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'effect-command-port-revoked'
                    });
                }
                return this.requestPulseBatch(batch);
            }
        });
    }

    getCommandPort() {
        return this.commandPort;
    }

    requestPulseBatch(source) {
        this.#assertUsable();
        if (!this.ingressOpen) {
            return Object.freeze({
                accepted: false,
                reason: this.ingressCloseReason ?? 'effect-ingress-closed'
            });
        }
        if (this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                reason: 'effect-runtime-recovery-required'
            });
        }

        const claimedBatchId = typeof source?.batchId === 'string'
            ? source.batchId
            : null;
        let normalized;
        try {
            normalized = this.#normalizeRequestedBatch(source);
        } catch (error) {
            if (claimedBatchId !== null
                && this.knownBatchById.has(claimedBatchId)) {
                return this.#failRequest(
                    'effect-batch-replay-conflict',
                    claimedBatchId
                );
            }
            return Object.freeze({
                accepted: false,
                reason: 'effect-pulse-batch-contract',
                message: String(error?.message ?? error)
            });
        }

        const knownBatch = this.knownBatchById.get(normalized.batchId);
        if (knownBatch) {
            if (knownBatch.fingerprint !== normalized.fingerprint) {
                return this.#failRequest(
                    'effect-batch-replay-conflict',
                    normalized.batchId
                );
            }
            this.telemetry.replayedBatchCount++;
            return knownBatch.receipt;
        }
        const existingTickBatch = this.pendingBatchByTick.get(
            normalized.targetFixedTick
        ) ?? this.inFlightBatchByTick.get(normalized.targetFixedTick);
        if (existingTickBatch) {
            return this.#failRequest(
                'effect-whole-tick-batch-conflict',
                normalized.batchId
            );
        }
        if (this.#getPendingProgramCount() + normalized.commands.length
            > this.commandCapacity) {
            this.telemetry.capacityRejectedCount++;
            return Object.freeze({
                accepted: false,
                batchId: normalized.batchId,
                targetFixedTick: normalized.targetFixedTick,
                queuedCount: 0,
                reason: 'effect-command-capacity'
            });
        }
        this.#evictCompletedHistory(normalized.commands.length + 1);
        if (this.knownBatchById.size + this.knownCommandById.size
            + normalized.commands.length + 1 > this.historyCapacity) {
            this.telemetry.capacityRejectedCount++;
            return Object.freeze({
                accepted: false,
                batchId: normalized.batchId,
                targetFixedTick: normalized.targetFixedTick,
                queuedCount: 0,
                reason: 'effect-command-history-capacity'
            });
        }
        for (const command of normalized.commands) {
            const knownCommand = this.knownCommandById.get(command.commandId);
            if (knownCommand) {
                if (knownCommand.fingerprint !== command.fingerprint) {
                    return this.#failRequest(
                        'effect-command-replay-conflict',
                        command.commandId
                    );
                }
                return this.#failRequest(
                    'effect-command-cross-batch-replay',
                    command.commandId
                );
            }
        }

        const receipt = Object.freeze({
            accepted: true,
            batchId: normalized.batchId,
            targetFixedTick: normalized.targetFixedTick,
            queuedCount: normalized.commands.length,
            replayed: false,
            commandIds: Object.freeze(
                normalized.commands.map(({ commandId }) => commandId)
            )
        });
        const batch = Object.freeze({
            ...normalized,
            receipt,
            state: 'queued'
        });
        this.pendingBatchByTick.set(batch.targetFixedTick, batch);
        this.knownBatchById.set(batch.batchId, {
            fingerprint: batch.fingerprint,
            receipt,
            completed: false
        });
        for (const command of batch.commands) {
            this.knownCommandById.set(command.commandId, {
                fingerprint: command.fingerprint,
                completed: false
            });
        }
        this.telemetry.requestedBatchCount++;
        this.telemetry.requestedProgramCount += batch.commands.length;
        return receipt;
    }

    commitAtFixedBoundary(fixedTick, lifecycleCommit = null) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.lastCommitResult?.fixedTick === tick) {
            return this.lastCommitResult;
        }
        if (this.recoveryRequired) {
            return this.#freezeCommitResult({
                fixedTick: tick,
                state: 'failed',
                batchId: null,
                programs: [],
                rejected: [],
                recoveryRequired: true,
                protocolFailure: this.failure
            });
        }
        const overdueTick = [...this.pendingBatchByTick.keys()]
            .find((targetTick) => targetTick < tick);
        if (overdueTick !== undefined) {
            this.#failProtocol(
                'effect-command-tick-gap',
                `effect pulse batch tick을 지나쳤습니다: ${overdueTick}/${tick}`
            );
            return this.commitAtFixedBoundary(tick);
        }
        const batch = this.pendingBatchByTick.get(tick) ?? null;
        if (!batch || !this.ingressOpen) {
            this.lastCommitResult = this.#freezeCommitResult({
                fixedTick: tick,
                state: 'committed',
                batchId: batch?.batchId ?? null,
                programs: [],
                rejected: [],
                recoveryRequired: false,
                protocolFailure: null
            });
            return this.lastCommitResult;
        }

        let records;
        try {
            records = this.#revalidateWholeBatch(batch, tick, lifecycleCommit);
        } catch (error) {
            this.#failProtocol(
                'effect-source-revalidation',
                String(error?.message ?? error)
            );
            return this.commitAtFixedBoundary(tick);
        }
        const protocol = this.#readProtocol('effectStage.protocol');
        if (!protocol) {
            return this.commitAtFixedBoundary(tick);
        }
        let backendResult;
        try {
            backendResult = this.backend.stageEffectPulseProgramBatch(
                Object.freeze({
                    abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                    batchIdFingerprint: batch.numericFingerprint,
                    sourceTick: tick,
                    records: Object.freeze(records)
                })
            );
        } catch (error) {
            backendResult = Object.freeze({
                accepted: false,
                reason: 'effect-stage-exception',
                message: String(error?.message ?? error)
            });
        }
        const stagedCount = Number(backendResult?.stagedCount);
        if (backendResult?.accepted !== true
            || backendResult.abiVersion !== GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION
            || backendResult.sourceTick !== tick
            || stagedCount !== records.length) {
            this.#failProtocol(
                'effect-stage-rejected',
                backendResult?.reason ?? 'backend가 whole-tick batch를 수락하지 않았습니다.'
            );
            return this.commitAtFixedBoundary(tick);
        }

        const submittedBatch = Object.freeze({
            ...batch,
            protocol,
            stagedBackendRecords: records,
            state: 'submitted'
        });
        this.pendingBatchByTick.delete(tick);
        this.inFlightBatchByTick.set(tick, submittedBatch);
        const programs = batch.commands.map((command, programIndex) => (
            Object.freeze({
                commandId: command.commandId,
                batchId: batch.batchId,
                targetFixedTick: tick,
                sourceHandle: command.sourceHandle,
                effectEmitterProfileId: command.effectEmitterProfileId,
                effectDefinitionId: command.effectDefinitionId,
                pulseSequence: command.pulseSequence,
                programIndex
            })
        ));
        this.lastCommitResult = this.#freezeCommitResult({
            fixedTick: tick,
            state: 'committed',
            batchId: batch.batchId,
            programs,
            rejected: [],
            recoveryRequired: false,
            protocolFailure: null
        });
        return this.lastCommitResult;
    }

    commitCompletedAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.lastCompletionResult.fixedTick === tick) {
            return this.lastCompletionResult;
        }
        // Lower drain은 마지막 readback lease를 반납하면서 idle resource를
        // 해제하고 authoritative epoch를 올릴 수 있습니다. 방금 drain할
        // envelope는 호출 직전 protocol에 속하므로 그 snapshot을 먼저
        // 고정해야 authentic 마지막 batch를 stale로 오판하지 않습니다.
        const protocolAtDrain = this.#readProtocol('effectCompletion.protocol');
        if (!protocolAtDrain) {
            return this.#failCompletion(
                tick,
                this.failure.code,
                this.failure.message
            );
        }
        const scratch = this.completionScratch;
        scratch.length = 0;
        this.backend.drainCompletedEffectProgramBatches(scratch);
        if (!this.ingressOpen) {
            scratch.length = 0;
            this.deferredCompletionBatches.length = 0;
            this.lastCompletionResult = createEmptyCompletionSnapshot(
                tick,
                this.completedThroughTick
            );
            return this.lastCompletionResult;
        }
        if (scratch.length + this.deferredCompletionBatches.length
            > this.completionBatchCapacity) {
            scratch.length = 0;
            return this.#failCompletion(
                tick,
                'effect-completion-batch-capacity',
                'Effect completion batch capacity를 초과했습니다.'
            );
        }
        const frozenProtocolAtDrain = Object.freeze({ ...protocolAtDrain });
        for (const source of scratch) {
            this.deferredCompletionBatches.push(Object.freeze({
                source,
                protocol: frozenProtocolAtDrain
            }));
        }
        scratch.length = 0;
        if (this.recoveryRequired) {
            this.deferredCompletionBatches.length = 0;
            return this.#failCompletion(
                tick,
                this.failure?.code ?? 'effect-runtime-recovery-required',
                this.failure?.message ?? 'Effect runtime recovery가 필요합니다.'
            );
        }
        if (this.deferredCompletionBatches.length === 0) {
            this.lastCompletionResult = createEmptyCompletionSnapshot(
                tick,
                this.completedThroughTick
            );
            return this.lastCompletionResult;
        }

        const future = [];
        const eligible = [];
        let staleBatchCount = 0;
        let encounteredFuture = false;
        try {
            for (const queued of this.deferredCompletionBatches) {
                const batch = this.#normalizeCompletionEnvelope(queued.source);
                const generationOrder = compareProtocolGeneration(
                    batch,
                    queued.protocol
                );
                if (generationOrder > 0) {
                    throw new RangeError('Effect completion generation이 현재 protocol보다 미래입니다.');
                }
                if (generationOrder < 0) {
                    staleBatchCount++;
                    continue;
                }
                if (batch.sourceTick >= tick) {
                    encounteredFuture = true;
                    future.push(queued);
                    continue;
                }
                if (encounteredFuture) {
                    throw new RangeError('future Effect completion 뒤에 과거 batch가 도착했습니다.');
                }
                eligible.push(batch);
            }
        } catch (error) {
            this.deferredCompletionBatches.length = 0;
            return this.#failCompletion(
                tick,
                'effect-completion-envelope',
                String(error?.message ?? error)
            );
        }

        const results = [];
        const events = [];
        let acceptedBatchCount = 0;
        try {
            for (const batch of eligible) {
                const key = [
                    batch.sessionGeneration,
                    batch.deviceGeneration,
                    batch.authoritativeEpoch,
                    batch.sourceTick,
                    batch.submittedTick
                ].join(':');
                const fingerprint = stableFingerprint(batch.source);
                const knownFingerprint = this.knownCompletionBatchFingerprints.get(key);
                if (knownFingerprint !== undefined) {
                    if (knownFingerprint !== fingerprint) {
                        throw new RangeError('Effect completion batch replay payload가 충돌합니다.');
                    }
                    continue;
                }
                const streamKey = protocolKey(batch);
                const expectedPreviousSourceTick = streamKey
                    === this.lastCompletionProtocolKey
                    ? this.lastCompletionSourceTick
                    : 0;
                const expectedPreviousSubmittedTick = streamKey
                    === this.lastCompletionProtocolKey
                    ? this.lastCompletionSubmittedTick
                    : 0;
                if (batch.previousSourceTick !== expectedPreviousSourceTick
                    || batch.previousSubmittedTick !== expectedPreviousSubmittedTick
                    || batch.sourceTick <= batch.previousSourceTick
                    || batch.submittedTick <= batch.previousSubmittedTick
                    || batch.completedThroughTick !== batch.sourceTick) {
                    throw new RangeError('Effect completion predecessor/watermark가 contiguous하지 않습니다.');
                }
                const pending = this.inFlightBatchByTick.get(batch.sourceTick);
                if (!pending || !sameProtocol(pending.protocol, batch)) {
                    throw new RangeError(`등록되지 않은 Effect completion입니다: ${batch.sourceTick}`);
                }
                if (batch.abiVersion !== GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION
                    || batch.status !== GPU_EFFECT_RUNTIME_STATUS.OK
                    || batch.pulseResults.length !== pending.commands.length
                    || batch.eventCount !== batch.events.length) {
                    throw new RangeError('Effect completion whole-tick count/status가 일치하지 않습니다.');
                }
                let candidateCount = 0;
                let appliedInstanceCount = 0;
                const pulseResultByCommandId = new Map();
                for (let index = 0; index < pending.commands.length; index++) {
                    const command = pending.commands[index];
                    const result = batch.pulseResults[index];
                    const sourceInvalidAuthorized = (
                        pending.stagedBackendRecords[index].flags
                        & GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
                    ) !== 0;
                    if (result.programIndex !== index
                        || result.pulseSequence !== command.pulseSequence
                        || !NORMAL_COMPLETION_RESULTS.has(result.resultCode)
                        || ((result.resultCode
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID)
                            !== sourceInvalidAuthorized)
                        || result.appliedCount > result.candidateCount
                        || (result.resultCode
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.APPLIED
                            ? result.appliedCount <= 0
                                || result.appliedCount !== result.candidateCount
                            : result.candidateCount !== 0
                                || result.appliedCount !== 0)) {
                        throw new RangeError(`Effect pulse result가 command와 다릅니다: ${index}`);
                    }
                    candidateCount += result.candidateCount;
                    appliedInstanceCount += result.appliedCount;
                    pulseResultByCommandId.set(command.commandId, result);
                    if (result.resultCode === GPU_EFFECT_PULSE_PROGRAM_RESULT.ZERO_TARGET) {
                        this.telemetry.zeroTargetCount++;
                    } else if (result.resultCode
                        === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID) {
                        this.telemetry.sourceInvalidCount++;
                    }
                    results.push(Object.freeze({
                        commandId: command.commandId,
                        batchId: pending.batchId,
                        sourceTick: batch.sourceTick,
                        submittedTick: batch.submittedTick,
                        sourceHandle: command.sourceHandle,
                        effectEmitterProfileId: command.effectEmitterProfileId,
                        effectDefinitionId: command.effectDefinitionId,
                        pulseSequence: command.pulseSequence,
                        resultCode: result.resultCode,
                        candidateCount: result.candidateCount,
                        appliedCount: result.appliedCount
                    }));
                }
                if (candidateCount !== batch.candidateCount
                    || appliedInstanceCount !== batch.appliedInstanceCount) {
                    throw new RangeError('Effect completion aggregate count가 pulse result와 다릅니다.');
                }
                const eventCountsByCommandId = new Map(
                    pending.commands.map((command) => [
                        command.commandId,
                        { pulse: 0, instance: 0 }
                    ])
                );
                const validPulseCommandIds = pending.commands
                    .filter((command) => (
                        pulseResultByCommandId.get(command.commandId)?.resultCode
                            !== GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID
                    ))
                    .map(({ commandId }) => commandId);
                let nextPulseEventIndex = 0;
                let sawInstanceEvent = false;
                let batchInstanceIncarnation = null;
                const appliedInstanceKeys = new Set();
                const appliedTargetKeys = new Set();
                for (const rawEvent of batch.events) {
                    const event = this.#normalizeCompletionEvent(rawEvent, pending);
                    const counts = eventCountsByCommandId.get(event.commandId);
                    const result = pulseResultByCommandId.get(event.commandId);
                    if (!counts || !result) {
                        throw new RangeError('Effect event command provenance가 없습니다.');
                    }
                    if (batchInstanceIncarnation === null) {
                        batchInstanceIncarnation = event.instanceIncarnation;
                    } else if (batchInstanceIncarnation !== event.instanceIncarnation) {
                        throw new RangeError(
                            'Effect event instance incarnation이 batch 안에서 일치하지 않습니다.'
                        );
                    }
                    if (event.type === GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED) {
                        if (sawInstanceEvent
                            || validPulseCommandIds[nextPulseEventIndex]
                                !== event.commandId
                            || event.valueFixedPoint !== result.appliedCount) {
                            throw new RangeError(
                                'PULSE_EMITTED order/value가 authored pulse result와 다릅니다.'
                            );
                        }
                        counts.pulse++;
                        nextPulseEventIndex++;
                    } else {
                        sawInstanceEvent = true;
                        const instanceKey = [
                            event.effectInstanceId,
                            event.instanceIncarnation
                        ].join(':');
                        const targetKey = [
                            event.commandId,
                            event.targetHandle.entityId,
                            event.targetHandle.incarnation
                        ].join(':');
                        if (appliedInstanceKeys.has(instanceKey)
                            || appliedTargetKeys.has(targetKey)) {
                            throw new RangeError(
                                'INSTANCE_APPLIED instance/target provenance가 중복되었습니다.'
                            );
                        }
                        appliedInstanceKeys.add(instanceKey);
                        appliedTargetKeys.add(targetKey);
                        counts.instance++;
                    }
                    events.push(event);
                }
                for (const command of pending.commands) {
                    const result = pulseResultByCommandId.get(command.commandId);
                    const counts = eventCountsByCommandId.get(command.commandId);
                    const expectedPulseCount = result.resultCode
                            === GPU_EFFECT_PULSE_PROGRAM_RESULT.SOURCE_INVALID
                        ? 0
                        : 1;
                    if (counts.pulse !== expectedPulseCount
                        || counts.instance !== result.appliedCount) {
                        throw new RangeError(
                            `Effect event composition이 pulse result와 다릅니다: ${command.commandId}`
                        );
                    }
                }
                this.inFlightBatchByTick.delete(batch.sourceTick);
                this.#completeKnownBatch(pending);
                this.#rememberCompletionBatch(key, fingerprint);
                this.lastCompletionSourceTick = batch.sourceTick;
                this.lastCompletionSubmittedTick = batch.submittedTick;
                this.lastCompletionProtocolKey = streamKey;
                this.completedThroughTick = batch.sourceTick;
                this.telemetry.completedBatchCount++;
                this.telemetry.completedProgramCount += pending.commands.length;
                acceptedBatchCount++;
            }
        } catch (error) {
            this.deferredCompletionBatches.length = 0;
            return this.#failCompletion(
                tick,
                'effect-completion-protocol',
                String(error?.message ?? error)
            );
        }
        this.deferredCompletionBatches = future;
        this.telemetry.staleBatchCount += staleBatchCount;
        this.lastCompletionResult = Object.freeze({
            fixedTick: tick,
            completedThroughTick: this.completedThroughTick,
            batchCount: acceptedBatchCount,
            results: Object.freeze(results),
            events: Object.freeze(events),
            staleBatchCount,
            protocolFailure: null
        });
        return this.lastCompletionResult;
    }

    closeIngress(reason = 'gameplay-ingress-closed', finalFixedTick = null) {
        this.#assertUsable();
        if (this.ingressOpen) {
            this.ingressOpen = false;
            this.ingressCloseReason = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'gameplay-ingress-closed';
            this.portState.revoked = true;
        }
        for (const batch of this.pendingBatchByTick.values()) {
            this.#completeKnownBatch(batch);
        }
        this.pendingBatchByTick.clear();
        this.deferredCompletionBatches.length = 0;
        this.completionScratch.length = 0;
        if ((finalFixedTick !== null && finalFixedTick !== undefined)
            && this.terminalCancelResult === null) {
            this.#cancelForTerminal(finalFixedTick);
        }
        return Object.freeze({
            closed: !this.ingressOpen,
            reason: this.ingressCloseReason,
            terminalCancellation: this.terminalCancelResult
        });
    }

    getTerminalCancelStatus() {
        const runtimeStatus = this.backend.getEffectRuntimeStatus();
        return Object.freeze({
            owner: this.terminalCancelResult,
            backend: runtimeStatus?.terminal ?? null
        });
    }

    getPendingCount() {
        return this.#getPendingProgramCount();
    }

    getStatus() {
        const runtime = this.backend.getEffectRuntimeStatus();
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            capacity: this.commandCapacity,
            pendingBatchCount: this.pendingBatchByTick.size,
            inFlightBatchCount: this.inFlightBatchByTick.size,
            pendingPulseProgramCount: this.#getPendingProgramCount(),
            deferredCompletionBatchCount: this.deferredCompletionBatches.length,
            completedThroughTick: this.completedThroughTick,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
            terminalCancelResult: this.terminalCancelResult,
            lastCommitResult: this.lastCommitResult,
            lastCompletionResult: this.lastCompletionResult,
            runtime,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        if (this.ingressOpen) {
            this.closeIngress('destroyed');
        }
        this.portState.revoked = true;
        this.pendingBatchByTick.clear();
        this.inFlightBatchByTick.clear();
        this.knownBatchById.clear();
        this.knownCommandById.clear();
        this.knownCompletionBatchFingerprints.clear();
        this.completedBatchKeys.length = 0;
        this.completedBatchKeyHead = 0;
        this.completedHistory.length = 0;
        this.deferredCompletionBatches.length = 0;
        this.completionScratch.length = 0;
        this.destroyed = true;
    }

    #normalizeRequestedBatch(source) {
        if (!source || typeof source !== 'object' || !Array.isArray(source.commands)) {
            throw new TypeError('effect pulse batch 객체와 commands 배열이 필요합니다.');
        }
        const targetFixedTick = requirePositiveSafeInteger(
            source.targetFixedTick,
            'effectBatch.targetFixedTick'
        );
        if (source.commands.length === 0) {
            throw new RangeError('effect pulse batch는 비어 있을 수 없습니다.');
        }
        const commands = source.commands.map((command, index) => (
            this.#normalizeRequestedCommand(
                command,
                targetFixedTick,
                `effectBatch.commands[${index}]`
            )
        ));
        for (let index = 1; index < commands.length; index++) {
            if (compareCommands(commands[index - 1], commands[index]) >= 0) {
                throw new RangeError('effect pulse commands는 exact identity/sequence 오름차순이어야 합니다.');
            }
            if (handleKey(commands[index - 1].sourceHandle)
                === handleKey(commands[index].sourceHandle)) {
                throw new RangeError(
                    'effect pulse whole-tick batch에는 exact source당 command 하나만 허용됩니다.'
                );
            }
        }
        const batchId = requireNonEmptyString(source.batchId, 'effectBatch.batchId');
        const expectedBatchId = createGpuEffectPulseBatchId(
            this.sessionGeneration,
            targetFixedTick,
            commands
        );
        if (batchId !== expectedBatchId) {
            throw new RangeError('effect pulse batch ID가 ordered exact source 목록과 다릅니다.');
        }
        const fingerprintSource = {
            sessionGeneration: this.sessionGeneration,
            targetFixedTick,
            commands: commands.map(({ fingerprintSource: value }) => value)
        };
        return Object.freeze({
            batchId,
            targetFixedTick,
            commands: Object.freeze(commands),
            fingerprint: stableFingerprint(fingerprintSource),
            numericFingerprint: createNonZeroUint32Fingerprint(fingerprintSource)
        });
    }

    #normalizeRequestedCommand(source, targetFixedTick, label) {
        if (!source || typeof source !== 'object') {
            throw new TypeError(`${label} command가 필요합니다.`);
        }
        for (const propertyName of [
            'flags',
            'allowSourceInvalid',
            'backendRecord',
            'sourceSlot'
        ]) {
            if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
                throw new TypeError(
                    `${label}.${propertyName}은 public Effect command에서 사용할 수 없습니다.`
                );
            }
        }
        const sourceHandle = normalizeHandle(source.sourceHandle, `${label}.sourceHandle`);
        const pulseSequence = requireNonNegativeSafeInteger(
            source.pulseSequence,
            `${label}.pulseSequence`
        );
        const effectEmitterProfileId = requireNonEmptyString(
            source.effectEmitterProfileId,
            `${label}.effectEmitterProfileId`
        );
        const effectDefinitionId = requireNonEmptyString(
            source.effectDefinitionId,
            `${label}.effectDefinitionId`
        );
        const commandId = requireNonEmptyString(source.commandId, `${label}.commandId`);
        const expectedCommandId = createGpuEffectPulseCommandId(
            this.sessionGeneration,
            targetFixedTick,
            sourceHandle,
            pulseSequence
        );
        if (commandId !== expectedCommandId) {
            throw new RangeError(`${label}.commandId가 canonical identity와 다릅니다.`);
        }
        const profile = this.effectEmitterProfileById[effectEmitterProfileId];
        const definition = this.effectDefinitionById[effectDefinitionId];
        if (!profile
            || !definition
            || profile.id !== effectEmitterProfileId
            || profile.effectDefinitionId !== effectDefinitionId
            || profile.effectDefinitionCode !== definition.effectDefinitionCode) {
            throw new RangeError(`${label} effect catalog exact reference가 일치하지 않습니다.`);
        }
        this.#assertExactSourceMetadata(
            sourceHandle,
            profile,
            definition,
            `${label}.source`
        );
        const fingerprintSource = Object.freeze({
            commandId,
            targetFixedTick,
            sourceHandle,
            effectEmitterProfileId,
            effectDefinitionId,
            pulseSequence
        });
        const fingerprint = stableFingerprint(fingerprintSource);
        return Object.freeze({
            ...fingerprintSource,
            fingerprintSource,
            fingerprint,
            backendRecord: Object.freeze({
                sourceEntityId: sourceHandle.entityId,
                sourceIncarnation: sourceHandle.incarnation,
                effectDefinitionCode: definition.effectDefinitionCode,
                emitterDefinitionCode: profile.emitterDefinitionCode,
                sourceTick: targetFixedTick,
                pulseSequence,
                radiusTiles: requirePositiveFiniteFloat32(
                    profile.pulseRadiusTiles,
                    `${label}.pulseRadiusTiles`
                ),
                targetLayerMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
                targetPolicy: requirePositiveSafeInteger(
                    profile.targetPolicyCode,
                    `${label}.targetPolicyCode`
                ),
                fingerprint: createNonZeroUint32Fingerprint(fingerprintSource),
                flags: createPulseProgramFlags(profile, definition),
                retargetIntervalTicks: requirePositiveSafeInteger(
                    profile.retargetIntervalTicks,
                    `${label}.retargetIntervalTicks`
                )
            })
        });
    }

    #assertExactSourceMetadata(handle, profile, definition, label) {
        const registryHas = this.registry.has(handle);
        const backendHas = this.backend.hasBody(handle);
        if (registryHas !== backendHas) {
            throw new RangeError(`${label} registry/backend exact identity가 불일치합니다.`);
        }
        if (!registryHas) {
            throw new RangeError(`${label} exact identity가 stale입니다.`);
        }
        const view = this.registry.copyEntityView(handle, {});
        const metadata = view?.metadata;
        if (!view
            || view.kindId !== 'enemy'
            || !metadata
            || !hasEnemyCapability(
                metadata.capabilityMask,
                ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
                `${label}.capabilityMask`
            )
            || metadata.effectEmitterProfileId !== profile.id
            || metadata.effectEmitterDefinitionCode !== profile.emitterDefinitionCode
            || metadata.effectDefinitionId !== definition.id
            || metadata.effectDefinitionCode !== definition.effectDefinitionCode
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
            throw new RangeError(`${label} Effect capability/profile metadata가 일치하지 않습니다.`);
        }
        return view;
    }

    #revalidateWholeBatch(batch, fixedTick, lifecycleCommit) {
        const despawnProofs = this.#readLifecycleDespawnProofs(
            lifecycleCommit,
            fixedTick
        );
        const records = [];
        for (const command of batch.commands) {
            const registryHas = this.registry.has(command.sourceHandle);
            const backendHas = this.backend.hasBody(command.sourceHandle);
            if (registryHas !== backendHas) {
                throw new RangeError(
                    `${command.commandId} registry/backend exact identity가 불일치합니다.`
                );
            }
            const baseFlags = command.backendRecord.flags >>> 0;
            if ((baseFlags & GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID) !== 0) {
                throw new RangeError(
                    `${command.commandId} public/backend 원본에 ALLOW_SOURCE_INVALID가 포함되었습니다.`
                );
            }
            if (!registryHas) {
                if (!despawnProofs.has(handleKey(command.sourceHandle))) {
                    throw new RangeError(
                        `${command.commandId} source missing에 authentic same-boundary lifecycle despawn 증거가 없습니다.`
                    );
                }
                records.push(Object.freeze({
                    ...command.backendRecord,
                    flags: (
                        baseFlags
                        | GPU_EFFECT_PULSE_PROGRAM_FLAG.ALLOW_SOURCE_INVALID
                    ) >>> 0
                }));
                continue;
            }
            const profile = this.effectEmitterProfileById[
                command.effectEmitterProfileId
            ];
            const definition = this.effectDefinitionById[
                command.effectDefinitionId
            ];
            this.#assertExactSourceMetadata(
                command.sourceHandle,
                profile,
                definition,
                command.commandId
            );
            records.push(command.backendRecord);
        }
        return Object.freeze(records);
    }

    #readLifecycleDespawnProofs(lifecycleCommit, fixedTick) {
        if (lifecycleCommit === null || lifecycleCommit === undefined) {
            return new Set();
        }
        const commits = Array.isArray(lifecycleCommit)
            ? lifecycleCommit
            : [lifecycleCommit];
        const proofs = new Set();
        for (let commitIndex = 0; commitIndex < commits.length; commitIndex++) {
            const commit = commits[commitIndex];
            if (!this.#lifecycleCommitProofPort
                || this.#lifecycleCommitProofPort.isAuthenticCommit(
                    commit,
                    fixedTick
                ) !== true) {
                throw new RangeError(
                    'Effect source lifecycle commit 증거가 owner-authenticated snapshot이 아닙니다.'
                );
            }
            if (commit.fixedTick !== fixedTick
                || commit.recoveryRequired !== false
                || !Array.isArray(commit.despawned)) {
                throw new RangeError(
                    'Effect source lifecycle commit의 fixed tick/result shape가 유효하지 않습니다.'
                );
            }
            for (let index = 0; index < commit.despawned.length; index++) {
                const entry = commit.despawned[index];
                requireNonEmptyString(
                    entry?.commandId,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].commandId`
                );
                requireNonEmptyString(
                    entry?.reason,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].reason`
                );
                const handle = normalizeHandle(
                    entry?.handle,
                    `lifecycleCommit[${commitIndex}].despawned[${index}].handle`
                );
                const key = handleKey(handle);
                if (proofs.has(key)) {
                    throw new RangeError(
                        `lifecycleCommit despawn exact identity가 중복되었습니다: ${key}`
                    );
                }
                proofs.add(key);
            }
        }
        return proofs;
    }

    #normalizeCompletionEnvelope(source) {
        if (!source || typeof source !== 'object') {
            throw new TypeError('Effect completion batch는 객체여야 합니다.');
        }
        const pulseResults = Array.isArray(source.pulseResults)
            ? source.pulseResults.map((result, index) => Object.freeze({
                programIndex: requireNonNegativeSafeInteger(
                    result?.programIndex,
                    `pulseResults[${index}].programIndex`
                ),
                pulseSequence: requireNonNegativeSafeInteger(
                    result?.pulseSequence,
                    `pulseResults[${index}].pulseSequence`
                ),
                resultCode: requireNonNegativeSafeInteger(
                    result?.resultCode,
                    `pulseResults[${index}].resultCode`
                ),
                candidateCount: requireNonNegativeSafeInteger(
                    result?.candidateCount,
                    `pulseResults[${index}].candidateCount`
                ),
                appliedCount: requireNonNegativeSafeInteger(
                    result?.appliedCount,
                    `pulseResults[${index}].appliedCount`
                )
            }))
            : null;
        if (!pulseResults || !Array.isArray(source.events)) {
            throw new TypeError('Effect completion pulseResults/events 배열이 필요합니다.');
        }
        const protocol = normalizeProtocol(source, 'effectCompletion.batch');
        return Object.freeze({
            source,
            ...protocol,
            abiVersion: requirePositiveSafeInteger(
                source.abiVersion,
                'effectCompletion.abiVersion'
            ),
            previousSourceTick: requireNonNegativeSafeInteger(
                source.previousSourceTick,
                'effectCompletion.previousSourceTick'
            ),
            previousSubmittedTick: requireNonNegativeSafeInteger(
                source.previousSubmittedTick,
                'effectCompletion.previousSubmittedTick'
            ),
            sourceTick: requirePositiveSafeInteger(
                source.sourceTick,
                'effectCompletion.sourceTick'
            ),
            submittedTick: requirePositiveSafeInteger(
                source.submittedTick,
                'effectCompletion.submittedTick'
            ),
            completedThroughTick: requireNonNegativeSafeInteger(
                source.completedThroughTick,
                'effectCompletion.completedThroughTick'
            ),
            status: requireNonNegativeSafeInteger(
                source.status,
                'effectCompletion.status'
            ),
            candidateCount: requireNonNegativeSafeInteger(
                source.candidateCount,
                'effectCompletion.candidateCount'
            ),
            appliedInstanceCount: requireNonNegativeSafeInteger(
                source.appliedInstanceCount,
                'effectCompletion.appliedInstanceCount'
            ),
            eventCount: requireNonNegativeSafeInteger(
                source.eventCount,
                'effectCompletion.eventCount'
            ),
            pulseResults: Object.freeze(pulseResults),
            events: Object.freeze(source.events)
        });
    }

    #normalizeCompletionEvent(source, pending) {
        const type = requirePositiveSafeInteger(source?.type, 'effectEvent.type');
        if (!VALID_EFFECT_EVENT_TYPES.has(type)) {
            throw new RangeError(`지원하지 않는 Effect event type입니다: ${type}`);
        }
        const sourceHandle = normalizeHandle({
            entityId: source.sourceEntityId,
            incarnation: source.sourceIncarnation
        }, 'effectEvent.source');
        const targetHandle = normalizeHandle({
            entityId: source.targetEntityId,
            incarnation: source.targetIncarnation
        }, 'effectEvent.target');
        const effectDefinitionCode = requirePositiveSafeInteger(
            source.effectDefinitionCode,
            'effectEvent.effectDefinitionCode'
        );
        const matchingCommands = pending.commands.filter((command) => (
            handleKey(command.sourceHandle) === handleKey(sourceHandle)
                && command.backendRecord.effectDefinitionCode
                    === effectDefinitionCode
        ));
        if (matchingCommands.length !== 1) {
            throw new RangeError(
                'Effect event source/definition이 pending command 하나와 exact match해야 합니다.'
            );
        }
        const matchingCommand = matchingCommands[0];
        const effectInstanceId = requirePositiveSafeInteger(
            source.effectInstanceId,
            'effectEvent.effectInstanceId'
        );
        if (type === GPU_EFFECT_EVENT_TYPE.PULSE_EMITTED
            && (handleKey(targetHandle) !== handleKey(sourceHandle)
                || effectInstanceId !== matchingCommand.backendRecord.fingerprint)) {
            throw new RangeError(
                'PULSE_EMITTED target/provenance가 exact source command와 다릅니다.'
            );
        }
        const flags = requireNonNegativeSafeInteger(
            source.flags ?? 0,
            'effectEvent.flags'
        );
        if (flags !== 0) {
            throw new RangeError('Effect event ABI v1 flags는 0이어야 합니다.');
        }
        return Object.freeze({
            type,
            commandId: matchingCommand.commandId,
            batchId: pending.batchId,
            sourceTick: pending.targetFixedTick,
            pulseSequence: matchingCommand.pulseSequence,
            effectDefinitionId: matchingCommand.effectDefinitionId,
            flags,
            effectInstanceId,
            instanceIncarnation: requirePositiveSafeInteger(
                source.instanceIncarnation,
                'effectEvent.instanceIncarnation'
            ),
            sourceHandle,
            targetHandle,
            effectDefinitionCode,
            valueFixedPoint: requireInt32(
                source.valueFixedPoint,
                'effectEvent.valueFixedPoint'
            ),
            position: Object.freeze({
                x: requireFiniteFloat32(
                    source.position?.x,
                    'effectEvent.position.x'
                ),
                y: requireFiniteFloat32(
                    source.position?.y,
                    'effectEvent.position.y'
                )
            })
        });
    }

    #cancelForTerminal(finalFixedTick) {
        const tick = requirePositiveSafeInteger(finalFixedTick, 'finalFixedTick');
        const pulseProgramCount = [...this.inFlightBatchByTick.values()]
            .reduce((count, batch) => count + batch.commands.length, 0);
        let result;
        try {
            result = this.backend.cancelPendingEffectProgramsForTerminal(
                Object.freeze({
                    abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
                    finalFixedTick: tick
                })
            );
        } catch (error) {
            result = Object.freeze({
                state: 'failed',
                failure: String(error?.message ?? error)
            });
        }
        const accepted = result?.abiVersion === GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
            && result.state === 'armed'
            && result.finalFixedTick === tick
            && result.submittedTick === 0
            && result.pulseProgramCount === pulseProgramCount
            && Number.isSafeInteger(result.pendingPulseProgramCount)
            && result.pendingPulseProgramCount >= 0
            && Number.isSafeInteger(result.pendingEffectReadbackCount)
            && result.pendingEffectReadbackCount >= 0
            && (result.failure === null || result.failure === undefined);
        if (!accepted) {
            this.#failProtocol(
                'effect-terminal-cancel',
                String(result?.failure ?? result?.state ?? 'terminal cancel이 거절되었습니다.')
            );
        } else {
            for (const batch of this.inFlightBatchByTick.values()) {
                this.#completeKnownBatch(batch);
            }
            this.inFlightBatchByTick.clear();
        }
        this.terminalCancelResult = Object.freeze({
            abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
            state: accepted ? 'armed' : 'failed',
            finalFixedTick: tick,
            submittedTick: 0,
            pulseProgramCount,
            pendingPulseProgramCount: accepted
                ? result.pendingPulseProgramCount
                : pulseProgramCount,
            pendingEffectReadbackCount: accepted
                ? result.pendingEffectReadbackCount
                : 0,
            failure: accepted ? null : this.failure
        });
        return this.terminalCancelResult;
    }

    #readProtocol(label) {
        try {
            const protocol = normalizeProtocol(
                this.backend.getEventProtocolState(),
                label
            );
            if (protocol.sessionGeneration !== this.sessionGeneration) {
                throw new RangeError(
                    `${label} session이 owner와 다릅니다: ${protocol.sessionGeneration}/${this.sessionGeneration}`
                );
            }
            return protocol;
        } catch (error) {
            this.#failProtocol(
                'effect-protocol-state',
                String(error?.message ?? error)
            );
            return null;
        }
    }

    #failRequest(code, identity) {
        this.telemetry.conflictCount++;
        this.#failProtocol(code, `Effect command identity가 충돌했습니다: ${identity}`);
        return Object.freeze({
            accepted: false,
            reason: code,
            identity
        });
    }

    #failProtocol(code, message) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            stage: 'gpu-effect-command-owner',
            code,
            name: 'GpuEffectCommandProtocolViolation',
            message
        });
        return this.failure;
    }

    #failCompletion(fixedTick, code, message) {
        const failure = this.#failProtocol(code, message);
        this.lastCompletionResult = Object.freeze({
            ...createEmptyCompletionSnapshot(fixedTick, this.completedThroughTick),
            protocolFailure: failure
        });
        return this.lastCompletionResult;
    }

    #freezeCommitResult(source) {
        this.lastCommitResult = Object.freeze({
            fixedTick: source.fixedTick,
            state: source.state,
            batchId: source.batchId,
            programs: Object.freeze(source.programs),
            rejected: Object.freeze(source.rejected),
            recoveryRequired: source.recoveryRequired === true,
            protocolFailure: source.protocolFailure ?? null
        });
        return this.lastCommitResult;
    }

    #completeKnownBatch(batch) {
        const knownBatch = this.knownBatchById.get(batch.batchId);
        if (knownBatch) {
            knownBatch.completed = true;
        }
        this.completedHistory.push(Object.freeze({
            type: 'batch',
            id: batch.batchId
        }));
        for (const command of batch.commands) {
            const knownCommand = this.knownCommandById.get(command.commandId);
            if (knownCommand) {
                knownCommand.completed = true;
            }
            this.completedHistory.push(Object.freeze({
                type: 'command',
                id: command.commandId
            }));
        }
    }

    #rememberCompletionBatch(key, fingerprint) {
        this.knownCompletionBatchFingerprints.set(key, fingerprint);
        this.completedBatchKeys.push(key);
        while ((this.completedBatchKeys.length - this.completedBatchKeyHead)
            > this.historyCapacity) {
            this.knownCompletionBatchFingerprints.delete(
                this.completedBatchKeys[this.completedBatchKeyHead++]
            );
        }
        if (this.completedBatchKeyHead >= this.historyCapacity) {
            this.completedBatchKeys = this.completedBatchKeys.slice(
                this.completedBatchKeyHead
            );
            this.completedBatchKeyHead = 0;
        }
    }

    #evictCompletedHistory(requiredCapacity = 0) {
        while ((this.knownBatchById.size + this.knownCommandById.size
            + requiredCapacity) > this.historyCapacity
            && this.completedHistoryHead < this.completedHistory.length) {
            const entry = this.completedHistory[this.completedHistoryHead++];
            if (entry.type === 'batch') {
                const known = this.knownBatchById.get(entry.id);
                if (known?.completed) {
                    this.knownBatchById.delete(entry.id);
                }
            } else {
                const known = this.knownCommandById.get(entry.id);
                if (known?.completed) {
                    this.knownCommandById.delete(entry.id);
                }
            }
        }
        if (this.completedHistoryHead >= this.historyCapacity) {
            this.completedHistory = this.completedHistory.slice(
                this.completedHistoryHead
            );
            this.completedHistoryHead = 0;
        }
    }

    #getPendingProgramCount() {
        let count = 0;
        for (const batch of this.pendingBatchByTick.values()) {
            count += batch.commands.length;
        }
        for (const batch of this.inFlightBatchByTick.values()) {
            count += batch.commands.length;
        }
        return count;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuEffectCommandOwner는 사용할 수 없습니다.');
        }
    }
}
