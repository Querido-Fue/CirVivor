import {
    normalizeGpuCircleBodyContactHandler,
    normalizeGpuCircleBodyMetadata,
    encodeGpuCircleBodyFixedPoint,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE,
    GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_PROJECTILE_CAPTURE_PHASE,
    GPU_PROJECTILE_CAPTURE_POLICY_CODE,
    GPU_PROJECTILE_CAPTURE_ROLE
} from '../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_LAST_PULSE_TICK_INVALID,
    normalizeGpuEffectEmitterState
} from '../physics/gpu/gpu_effect_runtime_abi.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID
} from '../contract/projectile_target_policy_contract.js';
import {
    PROJECTILE_CAPTURE_POLICY_ID,
    PROJECTILE_ORIGIN_PROVENANCE_KEYS,
    normalizeProjectileCapturePolicyId,
    normalizeProjectileOriginProvenance
} from '../contract/projectile_capture_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayDamagePolicyId,
    resolveGameplayAllegianceTeam
} from '../contract/gameplay_team_contract.js';
import {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability,
    normalizeEnemyCapabilityMask
} from '../contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY
} from '../contract/enemy_profile_contract.js';
import {
    ENEMY_ORBIT_SLOT_UNASSIGNED,
    encodeEnemyOrbitAngularStepQ32,
    hasAnyEnemyOrbitLeaseMetadata,
    normalizeEnemyOrbitSlotLease
} from '../contract/enemy_orbit_directional_defense_contract.js';
import {
    ENEMY_FORMATION_POLICY,
    ENEMY_FORMATION_POLICY_CODE_BY_ID,
    FORMATION_COORDINATE_SYSTEM_CODE_BY_ID,
    FORMATION_RUNTIME_FLAG,
    isConnectedFormationOccupancyMask
} from '../contract/enemy_formation_contract.js';
import {
    ENEMY_FORMATION_DEFINITION_BY_ID
} from 'data/object/enemy/enemy_formation_catalog_data.js';
import {
    BASIC_HEXA_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID,
    resolveBasicHexaFormationStats,
    resolveBasicHexaTransformPrivateDefinition
} from 'data/object/enemy/basic_hexa_enemy_data.js';
import {
    BASIC_OCTA_ENEMY_CAPABILITY_MASK,
    BASIC_OCTA_ENEMY_DATA,
    BASIC_OCTA_ENEMY_DEFINITION_ID,
    BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE,
    BASIC_OCTA_ORBIT_SLOT_CAPACITY
} from 'data/object/enemy/basic_octa_enemy_data.js';
import {
    BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
    BASIC_JORANG_ENEMY_DEFINITION_ID,
    CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
    JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
} from 'data/object/enemy/enemy_jorang_split_catalog_data.js';
import {
    ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_CODE,
    ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_ID
} from 'data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    ENEMY_ROUTE_CLOSURE_PROFILE_BY_CODE,
    ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID
} from 'data/object/enemy/enemy_route_closure_catalog_data.js';
import {
    BASIC_CORK_ENEMY_CAPABILITY_MASK,
    BASIC_CORK_ENEMY_DEFINITION_ID
} from 'data/object/enemy/basic_cork_enemy_data.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;

function requireNonNegativeSafeInteger(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, allowZero = true) {
    const number = requireNonNegativeSafeInteger(value, label);
    if (number > 0xffffffff || (!allowZero && number === 0)) {
        throw new RangeError(
            `${label}은 ${allowZero ? '' : 'nonzero '}uint32 범위여야 합니다.`
        );
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireExactIdentityComponent(value, label) {
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

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function requireNonNegativeFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return number;
}

function copyOptionalEnemyProfileMetadata(intent) {
    const fields = [
        'physicsProfileId',
        'combatProfileId',
        'behaviorProfileId'
    ];
    const hasAny = fields.some((field) => intent[field] !== undefined);
    if (!hasAny) {
        return {};
    }
    const metadata = {};
    for (const field of fields) {
        metadata[field] = requireNonEmptyString(
            intent[field],
            `spawnIntent.${field}`
        );
    }
    if (intent.atomicTransformProfileId !== undefined) {
        metadata.atomicTransformProfileId
            = intent.atomicTransformProfileId === null
                ? null
                : requireNonEmptyString(
                    intent.atomicTransformProfileId,
                    'spawnIntent.atomicTransformProfileId'
                );
    }
    return metadata;
}

function copyOptionalEnemyCapabilityMetadata(intent) {
    if (intent.capabilityMask === undefined || intent.capabilityMask === null) {
        return {};
    }
    return {
        capabilityMask: normalizeEnemyCapabilityMask(
            intent.capabilityMask,
            'spawnIntent.capabilityMask'
        )
    };
}

function normalizeOptionalEnemyProjectileCaptureMetadata(intent, capabilityMask) {
    const hasCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.PROJECTILE_CAPTURE,
            'spawnIntent.capabilityMask'
        );
    const hasProfileId = intent.projectileCaptureProfileId !== undefined
        && intent.projectileCaptureProfileId !== null;
    const hasProfileCode = intent.projectileCaptureProfileCode !== undefined
        && intent.projectileCaptureProfileCode !== null;
    if (hasCapability !== hasProfileId || hasProfileId !== hasProfileCode) {
        throw new RangeError(
            'PROJECTILE_CAPTURE capability과 capture profile id/code가 함께 있어야 합니다.'
        );
    }
    if (!hasCapability) {
        return null;
    }
    const profileId = requireNonEmptyString(
        intent.projectileCaptureProfileId,
        'spawnIntent.projectileCaptureProfileId'
    );
    const profileCode = requireUint32(
        intent.projectileCaptureProfileCode,
        'spawnIntent.projectileCaptureProfileCode',
        false
    );
    const byId = ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_ID[profileId];
    const byCode = ENEMY_PROJECTILE_CAPTURE_PROFILE_BY_CODE[profileCode];
    if (!byId || byId !== byCode || byId.definitionCode !== profileCode) {
        throw new RangeError('enemy projectile capture profile id/code가 catalog와 다릅니다.');
    }
    return Object.freeze({
        projectileCaptureProfileId: profileId,
        projectileCaptureProfileCode: profileCode
    });
}

function normalizeOptionalEnemyRouteClosureMetadata(
    intent,
    capabilityMask,
    definitionId
) {
    const hasCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.ROUTE_CLOSURE,
            'spawnIntent.capabilityMask'
        );
    const hasProfileId = intent.routeClosureProfileId !== undefined
        && intent.routeClosureProfileId !== null;
    const hasProfileCode = intent.routeClosureProfileCode !== undefined
        && intent.routeClosureProfileCode !== null;
    if (hasCapability !== hasProfileId || hasProfileId !== hasProfileCode) {
        throw new RangeError(
            'ROUTE_CLOSURE capability과 route profile id/code가 함께 있어야 합니다.'
        );
    }
    if (Object.prototype.hasOwnProperty.call(intent, 'routeRuntimeState')) {
        throw new TypeError(
            'raw Enemy spawn은 privileged routeRuntimeState를 제공할 수 없습니다.'
        );
    }
    const routeSetId = intent.routeSetId === undefined || intent.routeSetId === null
        ? null
        : requireNonEmptyString(intent.routeSetId, 'spawnIntent.routeSetId');
    const routeGraphContentKey = intent.routeGraphContentKey === undefined
            || intent.routeGraphContentKey === null
        ? null
        : requireNonEmptyString(
            intent.routeGraphContentKey,
            'spawnIntent.routeGraphContentKey'
        );
    const routeAvailabilityVersion = requireUint32(
        intent.routeAvailabilityVersion ?? 1,
        'spawnIntent.routeAvailabilityVersion',
        false
    );
    if (routeAvailabilityVersion === 0
        || routeAvailabilityVersion === INVALID_HANDLE_COMPONENT
        || (routeSetId === null) !== (routeGraphContentKey === null)) {
        throw new RangeError(
            'route snapshot은 non-sentinel version과 paired routeSet/contentKey여야 합니다.'
        );
    }
    if (!hasCapability) {
        return Object.freeze({
            routeSetId,
            routeAvailabilityVersion,
            routeGraphContentKey
        });
    }
    const profileId = requireNonEmptyString(
        intent.routeClosureProfileId,
        'spawnIntent.routeClosureProfileId'
    );
    const profileCode = requireUint32(
        intent.routeClosureProfileCode,
        'spawnIntent.routeClosureProfileCode',
        false
    );
    const byId = ENEMY_ROUTE_CLOSURE_PROFILE_BY_ID[profileId];
    const byCode = ENEMY_ROUTE_CLOSURE_PROFILE_BY_CODE[profileCode];
    if (definitionId !== BASIC_CORK_ENEMY_DEFINITION_ID
        || capabilityMask !== BASIC_CORK_ENEMY_CAPABILITY_MASK
        || !byId
        || byId !== byCode
        || byId.definitionCode !== profileCode) {
        throw new RangeError(
            'natural Cork route profile이 exact catalog와 다릅니다.'
        );
    }
    return Object.freeze({
        routeClosureProfileId: profileId,
        routeClosureProfileCode: profileCode,
        routeSetId,
        routeAvailabilityVersion,
        routeGraphContentKey
    });
}

