import {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
    R3_ENEMY_ACTOR_PAYLOAD_DEFINITION,
    R5_TOWER_ACTOR_PAYLOAD_DEFINITION
} from '../contract/actor_payload_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE
} from '../contract/word_sentence_contract.js';
import {
    TOWER_CREATION_COORDINATOR_MODE,
    TOWER_CREATION_RESULT
} from '../object/tower/tower_group_contract.js';
import {
    ABILITY_EXECUTION_OUTCOME_CODE
} from './word_system.js';

const MAX_MATERIALIZATION_HISTORY = 128;
const TOWER_CREATION_TERMINAL_RECEIPT_KIND = 'tower-creation-terminal';
const TOWER_CREATION_TERMINAL_RESULTS = new Set(
    Object.values(TOWER_CREATION_RESULT)
);
const MATERIALIZATION_KIND = Object.freeze({
    ENEMY: 'ENEMY',
    TOWER: 'TOWER'
});
const VERB_TELEMETRY_NAMES = Object.freeze(new Map([
    [SENTENCE_ACTION_CODE.SHOOT, 'Shoot'],
    [SENTENCE_ACTION_CODE.THROW, 'Throw'],
    [SENTENCE_ACTION_CODE.EMIT, 'Emit'],
    [SENTENCE_ACTION_CODE.SUMMON, 'Summon']
]));

function createVerbTelemetry() {
    return new Map([...VERB_TELEMETRY_NAMES.keys()].map((actionCode) => [
        actionCode,
        { staged: 0, committed: 0, rejected: 0, cancelled: 0 }
    ]));
}

function freezeVerbTelemetry(source) {
    return Object.freeze(Object.fromEntries(
        [...VERB_TELEMETRY_NAMES].map(([actionCode, name]) => [
            name,
            Object.freeze({ ...source.get(actionCode) })
        ])
    ));
}

function assertEndpoint(endpoint) {
    const methods = [
        'requestActorPayloadMaterialization',
        'drainCompletedActorPayloadMaterializations',
        'cancelPendingActorPayloadMaterializations',
        'getActorPayloadMaterializationStatus'
    ];
    if (!endpoint
        || methods.some((method) => typeof endpoint[method] !== 'function')) {
        throw new TypeError('IActorPayloadMaterializer endpoint port가 올바르지 않습니다.');
    }
    return endpoint;
}

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function freezeHistory(source) {
    return Object.freeze({
        transactionId: source.transactionId,
        executionId: source.executionId,
        executionOrdinal: source.executionOrdinal,
        state: source.state,
        subjectCount: source.subjectCount,
        generatedCount: source.generatedCount,
        targetFixedTick: source.targetFixedTick,
        completedFixedTick: source.completedFixedTick,
        payloadCode: source.payloadCode ?? null,
        reason: source.reason ?? null,
        placement: source.placement ?? null
    });
}

function freezePlacementTelemetry(completion) {
    if (!Number.isSafeInteger(completion?.attemptedCandidateCount)) {
        return null;
    }
    return Object.freeze({
        firstFallbackRank: completion.firstFallbackRank ?? null,
        firstFailingRank: completion.firstFailingRank ?? null,
        attemptedCandidateCount: completion.attemptedCandidateCount,
        failureClass: completion.placementFailureClass ?? 0
    });
}

function isExplicitTowerCreationTerminalReceipt(source) {
    return source?.terminal === true
        && source.receiptKind === TOWER_CREATION_TERMINAL_RECEIPT_KIND
        && source.pending === false
        && source.staged === false
        && source.phase === null
        && source.result != null
        && TOWER_CREATION_TERMINAL_RESULTS.has(source.result);
}

function findTowerReceiptMismatchField(completion, record) {
    if (completion.transactionId !== record.transactionId) {
        return 'transactionId';
    }
    if (record.requestFingerprint !== null
        && completion.requestFingerprint !== record.requestFingerprint) {
        return 'requestFingerprint';
    }
    if (completion.actorActionProfileFingerprint
        !== record.ready.command.actorActionProfileFingerprint) {
        return 'actorActionProfileFingerprint';
    }
    return 'unknown';
}

