import {
    normalizeGpuCircleBodyContactHandler,
    normalizeGpuCircleBodyMetadata
} from '../physics/gpu/gpu_circle_body_abi.js';

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

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function cloneAndFreezeValue(source, label, ancestors = new Set()) {
    if (source === null
        || typeof source === 'string'
        || typeof source === 'boolean'
        || typeof source === 'undefined') {
        return source ?? null;
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
    let result;
    if (Array.isArray(source) || ArrayBuffer.isView(source)) {
        result = Array.from(source, (value, index) => (
            cloneAndFreezeValue(value, `${label}[${index}]`, ancestors)
        ));
    } else {
        const prototype = Object.getPrototypeOf(source);
        const isPlainObject = prototype === null
            || Object.getPrototypeOf(prototype) === null;
        if (!isPlainObject) {
            ancestors.delete(source);
            throw new TypeError(`${label}은 plain object여야 합니다.`);
        }
        result = {};
        for (const [key, value] of Object.entries(source)) {
            result[key] = cloneAndFreezeValue(value, `${label}.${key}`, ancestors);
        }
    }
    ancestors.delete(source);
    return Object.freeze(result);
}

/** 모든 GPU body producer가 공유하는 canonical immutable spawn ingress입니다. */
export function normalizeGpuSpawnIntent(source) {
    if (!source || typeof source !== 'object') {
        throw new TypeError('GPU body spawn intent가 필요합니다.');
    }
    if (Object.prototype.hasOwnProperty.call(source, 'entityId')
        || Object.prototype.hasOwnProperty.call(source, 'incarnation')
        || Object.prototype.hasOwnProperty.call(source, 'handle')) {
        throw new TypeError('spawn identity는 WorldRegistry만 발급할 수 있습니다.');
    }
    const snapshot = cloneAndFreezeValue(source, 'spawnIntent');
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
        ...metadata,
        contactHandler
    });
}

/** Registry가 GPU body identity와 함께 보존할 CPU domain metadata를 만듭니다. */
export function createGpuRegistryMetadata(intent) {
    if (intent.kindId === 'enemy') {
        return {
            definitionId: intent.definitionId,
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
        definitionId: intent.definitionId,
        spawnSequence: intent.spawnSequence,
        sourceEntityId: intent.sourceEntityId,
        sourceIncarnation: intent.sourceIncarnation,
        producerId: intent.producerId,
        sourceAbilityId: intent.sourceAbilityId
    };
}