function normalizeProjectileCaptureIngress(intent) {
    const projectileCapturePolicyId = normalizeProjectileCapturePolicyId(
        intent.projectileCapturePolicyId,
        'spawnIntent.projectileCapturePolicyId'
    );
    const provenanceSource = Object.create(null);
    for (const key of PROJECTILE_ORIGIN_PROVENANCE_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(intent, key)) {
            throw new TypeError(`spawnIntent.${key} origin provenance가 필요합니다.`);
        }
        provenanceSource[key] = intent[key];
    }
    return Object.freeze({
        projectileCapturePolicyId,
        ...normalizeProjectileOriginProvenance(
            provenanceSource,
            'spawnIntent.projectileOriginProvenance'
        )
    });
}

function normalizeInitialProjectileCaptureState(
    intent,
    kindId,
    enemyCaptureProfile,
    projectileCaptureIngress
) {
    const state = intent.projectileCaptureState;
    const expectedRole = kindId === 'enemy' && enemyCaptureProfile !== null
        ? GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
        : kindId === 'projectile'
            ? GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
            : GPU_PROJECTILE_CAPTURE_ROLE.NONE;
    if (expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.NONE) {
        if (state !== undefined && state !== null) {
            throw new TypeError(
                'capture capability이 없는 body에는 projectileCaptureState가 금지됩니다.'
            );
        }
        return null;
    }
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError('capture-capable spawn에는 projectileCaptureState가 필요합니다.');
    }
    const allowedKeys = new Set([
        'role',
        'phase',
        'profileCode',
        'policyCode',
        'flags',
        'peerBodySlot',
        'peerEntityId',
        'peerIncarnation',
        'capturedAtFixedTick',
        'releaseDueFixedTick',
        'captureSequence',
        'capturedSpeed',
        'facingX',
        'facingY'
    ]);
    for (const key of Reflect.ownKeys(state)) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) {
            throw new RangeError(`projectileCaptureState에 금지 field가 있습니다: ${String(key)}`);
        }
    }
    const expectedProfileCode = expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
        ? enemyCaptureProfile.projectileCaptureProfileCode
        : 0;
    const expectedPolicyCode = expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.PROJECTILE
        && projectileCaptureIngress.projectileCapturePolicyId
            === PROJECTILE_CAPTURE_POLICY_ID.CAPTURABLE
        ? GPU_PROJECTILE_CAPTURE_POLICY_CODE.CAPTURABLE
        : GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE;
    const peerBodySlot = state.peerBodySlot ?? INVALID_HANDLE_COMPONENT;
    const peerEntityId = state.peerEntityId ?? INVALID_HANDLE_COMPONENT;
    const peerIncarnation = state.peerIncarnation ?? INVALID_HANDLE_COMPONENT;
    const facingX = state.facingX ?? 0;
    const facingY = state.facingY ?? 0;
    const facingLength = Math.hypot(facingX, facingY);
    if (state.role !== expectedRole
        || (state.phase ?? GPU_PROJECTILE_CAPTURE_PHASE.IDLE)
            !== GPU_PROJECTILE_CAPTURE_PHASE.IDLE
        || (state.profileCode ?? 0) !== expectedProfileCode
        || (state.policyCode ?? GPU_PROJECTILE_CAPTURE_POLICY_CODE.NOT_CAPTURABLE)
            !== expectedPolicyCode
        || (state.flags ?? 0) !== 0
        || peerBodySlot !== INVALID_HANDLE_COMPONENT
        || peerEntityId !== INVALID_HANDLE_COMPONENT
        || peerIncarnation !== INVALID_HANDLE_COMPONENT
        || (state.capturedAtFixedTick ?? 0) !== 0
        || (state.releaseDueFixedTick ?? 0) !== 0
        || (state.captureSequence ?? 0) !== 0
        || (state.capturedSpeed ?? 0) !== 0
        || (expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR
            ? !Number.isFinite(facingLength)
                || Math.abs(facingLength - 1) > 1e-4
            : state.facingX !== undefined || state.facingY !== undefined)) {
        throw new RangeError(
            'public spawn projectileCaptureState는 exact IDLE catalog state여야 합니다.'
        );
    }
    return Object.freeze({
        role: expectedRole,
        phase: GPU_PROJECTILE_CAPTURE_PHASE.IDLE,
        profileCode: expectedProfileCode,
        policyCode: expectedPolicyCode,
        flags: 0,
        peerBodySlot,
        peerEntityId,
        peerIncarnation,
        capturedAtFixedTick: 0,
        releaseDueFixedTick: 0,
        captureSequence: 0,
        capturedSpeed: 0,
        facingX: expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR ? facingX : 0,
        facingY: expectedRole === GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR ? facingY : 0
    });
}

function hasEnemyOrbitCapability(capabilityMask) {
    return capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.ORBIT,
            'spawnIntent.capabilityMask'
        );
}

function hasEnemyOrbitBehaviorProgram(intent) {
    return intent?.enemyBehaviorState?.programId
        === GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT;
}

function requireEnemyOrbitBehaviorState(intent, lease, label) {
    const state = intent.enemyBehaviorState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError(`${label}.enemyBehaviorState가 필요합니다.`);
    }
    if (state.programId
            !== GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT
        || state.orbitSlotIndex !== lease.orbitSlotIndex
        || state.orbitSlotCapacity !== lease.orbitSlotCapacity
        || state.coordinateSystemCode !== lease.orbitCoordinateSystemCode) {
        throw new RangeError(
            `${label}의 orbit lease와 EnemyBehaviorState가 exact 동기화되어야 합니다.`
        );
    }
    return state;
}

function validateOptionalEnemyOrbitIngress(intent, capabilityMask, definitionId) {
    const hasOrbit = hasEnemyOrbitCapability(capabilityMask);
    const hasLeaseMetadata = hasAnyEnemyOrbitLeaseMetadata(intent);
    const hasOrbitBehaviorProgram = hasEnemyOrbitBehaviorProgram(intent);
    const isNaturalOctaDefinition = definitionId === BASIC_OCTA_ENEMY_DEFINITION_ID;
    if (isNaturalOctaDefinition !== hasOrbit
        || isNaturalOctaDefinition !== hasLeaseMetadata
        || isNaturalOctaDefinition !== hasOrbitBehaviorProgram) {
        throw new RangeError(
            'O definition, ORBIT capability, orbit lease metadata, '
                + 'OCTAGON_TOWER_ORBIT program이 일치해야 합니다.'
        );
    }
    if (!hasOrbit) {
        return null;
    }
    const lease = normalizeEnemyOrbitSlotLease(intent, {
        label: 'spawnIntent.orbitLease',
        allowUnassigned: true,
        expectedSlotCapacity: BASIC_OCTA_ORBIT_SLOT_CAPACITY
    });
    if (lease.orbitSlotIndex !== ENEMY_ORBIT_SLOT_UNASSIGNED) {
        throw new RangeError(
            'raw ORBIT Enemy spawn의 slot은 lifecycle sentinel이어야 합니다.'
        );
    }
    requireEnemyOrbitBehaviorState(intent, lease, 'spawnIntent');
    return lease;
}

function copyOptionalEnemyOrbitMetadata(intent) {
    const capabilityMask = intent.capabilityMask === undefined
        || intent.capabilityMask === null
        ? null
        : normalizeEnemyCapabilityMask(
            intent.capabilityMask,
            'spawnIntent.capabilityMask'
        );
    const hasOrbit = hasEnemyOrbitCapability(capabilityMask);
    const hasLeaseMetadata = hasAnyEnemyOrbitLeaseMetadata(intent);
    if (hasOrbit !== hasLeaseMetadata) {
        throw new RangeError(
            'ORBIT capability와 activated orbit lease metadata가 일치해야 합니다.'
        );
    }
    if (!hasOrbit) {
        return {};
    }
    const lease = normalizeEnemyOrbitSlotLease(intent, {
        label: 'activatedSpawnIntent.orbitLease',
        expectedSlotCapacity: BASIC_OCTA_ORBIT_SLOT_CAPACITY
    });
    requireEnemyOrbitBehaviorState(intent, lease, 'activatedSpawnIntent');
    return lease;
}

function requireSignedInt32Positive(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0x7fffffff) {
        throw new RangeError(`${label}은 positive signed-int32여야 합니다.`);
    }
    return number;
}

function popcountUint32(value) {
    let bits = value >>> 0;
    let count = 0;
    while (bits !== 0) {
        bits = (bits & (bits - 1)) >>> 0;
        count++;
    }
    return count;
}

export const GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS = Object.freeze([
    'memberCount',
    'currentHealthCenti',
    'maxHealthCenti',
    'formationOccupiedSlotMask',
    'formationRotationStep',
    'formationGeneration',
    'formationLineageHash'
]);
const PRIVATE_HEXA_TRANSFORM_INTENT_KEYS = new Set(
    GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS
);

/**
 * Lifecycle request-time private transform facts를 identity 없이 정확히 한 번 읽어
 * deep immutable snapshot으로 만듭니다. 이 cycle-free ingress는 Formation director와
 * public adapter가 함께 사용하지만 public `normalizeGpuSpawnIntent()` 경로는 아닙니다.
 */
