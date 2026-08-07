import {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} from './gpu_spawn_intent.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 1024;
const DEFAULT_HISTORY_CAPACITY = 65536;

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number <= 0
        || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
        throw new RangeError(`${label}은 유한한 float32 범위 숫자여야 합니다.`);
    }
    return Math.fround(number);
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

function stableFingerprint(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableFingerprint).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => (
        `${JSON.stringify(key)}:${stableFingerprint(value[key])}`
    )).join(',')}}`;
}

function normalizeMoveIntent(command) {
    const handle = normalizeHandle(command?.handle ?? command, 'control.handle');
    let moveIntentX = requireFinite(
        command?.moveIntentX ?? command?.moveIntent?.x ?? 0,
        'control.moveIntentX'
    );
    let moveIntentY = requireFinite(
        command?.moveIntentY ?? command?.moveIntent?.y ?? 0,
        'control.moveIntentY'
    );
    const magnitude = Math.hypot(moveIntentX, moveIntentY);
    if (magnitude > 1) {
        moveIntentX = Math.fround(moveIntentX / magnitude);
        moveIntentY = Math.fround(moveIntentY / magnitude);
    }
    return Object.freeze({
        ...handle,
        moveIntentX,
        moveIntentY
    });
}

function normalizeVector(source, label) {
    return Object.freeze({
        x: requireFinite(source?.x ?? 0, `${label}.x`),
        y: requireFinite(source?.y ?? 0, `${label}.y`)
    });
}

function normalizeSourceRelativeIntent(source) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('source-relative spawn intent가 필요합니다.');
    }
    const sourceHandle = normalizeHandle(
        source.sourceHandle,
        'sourceRelativeSpawn.sourceHandle'
    );
    const destinationSpawn = normalizeGpuSpawnIntent(
        source.destinationSpawn
            ?? source.destinationIntent
            ?? source.spawnIntent
    );
    return Object.freeze({
        sourceHandle,
        destinationSpawn,
        positionOffset: normalizeVector(
            source.positionOffset,
            'sourceRelativeSpawn.positionOffset'
        ),
        launchVelocity: normalizeVector(
            source.launchVelocity,
            'sourceRelativeSpawn.launchVelocity'
        ),
        sourceVelocityScale: requireFinite(
            source.sourceVelocityScale ?? 0,
            'sourceRelativeSpawn.sourceVelocityScale'
        )
    });
}

function assertBackend(backend) {
    for (const methodName of [
        'hasBody',
        'canControlBody',
        'stageFixedPrograms',
        'drainCompletedSpawnProgramBatches',
        'getEventProtocolState',
        'requiresRecovery',
        'getRuntimeState'
    ]) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`fixed command backend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function assertRegistry(registry) {
    for (const methodName of [
        'reserveEntity',
        'activateReserved',
        'cancelReservation',
        'has',
        'getRevision',
        'getStatus'
    ]) {
        if (typeof registry?.[methodName] !== 'function') {
            throw new TypeError(`fixed command registry.${methodName}()가 필요합니다.`);
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
    return Object.freeze({ sessionGeneration, deviceGeneration, authoritativeEpoch });
}

function sameProtocol(left, right) {
    return left.sessionGeneration === right.sessionGeneration
        && left.deviceGeneration === right.deviceGeneration
        && left.authoritativeEpoch === right.authoritativeEpoch;
}

function freezeResult(result) {
    return Object.freeze({
        fixedTick: result.fixedTick,
        state: result.state,
        controls: Object.freeze(result.controls.map((entry) => Object.freeze(entry))),
        sourceRelativeSpawns: Object.freeze(
            result.sourceRelativeSpawns.map((entry) => Object.freeze(entry))
        ),
        rejected: Object.freeze(result.rejected.map((entry) => Object.freeze(entry))),
        completed: Object.freeze(result.completed.map((entry) => Object.freeze(entry))),
        recoveryRequired: result.recoveryRequired === true,
        protocolFailure: result.protocolFailure ?? null
    });
}

/**
 * @class GpuFixedCommandOwner
 * @description Generic next-fixed control과 source-relative SpawnProgram reservation을 bounded하게 소유합니다.
 */
export class GpuFixedCommandOwner {
    constructor(backend, registry, options = {}) {
        this.backend = assertBackend(backend);
        this.registry = assertRegistry(registry);
        this.commandCapacity = requirePositiveSafeInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'historyCapacity'
        );
        this.pending = new Array(this.commandCapacity).fill(null);
        this.pendingCount = 0;
        this.nextSequence = 1;
        this.knownCommands = new Map();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.controlTargetKeys = new Map();
        this.pendingDestinations = new Map();
        this.spawnCompletionScratch = [];
        this.lastCommitResult = null;
        this.lastCompletionResult = Object.freeze({
            fixedTick: 0,
            completed: Object.freeze([]),
            protocolFailure: null
        });
        this.telemetry = {
            replayed: 0,
            coalesced: 0,
            conflicted: 0,
            stale: 0,
            capacityRejected: 0,
            completedResolved: 0,
            completedSourceInvalid: 0
        };
        this.recoveryRequired = false;
        this.destroyed = false;
    }

    requestBodyControl(command, targetFixedTick, commandId) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        const payload = normalizeMoveIntent(command);
        const fingerprint = stableFingerprint({ type: 'control', tick, payload });
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const targetDisposition = this.#getExactActiveDisposition(payload);
        if (targetDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                targetDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-handle'
            );
        }
        if (!this.backend.canControlBody(payload)) {
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'flow-body-not-controllable'
            );
        }
        const targetKey = `${tick}:${handleKey(payload)}`;
        const existing = this.controlTargetKeys.get(targetKey);
        if (existing?.state === 'conflicted') {
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        if (existing) {
            if (existing.payloadFingerprint === stableFingerprint(payload)) {
                this.telemetry.coalesced++;
                const receipt = Object.freeze({
                    accepted: true,
                    commandId: id,
                    targetFixedTick: tick,
                    coalesced: true,
                    canonicalCommandId: existing.command.commandId
                });
                this.#evictCompletedHistoryForInsert();
                if (this.knownCommands.size >= this.historyCapacity) {
                    this.telemetry.capacityRejected++;
                    return Object.freeze({
                        accepted: false,
                        commandId: id,
                        reason: 'command-history-capacity'
                    });
                }
                this.knownCommands.set(id, { fingerprint, receipt, completed: true });
                this.#rememberCompleted(id);
                return receipt;
            }
            existing.command.conflicted = true;
            this.controlTargetKeys.set(targetKey, { state: 'conflicted' });
            this.telemetry.conflicted++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'body-tick-conflict'
            );
        }
        const enqueued = this.#enqueue({
            type: 'control',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'control.protocol'
            ),
            targetKey,
            conflicted: false
        }, fingerprint);
        if (enqueued.accepted) {
            this.controlTargetKeys.set(targetKey, {
                state: 'pending',
                command: enqueued.command,
                payloadFingerprint: stableFingerprint(payload)
            });
        }
        return enqueued.receipt;
    }

    requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const id = requireNonEmptyString(commandId, 'commandId');
        const payload = normalizeSourceRelativeIntent(intent);
        const fingerprint = stableFingerprint({ type: 'source-relative-spawn', tick, payload });
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const sourceDisposition = this.#getExactActiveDisposition(payload.sourceHandle);
        if (sourceDisposition !== 'active') {
            this.telemetry.stale++;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                sourceDisposition === 'desync'
                    ? 'registry-backend-desync'
                    : 'stale-source'
            );
        }
        return this.#enqueue({
            type: 'source-relative-spawn',
            commandId: id,
            targetFixedTick: tick,
            payload,
            protocol: normalizeProtocol(
                this.backend.getEventProtocolState(),
                'sourceRelativeSpawn.protocol'
            )
        }, fingerprint).receipt;
    }

    /** SpawnProgram result를 event 처리보다 먼저 registry visibility에 반영합니다. */
    commitCompletedAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const batches = this.spawnCompletionScratch;
        batches.length = 0;
        this.backend.drainCompletedSpawnProgramBatches(batches);
        const completed = [];
        const preparedOutcomes = [];
        const preparedDestinationKeys = new Set();
        let protocolFailure = null;
        if (batches.length === 0) {
            this.lastCompletionResult = Object.freeze({
                fixedTick: tick,
                completed: Object.freeze(completed),
                protocolFailure: null
            });
            return this.lastCompletionResult;
        }
        let currentProtocol = null;
        try {
            currentProtocol = normalizeProtocol(
                this.backend.getEventProtocolState(),
                'spawnCompletion.protocol'
            );
            for (const batch of batches) {
                const batchProtocol = normalizeProtocol(batch, 'spawnCompletion.batch');
                if (!sameProtocol(batchProtocol, currentProtocol) || batch.failure) {
                    protocolFailure = Object.freeze({
                        stage: 'spawn-program-completion',
                        code: batch.failure ? 'gpu-program-failure' : 'generation-mismatch',
                        message: batch.failure?.message
                            ?? 'SpawnProgram completion generation이 현재 session과 다릅니다.'
                    });
                    break;
                }
                if (!Array.isArray(batch.outcomes)) {
                    throw new TypeError('SpawnProgram completion outcomes 배열이 필요합니다.');
                }
                for (const outcome of batch.outcomes) {
                    const key = handleKey(outcome?.destinationHandle);
                    const pending = this.pendingDestinations.get(key);
                    if (!pending
                        || preparedDestinationKeys.has(key)
                        || batch.sourceTick !== pending.targetFixedTick
                        || handleKey(outcome?.sourceHandle)
                            !== handleKey(pending.payload.sourceHandle)) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'destination-contract',
                            message: `등록되지 않았거나 중복된 destination outcome입니다: ${key}`
                        });
                        break;
                    }
                    if (outcome.reason === 'resolved') {
                        if (!this.backend.hasBody(outcome.destinationHandle)) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'activation-failed',
                                message: `resolved destination backend body가 없습니다: ${key}`
                            });
                            break;
                        }
                    } else if (outcome.reason === 'source-invalid') {
                        if (this.backend.hasBody(outcome.destinationHandle)) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'cleanup-failed',
                                message: `source-invalid destination backend body가 남았습니다: ${key}`
                            });
                            break;
                        }
                    } else {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'unknown-outcome',
                            message: `지원하지 않는 SpawnProgram outcome입니다: ${outcome.reason}`
                        });
                        break;
                    }
                    preparedDestinationKeys.add(key);
                    preparedOutcomes.push({ key, outcome, pending });
                }
                if (protocolFailure) {
                    break;
                }
            }
        } catch (error) {
            protocolFailure = Object.freeze({
                stage: 'spawn-program-completion',
                code: 'completion-contract',
                message: String(error?.message ?? error)
            });
        }
        // 모든 envelope/identity/result를 먼저 검증해 malformed batch가 registry를
        // 절반만 변경하지 못하게 한 뒤, exact reservation mutation을 적용합니다.
        if (!protocolFailure) {
            for (const { key, outcome, pending } of preparedOutcomes) {
                const applied = outcome.reason === 'resolved'
                    ? this.registry.activateReserved(
                        outcome.destinationHandle,
                        createGpuRegistryMetadata(pending.payload.destinationSpawn)
                    )
                    : this.registry.cancelReservation(outcome.destinationHandle);
                if (!applied) {
                    protocolFailure = Object.freeze({
                        stage: 'spawn-program-completion',
                        code: outcome.reason === 'resolved'
                            ? 'activation-failed'
                            : 'cleanup-failed',
                        message: `검증된 destination reservation 적용에 실패했습니다: ${key}`
                    });
                    break;
                }
                if (outcome.reason === 'resolved') {
                    this.telemetry.completedResolved++;
                } else {
                    this.telemetry.completedSourceInvalid++;
                }
                this.pendingDestinations.delete(key);
                completed.push(Object.freeze({
                    commandId: pending.commandId,
                    handle: outcome.destinationHandle,
                    outcome: outcome.reason
                }));
            }
        }
        if (protocolFailure) {
            this.recoveryRequired = true;
        }
        this.lastCompletionResult = Object.freeze({
            fixedTick: tick,
            completed: Object.freeze(completed),
            protocolFailure
        });
        return this.lastCompletionResult;
    }

    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const result = {
            fixedTick: tick,
            state: 'committed',
            controls: [],
            sourceRelativeSpawns: [],
            rejected: [],
            completed: [...this.lastCompletionResult.completed],
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.lastCompletionResult.protocolFailure
        };
        if (this.recoveryRequired) {
            result.state = 'failed';
            result.recoveryRequired = true;
            return this.#saveResult(result);
        }

        const due = [];
        for (let index = 0; index < this.commandCapacity; index++) {
            const command = this.pending[index];
            if (!command) {
                continue;
            }
            if (command.targetFixedTick < tick) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'missed-fixed-boundary'
                });
            } else if (command.targetFixedTick === tick) {
                due.push(command);
            }
        }
        if (result.recoveryRequired) {
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        if (due.length === 0) {
            return this.#saveResult(result);
        }
        if (this.backend.requiresRecovery()) {
            result.state = this.backend.getRuntimeState() === 'gpu-backpressure'
                ? 'stalled'
                : 'failed';
            result.recoveryRequired = true;
            return this.#saveResult(result);
        }

        let currentProtocol;
        try {
            currentProtocol = normalizeProtocol(
                this.backend.getEventProtocolState(),
                'fixedCommit.protocol'
            );
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.protocolFailure = Object.freeze({
                stage: 'fixed-command-protocol',
                code: 'generation-contract',
                message: String(error?.message ?? error)
            });
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        const controls = [];
        const sourceCommands = [];
        const consumed = new Set();
        for (const command of due) {
            if (!sameProtocol(command.protocol, currentProtocol)) {
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'stale-generation'
                });
                consumed.add(command.commandId);
                continue;
            }
            if (command.conflicted) {
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'body-tick-conflict'
                });
                consumed.add(command.commandId);
                continue;
            }
            const handle = command.type === 'control'
                ? command.payload
                : command.payload.sourceHandle;
            const disposition = this.#getExactActiveDisposition(handle);
            if (disposition !== 'active') {
                result.rejected.push({
                    commandId: command.commandId,
                    code: disposition === 'desync'
                        ? 'registry-backend-desync'
                        : command.type === 'control'
                            ? 'stale-handle'
                            : 'stale-source'
                });
                this.telemetry.stale++;
                consumed.add(command.commandId);
                continue;
            }
            if (command.type === 'control') {
                if (!this.backend.canControlBody(handle)) {
                    result.rejected.push({
                        commandId: command.commandId,
                        code: 'flow-body-not-controllable'
                    });
                    consumed.add(command.commandId);
                } else {
                    controls.push(command);
                }
            } else {
                sourceCommands.push(command);
            }
        }

        if (this.recoveryRequired) {
            result.state = 'failed';
            result.recoveryRequired = true;
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        if (controls.length === 0 && sourceCommands.length === 0) {
            this.#consume(consumed);
            if (result.rejected.length > 0) {
                result.state = 'committed-with-rejections';
            }
            return this.#saveResult(result);
        }

        const reservations = [];
        for (const command of sourceCommands) {
            const handle = this.registry.reserveEntity({
                kindId: command.payload.destinationSpawn.kindId,
                definitionId: command.payload.destinationSpawn.definitionId,
                createdAtTick: tick
            });
            if (!handle) {
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                for (const rejected of [...controls, ...sourceCommands]) {
                    result.rejected.push({
                        commandId: rejected.commandId,
                        code: 'registry-capacity'
                    });
                    consumed.add(rejected.commandId);
                }
                result.state = 'committed-with-rejections';
                this.telemetry.capacityRejected += controls.length
                    + sourceCommands.length;
                this.#consume(consumed);
                return this.#saveResult(result);
            }
            reservations.push({ command, handle });
        }

        const plan = {
            targetFixedTick: tick,
            controls: controls.map((command) => command.payload),
            sourceRelativeSpawns: reservations.map(({ command, handle }) => ({
                sourceHandle: command.payload.sourceHandle,
                destinationHandle: handle,
                destinationSpawn: command.payload.destinationSpawn,
                positionOffset: command.payload.positionOffset,
                launchVelocity: command.payload.launchVelocity,
                sourceVelocityScale: command.payload.sourceVelocityScale
            }))
        };
        let backendResult;
        try {
            backendResult = this.backend.stageFixedPrograms(plan);
        } catch (error) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: due[0].commandId,
                code: 'fixed-program-exception',
                message: String(error?.message ?? error)
            });
            this.recoveryRequired = true;
            return this.#saveResult(result);
        }
        const expectedAccepted = controls.length + reservations.length;
        if (backendResult?.requiresRecovery === true
            || this.backend.requiresRecovery()) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: due[0].commandId,
                code: backendResult?.reason ?? 'fixed-program-recovery'
            });
            this.recoveryRequired = true;
            this.#consume(new Set(due.map((command) => command.commandId)));
            return this.#saveResult(result);
        }
        if (backendResult?.accepted !== expectedAccepted
            || Number(backendResult?.rejected ?? 0) !== 0) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            for (const command of [...controls, ...sourceCommands]) {
                result.rejected.push({
                    commandId: command.commandId,
                    code: backendResult?.reason ?? 'fixed-program-rejected'
                });
                consumed.add(command.commandId);
            }
            if (backendResult?.reason === 'fixed-program-capacity') {
                this.telemetry.capacityRejected += expectedAccepted;
            }
            result.state = backendResult?.requiresRecovery
                || this.backend.requiresRecovery()
                ? 'failed'
                : 'committed-with-rejections';
            result.recoveryRequired = result.state === 'failed';
            if (result.recoveryRequired) {
                this.recoveryRequired = true;
            }
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        for (const command of controls) {
            result.controls.push({ commandId: command.commandId, handle: command.payload });
            consumed.add(command.commandId);
        }
        for (const reservation of reservations) {
            const { command, handle } = reservation;
            this.pendingDestinations.set(handleKey(handle), {
                commandId: command.commandId,
                targetFixedTick: tick,
                payload: command.payload,
                handle
            });
            result.sourceRelativeSpawns.push({
                commandId: command.commandId,
                handle,
                state: 'gpu-resolve-pending'
            });
            consumed.add(command.commandId);
        }
        this.#consume(consumed);
        if (result.rejected.length > 0) {
            result.state = 'committed-with-rejections';
        }
        return this.#saveResult(result);
    }

    getPendingCount() {
        return this.pendingCount + this.pendingDestinations.size;
    }

    getStatus() {
        return Object.freeze({
            capacity: this.commandCapacity,
            pendingCommandCount: this.pendingCount,
            pendingDestinationCount: this.pendingDestinations.size,
            recoveryRequired: this.recoveryRequired,
            lastCommitResult: this.lastCommitResult,
            lastCompletionResult: this.lastCompletionResult,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        for (const pending of this.pendingDestinations.values()) {
            this.registry.cancelReservation(pending.handle);
        }
        this.pendingDestinations.clear();
        this.pending.fill(null);
        this.pendingCount = 0;
        this.knownCommands.clear();
        this.controlTargetKeys.clear();
        this.spawnCompletionScratch.length = 0;
        this.destroyed = true;
    }

    #enqueue(command, fingerprint) {
        this.#evictCompletedHistoryForInsert();
        if (this.pendingCount >= this.commandCapacity
            || this.knownCommands.size >= this.historyCapacity) {
            this.telemetry.capacityRejected++;
            const receipt = Object.freeze({
                accepted: false,
                commandId: command.commandId,
                reason: 'command-capacity'
            });
            return { accepted: false, receipt, command: null };
        }
        let slot = -1;
        for (let index = 0; index < this.commandCapacity; index++) {
            if (this.pending[index] === null) {
                slot = index;
                break;
            }
        }
        const stored = {
            ...command,
            sequence: this.nextSequence++,
            slot
        };
        this.pending[slot] = stored;
        this.pendingCount++;
        const receipt = Object.freeze({
            accepted: true,
            commandId: command.commandId,
            targetFixedTick: command.targetFixedTick
        });
        this.knownCommands.set(command.commandId, {
            fingerprint,
            receipt,
            completed: false
        });
        return { accepted: true, receipt, command: stored };
    }

    #handleKnownCommand(commandId, fingerprint) {
        const known = this.knownCommands.get(commandId);
        if (!known) {
            return null;
        }
        if (known.fingerprint !== fingerprint) {
            throw new RangeError(`commandId가 다른 payload로 재사용되었습니다: ${commandId}`);
        }
        this.telemetry.replayed++;
        return Object.freeze({ ...known.receipt, replay: true });
    }

    #rememberImmediateRejection(commandId, fingerprint, reason) {
        const receipt = Object.freeze({ accepted: false, commandId, reason });
        this.#evictCompletedHistoryForInsert();
        if (this.knownCommands.size >= this.historyCapacity) {
            this.telemetry.capacityRejected++;
            return receipt;
        }
        this.knownCommands.set(commandId, {
            fingerprint,
            receipt,
            completed: true
        });
        this.#rememberCompleted(commandId);
        return receipt;
    }

    #getExactActiveDisposition(handle) {
        const registryHas = this.registry.has(handle);
        const backendHas = this.backend.hasBody(handle);
        if (registryHas !== backendHas) {
            this.recoveryRequired = true;
            return 'desync';
        }
        return registryHas && backendHas ? 'active' : 'stale';
    }

    #consume(commandIds) {
        if (commandIds.size === 0) {
            return;
        }
        for (let index = 0; index < this.commandCapacity; index++) {
            const command = this.pending[index];
            if (!command || !commandIds.has(command.commandId)) {
                continue;
            }
            this.pending[index] = null;
            this.pendingCount--;
            if (command.targetKey) {
                this.controlTargetKeys.delete(command.targetKey);
            }
            const known = this.knownCommands.get(command.commandId);
            if (known) {
                known.completed = true;
            }
            this.#rememberCompleted(command.commandId);
        }
    }

    #rememberCompleted(commandId) {
        this.completedCommandIds.push(commandId);
        while ((this.completedCommandIds.length - this.completedCommandHead)
            > this.historyCapacity) {
            const forgotten = this.completedCommandIds[this.completedCommandHead++];
            const known = this.knownCommands.get(forgotten);
            if (known?.completed) {
                this.knownCommands.delete(forgotten);
            }
        }
        if (this.completedCommandHead >= this.historyCapacity) {
            this.completedCommandIds = this.completedCommandIds.slice(
                this.completedCommandHead
            );
            this.completedCommandHead = 0;
        }
    }

    #evictCompletedHistoryForInsert() {
        while (this.knownCommands.size >= this.historyCapacity
            && this.completedCommandHead < this.completedCommandIds.length) {
            const forgotten = this.completedCommandIds[this.completedCommandHead++];
            const known = this.knownCommands.get(forgotten);
            if (known?.completed) {
                this.knownCommands.delete(forgotten);
            }
        }
        if (this.completedCommandHead >= this.historyCapacity) {
            this.completedCommandIds = this.completedCommandIds.slice(
                this.completedCommandHead
            );
            this.completedCommandHead = 0;
        }
    }

    #saveResult(result) {
        if (result.recoveryRequired && result.state === 'failed') {
            this.recoveryRequired = true;
        }
        this.lastCommitResult = freezeResult(result);
        return this.lastCommitResult;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuFixedCommandOwner는 사용할 수 없습니다.');
        }
    }
}
