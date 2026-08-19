import { SENTENCE_ACTION_CODE } from './word_sentence_contract.js';

export const ACTOR_ACTION_PROFILE_ABI_VERSION = 2;

export const ACTOR_ACTION_PROFILE_ID = Object.freeze({
    SHOOT: 'actor-action.shoot.v1',
    THROW: 'actor-action.throw.v1',
    EMIT: 'actor-action.emit.v1',
    SUMMON: 'actor-action.summon.v1'
});

export const ACTOR_ACTION_SPAWN_ANCHOR_POLICY = Object.freeze({
    SOURCE_SURFACE: 'SOURCE_SURFACE',
    TARGET_POINT: 'TARGET_POINT'
});

export const ACTOR_ACTION_TARGET_POLICY = Object.freeze({
    SUBJECT_DEFAULT: 'SUBJECT_DEFAULT'
});

export const ACTOR_ACTION_TARGET_SNAPSHOT_POLICY = Object.freeze({
    CAST_START: 'CAST_START'
});

export const ACTOR_ACTION_ACTIVATION_POLICY = Object.freeze({
    NEXT_FIXED_TICK: 'NEXT_FIXED_TICK',
    ON_LANDING: 'ON_LANDING'
});

export const ACTOR_ACTION_PLACEMENT_POLICY = Object.freeze({
    SOURCE_SURFACE_ATOMIC_SDF: 'SOURCE_SURFACE_ATOMIC_SDF',
    SOURCE_AND_LANDING_ATOMIC_SDF: 'SOURCE_AND_LANDING_ATOMIC_SDF',
    TARGET_LATTICE_ATOMIC_SDF: 'TARGET_LATTICE_ATOMIC_SDF'
});

export const ACTOR_ACTION_TRANSIT_POLICY = Object.freeze({
    NONE: 'NONE',
    AIRBORNE_GROUND_PATH: 'AIRBORNE_GROUND_PATH'
});

const ACTION_CODES = new Set(Object.values(SENTENCE_ACTION_CODE));
const PROFILE_IDS = new Set(Object.values(ACTOR_ACTION_PROFILE_ID));
const ACTION_CODE_BY_PROFILE_ID = new Map([
    [ACTOR_ACTION_PROFILE_ID.SHOOT, SENTENCE_ACTION_CODE.SHOOT],
    [ACTOR_ACTION_PROFILE_ID.THROW, SENTENCE_ACTION_CODE.THROW],
    [ACTOR_ACTION_PROFILE_ID.EMIT, SENTENCE_ACTION_CODE.EMIT],
    [ACTOR_ACTION_PROFILE_ID.SUMMON, SENTENCE_ACTION_CODE.SUMMON]
]);
const SPAWN_ANCHOR_POLICIES = new Set(
    Object.values(ACTOR_ACTION_SPAWN_ANCHOR_POLICY)
);
const TARGET_POLICIES = new Set(Object.values(ACTOR_ACTION_TARGET_POLICY));
const TARGET_SNAPSHOT_POLICIES = new Set(
    Object.values(ACTOR_ACTION_TARGET_SNAPSHOT_POLICY)
);
const ACTIVATION_POLICIES = new Set(
    Object.values(ACTOR_ACTION_ACTIVATION_POLICY)
);
const PLACEMENT_POLICIES = new Set(
    Object.values(ACTOR_ACTION_PLACEMENT_POLICY)
);
const TRANSIT_POLICIES = new Set(Object.values(ACTOR_ACTION_TRANSIT_POLICY));
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const LITTLE_ENDIAN = true;

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireKnownKeys(value, keys, label) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
    }
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) {
            throw new RangeError(`${label}.${key}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || typeof descriptor.get === 'function'
            || typeof descriptor.set === 'function') {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
    }
}

function requireEnum(value, values, label) {
    if (typeof value !== 'string' || !values.has(value)) {
        throw new RangeError(`${label}가 알려지지 않았습니다.`);
    }
    return value;
}

function requireNonNegativeFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 finite float32여야 합니다.`);
    }
    return number === 0 ? 0 : number;
}

