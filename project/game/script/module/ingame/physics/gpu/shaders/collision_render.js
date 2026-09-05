import {
    GPU_CIRCLE_BODY_ABI_VERSION,
    GPU_CIRCLE_BODY_LAYER,
    GPU_CIRCLE_BODY_GAMEPLAY_META,
    GPU_CIRCLE_BODY_RENDER_SHAPE,
    GPU_CIRCLE_BODY_SIMULATION_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG,
    GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM,
    GPU_CIRCLE_ENEMY_BEHAVIOR_STATE,
    GPU_PROJECTILE_CAPTURE_ROLE,
    GPU_PROJECTILE_CAPTURE_STATE_META
} from '../gpu_circle_body_abi.js';
import {
    GAMEPLAY_TEAM_ID
} from '../../../contract/gameplay_team_contract.js';
import {
    GPU_FORMATION_BODY_STATE_FLAG
} from '../gpu_formation_runtime_abi.js';
import {
    ENEMY_NORMALIZED_RENDER_GEOMETRY
} from '../../../../../data/object/enemy/enemy_shape_geometry_data.js';
import {
    GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE
} from '../../../../../data/object/enemy/enemy_projectile_capture_catalog_data.js';
import {
    PURPLE_CRYSTAL_MAP_VISUAL_THEME
} from '../../../../../data/scene/game/purple_crystal_map_visual_theme_data.js';
import { WGSL_POLYGON_POINT_CAPACITY, toWgslFloat, toWgslVec2, toWgslPointArray } from './collision_wgsl_values.js';

const ENEMY_RENDER_GEOMETRY = ENEMY_NORMALIZED_RENDER_GEOMETRY;
const ENTITY_GLOW_THEME = PURPLE_CRYSTAL_MAP_VISUAL_THEME.entityGlow;

export const GPU_COLLISION_RENDER_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;

struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    abi_version: u32,
}

struct BodyPhysics {
    position: vec2f,
    velocity: vec2f,
    radius: f32,
    inverse_mass: f32,
    physical_meta: u32,
    interaction_meta: u32,
}

struct BodySimulation {
    lifetime: f32,
    health: i32,
    gameplay_meta: u32,
    flags: u32,
    flow_field_index: u32,
    flow_speed: f32,
    entity_id: u32,
    incarnation: u32,
}

struct EnemyBehaviorState {
    program_id: u32,
    state: u32,
    state_entered_fixed_tick: u32,
    state_expires_at_fixed_tick: u32,
    target_slot: u32,
    target_entity_id: u32,
    target_incarnation: u32,
    flags: u32,
    charge_direction: vec2f,
    windup_range: f32,
    charge_speed: f32,
    impact_restitution: f32,
    windup_ticks: u32,
    charge_max_ticks: u32,
    recoil_ticks: u32,
    recover_ticks: u32,
    telegraph_style_code: u32,
    telegraph_color_rgba8: u32,
    telegraph_radius_scale: f32,
    deprecated_charge_acceleration: f32,
    impact_tangential_retention: f32,
    recoil_damping: f32,
    recoil_sleep_threshold: f32,
}

struct EffectSummary {
    entity_id: u32,
    incarnation: u32,
    max_health_fixed_point: i32,
    authored_damage_other: f32,
    resolved_base_damage_other: f32,
    active_family_mask: u32,
    boost_stack_count: u32,
    regen_per_tick_fixed_point: i32,
    attack_multiplier: f32,
    move_speed_multiplier: f32,
    presentation_tags: u32,
    presentation_magnitude: f32,
    last_pulse_tick: u32,
    pulse_style_code: u32,
    summary_tick: u32,
    source_snapshot_tick: u32,
    damage_taken_multiplier: f32,
    reserved_0: u32,
    reserved_1: u32,
    flags: u32,
}

struct FormationState {
    entity_id: u32,
    incarnation: u32,
    definition_code: u32,
    coordinate_system_code: u32,
    policy_code: u32,
    member_count: u32,
    occupied_slot_mask: u32,
    rotation_step: u32,
    generation: u32,
    flags: u32,
    lineage_hash: u32,
    route_first_field_index: u32,
    route_field_count: u32,
    last_merge_tick: u32,
    presentation_flags: u32,
    presentation_tick: u32,
    partner_entity_id: u32,
    partner_incarnation: u32,
    reserved_0: u32,
    reserved_1: u32,
}

struct ProjectileCaptureState {
    role_phase_profile_policy: u32,
    self_entity_id: u32,
    self_incarnation: u32,
    peer_body_slot: u32,
    peer_entity_id: u32,
    peer_incarnation: u32,
    captured_at_fixed_tick: u32,
    release_due_fixed_tick: u32,
    capture_sequence: u32,
    captured_speed: f32,
    facing: vec2f,
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
    shape_code: u32,
    reserved_1: u32,
}

