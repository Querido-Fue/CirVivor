import { buildCeramicGeometry } from './ceramic_world_geometry.js';
import { LAB_STATIC_WGSL, LAB_BODY_WGSL, LAB_BODY_VERTEX_COUNT, LAB_COMPOSITE_WGSL } from './ceramic_world_shaders.js';
import { CERAMIC_VFX_WGSL } from './ceramic_vfx_wgsl.js';

/** Owns presentation resources only. Engine buffers are borrowed read-only. */
export class CeramicWorldRenderer {
    constructor(platform, composer, camera, tileMap, options = {}) {
        this.platform=platform; this.composer=composer; this.camera=camera;
        this.geometry=buildCeramicGeometry(tileMap); this.ownsFrame=options.ownsFrame===true;
        this.device=null; this.targets=null; this.resources=[];
        this.params=new Float32Array(8); this.paramWords=new Uint32Array(this.params.buffer);
        this.clock={}; this.drawCalls=0; this.frame=0;
    }

    #buffer(device,data,usage) {
        const buffer=device.createBuffer({size:data.byteLength,usage});
        this.resources.push(buffer); device.queue.writeBuffer(buffer,0,data); return buffer;
    }

    #initialize(simulation) {
        const device=simulation.device;
        if(this.device===device && this.sourceGroup===simulation.bindGroups.renderBodies) return;
        this.destroy(); this.device=device; this.sourceGroup=simulation.bindGroups.renderBodies;
        try {
        const format=this.platform.getState().format;
        const uniformUsage=GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST;
        this.view=this.#buffer(device,this.camera.uniform,uniformUsage);
        this.renderParams=this.#buffer(device,this.params,uniformUsage);
        this.vertices=this.#buffer(device,this.geometry,GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
        const viewLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}]});
        this.viewGroup=device.createBindGroup({layout:viewLayout,entries:[{binding:0,resource:{buffer:this.view}}]});
        this.paramsGroup=device.createBindGroup({layout:simulation.pipelines.render.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:this.renderParams}}]});
        const bodyLayout=device.createPipelineLayout({bindGroupLayouts:[simulation.pipelines.render.getBindGroupLayout(0),simulation.pipelines.render.getBindGroupLayout(1),viewLayout]});
        const body=device.createShaderModule({label:'lab-body-shader',code:LAB_BODY_WGSL});
        const scene=device.createShaderModule({label:'lab-scene-shader',code:LAB_STATIC_WGSL});
        const depthStencil={format:'depth24plus',depthWriteEnabled:true,depthCompare:'less-equal'};
        const multisample={count:4};
        const blend={color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}};
        this.bodyPipeline=device.createRenderPipeline({label:'ceramic-body',layout:bodyLayout,vertex:{module:body,entryPoint:'lab_body_vertex'},fragment:{module:body,entryPoint:'lab_body_fragment',targets:[{format,blend}]},primitive:{topology:'triangle-list'},depthStencil,multisample});
        this.shadowPipeline=device.createRenderPipeline({label:'lab-shadows',layout:bodyLayout,vertex:{module:body,entryPoint:'lab_shadow_vertex'},fragment:{module:body,entryPoint:'lab_shadow_fragment',targets:[{format,blend}]},primitive:{topology:'triangle-list'},depthStencil:{...depthStencil,depthWriteEnabled:false},multisample});
        this.scenePipeline=device.createRenderPipeline({label:'lab-platform',layout:device.createPipelineLayout({bindGroupLayouts:[viewLayout]}),vertex:{module:scene,entryPoint:'scene_vertex',buffers:[{arrayStride:36,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x3'},{shaderLocation:2,offset:24,format:'float32x3'}]}]},fragment:{module:scene,entryPoint:'scene_fragment',targets:[{format}]},primitive:{topology:'triangle-list'},depthStencil,multisample});
        const composite=device.createShaderModule({code:LAB_COMPOSITE_WGSL});
        this.compositePipeline=device.createRenderPipeline({layout:'auto',vertex:{module:composite,entryPoint:'vs'},fragment:{module:composite,entryPoint:'fs',targets:[{format}]}});
        this.format=format;
        const vfxLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}}]});
        const vfx=device.createShaderModule({label:'ceramic-vfx',code:CERAMIC_VFX_WGSL});
        this.vfxPipeline=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[vfxLayout,viewLayout]}),vertex:{module:vfx,entryPoint:'vs'},fragment:{module:vfx,entryPoint:'fs',targets:[{format,blend}]},depthStencil:{...depthStencil,depthWriteEnabled:false},multisample});
        this.vfxRecordLayout=vfxLayout;this.vfxRecords=null;this.vfxGroup=null;
        } catch(error) {
            this.destroy();
            throw error;
        }
    }

    #resize() {
        const {width,height}=this.camera;
        if(this.targets?.width===width && this.targets?.height===height) return;
        this.targets?.color.destroy(); this.targets?.depth.destroy(); this.targets?.multisampled.destroy();
        this.targets=null;
        const allocated=[];
        const create=descriptor=>{const texture=this.device.createTexture(descriptor);allocated.push(texture);return texture;};
        try {
        const color=create({size:[width,height],format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
        const depth=create({size:[width,height],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
        const multisampled=create({size:[width,height],sampleCount:4,format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
        this.targets={width,height,color,depth,multisampled,colorView:color.createView(),depthView:depth.createView(),multisampledView:multisampled.createView()};
        this.compositeGroup=this.device.createBindGroup({layout:this.compositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.targets.colorView}]});
        } catch(error) {
            for(const texture of allocated)texture.destroy();
            this.targets=null;
            throw error;
        }
    }

    draw(simulation) {
        if(this.camera.width<=0 || this.camera.height<=0)return false;
        if(!simulation?.device || !simulation.bindGroups?.renderBodies) return false;
        if(simulation.device!==this.platform.getDevice()) return false;
        this.#initialize(simulation); this.#resize();
        simulation.presentationClock.getShaderState(this.clock);
        this.params.set([0,0,this.camera.width,this.camera.height,this.camera.scale,this.clock.predictionDelta,this.clock.interpolationAlpha,0]);
        this.paramWords[7]=this.clock.presentationMode;
        this.device.queue.writeBuffer(this.view,0,this.camera.uniform);
        this.device.queue.writeBuffer(this.renderParams,0,this.params);
        const vfx=simulation.transientVfxRuntime;
        if(vfx?.state==='ready' && vfx.buffers.records!==this.vfxRecords){
            this.vfxRecords=vfx.buffers.records;
            this.vfxGroup=this.device.createBindGroup({layout:this.vfxRecordLayout,entries:[{binding:0,resource:{buffer:this.vfxRecords}}]});
        }
        const composer=this.composer;
        if(this.ownsFrame) composer.beginFrame(++this.frame);
        else if(!composer.isFrameActive()) return false;
        try {
            const recorded=composer.encodeCommands(({encoder})=>{
                const pass=encoder.beginRenderPass({label:'lab-world-depth',colorAttachments:[{view:this.targets.multisampledView,resolveTarget:this.targets.colorView,clearValue:{r:0.027,g:0.044,b:0.060,a:1},loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:this.targets.depthView,depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'}});
                pass.setPipeline(this.scenePipeline);pass.setBindGroup(0,this.viewGroup);pass.setVertexBuffer(0,this.vertices);pass.draw(this.geometry.length/9);
                pass.setPipeline(this.shadowPipeline);pass.setBindGroup(0,this.sourceGroup);pass.setBindGroup(1,this.paramsGroup);pass.setBindGroup(2,this.viewGroup);pass.draw(6,simulation.bodyCount);
                pass.setPipeline(this.bodyPipeline);pass.draw(LAB_BODY_VERTEX_COUNT,simulation.bodyCount);
                if(vfx?.state==='ready' && this.vfxGroup){
                    pass.setPipeline(this.vfxPipeline);pass.setBindGroup(0,this.vfxGroup);pass.setBindGroup(1,this.viewGroup);pass.drawIndirect(vfx.buffers.drawIndirect,0);
                }
                pass.end();
            });
            if(!recorded) throw new Error('입체 월드 패스 기록 실패');
            const composited=composer.encodeCanvasPass((pass)=>{pass.setPipeline(this.compositePipeline);pass.setBindGroup(0,this.compositeGroup);pass.draw(3);});
            if(!composited || (this.ownsFrame && !composer.commit())) throw new Error('입체 프레임 제출 실패');
            this.drawCalls=vfx?.state==='ready'?5:4;return true;
        } catch(error) {if(this.ownsFrame) composer.abort('ceramic-render-failed');throw error;}
    }

    destroy() {
        this.targets?.color.destroy();this.targets?.depth.destroy();this.targets?.multisampled.destroy();this.targets=null;
        for(const resource of this.resources) resource.destroy();
        this.resources.length=0;this.device=null;this.sourceGroup=null;
    }
}

