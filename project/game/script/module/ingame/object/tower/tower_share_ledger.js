import {
    PRIMARY_TOWER_LOGICAL_ID,
    PRIMARY_TOWER_LOGICAL_ORDINAL,
    TOWER_CREATION_REASON,
    TOWER_CREATION_RESULT,
    TOWER_SHARE_SCALE,
    requireLogicalTowerId,
    requireNonNegativeSafeInteger,
    requirePositiveSafeInteger,
    requireShareUnits
} from './tower_group_contract.js';

function toNonNegativeBigInt(value, label) {
    if (typeof value === 'bigint') {
        if (value < 0n) {
            throw new RangeError(`${label}은 0 이상이어야 합니다.`);
        }
        return value;
    }
    return BigInt(requireNonNegativeSafeInteger(value, label));
}

function toSafeInteger(value, label) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`${label}이 안전한 정수 범위를 초과합니다.`);
    }
    return Number(value);
}

function compareAllocationPriority(left, right) {
    if (left.remainder !== right.remainder) {
        return left.remainder > right.remainder ? -1 : 1;
    }
    if (left.logicalTowerOrdinal !== right.logicalTowerOrdinal) {
        return left.logicalTowerOrdinal - right.logicalTowerOrdinal;
    }
    if (left.entityId !== right.entityId) {
        return left.entityId - right.entityId;
    }
    if (left.incarnation !== right.incarnation) {
        return left.incarnation - right.incarnation;
    }
    return left.key.localeCompare(right.key);
}

function compareLogicalOrder(left, right) {
    if (left.logicalTowerOrdinal !== right.logicalTowerOrdinal) {
        return left.logicalTowerOrdinal - right.logicalTowerOrdinal;
    }
    return left.key.localeCompare(right.key);
}

/**
 * 공통 분모를 가진 정수 claim을 largest-remainder로 정확히 배분합니다.
 * 반환값과 tie-break는 입력 배열 순서에 의존하지 않습니다.
 */