struct PhysicsBuffer { values: array<BodyPhysics> }
struct TemporaryBuffer { values: array<BodyTemporary> }
struct RenderStyleBuffer { values: array<BodyRenderStyle> }
struct SimulationBuffer { values: array<BodySimulation> }
struct EnemyBehaviorStateBuffer { values: array<EnemyBehaviorState> }
struct EffectSummaryBuffer { values: array<EffectSummary> }
struct FormationStateBuffer { values: array<FormationState> }
struct ProjectileCaptureStateBuffer { values: array<ProjectileCaptureState> }

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
    @location(2) @interpolate(flat) shape_code: u32,
    @location(3) velocity: vec2f,
    @location(4) @interpolate(flat) formation_member_count: u32,
    @location(5) @interpolate(flat) formation_occupied_mask: u32,
    @location(6) @interpolate(flat) formation_presentation_flags: u32,
    @location(7) @interpolate(flat) health_ratio: f32,
    @location(8) @interpolate(flat) directional_defense_active: u32,
    @location(9) @interpolate(flat) effect_presentation_tags: u32,
    @location(10) @interpolate(flat) glow_kind: u32,
    @location(11) @interpolate(flat) glow_intensity: f32,
    @location(12) @interpolate(flat) glow_rim_width: f32,
    @location(13) @interpolate(flat) glow_halo_width: f32,
    @location(14) @interpolate(flat) glow_quad_extent: f32,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read> physics: PhysicsBuffer;
@group(0) @binding(2) var<storage, read> temporaries: TemporaryBuffer;
@group(0) @binding(3) var<storage, read> styles: RenderStyleBuffer;
@group(0) @binding(4) var<storage, read> simulations: SimulationBuffer;
@group(0) @binding(5) var<storage, read> enemy_behavior_states: EnemyBehaviorStateBuffer;
@group(0) @binding(6) var<storage, read> effect_summaries: EffectSummaryBuffer;
@group(0) @binding(7) var<storage, read> formation_states: FormationStateBuffer;
@group(0) @binding(8) var<storage, read> projectile_capture_states: ProjectileCaptureStateBuffer;
@group(1) @binding(0) var<uniform> params: RenderParams;

