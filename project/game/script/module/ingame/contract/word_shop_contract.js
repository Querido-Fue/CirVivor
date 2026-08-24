import { fingerprintR8Record } from './r8_fingerprint_contract.js';
import {
    requireR8NonEmptyString,
    requireR8NonNegativeSafeInteger
} from './word_inventory_contract.js';

export const WORD_SHOP_OFFER_COUNT = 5;

export const WORD_REPEAT_ACQUISITION_POLICY = Object.freeze({
    UNIQUE: 'UNIQUE',
    STACKABLE_INSTANCE: 'STACKABLE_INSTANCE'
});

const WORD_REPEAT_ACQUISITION_POLICIES = new Set(
    Object.values(WORD_REPEAT_ACQUISITION_POLICY)
);

export const WORD_SHOP_RESULT_CODE = Object.freeze({
    OPEN_PREFLIGHT_READY: 'OPEN_PREFLIGHT_READY',
    OPENED: 'OPENED',
    PURCHASED: 'PURCHASED',
    REROLLED: 'REROLLED',
    UPGRADED: 'UPGRADED',
    CLOSED: 'CLOSED',
    REPLAYED: 'REPLAYED',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    INSUFFICIENT_OFFER_POOL: 'INSUFFICIENT_OFFER_POOL',
    INSUFFICIENT_MEANINGFUL_OFFER_POOL:
        'INSUFFICIENT_MEANINGFUL_OFFER_POOL',
    SHOP_NOT_CONFIGURED: 'SHOP_NOT_CONFIGURED',
    RUNTIME_IDENTITY_MISMATCH: 'RUNTIME_IDENTITY_MISMATCH',
    UNKNOWN_OFFER: 'UNKNOWN_OFFER',
    SOLD_OFFER: 'SOLD_OFFER',
    STALE_ROW: 'STALE_ROW',
    STALE_SESSION_ORDINAL: 'STALE_SESSION_ORDINAL',
    STALE_COMMERCE_REVISION: 'STALE_COMMERCE_REVISION',
    STALE_INVENTORY_REVISION: 'STALE_INVENTORY_REVISION',
    COMMERCE_REJECTED: 'COMMERCE_REJECTED',
    WRONG_PHASE: 'WRONG_PHASE',
    PENDING_COMMERCE: 'PENDING_COMMERCE',
    DESTROYED: 'DESTROYED'
});

const CATALOG_KEYS = new Set([
    'definitionId',
    'basePurchaseCost',
    'offerWeight',
    'rarityId',
    'upgradeProfileId',
    'unlockKey',
    'shopEligible',
    'repeatAcquisitionPolicy'
]);
const OFFER_KEYS = new Set([
    'offerOrdinal',
    'offerId',
    'definitionId',
    'price',
    'rarityId',
    'upgradeProfileId',
    'sold'
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

function requirePositiveUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value <= 0 || value > 0xffffffff) {
        throw new RangeError(`${label}은 양의 uint32여야 합니다.`);
    }
    return value >>> 0;
}

function nullableString(value, label) {
    return value === null ? null : requireR8NonEmptyString(value, label);
}

export function normalizeWordShopCatalogRecord(
    source,
    label = 'wordShopCatalogRecord'
) {
    const values = snapshotRecord(source, CATALOG_KEYS, label);
    const repeatAcquisitionPolicy = values.repeatAcquisitionPolicy;
    if (!WORD_REPEAT_ACQUISITION_POLICIES.has(repeatAcquisitionPolicy)) {
        throw new RangeError(
            `${label}.repeatAcquisitionPolicy가 알려지지 않았습니다.`
        );
    }
    return Object.freeze({
        definitionId: requireR8NonEmptyString(
            values.definitionId,
            `${label}.definitionId`
        ),
        basePurchaseCost: requireR8NonNegativeSafeInteger(
            values.basePurchaseCost,
            `${label}.basePurchaseCost`
        ),
        offerWeight: requirePositiveUint32(
            values.offerWeight,
            `${label}.offerWeight`
        ),
        rarityId: requireR8NonEmptyString(
            values.rarityId,
            `${label}.rarityId`
        ),
        upgradeProfileId: nullableString(
            values.upgradeProfileId,
            `${label}.upgradeProfileId`
        ),
        unlockKey: requireR8NonEmptyString(
            values.unlockKey,
            `${label}.unlockKey`
        ),
        shopEligible: values.shopEligible === true,
        repeatAcquisitionPolicy
    });
}

