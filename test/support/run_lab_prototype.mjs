import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitForChildWithTimeout } from './nw_child_process_guard.mjs';

// An isolated runtime avoids the packaged game's automatic main entry and saves.
const project=fileURLToPath(new URL('../../project/',import.meta.url));
const production=process.argv.includes('--production-qa');
const qa=production||process.argv.includes('--qa');
const run=await fs.mkdtemp(path.join(os.tmpdir(),'cirvivor-lab-'));
async function linkFile(from,to) {
    try {await fs.link(from,to);} catch(error) {
        if(!['EXDEV','EPERM','EACCES'].includes(error.code))throw error;
        await fs.copyFile(from,to);
    }
}
async function linkTree(source,destination) {
    await fs.mkdir(destination,{recursive:true});
    for(const entry of await fs.readdir(source,{withFileTypes:true})) {
        const from=path.join(source,entry.name),to=path.join(destination,entry.name);
        if(entry.isDirectory()) await linkTree(from,to);
        else if(entry.isFile()) await linkFile(from,to);
    }
}
await fs.mkdir(path.join(run,'runtime'));
for(const entry of await fs.readdir(project,{withFileTypes:true})) {
    if(entry.isFile() && (/\.(dll|pak|dat|bin)$/.test(entry.name)||entry.name==='vk_swiftshader_icd.json'||entry.name==='lonely tower.exe')) {
        await linkFile(path.join(project,entry.name),path.join(run,'runtime',entry.name==='lonely tower.exe'?'nw.exe':entry.name));
    }
}
for(const dir of ['locales','Dictionaries','swiftshader']) await linkTree(path.join(project,dir),path.join(run,'runtime',dir));
if(production) {
    const destination=path.join(run,'app/game');
    await fs.mkdir(destination,{recursive:true});
    for(const entry of await fs.readdir(path.join(project,'game'),{withFileTypes:true})) {
        if(['save','index.html'].includes(entry.name))continue;
        const source=path.join(project,'game',entry.name),target=path.join(destination,entry.name);
        if(entry.isDirectory())await linkTree(source,target);
        else if(entry.isFile())await linkFile(source,target);
    }
    const html=await fs.readFile(path.join(project,'game/index.html'),'utf8');
    await fs.writeFile(path.join(destination,'index.html'),html.replace('<body>','<body><script src="./prototype/lab/qa_bootstrap.js"></script>').replace('</body>','<script type="module" src="./production_qa.js"></script></body>'));
    await fs.copyFile(fileURLToPath(new URL('./ceramic_production_qa.js',import.meta.url)),path.join(destination,'production_qa.js'));
} else {
    for(const dir of ['script','font','prototype/lab'])await linkTree(path.join(project,'game',dir),path.join(run,'app/game',dir));
}
await fs.writeFile(path.join(run,'app/package.json'),JSON.stringify({name:production?'cirvivor-ceramic-qa':'cirvivor-lab-prototype',main:production?'game/index.html':'game/prototype/lab/index.html',window:{title:'CirVivor · 입체 그래픽 검증',width:1440,height:900,min_width:1000,min_height:650,position:'center'},'chromium-args':'--force-device-scale-factor=1'}));
console.log(`입체 프로토타입 ${qa?'자동 검증':'실행'}: ${run}`);
const child=spawn(path.join(run,'runtime/nw.exe'),[`--user-data-dir=${path.join(run,'profile')}`,'--enable-logging=stderr',path.join(run,'app')],{cwd:run,windowsHide:true,stdio:'inherit',env:{...process.env,CIRVIVOR_LAB_QA:qa?'1':'0',CIRVIVOR_LAB_OUTPUT:run}});
try {
    if(qa) {
        const result=await waitForChildWithTimeout(child,production?180000:120000);
        if(result.timedOut)throw new Error(`프로토타입 QA 제한시간 초과: ${run}`);
        const report=JSON.parse(await fs.readFile(path.join(run,'qa.json'),'utf8'));
        console.log(JSON.stringify(report,null,2));
        if(result.exit.exitCode!==0||report.status!=='pass')process.exitCode=1;
    } else await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});
} finally {
    // Clean only this launcher's exact generated directory after its process has exited.
    if((child.exitCode!==null||child.signalCode!==null) && path.dirname(run)===path.resolve(os.tmpdir()) && path.basename(run).startsWith('cirvivor-lab-')) {
        const targets=qa?['runtime','app','profile'].map(name=>path.join(run,name)):[run];
        for(const target of targets)await fs.rm(target,{recursive:true,force:true,maxRetries:20,retryDelay:100});
    }
}
