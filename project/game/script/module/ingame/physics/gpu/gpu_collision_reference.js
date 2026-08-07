import {
    GPU_CIRCLE_BODY_META,
    unpackGpuCircleInteractionMeta,
    unpackGpuCirclePhysicsMeta,
    unpackGpuCircleSimulationMeta
} from './gpu_circle_body_abi.js';
import {
    MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE
} from '../../../../data/object/enemy/basic_circle_enemy_data.js';

export const GPU_COLLISION_REFERENCE = Object.freeze({
    CELL_CAPACITY: 64,
    SOLVER_ITERATIONS: 6,
    MASS_EPSILON: 0.000001,
    DISTANCE_SQUARED_EPSILON: 0.000000000001,
    INTERIOR_COMPLIANCE: 0.000001,
    BORDER_COMPLIANCE: 0.001,
    SOFT_BORDER_SIZE: 8,
    ENEMY_LAYER_MASK: 1,
    ENEMY_PAIR_COLLISION_RADIUS_SCALE: MAIN_GPU_ENEMY_PAIR_COLLISION_RADIUS_SCALE,
    TERRAIN_LAYER_MASK: 128,
    WORLD_CLAMP_MARGIN: 0.1
});

export const GPU_COLLISION_NEIGHBOR_OFFSETS = Object.freeze([
    Object.freeze({ x: -1, y: -1 }),
    Object.freeze({ x: 0, y: -1 }),
    Object.freeze({ x: 1, y: -1 }),
    Object.freeze({ x: -1, y: 0 }),
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 1, y: 0 }),
    Object.freeze({ x: -1, y: 1 }),
    Object.freeze({ x: 0, y: 1 }),
    Object.freeze({ x: 1, y: 1 })
]);

const UINT32_MAX = 0xffffffff;
const SMALL_BUCKET = 0;
const BIG_BUCKET = 1;

/**
 * 유한한 Float32 값을 검증하고 반올림합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireFloat32(value, fieldName) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        throw new TypeError(`${fieldName}은(는) 유한한 숫자여야 합니다.`);
    }
    const rounded = Math.fround(numberValue);
    if (!Number.isFinite(rounded)) {
        throw new RangeError(`${fieldName}은(는) Float32 범위를 벗어났습니다.`);
    }
    return rounded;
}

/**
 * 양의 Float32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requirePositiveFloat32(value, fieldName) {
    const rounded = requireFloat32(value, fieldName);
    if (rounded <= 0) {
        throw new RangeError(`${fieldName}은(는) 0보다 커야 합니다.`);
    }
    return rounded;
}

/**
 * 0 이상 Float32 값을 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류 필드명입니다.
 * @returns {number} Float32 값입니다.
 */
function requireNonNegativeFloat32(value, fieldName) {
    const rounded = requireFloat32(value, fieldName);
    if (rounded < 0) {
        throw new RangeError(`${fieldName}은(는) 0 이상이어야 합니다.`);
    }
    return rounded;
}

/**
 * 양의 정수를 검증합니다.
 * @param {*} value - 검사할 값입니다.
 * @param {string} fieldName - 오류 필드명입니다.
 * @returns {number} 양의 정수입니다.
 */
function requirePositiveInteger(value, fieldName) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > UINT32_MAX) {
        throw new RangeError(`${fieldName}은(는) 1 이상 uint32 범위의 정수여야 합니다.`);
    }
    return value;
}

/**
 * 중첩 또는 flat 벡터 성분을 읽습니다.
 * @param {*} source - 원본 객체입니다.
 * @param {string} nestedName - 중첩 벡터 필드명입니다.
 * @param {'x'|'y'} axis - 축입니다.
 * @param {*} fallback - 값이 없을 때 fallback입니다.
 * @returns {number} Float32 값입니다.
 */
function readVectorComponent(source, nestedName, axis, fallback) {
    const capitalizedAxis = axis === 'x' ? 'X' : 'Y';
    const flatName = `${nestedName}${capitalizedAxis}`;
    const value = source[nestedName]?.[axis] ?? source[flatName] ?? fallback;
    return requireFloat32(value, `${nestedName}.${axis}`);
}

/**
 * production WGSL과 같은 simulationMeta alive bit를 판정합니다.
 * @param {*} body - simulationMeta를 가진 body 또는 grid entry입니다.
 * @returns {boolean} 활성 슬롯 여부입니다.
 */
function bodyIsAlive(body) {
    const simulationFlags = body.simulationMeta >>> 0;
    return (simulationFlags & GPU_CIRCLE_BODY_META.ALIVE_FLAG)
        === GPU_CIRCLE_BODY_META.ALIVE_FLAG;
}

/**
 * oracle body 입력을 독립 Float32 상태로 복제합니다.
 * @param {*} body - 원본 body입니다.
 * @param {number} bodyIndex - dense body index입니다.
 * @returns {*} 내부 Float32 body 상태입니다.
 */
