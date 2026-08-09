import {
    createGpuRegistryMetadata,
    normalizeGpuSpawnIntent
} from '../gpu_spawn_intent.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID,
    assertEnemyLifecycleDisposition,
    isEnemyDispositionBountyEligible
} from '../../contract/enemy_lifecycle_disposition_contract.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_HISTORY_CAPACITY = 65536;
// 외부 options/reason이나 reflection으로 재현할 수 없는 command identity marker입니다.
// fixed commit payload에는 노출하지 않고 terminal close의 보존 여부만 지배합니다.
const AUTHENTIC_TERMINAL_CLEANUP_COMMANDS = new WeakSet();

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

export const normalizeSpawnIntent = normalizeGpuSpawnIntent;
export const createRegistryMetadata = createGpuRegistryMetadata;

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
 * @description mixed GPU body identity와 stable-slot spawn/despawn을 fixed tick 경계에서만 commit합니다.
 * despawn batch와 spawn batch는 각각이 원자적이며 두 batch 전체는 하나의 transaction이 아닙니다.
 */
export class EnemyLifecycleCommandOwner {
    #terminalCleanupAuthority;

    /**
     * @param {object} backend - EnemySimulationBackend public port입니다.
     * @param {object} registry - WorldRegistry입니다.
     * @param {{commandHistoryCapacity?:number,terminalCleanupAuthority?:object|null}} [options={}] - 중복 command 억제 범위와 비공개 terminal cleanup authority입니다.
     */
    constructor(backend, registry, options = {}) {
        this.backend = assertBackend(backend);
        this.registry = assertRegistry(registry);
        this.commandHistoryCapacity = requirePositiveSafeInteger(
            options.commandHistoryCapacity ?? DEFAULT_COMMAND_HISTORY_CAPACITY,
            'commandHistoryCapacity'
        );
        const terminalCleanupAuthority = options.terminalCleanupAuthority ?? null;
        if (terminalCleanupAuthority !== null
            && typeof terminalCleanupAuthority?.consumePermit !== 'function') {
            throw new TypeError(
                'terminalCleanupAuthority.consumePermit()가 필요합니다.'
            );
        }
        this.#terminalCleanupAuthority = terminalCleanupAuthority;
        this.pendingCommands = [];
        this.knownCommandIds = new Set();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.pendingDespawnKeys = new Set();
        this.nextCommandSequence = 1;
        this.nextTerminalCleanupCommandSequence = 1;
        this.lastCommitResult = null;
        this.recoveryRequired = false;
        this.ingressOpen = true;
        this.ingressCloseReason = null;
        this.destroyed = false;
    }

    /** spawn intent를 target fixed tick까지 불변 snapshot으로 보관합니다. */
    requestSpawn(intent, targetFixedTick, commandId = null) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress();
        if (rejected) {
            return rejected;
        }
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

