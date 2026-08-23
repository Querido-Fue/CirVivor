import {
    GAMEPLAY_NOUN_MASK,
    SUBJECT_SELECTOR_CODE
} from './word_sentence_contract.js';
import {
    actorActionProfileFingerprint as computeActorActionProfileFingerprint
} from './actor_action_contract.js';

export const ABILITY_ENTITY_METADATA_ABI_VERSION = 1;
export const ABILITY_EXECUTION_COMMAND_ABI_VERSION = 2;

export const ABILITY_CREATION_ORIGIN_CODE = Object.freeze({
    NONE: 0,
    NATURAL: 1,
    SENTENCE_PAYLOAD: 2
});

export const ABILITY_SUBJECT_SNAPSHOT_STATUS = Object.freeze({
    PENDING: 0,
    COMPLETE: 1,
    ZERO_SUBJECT: 2,
    CAPACITY_REJECTED: 3,
    PROTOCOL_REJECTED: 4,
    CANCELLED: 5
});

export const ABILITY_SUBJECT_SNAPSHOT_ERROR_FLAG = Object.freeze({
    NONE: 0,
    BODY_ABI: 1 << 0,
    COMMAND_ABI: 1 << 1,
    SUBJECT_CAPACITY: 1 << 2,
    STALE_PROTOCOL: 1 << 3
});

const UINT32_MAX = 0xffffffff;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const SELECTOR_CODES = new Set(Object.values(SUBJECT_SELECTOR_CODE));
const ORIGIN_CODES = new Set(Object.values(ABILITY_CREATION_ORIGIN_CODE));
const TOWER_GROUP_MERGE_OPERATION_KIND = 'TOWER_GROUP_MERGE';

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireUint32(value, label, { positive = false } = {}) {
    const number = Number(value);
    if (!Number.isSafeInteger(number)
        || number < (positive ? 1 : 0)
        || number > UINT32_MAX) {
        throw new RangeError(`${label}은 uint32 범위여야 합니다.`);
    }
    return number >>> 0;
}

function requireFiniteFloat32(value, label) {
    const number = Math.fround(Number(value));
    if (!Number.isFinite(number)) {
        throw new RangeError(`${label}은 finite float32여야 합니다.`);
    }
    return number;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

/** Stable string/number tuple을 uint32 FNV-1a fingerprint로 정규화합니다. */
export function fingerprintAbilityProtocol(...parts) {
    let hash = FNV_OFFSET_BASIS;
    const text = parts.map((part) => String(part)).join('|');
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index) & 0xff;
        hash = Math.imul(hash, FNV_PRIME) >>> 0;
        const high = text.charCodeAt(index) >>> 8;
        if (high !== 0) {
            hash ^= high;
            hash = Math.imul(hash, FNV_PRIME) >>> 0;
        }
    }
    return hash === 0 ? FNV_OFFSET_BASIS : hash;
}

export function abilityDefinitionCode(definitionId) {
    return fingerprintAbilityProtocol(
        'ability-definition.r3',
        requireNonEmptyString(definitionId, 'definitionId')
    );
}

/**
 * Registry의 flat metadata와 kind를 독립 GPU gameplay metadata record로 변환합니다.
 * Team은 이 record가 소유하지 않고 BodySimulation.gameplay_meta를 계속 사용합니다.
 */
