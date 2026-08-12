#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

layout(set = 0, binding = 1, rgba16f) uniform readonly image2D seed_tex;
layout(set = 0, binding = 0, rgba8) uniform readonly image2D input_tex;
layout(set = 0, binding = 2, rgba16f) uniform writeonly image2D flow_tex;

bool is_target(vec4 c)
{
    return c.x > 0.5;
}

float getCost(ivec2 p)
{
    bool _34 = p.x < 0;
    bool _42;
    if (!_34)
    {
        _42 = p.y < 0;
    }
    else
    {
        _42 = _34;
    }
    bool _55;
    if (!_42)
    {
        _55 = p.x >= imageSize(seed_tex).x;
    }
    else
    {
        _55 = _42;
    }
    bool _65;
    if (!_55)
    {
        _65 = p.y >= imageSize(seed_tex).y;
    }
    else
    {
        _65 = _55;
    }
    if (_65)
    {
        return 100000.0;
    }
    return imageLoad(seed_tex, p).x;
}

void main()
{
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec4 i = imageLoad(input_tex, pos);
    vec4 param = i;
    if (is_target(param))
    {
        imageStore(flow_tex, pos, vec4(0.0, 0.0, 1.0, 0.0));
        return;
    }
    ivec2 param_1 = pos + ivec2(1, 0);
    ivec2 param_2 = pos + ivec2(-1, 0);
    float dx = getCost(param_1) - getCost(param_2);
    ivec2 param_3 = pos + ivec2(0, 1);
    ivec2 param_4 = pos + ivec2(0, -1);
    float dy = getCost(param_3) - getCost(param_4);
    vec2 dir = normalize(-vec2(dx, dy));
    bool _143 = all(lessThanEqual(abs(dir), vec2(0.60000002384185791015625)));
    bool _150;
    if (!_143)
    {
        _150 = any(isnan(dir));
    }
    else
    {
        _150 = _143;
    }
    if (_150)
    {
        dir = vec2(1.0, 0.0);
    }
    imageStore(flow_tex, pos, vec4(dir, 0.0, 0.0));
}
