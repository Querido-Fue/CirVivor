import {
    ABILITY_CREATION_ORIGIN_CODE,
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    abilityDefinitionCode,
    createAbilityEntityMetadata,
    normalizeAbilityExecutionCommand
} from '../../contract/ability_execution_contract.js';
import {
    actorActionProfileFingerprint,
    normalizeActorActionProfile
} from '../../contract/actor_action_contract.js';
import {
    normalizeTowerActorPayloadDefinition
} from '../../contract/actor_payload_contract.js';
import {
    GPU_TOWER_CREATION_MODE,
    GPU_TOWER_CREATION_STATUS,
    fingerprintGpuTowerCreationTransaction
} from '../../physics/gpu/gpu_tower_creation_abi.js';
import {
    GPU_ACTOR_ACTION_PLACEMENT_STATUS
} from '../../physics/gpu/gpu_actor_action_placement_abi.js';
import {
    THE_TOWER_RUNTIME_DATA
} from 'data/object/tower/the_tower_data.js';
import {
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_CREATION_COORDINATOR_MODE,
    createTowerRecoveryPlacementDescriptor,
    freezeTowerCreationMetadata,
    freezeTowerRecoverySpawnDescriptor,
    normalizeTowerRecoveryPlacementPolicy,
    requirePositiveSafeInteger,
    requireTransactionId
} from './tower_group_contract.js';
import {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID,
    createGpuTowerSpawnIntent
} from './gpu_tower_spawn_adapter.js';

const DEFAULT_HISTORY_CAPACITY = 65_536;
const TOWER_CREATION_TERMINAL_RECEIPT_KIND = 'tower-creation-terminal';

const REQUIRED_BACKEND_METHODS = Object.freeze([
    'canStageTowerCreation',
    'getTowerCreationRuntimeStatus',
    'getTowerGroupRuntimeStatus',
    'getAvailableTowerCreationBodyCapacity',
    'preleaseTowerCreationBodies',
    'cancelTowerCreationBodyPrelease',
    'stageTowerCreationTransaction',
    'drainCompletedTowerCreationTransactions',
    'finalizeTowerCreationTransaction',
    'cancelAllTowerCreations',
    'getEventProtocolState'
]);

const REQUIRED_REGISTRY_METHODS = Object.freeze([
    'reserveEntity',
    'activateReservedBatch',
    'cancelReservation',
    'getStatus'
]);

function requirePositiveTick(value, label = 'requestedFixedTick') {
    return requirePositiveSafeInteger(value, label);
}

function requireFinitePosition(source, label) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`${label}에는 유한한 x/y가 필요합니다.`);
    }
    return Object.freeze({ x, y });
}

function normalizeRequest(source = {}) {
    const mode = source.mode
        ?? TOWER_CREATION_COORDINATOR_MODE.CPU_EXPLICIT_DESCRIPTORS;
    if (mode === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
        return normalizeGpuSubjectActorActionRequest(source);
    }
    if (mode !== TOWER_CREATION_COORDINATOR_MODE.CPU_EXPLICIT_DESCRIPTORS) {
        throw new RangeError('Tower creation coordinator mode가 알려지지 않았습니다.');
    }
    const transactionId = requireTransactionId(source.transactionId);
    const childCount = requirePositiveSafeInteger(
        source.childCount,
        'childCount'
    );
    const requestedFixedTick = requirePositiveTick(source.requestedFixedTick);
    if (!Array.isArray(source.childSpawnDescriptors)
        || source.childSpawnDescriptors.length !== childCount) {
        throw new TypeError('childSpawnDescriptors는 childCount와 같은 dense 배열이어야 합니다.');
    }
    const descriptorArray = freezeTowerRecoverySpawnDescriptor(
        source.childSpawnDescriptors,
        'childSpawnDescriptors'
    );
    const descriptors = descriptorArray.map((frozen, index) => {
        if (!frozen || typeof frozen !== 'object') {
            throw new TypeError(`childSpawnDescriptors[${index}]가 필요합니다.`);
        }
        requireFinitePosition(
            frozen.position,
            `childSpawnDescriptors[${index}].position`
        );
        return frozen;
    });
    return Object.freeze({
        mode,
        transactionId,
        childCount,
        requestedFixedTick,
        childSpawnDescriptors: Object.freeze(descriptors)
    });
}

function normalizeGpuSubjectActorActionRequest(source = {}) {
    const transactionId = requireTransactionId(source.transactionId);
    const command = normalizeAbilityExecutionCommand(source.command);
    const completion = source.subjectCompletion;
    if (!completion || typeof completion !== 'object'
        || completion.status !== ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE
        || completion.executionId !== command.executionId
        || completion.executionOrdinal !== command.executionOrdinal
        || completion.commandFingerprint !== command.fingerprint
        || !Number.isSafeInteger(completion.subjectCount)
        || completion.subjectCount <= 0
        || !Number.isSafeInteger(completion.snapshotFingerprint)
        || completion.snapshotFingerprint <= 0) {
        throw new RangeError('R5 Tower request snapshot completion이 정확하지 않습니다.');
    }
    const childCount = requirePositiveSafeInteger(
        source.childCount ?? completion.subjectCount,
        'childCount'
    );
    if (childCount !== completion.subjectCount) {
        throw new RangeError('R5 Tower childCount는 frozen Subject count여야 합니다.');
    }
    const requestedFixedTick = requirePositiveTick(
        source.requestedFixedTick ?? source.targetFixedTick
            ?? command.targetFixedTick
    );
    if (requestedFixedTick < command.targetFixedTick
        || requestedFixedTick < completion.sourceTick) {
        throw new RangeError(
            'R5 Tower materialization tick은 snapshot tick보다 빠를 수 없습니다.'
        );
    }
    const snapshotToken = source.snapshotToken ?? completion.snapshotToken;
    if (!snapshotToken || typeof snapshotToken !== 'object'
        || snapshotToken !== completion.snapshotToken) {
        throw new TypeError('R5 Tower request에는 exact snapshot token이 필요합니다.');
    }
    const actorActionProfile = normalizeActorActionProfile(
        source.actorActionProfile,
        'R5 Tower actorActionProfile'
    );
    const profileFingerprint = actorActionProfileFingerprint(
        actorActionProfile
    );
    if (profileFingerprint !== command.actorActionProfileFingerprint
        || (source.actorActionProfileId !== undefined
            && source.actorActionProfileId !== actorActionProfile.id)
        || actorActionProfile.actionCode !== command.actionCode) {
        throw new RangeError('R5 Tower actor action profile identity가 다릅니다.');
    }
    const payloadDefinition = normalizeTowerActorPayloadDefinition(
        source.payloadDefinition
    );
    if (payloadDefinition.payloadCode !== command.payloadCode) {
        throw new RangeError('R5 Tower payload code가 command와 다릅니다.');
    }
    const recoveryPlacementPolicy = normalizeTowerRecoveryPlacementPolicy(
        source.recoveryPlacementPolicy
    );
    const sdf = freezeTowerRecoverySpawnDescriptor(source.sdf, 'sdf');
    if (!sdf || !Number.isSafeInteger(sdf.cols) || sdf.cols <= 0
        || !Number.isSafeInteger(sdf.rows) || sdf.rows <= 0
        || !(Number(sdf.worldWidth) > 0)
        || !(Number(sdf.worldHeight) > 0)) {
        throw new TypeError('R5 Tower request SDF descriptor가 유효하지 않습니다.');
    }
    const coreTarget = source.coreTarget === undefined
        ? null
        : freezeTowerRecoverySpawnDescriptor(source.coreTarget, 'coreTarget');
    return Object.freeze({
        mode: TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION,
        transactionId,
        childCount,
        requestedFixedTick,
        executionId: command.executionId,
        executionOrdinal: command.executionOrdinal,
        command,
        subjectCompletion: completion,
        snapshotToken,
        snapshotFingerprint: completion.snapshotFingerprint,
        actorActionProfileId: actorActionProfile.id,
        actorActionProfile,
        actorActionProfileFingerprint: profileFingerprint,
        payloadDefinition,
        recoveryPlacementPolicy,
        sdf,
        coreTarget
    });
}

function fingerprintNormalizedRequest(request) {
    if (request.mode
        === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
        throw new Error('R5 Tower request fingerprint에는 snapshot token identity가 필요합니다.');
    }
    return JSON.stringify({
        version: 'tower-creation-request-v2',
        mode: request.mode,
        childCount: request.childCount,
        requestedFixedTick: request.requestedFixedTick,
        childSpawnDescriptors: request.childSpawnDescriptors
    });
}

function freezeFailure(stage, error, extra = {}) {
    return Object.freeze({
        stage,
        name: String(error?.name ?? 'Error'),
        message: String(error?.message ?? error),
        ...extra
    });
}

function sameProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function terminalResult(result, reason, source = {}) {
    return Object.freeze({
        accepted: result === TOWER_CREATION_RESULT.COMMITTED,
        result,
        reason,
        recoveryRequired: result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
        createdCount: 0,
        handles: Object.freeze([]),
        ...source,
        terminal: true,
        receiptKind: TOWER_CREATION_TERMINAL_RECEIPT_KIND,
        pending: false,
        staged: false,
        phase: null
    });
}

