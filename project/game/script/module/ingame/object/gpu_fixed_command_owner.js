import {
    createGpuRegistryMetadata,
    materializeGpuPlainDataSnapshot,
    normalizeGpuSpawnIntent
} from './gpu_spawn_intent.js';
import {
    GPU_SPAWN_PROGRAM_MODE
} from '../physics/gpu/gpu_fixed_primitive_abi.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_CAPACITY = 1024;
const DEFAULT_HISTORY_CAPACITY = 65536;
const NORMAL_SPAWN_REJECTION_CODES = new Set([
    'fixed-program-capacity',
    'body-capacity',
    'spawn-program-capacity',
    'spawn-program-readback-capacity',
    'fixed-primitives-unsupported'
]);

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

function stableFingerprint(value, ancestors = new Set()) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (ancestors.has(value)) {
        throw new TypeError('command payload에 순환 참조가 있습니다.');
    }
    ancestors.add(value);
    let fingerprint;
    if (Array.isArray(value)) {
        fingerprint = `[${value.map((entry) => (
            stableFingerprint(entry, ancestors)
        )).join(',')}]`;
    } else {
        const keys = Object.keys(value).sort();
        fingerprint = `{${keys.map((key) => (
            `${JSON.stringify(key)}:${stableFingerprint(value[key], ancestors)}`
        )).join(',')}}`;
    }
    ancestors.delete(value);
    return fingerprint;
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

function normalizeRequiredVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return normalizeVector(source, label);
}

function rejectPresentProperties(source, propertyNames, label) {
    for (const propertyName of propertyNames) {
        if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
            throw new TypeError(`${label}에는 ${propertyName}을(를) 사용할 수 없습니다.`);
        }
    }
}

function normalizeSourceRelativeMode(source) {
    const modeFlags = requirePositiveSafeInteger(
        source?.modeFlags ?? GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
        'sourceRelativeSpawn.modeFlags'
    );
    if (modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY
        && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT
        && modeFlags !== GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY) {
        throw new RangeError(
            `지원하지 않는 source-relative SpawnProgram mode입니다: ${modeFlags}`
        );
    }
    return modeFlags;
}