const QUAD_VERTICES = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0)
);
const RENDER_SHAPE_CIRCLE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.CIRCLE}u;
const RENDER_SHAPE_SQUARE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.SQUARE}u;
const RENDER_SHAPE_TRIANGLE: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.TRIANGLE}u;
const RENDER_SHAPE_ARROW: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.ARROW}u;
const RENDER_SHAPE_PENTA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.PENTA}u;
const RENDER_SHAPE_HEXA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.HEXA}u;
const RENDER_SHAPE_GEN: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.GEN}u;
const RENDER_SHAPE_RHOM: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.RHOM}u;
const RENDER_SHAPE_OCTA: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.OCTA}u;
const RENDER_SHAPE_RING: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.RING}u;
const RENDER_SHAPE_JORANG: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.JORANG}u;
const RENDER_SHAPE_CORK: u32 = ${GPU_CIRCLE_BODY_RENDER_SHAPE.CORK}u;
const PROJECTILE_CAPTURE_ROLE_CAPTOR: u32 = ${GPU_PROJECTILE_CAPTURE_ROLE.CAPTOR}u;
const PROJECTILE_CAPTURE_ROLE_MASK: u32 = ${GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_MASK}u;
const PROJECTILE_CAPTURE_ROLE_SHIFT: u32 = ${GPU_PROJECTILE_CAPTURE_STATE_META.ROLE_SHIFT}u;
const PROJECTILE_CAPTURE_PROFILE_MASK: u32 = ${GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_MASK}u;
const PROJECTILE_CAPTURE_PROFILE_SHIFT: u32 = ${GPU_PROJECTILE_CAPTURE_STATE_META.PROFILE_SHIFT}u;
const PROJECTILE_CAPTURE_PROFILE_RING: u32 = ${GPU_ENEMY_PROJECTILE_CAPTURE_PROFILE_CODE.RING_SINGLE_SLOT}u;
const BODY_FLAG_PROJECTILE_CAPTURED: u32 = ${GPU_CIRCLE_BODY_SIMULATION_FLAG.PROJECTILE_CAPTURED}u;
const BODY_LAYER_ENEMY: u32 = ${GPU_CIRCLE_BODY_LAYER.ENEMY}u;
const BODY_LAYER_PROJECTILE: u32 = ${GPU_CIRCLE_BODY_LAYER.PROJECTILE}u;
const BODY_LAYER_PLAYER_DAMAGEABLE: u32 = ${GPU_CIRCLE_BODY_LAYER.PLAYER_DAMAGEABLE}u;
const GAMEPLAY_TEAM_PLAYER: u32 = ${GAMEPLAY_TEAM_ID.PLAYER}u;
const GAMEPLAY_META_TEAM_SHIFT: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_SHIFT}u;
const GAMEPLAY_META_TEAM_MASK: u32 = ${GPU_CIRCLE_BODY_GAMEPLAY_META.TEAM_MASK}u;
const ENTITY_GLOW_KIND_NONE: u32 = 0u;
const ENTITY_GLOW_KIND_ENEMY: u32 = 1u;
const ENTITY_GLOW_KIND_TOWER: u32 = 2u;
const ENTITY_GLOW_TOWER_INTENSITY: f32 = ${toWgslFloat(
    ENTITY_GLOW_THEME.towerIntensity
)};
const ENTITY_GLOW_ENEMY_INTENSITY: f32 = ${toWgslFloat(
    ENTITY_GLOW_THEME.enemyIntensity
)};
const ENTITY_GLOW_RIM_WIDTH_PIXELS: f32 = ${toWgslFloat(
    ENTITY_GLOW_THEME.rimWidthPixels
)};
const ENTITY_GLOW_HALO_WIDTH_PIXELS: f32 = ${toWgslFloat(
    ENTITY_GLOW_THEME.haloWidthPixels
)};
const ENTITY_GLOW_MINIMUM_PROJECTED_RADIUS: f32 = ${toWgslFloat(
    ENTITY_GLOW_THEME.minimumProjectedRadiusForHalo
)};
const ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.ARROW_TOWER_CHARGE}u;
const ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_PROGRAM.OCTAGON_TOWER_ORBIT}u;
const ENEMY_BEHAVIOR_STATE_WINDUP: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.WINDUP}u;
const ENEMY_BEHAVIOR_STATE_ORBIT_TOWER: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_STATE.ORBIT_TOWER}u;
const ENEMY_BEHAVIOR_FLAG_TARGET_VALID: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.TARGET_VALID}u;
const ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE: u32 = ${GPU_CIRCLE_ENEMY_BEHAVIOR_FLAG.DIRECTIONAL_DEFENSE_ACTIVE}u;
const EFFECT_PRESENTATION_TAG_BOOST: u32 = 1u;
const EFFECT_PRESENTATION_TAG_PULSE: u32 = 2u;
const FORMATION_FLAG_ACTIVE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.ACTIVE}u;
const FORMATION_FLAG_MERGE_PULSE: u32 = ${GPU_FORMATION_BODY_STATE_FLAG.PRESENTATION_MERGE_PULSE}u;
const FORMATION_OCCUPIED_MASK: u32 = 63u;
const FORMATION_HEX_CELL_RADIUS: f32 = 0.285;
const FORMATION_RING_RADIUS: f32 = 0.54;
const FORMATION_HEX_DIRECTIONS = array<vec2f, 6>(
    vec2f(1.0, 0.0),
    vec2f(0.5, -0.8660254037844386),
    vec2f(-0.5, -0.8660254037844386),
    vec2f(-1.0, 0.0),
    vec2f(-0.5, 0.8660254037844386),
    vec2f(0.5, 0.8660254037844386)
);
const SHAPE_DIRECTION_EPSILON: f32 = 0.000001;
const SQUARE_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.square.box.center)};
const SQUARE_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.square.box.halfSize)};
const TRIANGLE_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.triangle.points)};
const ARROW_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.arrow.points)};
const PENTA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.penta.points)};
const HEXA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.hexa.points)};
const RHOM_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.rhom.points)};
const OCTA_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.octa.points)};
const CORK_POINTS = ${toWgslPointArray(ENEMY_RENDER_GEOMETRY.cork.points)};
const RING_OUTER_RADIUS: f32 = ${toWgslFloat(
    ENEMY_RENDER_GEOMETRY.ring.outerRadius
)};
const RING_INNER_RADIUS: f32 = ${toWgslFloat(
    ENEMY_RENDER_GEOMETRY.ring.innerRadius
)};
const GENERATOR_OUTER_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.outerBox.center)};
const GENERATOR_OUTER_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.outerBox.halfSize)};
const GENERATOR_INNER_CENTER: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.innerBox.center)};
const GENERATOR_INNER_HALF_SIZE: vec2f = ${toWgslVec2(ENEMY_RENDER_GEOMETRY.gen.innerBox.halfSize)};
const GENERATOR_TERMINAL_CENTERS = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.gen.terminalBoxes.map(({ center }) => center),
    4
)};
const GENERATOR_TERMINAL_HALF_SIZES = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.gen.terminalBoxes.map(({ halfSize }) => halfSize),
    4
)};
const JORANG_LEFT_LOBE_POINTS = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.jorang.lobes[0]
)};
const JORANG_RIGHT_LOBE_POINTS = ${toWgslPointArray(
    ENEMY_RENDER_GEOMETRY.jorang.lobes[1]
)};
const JORANG_CONNECTOR_CENTER: vec2f = ${toWgslVec2(
    ENEMY_RENDER_GEOMETRY.jorang.connector.center
)};
const JORANG_CONNECTOR_HALF_SIZE: vec2f = ${toWgslVec2(
    ENEMY_RENDER_GEOMETRY.jorang.connector.halfSize
)};

fn directional_local_position(point: vec2f, velocity: vec2f) -> vec2f {
    var forward = vec2f(0.0, -1.0);
    let velocity_length_squared = dot(velocity, velocity);
    if (velocity_length_squared > SHAPE_DIRECTION_EPSILON) {
        forward = velocity * inverseSqrt(velocity_length_squared);
    }
    let right = vec2f(forward.y, -forward.x);
    return vec2f(dot(point, right), dot(point, forward));
}

fn box_distance(point: vec2f, center: vec2f, half_size: vec2f) -> f32 {
    let delta = abs(point - center) - half_size;
    return length(max(delta, vec2f(0.0))) + min(max(delta.x, delta.y), 0.0);
}

