import {
    ABILITY_CREATION_ORIGIN_CODE,
    abilityDefinitionCode,
    createAbilityEntityMetadata
} from '../../contract/ability_execution_contract.js';
import {
    GPU_TOWER_CREATION_STATUS,
    fingerprintGpuTowerCreationTransaction
} from '../../physics/gpu/gpu_tower_creation_abi.js';
import {
    THE_TOWER_RUNTIME_DATA
} from 'data/object/tower/the_tower_data.js';
import {
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    freezeTowerRecoverySpawnDescriptor,
    requirePositiveSafeInteger,
    requireTransactionId
} from './tower_group_contract.js';
import {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID,
    createGpuTowerSpawnIntent
} from './gpu_tower_spawn_adapter.js';

const DEFAULT_HISTORY_CAPACITY = 65_536;

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
        transactionId,
        childCount,
        requestedFixedTick,
        childSpawnDescriptors: Object.freeze(descriptors)
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
        ...source
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
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'Tower creation historyCapacity'
        );
        this.queued = null;
        this.pending = null;
        this.knownTransactionIds = new Set();
        this.transactionOrder = [];
        this.lastResult = null;
        this.failure = null;
        this.destroyed = false;
        this.requestedCount = 0;
        this.stagedCount = 0;
        this.committedCount = 0;
        this.rejectedCount = 0;
        this.protocolFailureCount = 0;
        this.reservationHighWater = 0;
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
        if (this.knownTransactionIds.has(request.transactionId)
            || this.queued?.transactionId === request.transactionId
            || this.pending?.request.transactionId === request.transactionId) {
            const result = terminalResult(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.DUPLICATE_TRANSACTION,
                { transactionId: request.transactionId }
            );
            this.lastResult = result;
            this.protocolFailureCount++;
            return result;
        }
        if (this.queued || this.pending) {
            const result = terminalResult(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                TOWER_CREATION_REASON.CREATION_TRANSACTION_PENDING,
                { transactionId: request.transactionId }
            );
            this.#remember(request.transactionId);
            this.lastResult = result;
            this.rejectedCount++;
            return result;
        }
        this.queued = request;
        const capacity = this.#getCapacityStatus(request.childCount);
        return Object.freeze({
            accepted: true,
            result: null,
            reason: null,
            transactionId: request.transactionId,
            childCount: request.childCount,
            requestedFixedTick: request.requestedFixedTick,
            capacity,
            recoveryRequired: false
        });
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
            return this.#publishTerminal(terminalResult(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: request.transactionId, sourceTick: tick }
            ));
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
                { transactionId: request.transactionId, sourceTick: tick }
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
                { transactionId: request.transactionId, sourceTick: tick }
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
        return Object.freeze({
            ...staged,
            staged: true,
            recoveryRequired: false
        });
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

    getStatus() {
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
                    childCount: this.queued.childCount,
                    requestedFixedTick: this.queued.requestedFixedTick
                })
                : null,
            pendingTransaction: this.pending
                ? Object.freeze({
                    transactionId: this.pending.request.transactionId,
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
            reservationHighWater: this.reservationHighWater,
            historyCount: this.knownTransactionIds.size,
            historyCapacity: this.historyCapacity,
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
            this.#remember(this.queued.transactionId);
            this.queued = null;
        }
        if (!this.pending) {
            return Object.freeze({
                cancelled: true,
                reason,
                recoveryRequired: false
            });
        }
        const pending = this.pending;
        const backend = this.backend.cancelAllTowerCreations(reason);
        const registryClean = this.#cancelReservations(pending.handles);
        this.towerGroupState.rejectCreation(
            pending.plan,
            String(reason || 'cancelled'),
            TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED
        );
        this.#remember(pending.request.transactionId);
        this.pending = null;
        const recoveryRequired = backend?.requiresRecovery === true
            || !registryClean;
        if (recoveryRequired) {
            this.failure = freezeFailure(
                'tower-creation-cancel',
                new Error('Submitted Tower creation cancellation requires rebuild.')
            );
        }
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
        this.registry = null;
        this.backend = null;
        this.towerGroupState = null;
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
        return Object.freeze({
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
    }

    #isAuthenticCompletion(completion, proposedTick) {
        const pending = this.pending;
        return completion
            && proposedTick > pending.stageReceipt.sourceTick
            && completion.transactionId === pending.request.transactionId
            && completion.transactionFingerprint
                === pending.transactionFingerprint
            && completion.sourceTick === pending.stageReceipt.sourceTick
            && completion.childCount === pending.request.childCount
            && sameProtocol(completion, pending.protocol);
    }

    #commitPending(completion) {
        const pending = this.pending;
        const ledger = this.towerGroupState.commitCreation(pending.plan);
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
                metadata: pending.childRegistryMetadata[index]
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
            recoveryRequired: false
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
                recoveryRequired: false
            }
        );
        this.committedCount++;
        this.#remember(pending.request.transactionId);
        this.pending = null;
        this.lastResult = result;
        return Object.freeze({
            pending: false,
            committed: true,
            ...result
        });
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
        this.rejectedCount++;
        this.#remember(pending.request.transactionId);
        this.pending = null;
        this.lastResult = result;
        return Object.freeze({
            pending: false,
            committed: false,
            ...result
        });
    }

    #failPendingProtocol(stage, evidence) {
        const pending = this.pending;
        if (pending) {
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
        if (transactionId) this.#remember(transactionId);
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
        this.lastResult = result;
        return Object.freeze({
            pending: false,
            committed: false,
            ...result
        });
    }

    #publishTerminal(result) {
        const transactionId = result?.transactionId;
        if (transactionId) this.#remember(transactionId);
        this.lastResult = result;
        if (result?.result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE) {
            this.protocolFailureCount++;
        } else if (result?.result !== TOWER_CREATION_RESULT.COMMITTED) {
            this.rejectedCount++;
        }
        return result;
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

    #remember(transactionId) {
        if (this.knownTransactionIds.has(transactionId)) return;
        this.knownTransactionIds.add(transactionId);
        this.transactionOrder.push(transactionId);
        while (this.transactionOrder.length > this.historyCapacity) {
            this.knownTransactionIds.delete(this.transactionOrder.shift());
        }
    }
}
