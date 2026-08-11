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
    ENEMY_ORBIT_FIXED_TICKS_PER_SECOND,
    ENEMY_ORBIT_SLOT_CAPACITY,
    ENEMY_ORBIT_SLOT_UNASSIGNED,
    encodeEnemyOrbitAngularStepQ32
} from '../../contract/enemy_orbit_directional_defense_contract.js';
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
    ENEMY_SPAWN_POLICY,
    assertEnemyDefinitionProfileCapabilityConsistency
} from '../../contract/enemy_profile_contract.js';
import {
    ENEMY_FORMATION_POLICY_CODE_BY_ID,
    FORMATION_COORDINATE_SYSTEM_CODE_BY_ID,
    FORMATION_RUNTIME_FLAG,
    assertFormationAtomicTransform,
    assertFormationMembership,
    assertFormationMotionPolicy,
    createFormationIdFromExactHandle,
    createFormationLineageHash,
    isConnectedFormationOccupancyMask
} from '../../contract/enemy_formation_contract.js';
import {
    ENEMY_PROFILE_CATALOG
} from 'data/object/enemy/enemy_profile_catalog_data.js';
import {
    ENEMY_EFFECT_DEFINITION_BY_ID,
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID
} from 'data/object/enemy/enemy_effect_catalog_data.js';
import {
    ENEMY_FORMATION_DEFINITION_BY_ID
} from 'data/object/enemy/enemy_formation_catalog_data.js';
import {
    BASIC_HEXA_ENEMY_DATA,
    BASIC_HEXA_ENEMY_DEFINITION_ID,
    BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID,
    BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID,
    BASIC_HEXA_MAXIMUM_MEMBER_COUNT,
    resolveBasicHexaFormationStats,
    resolveBasicHexaTransformPrivateDefinition
} from 'data/object/enemy/basic_hexa_enemy_data.js';
import {
    assertResolvedEnemySpawnStats,
    resolveEnemySpawnStats
} from './resolved_enemy_spawn_stats.js';
import {
    GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS,
    materializeGpuPlainDataSnapshot,
    normalizeGpuPrivateHexaTransformDestinationIntent,
    normalizeGpuSpawnIntent
} from '../gpu_spawn_intent.js';
import { EnemyCoreImpactDirector } from './enemy_core_impact_director.js';
import { FormationRuntimeDirector } from './formation_runtime_director.js';
import { PentagonEffectDirector } from './pentagon_effect_director.js';

export const GPU_ENEMY_WORLD_KIND_ID = 'enemy';
export const GPU_ENEMY_FIRST_TARGET_WAYPOINT_INDEX = 1;

export {
    GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS,
    normalizeGpuPrivateHexaTransformDestinationIntent
};

const GPU_PRIVATE_HEXA_TRANSFORM_CREATE_OPTION_KEYS = new Set([
    ...GPU_PRIVATE_HEXA_TRANSFORM_DESTINATION_FIELDS,
    'sourceRootView',
    'destinationHandle'
]);

