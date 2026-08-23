import { fingerprintAbilityProtocol } from './ability_execution_contract.js';
import {
    SENTENCE_ACTION_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    SENTENCE_RUNTIME_AVAILABILITY,
    SUBJECT_SELECTOR_CODE,
    WORD_RUNTIME_SUPPORT
} from './word_sentence_contract.js';

export const TOWER_GROUP_OPERATION_PROFILE_ABI_VERSION = 1;

export const TOWER_GROUP_OPERATION_PROFILE_ID = Object.freeze({
    MERGE: 'tower-group-operation.merge.v1'
});

export const TOWER_GROUP_OPERATION_KIND = Object.freeze({
    MERGE: 'TOWER_GROUP_MERGE'
});

export const TOWER_GROUP_SUBJECT_SELECTION_POLICY = Object.freeze({
    ALL_LIVING_TOWERS: 'ALL_LIVING_TOWERS'
});

export const TOWER_GROUP_SUBJECT_SNAPSHOT_POLICY = Object.freeze({
    EXECUTION_START: 'execution-start'
});

export const TOWER_GROUP_OPERATION_AUTHORITY = Object.freeze({
    WORD_PROTOCOL: 'WORD_PROTOCOL',
    PROFILE_FIXED_ZERO: 'PROFILE_FIXED_ZERO'
});

const PROFILE_KEYS = new Set([
    'abiVersion',
    'id',
    'operationKind',
    'actionCode',
    'subjectSelectorCode',
    'subjectSelectionPolicy',
    'subjectSnapshotPolicy',
    'payloadRequirement',
    'atomic',
    'generatedBodyCount',
    'cooldownAuthority',
    'subjectBudgetAuthority',
    'generatedBodyBudgetAuthority',
    'runtimeSupport',
    'runtimeAvailability',
    'previewFormulaId',
    'towerGroupOperationProfileFingerprint'
]);

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireKnownDataProperties(value, label) {
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
    }
    for (const key of Object.keys(value)) {
        if (!PROFILE_KEYS.has(key)) {
            throw new RangeError(`${label}.${key}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || typeof descriptor.get === 'function'
            || typeof descriptor.set === 'function') {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
    }
}

function requireExact(value, expected, label) {
    if (value !== expected) {
        throw new RangeError(`${label}은 ${expected}여야 합니다.`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function computeFingerprint(profile) {
    return fingerprintAbilityProtocol(
        'tower-group-operation-profile',
        profile.abiVersion,
        profile.id,
        profile.operationKind,
        profile.actionCode,
        profile.subjectSelectorCode,
        profile.subjectSelectionPolicy,
        profile.subjectSnapshotPolicy,
        profile.payloadRequirement,
        profile.atomic,
        profile.generatedBodyCount,
        profile.cooldownAuthority,
        profile.subjectBudgetAuthority,
        profile.generatedBodyBudgetAuthority,
        profile.runtimeSupport,
        profile.runtimeAvailability,
        profile.previewFormulaId
    );
}

/** ActorAction과 분리된 unary Tower-group operation profile을 고정합니다. */
export function normalizeTowerGroupOperationProfile(
    source,
    label = 'towerGroupOperationProfile'
) {
    requireRecord(source, label);
    requireKnownDataProperties(source, label);
    const profile = {
        abiVersion: requireExact(
            source.abiVersion,
            TOWER_GROUP_OPERATION_PROFILE_ABI_VERSION,
            `${label}.abiVersion`
        ),
        id: requireExact(
            source.id,
            TOWER_GROUP_OPERATION_PROFILE_ID.MERGE,
            `${label}.id`
        ),
        operationKind: requireExact(
            source.operationKind,
            TOWER_GROUP_OPERATION_KIND.MERGE,
            `${label}.operationKind`
        ),
        actionCode: requireExact(
            source.actionCode,
            SENTENCE_ACTION_CODE.MERGE,
            `${label}.actionCode`
        ),
        subjectSelectorCode: requireExact(
            source.subjectSelectorCode,
            SUBJECT_SELECTOR_CODE.TOWER,
            `${label}.subjectSelectorCode`
        ),
        subjectSelectionPolicy: requireExact(
            source.subjectSelectionPolicy,
            TOWER_GROUP_SUBJECT_SELECTION_POLICY.ALL_LIVING_TOWERS,
            `${label}.subjectSelectionPolicy`
        ),
        subjectSnapshotPolicy: requireExact(
            source.subjectSnapshotPolicy,
            TOWER_GROUP_SUBJECT_SNAPSHOT_POLICY.EXECUTION_START,
            `${label}.subjectSnapshotPolicy`
        ),
        payloadRequirement: requireExact(
            source.payloadRequirement,
            SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN,
            `${label}.payloadRequirement`
        ),
        atomic: requireExact(source.atomic, true, `${label}.atomic`),
        generatedBodyCount: requireExact(
            source.generatedBodyCount,
            0,
            `${label}.generatedBodyCount`
        ),
        cooldownAuthority: requireExact(
            source.cooldownAuthority,
            TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
            `${label}.cooldownAuthority`
        ),
        subjectBudgetAuthority: requireExact(
            source.subjectBudgetAuthority,
            TOWER_GROUP_OPERATION_AUTHORITY.WORD_PROTOCOL,
            `${label}.subjectBudgetAuthority`
        ),
        generatedBodyBudgetAuthority: requireExact(
            source.generatedBodyBudgetAuthority,
            TOWER_GROUP_OPERATION_AUTHORITY.PROFILE_FIXED_ZERO,
            `${label}.generatedBodyBudgetAuthority`
        ),
        runtimeSupport: requireExact(
            source.runtimeSupport,
            WORD_RUNTIME_SUPPORT.R6,
            `${label}.runtimeSupport`
        ),
        runtimeAvailability: requireExact(
            source.runtimeAvailability,
            SENTENCE_RUNTIME_AVAILABILITY.RUNTIME_UNAVAILABLE,
            `${label}.runtimeAvailability`
        ),
        previewFormulaId: requireNonEmptyString(
            source.previewFormulaId,
            `${label}.previewFormulaId`
        )
    };
    const towerGroupOperationProfileFingerprint = computeFingerprint(profile);
    if (source.towerGroupOperationProfileFingerprint !== undefined
        && source.towerGroupOperationProfileFingerprint
            !== towerGroupOperationProfileFingerprint) {
        throw new RangeError(`${label} fingerprint가 semantic profile과 다릅니다.`);
    }
    return Object.freeze({
        ...profile,
        towerGroupOperationProfileFingerprint
    });
}

export function towerGroupOperationProfileFingerprint(source, label) {
    return normalizeTowerGroupOperationProfile(source, label)
        .towerGroupOperationProfileFingerprint;
}
