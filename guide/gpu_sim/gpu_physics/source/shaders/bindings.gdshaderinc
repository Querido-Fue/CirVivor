#define RIGIDBODY_SET 0

#define RIGIDBODY_COUNTS 0
#define RIGIDBODY_PHYSICS 1
#define RIGIDBODY_SIMS 2
#define RIGIDBODY_TMPS 3
#define RIGIDBODY_CONTACT_HANDLERS 4

#define RIGIDBODY_ADDITIONS 5
#define RIGIDBODY_REMOVALS 6

#define RIGIDBODY_ENEMIES_KILLED_READBACK 7
#define RIGIDBODY_ENEMIES_ALIVE_READBACK 8

#define RIGIDBODY_TYPE_COUNTS 9
#define RIGIDBODY_TYPE_IDS 10

#define RIGIDBODY_LASER_SEGMENTS 11

#if defined(USE_RIGIDBODIES)
const uint BODIES_DISPATCH_SIZE = 256;
const uint MAX_BODIES = 1024 * 256;
struct RB_Physics {
    vec2 position;
    vec2 velocity;
    float radius;
    float inv_mass;
    uint meta;
    uint freeze_end_time_ms;
};

struct RB_Sim {
    float lifetime;
    int health;
    uint timer;
    uint meta;
    uint fire_end_time_ms;
    uint shock_end_time_ms;
    uint slow_end_time_ms;
    uint speed_factor_i;
};

const float SPEED_SCALE = 1000.0;

struct RB_Tmp {
    vec2 previous_position;
    vec2 predicted_position;
    vec2 position_delta;
    int grid_index;
    int _padding_0;
};

layout(set = RIGIDBODY_SET, binding = RIGIDBODY_COUNTS, std430) buffer RB_Counts {
    uint rb_count;
    uint rb_addition_count;
    uint rb_removal_count;
    uint rb_laser_segment_count;
};
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_PHYSICS, std430) buffer RB_PhysicsBuffer {
    RB_Physics rb_physics[];
};
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_SIMS, std430) buffer RB_SimBuffer {
    RB_Sim rb_sims[];
};
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_TMPS, std430) buffer RB_TmpBuffer {
    RB_Tmp rb_tmps[];
};
const float HEALTH_SCALE = 100.0;

// SIM META
// 16 bits unused (16-31)
// 8 bits flags (8-15)
// 8 bits layer (0-7)
const uint BODY_FLAG_ALIVE = 1 << 0;
const uint BODY_FLAG_USE_FLOW = 1 << 1;
const uint BODY_FLAG_COUNT_AS_KILL = 1 << 2;
const uint BODY_FLAG_EXPLODE_ON_DEATH = 1 << 3;
const uint BODY_FLAG_IS_GOLDEN = 1 << 4;

// PHYSICS META
// 8 bits unused (24-31)
// 8 bits sensor mask (16-23)
// 8 bits collision mask (8-15)
// 8 bits layer (0-7)
// Sim meta and physics meta share the layer bits, they have to be manually kept in sync
// We need the layer bits in both
const uint BODY_LAYER_ID_ENEMIES       = 0;
const uint BODY_LAYER_ID_PROJECTILES   = 1;
const uint BODY_LAYER_ID_EXPLOSIONS    = 2;
const uint BODY_LAYER_ID_EFFECTS       = 3;
const uint BODY_LAYER_ID_FLAMES        = 4;
const uint BODY_LAYER_ID_GRENADES      = 5;
const uint BODY_LAYER_ID_7             = 6;
const uint BODY_LAYER_ID_TERRAIN       = 7;

const uint BODY_LAYER_BITS_ENEMIES       = 1 << BODY_LAYER_ID_ENEMIES;
const uint BODY_LAYER_BITS_PROJECTILES   = 1 << BODY_LAYER_ID_PROJECTILES;
const uint BODY_LAYER_BITS_EXPLOSIONS    = 1 << BODY_LAYER_ID_EXPLOSIONS;
const uint BODY_LAYER_BITS_EFFECTS       = 1 << BODY_LAYER_ID_EFFECTS;
const uint BODY_LAYER_BITS_FLAMES        = 1 << BODY_LAYER_ID_FLAMES;
const uint BODY_LAYER_BITS_GRENADES      = 1 << BODY_LAYER_ID_GRENADES;
const uint BODY_LAYER_BITS_7             = 1 << BODY_LAYER_ID_7;
const uint BODY_LAYER_BITS_TERRAIN       = 1 << BODY_LAYER_ID_TERRAIN;

