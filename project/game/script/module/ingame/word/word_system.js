import {
    R5_SENTENCE_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    ABILITY_SLOT_IDS,
    SENTENCE_RUNTIME_PHASE,
    normalizeAbilitySlotId,
    normalizeSentenceRuntimePhase
} from '../contract/word_sentence_contract.js';
import { SentenceCompiler } from './sentence_compiler.js';

export const ABILITY_ACTIVATION_RESULT_CODE = Object.freeze({
    REQUESTED: 'REQUESTED',
    EMPTY_SLOT: 'EMPTY_SLOT',
    INVALID_SENTENCE: 'INVALID_SENTENCE',
    WRONG_PHASE: 'WRONG_PHASE',
    COOLDOWN: 'COOLDOWN',
    DUPLICATE: 'DUPLICATE',
    QUEUE_CAPACITY: 'QUEUE_CAPACITY',
    DESTROYED: 'DESTROYED'
});

export const ABILITY_EXECUTION_OUTCOME_CODE = Object.freeze({
    COMPLETED: 'COMPLETED',
    ZERO_SUBJECT: 'ZERO_SUBJECT',
    SUBJECT_CAPACITY_REJECTED: 'SUBJECT_CAPACITY_REJECTED',
    DESTINATION_CAPACITY_REJECTED: 'DESTINATION_CAPACITY_REJECTED',
    PLACEMENT_REJECTED: 'PLACEMENT_REJECTED',
    CANCELLED: 'CANCELLED',
    PROTOCOL_REJECTED: 'PROTOCOL_REJECTED'
});

const EXECUTION_OUTCOME_CODES = new Set(
    Object.values(ABILITY_EXECUTION_OUTCOME_CODE)
);

const MAX_PENDING_ACTIVATION_REQUESTS = 32;

function requireNonNegativeSafeInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return number;
}

function freezeActivationResult(code, options = {}) {
    return Object.freeze({
        accepted: code === ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
        code,
        slotId: options.slotId ?? null,
        targetFixedTick: options.targetFixedTick ?? null,
        abilityRequestId: options.abilityRequestId ?? null,
        compiledAbilityId: options.compiledAbilityId ?? null
    });
}

function createEmptyCompileResult() {
    return Object.freeze({
        valid: false,
        code: 'EMPTY_SLOT',
        message: null,
        compiledAbility: null
    });
}

/**
 * CPU run-domain Word/Sentence state입니다. GPU endpoint lifecycle을 소유하지 않고
 * semantic activation request와 immutable views만 제공합니다.
 */
export class WordSystem {
    constructor(options = {}) {
        this.compiler = options.compiler instanceof SentenceCompiler
            ? options.compiler
            : new SentenceCompiler(options.compilerOptions);
        this.sentenceDefinitionsById = options.sentenceDefinitionsById
            ?? R5_SENTENCE_DEFINITION_BY_ID;
        this.slots = new Map();
        for (const slotId of ABILITY_SLOT_IDS) {
            this.slots.set(slotId, {
                slotId,
                sentenceDefinition: null,
                compileResult: createEmptyCompileResult(),
                nextEligibleFixedTick: 0
            });
        }
        this.phase = SENTENCE_RUNTIME_PHASE.COMBAT;
        this.currentFixedTick = 0;
        this.nextRequestSequence = 0;
        this.pendingActivationRequests = [];
        this.pendingActivationKeys = new Set();
        this.lastActivationResult = null;
        this.lastExecutionOutcome = null;
        this.runtimePreviewProvider = null;
        this.destroyed = false;
        this.replaceLoadout(options.loadout ?? {});
    }

