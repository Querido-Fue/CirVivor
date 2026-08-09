import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    encodeGpuCircleBodyFixedPoint
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_SPAWN_PROGRAM_REQUEST_FLAGS,
    GPU_SPAWN_PROGRAM_MODE
} from '../../physics/gpu/gpu_fixed_primitive_abi.js';
import {
    ARCHER_ATTACK_DATA
} from 'data/object/enemy/archer_attack_data.js';
import {
    HOSTILE_BASIC_BULLET_DATA
} from 'data/object/projectile/hostile_basic_bullet_data.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayDamagePolicyId,
    normalizeGameplayTeamId,
    resolveGameplayAllegianceTeam
} from '../../contract/gameplay_team_contract.js';
import {
    PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID,
    PROJECTILE_TARGET_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID,
    PROJECTILE_SELECTED_TARGET_POLICY_ID,
    normalizeProjectileTargetPolicyId
} from '../../contract/projectile_target_policy_contract.js';
import {
    materializeGpuPlainDataSnapshot
} from '../gpu_spawn_intent.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;
const DEFAULT_COMMAND_NAMESPACE = 'gpu-projectile';
const GPU_PROJECTILE_LAYER = GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE;

export const GPU_PROJECTILE_WORLD_KIND_ID = 'projectile';
export const GPU_PROJECTILE_SPAWN_MODE = Object.freeze({
    ABSOLUTE: 'absolute',
    SOURCE_RELATIVE_VELOCITY: 'source-relative-velocity',
    SOURCE_RELATIVE_AIM_POINT: 'source-relative-aim-point',
    SOURCE_RELATIVE_TARGET_ENTITY: 'source-relative-target-entity',
    SOURCE_RELATIVE_SELECTED_TARGET: 'source-relative-selected-target'
});
export const GPU_PROJECTILE_SELECTED_TARGET_POLICY_ID
    = PROJECTILE_SELECTED_TARGET_POLICY_ID;
export const GPU_PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
    = PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID;
export const GPU_PROJECTILE_CONTACT_HANDLER_FLAGS = Object.freeze({
    KILL_IF_OTHER_TERRAIN:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.KILL_IF_OTHER_TERRAIN,
    CLOSEST_ONLY: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CLOSEST_ONLY,
    INTERACTION_ENTER_ONLY:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_ENTER_ONLY,
    INTERACTION_CONTINUOUS:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS,
    CORE_DAMAGE_REQUEST:
        GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.CORE_DAMAGE_REQUEST
});

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    const float32 = Math.fround(number);
    if (!Number.isFinite(number)
        || !Number.isFinite(float32)
        || float32 <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
        throw new TypeError(`${label}은 유한한 float32 범위 숫자여야 합니다.`);
    }
    return number;
}

function requireNonNegativeFinite(value, label) {
    const number = requireFinite(value, label);
    if (number < 0) {
        throw new RangeError(`${label}은 0 이상이어야 합니다.`);
    }
    return number;
}

