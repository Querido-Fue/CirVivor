#[compute]
#version 450


layout(local_size_x = 1, local_size_y = 1, local_size_z = 1) in;

layout(set = 0, binding = 1, std430) writeonly buffer Groups
{
    uint vertex_count;
    uint instance_count;
    uint first_vertex;
    uint first_instance;
} _9;

layout(set = 0, binding = 0, std430) readonly buffer Count
{
    uint counts[];
} _15;

layout(push_constant, std430) uniform PushConstants
{
    uint count_offset;
} pc;

void main()
{
    _9.instance_count = _15.counts[pc.count_offset];
}
