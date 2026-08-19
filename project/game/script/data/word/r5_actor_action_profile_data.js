import {
    ACTOR_ACTION_ACTIVATION_POLICY,
    ACTOR_ACTION_PLACEMENT_POLICY,
    ACTOR_ACTION_PROFILE_ABI_VERSION,
    ACTOR_ACTION_PROFILE_ID,
    ACTOR_ACTION_SPAWN_ANCHOR_POLICY,
    ACTOR_ACTION_TARGET_POLICY,
    ACTOR_ACTION_TARGET_SNAPSHOT_POLICY,
    ACTOR_ACTION_TRANSIT_POLICY,
    normalizeActorActionProfile
} from 'ingame/contract/actor_action_contract.js';
import {
    SENTENCE_ACTION_CODE
} from 'ingame/contract/word_sentence_contract.js';

const IMMEDIATE_TRANSIT = Object.freeze({
    policy: ACTOR_ACTION_TRANSIT_POLICY.NONE,
    suspendControl: false,
    suspendSubjectSelection: false,
    suspendTargetAcceptance: false,
    suppressContact: false
});

const AIRBORNE_TRANSIT = Object.freeze({
    policy: ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH,
    suspendControl: true,
    suspendSubjectSelection: true,
    suspendTargetAcceptance: true,
    suppressContact: true
});

export const R5_SHOOT_ACTOR_ACTION_PROFILE = normalizeActorActionProfile({
    abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
    id: ACTOR_ACTION_PROFILE_ID.SHOOT,
    actionCode: SENTENCE_ACTION_CODE.SHOOT,
    spawnAnchorPolicy: ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE,
    targetPolicy: ACTOR_ACTION_TARGET_POLICY.SUBJECT_DEFAULT,
    targetSnapshotPolicy: ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START,
    activationPolicy: ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK,
    placementPolicy: ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF,
    launchSpeed: 7,
    travelSpeed: 0,
    travelDurationFixedTicks: 0,
    surfaceGap: 0.0625,
    summonLatticeSpacing: 0,
    presentationArcHeight: 0,
    transit: IMMEDIATE_TRANSIT
}, 'R5 shoot actor action profile');

export const R5_THROW_ACTOR_ACTION_PROFILE = normalizeActorActionProfile({
    abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
    id: ACTOR_ACTION_PROFILE_ID.THROW,
    actionCode: SENTENCE_ACTION_CODE.THROW,
    spawnAnchorPolicy: ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE,
    targetPolicy: ACTOR_ACTION_TARGET_POLICY.SUBJECT_DEFAULT,
    targetSnapshotPolicy: ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START,
    activationPolicy: ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING,
    placementPolicy: ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF,
    launchSpeed: 0,
    travelSpeed: 7,
    travelDurationFixedTicks: 30,
    surfaceGap: 0.0625,
    summonLatticeSpacing: 0,
    presentationArcHeight: 1.5,
    transit: AIRBORNE_TRANSIT
}, 'R5 throw actor action profile');

export const R5_EMIT_ACTOR_ACTION_PROFILE = normalizeActorActionProfile({
    abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
    id: ACTOR_ACTION_PROFILE_ID.EMIT,
    actionCode: SENTENCE_ACTION_CODE.EMIT,
    spawnAnchorPolicy: ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE,
    targetPolicy: ACTOR_ACTION_TARGET_POLICY.SUBJECT_DEFAULT,
    targetSnapshotPolicy: ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START,
    activationPolicy: ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK,
    placementPolicy: ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF,
    launchSpeed: 0,
    travelSpeed: 0,
    travelDurationFixedTicks: 0,
    surfaceGap: 0.0625,
    summonLatticeSpacing: 0,
    presentationArcHeight: 0,
    transit: IMMEDIATE_TRANSIT
}, 'R5 emit actor action profile');

export const R5_SUMMON_ACTOR_ACTION_PROFILE = normalizeActorActionProfile({
    abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
    id: ACTOR_ACTION_PROFILE_ID.SUMMON,
    actionCode: SENTENCE_ACTION_CODE.SUMMON,
    spawnAnchorPolicy: ACTOR_ACTION_SPAWN_ANCHOR_POLICY.TARGET_POINT,
    targetPolicy: ACTOR_ACTION_TARGET_POLICY.SUBJECT_DEFAULT,
    targetSnapshotPolicy: ACTOR_ACTION_TARGET_SNAPSHOT_POLICY.CAST_START,
    activationPolicy: ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK,
    placementPolicy: ACTOR_ACTION_PLACEMENT_POLICY.TARGET_LATTICE_ATOMIC_SDF,
    launchSpeed: 0,
    travelSpeed: 0,
    travelDurationFixedTicks: 0,
    surfaceGap: 0,
    summonLatticeSpacing: 1.0625,
    presentationArcHeight: 0,
    transit: IMMEDIATE_TRANSIT
}, 'R5 summon actor action profile');

export const R5_ACTOR_ACTION_PROFILES = Object.freeze([
    R5_SHOOT_ACTOR_ACTION_PROFILE,
    R5_THROW_ACTOR_ACTION_PROFILE,
    R5_EMIT_ACTOR_ACTION_PROFILE,
    R5_SUMMON_ACTOR_ACTION_PROFILE
]);

export const R5_ACTOR_ACTION_PROFILE_BY_ID = Object.freeze(Object.fromEntries(
    R5_ACTOR_ACTION_PROFILES.map((profile) => [profile.id, profile])
));

export const R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE = Object.freeze(
    Object.fromEntries(R5_ACTOR_ACTION_PROFILES.map((profile) => (
        [profile.actionCode, profile]
    )))
);
