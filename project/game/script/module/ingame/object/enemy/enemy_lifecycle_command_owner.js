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
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    assertEnemyAtomicTransformTransactionPort,
    normalizeEnemyAtomicTransformDescriptor
} from '../../contract/enemy_atomic_transform_contract.js';
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
    materializeNaturalCorkRouteClosureActivation,
    materializeNaturalJorangAtomicTransformActivation,
    materializeNaturalHexaFormationActivation,
    normalizeGpuPrivateHexaTransformDestinationIntent
} from './gpu_enemy_spawn_adapter.js';
import {
    BASIC_HEXA_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_hexa_enemy_data.js';
import {
    BASIC_JORANG_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_jorang_enemy_data.js';
import {
    JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK
} from 'data/object/enemy/enemy_jorang_split_runtime_data.js';
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
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID,
    normalizeGameplayDamagePolicyId
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_KEYS,
    normalizeProjectileOriginProvenance
} from '../../contract/projectile_capture_contract.js';
import {
    GPU_PROJECTILE_CAPTURE_RELEASE_REASON,
    GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION,
    GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
} from '../../physics/gpu/gpu_projectile_capture_runtime_abi.js';
import {
    ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID
} from 'data/object/enemy/enemy_route_closure_catalog_data.js';
import {
    BASIC_CORK_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_cork_enemy_data.js';
import {
    ROUTE_AVAILABILITY_ABI_VERSION
} from '../../contract/route_availability_contract.js';
import {
    GPU_ROUTE_LIFECYCLE_ABI_VERSION
} from '../../physics/gpu/gpu_route_runtime_abi.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_HISTORY_CAPACITY = 65536;
export const ENEMY_ORBIT_SLOT_CAPACITY_REJECTION_CODE = 'orbit-slot-capacity';
export const ENEMY_ORBIT_SLOT_METADATA_CORRUPTION_CODE = (
    'orbit-slot-metadata-corruption'
);
export const ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION = (
    'cork-route-terminal-cleanup'
);
// 외부 options/reason이나 reflection으로 재현할 수 없는 command identity marker입니다.
// fixed commit payload에는 노출하지 않고 terminal close의 보존 여부만 지배합니다.
const AUTHENTIC_TERMINAL_CLEANUP_COMMANDS = new WeakSet();
const PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION = (
    'projectile-capture-terminal-held-unpublished'
);
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
const ENEMY_ATOMIC_TRANSFORM_REQUEST_FIELDS = Object.freeze([
    'prepareSourceTick',
    'transformFixedTick',
    'batchIdFingerprint',
    'records'
]);
const FORMATION_ATOMIC_TRANSFORM_REQUEST_FIELDS = Object.freeze([
    'prepareSourceTick',
    'batchIdFingerprint',
    'records'
]);
const ENEMY_ATOMIC_TRANSFORM_RECORD_FIELDS = Object.freeze([
    'topologyId',
    'sourceHandles',
    'destinationIntents',
    'effectTransferDestinationIndex',
    'disposition',
    'prepareEvidence'
]);
const PROJECTILE_CAPTURE_RELEASE_REQUEST_FIELDS = Object.freeze([
    'prepareSourceTick',
    'batchIdFingerprint',
    'records'
]);
const PROJECTILE_CAPTURE_RELEASE_RECORD_FIELDS = Object.freeze([
    'projectileHandle',
    'captorHandle',
    'captureSequence',
    'releaseReason',
    'expectedMetadata',
    'expectedMetadataRevision',
    'towerTargetHandle',
    'prepareEvidence',
    'coreImpactReceipt'
]);
const PROJECTILE_CAPTURE_RELEASE_REASONS = new Set(
    Object.values(GPU_PROJECTILE_CAPTURE_RELEASE_REASON)
);

function fingerprintProjectileCaptureCommandId(value) {
    const text = String(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash === 0 || hash === INVALID_HANDLE_COMPONENT ? 1 : hash;
}

function fingerprintRouteLifecycleBatch(targetFixedTick, plans) {
    const identities = plans.map((plan) => plan.commandId).sort();
    return fingerprintProjectileCaptureCommandId(
        `route-lifecycle:${targetFixedTick}:${identities.join('\u0000')}`
    );
}

function resolveRouteClosureProfile(intent, label) {
    const profileId = intent?.routeClosureProfileId;
    if (profileId === undefined || profileId === null) {
        return null;
    }
    if (typeof profileId !== 'string' || profileId.length === 0) {
        throw new TypeError(`${label}.routeClosureProfileId가 유효하지 않습니다.`);
    }
    const profile = ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID[profileId];
    if (!profile) {
        throw new RangeError(`${label} route closure profile이 없습니다: ${profileId}`);
    }
    if (intent.definitionId !== BASIC_CORK_ENEMY_DEFINITION_ID
        || intent.enemyDefinitionId !== BASIC_CORK_ENEMY_DEFINITION_ID
        || intent.routeClosureProfileCode !== profile.definitionCode) {
        throw new RangeError(
            `${label} route closure profile/definition/code 조합이 canonical Cork가 아닙니다.`
        );
    }
    return profile;
}

function snapshotRouteRuntimeBinding(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} route runtime binding이 필요합니다.`);
    }
    const graphContentKey = requireNonEmptyString(
        source.graphContentKey,
        `${label}.graphContentKey`
    );
    const rosterCount = requireNonNegativeSafeInteger(
        source.rosterCount,
        `${label}.rosterCount`
    );
    if (source.abiVersion !== ROUTE_AVAILABILITY_ABI_VERSION
        || source.sessionGeneration <= 0
        || !Number.isSafeInteger(source.sessionGeneration)
        || source.sessionGeneration >= INVALID_HANDLE_COMPONENT
        || !Number.isSafeInteger(source.deviceGeneration)
        || source.deviceGeneration < 0
        || source.deviceGeneration >= INVALID_HANDLE_COMPONENT
        || !Number.isSafeInteger(source.authoritativeEpoch)
        || source.authoritativeEpoch < 0
        || source.authoritativeEpoch >= INVALID_HANDLE_COMPONENT
        || !Number.isSafeInteger(source.availabilityVersion)
        || source.availabilityVersion <= 0
        || source.availabilityVersion >= INVALID_HANDLE_COMPONENT
        || rosterCount >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label} route runtime binding이 canonical 범위를 벗어났습니다.`);
    }
    return Object.freeze({
        abiVersion: source.abiVersion,
        sessionGeneration: source.sessionGeneration,
        deviceGeneration: source.deviceGeneration,
        authoritativeEpoch: source.authoritativeEpoch,
        graphContentKey,
        availabilityVersion: source.availabilityVersion,
        rosterCount
    });
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 positive non-sentinel uint32여야 합니다.`);
    }
    return value;
}

function requireProjectileCaptureReleaseReason(value, label) {
    const reason = requirePositiveUint32(value, label);
    if (!PROJECTILE_CAPTURE_RELEASE_REASONS.has(reason)) {
        throw new RangeError(`${label}은 알려진 projectile release reason이어야 합니다.`);
    }
    return reason;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function snapshotExactOwnDataFields(source, expectedFields, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== expectedFields.length
        || expectedFields.some((field) => !ownKeys.includes(field))) {
        throw new RangeError(
            `${label}은 exact ${expectedFields.join('/')} field만 가져야 합니다.`
        );
    }
    const snapshot = Object.create(null);
    for (const field of expectedFields) {
        const descriptor = descriptors[field];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${field}은 getter/setter일 수 없습니다.`);
        }
        snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
}

