// Loaded before module evaluation so import/startup failures also reach the QA runner.
if(window.nw && window.require && window.require('process').env.CIRVIVOR_LAB_QA==='1') {
    const fs=window.require('fs');
    const path=window.require('path');
    const output=window.require('process').env.CIRVIVOR_LAB_OUTPUT;
    window.labQaFailure=(error)=>{
        fs.writeFileSync(path.join(output,'qa.json'),JSON.stringify({status:'fail',error:String(error?.stack||error)},null,2));
        setTimeout(()=>nw.App.quit(),200);
    };
    window.addEventListener('error',(event)=>window.labQaFailure(event.error||event.message));
    window.addEventListener('unhandledrejection',(event)=>window.labQaFailure(event.reason));
}