function normalizeSourceRelativeIntent(source, subjectTeamId, exact = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('source-relative spawn intent가 필요합니다.');
    }
    const modeFlags = exact.modeFlags ?? normalizeSourceRelativeMode(source);
    const sourceHandle = exact.sourceHandle ?? normalizeHandle(
        source.sourceHandle,
        'sourceRelativeSpawn.sourceHandle'
    );
    const isTargetEntity = modeFlags
        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
    const targetHandle = isTargetEntity
        ? exact.targetHandle ?? normalizeHandle(
            source.targetHandle,
            'sourceRelativeSpawn.targetHandle'
        )
        : null;
    const suppliedDestinationSpawn = normalizeGpuSpawnIntent(
        source.destinationSpawn
            ?? source.destinationIntent
            ?? source.spawnIntent,
        { subjectTeamId }
    );
    const hasSourceEntityId = suppliedDestinationSpawn.sourceEntityId !== undefined
        && suppliedDestinationSpawn.sourceEntityId !== null;
    const hasSourceIncarnation = suppliedDestinationSpawn.sourceIncarnation !== undefined
        && suppliedDestinationSpawn.sourceIncarnation !== null;
    if (hasSourceEntityId !== hasSourceIncarnation) {
        throw new TypeError(
            'source-relative destination metadata에는 sourceEntityId/sourceIncarnation이 모두 필요합니다.'
        );
    }
    if (hasSourceEntityId
        && (suppliedDestinationSpawn.sourceEntityId !== sourceHandle.entityId
            || suppliedDestinationSpawn.sourceIncarnation !== sourceHandle.incarnation)) {
        throw new RangeError(
            'source-relative destination metadata는 actual sourceHandle과 정확히 일치해야 합니다.'
        );
    }
    const hasTargetEntityId = suppliedDestinationSpawn.targetEntityId !== undefined
        && suppliedDestinationSpawn.targetEntityId !== null;
    const hasTargetIncarnation = suppliedDestinationSpawn.targetIncarnation !== undefined
        && suppliedDestinationSpawn.targetIncarnation !== null;
    if (hasTargetEntityId !== hasTargetIncarnation) {
        throw new TypeError(
            'source-relative destination metadata에는 targetEntityId/targetIncarnation이 모두 필요합니다.'
        );
    }
    if (!isTargetEntity && hasTargetEntityId) {
        throw new TypeError(
            'non-targeted source-relative destination에는 target provenance를 사용할 수 없습니다.'
        );
    }
    if (isTargetEntity && hasTargetEntityId
        && (suppliedDestinationSpawn.targetEntityId !== targetHandle.entityId
            || suppliedDestinationSpawn.targetIncarnation !== targetHandle.incarnation)) {
        throw new RangeError(
            'targeted destination metadata는 actual targetHandle과 정확히 일치해야 합니다.'
        );
    }
    const destinationSpawn = normalizeGpuSpawnIntent({
        ...suppliedDestinationSpawn,
        sourceEntityId: sourceHandle.entityId,
        sourceIncarnation: sourceHandle.incarnation,
        ...(isTargetEntity ? {
            targetEntityId: targetHandle.entityId,
            targetIncarnation: targetHandle.incarnation
        } : {})
    }, { subjectTeamId });
    const base = {
        sourceHandle,
        destinationSpawn,
        modeFlags,
        positionOffset: isTargetEntity
            ? normalizeRequiredVector(
                source.positionOffset,
                'sourceRelativeSpawn.positionOffset'
            )
            : normalizeVector(
                source.positionOffset,
                'sourceRelativeSpawn.positionOffset'
            )
    };
    if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY) {
        rejectPresentProperties(source, [
            'aimWorldPoint',
            'launchSpeed',
            'targetHandle',
            'targetOffset'
        ], 'velocity source-relative intent');
        return Object.freeze({
            ...base,
            launchVelocity: normalizeRequiredVector(
                source.launchVelocity,
                'sourceRelativeSpawn.launchVelocity'
            ),
            sourceVelocityScale: requireFinite(
                source.sourceVelocityScale ?? 0,
                'sourceRelativeSpawn.sourceVelocityScale'
            )
        });
    }
    if (modeFlags === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT) {
        rejectPresentProperties(source, [
            'launchVelocity',
            'sourceVelocityScale',
            'targetHandle',
            'targetOffset'
        ], 'aim-point source-relative intent');
        const launchSpeed = requireFinite(
            source.launchSpeed,
            'sourceRelativeSpawn.launchSpeed'
        );
        if (launchSpeed <= 0) {
            throw new RangeError('sourceRelativeSpawn.launchSpeed는 양수여야 합니다.');
        }
        return Object.freeze({
            ...base,
            aimWorldPoint: normalizeRequiredVector(
                source.aimWorldPoint,
                'sourceRelativeSpawn.aimWorldPoint'
            ),
            launchSpeed
        });
    }
    rejectPresentProperties(source, [
        'position',
        'velocity',
        'launchVelocity',
        'sourceVelocityScale',
        'aimWorldPoint',
        'trackedPose',
        'targetPosition',
        'targetWorldPosition',
        'cpuTargetPosition'
    ], 'target-entity source-relative intent');
    const launchSpeed = requireFinite(
        source.launchSpeed,
        'sourceRelativeSpawn.launchSpeed'
    );
    if (launchSpeed <= 0) {
        throw new RangeError('sourceRelativeSpawn.launchSpeed는 양수여야 합니다.');
    }
    return Object.freeze({
        ...base,
        targetHandle,
        targetOffset: normalizeVector(
            source.targetOffset,
            'sourceRelativeSpawn.targetOffset'
        ),
        launchSpeed
    });
}

function commandDomain(command) {
    return command?.type === 'control' ? 'control' : 'spawn';
}