    /**
     * 여러 spawn command를 같은 ingress transaction으로 예약합니다.
     * 각 entry는 `{ intent, targetFixedTick, commandId? }`여야 하며, 하나라도
     * 유효하지 않거나 command ID가 중복되면 queue/identity sequence를 바꾸지 않습니다.
     */
    requestSpawnBatch(requests) {
        this.#assertUsable();
        const rejected = this.#rejectClosedIngress({
            requestedCount: Array.isArray(requests) ? requests.length : 0,
            queuedCount: 0
        });
        if (rejected) {
            return rejected;
        }
        if (!Array.isArray(requests) || requests.length === 0) {
            throw new TypeError('spawn batch는 하나 이상의 request 배열이어야 합니다.');
        }

        const commands = [];
        const batchCommandIds = new Set();
        let hasDuplicateCommandId = false;
        for (let index = 0; index < requests.length; index++) {
            const request = requests[index];
            if (!request || typeof request !== 'object') {
                throw new TypeError(`requests[${index}]는 spawn request 객체여야 합니다.`);
            }
            const targetFixedTick = requirePositiveSafeInteger(
                request.targetFixedTick,
                `requests[${index}].targetFixedTick`
            );
            const intent = normalizeSpawnIntent(request.intent);
            const sequence = this.nextCommandSequence + index;
            if (!Number.isSafeInteger(sequence) || sequence <= 0) {
                throw new RangeError('spawn batch command sequence 공간이 고갈되었습니다.');
            }
            const commandId = this.#normalizeCommandId(request.commandId, sequence);
            if (this.knownCommandIds.has(commandId)
                || batchCommandIds.has(commandId)) {
                hasDuplicateCommandId = true;
            }
            batchCommandIds.add(commandId);
            commands.push(Object.freeze({
                type: 'spawn',
                commandId,
                targetFixedTick,
                sequence,
                intent
            }));
        }
        if (hasDuplicateCommandId) {
            return Object.freeze({
                accepted: false,
                requestedCount: requests.length,
                queuedCount: 0,
                reason: 'duplicate-command'
            });
        }

        for (const command of commands) {
            this.knownCommandIds.add(command.commandId);
        }
        this.pendingCommands.push(...commands);
        this.nextCommandSequence += commands.length;
        return Object.freeze({
            accepted: true,
            requestedCount: commands.length,
            queuedCount: commands.length
        });
    }

    /** stable handle despawn을 target fixed tick까지 보관합니다. */
    requestDespawn(
        handle,
        reason,
        targetFixedTick,
        commandId = null,
        options = null,
        terminalCleanupPermit = null
    ) {
        this.#assertUsable();
        const validTerminalCleanupPermit = terminalCleanupPermit !== null
            && this.#terminalCleanupAuthority?.consumePermit(
                terminalCleanupPermit
            ) === true;
        const requestedCoreImpactCleanup = reason === 'core-impact'
            && options?.disposition
                === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
            && typeof commandId === 'string'
            && commandId.startsWith('core-impact:');
        const requestedGpuDeathCleanup = reason === 'gpu-death'
            && (options?.disposition === undefined
                || options?.disposition === null)
            && typeof commandId === 'string'
            && commandId.startsWith('gpu-death:');
        const authenticCoreImpactCleanup = validTerminalCleanupPermit
            && requestedCoreImpactCleanup;
        const authenticGpuDeathCleanup = validTerminalCleanupPermit
            && requestedGpuDeathCleanup;
        const authenticTerminalCleanup = authenticCoreImpactCleanup
            || authenticGpuDeathCleanup;
        const privilegedTerminalCleanup = !this.ingressOpen
            && authenticTerminalCleanup;
        if (!this.ingressOpen && !privilegedTerminalCleanup) {
            return this.#rejectClosedIngress();
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const normalizedHandle = normalizeHandle(handle, 'despawnHandle');
        const key = handleKey(normalizedHandle);
        const normalizedReason = reason === undefined || reason === null
            ? null
            : requireNonEmptyString(reason, 'despawnReason');
        const disposition = options?.disposition === undefined
            || options?.disposition === null
            ? null
            : assertEnemyLifecycleDisposition(options.disposition);
        const pendingDespawnIndex = this.#findPendingDespawnIndex(key);
        if (pendingDespawnIndex >= 0) {
            const existing = this.pendingCommands[pendingDespawnIndex];
            const sameFixedTick = existing.targetFixedTick === tick;
            if (authenticCoreImpactCleanup
                && existing.targetFixedTick < tick) {
                // committed Core arrival의 current boundary보다 앞선 command는 이미
                // missed-boundary desync입니다. 과거로 retarget하지 않고 recovery합니다.
                this.recoveryRequired = true;
                return Object.freeze({
                    accepted: false,
                    reason: 'despawn-target-tick-conflict',
                    commandId: existing.commandId,
                    handle: normalizedHandle,
                    targetFixedTick: existing.targetFixedTick,
                    requestedTargetFixedTick: tick,
                    authenticTerminalCleanup: true,
                    recoveryRequired: true
                });
            }
            const shouldRetargetCoreImpact = authenticCoreImpactCleanup
                && existing.targetFixedTick > tick;
            const shouldUpgradeCoreImpact = authenticCoreImpactCleanup
                && normalizedReason === 'core-impact'
                && disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                && existing.disposition
                    !== ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT;
            const shouldAuthenticateExisting = authenticCoreImpactCleanup
                || (sameFixedTick
                    && authenticGpuDeathCleanup
                    && existing.reason === 'gpu-death');
            const dispositionUpgraded = shouldUpgradeCoreImpact
                && existing.disposition
                    !== ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT;
            const provenanceUpgraded = shouldAuthenticateExisting
                && !AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.has(existing);
            if (shouldRetargetCoreImpact
                || dispositionUpgraded
                || provenanceUpgraded) {
                const upgradedCommand = Object.freeze({
                    ...existing,
                    ...(shouldRetargetCoreImpact
                        ? { targetFixedTick: tick }
                        : null),
                    ...(dispositionUpgraded
                        ? {
                            disposition:
                                ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                        }
                        : null)
                });
                AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.add(upgradedCommand);
                this.pendingCommands[pendingDespawnIndex] = upgradedCommand;
            }
            const resolvedExisting = this.pendingCommands[pendingDespawnIndex];
            return Object.freeze({
                accepted: false,
                reason: 'duplicate-despawn',
                commandId: existing.commandId,
                handle: normalizedHandle,
                targetFixedTick: resolvedExisting.targetFixedTick,
                disposition: dispositionUpgraded
                    ? ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                    : resolvedExisting.disposition,
                dispositionUpgraded,
                targetFixedTickRetargeted: shouldRetargetCoreImpact,
                authenticTerminalCleanup: shouldAuthenticateExisting
                    && AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.has(
                        resolvedExisting
                    )
            });
        }
        let normalizedCommandId = this.#claimCommandId(commandId);
        let commandIdReassigned = false;
        if (!normalizedCommandId && authenticTerminalCleanup) {
            normalizedCommandId = this.#claimTerminalCleanupCommandId();
            commandIdReassigned = true;
        }
        if (!normalizedCommandId) {
            return Object.freeze({ accepted: false, reason: 'duplicate-command' });
        }
        const sequence = this.nextCommandSequence++;
        const command = Object.freeze({
            type: 'despawn',
            commandId: normalizedCommandId,
            targetFixedTick: tick,
            sequence,
            handle: normalizedHandle,
            reason: normalizedReason,
            disposition
        });
        if (authenticTerminalCleanup) {
            AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.add(command);
        }
        this.pendingCommands.push(command);
        this.pendingDespawnKeys.add(key);
        return Object.freeze({
            accepted: true,
            commandId: normalizedCommandId,
            targetFixedTick: tick,
            ...(authenticTerminalCleanup ? {
                handle: normalizedHandle,
                disposition,
                authenticTerminalCleanup: true,
                commandIdReassigned
            } : null)
        });
    }

    /**
     * terminal 전이에서 새 lifecycle ingress를 영구히 닫습니다. 아직 commit되지 않은
     * spawn/일반 despawn은 즉시 취소하고, committed-event cleanup만 마지막 경계까지
     * 잠시 보존합니다.
     */
    closeIngress(reason = 'gameplay-ingress-closed') {
        this.#assertUsable();
        let cancelledCount = 0;
        if (this.ingressOpen) {
            this.ingressOpen = false;
            this.ingressCloseReason = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'gameplay-ingress-closed';
            cancelledCount = this.#cancelCommands((command) => (
                command.type !== 'despawn'
                || !AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.has(command)
            ));
        }
        return Object.freeze({
            closed: !this.ingressOpen,
            reason: this.ingressCloseReason,
            cancelledCount,
            preservedCleanupCount: this.pendingCommands.length
        });
    }

    /** 마지막 terminal commit 시도 뒤 남은 cleanup을 모두 회수합니다. */
    finalizeClosedIngress() {
        this.#assertUsable();
        return this.ingressOpen ? 0 : this.cancelAll();
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
            ingressOpen: this.ingressOpen,
            ingressCloseReason: this.ingressCloseReason,
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
        this.#terminalCleanupAuthority = null;
        this.lastCommitResult = null;
    }

    #findPendingDespawnIndex(key) {
        if (!this.pendingDespawnKeys.has(key)) {
            return -1;
        }
        return this.pendingCommands.findIndex((command) => (
            command.type === 'despawn'
            && handleKey(command.handle) === key
        ));
    }

    #cancelCommands(shouldCancel) {
        const cancelledCommandIds = new Set();
        for (const command of this.pendingCommands) {
            if (shouldCancel(command)) {
                cancelledCommandIds.add(command.commandId);
            }
        }
        this.#consumeCommands(cancelledCommandIds);
        return cancelledCommandIds.size;
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
                const despawned = {
                    commandId: command.commandId,
                    handle: command.handle,
                    reason: command.reason
                };
                if (command.disposition !== null) {
                    despawned.disposition = command.disposition;
                    despawned.bountyEligible = isEnemyDispositionBountyEligible(
                        command.disposition
                    );
                }
                result.despawned.push(despawned);
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
                definitionId: command.intent.definitionId,
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
        const activated = this.registry.activateReserved(
            handle,
            createRegistryMetadata(command.intent)
        );
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
        const resolved = this.#normalizeCommandId(
            commandId,
            this.nextCommandSequence
        );
        if (this.knownCommandIds.has(resolved)) {
            return null;
        }
        this.knownCommandIds.add(resolved);
        return resolved;
    }

    #claimTerminalCleanupCommandId() {
        while (Number.isSafeInteger(this.nextTerminalCleanupCommandSequence)) {
            const sequence = this.nextTerminalCleanupCommandSequence++;
            const commandId = `enemy-terminal-cleanup:${sequence}`;
            if (!this.knownCommandIds.has(commandId)) {
                this.knownCommandIds.add(commandId);
                return commandId;
            }
        }
        throw new RangeError('terminal cleanup command ID 공간이 고갈되었습니다.');
    }

    #normalizeCommandId(commandId, sequence) {
        return commandId === undefined || commandId === null
            ? `enemy-lifecycle:${sequence}`
            : requireNonEmptyString(commandId, 'commandId');
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

    #rejectClosedIngress(extra = null) {
        if (this.ingressOpen) {
            return null;
        }
        return Object.freeze({
            accepted: false,
            reason: this.ingressCloseReason ?? 'gameplay-ingress-closed',
            ...(extra ?? {})
        });
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 EnemyLifecycleCommandOwner는 사용할 수 없습니다.');
        }
    }
}
