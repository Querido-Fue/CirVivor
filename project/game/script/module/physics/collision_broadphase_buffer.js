import { getData } from 'data/data_handler.js';
import {
    COLLISION_BROAD_STRIDE as BROAD_STRIDE,
    COLLISION_RELATION_INDEX as RELATION_INDEX,
    COLLISION_RELATION_BROAD_STRIDE as RELATION_BROAD_STRIDE,
    getCollisionBodyKindCode,
    getCollisionBodyShapeCode
} from './collision_soa_layout.js';

const COLLISION_GRID_CONSTANTS = getData('COLLISION_CONSTANTS').GRID;
const COLLISION_GRID_RADIUS_SCALE = COLLISION_GRID_CONSTANTS.RADIUS_SCALE;
const BROADPHASE_INITIAL_CAPACITY = COLLISION_GRID_CONSTANTS.BROADPHASE_INITIAL_CAPACITY;

/**
 * broad-phase buffer에서 사용할 body 개수를 정규화합니다.
 * @param {number} bodyCount - 입력 body 개수입니다.
 * @returns {number} 음수와 비정수를 0으로 보정한 body 개수입니다.
 */
function normalizeCollisionBroadphaseBodyCount(bodyCount) {
    return Number.isInteger(bodyCount) && bodyCount > 0 ? bodyCount : 0;
}

/**
 * 기존 용량의 두 배와 필요 용량 중 큰 값을 반환합니다.
 * @param {number} currentLength - 현재 typed array 길이입니다.
 * @param {number} neededLength - 필요한 typed array 길이입니다.
 * @returns {number} 새로 할당할 typed array 길이입니다.
 */
function getCollisionBroadphaseExpandedLength(currentLength, neededLength) {
    return Math.max(neededLength, currentLength * 2);
}

/**
 * broad-phase와 enemy relation narrowphase에 필요한 SoA 배열을 관리합니다.
 */
export class CollisionBroadphaseBuffer {
    /**
     * @param {number} [initialCapacity=BROADPHASE_INITIAL_CAPACITY] - 초기 body 용량입니다.
     */
    constructor(initialCapacity = BROADPHASE_INITIAL_CAPACITY) {
        this.broadData = new Float32Array(initialCapacity * BROAD_STRIDE);
        this.relationData = new Float64Array(initialCapacity * RELATION_BROAD_STRIDE);
        this.bodyKindCodes = new Uint8Array(initialCapacity);
        this.bodyShapeCodes = new Uint8Array(initialCapacity);
        this.bodyCount = 0;
    }

    /**
     * body 개수에 맞춰 SoA 버퍼 용량을 확보합니다.
     * @param {number} bodyCount - 필요한 body 개수입니다.
     */
    ensure(bodyCount) {
        const safeBodyCount = normalizeCollisionBroadphaseBodyCount(bodyCount);
        const needed = safeBodyCount * BROAD_STRIDE;
        if (this.broadData.length < needed) {
            this.broadData = new Float32Array(getCollisionBroadphaseExpandedLength(this.broadData.length, needed));
        }

        const relationNeeded = safeBodyCount * RELATION_BROAD_STRIDE;
        if (this.relationData.length < relationNeeded) {
            this.relationData = new Float64Array(getCollisionBroadphaseExpandedLength(this.relationData.length, relationNeeded));
        }
        if (this.bodyKindCodes.length < safeBodyCount) {
            this.bodyKindCodes = new Uint8Array(getCollisionBroadphaseExpandedLength(this.bodyKindCodes.length, safeBodyCount));
        }
        if (this.bodyShapeCodes.length < safeBodyCount) {
            this.bodyShapeCodes = new Uint8Array(getCollisionBroadphaseExpandedLength(this.bodyShapeCodes.length, safeBodyCount));
        }
        this.bodyCount = safeBodyCount;
    }

