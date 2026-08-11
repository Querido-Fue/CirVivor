import {
    FORMATION_COORDINATE_SYSTEM,
    FORMATION_COORDINATE_SYSTEM_CODE,
    FORMATION_COORDINATE_SYSTEM_CODE_BY_ID,
    normalizeFormationCoordinateSystemId
} from './enemy_formation_contract.js';

export const ENEMY_ORBIT_FIXED_TICKS_PER_SECOND = 60;
export const ENEMY_ORBIT_SLOT_CAPACITY = 8;
export const ENEMY_ORBIT_SLOT_UNASSIGNED = 0xffffffff;
export const ENEMY_ORBIT_PHASE_Q32_SCALE = 0x100000000;
export const ENEMY_DIRECTIONAL_DEFENSE_FIXED_POINT_SCALE = 100;
const CURRENT_DIRECTIONAL_DEFENSE_ARMORED_FACET_INDICES = Object.freeze([
    7,
    0,
    1
]);

export const ENEMY_ORBIT_CENTER_TARGET_POLICY = Object.freeze({
    EXACT_GPU_TOWER: 'exact-gpu-tower'
});

export const ENEMY_ORBIT_TOWER_LOSS_POLICY = Object.freeze({
    LATCH_CORE_FALLBACK: 'latch-core-fallback'
});

export const ENEMY_DIRECTIONAL_DEFENSE_BOUNDARY_POLICY = Object.freeze({
    INCLUSIVE: 'inclusive'
});

export const ENEMY_DIRECTIONAL_DEFENSE_ZERO_DIRECTION_POLICY = Object.freeze({
    NORMAL_DAMAGE: 'normal-damage'
});

export const ENEMY_ORBIT_LEASE_METADATA_FIELDS = Object.freeze([
    'orbitCoordinateSystemId',
    'orbitCoordinateSystemCode',
    'orbitSlotIndex',
    'orbitSlotCapacity'
]);