export function normalizeGpuPrivateHexaTransformDestinationIntent(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('private Hexa transform destination facts가 필요합니다.');
    }
    const ownKeys = Reflect.ownKeys(source);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError('private Hexa transform intent에는 symbol이 금지됩니다.');
    }
    const snapshot = Object.create(null);
    for (const key of ownKeys) {
        if (!PRIVATE_HEXA_TRANSFORM_INTENT_KEYS.has(key)) {
            throw new RangeError(
                `private Hexa transform intent에 금지/unknown field가 있습니다: ${key}`
            );
        }
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor) {
            throw new TypeError(
                `private Hexa transform intent descriptor가 변경되었습니다: ${key}`
            );
        }
        if (descriptor.enumerable) {
            snapshot[key] = Reflect.get(source, key);
        }
    }
    for (const key of PRIVATE_HEXA_TRANSFORM_INTENT_KEYS) {
        if (snapshot[key] === undefined || snapshot[key] === null) {
            throw new TypeError(`private Hexa transform intent field가 필요합니다: ${key}`);
        }
        if (typeof snapshot[key] !== 'number') {
            throw new TypeError(`private Hexa transform intent.${key}는 number여야 합니다.`);
        }
    }
    const memberCount = snapshot.memberCount;
    const privateDefinition = resolveBasicHexaTransformPrivateDefinition(memberCount);
    const currentHealthCenti = requireSignedInt32Positive(
        snapshot.currentHealthCenti,
        'currentHealthCenti'
    );
    const maxHealthCenti = requireSignedInt32Positive(
        snapshot.maxHealthCenti,
        'maxHealthCenti'
    );
    if (currentHealthCenti > maxHealthCenti) {
        throw new RangeError('destination current centi-HP는 max를 넘을 수 없습니다.');
    }
    const formationDefinition = ENEMY_FORMATION_DEFINITION_BY_ID[
        privateDefinition.formationDefinitionId
    ];
    const formationOccupiedSlotMask = requireUint32(
        snapshot.formationOccupiedSlotMask,
        'formationOccupiedSlotMask',
        false
    );
    const formationRotationStep = requireNonNegativeSafeInteger(
        snapshot.formationRotationStep,
        'formationRotationStep'
    );
    const formationGeneration = requireUint32(
        snapshot.formationGeneration,
        'formationGeneration',
        false
    );
    const formationLineageHash = requireUint32(
        snapshot.formationLineageHash,
        'formationLineageHash',
        false
    );
    const validMask = (1 << formationDefinition.slotCount) - 1;
    if (formationGeneration <= 1
        || formationGeneration === INVALID_HANDLE_COMPONENT
        || formationLineageHash === INVALID_HANDLE_COMPONENT
        || formationRotationStep >= formationDefinition.slotCount
        || (formationOccupiedSlotMask & ~validMask) !== 0
        || popcountUint32(formationOccupiedSlotMask) !== memberCount
        || !isConnectedFormationOccupancyMask(
            formationDefinition.neighborMasks,
            formationOccupiedSlotMask,
            formationDefinition.slotCount
        )) {
        throw new RangeError('private Hexa transform Formation facts가 올바르지 않습니다.');
    }
    return Object.freeze({
        memberCount,
        currentHealthCenti,
        maxHealthCenti,
        formationOccupiedSlotMask,
        formationRotationStep,
        formationGeneration,
        formationLineageHash
    });
}

const ENEMY_FORMATION_BASE_METADATA_FIELDS = Object.freeze([
    'formationDefinitionId',
    'formationDefinitionCode',
    'formationCoordinateSystemId',
    'formationCoordinateSystemCode',
    'formationPolicyId',
    'formationPolicyCode',
    'formationMemberCount'
]);
const ENEMY_FORMATION_RUNTIME_METADATA_FIELDS = Object.freeze([
    'formationId',
    'formationOccupiedSlotMask',
    'formationRotationStep',
    'formationGeneration',
    'formationFlags',
    'formationLineageHash',
    'formationState'
]);
const ENEMY_FORMATION_PROVENANCE_FIELDS = Object.freeze([
    'formationGroupId',
    'formationAuthoredCoordinateSystemId',
    'formationAuthoredMemberCount',
    'formationRows',
    'formationColumns',
    'formationMemberIndex',
    'formationMemberSlotIndex',
    'formationRowIndex',
    'formationColumnIndex',
    'formationAuthoredOccupiedSlotMask'
]);
const EMPTY_ENEMY_FORMATION_PROVENANCE_METADATA = Object.freeze(
    Object.fromEntries(ENEMY_FORMATION_PROVENANCE_FIELDS.map((field) => [
        field,
        null
    ]))
);

function hasAnyField(source, fields) {
    return fields.some((field) => (
        source[field] !== undefined && source[field] !== null
    ));
}

function requireAllFields(source, fields, label) {
    for (const field of fields) {
        if (source[field] === undefined || source[field] === null) {
            throw new TypeError(`${label} field는 모두 함께 제공해야 합니다: ${field}`);
        }
    }
}

function validateFormationBaseMetadata(intent, capabilityMask) {
    const hasFormationCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.FORMATION,
            'spawnIntent.capabilityMask'
        );
    const hasBaseMetadata = hasAnyField(intent, ENEMY_FORMATION_BASE_METADATA_FIELDS);
    if (hasFormationCapability !== hasBaseMetadata) {
        throw new RangeError(
            'FORMATION capability와 formation base metadata가 일치해야 합니다.'
        );
    }
    if (!hasFormationCapability) {
        return null;
    }
    requireAllFields(intent, ENEMY_FORMATION_BASE_METADATA_FIELDS, 'formation base metadata');
    const formationDefinitionId = requireNonEmptyString(
        intent.formationDefinitionId,
        'spawnIntent.formationDefinitionId'
    );
    const formationDefinition = ENEMY_FORMATION_DEFINITION_BY_ID[
        formationDefinitionId
    ];
    const formationDefinitionCode = requireUint32(
        intent.formationDefinitionCode,
        'spawnIntent.formationDefinitionCode',
        false
    );
    const formationCoordinateSystemId = requireNonEmptyString(
        intent.formationCoordinateSystemId,
        'spawnIntent.formationCoordinateSystemId'
    );
    const formationCoordinateSystemCode = requireUint32(
        intent.formationCoordinateSystemCode,
        'spawnIntent.formationCoordinateSystemCode',
        false
    );
    const formationPolicyId = requireNonEmptyString(
        intent.formationPolicyId,
        'spawnIntent.formationPolicyId'
    );
    const formationPolicyCode = requireUint32(
        intent.formationPolicyCode,
        'spawnIntent.formationPolicyCode',
        false
    );
    const formationMemberCount = requireUint32(
        intent.formationMemberCount,
        'spawnIntent.formationMemberCount',
        false
    );
    if (!formationDefinition
        || formationDefinition.definitionCode !== formationDefinitionCode
        || formationDefinition.coordinateSystemId !== formationCoordinateSystemId
        || formationDefinition.coordinateSystemCode !== formationCoordinateSystemCode
        || FORMATION_COORDINATE_SYSTEM_CODE_BY_ID[formationCoordinateSystemId]
            !== formationCoordinateSystemCode
        || ENEMY_FORMATION_POLICY_CODE_BY_ID[formationPolicyId]
            !== formationPolicyCode
        || formationMemberCount > formationDefinition.maximumMemberCount) {
        throw new RangeError('formation base metadata가 exact catalog/policy와 일치해야 합니다.');
    }
    return Object.freeze({
        formationDefinition,
        formationDefinitionId,
        formationDefinitionCode,
        formationCoordinateSystemId,
        formationCoordinateSystemCode,
        formationPolicyId,
        formationPolicyCode,
        formationMemberCount
    });
}

function validateOptionalFormationProvenance(intent, base) {
    const hasProvenance = hasAnyField(intent, ENEMY_FORMATION_PROVENANCE_FIELDS);
    if (!hasProvenance) {
        return {};
    }
    if (base === null) {
        throw new RangeError('Formation provenance에는 FORMATION capability가 필요합니다.');
    }
    requireAllFields(intent, ENEMY_FORMATION_PROVENANCE_FIELDS, 'formation provenance');
    const formationGroupId = requireNonEmptyString(
        intent.formationGroupId,
        'spawnIntent.formationGroupId'
    );
    const formationAuthoredCoordinateSystemId = requireNonEmptyString(
        intent.formationAuthoredCoordinateSystemId,
        'spawnIntent.formationAuthoredCoordinateSystemId'
    );
    const formationAuthoredMemberCount = requireUint32(
        intent.formationAuthoredMemberCount,
        'spawnIntent.formationAuthoredMemberCount',
        false
    );
    const formationRows = requireUint32(intent.formationRows, 'spawnIntent.formationRows', false);
    const formationColumns = requireUint32(
        intent.formationColumns,
        'spawnIntent.formationColumns',
        false
    );
    const formationMemberIndex = requireNonNegativeSafeInteger(
        intent.formationMemberIndex,
        'spawnIntent.formationMemberIndex'
    );
    const formationMemberSlotIndex = requireNonNegativeSafeInteger(
        intent.formationMemberSlotIndex,
        'spawnIntent.formationMemberSlotIndex'
    );
    const formationRowIndex = requireNonNegativeSafeInteger(
        intent.formationRowIndex,
        'spawnIntent.formationRowIndex'
    );
    const formationColumnIndex = requireNonNegativeSafeInteger(
        intent.formationColumnIndex,
        'spawnIntent.formationColumnIndex'
    );
    const formationAuthoredOccupiedSlotMask = requireUint32(
        intent.formationAuthoredOccupiedSlotMask,
        'spawnIntent.formationAuthoredOccupiedSlotMask',
        false
    );
    const definition = base.formationDefinition;
    const validMask = (1 << definition.slotCount) - 1;
    const centerRow = (formationRows - 1) * 0.5;
    const centerColumn = (formationColumns - 1) * 0.5;
    const q = formationColumnIndex - centerColumn;
    const r = formationRowIndex - centerRow;
    const resolvedSlotIndex = definition.slotCoordinates.findIndex(
        (coordinate) => coordinate.q === q && coordinate.r === r
    );
    if (formationAuthoredCoordinateSystemId !== base.formationCoordinateSystemId
        || (formationRows & 1) === 0
        || (formationColumns & 1) === 0
        || formationAuthoredMemberCount > definition.maximumMemberCount
        || formationMemberIndex >= formationAuthoredMemberCount
        || formationRowIndex >= formationRows
        || formationColumnIndex >= formationColumns
        || resolvedSlotIndex !== formationMemberSlotIndex
        || (formationAuthoredOccupiedSlotMask & ~validMask) !== 0
        || (formationAuthoredOccupiedSlotMask & (1 << formationMemberSlotIndex)) === 0
        || popcountUint32(formationAuthoredOccupiedSlotMask)
            !== formationAuthoredMemberCount
        || !isConnectedFormationOccupancyMask(
            definition.neighborMasks,
            formationAuthoredOccupiedSlotMask,
            definition.slotCount
        )) {
        throw new RangeError('authored Formation provenance가 exact six-ring layout과 다릅니다.');
    }
    return {
        formationGroupId,
        formationAuthoredCoordinateSystemId,
        formationAuthoredMemberCount,
        formationRows,
        formationColumns,
        formationMemberIndex,
        formationMemberSlotIndex,
        formationRowIndex,
        formationColumnIndex,
        formationAuthoredOccupiedSlotMask
    };
}

