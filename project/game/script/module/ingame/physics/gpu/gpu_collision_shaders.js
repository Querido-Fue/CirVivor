export const GPU_COLLISION_COMPUTE_WGSL = /* wgsl */`
const BODY_FLAG_ALIVE: u32 = 1u;
const BODY_FLAG_USE_FLOW: u32 = 2u;
const BODY_LAYER_ENEMY: u32 = 1u;
const BODY_LAYER_TERRAIN: u32 = 128u;
const CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN: u32 = 1u;
const CONTACT_HANDLER_FLAG_CLOSEST_ONLY: u32 = 2u;
const APPLIED_EVENT_FLAG_TARGET_DIED: u32 = 1u;
const APPLIED_EVENT_FLAG_TERRAIN_KILL: u32 = 2u;
const DEATH_EVENT_FLAG_HEALTH: u32 = 1u;
const DEATH_EVENT_FLAG_LIFETIME: u32 = 2u;
const EPSILON_MASS: f32 = 0.000001;
const EPSILON_DISTANCE_SQUARED: f32 = 0.000000000001;
const SOLVER_WORKGROUP_SIZE: u32 = 64u;

struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    reserved: u32,
}

struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physics_meta: u32,
    reserved: u32,
}

struct BodySimulation {
    lifetime: f32,
    health: atomic<i32>,
    timer: u32,
    simulation_meta: atomic<u32>,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct BodyTemporary {
    previous_position: vec2f,
    predicted_position: vec2f,
    position_delta: vec2f,
    grid_index: i32,
    previous_flow_field_index: u32,
}

struct GridBody {
    predicted_position: vec2f,
    physics_meta: u32,
    simulation_meta: u32,
    inverse_mass: f32,
    radius: f32,
    body_id: u32,
    reserved: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct SimulationBuffer { values: array<BodySimulation> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct AtomicGridCounts { values: array<atomic<u32>> }
struct GridBodyBuffer { values: array<GridBody> }
struct SdfBuffer { values: array<f32> }

struct ContactHandler {
    damage_self: f32,
    damage_other: f32,
    damage_falloff: f32,
    fire_timer: f32,
    flags: u32,
    chaining: i32,
    damage_report_id: i32,
    slow_timer: f32,
}

struct ContactHandlerBuffer { values: array<ContactHandler> }

struct ContactState {
    contact_count: atomic<u32>,
    contact_overflow: atomic<u32>,
    event_count: atomic<u32>,
    event_overflow: atomic<u32>,
    death_count: atomic<u32>,
    death_overflow: atomic<u32>,
    reserved_0: atomic<u32>,
    reserved_1: atomic<u32>,
}

struct Contact {
    self_body_id: u32,
    self_incarnation: u32,
    other_body_id: i32,
    other_incarnation: u32,
    world_position: vec2f,
    normal: vec2f,
}

struct ContactBuffer { values: array<Contact> }

struct AppliedEvent {
    self_entity_id: u32,
    self_incarnation: u32,
    other_entity_id: u32,
    other_incarnation: u32,
    damage_applied: i32,
    flags: u32,
    world_position: vec2f,
}

struct AppliedEventBuffer { values: array<AppliedEvent> }

struct DeathEvent {
    entity_id: u32,
    incarnation: u32,
    body_id: u32,
    reason_flags: u32,
}

struct DeathEventBuffer { values: array<DeathEvent> }

struct GridOverflow {
    small_count: atomic<u32>,
    big_count: atomic<u32>,
    total_small_count: atomic<u32>,
    total_big_count: atomic<u32>,
}

struct FlowStage {
    goal_cell: vec2u,
    next_field_index: i32,
    reserved: u32,
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
}

@group(0) @binding(0) var<storage, read_write> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read_write> simulations: SimulationBuffer;
@group(0) @binding(3) var<storage, read_write> temporaries: TemporaryBuffer;
@group(0) @binding(4) var<storage, read> contact_handlers: ContactHandlerBuffer;
@group(1) @binding(0) var<storage, read_write> grid_counts: AtomicGridCounts;
@group(1) @binding(1) var<storage, read_write> grid_bodies: GridBodyBuffer;
@group(1) @binding(2) var<storage, read> sdf_values: SdfBuffer;
@group(1) @binding(3) var<storage, read_write> grid_overflow: GridOverflow;
@group(1) @binding(4) var world_flow: texture_2d_array<f32>;
@group(2) @binding(0) var<uniform> params: SimulationParams;
@group(3) @binding(0) var<storage, read_write> contact_state: ContactState;
@group(3) @binding(1) var<storage, read_write> contacts: ContactBuffer;
@group(3) @binding(2) var<storage, read_write> applied_events: AppliedEventBuffer;
@group(3) @binding(3) var<storage, read_write> death_events: DeathEventBuffer;

const NEIGHBOR_OFFSETS = array<vec2i, 9>(
    vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
    vec2i(-1, 0), vec2i(0, 0), vec2i(1, 0),
    vec2i(-1, 1), vec2i(0, 1), vec2i(1, 1)
);

var<workgroup> neighbor_cell_counts: array<u32, 9>;
var<workgroup> neighbor_cell_indices: array<u32, 9>;
var<workgroup> current_cell_count: u32;
var<workgroup> current_big_count: u32;

fn body_layer(packed_meta: u32) -> u32 {
    return packed_meta & 255u;
}

fn body_collision_mask(packed_meta: u32) -> u32 {
    return (packed_meta >> 8u) & 255u;
}

fn body_sensor_mask(packed_meta: u32) -> u32 {
    return (packed_meta >> 16u) & 255u;
}

fn body_is_alive(packed_meta: u32) -> bool {
    return (((packed_meta >> 8u) & 255u) & BODY_FLAG_ALIVE) == BODY_FLAG_ALIVE;
}

fn body_has_flag(packed_meta: u32, flag: u32) -> bool {
    return ((((packed_meta >> 8u) & 255u) & flag) == flag);
}

fn load_simulation_meta(body_id: u32) -> u32 {
    return atomicLoad(&simulations.values[body_id].simulation_meta);
}

fn body_id_is_alive(body_id: u32) -> bool {
    return body_is_alive(load_simulation_meta(body_id));
}

fn flow_cell_for_position(position: vec2f) -> vec2i {
    let raw_cell = vec2i(floor((position - params.flow_origin) / params.flow_cell_size));
    return clamp(raw_cell, vec2i(0), vec2i(params.flow_size) - vec2i(1));
}

fn flow_direction(field_index: u32, cell: vec2i) -> vec2f {
    return textureLoad(world_flow, cell, i32(field_index), 0).xy;
}

fn grid_cell_total() -> u32 {
    return params.grid_cell_count.x * params.grid_cell_count.y;
}

fn grid_bucket_offset(cell_index: u32, bucket: u32) -> u32 {
    return ((cell_index * 2u) + bucket) * params.max_bodies_per_cell;
}

fn grid_has_overflow() -> bool {
    return atomicLoad(&grid_overflow.small_count) > 0u
        || atomicLoad(&grid_overflow.big_count) > 0u;
}

fn body_uses_small_grid(radius: f32) -> bool {
    return radius + max(params.maximum_body_radius, 0.0)
        <= min(params.grid_cell_size.x, params.grid_cell_size.y);
}

fn deterministic_separation_normal(self_body_id: u32, other_body_id: u32) -> vec2f {
    let self_entity_id = simulations.values[self_body_id].entity_id;
    let other_entity_id = simulations.values[other_body_id].entity_id;
    let self_is_first = self_entity_id < other_entity_id
        || (self_entity_id == other_entity_id && self_body_id < other_body_id);
    let low_id = min(self_entity_id, other_entity_id);
    let high_id = max(self_entity_id, other_entity_id);
    var mixed = low_id * 1664525u + high_id * 1013904223u;
    mixed ^= mixed >> 16u;
    let selector = mixed & 3u;
    var base = vec2f(1.0, 0.0);
    if (selector == 1u) {
        base = vec2f(0.0, 1.0);
    } else if (selector == 2u) {
        base = normalize(vec2f(1.0, 1.0));
    } else if (selector == 3u) {
        base = normalize(vec2f(1.0, -1.0));
    }
    return select(-base, base, self_is_first);
}

fn make_grid_body(body_id: u32, predicted_position: vec2f) -> GridBody {
    return GridBody(
        predicted_position,
        physics.values[body_id].physics_meta,
        load_simulation_meta(body_id),
        physics.values[body_id].inverse_mass,
        physics.values[body_id].radius,
        body_id,
        0u
    );
}

@compute @workgroup_size(256)
fn prepare_bodies(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    let current = physics.values[body_id].position;
    var velocity = physics.values[body_id].velocity;
    let simulation_meta = load_simulation_meta(body_id);
    temporaries.values[body_id].previous_flow_field_index
        = simulations.values[body_id].flow_field_index;
    if (!body_is_alive(simulation_meta)) {
        temporaries.values[body_id].previous_position = current;
        temporaries.values[body_id].predicted_position = current;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        temporaries.values[body_id].grid_index = -1;
        return;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime >= 0.0) {
        simulations.values[body_id].lifetime = lifetime - params.dt;
    }
    if (params.flow_enabled != 0u
        && params.flow_field_count > 0u
        && body_has_flag(simulation_meta, BODY_FLAG_USE_FLOW)
        && simulations.values[body_id].flow_field_index < params.flow_field_count) {
        let cell = flow_cell_for_position(current);
        var field_index = simulations.values[body_id].flow_field_index;
        var stage = params.flow_stages[field_index];
        var reached_final_goal = false;
        if (u32(cell.x) == stage.goal_cell.x && u32(cell.y) == stage.goal_cell.y) {
            if (stage.next_field_index >= 0
                && u32(stage.next_field_index) < params.flow_field_count) {
                field_index = u32(stage.next_field_index);
                simulations.values[body_id].flow_field_index = field_index;
                stage = params.flow_stages[field_index];
            } else {
                reached_final_goal = true;
            }
        }

        if (reached_final_goal) {
            velocity = vec2f(0.0);
        } else {
            var direction = flow_direction(field_index, cell);
            if (abs(direction.x) < EPSILON_MASS && abs(direction.y) < EPSILON_MASS) {
                let goal_position = params.flow_origin
                    + ((vec2f(stage.goal_cell) + vec2f(0.5)) * params.flow_cell_size);
                direction = goal_position - current;
            }
            let direction_length = length(direction);
            if (direction_length >= EPSILON_MASS) {
                direction /= direction_length;
                let maximum_speed = max(simulations.values[body_id].flow_speed, 0.0);
                let adjustment_factor = min(params.dt, 1.0);
                velocity = mix(
                    velocity,
                    direction * maximum_speed,
                    vec2f(adjustment_factor)
                );
                let speed = length(velocity);
                if (speed > maximum_speed) {
                    velocity = (velocity / speed) * maximum_speed;
                }
            }
        }
    }
    if (velocity.x != velocity.x) {
        velocity.x = 0.0;
    }
    if (velocity.y != velocity.y) {
        velocity.y = 0.0;
    }
    temporaries.values[body_id].previous_position = current;
    temporaries.values[body_id].predicted_position = current;
    if (physics.values[body_id].inverse_mass > EPSILON_MASS) {
        temporaries.values[body_id].predicted_position = current
            + (velocity * params.dt);
    }
    temporaries.values[body_id].position_delta = vec2f(0.0);
    temporaries.values[body_id].grid_index = -1;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) global_id: vec3u) {
    let index = global_id.x;
    let total_bucket_count = grid_cell_total() * 2u;
    if (index < total_bucket_count) {
        atomicStore(&grid_counts.values[index], 0u);
    }
    if (index == 0u) {
        atomicStore(&grid_overflow.small_count, 0u);
        atomicStore(&grid_overflow.big_count, 0u);
    }
}

@compute @workgroup_size(256)
fn build_grid(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }

    temporaries.values[body_id].grid_index = -1;
    if (!body_id_is_alive(body_id)) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let cell = vec2i(floor(predicted / params.grid_cell_size));
    if (cell.x < 0 || cell.y < 0
        || cell.x >= i32(params.grid_cell_count.x)
        || cell.y >= i32(params.grid_cell_count.y)) {
        return;
    }

    let body = physics.values[body_id];
    let grid_body = make_grid_body(body_id, predicted);
    let max_per_cell = params.max_bodies_per_cell;
    if (body_uses_small_grid(body.radius)) {
        let cell_index = (u32(cell.y) * params.grid_cell_count.x) + u32(cell.x);
        let counter_index = cell_index * 2u;
        let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
        if (slot >= max_per_cell) {
            atomicAdd(&grid_overflow.small_count, 1u);
            atomicAdd(&grid_overflow.total_small_count, 1u);
            return;
        }
        let storage_index = (counter_index * max_per_cell) + slot;
        grid_bodies.values[storage_index] = grid_body;
        temporaries.values[body_id].grid_index = i32(storage_index);
        return;
    }

    let padding = vec2f(body.radius + max(params.maximum_body_radius, 0.0));
    let max_cell = vec2i(params.grid_cell_count) - vec2i(1);
    let min_covered = clamp(
        vec2i(floor((predicted - padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    let max_covered = clamp(
        vec2i(floor((predicted + padding) / params.grid_cell_size)),
        vec2i(0),
        max_cell
    );
    for (var y = min_covered.y; y <= max_covered.y; y += 1) {
        for (var x = min_covered.x; x <= max_covered.x; x += 1) {
            let cell_index = (u32(y) * params.grid_cell_count.x) + u32(x);
            let counter_index = (cell_index * 2u) + 1u;
            let slot = atomicAdd(&grid_counts.values[counter_index], 1u);
            if (slot >= max_per_cell) {
                atomicAdd(&grid_overflow.big_count, 1u);
                atomicAdd(&grid_overflow.total_big_count, 1u);
                continue;
            }
            grid_bodies.values[(counter_index * max_per_cell) + slot] = grid_body;
        }
    }
}

struct ContactSelection {
    found: u32,
    distance_squared: f32,
    contact: Contact,
}

fn empty_contact_selection() -> ContactSelection {
    return ContactSelection(
        0u,
        0.0,
        Contact(0u, 0u, -1, 0u, vec2f(0.0), vec2f(0.0))
    );
}

fn contact_handler_has_flag(flags: u32, flag: u32) -> bool {
    return (flags & flag) == flag;
}

fn append_contact(contact: Contact) {
    let contact_index = atomicAdd(&contact_state.contact_count, 1u);
    if (contact_index >= params.max_contacts) {
        atomicAdd(&contact_state.contact_overflow, 1u);
        return;
    }
    contacts.values[contact_index] = contact;
}

fn consider_body_contact(
    self_body: GridBody,
    other_body: GridBody,
    closest_only: bool,
    selection: ContactSelection
) -> ContactSelection {
    if (self_body.body_id == other_body.body_id
        || !body_is_alive(other_body.simulation_meta)) {
        return selection;
    }
    let sensor_mask = body_sensor_mask(self_body.physics_meta);
    let self_layer = body_layer(self_body.physics_meta);
    let other_layer = body_layer(other_body.physics_meta);
    if ((sensor_mask & other_layer) == 0u
        || (body_collision_mask(other_body.physics_meta) & self_layer) == 0u) {
        return selection;
    }

    let delta = other_body.predicted_position - self_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = self_body.radius + other_body.radius;
    let minimum_distance_squared = minimum_distance * minimum_distance;
    if (distance_squared >= minimum_distance_squared) {
        return selection;
    }

    let previous_delta = temporaries.values[other_body.body_id].previous_position
        - temporaries.values[self_body.body_id].previous_position;
    if (dot(previous_delta, previous_delta) < minimum_distance_squared) {
        return selection;
    }

    var normal = -deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let contact = Contact(
        self_body.body_id,
        simulations.values[self_body.body_id].incarnation,
        i32(other_body.body_id),
        simulations.values[other_body.body_id].incarnation,
        self_body.predicted_position + normal * (distance - other_body.radius),
        normal
    );
    if (!closest_only) {
        append_contact(contact);
        return selection;
    }
    if (selection.found == 0u
        || distance_squared < selection.distance_squared
        || (distance_squared == selection.distance_squared
            && other_body.body_id < u32(selection.contact.other_body_id))) {
        return ContactSelection(1u, distance_squared, contact);
    }
    return selection;
}

fn scan_contact_bucket(
    self_body: GridBody,
    bucket_offset: u32,
    bucket_count: u32,
    closest_only: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    for (var index = 0u; index < bucket_count; index += 1u) {
        result = consider_body_contact(
            self_body,
            grid_bodies.values[bucket_offset + index],
            closest_only,
            result
        );
    }
    return result;
}

fn scan_canonical_big_contact_bucket(
    self_body: GridBody,
    cell_index: u32,
    closest_only: bool,
    selection: ContactSelection
) -> ContactSelection {
    var result = selection;
    let count = min(
        atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
        params.max_bodies_per_cell
    );
    let offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < count; index += 1u) {
        let other_body = grid_bodies.values[offset + index];
        let center_cell = vec2i(floor(
            other_body.predicted_position / params.grid_cell_size
        ));
        if (center_cell.x < 0 || center_cell.y < 0
            || center_cell.x >= i32(params.grid_cell_count.x)
            || center_cell.y >= i32(params.grid_cell_count.y)) {
            continue;
        }
        let center_cell_index = u32(center_cell.y) * params.grid_cell_count.x
            + u32(center_cell.x);
        if (center_cell_index != cell_index) {
            continue;
        }
        result = consider_body_contact(
            self_body,
            other_body,
            closest_only,
            result
        );
    }
    return result;
}

@compute @workgroup_size(1)
fn clear_contact_state() {
    atomicStore(&contact_state.contact_count, 0u);
    atomicStore(&contact_state.contact_overflow, 0u);
    atomicStore(&contact_state.event_count, 0u);
    atomicStore(&contact_state.event_overflow, 0u);
    atomicStore(&contact_state.death_count, 0u);
    atomicStore(&contact_state.death_overflow, 0u);
    atomicStore(&contact_state.reserved_0, 0u);
    atomicStore(&contact_state.reserved_1, 0u);
}

@compute @workgroup_size(256)
fn generate_body_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    let self_body_id = global_id.x;
    if (self_body_id >= counts.body_count || !body_id_is_alive(self_body_id)) {
        return;
    }
    let self_physics = physics.values[self_body_id];
    if (self_physics.radius <= 0.0
        || body_sensor_mask(self_physics.physics_meta) == 0u) {
        return;
    }
    let predicted = temporaries.values[self_body_id].predicted_position;
    let self_body = make_grid_body(self_body_id, predicted);
    let closest_only = contact_handler_has_flag(
        contact_handlers.values[self_body_id].flags,
        CONTACT_HANDLER_FLAG_CLOSEST_ONLY
    );
    var selection = empty_contact_selection();

    if (body_uses_small_grid(self_physics.radius)) {
        let center = vec2i(floor(predicted / params.grid_cell_size));
        if (center.x < 0 || center.y < 0
            || center.x >= i32(params.grid_cell_count.x)
            || center.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        for (var neighbor_index = 0u; neighbor_index < 9u; neighbor_index += 1u) {
            let neighbor = center + NEIGHBOR_OFFSETS[neighbor_index];
            if (neighbor.x < 0 || neighbor.y < 0
                || neighbor.x >= i32(params.grid_cell_count.x)
                || neighbor.y >= i32(params.grid_cell_count.y)) {
                continue;
            }
            let cell_index = u32(neighbor.y) * params.grid_cell_count.x
                + u32(neighbor.x);
            let count = min(
                atomicLoad(&grid_counts.values[cell_index * 2u]),
                params.max_bodies_per_cell
            );
            selection = scan_contact_bucket(
                self_body,
                grid_bucket_offset(cell_index, 0u),
                count,
                closest_only,
                selection
            );
        }
        let center_index = u32(center.y) * params.grid_cell_count.x + u32(center.x);
        let big_count = min(
            atomicLoad(&grid_counts.values[(center_index * 2u) + 1u]),
            params.max_bodies_per_cell
        );
        selection = scan_contact_bucket(
            self_body,
            grid_bucket_offset(center_index, 1u),
            big_count,
            closest_only,
            selection
        );
    } else {
        let interaction_radius = self_physics.radius
            + max(params.maximum_body_radius, 0.0);
        let raw_min = vec2i(floor(
            (predicted - vec2f(interaction_radius)) / params.grid_cell_size
        ));
        let raw_max = vec2i(floor(
            (predicted + vec2f(interaction_radius)) / params.grid_cell_size
        ));
        if (raw_max.x < 0 || raw_max.y < 0
            || raw_min.x >= i32(params.grid_cell_count.x)
            || raw_min.y >= i32(params.grid_cell_count.y)) {
            return;
        }
        let maximum_cell = vec2i(params.grid_cell_count) - vec2i(1);
        let minimum_covered = clamp(raw_min, vec2i(0), maximum_cell);
        let maximum_covered = clamp(raw_max, vec2i(0), maximum_cell);
        for (var y = minimum_covered.y; y <= maximum_covered.y; y += 1) {
            for (var x = minimum_covered.x; x <= maximum_covered.x; x += 1) {
                let cell_index = u32(y) * params.grid_cell_count.x + u32(x);
                let small_count = min(
                    atomicLoad(&grid_counts.values[cell_index * 2u]),
                    params.max_bodies_per_cell
                );
                selection = scan_contact_bucket(
                    self_body,
                    grid_bucket_offset(cell_index, 0u),
                    small_count,
                    closest_only,
                    selection
                );
                selection = scan_canonical_big_contact_bucket(
                    self_body,
                    cell_index,
                    closest_only,
                    selection
                );
            }
        }
    }
    if (closest_only && selection.found != 0u) {
        append_contact(selection.contact);
    }
}

fn sdf_value_at(texel: vec2i) -> f32 {
    let clamped = clamp(texel, vec2i(0), vec2i(params.sdf_size) - vec2i(1));
    let index = (u32(clamped.y) * params.sdf_size.x) + u32(clamped.x);
    return sdf_values.values[index];
}

fn sample_terrain_sdf(world_position: vec2f) -> f32 {
    let uv = world_position / params.world_size;
    let coordinate = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(params.sdf_size)
        - vec2f(0.5);
    let base = vec2i(floor(coordinate));
    let fraction = fract(coordinate);
    let top = mix(sdf_value_at(base), sdf_value_at(base + vec2i(1, 0)), fraction.x);
    let bottom = mix(
        sdf_value_at(base + vec2i(0, 1)),
        sdf_value_at(base + vec2i(1, 1)),
        fraction.x
    );
    return mix(top, bottom, fraction.y);
}

fn world_boundary_sdf(world_position: vec2f) -> f32 {
    let half_size = params.world_size * 0.5;
    let box_delta = abs(world_position - half_size) - half_size;
    let outside_distance = length(max(box_delta, vec2f(0.0)));
    let inside_distance = min(max(box_delta.x, box_delta.y), 0.0);
    return -(outside_distance + inside_distance);
}

fn sample_world_sdf(world_position: vec2f) -> f32 {
    return min(
        sample_terrain_sdf(world_position),
        world_boundary_sdf(world_position)
    );
}

fn world_contact_normal(body_id: u32, predicted: vec2f) -> vec2f {
    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    var normal = vec2f(
        sample_world_sdf(predicted + vec2f(gradient_step, 0.0))
            - sample_world_sdf(predicted - vec2f(gradient_step, 0.0)),
        sample_world_sdf(predicted + vec2f(0.0, gradient_step))
            - sample_world_sdf(predicted - vec2f(0.0, gradient_step))
    );
    let normal_length = length(normal);
    if (normal_length >= EPSILON_MASS) {
        return normal / normal_length;
    }
    let center_delta = (params.world_size * 0.5) - predicted;
    let center_distance = length(center_delta);
    if (center_distance >= EPSILON_MASS) {
        return center_delta / center_distance;
    }
    let entity_id = simulations.values[body_id].entity_id;
    return select(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), (entity_id & 1u) == 0u);
}

@compute @workgroup_size(256)
fn generate_world_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || params.sdf_enabled == 0u
        || !body_id_is_alive(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    if ((body_sensor_mask(body.physics_meta) & BODY_LAYER_TERRAIN) == 0u) {
        return;
    }
    let predicted = temporaries.values[body_id].predicted_position;
    let previous = temporaries.values[body_id].previous_position;
    let penetration = body.radius - sample_world_sdf(predicted);
    let previous_penetration = body.radius - sample_world_sdf(previous);
    if (penetration <= 0.0 || previous_penetration > 0.0) {
        return;
    }
    let normal = world_contact_normal(body_id, predicted);
    append_contact(Contact(
        body_id,
        simulations.values[body_id].incarnation,
        -1,
        0u,
        predicted + normal * penetration,
        normal
    ));
}

struct DamageResult {
    applied: i32,
    target_died: u32,
}

fn reserve_self_hit_budget(body_id: u32, amount: i32) -> bool {
    if (amount <= 0) {
        return true;
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before < amount) {
            return false;
        }
        let reservation = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_before - amount
        );
        if (reservation.exchanged) {
            return true;
        }
    }
}

fn apply_target_damage(body_id: u32, amount: i32) -> DamageResult {
    if (amount <= 0) {
        return DamageResult(0, 0u);
    }
    loop {
        let health_before = atomicLoad(&simulations.values[body_id].health);
        if (health_before <= 0) {
            return DamageResult(0, 1u);
        }
        let health_after = health_before - amount;
        let exchange = atomicCompareExchangeWeak(
            &simulations.values[body_id].health,
            health_before,
            health_after
        );
        if (exchange.exchanged) {
            return DamageResult(
                min(health_before, amount),
                select(0u, 1u, health_after <= 0)
            );
        }
    }
}

fn clear_alive_once(body_id: u32) -> bool {
    let alive_bit = BODY_FLAG_ALIVE << 8u;
    let previous_meta = atomicAnd(
        &simulations.values[body_id].simulation_meta,
        ~alive_bit
    );
    return (previous_meta & alive_bit) != 0u;
}

fn append_applied_event(event: AppliedEvent) {
    let event_index = atomicAdd(&contact_state.event_count, 1u);
    if (event_index >= params.max_events) {
        atomicAdd(&contact_state.event_overflow, 1u);
        return;
    }
    applied_events.values[event_index] = event;
}

fn append_death_event(body_id: u32, reason_flags: u32) {
    let death_index = atomicAdd(&contact_state.death_count, 1u);
    if (death_index >= params.max_death_events) {
        atomicAdd(&contact_state.death_overflow, 1u);
        return;
    }
    death_events.values[death_index] = DeathEvent(
        simulations.values[body_id].entity_id,
        simulations.values[body_id].incarnation,
        body_id,
        reason_flags
    );
}

@compute @workgroup_size(256)
fn handle_contacts(@builtin(global_invocation_id) global_id: vec3u) {
    if (atomicLoad(&contact_state.contact_overflow) != 0u) {
        return;
    }
    let contact_index = global_id.x;
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        params.max_contacts
    );
    if (contact_index >= contact_count) {
        return;
    }
    let contact = contacts.values[contact_index];
    let self_body_id = contact.self_body_id;
    if (self_body_id >= counts.body_count
        || simulations.values[self_body_id].incarnation != contact.self_incarnation
        || !body_id_is_alive(self_body_id)) {
        return;
    }
    let handler = contact_handlers.values[self_body_id];

    if (contact.other_body_id < 0) {
        if (contact.other_body_id == -1
            && contact_handler_has_flag(
                handler.flags,
                CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN
            )
            && clear_alive_once(self_body_id)) {
            append_applied_event(AppliedEvent(
                simulations.values[self_body_id].entity_id,
                contact.self_incarnation,
                0u,
                0u,
                0,
                APPLIED_EVENT_FLAG_TERRAIN_KILL,
                contact.world_position
            ));
            append_death_event(self_body_id, DEATH_EVENT_FLAG_HEALTH);
        }
        return;
    }

    let other_body_id = u32(contact.other_body_id);
    let damage_self = max(i32(handler.damage_self * 100.0), 0);
    var damage_other_value = handler.damage_other;
    if (handler.damage_falloff > 0.0) {
        let self_radius = physics.values[self_body_id].radius;
        if (self_radius > EPSILON_MASS) {
            let distance_from_self = length(
                contact.world_position - physics.values[self_body_id].position
            );
            let falloff_t = clamp(distance_from_self / self_radius, 0.0, 1.0);
            damage_other_value *= 1.0 - pow(falloff_t, handler.damage_falloff);
        }
    }
    let damage_other = max(i32(damage_other_value * 100.0), 0);
    if (other_body_id >= counts.body_count
        || other_body_id == self_body_id
        || simulations.values[other_body_id].incarnation != contact.other_incarnation
        || !body_id_is_alive(other_body_id)
        || damage_other <= 0) {
        return;
    }

    let self_budget_reserved = reserve_self_hit_budget(
        self_body_id,
        damage_self
    );
    if (!self_budget_reserved) {
        return;
    }
    let damage = apply_target_damage(other_body_id, damage_other);
    if (damage.applied <= 0) {
        if (damage_self > 0) {
            atomicAdd(&simulations.values[self_body_id].health, damage_self);
        }
        return;
    }

    let target_died_flag = select(
        0u,
        APPLIED_EVENT_FLAG_TARGET_DIED,
        damage.target_died != 0u
    );
    append_applied_event(AppliedEvent(
        simulations.values[self_body_id].entity_id,
        contact.self_incarnation,
        simulations.values[other_body_id].entity_id,
        contact.other_incarnation,
        damage.applied,
        target_died_flag,
        contact.world_position
    ));
}

@compute @workgroup_size(256)
fn mark_dead(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count || !body_id_is_alive(body_id)) {
        return;
    }
    var reason_flags = 0u;
    if (atomicLoad(&simulations.values[body_id].health) <= 0) {
        reason_flags |= DEATH_EVENT_FLAG_HEALTH;
    }
    let lifetime = simulations.values[body_id].lifetime;
    if (lifetime >= 0.0 && lifetime <= 0.0) {
        reason_flags |= DEATH_EVENT_FLAG_LIFETIME;
    }
    if (reason_flags == 0u || !clear_alive_once(body_id)) {
        return;
    }
    append_death_event(body_id, reason_flags);
}

@compute @workgroup_size(256)
fn clear_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id < counts.body_count) {
        temporaries.values[body_id].position_delta = vec2f(0.0);
    }
}

fn pair_correction(self_body: GridBody, other_body: GridBody, alpha: f32, big_pair: bool) -> vec2f {
    if (self_body.body_id == other_body.body_id) {
        return vec2f(0.0);
    }
    if (!body_is_alive(other_body.simulation_meta)) {
        return vec2f(0.0);
    }
    // Sensor bodies share the broad-phase grid for gameplay contacts, but never
    // contribute a physical position correction to either side of the pair.
    if (body_sensor_mask(self_body.physics_meta) != 0u
        || body_sensor_mask(other_body.physics_meta) != 0u) {
        return vec2f(0.0);
    }
    if ((body_collision_mask(self_body.physics_meta) & body_layer(other_body.physics_meta)) == 0u) {
        return vec2f(0.0);
    }

    let delta = self_body.predicted_position - other_body.predicted_position;
    let distance_squared = dot(delta, delta);
    let minimum_distance = self_body.radius + other_body.radius;
    if (distance_squared >= minimum_distance * minimum_distance) {
        return vec2f(0.0);
    }

    var normal = deterministic_separation_normal(
        self_body.body_id,
        other_body.body_id
    );
    var distance = 0.0;
    if (distance_squared > EPSILON_DISTANCE_SQUARED) {
        let inverse_distance = inverseSqrt(distance_squared);
        normal = delta * inverse_distance;
        distance = distance_squared * inverse_distance;
    }
    let penetration = minimum_distance - distance;
    let inverse_mass_sum = self_body.inverse_mass + other_body.inverse_mass;
    if (inverse_mass_sum <= EPSILON_MASS) {
        return vec2f(0.0);
    }
    let delta_lambda = penetration / (inverse_mass_sum + alpha);
    return normal * delta_lambda * self_body.inverse_mass;
}

@compute @workgroup_size(64)
fn solve_body_body(
    @builtin(local_invocation_id) local_id: vec3u,
    @builtin(workgroup_id) workgroup_id: vec3u
) {
    let local = local_id.x;
    let cell_index = workgroup_id.x;
    if (cell_index >= grid_cell_total()) {
        return;
    }

    if (local < 9u) {
        let cell = vec2i(
            i32(cell_index % params.grid_cell_count.x),
            i32(cell_index / params.grid_cell_count.x)
        );
        let neighbor = cell + NEIGHBOR_OFFSETS[local];
        if (neighbor.x < 0 || neighbor.y < 0
            || neighbor.x >= i32(params.grid_cell_count.x)
            || neighbor.y >= i32(params.grid_cell_count.y)) {
            neighbor_cell_counts[local] = 0u;
            neighbor_cell_indices[local] = 0u;
        } else {
            let neighbor_index = (u32(neighbor.y) * params.grid_cell_count.x) + u32(neighbor.x);
            neighbor_cell_counts[local] = min(
                atomicLoad(&grid_counts.values[neighbor_index * 2u]),
                params.max_bodies_per_cell
            );
            neighbor_cell_indices[local] = neighbor_index;
        }
        if (local == 4u) {
            current_cell_count = neighbor_cell_counts[local];
            current_big_count = min(
                atomicLoad(&grid_counts.values[(cell_index * 2u) + 1u]),
                params.max_bodies_per_cell
            );
        }
    }
    workgroupBarrier();

    if (local >= current_cell_count) {
        return;
    }
    let self_index = grid_bucket_offset(cell_index, 0u) + local;
    let self_body = grid_bodies.values[self_index];
    let collision_mask = body_collision_mask(self_body.physics_meta);
    if (self_body.inverse_mass <= EPSILON_MASS
        || self_body.radius <= 0.0
        || collision_mask == 0u
        || !body_is_alive(self_body.simulation_meta)) {
        return;
    }

    let soft_border = 8.0 * params.source_world_unit_scale;
    let distance_x = min(
        self_body.predicted_position.x,
        params.world_size.x - self_body.predicted_position.x
    );
    let distance_y = min(
        self_body.predicted_position.y,
        params.world_size.y - self_body.predicted_position.y
    );
    let border_factor = max(
        1.0 - smoothstep(0.0, soft_border, distance_x),
        1.0 - smoothstep(0.0, soft_border, distance_y)
    );
    let compliance = mix(0.000001, 0.001, border_factor);
    let alpha = compliance
        / (params.dt * params.dt * f32(max(params.solver_iterations, 1u)));
    var accumulated_delta = vec2f(0.0);

    for (var neighbor_slot = 0u; neighbor_slot < 9u; neighbor_slot += 1u) {
        let neighbor_index = neighbor_cell_indices[neighbor_slot];
        let neighbor_count = neighbor_cell_counts[neighbor_slot];
        let neighbor_offset = grid_bucket_offset(neighbor_index, 0u);
        for (var index = 0u; index < neighbor_count; index += 1u) {
            accumulated_delta += pair_correction(
                self_body,
                grid_bodies.values[neighbor_offset + index],
                alpha,
                false
            );
        }
    }

    let big_offset = grid_bucket_offset(cell_index, 1u);
    for (var index = 0u; index < current_big_count; index += 1u) {
        accumulated_delta += pair_correction(
            self_body,
            grid_bodies.values[big_offset + index],
            alpha,
            true
        );
    }
    temporaries.values[self_body.body_id].position_delta += accumulated_delta;
}

@compute @workgroup_size(256)
fn solve_body_world(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || params.sdf_enabled == 0u
        || !body_id_is_alive(body_id)) {
        return;
    }
    let body = physics.values[body_id];
    if ((body_collision_mask(body.physics_meta) & BODY_LAYER_TERRAIN) == 0u
        || body.inverse_mass <= EPSILON_MASS) {
        return;
    }

    let predicted = temporaries.values[body_id].predicted_position;
    let distance = sample_world_sdf(predicted);
    let penetration = body.radius - distance;
    if (penetration <= 0.0) {
        return;
    }

    let gradient_step = max(params.source_world_unit_scale, 0.0001);
    let gradient_uv_epsilon = vec2f(gradient_step) / params.world_size;
    var normal = vec2f(
        sample_world_sdf(predicted + vec2f(gradient_step, 0.0))
            - sample_world_sdf(predicted - vec2f(gradient_step, 0.0)),
        sample_world_sdf(predicted + vec2f(0.0, gradient_step))
            - sample_world_sdf(predicted - vec2f(0.0, gradient_step))
    ) / (gradient_uv_epsilon * 2.0);
    let normal_length = length(normal);
    if (normal_length < EPSILON_MASS) {
        let center_delta = (params.world_size * 0.5) - predicted;
        let center_distance = length(center_delta);
        normal = select(
            vec2f(1.0, 0.0),
            center_delta / center_distance,
            center_distance >= EPSILON_MASS
        );
    } else {
        normal /= normal_length;
    }
    temporaries.values[body_id].position_delta += normal * min(penetration, body.radius);
}

@compute @workgroup_size(256)
fn apply_position_deltas(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_alive(body_id)) {
        return;
    }
    temporaries.values[body_id].predicted_position += temporaries.values[body_id].position_delta;
    let grid_index = temporaries.values[body_id].grid_index;
    if (grid_index >= 0) {
        grid_bodies.values[u32(grid_index)].predicted_position
            = temporaries.values[body_id].predicted_position;
    }
}

fn is_inside_world(position: vec2f) -> bool {
    return position.x >= 0.0 && position.x < params.world_size.x
        && position.y >= 0.0 && position.y < params.world_size.y;
}

@compute @workgroup_size(256)
fn rebuild_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count) {
        return;
    }
    if (!body_id_is_alive(body_id)) {
        return;
    }
    if (grid_has_overflow()) {
        temporaries.values[body_id].predicted_position
            = temporaries.values[body_id].previous_position;
        temporaries.values[body_id].position_delta = vec2f(0.0);
        physics.values[body_id].position = temporaries.values[body_id].previous_position;
        simulations.values[body_id].flow_field_index
            = temporaries.values[body_id].previous_flow_field_index;
        return;
    }
    var predicted = temporaries.values[body_id].predicted_position;
    var previous = temporaries.values[body_id].previous_position;
    if (!is_inside_world(predicted)
        && (body_layer(physics.values[body_id].physics_meta) & BODY_LAYER_ENEMY) != 0u
        && is_inside_world(previous)) {
        let clamp_margin = 0.1 * params.source_world_unit_scale;
        predicted = clamp(predicted, vec2f(0.0), params.world_size - vec2f(clamp_margin));
        previous = predicted;
    }
    physics.values[body_id].position = predicted;
    physics.values[body_id].velocity = (predicted - previous) * params.inverse_dt;
}

@compute @workgroup_size(256)
fn finalize_velocities(@builtin(global_invocation_id) global_id: vec3u) {
    let body_id = global_id.x;
    if (body_id >= counts.body_count
        || grid_has_overflow()
        || !body_id_is_alive(body_id)) {
        return;
    }
    var velocity = physics.values[body_id].velocity
        * clamp(1.0 - (params.velocity_damping * params.dt), 0.0, 1.0);
    let speed_squared = dot(velocity, velocity);
    if (params.max_speed > 0.0 && speed_squared > params.max_speed * params.max_speed) {
        velocity = normalize(velocity) * params.max_speed;
    }
    physics.values[body_id].velocity = velocity;
}
`;