function requireGpuFixedPointCompatible(value, label, allowZero = false) {
    const number = allowZero
        ? requireNonNegativeFinite(value, label)
        : requirePositiveFinite(value, label);
    encodeGpuCircleBodyFixedPoint(number);
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
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

function requireEndpoint(endpoint, methodName = 'requestSpawn') {
    if (!endpoint || typeof endpoint[methodName] !== 'function') {
        throw new TypeError(`GPU projectile adapter에는 endpoint.${methodName}()이 필요합니다.`);
    }
    return endpoint;
}

function rejectPresentProperties(source, propertyNames, label) {
    for (const propertyName of propertyNames) {
        if (Object.prototype.hasOwnProperty.call(source, propertyName)) {
            throw new TypeError(`${label} mode에는 ${propertyName}을(를) 사용할 수 없습니다.`);
        }
    }
}

function normalizeVector(source, label) {
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label} 벡터가 필요합니다.`);
    }
    return Object.freeze({
        x: requireFinite(source.x, `${label}.x`),
        y: requireFinite(source.y, `${label}.y`)
    });
}

function normalizeEntityHandle(source, label = 'sourceHandle') {
    if (source === undefined || source === null) {
        return null;
    }
    if (!source || typeof source !== 'object') {
        throw new TypeError(`${label}은 entity handle 객체여야 합니다.`);
    }
    const entityId = Number(source.entityId);
    const incarnation = Number(source.incarnation);
    if (!Number.isSafeInteger(entityId)
        || entityId <= 0
        || entityId >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}.entityId가 유효하지 않습니다.`);
    }
    if (!Number.isSafeInteger(incarnation)
        || incarnation <= 0
        || incarnation >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}.incarnation이 유효하지 않습니다.`);
    }
    return Object.freeze({ entityId, incarnation });
}

function resolveProjectileAllegiance(options) {
    const allegiancePolicy = normalizeGameplayAllegiancePolicy(
        options.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE
    );
    if (allegiancePolicy === GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT) {
        return Object.freeze({
            allegiancePolicy,
            ...(options.teamId === undefined || options.teamId === null
                ? {}
                : { teamId: normalizeGameplayTeamId(options.teamId) })
        });
    }
    return Object.freeze({
        allegiancePolicy,
        teamId: resolveGameplayAllegianceTeam({
            policy: allegiancePolicy,
            teamId: options.teamId
        })
    });
}

function resolveInverseMass(definition) {
    if (definition.inverseMass !== undefined) {
        return requirePositiveFinite(definition.inverseMass, 'definition.inverseMass');
    }
    const mass = requirePositiveFinite(definition.mass, 'definition.mass');
    return 1 / mass;
}

function resolveProjectileTargetPolicy(options, definition) {
    const targetPolicyId = normalizeProjectileTargetPolicyId(
        options.targetPolicyId
            ?? definition.targetPolicyId
            ?? PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN
    );
    let interactionMask;
    if (targetPolicyId === PROJECTILE_TARGET_POLICY_ID.ENEMY_AND_TERRAIN) {
        interactionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    } else if (targetPolicyId
        === PROJECTILE_TARGET_POLICY_ID.PLAYER_DAMAGEABLE_AND_TERRAIN) {
        interactionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    } else if (targetPolicyId
        === PROJECTILE_TARGET_POLICY_ID.CORE_PROXY_AND_TERRAIN) {
        interactionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    } else {
        interactionMask = GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN;
    }
    return Object.freeze({ targetPolicyId, interactionMask });
}

function isCanonicalArcherTowerDamageChannel(options, destinationSpawn) {
    const definition = options.definition;
    return options.mode
            === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY
        && destinationSpawn.definitionId === HOSTILE_BASIC_BULLET_DATA.id
        && destinationSpawn.producerId === ARCHER_ATTACK_DATA.producerId
        && destinationSpawn.sourceAbilityId === ARCHER_ATTACK_DATA.sourceAbilityId
        && destinationSpawn.targetPolicyId === ARCHER_ATTACK_DATA.targetPolicyId
        && destinationSpawn.allegiancePolicy === ARCHER_ATTACK_DATA.allegiancePolicy
        && destinationSpawn.damagePolicyId
            === GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
        && definition?.id === HOSTILE_BASIC_BULLET_DATA.id
        && definition?.producerId === HOSTILE_BASIC_BULLET_DATA.producerId
        && definition?.targetPolicyId === HOSTILE_BASIC_BULLET_DATA.targetPolicyId
        && Number(definition?.damage) === HOSTILE_BASIC_BULLET_DATA.damage
        && Number(definition?.damageSelf ?? 1)
            === HOSTILE_BASIC_BULLET_DATA.damageSelf
        && Number(definition?.penetration) === HOSTILE_BASIC_BULLET_DATA.penetration;
}

function resolveOptionalCoreDamageMetadata(definition) {
    const hasCoreDamage = definition.coreDamage !== undefined
        && definition.coreDamage !== null;
    if (!hasCoreDamage) {
        return Object.freeze({});
    }
    const coreDamage = requireGpuFixedPointCompatible(
        definition.coreDamage,
        'definition.coreDamage'
    );
    const coreDamageRequestPolicyId = requireNonEmptyString(
        definition.coreDamageRequestPolicyId,
        'definition.coreDamageRequestPolicyId'
    );
    if (definition.requiresExactSelectedTarget !== true) {
        throw new RangeError(
            'Core damage request projectile에는 requiresExactSelectedTarget=true가 필요합니다.'
        );
    }
    return Object.freeze({
        coreDamage,
        coreDamageFixedPoint: encodeGpuCircleBodyFixedPoint(coreDamage),
        coreDamageRequestPolicyId,
        requiresExactSelectedTarget: true,
        towerTargetPolicyId: normalizeProjectileTargetPolicyId(
            definition.towerTargetPolicyId,
            'definition.towerTargetPolicyId'
        ),
        coreTargetPolicyId: normalizeProjectileTargetPolicyId(
            definition.coreTargetPolicyId,
            'definition.coreTargetPolicyId'
        )
    });
}

function normalizeColor(source) {
    if (source === undefined || source === null) {
        return null;
    }
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source))
        || source.length !== 4) {
        throw new TypeError('definition.colorRgba는 네 성분 배열이어야 합니다.');
    }
    const color = new Array(4);
    for (let index = 0; index < 4; index++) {
        const component = requireFinite(source[index], `definition.colorRgba[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`definition.colorRgba[${index}]는 0~1 범위여야 합니다.`);
        }
        color[index] = component;
    }
    return Object.freeze(color);
}

