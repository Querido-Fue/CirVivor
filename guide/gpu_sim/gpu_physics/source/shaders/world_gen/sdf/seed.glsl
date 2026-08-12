#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

const ivec2 _72[4] = ivec2[](ivec2(0, -1), ivec2(-1, 0), ivec2(1, 0), ivec2(0, 1));

layout(set = 0, binding = 0, rgba8) uniform readonly image2D input_tex;
layout(set = 0, binding = 1, rg32f) uniform writeonly image2D seed_tex;

bool is_inside(vec4 c)
{
    return c.z > 0.5;
}

void main()
{
    ivec2 tex_size = imageSize(input_tex);
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec4 c = imageLoad(input_tex, pos);
    vec4 param = c;
    bool inside = is_inside(param);
    bool boundary = false;
    for (uint i = 0u; i < 4u; i++)
    {
        ivec2 np = pos + _72[i];
        bool _82 = np.x < 0;
        bool _90;
        if (!_82)
        {
            _90 = np.y < 0;
        }
        else
        {
            _90 = _82;
        }
        bool _99;
        if (!_90)
        {
            _99 = np.x >= tex_size.x;
        }
        else
        {
            _99 = _90;
        }
        bool _108;
        if (!_99)
        {
            _108 = np.y >= tex_size.y;
        }
        else
        {
            _108 = _99;
        }
        if (_108)
        {
            continue;
        }
        vec4 nc = imageLoad(input_tex, np);
        vec4 param_1 = nc;
        if (is_inside(param_1) != inside)
        {
            boundary = true;
        }
    }
    if (inside && boundary)
    {
        vec2 p = vec2(pos) + vec2(0.5);
        imageStore(seed_tex, pos, vec4(p, 0.0, 0.0));
    }
    else
    {
        imageStore(seed_tex, pos, vec4(-1.0));
    }
}
