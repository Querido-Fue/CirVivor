import {
    ENEMY_CAPABILITY_ID
} from 'ingame/contract/enemy_capability_contract.js';
import {
    ENEMY_SPAWN_POLICY
} from 'ingame/contract/enemy_profile_contract.js';
import {
    HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID
} from './enemy_formation_catalog_data.js';
import {
    HEXA_KEEP_FORMATION_BEHAVIOR_PROFILE_ID,
    HEXA_SEEK_FORMATION_BEHAVIOR_PROFILE_ID,
    MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID
} from './enemy_profile_catalog_data.js';
import {
    createMainGpuEnemyDefinition
} from './main_gpu_enemy_definition_data.js';

export const BASIC_HEXA_ENEMY_DEFINITION_ID = 'basic_hexa_01';
export const BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID = 'basic_hexa_group_01';
export const BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID = 'basic_hexa_hive_01';
export const BASIC_HEXA_MINIMUM_MEMBER_COUNT = 1;
export const BASIC_HEXA_MAXIMUM_MEMBER_COUNT = 6;

export const BASIC_HEXA_FORMATION_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT,
    ENEMY_CAPABILITY_ID.FORMATION,
    ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM
]);

export const BASIC_HEXA_HIVE_CAPABILITY_IDS = Object.freeze([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT,
    ENEMY_CAPABILITY_ID.FORMATION
]);

/**
 * R2 H/HX의 raw immutable n-table입니다. 이 값은 authoring authority이며 여기서
 * float32로 반올림하지 않습니다. `resolveBasicHexaFormationStats()`가 GPU 경계에서
 * 각 최종 값에 정확히 한 번만 float32 quantization을 적용합니다.
 */
export const BASIC_HEXA_RAW_STATS_BY_MEMBER_COUNT = Object.freeze([
    null,
    Object.freeze({
        memberCount: 1,
        towerContactDamage: 0.1,
        moveSpeedTilesPerSecond: 2.5,
        weight: 1,
        bountyBudget: 1,
        coreImpactDamage: 1
    }),
    Object.freeze({
        memberCount: 2,
        towerContactDamage: 0.12,
        moveSpeedTilesPerSecond: 2.25,
        weight: 2,
        bountyBudget: 2,
        coreImpactDamage: 1
    }),
    Object.freeze({
        memberCount: 3,
        towerContactDamage: 0.144,
        moveSpeedTilesPerSecond: 2.025,
        weight: 4,
        bountyBudget: 4,
        coreImpactDamage: 1
    }),
    Object.freeze({
        memberCount: 4,
        towerContactDamage: 0.1728,
        moveSpeedTilesPerSecond: 1.8225,
        weight: 8,
        bountyBudget: 6,
        coreImpactDamage: 1
    }),
    Object.freeze({
        memberCount: 5,
        towerContactDamage: 0.20736,
        moveSpeedTilesPerSecond: 1.64025,
        weight: 16,
        bountyBudget: 8,
        coreImpactDamage: 1
    }),
    Object.freeze({
        memberCount: 6,
        towerContactDamage: 0.248832,
        moveSpeedTilesPerSecond: 1.476225,
        weight: 32,
        bountyBudget: 10,
        coreImpactDamage: 1
    })
]);

function requireHexaMemberCount(value, label = 'memberCount') {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < BASIC_HEXA_MINIMUM_MEMBER_COUNT
        || value > BASIC_HEXA_MAXIMUM_MEMBER_COUNT) {
        throw new RangeError(
            `${label}는 ${BASIC_HEXA_MINIMUM_MEMBER_COUNT}..`
                + `${BASIC_HEXA_MAXIMUM_MEMBER_COUNT} 범위의 정수여야 합니다.`
        );
    }
    return value;
}

/** n별 final GPU-bound stats를 한 번만 float32로 materialize합니다. */
export function resolveBasicHexaFormationStats(memberCount) {
    const count = requireHexaMemberCount(memberCount);
    const raw = BASIC_HEXA_RAW_STATS_BY_MEMBER_COUNT[count];
    const weight = Math.fround(raw.weight);
    return Object.freeze({
        memberCount: count,
        moveSpeedTilesPerSecond: Math.fround(raw.moveSpeedTilesPerSecond),
        weight,
        inverseMass: Math.fround(1 / weight),
        towerContactDamage: Math.fround(raw.towerContactDamage),
        coreImpactDamage: raw.coreImpactDamage,
        bountyBudget: raw.bountyBudget
    });
}

const SIGNED_INT32_MAXIMUM = 0x7fffffff;

function requirePositiveCentiHealth(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value <= 0
        || value > SIGNED_INT32_MAXIMUM) {
        throw new RangeError(`${label}는 positive signed-int32 centi-HP여야 합니다.`);
    }
    return value;
}

function mergePositiveCentiHealth(left, right, label) {
    const sum = left + right;
    const bonus = Math.floor(sum / 10);
    if (sum > SIGNED_INT32_MAXIMUM - bonus) {
        throw new RangeError(`${label} merge 결과가 signed-int32 centi-HP를 초과합니다.`);
    }
    return sum + bonus;
}