const uint BITS_8 = 0xFFu;

// shared functions for layer bits
void rb_set_layer_mask(inout uint phys_meta, inout uint sim_meta, uint layer_mask) {
    phys_meta = (phys_meta & ~(BITS_8 << 0 * 8)) | ((layer_mask & BITS_8) << 0 * 8);
    sim_meta  = (sim_meta  & ~(BITS_8 << 0 * 8)) | ((layer_mask & BITS_8) << 0 * 8);
}
uint rb_get_layer_mask(in uint meta) {
    return ((meta >> (0 * 8)) & BITS_8);
}
bool rb_is_in_layer(in uint meta, uint layer_mask) {
    return (((meta >> (0 * 8)) & BITS_8) & layer_mask) != 0;
}
// sim meta functions
uint rb_get_flags(in uint sim_meta) {
    return ((sim_meta >> (1 * 8)) & BITS_8);
}
bool rb_has_flags(in uint sim_meta, uint flags) {
    return (((sim_meta >> (1 * 8)) & BITS_8) & (flags & BITS_8)) == (flags & BITS_8);
}
void rb_set_flags(inout uint sim_meta, uint flags) {
    sim_meta |= ((flags & BITS_8) << (1 * 8));
}
void rb_clear_flags(inout uint sim_meta, uint flags) {
    sim_meta = (sim_meta & ~((flags & BITS_8) << (1 * 8)));
}
// physics meta functions
uint rb_get_sensor_mask(in uint phys_meta) {
    return ((phys_meta >> (2 * 8)) & BITS_8);
}
void rb_set_sensor_mask(inout uint phys_meta, uint sensor_mask) {
    phys_meta = (phys_meta & ~(BITS_8 << (2 * 8))) | ((sensor_mask & BITS_8) << (2 * 8));
}
uint rb_get_collision_mask(in uint phys_meta) {
    return ((phys_meta >> (1 * 8)) & BITS_8);
}
void rb_set_collision_mask(inout uint phys_meta, uint collision_mask) {
    phys_meta = (phys_meta & ~(BITS_8 << (1 * 8))) | ((collision_mask & BITS_8) << (1 * 8));
}

// TIMER
const uint TIMER_TYPE_BITS = 4;
const uint TIMER_TIME_BITS = 28;
const uint TIMER_TIME_BIT_MASK = (1u << TIMER_TIME_BITS) - 1u;
const uint TIMER_TYPE_SPAWN = 0;
const uint TIMER_TYPE_DAMAGED = 1;

uint get_timer_time(uint timer) {
    return timer & TIMER_TIME_BIT_MASK;
}

uint get_timer_type(uint timer) {
    return timer >> TIMER_TIME_BITS;
}

void rb_deal_damage(float damage, uint id, uint time_ms, out int dealt_damage_i, out bool is_dead) {
    if (damage <= 0.0) {
        dealt_damage_i = 0;
        is_dead = false;
        return;
    }
    int damage_i = int(damage * HEALTH_SCALE);
    int health_before = atomicAdd(rb_sims[id].health, -damage_i);
    if (health_before <= 0) {
        dealt_damage_i = 0;
        is_dead = true;
        return;
    }
    int health_after = health_before - damage_i;
    if (time_ms > 0) {
        uint timer = (TIMER_TYPE_DAMAGED << TIMER_TIME_BITS) | (time_ms & TIMER_TIME_BIT_MASK);
        rb_sims[id].timer = timer;
    }
    dealt_damage_i = min(health_before, damage_i);
    is_dead = health_after <= 0;
}

struct RB_ContactHandler {
    float damage_self;
    float damage_other;
    float damage_falloff;
    float fire_timer;

    uint flags;
    int chaining;
    int damage_report_id;
    float slow_timer; // this is the freeze timer when damage_report_id is 19, otherwise it is the slow timer
};

const uint CONTACT_HANDLER_FLAG_KILL_IF_OTHER_TERRAIN = 1 << 0;
const uint CONTACT_HANDLER_FLAG_CLOSEST_ONLY = 1 << 1;

bool contact_handler_has_flags(uint handler_flags, uint flags) {
    return (handler_flags & flags) == flags;
}

layout(set = RIGIDBODY_SET, binding = RIGIDBODY_CONTACT_HANDLERS, std430) buffer RB_ContactHandlers {
    RB_ContactHandler rb_contact_handlers[];
};