fn polygon_distance(
    point: vec2f,
    vertices: array<vec2f, ${WGSL_POLYGON_POINT_CAPACITY}>,
    vertex_count: u32
) -> f32 {
    var distance_squared = 3.402823466e+38;
    var inside = false;
    var previous_index = vertex_count - 1u;
    for (var index = 0u; index < vertex_count; index += 1u) {
        let current = vertices[index];
        let previous = vertices[previous_index];
        let edge = previous - current;
        let relative = point - current;
        let edge_length_squared = max(dot(edge, edge), 0.000000000001);
        let nearest = relative - edge * clamp(
            dot(relative, edge) / edge_length_squared,
            0.0,
            1.0
        );
        distance_squared = min(distance_squared, dot(nearest, nearest));

        let crosses_scanline = (current.y > point.y) != (previous.y > point.y);
        if (crosses_scanline) {
            let crossing_x = current.x
                + ((point.y - current.y) * (previous.x - current.x)
                    / (previous.y - current.y));
            if (point.x < crossing_x) {
                inside = !inside;
            }
        }
        previous_index = index;
    }
    let distance = sqrt(max(distance_squared, 0.0));
    return select(distance, -distance, inside);
}

fn arrow_distance(point: vec2f) -> f32 {
    return polygon_distance(point, ARROW_POINTS, 4u);
}

fn generator_distance(point: vec2f) -> f32 {
    let outer = box_distance(
        point,
        GENERATOR_OUTER_CENTER,
        GENERATOR_OUTER_HALF_SIZE
    );
    let inner = box_distance(
        point,
        GENERATOR_INNER_CENTER,
        GENERATOR_INNER_HALF_SIZE
    );
    var distance = max(outer, -inner);
    for (var index = 0u; index < 4u; index += 1u) {
        distance = min(distance, box_distance(
            point,
            GENERATOR_TERMINAL_CENTERS[index],
            GENERATOR_TERMINAL_HALF_SIZES[index]
        ));
    }
    return distance;
}

fn jorang_distance(point: vec2f) -> f32 {
    let left_lobe = polygon_distance(
        point,
        JORANG_LEFT_LOBE_POINTS,
        8u
    );
    let right_lobe = polygon_distance(
        point,
        JORANG_RIGHT_LOBE_POINTS,
        8u
    );
    let connector = box_distance(
        point,
        JORANG_CONNECTOR_CENTER,
        JORANG_CONNECTOR_HALF_SIZE
    );
    return min(min(left_lobe, right_lobe), connector);
}

fn shape_distance(point: vec2f, velocity: vec2f, shape_code: u32) -> f32 {
    if (shape_code == RENDER_SHAPE_SQUARE) {
        return box_distance(point, SQUARE_CENTER, SQUARE_HALF_SIZE);
    }
    if (shape_code == RENDER_SHAPE_TRIANGLE) {
        return polygon_distance(
            directional_local_position(point, velocity),
            TRIANGLE_POINTS,
            3u
        );
    }
    if (shape_code == RENDER_SHAPE_ARROW) {
        return arrow_distance(directional_local_position(point, velocity));
    }
    if (shape_code == RENDER_SHAPE_PENTA) {
        return polygon_distance(point, PENTA_POINTS, 5u);
    }
    if (shape_code == RENDER_SHAPE_HEXA) {
        return polygon_distance(point, HEXA_POINTS, 6u);
    }
    if (shape_code == RENDER_SHAPE_RHOM) {
        return polygon_distance(point, RHOM_POINTS, 4u);
    }
    if (shape_code == RENDER_SHAPE_OCTA) {
        return polygon_distance(
            directional_local_position(point, velocity),
            OCTA_POINTS,
            8u
        );
    }
    if (shape_code == RENDER_SHAPE_CORK) {
        return polygon_distance(point, CORK_POINTS, 4u);
    }
    if (shape_code == RENDER_SHAPE_GEN) {
        return generator_distance(point);
    }
    if (shape_code == RENDER_SHAPE_JORANG) {
        return jorang_distance(point);
    }
    if (shape_code == RENDER_SHAPE_RING) {
        let local = directional_local_position(point, velocity);
        let ring_distance = max(
            length(point) - RING_OUTER_RADIUS,
            RING_INNER_RADIUS - length(point)
        );
        // Data-owned PI/4 inclusive funnel을 presentation에서도 같은 전방 sector로 엽니다.
        if (local.y >= 0.0 && abs(local.x) <= local.y) {
            return max(ring_distance, min(local.y - abs(local.x), 1.0));
        }
        return ring_distance;
    }
    return length(point) - 1.0;
}

fn formation_cell_distance(point: vec2f, slot: u32) -> f32 {
    let center = FORMATION_HEX_DIRECTIONS[slot] * FORMATION_RING_RADIUS;
    return polygon_distance(
        (point - center) / FORMATION_HEX_CELL_RADIUS,
        HEXA_POINTS,
        6u
    ) * FORMATION_HEX_CELL_RADIUS;
}