function assertRawEnemyFormationIngress(intent, capabilityMask) {
    const base = validateFormationBaseMetadata(intent, capabilityMask);
    const provenance = validateOptionalFormationProvenance(intent, base);
    if (Object.keys(provenance).length > 0) {
        requireNonEmptyString(intent.waveId, 'spawnIntent.waveId');
    }
    if (hasAnyField(intent, ENEMY_FORMATION_RUNTIME_METADATA_FIELDS)) {
        throw new RangeError(
            'raw Enemy spawn은 runtime formationId/hash/state를 제공할 수 없습니다.'
        );
    }
    if (base !== null && base.formationMemberCount !== 1) {
        throw new RangeError('public natural Formation spawn은 n1 member만 허용합니다.');
    }
    return Object.freeze({ base, provenance: Object.freeze(provenance) });
}

function assertNaturalHexaRawIntent(
    intent,
    capabilityMask,
    formationIngress,
    contactHandler
) {
    const expectedCapabilityMask = createEnemyCapabilityMask(
        BASIC_HEXA_ENEMY_DATA.capabilityIds,
        'natural H capabilityIds'
    );
    const expectedFormation = ENEMY_FORMATION_DEFINITION_BY_ID[
        BASIC_HEXA_ENEMY_DATA.formationDefinitionId
    ];
    const expectedStats = resolveBasicHexaFormationStats(1);
    const base = formationIngress.base;
    if (capabilityMask !== expectedCapabilityMask
        || base === null
        || base.formationDefinitionId !== expectedFormation.id
        || base.formationDefinitionCode !== expectedFormation.definitionCode
        || base.formationCoordinateSystemId
            !== expectedFormation.coordinateSystemId
        || base.formationCoordinateSystemCode
            !== expectedFormation.coordinateSystemCode
        || base.formationPolicyId !== ENEMY_FORMATION_POLICY.SEEK_FORMATION
        || base.formationPolicyCode
            !== ENEMY_FORMATION_POLICY_CODE_BY_ID[
                ENEMY_FORMATION_POLICY.SEEK_FORMATION
            ]
        || base.formationMemberCount !== 1
        || intent.physicsProfileId !== BASIC_HEXA_ENEMY_DATA.physicsProfileId
        || intent.combatProfileId !== BASIC_HEXA_ENEMY_DATA.combatProfileId
        || intent.behaviorProfileId !== BASIC_HEXA_ENEMY_DATA.behaviorProfileId
        || intent.enemyBehaviorState !== undefined) {
        throw new RangeError('natural H raw intent가 exact public catalog와 다릅니다.');
    }
    for (const [field, expected] of [
        ['flowSpeed', expectedStats.moveSpeedTilesPerSecond],
        ['siegeWeight', BASIC_HEXA_ENEMY_DATA.siegeWeight],
        ['weight', expectedStats.weight],
        ['inverseMass', expectedStats.inverseMass],
        ['towerContactDamage', expectedStats.towerContactDamage],
        ['coreImpactDamage', expectedStats.coreImpactDamage],
        ['bountyBudget', expectedStats.bountyBudget]
    ]) {
        if (intent[field] !== expected) {
            throw new RangeError(
                `natural H raw intent.${field}는 fixed n1 table과 같아야 합니다.`
            );
        }
    }
    if (contactHandler?.damageOther !== expectedStats.towerContactDamage) {
        throw new RangeError(
            'natural H contact damage는 fixed n1 table과 같아야 합니다.'
        );
    }
}

function assertNaturalOctaRawIntent(
    intent,
    capabilityMask,
    orbitLease
) {
    const orbitProfile = BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.orbit;
    const directionalDefense
        = BASIC_OCTA_ORBIT_BEHAVIOR_PROFILE.directionalDefense;
    const behaviorState = requireEnemyOrbitBehaviorState(
        intent,
        orbitLease,
        'natural O spawnIntent'
    );
    if (capabilityMask !== BASIC_OCTA_ENEMY_CAPABILITY_MASK
        || intent.physicsProfileId !== BASIC_OCTA_ENEMY_DATA.physicsProfileId
        || intent.combatProfileId !== BASIC_OCTA_ENEMY_DATA.combatProfileId
        || intent.behaviorProfileId !== BASIC_OCTA_ENEMY_DATA.behaviorProfileId
        || behaviorState.orbitRadiusTiles !== orbitProfile.orbitRadiusTiles
        || behaviorState.angularStepQ32 !== encodeEnemyOrbitAngularStepQ32(
            orbitProfile.angularSpeedRadiansPerSecond,
            orbitProfile.fixedTicksPerSecond
        )
        || behaviorState.flatReductionFixedPoint
            !== directionalDefense.flatReductionFixedPoint
        || behaviorState.armoredFacetCount
            !== directionalDefense.armoredFacetCount
        || behaviorState.totalFacetCount
            !== directionalDefense.totalFacetCount) {
        throw new RangeError('natural O raw intent가 exact public catalog와 다릅니다.');
    }
}

function copyOptionalEnemyFormationMetadata(intent) {
    const capabilityMask = intent.capabilityMask === undefined
        || intent.capabilityMask === null
        ? null
        : normalizeEnemyCapabilityMask(
            intent.capabilityMask,
            'spawnIntent.capabilityMask'
        );
    const base = validateFormationBaseMetadata(intent, capabilityMask);
    const provenance = validateOptionalFormationProvenance(intent, base);
    // Non-authored natural H/private composite는 authored group과 runtime
    // formationId를 alias하지 않습니다. Registry에는 explicit null sentinel로
    // provenance shape만 고정하고 runtime occupancy/state는 별도 scalar가 소유합니다.
    const registryProvenance = Object.keys(provenance).length === 0
        ? EMPTY_ENEMY_FORMATION_PROVENANCE_METADATA
        : provenance;
    if (base === null) {
        if (hasAnyField(intent, ENEMY_FORMATION_RUNTIME_METADATA_FIELDS)) {
            throw new RangeError('non-Formation Enemy에는 formation runtime metadata가 금지됩니다.');
        }
        return {};
    }
    requireAllFields(intent, ENEMY_FORMATION_RUNTIME_METADATA_FIELDS, 'formation runtime metadata');
    const formationId = requireNonEmptyString(intent.formationId, 'spawnIntent.formationId');
    const formationOccupiedSlotMask = requireUint32(
        intent.formationOccupiedSlotMask,
        'spawnIntent.formationOccupiedSlotMask',
        false
    );
    const formationRotationStep = requireNonNegativeSafeInteger(
        intent.formationRotationStep,
        'spawnIntent.formationRotationStep'
    );
    const formationGeneration = requireUint32(
        intent.formationGeneration,
        'spawnIntent.formationGeneration',
        false
    );
    const formationFlags = requireUint32(
        intent.formationFlags,
        'spawnIntent.formationFlags',
        false
    );
    const formationLineageHash = requireUint32(
        intent.formationLineageHash,
        'spawnIntent.formationLineageHash',
        false
    );
    const validMask = (1 << base.formationDefinition.slotCount) - 1;
    if (formationGeneration === 0xffffffff
        || formationLineageHash === 0xffffffff
        || formationRotationStep >= base.formationDefinition.slotCount
        || formationFlags !== FORMATION_RUNTIME_FLAG.ACTIVE
        || (formationOccupiedSlotMask & ~validMask) !== 0
        || popcountUint32(formationOccupiedSlotMask) !== base.formationMemberCount
        || !isConnectedFormationOccupancyMask(
            base.formationDefinition.neighborMasks,
            formationOccupiedSlotMask,
            base.formationDefinition.slotCount
        )) {
        throw new RangeError('formation runtime scalar metadata가 올바르지 않습니다.');
    }
    const state = intent.formationState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError('spawnIntent.formationState object가 필요합니다.');
    }
    const stateKeys = new Set([
        'definitionCode',
        'coordinateSystemCode',
        'policyCode',
        'memberCount',
        'occupiedSlotMask',
        'rotationStep',
        'generation',
        'flags',
        'lineageHash'
    ]);
    for (const key of Object.keys(state)) {
        if (!stateKeys.has(key)) {
            throw new RangeError(`spawnIntent.formationState unknown field: ${key}`);
        }
    }
    requireAllFields(state, [...stateKeys], 'formationState');
    if (state.definitionCode !== base.formationDefinitionCode
        || state.coordinateSystemCode !== base.formationCoordinateSystemCode
        || state.policyCode !== base.formationPolicyCode
        || state.memberCount !== base.formationMemberCount
        || state.occupiedSlotMask !== formationOccupiedSlotMask
        || state.rotationStep !== formationRotationStep
        || state.generation !== formationGeneration
        || state.flags !== formationFlags
        || state.lineageHash !== formationLineageHash) {
        throw new RangeError('formationState와 top-level exact facts가 일치해야 합니다.');
    }
    return {
        formationDefinitionId: base.formationDefinitionId,
        formationDefinitionCode: base.formationDefinitionCode,
        formationCoordinateSystemId: base.formationCoordinateSystemId,
        formationCoordinateSystemCode: base.formationCoordinateSystemCode,
        formationPolicyId: base.formationPolicyId,
        formationPolicyCode: base.formationPolicyCode,
        formationId,
        formationMemberCount: base.formationMemberCount,
        formationOccupiedSlotMask,
        formationRotationStep,
        formationGeneration,
        formationFlags,
        formationLineageHash,
        ...registryProvenance
    };
}

