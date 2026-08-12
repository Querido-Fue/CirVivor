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
} _19;

layout(set = 0, binding = 3, std430) buffer RB_TmpBuffer
{
    RB_Tmp rb_tmps[];
} _39;

layout(set = 0, binding = 1, std430) buffer RB_PhysicsBuffer
{
    RB_Physics rb_physics[];
} _119;

layout(set = 0, binding = 2, std430) buffer RB_SimBuffer
{
    RB_Sim rb_sims[];
} _153;

layout(set = 1, binding = 3, std430) buffer WorldGridCellCounts
{
    uint grid_cell_counts[];
} _195;

layout(set = 1, binding = 4, std430) buffer WorldGridBodyData
{
    WorldGridBody grid_bodies[];
} _217;

layout(set = 0, binding = 4, std430) buffer RB_ContactHandlers
{
    RB_ContactHandler rb_contact_handlers[];
} _382;

layout(set = 0, binding = 5, std430) buffer RB_Additions
{
    RB_Init rb_additions[];
} _388;

layout(set = 0, binding = 6, std430) buffer RB_Removals
{
    uint rb_removals[];
} _393;

layout(set = 0, binding = 7, std430) buffer RigidbodyEnemiesKilledReadback
{
    uint body_enemies_killed_readback[];
} _398;

layout(set = 0, binding = 8, std430) buffer RigidbodyEnemiesAliveReadback
{
    uint body_enemies_alive_readback[];
} _402;

layout(set = 0, binding = 9, std430) buffer RB_TypeCounts
{
    uint rb_type_counts[];
} _406;

layout(set = 0, binding = 10, std430) buffer RB_TypeIDs
{
    uint rb_type_ids[];
} _410;

layout(set = 0, binding = 11, std430) buffer RB_LaserSegments
{
    vec4 rb_laser_segments[];
} _415;

layout(set = 1, binding = 2, std430) buffer WorldBaseDamageReadback
{
    int world_base_damage_readback[];
} _424;

layout(set = 1, binding = 5, std430) buffer WorldGridLaserCounts
{
    uint grid_laser_counts[];
} _428;

layout(set = 1, binding = 6, std430) buffer WorldGridLaserSegments
{
    vec4 grid_laser_segments[];
} _432;

layout(set = 1, binding = 7, std430) buffer WorldReadbackGrid
{
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    uint world_readback_grid_enemies_alive[];
} _436;

layout(push_constant, std430) uniform PushConstants
{
    uvec2 grid_cell_count;
    vec2 grid_cell_size;
    uint max_bodies_per_cell;
} pc;

layout(set = 1, binding = 0) uniform sampler2D world_sdf_tex;
layout(set = 1, binding = 1) uniform sampler2D world_flow_tex;

void main()
{
    uint id = gl_GlobalInvocationID.x;
    if (id >= _19.rb_count)
    {
        return;
    }
    RB_Tmp tmp;
    tmp.previous_position = _39.rb_tmps[id].previous_position;
    tmp.predicted_position = _39.rb_tmps[id].predicted_position;
    tmp.position_delta = _39.rb_tmps[id].position_delta;
    tmp.grid_index = _39.rb_tmps[id].grid_index;
    tmp._padding_0 = _39.rb_tmps[id]._padding_0;
    vec2 p = tmp.predicted_position;
    ivec2 ip = ivec2(floor(p / pc.grid_cell_size));
    bool _79 = ip.x < 0;
    bool _90;
    if (!_79)
    {
        _90 = uint(ip.x) >= pc.grid_cell_count.x;
    }
    else
    {
        _90 = _79;
    }
    bool _98;
    if (!_90)
    {
        _98 = ip.y < 0;
    }
    else
    {
        _98 = _90;
    }
    bool _108;
    if (!_98)
    {
        _108 = uint(ip.y) >= pc.grid_cell_count.y;
    }
    else
    {
        _108 = _98;
    }
    if (_108)
    {
        return;
    }
    RB_Physics physics;
    physics.position = _119.rb_physics[id].position;
    physics.velocity = _119.rb_physics[id].velocity;
    physics.radius = _119.rb_physics[id].radius;
    physics.inv_mass = _119.rb_physics[id].inv_mass;
    physics.meta = _119.rb_physics[id].meta;
    physics.freeze_end_time_ms = _119.rb_physics[id].freeze_end_time_ms;
    float radius = physics.radius;
    WorldGridBody grid_body;
    grid_body.body_id = id;
    grid_body.physics_meta = physics.meta;
    grid_body.sim_meta = _153.rb_sims[id].meta;
    grid_body.inv_mass = physics.inv_mass;
    grid_body.radius = physics.radius;
    grid_body.pred_pos = p;
    if (radius < min(pc.grid_cell_size.x, pc.grid_cell_size.y))
    {
        uint cell_index = (uint(ip.y) * pc.grid_cell_count.x) + uint(ip.x);
        uint cell_offset = cell_index * 2u;
        uint _198 = atomicAdd(_195.grid_cell_counts[cell_offset], 1u);
        uint index_in_cell = _198;
        if (index_in_cell >= pc.max_bodies_per_cell)
        {
            return;
        }
        uint offset = (cell_offset * pc.max_bodies_per_cell) + index_in_cell;
        _217.grid_bodies[offset].pred_pos = grid_body.pred_pos;
        _217.grid_bodies[offset].physics_meta = grid_body.physics_meta;
        _217.grid_bodies[offset].sim_meta = grid_body.sim_meta;
        _217.grid_bodies[offset].inv_mass = grid_body.inv_mass;
        _217.grid_bodies[offset].radius = grid_body.radius;
        _217.grid_bodies[offset].body_id = grid_body.body_id;
        _217.grid_bodies[offset]._gb_padding_0 = grid_body._gb_padding_0;
        _39.rb_tmps[id].grid_index = int(offset);
    }
    else
    {
        _39.rb_tmps[id].grid_index = -1;
        vec2 padding = vec2(radius) + pc.grid_cell_size;
        ivec2 min_cell = clamp(ivec2(floor((p - padding) / pc.grid_cell_size)), ivec2(0), ivec2(pc.grid_cell_count - uvec2(1u)));
        ivec2 max_cell = clamp(ivec2(floor((p + padding) / pc.grid_cell_size)), ivec2(0), ivec2(pc.grid_cell_count - uvec2(1u)));
        for (int y = min_cell.y; y <= max_cell.y; y++)
        {
            for (int x = min_cell.x; x <= max_cell.x; x++)
            {
                uint cell_index_1 = (uint(y) * pc.grid_cell_count.x) + uint(x);
                uint cell_offset_1 = (cell_index_1 * 2u) + 1u;
                uint _325 = atomicAdd(_195.grid_cell_counts[cell_offset_1], 1u);
                uint index_in_cell_1 = _325;
                if (index_in_cell_1 >= pc.max_bodies_per_cell)
                {
                    continue;
                }
                uint offset_1 = (cell_offset_1 * pc.max_bodies_per_cell) + index_in_cell_1;
                _217.grid_bodies[offset_1].pred_pos = grid_body.pred_pos;
                _217.grid_bodies[offset_1].physics_meta = grid_body.physics_meta;
                _217.grid_bodies[offset_1].sim_meta = grid_body.sim_meta;
                _217.grid_bodies[offset_1].inv_mass = grid_body.inv_mass;
                _217.grid_bodies[offset_1].radius = grid_body.radius;
                _217.grid_bodies[offset_1].body_id = grid_body.body_id;
                _217.grid_bodies[offset_1]._gb_padding_0 = grid_body._gb_padding_0;
            }
        }
    }
}
