'use strict';
// Real Electron/WAV/canvas integration. IPC edits are deliberate: not a native drag test.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runId=process.env.REPLAY_TEST_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString();
const root=fs.mkdtempSync(path.join(__dirname,'test-output','waveform-'));
const reportPath=path.join(__dirname,'test-output','gui-waveform.json');
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
function wavFile(name,seconds){
 const samples=48000*seconds,bytes=Buffer.alloc(44+samples*4);
 bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(192000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*4,40);
 // Left channel remains silent; right channel alone must produce visible ink.
 for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round((i<samples/2?2000:24000)*Math.sin(2*Math.PI*(i%80)/80)),44+i*4+2);
 const file=path.join(root,name);fs.writeFileSync(file,bytes);return file;
}
const small=wavFile('stereo-two-sections.wav',2),large=wavFile('stereo-170-seconds.wav',170);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const hashes=[small,large].map(file=>[file,hash(file)]);
let picker=small,settled=false;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[picker]});dialog.showMessageBox=async()=>({response:0});
function finish(status,detail){if(settled)return;settled=true;const report={status,runId,startedAt,finishedAt:new Date().toISOString(),root,...detail};fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(status==='PASS'?0:1);}
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const js=s=>win.webContents.executeJavaScript(s);
 async function wait(fn,label){const end=Date.now()+45000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timeout '+label+'; '+await js(`document.querySelector('#log').textContent`));}
 const packet=()=>js('(async()=>await replay.project())()');
 win.show();win.focus();await wait(()=>js(`!!window.timelineTest?.model && !!document.querySelector('#dialogue-select').value`),'editor ready');
 const ids=await js(`(async()=>{const p=await replay.project();p.project.scene.durationFrames=5100;await replay.applyProjectCode({text:JSON.stringify(p.project),expectedRevision:p.revision});const a=await replay.importAudioTrack({kind:'bgm',startFrame:0});const b=await replay.splitAudioTrack(a.id,30);await locate();return [a.id,b.id];})()`);
 const selector=id=>`.timeline-item[data-kind="audioTracks"][data-id="${id}"]`;
 async function ready(id){await wait(()=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector(id))});return e?.dataset.waveformStatus==='ready'&&!!e.querySelector('canvas.timeline-waveform');})()`),'canvas '+id);}
 const measure=id=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector(id))}),c=e.querySelector('canvas.timeline-waveform'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let lo=c.height,hi=-1,ink=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]){lo=Math.min(lo,y);hi=Math.max(hi,y);ink++;}return {status:e.dataset.waveformStatus,key:e.dataset.waveformKey,width:c.width,height:c.height,ink,span:hi<0?0:hi-lo+1,pixels:Array.from(d)};})()`);
 await ready(ids[0]);await ready(ids[1]);
 const quiet=await measure(ids[0]),loud=await measure(ids[1]);
 for(const m of [quiet,loud]){assert(m.width>0&&m.height>0);assert(m.ink>0);assert.equal(m.status,'ready');}
 assert(loud.span>quiet.span*2,JSON.stringify({quiet:quiet.span,loud:loud.span}));
 const before=await packet(),tracks=ids.map(id=>before.project.scene.audioTracks.find(t=>t.id===id));
 assert.equal(tracks[0].resourceId,tracks[1].resourceId);assert.equal(tracks[0].sourceOffsetSamples??0,0);assert.equal(tracks[1].sourceOffsetSamples,48000);
 // Change right-hand source selection to the quiet half without changing its scene interval.
 await js(`(async()=>{await replay.editAudioTrack(${JSON.stringify(ids[1])},{sourceOffsetSamples:0});await locate();})()`);
 await ready(ids[1]);const trimmed=await measure(ids[1]);assert(trimmed.span*2<loud.span);assert.equal(trimmed.span,quiet.span);
 await js(`(async()=>{await document.querySelector('#undo').onclick();await locate();})()`);
 await ready(ids[1]);const restored=await measure(ids[1]);assert.deepEqual(restored.pixels,loud.pixels);assert.equal(restored.key,loud.key);assert.deepEqual((await packet()).project,before.project);
 // Real 31.13MiB PCM16 source / 62.26MiB decoded PCM, near 32/64MiB guards.
 // Measure renderer timer gaps over import+decode+reduction+paint; not a memory benchmark.
 picker=large;
 await js(`(()=>{window.waveformTiming={start:performance.now(),previous:performance.now(),gaps:[]};window.waveformTimer=setInterval(()=>{const now=performance.now();waveformTiming.gaps.push(now-waveformTiming.previous);waveformTiming.previous=now;},16);})()`);
 const bigId=await js(`(async()=>{const r=await replay.importAudioTrack({kind:'sfx',startFrame:0});await locate();return r.id;})()`);
 await ready(bigId);
 const perf=await js(`(()=>{clearInterval(window.waveformTimer);const p=waveformTiming,gaps=p.gaps.slice().sort((a,b)=>a-b);return {elapsedMs:performance.now()-p.start,timerIntervalMs:16,ticks:gaps.length,maxGapMs:gaps.length?gaps[gaps.length-1]:null,p95GapMs:gaps.length?gaps[Math.floor((gaps.length-1)*.95)]:null,cache:waveformLoader.stats};})()`);
 const big=await measure(bigId);assert(big.ink>0);assert(perf.ticks>0,'event loop must run during analysis');assert(perf.cache.decodedBytes<=32*1024*1024);
 for(const [file,expected] of hashes)assert.equal(hash(file),expected);
 const after=await packet(),managed=after.project.resources.find(r=>r.id===tracks[0].resourceId);assert.equal(hash(path.resolve(__dirname,managed.path)),hashes[0][1]);
 const compact=m=>({status:m.status,key:m.key,width:m.width,height:m.height,ink:m.ink,span:m.span});
 finish('PASS',{small:{quiet:compact(quiet),loud:compact(loud),trimmed:compact(trimmed),restored:compact(restored)},large:{seconds:170,sourceBytes:fs.statSync(large).size,estimatedDecodedBytes:170*48000*2*4,...perf,canvas:compact(big)},sourceHashes:hashes.map(([file,sha256])=>({file,sha256})),checks:['real WAV decode and canvas alpha pixels, not only helper values','silent left/right-only signal produces envelope','IPC split reuses resource with distinct source offsets','high interval ink span exceeds quiet interval by more than 2x','source range edit changes canvas; undo restores exact pixels and project','170-second near-limit actual WAV paints with timer heartbeat observed','source and managed WAV hashes preserved'],limitations:['single run on this machine; timings observational, no strict latency service target','does not measure peak process memory or sustained cache eviction','not unlimited-large-file or hour-long project qualification','edits use production IPC; not a native mouse drag regression']});
 }catch(error){finish('FAIL',{error:error.stack||String(error)});}}));
setTimeout(()=>finish('FAIL',{error:'Waveform integration watchdog expired'}),120000).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
