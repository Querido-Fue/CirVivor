import {
    ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID,
    normalizeEnemyAtomicTransformTopologyId
} from './enemy_atomic_transform_contract.js';

const INVALID_UINT32_COMPONENT = 0xffffffff;

export const JORANG_SPLIT_CHILD_COUNT = 2;
export const JORANG_SPLIT_BOUNTY_BUDGET_MAXIMUM = 0xffffffff;
export const BASIC_JORANG_ENEMY_DEFINITION_ID = 'basic_gen_01';
export const BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID = 'basic_circle_prime_01';
export const JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID = (
    'jorang-one-to-many-01'
);
export const CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID = (
    'circle-prime-return-delayed-01'
);

export const JORANG_SPLIT_TRIGGER_POLICY = Object.freeze({
    // Current production: positive-damage CLOSEST_ONLY projectile contact와
    // positive self-hit budget을 모두 증명한 exact hit만 포함합니다.
    FIRST_VALID_PROJECTILE_HIT: 'first-valid-projectile-hit',
    DELAYED_EXACT_HANDLE: 'delayed-exact-handle'
});

export const JORANG_SPLIT_KINEMATICS_POLICY = Object.freeze({
    COPY_EXACT_GPU_POSE_VELOCITY_FLOW: 'copy-exact-gpu-pose-velocity-flow',
    PRESERVE_EXACT_GPU_POSE_VELOCITY_FLOW: 'preserve-exact-gpu-pose-velocity-flow'
});

export const JORANG_SPLIT_HEALTH_POLICY = Object.freeze({
    FRESH_FULL_COMMON_CIRCLE: 'fresh-full-common-circle',
    PRESERVE_CURRENT_AND_MAXIMUM: 'preserve-current-and-maximum'
});

export const JORANG_SPLIT_BOUNTY_POLICY = Object.freeze({
    UINT32_CHILD_ZERO_REMAINDER: 'uint32-child-zero-remainder',
    PRESERVE_BRANCH: 'preserve-branch'
});

export const JORANG_SPLIT_EFFECT_POLICY = Object.freeze({
    EXACT_INSTANCES_TO_CHILD_ZERO_ONLY: 'exact-instances-to-child-zero-only',
    PRESERVE_EXACT_INSTANCES: 'preserve-exact-instances'
});

export const JORANG_SPLIT_LINEAGE_POLICY = Object.freeze({
    EXACT_ROOT_HANDLE_PAIR: 'exact-root-handle-pair'
});

export const JORANG_SPLIT_PENDING_HIT_POLICY = Object.freeze({
    ZERO_DAMAGE_NO_SOURCE_BUDGET_OR_EVENT: 'zero-damage-no-source-budget-or-event',
    NORMAL_DAMAGE: 'normal-damage'
});

export const JORANG_SPLIT_FORFEIT_POLICY = Object.freeze({
    CORE_IMPACT_CONSUMES_BRANCH_WITHOUT_BOUNTY_OR_RETURN:
        'core-impact-consumes-branch-without-bounty-or-return'
});

const PROFILE_KEYS = new Set([
    'id',
    'topologyId',
    'sourceDefinitionId',
    'destinationDefinitionId',
    'triggerPolicy',
    'kinematicsPolicy',
    'healthPolicy',
    'bountyPolicy',
    'effectPolicy',
    'lineagePolicy',
    'pendingHitPolicy',
    'forfeitPolicy'
]);

