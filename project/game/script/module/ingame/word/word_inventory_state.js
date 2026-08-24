import {
    R3_WORD_INSTANCES,
    R7_WORD_DEFINITION_BY_ID
} from 'data/word/r3_word_catalog_data.js';
import {
    R8_WORD_UPGRADE_PROFILE_BY_DEFINITION_ID,
    R8_WORD_UPGRADE_PROFILE_BY_ID
} from 'data/word/r8_word_upgrade_profile_data.js';
import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';
import {
    WORD_INVENTORY_RESULT_CODE,
    createRunOwnedWordInstanceId,
    createStarterOwnedWordInstances,
    fingerprintWordDefinitionContent,
    fingerprintWordInventory,
    normalizeOwnedWordInstance,
    requireR8NonEmptyString,
    requireR8NonNegativeSafeInteger
} from '../contract/word_inventory_contract.js';
import {
    normalizeWordUpgradeProfile
} from '../contract/word_upgrade_contract.js';

const DEFAULT_TRANSACTION_HISTORY_CAPACITY = 4096;

function requirePositiveSafeInteger(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return value;
}

function freezeReceipt(values) {
    return Object.freeze({ ...values });
}

function conflictReceipt(transactionId, requestFingerprint, revision) {
    return freezeReceipt({
        accepted: false,
        code: WORD_INVENTORY_RESULT_CODE.TRANSACTION_CONFLICT,
        transactionId,
        requestFingerprint,
        revision,
        mutationCount: 0
    });
}

/** CPU run-domain owned WordInstance inventory authority입니다. */
export class WordInventoryState {
    constructor(options = {}) {
        this.runSessionId = requireR8NonEmptyString(
            options.runSessionId ?? 'run.r8.default',
            'runSessionId'
        );
        this.wordDefinitionsById = options.wordDefinitionsById
            ?? R7_WORD_DEFINITION_BY_ID;
        this.upgradeProfilesById = options.upgradeProfilesById
            ?? R8_WORD_UPGRADE_PROFILE_BY_ID;
        this.upgradeProfilesByDefinitionId
            = options.upgradeProfilesByDefinitionId
                ?? R8_WORD_UPGRADE_PROFILE_BY_DEFINITION_ID;
        this.transactionHistoryCapacity = requirePositiveSafeInteger(
            options.transactionHistoryCapacity
                ?? DEFAULT_TRANSACTION_HISTORY_CAPACITY,
            'transactionHistoryCapacity'
        );
        const starterInstances = options.starterOwnedInstances
            ?? createStarterOwnedWordInstances({
                staticInstances: options.starterStaticInstances
                    ?? R3_WORD_INSTANCES,
                wordDefinitionsById: this.wordDefinitionsById,
                upgradeProfilesByDefinitionId:
                    this.upgradeProfilesByDefinitionId
            });
        this.instancesById = new Map();
        let maximumOrdinal = -1;
        for (let index = 0; index < starterInstances.length; index++) {
            const instance = normalizeOwnedWordInstance(
                starterInstances[index],
                `starterOwnedInstances[${index}]`
            );
            if (this.instancesById.has(instance.instanceId)) {
                throw new RangeError(`starter instance ID가 중복됩니다: ${instance.instanceId}`);
            }
            this.#validateOwnedInstanceCatalogBinding(instance);
            this.instancesById.set(instance.instanceId, instance);
            maximumOrdinal = Math.max(maximumOrdinal, instance.acquisitionOrdinal);
        }
        this.nextAcquisitionOrdinal = maximumOrdinal + 1;
        this.revision = requirePositiveSafeInteger(
            options.initialRevision ?? 1,
            'initialRevision'
        );
        this.transactionEntries = new Map();
        this.transactionOrder = [];
        this.preparedPlans = new WeakSet();
        this.lastReceipt = null;
        this.acquiredCount = 0;
        this.upgradedCount = 0;
        this.snapshotCache = null;
        this.destroyed = false;
    }