function findCommittedShapeMismatchField(completion, expectedCount) {
    if (completion.committed !== true) return 'committed';
    if (completion.createdCount !== expectedCount) return 'createdCount';
    if (!Array.isArray(completion.handles)) return 'handles';
    if (completion.handles.length !== completion.createdCount) {
        return 'handles.length';
    }
    return 'unknown';
}

/**
 * IActorPayloadMaterializer의 CPU run-domain 구현입니다. Subject record를
 * 열지 않고 aggregate count와 opaque GPU snapshot token만 endpoint에 전달합니다.
 */
export class ActorPayloadMaterializer {
    constructor(options = {}) {
        if (!options.abilityRuntime
            || typeof options.abilityRuntime.drainReadySnapshots !== 'function'
            || typeof options.abilityRuntime.returnReadySnapshot !== 'function'
            || typeof options.abilityRuntime.completeSnapshotExecution
                !== 'function'
            || typeof options.abilityRuntime.rejectSnapshotExecution
                !== 'function'
            || typeof options.abilityRuntime.markGpuMaterializationPending
                !== 'function') {
            throw new TypeError('ActorPayloadMaterializer에 AbilityRuntime이 필요합니다.');
        }
        this.abilityRuntime = options.abilityRuntime;
        this.endpoint = assertEndpoint(options.endpoint);
        this.payloadDefinition = options.payloadDefinition
            ?? R3_ENEMY_ACTOR_PAYLOAD_DEFINITION;
        this.towerPayloadDefinition = options.towerPayloadDefinition
            ?? R5_TOWER_ACTOR_PAYLOAD_DEFINITION;
        if (options.towerCreationCoordinatorProvider !== undefined
            && typeof options.towerCreationCoordinatorProvider !== 'function') {
            throw new TypeError('Tower creation coordinator provider는 함수여야 합니다.');
        }
        if (options.towerPayloadContextProvider !== undefined
            && typeof options.towerPayloadContextProvider !== 'function') {
            throw new TypeError('Tower payload context provider는 함수여야 합니다.');
        }
        this.towerCreationCoordinatorProvider
            = options.towerCreationCoordinatorProvider ?? null;
        this.towerPayloadContextProvider
            = options.towerPayloadContextProvider ?? null;
        this.inFlight = new Map();
        this.history = [];
        this.recoveryRequired = false;
        this.failure = null;
        this.closed = false;
        this.destroyed = false;
        this.totalStaged = 0;
        this.totalCommitted = 0;
        this.totalGenerated = 0;
        this.totalCapacityRejected = 0;
        this.totalPlacementRejected = 0;
        this.totalRuntimeUnavailable = 0;
        this.totalTowerStaged = 0;
        this.totalTowerCommitted = 0;
        this.totalTowerRejected = 0;
        this.totalCancelled = 0;
        this.verbTelemetry = createVerbTelemetry();
        this.rejectionReasonCounts = {
            runtimeUnavailable: 0,
            destinationCapacity: 0,
            placement: 0,
            cancelled: 0,
            protocol: 0
        };
        this.inFlightHighWater = 0;
        this.subjectHighWater = 0;
        this.generatedHighWater = 0;
        this.lastSubjectCount = 0;
        this.lastGeneratedCount = 0;
    }