export function apportionLargestRemainder(source = {}) {
    const denominator = toNonNegativeBigInt(
        source.denominator,
        'apportion denominator'
    );
    if (denominator <= 0n) {
        throw new RangeError('apportion denominator는 양수여야 합니다.');
    }
    if (!Array.isArray(source.claims) || source.claims.length === 0) {
        throw new TypeError('apportion claims는 비어 있지 않은 배열이어야 합니다.');
    }

    const keys = new Set();
    const ordinals = new Set();
    let numeratorTotal = 0n;
    let floorTotal = 0n;
    const normalized = source.claims.map((claim, index) => {
        const key = requireLogicalTowerId(
            claim?.key,
            `claims[${index}].key`
        );
        const logicalTowerOrdinal = requirePositiveSafeInteger(
            claim?.logicalTowerOrdinal,
            `claims[${index}].logicalTowerOrdinal`
        );
        if (keys.has(key) || ordinals.has(logicalTowerOrdinal)) {
            throw new Error('apportion claim identity/ordinal은 고유해야 합니다.');
        }
        keys.add(key);
        ordinals.add(logicalTowerOrdinal);
        const numerator = toNonNegativeBigInt(
            claim?.numerator,
            `claims[${index}].numerator`
        );
        const quotient = numerator / denominator;
        const cap = claim?.cap === undefined
            ? Number.MAX_SAFE_INTEGER
            : requireNonNegativeSafeInteger(
                claim.cap,
                `claims[${index}].cap`
            );
        const quotientNumber = toSafeInteger(
            quotient,
            `claims[${index}] quotient`
        );
        const boundedFloor = Math.min(quotientNumber, cap);
        numeratorTotal += numerator;
        floorTotal += BigInt(boundedFloor);
        return {
            key,
            logicalTowerOrdinal,
            entityId: Number.isSafeInteger(claim?.entityId)
                ? claim.entityId
                : 0xffffffff,
            incarnation: Number.isSafeInteger(claim?.incarnation)
                ? claim.incarnation
                : 0xffffffff,
            cap,
            value: boundedFloor,
            remainder: numerator % denominator
        };
    });

    const targetTotal = source.targetTotal === undefined
        ? numeratorTotal / denominator
        : toNonNegativeBigInt(source.targetTotal, 'apportion targetTotal');
    const priority = [...normalized].sort(compareAllocationPriority);
    if (targetTotal >= floorTotal) {
        let residual = toSafeInteger(
            targetTotal - floorTotal,
            'apportion residual'
        );
        while (residual > 0) {
            let distributed = 0;
            for (const claim of priority) {
                if (residual === 0) break;
                if (claim.value >= claim.cap) continue;
                claim.value++;
                residual--;
                distributed++;
            }
            if (distributed === 0) break;
        }
        if (residual !== 0) {
            const capacity = normalized.reduce(
                (total, claim) => total + (claim.cap - claim.value),
                0
            );
            throw new RangeError(
                `apportion residual을 cap 안에서 배분할 수 없습니다. `
                + `(residual=${residual}, remainingCapacity=${capacity}, `
                + `target=${targetTotal}, floor=${floorTotal})`
            );
        }
    } else {
        let deficit = toSafeInteger(
            floorTotal - targetTotal,
            'apportion deficit'
        );
        const removalPriority = [...priority].reverse();
        while (deficit > 0) {
            let removed = 0;
            for (const claim of removalPriority) {
                if (deficit === 0) break;
                if (claim.value === 0) continue;
                claim.value--;
                deficit--;
                removed++;
            }
            if (removed === 0) break;
        }
        if (deficit !== 0) {
            throw new RangeError(
                `apportion floor를 target까지 줄일 수 없습니다. `
                + `(deficit=${deficit}, target=${targetTotal}, `
                + `floor=${floorTotal})`
            );
        }
    }

    const allocations = normalized
        .sort(compareLogicalOrder)
        .map(({ key, logicalTowerOrdinal, value }) => Object.freeze({
            key,
            logicalTowerOrdinal,
            value
        }));
    return Object.freeze({
        total: toSafeInteger(targetTotal, 'apportion total'),
        allocations: Object.freeze(allocations)
    });
}

function createClaimIdentity(record) {
    const binding = record.exactGpuBinding;
    return {
        key: record.logicalTowerId,
        logicalTowerOrdinal: record.logicalTowerOrdinal,
        entityId: binding?.entityId,
        incarnation: binding?.incarnation
    };
}

function allocationsByKey(result) {
    return new Map(result.allocations.map((entry) => [entry.key, entry.value]));
}

function sumSafeIntegers(records, selector, label) {
    let total = 0;
    for (const record of records) {
        const value = requireNonNegativeSafeInteger(selector(record), label);
        if (total > Number.MAX_SAFE_INTEGER - value) {
            throw new RangeError(`${label} 합이 안전한 정수 범위를 초과합니다.`);
        }
        total += value;
    }
    return total;
}

function freezeRejectedPlan(result, reason, extra = {}) {
    return Object.freeze({
        accepted: false,
        result,
        reason,
        ...extra
    });
}

/** CPU run-domain의 exact Share/Lost Share 및 dilution 산술 권위입니다. */
export class TowerShareLedger {
    constructor(options = {}) {
        this.scale = requireShareUnits(
            options.scale ?? TOWER_SHARE_SCALE,
            'towerShareScale'
        );
        if (this.scale !== TOWER_SHARE_SCALE) {
            throw new RangeError(
                `Tower Share scale은 ${TOWER_SHARE_SCALE}으로 고정됩니다.`
            );
        }
        this.runBaseMaxHpFixedPoint = requirePositiveSafeInteger(
            options.runBaseMaxHpFixedPoint,
            'runBaseMaxHpFixedPoint'
        );
        this.runBasePowerFixedPoint = requireNonNegativeSafeInteger(
            options.runBasePowerFixedPoint,
            'runBasePowerFixedPoint'
        );
        this.lostShareUnits = requireShareUnits(
            options.lostShareUnits ?? 0,
            'lostShareUnits'
        );
        this.destroyed = false;
    }

