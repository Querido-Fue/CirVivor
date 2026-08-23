import {
    normalizeTowerGroupOperationProfile
} from 'ingame/contract/tower_group_operation_contract.js';

const GPU_RESERVED_U32_SENTINEL = 0xffffffff;

export const TOWER_SHARE_SCALE = 1_000_000_000;
export const PRIMARY_TOWER_LOGICAL_ID = 'the-tower';
export const PRIMARY_TOWER_LOGICAL_ORDINAL = 1;

export const TOWER_GROUP_RECORD_STATE = Object.freeze({
    PENDING: 'PENDING',
    LIVING: 'LIVING',
    DEAD: 'DEAD',
    MERGED: 'MERGED'
});

export const TOWER_CREATION_COORDINATOR_MODE = Object.freeze({
    CPU_EXPLICIT_DESCRIPTORS: 'CPU_EXPLICIT_DESCRIPTORS',
    GPU_SUBJECT_ACTOR_ACTION: 'GPU_SUBJECT_ACTOR_ACTION'
});

export const TOWER_RECOVERY_PLACEMENT_POLICY_ID = Object.freeze({
    MAP_ANCHOR_LATTICE_V1: 'tower-recovery.map-anchor-lattice.v1'
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
    MERGE_TRANSACTION_PENDING: 'MERGE_TRANSACTION_PENDING',
    DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',
    TRANSACTION_FINGERPRINT_MISMATCH: 'TRANSACTION_FINGERPRINT_MISMATCH',
    SOURCE_STATE_CHANGED: 'SOURCE_STATE_CHANGED',
    DESCRIPTOR_INVALID: 'DESCRIPTOR_INVALID'
});

export const TOWER_MERGE_RESULT = Object.freeze({
    COMMITTED: 'COMMITTED',
    REJECTED_INSUFFICIENT_SUBJECTS: 'REJECTED_INSUFFICIENT_SUBJECTS',
    REJECTED_SOURCE_CHANGED: 'REJECTED_SOURCE_CHANGED',
    REJECTED_CONFLICTING_TRANSACTION: 'REJECTED_CONFLICTING_TRANSACTION',
    REJECTED: 'REJECTED',
    PROTOCOL_FAILURE: 'PROTOCOL_FAILURE'
});

export const TOWER_MERGE_REASON = Object.freeze({
    INSUFFICIENT_SUBJECTS: 'INSUFFICIENT_SUBJECTS',
    CREATION_TRANSACTION_PENDING: 'CREATION_TRANSACTION_PENDING',
    MERGE_TRANSACTION_PENDING: 'MERGE_TRANSACTION_PENDING',
    TRANSACTION_FINGERPRINT_MISMATCH: 'TRANSACTION_FINGERPRINT_MISMATCH',
    SOURCE_CHANGED: 'SOURCE_CHANGED',
    INVALID_REQUEST: 'INVALID_REQUEST',
    REJECTED: 'REJECTED',
    DESTROYED: 'DESTROYED'
});