function snapshotBoundedDenseDataArray(source, maximumLength, label) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 array여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor?.value;
    if (!lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(length)
        || length <= 0
        || length > maximumLength
        || ownKeys.length !== length + 1
        || ownKeys.some((key) => {
            if (key === 'length') {
                return false;
            }
            if (typeof key !== 'string') {
                return true;
            }
            const index = Number(key);
            return !Number.isSafeInteger(index)
                || index < 0
                || index >= length
                || String(index) !== key;
        })) {
        throw new TypeError(`${label}은 bounded dense data array여야 합니다.`);
    }
    const values = [];
    for (let index = 0; index < length; index++) {
        const descriptor = descriptors[index];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}]는 data property여야 합니다.`);
        }
        values.push(descriptor.value);
    }
    return Object.freeze(values);
}

function snapshotAtomicTransformRequestEnvelope(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('atomicTransformRequest는 object여야 합니다.');
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError('atomicTransformRequest에는 symbol key를 허용하지 않습니다.');
    }
    const enemyTransform = Object.prototype.hasOwnProperty.call(
        descriptors,
        'transformFixedTick'
    );
    const expectedFields = enemyTransform
        ? ENEMY_ATOMIC_TRANSFORM_REQUEST_FIELDS
        : FORMATION_ATOMIC_TRANSFORM_REQUEST_FIELDS;
    if (ownKeys.length !== expectedFields.length
        || expectedFields.some((field) => !ownKeys.includes(field))) {
        throw new RangeError(
            `atomicTransformRequest는 exact ${expectedFields.join('/')} field만 가져야 합니다.`
        );
    }
    const snapshot = Object.create(null);
    for (const field of expectedFields) {
        const descriptor = descriptors[field];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(
                `atomicTransformRequest.${field}은 getter/setter일 수 없습니다.`
            );
        }
        snapshot[field] = descriptor.value;
    }
    return Object.freeze({
        enemyTransform,
        request: Object.freeze(snapshot)
    });
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

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function assertProjectileCaptureCoreImpactReceipt(
    receipt,
    captorHandle,
    prepareSourceTick,
    label
) {
    if (!receipt
        || typeof receipt !== 'object'
        || !Object.isFrozen(receipt)
        || !Object.isFrozen(receipt.other)
        || receipt.type !== 'contact'
        || (receipt.eventType !== 'interaction-enter'
            && receipt.eventType !== 'interaction-continuous')
        || receipt.disposition !== 'applied'
        || receipt.sourceTick !== prepareSourceTick
        || !Number.isSafeInteger(receipt.sessionGeneration)
        || receipt.sessionGeneration <= 0
        || !Number.isSafeInteger(receipt.deviceGeneration)
        || receipt.deviceGeneration < 0
        || !Number.isSafeInteger(receipt.authoritativeEpoch)
        || receipt.authoritativeEpoch < 0) {
        throw new TypeError(`${label}은 authenticated core-impact receipt여야 합니다.`);
    }
    const subject = normalizeHandle(receipt, `${label}.subjectHandle`);
    const other = normalizeHandle(receipt.other, `${label}.otherHandle`);
    if (!sameHandle(subject, captorHandle)
        && !sameHandle(other, captorHandle)) {
        throw new RangeError(`${label}의 captor identity가 다릅니다.`);
    }
    return receipt;
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

function assertFormationAtomicTransformTransactionPort(source) {
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

function assertProjectileCaptureReleaseTransactionPort(source) {
    const methods = [
        'armPreparedProjectileCaptureReleaseBatch',
        'commitArmedProjectileCaptureReleaseBatch',
        'cancelArmedProjectileCaptureReleaseBatch'
    ];
    if (!source || typeof source !== 'object') {
        throw new TypeError('projectile capture release transaction port가 필요합니다.');
    }
    for (const method of methods) {
        if (typeof source[method] !== 'function') {
            throw new TypeError(
                `projectile capture release transaction port.${method}()가 필요합니다.`
            );
        }
    }
    return source;
}

function assertRouteLifecyclePort(source) {
    for (const method of [
        'preflightRouteLifecycleBatch',
        'commitRouteLifecycleBatch',
        'cancelRouteLifecycleBatch'
    ]) {
        if (typeof source?.[method] !== 'function') {
            throw new TypeError(`routeLifecyclePort.${method}()가 필요합니다.`);
        }
    }
    return source;
}

function copyFrozenPrimitiveMetadata(source, label) {
    if (!source || typeof source !== 'object' || !Object.isFrozen(source)) {
        throw new TypeError(`${label}은 frozen metadata object여야 합니다.`);
    }
    const prototype = Object.getPrototypeOf(source);
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!isPlainObject) {
        throw new TypeError(`${label}은 plain metadata object여야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string') {
            throw new TypeError(`${label}에는 symbol key를 허용하지 않습니다.`);
        }
        const descriptor = descriptors[key];
        if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
        }
        const value = descriptor.value;
        if (value !== null
            && value !== undefined
            && typeof value !== 'string'
            && typeof value !== 'number'
            && typeof value !== 'boolean') {
            throw new TypeError(`${label}.${key}은 primitive여야 합니다.`);
        }
        result[key] = value ?? null;
    }
    return result;
}

