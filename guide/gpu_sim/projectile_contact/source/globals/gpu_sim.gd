extends Node

signal base_damage_received(damage: float)
signal enemies_killed(count: int, data: PackedByteArray)
signal enemies_alive_updated(new_count: int)
signal readback_grid_updated(grid: ReadbackGridCPU)
signal contact_handlers_damage_updated()

var rd: RenderingDevice


const MAX_BODIES: int = 1024 * 256
const MAX_RIGIDBODY_ADDITIONS: int = 1024 * 8
const MAX_RIGIDBODY_REMOVALS: int = 1024 * 32
const MAX_ENEMIES_KILLED_READBACK: int = 1024
const CONTACT_STRIDE: int = 16
const MAX_CONTACTS: int = 1024 * 32
const GRID_CELL_SIZE: Vector2 = Vector2(12.0, 12.0)
const MAX_BODIES_PER_CELL: int = 64
const MAX_LASER_SEGMENTS: int = 1024
const MAX_LASERS_PER_CELL: int = 32

const READBACK_GRID_CELL_SIZE: Vector2 = Vector2(64.0, 64.0)

var USE_RENDER_POSITION_INTERPOLATION: bool = true

var WORLD_SIZE: Vector2 = Vector2(256.0, 256.0)
var GRID_CELL_COUNT: Vector2i = Vector2i(
	ceili(WORLD_SIZE.x / GRID_CELL_SIZE.x),
	ceili(WORLD_SIZE.y / GRID_CELL_SIZE.y))
var TOTAL_GRID_CELL_COUNT: int = GRID_CELL_COUNT.x * GRID_CELL_COUNT.y

var READBACK_GRID_CELL_COUNT: Vector2i = Vector2i(
	ceili(WORLD_SIZE.x / READBACK_GRID_CELL_SIZE.x),
	ceili(WORLD_SIZE.y / READBACK_GRID_CELL_SIZE.y))
var TOTAL_READBACK_GRID_CELL_COUNT: int = READBACK_GRID_CELL_COUNT.x * READBACK_GRID_CELL_COUNT.y



func _update_world_size(world_size: Vector2) -> void :
	WORLD_SIZE = world_size
	GRID_CELL_COUNT = Vector2i(
		ceili(WORLD_SIZE.x / GRID_CELL_SIZE.x),
		ceili(WORLD_SIZE.y / GRID_CELL_SIZE.y))
	TOTAL_GRID_CELL_COUNT = GRID_CELL_COUNT.x * GRID_CELL_COUNT.y

	READBACK_GRID_CELL_COUNT = Vector2i(
		ceili(WORLD_SIZE.x / READBACK_GRID_CELL_SIZE.x),
		ceili(WORLD_SIZE.y / READBACK_GRID_CELL_SIZE.y))
	TOTAL_READBACK_GRID_CELL_COUNT = READBACK_GRID_CELL_COUNT.x * READBACK_GRID_CELL_COUNT.y

var sc_integrate: GPU.SimpleCompute
var sc_clear_grid: GPU.SimpleCompute
var sc_build_grid: GPU.SimpleCompute
var sc_build_laser_grid: GPU.SimpleCompute
var sc_contacts_body_world: GPU.SimpleCompute
var sc_contacts_body_body: GPU.SimpleCompute
var sc_contacts_big_body_body: GPU.SimpleCompute
var sc_contacts_body_laser: GPU.SimpleCompute
var sc_filter_contacts: GPU.SimpleCompute
var sc_clear_deltas: GPU.SimpleCompute
var sc_solve_body_body: GPU.SimpleCompute
var sc_solve_body_world: GPU.SimpleCompute
var sc_apply_deltas: GPU.SimpleCompute
var sc_update_velocities_from_positions: GPU.SimpleCompute


var sc_finalize: GPU.SimpleCompute
var sc_handle_contacts: GPU.SimpleCompute
var sc_mark_dead: GPU.SimpleCompute
var sc_handle_dead: GPU.SimpleCompute
var corpse_sampler: RID
var corpse_tex_copy: RID
var corpses_uniform_set: RID
var sd_corpses: GPU.SimpleDraw
var fire_sampler: RID
var fire_tex_copy: RID
var flame_scale_curve_tex_copy: RID
var fire_uniform_set: RID
var sd_fire: GPU.SimpleDraw
var sc_sort_removals: GPU.SimpleCompute
var sc_removal: GPU.SimpleCompute
var sc_addition: GPU.SimpleCompute
var sc_sort_types: GPU.SimpleCompute
var sc_update_readback_grid: GPU.SimpleCompute

var sc_update_explosions: GPU.SimpleCompute
var sc_update_lightnings: GPU.SimpleCompute

var bc_update_dispatch: GPU.BaseCompute
var bc_update_draw_dispatch: GPU.BaseCompute

class RigidbodyBuffers:
	var counts: RID

	const PHYSICS_BYTE_SIZE: int = 32
	var physics: RID
	const SIM_BYTE_SIZE: int = 32
	var sim: RID
	const TMP_BYTE_SIZE: int = 32
	var tmp: RID

	const CONTACT_HANDLER_BYTE_SIZE: int = 32
	var contact_handlers: RID

	var additions: RID
	var removals: RID


	var enemies_killed_readback: GPU.ReadbackBuffer
	var enemies_alive_readback: GPU.ReadbackBufferInt32

	const RB_TYPES: int = 5
	var type_counts_reset_bytes: PackedByteArray = PackedByteArray()
	var type_counts: RID
	var type_ids: RID

	var laser_segments: RID

class WorldResources:
	var sdf_sampler: RID
	var sdf_tex: RID
	var sdf_tex_size: Vector2i
	var flow_tex: RID
	var corpses_tex: RID
	var fire_tex: RID
	var base_dmg_readback: GPU.ReadbackBufferInt32
	var grid_cell_counts: RID
	var grid_body_indices: RID
	var grid_laser_counts: RID
	var grid_laser_segments: RID
	var readback_grid: GPU.ReadbackBuffer
	var readback_grid_cpu: ReadbackGridCPU


const MAX_EXPLOSIONS: int = 1024 * 4
const EXPLOSION_STRIDE: int = 16
const MAX_LIGHTNINGS: int = 1024 * 4
const LIGHTNING_STRIDE: int = 32
class OtherResources:
	var explosion_counts: RID
	var explosion_data: RID
	var lightning_counts: RID
	var lightning_data: RID

const READBACK_CELL_STRIDE: int = 4
class ReadbackCell:
	var enemies_alive: float = 0.0
	var enemies_dead: float = 0.0
	var enemies_spawned: float = 0.0
	var enemies_damaged: float = 0.0

