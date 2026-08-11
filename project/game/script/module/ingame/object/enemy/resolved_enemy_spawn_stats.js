import {
    resolveEnemyDefinitionProfiles
} from '../../contract/enemy_profile_contract.js';
import {
    ENEMY_PROFILE_CATALOG
} from 'data/object/enemy/enemy_profile_catalog_data.js';

/** Map/Wave modifier와 resolved stat가 공유하는 유일한 stat field vocabulary입니다. */
export const ENEMY_SPAWN_STAT_ID = Object.freeze({
    MAX_HEALTH: 'maxHealth',
    MOVE_SPEED_TILES_PER_SECOND: 'moveSpeedTilesPerSecond',
    WEIGHT: 'weight',
    TOWER_CONTACT_DAMAGE: 'towerContactDamage',
    CORE_IMPACT_DAMAGE: 'coreImpactDamage',
    BOUNTY_BUDGET: 'bountyBudget'
});

const ENEMY_SPAWN_STAT_FIELDS = Object.freeze(Object.values(ENEMY_SPAWN_STAT_ID));
const ENEMY_SPAWN_STAT_FIELD_SET = new Set(ENEMY_SPAWN_STAT_FIELDS);
const GPU_BOUND_STAT_FIELDS = new Set([
    ENEMY_SPAWN_STAT_ID.MAX_HEALTH,
    ENEMY_SPAWN_STAT_ID.MOVE_SPEED_TILES_PER_SECOND,
    ENEMY_SPAWN_STAT_ID.WEIGHT,
    ENEMY_SPAWN_STAT_ID.TOWER_CONTACT_DAMAGE
]);
const MODIFIER_SCOPE_KEYS = new Set(['multipliers', 'absolute']);
const MODIFIER_SET_KEYS = new Set(['global', 'byEnemyDefinitionId']);
const RESOLVED_STAT_KEYS = new Set([
    'definitionId',
    'physicsProfileId',
    'combatProfileId',
    'behaviorProfileId',
    ...ENEMY_SPAWN_STAT_FIELDS,
    'inverseMass'
]);

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

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        throw new TypeError(`${label}은 유한 숫자여야 합니다.`);
    }
    return number;
}