    observeCompleted(currentFixedTick) {
        const tick = requirePositiveInteger(
            currentFixedTick,
            'currentFixedTick'
        );
        if (this.destroyed) {
            return Object.freeze({
                observedCount: 0,
                committedCount: 0,
                committedHandles: Object.freeze([])
            });
        }
        const transitCompletions = [];
        this.endpoint.drainCompletedActorTransits?.(transitCompletions);
        const completions = [];
        this.endpoint.drainCompletedActorPayloadMaterializations(completions);
        let observedCount = transitCompletions.length;
        let committedCount = 0;
        const committedHandles = [];
        for (const completion of transitCompletions) {
            if (completion.state === 'LANDED'
                && completion.landed === true
                && completion.requiresRecovery !== true) {
                for (const handle of completion.handles ?? []) {
                    committedHandles.push(Object.freeze({
                        entityId: handle.entityId,
                        incarnation: handle.incarnation
                    }));
                }
                continue;
            }
            if (completion.requiresRecovery === true) {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'actor-transit-completion-rejected',
                    message: 'Actor transit landing completion이 거절됐습니다.'
                });
            }
        }
        for (const completion of completions) {
            const record = this.inFlight.get(completion?.transactionId);
            if (!record || record.kind !== MATERIALIZATION_KIND.ENEMY) continue;
            this.inFlight.delete(completion.transactionId);
            observedCount++;
            const exact = completion.executionOrdinal
                    === record.ready.command.executionOrdinal
                && completion.commandFingerprint
                    === record.ready.command.fingerprint
                && completion.snapshotFingerprint
                    === record.ready.completion.snapshotFingerprint
                && completion.subjectCount
                    === record.ready.completion.subjectCount;
            if (!exact) {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'actor-payload-completion-mismatch',
                    message: 'actor payload completion이 execution과 다릅니다.'
                });
                this.#settleRejected(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                    tick,
                    completion
                );
                continue;
            }
            if (completion.committed === true
                && ['COMMITTED', 'COMMITTED_AIRBORNE'].includes(
                    completion.state
                )
                && completion.status
                    === ACTOR_PAYLOAD_MATERIALIZATION_STATUS.COMPLETE
                && completion.generatedCount === completion.subjectCount) {
                const settled = this.abilityRuntime
                    .completeSnapshotExecution(record.ready, {
                        completedFixedTick:
                            completion.materializationTargetTick ?? tick,
                        generatedCount: completion.generatedCount
                    });
                if (!settled) {
                    this.recoveryRequired = true;
                    this.failure = Object.freeze({
                        code: 'actor-payload-snapshot-settlement',
                        message: 'committed payload snapshot을 정리하지 못했습니다.'
                    });
                    continue;
                }
                committedCount++;
                if (completion.state !== 'COMMITTED_AIRBORNE') {
                    for (const handle of completion.handles ?? []) {
                        committedHandles.push(Object.freeze({
                            entityId: handle.entityId,
                            incarnation: handle.incarnation
                        }));
                    }
                }
                this.totalCommitted++;
                this.totalGenerated += completion.generatedCount;
                this.generatedHighWater = Math.max(
                    this.generatedHighWater,
                    completion.generatedCount
                );
                this.lastGeneratedCount = completion.generatedCount;
                this.#countVerb(record, 'committed');
                this.#remember(record, 'COMMITTED', completion, tick);
                continue;
            }
            if (completion.state === 'REJECTED_PLACEMENT') {
                this.totalPlacementRejected++;
                this.#settleRejected(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED,
                    tick,
                    completion
                );
            } else if (completion.state === 'CANCELLED') {
                this.totalCancelled++;
                this.#settleRejected(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                    tick,
                    completion
                );
            } else {
                this.recoveryRequired ||= completion.requiresRecovery === true;
                this.failure = Object.freeze({
                    code: 'actor-payload-protocol-rejected',
                    message: 'GPU actor payload protocol이 거절됐습니다.'
                });
                this.#settleRejected(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                    tick,
                    completion
                );
            }
        }
        return Object.freeze({
            observedCount,
            committedCount,
            committedHandles: Object.freeze(committedHandles),
            inFlightCount: this.inFlight.size,
            recoveryRequired: this.requiresRecovery()
        });
    }

    /** TowerCreationCoordinator가 인증한 terminal receipt를 cooldown owner에 연결합니다. */
    observeTowerCreationCompletion(completion, currentFixedTick) {
        const tick = requirePositiveInteger(
            currentFixedTick,
            'currentFixedTick'
        );
        const empty = Object.freeze({
            observedCount: 0,
            committedCount: 0,
            committedHandles: Object.freeze([]),
            recoveryRequired: this.requiresRecovery()
        });
        if (this.destroyed
            || !isExplicitTowerCreationTerminalReceipt(completion)) {
            return empty;
        }
        const record = this.inFlight.get(completion.transactionId);
        if (!record || record.kind !== MATERIALIZATION_KIND.TOWER) {
            return empty;
        }
        this.inFlight.delete(completion.transactionId);
        const ready = record.ready;
        const expectedProfileFingerprint
            = ready.command.actorActionProfileFingerprint;
        const exact = completion.transactionId === record.transactionId
            && (record.requestFingerprint === null
                || completion.requestFingerprint === record.requestFingerprint)
            && completion.actorActionProfileFingerprint
                === expectedProfileFingerprint;
        if (!exact) {
            this.recoveryRequired = true;
            this.failure = Object.freeze({
                code: 'tower-payload-completion-mismatch',
                message: 'Tower payload completion이 execution과 다릅니다.',
                stage: 'tower-payload-terminal-authentication',
                mismatchField: findTowerReceiptMismatchField(
                    completion,
                    record
                )
            });
            this.#settleTowerRejected(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                tick,
                completion
            );
            return Object.freeze({
                observedCount: 1,
                committedCount: 0,
                committedHandles: Object.freeze([]),
                recoveryRequired: true
            });
        }

        const committed = completion.result === TOWER_CREATION_RESULT.COMMITTED
            && completion.committed === true
            && completion.createdCount === ready.completion.subjectCount
            && Array.isArray(completion.handles)
            && completion.handles.length === completion.createdCount;
        if (committed) {
            const settled = this.abilityRuntime.completeSnapshotExecution(
                ready,
                {
                    completedFixedTick: completion.sourceTick ?? tick,
                    generatedCount: completion.createdCount,
                    snapshotAlreadyReleased: true
                }
            );
            if (!settled) {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'tower-payload-snapshot-settlement',
                    message: 'committed Tower payload execution을 정리하지 못했습니다.'
                });
                return Object.freeze({
                    observedCount: 1,
                    committedCount: 0,
                    committedHandles: Object.freeze([]),
                    recoveryRequired: true
                });
            }
            const handles = Object.freeze(completion.handles.map((handle) => (
                Object.freeze({
                    entityId: handle.entityId,
                    incarnation: handle.incarnation
                })
            )));
            this.totalCommitted++;
            this.totalTowerCommitted++;
            this.totalGenerated += completion.createdCount;
            this.generatedHighWater = Math.max(
                this.generatedHighWater,
                completion.createdCount
            );
            this.lastGeneratedCount = completion.createdCount;
            this.#countVerb(record, 'committed');
            this.#remember(record, 'COMMITTED', completion, tick);
            return Object.freeze({
                observedCount: 1,
                committedCount: 1,
                committedHandles: handles,
                recoveryRequired: this.requiresRecovery()
            });
        }

        if (completion.result === TOWER_CREATION_RESULT.COMMITTED) {
            this.recoveryRequired = true;
            this.failure = Object.freeze({
                code: 'tower-payload-committed-shape',
                message: 'Tower payload COMMITTED receipt의 count/handle shape가 다릅니다.',
                stage: 'tower-payload-terminal-shape',
                mismatchField: findCommittedShapeMismatchField(
                    completion,
                    ready.completion.subjectCount
                )
            });
            this.#settleTowerRejected(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                tick,
                completion
            );
            return Object.freeze({
                observedCount: 1,
                committedCount: 0,
                committedHandles: Object.freeze([]),
                recoveryRequired: true
            });
        }

        let code = ABILITY_EXECUTION_OUTCOME_CODE
            .DESTINATION_CAPACITY_REJECTED;
        if (completion.result === TOWER_CREATION_RESULT.PROTOCOL_FAILURE
            || completion.recoveryRequired === true) {
            code = ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED;
            this.recoveryRequired = true;
            this.failure = Object.freeze({
                code: 'tower-payload-protocol-rejected',
                message: 'Tower payload transaction protocol이 거절됐습니다.',
                stage: String(
                    completion.failure?.stage
                        ?? completion.reason
                        ?? 'tower-payload-terminal-protocol'
                ).slice(0, 96),
                mismatchField: String(
                    completion.failure?.mismatchField ?? 'protocol'
                ).slice(0, 96)
            });
        } else if (completion.reason === 'RUNTIME_UNAVAILABLE') {
            code = ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE;
            this.totalRuntimeUnavailable++;
        } else if (completion.reason === 'ACTOR_ACTION_PLACEMENT_REJECTED') {
            code = ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED;
            this.totalPlacementRejected++;
        } else if (String(completion.reason ?? '').includes('cancel')) {
            code = ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED;
            this.totalCancelled++;
        } else {
            this.totalCapacityRejected++;
        }
        this.#settleTowerRejected(record, code, tick, completion);
        return Object.freeze({
            observedCount: 1,
            committedCount: 0,
            committedHandles: Object.freeze([]),
            recoveryRequired: this.requiresRecovery()
        });
    }

    stageReadyForFixedTick({ targetFixedTick } = {}) {
        const tick = requirePositiveInteger(targetFixedTick, 'targetFixedTick');
        if (this.destroyed || this.closed) {
            return Object.freeze({ stagedCount: 0, rejectedCount: 0 });
        }
        const ready = [];
        this.abilityRuntime.drainReadySnapshots(ready);
        let stagedCount = 0;
        let rejectedCount = 0;
        for (let index = 0; index < ready.length; index++) {
            const record = ready[index];
            const subjectCount = Number(record.completion?.subjectCount) || 0;
            this.lastSubjectCount = subjectCount;
            this.subjectHighWater = Math.max(
                this.subjectHighWater,
                subjectCount
            );
            // R5 actor payload matrix는 네 동사를 같은 0/N settlement로
            // materialize하며 production slot 구성은 별도 data authority입니다.
            if (![
                SENTENCE_ACTION_CODE.SHOOT,
                SENTENCE_ACTION_CODE.THROW,
                SENTENCE_ACTION_CODE.EMIT,
                SENTENCE_ACTION_CODE.SUMMON
            ].includes(record.command.actionCode)) {
                this.totalRuntimeUnavailable++;
                this.#rejectReady(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE,
                    tick
                );
                rejectedCount++;
                continue;
            }

            if (record.command.payloadCode === ACTOR_PAYLOAD_CODE.TOWER) {
                const coordinator = this.towerCreationCoordinatorProvider?.()
                    ?? null;
                if (!coordinator
                    || typeof coordinator.requestTowerCreation !== 'function'
                    || typeof coordinator.getStatus !== 'function') {
                    this.totalRuntimeUnavailable++;
                    this.#rejectReady(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE,
                        tick
                    );
                    rejectedCount++;
                    continue;
                }
                const coordinatorState = coordinator.getStatus()?.state;
                if (coordinatorState === 'queued'
                    || coordinatorState === 'pending') {
                    for (let remaining = ready.length - 1;
                        remaining >= index;
                        remaining--) {
                        this.abilityRuntime.returnReadySnapshot(
                            ready[remaining]
                        );
                    }
                    break;
                }
                let context = null;
                try {
                    context = this.towerPayloadContextProvider?.({
                        command: record.command,
                        subjectCompletion: record.completion,
                        targetFixedTick: tick
                    }) ?? null;
                } catch {
                    context = null;
                }
                if (context?.runtimeAvailable !== true
                    || !context.sdf || !context.recoveryPlacementPolicy) {
                    this.totalRuntimeUnavailable++;
                    this.#rejectReady(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE,
                        tick
                    );
                    rejectedCount++;
                    continue;
                }
                const transactionId = [
                    'actor-payload.r5.tower',
                    record.command.executionId
                ].join(':');
                const result = coordinator.requestTowerCreation({
                    mode: TOWER_CREATION_COORDINATOR_MODE
                        .GPU_SUBJECT_ACTOR_ACTION,
                    transactionId,
                    command: record.command,
                    subjectCompletion: record.completion,
                    snapshotToken: record.completion.snapshotToken,
                    childCount: record.completion.subjectCount,
                    actorActionProfile:
                        record.command.compiledAbility.actorActionProfile,
                    actorActionProfileId:
                        record.command.compiledAbility.actorActionProfileId,
                    payloadDefinition: this.towerPayloadDefinition,
                    requestedFixedTick: tick,
                    sdf: context.sdf,
                    coreTarget: context.coreTarget ?? null,
                    recoveryPlacementPolicy:
                        context.recoveryPlacementPolicy
                });
                if (result?.accepted === true) {
                    const inFlight = Object.freeze({
                        kind: MATERIALIZATION_KIND.TOWER,
                        transactionId,
                        requestFingerprint: result.requestFingerprint ?? null,
                        ready: record,
                        targetFixedTick: tick,
                        coordinator
                    });
                    this.inFlight.set(transactionId, inFlight);
                    if (!this.abilityRuntime.markGpuMaterializationPending(
                        record,
                        tick
                    )) {
                        this.recoveryRequired = true;
                        this.failure = Object.freeze({
                            code: 'tower-payload-execution-state',
                            message: 'Tower materialization pending 상태를 기록하지 못했습니다.'
                        });
                    }
                    this.totalStaged++;
                    this.totalTowerStaged++;
                    this.#countVerb(record, 'staged');
                    this.inFlightHighWater = Math.max(
                        this.inFlightHighWater,
                        this.inFlight.size
                    );
                    stagedCount++;
                    continue;
                }
                if (result?.reason === 'RUNTIME_UNAVAILABLE') {
                    this.totalRuntimeUnavailable++;
                    this.#rejectReady(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE,
                        tick
                    );
                } else if (result?.result
                        === TOWER_CREATION_RESULT.REJECTED_CAPACITY
                    && result?.requiresRecovery !== true) {
                    this.totalCapacityRejected++;
                    this.#rejectReady(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE
                            .DESTINATION_CAPACITY_REJECTED,
                        tick
                    );
                } else {
                    this.recoveryRequired = true;
                    this.failure = Object.freeze({
                        code: result?.reason
                            ?? 'tower-payload-stage-rejected',
                        message: result?.failure?.message
                            ?? 'Tower payload stage가 거절됐습니다.'
                    });
                    this.#rejectReady(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                        tick
                    );
                }
                rejectedCount++;
                continue;
            }

            if (record.command.payloadCode !== ACTOR_PAYLOAD_CODE.ENEMY) {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'actor-payload-code-unsupported',
                    message: '알려지지 않은 actor payload code입니다.'
                });
                this.#rejectReady(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                    tick
                );
                rejectedCount++;
                continue;
            }
            const transactionId = [
                'actor-payload.r3',
                record.command.executionId
            ].join(':');
            const result = this.endpoint.requestActorPayloadMaterialization({
                transactionId,
                command: record.command,
                subjectCompletion: record.completion,
                payloadDefinition: this.payloadDefinition,
                targetFixedTick: tick
            });
            if (result?.accepted === true) {
                const inFlight = Object.freeze({
                    kind: MATERIALIZATION_KIND.ENEMY,
                    transactionId,
                    ready: record,
                    targetFixedTick: tick
                });
                this.inFlight.set(transactionId, inFlight);
                if (!this.abilityRuntime.markGpuMaterializationPending(
                    record,
                    tick
                )) {
                    this.recoveryRequired = true;
                    this.failure = Object.freeze({
                        code: 'actor-payload-execution-state',
                        message: 'GPU materialization pending 상태를 기록하지 못했습니다.'
                    });
                }
                this.totalStaged++;
                this.#countVerb(record, 'staged');
                this.inFlightHighWater = Math.max(
                    this.inFlightHighWater,
                    this.inFlight.size
                );
                stagedCount++;
                continue;
            }
            if (result?.capacityRejected === true
                || result?.reason === 'actor-payload-capacity'
                || result?.reason === 'actor-payload-body-capacity') {
                this.totalCapacityRejected++;
                this.#rejectReady(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE
                        .DESTINATION_CAPACITY_REJECTED,
                    tick
                );
                rejectedCount++;
                continue;
            }
            if (result?.runtimeUnavailable === true
                || result?.reason === 'actor-payload-runtime-unavailable') {
                this.totalRuntimeUnavailable++;
                this.#rejectReady(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE,
                    tick
                );
                rejectedCount++;
                continue;
            }
            if (result?.retryable === true
                && result?.requiresRecovery !== true) {
                for (let remaining = ready.length - 1;
                    remaining > index;
                    remaining--) {
                    this.abilityRuntime.returnReadySnapshot(ready[remaining]);
                }
                this.abilityRuntime.returnReadySnapshot(record);
                break;
            }
            this.recoveryRequired ||= result?.requiresRecovery === true;
            this.failure = Object.freeze({
                code: result?.reason ?? 'actor-payload-stage-rejected',
                message: result?.message ?? 'actor payload stage가 거절됐습니다.'
            });
            this.#rejectReady(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                tick
            );
            rejectedCount++;
        }
        return Object.freeze({
            stagedCount,
            rejectedCount,
            inFlightCount: this.inFlight.size,
            recoveryRequired: this.requiresRecovery()
        });
    }

    resetGpuBinding(endpoint) {
        if (this.destroyed) return false;
        this.#cancelOwnedState('gpu-endpoint-replaced');
        this.endpoint = assertEndpoint(endpoint);
        this.closed = false;
        this.recoveryRequired = false;
        this.failure = null;
        return true;
    }

    closeForTerminal(reason = 'run-defeated') {
        if (this.destroyed || this.closed) return false;
        this.closed = true;
        this.#cancelOwnedState(reason);
        return true;
    }

    requiresRecovery() {
        return this.recoveryRequired
            || this.endpoint?.getActorPayloadMaterializationStatus()
                ?.requiresRecovery === true;
    }

    getStatus() {
        const gpu = this.endpoint?.getActorPayloadMaterializationStatus()
            ?? null;
        const towerCreation = this.towerCreationCoordinatorProvider?.()
            ?.getStatus?.() ?? null;
        const telemetry = Object.freeze({
            lastSubjectCount: this.lastSubjectCount,
            lastGeneratedCount: this.lastGeneratedCount,
            subjectHighWater: this.subjectHighWater,
            generatedHighWater: this.generatedHighWater,
            inFlightHighWater: this.inFlightHighWater,
            placementHighWater:
                gpu?.placement?.commandHighWater ?? 0,
            transitActiveCount: gpu?.transit?.activeActorCount ?? 0,
            transitActiveHighWater:
                gpu?.transit?.activeActorHighWater ?? 0,
            towerPayloadCommitted: this.totalTowerCommitted,
            towerPayloadRejected: this.totalTowerRejected,
            perVerbCounts: freezeVerbTelemetry(this.verbTelemetry),
            capacityReasons: Object.freeze({
                ...this.rejectionReasonCounts
            }),
            readbackBytes: Object.freeze({
                payloadAggregate: gpu?.aggregateReadbackByteSize ?? 0,
                placementAggregate:
                    gpu?.placement?.aggregateReadbackByteSize ?? 0,
                transitAggregate:
                    gpu?.transit?.aggregateReadbackByteSize ?? 0,
                towerCreationAggregate:
                    towerCreation?.aggregateReadbackByteSize ?? 0
            })
        });
        return Object.freeze({
            abiVersion: ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
            destroyed: this.destroyed,
            closed: this.closed,
            inFlightCount: this.inFlight.size,
            totalStaged: this.totalStaged,
            totalCommitted: this.totalCommitted,
            totalGenerated: this.totalGenerated,
            totalCapacityRejected: this.totalCapacityRejected,
            totalPlacementRejected: this.totalPlacementRejected,
            totalRuntimeUnavailable: this.totalRuntimeUnavailable,
            totalTowerStaged: this.totalTowerStaged,
            totalTowerCommitted: this.totalTowerCommitted,
            totalTowerRejected: this.totalTowerRejected,
            totalCancelled: this.totalCancelled,
            historyCapacity: MAX_MATERIALIZATION_HISTORY,
            telemetry,
            recoveryRequired: this.requiresRecovery(),
            failure: this.failure,
            history: Object.freeze([...this.history]),
            gpu,
            towerCreation
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.#cancelOwnedState('destroyed');
        this.destroyed = true;
        this.closed = true;
        this.inFlight.clear();
        this.history.length = 0;
        this.endpoint = null;
        this.abilityRuntime = null;
        this.towerCreationCoordinatorProvider = null;
        this.towerPayloadContextProvider = null;
    }

    #countVerb(record, field) {
        const actionCode = record?.ready?.command?.actionCode
            ?? record?.command?.actionCode;
        const counter = this.verbTelemetry.get(actionCode);
        if (!counter || !Object.hasOwn(counter, field)) return;
        counter[field]++;
    }

    #countTerminal(record, code) {
        this.lastGeneratedCount = 0;
        if (code === ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED) {
            this.#countVerb(record, 'cancelled');
            this.rejectionReasonCounts.cancelled++;
        } else {
            this.#countVerb(record, 'rejected');
            if (code === ABILITY_EXECUTION_OUTCOME_CODE.RUNTIME_UNAVAILABLE) {
                this.rejectionReasonCounts.runtimeUnavailable++;
            } else if (code
                    === ABILITY_EXECUTION_OUTCOME_CODE
                        .DESTINATION_CAPACITY_REJECTED) {
                this.rejectionReasonCounts.destinationCapacity++;
            } else if (code
                    === ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED) {
                this.rejectionReasonCounts.placement++;
            } else {
                this.rejectionReasonCounts.protocol++;
            }
        }
        const payloadCode = record?.ready?.command?.payloadCode
            ?? record?.command?.payloadCode;
        if (payloadCode === ACTOR_PAYLOAD_CODE.TOWER) {
            this.totalTowerRejected++;
        }
    }

    #settleRejected(record, code, fixedTick, completion) {
        this.#countTerminal(record, code);
        const settled = this.abilityRuntime.rejectSnapshotExecution(
            record.ready,
            code,
            {
                completedFixedTick:
                    completion.materializationTargetTick ?? fixedTick,
                generatedCount: 0
            }
        );
        if (!settled) {
            this.recoveryRequired = true;
        }
        this.#remember(record, completion.state ?? code, completion, fixedTick);
        return settled;
    }

    #settleTowerRejected(record, code, fixedTick, completion) {
        this.#countTerminal(record, code);
        const settled = this.abilityRuntime.rejectSnapshotExecution(
            record.ready,
            code,
            {
                completedFixedTick: completion.sourceTick ?? fixedTick,
                generatedCount: 0,
                snapshotAlreadyReleased: true
            }
        );
        if (!settled) this.recoveryRequired = true;
        this.#remember(
            record,
            completion.reason ?? completion.result ?? code,
            completion,
            fixedTick
        );
        return settled;
    }

    #rejectReady(record, code, fixedTick) {
        this.#countTerminal(record, code);
        return this.abilityRuntime.rejectSnapshotExecution(
            record,
            code,
            { completedFixedTick: fixedTick, generatedCount: 0 }
        );
    }

    #remember(record, state, completion, fixedTick) {
        const entry = freezeHistory({
            transactionId: record.transactionId,
            executionId: record.ready.command.executionId,
            executionOrdinal: record.ready.command.executionOrdinal,
            state,
            subjectCount: record.ready.completion.subjectCount,
            generatedCount: completion.generatedCount
                ?? completion.createdCount ?? 0,
            targetFixedTick: record.targetFixedTick,
            completedFixedTick:
                completion.materializationTargetTick
                    ?? completion.sourceTick ?? fixedTick,
            payloadCode: record.ready.command.payloadCode,
            reason: completion.reason ?? null,
            placement: freezePlacementTelemetry(completion)
        });
        this.history.push(entry);
        while (this.history.length > MAX_MATERIALIZATION_HISTORY) {
            this.history.shift();
        }
    }

    #cancelOwnedState(reason) {
        this.endpoint?.cancelPendingActorPayloadMaterializations(reason);
        const towerCoordinators = new Set();
        for (const record of this.inFlight.values()) {
            if (record.kind === MATERIALIZATION_KIND.TOWER
                && record.coordinator) {
                towerCoordinators.add(record.coordinator);
            }
        }
        for (const coordinator of towerCoordinators) {
            coordinator.cancelPending?.(reason);
        }
        for (const record of this.inFlight.values()) {
            this.abilityRuntime.rejectSnapshotExecution(
                record.ready,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                {
                    completedFixedTick: record.targetFixedTick,
                    generatedCount: 0,
                    snapshotAlreadyReleased:
                        record.kind === MATERIALIZATION_KIND.TOWER
                }
            );
            this.totalCancelled++;
            this.#countTerminal(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED
            );
        }
        this.inFlight.clear();
    }
}
