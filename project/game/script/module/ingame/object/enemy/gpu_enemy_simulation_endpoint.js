import { WorldRegistry } from '../world_registry.js';
import { GpuFixedCommandOwner } from '../gpu_fixed_command_owner.js';
import { GpuEffectCommandOwner } from './gpu_effect_command_owner.js';
import { GpuFormationCommandOwner } from './gpu_formation_command_owner.js';
import { GpuAtomicTransformCommandOwner } from './gpu_atomic_transform_command_owner.js';
import {
    ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION,
    EnemyLifecycleCommandOwner
} from './enemy_lifecycle_command_owner.js';
import { EnemySimulationBackend } from './enemy_simulation_backend.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from '../../contract/enemy_lifecycle_disposition_contract.js';
import {
    GPU_CIRCLE_APPLIED_EVENT_FLAG,
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    createEnemyCapabilityMask
} from '../../contract/enemy_capability_contract.js';
import {
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    BASIC_RHOM_BEHAVIOR_PROFILE_ID,
    BASIC_RHOM_CAPABILITY_IDS,
    BASIC_RHOM_COMBAT_PROFILE_ID,
    BASIC_RHOM_ENEMY_DEFINITION_ID,
    BASIC_RHOM_PHYSICS_PROFILE_ID
} from 'data/object/enemy/basic_rhom_enemy_data.js';
import {
    BASIC_RHOM_ATTACK_DATA
} from 'data/object/enemy/basic_rhom_attack_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA
} from 'data/object/projectile/hostile_rhom_projectile_data.js';
import {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID
} from '../core/gpu_core_proxy_spawn_adapter.js';
import {
    materializeGpuPlainDataSnapshot
} from '../gpu_spawn_intent.js';
import {
    GPU_PROJECTILE_SPAWN_MODE,
    GPU_PROJECTILE_WORLD_KIND_ID
} from '../projectile/gpu_projectile_spawn_adapter.js';
import {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID
} from '../tower/gpu_tower_spawn_adapter.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
    GPU_EFFECT_RUNTIME_ABI_VERSION,
    GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_effect_runtime_abi.js';
import {
    GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
    GPU_FORMATION_RUNTIME_ABI_VERSION,
    GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
    GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION
} from '../../physics/gpu/gpu_formation_runtime_abi.js';
import {
    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
} from 'data/object/enemy/enemy_jorang_split_runtime_data.js';
import {
    GPU_ATOMIC_TRANSFORM_PROGRAM_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
    GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION
} from '../../physics/gpu/gpu_atomic_transform_runtime_abi.js';
import {
    GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG,
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG,
    GPU_PROJECTILE_CAPTURE_TICK_STATUS
} from '../../physics/gpu/gpu_projectile_capture_runtime_abi.js';
import {
    BASIC_RING_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_ring_enemy_data.js';
import {
    RING_PROJECTILE_CAPTURE_PROFILE_ID
} from 'data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    ROUTE_AVAILABILITY_ABI_VERSION,
    ROUTE_AVAILABILITY_MAX_CORK_ROSTER
} from '../../contract/route_availability_contract.js';
import {
    GPU_ROUTE_AVAILABILITY_STATE,
    GPU_ROUTE_RUNTIME_ROLE
} from '../../physics/gpu/gpu_route_runtime_abi.js';
import {
    BASIC_CORK_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_cork_enemy_data.js';
import {
    CORK_ROUTE_CLOSURE_PROFILE_ID
} from 'data/object/enemy/enemy_route_closure_catalog_data.js';

const DEFAULT_ENEMY_CAPACITY = 16384;
const DEFAULT_EFFECT_COMMAND_CAPACITY = 256;
const DEFAULT_FORMATION_COMMAND_CAPACITY = 256;
const DEFAULT_COMPLETED_EVENT_SNAPSHOT_CAPACITY = 2048;
const DEFAULT_COMPLETED_EVENT_KEY_HISTORY_CAPACITY = 65536;
const PROJECTILE_CAPTURE_CAPACITY_REJECTION_KNOWN_FLAGS = Object.values(
    GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG
).reduce((mask, flag) => mask | flag, 0) >>> 0;
const PROJECTILE_CAPTURE_BACKEND_METHODS = Object.freeze([
    'armPreparedProjectileCaptureReleaseBatch',
    'commitArmedProjectileCaptureReleaseBatch',
    'cancelArmedProjectileCaptureReleaseBatch',
    'drainCompletedProjectileCaptureBatches',
    'drainCompletedProjectileCaptureReleaseBatches',
    'discardPreparedProjectileCaptureBatch',
    'cancelPendingProjectileCaptureProgramsForTerminal',
    'getTerminalProjectileCaptureProgramCancelStatus',
    'getProjectileCaptureRuntimeStatus',
    'registerProjectileCaptureCoreImpactReceipt',
    'getProjectileCaptureBodyState'
]);
const ROUTE_AVAILABILITY_BACKEND_METHODS = Object.freeze([
    'preflightRouteLifecycleBatch',
    'commitRouteLifecycleBatch',
    'cancelRouteLifecycleBatch',
    'resolveExactRouteBodySlot',
    'drainCompletedRouteAvailabilityBatches',
    'getRouteAvailabilityRuntimeStatus',
    'cancelPendingRouteAvailabilityProgramsForTerminal',
    'getTerminalRouteAvailabilityProgramCancelStatus',
    'getRouteLifecyclePortStatus'
]);
let nextGpuSimulationSessionGeneration = 1;
const CORE_IMPACT_CLEANUP_OPTIONS = Object.freeze({
    disposition: ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
});
const BASIC_RHOM_CAPABILITY_MASK = createEnemyCapabilityMask(
    BASIC_RHOM_CAPABILITY_IDS,
    'BASIC_RHOM_CAPABILITY_IDS'
);
const HOSTILE_RHOM_CORE_DAMAGE_FIXED_POINT = encodeGpuCircleBodyFixedPoint(
    HOSTILE_RHOM_PROJECTILE_DATA.coreDamage
);

function allocateSessionGeneration() {
    if (!Number.isSafeInteger(nextGpuSimulationSessionGeneration)) {
        throw new RangeError('GPU simulation session generation 공간이 고갈되었습니다.');
    }
    return nextGpuSimulationSessionGeneration++;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function toNonNegativeSafeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function toPositiveSafeInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function projectileCaptureHandleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function fingerprintRouteAvailabilityBatch(sourceTick, availabilityVersion, records) {
    const text = JSON.stringify([
        sourceTick,
        availabilityVersion,
        ...records.map((record) => [
            record.eventType,
            record.entityId,
            record.incarnation,
            record.routeIndex,
            record.leaseGeneration,
            record.availabilityVersion
        ])
    ]);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash = Math.imul(
            (hash ^ (text.charCodeAt(index) & 0xff)) >>> 0,
            0x01000193
        ) >>> 0;
        hash = Math.imul(
            (hash ^ (text.charCodeAt(index) >>> 8)) >>> 0,
            0x01000193
        ) >>> 0;
    }
    return hash === 0 || hash === 0xffffffff ? 1 : hash;
}

function freezePosition(source) {
    const x = Number(source?.x);
    const y = Number(source?.y);
    return Number.isFinite(x) && Number.isFinite(y)
        ? Object.freeze({ x, y })
        : null;
}

function compareProtocolGeneration(left, right) {
    if (left.sessionGeneration !== right.sessionGeneration) {
        return left.sessionGeneration < right.sessionGeneration ? -1 : 1;
    }
    if (left.deviceGeneration !== right.deviceGeneration) {
        return left.deviceGeneration < right.deviceGeneration ? -1 : 1;
    }
    if (left.authoritativeEpoch !== right.authoritativeEpoch) {
        return left.authoritativeEpoch < right.authoritativeEpoch ? -1 : 1;
    }
    return 0;
}

function createEmptyCompletedEventSnapshot(completedThroughTick = 0, overrides = {}) {
    return Object.freeze({
        targetFixedTick: null,
        sourceTick: 0,
        completedThroughTick,
        batchCount: 0,
        droppedEventCount: 0,
        atomicTransformFirstHitCapacityRejected: false,
        retryableAtomicTransformFirstHitCapacityRejected: false,
        atomicTransformFirstHitRejectionReason: null,
        atomicTransformFirstHitCandidateCount: 0,
        atomicTransformFirstHitCommittedCount: 0,
        atomicTransformFirstHitEventBase: 0,
        atomicTransformFirstHitEventCapacity: 0,
        events: Object.freeze([]),
        contactEvents: Object.freeze([]),
        deathEvents: Object.freeze([]),
        protocolFailure: null,
        ...overrides
    });
}

function assertExactPlainDataKeys(snapshot, allowedKeys, label) {
    const allowed = new Set(allowedKeys);
    for (const key of Reflect.ownKeys(snapshot)) {
        if (typeof key !== 'string' || !allowed.has(key)) {
            throw new TypeError(`${label}에 허용되지 않은 field가 있습니다.`);
        }
    }
    for (const key of allowed) {
        if (!Object.hasOwn(snapshot, key)) {
            throw new TypeError(`${label}.${key}가 필요합니다.`);
        }
    }
    return snapshot;
}

function materializeProjectileCaptureOwnerRequest(source) {
    const envelope = materializeGpuPlainDataSnapshot(
        source,
        'projectileCaptureOwnerRequest',
        { opaqueKeys: ['records'] }
    );
    assertExactPlainDataKeys(envelope, [
        'commandId',
        'prepareSourceTick',
        'targetFixedTick',
        'batchIdFingerprint',
        'records'
    ], 'projectileCaptureOwnerRequest');
    if (!Array.isArray(envelope.records)) {
        throw new TypeError('projectileCaptureOwnerRequest.records가 필요합니다.');
    }
    const recordKeys = Reflect.ownKeys(envelope.records);
    if (recordKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError('projectileCaptureOwnerRequest.records symbol은 금지됩니다.');
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
        envelope.records,
        'length'
    );
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) {
        throw new TypeError('projectileCaptureOwnerRequest.records.length data descriptor가 필요합니다.');
    }
    const recordCount = lengthDescriptor.value;
    if (!Number.isSafeInteger(recordCount) || recordCount <= 0
        || recordKeys.length !== recordCount + 1) {
        throw new TypeError('projectileCaptureOwnerRequest.records가 dense array여야 합니다.');
    }
    const records = [];
    for (let index = 0; index < recordCount; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
            envelope.records,
            String(index)
        );
        if (!descriptor || descriptor.enumerable !== true
            || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`projectileCaptureOwnerRequest.records[${index}]가 필요합니다.`);
        }
        const record = descriptor.value;
        const snapshot = materializeGpuPlainDataSnapshot(
            record,
            `projectileCaptureOwnerRequest.records[${index}]`,
            {
                opaqueKeys: [
                    'expectedMetadata',
                    'prepareEvidence',
                    'coreImpactReceipt'
                ]
            }
        );
        records.push(assertExactPlainDataKeys(snapshot, [
            'projectileHandle',
            'captorHandle',
            'captureSequence',
            'releaseReason',
            'expectedMetadata',
            'expectedMetadataRevision',
            'towerTargetHandle',
            'prepareEvidence',
            'coreImpactReceipt'
        ], `projectileCaptureOwnerRequest.records[${index}]`));
    }
    return Object.freeze({
        commandId: envelope.commandId,
        prepareSourceTick: envelope.prepareSourceTick,
        targetFixedTick: envelope.targetFixedTick,
        batchIdFingerprint: envelope.batchIdFingerprint,
        records: Object.freeze(records)
    });
}

function materializeProjectileCaptureSimpleRequest(
    source,
    allowedKeys,
    label
) {
    return assertExactPlainDataKeys(
        materializeGpuPlainDataSnapshot(source, label),
        allowedKeys,
        label
    );
}

function assertEnemySimulationBackend(backend) {
    const requiredMethods = [
        'init',
        'spawnBodies',
        'despawnBodies',
        'hasBody',
        'hasActiveBodies',
        'fixedUpdate',
        'updatePresentation',
        'synchronizePresentation',
        'draw',
        'getRuntimeState',
        'requiresRecovery',
        'destroy'
    ];
    for (const methodName of requiredMethods) {
        if (typeof backend?.[methodName] !== 'function') {
            throw new TypeError(`enemySimulationBackend.${methodName}()가 필요합니다.`);
        }
    }
    return backend;
}

function resolveCapacity(backend, options) {
    const capacity = typeof backend.getCapacity === 'function'
        ? backend.getCapacity()
        : options.capacity ?? DEFAULT_ENEMY_CAPACITY;
    const number = Number(capacity);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError('GPU enemy capacity는 양의 안전한 정수여야 합니다.');
    }
    return number;
}

function createFixedPrimitiveBackendPort(backend, sessionGeneration) {
    return Object.freeze({
        hasBody: (handle) => backend.hasBody(handle),
        canControlBody: (handle) => backend.canControlBody?.(handle) ?? false,
        stageFixedPrograms: (plan) => backend.stageFixedPrograms?.(plan)
            ?? Object.freeze({
                accepted: 0,
                rejected: (plan.controls?.length ?? 0)
                    + (plan.sourceRelativeSpawns?.length ?? 0),
                reason: 'fixed-primitives-unsupported'
            }),
        drainCompletedSpawnProgramBatches: (out) => (
            backend.drainCompletedSpawnProgramBatches?.(out) ?? out
        ),
        drainCompletedBodyControlProgramBatches: (out) => (
            backend.drainCompletedBodyControlProgramBatches?.(out) ?? out
        ),
        cancelPendingFixedProgramsForTerminal: (request) => (
            backend.cancelPendingFixedProgramsForTerminal?.(request)
                ?? Object.freeze({
                    abiVersion: request?.abiVersion ?? 0,
                    finalFixedTick: request?.finalFixedTick ?? 0,
                    accepted: false,
                    state: 'failed',
                    reason: 'fixed-primitives-unsupported',
                    destinationCount: 0,
                    priorityControlCount: 0
                })
        ),
        getTerminalFixedProgramCancelStatus: () => (
            backend.getTerminalFixedProgramCancelStatus?.() ?? null
        ),
        getEventProtocolState: () => backend.getEventProtocolState?.()
            ?? Object.freeze({
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                submittedTickCount: 0
            }),
        requiresRecovery: () => backend.requiresRecovery(),
        getRuntimeState: () => backend.getRuntimeState()
    });
}

function createEffectBackendPort(backend, sessionGeneration) {
    const supportsRuntime = [
        'stageEffectPulseProgramBatch',
        'drainCompletedEffectProgramBatches',
        'cancelPendingEffectProgramsForTerminal',
        'getEffectRuntimeStatus'
    ].every((methodName) => typeof backend?.[methodName] === 'function');
    let fallbackTerminal = null;
    return Object.freeze({
        hasBody: (handle) => backend.hasBody(handle),
        stageEffectPulseProgramBatch: (batch) => supportsRuntime
            ? backend.stageEffectPulseProgramBatch(batch)
            : Object.freeze({
                accepted: false,
                abiVersion: GPU_EFFECT_PULSE_PROGRAM_ABI_VERSION,
                sourceTick: batch?.sourceTick ?? 0,
                stagedCount: 0,
                reason: 'effect-runtime-unsupported'
            }),
        drainCompletedEffectProgramBatches: (out = []) => supportsRuntime
            ? backend.drainCompletedEffectProgramBatches(out)
            : out,
        cancelPendingEffectProgramsForTerminal: (request) => {
            if (supportsRuntime) {
                return backend.cancelPendingEffectProgramsForTerminal(request);
            }
            fallbackTerminal = Object.freeze({
                abiVersion: GPU_EFFECT_TERMINAL_CANCEL_ABI_VERSION,
                state: 'armed',
                finalFixedTick: request?.finalFixedTick ?? 0,
                submittedTick: 0,
                pulseProgramCount: 0,
                pendingPulseProgramCount: 0,
                pendingEffectReadbackCount: 0,
                failure: null
            });
            return fallbackTerminal;
        },
        getEffectRuntimeStatus: () => supportsRuntime
            ? backend.getEffectRuntimeStatus()
            : Object.freeze({
                abiVersion: GPU_EFFECT_RUNTIME_ABI_VERSION,
                state: 'idle',
                activePoolIndex: 0,
                sourceTick: 0,
                lastSubmittedTick: fallbackTerminal?.submittedTick ?? 0,
                completedThroughTick: 0,
                pendingPulseProgramCount: 0,
                pendingEffectReadbackCount: 0,
                requiresRecovery: false,
                failure: null,
                terminal: fallbackTerminal
            }),
        getEventProtocolState: () => backend.getEventProtocolState?.()
            ?? Object.freeze({
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0
            }),
        noteFixedSubmit(sourceTick, submitted) {
            if (!supportsRuntime
                && submitted === true
                && fallbackTerminal?.state === 'armed'
                && fallbackTerminal.finalFixedTick === sourceTick) {
                fallbackTerminal = Object.freeze({
                    ...fallbackTerminal,
                    state: 'submitted',
                    submittedTick: sourceTick
                });
            }
        },
        isSupported: () => supportsRuntime
    });
}

function createFormationBackendPort(backend, sessionGeneration) {
    const supportsRuntime = [
        'stageFormationPrepareBatch',
        'drainCompletedFormationPrepareBatches',
        'armPreparedFormationTransformBatch',
        'commitArmedFormationTransformBatch',
        'cancelArmedFormationTransformBatch',
        'cancelPendingFormationProgramsForTerminal',
        'getFormationRuntimeStatus'
    ].every((methodName) => typeof backend?.[methodName] === 'function');
    let fallbackTerminal = null;
    return Object.freeze({
        hasBody: (handle) => backend.hasBody(handle),
        stageFormationPrepareBatch: (batch) => supportsRuntime
            ? backend.stageFormationPrepareBatch(batch)
            : Object.freeze({
                abiVersion: GPU_FORMATION_PREPARE_PROGRAM_ABI_VERSION,
                accepted: false,
                targetFixedTick: batch?.targetFixedTick ?? 0,
                stagedCount: 0,
                replayed: false,
                reason: 'formation-runtime-unsupported',
                requiresRecovery: true
            }),
        drainCompletedFormationPrepareBatches: (out = []) => supportsRuntime
            ? backend.drainCompletedFormationPrepareBatches(out)
            : out,
        armPreparedFormationTransformBatch: (request) => supportsRuntime
            ? backend.armPreparedFormationTransformBatch(request)
            : Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'formation-runtime-unsupported',
                requiresRecovery: true
            }),
        commitArmedFormationTransformBatch: (receipt) => supportsRuntime
            ? backend.commitArmedFormationTransformBatch(receipt)
            : Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'formation-runtime-unsupported',
                requiresRecovery: true
            }),
        cancelArmedFormationTransformBatch: (receipt) => supportsRuntime
            ? backend.cancelArmedFormationTransformBatch(receipt)
            : Object.freeze({
                abiVersion: GPU_FORMATION_TRANSFORM_PROGRAM_ABI_VERSION,
                accepted: false,
                reason: 'formation-runtime-unsupported',
                requiresRecovery: true
            }),
        cancelPendingFormationProgramsForTerminal: (request) => {
            if (supportsRuntime) {
                return backend.cancelPendingFormationProgramsForTerminal(request);
            }
            fallbackTerminal = Object.freeze({
                abiVersion: GPU_FORMATION_TERMINAL_CANCEL_ABI_VERSION,
                state: 'armed',
                finalFixedTick: request?.finalFixedTick ?? 0,
                submittedTick: 0,
                prepareProgramCount: 0,
                armedTransformCount: 0,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                failure: null
            });
            return fallbackTerminal;
        },
        getFormationRuntimeStatus: () => supportsRuntime
            ? backend.getFormationRuntimeStatus()
            : Object.freeze({
                abiVersion: GPU_FORMATION_RUNTIME_ABI_VERSION,
                state: 'idle',
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                ingressOpen: fallbackTerminal === null,
                prepareCapacity: 0,
                transformCapacity: 0,
                stagedPrepareProgramCount: 0,
                pendingPrepareProgramCount: 0,
                pendingPrepareReadbackCount: 0,
                pendingTransformReadbackCount: 0,
                armedTransformCount: 0,
                commitRequested: false,
                runtimeStatus: 0,
                requiresRecovery: false,
                failure: null,
                terminal: fallbackTerminal
            }),
        getEventProtocolState: () => backend.getEventProtocolState?.()
            ?? Object.freeze({
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                submittedTick: 0
            }),
        noteFixedSubmit(sourceTick, submitted) {
            if (!supportsRuntime
                && submitted === true
                && fallbackTerminal?.state === 'armed'
                && fallbackTerminal.finalFixedTick === sourceTick) {
                fallbackTerminal = Object.freeze({
                    ...fallbackTerminal,
                    state: 'submitted',
                    submittedTick: sourceTick
                });
            }
        },
        isSupported: () => supportsRuntime
    });
}

function createAtomicTransformBackendPort(backend, sessionGeneration) {
    const supportsRuntime = [
        'stageAtomicTransformPrepareBatch',
        'drainCompletedAtomicTransformPrepareBatches',
        'discardPreparedAtomicTransformBatch',
        'armPreparedAtomicTransformBatch',
        'commitArmedAtomicTransformBatch',
        'cancelArmedAtomicTransformBatch',
        'cancelPendingAtomicTransformProgramsForTerminal',
        'getAtomicTransformRuntimeStatus'
    ].every((methodName) => typeof backend?.[methodName] === 'function');
    let fallbackTerminal = null;
    const unsupported = (reason = 'atomic-transform-runtime-unsupported') => (
        Object.freeze({ accepted: false, reason, requiresRecovery: true })
    );
    return Object.freeze({
        stageAtomicTransformPrepareBatch: (request) => supportsRuntime
            ? backend.stageAtomicTransformPrepareBatch(request)
            : unsupported(),
        drainCompletedAtomicTransformPrepareBatches: (out = []) => supportsRuntime
            ? backend.drainCompletedAtomicTransformPrepareBatches(out)
            : out,
        discardPreparedAtomicTransformBatch: (request) => supportsRuntime
            ? backend.discardPreparedAtomicTransformBatch(request)
            : unsupported(),
        armPreparedAtomicTransformBatch: (request) => supportsRuntime
            ? backend.armPreparedAtomicTransformBatch(request)
            : unsupported(),
        commitArmedAtomicTransformBatch: (receipt) => supportsRuntime
            ? backend.commitArmedAtomicTransformBatch(receipt)
            : unsupported(),
        cancelArmedAtomicTransformBatch: (receipt, reason) => supportsRuntime
            ? backend.cancelArmedAtomicTransformBatch(receipt, reason)
            : unsupported(),
        cancelPendingAtomicTransformProgramsForTerminal: (request) => {
            if (supportsRuntime) {
                return backend.cancelPendingAtomicTransformProgramsForTerminal(
                    request
                );
            }
            fallbackTerminal = Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_TERMINAL_CANCEL_ABI_VERSION,
                state: 'armed',
                finalFixedTick: request?.finalFixedTick ?? 0,
                submittedTick: 0,
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: 0,
                failure: null
            });
            return fallbackTerminal;
        },
        getAtomicTransformRuntimeStatus: () => supportsRuntime
            ? backend.getAtomicTransformRuntimeStatus()
            : Object.freeze({
                abiVersion: GPU_ATOMIC_TRANSFORM_RUNTIME_ABI_VERSION,
                state: 'idle',
                sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                ingressOpen: fallbackTerminal === null,
                pendingPrepareCount: 0,
                pendingTransformCount: 0,
                pendingReadbackCount: 0,
                runtimeStatus: 0,
                requiresRecovery: false,
                failure: null,
                terminal: fallbackTerminal
            }),
        noteFixedSubmit(sourceTick, submitted) {
            if (!supportsRuntime
                && submitted === true
                && fallbackTerminal?.state === 'armed'
                && fallbackTerminal.finalFixedTick === sourceTick) {
                fallbackTerminal = Object.freeze({
                    ...fallbackTerminal,
                    state: 'submitted',
                    submittedTick: sourceTick
                });
            }
        },
        isSupported: () => supportsRuntime
    });
}

function createTerminalCleanupAuthority() {
    const issuedPermits = new WeakSet();
    let revoked = false;
    return Object.freeze({
        issuePermit() {
            if (revoked) {
                return null;
            }
            const permit = Object.freeze({});
            issuedPermits.add(permit);
            return permit;
        },
        consumePermit(permit) {
            if (revoked
                || !permit
                || typeof permit !== 'object'
                || !issuedPermits.has(permit)) {
                return false;
            }
            issuedPermits.delete(permit);
            return true;
        },
        revoke() {
            revoked = true;
        }
    });
}

/**
 * @class GpuEnemySimulationEndpoint
 * @description 게임 코드가 적·투사체를 공유하는 GPU 물리의 lifecycle·fixed tick·presentation을
 * 한 경계에서 안전하게 사용할 수 있게 하는 공개 session facade입니다.
 * 기존 class 이름은 호환을 위해 유지하며 `GpuSimulationEndpoint`가 canonical alias입니다.
 */
export class GpuEnemySimulationEndpoint {
    #terminalCleanupAuthority;
    #atomicTransformIngressAuthority;
    #atomicTransformRegistryAuthority;
    #formationTransactionPort;
    #formationCommandOwner;
    #formationBackendPort;
    #atomicTransformCommandOwner;
    #atomicTransformBackendPort;
    #atomicTransformTransactionPort;
    #coreImpactCleanupPortState;
    #authenticEffectLifecycleCommits;
    #effectLifecycleCommitProofTick;
    #effectLifecycleCommitProofs;
    #projectileCaptureReleaseAuthority;
    #activeMetadataMutationRegistryAuthority;
    #projectileCaptureTransactionPort;
    #projectileCaptureCommandPort;
    #authenticProjectileCaptureCoreImpactReceipts;
    #authenticProjectileCapturePrepareEvidence;
    #acceptedProjectileCaptureProtocols;
    #acceptedProjectileCaptureProtocolKeys;
    #acceptedProjectileCaptureProtocolKeyHead;

