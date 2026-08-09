import {
    ENEMY_CAPABILITY_ID,
    normalizeEnemyCapabilityIds
} from './enemy_capability_contract.js';

/** Turn 1에서 vocabulary만 고정하는 formation policy입니다. */
export const ENEMY_FORMATION_POLICY = Object.freeze({
    NONE: 'none',
    KEEP_FORMATION: 'keep-formation',
    SEEK_FORMATION: 'seek-formation'
});

const VALID_FORMATION_POLICIES = new Set(Object.values(ENEMY_FORMATION_POLICY));
const PHYSICS_PROFILE_KEYS = new Set([
    'id',
    'collisionRadiusTiles',
    'weight',
    'pairCollisionRadiusScale',
    'knockbackResistancePolicy'
]);
const COMBAT_PROFILE_KEYS = new Set([
    'id',
    'maxHealth',
    'towerContactDamage',
    'coreImpactDamage',
    'bountyBudget'
]);
const BEHAVIOR_PROFILE_KEYS = new Set([
    'id',
    'navigationObjective',
    'navigationMode',
    'moveSpeedTilesPerSecond',
    'towerEngagement',
    'towerTargetSelection',
    'towerPhysicalResponse',
    'fallback',
    'attackDefinitionId',
    'coreImpactPolicy',
    'formationPolicy',
    'charge'
]);
const CHARGE_PROFILE_KEYS = new Set([
    'windupTicks',
    'windupRangeTiles',
    'chargeSpeedTilesPerSecond',
    'chargeMaxTicks',
    'recoilImpulseTilesPerSecond',
    'recoilTicks',
    'recoverTicks',
    'telegraphStyleCode',
    'telegraphColorRgba',
    'telegraphRadiusScale'
]);
const ENEMY_DEFINITION_KEYS = new Set([
    'id',
    'shapeDefinitionId',
    'physicsProfileId',
    'combatProfileId',
    'behaviorProfileId',
    'capabilityIds',
    'render'
]);
const RENDER_KEYS = new Set(['colorRgba', 'radiusScale']);

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

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 정수여야 합니다.`);
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

function normalizeColorRgba(source, label) {
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 4) {
        throw new TypeError(`${label}는 네 성분 배열이어야 합니다.`);
    }
    const color = new Array(4);
    for (let index = 0; index < color.length; index++) {
        const component = requireFinite(source[index], `${label}[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`${label}[${index}]는 0~1 범위여야 합니다.`);
        }
        color[index] = component;
    }
    return Object.freeze(color);
}

function normalizePhysicsProfile(source, label) {
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, PHYSICS_PROFILE_KEYS, label);
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        collisionRadiusTiles: requirePositiveFinite(
            profile.collisionRadiusTiles,
            `${label}.collisionRadiusTiles`
        ),
        weight: requirePositiveFinite(profile.weight, `${label}.weight`),
        pairCollisionRadiusScale: requirePositiveFinite(
            profile.pairCollisionRadiusScale,
            `${label}.pairCollisionRadiusScale`
        ),
        knockbackResistancePolicy: requireNonEmptyString(
            profile.knockbackResistancePolicy,
            `${label}.knockbackResistancePolicy`
        )
    });
}

function normalizeCombatProfile(source, label) {
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, COMBAT_PROFILE_KEYS, label);
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        maxHealth: requirePositiveFinite(profile.maxHealth, `${label}.maxHealth`),
        towerContactDamage: requireNonNegativeFinite(
            profile.towerContactDamage,
            `${label}.towerContactDamage`
        ),
        coreImpactDamage: requireNonNegativeFinite(
            profile.coreImpactDamage,
            `${label}.coreImpactDamage`
        ),
        bountyBudget: requireNonNegativeFinite(
            profile.bountyBudget,
            `${label}.bountyBudget`
        )
    });
}