fn formation_mask_distance(point: vec2f, mask: u32) -> f32 {
    var distance = 3.402823466e+38;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        if ((mask & (1u << slot)) != 0u) {
            distance = min(distance, formation_cell_distance(point, slot));
        }
    }
    return distance;
}

fn segment_distance(point: vec2f, start: vec2f, end: vec2f) -> f32 {
    let edge = end - start;
    let length_squared = max(dot(edge, edge), 0.000001);
    return length(point - (start + edge * clamp(
        dot(point - start, edge) / length_squared,
        0.0,
        1.0
    )));
}

fn formation_member_link_distance(point: vec2f, mask: u32) -> f32 {
    var distance = 3.402823466e+38;
    for (var slot = 0u; slot < 6u; slot += 1u) {
        let next = (slot + 1u) % 6u;
        if ((mask & (1u << slot)) != 0u
            && (mask & (1u << next)) != 0u) {
            distance = min(distance, segment_distance(
                point,
                FORMATION_HEX_DIRECTIONS[slot] * FORMATION_RING_RADIUS,
                FORMATION_HEX_DIRECTIONS[next] * FORMATION_RING_RADIUS
            ));
        }
    }
    return distance;
}

fn unpack_rgba8(packed: u32) -> vec4f {
    return vec4f(
        f32(packed & 255u),
        f32((packed >> 8u) & 255u),
        f32((packed >> 16u) & 255u),
        f32((packed >> 24u) & 255u)
    ) / 255.0;
}

fn render_f32_is_finite(value: f32) -> bool {
    return value == value && abs(value) <= 3.402823466e+38;
}

