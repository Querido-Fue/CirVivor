export const projection = /* wgsl */`
struct LabView { x: vec4f, y: vec4f, depth: vec4f, viewport: vec4f, cursor: vec4f }
fn lab_project(p: vec3f) -> vec4f {
    let q=vec4f(p,1.0);
    return vec4f(dot(lab.x,q),dot(lab.y,q),dot(lab.depth,q),1.0);
}
struct LitVertex {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
    @location(1) color: vec4f,
    @location(2) world: vec3f,
    @location(3) local: vec2f,
}
fn lab_light(n: vec3f, color: vec3f) -> vec3f {
    let light=normalize(vec3f(-0.45,-0.55,0.9));
    let diffuse=max(dot(normalize(n),light),0.0);
    let rim=pow(max(dot(normalize(n),normalize(vec3f(0.5,0.2,1.0))),0.0),12.0)*0.10;
    return color*(0.40+0.60*diffuse)+vec3f(rim);
}
`;


