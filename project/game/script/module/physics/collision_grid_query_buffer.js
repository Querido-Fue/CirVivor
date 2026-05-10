import { getData } from 'data/data_handler.js';

const COLLISION_GRID_CONSTANTS = getData('COLLISION_CONSTANTS').GRID;
const CELL_KEY_OFFSET = COLLISION_GRID_CONSTANTS.CELL_KEY_OFFSET;
const CELL_KEY_STRIDE = COLLISION_GRID_CONSTANTS.CELL_KEY_STRIDE;
const GRID_QUERY_INITIAL_CAPACITY = COLLISION_GRID_CONSTANTS.QUERY_INITIAL_CAPACITY;

/**
 * grid query를 실행할 수 있는 입력인지 반환합니다.
 * @param {object|null|undefined} body - query body입니다.
 * @param {number} cellSize - grid cell size입니다.
 * @param {number} bodyCount - 전체 body 개수입니다.
 * @returns {boolean} 후보 수집을 진행할 수 있으면 true입니다.
 */
function canCollectCollisionGridCandidates(body, cellSize, bodyCount) {
    return Boolean(body) && cellSize > 0 && bodyCount > 0;
}

/**
 * mark 버퍼 확장 길이를 계산합니다.
 * @param {number} currentLength - 현재 mark 버퍼 길이입니다.
 * @param {number} bodyCount - 필요한 body 개수입니다.
 * @returns {number} 새 mark 버퍼 길이입니다.
 */
function getCollisionGridMarkCapacity(currentLength, bodyCount) {
    return Math.max(bodyCount, currentLength * 2);
}

/**
 * grid query에서 방문 body를 중복 수집하지 않도록 stamp 버퍼를 관리합니다.
 */
export class CollisionGridQueryBuffer {
    /**
     * @param {number} [initialCapacity=GRID_QUERY_INITIAL_CAPACITY] - 초기 방문 마크 용량입니다.
     */
    constructor(initialCapacity = GRID_QUERY_INITIAL_CAPACITY) {
        this.marks = new Int32Array(initialCapacity);
        this.markStamp = 0;
        this.candidateIndices = [];
    }

    /**
     * 원형 query body가 현재 grid에서 겹치는 후보 인덱스를 수집합니다.
     * @param {Map<number, object>} grid - broad-phase grid입니다.
     * @param {object} body - query body입니다.
     * @param {number} cellSize - grid cell size입니다.
     * @param {number} bodyCount - 전체 body 개수입니다.
     * @returns {number[]} 수집된 후보 body 인덱스입니다.
     */
    collectCandidateIndices(grid, body, cellSize, bodyCount) {
        const candidates = this.candidateIndices;
        candidates.length = 0;
        if (!canCollectCollisionGridCandidates(body, cellSize, bodyCount)) {
            return candidates;
        }

        this.#ensureMarks(bodyCount);
        const stamp = this.#advanceStamp();
        const minCellX = Math.floor(body.minX / cellSize);
        const maxCellX = Math.floor(body.maxX / cellSize);
        const minCellY = Math.floor(body.minY / cellSize);
        const maxCellY = Math.floor(body.maxY / cellSize);

        for (let cx = minCellX; cx <= maxCellX; cx++) {
            for (let cy = minCellY; cy <= maxCellY; cy++) {
                const key = ((cx + CELL_KEY_OFFSET) * CELL_KEY_STRIDE) + (cy + CELL_KEY_OFFSET);
                const bucket = grid.get(key);
                if (!bucket || bucket.count <= 0) {
                    continue;
                }

                this.#collectBucketIndices(bucket, bodyCount, stamp, candidates);
            }
        }

        return candidates;
    }

    /**
     * 방문 마크 버퍼 크기를 확보합니다.
     * @param {number} bodyCount - 필요한 body 개수입니다.
     * @private
     */
    #ensureMarks(bodyCount) {
        if (this.marks.length >= bodyCount) {
            return;
        }

        this.marks = new Int32Array(getCollisionGridMarkCapacity(this.marks.length, bodyCount));
    }

    /**
     * 방문 stamp를 갱신합니다.
     * @returns {number} 이번 query stamp입니다.
     * @private
     */
    #advanceStamp() {
        this.markStamp++;
        if (this.markStamp < 0x7fffffff) {
            return this.markStamp;
        }

        this.marks.fill(0);
        this.markStamp = 1;
        return this.markStamp;
    }

    /**
     * bucket 내부 인덱스를 중복 없이 후보 배열에 추가합니다.
     * @param {object} bucket - grid bucket입니다.
     * @param {number} bodyCount - 전체 body 개수입니다.
     * @param {number} stamp - 이번 query stamp입니다.
     * @param {number[]} candidates - 후보 출력 배열입니다.
     * @private
     */
    #collectBucketIndices(bucket, bodyCount, stamp, candidates) {
        const indices = bucket.indices;
        for (let i = 0; i < bucket.count; i++) {
            const bodyIndex = indices[i];
            if (bodyIndex < 0 || bodyIndex >= bodyCount) {
                continue;
            }
            if (this.marks[bodyIndex] === stamp) {
                continue;
            }

            this.marks[bodyIndex] = stamp;
            candidates.push(bodyIndex);
        }
    }
}
