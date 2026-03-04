const EPSILON = 1e-6;

/**
 * @class CollisionDetector
 * @description 충돌 협의(narrow phase)를 담당합니다.
 * 다각형은 볼록 폴리곤을 전제로 합니다.
 */
export class CollisionDetector {
    /**
     * 원 vs 원 충돌 판정
     * @param {object} circleA {x, y, radius, weight, movable}
     * @param {object} circleB {x, y, radius, weight, movable}
     * @param {boolean} [resolve=false]
     * @returns {object|null}
     */
    circleVsCircle(circleA, circleB, resolve = false) {
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

        const manifold = {
            collided: true,
            normalX: nx,
            normalY: ny,
            penetration: radiusSum - distance,
            pointX: circleA.x + (nx * circleA.radius),
            pointY: circleA.y + (ny * circleA.radius)
        };

        return resolve ? this.addResolution(manifold, circleA, circleB) : manifold;
    }

    /**
     * 다각형 vs 다각형 충돌 판정 (SAT)
     * @param {number[]} pointsA [x0,y0,x1,y1,...]
     * @param {number[]} pointsB [x0,y0,x1,y1,...]
     * @param {boolean} [resolve=false]
     * @param {object|null} [bodyA=null]
     * @param {object|null} [bodyB=null]
     * @returns {object|null}
     */
    polygonVsPolygon(pointsA, pointsB, resolve = false, bodyA = null, bodyB = null) {
        if (!pointsA || !pointsB || pointsA.length < 6 || pointsB.length < 6) return null;

        let minOverlap = Number.POSITIVE_INFINITY;
        let bestNormalX = 1;
        let bestNormalY = 0;

        const centerA = this.#computePolygonCenter(pointsA);
        const centerB = this.#computePolygonCenter(pointsB);

        if (!this.#testAxes(pointsA, pointsA, pointsB, centerA, centerB, (overlap, nx, ny) => {
            if (overlap < minOverlap) {
                minOverlap = overlap;
                bestNormalX = nx;
                bestNormalY = ny;
            }
        })) {
            return null;
        }

        if (!this.#testAxes(pointsB, pointsA, pointsB, centerA, centerB, (overlap, nx, ny) => {
            if (overlap < minOverlap) {
                minOverlap = overlap;
                bestNormalX = nx;
                bestNormalY = ny;
            }
        })) {
            return null;
        }

        const manifold = {
            collided: true,
            normalX: bestNormalX,
            normalY: bestNormalY,
            penetration: minOverlap,
            pointX: (centerA.x + centerB.x) * 0.5,
            pointY: (centerA.y + centerB.y) * 0.5
        };

        if (!resolve) return manifold;
        return this.addResolution(manifold, bodyA, bodyB);
    }

    /**
     * 다각형 vs 원 충돌 판정 (SAT)
     * @param {number[]} points [x0,y0,x1,y1,...]
     * @param {object} circle {x, y, radius, weight, movable}
     * @param {boolean} [resolve=false]
     * @param {object|null} [polyBody=null]
     * @param {object|null} [circleBody=null]
     * @returns {object|null}
     */
    polygonVsCircle(points, circle, resolve = false, polyBody = null, circleBody = null) {
        if (!points || points.length < 6 || !circle) return null;

        const center = this.#computePolygonCenter(points);
        let minOverlap = Number.POSITIVE_INFINITY;
        let bestNormalX = 1;
        let bestNormalY = 0;
        const polyProj = [0, 0];

        const pointCount = points.length;
        for (let i = 0; i < pointCount; i += 2) {
            const j = (i + 2) % pointCount;
            const edgeX = points[j] - points[i];
            const edgeY = points[j + 1] - points[i + 1];

            let axisX = -edgeY;
            let axisY = edgeX;
            const axisLen = Math.hypot(axisX, axisY);
            if (axisLen <= EPSILON) continue;
            axisX /= axisLen;
            axisY /= axisLen;

            this.#projectPolygon(points, axisX, axisY, polyProj);
            const circleCenterProj = (circle.x * axisX) + (circle.y * axisY);
            const circleMin = circleCenterProj - circle.radius;
            const circleMax = circleCenterProj + circle.radius;

            const overlap = Math.min(polyProj[1], circleMax) - Math.max(polyProj[0], circleMin);
            if (overlap <= 0) return null;

            if (overlap < minOverlap) {
                const direction = ((circle.x - center.x) * axisX) + ((circle.y - center.y) * axisY);
                bestNormalX = direction >= 0 ? axisX : -axisX;
                bestNormalY = direction >= 0 ? axisY : -axisY;
                minOverlap = overlap;
            }
        }

        // 폴리곤의 가장 가까운 꼭짓점 축 보강
        let closestX = points[0];
        let closestY = points[1];
        let closestDistSq = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pointCount; i += 2) {
            const dx = points[i] - circle.x;
            const dy = points[i + 1] - circle.y;
            const d2 = (dx * dx) + (dy * dy);
            if (d2 < closestDistSq) {
                closestDistSq = d2;
                closestX = points[i];
                closestY = points[i + 1];
            }
        }

        let axisX = circle.x - closestX;
        let axisY = circle.y - closestY;
        const axisLen = Math.hypot(axisX, axisY);
        if (axisLen > EPSILON) {
            axisX /= axisLen;
            axisY /= axisLen;
            this.#projectPolygon(points, axisX, axisY, polyProj);
            const circleCenterProj = (circle.x * axisX) + (circle.y * axisY);
            const circleMin = circleCenterProj - circle.radius;
            const circleMax = circleCenterProj + circle.radius;
            const overlap = Math.min(polyProj[1], circleMax) - Math.max(polyProj[0], circleMin);
            if (overlap <= 0) return null;
            if (overlap < minOverlap) {
                bestNormalX = axisX;
                bestNormalY = axisY;
                minOverlap = overlap;
            }
        }

        const manifold = {
            collided: true,
            normalX: bestNormalX,
            normalY: bestNormalY,
            penetration: minOverlap,
            pointX: circle.x - (bestNormalX * circle.radius),
            pointY: circle.y - (bestNormalY * circle.radius)
        };

        if (!resolve) return manifold;
        return this.addResolution(manifold, polyBody, circleBody);
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
     * @private
     */
    #testAxes(edgeSource, polyA, polyB, centerA, centerB, onOverlap) {
        const count = edgeSource.length;
        const projA = [0, 0];
        const projB = [0, 0];
        for (let i = 0; i < count; i += 2) {
            const j = (i + 2) % count;
            const edgeX = edgeSource[j] - edgeSource[i];
            const edgeY = edgeSource[j + 1] - edgeSource[i + 1];
            let axisX = -edgeY;
            let axisY = edgeX;
            const axisLen = Math.hypot(axisX, axisY);
            if (axisLen <= EPSILON) continue;
            axisX /= axisLen;
            axisY /= axisLen;

            this.#projectPolygon(polyA, axisX, axisY, projA);
            this.#projectPolygon(polyB, axisX, axisY, projB);
            const overlap = Math.min(projA[1], projB[1]) - Math.max(projA[0], projB[0]);
            if (overlap <= 0) return false;

            const direction = ((centerB.x - centerA.x) * axisX) + ((centerB.y - centerA.y) * axisY);
            const nx = direction >= 0 ? axisX : -axisX;
            const ny = direction >= 0 ? axisY : -axisY;
            onOverlap(overlap, nx, ny);
        }
        return true;
    }

    /**
     * @private
     */
    #projectPolygon(points, axisX, axisY, out) {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let i = 0; i < points.length; i += 2) {
            const proj = (points[i] * axisX) + (points[i + 1] * axisY);
            if (proj < min) min = proj;
            if (proj > max) max = proj;
        }
        out[0] = min;
        out[1] = max;
    }

    /**
     * @private
     */
    #computePolygonCenter(points) {
        let sx = 0;
        let sy = 0;
        const count = points.length / 2;
        for (let i = 0; i < points.length; i += 2) {
            sx += points[i];
            sy += points[i + 1];
        }
        return { x: sx / count, y: sy / count };
    }
}
