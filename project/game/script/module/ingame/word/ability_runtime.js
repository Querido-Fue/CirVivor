import {
    ABILITY_SUBJECT_SNAPSHOT_STATUS,
    normalizeAbilityExecutionCommand
} from '../contract/ability_execution_contract.js';
import {
    ABILITY_EXECUTION_OUTCOME_CODE
} from './word_system.js';

const MAX_EXECUTION_HISTORY = 128;

export const ABILITY_EXECUTION_STATE = Object.freeze({
    REQUESTED: 'REQUESTED',
    SUBJECT_SNAPSHOT_PENDING: 'SUBJECT_SNAPSHOT_PENDING',
    DESTINATION_PRELEASE_PENDING: 'DESTINATION_PRELEASE_PENDING',
    GPU_MATERIALIZATION_PENDING: 'GPU_MATERIALIZATION_PENDING',
    COMMITTED: 'COMMITTED',
    ZERO_SUBJECT: 'ZERO_SUBJECT',
    REJECTED_CAPACITY: 'REJECTED_CAPACITY',
    FAILED_PROTOCOL: 'FAILED_PROTOCOL',
    REJECTED_PLACEMENT: 'REJECTED_PLACEMENT',
    CANCELLED: 'CANCELLED'
});

const TERMINAL_EXECUTION_STATES = new Set([
    ABILITY_EXECUTION_STATE.COMMITTED,
    ABILITY_EXECUTION_STATE.ZERO_SUBJECT,
    ABILITY_EXECUTION_STATE.REJECTED_CAPACITY,
    ABILITY_EXECUTION_STATE.FAILED_PROTOCOL,
    ABILITY_EXECUTION_STATE.REJECTED_PLACEMENT,
    ABILITY_EXECUTION_STATE.CANCELLED
]);
const EXECUTION_STATES = new Set(Object.values(ABILITY_EXECUTION_STATE));