export function createAbilityEntityMetadata(registryView, overrides = {}) {
    requireRecord(registryView, 'registryView');
    requireRecord(overrides, 'ability metadata overrides');
    const kindId = requireNonEmptyString(registryView.kindId, 'registryView.kindId');
    const nounMask = overrides.nounMask ?? (
        kindId === 'tower'
            ? GAMEPLAY_NOUN_MASK.TOWER
            : kindId === 'enemy'
                ? GAMEPLAY_NOUN_MASK.ENEMY
                : GAMEPLAY_NOUN_MASK.NONE
    );
    const definitionId = registryView.definitionId ?? kindId;
    const source = registryView.metadata ?? {};
    const creationOriginCode = requireUint32(
        overrides.creationOriginCode
            ?? source.abilityCreationOriginCode
            ?? ABILITY_CREATION_ORIGIN_CODE.NATURAL,
        'creationOriginCode'
    );
    if (!ORIGIN_CODES.has(creationOriginCode)) {
        throw new RangeError('creationOriginCode가 알려지 않았습니다.');
    }
    return Object.freeze({
        abiVersion: ABILITY_ENTITY_METADATA_ABI_VERSION,
        nounMask: requireUint32(nounMask, 'nounMask'),
        definitionCode: requireUint32(
            overrides.definitionCode ?? abilityDefinitionCode(definitionId),
            'definitionCode',
            { positive: true }
        ),
        ownerEntityId: requireUint32(
            overrides.ownerEntityId ?? source.abilityOwnerEntityId ?? 0,
            'ownerEntityId'
        ),
        ownerIncarnation: requireUint32(
            overrides.ownerIncarnation ?? source.abilityOwnerIncarnation ?? 0,
            'ownerIncarnation'
        ),
        sourceAbilityCode: requireUint32(
            overrides.sourceAbilityCode ?? source.sourceAbilityCode ?? 0,
            'sourceAbilityCode'
        ),
        sourceExecutionFingerprint: requireUint32(
            overrides.sourceExecutionFingerprint
                ?? source.sourceExecutionFingerprint
                ?? 0,
            'sourceExecutionFingerprint'
        ),
        sourceExecutionOrdinal: requireUint32(
            overrides.sourceExecutionOrdinal
                ?? source.sourceExecutionOrdinal
                ?? 0,
            'sourceExecutionOrdinal'
        ),
        generation: requireUint32(
            overrides.generation ?? source.abilityGeneration ?? 0,
            'generation'
        ),
        visibleFromExecutionOrdinal: requireUint32(
            overrides.visibleFromExecutionOrdinal
                ?? source.visibleFromExecutionOrdinal
                ?? 0,
            'visibleFromExecutionOrdinal'
        ),
        creationOriginCode,
        powerFixedPoint: requireUint32(
            overrides.powerFixedPoint ?? source.powerFixedPoint ?? 100,
            'powerFixedPoint'
        )
    });
}

