#[compute]
#version 450


layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;

struct RB_Physics
{
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    uint meta;
    uint freeze_end_time_ms;
};

struct RB_Tmp
{
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
};

struct Contact
{
    vec2 world_pos;
    int self_id;
    int other_id;
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

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _110;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _127;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _170;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _253;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _280;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _301;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _319;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _325;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _329;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _334;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _338;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _342;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _346;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _350;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _355;

layout(set = 1, binding = 3, std430) buffer WorldGridCellCounts
{
    uint grid_cell_counts[];
} _359;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _364;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _368;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _372;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _376;

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _380;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _385;

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
    vec2 inv_world_size;
    float sdf_scale;
} pc;

layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;
layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;

uint rb_get_sensor_mask(uint phys_meta)
{
    return (phys_meta >> uint(16)) & 255u;
}

float sdf(vec2 uv, float sdf_scale)
{
    return sdf_scale * textureLod(world_sdf_tex, uv, 0.0).x;
}

vec2 sdf_gradient(vec2 uv, float sdf_scale, vec2 eps)
{
    vec2 param = uv + vec2(eps.x, 0.0);
    float param_1 = sdf_scale;
    vec2 param_2 = uv - vec2(eps.x, 0.0);
    float param_3 = sdf_scale;
    float dx = sdf(param, param_1) - sdf(param_2, param_3);
    vec2 param_4 = uv + vec2(0.0, eps.y);
    float param_5 = sdf_scale;
    vec2 param_6 = uv - vec2(0.0, eps.y);
    float param_7 = sdf_scale;
    float dy = sdf(param_4, param_5) - sdf(param_6, param_7);
    return vec2(dx, dy) / (eps * 2.0);
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _110.rb_count)
    {
        return;
    }
    RB_Physics physics;
    physics.position = _127.rb_physics[id].position;
    physics.velocity = _127.rb_physics[id].velocity;
    physics.radius = _127.rb_physics[id].radius;
    physics.inv_mass = _127.rb_physics[id].inv_mass;
    physics.meta = _127.rb_physics[id].meta;
    physics.freeze_end_time_ms = _127.rb_physics[id].freeze_end_time_ms;
    uint meta = physics.meta;
    uint param = meta;
    uint sensor_mask = rb_get_sensor_mask(param);
    if ((sensor_mask & 128u) == 0u)
    {
        return;
    }
    RB_Tmp tmp;
    tmp.previous_position = _170.rb_tmps[id].previous_position;
    tmp.predicted_position = _170.rb_tmps[id].predicted_position;
    tmp.position_delta = _170.rb_tmps[id].position_delta;
    tmp.grid_index = _170.rb_tmps[id].grid_index;
    tmp._padding_0 = _170.rb_tmps[id]._padding_0;
    vec2 p = tmp.predicted_position;
    float r = physics.radius;
    vec2 uv = p * pc.inv_world_size;
    vec2 param_1 = uv;
    float param_2 = pc.sdf_scale;
    float d = sdf(param_1, param_2);
    float penetration = r - d;
    if (penetration <= 0.0)
    {
        return;
    }
    vec2 p_prev = tmp.previous_position;
    vec2 param_3 = p_prev * pc.inv_world_size;
    float param_4 = pc.sdf_scale;
    float d_prev = sdf(param_3, param_4);
    float pen_prev = r - d_prev;
    if (pen_prev > 0.0)
    {
        return;
    }
    vec2 param_5 = uv;
    float param_6 = pc.sdf_scale;
    vec2 param_7 = pc.inv_world_size;
    vec2 n = sdf_gradient(param_5, param_6, param_7);
    uint _255 = atomicAdd(_253.contact_count, 1u);
    uint contact_id = _255;
    if (contact_id >= 32768u)
    {
        return;
    }
    Contact contact;
    contact.world_pos = p + (n * penetration);
    contact.self_id = int(id);
    contact.other_id = -1;
    _280.contacts[contact_id].world_pos = contact.world_pos;
    _280.contacts[contact_id].self_id = contact.self_id;
    _280.contacts[contact_id].other_id = contact.other_id;
}
