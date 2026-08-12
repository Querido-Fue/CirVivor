#[compute]
#version 450


layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

const ivec2 _105[9] = ivec2[](ivec2(-1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1));

struct WorldGridBody
{
    vec2 pred_pos;
    uint physics_meta;
    uint sim_meta;
    float inv_mass;
    float radius;
    uint body_id;
    uint _gb_padding_0;
};

struct RB_Tmp
{
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
};

struct RB_Physics
{
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    uint meta;
    uint freeze_end_time_ms;
};

struct RB_Sim
{
    float lifetime;
    int health;
    uint timer;
    uint meta;
    uint fire_end_time_ms;
    uint shock_end_time_ms;
    uint slow_end_time_ms;
    uint speed_factor_i;
};

struct RB_ContactHandler
{
    float damage_self;
    float damage_other;
    float damage_falloff;
    float fire_timer;
    uint flags;
    int chaining;
    int damage_report_id;
    float slow_timer;
};

struct RB_Init
{
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    float health;
    float lifetime;
    uint physics_meta;
    uint sim_meta;
    uint _padding_0;
    uint _padding_1;
    float ch_damage_self;
    float ch_damage_other;
    float ch_damage_falloff;
    float ch_fire_timer;
    uint ch_flags;
    int ch_chaining;
    int ch_damage_report_id;
    float ch_slow_timer;
};

layout(set = 1, binding = 3, std430) buffer WorldGridCellCounts
{
    uint grid_cell_counts[];
} _153;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _193;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _579;

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _594;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _599;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _604;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _620;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _626;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _631;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _636;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _640;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _644;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _648;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _653;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _662;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _666;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _670;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _674;

layout(push_constant, std430) uniform PushConstants
{
    uvec2 grid_cell_count;
    vec2 grid_cell_size;
    vec2 world_size;
    uvec2 iterations;
    float dt;
    float inv_dt;
} pc;

layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;
layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;

shared uint neighbor_cell_counts[9];
shared uint neighbor_cell_indices[9];
shared uint cell_count;
shared uint cell_big_count;

uint rb_get_collision_mask(uint phys_meta)
{
    return (phys_meta >> uint(8)) & 255u;
}

bool rb_has_flags(uint sim_meta, uint flags)
{
    return (((sim_meta >> uint(8)) & 255u) & (flags & 255u)) == (flags & 255u);
}

uint rb_get_layer_mask(uint meta)
{
    return (meta >> uint(0)) & 255u;
}