const ENEMY_EFFECT_METADATA_FIELDS = Object.freeze([
    'effectEmitterProfileId',
    'effectEmitterDefinitionCode',
    'effectDefinitionId',
    'effectDefinitionCode',
    'effectSelfTargetAllowed',
    'effectPentaTargetAllowed',
    'effectTowerContactDamageModifiable',
    'effectProjectileTowerDamageModifiable',
    'effectDirectCoreImpactDamageModifiable',
    'effectProjectileCoreDamageModifiable',
    'effectClusterRetargetIntervalTicks'
]);

function hasAnyEnemyEffectMetadata(intent) {
    return ENEMY_EFFECT_METADATA_FIELDS.some(
        (field) => intent[field] !== undefined && intent[field] !== null
    );
}

function copyOptionalEnemyEffectMetadata(intent) {
    if (!hasAnyEnemyEffectMetadata(intent)) {
        return {};
    }
    for (const field of ENEMY_EFFECT_METADATA_FIELDS) {
        if (intent[field] === undefined || intent[field] === null) {
            throw new TypeError('enemy effect metadata field는 모두 함께 제공해야 합니다.');
        }
    }
    const metadata = {
        effectEmitterProfileId: requireNonEmptyString(
            intent.effectEmitterProfileId,
            'spawnIntent.effectEmitterProfileId'
        ),
        effectEmitterDefinitionCode: requireExactIdentityComponent(
            intent.effectEmitterDefinitionCode,
            'spawnIntent.effectEmitterDefinitionCode'
        ),
        effectDefinitionId: requireNonEmptyString(
            intent.effectDefinitionId,
            'spawnIntent.effectDefinitionId'
        ),
        effectDefinitionCode: requireExactIdentityComponent(
            intent.effectDefinitionCode,
            'spawnIntent.effectDefinitionCode'
        ),
        effectSelfTargetAllowed: requireBoolean(
            intent.effectSelfTargetAllowed,
            'spawnIntent.effectSelfTargetAllowed'
        ),
        effectPentaTargetAllowed: requireBoolean(
            intent.effectPentaTargetAllowed,
            'spawnIntent.effectPentaTargetAllowed'
        ),
        effectTowerContactDamageModifiable: requireBoolean(
            intent.effectTowerContactDamageModifiable,
            'spawnIntent.effectTowerContactDamageModifiable'
        ),
        effectProjectileTowerDamageModifiable: requireBoolean(
            intent.effectProjectileTowerDamageModifiable,
            'spawnIntent.effectProjectileTowerDamageModifiable'
        ),
        effectDirectCoreImpactDamageModifiable: requireBoolean(
            intent.effectDirectCoreImpactDamageModifiable,
            'spawnIntent.effectDirectCoreImpactDamageModifiable'
        ),
        effectProjectileCoreDamageModifiable: requireBoolean(
            intent.effectProjectileCoreDamageModifiable,
            'spawnIntent.effectProjectileCoreDamageModifiable'
        ),
        effectClusterRetargetIntervalTicks: requireExactIdentityComponent(
            intent.effectClusterRetargetIntervalTicks,
            'spawnIntent.effectClusterRetargetIntervalTicks'
        )
    };
    const emitterProfile = ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
        metadata.effectEmitterProfileId
    ];
    const effectDefinition = ENEMY_EFFECT_DEFINITION_BY_ID[
        metadata.effectDefinitionId
    ];
    if (!emitterProfile
        || !effectDefinition
        || emitterProfile.emitterDefinitionCode
            !== metadata.effectEmitterDefinitionCode
        || emitterProfile.effectDefinitionId !== effectDefinition.id
        || emitterProfile.effectDefinitionCode !== effectDefinition.effectDefinitionCode
        || effectDefinition.effectDefinitionCode !== metadata.effectDefinitionCode
        || emitterProfile.selfTargetAllowed !== metadata.effectSelfTargetAllowed
        || emitterProfile.pentaTargetAllowed !== metadata.effectPentaTargetAllowed
        || effectDefinition.towerContactDamageEffectModifiable
            !== metadata.effectTowerContactDamageModifiable
        || effectDefinition.projectileTowerDamageEffectModifiable
            !== metadata.effectProjectileTowerDamageModifiable
        || effectDefinition.directCoreImpactDamageEffectModifiable
            !== metadata.effectDirectCoreImpactDamageModifiable
        || effectDefinition.typedProjectileCoreDamageEffectModifiable
            !== metadata.effectProjectileCoreDamageModifiable
        || emitterProfile.retargetIntervalTicks
            !== metadata.effectClusterRetargetIntervalTicks) {
        throw new RangeError(
            'enemy effect metadata가 exact catalog profile/definition과 일치해야 합니다.'
        );
    }
    return metadata;
}

function normalizeOptionalEnemyEffectEmitterState(intent, capabilityMask) {
    const hasEffectCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
            'spawnIntent.capabilityMask'
        );
    const hasEffectMetadata = hasAnyEnemyEffectMetadata(intent);
    const hasEmitterState = intent.effectEmitterState !== undefined
        && intent.effectEmitterState !== null;
    if (hasEffectCapability !== hasEffectMetadata
        || hasEffectCapability !== hasEmitterState) {
        throw new RangeError(
            'EFFECT_EMITTER capability, effect metadata, effectEmitterState가 일치해야 합니다.'
        );
    }
    if (!hasEffectCapability) {
        return null;
    }
    const metadata = copyOptionalEnemyEffectMetadata(intent);
    const emitterState = normalizeGpuEffectEmitterState(
        intent.effectEmitterState,
        'spawnIntent.effectEmitterState'
    );
    if (emitterState.emitterDefinitionCode
            !== metadata.effectEmitterDefinitionCode
        || emitterState.effectDefinitionCode !== metadata.effectDefinitionCode) {
        throw new RangeError('effectEmitterState code가 effect metadata와 일치해야 합니다.');
    }
    if (emitterState.lastPulseTick !== GPU_EFFECT_LAST_PULSE_TICK_INVALID) {
        throw new RangeError(
            '신규 Effect emitter spawn의 lastPulseTick은 canonical sentinel이어야 합니다.'
        );
    }
    return emitterState;
}

function copyOptionalResolvedEnemyStatMetadata(intent) {
    const fields = [
        'coreImpactDamage',
        'towerContactDamage',
        'bountyBudget',
        'siegeWeight',
        'weight'
    ];
    const hasAny = fields.some((field) => intent[field] !== undefined);
    if (!hasAny) {
        return {};
    }
    const metadata = {};
    for (const field of fields) {
        metadata[field] = field === 'bountyBudget'
            ? requireUint32(intent[field], `spawnIntent.${field}`)
            : requireNonNegativeFinite(intent[field], `spawnIntent.${field}`);
    }
    if (!(metadata.weight > 0)) {
        throw new RangeError('spawnIntent.weight은 양의 유한 숫자여야 합니다.');
    }
    return metadata;
}

const JORANG_RAW_ATOMIC_PRIVILEGED_FIELDS = Object.freeze([
    'lineageRootEntityId',
    'lineageRootIncarnation',
    'atomicTransformTriggerSourceEntityId',
    'atomicTransformTriggerSourceIncarnation'
]);

function validateRawEnemyAtomicTransformIngress(
    intent,
    capabilityMask,
    definitionId
) {
    const hasAtomicCapability = capabilityMask !== null
        && hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM,
            'spawnIntent.capabilityMask'
        );
    const profileId = intent.atomicTransformProfileId ?? null;
    if (hasAtomicCapability !== (profileId !== null)) {
        throw new RangeError(
            'ATOMIC_TRANSFORM capability와 atomicTransformProfileId가 일치해야 합니다.'
        );
    }
    if (intent.atomicTransformState !== undefined
        || intent.atomicTransformPrepareEvidence !== undefined) {
        throw new TypeError(
            'raw spawn ingress는 privileged atomic transform state/evidence를 만들 수 없습니다.'
        );
    }
    const privilegedFields = [
        ...JORANG_RAW_ATOMIC_PRIVILEGED_FIELDS,
        'branchIndex',
        'transformAtTick',
        'atomicTransformTriggerSourceTick',
        'atomicTransformTriggerSequence'
    ];
    if (privilegedFields.some((field) => (
        Object.prototype.hasOwnProperty.call(intent, field)
    ))) {
        throw new TypeError(
            'J lineage activation field는 raw ingress에서 허용되지 않습니다.'
        );
    }
    if (definitionId === BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID) {
        throw new TypeError('C prime은 privileged transform destination으로만 생성할 수 있습니다.');
    }
    if (definitionId === BASIC_JORANG_ENEMY_DEFINITION_ID
        && profileId !== JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID) {
        throw new RangeError('natural J에는 exact split atomic transform profile이 필요합니다.');
    }
}

