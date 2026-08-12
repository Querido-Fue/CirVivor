class_name EnemySpawner
extends Node2D

signal enemies_spawned(count: int)

@export var spawner_data: EnemySpawnerData

var battle: Battle
var current_wave: int = 0
var total_time: float = 0.0
var delta_overflow: float = 0.0
var total_amount_spawned: int = 0
var rect: Rect2

func get_offset_rect() -> Vector2:
	return Vector2(
		randf_range(rect.position.x, rect.end.x),
		randf_range(rect.position.y, rect.end.y)
	)

var explosive_orcs_chance: float = 0.0
static func get_explosive_orcs_chance() -> float:
	return (TechTree.get_upgrade(&"explosive_orcs_unlock").current_value
		+ TechTree.get_upgrade(&"explosive_orcs_chance").current_value
	)

const BASE_EXPLOSION_RADIUS: = 10.0
static func get_explosive_orcs_radius() -> float:
	return (BASE_EXPLOSION_RADIUS
		+ TechTree.get_upgrade(&"explosive_orcs_radius").current_value
	)

const BASE_EXPLOSION_DAMAGE: = 10.0
static func get_explosive_orcs_damage() -> float:
	return (BASE_EXPLOSION_DAMAGE
		+ TechTree.get_upgrade(&"explosive_orcs_damage").current_value
	)

var golden_orc_chance: = 0.0
static func get_golden_orc_chance() -> float:
	return (TechTree.get_upgrade(&"golden_orcs").current_value
		+ TechTree.get_upgrade(&"golden_orcs_chance").current_value
		+ TechTree.get_upgrade(&"golden_orcs_chance_2").current_value)

const BASE_GOLDEN_ORC_MONEY: = 1
static func get_golden_orc_money() -> int:
	return int(BASE_GOLDEN_ORC_MONEY
		+ TechTree.get_upgrade(&"golden_orcs_money").current_value)

func _ready() -> void :
	assert (battle, "Can not be null!")
	explosive_orcs_chance = get_explosive_orcs_chance() / 100.0
	golden_orc_chance = get_golden_orc_chance() / 100.0

	var spawn_wave: EnemySpawnWave = spawner_data.waves[0]
	var spawn_rate: float = spawn_wave.amount / spawn_wave.duration
	delta_overflow += (1.0 / spawn_rate) * randf()

	var rs: = spawner_data.shape as RectangleShape2D
	rect = rs.get_rect()

	if global_position.x < 0 or global_position.y < 0:
		%SpawnerIndicatorSprite.global_position = abs(global_position)
	elif global_position.x > battle.world_data.world_size.x:
		var delta: float = global_position.x - battle.world_data.world_size.x
		%SpawnerIndicatorSprite.global_position.x -= delta * 2
	elif global_position.y > battle.world_data.world_size.y:
		var delta: float = global_position.y - battle.world_data.world_size.y
		%SpawnerIndicatorSprite.global_position.y -= delta * 2

func _physics_process(delta: float) -> void :
	total_time += delta
	delta += delta_overflow
	var spawn_wave: EnemySpawnWave = spawner_data.waves[current_wave]
	var spawn_rate: float = spawn_wave.amount / spawn_wave.duration
	var frame_spawn_amount: int = floori(spawn_rate * delta)
	var total_amount_before: int = total_amount_spawned
	total_amount_spawned += frame_spawn_amount
	total_amount_spawned = clampi(total_amount_spawned, 0, spawn_wave.amount)
	var relative_time: float = float(total_amount_spawned) / spawn_wave.amount
	frame_spawn_amount = total_amount_spawned - total_amount_before
	delta_overflow = delta - (frame_spawn_amount / spawn_rate)
	if frame_spawn_amount <= 0:
		return

	var body_array: Array[Rigidbody] = []
	body_array.resize(frame_spawn_amount)

	var spawn_pos: Vector2 = position
	for i: int in frame_spawn_amount:
		var pos: Vector2 = spawn_pos + get_offset_rect()
		var vel: = spawner_data.initial_velocity
		var rf: = randf()
		var radius_factor: = pow(rf, 10.0)
		var radius: = GameManager.ENEMY_MIN_RADIUS + (GameManager.ENEMY_MAX_RADIUS - GameManager.ENEMY_MIN_RADIUS) * radius_factor
		var mass: = 100.0 * (radius * radius) * 0.15
		var health: = GameManager.get_enemy_health(radius, relative_time, battle.level)
		var body: Rigidbody = Rigidbody.new(pos, vel, radius, 1.0 / mass, health)
		body.layer = Rigidbody.Layers.ENEMIES
		body.sensor_mask = 0
		body.collision_mask = Rigidbody.Layers.ENEMIES | Rigidbody.Layers.PROJECTILES | Rigidbody.Layers.EXPLOSIONS | Rigidbody.Layers.TERRAIN
		body.flags |= Rigidbody.Flags.USE_FLOW | Rigidbody.Flags.COUNT_AS_KILL
		if randf() <= explosive_orcs_chance:
			body.flags |= Rigidbody.Flags.EXPLODE_ON_DEATH
		if randf() <= golden_orc_chance:
			body.flags |= Rigidbody.Flags.IS_GOLDEN
		body_array[i] = body

	var actually_added: int = GPUSim.add_rigidbodies(body_array)
	if actually_added < frame_spawn_amount:
		var diff: int = frame_spawn_amount - actually_added
		total_amount_spawned -= diff

	if actually_added > 0:
		enemies_spawned.emit(actually_added)
