class_name GPU

const SIZE_I32: int = 4
const SIZE_I64: int = 8
const SIZE_F16: int = 2
const SIZE_F32: int = 4

static func create_storage_texture(rd: RenderingDevice, size: Vector2i, format: RenderingDevice.DataFormat, data: PackedByteArray) -> RID:
	var tf: = RDTextureFormat.new()
	tf.width = size.x
	tf.height = size.y
	tf.format = format
	tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)

	var tv: = RDTextureView.new()
	var rid: RID = GPU.texture_create(rd, "storage_tex_%dx%d" % [size.x, size.y], tf, tv)
	var result: Error = rd.texture_update(rid, 0, data)
	assert (result == OK)

	return rid

static func create_storage_buffer(rd: RenderingDevice, data: PackedByteArray, debug_name: String = "") -> RID:
	var rid: RID = rd.storage_buffer_create(data.size(), data, 0, RenderingDevice.BUFFER_CREATION_AS_STORAGE_BIT)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

static func create_uniform_buffer(rd: RenderingDevice, data: PackedByteArray, debug_name: String = "") -> RID:
	var rid: RID = rd.uniform_buffer_create(data.size(), data, 0)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

static func create_image_uniform(binding: int, id: RID) -> RDUniform:
	var uniform: = RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_IMAGE
	uniform.binding = binding
	uniform.add_id(id)
	return uniform

static func create_sampler_texture_uniform(binding: int, sampler: RID, texture: RID) -> RDUniform:
	var uniform: = RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE
	uniform.binding = binding
	uniform.add_id(sampler)
	uniform.add_id(texture)
	return uniform

static func create_storage_buffer_uniform(binding: int, id: RID) -> RDUniform:
	var uniform: = RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_STORAGE_BUFFER
	uniform.binding = binding
	uniform.add_id(id)
	return uniform

static func create_uniform_buffer_uniform(binding: int, id: RID) -> RDUniform:
	var uniform: = RDUniform.new()
	uniform.uniform_type = RenderingDevice.UNIFORM_TYPE_UNIFORM_BUFFER
	uniform.binding = binding
	uniform.add_id(id)
	return uniform

static func align_to(value: int, alignment: int) -> int:
	@warning_ignore("integer_division")
	return ((value + alignment - 1) / alignment) * alignment

static func create_dispatch_buffer(rd: RenderingDevice, debug_name: String = "") -> RID:
	var data: PackedByteArray = PackedInt32Array([1, 1, 1]).to_byte_array()
	var rid: RID = rd.storage_buffer_create(data.size(), data, RenderingDevice.STORAGE_BUFFER_USAGE_DISPATCH_INDIRECT, RenderingDevice.BUFFER_CREATION_AS_STORAGE_BIT)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid


static func update_dispatch_buffer(rd: RenderingDevice, buffer: RID, groups: Vector3i) -> void :
	var result: = rd.buffer_update(buffer, 0, 12, PackedInt32Array([groups.x, groups.y, groups.z]).to_byte_array())
	assert (result == OK)

static func create_draw_dispatch_buffer(rd: RenderingDevice, debug_name: String = "") -> RID:
	var data: PackedByteArray = PackedInt32Array([
		6, 1, 0, 0
		]).to_byte_array()
	var rid: RID = rd.storage_buffer_create(data.size(), data, RenderingDevice.STORAGE_BUFFER_USAGE_DISPATCH_INDIRECT, RenderingDevice.BUFFER_CREATION_AS_STORAGE_BIT)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

