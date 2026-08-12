#[compute]
#version 450


layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;

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

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _149;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _163;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _210;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _237;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _254;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _278;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _398;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _448;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _464;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _468;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _472;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _477;

layout(push_constant, std430) uniform PushConstants
{
    float dead_explosion_radius;
    float dead_explosion_inv_mass;
    float dead_explosion_damage;
    float dead_explosion_damage_falloff;
    int dead_explosion_damage_report_id;
} pc;

shared uint local_enemies_alive_count;

bool rb_has_flags(uint sim_meta, uint flags)
{
    return (((sim_meta >> uint(8)) & 255u) & (flags & 255u)) == (flags & 255u);
}

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

RB_Init construct_RB_Init()
{
    RB_Init init;
    init.position = vec2(0.0);
    init.velocity = vec2(0.0);
    init.radius = 0.0;
    init.inv_mass = 0.0;
    init.health = 0.0;
    init.lifetime = 0.0;
    init.physics_meta = 0u;
    init.sim_meta = 0u;
    init._padding_0 = 0u;
    init._padding_1 = 0u;
    init.ch_damage_self = 0.0;
    init.ch_damage_other = 0.0;
    init.ch_damage_falloff = 0.0;
    init.ch_fire_timer = 0.0;
    init.ch_flags = 0u;
    init.ch_chaining = 0;
    init.ch_damage_report_id = -1;
    init.ch_slow_timer = 0.0;
    return init;
}

void rb_set_layer_mask(inout uint phys_meta, inout uint sim_meta, uint layer_mask)
{
    phys_meta = (phys_meta & 4294967040u) | ((layer_mask & 255u) << uint(0));
    sim_meta = (sim_meta & 4294967040u) | ((layer_mask & 255u) << uint(0));
}

void rb_set_sensor_mask(inout uint phys_meta, uint sensor_mask)
{
    phys_meta = (phys_meta & 4278255615u) | ((sensor_mask & 255u) << uint(16));
}