function copyOptionalEnemyAtomicTransformMetadata(intent) {
    const profileId = intent.atomicTransformProfileId ?? null;
    if (profileId === null) {
        return {};
    }
    if (profileId !== JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID
        && profileId !== CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID) {
        return { atomicTransformProfileId: profileId };
    }
    const state = intent.atomicTransformState;
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
        throw new TypeError(
            'atomic transform registry metadata에는 privileged materialized state가 필요합니다.'
        );
    }
    const lineageRootEntityId = requireExactIdentityComponent(
        intent.lineageRootEntityId,
        'spawnIntent.lineageRootEntityId'
    );
    const lineageRootIncarnation = requireExactIdentityComponent(
        intent.lineageRootIncarnation,
        'spawnIntent.lineageRootIncarnation'
    );
    const branchIndex = requireUint32(intent.branchIndex, 'spawnIntent.branchIndex');
    const bountyBudget = requireUint32(intent.bountyBudget, 'spawnIntent.bountyBudget');
    const transformAtTick = requireUint32(
        intent.transformAtTick,
        'spawnIntent.transformAtTick'
    );
    const programId = requireUint32(state.programId, 'atomicTransformState.programId');
    const phase = requireUint32(state.phase, 'atomicTransformState.phase');
    const dueFixedTick = requireUint32(
        state.dueFixedTick ?? state.transformAtTick,
        'atomicTransformState.dueFixedTick'
    );
    if (!Object.values(GPU_CIRCLE_ATOMIC_TRANSFORM_PROGRAM).includes(programId)
        || !Object.values(GPU_CIRCLE_ATOMIC_TRANSFORM_PHASE).includes(phase)
        || state.lineageRootEntityId !== lineageRootEntityId
        || state.lineageRootIncarnation !== lineageRootIncarnation
        || state.branchIndex !== branchIndex
        || state.bountyBudget !== bountyBudget
        || dueFixedTick !== transformAtTick) {
        throw new RangeError(
            'atomic transform state와 registry lineage metadata가 exact 일치해야 합니다.'
        );
    }
    return {
        atomicTransformProfileId: profileId,
        atomicTransformProgramId: programId,
        atomicTransformPhase: phase,
        lineageRootEntityId,
        lineageRootIncarnation,
        branchIndex,
        bountyBudget,
        transformAtTick
    };
}

function materializeGpuPlainDataValue(source, label, ancestors, opaqueKeys = null) {
    if (source === null
        || typeof source === 'string'
        || typeof source === 'boolean'
        || typeof source === 'undefined') {
        return source;
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
    try {
        const isArray = Array.isArray(source);
        const isTypedArray = ArrayBuffer.isView(source);
        if (isTypedArray && typeof source.length !== 'number') {
            throw new TypeError(`${label}은 typed array여야 합니다.`);
        }
        if (!isArray && !isTypedArray) {
            const prototype = Object.getPrototypeOf(source);
            const isPlainObject = prototype === null
                || Object.getPrototypeOf(prototype) === null;
            if (!isPlainObject) {
                throw new TypeError(`${label}은 plain object여야 합니다.`);
            }
        }

        // Proxy ownKeys/getter drift를 막기 위해 key 집합은 정확히 한 번만 읽고,
        // 각 enumerable string value도 정확히 한 번만 materialize합니다.
        const ownKeys = Reflect.ownKeys(source);
        if (ownKeys.some((key) => typeof key === 'symbol')) {
            throw new TypeError(`${label}에는 symbol을 사용할 수 없습니다.`);
        }
        const result = isArray || isTypedArray
            ? new Array(source.length)
            : Object.create(null);
        for (const key of ownKeys) {
            if ((isArray || isTypedArray) && key === 'length') {
                continue;
            }
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (!descriptor) {
                throw new TypeError(`${label}.${key} descriptor가 materialize 중 변경되었습니다.`);
            }
            if (!descriptor.enumerable) {
                continue;
            }
            const value = Reflect.get(source, key);
            result[key] = opaqueKeys?.has(key)
                ? value
                : materializeGpuPlainDataValue(
                    value,
                    `${label}.${key}`,
                    ancestors
                );
        }
        return Object.freeze(result);
    } finally {
        ancestors.delete(source);
    }
}

/**
 * GPU public ingress의 raw plain-data를 getter/Proxy 재평가 없이 한 번 읽어
 * deeply immutable snapshot으로 만듭니다.
 */
export function materializeGpuPlainDataSnapshot(
    source,
    label = 'gpuPlainData',
    options = {}
) {
    if (typeof label !== 'string' || label.length === 0) {
        throw new TypeError('plain-data snapshot label이 필요합니다.');
    }
    const opaqueKeys = new Set(options.opaqueKeys ?? []);
    for (const key of opaqueKeys) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new TypeError('opaqueKeys에는 비어 있지 않은 문자열만 사용할 수 있습니다.');
        }
    }
    return materializeGpuPlainDataValue(source, label, new Set(), opaqueKeys);
}

function validateOptionalExactIdentityPair(snapshot, prefix) {
    const entityField = `${prefix}EntityId`;
    const incarnationField = `${prefix}Incarnation`;
    const hasEntityId = snapshot[entityField] !== undefined
        && snapshot[entityField] !== null;
    const hasIncarnation = snapshot[incarnationField] !== undefined
        && snapshot[incarnationField] !== null;
    if (hasEntityId !== hasIncarnation) {
        throw new TypeError(`${entityField}/${incarnationField}은 함께 제공해야 합니다.`);
    }
    if (!hasEntityId) {
        return;
    }
    requireExactIdentityComponent(snapshot[entityField], `spawnIntent.${entityField}`);
    requireExactIdentityComponent(
        snapshot[incarnationField],
        `spawnIntent.${incarnationField}`
    );
}

function copySelectedTargetProjectileMetadata(intent, activationEvidence = null) {
    if (intent.targetSelectionPolicyId === undefined
        && activationEvidence === null) {
        return {};
    }
    if (!activationEvidence || typeof activationEvidence !== 'object') {
        throw new TypeError('selected-target projectile activation evidence가 필요합니다.');
    }
    const selectedTargetKind = requireNonEmptyString(
        activationEvidence.selectedTargetKind,
        'activationEvidence.selectedTargetKind'
    );
    if (selectedTargetKind !== 'core' && selectedTargetKind !== 'tower') {
        throw new RangeError('selectedTargetKind는 core 또는 tower여야 합니다.');
    }
    const selectedTargetEntityId = requireExactIdentityComponent(
        activationEvidence.selectedTargetEntityId
            ?? activationEvidence.selectedTargetHandle?.entityId,
        'activationEvidence.selectedTargetEntityId'
    );
    const selectedTargetIncarnation = requireExactIdentityComponent(
        activationEvidence.selectedTargetIncarnation
            ?? activationEvidence.selectedTargetHandle?.incarnation,
        'activationEvidence.selectedTargetIncarnation'
    );
    const coreTargetEntityId = requireExactIdentityComponent(
        intent.coreTargetEntityId,
        'spawnIntent.coreTargetEntityId'
    );
    const coreTargetIncarnation = requireExactIdentityComponent(
        intent.coreTargetIncarnation,
        'spawnIntent.coreTargetIncarnation'
    );
    const hasTowerEntity = intent.towerTargetEntityId !== undefined
        && intent.towerTargetEntityId !== null;
    const hasTowerIncarnation = intent.towerTargetIncarnation !== undefined
        && intent.towerTargetIncarnation !== null;
    if (hasTowerEntity !== hasTowerIncarnation) {
        throw new TypeError('selected-target Tower exact identity는 pair여야 합니다.');
    }
    const towerTargetEntityId = hasTowerEntity
        ? requireExactIdentityComponent(
            intent.towerTargetEntityId,
            'spawnIntent.towerTargetEntityId'
        )
        : null;
    const towerTargetIncarnation = hasTowerEntity
        ? requireExactIdentityComponent(
            intent.towerTargetIncarnation,
            'spawnIntent.towerTargetIncarnation'
        )
        : null;
    const selectedMatchesAuthored = selectedTargetKind === 'core'
        ? selectedTargetEntityId === coreTargetEntityId
            && selectedTargetIncarnation === coreTargetIncarnation
        : towerTargetEntityId !== null
            && selectedTargetEntityId === towerTargetEntityId
            && selectedTargetIncarnation === towerTargetIncarnation;
    if (!selectedMatchesAuthored) {
        throw new RangeError('GPU selected outcome이 authored exact candidate와 다릅니다.');
    }
    const coreDamage = requirePositiveFinite(
        intent.coreDamage,
        'spawnIntent.coreDamage'
    );
    const coreDamageFixedPoint = requireExactIdentityComponent(
        intent.coreDamageFixedPoint,
        'spawnIntent.coreDamageFixedPoint'
    );
    if (intent.requiresExactSelectedTarget !== true) {
        throw new RangeError('selected-target projectile에는 exact target policy가 필요합니다.');
    }
    const targetSelectionPolicyId = requireNonEmptyString(
        intent.targetSelectionPolicyId,
        'spawnIntent.targetSelectionPolicyId'
    );
    const distancePolicyId = requireNonEmptyString(
        intent.distancePolicyId,
        'spawnIntent.distancePolicyId'
    );
    const towerTargetPolicyId = requireNonEmptyString(
        intent.towerTargetPolicyId,
        'spawnIntent.towerTargetPolicyId'
    );
    const coreTargetPolicyId = requireNonEmptyString(
        intent.coreTargetPolicyId,
        'spawnIntent.coreTargetPolicyId'
    );
    const coreDamageRequestPolicyId = requireNonEmptyString(
        intent.coreDamageRequestPolicyId,
        'spawnIntent.coreDamageRequestPolicyId'
    );
    const selectedTargetPolicyId = requireNonEmptyString(
        activationEvidence.selectedTargetPolicyId,
        'activationEvidence.selectedTargetPolicyId'
    );
    if (intent.targetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID
                .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN
        || targetSelectionPolicyId
            !== PROJECTILE_SELECTED_TARGET_POLICY_ID
                .CORE_FIRST_IN_RANGE_THEN_TOWER
        || distancePolicyId
            !== PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
                .TICK_START_CENTER_INCLUSIVE
        || towerTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        || coreTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN
        || coreDamageRequestPolicyId
            !== PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID.TYPED_CPU_CORE_DAMAGE
        || coreDamageFixedPoint !== encodeGpuCircleBodyFixedPoint(coreDamage)
        || selectedTargetPolicyId !== (selectedTargetKind === 'core'
            ? coreTargetPolicyId
            : towerTargetPolicyId)) {
        throw new RangeError('selected-target projectile resolved policy evidence가 올바르지 않습니다.');
    }
    return {
        targetSelectionPolicyId,
        distancePolicyId,
        attackRangeTiles: requirePositiveFinite(
            intent.attackRangeTiles,
            'spawnIntent.attackRangeTiles'
        ),
        towerTargetPolicyId,
        coreTargetPolicyId,
        coreDamageRequestPolicyId,
        coreDamage,
        coreDamageFixedPoint,
        requiresExactSelectedTarget: true,
        coreTargetEntityId,
        coreTargetIncarnation,
        ...(towerTargetEntityId === null ? {} : {
            towerTargetEntityId,
            towerTargetIncarnation
        }),
        selectedTargetKind,
        selectedTargetEntityId,
        selectedTargetIncarnation,
        selectedTargetPolicyId,
        selectionSourceTick: requireExactIdentityComponent(
            activationEvidence.selectionSourceTick,
            'activationEvidence.selectionSourceTick'
        ),
        selectionSequence: requireNonNegativeSafeInteger(
            activationEvidence.selectionSequence,
            'activationEvidence.selectionSequence'
        ),
        attackFingerprint: requireExactIdentityComponent(
            activationEvidence.attackFingerprint,
            'activationEvidence.attackFingerprint'
        )
    };
}

