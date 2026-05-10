import { getData } from 'data/data_handler.js';
import { createCollisionGridBucket } from './collision_scratch_objects.js';

const GRID_BUCKET_INITIAL_CAPACITY = getData('COLLISION_CONSTANTS').GRID.BUCKET_INITIAL_CAPACITY;

/**
 * broad-phase grid bucket 객체와 인덱스 버퍼 용량을 재사용 관리합니다.
 */
export class CollisionGridBucketPool {
    /**
     * grid bucket 풀을 생성합니다.
     */
    constructor() {
        this.items = [];
        this.cursor = 0;
    }

    /**
     * 활성 bucket 목록을 비우고 pool cursor를 되돌립니다.
     * @param {object[]} activeBuckets - 현재 활성 bucket 목록입니다.
     */
    resetActiveBuckets(activeBuckets) {
        for (let i = 0; i < activeBuckets.length; i++) {
            activeBuckets[i].count = 0;
        }
        activeBuckets.length = 0;
        this.cursor = 0;
    }

    /**
     * grid bucket 객체를 반환합니다.
     * @returns {object} 재사용 가능한 grid bucket입니다.
     */
    acquire() {
        if (this.cursor >= this.items.length) {
            this.items.push(createCollisionGridBucket(GRID_BUCKET_INITIAL_CAPACITY));
        }

        const bucket = this.items[this.cursor++];
        bucket.count = 0;
        return bucket;
    }

    /**
     * bucket의 인덱스 버퍼에 body 인덱스를 추가합니다.
     * @param {object} bucket - 대상 bucket입니다.
     * @param {number} bodyIndex - 추가할 body 인덱스입니다.
     */
    pushIndex(bucket, bodyIndex) {
        if (bucket.count >= bucket.indices.length) {
            const next = new Int32Array(bucket.indices.length * 2);
            next.set(bucket.indices);
            bucket.indices = next;
        }
        bucket.indices[bucket.count++] = bodyIndex;
    }
}