export function normalizeWordShopCatalog(source, label = 'wordShopCatalog') {
    if (!Array.isArray(source) || source.length === 0) {
        throw new RangeError(`${label}은 비어 있지 않은 배열이어야 합니다.`);
    }
    const definitionIds = new Set();
    const records = source.map((record, index) => {
        const normalized = normalizeWordShopCatalogRecord(
            record,
            `${label}[${index}]`
        );
        if (definitionIds.has(normalized.definitionId)) {
            throw new RangeError(`${label} definitionId가 중복됩니다.`);
        }
        definitionIds.add(normalized.definitionId);
        return normalized;
    });
    records.sort((left, right) => (
        left.definitionId.localeCompare(right.definitionId)
    ));
    return Object.freeze(records);
}

export function fingerprintWordShopCatalog(source) {
    return fingerprintR8Record(
        'word-shop-catalog.r8',
        normalizeWordShopCatalog(source),
        'wordShopCatalog'
    );
}

export function normalizeUnlockedWordPool(
    definitionIds,
    catalogByDefinitionId,
    label = 'unlockedWordDefinitionIds'
) {
    if (!Array.isArray(definitionIds)) {
        throw new TypeError(`${label}은 배열이어야 합니다.`);
    }
    const unique = new Set();
    for (let index = 0; index < definitionIds.length; index++) {
        const definitionId = requireR8NonEmptyString(
            definitionIds[index],
            `${label}[${index}]`
        );
        const record = catalogByDefinitionId?.[definitionId];
        if (!record || record.definitionId !== definitionId
            || record.shopEligible !== true) {
            throw new RangeError(`${label}에 shop-eligible definition이 없습니다: ${definitionId}`);
        }
        unique.add(definitionId);
    }
    return Object.freeze(Array.from(unique).sort());
}

export function fingerprintUnlockedWordPool(definitionIds) {
    return fingerprintR8Record(
        'word-shop-unlocked-pool.r8',
        Array.from(definitionIds).sort(),
        'unlockedWordDefinitionIds'
    );
}

export function createWordShopOfferId({
    shopSessionOrdinal,
    rerollOrdinal,
    offerOrdinal,
    definitionId
}) {
    return [
        'word-offer.r8',
        requireR8NonNegativeSafeInteger(
            shopSessionOrdinal,
            'shopSessionOrdinal'
        ),
        requireR8NonNegativeSafeInteger(rerollOrdinal, 'rerollOrdinal'),
        requireR8NonNegativeSafeInteger(offerOrdinal, 'offerOrdinal'),
        requireR8NonEmptyString(definitionId, 'definitionId')
    ].join(':');
}

export function normalizeWordShopOffer(source, label = 'wordShopOffer') {
    const values = snapshotRecord(source, OFFER_KEYS, label);
    return Object.freeze({
        offerOrdinal: requireR8NonNegativeSafeInteger(
            values.offerOrdinal,
            `${label}.offerOrdinal`
        ),
        offerId: requireR8NonEmptyString(values.offerId, `${label}.offerId`),
        definitionId: requireR8NonEmptyString(
            values.definitionId,
            `${label}.definitionId`
        ),
        price: requireR8NonNegativeSafeInteger(values.price, `${label}.price`),
        rarityId: requireR8NonEmptyString(
            values.rarityId,
            `${label}.rarityId`
        ),
        upgradeProfileId: nullableString(
            values.upgradeProfileId,
            `${label}.upgradeProfileId`
        ),
        sold: values.sold === true
    });
}

export function fingerprintWordShopRow(source) {
    const offers = source.offers;
    if (!Array.isArray(offers)) {
        throw new TypeError('Shop row offers가 필요합니다.');
    }
    return fingerprintR8Record('word-shop-row.r8', {
        runSeed: requirePositiveUint32(source.runSeed, 'runSeed'),
        shopSessionOrdinal: requireR8NonNegativeSafeInteger(
            source.shopSessionOrdinal,
            'shopSessionOrdinal'
        ),
        rerollOrdinal: requireR8NonNegativeSafeInteger(
            source.rerollOrdinal,
            'rerollOrdinal'
        ),
        unlockedPoolFingerprint: requirePositiveUint32(
            source.unlockedPoolFingerprint,
            'unlockedPoolFingerprint'
        ),
        catalogFingerprint: requirePositiveUint32(
            source.catalogFingerprint,
            'catalogFingerprint'
        ),
        offers: offers.map((offer, index) => (
            normalizeWordShopOffer(offer, `offers[${index}]`)
        ))
    });
}