class ReadbackBuffer:
	var rd: RenderingDevice

	var data_buffer: RID
	var buffer_count: int = 2
	var element_count: int = 1024
	var element_byte_size: int = 16
	var element_byte_alignment: int = 16
	var buffer_byte_size: int = 0
	var last_read: int = buffer_count
	var last_write: int = buffer_count

	func _init(rd_in: RenderingDevice, debug_name: String,
		buffer_count_in: int = 2, element_count_in: int = 1024,
		element_byte_size_in: int = 16, element_byte_alignment_in: int = 16) -> void :
		rd = rd_in
		var initial_arr: = PackedByteArray()
		buffer_count = buffer_count_in
		element_count = element_count_in
		element_byte_size = element_byte_size_in
		element_byte_alignment = element_byte_alignment_in
		buffer_byte_size = GPU.align_to(element_byte_size, element_byte_alignment) * element_count


		var byte_count: int = 16 + buffer_count * buffer_byte_size
		initial_arr.resize(byte_count)
		initial_arr.fill(0)
		data_buffer = GPU.create_storage_buffer(rd, initial_arr, debug_name)




	func free_rids() -> void :
		GPU.rid_safe_free(rd, data_buffer)

	func read_counted_async(callable: Callable) -> void :
		rd.buffer_get_data_async(data_buffer, func(data: PackedByteArray) -> void :
			var last_written: = data.decode_u32(0)
			while last_read != last_written:
				last_read = (last_read + 1) % buffer_count
				var buffer_start: int = 16 + last_read * buffer_byte_size
				var valid_element_count: int = data.decode_u32(buffer_start)

				if valid_element_count > 0:
					var data_start: = buffer_start + GPU.align_to(element_byte_size, element_byte_alignment)
					var data_byte_size: = valid_element_count * GPU.align_to(element_byte_size, element_byte_alignment)

					callable.call(valid_element_count, data.slice(data_start, data_start + data_byte_size))
		)

	func read_async(callable: Callable) -> void :
		rd.buffer_get_data_async(data_buffer, func(data: PackedByteArray) -> void :
			var last_written: = data.decode_u32(0)
			while last_read != last_written:
				last_read = (last_read + 1) % buffer_count
				var buffer_start: int = 16 + last_read * buffer_byte_size
				callable.call(data.slice(buffer_start, buffer_start + buffer_byte_size))
		)

	func increment_write() -> void :
		last_write = (last_write + 1) % buffer_count
		var last_write_bytes: = PackedByteArray()
		last_write_bytes.resize(16)
		last_write_bytes.encode_s32(0, last_write)
		rd.buffer_update(data_buffer, 0, last_write_bytes.size(), last_write_bytes)

		var buffer_element_count_bytes: = PackedByteArray()
		buffer_element_count_bytes.resize(buffer_byte_size)
		buffer_element_count_bytes.fill(0)
		rd.buffer_update(data_buffer, 16 + last_write * buffer_byte_size, buffer_element_count_bytes.size(), buffer_element_count_bytes)

class ReadbackBufferInt32:
	var rd: RenderingDevice
	var buffer: RID
	var buffer_count: int = 4
	var last_read: int = buffer_count
	var last_write: int = buffer_count

	func _init(rd_in: RenderingDevice, debug_name: String) -> void :
		rd = rd_in
		var initial_arr: = PackedInt32Array()
		initial_arr.resize(buffer_count + 1)
		initial_arr.fill(0)
		buffer = GPU.create_storage_buffer(rd, initial_arr.to_byte_array(), debug_name)

	func read_latest_async(callable: Callable) -> void :
		rd.buffer_get_data_async(buffer, func(data: PackedByteArray) -> void :
			var last_written: = data.decode_s32(0)
			last_read = (last_written - 1 + buffer_count) % buffer_count
			var value: int = data.decode_s32(4 + last_read * 4)
			callable.call(value)
		)

	func read_accumulated_async(callable: Callable) -> void :
		rd.buffer_get_data_async(buffer, func(data: PackedByteArray) -> void :
			var last_written: = data.decode_s32(0)
			var value: int = 0
			while last_read != last_written:
				last_read = (last_read + 1) % buffer_count
				value += data.decode_s32(4 + last_read * 4)
			callable.call(value)
		)

	func increment_write() -> void :
		last_write = (last_write + 1) % buffer_count
		rd.buffer_update(buffer, 0, 4, PackedInt32Array([last_write]).to_byte_array())
		rd.buffer_update(buffer, 4 + last_write * 4, 4, PackedInt32Array([0]).to_byte_array())


class UniformsArray:
	var array: Array[RDUniform]
	func _init(uniforms: Array[RDUniform] = []) -> void :
		array = uniforms.duplicate()