function materializeProjectileCaptureReleaseMetadata(
    expectedMetadata,
    captorHandle,
    towerTargetHandle
) {
    const next = copyFrozenPrimitiveMetadata(
        expectedMetadata,
        'projectileCaptureRelease.expectedMetadata'
    );
    if (next.projectileCapturePolicyId
        !== PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE) {
        throw new RangeError('release projectile은 CAPTURABLE metadata여야 합니다.');
    }
    const provenanceSource = Object.create(null);
    for (const key of PROJECTILE_ORIGIN_PROVENANCE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            throw new RangeError(`release projectile origin metadata가 없습니다: ${key}`);
        }
        provenanceSource[key] = next[key];
    }
    normalizeGameplayDamagePolicyId(
        next.damagePolicyId,
        'projectileCaptureRelease.damagePolicyId'
    );
    const provenance = normalizeProjectileOriginProvenance(
        provenanceSource,
        'projectileCaptureRelease.originProvenance'
    );
    next.teamId = GAMEPLAY_TEAM_ID.HOSTILE;
    next.allegiancePolicy = GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE;
    next.ownerEntityId = captorHandle.entityId;
    next.ownerIncarnation = captorHandle.incarnation;
    next.sourceEntityId = captorHandle.entityId;
    next.sourceIncarnation = captorHandle.incarnation;
    next.targetEntityId = towerTargetHandle?.entityId ?? null;
    next.targetIncarnation = towerTargetHandle?.incarnation ?? null;
    next.targetPolicyId
        = PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN;
    for (const key of PROJECTILE_ORIGIN_PROVENANCE_KEYS) {
        if (next[key] !== provenance[key]) {
            throw new RangeError(`release projectile origin metadata drift: ${key}`);
        }
    }
    return Object.freeze(next);
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
        atomicTransforms: Object.freeze(
            result.atomicTransforms.map((entry) => Object.freeze(entry))
        ),
        projectileCaptureReleases: Object.freeze(
            result.projectileCaptureReleases.map((entry) => Object.freeze(entry))
        ),
        routeLifecycle: Object.freeze(
            result.routeLifecycle.map((entry) => Object.freeze(entry))
        ),
        routeRuntimeBinding: result.routeRuntimeBinding,
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
    #enemyAtomicTransformTransactionPort;
    #projectileCaptureReleaseAuthority;
    #activeMetadataMutationRegistryAuthority;
    #projectileCaptureReleaseTransactionPort;
    #routeLifecyclePort;
    #authoredFormationProvenanceLedger;

    /**
     * @param {object} backend - EnemySimulationBackend public port입니다.
     * @param {object} registry - WorldRegistry입니다.
     * @param {{commandHistoryCapacity?:number,terminalCleanupAuthority?:object|null,atomicTransformAuthority?:object|null,atomicTransformRegistryAuthority?:object|null,atomicTransformTransactionPort?:object|null,enemyAtomicTransformTransactionPort?:object|null,projectileCaptureReleaseAuthority?:object|null,activeMetadataMutationRegistryAuthority?:object|null,projectileCaptureReleaseTransactionPort?:object|null,routeLifecyclePort?:object|null}} [options={}] - 중복 command 억제 범위와 비공개 privileged authority입니다.
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
        const enemyAtomicTransformTransactionPort
            = options.enemyAtomicTransformTransactionPort ?? null;
        const hasAtomicTransformPort = atomicTransformTransactionPort !== null
            || enemyAtomicTransformTransactionPort !== null;
        const hasAtomicAuthorities = atomicTransformAuthority !== null
            && atomicTransformRegistryAuthority !== null;
        if (hasAtomicTransformPort !== hasAtomicAuthorities
            || ((atomicTransformAuthority === null)
                !== (atomicTransformRegistryAuthority === null))) {
            throw new TypeError(
                'atomic transform authority/registry authority와 하나 이상의 transaction port가 함께 필요합니다.'
            );
        }
        if (hasAtomicTransformPort) {
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
                = atomicTransformTransactionPort === null
                ? null
                : assertFormationAtomicTransformTransactionPort(
                    atomicTransformTransactionPort
                );
            this.#enemyAtomicTransformTransactionPort
                = enemyAtomicTransformTransactionPort === null
                ? null
                : assertEnemyAtomicTransformTransactionPort(
                    enemyAtomicTransformTransactionPort
                );
        } else {
            this.#atomicTransformTransactionPort = null;
            this.#enemyAtomicTransformTransactionPort = null;
        }
        const projectileCaptureReleaseAuthority
            = options.projectileCaptureReleaseAuthority ?? null;
        const activeMetadataMutationRegistryAuthority
            = options.activeMetadataMutationRegistryAuthority ?? null;
        const projectileCaptureReleaseTransactionPort
            = options.projectileCaptureReleaseTransactionPort ?? null;
        const hasProjectileCaptureReleaseAuthority
            = projectileCaptureReleaseAuthority !== null;
        const hasActiveMetadataMutationAuthority
            = activeMetadataMutationRegistryAuthority !== null;
        const hasProjectileCaptureReleasePort
            = projectileCaptureReleaseTransactionPort !== null;
        if (hasProjectileCaptureReleaseAuthority
            !== hasActiveMetadataMutationAuthority
            || hasProjectileCaptureReleaseAuthority
                !== hasProjectileCaptureReleasePort) {
            throw new TypeError(
                'projectile capture release authority/registry authority/transaction port가 함께 필요합니다.'
            );
        }
        if (hasProjectileCaptureReleaseAuthority
            && typeof projectileCaptureReleaseAuthority?.consumePermit
                !== 'function') {
            throw new TypeError(
                'projectileCaptureReleaseAuthority.consumePermit()가 필요합니다.'
            );
        }
        if (hasActiveMetadataMutationAuthority
            && typeof activeMetadataMutationRegistryAuthority !== 'object') {
            throw new TypeError(
                'activeMetadataMutationRegistryAuthority는 opaque object여야 합니다.'
            );
        }
        if (hasProjectileCaptureReleasePort) {
            for (const method of [
                'preflightActiveMetadataMutationBatch',
                'commitActiveMetadataMutationBatch',
                'cancelActiveMetadataMutationBatch',
                'copyEntityView'
            ]) {
                if (typeof this.registry?.[method] !== 'function') {
                    throw new TypeError(
                        `EnemyLifecycle metadata registry.${method}()가 필요합니다.`
                    );
                }
            }
        }
        this.#projectileCaptureReleaseAuthority
            = projectileCaptureReleaseAuthority;
        this.#activeMetadataMutationRegistryAuthority
            = activeMetadataMutationRegistryAuthority;
        this.#projectileCaptureReleaseTransactionPort
            = hasProjectileCaptureReleasePort
            ? assertProjectileCaptureReleaseTransactionPort(
                projectileCaptureReleaseTransactionPort
            )
            : null;
        this.#routeLifecyclePort = options.routeLifecyclePort === undefined
            || options.routeLifecyclePort === null
            ? null
            : assertRouteLifecyclePort(options.routeLifecyclePort);
        if (this.#routeLifecyclePort
            && typeof this.registry.copyEntityView !== 'function') {
            throw new TypeError(
                'route lifecycle integration에는 registry.copyEntityView()가 필요합니다.'
            );
        }
        this.pendingCommands = [];
        this.knownCommandIds = new Set();
        this.completedCommandIds = [];
        this.completedCommandHead = 0;
        this.pendingDespawnKeys = new Set();
        this.pendingAtomicTransformSourceKeys = new Set();
        this.pendingProjectileCaptureReleaseKeys = new Set();
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
        const requestedProjectileCaptureTerminalCleanup
            = reason === PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
            && options?.disposition
                === PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
            && typeof commandId === 'string'
            && commandId.startsWith('ring-projectile-capture-terminal:');
        const requestedRouteTerminalCleanup
            = reason === ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
            && options?.disposition
                === ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
            && typeof commandId === 'string'
            && commandId.startsWith('cork-route-terminal:');
        const authenticCoreImpactCleanup = validTerminalCleanupPermit
            && requestedCoreImpactCleanup;
        const authenticGpuDeathCleanup = validTerminalCleanupPermit
            && requestedGpuDeathCleanup;
        const authenticProjectileCaptureTerminalCleanup
            = validTerminalCleanupPermit
            && requestedProjectileCaptureTerminalCleanup;
        const authenticRouteTerminalCleanup = validTerminalCleanupPermit
            && requestedRouteTerminalCleanup;
        const authenticTerminalCleanup = authenticCoreImpactCleanup
            || authenticGpuDeathCleanup
            || authenticProjectileCaptureTerminalCleanup
            || authenticRouteTerminalCleanup;
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
            : options.disposition
                === PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
                && authenticProjectileCaptureTerminalCleanup
            ? PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
            : options.disposition === ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                && authenticRouteTerminalCleanup
            ? ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
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
            if ((authenticCoreImpactCleanup
                    || authenticProjectileCaptureTerminalCleanup
                    || authenticRouteTerminalCleanup)
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
            const shouldRetargetProjectileCaptureTerminal
                = authenticProjectileCaptureTerminalCleanup
                && existing.targetFixedTick > tick;
            const shouldRetargetRouteTerminal = authenticRouteTerminalCleanup
                && existing.targetFixedTick > tick;
            const shouldUpgradeCoreImpact = authenticCoreImpactCleanup
                && normalizedReason === 'core-impact'
                && disposition === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                && existing.disposition
                    !== ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT;
            const shouldAuthenticateExisting = authenticCoreImpactCleanup
                || authenticProjectileCaptureTerminalCleanup
                || authenticRouteTerminalCleanup
                || (sameFixedTick
                    && authenticGpuDeathCleanup
                    && existing.reason === 'gpu-death');
            const dispositionUpgraded = shouldUpgradeCoreImpact
                && existing.disposition
                    !== ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT;
            const provenanceUpgraded = shouldAuthenticateExisting
                && !AUTHENTIC_TERMINAL_CLEANUP_COMMANDS.has(existing);
            const shouldUpgradeProjectileCaptureTerminal
                = authenticProjectileCaptureTerminalCleanup
                && (existing.reason
                        !== PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
                    || existing.disposition
                        !== PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION);
            const shouldUpgradeRouteTerminal = authenticRouteTerminalCleanup
                && (existing.reason !== ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                    || existing.disposition
                        !== ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION);
            if (shouldRetargetCoreImpact
                || shouldRetargetProjectileCaptureTerminal
                || shouldRetargetRouteTerminal
                || dispositionUpgraded
                || provenanceUpgraded
                || shouldUpgradeProjectileCaptureTerminal
                || shouldUpgradeRouteTerminal) {
                const upgradedCommand = Object.freeze({
                    ...existing,
                    ...(shouldRetargetCoreImpact
                        || shouldRetargetProjectileCaptureTerminal
                        || shouldRetargetRouteTerminal
                        ? { targetFixedTick: tick }
                        : null),
                    ...(dispositionUpgraded
                        ? {
                            disposition:
                                ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                        }
                        : null),
                    ...(shouldUpgradeProjectileCaptureTerminal
                        ? {
                            reason:
                                PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION,
                            disposition:
                                PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
                        }
                        : null),
                    ...(shouldUpgradeRouteTerminal
                        ? {
                            reason: ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION,
                            disposition: ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
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
                targetFixedTickRetargeted: shouldRetargetCoreImpact
                    || shouldRetargetProjectileCaptureTerminal
                    || shouldRetargetRouteTerminal,
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
        const requestEnvelope = snapshotAtomicTransformRequestEnvelope(request);
        request = requestEnvelope.request;
        if (requestEnvelope.enemyTransform) {
            return this.#requestEnemyAtomicTransformBatch(
                request,
                targetFixedTick,
                commandId
            );
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

    #requestEnemyAtomicTransformBatch(request, targetFixedTick, commandId) {
        if (this.#enemyAtomicTransformTransactionPort === null) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-runtime-unconfigured'
            });
        }
        const requestSnapshot = request;
        const tick = requirePositiveSafeInteger(
            targetFixedTick,
            'targetFixedTick'
        );
        const transformFixedTick = requirePositiveSafeInteger(
            requestSnapshot.transformFixedTick,
            'transformFixedTick'
        );
        const prepareSourceTick = requirePositiveSafeInteger(
            requestSnapshot.prepareSourceTick,
            'prepareSourceTick'
        );
        const batchIdFingerprint = requirePositiveSafeInteger(
            requestSnapshot.batchIdFingerprint,
            'batchIdFingerprint'
        );
        if (tick !== transformFixedTick
            || transformFixedTick !== prepareSourceTick + 1) {
            return Object.freeze({
                accepted: false,
                reason: 'atomic-transform-publication-deadline'
            });
        }
        const rawRecords = snapshotBoundedDenseDataArray(
            requestSnapshot.records,
            JORANG_MAXIMUM_TRANSFORM_STARTS_PER_FIXED_TICK,
            'enemyAtomicTransformRequest.records'
        );
        const batchSourceKeys = new Set();
        const records = rawRecords.map((record, index) => {
            const snapshot = snapshotExactOwnDataFields(
                record,
                ENEMY_ATOMIC_TRANSFORM_RECORD_FIELDS,
                `enemyAtomicTransformRequest.records[${index}]`
            );
            const descriptor = normalizeEnemyAtomicTransformDescriptor({
                topologyId: snapshot.topologyId,
                sourceHandles: snapshot.sourceHandles,
                destinations: snapshot.destinationIntents,
                effectTransferDestinationIndex:
                    snapshot.effectTransferDestinationIndex
            }, `enemyAtomicTransformRequest.records[${index}]`);
            if (descriptor.topologyId
                    !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
                && descriptor.topologyId
                    !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED) {
                throw new RangeError(
                    `records[${index}].topologyId는 J lineage topology여야 합니다.`
                );
            }
            for (let destinationIndex = 0;
                destinationIndex < descriptor.destinations.length;
                destinationIndex++) {
                const destination = descriptor.destinations[destinationIndex];
                for (const identityField of [
                    'entityId',
                    'incarnation',
                    'handle',
                    'destinationEntityId',
                    'destinationIncarnation'
                ]) {
                    if (Object.prototype.hasOwnProperty.call(
                        destination,
                        identityField
                    )) {
                        throw new TypeError(
                            `records[${index}].destinationIntents[${destinationIndex}]는 identity-neutral이어야 합니다.`
                        );
                    }
                }
            }
            for (const handle of descriptor.sourceHandles) {
                const key = handleKey(handle);
                if (batchSourceKeys.has(key)
                    || this.pendingAtomicTransformSourceKeys.has(key)) {
                    throw new RangeError(
                        'J lineage atomic transform source가 중복되었습니다.'
                    );
                }
                batchSourceKeys.add(key);
            }
            const disposition = requireNonEmptyString(
                snapshot.disposition,
                `records[${index}].disposition`
            );
            if (disposition !== 'atomic-transform') {
                throw new RangeError(
                    `records[${index}].disposition은 atomic-transform이어야 합니다.`
                );
            }
            if (!snapshot.prepareEvidence
                || typeof snapshot.prepareEvidence !== 'object') {
                throw new TypeError(
                    `records[${index}].prepareEvidence authentic receipt가 필요합니다.`
                );
            }
            return {
                topologyId: descriptor.topologyId,
                sourceHandles: descriptor.sourceHandles,
                destinationIntents: descriptor.destinations,
                effectTransferDestinationIndex:
                    descriptor.effectTransferDestinationIndex,
                disposition,
                prepareEvidence: snapshot.prepareEvidence,
                childCommandIds: null
            };
        });
        const sequence = this.nextCommandSequence;
        if (!Number.isSafeInteger(sequence) || sequence <= 0) {
            throw new RangeError(
                'J lineage atomic transform command sequence 공간이 고갈되었습니다.'
            );
        }
        const normalizedCommandId = this.#normalizeCommandId(
            commandId,
            sequence
        );
        const ownedCommandIds = [normalizedCommandId];
        for (let index = 0; index < records.length; index++) {
            const childCommandIds = Object.freeze({
                destinations: Object.freeze(
                    records[index].destinationIntents.map((_, destinationIndex) => (
                        `${normalizedCommandId}:transform:${index}:destination:${destinationIndex}`
                    ))
                ),
                sources: Object.freeze(
                    records[index].sourceHandles.map((_, sourceIndex) => (
                        `${normalizedCommandId}:transform:${index}:source:${sourceIndex}`
                    ))
                )
            });
            records[index].childCommandIds = childCommandIds;
            ownedCommandIds.push(
                ...childCommandIds.destinations,
                ...childCommandIds.sources
            );
        }
        const batchCommandIds = new Set(ownedCommandIds);
        if (batchCommandIds.size !== ownedCommandIds.length
            || ownedCommandIds.some((id) => this.knownCommandIds.has(id))) {
            return Object.freeze({
                accepted: false,
                reason: 'duplicate-command'
            });
        }
        for (const id of ownedCommandIds) {
            this.knownCommandIds.add(id);
        }
        this.nextCommandSequence++;
        const command = Object.freeze({
            type: 'enemy-atomic-transform-batch',
            commandId: normalizedCommandId,
            ownedCommandIds: Object.freeze(ownedCommandIds),
            targetFixedTick: tick,
            transformFixedTick,
            sequence,
            prepareSourceTick,
            batchIdFingerprint,
            records: Object.freeze(records.map(Object.freeze)),
            transactionPort: this.#enemyAtomicTransformTransactionPort
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

    /** Capture command owner만 사용할 수 있는 same-projectile hostile release ingress입니다. */
    requestProjectileCaptureReleaseBatch(
        request,
        targetFixedTick,
        commandId,
        projectileCaptureReleasePermit
    ) {
        this.#assertUsable();
        if (!this.ingressOpen) {
            return this.#rejectClosedIngress();
        }
        if (this.#projectileCaptureReleaseAuthority?.consumePermit(
            projectileCaptureReleasePermit
        ) !== true) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-permit-invalid',
                requiresRecovery: false
            });
        }
        if (this.#projectileCaptureReleaseTransactionPort === null) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-runtime-unconfigured',
                requiresRecovery: false
            });
        }
        const requestSnapshot = snapshotExactOwnDataFields(
            request,
            PROJECTILE_CAPTURE_RELEASE_REQUEST_FIELDS,
            'projectileCaptureReleaseRequest'
        );
        const tick = requirePositiveSafeInteger(
            targetFixedTick,
            'targetFixedTick'
        );
        const prepareSourceTick = requirePositiveSafeInteger(
            requestSnapshot.prepareSourceTick,
            'projectileCaptureReleaseRequest.prepareSourceTick'
        );
        const batchIdFingerprint = requirePositiveUint32(
            requestSnapshot.batchIdFingerprint,
            'projectileCaptureReleaseRequest.batchIdFingerprint'
        );
        if (tick !== prepareSourceTick + 1) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-publication-deadline',
                requiresRecovery: false
            });
        }
        const rawRecords = snapshotBoundedDenseDataArray(
            requestSnapshot.records,
            this.commandHistoryCapacity,
            'projectileCaptureReleaseRequest.records'
        );
        if (rawRecords.length === 0) {
            return Object.freeze({
                accepted: false,
                reason: 'projectile-capture-release-empty-batch',
                requiresRecovery: false
            });
        }
        const batchProjectileKeys = new Set();
        const records = rawRecords.map((record, index) => {
            const snapshot = snapshotExactOwnDataFields(
                record,
                PROJECTILE_CAPTURE_RELEASE_RECORD_FIELDS,
                `projectileCaptureReleaseRequest.records[${index}]`
            );
            const projectileHandle = normalizeHandle(
                snapshot.projectileHandle,
                `records[${index}].projectileHandle`
            );
            const captorHandle = normalizeHandle(
                snapshot.captorHandle,
                `records[${index}].captorHandle`
            );
            if (projectileHandle.entityId === captorHandle.entityId) {
                throw new RangeError('release projectile/captor identity는 달라야 합니다.');
            }
            const key = handleKey(projectileHandle);
            if (batchProjectileKeys.has(key)
                || this.pendingProjectileCaptureReleaseKeys.has(key)) {
                throw new RangeError(
                    'projectile capture release exact handle이 중복되었습니다.'
                );
            }
            batchProjectileKeys.add(key);
            const towerTargetHandle = snapshot.towerTargetHandle === null
                ? null
                : normalizeHandle(
                    snapshot.towerTargetHandle,
                    `records[${index}].towerTargetHandle`
                );
            if (towerTargetHandle?.entityId === projectileHandle.entityId
                || towerTargetHandle?.entityId === captorHandle.entityId) {
                throw new RangeError('release Tower target identity가 잘못되었습니다.');
            }
            if (!snapshot.prepareEvidence
                || typeof snapshot.prepareEvidence !== 'object'
                || !Object.isFrozen(snapshot.prepareEvidence)) {
                throw new TypeError(
                    `records[${index}].prepareEvidence authentic receipt가 필요합니다.`
                );
            }
            const releaseReason = requireProjectileCaptureReleaseReason(
                snapshot.releaseReason,
                `records[${index}].releaseReason`
            );
            const baseReason = requireProjectileCaptureReleaseReason(
                snapshot.prepareEvidence.baseReason,
                `records[${index}].prepareEvidence.baseReason`
            );
            const targetSelector = snapshot.prepareEvidence.targetSelector;
            if (targetSelector
                    !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
                && targetSelector
                    !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER) {
                throw new RangeError(
                    `records[${index}].prepareEvidence.targetSelector가 잘못됐습니다.`
                );
            }
            const preparedTowerHandle = targetSelector
                === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER
                ? normalizeHandle(
                    snapshot.prepareEvidence.targetHandle,
                    `records[${index}].prepareEvidence.targetHandle`
                )
                : null;
            if ((targetSelector
                    === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.INVALID_FORWARD
                    && snapshot.prepareEvidence.targetHandle !== null)
                || ((targetSelector
                        === GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR.TOWER)
                    !== (towerTargetHandle !== null))
                || (towerTargetHandle !== null
                    && (preparedTowerHandle === null
                        || !sameHandle(towerTargetHandle, preparedTowerHandle)))
                || (releaseReason
                    !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON.NORMAL_DUE
                    && (towerTargetHandle !== null
                        || targetSelector
                            !== GPU_PROJECTILE_CAPTURE_TARGET_SELECTOR
                                .INVALID_FORWARD))
                || (releaseReason
                    !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                        .CAPTOR_CORE_IMPACT
                    && baseReason !== releaseReason)) {
                throw new RangeError(
                    `records[${index}]의 release target/base proof가 잘못됐습니다.`
                );
            }
            const coreImpactReceipt = releaseReason
                === GPU_PROJECTILE_CAPTURE_RELEASE_REASON.CAPTOR_CORE_IMPACT
                ? assertProjectileCaptureCoreImpactReceipt(
                    snapshot.coreImpactReceipt,
                    captorHandle,
                    prepareSourceTick,
                    `records[${index}].coreImpactReceipt`
                )
                : null;
            if ((releaseReason
                    !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                        .CAPTOR_CORE_IMPACT
                    && snapshot.coreImpactReceipt !== null)
                || (releaseReason
                    === GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                        .CAPTOR_CORE_IMPACT
                    && (snapshot.towerTargetHandle !== null
                        || baseReason
                            !== GPU_PROJECTILE_CAPTURE_RELEASE_REASON
                                .CAPTOR_CORE_IMPACT))) {
                throw new RangeError(
                    `records[${index}]의 core-impact 결합 proof가 잘못됐습니다.`
                );
            }
            const expectedMetadataRevision = requirePositiveSafeInteger(
                snapshot.expectedMetadataRevision,
                `records[${index}].expectedMetadataRevision`
            );
            // Queue 전에 frozen provenance 전체를 한 번 검증하되 identity reference는
            // 그대로 보존하여 boundary preflight의 compare-and-swap 기준으로 씁니다.
            materializeProjectileCaptureReleaseMetadata(
                snapshot.expectedMetadata,
                captorHandle,
                null
            );
            return Object.freeze({
                projectileHandle,
                captorHandle,
                captureSequence: requirePositiveUint32(
                    snapshot.captureSequence,
                    `records[${index}].captureSequence`
                ),
                releaseReason,
                expectedMetadata: snapshot.expectedMetadata,
                expectedMetadataRevision,
                towerTargetHandle,
                prepareEvidence: snapshot.prepareEvidence,
                coreImpactReceipt
            });
        });
        const normalizedCommandId = this.#claimCommandId(commandId);
        if (!normalizedCommandId) {
            return Object.freeze({ accepted: false, reason: 'duplicate-command' });
        }
        const commandIdFingerprint = fingerprintProjectileCaptureCommandId(
            normalizedCommandId
        );
        const sequence = this.nextCommandSequence++;
        this.pendingCommands.push(Object.freeze({
            type: 'projectile-capture-release-batch',
            commandId: normalizedCommandId,
            commandIdFingerprint,
            targetFixedTick: tick,
            sequence,
            prepareSourceTick,
            batchIdFingerprint,
            records: Object.freeze(records),
            transactionPort: this.#projectileCaptureReleaseTransactionPort
        }));
        for (const key of batchProjectileKeys) {
            this.pendingProjectileCaptureReleaseKeys.add(key);
        }
        return Object.freeze({
            accepted: true,
            commandId: normalizedCommandId,
            commandIdFingerprint,
            targetFixedTick: tick,
            releaseCount: records.length
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
     * due command snapshot을 despawn(+route cleanup) → H → J → projectile release
     * → spawn(+route roster) 순서로
     * fixed boundary에서만 commit합니다.
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
            atomicTransforms: [],
            projectileCaptureReleases: [],
            routeLifecycle: [],
            routeRuntimeBinding: null,
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
                if (command.type === 'atomic-transform-batch'
                    || command.type === 'enemy-atomic-transform-batch'
                    || command.type === 'projectile-capture-release-batch') {
                    baseResult.rejected.push({
                        commandId: command.commandId,
                        code: command.type === 'projectile-capture-release-batch'
                            ? 'projectile-capture-release-publication-deadline'
                            : 'atomic-transform-publication-deadline'
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
        const enemyAtomicTransformCommands = dueCommands.filter(
            (command) => command.type === 'enemy-atomic-transform-batch'
        );
        const projectileCaptureReleaseCommands = dueCommands.filter(
            (command) => command.type === 'projectile-capture-release-batch'
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

        const enemyTransformOutcome = this.#commitEnemyAtomicTransforms(
            enemyAtomicTransformCommands,
            baseResult,
            consumedCommandIds
        );
        if (enemyTransformOutcome === 'recovery') {
            this.#consumeCommands(consumedCommandIds);
            return this.#saveResult(baseResult);
        }

        const projectileReleaseOutcome
            = this.#commitProjectileCaptureReleases(
                projectileCaptureReleaseCommands,
                baseResult,
                consumedCommandIds
            );
        if (projectileReleaseOutcome === 'recovery') {
            this.#consumeCommands(consumedCommandIds);
            return this.#saveResult(baseResult);
        }

        const retiredTransformEntityIds = new Set();
        for (const transform of baseResult.atomicTransforms) {
            const destinationEntityIds = new Set(
                transform.destinationHandles.map((handle) => handle.entityId)
            );
            for (const sourceHandle of transform.sourceHandles) {
                if (!destinationEntityIds.has(sourceHandle.entityId)) {
                    retiredTransformEntityIds.add(sourceHandle.entityId);
                }
            }
        }
        this.#commitSpawns(
            spawnCommands,
            baseResult,
            consumedCommandIds,
            retiredTransformEntityIds
        );
        this.#consumeCommands(consumedCommandIds);
        if (baseResult.recoveryRequired) {
            if (baseResult.state !== 'stalled') {
                baseResult.state = 'failed';
            }
        } else if (baseResult.state !== 'stalled'
            && baseResult.rejected.length > 0) {
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
            pendingProjectileCaptureReleaseCount:
                this.pendingProjectileCaptureReleaseKeys.size,
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
        this.pendingProjectileCaptureReleaseKeys.clear();
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
        this.#enemyAtomicTransformTransactionPort = null;
        this.#projectileCaptureReleaseAuthority = null;
        this.#activeMetadataMutationRegistryAuthority = null;
        this.#projectileCaptureReleaseTransactionPort = null;
        this.#routeLifecyclePort = null;
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

        const routePlans = [];
        try {
            for (const command of validCommands) {
                const view = this.registry.copyEntityView?.(command.handle, {});
                const profile = resolveRouteClosureProfile(
                    view?.metadata,
                    `despawn ${command.commandId}`
                );
                if (view?.definitionId === BASIC_CORK_ENEMY_DEFINITION_ID
                    && view?.metadata?.routeSetId !== null
                    && profile === null) {
                    throw new RangeError(
                        'active Cork registry metadata에 route profile이 없습니다.'
                    );
                }
                if (profile === null
                    || view?.metadata?.routeSetId === null) {
                    continue;
                }
                routePlans.push(Object.freeze({
                    commandId: command.commandId,
                    commandIdFingerprint:
                        fingerprintProjectileCaptureCommandId(command.commandId),
                    handle: command.handle,
                    reason: command.reason,
                    disposition: command.disposition
                }));
            }
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: validCommands[0].commandId,
                code: 'route-despawn-preflight-materialization',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        let routeTransaction = null;
        if (routePlans.length > 0) {
            if (!this.#routeLifecyclePort) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: routePlans[0].commandId,
                    code: 'route-lifecycle-port-required'
                });
                return 'recovery';
            }
            const targetFixedTick = validCommands[0].targetFixedTick;
            const batchIdFingerprint = fingerprintRouteLifecycleBatch(
                targetFixedTick,
                routePlans
            );
            try {
                const preflight = this.#routeLifecyclePort
                    .preflightRouteLifecycleBatch(Object.freeze({
                        abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                        targetFixedTick,
                        batchIdFingerprint,
                        spawnPlans: Object.freeze([]),
                        despawnPlans: Object.freeze(routePlans)
                    }));
                if (preflight?.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                    || preflight?.accepted !== true
                    || preflight.requiresRecovery === true
                    || preflight.targetFixedTick !== targetFixedTick
                    || preflight.batchIdFingerprint !== batchIdFingerprint
                    || preflight.spawnReservationCount !== 0
                    || preflight.cleanupReservationCount !== routePlans.length
                    || !preflight.receipt
                    || typeof preflight.receipt !== 'object') {
                    throw new RangeError(
                        preflight?.reason ?? 'route-despawn-preflight-rejected'
                    );
                }
                routeTransaction = Object.freeze({
                    receipt: preflight.receipt,
                    targetFixedTick,
                    batchIdFingerprint,
                    plans: Object.freeze(routePlans)
                });
            } catch (error) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: routePlans[0].commandId,
                    code: 'route-despawn-preflight',
                    message: String(error?.message ?? error)
                });
                return 'recovery';
            }
        }

        let backendResult;
        try {
            backendResult = this.backend.despawnBodies(
                validCommands.map((command) => command.handle)
            );
        } catch (error) {
            if (routeTransaction) {
                try {
                    this.#routeLifecyclePort.cancelRouteLifecycleBatch(
                        routeTransaction.receipt,
                        'despawn-exception'
                    );
                } catch {
                    result.recoveryRequired = true;
                }
            }
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
                    despawned.bountyEligible = command.disposition
                        === PROJECTILE_CAPTURE_TERMINAL_CLEANUP_DISPOSITION
                        || command.disposition
                            === ENEMY_ROUTE_TERMINAL_CLEANUP_DISPOSITION
                        ? false
                        : isEnemyDispositionBountyEligible(
                            command.disposition
                        );
                }
                result.despawned.push(despawned);
                consumedCommandIds.add(command.commandId);
            }
        }
        if (routeTransaction) {
            const removedByCommandId = new Map(
                result.despawned.map((entry) => [entry.commandId, entry])
            );
            const routeDespawns = routeTransaction.plans
                .filter((plan) => removedByCommandId.has(plan.commandId))
                .map((plan) => Object.freeze({
                    commandId: plan.commandId,
                    commandIdFingerprint: plan.commandIdFingerprint,
                    handle: plan.handle
                }));
            if (routeDespawns.length === 0) {
                try {
                    const cancelled = this.#routeLifecyclePort
                        .cancelRouteLifecycleBatch(
                            routeTransaction.receipt,
                            'despawn-not-published'
                        );
                    if (cancelled?.abiVersion
                            !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                        || cancelled?.accepted !== true
                        || cancelled.cancelledSpawnReservationCount !== 0
                        || cancelled.cancelledCleanupReservationCount
                            !== routeTransaction.plans.length) {
                        result.recoveryRequired = true;
                    }
                } catch {
                    result.recoveryRequired = true;
                }
            } else {
                try {
                    const committed = this.#routeLifecyclePort
                        .commitRouteLifecycleBatch(
                            routeTransaction.receipt,
                            Object.freeze({
                                abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                                targetFixedTick: routeTransaction.targetFixedTick,
                                batchIdFingerprint:
                                    routeTransaction.batchIdFingerprint,
                                spawned: Object.freeze([]),
                                despawned: Object.freeze(routeDespawns)
                            })
                        );
                    if (committed?.abiVersion
                            !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                        || committed?.accepted !== true
                        || committed.requiresRecovery === true
                        || committed.targetFixedTick
                            !== routeTransaction.targetFixedTick
                        || committed.batchIdFingerprint
                            !== routeTransaction.batchIdFingerprint
                        || committed.spawnedCount !== 0
                        || committed.cleanedCount !== routeDespawns.length) {
                        throw new RangeError(
                            committed?.reason ?? 'route-despawn-commit-mismatch'
                        );
                    }
                    result.routeRuntimeBinding = snapshotRouteRuntimeBinding(
                        committed.runtimeBinding,
                        'route despawn commit'
                    );
                    for (const despawned of routeDespawns) {
                        result.routeLifecycle.push({
                            action: 'cleanup',
                            commandId: despawned.commandId,
                            commandIdFingerprint: despawned.commandIdFingerprint,
                            handle: despawned.handle,
                            targetFixedTick: routeTransaction.targetFixedTick,
                            batchIdFingerprint:
                                routeTransaction.batchIdFingerprint
                        });
                    }
                } catch (error) {
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: routeTransaction.plans[0].commandId,
                        code: 'route-despawn-commit',
                        message: String(error?.message ?? error)
                    });
                }
            }
        }
        if (result.recoveryRequired
            || !fullyRemoved
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
        let sourceConsumed = false;
        for (const record of command.records) {
            for (const handle of record.sourceHandles) {
                const registryHas = this.registry.has(handle);
                const backendHas = this.backend.hasBody(handle);
                if (!registryHas && !backendHas) {
                    sourceConsumed = true;
                    continue;
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
        if (sourceConsumed) {
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-source-consumed'
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
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
        if (preflight.accepted === false) {
            result.rejected.push({
                commandId: command.commandId,
                code: preflight.reason ?? 'atomic-transform-preflight-rejected',
                retryable: preflight.retryable === true
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
            result.atomicTransforms.push({
                commandId: command.commandId,
                topologyId:
                    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.MANY_TO_ONE,
                sourceHandles: record.sourceHandles,
                destinationHandles: Object.freeze([destinationHandle]),
                effectTransferDestinationIndex: 0,
                disposition: 'atomic-transform'
            });
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

    #commitEnemyAtomicTransforms(commands, result, consumedCommandIds) {
        if (commands.length === 0) {
            return 'complete';
        }
        if (commands.length !== 1) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: commands[0].commandId,
                code: 'multiple-enemy-atomic-transform-batches'
            });
            return 'recovery';
        }
        const command = commands[0];
        if (command.targetFixedTick !== command.transformFixedTick
            || command.transformFixedTick !== command.prepareSourceTick + 1) {
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-publication-deadline'
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        let sourceConsumed = false;
        for (const record of command.records) {
            for (const handle of record.sourceHandles) {
                const registryHas = this.registry.has(handle);
                const backendHas = this.backend.hasBody(handle);
                if (!registryHas && !backendHas) {
                    sourceConsumed = true;
                    continue;
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
        if (sourceConsumed) {
            result.rejected.push({
                commandId: command.commandId,
                code: 'atomic-transform-source-consumed',
                retryable: false
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        let transforms;
        try {
            transforms = command.records.map((record) => ({
                topologyId: record.topologyId,
                sourceHandles: record.sourceHandles,
                destinations: record.destinationIntents.map((intent) => ({
                    kindId: intent.kindId,
                    definitionId: intent.definitionId,
                    createdAtTick: command.transformFixedTick,
                    metadata: createRegistryMetadata(intent)
                })),
                effectTransferDestinationIndex:
                    record.effectTransferDestinationIndex
            }));
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
                code: 'atomic-transform-preflight-stale',
                retryable: false
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        if (preflight.accepted === false) {
            const retryable = preflight.retryable === true;
            result.rejected.push({
                commandId: command.commandId,
                code: preflight.reason ?? 'atomic-transform-preflight-rejected',
                retryable,
                ...(retryable ? {
                    retryDisposition: 'restage-next-prepare',
                    sourcePendingPreserved: true,
                    attemptConsumed: true
                } : null)
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        const armRecords = command.records.map((record, index) => (
            Object.freeze({
                topologyId: record.topologyId,
                sourceHandles: record.sourceHandles,
                destinationHandles:
                    preflight.transforms[index].destinationHandles,
                destinationIntents: record.destinationIntents,
                effectTransferDestinationIndex:
                    record.effectTransferDestinationIndex,
                disposition: record.disposition,
                prepareEvidence: record.prepareEvidence
            })
        ));
        let armed;
        try {
            armed = command.transactionPort.armPreparedAtomicTransformBatch(
                Object.freeze({
                    commandId: command.commandId,
                    batchIdFingerprint: command.batchIdFingerprint,
                    prepareSourceTick: command.prepareSourceTick,
                    targetFixedTick: command.targetFixedTick,
                    transformFixedTick: command.transformFixedTick,
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
            result.recoveryRequired = armed?.requiresRecovery === true;
            result.state = result.recoveryRequired ? 'failed' : result.state;
            const retryable = armed?.retryable === true;
            result.rejected.push({
                commandId: command.commandId,
                code: armed?.reason ?? 'atomic-transform-arm-rejected',
                retryable,
                ...(retryable ? {
                    retryDisposition: 'restage-next-prepare',
                    sourcePendingPreserved: true,
                    attemptConsumed: true
                } : null)
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
                command.transactionPort.cancelArmedAtomicTransformBatch(
                    armed.receipt,
                    'registry-commit-failed'
                );
            } catch {
                // CPU/backend parity가 이미 hard recovery를 요구합니다.
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
            committed = command.transactionPort.commitArmedAtomicTransformBatch(
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
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: committed?.reason
                    ?? 'atomic-transform-backend-commit-failed'
            });
            return 'recovery';
        }
        for (let index = 0; index < command.records.length; index++) {
            const record = command.records[index];
            const committedTransform = registryCommit.transforms[index];
            const destinationHandles = committedTransform.destinationHandles;
            result.atomicTransforms.push({
                commandId: command.commandId,
                topologyId: record.topologyId,
                sourceHandles: record.sourceHandles,
                destinationHandles,
                effectTransferDestinationIndex:
                    record.effectTransferDestinationIndex,
                disposition: record.disposition
            });
            for (let destinationIndex = 0;
                destinationIndex < destinationHandles.length;
                destinationIndex++) {
                result.spawned.push({
                    commandId:
                        record.childCommandIds.destinations[destinationIndex],
                    parentCommandId: command.commandId,
                    handle: destinationHandles[destinationIndex],
                    transform: true,
                    topologyId: record.topologyId,
                    transformIndex: index,
                    destinationIndex
                });
            }
            for (let sourceIndex = 0;
                sourceIndex < record.sourceHandles.length;
                sourceIndex++) {
                result.despawned.push({
                    commandId: record.childCommandIds.sources[sourceIndex],
                    parentCommandId: command.commandId,
                    handle: record.sourceHandles[sourceIndex],
                    reason: 'atomic-transform',
                    bountyEligible: false,
                    transformedInto: destinationHandles[0],
                    transformedIntoHandles: destinationHandles
                });
            }
        }
        consumedCommandIds.add(command.commandId);
        return 'complete';
    }

    #commitProjectileCaptureReleases(commands, result, consumedCommandIds) {
        for (const command of commands) {
            const outcome = this.#commitProjectileCaptureReleaseCommand(
                command,
                result,
                consumedCommandIds
            );
            if (outcome === 'recovery') {
                return outcome;
            }
        }
        return 'complete';
    }

    #commitProjectileCaptureReleaseCommand(command, result, consumedCommandIds) {
        const materializedRecords = [];
        let ordinaryRejection = null;
        for (let index = 0; index < command.records.length; index++) {
            const record = command.records[index];
            const projectileView = this.registry.copyEntityView(
                record.projectileHandle,
                {}
            );
            const registryLive = projectileView !== null;
            const backendLive = this.backend.hasBody(record.projectileHandle);
            if (registryLive !== backendLive) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'projectile-capture-release-registry-backend-desync',
                    recordIndex: index
                });
                return 'recovery';
            }
            if (registryLive && projectileView.kindId !== 'projectile') {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'projectile-capture-release-kind-corruption',
                    recordIndex: index
                });
                return 'recovery';
            }

            let targetHandle = null;
            let targetRejected = false;
            if (record.towerTargetHandle !== null) {
                const targetView = this.registry.copyEntityView(
                    record.towerTargetHandle,
                    {}
                );
                const registryTargetLive = targetView !== null;
                const backendTargetLive = this.backend.hasBody(
                    record.towerTargetHandle
                );
                if (registryTargetLive !== backendTargetLive) {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: command.commandId,
                        code: 'projectile-capture-release-target-registry-backend-desync',
                        recordIndex: index
                    });
                    return 'recovery';
                }
                const targetLive = registryTargetLive && backendTargetLive;
                if (!targetLive) {
                    ordinaryRejection ??= {
                        commandId: command.commandId,
                        code: 'projectile-capture-release-target-stale',
                        retryable: true,
                        recordIndex: index
                    };
                    targetRejected = true;
                }
                if (targetLive && targetView.kindId !== 'tower') {
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: command.commandId,
                        code: 'projectile-capture-release-target-unsupported',
                        recordIndex: index
                    });
                    return 'recovery';
                }
                if (!targetRejected) {
                    targetHandle = record.towerTargetHandle;
                }
            }

            const projectileStale = !registryLive
                || projectileView.metadata !== record.expectedMetadata
                || projectileView.metadataRevision
                    !== record.expectedMetadataRevision;
            if (projectileStale) {
                ordinaryRejection ??= {
                    commandId: command.commandId,
                    code: 'projectile-capture-release-stale',
                    retryable: false,
                    recordIndex: index
                };
                continue;
            }

            let nextMetadata;
            try {
                nextMetadata = materializeProjectileCaptureReleaseMetadata(
                    record.expectedMetadata,
                    record.captorHandle,
                    targetHandle
                );
            } catch (error) {
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: command.commandId,
                    code: 'projectile-capture-release-metadata-corruption',
                    recordIndex: index,
                    message: String(error?.message ?? error)
                });
                return 'recovery';
            }
            if (targetRejected) {
                continue;
            }
            materializedRecords.push(Object.freeze({
                ...record,
                targetHandle,
                nextMetadata
            }));
        }
        if (ordinaryRejection !== null) {
            result.rejected.push(ordinaryRejection);
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }
        if (materializedRecords.length !== command.records.length) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-preflight-cardinality'
            });
            return 'recovery';
        }

        let preflight;
        try {
            preflight = this.registry.preflightActiveMetadataMutationBatch({
                mutations: materializedRecords.map((record) => ({
                    handle: record.projectileHandle,
                    expectedMetadata: record.expectedMetadata,
                    expectedMetadataRevision: record.expectedMetadataRevision,
                    nextMetadata: record.nextMetadata
                }))
            }, this.#activeMetadataMutationRegistryAuthority);
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-registry-preflight-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (preflight?.accepted !== true) {
            result.rejected.push({
                commandId: command.commandId,
                code: preflight?.reason
                    ?? 'projectile-capture-release-registry-preflight-stale',
                retryable: preflight?.retryable === true
            });
            consumedCommandIds.add(command.commandId);
            return 'complete';
        }

        let armed;
        try {
            armed = command.transactionPort
                .armPreparedProjectileCaptureReleaseBatch(Object.freeze({
                    commandId: command.commandId,
                    commandIdFingerprint: command.commandIdFingerprint,
                    prepareSourceTick: command.prepareSourceTick,
                    targetFixedTick: command.targetFixedTick,
                    batchIdFingerprint: command.batchIdFingerprint,
                    registryRevision: preflight.registryRevision,
                    records: Object.freeze(materializedRecords.map(
                        (record, index) => Object.freeze({
                            projectileHandle: record.projectileHandle,
                            captorHandle: record.captorHandle,
                            captureSequence: record.captureSequence,
                            releaseReason: record.releaseReason,
                            targetHandle: record.targetHandle,
                            expectedMetadataRevision:
                                record.expectedMetadataRevision,
                            nextMetadataRevision:
                                preflight.mutations[index].nextMetadataRevision,
                            nextMetadata: record.nextMetadata,
                            prepareEvidence: record.prepareEvidence,
                            coreImpactReceipt: record.coreImpactReceipt
                        })
                    ))
                }));
        } catch (error) {
            this.registry.cancelActiveMetadataMutationBatch(
                preflight.token,
                this.#activeMetadataMutationRegistryAuthority
            );
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-arm-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (armed?.accepted !== true) {
            this.registry.cancelActiveMetadataMutationBatch(
                preflight.token,
                this.#activeMetadataMutationRegistryAuthority
            );
            const retryable = armed?.retryable === true;
            result.recoveryRequired = armed?.requiresRecovery === true;
            result.state = result.recoveryRequired ? 'failed' : result.state;
            result.rejected.push({
                commandId: command.commandId,
                code: armed?.reason ?? 'projectile-capture-release-arm-rejected',
                retryable,
                ...(retryable ? {
                    retryDisposition: 'restage-next-prepare',
                    heldStatePreserved: true,
                    attemptConsumed: true
                } : null)
            });
            consumedCommandIds.add(command.commandId);
            return result.recoveryRequired ? 'recovery' : 'complete';
        }
        if (!armed.receipt
            || armed.abiVersion !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
            || armed.requiresRecovery !== false
            || armed.armedCount !== materializedRecords.length
            || armed.commandIdFingerprint !== command.commandIdFingerprint
            || armed.receipt.targetFixedTick !== command.targetFixedTick
            || armed.receipt.batchIdFingerprint !== command.batchIdFingerprint
            || armed.receipt.commandIdFingerprint
                !== command.commandIdFingerprint) {
            this.registry.cancelActiveMetadataMutationBatch(
                preflight.token,
                this.#activeMetadataMutationRegistryAuthority
            );
            try {
                command.transactionPort.cancelArmedProjectileCaptureReleaseBatch(
                    armed.receipt,
                    'command-fingerprint-mismatch'
                );
            } catch {
                // 아래 sticky recovery가 registry/backend parity를 봉인합니다.
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-command-fingerprint-mismatch'
            });
            return 'recovery';
        }

        const registryCommit = this.registry.commitActiveMetadataMutationBatch(
            preflight.token,
            this.#activeMetadataMutationRegistryAuthority
        );
        if (!registryCommit) {
            try {
                command.transactionPort.cancelArmedProjectileCaptureReleaseBatch(
                    armed.receipt,
                    'registry-commit-failed'
                );
            } catch {
                // Registry/backend parity failure is already sticky recovery below.
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-registry-commit-failed'
            });
            return 'recovery';
        }

        let committed;
        try {
            committed = command.transactionPort
                .commitArmedProjectileCaptureReleaseBatch(armed.receipt);
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: 'projectile-capture-release-backend-commit-exception',
                message: String(error?.message ?? error)
            });
            return 'recovery';
        }
        if (committed?.accepted !== true
            || committed.abiVersion
                !== GPU_PROJECTILE_CAPTURE_RUNTIME_ABI_VERSION
            || committed.targetFixedTick !== command.targetFixedTick
            || committed.committedCount !== materializedRecords.length
            || committed.commandIdFingerprint
                !== command.commandIdFingerprint
            || committed.requiresRecovery !== false) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: command.commandId,
                code: committed?.accepted !== true
                    ? committed?.reason
                        ?? 'projectile-capture-release-backend-commit-failed'
                    : 'projectile-capture-release-backend-commit-proof-mismatch'
            });
            return 'recovery';
        }

        for (let index = 0; index < materializedRecords.length; index++) {
            const record = materializedRecords[index];
            const mutation = registryCommit.mutations[index];
            result.projectileCaptureReleases.push({
                commandId: command.commandId,
                commandIdFingerprint: command.commandIdFingerprint,
                projectileHandle: record.projectileHandle,
                captorHandle: record.captorHandle,
                captureSequence: record.captureSequence,
                releaseReason: record.releaseReason,
                prepareSourceTick: command.prepareSourceTick,
                batchIdFingerprint: command.batchIdFingerprint,
                prepareFingerprint: record.prepareEvidence.prepareFingerprint,
                targetFixedTick: command.targetFixedTick,
                targetHandle: record.targetHandle,
                registryRevision: registryCommit.registryRevision,
                metadataRevision: mutation.metadataRevision,
                backendCommitRequested: true
            });
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

    #commitSpawns(
        commands,
        result,
        consumedCommandIds,
        excludedEntityIds = null
    ) {
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
        let reservations = [];
        for (const command of commands) {
            const handle = this.registry.reserveEntity({
                kindId: command.intent.kindId,
                definitionId: command.intent.definitionId,
                createdAtTick: command.targetFixedTick
            }, {
                excludedEntityIds
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
                } else if (command.intent.kindId === 'enemy'
                    && command.intent.definitionId
                        === BASIC_JORANG_ENEMY_DEFINITION_ID) {
                    activationIntent
                        = materializeNaturalJorangAtomicTransformActivation(
                            command.intent,
                            handle
                        );
                } else if (command.intent.kindId === 'enemy'
                    && command.intent.definitionId
                        === BASIC_CORK_ENEMY_DEFINITION_ID) {
                    activationIntent
                        = materializeNaturalCorkRouteClosureActivation(
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
                    code: 'enemy-activation-materialization',
                    message: String(error?.message ?? error)
                });
                result.state = 'failed';
                result.recoveryRequired = true;
                return;
            }
            reservations.push({ command, handle, activationIntent });
        }

        let routeTransaction = null;
        const routeReservations = [];
        try {
            for (const reservation of reservations) {
                const profile = resolveRouteClosureProfile(
                    reservation.activationIntent,
                    `spawn ${reservation.command.commandId}`
                );
                if (profile === null
                    || reservation.activationIntent.routeSetId === null) {
                    continue;
                }
                routeReservations.push(Object.freeze({
                    reservation,
                    plan: Object.freeze({
                        commandId: reservation.command.commandId,
                        commandIdFingerprint: fingerprintProjectileCaptureCommandId(
                            reservation.command.commandId
                        ),
                        sequence: reservation.command.sequence,
                        definitionId: reservation.activationIntent.definitionId,
                        routeClosureProfileId: profile.id,
                        routeClosureProfileCode: profile.definitionCode,
                        routeSetId: reservation.activationIntent.routeSetId,
                        handle: reservation.handle
                    })
                }));
            }
        } catch (error) {
            for (const reservation of reservations) {
                this.registry.cancelReservation(reservation.handle);
            }
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: reservations[0].command.commandId,
                code: 'route-spawn-preflight-materialization',
                message: String(error?.message ?? error)
            });
            return;
        }
        if (routeReservations.length > 0) {
            if (!this.#routeLifecyclePort) {
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: routeReservations[0].plan.commandId,
                    code: 'route-lifecycle-port-required'
                });
                return;
            }
            const targetFixedTick = routeReservations[0]
                .reservation.command.targetFixedTick;
            const plans = routeReservations.map((entry) => entry.plan);
            const batchIdFingerprint = fingerprintRouteLifecycleBatch(
                targetFixedTick,
                plans
            );
            let preflight;
            try {
                preflight = this.#routeLifecyclePort
                    .preflightRouteLifecycleBatch(Object.freeze({
                        abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                        targetFixedTick,
                        batchIdFingerprint,
                        spawnPlans: Object.freeze(plans),
                        despawnPlans: Object.freeze([])
                    }));
            } catch (error) {
                preflight = Object.freeze({
                    accepted: false,
                    requiresRecovery: true,
                    reason: String(error?.message ?? error)
                });
            }
            if (preflight?.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                || preflight?.accepted !== true) {
                for (const reservation of reservations) {
                    this.registry.cancelReservation(reservation.handle);
                }
                result.state = 'failed';
                result.recoveryRequired = true;
                result.rejected.push({
                    commandId: routeReservations[0].plan.commandId,
                    code: 'route-spawn-preflight',
                    message: preflight?.reason ?? 'route-spawn-preflight-rejected'
                });
                return;
            } else {
                if (preflight.requiresRecovery === true
                    || preflight.targetFixedTick !== targetFixedTick
                    || preflight.batchIdFingerprint !== batchIdFingerprint
                    || preflight.spawnReservationCount
                        !== plans.length
                    || preflight.cleanupReservationCount !== 0
                    || !preflight.receipt
                    || typeof preflight.receipt !== 'object') {
                    for (const reservation of reservations) {
                        this.registry.cancelReservation(reservation.handle);
                    }
                    result.state = 'failed';
                    result.recoveryRequired = true;
                    result.rejected.push({
                        commandId: routeReservations[0].plan.commandId,
                        code: 'route-spawn-preflight-contract'
                    });
                    return;
                }
                routeTransaction = Object.freeze({
                    receipt: preflight.receipt,
                    targetFixedTick,
                    batchIdFingerprint,
                    plans: Object.freeze(plans)
                });
            }
        }
        if (reservations.length === 0) {
            return;
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
            this.#finalizeRouteSpawnTransaction(
                routeTransaction,
                reservations,
                result
            );
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
        const rejected = Number(backendResult?.rejected ?? reservations.length);
        const isFullSuccess = accepted === reservations.length && rejected === 0;
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
            && accepted + rejected === reservations.length;
        const cleanZeroAcceptance = countsAreValid
            && accepted === 0
            && rejected === reservations.length
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
            const retryableRejection = !responseContractFailed
                && !backendRecoveryRequired
                && isRetryableSpawnRejection(backendResult?.reason);
            result.state = retryableRejection ? 'stalled' : 'failed';
            result.recoveryRequired = !retryableRejection;
            this.#finalizeRouteSpawnTransaction(
                routeTransaction,
                reservations,
                result
            );
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
        this.#finalizeRouteSpawnTransaction(
            routeTransaction,
            reservations,
            result
        );
    }

    #finalizeRouteSpawnTransaction(transaction, reservations, result) {
        if (!transaction) {
            return;
        }
        const planByCommandId = new Map(
            transaction.plans.map((plan) => [plan.commandId, plan])
        );
        const spawned = [];
        for (const reservation of reservations) {
            const plan = planByCommandId.get(reservation.command.commandId);
            if (plan && this.backend.hasBody(reservation.handle)) {
                spawned.push(Object.freeze({
                    commandId: plan.commandId,
                    commandIdFingerprint: plan.commandIdFingerprint,
                    handle: plan.handle
                }));
            }
        }
        if (spawned.length === 0) {
            try {
                const cancelled = this.#routeLifecyclePort
                    .cancelRouteLifecycleBatch(
                        transaction.receipt,
                        'spawn-not-published'
                    );
                if (cancelled?.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                    || cancelled?.accepted !== true
                    || cancelled.cancelledSpawnReservationCount
                        !== transaction.plans.length
                    || cancelled.cancelledCleanupReservationCount !== 0) {
                    result.recoveryRequired = true;
                }
            } catch {
                result.recoveryRequired = true;
            }
            return;
        }
        try {
            const committed = this.#routeLifecyclePort
                .commitRouteLifecycleBatch(
                    transaction.receipt,
                    Object.freeze({
                        abiVersion: GPU_ROUTE_LIFECYCLE_ABI_VERSION,
                        targetFixedTick: transaction.targetFixedTick,
                        batchIdFingerprint: transaction.batchIdFingerprint,
                        spawned: Object.freeze(spawned),
                        despawned: Object.freeze([])
                    })
                );
            if (committed?.abiVersion !== GPU_ROUTE_LIFECYCLE_ABI_VERSION
                || committed?.accepted !== true
                || committed.requiresRecovery === true
                || committed.targetFixedTick !== transaction.targetFixedTick
                || committed.batchIdFingerprint !== transaction.batchIdFingerprint
                || committed.spawnedCount !== spawned.length
                || committed.cleanedCount !== 0) {
                throw new RangeError(
                    committed?.reason ?? 'route-spawn-commit-mismatch'
                );
            }
            result.routeRuntimeBinding = snapshotRouteRuntimeBinding(
                committed.runtimeBinding,
                'route spawn commit'
            );
            for (const entry of spawned) {
                result.routeLifecycle.push({
                    action: 'spawn',
                    commandId: entry.commandId,
                    commandIdFingerprint: entry.commandIdFingerprint,
                    handle: entry.handle,
                    targetFixedTick: transaction.targetFixedTick,
                    batchIdFingerprint: transaction.batchIdFingerprint
                });
            }
        } catch (error) {
            result.state = 'failed';
            result.recoveryRequired = true;
            result.rejected.push({
                commandId: transaction.plans[0].commandId,
                code: 'route-spawn-commit',
                message: String(error?.message ?? error)
            });
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
            } else if (command.type === 'atomic-transform-batch'
                || command.type === 'enemy-atomic-transform-batch') {
                for (const record of command.records) {
                    for (const handle of record.sourceHandles) {
                        this.pendingAtomicTransformSourceKeys.delete(
                            handleKey(handle)
                        );
                    }
                }
            } else if (command.type === 'projectile-capture-release-batch') {
                for (const record of command.records) {
                    this.pendingProjectileCaptureReleaseKeys.delete(
                        handleKey(record.projectileHandle)
                    );
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