/** 모든 GPU body producer가 공유하는 canonical immutable spawn ingress입니다. */
export function normalizeGpuSpawnIntent(source, options = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU body spawn intent가 필요합니다.');
    }
    const snapshot = materializeGpuPlainDataSnapshot(source, 'spawnIntent');
    if (Object.prototype.hasOwnProperty.call(snapshot, 'entityId')
        || Object.prototype.hasOwnProperty.call(snapshot, 'incarnation')
        || Object.prototype.hasOwnProperty.call(snapshot, 'handle')) {
        throw new TypeError('spawn identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const kindId = requireNonEmptyString(snapshot.kindId, 'spawnIntent.kindId');
    const legacyEnemyDefinitionId = snapshot.enemyDefinitionId;
    const definitionId = requireNonEmptyString(
        snapshot.definitionId ?? legacyEnemyDefinitionId,
        'spawnIntent.definitionId'
    );
    if (snapshot.definitionId !== undefined
        && legacyEnemyDefinitionId !== undefined
        && snapshot.definitionId !== legacyEnemyDefinitionId) {
        throw new RangeError(
            'spawnIntent.definitionId와 enemyDefinitionId alias가 일치해야 합니다.'
        );
    }

    const metadata = normalizeGpuCircleBodyMetadata(snapshot, {
        requireNonZeroLayers: true
    });
    const allegiancePolicy = normalizeGameplayAllegiancePolicy(
        snapshot.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        'spawnIntent.allegiancePolicy'
    );
    const teamId = resolveGameplayAllegianceTeam({
        policy: allegiancePolicy,
        teamId: snapshot.teamId,
        subjectTeamId: options.subjectTeamId
    });
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        snapshot.damagePolicyId
            ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        'spawnIntent.damagePolicyId'
    );
    const hasAnyProjectileOriginField = PROJECTILE_ORIGIN_PROVENANCE_KEYS.some(
        (key) => Object.prototype.hasOwnProperty.call(snapshot, key)
    );
    const projectileCaptureIngress = kindId === 'projectile'
        ? normalizeProjectileCaptureIngress(snapshot)
        : null;
    if (kindId !== 'projectile'
        && (snapshot.projectileCapturePolicyId !== undefined
            || hasAnyProjectileOriginField)) {
        throw new TypeError(
            'projectile capture policy/origin provenance는 projectile spawn에만 허용됩니다.'
        );
    }
    validateOptionalExactIdentityPair(snapshot, 'owner');
    validateOptionalExactIdentityPair(snapshot, 'source');
    validateOptionalExactIdentityPair(snapshot, 'target');
    const contactHandler = normalizeGpuCircleBodyContactHandler(snapshot);
    if (snapshot.spawnSequence !== undefined && snapshot.spawnSequence !== null) {
        requireNonNegativeSafeInteger(snapshot.spawnSequence, 'spawnIntent.spawnSequence');
    }
    let normalizedEffectEmitterState = null;
    let normalizedOrbitLease = null;
    let normalizedProjectileCaptureProfile = null;
    let normalizedRouteClosureMetadata = null;
    if (kindId === 'enemy') {
        const spawnPolicy = requireNonEmptyString(
            snapshot.spawnPolicy,
            'spawnIntent.spawnPolicy'
        );
        if (spawnPolicy !== ENEMY_SPAWN_POLICY.NATURAL) {
            throw new RangeError('raw Enemy spawn ingress는 natural spawnPolicy만 허용합니다.');
        }
        if (definitionId === BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
            || definitionId === BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID) {
            throw new RangeError(
                'transform-private H/HX definition은 privileged atomic-transform path만 허용합니다.'
            );
        }
        requireNonEmptyString(snapshot.gateId, 'spawnIntent.gateId');
        requireNonEmptyString(snapshot.pathId, 'spawnIntent.pathId');
        requireNonNegativeSafeInteger(snapshot.waypointIndex, 'spawnIntent.waypointIndex');
        requirePositiveFinite(snapshot.flowSpeed, 'spawnIntent.flowSpeed');
        const capabilityMask = snapshot.capabilityMask !== undefined
            && snapshot.capabilityMask !== null
            ? normalizeEnemyCapabilityMask(
                snapshot.capabilityMask,
                'spawnIntent.capabilityMask'
            )
            : null;
        normalizedProjectileCaptureProfile
            = normalizeOptionalEnemyProjectileCaptureMetadata(
                snapshot,
                capabilityMask
            );
        normalizedRouteClosureMetadata
            = normalizeOptionalEnemyRouteClosureMetadata(
                snapshot,
                capabilityMask,
                definitionId
            );
        validateRawEnemyAtomicTransformIngress(
            snapshot,
            capabilityMask,
            definitionId
        );
        normalizedEffectEmitterState = normalizeOptionalEnemyEffectEmitterState(
            snapshot,
            capabilityMask
        );
        normalizedOrbitLease = validateOptionalEnemyOrbitIngress(
            snapshot,
            capabilityMask,
            definitionId
        );
        const formationIngress = assertRawEnemyFormationIngress(
            snapshot,
            capabilityMask
        );
        if (definitionId === BASIC_HEXA_ENEMY_DEFINITION_ID) {
            assertNaturalHexaRawIntent(
                snapshot,
                capabilityMask,
                formationIngress,
                contactHandler
            );
        }
        if (definitionId === BASIC_OCTA_ENEMY_DEFINITION_ID) {
            if (normalizedOrbitLease === null) {
                throw new RangeError('natural O spawn에는 ORBIT lease ingress가 필요합니다.');
            }
            assertNaturalOctaRawIntent(
                snapshot,
                capabilityMask,
                normalizedOrbitLease
            );
        } else if (normalizedOrbitLease !== null) {
            throw new RangeError('ORBIT capability은 current natural O definition에만 허용됩니다.');
        }
    } else if (hasAnyEnemyEffectMetadata(snapshot)
        || snapshot.effectEmitterState !== undefined
        || hasAnyEnemyOrbitLeaseMetadata(snapshot)
        || hasEnemyOrbitBehaviorProgram(snapshot)
        || snapshot.projectileCaptureProfileId !== undefined
        || snapshot.projectileCaptureProfileCode !== undefined
        || snapshot.routeClosureProfileId !== undefined
        || snapshot.routeClosureProfileCode !== undefined
        || snapshot.routeSetId !== undefined
        || snapshot.routeAvailabilityVersion !== undefined
        || snapshot.routeGraphContentKey !== undefined
        || snapshot.routeRuntimeState !== undefined
        || (kindId !== 'projectile'
            && snapshot.projectileCaptureState !== undefined)) {
        throw new TypeError('Enemy capability metadata/state는 Enemy spawn에만 허용됩니다.');
    }
    const projectileCaptureState = normalizeInitialProjectileCaptureState(
        snapshot,
        kindId,
        normalizedProjectileCaptureProfile,
        projectileCaptureIngress
    );
    const {
        layerMask: _legacyLayerMask,
        sensorMask: _legacySensorMask,
        ...canonicalSnapshot
    } = snapshot;
    return Object.freeze({
        ...canonicalSnapshot,
        definitionId,
        ...(kindId === 'enemy' ? { enemyDefinitionId: definitionId } : {}),
        teamId,
        damagePolicyId,
        allegiancePolicy,
        ...metadata,
        ...(normalizedEffectEmitterState === null ? {} : {
            effectEmitterState: normalizedEffectEmitterState
        }),
        ...(normalizedProjectileCaptureProfile ?? {}),
        ...(normalizedRouteClosureMetadata ?? {}),
        ...(projectileCaptureIngress ?? {}),
        ...(projectileCaptureState === null ? {} : { projectileCaptureState }),
        contactHandler
    });
}