export const TOWER_COMBAT_FACT_TYPE = Object.freeze({
    DAMAGE_APPLIED: 'TowerDamageApplied',
    DIED: 'TowerDied',
    SHARE_LOST: 'TowerShareLost',
    NO_LIVING_TOWERS: 'NoLivingTowers',
    MERGED: 'TowerMerged'
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

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

/** R6 compiled group-operation에서 CPU Merge planner가 소유할 identity만 복제합니다. */
export function freezeTowerMergeOperationIdentity(
    source,
    label = 'towerMergeOperation'
) {
    const profile = normalizeTowerGroupOperationProfile(
        source?.groupOperationProfile,
        `${label}.groupOperationProfile`
    );
    if (source?.operationKind !== profile.operationKind
        || source?.actionCode !== profile.actionCode
        || source?.groupOperationProfileId !== profile.id
        || source?.groupOperationProfileFingerprint
            !== profile.towerGroupOperationProfileFingerprint
        || source?.subjectSelector?.code !== profile.subjectSelectorCode
        || source?.subjectSelector?.snapshotPolicy
            !== profile.subjectSnapshotPolicy
        || source?.payloadAbsent !== true
        || source?.executionPolicy?.atomic !== true
        || source?.generatedBodyCount !== profile.generatedBodyCount) {
        throw new RangeError(
            `${label}의 compiled group-operation identity가 profile과 다릅니다.`
        );
    }
    return Object.freeze({
        schemaVersion: requirePositiveSafeInteger(
            source.schemaVersion,
            `${label}.schemaVersion`
        ),
        protocolVersion: requirePositiveSafeInteger(
            source.protocolVersion,
            `${label}.protocolVersion`
        ),
        compiledAbilityId: requireNonEmptyString(
            source.compiledAbilityId,
            `${label}.compiledAbilityId`
        ),
        operationKind: profile.operationKind,
        actionCode: profile.actionCode,
        groupOperationProfileId: profile.id,
        groupOperationProfileFingerprint:
            profile.towerGroupOperationProfileFingerprint,
        subjectSelectorCode: profile.subjectSelectorCode,
        subjectSnapshotPolicy: profile.subjectSnapshotPolicy
    });
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

export function normalizeTowerRecoveryPlacementPolicy(
    source,
    label = 'recoveryPlacementPolicy'
) {
    const policy = freezeTowerRecoverySpawnDescriptor(source, label);
    if (!policy || policy.policyId
            !== TOWER_RECOVERY_PLACEMENT_POLICY_ID.MAP_ANCHOR_LATTICE_V1
        || typeof policy.mapRecoveryAnchorId !== 'string'
        || policy.mapRecoveryAnchorId.length === 0) {
        throw new TypeError(`${label}의 map anchor policy가 유효하지 않습니다.`);
    }
    const mapLatticeVersion = requirePositiveSafeInteger(
        policy.mapLatticeVersion,
        `${label}.mapLatticeVersion`
    );
    const x = Number(policy.anchorPosition?.x);
    const y = Number(policy.anchorPosition?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`${label}.anchorPosition에는 유한한 x/y가 필요합니다.`);
    }
    return Object.freeze({
        policyId: policy.policyId,
        mapRecoveryAnchorId: policy.mapRecoveryAnchorId,
        mapLatticeVersion,
        anchorPosition: Object.freeze({ x, y })
    });
}

export function createTowerRecoveryPlacementDescriptor(
    policySource,
    logicalTowerOrdinal
) {
    const policy = normalizeTowerRecoveryPlacementPolicy(policySource);
    return Object.freeze({
        policyId: policy.policyId,
        logicalTowerOrdinal: requirePositiveSafeInteger(
            logicalTowerOrdinal,
            'recoveryPlacement.logicalTowerOrdinal'
        ),
        mapRecoveryAnchorId: policy.mapRecoveryAnchorId,
        mapLatticeVersion: policy.mapLatticeVersion,
        anchorPosition: policy.anchorPosition,
        position: policy.anchorPosition
    });
}

export function freezeTowerCreationMetadata(
    source,
    label = 'towerCreationMetadata'
) {
    if (source === undefined || source === null) return null;
    const metadata = freezeTowerRecoverySpawnDescriptor(source, label);
    if (typeof metadata.sourceExecutionId !== 'string'
        || metadata.sourceExecutionId.length === 0
        || typeof metadata.actorActionProfileId !== 'string'
        || metadata.actorActionProfileId.length === 0) {
        throw new TypeError(`${label}의 execution/profile identity가 필요합니다.`);
    }
    const recoverySource = freezeTowerRecoverySpawnDescriptor(
        metadata.recoveryPlacementDescriptor,
        `${label}.recoveryPlacementDescriptor`
    );
    if (!recoverySource) {
        throw new TypeError(`${label}.recoveryPlacementDescriptor가 필요합니다.`);
    }
    const recoveryPlacementDescriptor = createTowerRecoveryPlacementDescriptor(
        recoverySource,
        requirePositiveSafeInteger(
            recoverySource.logicalTowerOrdinal,
            `${label}.recoveryPlacementDescriptor.logicalTowerOrdinal`
        )
    );
    if (Number(recoverySource.position?.x)
            !== recoveryPlacementDescriptor.position.x
        || Number(recoverySource.position?.y)
            !== recoveryPlacementDescriptor.position.y) {
        throw new RangeError(`${label}의 recovery position/anchor가 다릅니다.`);
    }
    const normalized = Object.freeze({
        generation: requireNonNegativeSafeInteger(
            metadata.generation,
            `${label}.generation`
        ),
        creationOriginCode: requirePositiveSafeInteger(
            metadata.creationOriginCode,
            `${label}.creationOriginCode`
        ),
        sourceAbilityCode: requirePositiveSafeInteger(
            metadata.sourceAbilityCode,
            `${label}.sourceAbilityCode`
        ),
        sourceExecutionId: metadata.sourceExecutionId,
        sourceExecutionFingerprint: requirePositiveSafeInteger(
            metadata.sourceExecutionFingerprint,
            `${label}.sourceExecutionFingerprint`
        ),
        sourceExecutionOrdinal: requirePositiveSafeInteger(
            metadata.sourceExecutionOrdinal,
            `${label}.sourceExecutionOrdinal`
        ),
        visibleFromExecutionOrdinal: requirePositiveSafeInteger(
            metadata.visibleFromExecutionOrdinal,
            `${label}.visibleFromExecutionOrdinal`
        ),
        actorActionCode: requirePositiveSafeInteger(
            metadata.actorActionCode,
            `${label}.actorActionCode`
        ),
        actorActionProfileId: metadata.actorActionProfileId,
        actorActionProfileFingerprint: requirePositiveSafeInteger(
            metadata.actorActionProfileFingerprint,
            `${label}.actorActionProfileFingerprint`
        ),
        recoveryPlacementDescriptor
    });
    return normalized;
}
