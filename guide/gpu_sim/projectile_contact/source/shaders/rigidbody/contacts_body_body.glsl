#[compute]
#version 450


layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

const ivec2 _106[9] = ivec2[](ivec2(-1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1));

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
} _172;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _208;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _260;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _284;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _449;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _483;

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _534;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _539;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _544;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _561;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _565;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _570;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _574;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _578;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _582;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _587;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _596;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _600;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _604;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _608;

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _612;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _616;

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

shared uint neighbor_cell_counts[9];
shared uint neighbor_cell_indices[9];
shared uint cell_count;

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
    if (local < 9u)
    {
        ivec2 cell = ivec2(int(cell_index % pc.grid_cell_count.x), int(cell_index / pc.grid_cell_count.x));
        ivec2 neighbor_cell = cell + _106[local];
        bool _116 = neighbor_cell.x < 0;
        bool _126;
        if (!_116)
        {
            _126 = uint(neighbor_cell.x) >= pc.grid_cell_count.x;
        }
        else
        {
            _126 = _116;
        }
        bool _134;
        if (!_126)
        {
            _134 = neighbor_cell.y < 0;
        }
        else
        {
            _134 = _126;
        }
        bool _144;
        if (!_134)
        {
            _144 = uint(neighbor_cell.y) >= pc.grid_cell_count.y;
        }
        else
        {
            _144 = _134;
        }
        if (_144)
        {
            neighbor_cell_counts[local] = 0u;
            neighbor_cell_indices[local] = 0u;
        }
        else
        {
            uint neighbor_cell_index = (uint(neighbor_cell.y) * pc.grid_cell_count.x) + uint(neighbor_cell.x);
            neighbor_cell_counts[local] = min(_172.grid_cell_counts[neighbor_cell_index * 2u], 64u);
            neighbor_cell_indices[local] = neighbor_cell_index;
        }
        if (local == 4u)
        {
            cell_count = neighbor_cell_counts[local];
        }
    }
    barrier();
    if (local >= cell_count)
    {
        return;
    }
    uint _213 = ((cell_index * 64u) * 2u) + local;
    WorldGridBody gb;
    gb.pred_pos = _208.grid_bodies[_213].pred_pos;
    gb.physics_meta = _208.grid_bodies[_213].physics_meta;
    gb.sim_meta = _208.grid_bodies[_213].sim_meta;
    gb.inv_mass = _208.grid_bodies[_213].inv_mass;
    gb.radius = _208.grid_bodies[_213].radius;
    gb.body_id = _208.grid_bodies[_213].body_id;
    gb._gb_padding_0 = _208.grid_bodies[_213]._gb_padding_0;
    uint param = gb.physics_meta;
    uint sensor_mask = rb_get_sensor_mask(param);
    uint param_1 = gb.physics_meta;
    uint param_2 = 2u;
    bool check_for_previous_contact = rb_is_in_layer(param_1, param_2);
    vec2 prev_pos = gb.pred_pos;
    if (check_for_previous_contact)
    {
        prev_pos = _260.rb_tmps[gb.body_id].previous_position;
    }
    bool is_valid = (gb.radius > 0.0) && (sensor_mask != 0u);
    if (!is_valid)
    {
        return;
    }
    uint param_3 = _284.rb_contact_handlers[gb.body_id].flags;
    uint param_4 = 2u;
    bool search_for_closest_only = contact_handler_has_flags(param_3, param_4);
    float min_sq_dist = 100000002004087734272.0;
    int min_contact_id = -1;
    WorldGridBody other_gb;
    Contact contact;
    for (uint n = 0u; n < 9u; n++)
    {
        uint neighbor_cell_index_1 = neighbor_cell_indices[n];
        uint neighbor_cell_count = neighbor_cell_counts[n];
        for (uint i = 0u; i < neighbor_cell_count; i++)
        {
            uint _325 = ((neighbor_cell_index_1 * 64u) * 2u) + i;
            other_gb.pred_pos = _208.grid_bodies[_325].pred_pos;
            other_gb.physics_meta = _208.grid_bodies[_325].physics_meta;
            other_gb.sim_meta = _208.grid_bodies[_325].sim_meta;
            other_gb.inv_mass = _208.grid_bodies[_325].inv_mass;
            other_gb.radius = _208.grid_bodies[_325].radius;
            other_gb.body_id = _208.grid_bodies[_325].body_id;
            other_gb._gb_padding_0 = _208.grid_bodies[_325]._gb_padding_0;
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
                vec2 other_prev_pos = _260.rb_tmps[other_gb.body_id].previous_position;
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
            uint _451 = atomicAdd(_449.contact_count, 1u);
            uint contact_id = _451;
            if (contact_id >= 32768u)
            {
                return;
            }
            contact.world_pos = gb.pred_pos + (normal * (dist - other_gb.radius));
            contact.self_id = int(gb.body_id);
            contact.other_id = int(other_gb.body_id);
            _483.contacts[contact_id].world_pos = contact.world_pos;
            _483.contacts[contact_id].self_id = contact.self_id;
            _483.contacts[contact_id].other_id = contact.other_id;
        }
    }
    if (min_contact_id >= 0)
    {
        Contact contact_1;
        contact_1.world_pos = vec2(0.0);
        contact_1.self_id = int(gb.body_id);
        contact_1.other_id = min_contact_id;
        uint _514 = atomicAdd(_449.contact_count, 1u);
        uint contact_id_1 = _514;
        if (contact_id_1 < 32768u)
        {
            _483.contacts[contact_id_1].world_pos = contact_1.world_pos;
            _483.contacts[contact_id_1].self_id = contact_1.self_id;
            _483.contacts[contact_id_1].other_id = contact_1.other_id;
        }
    }
}
