import { fingerprintR8Record } from './r8_fingerprint_contract.js';

export const WORD_INVENTORY_RESULT_CODE = Object.freeze({
    ACQUIRED: 'ACQUIRED',
    UPGRADED: 'UPGRADED',
    REPLAYED: 'REPLAYED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    STALE_REVISION: 'STALE_REVISION',
    UNKNOWN_DEFINITION: 'UNKNOWN_DEFINITION',
    UNKNOWN_INSTANCE: 'UNKNOWN_INSTANCE',
    INSTANCE_ID_CONFLICT: 'INSTANCE_ID_CONFLICT',
    CONTENT_FINGERPRINT_MISMATCH: 'CONTENT_FINGERPRINT_MISMATCH',
    UPGRADE_UNAVAILABLE: 'UPGRADE_UNAVAILABLE',
    UPGRADE_PROFILE_MISMATCH: 'UPGRADE_PROFILE_MISMATCH',
    MAX_LEVEL: 'MAX_LEVEL',
    DESTROYED: 'DESTROYED'
});

const OWNED_WORD_INSTANCE_KEYS = new Set([
    'instanceId',
    'definitionId',
    'acquisitionOrdinal',
    'acquiredShopSessionOrdinal',
    'upgradeLevel',
    'upgradeProfileId',
    'contentFingerprint'
]);

function snapshotRecord(value, allowedKeys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    const snapshot = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol' || !allowedKeys.has(key)) {
            throw new RangeError(`${label}.${String(key)}은 지원하지 않는 필드입니다.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${label}.${key}은 data property여야 합니다.`);
        }
        snapshot[key] = descriptor.value;
    }
    return snapshot;
}

export function requireR8NonEmptyString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${label}은 비어 있지 않은 문자열이어야 합니다.`);
    }
    return value;
}

export function requireR8NonNegativeSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label}은 0 이상의 안전한 정수여야 합니다.`);
    }
    return value;
}

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0 || value > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function normalizeNullableString(value, label) {
    return value === null ? null : requireR8NonEmptyString(value, label);
}

function semanticWordDefinitionDescriptor(definition, label) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
        throw new TypeError(`${label}은 객체여야 합니다.`);
    }
    const descriptor = {
        id: requireR8NonEmptyString(definition.id, `${label}.id`),
        kind: requireR8NonEmptyString(definition.kind, `${label}.kind`),
        roles: Array.isArray(definition.roles)
            ? Array.from(definition.roles)
            : [],
        shopEligible: definition.shopEligible === true,
        subject: definition.subject ?? null,
        payload: definition.payload ?? null,
        modifier: definition.modifier ?? null,
        actionCode: definition.actionCode ?? null,
        payloadRequirement: definition.payloadRequirement ?? null
    };
    return descriptor;
}

/** Localized display를 제외한 immutable WordDefinition content identity입니다. */
export function fingerprintWordDefinitionContent(
    definition,
    label = 'wordDefinition'
) {
    return fingerprintR8Record(
        'word-definition-content.r8',
        semanticWordDefinitionDescriptor(definition, label),
        label
    );
}

export function normalizeOwnedWordInstance(
    source,
    label = 'ownedWordInstance'
) {
    const values = snapshotRecord(source, OWNED_WORD_INSTANCE_KEYS, label);
    const upgradeProfileId = normalizeNullableString(
        values.upgradeProfileId,
        `${label}.upgradeProfileId`
    );
    const upgradeLevel = requireR8NonNegativeSafeInteger(
        values.upgradeLevel,
        `${label}.upgradeLevel`
    );
    if (upgradeProfileId === null && upgradeLevel !== 0) {
        throw new RangeError(`${label}은 profile 없이 upgrade할 수 없습니다.`);
    }
    return Object.freeze({
        instanceId: requireR8NonEmptyString(
            values.instanceId,
            `${label}.instanceId`
        ),
        definitionId: requireR8NonEmptyString(
            values.definitionId,
            `${label}.definitionId`
        ),
        acquisitionOrdinal: requireR8NonNegativeSafeInteger(
            values.acquisitionOrdinal,
            `${label}.acquisitionOrdinal`
        ),
        acquiredShopSessionOrdinal: requireR8NonNegativeSafeInteger(
            values.acquiredShopSessionOrdinal,
            `${label}.acquiredShopSessionOrdinal`
        ),
        upgradeLevel,
        upgradeProfileId,
        contentFingerprint: requirePositiveUint32(
            values.contentFingerprint,
            `${label}.contentFingerprint`
        )
    });
}

export function fingerprintOwnedWordInstance(source, label = 'ownedWordInstance') {
    return fingerprintR8Record(
        'owned-word-instance.r8',
        normalizeOwnedWordInstance(source, label),
        label
    );
}

export function createRunOwnedWordInstanceId(
    runSessionId,
    acquisitionOrdinal,
    definitionId
) {
    return [
        'word-instance.run',
        requireR8NonEmptyString(runSessionId, 'runSessionId'),
        requireR8NonNegativeSafeInteger(
            acquisitionOrdinal,
            'acquisitionOrdinal'
        ),
        requireR8NonEmptyString(definitionId, 'definitionId')
    ].join(':');
}

export function fingerprintWordInventory(instances, label = 'wordInventory') {
    if (!Array.isArray(instances)) {
        throw new TypeError(`${label}은 배열이어야 합니다.`);
    }
    const normalized = instances.map((instance, index) => (
        normalizeOwnedWordInstance(instance, `${label}[${index}]`)
    ));
    normalized.sort((left, right) => (
        left.acquisitionOrdinal - right.acquisitionOrdinal
        || left.instanceId.localeCompare(right.instanceId)
    ));
    return fingerprintR8Record(
        'word-inventory.r8',
        normalized,
        label
    );
}

export function createStarterOwnedWordInstances(options = {}) {
    const staticInstances = options.staticInstances;
    const wordDefinitionsById = options.wordDefinitionsById;
    const upgradeProfilesByDefinitionId
        = options.upgradeProfilesByDefinitionId ?? Object.freeze({});
    if (!Array.isArray(staticInstances)
        || !wordDefinitionsById || typeof wordDefinitionsById !== 'object') {
        throw new TypeError('starter instance/catalog가 필요합니다.');
    }
    return Object.freeze(staticInstances.map((instance, acquisitionOrdinal) => {
        const definition = wordDefinitionsById[instance.definitionId];
        if (!definition || definition.id !== instance.definitionId) {
            throw new RangeError(
                `starter WordDefinition이 없습니다: ${instance.definitionId}`
            );
        }
        const profile = upgradeProfilesByDefinitionId[definition.id] ?? null;
        return normalizeOwnedWordInstance({
            instanceId: instance.id,
            definitionId: definition.id,
            acquisitionOrdinal,
            acquiredShopSessionOrdinal: 0,
            upgradeLevel: 0,
            upgradeProfileId: profile?.id ?? null,
            contentFingerprint: fingerprintWordDefinitionContent(definition)
        }, `starterOwnedWordInstances[${acquisitionOrdinal}]`);
    }));
}
