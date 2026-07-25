import {
    COLLISION_LAYERS,
    assertCircleCollidable2D
} from '../contract/collidable_contract.js';
import { PHYSICS_BODY_TYPES } from '../contract/physics_body_contract.js';
import { assertTileNavigationSource } from '../contract/tile_navigation_contract.js';

const MAX_RESOLVE_ITERATIONS = 8;
const PENETRATION_EPSILON = 1e-8;

/**
 * 값을 두 경계 사이로 제한합니다.
 * @param {number} value - 원본 값입니다.
 * @param {number} minimum - 최소값입니다.
 * @param {number} maximum - 최대값입니다.
 * @returns {number} 제한된 값입니다.
 */
function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

/**
 * 원 중심이 사각형 내부일 때 가장 가까운 외부 방향과 보정량을 계산합니다.
 * @param {number} x - 원 중심 X입니다.
 * @param {number} y - 원 중심 Y입니다.
 * @param {number} radius - 원 반지름입니다.
 * @param {number} left - 타일 왼쪽입니다.
 * @param {number} top - 타일 위쪽입니다.
 * @param {number} right - 타일 오른쪽입니다.
 * @param {number} bottom - 타일 아래쪽입니다.
 * @param {object} out - 결과 scratch입니다.
 * @returns {object} 같은 결과 객체입니다.
 */
function resolveInsideTile(x, y, radius, left, top, right, bottom, out) {
    const distances = [
        x - left,
        right - x,
        y - top,
        bottom - y
    ];
    let nearestIndex = 0;
    for (let index = 1; index < distances.length; index++) {
        if (distances[index] < distances[nearestIndex]) {
            nearestIndex = index;
        }
    }

    out.normalX = nearestIndex === 0 ? -1 : nearestIndex === 1 ? 1 : 0;
    out.normalY = nearestIndex === 2 ? -1 : nearestIndex === 3 ? 1 : 0;
    out.penetration = distances[nearestIndex] + radius;
    return out;
}

/**
 * @class TileMapCollisionResolver
 * @description 원형 ICollidable2D를 막힌 타일 밖으로 보정합니다.
 */
export class TileMapCollisionResolver {
    /**
     * @param {object} tileMap - ITileNavigationSource입니다.
     */
    constructor(tileMap) {
        this.tileMap = assertTileNavigationSource(tileMap);
        this.contactScratch = { normalX: 0, normalY: 0, penetration: 0 };
    }

    /**
     * 원형 collider와 인접 막힌 타일의 침투를 해소합니다.
     * @param {object} collider - 원형 ICollidable2D입니다.
     * @returns {number} 적용한 위치 보정 횟수입니다.
     */
    resolve(collider) {
        const circle = assertCircleCollidable2D(collider);
        const body = circle.getPhysicsBody();
        if (!circle.isCollisionEnabled()
            || body.getBodyType() === PHYSICS_BODY_TYPES.STATIC
            || (circle.getCollisionMask() & COLLISION_LAYERS.WORLD) === 0) {
            return 0;
        }

        const radius = circle.getRadius();
        const tileSize = this.tileMap.getNavigationGrid().cellSize;
        let correctionCount = 0;

        for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
            const position = body.getPosition();
            const minColumn = Math.floor((position.x - radius) / tileSize);
            const maxColumn = Math.floor((position.x + radius) / tileSize);
            const minRow = Math.floor((position.y - radius) / tileSize);
            const maxRow = Math.floor((position.y + radius) / tileSize);
            let bestNormalX = 0;
            let bestNormalY = 0;
            let bestPenetration = 0;

            for (let row = minRow; row <= maxRow; row++) {
                for (let column = minColumn; column <= maxColumn; column++) {
                    if (this.tileMap.isWalkableTile(row, column)) {
                        continue;
                    }
                    const left = column * tileSize;
                    const top = row * tileSize;
                    const right = left + tileSize;
                    const bottom = top + tileSize;
                    const closestX = clamp(position.x, left, right);
                    const closestY = clamp(position.y, top, bottom);
                    const deltaX = position.x - closestX;
                    const deltaY = position.y - closestY;
                    const distanceSquared = (deltaX * deltaX) + (deltaY * deltaY);
                    let normalX;
                    let normalY;
                    let penetration;

                    if (distanceSquared <= PENETRATION_EPSILON) {
                        const inside = resolveInsideTile(
                            position.x,
                            position.y,
                            radius,
                            left,
                            top,
                            right,
                            bottom,
                            this.contactScratch
                        );
                        normalX = inside.normalX;
                        normalY = inside.normalY;
                        penetration = inside.penetration;
                    } else {
                        const distance = Math.sqrt(distanceSquared);
                        penetration = radius - distance;
                        if (penetration <= PENETRATION_EPSILON) {
                            continue;
                        }
                        normalX = deltaX / distance;
                        normalY = deltaY / distance;
                    }

                    if (penetration > bestPenetration) {
                        bestPenetration = penetration;
                        bestNormalX = normalX;
                        bestNormalY = normalY;
                    }
                }
            }

            if (bestPenetration <= PENETRATION_EPSILON) {
                break;
            }
            body.applyPositionCorrection(
                bestNormalX * bestPenetration,
                bestNormalY * bestPenetration
            );
            const velocity = body.getVelocity();
            const inwardSpeed = (velocity.x * bestNormalX) + (velocity.y * bestNormalY);
            if (inwardSpeed < 0) {
                body.setVelocity(
                    velocity.x - (inwardSpeed * bestNormalX),
                    velocity.y - (inwardSpeed * bestNormalY)
                );
            }
            correctionCount++;
        }

        return correctionCount;
    }
}
