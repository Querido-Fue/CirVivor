class_name Gunner
extends BaseTower

@export_category("Visuals")
@export var rotatable: Node2D
@export var spawn_pos_base: Marker2D
@export var muzzle_flash: AnimatedSprite2D
@export var min_angle: float = 2.0
@export var max_angle: float = 60.0

const BASE_BULLET_DAMAGE: float = 1.0
const BASE_BULLET_FIRE_RATE: float = 3.0
const BASE_BULLET_RANGE: float = 100.0
const BASE_BULLET_MASS: float = 0.01
const BASE_BULLET_HEALTH: float = 1.0
const BASE_BULLET_SPEED: float = 200.0
const BASE_BULLET_RADIUS: float = 0.8

static func get_damage() -> float:
	return (BASE_BULLET_DAMAGE
		+ TechTree.get_upgrade(&"gunner_damage").current_value
		+ TechTree.get_upgrade(&"gunner_damage_2").current_value
		+ TechTree.get_upgrade(&"gunner_damage_3").current_value)

static func get_firerate() -> float:
	return (BASE_BULLET_FIRE_RATE
		+ TechTree.get_upgrade(&"gunner_firerate").current_value
		+ TechTree.get_upgrade(&"gunner_firerate_2").current_value
		+ TechTree.get_upgrade(&"gunner_firerate_3").current_value
		+ TechTree.get_upgrade(&"gunner_firerate_4").current_value)

static func get_range() -> float:
	return (BASE_BULLET_RANGE
		+ TechTree.get_upgrade(&"gunner_range").current_value)

static func get_bullet_health() -> int:
	return int(BASE_BULLET_HEALTH
		+ TechTree.get_upgrade(&"gunner_penetration").current_value
		+ TechTree.get_upgrade(&"gunner_penetration_2").current_value
	)

var base_rotation_degrees: float = 0.0
var move_rotation_degrees: float = 0.0

var fire_rate: float = BASE_BULLET_FIRE_RATE
var bullet_mass: float = BASE_BULLET_MASS


var bullet_damage: float = BASE_BULLET_DAMAGE
var bullet_health: float = BASE_BULLET_HEALTH
var bullet_speed: float = BASE_BULLET_SPEED
var bullet_radius: float = BASE_BULLET_RADIUS
var bullet_range: float = BASE_BULLET_RANGE

var total_bullets_spawned: int = 0

var delta_overflow: float = 0.0
var total_time: float = 0.0

static func get_kind() -> TowerKind:
	return TowerKind.GUNNER

static func is_unlocked() -> bool:
	return is_tower_unlocked(get_kind())

static func get_tower_limit(_tower_kind: BaseTower.TowerKind) -> int:
	return int(1
		+ TechTree.get_upgrade(&"gunner_count").current_value
		+ TechTree.get_upgrade(&"gunner_count_2").current_value
		+ TechTree.get_upgrade(&"gunner_count_3").current_value
		+ TechTree.get_upgrade(&"gunner_count_4").current_value
	)

static func get_icon(_tower_kind: BaseTower.TowerKind) -> Texture2D:
	return load("res://towers/gunner/gunner_icon.png")

static func _create_from_data(data: Dictionary) -> BaseTower:
	var gunner: Gunner = load(BaseTower.TOWER_SCENES[get_kind()]).instantiate()
	gunner.global_position = Vector2(data["position"]["x"], data["position"]["y"])
	if data.has("target_pos"):
		gunner.target_pos = Vector2(data["target_pos"]["x"], data["target_pos"]["y"])
	else:
		gunner.target_pos = gunner.global_position + Vector2.RIGHT * 100.0
	return gunner

func save_to_data() -> Dictionary:
	return {
		"kind": TowerKind.keys()[get_kind()],
		"position": {"x": global_position.x, "y": global_position.y},
		"target_pos": {"x": target_pos.x, "y": target_pos.y},
	}

var audio_playback: AudioStreamPlaybackPolyphonic

var target_preview_points: PackedVector2Array

func _ready() -> void :
	super._ready()

	total_time += randf_range(0.0, PI * 2.0)

	if muzzle_flash:
		muzzle_flash.play(&"default")

	fire_rate = get_firerate()
	delta_overflow = randf_range(0.0, 1.0 / fire_rate) * 0.5

	bullet_damage = get_damage()
	bullet_health = get_bullet_health()
	bullet_range = get_range()

	on_edit_mode_changed()
	target_preview_points.resize(10)
	target_preview_points.fill(Vector2.ZERO)
	if target_pos == Vector2.ZERO:
		target_pos = global_position + Vector2.RIGHT * Constants.TARGET_MIN_DISTANCE
		target.global_position = target_pos
	update_targeting()
	rotatable.rotation_degrees = base_rotation_degrees
	%SpreadPreview.rotation_degrees = base_rotation_degrees

	audio_playback = %AudioPlayerPoly.get_stream_playback()

	battle.phase_changed.connect(_on_battle_phase_changed)

