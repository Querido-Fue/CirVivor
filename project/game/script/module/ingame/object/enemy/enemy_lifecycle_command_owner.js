const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_HISTORY_CAPACITY = 65536;

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= INVALID_HANDLE_COMPONENT) {
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

function normalizeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 entity handle 객체여야 합니다.`);
    }
    return Object.freeze({
        entityId: requirePositiveSafeInteger(source.entityId, `${label}.entityId`),
        incarnation: requirePositiveSafeInteger(source.incarnation, `${label}.incarnation`)
    });
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function isRetryableSpawnRejection(reason) {
    return reason === 'unavailable'
        || reason === 'gpu-unavailable'
        || reason === 'gpu-deferred'
        || reason === 'idle'
        || reason === 'not-ready';
}

function isRetryableBackendRecoveryState(state) {
    return state === 'gpu-backpressure';
}

function cloneAndFreezeValue(source, label, ancestors = new Set()) {
    if (source === null
        || typeof source === 'string'
        || typeof source === 'boolean'
        || typeof source === 'undefined') {
        return source ?? null;
    }
    if (typeof source === 'number') {
        if (!Number.isFinite(source)) {
            throw new TypeError(`${label}에는 유한 숫자만 사용할 수 있습니다.`);
        }
        return source;
    }
    if (typeof source !== 'object') {
        throw new TypeError(`${label}에는 함수나 symbol을 사용할 수 없습니다.`);
    }
    if (ancestors.has(source)) {
        throw new TypeError(`${label}에 순환 참조가 있습니다.`);
    }
    ancestors.add(source);
    let result;
    if (Array.isArray(source) || ArrayBuffer.isView(source)) {
        result = Array.from(source, (value, index) => (
            cloneAndFreezeValue(value, `${label}[${index}]`, ancestors)
        ));
    } else {
        const prototype = Object.getPrototypeOf(source);
        if (prototype !== Object.prototype && prototype !== null) {
            ancestors.delete(source);
            throw new TypeError(`${label}은 plain object여야 합니다.`);
        }
        result = {};
        for (const [key, value] of Object.entries(source)) {
            result[key] = cloneAndFreezeValue(value, `${label}.${key}`, ancestors);
        }
    }
    ancestors.delete(source);
    return Object.freeze(result);
}

function normalizeSpawnIntent(source) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('enemy spawn intent가 필요합니다.');
    }
    if (Object.prototype.hasOwnProperty.call(source, 'entityId')
        || Object.prototype.hasOwnProperty.call(source, 'incarnation')) {
        throw new TypeError('spawn identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const snapshot = cloneAndFreezeValue(source, 'spawnIntent');
    requireNonEmptyString(snapshot.kindId, 'spawnIntent.kindId');
    requireNonEmptyString(snapshot.enemyDefinitionId, 'spawnIntent.enemyDefinitionId');
    return snapshot;
}

function freezeCommitResult(result) {
    return Object.freeze({
        fixedTick: result.fixedTick,
        state: result.state,
        spawned: Object.freeze(result.spawned.map((entry) => Object.freeze(entry))),
        despawned: Object.freeze(result.despawned.map((entry) => Object.freeze(entry))),
        rejected: Object.freeze(result.rejected.map((entry) => Object.freeze(entry))),
        recoveryRequired: result.recoveryRequired === true,
        backendState: result.backendState,
        registryRevision: result.registryRevision
    });
}

function assertBackend(backend) {
    const requiredMethods = [
        'spawnBodies',
        'despawnBodies',
        'hasBody',
        'requiresRecovery',
        'getRuntimeState'
    ];
    for (const methodName of requiredMethods) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`EnemyLifecycle backend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function assertRegistry(registry) {
    const requiredMethods = [
        'reserveEntity',
        'activateReserved',
        'cancelReservation',
        'remove',
        'has',
        'getRevision'
    ];
    for (const methodName of requiredMethods) {
        if (typeof registry?.[methodName] !== 'function') {
            throw new TypeError(`EnemyLifecycle registry.${methodName}()가 필요합니다.`);
        }
    }
    return registry;
}

/**
 * @class EnemyLifecycleCommandOwner
 * @description enemy identity와 GPU stable-slot spawn/despawn을 fixed tick 경계에서만 commit합니다.
 * despawn batch와 spawn batch는 각각이 원자적이며 두 batch 전체는 하나의 transaction이 아닙니다.
 */
export class EnemyLifecycleCommandOwner {
    /**
     * @param {object} backend - EnemySimulationBackend public port입니다.
     * @param {object} registry - WorldRegistry입니다.
     * @param {{commandHistoryCapacity?:number}} [options={}] - 중복 command 억제 범위입니다.
     */
    constructor(backend, registry, options = {}) {
        this.backend = assertBackend(backend);
        this.registry = assertRegistry(registry);
        this.commandHistoryCapacity = requirePositiveSafeInteger(
            options.commandHistoryCapacity ?? DEFAULT_COMMAND_HISTORY_CAPACITY,
            'commandHistoryCapacity'
        );
        this.pendingCommands = [];
        this.knownCommandIds = new Set();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.pendingDespawnKeys = new Set();
        this.nextCommandSequence = 1;
        this.lastCommitResult = null;
        this.recoveryRequired = false;
        this.destroyed = false;
    }

    /** spawn intent를 target fixed tick까지 불변 snapshot으로 보관합니다. */
    requestSpawn(intent, targetFixedTick, commandId = null) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const normalizedIntent = normalizeSpawnIntent(intent);
        const normalizedCommandId = this.#claimCommandId(commandId);
        if (!normalizedCommandId) {
            return Object.freeze({ accepted: false, reason: 'duplicate-command' });
        }
        const sequence = this.nextCommandSequence++;
        this.pendingCommands.push(Object.freeze({
            type: 'spawn',
            commandId: normalizedCommandId,
            targetFixedTick: tick,
            sequence,
            intent: normalizedIntent
        }));
        return Object.freeze({
            accepted: true,
            commandId: normalizedCommandId,
            targetFixedTick: tick
        });
    }

    /** stable handle despawn을 target fixed tick까지 보관합니다. */
    requestDespawn(handle, reason, targetFixedTick, commandId = null) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const normalizedHandle = normalizeHandle(handle, 'despawnHandle');
        const key = handleKey(normalizedHandle);
        if (this.pendingDespawnKeys.has(key)) {
            return Object.freeze({ accepted: false, reason: 'duplicate-despawn' });
        }
        const normalizedReason = reason === undefined || reason === null
            ? null
            : requireNonEmptyString(reason, 'despawnReason');
        const normalizedCommandId = this.#claimCommandId(commandId);
        if (!normalizedCommandId) {
            return Object.freeze({ accepted: false, reason: 'duplicate-command' });
        }
        const sequence = this.nextCommandSequence++;
        this.pendingCommands.push(Object.freeze({
            type: 'despawn',
            commandId: normalizedCommandId,
            targetFixedTick: tick,
            sequence,
            handle: normalizedHandle,
            reason: normalizedReason
        }));
        this.pendingDespawnKeys.add(key);
        return Object.freeze({
            accepted: true,
            commandId: normalizedCommandId,
            targetFixedTick: tick
        });
    }

    /**
     * due command snapshot을 despawn → spawn 순서로 fixed boundary에서만 commit합니다.
     * @returns {object} 불변 commit result snapshot입니다.
     */
    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const baseResult = {
            fixedTick: tick,
            state: 'committed',
            spawned: [],
            despawned: [],
            rejected: [],
            recoveryRequired: false,
            backendState: this.backend.getRuntimeState(),
            registryRevision: this.registry.getRevision()
        };

        if (this.recoveryRequired) {
            baseResult.state = 'failed';
            baseResult.recoveryRequired = true;
            return this.#saveResult(baseResult);
        }

        const dueCommands = [];
        for (const command of this.pendingCommands) {
            if (command.targetFixedTick < tick) {
                baseResult.state = 'failed';
                baseResult.recoveryRequired = true;
                baseResult.rejected.push({
                    commandId: command.commandId,
                    code: 'missed-fixed-boundary'
                });
            } else if (command.targetFixedTick === tick) {
                dueCommands.push(command);
            }
        }
        if (baseResult.recoveryRequired) {
            return this.#saveResult(baseResult);
        }
        if (dueCommands.length === 0) {
            return this.#saveResult(baseResult);
        }
        if (this.backend.requiresRecovery()) {
            baseResult.state = isRetryableBackendRecoveryState(baseResult.backendState)
                ? 'stalled'
                : 'failed';
            baseResult.recoveryRequired = true;
            return this.#saveResult(baseResult);
        }

        const consumedCommandIds = new Set();
        const despawnCommands = dueCommands.filter((command) => command.type === 'despawn');
        const spawnCommands = dueCommands.filter((command) => command.type === 'spawn');

        const despawnOutcome = this.#commitDespawns(
            despawnCommands,
            baseResult,
            consumedCommandIds
        );
        if (despawnOutcome === 'recovery') {
            this.#consumeCommands(consumedCommandIds);
            return this.#saveResult(baseResult);
        }

        this.#commitSpawns(spawnCommands, baseResult, consumedCommandIds);
        this.#consumeCommands(consumedCommandIds);
        if (baseResult.recoveryRequired) {
            if (baseResult.state !== 'stalled') {
                baseResult.state = 'failed';
            }
        } else if (baseResult.rejected.length > 0) {
            baseResult.state = 'committed-with-rejections';
        }
        return this.#saveResult(baseResult);
    }

    getPendingCount() {
        return this.pendingCommands.length;
    }

    getLastCommitResult() {
        return this.lastCommitResult;
    }

    getStatus() {
        return Object.freeze({
            pendingCount: this.pendingCommands.length,
            lastCommitResult: this.lastCommitResult,
            recoveryRequired: this.recoveryRequired,
            destroyed: this.destroyed
        });
    }

    /** GPU에 반영되지 않은 command만 취소합니다. */
    cancelAll() {
        if (this.destroyed || this.pendingCommands.length === 0) {
            return 0;
        }
        const commands = this.pendingCommands;
        this.pendingCommands = [];
        this.pendingDespawnKeys.clear();
        for (const command of commands) {
            this.#rememberCompletedCommandId(command.commandId);
        }
        return commands.length;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.cancelAll();
        this.destroyed = true;
        this.backend = null;
        this.registry = null;
        this.lastCommitResult = null;
    }

    #commitDespawns(commands, result, consumedCommandIds) {
        if (commands.length === 0) {
            return 'complete';
        }
        const validCommands = [];
        for (const command of commands) {
            const registryHas = this.registry.has(command.handle);
            const backendHas = this.backend.hasBody(command.handle);
            if (!registryHas && !backendHas) {
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'stale-handle'
                });
                consumedCommandIds.add(command.commandId);
                continue;
            }
            if (registryHas !== backendHas) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'registry-backend-desync'
                });
                return 'recovery';
            }
            validCommands.push(command);
        }
        if (validCommands.length === 0) {
            return 'complete';
        }

        let backendResult;
        try {
            backendResult = this.backend.despawnBodies(
                validCommands.map((command) => command.handle)
            );
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: validCommands[0].commandId,
                code: 'despawn-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }

        const fullyRemoved = backendResult?.removed === validCommands.length
            && Number(backendResult?.rejected ?? 0) === 0;
        let removedThisBatch = 0;
        for (const command of validCommands) {
            if (!this.backend.hasBody(command.handle)) {
                if (!this.registry.remove(command.handle)) {
                    result.recoveryRequired = true;
                }
                removedThisBatch++;
                result.despawned.push({
                    commandId: command.commandId,
                    handle: command.handle,
                    reason: command.reason
                });
                consumedCommandIds.add(command.commandId);
            }
        }
        if (!fullyRemoved
            || removedThisBatch < validCommands.length
            || backendResult?.requiresRecovery === true
            || this.backend.requiresRecovery()) {
            result.state = 'failed';
            result.recoveryRequired = true;
            for (const command of validCommands) {
                if (!consumedCommandIds.has(command.commandId)) {
                    result.rejected.push({
                        commandId: command.commandId,
                        code: backendResult?.reason ?? 'despawn-partial'
                    });
                }
            }
            return 'recovery';
        }
        return 'complete';
    }

    #commitSpawns(commands, result, consumedCommandIds) {
        if (commands.length === 0 || result.recoveryRequired) {
            return;
        }
        const reservations = [];
        for (const command of commands) {
            const handle = this.registry.reserveEntity({
                kindId: command.intent.kindId,
                definitionId: command.intent.enemyDefinitionId,
                createdAtTick: command.targetFixedTick
            });
            if (!handle) {
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                for (const rejectedCommand of commands) {
                    result.rejected.push({
                        commandId: rejectedCommand.commandId,
                        code: 'registry-capacity'
                    });
                }
                result.state = 'failed';
                result.recoveryRequired = true;
                return;
            }
            reservations.push({ command, handle });
        }

        const bodies = reservations.map(({ command, handle }) => ({
            ...command.intent,
            entityId: handle.entityId,
            incarnation: handle.incarnation
        }));
        let backendResult;
        try {
            backendResult = this.backend.spawnBodies(bodies);
        } catch (error) {
            let anyBackendBody = false;
            for (const reservation of reservations) {
                if (this.backend.hasBody(reservation.handle)) {
                    anyBackendBody = true;
                    this.#activateReservation(reservation, result, consumedCommandIds);
                } else {
                    this.registry.cancelReservation(reservation.handle);
                }
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: reservations[0].command.commandId,
                code: anyBackendBody ? 'spawn-exception-partial' : 'spawn-exception',
                message: String(error?.message ?? error)
            });
            return;
        }

        const accepted = Number(backendResult?.accepted ?? 0);
        const rejected = Number(backendResult?.rejected ?? commands.length);
        const isFullSuccess = accepted === commands.length && rejected === 0;
        if (backendResult?.handles !== undefined) {
            if (!Array.isArray(backendResult.handles)
                || backendResult.handles.length !== accepted) {
                result.state = 'failed';
                result.recoveryRequired = true;
            } else {
                for (let index = 0; index < backendResult.handles.length; index++) {
                    try {
                        const returnedHandle = normalizeHandle(
                            backendResult.handles[index],
                            `spawnResult.handles[${index}]`
                        );
                        if (handleKey(returnedHandle) !== handleKey(reservations[index].handle)) {
                            result.state = 'failed';
                            result.recoveryRequired = true;
                        }
                    } catch {
                        result.state = 'failed';
                        result.recoveryRequired = true;
                    }
                }
            }
        }
        const responseContractFailed = result.recoveryRequired;

        let observedActiveCount = 0;
        const rejectedReservations = [];
        for (const reservation of reservations) {
            if (this.backend.hasBody(reservation.handle)) {
                observedActiveCount++;
                this.#activateReservation(reservation, result, consumedCommandIds);
            } else {
                this.registry.cancelReservation(reservation.handle);
                rejectedReservations.push(reservation);
            }
        }
        const countsAreValid = Number.isSafeInteger(accepted)
            && Number.isSafeInteger(rejected)
            && accepted >= 0
            && rejected >= 0
            && accepted + rejected === commands.length;
        const cleanZeroAcceptance = countsAreValid
            && accepted === 0
            && rejected === commands.length
            && observedActiveCount === 0;
        const backendRecoveryRequired = backendResult?.requiresRecovery === true
            || this.backend.requiresRecovery();
        for (const reservation of rejectedReservations) {
            result.rejected.push({
                commandId: reservation.command.commandId,
                code: backendResult?.reason ?? 'spawn-rejected'
            });
        }
        if (cleanZeroAcceptance) {
            result.state = !responseContractFailed
                && !backendRecoveryRequired
                && isRetryableSpawnRejection(backendResult?.reason)
                ? 'stalled'
                : 'failed';
            result.recoveryRequired = true;
            return;
        }
        if (!countsAreValid
            || observedActiveCount !== accepted
            || (!isFullSuccess && accepted !== 0)) {
            result.state = 'failed';
            result.recoveryRequired = true;
        }
        if (backendRecoveryRequired) {
            result.state = 'failed';
            result.recoveryRequired = true;
        }
    }

    #activateReservation(reservation, result, consumedCommandIds) {
        const { command, handle } = reservation;
        const activated = this.registry.activateReserved(handle, {
            enemyDefinitionId: command.intent.enemyDefinitionId,
            gateId: command.intent.gateId,
            pathId: command.intent.pathId,
            initialWaypointIndex: command.intent.waypointIndex,
            spawnSequence: command.intent.spawnSequence,
            waveId: command.intent.waveId,
            policyId: command.intent.policyId
        });
        if (!activated) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'registry-activation-failed'
            });
            return;
        }
        result.spawned.push({ commandId: command.commandId, handle });
        consumedCommandIds.add(command.commandId);
    }

    #claimCommandId(commandId) {
        const resolved = commandId === undefined || commandId === null
            ? `enemy-lifecycle:${this.nextCommandSequence}`
            : requireNonEmptyString(commandId, 'commandId');
        if (this.knownCommandIds.has(resolved)) {
            return null;
        }
        this.knownCommandIds.add(resolved);
        return resolved;
    }

    #consumeCommands(consumedCommandIds) {
        if (consumedCommandIds.size === 0) {
            return;
        }
        const remaining = [];
        for (const command of this.pendingCommands) {
            if (!consumedCommandIds.has(command.commandId)) {
                remaining.push(command);
                continue;
            }
            if (command.type === 'despawn') {
                this.pendingDespawnKeys.delete(handleKey(command.handle));
            }
            this.#rememberCompletedCommandId(command.commandId);
        }
        this.pendingCommands = remaining;
    }

    #rememberCompletedCommandId(commandId) {
        this.completedCommandIds.push(commandId);
        while ((this.completedCommandIds.length - this.completedCommandHead)
            > this.commandHistoryCapacity) {
            const forgotten = this.completedCommandIds[this.completedCommandHead++];
            this.knownCommandIds.delete(forgotten);
        }
        if (this.completedCommandHead >= this.commandHistoryCapacity) {
            this.completedCommandIds = this.completedCommandIds.slice(this.completedCommandHead);
            this.completedCommandHead = 0;
        }
    }

    #saveResult(result) {
        if (result.recoveryRequired && result.state === 'failed') {
            this.recoveryRequired = true;
        }
        result.backendState = this.backend.getRuntimeState();
        result.registryRevision = this.registry.getRevision();
        this.lastCommitResult = freezeCommitResult(result);
        return this.lastCommitResult;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 EnemyLifecycleCommandOwner는 사용할 수 없습니다.');
        }
    }
}
