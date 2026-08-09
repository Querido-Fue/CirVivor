/** Enemy Effect content와 GPU/host runtime이 공유하는 stable vocabulary입니다. */
export const ENEMY_EFFECT_FAMILY = Object.freeze({
    BOOST: 'boost',
    POISON: 'poison',
    BURN: 'burn',
    FREEZE: 'freeze'
});

export const ENEMY_EFFECT_STACK_POLICY = Object.freeze({
    ACTIVE_INSTANCE_COUNT: 'active-instance-count',
    SUM_ACTIVE_MAGNITUDE: 'sum-active-magnitude',
    PER_INSTANCE: 'per-instance',
    STRONGEST_ACTIVE: 'strongest-active'
});

export const ENEMY_EFFECT_APPLICATION_POLICY = Object.freeze({
    APPEND_INDEPENDENT: 'append-independent',
    APPEND_PER_SOURCE: 'append-per-source',
    REPLACE_WEAKER: 'replace-weaker'
});

export const ENEMY_EFFECT_TARGET_POLICY_ID = Object.freeze({
    HOSTILE_ENEMY: 'hostile-enemy'
});

/** String policy는 public authority이고 이 code는 GPU command에 한 번 materialize합니다. */
export const ENEMY_EFFECT_TARGET_POLICY_CODE = Object.freeze({
    HOSTILE_ENEMY: 1
});

const EFFECT_DEFINITION_KEYS = new Set([
    'id',
    'effectDefinitionCode',
    'family',
    'stackPolicy',
    'applicationPolicy',
    'durationTicks',
    'healthDeltaFixedPerTick',
    'healthDeltaMinimumStackCount',
    'attackMultiplier',
    'attackMinimumStackCount',
    'moveSpeedMultiplier',
    'towerContactDamageEffectModifiable',
    'projectileTowerDamageEffectModifiable',
    'directCoreImpactDamageEffectModifiable',
    'typedProjectileCoreDamageEffectModifiable',
    'tags'
]);
const EFFECT_EMITTER_PROFILE_KEYS = new Set([
    'id',
    'emitterDefinitionCode',
    'effectDefinitionId',
    'effectDefinitionCode',
    'targetPolicyId',
    'targetPolicyCode',
    'seekRadiusTiles',
    'clusterRadiusTiles',
    'minimumClusterMemberCount',
    'retargetIntervalTicks',
    'holdRadiusTiles',
    'pulseRadiusTiles',
    'initialPulseDelayTicks',
    'pulseIntervalTicks',
    'selfTargetAllowed',
    'pentaTargetAllowed'
]);
const EFFECT_CATALOG_KEYS = new Set(['effectDefinitions', 'emitterProfiles']);
const VALID_EFFECT_FAMILIES = new Set(Object.values(ENEMY_EFFECT_FAMILY));
const VALID_STACK_POLICIES = new Set(Object.values(ENEMY_EFFECT_STACK_POLICY));
const VALID_APPLICATION_POLICIES = new Set(
    Object.values(ENEMY_EFFECT_APPLICATION_POLICY)
);
const TARGET_POLICY_CODE_BY_ID = Object.freeze({
    [ENEMY_EFFECT_TARGET_POLICY_ID.HOSTILE_ENEMY]:
        ENEMY_EFFECT_TARGET_POLICY_CODE.HOSTILE_ENEMY
});

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

function assertKnownKeys(source, allowedKeys, label) {
    for (const key of Object.keys(source)) {
        if (!allowedKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
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

function requirePositiveUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number >= 0xffffffff) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 uint32 정수여야 합니다.`);
    }
    return number;
}

function requireInt32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < -0x80000000
        || number > 0x7fffffff) {
        throw new RangeError(`${label}은 int32 정수여야 합니다.`);
    }
    return number;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${label}은 유한 숫자여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = requireFinite(value, label);
    if (!(number > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireNonNegativeFinite(value, label) {
    const number = requireFinite(value, label);
    if (number < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return number;
}

function normalizeTags(source, label) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}는 하나 이상의 string 배열이어야 합니다.`);
    }
    const seen = new Set();
    const tags = source.map((value, index) => {
        const tag = requireNonEmptyString(value, `${label}[${index}]`);
        if (seen.has(tag)) {
            throw new RangeError(`${label}에 중복 tag가 있습니다: ${tag}`);
        }
        seen.add(tag);
        return tag;
    });
    return Object.freeze(tags);
}

