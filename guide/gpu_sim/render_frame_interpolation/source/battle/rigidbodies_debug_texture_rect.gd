extends TextureRect

@export var cam: BattleCamera
@export var enemy_tex: Texture2D
@export var enemy_supporter_tex: Texture2D
@export var grenade_tex: Texture2D

var rd: RenderingDevice
var framebuffer: RID
var enemy_tex_copy: RID
var grenade_tex_copy: RID
var color_tex_sampler: RID
var sd_debug_draw: GPU.SimpleDraw
var draw_dispatch_buffer: RID
var update_draw_dispatch_uniform_set: RID

var result_texture: Texture2DRD

func _ready() -> void :
	rd = GPUSim.rd

	get_viewport().size_changed.connect(_on_resized)
	set_process(false)

func initialize() -> void :
	_init_resources()
	set_process(true)

func _exit_tree() -> void :
	if framebuffer:
		GPU.rid_safe_free(rd, framebuffer)
	if result_texture:
		GPU.rid_safe_free(rd, result_texture.texture_rd_rid)
	GPU.rid_safe_free(rd, draw_dispatch_buffer)
	GPU.sd_safe_free(sd_debug_draw)
	GPU.rid_safe_free(rd, enemy_tex_copy)
	GPU.rid_safe_free(rd, grenade_tex_copy)
	GPU.rid_safe_free(rd, color_tex_sampler)

func _process(_delta: float) -> void :
	_debug_draw()

func _on_resized() -> void :
	_create_framebuffer()


func _init_resources() -> void :
	_create_framebuffer()
	draw_dispatch_buffer = GPU.create_draw_dispatch_buffer(rd, "bodies_draw_dispatch")

	update_draw_dispatch_uniform_set = GPUSim._create_draw_dispatch_uniform_set(GPUSim.body_buffers.counts, draw_dispatch_buffer)

	var sampler_state: RDSamplerState = RDSamplerState.new()
	sampler_state.min_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	sampler_state.mag_filter = RenderingDevice.SAMPLER_FILTER_NEAREST
	sampler_state.mip_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	color_tex_sampler = GPU.sampler_create(rd, "color_tex_sampler", sampler_state)

	var enemy_tex_to_copy: = enemy_supporter_tex if Options.supporter_orcs_enabled else enemy_tex
	enemy_tex_copy = GPU.create_texture_copy(rd, "enemy_tex_copy", enemy_tex_to_copy, RenderingDevice.DATA_FORMAT_R8G8B8A8_SRGB)
	grenade_tex_copy = GPU.create_texture_copy(rd, "grenade_tex_copy", grenade_tex, RenderingDevice.DATA_FORMAT_R8G8B8A8_SRGB)

	sd_debug_draw = GPU.SimpleDraw.new(rd, "debug_draw", load("res://shaders/rigidbody/debug_draw.glsl"), framebuffer,
		{
			GPUSim.bindings[&"RIGIDBODY_SET"]: GPUSim.rigidbody_uniforms,
			GPUSim.bindings[&"WORLD_SET"]: GPUSim.world_uniforms,
			3: GPU.UniformsArray.new([
				GPU.create_sampler_texture_uniform(0, color_tex_sampler, enemy_tex_copy),
				GPU.create_sampler_texture_uniform(1, color_tex_sampler, grenade_tex_copy),
			]),
		}
	)

	sd_debug_draw.draw_flags = RenderingDevice.DrawFlags.DRAW_CLEAR_ALL
	sd_debug_draw.clear_colors = [Color(0, 0, 0, 0)]

func _create_framebuffer() -> void :
	if framebuffer:
		GPU.rid_safe_free(rd, framebuffer)
	if result_texture:
		GPU.rid_safe_free(rd, result_texture.texture_rd_rid)
	var vp: Viewport = get_viewport()
	var vp_size: = Vector2i(vp.get_visible_rect().size)
	var tex_format: = RDTextureFormat.new()
	tex_format.width = vp_size.x
	tex_format.height = vp_size.y
	if vp.use_hdr_2d:
		tex_format.format = RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT
	else:
		tex_format.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM
	tex_format.usage_bits = (
		RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT |
		RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
	)

	var tex_view: = RDTextureView.new()
	var rd_texture: = GPU.texture_create(rd, "rigidbodies_framebuffer_tex", tex_format, tex_view)
	result_texture = Texture2DRD.new()
	result_texture.texture_rd_rid = rd_texture
	texture = result_texture
	%ShadowTextureRect.texture = result_texture

	framebuffer = GPU.framebuffer_create(rd, "rigidbodies_framebuffer", [rd_texture])
	assert (framebuffer)



	if sd_debug_draw:
		sd_debug_draw.framebuffer = framebuffer


func _debug_draw() -> void :
	if cam.world_to_clip_mat.is_empty():
		return

	GPUSim._update_draw_dispatch_buffer(update_draw_dispatch_uniform_set, 0)


	sd_debug_draw.draw_indirect(draw_dispatch_buffer, 0,
		[
			GPU.PushAttribute.create_static(cam.world_to_clip_mat.to_byte_array(), 16),
			GPUSim.push_dict[GPUSim.PUSH_WORLD_SIZE],
			GPUSim.push_dict[GPUSim.PUSH_TIME_MS],
			GPUSim.push_dict[GPUSim.PUSH_TIME_RENDER_MS]
		])
