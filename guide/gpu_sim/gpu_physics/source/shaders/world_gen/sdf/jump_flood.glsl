#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

const ivec2 _93[8] = ivec2[](ivec2(-1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1));

layout(push_constant, std430) uniform PushConstants
{
    int step_size;
} pc;

layout(set = 0, binding = 0, rg32f) uniform readonly image2D src_tex;
layout(set = 0, binding = 1, rg32f) uniform writeonly image2D dst_tex;

float dist_sq(vec2 a, vec2 b)
{
    vec2 d = a - b;
    return dot(d, d);
}

void main()
{
    ivec2 tex_size = imageSize(src_tex);
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec2 p = vec2(pos) + vec2(0.5);
    vec2 best = imageLoad(src_tex, pos).xy;
    float best_dist = 100000002004087734272.0;
    if (best.x >= 0.0)
    {
        vec2 param = best;
        vec2 param_1 = p;
        best_dist = dist_sq(param, param_1);
    }
    for (uint i = 0u; i < 8u; i++)
    {
        ivec2 np = pos + (_93[i] * ivec2(pc.step_size));
        bool _111 = np.x < 0;
        bool _119;
        if (!_111)
        {
            _119 = np.y < 0;
        }
        else
        {
            _119 = _111;
        }
        bool _128;
        if (!_119)
        {
            _128 = np.x >= tex_size.x;
        }
        else
        {
            _128 = _119;
        }
        bool _137;
        if (!_128)
        {
            _137 = np.y >= tex_size.y;
        }
        else
        {
            _137 = _128;
        }
        if (_137)
        {
            continue;
        }
        vec2 candidate = imageLoad(src_tex, np).xy;
        if (candidate.x < 0.0)
        {
            continue;
        }
        vec2 param_2 = candidate;
        vec2 param_3 = p;
        float d = dist_sq(param_2, param_3);
        if (d < best_dist)
        {
            best_dist = d;
            best = candidate;
        }
    }
    imageStore(dst_tex, pos, vec4(best, 0.0, 0.0));
}
