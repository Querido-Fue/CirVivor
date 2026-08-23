import {
    GAMEPLAY_ALLEGIANCE_POLICY,
    GAMEPLAY_TEAM_ID,
    normalizeGameplayAllegiancePolicy,
    normalizeGameplayTeamId
} from './gameplay_team_contract.js';

/** Localized text와 분리된 R3 stable word identity입니다. */
export const WORD_DEFINITION_ID = Object.freeze({
    TOWER: 'word.entity.tower',
    ENEMY: 'word.entity.enemy',
    SHOOT: 'verb.shoot',
    THROW: 'verb.throw',
    EMIT: 'verb.emit',
    SUMMON: 'verb.summon',
    MERGE: 'verb.merge'
});

export const WORD_KIND = Object.freeze({
    ENTITY: 'entity',
    VERB: 'verb'
});

export const WORD_GRAMMATICAL_ROLE = Object.freeze({
    SUBJECT: 'subject',
    PAYLOAD: 'payload'
});

export const WORD_RUNTIME_SUPPORT = Object.freeze({
    R3: 'r3',
    FUTURE_R5: 'future-r5',
    R5: 'r5',
    R6: 'r6'
});

/** Verb별 Payload slot 존재 조건을 고정하는 좁은 문법 계약입니다. */
export const SENTENCE_PAYLOAD_REQUIREMENT = Object.freeze({
    REQUIRED: 'REQUIRED',
    FORBIDDEN: 'FORBIDDEN'
});

/** Compiled sentence와 실제 실행 owner 연결 상태를 고정합니다. */
export const SENTENCE_RUNTIME_AVAILABILITY = Object.freeze({
    RUNTIME_AVAILABLE: 'RUNTIME_AVAILABLE',
    RUNTIME_UNAVAILABLE: 'RUNTIME_UNAVAILABLE'
});

/** GPU metadata와 공유할 append-only gameplay noun bits입니다. */
export const GAMEPLAY_NOUN_MASK = Object.freeze({
    NONE: 0,
    TOWER: 1 << 0,
    ENEMY: 1 << 1
});

/** SentenceCompiler가 emit하는 stable numeric selector vocabulary입니다. */
export const SUBJECT_SELECTOR_CODE = Object.freeze({
    TOWER: 1,
    ENEMY: 2
});

export const SENTENCE_ACTION_CODE = Object.freeze({
    SHOOT: 1,
    THROW: 2,
    EMIT: 3,
    SUMMON: 4,
    MERGE: 5
});

export const ACTOR_PAYLOAD_CODE = Object.freeze({
    ENEMY: 1,
    TOWER: 2
});

export const ABILITY_TARGET_POLICY_CODE = Object.freeze({
    SHARED_AIM_POINT: 1,
    NEAREST_TOWER_THEN_CORE_THEN_FACING: 2
});

export const ABILITY_SLOT_ID = Object.freeze({
    PRIMARY_POINTER: 'PRIMARY_POINTER',
    SHIFT: 'SHIFT',
    SPACE: 'SPACE',
    Q: 'Q',
    E: 'E'
});

export const ABILITY_SLOT_IDS = Object.freeze([
    ABILITY_SLOT_ID.PRIMARY_POINTER,
    ABILITY_SLOT_ID.SHIFT,
    ABILITY_SLOT_ID.SPACE,
    ABILITY_SLOT_ID.Q,
    ABILITY_SLOT_ID.E
]);

export const SENTENCE_RUNTIME_PHASE = Object.freeze({
    COMBAT: 'COMBAT',
    SHOP: 'SHOP',
    PAUSE: 'PAUSE'
});

export const SENTENCE_COMPILE_ERROR_CODE = Object.freeze({
    MISSING_SLOT: 'MISSING_SLOT',
    UNKNOWN_WORD_INSTANCE: 'UNKNOWN_WORD_INSTANCE',
    WRONG_WORD_KIND: 'WRONG_WORD_KIND',
    UNSUPPORTED_VERB: 'UNSUPPORTED_VERB',
    UNSUPPORTED_PAYLOAD: 'UNSUPPORTED_PAYLOAD',
    PAYLOAD_FORBIDDEN: 'PAYLOAD_FORBIDDEN',
    UNKNOWN_MODIFIER: 'UNKNOWN_MODIFIER',
    INVALID_PHASE: 'INVALID_PHASE',
    INVALID_SENTENCE: 'INVALID_SENTENCE'
});

