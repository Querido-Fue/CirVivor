import { CERAMIC_MATERIAL_COLORS as colors } from 'data/theme/ceramic_world_visual_data.js';

const material = name => `vec3f(${colors[name].join(',')})`;

/** Extrudes the canonical masks, including holes and occupied Formation cells.
 * Six vertices per GPU slot; fragment work is bounded and writes real world depth.
 */
export const CERAMIC_BODY_GEOMETRY_WGSL = /* wgsl */`
struct CeramicBodyVertex {
    @builtin(position) position: vec4f,
    @location(0) ray_origin: vec3f,
    @location(1) @interpolate(flat) center_radius: vec4f,
    @location(2) @interpolate(flat) color: vec4f,
    @location(3) @interpolate(flat) facing: vec2f,
    @location(4) @interpolate(flat) traits: vec4u,
    @location(5) @interpolate(flat) style: vec4f,
}
@vertex fn lab_body_vertex(@builtin(vertex_index) vi:u32,@builtin(instance_index) instance:u32)->CeramicBodyVertex {
    let state=resolve_body_render_vertex(0u,instance);
    let v=state.vertex;
    var out:CeramicBodyVertex;
    out.position=vec4f(2,2,0,1);
    if(v.color.a<=0.0 || state.world_radius<=0.0){return out;}
    let tower=v.glow_kind==ENTITY_GLOW_KIND_TOWER;
    let projectile=(physics.values[instance].interaction_meta & BODY_LAYER_PROJECTILE)!=0u;
    var shape=v.shape_code;
    if(tower || projectile){shape=RENDER_SHAPE_CIRCLE;}
    let h=select(1.25,2.8,tower);
    let base=select(0.05,0.55,projectile);
    let r=state.world_radius;
    let center=vec3f(state.world_center,base);
    let toward_camera=-normalize(lab.depth.xyz);
    let right=normalize(lab.x.xyz);
    let up=normalize(lab.y.xyz);
    let local=QUAD_VERTICES[vi];
    let origin=center+vec3f(0,0,h*r*0.5)+(right*local.x+up*local.y)*r*2.1+toward_camera*r*3.2;
    out.position=lab_project(origin);out.ray_origin=(origin-center)/r;
    out.center_radius=vec4f(center,r);out.facing=v.velocity;
    out.traits=vec4u(shape,v.formation_occupied_mask,v.formation_member_count,v.effect_presentation_tags);
    out.style=vec4f(h,v.health_ratio,f32(v.directional_defense_active),f32(v.formation_presentation_flags));
    var color=${material('square')};
    if(shape==RENDER_SHAPE_TRIANGLE){color=${material('triangle')};}
    if(shape==RENDER_SHAPE_ARROW){color=${material('arrow')};}
    if(shape==RENDER_SHAPE_PENTA){color=${material('penta')};}
    if(shape==RENDER_SHAPE_HEXA){color=${material('hexa')};}
    if(shape==RENDER_SHAPE_JORANG){color=${material('jorang')};}
    if(shape==RENDER_SHAPE_OCTA){color=${material('octa')};}
    if(shape==RENDER_SHAPE_RING){color=${material('ring')};}
    if(shape==RENDER_SHAPE_CORK){color=${material('cork')};}
    if(tower){color=${material('tower')};}
    if(projectile){color=${material('projectile')};}
    // Keep the authoritative Arrow windup telegraph selected by the shared resolver.
    let behavior=enemy_behavior_states.values[instance];
    if(behavior.program_id==ENEMY_BEHAVIOR_PROGRAM_ARROW_TOWER_CHARGE && behavior.state==ENEMY_BEHAVIOR_STATE_WINDUP && behavior.telegraph_style_code!=0u){color=v.color.rgb;}
    out.color=vec4f(color,v.color.a);
    return out;
}
fn ceramic_mask(p:vec2f,v:CeramicBodyVertex)->f32 {
    if(v.traits.x==RENDER_SHAPE_HEXA && v.traits.z>1u){
        var d=formation_mask_distance(p,v.traits.y);
        d=min(d,formation_member_link_distance(p,v.traits.y)-0.025);
        if(v.traits.z==6u){d=min(d,box_distance(p,vec2f(0,0.86),vec2f(0.68,0.065)));}
        return d;
    }
    return shape_distance(p,v.facing,v.traits.x);
}
fn ceramic_distance(p:vec3f,v:CeramicBodyVertex)->f32 {
    let bevel=0.055;
    let d=vec2f(ceramic_mask(p.xy,v)+bevel,abs(p.z-v.style.x*0.5)-v.style.x*0.5+bevel);
    return min(max(d.x,d.y),0.0)+length(max(d,vec2f(0)))-bevel;
}
struct CeramicFragment { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
@fragment fn lab_body_fragment(v:CeramicBodyVertex)->CeramicFragment {
    if(v.color.a<=0.01){discard;}
    let direction=normalize(lab.depth.xyz);
    var p=v.ray_origin;
    var travel=0.0;
    var hit=false;
    for(var step=0u;step<48u;step++){
        let d=ceramic_distance(p,v);
        if(d<0.008){hit=true;break;}
        travel+=max(d,0.008);p=v.ray_origin+direction*travel;
        if(travel>8.0){break;}
    }
    if(!hit){discard;}
    let e=0.012;
    let n=normalize(vec3f(
        ceramic_distance(p+vec3f(e,0,0),v)-ceramic_distance(p-vec3f(e,0,0),v),
        ceramic_distance(p+vec3f(0,e,0),v)-ceramic_distance(p-vec3f(0,e,0),v),
        ceramic_distance(p+vec3f(0,0,e),v)-ceramic_distance(p-vec3f(0,0,e),v)));
    var rgb=lab_light(n,v.color.rgb);
    let edge=abs(ceramic_mask(p.xy,v));
    if(n.z>0.9){
        rgb=mix(rgb,vec3f(0.07,0.12,0.15),(1.0-smoothstep(0.16,0.24,length(p.xy)))*0.85);
        rgb+=vec3f(0.45,0.92,0.89)*(1.0-smoothstep(0.055,0.085,length(p.xy)));
    }
    if(v.traits.x==RENDER_SHAPE_OCTA && v.style.z>0.5){
        let oriented=directional_local_position(p.xy,v.facing);
        if(length(oriented)>0.001 && normalize(oriented).y>=cos(3.0*3.14159265/8.0)){
            rgb=mix(rgb,vec3f(0.38,0.94,1.0),(1.0-smoothstep(0.04,0.12,edge))*0.85);
        }
    }
    if(v.traits.x==RENDER_SHAPE_HEXA && v.traits.z==6u && p.y>0.795 && abs(p.x)<0.68){
        rgb=select(vec3f(0.08,0.055,0.04),vec3f(0.3,1.0,0.38),(p.x+0.68)/1.36<v.style.y);
    }
    if((v.traits.w&EFFECT_PRESENTATION_TAG_BOOST)!=0u){rgb=mix(rgb,vec3f(0.04,0.88,1.0),(1.0-smoothstep(0.03,0.13,edge))*0.7);}
    if((v.traits.w&EFFECT_PRESENTATION_TAG_PULSE)!=0u || (u32(v.style.w)&FORMATION_FLAG_MERGE_PULSE)!=0u){rgb+=vec3f(0.08,0.8,0.62)*(1.0-smoothstep(0.04,0.16,edge));}
    let world=v.center_radius.xyz+p*v.center_radius.w;
    return CeramicFragment(vec4f(rgb*v.color.a,v.color.a),clamp(lab_project(world).z,0.0,1.0));
}
`;
