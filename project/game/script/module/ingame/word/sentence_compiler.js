import {
    R7_WORD_PROTOCOL_DATA,
    R7_WORD_DEFINITION_BY_ID,
    R7_WORD_INSTANCE_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE
} from 'data/word/r5_actor_action_profile_data.js';
import {
    R6_TOWER_GROUP_OPERATION_PROFILE_BY_ACTION_CODE
} from 'data/word/r6_tower_group_operation_profile_data.js';
import {
    R7_SENTENCE_MODIFIER_PROFILE_BY_CODE,
    R7_SENTENCE_MODIFIER_PROFILE_BY_ID
} from 'data/word/r7_sentence_modifier_profile_data.js';
import {
    actorActionProfileFingerprint as computeActorActionProfileFingerprint
} from '../contract/actor_action_contract.js';
import {
    towerGroupOperationProfileFingerprint as computeTowerGroupOperationProfileFingerprint
} from '../contract/tower_group_operation_contract.js';
import {
    ABILITY_TARGET_POLICY_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_PAYLOAD_REQUIREMENT,
    SENTENCE_RUNTIME_PHASE,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND,
    WORD_RUNTIME_SUPPORT,
    normalizeSentenceDefinition,
    normalizeSentenceRuntimePhase
} from '../contract/word_sentence_contract.js';
import {
    SentenceModifierResolutionError,
    resolveSentenceModifiers
} from './sentence_modifier_resolver.js';

const COMPILED_ABILITY_SCHEMA_VERSION = 1;

