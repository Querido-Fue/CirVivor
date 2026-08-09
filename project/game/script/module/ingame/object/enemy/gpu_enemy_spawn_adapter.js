import {
    GPU_CIRCLE_BODY_COLLISION_LAYER,
    GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM
} from '../../physics/gpu/gpu_circle_body_abi.js';
import {
    GPU_EFFECT_EMITTER_FLAG,
    GPU_EFFECT_LAST_PULSE_TICK_INVALID
} from '../../physics/gpu/gpu_effect_runtime_abi.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from '../../contract/gameplay_team_contract.js';
import {
    assertEnemyDefinitionCapabilityImplementations,
    assertEnemyFixedCommandProducer,
    assertEnemyGameplayEventConsumer,
    assertEnemyLifecycleObserver,
    createEnemyCapabilityMask,
    createEnemyCapabilityImplementationRegistry,
    ENEMY_CAPABILITY_ID,
    hasEnemyCapability
} from '../../contract/enemy_capability_contract.js';
import {
    assertEnemyDefinitionProfileCapabilityConsistency
} from '../../contract/enemy_profile_contract.js';
import {
    ENEMY_PROFILE_CATALOG
} from 'data/object/enemy/enemy_profile_catalog_data.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    assertResolvedEnemySpawnStats,
    resolveEnemySpawnStats
} from './resolved_enemy_spawn_stats.js';
import { EnemyCoreImpactDirector } from './enemy_core_impact_director.js';
import { PentagonEffectDirector } from './pentagon_effect_director.js';

export const GPU_ENEMY_WORLD_KIND_ID = 'enemy';
export const GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX = 1;

const GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE = Object.freeze({
    circle: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE,
    square: GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE,
    triangle: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE,
    arrow: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW,
    penta: GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA,
    hexa: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA,
    gen: GPU_CIRCLE_BODY_RENDER_SHAPE.GEN,
    rhom: GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM
});
const LEGACY_GPU_ENEMY_CAPABILITY_MASK = createEnemyCapabilityMask([
    ENEMY_CAPABILITY_ID.NAVIGATION,
    ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
    ENEMY_CAPABILITY_ID.CORE_IMPACT
]);
const ZERO_INITIAL_WORLD_OFFSET_TILES = Object.freeze({ x: 0, y: 0 });

function assertNavigationCapabilityDefinition(definition) {
    requireNonEmptyString(
        definition.behaviorProfileId,
        'enemy navigation behaviorProfileId'
    );
}

function assertTargetingCapabilityDefinition(definition) {
    requireNonEmptyString(
        definition.behaviorProfileId,
        'enemy targeting behaviorProfileId'
    );
}

function assertContactCombatCapabilityDefinition(definition) {
    requireNonEmptyString(
        definition.combatProfileId,
        'enemy contact combatProfileId'
    );
}

function assertCoreImpactCapabilityDefinition(definition) {
    requireNonEmptyString(
        definition.combatProfileId,
        'enemy Core impact combatProfileId'
    );
    requireNonEmptyString(
        definition.behaviorProfileId,
        'enemy Core impact behaviorProfileId'
    );
}

function assertChargeCapabilityDefinition(definition) {
    const behaviorProfileId = requireNonEmptyString(
        definition.behaviorProfileId,
        'enemy charge behaviorProfileId'
    );
    const behaviorProfile = ENEMY_PROFILE_CATALOG.behaviorById[behaviorProfileId];
    if (!behaviorProfile?.charge) {
        throw new RangeError(
            'enemy-charge capability에는 실제 charge behavior profile이 필요합니다.'
        );
    }
}

function assertEffectEmitterCapabilityDefinition(definition) {
    const effectEmitterProfileId = requireNonEmptyString(
        definition.effectEmitterProfileId,
        'enemy effectEmitterProfileId'
    );
    const emitterProfile = ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
        effectEmitterProfileId
    ];
    const effectDefinition = emitterProfile
        ? ENEMY_EFFECT_DEFINITION_BY_ID[emitterProfile.effectDefinitionId]
        : null;
    if (!emitterProfile
        || !effectDefinition
        || effectDefinition.effectDefinitionCode
            !== emitterProfile.effectDefinitionCode) {
        throw new RangeError(
            'enemy-effect-emitter capability에는 exact emitter/effect catalog profile이 필요합니다.'
        );
    }
}

