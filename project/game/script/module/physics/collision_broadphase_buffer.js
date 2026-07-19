import { getData } from 'data/data_handler.js';
import { COLLISION_CANDIDATE_SWEEP_PAD_SCALE } from './_collision_resolve_tuning.js';
import {
    COLLISION_BROAD_STRIDE as BROAD_STRIDE,
    COLLISION_CANDIDATE_SWEEP_INDEX as CANDIDATE_SWEEP_INDEX,
    COLLISION_CANDIDATE_SWEEP_STRIDE as CANDIDATE_SWEEP_STRIDE,
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
 * enemy pair relation bound와 fixed frame sweep bound의 보수적 합집합 축 값을 반환합니다.
 * @param {object} body - 대상 enemy body입니다.
 * @param {string} baseField - 기본 bound 필드입니다.
 * @param {string} relationField - enemy pair bound 필드입니다.
 * @param {string} sweepField - fixed frame sweep 필드입니다.
 * @param {boolean} useMinimum - 최솟값을 선택할지 여부입니다.
 * @returns {number} 후보 sweep bound입니다.
 */
function getCollisionEnemyCandidateSweepBound(
    body,
    baseField,
    relationField,
    sweepField,
    useMinimum
) {
    const baseValue = Number.isFinite(body?.[relationField])
        ? body[relationField]
        : body?.[baseField];
    const sweepValue = Number.isFinite(body?.[sweepField]) ? body[sweepField] : baseValue;
    const sweepDelta = (sweepValue - baseValue) * COLLISION_CANDIDATE_SWEEP_PAD_SCALE;
    const expandedSweepValue = baseValue + sweepDelta;
    return useMinimum
        ? Math.min(baseValue, expandedSweepValue)
        : Math.max(baseValue, expandedSweepValue);
}

/**
 * 현재 AABB와 fixed frame sweep AABB 사이의 최대 축 확장량을 반환합니다.
 * @param {object} body - 대상 body입니다.
 * @returns {number} 후보 broad circle 확장 패딩입니다.
 */
function getCollisionEnemyCandidateSweepPad(body) {
    const padLeft = Number.isFinite(body?.sweepMinX) && Number.isFinite(body?.minX)
        ? Math.max(0, body.minX - body.sweepMinX)
        : 0;
    const padRight = Number.isFinite(body?.sweepMaxX) && Number.isFinite(body?.maxX)
        ? Math.max(0, body.sweepMaxX - body.maxX)
        : 0;
    const padTop = Number.isFinite(body?.sweepMinY) && Number.isFinite(body?.minY)
        ? Math.max(0, body.minY - body.sweepMinY)
        : 0;
    const padBottom = Number.isFinite(body?.sweepMaxY) && Number.isFinite(body?.maxY)
        ? Math.max(0, body.sweepMaxY - body.maxY)
        : 0;
    return Math.max(padLeft, padRight, padTop, padBottom) * COLLISION_CANDIDATE_SWEEP_PAD_SCALE;
}

/**
 * enemy-enemy 후보 broad circle에 사용할 관계 반경을 반환합니다.
 * @param {object} body - 대상 enemy body입니다.
 * @returns {number} 후보 broad circle 반경입니다.
 */
function getCollisionEnemyCandidateRelationRadius(body) {
    if (Number.isFinite(body?.enemyPairBroadRadius)) {
        return body.enemyPairBroadRadius;
    }
    if (body?.shape === 'circle' && Number.isFinite(body.radius)) {
        return body.radius;
    }
    return Number.isFinite(body?.broadRadius) ? body.broadRadius : body?.boundRadius;
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
        this.candidateSweepData = new Float64Array(initialCapacity * CANDIDATE_SWEEP_STRIDE);
        this.candidateSweepValidity = new Uint8Array(initialCapacity);
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
        const candidateSweepNeeded = safeBodyCount * CANDIDATE_SWEEP_STRIDE;
        if (this.candidateSweepData.length < candidateSweepNeeded) {
            this.candidateSweepData = new Float64Array(getCollisionBroadphaseExpandedLength(
                this.candidateSweepData.length,
                candidateSweepNeeded
            ));
        }
        if (this.candidateSweepValidity.length < safeBodyCount) {
            this.candidateSweepValidity = new Uint8Array(getCollisionBroadphaseExpandedLength(
                this.candidateSweepValidity.length,
                safeBodyCount
            ));
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
     * @returns {void}
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
        this.#writeCandidateSweepData(index, body);
    }

    /**
     * grid 삽입에 필요한 broad-phase 데이터만 씁니다.
     * `_broadDataIndex`, kind/shape code와 Float32 broad record는
     * `write(index, body, gridMode)`와 같은 조회·쓰기 순서를 유지합니다.
     * enemy relation/candidate plane은 갱신하지 않으므로, 해당 plane을 사용하는 다음
     * 경로는 반드시 범용 `write()`로 먼저 덮어써야 합니다.
     * @param {number} index - body 인덱스입니다.
     * @param {object} body - 충돌 body입니다.
     * @param {'default'|'enemyPair'|'projectile'} [gridMode='default'] - grid 계산 모드입니다.
     */
    writeGridOnly(index, body, gridMode = 'default') {
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
    }

    /**
     * 투사체 grid 전용 writer의 공개 호환 진입점입니다.
     * @param {number} index - body 인덱스입니다.
     * @param {object} body - 충돌 body입니다.
     * @returns {void}
     */
    writeProjectileGrid(index, body) {
        this.writeGridOnly(index, body, 'projectile');
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

        // 중간 solve pass는 기존 후보 목록을 재사용하고, 다음 후보 rebuild 전에 모든 body를 다시 씁니다.
        // 예상 밖의 write 없는 후보 재생성에서도 object helper fallback을 타도록 이동 body만 무효화합니다.
        this.candidateSweepValidity[bodyIndex] = 0;
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
        const isEnemy = body.kind === 'enemy';
        relationData[relationOffset + RELATION_INDEX.MIN_X] = isEnemy && Number.isFinite(body.enemyPairMinX) ? body.enemyPairMinX : body.minX;
        relationData[relationOffset + RELATION_INDEX.MAX_X] = isEnemy && Number.isFinite(body.enemyPairMaxX) ? body.enemyPairMaxX : body.maxX;
        relationData[relationOffset + RELATION_INDEX.MIN_Y] = isEnemy && Number.isFinite(body.enemyPairMinY) ? body.enemyPairMinY : body.minY;
        relationData[relationOffset + RELATION_INDEX.MAX_Y] = isEnemy && Number.isFinite(body.enemyPairMaxY) ? body.enemyPairMaxY : body.maxY;
        relationData[relationOffset + RELATION_INDEX.CENTER_X] = Number.isFinite(body.centerX) ? body.centerX : body.x;
        relationData[relationOffset + RELATION_INDEX.CENTER_Y] = Number.isFinite(body.centerY) ? body.centerY : body.y;
        relationData[relationOffset + RELATION_INDEX.ENEMY_PAIR_RADIUS] = isEnemy && Number.isFinite(body.enemyPairBroadRadius) ? body.enemyPairBroadRadius : broadRadius;
        relationData[relationOffset + RELATION_INDEX.PROJECTILE_RADIUS] = isEnemy && Number.isFinite(body.projectileBroadRadius) ? body.projectileBroadRadius : broadRadius;
    }

    /**
     * enemy prefix 후보 생성에 필요한 sweep bounds와 circle 데이터를 기록합니다.
     * @param {number} index - body 인덱스입니다.
     * @param {object} body - 충돌 body입니다.
     * @private
     */
    #writeCandidateSweepData(index, body) {
        if (body?.kind !== 'enemy') {
            this.candidateSweepValidity[index] = 0;
            return;
        }

        const candidateOffset = index * CANDIDATE_SWEEP_STRIDE;
        const candidateData = this.candidateSweepData;
        const minX = getCollisionEnemyCandidateSweepBound(
            body,
            'minX',
            'enemyPairMinX',
            'sweepMinX',
            true
        );
        const maxX = getCollisionEnemyCandidateSweepBound(
            body,
            'maxX',
            'enemyPairMaxX',
            'sweepMaxX',
            false
        );
        const minY = getCollisionEnemyCandidateSweepBound(
            body,
            'minY',
            'enemyPairMinY',
            'sweepMinY',
            true
        );
        const maxY = getCollisionEnemyCandidateSweepBound(
            body,
            'maxY',
            'enemyPairMaxY',
            'sweepMaxY',
            false
        );
        const centerX = Number.isFinite(body.centerX) ? body.centerX : body.x;
        const centerY = Number.isFinite(body.centerY) ? body.centerY : body.y;
        const radius = getCollisionEnemyCandidateRelationRadius(body);
        const pad = getCollisionEnemyCandidateSweepPad(body);

        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.MIN_X] = minX;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.MAX_X] = maxX;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.MIN_Y] = minY;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.MAX_Y] = maxY;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.CENTER_X] = centerX;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.CENTER_Y] = centerY;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.RADIUS] = radius;
        candidateData[candidateOffset + CANDIDATE_SWEEP_INDEX.PAD] = pad;
        this.candidateSweepValidity[index] = Number.isFinite(minX)
            && Number.isFinite(maxX)
            && Number.isFinite(minY)
            && Number.isFinite(maxY)
            && Number.isFinite(centerX)
            && Number.isFinite(centerY)
            && Number.isFinite(radius)
            && radius > 0
            && Number.isFinite(pad)
            ? 1
            : 0;
    }
}
