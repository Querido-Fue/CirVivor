import { projection } from './ceramic_projection_wgsl.js';
import { GPU_TRANSIENT_VFX_KIND } from '../physics/gpu/gpu_transient_vfx_runtime.js';

/** Read-only view of the existing 48-byte transient VFX record ABI. */
export const CERAMIC_VFX_WGSL = /* wgsl */`
${projection}
struct VfxRecord {position:vec2f,base_radius:f32,remaining:f32,duration:f32,kind:u32,source_tick:u32,reserved:u32,color:vec4f}
struct VfxRecords {values:array<VfxRecord>}
@group(0) @binding(0) var<storage,read> records:VfxRecords;
@group(1) @binding(0) var<uniform> lab:LabView;
struct VfxVertex {@builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) color:vec4f,@location(2) progress:f32,@location(3) @interpolate(flat) kind:u32,@location(4) @interpolate(flat) tick:u32}
@vertex fn vs(@builtin(vertex_index) i:u32,@builtin(instance_index) instance:u32)->VfxVertex {
    let v=records.values[instance];var out:VfxVertex;out.position=vec4f(2,2,0,1);
    if(v.remaining<=0.0 || v.duration<=0.0){return out;}
    let points=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,-1),vec2f(1,1),vec2f(-1,1));
    out.local=points[i];out.progress=clamp(1.0-v.remaining/v.duration,0.0,1.0);out.kind=v.kind;out.tick=v.source_tick;
    let growth=select(1.0+0.18*out.progress,1.0+2.8*out.progress,v.kind==${GPU_TRANSIENT_VFX_KIND.EXPLOSION_RING}u);
    out.position=lab_project(vec3f(v.position+out.local*v.base_radius*growth,0.06));out.color=v.color;
    return out;
}
@fragment fn fs(v:VfxVertex)->@location(0) vec4f {
    let d=length(v.local);var coverage=0.0;
    if(v.kind==${GPU_TRANSIENT_VFX_KIND.EXPLOSION_RING}u){
        let w=mix(0.28,0.07,v.progress);
        coverage=(1.0-smoothstep(w*0.55,w,abs(d-mix(0.28,0.82,v.progress))))*(1.0-smoothstep(0.92,1.0,d));
    }else{
        let cell=floor((v.local+vec2f(1))*9.0);
        let noise=fract(sin(dot(cell,vec2f(12.9898,78.233))+f32(v.tick&1023u))*43758.5453);
        coverage=(1.0-smoothstep(0.76,1.0,d))*step(v.progress*1.1-0.08,noise);
    }
    let alpha=v.color.a*coverage*(1.0-v.progress);
    if(alpha<0.005){discard;}
    return vec4f(v.color.rgb*alpha,alpha);
}
`;