const ORBIT_PROFILE_KEYS = new Set([
    'coordinateSystemId',
    'coordinateSystemCode',
    'orbitRadiusTiles',
    'angularSpeedRadiansPerSecond',
    'fixedTicksPerSecond',
    'slotCapacity',
    'slotFillOrder',
    'centerTargetPolicy',
    'towerLossPolicy'
]);
const DIRECTIONAL_DEFENSE_PROFILE_KEYS = new Set([
    'totalFacetCount',
    'armoredFacetCount',
    'armoredFacetIndices',
    'flatReduction',
    'flatReductionFixedPoint',
    'minimumDamage',
    'minimumDamageFixedPoint',
    'boundaryPolicy',
    'zeroDirectionPolicy'
]);
const VALID_CENTER_TARGET_POLICIES = new Set(
    Object.values(ENEMY_ORBIT_CENTER_TARGET_POLICY)
);
const VALID_TOWER_LOSS_POLICIES = new Set(
    Object.values(ENEMY_ORBIT_TOWER_LOSS_POLICY)
);
const VALID_BOUNDARY_POLICIES = new Set(
    Object.values(ENEMY_DIRECTIONAL_DEFENSE_BOUNDARY_POLICY)
);
const VALID_ZERO_DIRECTION_POLICIES = new Set(
    Object.values(ENEMY_DIRECTIONAL_DEFENSE_ZERO_DIRECTION_POLICY)
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

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || !(value > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return value;
}

function requirePositiveFloat32(value, label) {
    const normalized = Math.fround(requirePositiveFinite(value, label));
    if (!Number.isFinite(normalized) || !(normalized > 0)) {
        throw new RangeError(`${label}은 양의 유한 float32로 표현 가능해야 합니다.`);
    }
    return normalized;
}

function requireNonNegativeFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label, maximum = 0xffffffff) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > maximum) {
        throw new RangeError(`${label}은 1..${maximum} 범위의 정수여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function requireKnownString(value, vocabulary, label) {
    const normalized = requireNonEmptyString(value, label);
    if (!vocabulary.has(normalized)) {
        throw new RangeError(`${label}은 알려진 policy여야 합니다.`);
    }
    return normalized;
}

function assertKnownKeys(source, knownKeys, label) {
    for (const key of Object.keys(source)) {
        if (!knownKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
}

function normalizeOrderedUniqueIndices(source, count, maximum, label) {
    if (!Array.isArray(source) || source.length !== count) {
        throw new TypeError(`${label}는 ${count}개 facet index 배열이어야 합니다.`);
    }
    const seen = new Set();
    const indices = source.map((value, index) => {
        const normalized = requireUint32(value, `${label}[${index}]`);
        if (normalized >= maximum || seen.has(normalized)) {
            throw new RangeError(`${label}[${index}]가 facet 범위를 벗어났거나 중복됩니다.`);
        }
        seen.add(normalized);
        return normalized;
    });
    for (let index = 1; index < indices.length; index++) {
        if (indices[index] !== (indices[index - 1] + 1) % maximum) {
            throw new RangeError(`${label}는 순환 순서의 연속 facet이어야 합니다.`);
        }
    }
    return Object.freeze(indices);
}

function normalizeSlotFillOrder(source, slotCapacity, label) {
    if (!Array.isArray(source) || source.length !== slotCapacity) {
        throw new TypeError(`${label}는 slotCapacity와 같은 길이의 배열이어야 합니다.`);
    }
    const seen = new Set();
    const order = source.map((value, index) => {
        const slotIndex = requireUint32(value, `${label}[${index}]`);
        if (slotIndex >= slotCapacity || seen.has(slotIndex)) {
            throw new RangeError(`${label}는 0..slotCapacity-1 permutation이어야 합니다.`);
        }
        seen.add(slotIndex);
        return slotIndex;
    });
    return Object.freeze(order);
}

/** Gameplay damage f32×100→trunc 규칙으로 flat reduction을 centi int32로 만듭니다. */
export function encodeEnemyDirectionalDefenseFixedPoint(
    value,
    label = 'flatReduction'
) {
    const authored = Math.fround(requireNonNegativeFinite(value, label));
    const scaled = Math.fround(
        authored * Math.fround(ENEMY_DIRECTIONAL_DEFENSE_FIXED_POINT_SCALE)
    );
    const fixedPoint = Math.trunc(scaled);
    if (fixedPoint < 0 || fixedPoint > 0x7fffffff) {
        throw new RangeError(`${label}의 fixed-point 결과가 signed int32를 벗어났습니다.`);
    }
    return fixedPoint;
}

/** rad/s를 60Hz turns-per-tick unsigned Q32 phase step으로 한 번 materialize합니다. */
export function encodeEnemyOrbitAngularStepQ32(
    angularSpeedRadiansPerSecond,
    fixedTicksPerSecond = ENEMY_ORBIT_FIXED_TICKS_PER_SECOND
) {
    const angularSpeed = requirePositiveFloat32(
        angularSpeedRadiansPerSecond,
        'angularSpeedRadiansPerSecond'
    );
    const fixedTickRate = requirePositiveSafeInteger(
        fixedTicksPerSecond,
        'fixedTicksPerSecond'
    );
    if (fixedTickRate !== ENEMY_ORBIT_FIXED_TICKS_PER_SECOND) {
        throw new RangeError(
            `Enemy orbit fixedTicksPerSecond는 ${ENEMY_ORBIT_FIXED_TICKS_PER_SECOND}여야 합니다.`
        );
    }
    const phaseStep = Math.round(
        (angularSpeed / (Math.PI * 2 * fixedTickRate))
            * ENEMY_ORBIT_PHASE_Q32_SCALE
    );
    if (!Number.isSafeInteger(phaseStep)
        || phaseStep <= 0
        || phaseStep >= ENEMY_ORBIT_SLOT_UNASSIGNED) {
        throw new RangeError('Enemy orbit angular Q32 step이 valid non-sentinel uint32여야 합니다.');
    }
    return phaseStep >>> 0;
}

export function normalizeEnemyOrbitProfile(source, label = 'enemyOrbitProfile') {
    if (source === undefined || source === null) {
        return null;
    }
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, ORBIT_PROFILE_KEYS, label);
    const coordinateSystemId = normalizeFormationCoordinateSystemId(
        profile.coordinateSystemId,
        `${label}.coordinateSystemId`
    );
    const coordinateSystemCode = requireUint32(
        profile.coordinateSystemCode,
        `${label}.coordinateSystemCode`
    );
    if (coordinateSystemId !== FORMATION_COORDINATE_SYSTEM.RING_SLOTS
        || coordinateSystemCode !== FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS
        || FORMATION_COORDINATE_SYSTEM_CODE_BY_ID[coordinateSystemId]
            !== coordinateSystemCode) {
        throw new RangeError(`${label}는 exact RING_SLOTS coordinate system을 사용해야 합니다.`);
    }
    const fixedTicksPerSecond = requirePositiveSafeInteger(
        profile.fixedTicksPerSecond,
        `${label}.fixedTicksPerSecond`
    );
    if (fixedTicksPerSecond !== ENEMY_ORBIT_FIXED_TICKS_PER_SECOND) {
        throw new RangeError(
            `${label}.fixedTicksPerSecond는 ${ENEMY_ORBIT_FIXED_TICKS_PER_SECOND}여야 합니다.`
        );
    }
    const slotCapacity = requirePositiveSafeInteger(
        profile.slotCapacity,
        `${label}.slotCapacity`,
        31
    );
    if (slotCapacity !== ENEMY_ORBIT_SLOT_CAPACITY) {
        throw new RangeError(
            `${label}.slotCapacity는 ${ENEMY_ORBIT_SLOT_CAPACITY}이어야 합니다.`
        );
    }
    const angularSpeedRadiansPerSecond = requirePositiveFloat32(
        profile.angularSpeedRadiansPerSecond,
        `${label}.angularSpeedRadiansPerSecond`
    );
    encodeEnemyOrbitAngularStepQ32(
        angularSpeedRadiansPerSecond,
        fixedTicksPerSecond
    );
    return Object.freeze({
        coordinateSystemId,
        coordinateSystemCode,
        orbitRadiusTiles: requirePositiveFloat32(
            profile.orbitRadiusTiles,
            `${label}.orbitRadiusTiles`
        ),
        angularSpeedRadiansPerSecond,
        fixedTicksPerSecond,
        slotCapacity,
        slotFillOrder: normalizeSlotFillOrder(
            profile.slotFillOrder,
            slotCapacity,
            `${label}.slotFillOrder`
        ),
        centerTargetPolicy: requireKnownString(
            profile.centerTargetPolicy,
            VALID_CENTER_TARGET_POLICIES,
            `${label}.centerTargetPolicy`
        ),
        towerLossPolicy: requireKnownString(
            profile.towerLossPolicy,
            VALID_TOWER_LOSS_POLICIES,
            `${label}.towerLossPolicy`
        )
    });
}

export function normalizeEnemyDirectionalDefenseProfile(
    source,
    label = 'enemyDirectionalDefenseProfile'
) {
    if (source === undefined || source === null) {
        return null;
    }
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, DIRECTIONAL_DEFENSE_PROFILE_KEYS, label);
    const totalFacetCount = requirePositiveSafeInteger(
        profile.totalFacetCount,
        `${label}.totalFacetCount`,
        32
    );
    const armoredFacetCount = requirePositiveSafeInteger(
        profile.armoredFacetCount,
        `${label}.armoredFacetCount`,
        totalFacetCount
    );
    if (totalFacetCount !== ENEMY_ORBIT_SLOT_CAPACITY
        || armoredFacetCount
            !== CURRENT_DIRECTIONAL_DEFENSE_ARMORED_FACET_INDICES.length) {
        throw new RangeError(
            `${label}의 current directional defense는 exact 3/8 facet이어야 합니다.`
        );
    }
    const armoredFacetIndices = normalizeOrderedUniqueIndices(
        profile.armoredFacetIndices,
        armoredFacetCount,
        totalFacetCount,
        `${label}.armoredFacetIndices`
    );
    if (armoredFacetIndices.some((facetIndex, index) => (
        facetIndex !== CURRENT_DIRECTIONAL_DEFENSE_ARMORED_FACET_INDICES[index]
    ))) {
        throw new RangeError(
            `${label}.armoredFacetIndices는 exact front-facing [7,0,1]이어야 합니다.`
        );
    }
    const flatReduction = requirePositiveFloat32(
        profile.flatReduction,
        `${label}.flatReduction`
    );
    if (profile.minimumDamage !== null) {
        throw new RangeError(
            `${label}.minimumDamage는 current no-minimum runtime에서 null이어야 합니다.`
        );
    }
    const minimumDamage = null;
    const flatReductionFixedPoint = encodeEnemyDirectionalDefenseFixedPoint(
        flatReduction,
        `${label}.flatReduction`
    );
    if (flatReductionFixedPoint <= 0) {
        throw new RangeError(
            `${label}.flatReduction은 positive centi fixed-point로 표현 가능해야 합니다.`
        );
    }
    const minimumDamageFixedPoint = null;
    if (profile.flatReductionFixedPoint !== undefined
        && profile.flatReductionFixedPoint !== flatReductionFixedPoint) {
        throw new RangeError(`${label}.flatReductionFixedPoint가 derived value와 다릅니다.`);
    }
    if (profile.minimumDamageFixedPoint !== undefined
        && profile.minimumDamageFixedPoint !== minimumDamageFixedPoint) {
        throw new RangeError(`${label}.minimumDamageFixedPoint가 derived value와 다릅니다.`);
    }
    return Object.freeze({
        totalFacetCount,
        armoredFacetCount,
        armoredFacetIndices,
        flatReduction,
        flatReductionFixedPoint,
        minimumDamage,
        minimumDamageFixedPoint,
        boundaryPolicy: requireKnownString(
            profile.boundaryPolicy,
            VALID_BOUNDARY_POLICIES,
            `${label}.boundaryPolicy`
        ),
        zeroDirectionPolicy: requireKnownString(
            profile.zeroDirectionPolicy,
            VALID_ZERO_DIRECTION_POLICIES,
            `${label}.zeroDirectionPolicy`
        )
    });
}

export function hasAnyEnemyOrbitLeaseMetadata(source) {
    return source !== null
        && typeof source === 'object'
        && ENEMY_ORBIT_LEASE_METADATA_FIELDS.some((field) => (
            Object.prototype.hasOwnProperty.call(source, field)
        ));
}

/** WorldRegistry와 spawn behavior가 공유하는 primitive RING_SLOTS lease를 검증합니다. */
export function normalizeEnemyOrbitSlotLease(
    source,
    options = {}
) {
    const label = options.label ?? 'enemyOrbitSlotLease';
    const lease = requirePlainObject(source, label);
    for (const field of ENEMY_ORBIT_LEASE_METADATA_FIELDS) {
        if (lease[field] === undefined || lease[field] === null) {
            throw new TypeError(`${label}.${field}가 필요합니다.`);
        }
    }
    const coordinateSystemId = normalizeFormationCoordinateSystemId(
        lease.orbitCoordinateSystemId,
        `${label}.orbitCoordinateSystemId`
    );
    const coordinateSystemCode = requireUint32(
        lease.orbitCoordinateSystemCode,
        `${label}.orbitCoordinateSystemCode`
    );
    if (coordinateSystemId !== FORMATION_COORDINATE_SYSTEM.RING_SLOTS
        || coordinateSystemCode !== FORMATION_COORDINATE_SYSTEM_CODE.RING_SLOTS
        || FORMATION_COORDINATE_SYSTEM_CODE_BY_ID[coordinateSystemId]
            !== coordinateSystemCode) {
        throw new RangeError(`${label}는 exact RING_SLOTS coordinate system이어야 합니다.`);
    }
    const slotCapacity = requirePositiveSafeInteger(
        lease.orbitSlotCapacity,
        `${label}.orbitSlotCapacity`,
        31
    );
    if (slotCapacity !== ENEMY_ORBIT_SLOT_CAPACITY
        || (options.expectedSlotCapacity !== undefined
            && slotCapacity !== options.expectedSlotCapacity)) {
        throw new RangeError(`${label}.orbitSlotCapacity가 exact data contract와 다릅니다.`);
    }
    const slotIndex = requireUint32(
        lease.orbitSlotIndex,
        `${label}.orbitSlotIndex`
    );
    const allowUnassigned = options.allowUnassigned === true;
    if (slotIndex === ENEMY_ORBIT_SLOT_UNASSIGNED) {
        if (!allowUnassigned) {
            throw new RangeError(`${label}.orbitSlotIndex가 materialize되지 않았습니다.`);
        }
    } else if (slotIndex >= slotCapacity) {
        throw new RangeError(`${label}.orbitSlotIndex가 slot capacity를 벗어났습니다.`);
    }
    return Object.freeze({
        orbitCoordinateSystemId: coordinateSystemId,
        orbitCoordinateSystemCode: coordinateSystemCode,
        orbitSlotIndex: slotIndex,
        orbitSlotCapacity: slotCapacity
    });
}