class ReadbackGridCPU:
	class Level:
		var cell_size: Vector2
		var cell_count: Vector2i
		var enemies_alive: PackedFloat32Array = []
		var enemies_dead: PackedFloat32Array = []
		var enemies_spawned: PackedFloat32Array = []
		var enemies_damaged: PackedFloat32Array = []
		func update_from(prev_level: Level) -> void :
			assert (prev_level.cell_count.x >= cell_count.x * 2)
			assert (prev_level.cell_count.y >= cell_count.y * 2)
			for y: int in cell_count.y:
				for x: int in cell_count.x:
					var ip: = Vector2i(x, y)
					var index: = ip.y * cell_count.x + ip.x
					enemies_alive[index] = 0.0



					var base_ip_prev_level: = ip * 2
					for offset: Vector2i in NEIGHBOR_OFFSETS:
						var ipn: = base_ip_prev_level + offset
						var n_index: = ipn.y * prev_level.cell_count.x + ipn.x
						enemies_alive[index] += prev_level.enemies_alive[n_index]




	var levels: Array[Level] = []

	func _init(base_level_size: Vector2, world_size: Vector2) -> void :
		levels.clear()
		var level_cell_size: = base_level_size
		var level_cell_count: = Vector2i(
			floori(world_size.x / level_cell_size.x),
			floori(world_size.y / level_cell_size.y))

		while level_cell_count.x > 0 and level_cell_count.y > 0:
			var level: = Level.new()
			level.cell_size = level_cell_size
			level.cell_count = level_cell_count
			level.enemies_alive.resize(level_cell_count.x * level_cell_count.y)
			level.enemies_dead.resize(level_cell_count.x * level_cell_count.y)
			level.enemies_spawned.resize(level_cell_count.x * level_cell_count.y)
			level.enemies_damaged.resize(level_cell_count.x * level_cell_count.y)
			levels.append(level)
			level_cell_size *= 2.0
			level_cell_count = Vector2i(
				floori(world_size.x / level_cell_size.x),
				floori(world_size.y / level_cell_size.y))

	const NEIGHBOR_OFFSETS: = [Vector2i(0, 0), Vector2i(1, 0), Vector2i(0, 1), Vector2i(1, 1)]
	func update(data: PackedByteArray) -> void :
		var cell_count_in: = ceili(data.size() / float(READBACK_CELL_STRIDE))
		var base_level: = levels[0]
		var base_level_total_cell_count: = base_level.cell_count.x * base_level.cell_count.y
		assert (cell_count_in == base_level_total_cell_count)
		for i: int in min(cell_count_in, base_level_total_cell_count):
			var base_offset: = i * READBACK_CELL_STRIDE
			base_level.enemies_alive[i] = float(data.decode_u32(base_offset + 0 * GPU.SIZE_I32))




		for l: int in range(1, levels.size()):
			var level: = levels[l]
			var prev_level: = levels[l - 1]
			level.update_from(prev_level)


	func sample_bilinear(property: StringName, level: Level, base_ip: Vector2i, factors: Vector2) -> float:
		var values: = PackedFloat32Array([0.0, 0.0, 0.0, 0.0])
		for i: int in 4:
			var ip: Vector2i = base_ip + NEIGHBOR_OFFSETS[i]
			if ip.x < 0 || ip.y < 0 || ip.x >= level.cell_count.x || ip.y >= level.cell_count.y:
				continue
			var index: = ip.y * level.cell_count.x + ip.x
			values[i] = level[property][index]

		return lerpf(
			lerpf(values[0], values[1], factors.x),
			lerpf(values[2], values[3], factors.x),
			factors.y)

	func sample_bilinear_level(property: StringName, pos: Vector2, level_index: int) -> float:
		var level: = levels[level_index]
		var ipf: = pos / level.cell_size
		var ip: = Vector2i(floori(ipf.x), floori(ipf.y))
		var factors: Vector2 = ipf - Vector2(ip)

		return sample_bilinear(property, level, ip, factors)

	func sample_bilinear_mipmap(property: StringName, pos: Vector2, level_index: float) -> float:
		level_index = clampf(level_index, 0.0, levels.size() - 1)
		var level_top: int = ceili(level_index)
		var level_low: int = floori(level_index)

		var sample_top: = sample_bilinear_level(property, pos, level_top)
		if level_top == level_low:
			return sample_top

		var factor_top: = level_index - float(level_low)
		var sample_low: = sample_bilinear_level(property, pos, level_low)

		return lerpf(sample_low, sample_top, factor_top)



class ContactBuffers:
	var count: RID
	var contacts: RID
	var contacts_pre_filtered: RID
	var contacts_pre_filtered_data: RID
	var damage_readback: GPU.ReadbackBuffer

const CONTACT_BUCKET_COUNT: int = 128
const MAX_ENTRIES_PER_CONTACT_BUCKET: int = 64
var contacts_pre_filtered_reset_buffer: PackedByteArray

const CONTACT_HANDLER_STRIDE: int = 32
const CONTACT_HANDLERS_DAMAGE_ENTRIES: int = 32
var contact_handlers_damage: Array[float] = []

var is_world_initialized: bool = false
const BODIES_GROUP_SIZE_X: int = 256
var bodies_dispatch: RID
var bodies_dispatch_update_uniform_set: RID
var body_additions_dispatch: RID
var body_additions_dispatch_update_uniform_set: RID
const CONTACTS_GROUP_SIZE_X: int = 256
var contacts_dispatch: RID
var contacts_dispatch_update_uniform_set: RID

var bodies_draw_dispatch: RID
var bodies_draw_dispatch_update_uniform_set: RID
var removals_draw_dispatch: RID
var removals_draw_dispatch_update_uniform_set: RID

