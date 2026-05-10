import { createCollisionBody } from './collision_scratch_objects.js';

/**
 * 충돌 body 객체를 프레임 단위로 재사용하는 풀입니다.
 */
export class CollisionBodyPool {
    /**
     * 프레임 재사용 body 풀을 생성합니다.
     */
    constructor() {
        this.items = [];
        this.cursor = 0;
    }

    /**
     * 다음 body 세대 시작 위치로 풀 커서를 되돌립니다.
     */
    reset() {
        this.cursor = 0;
    }

    /**
     * 재사용 가능한 충돌 body 객체를 반환합니다.
     * @returns {object} 충돌 body 객체입니다.
     */
    acquire() {
        if (this.cursor >= this.items.length) {
            this.items.push(createCollisionBody());
        }

        return this.items[this.cursor++];
    }
}