const GPU_ENEMY_RENDER_SHAPE_CODE_BY_TYPE = Object.freeze({
    circle: GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE,
    square: GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE,
    triangle: GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE,
    arrow: GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW,
    penta: GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA,
    hexa: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA,
    gen: GPU_CIRCLE_BODY_RENDER_SHAPE.GEN,
    rhom: GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM,
    octa: GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA
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

function assertOctagonOrbitDirectionalProfile(definition, capabilityId, counterpartId) {
    const behaviorProfileId = requireNonEmptyString(
        definition.behaviorProfileId,
        `enemy ${capabilityId} behaviorProfileId`
    );
    const behaviorProfile = ENEMY_PROFILE_CATALOG.behaviorById[behaviorProfileId];
    const capabilityMask = createEnemyCapabilityMask(
        definition.capabilityIds,
        `enemy ${capabilityId} capabilityIds`
    );
    const shapeCode = resolveEnemyRenderShapeCode(
        Object.prototype.hasOwnProperty.call(definition, 'shapeDefinitionId')
            ? definition.shapeDefinitionId
            : definition.shapeType
    );
    if (!behaviorProfile?.orbit
        || !behaviorProfile?.directionalDefense
        || !hasEnemyCapability(capabilityMask, counterpartId)
        || behaviorProfile.charge
        || shapeCode !== GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA
        || behaviorProfile.orbit.fixedTicksPerSecond
            !== ENEMY_ORBIT_FIXED_TICKS_PER_SECOND
        || behaviorProfile.orbit.slotCapacity !== ENEMY_ORBIT_SLOT_CAPACITY
        || behaviorProfile.directionalDefense.armoredFacetCount !== 3
        || behaviorProfile.directionalDefense.totalFacetCount
            !== ENEMY_ORBIT_SLOT_CAPACITY) {
        throw new RangeError(
            `${capabilityId} capability에는 counterpart와 exact orbit/directionalDefense profile이 필요합니다.`
        );
    }
}

function assertDirectionalDefenseCapabilityDefinition(definition) {
    assertOctagonOrbitDirectionalProfile(
        definition,
        ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE,
        ENEMY_CAPABILITY_ID.ORBIT
    );
}

function assertOrbitCapabilityDefinition(definition) {
    assertOctagonOrbitDirectionalProfile(
        definition,
        ENEMY_CAPABILITY_ID.ORBIT,
        ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE
    );
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

function assertFormationCapabilityDefinition(definition) {
    const capabilityMask = createEnemyCapabilityMask(
        definition.capabilityIds,
        'enemy Formation capabilityIds'
    );
    resolveEnemyFormationFacts(definition, capabilityMask);
}

function assertAtomicTransformCapabilityDefinition(definition) {
    // ATOMIC_TRANSFORM은 독립 capability입니다. 현재 H는 Formation과 함께 쓰지만
    // generic definition contract에서 두 capability를 서로 강제하지 않습니다.
    requireNonEmptyString(definition.id, 'enemy atomic transform definitionId');
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

/** 실제 FormationRuntimeDirector의 generic exact-handle roster seam입니다. */
export const GPU_ENEMY_FORMATION_ROSTER_PORT = Object.freeze({
    observeLifecycle: FormationRuntimeDirector.prototype.observeLifecycle,
    observeCompletedPreparations:
        FormationRuntimeDirector.prototype.observeCompletedPreparations,
    stageForFixedTick: FormationRuntimeDirector.prototype.stageForFixedTick,
    observeFixedCommit: FormationRuntimeDirector.prototype.observeFixedCommit,
    getStatus: FormationRuntimeDirector.prototype.getStatus,
    requiresRecovery: FormationRuntimeDirector.prototype.requiresRecovery,
    resetGpuBinding: FormationRuntimeDirector.prototype.resetGpuBinding,
    closeForTerminal: FormationRuntimeDirector.prototype.closeForTerminal,
    destroy: FormationRuntimeDirector.prototype.destroy
});
assertEnemyLifecycleObserver(GPU_ENEMY_FORMATION_ROSTER_PORT);
assertEnemyFixedCommandProducer(GPU_ENEMY_FORMATION_ROSTER_PORT);

/** Director bounded SoA가 소유하는 exact consumed-lineage membership port입니다. */
export const GPU_ENEMY_FORMATION_MEMBERSHIP_PORT = Object.freeze({
    getMemberCount: FormationRuntimeDirector.prototype.getMemberCount,
    hasExactMember: FormationRuntimeDirector.prototype.hasExactMember,
    copyExactMemberHandleAt:
        FormationRuntimeDirector.prototype.copyExactMemberHandleAt
});
assertFormationMembership(GPU_ENEMY_FORMATION_MEMBERSHIP_PORT);

/** Director의 route-progress/join-candidate deterministic motion policy port입니다. */
export const GPU_ENEMY_FORMATION_MOTION_POLICY_PORT = Object.freeze({
    acceptsRouteProgress:
        FormationRuntimeDirector.prototype.acceptsRouteProgress,
    compareJoinCandidates:
        FormationRuntimeDirector.prototype.compareJoinCandidates
});
assertFormationMotionPolicy(GPU_ENEMY_FORMATION_MOTION_POLICY_PORT);

/** Lifecycle privileged whole-operation transform를 잇는 실제 atomic port입니다. */
export const GPU_ENEMY_FORMATION_ATOMIC_TRANSFORM_PORT = Object.freeze({
    preflightTransform: FormationRuntimeDirector.prototype.preflightTransform,
    commitPreflightedTransform:
        FormationRuntimeDirector.prototype.commitPreflightedTransform,
    cancelPreflightedTransform:
        FormationRuntimeDirector.prototype.cancelPreflightedTransform
});
assertFormationAtomicTransform(GPU_ENEMY_FORMATION_ATOMIC_TRANSFORM_PORT);

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
            capabilityId: ENEMY_CAPABILITY_ID.FORMATION,
            implementationId: 'formation-runtime-director',
            assertDefinition: assertFormationCapabilityDefinition,
            rosterPort: GPU_ENEMY_FORMATION_ROSTER_PORT
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.ATOMIC_TRANSFORM,
            implementationId: 'formation-runtime-director-atomic-transform',
            assertDefinition: assertAtomicTransformCapabilityDefinition,
            rosterPort: GPU_ENEMY_FORMATION_ROSTER_PORT
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.CHARGE,
            implementationId: 'gpu-exact-tower-charge',
            assertDefinition: assertChargeCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE,
            implementationId: 'gpu-octagon-directional-flat-defense',
            assertDefinition: assertDirectionalDefenseCapabilityDefinition
        }),
        Object.freeze({
            capabilityId: ENEMY_CAPABILITY_ID.ORBIT,
            implementationId: 'gpu-octagon-tower-orbit',
            assertDefinition: assertOrbitCapabilityDefinition
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

function requireNonNegativeSafeInteger(value, label) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, allowZero = true) {
    if (typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < (allowZero ? 0 : 1)
        || value > 0xffffffff) {
        throw new RangeError(`${label}은 ${allowZero ? '' : 'nonzero '}uint32여야 합니다.`);
    }
    return value >>> 0;
}

function popcountUint32(value) {
    let bits = value >>> 0;
    let count = 0;
    while (bits !== 0) {
        bits = (bits & (bits - 1)) >>> 0;
        count++;
    }
    return count;
}

function resolveEnemyFormationFacts(definition, capabilityMask) {
    const hasFormation = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.FORMATION,
        'enemy capabilityMask'
    );
    if (!hasFormation) {
        return null;
    }
    const formationDefinition = ENEMY_FORMATION_DEFINITION_BY_ID[
        definition.formationDefinitionId
    ];
    // Behavior profile scalar는 이 author/publication compatibility seam에서만
    // policy ID를 resolve합니다. GPU/Director에는 behavior state/program을 만들지 않고
    // 아래 독립 Formation definition/policy code facts만 전달합니다.
    const behaviorProfile = ENEMY_PROFILE_CATALOG.behaviorById[
        definition.behaviorProfileId
    ];
    const formationPolicyId = behaviorProfile?.formationPolicy;
    const formationPolicyCode = ENEMY_FORMATION_POLICY_CODE_BY_ID[
        formationPolicyId
    ];
    if (!formationDefinition
        || formationPolicyCode === undefined
        || FORMATION_COORDINATE_SYSTEM_CODE_BY_ID[
            formationDefinition.coordinateSystemId
        ] !== formationDefinition.coordinateSystemCode) {
        throw new RangeError(
            'enemy Formation capability에는 exact formation definition/policy가 필요합니다.'
        );
    }
    return Object.freeze({
        formationDefinitionId: formationDefinition.id,
        formationDefinitionCode: formationDefinition.definitionCode,
        formationCoordinateSystemId: formationDefinition.coordinateSystemId,
        formationCoordinateSystemCode: formationDefinition.coordinateSystemCode,
        formationPolicyId,
        formationPolicyCode,
        // Public natural H는 reserve 뒤 activation helper가 complete state/hash를 주입합니다.
        formationMemberCount: 1
    });
}

const FORMATION_PROVENANCE_KEYS = new Set([
    'formationGroupId',
    'formationAuthoredCoordinateSystemId',
    'formationAuthoredMemberCount',
    'formationRows',
    'formationColumns',
    'formationMemberIndex',
    'formationMemberSlotIndex',
    'formationRowIndex',
    'formationColumnIndex',
    'formationAuthoredOccupiedSlotMask'
]);

function normalizeFormationProvenance(source, formationFacts) {
    if (source === undefined || source === null) {
        return {};
    }
    if (formationFacts === null) {
        throw new RangeError('authored Formation provenance에는 Formation capability가 필요합니다.');
    }
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError('formationProvenance는 plain object여야 합니다.');
    }
    for (const key of Object.keys(source)) {
        if (!FORMATION_PROVENANCE_KEYS.has(key)) {
            throw new RangeError(`formationProvenance에 알 수 없는 필드가 있습니다: ${key}`);
        }
    }
    const formationDefinition = ENEMY_FORMATION_DEFINITION_BY_ID[
        formationFacts.formationDefinitionId
    ];
    const formationGroupId = requireNonEmptyString(
        source.formationGroupId,
        'formationProvenance.formationGroupId'
    );
    const formationAuthoredCoordinateSystemId = requireNonEmptyString(
        source.formationAuthoredCoordinateSystemId,
        'formationProvenance.formationAuthoredCoordinateSystemId'
    );
    if (formationAuthoredCoordinateSystemId
        !== formationDefinition.coordinateSystemId) {
        throw new RangeError(
            'authored/runtime Formation coordinateSystemId가 일치해야 합니다.'
        );
    }
    const formationAuthoredMemberCount = requireNonNegativeSafeInteger(
        source.formationAuthoredMemberCount,
        'formationProvenance.formationAuthoredMemberCount'
    );
    const formationRows = requireNonNegativeSafeInteger(
        source.formationRows,
        'formationProvenance.formationRows'
    );
    const formationColumns = requireNonNegativeSafeInteger(
        source.formationColumns,
        'formationProvenance.formationColumns'
    );
    if (formationAuthoredMemberCount <= 0
        || formationAuthoredMemberCount > formationDefinition.maximumMemberCount
        || formationRows <= 0
        || formationColumns <= 0
        || (formationRows & 1) === 0
        || (formationColumns & 1) === 0) {
        throw new RangeError('authored Formation member/dimensions가 six-ring 범위를 벗어났습니다.');
    }
    const formationMemberIndex = requireNonNegativeSafeInteger(
        source.formationMemberIndex,
        'formationProvenance.formationMemberIndex'
    );
    const formationMemberSlotIndex = requireNonNegativeSafeInteger(
        source.formationMemberSlotIndex,
        'formationProvenance.formationMemberSlotIndex'
    );
    const formationRowIndex = requireNonNegativeSafeInteger(
        source.formationRowIndex,
        'formationProvenance.formationRowIndex'
    );
    const formationColumnIndex = requireNonNegativeSafeInteger(
        source.formationColumnIndex,
        'formationProvenance.formationColumnIndex'
    );
    if (formationMemberIndex >= formationAuthoredMemberCount
        || formationMemberSlotIndex >= formationDefinition.slotCount
        || formationRowIndex >= formationRows
        || formationColumnIndex >= formationColumns) {
        throw new RangeError('authored Formation member provenance index가 범위를 벗어났습니다.');
    }
    const formationAuthoredOccupiedSlotMask = requireUint32(
        source.formationAuthoredOccupiedSlotMask,
        'formationProvenance.formationAuthoredOccupiedSlotMask',
        false
    );
    const validMask = (1 << formationDefinition.slotCount) - 1;
    const centerRow = (formationRows - 1) * 0.5;
    const centerColumn = (formationColumns - 1) * 0.5;
    const q = formationColumnIndex - centerColumn;
    const r = formationRowIndex - centerRow;
    const resolvedSlotIndex = formationDefinition.slotCoordinates.findIndex(
        (coordinate) => coordinate.q === q && coordinate.r === r
    );
    if ((formationAuthoredOccupiedSlotMask & ~validMask) !== 0
        || resolvedSlotIndex !== formationMemberSlotIndex
        || (formationAuthoredOccupiedSlotMask & (1 << formationMemberSlotIndex)) === 0
        || popcountUint32(formationAuthoredOccupiedSlotMask)
            !== formationAuthoredMemberCount
        || !isConnectedFormationOccupancyMask(
            formationDefinition.neighborMasks,
            formationAuthoredOccupiedSlotMask,
            formationDefinition.slotCount
        )) {
        throw new RangeError('authored Formation occupied slot provenance가 올바르지 않습니다.');
    }
    return {
        formationGroupId,
        formationAuthoredCoordinateSystemId,
        formationAuthoredMemberCount,
        formationRows,
        formationColumns,
        formationMemberIndex,
        formationMemberSlotIndex,
        formationRowIndex,
        formationColumnIndex,
        formationAuthoredOccupiedSlotMask
    };
}

function isCanonicalEnemyDefinition(definition) {
    const profileFields = [
        'spawnPolicy',
        'shapeDefinitionId',
        'physicsProfileId',
        'combatProfileId',
        'behaviorProfileId',
        'formationDefinitionId',
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

function assertExactNaturalHexaStats(resolvedStats, definitionId) {
    if (definitionId !== BASIC_HEXA_ENEMY_DEFINITION_ID) {
        return resolvedStats;
    }
    const exact = resolveBasicHexaFormationStats(1);
    for (const field of [
        'moveSpeedTilesPerSecond',
        'weight',
        'inverseMass',
        'towerContactDamage',
        'coreImpactDamage',
        'bountyBudget'
    ]) {
        if (resolvedStats[field] !== exact[field]) {
            throw new RangeError(
                `natural H resolvedStats.${field}는 fixed n1 table과 같아야 합니다.`
            );
        }
    }
    return resolvedStats;
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
        return assertExactNaturalHexaStats(resolvedStats, definitionId);
    }
    if (!canonical) {
        return assertExactNaturalHexaStats(
            resolveLegacyEnemySpawnStats(definition, definitionId),
            definitionId
        );
    }
    assertGpuEnemyDefinitionCapabilities(definition);
    return assertExactNaturalHexaStats(resolveEnemySpawnStats({
        definition,
        profileCatalog: ENEMY_PROFILE_CATALOG,
        mapEnemyModifiers: options.mapEnemyModifiers,
        waveEnemyModifiers: options.waveEnemyModifiers,
        knownDefinitionIds: options.knownDefinitionIds
    }), definitionId);
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
 * @param {{definition:object,route:object,spawnSequence:number,laneOffsetTiles?:number,initialWorldOffsetTiles?:{x:number,y:number}|null,waveId?:string|null,policyId?:string|null,resolvedStats?:object,collisionRadiusTilesOverride?:number,formationProvenance?:object|null}} options
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
    if (enemyDefinitionId === BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
        || enemyDefinitionId === BASIC_HEXA_HIVE_ENEMY_DEFINITION_ID) {
        throw new RangeError(
            'transform-private H/HX definition은 public GPU spawn에서 금지됩니다.'
        );
    }
    const canonicalDefinition = isCanonicalEnemyDefinition(definition);
    if (canonicalDefinition
        && definition.spawnPolicy !== ENEMY_SPAWN_POLICY.NATURAL) {
        throw new RangeError(
            'public GPU enemy spawn은 natural EnemyDefinition만 허용합니다.'
        );
    }
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
    const capabilityMask = canonicalDefinition
        ? createEnemyCapabilityMask(
            definition.capabilityIds,
            'enemyDefinition.capabilityIds'
        )
        : LEGACY_GPU_ENEMY_CAPABILITY_MASK;
    const formationFacts = canonicalDefinition
        ? resolveEnemyFormationFacts(definition, capabilityMask)
        : null;
    const formationProvenance = normalizeFormationProvenance(
        options.formationProvenance,
        formationFacts
    );
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
    const hasDirectionalDefense = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.DIRECTIONAL_DEFENSE,
        'enemy capabilityMask'
    );
    const hasOrbit = hasEnemyCapability(
        capabilityMask,
        ENEMY_CAPABILITY_ID.ORBIT,
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
    if (Object.keys(formationProvenance).length > 0 && waveId === null) {
        throw new TypeError('authored Formation provenance에는 waveId가 필요합니다.');
    }
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
    const behaviorProfile = canonicalDefinition
        ? ENEMY_PROFILE_CATALOG.behaviorById[definition.behaviorProfileId]
        : null;
    const chargeProfile = hasCharge
        ? behaviorProfile?.charge
        : null;
    if (hasCharge && !chargeProfile) {
        throw new RangeError('enemy-charge spawn에는 charge behavior profile이 필요합니다.');
    }
    const orbitProfile = hasOrbit ? behaviorProfile?.orbit : null;
    const directionalDefenseProfile = hasDirectionalDefense
        ? behaviorProfile?.directionalDefense
        : null;
    if ((hasOrbit || hasDirectionalDefense)
        && (!orbitProfile
            || !directionalDefenseProfile
            || !hasOrbit
            || !hasDirectionalDefense
            || hasCharge
            || shapeCode !== GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA
            || orbitProfile.fixedTicksPerSecond
                !== ENEMY_ORBIT_FIXED_TICKS_PER_SECOND
            || orbitProfile.slotCapacity !== ENEMY_ORBIT_SLOT_CAPACITY)) {
        throw new RangeError(
            'directional O spawn에는 exclusive OCTA orbit/defense exact profile이 필요합니다.'
        );
    }
    const octagonOrbitBehaviorState = orbitProfile && directionalDefenseProfile
        ? Object.freeze({
            programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT,
            coordinateSystemCode: orbitProfile.coordinateSystemCode,
            orbitRadiusTiles: orbitProfile.orbitRadiusTiles,
            angularStepQ32: encodeEnemyOrbitAngularStepQ32(
                orbitProfile.angularSpeedRadiansPerSecond,
                orbitProfile.fixedTicksPerSecond
            ),
            // Lifecycle lease owner가 registry commit 전에 exact 0..7로 materialize합니다.
            orbitSlotIndex: ENEMY_ORBIT_SLOT_UNASSIGNED,
            orbitSlotCapacity: orbitProfile.slotCapacity,
            flatReductionFixedPoint:
                directionalDefenseProfile.flatReductionFixedPoint,
            armoredFacetCount: directionalDefenseProfile.armoredFacetCount,
            totalFacetCount: directionalDefenseProfile.totalFacetCount
        })
        : null;
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
        spawnPolicy: ENEMY_SPAWN_POLICY.NATURAL,
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
        ...(octagonOrbitBehaviorState ? {
            orbitCoordinateSystemId: orbitProfile.coordinateSystemId,
            orbitCoordinateSystemCode: orbitProfile.coordinateSystemCode,
            orbitSlotIndex: ENEMY_ORBIT_SLOT_UNASSIGNED,
            orbitSlotCapacity: orbitProfile.slotCapacity
        } : {}),
        ...(formationFacts ?? {}),
        ...formationProvenance,
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
        ...(chargeProfile || octagonOrbitBehaviorState ? {
            enemyBehaviorState: Object.freeze({
                ...(chargeProfile ? {
                    programId: GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE,
                    ...chargeProfile
                } : octagonOrbitBehaviorState)
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

function requireExactHandleComponent(value, label) {
    const component = requireUint32(value, label, false);
    if (component === 0xffffffff) {
        throw new RangeError(`${label}은 reserved sentinel보다 작아야 합니다.`);
    }
    return component;
}

function normalizeExactHandle(source, label) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new TypeError(`${label} exact handle이 필요합니다.`);
    }
    return Object.freeze({
        entityId: requireExactHandleComponent(source.entityId, `${label}.entityId`),
        incarnation: requireExactHandleComponent(
            source.incarnation,
            `${label}.incarnation`
        )
    });
}

function createFormationRuntimeFields({
    formationFacts,
    destinationHandle,
    memberCount,
    occupiedSlotMask,
    rotationStep,
    generation,
    lineageHash
}) {
    const formationDefinition = ENEMY_FORMATION_DEFINITION_BY_ID[
        formationFacts.formationDefinitionId
    ];
    const count = requireNonNegativeSafeInteger(memberCount, 'formationMemberCount');
    const mask = requireUint32(
        occupiedSlotMask,
        'formationOccupiedSlotMask',
        false
    );
    const rotation = requireNonNegativeSafeInteger(
        rotationStep,
        'formationRotationStep'
    );
    const generationValue = requireUint32(
        generation,
        'formationGeneration',
        false
    );
    const lineageHashValue = requireUint32(
        lineageHash,
        'formationLineageHash',
        false
    );
    if (generationValue === 0xffffffff || lineageHashValue === 0xffffffff) {
        throw new RangeError('Formation generation/hash는 reserved sentinel일 수 없습니다.');
    }
    const validMask = (1 << formationDefinition.slotCount) - 1;
    if (count <= 0
        || count > formationDefinition.maximumMemberCount
        || rotation >= formationDefinition.slotCount
        || (mask & ~validMask) !== 0
        || popcountUint32(mask) !== count
        || !isConnectedFormationOccupancyMask(
            formationDefinition.neighborMasks,
            mask,
            formationDefinition.slotCount
        )) {
        throw new RangeError('Formation runtime member/occupancy/rotation facts가 올바르지 않습니다.');
    }
    const flags = FORMATION_RUNTIME_FLAG.ACTIVE;
    return Object.freeze({
        formationId: createFormationIdFromExactHandle(destinationHandle),
        formationMemberCount: count,
        formationOccupiedSlotMask: mask,
        formationRotationStep: rotation,
        formationGeneration: generationValue,
        formationFlags: flags,
        formationLineageHash: lineageHashValue,
        formationState: Object.freeze({
            definitionCode: formationFacts.formationDefinitionCode,
            coordinateSystemCode: formationFacts.formationCoordinateSystemCode,
            policyCode: formationFacts.formationPolicyCode,
            memberCount: count,
            occupiedSlotMask: mask,
            rotationStep: rotation,
            generation: generationValue,
            flags,
            lineageHash: lineageHashValue
        })
    });
}

/**
 * Public/raw H intent가 WorldRegistry exact handle을 예약한 뒤 lifecycle owner가 호출하는
 * activation-only materializer입니다. Raw ingress가 formationId/hash/state를 forge할 수
 * 없도록 이 단계 전 intent에는 runtime fields가 없어야 합니다.
 */
export function materializeNaturalHexaFormationActivation(intent, handle) {
    if (!intent || typeof intent !== 'object' || Array.isArray(intent)) {
        throw new TypeError('natural H activation intent가 필요합니다.');
    }
    const activationSource = normalizeGpuSpawnIntent(intent);
    const exactHandle = normalizeExactHandle(handle, 'naturalHexaHandle');
    if (activationSource.kindId !== GPU_ENEMY_WORLD_KIND_ID
        || activationSource.definitionId !== BASIC_HEXA_ENEMY_DEFINITION_ID
        || activationSource.enemyDefinitionId !== BASIC_HEXA_ENEMY_DEFINITION_ID
        || activationSource.spawnPolicy !== ENEMY_SPAWN_POLICY.NATURAL
        || activationSource.formationMemberCount !== 1) {
        throw new RangeError('activation helper는 exact natural n1 H intent만 허용합니다.');
    }
    for (const field of [
        'formationId',
        'formationOccupiedSlotMask',
        'formationRotationStep',
        'formationGeneration',
        'formationFlags',
        'formationLineageHash',
        'formationState'
    ]) {
        if (activationSource[field] !== undefined
            && activationSource[field] !== null) {
            throw new RangeError(`raw natural H intent가 runtime field를 선점했습니다: ${field}`);
        }
    }
    const formationFacts = Object.freeze({
        formationDefinitionId: activationSource.formationDefinitionId,
        formationDefinitionCode: activationSource.formationDefinitionCode,
        formationCoordinateSystemId:
            activationSource.formationCoordinateSystemId,
        formationCoordinateSystemCode:
            activationSource.formationCoordinateSystemCode,
        formationPolicyId: activationSource.formationPolicyId,
        formationPolicyCode: activationSource.formationPolicyCode
    });
    const slotIndex = activationSource.formationMemberSlotIndex == null
        ? 0
        : requireNonNegativeSafeInteger(
            activationSource.formationMemberSlotIndex,
            'formationMemberSlotIndex'
        );
    const runtimeFields = createFormationRuntimeFields({
        formationFacts,
        destinationHandle: exactHandle,
        memberCount: 1,
        occupiedSlotMask: 1 << slotIndex,
        rotationStep: 0,
        generation: 1,
        lineageHash: createFormationLineageHash([exactHandle])
    });
    return Object.freeze({ ...activationSource, ...runtimeFields });
}

/**
 * Privileged atomic-transform path 전용 immutable GPU destination descriptor입니다.
 * CPU pose/velocity를 만들지 않으며 GPU가 root slot과 authoritative pose를 유지합니다.
 */
export function createGpuPrivateHexaTransformDestinationIntent(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
        throw new TypeError('private Hexa transform create options가 필요합니다.');
    }
    const optionKeys = Reflect.ownKeys(options);
    if (optionKeys.some((key) => typeof key === 'symbol')) {
        throw new TypeError('private Hexa transform create options에는 symbol이 금지됩니다.');
    }
    for (const key of optionKeys) {
        if (!GPU_PRIVATE_HEXA_TRANSFORM_CREATE_OPTION_KEYS.has(key)) {
            throw new RangeError(
                `private Hexa transform create options에 금지/unknown field가 있습니다: ${key}`
            );
        }
    }
    const optionSnapshot = materializeGpuPlainDataSnapshot(
        options,
        'privateHexaTransformCreateOptions'
    );
    const sourceRootView = optionSnapshot.sourceRootView;
    if (!sourceRootView
        || typeof sourceRootView !== 'object'
        || Array.isArray(sourceRootView)
        || sourceRootView.kindId !== GPU_ENEMY_WORLD_KIND_ID) {
        throw new TypeError('sourceRootView는 active Enemy registry view여야 합니다.');
    }
    const sourceRootHandle = normalizeExactHandle(sourceRootView, 'sourceRootView');
    const destinationHandle = normalizeExactHandle(
        optionSnapshot.destinationHandle,
        'destinationHandle'
    );
    const metadata = sourceRootView.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new TypeError('sourceRootView.metadata가 필요합니다.');
    }
    const sourceDefinitionId = sourceRootView.definitionId;
    if (sourceDefinitionId !== BASIC_HEXA_ENEMY_DEFINITION_ID
        && sourceDefinitionId !== BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID) {
        throw new RangeError('Hexa transform source root는 natural H 또는 active H group이어야 합니다.');
    }
    const sourceMemberCount = requireUint32(
        metadata.formationMemberCount,
        'sourceRootView.metadata.formationMemberCount',
        false
    );
    if ((sourceDefinitionId === BASIC_HEXA_ENEMY_DEFINITION_ID
            && sourceMemberCount !== 1)
        || (sourceDefinitionId === BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
            && (sourceMemberCount < 2
                || sourceMemberCount >= BASIC_HEXA_MAXIMUM_MEMBER_COUNT))) {
        throw new RangeError('Hexa transform source definition/memberCount가 일치하지 않습니다.');
    }
    const sourceDefinition = sourceDefinitionId === BASIC_HEXA_ENEMY_DEFINITION_ID
        ? BASIC_HEXA_ENEMY_DATA
        : resolveBasicHexaTransformPrivateDefinition(sourceMemberCount);
    const sourceCapabilityMask = createEnemyCapabilityMask(
        sourceDefinition.capabilityIds,
        'sourceRootView.capabilityIds'
    );
    const sourceFormationFacts = resolveEnemyFormationFacts(
        sourceDefinition,
        sourceCapabilityMask
    );
    const sourceRuntimeFields = createFormationRuntimeFields({
        formationFacts: sourceFormationFacts,
        destinationHandle: sourceRootHandle,
        memberCount: sourceMemberCount,
        occupiedSlotMask: metadata.formationOccupiedSlotMask,
        rotationStep: metadata.formationRotationStep,
        generation: metadata.formationGeneration,
        lineageHash: metadata.formationLineageHash
    });
    const sourceStats = resolveBasicHexaFormationStats(sourceMemberCount);
    const exactSourceMetadata = Object.freeze({
        definitionId: sourceDefinition.id,
        enemyDefinitionId: sourceDefinition.id,
        capabilityMask: sourceCapabilityMask,
        physicsProfileId: sourceDefinition.physicsProfileId,
        combatProfileId: sourceDefinition.combatProfileId,
        behaviorProfileId: sourceDefinition.behaviorProfileId,
        formationDefinitionId: sourceFormationFacts.formationDefinitionId,
        formationDefinitionCode: sourceFormationFacts.formationDefinitionCode,
        formationCoordinateSystemId:
            sourceFormationFacts.formationCoordinateSystemId,
        formationCoordinateSystemCode:
            sourceFormationFacts.formationCoordinateSystemCode,
        formationPolicyId: sourceFormationFacts.formationPolicyId,
        formationPolicyCode: sourceFormationFacts.formationPolicyCode,
        formationId: sourceRuntimeFields.formationId,
        formationMemberCount: sourceRuntimeFields.formationMemberCount,
        formationOccupiedSlotMask:
            sourceRuntimeFields.formationOccupiedSlotMask,
        formationRotationStep: sourceRuntimeFields.formationRotationStep,
        formationGeneration: sourceRuntimeFields.formationGeneration,
        formationFlags: sourceRuntimeFields.formationFlags,
        formationLineageHash: sourceRuntimeFields.formationLineageHash,
        coreImpactDamage: sourceStats.coreImpactDamage,
        towerContactDamage: sourceStats.towerContactDamage,
        bountyBudget: sourceStats.bountyBudget,
        weight: sourceStats.weight
    });
    for (const [field, expected] of Object.entries(exactSourceMetadata)) {
        if (metadata[field] !== expected) {
            throw new RangeError(
                `Hexa transform source root metadata.${field}가 canonical source와 다릅니다.`
            );
        }
    }
    if ((sourceDefinitionId === BASIC_HEXA_ENEMY_DEFINITION_ID
            && sourceRuntimeFields.formationGeneration !== 1)
        || (sourceDefinitionId === BASIC_HEXA_GROUP_ENEMY_DEFINITION_ID
            && sourceRuntimeFields.formationGeneration <= 1)) {
        throw new RangeError('Hexa transform source generation이 definition stage와 다릅니다.');
    }
    if (sourceMemberCount >= BASIC_HEXA_MAXIMUM_MEMBER_COUNT) {
        throw new RangeError('Hexa transform source root metadata가 exact active Formation이 아닙니다.');
    }
    const normalizedDestination = normalizeGpuPrivateHexaTransformDestinationIntent({
        memberCount: optionSnapshot.memberCount,
        currentHealthCenti: optionSnapshot.currentHealthCenti,
        maxHealthCenti: optionSnapshot.maxHealthCenti,
        formationOccupiedSlotMask: optionSnapshot.formationOccupiedSlotMask,
        formationRotationStep: optionSnapshot.formationRotationStep,
        formationGeneration: optionSnapshot.formationGeneration,
        formationLineageHash: optionSnapshot.formationLineageHash
    });
    const memberCount = normalizedDestination.memberCount;
    if (memberCount <= sourceMemberCount
        || normalizedDestination.formationGeneration
            <= sourceRuntimeFields.formationGeneration) {
        throw new RangeError(
            'Hexa transform destination은 source보다 큰 memberCount/generation이어야 합니다.'
        );
    }
    if (destinationHandle.entityId !== sourceRootHandle.entityId
        || destinationHandle.incarnation !== sourceRootHandle.incarnation + 1) {
        throw new RangeError(
            'Hexa transform destination identity는 source root의 next incarnation이어야 합니다.'
        );
    }
    const definition = resolveBasicHexaTransformPrivateDefinition(memberCount);
    const stats = resolveBasicHexaFormationStats(memberCount);
    const currentHealthCenti = normalizedDestination.currentHealthCenti;
    const maxHealthCenti = normalizedDestination.maxHealthCenti;
    const capabilityMask = createEnemyCapabilityMask(
        definition.capabilityIds,
        'privateHexaDefinition.capabilityIds'
    );
    const formationFacts = resolveEnemyFormationFacts(definition, capabilityMask);
    const generation = requireUint32(
        normalizedDestination.formationGeneration,
        'formationGeneration',
        false
    );
    if (generation <= 1) {
        throw new RangeError('committed Hexa transform generation은 2 이상이어야 합니다.');
    }
    const runtimeFields = createFormationRuntimeFields({
        formationFacts,
        destinationHandle,
        memberCount,
        occupiedSlotMask: normalizedDestination.formationOccupiedSlotMask,
        rotationStep: normalizedDestination.formationRotationStep,
        generation,
        lineageHash: normalizedDestination.formationLineageHash
    });
    const physicsProfile = ENEMY_PROFILE_CATALOG.physicsById[
        definition.physicsProfileId
    ];
    const render = definition.render;
    const gateId = requireNonEmptyString(metadata.gateId, 'sourceRootView.metadata.gateId');
    const pathId = requireNonEmptyString(metadata.pathId, 'sourceRootView.metadata.pathId');
    const waypointIndex = requireNonNegativeSafeInteger(
        metadata.initialWaypointIndex,
        'sourceRootView.metadata.initialWaypointIndex'
    );
    const spawnSequence = requireNonNegativeSafeInteger(
        metadata.spawnSequence,
        'sourceRootView.metadata.spawnSequence'
    );
    if (metadata.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
        || metadata.allegiancePolicy !== GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE) {
        throw new RangeError('Hexa transform source는 fixed hostile Enemy여야 합니다.');
    }
    return Object.freeze({
        kindId: GPU_ENEMY_WORLD_KIND_ID,
        spawnPolicy: ENEMY_SPAWN_POLICY.TRANSFORM_PRIVATE,
        definitionId: definition.id,
        enemyDefinitionId: definition.id,
        sourceRootEntityId: sourceRootHandle.entityId,
        sourceRootIncarnation: sourceRootHandle.incarnation,
        destinationEntityId: destinationHandle.entityId,
        destinationIncarnation: destinationHandle.incarnation,
        teamId: metadata.teamId,
        damagePolicyId: metadata.damagePolicyId,
        allegiancePolicy: metadata.allegiancePolicy,
        gateId,
        pathId,
        waypointIndex,
        spawnSequence,
        waveId: metadata.waveId ?? null,
        policyId: metadata.policyId ?? null,
        capabilityMask,
        ...formationFacts,
        ...runtimeFields,
        physicsProfileId: definition.physicsProfileId,
        combatProfileId: definition.combatProfileId,
        behaviorProfileId: definition.behaviorProfileId,
        radius: physicsProfile.collisionRadiusTiles,
        inverseMass: stats.inverseMass,
        bodyLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        collisionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.KINEMATIC_OBSTACLE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.TERRAIN,
        interactionLayer: GPU_CIRCLE_BODY_COLLISION_LAYER.ENEMY,
        interactionMask: GPU_CIRCLE_BODY_COLLISION_LAYER.PROJECTILE
            | GPU_CIRCLE_BODY_COLLISION_LAYER.CORE_PROXY
            | GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE,
        contactHandler: Object.freeze({
            damageSelf: 0,
            damageOther: stats.towerContactDamage,
            flags: GPU_CIRCLE_BODY_CONTACT_HANDLER_FLAG.INTERACTION_CONTINUOUS,
            targetInteractionLayerMask:
                GPU_CIRCLE_BODY_COLLISION_LAYER.PLAYER_DAMAGEABLE
        }),
        healthFixedPoint: currentHealthCenti,
        maxHealthFixedPoint: maxHealthCenti,
        lifetime: -1,
        alive: true,
        flowSpeed: stats.moveSpeedTilesPerSecond,
        coreImpactDamage: stats.coreImpactDamage,
        towerContactDamage: stats.towerContactDamage,
        bountyBudget: stats.bountyBudget,
        weight: stats.weight,
        renderStyle: Object.freeze({
            color: render.colorRgba,
            radiusScale: render.radiusScale,
            visible: true,
            shapeCode: GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA
        })
    });
}