var push_dict: Dictionary[StringName, GPU.PushAttribute] = {}
const PUSH_DT: StringName = &"dt"
const PUSH_INV_DT: StringName = &"inv_dt"
const PUSH_TIME_MS: StringName = &"time_ms"
const PUSH_TIME_RENDER_MS: StringName = &"time_render_ms"
const PUSH_ITERATIONS: StringName = &"iterations"
const PUSH_WORLD_SIZE: StringName = &"world_size"
const PUSH_INV_WORLD_SIZE: StringName = &"inv_world_size"
const PUSH_GRID_CELL_COUNT: StringName = &"grid_cell_count"
const PUSH_GRID_CELL_SIZE: StringName = &"grid_cell_size"
const PUSH_MAX_BODIES_PER_CELL: StringName = &"max_bodies_per_cell"
const PUSH_MAX_LASERS_PER_CELL: StringName = &"max_lasers_per_cell"
const PUSH_SDF_SCALE: StringName = &"sdf_scale"
const PUSH_FLOW_SPEED: StringName = &"flow_speed"
const PUSH_CORPSES_TEX_MATRIX: StringName = &"corpses_tex_matrix"
const PUSH_READBACK_GRID_CELL_COUNT: StringName = &"readback_grid_cell_count"
const PUSH_READBACK_GRID_CELL_SIZE: StringName = &"readback_grid_cell_size"
const PUSH_FIRE_TICKS: StringName = &"fire_ticks"
const PUSH_FIRE_TICK_DAMAGE: StringName = &"fire_tick_damage"
const PUSH_FIRE_DAMAGE_REPORT_ID: StringName = &"fire_damage_report_id"
const PUSH_FLAME_LIFETIME: StringName = &"flame_lifetime"
const PUSH_DEAD_EXPLOSION_VALUES: StringName = &"dead_explosion_values"
const PUSH_GRENADE_VALUES: StringName = &"grenade_values"
const PUSH_GRENADE_SLOW_FACOTR: StringName = &"grenade_slow_factor"
const PUSH_MISSILE_SLOW_FACOTR: StringName = &"missile_slow_factor"
const PUSH_CONFUSION_FACTOR: StringName = &"confusion_factor"
const PUSH_FIRE_FREE_PENETRATION_CHANCE: StringName = &"fire_free_penetration_chance"
const PUSH_SHOCK_DURATION: StringName = &"shock_duration"
const PUSH_FIRE_DAMAGE_MULTIPLIER: StringName = &"fire_damage_multiplier"
const PUSH_SLOW_DAMAGE_MULTIPLIER: StringName = &"slow_damage_multiplier"
const PUSH_LASER_DAMAGE: StringName = &"laser_damage"
const PUSH_LASER_DAMAGE_REPORT_ID: StringName = &"laser_damage_report_id"
const PUSH_UNFREEZE_DAMAGE: StringName = &"unfreeze_damage"
const PUSH_CRYO_BEAM_DAMAGE_REPORT_ID: StringName = &"cryo_beam_damage_report_id"
var current_delta: float = 0.0
var last_rendered_frame: int = 0
var simulation_time: float = 0.0
var render_time: float = 0.0
var current_iteration: int = 0
var sdf_scale: float = 0.0
var current_fire_ticks: int = 0
var flow_speed: float = 50.0
func _init_push_attributes() -> void :
	push_dict = {
		PUSH_DT: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, current_delta)
			), 4),
		PUSH_INV_DT: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, 1.0 / current_delta)
			), 4),
		PUSH_TIME_MS: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, roundi(simulation_time * 1000))
			), 4),
		PUSH_TIME_RENDER_MS: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, roundi(render_time * 1000))
			), 4),
		PUSH_ITERATIONS: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, current_iteration)
			push.encode_u32(offset + 4, SOLVER_ITERATIONS)
			), 8, 8),
		PUSH_WORLD_SIZE: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, WORLD_SIZE.x)
			push.encode_float(offset + 4, WORLD_SIZE.y)
			), 8, 8),
		PUSH_INV_WORLD_SIZE: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, 1.0 / WORLD_SIZE.x)
			push.encode_float(offset + 4, 1.0 / WORLD_SIZE.y)
			), 8, 8),
		PUSH_GRID_CELL_COUNT: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, GRID_CELL_COUNT.x)
			push.encode_u32(offset + 4, GRID_CELL_COUNT.y)
			), 8, 8),
		PUSH_GRID_CELL_SIZE: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, GRID_CELL_SIZE.x)
			push.encode_float(offset + 4, GRID_CELL_SIZE.y)
			), 8, 8),
		PUSH_MAX_BODIES_PER_CELL: GPU.PushAttribute.create_static_i32(MAX_BODIES_PER_CELL),
		PUSH_MAX_LASERS_PER_CELL: GPU.PushAttribute.create_static_i32(MAX_LASERS_PER_CELL),
		PUSH_SDF_SCALE: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, sdf_scale)
			), 4, 4),
		PUSH_FLOW_SPEED: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, flow_speed)
			), 4, 4),
		PUSH_CORPSES_TEX_MATRIX: GPU.PushAttribute.new([],
			( func(push: PackedByteArray, offset: int) -> void :
			var world_to_clip: = Transform2D(
				Vector2(2.0 / WORLD_SIZE.x, 0.0),
				Vector2(0.0, 2.0 / WORLD_SIZE.y),
				Vector2(-1.0, -1.0)
			)
			var world_to_clip_mat: = PackedFloat32Array([
				world_to_clip.x.x, world_to_clip.x.y, 0.0, 0.0,
				world_to_clip.y.x, world_to_clip.y.y, 0.0, 0.0,
				0.0, 0.0, 1.0, 0.0,
				world_to_clip.origin.x, world_to_clip.origin.y, 0.0, 1.0
			])
			for i: int in world_to_clip_mat.size():
				push.encode_float(offset + i * 4, world_to_clip_mat[i])
			), 64, 64),
		PUSH_READBACK_GRID_CELL_COUNT: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, READBACK_GRID_CELL_COUNT.x)
			push.encode_u32(offset + 4, READBACK_GRID_CELL_COUNT.y)
			), 8, 8),
		PUSH_READBACK_GRID_CELL_SIZE: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, READBACK_GRID_CELL_SIZE.x)
			push.encode_float(offset + 4, READBACK_GRID_CELL_SIZE.y)
			), 8, 8),
		PUSH_FIRE_TICKS: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_u32(offset, current_fire_ticks)
			), 4, 4),
		PUSH_FIRE_TICK_DAMAGE: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, Flamethrower.get_fire_tick_damage())
			), 4, 4),
		PUSH_FIRE_DAMAGE_REPORT_ID: GPU.PushAttribute.create_static_i32(Constants.DAMAGE_REPORT_ID_FLAMETHROWER),
		PUSH_FLAME_LIFETIME: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, Flamethrower.get_range() / Flamethrower.FLAME_SPEED)
			), 4, 4),
		PUSH_DEAD_EXPLOSION_VALUES: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset + 0, EnemySpawner.get_explosive_orcs_radius())
			push.encode_float(offset + 4, 1.0 / 50.0)
			push.encode_float(offset + 8, EnemySpawner.get_explosive_orcs_damage())
			push.encode_float(offset + 12, 1.0)
			push.encode_s32(offset + 16, Constants.DAMAGE_REPORT_ID_EXPLODING_ORCS)
			), 20, 4),
		PUSH_GRENADE_VALUES: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset + 0, GrenadeLauncher.get_grenade_radius())
			push.encode_float(offset + 4, GrenadeLauncher.get_slow_duration())
			push.encode_float(offset + 8, GrenadeLauncher.get_explosion_radius())
			push.encode_float(offset + 12, GrenadeLauncher.get_explosion_damage())
			push.encode_float(offset + 16, 1.0 / GrenadeLauncher.BASE_EXPLOSION_PUSH_FORCE)
			push.encode_s32(offset + 20, Constants.DAMAGE_REPORT_ID_GRENADE_LAUNCHER)
			), 24, 4),
		PUSH_GRENADE_SLOW_FACOTR: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, 1.0 - (GrenadeLauncher.get_slow_strength() / 100.0))
			), 4, 4),
		PUSH_MISSILE_SLOW_FACOTR: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, 1.0 - (Missile.get_shrapnel_slow_strength() / 100.0))
			), 4, 4),
		PUSH_CONFUSION_FACTOR: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, TeslaCoil.get_confusion_factor())
			), 4, 4),
		PUSH_FIRE_FREE_PENETRATION_CHANCE: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, Flamethrower.get_free_penetration_chance() / 100.0)
			), 4, 4),
		PUSH_SHOCK_DURATION: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, TeslaCoil.get_shock_duration())
			), 4, 4),
		PUSH_FIRE_DAMAGE_MULTIPLIER: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, Flamethrower.get_damage_multiplier())
			), 4, 4),
		PUSH_SLOW_DAMAGE_MULTIPLIER: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, GrenadeLauncher.get_damage_multiplier())
			), 4, 4),
		PUSH_LASER_DAMAGE: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, Laser.get_damage())
			), 4, 4),
		PUSH_LASER_DAMAGE_REPORT_ID: GPU.PushAttribute.create_static_i32(Constants.DAMAGE_REPORT_ID_LASER),
		PUSH_UNFREEZE_DAMAGE: GPU.PushAttribute.create_dynamic(
			( func(push: PackedByteArray, offset: int) -> void :
			push.encode_float(offset, CryoBeam.get_unfreeze_damage())
			), 4, 4),
		PUSH_CRYO_BEAM_DAMAGE_REPORT_ID: GPU.PushAttribute.create_static_i32(Constants.DAMAGE_REPORT_ID_CRYO_BEAM),
	}

var body_buffers: RigidbodyBuffers = RigidbodyBuffers.new()
var world_resources: WorldResources = WorldResources.new()
var contact_buffers: ContactBuffers = ContactBuffers.new()
var other_resources: OtherResources = OtherResources.new()

func _ready() -> void :
	set_physics_process(false)

func initialize() -> void :
	_init_push_attributes()
	_init_static_resources()

func _exit_tree() -> void :
	deinitialize()

func deinit_world_resources() -> void :
	GPU.sc_safe_free(sc_integrate)
	GPU.sc_safe_free(sc_clear_grid)
	GPU.sc_safe_free(sc_build_grid)
	GPU.sc_safe_free(sc_build_laser_grid)
	GPU.sc_safe_free(sc_contacts_body_world)
	GPU.sc_safe_free(sc_contacts_body_body)
	GPU.sc_safe_free(sc_contacts_big_body_body)
	GPU.sc_safe_free(sc_contacts_body_laser)
	GPU.sc_safe_free(sc_filter_contacts)
	GPU.sc_safe_free(sc_mark_dead)
	GPU.sc_safe_free(sc_solve_body_body)
	GPU.sc_safe_free(sc_solve_body_world)


	GPU.sd_safe_free(sd_corpses)
	GPU.sd_safe_free(sd_fire)

	if world_resources.readback_grid:
		world_resources.readback_grid.free_rids()

	for p: Dictionary in world_resources.get_property_list():
		if p[&"type"] == TYPE_RID and world_resources[p[&"name"]].is_valid():
			GPU.rid_safe_free(rd, world_resources[p[&"name"]])

	GPU.rid_safe_free(rd, corpse_sampler)
	GPU.rid_safe_free(rd, corpse_tex_copy)

func deinitialize() -> void :
	var rids: Array[RID] = [
		bodies_dispatch_update_uniform_set,
		contacts_dispatch_update_uniform_set,
		bodies_draw_dispatch_update_uniform_set,
		removals_draw_dispatch_update_uniform_set,
		body_additions_dispatch_update_uniform_set

	]
	for rid: RID in rids:
		GPU.rid_safe_free(rd, rid)

	GPU.sc_safe_free(sc_clear_deltas)
	GPU.sc_safe_free(sc_apply_deltas)
	GPU.sc_safe_free(sc_update_velocities_from_positions)
	GPU.sc_safe_free(sc_finalize)
	GPU.sc_safe_free(sc_handle_contacts)
	GPU.sc_safe_free(sc_handle_dead)
	GPU.sc_safe_free(sc_sort_removals)
	GPU.sc_safe_free(sc_removal)
	GPU.sc_safe_free(sc_sort_types)
	GPU.sc_safe_free(sc_addition)
	GPU.bc_safe_free(bc_update_dispatch)
	GPU.bc_safe_free(bc_update_draw_dispatch)

	deinit_world_resources()

	var other_rids: Array[RID] = [
		bodies_dispatch,
		body_additions_dispatch,
		contacts_dispatch,
		removals_draw_dispatch,
		bodies_draw_dispatch
	]
	for rid: RID in other_rids:
		GPU.rid_safe_free(rd, rid)

	if body_buffers.enemies_killed_readback:
		body_buffers.enemies_killed_readback.free_rids()

	if body_buffers.enemies_alive_readback:
		GPU.rid_safe_free(rd, body_buffers.enemies_alive_readback.buffer)

	if world_resources.base_dmg_readback:
		GPU.rid_safe_free(rd, world_resources.base_dmg_readback.buffer)

	for p: Dictionary in body_buffers.get_property_list():
		if p[&"type"] == TYPE_RID and body_buffers[p[&"name"]].is_valid():
			GPU.rid_safe_free(rd, body_buffers[p[&"name"]])

	for p: Dictionary in contact_buffers.get_property_list():
		if p[&"type"] == TYPE_RID and contact_buffers[p[&"name"]].is_valid():
			GPU.rid_safe_free(rd, contact_buffers[p[&"name"]])

