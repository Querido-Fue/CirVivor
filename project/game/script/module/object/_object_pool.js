import { clampFiniteNumber } from 'util/number_util.js';

/**
 * 활성화된 모든 오브젝트 풀의 참조를 저장합니다. 디버그 표시에 사용됩니다.
 * @type {Object.<string, ObjectPool>}
 */
export const activeObjectPools = {};

/**
 * @class ObjectPool
 * @description 객체 재사용을 위한 풀링 시스템입니다. 가비지 콜렉션 부하를 줄여 성능을 최적화합니다.
 * @template T
 */

export class ObjectPool {
    /**
     * 객체 풀을 생성합니다.
     * @param {Function} createFn - 새 객체를 생성하는 함수입니다.
     * @param {?Function} [resetFn=null] - 객체를 재사용하기 전에 초기화하는 함수입니다.
     * @param {?string} [name=null] - 디버그 목록에 등록할 풀 이름입니다.
     * @param {number} [maxRetained=Infinity] - 풀에 보관할 최대 유휴 객체 수입니다.
     */
    constructor(createFn, resetFn = null, name = null, maxRetained = Infinity) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.createdCount = 0;
        this.liveCount = 0;
        this.inUseCount = 0;
        this.discardedCount = 0;
        this.name = name;
        this.maxRetained = Number.isFinite(maxRetained)
            ? Math.max(0, Math.floor(maxRetained))
            : Infinity;
        if (name) {
            activeObjectPools[name] = this;
        }
    }

    /**
     * 풀에서 객체를 가져옵니다. 풀이 비어있으면 새로 생성합니다.
     * @returns {T} 사용할 객체
     */
    get() {
        if (this.pool.length > 0) {
            const item = this.pool.pop();
            if (this.resetFn) {
                this.resetFn(item);
            }
            this.inUseCount++;
            return item;
        }
        this.createdCount++;
        this.liveCount++;
        this.inUseCount++;
        return this.createFn();
    }

    /**
     * 객체를 풀에 반납합니다.
     * @param {T} item - 반납할 객체
     * @returns {boolean} 풀에 보관했는지 여부입니다.
     */
    release(item) {
        this.inUseCount = Math.max(0, this.inUseCount - 1);
        if (this.pool.length >= this.maxRetained) {
            this.liveCount = Math.max(this.inUseCount, this.liveCount - 1);
            this.discardedCount++;
            return false;
        }
        this.pool.push(item);
        return true;
    }

    /**
     * 지정된 갯수만큼 객체를 미리 풀에 생성해 둡니다. (프레임 드랍 방지용)
     * @param {number} count - 미리 생성할 객체 수
     */
    warmUp(count) {
        const safeCount = Math.floor(clampFiniteNumber(Number(count), 0, Infinity, 0));
        const availableCapacity = Number.isFinite(this.maxRetained)
            ? Math.max(0, this.maxRetained - this.pool.length)
            : safeCount;
        const createCount = Math.min(safeCount, availableCapacity);
        for (let i = 0; i < createCount; i++) {
            this.pool.push(this.createFn());
            this.createdCount++;
            this.liveCount++;
        }
    }

    /**
     * 풀을 비웁니다.
     */
    clear() {
        this.discardedCount += this.pool.length;
        this.liveCount = Math.max(this.inUseCount, this.liveCount - this.pool.length);
        this.pool.length = 0;
    }
}