/** 실제 EnemyCoreImpactDirector method family를 가리키는 class-free roster seam입니다. */
export const GPU_ENEMY_CORE_IMPACT_ROSTER_PORT = Object.freeze({
    observeCompletedEvents:
        EnemyCoreImpactDirector.prototype.observeCompletedEvents,
    stageForFixedTick: EnemyCoreImpactDirector.prototype.stageForFixedTick,
    observeFixedCommit: EnemyCoreImpactDirector.prototype.observeFixedCommit
});
assertEnemyGameplayEventConsumer(GPU_ENEMY_CORE_IMPACT_ROSTER_PORT);
assertEnemyFixedCommandProducer(GPU_ENEMY_CORE_IMPACT_ROSTER_PORT);

/** 실제 PentagonEffectDirector method family를 가리키는 exact-handle roster seam입니다. */
export const GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT = Object.freeze({
    observeLifecycle: PentagonEffectDirector.prototype.observeLifecycle,
    observeCompletedEvents:
        PentagonEffectDirector.prototype.observeCompletedEvents,
    stageForFixedTick: PentagonEffectDirector.prototype.stageForFixedTick,
    observeFixedCommit: PentagonEffectDirector.prototype.observeFixedCommit,
    getStatus: PentagonEffectDirector.prototype.getStatus,
    requiresRecovery: PentagonEffectDirector.prototype.requiresRecovery,
    resetGpuBinding: PentagonEffectDirector.prototype.resetGpuBinding,
    destroy: PentagonEffectDirector.prototype.destroy
});
assertEnemyLifecycleObserver(GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT);
assertEnemyGameplayEventConsumer(GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT);
assertEnemyFixedCommandProducer(GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT);

/**
 * GPU spawn path가 실제로 연결한 capability implementation seam입니다.
 * future capability는 비어 있는 class/registry entry를 만들지 않습니다.
 */
