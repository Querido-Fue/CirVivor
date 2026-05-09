/**
 * 같은 fixed frame에서 같은 enemy 배열로 만든 body 목록을 재사용합니다.
 */
export class CollisionEnemyBodyCache {
    /**
     * @param {object[]} fallbackBodies - 초기 캐시 body 배열입니다.
     */
    constructor(fallbackBodies = []) {
        this.frameToken = 0;
        this.cache = {
            frameToken: -1,
            enemies: null,
            delta: 0,
            sourceLength: 0,
            bodies: fallbackBodies
        };
    }

    /**
     * fixed frame 토큰을 갱신하고 기존 캐시를 무효화합니다.
     */
    advanceFrame() {
        this.frameToken++;
        this.invalidate();
    }

    /**
     * enemy body 재사용 캐시를 무효화합니다.
     */
    invalidate() {
        this.cache.frameToken = -1;
        this.cache.enemies = null;
        this.cache.delta = 0;
        this.cache.sourceLength = 0;
    }

    /**
     * 현재 fixed frame에서 같은 enemy 배열로 만든 body를 캐시에 기록합니다.
     * @param {object[]} enemies - 원본 enemy 배열입니다.
     * @param {number} delta - body 생성에 사용한 delta입니다.
     * @param {object[]} bodies - 생성된 body 배열입니다.
     */
    store(enemies, delta, bodies) {
        this.cache.frameToken = this.frameToken;
        this.cache.enemies = enemies;
        this.cache.delta = delta;
        this.cache.sourceLength = Array.isArray(enemies) ? enemies.length : 0;
        this.cache.bodies = bodies;
    }

    /**
     * 같은 fixed frame에서 같은 enemy 배열과 delta로 만든 body를 반환합니다.
     * @param {object[]} enemies - 원본 enemy 배열입니다.
     * @param {number} delta - 요청 delta입니다.
     * @param {number} epsilon - delta 비교 허용 오차입니다.
     * @returns {object[]|null} 재사용 가능한 body 배열입니다.
     */
    getReusable(enemies, delta, epsilon) {
        const cache = this.cache;
        if (cache.frameToken !== this.frameToken) {
            return null;
        }
        if (!Array.isArray(enemies) || cache.enemies !== enemies || cache.sourceLength !== enemies.length) {
            return null;
        }
        if (Math.abs(cache.delta - delta) > epsilon) {
            return null;
        }
        return Array.isArray(cache.bodies) ? cache.bodies : null;
    }
}
