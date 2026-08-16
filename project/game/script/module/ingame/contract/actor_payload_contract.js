import {
    ABILITY_CREATION_ORIGIN_CODE,
    abilityDefinitionCode
} from './ability_execution_contract.js';
import {
    ACTOR_PAYLOAD_CODE,
    GAMEPLAY_NOUN_MASK,
    SENTENCE_ACTION_CODE,
    WORD_RUNTIME_SUPPORT
} from './word_sentence_contract.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID
} from './gameplay_team_contract.js';
import {
    BASIC_CIRCLE_ENEMY_DATA
} from 'data/object/enemy/basic_circle_enemy_data.js';

export const ACTOR_PAYLOAD_DEFINITION_ABI_VERSION = 1;
export const ACTOR_PAYLOAD_MATERIALIZER_ABI_VERSION = 1;

export const ACTOR_PAYLOAD_DEFINITION_ID = Object.freeze({
    R3_BASIC_CIRCLE_ENEMY: 'actor-payload.r3.basic-circle-enemy'
});

export const ACTOR_PAYLOAD_ROUTE_POLICY = Object.freeze({
    DEFAULT_PLAYER_CREATED_HOSTILE_ROUTE:
        'route.player-created-hostile.default.v1',
    INHERIT_SOURCE_ENEMY_ROUTE: 'route.inherit-source-enemy.v1'
});

export const ACTOR_PAYLOAD_TARGET_POLICY = Object.freeze({
    SHARED_AIM_POINT: 'target.shared-aim-point.v1',
    NEAREST_TOWER_THEN_CORE_THEN_FACING:
        'target.nearest-tower-then-core-then-facing.v1'
});

export const ACTOR_PAYLOAD_MATERIALIZATION_STATUS = Object.freeze({
    PENDING: 0,
    COMPLETE: 1,
    SDF_REJECTED: 2,
    CAPACITY_REJECTED: 3,
    PROTOCOL_REJECTED: 4,
    CANCELLED: 5
});

export const ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG = Object.freeze({
    NONE: 0,
    BODY_ABI: 1 << 0,
    SNAPSHOT_ABI: 1 << 1,
    LEASE_ABI: 1 << 2,
    DESTINATION_IDENTITY: 1 << 3,
    SOURCE_RECORD: 1 << 4,
    SDF_PLACEMENT: 1 << 5,
    GENERATION: 1 << 6,
    STALE_PROTOCOL: 1 << 7
});

const MATERIALIZATION_STATUSES = new Set(
    Object.values(ACTOR_PAYLOAD_MATERIALIZATION_STATUS)
);
const ERROR_FLAGS = Object.values(
    ACTOR_PAYLOAD_MATERIALIZATION_ERROR_FLAG
).reduce((mask, value) => mask | value, 0) >>> 0;

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, positive = false) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number > 0xffffffff) {
        throw new RangeError(`${label}은 uint32 범위여야 합니다.`);
    }
    return number >>> 0;
}

function requirePositiveFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number) || !(number > 0)) {
        throw new RangeError(`${label}은 양의 finite float32여야 합니다.`);
    }
    return number;
}

/**
 * R3 Enemy Entity Word가 물질화하는 ordinary C actor의 data-owned port입니다.
 * Tower payload는 후속 R5 범위이므로 이 contract에서 생성하지 않습니다.
 */