export const GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY = (
    createEnemyCapabilityImplementationRegistry([
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.NAVIGATION,
            implementationId: 'gpu-route-flow-navigation',
            assertDefinition: assertNavigationCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.TARGETING,
            implementationId: 'hostile-attack-director-targeting',
            assertDefinition: assertTargetingCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
            implementationId: 'gpu-continuous-contact-combat',
            assertDefinition: assertContactCombatCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.CORE_IMPACT,
            implementationId: 'enemy-core-impact-director',
            assertDefinition: assertCoreImpactCapabilityDefinition,
            rosterPort: GPU_ENEMY_CORE_IMPACT_ROSTER_PORT
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.CHARGE,
            implementationId: 'gpu-exact-tower-charge',
            assertDefinition: assertChargeCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
            implementationId: 'gpu-pentagon-effect-emitter',
            assertDefinition: assertEffectEmitterCapabilityDefinition,
            rosterPort: GPU_ENEMY_EFFECT_EMITTER_ROSTER_PORT
        })
    ])
);

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
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

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireNonNegativeFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 유한 숫자여야 합니다.`);
    }
    return number;
}

function isCanonicalEnemyDefinition(definition) {
    const profileFields = [
        'shapeDefinitionId',
        'physicsProfileId',
        'combatProfileId',
        'behaviorProfileId',
        'capabilityIds',
        'render'
    ];
    const presentCount = profileFields.reduce(
        (count, field) => count + (definition[field] === undefined ? 0 : 1),
        0
    );
    if (presentCount !== 0 && presentCount !== profileFields.length) {
        throw new TypeError('canonical enemy definition의 profile/render 필드는 함께 필요합니다.');
    }
    return presentCount === profileFields.length;
}

/** canonical definition의 capability implementation을 spawn 전에 fail-fast 검증합니다. */
export function assertGpuEnemyDefinitionCapabilities(definition) {
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('GPU enemy definition이 필요합니다.');
    }
    if (!isCanonicalEnemyDefinition(definition)) {
        return null;
    }
    assertEnemyDefinitionProfileCapabilityConsistency(
        definition,
        ENEMY_PROFILE_CATALOG,
        'enemyDefinition'
    );
    return assertEnemyDefinitionCapabilityImplementations(
        definition,
        GPU_ENEMY_CAPABILITY_IMPLEMENTATION_REGISTRY,
        'enemyDefinition'
    );
}

function resolveLegacyEnemySpawnStats(definition, definitionId) {
    const rawWeight = requirePositiveFinite(
        definition.collisionWeight,
        'collisionWeight'
    );
    const weight = requirePositiveFinite(Math.fround(rawWeight), 'collisionWeight float32');
    const inverseMass = requirePositiveFinite(
        Math.fround(1 / weight),
        'inverseMass float32'
    );
    return Object.freeze({
        definitionId,
        physicsProfileId: null,
        combatProfileId: null,
        behaviorProfileId: null,
        maxHealth: Math.fround(requirePositiveFinite(
            definition.maxHealth ?? 1,
            'maxHealth'
        )),
        moveSpeedTilesPerSecond: Math.fround(requirePositiveFinite(
            definition.moveSpeedTilesPerSecond,
            'moveSpeedTilesPerSecond'
        )),
        weight,
        inverseMass,
        towerContactDamage: Math.fround(requireNonNegativeFinite(
            definition.towerContactDamage ?? 0,
            'towerContactDamage'
        )),
        coreImpactDamage: requireNonNegativeFinite(
            definition.coreImpactDamage ?? 0,
            'coreImpactDamage'
        ),
        bountyBudget: requireNonNegativeFinite(
            definition.bountyBudget ?? 0,
            'bountyBudget'
        )
    });
}

function resolveSpawnStats(options, definition, definitionId) {
    const canonical = isCanonicalEnemyDefinition(definition);
    if (options.resolvedStats !== undefined && options.resolvedStats !== null) {
        if (!canonical) {
            throw new TypeError('resolvedStats는 canonical EnemyDefinition과 함께 사용해야 합니다.');
        }
        assertGpuEnemyDefinitionCapabilities(definition);
        const resolvedStats = assertResolvedEnemySpawnStats(
            options.resolvedStats,
            definitionId,
            'resolvedStats'
        );
        if (resolvedStats.physicsProfileId !== definition.physicsProfileId
            || resolvedStats.combatProfileId !== definition.combatProfileId
            || resolvedStats.behaviorProfileId !== definition.behaviorProfileId) {
            throw new RangeError('resolvedStats profile ID가 EnemyDefinition과 다릅니다.');
        }
        return resolvedStats;
    }
    if (!canonical) {
        return resolveLegacyEnemySpawnStats(definition, definitionId);
    }
    assertGpuEnemyDefinitionCapabilities(definition);
    return resolveEnemySpawnStats({
        definition,
        profileCatalog: ENEMY_PROFILE_CATALOG,
        mapEnemyModifiers: options.mapEnemyModifiers,
        waveEnemyModifiers: options.waveEnemyModifiers,
        knownDefinitionIds: options.knownDefinitionIds
    });
}

function resolveEnemyRenderShapeCode(shapeDefinitionId) {
    // shapeDefinitionId 도입 전 legacy definition은 기존 원형 render 계약을 유지합니다.
    if (shapeDefinitionId === undefined) {
        return GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE;
    }
    const type = requireNonEmptyString(shapeDefinitionId, 'enemy shapeDefinitionId');
    if (!Object.prototype.hasOwnProperty.call(GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE, type)) {
        throw new RangeError(`지원하지 않는 GPU enemy shapeDefinitionId입니다: ${type}`);
    }
    return GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE[type];
}

function normalizeColor(source) {
    if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 4) {
        throw new TypeError('enemy colorRgba는 네 성분 배열이어야 합니다.');
    }
    const color = new Array(4);
    for (let index = 0; index < 4; index++) {
        const component = requireFinite(source[index], `colorRgba[${index}]`);
        if (component < 0 || component > 1) {
            throw new RangeError(`colorRgba[${index}]는 0~1 범위여야 합니다.`);
        }
        color[index] = component;
    }
    return Object.freeze(color);
}

function normalizeInitialWorldOffsetTiles(source) {
    if (source === undefined || source === null) {
        return ZERO_INITIAL_WORLD_OFFSET_TILES;
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('initialWorldOffsetTiles는 {x,y} 객체여야 합니다.');
    }
    for (const key of Object.keys(source)) {
        if (key !== 'x' && key !== 'y') {
            throw new RangeError(
                `initialWorldOffsetTiles에 알 수 없는 필드가 있습니다: ${key}`
            );
        }
    }
    return Object.freeze({
        x: requireFinite(source.x, 'initialWorldOffsetTiles.x'),
        y: requireFinite(source.y, 'initialWorldOffsetTiles.y')
    });
}

/**
 * 선언 적 1개를 현재 map route의 첫 GPU flow stage에 맞는 spawn intent로 바꿉니다.
 * identity는 WorldRegistry만 발급하므로 이 adapter는 entityId/incarnation을 만들지 않습니다.
 * @param {{definition:object,route:object,spawnSequence:number,laneOffsetTiles?:number,initialWorldOffsetTiles?:{x:number,y:number}|null,waveId?:string|null,policyId?:string|null,resolvedStats?:object,collisionRadiusTilesOverride?:number}} options
 * @returns {object} 불변 spawn intent입니다.
 */
export function createGpuEnemySpawnIntent(options) {
    const definition = options?.definition;
    const route = options?.route;
    if (!definition || typeof definition !== 'object') {
        throw new TypeError('GPU enemy definition이 필요합니다.');
    }
    if (!route || typeof route !== 'object' || !Array.isArray(route.waypoints)
        || route.waypoints.length < 2) {
        throw new TypeError('GPU enemy spawn에는 두 waypoint 이상의 route가 필요합니다.');
    }
    const enemyDefinitionId = requireNonEmptyString(definition.id, 'enemyDefinitionId');
    const gateId = requireNonEmptyString(route.gateId, 'gateId');
    const pathId = requireNonEmptyString(route.pathId, 'pathId');
    const spawnSequence = Number(options.spawnSequence);
    if (!Number.isSafeInteger(spawnSequence) || spawnSequence < 0) {
        throw new RangeError('spawnSequence는 0 이상의 안전한 정수여야 합니다.');
    }
    const entry = route.waypoints[0];
    const next = route.waypoints[1];
    const entryX = requireFinite(entry?.x, 'route.entry.x');
    const entryY = requireFinite(entry?.y, 'route.entry.y');
    const directionX = requireFinite(next?.x, 'route.next.x') - entryX;
    const directionY = requireFinite(next?.y, 'route.next.y') - entryY;
    const directionLength = Math.hypot(directionX, directionY);
    if (!Number.isFinite(directionLength) || !(directionLength > 0)) {
        throw new RangeError('route의 첫 두 waypoint는 서로 다른 위치여야 합니다.');
    }
    const directionUnitX = directionX / directionLength;
    const directionUnitY = directionY / directionLength;
    const laneOffsetTiles = requireFinite(options.laneOffsetTiles ?? 0, 'laneOffsetTiles');
    const initialWorldOffsetTiles = normalizeInitialWorldOffsetTiles(
        options.initialWorldOffsetTiles
    );
    const normalX = -directionUnitY;
    const normalY = directionUnitX;
    const canonicalDefinition = isCanonicalEnemyDefinition(definition);
    const capabilityMask = canonicalDefinition
        ? createEnemyCapabilityMask(
            definition.capabilityIds,
            'enemyDefinition.capabilityIds'
        )
        : LEGACY_GPU_ENEMY_CAPABILITY_MASK;
    const resolvedStats = resolveSpawnStats(options, definition, enemyDefinitionId);
    const hasContactCombat = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.CONTACT_COMBAT,
        'enemy capabilityMask'
    );
    const hasCoreImpact = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.CORE_IMPACT,
        'enemy capabilityMask'
    );
    const hasCharge = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.CHARGE,
        'enemy capabilityMask'
    );
    const hasEffectEmitter = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.EFFECT_EMITTER,
        'enemy capabilityMask'
    );
    if (canonicalDefinition
        && !hasContactCombat
        && resolvedStats.towerContactDamage > 0) {
        throw new RangeError(
            'positive towerContactDamage canonical enemy에는 CONTACT_COMBAT capability가 필요합니다.'
        );
    }
    if (canonicalDefinition
        && !hasCoreImpact
        && resolvedStats.coreImpactDamage > 0) {
        throw new RangeError(
            'positive coreImpactDamage canonical enemy에는 CORE_IMPACT capability가 필요합니다.'
        );
    }
    const flowSpeed = requirePositiveFinite(
        resolvedStats.moveSpeedTilesPerSecond,
        'resolvedStats.moveSpeedTilesPerSecond'
    );
    const render = definition.render ?? definition;
    const color = normalizeColor(render.colorRgba);
    const shapeCode = resolveEnemyRenderShapeCode(
        Object.prototype.hasOwnProperty.call(definition, 'shapeDefinitionId')
            ? definition.shapeDefinitionId
            : definition.shapeType
    );
    const waveId = options.waveId === undefined || options.waveId === null
        ? null
        : requireNonEmptyString(options.waveId, 'waveId');
    const policyId = options.policyId === undefined || options.policyId === null
        ? null
        : requireNonEmptyString(options.policyId, 'policyId');
    // Benchmark/local spawn geometry만 canonical profile radius를 축소할 수 있습니다.
    // 이는 definition/profile authority와 resolved numeric stat을 바꾸지 않습니다.
    const collisionRadiusTiles = requirePositiveFinite(
        options.collisionRadiusTilesOverride ?? (
            canonicalDefinition
                ? ENEMY_PROFILE_CATALOG.physicsById[definition.physicsProfileId]
                    .collisionRadiusTiles
                : definition.collisionRadiusTiles
        ),
        'collisionRadiusTiles'
    );
    const chargeProfile = hasCharge
        ? ENEMY_PROFILE_CATALOG.behaviorById[definition.behaviorProfileId]?.charge
        : null;
    if (hasCharge && !chargeProfile) {
        throw new RangeError('enemy-charge spawn에는 charge behavior profile이 필요합니다.');
    }
    const effectEmitterProfile = hasEffectEmitter
        ? ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[definition.effectEmitterProfileId]
        : null;
    const effectDefinition = effectEmitterProfile
        ? ENEMY_EFFECT_DEFINITION_BY_ID[effectEmitterProfile.effectDefinitionId]
        : null;
    if (hasEffectEmitter
        && (!effectEmitterProfile
            || !effectDefinition
            || effectDefinition.effectDefinitionCode
                !== effectEmitterProfile.effectDefinitionCode)) {
        throw new RangeError(
            'enemy-effect-emitter spawn에는 exact emitter/effect catalog profile이 필요합니다.'
        );
    }

    return Object.freeze({
        kindId: GPU_ENEMY_WORLD_KIND_ID,
        definitionId: enemyDefinitionId,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE,
        enemyDefinitionId,
        gateId,
        pathId,
        waypointIndex: GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX,
        spawnSequence,
        waveId,
        policyId,
        capabilityMask,
        position: Object.freeze({
            x: requireFinite(
                entryX + (normalX * laneOffsetTiles) + initialWorldOffsetTiles.x,
                'enemy spawn position.x'
            ),
            y: requireFinite(
                entryY + (normalY * laneOffsetTiles) + initialWorldOffsetTiles.y,
                'enemy spawn position.y'
            )
        }),
        velocity: Object.freeze({
            x: directionUnitX * flowSpeed,
            y: directionUnitY * flowSpeed
        }),
        radius: collisionRadiusTiles,
        inverseMass: resolvedStats.inverseMass,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | (hasCoreImpact
                ? GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
                : 0)
            | (hasContactCombat
                ? GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
                : 0),
        ...(hasContactCombat ? {
            contactHandler: Object.freeze({
                damageSelf: 0,
                damageOther: resolvedStats.towerContactDamage,
                flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS,
                // GPU contact filter owner가 이 named target capability를 소비합니다.
                targetInteractionLayerMask:
                    GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
            })
        } : {}),
        health: resolvedStats.maxHealth,
        lifetime: -1,
        alive: true,
        flowSpeed,
        ...(chargeProfile ? {
            enemyBehaviorState: Object.freeze({
                programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
                ...chargeProfile
            })
        } : {}),
        ...(effectEmitterProfile ? {
            effectEmitterProfileId: effectEmitterProfile.id,
            effectEmitterDefinitionCode: effectEmitterProfile.emitterDefinitionCode,
            effectDefinitionId: effectDefinition.id,
            effectDefinitionCode: effectDefinition.effectDefinitionCode,
            effectSelfTargetAllowed: effectEmitterProfile.selfTargetAllowed,
            effectPentaTargetAllowed: effectEmitterProfile.pentaTargetAllowed,
            effectTowerContactDamageModifiable:
                effectDefinition.towerContactDamageEffectModifiable,
            effectProjectileTowerDamageModifiable:
                effectDefinition.projectileTowerDamageEffectModifiable,
            effectDirectCoreImpactDamageModifiable:
                effectDefinition.directCoreImpactDamageEffectModifiable,
            effectProjectileCoreDamageModifiable:
                effectDefinition.typedProjectileCoreDamageEffectModifiable,
            effectClusterRetargetIntervalTicks:
                effectEmitterProfile.retargetIntervalTicks,
            effectEmitterState: Object.freeze({
                emitterDefinitionCode: effectEmitterProfile.emitterDefinitionCode,
                effectDefinitionCode: effectDefinition.effectDefinitionCode,
                lastPulseTick: GPU_EFFECT_LAST_PULSE_TICK_INVALID,
                flags: GPU_EFFECT_EMITTER_FLAG.ENABLED
            })
        } : {}),
        ...(resolvedStats.physicsProfileId === null ? {} : {
            physicsProfileId: resolvedStats.physicsProfileId,
            combatProfileId: resolvedStats.combatProfileId,
            behaviorProfileId: resolvedStats.behaviorProfileId
        }),
        coreImpactDamage: resolvedStats.coreImpactDamage,
        towerContactDamage: resolvedStats.towerContactDamage,
        bountyBudget: resolvedStats.bountyBudget,
        weight: resolvedStats.weight,
        renderStyle: Object.freeze({
            color,
            radiusScale: requirePositiveFinite(render.radiusScale ?? 1, 'radiusScale'),
            visible: true,
            shapeCode
        })
    });
}