const PROFILE_POLICY_VALUES = Object.freeze({
    triggerPolicy: new Set(Object.values(JORANG_SPLIT_TRIGGER_POLICY)),
    kinematicsPolicy: new Set(Object.values(JORANG_SPLIT_KINEMATICS_POLICY)),
    healthPolicy: new Set(Object.values(JORANG_SPLIT_HEALTH_POLICY)),
    bountyPolicy: new Set(Object.values(JORANG_SPLIT_BOUNTY_POLICY)),
    effectPolicy: new Set(Object.values(JORANG_SPLIT_EFFECT_POLICY)),
    lineagePolicy: new Set(Object.values(JORANG_SPLIT_LINEAGE_POLICY)),
    pendingHitPolicy: new Set(Object.values(JORANG_SPLIT_PENDING_HIT_POLICY)),
    forfeitPolicy: new Set(Object.values(JORANG_SPLIT_FORFEIT_POLICY))
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

/**
 * Public/profile boundary input을 getter 실행 없이 한 번의 own-descriptor
 * snapshot으로 물질화합니다. Enumerable 여부와 무관하게 extra/symbol/accessor를
 * 모두 거절해 호출자 mutation이 검증과 반환값 사이를 갈라놓지 못하게 합니다.
 */
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

function snapshotExactDenseArray(source, expectedLength, label) {
    if (!Array.isArray(source)) {
        throw new TypeError(`${label}은 J split/C′ return profile 배열이어야 합니다.`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(source);
    const ownKeys = Reflect.ownKeys(descriptors);
    const expectedKeys = [
        ...Array.from({ length: expectedLength }, (_, index) => String(index)),
        'length'
    ];
    if (ownKeys.some((key) => typeof key === 'symbol')
        || ownKeys.length !== expectedKeys.length
        || expectedKeys.some((key) => !ownKeys.includes(key))) {
        throw new RangeError(`${label}은 extra property 없는 dense 배열이어야 합니다.`);
    }
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || lengthDescriptor.value !== expectedLength) {
        throw new RangeError(`${label}은 profile ${expectedLength}개여야 합니다.`);
    }
    return Object.freeze(Array.from({ length: expectedLength }, (_, index) => {
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

function requireUint32(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 정수여야 합니다.`);
    }
    return value;
}

function requireExactHandleComponent(value, label) {
    const component = requireUint32(value, label);
    if (component === 0 || component === INVALID_UINT32_COMPONENT) {
        throw new RangeError(`${label}은 live exact-handle component여야 합니다.`);
    }
    return component;
}

function requirePolicy(value, field, label) {
    const policy = requireNonEmptyString(value, `${label}.${field}`);
    if (!PROFILE_POLICY_VALUES[field].has(policy)) {
        throw new RangeError(`${label}.${field}는 알려진 J/C′ policy여야 합니다.`);
    }
    return policy;
}

export function normalizeJorangBountyBudget(value, label = 'bountyBudget') {
    const budget = requireUint32(value, label);
    if (budget > JORANG_SPLIT_BOUNTY_BUDGET_MAXIMUM) {
        throw new RangeError(`${label}이 J lineage budget 범위를 초과합니다.`);
    }
    return budget;
}

/** child0가 indivisible remainder를 먼저 받는 exact uint32 split입니다. */
export function splitJorangBountyBudget(value, label = 'bountyBudget') {
    const budget = normalizeJorangBountyBudget(value, label);
    const floorShare = Math.floor(budget / JORANG_SPLIT_CHILD_COUNT);
    return Object.freeze([
        normalizeJorangBountyBudget(floorShare + (budget % 2), `${label}.child0`),
        normalizeJorangBountyBudget(floorShare, `${label}.child1`)
    ]);
}

/** Hash가 아닌 root `(entityId, incarnation)` pair를 lineage authority로 보존합니다. */
export function normalizeJorangLineageRootHandle(
    source,
    label = 'lineageRootHandle'
) {
    const handle = snapshotExactOwnDataProperties(
        source,
        ['entityId', 'incarnation'],
        label
    );
    return Object.freeze({
        entityId: requireExactHandleComponent(handle.entityId, `${label}.entityId`),
        incarnation: requireExactHandleComponent(
            handle.incarnation,
            `${label}.incarnation`
        )
    });
}

export function normalizeJorangLineageBranchState(
    source,
    label = 'jorangLineageBranchState'
) {
    const state = snapshotExactOwnDataProperties(source, [
        'lineageRootEntityId',
        'lineageRootIncarnation',
        'branchIndex',
        'bountyBudget',
        'transformAtTick'
    ], label);
    const root = normalizeJorangLineageRootHandle({
        entityId: state.lineageRootEntityId,
        incarnation: state.lineageRootIncarnation
    }, `${label}.lineageRoot`);
    // lineage-global identity가 아니라 각 ONE_TO_MANY transaction의 local child order입니다.
    const branchIndex = requireUint32(state.branchIndex, `${label}.branchIndex`);
    if (branchIndex >= JORANG_SPLIT_CHILD_COUNT) {
        throw new RangeError(`${label}.branchIndex는 0 또는 1이어야 합니다.`);
    }
    const transformAtTick = requireUint32(
        state.transformAtTick,
        `${label}.transformAtTick`
    );
    if (transformAtTick === INVALID_UINT32_COMPONENT) {
        throw new RangeError(`${label}.transformAtTick은 invalid sentinel일 수 없습니다.`);
    }
    return Object.freeze({
        lineageRootEntityId: root.entityId,
        lineageRootIncarnation: root.incarnation,
        branchIndex,
        bountyBudget: normalizeJorangBountyBudget(
            state.bountyBudget,
            `${label}.bountyBudget`
        ),
        transformAtTick
    });
}

export function normalizeJorangSplitProfile(source, label = 'jorangSplitProfile') {
    const profile = snapshotExactOwnDataProperties(
        source,
        [...PROFILE_KEYS],
        label
    );
    const topologyId = normalizeEnemyAtomicTransformTopologyId(
        profile.topologyId,
        `${label}.topologyId`
    );
    if (topologyId !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
        && topologyId
            !== ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_ONE_DELAYED) {
        throw new RangeError(`${label}.topologyId는 J/C′ topology여야 합니다.`);
    }
    const normalized = {
        id: requireNonEmptyString(profile.id, `${label}.id`),
        topologyId,
        sourceDefinitionId: requireNonEmptyString(
            profile.sourceDefinitionId,
            `${label}.sourceDefinitionId`
        ),
        destinationDefinitionId: requireNonEmptyString(
            profile.destinationDefinitionId,
            `${label}.destinationDefinitionId`
        ),
        triggerPolicy: requirePolicy(profile.triggerPolicy, 'triggerPolicy', label),
        kinematicsPolicy: requirePolicy(
            profile.kinematicsPolicy,
            'kinematicsPolicy',
            label
        ),
        healthPolicy: requirePolicy(profile.healthPolicy, 'healthPolicy', label),
        bountyPolicy: requirePolicy(profile.bountyPolicy, 'bountyPolicy', label),
        effectPolicy: requirePolicy(profile.effectPolicy, 'effectPolicy', label),
        lineagePolicy: requirePolicy(profile.lineagePolicy, 'lineagePolicy', label),
        pendingHitPolicy: requirePolicy(
            profile.pendingHitPolicy,
            'pendingHitPolicy',
            label
        ),
        forfeitPolicy: requirePolicy(
            profile.forfeitPolicy,
            'forfeitPolicy',
            label
        )
    };
    const expected = topologyId === ENEMY_ATOMIC_TRANSFORM_TOPOLOGY_ID.ONE_TO_MANY
        ? {
            id: JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID,
            sourceDefinitionId: BASIC_JORANG_ENEMY_DEFINITION_ID,
            destinationDefinitionId: BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
            triggerPolicy: JORANG_SPLIT_TRIGGER_POLICY.FIRST_VALID_PROJECTILE_HIT,
            kinematicsPolicy:
                JORANG_SPLIT_KINEMATICS_POLICY.COPY_EXACT_GPU_POSE_VELOCITY_FLOW,
            healthPolicy: JORANG_SPLIT_HEALTH_POLICY.FRESH_FULL_COMMON_CIRCLE,
            bountyPolicy:
                JORANG_SPLIT_BOUNTY_POLICY.UINT32_CHILD_ZERO_REMAINDER,
            effectPolicy:
                JORANG_SPLIT_EFFECT_POLICY.EXACT_INSTANCES_TO_CHILD_ZERO_ONLY,
            lineagePolicy: JORANG_SPLIT_LINEAGE_POLICY.EXACT_ROOT_HANDLE_PAIR,
            pendingHitPolicy:
                JORANG_SPLIT_PENDING_HIT_POLICY.ZERO_DAMAGE_NO_SOURCE_BUDGET_OR_EVENT,
            forfeitPolicy:
                JORANG_SPLIT_FORFEIT_POLICY
                    .CORE_IMPACT_CONSUMES_BRANCH_WITHOUT_BOUNTY_OR_RETURN
        }
        : {
            id: CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID,
            sourceDefinitionId: BASIC_CIRCLE_PRIME_ENEMY_DEFINITION_ID,
            destinationDefinitionId: BASIC_JORANG_ENEMY_DEFINITION_ID,
            triggerPolicy: JORANG_SPLIT_TRIGGER_POLICY.DELAYED_EXACT_HANDLE,
            kinematicsPolicy:
                JORANG_SPLIT_KINEMATICS_POLICY.PRESERVE_EXACT_GPU_POSE_VELOCITY_FLOW,
            healthPolicy: JORANG_SPLIT_HEALTH_POLICY.PRESERVE_CURRENT_AND_MAXIMUM,
            bountyPolicy: JORANG_SPLIT_BOUNTY_POLICY.PRESERVE_BRANCH,
            effectPolicy: JORANG_SPLIT_EFFECT_POLICY.PRESERVE_EXACT_INSTANCES,
            lineagePolicy: JORANG_SPLIT_LINEAGE_POLICY.EXACT_ROOT_HANDLE_PAIR,
            pendingHitPolicy: JORANG_SPLIT_PENDING_HIT_POLICY.NORMAL_DAMAGE,
            forfeitPolicy:
                JORANG_SPLIT_FORFEIT_POLICY
                    .CORE_IMPACT_CONSUMES_BRANCH_WITHOUT_BOUNTY_OR_RETURN
        };
    for (const [field, value] of Object.entries(expected)) {
        if (normalized[field] !== value) {
            throw new RangeError(
                `${label}.${field}는 ${topologyId} J/C′ policy와 정확히 일치해야 합니다.`
            );
        }
    }
    return Object.freeze(normalized);
}

export function normalizeJorangSplitProfileCatalog(
    source,
    label = 'jorangSplitProfileCatalog'
) {
    const profiles = snapshotExactDenseArray(source, 2, label);
    const byId = Object.create(null);
    for (let index = 0; index < profiles.length; index++) {
        const profile = normalizeJorangSplitProfile(
            profiles[index],
            `${label}[${index}]`
        );
        if (Object.prototype.hasOwnProperty.call(byId, profile.id)) {
            throw new RangeError(`${label}에 중복 profile ID가 있습니다: ${profile.id}`);
        }
        byId[profile.id] = profile;
    }
    for (const requiredId of [
        JORANG_SPLIT_ATOMIC_TRANSFORM_PROFILE_ID,
        CIRCLE_PRIME_RETURN_ATOMIC_TRANSFORM_PROFILE_ID
    ]) {
        if (!Object.prototype.hasOwnProperty.call(byId, requiredId)) {
            throw new RangeError(`${label}에 필수 J/C′ profile이 없습니다: ${requiredId}`);
        }
    }
    return Object.freeze({ byId: Object.freeze(byId) });
}