func start() -> void :
	set_physics_process(true)

func stop() -> void :
	set_physics_process(false)

func reset() -> void :
	rd.buffer_update(body_buffers.counts, 0, 16, PackedInt32Array([0, 0, 0, 0]).to_byte_array())
	rd.buffer_update(contact_buffers.count, 0, 4, PackedInt32Array([0]).to_byte_array())

	rd.buffer_update(other_resources.explosion_counts, 0, 8, PackedInt32Array([0, MAX_EXPLOSIONS]).to_byte_array())
	var explosion_reset_bytes: = PackedByteArray()
	explosion_reset_bytes.resize(MAX_EXPLOSIONS * EXPLOSION_STRIDE)
	explosion_reset_bytes.fill(0)
	rd.buffer_update(other_resources.explosion_data, 0, explosion_reset_bytes.size(), explosion_reset_bytes)

	rd.buffer_update(other_resources.lightning_counts, 0, 8, PackedInt32Array([0, MAX_LIGHTNINGS]).to_byte_array())
	var lightning_reset_bytes: = PackedByteArray()
	lightning_reset_bytes.resize(MAX_LIGHTNINGS * LIGHTNING_STRIDE)
	lightning_reset_bytes.fill(0)
	rd.buffer_update(other_resources.lightning_data, 0, lightning_reset_bytes.size(), lightning_reset_bytes)

	queued_bodies.clear()
	queued_laser_segments.clear()
	gpu_time_ms_history.resize(GPU_TIME_HISTORY_ENTRY_COUNT)
	gpu_time_ms_history.fill(0.0)
	contact_handlers_damage.fill(0.0)

var body_count: int = 0
var addition_count: int = 0
var removal_count: int = 0
var contact_count: int = 0
var enemy_count: int = 0
var projectile_count: int = 0
var explosion_count: int = 0
var effect_count: int = 0
var flame_count: int = 0
var gpu_time_ms: float = 0.0
const GPU_TIME_HISTORY_ENTRY_COUNT: int = 128
var gpu_time_ms_history: Array[float]
var gpu_time_history_index: int
const SOLVER_ITERATIONS: int = 6
func _physics_process(delta: float) -> void :
	var fire_ticks_before: int = floori(simulation_time * Flamethrower.get_fire_tick_rate())
	current_delta = delta
	simulation_time += delta
	render_time = simulation_time
	last_rendered_frame = Engine.get_frames_drawn()
	var fire_ticks_after: int = floori(simulation_time * Flamethrower.get_fire_tick_rate())
	current_fire_ticks = fire_ticks_after - fire_ticks_before

	if !is_world_initialized:
		return

	rd.buffer_get_data_async(body_buffers.counts, func(data: PackedByteArray) -> void :
		body_count = data.decode_u32(0)
		addition_count = data.decode_u32(4)
		removal_count = data.decode_u32(8)
		)
	rd.buffer_get_data_async(body_buffers.type_counts, func(data: PackedByteArray) -> void :
		enemy_count = data.decode_u32(0)
		projectile_count = data.decode_u32(4)
		explosion_count = data.decode_u32(8)
		effect_count = data.decode_u32(12)
		flame_count = data.decode_u32(16)
		)
	rd.buffer_get_data_async(contact_buffers.count, func(data: PackedByteArray) -> void : contact_count = data.decode_u32(0))
	body_buffers.enemies_killed_readback.read_counted_async( func(count: int, data: PackedByteArray) -> void :
		if count > 0:
			enemies_killed.emit(count, data)
	)
	body_buffers.enemies_alive_readback.read_latest_async( func(count: int) -> void :
		enemies_alive_updated.emit(count)
	)
	world_resources.base_dmg_readback.read_accumulated_async( func(dmg: int) -> void :
		if dmg > 0:
			base_damage_received.emit(float(dmg))
	)
	world_resources.readback_grid.read_async( func(data: PackedByteArray) -> void :
		world_resources.readback_grid_cpu.update(data)
		readback_grid_updated.emit(world_resources.readback_grid_cpu)
	)
	contact_buffers.damage_readback.read_async( func(data: PackedByteArray) -> void :
		for i: int in CONTACT_HANDLERS_DAMAGE_ENTRIES:
			contact_handlers_damage[i] += (data.decode_s32(i * 4) / 100.0)
		contact_handlers_damage_updated.emit()
	)

	var sim_time_ms: float = GPU.get_gpu_duration_ms(rd, "sim_start", "sim_end")
	if sim_time_ms > 0.0:
		gpu_time_ms = sim_time_ms
		gpu_time_history_index = (gpu_time_history_index + 1) % GPU_TIME_HISTORY_ENTRY_COUNT
		gpu_time_ms_history[gpu_time_history_index] = gpu_time_ms

	rd.get_captured_timestamps_count()
	rd.capture_timestamp("sim_start")


	assert (queued_bodies.size() <= MAX_RIGIDBODY_ADDITIONS)
	body_buffers.enemies_killed_readback.increment_write()
	body_buffers.enemies_alive_readback.increment_write()
	world_resources.base_dmg_readback.increment_write()
	world_resources.readback_grid.increment_write()
	contact_buffers.damage_readback.increment_write()
	var bodies_to_add: int = min(queued_bodies.size(), MAX_RIGIDBODY_ADDITIONS)
	if bodies_to_add > 0:
		var body_addition_bytes: PackedByteArray = PackedByteArray()
		body_addition_bytes.resize(Rigidbody.STRIDE * bodies_to_add)
		for i: int in bodies_to_add:
			queued_bodies[i].insert_into(body_addition_bytes, i * Rigidbody.STRIDE)

		rd.buffer_update(body_buffers.additions, 0, body_addition_bytes.size(), body_addition_bytes)

		queued_bodies.clear()

	var segments_to_add: int = min(queued_laser_segments.size(), MAX_LASER_SEGMENTS)
	if segments_to_add > 0:
		var segment_addition_bytes: PackedByteArray = PackedByteArray()
		segment_addition_bytes.resize(4 * GPU.SIZE_F32 * segments_to_add)
		var stride: = 4 * GPU.SIZE_F32
		for i: int in segments_to_add:
			var segment: = queued_laser_segments[i]
			segment_addition_bytes.encode_float(stride * i + GPU.SIZE_F32 * 0, segment.x)
			segment_addition_bytes.encode_float(stride * i + GPU.SIZE_F32 * 1, segment.y)
			segment_addition_bytes.encode_float(stride * i + GPU.SIZE_F32 * 2, segment.z)
			segment_addition_bytes.encode_float(stride * i + GPU.SIZE_F32 * 3, segment.w)

		rd.buffer_update(body_buffers.laser_segments, 0, segment_addition_bytes.size(), segment_addition_bytes)

		queued_laser_segments.clear()

	rd.buffer_update(body_buffers.counts, 1 * GPU.SIZE_I32, 3 * GPU.SIZE_I32, PackedInt32Array([bodies_to_add, 0, segments_to_add]).to_byte_array())

	sc_handle_dead.dispatch_indirect(bodies_dispatch)

	_update_draw_dispatch_buffer(removals_draw_dispatch_update_uniform_set, 2)
	sd_corpses.draw_indirect(removals_draw_dispatch)
	_update_draw_dispatch_buffer(bodies_draw_dispatch_update_uniform_set, 0)
	sd_fire.draw_indirect(bodies_draw_dispatch)




	sc_removal.dispatch(Vector3i.ONE)

	_update_dispatch_buffer(bodies_dispatch_update_uniform_set, BODIES_GROUP_SIZE_X, 0)
	rd.buffer_update(body_buffers.type_counts, 0, body_buffers.type_counts_reset_bytes.size(), body_buffers.type_counts_reset_bytes)
	sc_sort_types.dispatch_indirect(bodies_dispatch)

	sc_integrate.dispatch_indirect(bodies_dispatch)

	sc_clear_grid.dispatch(Vector3i(ceili(TOTAL_GRID_CELL_COUNT / 256.0), 1, 1))
	sc_build_grid.dispatch_indirect(bodies_dispatch)
	sc_build_laser_grid.dispatch(Vector3i(ceili(MAX_LASER_SEGMENTS / 256.0), 1, 1))

	rd.buffer_update(contact_buffers.count, 0, 4, PackedInt32Array([0]).to_byte_array())
	rd.buffer_update(contact_buffers.contacts_pre_filtered, 0, contacts_pre_filtered_reset_buffer.size(), contacts_pre_filtered_reset_buffer)

	sc_contacts_body_body.dispatch(Vector3i(TOTAL_GRID_CELL_COUNT, 1, 1))
	sc_contacts_big_body_body.dispatch(Vector3i(TOTAL_GRID_CELL_COUNT, 1, 1))
	sc_contacts_body_world.dispatch_indirect(bodies_dispatch)
	sc_contacts_body_laser.dispatch(Vector3i(TOTAL_GRID_CELL_COUNT, 1, 1))

	sc_filter_contacts.dispatch(Vector3i.ONE)

	_update_dispatch_buffer(contacts_dispatch_update_uniform_set, CONTACTS_GROUP_SIZE_X, 0)
	sc_handle_contacts.dispatch_indirect(contacts_dispatch)

	sc_mark_dead.dispatch_indirect(bodies_dispatch)


	for i: int in SOLVER_ITERATIONS:
		sc_clear_deltas.dispatch_indirect(bodies_dispatch)
		sc_solve_body_body.dispatch(Vector3i(TOTAL_GRID_CELL_COUNT, 1, 1))
		sc_solve_body_world.dispatch_indirect(bodies_dispatch)
		sc_apply_deltas.dispatch_indirect(bodies_dispatch)

	sc_update_velocities_from_positions.dispatch_indirect(bodies_dispatch)

	sc_finalize.dispatch_indirect(bodies_dispatch)


	rd.buffer_update(other_resources.explosion_counts, 0, 8, PackedInt32Array([0, 0]).to_byte_array())
	sc_update_explosions.dispatch(Vector3i(ceil(MAX_EXPLOSIONS / 256.0), 1, 1))

	rd.buffer_update(other_resources.lightning_counts, 0, 8, PackedInt32Array([0, 0]).to_byte_array())
	sc_update_lightnings.dispatch(Vector3i(ceil(MAX_LIGHTNINGS / 256.0), 1, 1))

	sc_update_readback_grid.dispatch_indirect(bodies_dispatch)



	_update_dispatch_buffer(body_additions_dispatch_update_uniform_set, BODIES_GROUP_SIZE_X, 1)
	sc_addition.dispatch_indirect(body_additions_dispatch)

	rd.capture_timestamp("sim_end")