class PushAttribute:

	var static_data: PackedByteArray
	var append_dynamic: Callable
	var byte_size: int
	var alignment: int = 4
	func _init(static_data_in: PackedByteArray, append_dynamic_in: Callable, byte_size_in: int, alignment_in: int = 4) -> void :
		static_data = static_data_in.duplicate()
		append_dynamic = append_dynamic_in
		byte_size = byte_size_in
		alignment = alignment_in

	static func create_static(static_data_in: PackedByteArray, alignment_in: int = -1) -> PushAttribute:
		var alignment_2: int = static_data_in.size() if alignment_in < 0 else alignment_in
		return PushAttribute.new(static_data_in, ( func() -> void : return ), static_data_in.size(), alignment_2)

	static func create_static_f32(static_f32_data: float, alignment_in: int = -1) -> PushAttribute:
		return PushAttribute.create_static(PackedFloat32Array([static_f32_data]).to_byte_array(), alignment_in)

	static func create_static_f32_array(static_f32_data: PackedFloat32Array, alignment_in: int = -1) -> PushAttribute:
		return PushAttribute.create_static(static_f32_data.to_byte_array(), alignment_in)

	static func create_static_i32(static_i32_data: int, alignment_in: int = -1) -> PushAttribute:
		return PushAttribute.create_static(PackedInt32Array([static_i32_data]).to_byte_array(), alignment_in)

	static func create_static_i32_array(static_i32_data: PackedInt32Array, alignment_in: int = -1) -> PushAttribute:
		return PushAttribute.create_static(static_i32_data.to_byte_array(), alignment_in)

	static func create_dynamic(append_dynamic_in: Callable, byte_size_in: int, alignment_in: int = 4) -> PushAttribute:
		return PushAttribute.new([], append_dynamic_in, byte_size_in, alignment_in)

	func append(push: PackedByteArray, offset: int) -> void :
		if static_data.size() > 0:
			for i: int in static_data.size():
				push.encode_u8(offset + i, static_data[i])
		else:
			append_dynamic.call(push, offset)

class SimpleCompute:
	var rd: RenderingDevice
	var debug_name: String
	var shader: RID
	var pipeline: RID
	var push_byte_size: int = 0
	var push_attributes: Array[PushAttribute] = []
	var uniform_sets: Dictionary[int, RID] = {}
	func _init(rd_in: RenderingDevice, debug_name_in: String, shader_file: RDShaderFile, uniform_sets_in: Dictionary[int, UniformsArray] = {}, push_attributes_in: Array[PushAttribute] = []) -> void :
		rd = rd_in
		debug_name = debug_name_in
		var shader_spirv: RDShaderSPIRV = shader_file.get_spirv()






		shader = rd.shader_create_from_spirv(shader_spirv)
		pipeline = rd.compute_pipeline_create(shader)
		GPU.set_resource_name(rd, shader, debug_name + "(shader)")
		GPU.set_resource_name(rd, pipeline, debug_name + "(pipeline)")
		for set_id: int in uniform_sets_in:
			uniform_sets[set_id] = rd.uniform_set_create(uniform_sets_in[set_id].array, shader, set_id)
			GPU.set_resource_name(rd, uniform_sets[set_id], debug_name + "(uniform set #%d)" % set_id)
		if !push_attributes_in.is_empty():
			set_push_attributes(push_attributes_in)

	func free_rids() -> void :
		for rid: RID in uniform_sets.values():
			GPU.rid_safe_free(rd, rid)
		GPU.rid_safe_free(rd, pipeline)
		GPU.rid_safe_free(rd, shader)

	func bind_uniform_sets(cl: int) -> void :
		for set_id: int in uniform_sets:
			rd.compute_list_bind_uniform_set(cl, uniform_sets[set_id], set_id)

	func set_push_attributes(push_attributes_in: Array[PushAttribute]) -> void :
		push_attributes = push_attributes_in.duplicate()
		push_byte_size = 0
		for attr: PushAttribute in push_attributes:
			push_byte_size = GPU.align_to(push_byte_size, attr.alignment)
			push_byte_size += attr.byte_size
		push_byte_size = GPU.align_to(push_byte_size, 16)

	func update_push(cl: int) -> void :
		if push_attributes.is_empty():
			return
		var push: PackedByteArray = PackedByteArray()
		push.resize(push_byte_size)
		var offset: int = 0
		for attr: PushAttribute in push_attributes:
			offset = GPU.align_to(offset, attr.alignment)
			attr.append(push, offset)
			offset += attr.byte_size

		rd.compute_list_set_push_constant(cl, push, push.size())

	func dispatch(groups: Vector3i) -> void :
		rd.draw_command_begin_label(debug_name, Color.WEB_GREEN)
		var cl: int = rd.compute_list_begin()
		rd.compute_list_bind_compute_pipeline(cl, pipeline)
		bind_uniform_sets(cl)
		update_push(cl)
		rd.compute_list_dispatch(cl, groups.x, groups.y, groups.z)
		rd.compute_list_end()
		rd.draw_command_end_label()

	func dispatch_indirect(dispatch_buffer: RID, offset: int = 0, push_override: Array[PushAttribute] = []) -> void :
		rd.draw_command_begin_label(debug_name, Color.LAWN_GREEN)
		var cl: int = rd.compute_list_begin()
		rd.compute_list_bind_compute_pipeline(cl, pipeline)
		bind_uniform_sets(cl)
		if !push_override.is_empty():
			push_byte_size = 0
			for attr: PushAttribute in push_override:
				push_byte_size = GPU.align_to(push_byte_size, attr.byte_size)
				push_byte_size += attr.byte_size
			push_byte_size = GPU.align_to(push_byte_size, 16)
			var push: PackedByteArray = PackedByteArray()
			push.resize(push_byte_size)
			var push_offset: int = 0
			for attr: PushAttribute in push_override:
				push_offset = GPU.align_to(push_offset, attr.alignment)
				attr.append.call(push, push_offset)
				push_offset += attr.byte_size

			rd.compute_list_set_push_constant(cl, push, push.size())
		else:
			update_push(cl)
		rd.compute_list_dispatch_indirect(cl, dispatch_buffer, offset)
		rd.compute_list_end()
		rd.draw_command_end_label()


