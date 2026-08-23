import {
    R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
    R8_WORD_SHOP_BALANCE,
    R8_WORD_SHOP_CATALOG
} from 'data/word/r8_word_shop_catalog_data.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    RUN_COMMERCE_RESULT_CODE
} from '../state/run_commerce_state.js';
import {
    WORD_SHOP_OFFER_COUNT,
    WORD_SHOP_RESULT_CODE,
    createWordShopOfferId,
    fingerprintUnlockedWordPool,
    fingerprintWordShopCatalog,
    fingerprintWordShopRow,
    normalizeUnlockedWordPool,
    normalizeWordShopCatalog,
    normalizeWordShopOffer
} from '../contract/word_shop_contract.js';
import {
    requireR8NonEmptyString,
    requireR8NonNegativeSafeInteger
} from '../contract/word_inventory_contract.js';
import {
    DeterministicShopRng,
    createDeterministicShopSeed,
    selectWeightedWithoutReplacement
} from './deterministic_shop_rng.js';

const DEFAULT_HISTORY_CAPACITY = 4096;

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
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

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

/** Headless deterministic five-offer ShopSession입니다. */
export class WordShopSession {
    constructor(options = {}) {
        const commerce = options.commerceState;
        for (const method of [
            'purchase',
            'upgradeOwnedWord',
            'spend',
            'getBalance',
            'getRevision',
            'getInventorySnapshot',
            'getStatus'
        ]) {
            if (typeof commerce?.[method] !== 'function') {
                throw new TypeError(`WordShopSession commerce.${method}()가 필요합니다.`);
            }
        }
        this.commerce = commerce;
        this.runSeed = requirePositiveUint32(
            options.runSeed ?? R8_WORD_SHOP_BALANCE.QA_RUN_SEED,
            'runSeed'
        );
        this.catalog = normalizeWordShopCatalog(
            options.catalog ?? R8_WORD_SHOP_CATALOG
        );
        this.catalogByDefinitionId = Object.freeze(Object.fromEntries(
            this.catalog.map((record) => [record.definitionId, record])
        ));
        this.catalogFingerprint = fingerprintWordShopCatalog(this.catalog);
        this.defaultUnlockedDefinitionIds = normalizeUnlockedWordPool(
            options.unlockedWordDefinitionIds
                ?? R8_ALL_UNLOCKED_WORD_DEFINITION_IDS,
            this.catalogByDefinitionId
        );
        this.rerollCost = requireR8NonNegativeSafeInteger(
            options.rerollCost ?? R8_WORD_SHOP_BALANCE.REROLL_COST,
            'rerollCost'
        );
        this.offerCount = requirePositiveSafeInteger(
            options.offerCount ?? WORD_SHOP_OFFER_COUNT,
            'offerCount'
        );
        if (this.offerCount !== WORD_SHOP_OFFER_COUNT) {
            throw new RangeError(`R8 Shop offerCount는 ${WORD_SHOP_OFFER_COUNT}여야 합니다.`);
        }
        this.historyCapacity = requirePositiveSafeInteger(
            options.historyCapacity ?? DEFAULT_HISTORY_CAPACITY,
            'historyCapacity'
        );
        this.history = new Map();
        this.historyOrder = [];
        this.active = false;
        this.lastShopSessionOrdinal = 0;
        this.shopSessionOrdinal = 0;
        this.rerollOrdinal = 0;
        this.unlockedDefinitionIds = Object.freeze([]);
        this.unlockedPoolFingerprint = 0;
        this.row = null;
        this.openCount = 0;
        this.purchaseCount = 0;
        this.rerollCount = 0;
        this.upgradeCount = 0;
        this.closeCount = 0;
        this.replayCount = 0;
        this.conflictCount = 0;
        this.lastReceipt = null;
        this.destroyed = false;
    }

