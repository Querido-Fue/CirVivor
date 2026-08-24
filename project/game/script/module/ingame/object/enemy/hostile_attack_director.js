import {
    INGAME_ENEMY_DEFINITION_BY_ID
} from 'data/object/enemy/basic_circle_enemy_data.js';
import {
    HOSTILE_ATTACK_DEFINITION_BY_ID
} from 'data/object/enemy/archer_attack_data.js';
import {
    BASIC_RHOM_ATTACK_DEFINITION_BY_ID,
    HOSTILE_RANGED_DISTANCE_POLICY_ID,
    HOSTILE_RANGED_MOVEMENT_POLICY_ID,
    HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID,
    HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID
} from 'data/object/enemy/basic_rhom_attack_data.js';
import {
    HOSTILE_ATTACK_RUNTIME_DATA
} from 'data/object/enemy/hostile_attack_runtime_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from 'data/object/projectile/hostile_basic_bullet_data.js';
import {
    HOSTILE_RHOM_PROJECTILE_DATA
} from 'data/object/projectile/hostile_rhom_projectile_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_TARGET_POLICY_ID
} from '../../contract/projectile_target_policy_contract.js';
import {
    createEnemyCapabilityMask,
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    GPU_PROJECTILE_SPAWN_MODE,
    GpuProjectileSpawnAdapter
} from '../projectile/gpu_projectile_spawn_adapter.js';
import {
    GPU_BODY_CONTROL_PROGRAM_RESULT,
    GPU_BODY_CONTROL_SELECTED_TARGET_KIND,
    GPU_BODY_CONTROL_STATE_FLAGS
} from '../../physics/gpu/gpu_fixed_primitive_abi.js';
import {
    GPU_CORE_PROXY_DEFINITION_ID,
    GPU_CORE_PROXY_WORLD_KIND_ID
} from '../core/gpu_core_proxy_spawn_adapter.js';
import {
    GPU_TOWER_DEFINITION_ID,
    GPU_TOWER_WORLD_KIND_ID
} from '../tower/gpu_tower_spawn_adapter.js';
import {
    ENEMY_LIFECYCLE_DISPOSITION_ID
} from '../../contract/enemy_lifecycle_disposition_contract.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMPLETION_HISTORY_CAPACITY = 2048;
const EMPTY_COMMAND_IDS = Object.freeze([]);
const CURRENT_TOWER_TARGET_POLICY = 'current-single-living-tower';
const CAST_START_TARGET_SNAPSHOT_POLICY = 'cast-start-exact-handle';
const GPU_DEATH_EVENT_TYPE = 'death';
const GPU_DEATH_DISPOSITION = 'despawn-requested';
const HOSTILE_ATTACK_TARGET_MODE = Object.freeze({
    CURRENT_TOWER: 'current-tower',
    CORE_PRIORITY_SELECTED: 'core-priority-selected'
});

export const HOSTILE_ATTACK_COMMAND_NAMESPACE = 'gpu-hostile-archer-shot';
export const HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE
    = 'gpu-hostile-rhom-priority-control';
export const HOSTILE_ATTACK_SHOT_STATE = Object.freeze({
    IDLE: 'IDLE',
    REQUESTED_FOR_FIXED_TICK: 'REQUESTED_FOR_FIXED_TICK',
    GPU_RESOLVE_PENDING: 'GPU_RESOLVE_PENDING'
});

const DEFAULT_HOSTILE_ENEMY_DEFINITION_BY_ID = INGAME_ENEMY_DEFINITION_BY_ID;
const DEFAULT_HOSTILE_ATTACK_DEFINITION_BY_ID = Object.freeze({
    ...HOSTILE_ATTACK_DEFINITION_BY_ID,
    ...BASIC_RHOM_ATTACK_DEFINITION_BY_ID
});
const DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID = Object.freeze({
    [HOSTILE_BASIC_BULLET_DATA.id]: HOSTILE_BASIC_BULLET_DATA,
    [HOSTILE_RHOM_PROJECTILE_DATA.id]: HOSTILE_RHOM_PROJECTILE_DATA
});

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireExactIdentityComponent(value, label) {
    const number = requirePositiveSafeInteger(value, label);
    if (number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작아야 합니다.`);
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

function requirePositiveFloat32(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)
        || !Number.isFinite(Math.fround(number))
        || Math.fround(number) <= 0) {
        throw new RangeError(`${label}은 양의 유한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function requireFiniteFloat32(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
        throw new RangeError(`${label}은 유한한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function freezeHandle(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 exact handle 객체여야 합니다.`);
    }
    return Object.freeze({
        entityId: requireExactIdentityComponent(source.entityId, `${label}.entityId`),
        incarnation: requireExactIdentityComponent(
            source.incarnation,
            `${label}.incarnation`
        )
    });
}

function sameHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

function handleKey(handle) {
    return `${handle.entityId}:${handle.incarnation}`;
}

function freezeVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return Object.freeze({
        x: requireFiniteFloat32(source.x, `${label}.x`),
        y: requireFiniteFloat32(source.y, `${label}.y`)
    });
}

function requireCatalog(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} catalog 객체가 필요합니다.`);
    }
    return source;
}

function checkedTickSum(left, right, label) {
    const result = left + right;
    if (!Number.isSafeInteger(result) || result <= 0) {
        throw new RangeError(`${label}이 안전한 fixed tick 범위를 벗어났습니다.`);
    }
    return result;
}

function normalizeAttackDefinition(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} attack definition이 필요합니다.`);
    }
    const allegiancePolicy = requireNonEmptyString(
        source.allegiancePolicy,
        `${label}.allegiancePolicy`
    );
    const targetPolicyId = requireNonEmptyString(
        source.targetPolicyId,
        `${label}.targetPolicyId`
    );
    if (allegiancePolicy !== GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT) {
        throw new RangeError(`${label}은 inherit-subject allegiance를 사용해야 합니다.`);
    }
    const common = {
        id: requireNonEmptyString(source.id, `${label}.id`),
        sourceEnemyDefinitionId: requireNonEmptyString(
            source.sourceEnemyDefinitionId,
            `${label}.sourceEnemyDefinitionId`
        ),
        projectileDefinitionId: requireNonEmptyString(
            source.projectileDefinitionId,
            `${label}.projectileDefinitionId`
        ),
        launchSpeed: requirePositiveFloat32(
            source.launchSpeed,
            `${label}.launchSpeed`
        ),
        positionOffset: freezeVector(source.positionOffset, `${label}.positionOffset`),
        targetOffset: freezeVector(source.targetOffset, `${label}.targetOffset`),
        initialDelayTicks: requirePositiveSafeInteger(
            source.initialDelayTicks,
            `${label}.initialDelayTicks`
        ),
        intervalTicks: requirePositiveSafeInteger(
            source.intervalTicks,
            `${label}.intervalTicks`
        ),
        phaseSpreadTicks: requireNonNegativeSafeInteger(
            source.phaseSpreadTicks,
            `${label}.phaseSpreadTicks`
        ),
        allegiancePolicy,
        targetPolicyId,
        producerId: requireNonEmptyString(source.producerId, `${label}.producerId`),
        sourceAbilityId: requireNonEmptyString(
            source.sourceAbilityId,
            `${label}.sourceAbilityId`
        )
    };
    const isCorePrioritySelected = source.targetSelectionPolicy
        === HOSTILE_RANGED_TARGET_SELECTION_POLICY_ID
            .CORE_FIRST_IN_RANGE_THEN_TOWER;
    if (!isCorePrioritySelected) {
        if (targetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN) {
            throw new RangeError(
                `${label}은 Player-damageable target policy를 사용해야 합니다.`
            );
        }
        if (source.targetPolicy !== CURRENT_TOWER_TARGET_POLICY
            || source.targetSnapshotPolicy !== CAST_START_TARGET_SNAPSHOT_POLICY) {
            throw new RangeError(
                `${label}의 Tower target snapshot policy가 올바르지 않습니다.`
            );
        }
        return Object.freeze({
            ...common,
            targetMode: HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER,
            targetPolicy: source.targetPolicy,
            targetSnapshotPolicy: source.targetSnapshotPolicy
        });
    }
    if (targetPolicyId
        !== PROJECTILE_TARGET_POLICY_ID
            .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN
        || source.targetSnapshotPolicy
            !== HOSTILE_RANGED_TARGET_SNAPSHOT_POLICY_ID
                .GPU_FIXED_TICK_EXACT_PRIORITY
        || source.distancePolicy
            !== HOSTILE_RANGED_DISTANCE_POLICY_ID.TICK_START_CENTER_INCLUSIVE
        || source.movementPolicy
            !== HOSTILE_RANGED_MOVEMENT_POLICY_ID.STOP_WHILE_TARGET_IN_RANGE
        || source.towerTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN
        || source.coreTargetPolicyId
            !== PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN) {
        throw new RangeError(`${label}의 Core-priority ranged policy가 올바르지 않습니다.`);
    }
    return Object.freeze({
        ...common,
        targetMode: HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED,
        targetSelectionPolicy: source.targetSelectionPolicy,
        targetSnapshotPolicy: source.targetSnapshotPolicy,
        distancePolicy: source.distancePolicy,
        movementPolicy: source.movementPolicy,
        attackRangeTiles: requirePositiveFloat32(
            source.attackRangeTiles,
            `${label}.attackRangeTiles`
        ),
        coreDamage: requirePositiveFloat32(source.coreDamage, `${label}.coreDamage`),
        towerTargetPolicyId: source.towerTargetPolicyId,
        coreTargetPolicyId: source.coreTargetPolicyId
    });
}