function createContactHandler(definition) {
    let flags = definition.continuousInteraction === true
        ? GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_CONTINUOUS
        : GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.INTERACTION_ENTER_ONLY;
    if (definition.killOnTerrain !== false) {
        flags |= GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.KILL_IF_OTHER_TERRAIN;
    }
    if (definition.closestOnly === true) {
        flags |= GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.CLOSEST_ONLY;
    }
    if (definition.coreDamageRequestPolicyId
        === PROJECTILE_CORE_DAMAGE_REQUEST_POLICY_ID.TYPED_CPU_CORE_DAMAGE) {
        flags |= GPU_PROJECTILE_CONTACT_HANDLER_FLAGS.CORE_DAMAGE_REQUEST;
    }
    // ABI writer가 shader용 fixed-point 변환을 소유하므로 gameplay 단위를 보존합니다.
    return Object.freeze({
        damageSelf: requireGpuFixedPointCompatible(
            definition.damageSelf ?? 1,
            'definition.damageSelf',
            true
        ),
        damageOther: requireGpuFixedPointCompatible(
            definition.damage,
            'definition.damage'
        ),
        flags
    });
}

function createRenderStyle(definition) {
    const color = normalizeColor(definition.colorRgba);
    const hasRadiusScale = definition.radiusScale !== undefined;
    if (!color && !hasRadiusScale && definition.visible === undefined) {
        return null;
    }
    return Object.freeze({
        ...(color ? { color } : {}),
        radiusScale: hasRadiusScale
            ? requirePositiveFinite(definition.radiusScale, 'definition.radiusScale')
            : 1,
        visible: definition.visible !== false
    });
}

/**
 * data definition과 world-space 발사 상태를 mixed-body GPU spawn intent로 변환합니다.
 * entityId/incarnation은 endpoint 내부 WorldRegistry가 fixed 경계에서만 발급합니다.
 *
 * @param {{definition:object,position:{x:number,y:number},velocity:{x:number,y:number},spawnSequence?:number,sourceHandle?:object|null}} options
 * @returns {object} 불변 projectile spawn intent입니다.
 */