function normalizeChargeProfile(source, label) {
    if (source === undefined || source === null) {
        return null;
    }
    const charge = requirePlainObject(source, label);
    assertKnownKeys(charge, CHARGE_PROFILE_KEYS, label);
    return Object.freeze({
        windupTicks: requirePositiveSafeInteger(
            charge.windupTicks,
            `${label}.windupTicks`
        ),
        windupRangeTiles: requirePositiveFinite(
            charge.windupRangeTiles,
            `${label}.windupRangeTiles`
        ),
        chargeSpeedTilesPerSecond: requirePositiveFinite(
            charge.chargeSpeedTilesPerSecond,
            `${label}.chargeSpeedTilesPerSecond`
        ),
        chargeMaxTicks: requirePositiveSafeInteger(
            charge.chargeMaxTicks,
            `${label}.chargeMaxTicks`
        ),
        recoilImpulseTilesPerSecond: requirePositiveFinite(
            charge.recoilImpulseTilesPerSecond,
            `${label}.recoilImpulseTilesPerSecond`
        ),
        recoilTicks: requirePositiveSafeInteger(
            charge.recoilTicks,
            `${label}.recoilTicks`
        ),
        recoverTicks: requirePositiveSafeInteger(
            charge.recoverTicks,
            `${label}.recoverTicks`
        ),
        telegraphStyleCode: requirePositiveSafeInteger(
            charge.telegraphStyleCode,
            `${label}.telegraphStyleCode`
        ),
        telegraphColorRgba: normalizeColorRgba(
            charge.telegraphColorRgba,
            `${label}.telegraphColorRgba`
        ),
        telegraphRadiusScale: requirePositiveFinite(
            charge.telegraphRadiusScale,
            `${label}.telegraphRadiusScale`
        )
    });
}

function normalizeBehaviorProfile(source, label) {
    const profile = requirePlainObject(source, label);
    assertKnownKeys(profile, BEHAVIOR_PROFILE_KEYS, label);
    const formationPolicy = requireNonEmptyString(
        profile.formationPolicy,
        `${label}.formationPolicy`
    );
    if (!VALID_FORMATION_POLICIES.has(formationPolicy)) {
        throw new RangeError(`${label}.formationPolicy는 알려진 formation policy여야 합니다.`);
    }
    const attackDefinitionId = profile.attackDefinitionId === undefined
        || profile.attackDefinitionId === null
        ? null
        : requireNonEmptyString(profile.attackDefinitionId, `${label}.attackDefinitionId`);
    return Object.freeze({
        id: requireNonEmptyString(profile.id, `${label}.id`),
        navigationObjective: requireNonEmptyString(
            profile.navigationObjective,
            `${label}.navigationObjective`
        ),
        navigationMode: requireNonEmptyString(profile.navigationMode, `${label}.navigationMode`),
        moveSpeedTilesPerSecond: requirePositiveFinite(
            profile.moveSpeedTilesPerSecond,
            `${label}.moveSpeedTilesPerSecond`
        ),
        towerEngagement: requireNonEmptyString(
            profile.towerEngagement,
            `${label}.towerEngagement`
        ),
        towerTargetSelection: requireNonEmptyString(
            profile.towerTargetSelection,
            `${label}.towerTargetSelection`
        ),
        towerPhysicalResponse: requireNonEmptyString(
            profile.towerPhysicalResponse,
            `${label}.towerPhysicalResponse`
        ),
        fallback: requireNonEmptyString(profile.fallback, `${label}.fallback`),
        attackDefinitionId,
        coreImpactPolicy: requireNonEmptyString(
            profile.coreImpactPolicy,
            `${label}.coreImpactPolicy`
        ),
        formationPolicy,
        charge: normalizeChargeProfile(profile.charge, `${label}.charge`)
    });
}

function normalizeProfileCollection(source, label, normalizeProfile) {
    if (!Array.isArray(source) || source.length === 0) {
        throw new TypeError(`${label}은 하나 이상의 profile 배열이어야 합니다.`);
    }
    const byId = Object.create(null);
    for (let index = 0; index < source.length; index++) {
        const profile = normalizeProfile(source[index], `${label}[${index}]`);
        if (Object.prototype.hasOwnProperty.call(byId, profile.id)) {
            throw new RangeError(`${label}에 중복 profile ID가 있습니다: ${profile.id}`);
        }
        byId[profile.id] = profile;
    }
    return Object.freeze(byId);
}

