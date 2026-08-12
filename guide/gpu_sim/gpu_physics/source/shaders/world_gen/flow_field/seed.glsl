#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(set = 0, binding = 0, rgba8) uniform readonly image2D input_tex;
layout(set = 0, binding = 1, rgba16f) uniform writeonly image2D seed_tex;

bool is_target(vec4 c)
{
    return c.x > 0.5;
}

bool is_inside(vec4 c)
{
    return c.z > 0.5;
}

void main()
{
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec4 c = imageLoad(input_tex, pos);
    vec4 param = c;
    bool target = is_target(param);
    vec4 param_1 = c;
    bool inside = is_inside(param_1);
    vec4 out_color = vec4(100000.0, 100000.0, 100000.0, inside ? (-1.0) : 0.0);
    if (target)
    {
        out_color.x = 0.0;
        out_color.y = 0.0;
        out_color.z = 0.0;
    }
    imageStore(seed_tex, pos, out_color);
}