function normalizeBody(body, bodyIndex) {
    if (!body || typeof body !== 'object') {
        throw new TypeError(`bodies[${bodyIndex}]가 객체가 아닙니다.`);
    }
    const positionX = readVectorComponent(body, 'position', 'x', undefined);
    const positionY = readVectorComponent(body, 'position', 'y', undefined);
    const previousX = readVectorComponent(body, 'previousPosition', 'x', positionX);
    const previousY = readVectorComponent(body, 'previousPosition', 'y', positionY);
    const predictedX = readVectorComponent(body, 'predictedPosition', 'x', positionX);
    const predictedY = readVectorComponent(body, 'predictedPosition', 'y', positionY);
    const velocityX = readVectorComponent(body, 'velocity', 'x', 0);
    const velocityY = readVectorComponent(body, 'velocity', 'y', 0);
    const radius = requireNonNegativeFloat32(body.radius, `bodies[${bodyIndex}].radius`);
    const inverseMass = requireNonNegativeFloat32(
        body.inverseMass ?? body.invMass,
        `bodies[${bodyIndex}].inverseMass`
    );
    if (inverseMass > 0 && inverseMass <= GPU_COLLISION_REFERENCE.MASS_EPSILON) {
        throw new RangeError(
            `bodies[${bodyIndex}].inverseMass는 0 또는 MASS_EPSILON보다 커야 합니다.`
        );
    }
    const physicsMeta = Number(body.physicsMeta);
    const interactionMeta = Number(body.interactionMeta ?? 0);
    const simulationMeta = Number(body.simulationMeta);
    const entityId = Number(body.entityId ?? bodyIndex + 1);
    if (!Number.isSafeInteger(entityId) || entityId < 0 || entityId > UINT32_MAX) {
        throw new RangeError(`bodies[${bodyIndex}].entityId는 uint32 정수여야 합니다.`);
    }
    unpackGpuCirclePhysicsMeta(physicsMeta);
    unpackGpuCircleInteractionMeta(interactionMeta);
    unpackGpuCircleSimulationMeta(simulationMeta);

    return {
        bodyIndex,
        entityId,
        positionX,
        positionY,
        velocityX,
        velocityY,
        previousX,
        previousY,
        predictedX,
        predictedY,
        deltaX: 0,
        deltaY: 0,
        radius,
        inverseMass,
        physicsMeta: physicsMeta >>> 0,
        interactionMeta: interactionMeta >>> 0,
        simulationMeta: simulationMeta >>> 0,
        gridIndex: -1
    };
}

/**
 * solver/grid 옵션을 정규화합니다.
 * @param {*} options - 원본 옵션입니다.
 * @returns {*} 내부 옵션입니다.
 */
function normalizeOptions(options) {
    if (!options || typeof options !== 'object') {
        throw new TypeError('GPU collision reference options가 필요합니다.');
    }
    const worldWidth = requirePositiveFloat32(
        options.worldSize?.x ?? options.worldWidth,
        'worldSize.x'
    );
    const worldHeight = requirePositiveFloat32(
        options.worldSize?.y ?? options.worldHeight,
        'worldSize.y'
    );
    const sourceWorldUnitScale = requirePositiveFloat32(
        options.sourceWorldUnitScale ?? 1,
        'sourceWorldUnitScale'
    );
    const worldClampMargin = Math.fround(
        GPU_COLLISION_REFERENCE.WORLD_CLAMP_MARGIN * sourceWorldUnitScale
    );
    if (worldWidth <= worldClampMargin || worldHeight <= worldClampMargin) {
        throw new RangeError('worldSize는 scale된 world clamp margin보다 커야 합니다.');
    }
    const cellWidth = requirePositiveFloat32(
        options.gridCellSize?.x ?? options.cellWidth,
        'gridCellSize.x'
    );
    const cellHeight = requirePositiveFloat32(
        options.gridCellSize?.y ?? options.cellHeight,
        'gridCellSize.y'
    );
    const cellCountX = requirePositiveInteger(
        options.gridCellCount?.x ?? options.cellCountX ?? Math.ceil(worldWidth / cellWidth),
        'gridCellCount.x'
    );
    const cellCountY = requirePositiveInteger(
        options.gridCellCount?.y ?? options.cellCountY ?? Math.ceil(worldHeight / cellHeight),
        'gridCellCount.y'
    );
    const cellTotal = cellCountX * cellCountY;
    const entryCapacity = cellTotal * 2 * GPU_COLLISION_REFERENCE.CELL_CAPACITY;
    if (!Number.isSafeInteger(cellTotal) || !Number.isSafeInteger(entryCapacity)) {
        throw new RangeError('grid entry capacity가 안전한 정수 범위를 벗어났습니다.');
    }
    if (options.cellCapacity !== undefined
        && options.cellCapacity !== GPU_COLLISION_REFERENCE.CELL_CAPACITY) {
        throw new RangeError('reference grid cell capacity는 원본과 동일한 64여야 합니다.');
    }
    if (options.solverIterations !== undefined
        && options.solverIterations !== GPU_COLLISION_REFERENCE.SOLVER_ITERATIONS) {
        throw new RangeError('reference solver iteration은 원본과 동일한 6이어야 합니다.');
    }
    const sdfSample = options.sdfSample ?? null;
    if (sdfSample !== null && typeof sdfSample !== 'function') {
        throw new TypeError('sdfSample은 함수 또는 null이어야 합니다.');
    }
    return {
        worldWidth,
        worldHeight,
        cellWidth,
        cellHeight,
        cellCountX,
        cellCountY,
        cellTotal,
        entryCapacity,
        dt: requirePositiveFloat32(options.dt, 'dt'),
        sourceWorldUnitScale,
        worldClampMargin,
        haltOnGridOverflow: options.haltOnGridOverflow === true,
        sdfSample
    };
}

/**
 * grid bucket의 dense entry 시작 offset을 반환합니다.
 * @param {number} cellIndex - row-major cell index입니다.
 * @param {number} bucket - 0 small, 1 big입니다.
 * @returns {number} entry offset입니다.
 */
function getBucketOffset(cellIndex, bucket) {
    return ((cellIndex * 2) + bucket) * GPU_COLLISION_REFERENCE.CELL_CAPACITY;
}

