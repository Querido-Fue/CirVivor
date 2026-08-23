import { THE_TOWER_COMBAT_DATA } from 'data/object/tower/the_tower_data.js';
import {
    decodeGpuCircleBodyFixedPoint,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    PRIMARY_TOWER_LOGICAL_ID,
    PRIMARY_TOWER_LOGICAL_ORDINAL,
    TOWER_COMBAT_FACT_TYPE,
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_GROUP_RECORD_STATE,
    TOWER_MERGE_REASON,
    TOWER_MERGE_RESULT,
    TOWER_SHARE_SCALE,
    createTowerLogicalId,
    freezeExactTowerHandle,
    freezeTowerCreationMetadata,
    freezeTowerMergeOperationIdentity,
    freezeTowerRecoverySpawnDescriptor,
    normalizeTowerGpuProtocol,
    requireLogicalTowerId,
    requireNonNegativeSafeInteger,
    requirePositiveSafeInteger,
    requireShareUnits,
    requireTowerGroupRecordState,
    requireTransactionId,
    sameExactTowerHandle,
    sameTowerGpuProtocol
} from './tower_group_contract.js';
import { TowerShareLedger } from './tower_share_ledger.js';

const DEFAULT_HISTORY_CAPACITY = 65536;
const DEFAULT_MERGE_HISTORY_CAPACITY = 1024;
const EMPTY_FACTS = Object.freeze([]);

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function eventIdentity(event) {
    if (typeof event?.key === 'string' && event.key.length > 0) {
        return event.key;
    }
    return [
        event?.sessionGeneration,
        event?.deviceGeneration,
        event?.authoritativeEpoch,
        event?.entityId,
        event?.incarnation,
        event?.sourceTick,
        event?.sequence,
        event?.eventType
    ].join(':');
}

function snapshotSourceProvenance(registry, event) {
    if (typeof registry?.copyEntityView !== 'function') {
        return Object.freeze({
            producerId: null,
            sourceAbilityId: null,
            sourceTeamId: null
        });
    }
    const view = registry.copyEntityView({
        entityId: event.entityId,
        incarnation: event.incarnation
    }, {});
    return Object.freeze({
        producerId: view?.metadata?.producerId ?? null,
        sourceAbilityId: view?.metadata?.sourceAbilityId ?? null,
        sourceTeamId: view?.metadata?.teamId ?? null
    });
}

function freezeFactProtocol(event) {
    return {
        sessionGeneration: event.sessionGeneration,
        deviceGeneration: event.deviceGeneration,
        authoritativeEpoch: event.authoritativeEpoch,
        sourceTick: event.sourceTick,
        sequence: event.sequence,
        eventKey: eventIdentity(event)
    };
}

function createRecord(source) {
    const state = requireTowerGroupRecordState(source.state);
    const mergedIntoLogicalTowerId = source.mergedIntoLogicalTowerId ?? null;
    const mergedTransactionId = source.mergedTransactionId ?? null;
    const mergedPlanFingerprint = source.mergedPlanFingerprint ?? null;
    const mergedAtFixedTick = source.mergedAtFixedTick ?? null;
    if (state === TOWER_GROUP_RECORD_STATE.MERGED) {
        requireLogicalTowerId(
            mergedIntoLogicalTowerId,
            'towerRecord.mergedIntoLogicalTowerId'
        );
        requireTransactionId(
            mergedTransactionId,
            'towerRecord.mergedTransactionId'
        );
        requireTransactionId(
            mergedPlanFingerprint,
            'towerRecord.mergedPlanFingerprint'
        );
        requirePositiveSafeInteger(
            mergedAtFixedTick,
            'towerRecord.mergedAtFixedTick'
        );
        if (source.shareUnits !== 0 || source.currentHpFixedPoint !== 0
            || source.maxHpFixedPoint !== 0 || source.powerFixedPoint !== 0
            || source.exactGpuBinding !== null) {
            throw new Error('MERGED Tower record는 stat/binding을 소유할 수 없습니다.');
        }
    } else if (mergedIntoLogicalTowerId !== null
        || mergedTransactionId !== null
        || mergedPlanFingerprint !== null
        || mergedAtFixedTick !== null) {
        throw new Error('MERGED가 아닌 Tower record에는 merge lineage를 둘 수 없습니다.');
    }
    return Object.freeze({
        logicalTowerId: requireLogicalTowerId(source.logicalTowerId),
        logicalTowerOrdinal: requirePositiveSafeInteger(
            source.logicalTowerOrdinal,
            'logicalTowerOrdinal'
        ),
        shareUnits: requireShareUnits(
            source.shareUnits,
            'shareUnits'
        ),
        currentHpFixedPoint: requireNonNegativeSafeInteger(
            source.currentHpFixedPoint,
            'currentHpFixedPoint'
        ),
        maxHpFixedPoint: requireNonNegativeSafeInteger(
            source.maxHpFixedPoint,
            'maxHpFixedPoint'
        ),
        powerFixedPoint: requireNonNegativeSafeInteger(
            source.powerFixedPoint,
            'powerFixedPoint'
        ),
        recoverySpawnDescriptor: source.recoverySpawnDescriptor ?? null,
        creationMetadata: freezeTowerCreationMetadata(
            source.creationMetadata,
            'towerRecord.creationMetadata'
        ),
        state,
        exactGpuBinding: source.exactGpuBinding ?? null,
        mergedIntoLogicalTowerId,
        mergedTransactionId,
        mergedPlanFingerprint,
        mergedAtFixedTick
    });
}

function freezeRecordView(record) {
    if (!record) return null;
    return Object.freeze({
        ...record,
        alive: record.state === TOWER_GROUP_RECORD_STATE.LIVING,
        currentHp: decodeGpuCircleBodyFixedPoint(record.currentHpFixedPoint),
        maxHp: decodeGpuCircleBodyFixedPoint(record.maxHpFixedPoint),
        power: decodeGpuCircleBodyFixedPoint(record.powerFixedPoint)
    });
}

function hashText(hash, text) {
    let result = hash >>> 0;
    for (let index = 0; index < text.length; index++) {
        result ^= text.charCodeAt(index);
        result = Math.imul(result, 0x01000193) >>> 0;
    }
    return result;
}

function fingerprintLivingRecords(records) {
    let hash = 0x811c9dc5;
    for (const record of records) {
        const binding = record.exactGpuBinding;
        hash = hashText(hash, [
            record.logicalTowerId,
            record.logicalTowerOrdinal,
            record.shareUnits,
            record.currentHpFixedPoint,
            record.maxHpFixedPoint,
            record.powerFixedPoint,
            binding?.entityId ?? 0,
            binding?.incarnation ?? 0,
            binding?.sessionGeneration ?? 0,
            binding?.deviceGeneration ?? 0,
            binding?.authoritativeEpoch ?? 0
        ].join(':'));
    }
    return hash.toString(16).padStart(8, '0');
}

function fingerprintLivingStructure(records) {
    let hash = 0x811c9dc5;
    for (const record of records) {
        const binding = record.exactGpuBinding;
        hash = hashText(hash, [
            record.logicalTowerId,
            record.logicalTowerOrdinal,
            record.shareUnits,
            record.maxHpFixedPoint,
            record.powerFixedPoint,
            binding?.entityId ?? 0,
            binding?.incarnation ?? 0,
            binding?.sessionGeneration ?? 0,
            binding?.deviceGeneration ?? 0,
            binding?.authoritativeEpoch ?? 0
        ].join(':'));
    }
    return hash.toString(16).padStart(8, '0');
}

function normalizeMergeRequest(source = {}) {
    const expectedPlanFingerprint = source.fingerprint === undefined
        || source.fingerprint === null
        ? null
        : requireTransactionId(
            source.fingerprint,
            'towerMergeRequest.fingerprint'
        );
    return Object.freeze({
        transactionId: requireTransactionId(source.transactionId),
        compiledOperation: freezeTowerMergeOperationIdentity(
            source.compiledOperation,
            'towerMergeRequest.compiledOperation'
        ),
        requestedFixedTick: requirePositiveSafeInteger(
            source.requestedFixedTick,
            'towerMergeRequest.requestedFixedTick'
        ),
        expectedPlanFingerprint
    });
}