    /**
     * grid 삽입용 broad-phase SoA 데이터를 씁니다.
     * @param {number} index - body 인덱스입니다.
     * @param {object} body - 충돌 body입니다.
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default'] - grid 계산 모드입니다.
     */
    write(index, body, gridMode = 'default') {
        const broadOffset = index * BROAD_STRIDE;
        let minX = body.minX;
        let maxX = body.maxX;
        let minY = body.minY;
        let maxY = body.maxY;
        let broadRadius = body.broadRadius;
        if (body.kind === 'enemy' && gridMode === 'enemyPair') {
            minX = Number.isFinite(body.enemyPairMinX) ? body.enemyPairMinX : minX;
            maxX = Number.isFinite(body.enemyPairMaxX) ? body.enemyPairMaxX : maxX;
            minY = Number.isFinite(body.enemyPairMinY) ? body.enemyPairMinY : minY;
            maxY = Number.isFinite(body.enemyPairMaxY) ? body.enemyPairMaxY : maxY;
            broadRadius = Number.isFinite(body.enemyPairBroadRadius) ? body.enemyPairBroadRadius : broadRadius;
        } else if (body.kind === 'enemy' && gridMode === 'projectile') {
            minX = Number.isFinite(body.projectileMinX) ? body.projectileMinX : minX;
            maxX = Number.isFinite(body.projectileMaxX) ? body.projectileMaxX : maxX;
            minY = Number.isFinite(body.projectileMinY) ? body.projectileMinY : minY;
            maxY = Number.isFinite(body.projectileMaxY) ? body.projectileMaxY : maxY;
            broadRadius = Number.isFinite(body.projectileBroadRadius) ? body.projectileBroadRadius : broadRadius;
        }

        body._broadDataIndex = index;
        this.bodyKindCodes[index] = getCollisionBodyKindCode(body.kind);
        this.bodyShapeCodes[index] = getCollisionBodyShapeCode(body.shape);

        const broadData = this.broadData;
        broadData[broadOffset + 0] = minX;
        broadData[broadOffset + 1] = maxX;
        broadData[broadOffset + 2] = minY;
        broadData[broadOffset + 3] = maxY;
        broadData[broadOffset + 4] = minX;
        broadData[broadOffset + 5] = maxX;
        broadData[broadOffset + 6] = minY;
        broadData[broadOffset + 7] = maxY;
        broadData[broadOffset + 8] = body.centerX;
        broadData[broadOffset + 9] = body.centerY;
        broadData[broadOffset + 10] = body.boundRadius;
        broadData[broadOffset + 11] = broadRadius;
        broadData[broadOffset + 12] = broadRadius * COLLISION_GRID_RADIUS_SCALE;
        broadData[broadOffset + 13] = body.shape === 'circle' ? body.radius : broadRadius;

        this.#writeRelationData(index, body, broadRadius);
    }

    /**
     * body 이동량을 현재 broad-phase SoA 버퍼에 반영합니다.
     * @param {object} body - 이동한 충돌 body입니다.
     * @param {number} dx - X 이동량입니다.
     * @param {number} dy - Y 이동량입니다.
     */
    translateBody(body, dx, dy) {
        const bodyIndex = Number.isInteger(body?._broadDataIndex) ? body._broadDataIndex : -1;
        if (bodyIndex < 0 || bodyIndex >= this.bodyCount) {
            return;
        }

        const broadOffset = bodyIndex * BROAD_STRIDE;
        const broadData = this.broadData;
        broadData[broadOffset + 0] += dx;
        broadData[broadOffset + 1] += dx;
        broadData[broadOffset + 2] += dy;
        broadData[broadOffset + 3] += dy;
        broadData[broadOffset + 4] += dx;
        broadData[broadOffset + 5] += dx;
        broadData[broadOffset + 6] += dy;
        broadData[broadOffset + 7] += dy;
        broadData[broadOffset + 8] += dx;
        broadData[broadOffset + 9] += dy;

        const relationOffset = bodyIndex * RELATION_BROAD_STRIDE;
        const relationData = this.relationData;
        relationData[relationOffset + RELATION_INDEX.MIN_X] += dx;
        relationData[relationOffset + RELATION_INDEX.MAX_X] += dx;
        relationData[relationOffset + RELATION_INDEX.MIN_Y] += dy;
        relationData[relationOffset + RELATION_INDEX.MAX_Y] += dy;
        relationData[relationOffset + RELATION_INDEX.CENTER_X] += dx;
        relationData[relationOffset + RELATION_INDEX.CENTER_Y] += dy;
    }

    /**
     * enemy relation broad data를 씁니다.
     * @param {number} index - body 인덱스입니다.
     * @param {object} body - 충돌 body입니다.
     * @param {number} broadRadius - 기본 broad radius입니다.
     * @private
     */
    #writeRelationData(index, body, broadRadius) {
        const relationOffset = index * RELATION_BROAD_STRIDE;
        const relationData = this.relationData;
        relationData[relationOffset + RELATION_INDEX.MIN_X] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMinX) ? body.enemyPairMinX : body.minX;
        relationData[relationOffset + RELATION_INDEX.MAX_X] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMaxX) ? body.enemyPairMaxX : body.maxX;
        relationData[relationOffset + RELATION_INDEX.MIN_Y] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMinY) ? body.enemyPairMinY : body.minY;
        relationData[relationOffset + RELATION_INDEX.MAX_Y] = body.kind === 'enemy' && Number.isFinite(body.enemyPairMaxY) ? body.enemyPairMaxY : body.maxY;
        relationData[relationOffset + RELATION_INDEX.CENTER_X] = Number.isFinite(body.centerX) ? body.centerX : body.x;
        relationData[relationOffset + RELATION_INDEX.CENTER_Y] = Number.isFinite(body.centerY) ? body.centerY : body.y;
        relationData[relationOffset + RELATION_INDEX.ENEMY_PAIR_RADIUS] = body.kind === 'enemy' && Number.isFinite(body.enemyPairBroadRadius) ? body.enemyPairBroadRadius : broadRadius;
        relationData[relationOffset + RELATION_INDEX.PROJECTILE_RADIUS] = body.kind === 'enemy' && Number.isFinite(body.projectileBroadRadius) ? body.projectileBroadRadius : broadRadius;
    }
}