export const GPU_COLLISION_INDIRECT_WGSL = /* wgsl */`
struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    reserved: u32,
}

struct DispatchArgs {
    x: u32,
    y: u32,
    z: u32,
}

struct DrawArgs {
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> dispatch_args: DispatchArgs;
@group(0) @binding(2) var<storage, read_write> draw_args: DrawArgs;

@compute @workgroup_size(1)
fn update_indirect_args() {
    dispatch_args.x = (counts.body_count + 255u) / 256u;
    dispatch_args.y = 1u;
    dispatch_args.z = 1u;
    draw_args.vertex_count = 6u;
    draw_args.instance_count = counts.body_count;
    draw_args.first_vertex = 0u;
    draw_args.first_instance = 0u;
}
`;

export const GPU_COLLISION_RENDER_WGSL = /* wgsl */`
struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    reserved: u32,
}

struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physics_meta: u32,
    reserved: u32,
}

struct BodySimulation {
    lifetime: f32,
    health: i32,
    timer: u32,
    simulation_meta: u32,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct BodyTemporary {
    previous_position: vec2f,
    predicted_position: vec2f,
    position_delta: vec2f,
    grid_index: i32,
    previous_flow_field_index: u32,
}

struct BodyRenderStyle {
    color: vec4f,
    radius_scale: f32,
    visible: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct RenderStyleBuffer { values: array<BodyRenderStyle> }
struct SimulationBuffer { values: array<BodySimulation> }

struct RenderParams {
    viewport_origin: vec2f,
    viewport_size: vec2f,
    world_scale: f32,
    prediction_dt: f32,
    interpolation_alpha: f32,
    presentation_mode: u32,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) local_position: vec2f,
    @location(1) color: vec4f,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read> temporaries: TemporaryBuffer;
@group(0) @binding(3) var<storage, read> styles: RenderStyleBuffer;
@group(0) @binding(4) var<storage, read> simulations: SimulationBuffer;
@group(1) @binding(0) var<uniform> params: RenderParams;

const QUAD_VERTICES = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
);

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var output: VertexOutput;
    let simulation_flags = (simulations.values[instance_index].simulation_meta >> 8u) & 255u;
    if ((simulation_flags & 1u) == 0u) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        return output;
    }
    let body = physics.values[instance_index];
    let temporary = temporaries.values[instance_index];
    let style = styles.values[instance_index];
    var body_position = mix(
        temporary.previous_position,
        body.position,
        clamp(params.interpolation_alpha, 0.0, 1.0)
    );
    if (params.presentation_mode == 1u) {
        body_position = body.position + (body.velocity * max(params.prediction_dt, 0.0));
    }

    let local = QUAD_VERTICES[vertex_index];
    let world_position = body_position + (local * body.radius * style.radius_scale);
    let viewport_position = params.viewport_origin + (world_position * params.world_scale);
    let clip_position = vec2f(
        (viewport_position.x / params.viewport_size.x) * 2.0 - 1.0,
        1.0 - (viewport_position.y / params.viewport_size.y) * 2.0
    );
    output.position = vec4f(clip_position, 0.0, 1.0);
    output.local_position = local;
    output.color = style.color * f32(style.visible != 0u);
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let distance = length(input.local_position);
    let coverage = 1.0 - smoothstep(0.94, 1.0, distance);
    let alpha = input.color.a * coverage;
    return vec4f(input.color.rgb * alpha, alpha);
}
`;