    /**
     * @param {{webGpuPlatformPort?:object|null,gpuSimulationBackend?:object,gpuSimulationBackendFactory?:(dependencies:object,options:object)=>object,enemySimulationBackend?:object,enemySimulationBackendFactory?:(dependencies:object,options:object)=>object,coreImpactCleanupPortReceiver?:(binding:object)=>void}} [dependencies={}]
     * @param {{capacity?:number,presentationProfile?:string,completedEventSnapshotCapacity?:number,completedEventKeyHistoryCapacity?:number,controlCommandCapacity?:number,spawnProgramCapacity?:number,effectCommandCapacity?:number,effectCommandHistoryCapacity?:number,effectCompletionBatchCapacity?:number,formationCommandCapacity?:number,formationCommandHistoryCapacity?:number}} [options={}]
     */
    constructor(dependencies = {}, options = {}) {
        if (dependencies.coreImpactCleanupPortReceiver !== undefined
            && typeof dependencies.coreImpactCleanupPortReceiver !== 'function') {
            throw new TypeError('coreImpactCleanupPortReceiver는 함수여야 합니다.');
        }
        this.sessionGeneration = allocateSessionGeneration();
        const directInjectedBackend = dependencies.gpuSimulationBackend
            ?? dependencies.enemySimulationBackend
            ?? null;
        const backendFactory = dependencies.gpuSimulationBackendFactory
            ?? dependencies.enemySimulationBackendFactory;
        const compositionBodyCapacity = requirePositiveSafeInteger(
            options.capacity
                ?? (typeof backendFactory !== 'function'
                    && typeof directInjectedBackend?.getCapacity === 'function'
                    ? directInjectedBackend.getCapacity()
                    : DEFAULT_ENEMY_CAPACITY),
            'GPU enemy composition capacity'
        );
        const configuredEffectCommandCapacity = requirePositiveSafeInteger(
            options.effectCommandCapacity
                ?? Math.min(
                    compositionBodyCapacity,
                    DEFAULT_EFFECT_COMMAND_CAPACITY
                ),
            'effectCommandCapacity'
        );
        if (configuredEffectCommandCapacity > compositionBodyCapacity) {
            throw new RangeError(
                'effectCommandCapacity는 GPU enemy composition capacity를 초과할 수 없습니다.'
            );
        }
        const configuredFormationCommandCapacity = requirePositiveSafeInteger(
            options.formationCommandCapacity
                ?? Math.min(
                    compositionBodyCapacity,
                    DEFAULT_FORMATION_COMMAND_CAPACITY
                ),
            'formationCommandCapacity'
        );
        if (configuredFormationCommandCapacity > compositionBodyCapacity) {
            throw new RangeError(
                'formationCommandCapacity는 GPU enemy composition capacity를 초과할 수 없습니다.'
            );
        }
        const backendDependencies = {
            webGpuPlatformPort: dependencies.webGpuPlatformPort ?? null
        };
        const backendOptions = {
            capacity: compositionBodyCapacity,
            presentationProfile: options.presentationProfile,
            controlCommandCapacity: options.controlCommandCapacity,
            spawnProgramCapacity: options.spawnProgramCapacity,
            effectCommandCapacity: configuredEffectCommandCapacity,
            eventCapacity: options.eventCapacity,
            formationCommandCapacity: configuredFormationCommandCapacity,
            atomicTransformPrepareCapacity: compositionBodyCapacity,
            atomicTransformCapacity:
                Math.min(
                    compositionBodyCapacity,
                    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
                ),
            projectileCaptureCompletionCapacity:
                options.projectileCaptureCompletionCapacity,
            projectileCaptureReleasePreparationCapacity:
                options.projectileCaptureReleasePreparationCapacity,
            projectileCaptureCleanupCapacity:
                options.projectileCaptureCleanupCapacity,
            sessionGeneration: this.sessionGeneration
        };
        const injectedBackend = typeof backendFactory
            === 'function'
            ? backendFactory(
                backendDependencies,
                backendOptions
            )
            : directInjectedBackend;
        this.backend = assertEnemySimulationBackend(
            injectedBackend
                ?? new EnemySimulationBackend(backendDependencies, backendOptions)
        );
        this.capacity = resolveCapacity(this.backend, options);
        this.effectCommandCapacity = options.effectCommandCapacity === undefined
            ? Math.min(this.capacity, configuredEffectCommandCapacity)
            : configuredEffectCommandCapacity;
        if (this.effectCommandCapacity > this.capacity) {
            throw new RangeError(
                'effectCommandCapacity는 resolved GPU enemy capacity를 초과할 수 없습니다.'
            );
        }
        this.formationCommandCapacity
            = options.formationCommandCapacity === undefined
                ? Math.min(this.capacity, configuredFormationCommandCapacity)
                : configuredFormationCommandCapacity;
        if (this.formationCommandCapacity > this.capacity) {
            throw new RangeError(
                'formationCommandCapacity는 resolved GPU enemy capacity를 초과할 수 없습니다.'
            );
        }
        this.#atomicTransformRegistryAuthority = Object.freeze({});
        this.#activeMetadataMutationRegistryAuthority = Object.freeze({});
        this.registry = new WorldRegistry({
            capacity: this.capacity,
            atomicTransformAuthority: this.#atomicTransformRegistryAuthority,
            activeMetadataMutationAuthority:
                this.#activeMetadataMutationRegistryAuthority
        });
        this.#terminalCleanupAuthority = createTerminalCleanupAuthority();
        this.#atomicTransformIngressAuthority = createTerminalCleanupAuthority();
        this.#projectileCaptureReleaseAuthority
            = createTerminalCleanupAuthority();
        this.#authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
        this.#authenticProjectileCapturePrepareEvidence = new WeakSet();
        this.projectileCaptureBackendSupported
            = PROJECTILE_CAPTURE_BACKEND_METHODS.every(
                (methodName) => typeof this.backend?.[methodName] === 'function'
            );
        this.routeAvailabilityBackendSupported
            = ROUTE_AVAILABILITY_BACKEND_METHODS.every(
                (methodName) => typeof this.backend?.[methodName] === 'function'
            );
        const routeLifecyclePort = this.routeAvailabilityBackendSupported
            ? Object.freeze({
                preflightRouteLifecycleBatch: (request) => this.backend
                    .preflightRouteLifecycleBatch(request),
                commitRouteLifecycleBatch: (receipt, publication) => this.backend
                    .commitRouteLifecycleBatch(receipt, publication),
                cancelRouteLifecycleBatch: (receipt, reason) => this.backend
                    .cancelRouteLifecycleBatch(receipt, reason)
            })
            : null;
        this.projectileCaptureTerminalOwnerStatus = null;
        this.projectileCaptureTerminalBackendStatus = null;
        this.projectileCaptureTerminalHostCleanup = Object.freeze({
            authority: 'lifecycle-terminal-despawn',
            requestedHeldDespawnCount: 0,
            completedHeldDespawnCount: 0,
            pendingHeldDespawnCount: 0,
            releaseCommittedExcluded: true,
            failure: null
        });
        this.projectileCaptureTerminalCleanupCommandIds = new Map();
        this.lastAcceptedProjectileCaptureProtocol = null;
        this.#acceptedProjectileCaptureProtocols = new Map();
        this.#acceptedProjectileCaptureProtocolKeys = [];
        this.#acceptedProjectileCaptureProtocolKeyHead = 0;
        this.lastAcceptedProjectileCaptureSnapshot = null;
        this.lastAcceptedProjectileCaptureReleaseSnapshot = null;
        this.projectileCaptureDeferredDeathReceipts = new Map();
        this.#projectileCaptureTransactionPort = Object.freeze({
            armPreparedProjectileCaptureReleaseBatch: (request) => {
                if (this.destroyed || !this.projectileCaptureBackendSupported
                    || !Array.isArray(request?.records)
                    || request.records.length === 0) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-backend-unavailable',
                        requiresRecovery: !this.destroyed
                    });
                }
                for (const record of request.records) {
                    const coreReceipt = record?.coreImpactReceipt;
                    const coreReceiptNamesCaptor = coreReceipt
                        && ((coreReceipt.entityId
                                === record.captorHandle?.entityId
                                && coreReceipt.incarnation
                                    === record.captorHandle?.incarnation)
                            || (coreReceipt.otherEntityId
                                    === record.captorHandle?.entityId
                                && coreReceipt.otherIncarnation
                                    === record.captorHandle?.incarnation));
                    const coreReceiptExact = record.releaseReason
                            === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                                .CAPTOR_CORE_IMPACT
                        ? this.#authenticProjectileCaptureCoreImpactReceipts
                            .has(coreReceipt)
                            && coreReceipt.sessionGeneration
                                === this.sessionGeneration
                            && coreReceipt.deviceGeneration
                                === this.lastAcceptedProjectileCaptureProtocol
                                    ?.deviceGeneration
                            && coreReceipt.authoritativeEpoch
                                === this.lastAcceptedProjectileCaptureProtocol
                                    ?.authoritativeEpoch
                            && coreReceipt.sourceTick === request.prepareSourceTick
                            && coreReceiptNamesCaptor
                        : coreReceipt === null;
                    if (!this.#authenticProjectileCapturePrepareEvidence.has(
                        record?.prepareEvidence
                    ) || !coreReceiptExact) {
                        return Object.freeze({
                            accepted: false,
                            reason: 'projectile-capture-release-proof-invalid',
                            requiresRecovery: true
                        });
                    }
                }
                const result = this.backend
                    .armPreparedProjectileCaptureReleaseBatch(request);
                if (result?.accepted === true) {
                    for (const record of request.records) {
                        this.#authenticProjectileCapturePrepareEvidence.delete(
                            record.prepareEvidence
                        );
                        if (record.releaseReason
                                === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                                    .CAPTOR_CORE_IMPACT) {
                            this.#authenticProjectileCaptureCoreImpactReceipts
                                .delete(record.coreImpactReceipt);
                        }
                    }
                }
                return result;
            },
            commitArmedProjectileCaptureReleaseBatch: (receipt) => (
                this.destroyed || !this.projectileCaptureBackendSupported
                    ? Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-backend-unavailable',
                        requiresRecovery: !this.destroyed
                    })
                    : this.backend
                        .commitArmedProjectileCaptureReleaseBatch(receipt)
            ),
            cancelArmedProjectileCaptureReleaseBatch: (receipt, reason) => (
                this.destroyed || !this.projectileCaptureBackendSupported
                    ? Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-backend-unavailable',
                        requiresRecovery: !this.destroyed
                    })
                    : this.backend.cancelArmedProjectileCaptureReleaseBatch(
                        receipt,
                        reason
                    )
            )
        });
        this.#atomicTransformBackendPort = createAtomicTransformBackendPort(
            this.backend,
            this.sessionGeneration
        );
        this.#atomicTransformCommandOwner = null;
        this.#atomicTransformTransactionPort = Object.freeze({
            armPreparedAtomicTransformBatch: (request) => (
                this.#atomicTransformBackendPort
                    .armPreparedAtomicTransformBatch(request)
            ),
            commitArmedAtomicTransformBatch: (receipt) => (
                this.#atomicTransformBackendPort
                    .commitArmedAtomicTransformBatch(receipt)
            ),
            cancelArmedAtomicTransformBatch: (receipt, reason) => (
                this.#atomicTransformBackendPort
                    .cancelArmedAtomicTransformBatch(receipt, reason)
            )
        });
        this.#formationCommandOwner = null;
        this.#formationTransactionPort = Object.freeze({
            armPreparedFormationTransformBatch: (request) => (
                this.#formationCommandOwner
                    ?.armPreparedFormationTransformBatch(request)
                ?? Object.freeze({
                    accepted: false,
                    reason: 'formation-runtime-unconfigured',
                    requiresRecovery: true
                })
            ),
            commitArmedFormationTransformBatch: (receipt) => (
                this.#formationCommandOwner
                    ?.commitArmedFormationTransformBatch(receipt)
                ?? Object.freeze({
                    accepted: false,
                    reason: 'formation-runtime-unconfigured',
                    requiresRecovery: true
                })
            ),
            cancelArmedFormationTransformBatch: (receipt) => (
                this.#formationCommandOwner
                    ?.cancelArmedFormationTransformBatch(receipt)
                ?? Object.freeze({
                    accepted: false,
                    reason: 'formation-runtime-unconfigured',
                    requiresRecovery: true
                })
            )
        });
        this.lifecycleCommandOwner = new EnemyLifecycleCommandOwner(
            this.backend,
            this.registry,
            {
                terminalCleanupAuthority: this.#terminalCleanupAuthority,
                atomicTransformAuthority: this.#atomicTransformIngressAuthority,
                atomicTransformRegistryAuthority:
                    this.#atomicTransformRegistryAuthority,
                atomicTransformTransactionPort: this.#formationTransactionPort,
                enemyAtomicTransformTransactionPort:
                    this.#atomicTransformTransactionPort,
                projectileCaptureReleaseAuthority:
                    this.#projectileCaptureReleaseAuthority,
                activeMetadataMutationRegistryAuthority:
                    this.#activeMetadataMutationRegistryAuthority,
                projectileCaptureReleaseTransactionPort:
                    this.#projectileCaptureTransactionPort,
                routeLifecyclePort
            }
        );
        this.#projectileCaptureCommandPort = Object.freeze({
            requestPreparedReleaseBatch: (ownerRequest) => {
                if (this.destroyed || !this.gameplayIngressOpen
                    || !this.projectileCaptureBackendSupported) {
                    return Object.freeze({
                        accepted: false,
                        reason: this.destroyed || !this.gameplayIngressOpen
                            ? 'projectile-capture-release-ingress-revoked'
                            : 'projectile-capture-release-backend-unavailable',
                        requiresRecovery: false
                    });
                }
                let request;
                try {
                    request = materializeProjectileCaptureOwnerRequest(
                        ownerRequest
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-contract',
                        requiresRecovery: false
                    });
                }
                const coreRecords = request.records.filter((record) => (
                    record.releaseReason
                        === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                            .CAPTOR_CORE_IMPACT
                )) ?? [];
                if (request.records.some((record) => (
                    !this.#authenticProjectileCapturePrepareEvidence.has(
                        record?.prepareEvidence
                    )
                )) || coreRecords.some((record) => (
                    !this.#authenticProjectileCaptureCoreImpactReceipts.has(
                        record.coreImpactReceipt
                    )
                ))) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-proof-invalid',
                        requiresRecovery: true
                    });
                }
                const permit = this.#projectileCaptureReleaseAuthority
                    .issuePermit();
                if (!permit) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-ingress-revoked',
                        requiresRecovery: false
                    });
                }
                try {
                    return this.lifecycleCommandOwner
                        .requestProjectileCaptureReleaseBatch(
                        Object.freeze({
                            prepareSourceTick: request.prepareSourceTick,
                            batchIdFingerprint:
                                request.batchIdFingerprint,
                            records: request.records
                        }),
                        request.targetFixedTick,
                        request.commandId,
                        permit
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-contract',
                        requiresRecovery: false
                    });
                }
            },
            discardPreparedBatch: (request) => {
                if (this.destroyed || !this.gameplayIngressOpen
                    || !this.projectileCaptureBackendSupported) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-release-ingress-revoked',
                        requiresRecovery: false
                    });
                }
                let snapshot;
                try {
                    snapshot = materializeProjectileCaptureSimpleRequest(
                        request,
                        ['batchIdFingerprint'],
                        'projectileCaptureDiscardRequest'
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-discard-contract',
                        requiresRecovery: false
                    });
                }
                return this.backend
                    .discardPreparedProjectileCaptureBatch(snapshot);
            },
            requestTerminalHeldProjectileDespawn: (request) => {
                if (this.destroyed || !this.gameplayIngressOpen
                    || !this.projectileCaptureBackendSupported) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected',
                        requiresRecovery: false
                    });
                }
                let snapshot;
                try {
                    snapshot = materializeProjectileCaptureSimpleRequest(
                        request,
                        ['handle', 'targetFixedTick', 'commandId'],
                        'projectileCaptureTerminalCleanupRequest'
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                let body;
                try {
                    body = this.backend.getProjectileCaptureBodyState(
                        snapshot.handle
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                if (!body || body.releaseCommitRequested
                    || body.capturedMirror !== true
                    || (body.state.phase
                            !== GPU_PROJECTILE_CAPTURE_PHASE.HELD
                        && body.state.phase
                            !== GPU_PROJECTILE_CAPTURE_PHASE
                                .RELEASE_PREPARED)) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                if (typeof snapshot.commandId !== 'string') {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                const commandId = snapshot.commandId;
                if (!commandId.startsWith('ring-projectile-capture-terminal:')) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                const permit = this.#terminalCleanupAuthority.issuePermit();
                if (!permit) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                let result;
                try {
                    result = this.lifecycleCommandOwner.requestDespawn(
                        snapshot.handle,
                        'projectile-capture-terminal-held-unpublished',
                        snapshot.targetFixedTick,
                        commandId,
                        Object.freeze({
                            disposition:
                                'projectile-capture-terminal-held-unpublished'
                        }),
                        permit
                    );
                } catch {
                    return Object.freeze({
                        accepted: false,
                        reason: 'projectile-capture-terminal-cleanup-rejected'
                    });
                }
                const authenticDuplicate = result?.accepted === false
                    && result.reason === 'duplicate-despawn'
                    && result.authenticTerminalCleanup === true
                    && result.targetFixedTick === snapshot.targetFixedTick;
                if (result?.accepted === true || authenticDuplicate) {
                    const canonicalCommandId = result.commandId;
                    if (typeof canonicalCommandId !== 'string'
                        || canonicalCommandId.length === 0) {
                        return Object.freeze({
                            accepted: false,
                            reason:
                                'projectile-capture-terminal-cleanup-rejected',
                            requiresRecovery: true
                        });
                    }
                    const alreadyTracked
                        = this.projectileCaptureTerminalCleanupCommandIds
                            .has(canonicalCommandId);
                    const prior = this.projectileCaptureTerminalCleanupCommandIds
                        .get(canonicalCommandId);
                    if (prior && (prior.targetFixedTick
                            !== snapshot.targetFixedTick
                        || prior.handle.entityId !== snapshot.handle.entityId
                        || prior.handle.incarnation
                            !== snapshot.handle.incarnation)) {
                        return Object.freeze({
                            accepted: false,
                            reason:
                                'projectile-capture-terminal-cleanup-rejected',
                            requiresRecovery: true
                        });
                    }
                    this.projectileCaptureTerminalCleanupCommandIds.set(
                        canonicalCommandId,
                        Object.freeze({
                            handle: Object.freeze({
                                entityId: snapshot.handle.entityId,
                                incarnation: snapshot.handle.incarnation
                            }),
                            targetFixedTick: snapshot.targetFixedTick
                        })
                    );
                    const previous = this.projectileCaptureTerminalHostCleanup;
                    this.projectileCaptureTerminalHostCleanup = Object.freeze({
                        ...previous,
                        requestedHeldDespawnCount:
                            previous.requestedHeldDespawnCount
                                + Number(!alreadyTracked),
                        pendingHeldDespawnCount:
                            this.projectileCaptureTerminalCleanupCommandIds.size
                    });
                }
                return result;
            }
        });
        this.#authenticEffectLifecycleCommits = new WeakSet();
        this.#effectLifecycleCommitProofTick = 0;
        this.#effectLifecycleCommitProofs = [];
        this.#coreImpactCleanupPortState = { revoked: false };
        const cleanupPortState = this.#coreImpactCleanupPortState;
        const cleanupPort = Object.freeze({
            requestCommittedCoreImpactCleanup: (
                handle,
                targetFixedTick,
                commandId
            ) => {
                if (cleanupPortState.revoked || this.destroyed) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'core-impact-cleanup-port-revoked'
                    });
                }
                const permit = this.#terminalCleanupAuthority.issuePermit();
                return this.lifecycleCommandOwner.requestDespawn(
                    handle,
                    'core-impact',
                    targetFixedTick,
                    commandId,
                    CORE_IMPACT_CLEANUP_OPTIONS,
                    permit
                );
            }
        });
        const coreImpactCleanupBinding = Object.freeze({
            port: cleanupPort,
            revoke: () => this.#revokeCoreImpactCleanupPort()
        });
        this.fixedPrimitiveBackendPort = createFixedPrimitiveBackendPort(
            this.backend,
            this.sessionGeneration
        );
        this.fixedCommandOwner = new GpuFixedCommandOwner(
            this.fixedPrimitiveBackendPort,
            this.registry,
            {
                controlCommandCapacity: options.controlCommandCapacity,
                sourceRelativeSpawnCommandCapacity:
                    options.sourceRelativeSpawnCommandCapacity
            }
        );
        this.effectBackendPort = createEffectBackendPort(
            this.backend,
            this.sessionGeneration
        );
        this.effectCommandOwner = new GpuEffectCommandOwner(
            this.effectBackendPort,
            this.registry,
            {
                sessionGeneration: this.sessionGeneration,
                commandCapacity: this.effectCommandCapacity,
                historyCapacity: options.effectCommandHistoryCapacity,
                completionBatchCapacity: options.effectCompletionBatchCapacity,
                effectEmitterProfileById: ENEMY_EFFECT_EMITTER_PROFILE_BY_ID,
                effectDefinitionById: ENEMY_EFFECT_DEFINITION_BY_ID,
                lifecycleCommitProofPort: Object.freeze({
                    isAuthenticCommit: (commit, fixedTick) => (
                        this.#authenticEffectLifecycleCommits.has(commit)
                        && commit?.fixedTick === fixedTick
                    )
                })
            }
        );
        this.#formationBackendPort = createFormationBackendPort(
            this.backend,
            this.sessionGeneration
        );
        const formationLifecyclePort = Object.freeze({
            requestAtomicTransformBatch: (
                request,
                targetFixedTick,
                commandId
            ) => {
                const permit = this.#atomicTransformIngressAuthority.issuePermit();
                if (!permit) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'atomic-transform-ingress-revoked'
                    });
                }
                return this.lifecycleCommandOwner.requestAtomicTransformBatch(
                    request,
                    targetFixedTick,
                    commandId,
                    permit
                );
            }
        });
        this.#formationCommandOwner = new GpuFormationCommandOwner(
            this.#formationBackendPort,
            this.registry,
            formationLifecyclePort,
            {
                sessionGeneration: this.sessionGeneration,
                commandCapacity: this.formationCommandCapacity,
                historyCapacity: options.formationCommandHistoryCapacity,
                lifecycleCommitProofPort: Object.freeze({
                    isAuthenticCommit: (commit, fixedTick) => (
                        this.#authenticEffectLifecycleCommits.has(commit)
                        && commit?.fixedTick === fixedTick
                    )
                })
            }
        );
        const atomicTransformLifecyclePort = Object.freeze({
            requestAtomicTransformBatch: (ownerRequest) => {
                const permit = this.#atomicTransformIngressAuthority.issuePermit();
                if (!permit) {
                    return Object.freeze({
                        accepted: false,
                        reason: 'atomic-transform-ingress-revoked'
                    });
                }
                const request = Object.freeze({
                    prepareSourceTick: ownerRequest.prepareSourceTick,
                    transformFixedTick: ownerRequest.transformFixedTick,
                    batchIdFingerprint: ownerRequest.batchIdFingerprint,
                    records: ownerRequest.records
                });
                return this.lifecycleCommandOwner.requestAtomicTransformBatch(
                    request,
                    ownerRequest.targetFixedTick,
                    ownerRequest.commandId,
                    permit
                );
            }
        });
        this.#atomicTransformCommandOwner = new GpuAtomicTransformCommandOwner({
            backendPort: this.#atomicTransformBackendPort,
            lifecyclePort: atomicTransformLifecyclePort,
            sessionGeneration: this.sessionGeneration,
            capacity: this.capacity,
            transformStartCapacity:
                Math.min(
                    this.capacity,
                    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
                )
        });
        this.completedEventSnapshotCapacity = requirePositiveSafeInteger(
            options.completedEventSnapshotCapacity
                ?? Math.min(this.capacity * 2, DEFAULT_COMPLETED_EVENT_SNAPSHOT_CAPACITY),
            'completedEventSnapshotCapacity'
        );
        this.completedEventKeyHistoryCapacity = requirePositiveSafeInteger(
            options.completedEventKeyHistoryCapacity
                ?? DEFAULT_COMPLETED_EVENT_KEY_HISTORY_CAPACITY,
            'completedEventKeyHistoryCapacity'
        );
        this.completedEventBatchScratch = [];
        this.knownCompletedBatchKeys = new Map();
        this.completedBatchKeys = [];
        this.completedBatchKeyHead = 0;
        this.knownCompletedEventKeys = new Map();
        this.completedEventKeys = [];
        this.completedEventKeyHead = 0;
        this.completedEventTotals = {
            applied: 0,
            death: 0,
            stale: 0,
            deduped: 0
        };
        this.completedThroughTick = 0;
        this.lastAcceptedEventSourceTick = 0;
        this.lastAcceptedEventStreamSourceTick = 0;
        this.lastAcceptedEventSubmittedTick = 0;
        this.lastAcceptedEventProtocolKey = null;
        this.completedEventRecoveryRequired = false;
        this.completedEventProtocolFailure = null;
        this.towerGameplayTargetDiagnostic = null;
        this.trackedPoseDiagnostic = null;
        this.deferredCompletedEventBatches = [];
        this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot();
        this.routeAvailabilityBatchScratch = [];
        this.lastCompletedRouteAvailabilityPrograms = null;
        this.routeAvailabilityTerminalOwnerStatus = null;
        this.routeAvailabilityTerminalBackendStatus = null;
        this.routeAvailabilityTerminalCleanupCommandIds = new Map();
        this.routeAvailabilityTerminalHostCleanup = Object.freeze({
            requestedCount: 0,
            completedCount: 0,
            pendingCount: 0,
            failure: null
        });
        this.gameplayIngressOpen = true;
        this.gameplayIngressCloseReason = null;
        this.gameplayIngressCloseCleanup = null;
        this.initialized = false;
        this.destroyed = false;
        try {
            dependencies.coreImpactCleanupPortReceiver?.(
                coreImpactCleanupBinding
            );
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    /** 맵 topology를 GPU backend에 컴파일합니다. */
    init(tileMap) {
        this.#assertUsable();
        if (this.initialized) {
            return this.backend.getRuntimeState() === 'gpu-ready';
        }
        const ready = this.backend.init(tileMap);
        this.initialized = true;
        return ready;
    }

    /** 다음 fixed 경계에 적용할 spawn을 예약합니다. */
    requestSpawn(intent, targetFixedTick, commandId = null) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress();
        if (rejected) {
            return rejected;
        }
        return this.lifecycleCommandOwner.requestSpawn(
            intent,
            targetFixedTick,
            commandId
        );
    }

    /** 다음 fixed 경계들에 적용할 spawn batch를 ingress에서 원자적으로 예약합니다. */
    requestSpawnBatch(requests) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress({
            requestedCount: Array.isArray(requests) ? requests.length : 0,
            queuedCount: 0
        });
        if (rejected) {
            return rejected;
        }
        return this.lifecycleCommandOwner.requestSpawnBatch(requests);
    }

    /** 다음 fixed 경계에 적용할 despawn을 예약합니다. */
    requestDespawn(handle, reason, targetFixedTick, commandId = null, options = null) {
        this.#assertUsable();
        return this.lifecycleCommandOwner.requestDespawn(
            handle,
            reason,
            targetFixedTick,
            commandId,
            options
        );
    }

    /** Exact active body에 move-only command를 다음 fixed tick 한 번 예약합니다. */
    requestBodyControl(command, targetFixedTick, commandId) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress();
        if (rejected) {
            return rejected;
        }
        return this.fixedCommandOwner.requestBodyControl(
            command,
            targetFixedTick,
            commandId
        );
    }

    /** Core-first inclusive GPU target selection command를 예약합니다. */
    requestPriorityTargetControl(command, targetFixedTick, commandId) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress();
        if (rejected) {
            return rejected;
        }
        let snapshot;
        try {
            snapshot = materializeGpuPlainDataSnapshot(
                command,
                'priorityTargetControl'
            );
        } catch {
            return Object.freeze({
                accepted: false,
                reason: 'priority-target-control-contract'
            });
        }
        const contractFailure = this.#validatePriorityTargetControl(snapshot);
        if (contractFailure) {
            return contractFailure;
        }
        return this.fixedCommandOwner.requestPriorityTargetControl(
            snapshot,
            targetFixedTick,
            commandId
        );
    }

    /** CPU pose를 거치지 않는 tick-start source-relative spawn을 예약합니다. */
    requestSourceRelativeSpawn(intent, targetFixedTick, commandId) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress();
        if (rejected) {
            return rejected;
        }
        return this.fixedCommandOwner.requestSourceRelativeSpawn(
            intent,
            targetFixedTick,
            commandId
        );
    }

    /** Same-tick priority control의 exact selected target projectile을 예약합니다. */
    requestSelectedTargetSpawn(intent, targetFixedTick, commandId) {
        this.#assertUsable();
        const rejected = this.#rejectClosedGameplayIngress();
        if (rejected) {
            return rejected;
        }
        let snapshot;
        try {
            snapshot = materializeGpuPlainDataSnapshot(
                intent,
                'selectedTargetSpawn'
            );
        } catch {
            return Object.freeze({
                accepted: false,
                reason: 'selected-target-spawn-contract'
            });
        }
        const contractFailure = this.#validateSelectedTargetSpawn(snapshot);
        if (contractFailure) {
            return contractFailure;
        }
        return this.fixedCommandOwner.requestSelectedTargetSpawn(
            snapshot,
            targetFixedTick,
            commandId
        );
    }

    /** GameObject-owned capability director에 주입하는 좁고 frozen인 Effect command port입니다. */
    getEffectCommandPort() {
        this.#assertUsable();
        return this.effectCommandOwner.getCommandPort();
    }

    /** GameObject-owned Formation director에 주입하는 bounded command port입니다. */
    getFormationCommandPort() {
        this.#assertUsable();
        return this.#formationCommandOwner.getCommandPort();
    }

    /** J/C′ lineage director에 주입하는 GPU-authenticated transform port입니다. */
    getAtomicTransformCommandPort() {
        this.#assertUsable();
        return this.#atomicTransformCommandOwner.getCommandPort();
    }

    /** Ring capture director에만 노출되는 high-level frozen command port입니다. */
    getProjectileCaptureCommandPort() {
        this.#assertUsable();
        return this.#projectileCaptureCommandPort;
    }

    /** Arrow gameplay용 exact Tower target을 registry/backend parity 뒤에 설정합니다. */
    configureTowerGameplayTarget(handle = null) {
        this.#assertUsable();
        if (handle === null || handle === undefined) {
            let cleared;
            try {
                cleared = this.backend.configureTowerGameplayTarget?.(null)
                    ?? Object.freeze({
                        accepted: false,
                        reason: 'tower-gameplay-target-unsupported'
                    });
            } catch (error) {
                return this.#failTowerGameplayTargetBackend(
                    'tower-gameplay-target-clear-threw',
                    error
                );
            }
            if (cleared?.accepted !== true) {
                return this.#failTowerGameplayTargetBackend(
                    cleared?.reason ?? 'tower-gameplay-target-clear-rejected'
                );
            }
            this.towerGameplayTargetDiagnostic = null;
            return Object.freeze({ accepted: true, configured: null });
        }
        if (!this.gameplayIngressOpen) {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'gameplay-ingress-closed'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        const entityId = Number(handle?.entityId);
        const incarnation = Number(handle?.incarnation);
        if (!Number.isSafeInteger(entityId) || entityId <= 0
            || !Number.isSafeInteger(incarnation) || incarnation <= 0) {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'tower-gameplay-target-handle-invalid'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        const exactHandle = { entityId, incarnation };
        let registryHas;
        let backendHas;
        try {
            registryHas = this.registry.has(exactHandle);
            backendHas = this.backend.hasBody(exactHandle);
        } catch {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'tower-gameplay-target-handle-invalid'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        if (registryHas !== backendHas) {
            this.completedEventRecoveryRequired = true;
            this.completedEventProtocolFailure = Object.freeze({
                stage: 'tower-gameplay-target-config',
                code: 'registry-backend-desync',
                name: 'TowerGameplayTargetIdentityMismatch',
                message: 'Tower gameplay target identity가 registry/backend에서 일치하지 않습니다.'
            });
            const rejected = Object.freeze({
                accepted: false,
                reason: 'registry-backend-desync'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        if (!registryHas) {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'stale-handle'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        let view;
        try {
            view = this.registry.copyEntityView(exactHandle, {});
        } catch (error) {
            return this.#failTowerGameplayTargetBackend(
                'tower-gameplay-target-registry-view-failed',
                error
            );
        }
        if (!view
            || view.entityId !== entityId
            || view.incarnation !== incarnation
            || view.kindId !== GPU_TOWER_WORLD_KIND_ID
            || view.definitionId !== GPU_TOWER_DEFINITION_ID) {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'tower-kind-definition-invalid'
            });
            this.towerGameplayTargetDiagnostic = rejected;
            return rejected;
        }
        let configured;
        try {
            configured = this.backend.configureTowerGameplayTarget?.(
                exactHandle
            ) ?? Object.freeze({
                accepted: false,
                reason: 'tower-gameplay-target-unsupported'
            });
        } catch (error) {
            return this.#failTowerGameplayTargetBackend(
                'tower-gameplay-target-config-threw',
                error
            );
        }
        if (configured?.accepted !== true) {
            return this.#failTowerGameplayTargetBackend(
                configured?.reason ?? 'tower-gameplay-target-config-rejected'
            );
        }
        this.towerGameplayTargetDiagnostic = null;
        return Object.freeze({
            accepted: true,
            configured: Object.freeze({ ...exactHandle })
        });
    }

    /** 완료된 Effect pulse program을 다음 cadence 관찰용 bounded snapshot으로 확정합니다. */
    commitCompletedEffectProgramsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        return this.effectCommandOwner.commitCompletedAtFixedBoundary(
            targetFixedTick
        );
    }

    /** 완료된 GPU Formation prepare를 N+1 publication boundary에 확정합니다. */
    commitCompletedFormationProgramsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        return this.#formationCommandOwner.commitCompletedAtFixedBoundary(
            targetFixedTick
        );
    }

    /** T-1 말단 GPU prepare proof를 T publication 경계에서 확정합니다. */
    commitCompletedAtomicTransformProgramsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        return this.#atomicTransformCommandOwner.commitCompletedAtFixedBoundary(
            targetFixedTick
        );
    }

    commitCompletedProjectileCaptureProgramsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        if (!this.projectileCaptureBackendSupported) {
            const unsupportedSourceTick = !this.gameplayIngressOpen
                    && this.projectileCaptureTerminalOwnerStatus
                        ?.finalFixedTick === tick
                ? tick
                : tick - 1;
            if (this.lastAcceptedProjectileCaptureSnapshot
                    ?.targetFixedTick === tick
                && this.lastAcceptedProjectileCaptureSnapshot.snapshot
                    .sourceTick === unsupportedSourceTick) {
                return this.lastAcceptedProjectileCaptureSnapshot.snapshot;
            }
            if (!this.#hasProjectileCaptureRegistryDomain()) {
                const sourceTick = unsupportedSourceTick;
                this.#rememberAcceptedProjectileCaptureProtocol({
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: 0,
                    authoritativeEpoch: 0,
                    sourceTick,
                    completedThroughTick: sourceTick,
                    idle: true,
                    unsupported: true
                });
                const snapshot = Object.freeze({
                    abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: 0,
                    authoritativeEpoch: 0,
                    sourceTick,
                    completedThroughTick: sourceTick,
                    status: GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE,
                    errorFlags: 0,
                    batchIdFingerprint: 0,
                    pending: false,
                    capacityRejected: false,
                    retryable: false,
                    rejectionReason: null,
                    capacityRejectionFlags: 0,
                    retryBatch: false,
                    retryBacklogRemaining: false,
                    retryOriginTick: 0,
                    captureDemandCount: 0,
                    releasePreparationDemandCount: 0,
                    cleanupDemandCount: 0,
                    captureCapacity: 0,
                    releasePreparationCapacity: 0,
                    cleanupCapacity: 0,
                    protocolFailure: null,
                    captures: Object.freeze([]),
                    releasePreparations: Object.freeze([]),
                    cleanups: Object.freeze([])
                });
                this.lastAcceptedProjectileCaptureSnapshot = Object.freeze({
                    targetFixedTick: tick,
                    snapshot
                });
                return snapshot;
            }
            return Object.freeze({
                pending: false,
                protocolFailure: Object.freeze({
                    code: 'projectile-capture-backend-unavailable',
                    message: 'backend가 ProjectileCapture runtime을 지원하지 않습니다.'
                }),
                captures: Object.freeze([]),
                releasePreparations: Object.freeze([]),
                cleanups: Object.freeze([])
            });
        }
        const terminalBoundary = !this.gameplayIngressOpen
            && this.projectileCaptureTerminalOwnerStatus?.finalFixedTick === tick;
        const requiredSourceTick = terminalBoundary ? tick : tick - 1;
        const protocolStatus = this.backend.getProjectileCaptureRuntimeStatus();
        const replay = this.lastAcceptedProjectileCaptureSnapshot;
        if (replay?.targetFixedTick === tick
            && replay.snapshot.sourceTick === requiredSourceTick
            && replay.snapshot.deviceGeneration
                === protocolStatus.deviceGeneration
            && replay.snapshot.authoritativeEpoch
                === protocolStatus.authoritativeEpoch) {
            return replay.snapshot;
        }
        const batches = [];
        this.backend.drainCompletedProjectileCaptureBatches(batches);
        if (batches.length > 1) {
            return Object.freeze({
                pending: false,
                protocolFailure: Object.freeze({
                    code: 'projectile-capture-mixed-batches',
                    message: '한 publication 호출에 둘 이상의 capture batch가 섞였습니다.'
                }),
                captures: Object.freeze([]),
                releasePreparations: Object.freeze([]),
                cleanups: Object.freeze([])
            });
        }
        if (batches.length === 1) {
            const batch = batches[0];
            const capacityRejectionFlags = Number(
                batch.capacityRejectionFlags
            ) >>> 0;
            const captureDemandCount = Number(batch.captureDemandCount);
            const releasePreparationDemandCount = Number(
                batch.releasePreparationDemandCount
            );
            const cleanupDemandCount = Number(batch.cleanupDemandCount);
            const captureCapacity = Number(batch.captureCapacity);
            const releasePreparationCapacity = Number(
                batch.releasePreparationCapacity
            );
            const cleanupCapacity = Number(batch.cleanupCapacity);
            const exactCapacityRejected = batch.capacityRejected === true
                && batch.retryable === true
                && batch.retryBatch !== true
                && batch.retryBacklogRemaining !== true
                && (batch.retryOriginTick ?? 0) === 0
                && batch.rejectionReason
                    === 'projectile-capture-completion-capacity'
                && batch.status === GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED
                && batch.errorFlags
                    === GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG
                        .COMPLETION_CAPACITY
                && batch.batchIdFingerprint === 0
                && capacityRejectionFlags !== 0
                && (capacityRejectionFlags
                    & ~PROJECTILE_CAPTURE_CAPACITY_REJECTION_KNOWN_FLAGS) === 0
                && Number.isSafeInteger(captureDemandCount)
                && Number.isSafeInteger(releasePreparationDemandCount)
                && Number.isSafeInteger(cleanupDemandCount)
                && Number.isSafeInteger(captureCapacity)
                && Number.isSafeInteger(releasePreparationCapacity)
                && Number.isSafeInteger(cleanupCapacity)
                && captureDemandCount >= 0 && captureCapacity > 0
                && releasePreparationDemandCount >= 0
                && releasePreparationCapacity > 0
                && cleanupDemandCount >= 0 && cleanupCapacity > 0
                && Boolean(capacityRejectionFlags
                    & GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG.CAPTURE)
                    === (captureDemandCount > captureCapacity)
                && Boolean(capacityRejectionFlags
                    & GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG
                        .RELEASE_PREPARATION)
                    === (releasePreparationDemandCount
                        > releasePreparationCapacity)
                && Boolean(capacityRejectionFlags
                    & GPU_PROJECTILE_CAPTURE_CAPACITY_REJECTION_FLAG.CLEANUP)
                    === (cleanupDemandCount > cleanupCapacity)
                && batch.captures?.length === 0
                && batch.releasePreparations?.length === 0
                && batch.cleanups?.length === 0
                && protocolStatus.runtimeStatus
                    === GPU_PROJECTILE_CAPTURE_TICK_STATUS.REJECTED
                && protocolStatus.errorFlags
                    === GPU_PROJECTILE_CAPTURE_RUNTIME_ERROR_FLAG
                        .COMPLETION_CAPACITY
                && protocolStatus.retryableCapacityRejected === true
                && protocolStatus.capacityRejectionFlags
                    === capacityRejectionFlags
                && protocolStatus.requiresRecovery === false;
            const exactRetryBatch = batch.capacityRejected !== true
                && batch.retryable !== true
                && (batch.rejectionReason ?? null) === null
                && batch.retryBatch === true
                && typeof batch.retryBacklogRemaining === 'boolean'
                && Number.isSafeInteger(batch.retryOriginTick)
                && batch.retryOriginTick > 0
                && batch.retryOriginTick < batch.sourceTick
                && capacityRejectionFlags !== 0
                && (capacityRejectionFlags
                    & ~PROJECTILE_CAPTURE_CAPACITY_REJECTION_KNOWN_FLAGS) === 0
                && batch.status === GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                && batch.errorFlags === 0
                && protocolStatus.retryMode === batch.retryBacklogRemaining
                && (batch.retryBacklogRemaining !== true
                    || (protocolStatus.retryOriginTick === batch.retryOriginTick
                        && protocolStatus.capacityRejectionFlags
                            === capacityRejectionFlags));
            const completedNormally = batch.capacityRejected !== true
                && batch.retryable !== true
                && (batch.rejectionReason ?? null) === null
                && batch.retryBatch !== true
                && batch.retryBacklogRemaining !== true
                && (batch.retryOriginTick ?? 0) === 0
                && (batch.capacityRejectionFlags ?? 0) === 0
                && batch.status === GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                && batch.errorFlags === 0;
            if (batch.failure
                || batch.abiVersion
                    !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
                || (!completedNormally
                    && !exactRetryBatch
                    && !exactCapacityRejected)
                || !Array.isArray(batch.captures)
                || !Array.isArray(batch.releasePreparations)
                || !Array.isArray(batch.cleanups)
                || batch.sessionGeneration !== this.sessionGeneration
                || batch.deviceGeneration !== protocolStatus.deviceGeneration
                || batch.authoritativeEpoch
                    !== protocolStatus.authoritativeEpoch
                || batch.sourceTick !== requiredSourceTick
                || batch.completedThroughTick !== batch.sourceTick) {
                return Object.freeze({
                    ...batch,
                    pending: false,
                    protocolFailure: batch.failure ?? Object.freeze({
                        code: 'projectile-capture-envelope-invalid',
                        message: 'capture completion envelope가 current boundary와 다릅니다.'
                    })
                });
            }
            for (const preparation of batch.releasePreparations ?? []) {
                if (!Object.isFrozen(preparation?.prepareEvidence)) {
                    return Object.freeze({
                        ...batch,
                        pending: false,
                        protocolFailure: Object.freeze({
                            code: 'projectile-capture-prepare-evidence-invalid',
                            message: 'release prepare evidence가 frozen authentic object가 아닙니다.'
                        })
                    });
                }
            }
            if (!exactCapacityRejected) {
                const deferredDeathFailure
                    = this.#stageDeferredProjectileCaptureDeaths(
                        batch,
                        tick
                    );
                if (deferredDeathFailure) {
                    return Object.freeze({
                        ...batch,
                        pending: false,
                        protocolFailure: deferredDeathFailure
                    });
                }
            }
            for (const preparation of batch.releasePreparations ?? []) {
                this.#authenticProjectileCapturePrepareEvidence.add(
                    preparation.prepareEvidence
                );
            }
            this.#rememberAcceptedProjectileCaptureProtocol({
                sessionGeneration: batch.sessionGeneration,
                deviceGeneration: batch.deviceGeneration,
                authoritativeEpoch: batch.authoritativeEpoch,
                sourceTick: batch.sourceTick,
                completedThroughTick: batch.completedThroughTick,
                capacityRejected: exactCapacityRejected,
                capacityRejectionFlags: exactCapacityRejected
                    ? capacityRejectionFlags
                    : 0
            });
            const snapshot = Object.freeze({
                ...batch,
                pending: false,
                protocolFailure: null
            });
            this.lastAcceptedProjectileCaptureSnapshot = Object.freeze({
                targetFixedTick: tick,
                snapshot
            });
            return snapshot;
        }
        const status = protocolStatus;
        const pending = (terminalBoundary
                || status.activeDomainBodyCount > 0
                || status.pendingCaptureReadbackCount > 0
                || status.pendingCaptureBatchCount > 0)
            && status.completedThroughTick < requiredSourceTick
            || status.pendingCaptureReadbackCount > 0
            || status.pendingCaptureBatchCount > 0;
        const idleBoundary = !pending
            && status.activeDomainBodyCount === 0
            && status.pendingCaptureReadbackCount === 0
            && status.pendingCaptureBatchCount === 0;
        if (idleBoundary) {
            this.#rememberAcceptedProjectileCaptureProtocol({
                sessionGeneration: status.sessionGeneration,
                deviceGeneration: status.deviceGeneration,
                authoritativeEpoch: status.authoritativeEpoch,
                sourceTick: requiredSourceTick,
                completedThroughTick: requiredSourceTick,
                idle: true
            });
        }
        const snapshot = Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            sessionGeneration: status.sessionGeneration,
            deviceGeneration: status.deviceGeneration,
            authoritativeEpoch: status.authoritativeEpoch,
            sourceTick: idleBoundary
                ? requiredSourceTick
                : status.completedThroughTick,
            completedThroughTick: idleBoundary
                ? requiredSourceTick
                : status.completedThroughTick,
            status: idleBoundary
                ? GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                : status.runtimeStatus,
            errorFlags: status.errorFlags,
            batchIdFingerprint: 0,
            pending,
            capacityRejected: false,
            retryable: false,
            rejectionReason: null,
            capacityRejectionFlags: 0,
            retryBatch: false,
            retryBacklogRemaining: false,
            retryOriginTick: 0,
            captureDemandCount: 0,
            releasePreparationDemandCount: 0,
            cleanupDemandCount: 0,
            captureCapacity: status.captureCapacity ?? 0,
            releasePreparationCapacity:
                status.releasePreparationCapacity ?? 0,
            cleanupCapacity: status.cleanupCapacity ?? 0,
            captures: Object.freeze([]),
            releasePreparations: Object.freeze([]),
            cleanups: Object.freeze([]),
            protocolFailure: null
        });
        if (!pending) {
            this.lastAcceptedProjectileCaptureSnapshot = Object.freeze({
                targetFixedTick: tick,
                snapshot
            });
        }
        return snapshot;
    }

    commitCompletedProjectileCaptureReleaseProgramsAtFixedBoundary(
        targetFixedTick
    ) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        if (!this.projectileCaptureBackendSupported) {
            const unsupportedSourceTick = !this.gameplayIngressOpen
                    && this.projectileCaptureTerminalOwnerStatus
                        ?.finalFixedTick === tick
                ? tick
                : tick - 1;
            if (this.lastAcceptedProjectileCaptureReleaseSnapshot
                    ?.targetFixedTick === tick
                && this.lastAcceptedProjectileCaptureReleaseSnapshot.snapshot
                    .sourceTick === unsupportedSourceTick) {
                return this.lastAcceptedProjectileCaptureReleaseSnapshot
                    .snapshot;
            }
            if (!this.#hasProjectileCaptureRegistryDomain()) {
                const sourceTick = unsupportedSourceTick;
                const snapshot = Object.freeze({
                    abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                    sessionGeneration: this.sessionGeneration,
                    deviceGeneration: 0,
                    authoritativeEpoch: 0,
                    sourceTick,
                    completedThroughTick: sourceTick,
                    publicationFixedTick: sourceTick,
                    status: GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE,
                    errorFlags: 0,
                    batchIdFingerprint: 0,
                    pending: false,
                    protocolFailure: null,
                    releaseCompletions: Object.freeze([])
                });
                this.lastAcceptedProjectileCaptureReleaseSnapshot
                    = Object.freeze({ targetFixedTick: tick, snapshot });
                return snapshot;
            }
            return Object.freeze({
                pending: false,
                protocolFailure: Object.freeze({
                    code: 'projectile-capture-backend-unavailable',
                    message: 'backend가 ProjectileCapture runtime을 지원하지 않습니다.'
                }),
                releaseCompletions: Object.freeze([])
            });
        }
        const terminalBoundary = !this.gameplayIngressOpen
            && this.projectileCaptureTerminalOwnerStatus?.finalFixedTick === tick;
        const requiredSourceTick = terminalBoundary ? tick : tick - 1;
        const protocolStatus = this.backend.getProjectileCaptureRuntimeStatus();
        const replay = this.lastAcceptedProjectileCaptureReleaseSnapshot;
        if (replay?.targetFixedTick === tick
            && replay.snapshot.sourceTick === requiredSourceTick
            && replay.snapshot.deviceGeneration
                === protocolStatus.deviceGeneration
            && replay.snapshot.authoritativeEpoch
                === protocolStatus.authoritativeEpoch) {
            return replay.snapshot;
        }
        const batches = [];
        this.backend.drainCompletedProjectileCaptureReleaseBatches(batches);
        if (batches.length > 1) {
            return Object.freeze({
                pending: false,
                protocolFailure: Object.freeze({
                    code: 'projectile-capture-release-mixed-batches',
                    message: '한 publication 호출에 둘 이상의 release batch가 섞였습니다.'
                }),
                releaseCompletions: Object.freeze([])
            });
        }
        if (batches.length === 1) {
            const batch = batches[0];
            if (batch.failure
                || batch.abiVersion
                    !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
                || batch.status !== GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
                || batch.errorFlags !== 0
                || !Array.isArray(batch.releaseCompletions)
                || batch.sessionGeneration !== this.sessionGeneration
                || batch.deviceGeneration !== protocolStatus.deviceGeneration
                || batch.authoritativeEpoch
                    !== protocolStatus.authoritativeEpoch
                || batch.sourceTick !== requiredSourceTick
                || batch.completedThroughTick !== batch.sourceTick) {
                return Object.freeze({
                    ...batch,
                    pending: false,
                    protocolFailure: batch.failure ?? Object.freeze({
                        code: 'projectile-capture-release-envelope-invalid',
                        message: 'release completion envelope가 current boundary와 다릅니다.'
                    })
                });
            }
            const snapshot = Object.freeze({
                ...batch,
                pending: false,
                protocolFailure: null
            });
            this.lastAcceptedProjectileCaptureReleaseSnapshot
                = Object.freeze({ targetFixedTick: tick, snapshot });
            return snapshot;
        }
        const status = protocolStatus;
        const pending = status.pendingReleaseReadbackCount > 0
            || status.pendingReleaseBatchCount > 0
            || status.commitRequested === true;
        const terminalEmptyReleaseSettled = terminalBoundary
            && status.terminal?.state === 'settled'
            && status.terminal.accepted === true
            && status.terminal.finalFixedTick === requiredSourceTick
            && status.terminal.submittedTick === requiredSourceTick
            && status.terminal.completedThroughTick === requiredSourceTick
            && status.terminal.pendingReleaseReadbackCount === 0
            && status.terminal.pendingCompletionBatchCount === 0
            && status.terminal.failure === null;
        const completedReleaseSourceTick = terminalEmptyReleaseSettled
            ? requiredSourceTick
            : status.lastReleaseCommittedTick;
        const priorCanonical = this
            .lastAcceptedProjectileCaptureReleaseSnapshot?.snapshot;
        if (!pending
            && priorCanonical
            && priorCanonical.protocolFailure === null
            && priorCanonical.pending === false
            && priorCanonical.status
                === GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
            && priorCanonical.errorFlags === 0
            && priorCanonical.sessionGeneration === status.sessionGeneration
            && priorCanonical.deviceGeneration === status.deviceGeneration
            && priorCanonical.authoritativeEpoch
                === status.authoritativeEpoch
            && priorCanonical.sourceTick === completedReleaseSourceTick
            && priorCanonical.completedThroughTick
                === completedReleaseSourceTick
            && priorCanonical.publicationFixedTick
                === completedReleaseSourceTick) {
            return priorCanonical;
        }
        const snapshot = Object.freeze({
            abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
            sessionGeneration: status.sessionGeneration,
            deviceGeneration: status.deviceGeneration,
            authoritativeEpoch: status.authoritativeEpoch,
            sourceTick: completedReleaseSourceTick,
            completedThroughTick: completedReleaseSourceTick,
            publicationFixedTick: completedReleaseSourceTick,
            status: GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE,
            errorFlags: 0,
            batchIdFingerprint: 0,
            pending,
            releaseCompletions: Object.freeze([]),
            protocolFailure: null
        });
        if (snapshot.pending !== true) {
            this.lastAcceptedProjectileCaptureReleaseSnapshot
                = Object.freeze({ targetFixedTick: tick, snapshot });
        }
        return snapshot;
    }

    getProjectileCaptureRuntimeStatus() {
        if (!this.projectileCaptureBackendSupported) {
            const hasCaptureDomain = !this.destroyed
                && this.#hasProjectileCaptureRegistryDomain();
            const terminal = this.projectileCaptureTerminalBackendStatus;
            const terminalSettled = terminal?.state === 'settled'
                && terminal.accepted === true
                && terminal.failure === null;
            const completedThroughTick = terminalSettled
                ? terminal.completedThroughTick
                : 0;
            return Object.freeze({
                abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                state: this.destroyed ? 'destroyed' : 'unsupported',
                sessionGeneration: terminal?.sessionGeneration
                    ?? this.sessionGeneration,
                deviceGeneration: terminal?.deviceGeneration ?? 0,
                authoritativeEpoch: terminal?.authoritativeEpoch ?? 0,
                activeDomainBodyCount: 0,
                stagedReleaseCount: 0,
                pendingCaptureReadbackCount: 0,
                pendingReleaseReadbackCount: 0,
                pendingCaptureBatchCount: 0,
                pendingReleaseBatchCount: 0,
                preparedBatchCount: 0,
                sourceTick: completedThroughTick,
                completedThroughTick,
                lastReleaseCommittedTick:
                    terminal?.lastReleaseCommittedTick ?? 0,
                runtimeStatus: GPU_PROJECTILE_CAPTURE_TICK_STATUS.RESET,
                errorFlags: 0,
                capacityRejected: false,
                retryableCapacityRejected: false,
                capacityRejectionFlags: 0,
                retryMode: false,
                retryOriginTick: 0,
                retryBacklogRemaining: false,
                requiresRecovery: hasCaptureDomain,
                failure: hasCaptureDomain
                    ? 'projectile-capture-backend-unavailable'
                    : null,
                terminal
            });
        }
        return this.backend.getProjectileCaptureRuntimeStatus();
    }

    getTerminalProjectileCaptureProgramCancelStatus() {
        const backend = this.projectileCaptureBackendSupported
            ? this.backend.getTerminalProjectileCaptureProgramCancelStatus()
            : this.projectileCaptureTerminalBackendStatus;
        const initialOwner = this.projectileCaptureTerminalOwnerStatus;
        const hostCleanup = this.projectileCaptureTerminalHostCleanup;
        const finalFixedTick = initialOwner?.finalFixedTick ?? 0;
        const backendBindingMatchesOwner = initialOwner !== null
            && backend?.abiVersion === initialOwner.abiVersion
            && backend.sessionGeneration === initialOwner.sessionGeneration
            && backend.deviceGeneration === initialOwner.deviceGeneration
            && backend.authoritativeEpoch === initialOwner.authoritativeEpoch;
        const captureEnvelope = this.lastAcceptedProjectileCaptureSnapshot;
        const captureCompletionObserved = initialOwner !== null
            && captureEnvelope?.targetFixedTick === finalFixedTick
            && captureEnvelope.snapshot?.abiVersion === initialOwner.abiVersion
            && captureEnvelope.snapshot.sessionGeneration
                === initialOwner.sessionGeneration
            && captureEnvelope.snapshot.deviceGeneration
                === initialOwner.deviceGeneration
            && captureEnvelope.snapshot.authoritativeEpoch
                === initialOwner.authoritativeEpoch
            && captureEnvelope.snapshot.sourceTick === finalFixedTick
            && captureEnvelope.snapshot.completedThroughTick === finalFixedTick
            && captureEnvelope.snapshot.status
                === GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
            && captureEnvelope.snapshot.errorFlags === 0
            && captureEnvelope.snapshot.pending === false
            && captureEnvelope.snapshot.protocolFailure === null;
        const releaseEnvelope
            = this.lastAcceptedProjectileCaptureReleaseSnapshot;
        const releaseCompletionObserved = initialOwner !== null
            && releaseEnvelope?.targetFixedTick === finalFixedTick
            && releaseEnvelope.snapshot?.abiVersion === initialOwner.abiVersion
            && releaseEnvelope.snapshot.sessionGeneration
                === initialOwner.sessionGeneration
            && releaseEnvelope.snapshot.deviceGeneration
                === initialOwner.deviceGeneration
            && releaseEnvelope.snapshot.authoritativeEpoch
                === initialOwner.authoritativeEpoch
            && releaseEnvelope.snapshot.sourceTick === finalFixedTick
            && releaseEnvelope.snapshot.completedThroughTick === finalFixedTick
            && releaseEnvelope.snapshot.publicationFixedTick === finalFixedTick
            && releaseEnvelope.snapshot.status
                === GPU_PROJECTILE_CAPTURE_TICK_STATUS.COMPLETE
            && releaseEnvelope.snapshot.errorFlags === 0
            && releaseEnvelope.snapshot.pending === false
            && releaseEnvelope.snapshot.protocolFailure === null;
        const ownerCompletionObserved
            = captureCompletionObserved && releaseCompletionObserved;
        const bindingFailure = initialOwner !== null
                && backend !== null
                && !backendBindingMatchesOwner
            ? 'projectile-capture-terminal-binding-drift'
            : null;
        const ownerFailure = initialOwner?.failure
            ?? bindingFailure
            ?? backend?.failure
            ?? hostCleanup.failure
            ?? null;
        const owner = initialOwner
            ? Object.freeze({
                ...initialOwner,
                accepted: initialOwner.accepted === true
                    && ownerFailure === null,
                submittedTick: ownerCompletionObserved
                    ? finalFixedTick
                    : initialOwner.submittedTick,
                completedThroughTick: ownerCompletionObserved
                    ? finalFixedTick
                    : initialOwner.completedThroughTick,
                state: ownerFailure !== null
                    ? 'failed'
                    : backendBindingMatchesOwner
                        && backend?.state === 'settled'
                        && hostCleanup.pendingHeldDespawnCount === 0
                        && ownerCompletionObserved
                        ? 'settled'
                        : 'armed',
                pendingPreparedBatchCount:
                    backend?.unpublishedPreparedProofCount ?? 0,
                armedBatchCount: backend?.stagedReleaseCount ?? 0,
                terminalHeldDespawnRequestCount:
                    hostCleanup.requestedHeldDespawnCount,
                failure: ownerFailure
            })
            : null;
        return Object.freeze({
            owner,
            backend,
            hostCleanup
        });
    }

    getRouteAvailabilityRuntimeStatus() {
        if (!this.routeAvailabilityBackendSupported) {
            return Object.freeze({
                abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                state: this.destroyed ? 'destroyed' : 'unsupported',
                sessionGeneration: this.sessionGeneration,
                deviceGeneration: 0,
                authoritativeEpoch: 0,
                ingressOpen: false,
                graphEnabled: false,
                graphContentKey: 'route-graph-unavailable',
                closureCount: 0,
                availabilityVersion: 1,
                closedPathIds: Object.freeze([]),
                rosterCount: 0,
                capacity: ROUTE_AVAILABILITY_MAX_CORK_ROSTER,
                leaseCount: 0,
                lifecycleReservationCount: 0,
                stagedCount: 0,
                commitRequested: false,
                pendingReadbackCount: 0,
                queuedBatchCount: 0,
                completedThroughTick: 0,
                completedReadbackBypassSourceTick: 0,
                requiresRecovery: false,
                failure: null,
                terminal: null
            });
        }
        return this.backend.getRouteAvailabilityRuntimeStatus();
    }

    getTerminalRouteAvailabilityProgramCancelStatus() {
        const backend = this.routeAvailabilityBackendSupported
            ? this.backend.getTerminalRouteAvailabilityProgramCancelStatus()
            : this.routeAvailabilityTerminalBackendStatus;
        const runtime = this.getRouteAvailabilityRuntimeStatus();
        const cleanupPort = this.routeAvailabilityBackendSupported
            ? this.backend.getRouteLifecyclePortStatus()
            : null;
        const hostCleanup = this.routeAvailabilityTerminalHostCleanup;
        const initialOwner = this.routeAvailabilityTerminalOwnerStatus;
        if (!initialOwner && !backend) return null;
        const allOpen = backend?.allOpen === true
            && backend?.leaseCount === 0
            && Array.isArray(backend?.closedPathIds)
            && backend.closedPathIds.length === 0;
        const cleanupSettled = cleanupPort
            && cleanupPort.reservationCount === 0
            && cleanupPort.stagedCleanupCount === 0
            && cleanupPort.pendingReadbackCount === 0
            && cleanupPort.requiresRecovery === false
            && hostCleanup.pendingCount === 0
            && hostCleanup.failure === null;
        const backendSettled = backend?.state === 'settled'
            && backend.accepted === true
            && backend.rosterCount === 0
            && backend.stagedCount === 0
            && backend.commitRequested === false
            && backend.pendingReadbackCount === 0
            && allOpen;
        const state = backend?.state === 'failed'
                || cleanupPort?.requiresRecovery === true
                || hostCleanup.failure !== null
            ? 'failed'
            : backendSettled && cleanupSettled ? 'settled' : 'armed';
        const finalFixedTick = initialOwner?.finalFixedTick
            ?? backend?.finalFixedTick ?? 0;
        const owner = Object.freeze({
            ...(initialOwner ?? {}),
            state,
            accepted: state !== 'failed',
            finalFixedTick,
            completedThroughTick: backend?.completedThroughTick ?? 0,
            rosterSealed: backendSettled && cleanupSettled,
            rosterCount: runtime.rosterCount,
            closedPathIds: runtime.closedPathIds,
            failure: backend?.failure ?? cleanupPort?.failure
                ?? hostCleanup.failure ?? null
        });
        const lifecycleCleanup = Object.freeze({
            abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
            state,
            accepted: state !== 'failed',
            finalFixedTick,
            completedThroughTick: backend?.completedThroughTick ?? 0,
            reservationCount: cleanupPort?.reservationCount ?? 0,
            stagedCount: cleanupPort?.stagedCleanupCount ?? 0,
            pendingReadbackCount: cleanupPort?.pendingReadbackCount ?? 0,
            requestedCount: hostCleanup.requestedCount,
            completedCount: hostCleanup.completedCount,
            pendingCount: hostCleanup.pendingCount,
            failure: cleanupPort?.failure ?? hostCleanup.failure ?? null
        });
        return Object.freeze({
            abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
            state,
            accepted: state !== 'failed',
            finalFixedTick,
            failure: owner.failure,
            owner,
            backend,
            lifecycleCleanup
        });
    }

    /** Session당 exact GPU body 하나의 lossy observed-pose tracking을 설정합니다. */
    configureTrackedBody(handle = null) {
        this.#assertUsable();
        if (handle !== null && handle !== undefined) {
            let registryHas;
            let backendHas;
            try {
                registryHas = this.registry.has(handle);
                backendHas = this.backend.hasBody(handle);
            } catch {
                const rejected = Object.freeze({
                    accepted: false,
                    reason: 'tracked-pose-handle-invalid'
                });
                this.trackedPoseDiagnostic = rejected;
                return rejected;
            }
            if (!registryHas && !backendHas) {
                const rejected = Object.freeze({
                    accepted: false,
                    reason: 'stale-handle'
                });
                this.trackedPoseDiagnostic = rejected;
                return rejected;
            }
            if (registryHas !== backendHas) {
                const rejected = Object.freeze({
                    accepted: false,
                    reason: 'registry-backend-desync'
                });
                this.trackedPoseDiagnostic = rejected;
                return rejected;
            }
        }
        try {
            const configured = this.backend.configureTrackedBody?.(handle)
                ?? Object.freeze({
                    accepted: false,
                    reason: 'fixed-primitives-unsupported'
                });
            this.trackedPoseDiagnostic = configured.accepted === true
                ? null
                : Object.freeze({
                    reason: configured.reason ?? 'backend-rejected'
                });
            return configured;
        } catch {
            const rejected = Object.freeze({
                accepted: false,
                reason: 'tracked-pose-unavailable'
            });
            this.trackedPoseDiagnostic = rejected;
            return rejected;
        }
    }

    /**
     * 새 gameplay producer ingress를 영구히 닫고 이미 예약된 gameplay command도
     * 회수합니다. committed GPU-death와 전용 port의 Core-impact cleanup만 마지막
     * lifecycle commit까지 보존됩니다.
     */
    closeGameplayIngress(reason = 'run-defeated', finalFixedTick = null) {
        this.#assertUsable();
        if (this.gameplayIngressOpen) {
            this.gameplayIngressOpen = false;
            this.gameplayIngressCloseReason = typeof reason === 'string' && reason.length > 0
                ? reason
                : 'run-defeated';
            const terminalFixedTick = finalFixedTick ?? 1;
            const routeTerminalCleanup = this.#stageRouteTerminalCleanups(
                terminalFixedTick
            );
            const lifecycle = this.lifecycleCommandOwner.closeIngress(
                this.gameplayIngressCloseReason
            );
            const fixedCommands = this.fixedCommandOwner.closeIngress(
                this.gameplayIngressCloseReason,
                finalFixedTick
            );
            const effectCommands = this.effectCommandOwner.closeIngress(
                this.gameplayIngressCloseReason,
                finalFixedTick
            );
            const formationCommands = this.#formationCommandOwner.closeIngress(
                this.gameplayIngressCloseReason,
                finalFixedTick
            );
            const atomicTransformCommands
                = this.#atomicTransformCommandOwner.closeForTerminal(
                    finalFixedTick ?? 1
                );
            const projectileCaptureRuntimeBinding
                = this.projectileCaptureBackendSupported
                    ? this.backend.getProjectileCaptureRuntimeStatus()
                    : Object.freeze({
                        abiVersion: GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                        sessionGeneration: this.sessionGeneration,
                        deviceGeneration: 0,
                        authoritativeEpoch: 0
                    });
            const projectileCaptureRuntimeBindingValid
                = projectileCaptureRuntimeBinding?.abiVersion
                    === GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
                && Number.isSafeInteger(
                    projectileCaptureRuntimeBinding.sessionGeneration
                )
                && projectileCaptureRuntimeBinding.sessionGeneration > 0
                && projectileCaptureRuntimeBinding.sessionGeneration
                    <= 0xffffffff
                && Number.isSafeInteger(
                    projectileCaptureRuntimeBinding.deviceGeneration
                )
                && projectileCaptureRuntimeBinding.deviceGeneration >= 0
                && projectileCaptureRuntimeBinding.deviceGeneration
                    < 0xffffffff
                && Number.isSafeInteger(
                    projectileCaptureRuntimeBinding.authoritativeEpoch
                )
                && projectileCaptureRuntimeBinding.authoritativeEpoch >= 0
                && projectileCaptureRuntimeBinding.authoritativeEpoch
                    < 0xffffffff;
            const projectileCaptureCommands
                = this.projectileCaptureBackendSupported
                    ? this.backend
                        .cancelPendingProjectileCaptureProgramsForTerminal({
                            finalFixedTick: finalFixedTick ?? 1
                        })
                    : !this.#hasProjectileCaptureRegistryDomain()
                        ? Object.freeze({
                            abiVersion:
                                GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                            accepted: true,
                            state: 'settled',
                            finalFixedTick: finalFixedTick ?? 1,
                            sessionGeneration: this.sessionGeneration,
                            deviceGeneration: 0,
                            authoritativeEpoch: 0,
                            stagedReleaseCount: 0,
                            commitRequested: false,
                            unpublishedPreparedProofCount: 0,
                            pendingCaptureReadbackCount: 0,
                            pendingReleaseReadbackCount: 0,
                            pendingCompletionBatchCount: 0,
                            submittedTick: finalFixedTick ?? 1,
                            completedThroughTick: finalFixedTick ?? 1,
                            failure: null
                        })
                    : Object.freeze({
                        accepted: false,
                        state: 'failed',
                        finalFixedTick: finalFixedTick ?? 1,
                        failure: 'projectile-capture-backend-unavailable'
                    });
            const projectileCaptureCommandBindingValid
                = projectileCaptureRuntimeBindingValid
                && projectileCaptureCommands?.abiVersion
                    === projectileCaptureRuntimeBinding.abiVersion
                && projectileCaptureCommands.sessionGeneration
                    === projectileCaptureRuntimeBinding.sessionGeneration
                && projectileCaptureCommands.deviceGeneration
                    === projectileCaptureRuntimeBinding.deviceGeneration
                && projectileCaptureCommands.authoritativeEpoch
                    === projectileCaptureRuntimeBinding.authoritativeEpoch;
            const projectileCaptureOwnerFailure
                = !projectileCaptureRuntimeBindingValid
                    || !projectileCaptureCommandBindingValid
                ? 'projectile-capture-terminal-binding-drift'
                : projectileCaptureCommands?.accepted !== true
                        || projectileCaptureCommands?.state === 'failed'
                    ? projectileCaptureCommands?.failure
                        ?? 'projectile-capture-terminal-cancel-rejected'
                    : projectileCaptureCommands?.failure ?? null;
            this.projectileCaptureTerminalBackendStatus
                = projectileCaptureCommands;
            this.projectileCaptureDeferredDeathReceipts.clear();
            this.projectileCaptureTerminalOwnerStatus = Object.freeze({
                abiVersion: projectileCaptureRuntimeBinding?.abiVersion
                    ?? GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
                accepted: projectileCaptureCommands?.accepted === true
                    && projectileCaptureOwnerFailure === null,
                state: projectileCaptureCommands?.state === 'failed'
                        || projectileCaptureOwnerFailure !== null
                    ? 'failed'
                    : 'armed',
                finalFixedTick: finalFixedTick ?? 1,
                sessionGeneration:
                    projectileCaptureRuntimeBinding?.sessionGeneration
                        ?? this.sessionGeneration,
                deviceGeneration:
                    projectileCaptureRuntimeBinding?.deviceGeneration ?? 0,
                authoritativeEpoch:
                    projectileCaptureRuntimeBinding?.authoritativeEpoch ?? 0,
                submittedTick: 0,
                completedThroughTick: 0,
                pendingPreparedBatchCount:
                    projectileCaptureCommands
                        ?.unpublishedPreparedProofCount ?? 0,
                armedBatchCount:
                    projectileCaptureCommands?.stagedReleaseCount ?? 0,
                commitRequested:
                    projectileCaptureCommands?.commitRequested === true,
                terminalHeldDespawnRequestCount:
                    this.projectileCaptureTerminalHostCleanup
                        .requestedHeldDespawnCount,
                failure: projectileCaptureOwnerFailure
            });
            const routeAvailabilityCommands
                = !this.routeAvailabilityBackendSupported
                    ? Object.freeze({
                        abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                        accepted: true,
                        state: 'settled',
                        finalFixedTick: terminalFixedTick,
                        sessionGeneration: this.sessionGeneration,
                        deviceGeneration: 0,
                        authoritativeEpoch: 0,
                        availabilityVersion: 1,
                        rosterCount: 0,
                        closedPathIds: Object.freeze([]),
                        stagedCount: 0,
                        commitRequested: false,
                        pendingReadbackCount: 0,
                        completedThroughTick: finalFixedTick ?? 1,
                        failure: null
                    })
                    : Object.freeze({
                        abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                        accepted: routeTerminalCleanup.failure === null,
                        state: routeTerminalCleanup.failure === null
                            ? 'awaiting-lifecycle-cleanup'
                            : 'failed',
                        finalFixedTick: terminalFixedTick,
                        rosterCount: routeTerminalCleanup.pendingCount,
                        closedPathIds: Object.freeze([]),
                        stagedCount: routeTerminalCleanup.pendingCount,
                        commitRequested: false,
                        pendingReadbackCount: 0,
                        completedThroughTick: 0,
                        failure: routeTerminalCleanup.failure
                    });
            this.routeAvailabilityTerminalBackendStatus
                = routeAvailabilityCommands;
            this.routeAvailabilityTerminalOwnerStatus = Object.freeze({
                abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                accepted: routeAvailabilityCommands.accepted === true,
                state: routeAvailabilityCommands.state === 'failed'
                    ? 'failed'
                    : 'armed',
                finalFixedTick: terminalFixedTick,
                completedThroughTick: 0,
                rosterSealed: false,
                rosterCount: routeAvailabilityCommands.rosterCount ?? 0,
                closedPathIds: routeAvailabilityCommands.closedPathIds
                    ?? Object.freeze([]),
                failure: routeAvailabilityCommands.failure ?? null
            });
            this.#authenticProjectileCapturePrepareEvidence = new WeakSet();
            this.#authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
            this.gameplayIngressCloseCleanup = Object.freeze({
                lifecycle,
                fixedCommands,
                effectCommands,
                formationCommands,
                atomicTransformCommands,
                projectileCaptureCommands,
                routeAvailabilityCommands
            });
        }
        return Object.freeze({
            closed: !this.gameplayIngressOpen,
            reason: this.gameplayIngressCloseReason,
            cleanup: this.gameplayIngressCloseCleanup
        });
    }

    /** Terminal fixed-program cancel/마지막 submit의 양쪽 owner/backend 증거입니다. */
    getTerminalFixedProgramCancelStatus() {
        return Object.freeze({
            owner: this.fixedCommandOwner.getStatus().terminalCancelResult,
            backend: this.fixedPrimitiveBackendPort
                .getTerminalFixedProgramCancelStatus()
        });
    }

    /** Terminal Effect cancel owner/backend의 ABI/tick/count/pending 증거입니다. */
    getTerminalEffectProgramCancelStatus() {
        return this.effectCommandOwner.getTerminalCancelStatus();
    }

    /** Terminal Formation cancel owner/backend의 ABI/tick/pending 증거입니다. */
    getTerminalFormationProgramCancelStatus() {
        return this.#formationCommandOwner.getTerminalCancelStatus();
    }

    /** Terminal AtomicTransform owner/backend의 독립 ABI/tick/pending 증거입니다. */
    getTerminalAtomicTransformProgramCancelStatus() {
        return Object.freeze({
            owner: this.#atomicTransformCommandOwner.getTerminalCancelStatus(),
            backend: this.#atomicTransformBackendPort
                .getAtomicTransformRuntimeStatus().terminal
        });
    }

    /** @returns {boolean} public spawn/control/source-relative ingress가 열려 있는지 여부입니다. */
    isGameplayIngressOpen() {
        return !this.destroyed && this.gameplayIngressOpen;
    }

    /** terminal success/failure sealing에서 남은 privileged cleanup까지 회수합니다. */
    finalizeClosedGameplayIngress() {
        this.#assertUsable();
        if (this.gameplayIngressOpen) {
            return Object.freeze({
                lifecycleCancelledCount: 0,
                fixedCommands: null,
                effectCommands: null
                ,formationCommands: null,
                atomicTransformCommands: null,
                projectileCaptureCommands: null,
                routeAvailabilityCommands: null
            });
        }
        let lifecycleCancelledCount = 0;
        let fixedCommands = null;
        let effectCommands = null;
        let formationCommands = null;
        let atomicTransformCommands = null;
        let projectileCaptureCommands = null;
        let routeAvailabilityCommands = null;
        try {
            lifecycleCancelledCount
                = this.lifecycleCommandOwner.finalizeClosedIngress();
            fixedCommands = this.fixedCommandOwner.closeIngress(
                this.gameplayIngressCloseReason
            );
            effectCommands = this.effectCommandOwner.closeIngress(
                this.gameplayIngressCloseReason
            );
            formationCommands = this.#formationCommandOwner.closeIngress(
                this.gameplayIngressCloseReason,
                this.gameplayIngressCloseCleanup?.formationCommands
                    ?.finalFixedTick
                    ?? this.gameplayIngressCloseCleanup?.effectCommands
                        ?.finalFixedTick
                    ?? 1
            );
            atomicTransformCommands
                = this.#atomicTransformCommandOwner.getTerminalCancelStatus();
            projectileCaptureCommands
                = this.getTerminalProjectileCaptureProgramCancelStatus();
            routeAvailabilityCommands
                = this.getTerminalRouteAvailabilityProgramCancelStatus();
        } finally {
            // SEALED/SEALED_FAILED 뒤 stale stored port가 새 authentic cleanup을
            // 만들지 못하도록 permit authority까지 terminal finalizer가 닫습니다.
            this.#revokeCoreImpactCleanupPort();
            this.#atomicTransformIngressAuthority.revoke();
            this.#projectileCaptureReleaseAuthority.revoke();
            this.#authenticProjectileCapturePrepareEvidence = new WeakSet();
            this.#authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
        }
        return Object.freeze({
            lifecycleCancelledCount,
            fixedCommands,
            effectCommands
            ,formationCommands,
            atomicTransformCommands,
            projectileCaptureCommands,
            routeAvailabilityCommands
        });
    }

    /** GPU authority가 아닌 최신 bounded observed pose snapshot입니다. */
    getObservedTrackedPose() {
        return this.destroyed
            ? null
            : this.backend.getObservedTrackedPose?.()
                ?? this.backend.getLatestTrackedPose?.()
                ?? null;
    }

    /** @deprecated generic observed 명칭의 compatibility alias입니다. */
    getLatestTrackedPose() {
        return this.getObservedTrackedPose();
    }

    /** 예약한 lifecycle command를 지정 fixed tick에서 원자적으로 반영합니다. */
    commitAtFixedBoundary(fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        if (this.completedEventRecoveryRequired
            || this.effectCommandOwner.getStatus().recoveryRequired
            || this.#formationCommandOwner.getStatus().recoveryRequired
            || this.#atomicTransformCommandOwner.getStatus().recoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired) {
            this.#finalizeClosedLifecycleIngress();
            return Object.freeze({
                fixedTick: tick,
                state: 'failed',
                spawned: Object.freeze([]),
                despawned: Object.freeze([]),
                rejected: Object.freeze([]),
                recoveryRequired: true,
                backendState: this.backend.getRuntimeState(),
                registryRevision: this.registry.getRevision(),
                fixedCommands: null,
                effectPrograms: null,
                formationPrograms: null,
                atomicTransformCommands: null
            });
        }
        const lifecycle = this.lifecycleCommandOwner.commitAtFixedBoundary(tick);
        this.#observeProjectileCaptureTerminalCleanupCommit(lifecycle, tick);
        this.#observeRouteTerminalCleanupCommit(lifecycle, tick);
        if (!this.gameplayIngressOpen
            && this.routeAvailabilityBackendSupported
            && this.routeAvailabilityTerminalOwnerStatus?.finalFixedTick === tick
            && this.routeAvailabilityTerminalHostCleanup.pendingCount === 0
            && this.routeAvailabilityTerminalHostCleanup.failure === null
            && this.backend.getTerminalRouteAvailabilityProgramCancelStatus()
                === null) {
            const armedRouteTerminal = this.backend
                .cancelPendingRouteAvailabilityProgramsForTerminal({
                    finalFixedTick: tick
                });
            this.routeAvailabilityTerminalBackendStatus = armedRouteTerminal;
            this.routeAvailabilityTerminalOwnerStatus = Object.freeze({
                ...this.routeAvailabilityTerminalOwnerStatus,
                accepted: armedRouteTerminal?.accepted === true,
                state: armedRouteTerminal?.state === 'failed'
                    ? 'failed'
                    : 'armed',
                failure: armedRouteTerminal?.failure ?? null
            });
        }
        this.#formationCommandOwner.observeLifecycleCommit(lifecycle);
        const atomicTransformCommands
            = this.#atomicTransformCommandOwner.observeLifecycleCommit(
                lifecycle
            );
        if (lifecycle.recoveryRequired
            || atomicTransformCommands.recoveryRequired) {
            this.#finalizeClosedLifecycleIngress();
            return Object.freeze({
                ...lifecycle,
                fixedCommands: null,
                effectPrograms: null,
                formationPrograms: null,
                atomicTransformCommands,
                recoveryRequired: true,
                state: 'failed'
            });
        }
        this.#rememberEffectLifecycleCommit(lifecycle, tick);
        const fixedCommands = this.fixedCommandOwner.commitAtFixedBoundary(tick);
        const effectPrograms = fixedCommands.recoveryRequired === true
            ? null
            : this.effectCommandOwner.commitAtFixedBoundary(
                tick,
                this.#effectLifecycleCommitProofs.length > 0
                    ? Object.freeze([...this.#effectLifecycleCommitProofs])
                    : null
            );
        const formationPrograms = fixedCommands.recoveryRequired === true
            || effectPrograms?.recoveryRequired === true
            ? null
            : this.#formationCommandOwner.commitAtFixedBoundary(
                tick,
                this.#effectLifecycleCommitProofs.length > 0
                    ? Object.freeze([...this.#effectLifecycleCommitProofs])
                    : null
            );
        this.#finalizeClosedLifecycleIngress();
        const recoveryRequired = fixedCommands.recoveryRequired === true
            || effectPrograms?.recoveryRequired === true
            || formationPrograms?.recoveryRequired === true
            || atomicTransformCommands.recoveryRequired === true;
        const state = recoveryRequired
            ? fixedCommands.state === 'stalled'
                && effectPrograms?.recoveryRequired !== true
                && formationPrograms?.recoveryRequired !== true
                ? 'stalled'
                : 'failed'
            : lifecycle.state === 'committed-with-rejections'
                || fixedCommands.state === 'committed-with-rejections'
                || effectPrograms?.state === 'committed-with-rejections'
                || formationPrograms?.state === 'committed-with-rejections'
                ? 'committed-with-rejections'
                : lifecycle.state;
        return Object.freeze({
            ...lifecycle,
            state,
            recoveryRequired,
            fixedCommands,
            effectPrograms,
            formationPrograms,
            atomicTransformCommands
        });
    }

    commitCompletedRouteAvailabilityProgramsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const runtimeStatus = this.getRouteAvailabilityRuntimeStatus();
        if (!this.routeAvailabilityBackendSupported) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-backend-unavailable',
                'RouteAvailability backend private surface가 없습니다.'
            );
        }
        const terminal = this.routeAvailabilityTerminalOwnerStatus;
        const terminalEventBoundary = !this.gameplayIngressOpen
            && terminal?.finalFixedTick === tick;
        const expectedSourceTick = terminalEventBoundary ? tick : tick - 1;
        const genericSnapshot = this.commitCompletedEventsAtFixedBoundary(tick);
        if (genericSnapshot.protocolFailure) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                genericSnapshot.protocolFailure.code
                    ?? 'route-generic-event-protocol-failure',
                genericSnapshot.protocolFailure.message
                    ?? 'Route action과 generic event snapshot이 실패했습니다.'
            );
        }
        const terminalBackendStatus = terminalEventBoundary
            ? this.backend.getTerminalRouteAvailabilityProgramCancelStatus?.()
                ?? this.routeAvailabilityTerminalBackendStatus
            : null;
        const replayProtocolStatus = terminalBackendStatus?.accepted === true
                && terminalBackendStatus.finalFixedTick === tick
                && (terminalBackendStatus.state === 'submitted'
                    || terminalBackendStatus.state === 'settled')
            ? terminalBackendStatus
            : runtimeStatus;
        if (this.lastCompletedRouteAvailabilityPrograms?.targetFixedTick === tick
            && (this.lastCompletedRouteAvailabilityPrograms.sourceTick
                    === expectedSourceTick
                || (!terminalEventBoundary
                    && this.lastCompletedRouteAvailabilityPrograms.sourceTick === 0
                    && this.lastCompletedRouteAvailabilityPrograms
                        .batchIdFingerprint === 0
                    && this.lastCompletedRouteAvailabilityPrograms.pending === false))
            && this.lastCompletedRouteAvailabilityPrograms.sessionGeneration
                === replayProtocolStatus.sessionGeneration
            && this.lastCompletedRouteAvailabilityPrograms.deviceGeneration
                === replayProtocolStatus.deviceGeneration
            && this.lastCompletedRouteAvailabilityPrograms.authoritativeEpoch
                === replayProtocolStatus.authoritativeEpoch) {
            return this.lastCompletedRouteAvailabilityPrograms;
        }
        const exactIdle = runtimeStatus.rosterCount === 0
            && runtimeStatus.leaseCount === 0
            && runtimeStatus.stagedCount === 0
            && runtimeStatus.pendingReadbackCount === 0
            && runtimeStatus.queuedBatchCount === 0
            && runtimeStatus.commitRequested === false
            && runtimeStatus.requiresRecovery === false
            && runtimeStatus.failure === null
            && runtimeStatus.closedPathIds.length === 0;
        const genericExpectedSourceReady
            = genericSnapshot.targetFixedTick === tick
                && genericSnapshot.sourceTick === expectedSourceTick
                && genericSnapshot.completedThroughTick === expectedSourceTick;
        const allowIdleCompletion = exactIdle && !terminalEventBoundary;
        const completedReadbackBypassReady = !terminalEventBoundary
            && runtimeStatus.readbackBypassEligible === true
            && runtimeStatus.completedReadbackBypassSourceTick
                === expectedSourceTick;
        if (!genericExpectedSourceReady
            && !allowIdleCompletion
            && !completedReadbackBypassReady) {
            return Object.freeze({
                abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                sessionGeneration: runtimeStatus.sessionGeneration,
                deviceGeneration: runtimeStatus.deviceGeneration,
                authoritativeEpoch: runtimeStatus.authoritativeEpoch,
                targetFixedTick: tick,
                sourceTick: expectedSourceTick,
                completedThroughTick: runtimeStatus.completedThroughTick,
                graphContentKey: runtimeStatus.graphContentKey,
                availabilityVersion: runtimeStatus.availabilityVersion,
                batchIdFingerprint: 0,
                pending: true,
                status: 0,
                errorFlags: 0,
                closedPathIds: runtimeStatus.closedPathIds,
                assignments: Object.freeze([]),
                closures: Object.freeze([]),
                reopens: Object.freeze([]),
                cleanups: Object.freeze([]),
                protocolFailure: null
            });
        }
        const routeEvents = genericSnapshot.events.filter(
            (event) => event.type === 'route'
                && event.sourceTick === expectedSourceTick
        );
        const drained = this.routeAvailabilityBatchScratch;
        drained.length = 0;
        this.backend.drainCompletedRouteAvailabilityBatches(drained);
        const matching = drained.filter(
            (batch) => batch?.sourceTick === expectedSourceTick
        );
        if (drained.some((batch) => batch?.sourceTick > expectedSourceTick)
            || matching.length > 1
            || (matching.length === 0 && routeEvents.length > 0)) {
            drained.length = 0;
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-readback-order',
                'RouteAvailability readback source ordering이 generic event와 다릅니다.'
            );
        }
        if (matching.length === 0) {
            drained.length = 0;
            if (allowIdleCompletion) {
                this.lastCompletedRouteAvailabilityPrograms = Object.freeze({
                    abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                    sessionGeneration: runtimeStatus.sessionGeneration,
                    deviceGeneration: runtimeStatus.deviceGeneration,
                    authoritativeEpoch: runtimeStatus.authoritativeEpoch,
                    targetFixedTick: tick,
                    sourceTick: 0,
                    completedThroughTick: expectedSourceTick,
                    graphContentKey: runtimeStatus.graphContentKey,
                    availabilityVersion: runtimeStatus.availabilityVersion,
                    batchIdFingerprint: 0,
                    pending: false,
                    status: 0,
                    errorFlags: 0,
                    closedPathIds: Object.freeze([]),
                    assignments: Object.freeze([]),
                    closures: Object.freeze([]),
                    reopens: Object.freeze([]),
                    cleanups: Object.freeze([]),
                    protocolFailure: null
                });
                return this.lastCompletedRouteAvailabilityPrograms;
            }
            return Object.freeze({
                abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
                sessionGeneration: runtimeStatus.sessionGeneration,
                deviceGeneration: runtimeStatus.deviceGeneration,
                authoritativeEpoch: runtimeStatus.authoritativeEpoch,
                targetFixedTick: tick,
                sourceTick: expectedSourceTick,
                completedThroughTick: runtimeStatus.completedThroughTick,
                graphContentKey: runtimeStatus.graphContentKey,
                availabilityVersion: runtimeStatus.availabilityVersion,
                batchIdFingerprint: 0,
                pending: true,
                status: 0,
                errorFlags: 0,
                closedPathIds: runtimeStatus.closedPathIds,
                assignments: Object.freeze([]),
                closures: Object.freeze([]),
                reopens: Object.freeze([]),
                cleanups: Object.freeze([]),
                protocolFailure: null
            });
        }
        const batch = matching[0];
        drained.length = 0;
        const authenticatedReadbackBypass = !genericExpectedSourceReady
            && completedReadbackBypassReady
            && batch.readbackBypassed === true
            && batch.terminal === false
            && batch.lastEventBase === 0
            && batch.lastEventCount === 0;
        if (!genericExpectedSourceReady
            && !allowIdleCompletion
            && !authenticatedReadbackBypass) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-readback-bypass-contract',
                'RouteAvailability readback bypass 증거가 runtime queue-front와 다릅니다.'
            );
        }
        if (batch.failure
            || batch.abiVersion !== ROUTE_AVAILABILITY_ABI_VERSION
            || batch.sessionGeneration !== this.sessionGeneration
            || batch.deviceGeneration !== runtimeStatus.deviceGeneration
            || batch.authoritativeEpoch !== runtimeStatus.authoritativeEpoch
            || batch.completedThroughTick !== expectedSourceTick
            || batch.availabilityVersion <= 0
            || batch.availabilityVersion >= 0xffffffff
            || (batch.readbackBypassed !== true
                && batch.readbackBypassed !== false)
            || !Array.isArray(batch.closedPathIndices)
            || !Array.isArray(batch.records)
            || batch.lastEventCount !== routeEvents.length) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-readback-contract',
                'RouteAvailability authenticated header/record가 올바르지 않습니다.'
            );
        }
        const expectedSequences = new Set();
        for (let sequence = batch.lastEventBase;
            sequence < batch.lastEventBase + batch.lastEventCount;
            sequence++) {
            expectedSequences.add(sequence);
        }
        if (routeEvents.some((event) => !expectedSequences.delete(event.sequence))
            || expectedSequences.size !== 0) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-event-window',
                'Route action event window가 availability header와 다릅니다.'
            );
        }
        const graph = this.backend.getFlowFieldAtlas?.()?.routeGraph ?? null;
        if (!graph) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-graph-missing',
                'Route action을 ID로 정규화할 compiled routeGraph가 없습니다.'
            );
        }
        const routeSetIdByPathIndex = new Map();
        for (const routeSet of graph.routeSets) {
            for (let index = routeSet.candidateOffset;
                index < routeSet.candidateOffset + routeSet.candidateCount;
                index++) {
                const candidate = graph.routeCandidates[index];
                routeSetIdByPathIndex.set(candidate.pathIndex, routeSet.id);
            }
        }
        const closureByPathIndex = new Map(
            graph.closures.map((closure) => [closure.pathIndex, closure])
        );
        const recordByClosureIndex = new Map();
        const closedPathIndexSet = new Set(batch.closedPathIndices);
        if (batch.records.length !== graph.closures.length
            || closedPathIndexSet.size !== batch.closedPathIndices.length
            || [...closedPathIndexSet].some((pathIndex) => !Number.isSafeInteger(pathIndex)
                || !graph.paths.some((path) => path.pathIndex === pathIndex))) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-record-cardinality',
                'RouteAvailability final record/closed-path cardinality가 topology와 다릅니다.'
            );
        }
        let closedRecordCount = 0;
        for (const record of batch.records) {
            const closure = graph.closures[record?.closureIndex];
            const exactPath = closure?.pathIndex === record?.pathIndex;
            const validState = record?.state === GPU_ROUTE_AVAILABILITY_STATE.OPEN
                || record?.state === GPU_ROUTE_AVAILABILITY_STATE.LEASED
                || record?.state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED;
            const closed = record?.state === GPU_ROUTE_AVAILABILITY_STATE.CLOSED;
            if (!closure || !exactPath || !validState
                || recordByClosureIndex.has(record.closureIndex)
                || closedPathIndexSet.has(record.pathIndex) !== closed) {
                return this.#failRouteAvailabilityProtocol(
                    tick,
                    'route-availability-final-record-contract',
                    'RouteAvailability final record와 closed-path snapshot이 일치하지 않습니다.'
                );
            }
            if (closed) {
                closedRecordCount++;
            }
            recordByClosureIndex.set(record.closureIndex, record);
        }
        if (closedRecordCount !== closedPathIndexSet.size) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-closed-path-cardinality',
                'RouteAvailability CLOSED record와 closed-path snapshot 수가 다릅니다.'
            );
        }
        const orderedRouteEvents = [...routeEvents].sort(
            (left, right) => left.sequence - right.sequence
        );
        const mutatingEventTypes = new Set([
            'route-assigned',
            'route-closed',
            'route-reopened'
        ]);
        const mutationCount = orderedRouteEvents.filter(
            (event) => mutatingEventTypes.has(event.eventType)
        ).length;
        let replayVersion = batch.availabilityVersion - mutationCount;
        const lastActionByClosureIndex = new Map();
        if (replayVersion <= 0 || replayVersion >= 0xffffffff) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-version-predecessor',
                'RouteAvailability mutation predecessor version이 유효하지 않습니다.'
            );
        }
        for (const event of orderedRouteEvents) {
            const assigned = event.eventType === 'route-assigned';
            const closure = assigned
                ? closureByPathIndex.get(event.routeIndex)
                : graph.closures[event.routeIndex];
            const expectedVersion = mutatingEventTypes.has(event.eventType)
                ? replayVersion + 1
                : replayVersion;
            if (!closure || event.availabilityVersion !== expectedVersion) {
                return this.#failRouteAvailabilityProtocol(
                    tick,
                    'route-availability-action-version-replay',
                    'Route action version 연쇄가 final availability version과 다릅니다.'
                );
            }
            replayVersion = expectedVersion;
            lastActionByClosureIndex.set(closure.closureIndex, event);
        }
        if (replayVersion !== batch.availabilityVersion) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-final-version-replay',
                'Route action mutation 수가 final availability version과 다릅니다.'
            );
        }
        for (const [closureIndex, event] of lastActionByClosureIndex) {
            const record = recordByClosureIndex.get(closureIndex);
            const cleaned = event.eventType === 'route-cleaned';
            const expectedState = event.eventType === 'route-assigned'
                ? GPU_ROUTE_AVAILABILITY_STATE.LEASED
                : event.eventType === 'route-closed'
                    ? GPU_ROUTE_AVAILABILITY_STATE.CLOSED
                    : GPU_ROUTE_AVAILABILITY_STATE.OPEN;
            const exactOwner = cleaned
                ? record?.ownerHandle === null && record?.leaseGeneration === 0
                : record?.ownerHandle?.entityId === event.entityId
                    && record.ownerHandle.incarnation === event.incarnation
                    && record.leaseGeneration === event.leaseGeneration;
            if (record?.state !== expectedState || !exactOwner) {
                return this.#failRouteAvailabilityProtocol(
                    tick,
                    'route-availability-action-final-record-mismatch',
                    'Route action replay와 final availability owner/lease/state가 다릅니다.'
                );
            }
        }
        const normalizeAction = (event) => {
            const assigned = event.eventType === 'route-assigned';
            const closure = assigned
                ? closureByPathIndex.get(event.routeIndex)
                : graph.closures[event.routeIndex];
            const path = closure ? graph.paths[closure.pathIndex] : null;
            const routeSetId = path
                ? routeSetIdByPathIndex.get(path.pathIndex)
                : null;
            if (!closure || !path || typeof routeSetId !== 'string'
                || event.availabilityVersion > batch.availabilityVersion) {
                throw new RangeError('Route action topology identity가 유효하지 않습니다.');
            }
            return Object.freeze({
                ownerHandle: Object.freeze({
                    entityId: event.entityId,
                    incarnation: event.incarnation
                }),
                routeSetId,
                pathId: path.pathId,
                closureId: closure.id,
                leaseGeneration: event.leaseGeneration,
                sourceTick: expectedSourceTick,
                availabilityVersion: event.availabilityVersion
            });
        };
        let assignments;
        let closures;
        let reopens;
        let cleanups;
        try {
            assignments = routeEvents.filter(
                (event) => event.eventType === 'route-assigned'
            ).map(normalizeAction);
            closures = routeEvents.filter(
                (event) => event.eventType === 'route-closed'
            ).map(normalizeAction);
            reopens = routeEvents.filter(
                (event) => event.eventType === 'route-reopened'
            ).map(normalizeAction);
            cleanups = routeEvents.filter(
                (event) => event.eventType === 'route-cleaned'
            ).map(normalizeAction);
        } catch (error) {
            return this.#failRouteAvailabilityProtocol(
                tick,
                'route-availability-action-topology',
                error.message
            );
        }
        const closedPathIds = batch.closedPathIndices.map((pathIndex) => {
            const pathId = graph.paths[pathIndex]?.pathId;
            if (typeof pathId !== 'string' || pathId.length === 0) {
                throw new RangeError('closedPath index가 topology 범위를 벗어났습니다.');
            }
            return pathId;
        }).sort();
        const batchIdFingerprint = fingerprintRouteAvailabilityBatch(
            expectedSourceTick,
            batch.availabilityVersion,
            routeEvents
        );
        this.lastCompletedRouteAvailabilityPrograms = Object.freeze({
            abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
            sessionGeneration: batch.sessionGeneration,
            deviceGeneration: batch.deviceGeneration,
            authoritativeEpoch: batch.authoritativeEpoch,
            targetFixedTick: tick,
            sourceTick: expectedSourceTick,
            completedThroughTick: batch.completedThroughTick,
            graphContentKey: runtimeStatus.graphContentKey,
            availabilityVersion: batch.availabilityVersion,
            batchIdFingerprint,
            readbackBypassed: batch.readbackBypassed,
            pending: false,
            status: 0,
            errorFlags: 0,
            closedPathIds: Object.freeze(closedPathIds),
            assignments: Object.freeze(assignments),
            closures: Object.freeze(closures),
            reopens: Object.freeze(reopens),
            cleanups: Object.freeze(cleanups),
            protocolFailure: null
        });
        return this.lastCompletedRouteAvailabilityPrograms;
    }

    /**
     * 완료된 GPU event batch를 현재 fixed 경계에서 lifecycle 명령으로 변환합니다.
     * 이 메서드는 command를 예약만 하며 commit은 session owner가 뒤이어 한 번 수행합니다.
     * @param {number} targetFixedTick - 생성한 gpu-death despawn 명령의 적용 tick입니다.
     * @returns {object} 이 경계에서 관찰한 bounded 불변 event snapshot입니다.
     */
    commitCompletedEventsAtFixedBoundary(targetFixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(targetFixedTick, 'targetFixedTick');
        const terminalEventBoundary = !this.gameplayIngressOpen
            && (this.routeAvailabilityTerminalOwnerStatus?.finalFixedTick === tick
                || this.projectileCaptureTerminalOwnerStatus?.finalFixedTick
                    === tick);
        const requiredEventSourceTick = terminalEventBoundary ? tick : tick - 1;
        if (this.lastCompletedSimulationEvents.targetFixedTick === tick
            && this.lastCompletedSimulationEvents.sourceTick
                === requiredEventSourceTick) {
            return this.lastCompletedSimulationEvents;
        }
        if (this.projectileCaptureBackendSupported) {
            const captureStatus = this.backend
                .getProjectileCaptureRuntimeStatus();
            const acceptedCapture
                = this.lastAcceptedProjectileCaptureProtocol;
            if ((acceptedCapture?.idle !== true
                    && captureStatus.completedThroughTick
                        < requiredEventSourceTick)
                || acceptedCapture?.sessionGeneration
                        !== this.sessionGeneration
                || acceptedCapture?.deviceGeneration
                        !== captureStatus.deviceGeneration
                || acceptedCapture?.authoritativeEpoch
                        !== captureStatus.authoritativeEpoch
                || acceptedCapture?.sourceTick !== requiredEventSourceTick
                || acceptedCapture?.completedThroughTick
                    !== requiredEventSourceTick) {
                return this.#failCompletedEventProtocol(
                    tick,
                    Object.freeze({
                        stage: 'completed-event-protocol',
                        code: 'projectile-capture-watermark-incomplete',
                        name: 'ProjectileCaptureCoherenceViolation',
                        message: 'generic event보다 capture watermark가 뒤에 있습니다.'
                    })
                );
            }
        }
        const spawnPrograms = this.fixedCommandOwner
            .commitCompletedAtFixedBoundary(tick);
        if (spawnPrograms.protocolFailure) {
            return this.#failCompletedEventProtocol(
                tick,
                Object.freeze({
                    stage: 'spawn-program-completion',
                    code: spawnPrograms.protocolFailure.code,
                    name: 'SpawnProgramProtocolViolation',
                    message: spawnPrograms.protocolFailure.message
                })
            );
        }
        // lower drain은 마지막 pending batch를 꺼내는 과정에서 idle resource를
        // release하고 authoritative epoch를 올릴 수 있습니다. 방금 drain한
        // envelope는 호출 직전 protocol에 속하므로 그 snapshot으로 검증합니다.
        const protocolAtDrain = this.#readCurrentEventProtocolState();
        const batches = this.completedEventBatchScratch;
        batches.length = 0;
        if (typeof this.backend.drainCompletedEventBatches === 'function') {
            const drained = this.backend.drainCompletedEventBatches(batches);
            if (Array.isArray(drained) && drained !== batches) {
                batches.push(...drained);
            }
        }
        const frozenProtocolAtDrain = protocolAtDrain
            ? Object.freeze({ ...protocolAtDrain })
            : null;
        if (this.completedEventRecoveryRequired) {
            // Sticky protocol failure 뒤에도 lower queue는 비우되 새 batch를
            // facade deferred queue에 보존하지 않습니다. recovery owner가 session을
            // 재구성할 때까지 public endpoint의 메모리 사용량을 bounded하게 유지합니다.
            batches.length = 0;
            this.deferredCompletedEventBatches.length = 0;
            this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot(
                this.completedThroughTick,
                {
                    targetFixedTick: tick,
                    protocolFailure: this.completedEventProtocolFailure
                }
            );
            return this.lastCompletedSimulationEvents;
        }
        for (const batch of batches) {
            this.deferredCompletedEventBatches.push(Object.freeze({
                source: batch,
                protocol: frozenProtocolAtDrain
            }));
        }
        batches.length = 0;

        const prepared = this.#prepareCompletedEventCommit(
            tick,
            terminalEventBoundary
        );
        if (prepared.failure) {
            return this.#failCompletedEventProtocol(tick, prepared.failure);
        }
        const firstHitCapacityBatches = prepared.acceptedBatches.filter(
            (batch) => batch.atomicTransformFirstHitCapacityRejected === true
        );
        if (firstHitCapacityBatches.length > 0
            && (firstHitCapacityBatches.length !== 1
                || prepared.acceptedBatches.length !== 1
                || prepared.batchCount !== 1)) {
            return this.#failCompletedEventProtocol(
                tick,
                this.#createEventProtocolFailure(
                    'atomic-transform-first-hit-capacity-aggregate',
                    'first-hit event capacity rejection은 단일 exact lower batch여야 합니다.'
                )
            );
        }
        if (this.projectileCaptureBackendSupported) {
            const incoherentWithCaptureProof = (envelope) => {
                const captureProof = this
                    .#getAcceptedProjectileCaptureProtocol(envelope);
                return envelope.sessionGeneration
                        !== captureProof?.sessionGeneration
                    || envelope.deviceGeneration
                        !== captureProof?.deviceGeneration
                    || envelope.authoritativeEpoch
                        !== captureProof?.authoritativeEpoch
                    || envelope.sourceTick !== captureProof?.sourceTick;
            };
            const incoherentBatch = prepared.acceptedBatches.some(
                incoherentWithCaptureProof
            );
            const incoherentEvent = prepared.events.some(
                incoherentWithCaptureProof
            );
            if (incoherentBatch || incoherentEvent) {
                return this.#failCompletedEventProtocol(
                    tick,
                    Object.freeze({
                        stage: 'completed-event-protocol',
                        code: 'projectile-capture-event-batch-incoherent',
                        name: 'ProjectileCaptureCoherenceViolation',
                        message: 'generic event batch와 capture proof protocol이 다릅니다.'
                    })
                );
            }
        }
        this.deferredCompletedEventBatches = prepared.retainedBatches;
        for (const batch of prepared.acceptedBatches) {
            this.#rememberCompletedBatchKey(batch.key, batch.fingerprint);
        }
        const events = [];
        const contactEvents = [];
        const deathEvents = [];
        this.completedEventTotals.stale += prepared.staleEventCount;
        for (const normalized of prepared.events) {
            let projectileCaptureDeferredDeath = null;
            const knownFingerprint = this.knownCompletedEventKeys.get(normalized.key);
            let disposition = knownFingerprint === normalized.fingerprint
                ? 'duplicate'
                : 'observed';
            if (disposition === 'duplicate') {
                this.completedEventTotals.deduped++;
            } else {
                this.#rememberCompletedEventKey(
                    normalized.key,
                    normalized.fingerprint
                );
                if (!this.#isCompletedEventIdentityLive(normalized)) {
                    disposition = 'stale';
                    this.completedEventTotals.stale++;
                } else if (normalized.type === 'death') {
                    this.completedEventTotals.death++;
                    const handle = {
                        entityId: normalized.entityId,
                        incarnation: normalized.incarnation
                    };
                    const capacityBackoff = this
                        .#getAcceptedProjectileCaptureProtocol(normalized);
                    const captureBody = capacityBackoff?.capacityRejected === true
                        ? this.backend.getProjectileCaptureBodyState(handle)
                        : null;
                    const heldCaptureIdentity = captureBody?.state?.phase
                        === GPU_PROJECTILE_CAPTURE_PHASE.HELD
                        || captureBody?.state?.phase
                            === GPU_PROJECTILE_CAPTURE_PHASE.RELEASE_PREPARED;
                    if (heldCaptureIdentity) {
                        // Capacity-only completion retained this exact bilateral
                        // state, so its death event remains observable but its
                        // lifecycle removal waits for next tick's cleanup retry.
                        const deferredReceipt
                            = this.#rememberProjectileCaptureDeferredDeath(
                                normalized,
                                captureBody,
                                capacityBackoff
                            );
                        if (!deferredReceipt) {
                            return this.#failCompletedEventProtocol(
                                tick,
                                Object.freeze({
                                    stage: 'completed-event-protocol',
                                    code: 'projectile-capture-capacity-death-proof',
                                    name: 'ProjectileCaptureCapacityDeathViolation',
                                    message: 'capacity backoff death가 exact bilateral HELD identity와 다릅니다.'
                                })
                            );
                        }
                        disposition = 'projectile-capture-capacity-deferred';
                        projectileCaptureDeferredDeath = deferredReceipt;
                    } else {
                        const requested = this.lifecycleCommandOwner.requestDespawn(
                            handle,
                            'gpu-death',
                            tick,
                            `gpu-death:${normalized.key}`,
                            null,
                            this.#terminalCleanupAuthority.issuePermit()
                        );
                        if (requested.accepted) {
                            disposition = 'despawn-requested';
                        } else {
                            disposition = 'duplicate';
                            this.completedEventTotals.deduped++;
                        }
                    }
                } else {
                    this.completedEventTotals.applied++;
                    disposition = 'applied';
                }
            }
            const { fingerprint: _fingerprint, ...publicEvent } = normalized;
            const event = Object.freeze({
                ...publicEvent,
                disposition,
                ...(projectileCaptureDeferredDeath
                    ? { projectileCaptureDeferredDeath }
                    : null)
            });
            if (this.#isAuthenticProjectileCaptureCoreImpactEvent(event)) {
                if (this.backend.registerProjectileCaptureCoreImpactReceipt(
                    event
                ) !== true) {
                    return this.#failCompletedEventProtocol(
                        tick,
                        Object.freeze({
                            stage: 'completed-event-protocol',
                            code: 'projectile-capture-core-receipt-register',
                            name: 'ProjectileCaptureCoreReceiptViolation',
                            message: 'authentic Core receipt를 backend에 등록하지 못했습니다.'
                        })
                    );
                }
                this.#authenticProjectileCaptureCoreImpactReceipts.add(event);
            }
            events.push(event);
            if (event.type === 'death') {
                deathEvents.push(event);
            } else {
                contactEvents.push(event);
            }
        }
        this.completedThroughTick = prepared.completedThroughTick;
        this.lastAcceptedEventSourceTick = prepared.lastSourceTick;
        this.lastAcceptedEventStreamSourceTick = prepared.lastStreamSourceTick;
        this.lastAcceptedEventSubmittedTick = prepared.lastSubmittedTick;
        this.lastAcceptedEventProtocolKey = prepared.protocolKey;
        const firstHitEvidence = prepared.acceptedBatches.length === 1
            ? prepared.acceptedBatches[0]
            : null;
        this.lastCompletedSimulationEvents = Object.freeze({
            targetFixedTick: tick,
            sourceTick: prepared.lastSourceTick,
            completedThroughTick: this.completedThroughTick,
            batchCount: prepared.batchCount,
            droppedEventCount: 0,
            atomicTransformFirstHitCapacityRejected:
                firstHitEvidence?.atomicTransformFirstHitCapacityRejected === true,
            retryableAtomicTransformFirstHitCapacityRejected:
                firstHitEvidence
                    ?.retryableAtomicTransformFirstHitCapacityRejected === true,
            atomicTransformFirstHitRejectionReason:
                firstHitEvidence?.atomicTransformFirstHitRejectionReason ?? null,
            atomicTransformFirstHitCandidateCount:
                firstHitEvidence?.atomicTransformFirstHitCandidateCount ?? 0,
            atomicTransformFirstHitCommittedCount:
                firstHitEvidence?.atomicTransformFirstHitCommittedCount ?? 0,
            atomicTransformFirstHitEventBase:
                firstHitEvidence?.atomicTransformFirstHitEventBase ?? 0,
            atomicTransformFirstHitEventCapacity:
                firstHitEvidence?.atomicTransformFirstHitEventCapacity ?? 0,
            events: Object.freeze(events),
            contactEvents: Object.freeze(contactEvents),
            deathEvents: Object.freeze(deathEvents),
            protocolFailure: null
        });
        return this.lastCompletedSimulationEvents;
    }

    /** 최신 fixed-boundary의 bounded 완료 event snapshot입니다. */
    getLastCompletedSimulationEvents() {
        return this.lastCompletedSimulationEvents;
    }

    #rememberProjectileCaptureDeferredDeath(
        event,
        body,
        capacitySnapshot
    ) {
        const state = body?.state;
        const deadRole = state?.role;
        if ((deadRole !== GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
                && deadRole !== GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE)
            || state.selfEntityId !== event.entityId
            || state.selfIncarnation !== event.incarnation
            || !Number.isSafeInteger(state.peerEntityId)
            || state.peerEntityId <= 0
            || state.peerEntityId >= 0xffffffff
            || !Number.isSafeInteger(state.peerIncarnation)
            || state.peerIncarnation <= 0
            || state.peerIncarnation >= 0xffffffff
            || !Number.isSafeInteger(state.captureSequence)
            || state.captureSequence <= 0
            || state.captureSequence >= 0xffffffff
            || capacitySnapshot?.sessionGeneration !== event.sessionGeneration
            || capacitySnapshot?.deviceGeneration !== event.deviceGeneration
            || capacitySnapshot?.authoritativeEpoch
                !== event.authoritativeEpoch
            || capacitySnapshot?.sourceTick !== event.sourceTick) {
            return null;
        }
        const peerHandle = Object.freeze({
            entityId: state.peerEntityId,
            incarnation: state.peerIncarnation
        });
        const peer = this.backend.getProjectileCaptureBodyState(peerHandle);
        const peerRole = deadRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            ? GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
            : GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR;
        if (!peer
            || peer.bodySlot !== state.peerBodySlot
            || peer.state?.role !== peerRole
            || peer.state.phase !== state.phase
            || peer.state.selfEntityId !== peerHandle.entityId
            || peer.state.selfIncarnation !== peerHandle.incarnation
            || peer.state.peerBodySlot !== body.bodySlot
            || peer.state.peerEntityId !== event.entityId
            || peer.state.peerIncarnation !== event.incarnation
            || peer.state.captureSequence !== state.captureSequence
            || (deadRole === GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
                ? body.capturedMirror !== true
                : peer.capturedMirror !== true)) {
            return null;
        }
        const deadHandle = Object.freeze({
            entityId: event.entityId,
            incarnation: event.incarnation
        });
        const receipt = Object.freeze({
            sessionGeneration: event.sessionGeneration,
            deviceGeneration: event.deviceGeneration,
            authoritativeEpoch: event.authoritativeEpoch,
            eventSourceTick: event.sourceTick,
            eventSequence: event.sequence,
            eventKey: event.key,
            deadRole,
            deadHandle,
            peerHandle,
            captureSequence: state.captureSequence,
            capacityRejectionFlags:
                capacitySnapshot.capacityRejectionFlags
        });
        const key = projectileCaptureHandleKey(deadHandle);
        const prior = this.projectileCaptureDeferredDeathReceipts.get(key);
        if (prior && (prior.eventKey !== receipt.eventKey
            || prior.captureSequence !== receipt.captureSequence
            || prior.deadRole !== receipt.deadRole
            || prior.peerHandle.entityId !== receipt.peerHandle.entityId
            || prior.peerHandle.incarnation !== receipt.peerHandle.incarnation)) {
            return null;
        }
        this.projectileCaptureDeferredDeathReceipts.set(key, prior ?? receipt);
        return prior ?? receipt;
    }

    #stageDeferredProjectileCaptureDeaths(batch, targetFixedTick) {
        const matches = [];
        const matchedKeys = new Set();
        const match = (deadHandle, peerHandle, captureSequence, deadRole) => {
            const key = projectileCaptureHandleKey(deadHandle);
            const receipt = this.projectileCaptureDeferredDeathReceipts.get(key);
            if (!receipt) return true;
            const exact = !matchedKeys.has(key)
                && receipt.sessionGeneration === batch.sessionGeneration
                && receipt.deviceGeneration === batch.deviceGeneration
                && receipt.authoritativeEpoch === batch.authoritativeEpoch
                && receipt.eventSourceTick < batch.sourceTick
                && receipt.deadRole === deadRole
                && receipt.deadHandle.entityId === deadHandle.entityId
                && receipt.deadHandle.incarnation === deadHandle.incarnation
                && receipt.peerHandle.entityId === peerHandle.entityId
                && receipt.peerHandle.incarnation === peerHandle.incarnation
                && receipt.captureSequence === captureSequence
                && this.registry.has(receipt.deadHandle)
                && this.backend.hasBody(receipt.deadHandle);
            if (!exact) return false;
            matchedKeys.add(key);
            matches.push({ key, receipt });
            return true;
        };
        for (const cleanup of batch.cleanups) {
            if (!match(
                cleanup.projectileHandle,
                cleanup.captorHandle,
                cleanup.captureSequence,
                GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
            )) {
                return this.#createEventProtocolFailure(
                    'projectile-capture-capacity-cleanup-aba',
                    'capacity-deferred projectile death receipt가 cleanup identity와 다릅니다.'
                );
            }
        }
        for (const preparation of batch.releasePreparations) {
            if (preparation.releaseReason
                    !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_DEATH) {
                continue;
            }
            if (!match(
                preparation.captorHandle,
                preparation.projectileHandle,
                preparation.captureSequence,
                GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            )) {
                return this.#createEventProtocolFailure(
                    'projectile-capture-capacity-release-aba',
                    'capacity-deferred captor death receipt가 release prepare identity와 다릅니다.'
                );
            }
        }
        for (const { key, receipt } of matches) {
            const result = this.lifecycleCommandOwner.requestDespawn(
                receipt.deadHandle,
                'gpu-death',
                targetFixedTick,
                `gpu-death:projectile-capture-capacity:${receipt.eventKey}`,
                null,
                this.#terminalCleanupAuthority.issuePermit()
            );
            const authenticDuplicate = result?.accepted === false
                && result.reason === 'duplicate-despawn'
                && result.authenticTerminalCleanup === true
                && result.targetFixedTick === targetFixedTick;
            if (result?.accepted !== true && !authenticDuplicate) {
                return this.#createEventProtocolFailure(
                    'projectile-capture-capacity-death-stage',
                    `capacity-deferred gpu-death lifecycle 요청이 거절됐습니다: ${String(result?.reason)}`
                );
            }
            this.projectileCaptureDeferredDeathReceipts.delete(key);
        }
        return null;
    }

    /** 권위 GPU 물리를 한 fixed step 제출합니다. */
    fixedUpdate(delta, sourceTick) {
        this.#assertUsable();
        if (this.completedEventRecoveryRequired
            || this.effectCommandOwner.getStatus().recoveryRequired
            || this.#formationCommandOwner.getStatus().recoveryRequired
            || this.#atomicTransformCommandOwner.getStatus().recoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired
            || this.getProjectileCaptureRuntimeStatus().requiresRecovery) {
            return false;
        }
        const submitted = this.backend.fixedUpdate(delta, sourceTick);
        this.effectBackendPort.noteFixedSubmit(sourceTick, submitted === true);
        this.#formationBackendPort.noteFixedSubmit(
            sourceTick,
            submitted === true
        );
        this.#atomicTransformBackendPort.noteFixedSubmit(
            sourceTick,
            submitted === true
        );
        return submitted;
    }

    /** 렌더 프레임 presentation clock만 갱신합니다. */
    updatePresentation(frame) {
        if (this.destroyed) {
            return;
        }
        this.backend.updatePresentation(frame);
    }

    /** pause/resume 경계에서 presentation epoch를 권위 물리에 맞춥니다. */
    synchronizePresentation() {
        if (this.destroyed) {
            return;
        }
        this.backend.synchronizePresentation();
    }

    /** 현재 카메라로 GPU indirect render를 제출합니다. */
    draw(camera) {
        if (this.destroyed) {
            return false;
        }
        return this.backend.draw(camera);
    }

    hasBody(handle) {
        return !this.destroyed && this.backend.hasBody(handle);
    }

    hasActiveBodies() {
        return !this.destroyed && this.backend.hasActiveBodies();
    }

    requiresRecovery() {
        return !this.destroyed && (
            this.completedEventRecoveryRequired
            || this.effectCommandOwner.getStatus().recoveryRequired
            || this.#formationCommandOwner.getStatus().recoveryRequired
            || this.#atomicTransformCommandOwner.getStatus().recoveryRequired
            || this.fixedCommandOwner.getStatus().recoveryRequired
            || this.lifecycleCommandOwner.getStatus().recoveryRequired
            || this.getProjectileCaptureRuntimeStatus().requiresRecovery
            || this.backend.requiresRecovery()
        );
    }

    getRuntimeState() {
        return this.destroyed ? 'destroyed' : this.backend.getRuntimeState();
    }

    getPendingCommandCount() {
        if (this.destroyed) return 0;
        const capture = this.getProjectileCaptureRuntimeStatus();
        return this.lifecycleCommandOwner.getPendingCount()
                + this.fixedCommandOwner.getPendingCount()
                + this.effectCommandOwner.getPendingCount()
                + this.#formationCommandOwner.getPendingCount()
                + this.#atomicTransformCommandOwner.getStatus()
                    .pendingPrepareCount
                + this.#atomicTransformCommandOwner.getStatus()
                    .pendingTransformCount
                + capture.pendingCaptureBatchCount
                + capture.pendingReleaseBatchCount
                + capture.preparedBatchCount
                + Number(capture.stagedReleaseCount > 0);
    }

    getCapacity() {
        return this.capacity;
    }

    /** 저수준 backend는 호환·진단용이며 lifecycle mutation은 endpoint를 사용해야 합니다. */
    getBackend() {
        return this.backend;
    }

    /** handle/metadata query를 위한 session registry입니다. */
    getRegistry() {
        return this.registry;
    }

    /** 기존 gameplay adapter와의 점진적 이식을 위한 lifecycle owner입니다. */
    getLifecycleCommandOwner() {
        return this.lifecycleCommandOwner;
    }

    /** HUD·테스트가 전체 session을 한 번에 읽는 불변 진단 snapshot입니다. */
    getStatus() {
        const registry = this.registry.getStatus();
        const lifecycle = this.lifecycleCommandOwner.getStatus();
        const fixedCommands = this.fixedCommandOwner.getStatus();
        const effectCommands = this.effectCommandOwner.getStatus();
        const formationCommands = this.#formationCommandOwner.getStatus();
        const atomicTransformCommands
            = this.#atomicTransformCommandOwner.getStatus();
        const projectileCapture = this.getProjectileCaptureRuntimeStatus();
        const backend = typeof this.backend.getStatus === 'function'
            ? this.backend.getStatus()
            : Object.freeze({ state: this.getRuntimeState() });
        const events = Object.freeze({
            sessionGeneration: this.sessionGeneration,
            completedThroughTick: this.completedThroughTick,
            applied: this.completedEventTotals.applied,
            death: this.completedEventTotals.death,
            stale: this.completedEventTotals.stale,
            deduped: this.completedEventTotals.deduped,
            recoveryRequired: this.completedEventRecoveryRequired,
            protocolFailure: this.completedEventProtocolFailure,
            deferredBatchCount: this.deferredCompletedEventBatches.length,
            lastCompleted: this.lastCompletedSimulationEvents,
            backend: backend.events ?? backend.gpu?.events ?? null
        });
        return Object.freeze({
            state: this.getRuntimeState(),
            initialized: this.initialized,
            destroyed: this.destroyed,
            capacity: this.capacity,
            effectCommandCapacity: this.effectCommandCapacity,
            formationCommandCapacity: this.formationCommandCapacity,
            sessionGeneration: this.sessionGeneration,
            activeCount: registry.activeCount,
            activeEnemyCount: this.registry.getActiveCount('enemy'),
            activeProjectileCount: this.registry.getActiveCount('projectile'),
            reservedCount: registry.reservedCount,
            pendingCommandCount: lifecycle.pendingCount
                + fixedCommands.pendingCommandCount
                + fixedCommands.pendingDestinationCount
                + (fixedCommands.pendingPriorityTargetControlCount ?? 0)
                + effectCommands.pendingPulseProgramCount
                + this.#formationCommandOwner.getPendingCount()
                + atomicTransformCommands.pendingPrepareCount
                + atomicTransformCommands.pendingTransformCount
                + projectileCapture.pendingCaptureBatchCount
                + projectileCapture.pendingReleaseBatchCount
                + projectileCapture.preparedBatchCount
                + Number(projectileCapture.stagedReleaseCount > 0),
            pendingFixedCommandCount: fixedCommands.pendingCommandCount,
            pendingSourceRelativeDestinationCount:
                fixedCommands.pendingDestinationCount,
            pendingPriorityTargetControlCount:
                fixedCommands.pendingPriorityTargetControlCount ?? 0,
            pendingEffectPulseProgramCount:
                effectCommands.pendingPulseProgramCount,
            effectRuntimeSupported: this.effectBackendPort.isSupported(),
            formationRuntimeSupported: this.#formationBackendPort.isSupported(),
            atomicTransformRuntimeSupported:
                this.#atomicTransformBackendPort.isSupported(),
            priorityTargetControlCompletedThroughTick:
                fixedCommands.priorityTargetControlCompletedThroughTick ?? 0,
            gameplayIngressOpen: this.gameplayIngressOpen,
            gameplayIngressCloseReason: this.gameplayIngressCloseReason,
            gameplayIngressCloseCleanup: this.gameplayIngressCloseCleanup,
            towerGameplayTargetDiagnostic:
                this.towerGameplayTargetDiagnostic,
            trackedPoseDiagnostic: this.trackedPoseDiagnostic,
            completedThroughTick: this.completedThroughTick,
            recoveryRequired: !this.destroyed && (
                this.completedEventRecoveryRequired
                || effectCommands.recoveryRequired
                || formationCommands.recoveryRequired
                || atomicTransformCommands.recoveryRequired
                || fixedCommands.recoveryRequired
                || lifecycle.recoveryRequired
                || projectileCapture.requiresRecovery
                || this.backend.requiresRecovery()
            ),
            events,
            backend,
            effectCommands,
            formationCommands,
            atomicTransformCommands,
            projectileCapture,
            fixedCommands,
            lifecycle,
            registry
        });
    }

    /** endpoint가 소유한 lifecycle → registry → backend를 반복 호출 가능하게 정리합니다. */
    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.#revokeCoreImpactCleanupPort();
        this.#atomicTransformIngressAuthority.revoke();
        this.#projectileCaptureReleaseAuthority.revoke();
        this.#formationCommandOwner.destroy();
        this.#atomicTransformCommandOwner.destroy();
        this.effectCommandOwner.destroy();
        this.fixedCommandOwner.destroy();
        this.lifecycleCommandOwner.destroy();
        this.registry.destroy();
        this.backend.destroy();
        this.completedEventBatchScratch.length = 0;
        this.deferredCompletedEventBatches.length = 0;
        this.knownCompletedBatchKeys.clear();
        this.completedBatchKeys.length = 0;
        this.completedBatchKeyHead = 0;
        this.knownCompletedEventKeys.clear();
        this.completedEventKeys.length = 0;
        this.completedEventKeyHead = 0;
        this.#acceptedProjectileCaptureProtocols.clear();
        this.#acceptedProjectileCaptureProtocolKeys.length = 0;
        this.#acceptedProjectileCaptureProtocolKeyHead = 0;
        this.#authenticEffectLifecycleCommits = new WeakSet();
        this.#authenticProjectileCapturePrepareEvidence = new WeakSet();
        this.projectileCaptureDeferredDeathReceipts.clear();
        this.#authenticProjectileCaptureCoreImpactReceipts = new WeakSet();
        this.projectileCaptureTerminalCleanupCommandIds.clear();
        this.routeAvailabilityTerminalCleanupCommandIds.clear();
        this.routeAvailabilityBatchScratch.length = 0;
        this.lastCompletedRouteAvailabilityPrograms = null;
        this.#effectLifecycleCommitProofTick = 0;
        this.#effectLifecycleCommitProofs.length = 0;
        this.initialized = false;
    }

    /** production Core director가 전용 cleanup port 주입을 요구하는지 식별합니다. */
    requiresPrivilegedCoreImpactCleanupPort() {
        return true;
    }

    #observeProjectileCaptureTerminalCleanupCommit(commit, fixedTick) {
        if (this.projectileCaptureTerminalCleanupCommandIds.size === 0) {
            return;
        }
        let completedCount = 0;
        let failure = this.projectileCaptureTerminalHostCleanup.failure;
        for (const despawned of commit?.despawned ?? []) {
            const expected = this.projectileCaptureTerminalCleanupCommandIds
                .get(despawned?.commandId);
            if (!expected) continue;
            if (expected.targetFixedTick !== fixedTick
                || despawned.reason
                    !== 'projectile-capture-terminal-held-unpublished'
                || despawned.disposition
                    !== 'projectile-capture-terminal-held-unpublished'
                || despawned.handle?.entityId !== expected.handle.entityId
                || despawned.handle?.incarnation
                    !== expected.handle.incarnation) {
                failure = 'projectile-capture-terminal-cleanup-proof-invalid';
                continue;
            }
            this.projectileCaptureTerminalCleanupCommandIds.delete(
                despawned.commandId
            );
            completedCount++;
        }
        for (const rejected of commit?.rejected ?? []) {
            if (this.projectileCaptureTerminalCleanupCommandIds.has(
                rejected?.commandId
            )) {
                failure = 'projectile-capture-terminal-cleanup-rejected';
            }
        }
        const previous = this.projectileCaptureTerminalHostCleanup;
        this.projectileCaptureTerminalHostCleanup = Object.freeze({
            ...previous,
            completedHeldDespawnCount:
                previous.completedHeldDespawnCount + completedCount,
            pendingHeldDespawnCount:
                this.projectileCaptureTerminalCleanupCommandIds.size,
            failure
        });
    }

    #isAuthenticProjectileCaptureCoreImpactEvent(event) {
        if (!this.projectileCaptureBackendSupported
            || !Object.isFrozen(event)
            || event.type !== 'contact'
            || (event.eventType !== 'interaction-enter'
                && event.eventType !== 'interaction-continuous')
            || event.disposition !== 'applied'
            || !event.other) {
            return false;
        }
        const subject = this.registry.copyEntityView({
            entityId: event.entityId,
            incarnation: event.incarnation
        }, {});
        const other = this.registry.copyEntityView(event.other, {});
        if (!subject || !other) return false;
        const isRing = (view) => view.kindId === 'enemy'
            && view.definitionId === BASIC_RING_ENEMY_DEFINITION_ID
            && view.metadata?.projectileCaptureProfileId
                === RING_PROJECTILE_CAPTURE_PROFILE_ID;
        const isCore = (view) => (
            view.kindId === GPU_CORE_PROXY_WORLD_KIND_ID
            && view.definitionId === GPU_CORE_PROXY_DEFINITION_ID
        );
        return isRing(subject) && isCore(other)
            || isRing(other) && isCore(subject);
    }

    #hasProjectileCaptureRegistryDomain() {
        const handles = [];
        this.registry.copyActiveHandlesInto(handles);
        for (const handle of handles) {
            const view = this.registry.copyEntityView(handle, {});
            if (view?.metadata?.projectileCaptureProfileId
                    === RING_PROJECTILE_CAPTURE_PROFILE_ID) {
                return true;
            }
        }
        return false;
    }

    #stageRouteTerminalCleanups(finalFixedTick) {
        const previous = this.routeAvailabilityTerminalHostCleanup;
        if (!this.routeAvailabilityBackendSupported) return previous;
        const handles = [];
        this.registry.copyActiveHandlesInto(handles, { kindId: 'enemy' });
        let requestedCount = previous.requestedCount;
        let failure = previous.failure;
        for (const handle of handles) {
            const view = this.registry.copyEntityView(handle, {});
            const exactRouteBody = this.backend.resolveExactRouteBodySlot(handle);
            if (view?.definitionId !== BASIC_CORK_ENEMY_DEFINITION_ID
                || view.metadata?.routeClosureProfileId
                    !== CORK_ROUTE_CLOSURE_PROFILE_ID
                || (exactRouteBody?.role !== GPU_ROUTE_RUNTIME_ROLE.CLOSER
                    && exactRouteBody?.role
                        !== GPU_ROUTE_RUNTIME_ROLE.NORMALIZED)) {
                continue;
            }
            const requestedCommandId = [
                'cork-route-terminal',
                handle.entityId,
                handle.incarnation,
                finalFixedTick
            ].join(':');
            const result = this.lifecycleCommandOwner.requestDespawn(
                handle,
                ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION,
                finalFixedTick,
                requestedCommandId,
                Object.freeze({
                    disposition: ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                }),
                this.#terminalCleanupAuthority.issuePermit()
            );
            const authenticDuplicate = result?.accepted === false
                && result.reason === 'duplicate-despawn'
                && result.authenticTerminalCleanup === true
                && result.targetFixedTick === finalFixedTick;
            if (result?.accepted !== true && !authenticDuplicate) {
                failure = result?.reason ?? 'route-terminal-cleanup-rejected';
                continue;
            }
            const commandId = result.commandId;
            if (typeof commandId !== 'string' || commandId.length === 0) {
                failure = 'route-terminal-cleanup-command-invalid';
                continue;
            }
            const prior = this.routeAvailabilityTerminalCleanupCommandIds.get(
                commandId
            );
            if (prior && (prior.targetFixedTick !== finalFixedTick
                || prior.handle.entityId !== handle.entityId
                || prior.handle.incarnation !== handle.incarnation)) {
                failure = 'route-terminal-cleanup-command-conflict';
                continue;
            }
            if (!prior) {
                this.routeAvailabilityTerminalCleanupCommandIds.set(
                    commandId,
                    Object.freeze({
                        targetFixedTick: finalFixedTick,
                        handle: Object.freeze({
                            entityId: handle.entityId,
                            incarnation: handle.incarnation
                        })
                    })
                );
                requestedCount++;
            }
        }
        this.routeAvailabilityTerminalHostCleanup = Object.freeze({
            requestedCount,
            completedCount: previous.completedCount,
            pendingCount: this.routeAvailabilityTerminalCleanupCommandIds.size,
            failure
        });
        return this.routeAvailabilityTerminalHostCleanup;
    }

    #observeRouteTerminalCleanupCommit(commit, fixedTick) {
        if (this.routeAvailabilityTerminalCleanupCommandIds.size === 0) {
            return;
        }
        let completedCount = 0;
        let failure = this.routeAvailabilityTerminalHostCleanup.failure;
        const routeProofByCommandId = new Map(
            (commit?.routeLifecycle ?? [])
                .filter((entry) => entry?.action === 'cleanup')
                .map((entry) => [entry.commandId, entry])
        );
        for (const despawned of commit?.despawned ?? []) {
            const expected = this.routeAvailabilityTerminalCleanupCommandIds.get(
                despawned?.commandId
            );
            if (!expected) continue;
            const routeProof = routeProofByCommandId.get(despawned.commandId);
            if (expected.targetFixedTick !== fixedTick
                || despawned.reason !== ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                || despawned.disposition
                    !== ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                || despawned.handle?.entityId !== expected.handle.entityId
                || despawned.handle?.incarnation
                    !== expected.handle.incarnation
                || routeProof?.handle?.entityId !== expected.handle.entityId
                || routeProof?.handle?.incarnation
                    !== expected.handle.incarnation
                || routeProof.targetFixedTick !== fixedTick) {
                failure = 'route-terminal-cleanup-proof-invalid';
                continue;
            }
            this.routeAvailabilityTerminalCleanupCommandIds.delete(
                despawned.commandId
            );
            completedCount++;
        }
        for (const rejected of commit?.rejected ?? []) {
            if (this.routeAvailabilityTerminalCleanupCommandIds.has(
                rejected?.commandId
            )) {
                failure = 'route-terminal-cleanup-rejected';
            }
        }
        const previous = this.routeAvailabilityTerminalHostCleanup;
        this.routeAvailabilityTerminalHostCleanup = Object.freeze({
            requestedCount: previous.requestedCount,
            completedCount: previous.completedCount + completedCount,
            pendingCount: this.routeAvailabilityTerminalCleanupCommandIds.size,
            failure
        });
    }

    #prepareCompletedEventCommit(targetFixedTick, allowSameTick = false) {
        const queued = this.deferredCompletedEventBatches;
        if (queued.length > this.completedEventSnapshotCapacity) {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-capacity',
                    `deferred batch가 bounded capacity를 초과했습니다: ${queued.length}/${this.completedEventSnapshotCapacity}`
                )
            };
        }
        const eligible = [];
        const future = [];
        let staleEventCount = 0;
        let encounteredFuture = false;
        for (let index = 0; index < queued.length; index++) {
            const queueEntry = queued[index];
            const source = queueEntry?.source;
            const protocol = queueEntry?.protocol;
            if (!protocol) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'protocol-state-unavailable',
                        'batch를 drain한 시점의 event protocol state를 검증할 수 없습니다.'
                    )
                };
            }
            if (protocol.sessionGeneration !== this.sessionGeneration) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'generation-mismatch',
                        `backend protocol session이 endpoint와 다릅니다: ${protocol.sessionGeneration}/${this.sessionGeneration}`
                    )
                };
            }
            const envelope = this.#normalizeCompletedBatchEnvelope(source, index);
            if (envelope.failure) {
                return { failure: envelope.failure };
            }
            const batch = {
                ...envelope.batch,
                queueEntry,
                protocolKey: `${protocol.sessionGeneration}:${protocol.deviceGeneration}:${protocol.authoritativeEpoch}`
            };
            const generationOrder = compareProtocolGeneration(batch, protocol);
            if (generationOrder > 0) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'generation-mismatch',
                        `batch generation이 현재 protocol과 다릅니다: session=${batch.sessionGeneration}/${this.sessionGeneration}, device=${batch.deviceGeneration}/${protocol.deviceGeneration}, epoch=${batch.authoritativeEpoch}/${protocol.authoritativeEpoch}`
                    )
                };
            }
            if (generationOrder < 0) {
                staleEventCount += batch.sourceEvents.length;
                continue;
            }
            if (this.backend.hasPendingSpawnProgramThroughTick?.(batch.sourceTick)) {
                encounteredFuture = true;
                future.push(batch);
                continue;
            }
            if (batch.sourceTick > targetFixedTick
                || (!allowSameTick && batch.sourceTick === targetFixedTick)) {
                encounteredFuture = true;
                future.push(batch);
                continue;
            }
            if (encounteredFuture) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'future-order',
                        'future tick batch 뒤에 commit 가능한 과거 batch가 도착했습니다.'
                    )
                };
            }
            eligible.push(batch);
        }

        if (eligible.length === 0) {
            return {
                failure: null,
                retainedBatches: future.map(({ queueEntry }) => queueEntry),
                acceptedBatches: [],
                events: [],
                staleEventCount,
                completedThroughTick: this.completedThroughTick,
                lastSourceTick: this.lastAcceptedEventSourceTick,
                lastStreamSourceTick: this.lastAcceptedEventStreamSourceTick,
                lastSubmittedTick: this.lastAcceptedEventSubmittedTick,
                protocolKey: this.lastAcceptedEventProtocolKey,
                batchCount: 0
            };
        }

        const eligibleMaximumSourceTick = eligible[eligible.length - 1].sourceTick;
        if (future.length > 0 && eligible.some((batch) => (
            batch.completedThroughTick > eligibleMaximumSourceTick
        ))) {
            return {
                failure: null,
                retainedBatches: [
                    ...eligible.map(({ queueEntry }) => queueEntry),
                    ...future.map(({ queueEntry }) => queueEntry)
                ],
                acceptedBatches: [],
                events: [],
                staleEventCount,
                completedThroughTick: this.completedThroughTick,
                lastSourceTick: this.lastAcceptedEventSourceTick,
                lastStreamSourceTick: this.lastAcceptedEventStreamSourceTick,
                lastSubmittedTick: this.lastAcceptedEventSubmittedTick,
                protocolKey: this.lastAcceptedEventProtocolKey,
                batchCount: 0
            };
        }

        const normalizedEvents = [];
        const acceptedBatches = [];
        const preparedBatchFingerprints = new Map();
        let lastSourceTick = this.lastAcceptedEventSourceTick;
        let activeProtocolKey = this.lastAcceptedEventProtocolKey;
        let lastStreamSourceTick = this.lastAcceptedEventStreamSourceTick;
        let lastSubmittedTick = this.lastAcceptedEventSubmittedTick;
        let previousCompletedThroughTick = this.completedThroughTick;
        let newestAcceptedSourceTick = this.completedThroughTick;
        let acceptedBatchCount = 0;
        for (const batch of eligible) {
            const batchEvents = [];
            const sequenceFingerprints = new Map();
            let expectedSequence = 0;
            for (const sourceEvent of batch.sourceEvents) {
                let normalized;
                try {
                    normalized = this.#normalizeCompletedEvent(sourceEvent, batch);
                } catch (error) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'event-contract',
                            String(error?.message ?? error)
                        )
                    };
                }
                const priorSequenceFingerprint = sequenceFingerprints.get(
                    normalized.sequence
                );
                if (priorSequenceFingerprint !== undefined) {
                    if (priorSequenceFingerprint !== normalized.fingerprint) {
                        return {
                            failure: this.#createEventProtocolFailure(
                                'duplicate-sequence-conflict',
                                `sequence ${normalized.sequence}가 서로 다른 payload를 가집니다.`
                            )
                        };
                    }
                } else {
                    if (normalized.sequence !== expectedSequence) {
                        return {
                            failure: this.#createEventProtocolFailure(
                                'sequence-gap',
                                `event sequence가 contiguous하지 않습니다: expected=${expectedSequence}, actual=${normalized.sequence}`
                            )
                        };
                    }
                    sequenceFingerprints.set(
                        normalized.sequence,
                        normalized.fingerprint
                    );
                    expectedSequence++;
                }
                const knownFingerprint = this.knownCompletedEventKeys.get(normalized.key);
                if (knownFingerprint !== undefined
                    && knownFingerprint !== normalized.fingerprint) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'duplicate-key-conflict',
                            `기존 event key가 다른 payload로 재사용되었습니다: ${normalized.key}`
                        )
                    };
                }
                batchEvents.push(normalized);
            }
            const batchKey = [
                batch.sessionGeneration,
                batch.deviceGeneration,
                batch.authoritativeEpoch,
                batch.sourceTick,
                batch.submittedTick
            ].join(':');
            const batchFingerprint = JSON.stringify([
                batch.previousSourceTick,
                batch.previousSubmittedTick,
                batch.completedThroughTick,
                batch.atomicTransformFirstHitCapacityRejected,
                batch.retryableAtomicTransformFirstHitCapacityRejected,
                batch.atomicTransformFirstHitRejectionReason,
                batch.atomicTransformFirstHitCandidateCount,
                batch.atomicTransformFirstHitCommittedCount,
                batch.atomicTransformFirstHitEventBase,
                batch.atomicTransformFirstHitEventCapacity,
                ...batchEvents.map(({ fingerprint }) => fingerprint)
            ]);
            const knownBatchFingerprint = this.knownCompletedBatchKeys.get(batchKey)
                ?? preparedBatchFingerprints.get(batchKey);
            if (knownBatchFingerprint !== undefined
                && knownBatchFingerprint !== batchFingerprint) {
                return {
                    failure: this.#createEventProtocolFailure(
                        'duplicate-batch-conflict',
                        `기존 event batch key가 다른 envelope로 재사용되었습니다: ${batchKey}`
                    )
                };
            }
            const historicalDuplicate = knownBatchFingerprint === batchFingerprint;
            if (!historicalDuplicate) {
                if (batch.protocolKey !== activeProtocolKey) {
                    lastStreamSourceTick = 0;
                    lastSubmittedTick = 0;
                }
                if (batch.previousSourceTick !== lastStreamSourceTick
                    || batch.previousSubmittedTick !== lastSubmittedTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'batch-gap',
                            `event batch predecessor가 contiguous하지 않습니다: source=${batch.previousSourceTick}/${lastStreamSourceTick}, submitted=${batch.previousSubmittedTick}/${lastSubmittedTick}`
                        )
                    };
                }
                if (batch.sourceTick <= lastSourceTick
                    || batch.sourceTick <= batch.previousSourceTick
                    || batch.submittedTick <= batch.previousSubmittedTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'batch-regression',
                            `batch tick이 회귀했습니다: source=${batch.sourceTick}/${batch.previousSourceTick}, submitted=${batch.submittedTick}/${batch.previousSubmittedTick}`
                        )
                    };
                }
                if (batch.completedThroughTick < batch.sourceTick
                    || batch.completedThroughTick < previousCompletedThroughTick) {
                    return {
                        failure: this.#createEventProtocolFailure(
                            'watermark-regression',
                            `batch watermark가 불완전합니다: source=${batch.sourceTick}, completed=${batch.completedThroughTick}, previous=${previousCompletedThroughTick}`
                        )
                    };
                }
                previousCompletedThroughTick = batch.completedThroughTick;
                newestAcceptedSourceTick = batch.sourceTick;
                lastSourceTick = batch.sourceTick;
                lastStreamSourceTick = batch.sourceTick;
                lastSubmittedTick = batch.submittedTick;
                activeProtocolKey = batch.protocolKey;
                acceptedBatchCount++;
                acceptedBatches.push({
                    key: batchKey,
                    fingerprint: batchFingerprint,
                    sessionGeneration: batch.sessionGeneration,
                    deviceGeneration: batch.deviceGeneration,
                    authoritativeEpoch: batch.authoritativeEpoch,
                    sourceTick: batch.sourceTick,
                    atomicTransformFirstHitCapacityRejected:
                        batch.atomicTransformFirstHitCapacityRejected,
                    retryableAtomicTransformFirstHitCapacityRejected:
                        batch.retryableAtomicTransformFirstHitCapacityRejected,
                    atomicTransformFirstHitRejectionReason:
                        batch.atomicTransformFirstHitRejectionReason,
                    atomicTransformFirstHitCandidateCount:
                        batch.atomicTransformFirstHitCandidateCount,
                    atomicTransformFirstHitCommittedCount:
                        batch.atomicTransformFirstHitCommittedCount,
                    atomicTransformFirstHitEventBase:
                        batch.atomicTransformFirstHitEventBase,
                    atomicTransformFirstHitEventCapacity:
                        batch.atomicTransformFirstHitEventCapacity
                });
                preparedBatchFingerprints.set(batchKey, batchFingerprint);
            }
            normalizedEvents.push(...batchEvents);
        }
        if (normalizedEvents.length > this.completedEventSnapshotCapacity) {
            return {
                failure: this.#createEventProtocolFailure(
                    'snapshot-capacity',
                    `event snapshot capacity를 초과했습니다: ${normalizedEvents.length}/${this.completedEventSnapshotCapacity}`
                )
            };
        }
        if (acceptedBatchCount > 0
            && previousCompletedThroughTick !== newestAcceptedSourceTick) {
            return {
                failure: this.#createEventProtocolFailure(
                    'watermark-gap',
                    `완료 watermark에 대응하는 batch prefix가 없습니다: completed=${previousCompletedThroughTick}, newest=${newestAcceptedSourceTick}`
                )
            };
        }
        return {
            failure: null,
            retainedBatches: future.map(({ queueEntry }) => queueEntry),
            acceptedBatches,
            events: normalizedEvents,
            staleEventCount,
            completedThroughTick: acceptedBatchCount > 0
                ? newestAcceptedSourceTick
                : this.completedThroughTick,
            lastSourceTick,
            lastStreamSourceTick,
            lastSubmittedTick,
            protocolKey: activeProtocolKey,
            batchCount: eligible.length
        };
    }

    #normalizeCompletedBatchEnvelope(source, index) {
        if (!source || typeof source !== 'object') {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-contract',
                    `batch[${index}]는 객체여야 합니다.`
                )
            };
        }
        const requiredInteger = (value, label, allowZero = true) => {
            const number = Number(value);
            if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) {
                throw new RangeError(`${label}은 유효한 안전한 정수여야 합니다.`);
            }
            return number;
        };
        try {
            const sourceEvents = Array.isArray(source.events)
                ? source.events
                : null;
            if (!sourceEvents) {
                throw new TypeError(`batch[${index}].events 배열이 필요합니다.`);
            }
            const capacityRejected
                = source.atomicTransformFirstHitCapacityRejected === true;
            const retryableCapacityRejected
                = source.retryableAtomicTransformFirstHitCapacityRejected === true;
            const rejectionReason
                = source.atomicTransformFirstHitRejectionReason ?? null;
            const candidateCount = requiredInteger(
                source.atomicTransformFirstHitCandidateCount,
                `batch[${index}].atomicTransformFirstHitCandidateCount`
            );
            const committedCount = requiredInteger(
                source.atomicTransformFirstHitCommittedCount,
                `batch[${index}].atomicTransformFirstHitCommittedCount`
            );
            const eventBase = requiredInteger(
                source.atomicTransformFirstHitEventBase,
                `batch[${index}].atomicTransformFirstHitEventBase`
            );
            const eventCapacity = requiredInteger(
                source.atomicTransformFirstHitEventCapacity,
                `batch[${index}].atomicTransformFirstHitEventCapacity`,
                false
            );
            if (capacityRejected
                ? (!retryableCapacityRejected
                    || rejectionReason
                        !== 'atomic-transform-first-hit-event-capacity'
                    || candidateCount === 0
                    || committedCount !== 0
                    || eventBase > eventCapacity
                    || candidateCount <= eventCapacity - eventBase)
                : (retryableCapacityRejected
                    || rejectionReason !== null
                    || committedCount !== candidateCount
                    || eventBase > eventCapacity
                    || candidateCount > eventCapacity - eventBase)) {
                throw new RangeError(
                    `batch[${index}] AtomicTransform first-hit capacity evidence가 유효하지 않습니다.`
                );
            }
            return {
                failure: null,
                batch: {
                    source,
                    sessionGeneration: requiredInteger(
                        source.sessionGeneration,
                        `batch[${index}].sessionGeneration`,
                        false
                    ),
                    deviceGeneration: requiredInteger(
                        source.deviceGeneration,
                        `batch[${index}].deviceGeneration`
                    ),
                    authoritativeEpoch: requiredInteger(
                        source.authoritativeEpoch,
                        `batch[${index}].authoritativeEpoch`
                    ),
                    previousSourceTick: requiredInteger(
                        source.previousSourceTick,
                        `batch[${index}].previousSourceTick`
                    ),
                    previousSubmittedTick: requiredInteger(
                        source.previousSubmittedTick,
                        `batch[${index}].previousSubmittedTick`
                    ),
                    sourceTick: requiredInteger(
                        source.sourceTick,
                        `batch[${index}].sourceTick`,
                        false
                    ),
                    submittedTick: requiredInteger(
                        source.submittedTick,
                        `batch[${index}].submittedTick`,
                        false
                    ),
                    completedThroughTick: requiredInteger(
                        source.completedThroughTick,
                        `batch[${index}].completedThroughTick`
                    ),
                    atomicTransformFirstHitCapacityRejected: capacityRejected,
                    retryableAtomicTransformFirstHitCapacityRejected:
                        retryableCapacityRejected,
                    atomicTransformFirstHitRejectionReason: rejectionReason,
                    atomicTransformFirstHitCandidateCount: candidateCount,
                    atomicTransformFirstHitCommittedCount: committedCount,
                    atomicTransformFirstHitEventBase: eventBase,
                    atomicTransformFirstHitEventCapacity: eventCapacity,
                    sourceEvents
                }
            };
        } catch (error) {
            return {
                failure: this.#createEventProtocolFailure(
                    'batch-contract',
                    String(error?.message ?? error)
                )
            };
        }
    }

    #readCurrentEventProtocolState() {
        let source = null;
        try {
            source = this.backend.getEventProtocolState?.() ?? null;
            if (!source && typeof this.backend.getStatus === 'function') {
                const status = this.backend.getStatus();
                source = status?.gpu ?? status;
            }
        } catch {
            return null;
        }
        const sessionGeneration = Number(source?.sessionGeneration);
        const deviceGeneration = Number(source?.deviceGeneration);
        const authoritativeEpoch = Number(source?.authoritativeEpoch);
        if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration <= 0
            || !Number.isSafeInteger(deviceGeneration) || deviceGeneration < 0
            || !Number.isSafeInteger(authoritativeEpoch) || authoritativeEpoch < 0) {
            return null;
        }
        return { sessionGeneration, deviceGeneration, authoritativeEpoch };
    }

    #createEventProtocolFailure(code, message) {
        return Object.freeze({
            stage: 'completed-event-protocol',
            code,
            name: 'CompletedEventProtocolViolation',
            message
        });
    }

    #failRouteAvailabilityProtocol(targetFixedTick, code, message) {
        const failure = Object.freeze({
            stage: 'route-availability-protocol',
            code,
            name: 'RouteAvailabilityProtocolViolation',
            message
        });
        this.completedEventRecoveryRequired = true;
        this.completedEventProtocolFailure = failure;
        const runtime = this.backend.getRouteAvailabilityRuntimeStatus?.() ?? {};
        this.lastCompletedRouteAvailabilityPrograms = Object.freeze({
            abiVersion: ROUTE_AVAILABILITY_ABI_VERSION,
            sessionGeneration: runtime.sessionGeneration
                ?? this.sessionGeneration,
            deviceGeneration: runtime.deviceGeneration ?? 0,
            authoritativeEpoch: runtime.authoritativeEpoch ?? 0,
            targetFixedTick,
            sourceTick: 0,
            completedThroughTick: runtime.completedThroughTick ?? 0,
            graphContentKey: runtime.graphContentKey ?? 'route-graph-unavailable',
            availabilityVersion: runtime.availabilityVersion ?? 1,
            batchIdFingerprint: 0,
            pending: false,
            status: 1,
            errorFlags: 1,
            closedPathIds: Object.freeze([]),
            assignments: Object.freeze([]),
            closures: Object.freeze([]),
            reopens: Object.freeze([]),
            cleanups: Object.freeze([]),
            protocolFailure: failure
        });
        return this.lastCompletedRouteAvailabilityPrograms;
    }

    #failCompletedEventProtocol(targetFixedTick, failure) {
        this.completedEventRecoveryRequired = true;
        this.completedEventProtocolFailure = failure;
        this.deferredCompletedEventBatches.length = 0;
        this.lastCompletedSimulationEvents = createEmptyCompletedEventSnapshot(
            this.completedThroughTick,
            {
                targetFixedTick,
                protocolFailure: failure
            }
        );
        return this.lastCompletedSimulationEvents;
    }

    #normalizeCompletedEvent(source, context) {
        const event = source && typeof source === 'object' ? source : {};
        const sequence = Number(event.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
            throw new RangeError('event.sequence는 0 이상의 안전한 정수여야 합니다.');
        }
        const sourceTick = context.sourceTick;
        const deviceGeneration = context.deviceGeneration;
        const authoritativeEpoch = context.authoritativeEpoch;
        const entityId = toPositiveSafeInteger(event.entityId);
        const incarnation = toPositiveSafeInteger(event.incarnation);
        if (event.type === 'route') {
            const routeEventTypes = new Set([
                'route-assigned',
                'route-closed',
                'route-reopened',
                'route-cleaned'
            ]);
            const routeIndex = toNonNegativeSafeInteger(event.routeIndex, -1);
            const leaseGeneration = toPositiveSafeInteger(
                event.leaseGeneration
            );
            const availabilityVersion = toPositiveSafeInteger(
                event.availabilityVersion
            );
            const position = freezePosition(event.position);
            if (!routeEventTypes.has(event.eventType)
                || entityId <= 0 || incarnation <= 0
                || routeIndex < 0 || routeIndex >= 0xffffffff
                || leaseGeneration <= 0 || leaseGeneration >= 0xffffffff
                || availabilityVersion <= 0
                || availabilityVersion >= 0xffffffff
                || event.flags !== 0 || position === null) {
                throw new RangeError('route applied event contract가 올바르지 않습니다.');
            }
            const key = [
                this.sessionGeneration,
                deviceGeneration,
                authoritativeEpoch,
                entityId,
                incarnation,
                sourceTick,
                sequence,
                event.eventType
            ].join(':');
            const normalized = {
                key,
                type: 'route',
                eventType: event.eventType,
                sessionGeneration: this.sessionGeneration,
                deviceGeneration,
                authoritativeEpoch,
                sourceTick,
                sequence,
                entityId,
                incarnation,
                ownerHandle: Object.freeze({ entityId, incarnation }),
                otherEntityId: 0,
                otherIncarnation: 0,
                other: null,
                bodyId: 0,
                position,
                routeIndex,
                leaseGeneration,
                availabilityVersion,
                valueFixedPoint: availabilityVersion,
                damageFixedPoint: 0,
                damage: 0,
                flags: 0,
                maximumDamageWindow: false,
                directionalDefense: false,
                atomicTransformTriggerFirstHit: false,
                reasonFlags: 0,
                reason: event.eventType
            };
            const fingerprint = JSON.stringify([
                normalized.type,
                normalized.eventType,
                entityId,
                incarnation,
                routeIndex,
                leaseGeneration,
                availabilityVersion,
                position.x,
                position.y
            ]);
            return Object.freeze({ ...normalized, fingerprint });
        }
        const type = event.type === 'death' ? 'death' : 'contact';
        const otherEntityId = toPositiveSafeInteger(
            event.otherEntityId ?? event.other?.entityId
        );
        const otherIncarnation = toPositiveSafeInteger(
            event.otherIncarnation ?? event.other?.incarnation
        );
        if (entityId <= 0 || incarnation <= 0) {
            throw new RangeError('event subject identity가 유효하지 않습니다.');
        }
        if ((otherEntityId === 0) !== (otherIncarnation === 0)) {
            throw new RangeError('event other identity는 두 component가 함께 있어야 합니다.');
        }
        const eventType = type === 'death' ? 'death' : event.eventType;
        if (type !== 'death'
            && eventType !== 'damage-applied'
            && eventType !== 'interaction-enter'
            && eventType !== 'interaction-continuous'
            && eventType !== 'enemy-charge-windup-started'
            && eventType !== 'enemy-charge-contact-recoil-started'
            && eventType !== 'core-damage-request') {
            throw new RangeError(`지원하지 않는 applied event type입니다: ${String(eventType)}`);
        }
        const valueFixedPoint = Number(
            event.valueFixedPoint ?? event.damageFixedPoint ?? 0
        );
        const flags = toNonNegativeSafeInteger(event.flags);
        const maximumDamageWindow = event.maximumDamageWindow === true;
        const encodedMaximumDamageWindow = (
            flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.MAXIMUM_DAMAGE_WINDOW
        ) !== 0;
        if (maximumDamageWindow !== encodedMaximumDamageWindow) {
            throw new RangeError(
                'Maximum Damage Window event flag와 public marker가 일치하지 않습니다.'
            );
        }
        const directionalDefense = event.directionalDefense === true;
        const encodedDirectionalDefense = (
            flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.DIRECTIONAL_DEFENSE
        ) !== 0;
        if (directionalDefense !== encodedDirectionalDefense) {
            throw new RangeError(
                'Directional Defense event flag와 public marker가 일치하지 않습니다.'
            );
        }
        const atomicTransformTriggerFirstHit
            = event.atomicTransformTriggerFirstHit === true;
        const encodedAtomicTransformTriggerFirstHit = (
            flags
                & GPU_CIRCLE_APPLIED_EVENT_FLAG
                    .ATOMIC_TRANSFORM_TRIGGER_FIRST_HIT
        ) !== 0;
        if (atomicTransformTriggerFirstHit
            !== encodedAtomicTransformTriggerFirstHit) {
            throw new RangeError(
                'Atomic Transform first-hit event flag와 public marker가 일치하지 않습니다.'
            );
        }
        if (Number(maximumDamageWindow)
            + Number(directionalDefense)
            + Number(atomicTransformTriggerFirstHit) > 1) {
            throw new RangeError(
                'damage0 typed mitigation/transform marker는 상호 배타적이어야 합니다.'
            );
        }
        const targetDied = (
            flags & GPU_CIRCLE_APPLIED_EVENT_FLAG.TARGET_DIED
        ) !== 0;
        const allowsZeroDamage = eventType === 'damage-applied'
            && (maximumDamageWindow
                || directionalDefense
                || atomicTransformTriggerFirstHit);
        const isChargeBehaviorEvent = eventType === 'enemy-charge-windup-started'
            || eventType === 'enemy-charge-contact-recoil-started';
        const isCoreDamageRequest = eventType === 'core-damage-request';
        if (!Number.isSafeInteger(valueFixedPoint)
            || (atomicTransformTriggerFirstHit && valueFixedPoint !== 0)
            || (eventType === 'damage-applied' && (
                valueFixedPoint < 0
                || (valueFixedPoint === 0 && !allowsZeroDamage)
                || (valueFixedPoint === 0 && targetDied)
            ))
            || (eventType !== 'damage-applied' && !isCoreDamageRequest && (
                valueFixedPoint !== 0
                || maximumDamageWindow
                || directionalDefense
                || atomicTransformTriggerFirstHit
            ))
            || (isCoreDamageRequest && (
                valueFixedPoint <= 0
                || maximumDamageWindow
                || directionalDefense
                || atomicTransformTriggerFirstHit
            ))
            || ((isChargeBehaviorEvent || isCoreDamageRequest) && flags !== 0)) {
            throw new RangeError(
                `event value/type contract가 잘못되었습니다: type=${eventType}, value=${valueFixedPoint}`
            );
        }
        const requiresExactOther = eventType === 'damage-applied'
            || eventType === 'core-damage-request'
            || eventType === 'enemy-charge-windup-started'
            || eventType === 'enemy-charge-contact-recoil-started';
        if (requiresExactOther
            && (otherEntityId <= 0 || otherIncarnation <= 0)) {
            throw new RangeError(`${eventType} event에는 exact other identity가 필요합니다.`);
        }
        const key = [
            this.sessionGeneration,
            deviceGeneration,
            authoritativeEpoch,
            entityId,
            incarnation,
            sourceTick,
            sequence,
            eventType
        ].join(':');
        const normalized = {
            key,
            type,
            eventType,
            sessionGeneration: this.sessionGeneration,
            deviceGeneration,
            authoritativeEpoch,
            sourceTick,
            sequence,
            entityId,
            incarnation,
            otherEntityId,
            otherIncarnation,
            other: otherEntityId > 0 && otherIncarnation > 0
                ? Object.freeze({
                    entityId: otherEntityId,
                    incarnation: otherIncarnation
                })
                : null,
            bodyId: toNonNegativeSafeInteger(event.bodyId),
            position: freezePosition(event.position),
            valueFixedPoint,
            damageFixedPoint: eventType === 'damage-applied' ? valueFixedPoint : 0,
            damage: eventType === 'damage-applied'
                && Number.isFinite(Number(event.damage))
                ? Number(event.damage)
                : 0,
            flags,
            maximumDamageWindow,
            directionalDefense,
            atomicTransformTriggerFirstHit,
            reasonFlags: toNonNegativeSafeInteger(
                event.reasonFlags ?? (type === 'death' ? event.flags : 0)
            ),
            reason: event.reason ?? null
        };
        const fingerprint = JSON.stringify([
            normalized.type,
            normalized.eventType,
            normalized.entityId,
            normalized.incarnation,
            normalized.otherEntityId,
            normalized.otherIncarnation,
            normalized.bodyId,
            normalized.valueFixedPoint,
            normalized.flags,
            normalized.maximumDamageWindow,
            normalized.directionalDefense,
            normalized.atomicTransformTriggerFirstHit,
            normalized.reasonFlags,
            normalized.position?.x ?? null,
            normalized.position?.y ?? null
        ]);
        return Object.freeze({ ...normalized, fingerprint });
    }

    #isCompletedEventIdentityLive(event) {
        const subject = {
            entityId: event.entityId,
            incarnation: event.incarnation
        };
        if (!this.registry.has(subject) || !this.backend.hasBody(subject)) {
            return false;
        }
        if (event.otherEntityId > 0 && event.otherIncarnation > 0) {
            const other = {
                entityId: event.otherEntityId,
                incarnation: event.otherIncarnation
            };
            return this.registry.has(other) && this.backend.hasBody(other);
        }
        return true;
    }

    #rememberCompletedBatchKey(key, fingerprint) {
        this.knownCompletedBatchKeys.set(key, fingerprint);
        this.completedBatchKeys.push(key);
        while ((this.completedBatchKeys.length - this.completedBatchKeyHead)
            > this.completedEventKeyHistoryCapacity) {
            this.knownCompletedBatchKeys.delete(
                this.completedBatchKeys[this.completedBatchKeyHead++]
            );
        }
        if (this.completedBatchKeyHead >= this.completedEventKeyHistoryCapacity) {
            this.completedBatchKeys = this.completedBatchKeys.slice(
                this.completedBatchKeyHead
            );
            this.completedBatchKeyHead = 0;
        }
    }

    #getAcceptedProjectileCaptureProtocol(envelope) {
        if (!envelope || typeof envelope !== 'object') {
            return null;
        }
        return this.#acceptedProjectileCaptureProtocols.get([
            envelope.sessionGeneration,
            envelope.deviceGeneration,
            envelope.authoritativeEpoch,
            envelope.sourceTick
        ].join(':')) ?? null;
    }

    #rememberAcceptedProjectileCaptureProtocol(source) {
        const capacityRejected = source?.capacityRejected === true;
        const protocol = Object.freeze({
            ...source,
            capacityRejected,
            capacityRejectionFlags: capacityRejected
                ? Number(source.capacityRejectionFlags) >>> 0
                : 0
        });
        const key = [
            protocol.sessionGeneration,
            protocol.deviceGeneration,
            protocol.authoritativeEpoch,
            protocol.sourceTick
        ].join(':');
        if (!this.#acceptedProjectileCaptureProtocols.has(key)) {
            this.#acceptedProjectileCaptureProtocolKeys.push(key);
        }
        this.#acceptedProjectileCaptureProtocols.set(key, protocol);
        this.lastAcceptedProjectileCaptureProtocol = protocol;
        while ((this.#acceptedProjectileCaptureProtocolKeys.length
                - this.#acceptedProjectileCaptureProtocolKeyHead)
            > this.completedEventKeyHistoryCapacity) {
            this.#acceptedProjectileCaptureProtocols.delete(
                this.#acceptedProjectileCaptureProtocolKeys[
                    this.#acceptedProjectileCaptureProtocolKeyHead++
                ]
            );
        }
        if (this.#acceptedProjectileCaptureProtocolKeyHead
            >= this.completedEventKeyHistoryCapacity) {
            this.#acceptedProjectileCaptureProtocolKeys
                = this.#acceptedProjectileCaptureProtocolKeys.slice(
                    this.#acceptedProjectileCaptureProtocolKeyHead
                );
            this.#acceptedProjectileCaptureProtocolKeyHead = 0;
        }
        return protocol;
    }

    #rememberCompletedEventKey(key, fingerprint) {
        this.knownCompletedEventKeys.set(key, fingerprint);
        this.completedEventKeys.push(key);
        while ((this.completedEventKeys.length - this.completedEventKeyHead)
            > this.completedEventKeyHistoryCapacity) {
            this.knownCompletedEventKeys.delete(
                this.completedEventKeys[this.completedEventKeyHead++]
            );
        }
        if (this.completedEventKeyHead >= this.completedEventKeyHistoryCapacity) {
            this.completedEventKeys = this.completedEventKeys.slice(
                this.completedEventKeyHead
            );
            this.completedEventKeyHead = 0;
        }
    }

    #validatePriorityTargetControl(command) {
        if (!command || typeof command !== 'object') {
            return this.#fixedTargetRejection(
                'priority-target-control-contract'
            );
        }
        const source = this.#readExactRuntimeCandidate(
            command.sourceHandle,
            'enemy',
            BASIC_RHOM_ENEMY_DEFINITION_ID,
            'priority-source'
        );
        if (source.failure) {
            return source.failure;
        }
        const metadata = source.view.metadata;
        if (!metadata
            || metadata.enemyDefinitionId !== BASIC_RHOM_ENEMY_DEFINITION_ID
            || metadata.definitionId !== BASIC_RHOM_ENEMY_DEFINITION_ID
            || metadata.capabilityMask !== BASIC_RHOM_CAPABILITY_MASK
            || metadata.physicsProfileId !== BASIC_RHOM_PHYSICS_PROFILE_ID
            || metadata.combatProfileId !== BASIC_RHOM_COMBAT_PROFILE_ID
            || metadata.behaviorProfileId !== BASIC_RHOM_BEHAVIOR_PROFILE_ID) {
            return this.#fixedTargetRejection('priority-source-metadata-invalid');
        }
        const core = this.#readExactRuntimeCandidate(
            command.coreTargetHandle,
            GPU_CORE_PROXY_WORLD_KIND_ID,
            GPU_CORE_PROXY_DEFINITION_ID,
            'priority-core'
        );
        if (core.failure) {
            return core.failure;
        }
        if (command.towerTargetHandle !== undefined
            && command.towerTargetHandle !== null) {
            const tower = this.#readExactRuntimeCandidate(
                command.towerTargetHandle,
                GPU_TOWER_WORLD_KIND_ID,
                GPU_TOWER_DEFINITION_ID,
                'priority-tower'
            );
            if (tower.failure) {
                return tower.failure;
            }
        }
        if (command.attackDefinitionId !== BASIC_RHOM_ATTACK_DATA.id
            || command.projectileDefinitionId
                !== HOSTILE_RHOM_PROJECTILE_DATA.id
            || command.producerId !== BASIC_RHOM_ATTACK_DATA.producerId
            || command.sourceAbilityId !== BASIC_RHOM_ATTACK_DATA.sourceAbilityId
            || command.targetSelectionPolicyId
                !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                    .CORE_FIRST_IN_RANGE_THEN_TOWER
            || command.distancePolicyId
                !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                    .TICK_START_CENTER_INCLUSIVE
            || command.stopWhileTargetInRange !== true
            || Math.fround(Number(command.attackRangeTiles))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.attackRangeTiles)
            || !Number.isSafeInteger(Number(command.selectionSequence))
            || Number(command.selectionSequence) < 0) {
            return this.#fixedTargetRejection(
                'priority-target-control-evidence-invalid'
            );
        }
        return null;
    }

    #validateSelectedTargetSpawn(intent) {
        if (!intent || typeof intent !== 'object'
            || intent.mode
                !== GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET) {
            return this.#fixedTargetRejection('selected-target-spawn-contract');
        }
        const source = this.#readExactRuntimeCandidate(
            intent.sourceHandle,
            'enemy',
            BASIC_RHOM_ENEMY_DEFINITION_ID,
            'selected-source'
        );
        if (source.failure) {
            return source.failure;
        }
        const metadata = source.view.metadata;
        if (!metadata
            || metadata.enemyDefinitionId !== BASIC_RHOM_ENEMY_DEFINITION_ID
            || metadata.definitionId !== BASIC_RHOM_ENEMY_DEFINITION_ID
            || metadata.capabilityMask !== BASIC_RHOM_CAPABILITY_MASK
            || metadata.physicsProfileId !== BASIC_RHOM_PHYSICS_PROFILE_ID
            || metadata.combatProfileId !== BASIC_RHOM_COMBAT_PROFILE_ID
            || metadata.behaviorProfileId !== BASIC_RHOM_BEHAVIOR_PROFILE_ID) {
            return this.#fixedTargetRejection('selected-source-metadata-invalid');
        }
        const core = this.#readExactRuntimeCandidate(
            intent.coreTargetHandle,
            GPU_CORE_PROXY_WORLD_KIND_ID,
            GPU_CORE_PROXY_DEFINITION_ID,
            'selected-core'
        );
        if (core.failure) {
            return core.failure;
        }
        if (intent.towerTargetHandle !== undefined
            && intent.towerTargetHandle !== null) {
            const tower = this.#readExactRuntimeCandidate(
                intent.towerTargetHandle,
                GPU_TOWER_WORLD_KIND_ID,
                GPU_TOWER_DEFINITION_ID,
                'selected-tower'
            );
            if (tower.failure) {
                return tower.failure;
            }
        }
        const destination = intent.destinationSpawn;
        const sourceHandle = intent.sourceHandle;
        const coreHandle = intent.coreTargetHandle;
        const towerHandle = intent.towerTargetHandle ?? null;
        const positionOffset = intent.positionOffset;
        const targetOffset = intent.targetOffset;
        const behavior = destination?.enemyBehaviorState;
        const expectedHandlerFlags = GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG
            .KILL_IF_OTHER_TERRAIN
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY
            | GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CORE_DAMAGE_REQUEST;
        const expectedInteractionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
        if (!destination
            || destination.kindId !== GPU_PROJECTILE_WORLD_KIND_ID
            || destination.definitionId !== HOSTILE_RHOM_PROJECTILE_DATA.id
            || destination.sourceEntityId !== sourceHandle.entityId
            || destination.sourceIncarnation !== sourceHandle.incarnation
            || destination.ownerEntityId !== sourceHandle.entityId
            || destination.ownerIncarnation !== sourceHandle.incarnation
            || destination.coreTargetEntityId !== coreHandle.entityId
            || destination.coreTargetIncarnation !== coreHandle.incarnation
            || (towerHandle === null
                ? destination.towerTargetEntityId !== undefined
                    || destination.towerTargetIncarnation !== undefined
                : destination.towerTargetEntityId !== towerHandle.entityId
                    || destination.towerTargetIncarnation
                        !== towerHandle.incarnation)
            || destination.targetPolicyId
                !== PROJECTILE_TARGET_POLICY_ID
                    .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN
            || destination.towerTargetPolicyId
                !== HOSTILE_RHOM_PROJECTILE_DATA.towerTargetPolicyId
            || destination.coreTargetPolicyId
                !== HOSTILE_RHOM_PROJECTILE_DATA.coreTargetPolicyId
            || destination.coreDamageRequestPolicyId
                !== HOSTILE_RHOM_PROJECTILE_DATA.coreDamageRequestPolicyId
            || destination.requiresExactSelectedTarget !== true
            || destination.coreDamage !== HOSTILE_RHOM_PROJECTILE_DATA.coreDamage
            || destination.targetSelectionPolicyId
                !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                    .CORE_FIRST_IN_RANGE_THEN_TOWER
            || destination.distancePolicyId
                !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                    .TICK_START_CENTER_INCLUSIVE
            || destination.producerId !== BASIC_RHOM_ATTACK_DATA.producerId
            || destination.sourceAbilityId
                !== BASIC_RHOM_ATTACK_DATA.sourceAbilityId
            || destination.coreDamageFixedPoint
                !== HOSTILE_RHOM_CORE_DAMAGE_FIXED_POINT
            || destination.health !== HOSTILE_RHOM_PROJECTILE_DATA.penetration
            || destination.radius
                !== HOSTILE_RHOM_PROJECTILE_DATA.collisionRadius
            || destination.inverseMass
                !== HOSTILE_RHOM_PROJECTILE_DATA.inverseMass
            || destination.lifetime
                !== HOSTILE_RHOM_PROJECTILE_DATA.lifetimeSeconds
            || destination.interactionMask !== expectedInteractionMask
            || destination.position?.x !== 0
            || destination.position?.y !== 0
            || destination.velocity?.x !== 0
            || destination.velocity?.y !== 0
            || destination.contactHandler?.damageSelf
                !== HOSTILE_RHOM_PROJECTILE_DATA.damageSelf
            || destination.contactHandler?.damageOther
                !== HOSTILE_RHOM_PROJECTILE_DATA.damage
            || destination.contactHandler?.flags !== expectedHandlerFlags
            || behavior?.programId
                !== GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE
            || behavior.coreDamageFixedPoint
                !== HOSTILE_RHOM_CORE_DAMAGE_FIXED_POINT
            || intent.targetSelectionPolicyId
                !== destination.targetSelectionPolicyId
            || intent.distancePolicyId !== destination.distancePolicyId
            || intent.stopWhileTargetInRange !== true
            || Math.fround(Number(intent.attackRangeTiles))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.attackRangeTiles)
            || Math.fround(Number(destination.attackRangeTiles))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.attackRangeTiles)
            || Math.fround(Number(intent.launchSpeed))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.launchSpeed)
            || Math.fround(Number(positionOffset?.x))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.positionOffset.x)
            || Math.fround(Number(positionOffset?.y))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.positionOffset.y)
            || Math.fround(Number(targetOffset?.x))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.targetOffset.x)
            || Math.fround(Number(targetOffset?.y))
                !== Math.fround(BASIC_RHOM_ATTACK_DATA.targetOffset.y)) {
            return this.#fixedTargetRejection(
                'selected-target-spawn-evidence-invalid'
            );
        }
        return null;
    }

    #readExactRuntimeCandidate(handle, kindId, definitionId, reasonPrefix) {
        const entityId = Number(handle?.entityId);
        const incarnation = Number(handle?.incarnation);
        if (!Number.isSafeInteger(entityId) || entityId <= 0
            || !Number.isSafeInteger(incarnation) || incarnation <= 0) {
            return {
                failure: this.#fixedTargetRejection(
                    `${reasonPrefix}-handle-invalid`
                )
            };
        }
        const exactHandle = { entityId, incarnation };
        let registryHas;
        let backendHas;
        try {
            registryHas = this.registry.has(exactHandle);
            backendHas = this.backend.hasBody(exactHandle);
        } catch {
            return {
                failure: this.#fixedTargetRejection(
                    `${reasonPrefix}-handle-invalid`
                )
            };
        }
        if (registryHas !== backendHas) {
            return {
                failure: this.#fixedTargetRejection(
                    `${reasonPrefix}-registry-backend-desync`
                )
            };
        }
        if (!registryHas) {
            return {
                failure: this.#fixedTargetRejection(`${reasonPrefix}-stale`)
            };
        }
        const view = this.registry.copyEntityView(exactHandle, {});
        if (!view
            || view.entityId !== entityId
            || view.incarnation !== incarnation
            || view.kindId !== kindId
            || view.definitionId !== definitionId) {
            return {
                failure: this.#fixedTargetRejection(
                    `${reasonPrefix}-kind-definition-invalid`
                )
            };
        }
        return { failure: null, view };
    }

    #fixedTargetRejection(reason) {
        return Object.freeze({ accepted: false, reason });
    }

    #failTowerGameplayTargetBackend(reason, error = null) {
        const code = typeof reason === 'string' && reason.length > 0
            ? reason
            : 'tower-gameplay-target-backend-failure';
        this.completedEventRecoveryRequired = true;
        this.completedEventProtocolFailure = Object.freeze({
            stage: 'tower-gameplay-target-config',
            code,
            name: typeof error?.name === 'string'
                ? error.name
                : 'TowerGameplayTargetBackendFailure',
            message: typeof error?.message === 'string'
                ? error.message
                : 'Tower gameplay target backend mutation이 실패했습니다.'
        });
        const rejected = Object.freeze({ accepted: false, reason: code });
        this.towerGameplayTargetDiagnostic = rejected;
        return rejected;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 GpuEnemySimulationEndpoint는 사용할 수 없습니다.');
        }
    }

    #rejectClosedGameplayIngress(extra = null) {
        if (this.gameplayIngressOpen) {
            return null;
        }
        return Object.freeze({
            accepted: false,
            reason: this.gameplayIngressCloseReason ?? 'gameplay-ingress-closed',
            ...(extra ?? {})
        });
    }

    #finalizeClosedLifecycleIngress() {
        if (!this.gameplayIngressOpen) {
            this.lifecycleCommandOwner.finalizeClosedIngress();
        }
    }

    #rememberEffectLifecycleCommit(commit, fixedTick) {
        if (this.lifecycleCommandOwner.getLastCommitResult() !== commit
            || commit?.fixedTick !== fixedTick
            || commit.recoveryRequired !== false
            || !Array.isArray(commit.despawned)) {
            throw new Error('Effect lifecycle proof는 authentic same-boundary commit이어야 합니다.');
        }
        this.#authenticEffectLifecycleCommits.add(commit);
        if (this.#effectLifecycleCommitProofTick !== fixedTick) {
            this.#effectLifecycleCommitProofTick = fixedTick;
            this.#effectLifecycleCommitProofs.length = 0;
        }
        if (commit.despawned.length > 0) {
            this.#effectLifecycleCommitProofs.push(commit);
        }
    }

    #revokeCoreImpactCleanupPort() {
        if (this.#coreImpactCleanupPortState?.revoked !== true) {
            this.#coreImpactCleanupPortState.revoked = true;
            this.#terminalCleanupAuthority?.revoke();
        }
    }
}

/**
 * 게임·벤치마크·도구 코드가 같은 기본 구성을 공유하는 간단한 생성 진입점입니다.
 */
export function createGpuEnemySimulationEndpoint(dependencies = {}, options = {}) {
    return new GpuEnemySimulationEndpoint(dependencies, options);
}

/**
 * 적·투사체가 한 body/grid session을 공유하는 canonical public class alias입니다.
 * 기존 `GpuEnemySimulationEndpoint`와 constructor identity가 같습니다.
 */
export const GpuSimulationEndpoint = GpuEnemySimulationEndpoint;

/** mixed-body GPU session의 canonical factory입니다. */
export function createGpuSimulationEndpoint(dependencies = {}, options = {}) {
    return new GpuSimulationEndpoint(dependencies, options);
}
