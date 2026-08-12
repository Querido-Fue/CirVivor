#[compute]
#version 450


layout(local_size_x = 1, local_size_y = 1, local_size_z = 1) in;

layout(set = 0, binding = 1, std430) writeonly buffer Groups
{
    uvec3 groups;
} _10;

layout(set = 0, binding = 0, std430) readonly buffer Count
{
    uint counts[];
} _16;

layout(push_constant, std430) uniform PushConstants
{
    uint group_size_x;
    uint count_offset;
} pc;

void main()
{
    _10.groups = uvec3(uint(ceil(float(_16.counts[pc.count_offset]) / float(pc.group_size_x))), 1u, 1u);
}