export function createGpuProjectileSpawnIntent(options = {}) {
    options = materializeGpuPlainDataSnapshot(
        options,
        'gpuProjectileSpawnIntent'
    );
    const definition = options.definition;
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('GPU projectile definition이 필요합니다.');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'entityId')
        || Object.prototype.hasOwnProperty.call(options, 'incarnation')
        || Object.prototype.hasOwnProperty.call(options, 'handle')) {
        throw new TypeError('projectile identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const definitionId = requireNonEmptyString(definition.id, 'definition.id');
    const sourceHandle = normalizeEntityHandle(options.sourceHandle, 'sourceHandle');
    const ownerHandle = normalizeEntityHandle(options.ownerHandle, 'ownerHandle');
    const targetHandle = normalizeEntityHandle(options.targetHandle, 'targetHandle');
    const allegiance = resolveProjectileAllegiance(options);
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        options.damagePolicyId
            ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX
    );
    const targetPolicy = resolveProjectileTargetPolicy(options, definition);
    const coreDamageMetadata = resolveOptionalCoreDamageMetadata(definition);
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence ?? 0,
        'spawnSequence'
    );
    const bodyLayer = GPU_PROJECTILE_LAYER;
    const renderStyle = createRenderStyle(definition);
    const producerId = options.producerId ?? definition.producerId;
    const sourceAbilityId = options.sourceAbilityId ?? definition.sourceAbilityId;
    return Object.freeze({
        kindId: GPU_PROJECTILE_WORLD_KIND_ID,
        definitionId,
        ...allegiance,
        damagePolicyId,
        targetPolicyId: targetPolicy.targetPolicyId,
        ...coreDamageMetadata,
        spawnSequence,
        ...(sourceHandle ? {
            sourceEntityId: sourceHandle.entityId,
            sourceIncarnation: sourceHandle.incarnation
        } : {}),
        ...(ownerHandle ? {
            ownerEntityId: ownerHandle.entityId,
            ownerIncarnation: ownerHandle.incarnation
        } : {}),
        ...(targetHandle ? {
            targetEntityId: targetHandle.entityId,
            targetIncarnation: targetHandle.incarnation
        } : {}),
        ...(producerId !== undefined ? {
            producerId: requireNonEmptyString(producerId, 'producerId')
        } : {}),
        ...(sourceAbilityId !== undefined ? {
            sourceAbilityId: requireNonEmptyString(sourceAbilityId, 'sourceAbilityId')
        } : {}),
        position: normalizeVector(options.position, 'position'),
        velocity: normalizeVector(options.velocity, 'velocity'),
        radius: requirePositiveFinite(
            definition.collisionRadius ?? definition.radius,
            'definition.collisionRadius'
        ),
        inverseMass: resolveInverseMass(definition),
        bodyLayer,
        collisionMask: 0,
        interactionLayer: bodyLayer,
        interactionMask: targetPolicy.interactionMask,
        // ABI writer가 health를 shader용 fixed-point로 encode합니다.
        health: requireGpuFixedPointCompatible(
            definition.penetration,
            'definition.penetration'
        ),
        lifetime: requirePositiveFinite(
            definition.lifetimeSeconds ?? definition.lifetime,
            'definition.lifetimeSeconds'
        ),
        contactHandler: createContactHandler(definition),
        ...(coreDamageMetadata.coreDamageFixedPoint !== undefined ? {
            enemyBehaviorState: Object.freeze({
                programId:
                    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.SELECTED_TARGET_PROJECTILE,
                coreDamageFixedPoint: coreDamageMetadata.coreDamageFixedPoint
            })
        } : {}),
        alive: true,
        ...(renderStyle ? { renderStyle } : {})
    });
}

/**
 * caller identity와 fixed tick/sequence로 재시도에도 동일한 command ID를 만듭니다.
 * @param {{definitionId:string,targetFixedTick:number,spawnSequence:number,sourceHandle?:object|null,targetHandle?:object|null,commandNamespace?:string}} options
 * @returns {string}
 */
export function createGpuProjectileCommandId(options = {}) {
    const namespace = requireNonEmptyString(
        options.commandNamespace ?? DEFAULT_COMMAND_NAMESPACE,
        'commandNamespace'
    );
    const definitionId = requireNonEmptyString(options.definitionId, 'definitionId');
    const targetFixedTick = requirePositiveSafeInteger(
        options.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence,
        'spawnSequence'
    );
    const sourceHandle = normalizeEntityHandle(options.sourceHandle, 'sourceHandle');
    const sourceKey = sourceHandle
        ? `${sourceHandle.entityId}:${sourceHandle.incarnation}`
        : 'session';
    const targetHandle = normalizeEntityHandle(options.targetHandle, 'targetHandle');
    if (targetHandle) {
        return `${encodeURIComponent(namespace)}:${sourceKey}:target:${targetHandle.entityId}:${targetHandle.incarnation}:${targetFixedTick}:${spawnSequence}:${encodeURIComponent(definitionId)}`;
    }
    return `${encodeURIComponent(namespace)}:${sourceKey}:${targetFixedTick}:${spawnSequence}:${encodeURIComponent(definitionId)}`;
}

/**
 * GPU fixed primitive가 tick-start exact Core/Tower 중 하나를 선택할 Phase 2 ingress입니다.
 * Phase 1은 ABI 숫자를 참조하지 않고 불변 host descriptor만 완성합니다.
 */