class BaseCompute:
	var rd: RenderingDevice
	var debug_name: String
	var shader: RID
	var pipeline: RID

	func _init(rd_in: RenderingDevice, debug_name_in: String, shader_file: RDShaderFile) -> void :
		rd = rd_in
		debug_name = debug_name_in
		var shader_spirv: RDShaderSPIRV = shader_file.get_spirv()
		shader = rd.shader_create_from_spirv(shader_spirv)
		pipeline = rd.compute_pipeline_create(shader)
		GPU.set_resource_name(rd, shader, debug_name + "(shader)")
		GPU.set_resource_name(rd, pipeline, debug_name + "(pipeline)")

	func free_rids() -> void :
		GPU.rid_safe_free(rd, pipeline)
		GPU.rid_safe_free(rd, shader)

	func dispatch(groups: Vector3i, uniform_sets: Dictionary[int, RID] = {}, push: PackedByteArray = PackedByteArray()) -> void :
		rd.draw_command_begin_label(debug_name, Color.WEB_GREEN)
		var cl: int = rd.compute_list_begin()
		rd.compute_list_bind_compute_pipeline(cl, pipeline)
		for set_id: int in uniform_sets:
			rd.compute_list_bind_uniform_set(cl, uniform_sets[set_id], set_id)
		if push.size() > 0:
			rd.compute_list_set_push_constant(cl, push, push.size())
		rd.compute_list_dispatch(cl, groups.x, groups.y, groups.z)
		rd.compute_list_end()
		rd.draw_command_end_label()

