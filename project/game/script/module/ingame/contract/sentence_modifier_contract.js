import {
    ACTOR_PAYLOAD_CODE,
    SENTENCE_ACTION_CODE,
    SENTENCE_MODIFIER_CODE
} from './word_sentence_contract.js';

export const MODIFIER_PROFILE_ABI_VERSION = 1;

export const MODIFIER_APPLICATION_PHASE = Object.freeze({
    EXECUTION_CARDINALITY: 'EXECUTION_CARDINALITY'
});

export const MODIFIER_SCOPE = Object.freeze({
    ACTOR_ACTION: 'ACTOR_ACTION'
});

export const MODIFIER_STACKING_POLICY = Object.freeze({
    MULTIPLY: 'MULTIPLY'
});

export const MODIFIER_PROFILE_ID = Object.freeze({
    TWICE: 'sentence-modifier.twice.v1'
});

const UINT32_MAX = 0xffffffff;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const PROFILE_KEYS = new Set([
    'abiVersion',
    'id',
    'modifierCode',
    'applicationPhase',
    'scope',
    'stackingPolicy',
    'factorNumerator',
    'factorDenominator',
    'maxStacks',
    'priority',
    'supportedActionCodes',
    'supportedPayloadCodes',
    'conflictGroup',
    'persistentOnSpawnedActor',
    'modifierProfileFingerprint'
]);
const PROFILE_IDS = new Set(Object.values(MODIFIER_PROFILE_ID));
const MODIFIER_CODES = new Set(Object.values(SENTENCE_MODIFIER_CODE));
const APPLICATION_PHASES = new Set(Object.values(MODIFIER_APPLICATION_PHASE));
const SCOPES = new Set(Object.values(MODIFIER_SCOPE));
const STACKING_POLICIES = new Set(Object.values(MODIFIER_STACKING_POLICY));
const ACTOR_ACTION_CODES = new Set([
    SENTENCE_ACTION_CODE.SHOOT,
    SENTENCE_ACTION_CODE.THROW,
    SENTENCE_ACTION_CODE.EMIT,
    SENTENCE_ACTION_CODE.SUMMON
]);
const ACTOR_PAYLOAD_CODES = new Set([
    ACTOR_PAYLOAD_CODE.ENEMY,
    ACTOR_PAYLOAD_CODE.TOWER
]);
const PROFILE_ID_BY_MODIFIER_CODE = new Map([
    [SENTENCE_MODIFIER_CODE.TWICE, MODIFIER_PROFILE_ID.TWICE]
]);

function snapshotDataRecord(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 object여야 합니다.`);
    }
    const snapshot = Object.create(null);
    const ownKeys = Reflect.ownKeys(value);
    for (const key of ownKeys) {
        if (typeof key === 'symbol') {
            throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
        }
        if (!keys.has(key)) {
            throw new RangeError(`${label}.${key}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.get === 'function'
            || typeof descriptor.set === 'function') {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

function snapshotDenseArray(value, label, maximumLength) {
    if (!Array.isArray(value)) {
        throw new TypeError(`${label}은 배열이어야 합니다.`);
    }
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 1
        || lengthDescriptor.value > maximumLength) {
        throw new RangeError(`${label} 길이가 허용 범위를 벗어났습니다.`);
    }
    const length = lengthDescriptor.value;
    const snapshot = new Array(length);
    const observedIndexes = new Set();
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') {
            throw new RangeError(`${label}에는 symbol key를 사용할 수 없습니다.`);
        }
        if (key === 'length') continue;
        if (!/^(0|[1-9][0-9]*)$/.test(key)) {
            throw new RangeError(`${label}.${key}은 지원하지 않는 필드입니다.`);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
            throw new RangeError(`${label}.${key} index가 범위를 벗어났습니다.`);
        }
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')
            || typeof descriptor.get === 'function'
            || typeof descriptor.set === 'function') {
            throw new TypeError(`${label}[${index}]은 data property여야 합니다.`);
        }
        observedIndexes.add(index);
        snapshot[index] = descriptor.value;
    }
    if (observedIndexes.size !== length) {
        throw new RangeError(`${label}은 dense 배열이어야 합니다.`);
    }
    return snapshot;
}

function requireExact(value, expected, label) {
    if (value !== expected) {
        throw new RangeError(`${label}은 ${expected}여야 합니다.`);
    }
    return value;
}

function requireEnum(value, values, label) {
    if (typeof value !== 'string' || !values.has(value)) {
        throw new RangeError(`${label}가 알려지지 않았습니다.`);
    }
    return value;
}

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0 || value > UINT32_MAX) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function requireOverflowSafeMaximumFactor(factorNumerator, maxStacks, label) {
    if (factorNumerator === 1) return;
    let factor = 1;
    for (let stack = 0; stack < maxStacks; stack++) {
        if (factor > Math.floor(UINT32_MAX / factorNumerator)) {
            throw new RangeError(
                `${label} 최대 stack factor가 uint32를 초과합니다.`
            );
        }
        factor *= factorNumerator;
    }
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') {
        throw new TypeError(`${label}은 boolean이어야 합니다.`);
    }
    return value;
}

function normalizeConflictGroup(value, label) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 null 또는 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

