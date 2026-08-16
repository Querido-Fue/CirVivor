import {
    R3_WORD_DEFINITION_BY_ID,
    R3_WORD_INSTANCE_BY_ID,
    R3_WORD_PROTOCOL_DATA
} from 'data/word/r3_word_catalog_data.js';
import {
    ABILITY_TARGET_POLICY_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_COMPILE_ERROR_CODE,
    SENTENCE_RUNTIME_PHASE,
    SUBJECT_SELECTOR_CODE,
    WORD_DEFINITION_ID,
    WORD_GRAMMATICAL_ROLE,
    WORD_KIND,
    WORD_RUNTIME_SUPPORT,
    normalizeSentenceDefinition,
    normalizeSentenceRuntimePhase
} from '../contract/word_sentence_contract.js';

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
            options.wordDefinitionsById ?? R3_WORD_DEFINITION_BY_ID,
            'wordDefinitionsById'
        );
        this.wordInstancesById = requireCatalog(
            options.wordInstancesById ?? R3_WORD_INSTANCE_BY_ID,
            'wordInstancesById'
        );
        this.protocol = normalizeProtocolData(
            options.protocol ?? R3_WORD_PROTOCOL_DATA
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
        requireSentenceSlot(rawSentence, 'payloadWordInstanceId');

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

        let sentence;
        try {
            sentence = normalizeSentenceDefinition(rawSentence);
        } catch (error) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.INVALID_SENTENCE,
                error.message
            );
        }
        if (sentence.modifierWordInstanceIds.length > 0) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNKNOWN_MODIFIER,
                'R3에서는 modifier runtime을 지원하지 않습니다.'
            );
        }

        const subjectInstance = this.#resolveInstance(
            sentence.subjectWordInstanceId,
            'Subject'
        );
        const verbInstance = this.#resolveInstance(
            sentence.verbWordInstanceId,
            'Verb'
        );
        const payloadInstance = this.#resolveInstance(
            sentence.payloadWordInstanceId,
            'Payload'
        );
        const subjectDefinition = this.#resolveDefinition(
            subjectInstance.definitionId,
            'Subject'
        );
        const verbDefinition = this.#resolveDefinition(
            verbInstance.definitionId,
            'Verb'
        );
        const payloadDefinition = this.#resolveDefinition(
            payloadInstance.definitionId,
            'Payload'
        );

        if (subjectDefinition.kind !== WORD_KIND.ENTITY
            || !hasRole(subjectDefinition, WORD_GRAMMATICAL_ROLE.SUBJECT)
            || !subjectDefinition.subject) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.WRONG_WORD_KIND,
                'Subject slot에는 Subject Entity Word가 필요합니다.'
            );
        }
        if (verbDefinition.kind !== WORD_KIND.VERB
            || verbDefinition.id !== WORD_DEFINITION_ID.SHOOT
            || verbDefinition.actionCode !== SENTENCE_ACTION_CODE.SHOOT) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_VERB,
                'R3에서 지원하는 verb implementation이 아닙니다.'
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
        if (payloadDefinition.payload.runtimeSupport
                !== WORD_RUNTIME_SUPPORT.R3
            || payloadDefinition.id !== WORD_DEFINITION_ID.ENEMY) {
            throw new SentenceCompileError(
                SENTENCE_COMPILE_ERROR_CODE.UNSUPPORTED_PAYLOAD,
                `${payloadDefinition.id} Payload runtime은 R3 범위가 아닙니다.`
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

        const semanticKey = [
            COMPILED_ABILITY_SCHEMA_VERSION,
            this.protocol.abiVersion,
            subjectDefinition.id,
            verbDefinition.id,
            payloadDefinition.id,
            subjectSelectorCode,
            payloadDefinition.payload.payloadCode,
            payloadDefinition.payload.definitionId,
            payloadDefinition.payload.allegiancePolicy,
            targetPolicyCode,
            this.protocol.cooldownTicks,
            this.protocol.subjectBudget,
            this.protocol.generatedBodyBudget,
            this.protocol.generationLimit,
            this.protocol.previewFormulaId
        ].join('|');
        const cached = this.cache.get(semanticKey);
        if (cached) {
            return cached;
        }

        const compiledAbilityId = [
            'compiled-ability.r3',
            subjectDefinition.id,
            verbDefinition.id,
            payloadDefinition.id,
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
            payloadCode: payloadDefinition.payload.payloadCode,
            payloadDefinitionId: payloadDefinition.payload.definitionId,
            allegiancePolicy: payloadDefinition.payload.allegiancePolicy,
            targetPolicyCode,
            executionPolicy: Object.freeze({
                atomic: true,
                generatedSubjectsJoinCurrentExecution: false,
                acceptedSnapshotSurvivesSourceDeath: true
            }),
            cooldownTicks: this.protocol.cooldownTicks,
            budgets: Object.freeze({
                subjectCount: this.protocol.subjectBudget,
                generatedBodyCount: this.protocol.generatedBodyBudget,
                generation: this.protocol.generationLimit
            }),
            previewFormulaId: this.protocol.previewFormulaId,
            displaySentenceData: Object.freeze({
                subjectWordDefinitionId: subjectDefinition.id,
                verbWordDefinitionId: verbDefinition.id,
                payloadWordDefinitionId: payloadDefinition.id
            })
        });
        this.cache.set(semanticKey, compiledAbility);
        return compiledAbility;
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