/**
 * Content profile source를 deep-normalized immutable catalog로 만듭니다.
 * Contract는 concrete content module을 import하지 않습니다.
 */
export function normalizeEnemyProfileCatalog(source, label = 'enemyProfileCatalog') {
    const catalog = requirePlainObject(source, label);
    assertKnownKeys(catalog, new Set(['physics', 'combat', 'behavior']), label);
    return Object.freeze({
        physicsById: normalizeProfileCollection(
            catalog.physics,
            `${label}.physics`,
            normalizePhysicsProfile
        ),
        combatById: normalizeProfileCollection(
            catalog.combat,
            `${label}.combat`,
            normalizeCombatProfile
        ),
        behaviorById: normalizeProfileCollection(
            catalog.behavior,
            `${label}.behavior`,
            normalizeBehaviorProfile
        )
    });
}

function assertProfileCatalog(source, label = 'enemyProfileCatalog') {
    const catalog = requirePlainObject(source, label);
    for (const field of ['physicsById', 'combatById', 'behaviorById']) {
        requirePlainObject(catalog[field], `${label}.${field}`);
    }
    return catalog;
}

function resolveProfile(catalog, field, id, label) {
    const profileId = requireNonEmptyString(id, label);
    const profile = catalog[field][profileId];
    if (!profile) {
        throw new RangeError(`${label}가 등록된 profile을 가리키지 않습니다: ${profileId}`);
    }
    return profile;
}

/**
 * Definition ID 참조를 profile object로 해석합니다. 반환 profile은 catalog authority의
 * immutable reference이며, definition에는 이를 다시 저장하지 않습니다.
 */
export function resolveEnemyDefinitionProfiles(
    definition,
    profileCatalog,
    label = 'enemyDefinition'
) {
    const source = requirePlainObject(definition, label);
    const catalog = assertProfileCatalog(profileCatalog);
    return Object.freeze({
        physics: resolveProfile(
            catalog,
            'physicsById',
            source.physicsProfileId,
            `${label}.physicsProfileId`
        ),
        combat: resolveProfile(
            catalog,
            'combatById',
            source.combatProfileId,
            `${label}.combatProfileId`
        ),
        behavior: resolveProfile(
            catalog,
            'behaviorById',
            source.behaviorProfileId,
            `${label}.behaviorProfileId`
        )
    });
}

/**
 * Profile가 실제 runtime capability 선언과 양방향으로 일치하는지 검증합니다.
 * attack-linked behavior는 TARGETING을, positive contact damage는 CONTACT_COMBAT을,
 * route navigation mode는 NAVIGATION을, positive Core impact와 its policy는
 * CORE_IMPACT를 반드시 선언해야 합니다.
 */
export function assertEnemyDefinitionProfileCapabilityConsistency(
    definition,
    profileCatalog,
    label = 'enemyDefinition'
) {
    const source = requirePlainObject(definition, label);
    const capabilityIds = normalizeEnemyCapabilityIds(
        source.capabilityIds,
        `${label}.capabilityIds`
    );
    const capabilityIdSet = new Set(capabilityIds);
    const profiles = resolveEnemyDefinitionProfiles(source, profileCatalog, label);
    const hasTargeting = capabilityIdSet.has(ENEMY_CAPABILITY_ID.TARGETING);
    const hasAttackDefinition = profiles.behavior.attackDefinitionId !== null;
    if (hasTargeting !== hasAttackDefinition) {
        throw new RangeError(
            `${label}의 TARGETING capability와 behavior attackDefinitionId가 일치해야 합니다.`
        );
    }
    const hasCharge = capabilityIdSet.has(ENEMY_CAPABILITY_ID.CHARGE);
    const hasChargeProfile = profiles.behavior.charge !== null;
    if (hasCharge !== hasChargeProfile) {
        throw new RangeError(
            `${label}의 CHARGE capability와 behavior charge profile이 일치해야 합니다.`
        );
    }
    if (hasCharge && !capabilityIdSet.has(ENEMY_CAPABILITY_ID.CONTACT_COMBAT)) {
        throw new RangeError(
            `${label}의 CHARGE capability에는 CONTACT_COMBAT capability가 필요합니다.`
        );
    }
    if (profiles.combat.towerContactDamage > 0
        && !capabilityIdSet.has(ENEMY_CAPABILITY_ID.CONTACT_COMBAT)) {
        throw new RangeError(
            `${label}의 positive towerContactDamage에는 CONTACT_COMBAT capability가 필요합니다.`
        );
    }
    if (profiles.behavior.navigationMode !== 'none'
        && !capabilityIdSet.has(ENEMY_CAPABILITY_ID.NAVIGATION)) {
        throw new RangeError(
            `${label}의 navigationMode에는 NAVIGATION capability가 필요합니다.`
        );
    }
    const hasCoreImpact = capabilityIdSet.has(ENEMY_CAPABILITY_ID.CORE_IMPACT);
    const hasCoreImpactPolicy = profiles.behavior.coreImpactPolicy !== 'none';
    const hasPositiveCoreImpactDamage = profiles.combat.coreImpactDamage > 0;
    if (hasCoreImpact !== hasCoreImpactPolicy
        || hasCoreImpact !== hasPositiveCoreImpactDamage) {
        throw new RangeError(
            `${label}의 CORE_IMPACT capability, positive coreImpactDamage, `
                + 'behavior coreImpactPolicy가 일치해야 합니다.'
        );
    }
    return profiles;
}