function assertKnownKeys(source, allowedKeys, label) {
    for (const key of Object.keys(source)) {
        if (!allowedKeys.has(key)) {
            throw new RangeError(`${label}에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
}

function normalizeStatValueMap(source, label, type) {
    if (source === undefined || source === null) {
        return Object.freeze({});
    }
    const values = requirePlainObject(source, label);
    const normalized = Object.create(null);
    for (const [field, value] of Object.entries(values)) {
        if (!ENEMY_SPAWN_STAT_FIELD_SET.has(field)) {
            throw new RangeError(`${label}에 알 수 없는 enemy stat field가 있습니다: ${field}`);
        }
        const number = requireFinite(value, `${label}.${field}`);
        if (type === 'multiplier' && number < 0) {
            throw new RangeError(`${label}.${field} multiplier는 0 이상이어야 합니다.`);
        }
        normalized[field] = number;
    }
    return Object.freeze(normalized);
}

function normalizeModifierScope(source, label) {
    if (source === undefined || source === null) {
        return Object.freeze({
            multipliers: Object.freeze({}),
            absolute: Object.freeze({})
        });
    }
    const scope = requirePlainObject(source, label);
    assertKnownKeys(scope, MODIFIER_SCOPE_KEYS, label);
    return Object.freeze({
        multipliers: normalizeStatValueMap(
            scope.multipliers,
            `${label}.multipliers`,
            'multiplier'
        ),
        absolute: normalizeStatValueMap(scope.absolute, `${label}.absolute`, 'absolute')
    });
}

function normalizeKnownDefinitionIds(source, label) {
    if (source === undefined || source === null) {
        return null;
    }
    if (typeof source[Symbol.iterator] !== 'function') {
        throw new TypeError(`${label}은 definition ID iterable이어야 합니다.`);
    }
    const ids = new Set();
    for (const value of source) {
        ids.add(requireNonEmptyString(value, `${label} entry`));
    }
    return ids;
}

/**
 * Modifier source를 가변 authoring object와 분리한 immutable snapshot으로 만듭니다.
 * absolute는 같은 stat에서 더 뒤 scope가 정의했을 때만 이전 값을 덮습니다.
 */
export function normalizeEnemyModifierSet(source, options = {}) {
    const label = options.label ?? 'enemyModifiers';
    if (typeof label !== 'string' || label.length === 0) {
        throw new TypeError('enemy modifier label이 필요합니다.');
    }
    const knownDefinitionIds = normalizeKnownDefinitionIds(
        options.knownDefinitionIds,
        `${label}.knownDefinitionIds`
    );
    if (source === undefined || source === null) {
        return Object.freeze({
            global: normalizeModifierScope(undefined, `${label}.global`),
            byEnemyDefinitionId: Object.freeze({})
        });
    }
    const modifiers = requirePlainObject(source, label);
    assertKnownKeys(modifiers, MODIFIER_SET_KEYS, label);
    const byDefinitionSource = modifiers.byEnemyDefinitionId === undefined
        || modifiers.byEnemyDefinitionId === null
        ? {}
        : requirePlainObject(
            modifiers.byEnemyDefinitionId,
            `${label}.byEnemyDefinitionId`
        );
    const byEnemyDefinitionId = Object.create(null);
    for (const [definitionId, scope] of Object.entries(byDefinitionSource)) {
        const id = requireNonEmptyString(
            definitionId,
            `${label}.byEnemyDefinitionId key`
        );
        if (knownDefinitionIds !== null && !knownDefinitionIds.has(id)) {
            throw new RangeError(`${label}에 등록되지 않은 enemy definition ID가 있습니다: ${id}`);
        }
        byEnemyDefinitionId[id] = normalizeModifierScope(
            scope,
            `${label}.byEnemyDefinitionId.${id}`
        );
    }
    return Object.freeze({
        global: normalizeModifierScope(modifiers.global, `${label}.global`),
        byEnemyDefinitionId: Object.freeze(byEnemyDefinitionId)
    });
}

function getScopeValue(scope, field, type, fallback) {
    const values = scope[type];
    return Object.prototype.hasOwnProperty.call(values, field)
        ? values[field]
        : fallback;
}

function assertPositiveFinite(value, label) {
    if (!Number.isFinite(value) || !(value > 0)) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
}

function assertNonNegativeFinite(value, label) {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
}

function assertUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
}

function quantizeGpuBoundStat(value, label, positive = false) {
    const quantized = Math.fround(value);
    if (!Number.isFinite(quantized) || (positive && !(quantized > 0)) || (!positive && quantized < 0)) {
        throw new RangeError(`${label}의 final float32 값이 유효하지 않습니다.`);
    }
    return quantized;
}

/**
 * Base profile × map global × map definition × wave global × wave definition 후,
 * 같은 순서의 field-wise absolute override를 적용합니다. 중간 Math.fround는 금지하며,
 * GPU로 들어가는 수치만 validation 뒤 한 번 final f32로 양자화합니다.
 */
export function resolveEnemySpawnStats(options = {}) {
    const definition = requirePlainObject(options.definition, 'definition');
    const definitionId = requireNonEmptyString(definition.id, 'definition.id');
    const profileCatalog = options.profileCatalog ?? ENEMY_PROFILE_CATALOG;
    const profiles = resolveEnemyDefinitionProfiles(
        definition,
        profileCatalog,
        'definition'
    );
    const mapModifiers = normalizeEnemyModifierSet(options.mapEnemyModifiers, {
        label: 'mapEnemyModifiers',
        knownDefinitionIds: options.knownDefinitionIds
    });
    const waveModifiers = normalizeEnemyModifierSet(options.waveEnemyModifiers, {
        label: 'waveEnemyModifiers',
        knownDefinitionIds: options.knownDefinitionIds
    });
    const scopes = Object.freeze([
        mapModifiers.global,
        mapModifiers.byEnemyDefinitionId[definitionId]
            ?? normalizeModifierScope(undefined, 'mapEnemyModifiers.byEnemyDefinitionId'),
        waveModifiers.global,
        waveModifiers.byEnemyDefinitionId[definitionId]
            ?? normalizeModifierScope(undefined, 'waveEnemyModifiers.byEnemyDefinitionId')
    ]);
    const raw = {
        maxHealth: profiles.combat.maxHealth,
        moveSpeedTilesPerSecond: profiles.behavior.moveSpeedTilesPerSecond,
        weight: profiles.physics.weight,
        towerContactDamage: profiles.combat.towerContactDamage,
        coreImpactDamage: profiles.combat.coreImpactDamage,
        bountyBudget: profiles.combat.bountyBudget
    };

    for (const scope of scopes) {
        for (const field of ENEMY_SPAWN_STAT_FIELDS) {
            raw[field] *= getScopeValue(scope, field, 'multipliers', 1);
        }
    }
    for (const scope of scopes) {
        for (const field of ENEMY_SPAWN_STAT_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(scope.absolute, field)) {
                raw[field] = getScopeValue(scope, field, 'absolute', raw[field]);
            }
        }
    }

    assertPositiveFinite(raw.maxHealth, 'resolved maxHealth');
    assertPositiveFinite(raw.moveSpeedTilesPerSecond, 'resolved moveSpeedTilesPerSecond');
    assertPositiveFinite(raw.weight, 'resolved weight');
    assertNonNegativeFinite(raw.towerContactDamage, 'resolved towerContactDamage');
    assertNonNegativeFinite(raw.coreImpactDamage, 'resolved coreImpactDamage');
    assertUint32(raw.bountyBudget, 'resolved bountyBudget');

    // Modifier 곱셈 중간에는 round하지 않습니다. 모든 modifier/absolute 적용 후 final
    // weight를 f32로 확정하고, 반환되는 그 값에서 inverseMass를 final-derived합니다.
    const weight = quantizeGpuBoundStat(raw.weight, 'resolved weight', true);
    const inverseMass = quantizeGpuBoundStat(
        1 / weight,
        'resolved inverseMass',
        true
    );
    return Object.freeze({
        definitionId,
        physicsProfileId: definition.physicsProfileId,
        combatProfileId: definition.combatProfileId,
        behaviorProfileId: definition.behaviorProfileId,
        maxHealth: quantizeGpuBoundStat(raw.maxHealth, 'resolved maxHealth', true),
        moveSpeedTilesPerSecond: quantizeGpuBoundStat(
            raw.moveSpeedTilesPerSecond,
            'resolved moveSpeedTilesPerSecond',
            true
        ),
        weight,
        inverseMass,
        towerContactDamage: quantizeGpuBoundStat(
            raw.towerContactDamage,
            'resolved towerContactDamage'
        ),
        coreImpactDamage: raw.coreImpactDamage,
        bountyBudget: raw.bountyBudget
    });
}

/** Resolved stat object가 final immutable spawn boundary의 수치인지 확인합니다. */
export function assertResolvedEnemySpawnStats(
    source,
    definitionId = undefined,
    label = 'resolvedEnemySpawnStats'
) {
    const stats = requirePlainObject(source, label);
    assertKnownKeys(stats, RESOLVED_STAT_KEYS, label);
    const resolvedDefinitionId = requireNonEmptyString(stats.definitionId, `${label}.definitionId`);
    if (definitionId !== undefined
        && resolvedDefinitionId !== requireNonEmptyString(definitionId, 'definitionId')) {
        throw new RangeError(`${label}.definitionId가 spawn definition과 다릅니다.`);
    }
    requireNonEmptyString(stats.physicsProfileId, `${label}.physicsProfileId`);
    requireNonEmptyString(stats.combatProfileId, `${label}.combatProfileId`);
    requireNonEmptyString(stats.behaviorProfileId, `${label}.behaviorProfileId`);
    for (const field of GPU_BOUND_STAT_FIELDS) {
        const value = stats[field];
        const positive = field !== ENEMY_SPAWN_STAT_ID.TOWER_CONTACT_DAMAGE;
        if (!Object.is(value, Math.fround(value))) {
            throw new RangeError(`${label}.${field}은 final float32여야 합니다.`);
        }
        if (positive) {
            assertPositiveFinite(value, `${label}.${field}`);
        } else {
            assertNonNegativeFinite(value, `${label}.${field}`);
        }
    }
    if (!Object.is(stats.inverseMass, Math.fround(stats.inverseMass))) {
        throw new RangeError(`${label}.inverseMass는 final float32여야 합니다.`);
    }
    assertPositiveFinite(stats.inverseMass, `${label}.inverseMass`);
    if (!Object.is(stats.inverseMass, Math.fround(1 / stats.weight))) {
        throw new RangeError(
            `${label}.inverseMass는 final weight에서 정확히 파생되어야 합니다.`
        );
    }
    assertNonNegativeFinite(stats.coreImpactDamage, `${label}.coreImpactDamage`);
    assertUint32(stats.bountyBudget, `${label}.bountyBudget`);
    return stats;
}
