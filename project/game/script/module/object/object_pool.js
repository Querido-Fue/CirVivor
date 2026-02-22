/**
 * @class ObjectPool
 * @description 객체 재사용을 위한 풀링 시스템입니다. 가비지 컬렉션 부하를 줄여 성능을 최적화합니다.
 * @template T
 */
export class ObjectPool {
    /**
     * @param {Function} createFn - 새로운 객체를 생성하는 팩토리 함수
     * @param {Function} resetFn - 객체를 재사용하기 전에 초기화하는 함수 (선택 사항)
     */
    constructor(createFn, resetFn = null) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
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
        for (let i = 0; i < count; i++) {
            this.pool.push(this.createFn());
        }
    }

    /**
     * 풀을 비웁니다.
     */
    clear() {
        this.pool = [];
    }
}