export function createGpuSelectedTargetProjectileIntent(options = {}) {
    const snapshot = materializeGpuPlainDataSnapshot(
        options,
        'gpuSelectedTargetProjectileIntent'
    );
    const sourceHandle = normalizeEntityHandle(
        snapshot.sourceHandle,
        'sourceHandle'
    );
    const coreTargetHandle = normalizeEntityHandle(
        snapshot.coreTargetHandle,
        'coreTargetHandle'
    );
    const towerTargetHandle = normalizeEntityHandle(
        snapshot.towerTargetHandle,
        'towerTargetHandle'
    );
    if (!sourceHandle || !coreTargetHandle) {
        throw new TypeError('selected-target mode에는 source/Core exact handle이 필요합니다.');
    }
    const targetSelectionPolicyId = requireNonEmptyString(
        snapshot.targetSelectionPolicyId,
        'targetSelectionPolicyId'
    );
    if (targetSelectionPolicyId
        !== GPU_PROJECTILE_SELECTED_TARGET_POLICY_ID
            .CORE_FIRST_IN_RANGE_THEN_TOWER) {
        throw new RangeError('지원하지 않는 selected-target priority policy입니다.');
    }
    const distancePolicyId = requireNonEmptyString(
        snapshot.distancePolicyId,
        'distancePolicyId'
    );
    if (distancePolicyId
        !== GPU_PROJECTILE_SELECTED_TARGET_DISTANCE_POLICY_ID
            .TICK_START_CENTER_INCLUSIVE) {
        throw new RangeError('지원하지 않는 selected-target distance policy입니다.');
    }
    if (snapshot.stopWhileTargetInRange !== true) {
        throw new RangeError(
            'selected-target mode는 in-range 전체 기간 정지 policy를 사용해야 합니다.'
        );
    }
    const attackRangeTiles = requirePositiveFinite(
        snapshot.attackRangeTiles,
        'attackRangeTiles'
    );
    const baseDestinationSpawn = createGpuProjectileSpawnIntent({
        definition: snapshot.definition,
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        spawnSequence: snapshot.spawnSequence,
        sourceHandle,
        ownerHandle: snapshot.ownerHandle,
        producerId: snapshot.producerId,
        sourceAbilityId: snapshot.sourceAbilityId,
        teamId: snapshot.teamId,
        allegiancePolicy: snapshot.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
        damagePolicyId: snapshot.damagePolicyId,
        targetPolicyId: snapshot.targetPolicyId
    });
    if (baseDestinationSpawn.targetPolicyId
        !== PROJECTILE_TARGET_POLICY_ID
            .GPU_SELECTED_CORE_OR_PLAYER_DAMAGEABLE_AND_TERRAIN) {
        throw new RangeError(
            'selected-target projectile에는 GPU-selected Core/Tower target policy가 필요합니다.'
        );
    }
    const destinationSpawn = Object.freeze({
        ...baseDestinationSpawn,
        targetSelectionPolicyId,
        distancePolicyId,
        attackRangeTiles,
        coreTargetEntityId: coreTargetHandle.entityId,
        coreTargetIncarnation: coreTargetHandle.incarnation,
        ...(towerTargetHandle ? {
            towerTargetEntityId: towerTargetHandle.entityId,
            towerTargetIncarnation: towerTargetHandle.incarnation
        } : {})
    });
    return Object.freeze({
        mode: GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET,
        sourceHandle,
        coreTargetHandle,
        towerTargetHandle,
        destinationSpawn,
        positionOffset: normalizeVector(snapshot.positionOffset, 'positionOffset'),
        targetOffset: normalizeVector(
            snapshot.targetOffset ?? { x: 0, y: 0 },
            'targetOffset'
        ),
        launchSpeed: requirePositiveFinite(snapshot.launchSpeed, 'launchSpeed'),
        attackRangeTiles,
        targetSelectionPolicyId,
        distancePolicyId,
        stopWhileTargetInRange: true
    });
}

