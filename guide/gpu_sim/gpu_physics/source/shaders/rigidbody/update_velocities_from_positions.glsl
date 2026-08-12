#[compute]
#version 450


layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;

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

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _77;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _92;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _122;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _212;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _231;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _237;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _242;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _247;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _251;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _255;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _259;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _264;

layout(push_constant, std430) uniform PushConstants
{
    vec2 world_size;
    float dt;
    float inv_dt;
} pc;

bool is_in_world(vec2 p)
{
    bool _37 = p.x >= 0.0;
    bool _49;
    if (_37)
    {
        _49 = p.x < pc.world_size.x;
    }
    else
    {
        _49 = _37;
    }
    bool _56;
    if (_49)
    {
        _56 = p.y >= 0.0;
    }
    else
    {
        _56 = _49;
    }
    bool _64;
    if (_56)
    {
        _64 = p.y < pc.world_size.y;
    }
    else
    {
        _64 = _56;
    }
    return _64;
}

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _77.rb_count)
    {
        return;
    }
    RB_Tmp tmp;
    tmp.previous_position = _92.rb_tmps[id].previous_position;
    tmp.predicted_position = _92.rb_tmps[id].predicted_position;
    tmp.position_delta = _92.rb_tmps[id].position_delta;
    tmp.grid_index = _92.rb_tmps[id].grid_index;
    tmp._padding_0 = _92.rb_tmps[id]._padding_0;
    vec2 p_pred = tmp.predicted_position;
    RB_Physics physics;
    physics.position = _122.rb_physics[id].position;
    physics.velocity = _122.rb_physics[id].velocity;
    physics.radius = _122.rb_physics[id].radius;
    physics.inv_mass = _122.rb_physics[id].inv_mass;
    physics.meta = _122.rb_physics[id].meta;
    physics.freeze_end_time_ms = _122.rb_physics[id].freeze_end_time_ms;
    vec2 p_prev = tmp.previous_position;
    vec2 param = p_pred;
    bool _146 = !is_in_world(param);
    bool _154;
    if (_146)
    {
        uint param_1 = physics.meta;
        uint param_2 = 1u;
        _154 = rb_is_in_layer(param_1, param_2);
    }
    else
    {
        _154 = _146;
    }
    if (_154)
    {
        vec2 param_3 = p_prev;
        if (is_in_world(param_3))
        {
            p_pred = vec2(clamp(p_pred.x, 0.0, pc.world_size.x - 0.100000001490116119384765625), clamp(p_pred.y, 0.0, pc.world_size.y - 0.100000001490116119384765625));
            p_prev = p_pred;
        }
    }
    physics.position = p_pred;
    vec2 v = (p_pred - p_prev) * pc.inv_dt;
    physics.velocity = v;
    _122.rb_physics[id].position = physics.position;
    _122.rb_physics[id].velocity = physics.velocity;
    _122.rb_physics[id].radius = physics.radius;
    _122.rb_physics[id].inv_mass = physics.inv_mass;
    _122.rb_physics[id].meta = physics.meta;
    _122.rb_physics[id].freeze_end_time_ms = physics.freeze_end_time_ms;
}