void rb_copy(uint dst_id, uint src_id) {
    rb_physics[dst_id] = rb_physics[src_id];
    rb_sims[dst_id] = rb_sims[src_id];
    rb_contact_handlers[dst_id] = rb_contact_handlers[src_id];
}

struct RB_Init {
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

RB_Init construct_RB_Init() {
    RB_Init init;
    init.position = vec2(0.0, 0.0);
    init.velocity = vec2(0.0, 0.0);

    init.radius = 0.0;
    init.inv_mass = 0.0;
    init.health = 0.0;
    init.lifetime = 0.0;

    init.physics_meta = 0;
    init.sim_meta = 0;
    init._padding_0 = 0;
    init._padding_1 = 0;

    init.ch_damage_self = 0.0;
    init.ch_damage_other = 0.0;
    init.ch_damage_falloff = 0.0;
    init.ch_fire_timer = 0.0;

    init.ch_flags = 0;
    init.ch_chaining = 0;
    init.ch_damage_report_id = -1;
    init.ch_slow_timer = 0.0;

    return init;
}

const uint MAX_RIGIDBODY_ADDITIONS = 1024 * 8;
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_ADDITIONS, std430) buffer RB_Additions {
    RB_Init rb_additions[];
};

const uint MAX_RIGIDBODY_REMOVALS = 1024 * 32;
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_REMOVALS, std430) buffer RB_Removals {
    uint rb_removals[];
};

const uint MAX_ENEMIES_KILLED_READBACK = 1024;
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_ENEMIES_KILLED_READBACK, std430) buffer RigidbodyEnemiesKilledReadback {
    uint body_enemies_killed_readback[];
};
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_ENEMIES_ALIVE_READBACK, std430) buffer RigidbodyEnemiesAliveReadback {
    uint body_enemies_alive_readback[];
};

const uint RB_TYPES = 5; // ENEMIES + PROJECTILES + EXPLOSIONS + EFFECTS + FLAMES
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_TYPE_COUNTS, std430) buffer RB_TypeCounts {
    uint rb_type_counts[];
};

layout(set = RIGIDBODY_SET, binding = RIGIDBODY_TYPE_IDS, std430) buffer RB_TypeIDs {
    uint rb_type_ids[];
};

const uint MAX_RIGIDBODY_LASER_SEGMENTS = 1024;
layout(set = RIGIDBODY_SET, binding = RIGIDBODY_LASER_SEGMENTS, std430) buffer RB_LaserSegments {
    vec4 rb_laser_segments[]; // xy = start, zw = end
};

#endif


#define WORLD_SET 1
#define WORLD_SDF_TEX 0
#define WORLD_FLOW_TEX 1
#define WORLD_BASE_DAMAGE_READBACK 2
#define WORLD_GRID_CELL_COUNTS 3
#define WORLD_GRID_BODY_INDICES 4
#define WORLD_GRID_LASER_COUNTS 5
#define WORLD_GRID_LASER_SEGMENTS 6
#define WORLD_READBACK_GRID 7

#if defined(USE_WORLD)

layout(set = WORLD_SET, binding = WORLD_SDF_TEX) uniform sampler2D world_sdf_tex;
layout(set = WORLD_SET, binding = WORLD_FLOW_TEX) uniform sampler2D world_flow_tex;
layout(set = WORLD_SET, binding = WORLD_BASE_DAMAGE_READBACK, std430) buffer WorldBaseDamageReadback {
    int world_base_damage_readback[];
};

// GRID
layout(set = WORLD_SET, binding = WORLD_GRID_CELL_COUNTS, std430) buffer WorldGridCellCounts {
    uint grid_cell_counts[];
};

struct WorldGridBody {
    vec2 pred_pos;
    uint physics_meta;
    uint sim_meta;
    float inv_mass;
    float radius;
    uint body_id;
    uint _gb_padding_0;
};
layout(set = WORLD_SET, binding = WORLD_GRID_BODY_INDICES, std430) buffer WorldGridBodyData {
    WorldGridBody grid_bodies[];
};

// struct ReadbackCell {
//     uint enemies_alive;
//     uint enemies_dead;
//     uint enemies_spawned;
//     uint enemies_damaged;
// };
layout(set = WORLD_SET, binding = WORLD_GRID_LASER_COUNTS, std430) buffer WorldGridLaserCounts {
    uint grid_laser_counts[];
};

layout(set = WORLD_SET, binding = WORLD_GRID_LASER_SEGMENTS, std430) buffer WorldGridLaserSegments {
    vec4 grid_laser_segments[];
};

