import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    WORD_INVENTORY_RESULT_CODE,
    requireR8NonEmptyString,
    requireR8NonNegativeSafeInteger
} from '../contract/word_inventory_contract.js';
import { WordInventoryState } from '../word/word_inventory_state.js';

const DEFAULT_TRANSACTION_HISTORY_CAPACITY = 4096;

export const RUN_COMMERCE_RESULT_CODE = Object.freeze({
    CREDITED: 'CREDITED',
    PURCHASED: 'PURCHASED',
    UPGRADED: 'UPGRADED',
    SPENT: 'SPENT',
    TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
    INSUFFICIENT_GOLD: 'INSUFFICIENT_GOLD',
    STALE_COMMERCE_REVISION: 'STALE_COMMERCE_REVISION',
    STALE_INVENTORY_REVISION: 'STALE_INVENTORY_REVISION',
    INVENTORY_REJECTED: 'INVENTORY_REJECTED',
    PROTOCOL_FAILURE: 'PROTOCOL_FAILURE',
    DESTROYED: 'DESTROYED'
});

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

function optionalString(value, label) {
    return value === null || value === undefined
        ? null
        : requireR8NonEmptyString(value, label);
}

function freezeReceipt(source) {
    return Object.freeze({ ...source });
}

/** Gold와 owned Word inventory를 함께 게시하는 CPU run-domain authority입니다. */
export class RunCommerceState {
    constructor(options = {}) {
        this.balance = requireR8NonNegativeSafeInteger(
            options.initialGold ?? 0,
            'initialGold'
        );
        this.inventory = options.inventoryState ?? new WordInventoryState({
            ...options.inventoryOptions,
            runSessionId: options.runSessionId
                ?? options.inventoryOptions?.runSessionId
                ?? 'run.r8.default'
        });
        if (!this.inventory
            || typeof this.inventory.planAcquire !== 'function'
            || typeof this.inventory.planUpgrade !== 'function'
            || typeof this.inventory.commitPrepared !== 'function'
            || typeof this.inventory.captureAtomicCheckpoint !== 'function') {
            throw new TypeError('RunCommerceState에 WordInventoryState가 필요합니다.');
        }
        this.transactionHistoryCapacity = requirePositiveSafeInteger(
            options.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_HISTORY_CAPACITY,
            'transactionHistoryCapacity'
        );
        this.failureInjector = typeof options.failureInjector === 'function'
            ? options.failureInjector
            : null;
        this.revision = requirePositiveSafeInteger(
            options.initialRevision ?? 1,
            'initialRevision'
        );
        this.transactionEntries = new Map();
        this.transactionOrder = [];
        this.totalCredited = 0;
        this.totalSpent = 0;
        this.creditCount = 0;
        this.purchaseCount = 0;
        this.upgradeCount = 0;
        this.spendCount = 0;
        this.replayCount = 0;
        this.conflictCount = 0;
        this.lastCredit = null;
        this.lastReceipt = null;
        this.failure = null;
        this.pendingTransactionCount = 0;
        this.destroyed = false;
    }