    /** ID 또는 typed SentenceDefinition으로 5개 slot loadout을 원자 교체합니다. */
    replaceLoadout(loadout = {}) {
        if (this.destroyed) {
            return false;
        }
        if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) {
            throw new TypeError('ability loadout은 slot lookup 객체여야 합니다.');
        }
        for (const key of Object.keys(loadout)) {
            normalizeAbilitySlotId(key, 'loadout slotId');
        }
        const staged = [];
        for (const slotId of ABILITY_SLOT_IDS) {
            const source = loadout[slotId] ?? null;
            const sentenceDefinition = typeof source === 'string'
                ? this.sentenceDefinitionsById[source] ?? null
                : source;
            if (typeof source === 'string' && !sentenceDefinition) {
                throw new RangeError(`알려지지 않은 SentenceDefinition ID입니다: ${source}`);
            }
            staged.push({
                slotId,
                sentenceDefinition,
                compileResult: sentenceDefinition
                    ? this.compiler.tryCompile(sentenceDefinition)
                    : createEmptyCompileResult()
            });
        }
        this.pendingActivationRequests.length = 0;
        this.pendingActivationKeys.clear();
        for (const entry of staged) {
            const slot = this.slots.get(entry.slotId);
            slot.sentenceDefinition = entry.sentenceDefinition;
            slot.compileResult = entry.compileResult;
            slot.nextEligibleFixedTick = 0;
        }
        return true;
    }

    /** 단일 slot을 headless/editor dependency에서 교체합니다. */
    setSlotSentence(slotId, sentenceDefinition = null) {
        const normalizedSlotId = normalizeAbilitySlotId(slotId);
        const slot = this.slots.get(normalizedSlotId);
        if (this.destroyed) {
            return null;
        }
        slot.sentenceDefinition = sentenceDefinition;
        slot.compileResult = sentenceDefinition
            ? this.compiler.tryCompile(sentenceDefinition)
            : createEmptyCompileResult();
        slot.nextEligibleFixedTick = 0;
        return this.getSlotView(normalizedSlotId);
    }

    setRuntimePhase(phase) {
        if (this.destroyed) {
            return false;
        }
        this.phase = normalizeSentenceRuntimePhase(phase);
        return true;
    }

    /** GameObject runtime과 같은 selector/capacity 계산을 사용하는 preview port입니다. */
    bindRuntimePreviewProvider(provider = null) {
        if (this.destroyed) return false;
        if (provider !== null && typeof provider?.estimate !== 'function') {
            throw new TypeError('runtime preview provider는 estimate()를 제공해야 합니다.');
        }
        this.runtimePreviewProvider = provider;
        return true;
    }

    /** 재시도 가능한 동일 proposed fixed tick을 포함해 현재 activation 경계를 고정합니다. */
    beginFixedTick(fixedTick) {
        if (this.destroyed) {
            return false;
        }
        const tick = requireNonNegativeSafeInteger(fixedTick, 'fixedTick');
        if (tick < this.currentFixedTick) {
            throw new RangeError('WordSystem fixed tick은 뒤로 이동할 수 없습니다.');
        }
        this.currentFixedTick = tick;
        return true;
    }

    /**
     * Slot controller가 호출하는 semantic request seam입니다. Turn 1은 이 request를
     * GPU owner는 compiled actor-action/payload 지원 상태에 따라 후속 실행을 확정합니다.
     */
    requestSlotActivation(slotId, options = {}) {
        let normalizedSlotId;
        try {
            normalizedSlotId = normalizeAbilitySlotId(slotId);
        } catch {
            return freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.INVALID_SENTENCE
            );
        }
        const slot = this.slots.get(normalizedSlotId);
        const targetFixedTick = options.targetFixedTick === undefined
            ? this.currentFixedTick
            : requireNonNegativeSafeInteger(
                options.targetFixedTick,
                'targetFixedTick'
            );
        if (this.destroyed) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.DESTROYED,
                { slotId: normalizedSlotId, targetFixedTick }
            ));
        }
        if (!slot.sentenceDefinition) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.EMPTY_SLOT,
                { slotId: normalizedSlotId, targetFixedTick }
            ));
        }
        if (slot.compileResult.valid !== true
            || !slot.compileResult.compiledAbility) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.INVALID_SENTENCE,
                { slotId: normalizedSlotId, targetFixedTick }
            ));
        }
        if (this.phase !== SENTENCE_RUNTIME_PHASE.COMBAT) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.WRONG_PHASE,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId:
                        slot.compileResult.compiledAbility.compiledAbilityId
                }
            ));
        }
        if (targetFixedTick < slot.nextEligibleFixedTick) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.COOLDOWN,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId:
                        slot.compileResult.compiledAbility.compiledAbilityId
                }
            ));
        }
        const activationKey = `${normalizedSlotId}:${targetFixedTick}`;
        if (this.pendingActivationKeys.has(activationKey)) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.DUPLICATE,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId:
                        slot.compileResult.compiledAbility.compiledAbilityId
                }
            ));
        }
        if (this.pendingActivationRequests.length
            >= MAX_PENDING_ACTIVATION_REQUESTS) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.QUEUE_CAPACITY,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId:
                        slot.compileResult.compiledAbility.compiledAbilityId
                }
            ));
        }

        const requestSequence = this.nextRequestSequence++;
        const compiledAbility = slot.compileResult.compiledAbility;
        const rawAimX = Number(options.aimViewport?.x ?? 0);
        const rawAimY = Number(options.aimViewport?.y ?? 0);
        const aimViewport = Object.freeze({
            x: Number.isFinite(rawAimX) ? rawAimX : 0,
            y: Number.isFinite(rawAimY) ? rawAimY : 0
        });
        const abilityRequestId = [
            'ability-request.r3',
            targetFixedTick,
            normalizedSlotId,
            requestSequence
        ].join(':');
        const request = Object.freeze({
            abilityRequestId,
            requestSequence,
            slotId: normalizedSlotId,
            targetFixedTick,
            aimViewport,
            compiledAbility
        });
        this.pendingActivationKeys.add(activationKey);
        this.pendingActivationRequests.push(request);
        return this.#rememberActivationResult(freezeActivationResult(
            ABILITY_ACTIVATION_RESULT_CODE.REQUESTED,
            {
                slotId: normalizedSlotId,
                targetFixedTick,
                abilityRequestId,
                compiledAbilityId: compiledAbility.compiledAbilityId
            }
        ));
    }

    /** Future AbilityRuntime owner가 semantic requests를 ordered batch로 가져갑니다. */
    drainActivationRequests() {
        if (this.pendingActivationRequests.length === 0) {
            return Object.freeze([]);
        }
        const drained = Object.freeze(this.pendingActivationRequests.slice());
        this.pendingActivationRequests.length = 0;
        this.pendingActivationKeys.clear();
        return drained;
    }

    /** AbilityRuntime이 final outcome과 cooldown 소비 여부를 확정합니다. */
    recordExecutionOutcome(source = {}) {
        if (this.destroyed) return false;
        const slotId = normalizeAbilitySlotId(source.slotId);
        const code = String(source.code ?? '');
        if (!EXECUTION_OUTCOME_CODES.has(code)) {
            throw new RangeError('ability execution outcome code가 알려지 않았습니다.');
        }
        const executionOrdinal = requireNonNegativeSafeInteger(
            source.executionOrdinal,
            'executionOrdinal'
        );
        const completedFixedTick = requireNonNegativeSafeInteger(
            source.completedFixedTick,
            'completedFixedTick'
        );
        const slot = this.slots.get(slotId);
        const cooldownConsumed = source.cooldownConsumed === true;
        if (cooldownConsumed) {
            slot.nextEligibleFixedTick = Math.max(
                slot.nextEligibleFixedTick,
                completedFixedTick
                    + (slot.compileResult.compiledAbility?.cooldownTicks ?? 0)
            );
        }
        this.lastExecutionOutcome = Object.freeze({
            abilityRequestId: source.abilityRequestId ?? null,
            executionId: source.executionId ?? null,
            executionOrdinal,
            slotId,
            code,
            completedFixedTick,
            subjectCount: requireNonNegativeSafeInteger(
                source.subjectCount ?? 0,
                'subjectCount'
            ),
            generatedCount: requireNonNegativeSafeInteger(
                source.generatedCount ?? 0,
                'generatedCount'
            ),
            cooldownConsumed
        });
        return true;
    }

    hasSlotAssignment(slotId) {
        const slot = this.slots.get(normalizeAbilitySlotId(slotId));
        return Boolean(slot?.sentenceDefinition);
    }

    hasCompiledAbility(slotId) {
        const slot = this.slots.get(normalizeAbilitySlotId(slotId));
        return slot?.compileResult?.valid === true
            && Boolean(slot.compileResult.compiledAbility);
    }

    getSlotView(slotId) {
        const slot = this.slots.get(normalizeAbilitySlotId(slotId));
        const compiledAbility = slot.compileResult.compiledAbility;
        const remainingTicks = Math.max(
            0,
            slot.nextEligibleFixedTick - this.currentFixedTick
        );
        const base = {
            slotId: slot.slotId,
            compiledAbilityId: compiledAbility?.compiledAbilityId ?? null,
            displaySentenceData:
                compiledAbility?.displaySentenceData ?? null,
            cooldown: Object.freeze({
                remainingTicks,
                nextEligibleFixedTick: slot.nextEligibleFixedTick
            }),
            structuralValidity: Object.freeze({
                valid: slot.compileResult.valid === true,
                code: slot.compileResult.code,
                message: slot.compileResult.message
            })
        };
        return Object.freeze({
            ...base,
            preview: compiledAbility && this.runtimePreviewProvider
                ? this.runtimePreviewProvider.estimate(
                    compiledAbility,
                    base
                )
                : null
        });
    }

    getSlotViews() {
        return Object.freeze(ABILITY_SLOT_IDS.map(
            (slotId) => this.getSlotView(slotId)
        ));
    }

    getStatusView() {
        return Object.freeze({
            phase: this.phase,
            slots: this.getSlotViews(),
            pendingActivationCount: this.pendingActivationRequests.length,
            lastActivationResult: this.lastActivationResult,
            lastExecutionOutcome: this.lastExecutionOutcome
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.pendingActivationRequests.length = 0;
        this.pendingActivationKeys.clear();
        this.slots.clear();
        this.runtimePreviewProvider = null;
        this.lastActivationResult = null;
        this.lastExecutionOutcome = null;
    }

    #rememberActivationResult(result) {
        this.lastActivationResult = result;
        return result;
    }
}