function normalizeBackendDomainResult(
    backendResult,
    propertyName,
    expectedCount,
    totalExpectedCount
) {
    if (expectedCount === 0) {
        return Object.freeze({ accepted: 0, rejected: 0, reason: null });
    }
    const explicit = backendResult?.[propertyName];
    if (explicit && typeof explicit === 'object') {
        return Object.freeze({
            accepted: Number(explicit.accepted),
            rejected: Number(explicit.rejected),
            reason: explicit.reason ?? backendResult?.reason ?? null
        });
    }
    const flatAccepted = Number(backendResult?.accepted);
    const flatRejected = Number(backendResult?.rejected ?? 0);
    if (flatAccepted === totalExpectedCount && flatRejected === 0) {
        return Object.freeze({ accepted: expectedCount, rejected: 0, reason: null });
    }
    if (expectedCount === totalExpectedCount) {
        return Object.freeze({
            accepted: flatAccepted,
            rejected: flatRejected,
            reason: backendResult?.reason ?? null
        });
    }
    return Object.freeze({
        accepted: Number.NaN,
        rejected: Number.NaN,
        reason: backendResult?.reason ?? 'fixed-program-domain-contract'
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
        'copyEntityView',
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
        this.usesSharedCommandCapacity = options.commandCapacity !== undefined
            && options.controlCommandCapacity === undefined
            && options.sourceRelativeSpawnCommandCapacity === undefined;
        const sharedCapacity = requirePositiveSafeInteger(
            options.commandCapacity ?? DEFAULT_COMMAND_CAPACITY,
            'commandCapacity'
        );
        this.controlCommandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : requirePositiveSafeInteger(
                options.controlCommandCapacity ?? sharedCapacity,
                'controlCommandCapacity'
            );
        this.sourceRelativeSpawnCommandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : requirePositiveSafeInteger(
                options.sourceRelativeSpawnCommandCapacity ?? sharedCapacity,
                'sourceRelativeSpawnCommandCapacity'
            );
        this.commandCapacity = this.usesSharedCommandCapacity
            ? sharedCapacity
            : this.controlCommandCapacity + this.sourceRelativeSpawnCommandCapacity;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'historyCapacity'
        );
        this.pending = new Array(this.commandCapacity).fill(null);
        this.pendingCount = 0;
        this.pendingControlCount = 0;
        this.pendingSourceRelativeSpawnCount = 0;
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
            completedSourceInvalid: 0,
            completedTargetInvalid: 0
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
        const snapshot = materializeGpuPlainDataSnapshot(
            intent,
            'sourceRelativeSpawn'
        );
        const modeFlags = normalizeSourceRelativeMode(snapshot);
        const sourceHandle = normalizeHandle(
            snapshot?.sourceHandle,
            'sourceRelativeSpawn.sourceHandle'
        );
        const isTargetEntity = modeFlags
            === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
        const targetHandle = isTargetEntity
            ? normalizeHandle(
                snapshot?.targetHandle,
                'sourceRelativeSpawn.targetHandle'
            )
            : null;
        const fingerprint = stableFingerprint({
            type: 'source-relative-spawn',
            tick,
            intent: snapshot
        });
        const duplicate = this.#handleKnownCommand(id, fingerprint);
        if (duplicate) {
            return duplicate;
        }
        const sourceDisposition = this.#getExactActiveDisposition(sourceHandle);
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
        if (targetHandle) {
            const targetDisposition = this.#getExactActiveDisposition(targetHandle);
            if (targetDisposition !== 'active') {
                this.telemetry.stale++;
                return this.#rememberImmediateRejection(
                    id,
                    fingerprint,
                    targetDisposition === 'desync'
                        ? 'registry-backend-desync'
                        : 'stale-target'
                );
            }
        }
        const sourceView = this.registry.copyEntityView(sourceHandle, {});
        if (!sourceView || !sourceView.metadata) {
            this.recoveryRequired = true;
            return this.#rememberImmediateRejection(
                id,
                fingerprint,
                'source-metadata-missing'
            );
        }
        const payload = normalizeSourceRelativeIntent(
            snapshot,
            sourceView.metadata.teamId,
            { modeFlags, sourceHandle, targetHandle }
        );
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
        const priorResult = this.lastCompletionResult.fixedTick === tick
            ? this.lastCompletionResult
            : null;
        const batches = this.spawnCompletionScratch;
        batches.length = 0;
        this.backend.drainCompletedSpawnProgramBatches(batches);
        if (priorResult?.protocolFailure) {
            batches.length = 0;
            return priorResult;
        }
        const completed = priorResult
            ? [...priorResult.completed]
            : [];
        const preparedOutcomes = [];
        const preparedDestinationKeys = new Set();
        let protocolFailure = null;
        if (batches.length === 0) {
            if (priorResult) {
                return priorResult;
            }
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
                    const pendingTargetHandle = pending?.payload?.targetHandle ?? null;
                    const outcomeTargetHandle = outcome?.targetHandle ?? null;
                    if (!pending
                        || preparedDestinationKeys.has(key)
                        || batch.sourceTick !== pending.targetFixedTick
                        || handleKey(outcome?.sourceHandle)
                            !== handleKey(pending.payload.sourceHandle)
                        || ((pendingTargetHandle === null)
                            !== (outcomeTargetHandle === null))
                        || (pendingTargetHandle !== null
                            && handleKey(outcomeTargetHandle)
                                !== handleKey(pendingTargetHandle))) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'destination-contract',
                            message: `등록되지 않았거나 중복된 destination outcome입니다: ${key}`
                        });
                        break;
                    }
                    if (outcome.reason === 'target-invalid'
                        && pendingTargetHandle === null) {
                        protocolFailure = Object.freeze({
                            stage: 'spawn-program-completion',
                            code: 'unknown-outcome',
                            message: 'non-targeted SpawnProgram은 target-invalid를 반환할 수 없습니다.'
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
                    } else if (outcome.reason === 'source-invalid'
                        || outcome.reason === 'target-invalid') {
                        if (this.backend.hasBody(outcome.destinationHandle)) {
                            protocolFailure = Object.freeze({
                                stage: 'spawn-program-completion',
                                code: 'cleanup-failed',
                                message: `${outcome.reason} destination backend body가 남았습니다: ${key}`
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
                } else if (outcome.reason === 'source-invalid') {
                    this.telemetry.completedSourceInvalid++;
                } else {
                    this.telemetry.completedTargetInvalid++;
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
                    domain: commandDomain(command),
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
                    domain: commandDomain(command),
                    code: 'stale-generation'
                });
                consumed.add(command.commandId);
                continue;
            }
            if (command.conflicted) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: commandDomain(command),
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
                    domain: commandDomain(command),
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
            if (command.type === 'source-relative-spawn'
                && command.payload.targetHandle) {
                const targetDisposition = this.#getExactActiveDisposition(
                    command.payload.targetHandle
                );
                if (targetDisposition !== 'active') {
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: 'spawn',
                        code: targetDisposition === 'desync'
                            ? 'registry-backend-desync'
                            : 'stale-target'
                    });
                    this.telemetry.stale++;
                    consumed.add(command.commandId);
                    continue;
                }
            }
            if (command.type === 'control') {
                if (!this.backend.canControlBody(handle)) {
                    result.rejected.push({
                        commandId: command.commandId,
                        domain: 'control',
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
        let registryRejectedSourceCommands = false;
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
                reservations.length = 0;
                for (const rejected of sourceCommands) {
                    result.rejected.push({
                        commandId: rejected.commandId,
                        domain: 'spawn',
                        code: 'registry-capacity'
                    });
                    consumed.add(rejected.commandId);
                }
                result.state = 'committed-with-rejections';
                this.telemetry.capacityRejected += sourceCommands.length;
                registryRejectedSourceCommands = true;
                break;
            }
            reservations.push({ command, handle });
        }
        if (controls.length === 0 && reservations.length === 0) {
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        const plan = {
            targetFixedTick: tick,
            controls: controls.map((command) => command.payload),
            sourceRelativeSpawns: reservations.map(({ command, handle }) => ({
                sourceHandle: command.payload.sourceHandle,
                destinationHandle: handle,
                destinationSpawn: command.payload.destinationSpawn,
                modeFlags: command.payload.modeFlags,
                positionOffset: command.payload.positionOffset,
                ...(command.payload.modeFlags
                    === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY
                    ? {
                        targetHandle: command.payload.targetHandle,
                        targetOffset: command.payload.targetOffset,
                        launchSpeed: command.payload.launchSpeed
                    }
                    : command.payload.modeFlags
                        === GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT
                        ? {
                            aimWorldPoint: command.payload.aimWorldPoint,
                            launchSpeed: command.payload.launchSpeed
                        }
                        : {
                            launchVelocity: command.payload.launchVelocity,
                            sourceVelocityScale: command.payload.sourceVelocityScale
                        })
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
                domain: commandDomain(due[0]),
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
                domain: commandDomain(due[0]),
                code: backendResult?.reason ?? 'fixed-program-recovery'
            });
            this.recoveryRequired = true;
            this.#consume(new Set(due.map((command) => command.commandId)));
            return this.#saveResult(result);
        }

        const controlDomain = normalizeBackendDomainResult(
            backendResult,
            'controls',
            controls.length,
            expectedAccepted
        );
        const spawnDomain = normalizeBackendDomainResult(
            backendResult,
            'sourceRelativeSpawns',
            reservations.length,
            expectedAccepted
        );
        const controlContractValid = controlDomain.accepted === controls.length
            && controlDomain.rejected === 0;
        const spawnAccepted = spawnDomain.accepted === reservations.length
            && spawnDomain.rejected === 0;
        const spawnNormallyRejected = reservations.length > 0
            && spawnDomain.accepted === 0
            && spawnDomain.rejected === reservations.length
            && NORMAL_SPAWN_REJECTION_CODES.has(spawnDomain.reason);
        if (!controlContractValid || (!spawnAccepted && !spawnNormallyRejected)) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            for (const command of controls) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: 'control',
                    code: controlDomain.reason ?? 'fixed-program-control-rejected'
                });
                consumed.add(command.commandId);
            }
            for (const command of sourceCommands) {
                result.rejected.push({
                    commandId: command.commandId,
                    domain: 'spawn',
                    code: spawnDomain.reason ?? 'fixed-program-spawn-contract'
                });
                consumed.add(command.commandId);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.protocolFailure = Object.freeze({
                stage: 'fixed-command-domain',
                code: !controlContractValid
                    ? 'control-domain-rejected'
                    : 'spawn-domain-partial',
                message: 'fixed program backend의 domain별 acceptance 계약이 깨졌습니다.'
            });
            this.recoveryRequired = true;
            this.#consume(consumed);
            return this.#saveResult(result);
        }

        if (spawnNormallyRejected) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
                result.rejected.push({
                    commandId: reservation.command.commandId,
                    domain: 'spawn',
                    code: spawnDomain.reason ?? 'fixed-program-spawn-rejected'
                });
                consumed.add(reservation.command.commandId);
            }
            if (spawnDomain.reason?.includes('capacity')) {
                this.telemetry.capacityRejected += reservations.length;
            }
            reservations.length = 0;
            result.state = 'committed-with-rejections';
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
        if (registryRejectedSourceCommands || result.rejected.length > 0) {
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
            controlCapacity: this.controlCommandCapacity,
            sourceRelativeSpawnCapacity: this.sourceRelativeSpawnCommandCapacity,
            pendingCommandCount: this.pendingCount,
            pendingControlCount: this.pendingControlCount,
            pendingSourceRelativeSpawnCount: this.pendingSourceRelativeSpawnCount,
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
        this.pendingControlCount = 0;
        this.pendingSourceRelativeSpawnCount = 0;
        this.knownCommands.clear();
        this.controlTargetKeys.clear();
        this.spawnCompletionScratch.length = 0;
        this.destroyed = true;
    }

    #enqueue(command, fingerprint) {
        this.#evictCompletedHistoryForInsert();
        const domainCount = command.type === 'control'
            ? this.pendingControlCount
            : this.pendingSourceRelativeSpawnCount;
        const domainCapacity = command.type === 'control'
            ? this.controlCommandCapacity
            : this.sourceRelativeSpawnCommandCapacity;
        const commandCapacityExceeded = this.usesSharedCommandCapacity
            ? this.pendingCount >= this.commandCapacity
            : domainCount >= domainCapacity;
        if (commandCapacityExceeded
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
        if (command.type === 'control') {
            this.pendingControlCount++;
        } else {
            this.pendingSourceRelativeSpawnCount++;
        }
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
            if (command.type === 'control') {
                this.pendingControlCount--;
            } else {
                this.pendingSourceRelativeSpawnCount--;
            }
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
