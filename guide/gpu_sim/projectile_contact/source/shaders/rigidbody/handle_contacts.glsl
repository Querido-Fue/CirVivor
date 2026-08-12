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

struct Contact
{
    vec2 world_pos;
    int self_id;
    int other_id;
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

struct RB_Physics
{
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    uint meta;
    uint freeze_end_time_ms;
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

struct RB_Tmp
{
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
};

struct Explosion
{
    vec2 position;
    float radius;
    float lifetime;
};

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _89;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _209;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _225;

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _245;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _296;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _377;

layout(set = 2, binding = 4, std430) buffer ContactHandlerDamageReadback
{
    uint write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    int data[];
} contact_handler_damage_readback;

layout(set = 3, binding = 2, std430) buffer LightningCounts
{
    int lightning_active_count;
    int lightning_inactive_count;
    uint _lightning_padding0;
    uint _lightning_padding1;
    uint lightning_ids[];
} _487;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _513;

layout(set = 3, binding = 3, std430) buffer LightningBuffer
{
    Lightning lightnings[];
} _528;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _724;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _831;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _836;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _840;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _844;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _848;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _853;

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _857;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _862;

layout(set = 3, binding = 0, std430) buffer ExplosionCounts
{
    int explosion_active_count;
    int explosion_inactive_count;
    uint _explosion_padding0;
    uint _explosion_padding1;
    uint explosion_ids[];
} _867;

layout(set = 3, binding = 1, std430) buffer ExplosionBuffer
{
    Explosion explosions[];
} _872;

layout(push_constant, std430) uniform PushConstants
{
    uint time_ms;
    float fire_free_penetration_chance;
    float shock_duration;
    float fire_damage_multiplier;
    float slow_damage_multiplier;
    float grenade_slow_factor;
    float missile_slow_factor;
} pc;

void rb_deal_damage(float damage, uint id, uint time_ms, out int dealt_damage_i, out bool is_dead)
{
    if (damage <= 0.0)
    {
        dealt_damage_i = 0;
        is_dead = false;
        return;
    }
    int damage_i = int(damage * 100.0);
    int _97 = atomicAdd(_89.rb_sims[id].health, -damage_i);
    int health_before = _97;
    if (health_before <= 0)
    {
        dealt_damage_i = 0;
        is_dead = true;
        return;
    }
    int health_after = health_before - damage_i;
    if (time_ms > 0u)
    {
        uint timer = 268435456u | (time_ms & 268435455u);
        _89.rb_sims[id].timer = timer;
    }
    dealt_damage_i = min(health_before, damage_i);
    is_dead = health_after <= 0;
}

bool contact_handler_has_flags(uint handler_flags, uint flags)
{
    return (handler_flags & flags) == flags;
}

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

void rb_clear_flags(inout uint sim_meta, uint flags)
{
    sim_meta &= (~((flags & 255u) << uint(8)));
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

float hash(inout uint x)
{
    x ^= (x >> uint(16));
    x *= 2146121005u;
    x ^= (x >> uint(15));
    x *= 2221713035u;
    x ^= (x >> uint(16));
    return float(x) / 4294967296.0;
}

void main()
{
    uint contact_id = gl_GlobalInvocationID.x;
    if (contact_id >= min(_209.contact_count, 32768u))
    {
        return;
    }
    Contact contact;
    contact.world_pos = _225.contacts[contact_id].world_pos;
    contact.self_id = _225.contacts[contact_id].self_id;
    contact.other_id = _225.contacts[contact_id].other_id;
    int self_id = contact.self_id;
    int other_id = contact.other_id;
    int rb_count_i = int(_245.rb_count);
    if ((((self_id == other_id) || (self_id < 0)) || (self_id >= rb_count_i)) || (other_id >= rb_count_i))
    {
        return;
    }
    RB_Sim sim_self;
    sim_self.lifetime = _89.rb_sims[self_id].lifetime;
    sim_self.health = _89.rb_sims[self_id].health;
    sim_self.timer = _89.rb_sims[self_id].timer;
    sim_self.meta = _89.rb_sims[self_id].meta;
    sim_self.fire_end_time_ms = _89.rb_sims[self_id].fire_end_time_ms;
    sim_self.shock_end_time_ms = _89.rb_sims[self_id].shock_end_time_ms;
    sim_self.slow_end_time_ms = _89.rb_sims[self_id].slow_end_time_ms;
    sim_self.speed_factor_i = _89.rb_sims[self_id].speed_factor_i;
    RB_ContactHandler handler;
    handler.damage_self = _296.rb_contact_handlers[self_id].damage_self;
    handler.damage_other = _296.rb_contact_handlers[self_id].damage_other;
    handler.damage_falloff = _296.rb_contact_handlers[self_id].damage_falloff;
    handler.fire_timer = _296.rb_contact_handlers[self_id].fire_timer;
    handler.flags = _296.rb_contact_handlers[self_id].flags;
    handler.chaining = _296.rb_contact_handlers[self_id].chaining;
    handler.damage_report_id = _296.rb_contact_handlers[self_id].damage_report_id;
    handler.slow_timer = _296.rb_contact_handlers[self_id].slow_timer;
    int dealt_damage_i = 0;
    if (other_id >= 0)
    {
        if (handler.damage_other > 0.0)
        {
            bool other_is_on_fire = _89.rb_sims[other_id].fire_end_time_ms > pc.time_ms;
            bool other_is_slowed = _89.rb_sims[other_id].slow_end_time_ms > pc.time_ms;
            float multi = 1.0;
            if (other_is_on_fire)
            {
                multi *= pc.fire_damage_multiplier;
            }
            if (other_is_slowed)
            {
                multi *= pc.slow_damage_multiplier;
            }
            float damage = handler.damage_other * multi;
            if (handler.damage_falloff > 0.0)
            {
                float self_radius = _377.rb_physics[self_id].radius;
                vec2 self_pos = _377.rb_physics[self_id].position;
                vec2 delta = contact.world_pos - self_pos;
                float dist = length(delta);
                float t = clamp(dist / self_radius, 0.0, 1.0);
                float falloff = 1.0 - pow(t, handler.damage_falloff);
                damage *= falloff;
            }
            bool other_is_dead = false;
            float param = damage;
            uint param_1 = uint(other_id);
            uint param_2 = pc.time_ms;
            int param_3;
            bool param_4;
            rb_deal_damage(param, param_1, param_2, param_3, param_4);
            dealt_damage_i = param_3;
            other_is_dead = param_4;
            bool _424 = dealt_damage_i > 0;
            bool _430;
            if (_424)
            {
                _430 = handler.damage_report_id >= 0;
            }
            else
            {
                _430 = _424;
            }
            bool _438;
            if (_430)
            {
                _438 = uint(handler.damage_report_id) < 32u;
            }
            else
            {
                _438 = _430;
            }
            if (_438)
            {
                uint buffer_index = contact_handler_damage_readback.write_index;
                uint write_index = (buffer_index * 32u) + uint(handler.damage_report_id);
                int _458 = atomicAdd(contact_handler_damage_readback.data[write_index], dealt_damage_i);
            }
            bool _460 = dealt_damage_i > 0;
            bool _469;
            if (_460)
            {
                uint param_5 = handler.flags;
                uint param_6 = 2u;
                _469 = contact_handler_has_flags(param_5, param_6);
            }
            else
            {
                _469 = _460;
            }
            if (_469)
            {
                uint _482 = atomicMax(_89.rb_sims[other_id].shock_end_time_ms, pc.time_ms + uint(pc.shock_duration * 1000.0));
                int _489 = atomicAdd(_487.lightning_inactive_count, -1);
                int lightning_inactive_index = _489;
                uint lightning_id = 4096u;
                if (lightning_inactive_index >= 1)
                {
                    lightning_id = _487.lightning_ids[(4096u + uint(lightning_inactive_index)) - 1u];
                }
                if (lightning_id < 4096u)
                {
                    Lightning lightning;
                    lightning.start = _513.rb_tmps[self_id].predicted_position;
                    lightning.end = _513.rb_tmps[other_id].predicted_position;
                    lightning.lifetime = 0.5;
                    _528.lightnings[lightning_id].start = lightning.start;
                    _528.lightnings[lightning_id].end = lightning.end;
                    _528.lightnings[lightning_id].lifetime = lightning.lifetime;
                    _528.lightnings[lightning_id]._padding_0 = lightning._padding_0;
                    _528.lightnings[lightning_id]._padding_1 = lightning._padding_1;
                    _528.lightnings[lightning_id]._padding_2 = lightning._padding_2;
                }
            }
        }
        if (handler.fire_timer > 0.0)
        {
            uint fire_end_time_ms = pc.time_ms + uint(handler.fire_timer * 1000.0);
            uint _561 = atomicMax(_89.rb_sims[other_id].fire_end_time_ms, fire_end_time_ms);
        }
        if (handler.slow_timer > 0.0)
        {
            uint slow_end_time_ms = pc.time_ms + uint(handler.slow_timer * 1000.0);
            if (handler.damage_report_id == 19)
            {
                uint _584 = atomicMax(_377.rb_physics[other_id].freeze_end_time_ms, slow_end_time_ms);
            }
            else
            {
                uint _590 = atomicMax(_89.rb_sims[other_id].slow_end_time_ms, slow_end_time_ms);
                uint before = _590;
                if (before < slow_end_time_ms)
                {
                    uint param_7 = sim_self.meta;
                    uint param_8 = 8u;
                    float _603;
                    if (rb_is_in_layer(param_7, param_8))
                    {
                        _603 = pc.grenade_slow_factor;
                    }
                    else
                    {
                        _603 = pc.missile_slow_factor;
                    }
                    float slow_factor = _603;
                    _89.rb_sims[other_id].speed_factor_i = uint(slow_factor * 1000.0);
                }
            }
        }
    }
    else
    {
        if (other_id == (-1))
        {
            uint param_9 = handler.flags;
            uint param_10 = 1u;
            if (contact_handler_has_flags(param_9, param_10))
            {
                uint param_11 = sim_self.meta;
                uint param_12 = 1u;
                rb_clear_flags(param_11, param_12);
                sim_self.meta = param_11;
                _89.rb_sims[self_id].meta = sim_self.meta;
            }
        }
    }
    if (dealt_damage_i > 0)
    {
        if (handler.chaining > 0)
        {
            uint _651 = atomicAdd(_245.rb_addition_count, 1u);
            uint addition_id = _651;
            if (addition_id < 8192u)
            {
                RB_Physics self_physics;
                self_physics.position = _377.rb_physics[self_id].position;
                self_physics.velocity = _377.rb_physics[self_id].velocity;
                self_physics.radius = _377.rb_physics[self_id].radius;
                self_physics.inv_mass = _377.rb_physics[self_id].inv_mass;
                self_physics.meta = _377.rb_physics[self_id].meta;
                self_physics.freeze_end_time_ms = _377.rb_physics[self_id].freeze_end_time_ms;
                RB_Init init = construct_RB_Init();
                init.position = _513.rb_tmps[other_id].predicted_position;
                init.radius = self_physics.radius;
                init.inv_mass = self_physics.inv_mass;
                init.physics_meta = self_physics.meta;
                init.sim_meta = sim_self.meta;
                uint param_13 = init.sim_meta;
                uint param_14 = 1u;
                rb_set_flags(param_13, param_14);
                init.sim_meta = param_13;
                init.ch_damage_other = handler.damage_other;
                init.ch_damage_falloff = handler.damage_falloff;
                init.ch_flags = handler.flags;
                init.ch_damage_report_id = handler.damage_report_id;
                init.ch_chaining = handler.chaining - 1;
                init.ch_slow_timer = handler.slow_timer;
                _724.rb_additions[addition_id].position = init.position;
                _724.rb_additions[addition_id].velocity = init.velocity;
                _724.rb_additions[addition_id].radius = init.radius;
                _724.rb_additions[addition_id].inv_mass = init.inv_mass;
                _724.rb_additions[addition_id].health = init.health;
                _724.rb_additions[addition_id].lifetime = init.lifetime;
                _724.rb_additions[addition_id].physics_meta = init.physics_meta;
                _724.rb_additions[addition_id].sim_meta = init.sim_meta;
                _724.rb_additions[addition_id]._padding_0 = init._padding_0;
                _724.rb_additions[addition_id]._padding_1 = init._padding_1;
                _724.rb_additions[addition_id].ch_damage_self = init.ch_damage_self;
                _724.rb_additions[addition_id].ch_damage_other = init.ch_damage_other;
                _724.rb_additions[addition_id].ch_damage_falloff = init.ch_damage_falloff;
                _724.rb_additions[addition_id].ch_fire_timer = init.ch_fire_timer;
                _724.rb_additions[addition_id].ch_flags = init.ch_flags;
                _724.rb_additions[addition_id].ch_chaining = init.ch_chaining;
                _724.rb_additions[addition_id].ch_damage_report_id = init.ch_damage_report_id;
                _724.rb_additions[addition_id].ch_slow_timer = init.ch_slow_timer;
            }
        }
        if (handler.damage_self > 0.0)
        {
            bool should_deal_self_damage = true;
            if (pc.fire_free_penetration_chance > 0.0)
            {
                bool is_other_burning = _89.rb_sims[other_id].fire_end_time_ms > pc.time_ms;
                uint param_15 = (uint(self_id) ^ uint(other_id)) ^ contact_id;
                float _792 = hash(param_15);
                float rand = _792;
                if (rand < pc.fire_free_penetration_chance)
                {
                    should_deal_self_damage = false;
                }
            }
            if (should_deal_self_damage)
            {
                int self_dealt_damage_i = 0;
                bool self_is_dead = false;
                float param_16 = handler.damage_self;
                uint param_17 = uint(self_id);
                uint param_18 = 0u;
                int param_19;
                bool param_20;
                rb_deal_damage(param_16, param_17, param_18, param_19, param_20);
                self_dealt_damage_i = param_19;
                self_is_dead = param_20;
            }
        }
    }
}
