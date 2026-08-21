import {
    sampleGpuWorldSignedDistance
} from '../../physics/gpu/gpu_signed_distance_field.js';
import {
    getGpuCollisionGridFootprint
} from '../../physics/gpu/gpu_collision_grid_contract.js';

export const TOWER_RECOVERY_LAYOUT_CANDIDATE_POLICY_ID
    = 'tower-recovery.square-anchor-lattice.v1';

export const TOWER_RECOVERY_LAYOUT_FAILURE_CODE
    = 'RECOVERY_LAYOUT_CAPACITY_EXCEEDED';

function requireFiniteNonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}은 0 이상의 유한한 수여야 합니다.`);
    }
    return Math.fround(number);
}

function requireFinitePosition(value, label) {
    const x = Number(value?.x);
    const y = Number(value?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`${label}에 유한한 x/y가 필요합니다.`);
    }
    return Object.freeze({ x: Math.fround(x), y: Math.fround(y) });
}

function compareTowerRecord(left, right) {
    const ordinalDelta = Number(left.logicalTowerOrdinal)
        - Number(right.logicalTowerOrdinal);
    if (ordinalDelta !== 0) {
        return ordinalDelta;
    }
    return String(left.logicalTowerId).localeCompare(String(right.logicalTowerId));
}

function* squareAnchorLattice(maximumRing) {
    yield Object.freeze({ x: 0, y: 0, ring: 0, rank: 0 });
    let rank = 1;
    for (let ring = 1; ring <= maximumRing; ring++) {
        for (let x = -ring; x <= ring; x++) {
            yield Object.freeze({ x, y: -ring, ring, rank: rank++ });
        }
        for (let y = -ring + 1; y <= ring; y++) {
            yield Object.freeze({ x: ring, y, ring, rank: rank++ });
        }
        for (let x = ring - 1; x >= -ring; x--) {
            yield Object.freeze({ x, y: ring, ring, rank: rank++ });
        }
        for (let y = ring - 1; y >= -ring + 1; y--) {
            yield Object.freeze({ x: -ring, y, ring, rank: rank++ });
        }
    }
}

function positionsOverlap(left, right, clearance) {
    const minimumDistance = Math.fround(
        left.radius + right.radius + clearance
    );
    const deltaX = Math.fround(left.position.x - right.position.x);
    const deltaY = Math.fround(left.position.y - right.position.y);
    return Math.fround(
        Math.fround(deltaX * deltaX) + Math.fround(deltaY * deltaY)
    ) < Math.fround(minimumDistance * minimumDistance);
}

function footprintHasCapacity(footprint, occupancy, capacity) {
    return footprint.counterIndices.every(
        (counterIndex) => (occupancy.get(counterIndex) ?? 0) < capacity
    );
}

function commitFootprint(footprint, occupancy) {
    for (const counterIndex of footprint.counterIndices) {
        occupancy.set(counterIndex, (occupancy.get(counterIndex) ?? 0) + 1);
    }
}

function createBody(position, radius) {
    return Object.freeze({ position, radius });
}

export class TowerRecoveryLayoutCapacityError extends Error {
    constructor(diagnostic) {
        super(
            `Tower recovery layout이 ${diagnostic.requestedCount}개 중 `
            + `${diagnostic.placedCount}개만 배치했습니다.`
        );
        this.name = 'TowerRecoveryLayoutCapacityError';
        this.code = TOWER_RECOVERY_LAYOUT_FAILURE_CODE;
        this.diagnostic = Object.freeze({
            code: this.code,
            ...diagnostic
        });
    }
}

/**
 * Recovery만의 anchor/ordinal lattice policy입니다. Static SDF, exact body
 * separation, production grid footprint/capacity를 모두 통과한 경우에만
 * immutable N-placement를 반환하며 실패하면 0/N을 보존합니다.
 */
export function planTowerRecoveryLayout(options) {
    const records = Array.isArray(options?.records)
        ? [...options.records].sort(compareTowerRecord)
        : null;
    if (!records) {
        throw new TypeError('Tower recovery records는 배열이어야 합니다.');
    }
    const duplicateOrdinals = new Set();
    for (const record of records) {
        const ordinal = Number(record?.logicalTowerOrdinal);
        if (!Number.isSafeInteger(ordinal)
            || ordinal <= 0
            || duplicateOrdinals.has(ordinal)) {
            throw new TypeError('Tower recovery ordinal은 서로 다른 양의 정수여야 합니다.');
        }
        duplicateOrdinals.add(ordinal);
    }
    const anchor = requireFinitePosition(options?.anchorPosition, 'anchorPosition');
    const radius = requireFiniteNonNegative(options?.radius, 'radius');
    if (radius <= 0) {
        throw new RangeError('Tower recovery radius는 양수여야 합니다.');
    }
    const clearance = requireFiniteNonNegative(
        options?.clearance,
        'clearance'
    );
    const sdf = options?.sdf;
    const grid = options?.grid;
    const worldBounds = options?.worldBounds ?? grid?.worldBounds;
    if (!sdf || !grid || !worldBounds) {
        throw new TypeError('Tower recovery에 SDF/worldBounds/grid snapshot이 필요합니다.');
    }

    const existingBodies = (options?.existingBodies ?? []).map((body, index) => (
        createBody(
            requireFinitePosition(body?.position, `existingBodies[${index}].position`),
            requireFiniteNonNegative(body?.radius, `existingBodies[${index}].radius`)
        )
    ));
    const occupancy = new Map();
    for (const body of existingBodies) {
        const footprint = getGpuCollisionGridFootprint(
            body.position,
            body.radius,
            grid
        );
        if (!footprint.valid
            || !footprintHasCapacity(
                footprint,
                occupancy,
                grid.maxBodiesPerCell
            )) {
            throw new TowerRecoveryLayoutCapacityError({
                requestedCount: records.length,
                placedCount: 0,
                candidateCount: 0,
                lastRejectionClass: 'EXISTING_BODY_GRID_CAPACITY',
                maximumRing: 0
            });
        }
        commitFootprint(footprint, occupancy);
    }

    if (records.length === 0) {
        return Object.freeze({
            placements: Object.freeze([]),
            candidateCount: 0,
            maximumRing: 0
        });
    }

    const spacing = Math.fround(Math.fround(radius * 2) + clearance);
    const maximumWorldOffset = Math.max(
        Math.abs(anchor.x - Number(worldBounds.minX)),
        Math.abs(Number(worldBounds.maxX) - anchor.x),
        Math.abs(anchor.y - Number(worldBounds.minY)),
        Math.abs(Number(worldBounds.maxY) - anchor.y)
    );
    const maximumRing = Math.ceil(maximumWorldOffset / spacing) + 1;
    const placements = [];
    const placedBodies = [];
    let candidateCount = 0;
    let lastRejectionClass = 'NO_CANDIDATE';

    for (const offset of squareAnchorLattice(maximumRing)) {
        if (placements.length >= records.length) {
            break;
        }
        candidateCount++;
        const position = Object.freeze({
            x: Math.fround(anchor.x + Math.fround(offset.x * spacing)),
            y: Math.fround(anchor.y + Math.fround(offset.y * spacing))
        });
        const staticDistance = sampleGpuWorldSignedDistance(
            sdf,
            worldBounds,
            position.x,
            position.y
        );
        if (staticDistance < Math.fround(radius + clearance)) {
            lastRejectionClass = 'STATIC_SDF';
            continue;
        }
        const candidateBody = createBody(position, radius);
        if (existingBodies.some((body) => positionsOverlap(
            candidateBody,
            body,
            clearance
        ))) {
            lastRejectionClass = 'EXISTING_BODY';
            continue;
        }
        if (placedBodies.some((body) => positionsOverlap(
            candidateBody,
            body,
            clearance
        ))) {
            lastRejectionClass = 'SIBLING_BODY';
            continue;
        }
        const footprint = getGpuCollisionGridFootprint(position, radius, grid);
        if (!footprint.valid) {
            lastRejectionClass = 'GRID_OUT_OF_BOUNDS';
            continue;
        }
        if (!footprintHasCapacity(
            footprint,
            occupancy,
            grid.maxBodiesPerCell
        )) {
            lastRejectionClass = 'GRID_CELL_CAPACITY';
            continue;
        }
        const record = records[placements.length];
        commitFootprint(footprint, occupancy);
        placedBodies.push(candidateBody);
        placements.push(Object.freeze({
            logicalTowerId: record.logicalTowerId,
            logicalTowerOrdinal: record.logicalTowerOrdinal,
            position,
            candidateRank: offset.rank,
            candidateRing: offset.ring,
            gridClassification: footprint.classification,
            gridCounterIndices: footprint.counterIndices
        }));
    }

    if (placements.length !== records.length) {
        throw new TowerRecoveryLayoutCapacityError({
            requestedCount: records.length,
            placedCount: placements.length,
            candidateCount,
            lastRejectionClass,
            maximumRing
        });
    }
    return Object.freeze({
        placements: Object.freeze(placements),
        candidateCount,
        maximumRing
    });
}
