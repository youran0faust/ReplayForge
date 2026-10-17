'use strict';
// Real Windows taskkill tree fallback; Electron UI and encoder are explicit fixtures.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const mode=process.argv[2],fixtureDir=process.argv[3];
if(mode==='--hang-grand'){
 fs.writeFileSync(path.join(fixtureDir,'grand.pid'),String(process.pid));setInterval(()=>{},1000);
}else if(mode==='--hang-child'){
 fs.writeFileSync(path.join(fixtureDir,'child.pid'),String(process.pid));
 fs.writeFileSync(path.join(fixtureDir,'p1-preview.mp4'),'INCOMPLETE FIXTURE');
 fs.writeFileSync(path.join(fixtureDir,'encode.log'),'fixture hung encoder; not real FFmpeg');
 const grandLog=fs.openSync(path.join(fixtureDir,'grand.log'),'w');
 const grand=cp.spawn(process.execPath,[__filename,'--hang-grand',fixtureDir],{stdio:['ignore',grandLog,grandLog],windowsHide:true});
 grand.once('close',code=>{fs.closeSync(grandLog);console.log('grand close '+code);});
 grand.on('error',e=>{console.error(e);process.exit(2)});console.log('hung worker fixture pid='+process.pid+' grand='+grand.pid);setInterval(()=>{},1000);
}else if(mode==='--success'){
 fs.writeFileSync(path.join(fixtureDir,'p1-preview.mp4'),'SUCCESS FIXTURE, NOT ENCODED VIDEO');console.log('success fixture');
}else{
 main().catch(e=>{console.error(e);process.exitCode=1;});
}
async function main(){
 assert.equal(process.platform,'win32','Windows-only integration');
 const runId=crypto.randomUUID(),startedAt=new Date().toISOString(),root=path.join(__dirname,'test-output','taskkill-'+runId);
 fs.mkdirSync(path.join(root,'examples'),{recursive:true});fs.copyFileSync(path.join(__dirname,'examples/rain-corridor.json'),path.join(root,'examples/rain-corridor.json'));
 const old=path.join(root,'prior.mp4');fs.writeFileSync(old,'prior movie sentinel');
 const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'),priorHash=hash(old);
 const source=path.join(__dirname,'main.cjs'),sourceHash=hash(source),real=require('node:module').createRequire(source);
 const events=[],handlers={},children=[],killers=[];let ready,success=false,cancelAt=null,grandPid=null,report,denied=false;
 const note=(type,data={})=>events.push({type,at:new Date().toISOString(),elapsedSinceCancelMs:cancelAt===null?null:Date.now()-cancelAt,...data});
 const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function wait(fn,label,ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await delay(25);}throw Error('Timeout '+label);}
 class Window{constructor(){this.webContents={mainFrame:{},send(){},once(){}};Window.instance=this;}isDestroyed(){return false;}loadFile(){}on(){}}
 const electron={app:{setPath(){},whenReady(){return{then:fn=>{ready=fn();}};},on(){}},BrowserWindow:Window,ipcMain:{handle:(n,fn)=>handlers[n]=fn},dialog:{}};
 const fixtureSpawn=(exe,args,opts)=>{
  if(exe==='taskkill.exe'){
   const owned=children.find(c=>c.child.pid===Number(args[1])&&!c.closed);assert.ok(owned,'taskkill only targets owned running worker');
   assert.deepEqual(Array.from(args),['/PID',String(owned.child.pid),'/T','/F']);assert.equal(opts.stdio,'ignore');
   note('taskkill-spawn',{pid:owned.child.pid,args:Array.from(args)});
   const child=cp.spawn(exe,Array.from(args),opts);const entry={child,closed:false};killers.push(entry);
   child.on('error',e=>{denied=true;entry.error=String(e);note('taskkill-error',{error:String(e)});});
   child.on('close',code=>{entry.closed=true;entry.code=code;if(code!==0)denied=true;note('taskkill-close',{code});});return child;
  }
  assert.equal(path.basename(args[0]),'export-main.cjs');
  const directory=opts.env.REPLAY_EXPORT_OUTPUT;assert.ok(directory.startsWith(root+path.sep));
  const child=cp.spawn(process.execPath,[__filename,success?'--success':'--hang-child',directory],opts);
  const entry={child,directory,closed:false};children.push(entry);note('worker-spawn',{pid:child.pid,success,directory});
  child.on('error',e=>{denied=true;entry.error=String(e);note('worker-error',{error:String(e)});});
  child.on('exit',(code,signal)=>note('worker-exit',{pid:child.pid,code,signal}));
  child.on('close',(code,signal)=>{entry.closed=true;note('worker-close',{pid:child.pid,code,signal});});return child;
 };
 try{
  vm.runInNewContext(fs.readFileSync(source,'utf8'),{__dirname:root,process:{...process,env:{...process.env,REPLAY_RECOVERY_DIR:path.join(root,'recovery')}},console,setTimeout,clearTimeout,require:n=>n==='electron'?electron:n==='child_process'?{...cp,spawn:fixtureSpawn}:real(n)});
  await ready;const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame};
  let settled=false;const pending=handlers['export-current'](event).then(value=>{settled=true;return{value};},error=>{settled=true;note('export-rejected',{message:error.message});return{error};});
  const job=children[0];assert.ok(job);
  await wait(()=>job.error||fs.existsSync(path.join(job.directory,'grand.pid')),'grandchild ready');if(job.error)throw Error(job.error);
  const childPid=Number(fs.readFileSync(path.join(job.directory,'child.pid'),'utf8'));grandPid=Number(fs.readFileSync(path.join(job.directory,'grand.pid'),'utf8'));
  assert.equal(childPid,job.child.pid);assert.ok(Number.isInteger(grandPid)&&grandPid>0&&grandPid!==process.pid&&grandPid!==childPid);assert(alive(childPid)&&alive(grandPid));note('tree-ready',{childPid,grandPid});
  cancelAt=Date.now();assert.equal(handlers['cancel-export'](event).cancelled,true);note('cancel-request');
  assert.equal(handlers['cancel-export'](event).cancelled,true);assert(fs.existsSync(path.join(job.directory,'cancel.request')));
  await delay(4000);assert.equal(settled,false);assert.equal(killers.length,0);assert(alive(childPid)&&alive(grandPid));assert(fs.existsSync(path.join(job.directory,'p1-preview.mp4')));
  await assert.rejects(handlers['export-current'](event),/导出任务/);note('pre-five-second-lock-confirmed');
  await wait(()=>settled||(killers[0]?.closed&&killers[0].code!==0),'cancel settlement',12000);if(killers[0]?.code!==undefined&&killers[0].code!==0)throw Error('taskkill failed with code '+killers[0].code);const outcome=await pending;assert.match(outcome.error?.message||'',/导出已取消/);
  assert.equal(killers.length,1);await wait(()=>killers[0].closed,'taskkill close');assert.equal(killers[0].code,0);
  const killEvent=events.find(e=>e.type==='taskkill-spawn');assert(killEvent.elapsedSinceCancelMs>=4900,'real five second timer');
  await wait(()=>!alive(childPid)&&!alive(grandPid),'entire tree exited');note('tree-dead',{childPid,grandPid});
  assert(job.closed);assert(events.findIndex(e=>e.type==='worker-close')<events.findIndex(e=>e.type==='export-rejected'),'real close precedes export settlement');assert(!fs.existsSync(path.join(job.directory,'p1-preview.mp4')));for(const name of ['input.json','job.log','encode.log','cancel.request'])assert(fs.existsSync(path.join(job.directory,name)));
  assert.equal(handlers['cancel-export'](event).cancelled,false);assert.equal(hash(old),priorHash);
  const retained=['input.json','job.log','encode.log'].map(name=>[name,hash(path.join(job.directory,name))]);
  success=true;const result=await handlers['export-current'](event);assert.equal(fs.readFileSync(result,'utf8'),'SUCCESS FIXTURE, NOT ENCODED VIDEO');assert.equal(killers.length,1);assert.equal(hash(old),priorHash);for(const[name,h]of retained)assert.equal(hash(path.join(job.directory,name)),h);assert.equal(hash(source),sourceHash);
  note('success-retry');report={status:'PASS',runId,startedAt,finishedAt:new Date().toISOString(),root,childPid,grandPid,events,successOutput:result,checks:['unmodified production main with real filesystem and five-second timer','real owned Node worker and grandchild ignore cooperative cancellation','lock and partial output remain at four seconds','actual Windows taskkill /PID owned-worker /T /F exits zero','worker and grandchild both gone before verification','close precedes cancelled export settlement and partial cleanup','diagnostic files and prior sentinel hash preserved','subsequent export fixture succeeds'],limitations:['Electron window and IPC are mocked','export workers are hanging Node fixtures, not Electron/FFmpeg','success file is a fixture marker, not encoded MP4']};
 }catch(error){report={status:'FAIL',runId,startedAt,finishedAt:new Date().toISOString(),root,events,error:error.stack||String(error),sandboxOrSpawnDenied:denied};throw error;
 }finally{
  // Never issue a second taskkill after a denied operation. Successful runs need no cleanup.
  if(!denied){for(const entry of children)if(!entry.closed&&entry.child.pid){note('failure-cleanup-owned-tree',{pid:entry.child.pid});const clean=cp.spawn('taskkill.exe',['/PID',String(entry.child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});await new Promise(resolve=>{clean.once('error',e=>{denied=true;note('cleanup-error',{error:String(e)});resolve();});clean.once('close',code=>{if(code!==0)denied=true;note('cleanup-close',{code});resolve();});});}}
  if(report){report.sandboxOrSpawnDenied=denied;fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
  if(report?.status==='FAIL'){for(const entry of children){if(!entry.closed)entry.child.unref();}process.exitCode=1;}
 }
}