export function createGpuSelectedTargetProjectileCommandId(options = {}) {
    const sourceHandle = normalizeEntityHandle(options.sourceHandle, 'sourceHandle');
    const coreTargetHandle = normalizeEntityHandle(
        options.coreTargetHandle,
        'coreTargetHandle'
    );
    const towerTargetHandle = normalizeEntityHandle(
        options.towerTargetHandle,
        'towerTargetHandle'
    );
    if (!sourceHandle || !coreTargetHandle) {
        throw new TypeError('selected-target command에는 source/Core exact handle이 필요합니다.');
    }
    const towerKey = towerTargetHandle
        ? `${towerTargetHandle.entityId}:${towerTargetHandle.incarnation}`
        : 'none';
    return [
        encodeURIComponent(requireNonEmptyString(
            options.commandNamespace ?? DEFAULT_COMMAND_NAMESPACE,
            'commandNamespace'
        )),
        sourceHandle.entityId,
        sourceHandle.incarnation,
        'core',
        coreTargetHandle.entityId,
        coreTargetHandle.incarnation,
        'tower',
        towerKey,
        requirePositiveSafeInteger(options.targetFixedTick, 'targetFixedTick'),
        requireNonNegativeSafeInteger(options.spawnSequence, 'spawnSequence'),
        encodeURIComponent(requireNonEmptyString(options.definitionId, 'definitionId'))
    ].join(':');
}

/**
 * Phase 2 selected-target fixed primitive port로 host descriptor를 요청합니다.
 * 현재 endpoint가 아직 port를 노출하지 않으면 불변 rejection을 반환하여
 * 기존 source-relative ABI로 잘못 라우팅하지 않습니다.
 */
export function requestGpuSelectedTargetProjectile(options = {}) {
    const snapshot = materializeGpuPlainDataSnapshot(
        options,
        'gpuSelectedTargetProjectileRequest',
        { opaqueKeys: ['endpoint'] }
    );
    rejectPresentProperties(snapshot, [
        'position',
        'velocity',
        'launchVelocity',
        'sourceVelocityScale',
        'aimWorldPoint',
        'targetHandle',
        'targetEntityId',
        'targetIncarnation',
        'trackedPose',
        'targetPosition',
        'targetWorldPosition',
        'cpuTargetPosition'
    ], GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET);
    if (!snapshot.endpoint || typeof snapshot.endpoint !== 'object') {
        throw new TypeError('GPU selected-target projectile endpoint가 필요합니다.');
    }
    const targetFixedTick = requirePositiveSafeInteger(
        snapshot.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        snapshot.spawnSequence ?? 0,
        'spawnSequence'
    );
    const intent = createGpuSelectedTargetProjectileIntent({
        ...snapshot,
        spawnSequence
    });
    const commandId = snapshot.commandId === undefined
        || snapshot.commandId === null
        ? createGpuSelectedTargetProjectileCommandId({
            definitionId: intent.destinationSpawn.definitionId,
            sourceHandle: intent.sourceHandle,
            coreTargetHandle: intent.coreTargetHandle,
            towerTargetHandle: intent.towerTargetHandle,
            targetFixedTick,
            spawnSequence,
            commandNamespace: snapshot.commandNamespace
        })
        : requireNonEmptyString(snapshot.commandId, 'commandId');
    if (typeof snapshot.endpoint.requestSelectedTargetSpawn !== 'function') {
        return Object.freeze({
            accepted: false,
            reason: 'selected-target-fixed-primitive-unavailable',
            commandId,
            targetFixedTick
        });
    }
    return snapshot.endpoint.requestSelectedTargetSpawn(
        intent,
        targetFixedTick,
        commandId
    );
}

/**
 * projectile spawn intent를 만들고 endpoint의 next-fixed command boundary에 요청합니다.
 * @param {{endpoint:object,definition:object,position:{x:number,y:number},velocity:{x:number,y:number},targetFixedTick:number,spawnSequence?:number,sourceHandle?:object|null,commandNamespace?:string,commandId?:string|null}} options
 * @returns {object} endpoint.requestSpawn() 결과입니다.
 */
export function requestGpuProjectileSpawn(options = {}) {
    options = materializeGpuPlainDataSnapshot(
        options,
        'gpuProjectileSpawnRequest',
        { opaqueKeys: ['endpoint'] }
    );
    const endpoint = requireEndpoint(options.endpoint);
    const targetFixedTick = requirePositiveSafeInteger(
        options.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence ?? 0,
        'spawnSequence'
    );
    const intent = createGpuProjectileSpawnIntent({
        definition: options.definition,
        position: options.position,
        velocity: options.velocity,
        spawnSequence,
        sourceHandle: options.sourceHandle,
        ownerHandle: options.ownerHandle,
        producerId: options.producerId,
        sourceAbilityId: options.sourceAbilityId,
        teamId: options.teamId,
        allegiancePolicy: options.allegiancePolicy,
        damagePolicyId: options.damagePolicyId,
        targetPolicyId: options.targetPolicyId
    });
    const commandId = options.commandId === undefined || options.commandId === null
        ? createGpuProjectileCommandId({
            definitionId: intent.definitionId,
            targetFixedTick,
            spawnSequence,
            sourceHandle: options.sourceHandle,
            commandNamespace: options.commandNamespace
        })
        : requireNonEmptyString(options.commandId, 'commandId');
    return endpoint.requestSpawn(intent, targetFixedTick, commandId);
}

