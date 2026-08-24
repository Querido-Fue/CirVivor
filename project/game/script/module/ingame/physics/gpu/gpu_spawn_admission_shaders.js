import {
    GPU_COLLISION_GRID_AUTHORITY_WGSL
} from './gpu_collision_grid_contract.js';

export const GPU_SPAWN_ADMISSION_STORAGE_BINDING_COUNT = 8;

export const GPU_SPAWN_ADMISSION_REJECTION = Object.freeze({
    NONE: 0,
    STATIC_SDF: 1 << 0,
    EXISTING_BODY: 1 << 1,
    SIBLING_BODY: 1 << 2,
    GRID_CELL_CAPACITY: 1 << 3
});

/**
 * Caller는 `admission_physics`, `admission_simulations`,
 * `admission_grid_counts`, `admission_grid_bodies`, `params`와 아래
 * claim adapter 3개와 cooperative workgroup 상수/atomic scratch를 정의합니다.
 * Candidate generation은 이 fragment 밖의 payload-local 권위이며,
 * verdict/ordinal claim만 공유합니다.
 */
export const GPU_SPAWN_ADMISSION_SHARED_WGSL = /* wgsl */`
const SPAWN_ADMISSION_REJECT_STATIC_SDF: u32 =
    ${GPU_SPAWN_ADMISSION_REJECTION.STATIC_SDF}u;
const SPAWN_ADMISSION_REJECT_EXISTING_BODY: u32 =
    ${GPU_SPAWN_ADMISSION_REJECTION.EXISTING_BODY}u;
const SPAWN_ADMISSION_REJECT_SIBLING_BODY: u32 =
    ${GPU_SPAWN_ADMISSION_REJECTION.SIBLING_BODY}u;
const SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY: u32 =
    ${GPU_SPAWN_ADMISSION_REJECTION.GRID_CELL_CAPACITY}u;

struct SpawnAdmissionVerdict {
    accepted: u32,
    rejection_class: u32,
}

${GPU_COLLISION_GRID_AUTHORITY_WGSL}

fn spawn_admission_body_overlap(
    position: vec2f,
    radius: f32,
    other: GridBody
) -> bool {
    let delta = other.predicted_position - position;
    let minimum_distance = radius + other.radius;
    return dot(delta, delta) < minimum_distance * minimum_distance;
}

fn spawn_admission_bucket_overlaps_existing(
    position: vec2f,
    radius: f32,
    counter_index: u32,
    destination_slot: u32
) -> bool {
    let count = min(
        atomicLoad(&admission_grid_counts.values[counter_index]),
        params.max_bodies_per_cell
    );
    let offset = counter_index * params.max_bodies_per_cell;
    for (var index = 0u; index < count; index += 1u) {
        let other = admission_grid_bodies.values[offset + index];
        if (other.body_id == destination_slot
            || other.body_id >= arrayLength(&admission_simulations.values)
            || (other.flags & SPAWN_ADMISSION_ALIVE_FLAG) == 0u
            || !(other.radius > 0.0)) {
            continue;
        }
        if (spawn_admission_body_overlap(position, radius, other)) {
            return true;
        }
    }
    return false;
}

fn spawn_admission_overlaps_existing(
    position: vec2f,
    radius: f32,
    destination_slot: u32
) -> bool {
    let footprint = collision_grid_footprint(position, radius);
    if (footprint.valid == 0u) {
        return true;
    }
    if (footprint.bucket == 0u) {
        for (var y = footprint.center.y - 1;
            y <= footprint.center.y + 1;
            y += 1) {
            for (var x = footprint.center.x - 1;
                x <= footprint.center.x + 1;
                x += 1) {
                if (x < 0 || y < 0
                    || x >= i32(params.grid_cell_count.x)
                    || y >= i32(params.grid_cell_count.y)) {
                    continue;
                }
                if (spawn_admission_bucket_overlaps_existing(
                    position,
                    radius,
                    collision_grid_counter_index(vec2i(x, y), 0u),
                    destination_slot
                )) {
                    return true;
                }
            }
        }
        return spawn_admission_bucket_overlaps_existing(
            position,
            radius,
            collision_grid_counter_index(footprint.center, 1u),
            destination_slot
        );
    }

    let interaction_radius = radius + max(params.maximum_body_radius, 0.0);
    let maximum_cell = vec2i(params.grid_cell_count) - vec2i(1);
    let minimum_covered = clamp(
        vec2i(floor(
            (position - vec2f(interaction_radius)) / params.grid_cell_size
        )),
        vec2i(0),
        maximum_cell
    );
    let maximum_covered = clamp(
        vec2i(floor(
            (position + vec2f(interaction_radius)) / params.grid_cell_size
        )),
        vec2i(0),
        maximum_cell
    );
    for (var y = minimum_covered.y; y <= maximum_covered.y; y += 1) {
        for (var x = minimum_covered.x; x <= maximum_covered.x; x += 1) {
            let cell = vec2i(x, y);
            if (spawn_admission_bucket_overlaps_existing(
                    position,
                    radius,
                    collision_grid_counter_index(cell, 0u),
                    destination_slot
                )
                || spawn_admission_bucket_overlaps_existing(
                    position,
                    radius,
                    collision_grid_counter_index(cell, 1u),
                    destination_slot
                )) {
                return true;
            }
        }
    }
    return false;
}

fn spawn_admission_overlaps_sibling(
    position: vec2f,
    radius: f32,
    claim_count: u32
) -> bool {
    for (var rank = 0u; rank < claim_count; rank += 1u) {
        if (!spawn_admission_claim_is_committed(rank)) {
            continue;
        }
        let delta = spawn_admission_claim_position(rank) - position;
        let minimum_distance = radius + spawn_admission_claim_radius(rank);
        if (dot(delta, delta) < minimum_distance * minimum_distance) {
            return true;
        }
    }
    return false;
}

fn spawn_admission_footprint_contains_counter(
    footprint: CollisionGridFootprint,
    counter_index: u32
) -> bool {
    for (var y = footprint.minimum_cell.y;
        y <= footprint.maximum_cell.y;
        y += 1) {
        for (var x = footprint.minimum_cell.x;
            x <= footprint.maximum_cell.x;
            x += 1) {
            if (collision_grid_counter_index(
                    vec2i(x, y),
                    footprint.bucket
                ) == counter_index) {
                return true;
            }
        }
    }
    return false;
}

fn spawn_admission_cell_capacity_available(
    position: vec2f,
    radius: f32,
    claim_count: u32
) -> bool {
    let footprint = collision_grid_footprint(position, radius);
    if (footprint.valid == 0u) {
        return false;
    }
    for (var y = footprint.minimum_cell.y;
        y <= footprint.maximum_cell.y;
        y += 1) {
        for (var x = footprint.minimum_cell.x;
            x <= footprint.maximum_cell.x;
            x += 1) {
            let counter_index = collision_grid_counter_index(
                vec2i(x, y),
                footprint.bucket
            );
            var post_commit_count = atomicLoad(
                &admission_grid_counts.values[counter_index]
            ) + 1u;
            for (var rank = 0u; rank < claim_count; rank += 1u) {
                if (!spawn_admission_claim_is_committed(rank)) {
                    continue;
                }
                let sibling_footprint = collision_grid_footprint(
                    spawn_admission_claim_position(rank),
                    spawn_admission_claim_radius(rank)
                );
                if (sibling_footprint.valid != 0u
                    && spawn_admission_footprint_contains_counter(
                        sibling_footprint,
                        counter_index
                    )) {
                    post_commit_count += 1u;
                }
            }
            if (post_commit_count > params.max_bodies_per_cell) {
                return false;
            }
        }
    }
    return true;
}

fn spawn_admission_claim(
    static_valid: bool,
    position: vec2f,
    radius: f32,
    destination_slot: u32,
    prior_claim_count: u32
) -> SpawnAdmissionVerdict {
    if (!static_valid) {
        return SpawnAdmissionVerdict(
            0u,
            SPAWN_ADMISSION_REJECT_STATIC_SDF
        );
    }
    if (spawn_admission_overlaps_existing(
        position,
        radius,
        destination_slot
    )) {
        return SpawnAdmissionVerdict(
            0u,
            SPAWN_ADMISSION_REJECT_EXISTING_BODY
        );
    }
    if (spawn_admission_overlaps_sibling(
        position,
        radius,
        prior_claim_count
    )) {
        return SpawnAdmissionVerdict(
            0u,
            SPAWN_ADMISSION_REJECT_SIBLING_BODY
        );
    }
    if (!spawn_admission_cell_capacity_available(
        position,
        radius,
        prior_claim_count
    )) {
        return SpawnAdmissionVerdict(
            0u,
            SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY
        );
    }
    return SpawnAdmissionVerdict(1u, 0u);
}

fn spawn_admission_cooperative_cell(
    footprint: CollisionGridFootprint,
    ordinal: u32
) -> vec2i {
    let width = u32(
        footprint.maximum_cell.x - footprint.minimum_cell.x + 1
    );
    return vec2i(
        footprint.minimum_cell.x + i32(ordinal % width),
        footprint.minimum_cell.y + i32(ordinal / width)
    );
}

/**
 * Stable destination rank는 직렬로 유지하되 한 후보의 prior-sibling 검사를
 * workgroup 전체에 분산합니다. 반환 verdict는 serial spawn_admission_claim과
 * bit-for-bit 같은 의미를 가집니다.
 */
fn spawn_admission_claim_cooperative(
    static_valid: bool,
    position: vec2f,
    radius: f32,
    destination_slot: u32,
    prior_claim_count: u32,
    lane: u32
) -> SpawnAdmissionVerdict {
    if (lane == 0u) {
        atomicStore(&spawn_admission_cooperative_rejection, 0u);
    }
    if (lane < SPAWN_ADMISSION_COOPERATIVE_CELL_CAPACITY) {
        atomicStore(
            &spawn_admission_cooperative_cell_claim_counts[lane],
            0u
        );
    }
    workgroupBarrier();

    let footprint = collision_grid_footprint(position, radius);
    let width = u32(max(
        footprint.maximum_cell.x - footprint.minimum_cell.x + 1,
        1
    ));
    let height = u32(max(
        footprint.maximum_cell.y - footprint.minimum_cell.y + 1,
        1
    ));
    let cell_count = width * height;
    if (lane == 0u) {
        if (!static_valid || footprint.valid == 0u) {
            atomicOr(
                &spawn_admission_cooperative_rejection,
                SPAWN_ADMISSION_REJECT_STATIC_SDF
            );
        } else if (spawn_admission_overlaps_existing(
            position,
            radius,
            destination_slot
        )) {
            atomicOr(
                &spawn_admission_cooperative_rejection,
                SPAWN_ADMISSION_REJECT_EXISTING_BODY
            );
        }
    }

    for (var rank = lane;
        rank < prior_claim_count;
        rank += SPAWN_ADMISSION_WORKGROUP_SIZE) {
        if (!spawn_admission_claim_is_committed(rank)) {
            continue;
        }
        let sibling_position = spawn_admission_claim_position(rank);
        let sibling_radius = spawn_admission_claim_radius(rank);
        let delta = sibling_position - position;
        let minimum_distance = radius + sibling_radius;
        if (dot(delta, delta) < minimum_distance * minimum_distance) {
            atomicOr(
                &spawn_admission_cooperative_rejection,
                SPAWN_ADMISSION_REJECT_SIBLING_BODY
            );
        }
        if (footprint.valid == 0u
            || cell_count > SPAWN_ADMISSION_COOPERATIVE_CELL_CAPACITY) {
            continue;
        }
        let sibling_footprint = collision_grid_footprint(
            sibling_position,
            sibling_radius
        );
        if (sibling_footprint.valid == 0u) {
            continue;
        }
        for (var cell_ordinal = 0u;
            cell_ordinal < cell_count;
            cell_ordinal += 1u) {
            let cell = spawn_admission_cooperative_cell(
                footprint,
                cell_ordinal
            );
            let counter_index = collision_grid_counter_index(
                cell,
                footprint.bucket
            );
            if (spawn_admission_footprint_contains_counter(
                sibling_footprint,
                counter_index
            )) {
                atomicAdd(
                    &spawn_admission_cooperative_cell_claim_counts[
                        cell_ordinal
                    ],
                    1u
                );
            }
        }
    }
    workgroupBarrier();

    if (lane == 0u && footprint.valid != 0u) {
        if (cell_count <= SPAWN_ADMISSION_COOPERATIVE_CELL_CAPACITY) {
            for (var cell_ordinal = 0u;
                cell_ordinal < cell_count;
                cell_ordinal += 1u) {
                let cell = spawn_admission_cooperative_cell(
                    footprint,
                    cell_ordinal
                );
                let counter_index = collision_grid_counter_index(
                    cell,
                    footprint.bucket
                );
                let post_commit_count = atomicLoad(
                    &admission_grid_counts.values[counter_index]
                ) + 1u + atomicLoad(
                    &spawn_admission_cooperative_cell_claim_counts[
                        cell_ordinal
                    ]
                );
                if (post_commit_count > params.max_bodies_per_cell) {
                    atomicOr(
                        &spawn_admission_cooperative_rejection,
                        SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY
                    );
                }
            }
        } else if (!spawn_admission_cell_capacity_available(
            position,
            radius,
            prior_claim_count
        )) {
            atomicOr(
                &spawn_admission_cooperative_rejection,
                SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY
            );
        }
    }
    workgroupBarrier();

    let observed_rejection_class = atomicLoad(
        &spawn_admission_cooperative_rejection
    );
    var rejection_class = 0u;
    if ((observed_rejection_class
            & SPAWN_ADMISSION_REJECT_STATIC_SDF) != 0u) {
        rejection_class = SPAWN_ADMISSION_REJECT_STATIC_SDF;
    } else if ((observed_rejection_class
            & SPAWN_ADMISSION_REJECT_EXISTING_BODY) != 0u) {
        rejection_class = SPAWN_ADMISSION_REJECT_EXISTING_BODY;
    } else if ((observed_rejection_class
            & SPAWN_ADMISSION_REJECT_SIBLING_BODY) != 0u) {
        rejection_class = SPAWN_ADMISSION_REJECT_SIBLING_BODY;
    } else if ((observed_rejection_class
            & SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY) != 0u) {
        rejection_class = SPAWN_ADMISSION_REJECT_GRID_CELL_CAPACITY;
    }
    return SpawnAdmissionVerdict(
        select(1u, 0u, rejection_class != 0u),
        rejection_class
    );
}
`;