    createInitialTower(source = {}) {
        this.#assertUsable();
        if (this.lostShareUnits !== 0) {
            throw new Error('Lost Share가 있는 ledger는 초기 Tower를 만들 수 없습니다.');
        }
        return Object.freeze({
            logicalTowerId: requireLogicalTowerId(
                source.logicalTowerId ?? PRIMARY_TOWER_LOGICAL_ID
            ),
            logicalTowerOrdinal: requirePositiveSafeInteger(
                source.logicalTowerOrdinal ?? PRIMARY_TOWER_LOGICAL_ORDINAL,
                'initialTower.logicalTowerOrdinal'
            ),
            shareUnits: this.scale,
            currentHpFixedPoint: this.runBaseMaxHpFixedPoint,
            maxHpFixedPoint: this.runBaseMaxHpFixedPoint,
            powerFixedPoint: this.runBasePowerFixedPoint
        });
    }

    planCreation(livingRecords, childTemplates) {
        this.#assertUsable();
        if (!Array.isArray(livingRecords) || !Array.isArray(childTemplates)
            || childTemplates.length === 0) {
            throw new TypeError(
                'livingRecords와 비어 있지 않은 childTemplates가 필요합니다.'
            );
        }
        const living = [...livingRecords].sort((left, right) => (
            left.logicalTowerOrdinal - right.logicalTowerOrdinal
        ));
        const children = [...childTemplates].sort((left, right) => (
            left.logicalTowerOrdinal - right.logicalTowerOrdinal
        ));
        const livingShareUnits = sumSafeIntegers(
            living,
            (record) => requireShareUnits(record.shareUnits),
            'living shareUnits'
        );
        if (living.length === 0 || livingShareUnits === 0) {
            return freezeRejectedPlan(
                TOWER_CREATION_RESULT.REJECTED_ZERO_SHARE,
                TOWER_CREATION_REASON.ZERO_LIVING_SHARE_NON_VIABLE
            );
        }
        if (livingShareUnits + this.lostShareUnits !== this.scale) {
            throw new Error('Tower Share invariant가 creation plan 전에 깨졌습니다.');
        }

        const nextCount = living.length + children.length;
        const livingMaxHpTotal = sumSafeIntegers(
            living,
            (record) => record.maxHpFixedPoint,
            'living maxHpFixedPoint'
        );
        const livingPowerTotal = sumSafeIntegers(
            living,
            (record) => record.powerFixedPoint,
            'living powerFixedPoint'
        );
        if (livingMaxHpTotal < nextCount) {
            return freezeRejectedPlan(
                TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_HEALTH,
                TOWER_CREATION_REASON.NON_VIABLE_DERIVED_HEALTH,
                {
                    derivedMaxHpTotal: livingMaxHpTotal,
                    requiredPositiveRecordCount: nextCount
                }
            );
        }

        const denominator = BigInt(nextCount);
        const livingCount = BigInt(living.length);
        const shareClaims = [
            ...living.map((record) => ({
                ...createClaimIdentity(record),
                numerator: BigInt(record.shareUnits) * livingCount
            })),
            ...children.map((record) => ({
                ...createClaimIdentity(record),
                numerator: BigInt(livingShareUnits)
            }))
        ];
        const shareByKey = allocationsByKey(apportionLargestRemainder({
            denominator,
            claims: shareClaims,
            targetTotal: livingShareUnits
        }));
        const combined = [...living, ...children];

        const maxHpByKey = allocationsByKey(apportionLargestRemainder({
            denominator: BigInt(this.scale),
            targetTotal: livingMaxHpTotal,
            claims: combined.map((record) => ({
                ...createClaimIdentity(record),
                numerator: BigInt(this.runBaseMaxHpFixedPoint)
                    * BigInt(shareByKey.get(record.logicalTowerId))
            }))
        }));
        for (const record of combined) {
            if (shareByKey.get(record.logicalTowerId) > 0
                && maxHpByKey.get(record.logicalTowerId) === 0) {
                return freezeRejectedPlan(
                    TOWER_CREATION_RESULT.REJECTED_NON_VIABLE_HEALTH,
                    TOWER_CREATION_REASON.NON_VIABLE_DERIVED_HEALTH,
                    { nonViableLogicalTowerId: record.logicalTowerId }
                );
            }
        }

        const powerByKey = allocationsByKey(apportionLargestRemainder({
            denominator: BigInt(this.scale),
            targetTotal: livingPowerTotal,
            claims: combined.map((record) => ({
                ...createClaimIdentity(record),
                numerator: BigInt(this.runBasePowerFixedPoint)
                    * BigInt(shareByKey.get(record.logicalTowerId))
            }))
        }));
        const totalLivingCurrentHp = sumSafeIntegers(
            living,
            (record) => record.currentHpFixedPoint,
            'living currentHpFixedPoint'
        );
        const currentHpByKey = allocationsByKey(apportionLargestRemainder({
            denominator,
            targetTotal: totalLivingCurrentHp,
            claims: [
                ...living.map((record) => ({
                    ...createClaimIdentity(record),
                    numerator: BigInt(record.currentHpFixedPoint) * livingCount,
                    cap: maxHpByKey.get(record.logicalTowerId)
                })),
                ...children.map((record) => ({
                    ...createClaimIdentity(record),
                    numerator: BigInt(totalLivingCurrentHp),
                    cap: maxHpByKey.get(record.logicalTowerId)
                }))
            ]
        }));

        const allocations = combined.map((record) => Object.freeze({
            logicalTowerId: record.logicalTowerId,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            shareUnits: shareByKey.get(record.logicalTowerId),
            currentHpFixedPoint: currentHpByKey.get(record.logicalTowerId),
            maxHpFixedPoint: maxHpByKey.get(record.logicalTowerId),
            powerFixedPoint: powerByKey.get(record.logicalTowerId),
            existing: living.includes(record)
        }));
        return Object.freeze({
            accepted: true,
            result: null,
            reason: null,
            livingShareUnits,
            lostShareUnits: this.lostShareUnits,
            totalLivingCurrentHp,
            allocations: Object.freeze(allocations)
        });
    }

