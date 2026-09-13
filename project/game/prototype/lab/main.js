import { GameSystem } from 'ingame/game_system.js';
import { EnemySimulationBackend } from 'ingame/object/enemy/enemy_simulation_backend.js';
import { TileMap } from 'ingame/map/tile_map.js';
import { WebGpuPlatformService } from 'display/webgpu/webgpu_platform_service.js';
import { WebGpuFrameComposer } from 'display/webgpu/webgpu_frame_composer.js';
import { AnimationSystem } from 'animation/animation_system.js';
import { TimeHandler, getDelta, getFixedDelta, getFixedInterpolationAlpha } from 'game/time_handler.js';
import { MathUtil } from 'util/math_util.js';
import { ColorUtil } from 'util/color_util.js';
import { RuntimeTool } from 'util/runtime_tool.js';
import { syncSimulationRuntime } from 'simulation/simulation_runtime.js';
import { FixedStepCatchUpPolicy, countExcessFixedStepDebt } from 'simulation/fixed_step_catch_up_policy.js';
import { normalizeFixedStepResult, FIXED_STEP_RESULT } from 'simulation/fixed_step_result_contract.js';
import { DEFAULT_KEYBOARD_BINDINGS } from 'input/_input_binding_constants.js';
import { LAB_PROTOTYPE_MAP, createLabPrototypeWave } from 'data/scene/game/lab_prototype_data.js';
import { LabCamera } from './lab_camera.js';
import { LabRenderer } from './lab_renderer.js';

const $=(id)=>document.getElementById(id);
const canvas=$('world');
const time=new TimeHandler();new MathUtil();new ColorUtil();new RuntimeTool();
const animations=new AnimationSystem();
const tileMap=new TileMap(LAB_PROTOTYPE_MAP);
const camera=new LabCamera(tileMap.getWorldBounds());
const platform=new WebGpuPlatformService({canvas});
const port=platform.getPort();
const composer=new WebGpuFrameComposer(port);
platform.attachFrameComposer(composer.getPort(),composer);
const renderer=new LabRenderer(port,composer,camera,tileMap);
const policy=new FixedStepCatchUpPolicy();
const keys=new Set();const pointer={x:0,y:0,down:false,inside:false};const ground={x:0,y:0};
let game=null,backend=null,paused=false,failed=false,disposed=false,raf=null;
let previous=0,accumulator=0,previousCpu=0,lastReport=0,lastTick=0;
let frames=[],cpuFrames=[],dropped=0,backpressure=0,clampLoss=0,selectedLoad=120;
const errors=[];let report={status:'initializing'};
const viewport={ww:1,wh:1,uiww:1,uiOffsetX:0,uiScale:1};

// The injection seam preserves the backend's complete gameplay lifecycle.
// Only draw borrows its buffers; this adapter never reads live poses to JS.
class LabBackend extends EnemySimulationBackend {
    draw() { return renderer.draw(this.simulation); }
}

function resize() {
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const width=Math.max(1,Math.round(innerWidth*dpr));
    const height=Math.max(1,Math.round(innerHeight*dpr));
    platform.resize(width,height);camera.resize(width,height);
    Object.assign(viewport,{ww:width,wh:height,uiww:Math.min(width,height*16/9)});
    viewport.uiOffsetX=(width-viewport.uiww)/2;
    syncSimulationRuntime({viewport:{...viewport,objectWH:height,objectOffsetY:0}});
    game?.resize();
}

function releaseInput(){keys.clear();pointer.down=false;}
function setPaused(value) {
    paused=value;releaseInput();accumulator=0;previous=0;policy.reset();
    game?.synchronizePresentation();$('pause').textContent=paused?'계속하기':'일시정지';
    $('state').textContent=paused?'일시정지 · 시점 조절 가능':'실시간 전투';
}

const input={
    isPressed(action){return (DEFAULT_KEYBOARD_BINDINGS[action]??[]).some(key=>keys.has(key));},
    isPrimaryPointerPressed(){return pointer.down && pointer.inside && !paused;},
    getPointerPosition(out){
        camera.unproject(pointer.x,pointer.y,ground);
        const base=game?.getObjectSystem().getWorldViewProjection();
        return base?base.worldToViewport(ground.x,ground.y,out):Object.assign(out,{x:0,y:0});
    },
    getWheelTotals(out){out.x=0;out.y=0;return out;}
};

