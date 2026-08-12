#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(set = 0, binding = 0, rg32f) uniform readonly image2D seed_tex;
layout(set = 0, binding = 1, rgba8) uniform readonly image2D input_tex;
layout(set = 0, binding = 2, r32f) uniform writeonly image2D sdf_tex;

bool is_inside(vec4 c)
{
    return c.z > 0.5;
}

void main()
{
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec2 nearest = imageLoad(seed_tex, pos).xy;
    vec2 p = vec2(pos) + vec2(0.5);
    float d = length(nearest - p);
    vec4 param = imageLoad(input_tex, pos);
    bool inside = is_inside(param);
    float _66;
    if (inside)
    {
        _66 = -d;
    }
    else
    {
        _66 = d;
    }
    float sdf = _66;
    imageStore(sdf_tex, pos, vec4(sdf));
}