/**
 * Explicit projectile mode를 endpoint의 absolute/source-relative ingress로 라우팅합니다.
 * source-relative mode의 destination position/velocity는 GPU materialization 전용 inert 값입니다.
 */
export function requestGpuProjectile(options = {}) {
    options = materializeGpuPlainDataSnapshot(
        options,
        'gpuProjectileRequest',
        { opaqueKeys: ['endpoint'] }
    );
    const mode = options.mode ?? GPU_PROJECTILE_SPAWN_MODE.ABSOLUTE;
    if (!Object.values(GPU_PROJECTILE_SPAWN_MODE).includes(mode)) {
        throw new RangeError(`지원하지 않는 GPU projectile spawn mode입니다: ${mode}`);
    }
    rejectPresentProperties(
        options,
        ['requestFlags'],
        'GPU projectile public request'
    );
    if (mode === GPU_PROJECTILE_SPAWN_MODE.ABSOLUTE) {
        rejectPresentProperties(options, [
            'positionOffset',
            'launchVelocity',
            'sourceVelocityScale',
            'aimWorldPoint',
            'launchSpeed',
            'targetHandle',
            'targetOffset',
            'targetEntityId',
            'targetIncarnation',
            'trackedPose',
            'targetPosition',
            'targetWorldPosition',
            'cpuTargetPosition'
        ], 'ABSOLUTE');
        return requestGpuProjectileSpawn(options);
    }
    if (mode === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_SELECTED_TARGET) {
        return requestGpuSelectedTargetProjectile(options);
    }

    rejectPresentProperties(options, ['position', 'velocity'], mode);
    const endpoint = requireEndpoint(options.endpoint, 'requestSourceRelativeSpawn');
    const targetFixedTick = requirePositiveSafeInteger(
        options.targetFixedTick,
        'targetFixedTick'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        options.spawnSequence ?? 0,
        'spawnSequence'
    );
    const sourceHandle = normalizeEntityHandle(options.sourceHandle, 'sourceHandle');
    if (!sourceHandle) {
        throw new TypeError(`${mode} mode에는 sourceHandle이 필요합니다.`);
    }
    const isTargetEntity = mode
        === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_TARGET_ENTITY;
    if (mode === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_VELOCITY) {
        rejectPresentProperties(options, [
            'aimWorldPoint',
            'launchSpeed',
            'targetHandle',
            'targetOffset',
            'targetEntityId',
            'targetIncarnation',
            'trackedPose',
            'targetPosition',
            'targetWorldPosition',
            'cpuTargetPosition'
        ], mode);
    } else if (mode === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT) {
        rejectPresentProperties(options, [
            'launchVelocity',
            'sourceVelocityScale',
            'targetHandle',
            'targetOffset',
            'targetEntityId',
            'targetIncarnation',
            'trackedPose',
            'targetPosition',
            'targetWorldPosition',
            'cpuTargetPosition'
        ], mode);
    } else {
        rejectPresentProperties(options, [
            'launchVelocity',
            'sourceVelocityScale',
            'aimWorldPoint',
            'targetEntityId',
            'targetIncarnation',
            'trackedPose',
            'targetPosition',
            'targetWorldPosition',
            'cpuTargetPosition'
        ], mode);
    }
    const targetHandle = isTargetEntity
        ? normalizeEntityHandle(options.targetHandle, 'targetHandle')
        : null;
    if (isTargetEntity && !targetHandle) {
        throw new TypeError(`${mode} mode에는 targetHandle이 필요합니다.`);
    }
    const positionOffset = normalizeVector(options.positionOffset, 'positionOffset');
    const targetOffset = isTargetEntity
        ? normalizeVector(options.targetOffset ?? { x: 0, y: 0 }, 'targetOffset')
        : null;
    const destinationSpawn = createGpuProjectileSpawnIntent({
        definition: options.definition,
        position: { x: 0, y: 0 },
        velocity: { x: 0, y: 0 },
        spawnSequence,
        sourceHandle,
        targetHandle,
        ownerHandle: options.ownerHandle,
        producerId: options.producerId,
        sourceAbilityId: options.sourceAbilityId,
        teamId: options.teamId,
        allegiancePolicy: options.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.INHERIT_SUBJECT,
        damagePolicyId: options.damagePolicyId,
        targetPolicyId: options.targetPolicyId
    });
    const commandId = options.commandId === undefined || options.commandId === null
        ? createGpuProjectileCommandId({
            definitionId: destinationSpawn.definitionId,
            targetFixedTick,
            spawnSequence,
            sourceHandle,
            targetHandle,
            commandNamespace: options.commandNamespace
        })
        : requireNonEmptyString(options.commandId, 'commandId');
    let sourceRelativeIntent;
    if (mode === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_VELOCITY) {
        sourceRelativeIntent = Object.freeze({
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_VELOCITY,
            sourceHandle,
            destinationSpawn,
            positionOffset,
            launchVelocity: normalizeVector(options.launchVelocity, 'launchVelocity'),
            sourceVelocityScale: requireFinite(
                options.sourceVelocityScale ?? 0,
                'sourceVelocityScale'
            )
        });
    } else if (mode === GPU_PROJECTILE_SPAWN_MODE.SOURCE_RELATIVE_AIM_POINT) {
        sourceRelativeIntent = Object.freeze({
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_AIM_POINT,
            sourceHandle,
            destinationSpawn,
            positionOffset,
            aimWorldPoint: normalizeVector(options.aimWorldPoint, 'aimWorldPoint'),
            launchSpeed: requirePositiveFinite(options.launchSpeed, 'launchSpeed')
        });
    } else {
        const requestFlags = isCanonicalArcherTowerDamageChannel(
            options,
            destinationSpawn
        )
            ? GPU_SPAWN_PROGRAM_REQUEST_FLAGS.TOWER_DAMAGE_CHANNEL
            : 0;
        sourceRelativeIntent = Object.freeze({
            modeFlags: GPU_SPAWN_PROGRAM_MODE.SOURCE_RELATIVE_TARGET_ENTITY,
            sourceHandle,
            targetHandle,
            destinationSpawn,
            positionOffset,
            targetOffset,
            launchSpeed: requirePositiveFinite(options.launchSpeed, 'launchSpeed'),
            ...(requestFlags === 0 ? {} : { requestFlags })
        });
    }
    return endpoint.requestSourceRelativeSpawn(
        sourceRelativeIntent,
        targetFixedTick,
        commandId
    );
}