func _process(delta: float) -> void :
	if is_physics_processing() and USE_RENDER_POSITION_INTERPOLATION and Engine.get_frames_drawn() > last_rendered_frame:
		render_time += delta

func set_world_data(world_data: WorldGen.WorldData, world_corpses_tex_out: Texture2DRD, corpse_tex: Texture2D, world_fire_tex_out: Texture2DRD, fire_tex: Texture2D, flame_scale_curve_tex: Texture2D) -> void :
	deinit_world_resources()



	_update_world_size(world_data.world_size)
	sdf_scale = float(WorldGen.WORLD_UNITS_PER_PIXEL)


	var sdf_sampler_state: RDSamplerState = RDSamplerState.new()
	sdf_sampler_state.min_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	sdf_sampler_state.mag_filter = RenderingDevice.SAMPLER_FILTER_LINEAR

	world_resources.sdf_sampler = GPU.sampler_create(rd, "sdf_sampler", sdf_sampler_state)

	var tf: RDTextureFormat = RDTextureFormat.new()
	tf.format = RenderingDevice.DATA_FORMAT_R32_SFLOAT
	tf.width = world_data.sdf_tex.get_width()
	tf.height = world_data.sdf_tex.get_height()
	tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT)
	var tv: RDTextureView = RDTextureView.new()
	world_resources.sdf_tex = GPU.texture_create(rd, "sdf_tex", tf, tv, [world_data.sdf_data])

	var flow_tf: RDTextureFormat = RDTextureFormat.new()
	flow_tf.format = RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT
	flow_tf.width = world_data.flow_tex.get_width()
	flow_tf.height = world_data.flow_tex.get_height()
	flow_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT)
	var flow_tv: RDTextureView = RDTextureView.new()
	world_resources.flow_tex = GPU.texture_create(rd, "flow_tex", flow_tf, flow_tv, [world_data.flow_data])

	var corpses_tf: RDTextureFormat = RDTextureFormat.new()
	corpses_tf.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM
	corpses_tf.width = world_data.world_size.x * 2
	corpses_tf.height = world_data.world_size.y * 2
	corpses_tf.usage_bits = (
		RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT)
	var corpses_bytes: = PackedByteArray()
	corpses_bytes.resize(corpses_tf.width * corpses_tf.height * 4)
	world_resources.corpses_tex = GPU.texture_create(rd, "corpses_tex", corpses_tf, RDTextureView.new(), [corpses_bytes])
	world_corpses_tex_out.texture_rd_rid = world_resources.corpses_tex

	var fire_tf: RDTextureFormat = RDTextureFormat.new()
	fire_tf.format = RenderingDevice.DATA_FORMAT_R32_SFLOAT
	fire_tf.width = world_data.world_size.x * 2
	fire_tf.height = world_data.world_size.y * 2
	fire_tf.usage_bits = (
		RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT)
	var fire_arr: = PackedFloat32Array()
	fire_arr.resize(fire_tf.width * fire_tf.height)
	fire_arr.fill(-10.0)
	world_resources.fire_tex = GPU.texture_create(rd, "fire_tex", fire_tf, RDTextureView.new(), [fire_arr.to_byte_array()])
	world_fire_tex_out.texture_rd_rid = world_resources.fire_tex

	world_resources.base_dmg_readback = GPU.ReadbackBufferInt32.new(rd, "world_base_damage_readback")

	var grid_cell_counts_bytes: PackedByteArray = PackedByteArray()
	grid_cell_counts_bytes.resize(TOTAL_GRID_CELL_COUNT * GPU.SIZE_I32 * 2)

	world_resources.grid_cell_counts = GPU.create_storage_buffer(rd, grid_cell_counts_bytes, "grid_cell_counts")

	var grid_body_indices_bytes: PackedByteArray = PackedByteArray()
	grid_body_indices_bytes.resize(TOTAL_GRID_CELL_COUNT * MAX_BODIES_PER_CELL * 32 * 2)
	world_resources.grid_body_indices = GPU.create_storage_buffer(rd, grid_body_indices_bytes, "grid_body_indices")

	var grid_laser_counts_bytes: PackedByteArray = PackedByteArray()
	grid_laser_counts_bytes.resize(TOTAL_GRID_CELL_COUNT * GPU.SIZE_I32)

	world_resources.grid_laser_counts = GPU.create_storage_buffer(rd, grid_laser_counts_bytes, "grid_laser_counts")

	var grid_laser_segments_bytes: PackedByteArray = PackedByteArray()
	grid_laser_segments_bytes.resize(TOTAL_GRID_CELL_COUNT * MAX_LASERS_PER_CELL * 4 * GPU.SIZE_F32)
	world_resources.grid_laser_segments = GPU.create_storage_buffer(rd, grid_laser_segments_bytes, "grid_laser_segments")

	world_resources.readback_grid = GPU.ReadbackBuffer.new(rd, "readback_grid", 2, TOTAL_READBACK_GRID_CELL_COUNT, READBACK_CELL_STRIDE, READBACK_CELL_STRIDE)
	world_resources.readback_grid_cpu = ReadbackGridCPU.new(READBACK_GRID_CELL_SIZE, WORLD_SIZE)

	_create_world_uniforms()

	sc_integrate = GPU.SimpleCompute.new(rd, "integrate", load("res://shaders/rigidbody/integrate.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
		[push_dict[PUSH_WORLD_SIZE],
				push_dict[PUSH_DT],
			push_dict[PUSH_TIME_MS],
			push_dict[PUSH_FIRE_TICKS],
			push_dict[PUSH_FIRE_TICK_DAMAGE],
			push_dict[PUSH_FLOW_SPEED],
			push_dict[PUSH_FIRE_DAMAGE_REPORT_ID],
			push_dict[PUSH_CONFUSION_FACTOR],
			push_dict[PUSH_FIRE_DAMAGE_MULTIPLIER],
			push_dict[PUSH_SLOW_DAMAGE_MULTIPLIER],
			push_dict[PUSH_UNFREEZE_DAMAGE],
			push_dict[PUSH_CRYO_BEAM_DAMAGE_REPORT_ID],
		]
	)

	sc_clear_grid = GPU.SimpleCompute.new(rd, "clear_grid", load("res://shaders/rigidbody/clear_grid.glsl"),
		{
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT]
		]
	)
	sc_build_grid = GPU.SimpleCompute.new(rd, "build_grid", load("res://shaders/rigidbody/build_grid.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
				push_dict[PUSH_GRID_CELL_SIZE],
			push_dict[PUSH_MAX_BODIES_PER_CELL]
		]
	)
	sc_build_laser_grid = GPU.SimpleCompute.new(rd, "build_laser_grid", load("res://shaders/rigidbody/build_laser_grid.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
				push_dict[PUSH_GRID_CELL_SIZE],
			push_dict[PUSH_MAX_LASERS_PER_CELL]
		]
	)

	sc_contacts_body_body = GPU.SimpleCompute.new(rd, "contacts_body_body", load("res://shaders/rigidbody/contacts_body_body.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
			push_dict[PUSH_GRID_CELL_SIZE],
			push_dict[PUSH_TIME_MS],
		]
	)
	sc_contacts_big_body_body = GPU.SimpleCompute.new(rd, "contacts_big_body_body", load("res://shaders/rigidbody/contacts_big_body_body.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
			push_dict[PUSH_GRID_CELL_SIZE],
			push_dict[PUSH_TIME_MS],
		]
	)
	sc_contacts_body_laser = GPU.SimpleCompute.new(rd, "contacts_body_laser", load("res://shaders/rigidbody/contacts_body_laser.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
			push_dict[PUSH_GRID_CELL_SIZE],
			push_dict[PUSH_TIME_MS],
			push_dict[PUSH_MAX_LASERS_PER_CELL],
			push_dict[PUSH_LASER_DAMAGE],
			push_dict[PUSH_LASER_DAMAGE_REPORT_ID],
		]
	)

	sc_filter_contacts = GPU.SimpleCompute.new(rd, "filter_contacts", load("res://shaders/rigidbody/filter_contacts.glsl"),
		{
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
	)

	sc_contacts_body_world = GPU.SimpleCompute.new(rd, "contacts_body_world", load("res://shaders/rigidbody/contacts_body_world.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
		},
		[push_dict[PUSH_INV_WORLD_SIZE],
			push_dict[PUSH_SDF_SCALE]
		]
	)

	sc_mark_dead = GPU.SimpleCompute.new(rd, "mark_dead", load("res://shaders/rigidbody/mark_dead.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_DT],
			push_dict[PUSH_GRENADE_VALUES],
		]
	)

	sc_solve_body_body = GPU.SimpleCompute.new(rd, "solve_body_body", load("res://shaders/rigidbody/solve_body_body.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_GRID_CELL_COUNT],
				push_dict[PUSH_GRID_CELL_SIZE],
				push_dict[PUSH_WORLD_SIZE],
			push_dict[PUSH_ITERATIONS],
				push_dict[PUSH_DT],
				push_dict[PUSH_INV_DT]
		]
	)
	sc_solve_body_world = GPU.SimpleCompute.new(rd, "solve_body_world", load("res://shaders/rigidbody/solve_body_world.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_INV_WORLD_SIZE],
			push_dict[PUSH_DT],
			push_dict[PUSH_INV_DT],
			push_dict[PUSH_SDF_SCALE]
		]
	)

	sc_apply_deltas = GPU.SimpleCompute.new(rd, "apply_deltas", load("res://shaders/rigidbody/apply_deltas.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_WORLD_SIZE]
		]
	)
























	var corpses_framebuffer: = GPU.framebuffer_create(rd, "corpses_framebuffer", [world_resources.corpses_tex])

	var corpse_sampler_state: RDSamplerState = RDSamplerState.new()
	corpse_sampler_state.min_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	corpse_sampler_state.mag_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	corpse_sampler_state.mip_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	corpse_sampler = GPU.sampler_create(rd, "corpse_tex_sampler", corpse_sampler_state)

	var corpse_image: = corpse_tex.get_image()
	var corpse_tf: = RDTextureFormat.new()
	corpse_tf.width = corpse_tex.get_width()
	corpse_tf.height = corpse_tex.get_height()
	corpse_tf.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_SRGB
	corpse_tf.usage_bits = RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
	corpse_tf.mipmaps = corpse_image.get_mipmap_count() + 1
	corpse_tex_copy = GPU.texture_create(rd, "corpse_tex_copy", corpse_tf, RDTextureView.new(), [corpse_image.get_data()])


	sd_corpses = GPU.SimpleDraw.new(rd, "corpses", load("res://shaders/rigidbody/draw_corpses.glsl"),
		corpses_framebuffer,
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			3: GPU.UniformsArray.new([
				GPU.create_sampler_texture_uniform(0, corpse_sampler, corpse_tex_copy)
			])
		},
		[push_dict[PUSH_CORPSES_TEX_MATRIX],
			push_dict[PUSH_WORLD_SIZE]
		])


	var fire_framebuffer: = GPU.framebuffer_create(rd, "fire_framebuffer", [world_resources.fire_tex])

	var fire_sampler_state: RDSamplerState = RDSamplerState.new()
	fire_sampler_state.min_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	fire_sampler_state.mag_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	fire_sampler_state.mip_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	fire_sampler = GPU.sampler_create(rd, "fire_sampler", fire_sampler_state)

	fire_tex_copy = GPU.create_texture_copy(rd, "fire_tex_copy", fire_tex, RenderingDevice.DATA_FORMAT_R8G8B8A8_SRGB)
	flame_scale_curve_tex_copy = GPU.create_texture_copy(rd, "flame_scale_curve_tex_copy", flame_scale_curve_tex, RenderingDevice.DATA_FORMAT_R32_SFLOAT)


	sd_fire = GPU.SimpleDraw.new(rd, "fire", load("res://shaders/rigidbody/draw_fire.glsl"),
		fire_framebuffer,
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
			3: GPU.UniformsArray.new([
				GPU.create_sampler_texture_uniform(0, fire_sampler, fire_tex_copy),
				GPU.create_sampler_texture_uniform(1, fire_sampler, flame_scale_curve_tex_copy),
			])
		},
		[push_dict[PUSH_CORPSES_TEX_MATRIX],
			push_dict[PUSH_WORLD_SIZE],
			push_dict[PUSH_TIME_MS],
			push_dict[PUSH_FLAME_LIFETIME],
		])

	sc_update_readback_grid = GPU.SimpleCompute.new(rd, "update_readback_grid", load("res://shaders/rigidbody/update_readback_grid.glsl"),
	{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"WORLD_SET"]: world_uniforms,
		},
		[push_dict[PUSH_READBACK_GRID_CELL_COUNT],
			push_dict[PUSH_READBACK_GRID_CELL_SIZE],
			push_dict[PUSH_TIME_MS],
		])

	is_world_initialized = true