class SimpleDraw:
	var rd: RenderingDevice
	var debug_name: String
	var framebuffer: RID
	var shader: RID
	var pipeline: RID
	var push_byte_size: int = 0
	var push_attributes: Array[PushAttribute] = []
	var uniform_sets: Dictionary[int, RID] = {}
	var draw_flags: RenderingDevice.DrawFlags = RenderingDevice.DrawFlags.DRAW_DEFAULT_ALL
	var clear_colors: Array[Color] = []
	func _init(rd_in: RenderingDevice, debug_name_in: String, shader_file: RDShaderFile, framebuffer_in: RID, uniform_sets_in: Dictionary[int, UniformsArray] = {}, push_attributes_in: Array[PushAttribute] = []) -> void :
		rd = rd_in
		debug_name = debug_name_in
		framebuffer = framebuffer_in

		var raster_state: = RDPipelineRasterizationState.new()
		raster_state.cull_mode = RenderingDevice.POLYGON_CULL_DISABLED
		raster_state.front_face = RenderingDevice.POLYGON_FRONT_FACE_COUNTER_CLOCKWISE
		var multisample_state: = RDPipelineMultisampleState.new()
		multisample_state.sample_count = RenderingDevice.TEXTURE_SAMPLES_1
		var depth_state: = RDPipelineDepthStencilState.new()
		depth_state.enable_depth_test = false
		depth_state.enable_depth_write = false
		var blend_attachment: = RDPipelineColorBlendStateAttachment.new()
		blend_attachment.enable_blend = true
		blend_attachment.src_color_blend_factor = RenderingDevice.BLEND_FACTOR_SRC_ALPHA
		blend_attachment.dst_color_blend_factor = RenderingDevice.BLEND_FACTOR_ONE_MINUS_SRC_ALPHA
		blend_attachment.color_blend_op = RenderingDevice.BLEND_OP_ADD
		blend_attachment.src_alpha_blend_factor = RenderingDevice.BLEND_FACTOR_ONE
		blend_attachment.dst_alpha_blend_factor = RenderingDevice.BLEND_FACTOR_ONE_MINUS_SRC_ALPHA
		blend_attachment.alpha_blend_op = RenderingDevice.BLEND_OP_ADD

		var blend_state: = RDPipelineColorBlendState.new()
		blend_state.attachments = [blend_attachment]

		var shader_spirv: RDShaderSPIRV = shader_file.get_spirv()
		shader = rd.shader_create_from_spirv(shader_spirv)
		pipeline = rd.render_pipeline_create(
			shader,
			rd.framebuffer_get_format(framebuffer),
			-1,
			RenderingDevice.RENDER_PRIMITIVE_TRIANGLES,
			raster_state,
			multisample_state,
			depth_state,
			blend_state
		)

		GPU.set_resource_name(rd, shader, debug_name + "(shader)")
		GPU.set_resource_name(rd, pipeline, debug_name + "(pipeline)")
		for set_id: int in uniform_sets_in:
			uniform_sets[set_id] = rd.uniform_set_create(uniform_sets_in[set_id].array, shader, set_id)
			GPU.set_resource_name(rd, uniform_sets[set_id], debug_name + "(uniform set #%d)" % set_id)
		if !push_attributes_in.is_empty():
			set_push_attributes(push_attributes_in)

	func free_rids() -> void :
		for rid: RID in uniform_sets.values():
			GPU.rid_safe_free(rd, rid)
		GPU.rid_safe_free(rd, pipeline)
		GPU.rid_safe_free(rd, shader)

	func bind_uniform_sets(dl: int) -> void :
		for set_id: int in uniform_sets:
			rd.draw_list_bind_uniform_set(dl, uniform_sets[set_id], set_id)

	func set_push_attributes(push_attributes_in: Array[PushAttribute]) -> void :
		push_attributes = push_attributes_in.duplicate()
		push_byte_size = 0
		for attr: PushAttribute in push_attributes:
			push_byte_size = GPU.align_to(push_byte_size, attr.byte_size)
			push_byte_size += attr.byte_size
		push_byte_size = GPU.align_to(push_byte_size, 16)

	func update_push(dl: int) -> void :
		var push: PackedByteArray = PackedByteArray()
		push.resize(push_byte_size)
		var offset: int = 0
		for attr: PushAttribute in push_attributes:
			offset = GPU.align_to(offset, attr.alignment)
			attr.append(push, offset)
			offset += attr.byte_size

		rd.draw_list_set_push_constant(dl, push, push.size())

	func draw_indirect(dispatch_buffer: RID, offset: int = 0, push_override: Array[PushAttribute] = []) -> void :
		rd.draw_command_begin_label(debug_name, Color.DARK_ORANGE)
		var dl: int = rd.draw_list_begin(framebuffer, draw_flags, clear_colors)
		rd.draw_list_bind_render_pipeline(dl, pipeline)
		bind_uniform_sets(dl)
		if !push_override.is_empty():
			push_byte_size = 0
			for attr: PushAttribute in push_override:
				push_byte_size = GPU.align_to(push_byte_size, attr.byte_size)
				push_byte_size += attr.byte_size
			push_byte_size = GPU.align_to(push_byte_size, 16)
			var push: PackedByteArray = PackedByteArray()
			push.resize(push_byte_size)
			var push_offset: int = 0
			for attr: PushAttribute in push_override:
				push_offset = GPU.align_to(push_offset, attr.alignment)
				attr.append.call(push, push_offset)
				push_offset += attr.byte_size

			rd.draw_list_set_push_constant(dl, push, push.size())
		else:
			update_push(dl)
		rd.draw_list_draw_indirect(dl, false, dispatch_buffer, offset)
		rd.draw_list_end()
		rd.draw_command_end_label()