/**
 * grid entry에 body snapshot을 씁니다.
 * @param {*} grid - 내부 grid입니다.
 * @param {number} entryIndex - 쓸 entry입니다.
 * @param {*} body - body snapshot 원본입니다.
 * @returns {void}
 */
function writeGridEntry(grid, entryIndex, body) {
    grid.entryBodyIds[entryIndex] = body.bodyIndex;
    grid.entryEntityIds[entryIndex] = body.entityId;
    grid.entryPredictedX[entryIndex] = body.predictedX;
    grid.entryPredictedY[entryIndex] = body.predictedY;
    grid.entryPhysicsMeta[entryIndex] = body.physicsMeta;
    grid.entryInteractionMeta[entryIndex] = body.interactionMeta;
    grid.entrySimulationMeta[entryIndex] = body.simulationMeta;
    grid.entryInverseMass[entryIndex] = body.inverseMass;
    grid.entryRadius[entryIndex] = body.radius;
}

/**
 * raw occupancy를 증가시키고 cap 안의 entry만 씁니다.
 * @param {*} grid - 내부 grid입니다.
 * @param {number} cellIndex - cell index입니다.
 * @param {number} bucket - small/big bucket입니다.
 * @param {*} body - 쓸 body입니다.
 * @returns {number} 쓴 absolute entry index, overflow이면 -1입니다.
 */
function appendGridEntry(grid, cellIndex, bucket, body) {
    const countIndex = (cellIndex * 2) + bucket;
    const slot = grid.counts[countIndex];
    grid.counts[countIndex] = slot + 1;
    if (slot >= GPU_COLLISION_REFERENCE.CELL_CAPACITY) {
        if (bucket === SMALL_BUCKET) {
            grid.smallOverflowCount += 1;
        } else {
            grid.bigOverflowCount += 1;
        }
        return -1;
    }
    const entryIndex = getBucketOffset(cellIndex, bucket) + slot;
    writeGridEntry(grid, entryIndex, body);
    return entryIndex;
}

/**
 * 원본 build_grid와 같은 dense row-major small/big grid를 한 번 생성합니다.
 * @param {Array<*>} normalizedBodies - 내부 body 상태입니다.
 * @param {*} normalizedOptions - 내부 옵션입니다.
 * @returns {*} dense grid와 overflow 진단입니다.
 */
function buildGridFromNormalizedBodies(normalizedBodies, normalizedOptions) {
    const grid = {
        cellCountX: normalizedOptions.cellCountX,
        cellCountY: normalizedOptions.cellCountY,
        cellCapacity: GPU_COLLISION_REFERENCE.CELL_CAPACITY,
        counts: new Uint32Array(normalizedOptions.cellTotal * 2),
        entryBodyIds: new Int32Array(normalizedOptions.entryCapacity),
        entryEntityIds: new Uint32Array(normalizedOptions.entryCapacity),
        entryPredictedX: new Float32Array(normalizedOptions.entryCapacity),
        entryPredictedY: new Float32Array(normalizedOptions.entryCapacity),
        entryPhysicsMeta: new Uint32Array(normalizedOptions.entryCapacity),
        entryInteractionMeta: new Uint32Array(normalizedOptions.entryCapacity),
        entrySimulationMeta: new Uint32Array(normalizedOptions.entryCapacity),
        entryInverseMass: new Float32Array(normalizedOptions.entryCapacity),
        entryRadius: new Float32Array(normalizedOptions.entryCapacity),
        smallOverflowCount: 0,
        bigOverflowCount: 0,
        buildCount: 1
    };
    grid.entryBodyIds.fill(-1);
    const minimumCellSize = Math.min(normalizedOptions.cellWidth, normalizedOptions.cellHeight);

    for (const body of normalizedBodies) {
        // 매 build 시작 시 초기화하여 OOB/overflow/reused slot의 stale index를 차단합니다.
        body.gridIndex = -1;
        if (!bodyIsAlive(body)) {
            continue;
        }
        const isBigBody = Math.fround(body.radius * 2) > minimumCellSize;
        if (isBigBody && body.inverseMass > GPU_COLLISION_REFERENCE.MASS_EPSILON) {
            throw new RangeError(
                `큰 바디는 static-only입니다: bodies[${body.bodyIndex}].inverseMass=${body.inverseMass}`
            );
        }
        const cellX = Math.floor(body.predictedX / normalizedOptions.cellWidth);
        const cellY = Math.floor(body.predictedY / normalizedOptions.cellHeight);
        if (cellX < 0 || cellY < 0
            || cellX >= normalizedOptions.cellCountX
            || cellY >= normalizedOptions.cellCountY) {
            continue;
        }

        if (!isBigBody) {
            const cellIndex = (cellY * normalizedOptions.cellCountX) + cellX;
            body.gridIndex = appendGridEntry(grid, cellIndex, SMALL_BUCKET, body);
            continue;
        }
        const maximumSmallRadius = minimumCellSize * 0.5;
        const paddingX = body.radius + maximumSmallRadius;
        const paddingY = body.radius + maximumSmallRadius;
        const minimumX = Math.max(
            0,
            Math.min(
                normalizedOptions.cellCountX - 1,
                Math.floor((body.predictedX - paddingX) / normalizedOptions.cellWidth)
            )
        );
        const minimumY = Math.max(
            0,
            Math.min(
                normalizedOptions.cellCountY - 1,
                Math.floor((body.predictedY - paddingY) / normalizedOptions.cellHeight)
            )
        );
        const maximumX = Math.max(
            0,
            Math.min(
                normalizedOptions.cellCountX - 1,
                Math.floor((body.predictedX + paddingX) / normalizedOptions.cellWidth)
            )
        );
        const maximumY = Math.max(
            0,
            Math.min(
                normalizedOptions.cellCountY - 1,
                Math.floor((body.predictedY + paddingY) / normalizedOptions.cellHeight)
            )
        );
        for (let y = minimumY; y <= maximumY; y += 1) {
            for (let x = minimumX; x <= maximumX; x += 1) {
                const cellIndex = (y * normalizedOptions.cellCountX) + x;
                appendGridEntry(grid, cellIndex, BIG_BUCKET, body);
            }
        }
    }
    return grid;
}