export function createR3EnemyActorPayloadDefinition(overrides = {}) {
    requireRecord(overrides, 'actor payload overrides');
    const definitionId = requireNonEmptyString(
        overrides.definitionId ?? BASIC_CIRCLE_ENEMY_DATA.id,
        'actorPayload.definitionId'
    );
    if (definitionId !== BASIC_CIRCLE_ENEMY_DATA.id) {
        throw new RangeError('R3 Enemy payload는 basic_circle_01만 지원합니다.');
    }
    return Object.freeze({
        abiVersion: ACTOR_PAYLOAD_DEFINITION_ABI_VERSION,
        id: ACTOR_PAYLOAD_DEFINITION_ID.R3_BASIC_CIRCLE_ENEMY,
        runtimeSupport: WORD_RUNTIME_SUPPORT.R3,
        actionCode: SENTENCE_ACTION_CODE.SHOOT,
        payloadCode: ACTOR_PAYLOAD_CODE.ENEMY,
        kindId: 'enemy',
        definitionId,
        definitionCode: abilityDefinitionCode(definitionId),
        nounMask: GAMEPLAY_NOUN_MASK.ENEMY,
        teamId: GAMEPLAY_TEAM_ID.HOSTILE,
        allegiancePolicy: GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE,
        creationOrigin: 'PLAYER_SENTENCE',
        creationOriginCode: ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD,
        lifetimePolicy: 'IMMORTAL_ACTOR',
        bountyPolicy: 'DEFINITION_RESOLVED_ORDINARY_ENEMY',
        siegeWeightPolicy: 'DEFINITION_RESOLVED_ORDINARY_ENEMY',
        projectile: false,
        ordinaryEnemy: true,
        rewardEligible: true,
        countsTowardHostile: true,
        countsTowardSiege: true,
        towerRoutePolicy:
            ACTOR_PAYLOAD_ROUTE_POLICY.DEFAULT_PLAYER_CREATED_HOSTILE_ROUTE,
        enemyRoutePolicy:
            ACTOR_PAYLOAD_ROUTE_POLICY.INHERIT_SOURCE_ENEMY_ROUTE,
        towerTargetPolicy: ACTOR_PAYLOAD_TARGET_POLICY.SHARED_AIM_POINT,
        enemyTargetPolicy:
            ACTOR_PAYLOAD_TARGET_POLICY.NEAREST_TOWER_THEN_CORE_THEN_FACING,
        launchSpeed: requirePositiveFloat32(
            overrides.launchSpeed ?? 7,
            'actorPayload.launchSpeed'
        ),
        surfaceGap: requirePositiveFloat32(
            overrides.surfaceGap ?? 0.0625,
            'actorPayload.surfaceGap'
        ),
        visibleExecutionOffset: 1,
        aiActivationFixedTickOffset: 1
    });
}

export const R3_ENEMY_ACTOR_PAYLOAD_DEFINITION
    = createR3EnemyActorPayloadDefinition();

/** IActorPayloadDefinition의 최소 runtime shape을 fail-closed 검증합니다. */
export function normalizeActorPayloadDefinition(source) {
    requireRecord(source, 'actorPayloadDefinition');
    if (source.abiVersion !== ACTOR_PAYLOAD_DEFINITION_ABI_VERSION
        || source.id !== ACTOR_PAYLOAD_DEFINITION_ID.R3_BASIC_CIRCLE_ENEMY
        || source.runtimeSupport !== WORD_RUNTIME_SUPPORT.R3
        || source.actionCode !== SENTENCE_ACTION_CODE.SHOOT
        || source.payloadCode !== ACTOR_PAYLOAD_CODE.ENEMY
        || source.kindId !== 'enemy'
        || source.definitionId !== BASIC_CIRCLE_ENEMY_DATA.id
        || source.nounMask !== GAMEPLAY_NOUN_MASK.ENEMY
        || source.teamId !== GAMEPLAY_TEAM_ID.HOSTILE
        || source.allegiancePolicy
            !== GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
        || source.creationOriginCode
            !== ABILITY_CREATION_ORIGIN_CODE.SENTENCE_PAYLOAD
        || source.bountyPolicy !== 'DEFINITION_RESOLVED_ORDINARY_ENEMY'
        || source.siegeWeightPolicy !== 'DEFINITION_RESOLVED_ORDINARY_ENEMY'
        || source.projectile !== false
        || source.ordinaryEnemy !== true
        || source.visibleExecutionOffset !== 1
        || source.aiActivationFixedTickOffset !== 1) {
        throw new RangeError('R3 actor payload definition contract가 일치하지 않습니다.');
    }
    requireUint32(source.definitionCode, 'definitionCode', true);
    requirePositiveFloat32(source.launchSpeed, 'launchSpeed');
    requirePositiveFloat32(source.surfaceGap, 'surfaceGap');
    return source;
}

export function isKnownActorPayloadMaterializationStatus(value) {
    return Number.isSafeInteger(Number(value))
        && MATERIALIZATION_STATUSES.has(Number(value));
}

export function hasOnlyKnownActorPayloadErrorFlags(value) {
    const flags = requireUint32(value, 'actorPayload.errorFlags');
    return (flags & ~ERROR_FLAGS) === 0;
}
