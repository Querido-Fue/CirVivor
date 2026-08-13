import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    getEnemyAtomicTransformTopologyCardinality,
    normalizeEnemyAtomicTransformTopologyId
} from '../../contract/enemy_atomic_transform_contract.js';
import {
    normalizeJorangLineageBranchState
} from '../../contract/enemy_jorang_split_contract.js';
import {
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    BASIC_JORANG_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_jorang_enemy_data.js';
import {
    CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
    JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
} from 'data/object/enemy/enemy_jorang_split_catalog_data.js';
import {
    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
} from 'data/object/enemy/enemy_jorang_split_runtime_data.js';
import {
    createGpuPrivateCirclePrimeReturnDestinationIntent,
    createGpuPrivateJorangSplitDestinationIntents
} from './gpu_enemy_spawn_adapter.js';
const INVALID_U32 = 0xffffffff;
const TRANSFORM_DISPOSITION = 'atomic-transform';
const FIRST_HIT_EVENT_CAPACITY_REJECTION_REASON
    = 'atomic-transform-first-hit-event-capacity';

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number <= 0
        || number >= INVALID_U32) {
        throw new RangeError(`${label}은 live uint32 범위의 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < 0
        || number >= INVALID_U32) {
        throw new RangeError(`${label}은 live uint32 범위의 정수여야 합니다.`);
    }
    return number;
}

function requireUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return value;
}

function normalizeFirstHitCapacityEvidence(snapshot) {
    for (const key of [
        'atomicTransformFirstHitCapacityRejected',
        'retryableAtomicTransformFirstHitCapacityRejected',
        'atomicTransformFirstHitRejectionReason',
        'atomicTransformFirstHitCandidateCount',
        'atomicTransformFirstHitCommittedCount',
        'atomicTransformFirstHitEventBase',
        'atomicTransformFirstHitEventCapacity'
    ]) {
        if (!Object.hasOwn(snapshot, key)) {
            throw new TypeError(`completedEvents.${key}가 필요합니다.`);
        }
    }
    const capacityRejected
        = snapshot.atomicTransformFirstHitCapacityRejected;
    const retryable
        = snapshot.retryableAtomicTransformFirstHitCapacityRejected;
    const reason = snapshot.atomicTransformFirstHitRejectionReason;
    if (typeof capacityRejected !== 'boolean'
        || typeof retryable !== 'boolean') {
        throw new TypeError(
            'first-hit capacity rejection marker는 boolean이어야 합니다.'
        );
    }
    const candidateCount = requireNonNegativeSafeInteger(
        snapshot.atomicTransformFirstHitCandidateCount,
        'completedEvents.atomicTransformFirstHitCandidateCount'
    );
    const committedCount = requireNonNegativeSafeInteger(
        snapshot.atomicTransformFirstHitCommittedCount,
        'completedEvents.atomicTransformFirstHitCommittedCount'
    );
    const eventBase = requireNonNegativeSafeInteger(
        snapshot.atomicTransformFirstHitEventBase,
        'completedEvents.atomicTransformFirstHitEventBase'
    );
    const eventCapacity = requireNonNegativeSafeInteger(
        snapshot.atomicTransformFirstHitEventCapacity,
        'completedEvents.atomicTransformFirstHitEventCapacity'
    );
    if (capacityRejected) {
        if (retryable !== true
            || reason !== FIRST_HIT_EVENT_CAPACITY_REJECTION_REASON
            || candidateCount <= 0
            || committedCount !== 0
            || eventCapacity <= 0
            || eventBase > eventCapacity
            || candidateCount <= eventCapacity - eventBase) {
            throw new RangeError(
                'first-hit event capacity rejection evidence가 exact whole-batch 계약과 다릅니다.'
            );
        }
    } else if (retryable !== false
        || reason !== null
        || candidateCount !== committedCount
        || eventBase > eventCapacity
        || candidateCount > eventCapacity - eventBase) {
        throw new RangeError(
            'normal first-hit event capacity evidence가 잘못되었습니다.'
        );
    }
    return Object.freeze({
        capacityRejected,
        retryable,
        reason,
        candidateCount,
        committedCount,
        eventBase,
        eventCapacity
    });
}

function normalizeHandle(source, label) {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(
            source?.entityId ?? source?.sourceEntityId,
            `${label}.entityId`
        ),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation ?? source?.sourceIncarnation,
            `${label}.incarnation`
        )
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function compareDueCandidates(left, right) {
    const leftDuePriority = left.topologyId
        === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED ? 0 : 1;
    const rightDuePriority = right.topologyId
        === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED ? 0 : 1;
    return leftDuePriority - rightDuePriority
        || left.dueFixedTick - right.dueFixedTick
        || left.lineageRootEntityId - right.lineageRootEntityId
        || left.lineageRootIncarnation - right.lineageRootIncarnation
        || left.sourceHandle.entityId - right.sourceHandle.entityId
        || left.sourceHandle.incarnation - right.sourceHandle.incarnation;
}

function normalizeBranchMetadata(metadata, label) {
    return normalizeJorangLineageBranchState({
        lineageRootEntityId: metadata?.lineageRootEntityId,
        lineageRootIncarnation: metadata?.lineageRootIncarnation,
        branchIndex: metadata?.branchIndex,
        bountyBudget: metadata?.bountyBudget,
        transformAtTick: metadata?.transformAtTick
    }, label);
}

function assertRegistry(source) {
    for (const method of [
        'has',
        'copyEntityView'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`J lineage registry.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function assertCommandPort(source) {
    for (const method of [
        'requestPrepareBatch',
        'requestPreparedTransformBatch',
        'discardPreparedBatch'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`J lineage command port.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function copyPreparedSourceHandle(record, label) {
    return normalizeHandle(
        record?.sourceHandle ?? record,
        label
    );
}

/**
 * J first-hit pending과 C′ delayed return의 한 lineage-global start quota를 소유합니다.
 * GPU prepare authentic receipt만 T lifecycle command로 승격하며 raw hit event는
 * transaction proof나 별도 quota ticket으로 사용하지 않습니다.
 */
export class JorangSplitLineageDirector {
    constructor(options = {}) {
        this.registry = assertRegistry(options.registry);
        this.commandPort = assertCommandPort(
            options.atomicTransformCommandPort
        );
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration,
            'sessionGeneration'
        );
        this.capacity = requirePositiveSafeInteger(
            options.capacity,
            'capacity'
        );
        this.pendingTransformsByParent = new Map();
        this.completedPrepareFingerprintByTick = new Map();
        this.observedLifecycleCommits = new WeakSet();
        this.observedFirstHitCapacitySnapshots = new WeakSet();
        this.lastFixedCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastPreparedSourceTick = 0;
        this.lastPrepareStageTick = 0;
        this.lastPrepareStageResult = null;
        this.lastTriggerEventCount = 0;
        this.retryableFirstHitEventCapacityCount = 0;
        this.pendingFirstHitsByHandleKey = new Map();
        this.circlePrimeDueByHandleKey = new Map();
        this.retryableCapacityCount = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        this.destroyed = false;
    }

    observeCompletedEvents(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('trigger-event-snapshot-contract');
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code
                    ?? 'trigger-event-protocol-failure'
            );
        }
        if (!Array.isArray(snapshot.events)) {
            return this.#fail('trigger-event-array-contract');
        }
        let capacityEvidence;
        try {
            capacityEvidence = normalizeFirstHitCapacityEvidence(snapshot);
        } catch (error) {
            return this.#fail(
                'trigger-event-capacity-contract',
                error?.message
            );
        }
        const triggerEvents = snapshot.events.filter((event) => (
            event?.atomicTransformTriggerFirstHit === true
        ));
        if (capacityEvidence.capacityRejected) {
            if (triggerEvents.length !== 0) {
                return this.#fail(
                    'trigger-event-capacity-partial-mutation',
                    'capacity rejection snapshot에 first-hit trigger event가 있습니다.'
                );
            }
            if (this.observedFirstHitCapacitySnapshots.has(snapshot)) {
                return Object.freeze({
                    accepted: true,
                    retryable: true,
                    replayed: true,
                    triggerCount: 0,
                    pendingCount: this.pendingFirstHitsByHandleKey.size,
                    capacityRejectionCount: 1,
                    transformStartCount: 0
                });
            }
            this.observedFirstHitCapacitySnapshots.add(snapshot);
            this.lastTriggerEventCount = 0;
            this.retryableFirstHitEventCapacityCount++;
            return Object.freeze({
                accepted: true,
                retryable: true,
                triggerCount: 0,
                pendingCount: this.pendingFirstHitsByHandleKey.size,
                capacityRejectionCount: 1,
                transformStartCount: 0
            });
        }
        const acceptedTriggers = [];
        const acceptedTargetKeys = new Set();
        try {
            for (const event of triggerEvents) {
                if (event.type !== 'contact'
                    || event.eventType !== 'damage-applied'
                    || event.valueFixedPoint !== 0
                    || event.damageFixedPoint !== 0
                    || event.reason !== 'atomic-transform-trigger-first-hit') {
                    throw new RangeError(
                        'first-hit event type/value/reason contract가 다릅니다.'
                    );
                }
                const triggerSourceHandle = normalizeHandle(
                    event,
                    'firstHitEvent.triggerSourceHandle'
                );
                const handle = normalizeHandle({
                    entityId: event.otherEntityId,
                    incarnation: event.otherIncarnation
                }, 'firstHitEvent.targetJHandle');
                if (!sameHandle(handle, event.other)) {
                    throw new RangeError(
                        'first-hit event other exact handle alias가 다릅니다.'
                    );
                }
                if (event.disposition === 'duplicate'
                    || event.disposition === 'stale') {
                    // Endpoint의 authentic replay/stale telemetry는 pending
                    // authoring이나 actual-start quota를 바꾸지 않습니다.
                    continue;
                }
                if (event.disposition !== 'applied') {
                    throw new RangeError(
                        'first-hit event disposition은 applied여야 합니다.'
                    );
                }
                const view = this.registry.copyEntityView(handle, {});
                if (!view
                    || view.definitionId !== BASIC_JORANG_ENEMY_DEFINITION_ID
                    || view.metadata?.atomicTransformProfileId
                        !== JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID) {
                    throw new RangeError(
                        'first-hit target은 current exact canonical J여야 합니다.'
                    );
                }
                const branchState = normalizeBranchMetadata(
                    view.metadata,
                    'firstHitEvent.targetJ.metadata'
                );
                if (branchState.transformAtTick !== 0) {
                    throw new RangeError(
                        'first-hit target J의 armed lineage가 canonical이 아닙니다.'
                    );
                }
                const key = handleKey(handle);
                if (this.pendingFirstHitsByHandleKey.has(key)
                    || acceptedTargetKeys.has(key)) {
                    throw new RangeError(
                        'first-hit applied event가 pending shield를 중복 통과했습니다.'
                    );
                }
                acceptedTargetKeys.add(key);
                acceptedTriggers.push(Object.freeze({
                    key,
                    sourceHandle: handle,
                    sourceTick: requirePositiveSafeInteger(
                        event.sourceTick,
                        'firstHitEvent.sourceTick'
                    ),
                    sequence: requireNonNegativeSafeInteger(
                        event.sequence,
                        'firstHitEvent.sequence'
                    ),
                    triggerSourceHandle
                }));
            }
            if (this.pendingFirstHitsByHandleKey.size
                    + acceptedTriggers.length > this.capacity) {
                throw new RangeError('first-hit pending roster capacity를 초과했습니다.');
            }
        } catch (error) {
            return this.#fail('trigger-event-validation', error?.message);
        }
        for (const accepted of acceptedTriggers) {
            this.pendingFirstHitsByHandleKey.set(accepted.key, Object.freeze({
                sourceHandle: accepted.sourceHandle,
                sourceTick: accepted.sourceTick,
                sequence: accepted.sequence,
                triggerSourceHandle: accepted.triggerSourceHandle
            }));
        }
        // Trigger는 GPU pending authoring 진단일 뿐 actual start ticket이 아닙니다.
        this.lastTriggerEventCount = acceptedTriggers.length;
        return Object.freeze({
            accepted: true,
            retryable: false,
            triggerCount: acceptedTriggers.length,
            pendingCount: this.pendingFirstHitsByHandleKey.size,
            capacityRejectionCount: 0,
            transformStartCount: 0
        });
    }

    observeCompletedPreparations(snapshot) {
        if (this.destroyed || !snapshot || typeof snapshot !== 'object') {
            return this.#fail('prepare-snapshot-contract');
        }
        if (snapshot.protocolFailure) {
            return this.#fail(
                snapshot.protocolFailure.code ?? 'prepare-protocol-failure'
            );
        }
        if (snapshot.stale === true || snapshot.batchIdFingerprint === 0) {
            return Object.freeze({
                accepted: true,
                stale: true,
                transformCount: 0
            });
        }
        let sourceTick;
        let targetFixedTick;
        let batchIdFingerprint;
        try {
            sourceTick = requirePositiveSafeInteger(
                snapshot.sourceTick,
                'sourceTick'
            );
            targetFixedTick = requirePositiveSafeInteger(
                snapshot.targetFixedTick,
                'targetFixedTick'
            );
            batchIdFingerprint = requirePositiveSafeInteger(
                snapshot.batchIdFingerprint,
                'batchIdFingerprint'
            );
        } catch (error) {
            return this.#fail('prepare-header-contract', error?.message);
        }
        if (targetFixedTick !== sourceTick + 1) {
            return this.#fail('prepare-publication-deadline');
        }
        if (!Array.isArray(snapshot.records)
            || snapshot.records.length > this.capacity) {
            return this.#fail('prepare-record-quota');
        }
        if (sourceTick < this.lastPreparedSourceTick) {
            return this.#fail('prepare-source-tick-regression');
        }
        const knownFingerprint = this.completedPrepareFingerprintByTick.get(
            sourceTick
        );
        if (knownFingerprint !== undefined) {
            if (knownFingerprint === batchIdFingerprint) {
                return Object.freeze({
                    accepted: true,
                    replayed: true,
                    stale: false,
                    transformCount: Math.min(
                        snapshot.records.length,
                        JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
                    )
                });
            }
            return this.#fail('prepare-snapshot-replay-conflict');
        }
        if (snapshot.records.length === 0) {
            const discarded = this.commandPort.discardPreparedBatch({
                batchIdFingerprint
            });
            if (discarded?.accepted !== true) {
                return discarded?.requiresRecovery === true
                    ? this.#fail(
                        'prepare-discard',
                        discarded.reason ?? 'prepare-discard-rejected'
                    )
                    : discarded;
            }
            this.#rememberCompletedPrepare(sourceTick, batchIdFingerprint);
            return Object.freeze({
                accepted: true,
                stale: false,
                transformCount: 0
            });
        }
        let selectedPreparedRecords;
        try {
            const orderedSourceKeys = new Set();
            selectedPreparedRecords = [...snapshot.records]
                .map((preparedRecord, index) => {
                const sourceHandle = copyPreparedSourceHandle(
                    preparedRecord,
                    `records[${index}].sourceHandle`
                );
                const sourceKey = handleKey(sourceHandle);
                if (orderedSourceKeys.has(sourceKey)) {
                    throw new RangeError('prepare source가 중복되었습니다.');
                }
                orderedSourceKeys.add(sourceKey);
                const topologyId = normalizeEnemyAtomicTransformTopologyId(
                    preparedRecord.topologyId,
                    `records[${index}].topologyId`
                );
                if (topologyId
                        !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    && topologyId
                        !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED) {
                    throw new RangeError('J lineage topology가 아닙니다.');
                }
                return Object.freeze({
                    preparedRecord,
                    sourceHandle,
                    topologyId,
                    dueFixedTick: requireNonNegativeSafeInteger(
                        preparedRecord.dueFixedTick ?? 0,
                        `records[${index}].dueFixedTick`
                    ),
                    lineageRootEntityId: requirePositiveSafeInteger(
                        preparedRecord.lineageRootEntityId,
                        `records[${index}].lineageRootEntityId`
                    ),
                    lineageRootIncarnation: requirePositiveSafeInteger(
                        preparedRecord.lineageRootIncarnation,
                        `records[${index}].lineageRootIncarnation`
                    )
                    });
                })
                .sort(compareDueCandidates)
                .slice(0, JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK);
        } catch (error) {
            return this.#fail('prepare-record-ordering', error?.message);
        }
        const records = [];
        const pendingRecords = [];
        const claimedSources = new Set();
        try {
            for (let index = 0; index < selectedPreparedRecords.length; index++) {
                const selected = selectedPreparedRecords[index];
                const preparedRecord = selected.preparedRecord;
                const sourceHandle = selected.sourceHandle;
                const sourceKey = handleKey(sourceHandle);
                if (claimedSources.has(sourceKey)) {
                    throw new RangeError('prepare source가 중복되었습니다.');
                }
                claimedSources.add(sourceKey);
                const topologyId = selected.topologyId;
                if (topologyId
                        !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    && topologyId
                        !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED) {
                    throw new RangeError('J lineage topology가 아닙니다.');
                }
                const sourceView = this.registry.copyEntityView(
                    sourceHandle,
                    {}
                );
                const expectedSourceDefinitionId = topologyId
                    === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    ? BASIC_JORANG_ENEMY_DEFINITION_ID
                    : BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID;
                const expectedSourceProfileId = topologyId
                    === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    ? JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
                    : CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID;
                if (!sourceView
                    || sourceView.definitionId !== expectedSourceDefinitionId
                    || sourceView.metadata?.atomicTransformProfileId
                        !== expectedSourceProfileId) {
                    throw new RangeError(
                        'prepared source registry definition이 topology와 다릅니다.'
                    );
                }
                const branchState = normalizeBranchMetadata(
                    sourceView.metadata,
                    `records[${index}].sourceMetadata`
                );
                if (branchState.lineageRootEntityId
                        !== selected.lineageRootEntityId
                    || branchState.lineageRootIncarnation
                        !== selected.lineageRootIncarnation
                    || requireUint32(
                        preparedRecord.branchIndex,
                        `records[${index}].branchIndex`
                    ) !== branchState.branchIndex
                    || requireUint32(
                        preparedRecord.bountyBudget,
                        `records[${index}].bountyBudget`
                    ) !== branchState.bountyBudget
                    || (topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED
                        && selected.dueFixedTick
                            !== branchState.transformAtTick)) {
                    throw new RangeError(
                        'prepared lineage/due facts가 registry metadata와 다릅니다.'
                    );
                }
                const {
                    prepareEvidence: _opaquePrepareEvidence,
                    ...adapterPreparedFacts
                } = preparedRecord;
                const adapterPreparedRecord = Object.freeze({
                    ...adapterPreparedFacts,
                    sourceHandle,
                    sourceDefinitionId: sourceView.definitionId,
                    sourceMetadata: sourceView.metadata,
                    transformAtTick: branchState.transformAtTick
                });
                const destinationIntents = topologyId
                    === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    ? createGpuPrivateJorangSplitDestinationIntents({
                        preparedRecord: adapterPreparedRecord,
                        transformFixedTick: targetFixedTick
                    })
                    : Object.freeze([
                        createGpuPrivateCirclePrimeReturnDestinationIntent({
                            preparedRecord: adapterPreparedRecord,
                            transformFixedTick: targetFixedTick
                        })
                    ]);
                const cardinality
                    = getEnemyAtomicTransformTopologyCardinality(topologyId);
                if (!Array.isArray(destinationIntents)
                    || destinationIntents.length
                        !== cardinality.destinationCount) {
                    throw new RangeError(
                        'prepared destination cardinality가 topology와 다릅니다.'
                    );
                }
                const prepareEvidence = preparedRecord.prepareEvidence
                    ?? snapshot.prepareEvidence;
                if (!prepareEvidence || typeof prepareEvidence !== 'object') {
                    throw new TypeError('authentic prepare evidence가 없습니다.');
                }
                records.push(Object.freeze({
                    topologyId,
                    sourceHandles: Object.freeze([sourceHandle]),
                    destinationIntents: Object.freeze([...destinationIntents]),
                    effectTransferDestinationIndex: 0,
                    disposition: TRANSFORM_DISPOSITION,
                    prepareEvidence
                }));
                pendingRecords.push(Object.freeze({
                    topologyId,
                    sourceHandle,
                    destinationCount: cardinality.destinationCount,
                    transformIndex: index
                }));
            }
        } catch (error) {
            return this.#fail('prepare-record-validation', error?.message);
        }
        const parentCommandId = [
            'jorang-atomic-transform',
            this.sessionGeneration,
            sourceTick,
            batchIdFingerprint
        ].join(':');
        if (this.pendingTransformsByParent.has(parentCommandId)) {
            return this.#fail('transform-parent-command-collision');
        }
        const receipt = this.commandPort.requestPreparedTransformBatch({
            commandId: parentCommandId,
            batchIdFingerprint,
            prepareSourceTick: sourceTick,
            targetFixedTick,
            records
        });
        if (receipt?.accepted !== true) {
            if (receipt?.requiresRecovery === true) {
                return this.#fail(
                    'transform-request',
                    receipt.reason ?? 'transform-request-rejected'
                );
            }
            return receipt;
        }
        if (receipt.commandId !== parentCommandId) {
            return this.#fail('transform-command-id-mismatch');
        }
        this.pendingTransformsByParent.set(parentCommandId, Object.freeze({
            targetFixedTick,
            records: Object.freeze(pendingRecords)
        }));
        this.#rememberCompletedPrepare(sourceTick, batchIdFingerprint);
        return Object.freeze({
            accepted: true,
            stale: false,
            transformCount: records.length,
            commandId: parentCommandId
        });
    }

    stageForFixedTick({ targetFixedTick } = {}) {
        if (this.destroyed || !this.ingressOpen || this.recoveryRequired) {
            return Object.freeze({
                accepted: false,
                reason: this.terminal
                    ? 'jorang-terminal-closed'
                    : 'jorang-unavailable'
            });
        }
        const tick = requirePositiveSafeInteger(
            targetFixedTick,
            'targetFixedTick'
        );
        if (tick < this.lastPrepareStageTick) {
            return this.#fail('prepare-stage-tick-regression');
        }
        if (tick === this.lastPrepareStageTick
            && this.lastPrepareStageResult !== null) {
            return Object.freeze({
                ...this.lastPrepareStageResult,
                replayed: true
            });
        }
        const dueCandidates = [];
        try {
            for (const due of this.circlePrimeDueByHandleKey.values()) {
                const view = this.registry.copyEntityView(
                    due.sourceHandle,
                    {}
                );
                if (!view
                    || view.definitionId
                        !== BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID
                    || view.metadata?.atomicTransformProfileId
                        !== CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID) {
                    throw new RangeError(
                        'C prime due roster와 registry exact handle이 다릅니다.'
                    );
                }
                const branchState = normalizeBranchMetadata(
                    view.metadata,
                    `circlePrime[${handleKey(due.sourceHandle)}].metadata`
                );
                if (branchState.transformAtTick !== due.dueFixedTick
                    || branchState.lineageRootEntityId
                        !== due.lineageRootEntityId
                    || branchState.lineageRootIncarnation
                        !== due.lineageRootIncarnation
                    || branchState.branchIndex !== due.branchIndex
                    || branchState.bountyBudget !== due.bountyBudget) {
                    throw new RangeError(
                        'C prime due roster metadata가 registry와 다릅니다.'
                    );
                }
                if (branchState.transformAtTick === 0
                    || branchState.transformAtTick > tick + 1) {
                    continue;
                }
                dueCandidates.push(due);
            }
            for (const pending of this.pendingFirstHitsByHandleKey.values()) {
                const view = this.registry.copyEntityView(
                    pending.sourceHandle,
                    {}
                );
                if (!view
                    || view.definitionId !== BASIC_JORANG_ENEMY_DEFINITION_ID
                    || view.metadata?.atomicTransformProfileId
                        !== JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID) {
                    this.pendingFirstHitsByHandleKey.delete(
                        handleKey(pending.sourceHandle)
                    );
                    continue;
                }
                const branchState = normalizeBranchMetadata(
                    view.metadata,
                    `jorang[${handleKey(pending.sourceHandle)}].metadata`
                );
                dueCandidates.push(Object.freeze({
                    sourceHandle: pending.sourceHandle,
                    topologyId:
                        ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY,
                    dueFixedTick: pending.sourceTick + 1,
                    lineageRootEntityId: branchState.lineageRootEntityId,
                    lineageRootIncarnation:
                        branchState.lineageRootIncarnation,
                    branchIndex: branchState.branchIndex,
                    bountyBudget: branchState.bountyBudget,
                    triggerSourceEntityId:
                        pending.triggerSourceHandle.entityId,
                    triggerSourceIncarnation:
                        pending.triggerSourceHandle.incarnation,
                    triggerSourceTick: pending.sourceTick,
                    triggerSequence: pending.sequence
                }));
            }
        } catch (error) {
            return this.#fail('prepare-stage-registry-scan', error?.message);
        }
        dueCandidates.sort(compareDueCandidates);
        if (dueCandidates.length === 0) {
            // GPU backend는 첫 non-empty spawn까지 의도적으로 deferred입니다.
            // 빈 J/C′ roster가 readback slot을 요구하면 그 첫 spawn의 lifecycle
            // commit보다 앞에서 영구 대기하므로, Formation과 같은 host no-op으로
            // 이 boundary를 인증하고 실제 후보가 생길 때만 GPU prepare를 엽니다.
            const result = Object.freeze({
                accepted: true,
                targetFixedTick: tick,
                candidateCount: 0,
                requestedCount: 0,
                replayed: false,
                recoveryRequired: false
            });
            this.lastPrepareStageTick = tick;
            this.lastPrepareStageResult = result;
            return result;
        }
        // Prepare는 pending/due backlog 전부를 authenticate합니다. max4는 다음
        // boundary의 actual lifecycle starts에만 적용되어 5번째가 한 tick 더
        // 지연되거나 ENTER_ONLY admission을 잃지 않습니다.
        const records = dueCandidates.slice(0, this.capacity);
        const receipt = this.commandPort.requestPrepareBatch({
            targetFixedTick: tick,
            records: Object.freeze(records)
        });
        if (receipt?.accepted !== true && receipt?.requiresRecovery === true) {
            return this.#fail(
                'prepare-request',
                receipt.reason ?? 'prepare-request-rejected'
            );
        }
        if (receipt?.accepted === true) {
            this.lastPrepareStageTick = tick;
            this.lastPrepareStageResult = receipt;
        }
        return receipt;
    }

    observeFixedCommit(commit, fixedTick) {
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commit || commit.fixedTick !== tick) {
            return this.#fail('fixed-commit-contract');
        }
        if (tick < this.lastFixedCommitTick) {
            return this.#fail('fixed-commit-tick-regression');
        }
        this.lastFixedCommitTick = tick;
        if (this.terminal?.finalFixedTick === tick) {
            const rosterSealed = this.pendingTransformsByParent.size === 0
                && this.pendingFirstHitsByHandleKey.size === 0
                && this.circlePrimeDueByHandleKey.size === 0;
            this.terminal = Object.freeze({
                ...this.terminal,
                fixedCommitObserved: true,
                rosterSealed: this.terminal.lifecycleObserved === true
                    && rosterSealed
            });
        }
        return this.getStatus();
    }

    observeLifecycle(commit, fixedTick = commit?.fixedTick) {
        if (this.destroyed) {
            return this.getStatus();
        }
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (!commit || commit.fixedTick !== tick
            || !Array.isArray(commit.atomicTransforms)
            || !Array.isArray(commit.spawned)
            || !Array.isArray(commit.despawned)
            || !Array.isArray(commit.rejected)
            || commit.recoveryRequired === true) {
            return this.#fail('lifecycle-result-contract');
        }
        if (this.observedLifecycleCommits.has(commit)) {
            return this.getStatus();
        }
        if (tick < this.lastObservedFixedTick) {
            return this.#fail('lifecycle-tick-regression');
        }
        const pendingParentsToDelete = new Set();
        const firstHitKeysToDelete = new Set();
        const circlePrimeKeysToDelete = new Set();
        const circlePrimeAdditions = new Map();
        let retryableCapacityIncrement = 0;
        try {
            const knownParentCommandIds = new Set(
                this.pendingTransformsByParent.keys()
            );
            const atomicRejections = commit.rejected.filter((entry) => (
                typeof entry?.commandId === 'string'
                && knownParentCommandIds.has(entry.commandId)
            ));
            const rejectedByCommandId = new Map(
                atomicRejections.map((entry) => [entry.commandId, entry])
            );
            if (rejectedByCommandId.size !== atomicRejections.length) {
                throw new RangeError(
                    'atomic transform rejection parent가 중복되었습니다.'
                );
            }
            for (const [parentCommandId, pending] of this.pendingTransformsByParent) {
                const rejection = rejectedByCommandId.get(parentCommandId);
                if (rejection) {
                    if (commit.atomicTransforms.some((entry) => (
                        entry?.commandId === parentCommandId
                    ))) {
                        throw new RangeError(
                            'atomic transform parent가 commit/rejection에 동시에 있습니다.'
                        );
                    }
                    if (rejection.retryable === true) {
                        if (rejection.retryDisposition
                                !== 'restage-next-prepare'
                            || rejection.sourcePendingPreserved !== true
                            || rejection.attemptConsumed !== true) {
                            throw new RangeError(
                                'atomic transform retry disposition proof가 다릅니다.'
                            );
                        }
                        retryableCapacityIncrement++;
                    } else {
                        for (const record of pending.records) {
                            const sourceKey = handleKey(record.sourceHandle);
                            if (!this.registry.has(record.sourceHandle)) {
                                if (record.topologyId
                                    === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY) {
                                    firstHitKeysToDelete.add(sourceKey);
                                } else {
                                    circlePrimeKeysToDelete.add(sourceKey);
                                }
                            }
                        }
                    }
                    pendingParentsToDelete.add(parentCommandId);
                    continue;
                }
                if (pending.targetFixedTick < tick) {
                    throw new RangeError(
                        'atomic transform lifecycle commit deadline을 놓쳤습니다.'
                    );
                }
                if (pending.targetFixedTick !== tick) {
                    continue;
                }
                const transforms = commit.atomicTransforms.filter((entry) => (
                    entry.commandId === parentCommandId
                ));
                if (transforms.length !== pending.records.length) {
                    throw new RangeError(
                        'atomic transform commit cardinality가 다릅니다.'
                    );
                }
                const bySourceKey = new Map(transforms.map((entry) => [
                    handleKey(entry.sourceHandles?.[0] ?? {}),
                    entry
                ]));
                for (const record of pending.records) {
                    const transform = bySourceKey.get(
                        handleKey(record.sourceHandle)
                    );
                    if (!transform
                        || transform.topologyId !== record.topologyId
                        || transform.effectTransferDestinationIndex !== 0
                        || transform.disposition !== TRANSFORM_DISPOSITION
                        || !Array.isArray(transform.sourceHandles)
                        || transform.sourceHandles.length !== 1
                        || !sameHandle(
                            transform.sourceHandles[0],
                            record.sourceHandle
                        )
                        || !Array.isArray(transform.destinationHandles)
                        || transform.destinationHandles.length
                            !== record.destinationCount) {
                        throw new RangeError(
                            'atomic transform authentic commit proof가 다릅니다.'
                        );
                    }
                    if (record.topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED
                        && !this.circlePrimeDueByHandleKey.has(
                            handleKey(record.sourceHandle)
                        )) {
                        throw new RangeError(
                            'C prime return source가 due roster에 없습니다.'
                        );
                    }
                    for (const destinationHandle of transform.destinationHandles) {
                        const view = this.registry.copyEntityView(
                            destinationHandle,
                            {}
                        );
                        const expectedDefinition = record.topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                            ? BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID
                            : BASIC_JORANG_ENEMY_DEFINITION_ID;
                        const expectedProfileId = record.topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                            ? CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
                            : JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID;
                        if (!view
                            || view.definitionId !== expectedDefinition
                            || view.metadata?.atomicTransformProfileId
                                !== expectedProfileId) {
                            throw new RangeError(
                                'atomic transform destination registry view가 다릅니다.'
                            );
                        }
                        const branchState = normalizeBranchMetadata(
                            view.metadata,
                            'atomicTransformDestination.metadata'
                        );
                        if (record.topologyId
                            === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY) {
                            if (branchState.transformAtTick <= tick) {
                                throw new RangeError(
                                    'C prime destination due tick이 미래가 아닙니다.'
                                );
                            }
                            const exactHandle = normalizeHandle(
                                destinationHandle,
                                'circlePrimeDestination.handle'
                            );
                            const key = handleKey(exactHandle);
                            if (circlePrimeAdditions.has(key)
                                || (this.circlePrimeDueByHandleKey.has(key)
                                    && !circlePrimeKeysToDelete.has(key))) {
                                throw new RangeError(
                                    'C prime due roster destination identity가 충돌합니다.'
                                );
                            }
                            circlePrimeAdditions.set(key, Object.freeze({
                                sourceHandle: exactHandle,
                                topologyId:
                                    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID
                                        .ONE_TO_ONE_DELAYED,
                                dueFixedTick: branchState.transformAtTick,
                                lineageRootEntityId:
                                    branchState.lineageRootEntityId,
                                lineageRootIncarnation:
                                    branchState.lineageRootIncarnation,
                                branchIndex: branchState.branchIndex,
                                bountyBudget: branchState.bountyBudget
                            }));
                        }
                    }
                    const sourceKey = handleKey(record.sourceHandle);
                    if (record.topologyId
                        === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY) {
                        firstHitKeysToDelete.add(sourceKey);
                    } else {
                        circlePrimeKeysToDelete.add(sourceKey);
                    }
                }
                pendingParentsToDelete.add(parentCommandId);
            }
            for (const transform of commit.atomicTransforms) {
                if ((transform?.topologyId
                        === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                    || transform?.topologyId
                        === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED)
                    && !knownParentCommandIds.has(transform.commandId)) {
                    throw new RangeError(
                        'unknown J lineage atomic transform parent입니다.'
                    );
                }
            }
            for (const despawned of commit.despawned) {
                if (despawned?.handle) {
                    const key = handleKey(normalizeHandle(
                        despawned.handle,
                        'despawned.handle'
                    ));
                    firstHitKeysToDelete.add(key);
                    circlePrimeKeysToDelete.add(key);
                }
            }
            for (const spawned of commit.spawned) {
                if (spawned?.transform === true || !spawned?.handle) {
                    continue;
                }
                const view = this.registry.copyEntityView(spawned.handle, {});
                if (view?.definitionId
                    === BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID) {
                    throw new RangeError(
                        'transform-private C prime raw spawn이 노출되었습니다.'
                    );
                }
            }
            const survivingCirclePrimeCount
                = this.circlePrimeDueByHandleKey.size
                    - [...circlePrimeKeysToDelete].filter((key) => (
                        this.circlePrimeDueByHandleKey.has(key)
                    )).length
                    + circlePrimeAdditions.size;
            if (survivingCirclePrimeCount > this.capacity) {
                throw new RangeError('C prime due roster capacity를 초과했습니다.');
            }
        } catch (error) {
            return this.#fail('lifecycle-preflight', error?.message);
        }
        for (const parentCommandId of pendingParentsToDelete) {
            this.pendingTransformsByParent.delete(parentCommandId);
        }
        for (const key of firstHitKeysToDelete) {
            this.pendingFirstHitsByHandleKey.delete(key);
        }
        for (const key of circlePrimeKeysToDelete) {
            this.circlePrimeDueByHandleKey.delete(key);
        }
        for (const [key, record] of circlePrimeAdditions) {
            this.circlePrimeDueByHandleKey.set(key, record);
        }
        this.retryableCapacityCount += retryableCapacityIncrement;
        this.observedLifecycleCommits.add(commit);
        this.lastObservedFixedTick = tick;
        if (this.terminal?.finalFixedTick === tick) {
            const rosterZero = this.pendingTransformsByParent.size === 0
                && this.pendingFirstHitsByHandleKey.size === 0
                && this.circlePrimeDueByHandleKey.size === 0;
            this.terminal = Object.freeze({
                ...this.terminal,
                lifecycleObserved: true,
                rosterSealed: this.terminal.fixedCommitObserved === true
                    && rosterZero
            });
            if (!rosterZero) {
                return this.#fail('terminal-jorang-pending-transform');
            }
        }
        return this.getStatus();
    }

    closeForTerminal(finalFixedTick, reason = 'run-defeated') {
        if (this.destroyed) {
            return null;
        }
        const tick = requirePositiveSafeInteger(
            finalFixedTick,
            'finalFixedTick'
        );
        this.ingressOpen = false;
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.pendingFirstHitsByHandleKey.clear();
        this.circlePrimeDueByHandleKey.clear();
        const fixedCommitObserved = this.lastFixedCommitTick === tick;
        const lifecycleObserved = this.lastObservedFixedTick === tick;
        this.terminal = Object.freeze({
            finalFixedTick: tick,
            reason: typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated',
            fixedCommitObserved,
            lifecycleObserved,
            rosterSealed: fixedCommitObserved && lifecycleObserved
        });
        return this.terminal;
    }

    resetGpuBinding(registry, atomicTransformCommandPort, sessionGeneration) {
        if (this.destroyed) {
            return false;
        }
        this.registry = assertRegistry(registry);
        this.commandPort = assertCommandPort(atomicTransformCommandPort);
        this.sessionGeneration = requirePositiveSafeInteger(
            sessionGeneration,
            'sessionGeneration'
        );
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.pendingFirstHitsByHandleKey.clear();
        this.circlePrimeDueByHandleKey.clear();
        this.observedLifecycleCommits = new WeakSet();
        this.observedFirstHitCapacitySnapshots = new WeakSet();
        this.lastFixedCommitTick = 0;
        this.lastObservedFixedTick = 0;
        this.lastPreparedSourceTick = 0;
        this.lastPrepareStageTick = 0;
        this.lastPrepareStageResult = null;
        this.lastTriggerEventCount = 0;
        this.retryableFirstHitEventCapacityCount = 0;
        this.retryableCapacityCount = 0;
        this.recoveryRequired = false;
        this.failure = null;
        this.ingressOpen = true;
        this.terminal = null;
        return true;
    }

    requiresRecovery() {
        return !this.destroyed && this.recoveryRequired;
    }

    getStatus() {
        return Object.freeze({
            pendingTransformBatchCount: this.pendingTransformsByParent.size,
            pendingFirstHitCount: this.pendingFirstHitsByHandleKey.size,
            circlePrimeDueCount: this.circlePrimeDueByHandleKey.size,
            lastFixedCommitTick: this.lastFixedCommitTick,
            lastObservedFixedTick: this.lastObservedFixedTick,
            lastPreparedSourceTick: this.lastPreparedSourceTick,
            lastPrepareStageTick: this.lastPrepareStageTick,
            lastTriggerEventCount: this.lastTriggerEventCount,
            retryableFirstHitEventCapacityCount:
                this.retryableFirstHitEventCapacityCount,
            retryableCapacityCount: this.retryableCapacityCount,
            maximumTransformStartsPerFixedTick:
                JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK,
            recoveryRequired: this.recoveryRequired,
            failure: this.failure,
            terminal: this.terminal,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.pendingTransformsByParent.clear();
        this.completedPrepareFingerprintByTick.clear();
        this.pendingFirstHitsByHandleKey.clear();
        this.circlePrimeDueByHandleKey.clear();
        this.registry = null;
        this.commandPort = null;
        this.terminal = null;
    }

    #rememberCompletedPrepare(sourceTick, batchIdFingerprint) {
        this.completedPrepareFingerprintByTick.set(
            sourceTick,
            batchIdFingerprint
        );
        while (this.completedPrepareFingerprintByTick.size > this.capacity) {
            const oldest = this.completedPrepareFingerprintByTick
                .keys().next().value;
            this.completedPrepareFingerprintByTick.delete(oldest);
        }
        this.lastPreparedSourceTick = sourceTick;
    }

    #fail(code, message = null) {
        this.recoveryRequired = true;
        this.failure = Object.freeze({
            code,
            ...(typeof message === 'string' && message.length > 0
                ? { message }
                : null)
        });
        return Object.freeze({
            accepted: false,
            reason: code,
            recoveryRequired: true
        });
    }
}

/** Adapter와 cycle을 만들지 않는 J/C′ lineage roster prototype seam입니다. */
export const GPU_ENEMY_JORANG_ATOMIC_TRANSFORM_ROSTER_PORT = Object.freeze({
    observeLifecycle: JorangSplitLineageDirector.prototype.observeLifecycle,
    observeCompletedEvents:
        JorangSplitLineageDirector.prototype.observeCompletedEvents,
    observeCompletedPreparations:
        JorangSplitLineageDirector.prototype.observeCompletedPreparations,
    stageForFixedTick: JorangSplitLineageDirector.prototype.stageForFixedTick,
    observeFixedCommit:
        JorangSplitLineageDirector.prototype.observeFixedCommit,
    getStatus: JorangSplitLineageDirector.prototype.getStatus,
    requiresRecovery: JorangSplitLineageDirector.prototype.requiresRecovery,
    resetGpuBinding: JorangSplitLineageDirector.prototype.resetGpuBinding,
    closeForTerminal: JorangSplitLineageDirector.prototype.closeForTerminal,
    destroy: JorangSplitLineageDirector.prototype.destroy
});