/**
 * 공개 grid diagnostic용으로 입력을 검증하고 한 번 build합니다.
 * @param {Array<*>} bodies - collision body 배열입니다.
 * @param {*} options - world/grid/dt 옵션입니다.
 * @returns {*} dense grid입니다.
 */
export function buildGpuCollisionReferenceGrid(bodies, options) {
    if (!Array.isArray(bodies)) {
        throw new TypeError('bodies는 배열이어야 합니다.');
    }
    if (bodies.length > UINT32_MAX) {
        throw new RangeError('body count가 uint32 capacity를 초과했습니다.');
    }
    const normalizedOptions = normalizeOptions(options);
    const normalizedBodies = bodies.map(normalizeBody);
    return buildGridFromNormalizedBodies(normalizedBodies, normalizedOptions);
}

/**
 * shader와 같은 smoothstep(0, edge, value)을 계산합니다.
 * @param {number} edge - 상단 edge입니다.
 * @param {number} value - 입력입니다.
 * @returns {number} Float32 smoothstep 값입니다.
 */
function smoothstepFromZero(edge, value) {
    const t = Math.fround(Math.max(0, Math.min(1, value / edge)));
    return Math.fround(t * t * Math.fround(3 - Math.fround(2 * t)));
}

/**
 * grid entry를 계산용 plain snapshot으로 읽습니다.
 * @param {*} grid - 내부 grid입니다.
 * @param {number} entryIndex - entry index입니다.
 * @returns {*} entry snapshot입니다.
 */
function readGridEntry(grid, entryIndex) {
    return {
        bodyIndex: grid.entryBodyIds[entryIndex],
        entityId: grid.entryEntityIds[entryIndex],
        predictedX: grid.entryPredictedX[entryIndex],
        predictedY: grid.entryPredictedY[entryIndex],
        physicsMeta: grid.entryPhysicsMeta[entryIndex],
        interactionMeta: grid.entryInteractionMeta[entryIndex],
        simulationMeta: grid.entrySimulationMeta[entryIndex],
        inverseMass: grid.entryInverseMass[entryIndex],
        radius: grid.entryRadius[entryIndex]
    };
}

/** production WGSL과 같은 reciprocal physical capability predicate입니다. */
export function isGpuCirclePhysicalPairEnabled(leftPhysicsMeta, rightPhysicsMeta) {
    const left = unpackGpuCirclePhysicsMeta(leftPhysicsMeta);
    const right = unpackGpuCirclePhysicsMeta(rightPhysicsMeta);
    return (left.collisionMask & right.bodyLayer) !== 0
        && (right.collisionMask & left.bodyLayer) !== 0;
}

/** production WGSL과 같은 reciprocal gameplay interaction predicate입니다. */
export function isGpuCircleInteractionPairEnabled(
    leftInteractionMeta,
    rightInteractionMeta
) {
    const left = unpackGpuCircleInteractionMeta(leftInteractionMeta);
    const right = unpackGpuCircleInteractionMeta(rightInteractionMeta);
    return (left.interactionMask & right.interactionLayer) !== 0
        && (right.interactionMask & left.interactionLayer) !== 0;
}

/** production WGSL과 같은 physical pair별 minimum separation을 계산합니다. */
function resolvePhysicalPairMinimumDistance(selfBody, otherBody) {
    const selfLayer = unpackGpuCirclePhysicsMeta(selfBody.physicsMeta).bodyLayer;
    const otherLayer = unpackGpuCirclePhysicsMeta(otherBody.physicsMeta).bodyLayer;
    const radiusSum = Math.fround(selfBody.radius + otherBody.radius);
    if ((selfLayer & GPU_COLLISION_REFERENCE.ENEMY_LAYER_MASK) !== 0
        && (otherLayer & GPU_COLLISION_REFERENCE.ENEMY_LAYER_MASK) !== 0) {
        return Math.fround(
            radiusSum * GPU_COLLISION_REFERENCE.ENEMY_PAIR_COLLISION_RADIUS_SCALE
        );
    }
    return radiusSum;
}

/**
 * production WGSL의 XPBD body-body correction을 한 body 관점에서 계산합니다.
 * 동일 위치에서는 entity/body identity 기반 반대칭 normal을 사용합니다.
 * @param {*} selfBody - primary grid body입니다.
 * @param {*} otherBody - candidate grid body입니다.
 * @param {number} alpha - compliance alpha입니다.
 * @param {boolean} bigPair - big bucket 후보 여부입니다.
 * @returns {{x:number,y:number}} primary correction입니다.
 */
