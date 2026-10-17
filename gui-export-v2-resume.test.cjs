'use strict';
// Native Electron UI/media test; only picker, confirmation and test-profile routing are mocked.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const workspace=path.resolve(__dirname,'..'),id=crypto.randomUUID();
const root=path.join(workspace,'test-output','gui-v2-resume'+id),profile=path.join(root,'profile');
fs.mkdirSync(profile,{recursive:true});
const publicRoot=path.join(workspace,'test-output','exports');fs.mkdirSync(publicRoot,{recursive:true});
const reportFile=path.join(root,'report.json');
const report={status:'RUNNING',id,root,startedAt:new Date().toISOString(),mocks:['Native MP4 picker returns unique per-case target; no OS picker click claimed.','Native original-snapshot confirmation returns response 0; no OS confirmation click claimed.','Test intercepts userData routing and sets isolated recovery directory.'],cases:[]};
const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2));
const load=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const setPath=app.setPath.bind(app);app.setPath=(name,value)=>setPath(name,name==='userData'?profile:value);app.setPath('userData',profile);
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
let activeCase=null,win,started=false,handler=null;
dialog.showSaveDialog=async(...args)=>{
 assert(activeCase,'Picker outside active case');const opts=args.at(-1);
 assert(opts?.filters?.some(f=>f.extensions?.includes('mp4')),'Not MP4 picker');
 activeCase.pickerCalls++;assert.equal(activeCase.pickerCalls,1,'Resume must not choose another target');save();
 return {canceled:false,filePath:activeCase.target};
};
dialog.showMessageBox=async(...args)=>{
 const opts=args.at(-1);assert(activeCase&&activeCase.resuming,'Unexpected confirmation');
 assert(opts?.buttons?.[0]==='继续原快照导出','Wrong confirmation');
 activeCase.confirmations.push({message:opts.message,detail:opts.detail,response:0});save();return{response:0};
};
function locksPresent(){const managed=path.join(profile,'export-jobs');if(!fs.existsSync(managed))return false;return fs.readdirSync(managed,{withFileTypes:true}).filter(x=>x.isDirectory()).some(x=>['job.lock','final.lock','cleanup-completed.lock'].some(n=>fs.existsSync(path.join(managed,x.name,'state',n))));}
function locateJob(c){const managed=path.join(profile,'export-jobs'),registry=load(path.join(managed,'last-job.json'));assert(/^[a-f0-9-]{36}$/.test(registry.id));const jobRoot=path.join(managed,registry.id),settings=load(path.join(jobRoot,'state/settings.json'));assert.equal(settings.target,c.target);assert.equal(settings.workers,4);return jobRoot;}
async function clickCancel(c,reason){
 c.cancelReason=reason;c.cancelClickStartedAt=new Date().toISOString();save();
 c.cancelUi=await win.webContents.executeJavaScript(`(async()=>{const b=document.querySelector('#export-cancel');if(!b||b.disabled||typeof b.onclick!=='function')throw Error('Cancel UI unavailable');await b.onclick();return {disabled:b.disabled,message:document.querySelector('#log').textContent};})()`);
 c.cancelClickFinishedAt=new Date().toISOString();save();
}
function observe(p){
 const c=activeCase;if(!c)return;c.progress.push({at:Date.now(),payload:p});
 const video=c.mode==='video'&&p.stage==='VIDEO'&&p.activeWorkers>0&&((p.inFlightFrames||0)+(p.completedFrames||0)>0);
 const final=c.mode==='final'&&p.stage==='audio';
 if(!c.resuming&&!c.trigger&&(video||final)){
  c.trigger={at:Date.now(),payload:p};
  // Start real UI cancellation asynchronously while the export handler remains pending.
  c.cancelPromise=new Promise(resolve=>setImmediate(resolve)).then(()=>clickCancel(c,'OBSERVED_'+c.mode.toUpperCase())).catch(e=>{c.cancelError=e.stack;save();});
 }
 save();
}
async function operation(selector,c){
 let settled=false,error,result;handler=win.webContents.executeJavaScript(`(async()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled||typeof b.onclick!=='function')throw Error('Action unavailable');await b.onclick();return{message:document.querySelector('#log').textContent,exportDisabled:document.querySelector('#export').disabled,cancelDisabled:document.querySelector('#export-cancel').disabled,project:await replay.project()};})()`);
 handler.then(x=>{result=x;settled=true;},e=>{error=e;settled=true;});
 const begin=Date.now();while(!settled&&Date.now()-begin<180000)await wait(100);
 if(!settled){c.timedOut=true;try{await clickCancel(c,'180_SECOND_TIMEOUT');}catch(e){c.timeoutCancelError=e.stack;}const until=Date.now()+330000;while(!settled&&Date.now()<until)await wait(100);}
 assert(settled,'UI handler still live after scoped cancellation; do not force exit');handler=null;if(error)throw error;assert(!c.timedOut,'Case exceeded180seconds');return result;
}
function assertClosed(jobRoot,job){
 for(const g of job.segments)for(const a of g.attempts){
  assert(a.closed,'Worker child close not observed');
  if(!fs.existsSync(a.output))continue;
  const owner=load(path.join(a.output,'owner.json')),closed=load(path.join(a.output,'closed.json'));
  assert.equal(owner.jobId,job.id);assert.equal(closed.runId,owner.runId);assert.equal(closed.encoderClosed,true);
  for(const pid of [a.pid,owner.pid,...closed.encoderPids]){try{process.kill(pid,0);assert.fail('Recorded PID remains alive '+pid);}catch(e){if(e.code!=='ESRCH')throw e;}}
 }
 assert(!fs.existsSync(path.join(jobRoot,'state/job.lock')));assert(!fs.existsSync(path.join(jobRoot,'state/final.lock')));
}
async function runCase(mode){
 const c={mode,target:path.join(publicRoot,'gui-v2-resume'+id+'-'+mode+'.mp4'),pickerCalls:0,confirmations:[],progress:[],resuming:false};
 assert(!fs.existsSync(c.target));report.cases.push(c);activeCase=c;
 c.before=await win.webContents.executeJavaScript(`(async()=>{const m=document.querySelector('#export-mode');if(!m)throw Error('Missing mode selector');m.value='4';m.dispatchEvent(new Event('change',{bubbles:true}));return await replay.project();})()`);save();
 c.cancelledUi=await operation('#export',c);if(c.cancelPromise)await c.cancelPromise;
 assert(c.trigger,'Requested cancellation trigger was never observed');assert(!c.cancelError,c.cancelError);assert(!fs.existsSync(c.target),'Cancelled export published target');
 assert.deepEqual(c.cancelledUi.project,c.before);assert.equal(c.cancelledUi.exportDisabled,false);assert.equal(c.cancelledUi.cancelDisabled,true);
 const jobRoot=c.jobRoot=locateJob(c),job=load(path.join(jobRoot,'state/job.json'));assertClosed(jobRoot,job);
 c.committedBeforeResume=job.segments.filter(g=>g.status==='COMMITTED').map(g=>({index:g.index,attemptId:g.attempts[g.committedAttempt].id,retainedHashes:g.attempts[g.committedAttempt].retainedHashes}));
 const finalFile=path.join(jobRoot,'state/final.json');
 if(mode==='video'){assert.equal(job.status,'CANCELLED');assert(!fs.existsSync(finalFile));}
 else{
  assert.equal(job.status,'VIDEO_SEGMENTS_COMPLETE');const failed=load(finalFile);assert.equal(failed.status,'FAIL');assert.equal(failed.tempCleanup,'PASS');assert.equal(failed.producerClosed,true);
  assert(failed.commands.some(x=>x.pid&&x.closed===true),'No real finalization tool closure');
  assert(failed.commands.every(x=>x.closed===true),'Unclosed finalization tool');
  c.failedFinal={id:failed.id,path:finalFile,sha256:sha(finalFile),commandClosures:failed.commands.map(x=>({name:x.name,pid:x.pid,closed:x.closed,exitCode:x.exitCode}))};
 }
 c.resuming=true;save();c.resumedUi=await operation('#export-resume',c);
 assert.deepEqual(c.resumedUi.project,c.before);assert.equal(c.pickerCalls,1);assert.equal(c.confirmations.length,1);
 assert(c.resumedUi.message.startsWith('已导出：'),c.resumedUi.message);assert.equal(path.resolve(c.resumedUi.message.slice('已导出：'.length).trim()),c.target);
 const completed=load(path.join(jobRoot,'state/job.json')),final=load(finalFile),cleanup=load(path.join(jobRoot,'state/cleanup-completed.json'));
 assert.equal(completed.status,'VIDEO_SEGMENTS_COMPLETE');assert.equal(final.status,'PASS');assert.equal(cleanup.status,'PASS');assert.deepEqual(fs.readdirSync(path.join(jobRoot,'segments')),[]);
 for(const old of c.committedBeforeResume){const g=completed.segments[old.index],a=g.attempts[g.committedAttempt];assert.equal(a.id,old.attemptId);assert.deepEqual(a.retainedHashes,old.retainedHashes);}
 if(c.failedFinal){const archive=path.join(jobRoot,'logs','final-attempt-'+c.failedFinal.id+'.json');assert.equal(sha(archive),c.failedFinal.sha256);c.failedFinal.archive=archive;assert(fs.readdirSync(path.join(jobRoot,'logs')).some(n=>/^cancel-ack-.*\.json$/.test(n)),'Missing acknowledged cancellation record');}
 assert.equal(sha(c.target),final.output.sha256);assert.equal(fs.statSync(c.target).size,final.output.bytes);assert.equal(final.output.path,c.target);
 assert(!locksPresent());assert.equal(c.resumedUi.exportDisabled,false);assert.equal(c.resumedUi.cancelDisabled,true);
 c.output={path:c.target,sha256:sha(c.target),bytes:fs.statSync(c.target).size};c.preservedCommits=c.committedBeforeResume.length;c.status='PASS';save();
}
app.on('browser-window-created',(_,w)=>{
 if(started)return;started=true;win=w;const send=w.webContents.send.bind(w.webContents);
 w.webContents.send=(channel,...args)=>{if(channel==='export-v2-progress')observe(args[0]);return send(channel,...args);};
 w.webContents.once('did-finish-load',async()=>{
  try{
   await w.webContents.executeJavaScript(`(async()=>{const sleep=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<400;i++){if(window.replay&&document.querySelector('#export-mode')&&!document.querySelector('#export').disabled)return;await sleep(25);}throw Error('GUI initialization timeout');})()`);
   await runCase('video');await runCase('final');
   assert.deepEqual(fs.readdirSync(publicRoot).filter(n=>n.includes(id)).sort(),report.cases.map(c=>path.basename(c.target)).sort());
   report.status='PASS';report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({status:'PASS',report:reportFile,outputs:report.cases.map(c=>c.target)}));app.exit(0);
  }catch(e){
   report.status='FAIL';report.error=e.stack;save();console.error(e.stack);
   if(locksPresent()){try{await w.webContents.executeJavaScript('replay.cancelExport()');}catch(x){report.emergencyCancelError=x.stack;}const until=Date.now()+330000;while(locksPresent()&&Date.now()<until)await wait(100);}
   report.finishedAt=new Date().toISOString();if(locksPresent()){report.exitDeferred='Owned lifecycle lock remains; parent must inspect without killing unrelated processes.';save();process.exitCode=1;return;}save();app.exit(1);
  }
 });
});
save();require('./main.cjs');
