const EPSILON = 1e-6;

/**
 * @class CollisionDetector
 * @description 원형 충돌 협의(narrow phase)와 해소 벡터 계산을 담당합니다.
 */
export class CollisionDetector {
    /**
     * 원 vs 원 충돌 판정
     * @param {object} circleA {x, y, radius, weight, movable}
     * @param {object} circleB {x, y, radius, weight, movable}
     * @param {boolean} [resolve=false]
     * @param {object|null} [out=null]
     * @returns {object|null}
     */
    circleVsCircle(circleA, circleB, resolve = false, out = null) {
        const dx = circleB.x - circleA.x;
        const dy = circleB.y - circleA.y;
        const radiusSum = circleA.radius + circleB.radius;
        const distSq = (dx * dx) + (dy * dy);
        if (distSq >= (radiusSum * radiusSum)) return null;

        let nx = 1;
        let ny = 0;
        let distance = Math.sqrt(distSq);
        if (distance > EPSILON) {
            nx = dx / distance;
            ny = dy / distance;
        } else {
            distance = 0;
        }

        const manifold = this.#writeManifold(
            out,
            nx,
            ny,
            radiusSum - distance,
            circleA.x + (nx * circleA.radius),
            circleA.y + (ny * circleA.radius)
        );

        return resolve ? this.addResolution(manifold, circleA, circleB) : manifold;
    }

    /**
     * manifold에 resolve 이동량을 추가합니다.
     * @param {object|null} manifold
     * @param {object|null} bodyA
     * @param {object|null} bodyB
     * @returns {object|null}
     */
    addResolution(manifold, bodyA, bodyB) {
        if (!manifold) return null;

        const movableA = bodyA?.movable !== false;
        const movableB = bodyB?.movable !== false;

        const weightA = Math.max(EPSILON, Number.isFinite(bodyA?.weight) ? bodyA.weight : 1);
        const weightB = Math.max(EPSILON, Number.isFinite(bodyB?.weight) ? bodyB.weight : 1);
        const penetration = manifold.penetration;

        let ratioA = 0;
        let ratioB = 0;

        if (movableA && movableB) {
            const sum = weightA + weightB;
            ratioA = weightB / sum;
            ratioB = weightA / sum;
        } else if (movableA) {
            ratioA = 1;
        } else if (movableB) {
            ratioB = 1;
        }

        manifold.moveAX = -manifold.normalX * penetration * ratioA;
        manifold.moveAY = -manifold.normalY * penetration * ratioA;
        manifold.moveBX = manifold.normalX * penetration * ratioB;
        manifold.moveBY = manifold.normalY * penetration * ratioB;
        return manifold;
    }

    /**
     * manifold 출력 객체를 채웁니다.
     * @private
     * @param {object|null} out
     * @param {number} normalX
     * @param {number} normalY
     * @param {number} penetration
     * @param {number} pointX
     * @param {number} pointY
     * @returns {object}
     */
    #writeManifold(out, normalX, normalY, penetration, pointX, pointY) {
        const manifold = out || {};
        manifold.collided = true;
        manifold.normalX = normalX;
        manifold.normalY = normalY;
        manifold.penetration = penetration;
        manifold.pointX = pointX;
        manifold.pointY = pointY;
        manifold.moveAX = 0;
        manifold.moveAY = 0;
        manifold.moveBX = 0;
        manifold.moveBY = 0;
        return manifold;
    }
}