function calculatePairCorrection(selfBody, otherBody, alpha, _bigPair) {
    if (selfBody.bodyIndex === otherBody.bodyIndex || !bodyIsAlive(otherBody)) {
        return { x: 0, y: 0 };
    }
    if (!isGpuCirclePhysicalPairEnabled(
        selfBody.physicsMeta,
        otherBody.physicsMeta
    )) {
        return { x: 0, y: 0 };
    }

    const deltaX = Math.fround(selfBody.predictedX - otherBody.predictedX);
    const deltaY = Math.fround(selfBody.predictedY - otherBody.predictedY);
    const distanceSquared = Math.fround(
        Math.fround(deltaX * deltaX) + Math.fround(deltaY * deltaY)
    );
    const minimumDistance = resolvePhysicalPairMinimumDistance(selfBody, otherBody);
    const minimumDistanceSquared = Math.fround(minimumDistance * minimumDistance);
    if (distanceSquared >= minimumDistanceSquared) {
        return { x: 0, y: 0 };
    }

    let normalX;
    let normalY;
    const selfIsFirst = selfBody.entityId < otherBody.entityId
        || (selfBody.entityId === otherBody.entityId
            && selfBody.bodyIndex < otherBody.bodyIndex);
    const lowId = Math.min(selfBody.entityId, otherBody.entityId) >>> 0;
    const highId = Math.max(selfBody.entityId, otherBody.entityId) >>> 0;
    let mixed = (Math.imul(lowId, 1664525)
        + Math.imul(highId, 1013904223)) >>> 0;
    mixed = (mixed ^ (mixed >>> 16)) >>> 0;
    const selector = mixed & 3;
    if (selector === 1) {
        normalX = 0;
        normalY = 1;
    } else if (selector === 2) {
        normalX = Math.fround(Math.SQRT1_2);
        normalY = Math.fround(Math.SQRT1_2);
    } else if (selector === 3) {
        normalX = Math.fround(Math.SQRT1_2);
        normalY = Math.fround(-Math.SQRT1_2);
    } else {
        normalX = 1;
        normalY = 0;
    }
    if (!selfIsFirst) {
        normalX = Math.fround(-normalX);
        normalY = Math.fround(-normalY);
    }
    let distance = 0;
    if (distanceSquared > GPU_COLLISION_REFERENCE.DISTANCE_SQUARED_EPSILON) {
        const inverseDistance = Math.fround(1 / Math.sqrt(distanceSquared));
        normalX = Math.fround(deltaX * inverseDistance);
        normalY = Math.fround(deltaY * inverseDistance);
        distance = Math.fround(distanceSquared * inverseDistance);
    }
    const penetration = Math.fround(minimumDistance - distance);
    const inverseMassSum = Math.fround(selfBody.inverseMass + otherBody.inverseMass);
    if (inverseMassSum <= GPU_COLLISION_REFERENCE.MASS_EPSILON) {
        return { x: 0, y: 0 };
    }
    const deltaLambda = Math.fround(penetration / Math.fround(inverseMassSum + alpha));
    return {
        x: Math.fround(Math.fround(normalX * deltaLambda) * selfBody.inverseMass),
        y: Math.fround(Math.fround(normalY * deltaLambda) * selfBody.inverseMass)
    };
}

/**
 * 한 solver iteration의 body-body delta를 누적합니다.
 * @param {Array<*>} bodies - 내부 body 상태입니다.
 * @param {*} grid - 한 번 build된 dense grid입니다.
 * @param {*} options - 내부 옵션입니다.
 * @returns {void}
 */
function solveBodyBodyIteration(bodies, grid, options) {
    for (let cellIndex = 0; cellIndex < options.cellTotal; cellIndex += 1) {
        const cellX = cellIndex % options.cellCountX;
        const cellY = Math.floor(cellIndex / options.cellCountX);
        const currentSmallCount = Math.min(
            grid.counts[cellIndex * 2],
            GPU_COLLISION_REFERENCE.CELL_CAPACITY
        );
        const currentBigCount = Math.min(
            grid.counts[(cellIndex * 2) + 1],
            GPU_COLLISION_REFERENCE.CELL_CAPACITY
        );
        const primaryOffset = getBucketOffset(cellIndex, SMALL_BUCKET);

        for (let localIndex = 0; localIndex < currentSmallCount; localIndex += 1) {
            const selfBody = readGridEntry(grid, primaryOffset + localIndex);
            const collisionMask = unpackGpuCirclePhysicsMeta(
                selfBody.physicsMeta
            ).collisionMask;
            if (selfBody.inverseMass <= GPU_COLLISION_REFERENCE.MASS_EPSILON
                || selfBody.radius <= 0
                || collisionMask === 0
                || !bodyIsAlive(selfBody)) {
                continue;
            }

            const distanceX = Math.min(
                selfBody.predictedX,
                options.worldWidth - selfBody.predictedX
            );
            const distanceY = Math.min(
                selfBody.predictedY,
                options.worldHeight - selfBody.predictedY
            );
            const borderFactor = Math.max(
                1 - smoothstepFromZero(
                    GPU_COLLISION_REFERENCE.SOFT_BORDER_SIZE * options.sourceWorldUnitScale,
                    distanceX
                ),
                1 - smoothstepFromZero(
                    GPU_COLLISION_REFERENCE.SOFT_BORDER_SIZE * options.sourceWorldUnitScale,
                    distanceY
                )
            );
            const compliance = Math.fround(
                GPU_COLLISION_REFERENCE.INTERIOR_COMPLIANCE
                + Math.fround(
                    (GPU_COLLISION_REFERENCE.BORDER_COMPLIANCE
                        - GPU_COLLISION_REFERENCE.INTERIOR_COMPLIANCE) * borderFactor
                )
            );
            const alpha = Math.fround(
                compliance / Math.fround(
                    Math.fround(options.dt * options.dt)
                    * GPU_COLLISION_REFERENCE.SOLVER_ITERATIONS
                )
            );
            let accumulatedX = 0;
            let accumulatedY = 0;

            for (const neighborOffset of GPU_COLLISION_NEIGHBOR_OFFSETS) {
                const neighborX = cellX + neighborOffset.x;
                const neighborY = cellY + neighborOffset.y;
                if (neighborX < 0 || neighborY < 0
                    || neighborX >= options.cellCountX
                    || neighborY >= options.cellCountY) {
                    continue;
                }
                const neighborCellIndex = (neighborY * options.cellCountX) + neighborX;
                const neighborCount = Math.min(
                    grid.counts[neighborCellIndex * 2],
                    GPU_COLLISION_REFERENCE.CELL_CAPACITY
                );
                const neighborBase = getBucketOffset(neighborCellIndex, SMALL_BUCKET);
                for (let candidateIndex = 0;
                    candidateIndex < neighborCount;
                    candidateIndex += 1) {
                    const correction = calculatePairCorrection(
                        selfBody,
                        readGridEntry(grid, neighborBase + candidateIndex),
                        alpha,
                        false
                    );
                    accumulatedX = Math.fround(accumulatedX + correction.x);
                    accumulatedY = Math.fround(accumulatedY + correction.y);
                }
            }

            const bigBase = getBucketOffset(cellIndex, BIG_BUCKET);
            // 원본 추출본의 raw count 순회는 OOB 위험이 있어 capacity로 명시적으로 clamp합니다.
            for (let candidateIndex = 0;
                candidateIndex < currentBigCount;
                candidateIndex += 1) {
                const correction = calculatePairCorrection(
                    selfBody,
                    readGridEntry(grid, bigBase + candidateIndex),
                    alpha,
                    true
                );
                accumulatedX = Math.fround(accumulatedX + correction.x);
                accumulatedY = Math.fround(accumulatedY + correction.y);
            }
            const target = bodies[selfBody.bodyIndex];
            target.deltaX = Math.fround(target.deltaX + accumulatedX);
            target.deltaY = Math.fround(target.deltaY + accumulatedY);
        }
    }
}

