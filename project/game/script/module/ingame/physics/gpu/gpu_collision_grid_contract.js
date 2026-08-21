function requirePositiveFinite(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 유한한 수여야 합니다.`);
    }
    return Math.fround(number);
}

function requirePositiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new RangeError(`${label}은 양의 안전한 정수여야 합니다.`);
    }
    return number;
}

function requireFinitePosition(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError('collision-grid position은 유한해야 합니다.');
    }
    return Object.freeze({ x: Math.fround(x), y: Math.fround(y) });
}

/**
 * Production collision-grid builder와 CPU recovery/admission oracle이 공유하는
 * immutable grid parameter snapshot을 만듭니다.
 */
export function createGpuCollisionGridDescriptor(options) {
    const worldSize = Object.freeze({
        x: requirePositiveFinite(options?.worldSize?.x, 'worldSize.x'),
        y: requirePositiveFinite(options?.worldSize?.y, 'worldSize.y')
    });
    const gridCellSize = Object.freeze({
        x: requirePositiveFinite(options?.gridCellSize?.x, 'gridCellSize.x'),
        y: requirePositiveFinite(options?.gridCellSize?.y, 'gridCellSize.y')
    });
    const gridCellCount = Object.freeze({
        x: requirePositiveInteger(
            options?.gridCellCount?.x,
            'gridCellCount.x'
        ),
        y: requirePositiveInteger(
            options?.gridCellCount?.y,
            'gridCellCount.y'
        )
    });
    return Object.freeze({
        worldSize,
        worldBounds: Object.freeze({
            minX: 0,
            minY: 0,
            maxX: worldSize.x,
            maxY: worldSize.y
        }),
        gridCellSize,
        gridCellCount,
        maxBodiesPerCell: requirePositiveInteger(
            options?.maxBodiesPerCell,
            'maxBodiesPerCell'
        ),
        maximumBodyRadius: Math.max(
            0,
            Math.fround(Number(options?.maximumBodyRadius) || 0)
        )
    });
}

/** Production WGSL `collision_grid_body_uses_small` exact Float32 oracle입니다. */
export function gpuCollisionGridBodyUsesSmall(radius, descriptor) {
    const value = requirePositiveFinite(radius, 'radius');
    const diameter = Math.fround(value * 2);
    return diameter <= Math.min(
        descriptor.gridCellSize.x,
        descriptor.gridCellSize.y
    );
}

function gridCellIndex(x, y, descriptor) {
    return (y * descriptor.gridCellCount.x) + x;
}

function gridCounterIndex(x, y, bucket, descriptor) {
    return (gridCellIndex(x, y, descriptor) * 2) + bucket;
}

/**
 * Production `build_tick_start_grid`/`build_grid`의 center gate, small/big
 * classification, big-body padding, clamp, bucket mapping을 그대로 재현합니다.
 */
export function getGpuCollisionGridFootprint(position, radius, descriptor) {
    const centerPosition = requireFinitePosition(position);
    const bodyRadius = requirePositiveFinite(radius, 'radius');
    const center = Object.freeze({
        x: Math.floor(Math.fround(
            centerPosition.x / descriptor.gridCellSize.x
        )),
        y: Math.floor(Math.fround(
            centerPosition.y / descriptor.gridCellSize.y
        ))
    });
    if (center.x < 0
        || center.y < 0
        || center.x >= descriptor.gridCellCount.x
        || center.y >= descriptor.gridCellCount.y) {
        return Object.freeze({
            valid: false,
            classification: null,
            bucket: null,
            center,
            minimumCell: null,
            maximumCell: null,
            counterIndices: Object.freeze([])
        });
    }

    if (gpuCollisionGridBodyUsesSmall(bodyRadius, descriptor)) {
        return Object.freeze({
            valid: true,
            classification: 'small',
            bucket: 0,
            center,
            minimumCell: center,
            maximumCell: center,
            counterIndices: Object.freeze([
                gridCounterIndex(center.x, center.y, 0, descriptor)
            ])
        });
    }

    const maximumSmallRadius = Math.fround(
        0.5 * Math.min(
            descriptor.gridCellSize.x,
            descriptor.gridCellSize.y
        )
    );
    const padding = Math.fround(bodyRadius + maximumSmallRadius);
    const maximumCellX = descriptor.gridCellCount.x - 1;
    const maximumCellY = descriptor.gridCellCount.y - 1;
    const minimumCell = Object.freeze({
        x: Math.max(0, Math.min(
            maximumCellX,
            Math.floor(Math.fround(
                Math.fround(centerPosition.x - padding)
                    / descriptor.gridCellSize.x
            ))
        )),
        y: Math.max(0, Math.min(
            maximumCellY,
            Math.floor(Math.fround(
                Math.fround(centerPosition.y - padding)
                    / descriptor.gridCellSize.y
            ))
        ))
    });
    const maximumCell = Object.freeze({
        x: Math.max(0, Math.min(
            maximumCellX,
            Math.floor(Math.fround(
                Math.fround(centerPosition.x + padding)
                    / descriptor.gridCellSize.x
            ))
        )),
        y: Math.max(0, Math.min(
            maximumCellY,
            Math.floor(Math.fround(
                Math.fround(centerPosition.y + padding)
                    / descriptor.gridCellSize.y
            ))
        ))
    });
    const counterIndices = [];
    for (let y = minimumCell.y; y <= maximumCell.y; y++) {
        for (let x = minimumCell.x; x <= maximumCell.x; x++) {
            counterIndices.push(gridCounterIndex(x, y, 1, descriptor));
        }
    }
    return Object.freeze({
        valid: true,
        classification: 'big',
        bucket: 1,
        center,
        minimumCell,
        maximumCell,
        counterIndices: Object.freeze(counterIndices)
    });
}

/**
 * 모든 GPU caller가 production builder와 같은 footprint 권위를 컴파일하도록
 * 하는 WGSL source fragment입니다. Caller는 `params: SimulationParams`를 소유합니다.
 */
export const GPU_COLLISION_GRID_AUTHORITY_WGSL = /* wgsl */`
struct CollisionGridFootprint {
    center: vec2i,
    minimum_cell: vec2i,
    maximum_cell: vec2i,
    bucket: u32,
    valid: u32,
}

fn collision_grid_body_uses_small(radius: f32) -> bool {
    return radius * 2.0
        <= min(params.grid_cell_size.x, params.grid_cell_size.y);
}

fn collision_grid_footprint(
    position: vec2f,
    radius: f32
) -> CollisionGridFootprint {
    let center = vec2i(floor(position / params.grid_cell_size));
    if (center.x < 0 || center.y < 0
        || center.x >= i32(params.grid_cell_count.x)
        || center.y >= i32(params.grid_cell_count.y)) {
        return CollisionGridFootprint(center, center, center, 0u, 0u);
    }
    if (collision_grid_body_uses_small(radius)) {
        return CollisionGridFootprint(center, center, center, 0u, 1u);
    }
    let maximum_small_radius = 0.5
        * min(params.grid_cell_size.x, params.grid_cell_size.y);
    let padding = vec2f(radius + maximum_small_radius);
    let maximum_cell = vec2i(params.grid_cell_count) - vec2i(1);
    let minimum_covered = clamp(
        vec2i(floor((position - padding) / params.grid_cell_size)),
        vec2i(0),
        maximum_cell
    );
    let maximum_covered = clamp(
        vec2i(floor((position + padding) / params.grid_cell_size)),
        vec2i(0),
        maximum_cell
    );
    return CollisionGridFootprint(
        center,
        minimum_covered,
        maximum_covered,
        1u,
        1u
    );
}

fn collision_grid_cell_index(cell: vec2i) -> u32 {
    return (u32(cell.y) * params.grid_cell_count.x) + u32(cell.x);
}

fn collision_grid_counter_index(cell: vec2i, bucket: u32) -> u32 {
    return (collision_grid_cell_index(cell) * 2u) + bucket;
}
`;
