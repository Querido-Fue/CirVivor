#[compute]
#version 450


layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;

const ivec2 _57[8] = ivec2[](ivec2(-1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0), ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1));
const float _116[8] = float[](1.40999996662139892578125, 1.0, 1.40999996662139892578125, 1.0, 1.0, 1.40999996662139892578125, 1.0, 1.40999996662139892578125);

layout(set = 0, binding = 0, rgba16f) uniform readonly image2D input_tex;
layout(set = 0, binding = 1, rgba16f) uniform writeonly image2D output_tex;

void main()
{
    ivec2 pos = ivec2(gl_GlobalInvocationID.xy);
    vec4 c = imageLoad(input_tex, pos);
    ivec2 tex_size = imageSize(input_tex);
    for (int i = 0; uint(i) < 8u; i++)
    {
        ivec2 np = pos + _57[i];
        bool _67 = np.x < 0;
        bool _76;
        if (!_67)
        {
            _76 = np.x >= tex_size.x;
        }
        else
        {
            _76 = _67;
        }
        bool _84;
        if (!_76)
        {
            _84 = np.y < 0;
        }
        else
        {
            _84 = _76;
        }
        bool _93;
        if (!_84)
        {
            _93 = np.y >= tex_size.y;
        }
        else
        {
            _93 = _84;
        }
        if (_93)
        {
            continue;
        }
        vec4 nc = imageLoad(input_tex, np);
        float penalty = (nc.w < 0.0) ? 1000.0 : 0.0;
        float dist = (nc.x + _116[i]) + penalty;
        if (dist < c.x)
        {
            c.x = dist;
        }
    }
    imageStore(output_tex, pos, c);
}
