/**
 * Enemy content와 runtime owner가 공유하는 안정 capability ID입니다.
 * 이 contract는 content data를 import하지 않습니다.
 */
export const ENEMY_CAPABILITY_ID = Object.freeze({
    NAVIGATION: 'enemy-navigation',
    TARGETING: 'enemy-targeting',
    CONTACT_COMBAT: 'enemy-contact-combat',
    FORMATION: 'enemy-formation',
    EFFECT_EMITTER: 'enemy-effect-emitter',
    ATOMIC_TRANSFORM: 'enemy-atomic-transform',
    DIRECTIONAL_DEFENSE: 'enemy-directional-defense',
    PROJECTILE_CAPTURE: 'enemy-projectile-capture',
    ROUTE_CLOSURE: 'enemy-route-closure',
    CORE_IMPACT: 'enemy-core-impact',
    CHARGE: 'enemy-charge'
});

/** Runtime/WorldRegistry 경계에서 capability를 primitive로 보존하는 stable bit입니다. */
export const ENEMY_CAPABILITY_BIT = Object.freeze({
    NAVIGATION: 0x001,
    TARGETING: 0x002,
    CONTACT_COMBAT: 0x004,
    FORMATION: 0x008,
    EFFECT_EMITTER: 0x010,
    ATOMIC_TRANSFORM: 0x020,
    DIRECTIONAL_DEFENSE: 0x040,
    PROJECTILE_CAPTURE: 0x080,
    ROUTE_CLOSURE: 0x100,
    // 기존 stable bit를 이동시키지 않는 append-only Turn 1 bit입니다.
    CORE_IMPACT: 0x200,
    // Arrow A의 실제 GPU charge runtime이 소비하는 append-only Turn 2 bit입니다.
    CHARGE: 0x400
});

export const ENEMY_CAPABILITY_BIT_BY_ID = Object.freeze({
    [ENEMY_CAPABILITY_ID.NAVIGATION]: ENEMY_CAPABILITY_BIT.NAVIGATION,
    [ENEMY_CAPABILITY_ID.TARGETING]: ENEMY_CAPABILITY_BIT.TARGETING,
    [ENEMY_CAPABILITY_ID.CONTACT_COMBAT]: ENEMY_CAPABILITY_BIT.CONTACT_COMBAT,
    [ENEMY_CAPABILITY_ID.FORMATION]: ENEMY_CAPABILITY_BIT.FORMATION,
    [ENEMY_CAPABILITY_ID.EFFECT_EMITTER]: ENEMY_CAPABILITY_BIT.EFFECT_EMITTER,
    [ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM]: ENEMY_CAPABILITY_BIT.ATOMIC_TRANSFORM,
    [ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE]: ENEMY_CAPABILITY_BIT.DIRECTIONAL_DEFENSE,
    [ENEMY_CAPABILITY_ID.PROJECTILE_CAPTURE]: ENEMY_CAPABILITY_BIT.PROJECTILE_CAPTURE,
    [ENEMY_CAPABILITY_ID.ROUTE_CLOSURE]: ENEMY_CAPABILITY_BIT.ROUTE_CLOSURE,
    [ENEMY_CAPABILITY_ID.CORE_IMPACT]: ENEMY_CAPABILITY_BIT.CORE_IMPACT,
    [ENEMY_CAPABILITY_ID.CHARGE]: ENEMY_CAPABILITY_BIT.CHARGE
});

export const ENEMY_CAPABILITY_ALL_MASK = Object.values(ENEMY_CAPABILITY_BIT)
    .reduce((mask, bit) => mask | bit, 0);

/**
 * Capability system이 exact-handle roster로 노출할 수 있는 최소 lifecycle/fixed/event port
 * vocabulary입니다. 모든 capability가 모든 method를 구현할 필요는 없습니다.
 */
export const ENEMY_CAPABILITY_ROSTER_PORT_METHOD = Object.freeze({
    OBSERVE_LIFECYCLE: 'observeLifecycle',
    OBSERVE_COMPLETED_EVENTS: 'observeCompletedEvents',
    OBSERVE_COMPLETED_PREPARATIONS: 'observeCompletedPreparations',
    STAGE_FOR_FIXED_TICK: 'stageForFixedTick',
    OBSERVE_FIXED_COMMIT: 'observeFixedCommit',
    GET_STATUS: 'getStatus',
    REQUIRES_RECOVERY: 'requiresRecovery',
    RESET_GPU_BINDING: 'resetGpuBinding',
    CLOSE_FOR_TERMINAL: 'closeForTerminal',
    DESTROY: 'destroy'
});

const VALID_CAPABILITY_IDS = new Set(Object.values(ENEMY_CAPABILITY_ID));
const VALID_ROSTER_PORT_METHODS = new Set(
    Object.values(ENEMY_CAPABILITY_ROSTER_PORT_METHOD)
);

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

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

