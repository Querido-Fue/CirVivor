const EPSILON = 1e-6;

/**
 * @typedef {object} SatAxisCache
 * @property {number} pointLength 폴리곤 점 배열 길이
 * @property {number} axisCount 축 개수
 * @property {number} edge0X 첫 번째 엣지 x
 * @property {number} edge0Y 첫 번째 엣지 y
 * @property {number} edge1X 두 번째 엣지 x
 * @property {number} edge1Y 두 번째 엣지 y
 * @property {Float32Array} normals 정규화된 축 벡터 목록 [x0,y0,x1,y1,...]
 */

/**
 * @class CollisionDetector
 * @description 충돌 협의(narrow phase)를 담당합니다.
 * 다각형은 볼록 폴리곤을 전제로 합니다.
 */
export class CollisionDetector {
    #scratchCenterA = { x: 0, y: 0 };
    #scratchCenterB = { x: 0, y: 0 };
    #scratchProjA = [0, 0];
    #scratchProjB = [0, 0];
    #scratchPolyProj = [0, 0];
    #axisCache = new WeakMap();

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
     * 다각형 vs 다각형 충돌 판정 (SAT)
     * @param {number[]} pointsA [x0,y0,x1,y1,...]
     * @param {number[]} pointsB [x0,y0,x1,y1,...]
     * @param {boolean} [resolve=false]
     * @param {object|null} [bodyA=null]
     * @param {object|null} [bodyB=null]
     * @param {object|null} [out=null]
     * @returns {object|null}
     */
    polygonVsPolygon(pointsA, pointsB, resolve = false, bodyA = null, bodyB = null, out = null) {
        if (!pointsA || !pointsB || pointsA.length < 6 || pointsB.length < 6) return null;

        let minOverlap = Number.POSITIVE_INFINITY;
        let bestNormalX = 1;
        let bestNormalY = 0;
        const axesA = this.#getPolygonAxes(pointsA);
        const axesB = this.#getPolygonAxes(pointsB);
        if (!axesA || !axesB) return null;

        const centerA = this.#computePolygonCenter(pointsA, this.#scratchCenterA);
        const centerB = this.#computePolygonCenter(pointsB, this.#scratchCenterB);

        if (!this.#testAxes(axesA, pointsA, pointsB, centerA, centerB, (overlap, nx, ny) => {
            if (overlap < minOverlap) {
                minOverlap = overlap;
                bestNormalX = nx;
                bestNormalY = ny;
            }
        })) {
            return null;
        }

        if (!this.#testAxes(axesB, pointsA, pointsB, centerA, centerB, (overlap, nx, ny) => {
            if (overlap < minOverlap) {
                minOverlap = overlap;
                bestNormalX = nx;
                bestNormalY = ny;
            }
        })) {
            return null;
        }

        const manifold = this.#writeManifold(
            out,
            bestNormalX,
            bestNormalY,
            minOverlap,
            (centerA.x + centerB.x) * 0.5,
            (centerA.y + centerB.y) * 0.5
        );

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
     * @param {object|null} [out=null]
     * @returns {object|null}
     */
    polygonVsCircle(points, circle, resolve = false, polyBody = null, circleBody = null, out = null) {
        if (!points || points.length < 6 || !circle) return null;

        const center = this.#computePolygonCenter(points, this.#scratchCenterA);
        let minOverlap = Number.POSITIVE_INFINITY;
        let bestNormalX = 1;
        let bestNormalY = 0;
        const polyProj = this.#scratchPolyProj;
        const axes = this.#getPolygonAxes(points);
        if (!axes) return null;

        for (let i = 0; i < axes.axisCount; i++) {
            const axisIndex = i * 2;
            const axisX = axes.normals[axisIndex];
            const axisY = axes.normals[axisIndex + 1];
            if (Math.abs(axisX) <= EPSILON && Math.abs(axisY) <= EPSILON) continue;

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
        const pointCount = points.length;
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

        const manifold = this.#writeManifold(
            out,
            bestNormalX,
            bestNormalY,
            minOverlap,
            circle.x - (bestNormalX * circle.radius),
            circle.y - (bestNormalY * circle.radius)
        );

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
    #testAxes(axisCache, polyA, polyB, centerA, centerB, onOverlap) {
        const count = axisCache.axisCount;
        const normals = axisCache.normals;
        const projA = this.#scratchProjA;
        const projB = this.#scratchProjB;
        for (let i = 0; i < count; i++) {
            const axisIndex = i * 2;
            const axisX = normals[axisIndex];
            const axisY = normals[axisIndex + 1];
            if (Math.abs(axisX) <= EPSILON && Math.abs(axisY) <= EPSILON) continue;

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
     * 폴리곤 축을 캐시해 SAT 축 정규화 연산을 줄입니다.
     * @private
     * @param {number[]} points
     * @returns {SatAxisCache|null}
     */
    #getPolygonAxes(points) {
        if (!points || points.length < 6) return null;
        const axisCount = points.length / 2;
        const edge0X = points[2] - points[0];
        const edge0Y = points[3] - points[1];
        const edge1X = points.length >= 8 ? points[4] - points[2] : edge0X;
        const edge1Y = points.length >= 8 ? points[5] - points[3] : edge0Y;

        const cached = this.#axisCache.get(points);
        if (
            cached &&
            cached.pointLength === points.length &&
            Math.abs(cached.edge0X - edge0X) <= EPSILON &&
            Math.abs(cached.edge0Y - edge0Y) <= EPSILON &&
            Math.abs(cached.edge1X - edge1X) <= EPSILON &&
            Math.abs(cached.edge1Y - edge1Y) <= EPSILON
        ) {
            return cached;
        }

        const normals = (cached && cached.pointLength === points.length)
            ? cached.normals
            : new Float32Array(axisCount * 2);
        for (let i = 0; i < points.length; i += 2) {
            const j = (i + 2) % points.length;
            const edgeX = points[j] - points[i];
            const edgeY = points[j + 1] - points[i + 1];
            let axisX = -edgeY;
            let axisY = edgeX;
            const axisLen = Math.hypot(axisX, axisY);
            const outIndex = i;
            if (axisLen <= EPSILON) {
                normals[outIndex] = 0;
                normals[outIndex + 1] = 0;
                continue;
            }
            axisX /= axisLen;
            axisY /= axisLen;
            normals[outIndex] = axisX;
            normals[outIndex + 1] = axisY;
        }

        const nextCache = {
            pointLength: points.length,
            axisCount,
            edge0X,
            edge0Y,
            edge1X,
            edge1Y,
            normals
        };
        this.#axisCache.set(points, nextCache);
        return nextCache;
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

    /**
     * @private
     */
    #computePolygonCenter(points, out) {
        let sx = 0;
        let sy = 0;
        const count = points.length / 2;
        for (let i = 0; i < points.length; i += 2) {
            sx += points[i];
            sy += points[i + 1];
        }
        out.x = sx / count;
        out.y = sy / count;
        return out;
    }
}
