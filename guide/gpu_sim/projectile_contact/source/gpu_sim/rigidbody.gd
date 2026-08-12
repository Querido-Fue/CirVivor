class_name Rigidbody

const STRIDE: int = 80

const MAX_FLAGS: int = 8
enum Flags{
	ALIVE = 1 << 0,
	USE_FLOW = 1 << 1,
	COUNT_AS_KILL = 1 << 2,
	EXPLODE_ON_DEATH = 1 << 3,
	IS_GOLDEN = 1 << 4,
}

enum ContactHandlerFlags{
	KILL_IF_OTHER_TERRAIN = 1 << 0,
	CLOSEST_ONLY = 1 << 1,
	SLOW = 1 << 2,
}

const MAX_LAYERS: int = 8
enum Layers{
	ENEMIES = 1 << 0,
	PROJECTILES = 1 << 1,
	EXPLOSIONS = 1 << 2,
	EFFECTS = 1 << 3,
	FLAMES = 1 << 4,
	GRENADES = 1 << 5,
	LAYER_7 = 1 << 6,
	TERRAIN = 1 << 7
}

const BITS_8: int = 255;

var position: Vector2 = Vector2.ZERO
var velocity: Vector2 = Vector2.ZERO
var radius: float = 1.0
var inv_mass: float = 1.0
var health: float = 1.0
var flags: int = Flags.ALIVE
var layer: int = 1
var sensor_mask: int = 0
var collision_mask: int = 0
var lifetime: float = 0.0

var ch_damage_self: float = 0.0
var ch_damage_other: float = 0.0
var ch_damage_falloff: float = 0.0
var ch_fire_timer: float = 0.0
var ch_flags: int = 0
var ch_chaining: int = 0
var ch_damage_report_id: int = -1
var ch_slow_timer: float = 0.0

func _init(pos_in: Vector2, vel_in: Vector2, radius_in: float, inv_mass_in: float, health_in: float) -> void :
	position = pos_in
	velocity = vel_in
	radius = radius_in
	inv_mass = inv_mass_in
	health = health_in

func insert_into(bytes: PackedByteArray, offset: int) -> void :
	bytes.encode_float(offset + 0, position.x)
	bytes.encode_float(offset + 4, position.y)
	bytes.encode_float(offset + 8, velocity.x)
	bytes.encode_float(offset + 12, velocity.y)

	bytes.encode_float(offset + 16, radius)
	bytes.encode_float(offset + 20, inv_mass)
	bytes.encode_float(offset + 24, health)
	bytes.encode_float(offset + 28, lifetime)

	var physics_meta: int = (
		((sensor_mask & BITS_8) << (2 * 8)) |
		((collision_mask & BITS_8) << (1 * 8)) |
		((layer & BITS_8) << (0 * 8))
	)
	bytes.encode_u32(offset + 32, physics_meta)
	var sim_meta: int = (
		((flags & BITS_8) << (1 * 8)) |
		((layer & BITS_8) << (0 * 8))
	)
	bytes.encode_u32(offset + 36, sim_meta)

	bytes.encode_float(offset + 48, ch_damage_self)
	bytes.encode_float(offset + 52, ch_damage_other)
	bytes.encode_float(offset + 56, ch_damage_falloff)
	bytes.encode_float(offset + 60, ch_fire_timer)

	bytes.encode_u32(offset + 64, ch_flags)
	bytes.encode_s32(offset + 68, ch_chaining)
	bytes.encode_s32(offset + 72, ch_damage_report_id)
	bytes.encode_float(offset + 76, ch_slow_timer)
