import {
    R7_SENTENCE_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    ACTOR_PAYLOAD_CODE,
    ABILITY_SLOT_IDS,
    SENTENCE_RUNTIME_AVAILABILITY,
    SENTENCE_RUNTIME_PHASE,
    normalizeAbilitySlotId,
    normalizeSentenceRuntimePhase
} from '../contract/word_sentence_contract.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import { SentenceCompiler } from './sentence_compiler.js';

export const ABILITY_ACTIVATION_RESULT_CODE = Object.freeze({
    REQUESTED: 'REQUESTED',
    RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
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
    RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE',
    ZERO_SUBJECT: 'ZERO_SUBJECT',
    INSUFFICIENT_SUBJECTS: 'INSUFFICIENT_SUBJECTS',
    SOURCE_CHANGED: 'SOURCE_CHANGED',
    SUBJECT_CAPACITY_REJECTED: 'SUBJECT_CAPACITY_REJECTED',
    DESTINATION_CAPACITY_REJECTED: 'DESTINATION_CAPACITY_REJECTED',
    PLACEMENT_REJECTED: 'PLACEMENT_REJECTED',
    CANCELLED: 'CANCELLED',
    PROTOCOL_REJECTED: 'PROTOCOL_REJECTED'
});

export const WORD_SYSTEM_EDITOR_COMMIT_CODE = Object.freeze({
    COMMITTED: 'COMMITTED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    WRONG_PHASE: 'WRONG_PHASE',
    PENDING_ACTIVATION: 'PENDING_ACTIVATION',
    INVALID_LOADOUT: 'INVALID_LOADOUT',
    DESTROYED: 'DESTROYED'
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

function requirePositiveSafeInteger(value, label) {
    const number = requireNonNegativeSafeInteger(value, label);
    if (number === 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
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
        compiledAbilityId: options.compiledAbilityId ?? null,
        reason: options.reason ?? null
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
            ?? R7_SENTENCE_DEFINITION_BY_ID;
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
        this.totalCancelledActivationRequests = 0;
        this.editorCommitHistoryCapacity = requirePositiveSafeInteger(
            options.editorCommitHistoryCapacity ?? 256,
            'editorCommitHistoryCapacity'
        );
        this.editorCommitHistory = new Map();
        this.editorCommitOrder = [];
        this.lastEditorCommit = null;
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

    /** SHOP editor가 typed catalog/compiler로 5개 slot을 all-or-none 교체합니다. */
    commitEditorLoadout(source = {}) {
        const transactionId = typeof source.transactionId === 'string'
            ? source.transactionId
            : '';
        if (transactionId.length === 0) {
            throw new TypeError('editor transactionId가 필요합니다.');
        }
        const boardFingerprint = requirePositiveSafeInteger(
            source.boardFingerprint,
            'editor boardFingerprint'
        );
        const compiler = source.compiler;
        if (!(compiler instanceof SentenceCompiler)) {
            throw new TypeError('editor commit에는 SentenceCompiler가 필요합니다.');
        }
        const loadout = source.loadout;
        if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) {
            throw new TypeError('editor loadout은 slot lookup 객체여야 합니다.');
        }
        for (const key of Object.keys(loadout)) {
            normalizeAbilitySlotId(key, 'editor loadout slotId');
        }
        const fingerprintSource = Object.freeze({
            transactionId,
            boardFingerprint,
            slots: Object.freeze(ABILITY_SLOT_IDS.map((slotId) => Object.freeze({
                slotId,
                sentenceDefinition: loadout[slotId] ?? null
            })))
        });
        const requestFingerprint = fingerprintR8Record(
            'word-system-editor-commit.r8',
            fingerprintSource
        );
        const known = this.editorCommitHistory.get(transactionId);
        if (known) {
            if (known.requestFingerprint === requestFingerprint) {
                return known.receipt;
            }
            return Object.freeze({
                accepted: false,
                code: WORD_SYSTEM_EDITOR_COMMIT_CODE.TRANSACTION_CONFLICT,
                transactionId,
                requestFingerprint,
                mutationCount: 0
            });
        }
        if (this.destroyed) {
            return this.#rememberEditorCommit(
                transactionId,
                requestFingerprint,
                Object.freeze({
                    accepted: false,
                    code: WORD_SYSTEM_EDITOR_COMMIT_CODE.DESTROYED,
                    transactionId,
                    mutationCount: 0
                })
            );
        }
        if (this.phase !== SENTENCE_RUNTIME_PHASE.SHOP) {
            return this.#rememberEditorCommit(
                transactionId,
                requestFingerprint,
                Object.freeze({
                    accepted: false,
                    code: WORD_SYSTEM_EDITOR_COMMIT_CODE.WRONG_PHASE,
                    transactionId,
                    phase: this.phase,
                    mutationCount: 0
                })
            );
        }
        if (this.pendingActivationRequests.length !== 0) {
            return this.#rememberEditorCommit(
                transactionId,
                requestFingerprint,
                Object.freeze({
                    accepted: false,
                    code: WORD_SYSTEM_EDITOR_COMMIT_CODE.PENDING_ACTIVATION,
                    transactionId,
                    pendingActivationCount:
                        this.pendingActivationRequests.length,
                    mutationCount: 0
                })
            );
        }
        const staged = [];
        for (const slotId of ABILITY_SLOT_IDS) {
            const sentenceDefinition = loadout[slotId] ?? null;
            const compileResult = sentenceDefinition
                ? compiler.tryCompile(sentenceDefinition)
                : createEmptyCompileResult();
            if (sentenceDefinition && compileResult.valid !== true) {
                return this.#rememberEditorCommit(
                    transactionId,
                    requestFingerprint,
                    Object.freeze({
                        accepted: false,
                        code: WORD_SYSTEM_EDITOR_COMMIT_CODE.INVALID_LOADOUT,
                        transactionId,
                        slotId,
                        compileCode: compileResult.code,
                        mutationCount: 0
                    })
                );
            }
            staged.push(Object.freeze({
                slotId,
                sentenceDefinition,
                compileResult
            }));
        }
        for (const entry of staged) {
            const slot = this.slots.get(entry.slotId);
            slot.sentenceDefinition = entry.sentenceDefinition;
            slot.compileResult = entry.compileResult;
        }
        const receipt = Object.freeze({
            accepted: true,
            code: WORD_SYSTEM_EDITOR_COMMIT_CODE.COMMITTED,
            transactionId,
            requestFingerprint,
            boardFingerprint,
            compiledAbilityIds: Object.freeze(Object.fromEntries(
                staged.map((entry) => [
                    entry.slotId,
                    entry.compileResult.compiledAbility?.compiledAbilityId
                        ?? null
                ])
            )),
            cooldowns: Object.freeze(Object.fromEntries(
                ABILITY_SLOT_IDS.map((slotId) => [
                    slotId,
                    this.slots.get(slotId).nextEligibleFixedTick
                ])
            )),
            mutationCount: staged.length
        });
        return this.#rememberEditorCommit(
            transactionId,
            requestFingerprint,
            receipt
        );
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
        const compiledAbility = slot.compileResult.compiledAbility;
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
        if (compiledAbility.runtimeAvailability
            === SENTENCE_RUNTIME_AVAILABILITY.RUNTIME_UNAVAILABLE) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.RUNTIME_UNAVAILABLE,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId: compiledAbility.compiledAbilityId,
                    reason: SENTENCE_RUNTIME_AVAILABILITY.RUNTIME_UNAVAILABLE
                }
            ));
        }
        // Preview는 일반 runtime 거절의 권위가 아니지만, materialization
        // capability 자체가 없다는 명시적 gate는 GPU snapshot ingress 전에
        // fail-closed 처리합니다. 이 결과는 cooldown이나 execution ordinal을
        // 소비하지 않는 정상 결과입니다.
        let ingressPreview = null;
        if (this.runtimePreviewProvider) {
            try {
                ingressPreview = this.runtimePreviewProvider.estimate(
                    compiledAbility,
                    Object.freeze({
                        slotId: normalizedSlotId,
                        compiledAbilityId: compiledAbility.compiledAbilityId,
                        cooldown: Object.freeze({
                            remainingTicks: Math.max(
                                0,
                                slot.nextEligibleFixedTick - this.currentFixedTick
                            ),
                            nextEligibleFixedTick: slot.nextEligibleFixedTick
                        })
                    })
                );
            } catch {
                ingressPreview = null;
            }
        }
        const towerPayloadRequiresRuntimeGate
            = compiledAbility.payloadCode === ACTOR_PAYLOAD_CODE.TOWER;
        const runtimeAvailabilityUnknown = towerPayloadRequiresRuntimeGate
            && typeof ingressPreview?.executionEnabled !== 'boolean';
        const runtimeExplicitlyUnavailable
            = ingressPreview?.executionEnabled === false
                && [
                    'RUNTIME_UNAVAILABLE',
                    'TOWER_CREATION_PREVIEW_UNAVAILABLE'
                ].includes(ingressPreview.executionDisabledReason);
        if (runtimeAvailabilityUnknown || runtimeExplicitlyUnavailable) {
            return this.#rememberActivationResult(freezeActivationResult(
                ABILITY_ACTIVATION_RESULT_CODE.RUNTIME_UNAVAILABLE,
                {
                    slotId: normalizedSlotId,
                    targetFixedTick,
                    compiledAbilityId: compiledAbility.compiledAbilityId,
                    reason: ingressPreview?.executionDisabledReason
                        ?? 'RUNTIME_UNAVAILABLE'
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

    /** GPU-world 교체/terminal 경계에서 아직 ordinal을 받지 않은 요청을 폐기합니다. */
    cancelPendingActivationRequests(reason = 'cancelled') {
        if (this.destroyed) {
            return Object.freeze({ cancelledCount: 0, reason: 'destroyed' });
        }
        const cancelledCount = this.pendingActivationRequests.length;
        this.pendingActivationRequests.length = 0;
        this.pendingActivationKeys.clear();
        this.totalCancelledActivationRequests += cancelledCount;
        return Object.freeze({
            cancelledCount,
            reason: String(reason || 'cancelled')
        });
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
        const modifierStackCount = slot.compileResult.compiledAbility
            ?.modifierSet?.canonicalEntries?.reduce((total, entry) => (
                total + requirePositiveSafeInteger(
                    entry.stackCount,
                    'modifier stackCount'
                )
            ), 0) ?? 0;
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
            copiesPerSubject: requirePositiveSafeInteger(
                source.copiesPerSubject ?? 1,
                'copiesPerSubject'
            ),
            modifierSetFingerprint: requireNonNegativeSafeInteger(
                source.modifierSetFingerprint ?? 0,
                'modifierSetFingerprint'
            ),
            modifierStackCount,
            effectiveGeneratedCount: requireNonNegativeSafeInteger(
                source.generatedCount ?? 0,
                'effectiveGeneratedCount'
            ),
            lastModifierOutcome: code,
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
        let preview = null;
        if (compiledAbility && this.runtimePreviewProvider) {
            try {
                preview = this.runtimePreviewProvider.estimate(
                    compiledAbility,
                    base
                );
            } catch {
                // Preview는 관측용이며 HUD/game loop를 중단시킬 수 없습니다.
                // Tower payload activation은 null preview를 unavailable로 처리합니다.
                preview = null;
            }
        }
        return Object.freeze({
            ...base,
            preview
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
            totalCancelledActivationRequests:
                this.totalCancelledActivationRequests,
            lastActivationResult: this.lastActivationResult,
            lastExecutionOutcome: this.lastExecutionOutcome,
            rememberedEditorCommitCount: this.editorCommitHistory.size,
            lastEditorCommit: this.lastEditorCommit
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
        this.editorCommitHistory.clear();
        this.editorCommitOrder.length = 0;
        this.runtimePreviewProvider = null;
        this.lastActivationResult = null;
        this.lastExecutionOutcome = null;
    }

    #rememberActivationResult(result) {
        this.lastActivationResult = result;
        return result;
    }

    #rememberEditorCommit(transactionId, requestFingerprint, receipt) {
        if (!this.editorCommitHistory.has(transactionId)) {
            this.editorCommitHistory.set(transactionId, Object.freeze({
                requestFingerprint,
                receipt
            }));
            this.editorCommitOrder.push(transactionId);
        }
        while (this.editorCommitOrder.length
            > this.editorCommitHistoryCapacity) {
            const retired = this.editorCommitOrder.shift();
            this.editorCommitHistory.delete(retired);
        }
        this.lastEditorCommit = receipt;
        return receipt;
    }
}