function requireCatalog(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 ID lookup 객체여야 합니다.`);
    }
    return value;
}

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requirePositiveSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function normalizeProtocolData(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('word protocol data가 필요합니다.');
    }
    if (typeof value.previewFormulaId !== 'string'
        || value.previewFormulaId.length === 0) {
        throw new TypeError('word protocol previewFormulaId가 필요합니다.');
    }
    return Object.freeze({
        abiVersion: requirePositiveSafeInteger(
            value.abiVersion,
            'wordProtocol.abiVersion'
        ),
        cooldownTicks: requireNonNegativeSafeInteger(
            value.cooldownTicks,
            'wordProtocol.cooldownTicks'
        ),
        subjectBudget: requirePositiveSafeInteger(
            value.subjectBudget,
            'wordProtocol.subjectBudget'
        ),
        generatedBodyBudget: requirePositiveSafeInteger(
            value.generatedBodyBudget,
            'wordProtocol.generatedBodyBudget'
        ),
        generationLimit: requirePositiveSafeInteger(
            value.generationLimit,
            'wordProtocol.generationLimit'
        ),
        previewFormulaId: value.previewFormulaId
    });
}

function hasRole(definition, role) {
    return Array.isArray(definition?.roles) && definition.roles.includes(role);
}

function requireSentenceSlot(rawSentence, key) {
    if (typeof rawSentence?.[key] !== 'string'
        || rawSentence[key].length === 0) {
        throw new SentenceCompileError(
            SENTENCE_COMPILE_ERROR_CODE.MISSING_SLOT,
            `${key}가 비어 있습니다.`
        );
    }
}

/** SentenceCompiler의 stable failure입니다. 전략적 평가 코드는 존재하지 않습니다. */
export class SentenceCompileError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'SentenceCompileError';
        this.code = code;
    }
}

/**
 * Typed WordInstance 기반 SentenceDefinition을 immutable CompiledAbility로 변환합니다.
 * Localized display string은 semantic key나 validation input으로 사용하지 않습니다.
 */
export class SentenceCompiler {
    constructor(options = {}) {
        this.wordDefinitionsById = requireCatalog(
            options.wordDefinitionsById ?? R7_WORD_DEFINITION_BY_ID,
            'wordDefinitionsById'
        );
        this.wordInstancesById = requireCatalog(
            options.wordInstancesById ?? R7_WORD_INSTANCE_BY_ID,
            'wordInstancesById'
        );
        this.actorActionProfilesByActionCode = requireCatalog(
            options.actorActionProfilesByActionCode
                ?? R5_ACTOR_ACTION_PROFILE_BY_ACTION_CODE,
            'actorActionProfilesByActionCode'
        );
        this.towerGroupOperationProfilesByActionCode = requireCatalog(
            options.towerGroupOperationProfilesByActionCode
                ?? R6_TOWER_GROUP_OPERATION_PROFILE_BY_ACTION_CODE,
            'towerGroupOperationProfilesByActionCode'
        );
        this.modifierProfilesById = requireCatalog(
            options.modifierProfilesById
                ?? R7_SENTENCE_MODIFIER_PROFILE_BY_ID,
            'modifierProfilesById'
        );
        this.modifierProfilesByCode = requireCatalog(
            options.modifierProfilesByCode
                ?? R7_SENTENCE_MODIFIER_PROFILE_BY_CODE,
            'modifierProfilesByCode'
        );
        this.protocol = normalizeProtocolData(
            options.protocol ?? R7_WORD_PROTOCOL_DATA
        );
        this.cache = new Map();
    }

    /**
     * @param {object} rawSentence - typed SentenceDefinition입니다.
     * @param {{executionPhase?:string}} [options={}] - 선택적 실행 phase validation입니다.
     * @returns {Readonly<object>} immutable CompiledAbility입니다.
     */
    compile(rawSentence, options = {}) {
        if (!rawSentence || typeof rawSentence !== 'object'
            || Array.isArray(rawSentence)) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.INVALID_SENTENCE,
                'SentenceDefinition 객체가 필요합니다.'
            );
        }
        requireSentenceSlot(rawSentence, 'subjectWordInstanceId');
        requireSentenceSlot(rawSentence, 'verbWordInstanceId');

        if (options.executionPhase !== undefined) {
            let phase;
            try {
                phase = normalizeSentenceRuntimePhase(options.executionPhase);
            } catch (error) {
                throw new SentenceCompileError(
                    SENTENCE_COMPILE_ERROR_CODE.INVALID_PHASE,
                    error.message
                );
            }
            if (phase !== SENTENCE_RUNTIME_PHASE.COMBAT) {
                throw new SentenceCompileError(
                    SENTENCE_COMPILE_ERROR_CODE.INVALID_PHASE,
                    `현재 ${phase} phase에서는 문장을 실행할 수 없습니다.`
                );
            }
        }

        const subjectInstance = this.#resolveInstance(
            rawSentence.subjectWordInstanceId,
            'Subject'
        );
        const verbInstance = this.#resolveInstance(
            rawSentence.verbWordInstanceId,
            'Verb'
        );
        const subjectDefinition = this.#resolveDefinition(
            subjectInstance.definitionId,
            'Subject'
        );
        const verbDefinition = this.#resolveDefinition(
            verbInstance.definitionId,
            'Verb'
        );
        if (verbDefinition.kind !== WORD_KIND.VERB) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                'Verb slot에는 Verb Word가 필요합니다.'
            );
        }
        const payloadRequirement = verbDefinition.payloadRequirement;
        if (payloadRequirement === SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED) {
            requireSentenceSlot(rawSentence, 'payloadWordInstanceId');
        } else if (payloadRequirement
            === SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN) {
            if (rawSentence.payloadWordInstanceId !== null) {
                throw new SentenceCompileError(
                    SENTENCE_COMPILE_ERROR_CODE.PAYLOAD_FORBIDDEN,
                    `${verbDefinition.id}에는 Payload를 제공할 수 없습니다.`
                );
            }
        } else {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                `${verbDefinition.id} Payload 문법 계약이 없습니다.`
            );
        }

        let sentence;
        try {
            sentence = normalizeSentenceDefinition(
                rawSentence,
                'sentenceDefinition',
                { payloadRequirement }
            );
        } catch (error) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.INVALID_SENTENCE,
                error.message
            );
        }
        if (subjectDefinition.kind !== WORD_KIND.ENTITY
            || !hasRole(subjectDefinition, WORD_GRAMMATICAL_ROLE.SUBJECT)
            || !subjectDefinition.subject) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'Subject slot에는 Subject Entity Word가 필요합니다.'
            );
        }
        if (payloadRequirement === SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN) {
            return this.#compileTowerGroupOperation({
                sentence,
                subjectDefinition,
                verbDefinition
            });
        }

        const payloadInstance = this.#resolveInstance(
            sentence.payloadWordInstanceId,
            'Payload'
        );
        const payloadDefinition = this.#resolveDefinition(
            payloadInstance.definitionId,
            'Payload'
        );
        const actorActionProfile = this.actorActionProfilesByActionCode[
            verbDefinition.actionCode
        ];
        if (!actorActionProfile
            || actorActionProfile.actionCode !== verbDefinition.actionCode) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                '지원하는 actor verb profile이 아닙니다.'
            );
        }
        let actorActionProfileFingerprint;
        try {
            actorActionProfileFingerprint
                = computeActorActionProfileFingerprint(
                    actorActionProfile,
                    `${verbDefinition.id} actorActionProfile`
                );
        } catch (error) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                error.message
            );
        }
        if (!Object.isFrozen(actorActionProfile)
            || !Object.isFrozen(actorActionProfile.transit)
            || actorActionProfile.actorActionProfileFingerprint
                !== actorActionProfileFingerprint) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                'actor verb profile은 canonical immutable identity여야 합니다.'
            );
        }
        if (payloadDefinition.kind !== WORD_KIND.ENTITY
            || !hasRole(payloadDefinition, WORD_GRAMMATICAL_ROLE.PAYLOAD)
            || !payloadDefinition.payload) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'Payload slot에는 Payload Entity Word가 필요합니다.'
            );
        }
        if ((payloadDefinition.payload.runtimeSupport
                !== WORD_RUNTIME_SUPPORT.R3
            && payloadDefinition.payload.runtimeSupport
                !== WORD_RUNTIME_SUPPORT.R5)
            || (payloadDefinition.id !== WORD_DEFINITION_ID.ENEMY
                && payloadDefinition.id !== WORD_DEFINITION_ID.TOWER)) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_PAYLOAD,
                `${payloadDefinition.id} actor Payload runtime은 R5 범위가 아닙니다.`
            );
        }

        const subjectSelectorCode = subjectDefinition.subject.selectorCode;
        let targetPolicyCode;
        if (subjectSelectorCode === SUBJECT_SELECTOR_CODE.TOWER) {
            targetPolicyCode = ABILITY_TARGET_POLICY_CODE.SHARED_AIM_POINT;
        } else if (subjectSelectorCode === SUBJECT_SELECTOR_CODE.ENEMY) {
            targetPolicyCode
                = ABILITY_TARGET_POLICY_CODE.NEAREST_TOWER_THEN_CORE_THEN_FACING;
        } else {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'R3 Subject selector가 아닙니다.'
            );
        }

        const modifierSet = sentence.modifierWordInstanceIds.length === 0
            ? null
            : this.#resolveModifierSet(sentence, {
                actionCode: verbDefinition.actionCode,
                payloadCode: payloadDefinition.payload.payloadCode,
                operationKind: null
            });
        const previewFormulaId = payloadDefinition.payload.previewFormulaId
            ?? this.protocol.previewFormulaId;
        const semanticKeyParts = [
            COMPILED_ABILITY_SCHEMA_VERSION,
            this.protocol.abiVersion,
            subjectDefinition.id,
            verbDefinition.id,
            payloadDefinition.id,
            subjectSelectorCode,
            payloadDefinition.payload.payloadCode,
            payloadDefinition.payload.definitionId,
            payloadDefinition.payload.allegiancePolicy,
            payloadDefinition.payload.runtimeSupport,
            actorActionProfile.abiVersion,
            actorActionProfile.id,
            actorActionProfile.spawnAnchorPolicy,
            actorActionProfile.targetPolicy,
            actorActionProfile.targetSnapshotPolicy,
            actorActionProfile.activationPolicy,
            actorActionProfile.placementPolicy,
            actorActionProfile.launchSpeed,
            actorActionProfile.travelSpeed,
            actorActionProfile.travelDurationFixedTicks,
            actorActionProfile.surfaceGap,
            actorActionProfile.summonLatticeSpacing,
            actorActionProfile.presentationArcHeight,
            actorActionProfile.transit.policy,
            actorActionProfile.transit.suspendControl,
            actorActionProfile.transit.suspendSubjectSelection,
            actorActionProfile.transit.suspendTargetAcceptance,
            actorActionProfile.transit.suppressContact,
            actorActionProfileFingerprint,
            targetPolicyCode,
            this.protocol.cooldownTicks,
            this.protocol.subjectBudget,
            this.protocol.generatedBodyBudget,
            this.protocol.generationLimit,
            previewFormulaId
        ];
        if (modifierSet !== null) {
            semanticKeyParts.push(
                'r7-modifier-set',
                modifierSet.modifierSetFingerprint,
                modifierSet.copiesPerSubject,
                ...modifierSet.authoredModifierWordInstanceIds
            );
        }
        const semanticKey = semanticKeyParts.join('|');
        const cached = this.cache.get(semanticKey);
        if (cached) {
            return cached;
        }

        const preservesR3ExecutionIdentity
            = modifierSet === null
                && verbDefinition.actionCode === SENTENCE_ACTION_CODE.SHOOT
                && payloadDefinition.id === WORD_DEFINITION_ID.ENEMY;
        const compiledAbilityId = modifierSet !== null
            ? [
                'compiled-ability.r7',
                subjectDefinition.id,
                verbDefinition.id,
                payloadDefinition.id,
                actorActionProfile.id,
                `modifier${modifierSet.modifierSetFingerprint}`,
                `abi${this.protocol.abiVersion}`
            ].join(':')
            : preservesR3ExecutionIdentity
            ? [
                'compiled-ability.r3',
                subjectDefinition.id,
                verbDefinition.id,
                payloadDefinition.id,
                `abi${this.protocol.abiVersion}`
            ].join(':')
            : [
                'compiled-ability.r5',
                subjectDefinition.id,
                verbDefinition.id,
                payloadDefinition.id,
                actorActionProfile.id,
                `abi${this.protocol.abiVersion}`
            ].join(':');
        const compiledAbility = Object.freeze({
            schemaVersion: COMPILED_ABILITY_SCHEMA_VERSION,
            protocolVersion: this.protocol.abiVersion,
            compiledAbilityId,
            subjectSelector: Object.freeze({
                code: subjectSelectorCode,
                teamId: subjectDefinition.subject.teamId,
                nounMask: subjectDefinition.subject.nounMask,
                snapshotPolicy: 'execution-start',
                deterministicOrder: 'private-stable-slot-ascending'
            }),
            actionCode: verbDefinition.actionCode,
            actorActionProfileId: actorActionProfile.id,
            actorActionProfileFingerprint,
            actorActionProfile,
            payloadCode: payloadDefinition.payload.payloadCode,
            payloadDefinitionId: payloadDefinition.payload.definitionId,
            payloadRuntimeSupport: payloadDefinition.payload.runtimeSupport,
            allegiancePolicy: payloadDefinition.payload.allegiancePolicy,
            targetPolicyCode,
            targetSnapshotPolicy: actorActionProfile.targetSnapshotPolicy,
            executionPolicy: Object.freeze({
                atomic: true,
                generatedSubjectsJoinCurrentExecution: false,
                acceptedSnapshotSurvivesSourceDeath: true
            }),
            ...(modifierSet === null
                ? {}
                : {
                    modifierSet,
                    modifierSetFingerprint:
                        modifierSet.modifierSetFingerprint,
                    executionShape: Object.freeze({
                        copiesPerSubject: modifierSet.copiesPerSubject
                    })
                }),
            cooldownTicks: this.protocol.cooldownTicks,
            budgets: Object.freeze({
                subjectCount: this.protocol.subjectBudget,
                generatedBodyCount: this.protocol.generatedBodyBudget,
                generation: this.protocol.generationLimit
            }),
            previewFormulaId,
            displaySentenceData: Object.freeze({
                subjectWordDefinitionId: subjectDefinition.id,
                verbWordDefinitionId: verbDefinition.id,
                payloadWordDefinitionId: payloadDefinition.id,
                ...(modifierSet === null
                    ? {}
                    : {
                        modifierWordDefinitionIds:
                            modifierSet.authoredModifierWordDefinitionIds
                    })
            })
        });
        this.cache.set(semanticKey, compiledAbility);
        return compiledAbility;
    }

    #compileTowerGroupOperation({
        sentence,
        subjectDefinition,
        verbDefinition
    }) {
        const profile = this.towerGroupOperationProfilesByActionCode[
            verbDefinition.actionCode
        ];
        let profileFingerprint;
        try {
            profileFingerprint = computeTowerGroupOperationProfileFingerprint(
                profile,
                `${verbDefinition.id} towerGroupOperationProfile`
            );
        } catch (error) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                error.message
            );
        }
        if (!Object.isFrozen(profile)
            || profile.actionCode !== verbDefinition.actionCode
            || profile.payloadRequirement
                !== SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN
            || profile.subjectSelectorCode
                !== subjectDefinition.subject.selectorCode
            || profile.towerGroupOperationProfileFingerprint
                !== profileFingerprint) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'Tower-group operation Subject/profile identity가 일치하지 않습니다.'
            );
        }
        if (sentence.modifierWordInstanceIds.length > 0) {
            this.#resolveModifierSet(sentence, {
                actionCode: verbDefinition.actionCode,
                payloadCode: null,
                operationKind: profile.operationKind
            });
        }

        const semanticKey = [
            COMPILED_ABILITY_SCHEMA_VERSION,
            this.protocol.abiVersion,
            'tower-group-operation',
            subjectDefinition.id,
            verbDefinition.id,
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
            profile.previewFormulaId,
            profileFingerprint,
            this.protocol.cooldownTicks,
            this.protocol.subjectBudget
        ].join('|');
        const cached = this.cache.get(semanticKey);
        if (cached) return cached;

        const compiledAbilityId = [
            'compiled-ability.r6',
            subjectDefinition.id,
            verbDefinition.id,
            profile.id,
            `abi${this.protocol.abiVersion}`
        ].join(':');
        const compiledAbility = Object.freeze({
            schemaVersion: COMPILED_ABILITY_SCHEMA_VERSION,
            protocolVersion: this.protocol.abiVersion,
            compiledAbilityId,
            subjectSelector: Object.freeze({
                code: subjectDefinition.subject.selectorCode,
                teamId: subjectDefinition.subject.teamId,
                nounMask: subjectDefinition.subject.nounMask,
                snapshotPolicy: profile.subjectSnapshotPolicy,
                deterministicOrder: 'private-stable-slot-ascending'
            }),
            actionCode: verbDefinition.actionCode,
            operationKind: profile.operationKind,
            groupOperationProfileId: profile.id,
            groupOperationProfileFingerprint: profileFingerprint,
            groupOperationProfile: profile,
            subjectSelectionPolicy: profile.subjectSelectionPolicy,
            payloadRequirement: profile.payloadRequirement,
            payloadAbsent: true,
            payloadCode: null,
            payloadDefinitionId: null,
            payloadRuntimeSupport: null,
            allegiancePolicy: null,
            targetPolicyCode: null,
            targetSnapshotPolicy: null,
            executionPolicy: Object.freeze({
                atomic: profile.atomic,
                generatedSubjectsJoinCurrentExecution: false
            }),
            generatedBodyCount: profile.generatedBodyCount,
            cooldownTicks: this.protocol.cooldownTicks,
            budgets: Object.freeze({
                subjectCount: this.protocol.subjectBudget,
                generatedBodyCount: profile.generatedBodyCount,
                generation: 0
            }),
            authorities: Object.freeze({
                cooldown: profile.cooldownAuthority,
                subjectBudget: profile.subjectBudgetAuthority,
                generatedBodyBudget: profile.generatedBodyBudgetAuthority
            }),
            previewFormulaId: profile.previewFormulaId,
            runtimeSupport: profile.runtimeSupport,
            runtimeAvailability: profile.runtimeAvailability,
            displaySentenceData: Object.freeze({
                subjectWordDefinitionId: subjectDefinition.id,
                verbWordDefinitionId: verbDefinition.id,
                payloadWordDefinitionId: null
            })
        });
        this.cache.set(semanticKey, compiledAbility);
        return compiledAbility;
    }

    #resolveModifierSet(sentence, semanticContext) {
        try {
            return resolveSentenceModifiers({
                modifierWordInstanceIds: sentence.modifierWordInstanceIds,
                wordInstancesById: this.wordInstancesById,
                wordDefinitionsById: this.wordDefinitionsById,
                modifierProfilesById: this.modifierProfilesById,
                modifierProfilesByCode: this.modifierProfilesByCode,
                baseCompiledSemanticContext: {
                    ...semanticContext,
                    generatedBodyBudget: this.protocol.generatedBodyBudget
                }
            });
        } catch (error) {
            if (error instanceof SentenceModifierResolutionError) {
                throw new SentenceCompileError(error.code, error.message);
            }
            throw error;
        }
    }

    /** 예외를 immutable validation result로 바꿉니다. */
    tryCompile(sentence, options = {}) {
        try {
            return Object.freeze({
                valid: true,
                code: 'VALID',
                message: null,
                compiledAbility: this.compile(sentence, options)
            });
        } catch (error) {
            const compileError = error instanceof SentenceCompileError
                ? error
                : new SentenceCompileError(
                    SENTENCE_COMPILE_ERROR_CODE.INVALID_SENTENCE,
                    error?.message ?? 'Sentence compile에 실패했습니다.'
                );
            return Object.freeze({
                valid: false,
                code: compileError.code,
                message: compileError.message,
                compiledAbility: null
            });
        }
    }

    getCacheSize() {
        return this.cache.size;
    }

    #resolveInstance(instanceId, label) {
        const instance = this.wordInstancesById[instanceId];
        if (!instance || instance.id !== instanceId
            || typeof instance.definitionId !== 'string') {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_WORD_INSTANCE,
                `${label} WordInstance가 catalog에 없습니다: ${instanceId}`
            );
        }
        return instance;
    }

    #resolveDefinition(definitionId, label) {
        const definition = this.wordDefinitionsById[definitionId];
        if (!definition || definition.id !== definitionId) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_WORD_INSTANCE,
                `${label} WordDefinition이 catalog에 없습니다: ${definitionId}`
            );
        }
        return definition;
    }
}
