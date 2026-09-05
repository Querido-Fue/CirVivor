import {
    GPU_CIRCLE_BODY_ABI_VERSION
} from '../gpu_circle_body_abi.js';

export const GPU_COLLISION_INDIRECT_WGSL = /* wgsl */`
const BODY_ABI_VERSION: u32 = ${GPU_CIRCLE_BODY_ABI_VERSION}u;

struct BodyCounts {
    body_count: u32,
    addition_count: u32,
    removal_count: u32,
    abi_version: u32,
}

struct DispatchArgs {
    x: u32,
    y: u32,
    z: u32,
}

struct DispatchArgsBuffer {
    bodies: DispatchArgs,
    contacts: DispatchArgs,
}

struct DrawArgs {
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
}

struct ContactState {
    contact_count: atomic<u32>,
    contact_overflow: atomic<u32>,
    event_count: atomic<u32>,
    event_overflow: atomic<u32>,
    death_count: atomic<u32>,
    death_overflow: atomic<u32>,
    abi_status: atomic<u32>,
    event_encoding_version: atomic<u32>,
    maximum_damage_window_event_count: atomic<u32>,
    maximum_damage_window_protocol_status: atomic<u32>,
    core_damage_request_event_count: atomic<u32>,
    core_damage_request_protocol_status: atomic<u32>,
    atomic_transform_candidate_count: atomic<u32>,
    atomic_transform_event_base: atomic<u32>,
    atomic_transform_protocol_status: atomic<u32>,
    atomic_transform_committed_count: atomic<u32>,
}

struct Contact {
    self_body_id: u32,
    self_incarnation: u32,
    other_body_id: i32,
    other_incarnation: u32,
    world_position: vec2f,
    normal: vec2f,
}

struct ContactBuffer {
    values: array<Contact>,
}

@group(0) @binding(0) var<storage, read> counts: BodyCounts;
@group(0) @binding(1) var<storage, read_write> dispatch_args: DispatchArgsBuffer;
@group(0) @binding(2) var<storage, read_write> draw_args: DrawArgs;
@group(0) @binding(3) var<storage, read_write> contact_state: ContactState;
@group(0) @binding(4) var<storage, read> contacts: ContactBuffer;

@compute @workgroup_size(1)
fn update_indirect_args() {
    if (counts.abi_version != BODY_ABI_VERSION) {
        dispatch_args.bodies.x = 0u;
        dispatch_args.bodies.y = 0u;
        dispatch_args.bodies.z = 0u;
        dispatch_args.contacts.x = 0u;
        dispatch_args.contacts.y = 0u;
        dispatch_args.contacts.z = 0u;
        draw_args.vertex_count = 0u;
        draw_args.instance_count = 0u;
        draw_args.first_vertex = 0u;
        draw_args.first_instance = 0u;
        return;
    }
    dispatch_args.bodies.x = (counts.body_count + 255u) / 256u;
    dispatch_args.bodies.y = 1u;
    dispatch_args.bodies.z = 1u;
    // Contact generation happens later in the fixed-step pass. Clearing the
    // second command here prevents a previous tick from being consumed early.
    dispatch_args.contacts.x = 0u;
    dispatch_args.contacts.y = 0u;
    dispatch_args.contacts.z = 0u;
    draw_args.vertex_count = 6u;
    draw_args.instance_count = counts.body_count;
    draw_args.first_vertex = 0u;
    draw_args.first_instance = 0u;
}

@compute @workgroup_size(1)
fn update_contact_indirect_args() {
    if (counts.abi_version != BODY_ABI_VERSION) {
        dispatch_args.contacts.x = 0u;
        dispatch_args.contacts.y = 0u;
        dispatch_args.contacts.z = 0u;
        return;
    }
    let contact_capacity = arrayLength(&contacts.values);
    let contact_count = min(
        atomicLoad(&contact_state.contact_count),
        contact_capacity
    );
    dispatch_args.contacts.x = (contact_count + 255u) / 256u;
    dispatch_args.contacts.y = 1u;
    dispatch_args.contacts.z = 1u;
}
`;