    planAcquire(source = {}) {
        if (this.destroyed) return this.#destroyedReceipt(source.transactionId);
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'inventory acquire transactionId'
        );
        const definitionId = requireR8NonEmptyString(
            source.definitionId,
            'inventory acquire definitionId'
        );
        const acquiredShopSessionOrdinal = requireR8NonNegativeSafeInteger(
            source.acquiredShopSessionOrdinal,
            'inventory acquiredShopSessionOrdinal'
        );
        const expectedRevision = requireR8NonNegativeSafeInteger(
            source.expectedRevision,
            'inventory expectedRevision'
        );
        const requestFingerprint = fingerprintR8Record(
            'word-inventory-acquire.r8',
            {
                transactionId,
                definitionId,
                acquiredShopSessionOrdinal,
                expectedRevision
            }
        );
        const replay = this.#resolveReplay(
            transactionId,
            requestFingerprint
        );
        if (replay) return replay;
        if (expectedRevision !== this.revision) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.STALE_REVISION,
                transactionId,
                requestFingerprint,
                expectedRevision,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const definition = this.wordDefinitionsById?.[definitionId];
        if (!definition || definition.id !== definitionId) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.UNKNOWN_DEFINITION,
                transactionId,
                requestFingerprint,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const contentFingerprint = fingerprintWordDefinitionContent(definition);
        const profile = this.upgradeProfilesByDefinitionId?.[definitionId]
            ?? null;
        const acquisitionOrdinal = this.nextAcquisitionOrdinal;
        const instance = normalizeOwnedWordInstance({
            instanceId: createRunOwnedWordInstanceId(
                this.runSessionId,
                acquisitionOrdinal,
                definitionId
            ),
            definitionId,
            acquisitionOrdinal,
            acquiredShopSessionOrdinal,
            upgradeLevel: 0,
            upgradeProfileId: profile?.id ?? null,
            contentFingerprint
        });
        if (this.instancesById.has(instance.instanceId)) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.INSTANCE_ID_CONFLICT,
                transactionId,
                requestFingerprint,
                instanceId: instance.instanceId,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const receipt = freezeReceipt({
            accepted: true,
            code: WORD_INVENTORY_RESULT_CODE.ACQUIRED,
            transactionId,
            requestFingerprint,
            instance,
            priorRevision: this.revision,
            revision: this.revision + 1,
            mutationCount: 1
        });
        const plan = Object.freeze({
            type: 'ACQUIRE',
            transactionId,
            requestFingerprint,
            priorRevision: this.revision,
            nextRevision: this.revision + 1,
            instance,
            receipt
        });
        this.preparedPlans.add(plan);
        return plan;
    }

    planUpgrade(source = {}) {
        if (this.destroyed) return this.#destroyedReceipt(source.transactionId);
        const transactionId = requireR8NonEmptyString(
            source.transactionId,
            'inventory upgrade transactionId'
        );
        const instanceId = requireR8NonEmptyString(
            source.instanceId,
            'inventory upgrade instanceId'
        );
        const expectedRevision = requireR8NonNegativeSafeInteger(
            source.expectedRevision,
            'inventory expectedRevision'
        );
        const requestFingerprint = fingerprintR8Record(
            'word-inventory-upgrade.r8',
            { transactionId, instanceId, expectedRevision }
        );
        const replay = this.#resolveReplay(
            transactionId,
            requestFingerprint
        );
        if (replay) return replay;
        if (expectedRevision !== this.revision) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.STALE_REVISION,
                transactionId,
                requestFingerprint,
                expectedRevision,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const current = this.instancesById.get(instanceId);
        if (!current) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.UNKNOWN_INSTANCE,
                transactionId,
                requestFingerprint,
                revision: this.revision,
                mutationCount: 0
            });
        }
        if (current.upgradeProfileId === null) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.UPGRADE_UNAVAILABLE,
                transactionId,
                requestFingerprint,
                instanceId,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const rawProfile = this.upgradeProfilesById?.[current.upgradeProfileId];
        if (!rawProfile) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.UPGRADE_PROFILE_MISMATCH,
                transactionId,
                requestFingerprint,
                instanceId,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const profile = normalizeWordUpgradeProfile(rawProfile);
        if (profile.definitionId !== current.definitionId
            || profile.id !== current.upgradeProfileId) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.UPGRADE_PROFILE_MISMATCH,
                transactionId,
                requestFingerprint,
                instanceId,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const currentLevel = profile.levels[current.upgradeLevel];
        const nextLevel = profile.levels[current.upgradeLevel + 1] ?? null;
        if (!currentLevel || !nextLevel || currentLevel.upgradeCostToNext === null) {
            return this.#rememberReceipt(transactionId, requestFingerprint, {
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.MAX_LEVEL,
                transactionId,
                requestFingerprint,
                instanceId,
                upgradeLevel: current.upgradeLevel,
                revision: this.revision,
                mutationCount: 0
            });
        }
        const instance = normalizeOwnedWordInstance({
            ...current,
            upgradeLevel: nextLevel.level
        });
        const receipt = freezeReceipt({
            accepted: true,
            code: WORD_INVENTORY_RESULT_CODE.UPGRADED,
            transactionId,
            requestFingerprint,
            instance,
            priorUpgradeLevel: current.upgradeLevel,
            stackContribution: nextLevel.stackContribution,
            upgradeCost: currentLevel.upgradeCostToNext,
            priorRevision: this.revision,
            revision: this.revision + 1,
            mutationCount: 1
        });
        const plan = Object.freeze({
            type: 'UPGRADE',
            transactionId,
            requestFingerprint,
            priorRevision: this.revision,
            nextRevision: this.revision + 1,
            instance,
            receipt
        });
        this.preparedPlans.add(plan);
        return plan;
    }

    commitPrepared(plan) {
        if (this.destroyed) return this.#destroyedReceipt(plan?.transactionId);
        if (!plan || !this.preparedPlans.has(plan)) {
            throw new TypeError('WordInventoryState가 발급한 plan이 필요합니다.');
        }
        this.preparedPlans.delete(plan);
        if (plan.priorRevision !== this.revision) {
            return freezeReceipt({
                accepted: false,
                code: WORD_INVENTORY_RESULT_CODE.STALE_REVISION,
                transactionId: plan.transactionId,
                requestFingerprint: plan.requestFingerprint,
                expectedRevision: plan.priorRevision,
                revision: this.revision,
                mutationCount: 0
            });
        }
        if (plan.type === 'ACQUIRE') {
            if (this.instancesById.has(plan.instance.instanceId)) {
                return conflictReceipt(
                    plan.transactionId,
                    plan.requestFingerprint,
                    this.revision
                );
            }
            this.instancesById.set(plan.instance.instanceId, plan.instance);
            this.nextAcquisitionOrdinal++;
            this.acquiredCount++;
        } else if (plan.type === 'UPGRADE') {
            const current = this.instancesById.get(plan.instance.instanceId);
            if (!current
                || current.upgradeLevel + 1 !== plan.instance.upgradeLevel) {
                return conflictReceipt(
                    plan.transactionId,
                    plan.requestFingerprint,
                    this.revision
                );
            }
            this.instancesById.set(plan.instance.instanceId, plan.instance);
            this.upgradedCount++;
        } else {
            throw new RangeError(`알려지지 않은 inventory plan입니다: ${plan.type}`);
        }
        this.revision = plan.nextRevision;
        return this.#rememberReceipt(
            plan.transactionId,
            plan.requestFingerprint,
            plan.receipt
        );
    }

    acquire(source = {}) {
        const plan = this.planAcquire(source);
        return plan?.receipt ? this.commitPrepared(plan) : plan;
    }

    upgrade(source = {}) {
        const plan = this.planUpgrade(source);
        return plan?.receipt ? this.commitPrepared(plan) : plan;
    }

    getInstance(instanceId) {
        return this.destroyed ? null : this.instancesById.get(instanceId) ?? null;
    }

    getRevision() {
        return this.destroyed ? 0 : this.revision;
    }

    getSnapshot() {
        const expectedRevision = this.destroyed ? 0 : this.revision;
        if (this.snapshotCache?.revision === expectedRevision
            && this.snapshotCache.destroyed === this.destroyed) {
            return this.snapshotCache;
        }
        if (this.destroyed) {
            this.snapshotCache = Object.freeze({
                revision: 0,
                fingerprint: 0,
                nextAcquisitionOrdinal: 0,
                reusableAcrossSlots: true,
                instances: Object.freeze([]),
                instancesById: Object.freeze({}),
                destroyed: true
            });
            return this.snapshotCache;
        }
        const instances = Array.from(this.instancesById.values()).sort(
            (left, right) => left.acquisitionOrdinal - right.acquisitionOrdinal
                || left.instanceId.localeCompare(right.instanceId)
        );
        const frozenInstances = Object.freeze(instances);
        this.snapshotCache = Object.freeze({
            runSessionId: this.runSessionId,
            revision: this.revision,
            fingerprint: fingerprintWordInventory(instances),
            nextAcquisitionOrdinal: this.nextAcquisitionOrdinal,
            reusableAcrossSlots: true,
            instances: frozenInstances,
            instancesById: Object.freeze(Object.fromEntries(
                instances.map((instance) => [instance.instanceId, instance])
            )),
            destroyed: false
        });
        return this.snapshotCache;
    }

    getStatus() {
        const snapshot = this.getSnapshot();
        return Object.freeze({
            revision: snapshot.revision,
            fingerprint: snapshot.fingerprint,
            instanceCount: snapshot.instances.length,
            nextAcquisitionOrdinal: snapshot.nextAcquisitionOrdinal,
            acquiredCount: this.acquiredCount,
            upgradedCount: this.upgradedCount,
            rememberedTransactionCount: this.transactionEntries.size,
            transactionHistoryCapacity: this.transactionHistoryCapacity,
            lastReceipt: this.lastReceipt,
            destroyed: this.destroyed
        });
    }

    captureAtomicCheckpoint() {
        if (this.destroyed) throw new Error('destroyed inventory는 checkpoint할 수 없습니다.');
        return Object.freeze({
            owner: this,
            instancesById: new Map(this.instancesById),
            nextAcquisitionOrdinal: this.nextAcquisitionOrdinal,
            revision: this.revision,
            transactionEntries: new Map(this.transactionEntries),
            transactionOrder: Array.from(this.transactionOrder),
            lastReceipt: this.lastReceipt,
            acquiredCount: this.acquiredCount,
            upgradedCount: this.upgradedCount
        });
    }

    restoreAtomicCheckpoint(checkpoint) {
        if (this.destroyed || checkpoint?.owner !== this) {
            throw new TypeError('이 inventory의 atomic checkpoint가 필요합니다.');
        }
        this.instancesById = new Map(checkpoint.instancesById);
        this.nextAcquisitionOrdinal = checkpoint.nextAcquisitionOrdinal;
        this.revision = checkpoint.revision;
        this.transactionEntries = new Map(checkpoint.transactionEntries);
        this.transactionOrder = Array.from(checkpoint.transactionOrder);
        this.lastReceipt = checkpoint.lastReceipt;
        this.acquiredCount = checkpoint.acquiredCount;
        this.upgradedCount = checkpoint.upgradedCount;
        this.preparedPlans = new WeakSet();
        this.snapshotCache = null;
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.instancesById.clear();
        this.transactionEntries.clear();
        this.transactionOrder.length = 0;
        this.preparedPlans = new WeakSet();
        this.lastReceipt = null;
        this.snapshotCache = null;
    }

    #validateOwnedInstanceCatalogBinding(instance) {
        const definition = this.wordDefinitionsById?.[instance.definitionId];
        if (!definition || definition.id !== instance.definitionId) {
            throw new RangeError(`WordDefinition이 없습니다: ${instance.definitionId}`);
        }
        if (fingerprintWordDefinitionContent(definition)
            !== instance.contentFingerprint) {
            throw new RangeError(
                `Word content fingerprint가 다릅니다: ${instance.instanceId}`
            );
        }
        const profile = this.upgradeProfilesByDefinitionId?.[definition.id]
            ?? null;
        if ((profile?.id ?? null) !== instance.upgradeProfileId) {
            throw new RangeError(
                `Word upgrade profile이 다릅니다: ${instance.instanceId}`
            );
        }
    }

    #resolveReplay(transactionId, requestFingerprint) {
        const known = this.transactionEntries.get(transactionId);
        if (!known) return null;
        return known.requestFingerprint === requestFingerprint
            ? known.receipt
            : conflictReceipt(transactionId, requestFingerprint, this.revision);
    }

    #rememberReceipt(transactionId, requestFingerprint, source) {
        const receipt = Object.isFrozen(source) ? source : freezeReceipt(source);
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

    #destroyedReceipt(transactionId = null) {
        return freezeReceipt({
            accepted: false,
            code: WORD_INVENTORY_RESULT_CODE.DESTROYED,
            transactionId: transactionId ?? null,
            revision: 0,
            mutationCount: 0
        });
    }
}