void main()
{
    uint local = gl_LocalInvocationID.x;
    uint cell_index = gl_WorkGroupID.x;
    uint cell_offset = (cell_index * 64u) * 2u;
    if (local < 9u)
    {
        ivec2 cell = ivec2(int(cell_index % pc.grid_cell_count.x), int(cell_index / pc.grid_cell_count.x));
        uvec2 neighbor_cell = uvec2(cell + _105[local]);
        bool _117 = neighbor_cell.x >= pc.grid_cell_count.x;
        bool _127;
        if (!_117)
        {
            _127 = neighbor_cell.y >= pc.grid_cell_count.y;
        }
        else
        {
            _127 = _117;
        }
        if (_127)
        {
            neighbor_cell_counts[local] = 0u;
            neighbor_cell_indices[local] = 0u;
        }
        else
        {
            uint neighbor_cell_index = (neighbor_cell.y * pc.grid_cell_count.x) + neighbor_cell.x;
            neighbor_cell_counts[local] = min(_153.grid_cell_counts[neighbor_cell_index * 2u], 64u);
            neighbor_cell_indices[local] = neighbor_cell_index;
        }
        if (local == 4u)
        {
            cell_count = neighbor_cell_counts[local];
            cell_big_count = _153.grid_cell_counts[(cell_index * 2u) + 1u];
        }
    }
    barrier();
    if (local >= cell_count)
    {
        return;
    }
    uint _196 = cell_offset + local;
    WorldGridBody gb;
    gb.pred_pos = _193.grid_bodies[_196].pred_pos;
    gb.physics_meta = _193.grid_bodies[_196].physics_meta;
    gb.sim_meta = _193.grid_bodies[_196].sim_meta;
    gb.inv_mass = _193.grid_bodies[_196].inv_mass;
    gb.radius = _193.grid_bodies[_196].radius;
    gb.body_id = _193.grid_bodies[_196].body_id;
    gb._gb_padding_0 = _193.grid_bodies[_196]._gb_padding_0;
    uint param = gb.physics_meta;
    uint collision_mask = rb_get_collision_mask(param);
    float soft_border = 8.0;
    float dist_x = min(gb.pred_pos.x, pc.world_size.x - gb.pred_pos.x);
    float dist_y = min(gb.pred_pos.y, pc.world_size.y - gb.pred_pos.y);
    float world_border_factor_x = 1.0 - smoothstep(0.0, soft_border, dist_x);
    float world_border_factor_y = 1.0 - smoothstep(0.0, soft_border, dist_y);
    float world_border_factor = max(world_border_factor_x, world_border_factor_y);
    float compliance = mix(9.9999999747524270787835121154785e-07, 0.001000000047497451305389404296875, world_border_factor);
    float alpha = compliance / ((pc.dt * pc.dt) * float(pc.iterations.y));
    bool _284 = gb.inv_mass >= 9.9999999747524270787835121154785e-07;
    bool _290;
    if (_284)
    {
        _290 = gb.radius > 0.0;
    }
    else
    {
        _290 = _284;
    }
    bool _293 = _290 && (collision_mask != 0u);
    bool _301;
    if (_293)
    {
        uint param_1 = gb.sim_meta;
        uint param_2 = 1u;
        _301 = rb_has_flags(param_1, param_2);
    }
    else
    {
        _301 = _293;
    }
    bool is_valid = _301;
    if (!is_valid)
    {
        return;
    }
    vec2 pos_delta = vec2(0.0);
    WorldGridBody other_gb;
    for (uint n = 0u; n < 9u; n++)
    {
        uint neighbor_cell_index_1 = neighbor_cell_indices[n];
        uint neighbor_cell_count = neighbor_cell_counts[n];
        uint neighbor_cell_offset = (neighbor_cell_index_1 * 64u) * 2u;
        for (uint i = 0u; i < neighbor_cell_count; i++)
        {
            uint _341 = neighbor_cell_offset + i;
            other_gb.pred_pos = _193.grid_bodies[_341].pred_pos;
            other_gb.physics_meta = _193.grid_bodies[_341].physics_meta;
            other_gb.sim_meta = _193.grid_bodies[_341].sim_meta;
            other_gb.inv_mass = _193.grid_bodies[_341].inv_mass;
            other_gb.radius = _193.grid_bodies[_341].radius;
            other_gb.body_id = _193.grid_bodies[_341].body_id;
            other_gb._gb_padding_0 = _193.grid_bodies[_341]._gb_padding_0;
            bool is_same_body = gb.body_id == other_gb.body_id;
            uint param_3 = other_gb.physics_meta;
            uint other_layer = rb_get_layer_mask(param_3);
            bool collision_possible = (collision_mask & other_layer) != 0u;
            vec2 delta = gb.pred_pos - other_gb.pred_pos;
            float dist_sq = dot(delta, delta);
            float min_dist = gb.radius + other_gb.radius;
            float min_dist_sq = min_dist * min_dist;
            if ((is_same_body || (!collision_possible)) || (dist_sq >= min_dist_sq))
            {
                continue;
            }
            vec2 normal = vec2(1.0, 0.0);
            float dist = 0.0;
            if (dist_sq > 9.9999999600419720025001879548654e-13)
            {
                float inv_dist = inversesqrt(dist_sq);
                normal = delta * inv_dist;
                dist = dist_sq * inv_dist;
            }
            float penetration = min_dist - dist;
            float w_sum = gb.inv_mass + other_gb.inv_mass;
            if (w_sum > 9.9999999747524270787835121154785e-07)
            {
                float dlambda = penetration / (w_sum + alpha);
                vec2 corr = normal * dlambda;
                pos_delta += (corr * gb.inv_mass);
            }
        }
    }
    uint cell_big_offset = cell_offset + 64u;
    WorldGridBody other_gb_1;
    for (uint i_1 = 0u; i_1 < cell_big_count; i_1++)
    {
        uint _471 = cell_big_offset + i_1;
        other_gb_1.pred_pos = _193.grid_bodies[_471].pred_pos;
        other_gb_1.physics_meta = _193.grid_bodies[_471].physics_meta;
        other_gb_1.sim_meta = _193.grid_bodies[_471].sim_meta;
        other_gb_1.inv_mass = _193.grid_bodies[_471].inv_mass;
        other_gb_1.radius = _193.grid_bodies[_471].radius;
        other_gb_1.body_id = _193.grid_bodies[_471].body_id;
        other_gb_1._gb_padding_0 = _193.grid_bodies[_471]._gb_padding_0;
        uint param_4 = other_gb_1.physics_meta;
        uint other_layer_1 = rb_get_layer_mask(param_4);
        bool collision_possible_1 = (collision_mask & other_layer_1) != 0u;
        vec2 delta_1 = gb.pred_pos - other_gb_1.pred_pos;
        float dist_sq_1 = dot(delta_1, delta_1);
        float min_dist_1 = gb.radius + other_gb_1.radius;
        float min_dist_sq_1 = min_dist_1 * min_dist_1;
        if ((!collision_possible_1) || (dist_sq_1 >= min_dist_sq_1))
        {
            continue;
        }
        vec2 normal_1 = vec2(1.0, 0.0);
        float dist_1 = min_dist_1;
        if (dist_sq_1 > 9.9999999600419720025001879548654e-13)
        {
            float inv_dist_1 = inversesqrt(dist_sq_1);
            normal_1 = delta_1 * inv_dist_1;
            dist_1 = dist_sq_1 * inv_dist_1;
        }
        float penetration_1 = min_dist_1 - dist_1;
        float w_sum_1 = gb.inv_mass + other_gb_1.inv_mass;
        if (w_sum_1 > 9.9999999747524270787835121154785e-07)
        {
            float dlambda_1 = penetration_1 / (w_sum_1 + alpha);
            vec2 corr_1 = normal_1 * dlambda_1;
            pos_delta += (corr_1 * gb.inv_mass);
        }
    }
    _579.rb_tmps[gb.body_id].position_delta += pos_delta;
}
