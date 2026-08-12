#[compute]
#version 450


layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

struct Contact
{
    vec2 world_pos;
    int self_id;
    int other_id;
};

layout(set = 2, binding = 2, std430) buffer ContactsPreFiltered
{
    int contact_bucket_meta[];
} _22;

layout(set = 2, binding = 3, std430) buffer ContactsPreFilteredData
{
    uvec2 contact_bucket_data[];
} _49;

layout(set = 2, binding = 0, std430) buffer ContactCount
{
    uint contact_count;
    uint _contact_count_pad0;
    uint _contact_count_pad1;
    uint _contact_count_pad2;
} _107;

layout(set = 2, binding = 1, std430) buffer Contacts
{
    Contact contacts[];
} _119;

layout(set = 2, binding = 4, std430) buffer ContactHandlerDamageReadback
{
    uint write_index;
    uint _padding1;
    uint _padding2;
    uint _padding3;
    int data[];
} contact_handler_damage_readback;

void main()
{
    uint local = gl_LocalInvocationID.x;
    int id = _22.contact_bucket_meta[local];
    int count = _22.contact_bucket_meta[128u + local];
    if (id >= 0)
    {
        uint base_offset = local * 64u;
        uvec2 min_value = _49.contact_bucket_data[base_offset + 0u];
        uint iterations = min(uint(count), 64u);
        for (uint i = 1u; i < iterations; i++)
        {
            if (_49.contact_bucket_data[base_offset + i].x < min_value.x)
            {
                min_value = _49.contact_bucket_data[base_offset + i];
            }
        }
        Contact contact;
        contact.world_pos = vec2(0.0);
        contact.self_id = id;
        contact.other_id = int(min_value.y);
        uint _109 = atomicAdd(_107.contact_count, 1u);
        uint contact_id = _109;
        if (contact_id < 32768u)
        {
            _119.contacts[contact_id].world_pos = contact.world_pos;
            _119.contacts[contact_id].self_id = contact.self_id;
            _119.contacts[contact_id].other_id = contact.other_id;
        }
    }
}
