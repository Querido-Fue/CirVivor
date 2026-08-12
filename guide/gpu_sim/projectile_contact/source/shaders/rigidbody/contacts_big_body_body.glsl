#[compute]
#version 450


layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

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

struct Contact
{
    vec2 world_pos;
    int self_id;
    int other_id;
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
} _74;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _105;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _158;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _182;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _332;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _366;

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _397;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _422;

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _496;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _501;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _506;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _523;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _527;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _532;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _536;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _540;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _544;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _549;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _558;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _562;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _566;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _570;

layout(set = 2, binding = 4, std430) buffer ContactHandlerDamageReadback
{
    uint write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    int data[];
} contact_handler_damage_readback;

layout(push_constant, std430) uniform PushConstants
{
    uvec2 grid_cell_count;
    vec2 grid_cell_size;
    uint time_ms;
} pc;

layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;
layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;

uint rb_get_sensor_mask(uint phys_meta)
{
    return (phys_meta >> uint(16)) & 255u;
}

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

bool contact_handler_has_flags(uint handler_flags, uint flags)
{
    return (handler_flags & flags) == flags;
}

uint rb_get_layer_mask(uint meta)
{
    return (meta >> uint(0)) & 255u;
}

void main()
{
    uint local = gl_LocalInvocationID.x;
    uint cell_index = gl_WorkGroupID.x;
    uint cell_offset = cell_index * 2u;
    uint cell_count = _74.grid_cell_counts[cell_offset];
    uint cell_big_offset = cell_offset + 1u;
    uint cell_big_count = _74.grid_cell_counts[cell_big_offset];
    if ((local >= cell_big_count) || (cell_count == 0u))
    {
        return;
    }
    uint _110 = (cell_big_offset * 64u) + local;
    WorldGridBody gb;
    gb.pred_pos = _105.grid_bodies[_110].pred_pos;
    gb.physics_meta = _105.grid_bodies[_110].physics_meta;
    gb.sim_meta = _105.grid_bodies[_110].sim_meta;
    gb.inv_mass = _105.grid_bodies[_110].inv_mass;
    gb.radius = _105.grid_bodies[_110].radius;
    gb.body_id = _105.grid_bodies[_110].body_id;
    gb._gb_padding_0 = _105.grid_bodies[_110]._gb_padding_0;
    uint param = gb.physics_meta;
    uint sensor_mask = rb_get_sensor_mask(param);
    uint param_1 = gb.physics_meta;
    uint param_2 = 2u;
    bool check_for_previous_contact = rb_is_in_layer(param_1, param_2);
    vec2 prev_pos = gb.pred_pos;
    if (check_for_previous_contact)
    {
        prev_pos = _158.rb_tmps[gb.body_id].previous_position;
    }
    bool is_valid = (gb.radius > 0.0) && (sensor_mask != 0u);
    if (!is_valid)
    {
        return;
    }
    uint param_3 = _182.rb_contact_handlers[gb.body_id].flags;
    uint param_4 = 2u;
    bool search_for_closest_only = contact_handler_has_flags(param_3, param_4);
    float min_sq_dist = 100000002004087734272.0;
    int min_contact_id = -1;
    WorldGridBody other_gb;
    Contact contact;
    for (uint i = 0u; i < cell_count; i++)
    {
        uint _208 = (cell_offset * 64u) + i;
        other_gb.pred_pos = _105.grid_bodies[_208].pred_pos;
        other_gb.physics_meta = _105.grid_bodies[_208].physics_meta;
        other_gb.sim_meta = _105.grid_bodies[_208].sim_meta;
        other_gb.inv_mass = _105.grid_bodies[_208].inv_mass;
        other_gb.radius = _105.grid_bodies[_208].radius;
        other_gb.body_id = _105.grid_bodies[_208].body_id;
        other_gb._gb_padding_0 = _105.grid_bodies[_208]._gb_padding_0;
        bool is_same_body = gb.body_id == other_gb.body_id;
        uint param_5 = other_gb.physics_meta;
        uint other_layer = rb_get_layer_mask(param_5);
        bool sensor_possible = (sensor_mask & other_layer) != 0u;
        vec2 delta = other_gb.pred_pos - gb.pred_pos;
        float dist_sq = dot(delta, delta);
        float min_dist = gb.radius + other_gb.radius;
        float min_dist_sq = min_dist * min_dist;
        if ((is_same_body || (!sensor_possible)) || (dist_sq >= min_dist_sq))
        {
            continue;
        }
        if (check_for_previous_contact)
        {
            vec2 other_prev_pos = _158.rb_tmps[other_gb.body_id].previous_position;
            vec2 prev_dir = prev_pos - other_prev_pos;
            float prev_dist_sq = dot(prev_dir, prev_dir);
            if (prev_dist_sq < min_dist_sq)
            {
                continue;
            }
        }
        if (search_for_closest_only)
        {
            if ((dist_sq > 4.0) && (dist_sq < min_sq_dist))
            {
                min_sq_dist = dist_sq;
                min_contact_id = int(other_gb.body_id);
            }
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
        uint _334 = atomicAdd(_332.contact_count, 1u);
        uint contact_id = _334;
        if (contact_id >= 32768u)
        {
            return;
        }
        contact.world_pos = gb.pred_pos + (normal * (dist - other_gb.radius));
        contact.self_id = int(gb.body_id);
        contact.other_id = int(other_gb.body_id);
        _366.contacts[contact_id].world_pos = contact.world_pos;
        _366.contacts[contact_id].self_id = contact.self_id;
        _366.contacts[contact_id].other_id = contact.other_id;
    }
    if (min_contact_id >= 0)
    {
        for (uint i_1 = 0u; i_1 < 128u; i_1++)
        {
            int bucket_id = _397.contact_bucket_meta[i_1];
            if (uint(bucket_id) == gb.body_id)
            {
                int _412 = atomicAdd(_397.contact_bucket_meta[128u + i_1], 1);
                uint write_index = uint(_412);
                if (write_index < 64u)
                {
                    _422.contact_bucket_data[(i_1 * 64u) + write_index].x = floatBitsToUint(min_sq_dist);
                    _422.contact_bucket_data[(i_1 * 64u) + write_index].y = uint(min_contact_id);
                }
                break;
            }
            else
            {
                if (bucket_id == (-1))
                {
                    int _449 = atomicCompSwap(_397.contact_bucket_meta[i_1], -1, int(gb.body_id));
                    int result = _449;
                    bool _451 = result == (-1);
                    bool _460;
                    if (!_451)
                    {
                        _460 = uint(result) == gb.body_id;
                    }
                    else
                    {
                        _460 = _451;
                    }
                    if (_460)
                    {
                        int _467 = atomicAdd(_397.contact_bucket_meta[128u + i_1], 1);
                        uint write_index_1 = uint(_467);
                        if (write_index_1 < 64u)
                        {
                            _422.contact_bucket_data[(i_1 * 64u) + write_index_1].x = floatBitsToUint(min_sq_dist);
                            _422.contact_bucket_data[(i_1 * 64u) + write_index_1].y = uint(min_contact_id);
                        }
                        break;
                    }
                }
            }
        }
    }
}