/** EffectDefinition source를 독립 timer/summary용 immutable record로 만듭니다. */
export function normalizeEnemyEffectDefinition(
    source,
    label = 'enemyEffectDefinition'
) {
    const definition = requirePlainObject(source, label);
    assertKnownKeys(definition, EFFECT_DEFINITION_KEYS, label);
    const family = requireNonEmptyString(definition.family, `${label}.family`);
    if (!VALID_EFFECT_FAMILIES.has(family)) {
        throw new RangeError(`${label}.family는 알려진 EffectFamily여야 합니다.`);
    }
    const stackPolicy = requireNonEmptyString(
        definition.stackPolicy,
        `${label}.stackPolicy`
    );
    if (!VALID_STACK_POLICIES.has(stackPolicy)) {
        throw new RangeError(`${label}.stackPolicy는 알려진 StackPolicy여야 합니다.`);
    }
    const applicationPolicy = requireNonEmptyString(
        definition.applicationPolicy,
        `${label}.applicationPolicy`
    );
    if (!VALID_APPLICATION_POLICIES.has(applicationPolicy)) {
        throw new RangeError(
            `${label}.applicationPolicy는 알려진 EffectApplicationPolicy여야 합니다.`
        );
    }
    return Object.freeze({
        id: requireNonEmptyString(definition.id, `${label}.id`),
        effectDefinitionCode: requirePositiveUint32(
            definition.effectDefinitionCode,
            `${label}.effectDefinitionCode`
        ),
        family,
        stackPolicy,
        applicationPolicy,
        durationTicks: requirePositiveUint32(
            definition.durationTicks,
            `${label}.durationTicks`
        ),
        healthDeltaFixedPerTick: requireInt32(
            definition.healthDeltaFixedPerTick,
            `${label}.healthDeltaFixedPerTick`
        ),
        healthDeltaMinimumStackCount: requirePositiveUint32(
            definition.healthDeltaMinimumStackCount,
            `${label}.healthDeltaMinimumStackCount`
        ),
        attackMultiplier: requirePositiveFinite(
            definition.attackMultiplier,
            `${label}.attackMultiplier`
        ),
        attackMinimumStackCount: requirePositiveUint32(
            definition.attackMinimumStackCount,
            `${label}.attackMinimumStackCount`
        ),
        moveSpeedMultiplier: requireNonNegativeFinite(
            definition.moveSpeedMultiplier,
            `${label}.moveSpeedMultiplier`
        ),
        towerContactDamageEffectModifiable: requireBoolean(
            definition.towerContactDamageEffectModifiable,
            `${label}.towerContactDamageEffectModifiable`
        ),
        projectileTowerDamageEffectModifiable: requireBoolean(
            definition.projectileTowerDamageEffectModifiable,
            `${label}.projectileTowerDamageEffectModifiable`
        ),
        directCoreImpactDamageEffectModifiable: requireBoolean(
            definition.directCoreImpactDamageEffectModifiable,
            `${label}.directCoreImpactDamageEffectModifiable`
        ),
        typedProjectileCoreDamageEffectModifiable: requireBoolean(
            definition.typedProjectileCoreDamageEffectModifiable,
            `${label}.typedProjectileCoreDamageEffectModifiable`
        ),
        tags: normalizeTags(definition.tags, `${label}.tags`)
    });
}

