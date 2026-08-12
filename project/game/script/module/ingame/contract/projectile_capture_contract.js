import {
    GAMEPLAY_TEAM_ID,
    normalizeGameplayTeamId
} from './gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID,
    normalizeProjectileTargetPolicyId
} from './projectile_target_policy_contract.js';

const INVALID_UINT32_COMPONENT = 0xffffffff;

/** Projectile definition이 R funnel capture에 참여할 수 있는지 나타내는 안정 ID입니다. */
export const PROJECTILE_CAPTURE_POLICY_ID = Object.freeze({
    NOT_CAPTURABLE: 'not-capturable',
    CAPTURABLE: 'capturable'
});

export const PROJECTILE_CAPTURE_FUNNEL_BOUNDARY_POLICY = Object.freeze({
    INCLUSIVE: 'inclusive'
});

export const PROJECTILE_CAPTURE_FUNNEL_FACING_POLICY = Object.freeze({
    LAST_NONZERO_ROUTE_VELOCITY: 'last-nonzero-route-velocity'
});

export const PROJECTILE_CAPTURE_FUNNEL_APPROACH_POLICY = Object.freeze({
    RELATIVE_VELOCITY_STRICTLY_CLOSING:
        'relative-velocity-strictly-closing'
});

export const PROJECTILE_CAPTURE_VISIBILITY_POLICY = Object.freeze({
    HIDDEN: 'hidden'
});

export const PROJECTILE_CAPTURE_LIFETIME_POLICY = Object.freeze({
    CONTINUE_WHILE_CAPTURED: 'continue-while-captured'
});

export const PROJECTILE_CAPTURE_RELEASE_SPEED_POLICY = Object.freeze({
    PRESERVE_CAPTURED_SPEED: 'preserve-captured-speed'
});

export const PROJECTILE_CAPTURE_RELEASE_AIM_POLICY = Object.freeze({
    EXACT_LIVING_TOWER_THEN_STORED_FORWARD:
        'exact-living-tower-then-stored-forward'
});

export const PROJECTILE_CAPTURE_EXIT_POLICY = Object.freeze({
    CAPTOR_FORWARD_OUTSIDE_RADII: 'captor-forward-outside-radii'
});

export const PROJECTILE_CAPTURE_CAPTOR_DEATH_POLICY = Object.freeze({
    RELEASE_HOSTILE_FORWARD: 'RELEASE_HOSTILE_FORWARD'
});

export const PROJECTILE_CAPTURE_CAPTOR_CORE_IMPACT_POLICY = Object.freeze({
    RELEASE_HOSTILE_FORWARD: 'RELEASE_HOSTILE_FORWARD'
});

export const PROJECTILE_CAPTURE_PROJECTILE_DEATH_POLICY = Object.freeze({
    CLEAR_SLOT_NO_RELEASE: 'CLEAR_SLOT_NO_RELEASE'
});

export const PROJECTILE_CAPTURE_TERMINAL_POLICY = Object.freeze({
    TOMBSTONE_HELD_UNPUBLISHED: 'TOMBSTONE_HELD_UNPUBLISHED'
});

export const PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION = 1;

export const PROJECTILE_LOGICAL_METADATA_KEYS = Object.freeze([
    'archetypeId',
    'wordTagMask',
    'modifierSetId',
    'sourceExecutionId',
    'projectileGeneration'
]);

export const PROJECTILE_ORIGIN_PROVENANCE_KEYS = Object.freeze([
    'schemaVersion',
    ...PROJECTILE_LOGICAL_METADATA_KEYS,
    'originProducerId',
    'originSourceAbilityId',
    'originOwnerEntityId',
    'originOwnerIncarnation',
    'originSourceEntityId',
    'originSourceIncarnation',
    'originTargetEntityId',
    'originTargetIncarnation'
]);

const CAPTURE_PROFILE_KEYS = Object.freeze([
    'id',
    'definitionCode',
    'slotCapacity',
    'captureDelayFixedTicks',
    'captureTeamId',
    'funnelHalfAngleRadians',
    'funnelBoundaryPolicy',
    'funnelFacingPolicy',
    'funnelApproachPolicy',
    'capturedVisibilityPolicy',
    'capturedLifetimePolicy',
    'releaseTeamId',
    'releaseSpeedPolicy',
    'releaseAimPolicy',
    'releaseTargetPolicyId',
    'exitPolicy',
    'exitClearanceTiles',
    'captorDeathPolicy',
    'captorCoreImpactPolicy',
    'projectileDeathPolicy',
    'terminalPolicy'
]);

