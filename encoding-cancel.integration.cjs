'use strict';
// Real FFmpeg process + unmodified production worker logic. Electron screenshot shell is a fixture.
// -re is inserted before the image input solely to keep encoding active long enough to cancel.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const cp=require('node:child_process'),{createRequire}=require('node:module');
const runId=crypto.randomUUID(),startedAt=new Date().toISOString(),root=path.join(__dirname,'test-output','encoding-cancel-'+runId);
fs.mkdirSync(root,{recursive:true});
const reportFile=path.join(root,'report.json'),cancelFile=path.join(root,'cancel.request'),input=path.join(root,'input.json');
const worker=path.join(__dirname,'export-main.cjs'),realRequire=createRequire(worker),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sourceHash=hash(worker),events=[],logs=[],errors=[];let child,workerResult,appCode,quit=false,captures=0,encoderClosed=false,poll,timeout;
const note=(type,extra={})=>events.push({index:events.length,type,at:new Date().toISOString(),...extra});
// Build an ordinary valid RGB PNG; FFmpeg decodes all fixture frames from disk.
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),n=Buffer.alloc(4),c=Buffer.alloc(4);n.writeUInt32BE(data.length);c.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([n,t,data,c]);}
const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=2;
const pixels=Buffer.alloc(64*(1+64*3),80);for(let y=0;y<64;y++)pixels[y*(1+64*3)]=0;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const project={schemaVersion:1,id:'encoding-cancel',locale:'en',design:{width:64,height:64,fps:30},resources:[],scene:{durationFrames:300,characters:[],dialogues:[],audioTracks:[]}};
fs.writeFileSync(input,JSON.stringify({project,revision:0}));
const oldRoot=path.join(__dirname,'runtime-output');
const oldFiles=fs.existsSync(oldRoot)?fs.readdirSync(oldRoot).filter(x=>x.startsWith('job-')).map(x=>path.join(oldRoot,x,'p1-preview.mp4')).filter(f=>fs.existsSync(f)&&fs.statSync(f).isFile()):[];
const oldHashes=oldFiles.map(f=>[f,hash(f)]);
const app={disableHardwareAcceleration(){},commandLine:{appendSwitch(){}},setPath(){},getPath(){return path.join(root,'profile');},whenReady(){return{then(fn){workerResult=Promise.resolve().then(fn);return workerResult;}};},quit(){quit=true;note('app-quit');},exit(code){appCode=code;note('app-exit',{code,encoderClosed});}};
class FixtureWindow{constructor(){this.webContents={executeJavaScript:async()=>{},capturePage:async()=>{captures++;return{getSize:()=>({width:64,height:64}),toPNG:()=>png};}};}async loadFile(){}destroy(){note('window-destroy');}}
const spawn=(exe,args,opts)=>{
 assert.equal(path.basename(exe),'ffmpeg.exe');assert.equal(captures,300,'all render frames must finish before spawn');assert.equal(fs.existsSync(cancelFile),false);
 const limited=[...args];limited.splice(0,0,'-re');
 child=cp.spawn(exe,limited,opts);note('encoder-spawn',{pid:child.pid,args:limited});
 const kill=child.kill.bind(child);child.kill=(...a)=>{note('encoder-kill-request',{encoderClosed});return kill(...a);};
 child.on('error',e=>note('encoder-error',{error:e.message}));
 child.on('exit',(code,signal)=>note('encoder-exit',{code,signal}));
 child.on('close',(code,signal)=>{encoderClosed=true;note('encoder-close',{code,signal});});
 return child;
};
async function run(){
 const context={__dirname,process:{env:{...process.env,REPLAY_EXPORT_INPUT:input,REPLAY_EXPORT_OUTPUT:root,REPLAY_PROJECT_ROOT:root,REPLAY_EXPORT_CANCEL:cancelFile}},console:{log:s=>logs.push(String(s)),error:e=>errors.push(String(e?.stack||e))},setInterval,clearInterval,require:n=>n==='electron'?{app,BrowserWindow:FixtureWindow}:n==='child_process'?{...cp,spawn}:realRequire(n)};
 vm.runInNewContext(fs.readFileSync(worker,'utf8'),context,{filename:worker});
 await new Promise((resolve,reject)=>{
  poll=setInterval(()=>{try{
   if(encoderClosed&&!fs.existsSync(cancelFile))throw Error('Encoder exited before cancellation opportunity');
   if(!child||!fs.existsSync(path.join(root,'encode.log')))return;
   const log=fs.readFileSync(path.join(root,'encode.log'),'utf8');
   const matches=[...log.matchAll(/frame=\s*(\d+)/g)];const frame=matches.length?Number(matches[matches.length-1][1]):0;
   if(frame<1)return;
   assert.equal(child.exitCode,null);assert.equal(encoderClosed,false);assert.equal(captures,300);
   assert.match(log,/libx264/);assert.match(log,/Output #0/);
   note('cancel-token-written',{encodedFrame:frame,renderedFrames:captures,encoderPid:child.pid});fs.writeFileSync(cancelFile,'cancel');clearInterval(poll);resolve();
  }catch(e){clearInterval(poll);reject(e);}},25);
  timeout=setTimeout(()=>reject(Error('No live encoding progress within 20 seconds')),20000);
 });
 clearTimeout(timeout);
 await assert.rejects(workerResult,/导出已取消/);await new Promise(r=>setImmediate(r));
 assert.equal(quit,false);assert.equal(appCode,1);assert.equal(encoderClosed,true);assert(logs.every(x=>!x.includes('PASS')));
 const at=t=>events.findIndex(e=>e.type===t);assert(at('cancel-token-written')>at('encoder-spawn'));assert(at('encoder-kill-request')>at('cancel-token-written'));assert(at('encoder-close')>at('encoder-kill-request'));assert(at('app-exit')>at('encoder-close'));assert.equal(events.filter(e=>e.type==='encoder-kill-request').length,1);
 assert(errors.some(x=>x.includes('导出已取消')));assert.equal(hash(worker),sourceHash);for(const [f,digest]of oldHashes)assert.equal(hash(f),digest);
 return {status:'PASS',runId,startedAt,finishedAt:new Date().toISOString(),root,events,workerExitCode:appCode,encoderClosed,renderedFrames:captures,previousMoviesUnchanged:oldHashes.length,productionWorkerHash:sourceHash,partialMovieRetainedByDirectWorker:fs.existsSync(path.join(root,'p1-preview.mp4')),checks:['real FFmpeg libx264 output progress before cancellation token','all 300 fixture PNGs written before encoding starts','production timer requests exactly one real encoder kill','real encoder exit and close recorded','worker reports cancellation exit1 only after real encoder close','no worker success log and no app.quit','old runtime movies and production worker unchanged'],limitations:['Electron BrowserWindow screenshot shell is stubbed with valid64x64 PNG; not native GUI rendering','-re inserted only by test spawn wrapper; not production long-encoding performance','direct worker does not run main parent partial-file cleanup; covered separately by GUI cancellation/failure tests','no forced termination fallback or disk exhaustion']};
}
run().then(report=>{fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}).catch(async error=>{clearInterval(poll);clearTimeout(timeout);if(child&&!encoderClosed){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}const report={status:'FAIL',runId,startedAt,finishedAt:new Date().toISOString(),root,error:error.stack||String(error),events,errors,logs};fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.error(JSON.stringify(report));process.exitCode=1;});