function asTerminalReceipt(source) {
    if (source?.terminal === true
        && source.receiptKind === TOWER_CREATION_TERMINAL_RECEIPT_KIND
        && source.pending === false
        && source.staged === false
        && source.phase === null) {
        return source;
    }
    return Object.freeze({
        ...source,
        terminal: true,
        receiptKind: TOWER_CREATION_TERMINAL_RECEIPT_KIND,
        pending: false,
        staged: false,
        phase: null
    });
}

/**
 * CPU TowerGroup 계획과 Registry/body/GPU program의 0-or-N publication을
 * fixed-boundary 단위로 직렬화합니다. 한 session에서 동시 transaction은 하나입니다.
 */
export class TowerCreationCoordinator {
    constructor(options = {}) {
        const towerGroupState = options.towerGroupState;
        if (!towerGroupState
            || typeof towerGroupState.planCreation !== 'function'
            || typeof towerGroupState.previewCreation !== 'function'
            || typeof towerGroupState.refreshPendingCreation !== 'function'
            || typeof towerGroupState.commitCreation !== 'function'
            || typeof towerGroupState.rejectCreation !== 'function'
            || typeof towerGroupState.bindGpuBody !== 'function'
            || typeof towerGroupState.getTowerRecords !== 'function') {
            throw new TypeError('TowerCreationCoordinator에는 TowerGroupState가 필요합니다.');
        }
        for (const method of REQUIRED_REGISTRY_METHODS) {
            if (typeof options.registry?.[method] !== 'function') {
                throw new TypeError(`Tower creation registry.${method}가 필요합니다.`);
            }
        }
        for (const method of REQUIRED_BACKEND_METHODS) {
            if (typeof options.backend?.[method] !== 'function') {
                throw new TypeError(`Tower creation backend.${method}가 필요합니다.`);
            }
        }
        this.towerGroupState = towerGroupState;
        this.registry = options.registry;
        this.backend = options.backend;
        this.abilitySubjectSnapshotRuntime
            = options.abilitySubjectSnapshotRuntime ?? null;
        this.actorActionPlacementRuntime
            = options.actorActionPlacementRuntime ?? null;
        if (this.abilitySubjectSnapshotRuntime !== null
            && (typeof this.abilitySubjectSnapshotRuntime
                    .getSnapshotGpuBinding !== 'function'
                || typeof this.abilitySubjectSnapshotRuntime
                    .releaseSnapshot !== 'function')) {
            throw new TypeError('Tower creation snapshot runtime contract가 필요합니다.');
        }
        if (this.actorActionPlacementRuntime !== null) {
            for (const method of [
                'canAccept',
                'stage',
                'submitPendingForFixedTick',
                'drainCompleted',
                'getPlacementGpuBinding',
                'releasePlacement',
                'cancelAll'
            ]) {
                if (typeof this.actorActionPlacementRuntime[method]
                    !== 'function') {
                    throw new TypeError(
                        `Tower creation actor placement runtime.${method}가 필요합니다.`
                    );
                }
            }
        }
        this.snapshotTokenIds = new WeakMap();
        this.nextSnapshotTokenId = 1;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'Tower creation historyCapacity'
        );
        this.queued = null;
        this.pending = null;
        this.transactionEntries = new Map();
        this.completedTransactionOrder = [];
        this.actorPayloadTerminalReceipts = [];
        this.actorPayloadTerminalReceiptHighWater = 0;
        this.lastResult = null;
        this.lastCapacityStatus = null;
        this.failure = null;
        this.destroyed = false;
        this.requestedCount = 0;
        this.stagedCount = 0;
        this.committedCount = 0;
        this.rejectedCount = 0;
        this.protocolFailureCount = 0;
        this.replayedCount = 0;
        this.replayMismatchCount = 0;
        this.reservationHighWater = 0;
        this.lastCapacityStatus = this.#getCapacityStatus(0);
    }

    requestTowerCreation(source = {}) {
        if (this.destroyed || this.failure) {
            return terminalResult(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                this.destroyed ? 'DESTROYED' : 'RECOVERY_REQUIRED',
                { failure: this.failure }
            );
        }
        let request;
        try {
            request = normalizeRequest(source);
        } catch (error) {
            const result = terminalResult(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                { failure: freezeFailure('tower-creation-request', error) }
            );
            this.lastResult = result;
            this.rejectedCount++;
            return result;
        }
        this.requestedCount++;
        const requestFingerprint = this.#fingerprintRequest(request);
        const existing = this.transactionEntries.get(request.transactionId);
        if (existing) {
            if (existing.requestFingerprint === requestFingerprint) {
                this.replayedCount++;
                this.lastResult = existing.receipt;
                return existing.receipt;
            }
            const result = terminalResult(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                {
                    transactionId: request.transactionId,
                    requestFingerprint,
                    expectedRequestFingerprint: existing.requestFingerprint
                }
            );
            this.lastResult = result;
            this.protocolFailureCount++;
            this.replayMismatchCount++;
            return result;
        }
        const entry = {
            transactionId: request.transactionId,
            mode: request.mode,
            requestFingerprint,
            actorActionProfileFingerprint: request.mode
                === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION
                ? request.actorActionProfileFingerprint
                : 0,
            stage: 'received',
            receipt: null
        };
        this.transactionEntries.set(request.transactionId, entry);
        if (this.queued || this.pending) {
            const result = terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                TOWER_CREATION_REASON.CREATION_TRANSACTION_PENDING,
                { transactionId: request.transactionId, requestFingerprint }
            );
            const receipt = this.#completeTransaction(
                request.transactionId,
                result
            );
            this.lastResult = receipt;
            this.rejectedCount++;
            return receipt;
        }
        this.queued = request;
        const capacity = this.#getCapacityStatus(request.childCount);
        const receipt = Object.freeze({
            accepted: true,
            result: null,
            reason: null,
            transactionId: request.transactionId,
            requestFingerprint,
            actorActionProfileFingerprint:
                entry.actorActionProfileFingerprint,
            childCount: request.childCount,
            requestedFixedTick: request.requestedFixedTick,
            capacity,
            recoveryRequired: false
        });
        entry.stage = 'queued';
        entry.receipt = receipt;
        return receipt;
    }

    /** R5 Word preview가 mutation 없이 runtime planner/capacity reason을 조회하는 seam입니다. */
    previewTowerCreation(source = {}) {
        if (this.destroyed || this.failure) {
            return terminalResult(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                this.destroyed ? 'DESTROYED' : 'RECOVERY_REQUIRED',
                { failure: this.failure, executionEnabled: false }
            );
        }
        let childCount;
        try {
            childCount = requirePositiveSafeInteger(
                source.childCount,
                'childCount'
            );
        } catch (error) {
            return terminalResult(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                {
                    executionEnabled: false,
                    failure: freezeFailure('tower-creation-preview', error)
                }
            );
        }
        const capacity = this.#getCapacityStatus(childCount);
        const plan = this.towerGroupState.previewCreation({
            transactionId: source.transactionId ?? 'tower-creation-preview',
            childCount,
            childRecoverySpawnDescriptors:
                source.childRecoverySpawnDescriptors
        });
        let reason = plan.reason;
        let result = plan.result;
        if (plan.accepted === true) {
            reason = this.queued || this.pending
                ? TOWER_CREATION_REASON.CREATION_TRANSACTION_PENDING
                : this.#preflightCapacity(
                    capacity.requiredTowerCount,
                    childCount
                );
            result = reason === 'PROGRAM_RECOVERY_REQUIRED'
                ? TOWER_CREATION_RESULT.PROTOCOL_FAILURE
                : reason
                    ? TOWER_CREATION_RESULT.REJECTED_CAPACITY
                    : null;
        }
        return Object.freeze({
            ...plan,
            accepted: plan.accepted === true && reason === null,
            executionEnabled: plan.accepted === true && reason === null,
            result,
            reason,
            capacity,
            recoveryRequired: false
        });
    }

    stageForFixedTick(proposedFixedTick) {
        const tick = requirePositiveTick(proposedFixedTick, 'proposedFixedTick');
        if (this.destroyed || this.failure) {
            return Object.freeze({
                accepted: false,
                staged: false,
                recoveryRequired: true,
                failure: this.failure
            });
        }
        if (this.pending || !this.queued) {
            return Object.freeze({
                accepted: true,
                staged: false,
                pending: this.pending !== null,
                recoveryRequired: false
            });
        }
        const request = this.queued;
        if (request.requestedFixedTick > tick) {
            return Object.freeze({
                accepted: true,
                staged: false,
                deferred: true,
                requestedFixedTick: request.requestedFixedTick,
                recoveryRequired: false
            });
        }
        if (request.requestedFixedTick < tick) {
            this.queued = null;
            if (request.mode
                === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
                this.abilitySubjectSnapshotRuntime?.releaseSnapshot(
                    request.snapshotToken
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        if (request.mode
            === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
            return this.#stageGpuSubjectActorAction(request, tick);
        }

        const sourceRecords = this.towerGroupState.getTowerRecords()
            .filter((record) => record.alive);
        if (sourceRecords.length === 0
            || sourceRecords.some((record) => !record.exactGpuBinding)) {
            this.queued = null;
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }

        const plan = this.towerGroupState.planCreation({
            transactionId: request.transactionId,
            childCount: request.childCount,
            childRecoverySpawnDescriptors: request.childSpawnDescriptors
        });
        if (plan?.accepted !== true) {
            this.queued = null;
            return this.#publishTerminal(Object.freeze({
                ...plan,
                transactionId: request.transactionId,
                sourceTick: tick
            }));
        }

        const capacityFailure = this.#preflightCapacity(
            sourceRecords.length + request.childCount,
            request.childCount
        );
        if (capacityFailure) {
            if (capacityFailure === 'PROGRAM_RECOVERY_REQUIRED') {
                this.towerGroupState.rejectCreation(
                    plan,
                    capacityFailure,
                    TOWER_CREATION_RESULT.PROTOCOL_FAILURE
                );
                this.queued = null;
                return this.#latchProtocolFailure(
                    'tower-creation-program-preflight',
                    new Error(capacityFailure),
                    { transactionId: request.transactionId }
                );
            }
            this.towerGroupState.rejectCreation(
                plan,
                capacityFailure,
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                capacityFailure,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }

        const handles = [];
        try {
            for (let index = 0; index < request.childCount; index++) {
                const handle = this.registry.reserveEntity({
                    kindId: GPU_TOWER_WORLD_KIND_ID,
                    definitionId: GPU_TOWER_DEFINITION_ID,
                    createdAtTick: tick
                });
                if (!handle) throw new Error('Tower creation registry capacity');
                handles.push(handle);
            }
        } catch (error) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                'REGISTRY_CAPACITY',
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            if (!clean) {
                return this.#latchProtocolFailure(
                    'tower-creation-registry-reserve-rollback',
                    error,
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                'REGISTRY_CAPACITY',
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        this.reservationHighWater = Math.max(
            this.reservationHighWater,
            handles.length
        );

        let spawnIntents;
        let childAbilityMetadata;
        let childRegistryMetadata;
        try {
            spawnIntents = plan.children.map((child, index) => Object.freeze({
                ...createGpuTowerSpawnIntent({
                    position: request.childSpawnDescriptors[index].position,
                    currentHpFixedPoint: child.currentHpFixedPoint,
                    logicalTowerOrdinal: child.logicalTowerOrdinal,
                    shareUnits: child.shareUnits,
                    maxHpFixedPoint: child.maxHpFixedPoint,
                    powerFixedPoint: child.powerFixedPoint,
                    towerGroupRevision: plan.targetGroupRevision
                }),
                logicalTowerId: child.logicalTowerId,
                recoverySpawnDescriptor: request.childSpawnDescriptors[index]
            }));
            childAbilityMetadata = plan.children.map((child, index) => (
                createAbilityEntityMetadata({
                    kindId: GPU_TOWER_WORLD_KIND_ID,
                    definitionId: GPU_TOWER_DEFINITION_ID,
                    metadata: spawnIntents[index]
                }, {
                    creationOriginCode: ABILITY_CREATION_ORIGIN_CODE.NATURAL,
                    powerFixedPoint: child.powerFixedPoint
                })
            ));
            childRegistryMetadata = plan.children.map((child) => Object.freeze({
                logicalTowerId: child.logicalTowerId,
                logicalTowerOrdinal: child.logicalTowerOrdinal,
                shareUnits: child.shareUnits,
                currentHpFixedPoint: child.currentHpFixedPoint,
                maxHpFixedPoint: child.maxHpFixedPoint,
                powerFixedPoint: child.powerFixedPoint,
                towerGroupRevision: plan.targetGroupRevision
            }));
        } catch (error) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR
            );
            this.queued = null;
            if (!clean) {
                return this.#latchProtocolFailure(
                    'tower-creation-descriptor-rollback',
                    error,
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    failure: freezeFailure('tower-creation-spawn-intent', error)
                }
            ));
        }

        let prelease;
        try {
            prelease = this.backend.preleaseTowerCreationBodies({
                transactionId: request.transactionId,
                handles,
                spawnIntents
            });
        } catch (error) {
            prelease = Object.freeze({
                accepted: false,
                reason: 'tower-creation-body-prelease-contract',
                requiresRecovery: false,
                failure: freezeFailure('tower-creation-body-prelease', error)
            });
        }
        if (prelease?.accepted !== true) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                String(prelease?.reason ?? 'BODY_CAPACITY'),
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            if (!clean || prelease?.requiresRecovery === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-body-prelease',
                    prelease?.failure ?? new Error(prelease?.reason),
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                String(prelease?.reason ?? 'BODY_CAPACITY'),
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    ...(prelease?.failure
                        ? { failure: prelease.failure }
                        : {})
                }
            ));
        }

        const protocol = this.backend.getEventProtocolState();
        const transactionFingerprint = fingerprintGpuTowerCreationTransaction(
            plan.fingerprint,
            tick,
            plan.sourceGroupRevision,
            plan.targetGroupRevision,
            ...handles.flatMap((handle) => [
                handle.entityId,
                handle.incarnation
            ])
        );
        const staged = this.backend.stageTowerCreationTransaction({
            preleaseToken: prelease.token,
            plan,
            sourceRecords,
            childAbilityMetadata,
            transactionFingerprint,
            sourceTick: tick,
            towerDefinitionCode: abilityDefinitionCode(
                GPU_TOWER_DEFINITION_ID
            )
        });
        if (staged?.accepted !== true) {
            const bodyCancel = this.backend.cancelTowerCreationBodyPrelease(
                prelease.token,
                'tower-creation-stage-rejected'
            );
            const registryClean = this.#cancelReservations(handles);
            const sourceChanged = String(staged?.reason).includes('source-changed');
            const result = sourceChanged
                ? TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
                : TOWER_CREATION_RESULT.REJECTED_CAPACITY;
            this.towerGroupState.rejectCreation(
                plan,
                String(staged?.reason ?? 'PROGRAM_CAPACITY'),
                result
            );
            this.queued = null;
            if (!registryClean
                || bodyCancel?.requiresRecovery === true
                || staged?.recoveryRequired === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-stage',
                    staged?.failure ?? new Error(staged?.reason),
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                result,
                String(staged?.reason ?? 'PROGRAM_CAPACITY'),
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    ...(staged?.failure ? { failure: staged.failure } : {})
                }
            ));
        }

        this.pending = Object.freeze({
            request,
            plan,
            sourceRecords: Object.freeze([...sourceRecords]),
            handles: Object.freeze([...handles]),
            spawnIntents: Object.freeze(spawnIntents),
            childAbilityMetadata: Object.freeze(childAbilityMetadata),
            childRegistryMetadata: Object.freeze(childRegistryMetadata),
            preleaseToken: prelease.token,
            transactionFingerprint,
            protocol: Object.freeze({ ...protocol }),
            stageReceipt: staged
        });
        this.queued = null;
        this.stagedCount++;
        const receipt = Object.freeze({
            ...staged,
            staged: true,
            requestFingerprint: this.transactionEntries.get(
                request.transactionId
            )?.requestFingerprint ?? null,
            capacity: this.#getCapacityStatus(0),
            recoveryRequired: false
        });
        this.#setTransactionReceipt(
            request.transactionId,
            'pending',
            receipt
        );
        return receipt;
    }

    #stageGpuSubjectActorAction(request, tick) {
        const supportsR5 = this.abilitySubjectSnapshotRuntime
            && this.actorActionPlacementRuntime
            && typeof this.backend.supportsGpuSubjectActorActionTowerCreation
                === 'function'
            && this.backend.supportsGpuSubjectActorActionTowerCreation()
            && this.actorActionPlacementRuntime.canAccept();
        if (!supportsR5) {
            this.queued = null;
            this.abilitySubjectSnapshotRuntime?.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                'RUNTIME_UNAVAILABLE',
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    recoveryRequired: false
                }
            ));
        }
        const zeroSharePreflight = this.towerGroupState.previewCreation({
            transactionId: request.transactionId,
            childCount: request.childCount
        });
        if (zeroSharePreflight?.result
            === TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE) {
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(Object.freeze({
                ...zeroSharePreflight,
                transactionId: request.transactionId,
                sourceTick: tick
            }));
        }
        const snapshotBinding = this.abilitySubjectSnapshotRuntime
            .getSnapshotGpuBinding(request.snapshotToken);
        const exactSnapshot = snapshotBinding
            && snapshotBinding.subjectCount === request.childCount
            && snapshotBinding.executionOrdinal === request.executionOrdinal
            && snapshotBinding.commandFingerprint === request.command.fingerprint
            && snapshotBinding.snapshotFingerprint
                === request.snapshotFingerprint
            && snapshotBinding.sourceTick
                === request.subjectCompletion.sourceTick;
        if (!exactSnapshot) {
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        const sourceRecords = this.towerGroupState.getTowerRecords()
            .filter((record) => record.alive);
        const plan = this.towerGroupState.planCreation({
            transactionId: request.transactionId,
            childCount: request.childCount
        });
        if (plan?.accepted !== true) {
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(Object.freeze({
                ...plan,
                transactionId: request.transactionId,
                sourceTick: tick
            }));
        }
        if (sourceRecords.length === 0
            || sourceRecords.some((record) => !record.exactGpuBinding)) {
            this.towerGroupState.rejectCreation(
                plan,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        const capacityFailure = this.#preflightCapacity(
            sourceRecords.length + request.childCount,
            request.childCount
        );
        if (capacityFailure) {
            this.towerGroupState.rejectCreation(
                plan,
                capacityFailure,
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                capacityFailure,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }

        const recoveryDescriptors = plan.children.map((child) => (
            createTowerRecoveryPlacementDescriptor(
                request.recoveryPlacementPolicy,
                child.logicalTowerOrdinal
            )
        ));
        const handles = [];
        try {
            for (let index = 0; index < request.childCount; index++) {
                const handle = this.registry.reserveEntity({
                    kindId: GPU_TOWER_WORLD_KIND_ID,
                    definitionId: GPU_TOWER_DEFINITION_ID,
                    createdAtTick: tick
                });
                if (!handle) throw new Error('Tower creation registry capacity');
                handles.push(handle);
            }
        } catch (error) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                'REGISTRY_CAPACITY',
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            if (!clean) {
                return this.#latchProtocolFailure(
                    'tower-creation-registry-reserve-rollback',
                    error,
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                'REGISTRY_CAPACITY',
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        this.reservationHighWater = Math.max(
            this.reservationHighWater,
            handles.length
        );

        const visibleFromExecutionOrdinal = request.executionOrdinal + 1;
        let spawnIntents;
        let childAbilityMetadata;
        try {
            if (visibleFromExecutionOrdinal >= 0xffffffff) {
                throw new RangeError('visible execution ordinal이 소진되었습니다.');
            }
            spawnIntents = plan.children.map((child, index) => Object.freeze({
                ...createGpuTowerSpawnIntent({
                    position: recoveryDescriptors[index].anchorPosition,
                    currentHpFixedPoint: child.currentHpFixedPoint,
                    logicalTowerOrdinal: child.logicalTowerOrdinal,
                    shareUnits: child.shareUnits,
                    maxHpFixedPoint: child.maxHpFixedPoint,
                    powerFixedPoint: child.powerFixedPoint,
                    towerGroupRevision: plan.targetGroupRevision
                }),
                logicalTowerId: child.logicalTowerId,
                recoverySpawnDescriptor: recoveryDescriptors[index]
            }));
            childAbilityMetadata = plan.children.map((child) => (
                createAbilityEntityMetadata({
                    kindId: GPU_TOWER_WORLD_KIND_ID,
                    definitionId: GPU_TOWER_DEFINITION_ID,
                    metadata: {}
                }, {
                    sourceAbilityCode: request.command.compiledAbilityCode,
                    sourceExecutionFingerprint:
                        request.command.executionIdFingerprint,
                    sourceExecutionOrdinal: request.executionOrdinal,
                    generation: 0,
                    visibleFromExecutionOrdinal,
                    creationOriginCode:
                        request.payloadDefinition.creationOriginCode,
                    powerFixedPoint: child.powerFixedPoint
                })
            ));
        } catch (error) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            if (!clean) {
                return this.#latchProtocolFailure(
                    'tower-creation-r5-descriptor-rollback',
                    error,
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    failure: freezeFailure('tower-creation-r5-intent', error)
                }
            ));
        }

        let prelease;
        try {
            prelease = this.backend.preleaseTowerCreationBodies({
                transactionId: request.transactionId,
                handles,
                spawnIntents
            });
        } catch (error) {
            prelease = Object.freeze({
                accepted: false,
                reason: 'tower-creation-body-prelease-contract',
                requiresRecovery: false,
                failure: freezeFailure('tower-creation-body-prelease', error)
            });
        }
        if (prelease?.accepted !== true) {
            const clean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                String(prelease?.reason ?? 'BODY_CAPACITY'),
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            if (!clean || prelease?.requiresRecovery === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-body-prelease',
                    prelease?.failure ?? new Error(prelease?.reason),
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                String(prelease?.reason ?? 'BODY_CAPACITY'),
                {
                    transactionId: request.transactionId,
                    sourceTick: tick,
                    ...(prelease?.failure
                        ? { failure: prelease.failure }
                        : {})
                }
            ));
        }
        const destinationLeases = Object.freeze(handles.map((handle, index) => (
            Object.freeze({
                destinationSlot: prelease.slots[index],
                destinationEntityId: handle.entityId,
                destinationIncarnation: handle.incarnation,
                snapshotRank: index,
                destinationRank: index,
                baselineFlags: 0
            })
        )));
        const placementStage = this.actorActionPlacementRuntime.stage({
            transactionId: request.transactionId,
            completionOwner: 'tower-creation',
            command: request.command,
            subjectCompletion: request.subjectCompletion,
            snapshotBinding,
            destinationLeases,
            actorActionProfile: request.actorActionProfile,
            targetFixedTick: tick,
            sdf: request.sdf,
            coreTarget: request.coreTarget
        });
        if (placementStage?.accepted !== true) {
            const body = this.backend.cancelTowerCreationBodyPrelease(
                prelease.token,
                'actor-action-placement-stage-rejected'
            );
            const registryClean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                'ACTOR_ACTION_PLACEMENT_REJECTED',
                TOWER_CREATION_RESULT.REJECTED_CAPACITY
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            if (!registryClean || body?.requiresRecovery === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-placement-stage-rollback',
                    placementStage,
                    { transactionId: request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                String(placementStage?.reason
                    ?? 'ACTOR_ACTION_PLACEMENT_REJECTED'),
                { transactionId: request.transactionId, sourceTick: tick }
            ));
        }
        const submission = this.actorActionPlacementRuntime
            .submitPendingForFixedTick(tick);
        if (submission?.failure) {
            const body = this.backend.cancelTowerCreationBodyPrelease(
                prelease.token,
                'actor-action-placement-submit-failed'
            );
            const registryClean = this.#cancelReservations(handles);
            this.towerGroupState.rejectCreation(
                plan,
                'ACTOR_ACTION_PLACEMENT_SUBMIT_FAILED',
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE
            );
            this.queued = null;
            this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                request.snapshotToken
            );
            if (!registryClean || body?.requiresRecovery === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-placement-submit-rollback',
                    submission.failure,
                    { transactionId: request.transactionId }
                );
            }
            return this.#latchProtocolFailure(
                'tower-creation-placement-submit',
                submission.failure,
                { transactionId: request.transactionId }
            );
        }
        const protocol = this.backend.getEventProtocolState();
        this.pending = Object.freeze({
            phase: 'actor-action-placement',
            request,
            plan,
            sourceRecords: Object.freeze([...sourceRecords]),
            handles: Object.freeze([...handles]),
            spawnIntents: Object.freeze(spawnIntents),
            recoveryDescriptors: Object.freeze(recoveryDescriptors),
            childAbilityMetadata: Object.freeze(childAbilityMetadata),
            preleaseToken: prelease.token,
            destinationLeases,
            protocol: Object.freeze({ ...protocol }),
            placementStage,
            stageReceipt: Object.freeze({ sourceTick: tick })
        });
        this.queued = null;
        this.stagedCount++;
        const receipt = Object.freeze({
            ...placementStage,
            staged: true,
            pending: true,
            phase: 'actor-action-placement',
            sourceTick: tick,
            requestFingerprint: this.transactionEntries.get(
                request.transactionId
            )?.requestFingerprint ?? null,
            capacity: this.#getCapacityStatus(0),
            recoveryRequired: false
        });
        this.#setTransactionReceipt(
            request.transactionId,
            'placement-pending',
            receipt
        );
        return receipt;
    }

    observeCompletedAtFixedBoundary(proposedFixedTick) {
        const tick = requirePositiveTick(proposedFixedTick, 'proposedFixedTick');
        if (this.destroyed || this.failure) {
            return Object.freeze({
                pending: false,
                committed: false,
                recoveryRequired: true,
                failure: this.failure
            });
        }
        if (this.pending?.phase === 'actor-action-placement') {
            return this.#observeActorActionPlacement(tick);
        }
        const completions = this.backend
            .drainCompletedTowerCreationTransactions([]);
        if (!Array.isArray(completions) || completions.length > 1) {
            return this.#failPendingProtocol(
                'tower-creation-completion-cardinality',
                completions
            );
        }
        if (!this.pending) {
            if (completions.length !== 0) {
                return this.#failPendingProtocol(
                    'tower-creation-orphan-completion',
                    completions[0]
                );
            }
            return Object.freeze({
                pending: false,
                committed: false,
                recoveryRequired: false
            });
        }
        if (completions.length === 0) {
            return Object.freeze({
                pending: tick > this.pending.stageReceipt.sourceTick,
                committed: false,
                transactionId: this.pending.request.transactionId,
                sourceTick: this.pending.stageReceipt.sourceTick,
                recoveryRequired: false
            });
        }
        const completion = completions[0];
        if (!this.#isAuthenticCompletion(completion, tick)) {
            return this.#failPendingProtocol(
                'tower-creation-completion-provenance',
                completion
            );
        }
        if (completion.protocolFailure
            || completion.result === GPU_TOWER_CREATION_STATUS.PROTOCOL_FAILURE
            || completion.recoveryRequired) {
            return this.#failPendingProtocol(
                'tower-creation-gpu-protocol',
                completion
            );
        }
        return completion.committed
            ? this.#commitPending(completion)
            : this.#rejectPending(completion);
    }

    /**
     * Accepted GPU Subject actor-payload transaction의 authentic terminal만
     * execution/cooldown owner가 exact-once로 가져가는 경계입니다.
     */
    drainActorPayloadTerminalReceipts(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('Tower payload terminal receipt 출력은 배열이어야 합니다.');
        }
        out.push(...this.actorPayloadTerminalReceipts);
        this.actorPayloadTerminalReceipts.length = 0;
        return out;
    }

    #observeActorActionPlacement(tick) {
        const pending = this.pending;
        const completions = this.actorActionPlacementRuntime
            .drainCompleted([]);
        if (!Array.isArray(completions) || completions.length > 1) {
            return this.#failPendingProtocol(
                'tower-creation-placement-completion-cardinality',
                completions
            );
        }
        if (completions.length === 0) {
            return Object.freeze({
                pending: true,
                committed: false,
                phase: 'actor-action-placement',
                transactionId: pending.request.transactionId,
                sourceTick: pending.stageReceipt.sourceTick,
                recoveryRequired: false
            });
        }
        const completion = completions[0];
        const exact = completion.transactionId
                === pending.request.transactionId
            && completion.executionOrdinal
                === pending.request.executionOrdinal
            && completion.commandFingerprint
                === pending.request.command.fingerprint
            && completion.snapshotFingerprint
                === pending.request.snapshotFingerprint
            && completion.subjectCount === pending.request.childCount
            && completion.actorActionProfileFingerprint
                === pending.request.actorActionProfileFingerprint
            && sameProtocol(completion, pending.protocol);
        if (!exact) {
            return this.#failPendingProtocol(
                'tower-creation-placement-completion-provenance',
                completion
            );
        }
        this.abilitySubjectSnapshotRuntime.releaseSnapshot(
            pending.request.snapshotToken
        );
        if (completion.status
                !== GPU_ACTOR_ACTION_PLACEMENT_STATUS.COMPLETE
            || !completion.placementToken) {
            const body = this.backend.cancelTowerCreationBodyPrelease(
                pending.preleaseToken,
                'actor-action-placement-rejected'
            );
            const registryClean = this.#cancelReservations(pending.handles);
            const result = completion.status
                    === GPU_ACTOR_ACTION_PLACEMENT_STATUS.SDF_REJECTED
                ? TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR
                : TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED;
            this.towerGroupState.rejectCreation(
                pending.plan,
                'ACTOR_ACTION_PLACEMENT_REJECTED',
                result
            );
            this.pending = null;
            if (!registryClean || body?.requiresRecovery === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-placement-rejection-rollback',
                    completion,
                    { transactionId: pending.request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                result,
                'ACTOR_ACTION_PLACEMENT_REJECTED',
                {
                    transactionId: pending.request.transactionId,
                    sourceTick: tick,
                    placementEvidence: completion,
                    recoveryRequired: false
                }
            ));
        }
        const placementBinding = this.actorActionPlacementRuntime
            .getPlacementGpuBinding(completion.placementToken);
        const exactBinding = placementBinding
            && placementBinding.subjectCount === pending.request.childCount
            && placementBinding.executionOrdinal
                === pending.request.executionOrdinal
            && placementBinding.commandFingerprint
                === pending.request.command.fingerprint
            && placementBinding.snapshotFingerprint
                === pending.request.snapshotFingerprint
            && placementBinding.destinationFingerprint
                === completion.destinationFingerprint
            && placementBinding.placementFingerprint
                === completion.placementFingerprint
            && placementBinding.actorActionProfileFingerprint
                === pending.request.actorActionProfileFingerprint;
        if (!exactBinding) {
            return this.#failPendingProtocol(
                'tower-creation-placement-binding-provenance',
                Object.freeze({
                    completion,
                    placementBinding,
                    placementToken: completion.placementToken
                })
            );
        }
        this.pending = Object.freeze({
            ...pending,
            phase: 'actor-action-placement-ready',
            placementToken: completion.placementToken,
            placementBinding
        });
        const receipt = Object.freeze({
            accepted: true,
            staged: false,
            pending: true,
            readyForCreationStage: true,
            phase: 'actor-action-placement-ready',
            transactionId: pending.request.transactionId,
            sourceTick: tick,
            requestFingerprint: this.transactionEntries.get(
                pending.request.transactionId
            )?.requestFingerprint ?? null,
            capacity: this.#getCapacityStatus(0),
            recoveryRequired: false
        });
        this.#setTransactionReceipt(
            pending.request.transactionId,
            'placement-ready',
            receipt
        );
        return receipt;
    }

    /**
     * Placement readback 뒤 같은 fixed boundary의 completed damage를 먼저 반영한
     * 후 fresh Tower plan으로 creation program을 stage합니다.
     */
    stageReadyActorActionPlacementAtFixedBoundary(proposedFixedTick) {
        const tick = requirePositiveTick(proposedFixedTick, 'proposedFixedTick');
        if (this.destroyed || this.failure) {
            return Object.freeze({
                accepted: false,
                staged: false,
                recoveryRequired: true,
                failure: this.failure
            });
        }
        if (this.pending?.phase !== 'actor-action-placement-ready') {
            return Object.freeze({
                accepted: true,
                staged: false,
                pending: this.pending !== null,
                recoveryRequired: false
            });
        }
        const pending = this.pending;
        const plan = this.towerGroupState.refreshPendingCreation({
            plan: pending.plan,
            childRecoverySpawnDescriptors: pending.recoveryDescriptors
        });
        if (plan?.accepted !== true) {
            this.actorActionPlacementRuntime.releasePlacement(
                pending.placementToken
            );
            const body = this.backend.cancelTowerCreationBodyPrelease(
                pending.preleaseToken,
                'tower-creation-source-refresh-rejected'
            );
            const registryClean = this.#cancelReservations(pending.handles);
            this.pending = null;
            if (!registryClean || body?.requiresRecovery === true
                || plan?.result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE) {
                return this.#latchProtocolFailure(
                    'tower-creation-source-refresh',
                    plan,
                    { transactionId: pending.request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                plan?.result ?? TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                plan?.reason ?? TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                {
                    transactionId: pending.request.transactionId,
                    sourceTick: tick,
                    recoveryRequired: false
                }
            ));
        }
        const sourceRecords = this.towerGroupState.getTowerRecords()
            .filter((record) => record.alive);
        const exactPlan = sourceRecords.length === plan.existing.length
            && plan.children.length === pending.handles.length
            && plan.children.every((child, index) => (
                child.logicalTowerOrdinal
                    === pending.recoveryDescriptors[index]
                        .logicalTowerOrdinal
            ));
        if (!exactPlan) {
            return this.#failPendingProtocol(
                'tower-creation-source-refresh-provenance',
                plan
            );
        }
        const visibleFromExecutionOrdinal = pending.request.executionOrdinal + 1;
        const spawnIntents = plan.children.map((child, index) => Object.freeze({
            ...createGpuTowerSpawnIntent({
                position: pending.recoveryDescriptors[index].anchorPosition,
                currentHpFixedPoint: child.currentHpFixedPoint,
                logicalTowerOrdinal: child.logicalTowerOrdinal,
                shareUnits: child.shareUnits,
                maxHpFixedPoint: child.maxHpFixedPoint,
                powerFixedPoint: child.powerFixedPoint,
                towerGroupRevision: plan.targetGroupRevision
            }),
            logicalTowerId: child.logicalTowerId,
            recoverySpawnDescriptor: pending.recoveryDescriptors[index]
        }));
        const childAbilityMetadata = plan.children.map((child) => (
            createAbilityEntityMetadata({
                kindId: GPU_TOWER_WORLD_KIND_ID,
                definitionId: GPU_TOWER_DEFINITION_ID,
                metadata: {}
            }, {
                sourceAbilityCode: pending.request.command.compiledAbilityCode,
                sourceExecutionFingerprint:
                    pending.request.command.executionIdFingerprint,
                sourceExecutionOrdinal: pending.request.executionOrdinal,
                generation: 0,
                visibleFromExecutionOrdinal,
                creationOriginCode:
                    pending.request.payloadDefinition.creationOriginCode,
                powerFixedPoint: child.powerFixedPoint
            })
        ));
        const placementBinding = pending.placementBinding;
        const requestFingerprint = this.transactionEntries.get(
            pending.request.transactionId
        )?.requestFingerprint;
        const transactionFingerprint = fingerprintGpuTowerCreationTransaction(
            plan.fingerprint,
            requestFingerprint,
            tick,
            plan.sourceGroupRevision,
            plan.targetGroupRevision,
            placementBinding.commandFingerprint,
            placementBinding.snapshotFingerprint,
            placementBinding.destinationFingerprint,
            placementBinding.placementFingerprint,
            placementBinding.actorActionProfileFingerprint,
            ...pending.handles.flatMap((handle) => [
                handle.entityId,
                handle.incarnation
            ])
        );
        const actorAction = Object.freeze({
            placementAbiVersion: placementBinding.abiVersion,
            executionOrdinal: pending.request.executionOrdinal,
            commandFingerprint: pending.request.command.fingerprint,
            snapshotFingerprint: pending.request.snapshotFingerprint,
            destinationFingerprint: placementBinding.destinationFingerprint,
            placementFingerprint: placementBinding.placementFingerprint,
            actorActionProfileFingerprint:
                pending.request.actorActionProfileFingerprint,
            sourceAbilityCode: pending.request.command.compiledAbilityCode,
            sourceExecutionFingerprint:
                pending.request.command.executionIdFingerprint,
            actionCode: pending.request.command.actionCode,
            payloadCode: pending.request.command.payloadCode,
            travelDurationFixedTicks:
                pending.request.actorActionProfile.travelDurationFixedTicks,
            creationOriginCode:
                pending.request.payloadDefinition.creationOriginCode,
            visibleFromExecutionOrdinal,
            snapshotSourceTick: pending.request.subjectCompletion.sourceTick
        });
        const staged = this.backend.stageTowerCreationTransaction({
            preleaseToken: pending.preleaseToken,
            plan,
            sourceRecords,
            childAbilityMetadata,
            transactionFingerprint,
            sourceTick: tick,
            towerDefinitionCode: pending.request.payloadDefinition
                .definitionCode,
            mode: GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION,
            actorAction,
            actorActionPlacementBinding: placementBinding
        });
        if (staged?.accepted !== true) {
            this.actorActionPlacementRuntime.releasePlacement(
                pending.placementToken
            );
            const body = this.backend.cancelTowerCreationBodyPrelease(
                pending.preleaseToken,
                'tower-creation-r5-stage-rejected'
            );
            const registryClean = this.#cancelReservations(pending.handles);
            const sourceChanged = String(staged?.reason)
                .includes('source-changed');
            const result = sourceChanged
                ? TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
                : TOWER_CREATION_RESULT.REJECTED_CAPACITY;
            this.towerGroupState.rejectCreation(
                plan,
                String(staged?.reason ?? 'PROGRAM_CAPACITY'),
                result
            );
            this.pending = null;
            if (!registryClean || body?.requiresRecovery === true
                || staged?.recoveryRequired === true) {
                return this.#latchProtocolFailure(
                    'tower-creation-r5-stage',
                    staged,
                    { transactionId: pending.request.transactionId }
                );
            }
            return this.#publishTerminal(terminalResult(
                result,
                String(staged?.reason ?? 'PROGRAM_CAPACITY'),
                {
                    transactionId: pending.request.transactionId,
                    sourceTick: tick,
                    ...(staged?.failure ? { failure: staged.failure } : {})
                }
            ));
        }
        this.pending = Object.freeze({
            ...pending,
            phase: 'tower-creation',
            plan,
            sourceRecords: Object.freeze([...sourceRecords]),
            spawnIntents: Object.freeze(spawnIntents),
            childAbilityMetadata: Object.freeze(childAbilityMetadata),
            actorAction,
            transactionFingerprint,
            stageReceipt: staged
        });
        const receipt = Object.freeze({
            ...staged,
            staged: true,
            pending: true,
            phase: 'tower-creation',
            requestFingerprint,
            capacity: this.#getCapacityStatus(0),
            recoveryRequired: false
        });
        this.#setTransactionReceipt(
            pending.request.transactionId,
            'pending',
            receipt
        );
        return receipt;
    }

    getStatus() {
        const runtime = this.backend?.getTowerCreationRuntimeStatus?.()
            ?? null;
        return Object.freeze({
            state: this.destroyed
                ? 'destroyed'
                : this.failure
                    ? 'requires-recovery'
                    : this.pending
                        ? 'pending'
                        : this.queued
                            ? 'queued'
                            : 'idle',
            queuedTransaction: this.queued
                ? Object.freeze({
                    transactionId: this.queued.transactionId,
                    mode: this.queued.mode,
                    childCount: this.queued.childCount,
                    requestedFixedTick: this.queued.requestedFixedTick
                })
                : null,
            pendingTransaction: this.pending
                ? Object.freeze({
                    transactionId: this.pending.request.transactionId,
                    mode: this.pending.request.mode,
                    phase: this.pending.phase ?? 'tower-creation',
                    childCount: this.pending.request.childCount,
                    sourceTick: this.pending.stageReceipt.sourceTick,
                    transactionFingerprint:
                        this.pending.transactionFingerprint
                })
                : null,
            capacity: this.#getCapacityStatus(0),
            requestedCount: this.requestedCount,
            stagedCount: this.stagedCount,
            committedCount: this.committedCount,
            rejectedCount: this.rejectedCount,
            protocolFailureCount: this.protocolFailureCount,
            replayedCount: this.replayedCount,
            replayMismatchCount: this.replayMismatchCount,
            reservationHighWater: this.reservationHighWater,
            aggregateReadbackByteSize:
                runtime?.resultReadbackBytes ?? 0,
            metadataCommitRecordByteSize:
                runtime?.metadataCommitRecordBytes ?? 0,
            metadataCommitReadbackBytesMax:
                runtime?.metadataCommitReadbackBytesMax ?? 0,
            storageProfile: runtime?.storageProfile ?? null,
            historyCount: this.completedTransactionOrder.length,
            historyCapacity: this.historyCapacity,
            pendingActorPayloadTerminalReceiptCount:
                this.actorPayloadTerminalReceipts.length,
            actorPayloadTerminalReceiptHighWater:
                this.actorPayloadTerminalReceiptHighWater,
            transactionEntryCount: this.transactionEntries.size,
            activeTransactionCount: this.transactionEntries.size
                - this.completedTransactionOrder.length,
            lastResult: this.lastResult,
            failure: this.failure,
            requiresRecovery: this.failure !== null
        });
    }

    requiresRecovery() {
        return this.failure !== null;
    }

    cancelPending(reason = 'cancelled') {
        if (this.destroyed) {
            return Object.freeze({
                cancelled: false,
                reason: 'destroyed',
                recoveryRequired: false
            });
        }
        if (this.queued) {
            const queued = this.queued;
            this.queued = null;
            if (queued.mode
                === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
                this.abilitySubjectSnapshotRuntime?.releaseSnapshot(
                    queued.snapshotToken
                );
            }
            const receipt = this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                String(reason || 'cancelled'),
                { transactionId: queued.transactionId }
            ));
            this.lastResult = receipt;
        }
        if (!this.pending) {
            return Object.freeze({
                cancelled: true,
                reason,
                recoveryRequired: false
            });
        }
        const pending = this.pending;
        let backend;
        if (pending.phase === 'actor-action-placement'
            || pending.phase === 'actor-action-placement-ready') {
            this.actorActionPlacementRuntime.cancelAll(reason);
            if (pending.placementToken) {
                this.actorActionPlacementRuntime.releasePlacement(
                    pending.placementToken
                );
            }
            if (pending.phase === 'actor-action-placement') {
                this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                    pending.request.snapshotToken
                );
            }
            backend = this.backend.cancelTowerCreationBodyPrelease(
                pending.preleaseToken,
                reason
            );
        } else {
            backend = this.backend.cancelAllTowerCreations(reason);
            if (pending.placementToken) {
                this.actorActionPlacementRuntime?.releasePlacement(
                    pending.placementToken
                );
            }
        }
        const registryClean = this.#cancelReservations(pending.handles);
        this.towerGroupState.rejectCreation(
            pending.plan,
            String(reason || 'cancelled'),
            TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
        );
        this.pending = null;
        const recoveryRequired = backend?.requiresRecovery === true
            || !registryClean;
        if (recoveryRequired) {
            this.failure = freezeFailure(
                'tower-creation-cancel',
                new Error('Submitted Tower creation cancellation requires rebuild.')
            );
        }
        this.#publishTerminal(terminalResult(
            recoveryRequired
                ? TOWER_CREATION_RESULT.PROTOCOL_FAILURE
                : TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
            String(reason || 'cancelled'),
            {
                transactionId: pending.request.transactionId,
                recoveryRequired
            }
        ));
        return Object.freeze({
            cancelled: true,
            reason,
            recoveryRequired
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.cancelPending('destroyed');
        this.destroyed = true;
        this.queued = null;
        this.pending = null;
        this.actorPayloadTerminalReceipts.length = 0;
        this.registry = null;
        this.backend = null;
        this.towerGroupState = null;
        this.abilitySubjectSnapshotRuntime = null;
        this.actorActionPlacementRuntime = null;
    }

    #fingerprintRequest(request) {
        if (request.mode
            !== TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
            return fingerprintNormalizedRequest(request);
        }
        let snapshotTokenId = this.snapshotTokenIds.get(
            request.snapshotToken
        );
        if (snapshotTokenId === undefined) {
            snapshotTokenId = this.nextSnapshotTokenId++;
            this.snapshotTokenIds.set(request.snapshotToken, snapshotTokenId);
        }
        return JSON.stringify({
            version: 'tower-creation-request-v2',
            mode: request.mode,
            transactionId: request.transactionId,
            executionId: request.executionId,
            executionOrdinal: request.executionOrdinal,
            commandFingerprint: request.command.fingerprint,
            snapshotTokenId,
            snapshotFingerprint: request.snapshotFingerprint,
            subjectCount: request.childCount,
            actorActionProfileId: request.actorActionProfileId,
            actorActionProfileFingerprint:
                request.actorActionProfileFingerprint,
            actorActionProfile: request.actorActionProfile,
            payloadDefinition: request.payloadDefinition,
            requestedFixedTick: request.requestedFixedTick,
            recoveryPlacementPolicy: request.recoveryPlacementPolicy,
            sdf: request.sdf,
            coreTarget: request.coreTarget
        });
    }

    #preflightCapacity(recordCount, childCount) {
        const capacity = this.#getCapacityStatus(childCount);
        if (recordCount > capacity.configuredTowerCapacity) {
            return 'TOWER_CAPACITY';
        }
        if (capacity.availableRegistrySlots < childCount) {
            return 'REGISTRY_CAPACITY';
        }
        if (capacity.availableBodySlots < childCount) {
            return 'BODY_CAPACITY';
        }
        if (!this.backend.canStageTowerCreation()) {
            const status = this.backend.getTowerCreationRuntimeStatus();
            return status?.requiresRecovery
                ? 'PROGRAM_RECOVERY_REQUIRED'
                : 'PROGRAM_CAPACITY';
        }
        const creation = this.backend.getTowerCreationRuntimeStatus();
        const group = this.backend.getTowerGroupRuntimeStatus();
        if (creation?.requiresRecovery || recordCount > creation.recordCapacity) {
            return 'PROGRAM_CAPACITY';
        }
        if (recordCount > group.capacity) return 'GROUP_CAPACITY';
        return null;
    }

    #getCapacityStatus(requestedChildCount = 0) {
        if (!this.towerGroupState || !this.registry || !this.backend) {
            return this.lastCapacityStatus;
        }
        const childCount = Number(requestedChildCount);
        const currentTowerCount = this.towerGroupState.getTowerRecords()
            .filter((record) => record.alive).length;
        const registry = this.registry.getStatus();
        const creation = this.backend.getTowerCreationRuntimeStatus();
        const group = this.backend.getTowerGroupRuntimeStatus();
        const productionTowerCapacity = Number.isSafeInteger(
            creation?.productionTowerCapacity
        )
            ? creation.productionTowerCapacity
            : THE_TOWER_RUNTIME_DATA.PRODUCTION_TOWER_CAPACITY;
        const creationCapacity = Number.isSafeInteger(creation?.towerCapacity)
            ? creation.towerCapacity
            : Number.isSafeInteger(creation?.recordCapacity)
                ? creation.recordCapacity
                : productionTowerCapacity;
        const groupCapacity = Number.isSafeInteger(group?.capacity)
            ? group.capacity
            : creationCapacity;
        const configuredTowerCapacity = Math.min(
            creationCapacity,
            groupCapacity
        );
        const availableTowerSlots = Math.max(
            0,
            configuredTowerCapacity - currentTowerCount
        );
        const availableRegistrySlots = Math.max(
            0,
            Number(registry.capacity)
                - Number(registry.activeCount)
                - Number(registry.reservedCount)
        );
        const availableBodySlots = Math.max(
            0,
            Number(this.backend.getAvailableTowerCreationBodyCapacity())
        );
        const status = Object.freeze({
            productionTowerCapacity,
            configuredTowerCapacity,
            productionCapacityOverridden:
                configuredTowerCapacity !== productionTowerCapacity,
            currentTowerCount,
            requestedChildCount: childCount,
            requiredTowerCount: currentTowerCount + childCount,
            availableTowerSlots,
            availableRegistrySlots,
            availableBodySlots,
            availableCreationSlots: Math.min(
                availableTowerSlots,
                availableRegistrySlots,
                availableBodySlots
            )
        });
        this.lastCapacityStatus = status;
        return status;
    }

    #isAuthenticCompletion(completion, proposedTick) {
        const pending = this.pending;
        const base = completion
            && proposedTick > pending.stageReceipt.sourceTick
            && completion.transactionId === pending.request.transactionId
            && completion.transactionFingerprint
                === pending.transactionFingerprint
            && completion.sourceTick === pending.stageReceipt.sourceTick
            && completion.childCount === pending.request.childCount
            && sameProtocol(completion, pending.protocol);
        if (!base || pending.request.mode
            !== TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION) {
            return base;
        }
        return completion.mode
                === GPU_TOWER_CREATION_MODE.GPU_SUBJECT_ACTOR_ACTION
            && completion.executionOrdinal === pending.request.executionOrdinal
            && completion.commandFingerprint
                === pending.request.command.fingerprint
            && completion.snapshotFingerprint
                === pending.request.snapshotFingerprint
            && completion.placementFingerprint
                === pending.placementBinding.placementFingerprint
            && completion.actorActionProfileFingerprint
                === pending.request.actorActionProfileFingerprint;
    }

    #commitPending(completion) {
        const pending = this.pending;
        const actorMode = pending.request.mode
            === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION;
        let committedAbilityMetadata = pending.childAbilityMetadata;
        let childRegistryMetadata = pending.childRegistryMetadata;
        let childCreationMetadata;
        if (actorMode) {
            const commits = completion.metadataCommits;
            const exactCommits = Array.isArray(commits)
                && commits.length === pending.handles.length
                && commits.every((record, index) => (
                    record.fingerprintValid
                    && record.destinationRank === index
                    && record.entityId === pending.handles[index].entityId
                    && record.incarnation
                        === pending.handles[index].incarnation
                    && record.logicalTowerOrdinal
                        === pending.plan.children[index].logicalTowerOrdinal
                    && record.actionCode === pending.request.command.actionCode
                    && record.generation > 0
                    && record.generation
                        <= pending.request.command.generationLimit
                ));
            if (!exactCommits) {
                return this.#failPendingProtocol(
                    'tower-creation-metadata-commit-provenance',
                    commits
                );
            }
            committedAbilityMetadata = pending.plan.children.map(
                (child, index) => createAbilityEntityMetadata({
                    kindId: GPU_TOWER_WORLD_KIND_ID,
                    definitionId: GPU_TOWER_DEFINITION_ID,
                    metadata: {}
                }, {
                    sourceAbilityCode: pending.request.command
                        .compiledAbilityCode,
                    sourceExecutionFingerprint: pending.request.command
                        .executionIdFingerprint,
                    sourceExecutionOrdinal: pending.request.executionOrdinal,
                    generation: commits[index].generation,
                    visibleFromExecutionOrdinal:
                        pending.request.executionOrdinal + 1,
                    creationOriginCode: pending.request.payloadDefinition
                        .creationOriginCode,
                    powerFixedPoint: child.powerFixedPoint
                })
            );
            childCreationMetadata = pending.plan.children.map(
                (child, index) => freezeTowerCreationMetadata({
                    generation: commits[index].generation,
                    creationOriginCode: pending.request.payloadDefinition
                        .creationOriginCode,
                    sourceAbilityCode: pending.request.command
                        .compiledAbilityCode,
                    sourceExecutionId: pending.request.executionId,
                    sourceExecutionFingerprint: pending.request.command
                        .executionIdFingerprint,
                    sourceExecutionOrdinal: pending.request.executionOrdinal,
                    visibleFromExecutionOrdinal:
                        pending.request.executionOrdinal + 1,
                    actorActionCode: pending.request.command.actionCode,
                    actorActionProfileId:
                        pending.request.actorActionProfileId,
                    actorActionProfileFingerprint:
                        pending.request.actorActionProfileFingerprint,
                    recoveryPlacementDescriptor:
                        pending.recoveryDescriptors[index]
                })
            );
            childRegistryMetadata = pending.plan.children.map(
                (child, index) => Object.freeze({
                    logicalTowerId: child.logicalTowerId,
                    logicalTowerOrdinal: child.logicalTowerOrdinal,
                    shareUnits: child.shareUnits,
                    currentHpFixedPoint: child.currentHpFixedPoint,
                    maxHpFixedPoint: child.maxHpFixedPoint,
                    powerFixedPoint: child.powerFixedPoint,
                    towerGroupRevision: pending.plan.targetGroupRevision,
                    abilityGeneration: commits[index].generation,
                    abilityCreationOriginCode: pending.request.payloadDefinition
                        .creationOriginCode,
                    sourceAbilityCode: pending.request.command
                        .compiledAbilityCode,
                    sourceExecutionId: pending.request.executionId,
                    sourceExecutionFingerprint: pending.request.command
                        .executionIdFingerprint,
                    sourceExecutionOrdinal: pending.request.executionOrdinal,
                    visibleFromExecutionOrdinal:
                        pending.request.executionOrdinal + 1,
                    actorActionCode: pending.request.command.actionCode,
                    actorActionProfileId:
                        pending.request.actorActionProfileId,
                    actorActionProfileFingerprint:
                        pending.request.actorActionProfileFingerprint,
                    recoveryPlacementPolicyId:
                        pending.recoveryDescriptors[index].policyId,
                    recoveryLogicalTowerOrdinal:
                        pending.recoveryDescriptors[index]
                            .logicalTowerOrdinal,
                    mapRecoveryAnchorId:
                        pending.recoveryDescriptors[index]
                            .mapRecoveryAnchorId,
                    mapRecoveryLatticeVersion:
                        pending.recoveryDescriptors[index]
                            .mapLatticeVersion,
                    mapRecoveryAnchorX:
                        pending.recoveryDescriptors[index]
                            .anchorPosition.x,
                    mapRecoveryAnchorY:
                        pending.recoveryDescriptors[index]
                            .anchorPosition.y
                })
            );
        }
        const ledger = this.towerGroupState.commitCreation(actorMode
            ? {
                plan: pending.plan,
                childCreationMetadata,
                childRecoverySpawnDescriptors: pending.recoveryDescriptors
            }
            : pending.plan);
        if (ledger?.accepted !== true
            || ledger.created?.length !== pending.handles.length) {
            return this.#failPendingProtocol(
                'tower-creation-ledger-commit',
                ledger
            );
        }
        const registry = this.registry.activateReservedBatch(
            pending.handles.map((handle, index) => ({
                handle,
                metadata: childRegistryMetadata[index]
            }))
        );
        if (registry?.accepted !== true
            || registry.activatedCount !== pending.handles.length) {
            return this.#latchCommittedProtocolFailure(
                'tower-creation-registry-commit',
                registry,
                completion
            );
        }
        const backend = this.backend.finalizeTowerCreationTransaction({
            preleaseToken: pending.preleaseToken,
            transactionId: pending.request.transactionId,
            committed: true,
            recoveryRequired: false,
            childAbilityMetadata: committedAbilityMetadata
        });
        if (backend?.accepted !== true || backend?.committed !== true) {
            return this.#latchCommittedProtocolFailure(
                'tower-creation-backend-commit',
                backend,
                completion
            );
        }
        try {
            ledger.created.forEach((child, index) => {
                this.towerGroupState.bindGpuBody(
                    child.logicalTowerId,
                    pending.handles[index],
                    completion
                );
            });
        } catch (error) {
            return this.#latchCommittedProtocolFailure(
                'tower-creation-binding-commit',
                error,
                completion
            );
        }
        if (actorMode) {
            this.actorActionPlacementRuntime.releasePlacement(
                pending.placementToken
            );
        }
        const result = terminalResult(
            TOWER_CREATION_RESULT.COMMITTED,
            null,
            {
                transactionId: pending.request.transactionId,
                sourceTick: completion.sourceTick,
                submittedTick: completion.submittedTick,
                createdCount: pending.handles.length,
                handles: Object.freeze([...pending.handles]),
                groupRevision: pending.plan.targetGroupRevision,
                transactionFingerprint: pending.transactionFingerprint,
                evidence: completion.evidence,
                metadataCommits: completion.metadataCommits
                    ?? Object.freeze([]),
                actorActionProfileFingerprint: actorMode
                    ? pending.request.actorActionProfileFingerprint
                    : 0,
                placementFingerprint: actorMode
                    ? pending.placementBinding.placementFingerprint
                    : 0,
                recoveryRequired: false
            }
        );
        const receipt = Object.freeze({
            pending: false,
            committed: true,
            ...result,
            requestFingerprint: this.transactionEntries.get(
                pending.request.transactionId
            )?.requestFingerprint ?? null,
            capacity: this.#getCapacityStatus(0)
        });
        this.committedCount++;
        this.#completeTransaction(pending.request.transactionId, receipt);
        this.pending = null;
        this.lastResult = receipt;
        return receipt;
    }

    #rejectPending(completion) {
        const pending = this.pending;
        const backend = this.backend.finalizeTowerCreationTransaction({
            preleaseToken: pending.preleaseToken,
            transactionId: pending.request.transactionId,
            committed: false,
            recoveryRequired: false
        });
        const registryClean = this.#cancelReservations(pending.handles);
        if (pending.placementToken) {
            this.actorActionPlacementRuntime?.releasePlacement(
                pending.placementToken
            );
        }
        const ledger = this.towerGroupState.rejectCreation(
            pending.plan,
            TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
            TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
        );
        if (backend?.requiresRecovery === true
            || !registryClean
            || ledger?.result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE) {
            return this.#latchProtocolFailure(
                'tower-creation-rejection-rollback',
                backend?.failure ?? ledger,
                { transactionId: pending.request.transactionId }
            );
        }
        const result = terminalResult(
            TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
            TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
            {
                transactionId: pending.request.transactionId,
                sourceTick: completion.sourceTick,
                transactionFingerprint: pending.transactionFingerprint,
                evidence: completion.evidence
            }
        );
        const receipt = Object.freeze({
            pending: false,
            committed: false,
            ...result,
            requestFingerprint: this.transactionEntries.get(
                pending.request.transactionId
            )?.requestFingerprint ?? null,
            actorActionProfileFingerprint:
                pending.request.actorActionProfileFingerprint ?? 0,
            placementFingerprint:
                pending.placementBinding?.placementFingerprint ?? 0,
            capacity: this.#getCapacityStatus(0)
        });
        this.rejectedCount++;
        this.#completeTransaction(pending.request.transactionId, receipt);
        this.pending = null;
        this.lastResult = receipt;
        return receipt;
    }

    #failPendingProtocol(stage, evidence) {
        const pending = this.pending;
        if (pending) {
            if (pending.phase === 'actor-action-placement'
                || pending.phase === 'actor-action-placement-ready') {
                try {
                    this.actorActionPlacementRuntime.cancelAll(stage);
                    const retainedPlacementToken = pending.placementToken ?? null;
                    if (retainedPlacementToken) {
                        this.actorActionPlacementRuntime.releasePlacement(
                            retainedPlacementToken
                        );
                    }
                    if (evidence?.placementToken
                        && evidence.placementToken !== retainedPlacementToken) {
                        this.actorActionPlacementRuntime.releasePlacement(
                            evidence.placementToken
                        );
                    }
                    if (pending.phase === 'actor-action-placement') {
                        this.abilitySubjectSnapshotRuntime.releaseSnapshot(
                            pending.request.snapshotToken
                        );
                    }
                    this.backend.cancelTowerCreationBodyPrelease(
                        pending.preleaseToken,
                        stage
                    );
                } catch {
                    // 아래 recovery latch가 session 재구축을 강제합니다.
                }
            } else {
                try {
                    this.backend.finalizeTowerCreationTransaction({
                        preleaseToken: pending.preleaseToken,
                        transactionId: pending.request.transactionId,
                        committed: false,
                        recoveryRequired: true
                    });
                } catch {
                    // 아래 recovery latch가 session 재구축을 강제합니다.
                }
                if (pending.placementToken) {
                    this.actorActionPlacementRuntime?.releasePlacement(
                        pending.placementToken
                    );
                }
            }
            this.#cancelReservations(pending.handles);
            try {
                this.towerGroupState.rejectCreation(
                    pending.plan,
                    TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                    TOWER_CREATION_RESULT.PROTOCOL_FAILURE
                );
            } catch {
                // protocol failure에서 추가 예외를 전파하지 않습니다.
            }
        }
        return this.#latchProtocolFailure(stage, evidence, {
            transactionId: pending?.request.transactionId ?? null
        });
    }

    #latchCommittedProtocolFailure(stage, evidence, completion) {
        const transactionId = this.pending?.request.transactionId ?? null;
        if (this.pending?.placementToken) {
            this.actorActionPlacementRuntime?.releasePlacement(
                this.pending.placementToken
            );
        }
        return this.#latchProtocolFailure(stage, evidence, {
            transactionId,
            sourceTick: completion?.sourceTick ?? null,
            committedGpuMutation: true
        });
    }

    #latchProtocolFailure(stage, error, extra = {}) {
        const transactionId = extra.transactionId
            ?? this.pending?.request.transactionId
            ?? null;
        this.failure = freezeFailure(stage, error, extra);
        this.protocolFailureCount++;
        this.pending = null;
        this.queued = null;
        const result = terminalResult(
            TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
            stage,
            {
                transactionId,
                failure: this.failure,
                recoveryRequired: true
            }
        );
        const receipt = Object.freeze({
            pending: false,
            committed: false,
            ...result,
            requestFingerprint: transactionId
                ? this.transactionEntries.get(transactionId)
                    ?.requestFingerprint ?? null
                : null,
            actorActionProfileFingerprint: transactionId
                ? this.transactionEntries.get(transactionId)
                    ?.actorActionProfileFingerprint ?? 0
                : 0,
            capacity: this.#getCapacityStatus(0)
        });
        if (transactionId) this.#completeTransaction(transactionId, receipt);
        this.lastResult = receipt;
        return receipt;
    }

    #publishTerminal(result) {
        const transactionId = result?.transactionId;
        const entry = transactionId
            ? this.transactionEntries.get(transactionId)
            : null;
        const terminal = asTerminalReceipt(result);
        const receipt = entry
            ? Object.freeze({
                ...terminal,
                requestFingerprint: entry.requestFingerprint,
                actorActionProfileFingerprint:
                    entry.actorActionProfileFingerprint,
                capacity: terminal.capacity ?? this.#getCapacityStatus(0)
            })
            : terminal;
        if (transactionId) this.#completeTransaction(transactionId, receipt);
        this.lastResult = receipt;
        if (receipt?.result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE) {
            this.protocolFailureCount++;
        } else if (receipt?.result !== TOWER_CREATION_RESULT.COMMITTED) {
            this.rejectedCount++;
        }
        return receipt;
    }

    #cancelReservations(handles) {
        let clean = true;
        for (const handle of handles) {
            try {
                clean = this.registry.cancelReservation(handle) && clean;
            } catch {
                clean = false;
            }
        }
        return clean;
    }

    #setTransactionReceipt(transactionId, stage, receipt) {
        const entry = this.transactionEntries.get(transactionId);
        if (!entry || entry.stage === 'completed') {
            throw new Error('Tower creation transaction receipt owner가 없습니다.');
        }
        entry.stage = stage;
        entry.receipt = receipt;
    }

    #completeTransaction(transactionId, receipt) {
        const entry = this.transactionEntries.get(transactionId);
        if (!entry) return receipt;
        const publishActorPayloadTerminal = entry.stage !== 'completed'
            && entry.stage !== 'received'
            && entry.mode
                === TOWER_CREATION_COORDINATOR_MODE.GPU_SUBJECT_ACTOR_ACTION
            && receipt?.terminal === true
            && receipt.receiptKind === TOWER_CREATION_TERMINAL_RECEIPT_KIND
            && receipt.pending === false
            && receipt.staged === false
            && receipt.phase === null;
        if (entry.stage !== 'completed') {
            this.completedTransactionOrder.push(transactionId);
        }
        entry.stage = 'completed';
        entry.receipt = receipt;
        if (publishActorPayloadTerminal) {
            this.actorPayloadTerminalReceipts.push(receipt);
            this.actorPayloadTerminalReceiptHighWater = Math.max(
                this.actorPayloadTerminalReceiptHighWater,
                this.actorPayloadTerminalReceipts.length
            );
        }
        while (this.completedTransactionOrder.length > this.historyCapacity) {
            const retired = this.completedTransactionOrder.shift();
            const retiredEntry = this.transactionEntries.get(retired);
            if (retiredEntry?.stage === 'completed') {
                this.transactionEntries.delete(retired);
            }
        }
        return receipt;
    }
}
