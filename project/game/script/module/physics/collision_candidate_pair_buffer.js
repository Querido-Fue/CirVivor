/**
 * 충돌 후보 pair 인덱스와 중복 검사 bitset을 재사용 버퍼로 관리합니다.
 */
export class CollisionCandidatePairBuffer {
    /**
     * @param {number} [initialPairCapacity=1024] - 초기 pair 버퍼 용량입니다.
     * @param {number} [initialBitmapWordCapacity=512] - 초기 bitset word 용량입니다.
     */
    constructor(initialPairCapacity = 1024, initialBitmapWordCapacity = 512) {
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
        const safeBodyCount = Number.isInteger(bodyCount) && bodyCount > 0 ? bodyCount : 0;
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
        return (this.pairBitmap[bitIndex >>> 5] & (1 << (bitIndex & 31))) !== 0;
    }

    /**
     * pair를 기록된 상태로 표시합니다.
     * @param {number} low - 낮은 body 인덱스입니다.
     * @param {number} high - 높은 body 인덱스입니다.
     */
    markPair(low, high) {
        const bitIndex = low * this.bodyCount + high;
        this.pairBitmap[bitIndex >>> 5] |= (1 << (bitIndex & 31));
    }

    /**
     * pair bitset 용량을 확보하고 현재 사용 영역을 초기화합니다.
     * @param {number} bodyCount - 현재 body 개수입니다.
     * @private
     */
    #ensurePairBitmap(bodyCount) {
        const neededWords = Math.ceil((bodyCount * bodyCount) / 32);
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
