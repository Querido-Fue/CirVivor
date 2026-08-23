import {
    MODIFIER_APPLICATION_PHASE,
    MODIFIER_SCOPE,
    MODIFIER_STACKING_POLICY,
    computeModifierSetFingerprint,
    normalizeModifierProfile
} from '../contract/sentence_modifier_contract.js';
import {
    SENTENCE_COMPILE_ERROR_CODE,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND
} from '../contract/word_sentence_contract.js';

const UINT32_MAX = 0xffffffff;
const APPLICATION_PHASE_ORDER = new Map(
    Object.values(MODIFIER_APPLICATION_PHASE).map((phase, index) => [
        phase,
        index
    ])
);

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    return value;
}

function requireCatalog(value, label) {
    return requireRecord(value, label);
}

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function compareCanonicalEntries(left, right) {
    const phaseDelta = APPLICATION_PHASE_ORDER.get(left.applicationPhase)
        - APPLICATION_PHASE_ORDER.get(right.applicationPhase);
    if (phaseDelta !== 0) return phaseDelta;
    if (left.priority !== right.priority) {
        return left.priority - right.priority;
    }
    return left.definitionId < right.definitionId
        ? -1
        : left.definitionId > right.definitionId
            ? 1
            : 0;
}

function resolveStackContribution(instance, instanceId) {
    if (!Object.hasOwn(instance, 'modifierStackContribution')) return 1;
    const descriptor = Object.getOwnPropertyDescriptor(
        instance,
        'modifierStackContribution'
    );
    const value = descriptor?.value;
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0 || value > UINT32_MAX) {
        throw resolutionError(
            SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
            `Modifier stack contribution이 올바르지 않습니다: ${instanceId}`
        );
    }
    return value;
}

function resolutionError(code, message) {
    return new SentenceModifierResolutionError(code, message);
}

/** Modifier resolution의 stable compile failure입니다. */
export class SentenceModifierResolutionError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SentenceModifierResolutionError';
        this.code = code;
    }
}

/**
 * Authored Modifier WordInstance들을 canonical immutable ModifierSet으로
 * 변환합니다. Catalog/profile materialization은 unique identity마다 한 번만
 * 수행합니다.
 */
