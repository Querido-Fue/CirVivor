import { CERAMIC_BODY_GEOMETRY_WGSL } from './ceramic_body_geometry_wgsl.js';
import { GPU_COLLISION_RENDER_WGSL } from '../physics/gpu/shaders/collision_render.js';

import { projection } from './ceramic_projection_wgsl.js';
export const LAB_STATIC_WGSL = /* wgsl */`
@group(0) @binding(0) var<uniform> lab: LabView;
${projection}
@vertex fn scene_vertex(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) color:vec3f) -> LitVertex {
    return LitVertex(lab_project(p),n,vec4f(color,1.0),p,vec2f(0.0));
}
@fragment fn scene_fragment(v:LitVertex) -> @location(0) vec4f {
    var rgb=lab_light(v.normal,v.color.rgb);
    if(v.color.g>0.9 && v.world.z>0.4){rgb=mix(vec3f(0.65,0.12,0.08),rgb,lab.viewport.w);}
    let d=length(v.world.xy-lab.cursor.xy);
    let aa=max(fwidth(d),0.005);
    let ring=1.0-smoothstep(0.025,0.025+aa,abs(d-0.45));
    if(v.world.z > -0.04 && v.world.z < 0.02 && lab.cursor.z>0.5) {
        rgb=mix(rgb,vec3f(0.03,0.85,0.95),ring*0.9);
    }
    return vec4f(rgb,1.0);
}
`;

export const LAB_BODY_VERTEX_COUNT = 6;
export const LAB_BODY_WGSL = `${GPU_COLLISION_RENDER_WGSL}
@group(2) @binding(0) var<uniform> lab: LabView;
${projection}
${CERAMIC_BODY_GEOMETRY_WGSL}
@vertex fn lab_shadow_vertex(@builtin(vertex_index) vi:u32,@builtin(instance_index) instance:u32)->LitVertex {
    let state=resolve_body_render_vertex(0u,instance);
    let local=QUAD_VERTICES[vi]*1.65;
    let world=vec3f(state.world_center+(local+vec2f(0.18,0.25))*state.world_radius,0.025);
    return LitVertex(lab_project(world),vec3f(0,0,1),state.vertex.color,world,local);
}
@fragment fn lab_shadow_fragment(v:LitVertex)->@location(0) vec4f {
    let alpha=(1.0-smoothstep(0.35,1.55,length(v.local)))*0.22*v.color.a;
    if(alpha<0.005){discard;}
    return vec4f(vec3f(0.035,0.065,0.075)*alpha,alpha);
}
`;

export const LAB_COMPOSITE_WGSL = /* wgsl */`
@group(0) @binding(0) var scene:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
    let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
    return textureLoad(scene,vec2i(p.xy),0);
}
`;


