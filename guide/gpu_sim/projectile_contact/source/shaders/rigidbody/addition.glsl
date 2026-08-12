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

struct Explosion
{
    vec2 position;
    float radius;
    float lifetime;
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

struct RB_Tmp
{
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
};

struct Lightning
{
    vec2 start;
    vec2 end;
    float lifetime;
    float _padding_0;
    float _padding_1;
    float _padding_2;
};

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _36;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _70;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _153;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _204;

layout(set = 3, binding = 0, std430) buffer ExplosionCounts
{
    int explosion_active_count;
    int explosion_inactive_count;
    uint _explosion_padding0;
    uint _explosion_padding1;
    uint explosion_ids[];
} _238;

layout(set = 3, binding = 1, std430) buffer ExplosionBuffer
{
    Explosion explosions[];
} _273;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _315;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _342;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _358;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _363;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _367;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _371;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _375;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _380;

layout(set = 3, binding = 2, std430) buffer LightningCounts
{
    int lightning_active_count;
    int lightning_inactive_count;
    uint _lightning_padding0;
    uint _lightning_padding1;
    uint lightning_ids[];
} _385;

layout(set = 3, binding = 3, std430) buffer LightningBuffer
{
    Lightning lightnings[];
} _390;

layout(push_constant, std430) uniform PushConstants
{
    uint time_ms;
} pc;

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

void main()
{
    uint addition_id = gl_GlobalInvocationID.x;
    uint addition_count = min(_36.rb_addition_count, 8192u);
    if (addition_id >= addition_count)
    {
        return;
    }
    uint _52 = atomicAdd(_36.rb_count, 1u);
    uint id = _52;
    if (id >= 262144u)
    {
        uint _59 = atomicMin(_36.rb_count, 262144u);
        return;
    }
    RB_Init init;
    init.position = _70.rb_additions[addition_id].position;
    init.velocity = _70.rb_additions[addition_id].velocity;
    init.radius = _70.rb_additions[addition_id].radius;
    init.inv_mass = _70.rb_additions[addition_id].inv_mass;
    init.health = _70.rb_additions[addition_id].health;
    init.lifetime = _70.rb_additions[addition_id].lifetime;
    init.physics_meta = _70.rb_additions[addition_id].physics_meta;
    init.sim_meta = _70.rb_additions[addition_id].sim_meta;
    init._padding_0 = _70.rb_additions[addition_id]._padding_0;
    init._padding_1 = _70.rb_additions[addition_id]._padding_1;
    init.ch_damage_self = _70.rb_additions[addition_id].ch_damage_self;
    init.ch_damage_other = _70.rb_additions[addition_id].ch_damage_other;
    init.ch_damage_falloff = _70.rb_additions[addition_id].ch_damage_falloff;
    init.ch_fire_timer = _70.rb_additions[addition_id].ch_fire_timer;
    init.ch_flags = _70.rb_additions[addition_id].ch_flags;
    init.ch_chaining = _70.rb_additions[addition_id].ch_chaining;
    init.ch_damage_report_id = _70.rb_additions[addition_id].ch_damage_report_id;
    init.ch_slow_timer = _70.rb_additions[addition_id].ch_slow_timer;
    RB_Physics physics;
    physics.position = init.position;
    physics.velocity = init.velocity;
    physics.radius = init.radius;
    physics.inv_mass = init.inv_mass;
    physics.meta = init.physics_meta;
    physics.freeze_end_time_ms = 0u;
    _153.rb_physics[id].position = physics.position;
    _153.rb_physics[id].velocity = physics.velocity;
    _153.rb_physics[id].radius = physics.radius;
    _153.rb_physics[id].inv_mass = physics.inv_mass;
    _153.rb_physics[id].meta = physics.meta;
    _153.rb_physics[id].freeze_end_time_ms = physics.freeze_end_time_ms;
    RB_Sim sim;
    sim.health = int(init.health * 100.0);
    sim.lifetime = init.lifetime;
    sim.timer = 0u | (pc.time_ms & 268435455u);
    sim.meta = init.sim_meta;
    sim.fire_end_time_ms = 0u;
    sim.shock_end_time_ms = 0u;
    sim.slow_end_time_ms = 0u;
    _204.rb_sims[id].lifetime = sim.lifetime;
    _204.rb_sims[id].health = sim.health;
    _204.rb_sims[id].timer = sim.timer;
    _204.rb_sims[id].meta = sim.meta;
    _204.rb_sims[id].fire_end_time_ms = sim.fire_end_time_ms;
    _204.rb_sims[id].shock_end_time_ms = sim.shock_end_time_ms;
    _204.rb_sims[id].slow_end_time_ms = sim.slow_end_time_ms;
    _204.rb_sims[id].speed_factor_i = sim.speed_factor_i;
    uint param = sim.meta;
    uint param_1 = 4u;
    if (rb_is_in_layer(param, param_1))
    {
        int _241 = atomicAdd(_238.explosion_inactive_count, -1);
        int explosion_inactive_index = _241;
        uint explosion_id = 4096u;
        if (explosion_inactive_index >= 1)
        {
            explosion_id = _238.explosion_ids[(4096u + uint(explosion_inactive_index)) - 1u];
        }
        if (explosion_id < 4096u)
        {
            Explosion explosion;
            explosion.position = init.position;
            explosion.radius = init.radius;
            explosion.lifetime = 0.20000000298023223876953125;
            _273.explosions[explosion_id].position = explosion.position;
            _273.explosions[explosion_id].radius = explosion.radius;
            _273.explosions[explosion_id].lifetime = explosion.lifetime;
        }
    }
    RB_ContactHandler handler;
    handler.damage_self = init.ch_damage_self;
    handler.damage_other = init.ch_damage_other;
    handler.damage_falloff = init.ch_damage_falloff;
    handler.fire_timer = init.ch_fire_timer;
    handler.flags = init.ch_flags;
    handler.chaining = init.ch_chaining;
    handler.damage_report_id = init.ch_damage_report_id;
    handler.slow_timer = init.ch_slow_timer;
    _315.rb_contact_handlers[id].damage_self = handler.damage_self;
    _315.rb_contact_handlers[id].damage_other = handler.damage_other;
    _315.rb_contact_handlers[id].damage_falloff = handler.damage_falloff;
    _315.rb_contact_handlers[id].fire_timer = handler.fire_timer;
    _315.rb_contact_handlers[id].flags = handler.flags;
    _315.rb_contact_handlers[id].chaining = handler.chaining;
    _315.rb_contact_handlers[id].damage_report_id = handler.damage_report_id;
    _315.rb_contact_handlers[id].slow_timer = handler.slow_timer;
}