layout(set = WORLD_SET, binding = WORLD_READBACK_GRID, std430) buffer WorldReadbackGrid {
    uint world_readback_grid_write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    //ReadbackCell world_readback_grid_cells[];
    uint world_readback_grid_enemies_alive[];
};

float sdf(vec2 uv, float sdf_scale) {
    return sdf_scale * texture(world_sdf_tex, uv).r;
}

vec2 sdf_gradient(vec2 uv, float sdf_scale, vec2 eps) {
    float dx = sdf(uv + vec2(eps.x, 0.0), sdf_scale) - sdf(uv - vec2(eps.x, 0.0), sdf_scale);
    float dy = sdf(uv + vec2(0.0, eps.y), sdf_scale) - sdf(uv - vec2(0.0, eps.y), sdf_scale);

    return vec2(dx, dy) / (2.0 * eps);
}

#endif



#if defined(USE_CONTACTS)

#define CONTACT_SET 2
#define CONTACT_COUNT 0
#define CONTACTS 1
#define CONTACTS_PRE_FILTERED 2
#define CONTACTS_PRE_FILTERED_DATA 3
#define CONTACT_HANDLER_DAMAGE_READBACK 4

struct Contact {
    vec2 world_pos;
    int self_id;
    int other_id;
};

const int CONTACT_ID_TERRAIN = -1;


const uint MAX_CONTACTS = 1024 * 32;

layout(set = CONTACT_SET, binding = CONTACT_COUNT, std430) buffer ContactCount {
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
};

layout(set = CONTACT_SET, binding = CONTACTS, std430) buffer Contacts {
    Contact contacts[];
};

const uint CONTACT_BUCKET_COUNT = 128;
const uint MAX_ENTRIES_PER_CONTACT_BUCKET = 64;
layout(set = CONTACT_SET, binding = CONTACTS_PRE_FILTERED, std430) buffer ContactsPreFiltered {
    int contact_bucket_meta[];
};


layout(set = CONTACT_SET, binding = CONTACTS_PRE_FILTERED_DATA, std430) buffer ContactsPreFilteredData {
    uvec2 contact_bucket_data[];
};

const uint CONTACT_HANDLER_DAMAGE_ENTRIES = 32;
layout(set = CONTACT_SET, binding = CONTACT_HANDLER_DAMAGE_READBACK, std430) buffer ContactHandlerDamageReadback {
    uint write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    int data[];
} contact_handler_damage_readback;
#endif


#if defined(USE_OTHER)

#define OTHER_SET 3
#define EXPLOSION_COUNTS 0
#define EXPLOSION_DATA 1
#define LIGHTNING_COUNTS 2
#define LIGHTNING_DATA 3

const float MAX_EXPLOSION_LIFETIME = 0.2;
struct Explosion {
    vec2 position;
    float radius;
    float lifetime;
};

const uint MAX_EXPLOSIONS = 1024 * 4;
layout(set = OTHER_SET, binding = EXPLOSION_COUNTS, std430) buffer ExplosionCounts {
    int explosion_active_count;
    int explosion_inactive_count;
    uint _explosion_padding0;
    uint _explosion_padding1;
    uint explosion_ids[]; // Should be 2 * MAX_EXPLOSIONS in size, first active explosion ids, then inactive explosion ids
};

layout(set = OTHER_SET, binding = EXPLOSION_DATA, std430) buffer ExplosionBuffer {
    Explosion explosions[]; // Should be MAX_EXPLOSIONS in size
};


const float MAX_LIGHTNING_LIFETIME = 0.5;
struct Lightning {
    vec2 start;
    vec2 end;
    float lifetime;
    float _padding_0;
    float _padding_1;
    float _padding_2;
};

const uint MAX_LIGHTNINGS = 1024 * 4;
layout(set = OTHER_SET, binding = LIGHTNING_COUNTS, std430) buffer LightningCounts {
    int lightning_active_count;
    int lightning_inactive_count;
    uint _lightning_padding0;
    uint _lightning_padding1;
    uint lightning_ids[]; // Should be 2 * MAX_LIGHTNINGS in size, first active lightning ids, then inactive lightning ids
};

layout(set = OTHER_SET, binding = LIGHTNING_DATA, std430) buffer LightningBuffer {
    Lightning lightnings[]; // Should be MAX_LIGHTNINGS in size
};

#endif

float hash(uint x)
{
    x ^= x >> 16;
    x *= 0x7feb352d;
    x ^= x >> 15;
    x *= 0x846ca68b;
    x ^= x >> 16;
    return float(x) / 4294967295.0;
}