/** CPU AbilityRuntime이 endpoint에 보내는 semantic execution command를 고정합니다. */
export function normalizeAbilityExecutionCommand(command) {
    requireRecord(command, 'abilityExecutionCommand');
    const compiledAbility = requireRecord(
        command.compiledAbility,
        'abilityExecutionCommand.compiledAbility'
    );
    const selector = requireRecord(
        compiledAbility.subjectSelector,
        'compiledAbility.subjectSelector'
    );
    const selectorCode = requireUint32(selector.code, 'subjectSelectorCode');
    if (!SELECTOR_CODES.has(selectorCode)) {
        throw new RangeError('subject selector code가 알려지 않았습니다.');
    }
    const executionId = requireNonEmptyString(command.executionId, 'executionId');
    const executionOrdinal = requireUint32(
        command.executionOrdinal,
        'executionOrdinal',
        { positive: true }
    );
    const targetFixedTick = requireUint32(
        command.targetFixedTick,
        'targetFixedTick',
        { positive: true }
    );
    const subjectLimit = requireUint32(
        command.subjectLimit ?? compiledAbility.budgets?.subjectCount,
        'subjectLimit',
        { positive: true }
    );
    const towerGroupMerge = compiledAbility.operationKind
        === TOWER_GROUP_MERGE_OPERATION_KIND;
    const generationLimit = requireUint32(
        towerGroupMerge
            ? command.generationLimit ?? UINT32_MAX
            : command.generationLimit ?? compiledAbility.budgets?.generation,
        'generationLimit',
        { positive: true }
    );
    if (towerGroupMerge && generationLimit !== UINT32_MAX) {
        throw new RangeError(
            'Tower Merge execution snapshot은 generation을 필터링할 수 없습니다.'
        );
    }
    const aimPoint = Object.freeze({
        x: requireFiniteFloat32(command.aimPoint?.x ?? 0, 'aimPoint.x'),
        y: requireFiniteFloat32(command.aimPoint?.y ?? 0, 'aimPoint.y')
    });
    let semanticProfileFingerprint;
    if (towerGroupMerge) {
        const profile = requireRecord(
            compiledAbility.groupOperationProfile,
            'compiledAbility.groupOperationProfile'
        );
        semanticProfileFingerprint = requireUint32(
            compiledAbility.groupOperationProfileFingerprint,
            'compiledAbility.groupOperationProfileFingerprint',
            { positive: true }
        );
        const canonicalGroupOperationProfileFingerprint
            = fingerprintAbilityProtocol(
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
        if (profile.operationKind !== TOWER_GROUP_MERGE_OPERATION_KIND
            || profile.towerGroupOperationProfileFingerprint
                !== semanticProfileFingerprint
            || canonicalGroupOperationProfileFingerprint
                !== semanticProfileFingerprint) {
            throw new RangeError(
                'compiledAbility Tower Merge profile fingerprint가 다릅니다.'
            );
        }
    } else {
        const actorActionProfile = requireRecord(
            compiledAbility.actorActionProfile,
            'compiledAbility.actorActionProfile'
        );
        const canonicalActorActionProfileFingerprint
            = computeActorActionProfileFingerprint(actorActionProfile);
        const compiledActorActionProfileFingerprint = requireUint32(
            compiledAbility.actorActionProfileFingerprint,
            'compiledAbility.actorActionProfileFingerprint',
            { positive: true }
        );
        if (compiledActorActionProfileFingerprint
            !== canonicalActorActionProfileFingerprint) {
            throw new RangeError(
                'compiledAbility actor-action profile fingerprint가 다릅니다.'
            );
        }
        semanticProfileFingerprint = requireUint32(
            command.actorActionProfileFingerprint
                ?? compiledActorActionProfileFingerprint,
            'actorActionProfileFingerprint',
            { positive: true }
        );
        if (semanticProfileFingerprint
            !== compiledActorActionProfileFingerprint) {
            throw new RangeError(
                'ability command actor-action profile fingerprint가 다릅니다.'
            );
        }
    }
    const payloadCode = towerGroupMerge
        ? 0
        : requireUint32(compiledAbility.payloadCode, 'payloadCode');
    const targetPolicyCode = towerGroupMerge
        ? 0
        : requireUint32(
            compiledAbility.targetPolicyCode,
            'targetPolicyCode'
        );
    const compiledAbilityCode = fingerprintAbilityProtocol(
        compiledAbility.compiledAbilityId,
        compiledAbility.schemaVersion,
        compiledAbility.protocolVersion,
        semanticProfileFingerprint
    );
    const executionFingerprint = requireUint32(
        command.fingerprint ?? fingerprintAbilityProtocol(
            ABILITY_EXECUTION_COMMAND_ABI_VERSION,
            executionId,
            executionOrdinal,
            targetFixedTick,
            compiledAbilityCode,
            selectorCode,
            selector.nounMask,
            selector.teamId,
            compiledAbility.actionCode,
            payloadCode,
            targetPolicyCode,
            semanticProfileFingerprint,
            subjectLimit,
            generationLimit,
            aimPoint.x,
            aimPoint.y
        ),
        'fingerprint',
        { positive: true }
    );
    return Object.freeze({
        abiVersion: ABILITY_EXECUTION_COMMAND_ABI_VERSION,
        compiledAbility,
        compiledAbilityCode,
        executionId,
        executionIdFingerprint: fingerprintAbilityProtocol(executionId),
        executionOrdinal,
        targetFixedTick,
        selectorCode,
        nounMask: requireUint32(selector.nounMask, 'selector.nounMask'),
        teamId: requireUint32(selector.teamId, 'selector.teamId'),
        actionCode: requireUint32(compiledAbility.actionCode, 'actionCode'),
        payloadCode,
        targetPolicyCode,
        ...(towerGroupMerge
            ? {
                actorActionProfileFingerprint: 0,
                groupOperationProfileFingerprint:
                    semanticProfileFingerprint
            }
            : {
                actorActionProfileFingerprint:
                    semanticProfileFingerprint
            }),
        aimPoint,
        subjectLimit,
        generationLimit,
        fingerprint: executionFingerprint
    });
}
