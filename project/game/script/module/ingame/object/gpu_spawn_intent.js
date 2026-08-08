import {
    normalizeGpuCircleBodyContactHandler,
    normalizeGpuCircleBodyMetadata
} from '../physics/gpu/gpu_circle_body_abi.js';
import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_DAMAGE_POLICY_ID,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayDamagePolicyId,
    resolveGameplayAllegianceTeam
} from '../contract/gameplay_team_contract.js';

const INVALID_HANDLE_COMPONENT = 0xffffffff;

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한 숫자여야 합니다.`);
    }
    return number;
}

function requireExactIdentityComponent(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number <= 0
        || number >= INVALID_HANDLE_COMPONENT) {
        throw new RangeError(`${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function materializeGpuPlainDataValue(source, label, ancestors, opaqueKeys = null) {
    if (source === null
        || typeof source === 'string'
        || typeof source === 'boolean'
        || typeof source === 'undefined') {
        return source;
    }
    if (typeof source === 'number') {
        if (!Number.isFinite(source)) {
            throw new TypeError(`${label}에는 유한 숫자만 사용할 수 있습니다.`);
        }
        return source;
    }
    if (typeof source !== 'object') {
        throw new TypeError(`${label}에는 함수나 symbol을 사용할 수 없습니다.`);
    }
    if (ancestors.has(source)) {
        throw new TypeError(`${label}에 순환 참조가 있습니다.`);
    }
    ancestors.add(source);
    try {
        const isArray = Array.isArray(source);
        const isTypedArray = ArrayBuffer.isView(source);
        if (isTypedArray && typeof source.length !== 'number') {
            throw new TypeError(`${label}은 typed array여야 합니다.`);
        }
        if (!isArray && !isTypedArray) {
            const prototype = Object.getPrototypeOf(source);
            const isPlainObject = prototype === null
                || Object.getPrototypeOf(prototype) === null;
            if (!isPlainObject) {
                throw new TypeError(`${label}은 plain object여야 합니다.`);
            }
        }

        // Proxy ownKeys/getter drift를 막기 위해 key 집합은 정확히 한 번만 읽고,
        // 각 enumerable string value도 정확히 한 번만 materialize합니다.
        const ownKeys = Reflect.ownKeys(source);
        if (ownKeys.some((key) => typeof key === 'symbol')) {
            throw new TypeError(`${label}에는 symbol을 사용할 수 없습니다.`);
        }
        const result = isArray || isTypedArray
            ? new Array(source.length)
            : Object.create(null);
        for (const key of ownKeys) {
            if ((isArray || isTypedArray) && key === 'length') {
                continue;
            }
            const descriptor = Object.getOwnPropertyDescriptor(source, key);
            if (!descriptor) {
                throw new TypeError(`${label}.${key} descriptor가 materialize 중 변경되었습니다.`);
            }
            if (!descriptor.enumerable) {
                continue;
            }
            const value = Reflect.get(source, key);
            result[key] = opaqueKeys?.has(key)
                ? value
                : materializeGpuPlainDataValue(
                    value,
                    `${label}.${key}`,
                    ancestors
                );
        }
        return Object.freeze(result);
    } finally {
        ancestors.delete(source);
    }
}

/**
 * GPU public ingress의 raw plain-data를 getter/Proxy 재평가 없이 한 번 읽어
 * deeply immutable snapshot으로 만듭니다.
 */
export function materializeGpuPlainDataSnapshot(
    source,
    label = 'gpuPlainData',
    options = {}
) {
    if (typeof label !== 'string' || label.length === 0) {
        throw new TypeError('plain-data snapshot label이 필요합니다.');
    }
    const opaqueKeys = new Set(options.opaqueKeys ?? []);
    for (const key of opaqueKeys) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new TypeError('opaqueKeys에는 비어 있지 않은 문자열만 사용할 수 있습니다.');
        }
    }
    return materializeGpuPlainDataValue(source, label, new Set(), opaqueKeys);
}

function validateOptionalExactIdentityPair(snapshot, prefix) {
    const entityField = `${prefix}EntityId`;
    const incarnationField = `${prefix}Incarnation`;
    const hasEntityId = snapshot[entityField] !== undefined
        && snapshot[entityField] !== null;
    const hasIncarnation = snapshot[incarnationField] !== undefined
        && snapshot[incarnationField] !== null;
    if (hasEntityId !== hasIncarnation) {
        throw new TypeError(`${entityField}/${incarnationField}은 함께 제공해야 합니다.`);
    }
    if (!hasEntityId) {
        return;
    }
    requireExactIdentityComponent(snapshot[entityField], `spawnIntent.${entityField}`);
    requireExactIdentityComponent(
        snapshot[incarnationField],
        `spawnIntent.${incarnationField}`
    );
}