var queued_bodies: Array[Rigidbody] = []
func add_rigidbodies(bodies: Array[Rigidbody]) -> int:
	if !is_physics_processing():
		return 0

	queued_bodies.append_array(bodies)
	return bodies.size()

var queued_laser_segments: Array[Vector4] = []
func add_laser_segments(segments: Array[Vector4]) -> int:
	if !is_physics_processing():
		return 0

	queued_laser_segments.append_array(segments)
	return segments.size()

class RemovalArea:
	var world_pos: Vector2
	var radius: float

var removal_area: RemovalArea = RemovalArea.new()
var should_remove_in_area: bool = false
func remove_rigidbodies_in_area(world_pos: Vector2, radius: float) -> void :
	removal_area.world_pos = world_pos
	removal_area.radius = radius
	should_remove_in_area = true

var bindings: Dictionary[StringName, int] = {}
func _load_bindings() -> void :
	var bindings_file: FileAccess = FileAccess.open("res://shaders/bindings.gdshaderinc", FileAccess.READ)
	while !bindings_file.eof_reached():
		var line: String = bindings_file.get_line()
		if !line.begins_with("#define"):
			continue
		var values: PackedStringArray = line.split(" ", false)
		assert (values.size() == 3)
		bindings[values[1]] = int(values[2])