    open(source = {}) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'shop open transactionId'
        );
        const shopSessionOrdinal = requireR8NonNegativeSafeInteger(
            source.shopSessionOrdinal,
            'shopSessionOrdinal'
        );
        const expectedCommerceRevision = requireR8NonNegativeSafeInteger(
            source.expectedCommerceRevision,
            'shop open expectedCommerceRevision'
        );
        const unlockedDefinitionIds = normalizeUnlockedWordPool(
            source.unlockedWordDefinitionIds
                ?? this.defaultUnlockedDefinitionIds,
            this.catalogByDefinitionId
        );
        const unlockedPoolFingerprint = fingerprintUnlockedWordPool(
            unlockedDefinitionIds
        );
        const requestFingerprint = fingerprintR8Record('word-shop-open.r8', {
            transactionId,
            runSeed: this.runSeed,
            shopSessionOrdinal,
            expectedCommerceRevision,
            unlockedPoolFingerprint,
            catalogFingerprint: this.catalogFingerprint
        });
        const replay = this.#resolveReplay(transactionId, requestFingerprint);
        if (replay) return replay;
        if (this.destroyed) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.DESTROYED,
                transactionId,
                mutationCount: 0
            });
        }
        if (this.active) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.WRONG_PHASE,
                transactionId,
                active: true,
                mutationCount: 0
            });
        }
        if (shopSessionOrdinal !== this.lastShopSessionOrdinal + 1) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.STALE_SESSION_ORDINAL,
                transactionId,
                expectedShopSessionOrdinal: this.lastShopSessionOrdinal + 1,
                shopSessionOrdinal,
                mutationCount: 0
            });
        }
        if (expectedCommerceRevision !== this.commerce.getRevision()) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.STALE_COMMERCE_REVISION,
                transactionId,
                expectedCommerceRevision,
                commerceRevision: this.commerce.getRevision(),
                mutationCount: 0
            });
        }
        if (unlockedDefinitionIds.length < this.offerCount) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.INSUFFICIENT_OFFER_POOL,
                transactionId,
                requiredOfferCount: this.offerCount,
                unlockedOfferCount: unlockedDefinitionIds.length,
                mutationCount: 0
            });
        }
        this.shopSessionOrdinal = shopSessionOrdinal;
        this.rerollOrdinal = 0;
        this.unlockedDefinitionIds = unlockedDefinitionIds;
        this.unlockedPoolFingerprint = unlockedPoolFingerprint;
        this.row = this.#createRow(0);
        this.active = true;
        this.lastShopSessionOrdinal = shopSessionOrdinal;
        this.openCount++;
        return this.#remember(transactionId, requestFingerprint, {
            accepted: true,
            code: WORD_SHOP_RESULT_CODE.OPENED,
            transactionId,
            shopSessionOrdinal,
            row: this.row,
            commerceRevision: this.commerce.getRevision(),
            inventoryRevision: this.commerce.getInventorySnapshot().revision,
            mutationCount: 1
        });
    }

    purchaseOffer(source = {}) {
        const normalized = this.#normalizeRowAction(
            source,
            'word-shop-purchase.r8',
            { offerId: requireR8NonEmptyString(source.offerId, 'offerId') }
        );
        const replay = this.#resolveReplay(
            normalized.transactionId,
            normalized.requestFingerprint
        );
        if (replay) return replay;
        const preflight = this.#preflightRowAction(normalized);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        const offer = this.row.offers.find(
            (candidate) => candidate.offerId === normalized.offerId
        );
        if (!offer) {
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.UNKNOWN_OFFER,
                transactionId: normalized.transactionId,
                offerId: normalized.offerId,
                mutationCount: 0
            });
        }
        if (offer.sold) {
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.SOLD_OFFER,
                transactionId: normalized.transactionId,
                offerId: normalized.offerId,
                mutationCount: 0
            });
        }
        const nextRow = this.#withSoldOffer(offer.offerId);
        const commerceReceipt = this.commerce.purchase({
            transactionId: normalized.transactionId,
            offerId: offer.offerId,
            rowFingerprint: normalized.rowFingerprint,
            definitionId: offer.definitionId,
            shopSessionOrdinal: this.shopSessionOrdinal,
            price: offer.price,
            expectedCommerceRevision: normalized.expectedCommerceRevision,
            expectedInventoryRevision: normalized.expectedInventoryRevision
        });
        if (commerceReceipt.accepted !== true) {
            return this.#rememberNormalized(
                normalized,
                this.#commerceRejection(normalized, commerceReceipt)
            );
        }
        this.row = nextRow;
        this.purchaseCount++;
        return this.#rememberNormalized(normalized, {
            accepted: true,
            code: WORD_SHOP_RESULT_CODE.PURCHASED,
            transactionId: normalized.transactionId,
            offerId: offer.offerId,
            definitionId: offer.definitionId,
            commerceReceipt,
            row: this.row,
            mutationCount: 1
        });
    }

    reroll(source = {}) {
        const normalized = this.#normalizeRowAction(
            source,
            'word-shop-reroll.r8'
        );
        const replay = this.#resolveReplay(
            normalized.transactionId,
            normalized.requestFingerprint
        );
        if (replay) return replay;
        const preflight = this.#preflightRowAction(normalized);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        const nextRerollOrdinal = this.rerollOrdinal + 1;
        const nextRow = this.#createRow(nextRerollOrdinal);
        const contextFingerprint = fingerprintR8Record(
            'word-shop-reroll-context.r8',
            {
                priorRowFingerprint: this.row.rowFingerprint,
                nextRowFingerprint: nextRow.rowFingerprint,
                nextRerollOrdinal
            }
        );
        const commerceReceipt = this.commerce.spend({
            transactionId: normalized.transactionId,
            amount: this.rerollCost,
            expectedCommerceRevision: normalized.expectedCommerceRevision,
            purpose: 'WORD_SHOP_REROLL',
            contextFingerprint
        });
        if (commerceReceipt.accepted !== true) {
            return this.#rememberNormalized(
                normalized,
                this.#commerceRejection(normalized, commerceReceipt)
            );
        }
        this.rerollOrdinal = nextRerollOrdinal;
        this.row = nextRow;
        this.rerollCount++;
        return this.#rememberNormalized(normalized, {
            accepted: true,
            code: WORD_SHOP_RESULT_CODE.REROLLED,
            transactionId: normalized.transactionId,
            rerollOrdinal: this.rerollOrdinal,
            commerceReceipt,
            row: this.row,
            mutationCount: 1
        });
    }

    upgradeOwnedWord(source = {}) {
        const normalized = this.#normalizeRowAction(
            source,
            'word-shop-upgrade.r8',
            {
                instanceId: requireR8NonEmptyString(
                    source.instanceId,
                    'upgrade instanceId'
                )
            }
        );
        const replay = this.#resolveReplay(
            normalized.transactionId,
            normalized.requestFingerprint
        );
        if (replay) return replay;
        const preflight = this.#preflightRowAction(normalized);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        const commerceReceipt = this.commerce.upgradeOwnedWord({
            transactionId: normalized.transactionId,
            instanceId: normalized.instanceId,
            expectedCommerceRevision: normalized.expectedCommerceRevision,
            expectedInventoryRevision: normalized.expectedInventoryRevision
        });
        if (commerceReceipt.accepted !== true) {
            return this.#rememberNormalized(
                normalized,
                this.#commerceRejection(normalized, commerceReceipt)
            );
        }
        this.upgradeCount++;
        return this.#rememberNormalized(normalized, {
            accepted: true,
            code: WORD_SHOP_RESULT_CODE.UPGRADED,
            transactionId: normalized.transactionId,
            instanceId: normalized.instanceId,
            commerceReceipt,
            row: this.row,
            mutationCount: 1
        });
    }

    continueReady() {
        return !this.destroyed
            && this.active
            && this.commerce.getStatus().pendingTransactionCount === 0;
    }

    close(source = {}) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'shop close transactionId'
        );
        const requestFingerprint = fingerprintR8Record('word-shop-close.r8', {
            transactionId,
            shopSessionOrdinal: this.shopSessionOrdinal,
            rowFingerprint: this.row?.rowFingerprint ?? 0
        });
        const replay = this.#resolveReplay(transactionId, requestFingerprint);
        if (replay) return replay;
        if (!this.continueReady()) {
            return this.#remember(transactionId, requestFingerprint, {
                accepted: false,
                code: this.destroyed
                    ? WORD_SHOP_RESULT_CODE.DESTROYED
                    : WORD_SHOP_RESULT_CODE.PENDING_COMMERCE,
                transactionId,
                mutationCount: 0
            });
        }
        this.active = false;
        this.closeCount++;
        return this.#remember(transactionId, requestFingerprint, {
            accepted: true,
            code: WORD_SHOP_RESULT_CODE.CLOSED,
            transactionId,
            shopSessionOrdinal: this.shopSessionOrdinal,
            row: this.row,
            mutationCount: 1
        });
    }

    getStatus() {
        const inventory = this.commerce.getInventorySnapshot();
        return Object.freeze({
            active: this.active,
            runSeed: this.runSeed,
            shopSessionOrdinal: this.shopSessionOrdinal,
            rerollOrdinal: this.rerollOrdinal,
            catalogFingerprint: this.catalogFingerprint,
            unlockedPoolFingerprint: this.unlockedPoolFingerprint,
            unlockedDefinitionIds: this.unlockedDefinitionIds,
            offerCount: this.row?.offers.length ?? 0,
            row: this.row,
            gold: this.commerce.getBalance(),
            commerceRevision: this.commerce.getRevision(),
            inventoryRevision: inventory.revision,
            inventoryFingerprint: inventory.fingerprint,
            continueReady: this.continueReady(),
            openCount: this.openCount,
            purchaseCount: this.purchaseCount,
            rerollCount: this.rerollCount,
            upgradeCount: this.upgradeCount,
            closeCount: this.closeCount,
            replayCount: this.replayCount,
            conflictCount: this.conflictCount,
            rememberedTransactionCount: this.history.size,
            historyCapacity: this.historyCapacity,
            lastReceipt: this.lastReceipt,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.active = false;
        this.row = null;
        this.history.clear();
        this.historyOrder.length = 0;
        this.lastReceipt = null;
    }

    #createRow(rerollOrdinal) {
        const seed = createDeterministicShopSeed({
            runSeed: this.runSeed,
            shopSessionOrdinal: this.shopSessionOrdinal,
            rerollOrdinal,
            unlockedPoolFingerprint: this.unlockedPoolFingerprint,
            catalogFingerprint: this.catalogFingerprint
        });
        const rng = new DeterministicShopRng(seed);
        const candidates = this.unlockedDefinitionIds.map(
            (definitionId) => this.catalogByDefinitionId[definitionId]
        );
        const selected = selectWeightedWithoutReplacement(
            candidates,
            this.offerCount,
            rng
        );
        const offers = selected.map((record, offerOrdinal) => (
            normalizeWordShopOffer({
                offerOrdinal,
                offerId: createWordShopOfferId({
                    shopSessionOrdinal: this.shopSessionOrdinal,
                    rerollOrdinal,
                    offerOrdinal,
                    definitionId: record.definitionId
                }),
                definitionId: record.definitionId,
                price: record.basePurchaseCost,
                rarityId: record.rarityId,
                upgradeProfileId: record.upgradeProfileId,
                sold: false
            })
        ));
        return this.#freezeRow(rerollOrdinal, offers, rng.getStatus());
    }

    #withSoldOffer(offerId) {
        const offers = this.row.offers.map((offer) => (
            offer.offerId === offerId
                ? normalizeWordShopOffer({ ...offer, sold: true })
                : offer
        ));
        return this.#freezeRow(
            this.rerollOrdinal,
            offers,
            this.row.rngStatus
        );
    }

    #freezeRow(rerollOrdinal, offers, rngStatus) {
        const frozenOffers = Object.freeze(Array.from(offers));
        const rowFingerprint = fingerprintWordShopRow({
            runSeed: this.runSeed,
            shopSessionOrdinal: this.shopSessionOrdinal,
            rerollOrdinal,
            unlockedPoolFingerprint: this.unlockedPoolFingerprint,
            catalogFingerprint: this.catalogFingerprint,
            offers: frozenOffers
        });
        return Object.freeze({
            shopSessionOrdinal: this.shopSessionOrdinal,
            rerollOrdinal,
            rowFingerprint,
            offers: frozenOffers,
            rngStatus
        });
    }

    #normalizeRowAction(source, domain, extra = {}) {
        const normalized = {
            transactionId: requireR8NonEmptyString(
                source.transactionId,
                'shop transactionId'
            ),
            rowFingerprint: requirePositiveUint32(
                source.rowFingerprint,
                'shop rowFingerprint'
            ),
            expectedCommerceRevision: requireR8NonNegativeSafeInteger(
                source.expectedCommerceRevision,
                'shop expectedCommerceRevision'
            ),
            expectedInventoryRevision: requireR8NonNegativeSafeInteger(
                source.expectedInventoryRevision,
                'shop expectedInventoryRevision'
            ),
            ...extra
        };
        normalized.requestFingerprint = fingerprintR8Record(
            domain,
            normalized
        );
        return normalized;
    }

    #preflightRowAction(normalized) {
        if (this.destroyed || !this.active || !this.row) {
            return {
                accepted: false,
                code: this.destroyed
                    ? WORD_SHOP_RESULT_CODE.DESTROYED
                    : WORD_SHOP_RESULT_CODE.WRONG_PHASE,
                transactionId: normalized.transactionId,
                mutationCount: 0
            };
        }
        if (normalized.rowFingerprint !== this.row.rowFingerprint) {
            return {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.STALE_ROW,
                transactionId: normalized.transactionId,
                expectedRowFingerprint: this.row.rowFingerprint,
                rowFingerprint: normalized.rowFingerprint,
                mutationCount: 0
            };
        }
        if (normalized.expectedCommerceRevision !== this.commerce.getRevision()) {
            return {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.STALE_COMMERCE_REVISION,
                transactionId: normalized.transactionId,
                commerceRevision: this.commerce.getRevision(),
                mutationCount: 0
            };
        }
        if (normalized.expectedInventoryRevision
            !== this.commerce.getInventorySnapshot().revision) {
            return {
                accepted: false,
                code: WORD_SHOP_RESULT_CODE.STALE_INVENTORY_REVISION,
                transactionId: normalized.transactionId,
                inventoryRevision:
                    this.commerce.getInventorySnapshot().revision,
                mutationCount: 0
            };
        }
        return null;
    }

    #commerceRejection(normalized, commerceReceipt) {
        let code = WORD_SHOP_RESULT_CODE.COMMERCE_REJECTED;
        if (commerceReceipt.code
            === RUN_COMMERCE_RESULT_CODE.STALE_COMMERCE_REVISION) {
            code = WORD_SHOP_RESULT_CODE.STALE_COMMERCE_REVISION;
        } else if (commerceReceipt.code
            === RUN_COMMERCE_RESULT_CODE.STALE_INVENTORY_REVISION) {
            code = WORD_SHOP_RESULT_CODE.STALE_INVENTORY_REVISION;
        }
        return {
            accepted: false,
            code,
            transactionId: normalized.transactionId,
            commerceCode: commerceReceipt.code ?? null,
            commerceReceipt,
            mutationCount: 0
        };
    }

    #resolveReplay(transactionId, requestFingerprint) {
        const known = this.history.get(transactionId);
        if (!known) return null;
        if (known.requestFingerprint === requestFingerprint) {
            this.replayCount++;
            return known.receipt;
        }
        this.conflictCount++;
        return freezeReceipt({
            accepted: false,
            code: WORD_SHOP_RESULT_CODE.TRANSACTION_CONFLICT,
            transactionId,
            requestFingerprint,
            mutationCount: 0
        });
    }

    #rememberNormalized(normalized, source) {
        return this.#remember(
            normalized.transactionId,
            normalized.requestFingerprint,
            source
        );
    }

    #remember(transactionId, requestFingerprint, source) {
        const receipt = Object.isFrozen(source) ? source : freezeReceipt(source);
        if (!this.history.has(transactionId)) {
            this.history.set(transactionId, Object.freeze({
                requestFingerprint,
                receipt
            }));
            this.historyOrder.push(transactionId);
        }
        while (this.historyOrder.length > this.historyCapacity) {
            const retired = this.historyOrder.shift();
            this.history.delete(retired);
        }
        this.lastReceipt = receipt;
        return receipt;
    }
}