/**
 * SDF callback에서 world-unit distance를 읽습니다.
 * callback signature는 (worldX, worldY, bodyIndex)입니다.
 * @param {Function} sdfSample - SDF callback입니다.
 * @param {number} x - world X입니다.
 * @param {number} y - world Y입니다.
 * @param {number} bodyIndex - body index입니다.
 * @returns {number} Float32 signed distance입니다.
 */
function readSdfDistance(sdfSample, x, y, bodyIndex) {
    const sample = sdfSample(x, y, bodyIndex);
    const distance = typeof sample === 'number' ? sample : sample?.distance;
    return requireFloat32(distance, 'sdfSample.distance');
}

/**
 * optional SDF world pass를 한 iteration에 누적합니다.
 * @param {Array<*>} bodies - 내부 body 상태입니다.
 * @param {*} options - 내부 옵션입니다.
 * @returns {void}
 */
function solveBodyWorldIteration(bodies, options) {
    if (options.sdfSample === null) {
        return;
    }
    for (const body of bodies) {
        if (!bodyIsAlive(body)) {
            continue;
        }
        const collisionMask = unpackGpuCirclePhysicsMeta(
            body.physicsMeta
        ).collisionMask;
        if ((collisionMask & GPU_COLLISION_REFERENCE.TERRAIN_LAYER_MASK) === 0
            || body.inverseMass <= GPU_COLLISION_REFERENCE.MASS_EPSILON) {
            continue;
        }
        const candidateX = Math.fround(body.predictedX + body.deltaX);
        const candidateY = Math.fround(body.predictedY + body.deltaY);
        const initialSample = options.sdfSample(
            candidateX,
            candidateY,
            body.bodyIndex
        );
        const distance = requireFloat32(
            typeof initialSample === 'number' ? initialSample : initialSample?.distance,
            'sdfSample.distance'
        );
        const penetration = Math.fround(body.radius - distance);
        if (penetration <= 0) {
            continue;
        }

        let gradientX;
        let gradientY;
        if (typeof initialSample === 'object'
            && initialSample !== null
            && (initialSample.gradient?.x ?? initialSample.gradientX) !== undefined
            && (initialSample.gradient?.y ?? initialSample.gradientY) !== undefined) {
            gradientX = requireFloat32(
                initialSample.gradient?.x ?? initialSample.gradientX,
                'sdfSample.gradient.x'
            );
            gradientY = requireFloat32(
                initialSample.gradient?.y ?? initialSample.gradientY,
                'sdfSample.gradient.y'
            );
        } else {
            // 원본의 ±1 source-world sample과 UV epsilon을 현재 world scale에 맞춥니다.
            const gradientStep = options.sourceWorldUnitScale;
            const epsilonX = Math.fround(gradientStep / options.worldWidth);
            const epsilonY = Math.fround(gradientStep / options.worldHeight);
            gradientX = Math.fround(
                (readSdfDistance(
                    options.sdfSample,
                    candidateX + gradientStep,
                    candidateY,
                    body.bodyIndex
                ) - readSdfDistance(
                    options.sdfSample,
                    candidateX - gradientStep,
                    candidateY,
                    body.bodyIndex
                )) / Math.fround(epsilonX * 2)
            );
            gradientY = Math.fround(
                (readSdfDistance(
                    options.sdfSample,
                    candidateX,
                    candidateY + gradientStep,
                    body.bodyIndex
                ) - readSdfDistance(
                    options.sdfSample,
                    candidateX,
                    candidateY - gradientStep,
                    body.bodyIndex
                )) / Math.fround(epsilonY * 2)
            );
        }
        let normalX;
        let normalY;
        const gradientLength = Math.hypot(gradientX, gradientY);
        if (gradientLength < GPU_COLLISION_REFERENCE.MASS_EPSILON) {
            const centerDeltaX = Math.fround((options.worldWidth * 0.5) - candidateX);
            const centerDeltaY = Math.fround((options.worldHeight * 0.5) - candidateY);
            const centerLength = Math.hypot(centerDeltaX, centerDeltaY);
            if (centerLength < GPU_COLLISION_REFERENCE.MASS_EPSILON) {
                normalX = 1;
                normalY = 0;
            } else {
                normalX = Math.fround(centerDeltaX / centerLength);
                normalY = Math.fround(centerDeltaY / centerLength);
            }
        } else {
            normalX = Math.fround(gradientX / gradientLength);
            normalY = Math.fround(gradientY / gradientLength);
        }
        const correctionMagnitude = Math.fround(Math.min(penetration, body.radius));
        body.deltaX = Math.fround(
            body.deltaX + Math.fround(normalX * correctionMagnitude)
        );
        body.deltaY = Math.fround(
            body.deltaY + Math.fround(normalY * correctionMagnitude)
        );
    }
}

