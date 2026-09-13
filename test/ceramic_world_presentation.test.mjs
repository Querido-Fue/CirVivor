import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { WorldCamera2D }=await loadGameModule('ingame/map/world_camera_2d.js');
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test('production depth activation preserves follow center and is idempotent',()=>{
    const camera=new WorldCamera2D();camera.init({width:63,height:45},{ww:1440,wh:900});
    camera.centerOnWorldPoint(51,27);camera.enableDepthPresentation();
    const center=camera.viewportToWorld(720,450);near(center.x,51);near(center.y,27);
    const depth=camera.depthView;camera.enableDepthPresentation();assert.strictEqual(camera.depthView,depth);
    assert.equal(depth.uniform[15],1);
});

test('production depth projection shares GPU rows and input inverse through zoom, follow and resize',()=>{
    const camera=new WorldCamera2D();camera.init({width:63,height:45},{ww:1440,wh:900});camera.enableDepthPresentation();
    for(const [width,height] of [[1440,900],[1280,800],[3840,2160],[900,1440]]) {
        camera.resize({ww:width,wh:height});
        for(const zoom of [.4,.7,1,2]) {
            camera.zoom=zoom;camera.centerOnWorldPoint(51,27);
            const center=camera.viewportToWorld(width/2,height/2);near(center.x,51);near(center.y,27);
            for(const [x,y] of [[0,0],[63,45],[51,27],[15.5,20.5]]) {
                const p=camera.worldToViewport(x,y),q=camera.viewportToWorld(p.x,p.y);
                near(q.x,x);near(q.y,y);
                const u=camera.depthView.uniform;
                assert.ok(Math.abs(((u[0]*x+u[1]*y+u[3])+1)*width/2-p.x)<.003);
                assert.ok(Math.abs((1-(u[4]*x+u[5]*y+u[7]))*height/2-p.y)<.003);
                assert.ok(u[10]<0,'raised bodies are closer to the camera');
            }
            const bounds=camera.getViewBounds();
            for(const [x,y] of [[0,0],[width,0],[0,height],[width,height]]) {
                const p=camera.viewportToWorld(x,y);
                assert.ok(p.x>=bounds.left-1e-9&&p.x<=bounds.right+1e-9&&p.y>=bounds.top-1e-9&&p.y<=bounds.bottom+1e-9);
            }
            camera.depthView.uniform[15]=.35;camera.zoom=.9;
            assert.ok(Math.abs(camera.depthView.uniform[15]-.35)<1e-6);
        }
    }
});

test('benchmark cameras retain the flat projection unless explicitly enabled',()=>{
    const camera=new WorldCamera2D();camera.init({width:63,height:45},{ww:1440,wh:900});
    assert.equal(camera.depthView,null);
    const p=camera.worldToViewport(5,7);
    near(p.x,camera.offsetX+5*camera.scale);near(p.y,camera.offsetY+7*camera.scale);
});

test('ceramic pipeline initialization failure releases partial allocations and permits retry',async()=>{
    const { CeramicWorldRenderer }=await loadGameModule('ingame/render/ceramic_world_renderer.js');
    const originalUsage=globalThis.GPUBufferUsage,originalStages=globalThis.GPUShaderStage;
    globalThis.GPUBufferUsage={UNIFORM:64,COPY_DST:8,VERTEX:32};
    globalThis.GPUShaderStage={VERTEX:1,FRAGMENT:2};
    const buffers=[];
    const device={
        queue:{writeBuffer(){}},
        createBuffer(){const b={destroyed:false,destroy(){this.destroyed=true;}};buffers.push(b);return b;},
        createBindGroupLayout(){return {};},createBindGroup(){return {};},createPipelineLayout(){return {};},
        createShaderModule(){throw new Error('injected allocation failure');}
    };
    const tileMap={getNavigationGrid:()=>({rows:1,cols:1,cellSize:1,blocked:[0]}),getCorePosition:()=>({x:.5,y:.5}),getSpawnRoutes:()=>[]};
    const renderer=new CeramicWorldRenderer({getState:()=>({format:'bgra8unorm'}),getDevice:()=>device},{},{width:100,height:100,uniform:new Float32Array(20)},tileMap);
    const simulation={device,bindGroups:{renderBodies:{}},pipelines:{render:{getBindGroupLayout:()=>({})}}};
    try {
        for(let attempt=0;attempt<2;attempt++) {
            assert.throws(()=>renderer.draw(simulation),/injected allocation failure/);
            assert.equal(renderer.resources.length,0);assert.equal(renderer.device,null);
            assert.ok(buffers.every(buffer=>buffer.destroyed));
        }
        assert.equal(buffers.length,6,'retry rebuilds all three owned buffers');
    } finally {
        renderer.destroy();
        if(originalUsage===undefined)delete globalThis.GPUBufferUsage;else globalThis.GPUBufferUsage=originalUsage;
        if(originalStages===undefined)delete globalThis.GPUShaderStage;else globalThis.GPUShaderStage=originalStages;
    }
});
