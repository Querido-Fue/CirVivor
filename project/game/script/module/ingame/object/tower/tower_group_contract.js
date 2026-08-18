const GPU_RESERVED_U32_SENTINEL = 0xffffffff;

export const TOWER_SHARE_SCALE = 1_000_000_000;
export const PRIMARY_TOWER_LOGICAL_ID = 'the-tower';
export const PRIMARY_TOWER_LOGICAL_ORDINAL = 1;

export const TOWER_GROUP_RECORD_STATE = Object.freeze({
    PENDING: 'PENDING',
    LIVING: 'LIVING',
    DEAD: 'DEAD'
});

export const TOWER_CREATION_RESULT = Object.freeze({
    COMMITTED: 'COMMITTED',
    REJECTED_CAPACITY: 'REJECTED_CAPACITY',
    REJECTED_SOURCE_CHANGED: 'REJECTED_SOURCE_CHANGED',
    REJECTED_ZERO_SHARE: 'REJECTED_ZERO_SHARE',
    REJECTED_NON_VIABLE_HEALTH: 'REJECTED_NON_VIABLE_HEALTH',
    REJECTED_NON_VIABLE_CURRENT_HP: 'REJECTED_NON_VIABLE_CURRENT_HP',
    REJECTED_DESCRIPTOR: 'REJECTED_DESCRIPTOR',
    PROTOCOL_FAILURE: 'PROTOCOL_FAILURE'
});

export const TOWER_CREATION_REASON = Object.freeze({
    ZERO_LIVING_SHARE_NON_VIABLE: 'ZERO_LIVING_SHARE_NON_VIABLE',
    NON_VIABLE_DERIVED_HEALTH: 'NON_VIABLE_DERIVED_HEALTH',
    NON_VIABLE_DERIVED_CURRENT_HP: 'NON_VIABLE_DERIVED_CURRENT_HP',
    CREATION_TRANSACTION_PENDING: 'CREATION_TRANSACTION_PENDING',
    DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
    TRANSACTION_FINGERPRINT_MISMATCH: 'TRANSACTION_FINGERPRINT_MISMATCH',
    SOURCE_STATE_CHANGED: 'SOURCE_STATE_CHANGED',
    DESCRIPTOR_INVALID: 'DESCRIPTOR_INVALID'
});

export const TOWER_COMBAT_FACT_TYPE = Object.freeze({
    DAMAGE_APPLIED: 'TowerDamageApplied',
    DIED: 'TowerDied',
    SHARE_LOST: 'TowerShareLost',
    NO_LIVING_TOWERS: 'NoLivingTowers'
});

export function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0
        || number >= GPU_RESERVED_U32_SENTINEL) {
        throw new RangeError(
            `${label}은 reserved sentinel보다 작은 양의 정수여야 합니다.`
        );
    }
    return number;
}

export function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

export function requireUint32Compatible(value, label) {
    const number = requireNonNegativeSafeInteger(value, label);
    if (number > GPU_RESERVED_U32_SENTINEL) {
        throw new RangeError(`${label}은 uint32 범위여야 합니다.`);
    }
    return number;
}

export function requireShareUnits(value, label = 'shareUnits') {
    const number = requireUint32Compatible(value, label);
    if (number > TOWER_SHARE_SCALE) {
        throw new RangeError(`${label}은 Tower Share scale 이하여야 합니다.`);
    }
    return number;
}

