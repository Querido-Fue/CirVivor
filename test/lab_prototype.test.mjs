import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGameModule } from './support/source_module_loader.mjs';

const { LabCamera }=await loadGameModule('./prototype/lab/lab_camera.js');
const { buildLabGeometry }=await loadGameModule('./prototype/lab/lab_geometry.js');
const { TileMap }=await loadGameModule('ingame/map/tile_map.js');
const { LAB_PROTOTYPE_MAP, LAB_PROTOTYPE_LOADS, createLabPrototypeWave }=await loadGameModule('data/scene/game/lab_prototype_data.js');
const { compileAuthoredWaveTimeline }=await loadGameModule('ingame/flow/authored_wave_timeline_contract.js');
const { INGAME_ENEMY_DEFINITION_BY_ID }=await loadGameModule('data/object/enemy/basic_circle_enemy_data.js');
const tileMap=new TileMap(LAB_PROTOTYPE_MAP);

test('입체 카메라의 화면→바닥 좌표는 회전·기울기·리사이즈와 무관하게 왕복한다',()=>{
    const camera=new LabCamera(tileMap.getWorldBounds());
    for(const [width,height] of [[1440,900],[1280,800],[1000,650],[2880,1800]]) {
        for(const azimuth of [-75,-35,0,55,75]) for(const elevation of [30,48,60,85]) for(const zoom of [.7,1,1.6]) {
            Object.assign(camera,{azimuth,elevation,zoom});camera.resize(width,height);
            for(const [x,y] of [[0,0],[21,15],[10.5,13.5],[19.5,7.5],[3.25,7.75]]) {
                const screen=camera.project(x,y),roundTrip=camera.unproject(screen.x,screen.y);
                assert.ok(Math.abs(roundTrip.x-x)<1e-10 && Math.abs(roundTrip.y-y)<1e-10);
                const u=camera.uniform;
                const clipX=u[0]*x+u[1]*y+u[3],clipY=u[4]*x+u[5]*y+u[7];
                assert.ok(Math.abs((clipX+1)*width/2-screen.x)<.002);
                assert.ok(Math.abs((1-clipY)*height/2-screen.y)<.002);
                const depth=u[8]*x+u[9]*y+u[11];
                assert.ok(depth>0 && depth<1);
                assert.ok(depth+u[10]*2<depth,'높은 물체는 같은 지면보다 카메라에 가깝다');
            }
        }
    }
});

test('모든 프로토타입 부하는 production timeline compiler로 정확한 수와 세 형태를 생성한다',()=>{
    for(const count of LAB_PROTOTYPE_LOADS) {
        const wave=createLabPrototypeWave(count);
        const schedule=compileAuthoredWaveTimeline({...wave,tileMap,resolveEnemyDefinition:id=>INGAME_ENEMY_DEFINITION_BY_ID[id]});
        assert.equal(schedule.length,count);
        assert.ok(Number.isSafeInteger(wave.timeline[0].durationSeconds*60));
        assert.equal(new Set(wave.timeline[0].spawnGroups[0].enemyDefinitionIds).size,3);
    }
    assert.throws(()=>createLabPrototypeWave(0),RangeError);
});

test('입체 바닥 geometry는 실제 맵에서 유한한 좌표와 단위 법선을 생성한다',()=>{
    const first=buildLabGeometry(tileMap),second=buildLabGeometry(tileMap);
    assert.deepEqual(first,second);assert.equal(first.length%27,0);
    for(let i=0;i<first.length;i+=9) {
        for(let j=0;j<9;j++)assert.ok(Number.isFinite(first[i+j]));
        assert.ok(Math.abs(Math.hypot(first[i+3],first[i+4],first[i+5])-1)<1e-6);
    }
});