static var used_resources: Dictionary[RID, String] = {}

static func set_resource_name(rd: RenderingDevice, rid: RID, debug_name: String) -> void :
	assert ( !debug_name.is_empty())
	used_resources[rid] = debug_name
	rd.set_resource_name(rid, debug_name)

static func texture_create(rd: RenderingDevice, debug_name: String, tf: RDTextureFormat, tv: RDTextureView, data: Array[PackedByteArray] = []) -> RID:
	var rid: = rd.texture_create(tf, tv, data)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

static func sampler_create(rd: RenderingDevice, debug_name: String, sampler_state: RDSamplerState) -> RID:
	var rid: = rd.sampler_create(sampler_state)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

static func framebuffer_create(rd: RenderingDevice, debug_name: String, textures: Array[RID]) -> RID:
	var rid: = rd.framebuffer_create(textures)
	GPU.set_resource_name(rd, rid, debug_name)
	return rid

static func rid_safe_free(rd: RenderingDevice, rid: RID) -> void :
	if rid.is_valid():

		rd.free_rid(rid)
	used_resources.erase(rid)

static func create_texture_copy(rd: RenderingDevice, debug_name: String, source_tex: Texture2D, format: RenderingDevice.DataFormat) -> RID:
	var image: Image

	if source_tex is CurveTexture:
		image = RenderingServer.texture_2d_get(source_tex)
	else:
		image = source_tex.get_image()

	var tf: = RDTextureFormat.new()
	tf.format = format
	tf.width = source_tex.get_width()
	tf.height = source_tex.get_height()
	tf.mipmaps = image.get_mipmap_count() + 1
	tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT)
	var tv: = RDTextureView.new()
	var image_data: = image.get_data()
	var tex_copy: = GPU.texture_create(rd, debug_name, tf, tv, [image_data])
	assert (rd.texture_is_valid(tex_copy))
	return tex_copy

static func sc_safe_free(sc: SimpleCompute) -> void :
	if sc:
		sc.free_rids()

static func bc_safe_free(bc: BaseCompute) -> void :
	if bc:
		bc.free_rids()

static func sd_safe_free(sd: SimpleDraw) -> void :
	if sd:
		sd.free_rids()

