import {
    ENEMY_EFFECT_APPLICATION_POLICY,
    ENEMY_EFFECT_ATOMIC_TRANSFORM_TRANSFER_POLICY,
    ENEMY_EFFECT_FAMILY,
    ENEMY_EFFECT_STACK_POLICY,
    ENEMY_EFFECT_TARGET_POLICY_CODE,
    ENEMY_EFFECT_TARGET_POLICY_ID,
    normalizeEnemyEffectCatalog
} from 'ingame/contract/enemy_effect_contract.js';

/** 0은 Effect 없음이며 실제 production definition code는 append-only입니다. */
export const GPU_ENEMY_EFFECT_DEFINITION_CODE = Object.freeze({
    NONE: 0,
    PENTA_BOOST: 1
});

/** 0은 emitter 없음이며 실제 production emitter code는 append-only입니다. */
export const GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE = Object.freeze({
    NONE: 0,
    PENTA_CLUSTER_BOOST_PULSE: 1
});

export const PENTA_BOOST_EFFECT_DEFINITION_ID = 'penta-boost-01';
export const PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID = (
    'penta-cluster-boost-pulse-01'
);

const PENTA_BOOST_EFFECT_DEFINITION_SOURCE = Object.freeze({
    id: PENTA_BOOST_EFFECT_DEFINITION_ID,
    effectDefinitionCode: GPU_ENEMY_EFFECT_DEFINITION_CODE.PENTA_BOOST,
    family: ENEMY_EFFECT_FAMILY.BOOST,
    stackPolicy: ENEMY_EFFECT_STACK_POLICY.ACTIVE_INSTANCE_COUNT,
    applicationPolicy: ENEMY_EFFECT_APPLICATION_POLICY.APPEND_INDEPENDENT,
    atomicTransformTransferPolicy:
        ENEMY_EFFECT_ATOMIC_TRANSFORM_TRANSFER_POLICY
            .STABLE_INSTANCE_ID_MODULO_DESTINATION_COUNT,
    durationTicks: 180,
    // 기존 GPU health atomic과 같은 HEALTH_SCALE=100 fixed-point 단위입니다.
    healthDeltaFixedPerTick: 1,
    healthDeltaMinimumStackCount: 1,
    attackMultiplier: 1.25,
    attackMinimumStackCount: 2,
    moveSpeedMultiplier: 1,
    towerContactDamageEffectModifiable: true,
    projectileTowerDamageEffectModifiable: true,
    directCoreImpactDamageEffectModifiable: true,
    typedProjectileCoreDamageEffectModifiable: true,
    tags: Object.freeze(['beneficial', 'boost'])
});

const PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_SOURCE = Object.freeze({
    id: PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID,
    emitterDefinitionCode:
        GPU_ENEMY_EFFECT_EMITTER_DEFINITION_CODE.PENTA_CLUSTER_BOOST_PULSE,
    effectDefinitionId: PENTA_BOOST_EFFECT_DEFINITION_ID,
    effectDefinitionCode: GPU_ENEMY_EFFECT_DEFINITION_CODE.PENTA_BOOST,
    targetPolicyId: ENEMY_EFFECT_TARGET_POLICY_ID.HOSTILE_ENEMY,
    targetPolicyCode: ENEMY_EFFECT_TARGET_POLICY_CODE.HOSTILE_ENEMY,
    seekRadiusTiles: 8,
    clusterRadiusTiles: 3,
    minimumClusterMemberCount: 2,
    retargetIntervalTicks: 15,
    holdRadiusTiles: 2,
    pulseRadiusTiles: 6,
    initialPulseDelayTicks: 120,
    pulseIntervalTicks: 120,
    selfTargetAllowed: false,
    pentaTargetAllowed: true
});

/** Turn 3 production catalog에는 실제 Boost/P runtime record만 등록합니다. */
export const ENEMY_EFFECT_CATALOG = normalizeEnemyEffectCatalog(Object.freeze({
    effectDefinitions: Object.freeze([
        PENTA_BOOST_EFFECT_DEFINITION_SOURCE
    ]),
    emitterProfiles: Object.freeze([
        PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_SOURCE
    ])
}));

export const ENEMY_EFFECT_DEFINITION_BY_ID = ENEMY_EFFECT_CATALOG.effectDefinitionById;
export const ENEMY_EFFECT_DEFINITION_BY_CODE = (
    ENEMY_EFFECT_CATALOG.effectDefinitionByCode
);
export const ENEMY_EFFECT_EMITTER_PROFILE_BY_ID = ENEMY_EFFECT_CATALOG.emitterProfileById;
export const ENEMY_EFFECT_EMITTER_PROFILE_BY_CODE = (
    ENEMY_EFFECT_CATALOG.emitterProfileByCode
);

export const PENTA_BOOST_EFFECT_DEFINITION = (
    ENEMY_EFFECT_DEFINITION_BY_ID[PENTA_BOOST_EFFECT_DEFINITION_ID]
);
export const PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE = (
    ENEMY_EFFECT_EMITTER_PROFILE_BY_ID[
        PENTA_CLUSTER_BOOST_PULSE_EMITTER_PROFILE_ID
    ]
);