export const GPU_SPAWN_ADMISSION_GRID_TYPES_WGSL = /* wgsl */`
struct GridBody {
    predicted_position: vec2f,
    physical_meta: u32,
    flags: u32,
    inverse_mass: f32,
    radius: f32,
    body_id: u32,
    interaction_meta: u32,
}

struct AtomicGridCounts { values: array<atomic<u32>> }
struct GridBodyBuffer { values: array<GridBody> }

struct FlowStage {
    goal_position: vec2f,
    next_field_index: i32,
    transition_radius: f32,
}

struct SimulationParams {
    world_size: vec2f,
    grid_cell_size: vec2f,
    grid_cell_count: vec2u,
    max_bodies_per_cell: u32,
    solver_iterations: u32,
    dt: f32,
    inverse_dt: f32,
    sdf_size: vec2u,
    sdf_enabled: u32,
    velocity_damping: f32,
    max_speed: f32,
    source_world_unit_scale: f32,
    flow_size: vec2u,
    flow_field_count: u32,
    flow_enabled: u32,
    flow_origin: vec2f,
    flow_cell_size: vec2f,
    flow_stages: array<FlowStage, 256>,
    max_contacts: u32,
    max_events: u32,
    max_death_events: u32,
    maximum_body_radius: f32,
    fixed_tick: u32,
    reserved_0: u32,
    reserved_1: u32,
    reserved_2: u32,
}
`;