static func generate_sdf_tex(input_data: PackedByteArray, tex_size: Vector2i, work_rd: RenderingDevice = null) -> PackedByteArray:
	var rd: RenderingDevice = work_rd
	if !rd:
		rd = RenderingServer.create_local_rendering_device()
	var input_tex: RID
	var tv: = RDTextureView.new()
	var input_tf: RDTextureFormat = RDTextureFormat.new()
	input_tf.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM
	input_tf.width = tex_size.x
	input_tf.height = tex_size.y
	input_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)
	input_tex = GPU.texture_create(rd, "sdf_input_tex", input_tf, tv, [input_data])
	var ping_pong_tf: RDTextureFormat = RDTextureFormat.new()
	ping_pong_tf.width = tex_size.x
	ping_pong_tf.height = tex_size.y
	ping_pong_tf.format = RenderingDevice.DATA_FORMAT_R32G32_SFLOAT
	ping_pong_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)
	var ping_tex: RID = GPU.texture_create(rd, "sdf_ping_tex", ping_pong_tf, tv)
	var pong_tex: RID = GPU.texture_create(rd, "sdf_pong_tex", ping_pong_tf, tv)

	var sdf_tf: RDTextureFormat = RDTextureFormat.new()
	sdf_tf.width = tex_size.x
	sdf_tf.height = tex_size.y
	sdf_tf.format = RenderingDevice.DATA_FORMAT_R32_SFLOAT
	sdf_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)
	var sdf_tex: RID = GPU.texture_create(rd, "sdf_result_tex", sdf_tf, tv)

	var sc_seed: GPU.SimpleCompute = GPU.SimpleCompute.new(rd, "sdf_seed", load("res://shaders/world_gen/sdf/seed.glsl"),
		{
			0: GPU.UniformsArray.new([
				GPU.create_image_uniform(0, input_tex),
				GPU.create_image_uniform(1, ping_tex)
			])
		}
	)
	var bc_jump_flood: GPU.BaseCompute = GPU.BaseCompute.new(rd, "sdf_jump_flood", load("res://shaders/world_gen/sdf/jump_flood.glsl"))

	var ping_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, ping_tex),
		GPU.create_image_uniform(1, pong_tex)]
	var pong_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, pong_tex),
		GPU.create_image_uniform(1, ping_tex)]

	var jump_flood_uniform_sets: Array[RID] = [
		rd.uniform_set_create(ping_uniforms, bc_jump_flood.shader, 0),
		rd.uniform_set_create(pong_uniforms, bc_jump_flood.shader, 0)
	]
	GPU.set_resource_name(rd, jump_flood_uniform_sets[0], "jump_flood_uniform_set(ping)")
	GPU.set_resource_name(rd, jump_flood_uniform_sets[1], "jump_flood_uniform_set(pong)")

	var bc_finalize: GPU.BaseCompute = GPU.BaseCompute.new(rd, "sdf_finalize", load("res://shaders/world_gen/sdf/finalize.glsl"))
	var finalize_ping_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, ping_tex),
		GPU.create_image_uniform(1, input_tex),
		GPU.create_image_uniform(2, sdf_tex)]
	var finalize_pong_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, pong_tex),
		GPU.create_image_uniform(1, input_tex),
		GPU.create_image_uniform(2, sdf_tex)]

	var finalize_uniform_sets: Array[RID] = [
		rd.uniform_set_create(finalize_ping_uniforms, bc_finalize.shader, 0),
		rd.uniform_set_create(finalize_pong_uniforms, bc_finalize.shader, 0)
	]
	GPU.set_resource_name(rd, finalize_uniform_sets[0], "finalize_uniform_set(ping)")
	GPU.set_resource_name(rd, finalize_uniform_sets[1], "finalize_uniform_set(pong)")

	var groups: Vector3i = Vector3i(
		ceili(tex_size.x / 16.0),
		ceili(tex_size.y / 16.0),
		1
	)
	rd.capture_timestamp("sdf_start")

	sc_seed.dispatch(groups)
	@warning_ignore("integer_division")
	var step: int = max(tex_size.x, tex_size.y) / 2
	var in_index: int = 0
	while step >= 1:
		var push: PackedByteArray = PackedByteArray()
		push.resize(16)
		push.encode_s32(0, step)
		bc_jump_flood.dispatch(groups, {0: jump_flood_uniform_sets[in_index]}, push)
		step /= 2
		in_index = (in_index + 1) % 2

	bc_finalize.dispatch(groups, {0: finalize_uniform_sets[in_index]})

	rd.capture_timestamp("sdf_end")

	if rd != RenderingServer.get_rendering_device():
		rd.submit()
		rd.sync()




	var data: PackedByteArray = rd.texture_get_data(sdf_tex, 0)

	for rid: RID in jump_flood_uniform_sets:
		GPU.rid_safe_free(rd, rid)
	for rid: RID in finalize_uniform_sets:
		GPU.rid_safe_free(rd, rid)

	sc_seed.free_rids()
	bc_jump_flood.free_rids()
	bc_finalize.free_rids()

	GPU.rid_safe_free(rd, input_tex)
	GPU.rid_safe_free(rd, ping_tex)
	GPU.rid_safe_free(rd, pong_tex)
	GPU.rid_safe_free(rd, sdf_tex)



	return data

