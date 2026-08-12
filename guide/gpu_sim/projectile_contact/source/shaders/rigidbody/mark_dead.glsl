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

struct RB_Tmp
{
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
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

struct RB_Physics
{
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    uint meta;
    uint freeze_end_time_ms;
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
} _138;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _153;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _191;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _203;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _311;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _407;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _466;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _471;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _476;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _480;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _484;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _488;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _493;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _502;

layout(set = 1, binding = 3, std430) buffer WorldGridCellCounts
{
    uint grid_cell_counts[];
} _506;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _510;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _514;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _518;

layout(push_constant, std430) uniform PushConstants
{
    float dt;
    float grenade_slow_radius;
    float grenade_slow_duration;
    float grenade_explosion_radius;
    float grenade_explosion_damage;
    float grenade_explosion_inv_mass;
    int grenade_damage_report_id;
} pc;

layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;
layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;

void rb_clear_flags(inout uint sim_meta, uint flags)
{
    sim_meta &= (~((flags & 255u) << uint(8)));
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

void rb_set_flags(inout uint sim_meta, uint flags)
{
    sim_meta |= ((flags & 255u) << uint(8));
}

void rb_set_sensor_mask(inout uint phys_meta, uint sensor_mask)
{
    phys_meta = (phys_meta & 4278255615u) | ((sensor_mask & 255u) << uint(16));
}

void rb_set_layer_mask(inout uint phys_meta, inout uint sim_meta, uint layer_mask)
{
    phys_meta = (phys_meta & 4294967040u) | ((layer_mask & 255u) << uint(0));
    sim_meta = (sim_meta & 4294967040u) | ((layer_mask & 255u) << uint(0));
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _138.rb_count)
    {
        return;
    }
    RB_Sim sim;
    sim.lifetime = _153.rb_sims[id].lifetime;
    sim.health = _153.rb_sims[id].health;
    sim.timer = _153.rb_sims[id].timer;
    sim.meta = _153.rb_sims[id].meta;
    sim.fire_end_time_ms = _153.rb_sims[id].fire_end_time_ms;
    sim.shock_end_time_ms = _153.rb_sims[id].shock_end_time_ms;
    sim.slow_end_time_ms = _153.rb_sims[id].slow_end_time_ms;
    sim.speed_factor_i = _153.rb_sims[id].speed_factor_i;
    if (sim.health <= 0)
    {
        uint param = sim.meta;
        uint param_1 = 1u;
        rb_clear_flags(param, param_1);
        sim.meta = param;
        if (_191.rb_tmps[id].grid_index >= 0)
        {
            _203.grid_bodies[_191.rb_tmps[id].grid_index].sim_meta = sim.meta;
        }
        _153.rb_sims[id].meta = sim.meta;
    }
    uint param_2 = sim.meta;
    uint param_3 = 58u;
    if (rb_is_in_layer(param_2, param_3))
    {
        float lifetime_before = sim.lifetime;
        sim.lifetime -= pc.dt;
        if (sim.lifetime <= 0.0)
        {
            uint param_4 = sim.meta;
            uint param_5 = 1u;
            rb_clear_flags(param_4, param_5);
            sim.meta = param_4;
        }
        _153.rb_sims[id].lifetime = sim.lifetime;
        _153.rb_sims[id].health = sim.health;
        _153.rb_sims[id].timer = sim.timer;
        _153.rb_sims[id].meta = sim.meta;
        _153.rb_sims[id].fire_end_time_ms = sim.fire_end_time_ms;
        _153.rb_sims[id].shock_end_time_ms = sim.shock_end_time_ms;
        _153.rb_sims[id].slow_end_time_ms = sim.slow_end_time_ms;
        _153.rb_sims[id].speed_factor_i = sim.speed_factor_i;
        uint param_6 = sim.meta;
        uint param_7 = 32u;
        bool is_grenade = rb_is_in_layer(param_6, param_7);
        if (is_grenade)
        {
            float grenade_slow_spawn_rate = 3.0;
            float before = ceil(lifetime_before * grenade_slow_spawn_rate);
            float after = ceil(sim.lifetime * grenade_slow_spawn_rate);
            if (before > after)
            {
                uint _298 = atomicAdd(_138.rb_addition_count, 1u);
                uint addition_id = _298;
                if (addition_id >= 8192u)
                {
                    return;
                }
                RB_Init init = construct_RB_Init();
                init.position = _311.rb_physics[id].position;
                uint param_8 = init.sim_meta;
                uint param_9 = 1u;
                rb_set_flags(param_8, param_9);
                init.sim_meta = param_8;
                uint param_10 = init.physics_meta;
                uint param_11 = 1u;
                rb_set_sensor_mask(param_10, param_11);
                init.physics_meta = param_10;
                if (after > 0.0)
                {
                    init.radius = pc.grenade_slow_radius;
                    init.health = 1.0;
                    init.lifetime = 0.5;
                    uint param_12 = init.physics_meta;
                    uint param_13 = init.sim_meta;
                    uint param_14 = 8u;
                    rb_set_layer_mask(param_12, param_13, param_14);
                    init.physics_meta = param_12;
                    init.sim_meta = param_13;
                    uint param_15 = init.physics_meta;
                    uint param_16 = 1u;
                    rb_set_sensor_mask(param_15, param_16);
                    init.physics_meta = param_15;
                    init.ch_slow_timer = pc.grenade_slow_duration;
                }
                else
                {
                    bool _367 = after <= 0.0;
                    bool _373;
                    if (_367)
                    {
                        _373 = pc.grenade_explosion_damage > 0.0;
                    }
                    else
                    {
                        _373 = _367;
                    }
                    if (_373)
                    {
                        init.radius = pc.grenade_explosion_radius;
                        init.inv_mass = pc.grenade_explosion_inv_mass;
                        uint param_17 = init.physics_meta;
                        uint param_18 = init.sim_meta;
                        uint param_19 = 4u;
                        rb_set_layer_mask(param_17, param_18, param_19);
                        init.physics_meta = param_17;
                        init.sim_meta = param_18;
                        init.ch_damage_other = pc.grenade_explosion_damage;
                        init.ch_damage_falloff = 1.0;
                        init.ch_damage_report_id = pc.grenade_damage_report_id;
                    }
                }
                _407.rb_additions[addition_id].position = init.position;
                _407.rb_additions[addition_id].velocity = init.velocity;
                _407.rb_additions[addition_id].radius = init.radius;
                _407.rb_additions[addition_id].inv_mass = init.inv_mass;
                _407.rb_additions[addition_id].health = init.health;
                _407.rb_additions[addition_id].lifetime = init.lifetime;
                _407.rb_additions[addition_id].physics_meta = init.physics_meta;
                _407.rb_additions[addition_id].sim_meta = init.sim_meta;
                _407.rb_additions[addition_id]._padding_0 = init._padding_0;
                _407.rb_additions[addition_id]._padding_1 = init._padding_1;
                _407.rb_additions[addition_id].ch_damage_self = init.ch_damage_self;
                _407.rb_additions[addition_id].ch_damage_other = init.ch_damage_other;
                _407.rb_additions[addition_id].ch_damage_falloff = init.ch_damage_falloff;
                _407.rb_additions[addition_id].ch_fire_timer = init.ch_fire_timer;
                _407.rb_additions[addition_id].ch_flags = init.ch_flags;
                _407.rb_additions[addition_id].ch_chaining = init.ch_chaining;
                _407.rb_additions[addition_id].ch_damage_report_id = init.ch_damage_report_id;
                _407.rb_additions[addition_id].ch_slow_timer = init.ch_slow_timer;
            }
        }
    }
}