const POLICY_VALUE_BY_FIELD = Object.freeze({
    funnelBoundaryPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_FUNNEL_BOUNDARY_POLICY
    )),
    funnelFacingPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_FUNNEL_FACING_POLICY
    )),
    funnelApproachPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_FUNNEL_APPROACH_POLICY
    )),
    capturedVisibilityPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_VISIBILITY_POLICY
    )),
    capturedLifetimePolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_LIFETIME_POLICY
    )),
    releaseSpeedPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_RELEASE_SPEED_POLICY
    )),
    releaseAimPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_RELEASE_AIM_POLICY
    )),
    exitPolicy: new Set(Object.values(PROJECTILE_CAPTURE_EXIT_POLICY)),
    captorDeathPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_CAPTOR_DEATH_POLICY
    )),
    captorCoreImpactPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_CAPTOR_CORE_IMPACT_POLICY
    )),
    projectileDeathPolicy: new Set(Object.values(
        PROJECTILE_CAPTURE_PROJECTILE_DEATH_POLICY
    )),
    terminalPolicy: new Set(Object.values(PROJECTILE_CAPTURE_TERMINAL_POLICY))
});

const VALID_PROJECTILE_CAPTURE_POLICY_IDS = new Set(
    Object.values(PROJECTILE_CAPTURE_POLICY_ID)
);

function requirePlainObject(value, label) {
    const prototype = value && typeof value === 'object'
        ? Object.getPrototypeOf(value)
        : null;
    const isPlainObject = prototype === null
        || (prototype !== null && Object.getPrototypeOf(prototype) === null);
    if (!value || typeof value !== 'object' || !isPlainObject) {
        throw new TypeError(`${label}은 plain object여야 합니다.`);
    }
    return value;
}

/** getter를 실행하지 않고 exact own data-property snapshot을 만듭니다. */
function snapshotExactOwnDataProperties(source, expectedKeys, label) {
    requirePlainObject(source, label);
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(
            `${label}은 exact ${expectedKeys.join('/')} data property만 가져야 합니다.`
        );
    }
    const snapshot = Object.create(null);
    for (const key of expectedKeys) {
        const descriptor = descriptors[key];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 getter/setter일 수 없습니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function snapshotExactDenseArray(source, label) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 projectile capture profile 배열이어야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const lengthDescriptor = descriptors.length;
    const length = lengthDescriptor?.value;
    if (!Number.isSafeInteger(length) || length <= 0) {
        throw new RangeError(`${label}은 하나 이상의 profile을 가져야 합니다.`);
    }
    const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        'length'
    ];
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(`${label}은 extra property 없는 dense 배열이어야 합니다.`);
    }
    return Object.freeze(Array.from({ length }, (_, index) => {
        const descriptor = descriptors[index];
        if (!descriptor
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            throw new TypeError(`${label}[${index}]는 getter/setter일 수 없습니다.`);
        }
        return descriptor.value;
    }));
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeNullableString(value, label) {
    return value === null
        ? null
        : requireNonEmptyString(value, label);
}

function requireUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return value;
}