function restart() {
    setPaused(true);game?.destroy();renderer.destroy();
    game=null;backend=null;frames=[];cpuFrames=[];dropped=0;backpressure=0;clampLoss=0;lastTick=0;lastReport=0;
    selectedLoad=Number($('load').value);
    const dependencies={
        inputActionSource:input,
        animationPort:{animate:(owner,options)=>animations.animate(owner,options)},
        timePort:{getDelta,getFixedDelta,getFixedInterpolationAlpha},
        viewportPort:{getSnapshot:(out={})=>Object.assign(out,viewport)},
        worldRenderPort:{drawCircle(){},drawSquareInstances(){}},
        webGpuPlatformPort:port,
        enemySimulationBackendFactory:(dependencies,options)=>{
            backend=new LabBackend(dependencies,options);return backend;
        }
    };
    game=new GameSystem(dependencies,{
        mapId:LAB_PROTOTYPE_MAP.id,tileNavigationSource:tileMap,
        enemyWaveEnabled:true,gameplayWorldActorsEnabled:true,
        waveDefinition:createLabPrototypeWave(selectedLoad),
        towerMaxHp:20000000,coreMaxIntegrity:20000000,
        initialCameraZoom:0.7
    });
    game.enter();failed=false;setPaused(false);
}

function fail(error) {
    const message=error?.stack||String(error);
    if(errors.length<16) errors.push(message);
    failed=true;setPaused(true);$('state').textContent='오류 · 진단 확인';
    $('error').hidden=false;$('error').textContent=message;
    console.error(error);
    window.labQaFailure?.(error);
}

function percentile(values,fraction){if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*fraction))];}

function updateReport(now) {
    const elapsed=(now-lastReport)/1000;
    if(elapsed<1)return;
    const tick=game.getFixedTick();
    const status=backend.getStatus();
    const active=backend.simulation?.activeBodyCount??0;
    report={status:failed?'error':paused?'paused':'running',fixedTick:tick,
        fixedTicksPerSecond:lastReport?(tick-lastTick)/elapsed:0,
        activeBodies:active,totalWaveSpawns:selectedLoad,
        frameP50Ms:percentile(frames,.5),frameP95Ms:percentile(frames,.95),frameP99Ms:percentile(frames,.99),
        cpuP95Ms:percentile(cpuFrames,.95),retainedFixedSteps:Math.floor(accumulator*60),droppedFixedSteps:dropped,
        backpressureSteps:backpressure,frameClampLossSeconds:clampLoss,drawCalls:renderer.drawCalls,
        viewport:{width:canvas.width,height:canvas.height},camera:{azimuth:camera.azimuth,elevation:camera.elevation,zoom:camera.zoom},
        adapter:port.getState().adapterInfo,backendState:status.state,
        recoveryRequired:backend.requiresRecovery(),errors:[...errors],
        note:'총 생성 수는 동시 생존 수가 아닙니다. 프로토타입의 최근 300프레임 측정입니다.'};
    const average=frames.reduce((a,b)=>a+b,0)/Math.max(frames.length,1);
    $('fps').textContent=average?(1000/average).toFixed(0):'—';
    $('ticks').textContent=report.fixedTicksPerSecond.toFixed(0);
    $('bodies').textContent=active.toLocaleString();$('p95').textContent=report.frameP95Ms.toFixed(1)+' ms';
    $('diagnostic-data').textContent=JSON.stringify(report,null,2);
    lastReport=now;lastTick=tick;
}

function loop(now) {
    if(disposed)return;
    raf=requestAnimationFrame(loop);
    const start=performance.now();const raw=previous?(now-previous)/1000:1/60;previous=now;
    const delta=Math.min(raw,.1);
    try {
        if(!failed) {
            if(paused){time.freezeFrameDelta();time.setFixedInterpolationAlpha(1);}
            else {
                time.update(delta);clampLoss+=Math.max(0,raw-delta);accumulator+=delta;
                const max=policy.resolveMaxSteps(previousCpu,delta,1/60);
                for(let step=0;step<max && accumulator>=1/60;step++) {
                    if(game.getFixedStepDisposition()===FIXED_STEP_RESULT.INTENTIONAL_PAUSE){accumulator=0;break;}
                    time.updateFixed(1/60);
                    const result=normalizeFixedStepResult(game.fixedUpdate());
                    if(result===FIXED_STEP_RESULT.DEFERRED_BACKPRESSURE){backpressure++;break;}
                    if(result===FIXED_STEP_RESULT.INTENTIONAL_PAUSE){accumulator=0;break;}
                    animations.update({useFixedTick:true,delta:1/60});accumulator-=1/60;
                }
                const excess=countExcessFixedStepDebt(accumulator,1/60,32);
                dropped+=excess;accumulator-=excess/60;
                time.setFixedInterpolationAlpha(Math.min(1,accumulator*60));
            }
            syncSimulationRuntime({performance:{frameDeltaSeconds:delta,previousFrameCpuSeconds:previousCpu,targetFrameSeconds:1/60}});
            animations.update({delta:paused?0:delta});game.update();
            camera.unproject(pointer.x,pointer.y,ground);
            camera.uniform.set([ground.x,ground.y,pointer.inside?1:0,now/1000],16);
            game.drawEnemySimulation();
            if(backend.requiresBlockingRecovery()) throw new Error('GPU 시뮬레이션 복구 필요: '+JSON.stringify(backend.getStatus()));
        }
    }catch(error){fail(error);}
    previousCpu=(performance.now()-start)/1000;
    if(!paused){frames.push(raw*1000);cpuFrames.push(previousCpu*1000);if(frames.length>300){frames.shift();cpuFrames.shift();}}
    updateReport(now);
}