fn render_vec2_is_finite(value: vec2f) -> bool {
    return all(value == value)
        && all(abs(value) <= vec2f(3.402823466e+38));
}

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {
    var output: VertexOutput;
    if (counts.abi_version != BODY_ABI_VERSION) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        output.shape_code = RENDER_SHAPE_CIRCLE;
        output.velocity = vec2f(0.0);
        output.formation_member_count = 0u;
        output.formation_occupied_mask = 0u;
        output.formation_presentation_flags = 0u;
        output.health_ratio = 0.0;
        output.directional_defense_active = 0u;
        output.effect_presentation_tags = 0u;
        output.glow_kind = ENTITY_GLOW_KIND_NONE;
        output.glow_intensity = 0.0;
        output.glow_rim_width = 0.0;
        output.glow_halo_width = 0.0;
        output.glow_quad_extent = 1.0;
        return output;
    }
    let simulation_flags = simulations.values[instance_index].flags;
    if ((simulation_flags & 1u) == 0u
        || (simulation_flags & BODY_FLAG_PROJECTILE_CAPTURED) != 0u) {
        output.position = vec4f(2.0, 2.0, 0.0, 1.0);
        output.local_position = vec2f(0.0);
        output.color = vec4f(0.0);
        output.shape_code = RENDER_SHAPE_CIRCLE;
        output.velocity = vec2f(0.0);
        output.formation_member_count = 0u;
        output.formation_occupied_mask = 0u;
        output.formation_presentation_flags = 0u;
        output.health_ratio = 0.0;
        output.directional_defense_active = 0u;
        output.effect_presentation_tags = 0u;
        output.glow_kind = ENTITY_GLOW_KIND_NONE;
        output.glow_intensity = 0.0;
        output.glow_rim_width = 0.0;
        output.glow_halo_width = 0.0;
        output.glow_quad_extent = 1.0;
        return output;
    }
    let body = physics.values[instance_index];
    let temporary = temporaries.values[instance_index];
    let style = styles.values[instance_index];
    let behavior = enemy_behavior_states.values[instance_index];
    let effect_summary = effect_summaries.values[instance_index];
    let formation = formation_states.values[instance_index];
    let projectile_capture = projectile_capture_states.values[instance_index];
    var body_position = mix(
        temporary.previous_position,
        body.position,
        clamp(params.interpolation_alpha, 0.0, 1.0)
    );
    if (params.presentation_mode == 1u) {
        body_position = body.position + (body.velocity * max(params.prediction_dt, 0.0));
    }

    var presentation_velocity = body.velocity;
    var presentation_color = style.color;
    var presentation_radius_scale = style.radius_scale;
    let effect_identity_matches = effect_summary.entity_id
            == simulations.values[instance_index].entity_id
        && effect_summary.incarnation
            == simulations.values[instance_index].incarnation;
    let effect_presentation_tags = select(
        0u,
        effect_summary.presentation_tags,
        effect_identity_matches
    );
    if (effect_identity_matches
        && behavior.program_id != ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        && (effect_summary.presentation_tags & EFFECT_PRESENTATION_TAG_PULSE) != 0u) {
        presentation_radius_scale *= 1.0
            + (0.16 * clamp(effect_summary.presentation_magnitude, 0.0, 1.0));
    }
    if (behavior.program_id == ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE
        && behavior.state == ENEMY_BEHAVIOR_STATE_WINDUP) {
        if (behavior.telegraph_style_code != 0u) {
            presentation_color = unpack_rgba8(behavior.telegraph_color_rgba8);
        }
        if ((behavior.flags & ENEMY_BEHAVIOR_FLAG_TARGET_VALID) != 0u
            && behavior.target_slot < counts.body_count
            && simulations.values[behavior.target_slot].entity_id
                == behavior.target_entity_id
            && simulations.values[behavior.target_slot].incarnation
                == behavior.target_incarnation
            && (simulations.values[behavior.target_slot].flags & 1u) != 0u) {
            presentation_velocity = physics.values[behavior.target_slot].position
                - body.position;
        }
    }
    let directional_defense_active = behavior.program_id
            == ENEMY_BEHAVIOR_PROGRAM_OCTAGON_TOWER_ORBIT
        && behavior.state == ENEMY_BEHAVIOR_STATE_ORBIT_TOWER
        && (behavior.flags & ENEMY_BEHAVIOR_FLAG_DIRECTIONAL_DEFENSE_ACTIVE) != 0u;
    if (directional_defense_active) {
        // The same +32/+36 facing drives presentation and contact classification.
        presentation_velocity = behavior.charge_direction;
    }
    let projectile_capture_meta = projectile_capture.role_phase_profile_policy;
    let projectile_capture_role = (
        projectile_capture_meta & PROJECTILE_CAPTURE_ROLE_MASK
    ) >> PROJECTILE_CAPTURE_ROLE_SHIFT;
    let projectile_capture_profile = (
        projectile_capture_meta & PROJECTILE_CAPTURE_PROFILE_MASK
    ) >> PROJECTILE_CAPTURE_PROFILE_SHIFT;
    let projectile_capture_facing_length_squared = dot(
        projectile_capture.facing,
        projectile_capture.facing
    );
    if (style.shape_code == RENDER_SHAPE_RING
        && projectile_capture.self_entity_id
            == simulations.values[instance_index].entity_id
        && projectile_capture.self_incarnation
            == simulations.values[instance_index].incarnation
        && projectile_capture_role == PROJECTILE_CAPTURE_ROLE_CAPTOR
        && projectile_capture_profile == PROJECTILE_CAPTURE_PROFILE_RING
        && render_vec2_is_finite(projectile_capture.facing)
        && render_f32_is_finite(projectile_capture_facing_length_squared)
        && projectile_capture_facing_length_squared > 0.0) {
        presentation_velocity = projectile_capture.facing;
    }
    let interaction_layer = body.interaction_meta & 65535u;
    let gameplay_team = (
        simulations.values[instance_index].gameplay_meta
            >> GAMEPLAY_META_TEAM_SHIFT
    ) & GAMEPLAY_META_TEAM_MASK;
    var glow_kind = ENTITY_GLOW_KIND_NONE;
    var glow_intensity = 0.0;
    if ((interaction_layer & BODY_LAYER_ENEMY) != 0u) {
        glow_kind = ENTITY_GLOW_KIND_ENEMY;
        glow_intensity = ENTITY_GLOW_ENEMY_INTENSITY;
    }
    if ((interaction_layer & BODY_LAYER_PLAYER_DAMAGEABLE) != 0u
        && gameplay_team == GAMEPLAY_TEAM_PLAYER
        && (interaction_layer & BODY_LAYER_PROJECTILE) == 0u) {
        glow_kind = ENTITY_GLOW_KIND_TOWER;
        glow_intensity = ENTITY_GLOW_TOWER_INTENSITY;
    }
    let projected_radius = max(
        abs(body.radius * presentation_radius_scale * params.world_scale),
        0.0001
    );
    let glow_rim_width = select(
        0.0,
        min(ENTITY_GLOW_RIM_WIDTH_PIXELS / projected_radius, 0.24),
        glow_kind != ENTITY_GLOW_KIND_NONE
    );
    let glow_halo_width = select(
        0.0,
        min(ENTITY_GLOW_HALO_WIDTH_PIXELS / projected_radius, 0.6),
        glow_kind != ENTITY_GLOW_KIND_NONE
            && projected_radius >= ENTITY_GLOW_MINIMUM_PROJECTED_RADIUS
    );
    // Entity glow must not expand the authored analytic silhouette or its
    // collider circumcircle. The wider glow value is an inward color band.
    let glow_quad_extent = 1.0;
    let local = QUAD_VERTICES[vertex_index] * glow_quad_extent;
    let world_position = body_position
        + (local * body.radius * presentation_radius_scale);
    let viewport_position = params.viewport_origin + (world_position * params.world_scale);
    let clip_position = vec2f(
        (viewport_position.x / params.viewport_size.x) * 2.0 - 1.0,
        1.0 - (viewport_position.y / params.viewport_size.y) * 2.0
    );
    output.position = vec4f(clip_position, 0.0, 1.0);
    output.local_position = local;
    output.color = presentation_color * f32(style.visible != 0u);
    output.shape_code = style.shape_code;
    output.velocity = presentation_velocity;
    let formation_identity_matches = formation.entity_id
            == simulations.values[instance_index].entity_id
        && formation.incarnation
            == simulations.values[instance_index].incarnation
        && (formation.flags & FORMATION_FLAG_ACTIVE) != 0u
        && formation.member_count >= 1u
        && formation.member_count <= 6u
        && (formation.occupied_slot_mask & ~FORMATION_OCCUPIED_MASK) == 0u;
    output.formation_member_count = select(
        0u,
        formation.member_count,
        formation_identity_matches
    );
    output.formation_occupied_mask = select(
        0u,
        formation.occupied_slot_mask,
        formation_identity_matches
    );
    output.formation_presentation_flags = select(
        0u,
        formation.presentation_flags,
        formation_identity_matches
    );
    output.health_ratio = select(
        0.0,
        clamp(
            f32(max(simulations.values[instance_index].health, 0))
                / f32(max(effect_summary.max_health_fixed_point, 1)),
            0.0,
            1.0
        ),
        formation_identity_matches && effect_identity_matches
    );
    output.directional_defense_active = select(
        0u,
        1u,
        directional_defense_active
    );
    output.effect_presentation_tags = effect_presentation_tags;
    output.glow_kind = glow_kind;
    output.glow_intensity = glow_intensity;
    output.glow_rim_width = glow_rim_width;
    output.glow_halo_width = glow_halo_width;
    output.glow_quad_extent = glow_quad_extent;
    return output;
}

