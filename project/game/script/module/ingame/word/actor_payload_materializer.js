import {
    ACTOR_PAYLOAD_MATERIALIZATION_STATUS,
    ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION,
    R3_ENEMY_ACTOR_PAYLOAD_DEFINITION
} from '../contract/actor_payload_contract.js';
import { ACTOR_PAYLOAD_CODE } from '../contract/word_sentence_contract.js';
import {
    ABILITY_EXECUTION_OUTCOME_CODE
} from './word_system.js';

const MAX_MATERIALIZATION_HISTORY = 128;

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
        completedFixedTick: source.completedFixedTick
    });
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
        this.totalCancelled = 0;
    }

    observeCompleted(currentFixedTick) {
        const tick = requirePositiveInteger(
            currentFixedTick,
            'currentFixedTick'
        );
        if (this.destroyed) {
            return Object.freeze({ observedCount: 0, committedCount: 0 });
        }
        const completions = [];
        this.endpoint.drainCompletedActorPayloadMaterializations(completions);
        let observedCount = 0;
        let committedCount = 0;
        for (const completion of completions) {
            const record = this.inFlight.get(completion?.transactionId);
            if (!record) continue;
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
                && completion.state === 'COMMITTED'
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
                this.totalCommitted++;
                this.totalGenerated += completion.generatedCount;
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
            inFlightCount: this.inFlight.size,
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
            if (record.command.payloadCode !== ACTOR_PAYLOAD_CODE.ENEMY) {
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
            totalCancelled: this.totalCancelled,
            recoveryRequired: this.requiresRecovery(),
            failure: this.failure,
            history: Object.freeze([...this.history]),
            gpu: this.endpoint?.getActorPayloadMaterializationStatus() ?? null
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
    }

    #settleRejected(record, code, fixedTick, completion) {
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

    #rejectReady(record, code, fixedTick) {
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
            generatedCount: completion.generatedCount ?? 0,
            targetFixedTick: record.targetFixedTick,
            completedFixedTick:
                completion.materializationTargetTick ?? fixedTick
        });
        this.history.push(entry);
        while (this.history.length > MAX_MATERIALIZATION_HISTORY) {
            this.history.shift();
        }
    }

    #cancelOwnedState(reason) {
        this.endpoint?.cancelPendingActorPayloadMaterializations(reason);
        for (const record of this.inFlight.values()) {
            this.abilityRuntime.rejectSnapshotExecution(
                record.ready,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                {
                    completedFixedTick: record.targetFixedTick,
                    generatedCount: 0
                }
            );
            this.totalCancelled++;
        }
        this.inFlight.clear();
    }
}
