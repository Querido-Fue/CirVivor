import { fingerprintR8Record } from '../contract/r8_fingerprint_contract.js';

const UINT32_RANGE = 0x100000000;
const ZERO_SEED_REPLACEMENT = 0x6d2b79f5;

function requireUint32(value, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)
        || value < 0 || value > 0xffffffff) {
        throw new RangeError(`${label}은 uint32여야 합니다.`);
    }
    return value >>> 0;
}

export function createDeterministicShopSeed(source) {
    return fingerprintR8Record('word-shop-seed.r8', source, 'wordShopSeed');
}

/** R8 Shop 전용 uint32 deterministic stream입니다. */
export class DeterministicShopRng {
    constructor(seed) {
        const normalized = requireUint32(seed, 'shop rng seed');
        this.state = normalized === 0 ? ZERO_SEED_REPLACEMENT : normalized;
        this.drawCount = 0;
        this.rejectedDrawCount = 0;
    }

    nextUint32() {
        let value = this.state >>> 0;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        this.state = value >>> 0;
        this.drawCount++;
        return this.state;
    }

    /** Rejection sampling으로 modulo bias 없는 [0, maximumExclusive)를 반환합니다. */
    nextBounded(maximumExclusive) {
        if (typeof maximumExclusive !== 'number'
            || !Number.isSafeInteger(maximumExclusive)
            || maximumExclusive <= 0
            || maximumExclusive > UINT32_RANGE) {
            throw new RangeError('maximumExclusive는 1..2^32 범위여야 합니다.');
        }
        const acceptanceLimit = Math.floor(
            UINT32_RANGE / maximumExclusive
        ) * maximumExclusive;
        while (true) {
            const value = this.nextUint32();
            if (value < acceptanceLimit) return value % maximumExclusive;
            this.rejectedDrawCount++;
        }
    }

    getStatus() {
        return Object.freeze({
            state: this.state,
            drawCount: this.drawCount,
            rejectedDrawCount: this.rejectedDrawCount
        });
    }
}

export function selectWeightedWithoutReplacement(records, count, rng) {
    if (!Array.isArray(records) || records.length < count) {
        throw new RangeError('weighted selection pool이 요청 count보다 작습니다.');
    }
    if (!rng || typeof rng.nextBounded !== 'function') {
        throw new TypeError('DeterministicShopRng가 필요합니다.');
    }
    if (!Number.isSafeInteger(count) || count <= 0) {
        throw new RangeError('weighted selection count는 양의 정수여야 합니다.');
    }
    const candidates = Array.from(records);
    const selected = [];
    while (selected.length < count) {
        let totalWeight = 0;
        for (const candidate of candidates) {
            const weight = candidate?.offerWeight;
            if (!Number.isSafeInteger(weight) || weight <= 0) {
                throw new RangeError('offerWeight는 양의 정수여야 합니다.');
            }
            totalWeight += weight;
        }
        if (!Number.isSafeInteger(totalWeight)
            || totalWeight <= 0 || totalWeight > 0xffffffff) {
            throw new RangeError('weighted selection totalWeight가 uint32를 벗어났습니다.');
        }
        let ticket = rng.nextBounded(totalWeight);
        let selectedIndex = candidates.length - 1;
        for (let index = 0; index < candidates.length; index++) {
            if (ticket < candidates[index].offerWeight) {
                selectedIndex = index;
                break;
            }
            ticket -= candidates[index].offerWeight;
        }
        selected.push(candidates[selectedIndex]);
        candidates.splice(selectedIndex, 1);
    }
    return Object.freeze(selected);
}