func on_edit_mode_changed() -> void :
	super.on_edit_mode_changed()
	%SpreadPreview.modulate.a = 1.0 if edit_mode == EditMode.EDIT_TARGET else 0.2
	%SpreadPreview.visible = battle.phase == Battle.Phase.BUILD and was_constructed

func _on_battle_phase_changed(_new_phase: Battle.Phase) -> void :
	%SpreadPreview.visible = battle.phase == Battle.Phase.BUILD and was_constructed
	target.visible = battle.phase == Battle.Phase.BUILD and edit_mode == EditMode.EDIT_TARGET
	if battle.phase == Battle.Phase.BATTLE and fire_rate >= 10.0:
		%AudioPlayerSingle.play()

const SPREAD_RADIANS: float = 2.0 * DEGREES_TO_RADIANS
func _physics_process(delta: float) -> void :
	if edit_mode == EditMode.MOVABLE:
		super._physics_process(delta)

	if battle.phase != Battle.Phase.BATTLE:
		return

	total_time += delta
	var base_spawn_angle: float = (base_rotation_degrees + sin(total_time) * move_rotation_degrees) * DEGREES_TO_RADIANS
	rotatable.rotation = base_spawn_angle

	delta += delta_overflow
	var spawn_amount: int = floori(delta * fire_rate)
	delta_overflow = delta - spawn_amount / fire_rate

	if spawn_amount == 0:
		return

	var body_array: Array[Rigidbody] = []
	body_array.resize(spawn_amount)
	for i: int in spawn_amount:
		var base_spawn_pos: Vector2 = spawn_pos_base.global_position
		var pos: = base_spawn_pos
		var spawn_angle: = base_spawn_angle + randf_range( - SPREAD_RADIANS, SPREAD_RADIANS)
		var vel: = Vector2.from_angle(spawn_angle) * bullet_speed
		pos += vel * delta * (float(i) / spawn_amount)
		var radius: = bullet_radius
		var mass: = bullet_mass
		var health: = bullet_health
		var body: Rigidbody = Rigidbody.new(pos, vel, radius, 1.0 / mass, health)
		body.layer = Rigidbody.Layers.PROJECTILES
		body.sensor_mask = Rigidbody.Layers.ENEMIES | Rigidbody.Layers.TERRAIN
		body.collision_mask = 0
		body.lifetime = bullet_range / bullet_speed
		body.ch_damage_self = 1.0
		body.ch_damage_other = bullet_damage
		body.ch_flags = Rigidbody.ContactHandlerFlags.KILL_IF_OTHER_TERRAIN
		body.ch_damage_report_id = Constants.DAMAGE_REPORT_ID_GUNNER
		body_array[i] = body
		total_bullets_spawned += 1

	GPUSim.add_rigidbodies(body_array)



	if fire_rate < 10.0:
		audio_playback.play_stream(Constants.gun_sound, 0, 0, randf_range(0.9, 1.1))

func update_targeting() -> void :
	var to_target: = target_pos - global_position
	var dir: = to_target.normalized()
	var base_rotation: = dir.angle()
	base_rotation_degrees = base_rotation * 180.0 / PI

	var len_to_target: = to_target.length()
	move_rotation_degrees = lerpf(max_angle, min_angle, clampf(remap(sqrt(len_to_target), sqrt(Constants.TARGET_MIN_DISTANCE), sqrt(Constants.TARGET_MAX_DISTANCE), 0.0, 1.0), 0.0, 1.0))

	var display_range: = get_range() / scale.x
	var start_angle: = - move_rotation_degrees * DEGREES_TO_RADIANS

	var angle_step: = 2.0 * move_rotation_degrees * DEGREES_TO_RADIANS / (target_preview_points.size() - 2)

	for i: int in target_preview_points.size() - 1:
		var point: = Vector2.from_angle(start_angle + angle_step * i) * display_range
		target_preview_points[i] = point

	%SpreadPreview.points = target_preview_points

func _unhandled_input(event: InputEvent) -> void :
	super._unhandled_input(event)
	if edit_mode == EditMode.EDIT_TARGET:
		if event is InputEventMouseMotion:
			target_pos = clamp_target_pos(get_global_mouse_position())
			update_targeting()
			rotatable.rotation_degrees = base_rotation_degrees
			%SpreadPreview.rotation_degrees = base_rotation_degrees
			target.global_position = target_pos

	elif edit_mode == EditMode.MOVABLE and was_constructed:
		if event is InputEventMouseMotion:
			target_pos = clamp_target_pos(target_pos)
			update_targeting()
			rotatable.rotation_degrees = base_rotation_degrees
			%SpreadPreview.rotation_degrees = base_rotation_degrees
			target.global_position = target_pos
