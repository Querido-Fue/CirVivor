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
     */
    constructor(createFn, resetFn = null, name = null) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.createdCount = 0;
        this.name = name;
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
            return item;
        }
        this.createdCount++;
        return this.createFn();
    }

    /**
     * 객체를 풀에 반납합니다.
     * @param {T} item - 반납할 객체
     */
    release(item) {
        this.pool.push(item);
    }

    /**
     * 지정된 갯수만큼 객체를 미리 풀에 생성해 둡니다. (프레임 드랍 방지용)
     * @param {number} count - 미리 생성할 객체 수
     */
    warmUp(count) {
        const safeCount = Math.floor(clampFiniteNumber(Number(count), 0, Infinity, 0));
        for (let i = 0; i < safeCount; i++) {
            this.pool.push(this.createFn());
            this.createdCount++;
        }
    }

    /**
     * 풀을 비웁니다.
     */
    clear() {
        this.pool = [];
    }
}