function normalizeCodeSet(value, allowedValues, label) {
    const snapshot = snapshotDenseArray(value, label, allowedValues.size);
    const seen = new Set();
    for (let index = 0; index < snapshot.length; index++) {
        const code = snapshot[index];
        if (typeof code !== 'number' || !Number.isSafeInteger(code)
            || !allowedValues.has(code) || seen.has(code)) {
            throw new RangeError(
                `${label}에는 중복되거나 지원하지 않는 code가 있습니다.`
            );
        }
        seen.add(code);
    }
    return Object.freeze(Array.from(seen).sort((left, right) => left - right));
}

function hashWord(hash, value) {
    return Math.imul((hash ^ (value >>> 0)) >>> 0, FNV_PRIME) >>> 0;
}

function hashString(hash, value) {
    let next = hashWord(hash, value.length);
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        next = hashWord(next, code & 0xff);
        next = hashWord(next, code >>> 8);
    }
    return next;
}

function computeModifierProfileFingerprint(profile) {
    let hash = hashString(FNV_OFFSET_BASIS, 'sentence-modifier-profile');
    for (const value of [
        profile.abiVersion,
        profile.modifierCode,
        profile.factorNumerator,
        profile.factorDenominator,
        profile.maxStacks,
        profile.priority,
        profile.supportedActionCodes.length,
        ...profile.supportedActionCodes,
        profile.supportedPayloadCodes.length,
        ...profile.supportedPayloadCodes,
        profile.persistentOnSpawnedActor ? 1 : 0,
        profile.conflictGroup === null ? 0 : 1
    ]) {
        hash = hashWord(hash, value);
    }
    for (const value of [
        profile.id,
        profile.applicationPhase,
        profile.scope,
        profile.stackingPolicy
    ]) {
        hash = hashString(hash, value);
    }
    if (profile.conflictGroup !== null) {
        hash = hashString(hash, profile.conflictGroup);
    }
    return hash === 0 || hash === UINT32_MAX
        ? FNV_OFFSET_BASIS
        : hash >>> 0;
}

/** Data-owned execution-cardinality ModifierProfile을 typed immutable record로 고정합니다. */
export function normalizeModifierProfile(source, label = 'modifierProfile') {
    const values = snapshotDataRecord(source, PROFILE_KEYS, label);
    const abiVersion = requireExact(
        values.abiVersion,
        MODIFIER_PROFILE_ABI_VERSION,
        `${label}.abiVersion`
    );
    const id = requireEnum(values.id, PROFILE_IDS, `${label}.id`);
    const modifierCode = values.modifierCode;
    if (typeof modifierCode !== 'number'
        || !Number.isSafeInteger(modifierCode)
        || !MODIFIER_CODES.has(modifierCode)) {
        throw new RangeError(`${label}.modifierCode가 알려지지 않았습니다.`);
    }
    if (PROFILE_ID_BY_MODIFIER_CODE.get(modifierCode) !== id) {
        throw new RangeError(`${label}.id/modifierCode 조합이 일치하지 않습니다.`);
    }
    const factorDenominator = requireExact(
        requirePositiveUint32(
            values.factorDenominator,
            `${label}.factorDenominator`
        ),
        1,
        `${label}.factorDenominator`
    );
    const factorNumerator = requirePositiveUint32(
        values.factorNumerator,
        `${label}.factorNumerator`
    );
    const maxStacks = requirePositiveUint32(
        values.maxStacks,
        `${label}.maxStacks`
    );
    requireOverflowSafeMaximumFactor(factorNumerator, maxStacks, label);
    const profile = {
        abiVersion,
        id,
        modifierCode,
        applicationPhase: requireEnum(
            values.applicationPhase,
            APPLICATION_PHASES,
            `${label}.applicationPhase`
        ),
        scope: requireEnum(values.scope, SCOPES, `${label}.scope`),
        stackingPolicy: requireEnum(
            values.stackingPolicy,
            STACKING_POLICIES,
            `${label}.stackingPolicy`
        ),
        factorNumerator,
        factorDenominator,
        maxStacks,
        priority: requirePositiveUint32(values.priority, `${label}.priority`),
        supportedActionCodes: normalizeCodeSet(
            values.supportedActionCodes,
            ACTOR_ACTION_CODES,
            `${label}.supportedActionCodes`
        ),
        supportedPayloadCodes: normalizeCodeSet(
            values.supportedPayloadCodes,
            ACTOR_PAYLOAD_CODES,
            `${label}.supportedPayloadCodes`
        ),
        conflictGroup: normalizeConflictGroup(
            values.conflictGroup,
            `${label}.conflictGroup`
        ),
        persistentOnSpawnedActor: requireBoolean(
            values.persistentOnSpawnedActor,
            `${label}.persistentOnSpawnedActor`
        )
    };
    const modifierProfileFingerprint = computeModifierProfileFingerprint(profile);
    if (values.modifierProfileFingerprint !== undefined) {
        const declaredFingerprint = requirePositiveUint32(
            values.modifierProfileFingerprint,
            `${label}.modifierProfileFingerprint`
        );
        if (declaredFingerprint !== modifierProfileFingerprint) {
            throw new RangeError(
                `${label}.modifierProfileFingerprint가 semantic profile과 다릅니다.`
            );
        }
    }
    return Object.freeze({
        ...profile,
        modifierProfileFingerprint
    });
}

/** 모든 semantic ModifierProfile field를 포함하는 canonical uint32 identity입니다. */
export function modifierProfileFingerprint(source, label = 'modifierProfile') {
    return normalizeModifierProfile(source, label).modifierProfileFingerprint;
}
