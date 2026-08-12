#[compute]
#version 450


layout(local_size_x = 256, local_size_y = 1, local_size_z = 1) in;

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

struct Contact
{
    vec2 world_pos;
    int self_id;
    int other_id;
};

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _67;

layout(set = 0, binding = 0, std430) buffer RB_Counts
{
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
} _116;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _131;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _184;

layout(set = 2, binding = 4, std430) buffer ContactHandlerDamageReadback
{
    uint write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    int data[];
} contact_handler_damage_readback;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _615;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _688;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _694;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _699;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _704;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _708;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _712;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _716;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _720;

layout(set = 1, binding = 3, std430) buffer WorldGridCellCounts
{
    uint grid_cell_counts[];
} _725;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _730;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _734;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _738;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _742;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _746;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _751;

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _755;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _760;

layout(push_constant, std430) uniform PushConstants
{
    vec2 world_size;
    float dt;
    uint time_ms;
    uint fire_ticks;
    float fire_tick_damage;
    float flow_speed;
    int fire_damage_report_id;
    float confusion_factor;
    float fire_damage_multiplier;
    float slow_damage_multiplier;
    float unfreeze_damage;
    int cryo_beam_damage_report_id;
} pc;

layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;
layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;

bool rb_is_in_layer(uint meta, uint layer_mask)
{
    return (((meta >> uint(0)) & 255u) & layer_mask) != 0u;
}

void rb_deal_damage(float damage, uint id, uint time_ms, out int dealt_damage_i, out bool is_dead)
{
    if (damage <= 0.0)
    {
        dealt_damage_i = 0;
        is_dead = false;
        return;
    }
    int damage_i = int(damage * 100.0);
    int _75 = atomicAdd(_67.rb_sims[id].health, -damage_i);
    int health_before = _75;
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
        _67.rb_sims[id].timer = timer;
    }
    dealt_damage_i = min(health_before, damage_i);
    is_dead = health_after <= 0;
}

