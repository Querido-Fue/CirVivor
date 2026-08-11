import {
    createGpuRegistryMetadata,
    materializeGpuPlainDataSnapshot,
    normalizeGpuSpawnIntent
} from '../gpu_spawn_intent.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID,
    assertEnemyLifecycleDisposition,
    isEnemyDispositionBountyEligible
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import {
    createFormationLineageHash
} from '../../contract/enemy_formation_contract.js';
import {
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability,
    normalizeEnemyCapabilityMask
} from '../../contract/enemy_capability_contract.js';
import {
    ENEMY_ORBIT_SLOT_UNASSIGNED,
    hasAnyEnemyOrbitLeaseMetadata,
    normalizeEnemyOrbitSlotLease
} from '../../contract/enemy_orbit_directional_defense_contract.js';
import {
    createGpuPrivateHexaTransformDestinationIntent,
    materializeNaturalHexaFormationActivation,
    normalizeGpuPrivateHexaTransformDestinationIntent
} from './gpu_enemy_spawn_adapter.js';
import {
    BASIC_HEXA_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_hexa_enemy_data.js';
import {
    BASIC_OCTA_ENEMY_CAPABILITY_MASK,
    BASIC_OCTA_ENEMY_DEFINITION_ID,
    BASIC_OCTA_ORBIT_SLOT_CAPACITY,
    BASIC_OCTA_ORBIT_SLOT_FILL_ORDER
} from 'data/object/enemy/basic_octa_enemy_data.js';
import {
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} from '../../physics/gpu/gpu_circle_body_abi.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_HISTORY_CAPACITY = 65536;
export const ENEMY_ORBIT_SLOT_CAPACITY_REJECTION_CODE = 'orbit-slot-capacity';
export const ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE = (
    'orbit-slot-metadata-corruption'
);
// 외부 options/reason이나 reflection으로 재현할 수 없는 command identity marker입니다.
// fixed commit payload에는 노출하지 않고 terminal close의 보존 여부만 지배합니다.
const AUTHENTIC_TERMINAL_CLEANUP_COMMANDS = new WeakSet();
const PRIVILEGED_TRANSFORM_DISPOSITIONS = new Set([
    ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED,
    ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
]);
const SELECTED_TARGET_PROJECTILE_PRIVATE_FIELDS = Object.freeze([
    'targetSelectionPolicyId',
    'distancePolicyId',
    'attackRangeTiles',
    'towerTargetPolicyId',
    'coreTargetPolicyId',
    'coreDamageRequestPolicyId',
    'coreDamage',
    'coreDamageFixedPoint',
    'requiresExactSelectedTarget',
    'coreTargetEntityId',
    'coreTargetIncarnation',
    'towerTargetEntityId',
    'towerTargetIncarnation',
    'selectedTargetKind',
    'selectedTargetEntityId',
    'selectedTargetIncarnation',
    'selectedTargetPolicyId',
    'selectionSourceTick',
    'selectionSequence',
    'attackFingerprint'
]);

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

function compareHandles(left, right) {
    return left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function createOrbitSlotMetadataCorruption(message) {
    const error = new Error(message);
    error.code = ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE;
    return error;
}

function requireNaturalOctaOrbitIntent(intent, label, options = {}) {
    const isOctaDefinition = intent?.kindId === 'enemy'
        && intent.definitionId === BASIC_OCTA_ENEMY_DEFINITION_ID;
    const isOctaEnemyDefinitionAlias = intent?.enemyDefinitionId
        === BASIC_OCTA_ENEMY_DEFINITION_ID;
    const capabilityMask = intent?.capabilityMask === undefined
        || intent.capabilityMask === null
        ? null
        : normalizeEnemyCapabilityMask(
            intent.capabilityMask,
            `${label}.capabilityMask`
        );
    const hasOrbit = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.ORBIT,
            `${label}.capabilityMask`
        );
    const hasLease = hasAnyEnemyOrbitLeaseMetadata(intent);
    const hasOrbitBehaviorProgram = intent?.enemyBehaviorState?.programId
        === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT;
    const requireBehaviorProgram = options.requireBehaviorProgram !== false;
    if (isOctaDefinition !== isOctaEnemyDefinitionAlias
        || isOctaDefinition !== hasOrbit
        || isOctaDefinition !== hasLease
        || (requireBehaviorProgram
            && isOctaDefinition !== hasOrbitBehaviorProgram)
        || (hasOrbit && capabilityMask !== BASIC_OCTA_ENEMY_CAPABILITY_MASK)) {
        throw createOrbitSlotMetadataCorruption(
            `${label}의 O definition/capability/lease/program이 exact contract와 다릅니다.`
        );
    }
    return isOctaDefinition;
}

function materializeNaturalOctaOrbitActivation(intent, orbitSlotIndex) {
    const lease = normalizeEnemyOrbitSlotLease(intent, {
        label: 'natural O raw orbit lease',
        allowUnassigned: true,
        expectedSlotCapacity: BASIC_OCTA_ORBIT_SLOT_CAPACITY
    });
    const behaviorState = intent.enemyBehaviorState;
    if (lease.orbitSlotIndex !== ENEMY_ORBIT_SLOT_UNASSIGNED
        || !behaviorState
        || typeof behaviorState !== 'object'
        || Array.isArray(behaviorState)
        || behaviorState.programId
            !== GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT
        || behaviorState.orbitSlotIndex !== ENEMY_ORBIT_SLOT_UNASSIGNED
        || behaviorState.orbitSlotCapacity !== BASIC_OCTA_ORBIT_SLOT_CAPACITY
        || behaviorState.coordinateSystemCode
            !== lease.orbitCoordinateSystemCode) {
        throw createOrbitSlotMetadataCorruption(
            'natural O raw lease/behavior sentinel가 exact contract와 다릅니다.'
        );
    }
    const materialized = Object.freeze({
        ...intent,
        orbitSlotIndex,
        enemyBehaviorState: Object.freeze({
            ...behaviorState,
            orbitSlotIndex
        })
    });
    // Reservation/backend mutation 전 registry metadata 경계까지 미리 검증합니다.
    createRegistryMetadata(materialized);
    return materialized;
}

function assertAtomicTransformTransactionPort(source) {
    const methods = [
        'armPreparedFormationTransformBatch',
        'commitArmedFormationTransformBatch',
        'cancelArmedFormationTransformBatch'
    ];
    if (!source || typeof source !== 'object') {
        throw new TypeError('atomic transform transaction port가 필요합니다.');
    }
    for (const method of methods) {
        if (typeof source[method] !== 'function') {
            throw new TypeError(`atomic transform transaction port.${method}()가 필요합니다.`);
        }
    }
    return source;
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

export function normalizeSpawnIntent(source) {
    const intent = normalizeGpuSpawnIntent(source);
    const selectedOnlyField = SELECTED_TARGET_PROJECTILE_PRIVATE_FIELDS.find(
        (field) => Object.prototype.hasOwnProperty.call(intent, field)
    );
    const hasCoreDamageRequest = (
        intent.contactHandler?.flags
        & GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CORE_DAMAGE_REQUEST
    ) !== 0;
    const hasSelectedTargetProgram = intent.enemyBehaviorState?.programId
        === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE;
    if (hasCoreDamageRequest || hasSelectedTargetProgram || selectedOnlyField) {
        throw new RangeError(
            'selected-target projectile는 requestSelectedTargetSpawn 전용 ingress입니다.'
        );
    }
    return intent;
}
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
    #atomicTransformAuthority;
    #atomicTransformRegistryAuthority;
    #atomicTransformTransactionPort;
    #authoredFormationProvenanceLedger;

    /**
     * @param {object} backend - EnemySimulationBackend public port입니다.
     * @param {object} registry - WorldRegistry입니다.
     * @param {{commandHistoryCapacity?:number,terminalCleanupAuthority?:object|null,atomicTransformAuthority?:object|null,atomicTransformRegistryAuthority?:object|null,atomicTransformTransactionPort?:object|null}} [options={}] - 중복 command 억제 범위와 비공개 privileged authority입니다.
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
        const atomicTransformAuthority = options.atomicTransformAuthority ?? null;
        if (atomicTransformAuthority !== null
            && typeof atomicTransformAuthority?.consumePermit !== 'function') {
            throw new TypeError(
                'atomicTransformAuthority.consumePermit()가 필요합니다.'
            );
        }
        this.#atomicTransformAuthority = atomicTransformAuthority;
        const atomicTransformRegistryAuthority
            = options.atomicTransformRegistryAuthority ?? null;
        if (atomicTransformRegistryAuthority !== null
            && typeof atomicTransformRegistryAuthority !== 'object') {
            throw new TypeError(
                'atomicTransformRegistryAuthority는 opaque object여야 합니다.'
            );
        }
        this.#atomicTransformRegistryAuthority
            = atomicTransformRegistryAuthority;
        const atomicTransformTransactionPort
            = options.atomicTransformTransactionPort ?? null;
        const configuredAtomicOptionCount = [
            atomicTransformAuthority,
            atomicTransformRegistryAuthority,
            atomicTransformTransactionPort
        ].filter((value) => value !== null).length;
        if (configuredAtomicOptionCount !== 0
            && configuredAtomicOptionCount !== 3) {
            throw new TypeError(
                'atomic transform authority/registry authority/transaction port는 함께 필요합니다.'
            );
        }
        if (configuredAtomicOptionCount === 3) {
            const atomicRegistryMethods = [
                'preflightAtomicTransformBatch',
                'commitAtomicTransformBatch',
                'cancelAtomicTransformBatch'
            ];
            for (const method of atomicRegistryMethods) {
                if (typeof this.registry?.[method] !== 'function') {
                    throw new TypeError(
                        `EnemyLifecycle atomic registry.${method}()가 필요합니다.`
                    );
                }
            }
            this.#atomicTransformTransactionPort
                = assertAtomicTransformTransactionPort(
                    atomicTransformTransactionPort
                );
        } else {
            this.#atomicTransformTransactionPort = null;
        }
        this.pendingCommands = [];
        this.knownCommandIds = new Set();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.pendingDespawnKeys = new Set();
        this.pendingAtomicTransformSourceKeys = new Set();
        this.#authoredFormationProvenanceLedger = new Map();
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
        const provenancePlan = this.#preflightAuthoredFormationProvenance([
            normalizedIntent
        ]);
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
        this.#commitAuthoredFormationProvenance(provenancePlan);
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

        const provenancePlan = this.#preflightAuthoredFormationProvenance(
            commands.map(({ intent }) => intent)
        );

        for (const command of commands) {
            this.knownCommandIds.add(command.commandId);
        }
        this.pendingCommands.push(...commands);
        this.nextCommandSequence += commands.length;
        this.#commitAuthoredFormationProvenance(provenancePlan);
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
        if (disposition !== null
            && PRIVILEGED_TRANSFORM_DISPOSITIONS.has(disposition)) {
            return Object.freeze({
                accepted: false,
                reason: 'privileged-transform-disposition-required'
            });
        }
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
     * Formation owner만 사용할 수 있는 whole-tick atomic transform ingress입니다.
     * public lifecycle caller가 permit/transaction port를 위조할 수 없으며, source slot은
     * 이 경계에 노출되지 않습니다.
     */
    requestAtomicTransformBatch(
        request,
        targetFixedTick,
        commandId,
        atomicTransformPermit
    ) {
        this.#assertUsable();
        if (!this.ingressOpen) {
            return this.#rejectClosedIngress();
        }
        if (this.#atomicTransformAuthority?.consumePermit(
            atomicTransformPermit
        ) !== true) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-permit-invalid'
            });
        }
        if (this.#atomicTransformTransactionPort === null) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-runtime-unconfigured'
            });
        }
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const prepareSourceTick = requirePositiveSafeInteger(
            request?.prepareSourceTick,
            'prepareSourceTick'
        );
        const batchIdFingerprint = requirePositiveSafeInteger(
            request?.batchIdFingerprint,
            'batchIdFingerprint'
        );
        if (tick !== prepareSourceTick + 1) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-publication-deadline'
            });
        }
        if (!request || typeof request !== 'object'
            || !Array.isArray(request.records)
            || request.records.length === 0) {
            throw new TypeError('atomic transform batch records가 필요합니다.');
        }
        const batchSourceKeys = new Set();
        const records = request.records.map((record, index) => {
            if (!record || typeof record !== 'object'
                || !Array.isArray(record.sourceHandles)
                || record.sourceHandles.length !== 2) {
                throw new TypeError(
                    `atomic transform records[${index}] sourceHandles가 필요합니다.`
                );
            }
            const sourceHandles = record.sourceHandles.map((handle, sourceIndex) => (
                normalizeHandle(
                    handle,
                    `records[${index}].sourceHandles[${sourceIndex}]`
                )
            ));
            if (compareHandles(sourceHandles[0], sourceHandles[1]) >= 0) {
                throw new RangeError('atomic transform sourceHandles는 exact ASC여야 합니다.');
            }
            if (!Array.isArray(record.sourceLineages)
                || record.sourceLineages.length !== 2) {
                throw new TypeError(
                    `atomic transform records[${index}] sourceLineages가 필요합니다.`
                );
            }
            const sourceLineages = record.sourceLineages.map((lineage, sourceIndex) => {
                if (!Array.isArray(lineage)
                    || lineage.length === 0
                    || lineage.length > 6) {
                    throw new TypeError(
                        `records[${index}].sourceLineages[${sourceIndex}]가 bounded exact 배열이어야 합니다.`
                    );
                }
                const normalized = lineage.map((handle, memberIndex) => normalizeHandle(
                    handle,
                    `records[${index}].sourceLineages[${sourceIndex}][${memberIndex}]`
                )).sort(compareHandles);
                for (let memberIndex = 1;
                    memberIndex < normalized.length;
                    memberIndex++) {
                    if (handleKey(normalized[memberIndex - 1])
                        === handleKey(normalized[memberIndex])) {
                        throw new RangeError('atomic transform source lineage가 중복되었습니다.');
                    }
                }
                return Object.freeze(normalized);
            });
            if (sourceHandles[0].entityId === sourceHandles[1].entityId) {
                throw new RangeError('atomic transform source는 서로 달라야 합니다.');
            }
            for (const handle of sourceHandles) {
                const key = handleKey(handle);
                if (batchSourceKeys.has(key)
                    || this.pendingAtomicTransformSourceKeys.has(key)) {
                    throw new RangeError('atomic transform source가 중복되었습니다.');
                }
                batchSourceKeys.add(key);
            }
            const destinationDescriptor
                = normalizeGpuPrivateHexaTransformDestinationIntent(
                    materializeGpuPlainDataSnapshot(
                        record.destinationDescriptor,
                        `records[${index}].destinationDescriptor`
                    )
                );
            const disposition = assertEnemyLifecycleDisposition(
                record.disposition
            );
            if (!PRIVILEGED_TRANSFORM_DISPOSITIONS.has(disposition)) {
                throw new RangeError(
                    `records[${index}].disposition은 transform 전용 값이어야 합니다.`
                );
            }
            return {
                sourceHandles: Object.freeze(sourceHandles),
                sourceLineages: Object.freeze(sourceLineages),
                destinationDescriptor,
                disposition,
                childCommandIds: null
            };
        });
        const sequence = this.nextCommandSequence;
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
            throw new RangeError('atomic transform command sequence 공간이 고갈되었습니다.');
        }
        const normalizedCommandId = this.#normalizeCommandId(commandId, sequence);
        const ownedCommandIds = [normalizedCommandId];
        for (let index = 0; index < records.length; index++) {
            const childCommandIds = Object.freeze({
                spawn: `${normalizedCommandId}:transform:${index}:spawn`,
                sourceA: `${normalizedCommandId}:transform:${index}:source:0`,
                sourceB: `${normalizedCommandId}:transform:${index}:source:1`
            });
            records[index].childCommandIds = childCommandIds;
            ownedCommandIds.push(
                childCommandIds.spawn,
                childCommandIds.sourceA,
                childCommandIds.sourceB
            );
        }
        const batchCommandIds = new Set(ownedCommandIds);
        if (batchCommandIds.size !== ownedCommandIds.length
            || ownedCommandIds.some((id) => this.knownCommandIds.has(id))) {
            return Object.freeze({ accepted: false, reason: 'duplicate-command' });
        }
        for (const id of ownedCommandIds) {
            this.knownCommandIds.add(id);
        }
        this.nextCommandSequence++;
        const command = Object.freeze({
            type: 'atomic-transform-batch',
            commandId: normalizedCommandId,
            ownedCommandIds: Object.freeze(ownedCommandIds),
            targetFixedTick: tick,
            sequence,
            prepareSourceTick,
            batchIdFingerprint,
            records: Object.freeze(records.map(Object.freeze)),
            transactionPort: this.#atomicTransformTransactionPort
        });
        this.pendingCommands.push(command);
        for (const key of batchSourceKeys) {
            this.pendingAtomicTransformSourceKeys.add(key);
        }
        return Object.freeze({
            accepted: true,
            commandId: normalizedCommandId,
            targetFixedTick: tick,
            transformCount: records.length
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
        const consumedCommandIds = new Set();

        if (this.recoveryRequired) {
            baseResult.state = 'failed';
            baseResult.recoveryRequired = true;
            return this.#saveResult(baseResult);
        }

        const dueCommands = [];
        for (const command of this.pendingCommands) {
            if (command.targetFixedTick < tick) {
                if (command.type === 'atomic-transform-batch') {
                    baseResult.rejected.push({
                        commandId: command.commandId,
                        code: 'atomic-transform-publication-deadline'
                    });
                    consumedCommandIds.add(command.commandId);
                    continue;
                }
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
        this.#consumeCommands(consumedCommandIds);
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

        const despawnCommands = dueCommands.filter((command) => command.type === 'despawn');
        const spawnCommands = dueCommands.filter((command) => command.type === 'spawn');
        const atomicTransformCommands = dueCommands.filter(
            (command) => command.type === 'atomic-transform-batch'
        );

        const despawnOutcome = this.#commitDespawns(
            despawnCommands,
            baseResult,
            consumedCommandIds
        );
        if (despawnOutcome === 'recovery') {
            this.#consumeCommands(consumedCommandIds);
            return this.#saveResult(baseResult);
        }

        const transformOutcome = this.#commitAtomicTransforms(
            atomicTransformCommands,
            baseResult,
            consumedCommandIds
        );
        if (transformOutcome === 'recovery') {
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
        this.pendingAtomicTransformSourceKeys.clear();
        for (const command of commands) {
            this.#rememberCompletedCommandIds(command);
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
        this.#atomicTransformAuthority = null;
        this.#atomicTransformRegistryAuthority = null;
        this.#atomicTransformTransactionPort = null;
        this.#authoredFormationProvenanceLedger.clear();
        this.lastCommitResult = null;
    }

    #preflightAuthoredFormationProvenance(intents) {
        const plans = new Map();
        for (let index = 0; index < intents.length; index++) {
            const intent = intents[index];
            if (intent?.formationGroupId === undefined
                || intent.formationGroupId === null) {
                continue;
            }
            const waveId = requireNonEmptyString(
                intent.waveId,
                `intents[${index}].waveId`
            );
            const formationGroupId = requireNonEmptyString(
                intent.formationGroupId,
                `intents[${index}].formationGroupId`
            );
            const key = JSON.stringify([waveId, formationGroupId]);
            let plan = plans.get(key);
            if (!plan) {
                const existing = this.#authoredFormationProvenanceLedger.get(key);
                plan = existing
                    ? {
                        key,
                        waveId: existing.waveId,
                        formationGroupId: existing.formationGroupId,
                        formationAuthoredCoordinateSystemId:
                            existing.formationAuthoredCoordinateSystemId,
                        formationAuthoredMemberCount:
                            existing.formationAuthoredMemberCount,
                        formationRows: existing.formationRows,
                        formationColumns: existing.formationColumns,
                        formationAuthoredOccupiedSlotMask:
                            existing.formationAuthoredOccupiedSlotMask,
                        memberIndices: new Set(existing.memberIndices),
                        memberSlotIndices: new Set(existing.memberSlotIndices),
                        coordinateKeys: new Set(existing.coordinateKeys)
                    }
                    : {
                        key,
                        waveId,
                        formationGroupId,
                        formationAuthoredCoordinateSystemId:
                            intent.formationAuthoredCoordinateSystemId,
                        formationAuthoredMemberCount:
                            intent.formationAuthoredMemberCount,
                        formationRows: intent.formationRows,
                        formationColumns: intent.formationColumns,
                        formationAuthoredOccupiedSlotMask:
                            intent.formationAuthoredOccupiedSlotMask,
                        memberIndices: new Set(),
                        memberSlotIndices: new Set(),
                        coordinateKeys: new Set()
                    };
                plans.set(key, plan);
            }
            for (const field of [
                'waveId',
                'formationGroupId',
                'formationAuthoredCoordinateSystemId',
                'formationAuthoredMemberCount',
                'formationRows',
                'formationColumns',
                'formationAuthoredOccupiedSlotMask'
            ]) {
                if (plan[field] !== intent[field]) {
                    throw new RangeError(
                        `authored Formation group ${key}의 ${field}가 기존 provenance와 다릅니다.`
                    );
                }
            }
            const memberIndex = Number(intent.formationMemberIndex);
            const memberSlotIndex = Number(intent.formationMemberSlotIndex);
            const rowIndex = Number(intent.formationRowIndex);
            const columnIndex = Number(intent.formationColumnIndex);
            const coordinateKey = `${rowIndex}:${columnIndex}`;
            if (plan.memberIndices.has(memberIndex)
                || plan.memberSlotIndices.has(memberSlotIndex)
                || plan.coordinateKeys.has(coordinateKey)) {
                throw new RangeError(
                    `authored Formation group ${key}에 member/slot/coordinate 중복이 있습니다.`
                );
            }
            plan.memberIndices.add(memberIndex);
            plan.memberSlotIndices.add(memberSlotIndex);
            plan.coordinateKeys.add(coordinateKey);
        }
        const resultingKeyCount = new Set([
            ...this.#authoredFormationProvenanceLedger.keys(),
            ...plans.keys()
        ]).size;
        if (resultingKeyCount > this.commandHistoryCapacity) {
            throw new RangeError('authored Formation provenance ledger capacity를 초과했습니다.');
        }
        return plans;
    }

    #commitAuthoredFormationProvenance(plans) {
        for (const [key, plan] of plans) {
            this.#authoredFormationProvenanceLedger.set(key, Object.freeze({
                key,
                waveId: plan.waveId,
                formationGroupId: plan.formationGroupId,
                formationAuthoredCoordinateSystemId:
                    plan.formationAuthoredCoordinateSystemId,
                formationAuthoredMemberCount: plan.formationAuthoredMemberCount,
                formationRows: plan.formationRows,
                formationColumns: plan.formationColumns,
                formationAuthoredOccupiedSlotMask:
                    plan.formationAuthoredOccupiedSlotMask,
                memberIndices: Object.freeze([...plan.memberIndices]),
                memberSlotIndices: Object.freeze([...plan.memberSlotIndices]),
                coordinateKeys: Object.freeze([...plan.coordinateKeys])
            }));
        }
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

    #commitAtomicTransforms(commands, result, consumedCommandIds) {
        if (commands.length === 0) {
            return 'complete';
        }
        if (commands.length !== 1) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: commands[0].commandId,
                code: 'multiple-atomic-transform-batches'
            });
            return 'recovery';
        }
        const command = commands[0];
        if (command.targetFixedTick !== command.prepareSourceTick + 1) {
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-publication-deadline'
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        for (const record of command.records) {
            for (const handle of record.sourceHandles) {
                const registryHas = this.registry.has(handle);
                const backendHas = this.backend.hasBody(handle);
                if (!registryHas && !backendHas) {
                    result.rejected.push({
                        commandId: command.commandId,
                        code: 'atomic-transform-source-consumed'
                    });
                    consumedCommandIds.add(command.commandId);
                    return 'complete';
                }
                if (registryHas !== backendHas) {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: command.commandId,
                        code: 'atomic-transform-registry-backend-desync'
                    });
                    return 'recovery';
                }
            }
        }
        const materializedRecords = [];
        let transforms;
        try {
            transforms = command.records.map((record, index) => {
                const rootHandle = record.sourceHandles[0];
                const sourceViews = record.sourceHandles.map((handle) => (
                    this.registry.copyEntityView(handle, {})
                ));
                const sourceRootView = sourceViews[0];
                if (sourceViews.some((view) => !view)) {
                    throw new Error(
                        `atomic transform source view가 없습니다: ${index}`
                    );
                }
                const sourceMemberCount = sourceViews.reduce((sum, view) => (
                    sum + Number(view.metadata?.formationMemberCount)
                ), 0);
                const sourceGeneration = Math.max(...sourceViews.map((view) => (
                    Number(view.metadata?.formationGeneration)
                )));
                for (let sourceIndex = 0;
                    sourceIndex < sourceViews.length;
                    sourceIndex++) {
                    const metadata = sourceViews[sourceIndex].metadata;
                    const lineage = record.sourceLineages[sourceIndex];
                    if (Number(metadata?.formationMemberCount) !== lineage.length
                        || Number(metadata?.formationLineageHash)
                            !== createFormationLineageHash(lineage)) {
                        throw new RangeError(
                            `atomic transform source lineage가 registry metadata와 다릅니다: ${index}/${sourceIndex}`
                        );
                    }
                }
                const combinedLineage = record.sourceLineages
                    .flat()
                    .sort(compareHandles);
                for (let memberIndex = 1;
                    memberIndex < combinedLineage.length;
                    memberIndex++) {
                    if (handleKey(combinedLineage[memberIndex - 1])
                        === handleKey(combinedLineage[memberIndex])) {
                        throw new RangeError(
                            `atomic transform combined lineage가 중복되었습니다: ${index}`
                        );
                    }
                }
                if (sourceMemberCount !== record.destinationDescriptor.memberCount
                    || combinedLineage.length !== sourceMemberCount
                    || createFormationLineageHash(combinedLineage)
                        !== record.destinationDescriptor.formationLineageHash
                    || sourceGeneration + 1
                        !== record.destinationDescriptor.formationGeneration
                    || record.disposition !== (
                        sourceMemberCount === 6
                            ? ENEMY_LIFECYCLE_DISPOSITION_ID.TRANSFORM_CONSUMED
                            : ENEMY_LIFECYCLE_DISPOSITION_ID.MERGE_CONSUMED
                    )) {
                    throw new RangeError(
                        `atomic transform source/destination Formation facts가 다릅니다: ${index}`
                    );
                }
                // Both sources must independently satisfy the canonical n-table and
                // immutable Core/bounty/Tower-contact metadata contract. The helper
                // is also the single private transform catalog validator.
                for (let sourceIndex = 0;
                    sourceIndex < sourceViews.length;
                    sourceIndex++) {
                    const sourceHandle = record.sourceHandles[sourceIndex];
                    createGpuPrivateHexaTransformDestinationIntent({
                        ...record.destinationDescriptor,
                        sourceRootView: sourceViews[sourceIndex],
                        destinationHandle: {
                            entityId: sourceHandle.entityId,
                            incarnation: sourceHandle.incarnation + 1
                        }
                    });
                }
                const destinationHandle = Object.freeze({
                    entityId: rootHandle.entityId,
                    incarnation: rootHandle.incarnation + 1
                });
                const destinationIntent
                    = createGpuPrivateHexaTransformDestinationIntent({
                        ...record.destinationDescriptor,
                        sourceRootView,
                        destinationHandle
                    });
                materializedRecords.push(Object.freeze({
                    ...record,
                    destinationHandle,
                    destinationIntent
                }));
                return {
                    sourceHandles: record.sourceHandles,
                    destination: {
                        kindId: destinationIntent.kindId,
                        definitionId: destinationIntent.definitionId,
                        createdAtTick: command.targetFixedTick,
                        metadata: createRegistryMetadata(destinationIntent)
                    }
                };
            });
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-destination-materialization',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        let preflight;
        try {
            preflight = this.registry.preflightAtomicTransformBatch({
                transforms
            }, this.#atomicTransformRegistryAuthority);
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-registry-preflight-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (!preflight) {
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-preflight-stale'
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        const armRecords = materializedRecords.map((record, index) => Object.freeze({
            sourceHandles: record.sourceHandles,
            destinationHandle: preflight.transforms[index].destinationHandle,
            destinationIntent: record.destinationIntent,
            disposition: record.disposition
        }));
        if (armRecords.some((record) => (
            record.destinationHandle.entityId
                !== record.destinationIntent.destinationEntityId
            || record.destinationHandle.incarnation
                !== record.destinationIntent.destinationIncarnation
        ))) {
            this.registry.cancelAtomicTransformBatch(
                preflight.token,
                this.#atomicTransformRegistryAuthority
            );
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-destination-identity-mismatch'
            });
            return 'recovery';
        }
        let armed;
        try {
            armed = command.transactionPort.armPreparedFormationTransformBatch(
                Object.freeze({
                    commandId: command.commandId,
                    batchIdFingerprint: command.batchIdFingerprint,
                    prepareSourceTick: command.prepareSourceTick,
                    targetFixedTick: command.targetFixedTick,
                    registryRevision: preflight.registryRevision,
                    records: Object.freeze(armRecords)
                })
            );
        } catch (error) {
            this.registry.cancelAtomicTransformBatch(
                preflight.token,
                this.#atomicTransformRegistryAuthority
            );
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-arm-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (armed?.accepted !== true || !armed.receipt) {
            this.registry.cancelAtomicTransformBatch(
                preflight.token,
                this.#atomicTransformRegistryAuthority
            );
            result.state = armed?.requiresRecovery === true ? 'failed' : result.state;
            result.recoveryRequired = armed?.requiresRecovery === true;
            result.rejected.push({
                commandId: command.commandId,
                code: armed?.reason ?? 'atomic-transform-arm-rejected'
            });
            consumedCommandIds.add(command.commandId);
            return result.recoveryRequired ? 'recovery' : 'complete';
        }
        const registryCommit = this.registry.commitAtomicTransformBatch(
            preflight.token,
            this.#atomicTransformRegistryAuthority
        );
        if (!registryCommit) {
            try {
                command.transactionPort.cancelArmedFormationTransformBatch(
                    armed.receipt,
                    'registry-commit-failed'
                );
            } catch {
                // owner/backend recovery evidence가 아래 hard failure에 포함됩니다.
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-registry-commit-failed'
            });
            return 'recovery';
        }
        let committed;
        try {
            committed = command.transactionPort.commitArmedFormationTransformBatch(
                armed.receipt
            );
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-backend-commit-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (committed?.accepted !== true) {
            // CPU publication 뒤에는 rollback하지 않습니다. replacement recovery만 허용합니다.
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: committed?.reason ?? 'atomic-transform-backend-commit-failed'
            });
            return 'recovery';
        }
        for (let index = 0; index < command.records.length; index++) {
            const record = command.records[index];
            const destinationHandle
                = registryCommit.transforms[index].destinationHandle;
            result.spawned.push({
                commandId: record.childCommandIds.spawn,
                parentCommandId: command.commandId,
                handle: destinationHandle,
                transform: true
            });
            for (let sourceIndex = 0;
                sourceIndex < record.sourceHandles.length;
                sourceIndex++) {
                const sourceHandle = record.sourceHandles[sourceIndex];
                result.despawned.push({
                    commandId: sourceIndex === 0
                        ? record.childCommandIds.sourceA
                        : record.childCommandIds.sourceB,
                    parentCommandId: command.commandId,
                    handle: sourceHandle,
                    reason: 'formation-transform',
                    disposition: record.disposition,
                    bountyEligible: false,
                    transformedInto: destinationHandle
                });
            }
        }
        consumedCommandIds.add(command.commandId);
        return 'complete';
    }

    #preflightOrbitSpawnActivations(commands) {
        const orbitCommands = [];
        for (let index = 0; index < commands.length; index++) {
            const command = commands[index];
            if (requireNaturalOctaOrbitIntent(
                command.intent,
                `spawnCommands[${index}].intent`
            )) {
                orbitCommands.push(command);
            }
        }
        if (orbitCommands.length === 0) {
            return Object.freeze({
                capacityExceeded: false,
                activationIntentByCommandId: new Map()
            });
        }
        if (typeof this.registry.copyActiveHandlesInto !== 'function'
            || typeof this.registry.copyEntityView !== 'function') {
            throw createOrbitSlotMetadataCorruption(
                'WorldRegistry orbit lease snapshot port가 필요합니다.'
            );
        }

        const activeEnemyHandles = [];
        this.registry.copyActiveHandlesInto(activeEnemyHandles, {
            kindId: 'enemy'
        });
        activeEnemyHandles.sort(compareHandles);
        const occupiedSlots = new Set();
        for (let index = 0; index < activeEnemyHandles.length; index++) {
            const handle = activeEnemyHandles[index];
            const view = this.registry.copyEntityView(handle, {});
            if (!view || view.kindId !== 'enemy') {
                throw createOrbitSlotMetadataCorruption(
                    `active Enemy registry view가 유실되었습니다: ${handleKey(handle)}`
                );
            }
            const metadata = view.metadata;
            if (metadata?.definitionId !== view.definitionId
                || metadata?.enemyDefinitionId !== view.definitionId) {
                throw createOrbitSlotMetadataCorruption(
                    `active Enemy registry definition alias가 다릅니다: ${handleKey(handle)}`
                );
            }
            const activeDescriptor = {
                ...(metadata ?? {}),
                kindId: view.kindId,
                definitionId: view.definitionId
            };
            const isOcta = requireNaturalOctaOrbitIntent(
                activeDescriptor,
                `activeEnemy[${index}]`,
                { requireBehaviorProgram: false }
            );
            if (!isOcta) {
                continue;
            }
            const lease = normalizeEnemyOrbitSlotLease(metadata, {
                label: `activeEnemy[${index}].metadata.orbitLease`,
                expectedSlotCapacity: BASIC_OCTA_ORBIT_SLOT_CAPACITY
            });
            if (occupiedSlots.has(lease.orbitSlotIndex)) {
                throw createOrbitSlotMetadataCorruption(
                    `active O orbit slot이 중복됩니다: ${lease.orbitSlotIndex}`
                );
            }
            occupiedSlots.add(lease.orbitSlotIndex);
        }

        if (orbitCommands.length
            > BASIC_OCTA_ORBIT_SLOT_CAPACITY - occupiedSlots.size) {
            return Object.freeze({
                capacityExceeded: true,
                activationIntentByCommandId: new Map()
            });
        }

        const activationIntentByCommandId = new Map();
        const orderedOrbitCommands = [...orbitCommands].sort((left, right) => (
            left.sequence - right.sequence
        ));
        for (const command of orderedOrbitCommands) {
            const orbitSlotIndex = BASIC_OCTA_ORBIT_SLOT_FILL_ORDER.find(
                (candidate) => !occupiedSlots.has(candidate)
            );
            if (orbitSlotIndex === undefined) {
                throw createOrbitSlotMetadataCorruption(
                    'preflighted O slot capacity와 fill order가 불일치합니다.'
                );
            }
            occupiedSlots.add(orbitSlotIndex);
            activationIntentByCommandId.set(
                command.commandId,
                materializeNaturalOctaOrbitActivation(
                    command.intent,
                    orbitSlotIndex
                )
            );
        }
        return Object.freeze({
            capacityExceeded: false,
            activationIntentByCommandId
        });
    }

    #commitSpawns(commands, result, consumedCommandIds) {
        if (commands.length === 0 || result.recoveryRequired) {
            return;
        }
        let orbitPreflight;
        try {
            orbitPreflight = this.#preflightOrbitSpawnActivations(commands);
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: commands[0].commandId,
                code: error?.code ?? ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE,
                message: String(error?.message ?? error)
            });
            return;
        }
        if (orbitPreflight.capacityExceeded) {
            for (const command of commands) {
                result.rejected.push({
                    commandId: command.commandId,
                    code: ENEMY_ORBIT_SLOT_CAPACITY_REJECTION_CODE
                });
                consumedCommandIds.add(command.commandId);
            }
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
            let activationIntent = orbitPreflight.activationIntentByCommandId
                .get(command.commandId) ?? command.intent;
            try {
                if (command.intent.kindId === 'enemy'
                    && command.intent.definitionId
                        === BASIC_HEXA_ENEMY_DEFINITION_ID) {
                    activationIntent = materializeNaturalHexaFormationActivation(
                        command.intent,
                        handle
                    );
                }
            } catch (error) {
                this.registry.cancelReservation(handle);
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'formation-activation-materialization',
                    message: String(error?.message ?? error)
                });
                result.state = 'failed';
                result.recoveryRequired = true;
                return;
            }
            reservations.push({ command, handle, activationIntent });
        }

        const bodies = reservations.map(({ activationIntent, handle }) => ({
            ...activationIntent,
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
        const { command, handle, activationIntent = command.intent } = reservation;
        const activated = this.registry.activateReserved(
            handle,
            createRegistryMetadata(activationIntent)
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
            } else if (command.type === 'atomic-transform-batch') {
                for (const record of command.records) {
                    for (const handle of record.sourceHandles) {
                        this.pendingAtomicTransformSourceKeys.delete(
                            handleKey(handle)
                        );
                    }
                }
            }
            this.#rememberCompletedCommandIds(command);
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

    #rememberCompletedCommandIds(command) {
        const ids = command.ownedCommandIds ?? [command.commandId];
        for (const commandId of ids) {
            this.#rememberCompletedCommandId(commandId);
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