struct EffectPresentation {
    rgb: vec3f,
    alpha: f32,
}

fn apply_entity_glow(
    base_rgb: vec3f,
    base_alpha: f32,
    opacity: f32,
    edge_distance: f32,
    edge_aa: f32,
    glow_kind: u32,
    glow_intensity: f32,
    rim_width: f32,
    halo_width: f32
) -> EffectPresentation {
    if (glow_kind == ENTITY_GLOW_KIND_NONE || glow_intensity <= 0.0) {
        return EffectPresentation(base_rgb, base_alpha);
    }
    let inside_coverage = 1.0 - smoothstep(-edge_aa, edge_aa, edge_distance);
    let rim = (1.0 - smoothstep(
        max(rim_width - edge_aa, 0.0),
        rim_width + edge_aa,
        abs(edge_distance)
    )) * inside_coverage;
    var halo = 0.0;
    if (halo_width > 0.0) {
        halo = 1.0 - smoothstep(
            max(halo_width * 0.08 - edge_aa, 0.0),
            halo_width + edge_aa,
            max(-edge_distance, 0.0)
        );
        halo *= inside_coverage;
    }
    let emissive_rgb = min(
        base_rgb * 1.28 + vec3f(0.055),
        vec3f(1.0)
    );
    let glow_mix = clamp(
        (
            rim * (0.36 + glow_intensity * 0.5)
            + halo * glow_intensity * 0.18
        ) * opacity,
        0.0,
        0.86
    );
    let rgb = mix(
        base_rgb,
        emissive_rgb,
        glow_mix
    );
    return EffectPresentation(rgb, base_alpha);
}