/**
 * delta를 predicted position과 small-grid snapshot에 적용합니다.
 * @param {Array<*>} bodies - 내부 body 상태입니다.
 * @param {*} grid - dense grid입니다.
 * @returns {void}
 */
function applyPositionDeltas(bodies, grid) {
    for (const body of bodies) {
        if (!bodyIsAlive(body)) {
            continue;
        }
        body.predictedX = Math.fround(body.predictedX + body.deltaX);
        body.predictedY = Math.fround(body.predictedY + body.deltaY);
        if (body.gridIndex >= 0) {
            grid.entryPredictedX[body.gridIndex] = body.predictedX;
            grid.entryPredictedY[body.gridIndex] = body.predictedY;
        }
    }
}

/**
 * 위치가 half-open world bounds 안인지 반환합니다.
 * @param {number} x - world X입니다.
 * @param {number} y - world Y입니다.
 * @param {*} options - 내부 옵션입니다.
 * @returns {boolean} 내부 여부입니다.
 */
function isInsideWorld(x, y, options) {
    return x >= 0 && x < options.worldWidth && y >= 0 && y < options.worldHeight;
}

/**
 * corrected predicted-current에서 velocity를 재구축합니다.
 * out-of-world enemy clamp는 local previous만 바꾸므로 render previous는 보존합니다.
 * @param {Array<*>} bodies - 내부 body 상태입니다.
 * @param {*} options - 내부 옵션입니다.
 * @returns {void}
 */
function rebuildVelocities(bodies, options) {
    const inverseDt = Math.fround(1 / options.dt);
    for (const body of bodies) {
        if (!bodyIsAlive(body)) {
            continue;
        }
        let predictedX = body.predictedX;
        let predictedY = body.predictedY;
        let velocityPreviousX = body.previousX;
        let velocityPreviousY = body.previousY;
        const layer = unpackGpuCirclePhysicsMeta(body.physicsMeta).bodyLayer;
        if (!isInsideWorld(predictedX, predictedY, options)
            && (layer & GPU_COLLISION_REFERENCE.ENEMY_LAYER_MASK) !== 0
            && isInsideWorld(body.previousX, body.previousY, options)) {
            predictedX = Math.fround(Math.max(
                0,
                Math.min(options.worldWidth - options.worldClampMargin, predictedX)
            ));
            predictedY = Math.fround(Math.max(
                0,
                Math.min(options.worldHeight - options.worldClampMargin, predictedY)
            ));
            velocityPreviousX = predictedX;
            velocityPreviousY = predictedY;
        }
        body.positionX = predictedX;
        body.positionY = predictedY;
        body.velocityX = Math.fround(
            Math.fround(predictedX - velocityPreviousX) * inverseDt
        );
        body.velocityY = Math.fround(
            Math.fround(predictedY - velocityPreviousY) * inverseDt
        );
    }
}

/**
 * 내부 body를 외부 immutable snapshot 형태로 변환합니다.
 * @param {*} body - 내부 body입니다.
 * @returns {*} 공개 body snapshot입니다.
 */
function toPublicBody(body) {
    return {
        bodyIndex: body.bodyIndex,
        position: { x: body.positionX, y: body.positionY },
        velocity: { x: body.velocityX, y: body.velocityY },
        previousPosition: { x: body.previousX, y: body.previousY },
        predictedPosition: { x: body.predictedX, y: body.predictedY },
        positionDelta: { x: body.deltaX, y: body.deltaY },
        radius: body.radius,
        inverseMass: body.inverseMass,
        physicsMeta: body.physicsMeta,
        interactionMeta: body.interactionMeta,
        simulationMeta: body.simulationMeta,
        gridIndex: body.gridIndex
    };
}

/**
 * 원본 collision-only profile을 실행합니다.
 * grid는 tick당 한 번 build하고 6회 clear/solve-body/solve-world/apply Jacobi pass를 수행합니다.
 * 입력 객체는 변경하지 않습니다.
 * @param {Array<*>} bodies - collision body 배열입니다.
 * @param {*} options - world/grid/dt와 optional sdfSample입니다.
 * @returns {{bodies:Array<*>,grid:*,stats:*}} solver 결과입니다.
 */