function compileAttackDefinitions(
    enemyDefinitions,
    attackDefinitions,
    projectileDefinitions
) {
    const byEnemyDefinitionId = new Map();
    for (const catalogId of Object.keys(attackDefinitions)) {
        const attack = normalizeAttackDefinition(
            attackDefinitions[catalogId],
            `attackDefinitions.${catalogId}`
        );
        if (catalogId !== attack.id) {
            throw new RangeError(`attack catalog key와 definition ID가 다릅니다: ${catalogId}`);
        }
        const enemyDefinition = enemyDefinitions[attack.sourceEnemyDefinitionId];
        if (!enemyDefinition
            || enemyDefinition.id !== attack.sourceEnemyDefinitionId
            || enemyDefinition.attackDefinitionId !== attack.id) {
            throw new RangeError(
                `attack source enemy catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        const capabilityMask = createEnemyCapabilityMask(
            enemyDefinition.capabilityIds,
            `enemyDefinitions.${attack.sourceEnemyDefinitionId}.capabilityIds`
        );
        if (!hasEnemyCapability(
            capabilityMask,
            ENEMY_CAPABILITY_ID.TARGETING,
            `enemyDefinitions.${attack.sourceEnemyDefinitionId}.capabilityMask`
        )) {
            throw new RangeError(
                `attack source enemy에는 TARGETING capability가 필요합니다: ${attack.id}`
            );
        }
        const projectileDefinition = projectileDefinitions[
            attack.projectileDefinitionId
        ];
        if (!projectileDefinition
            || projectileDefinition.id !== attack.projectileDefinitionId
            || projectileDefinition.targetPolicyId !== attack.targetPolicyId
            || projectileDefinition.producerId !== attack.producerId) {
            throw new RangeError(
                `attack projectile catalog 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        if (attack.targetMode === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && (projectileDefinition.coreDamage !== attack.coreDamage
                || projectileDefinition.requiresExactSelectedTarget !== true
                || projectileDefinition.towerTargetPolicyId
                    !== attack.towerTargetPolicyId
                || projectileDefinition.coreTargetPolicyId
                    !== attack.coreTargetPolicyId)) {
            throw new RangeError(
                `Core-priority projectile metadata 연결이 올바르지 않습니다: ${attack.id}`
            );
        }
        if (byEnemyDefinitionId.has(attack.sourceEnemyDefinitionId)) {
            throw new RangeError(
                `enemy definition에 attack이 중복 연결되었습니다: ${attack.sourceEnemyDefinitionId}`
            );
        }
        byEnemyDefinitionId.set(attack.sourceEnemyDefinitionId, Object.freeze({
            attack,
            projectileDefinition,
            expectedSourceMetadata: Object.freeze({
                definitionId: enemyDefinition.id,
                enemyDefinitionId: enemyDefinition.id,
                teamId: GAMEPLAY_TEAM_ID.HOSTILE,
                capabilityMask,
                physicsProfileId: requireNonEmptyString(
                    enemyDefinition.physicsProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.physicsProfileId`
                ),
                combatProfileId: requireNonEmptyString(
                    enemyDefinition.combatProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.combatProfileId`
                ),
                behaviorProfileId: requireNonEmptyString(
                    enemyDefinition.behaviorProfileId,
                    `enemyDefinitions.${enemyDefinition.id}.behaviorProfileId`
                )
            })
        }));
    }
    if (byEnemyDefinitionId.size === 0) {
        throw new RangeError('HostileAttackDirector에는 하나 이상의 attack definition이 필요합니다.');
    }
    return Object.freeze({
        byEnemyDefinitionId
    });
}

/** Exact source identity에서 replay-stable한 attack phase를 계산합니다. */
export function computeHostileAttackPhaseOffset(options = {}) {
    const entityId = requireExactIdentityComponent(options.entityId, 'entityId');
    const incarnation = requireExactIdentityComponent(
        options.incarnation,
        'incarnation'
    );
    const spread = requireNonNegativeSafeInteger(
        options.phaseSpreadTicks,
        'phaseSpreadTicks'
    );
    if (spread === 0) {
        return 0;
    }
    let hash = Math.imul(entityId >>> 0, 0x9e3779b1)
        ^ Math.imul(incarnation >>> 0, 0x85ebca6b);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
    return (hash >>> 0) % spread;
}

/** Archer targeted shot의 모든 exact cast identity를 포함하는 command ID입니다. */
export function createHostileAttackCommandId(options = {}) {
    const sourceHandle = freezeHandle(options.sourceHandle, 'sourceHandle');
    const common = [
        HOSTILE_ATTACK_COMMAND_NAMESPACE,
        requirePositiveSafeInteger(options.sessionGeneration, 'sessionGeneration'),
        sourceHandle.entityId,
        sourceHandle.incarnation
    ];
    if (options.coreTargetHandle !== undefined
        && options.coreTargetHandle !== null) {
        const coreTargetHandle = freezeHandle(
            options.coreTargetHandle,
            'coreTargetHandle'
        );
        const towerTargetHandle = options.towerTargetHandle === undefined
            || options.towerTargetHandle === null
            ? null
            : freezeHandle(options.towerTargetHandle, 'towerTargetHandle');
        common.push(
            'selected',
            'core',
            coreTargetHandle.entityId,
            coreTargetHandle.incarnation,
            'tower',
            towerTargetHandle?.entityId ?? 'none',
            towerTargetHandle?.incarnation ?? 'none',
            'range',
            Math.fround(requirePositiveFloat32(
                options.attackRangeTiles,
                'attackRangeTiles'
            ))
        );
    } else {
        const targetHandle = freezeHandle(options.targetHandle, 'targetHandle');
        // Legacy Archer command identity를 바꾸지 않습니다.
        common.push(targetHandle.entityId, targetHandle.incarnation);
    }
    common.push(
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(options.shotSequence, 'shotSequence'),
        encodeURIComponent(requireNonEmptyString(
            options.attackDefinitionId,
            'attackDefinitionId'
        ))
    );
    return common.join(':');
}

/** M priority control의 exact candidate/range/tick/sequence/attack fingerprint입니다. */
export function createHostileAttackControlCommandId(options = {}) {
    const sourceHandle = freezeHandle(options.sourceHandle, 'sourceHandle');
    const coreTargetHandle = freezeHandle(
        options.coreTargetHandle,
        'coreTargetHandle'
    );
    const towerTargetHandle = options.towerTargetHandle === undefined
        || options.towerTargetHandle === null
        ? null
        : freezeHandle(options.towerTargetHandle, 'towerTargetHandle');
    return [
        HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE,
        requirePositiveSafeInteger(options.sessionGeneration, 'sessionGeneration'),
        sourceHandle.entityId,
        sourceHandle.incarnation,
        'core',
        coreTargetHandle.entityId,
        coreTargetHandle.incarnation,
        'tower',
        towerTargetHandle?.entityId ?? 'none',
        towerTargetHandle?.incarnation ?? 'none',
        'range',
        Math.fround(requirePositiveFloat32(
            options.attackRangeTiles,
            'attackRangeTiles'
        )),
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(
            options.selectionSequence,
            'selectionSequence'
        ),
        encodeURIComponent(requireNonEmptyString(
            options.attackDefinitionId,
            'attackDefinitionId'
        ))
    ].join(':');
}

function resolveEndpointDependency(options, methodName, explicitName) {
    if (options[explicitName] !== undefined && options[explicitName] !== null) {
        return options[explicitName];
    }
    return typeof options.endpoint?.[methodName] === 'function'
        ? options.endpoint[methodName]()
        : null;
}

function createEmptyStageResult(targetFixedTick, overrides = {}) {
    return Object.freeze({
        targetFixedTick,
        eligibleCount: 0,
        attemptedCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        deferredCount: 0,
        commandIds: EMPTY_COMMAND_IDS,
        controlAttemptedCount: 0,
        controlAcceptedCount: 0,
        controlRejectedCount: 0,
        controlCommandIds: EMPTY_COMMAND_IDS,
        recoveryRequired: false,
        protocolFailure: null,
        ...overrides
    });
}

function pushMinHeap(heap, entry, compare) {
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
        const parentIndex = (index - 1) >> 1;
        const parent = heap[parentIndex];
        if (compare(parent, entry) <= 0) {
            break;
        }
        heap[index] = parent;
        index = parentIndex;
    }
    heap[index] = entry;
}

function popMinHeap(heap, compare) {
    if (heap.length === 0) return null;
    const root = heap[0];
    const tail = heap.pop();
    if (heap.length === 0) return root;
    let index = 0;
    const halfLength = heap.length >> 1;
    while (index < halfLength) {
        let childIndex = (index << 1) + 1;
        let child = heap[childIndex];
        const rightIndex = childIndex + 1;
        if (rightIndex < heap.length
            && compare(heap[rightIndex], child) < 0) {
            childIndex = rightIndex;
            child = heap[rightIndex];
        }
        if (compare(tail, child) <= 0) {
            break;
        }
        heap[index] = child;
        index = childIndex;
    }
    heap[index] = tail;
    return root;
}

function compareShotReadyEntry(left, right) {
    return left.readyFixedTick - right.readyFixedTick
        || left.createdAtTick - right.createdAtTick
        || left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function compareShotDueEntry(left, right) {
    return left.lastAttemptOrdinal - right.lastAttemptOrdinal
        || left.nextEligibleFixedTick - right.nextEligibleFixedTick
        || left.createdAtTick - right.createdAtTick
        || left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

function comparePriorityReadyEntry(left, right) {
    return left.nextPriorityControlFixedTick
            - right.nextPriorityControlFixedTick
        || left.createdAtTick - right.createdAtTick
        || left.entityId - right.entityId
        || left.incarnation - right.incarnation;
}

/**
 * Lifecycle 결과만으로 attack-capable exact enemy roster와 targeted shot 상태를 소유합니다.
 * Endpoint commit/fixed/presentation/draw/destroy는 호출하지 않습니다.
 */
export class HostileAttackDirector {
    constructor(options = {}) {
        const endpoint = options.endpoint ?? null;
        this.registry = resolveEndpointDependency(options, 'getRegistry', 'registry');
        const backend = resolveEndpointDependency(options, 'getBackend', 'backend');
        if (!this.registry
            || typeof this.registry.has !== 'function'
            || typeof this.registry.copyEntityView !== 'function') {
            throw new TypeError('HostileAttackDirector에는 exact WorldRegistry가 필요합니다.');
        }
        if (!backend || typeof backend.hasBody !== 'function') {
            throw new TypeError('HostileAttackDirector에는 backend.hasBody()가 필요합니다.');
        }
        this.backendHasBody = (handle) => backend.hasBody(handle);
        this.readBackendEventProtocol = typeof backend.getEventProtocolState
            === 'function'
            ? () => backend.getEventProtocolState()
            : null;

        const endpointStatus = typeof endpoint?.getStatus === 'function'
            ? endpoint.getStatus()
            : null;
        this.sessionGeneration = requirePositiveSafeInteger(
            options.sessionGeneration ?? endpointStatus?.sessionGeneration,
            'sessionGeneration'
        );
        this.enemyDefinitions = requireCatalog(
            options.enemyDefinitions ?? DEFAULT_HOSTILE_ENEMY_DEFINITION_BY_ID,
            'enemyDefinitions'
        );
        const attackDefinitions = requireCatalog(
            options.attackDefinitions ?? DEFAULT_HOSTILE_ATTACK_DEFINITION_BY_ID,
            'attackDefinitions'
        );
        const projectileDefinitions = requireCatalog(
            options.projectileDefinitions
                ?? DEFAULT_HOSTILE_PROJECTILE_DEFINITION_BY_ID,
            'projectileDefinitions'
        );
        const compiled = compileAttackDefinitions(
            this.enemyDefinitions,
            attackDefinitions,
            projectileDefinitions
        );
        this.attackByEnemyDefinitionId = compiled.byEnemyDefinitionId;
        this.maximumStartsPerFixedTick = requirePositiveSafeInteger(
            options.maximumStartsPerFixedTick
                ?? HOSTILE_ATTACK_RUNTIME_DATA.MAXIMUM_STARTS_PER_FIXED_TICK,
            'maximumStartsPerFixedTick'
        );
        this.priorityControlRefreshIntervalTicks = requirePositiveSafeInteger(
            options.priorityControlRefreshIntervalTicks
                ?? HOSTILE_ATTACK_RUNTIME_DATA
                    .PRIORITY_CONTROL_REFRESH_INTERVAL_TICKS,
            'priorityControlRefreshIntervalTicks'
        );
        this.maximumPriorityControlRefreshesPerFixedTick
            = requirePositiveSafeInteger(
                options.maximumPriorityControlRefreshesPerFixedTick
                    ?? HOSTILE_ATTACK_RUNTIME_DATA
                        .MAXIMUM_PRIORITY_CONTROL_REFRESHES_PER_FIXED_TICK,
                'maximumPriorityControlRefreshesPerFixedTick'
            );

        this.projectileSpawnAdapter = options.projectileSpawnAdapter
            ?? new GpuProjectileSpawnAdapter(endpoint, {
                commandNamespace: HOSTILE_ATTACK_COMMAND_NAMESPACE
            });
        if (typeof this.projectileSpawnAdapter?.requestProjectile !== 'function') {
            throw new TypeError(
                'HostileAttackDirector에는 projectileSpawnAdapter.requestProjectile()이 필요합니다.'
            );
        }
        this.priorityTargetControlPort = options.priorityTargetControlPort
            ?? endpoint;
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_COMPLETION_HISTORY_CAPACITY,
            'historyCapacity'
        );

        this.recordsByHandle = new Map();
        this.currentTowerSourceCount = 0;
        this.corePrioritySourceCount = 0;
        this.sourceAuditIterator = null;
        this.shotReadyHeap = [];
        this.shotDueHeaps = {
            [HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER]: [],
            [HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED]: []
        };
        this.shotDueCounts = {
            [HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER]: 0,
            [HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED]: 0
        };
        this.priorityReadyHeap = [];
        this.maximumSourceAuditsPerFixedTick = Math.max(
            this.maximumStartsPerFixedTick,
            this.maximumPriorityControlRefreshesPerFixedTick
        );
        this.pendingByCommandId = new Map();
        this.pendingControlsByCommandId = new Map();
        this.committedGpuDeathsByHandle = new Map();
        this.committedGpuDeathHandleKeys = [];
        this.committedGpuDeathHandleHead = 0;
        this.committedLifecycleDespawnsByHandle = new Map();
        this.committedLifecycleDespawnHandleKeys = [];
        this.committedLifecycleDespawnHandleHead = 0;
        this.terminalCommands = new Map();
        this.terminalCommandIds = [];
        this.terminalCommandHead = 0;
        this.lastBudgetFixedTick = 0;
        this.startAttemptsInBudgetTick = 0;
        this.nextAttemptOrdinal = 1;
        this.nextAcceptedAttemptOrdinal = 1;
        this.protocolFailure = null;
        this.recoveryRequired = false;
        this.lastStageResult = createEmptyStageResult(0);
        this.telemetry = this.#createTelemetry();
        this.destroyed = false;
    }

    /** Completed GPU death를 shot staging보다 먼저 exact roster에 반영합니다. */
    observeCompletedEvents(snapshot = {}) {
        this.#assertUsable();
        let observedDeathCount = 0;
        let removedSourceCount = 0;
        let removedArcherCount = 0;
        if (snapshot?.protocolFailure) {
            this.#fail(
                'completed-events',
                'upstream-protocol-failure',
                'GPU completed event snapshot에 protocol failure가 있습니다.'
            );
        }
        const deathEvents = Array.isArray(snapshot?.deathEvents)
            ? snapshot.deathEvents
            : Array.isArray(snapshot?.events)
                ? snapshot.events.filter((event) => event?.type === 'death')
                : [];
        if (!this.recoveryRequired) {
            for (const event of deathEvents) {
                if (event?.type !== undefined && event.type !== 'death') {
                    continue;
                }
                if (event?.disposition === 'stale'
                    || event?.disposition === 'duplicate') {
                    continue;
                }
                const eventSessionGeneration = event?.sessionGeneration;
                if (eventSessionGeneration !== undefined
                    && eventSessionGeneration !== this.sessionGeneration) {
                    this.telemetry.staleOldSessionResults++;
                    continue;
                }
                observedDeathCount++;
                try {
                    const handle = freezeHandle(event, 'deathEvent');
                    const record = this.recordsByHandle.get(handleKey(handle));
                    const isCorePrioritySource = record?.attack.targetMode
                        === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED;
                    const committedGpuDeath = isCorePrioritySource
                        ? this.#rememberCommittedGpuDeath(event, handle)
                        : false;
                    // M은 late priority-control/selected-shot 결과를 정상 종결할
                    // exact terminal 증거가 먼저 materialize되어야 roster에서
                    // 제거할 수 있습니다. Backend protocol을 읽는 짧은 순간에
                    // death proof를 인증하지 못했다면 record를 유지해, 뒤따르는
                    // canonical lifecycle commit이 exact stale/unique-command
                    // 증거를 저장하고 같은 경계에서 제거하도록 합니다.
                    if ((!isCorePrioritySource || committedGpuDeath)
                        && this.#removeRecord(handle, 'death')) {
                        removedSourceCount++;
                        if (record?.attack.targetMode
                            === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER) {
                            removedArcherCount++;
                        }
                    }
                } catch (error) {
                    this.#fail(
                        'completed-events',
                        'death-event-contract',
                        String(error?.message ?? error)
                    );
                    break;
                }
            }
        }
        return Object.freeze({
            observedDeathCount,
            removedSourceCount,
            removedArcherCount,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        });
    }

    /** Deterministic eligible order 앞에서 data-authored budget만큼 targeted shot을 요청합니다. */
    stageForFixedTick(options = {}) {
        this.#assertUsable();
        const targetFixedTick = requirePositiveSafeInteger(
            options.targetFixedTick,
            'targetFixedTick'
        );
        if (targetFixedTick !== this.lastBudgetFixedTick) {
            if (targetFixedTick < this.lastBudgetFixedTick) {
                this.#fail(
                    'shot-stage',
                    'fixed-tick-regression',
                    `hostile attack fixed tick이 역행했습니다: ${targetFixedTick}`
                );
            }
            this.lastBudgetFixedTick = targetFixedTick;
            this.startAttemptsInBudgetTick = 0;
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }

        let removedStaleCount = this.#pruneStaleSources();
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }

        const hasCurrentTowerSource = this.currentTowerSourceCount > 0;
        const hasCorePrioritySource = this.corePrioritySourceCount > 0;
        let targetHandle = null;
        if (hasCurrentTowerSource
            && options.targetHandle !== undefined
            && options.targetHandle !== null) {
            try {
                targetHandle = freezeHandle(options.targetHandle, 'targetHandle');
            } catch (error) {
                this.#fail(
                    'shot-stage',
                    'target-handle-contract',
                    String(error?.message ?? error)
                );
            }
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }
        if (targetHandle) {
            const targetDisposition = this.#getExactActiveDisposition(targetHandle);
            if (targetDisposition === 'desync') {
                this.#fail(
                    'shot-stage',
                    'target-registry-backend-desync',
                    `target exact liveness가 불일치합니다: ${handleKey(targetHandle)}`
                );
            } else if (targetDisposition === 'stale') {
                targetHandle = null;
            }
        }
        let coreTargetHandle = null;
        let selectedTowerTargetHandle = null;
        if (hasCorePrioritySource) {
            try {
                coreTargetHandle = freezeHandle(
                    options.coreTargetHandle,
                    'coreTargetHandle'
                );
            } catch (error) {
                this.#fail(
                    'shot-stage',
                    'core-target-handle-contract',
                    String(error?.message ?? error)
                );
            }
            if (!this.recoveryRequired) {
                const coreDisposition = this.#getExactActiveDisposition(
                    coreTargetHandle
                );
                const coreView = coreDisposition === 'active'
                    ? this.registry.copyEntityView(coreTargetHandle, {})
                    : null;
                if (coreDisposition !== 'active'
                    || coreView?.kindId !== GPU_CORE_PROXY_WORLD_KIND_ID
                    || coreView?.definitionId
                        !== GPU_CORE_PROXY_DEFINITION_ID
                    || !sameHandle(coreView, coreTargetHandle)) {
                    this.#fail(
                        'shot-stage',
                        coreDisposition === 'desync'
                            ? 'core-target-registry-backend-desync'
                            : 'core-target-invalid',
                        `Core exact target이 활성 Core proxy가 아닙니다: ${handleKey(coreTargetHandle)}`
                    );
                }
            }
            if (!this.recoveryRequired
                && options.towerTargetHandle !== undefined
                && options.towerTargetHandle !== null) {
                try {
                    const candidateTowerHandle = freezeHandle(
                        options.towerTargetHandle,
                        'towerTargetHandle'
                    );
                    const towerDisposition = this.#getExactActiveDisposition(
                        candidateTowerHandle
                    );
                    const towerView = towerDisposition === 'active'
                        ? this.registry.copyEntityView(candidateTowerHandle, {})
                        : null;
                    if (towerDisposition === 'active'
                        && towerView?.kindId === GPU_TOWER_WORLD_KIND_ID
                        && towerView?.definitionId === GPU_TOWER_DEFINITION_ID
                        && sameHandle(towerView, candidateTowerHandle)) {
                        selectedTowerTargetHandle = candidateTowerHandle;
                    } else {
                        this.telemetry.invalidTowerTargets++;
                    }
                } catch {
                    // M의 Tower exact target은 invalid/stale면 absent로 간주합니다.
                    this.telemetry.invalidTowerTargets++;
                }
            }
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }
        this.#promoteShotSchedules(targetFixedTick);
        const currentTowerAvailable = targetHandle !== null;
        const corePriorityAvailable = coreTargetHandle !== null;
        const eligibleCount = (
            currentTowerAvailable
                ? this.shotDueCounts[
                    HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
                ]
                : 0
        ) + (
            corePriorityAvailable
                ? this.shotDueCounts[
                    HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
                ]
                : 0
        );

        const availableBudget = Math.max(
            0,
            this.maximumStartsPerFixedTick - this.startAttemptsInBudgetTick
        );
        const selected = [];
        let selectedStaleCount = 0;
        while (selected.length < availableBudget) {
            const record = this.#takeNextDueShotRecord({
                currentTowerAvailable,
                corePriorityAvailable
            });
            if (record === null) {
                break;
            }
            const sourceDisposition = this.#getExactActiveDisposition(
                record.handle
            );
            if (sourceDisposition === 'desync') {
                this.#fail(
                    'source-liveness',
                    'source-registry-backend-desync',
                    `Hostile source exact liveness가 불일치합니다: ${handleKey(record.handle)}`
                );
                break;
            }
            if (sourceDisposition === 'stale') {
                if (this.#removeRecord(record.handle, 'stale')) {
                    removedStaleCount++;
                    selectedStaleCount++;
                }
                continue;
            }
            selected.push(record);
        }
        const deferredCount = Math.max(
            0,
            eligibleCount - selectedStaleCount - selected.length
        );
        this.telemetry.budgetDeferred += deferredCount;

        const selectedPriorityRecords = selected.filter((record) => (
            record.attack.targetMode
                === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
        ));
        for (const record of selectedPriorityRecords) {
            this.#cancelPriorityControlSchedule(record);
        }
        const refreshRecords = this.#takeDuePriorityControlRecords(
            targetFixedTick,
            this.maximumPriorityControlRefreshesPerFixedTick
        );
        const controlRecords = [
            ...selectedPriorityRecords,
            ...refreshRecords
        ];
        controlRecords.sort((left, right) => (
            left.createdAtTick - right.createdAtTick
            || left.handle.entityId - right.handle.entityId
            || left.handle.incarnation - right.handle.incarnation
        ));
        let controlAttemptedCount = 0;
        let controlAcceptedCount = 0;
        let controlRejectedCount = 0;
        const controlCommandIds = [];
        for (const record of controlRecords) {
            const sourceDisposition = this.#getExactActiveDisposition(
                record.handle
            );
            if (sourceDisposition === 'desync') {
                this.#fail(
                    'source-liveness',
                    'source-registry-backend-desync',
                    `Hostile source exact liveness가 불일치합니다: ${handleKey(record.handle)}`
                );
                break;
            }
            if (sourceDisposition === 'stale') {
                if (this.#removeRecord(record.handle, 'stale')) {
                    removedStaleCount++;
                }
                continue;
            }
            let nextPriorityControlFixedTick;
            try {
                nextPriorityControlFixedTick = checkedTickSum(
                    targetFixedTick,
                    this.priorityControlRefreshIntervalTicks,
                    'next priority control refresh fixed tick'
                );
            } catch (error) {
                this.#fail(
                    'priority-control-request',
                    'refresh-tick-overflow',
                    String(error?.message ?? error)
                );
                break;
            }
            const controlCommandId = createHostileAttackControlCommandId({
                sessionGeneration: this.sessionGeneration,
                sourceHandle: record.handle,
                coreTargetHandle,
                towerTargetHandle: selectedTowerTargetHandle,
                attackRangeTiles: record.attack.attackRangeTiles,
                targetFixedTick,
                selectionSequence: record.shotSequence,
                attackDefinitionId: record.attack.id
            });
            controlAttemptedCount++;
            this.telemetry.controlRequestAttempts++;
            controlCommandIds.push(controlCommandId);
            let receipt;
            try {
                receipt = this.priorityTargetControlPort
                    ?.requestPriorityTargetControl?.({
                        sourceHandle: record.handle,
                        coreTargetHandle,
                        towerTargetHandle: selectedTowerTargetHandle,
                        attackRangeTiles: record.attack.attackRangeTiles,
                        targetSelectionPolicyId:
                            record.attack.targetSelectionPolicy,
                        distancePolicyId: record.attack.distancePolicy,
                        stopWhileTargetInRange: true,
                        selectionSequence: record.shotSequence,
                        attackDefinitionId: record.attack.id,
                        projectileDefinitionId:
                            record.projectileDefinition.id,
                        producerId: record.attack.producerId,
                        sourceAbilityId: record.attack.sourceAbilityId
                    }, targetFixedTick, controlCommandId) ?? Object.freeze({
                        accepted: false,
                        reason: 'priority-target-control-unavailable'
                    });
            } catch (error) {
                this.#fail(
                    'priority-control-request',
                    'request-exception',
                    String(error?.message ?? error)
                );
                controlRejectedCount++;
                this.telemetry.controlRequestRejected++;
                break;
            }
            if (receipt.accepted !== true
                || receipt.commandId !== controlCommandId
                || Number(receipt.targetFixedTick) !== targetFixedTick
                || !Number.isSafeInteger(receipt.attackFingerprint)
                || receipt.attackFingerprint <= 0) {
                controlRejectedCount++;
                this.telemetry.controlRequestRejected++;
                this.#fail(
                    'priority-control-request',
                    receipt.reason ?? 'receipt-contract',
                    `M priority control receipt가 요청과 다릅니다: ${controlCommandId}`
                );
                break;
            }
            if (this.pendingControlsByCommandId.has(controlCommandId)
                || this.pendingControlsByCommandId.size >= this.historyCapacity) {
                this.#fail(
                    'priority-control-request',
                    this.pendingControlsByCommandId.has(controlCommandId)
                        ? 'duplicate-pending-control'
                        : 'control-pending-capacity',
                    `M priority control pending을 추적할 수 없습니다: ${controlCommandId}`
                );
                break;
            }
            this.pendingControlsByCommandId.set(controlCommandId, {
                commandId: controlCommandId,
                sourceHandle: record.handle,
                sourceDefinitionId: record.definitionId,
                coreTargetHandle,
                towerTargetHandle: selectedTowerTargetHandle,
                targetFixedTick,
                selectionSequence: record.shotSequence,
                attackFingerprint: receipt.attackFingerprint,
                attackRangeTiles: record.attack.attackRangeTiles,
                attackDefinitionId: record.attack.id,
                projectileDefinitionId: record.projectileDefinition.id,
                producerId: record.attack.producerId,
                sourceAbilityId: record.attack.sourceAbilityId
            });
            record.lastControlFixedTick = targetFixedTick;
            record.lastControlCommandId = controlCommandId;
            record.nextPriorityControlFixedTick
                = nextPriorityControlFixedTick;
            this.#schedulePriorityControlRecord(record);
            controlAcceptedCount++;
            this.telemetry.controlRequestAccepted++;
        }
        if (this.recoveryRequired) {
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                controlAttemptedCount,
                controlAcceptedCount,
                controlRejectedCount,
                controlCommandIds: controlCommandIds.length > 0
                    ? Object.freeze(controlCommandIds)
                    : EMPTY_COMMAND_IDS,
                recoveryRequired: true,
                protocolFailure: this.protocolFailure
            }));
        }
        if (!targetHandle && !coreTargetHandle) {
            this.telemetry.noTargetTicks++;
            return this.#saveStageResult(createEmptyStageResult(targetFixedTick, {
                removedStaleCount,
                controlAttemptedCount,
                controlAcceptedCount,
                controlRejectedCount,
                controlCommandIds: controlCommandIds.length > 0
                    ? Object.freeze(controlCommandIds)
                    : EMPTY_COMMAND_IDS
            }));
        }

        let attemptedCount = 0;
        let acceptedCount = 0;
        let rejectedCount = 0;
        const commandIds = [];
        for (const record of selected) {
            const isCorePriority = record.attack.targetMode
                === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED;
            const commandId = createHostileAttackCommandId({
                sessionGeneration: this.sessionGeneration,
                sourceHandle: record.handle,
                ...(isCorePriority ? {
                    coreTargetHandle,
                    towerTargetHandle: selectedTowerTargetHandle,
                    attackRangeTiles: record.attack.attackRangeTiles
                } : { targetHandle }),
                targetFixedTick,
                shotSequence: record.shotSequence,
                attackDefinitionId: record.attack.id
            });
            if (!Number.isSafeInteger(this.nextAttemptOrdinal)
                || this.nextAttemptOrdinal <= 0
                || this.nextAttemptOrdinal >= Number.MAX_SAFE_INTEGER) {
                this.#fail(
                    'shot-request',
                    'attempt-ordinal-overflow',
                    'hostile attempt ordinal을 더 이상 발급할 수 없습니다.'
                );
                break;
            }
            record.lastAttemptOrdinal = this.nextAttemptOrdinal++;
            record.lastAttemptedFixedTick = targetFixedTick;
            this.startAttemptsInBudgetTick++;
            this.telemetry.requestAttempts++;
            attemptedCount++;
            commandIds.push(commandId);
            let receipt;
            try {
                const request = {
                    mode: isCorePriority
                        ? GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET
                        : GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
                    definition: record.projectileDefinition,
                    sourceHandle: record.handle,
                    ...(isCorePriority ? {
                        coreTargetHandle,
                        towerTargetHandle: selectedTowerTargetHandle,
                        attackRangeTiles: record.attack.attackRangeTiles,
                        targetSelectionPolicyId:
                            record.attack.targetSelectionPolicy,
                        distancePolicyId: record.attack.distancePolicy,
                        stopWhileTargetInRange: true
                    } : { targetHandle }),
                    ownerHandle: record.handle,
                    positionOffset: record.attack.positionOffset,
                    targetOffset: record.attack.targetOffset,
                    launchSpeed: record.attack.launchSpeed,
                    allegiancePolicy: record.attack.allegiancePolicy,
                    targetPolicyId: record.attack.targetPolicyId,
                    targetFixedTick,
                    spawnSequence: record.shotSequence,
                    producerId: record.attack.producerId,
                    sourceAbilityId: record.attack.sourceAbilityId,
                    commandId
                };
                receipt = this.projectileSpawnAdapter.requestProjectile(request);
            } catch (error) {
                this.#fail(
                    'shot-request',
                    'request-exception',
                    String(error?.message ?? error)
                );
                rejectedCount++;
                break;
            }
            if (receipt?.accepted !== true) {
                this.telemetry.requestRejected++;
                rejectedCount++;
                if (receipt?.reason === 'registry-backend-desync'
                    || receipt?.reason === 'source-metadata-missing'
                    || receipt?.reason
                        === 'selected-target-fixed-primitive-unavailable') {
                    this.#fail(
                        'shot-request',
                        receipt.reason,
                        `hostile shot request exact source 계약이 깨졌습니다: ${commandId}`
                    );
                    break;
                }
                this.#scheduleShotRecord(record);
                continue;
            }
            if (receipt.commandId !== commandId
                || Number(receipt.targetFixedTick) !== targetFixedTick) {
                this.#fail(
                    'shot-request',
                    'receipt-contract',
                    `hostile shot receipt identity가 요청과 다릅니다: ${commandId}`
                );
                break;
            }
            if (!Number.isSafeInteger(this.nextAcceptedAttemptOrdinal)
                || this.nextAcceptedAttemptOrdinal <= 0
                || this.nextAcceptedAttemptOrdinal >= Number.MAX_SAFE_INTEGER) {
                this.#fail(
                    'shot-request',
                    'attempt-ordinal-overflow',
                    'hostile accepted attempt ordinal을 더 이상 발급할 수 없습니다.'
                );
                break;
            }
            const acceptedAttemptOrdinal = this.nextAcceptedAttemptOrdinal++;
            const matchingPriorityControl = isCorePriority
                ? this.pendingControlsByCommandId.get(
                    record.lastControlCommandId
                ) ?? null
                : null;
            if (isCorePriority
                && (!matchingPriorityControl
                    || matchingPriorityControl.targetFixedTick
                        !== targetFixedTick
                    || matchingPriorityControl.selectionSequence
                        !== record.shotSequence
                    || !sameHandle(
                        matchingPriorityControl.sourceHandle,
                        record.handle
                    ))) {
                this.#fail(
                    'shot-request',
                    'matching-priority-control-provenance',
                    `M shot의 accepted priority control provenance가 없습니다: ${commandId}`
                );
                break;
            }
            const pending = {
                commandId,
                state: HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK,
                sourceHandle: record.handle,
                sourceDefinitionId: record.definitionId,
                targetMode: record.attack.targetMode,
                targetHandle: isCorePriority ? null : targetHandle,
                coreTargetHandle: isCorePriority ? coreTargetHandle : null,
                towerTargetHandle: isCorePriority
                    ? selectedTowerTargetHandle
                    : targetHandle,
                targetFixedTick,
                shotSequence: record.shotSequence,
                selectionSequence: record.shotSequence,
                attackFingerprint:
                    matchingPriorityControl?.attackFingerprint ?? null,
                attackRangeTiles: isCorePriority
                    ? record.attack.attackRangeTiles
                    : null,
                attackDefinitionId: record.attack.id,
                projectileDefinitionId: record.projectileDefinition.id,
                producerId: record.attack.producerId,
                sourceAbilityId: record.attack.sourceAbilityId,
                acceptedAttemptOrdinal,
                destinationHandle: null
            };
            record.pendingCommandId = commandId;
            this.pendingByCommandId.set(commandId, pending);
            this.telemetry.requestAccepted++;
            record.lastAcceptedAttemptOrdinal = acceptedAttemptOrdinal;
            acceptedCount++;
        }
        return this.#saveStageResult(Object.freeze({
            targetFixedTick,
            eligibleCount,
            attemptedCount,
            acceptedCount,
            rejectedCount,
            deferredCount,
            commandIds: commandIds.length > 0
                ? Object.freeze(commandIds)
                : EMPTY_COMMAND_IDS,
            removedStaleCount,
            controlAttemptedCount,
            controlAcceptedCount,
            controlRejectedCount,
            controlCommandIds: controlCommandIds.length > 0
                ? Object.freeze(controlCommandIds)
                : EMPTY_COMMAND_IDS,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        }));
    }

    /** Fixed owner 결과와 lifecycle spawn/despawn 결과를 exact identity로 확정합니다. */
    observeFixedCommit(lifecycleResult = {}, fixedTick) {
        this.#assertUsable();
        const tick = requirePositiveSafeInteger(fixedTick, 'fixedTick');
        const summary = {
            fixedTick: tick,
            completedCount: 0,
            fixedAcceptedCount: 0,
            fixedRejectedCount: 0,
            controlCompletedCount: 0,
            controlRejectedCount: 0,
            controlTerminalCancelledCount: 0,
            spawnedSourceCount: 0,
            spawnedArcherCount: 0,
            removedSourceCount: 0,
            removedArcherCount: 0,
            staleResultCount: 0
        };
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }
        if (lifecycleResult?.fixedTick !== undefined
            && Number(lifecycleResult.fixedTick) !== tick) {
            this.#fail(
                'fixed-commit',
                'fixed-tick-contract',
                `lifecycle fixed tick이 관찰 tick과 다릅니다: ${lifecycleResult.fixedTick}/${tick}`
            );
            return this.#freezeObservationSummary(summary);
        }
        const fixedCommands = lifecycleResult?.fixedCommands ?? null;
        if (fixedCommands?.protocolFailure) {
            this.#fail(
                'fixed-commit',
                'upstream-fixed-protocol-failure',
                String(fixedCommands.protocolFailure.message
                    ?? fixedCommands.protocolFailure.code
                    ?? 'fixed command protocol failure')
            );
            return this.#freezeObservationSummary(summary);
        }
        const lifecycleContext = this.#preflightLifecycleDespawns(
            lifecycleResult,
            tick
        );
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        const observedCurrentCommands = new Set();
        const priorityControlResults = fixedCommands
            ?.priorityTargetControlResults ?? [];
        if (!Array.isArray(priorityControlResults)) {
            this.#fail(
                'priority-control-completion',
                'result-family-contract',
                'priorityTargetControlResults 배열이 필요합니다.'
            );
            return this.#freezeObservationSummary(summary);
        }
        for (const controlResult of priorityControlResults) {
            const classification = this.#classifyResultCommand(
                controlResult?.commandId
            );
            if (classification.domain === 'unrelated') {
                continue;
            }
            if (classification.session === 'stale') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (classification.domain !== 'control') {
                this.#fail(
                    'priority-control-completion',
                    'result-family-contract',
                    `shot command가 priority control family에 있습니다: ${controlResult.commandId}`
                );
                break;
            }
            if (observedCurrentCommands.has(controlResult.commandId)) {
                this.#fail(
                    'priority-control-completion',
                    'duplicate-result-entry',
                    `한 fixed result에 control command가 중복되었습니다: ${controlResult.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(controlResult.commandId);
            if (this.#observePriorityControlCompletion(
                controlResult,
                lifecycleContext
            )) {
                summary.controlCompletedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }
        for (const completion of fixedCommands?.completed ?? []) {
            const classification = this.#classifyResultCommand(
                completion?.commandId
            );
            if (classification.domain === 'unrelated') {
                continue;
            }
            if (classification.session === 'stale') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (classification.domain !== 'shot') {
                this.#fail(
                    'fixed-completion',
                    'result-family-contract',
                    `control command가 spawn completion family에 있습니다: ${completion.commandId}`
                );
                break;
            }
            if (observedCurrentCommands.has(completion.commandId)) {
                this.#fail(
                    'fixed-completion',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${completion.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(completion.commandId);
            if (this.#observeCompletion(completion, lifecycleContext)) {
                summary.completedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        const fixedAcceptedSpawns = [
            ...(fixedCommands?.sourceRelativeSpawns ?? []),
            ...(fixedCommands?.selectedTargetSpawns ?? [])
        ];
        for (const accepted of fixedAcceptedSpawns) {
            const classification = this.#classifyResultCommand(
                accepted?.commandId
            );
            if (classification.domain === 'unrelated') {
                continue;
            }
            if (classification.session === 'stale') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (classification.domain !== 'shot') {
                this.#fail(
                    'fixed-commit',
                    'result-family-contract',
                    `control command가 spawn acceptance family에 있습니다: ${accepted.commandId}`
                );
                break;
            }
            if (observedCurrentCommands.has(accepted.commandId)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${accepted.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(accepted.commandId);
            if (this.#observeFixedAcceptance(accepted, tick)) {
                summary.fixedAcceptedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const rejected of fixedCommands?.rejected ?? []) {
            const classification = this.#classifyResultCommand(
                rejected?.commandId
            );
            if (classification.domain === 'unrelated') {
                continue;
            }
            if (classification.session === 'stale') {
                this.telemetry.staleOldSessionResults++;
                summary.staleResultCount++;
                continue;
            }
            if (observedCurrentCommands.has(rejected.commandId)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-result-entry',
                    `한 fixed result에 command가 중복되었습니다: ${rejected.commandId}`
                );
                break;
            }
            observedCurrentCommands.add(rejected.commandId);
            if (classification.domain === 'control') {
                if (this.#observePriorityControlRejection(
                    rejected,
                    tick,
                    lifecycleContext
                )) {
                    summary.controlRejectedCount++;
                }
            } else if (this.#observeFixedRejection(
                rejected,
                tick,
                lifecycleContext
            )) {
                summary.fixedRejectedCount++;
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        const terminalCancelled = fixedCommands?.ingressOpen === false;
        if (terminalCancelled) {
            for (const pending of this.pendingControlsByCommandId.values()) {
                this.#rememberTerminalCommand(
                    pending.commandId,
                    `control:terminal-cancelled:${fixedCommands.ingressCloseReason
                        ?? 'gameplay-ingress-closed'}`
                );
                summary.controlTerminalCancelledCount++;
                this.telemetry.controlTerminalCancelled++;
            }
            this.pendingControlsByCommandId.clear();
            for (const pending of Array.from(this.pendingByCommandId.values())) {
                this.#clearPending(
                    pending,
                    `terminal-cancelled:${fixedCommands.ingressCloseReason
                        ?? 'gameplay-ingress-closed'}`
                );
                this.telemetry.shotTerminalCancelled++;
            }
        } else if (fixedCommands
            && fixedCommands.priorityTargetControlCompletedThroughTick
                !== undefined) {
            const completedThroughTick = Number(
                fixedCommands.priorityTargetControlCompletedThroughTick
            );
            if (!Number.isSafeInteger(completedThroughTick)
                || completedThroughTick < 0) {
                this.#fail(
                    'priority-control-completion',
                    'completed-through-contract',
                    'priority control completed-through tick이 유효하지 않습니다.'
                );
            } else {
                for (const pending of this.pendingControlsByCommandId.values()) {
                    if (pending.targetFixedTick <= completedThroughTick
                        && !observedCurrentCommands.has(pending.commandId)) {
                        this.#fail(
                            'priority-control-completion',
                            'missing-control-result',
                            `accepted priority control 결과가 없습니다: ${pending.commandId}`
                        );
                        break;
                    }
                }
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        if (fixedCommands
            && fixedCommands.state !== 'stalled'
            && fixedCommands.recoveryRequired !== true) {
            for (const pending of this.pendingByCommandId.values()) {
                if (pending.state === HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK
                    && pending.targetFixedTick === tick
                    && !observedCurrentCommands.has(pending.commandId)) {
                    this.#fail(
                        'fixed-commit',
                        'missing-fixed-result',
                        `accepted inbox shot의 fixed 결과가 없습니다: ${pending.commandId}`
                    );
                    break;
                }
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const despawned of lifecycleContext.despawned) {
            const handle = despawned.handle;
            const record = this.recordsByHandle.get(handleKey(handle));
            if (this.#removeRecord(handle, 'despawn')) {
                summary.removedSourceCount++;
                if (record?.attack.targetMode
                    === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER) {
                    summary.removedArcherCount++;
                }
            }
        }
        if (this.recoveryRequired) {
            return this.#freezeObservationSummary(summary);
        }

        for (const spawned of lifecycleResult?.spawned ?? []) {
            const targetMode = this.#observeSpawn(spawned, tick);
            if (targetMode) {
                summary.spawnedSourceCount++;
                if (targetMode === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER) {
                    summary.spawnedArcherCount++;
                }
            }
            if (this.recoveryRequired) {
                break;
            }
        }
        return this.#freezeObservationSummary(summary);
    }

    getStatus() {
        const records = Array.from(this.recordsByHandle.values());
        records.sort((left, right) => (
            left.createdAtTick - right.createdAtTick
            || left.handle.entityId - right.handle.entityId
            || left.handle.incarnation - right.handle.incarnation
        ));
        const sources = Object.freeze(records.map((record) => Object.freeze({
            handle: record.handle,
            definitionId: record.definitionId,
            attackDefinitionId: record.attack.id,
            targetMode: record.attack.targetMode,
            createdAtTick: record.createdAtTick,
            phaseOffsetTicks: record.phaseOffsetTicks,
            nextEligibleFixedTick: record.nextEligibleFixedTick,
            shotSequence: record.shotSequence,
            lastAttemptOrdinal: record.lastAttemptOrdinal,
            lastAcceptedAttemptOrdinal: record.lastAcceptedAttemptOrdinal,
            lastControlFixedTick: record.lastControlFixedTick,
            lastControlCommandId: record.lastControlCommandId,
            state: record.pendingCommandId
                ? this.pendingByCommandId.get(record.pendingCommandId)?.state
                    ?? HOSTILE_ATTACK_SHOT_STATE.IDLE
                : HOSTILE_ATTACK_SHOT_STATE.IDLE,
            pendingCommandId: record.pendingCommandId
        })));
        // Archer-only compatibility alias. Canonical roster는 sources입니다.
        const archers = Object.freeze(sources.filter(({ targetMode }) => (
            targetMode === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
        )));
        const pendingShots = Object.freeze(
            Array.from(this.pendingByCommandId.values(), (pending) => Object.freeze({
                commandId: pending.commandId,
                state: pending.state,
                sourceHandle: pending.sourceHandle,
                targetHandle: pending.targetHandle,
                targetMode: pending.targetMode,
                coreTargetHandle: pending.coreTargetHandle,
                towerTargetHandle: pending.towerTargetHandle,
                targetFixedTick: pending.targetFixedTick,
                shotSequence: pending.shotSequence,
                attackDefinitionId: pending.attackDefinitionId,
                acceptedAttemptOrdinal: pending.acceptedAttemptOrdinal,
                destinationHandle: pending.destinationHandle
            }))
        );
        const pendingControls = Array.from(
            this.pendingControlsByCommandId.values()
        );
        pendingControls.sort((left, right) => (
            left.targetFixedTick - right.targetFixedTick
            || left.sourceHandle.entityId - right.sourceHandle.entityId
            || left.sourceHandle.incarnation - right.sourceHandle.incarnation
            || left.commandId.localeCompare(right.commandId)
        ));
        const frozenPendingControls = Object.freeze(
            pendingControls.map((pending) => Object.freeze({
                commandId: pending.commandId,
                sourceHandle: pending.sourceHandle,
                sourceDefinitionId: pending.sourceDefinitionId,
                coreTargetHandle: pending.coreTargetHandle,
                towerTargetHandle: pending.towerTargetHandle,
                targetFixedTick: pending.targetFixedTick,
                selectionSequence: pending.selectionSequence,
                attackFingerprint: pending.attackFingerprint,
                attackRangeTiles: pending.attackRangeTiles,
                attackDefinitionId: pending.attackDefinitionId
            }))
        );
        return Object.freeze({
            sessionGeneration: this.sessionGeneration,
            maximumStartsPerFixedTick: this.maximumStartsPerFixedTick,
            priorityControlRefreshIntervalTicks:
                this.priorityControlRefreshIntervalTicks,
            maximumPriorityControlRefreshesPerFixedTick:
                this.maximumPriorityControlRefreshesPerFixedTick,
            activeSourceCount: records.length,
            activeArcherCount: archers.length,
            pendingShotCount: pendingShots.length,
            pendingControlCount: frozenPendingControls.length,
            committedGpuDeathCount: this.committedGpuDeathsByHandle.size,
            committedGpuDeathCapacity: this.historyCapacity,
            committedLifecycleDespawnCount:
                this.committedLifecycleDespawnsByHandle.size,
            committedLifecycleDespawnCapacity: this.historyCapacity,
            terminalHistoryCount: this.terminalCommands.size,
            terminalHistoryCapacity: this.historyCapacity,
            shotStartAttemptCount: this.telemetry.requestAttempts,
            shotRequestAcceptedCount: this.telemetry.requestAccepted,
            shotResolvedCount: this.telemetry.completedResolved,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure,
            lastStageResult: this.lastStageResult,
            sources,
            archers,
            pendingShots,
            pendingControls: frozenPendingControls,
            telemetry: Object.freeze({ ...this.telemetry }),
            destroyed: this.destroyed
        });
    }

    /** Fixed owner와 같은 fail-closed query seam이며 roster/status 복사를 만들지 않습니다. */
    requiresRecovery() {
        return this.recoveryRequired;
    }

    /** 같은 binding의 transient roster/pending을 비우며 abandoned completion은 bounded stale로 기억합니다. */
    reset() {
        this.#assertUsable();
        for (const pending of this.pendingByCommandId.values()) {
            this.#rememberTerminalCommand(pending.commandId, 'abandoned-reset');
        }
        for (const pending of this.pendingControlsByCommandId.values()) {
            this.#rememberTerminalCommand(
                pending.commandId,
                'control:abandoned-reset'
            );
        }
        this.recordsByHandle.clear();
        this.currentTowerSourceCount = 0;
        this.corePrioritySourceCount = 0;
        this.sourceAuditIterator = null;
        this.#clearShotSchedules();
        this.priorityReadyHeap.length = 0;
        this.pendingByCommandId.clear();
        this.pendingControlsByCommandId.clear();
        this.committedGpuDeathsByHandle.clear();
        this.committedGpuDeathHandleKeys.length = 0;
        this.committedGpuDeathHandleHead = 0;
        this.committedLifecycleDespawnsByHandle.clear();
        this.committedLifecycleDespawnHandleKeys.length = 0;
        this.committedLifecycleDespawnHandleHead = 0;
        this.lastBudgetFixedTick = 0;
        this.startAttemptsInBudgetTick = 0;
        this.nextAttemptOrdinal = 1;
        this.nextAcceptedAttemptOrdinal = 1;
        this.protocolFailure = null;
        this.recoveryRequired = false;
        this.lastStageResult = createEmptyStageResult(0);
        this.telemetry.resets++;
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.recordsByHandle.clear();
        this.currentTowerSourceCount = 0;
        this.corePrioritySourceCount = 0;
        this.sourceAuditIterator = null;
        this.#clearShotSchedules();
        this.priorityReadyHeap.length = 0;
        this.pendingByCommandId.clear();
        this.pendingControlsByCommandId.clear();
        this.committedGpuDeathsByHandle.clear();
        this.committedGpuDeathHandleKeys.length = 0;
        this.committedGpuDeathHandleHead = 0;
        this.committedLifecycleDespawnsByHandle.clear();
        this.committedLifecycleDespawnHandleKeys.length = 0;
        this.committedLifecycleDespawnHandleHead = 0;
        this.terminalCommands.clear();
        this.terminalCommandIds.length = 0;
        this.terminalCommandHead = 0;
        this.destroyed = true;
    }

    /**
     * Lifecycle owner가 이미 exact registry/backend removal을 끝낸 결과를 roster
     * mutation 전에 한 번만 materialize합니다. unique lifecycle despawn family,
     * 현재 M record, exact post-commit stale liveness가 모두 맞는 handle만 terminal
     * source 증거입니다. CORE_IMPACT disposition은 no-bounty까지 추가 검증합니다.
     */
    #preflightLifecycleDespawns(lifecycleResult, fixedTick) {
        const source = lifecycleResult?.despawned ?? [];
        if (!Array.isArray(source)) {
            this.#fail(
                'lifecycle-despawn',
                'despawn-family-contract',
                'lifecycle despawned 배열이 필요합니다.'
            );
            return Object.freeze({
                fixedTick,
                despawned: Object.freeze([]),
                exactTerminalSourceKeys: Object.freeze([])
            });
        }
        const despawned = [];
        const exactTerminalSourceKeys = new Set();
        const seenCommandIds = new Set();
        const seenHandleKeys = new Set();
        const fixedCommands = lifecycleResult?.fixedCommands ?? null;
        const otherResultFamilies = [
            lifecycleResult?.spawned,
            lifecycleResult?.rejected,
            fixedCommands?.priorityTargetControlResults,
            fixedCommands?.completed,
            fixedCommands?.sourceRelativeSpawns,
            fixedCommands?.selectedTargetSpawns,
            fixedCommands?.rejected
        ];
        const otherFamilyCommandIds = new Set();
        for (const family of otherResultFamilies) {
            if (!Array.isArray(family)) {
                continue;
            }
            for (const entry of family) {
                if (typeof entry?.commandId === 'string'
                    && entry.commandId.length > 0) {
                    otherFamilyCommandIds.add(entry.commandId);
                }
            }
        }
        try {
            for (const raw of source) {
                const handle = freezeHandle(raw?.handle, 'despawned.handle');
                const exactHandleKey = handleKey(handle);
                const commandId = typeof raw?.commandId === 'string'
                    ? raw.commandId
                    : null;
                const reason = typeof raw?.reason === 'string'
                    ? raw.reason
                    : null;
                const disposition = typeof raw?.disposition === 'string'
                    ? raw.disposition
                    : null;
                const bountyEligible = raw?.bountyEligible;
                if (disposition
                        === ENEMY_LIFECYCLE_DISPOSITION_ID.CORE_IMPACT
                    && bountyEligible !== false) {
                    throw new RangeError(
                        `CORE_IMPACT lifecycle result가 no-bounty가 아닙니다: ${exactHandleKey}`
                    );
                }
                if (seenHandleKeys.has(exactHandleKey)) {
                    throw new RangeError(
                        `lifecycle despawn handle이 중복되었습니다: ${exactHandleKey}`
                    );
                }
                seenHandleKeys.add(exactHandleKey);
                const hasUniqueCommandId = commandId !== null
                    && commandId.length > 0;
                if (hasUniqueCommandId) {
                    if (seenCommandIds.has(commandId)) {
                        throw new RangeError(
                            `lifecycle despawn command가 중복되었습니다: ${commandId}`
                        );
                    }
                    if (otherFamilyCommandIds.has(commandId)) {
                        throw new RangeError(
                            `lifecycle despawn command가 다른 result family와 중복되었습니다: ${commandId}`
                        );
                    }
                    seenCommandIds.add(commandId);
                }
                const record = this.recordsByHandle.get(exactHandleKey);
                if (hasUniqueCommandId
                    && record?.attack.targetMode
                        === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED) {
                    const dispositionAtObservation
                        = this.#getExactActiveDisposition(handle);
                    if (dispositionAtObservation !== 'stale') {
                        throw new RangeError(
                            `committed lifecycle source가 exact stale이 아닙니다: ${exactHandleKey}/${dispositionAtObservation}`
                        );
                    }
                    if (!this.#rememberCommittedLifecycleDespawn(
                        raw,
                        handle,
                        fixedTick
                    )) {
                        break;
                    }
                    exactTerminalSourceKeys.add(exactHandleKey);
                }
                despawned.push(Object.freeze({
                    commandId,
                    handle,
                    reason,
                    disposition,
                    bountyEligible
                }));
            }
        } catch (error) {
            this.#fail(
                'lifecycle-despawn',
                'despawn-contract',
                String(error?.message ?? error)
            );
        }
        return Object.freeze({
            fixedTick,
            despawned: Object.freeze(despawned),
            exactTerminalSourceKeys: Object.freeze([
                ...exactTerminalSourceKeys
            ])
        });
    }

    /** Endpoint가 contiguous commit한 exact M death만 current protocol-bound 증거로 보관합니다. */
    #rememberCommittedGpuDeath(event, handle) {
        const sessionGeneration = Number(event?.sessionGeneration);
        const deviceGeneration = Number(event?.deviceGeneration);
        const authoritativeEpoch = Number(event?.authoritativeEpoch);
        const sourceTick = Number(event?.sourceTick);
        const sequence = Number(event?.sequence);
        if (event?.type !== GPU_DEATH_EVENT_TYPE
            || event?.eventType !== GPU_DEATH_EVENT_TYPE
            || event?.disposition !== GPU_DEATH_DISPOSITION
            || !Number.isSafeInteger(sessionGeneration)
            || sessionGeneration !== this.sessionGeneration
            || !Number.isSafeInteger(deviceGeneration)
            || deviceGeneration < 0
            || !Number.isSafeInteger(authoritativeEpoch)
            || authoritativeEpoch < 0
            || !Number.isSafeInteger(sourceTick)
            || sourceTick <= 0
            || !Number.isSafeInteger(sequence)
            || sequence < 0) {
            return false;
        }
        if (this.readBackendEventProtocol !== null) {
            let current;
            try {
                current = this.readBackendEventProtocol();
            } catch {
                return false;
            }
            if (Number(current?.sessionGeneration) !== sessionGeneration
                || Number(current?.deviceGeneration) !== deviceGeneration
                || !Number.isSafeInteger(Number(current?.authoritativeEpoch))
                || authoritativeEpoch > Number(current.authoritativeEpoch)) {
                return false;
            }
        }
        const key = handleKey(handle);
        if (this.committedGpuDeathsByHandle.has(key)) {
            return true;
        }
        this.committedGpuDeathsByHandle.set(key, Object.freeze({
            handle,
            sessionGeneration,
            deviceGeneration,
            authoritativeEpoch,
            sourceTick,
            sequence
        }));
        this.committedGpuDeathHandleKeys.push(key);
        while ((this.committedGpuDeathHandleKeys.length
                - this.committedGpuDeathHandleHead) > this.historyCapacity) {
            const forgotten = this.committedGpuDeathHandleKeys[
                this.committedGpuDeathHandleHead++
            ];
            this.committedGpuDeathsByHandle.delete(forgotten);
        }
        if (this.committedGpuDeathHandleHead >= this.historyCapacity) {
            this.committedGpuDeathHandleKeys
                = this.committedGpuDeathHandleKeys.slice(
                    this.committedGpuDeathHandleHead
                );
            this.committedGpuDeathHandleHead = 0;
        }
        this.telemetry.committedGpuDeathSources++;
        return true;
    }

    /**
     * Lifecycle commit이 exact registry/backend removal을 끝낸 M source 증거를
     * 비동기 fixed/control completion이 도착할 때까지 bounded하게 보존합니다.
     */
    #rememberCommittedLifecycleDespawn(entry, handle, fixedTick) {
        const key = handleKey(handle);
        const proof = Object.freeze({
            handle,
            commandId: entry.commandId,
            fixedTick,
            reason: typeof entry.reason === 'string' ? entry.reason : null,
            disposition: typeof entry.disposition === 'string'
                ? entry.disposition
                : null,
            bountyEligible: entry.bountyEligible
        });
        const known = this.committedLifecycleDespawnsByHandle.get(key);
        if (known) {
            if (known.commandId !== proof.commandId
                || known.fixedTick !== proof.fixedTick
                || known.reason !== proof.reason
                || known.disposition !== proof.disposition
                || known.bountyEligible !== proof.bountyEligible) {
                this.#fail(
                    'lifecycle-despawn',
                    'source-terminal-history-contradiction',
                    `M lifecycle terminal 증거가 exact handle에서 바뀌었습니다: ${key}`
                );
                return false;
            }
            return true;
        }
        this.committedLifecycleDespawnsByHandle.set(key, proof);
        this.committedLifecycleDespawnHandleKeys.push(key);
        while ((this.committedLifecycleDespawnHandleKeys.length
                - this.committedLifecycleDespawnHandleHead)
            > this.historyCapacity) {
            const forgotten = this.committedLifecycleDespawnHandleKeys[
                this.committedLifecycleDespawnHandleHead++
            ];
            this.committedLifecycleDespawnsByHandle.delete(forgotten);
        }
        if (this.committedLifecycleDespawnHandleHead >= this.historyCapacity) {
            this.committedLifecycleDespawnHandleKeys
                = this.committedLifecycleDespawnHandleKeys.slice(
                    this.committedLifecycleDespawnHandleHead
                );
            this.committedLifecycleDespawnHandleHead = 0;
        }
        this.telemetry.committedLifecycleDespawnSources++;
        return true;
    }

    #hasTerminalizedMSourceProof(sourceHandle, lifecycleContext) {
        const key = handleKey(sourceHandle);
        return lifecycleContext.exactTerminalSourceKeys.includes(key)
            || this.committedGpuDeathsByHandle.has(key)
            || this.committedLifecycleDespawnsByHandle.has(key);
    }

    /** Pending-only state도 canonical authored provenance로 재구성 가능한지 검증합니다. */
    #validateTerminalizedMSourcePending(pending, domain, lifecycleContext) {
        const attackEntry = this.attackByEnemyDefinitionId.get(
            pending?.sourceDefinitionId
        );
        const attack = attackEntry?.attack ?? null;
        const projectile = attackEntry?.projectileDefinition ?? null;
        let expectedCommandId = null;
        try {
            expectedCommandId = domain === 'control'
                ? createHostileAttackControlCommandId({
                    sessionGeneration: this.sessionGeneration,
                    sourceHandle: pending.sourceHandle,
                    coreTargetHandle: pending.coreTargetHandle,
                    towerTargetHandle: pending.towerTargetHandle,
                    attackRangeTiles: pending.attackRangeTiles,
                    targetFixedTick: pending.targetFixedTick,
                    selectionSequence: pending.selectionSequence,
                    attackDefinitionId: pending.attackDefinitionId
                })
                : createHostileAttackCommandId({
                    sessionGeneration: this.sessionGeneration,
                    sourceHandle: pending.sourceHandle,
                    coreTargetHandle: pending.coreTargetHandle,
                    towerTargetHandle: pending.towerTargetHandle,
                    attackRangeTiles: pending.attackRangeTiles,
                    targetFixedTick: pending.targetFixedTick,
                    shotSequence: pending.shotSequence,
                    attackDefinitionId: pending.attackDefinitionId
                });
        } catch (error) {
            this.#fail(
                'source-terminal-cancel',
                'source-terminal-provenance-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        const selectionSequence = domain === 'control'
            ? pending.selectionSequence
            : pending.shotSequence;
        const record = this.recordsByHandle.get(handleKey(pending.sourceHandle));
        if ((pending.targetMode !== undefined
                && pending.targetMode
                    !== HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED)
            || attack?.targetMode
                !== HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            || attack?.id !== pending.attackDefinitionId
            || projectile?.id !== pending.projectileDefinitionId
            || attack?.producerId !== pending.producerId
            || attack?.sourceAbilityId !== pending.sourceAbilityId
            || attack?.attackRangeTiles !== pending.attackRangeTiles
            || selectionSequence !== pending.selectionSequence
            || !Number.isSafeInteger(pending.attackFingerprint)
            || pending.attackFingerprint <= 0
            || expectedCommandId !== pending.commandId
            || (record !== undefined
                && (record.definitionId !== pending.sourceDefinitionId
                    || record.attack.id !== pending.attackDefinitionId
                    || record.projectileDefinition.id
                        !== pending.projectileDefinitionId
                    || record.shotSequence !== selectionSequence
                    || (domain === 'shot'
                        && record.pendingCommandId !== pending.commandId)
                    || !sameHandle(record.handle, pending.sourceHandle)))) {
            this.#fail(
                'source-terminal-cancel',
                'source-terminal-provenance-contract',
                `terminalized M ${domain} pending provenance가 canonical하지 않습니다: ${pending.commandId}`
            );
            return false;
        }
        const sourceKey = handleKey(pending.sourceHandle);
        const hasLifecycleProof
            = lifecycleContext.exactTerminalSourceKeys.includes(sourceKey)
                || this.committedLifecycleDespawnsByHandle.has(sourceKey);
        if (hasLifecycleProof) {
            const sourceDisposition = this.#getExactActiveDisposition(
                pending.sourceHandle
            );
            if (sourceDisposition !== 'stale') {
                this.#fail(
                    'source-terminal-cancel',
                    'source-terminal-liveness-contract',
                    `lifecycle-terminalized M source가 exact stale이 아닙니다: ${pending.commandId}/${sourceDisposition}`
                );
                return false;
            }
        }
        if (!this.#hasTerminalizedMSourceProof(
            pending.sourceHandle,
            lifecycleContext
        )) {
            this.#fail(
                'source-terminal-cancel',
                'source-terminal-proof-missing',
                `M source stale 결과에 exact terminal 증거가 없습니다: ${pending.commandId}`
            );
            return false;
        }
        return true;
    }

    #observeSpawn(spawned, fixedTick) {
        let handle;
        try {
            handle = freezeHandle(spawned?.handle, 'spawned.handle');
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        const registryHas = this.registry.has(handle);
        if (!registryHas) {
            const backendHas = this.backendHasBody(handle);
            this.#fail(
                'lifecycle-spawn',
                backendHas
                    ? 'spawn-registry-backend-desync'
                    : 'spawn-not-active',
                `spawned exact handle이 active가 아닙니다: ${handleKey(handle)}`
            );
            return false;
        }
        const view = this.registry.copyEntityView(handle, {});
        if (!view
            || view.entityId !== handle.entityId
            || view.incarnation !== handle.incarnation) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-view-contract',
                `spawned exact registry view가 없습니다: ${handleKey(handle)}`
            );
            return false;
        }
        if (view.kindId !== 'enemy') {
            this.telemetry.nonAttackSpawnsIgnored++;
            return false;
        }
        const attackEntry = this.attackByEnemyDefinitionId.get(view.definitionId);
        const enemyDefinition = this.enemyDefinitions[view.definitionId];
        if (!attackEntry
            || !enemyDefinition
            || enemyDefinition.id !== view.definitionId
            || enemyDefinition.attackDefinitionId !== attackEntry.attack.id) {
            this.telemetry.nonAttackSpawnsIgnored++;
            return false;
        }
        // Lifecycle에는 Formation transform destination처럼 host registry에 먼저
        // 공개되고 같은 GPU submit에서 body가 materialize되는 비-attack spawn도
        // 포함됩니다. 공격 capability/catalog을 확인하기 전에 backend parity를
        // 강제하면 unrelated H spawn을 Hostile desync로 오판합니다. 실제 A/M
        // attack source만 exact GPU body 존재를 요구해 roster authority를 유지합니다.
        if (!this.backendHasBody(handle)) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-registry-backend-desync',
                `hostile source registry/backend identity가 불일치합니다: ${handleKey(handle)}`
            );
            return false;
        }
        const expectedMetadata = attackEntry.expectedSourceMetadata;
        const metadata = view.metadata;
        if (!metadata
            || metadata.definitionId !== expectedMetadata.definitionId
            || metadata.enemyDefinitionId
                !== expectedMetadata.enemyDefinitionId
            || metadata.teamId !== expectedMetadata.teamId
            || metadata.capabilityMask !== expectedMetadata.capabilityMask
            || metadata.physicsProfileId
                !== expectedMetadata.physicsProfileId
            || metadata.combatProfileId
                !== expectedMetadata.combatProfileId
            || metadata.behaviorProfileId
                !== expectedMetadata.behaviorProfileId) {
            this.#fail(
                'lifecycle-spawn',
                'spawn-source-metadata-contract',
                `hostile source metadata가 canonical definition과 다릅니다: ${handleKey(handle)}`
            );
            return false;
        }

        const key = handleKey(handle);
        const existing = this.recordsByHandle.get(key);
        if (existing) {
            if (existing.definitionId !== view.definitionId
                || existing.createdAtTick !== view.createdAtTick) {
                this.#fail(
                    'lifecycle-spawn',
                    'duplicate-spawn-contradiction',
                    `duplicate spawn observation이 기존 record와 다릅니다: ${key}`
                );
                return false;
            }
            this.telemetry.duplicateSpawnObservations++;
            return false;
        }

        for (const record of this.recordsByHandle.values()) {
            if (record.handle.entityId !== handle.entityId
                || record.handle.incarnation === handle.incarnation) {
                continue;
            }
            const oldDisposition = this.#getExactActiveDisposition(record.handle);
            if (oldDisposition === 'active' || oldDisposition === 'desync') {
                this.#fail(
                    'lifecycle-spawn',
                    'entity-id-reuse-overlap',
                    `같은 entityId의 hostile source incarnation이 겹칩니다: ${handle.entityId}`
                );
                return false;
            }
            this.#removeRecord(record.handle, 'stale');
        }

        let createdAtTick;
        try {
            createdAtTick = requireNonNegativeSafeInteger(
                view.createdAtTick,
                'spawned.createdAtTick'
            );
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'created-tick-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (createdAtTick > fixedTick) {
            this.#fail(
                'lifecycle-spawn',
                'created-tick-future',
                `hostile source createdAtTick이 관찰 boundary보다 미래입니다: ${createdAtTick}/${fixedTick}`
            );
            return false;
        }
        const phaseOffsetTicks = computeHostileAttackPhaseOffset({
            ...handle,
            phaseSpreadTicks: attackEntry.attack.phaseSpreadTicks
        });
        let nextEligibleFixedTick;
        try {
            nextEligibleFixedTick = checkedTickSum(
                checkedTickSum(
                    createdAtTick,
                    attackEntry.attack.initialDelayTicks,
                    'first eligible fixed tick'
                ),
                phaseOffsetTicks,
                'first eligible phase fixed tick'
            );
        } catch (error) {
            this.#fail(
                'lifecycle-spawn',
                'eligible-tick-overflow',
                String(error?.message ?? error)
            );
            return false;
        }
        const record = {
            handle,
            definitionId: view.definitionId,
            createdAtTick,
            attack: attackEntry.attack,
            projectileDefinition: attackEntry.projectileDefinition,
            phaseOffsetTicks,
            nextEligibleFixedTick,
            nextPriorityControlFixedTick: createdAtTick,
            shotSequence: 0,
            pendingCommandId: null,
            lastAttemptedFixedTick: 0,
            lastAttemptOrdinal: 0,
            lastAcceptedAttemptOrdinal: 0,
            lastControlFixedTick: 0,
            lastControlCommandId: null,
            shotScheduleVersion: 0,
            shotScheduleState: null,
            priorityScheduleVersion: 0,
            priorityScheduleState: null
        };
        this.recordsByHandle.set(key, record);
        if (attackEntry.attack.targetMode
            === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER) {
            this.currentTowerSourceCount++;
        } else {
            this.corePrioritySourceCount++;
            this.#schedulePriorityControlRecord(record);
        }
        this.#scheduleShotRecord(record);
        this.telemetry.registered++;
        return attackEntry.attack.targetMode;
    }

    #observePriorityControlCompletion(entry, lifecycleContext) {
        const pending = this.pendingControlsByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'control-completion',
                entry.outcome ?? null
            );
        }
        let sourceHandle;
        let coreTargetHandle;
        let towerTargetHandle = null;
        let selectedTargetHandle = null;
        try {
            sourceHandle = freezeHandle(
                entry.sourceHandle,
                'priorityControlResult.sourceHandle'
            );
            coreTargetHandle = freezeHandle(
                entry.coreTargetHandle,
                'priorityControlResult.coreTargetHandle'
            );
            if (entry.towerTargetHandle !== null
                && entry.towerTargetHandle !== undefined) {
                towerTargetHandle = freezeHandle(
                    entry.towerTargetHandle,
                    'priorityControlResult.towerTargetHandle'
                );
            }
            if (entry.selectedTargetHandle !== null
                && entry.selectedTargetHandle !== undefined) {
                selectedTargetHandle = freezeHandle(
                    entry.selectedTargetHandle,
                    'priorityControlResult.selectedTargetHandle'
                );
            }
        } catch (error) {
            this.#fail(
                'priority-control-completion',
                'exact-handle-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        const targetFixedTick = Number(entry.targetFixedTick);
        const sourceTick = Number(entry.sourceTick);
        const selectionSequence = Number(entry.selectionSequence);
        const attackFingerprint = Number(entry.attackFingerprint);
        const result = Number(entry.result);
        const selectedTargetKind = Number(entry.selectedTargetKind);
        const stateFlags = Number(entry.stateFlags);
        const towerMatches = pending.towerTargetHandle === null
            ? towerTargetHandle === null
            : sameHandle(towerTargetHandle, pending.towerTargetHandle);
        if (targetFixedTick !== pending.targetFixedTick
            || sourceTick !== pending.targetFixedTick
            || !sameHandle(sourceHandle, pending.sourceHandle)
            || !sameHandle(coreTargetHandle, pending.coreTargetHandle)
            || !towerMatches
            || selectionSequence !== pending.selectionSequence
            || attackFingerprint !== pending.attackFingerprint
            || entry.attackRangeTiles !== pending.attackRangeTiles
            || entry.attackDefinitionId !== pending.attackDefinitionId
            || entry.projectileDefinitionId
                !== pending.projectileDefinitionId
            || entry.producerId !== pending.producerId
            || entry.sourceAbilityId !== pending.sourceAbilityId) {
            this.#fail(
                'priority-control-completion',
                'control-result-provenance-contract',
                `priority control result가 pending identity/fingerprint와 다릅니다: ${entry.commandId}`
            );
            return false;
        }

        let expectedOutcome = null;
        let expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.NONE;
        let expectedStateFlags = 0;
        let expectedSelectedTargetHandle = null;
        if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.NO_TARGET) {
            expectedOutcome = 'no-target';
            expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.ROUTE_FLOW;
        } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_SELECTED) {
            expectedOutcome = 'core';
            expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.CORE;
            expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.CORE_SELECTED;
            expectedSelectedTargetHandle = pending.coreTargetHandle;
        } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.TOWER_SELECTED) {
            expectedOutcome = 'tower';
            expectedKind = GPU_BODY_CONTROL_SELECTED_TARGET_KIND.TOWER;
            expectedStateFlags = GPU_BODY_CONTROL_STATE_FLAGS.STOP
                | GPU_BODY_CONTROL_STATE_FLAGS.TOWER_SELECTED;
            expectedSelectedTargetHandle = pending.towerTargetHandle;
        } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.SOURCE_INVALID) {
            expectedOutcome = 'source-invalid';
        } else if (result === GPU_BODY_CONTROL_PROGRAM_RESULT.CORE_INVALID) {
            expectedOutcome = 'core-invalid';
        }
        const selectedMatches = expectedSelectedTargetHandle === null
            ? selectedTargetHandle === null
            : sameHandle(selectedTargetHandle, expectedSelectedTargetHandle);
        if (expectedOutcome === null
            || entry.outcome !== expectedOutcome
            || selectedTargetKind !== expectedKind
            || stateFlags !== expectedStateFlags
            || !selectedMatches) {
            this.#fail(
                'priority-control-completion',
                'control-result-state-contract',
                `priority control result/state 조합이 올바르지 않습니다: ${entry.commandId}`
            );
            return false;
        }
        if (entry.outcome === 'core-invalid') {
            this.#fail(
                'priority-control-completion',
                entry.outcome,
                `priority control exact source/Core가 GPU에서 invalid입니다: ${entry.commandId}`
            );
            return false;
        }
        if (entry.outcome === 'source-invalid') {
            if (!this.#validateTerminalizedMSourcePending(
                pending,
                'control',
                lifecycleContext
            )) {
                return false;
            }
            this.pendingControlsByCommandId.delete(entry.commandId);
            this.#rememberTerminalCommand(
                entry.commandId,
                'control:terminal-cancelled:completion:source-invalid'
            );
            this.telemetry.sourceTerminalCancelledControls++;
            return true;
        }
        this.pendingControlsByCommandId.delete(entry.commandId);
        this.#rememberTerminalCommand(
            entry.commandId,
            `control:${entry.outcome}`
        );
        if (entry.outcome === 'no-target') {
            this.telemetry.controlCompletedNoTarget++;
        } else if (entry.outcome === 'core') {
            this.telemetry.controlCompletedCore++;
        } else {
            this.telemetry.controlCompletedTower++;
        }
        return true;
    }

    #observePriorityControlRejection(entry, fixedTick, lifecycleContext) {
        const pending = this.pendingControlsByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'control-rejected',
                entry.code ?? null
            );
        }
        const rejectionCode = String(entry.code ?? 'unknown');
        if (entry.domain !== 'control'
            || pending.targetFixedTick !== fixedTick) {
            this.#fail(
                'priority-control-rejection',
                'control-rejection-contract',
                `priority control rejection domain/tick이 pending과 다릅니다: ${entry.commandId}`
            );
            return false;
        }
        if (rejectionCode === 'stale-handle'
            || rejectionCode === 'stale-source') {
            if (!this.#validateTerminalizedMSourcePending(
                pending,
                'control',
                lifecycleContext
            )) {
                return false;
            }
            this.pendingControlsByCommandId.delete(entry.commandId);
            this.#rememberTerminalCommand(
                entry.commandId,
                `control:terminal-cancelled:rejected:${rejectionCode}`
            );
            this.telemetry.sourceTerminalCancelledControls++;
            return true;
        }
        this.#fail(
            'priority-control-rejection',
            rejectionCode,
            `accepted priority control이 fixed boundary에서 거절되었습니다: ${entry.commandId}`
        );
        return false;
    }

    #observeFixedAcceptance(entry, fixedTick) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'fixed-accepted',
                null
            );
        }
        if (pending.targetFixedTick !== fixedTick) {
            this.#fail(
                'fixed-commit',
                'accepted-tick-mismatch',
                `shot fixed acceptance tick이 request와 다릅니다: ${entry.commandId}`
            );
            return false;
        }
        let destinationHandle;
        try {
            destinationHandle = freezeHandle(entry.handle, 'sourceRelativeSpawn.handle');
        } catch (error) {
            this.#fail(
                'fixed-commit',
                'destination-handle-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (entry.state !== 'gpu-resolve-pending') {
            this.#fail(
                'fixed-commit',
                'accepted-state-contract',
                `지원하지 않는 fixed spawn state입니다: ${entry.state}`
            );
            return false;
        }
        if (pending.state === HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING) {
            if (!sameHandle(pending.destinationHandle, destinationHandle)) {
                this.#fail(
                    'fixed-commit',
                    'duplicate-acceptance-contradiction',
                    `duplicate fixed acceptance destination이 다릅니다: ${entry.commandId}`
                );
                return false;
            }
            this.telemetry.duplicateResults++;
            return false;
        }
        if (pending.state !== HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK) {
            this.#fail(
                'fixed-commit',
                'accepted-state-transition',
                `shot fixed acceptance의 이전 상태가 올바르지 않습니다: ${entry.commandId}`
            );
            return false;
        }
        pending.state = HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING;
        pending.destinationHandle = destinationHandle;
        this.telemetry.fixedAccepted++;
        return true;
    }

    #observeFixedRejection(entry, fixedTick, lifecycleContext) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'fixed-rejected',
                entry.code ?? null
            );
        }
        if (entry.domain !== 'spawn') {
            this.#fail(
                'fixed-commit',
                'rejected-domain-contract',
                `hostile shot rejection domain이 spawn이 아닙니다: ${entry.commandId}`
            );
            return false;
        }
        const rejectionCode = String(entry.code ?? 'unknown');
        if (rejectionCode === 'registry-backend-desync'
            || rejectionCode.endsWith('-desync')) {
            this.#fail(
                'fixed-commit',
                rejectionCode,
                `hostile shot fixed rejection에서 exact desync가 발생했습니다: ${entry.commandId}`
            );
            return false;
        }
        if (pending.targetFixedTick !== fixedTick
            || pending.state !== HOSTILE_ATTACK_SHOT_STATE.REQUESTED_FOR_FIXED_TICK) {
            this.#fail(
                'fixed-commit',
                'rejected-state-transition',
                `shot fixed rejection의 tick/state가 올바르지 않습니다: ${entry.commandId}`
            );
            return false;
        }
        if (pending.targetMode
                === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && (rejectionCode === 'stale-source'
                || rejectionCode === 'stale-handle')) {
            if (!this.#validateTerminalizedMSourcePending(
                pending,
                'shot',
                lifecycleContext
            )) {
                return false;
            }
            this.#clearPending(
                pending,
                `terminal-cancelled:fixed-rejected:${rejectionCode}`
            );
            this.telemetry.sourceTerminalCancelledShots++;
            return true;
        }
        this.#clearPending(pending, `fixed-rejected:${rejectionCode}`);
        this.telemetry.fixedRejected++;
        return true;
    }

    #observeCompletion(entry, lifecycleContext) {
        const pending = this.pendingByCommandId.get(entry.commandId);
        if (!pending) {
            return this.#handleUnknownCurrentResult(
                entry.commandId,
                'completion',
                entry.outcome ?? null
            );
        }
        if (pending.state !== HOSTILE_ATTACK_SHOT_STATE.GPU_RESOLVE_PENDING) {
            this.#fail(
                'fixed-completion',
                'completion-before-fixed-acceptance',
                `GPU completion이 fixed acceptance보다 먼저 왔습니다: ${entry.commandId}`
            );
            return false;
        }
        let destinationHandle;
        try {
            destinationHandle = freezeHandle(entry.handle, 'completed.handle');
        } catch (error) {
            this.#fail(
                'fixed-completion',
                'completion-handle-contract',
                String(error?.message ?? error)
            );
            return false;
        }
        if (!sameHandle(destinationHandle, pending.destinationHandle)) {
            this.#fail(
                'fixed-completion',
                'completion-destination-mismatch',
                `GPU completion destination이 pending과 다릅니다: ${entry.commandId}`
            );
            return false;
        }
        if (entry.outcome !== 'resolved'
            && entry.outcome !== 'source-invalid'
            && entry.outcome !== 'target-invalid'
            && entry.outcome !== 'no-target'
            && entry.outcome !== 'core-invalid'
            && entry.outcome !== 'tower-invalid') {
            this.#fail(
                'fixed-completion',
                'completion-outcome-contract',
                `지원하지 않는 hostile shot outcome입니다: ${entry.outcome}`
            );
            return false;
        }
        if (pending.targetMode
            === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && (entry.outcome === 'core-invalid'
                || entry.outcome === 'target-invalid')) {
            this.#fail(
                'fixed-completion',
                'core-target-invalid',
                `M shot의 exact Core target이 GPU resolve에서 invalid입니다: ${entry.commandId}`
            );
            return false;
        }
        if (pending.targetMode
            === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
            && (entry.outcome === 'no-target'
                || entry.outcome === 'core-invalid'
                || entry.outcome === 'tower-invalid')) {
            this.#fail(
                'fixed-completion',
                'completion-outcome-target-mode',
                `legacy Tower shot에 selected-target outcome이 도착했습니다: ${entry.commandId}`
            );
            return false;
        }
        if (pending.targetMode
            === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && entry.outcome === 'resolved') {
            let selectedTargetHandle;
            try {
                selectedTargetHandle = freezeHandle(
                    entry.targetHandle,
                    'completed.targetHandle'
                );
            } catch (error) {
                this.#fail(
                    'fixed-completion',
                    'selected-target-handle-contract',
                    String(error?.message ?? error)
                );
                return false;
            }
            const selectedMatches = entry.selectedTargetKind === 'core'
                ? sameHandle(selectedTargetHandle, pending.coreTargetHandle)
                : entry.selectedTargetKind === 'tower'
                    && pending.towerTargetHandle !== null
                    && sameHandle(
                        selectedTargetHandle,
                        pending.towerTargetHandle
                    );
            if (!selectedMatches) {
                this.#fail(
                    'fixed-completion',
                    'selected-target-provenance-contract',
                    `M resolved target provenance가 pending candidate와 다릅니다: ${entry.commandId}`
                );
                return false;
            }
        }
        const terminalizedSelectedSource = pending.targetMode
                === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && entry.outcome === 'source-invalid';
        if (terminalizedSelectedSource
            && !this.#validateTerminalizedMSourcePending(
                pending,
                'shot',
                lifecycleContext
            )) {
            return false;
        }

        const record = this.recordsByHandle.get(handleKey(pending.sourceHandle));
        if (entry.outcome === 'resolved' && record) {
            const sourceDisposition = this.#getExactActiveDisposition(record.handle);
            if (sourceDisposition === 'desync') {
                this.#fail(
                    'fixed-completion',
                    'source-registry-backend-desync',
                    `resolved shot source liveness가 불일치합니다: ${entry.commandId}`
                );
                return false;
            }
            if (sourceDisposition === 'stale') {
                this.#removeRecord(record.handle, 'stale');
            } else {
                if (record.pendingCommandId !== pending.commandId
                    || record.shotSequence !== pending.shotSequence) {
                    this.#fail(
                        'fixed-completion',
                        'source-shot-state-contract',
                        `resolved shot source state가 pending과 다릅니다: ${entry.commandId}`
                    );
                    return false;
                }
                let nextEligibleFixedTick;
                try {
                    nextEligibleFixedTick = checkedTickSum(
                        pending.targetFixedTick,
                        record.attack.intervalTicks,
                        'next eligible fixed tick'
                    );
                } catch (error) {
                    this.#fail(
                        'fixed-completion',
                        'cooldown-tick-overflow',
                        String(error?.message ?? error)
                    );
                    return false;
                }
                record.shotSequence++;
                record.nextEligibleFixedTick = nextEligibleFixedTick;
            }
        }

        this.#clearPending(
            pending,
            terminalizedSelectedSource
                ? 'terminal-cancelled:completion:source-invalid'
                : `completion:${entry.outcome}`
        );
        if (entry.outcome === 'resolved') {
            this.telemetry.completedResolved++;
        } else if (entry.outcome === 'source-invalid') {
            this.telemetry.completedSourceInvalid++;
            if (terminalizedSelectedSource) {
                this.telemetry.sourceTerminalCancelledShots++;
            } else {
                this.#removeRecord(pending.sourceHandle, 'source-invalid');
            }
        } else if (entry.outcome === 'no-target'
            || entry.outcome === 'tower-invalid') {
            // M no-target/Tower-invalid은 shot sequence와 cooldown을 소비하지 않습니다.
            this.telemetry.completedNoTarget++;
        } else {
            this.telemetry.completedTargetInvalid++;
        }
        return true;
    }

    #handleUnknownCurrentResult(commandId, kind, detail) {
        const terminal = this.terminalCommands.get(commandId);
        if (terminal) {
            if (terminal === 'abandoned-reset') {
                this.telemetry.staleOldSessionResults++;
                return false;
            }
            if (kind === 'completion'
                && terminal === `completion:${detail}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'fixed-rejected'
                && terminal === `fixed-rejected:${detail ?? 'unknown'}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'completion'
                && terminal
                    === `terminal-cancelled:completion:${detail}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'fixed-rejected'
                && terminal
                    === `terminal-cancelled:fixed-rejected:${detail
                        ?? 'unknown'}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            const exactShotSourceTerminal = terminal.startsWith(
                'terminal-cancelled:completion:'
            ) || terminal.startsWith(
                'terminal-cancelled:fixed-rejected:'
            );
            if ((kind === 'completion' || kind === 'fixed-rejected')
                && terminal.startsWith('terminal-cancelled:')
                && !exactShotSourceTerminal) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'control-completion'
                && terminal === `control:${detail}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'control-completion'
                && terminal
                    === `control:terminal-cancelled:completion:${detail}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'control-rejected'
                && terminal
                    === `control-rejected:${detail ?? 'unknown'}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            if (kind === 'control-rejected'
                && terminal
                    === `control:terminal-cancelled:rejected:${detail
                        ?? 'unknown'}`) {
                this.telemetry.duplicateResults++;
                return false;
            }
            const exactControlSourceTerminal = terminal.startsWith(
                'control:terminal-cancelled:completion:'
            ) || terminal.startsWith(
                'control:terminal-cancelled:rejected:'
            );
            if ((kind === 'control-completion' || kind === 'control-rejected')
                && terminal.startsWith('control:terminal-cancelled:')
                && !exactControlSourceTerminal) {
                this.telemetry.duplicateResults++;
                return false;
            }
            this.#fail(
                'fixed-result',
                'terminal-result-contradiction',
                `terminal command에 모순된 결과가 왔습니다: ${commandId}`
            );
            return false;
        }
        this.#fail(
            'fixed-result',
            'unknown-current-session-command',
            `현재 session의 알 수 없는 hostile command 결과입니다: ${commandId}`
        );
        return false;
    }

    #clearPending(pending, terminal) {
        this.pendingByCommandId.delete(pending.commandId);
        const record = this.recordsByHandle.get(handleKey(pending.sourceHandle));
        if (record?.pendingCommandId === pending.commandId) {
            record.pendingCommandId = null;
            this.#scheduleShotRecord(record);
        }
        this.#rememberTerminalCommand(pending.commandId, terminal);
    }

    #removeRecord(handle, reason) {
        const key = handleKey(handle);
        const record = this.recordsByHandle.get(key);
        if (!record) {
            return false;
        }
        this.#cancelShotSchedule(record);
        this.#cancelPriorityControlSchedule(record);
        this.recordsByHandle.delete(key);
        if (record.attack.targetMode
            === HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER) {
            this.currentTowerSourceCount--;
        } else {
            this.corePrioritySourceCount--;
        }
        if (reason === 'death') {
            this.telemetry.removedByDeath++;
        } else if (reason === 'despawn') {
            this.telemetry.removedByDespawn++;
        } else if (reason === 'source-invalid') {
            this.telemetry.removedBySourceInvalid++;
        } else {
            this.telemetry.removedAsStale++;
        }
        return true;
    }

    #clearShotSchedules() {
        this.shotReadyHeap.length = 0;
        this.shotDueHeaps[
            HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
        ].length = 0;
        this.shotDueHeaps[
            HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
        ].length = 0;
        this.shotDueCounts[
            HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
        ] = 0;
        this.shotDueCounts[
            HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
        ] = 0;
    }

    #scheduleShotRecord(record) {
        if (this.recordsByHandle.get(handleKey(record.handle)) !== record
            || record.pendingCommandId !== null) {
            return false;
        }
        if (!Number.isSafeInteger(record.shotScheduleVersion)
            || record.shotScheduleVersion < 0
            || record.shotScheduleVersion >= Number.MAX_SAFE_INTEGER) {
            this.#fail(
                'shot-schedule',
                'schedule-version-overflow',
                `Hostile shot schedule version을 전진시킬 수 없습니다: ${handleKey(record.handle)}`
            );
            return false;
        }
        if (record.shotScheduleState === 'due') {
            this.shotDueCounts[record.attack.targetMode]--;
        }
        record.shotScheduleVersion++;
        record.shotScheduleState = 'ready';
        const retryFixedTick = record.lastAttemptedFixedTick <= 0
            ? 0
            : Math.min(
                Number.MAX_SAFE_INTEGER,
                record.lastAttemptedFixedTick + 1
            );
        pushMinHeap(this.shotReadyHeap, {
            record,
            version: record.shotScheduleVersion,
            readyFixedTick: Math.max(
                record.nextEligibleFixedTick,
                retryFixedTick
            ),
            lastAttemptOrdinal: record.lastAttemptOrdinal,
            nextEligibleFixedTick: record.nextEligibleFixedTick,
            createdAtTick: record.createdAtTick,
            entityId: record.handle.entityId,
            incarnation: record.handle.incarnation
        }, compareShotReadyEntry);
        return true;
    }

    #cancelShotSchedule(record) {
        if (record.shotScheduleState === 'due') {
            this.shotDueCounts[record.attack.targetMode]--;
        }
        if (Number.isSafeInteger(record.shotScheduleVersion)
            && record.shotScheduleVersion < Number.MAX_SAFE_INTEGER) {
            record.shotScheduleVersion++;
        }
        record.shotScheduleState = null;
    }

    #isCurrentShotScheduleEntry(entry, state) {
        const record = entry?.record;
        return record !== null
            && record !== undefined
            && this.recordsByHandle.get(handleKey(record.handle)) === record
            && record.pendingCommandId === null
            && record.shotScheduleVersion === entry.version
            && record.shotScheduleState === state;
    }

    #promoteShotSchedules(targetFixedTick) {
        while (this.shotReadyHeap.length > 0) {
            const entry = this.shotReadyHeap[0];
            if (!this.#isCurrentShotScheduleEntry(entry, 'ready')) {
                popMinHeap(this.shotReadyHeap, compareShotReadyEntry);
                continue;
            }
            if (entry.readyFixedTick > targetFixedTick) {
                break;
            }
            popMinHeap(this.shotReadyHeap, compareShotReadyEntry);
            const record = entry.record;
            record.shotScheduleState = 'due';
            this.shotDueCounts[record.attack.targetMode]++;
            pushMinHeap(
                this.shotDueHeaps[record.attack.targetMode],
                entry,
                compareShotDueEntry
            );
        }
    }

    #peekCurrentDueShotEntry(targetMode) {
        const heap = this.shotDueHeaps[targetMode];
        while (heap.length > 0) {
            const entry = heap[0];
            if (this.#isCurrentShotScheduleEntry(entry, 'due')) {
                return entry;
            }
            popMinHeap(heap, compareShotDueEntry);
        }
        return null;
    }

    #takeNextDueShotRecord(options) {
        const currentTowerEntry = options.currentTowerAvailable
            ? this.#peekCurrentDueShotEntry(
                HOSTILE_ATTACK_TARGET_MODE.CURRENT_TOWER
            )
            : null;
        const corePriorityEntry = options.corePriorityAvailable
            ? this.#peekCurrentDueShotEntry(
                HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            )
            : null;
        const selectedEntry = currentTowerEntry === null
            ? corePriorityEntry
            : corePriorityEntry === null
                || compareShotDueEntry(
                    currentTowerEntry,
                    corePriorityEntry
                ) <= 0
                ? currentTowerEntry
                : corePriorityEntry;
        if (selectedEntry === null) {
            return null;
        }
        const record = selectedEntry.record;
        popMinHeap(
            this.shotDueHeaps[record.attack.targetMode],
            compareShotDueEntry
        );
        this.shotDueCounts[record.attack.targetMode]--;
        record.shotScheduleState = null;
        return record;
    }

    #schedulePriorityControlRecord(record) {
        if (record.attack.targetMode
                !== HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            || this.recordsByHandle.get(handleKey(record.handle)) !== record) {
            return false;
        }
        if (!Number.isSafeInteger(record.priorityScheduleVersion)
            || record.priorityScheduleVersion < 0
            || record.priorityScheduleVersion >= Number.MAX_SAFE_INTEGER) {
            this.#fail(
                'priority-control-schedule',
                'schedule-version-overflow',
                `M priority schedule version을 전진시킬 수 없습니다: ${handleKey(record.handle)}`
            );
            return false;
        }
        record.priorityScheduleVersion++;
        record.priorityScheduleState = 'ready';
        pushMinHeap(this.priorityReadyHeap, {
            record,
            version: record.priorityScheduleVersion,
            nextPriorityControlFixedTick:
                record.nextPriorityControlFixedTick,
            createdAtTick: record.createdAtTick,
            entityId: record.handle.entityId,
            incarnation: record.handle.incarnation
        }, comparePriorityReadyEntry);
        return true;
    }

    #cancelPriorityControlSchedule(record) {
        if (record.attack.targetMode
            !== HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED) {
            return;
        }
        if (Number.isSafeInteger(record.priorityScheduleVersion)
            && record.priorityScheduleVersion < Number.MAX_SAFE_INTEGER) {
            record.priorityScheduleVersion++;
        }
        record.priorityScheduleState = null;
    }

    #isCurrentPriorityScheduleEntry(entry) {
        const record = entry?.record;
        return record !== null
            && record !== undefined
            && this.recordsByHandle.get(handleKey(record.handle)) === record
            && record.attack.targetMode
                === HOSTILE_ATTACK_TARGET_MODE.CORE_PRIORITY_SELECTED
            && record.priorityScheduleVersion === entry.version
            && record.priorityScheduleState === 'ready';
    }

    #takeDuePriorityControlRecords(targetFixedTick, maximumCount) {
        const records = [];
        while (this.priorityReadyHeap.length > 0
            && records.length < maximumCount) {
            const entry = this.priorityReadyHeap[0];
            if (!this.#isCurrentPriorityScheduleEntry(entry)) {
                popMinHeap(
                    this.priorityReadyHeap,
                    comparePriorityReadyEntry
                );
                continue;
            }
            if (entry.nextPriorityControlFixedTick > targetFixedTick) {
                break;
            }
            popMinHeap(this.priorityReadyHeap, comparePriorityReadyEntry);
            entry.record.priorityScheduleState = null;
            records.push(entry.record);
        }
        return records;
    }

    #pruneStaleSources() {
        let removed = 0;
        const auditCount = Math.min(
            this.recordsByHandle.size,
            this.maximumSourceAuditsPerFixedTick
        );
        if (auditCount === 0) {
            this.sourceAuditIterator = null;
            return removed;
        }
        if (this.sourceAuditIterator === null) {
            this.sourceAuditIterator = this.recordsByHandle.values();
        }
        for (let index = 0; index < auditCount; index++) {
            const next = this.sourceAuditIterator.next();
            if (next.done) {
                this.sourceAuditIterator = null;
                break;
            }
            const record = next.value;
            const disposition = this.#getExactActiveDisposition(record.handle);
            if (disposition === 'desync') {
                this.#fail(
                    'source-liveness',
                    'source-registry-backend-desync',
                    `Hostile source exact liveness가 불일치합니다: ${handleKey(record.handle)}`
                );
                break;
            }
            if (disposition === 'stale' && this.#removeRecord(record.handle, 'stale')) {
                removed++;
            }
        }
        return removed;
    }

    #getExactActiveDisposition(handle) {
        const registryHas = this.registry.has(handle);
        const backendHas = this.backendHasBody(handle);
        if (registryHas !== backendHas) {
            return 'desync';
        }
        return registryHas ? 'active' : 'stale';
    }

    #classifyResultCommand(commandId) {
        const domain = typeof commandId === 'string'
                && commandId.startsWith(
                    `${HOSTILE_ATTACK_COMMAND_NAMESPACE}:`
                )
            ? 'shot'
            : typeof commandId === 'string'
                && commandId.startsWith(
                    `${HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE}:`
                )
                ? 'control'
                : 'unrelated';
        if (domain === 'unrelated') {
            return Object.freeze({ domain, session: 'unrelated' });
        }
        const namespace = domain === 'shot'
            ? HOSTILE_ATTACK_COMMAND_NAMESPACE
            : HOSTILE_ATTACK_CONTROL_COMMAND_NAMESPACE;
        const sessionText = commandId.slice(
            namespace.length + 1
        ).split(':', 1)[0];
        if (!/^[1-9][0-9]*$/.test(sessionText)) {
            this.#fail(
                'fixed-result',
                'command-session-contract',
                `hostile command session identity가 유효하지 않습니다: ${commandId}`
            );
            return Object.freeze({ domain, session: 'current' });
        }
        const sessionGeneration = Number(sessionText);
        if (!Number.isSafeInteger(sessionGeneration)
            || sessionGeneration <= 0) {
            this.#fail(
                'fixed-result',
                'command-session-contract',
                `hostile command session identity가 범위를 벗어났습니다: ${commandId}`
            );
            return Object.freeze({ domain, session: 'current' });
        }
        if (sessionGeneration < this.sessionGeneration) {
            return Object.freeze({ domain, session: 'stale' });
        }
        if (sessionGeneration > this.sessionGeneration) {
            this.#fail(
                'fixed-result',
                'future-session-command',
                `현재보다 미래 session의 hostile command 결과입니다: ${commandId}`
            );
        }
        return Object.freeze({ domain, session: 'current' });
    }

    #rememberTerminalCommand(commandId, terminal) {
        const known = this.terminalCommands.get(commandId);
        if (known) {
            if (known !== terminal) {
                this.#fail(
                    'command-history',
                    'terminal-history-contradiction',
                    `hostile command terminal 결과가 달라졌습니다: ${commandId}`
                );
            }
            return;
        }
        this.terminalCommands.set(commandId, terminal);
        this.terminalCommandIds.push(commandId);
        while ((this.terminalCommandIds.length - this.terminalCommandHead)
            > this.historyCapacity) {
            const forgotten = this.terminalCommandIds[this.terminalCommandHead++];
            this.terminalCommands.delete(forgotten);
        }
        if (this.terminalCommandHead >= this.historyCapacity) {
            this.terminalCommandIds = this.terminalCommandIds.slice(
                this.terminalCommandHead
            );
            this.terminalCommandHead = 0;
        }
    }

    #freezeObservationSummary(summary) {
        return Object.freeze({
            ...summary,
            recoveryRequired: this.recoveryRequired,
            protocolFailure: this.protocolFailure
        });
    }

    #saveStageResult(result) {
        this.lastStageResult = result;
        return result;
    }

    #fail(stage, code, message) {
        if (this.protocolFailure) {
            return;
        }
        this.protocolFailure = Object.freeze({ stage, code, message });
        this.recoveryRequired = true;
        this.telemetry.protocolFailures++;
    }

    #createTelemetry() {
        return {
            registered: 0,
            nonAttackSpawnsIgnored: 0,
            duplicateSpawnObservations: 0,
            removedByDeath: 0,
            removedByDespawn: 0,
            removedBySourceInvalid: 0,
            removedAsStale: 0,
            requestAttempts: 0,
            requestAccepted: 0,
            requestRejected: 0,
            controlRequestAttempts: 0,
            controlRequestAccepted: 0,
            controlRequestRejected: 0,
            controlCompletedNoTarget: 0,
            controlCompletedCore: 0,
            controlCompletedTower: 0,
            controlTerminalCancelled: 0,
            sourceTerminalCancelledControls: 0,
            sourceTerminalCancelledShots: 0,
            shotTerminalCancelled: 0,
            fixedAccepted: 0,
            fixedRejected: 0,
            completedResolved: 0,
            completedSourceInvalid: 0,
            completedTargetInvalid: 0,
            completedNoTarget: 0,
            invalidTowerTargets: 0,
            budgetDeferred: 0,
            noTargetTicks: 0,
            staleOldSessionResults: 0,
            committedGpuDeathSources: 0,
            committedLifecycleDespawnSources: 0,
            duplicateResults: 0,
            protocolFailures: 0,
            resets: 0
        };
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 HostileAttackDirector는 사용할 수 없습니다.');
        }
    }
}
