'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm'),{EventEmitter}=require('events');
test('export worker cancels active FFmpeg and waits for encoder close before failing',async()=>{
 const worker=path.join(__dirname,'../export-main.cjs'),project={design:{width:2,height:2},scene:{durationFrames:0}},child=new EventEmitter();let promise,tick,killed=0,cancel=false,exitCode,closed=false;
 child.kill=()=>{killed++;};
 const electron={app:{disableHardwareAcceleration(){},commandLine:{appendSwitch(){}},setPath(){},getPath(){return 'profile';},whenReady(){return {then:fn=>promise=fn()};},exit:code=>exitCode=code,quit(){throw Error('cancel cannot succeed');}},BrowserWindow:class{constructor(){this.webContents={executeJavaScript:async()=>{}};}async loadFile(){}destroy(){}}};
 vm.runInNewContext(fs.readFileSync(worker,'utf8'),{__dirname:path.dirname(worker),console:{error(){}},process:{env:{REPLAY_EXPORT_CANCEL:'cancel'}},setInterval:fn=>{tick=fn;return 1;},clearInterval(){},require:n=>n==='./core/export-dependencies.cjs'?require('./export-dependencies.cjs'):n==='electron'?electron:n==='fs'?{existsSync:()=>cancel,readFileSync:()=>JSON.stringify(project),mkdirSync(){},writeFileSync(){},openSync:()=>1,closeSync(){closed=true;}}:n==='child_process'?{spawn:()=>child}:n==='./core/session.cjs'?{ProjectSession:class{}}:n==='./core/resource-index.cjs'?{diagnoseAudio:()=>({resources:{}})}:n==='./core/audio-timeline.cjs'?{compileAudioTimeline:()=>({}),buildFfmpegArgs:()=>[]}:require(n)});
 await new Promise(r=>setImmediate(r));assert.equal(typeof tick,'function');cancel=true;tick();tick();assert.equal(killed,1);assert.equal(closed,false);assert.equal(exitCode,undefined);child.emit('close',1);await assert.rejects(promise,/导出已取消/);await new Promise(r=>setImmediate(r));assert.equal(closed,true);assert.equal(exitCode,1);
});
// Keep every job artifact in memory so cleanup scope and retained diagnostics are observable.
function failureHarness(injectedMethod){
 const main=path.join(__dirname,'../main.cjs'),real=require('module').createRequire(main);
 const handlers={},children=[],files=new Map(),removed=[],closed=[],descriptors=new Map();let fd=100;
 class Window{constructor(){this.webContents={mainFrame:{},send(){},once(){}};Window.instance=this;}isDestroyed(){return false;}loadFile(){}on(){}}
 const electron={app:{setPath(){},whenReady(){return {then:fn=>fn()};},on(){}},BrowserWindow:Window,ipcMain:{handle:(n,f)=>handlers[n]=f},dialog:{}};
 const fakeFs={...fs,mkdirSync(){},writeFileSync:(p,s)=>files.set(p,s),
  openSync(p){files.set(p,'diagnostic log');descriptors.set(++fd,p);return fd;},
  closeSync:n=>closed.push(descriptors.get(n)),existsSync:p=>files.has(p),
  rmSync(p,options){removed.push({path:p,force:options?.force,recursive:options?.recursive});files.delete(p);}
 };
 if(injectedMethod){const original=fakeFs[injectedMethod];let fail=true;fakeFs[injectedMethod]=(...args)=>{if(fail){fail=false;throw Object.assign(Error('injected export ENOSPC'),{code:'ENOSPC'});}return original(...args);};}
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{__dirname:path.dirname(main),JSON,process,console,setTimeout:()=>({unref(){}}),clearTimeout(){},require:n=>n==='electron'?electron:n==='fs'?fakeFs:n==='child_process'?{spawn:(exe,args,opts)=>{
  const child=new EventEmitter(),directory=opts.env.REPLAY_EXPORT_OUTPUT;
  children.push({child,directory,movie:path.join(directory,'p1-preview.mp4'),log:path.join(directory,'job.log'),input:opts.env.REPLAY_EXPORT_INPUT});return child;
 }}:n==='./core/recovery.cjs'?{RecoveryStore:class{inspect(){return null;}clear(){}},normalizeDraft:real(n).normalizeDraft}:real(n)});
 const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame};
 return {children,files,removed,closed,export:()=>handlers['export-current'](event)};
}
for(const method of ['mkdirSync','writeFileSync','openSync']){
 test(`export preparation ${method} ENOSPC releases lock without starting worker`,async()=>{
  const h=failureHarness(method),old='previous-job/p1-preview.mp4';h.files.set(old,'old complete movie');
  await assert.rejects(h.export(),error=>error.code==='ENOSPC');
  assert.equal(h.children.length,0);assert.deepEqual(h.removed,[]);assert.equal(h.files.get(old),'old complete movie');
  const retry=h.export(),job=h.children[0];assert.ok(job);h.files.set(job.movie,'complete retry');job.child.emit('close',0);
  assert.equal(await retry,job.movie);assert.equal(h.files.get(old),'old complete movie');assert.deepEqual(h.closed,[job.log]);
 });
}
for(const mode of ['spawnError','nonzero','missing-output']){
 test(`export ${mode} cleans only its own movie after close and permits retry`,async()=>{
  const h=failureHarness();
  // Preserve an actual previously returned successful path, not merely an unrelated filename.
  const previous=h.export(),old=h.children[0];h.files.set(old.movie,'old completed movie');old.child.emit('close',0);
  const previousPath=await previous;assert.equal(previousPath,old.movie);
  const pending=h.export(),job=h.children[1],spawnError=new Error('mock spawn failure');
  assert.notEqual(job.directory,old.directory);
  if(mode!=='missing-output')h.files.set(job.movie,'partial movie');
  let settled=false;pending.then(()=>{settled=true;},()=>{settled=true;});
  const rejection=assert.rejects(pending,error=>{
   if(mode==='spawnError')assert.equal(error,spawnError);
   else {assert.match(error.message,/导出失败/);assert.ok(error.message.includes(job.directory));}
   return true;
  });
  async function assertStillLocked(){
   await assert.rejects(h.export(),/导出任务/);
   assert.equal(h.children.length,2);assert.equal(settled,false);
   assert.deepEqual(h.removed,[]);assert.deepEqual(h.closed,[old.log]);
   assert.equal(h.files.has(job.movie),mode!=='missing-output');
  }
  if(mode==='spawnError')job.child.emit('error',spawnError);
  await assertStillLocked();
  const code=mode==='nonzero'?7:0;
  job.child.emit('exit',code);await assertStillLocked();
  // A zero close after error also verifies that the saved spawn error wins over an existing movie.
  job.child.emit('close',code);await rejection;
  assert.equal(settled,true);
  assert.deepEqual(h.removed,[{path:job.movie,force:true,recursive:undefined}]);
  assert.equal(h.files.has(job.movie),false);assert.deepEqual(h.closed,[old.log,job.log]);
  assert.equal(h.files.get(previousPath),'old completed movie');
  for(const kept of [old.log,old.input,job.log,job.input])assert.ok(h.files.has(kept),`must retain ${kept}`);
  assert.equal(h.files.get(job.log),'diagnostic log');
  const retry=h.export(),next=h.children[2];assert.ok(next);assert.notEqual(next.directory,job.directory);assert.notEqual(next.directory,old.directory);
  h.files.set(next.movie,'retry completed movie');next.child.emit('close',0);
  assert.equal(await retry,next.movie);assert.equal(h.files.get(next.movie),'retry completed movie');
  assert.equal(h.files.get(previousPath),'old completed movie');assert.equal(h.files.get(job.log),'diagnostic log');
  assert.equal(h.removed.length,1);assert.deepEqual(h.closed,[old.log,job.log,next.log]);
 });
}
test('export cancellation authenticates, is idempotent and keeps lock until close',async()=>{
 const main=path.join(__dirname,'../main.cjs'),real=require('module').createRequire(main),handlers={},children=[],writes=[],removed=[],timers=[],killCalls=[];let lastEnv;
 class Window{constructor(){this.webContents={mainFrame:{},send(){},once(){}};Window.instance=this;}isDestroyed(){return false;}loadFile(){}on(){}}
 const electron={app:{setPath(){},whenReady(){return {then:fn=>fn()};},on(){}},BrowserWindow:Window,ipcMain:{handle:(n,f)=>handlers[n]=f},dialog:{}};
 const fakeFs={...fs,mkdirSync(){},writeFileSync:(p,s)=>writes.push(p),openSync:()=>123,closeSync(){},existsSync:()=>true,rmSync:p=>removed.push(p)};
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{__dirname:path.dirname(main),JSON,process:{...process,platform:'win32'},console,setTimeout:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;},clearTimeout(){},require:n=>n==='electron'?electron:n==='fs'?fakeFs:n==='child_process'?{spawn:(exe,args,opts)=>{if(exe==='taskkill.exe'){killCalls.push({exe,args,opts});return new EventEmitter();}const c=new EventEmitter();c.pid=87654;c.kill=()=>{throw Error('must not kill editor or worker directly')};children.push(c);lastEnv=opts.env;return c;}}:n==='./core/recovery.cjs'?{RecoveryStore:class{inspect(){return null;}clear(){}},normalizeDraft:real(n).normalizeDraft}:real(n)});
 const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame};
 await assert.rejects(handlers['export-current']({sender:{}}),/窗口/);assert.throws(()=>handlers['cancel-export']({sender:{}}),/窗口/);
 assert.equal(handlers['cancel-export'](event).cancelled,false);
 const pending=handlers['export-current'](event);const rejection=assert.rejects(pending,/导出已取消/);
 assert.equal(children.length,1);assert.ok(lastEnv.REPLAY_EXPORT_CANCEL.endsWith('cancel.request'));
 assert.equal(handlers['cancel-export'](event).cancelled,true);assert.equal(handlers['cancel-export'](event).cancelled,true);assert.equal(writes.filter(p=>p.endsWith('cancel.request')).length,1);
 await assert.rejects(handlers['export-current'](event),/导出任务/);children[0].emit('exit',0);await assert.rejects(handlers['export-current'](event),/导出任务/);
 const fallback=timers.find(t=>t.ms===5000);assert.ok(fallback,'five-second fallback scheduled');fallback.fn();assert.equal(killCalls.length,1);assert.deepEqual(Array.from(killCalls[0].args),['/PID','87654','/T','/F']);assert.equal(killCalls[0].opts.stdio,'ignore');await assert.rejects(handlers['export-current'](event),/导出任务/);
 children[0].emit('close',0);await rejection;assert.equal(removed.length,1);assert.ok(removed[0].endsWith('p1-preview.mp4'));assert.equal(handlers['cancel-export'](event).cancelled,false);
 const next=handlers['export-current'](event);fallback.fn();assert.equal(killCalls.length,1,'old timer cannot kill a replacement task');children[1].emit('close',0);assert.match(await next,/p1-preview.mp4$/);
});