/**
 * Canonical EnemyDefinition을 만들고 기존 consumer용 flat field를 profile/render에서만
 * 파생합니다. flat field는 별도 authoring authority가 아닙니다.
 */
export function normalizeEnemyDefinition(
    source,
    profileCatalog,
    label = 'enemyDefinition'
) {
    const definition = requirePlainObject(source, label);
    assertKnownKeys(definition, ENEMY_DEFINITION_KEYS, label);
    const id = requireNonEmptyString(definition.id, `${label}.id`);
    const shapeDefinitionId = requireNonEmptyString(
        definition.shapeDefinitionId,
        `${label}.shapeDefinitionId`
    );
    const physicsProfileId = requireNonEmptyString(
        definition.physicsProfileId,
        `${label}.physicsProfileId`
    );
    const combatProfileId = requireNonEmptyString(
        definition.combatProfileId,
        `${label}.combatProfileId`
    );
    const behaviorProfileId = requireNonEmptyString(
        definition.behaviorProfileId,
        `${label}.behaviorProfileId`
    );
    const capabilityIds = normalizeEnemyCapabilityIds(
        definition.capabilityIds,
        `${label}.capabilityIds`
    );
    const renderSource = requirePlainObject(definition.render, `${label}.render`);
    assertKnownKeys(renderSource, RENDER_KEYS, `${label}.render`);
    const render = Object.freeze({
        colorRgba: normalizeColorRgba(renderSource.colorRgba, `${label}.render.colorRgba`),
        radiusScale: requirePositiveFinite(
            renderSource.radiusScale,
            `${label}.render.radiusScale`
        )
    });
    const canonical = {
        id,
        shapeDefinitionId,
        physicsProfileId,
        combatProfileId,
        behaviorProfileId,
        capabilityIds,
        render
    };
    const profiles = assertEnemyDefinitionProfileCapabilityConsistency(
        canonical,
        profileCatalog,
        label
    );
    const compatibilityView = {
        shapeType: shapeDefinitionId,
        collisionRadiusTiles: profiles.physics.collisionRadiusTiles,
        collisionWeight: profiles.physics.weight,
        pairCollisionRadiusScale: profiles.physics.pairCollisionRadiusScale,
        maxHealth: profiles.combat.maxHealth,
        towerContactDamage: profiles.combat.towerContactDamage,
        coreImpactDamage: profiles.combat.coreImpactDamage,
        bountyBudget: profiles.combat.bountyBudget,
        moveSpeedTilesPerSecond: profiles.behavior.moveSpeedTilesPerSecond,
        colorRgba: render.colorRgba,
        radiusScale: render.radiusScale
    };
    if (profiles.behavior.attackDefinitionId !== null) {
        compatibilityView.attackDefinitionId = profiles.behavior.attackDefinitionId;
    }
    return Object.freeze({
        ...canonical,
        ...compatibilityView
    });
}