export function solveGpuCollisionReference(bodies, options) {
    if (!Array.isArray(bodies)) {
        throw new TypeError('bodies는 배열이어야 합니다.');
    }
    if (bodies.length > UINT32_MAX) {
        throw new RangeError('body count가 uint32 capacity를 초과했습니다.');
    }
    const normalizedOptions = normalizeOptions(options);
    const normalizedBodies = bodies.map(normalizeBody);
    const grid = buildGridFromNormalizedBodies(normalizedBodies, normalizedOptions);

    if (normalizedOptions.haltOnGridOverflow
        && (grid.smallOverflowCount > 0 || grid.bigOverflowCount > 0)) {
        for (const body of normalizedBodies) {
            if (!bodyIsAlive(body)) {
                continue;
            }
            body.positionX = body.previousX;
            body.positionY = body.previousY;
            body.predictedX = body.previousX;
            body.predictedY = body.previousY;
            body.deltaX = 0;
            body.deltaY = 0;
        }
        return {
            bodies: normalizedBodies.map(toPublicBody),
            grid,
            stats: Object.freeze({
                gridBuildCount: grid.buildCount,
                solverIterations: 0,
                smallOverflowCount: grid.smallOverflowCount,
                bigOverflowCount: grid.bigOverflowCount,
                haltedOnOverflow: true
            })
        };
    }

    for (let iteration = 0;
        iteration < GPU_COLLISION_REFERENCE.SOLVER_ITERATIONS;
        iteration += 1) {
        for (const body of normalizedBodies) {
            body.deltaX = 0;
            body.deltaY = 0;
        }
        solveBodyBodyIteration(normalizedBodies, grid, normalizedOptions);
        solveBodyWorldIteration(normalizedBodies, normalizedOptions);
        applyPositionDeltas(normalizedBodies, grid);
    }
    rebuildVelocities(normalizedBodies, normalizedOptions);

    return {
        bodies: normalizedBodies.map(toPublicBody),
        grid,
        stats: Object.freeze({
            gridBuildCount: grid.buildCount,
            solverIterations: GPU_COLLISION_REFERENCE.SOLVER_ITERATIONS,
            smallOverflowCount: grid.smallOverflowCount,
            bigOverflowCount: grid.bigOverflowCount,
            haltedOnOverflow: false
        })
    };
}

/**
 * fixed previous/current 사이의 strict interpolation을 계산합니다.
 * @param {{x:number,y:number}} previousPosition - fixed 시작 위치입니다.
 * @param {{x:number,y:number}} currentPosition - authoritative 현재 위치입니다.
 * @param {*} alpha - [0, 1] fixed accumulator alpha입니다.
 * @returns {{x:number,y:number}} Float32 render 위치입니다.
 */
export function interpolateStrictGpuCirclePosition(previousPosition, currentPosition, alpha) {
    if (!previousPosition || !currentPosition) {
        throw new TypeError('previousPosition과 currentPosition이 필요합니다.');
    }
    const safeAlpha = requireFloat32(alpha, 'alpha');
    if (safeAlpha < 0 || safeAlpha > 1) {
        throw new RangeError('strict interpolation alpha는 [0, 1] 범위여야 합니다.');
    }
    const previousX = requireFloat32(previousPosition.x, 'previousPosition.x');
    const previousY = requireFloat32(previousPosition.y, 'previousPosition.y');
    const currentX = requireFloat32(currentPosition.x, 'currentPosition.x');
    const currentY = requireFloat32(currentPosition.y, 'currentPosition.y');
    return {
        x: Math.fround(previousX + Math.fround((currentX - previousX) * safeAlpha)),
        y: Math.fround(previousY + Math.fround((currentY - previousY) * safeAlpha))
    };
}

/**
 * 추출 렌더 셰이더의 current + velocity * render-to-simulation delta 예측을 계산합니다.
 * @param {{x:number,y:number}} currentPosition - authoritative 현재 위치입니다.
 * @param {{x:number,y:number}} velocity - reconstructed velocity입니다.
 * @param {*} simulationTimeMs - 마지막 완료 simulation clock(ms)입니다.
 * @param {*} renderTimeMs - presentation clock(ms)입니다.
 * @returns {{x:number,y:number,predictionSeconds:number}} Float32 render 예측입니다.
 */
export function predictReferenceGpuCirclePosition(
    currentPosition,
    velocity,
    simulationTimeMs,
    renderTimeMs
) {
    if (!currentPosition || !velocity) {
        throw new TypeError('currentPosition과 velocity가 필요합니다.');
    }
    const currentX = requireFloat32(currentPosition.x, 'currentPosition.x');
    const currentY = requireFloat32(currentPosition.y, 'currentPosition.y');
    const velocityX = requireFloat32(velocity.x, 'velocity.x');
    const velocityY = requireFloat32(velocity.y, 'velocity.y');
    const simulationTime = requireFloat32(simulationTimeMs, 'simulationTimeMs');
    const renderTime = requireFloat32(renderTimeMs, 'renderTimeMs');
    if (simulationTime < 0 || renderTime < 0) {
        throw new RangeError('simulation/render clock은 0 이상이어야 합니다.');
    }
    const predictionSeconds = Math.fround(
        Math.max(Math.fround(renderTime - simulationTime) * Math.fround(0.001), 0)
    );
    return {
        x: Math.fround(currentX + Math.fround(velocityX * predictionSeconds)),
        y: Math.fround(currentY + Math.fround(velocityY * predictionSeconds)),
        predictionSeconds
    };
}