function requirePositiveFloat32(value, label) {
    const number = requireNonNegativeFloat32(value, label);
    if (!(number > 0)) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return number;
}

function requireNonNegativeUint32(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return number >>> 0;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function hashWord(hash, value) {
    return Math.imul((hash ^ (Number(value) >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function hashString(hash, value) {
    let next = hashWord(hash, value.length);
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        next = hashWord(next, code & 0xff);
        next = hashWord(next, code >>> 8);
    }
    return next;
}

function float32Word(value) {
    const bytes = new ArrayBuffer(4);
    const view = new DataView(bytes);
    view.setFloat32(0, value, LITTLE_ENDIAN);
    return view.getUint32(0, LITTLE_ENDIAN);
}

function computeActorActionProfileFingerprint(profile) {
    let hash = hashString(FNV_OFFSET_BASIS, 'actor-action-profile');
    for (const value of [
        profile.abiVersion,
        profile.actionCode,
        float32Word(profile.launchSpeed),
        float32Word(profile.travelSpeed),
        profile.travelDurationFixedTicks,
        float32Word(profile.surfaceGap),
        float32Word(profile.summonLatticeSpacing),
        float32Word(profile.presentationArcHeight),
        profile.transit.suspendControl ? 1 : 0,
        profile.transit.suspendSubjectSelection ? 1 : 0,
        profile.transit.suspendTargetAcceptance ? 1 : 0,
        profile.transit.suppressContact ? 1 : 0
    ]) {
        hash = hashWord(hash, value);
    }
    for (const value of [
        profile.id,
        profile.spawnAnchorPolicy,
        profile.targetPolicy,
        profile.targetSnapshotPolicy,
        profile.activationPolicy,
        profile.placementPolicy,
        profile.transit.policy
    ]) {
        hash = hashString(hash, value);
    }
    return hash === 0 || hash === 0xffffffff
        ? FNV_OFFSET_BASIS
        : hash >>> 0;
}

function requireProfileContract(condition, label, actionName) {
    if (!condition) {
        throw new RangeError(`${label} ${actionName} profile 계약이 올바르지 않습니다.`);
    }
}

function normalizeTransit(value, label) {
    requireRecord(value, label);
    requireKnownKeys(
        value,
        new Set([
            'policy',
            'suspendControl',
            'suspendSubjectSelection',
            'suspendTargetAcceptance',
            'suppressContact'
        ]),
        label
    );
    return Object.freeze({
        policy: requireEnum(value.policy, TRANSIT_POLICIES, `${label}.policy`),
        suspendControl: requireBoolean(
            value.suspendControl,
            `${label}.suspendControl`
        ),
        suspendSubjectSelection: requireBoolean(
            value.suspendSubjectSelection,
            `${label}.suspendSubjectSelection`
        ),
        suspendTargetAcceptance: requireBoolean(
            value.suspendTargetAcceptance,
            `${label}.suspendTargetAcceptance`
        ),
        suppressContact: requireBoolean(
            value.suppressContact,
            `${label}.suppressContact`
        )
    });
}

/** Data-owned Shoot/Throw/Emit/Summon actor-action profile을 고정합니다. */
export function normalizeActorActionProfile(
    source,
    label = 'actorActionProfile'
) {
    requireRecord(source, label);
    requireKnownKeys(
        source,
        new Set([
            'abiVersion',
            'id',
            'actionCode',
            'spawnAnchorPolicy',
            'targetPolicy',
            'targetSnapshotPolicy',
            'activationPolicy',
            'placementPolicy',
            'launchSpeed',
            'travelSpeed',
            'travelDurationFixedTicks',
            'surfaceGap',
            'summonLatticeSpacing',
            'presentationArcHeight',
            'transit',
            'actorActionProfileFingerprint'
        ]),
        label
    );
    if (source.abiVersion !== ACTOR_ACTION_PROFILE_ABI_VERSION) {
        throw new RangeError(`${label}.abiVersion이 일치하지 않습니다.`);
    }
    const id = requireEnum(source.id, PROFILE_IDS, `${label}.id`);
    const actionCode = Number(source.actionCode);
    if (!Number.isSafeInteger(actionCode) || !ACTION_CODES.has(actionCode)) {
        throw new RangeError(`${label}.actionCode가 알려지지 않았습니다.`);
    }
    if (ACTION_CODE_BY_PROFILE_ID.get(id) !== actionCode) {
        throw new RangeError(`${label}.id/actionCode 조합이 일치하지 않습니다.`);
    }
    const transit = normalizeTransit(source.transit, `${label}.transit`);
    const travelDurationFixedTicks = requireNonNegativeUint32(
        source.travelDurationFixedTicks,
        `${label}.travelDurationFixedTicks`
    );
    const activationPolicy = requireEnum(
        source.activationPolicy,
        ACTIVATION_POLICIES,
        `${label}.activationPolicy`
    );
    if (transit.policy === ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH) {
        if (travelDurationFixedTicks === 0
            || activationPolicy !== ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING
            || !transit.suspendControl
            || !transit.suspendSubjectSelection
            || !transit.suspendTargetAcceptance
            || !transit.suppressContact) {
            throw new RangeError(`${label} airborne transit 계약이 올바르지 않습니다.`);
        }
    } else if (travelDurationFixedTicks !== 0
        || activationPolicy !== ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK
        || transit.suspendControl
        || transit.suspendSubjectSelection
        || transit.suspendTargetAcceptance
        || transit.suppressContact) {
        throw new RangeError(`${label} immediate actor 계약이 올바르지 않습니다.`);
    }

    const profile = {
        abiVersion: ACTOR_ACTION_PROFILE_ABI_VERSION,
        id,
        actionCode,
        spawnAnchorPolicy: requireEnum(
            source.spawnAnchorPolicy,
            SPAWN_ANCHOR_POLICIES,
            `${label}.spawnAnchorPolicy`
        ),
        targetPolicy: requireEnum(
            source.targetPolicy,
            TARGET_POLICIES,
            `${label}.targetPolicy`
        ),
        targetSnapshotPolicy: requireEnum(
            source.targetSnapshotPolicy,
            TARGET_SNAPSHOT_POLICIES,
            `${label}.targetSnapshotPolicy`
        ),
        activationPolicy,
        placementPolicy: requireEnum(
            source.placementPolicy,
            PLACEMENT_POLICIES,
            `${label}.placementPolicy`
        ),
        launchSpeed: requireNonNegativeFloat32(
            source.launchSpeed,
            `${label}.launchSpeed`
        ),
        travelSpeed: requireNonNegativeFloat32(
            source.travelSpeed,
            `${label}.travelSpeed`
        ),
        travelDurationFixedTicks,
        surfaceGap: requireNonNegativeFloat32(
            source.surfaceGap,
            `${label}.surfaceGap`
        ),
        summonLatticeSpacing: requireNonNegativeFloat32(
            source.summonLatticeSpacing,
            `${label}.summonLatticeSpacing`
        ),
        presentationArcHeight: requireNonNegativeFloat32(
            source.presentationArcHeight,
            `${label}.presentationArcHeight`
        ),
        transit
    };

    const immediateTransit = transit.policy === ACTOR_ACTION_TRANSIT_POLICY.NONE
        && !transit.suspendControl
        && !transit.suspendSubjectSelection
        && !transit.suspendTargetAcceptance
        && !transit.suppressContact;
    if (actionCode === SENTENCE_ACTION_CODE.SHOOT) {
        requireProfileContract(
            profile.spawnAnchorPolicy
                === ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE
                && profile.activationPolicy
                    === ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK
                && profile.placementPolicy
                    === ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF
                && requirePositiveFloat32(profile.launchSpeed,
                    `${label}.launchSpeed`) > 0
                && profile.travelSpeed === 0
                && profile.travelDurationFixedTicks === 0
                && requirePositiveFloat32(profile.surfaceGap,
                    `${label}.surfaceGap`) > 0
                && profile.summonLatticeSpacing === 0
                && profile.presentationArcHeight === 0
                && immediateTransit,
            label,
            'Shoot'
        );
    } else if (actionCode === SENTENCE_ACTION_CODE.THROW) {
        requireProfileContract(
            profile.spawnAnchorPolicy
                === ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE
                && profile.activationPolicy
                    === ACTOR_ACTION_ACTIVATION_POLICY.ON_LANDING
                && profile.placementPolicy
                    === ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_AND_LANDING_ATOMIC_SDF
                && profile.launchSpeed === 0
                && profile.travelSpeed === 0
                && profile.travelDurationFixedTicks > 0
                && requirePositiveFloat32(profile.surfaceGap,
                    `${label}.surfaceGap`) > 0
                && profile.summonLatticeSpacing === 0
                && requirePositiveFloat32(profile.presentationArcHeight,
                    `${label}.presentationArcHeight`) > 0
                && transit.policy
                    === ACTOR_ACTION_TRANSIT_POLICY.AIRBORNE_GROUND_PATH
                && transit.suspendControl
                && transit.suspendSubjectSelection
                && transit.suspendTargetAcceptance
                && transit.suppressContact,
            label,
            'Throw'
        );
    } else if (actionCode === SENTENCE_ACTION_CODE.EMIT) {
        requireProfileContract(
            profile.spawnAnchorPolicy
                === ACTOR_ACTION_SPAWN_ANCHOR_POLICY.SOURCE_SURFACE
                && profile.activationPolicy
                    === ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK
                && profile.placementPolicy
                    === ACTOR_ACTION_PLACEMENT_POLICY.SOURCE_SURFACE_ATOMIC_SDF
                && profile.launchSpeed === 0
                && profile.travelSpeed === 0
                && profile.travelDurationFixedTicks === 0
                && requirePositiveFloat32(profile.surfaceGap,
                    `${label}.surfaceGap`) > 0
                && profile.summonLatticeSpacing === 0
                && profile.presentationArcHeight === 0
                && immediateTransit,
            label,
            'Emit'
        );
    } else if (actionCode === SENTENCE_ACTION_CODE.SUMMON) {
        requireProfileContract(
            profile.spawnAnchorPolicy
                === ACTOR_ACTION_SPAWN_ANCHOR_POLICY.TARGET_POINT
                && profile.activationPolicy
                    === ACTOR_ACTION_ACTIVATION_POLICY.NEXT_FIXED_TICK
                && profile.placementPolicy
                    === ACTOR_ACTION_PLACEMENT_POLICY.TARGET_LATTICE_ATOMIC_SDF
                && profile.launchSpeed === 0
                && profile.travelSpeed === 0
                && profile.travelDurationFixedTicks === 0
                && profile.surfaceGap === 0
                && requirePositiveFloat32(profile.summonLatticeSpacing,
                    `${label}.summonLatticeSpacing`) > 0
                && profile.presentationArcHeight === 0
                && immediateTransit,
            label,
            'Summon'
        );
    }

    const actorActionProfileFingerprint
        = computeActorActionProfileFingerprint(profile);
    if (source.actorActionProfileFingerprint !== undefined) {
        const declared = requireNonNegativeUint32(
            source.actorActionProfileFingerprint,
            `${label}.actorActionProfileFingerprint`
        );
        if (declared === 0 || declared !== actorActionProfileFingerprint) {
            throw new RangeError(
                `${label}.actorActionProfileFingerprint가 semantic profile과 다릅니다.`
            );
        }
    }
    return Object.freeze({
        ...profile,
        actorActionProfileFingerprint
    });
}

/** 모든 semantic profile field를 포함하는 canonical uint32 identity입니다. */
export function actorActionProfileFingerprint(
    source,
    label = 'actorActionProfile'
) {
    return normalizeActorActionProfile(source, label)
        .actorActionProfileFingerprint;
}
