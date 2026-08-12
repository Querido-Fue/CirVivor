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
} _36;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _53;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _155;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _160;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _179;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _185;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _190;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _195;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _199;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _203;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _207;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _212;

layout(push_constant, std430) uniform PushConstants
{
    float dt;
    float inv_dt;
} pc;

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _36.rb_count)
    {
        return;
    }
    RB_Physics physics;
    physics.position = _53.rb_physics[id].position;
    physics.velocity = _53.rb_physics[id].velocity;
    physics.radius = _53.rb_physics[id].radius;
    physics.inv_mass = _53.rb_physics[id].inv_mass;
    physics.meta = _53.rb_physics[id].meta;
    physics.freeze_end_time_ms = _53.rb_physics[id].freeze_end_time_ms;
    vec2 v = physics.velocity;
    uint param = physics.meta;
    uint param_1 = 40u;
    float damping = rb_is_in_layer(param, param_1) ? 2.0 : 0.00999999977648258209228515625;
    v *= clamp(1.0 - (damping * pc.dt), 0.0, 1.0);
    float max_speed = 1000.0;
    uint param_2 = physics.meta;
    uint param_3 = 1u;
    if (rb_is_in_layer(param_2, param_3))
    {
        max_speed = 200.0;
    }
    float v2 = dot(v, v);
    if (v2 > (max_speed * max_speed))
    {
        v = normalize(v) * max_speed;
    }
    physics.velocity = v;
    _53.rb_physics[id].position = physics.position;
    _53.rb_physics[id].velocity = physics.velocity;
    _53.rb_physics[id].radius = physics.radius;
    _53.rb_physics[id].inv_mass = physics.inv_mass;
    _53.rb_physics[id].meta = physics.meta;
    _53.rb_physics[id].freeze_end_time_ms = physics.freeze_end_time_ms;
}