fn apply_effect_presentation(
    base_rgb: vec3f,
    base_alpha: f32,
    opacity: f32,
    shape_edge_distance: f32,
    shape_edge_aa: f32,
    pulse_halo_distance: f32,
    pulse_halo_aa: f32,
    presentation_tags: u32
) -> EffectPresentation {
    var rgb = base_rgb;
    var alpha = base_alpha;
    if ((presentation_tags & EFFECT_PRESENTATION_TAG_BOOST) != 0u) {
        let boost_rim_distance = abs(shape_edge_distance);
        let boost_rim = 1.0 - smoothstep(
            0.055 - shape_edge_aa,
            0.055 + shape_edge_aa,
            boost_rim_distance
        );
        if (boost_rim > 0.0) {
            rgb = mix(
                rgb,
                vec3f(0.04, 0.88, 1.0),
                0.92 * boost_rim
            );
        }
        alpha = max(alpha, boost_rim * opacity * 0.94);
    }
    if ((presentation_tags & EFFECT_PRESENTATION_TAG_PULSE) != 0u) {
        let pulse_halo = 1.0 - smoothstep(
            0.035 - pulse_halo_aa,
            0.035 + pulse_halo_aa,
            pulse_halo_distance
        );
        if (pulse_halo > 0.0) {
            rgb = mix(
                rgb,
                vec3f(0.08, 1.0, 0.82),
                0.94 * pulse_halo
            );
        }
        alpha = max(alpha, pulse_halo * opacity * 0.96);
    }
    return EffectPresentation(rgb, alpha);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let occupied_distance = formation_mask_distance(
        input.local_position,
        input.formation_occupied_mask
    );
    let occupied_aa = max(fwidth(occupied_distance), 0.002);
    let link_distance = formation_member_link_distance(
        input.local_position,
        input.formation_occupied_mask
    );
    let link_aa = max(fwidth(link_distance), 0.002);
    let pulse_distance = abs(length(input.local_position) - 0.92);
    let pulse_aa = max(fwidth(pulse_distance), 0.002);
    let bar_center = vec2f(0.0, 0.86);
    let bar_half = vec2f(0.68, 0.065);
    let outer_distance = box_distance(
        input.local_position,
        bar_center,
        bar_half
    );
    let bar_aa = max(fwidth(outer_distance), 0.002);
    let distance = shape_distance(
        input.local_position,
        input.velocity,
        input.shape_code
    );
    let anti_alias_width = max(fwidth(distance), 0.002);
    if (length(input.local_position) > 1.0) {
        if (input.glow_kind == ENTITY_GLOW_KIND_NONE
            || length(input.local_position) > input.glow_quad_extent) {
            discard;
        }
    }
    // A natural n=1 H uses the same centered, normal-sized hex silhouette as
    // every other enemy. Only merged n=2..6 bodies use the occupied-cell
    // cluster. Empty slots are simulation vocabulary, never a visible guide.
    if (input.shape_code == RENDER_SHAPE_HEXA
        && input.formation_member_count > 1u) {
        let occupied_coverage = 1.0 - smoothstep(
            -occupied_aa,
            occupied_aa,
            occupied_distance
        );
        let progress = f32(input.formation_member_count) / 6.0;
        var rgb = mix(
            input.color.rgb,
            vec3f(1.0, 0.72, 0.22),
            progress * 0.28
        );
        var alpha = input.color.a * occupied_coverage;

        let link = 1.0 - smoothstep(
            0.032 - link_aa,
            0.032 + link_aa,
            link_distance
        );
        if (link > alpha) {
            rgb = mix(rgb, vec3f(1.0, 0.78, 0.32), 0.46);
        }
        alpha = max(alpha, link * input.color.a * 0.78);

        if ((input.formation_presentation_flags
                & FORMATION_FLAG_MERGE_PULSE) != 0u) {
            let pulse = 1.0 - smoothstep(
                0.025 - pulse_aa,
                0.025 + pulse_aa,
                pulse_distance
            );
            if (pulse > alpha) {
                rgb = mix(rgb, vec3f(1.0, 0.92, 0.48), 0.8);
            }
            alpha = max(alpha, pulse * input.color.a);
        }

        if (input.formation_member_count == 6u) {
            let outer = 1.0 - smoothstep(-bar_aa, bar_aa, outer_distance);
            let fill_half_x = max(0.0, bar_half.x * input.health_ratio);
            let fill_center = vec2f(
                bar_center.x - bar_half.x + fill_half_x,
                bar_center.y
            );
            let fill_distance = box_distance(
                input.local_position,
                fill_center,
                vec2f(fill_half_x, bar_half.y * 0.62)
            );
            let fill = select(
                0.0,
                1.0 - smoothstep(-bar_aa, bar_aa, fill_distance),
                input.health_ratio > 0.0
            );
            if (outer > 0.0) {
                rgb = mix(
                    vec3f(0.08, 0.055, 0.04),
                    vec3f(0.3, 1.0, 0.38),
                    fill
                );
                alpha = max(alpha, outer * input.color.a);
            }
        }
        if (alpha <= 0.0) { discard; }
        let entity_glow = apply_entity_glow(
            rgb,
            alpha,
            input.color.a,
            occupied_distance,
            occupied_aa,
            input.glow_kind,
            input.glow_intensity,
            input.glow_rim_width,
            input.glow_halo_width
        );
        let effect_presentation = apply_effect_presentation(
            entity_glow.rgb,
            entity_glow.alpha,
            input.color.a,
            occupied_distance,
            occupied_aa,
            pulse_distance,
            pulse_aa,
            input.effect_presentation_tags
        );
        return vec4f(
            effect_presentation.rgb * effect_presentation.alpha,
            effect_presentation.alpha
        );
    }
    let coverage = 1.0 - smoothstep(-anti_alias_width, anti_alias_width, distance);
    let alpha = input.color.a * coverage;
    var rgb = input.color.rgb;
    if (input.shape_code == RENDER_SHAPE_OCTA
        && input.directional_defense_active != 0u) {
        let oriented = directional_local_position(
            input.local_position,
            input.velocity
        );
        let oriented_length_squared = dot(oriented, oriented);
        let armored_half_angle = 3.0 * 3.141592653589793 / 8.0;
        let armored_sector = oriented_length_squared > SHAPE_DIRECTION_EPSILON
            && dot(
                oriented * inverseSqrt(oriented_length_squared),
                vec2f(0.0, 1.0)
            ) >= cos(armored_half_angle);
        let armor_rim = 1.0 - smoothstep(
            0.09 - anti_alias_width,
            0.09 + anti_alias_width,
            abs(distance)
        );
        if (armored_sector && armor_rim > 0.0) {
            rgb = mix(rgb, vec3f(0.38, 0.94, 1.0), 0.72 * armor_rim);
        }
    }
    let entity_glow = apply_entity_glow(
        rgb,
        alpha,
        input.color.a,
        distance,
        anti_alias_width,
        input.glow_kind,
        input.glow_intensity,
        input.glow_rim_width,
        input.glow_halo_width
    );
    let effect_presentation = apply_effect_presentation(
        entity_glow.rgb,
        entity_glow.alpha,
        input.color.a,
        distance,
        anti_alias_width,
        pulse_distance,
        pulse_aa,
        input.effect_presentation_tags
    );
    return vec4f(
        effect_presentation.rgb * effect_presentation.alpha,
        effect_presentation.alpha
    );
}
`;
