/**
 * 캐시가 현재 fixed frame 토큰에 속하는지 반환합니다.
 * @param {object} cache - enemy body 캐시입니다.
 * @param {number} frameToken - 현재 fixed frame 토큰입니다.
 * @returns {boolean} 같은 프레임이면 true입니다.
 */
function isCollisionEnemyBodyCacheFrameReusable(cache, frameToken) {
    return cache.frameToken === frameToken;
}

/**
 * 캐시가 같은 enemy 배열을 기준으로 만들어졌는지 반환합니다.
 * @param {object} cache - enemy body 캐시입니다.
 * @param {object[]} enemies - 요청 enemy 배열입니다.
 * @returns {boolean} 같은 enemy 배열이면 true입니다.
 */
function isCollisionEnemyBodyCacheSourceReusable(cache, enemies) {
    return Array.isArray(enemies) && cache.enemies === enemies && cache.sourceLength === enemies.length;
}

/**
 * 캐시 생성 delta와 요청 delta가 허용 오차 안에 있는지 반환합니다.
 * @param {object} cache - enemy body 캐시입니다.
 * @param {number} delta - 요청 delta입니다.
 * @param {number} epsilon - delta 비교 허용 오차입니다.
 * @returns {boolean} delta 차이가 허용 범위 안이면 true입니다.
 */
function isCollisionEnemyBodyCacheDeltaReusable(cache, delta, epsilon) {
    return !(Math.abs(cache.delta - delta) > epsilon);
}

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
        if (!isCollisionEnemyBodyCacheFrameReusable(cache, this.frameToken)) {
            return null;
        }
        if (!isCollisionEnemyBodyCacheSourceReusable(cache, enemies)) {
            return null;
        }
        if (!isCollisionEnemyBodyCacheDeltaReusable(cache, delta, epsilon)) {
            return null;
        }
        return Array.isArray(cache.bodies) ? cache.bodies : null;
    }
}