function assertEndpoint(endpoint) {
    const methods = [
        'requestAbilityExecutionCommand',
        'drainCompletedAbilitySubjectSnapshots',
        'getAbilitySubjectSnapshotGpuBinding',
        'releaseAbilitySubjectSnapshot',
        'getAbilitySubjectSnapshotStatus',
        'getStatus'
    ];
    if (!endpoint || methods.some((method) => typeof endpoint[method] !== 'function')) {
        throw new TypeError('AbilityRuntime endpoint contract가 올바르지 않습니다.');
    }
    return endpoint;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function freezeHistoryEntry(source) {
    return Object.freeze({
        executionId: source.executionId,
        executionOrdinal: source.executionOrdinal,
        abilityRequestId: source.abilityRequestId,
        slotId: source.slotId,
        code: source.code,
        state: source.state,
        targetFixedTick: source.targetFixedTick,
        completedFixedTick: source.completedFixedTick,
        subjectCount: source.subjectCount ?? 0,
        capacityDemand: source.capacityDemand ?? 0,
        generatedCount: source.generatedCount ?? 0
    });
}

function terminalStateForOutcome(code) {
    if (code === ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED) {
        return ABILITY_EXECUTION_STATE.COMMITTED;
    }
    if (code === ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT) {
        return ABILITY_EXECUTION_STATE.ZERO_SUBJECT;
    }
    if (code === ABILITY_EXECUTION_OUTCOME_CODE.SUBJECT_CAPACITY_REJECTED
        || code
            === ABILITY_EXECUTION_OUTCOME_CODE.DESTINATION_CAPACITY_REJECTED) {
        return ABILITY_EXECUTION_STATE.REJECTED_CAPACITY;
    }
    if (code === ABILITY_EXECUTION_OUTCOME_CODE.PLACEMENT_REJECTED) {
        return ABILITY_EXECUTION_STATE.REJECTED_PLACEMENT;
    }
    if (code === ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED) {
        return ABILITY_EXECUTION_STATE.FAILED_PROTOCOL;
    }
    return ABILITY_EXECUTION_STATE.CANCELLED;
}

/** CPU semantic request와 GPU snapshot token 수명을 연결하는 run-domain owner입니다. */
export class AbilityRuntime {
    constructor(options = {}) {
        if (!options.wordSystem
            || typeof options.wordSystem.drainActivationRequests !== 'function'
            || typeof options.wordSystem.recordExecutionOutcome !== 'function') {
            throw new TypeError('AbilityRuntime에 WordSystem이 필요합니다.');
        }
        this.wordSystem = options.wordSystem;
        this.endpoint = assertEndpoint(options.endpoint);
        this.nextExecutionOrdinal = requirePositiveSafeInteger(
            options.initialExecutionOrdinal ?? 1,
            'initialExecutionOrdinal'
        );
        this.deferredActivationRequests = [];
        this.inFlightByExecutionId = new Map();
        this.readySnapshots = [];
        this.history = [];
        this.executionStates = new Map();
        this.executionStateHistory = [];
        this.nextStateSequence = 1;
        this.lastExecutionState = null;
        this.recoveryRequired = false;
        this.failure = null;
        this.closed = false;
        this.destroyed = false;
        this.totalRequested = 0;
        this.totalSnapshotCompleted = 0;
        this.totalZeroSubject = 0;
        this.totalCapacityRejected = 0;
        this.totalCancelled = 0;
    }

    /** WordSystem request를 stable ordinal command로 변환해 current endpoint에 stage합니다. */
    stageForFixedTick({ targetFixedTick, camera } = {}) {
        if (this.destroyed || this.closed) {
            return Object.freeze({ acceptedCount: 0, deferredCount: 0 });
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const drained = this.wordSystem.drainActivationRequests();
        if (drained.length > 0) {
            this.deferredActivationRequests.push(...drained);
            this.totalRequested += drained.length;
        }
        let acceptedCount = 0;
        let rejectedCount = 0;
        for (let index = 0; index < this.deferredActivationRequests.length;) {
            const request = this.deferredActivationRequests[index];
            if (request.targetFixedTick > tick) {
                index++;
                continue;
            }
            const ordinal = this.nextExecutionOrdinal;
            if (ordinal >= 0xffffffff) {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'ability-execution-ordinal-exhausted',
                    message: 'ability execution ordinal이 고갈됐습니다.'
                });
                break;
            }
            const aimWorld = camera?.viewportToWorld?.(
                request.aimViewport.x,
                request.aimViewport.y,
                {}
            ) ?? request.aimViewport;
            const sessionGeneration = this.endpoint.getStatus()
                .sessionGeneration;
            const executionId = [
                'ability-execution.r3',
                sessionGeneration,
                ordinal,
                request.abilityRequestId
            ].join(':');
            const command = normalizeAbilityExecutionCommand({
                compiledAbility: request.compiledAbility,
                executionId,
                executionOrdinal: ordinal,
                targetFixedTick: tick,
                aimPoint: aimWorld,
                subjectLimit: request.compiledAbility.budgets.subjectCount,
                generationLimit: request.compiledAbility.budgets.generation
            });
            const record = Object.freeze({ request, command });
            this.#transitionExecution(
                record,
                ABILITY_EXECUTION_STATE.REQUESTED,
                tick
            );
            const receipt = this.endpoint.requestAbilityExecutionCommand(command);
            if (receipt?.accepted === true) {
                this.deferredActivationRequests.splice(index, 1);
                this.nextExecutionOrdinal++;
                this.inFlightByExecutionId.set(executionId, record);
                this.#transitionExecution(
                    record,
                    ABILITY_EXECUTION_STATE.SUBJECT_SNAPSHOT_PENDING,
                    tick
                );
                acceptedCount++;
                continue;
            }
            const retryable = receipt?.retryable === true
                || receipt?.reason === 'ability-command-capacity';
            if (retryable) break;
            this.deferredActivationRequests.splice(index, 1);
            rejectedCount++;
            this.recoveryRequired ||= receipt?.requiresRecovery === true;
            this.#recordTerminalOutcome(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                tick,
                { subjectCount: 0, capacityDemand: 0 }
            );
        }
        return Object.freeze({
            acceptedCount,
            rejectedCount,
            deferredCount: this.deferredActivationRequests.length
        });
    }

    /** Endpoint의 aggregate-only completion을 exact command와 대조합니다. */
    observeCompletedSubjectSnapshots(currentFixedTick) {
        const tick = requirePositiveSafeInteger(
            currentFixedTick,
            'currentFixedTick'
        );
        if (this.destroyed) {
            return Object.freeze({ observedCount: 0, readyCount: 0 });
        }
        const completions = [];
        this.endpoint.drainCompletedAbilitySubjectSnapshots(completions);
        let observedCount = 0;
        for (const completion of completions) {
            const record = this.inFlightByExecutionId.get(
                completion?.executionId
            );
            if (!record) {
                if (completion?.snapshotToken) {
                    this.endpoint.releaseAbilitySubjectSnapshot(
                        completion.snapshotToken
                    );
                }
                continue;
            }
            const command = record.command;
            const exact = completion.executionOrdinal
                    === command.executionOrdinal
                && completion.commandFingerprint === command.fingerprint
                && completion.targetFixedTick === command.targetFixedTick;
            if (!exact) {
                if (completion.snapshotToken) {
                    this.endpoint.releaseAbilitySubjectSnapshot(
                        completion.snapshotToken
                    );
                }
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'ability-subject-completion-mismatch',
                    message: 'ability subject completion이 staged command와 다릅니다.'
                });
                this.inFlightByExecutionId.delete(command.executionId);
                this.#recordTerminalOutcome(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                    tick,
                    completion
                );
                continue;
            }
            this.inFlightByExecutionId.delete(completion.executionId);
            observedCount++;
            if (completion.status
                === ABILITY_SUBJECT_SNAPSHOT_STATUS.COMPLETE) {
                if (!completion.snapshotToken
                    || !this.endpoint.getAbilitySubjectSnapshotGpuBinding(
                        completion.snapshotToken
                    )) {
                    this.recoveryRequired = true;
                    this.failure = Object.freeze({
                        code: 'ability-subject-snapshot-token-invalid',
                        message: 'complete snapshot의 GPU token이 유효하지 않습니다.'
                    });
                    this.#recordTerminalOutcome(
                        record,
                        ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                        tick,
                        completion
                    );
                    continue;
                }
                this.#transitionExecution(
                    record,
                    ABILITY_EXECUTION_STATE.DESTINATION_PRELEASE_PENDING,
                    completion.sourceTick || tick,
                    completion
                );
                this.readySnapshots.push(Object.freeze({
                    request: record.request,
                    command,
                    completion
                }));
                this.totalSnapshotCompleted++;
                continue;
            }
            if (completion.status
                === ABILITY_SUBJECT_SNAPSHOT_STATUS.ZERO_SUBJECT) {
                this.totalZeroSubject++;
                this.#recordTerminalOutcome(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.ZERO_SUBJECT,
                    completion.sourceTick || tick,
                    completion
                );
            } else if (completion.status
                === ABILITY_SUBJECT_SNAPSHOT_STATUS.CAPACITY_REJECTED) {
                this.totalCapacityRejected++;
                this.#recordTerminalOutcome(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.SUBJECT_CAPACITY_REJECTED,
                    completion.sourceTick || tick,
                    completion
                );
            } else if (completion.status
                === ABILITY_SUBJECT_SNAPSHOT_STATUS.CANCELLED) {
                this.totalCancelled++;
                this.#recordTerminalOutcome(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                    completion.sourceTick || tick,
                    completion
                );
            } else {
                this.recoveryRequired = true;
                this.failure = Object.freeze({
                    code: 'ability-subject-protocol-rejected',
                    message: 'GPU ability subject protocol이 fail-closed 거절됐습니다.'
                });
                this.#recordTerminalOutcome(
                    record,
                    ABILITY_EXECUTION_OUTCOME_CODE.PROTOCOL_REJECTED,
                    completion.sourceTick || tick,
                    completion
                );
            }
        }
        return Object.freeze({
            observedCount,
            readyCount: this.readySnapshots.length,
            recoveryRequired: this.recoveryRequired
        });
    }

    /** Turn 3 payload owner가 GPU snapshot token을 ordered batch로 가져갑니다. */
    drainReadySnapshots(out = []) {
        if (!Array.isArray(out)) {
            throw new TypeError('ready snapshot output은 배열이어야 합니다.');
        }
        out.push(...this.readySnapshots);
        this.readySnapshots.length = 0;
        return out;
    }

    returnReadySnapshot(record) {
        if (!record?.completion?.snapshotToken || this.destroyed) return false;
        this.readySnapshots.unshift(record);
        return true;
    }

    markGpuMaterializationPending(record, fixedTick) {
        if (!record?.completion?.snapshotToken || this.destroyed) return false;
        this.#transitionExecution(
            record,
            ABILITY_EXECUTION_STATE.GPU_MATERIALIZATION_PENDING,
            requirePositiveSafeInteger(fixedTick, 'materialization fixedTick'),
            record.completion
        );
        return true;
    }

    completeSnapshotExecution(record, options = {}) {
        return this.#settleReadySnapshot(
            record,
            ABILITY_EXECUTION_OUTCOME_CODE.COMPLETED,
            true,
            options
        );
    }

    rejectSnapshotExecution(record, code, options = {}) {
        return this.#settleReadySnapshot(record, code, false, options);
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
            || this.endpoint?.getAbilitySubjectSnapshotStatus()
                ?.requiresRecovery === true;
    }

    getStatus() {
        return Object.freeze({
            destroyed: this.destroyed,
            closed: this.closed,
            nextExecutionOrdinal: this.nextExecutionOrdinal,
            deferredActivationCount: this.deferredActivationRequests.length,
            inFlightCount: this.inFlightByExecutionId.size,
            readySnapshotCount: this.readySnapshots.length,
            activeExecutions: Object.freeze(Array.from(
                this.executionStates.values(),
                ({ view }) => view
            )),
            lastExecutionState: this.lastExecutionState,
            executionStateHistory: Object.freeze([
                ...this.executionStateHistory
            ]),
            totalRequested: this.totalRequested,
            totalSnapshotCompleted: this.totalSnapshotCompleted,
            totalZeroSubject: this.totalZeroSubject,
            totalCapacityRejected: this.totalCapacityRejected,
            totalCancelled: this.totalCancelled,
            recoveryRequired: this.requiresRecovery(),
            failure: this.failure,
            history: Object.freeze([...this.history]),
            gpu: this.endpoint?.getAbilitySubjectSnapshotStatus() ?? null
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.#cancelOwnedState('destroyed');
        this.destroyed = true;
        this.closed = true;
        this.endpoint = null;
        this.wordSystem = null;
        this.executionStates.clear();
        this.executionStateHistory.length = 0;
        this.lastExecutionState = null;
        this.history.length = 0;
    }

    #settleReadySnapshot(record, code, cooldownConsumed, options) {
        if (!record?.completion?.snapshotToken) return false;
        const released = this.endpoint.releaseAbilitySubjectSnapshot(
            record.completion.snapshotToken
        );
        if (!released) {
            this.recoveryRequired = true;
            this.failure = Object.freeze({
                code: 'ability-subject-snapshot-release-failed',
                message: 'GPU subject snapshot token을 release하지 못했습니다.'
            });
            return false;
        }
        this.#recordTerminalOutcome(
            record,
            code,
            options.completedFixedTick ?? record.completion.sourceTick,
            {
                ...record.completion,
                generatedCount: options.generatedCount ?? 0,
                cooldownConsumed
            }
        );
        return true;
    }

    #recordTerminalOutcome(record, code, completedFixedTick, facts = {}) {
        const request = record.request;
        const command = record.command;
        const state = terminalStateForOutcome(code);
        this.#transitionExecution(
            record,
            state,
            completedFixedTick,
            facts
        );
        const entry = freezeHistoryEntry({
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            abilityRequestId: request.abilityRequestId,
            slotId: request.slotId,
            code,
            state,
            targetFixedTick: command.targetFixedTick,
            completedFixedTick,
            subjectCount: facts.subjectCount ?? 0,
            capacityDemand: facts.capacityDemand ?? 0,
            generatedCount: facts.generatedCount ?? 0
        });
        this.history.push(entry);
        while (this.history.length > MAX_EXECUTION_HISTORY) {
            this.history.shift();
        }
        this.wordSystem.recordExecutionOutcome({
            abilityRequestId: request.abilityRequestId,
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            slotId: request.slotId,
            code,
            completedFixedTick,
            subjectCount: entry.subjectCount,
            generatedCount: entry.generatedCount,
            cooldownConsumed: facts.cooldownConsumed === true
        });
        return entry;
    }

    #transitionExecution(record, state, fixedTick, facts = {}) {
        const request = record?.request;
        const command = record?.command;
        if (!request || !command || !EXECUTION_STATES.has(state)) {
            throw new RangeError('ability execution state transition 입력이 잘못됐습니다.');
        }
        const tick = requirePositiveSafeInteger(
            fixedTick,
            'execution state fixedTick'
        );
        const current = this.executionStates.get(command.executionId);
        if (current?.view.state === state) return current.view;
        const view = Object.freeze({
            sequence: this.nextStateSequence++,
            executionId: command.executionId,
            executionOrdinal: command.executionOrdinal,
            abilityRequestId: request.abilityRequestId,
            slotId: request.slotId,
            state,
            fixedTick: tick,
            subjectCount: Number.isSafeInteger(Number(facts.subjectCount))
                ? Number(facts.subjectCount)
                : 0,
            generatedCount: Number.isSafeInteger(Number(facts.generatedCount))
                ? Number(facts.generatedCount)
                : 0
        });
        this.lastExecutionState = view;
        this.executionStateHistory.push(view);
        while (this.executionStateHistory.length > MAX_EXECUTION_HISTORY) {
            this.executionStateHistory.shift();
        }
        if (TERMINAL_EXECUTION_STATES.has(state)) {
            this.executionStates.delete(command.executionId);
        } else {
            this.executionStates.set(command.executionId, { record, view });
        }
        return view;
    }

    #cancelOwnedState(reason) {
        for (const ready of this.readySnapshots) {
            this.endpoint?.releaseAbilitySubjectSnapshot(
                ready.completion.snapshotToken
            );
            this.#recordTerminalOutcome(
                ready,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                ready.completion.sourceTick,
                { subjectCount: ready.completion.subjectCount }
            );
        }
        this.readySnapshots.length = 0;
        for (const record of this.inFlightByExecutionId.values()) {
            this.#recordTerminalOutcome(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                record.command.targetFixedTick,
                { subjectCount: 0 }
            );
        }
        for (const { record, view } of [...this.executionStates.values()]) {
            if (view.state !== ABILITY_EXECUTION_STATE.REQUESTED) continue;
            this.#recordTerminalOutcome(
                record,
                ABILITY_EXECUTION_OUTCOME_CODE.CANCELLED,
                record.command.targetFixedTick,
                { subjectCount: 0 }
            );
        }
        this.totalCancelled += this.inFlightByExecutionId.size
            + this.deferredActivationRequests.length;
        this.inFlightByExecutionId.clear();
        this.deferredActivationRequests.length = 0;
        this.endpoint?.getBackend?.()?.cancelPendingAbilityExecutions?.(reason);
    }
}