/**
 * 한 session endpoint와 command namespace를 보관하는 data-driven projectile adapter입니다.
 */
export class GpuProjectileSpawnAdapter {
    /**
     * @param {object} endpoint - mixed-body GpuSimulationEndpoint입니다.
     * @param {{commandNamespace?:string}} [options={}]
     */
    constructor(endpoint, options = {}) {
        this.endpoint = requireEndpoint(endpoint);
        this.commandNamespace = requireNonEmptyString(
            options.commandNamespace ?? DEFAULT_COMMAND_NAMESPACE,
            'commandNamespace'
        );
    }

    /** @param {object} options - requestGpuProjectileSpawn()에서 endpoint를 제외한 값입니다. */
    requestSpawn(options = {}) {
        const snapshot = materializeGpuPlainDataSnapshot(
            options,
            'gpuProjectileAdapterSpawn',
            { opaqueKeys: ['endpoint'] }
        );
        return requestGpuProjectileSpawn({
            ...snapshot,
            endpoint: this.endpoint,
            commandNamespace: snapshot.commandNamespace ?? this.commandNamespace
        });
    }


    /** Explicit mode projectile request입니다. */
    requestProjectile(options = {}) {
        const snapshot = materializeGpuPlainDataSnapshot(
            options,
            'gpuProjectileAdapterRequest',
            { opaqueKeys: ['endpoint'] }
        );
        return requestGpuProjectile({
            ...snapshot,
            endpoint: this.endpoint,
            commandNamespace: snapshot.commandNamespace ?? this.commandNamespace
        });
    }
}