var rigidbody_uniforms: GPU.UniformsArray
func _create_rigidbody_uniforms() -> void :
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_COUNTS"], body_buffers.counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_PHYSICS"], body_buffers.physics))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_SIMS"], body_buffers.sim))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_TMPS"], body_buffers.tmp))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_CONTACT_HANDLERS"], body_buffers.contact_handlers))

	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_ADDITIONS"], body_buffers.additions))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_REMOVALS"], body_buffers.removals))

	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_ENEMIES_KILLED_READBACK"], body_buffers.enemies_killed_readback.data_buffer))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_ENEMIES_ALIVE_READBACK"], body_buffers.enemies_alive_readback.buffer))

	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_TYPE_COUNTS"], body_buffers.type_counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_TYPE_IDS"], body_buffers.type_ids))

	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"RIGIDBODY_LASER_SEGMENTS"], body_buffers.laser_segments))


	rigidbody_uniforms = GPU.UniformsArray.new(uniforms)

var world_uniforms: GPU.UniformsArray
func _create_world_uniforms() -> void :
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_sampler_texture_uniform(bindings[&"WORLD_SDF_TEX"], world_resources.sdf_sampler, world_resources.sdf_tex))
	uniforms.append(GPU.create_sampler_texture_uniform(bindings[&"WORLD_FLOW_TEX"], world_resources.sdf_sampler, world_resources.flow_tex))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_BASE_DAMAGE_READBACK"], world_resources.base_dmg_readback.buffer))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_GRID_CELL_COUNTS"], world_resources.grid_cell_counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_GRID_BODY_INDICES"], world_resources.grid_body_indices))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_GRID_LASER_COUNTS"], world_resources.grid_laser_counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_GRID_LASER_SEGMENTS"], world_resources.grid_laser_segments))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"WORLD_READBACK_GRID"], world_resources.readback_grid.data_buffer))

	world_uniforms = GPU.UniformsArray.new(uniforms)

var contact_uniforms: GPU.UniformsArray
func _create_contact_uniforms() -> void :
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"CONTACT_COUNT"], contact_buffers.count))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"CONTACTS"], contact_buffers.contacts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"CONTACTS_PRE_FILTERED"], contact_buffers.contacts_pre_filtered))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"CONTACTS_PRE_FILTERED_DATA"], contact_buffers.contacts_pre_filtered_data))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"CONTACT_HANDLER_DAMAGE_READBACK"], contact_buffers.damage_readback.data_buffer))

	contact_uniforms = GPU.UniformsArray.new(uniforms)

var other_uniforms: GPU.UniformsArray
func _create_other_uniforms() -> void :
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"EXPLOSION_COUNTS"], other_resources.explosion_counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"EXPLOSION_DATA"], other_resources.explosion_data))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"LIGHTNING_COUNTS"], other_resources.lightning_counts))
	uniforms.append(GPU.create_storage_buffer_uniform(bindings[&"LIGHTNING_DATA"], other_resources.lightning_data))

	other_uniforms = GPU.UniformsArray.new(uniforms)

func _create_rigidbody_shader(debug_name: String, shader_file: RDShaderFile, push_attributes: Array[GPU.PushAttribute] = []) -> GPU.SimpleCompute:
	return GPU.SimpleCompute.new(rd, debug_name,
		shader_file,
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms
		},
		push_attributes
	)