void rb_set_flags(inout uint sim_meta, uint flags)
{
    sim_meta |= ((flags & 255u) << uint(8));
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    uint local = gl_LocalInvocationID.x;
    bool is_valid = id < _149.rb_count;
    uint _156;
    if (is_valid)
    {
        _156 = _163.rb_sims[id].meta;
    }
    else
    {
        _156 = 0u;
    }
    uint meta = _156;
    bool _178;
    if (is_valid)
    {
        uint param = meta;
        uint param_1 = 1u;
        _178 = rb_has_flags(param, param_1);
    }
    else
    {
        _178 = is_valid;
    }
    bool is_alive = _178;
    bool _187;
    if (is_valid)
    {
        uint param_2 = meta;
        uint param_3 = 1u;
        _187 = rb_is_in_layer(param_2, param_3);
    }
    else
    {
        _187 = is_valid;
    }
    bool is_enemy = _187;
    if (local == 0u)
    {
        local_enemies_alive_count = 0u;
    }
    barrier();
    if (is_alive && is_enemy)
    {
        uint _201 = atomicAdd(local_enemies_alive_count, 1u);
    }
    barrier();
    if (local == 0u)
    {
        uint write_index = _210.body_enemies_alive_readback[0];
        uint _217 = atomicAdd(_210.body_enemies_alive_readback[1u + write_index], local_enemies_alive_count);
    }
    if ((!is_valid) || is_alive)
    {
        return;
    }
    uint _227 = atomicAdd(_149.rb_removal_count, 1u);
    uint removal_id = _227;
    if (removal_id >= 32768u)
    {
        return;
    }
    _237.rb_removals[removal_id] = id;
    uint param_4 = meta;
    uint param_5 = 4u;
    bool counts_as_kill = rb_has_flags(param_4, param_5);
    if (counts_as_kill)
    {
        uint write_index_1 = _254.body_enemies_killed_readback[0];
        uint buffer_offset = 4u + (write_index_1 * 4096u);
        uint _265 = atomicAdd(_254.body_enemies_killed_readback[buffer_offset], 1u);
        uint element_index = _265;
        if (element_index < 1024u)
        {
            RB_Physics physics;
            physics.position = _278.rb_physics[id].position;
            physics.velocity = _278.rb_physics[id].velocity;
            physics.radius = _278.rb_physics[id].radius;
            physics.inv_mass = _278.rb_physics[id].inv_mass;
            physics.meta = _278.rb_physics[id].meta;
            physics.freeze_end_time_ms = _278.rb_physics[id].freeze_end_time_ms;
            uint element_offset = (buffer_offset + 4u) + (element_index * 4u);
            _254.body_enemies_killed_readback[element_offset + 0u] = floatBitsToUint(physics.position.x);
            _254.body_enemies_killed_readback[element_offset + 1u] = floatBitsToUint(physics.position.y);
            _254.body_enemies_killed_readback[element_offset + 2u] = _163.rb_sims[id].meta;
        }
    }
    uint param_6 = meta;
    uint param_7 = 8u;
    bool _323 = rb_has_flags(param_6, param_7);
    bool _330;
    if (_323)
    {
        _330 = (!is_enemy) || counts_as_kill;
    }
    else
    {
        _330 = _323;
    }
    if (_330)
    {
        uint _335 = atomicAdd(_149.rb_addition_count, 1u);
        uint addition_id = _335;
        if (addition_id < 8192u)
        {
            RB_Init init = construct_RB_Init();
            init.position = _278.rb_physics[id].position;
            init.radius = pc.dead_explosion_radius;
            init.inv_mass = pc.dead_explosion_inv_mass;
            uint param_8 = init.physics_meta;
            uint param_9 = init.sim_meta;
            uint param_10 = 4u;
            rb_set_layer_mask(param_8, param_9, param_10);
            init.physics_meta = param_8;
            init.sim_meta = param_9;
            uint param_11 = init.physics_meta;
            uint param_12 = 1u;
            rb_set_sensor_mask(param_11, param_12);
            init.physics_meta = param_11;
            uint param_13 = init.sim_meta;
            uint param_14 = 1u;
            rb_set_flags(param_13, param_14);
            init.sim_meta = param_13;
            init.ch_damage_other = pc.dead_explosion_damage;
            init.ch_damage_falloff = pc.dead_explosion_damage_falloff;
            init.ch_damage_report_id = pc.dead_explosion_damage_report_id;
            _398.rb_additions[addition_id].position = init.position;
            _398.rb_additions[addition_id].velocity = init.velocity;
            _398.rb_additions[addition_id].radius = init.radius;
            _398.rb_additions[addition_id].inv_mass = init.inv_mass;
            _398.rb_additions[addition_id].health = init.health;
            _398.rb_additions[addition_id].lifetime = init.lifetime;
            _398.rb_additions[addition_id].physics_meta = init.physics_meta;
            _398.rb_additions[addition_id].sim_meta = init.sim_meta;
            _398.rb_additions[addition_id]._padding_0 = init._padding_0;
            _398.rb_additions[addition_id]._padding_1 = init._padding_1;
            _398.rb_additions[addition_id].ch_damage_self = init.ch_damage_self;
            _398.rb_additions[addition_id].ch_damage_other = init.ch_damage_other;
            _398.rb_additions[addition_id].ch_damage_falloff = init.ch_damage_falloff;
            _398.rb_additions[addition_id].ch_fire_timer = init.ch_fire_timer;
            _398.rb_additions[addition_id].ch_flags = init.ch_flags;
            _398.rb_additions[addition_id].ch_chaining = init.ch_chaining;
            _398.rb_additions[addition_id].ch_damage_report_id = init.ch_damage_report_id;
            _398.rb_additions[addition_id].ch_slow_timer = init.ch_slow_timer;
        }
    }
}