/** Effect emitter content를 GPU candidate/pulse command용 immutable profile로 만듭니다. */
export function normalizeEnemyEffectEmitterProfile(
    source,
    label = 'enemyEffectEmitterProfile'
) {
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, EFFECT_EMITTER_PROFILE_KEYS, label);
    const targetPolicyId = requireNonEmptyString(
        profile.targetPolicyId,
        `${label}.targetPolicyId`
    );
    const expectedTargetPolicyCode = TARGET_POLICY_CODE_BY_ID[targetPolicyId];
    if (expectedTargetPolicyCode === undefined) {
        throw new RangeError(`${label}.targetPolicyId는 알려진 policy여야 합니다.`);
    }
    const targetPolicyCode = requirePositiveUint32(
        profile.targetPolicyCode,
        `${label}.targetPolicyCode`
    );
    if (targetPolicyCode !== expectedTargetPolicyCode) {
        throw new RangeError(`${label}.targetPolicyId/code가 일치해야 합니다.`);
    }
    const seekRadiusTiles = requirePositiveFinite(
        profile.seekRadiusTiles,
        `${label}.seekRadiusTiles`
    );
    const clusterRadiusTiles = requirePositiveFinite(
        profile.clusterRadiusTiles,
        `${label}.clusterRadiusTiles`
    );
    const holdRadiusTiles = requireNonNegativeFinite(
        profile.holdRadiusTiles,
        `${label}.holdRadiusTiles`
    );
    if (clusterRadiusTiles > seekRadiusTiles || holdRadiusTiles > seekRadiusTiles) {
        throw new RangeError(`${label}의 cluster/hold radius는 seek radius 이하여야 합니다.`);
    }
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        emitterDefinitionCode: requirePositiveUint32(
            profile.emitterDefinitionCode,
            `${label}.emitterDefinitionCode`
        ),
        effectDefinitionId: requireNonEmptyString(
            profile.effectDefinitionId,
            `${label}.effectDefinitionId`
        ),
        effectDefinitionCode: requirePositiveUint32(
            profile.effectDefinitionCode,
            `${label}.effectDefinitionCode`
        ),
        targetPolicyId,
        targetPolicyCode,
        seekRadiusTiles,
        clusterRadiusTiles,
        minimumClusterMemberCount: requirePositiveUint32(
            profile.minimumClusterMemberCount,
            `${label}.minimumClusterMemberCount`
        ),
        retargetIntervalTicks: requirePositiveUint32(
            profile.retargetIntervalTicks,
            `${label}.retargetIntervalTicks`
        ),
        holdRadiusTiles,
        pulseRadiusTiles: requirePositiveFinite(
            profile.pulseRadiusTiles,
            `${label}.pulseRadiusTiles`
        ),
        initialPulseDelayTicks: requirePositiveUint32(
            profile.initialPulseDelayTicks,
            `${label}.initialPulseDelayTicks`
        ),
        pulseIntervalTicks: requirePositiveUint32(
            profile.pulseIntervalTicks,
            `${label}.pulseIntervalTicks`
        ),
        selfTargetAllowed: requireBoolean(
            profile.selfTargetAllowed,
            `${label}.selfTargetAllowed`
        ),
        pentaTargetAllowed: requireBoolean(
            profile.pentaTargetAllowed,
            `${label}.pentaTargetAllowed`
        )
    });
}

function normalizeUniqueCollection(source, label, normalizeEntry, codeField) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}은 하나 이상의 record 배열이어야 합니다.`);
    }
    const values = [];
    const byId = Object.create(null);
    const byCode = Object.create(null);
    for (let index = 0; index < source.length; index++) {
        const entry = normalizeEntry(source[index], `${label}[${index}]`);
        if (Object.prototype.hasOwnProperty.call(byId, entry.id)) {
            throw new RangeError(`${label}에 중복 ID가 있습니다: ${entry.id}`);
        }
        const codeKey = String(entry[codeField]);
        if (Object.prototype.hasOwnProperty.call(byCode, codeKey)) {
            throw new RangeError(`${label}에 중복 code가 있습니다: ${entry[codeField]}`);
        }
        values.push(entry);
        byId[entry.id] = entry;
        byCode[codeKey] = entry;
    }
    return Object.freeze({
        values: Object.freeze(values),
        byId: Object.freeze(byId),
        byCode: Object.freeze(byCode)
    });
}

/** Definition/emitter ID와 GPU code 참조를 교차검증한 immutable catalog입니다. */
export function normalizeEnemyEffectCatalog(source, label = 'enemyEffectCatalog') {
    const catalog = requirePlainObject(source, label);
    assertKnownKeys(catalog, EFFECT_CATALOG_KEYS, label);
    const definitions = normalizeUniqueCollection(
        catalog.effectDefinitions,
        `${label}.effectDefinitions`,
        normalizeEnemyEffectDefinition,
        'effectDefinitionCode'
    );
    const emitterProfiles = normalizeUniqueCollection(
        catalog.emitterProfiles,
        `${label}.emitterProfiles`,
        normalizeEnemyEffectEmitterProfile,
        'emitterDefinitionCode'
    );
    for (const profile of emitterProfiles.values) {
        const definition = definitions.byId[profile.effectDefinitionId];
        if (!definition
            || definition.effectDefinitionCode !== profile.effectDefinitionCode) {
            throw new RangeError(
                `${label} emitter가 exact EffectDefinition ID/code를 가리켜야 합니다: ${profile.id}`
            );
        }
    }
    return Object.freeze({
        effectDefinitions: definitions.values,
        effectDefinitionById: definitions.byId,
        effectDefinitionByCode: definitions.byCode,
        emitterProfiles: emitterProfiles.values,
        emitterProfileById: emitterProfiles.byId,
        emitterProfileByCode: emitterProfiles.byCode
    });
}