func _init_static_resources() -> void :
	_load_bindings()

	rd = RenderingServer.get_rendering_device()
	var count_bytes: PackedByteArray = PackedInt32Array([0, 0, 0, 0]).to_byte_array()
	body_buffers.counts = GPU.create_storage_buffer(rd, count_bytes, "rb_counts")

	var physics_arr: PackedByteArray = PackedByteArray()
	physics_arr.resize(MAX_BODIES * body_buffers.PHYSICS_BYTE_SIZE)
	body_buffers.physics = GPU.create_storage_buffer(rd, physics_arr, "rb_physics")

	var sim_arr: PackedByteArray = PackedByteArray()
	sim_arr.resize(MAX_BODIES * body_buffers.SIM_BYTE_SIZE)
	body_buffers.sim = GPU.create_storage_buffer(rd, sim_arr, "rb_sims")

	var tmp_arr: PackedByteArray = PackedByteArray()
	tmp_arr.resize(MAX_BODIES * body_buffers.TMP_BYTE_SIZE)
	body_buffers.tmp = GPU.create_storage_buffer(rd, tmp_arr, "rb_tmps")

	var handler_bytes: = PackedByteArray()
	handler_bytes.resize(MAX_BODIES * body_buffers.CONTACT_HANDLER_BYTE_SIZE)
	body_buffers.contact_handlers = GPU.create_storage_buffer(rd, handler_bytes, "rb_contact_handlers")

	var addition_bytes: PackedByteArray = PackedByteArray()
	addition_bytes.resize(MAX_RIGIDBODY_ADDITIONS * Rigidbody.STRIDE)
	body_buffers.additions = GPU.create_storage_buffer(rd, addition_bytes, "body_additions")

	var removal_bytes: PackedByteArray = PackedByteArray()
	removal_bytes.resize(MAX_RIGIDBODY_REMOVALS * GPU.SIZE_I32)
	body_buffers.removals = GPU.create_storage_buffer(rd, removal_bytes, "body_removals")

	removals_draw_dispatch = GPU.create_draw_dispatch_buffer(rd, "removal_draw_dispatch")
	bodies_draw_dispatch = GPU.create_draw_dispatch_buffer(rd, "bodies_draw_dispatch")

	body_buffers.enemies_killed_readback = GPU.ReadbackBuffer.new(rd, "body_enemies_killed_readback", 2, MAX_ENEMIES_KILLED_READBACK, 16, 16)
	body_buffers.enemies_alive_readback = GPU.ReadbackBufferInt32.new(rd, "body_enemeis_alive_readback")

	var type_counts_reset_arr: PackedInt32Array = PackedInt32Array()
	type_counts_reset_arr.resize(GPU.align_to(body_buffers.RB_TYPES, 4))
	type_counts_reset_arr.fill(0)
	body_buffers.type_counts_reset_bytes = type_counts_reset_arr.to_byte_array()
	body_buffers.type_counts = GPU.create_storage_buffer(rd, body_buffers.type_counts_reset_bytes, "rb_type_counts")

	var type_ids_bytes: = PackedByteArray()
	type_ids_bytes.resize(body_buffers.RB_TYPES * MAX_BODIES * GPU.SIZE_I32)
	body_buffers.type_ids = GPU.create_storage_buffer(rd, type_ids_bytes, "rb_type_ids")

	var laser_segments_arr: PackedByteArray = PackedByteArray()
	laser_segments_arr.resize(MAX_LASER_SEGMENTS * 4 * GPU.SIZE_F32)
	body_buffers.laser_segments = GPU.create_storage_buffer(rd, laser_segments_arr, "rb_laser_segments")

	bodies_dispatch = GPU.create_dispatch_buffer(rd, "bodies_dispatch")
	body_additions_dispatch = GPU.create_dispatch_buffer(rd, "body_additions_dispatch")
	_create_rigidbody_uniforms()


	var contact_count_bytes: PackedByteArray = PackedInt32Array([0, 0, 0, 0]).to_byte_array()
	contact_buffers.count = GPU.create_storage_buffer(rd, contact_count_bytes, "contact_count")

	var contacts_bytes: PackedByteArray = PackedByteArray()
	contacts_bytes.resize(MAX_CONTACTS * CONTACT_STRIDE)
	contact_buffers.contacts = GPU.create_storage_buffer(rd, contacts_bytes, "contacts")

	var contacts_pre_filtered_bytes: PackedByteArray = PackedByteArray()
	contacts_pre_filtered_bytes.resize(2 * CONTACT_BUCKET_COUNT * GPU.SIZE_I32)
	contact_buffers.contacts_pre_filtered = GPU.create_storage_buffer(rd, contacts_pre_filtered_bytes, "contacts_pre_filtered")

	var contacts_pre_filtered_data_bytes: = PackedByteArray()
	contacts_pre_filtered_data_bytes.resize(CONTACT_BUCKET_COUNT * MAX_ENTRIES_PER_CONTACT_BUCKET * GPU.SIZE_I64)
	contact_buffers.contacts_pre_filtered_data = GPU.create_storage_buffer(rd, contacts_pre_filtered_data_bytes, "contacts_pre_filtered_data")


	var reset_buffer: = PackedInt32Array()
	reset_buffer.resize(2 * CONTACT_BUCKET_COUNT)
	for i: int in CONTACT_BUCKET_COUNT:
		reset_buffer[i] = -1
		reset_buffer[CONTACT_BUCKET_COUNT + i] = 0
	contacts_pre_filtered_reset_buffer = reset_buffer.to_byte_array()

	contact_handlers_damage.resize(CONTACT_HANDLERS_DAMAGE_ENTRIES)
	contact_handlers_damage.fill(0.0)
	contact_buffers.damage_readback = GPU.ReadbackBuffer.new(rd, "contact_handlers_damage_readback", 2, CONTACT_HANDLERS_DAMAGE_ENTRIES, 4, 4)

	contacts_dispatch = GPU.create_dispatch_buffer(rd, "contacts_dispatch")
	_create_contact_uniforms()

	var explosion_counts_bytes: = PackedByteArray()
	explosion_counts_bytes.resize((4 + MAX_EXPLOSIONS * 2) * GPU.SIZE_I32)
	other_resources.explosion_counts = GPU.create_storage_buffer(rd, explosion_counts_bytes, "explosion_counts")

	var explosion_data_bytes: = PackedByteArray()
	explosion_data_bytes.resize(MAX_EXPLOSIONS * EXPLOSION_STRIDE)
	other_resources.explosion_data = GPU.create_storage_buffer(rd, explosion_data_bytes, "explosion_data")

	var lightning_counts_bytes: = PackedByteArray()
	lightning_counts_bytes.resize((4 + MAX_LIGHTNINGS * 2) * GPU.SIZE_I32)
	other_resources.lightning_counts = GPU.create_storage_buffer(rd, lightning_counts_bytes, "lightning_counts")

	var lightning_data_bytes: = PackedByteArray()
	lightning_data_bytes.resize(MAX_LIGHTNINGS * LIGHTNING_STRIDE)
	other_resources.lightning_data = GPU.create_storage_buffer(rd, lightning_data_bytes, "lightning_data")

	_create_other_uniforms()

	sc_clear_deltas = _create_rigidbody_shader("clear_deltas", load("res://shaders/rigidbody/clear_deltas.glsl"))

	sc_update_velocities_from_positions = _create_rigidbody_shader("update_velocities_from_positions", load("res://shaders/rigidbody/update_velocities_from_positions.glsl"),
		[push_dict[PUSH_WORLD_SIZE],
			push_dict[PUSH_DT],
			push_dict[PUSH_INV_DT]
		]
	)
	sc_handle_contacts = GPU.SimpleCompute.new(rd, "handle_contacts", load("res://shaders/rigidbody/handle_contacts.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"CONTACT_SET"]: contact_uniforms,
			bindings[&"OTHER_SET"]: other_uniforms,
		},
		[push_dict[PUSH_TIME_MS],
			push_dict[PUSH_FIRE_FREE_PENETRATION_CHANCE],
			push_dict[PUSH_SHOCK_DURATION],
			push_dict[PUSH_FIRE_DAMAGE_MULTIPLIER],
			push_dict[PUSH_SLOW_DAMAGE_MULTIPLIER],
			push_dict[PUSH_GRENADE_SLOW_FACOTR],
			push_dict[PUSH_MISSILE_SLOW_FACOTR],
		]
	)
	sc_finalize = _create_rigidbody_shader("finalize", load("res://shaders/rigidbody/finalize.glsl"),
		[push_dict[PUSH_DT],
			push_dict[PUSH_INV_DT]
		]
	)
	sc_handle_dead = GPU.SimpleCompute.new(rd, "handle_dead", load("res://shaders/rigidbody/handle_dead.glsl"),
	{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
		},
		[push_dict[PUSH_DEAD_EXPLOSION_VALUES],
		]
	)
	sc_sort_removals = _create_rigidbody_shader("sort_removals", load("res://shaders/rigidbody/sort_removals.glsl"))
	sc_removal = _create_rigidbody_shader("removal", load("res://shaders/rigidbody/removal.glsl"))
	sc_addition = GPU.SimpleCompute.new(rd, "addition", load("res://shaders/rigidbody/addition.glsl"),
		{
			bindings[&"RIGIDBODY_SET"]: rigidbody_uniforms,
			bindings[&"OTHER_SET"]: other_uniforms,
		},
		[push_dict[PUSH_TIME_MS],
		]
	)


	sc_sort_types = _create_rigidbody_shader("sort_types", load("res://shaders/rigidbody/sort_types.glsl"))

	sc_update_explosions = GPU.SimpleCompute.new(rd, "update_explosions", load("res://shaders/other/update_explosions.glsl"),
		{
			bindings[&"OTHER_SET"]: other_uniforms,
		},
		[push_dict[PUSH_DT],
		]
	)

	sc_update_lightnings = GPU.SimpleCompute.new(rd, "update_lightnings", load("res://shaders/other/update_lightnings.glsl"),
		{
			bindings[&"OTHER_SET"]: other_uniforms,
		},
		[push_dict[PUSH_DT],
		]
	)

	bc_update_dispatch = GPU.BaseCompute.new(rd, "update_dispatch", load("res://shaders/update_dispatch.glsl"))
	bodies_dispatch_update_uniform_set = _create_dispatch_uniform_set(body_buffers.counts, bodies_dispatch)
	body_additions_dispatch_update_uniform_set = _create_dispatch_uniform_set(body_buffers.counts, body_additions_dispatch)
	contacts_dispatch_update_uniform_set = _create_dispatch_uniform_set(contact_buffers.count, contacts_dispatch)

	bc_update_draw_dispatch = GPU.BaseCompute.new(rd, "update_draw_dispatch", load("res://shaders/update_draw_dispatch.glsl"))
	removals_draw_dispatch_update_uniform_set = _create_draw_dispatch_uniform_set(body_buffers.counts, removals_draw_dispatch)
	bodies_draw_dispatch_update_uniform_set = _create_draw_dispatch_uniform_set(body_buffers.counts, bodies_draw_dispatch)


func _update_dispatch_buffer(uniform_set: RID, group_size_x: int, count_offset: int) -> void :
	var push: PackedByteArray = PackedByteArray()
	push.resize(16)
	push.encode_u32(0, group_size_x)
	push.encode_u32(4, count_offset)

	rd.draw_command_begin_label(bc_update_dispatch.debug_name, Color.TURQUOISE)
	var cl: int = rd.compute_list_begin()
	rd.compute_list_bind_compute_pipeline(cl, bc_update_dispatch.pipeline)
	rd.compute_list_bind_uniform_set(cl, uniform_set, 0)
	rd.compute_list_set_push_constant(cl, push, push.size())
	rd.compute_list_dispatch(cl, 1, 1, 1)
	rd.compute_list_end()
	rd.draw_command_end_label()

func _update_draw_dispatch_buffer(uniform_set: RID, count_offset: int) -> void :
	var push: PackedByteArray = PackedByteArray()
	push.resize(16)
	push.encode_u32(0, count_offset)

	rd.draw_command_begin_label(bc_update_draw_dispatch.debug_name, Color.TURQUOISE)
	var cl: int = rd.compute_list_begin()
	rd.compute_list_bind_compute_pipeline(cl, bc_update_draw_dispatch.pipeline)
	rd.compute_list_bind_uniform_set(cl, uniform_set, 0)
	rd.compute_list_set_push_constant(cl, push, push.size())
	rd.compute_list_dispatch(cl, 1, 1, 1)
	rd.compute_list_end()
	rd.draw_command_end_label()

func _create_dispatch_uniform_set(count_buffer: RID, dispatch_buffer: RID) -> RID:
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_storage_buffer_uniform(0, count_buffer))
	uniforms.append(GPU.create_storage_buffer_uniform(1, dispatch_buffer))
	var rid: = rd.uniform_set_create(uniforms, bc_update_dispatch.shader, 0)
	GPU.set_resource_name(rd, rid, "dispatch_uniform_set")
	return rid

func _create_draw_dispatch_uniform_set(count_buffer: RID, dispatch_buffer: RID) -> RID:
	var uniforms: Array[RDUniform] = []
	uniforms.append(GPU.create_storage_buffer_uniform(0, count_buffer))
	uniforms.append(GPU.create_storage_buffer_uniform(1, dispatch_buffer))
	var rid: = rd.uniform_set_create(uniforms, bc_update_draw_dispatch.shader, 0)
	GPU.set_resource_name(rd, rid, "dispatch_uniform_set")
	return rid