/** 모든 GPU body producer가 공유하는 canonical immutable spawn ingress입니다. */
export function normalizeGpuSpawnIntent(source, options = {}) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU body spawn intent가 필요합니다.');
    }
    const snapshot = materializeGpuPlainDataSnapshot(source, 'spawnIntent');
    if (Object.prototype.hasOwnProperty.call(snapshot, 'entityId')
        || Object.prototype.hasOwnProperty.call(snapshot, 'incarnation')
        || Object.prototype.hasOwnProperty.call(snapshot, 'handle')) {
        throw new TypeError('spawn identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const kindId = requireNonEmptyString(snapshot.kindId, 'spawnIntent.kindId');
    const legacyEnemyDefinitionId = snapshot.enemyDefinitionId;
    const definitionId = requireNonEmptyString(
        snapshot.definitionId ?? legacyEnemyDefinitionId,
        'spawnIntent.definitionId'
    );
    if (snapshot.definitionId !== undefined
        && legacyEnemyDefinitionId !== undefined
        && snapshot.definitionId !== legacyEnemyDefinitionId) {
        throw new RangeError(
            'spawnIntent.definitionId와 enemyDefinitionId alias가 일치해야 합니다.'
        );
    }

    const metadata = normalizeGpuCircleBodyMetadata(snapshot, {
        requireNonZeroLayers: true
    });
    const allegiancePolicy = normalizeGameplayAllegiancePolicy(
        snapshot.allegiancePolicy
            ?? GAMEPLAY_ALLEGIANCE_POLICY.EXPLICIT_OVERRIDE,
        'spawnIntent.allegiancePolicy'
    );
    const teamId = resolveGameplayAllegianceTeam({
        policy: allegiancePolicy,
        teamId: snapshot.teamId,
        subjectTeamId: options.subjectTeamId
    });
    const damagePolicyId = normalizeGameplayDamagePolicyId(
        snapshot.damagePolicyId
            ?? GAMEPLAY_DAMAGE_POLICY_ID.DEFAULT_TEAM_MATRIX,
        'spawnIntent.damagePolicyId'
    );
    validateOptionalExactIdentityPair(snapshot, 'owner');
    validateOptionalExactIdentityPair(snapshot, 'source');
    validateOptionalExactIdentityPair(snapshot, 'target');
    const contactHandler = normalizeGpuCircleBodyContactHandler(snapshot);
    if (snapshot.spawnSequence !== undefined && snapshot.spawnSequence !== null) {
        requireNonNegativeSafeInteger(snapshot.spawnSequence, 'spawnIntent.spawnSequence');
    }
    if (kindId === 'enemy') {
        requireNonEmptyString(snapshot.gateId, 'spawnIntent.gateId');
        requireNonEmptyString(snapshot.pathId, 'spawnIntent.pathId');
        requireNonNegativeSafeInteger(snapshot.waypointIndex, 'spawnIntent.waypointIndex');
        requirePositiveFinite(snapshot.flowSpeed, 'spawnIntent.flowSpeed');
    }
    const {
        layerMask: _legacyLayerMask,
        sensorMask: _legacySensorMask,
        ...canonicalSnapshot
    } = snapshot;
    return Object.freeze({
        ...canonicalSnapshot,
        definitionId,
        ...(kindId === 'enemy' ? { enemyDefinitionId: definitionId } : {}),
        teamId,
        damagePolicyId,
        allegiancePolicy,
        ...metadata,
        contactHandler
    });
}

/** Registry가 GPU body identity와 함께 보존할 CPU domain metadata를 만듭니다. */
export function createGpuRegistryMetadata(intent) {
    const common = {
        definitionId: intent.definitionId,
        teamId: intent.teamId,
        damagePolicyId: intent.damagePolicyId,
        allegiancePolicy: intent.allegiancePolicy,
        ownerEntityId: intent.ownerEntityId,
        ownerIncarnation: intent.ownerIncarnation,
        sourceEntityId: intent.sourceEntityId,
        sourceIncarnation: intent.sourceIncarnation,
        targetEntityId: intent.targetEntityId,
        targetIncarnation: intent.targetIncarnation,
        producerId: intent.producerId,
        sourceAbilityId: intent.sourceAbilityId,
        targetPolicyId: intent.targetPolicyId
    };
    if (intent.kindId === 'enemy') {
        return {
            ...common,
            enemyDefinitionId: intent.enemyDefinitionId,
            gateId: intent.gateId,
            pathId: intent.pathId,
            initialWaypointIndex: intent.waypointIndex,
            spawnSequence: intent.spawnSequence,
            waveId: intent.waveId,
            policyId: intent.policyId
        };
    }
    return {
        ...common,
        spawnSequence: intent.spawnSequence
    };
}