export function requireLogicalTowerId(value, label = 'logicalTowerId') {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

export function requireTransactionId(value, label = 'transactionId') {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

export function requireTowerGroupRecordState(
    value,
    label = 'towerRecord.state'
) {
    if (!Object.values(TOWER_GROUP_RECORD_STATE).includes(value)) {
        throw new TypeError(`${label}가 유효한 Tower record state가 아닙니다.`);
    }
    return value;
}

export function createTowerLogicalId(logicalTowerOrdinal) {
    const ordinal = requirePositiveSafeInteger(
        logicalTowerOrdinal,
        'logicalTowerOrdinal'
    );
    return ordinal === PRIMARY_TOWER_LOGICAL_ORDINAL
        ? PRIMARY_TOWER_LOGICAL_ID
        : `${PRIMARY_TOWER_LOGICAL_ID}:${ordinal}`;
}

export function freezeExactTowerHandle(source, label = 'towerHandle') {
    return Object.freeze({
        entityId: requirePositiveSafeInteger(
            source?.entityId,
            `${label}.entityId`
        ),
        incarnation: requirePositiveSafeInteger(
            source?.incarnation,
            `${label}.incarnation`
        )
    });
}

export function sameExactTowerHandle(left, right) {
    return left?.entityId === right?.entityId
        && left?.incarnation === right?.incarnation;
}

export function normalizeTowerGpuProtocol(source, label = 'towerProtocol') {
    return Object.freeze({
        sessionGeneration: requirePositiveSafeInteger(
            source?.sessionGeneration,
            `${label}.sessionGeneration`
        ),
        deviceGeneration: requireNonNegativeSafeInteger(
            source?.deviceGeneration,
            `${label}.deviceGeneration`
        ),
        authoritativeEpoch: requireNonNegativeSafeInteger(
            source?.authoritativeEpoch,
            `${label}.authoritativeEpoch`
        )
    });
}

export function sameTowerGpuProtocol(left, right) {
    return left?.sessionGeneration === right?.sessionGeneration
        && left?.deviceGeneration === right?.deviceGeneration
        && left?.authoritativeEpoch === right?.authoritativeEpoch;
}

function cloneReadonlyPlainValue(source, label, ancestors) {
    if (source === null) return null;
    const type = typeof source;
    if (type === 'string' || type === 'boolean') return source;
    if (type === 'number') {
        if (!Number.isFinite(source)) {
            throw new TypeError(`${label} 숫자는 유한해야 합니다.`);
        }
        return source;
    }
    if (type !== 'object') {
        throw new TypeError(`${label}은 JSON-compatible plain data여야 합니다.`);
    }
    if (ancestors.has(source)) {
        throw new TypeError(`${label}은 순환 참조를 포함할 수 없습니다.`);
    }
    ancestors.add(source);
    try {
        if (Array.isArray(source)) {
            const descriptors = Object.getOwnPropertyDescriptors(source);
            const symbols = Object.getOwnPropertySymbols(source);
            const indexKeys = Object.keys(descriptors).filter((key) => (
                key !== 'length'
            ));
            const invalidKey = indexKeys.find((key) => {
                const index = Number(key);
                return !Number.isSafeInteger(index)
                    || index < 0
                    || index >= source.length
                    || String(index) !== key;
            });
            if (symbols.length > 0 || invalidKey !== undefined
                || indexKeys.length !== source.length) {
                throw new TypeError(
                    `${label} 배열은 hole/추가 속성을 포함할 수 없습니다.`
                );
            }
            const result = new Array(source.length);
            for (let index = 0; index < source.length; index++) {
                const descriptor = descriptors[index];
                if (!descriptor?.enumerable || !('value' in descriptor)) {
                    throw new TypeError(
                        `${label}[${index}]는 enumerable data여야 합니다.`
                    );
                }
                result[index] = cloneReadonlyPlainValue(
                    descriptor.value,
                    `${label}[${index}]`,
                    ancestors
                );
            }
            return Object.freeze(result);
        }
        const prototype = Object.getPrototypeOf(source);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`${label}은 plain object여야 합니다.`);
        }
        if (Object.getOwnPropertySymbols(source).length > 0) {
            throw new TypeError(`${label}에 Symbol 속성을 둘 수 없습니다.`);
        }
        const descriptors = Object.getOwnPropertyDescriptors(source);
        const result = {};
        for (const key of Object.keys(descriptors).sort()) {
            const descriptor = descriptors[key];
            if (!descriptor.enumerable || !('value' in descriptor)) {
                throw new TypeError(`${label}.${key}는 enumerable data여야 합니다.`);
            }
            result[key] = cloneReadonlyPlainValue(
                descriptor.value,
                `${label}.${key}`,
                ancestors
            );
        }
        return Object.freeze(result);
    } finally {
        ancestors.delete(source);
    }
}

export function freezeTowerRecoverySpawnDescriptor(
    source,
    label = 'recoverySpawnDescriptor'
) {
    if (source === undefined || source === null) return null;
    return cloneReadonlyPlainValue(source, label, new Set());
}
