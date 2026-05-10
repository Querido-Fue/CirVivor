import { getData } from 'data/data_handler.js';

const CANDIDATE_PAIR_BUFFER_CONSTANTS = getData('COLLISION_CONSTANTS').CANDIDATE_PAIR_BUFFER;
const INITIAL_PAIR_CAPACITY = CANDIDATE_PAIR_BUFFER_CONSTANTS.INITIAL_PAIR_CAPACITY;
const INITIAL_BITMAP_WORD_CAPACITY = CANDIDATE_PAIR_BUFFER_CONSTANTS.INITIAL_BITMAP_WORD_CAPACITY;
const BIT_WORD_SIZE = CANDIDATE_PAIR_BUFFER_CONSTANTS.BIT_WORD_SIZE;
const BIT_WORD_SHIFT = CANDIDATE_PAIR_BUFFER_CONSTANTS.BIT_WORD_SHIFT;
const BIT_WORD_MASK = CANDIDATE_PAIR_BUFFER_CONSTANTS.BIT_WORD_MASK;

/**
 * pair buffer에서 사용할 body 개수를 정규화합니다.
 * @param {number} bodyCount - 입력 body 개수입니다.
 * @returns {number} 음수와 비정수를 0으로 보정한 body 개수입니다.
 */
function normalizeCollisionPairBodyCount(bodyCount) {
    return Number.isInteger(bodyCount) && bodyCount > 0 ? bodyCount : 0;
}

/**
 * body 개수에 필요한 pair bitset word 수를 반환합니다.
 * @param {number} bodyCount - 정규화된 body 개수입니다.
 * @returns {number} 필요한 Uint32 word 개수입니다.
 */
function getCollisionPairBitmapWordCount(bodyCount) {
    return Math.ceil((bodyCount * bodyCount) / BIT_WORD_SIZE);
}

/**
 * 충돌 후보 pair 인덱스와 중복 검사 bitset을 재사용 버퍼로 관리합니다.
 */
export class CollisionCandidatePairBuffer {
    /**
     * @param {number} [initialPairCapacity=INITIAL_PAIR_CAPACITY] - 초기 pair 버퍼 용량입니다.
     * @param {number} [initialBitmapWordCapacity=INITIAL_BITMAP_WORD_CAPACITY] - 초기 bitset word 용량입니다.
     */
    constructor(initialPairCapacity = INITIAL_PAIR_CAPACITY, initialBitmapWordCapacity = INITIAL_BITMAP_WORD_CAPACITY) {
        this.lowIndices = new Int32Array(initialPairCapacity);
        this.highIndices = new Int32Array(initialPairCapacity);
        this.pairBitmap = new Uint32Array(initialBitmapWordCapacity);
        this.count = 0;
        this.bodyCount = 0;
    }

    /**
     * 현재 body 수 기준으로 pair 기록 상태를 초기화합니다.
     * @param {number} bodyCount - 현재 body 개수입니다.
     */
    reset(bodyCount) {
        const safeBodyCount = normalizeCollisionPairBodyCount(bodyCount);
        this.count = 0;
        this.bodyCount = safeBodyCount;
        this.#ensurePairBitmap(safeBodyCount);
    }

    /**
     * 후보 pair를 버퍼에 추가합니다.
     * @param {number} low - 낮은 body 인덱스입니다.
     * @param {number} high - 높은 body 인덱스입니다.
     */
    append(low, high) {
        this.#ensurePairCapacity(this.count + 1);
        this.lowIndices[this.count] = low;
        this.highIndices[this.count] = high;
        this.count++;
    }

    /**
     * pair가 이미 기록되었는지 반환합니다.
     * @param {number} low - 낮은 body 인덱스입니다.
     * @param {number} high - 높은 body 인덱스입니다.
     * @returns {boolean} 이미 기록된 pair인지 여부입니다.
     */
    hasPair(low, high) {
        const bitIndex = low * this.bodyCount + high;
        return (this.pairBitmap[bitIndex >>> BIT_WORD_SHIFT] & (1 << (bitIndex & BIT_WORD_MASK))) !== 0;
    }

    /**
     * pair를 기록된 상태로 표시합니다.
     * @param {number} low - 낮은 body 인덱스입니다.
     * @param {number} high - 높은 body 인덱스입니다.
     */
    markPair(low, high) {
        const bitIndex = low * this.bodyCount + high;
        this.pairBitmap[bitIndex >>> BIT_WORD_SHIFT] |= (1 << (bitIndex & BIT_WORD_MASK));
    }

    /**
     * pair bitset 용량을 확보하고 현재 사용 영역을 초기화합니다.
     * @param {number} bodyCount - 현재 body 개수입니다.
     * @private
     */
    #ensurePairBitmap(bodyCount) {
        const neededWords = getCollisionPairBitmapWordCount(bodyCount);
        if (this.pairBitmap.length < neededWords) {
            this.pairBitmap = new Uint32Array(Math.max(neededWords, this.pairBitmap.length * 2));
        }
        this.pairBitmap.fill(0, 0, neededWords);
    }

    /**
     * 후보 pair 인덱스 버퍼 용량을 확보합니다.
     * @param {number} pairCount - 필요한 pair 개수입니다.
     * @private
     */
    #ensurePairCapacity(pairCount) {
        if (this.lowIndices.length >= pairCount) {
            return;
        }

        const nextCapacity = Math.max(pairCount, this.lowIndices.length * 2);
        const nextLowIndices = new Int32Array(nextCapacity);
        const nextHighIndices = new Int32Array(nextCapacity);
        nextLowIndices.set(this.lowIndices);
        nextHighIndices.set(this.highIndices);
        this.lowIndices = nextLowIndices;
        this.highIndices = nextHighIndices;
    }
}