void rb_clear_flags(inout uint sim_meta, uint flags)
{
    sim_meta &= (~((flags & 255u) << uint(8)));
}

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _116.rb_count)
    {
        return;
    }
    RB_Physics physics;
    physics.position = _131.rb_physics[id].position;
    physics.velocity = _131.rb_physics[id].velocity;
    physics.radius = _131.rb_physics[id].radius;
    physics.inv_mass = _131.rb_physics[id].inv_mass;
    physics.meta = _131.rb_physics[id].meta;
    physics.freeze_end_time_ms = _131.rb_physics[id].freeze_end_time_ms;
    RB_Sim sim;
    sim.lifetime = _67.rb_sims[id].lifetime;
    sim.health = _67.rb_sims[id].health;
    sim.timer = _67.rb_sims[id].timer;
    sim.meta = _67.rb_sims[id].meta;
    sim.fire_end_time_ms = _67.rb_sims[id].fire_end_time_ms;
    sim.shock_end_time_ms = _67.rb_sims[id].shock_end_time_ms;
    sim.slow_end_time_ms = _67.rb_sims[id].slow_end_time_ms;
    sim.speed_factor_i = _67.rb_sims[id].speed_factor_i;
    RB_Tmp tmp;
    tmp.previous_position = _184.rb_tmps[id].previous_position;
    tmp.predicted_position = _184.rb_tmps[id].predicted_position;
    tmp.position_delta = _184.rb_tmps[id].position_delta;
    tmp.grid_index = _184.rb_tmps[id].grid_index;
    tmp._padding_0 = _184.rb_tmps[id]._padding_0;
    vec2 p = physics.position;
    tmp.previous_position = p;
    vec2 v = physics.velocity;
    uint param = sim.meta;
    uint param_1 = 1u;
    if (rb_is_in_layer(param, param_1))
    {
        vec2 uv = p / pc.world_size;
        bool _226 = uv.x >= 0.0;
        bool _233;
        if (_226)
        {
            _233 = uv.x < 1.0;
        }
        else
        {
            _233 = _226;
        }
        bool _239;
        if (_233)
        {
            _239 = uv.y >= 0.0;
        }
        else
        {
            _239 = _233;
        }
        bool _245;
        if (_239)
        {
            _245 = uv.y < 1.0;
        }
        else
        {
            _245 = _239;
        }
        bool is_in_world = _245;
        vec2 to_center = normalize(vec2(0.5) - uv);
        uv = clamp(uv, vec2(0.0), vec2(1.0));
        vec4 flow = textureLod(world_flow_tex, uv, 0.0);
        bool _270 = abs(flow.x) < 9.9999999747524270787835121154785e-07;
        bool _277;
        if (_270)
        {
            _277 = abs(flow.y) < 9.9999999747524270787835121154785e-07;
        }
        else
        {
            _277 = _270;
        }
        if (_277)
        {
            flow.x = to_center.x;
            flow.y = to_center.y;
        }
        vec4 _285 = flow;
        vec2 _287 = normalize(_285.xy);
        flow.x = _287.x;
        flow.y = _287.y;
        int time_i = int(pc.time_ms);
        float fire_diff = float(int(sim.fire_end_time_ms) - time_i) * 0.001000000047497451305389404296875;
        float shock_diff = float(int(sim.shock_end_time_ms) - time_i) * 0.001000000047497451305389404296875;
        float slow_diff = float(int(sim.slow_end_time_ms) - time_i) * 0.001000000047497451305389404296875;
        float shock_factor = step(0.0, shock_diff);
        float slow_factor = smoothstep(0.0, 0.100000001490116119384765625, slow_diff);
        float speed_factor = mix(1.0, float(sim.speed_factor_i) / 1000.0, slow_factor);
        float confusion = shock_factor * pc.confusion_factor;
        if (confusion > 0.5)
        {
            vec4 _347 = flow;
            vec2 _349 = -_347.xy;
            flow.x = _349.x;
            flow.y = _349.y;
        }
        float out_of_world_factor = is_in_world ? 0.0 : 1.0;
        float fast_rotation_factor = min(confusion + out_of_world_factor, 1.0);
        float max_speed = pc.flow_speed * speed_factor;
        bool is_frozen = physics.freeze_end_time_ms > pc.time_ms;
        if (is_frozen)
        {
            max_speed = 0.00999999977648258209228515625;
        }
        float adjustment_factor = min(1.0 * pc.dt, 1.0);
        vec2 v_new = mix(v, flow.xy * max_speed, vec2(adjustment_factor));
        float speed = length(v_new);
        if (speed > max_speed)
        {
            v_new = (v_new / vec2(speed)) * max_speed;
        }
        v = v_new;
        bool _411 = (physics.freeze_end_time_ms > 0u) && (!is_frozen);
        bool _424;
        if (_411)
        {
            _424 = int(physics.freeze_end_time_ms) > (time_i - int(pc.dt * 1000.0));
        }
        else
        {
            _424 = _411;
        }
        if (_424)
        {
            float _430;
            if (fire_diff > 0.0)
            {
                _430 = pc.fire_damage_multiplier;
            }
            else
            {
                _430 = 1.0;
            }
            float _439;
            if (slow_diff > 0.0)
            {
                _439 = pc.slow_damage_multiplier;
            }
            else
            {
                _439 = 1.0;
            }
            float multi = _430 * _439;
            float damage = pc.unfreeze_damage * multi;
            int dealt_damage_i = 0;
            bool is_dead = false;
            float param_2 = damage;
            uint param_3 = id;
            uint param_4 = pc.time_ms;
            int param_5;
            bool param_6;
            rb_deal_damage(param_2, param_3, param_4, param_5, param_6);
            dealt_damage_i = param_5;
            is_dead = param_6;
            sim.lifetime = _67.rb_sims[id].lifetime;
            sim.health = _67.rb_sims[id].health;
            sim.timer = _67.rb_sims[id].timer;
            sim.meta = _67.rb_sims[id].meta;
            sim.fire_end_time_ms = _67.rb_sims[id].fire_end_time_ms;
            sim.shock_end_time_ms = _67.rb_sims[id].shock_end_time_ms;
            sim.slow_end_time_ms = _67.rb_sims[id].slow_end_time_ms;
            sim.speed_factor_i = _67.rb_sims[id].speed_factor_i;
            if (dealt_damage_i > 0)
            {
                uint buffer_index = contact_handler_damage_readback.write_index;
                uint write_index = (buffer_index * 32u) + uint(pc.cryo_beam_damage_report_id);
                int _511 = atomicAdd(contact_handler_damage_readback.data[write_index], dealt_damage_i);
            }
        }
        if ((pc.fire_ticks > 0u) && (fire_diff > 0.0))
        {
            int dealt_damage_i_1 = 0;
            bool is_dead_1 = false;
            float _527;
            if (slow_diff > 0.0)
            {
                _527 = pc.slow_damage_multiplier;
            }
            else
            {
                _527 = 1.0;
            }
            float multi_1 = pc.fire_damage_multiplier * _527;
            float damage_1 = (pc.fire_tick_damage * float(pc.fire_ticks)) * multi_1;
            float param_7 = damage_1;
            uint param_8 = id;
            uint param_9 = pc.time_ms;
            int param_10;
            bool param_11;
            rb_deal_damage(param_7, param_8, param_9, param_10, param_11);
            dealt_damage_i_1 = param_10;
            is_dead_1 = param_11;
            sim.lifetime = _67.rb_sims[id].lifetime;
            sim.health = _67.rb_sims[id].health;
            sim.timer = _67.rb_sims[id].timer;
            sim.meta = _67.rb_sims[id].meta;
            sim.fire_end_time_ms = _67.rb_sims[id].fire_end_time_ms;
            sim.shock_end_time_ms = _67.rb_sims[id].shock_end_time_ms;
            sim.slow_end_time_ms = _67.rb_sims[id].slow_end_time_ms;
            sim.speed_factor_i = _67.rb_sims[id].speed_factor_i;
            if (dealt_damage_i_1 > 0)
            {
                uint buffer_index_1 = contact_handler_damage_readback.write_index;
                uint write_index_1 = (buffer_index_1 * 32u) + uint(pc.fire_damage_report_id);
                int _592 = atomicAdd(contact_handler_damage_readback.data[write_index_1], dealt_damage_i_1);
            }
        }
        if (flow.z >= 0.5)
        {
            uint param_12 = sim.meta;
            uint param_13 = 5u;
            rb_clear_flags(param_12, param_13);
            sim.meta = param_12;
            _67.rb_sims[id].meta = sim.meta;
            int write_index_2 = _615.world_base_damage_readback[0];
            int _621 = atomicAdd(_615.world_base_damage_readback[write_index_2 + 1], 1);
        }
    }
    float _625;
    if (isnan(v.x))
    {
        _625 = 0.0;
    }
    else
    {
        _625 = v.x;
    }
    v.x = _625;
    float _636;
    if (isnan(v.y))
    {
        _636 = 0.0;
    }
    else
    {
        _636 = v.y;
    }
    v.y = _636;
    float inv_mass = physics.inv_mass;
    if (inv_mass > 9.9999999747524270787835121154785e-07)
    {
        p += (v * pc.dt);
    }
    tmp.predicted_position = p;
    _184.rb_tmps[id].previous_position = tmp.previous_position;
    _184.rb_tmps[id].predicted_position = tmp.predicted_position;
    _184.rb_tmps[id].position_delta = tmp.position_delta;
    _184.rb_tmps[id].grid_index = tmp.grid_index;
    _184.rb_tmps[id]._padding_0 = tmp._padding_0;
}
