'use strict';
// Real complete Electron editor, with a deferred decoder injected only into a separate loader.
// Requires production createWaveformLoader({timeoutMs}) fail-closed support.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runId=process.env.REPLAY_TIMEOUT_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString();
const root=fs.mkdtempSync(path.join(__dirname,'test-output','waveform-timeout-'));
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
let settled=false;
function finish(status,details){if(settled)return;settled=true;const report={status,runId,startedAt,finishedAt:new Date().toISOString(),root,...details};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(status==='PASS'?0:1);}
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const js=source=>win.webContents.executeJavaScript(source);win.show();win.focus();
 for(let i=0;i<500;i++){if(await js('!!window.timelineTest?.model'))break;if(i===499)throw Error('editor init timeout');await new Promise(r=>setTimeout(r,20));}
 const result=await js(`(async()=>{
  const check=(value,message)=>{if(!value)throw Error(message);},delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function bounded(promise,label,ms=2000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' did not settle')),ms);})]);}finally{clearTimeout(timer);}}
  let release;const deferred=new Promise(resolve=>{release=resolve;}),calls=[],started=performance.now();
  // Never replace the production singleton or browser AudioContext/fetch.
  const loader=createWaveformLoader({timeoutMs:50,decode:url=>{calls.push(url);return deferred;},yieldTask:async()=>{}});
  const a=loader.load('fixture:a',0,8),b=loader.load('fixture:b',0,8);
  const responses=await bounded(Promise.all([a,b]),'timeout a/b');
  const elapsedMs=performance.now()-started;
  for(const response of responses)check(response&&response.peaks===null&&typeof response.reason==='string'&&response.reason.length>0,'load must return a failure result');
  check(calls.length===1&&calls[0]==='fixture:a','queued b must not begin decoding after timeout');
  const afterTimeout={...loader.stats};
  check(afterTimeout.inFlight===0,'pending requests did not settle');check(afterTimeout.decodedBytes===0,'decoded cache not empty');check(afterTimeout.peakEntries===0,'peak cache not empty');
  // Promise must already settle without waiting for a fresh decoder timeout.
  let immediateSettled=false;const future=loader.load('fixture:c',0,8).then(value=>{immediateSettled=true;return value;});
  await Promise.resolve();await Promise.resolve();check(immediateSettled,'latched loader must fail immediately');
  const futureResult=await bounded(future,'latched load');check(futureResult.peaks===null&&!!futureResult.reason,'latched load did not fail');check(calls.length===1,'latched loader started a new decoder');
  const buffer=new AudioBuffer({length:16,numberOfChannels:1,sampleRate:48000});buffer.getChannelData(0).fill(.5);
  release(buffer);await delay(100);
  const afterLate={...loader.stats};check(afterLate.inFlight===0&&afterLate.decodedBytes===0&&afterLate.peakEntries===0,'late decoder result repopulated caches');check(calls.length===1,'late resolution started queued decoder');
  const lateRequest=await bounded(loader.load('fixture:a',0,8),'post-late request');check(lateRequest.peaks===null&&!!lateRequest.reason,'late result revived loader');check(calls.length===1,'post-late request restarted decoder');
  return {timeoutMs:50,elapsedMs,calls,responses,afterTimeout,futureResult,immediateSettled,afterLate,lateRequest};
 })()`);
 assert.equal(result.calls.length,1);assert.equal(result.afterLate.inFlight,0);
 finish('PASS',{result,checks:['complete real Electron editor loads production createWaveformLoader','separate loader injected deferred decoder and timeoutMs50','a and queued b settle with failure and empty caches','future load fails immediately without a new decode','real AudioBuffer late resolution cannot refill caches or revive loader'],limitations:['decoder hang is injected, not a naturally hung browser decoder','test uses a separate loader, never alters production waveform singleton','no native drag/canvas or real file decoding in this timeout fixture','elapsed time is observational, not a hard 50ms scheduling guarantee']});
 }catch(error){finish('FAIL',{error:error.stack||String(error)});}}));
setTimeout(()=>finish('FAIL',{error:'waveform timeout test watchdog expired'}),30000).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