/** @returns {string} 검증된 stable enemy capability ID입니다. */
export function normalizeEnemyCapabilityId(value, label = 'capabilityId') {
    const id = requireNonEmptyString(value, label);
    if (!VALID_CAPABILITY_IDS.has(id)) {
        throw new RangeError(`${label}은 알려진 enemy capability ID여야 합니다.`);
    }
    return id;
}

/**
 * Content definition의 capability list를 duplicate 없이 immutable snapshot으로 만듭니다.
 */
export function normalizeEnemyCapabilityIds(source, label = 'capabilityIds') {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 capability ID 배열이어야 합니다.`);
    }
    const seen = new Set();
    const ids = source.map((value, index) => {
        const id = normalizeEnemyCapabilityId(value, `${label}[${index}]`);
        if (seen.has(id)) {
            throw new RangeError(`${label}에 중복 capability ID가 있습니다: ${id}`);
        }
        seen.add(id);
        return id;
    });
    return Object.freeze(ids);
}

/** ID 배열을 content object 없이 운반 가능한 uint32 bit mask로 변환합니다. */
export function createEnemyCapabilityMask(source, label = 'capabilityIds') {
    const ids = normalizeEnemyCapabilityIds(source, label);
    let mask = 0;
    for (const id of ids) {
        mask |= ENEMY_CAPABILITY_BIT_BY_ID[id];
    }
    return mask >>> 0;
}

/** 알려진 bit만 포함하는 stable runtime capabilityMask를 검증합니다. */
export function normalizeEnemyCapabilityMask(value, label = 'capabilityMask') {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    const mask = value >>> 0;
    if ((mask & ~ENEMY_CAPABILITY_ALL_MASK) !== 0) {
        throw new RangeError(`${label}에 알려지지 않은 enemy capability bit가 있습니다.`);
    }
    return mask;
}

/** Runtime primitive mask가 특정 stable capability를 실제로 선언하는지 반환합니다. */
export function hasEnemyCapability(
    capabilityMask,
    capabilityId,
    label = 'capabilityMask'
) {
    const mask = normalizeEnemyCapabilityMask(capabilityMask, label);
    const id = normalizeEnemyCapabilityId(capabilityId, 'capabilityId');
    return (mask & ENEMY_CAPABILITY_BIT_BY_ID[id]) !== 0;
}

/**
 * Exact-handle runtime roster가 선택적으로 구현할 method family를 검증합니다.
 * 빈 object는 future placeholder가 되므로 허용하지 않습니다.
 */
export function assertEnemyCapabilityExactHandleRosterPort(
    source,
    label = 'enemyCapabilityRosterPort'
) {
    const port = requirePlainObject(source, label);
    const keys = Object.keys(port);
    if (keys.length === 0) {
        throw new TypeError(`${label}에는 하나 이상의 roster method가 필요합니다.`);
    }
    for (const methodName of keys) {
        if (!VALID_ROSTER_PORT_METHODS.has(methodName)) {
            throw new RangeError(`${label}.${methodName}은 알려진 roster method가 아닙니다.`);
        }
        if (typeof port[methodName] !== 'function') {
            throw new TypeError(`${label}.${methodName}은 함수여야 합니다.`);
        }
    }
    return port;
}

function assertRequiredPortMethods(source, methodNames, label) {
    const port = requirePlainObject(source, label);
    for (const methodName of methodNames) {
        if (typeof port[methodName] !== 'function') {
            throw new TypeError(`${label}.${methodName}()가 필요합니다.`);
        }
    }
    return port;
}

/** IEnemyLifecycleObserver 최소 port assertion입니다. */
export function assertEnemyLifecycleObserver(
    source,
    label = 'enemyLifecycleObserver'
) {
    return assertRequiredPortMethods(
        source,
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_LIFECYCLE],
        label
    );
}

/** IEnemyFixedCommandProducer 최소 stage/commit family assertion입니다. */
export function assertEnemyFixedCommandProducer(
    source,
    label = 'enemyFixedCommandProducer'
) {
    return assertRequiredPortMethods(source, [
        ENEMY_CAPABILITY_ROSTER_PORT_METHOD.STAGE_FOR_FIXED_TICK,
        ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_FIXED_COMMIT
    ], label);
}

/** IEnemyGameplayEventConsumer 최소 completed-event port assertion입니다. */
export function assertEnemyGameplayEventConsumer(
    source,
    label = 'enemyGameplayEventConsumer'
) {
    return assertRequiredPortMethods(
        source,
        [ENEMY_CAPABILITY_ROSTER_PORT_METHOD.OBSERVE_COMPLETED_EVENTS],
        label
    );
}

/**
 * Content를 mutation하지 않는 capability implementation registry를 생성합니다.
 * 각 구현은 definition assertion 또는 실제 exact-handle roster port 중 하나를 가져야 합니다.
 */
export function createEnemyCapabilityImplementationRegistry(
    source,
    label = 'enemyCapabilityImplementationRegistry'
) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 implementation entry 배열이어야 합니다.`);
    }
    const byCapabilityId = Object.create(null);
    for (let index = 0; index < source.length; index++) {
        const entry = requirePlainObject(source[index], `${label}[${index}]`);
        const capabilityId = normalizeEnemyCapabilityId(
            entry.capabilityId,
            `${label}[${index}].capabilityId`
        );
        if (Object.prototype.hasOwnProperty.call(byCapabilityId, capabilityId)) {
            throw new RangeError(`${label}에 중복 capability ID가 있습니다: ${capabilityId}`);
        }
        const implementationId = requireNonEmptyString(
            entry.implementationId,
            `${label}[${index}].implementationId`
        );
        const assertDefinition = entry.assertDefinition;
        if (assertDefinition !== undefined && typeof assertDefinition !== 'function') {
            throw new TypeError(`${label}[${index}].assertDefinition은 함수여야 합니다.`);
        }
        const rosterPort = entry.rosterPort === undefined
            ? null
            : assertEnemyCapabilityExactHandleRosterPort(
                entry.rosterPort,
                `${label}[${index}].rosterPort`
            );
        if (assertDefinition === undefined && rosterPort === null) {
            throw new TypeError(
                `${label}[${index}]에는 definition assertion 또는 roster port가 필요합니다.`
            );
        }
        byCapabilityId[capabilityId] = Object.freeze({
            capabilityId,
            implementationId,
            assertDefinition: assertDefinition ?? null,
            rosterPort
        });
    }
    return Object.freeze({
        byCapabilityId: Object.freeze(byCapabilityId)
    });
}

