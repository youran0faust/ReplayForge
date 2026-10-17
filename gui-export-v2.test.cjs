'use strict';
// Explicit native Electron test. Picker and test-profile routing mocked, media/UI real.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const workspace=path.resolve(__dirname,'..'),id=crypto.randomUUID(),root=path.join(workspace,'test-output','gui-v2'+id);
const profile=path.join(root,'profile'),target=path.join(workspace,'test-output','exports','gui-v2'+id+'.mp4');
fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(path.dirname(target),{recursive:true});assert(!fs.existsSync(target));
const reportFile=path.join(root,'report.json');
const report={status:'RUNNING',id,root,target,startedAt:new Date().toISOString(),mocks:['Native save picker returns unique target; no real OS picker click claimed.','Test-only userData routing forces isolated profile.'],progress:[],dialogCalls:[]};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));save();
const setPath=app.setPath.bind(app);app.setPath=(name,value)=>setPath(name,name==='userData'?profile:value);app.setPath('userData',profile);
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
dialog.showSaveDialog=async(...args)=>{
 const o=args[args.length-1];report.dialogCalls.push({defaultPath:o?.defaultPath,filters:o?.filters});save();
 assert.equal(report.dialogCalls.length,1);assert(o?.filters?.some(f=>f.extensions?.includes('mp4')),'Export picker only');
 return{canceled:false,filePath:target};
};
const load=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let started=false,window,exportSettled=false,timedOut=false,watchdog;
async function cancel(reason){report.cancellationReason=reason;save();if(window&&!window.isDestroyed())try{report.cancelReply=await window.webContents.executeJavaScript('window.replay.cancelExport()');}catch(e){report.cancelError=e.stack;}save();}
app.on('browser-window-created',(_,win)=>{
 if(started)return;started=true;window=win;
 const send=win.webContents.send.bind(win.webContents);
 win.webContents.send=(channel,...args)=>{if(channel==='export-v2-progress'){report.progress.push({at:Date.now(),payload:args[0]});save();}return send(channel,...args);};
 win.webContents.once('did-finish-load',async()=>{
  try{
   watchdog=setTimeout(()=>{timedOut=true;cancel('300_SECOND_TIMEOUT');},300000);
   const ui=await win.webContents.executeJavaScript(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<400;i++){if(window.replay&&document.querySelector('#export-mode')&&!document.querySelector('#export').disabled)break;await sleep(25);}
    const before=await replay.project(),mode=document.querySelector('#export-mode');if(!mode)throw Error('Missing export-mode');
    mode.value='4';mode.dispatchEvent(new Event('change',{bubbles:true}));if(mode.value!=='4')throw Error('Mode4 unavailable');
    const button=document.querySelector('#export');if(typeof button.onclick!=='function')throw Error('Missing click handler');
    await button.onclick();return{before,after:await replay.project(),mode:mode.value,message:document.querySelector('#log').textContent,exportDisabled:button.disabled,cancelDisabled:document.querySelector('#export-cancel').disabled};
   })()`);
   exportSettled=true;clearTimeout(watchdog);report.ui=ui;assert(!timedOut,'Timed out; owned cancellation requested');
   assert.equal(ui.mode,'4');assert.deepEqual(ui.after,ui.before,'Export must preserve project/revision');assert.equal(ui.exportDisabled,false);assert.equal(ui.cancelDisabled,true);
   assert(ui.message.startsWith('已导出：'),ui.message);assert.equal(path.resolve(ui.message.slice('已导出：'.length).trim()),target);assert.equal(report.dialogCalls.length,1);
   assert(fs.statSync(target).size>1000);assert.deepEqual(fs.readdirSync(path.dirname(target)).filter(n=>n.includes(id)),[path.basename(target)],'No public dump');assert.equal(app.getPath('userData'),profile);
   const managed=path.join(profile,'export-jobs'),jobs=fs.readdirSync(managed,{withFileTypes:true}).filter(e=>e.isDirectory());assert.equal(jobs.length,1);
   const jobRoot=path.join(managed,jobs[0].name),job=load(path.join(jobRoot,'state/job.json')),settings=load(path.join(jobRoot,'state/settings.json'));
   const final=load(path.join(jobRoot,'state/final.json')),cleanup=load(path.join(jobRoot,'state/cleanup-completed.json'));
   assert.equal(settings.workers,4);assert.equal(settings.target,target);assert.deepEqual(load(settings.projectFile).project,ui.before.project);assert.equal(settings.frames,ui.before.project.scene.durationFrames);
   assert.equal(job.status,'VIDEO_SEGMENTS_COMPLETE');assert.equal(final.status,'PASS');assert.equal(cleanup.status,'PASS');assert.deepEqual(fs.readdirSync(path.join(jobRoot,'segments')),[]);
   assert(!fs.existsSync(path.join(jobRoot,'state/job.lock')));assert(!fs.existsSync(path.join(jobRoot,'state/final.lock')));assert(report.progress.length>0,'Progress events required');
   report.jobRoot=jobRoot;report.expectedFrames=settings.frames;report.output={path:target,bytes:fs.statSync(target).size,sha256:sha(target)};report.proofs={final:path.join(jobRoot,'state/final.json'),cleanup:path.join(jobRoot,'state/cleanup-completed.json')};
   report.status='PASS';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,report:reportFile,output:target}));app.exit(0);
  }catch(e){
   clearTimeout(watchdog);report.status='FAIL';report.error=e.stack;if(!exportSettled)await cancel('GUI_TEST_FAILURE');report.finishedAt=new Date().toISOString();save();console.error(e.stack);
   // Never force process exit while the owned coordinator/finalizer retains its lock.
   const managed=path.join(profile,'export-jobs'),locked=fs.existsSync(managed)&&fs.readdirSync(managed).some(n=>['job.lock','final.lock'].some(f=>fs.existsSync(path.join(managed,n,'state',f))));
   if(locked){report.exitDeferred='Owned lock still exists; parent must collect/review without killing unrelated processes.';save();process.exitCode=1;return;}
   app.exit(1);
  }
 });
});
require('./main.cjs');