    /** BountyRewardDirector가 사용하는 기존 credit-only compatibility port입니다. */
    credit(source = {}) {
        if (this.destroyed) {
            return Object.freeze({ accepted: false, reason: 'destroyed' });
        }
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'gold transactionId'
        );
        const amount = requireR8NonNegativeSafeInteger(
            source.amount,
            'gold amount'
        );
        const fixedTick = requireR8NonNegativeSafeInteger(
            source.fixedTick ?? 0,
            'gold fixedTick'
        );
        const requestFingerprint = fingerprintR8Record(
            'run-commerce-credit.r8',
            {
                transactionId,
                amount,
                fixedTick,
                sourceKind: optionalString(source.sourceKind, 'sourceKind'),
                sourceEntityId: source.sourceEntityId ?? null,
                sourceIncarnation: source.sourceIncarnation ?? null,
                targetEntityId: source.targetEntityId ?? null,
                targetIncarnation: source.targetIncarnation ?? null
            }
        );
        const known = this.transactionEntries.get(transactionId);
        if (known) {
            if (known.requestFingerprint !== requestFingerprint) {
                this.conflictCount++;
                return Object.freeze({
                    accepted: false,
                    duplicate: false,
                    reason: 'transaction-conflict',
                    transactionId,
                    balance: this.balance
                });
            }
            this.replayCount++;
            return Object.freeze({
                accepted: false,
                duplicate: true,
                reason: 'duplicate-transaction',
                transactionId,
                balance: this.balance
            });
        }
        if (this.failure) {
            return Object.freeze({
                accepted: false,
                duplicate: false,
                reason: 'protocol-failure',
                transactionId,
                balance: this.balance
            });
        }
        if (this.balance > Number.MAX_SAFE_INTEGER - amount
            || this.totalCredited > Number.MAX_SAFE_INTEGER - amount) {
            throw new RangeError('Gold 안전한 정수 범위를 초과합니다.');
        }
        this.balance += amount;
        this.totalCredited += amount;
        this.creditCount++;
        this.revision++;
        this.lastCredit = Object.freeze({
            transactionId,
            amount,
            fixedTick,
            sourceKind: source.sourceKind ?? null,
            sourceEntityId: source.sourceEntityId ?? null,
            sourceIncarnation: source.sourceIncarnation ?? null,
            targetEntityId: source.targetEntityId ?? null,
            targetIncarnation: source.targetIncarnation ?? null,
            balance: this.balance
        });
        const receipt = freezeReceipt({
            accepted: true,
            duplicate: false,
            code: RUN_COMMERCE_RESULT_CODE.CREDITED,
            transactionId,
            amount,
            balance: this.balance,
            revision: this.revision
        });
        this.#remember(transactionId, requestFingerprint, receipt);
        return receipt;
    }

    purchase(source = {}) {
        const normalized = this.#normalizePurchase(source);
        const replay = this.#resolveReplay(
            normalized.transactionId,
            normalized.requestFingerprint
        );
        if (replay) return replay;
        const preflight = this.#preflightMutation(normalized);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        if (this.balance < normalized.price) {
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.INSUFFICIENT_GOLD,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                requiredGold: normalized.price,
                gold: this.balance,
                commerceRevision: this.revision,
                inventoryRevision: this.inventory.getRevision(),
                goldMutation: 0,
                inventoryMutation: 0
            });
        }
        const plan = this.inventory.planAcquire({
            transactionId: normalized.transactionId,
            definitionId: normalized.definitionId,
            acquiredShopSessionOrdinal: normalized.shopSessionOrdinal,
            expectedRevision: normalized.expectedInventoryRevision
        });
        if (!plan?.receipt) {
            return this.#rememberNormalized(
                normalized,
                this.#inventoryRejectionReceipt(normalized, plan)
            );
        }
        return this.#publishInventoryMutation({
            normalized,
            plan,
            amount: normalized.price,
            successCode: RUN_COMMERCE_RESULT_CODE.PURCHASED,
            counter: 'purchaseCount',
            extraReceipt: {
                offerId: normalized.offerId,
                rowFingerprint: normalized.rowFingerprint,
                definitionId: normalized.definitionId
            }
        });
    }

    upgradeOwnedWord(source = {}) {
        const normalized = this.#normalizeUpgrade(source);
        const replay = this.#resolveReplay(
            normalized.transactionId,
            normalized.requestFingerprint
        );
        if (replay) return replay;
        const preflight = this.#preflightMutation(normalized);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        const plan = this.inventory.planUpgrade({
            transactionId: normalized.transactionId,
            instanceId: normalized.instanceId,
            expectedRevision: normalized.expectedInventoryRevision
        });
        if (!plan?.receipt) {
            return this.#rememberNormalized(
                normalized,
                this.#inventoryRejectionReceipt(normalized, plan)
            );
        }
        const amount = plan.receipt.upgradeCost;
        if (this.balance < amount) {
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.INSUFFICIENT_GOLD,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                requiredGold: amount,
                gold: this.balance,
                commerceRevision: this.revision,
                inventoryRevision: this.inventory.getRevision(),
                goldMutation: 0,
                inventoryMutation: 0
            });
        }
        return this.#publishInventoryMutation({
            normalized,
            plan,
            amount,
            successCode: RUN_COMMERCE_RESULT_CODE.UPGRADED,
            counter: 'upgradeCount',
            extraReceipt: { instanceId: normalized.instanceId }
        });
    }

    spend(source = {}) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'commerce spend transactionId'
        );
        const amount = requireR8NonNegativeSafeInteger(
            source.amount,
            'commerce spend amount'
        );
        const expectedCommerceRevision = requireR8NonNegativeSafeInteger(
            source.expectedCommerceRevision,
            'expectedCommerceRevision'
        );
        const purpose = requireR8NonEmptyString(source.purpose, 'spend purpose');
        const contextFingerprint = requirePositiveUint32(
            source.contextFingerprint,
            'spend contextFingerprint'
        );
        const requestFingerprint = fingerprintR8Record(
            'run-commerce-spend.r8',
            {
                transactionId,
                amount,
                expectedCommerceRevision,
                purpose,
                contextFingerprint
            }
        );
        const normalized = {
            transactionId,
            amount,
            expectedCommerceRevision,
            requestFingerprint
        };
        const replay = this.#resolveReplay(transactionId, requestFingerprint);
        if (replay) return replay;
        const preflight = this.#preflightMutation(normalized, false);
        if (preflight) return this.#rememberNormalized(normalized, preflight);
        if (this.balance < amount) {
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.INSUFFICIENT_GOLD,
                transactionId,
                requestFingerprint,
                requiredGold: amount,
                gold: this.balance,
                commerceRevision: this.revision,
                goldMutation: 0,
                inventoryMutation: 0
            });
        }
        this.balance -= amount;
        this.totalSpent += amount;
        this.spendCount++;
        this.revision++;
        return this.#rememberNormalized(normalized, {
            accepted: true,
            code: RUN_COMMERCE_RESULT_CODE.SPENT,
            transactionId,
            requestFingerprint,
            purpose,
            contextFingerprint,
            amount,
            gold: this.balance,
            commerceRevision: this.revision,
            inventoryRevision: this.inventory.getRevision(),
            goldMutation: -amount,
            inventoryMutation: 0
        });
    }

    getBalance() {
        return this.destroyed ? 0 : this.balance;
    }

    getRevision() {
        return this.destroyed ? 0 : this.revision;
    }

    getInventorySnapshot() {
        return this.inventory.getSnapshot();
    }

    getGoldStatus() {
        return Object.freeze({
            gold: this.getBalance(),
            totalCredited: this.totalCredited,
            creditCount: this.creditCount,
            rememberedTransactionCount: this.transactionEntries.size,
            lastCredit: this.lastCredit,
            destroyed: this.destroyed
        });
    }

    getStatus() {
        const inventory = this.getInventorySnapshot();
        return Object.freeze({
            gold: this.getBalance(),
            commerceRevision: this.getRevision(),
            inventoryRevision: inventory.revision,
            inventoryFingerprint: inventory.fingerprint,
            inventory,
            totalCredited: this.totalCredited,
            totalSpent: this.totalSpent,
            creditCount: this.creditCount,
            purchaseCount: this.purchaseCount,
            upgradeCount: this.upgradeCount,
            spendCount: this.spendCount,
            replayCount: this.replayCount,
            conflictCount: this.conflictCount,
            pendingTransactionCount: this.pendingTransactionCount,
            rememberedTransactionCount: this.transactionEntries.size,
            transactionHistoryCapacity: this.transactionHistoryCapacity,
            lastCredit: this.lastCredit,
            lastReceipt: this.lastReceipt,
            protocolFailure: this.failure,
            destroyed: this.destroyed
        });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.transactionEntries.clear();
        this.transactionOrder.length = 0;
        this.inventory.destroy();
        this.lastCredit = null;
        this.lastReceipt = null;
    }

    #normalizePurchase(source) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'purchase transactionId'
        );
        const normalized = {
            transactionId,
            offerId: requireR8NonEmptyString(source.offerId, 'purchase offerId'),
            rowFingerprint: requirePositiveUint32(
                source.rowFingerprint,
                'purchase rowFingerprint'
            ),
            definitionId: requireR8NonEmptyString(
                source.definitionId,
                'purchase definitionId'
            ),
            shopSessionOrdinal: requireR8NonNegativeSafeInteger(
                source.shopSessionOrdinal,
                'purchase shopSessionOrdinal'
            ),
            price: requireR8NonNegativeSafeInteger(source.price, 'purchase price'),
            expectedCommerceRevision: requireR8NonNegativeSafeInteger(
                source.expectedCommerceRevision,
                'purchase expectedCommerceRevision'
            ),
            expectedInventoryRevision: requireR8NonNegativeSafeInteger(
                source.expectedInventoryRevision,
                'purchase expectedInventoryRevision'
            )
        };
        normalized.requestFingerprint = fingerprintR8Record(
            'run-commerce-purchase.r8',
            normalized
        );
        return normalized;
    }

    #normalizeUpgrade(source) {
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'upgrade transactionId'
        );
        const normalized = {
            transactionId,
            instanceId: requireR8NonEmptyString(
                source.instanceId,
                'upgrade instanceId'
            ),
            expectedCommerceRevision: requireR8NonNegativeSafeInteger(
                source.expectedCommerceRevision,
                'upgrade expectedCommerceRevision'
            ),
            expectedInventoryRevision: requireR8NonNegativeSafeInteger(
                source.expectedInventoryRevision,
                'upgrade expectedInventoryRevision'
            )
        };
        normalized.requestFingerprint = fingerprintR8Record(
            'run-commerce-upgrade.r8',
            normalized
        );
        return normalized;
    }

    #preflightMutation(normalized, checkInventory = true) {
        if (this.destroyed) {
            return {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.DESTROYED,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                goldMutation: 0,
                inventoryMutation: 0
            };
        }
        if (this.failure) {
            return {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.PROTOCOL_FAILURE,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                failure: this.failure,
                goldMutation: 0,
                inventoryMutation: 0
            };
        }
        if (normalized.expectedCommerceRevision !== this.revision) {
            return {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.STALE_COMMERCE_REVISION,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                expectedCommerceRevision: normalized.expectedCommerceRevision,
                commerceRevision: this.revision,
                goldMutation: 0,
                inventoryMutation: 0
            };
        }
        if (checkInventory
            && normalized.expectedInventoryRevision
                !== this.inventory.getRevision()) {
            return {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.STALE_INVENTORY_REVISION,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                expectedInventoryRevision: normalized.expectedInventoryRevision,
                inventoryRevision: this.inventory.getRevision(),
                goldMutation: 0,
                inventoryMutation: 0
            };
        }
        return null;
    }

    #publishInventoryMutation({
        normalized,
        plan,
        amount,
        successCode,
        counter,
        extraReceipt
    }) {
        const inventoryCheckpoint = this.inventory.captureAtomicCheckpoint();
        const stateCheckpoint = {
            balance: this.balance,
            totalSpent: this.totalSpent,
            revision: this.revision,
            counterValue: this[counter],
            pendingTransactionCount: this.pendingTransactionCount
        };
        this.pendingTransactionCount++;
        try {
            this.failureInjector?.('after-prepare', normalized);
            this.balance -= amount;
            this.failureInjector?.('after-gold-publish', normalized);
            const inventoryReceipt = this.inventory.commitPrepared(plan);
            if (inventoryReceipt?.accepted !== true) {
                throw new Error(
                    `inventory commit rejected: ${inventoryReceipt?.code ?? 'unknown'}`
                );
            }
            this.failureInjector?.('after-inventory-publish', normalized);
            this.totalSpent += amount;
            this[counter]++;
            this.revision++;
            this.pendingTransactionCount--;
            return this.#rememberNormalized(normalized, {
                accepted: true,
                code: successCode,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                amount,
                gold: this.balance,
                commerceRevision: this.revision,
                inventoryRevision: this.inventory.getRevision(),
                inventoryFingerprint: this.inventory.getSnapshot().fingerprint,
                inventoryReceipt,
                goldMutation: -amount,
                inventoryMutation: 1,
                ...extraReceipt
            });
        } catch (error) {
            this.inventory.restoreAtomicCheckpoint(inventoryCheckpoint);
            this.balance = stateCheckpoint.balance;
            this.totalSpent = stateCheckpoint.totalSpent;
            this.revision = stateCheckpoint.revision;
            this[counter] = stateCheckpoint.counterValue;
            this.pendingTransactionCount = stateCheckpoint.pendingTransactionCount;
            this.failure = Object.freeze({
                code: 'run-commerce-atomic-publication-failure',
                transactionId: normalized.transactionId,
                message: error instanceof Error ? error.message : String(error)
            });
            return this.#rememberNormalized(normalized, {
                accepted: false,
                code: RUN_COMMERCE_RESULT_CODE.PROTOCOL_FAILURE,
                transactionId: normalized.transactionId,
                requestFingerprint: normalized.requestFingerprint,
                gold: this.balance,
                commerceRevision: this.revision,
                inventoryRevision: this.inventory.getRevision(),
                failure: this.failure,
                rolledBack: true,
                goldMutation: 0,
                inventoryMutation: 0
            });
        }
    }

    #inventoryRejectionReceipt(normalized, inventoryReceipt) {
        const stale = inventoryReceipt?.code
            === WORD_INVENTORY_RESULT_CODE.STALE_REVISION;
        return {
            accepted: false,
            code: stale
                ? RUN_COMMERCE_RESULT_CODE.STALE_INVENTORY_REVISION
                : RUN_COMMERCE_RESULT_CODE.INVENTORY_REJECTED,
            transactionId: normalized.transactionId,
            requestFingerprint: normalized.requestFingerprint,
            inventoryCode: inventoryReceipt?.code ?? null,
            inventoryReceipt: inventoryReceipt ?? null,
            gold: this.balance,
            commerceRevision: this.revision,
            inventoryRevision: this.inventory.getRevision(),
            goldMutation: 0,
            inventoryMutation: 0
        };
    }

    #resolveReplay(transactionId, requestFingerprint) {
        const known = this.transactionEntries.get(transactionId);
        if (!known) return null;
        if (known.requestFingerprint === requestFingerprint) {
            this.replayCount++;
            return known.receipt;
        }
        this.conflictCount++;
        return freezeReceipt({
            accepted: false,
            code: RUN_COMMERCE_RESULT_CODE.TRANSACTION_CONFLICT,
            transactionId,
            requestFingerprint,
            commerceRevision: this.revision,
            inventoryRevision: this.inventory.getRevision(),
            gold: this.balance,
            goldMutation: 0,
            inventoryMutation: 0
        });
    }

    #rememberNormalized(normalized, source) {
        return this.#remember(
            normalized.transactionId,
            normalized.requestFingerprint,
            Object.isFrozen(source) ? source : freezeReceipt(source)
        );
    }

    #remember(transactionId, requestFingerprint, receipt) {
        if (!this.transactionEntries.has(transactionId)) {
            this.transactionEntries.set(transactionId, Object.freeze({
                requestFingerprint,
                receipt
            }));
            this.transactionOrder.push(transactionId);
        }
        while (this.transactionOrder.length > this.transactionHistoryCapacity) {
            const retired = this.transactionOrder.shift();
            this.transactionEntries.delete(retired);
        }
        this.lastReceipt = receipt;
        return receipt;
    }
}