const WORD_KIND_VALUES = new Set(Object.values(WORD_KIND));
const WORD_ROLE_VALUES = new Set(Object.values(WORD_GRAMMATICAL_ROLE));
const WORD_RUNTIME_SUPPORT_VALUES = new Set(Object.values(WORD_RUNTIME_SUPPORT));
const PAYLOAD_REQUIREMENT_VALUES = new Set(
    Object.values(SENTENCE_PAYLOAD_REQUIREMENT)
);
const SUBJECT_SELECTOR_VALUES = new Set(Object.values(SUBJECT_SELECTOR_CODE));
const ACTION_CODE_VALUES = new Set(Object.values(SENTENCE_ACTION_CODE));
const PAYLOAD_CODE_VALUES = new Set(Object.values(ACTOR_PAYLOAD_CODE));
const SLOT_ID_VALUES = new Set(ABILITY_SLOT_IDS);
const PHASE_VALUES = new Set(Object.values(SENTENCE_RUNTIME_PHASE));

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    return value;
}

function requireKnownKeys(value, keys, label) {
    const symbols = Object.getOwnPropertySymbols(value);
    if (symbols.length > 0) {
        throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
    }
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) {
            throw new RangeError(`${label}.${key}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || typeof descriptor.get === 'function'
            || typeof descriptor.set === 'function') {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
    }
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function requirePositiveMask(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32 mask여야 합니다.`);
    }
    return number >>> 0;
}

function freezeDisplayForms(display, label) {
    requireRecord(display, label);
    const locales = Object.keys(display);
    if (locales.length === 0) {
        throw new RangeError(`${label}에는 하나 이상의 locale이 필요합니다.`);
    }
    const result = Object.create(null);
    for (const locale of locales) {
        requireNonEmptyString(locale, `${label} locale`);
        const forms = requireRecord(display[locale], `${label}.${locale}`);
        requireKnownKeys(
            forms,
            new Set(['singular', 'plural']),
            `${label}.${locale}`
        );
        result[locale] = Object.freeze({
            singular: requireNonEmptyString(
                forms.singular,
                `${label}.${locale}.singular`
            ),
            plural: requireNonEmptyString(
                forms.plural,
                `${label}.${locale}.plural`
            )
        });
    }
    return Object.freeze(result);
}

function freezeSubjectDefinition(subject, label) {
    if (subject === null || subject === undefined) {
        return null;
    }
    requireRecord(subject, label);
    requireKnownKeys(
        subject,
        new Set(['selectorCode', 'nounMask', 'teamId']),
        label
    );
    const selectorCode = Number(subject.selectorCode);
    if (!Number.isSafeInteger(selectorCode)
        || !SUBJECT_SELECTOR_VALUES.has(selectorCode)) {
        throw new RangeError(`${label}.selectorCode가 알려지지 않았습니다.`);
    }
    return Object.freeze({
        selectorCode,
        nounMask: requirePositiveMask(subject.nounMask, `${label}.nounMask`),
        teamId: normalizeGameplayTeamId(subject.teamId, `${label}.teamId`)
    });
}

function freezePayloadDefinition(payload, label) {
    if (payload === null || payload === undefined) {
        return null;
    }
    requireRecord(payload, label);
    requireKnownKeys(
        payload,
        new Set([
            'payloadCode',
            'definitionId',
            'allegiancePolicy',
            'runtimeSupport',
            'previewFormulaId'
        ]),
        label
    );
    const payloadCode = Number(payload.payloadCode);
    if (!Number.isSafeInteger(payloadCode)
        || !PAYLOAD_CODE_VALUES.has(payloadCode)) {
        throw new RangeError(`${label}.payloadCode가 알려지지 않았습니다.`);
    }
    const runtimeSupport = requireNonEmptyString(
        payload.runtimeSupport,
        `${label}.runtimeSupport`
    );
    if (!WORD_RUNTIME_SUPPORT_VALUES.has(runtimeSupport)) {
        throw new RangeError(`${label}.runtimeSupport가 알려지지 않았습니다.`);
    }
    const definitionId = payload.definitionId === null
        ? null
        : requireNonEmptyString(payload.definitionId, `${label}.definitionId`);
    if ((runtimeSupport === WORD_RUNTIME_SUPPORT.R3
            || runtimeSupport === WORD_RUNTIME_SUPPORT.R5)
        && definitionId === null) {
        throw new RangeError(`${label}.definitionId는 runtime payload에 필요합니다.`);
    }
    const previewFormulaId = payload.previewFormulaId === undefined
        || payload.previewFormulaId === null
        ? null
        : requireNonEmptyString(
            payload.previewFormulaId,
            `${label}.previewFormulaId`
        );
    return Object.freeze({
        payloadCode,
        definitionId,
        allegiancePolicy: normalizeGameplayAllegiancePolicy(
            payload.allegiancePolicy,
            `${label}.allegiancePolicy`
        ),
        runtimeSupport,
        previewFormulaId
    });
}