    commitLostShare(shareUnits) {
        this.#assertUsable();
        const units = requireShareUnits(shareUnits, 'deadTower.shareUnits');
        if (units <= 0 || this.lostShareUnits > this.scale - units) {
            throw new Error('Lost Share commit이 Tower Share invariant를 초과합니다.');
        }
        this.lostShareUnits += units;
        return this.lostShareUnits;
    }

    auditShareInvariant(livingRecords) {
        const livingShareUnits = sumSafeIntegers(
            livingRecords,
            (record) => requireShareUnits(record.shareUnits),
            'living shareUnits'
        );
        return Object.freeze({
            valid: livingShareUnits + this.lostShareUnits === this.scale,
            scale: this.scale,
            livingShareUnits,
            lostShareUnits: this.lostShareUnits
        });
    }

    getStatus() {
        return Object.freeze({
            scale: this.scale,
            fullShareUnits: this.scale,
            lostShareUnits: this.lostShareUnits,
            runBaseMaxHpFixedPoint: this.runBaseMaxHpFixedPoint,
            runBasePowerFixedPoint: this.runBasePowerFixedPoint,
            destroyed: this.destroyed
        });
    }

    destroy() {
        this.destroyed = true;
    }

    #assertUsable() {
        if (this.destroyed) {
            throw new Error('destroy된 TowerShareLedger는 사용할 수 없습니다.');
        }
    }
}