static func generate_flow_field(input_data: PackedByteArray, tex_size: Vector2i, work_rd: RenderingDevice = null) -> PackedByteArray:
	var rd: RenderingDevice = work_rd
	if !rd:
		rd = RenderingServer.create_local_rendering_device()
	var input_tex: RID
	var tv: = RDTextureView.new()
	var input_tf: RDTextureFormat = RDTextureFormat.new()
	input_tf.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM
	input_tf.width = tex_size.x
	input_tf.height = tex_size.y
	input_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)
	input_tex = GPU.texture_create(rd, "flow_input_tex", input_tf, tv, [input_data])

	var ping_pong_tf: RDTextureFormat = RDTextureFormat.new()
	ping_pong_tf.width = input_tf.width
	ping_pong_tf.height = input_tf.height
	ping_pong_tf.format = RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT
	ping_pong_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)

	var ping_tex: RID = GPU.texture_create(rd, "flow_ping_tex", ping_pong_tf, tv)
	var pong_tex: RID = GPU.texture_create(rd, "flow_pong_tex", ping_pong_tf, tv)

	var flow_tf: RDTextureFormat = RDTextureFormat.new()
	flow_tf.width = input_tf.width
	flow_tf.height = input_tf.height
	flow_tf.format = RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT
	flow_tf.usage_bits = (RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT |
		RenderingDevice.TEXTURE_USAGE_STORAGE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT |
		RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT)
	var flow_tex: RID = GPU.texture_create(rd, "flow_result_tex", flow_tf, tv)

	var sc_seed: GPU.SimpleCompute = GPU.SimpleCompute.new(rd, "flow_seed", load("res://shaders/world_gen/flow_field/seed.glsl"),
		{
			0: GPU.UniformsArray.new([
				GPU.create_image_uniform(0, input_tex),
				GPU.create_image_uniform(1, ping_tex)
			])
		}
	)

	var bc_extend: GPU.BaseCompute = GPU.BaseCompute.new(rd, "flow_extend", load("res://shaders/world_gen/flow_field/extend.glsl"))
	var ping_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, ping_tex),
		GPU.create_image_uniform(1, pong_tex)]
	var pong_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, pong_tex),
		GPU.create_image_uniform(1, ping_tex)]

	var extend_uniform_sets: Array[RID] = [
		rd.uniform_set_create(ping_uniforms, bc_extend.shader, 0),
		rd.uniform_set_create(pong_uniforms, bc_extend.shader, 0)
	]

	for i: int in extend_uniform_sets.size():
		GPU.set_resource_name(rd, extend_uniform_sets[i], "flow_extend_uniform_set#%d" % i)

	var bc_finalize: GPU.BaseCompute = GPU.BaseCompute.new(rd, "flow_finalize", load("res://shaders/world_gen/flow_field/finalize.glsl"))
	var finalize_ping_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, input_tex),
		GPU.create_image_uniform(1, ping_tex),
		GPU.create_image_uniform(2, flow_tex)]
	var finalize_pong_uniforms: Array[RDUniform] = [
		GPU.create_image_uniform(0, input_tex),
		GPU.create_image_uniform(1, pong_tex),
		GPU.create_image_uniform(2, flow_tex),
	]

	var finalize_uniform_sets: Array[RID] = [
		rd.uniform_set_create(finalize_ping_uniforms, bc_finalize.shader, 0),
		rd.uniform_set_create(finalize_pong_uniforms, bc_finalize.shader, 0)
	]

	for i: int in finalize_uniform_sets.size():
		GPU.set_resource_name(rd, finalize_uniform_sets[i], "flow_finalize_uniform_set#%d" % i)


	var groups: Vector3i = Vector3i(
		ceili(input_tf.width / 16.0),
		ceili(input_tf.height / 16.0),
		1
	)

	rd.capture_timestamp("flow_start")
	sc_seed.dispatch(groups)

	var max_passes: = 512
	for i: int in max_passes:
		bc_extend.dispatch(groups, {0: extend_uniform_sets[i % 2]})

	bc_finalize.dispatch(groups, {0: finalize_uniform_sets[max_passes % 2]})
	rd.capture_timestamp("flow_end")

	if rd != RenderingServer.get_rendering_device():
		rd.submit()
		rd.sync()




	var data: PackedByteArray = rd.texture_get_data(flow_tex, 0)

	for rid: RID in extend_uniform_sets:
		GPU.rid_safe_free(rd, rid)
	for rid: RID in finalize_uniform_sets:
		GPU.rid_safe_free(rd, rid)

	sc_seed.free_rids()
	bc_extend.free_rids()
	bc_finalize.free_rids()

	GPU.rid_safe_free(rd, input_tex)
	GPU.rid_safe_free(rd, ping_tex)
	GPU.rid_safe_free(rd, pong_tex)
	GPU.rid_safe_free(rd, flow_tex)

	return data


static func get_gpu_duration_ms(rd: RenderingDevice, start_name: String, end_name: String) -> float:
	var timestamp_count: int = rd.get_captured_timestamps_count()

	var start_time: int = 0
	var end_time: int = 0
	for i: int in timestamp_count:
		var name: String = rd.get_captured_timestamp_name(i)
		var time: int = rd.get_captured_timestamp_gpu_time(i)
		if name == start_name:
			start_time = time
		elif name == end_name:
			end_time = time
		if start_time > 0 and end_time > 0:
			break



	var duration_ns: int = end_time - start_time
	var duration_ms: float = duration_ns / 1000000.0
	return duration_ms