/**
 * data-owned WordDefinition을 불변 typed record로 정규화합니다.
 * Display form은 semantic fields와 별도 보관됩니다.
 */
export function normalizeWordDefinition(definition, label = 'wordDefinition') {
    requireRecord(definition, label);
    requireKnownKeys(
        definition,
        new Set([
            'id',
            'kind',
            'roles',
            'display',
            'shopEligible',
            'subject',
            'payload',
            'actionCode',
            'payloadRequirement'
        ]),
        label
    );
    const id = requireNonEmptyString(definition.id, `${label}.id`);
    const kind = requireNonEmptyString(definition.kind, `${label}.kind`);
    if (!WORD_KIND_VALUES.has(kind)) {
        throw new RangeError(`${label}.kind가 알려지지 않았습니다.`);
    }
    if (!Array.isArray(definition.roles)) {
        throw new TypeError(`${label}.roles는 배열이어야 합니다.`);
    }
    const roles = [];
    for (let index = 0; index < definition.roles.length; index++) {
        const role = requireNonEmptyString(
            definition.roles[index],
            `${label}.roles[${index}]`
        );
        if (!WORD_ROLE_VALUES.has(role) || roles.includes(role)) {
            throw new RangeError(`${label}.roles에 중복되거나 알려지지 않은 role이 있습니다.`);
        }
        roles.push(role);
    }

    const subject = freezeSubjectDefinition(definition.subject, `${label}.subject`);
    const payload = freezePayloadDefinition(definition.payload, `${label}.payload`);
    const rawActionCode = definition.actionCode;
    const actionCode = rawActionCode === null || rawActionCode === undefined
        ? null
        : Number(rawActionCode);
    if (actionCode !== null
        && (!Number.isSafeInteger(actionCode) || !ACTION_CODE_VALUES.has(actionCode))) {
        throw new RangeError(`${label}.actionCode가 알려지지 않았습니다.`);
    }
    const rawPayloadRequirement = definition.payloadRequirement;
    const payloadRequirement = rawPayloadRequirement === null
        || rawPayloadRequirement === undefined
        ? null
        : requireNonEmptyString(
            rawPayloadRequirement,
            `${label}.payloadRequirement`
        );
    if (payloadRequirement !== null
        && !PAYLOAD_REQUIREMENT_VALUES.has(payloadRequirement)) {
        throw new RangeError(`${label}.payloadRequirement가 알려지지 않았습니다.`);
    }
    if (kind === WORD_KIND.ENTITY) {
        if (actionCode !== null || payloadRequirement !== null) {
            throw new RangeError(
                `${label} Entity Word에는 actionCode/payloadRequirement를 둘 수 없습니다.`
            );
        }
        if (roles.includes(WORD_GRAMMATICAL_ROLE.SUBJECT) !== Boolean(subject)
            || roles.includes(WORD_GRAMMATICAL_ROLE.PAYLOAD) !== Boolean(payload)) {
            throw new RangeError(`${label} role과 subject/payload 구현이 일치하지 않습니다.`);
        }
    } else if (subject || payload || roles.length !== 0 || actionCode === null
        || payloadRequirement === null) {
        throw new RangeError(`${label} Verb Word 구조가 올바르지 않습니다.`);
    }

    return Object.freeze({
        id,
        kind,
        roles: Object.freeze(roles),
        display: freezeDisplayForms(definition.display, `${label}.display`),
        shopEligible: definition.shopEligible === true,
        subject,
        payload,
        actionCode,
        payloadRequirement
    });
}

/** WordDefinition을 가리키는 stable WordInstance를 생성합니다. */
export function normalizeWordInstance(instance, label = 'wordInstance') {
    requireRecord(instance, label);
    requireKnownKeys(instance, new Set(['id', 'definitionId']), label);
    return Object.freeze({
        id: requireNonEmptyString(instance.id, `${label}.id`),
        definitionId: requireNonEmptyString(
            instance.definitionId,
            `${label}.definitionId`
        )
    });
}

