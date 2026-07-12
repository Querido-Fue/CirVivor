import { getData } from 'data/data_handler.js';

const CANDIDATE_PAIR_BUFFER_CONSTANTS = getData('COLLISION_CONSTANTS').CANDIDATE_PAIR_BUFFER;
const INITIAL_PAIR_CAPACITY = CANDIDATE_PAIR_BUFFER_CONSTANTS.INITIAL_PAIR_CAPACITY;
const INITIAL_BODY_CAPACITY = CANDIDATE_PAIR_BUFFER_CONSTANTS.INITIAL_BODY_CAPACITY;

/**
 * pair buffer에서 사용할 body 개수를 정규화합니다.
 * @param {number} bodyCount - 입력 body 개수입니다.
 * @returns {number} 음수와 비정수를 0으로 보정한 body 개수입니다.
 */
function normalizeCollisionPairBodyCount(bodyCount) {
    return Number.isInteger(bodyCount) && bodyCount > 0 ? bodyCount : 0;
}

/**
 * 충돌 후보 pair와 low body별 high 중복 검사 stamp를 재사용합니다.
 */
export class CollisionCandidatePairBuffer {
    /**
     * @param {number} [initialPairCapacity=INITIAL_PAIR_CAPACITY] - 초기 pair 버퍼 용량입니다.
     * @param {number} [initialBodyCapacity=INITIAL_BODY_CAPACITY] - 초기 body stamp 용량입니다.
     */
    constructor(initialPairCapacity = INITIAL_PAIR_CAPACITY, initialBodyCapacity = INITIAL_BODY_CAPACITY) {
        this.lowIndices = new Int32Array(initialPairCapacity);
        this.highIndices = new Int32Array(initialPairCapacity);
        this.priorityLowIndices = new Int32Array(initialPairCapacity);
        this.priorityHighIndices = new Int32Array(initialPairCapacity);
        this.seenHighStamps = new Uint32Array(initialBodyCapacity);
        this.count = 0;
        this.priorityCount = 0;
        this.bodyCount = 0;
        this.stampGeneration = 0;
        this.currentLowStamp = 0;
    }

    /**
     * 현재 body 수 기준으로 pair 기록 상태를 초기화합니다.
     * @param {number} bodyCount - 현재 body 개수입니다.
     */
    reset(bodyCount) {
        const safeBodyCount = normalizeCollisionPairBodyCount(bodyCount);
        this.count = 0;
        this.priorityCount = 0;
        this.bodyCount = safeBodyCount;
        this.#ensureBodyCapacity(safeBodyCount);
    }

    /**
     * 후보 pair를 버퍼에 추가합니다.
     * @param {number} low - 낮은 body 인덱스입니다.
     * @param {number} high - 높은 body 인덱스입니다.
     * @param {boolean} [priority=false] - 현재 중첩 또는 player/wall/anchor 우선 처리 pair 여부입니다.
     */
    append(low, high, priority = false) {
        if (priority) {
            this.#ensurePriorityPairCapacity(this.priorityCount + 1);
            this.priorityLowIndices[this.priorityCount] = low;
            this.priorityHighIndices[this.priorityCount] = high;
            this.priorityCount++;
            return;
        }

        this.#ensurePairCapacity(this.count + 1);
        this.lowIndices[this.count] = low;
        this.highIndices[this.count] = high;
        this.count++;
    }

    /**
     * 새 low body의 bucket 조회를 시작하고 중복 검사 token을 전진합니다.
     */
    beginLowBody() {
        let nextGeneration = (this.stampGeneration + 1) >>> 0;
        if (nextGeneration === 0) {
            this.seenHighStamps.fill(0);
            nextGeneration = 1;
        }
        this.stampGeneration = nextGeneration;
        this.currentLowStamp = nextGeneration;
    }

    /**
     * 현재 low body 조회에서 high body가 이미 방문되었는지 반환합니다.
     * @param {number} high - 검사할 높은 body 인덱스입니다.
     * @returns {boolean} 이미 방문했으면 true입니다.
     */
    hasSeenHigh(high) {
        return this.seenHighStamps[high] === this.currentLowStamp;
    }

    /**
     * 현재 low body 조회에서 high body를 방문한 상태로 표시합니다.
     * @param {number} high - 표시할 높은 body 인덱스입니다.
     */
    markSeenHigh(high) {
        this.seenHighStamps[high] = this.currentLowStamp;
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

    /**
     * 우선 후보 pair 인덱스 버퍼 용량을 확보합니다.
     * @param {number} pairCount - 필요한 pair 개수입니다.
     * @private
     */
    #ensurePriorityPairCapacity(pairCount) {
        if (this.priorityLowIndices.length >= pairCount) {
            return;
        }

        const nextCapacity = Math.max(pairCount, this.priorityLowIndices.length * 2);
        const nextLowIndices = new Int32Array(nextCapacity);
        const nextHighIndices = new Int32Array(nextCapacity);
        nextLowIndices.set(this.priorityLowIndices);
        nextHighIndices.set(this.priorityHighIndices);
        this.priorityLowIndices = nextLowIndices;
        this.priorityHighIndices = nextHighIndices;
    }

    /**
     * body별 중복 검사 stamp 용량을 확보합니다.
     * @param {number} bodyCount - 필요한 body 개수입니다.
     * @private
     */
    #ensureBodyCapacity(bodyCount) {
        if (this.seenHighStamps.length >= bodyCount) {
            return;
        }

        const nextCapacity = Math.max(bodyCount, this.seenHighStamps.length * 2);
        const nextStamps = new Uint32Array(nextCapacity);
        nextStamps.set(this.seenHighStamps);
        this.seenHighStamps = nextStamps;
    }
}