const TOWER_RECOVERY_ABILITY_METADATA_FIELDS = Object.freeze([
    'abilityGeneration',
    'abilityCreationOriginCode',
    'sourceAbilityCode',
    'sourceExecutionFingerprint',
    'sourceExecutionOrdinal',
    'visibleFromExecutionOrdinal',
    'actorActionCode',
    'actorActionProfileId',
    'actorActionProfileFingerprint',
    'recoveryPlacementPolicyId',
    'recoveryLogicalTowerOrdinal',
    'mapRecoveryAnchorId',
    'mapRecoveryLatticeVersion',
    'mapRecoveryAnchorX',
    'mapRecoveryAnchorY'
]);

function copyOptionalTowerRecoveryAbilityMetadata(intent) {
    const presentCount = TOWER_RECOVERY_ABILITY_METADATA_FIELDS.reduce(
        (count, field) => count + (
            intent[field] === undefined || intent[field] === null ? 0 : 1
        ),
        0
    );
    if (presentCount === 0) return {};
    if (presentCount !== TOWER_RECOVERY_ABILITY_METADATA_FIELDS.length) {
        throw new TypeError(
            'Tower recovery ability provenance field는 모두 함께 제공해야 합니다.'
        );
    }
    const logicalTowerOrdinal = requireUint32(
        intent.logicalTowerOrdinal,
        'spawnIntent.logicalTowerOrdinal',
        false
    );
    const recoveryLogicalTowerOrdinal = requireUint32(
        intent.recoveryLogicalTowerOrdinal,
        'spawnIntent.recoveryLogicalTowerOrdinal',
        false
    );
    const sourceExecutionOrdinal = requireUint32(
        intent.sourceExecutionOrdinal,
        'spawnIntent.sourceExecutionOrdinal',
        false
    );
    const visibleFromExecutionOrdinal = requireUint32(
        intent.visibleFromExecutionOrdinal,
        'spawnIntent.visibleFromExecutionOrdinal',
        false
    );
    const mapRecoveryAnchorX = Number(intent.mapRecoveryAnchorX);
    const mapRecoveryAnchorY = Number(intent.mapRecoveryAnchorY);
    if (logicalTowerOrdinal !== recoveryLogicalTowerOrdinal
        || visibleFromExecutionOrdinal !== sourceExecutionOrdinal + 1
        || !Number.isFinite(mapRecoveryAnchorX)
        || !Number.isFinite(mapRecoveryAnchorY)
        || mapRecoveryAnchorX !== Number(intent.position?.x)
        || mapRecoveryAnchorY !== Number(intent.position?.y)) {
        throw new RangeError(
            'Tower recovery ordinal/visibility/anchor provenance가 다릅니다.'
        );
    }
    return {
        logicalTowerOrdinal,
        shareUnits: requireUint32(
            intent.shareUnits,
            'spawnIntent.shareUnits',
            false
        ),
        currentHpFixedPoint: requireUint32(
            intent.currentHpFixedPoint,
            'spawnIntent.currentHpFixedPoint',
            false
        ),
        maxHpFixedPoint: requireUint32(
            intent.maxHpFixedPoint,
            'spawnIntent.maxHpFixedPoint',
            false
        ),
        powerFixedPoint: requireUint32(
            intent.powerFixedPoint,
            'spawnIntent.powerFixedPoint',
            false
        ),
        towerGroupRevision: requireUint32(
            intent.towerGroupRevision,
            'spawnIntent.towerGroupRevision',
            false
        ),
        abilityGeneration: requireUint32(
            intent.abilityGeneration,
            'spawnIntent.abilityGeneration',
            false
        ),
        abilityCreationOriginCode: requireUint32(
            intent.abilityCreationOriginCode,
            'spawnIntent.abilityCreationOriginCode',
            false
        ),
        sourceAbilityCode: requireUint32(
            intent.sourceAbilityCode,
            'spawnIntent.sourceAbilityCode',
            false
        ),
        sourceExecutionFingerprint: requireUint32(
            intent.sourceExecutionFingerprint,
            'spawnIntent.sourceExecutionFingerprint',
            false
        ),
        sourceExecutionOrdinal,
        visibleFromExecutionOrdinal,
        actorActionCode: requireUint32(
            intent.actorActionCode,
            'spawnIntent.actorActionCode',
            false
        ),
        actorActionProfileId: requireNonEmptyString(
            intent.actorActionProfileId,
            'spawnIntent.actorActionProfileId'
        ),
        actorActionProfileFingerprint: requireUint32(
            intent.actorActionProfileFingerprint,
            'spawnIntent.actorActionProfileFingerprint',
            false
        ),
        recoveryPlacementPolicyId: requireNonEmptyString(
            intent.recoveryPlacementPolicyId,
            'spawnIntent.recoveryPlacementPolicyId'
        ),
        recoveryLogicalTowerOrdinal,
        mapRecoveryAnchorId: requireNonEmptyString(
            intent.mapRecoveryAnchorId,
            'spawnIntent.mapRecoveryAnchorId'
        ),
        mapRecoveryLatticeVersion: requireUint32(
            intent.mapRecoveryLatticeVersion,
            'spawnIntent.mapRecoveryLatticeVersion',
            false
        ),
        mapRecoveryAnchorX,
        mapRecoveryAnchorY
    };
}

/** Registry가 GPU body identity와 함께 보존할 CPU domain metadata를 만듭니다. */
export function createGpuRegistryMetadata(intent, activationEvidence = null) {
    const common = {
        definitionId: intent.definitionId,
        teamId: intent.teamId,
        damagePolicyId: intent.damagePolicyId,
        allegiancePolicy: intent.allegiancePolicy,
        ownerEntityId: intent.ownerEntityId,
        ownerIncarnation: intent.ownerIncarnation,
        sourceEntityId: intent.sourceEntityId,
        sourceIncarnation: intent.sourceIncarnation,
        targetEntityId: intent.targetEntityId,
        targetIncarnation: intent.targetIncarnation,
        producerId: intent.producerId,
        sourceAbilityId: intent.sourceAbilityId,
        targetPolicyId: intent.targetPolicyId
    };
    if (intent.kindId === 'enemy') {
        return {
            ...common,
            enemyDefinitionId: intent.enemyDefinitionId,
            gateId: intent.gateId,
            pathId: intent.pathId,
            initialWaypointIndex: intent.waypointIndex,
            spawnSequence: intent.spawnSequence,
            waveId: intent.waveId,
            policyId: intent.policyId,
            // Stable capability mask, profile ID와 final resolved primitive만 보존합니다.
            // capability ID 배열이나 content object는 registry에 직렬화하지 않습니다.
            ...copyOptionalEnemyCapabilityMetadata(intent),
            ...copyOptionalEnemyProfileMetadata(intent),
            ...(intent.projectileCaptureProfileId === undefined ? {} : {
                projectileCaptureProfileId: intent.projectileCaptureProfileId,
                projectileCaptureProfileCode: intent.projectileCaptureProfileCode
            }),
            routeSetId: intent.routeSetId ?? null,
            routeAvailabilityVersion: requireUint32(
                intent.routeAvailabilityVersion ?? 1,
                'spawnIntent.routeAvailabilityVersion',
                false
            ),
            routeGraphContentKey: intent.routeGraphContentKey ?? null,
            ...(intent.routeClosureProfileId === undefined ? {} : {
                routeClosureProfileId: intent.routeClosureProfileId,
                routeClosureProfileCode: intent.routeClosureProfileCode
            }),
            ...copyOptionalEnemyAtomicTransformMetadata(intent),
            ...copyOptionalEnemyOrbitMetadata(intent),
            ...copyOptionalEnemyEffectMetadata(intent),
            ...copyOptionalEnemyFormationMetadata(intent),
            ...copyOptionalResolvedEnemyStatMetadata(intent)
        };
    }
    if (intent.kindId === 'tower') {
        return {
            ...common,
            spawnSequence: intent.spawnSequence,
            ...copyOptionalTowerRecoveryAbilityMetadata(intent)
        };
    }
    if (intent.kindId !== 'projectile') {
        return {
            ...common,
            spawnSequence: intent.spawnSequence
        };
    }
    return {
        ...common,
        spawnSequence: intent.spawnSequence,
        ...normalizeProjectileCaptureIngress(intent),
        ...copySelectedTargetProjectileMetadata(intent, activationEvidence)
    };
}