export function resolveSentenceModifiers(options = {}) {
    requireRecord(options, 'sentenceModifierResolver options');
    const modifierWordInstanceIds = options.modifierWordInstanceIds;
    if (!Array.isArray(modifierWordInstanceIds)
        || modifierWordInstanceIds.length === 0) {
        throw new RangeError('modifierWordInstanceIds가 비어 있습니다.');
    }
    const wordInstancesById = requireCatalog(
        options.wordInstancesById,
        'wordInstancesById'
    );
    const wordDefinitionsById = requireCatalog(
        options.wordDefinitionsById,
        'wordDefinitionsById'
    );
    const modifierProfilesById = requireCatalog(
        options.modifierProfilesById,
        'modifierProfilesById'
    );
    const modifierProfilesByCode = requireCatalog(
        options.modifierProfilesByCode,
        'modifierProfilesByCode'
    );
    const context = requireRecord(
        options.baseCompiledSemanticContext,
        'baseCompiledSemanticContext'
    );
    const actionCode = context.actionCode;
    const payloadCode = context.payloadCode;
    const operationKind = context.operationKind ?? null;
    const generatedBodyBudget = context.generatedBodyBudget === undefined
        ? UINT32_MAX
        : requirePositiveSafeInteger(
            context.generatedBodyBudget,
            'baseCompiledSemanticContext.generatedBodyBudget'
        );

    const authoredModifierWordInstanceIds = [];
    const authoredModifierWordDefinitionIds = [];
    const seenInstanceIds = new Set();
    const definitionCache = new Map();
    const profileCache = new Map();
    const groupedEntries = new Map();

    function resolveDefinition(definitionId) {
        if (definitionCache.has(definitionId)) {
            return definitionCache.get(definitionId);
        }
        const definition = wordDefinitionsById[definitionId];
        if (!definition || definition.id !== definitionId) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_WORD_INSTANCE,
                `Modifier WordDefinition이 catalog에 없습니다: ${definitionId}`
            );
        }
        const kind = definition.kind;
        const roles = definition.roles;
        const modifier = definition.modifier;
        if (kind !== WORD_KIND.MODIFIER
            || !Array.isArray(roles)
            || !roles.includes(WORD_GRAMMATICAL_ROLE.MODIFIER)) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'Modifier slot에는 Modifier Word가 필요합니다.'
            );
        }
        if (!modifier || typeof modifier !== 'object') {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                `${definitionId} Modifier semantic profile이 없습니다.`
            );
        }
        const resolved = Object.freeze({
            definitionId,
            modifierCode: modifier.modifierCode,
            profileId: modifier.profileId
        });
        definitionCache.set(definitionId, resolved);
        return resolved;
    }

    function resolveProfile(definition) {
        const cacheKey = `${definition.profileId}|${definition.modifierCode}`;
        if (profileCache.has(cacheKey)) return profileCache.get(cacheKey);
        const profileById = modifierProfilesById[definition.profileId];
        const profileByCode = modifierProfilesByCode[definition.modifierCode];
        if (!profileById || !profileByCode) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                `${definition.definitionId} ModifierProfile이 알려지지 않았습니다.`
            );
        }
        let normalizedById;
        let normalizedByCode;
        try {
            normalizedById = normalizeModifierProfile(
                profileById,
                `${definition.definitionId} ModifierProfile`
            );
            normalizedByCode = profileByCode === profileById
                ? normalizedById
                : normalizeModifierProfile(
                    profileByCode,
                    `${definition.definitionId} ModifierProfileByCode`
                );
        } catch (error) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                error.message
            );
        }
        if (normalizedById.id !== definition.profileId
            || normalizedById.modifierCode !== definition.modifierCode
            || normalizedByCode.id !== normalizedById.id
            || normalizedByCode.modifierCode !== normalizedById.modifierCode
            || normalizedByCode.modifierProfileFingerprint
                !== normalizedById.modifierProfileFingerprint) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                `${definition.definitionId} Modifier profile/code identity가 다릅니다.`
            );
        }
        profileCache.set(cacheKey, normalizedById);
        return normalizedById;
    }

    for (let index = 0; index < modifierWordInstanceIds.length; index++) {
        const instanceId = modifierWordInstanceIds[index];
        if (typeof instanceId !== 'string' || instanceId.length === 0) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_WORD_INSTANCE,
                `Modifier WordInstance ID가 올바르지 않습니다: ${index}`
            );
        }
        if (seenInstanceIds.has(instanceId)) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.DUPLICATE_MODIFIER_INSTANCE,
                `같은 Modifier WordInstance를 중복 사용할 수 없습니다: ${instanceId}`
            );
        }
        seenInstanceIds.add(instanceId);
        const instance = wordInstancesById[instanceId];
        const resolvedInstanceId = instance?.id;
        const definitionId = instance?.definitionId;
        if (!instance || resolvedInstanceId !== instanceId
            || typeof definitionId !== 'string') {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                `Modifier WordInstance가 catalog에 없습니다: ${instanceId}`
            );
        }
        const definition = resolveDefinition(definitionId);
        const profile = resolveProfile(definition);
        const stackContribution = resolveStackContribution(
            instance,
            instanceId
        );
        authoredModifierWordInstanceIds.push(instanceId);
        authoredModifierWordDefinitionIds.push(definition.definitionId);

        const grouped = groupedEntries.get(definition.definitionId);
        if (grouped) {
            grouped.stackCount += stackContribution;
            if (grouped.stackCount > profile.maxStacks) {
                throw resolutionError(
                    SENTENCE_COMPILE_ERROR_CODE.MODIFIER_STACK_LIMIT_EXCEEDED,
                    `${definition.definitionId} stack이 ${profile.maxStacks}를 초과했습니다.`
                );
            }
        } else {
            groupedEntries.set(definition.definitionId, {
                definition,
                profile,
                stackCount: stackContribution
            });
            if (stackContribution > profile.maxStacks) {
                throw resolutionError(
                    SENTENCE_COMPILE_ERROR_CODE.MODIFIER_STACK_LIMIT_EXCEEDED,
                    `${definition.definitionId} stack이 ${profile.maxStacks}를 초과했습니다.`
                );
            }
        }
    }

    const conflictGroups = new Map();
    let copiesPerSubject = 1;
    const canonicalEntries = [];
    for (const grouped of groupedEntries.values()) {
        const { definition, profile, stackCount } = grouped;
        if (operationKind !== null) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER_FOR_OPERATION,
                `${operationKind} operation에는 Modifier를 적용할 수 없습니다.`
            );
        }
        if (profile.scope !== MODIFIER_SCOPE.ACTOR_ACTION
            || profile.applicationPhase
                !== MODIFIER_APPLICATION_PHASE.EXECUTION_CARDINALITY
            || profile.stackingPolicy !== MODIFIER_STACKING_POLICY.MULTIPLY) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER,
                `${definition.definitionId} Modifier 실행 정책을 지원하지 않습니다.`
            );
        }
        if (!profile.supportedActionCodes.includes(actionCode)
            || !profile.supportedPayloadCodes.includes(payloadCode)) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_MODIFIER,
                `${definition.definitionId}은 현재 action/payload를 지원하지 않습니다.`
            );
        }
        if (profile.conflictGroup !== null) {
            const conflictingDefinitionId = conflictGroups.get(
                profile.conflictGroup
            );
            if (conflictingDefinitionId !== undefined
                && conflictingDefinitionId !== definition.definitionId) {
                throw resolutionError(
                    SENTENCE_COMPILE_ERROR_CODE.MODIFIER_CONFLICT,
                    `${definition.definitionId}은 ${conflictingDefinitionId}과 충돌합니다.`
                );
            }
            conflictGroups.set(profile.conflictGroup, definition.definitionId);
        }
        for (let stack = 0; stack < stackCount; stack++) {
            if (copiesPerSubject > Math.floor(
                Number.MAX_SAFE_INTEGER / profile.factorNumerator
            )) {
                throw resolutionError(
                    SENTENCE_COMPILE_ERROR_CODE.MODIFIER_CARDINALITY_OVERFLOW,
                    'Modifier cardinality가 안전한 정수 범위를 초과합니다.'
                );
            }
            copiesPerSubject *= profile.factorNumerator;
        }
        if (copiesPerSubject > UINT32_MAX) {
            throw resolutionError(
                SENTENCE_COMPILE_ERROR_CODE.MODIFIER_CARDINALITY_OVERFLOW,
                'Modifier cardinality가 uint32 범위를 초과합니다.'
            );
        }
        canonicalEntries.push(Object.freeze({
            modifierCode: profile.modifierCode,
            definitionId: definition.definitionId,
            profileId: profile.id,
            profileFingerprint: profile.modifierProfileFingerprint,
            stackCount,
            applicationPhase: profile.applicationPhase,
            priority: profile.priority
        }));
    }
    if (copiesPerSubject > generatedBodyBudget) {
        throw resolutionError(
            SENTENCE_COMPILE_ERROR_CODE
                .MODIFIER_GENERATED_BODY_BUDGET_EXCEEDED,
            `최소 생성량 ${copiesPerSubject}이 generated-body budget을 초과합니다.`
        );
    }
    canonicalEntries.sort(compareCanonicalEntries);
    const frozenCanonicalEntries = Object.freeze(canonicalEntries);
    const fingerprintSource = {
        canonicalEntries: frozenCanonicalEntries,
        copiesPerSubject
    };
    const modifierSetFingerprint = computeModifierSetFingerprint(
        fingerprintSource
    );
    return Object.freeze({
        authoredModifierWordInstanceIds: Object.freeze(
            authoredModifierWordInstanceIds
        ),
        authoredModifierWordDefinitionIds: Object.freeze(
            authoredModifierWordDefinitionIds
        ),
        canonicalEntries: frozenCanonicalEntries,
        modifierSetFingerprint,
        copiesPerSubject
    });
}