/** Typed word-instance IDs만 담는 SentenceDefinition을 생성합니다. */
export function normalizeSentenceDefinition(
    sentence,
    label = 'sentenceDefinition',
    options = {}
) {
    requireRecord(sentence, label);
    requireKnownKeys(
        sentence,
        new Set([
            'id',
            'subjectWordInstanceId',
            'verbWordInstanceId',
            'payloadWordInstanceId',
            'modifierWordInstanceIds'
        ]),
        label
    );
    if (!Array.isArray(sentence.modifierWordInstanceIds)) {
        throw new TypeError(`${label}.modifierWordInstanceIds는 배열이어야 합니다.`);
    }
    const modifierWordInstanceIds = sentence.modifierWordInstanceIds.map(
        (value, index) => requireNonEmptyString(
            value,
            `${label}.modifierWordInstanceIds[${index}]`
        )
    );
    const payloadRequirement = options.payloadRequirement
        ?? SENTENCE_PAYLOAD_REQUIREMENT.REQUIRED;
    if (!PAYLOAD_REQUIREMENT_VALUES.has(payloadRequirement)) {
        throw new RangeError(
            `${label} payloadRequirement가 알려지지 않았습니다.`
        );
    }
    let payloadWordInstanceId;
    if (payloadRequirement === SENTENCE_PAYLOAD_REQUIREMENT.FORBIDDEN) {
        if (sentence.payloadWordInstanceId !== null) {
            throw new TypeError(
                `${label}.payloadWordInstanceId는 FORBIDDEN verb에서 null이어야 합니다.`
            );
        }
        payloadWordInstanceId = null;
    } else {
        payloadWordInstanceId = requireNonEmptyString(
            sentence.payloadWordInstanceId,
            `${label}.payloadWordInstanceId`
        );
    }
    return Object.freeze({
        id: requireNonEmptyString(sentence.id, `${label}.id`),
        subjectWordInstanceId: requireNonEmptyString(
            sentence.subjectWordInstanceId,
            `${label}.subjectWordInstanceId`
        ),
        verbWordInstanceId: requireNonEmptyString(
            sentence.verbWordInstanceId,
            `${label}.verbWordInstanceId`
        ),
        payloadWordInstanceId,
        modifierWordInstanceIds: Object.freeze(modifierWordInstanceIds)
    });
}

export function normalizeAbilitySlotId(value, label = 'slotId') {
    if (typeof value !== 'string' || !SLOT_ID_VALUES.has(value)) {
        throw new RangeError(`${label}가 알려진 ability slot ID가 아닙니다.`);
    }
    return value;
}

export function normalizeSentenceRuntimePhase(value, label = 'phase') {
    if (typeof value !== 'string' || !PHASE_VALUES.has(value)) {
        throw new RangeError(`${label}가 알려진 sentence runtime phase가 아닙니다.`);
    }
    return value;
}

/** R3 fixed hostile payload policy invariant를 좁은 contract에서 확인합니다. */
export function isFixedHostileEnemyPayload(wordDefinition) {
    return wordDefinition?.id === WORD_DEFINITION_ID.ENEMY
        && wordDefinition.payload?.payloadCode === ACTOR_PAYLOAD_CODE.ENEMY
        && wordDefinition.payload?.allegiancePolicy
            === GAMEPLAY_ALLEGIANCE_POLICY.FIXED_HOSTILE
        && wordDefinition.subject?.teamId === GAMEPLAY_TEAM_ID.HOSTILE;
}

/** R5 Tower Payload의 fixed Player allegiance와 canonical noun을 확인합니다. */
export function isFixedPlayerTowerPayload(wordDefinition) {
    return wordDefinition?.id === WORD_DEFINITION_ID.TOWER
        && wordDefinition.payload?.payloadCode === ACTOR_PAYLOAD_CODE.TOWER
        && wordDefinition.payload?.allegiancePolicy
            === GAMEPLAY_ALLEGIANCE_POLICY.FIXED_PLAYER
        && wordDefinition.payload?.runtimeSupport === WORD_RUNTIME_SUPPORT.R5
        && wordDefinition.subject?.teamId === GAMEPLAY_TEAM_ID.PLAYER;
}