function requirePositiveUint32(value, label) {
    const number = requireUint32(value, label);
    if (number === 0 || number === INVALID_UINT32_COMPONENT) {
        throw new RangeError(`${label}은 positive non-sentinel uint32여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return value;
}

function requirePolicy(value, field, label) {
    const policy = requireNonEmptyString(value, `${label}.${field}`);
    if (!POLICY_VALUE_BY_FIELD[field].has(policy)) {
        throw new RangeError(`${label}.${field}는 알려진 projectile capture policy여야 합니다.`);
    }
    return policy;
}

function normalizeNullableExactHandlePair(entityId, incarnation, label) {
    if (entityId === null && incarnation === null) {
        return Object.freeze({ entityId: null, incarnation: null });
    }
    if (entityId === null || incarnation === null) {
        throw new RangeError(`${label} entityId/incarnation은 함께 null이거나 함께 live여야 합니다.`);
    }
    return Object.freeze({
        entityId: requirePositiveUint32(entityId, `${label}.entityId`),
        incarnation: requirePositiveUint32(incarnation, `${label}.incarnation`)
    });
}

export function normalizeProjectileCapturePolicyId(
    value,
    label = 'projectileCapturePolicyId'
) {
    const policyId = requireNonEmptyString(value, label);
    if (!VALID_PROJECTILE_CAPTURE_POLICY_IDS.has(policyId)) {
        throw new RangeError(`${label}은 알려진 projectile capture policy ID여야 합니다.`);
    }
    return policyId;
}

/** Definition-owned logical identity metadata를 immutable primitive record로 만듭니다. */
export function normalizeProjectileLogicalMetadata(
    source,
    label = 'projectileLogicalMetadata'
) {
    const metadata = snapshotExactOwnDataProperties(
        source,
        PROJECTILE_LOGICAL_METADATA_KEYS,
        label
    );
    return Object.freeze({
        archetypeId: requireNonEmptyString(
            metadata.archetypeId,
            `${label}.archetypeId`
        ),
        wordTagMask: requireUint32(metadata.wordTagMask, `${label}.wordTagMask`),
        modifierSetId: normalizeNullableString(
            metadata.modifierSetId,
            `${label}.modifierSetId`
        ),
        sourceExecutionId: normalizeNullableString(
            metadata.sourceExecutionId,
            `${label}.sourceExecutionId`
        ),
        projectileGeneration: requirePositiveUint32(
            metadata.projectileGeneration,
            `${label}.projectileGeneration`
        )
    });
}

/**
 * 최초 spawn에서 한 번 물질화하는 immutable origin provenance입니다. Capture/release는
 * current owner/source/target/team을 바꾸더라도 이 record를 byte-equivalent 보존합니다.
 */
export function normalizeProjectileOriginProvenance(
    source,
    label = 'projectileOriginProvenance'
) {
    const provenance = snapshotExactOwnDataProperties(
        source,
        PROJECTILE_ORIGIN_PROVENANCE_KEYS,
        label
    );
    if (provenance.schemaVersion !== PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION) {
        throw new RangeError(
            `${label}.schemaVersion은 ${PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION}이어야 합니다.`
        );
    }
    const logicalMetadata = normalizeProjectileLogicalMetadata({
        archetypeId: provenance.archetypeId,
        wordTagMask: provenance.wordTagMask,
        modifierSetId: provenance.modifierSetId,
        sourceExecutionId: provenance.sourceExecutionId,
        projectileGeneration: provenance.projectileGeneration
    }, `${label}.logicalMetadata`);
    const owner = normalizeNullableExactHandlePair(
        provenance.originOwnerEntityId,
        provenance.originOwnerIncarnation,
        `${label}.originOwner`
    );
    const sourceHandle = normalizeNullableExactHandlePair(
        provenance.originSourceEntityId,
        provenance.originSourceIncarnation,
        `${label}.originSource`
    );
    const target = normalizeNullableExactHandlePair(
        provenance.originTargetEntityId,
        provenance.originTargetIncarnation,
        `${label}.originTarget`
    );
    return Object.freeze({
        schemaVersion: PROJECTILE_ORIGIN_PROVENANCE_SCHEMA_VERSION,
        ...logicalMetadata,
        originProducerId: normalizeNullableString(
            provenance.originProducerId,
            `${label}.originProducerId`
        ),
        originSourceAbilityId: normalizeNullableString(
            provenance.originSourceAbilityId,
            `${label}.originSourceAbilityId`
        ),
        originOwnerEntityId: owner.entityId,
        originOwnerIncarnation: owner.incarnation,
        originSourceEntityId: sourceHandle.entityId,
        originSourceIncarnation: sourceHandle.incarnation,
        originTargetEntityId: target.entityId,
        originTargetIncarnation: target.incarnation
    });
}

export function normalizeEnemyProjectileCaptureProfile(
    source,
    label = 'enemyProjectileCaptureProfile'
) {
    const profile = snapshotExactOwnDataProperties(
        source,
        CAPTURE_PROFILE_KEYS,
        label
    );
    const funnelHalfAngleRadians = requirePositiveFinite(
        profile.funnelHalfAngleRadians,
        `${label}.funnelHalfAngleRadians`
    );
    if (!(funnelHalfAngleRadians < Math.PI)) {
        throw new RangeError(`${label}.funnelHalfAngleRadians는 PI보다 작아야 합니다.`);
    }
    const captureTeamId = normalizeGameplayTeamId(
        profile.captureTeamId,
        `${label}.captureTeamId`
    );
    const releaseTeamId = normalizeGameplayTeamId(
        profile.releaseTeamId,
        `${label}.releaseTeamId`
    );
    if (captureTeamId !== GAMEPLAY_TEAM_ID.PLAYER
        || releaseTeamId !== GAMEPLAY_TEAM_ID.HOSTILE) {
        throw new RangeError(
            `${label}은 PLAYER capture → HOSTILE release team 전이를 사용해야 합니다.`
        );
    }
    const releaseTargetPolicyId = normalizeProjectileTargetPolicyId(
        profile.releaseTargetPolicyId,
        `${label}.releaseTargetPolicyId`
    );
    if (releaseTargetPolicyId
        !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN) {
        throw new RangeError(
            `${label}.releaseTargetPolicyId는 PLAYER_DAMAGEABLE_AND_TERRAIN이어야 합니다.`
        );
    }
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        definitionCode: requirePositiveUint32(
            profile.definitionCode,
            `${label}.definitionCode`
        ),
        slotCapacity: requirePositiveUint32(
            profile.slotCapacity,
            `${label}.slotCapacity`
        ),
        captureDelayFixedTicks: requirePositiveUint32(
            profile.captureDelayFixedTicks,
            `${label}.captureDelayFixedTicks`
        ),
        captureTeamId,
        funnelHalfAngleRadians,
        funnelBoundaryPolicy: requirePolicy(
            profile.funnelBoundaryPolicy,
            'funnelBoundaryPolicy',
            label
        ),
        funnelFacingPolicy: requirePolicy(
            profile.funnelFacingPolicy,
            'funnelFacingPolicy',
            label
        ),
        funnelApproachPolicy: requirePolicy(
            profile.funnelApproachPolicy,
            'funnelApproachPolicy',
            label
        ),
        capturedVisibilityPolicy: requirePolicy(
            profile.capturedVisibilityPolicy,
            'capturedVisibilityPolicy',
            label
        ),
        capturedLifetimePolicy: requirePolicy(
            profile.capturedLifetimePolicy,
            'capturedLifetimePolicy',
            label
        ),
        releaseTeamId,
        releaseSpeedPolicy: requirePolicy(
            profile.releaseSpeedPolicy,
            'releaseSpeedPolicy',
            label
        ),
        releaseAimPolicy: requirePolicy(
            profile.releaseAimPolicy,
            'releaseAimPolicy',
            label
        ),
        releaseTargetPolicyId,
        exitPolicy: requirePolicy(profile.exitPolicy, 'exitPolicy', label),
        exitClearanceTiles: requirePositiveFinite(
            profile.exitClearanceTiles,
            `${label}.exitClearanceTiles`
        ),
        captorDeathPolicy: requirePolicy(
            profile.captorDeathPolicy,
            'captorDeathPolicy',
            label
        ),
        captorCoreImpactPolicy: requirePolicy(
            profile.captorCoreImpactPolicy,
            'captorCoreImpactPolicy',
            label
        ),
        projectileDeathPolicy: requirePolicy(
            profile.projectileDeathPolicy,
            'projectileDeathPolicy',
            label
        ),
        terminalPolicy: requirePolicy(
            profile.terminalPolicy,
            'terminalPolicy',
            label
        )
    });
}

export function normalizeEnemyProjectileCaptureProfileCatalog(
    source,
    label = 'enemyProjectileCaptureProfileCatalog'
) {
    const catalog = snapshotExactOwnDataProperties(source, ['profiles'], label);
    const sources = snapshotExactDenseArray(catalog.profiles, `${label}.profiles`);
    const profiles = [];
    const profileById = Object.create(null);
    const profileByCode = Object.create(null);
    for (let index = 0; index < sources.length; index++) {
        const profile = normalizeEnemyProjectileCaptureProfile(
            sources[index],
            `${label}.profiles[${index}]`
        );
        if (Object.prototype.hasOwnProperty.call(profileById, profile.id)) {
            throw new RangeError(`${label}에 중복 profile ID가 있습니다: ${profile.id}`);
        }
        if (Object.prototype.hasOwnProperty.call(
            profileByCode,
            profile.definitionCode
        )) {
            throw new RangeError(
                `${label}에 중복 definition code가 있습니다: ${profile.definitionCode}`
            );
        }
        profiles.push(profile);
        profileById[profile.id] = profile;
        profileByCode[profile.definitionCode] = profile;
    }
    return Object.freeze({
        profiles: Object.freeze(profiles),
        profileById: Object.freeze(profileById),
        profileByCode: Object.freeze(profileByCode)
    });
}