function fingerprintMergeRequest(request) {
    return JSON.stringify({
        version: 'tower-merge-request-v1',
        transactionId: request.transactionId,
        compiledOperation: request.compiledOperation,
        requestedFixedTick: request.requestedFixedTick
    });
}

function fingerprintMergePlan(source) {
    const canonical = JSON.stringify({
        version: 'tower-merge-plan-v1',
        transactionId: source.request.transactionId,
        compiledOperation: source.request.compiledOperation,
        requestedFixedTick: source.request.requestedFixedTick,
        sourceGroupRevision: source.sourceGroupRevision,
        sourceStateRevision: source.sourceStateRevision,
        sourcePrimaryLogicalTowerId: source.sourcePrimaryLogicalTowerId,
        sourceFingerprint: source.sourceFingerprint,
        sourceStructureFingerprint: source.sourceStructureFingerprint,
        survivorLogicalTowerId: source.arithmetic.survivorLogicalTowerId,
        sources: source.livingRecords.map((record) => ({
            logicalTowerId: record.logicalTowerId,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            shareUnits: record.shareUnits,
            currentHpFixedPoint: record.currentHpFixedPoint,
            maxHpFixedPoint: record.maxHpFixedPoint,
            powerFixedPoint: record.powerFixedPoint,
            exactGpuBinding: record.exactGpuBinding
                ? {
                    entityId: record.exactGpuBinding.entityId,
                    incarnation: record.exactGpuBinding.incarnation,
                    sessionGeneration:
                        record.exactGpuBinding.sessionGeneration,
                    deviceGeneration:
                        record.exactGpuBinding.deviceGeneration,
                    authoritativeEpoch:
                        record.exactGpuBinding.authoritativeEpoch
                }
                : null
        }))
    });
    return [
        hashText(0x811c9dc5, canonical),
        hashText(0x9e3779b9, canonical)
    ].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function freezeMergeRejection(result, reason, extra = {}) {
    return Object.freeze({
        accepted: false,
        result,
        reason,
        recoveryRequired: false,
        mutationCount: 0,
        ...extra
    });
}

function freezeRejection(result, reason, extra = {}) {
    return Object.freeze({
        accepted: false,
        result,
        reason,
        recoveryRequired: false,
        ...extra
    });
}

/**
 * GPU world와 독립된 CPU run-domain TowerGroup 권위입니다. Share/Lost Share,
 * logical identity, committed HP mirror, creation plan, exact binding을 한 곳에 둡니다.
 */
export class TowerGroupState {
    #records;
    #bindingToLogicalId;
    #pendingCreation;
    #pendingMerge;
    #mergeTransactions;
    #completedMergeTransactionOrder;
    #knownEventKeys;
    #eventKeyHistory;
    #eventKeyHead;
    #knownCreationTransactionIds;
    #creationTransactionOrder;
    #lethalDamageByLogicalId;

    constructor(options = {}) {
        const runBaseMaxHp = Number(
            options.runBaseMaxHp
                ?? options.maxHp
                ?? THE_TOWER_COMBAT_DATA.MAX_HEALTH
        );
        const runBasePower = Number(
            options.runBasePower
                ?? options.basePower
                ?? THE_TOWER_COMBAT_DATA.BASE_POWER
        );
        if (!Number.isFinite(runBaseMaxHp) || runBaseMaxHp <= 0) {
            throw new RangeError('Tower run base max HP는 양의 유한 숫자여야 합니다.');
        }
        if (!Number.isFinite(runBasePower) || runBasePower < 0) {
            throw new RangeError('Tower run base Power는 0 이상의 유한 숫자여야 합니다.');
        }
        this.runBaseMaxHpFixedPoint = encodeGpuCircleBodyFixedPoint(
            runBaseMaxHp
        );
        this.runBasePowerFixedPoint = encodeGpuCircleBodyFixedPoint(
            runBasePower
        );
        if (this.runBaseMaxHpFixedPoint <= 0
            || this.runBasePowerFixedPoint < 0) {
            throw new RangeError('Tower base stat이 fixed-point에서 유효해야 합니다.');
        }
        this.eventHistoryCapacity = requirePositiveSafeInteger(
            options.eventHistoryCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'Tower event history capacity'
        );
        this.creationHistoryCapacity = requirePositiveSafeInteger(
            options.creationHistoryCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'Tower creation history capacity'
        );
        this.mergeHistoryCapacity = requirePositiveSafeInteger(
            options.mergeHistoryCapacity ?? DEFAULT_MERGE_HISTORY_CAPACITY,
            'Tower merge history capacity'
        );
        this.ledger = new TowerShareLedger({
            runBaseMaxHpFixedPoint: this.runBaseMaxHpFixedPoint,
            runBasePowerFixedPoint: this.runBasePowerFixedPoint
        });
        const initialDescriptor = freezeTowerRecoverySpawnDescriptor(
            options.initialRecoverySpawnDescriptor,
            'initialRecoverySpawnDescriptor'
        );
        const initialAllocation = this.ledger.createInitialTower();
        const initialRecord = createRecord({
            ...initialAllocation,
            recoverySpawnDescriptor: initialDescriptor,
            state: TOWER_GROUP_RECORD_STATE.LIVING,
            exactGpuBinding: null
        });
        this.#records = new Map([[initialRecord.logicalTowerId, initialRecord]]);
        this.#bindingToLogicalId = new Map();
        this.#pendingCreation = null;
        this.#pendingMerge = null;
        this.#mergeTransactions = new Map();
        this.#completedMergeTransactionOrder = [];
        this.#knownEventKeys = new Set();
        this.#eventKeyHistory = [];
        this.#eventKeyHead = 0;
        this.#knownCreationTransactionIds = new Set();
        this.#creationTransactionOrder = [];
        this.#lethalDamageByLogicalId = new Map();
        this.nextLogicalTowerOrdinal = PRIMARY_TOWER_LOGICAL_ORDINAL + 1;
        this.primaryLogicalTowerId = PRIMARY_TOWER_LOGICAL_ID;
        this.livingTowerCount = 1;
        this.groupRevision = 1;
        this.stateRevision = 1;
        this.activeProtocol = null;
        this.lastCommittedSourceTick = 0;
        this.lastCommittedSequence = -1;
        this.lastCommittedDamage = null;
        this.lastCommittedDeath = null;
        this.lastCommittedFacts = EMPTY_FACTS;
        this.lastCreation = null;
        this.lastMerge = null;
        this.destroyed = false;
    }

    planCreation(source = {}) {
        return this.#createCreationPlan(source, true);
    }

    /**
     * GPU placement readback 동안 발생한 non-lethal HP 변화만 최신 상태로
     * 재계획합니다. Membership/share/exact binding이 변했으면 0/N transaction을
     * source-changed로 종료합니다.
     */
    refreshPendingCreation(source = {}) {
        this.#assertUsable();
        const pending = this.#pendingCreation;
        const plan = source.plan ?? source;
        if (!pending || plan !== pending.plan) {
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED
            );
        }
        const livingRecords = this.#getLivingRecords();
        if (this.groupRevision !== plan.sourceGroupRevision
            || fingerprintLivingStructure(livingRecords)
                !== plan.sourceStructureFingerprint) {
            this.#pendingCreation = null;
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: plan.transactionId }
            );
        }
        if (this.stateRevision === plan.sourceStateRevision
            && fingerprintLivingRecords(livingRecords)
                === plan.sourceFingerprint) {
            return plan;
        }
        this.#pendingCreation = null;
        return this.#createCreationPlan({
            transactionId: plan.transactionId,
            childCount: plan.childCount,
            childRecoverySpawnDescriptors:
                source.childRecoverySpawnDescriptors
        }, true);
    }

    /** Future preview가 runtime과 같은 shared arithmetic/reason을 소비하는 pure seam입니다. */
    previewCreation(source = {}) {
        return this.#createCreationPlan({
            transactionId: source.transactionId ?? 'tower-creation-preview',
            childCount: source.childCount,
            childRecoverySpawnDescriptors:
                source.childRecoverySpawnDescriptors
        }, false);
    }

    #createCreationPlan(source, publishPending) {
        this.#assertUsable();
        const transactionId = requireTransactionId(source.transactionId);
        const childCount = requirePositiveSafeInteger(
            source.childCount,
            'childCount'
        );
        if (publishPending
            && this.#knownCreationTransactionIds.has(transactionId)) {
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.DUPLICATE_TRANSACTION,
                { transactionId, duplicate: true }
            );
        }
        if (publishPending && this.#pendingMerge) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                TOWER_CREATION_REASON.MERGE_TRANSACTION_PENDING,
                { transactionId }
            );
        }
        if (publishPending && this.#pendingCreation) {
            if (this.#pendingCreation.plan.transactionId === transactionId) {
                return this.#pendingCreation.plan;
            }
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_CAPACITY,
                TOWER_CREATION_REASON.CREATION_TRANSACTION_PENDING,
                { transactionId }
            );
        }

        const livingRecords = this.#getLivingRecords();
        const livingShareUnits = TOWER_SHARE_SCALE
            - this.ledger.getStatus().lostShareUnits;
        if (livingRecords.length === 0 || livingShareUnits === 0) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE,
                TOWER_CREATION_REASON.ZERO_LIVING_SHARE_NON_VIABLE,
                { transactionId }
            );
        }
        const livingMaxHpTotal = livingRecords.reduce(
            (total, record) => total + record.maxHpFixedPoint,
            0
        );
        if (livingMaxHpTotal < livingRecords.length + childCount) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_HEALTH,
                TOWER_CREATION_REASON.NON_VIABLE_DERIVED_HEALTH,
                { transactionId, derivedMaxHpTotal: livingMaxHpTotal }
            );
        }
        if (this.nextLogicalTowerOrdinal + childCount >= 0xffffffff) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_HEALTH,
                TOWER_CREATION_REASON.NON_VIABLE_DERIVED_HEALTH,
                { transactionId, detail: 'logical Tower ordinal exhausted' }
            );
        }

        const descriptors = source.childRecoverySpawnDescriptors;
        if (descriptors !== undefined
            && (!Array.isArray(descriptors)
                || descriptors.length !== childCount)) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                { transactionId }
            );
        }
        let childTemplates;
        try {
            childTemplates = Array.from({ length: childCount }, (_, index) => {
                const logicalTowerOrdinal = this.nextLogicalTowerOrdinal + index;
                if (logicalTowerOrdinal >= 0xffffffff) {
                    throw new RangeError('logical Tower ordinal이 소진되었습니다.');
                }
                return createRecord({
                    logicalTowerId: createTowerLogicalId(logicalTowerOrdinal),
                    logicalTowerOrdinal,
                    shareUnits: 0,
                    currentHpFixedPoint: 0,
                    maxHpFixedPoint: 0,
                    powerFixedPoint: 0,
                    recoverySpawnDescriptor:
                        freezeTowerRecoverySpawnDescriptor(
                            descriptors?.[index],
                            `childRecoverySpawnDescriptors[${index}]`
                        ),
                    state: TOWER_GROUP_RECORD_STATE.PENDING,
                    exactGpuBinding: null
                });
            });
        } catch (error) {
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_DESCRIPTOR,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                { transactionId, detail: error?.message ?? String(error) }
            );
        }

        const arithmetic = this.ledger.planCreation(
            livingRecords,
            childTemplates
        );
        if (!arithmetic.accepted) {
            return Object.freeze({
                ...arithmetic,
                transactionId,
                recoveryRequired: false
            });
        }
        const allocationById = new Map(arithmetic.allocations.map((entry) => (
            [entry.logicalTowerId, entry]
        )));
        const plannedExisting = livingRecords.map((record) => {
            const allocation = allocationById.get(record.logicalTowerId);
            return createRecord({
                ...record,
                ...allocation
            });
        });
        const plannedChildren = childTemplates.map((record) => {
            const allocation = allocationById.get(record.logicalTowerId);
            return createRecord({
                ...record,
                ...allocation,
                state: TOWER_GROUP_RECORD_STATE.PENDING
            });
        });
        const sourceFingerprint = fingerprintLivingRecords(livingRecords);
        const sourceStructureFingerprint = fingerprintLivingStructure(
            livingRecords
        );
        const fingerprint = [
            'tower-creation-v1',
            transactionId,
            this.groupRevision,
            this.stateRevision,
            sourceFingerprint,
            sourceStructureFingerprint,
            childCount
        ].join(':');
        const plan = Object.freeze({
            accepted: true,
            result: null,
            reason: null,
            transactionId,
            childCount,
            sourceGroupRevision: this.groupRevision,
            sourceStateRevision: this.stateRevision,
            targetGroupRevision: this.groupRevision + 1,
            sourceFingerprint,
            sourceStructureFingerprint,
            fingerprint,
            livingShareUnits: arithmetic.livingShareUnits,
            lostShareUnits: arithmetic.lostShareUnits,
            totalLivingCurrentHp: arithmetic.totalLivingCurrentHp,
            existing: Object.freeze(plannedExisting.map(freezeRecordView)),
            children: Object.freeze(plannedChildren.map(freezeRecordView))
        });
        if (publishPending) {
            this.#pendingCreation = {
                plan,
                plannedExisting,
                plannedChildren,
                nextLogicalTowerOrdinal:
                    this.nextLogicalTowerOrdinal + childCount
            };
        }
        return plan;
    }

    commitCreation(source) {
        this.#assertUsable();
        const pending = this.#pendingCreation;
        const plan = source?.plan ?? source;
        if (!pending || plan !== pending.plan) {
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED
            );
        }
        if (this.stateRevision !== plan.sourceStateRevision
            || this.groupRevision !== plan.sourceGroupRevision
            || fingerprintLivingRecords(this.#getLivingRecords())
                !== plan.sourceFingerprint) {
            this.#pendingCreation = null;
            return freezeRejection(
                TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                { transactionId: plan.transactionId }
            );
        }
        const childCreationMetadata = source?.plan
            ? source.childCreationMetadata
            : undefined;
        const childRecoverySpawnDescriptors = source?.plan
            ? source.childRecoverySpawnDescriptors
            : undefined;
        if (childCreationMetadata !== undefined
            && (!Array.isArray(childCreationMetadata)
                || childCreationMetadata.length
                    !== pending.plannedChildren.length)) {
            this.#pendingCreation = null;
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                { transactionId: plan.transactionId }
            );
        }
        if (childRecoverySpawnDescriptors !== undefined
            && (!Array.isArray(childRecoverySpawnDescriptors)
                || childRecoverySpawnDescriptors.length
                    !== pending.plannedChildren.length)) {
            this.#pendingCreation = null;
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                { transactionId: plan.transactionId }
            );
        }
        let committedChildMetadata;
        let committedRecoveryDescriptors;
        try {
            committedChildMetadata = pending.plannedChildren.map(
                (child, index) => freezeTowerCreationMetadata(
                    childCreationMetadata?.[index]
                        ?? child.creationMetadata,
                    `childCreationMetadata[${index}]`
                )
            );
            committedRecoveryDescriptors = pending.plannedChildren.map(
                (child, index) => freezeTowerRecoverySpawnDescriptor(
                    childRecoverySpawnDescriptors?.[index]
                        ?? child.recoverySpawnDescriptor,
                    `childRecoverySpawnDescriptors[${index}]`
                )
            );
            committedChildMetadata.forEach((metadata, index) => {
                if (metadata
                    && (metadata.recoveryPlacementDescriptor
                            ?.logicalTowerOrdinal
                        !== pending.plannedChildren[index]
                            .logicalTowerOrdinal
                        || metadata.recoveryPlacementDescriptor
                            ?.logicalTowerOrdinal
                            !== committedRecoveryDescriptors[index]
                                ?.logicalTowerOrdinal)) {
                    throw new RangeError(
                        'Tower child metadata/recovery ordinal이 다릅니다.'
                    );
                }
            });
        } catch (error) {
            this.#pendingCreation = null;
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.DESCRIPTOR_INVALID,
                {
                    transactionId: plan.transactionId,
                    detail: error?.message ?? String(error)
                }
            );
        }
        for (const planned of pending.plannedExisting) {
            const current = this.#records.get(planned.logicalTowerId);
            if (!current || current.state !== TOWER_GROUP_RECORD_STATE.LIVING) {
                this.#pendingCreation = null;
                return freezeRejection(
                    TOWER_CREATION_RESULT.REJECTED_SOURCE_CHANGED,
                    TOWER_CREATION_REASON.SOURCE_STATE_CHANGED,
                    { transactionId: plan.transactionId }
                );
            }
        }

        for (const planned of pending.plannedExisting) {
            this.#records.set(planned.logicalTowerId, planned);
        }
        const created = [];
        for (let index = 0; index < pending.plannedChildren.length; index++) {
            const pendingChild = pending.plannedChildren[index];
            const child = createRecord({
                ...pendingChild,
                recoverySpawnDescriptor: committedRecoveryDescriptors[index],
                creationMetadata: committedChildMetadata[index],
                state: TOWER_GROUP_RECORD_STATE.LIVING
            });
            this.#records.set(child.logicalTowerId, child);
            created.push(freezeRecordView(child));
        }
        this.nextLogicalTowerOrdinal = pending.nextLogicalTowerOrdinal;
        this.livingTowerCount += created.length;
        this.groupRevision = plan.targetGroupRevision;
        this.stateRevision++;
        this.#pendingCreation = null;
        this.#rememberCreationTransaction(plan.transactionId);
        this.lastCreation = Object.freeze({
            accepted: true,
            result: TOWER_CREATION_RESULT.COMMITTED,
            reason: null,
            transactionId: plan.transactionId,
            createdCount: created.length,
            groupRevision: this.groupRevision,
            fingerprint: plan.fingerprint
        });
        return Object.freeze({
            ...this.lastCreation,
            created: Object.freeze(created),
            status: this.getStatus()
        });
    }

    rejectCreation(
        source,
        reason = 'REJECTED',
        result = TOWER_CREATION_RESULT.REJECTED_CAPACITY
    ) {
        if (this.destroyed) {
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                'DESTROYED'
            );
        }
        const pending = this.#pendingCreation;
        const plan = source?.plan ?? source;
        if (!pending || plan !== pending.plan) {
            return freezeRejection(
                TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
                TOWER_CREATION_REASON.SOURCE_STATE_CHANGED
            );
        }
        this.#pendingCreation = null;
        this.lastCreation = freezeRejection(
            Object.values(TOWER_CREATION_RESULT).includes(result)
                ? result
                : TOWER_CREATION_RESULT.PROTOCOL_FAILURE,
            reason,
            { transactionId: plan.transactionId }
        );
        return this.lastCreation;
    }

    planMerge(source = {}) {
        this.#assertUsable();
        let request;
        try {
            request = normalizeMergeRequest(source);
        } catch (error) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.INVALID_REQUEST,
                { detail: error?.message ?? String(error) }
            );
        }
        return this.#createMergePlan(request, true);
    }

    /** UI/QA가 runtime과 동일한 산술을 mutation 없이 조회하는 pure seam입니다. */
    previewMerge(source = {}) {
        if (this.destroyed) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.DESTROYED
            );
        }
        let request;
        try {
            request = normalizeMergeRequest({
                ...source,
                transactionId: source.transactionId ?? 'tower-merge-preview'
            });
        } catch (error) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.INVALID_REQUEST,
                { detail: error?.message ?? String(error) }
            );
        }
        return this.#buildMergePlan(request).receipt;
    }

    /** Pending 중 구조는 고정하고 non-lethal current HP만 다시 합산합니다. */
    refreshPendingMerge(source = {}) {
        this.#assertUsable();
        const pending = this.#pendingMerge;
        const plan = source.plan ?? source;
        if (!pending || plan !== pending.plan) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.SOURCE_CHANGED
            );
        }
        const livingRecords = this.#getLivingRecords();
        if (this.groupRevision !== plan.sourceGroupRevision
            || this.primaryLogicalTowerId
                !== plan.sourcePrimaryLogicalTowerId
            || fingerprintLivingStructure(livingRecords)
                !== plan.sourceStructureFingerprint) {
            return this.#rejectPendingMergeSourceChanged(plan);
        }
        if (this.stateRevision === plan.sourceStateRevision
            && fingerprintLivingRecords(livingRecords)
                === plan.sourceFingerprint) {
            return plan;
        }
        let rebuilt;
        try {
            rebuilt = this.#buildMergePlan(pending.request);
        } catch {
            return this.#rejectPendingMergeSourceChanged(plan);
        }
        if (!rebuilt.receipt.accepted) {
            return this.#rejectPendingMergeSourceChanged(plan);
        }
        this.#pendingMerge = {
            request: pending.request,
            requestFingerprint: pending.requestFingerprint,
            plan: rebuilt.receipt,
            plannedSurvivor: rebuilt.plannedSurvivor,
            livingRecords: rebuilt.livingRecords
        };
        const entry = this.#mergeTransactions.get(plan.transactionId);
        entry.planFingerprint = rebuilt.receipt.fingerprint;
        entry.receipt = rebuilt.receipt;
        return rebuilt.receipt;
    }

    commitMerge(source = {}) {
        if (this.destroyed) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.DESTROYED
            );
        }
        const plan = source.plan ?? source;
        const transactionId = plan?.transactionId;
        const entry = typeof transactionId === 'string'
            ? this.#mergeTransactions.get(transactionId)
            : null;
        if (!this.#pendingMerge) {
            if (entry?.stage === 'completed'
                && plan?.fingerprint === entry.planFingerprint) {
                return entry.receipt;
            }
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                { transactionId: transactionId ?? null }
            );
        }
        const pending = this.#pendingMerge;
        if (plan !== pending.plan) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                { transactionId: transactionId ?? null }
            );
        }
        const livingRecords = this.#getLivingRecords();
        if (this.groupRevision !== plan.sourceGroupRevision
            || this.stateRevision !== plan.sourceStateRevision
            || this.primaryLogicalTowerId
                !== plan.sourcePrimaryLogicalTowerId
            || fingerprintLivingRecords(livingRecords)
                !== plan.sourceFingerprint) {
            return this.#rejectPendingMergeSourceChanged(plan);
        }

        const survivorId = plan.survivor.logicalTowerId;
        const lineage = Object.freeze(pending.livingRecords
            .filter((record) => record.logicalTowerId !== survivorId)
            .map((record) => Object.freeze({
                logicalTowerId: record.logicalTowerId,
                logicalTowerOrdinal: record.logicalTowerOrdinal,
                mergedIntoLogicalTowerId: survivorId,
                transactionId: plan.transactionId,
                planFingerprint: plan.fingerprint,
                requestedFixedTick: plan.requestedFixedTick,
                shareUnits: record.shareUnits,
                currentHpFixedPoint: record.currentHpFixedPoint,
                maxHpFixedPoint: record.maxHpFixedPoint,
                powerFixedPoint: record.powerFixedPoint,
                exactGpuBinding: record.exactGpuBinding
            })));
        this.#records.set(survivorId, pending.plannedSurvivor);
        for (const record of pending.livingRecords) {
            if (record.logicalTowerId === survivorId) continue;
            if (record.exactGpuBinding) {
                this.#bindingToLogicalId.delete(
                    handleKey(record.exactGpuBinding)
                );
            }
            this.#lethalDamageByLogicalId.delete(record.logicalTowerId);
            this.#records.set(record.logicalTowerId, createRecord({
                ...record,
                shareUnits: 0,
                currentHpFixedPoint: 0,
                maxHpFixedPoint: 0,
                powerFixedPoint: 0,
                state: TOWER_GROUP_RECORD_STATE.MERGED,
                exactGpuBinding: null,
                mergedIntoLogicalTowerId: survivorId,
                mergedTransactionId: plan.transactionId,
                mergedPlanFingerprint: plan.fingerprint,
                mergedAtFixedTick: plan.requestedFixedTick
            }));
        }
        this.livingTowerCount = 1;
        this.primaryLogicalTowerId = survivorId;
        this.groupRevision = plan.targetGroupRevision;
        this.stateRevision++;
        if (this.#bindingToLogicalId.size === 0) {
            this.activeProtocol = null;
        }
        const fact = Object.freeze({
            type: TOWER_COMBAT_FACT_TYPE.MERGED,
            transactionId: plan.transactionId,
            planFingerprint: plan.fingerprint,
            requestedFixedTick: plan.requestedFixedTick,
            operationIdentity: plan.operationIdentity,
            sourceCount: plan.sourceCount,
            consumedCount: lineage.length,
            sourceLogicalTowerIds: Object.freeze(plan.sources.map(
                (record) => record.logicalTowerId
            )),
            survivorLogicalTowerId: survivorId,
            survivorLogicalTowerOrdinal:
                plan.survivor.logicalTowerOrdinal,
            survivorExactGpuBinding:
                plan.survivor.exactGpuBinding,
            shareUnits: plan.survivor.shareUnits,
            currentHpFixedPoint: plan.survivor.currentHpFixedPoint,
            maxHpFixedPoint: plan.survivor.maxHpFixedPoint,
            powerFixedPoint: plan.survivor.powerFixedPoint,
            lostShareUnits: plan.lostShareUnits,
            groupRevision: this.groupRevision,
            stateRevision: this.stateRevision,
            lineage
        });
        const receipt = Object.freeze({
            accepted: true,
            result: TOWER_MERGE_RESULT.COMMITTED,
            reason: null,
            recoveryRequired: false,
            mutationCount: plan.sourceCount,
            transactionId: plan.transactionId,
            requestFingerprint: plan.requestFingerprint,
            fingerprint: plan.fingerprint,
            sourceCount: plan.sourceCount,
            consumedCount: lineage.length,
            survivorLogicalTowerId: survivorId,
            groupRevision: this.groupRevision,
            stateRevision: this.stateRevision,
            lostShareUnits: plan.lostShareUnits,
            lineage,
            fact
        });
        this.#pendingMerge = null;
        this.lastMerge = receipt;
        this.lastCommittedFacts = Object.freeze([fact]);
        return this.#completeMergeTransaction(entry, receipt);
    }

    rejectMerge(
        source = {},
        reason = TOWER_MERGE_REASON.REJECTED,
        result = TOWER_MERGE_RESULT.REJECTED
    ) {
        if (this.destroyed) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.DESTROYED
            );
        }
        const plan = source.plan ?? source;
        const entry = typeof plan?.transactionId === 'string'
            ? this.#mergeTransactions.get(plan.transactionId)
            : null;
        if (!this.#pendingMerge) {
            if (entry?.stage === 'completed'
                && plan?.fingerprint === entry.planFingerprint) {
                return entry.receipt;
            }
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH
            );
        }
        if (plan !== this.#pendingMerge.plan) {
            return freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                { transactionId: plan?.transactionId ?? null }
            );
        }
        this.#pendingMerge = null;
        const receipt = freezeMergeRejection(
            Object.values(TOWER_MERGE_RESULT).includes(result)
                ? result
                : TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
            reason,
            {
                transactionId: plan.transactionId,
                requestFingerprint: plan.requestFingerprint,
                fingerprint: plan.fingerprint
            }
        );
        this.lastMerge = receipt;
        return this.#completeMergeTransaction(entry, receipt);
    }

    bindGpuBody(logicalTowerId, handle, protocol) {
        this.#assertUsable();
        const id = requireLogicalTowerId(logicalTowerId);
        const record = this.#records.get(id);
        if (!record || record.state !== TOWER_GROUP_RECORD_STATE.LIVING
            || record.currentHpFixedPoint <= 0) {
            throw new Error('살아 있는 positive-HP Tower만 GPU body에 결합할 수 있습니다.');
        }
        const exactHandle = freezeExactTowerHandle(handle);
        const exactProtocol = normalizeTowerGpuProtocol(protocol);
        if (this.activeProtocol
            && !sameTowerGpuProtocol(this.activeProtocol, exactProtocol)) {
            throw new Error('한 TowerGroup은 하나의 GPU protocol만 사용할 수 있습니다.');
        }
        const key = handleKey(exactHandle);
        const existingOwner = this.#bindingToLogicalId.get(key);
        if (existingOwner && existingOwner !== id) {
            throw new Error('GPU exact Tower binding은 logical Tower마다 고유해야 합니다.');
        }
        if (record.exactGpuBinding
            && sameExactTowerHandle(record.exactGpuBinding, exactHandle)
            && sameTowerGpuProtocol(record.exactGpuBinding, exactProtocol)) {
            return record.exactGpuBinding;
        }
        if (record.exactGpuBinding) {
            this.#bindingToLogicalId.delete(handleKey(record.exactGpuBinding));
        }
        const binding = Object.freeze({ ...exactHandle, ...exactProtocol });
        this.#records.set(id, createRecord({ ...record, exactGpuBinding: binding }));
        this.#bindingToLogicalId.set(key, id);
        if (!this.activeProtocol) {
            this.activeProtocol = exactProtocol;
            this.lastCommittedSourceTick = 0;
            this.lastCommittedSequence = -1;
        }
        this.#lethalDamageByLogicalId.delete(id);
        this.stateRevision++;
        return binding;
    }

    releaseGpuBindings() {
        if (this.destroyed) return 0;
        let releasedCount = 0;
        for (const [id, record] of this.#records) {
            if (!record.exactGpuBinding) continue;
            this.#records.set(id, createRecord({
                ...record,
                exactGpuBinding: null
            }));
            releasedCount++;
        }
        this.#bindingToLogicalId.clear();
        this.#lethalDamageByLogicalId.clear();
        this.activeProtocol = null;
        this.lastCommittedSourceTick = 0;
        this.lastCommittedSequence = -1;
        if (releasedCount > 0) this.stateRevision++;
        return releasedCount;
    }

    commitCompletedEvents(snapshot, registry) {
        this.#assertUsable();
        this.lastCommittedFacts = EMPTY_FACTS;
        if (!this.activeProtocol || !Array.isArray(snapshot?.events)
            || snapshot.protocolFailure) {
            return this.lastCommittedFacts;
        }

        const facts = [];
        for (const event of snapshot.events) {
            const isDamage = event?.type === 'contact'
                && event?.eventType === 'damage-applied'
                && event?.disposition === 'applied';
            const isDeath = event?.type === 'death'
                && event?.eventType === 'death'
                && event?.disposition === 'despawn-requested';
            if (!isDamage && !isDeath) continue;
            const targetHandle = isDamage ? event.other : event;
            const logicalTowerId = this.#bindingToLogicalId.get(
                targetHandle ? handleKey(targetHandle) : ''
            );
            const record = logicalTowerId
                ? this.#records.get(logicalTowerId)
                : null;
            const binding = record?.exactGpuBinding;
            if (!record || record.state !== TOWER_GROUP_RECORD_STATE.LIVING
                || !binding || !sameExactTowerHandle(targetHandle, binding)
                || !sameTowerGpuProtocol(event, binding)) {
                continue;
            }
            const sourceTick = Number(event.sourceTick);
            const sequence = Number(event.sequence);
            if (!Number.isSafeInteger(sourceTick) || sourceTick <= 0
                || !Number.isSafeInteger(sequence) || sequence < 0
                || sourceTick < this.lastCommittedSourceTick
                || (sourceTick === this.lastCommittedSourceTick
                    && sequence <= this.lastCommittedSequence)) {
                continue;
            }
            const key = eventIdentity(event);
            if (this.#knownEventKeys.has(key)) continue;
            if (isDamage) {
                const damageFixedPoint = Number(event.damageFixedPoint);
                if (!Number.isSafeInteger(damageFixedPoint)
                    || damageFixedPoint <= 0) {
                    continue;
                }
                this.#acceptEventIdentity(key, sourceTick, sequence);
                const currentHpFixedPoint = Math.max(
                    0,
                    record.currentHpFixedPoint - damageFixedPoint
                );
                const updatedRecord = createRecord({
                    ...record,
                    currentHpFixedPoint
                });
                this.#records.set(logicalTowerId, updatedRecord);
                this.stateRevision++;
                const provenance = snapshotSourceProvenance(registry, event);
                const fact = Object.freeze({
                    type: TOWER_COMBAT_FACT_TYPE.DAMAGE_APPLIED,
                    logicalTowerId,
                    logicalTowerOrdinal: record.logicalTowerOrdinal,
                    shareUnits: record.shareUnits,
                    targetHandle: Object.freeze({
                        entityId: binding.entityId,
                        incarnation: binding.incarnation
                    }),
                    sourceHandle: Object.freeze({
                        entityId: event.entityId,
                        incarnation: event.incarnation
                    }),
                    ...provenance,
                    ...freezeFactProtocol(event),
                    damageFixedPoint,
                    damage: decodeGpuCircleBodyFixedPoint(damageFixedPoint),
                    currentHp: decodeGpuCircleBodyFixedPoint(
                        currentHpFixedPoint
                    ),
                    maxHp: decodeGpuCircleBodyFixedPoint(record.maxHpFixedPoint),
                    targetDied: event.reason === 'target-died'
                });
                this.lastCommittedDamage = fact;
                if (fact.targetDied) {
                    this.#lethalDamageByLogicalId.set(logicalTowerId, fact);
                }
                facts.push(fact);
                continue;
            }

            this.#acceptEventIdentity(key, sourceTick, sequence);
            const lethalDamageFact = this.#lethalDamageByLogicalId
                .get(logicalTowerId);
            const sourceFact = lethalDamageFact?.targetDied
                && sameExactTowerHandle(lethalDamageFact.targetHandle, binding)
                && sameTowerGpuProtocol(lethalDamageFact, event)
                && lethalDamageFact.sourceTick === event.sourceTick
                && lethalDamageFact.sequence < event.sequence
                ? lethalDamageFact
                : null;
            const deadRecord = createRecord({
                ...record,
                currentHpFixedPoint: 0,
                state: TOWER_GROUP_RECORD_STATE.DEAD,
                exactGpuBinding: null
            });
            this.#records.set(logicalTowerId, deadRecord);
            this.#bindingToLogicalId.delete(handleKey(binding));
            this.#lethalDamageByLogicalId.delete(logicalTowerId);
            this.livingTowerCount--;
            const lostShareUnits = this.ledger.commitLostShare(record.shareUnits);
            this.groupRevision++;
            this.stateRevision++;
            if (this.primaryLogicalTowerId === logicalTowerId) {
                this.primaryLogicalTowerId = this.#selectPrimaryLogicalTowerId();
            }
            const deathFact = Object.freeze({
                type: TOWER_COMBAT_FACT_TYPE.DIED,
                logicalTowerId,
                logicalTowerOrdinal: record.logicalTowerOrdinal,
                shareUnits: record.shareUnits,
                targetHandle: Object.freeze({
                    entityId: binding.entityId,
                    incarnation: binding.incarnation
                }),
                sourceHandle: sourceFact?.sourceHandle ?? null,
                producerId: sourceFact?.producerId ?? null,
                sourceAbilityId: sourceFact?.sourceAbilityId ?? null,
                sourceTeamId: sourceFact?.sourceTeamId ?? null,
                ...freezeFactProtocol(event),
                currentHp: 0,
                maxHp: decodeGpuCircleBodyFixedPoint(record.maxHpFixedPoint),
                reason: event.reason ?? null,
                reasonFlags: event.reasonFlags ?? event.flags ?? 0
            });
            this.lastCommittedDeath = deathFact;
            facts.push(deathFact);
            facts.push(Object.freeze({
                type: TOWER_COMBAT_FACT_TYPE.SHARE_LOST,
                logicalTowerId,
                logicalTowerOrdinal: record.logicalTowerOrdinal,
                shareLostUnits: record.shareUnits,
                lostShareUnits,
                livingShareUnits: TOWER_SHARE_SCALE - lostShareUnits,
                ...freezeFactProtocol(event)
            }));
            if (this.livingTowerCount === 0) {
                facts.push(Object.freeze({
                    type: TOWER_COMBAT_FACT_TYPE.NO_LIVING_TOWERS,
                    logicalTowerId,
                    livingTowerCount: 0,
                    lostShareUnits,
                    ...freezeFactProtocol(event)
                }));
            }
        }
        if (this.#bindingToLogicalId.size === 0) {
            this.activeProtocol = null;
        }
        this.lastCommittedFacts = facts.length > 0
            ? Object.freeze(facts)
            : EMPTY_FACTS;
        return this.lastCommittedFacts;
    }

    getPrimaryTowerRecord() {
        if (this.destroyed || !this.primaryLogicalTowerId) return null;
        return freezeRecordView(this.#records.get(this.primaryLogicalTowerId));
    }

    getTowerRecord(logicalTowerId) {
        if (this.destroyed) return null;
        return freezeRecordView(this.#records.get(
            requireLogicalTowerId(logicalTowerId)
        ));
    }

    getTowerRecords() {
        if (this.destroyed) return Object.freeze([]);
        return Object.freeze([...this.#records.values()]
            .sort((left, right) => (
                left.logicalTowerOrdinal - right.logicalTowerOrdinal
            ))
            .map(freezeRecordView));
    }

    getLivingTowerCount() {
        return this.destroyed ? 0 : this.livingTowerCount;
    }

    getLastCommittedFacts() {
        return this.lastCommittedFacts;
    }

    getStatus() {
        const primaryTower = this.getPrimaryTowerRecord();
        const ledger = this.ledger.getStatus();
        return Object.freeze({
            runBaseMaxHp: decodeGpuCircleBodyFixedPoint(
                this.runBaseMaxHpFixedPoint
            ),
            runBasePower: decodeGpuCircleBodyFixedPoint(
                this.runBasePowerFixedPoint
            ),
            runBaseMaxHpFixedPoint: this.runBaseMaxHpFixedPoint,
            runBasePowerFixedPoint: this.runBasePowerFixedPoint,
            fullShareUnits: TOWER_SHARE_SCALE,
            livingShareUnits: this.destroyed
                ? 0
                : TOWER_SHARE_SCALE - ledger.lostShareUnits,
            lostShareUnits: ledger.lostShareUnits,
            livingTowerCount: this.getLivingTowerCount(),
            totalTowerRecordCount: this.destroyed ? 0 : this.#records.size,
            primaryLogicalTowerId: primaryTower?.logicalTowerId ?? null,
            primaryTower,
            groupRevision: this.groupRevision,
            stateRevision: this.stateRevision,
            pendingCreation: this.#pendingCreation
                ? Object.freeze({
                    transactionId: this.#pendingCreation.plan.transactionId,
                    childCount: this.#pendingCreation.plan.childCount,
                    fingerprint: this.#pendingCreation.plan.fingerprint
                })
                : null,
            pendingMerge: this.#pendingMerge
                ? Object.freeze({
                    transactionId:
                        this.#pendingMerge.plan.transactionId,
                    sourceCount: this.#pendingMerge.plan.sourceCount,
                    survivorLogicalTowerId:
                        this.#pendingMerge.plan.survivor.logicalTowerId,
                    requestedFixedTick:
                        this.#pendingMerge.plan.requestedFixedTick,
                    fingerprint: this.#pendingMerge.plan.fingerprint
                })
                : null,
            lastCommittedDamage: this.lastCommittedDamage,
            lastCommittedDeath: this.lastCommittedDeath,
            lastCommittedFacts: this.lastCommittedFacts,
            lastCreation: this.lastCreation,
            lastMerge: this.lastMerge,
            rememberedEventCount: this.#knownEventKeys.size,
            rememberedCreationTransactionCount:
                this.#knownCreationTransactionIds.size,
            rememberedMergeTransactionCount: this.#mergeTransactions.size,
            mergeHistoryCapacity: this.mergeHistoryCapacity,
            destroyed: this.destroyed
        });
    }

    auditInvariants() {
        const violations = [];
        const records = [...this.#records.values()];
        const ids = new Set();
        const ordinals = new Set();
        const bindings = new Set();
        let livingCount = 0;
        let deadCount = 0;
        let mergedCount = 0;
        let deadShareUnits = 0;
        for (const record of records) {
            if (ids.has(record.logicalTowerId)) {
                violations.push(`duplicate-id:${record.logicalTowerId}`);
            }
            if (ordinals.has(record.logicalTowerOrdinal)) {
                violations.push(`duplicate-ordinal:${record.logicalTowerOrdinal}`);
            }
            ids.add(record.logicalTowerId);
            ordinals.add(record.logicalTowerOrdinal);
            if (record.creationMetadata
                && (record.creationMetadata.recoveryPlacementDescriptor
                        ?.logicalTowerOrdinal !== record.logicalTowerOrdinal
                    || record.recoverySpawnDescriptor?.logicalTowerOrdinal
                        !== record.logicalTowerOrdinal
                    || record.creationMetadata.recoveryPlacementDescriptor
                        ?.policyId
                        !== record.recoverySpawnDescriptor?.policyId
                    || record.creationMetadata.recoveryPlacementDescriptor
                        ?.mapLatticeVersion
                        !== record.recoverySpawnDescriptor
                            ?.mapLatticeVersion)) {
                violations.push(`creation-metadata:${record.logicalTowerId}`);
            }
            if (record.currentHpFixedPoint < 0
                || record.currentHpFixedPoint > record.maxHpFixedPoint) {
                violations.push(`hp-bounds:${record.logicalTowerId}`);
            }
            if (record.state === TOWER_GROUP_RECORD_STATE.LIVING) {
                livingCount++;
                if (record.shareUnits <= 0 || record.maxHpFixedPoint <= 0) {
                    violations.push(`living-non-viable:${record.logicalTowerId}`);
                }
            } else if (record.state === TOWER_GROUP_RECORD_STATE.DEAD) {
                deadCount++;
                deadShareUnits += record.shareUnits;
                if (record.currentHpFixedPoint !== 0
                    || record.exactGpuBinding !== null) {
                    violations.push(`dead-state:${record.logicalTowerId}`);
                }
            } else if (record.state === TOWER_GROUP_RECORD_STATE.MERGED) {
                mergedCount++;
                if (record.shareUnits !== 0
                    || record.currentHpFixedPoint !== 0
                    || record.maxHpFixedPoint !== 0
                    || record.powerFixedPoint !== 0
                    || record.exactGpuBinding !== null
                    || !record.mergedIntoLogicalTowerId
                    || !this.#records.has(record.mergedIntoLogicalTowerId)) {
                    violations.push(`merged-state:${record.logicalTowerId}`);
                }
            } else {
                violations.push(`published-pending:${record.logicalTowerId}`);
            }
            if (record.exactGpuBinding) {
                const key = handleKey(record.exactGpuBinding);
                if (bindings.has(key)
                    || this.#bindingToLogicalId.get(key)
                        !== record.logicalTowerId
                    || (this.activeProtocol
                        && !sameTowerGpuProtocol(
                            record.exactGpuBinding,
                            this.activeProtocol
                        ))) {
                    violations.push(`binding:${record.logicalTowerId}`);
                }
                bindings.add(key);
            }
        }
        const shareAudit = this.ledger.auditShareInvariant(records.filter(
            (record) => record.state === TOWER_GROUP_RECORD_STATE.LIVING
        ));
        if (!shareAudit.valid) violations.push('share-conservation');
        if (deadShareUnits !== shareAudit.lostShareUnits) {
            violations.push('dead-lost-share-mismatch');
        }
        if (livingCount !== this.livingTowerCount) {
            violations.push('living-count-mismatch');
        }
        const selectedPrimary = this.#selectPrimaryLogicalTowerId();
        if (selectedPrimary !== this.primaryLogicalTowerId) {
            violations.push('primary-selection-mismatch');
        }
        if (bindings.size !== this.#bindingToLogicalId.size) {
            violations.push('binding-index-size');
        }
        if (this.#pendingCreation && this.#pendingMerge) {
            violations.push('creation-merge-mutual-exclusion');
        }
        return Object.freeze({
            valid: violations.length === 0,
            violations: Object.freeze(violations),
            ...shareAudit,
            towerRecordCount: records.length,
            livingTowerCount: livingCount,
            deadTowerCount: deadCount,
            mergedTowerCount: mergedCount,
            pendingCreationCount: this.#pendingCreation ? 1 : 0,
            pendingMergeCount: this.#pendingMerge ? 1 : 0
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.#records.clear();
        this.#bindingToLogicalId.clear();
        this.#knownEventKeys.clear();
        this.#eventKeyHistory.length = 0;
        this.#eventKeyHead = 0;
        this.#knownCreationTransactionIds.clear();
        this.#creationTransactionOrder.length = 0;
        this.#mergeTransactions.clear();
        this.#completedMergeTransactionOrder.length = 0;
        this.#lethalDamageByLogicalId.clear();
        this.#pendingCreation = null;
        this.#pendingMerge = null;
        this.activeProtocol = null;
        this.primaryLogicalTowerId = null;
        this.livingTowerCount = 0;
        this.lastCommittedFacts = EMPTY_FACTS;
        this.lastMerge = null;
        this.ledger.destroy();
    }

    #createMergePlan(request, publishPending) {
        const requestFingerprint = fingerprintMergeRequest(request);
        if (publishPending) {
            const existing = this.#mergeTransactions.get(
                request.transactionId
            );
            if (existing) {
                if (existing.requestFingerprint !== requestFingerprint
                    || (request.expectedPlanFingerprint !== null
                        && request.expectedPlanFingerprint
                            !== existing.planFingerprint)) {
                    return freezeMergeRejection(
                        TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                        TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                        {
                            transactionId: request.transactionId,
                            requestFingerprint,
                            expectedRequestFingerprint:
                                existing.requestFingerprint,
                            planFingerprint:
                                request.expectedPlanFingerprint,
                            expectedPlanFingerprint: existing.planFingerprint
                        }
                    );
                }
                if (existing.stage === 'completed') {
                    return existing.receipt;
                }
                const activePlan = existing.receipt;
                const livingRecords = this.#getLivingRecords();
                if (this.#pendingMerge?.plan === activePlan
                    && this.groupRevision
                        === activePlan.sourceGroupRevision
                    && this.stateRevision
                        === activePlan.sourceStateRevision
                    && this.primaryLogicalTowerId
                        === activePlan.sourcePrimaryLogicalTowerId
                    && fingerprintLivingRecords(livingRecords)
                        === activePlan.sourceFingerprint) {
                    return activePlan;
                }
                return freezeMergeRejection(
                    TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                    TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                    {
                        transactionId: request.transactionId,
                        requestFingerprint,
                        expectedPlanFingerprint: existing.planFingerprint
                    }
                );
            }
        }

        const built = this.#buildMergePlan(request);
        if (!publishPending) return built.receipt;
        const entry = {
            transactionId: request.transactionId,
            requestFingerprint,
            planFingerprint: built.receipt.fingerprint ?? null,
            stage: 'received',
            receipt: null
        };
        this.#mergeTransactions.set(request.transactionId, entry);
        if (request.expectedPlanFingerprint !== null
            && request.expectedPlanFingerprint !== entry.planFingerprint) {
            const receipt = freezeMergeRejection(
                TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                TOWER_MERGE_REASON.TRANSACTION_FINGERPRINT_MISMATCH,
                {
                    transactionId: request.transactionId,
                    requestFingerprint,
                    planFingerprint: request.expectedPlanFingerprint,
                    expectedPlanFingerprint: entry.planFingerprint
                }
            );
            this.lastMerge = receipt;
            return this.#completeMergeTransaction(entry, receipt);
        }
        if (this.#pendingCreation) {
            const receipt = freezeMergeRejection(
                TOWER_MERGE_RESULT.REJECTED_CONFLICTING_TRANSACTION,
                TOWER_MERGE_REASON.CREATION_TRANSACTION_PENDING,
                {
                    transactionId: request.transactionId,
                    requestFingerprint,
                    fingerprint: entry.planFingerprint
                }
            );
            this.lastMerge = receipt;
            return this.#completeMergeTransaction(entry, receipt);
        }
        if (this.#pendingMerge) {
            const receipt = freezeMergeRejection(
                TOWER_MERGE_RESULT.REJECTED_CONFLICTING_TRANSACTION,
                TOWER_MERGE_REASON.MERGE_TRANSACTION_PENDING,
                {
                    transactionId: request.transactionId,
                    requestFingerprint,
                    fingerprint: entry.planFingerprint
                }
            );
            this.lastMerge = receipt;
            return this.#completeMergeTransaction(entry, receipt);
        }
        if (!built.receipt.accepted) {
            entry.receipt = built.receipt;
            this.lastMerge = built.receipt;
            return this.#completeMergeTransaction(entry, built.receipt);
        }
        entry.stage = 'pending';
        entry.receipt = built.receipt;
        this.#pendingMerge = {
            request,
            requestFingerprint,
            plan: built.receipt,
            plannedSurvivor: built.plannedSurvivor,
            livingRecords: built.livingRecords
        };
        return built.receipt;
    }

    #buildMergePlan(request) {
        const requestFingerprint = fingerprintMergeRequest(request);
        const livingRecords = this.#getLivingRecords();
        let arithmetic;
        try {
            arithmetic = this.ledger.planMerge(
                livingRecords,
                this.primaryLogicalTowerId
            );
        } catch (error) {
            return {
                receipt: freezeMergeRejection(
                    TOWER_MERGE_RESULT.PROTOCOL_FAILURE,
                    TOWER_MERGE_REASON.SOURCE_CHANGED,
                    {
                        transactionId: request.transactionId,
                        requestFingerprint,
                        detail: error?.message ?? String(error)
                    }
                ),
                plannedSurvivor: null,
                livingRecords
            };
        }
        const sourceGroupRevision = this.groupRevision;
        const sourceStateRevision = this.stateRevision;
        const sourcePrimaryLogicalTowerId = this.primaryLogicalTowerId;
        const sourceFingerprint = fingerprintLivingRecords(livingRecords);
        const sourceStructureFingerprint = fingerprintLivingStructure(
            livingRecords
        );
        const fingerprint = fingerprintMergePlan({
            request,
            sourceGroupRevision,
            sourceStateRevision,
            sourcePrimaryLogicalTowerId,
            sourceFingerprint,
            sourceStructureFingerprint,
            arithmetic,
            livingRecords
        });
        if (!arithmetic.accepted) {
            return {
                receipt: freezeMergeRejection(
                    arithmetic.result,
                    arithmetic.reason,
                    {
                        transactionId: request.transactionId,
                        requestFingerprint,
                        fingerprint,
                        requestedFixedTick: request.requestedFixedTick,
                        operationIdentity: request.compiledOperation,
                        sourceCount: arithmetic.sourceCount,
                        lostShareUnits: arithmetic.lostShareUnits
                    }
                ),
                plannedSurvivor: null,
                livingRecords
            };
        }
        const survivor = livingRecords.find((record) => (
            record.logicalTowerId === arithmetic.survivorLogicalTowerId
        ));
        const plannedSurvivor = createRecord({
            ...survivor,
            shareUnits: arithmetic.livingShareUnits,
            currentHpFixedPoint: arithmetic.currentHpFixedPoint,
            maxHpFixedPoint: arithmetic.maxHpFixedPoint,
            powerFixedPoint: arithmetic.powerFixedPoint,
            state: TOWER_GROUP_RECORD_STATE.LIVING
        });
        const sourceViews = Object.freeze(livingRecords.map(freezeRecordView));
        const plan = Object.freeze({
            accepted: true,
            result: null,
            reason: null,
            recoveryRequired: false,
            transactionId: request.transactionId,
            requestFingerprint,
            fingerprint,
            requestedFixedTick: request.requestedFixedTick,
            operationIdentity: request.compiledOperation,
            sourceGroupRevision,
            sourceStateRevision,
            targetGroupRevision: sourceGroupRevision + 1,
            sourcePrimaryLogicalTowerId,
            sourceFingerprint,
            sourceStructureFingerprint,
            sourceCount: arithmetic.sourceCount,
            sources: sourceViews,
            survivor: freezeRecordView(plannedSurvivor),
            consumed: Object.freeze(sourceViews.filter((record) => (
                record.logicalTowerId
                    !== arithmetic.survivorLogicalTowerId
            ))),
            livingShareUnits: arithmetic.livingShareUnits,
            lostShareUnits: arithmetic.lostShareUnits,
            currentHpFixedPoint: arithmetic.currentHpFixedPoint,
            maxHpFixedPoint: arithmetic.maxHpFixedPoint,
            powerFixedPoint: arithmetic.powerFixedPoint
        });
        return { receipt: plan, plannedSurvivor, livingRecords };
    }

    #rejectPendingMergeSourceChanged(plan) {
        const entry = this.#mergeTransactions.get(plan.transactionId);
        this.#pendingMerge = null;
        const receipt = freezeMergeRejection(
            TOWER_MERGE_RESULT.REJECTED_SOURCE_CHANGED,
            TOWER_MERGE_REASON.SOURCE_CHANGED,
            {
                transactionId: plan.transactionId,
                requestFingerprint: plan.requestFingerprint,
                fingerprint: plan.fingerprint,
                sourceGroupRevision: plan.sourceGroupRevision,
                sourceStateRevision: plan.sourceStateRevision
            }
        );
        this.lastMerge = receipt;
        return this.#completeMergeTransaction(entry, receipt);
    }

    #completeMergeTransaction(entry, receipt) {
        if (!entry) return receipt;
        if (entry.stage !== 'completed') {
            this.#completedMergeTransactionOrder.push(entry.transactionId);
        }
        entry.stage = 'completed';
        entry.receipt = receipt;
        while (this.#completedMergeTransactionOrder.length
            > this.mergeHistoryCapacity) {
            const retired = this.#completedMergeTransactionOrder.shift();
            const retiredEntry = this.#mergeTransactions.get(retired);
            if (retiredEntry?.stage === 'completed') {
                this.#mergeTransactions.delete(retired);
            }
        }
        return receipt;
    }

    #getLivingRecords() {
        return [...this.#records.values()]
            .filter((record) => record.state === TOWER_GROUP_RECORD_STATE.LIVING)
            .sort((left, right) => (
                left.logicalTowerOrdinal - right.logicalTowerOrdinal
            ));
    }

    #selectPrimaryLogicalTowerId() {
        return this.#getLivingRecords()[0]?.logicalTowerId ?? null;
    }

    #acceptEventIdentity(key, sourceTick, sequence) {
        this.#knownEventKeys.add(key);
        this.#eventKeyHistory.push(key);
        while ((this.#eventKeyHistory.length - this.#eventKeyHead)
            > this.eventHistoryCapacity) {
            this.#knownEventKeys.delete(
                this.#eventKeyHistory[this.#eventKeyHead++]
            );
        }
        if (this.#eventKeyHead >= this.eventHistoryCapacity) {
            this.#eventKeyHistory = this.#eventKeyHistory.slice(
                this.#eventKeyHead
            );
            this.#eventKeyHead = 0;
        }
        this.lastCommittedSourceTick = sourceTick;
        this.lastCommittedSequence = sequence;
    }

    #rememberCreationTransaction(transactionId) {
        this.#knownCreationTransactionIds.add(transactionId);
        this.#creationTransactionOrder.push(transactionId);
        while (this.#creationTransactionOrder.length
            > this.creationHistoryCapacity) {
            const retired = this.#creationTransactionOrder.shift();
            this.#knownCreationTransactionIds.delete(retired);
        }
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 TowerGroupState는 사용할 수 없습니다.');
        }
    }
}

export {
    PRIMARY_TOWER_LOGICAL_ID,
    TOWER_COMBAT_FACT_TYPE,
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_GROUP_RECORD_STATE,
    TOWER_MERGE_REASON,
    TOWER_MERGE_RESULT,
    TOWER_SHARE_SCALE
};
