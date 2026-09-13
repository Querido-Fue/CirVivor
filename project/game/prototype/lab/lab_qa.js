export async function runLabQa(api) {
    if(window.require('process').env.CIRVIVOR_LAB_QA!=='1')return;
    const fs=window.require('fs'),path=window.require('path');
    const output=window.require('process').env.CIRVIVOR_LAB_OUTPUT;
    const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
    const checks=[],samples=[];
    const assert=(condition,label)=>{if(!condition)throw new Error(label);checks.push(label);};
    const capture=(name)=>new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('capture timeout')),10000);
        nw.Window.get().capturePage((data)=>{clearTimeout(timeout);fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(data));resolve();},{format:'png',datatype:'buffer'});
    });
    try {
        nw.Window.get().show();nw.Window.get().focus();
        await sleep(18000);
        await capture('startup');
        let report=api.report();samples.push({...report,phase:'default'});
        if(!Array.isArray(report.errors))throw new Error('측정 준비 실패: '+JSON.stringify({report,tick:api.tick(),visibility:document.visibilityState}));
        assert(report.errors.length===0 && !report.recoveryRequired,'초기 WebGPU 오류 없음');
        assert(report.fixedTick>60 && report.activeBodies>2 && report.drawCalls===5,'실제 fixed tick과 GPU body 렌더 진행');
        await capture('default');
        api.pause(true);const tick=api.tick();await sleep(700);
        assert(api.tick()===tick,'일시정지 중 fixed tick 보존');
        api.camera(55,60,1.1);await sleep(300);await capture('rotated');
        api.camera(-35,48,1);api.pause(false);await sleep(1000);
        assert(api.tick()>tick,'재개 후 fixed tick 진행');
        const before=api.followPosition();
        window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD'}));await sleep(350);
        window.dispatchEvent(new KeyboardEvent('keyup',{code:'KeyD'}));await sleep(350);
        const after=api.followPosition();
        assert(after.x>before.x+0.05,'기존 Tower 이동 입력의 월드 X 반영');
        const shotsBefore=api.weaponStatus().shotSequence;
        api.aimAt(after.x-4,after.y,true);await sleep(500);
        const aim=api.aimState();
        assert(Math.abs(aim.aimWorldPoint.x-(after.x-4))<.001 && Math.abs(aim.aimWorldPoint.y-after.y)<.001,'입체 포인터가 기존 GPU 조준 월드 좌표와 일치');
        assert(api.weaponStatus().shotSequence>shotsBefore,'실제 primary projectile 발사 commit');
        await capture('firing');api.aimAt(after.x-4,after.y,false);
        nw.Window.get().resizeTo(1280,800);await sleep(700);
        assert(api.report().errors.length===0,'리사이즈 후 렌더 오류 없음');
        api.restart(1000);await sleep(20000);
        report=api.report();samples.push({...report,phase:'1000-total-stream'});
        assert(report.fixedTick>120 && report.errors.length===0 && !report.recoveryRequired,'1000 총 생성 웨이브 재시작 및 진행');
        await capture('stream');
        fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify({status:'pass',checks,samples,artifacts:output},null,2));
        nw.App.quit();
    }catch(error){window.labQaFailure(error);}
}
