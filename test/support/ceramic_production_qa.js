import { getWebGpuPlatformPort, getScaleRatio, getCanvasOffsetX, getCanvasOffsetY } from 'display/display_system.js';
import { PRODUCTION_STAGE_ONE_SELECTION_MAP_ID } from 'scene/game/production_game_start_route.js';

// Injected only into the launcher's isolated copy of the real game entry point.
const fs=window.require('fs'),path=window.require('path');
const output=window.require('process').env.CIRVIVOR_LAB_OUTPUT;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],errors=[],samples=[];
const assert=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
const waitFor=async(predicate,label,ms=45000)=>{
    const start=performance.now();
    while(!predicate()) {if(performance.now()-start>ms)throw new Error('timeout: '+label);await sleep(100);}
};
const capture=name=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('capture timeout')),10000);
    nw.Window.get().capturePage(data=>{clearTimeout(timeout);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data));resolve();},{format:'png',datatype:'buffer'});
});
const warn=console.warn;
console.warn=(...args)=>{if(String(args[0]).includes('오류'))errors.push(args.map(String).join(' '));warn.apply(console,args);};
try {
    // Keep physical input used in other apps from changing this automated fixture.
    for(const type of ['mousemove','mousedown','mouseup','wheel','keydown','keyup']) {
        window.addEventListener(type,event=>{if(event.isTrusted)event.stopImmediatePropagation();},true);
    }
    nw.Window.get().show();nw.Window.get().focus();
    await waitFor(()=>window.Game,'App startup');
    const app=window.Game,scenes=app.systemHandler.sceneSystem;
    await waitFor(()=>scenes.sceneState==='title','title');
    nw.Window.get().leaveFullscreen();await sleep(400);
    nw.Window.get().resizeTo(1440,900);await sleep(700);
    nw.Window.get().focus();app.start();await sleep(200);
    await capture('title');
    const platform=getWebGpuPlatformPort(),devices=new Set();
    const observe=()=>{const d=platform.getDevice();if(d&&!devices.has(d)){devices.add(d);d.addEventListener('uncapturederror',e=>errors.push(e.error.message));}};
    observe();
    scenes.gameStart(PRODUCTION_STAGE_ONE_SELECTION_MAP_ID);
    let game=scenes.scene.getGameSystem(),objects=game.getObjectSystem();
    let backend=objects.getEnemySimulationBackend(),camera=objects.getWorldViewProjection();
    await waitFor(()=>game.getFixedTick()>240 && backend.ceramicRenderer?.drawCalls===5,'production GPU world');
    assert(camera.depthView && backend.constructor.name==='CeramicEnemyBackend','실제 게임 시작 경로의 입체 렌더 기본 활성화');
    assert(errors.length===0,'실제 App/Display 프레임과 셰이더 오류 없음');
    await capture('production');
    const getPosition=()=>{const out={};objects.getCameraFollowTarget().copyCameraFollowPositionInto(out);return out;};
    const before=getPosition();
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}));await sleep(350);
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}));await sleep(350);
    const after=getPosition();
    assert(after.x>before.x+.02,'실제 InputSystem 이동이 GPU Tower 위치에 반영');
    const aimWorld={x:after.x-3,y:after.y};
    const screen=camera.worldToViewport(aimWorld.x,aimWorld.y);
    const client={clientX:screen.x/getScaleRatio()+getCanvasOffsetX(),clientY:screen.y/getScaleRatio()+getCanvasOffsetY(),button:0};
    const shots=objects.primaryProjectileController.getStatus().shotSequence;
    window.dispatchEvent(new MouseEvent('mousemove',client));
    window.dispatchEvent(new MouseEvent('mousedown',client));await sleep(600);
    await waitFor(()=>objects.primaryProjectileController.getStatus().shotSequence>shots,'primary projectile commit',5000);
    const aim=objects.getTower().getSharedAimState();
    const pointer=app.systemHandler.inputSystem.getSimulationInputSnapshot().mousePos;
    const expected=camera.viewportToWorld(pointer.x,pointer.y);
    assert(Math.abs(pointer.x-screen.x)<=getScaleRatio()+.01 && Math.abs(pointer.y-screen.y)<=getScaleRatio()+.01,'DOM 정수 픽셀 오차 내 의도한 조준 위치 유지');
    samples.push({phase:'aim',requested:aimWorld,actual:aim.aimWorldPoint,expected,pointer,screen});
    assert(Math.abs(aim.aimWorldPoint.x-expected.x)<.001 && Math.abs(aim.aimWorldPoint.y-expected.y)<.001,'DOM 포인터→입체 월드→GPU 조준 좌표 일치');
    assert(objects.primaryProjectileController.getStatus().shotSequence>shots,'실제 주무기 발사 commit');
    window.dispatchEvent(new MouseEvent('mouseup',client));
    await capture('firing');
    const tick=game.getFixedTick(),zoom=camera.zoom;
    window.dispatchEvent(new WheelEvent('wheel',{...client,deltaY:-100}));await sleep(700);
    assert(camera.zoom>zoom && game.getFixedTick()>tick,'실제 휠 줌과 fixed tick 진행');
    await capture('zoom');
    const cssWidth=window.innerWidth;
    nw.Window.get().resizeTo(1280,800);await sleep(900);
    assert(window.innerWidth<cssWidth,'실제 창 크기 변경 반영');
    assert(game===scenes.scene.getGameSystem() && objects.getEnemySimulationBackend()===backend,'리사이즈·줌에서 GPU world identity 보존');
    assert(camera.depthView.width===camera.viewportWidth && camera.depthView.height===camera.viewportHeight,'입체 타깃과 실제 viewport 크기 일치');
    samples.push({phase:'production',fixedTick:game.getFixedTick(),bodyCount:backend.simulation.bodyCount,drawCalls:backend.ceramicRenderer.drawCalls,viewport:[camera.viewportWidth,camera.viewportHeight],zoom:camera.zoom});
    const oldRenderer=backend.ceramicRenderer;
    assert(game.restartGpuWorldAtSafeWaveBoundary(),'기존 safe-wave GPU world 재생성 경로 성공');
    await waitFor(()=>objects.getEnemySimulationBackend()!==backend && objects.getEnemySimulationBackend()?.ceramicRenderer?.drawCalls===5,'safe-wave graphics recovery');
    assert(oldRenderer.resources.length===0 && oldRenderer.targets===null,'재생성 시 이전 입체 GPU 리소스 해제');
    backend=objects.getEnemySimulationBackend();
    await sleep(1000);await capture('recovered');
    const retired=backend.ceramicRenderer;
    scenes.benchmarkStart();await sleep(1500);
    assert(retired.resources.length===0 && retired.targets===null,'씬 전환 시 입체 GPU 리소스 해제');
    await capture('benchmark');
    scenes.gameStart(PRODUCTION_STAGE_ONE_SELECTION_MAP_ID);
    game=scenes.scene.getGameSystem();objects=game.getObjectSystem();backend=objects.getEnemySimulationBackend();
    await waitFor(()=>game.getFixedTick()>120 && backend.ceramicRenderer?.drawCalls===5,'production reentry');
    assert(objects.getWorldViewProjection().depthView!==null,'벤치마크→실제 게임 재진입 정상');
    await capture('reentry');observe();
    assert(errors.length===0,'전체 전환·입력·리사이즈 후 GPU/프레임 오류 없음');
    fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify({status:'pass',checks,samples,errors,artifacts:output},null,2));
    nw.App.quit();
} catch(error) {
    const app=window.Game,game=app?.systemHandler?.sceneSystem?.scene?.getGameSystem?.();
    const diagnostic={errors,running:app?.running,focused:document.hasFocus(),hidden:document.hidden,fixedTick:game?.getFixedTick(),gpu:game?.getObjectSystem()?.getEnemySimulationBackend()?.getRuntimeState?.(),weapon:game?.getObjectSystem()?.primaryProjectileController?.getStatus(),aim:game?.getObjectSystem()?.getTower()?.getSharedAimState(),recovery:game?.getGpuRecoveryStatus()};
    try{await capture('failure');}catch{}
    window.labQaFailure(new Error(String(error.stack||error)+'\n'+JSON.stringify(diagnostic)));
}