function updateCameraControls() {
    camera.azimuth=Number($('azimuth').value);camera.elevation=Number($('elevation').value);camera.zoom=Number($('zoom').value)/100;camera.rebuild();
    $('azimuth-value').value=camera.azimuth+'°';$('elevation-value').value=camera.elevation+'°';$('zoom-value').value=Math.round(camera.zoom*100)+'%';
}
const listeners=new AbortController();const listen=(target,event,fn)=>target.addEventListener(event,fn,{signal:listeners.signal});
listen(window,'resize',resize);
listen(window,'blur',releaseInput);
listen(document,'visibilitychange',()=>{if(document.hidden)setPaused(true);});
listen(canvas,'pointermove',(e)=>{const rect=canvas.getBoundingClientRect();pointer.x=(e.clientX-rect.left)*canvas.width/rect.width;pointer.y=(e.clientY-rect.top)*canvas.height/rect.height;pointer.inside=true;});
listen(canvas,'pointerleave',()=>{pointer.inside=false;pointer.down=false;});
listen(canvas,'pointerdown',(e)=>{if(e.button===0)pointer.down=true;});
listen(window,'pointerup',()=>{pointer.down=false;});
listen(window,'keydown',(e)=>{if(['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName))return;if(e.code==='KeyP' && !e.repeat){setPaused(!paused);return;}keys.add(e.code);if(e.code==='Space'||e.code.startsWith('Arrow'))e.preventDefault();});
listen(window,'keyup',(e)=>keys.delete(e.code));
for(const id of ['azimuth','elevation','zoom'])listen($(id),'input',updateCameraControls);
listen($('isometric'),'click',()=>{$('azimuth').value=-35;$('elevation').value=48;$('zoom').value=100;updateCameraControls();});
listen($('top'),'click',()=>{$('azimuth').value=0;$('elevation').value=85;updateCameraControls();});
listen($('pause'),'click',()=>setPaused(!paused));
listen($('restart'),'click',()=>{try{$('error').hidden=true;restart();}catch(e){fail(e);}});
listen($('report'),'click',()=>{const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='cirvivor-lab-measurement.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
listen(window,'beforeunload',()=>{disposed=true;cancelAnimationFrame(raf);game?.destroy();renderer.destroy();platform.destroy();listeners.abort();});

try {
    resize();const state=await platform.init();
    if(!state.ready) throw new Error('WebGPU를 초기화할 수 없습니다: '+state.reason);
    port.getDevice().addEventListener('uncapturederror',(e)=>fail(e.error),{signal:listeners.signal});
    restart();$('pause').disabled=false;$('restart').disabled=false;
    raf=requestAnimationFrame(loop);
    if(window.require('process').env.CIRVIVOR_LAB_QA==='1') {
        const {runLabQa}=await import('./lab_qa.js');
        void runLabQa({report:()=>report,tick:()=>game.getFixedTick(),pause:setPaused,
            camera:(a,e,z)=>{$('azimuth').value=a;$('elevation').value=e;$('zoom').value=z*100;updateCameraControls();},
            restart:(count)=>{$('load').value=count;restart();},
            followPosition:()=>game.getObjectSystem().getCameraFollowTarget().copyCameraFollowPositionInto({}),
            aimAt:(x,y,down)=>{camera.project(x,y,0,pointer);pointer.inside=true;pointer.down=down;},
            aimState:()=>game.getObjectSystem().getTower().getSharedAimState(),
            weaponStatus:()=>game.getObjectSystem().primaryProjectileController.getStatus()});
    }
}catch(error){fail(error);$('diagnostic-data').textContent=JSON.stringify({errors},null,2);}