/**
 * 한 merge event의 current/max centi-HP에 `sum + floor(sum / 10)`을 각각 적용합니다.
 * source current/max는 positive이며 current<=max여야 하고, overflow 시 mutation 전에
 * fail-fast합니다.
 */
export function mergeBasicHexaHealthCenti(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('Hexa HP merge source object가 필요합니다.');
    }
    const allowedKeys = new Set([
        'sourceACurrentHealthCenti',
        'sourceAMaxHealthCenti',
        'sourceBCurrentHealthCenti',
        'sourceBMaxHealthCenti'
    ]);
    for (const key of Reflect.ownKeys(source)) {
        if (typeof key === 'symbol' || !allowedKeys.has(key)) {
            throw new RangeError(`Hexa HP merge source에 금지/unknown field가 있습니다: ${String(key)}`);
        }
    }
    const sourceACurrentHealthCenti = requirePositiveCentiHealth(
        source.sourceACurrentHealthCenti,
        'sourceACurrentHealthCenti'
    );
    const sourceAMaxHealthCenti = requirePositiveCentiHealth(
        source.sourceAMaxHealthCenti,
        'sourceAMaxHealthCenti'
    );
    const sourceBCurrentHealthCenti = requirePositiveCentiHealth(
        source.sourceBCurrentHealthCenti,
        'sourceBCurrentHealthCenti'
    );
    const sourceBMaxHealthCenti = requirePositiveCentiHealth(
        source.sourceBMaxHealthCenti,
        'sourceBMaxHealthCenti'
    );
    if (sourceACurrentHealthCenti > sourceAMaxHealthCenti
        || sourceBCurrentHealthCenti > sourceBMaxHealthCenti) {
        throw new RangeError('각 Hexa source current centi-HP는 max를 넘을 수 없습니다.');
    }
    const currentHealthCenti = mergePositiveCentiHealth(
        sourceACurrentHealthCenti,
        sourceBCurrentHealthCenti,
        'currentHealthCenti'
    );
    const maxHealthCenti = mergePositiveCentiHealth(
        sourceAMaxHealthCenti,
        sourceBMaxHealthCenti,
        'maxHealthCenti'
    );
    if (currentHealthCenti > maxHealthCenti) {
        throw new RangeError('merged current centi-HP는 merged max를 넘을 수 없습니다.');
    }
    return Object.freeze({ currentHealthCenti, maxHealthCenti });
}

export const BASIC_HEXA_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    'hexa',
    {
        spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL,
        behaviorProfileId: HEXA_SEEK_FORMATION_BEHAVIOR_PROFILE_ID,
        formationDefinitionId: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID,
        capabilityIds: BASIC_HEXA_FORMATION_CAPABILITY_IDS
    }
);

const BASIC_HEXA_GROUP_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    'hexa',
    {
        spawnPolicy: ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE,
        behaviorProfileId: HEXA_SEEK_FORMATION_BEHAVIOR_PROFILE_ID,
        formationDefinitionId: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID,
        capabilityIds: BASIC_HEXA_FORMATION_CAPABILITY_IDS
    }
);

const BASIC_HEXA_HIVE_ENEMY_DATA = createMainGpuEnemyDefinition(
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID,
    'hexa',
    {
        spawnPolicy: ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE,
        behaviorProfileId: HEXA_KEEP_FORMATION_BEHAVIOR_PROFILE_ID,
        formationDefinitionId: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID,
        capabilityIds: BASIC_HEXA_HIVE_CAPABILITY_IDS
    }
);

/**
 * Atomic transform owner만 사용하는 private content resolver입니다. n=1 natural H나
 * 범위 밖 count는 반환하지 않으며, n=2..5는 group, n=6은 terminal HX입니다.
 */
export function resolveBasicHexaTransformPrivateDefinition(memberCount) {
    const count = requireHexaMemberCount(memberCount);
    if (count === 1) {
        throw new RangeError('n=1 Hexa는 natural definition만 사용할 수 있습니다.');
    }
    return count === BASIC_HEXA_MAXIMUM_MEMBER_COUNT
        ? BASIC_HEXA_HIVE_ENEMY_DATA
        : BASIC_HEXA_GROUP_ENEMY_DATA;
}

/** Host/GPU private transform helper가 profile identity를 검증할 때 쓰는 authority입니다. */
export const BASIC_HEXA_PRIVATE_PROFILE_IDENTITY = Object.freeze({
    physicsProfileId: MAIN_GPU_ENEMY_PHYSICS_PROFILE_ID,
    combatProfileId: MAIN_GPU_ENEMY_COMBAT_PROFILE_ID,
    seekBehaviorProfileId: HEXA_SEEK_FORMATION_BEHAVIOR_PROFILE_ID,
    keepBehaviorProfileId: HEXA_KEEP_FORMATION_BEHAVIOR_PROFILE_ID,
    formationDefinitionId: HEXA_HIVE_SIX_RING_FORMATION_DEFINITION_ID
});