/** Registry shape을 검증하고 같은 immutable registry를 반환합니다. */
export function assertEnemyCapabilityImplementationRegistry(
    source,
    label = 'enemyCapabilityImplementationRegistry'
) {
    const registry = requirePlainObject(source, label);
    const byCapabilityId = requirePlainObject(
        registry.byCapabilityId,
        `${label}.byCapabilityId`
    );
    for (const [capabilityId, entry] of Object.entries(byCapabilityId)) {
        const normalizedId = normalizeEnemyCapabilityId(
            capabilityId,
            `${label}.byCapabilityId key`
        );
        const implementation = requirePlainObject(
            entry,
            `${label}.byCapabilityId.${normalizedId}`
        );
        if (implementation.capabilityId !== normalizedId) {
            throw new RangeError(`${label}.${normalizedId} capability ID가 일치하지 않습니다.`);
        }
        requireNonEmptyString(
            implementation.implementationId,
            `${label}.${normalizedId}.implementationId`
        );
        if (implementation.assertDefinition !== null
            && typeof implementation.assertDefinition !== 'function') {
            throw new TypeError(`${label}.${normalizedId}.assertDefinition은 함수여야 합니다.`);
        }
        if (implementation.rosterPort !== null) {
            assertEnemyCapabilityExactHandleRosterPort(
                implementation.rosterPort,
                `${label}.${normalizedId}.rosterPort`
            );
        }
        if (implementation.assertDefinition === null && implementation.rosterPort === null) {
            throw new TypeError(`${label}.${normalizedId}은 비어 있는 implementation일 수 없습니다.`);
        }
    }
    return registry;
}

/** Turn 1 named EnemyCapabilityRegistry seam은 검증된 implementation registry를 재사용합니다. */
export const createEnemyCapabilityRegistry
    = createEnemyCapabilityImplementationRegistry;
export const assertEnemyCapabilityRegistry
    = assertEnemyCapabilityImplementationRegistry;

/**
 * Definition의 모든 capability가 runtime registry에 실제 implementation으로 등록됐는지
 * spawn 전 경계에서 확인합니다.
 */
export function assertEnemyDefinitionCapabilityImplementations(
    definition,
    registry,
    label = 'enemyDefinition'
) {
    requirePlainObject(definition, label);
    const ids = normalizeEnemyCapabilityIds(
        definition.capabilityIds,
        `${label}.capabilityIds`
    );
    const resolvedRegistry = assertEnemyCapabilityImplementationRegistry(registry);
    for (const capabilityId of ids) {
        const implementation = resolvedRegistry.byCapabilityId[capabilityId];
        if (!implementation) {
            throw new RangeError(
                `${label}.capabilityIds의 implementation이 등록되지 않았습니다: ${capabilityId}`
            );
        }
        implementation.assertDefinition?.(definition);
    }
    return ids;
}
