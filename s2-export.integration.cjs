'use strict';
// Run with Node. Only native file pickers are scripted; real main/preload/export worker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),hash=f=>sha(fs.readFileSync(f));
function hashes(dir,prefix=''){return Object.fromEntries(fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?Object.entries(hashes(path.join(dir,e.name),prefix+e.name+'/')):[[prefix+e.name,hash(path.join(dir,e.name))]]));}
const roi={x:40,y:40,w:440,h:260}; // excludes dialogue and foreground portrait
function diff(a,b,channels=3){let sum=0,max=0;for(let y=roi.y;y<roi.y+roi.h;y++)for(let x=roi.x;x<roi.x+roi.w;x++)for(let c=0;c<3;c++){const d=Math.abs(a[(y*960+x)*channels+c]-b[(y*960+x)*channels+c]);sum+=d;max=Math.max(max,d);}return {mae:sum/(roi.w*roi.h*3),max};}
if(process.versions.electron)electronPhase();else nodeRunner();
function electronPhase(){
 const {app,dialog,nativeImage}=require('electron'),root=process.env.REPLAY_S2_EXPORT_ROOT,runId=process.env.REPLAY_S2_EXPORT_RUN_ID;
 assert.ok(root&&runId,'Use Node runner');
 const productionRoot=path.join(root,'production/P2'),formalFile=path.join(root,'formal/s2.json');
 let openFile=path.join(root,'fixture-copy/场景.json'),finished=false;
 const evidence={runId,pid:process.pid,startedAt:new Date().toISOString(),productionRoot,formalFile};
 function finish(status,error){if(finished)return;finished=true;Object.assign(evidence,{status,error:error?.stack,finishedAt:new Date().toISOString()});fs.writeFileSync(path.join(root,'phase.json'),JSON.stringify(evidence,null,2));app.exit(status==='PASS'?0:1);}
 dialog.showOpenDialog=async()=>({canceled:false,filePaths:[openFile]});dialog.showSaveDialog=async()=>({canceled:false,filePath:formalFile});
 dialog.showMessageBox=async()=>{throw Error('Unexpected confirmation/recovery dialog');};
 app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
 app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
  const js=s=>win.webContents.executeJavaScript(s);
  try{
   await js(`(async()=>{for(let i=0;i<400;i++){if(typeof current!=='undefined'&&current&&document.querySelector('#code-text').value)return;await new Promise(r=>setTimeout(r,25));}throw Error('Initialization timeout');})()`);
   await js('replay.openProject()');const baseline=await js('replay.project()');evidence.baseline=baseline;
   assert.equal(baseline.project.scene.durationFrames,210);assert.equal(baseline.project.scene.audioTracks.length,0);
   evidence.baselineMovie=await js('replay.exportCurrent()');assert.equal(typeof evidence.baselineMovie,'string');
   const audio=await js(`(async()=>{const p=await replay.project();return replay.dropAudioResource({commandId:crypto.randomUUID(),documentId:p.documentId,expectedRevision:p.revision,resourceId:'cue_01',kind:'bgm',atFrame:30});})()`);
   assert.equal(audio.ok,true,JSON.stringify(audio));assert.equal(audio.revision,baseline.revision+1);
   const background=await js(`(async()=>{const p=await replay.project();return replay.dropBackgroundResource({commandId:crypto.randomUUID(),documentId:p.documentId,expectedRevision:p.revision,resourceId:'portrait_base',atFrame:90});})()`);
   assert.equal(background.ok,true,JSON.stringify(background));assert.equal(background.revision,baseline.revision+2);evidence.commands={audio,background};
   const committed=await js('replay.project()'),track=committed.project.scene.audioTracks.find(t=>t.id===audio.created.audioTrackId),event=committed.project.scene.backgroundEvents.find(e=>e.id===background.created.eventId);
   assert.ok(track&&event);assert.equal(track.resourceId,'cue_01');assert.equal(track.kind,'bgm');assert.equal(track.startFrame,30);assert.equal(track.durationSamples,192000);
   assert.deepEqual(event,{id:background.created.eventId,frame:90,background:{kind:'image',resourceId:'portrait_base'}});
   assert.deepEqual(committed.project.scene.dialogues,baseline.project.scene.dialogues);assert.deepEqual(committed.project.scene.characters,baseline.project.scene.characters);
   await js('replay.saveAs()');const saved=await js('replay.project()');assert.equal(saved.file,formalFile);assert.equal(saved.dirty,false);
   evidence.formalSha256=hash(formalFile);openFile=formalFile;await js('replay.openProject()');const reopened=await js('replay.project()');evidence.reopened=reopened;
   assert.notEqual(reopened.documentId,saved.documentId);assert.deepEqual(reopened.project,saved.project);assert.equal(reopened.revision,saved.revision);assert.equal(reopened.dirty,false);
   assert.deepEqual(reopened.project.scene.audioTracks.find(t=>t.id===track.id),track);assert.deepEqual(reopened.project.scene.backgroundEvents.find(e=>e.id===event.id),event);
   const original=JSON.parse(fs.readFileSync(path.join(root,'fixture-copy/场景.json'),'utf8').replace(/^\uFEFF/,''));evidence.resourceHashes={};
   for(const r of reopened.project.resources){const source=original.project.resources.find(o=>o.id===r.id),h=hash(path.resolve(path.dirname(formalFile),r.path));assert.equal(h,hash(path.resolve(root,'fixture-copy',source.path)));evidence.resourceHashes[r.id]=h;}
   evidence.previews=[];
   for(const frame of [89,90,91]){
    const state=await js(`(async()=>{syncTransportFrame(${frame});await locate();await sceneRenderer.ready();return await replay.evaluate(${frame});})()`);
    assert.equal(state.background.resourceId,frame<90?'background':'portrait_base');
    const screenshot=path.join(root,`editor-${frame}.png`);fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());evidence.previews.push({frame,state,screenshot,sha256:hash(screenshot)});
   }
   evidence.s2Movie=await js('replay.exportCurrent()');assert.equal(typeof evidence.s2Movie,'string');assert.notEqual(evidence.s2Movie,evidence.baselineMovie);assert.equal(hash(formalFile),evidence.formalSha256);
   const images={};for(const n of [89,90,91]){const image=nativeImage.createFromPath(path.join(path.dirname(evidence.s2Movie),'frames',String(n).padStart(4,'0')+'.png'));assert.deepEqual(image.getSize(),{width:960,height:540});images[n]=image.toBitmap();}
   evidence.nativeImageROI={roi,boundary:diff(images[89],images[90],4),stable:diff(images[90],images[91],4)};assert.ok(evidence.nativeImageROI.boundary.mae>1);assert.equal(evidence.nativeImageROI.stable.max,0);finish('PASS');
  }catch(error){finish('FAIL',error);}
 }));
 setTimeout(()=>finish('FAIL',Error('Electron phase timeout')),480000).unref();
 require(path.join(productionRoot,'main.cjs'));
 const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);
}
async function nodeRunner(){
 const runId=crypto.randomUUID(),root=path.resolve(__dirname,'../test-output/P2','s2-export-'+runId);fs.mkdirSync(root,{recursive:true});
 const source=path.join(__dirname,'fixtures/original-scene-project'),productionRoot=path.join(root,'production/P2');
 const report={runId,root,pid:process.pid,status:'RUNNING',startedAt:new Date().toISOString(),processes:[],metrics:{},roi,limitations:['Native file pickers scripted; no pointer-drag claim','AAC comparisons have tolerances; no arbitrary loudness or exact-waveform claim','Editor screenshots are evidence; numerical ROI uses full-size production export captures']};
 async function exec(exe,args,label,env=process.env,timeoutMs=120000){
  const log=path.join(root,label+'.log'),fd=fs.openSync(log,'w'),record={label,exe,args,log,pid:null,exitCode:null,startedAt:new Date().toISOString()};report.processes.push(record);
  try{await new Promise((resolve,reject)=>{let child;try{child=spawn(exe,args,{env,stdio:['ignore',fd,fd],windowsHide:true});}catch(e){record.spawnError=e.stack;reject(e);return;}record.pid=child.pid??null;let spawnError;
   child.once('error',e=>{spawnError=e;record.spawnError=e.stack;});const timer=setTimeout(()=>{record.timedOut=true;child.kill();},timeoutMs);
   child.once('close',(code,signal)=>{clearTimeout(timer);Object.assign(record,{exitCode:code,signal,finishedAt:new Date().toISOString()});if(spawnError||record.timedOut||code!==0||signal)reject(spawnError||Error(`${label} exit=${code} signal=${signal}; ${log}`));else resolve();});
  });}finally{fs.closeSync(fd);record.logSha256=hash(log);}return log;
 }
 try{
  report.sourceBefore=hashes(source);report.runnerSha256=hash(__filename);fs.cpSync(source,path.join(root,'fixture-copy'),{recursive:true,errorOnExist:true,force:false});
  fs.mkdirSync(productionRoot,{recursive:true});for(const name of ['main.cjs','export-main.cjs','core','renderer','examples','assets'])fs.cpSync(path.join(__dirname,name),path.join(productionRoot,name),{recursive:true});report.productionBefore=hashes(productionRoot);
  // Preserve the unmodified export-main ../p0/tools resolution; do not bypass main export.
  const tools=path.join(root,'production/p0/tools');fs.mkdirSync(tools,{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../p0/tools/ffmpeg.exe'),path.join(tools,'ffmpeg.exe'));report.ffmpegSha256=hash(path.join(tools,'ffmpeg.exe'));
  const electron=path.resolve(__dirname,'../p0/node_modules/electron/dist/electron.exe'),ffmpeg=path.join(tools,'ffmpeg.exe'),ffprobe=path.resolve(__dirname,'../p0/tools/ffprobe.exe');
  const env={...process.env,REPLAY_S2_EXPORT_ROOT:root,REPLAY_S2_EXPORT_RUN_ID:runId,REPLAY_RECOVERY_DIR:path.join(root,'recovery')};for(const k of ['ELECTRON_RUN_AS_NODE','REPLAY_EXPORT_INPUT','REPLAY_EXPORT_OUTPUT','REPLAY_EXPORT_CANCEL','REPLAY_PROJECT_ROOT'])delete env[k];
  await exec(electron,[__filename],'electron-phase',env,510000);
  const phaseFile=path.join(root,'phase.json'),phase=JSON.parse(fs.readFileSync(phaseFile,'utf8'));assert.equal(phase.runId,runId);assert.equal(phase.pid,report.processes[0].pid);assert.equal(phase.status,'PASS');report.phase={file:phaseFile,sha256:hash(phaseFile),...phase};
  const pcm={},snapshots={};report.exports={};
  for(const [name,movie]of [['baseline',phase.baselineMovie],['s2',phase.s2Movie]]){
   assert.ok(path.resolve(movie).startsWith(productionRoot+path.sep),'movie must come from isolated real main');
   const probeFile=await exec(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',movie],name+'-probe'),probe=JSON.parse(fs.readFileSync(probeFile,'utf8')),v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.filter(s=>s.codec_type==='audio');
   assert.equal(Number(v.nb_read_frames),210);assert.equal(v.width,960);assert.equal(v.height,540);assert.equal(v.r_frame_rate,'30/1');assert.equal(a.length,1);assert.equal(Number(a[0].sample_rate),48000);assert.equal(a[0].channels,2);assert.ok(Math.abs(Number(probe.format.duration)-7)<0.1);
   const snapshotFile=path.join(path.dirname(movie),'export-snapshot.json');snapshots[name]=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));const packet=name==='baseline'?phase.baseline:phase.reopened;assert.deepEqual(snapshots[name].project,packet.project);assert.equal(snapshots[name].revision,packet.revision);
   const raw=path.join(root,name+'.f32');await exec(ffmpeg,['-y','-v','error','-i',movie,'-vn','-ac','2','-ar','48000','-f','f32le',raw],name+'-pcm');pcm[name]=fs.readFileSync(raw);assert.ok(pcm[name].length>=336000*8);assert.equal(pcm[name].length%8,0);for(let i=0;i<pcm[name].length;i+=4)assert.ok(Number.isFinite(pcm[name].readFloatLE(i)));
   report.exports[name]={movie,sha256:hash(movie),probe,snapshotFile,snapshotSha256:hash(snapshotFile),pcm:raw,pcmSha256:hash(raw)};
  }
  const timeline=snapshots.s2.timeline,trackId=phase.commands.audio.created.audioTrackId,added=timeline.clips.find(c=>c.trackId===trackId);assert.ok(added);assert.equal(added.startSamples,48000);assert.equal(added.durationSamples,192000);assert.equal(added.resourceId,'cue_01');assert.equal(timeline.sampleRate,48000);assert.equal(timeline.durationSamples,336000);assert.equal(timeline.clips.length,3);assert.deepEqual(timeline.clips.filter(c=>c.trackId!==trackId),snapshots.baseline.timeline.clips);report.timeline=timeline;
  function pcmDiff(start,end){let sum=0,max=0,base=0;for(let i=start*2;i<end*2;i++){const a=pcm.baseline.readFloatLE(i*4),b=pcm.s2.readFloatLE(i*4),d=a-b;sum+=d*d;base+=a*a;max=Math.max(max,Math.abs(d));}return {startSample:start,endSample:end,rmsDifference:Math.sqrt(sum/((end-start)*2)),maxDifference:max,baselineRms:Math.sqrt(base/((end-start)*2))};}
  // Full pre-F30 region plus interior excluding AAC boundary lookahead; no loudness assertion.
  report.metrics.preOnset=pcmDiff(0,48000);report.metrics.preOnsetInterior=pcmDiff(0,45600);report.metrics.addedInterior=pcmDiff(60000,228000);report.metrics.afterAdded=pcmDiff(252000,336000);
  assert.ok(report.metrics.preOnset.rmsDifference<0.005,'pre-F30 audio agrees within AAC tolerance');assert.ok(report.metrics.preOnsetInterior.rmsDifference<0.001);assert.ok(report.metrics.addedInterior.rmsDifference>0.002,'added interval differs, not merely nonempty');assert.ok(report.metrics.addedInterior.rmsDifference>report.metrics.preOnsetInterior.rmsDifference*5);assert.ok(report.metrics.afterAdded.rmsDifference<0.005);
  const frames={};for(const n of [89,90,91])for(const mode of ['png','mp4']){
   const out=path.join(root,`${mode}-${n}.rgb`),movie=phase.s2Movie,args=mode==='png'?['-i',path.join(path.dirname(movie),'frames',String(n).padStart(4,'0')+'.png')]:['-i',movie,'-vf',`select=eq(n\\,${n})`];
   await exec(ffmpeg,['-y','-v','error',...args,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',out],`${mode}-${n}`);frames[mode+n]=fs.readFileSync(out);assert.equal(frames[mode+n].length,960*540*3);
  }
  report.metrics.pngBoundary=diff(frames.png89,frames.png90);report.metrics.pngStable=diff(frames.png90,frames.png91);report.metrics.mp4Boundary=diff(frames.mp489,frames.mp490);assert.ok(report.metrics.pngBoundary.mae>1);assert.equal(report.metrics.pngStable.max,0);assert.ok(report.metrics.mp4Boundary.mae>1);
  for(const n of [89,90,91]){const m=report.metrics['mp4VsPng'+n]=diff(frames['png'+n],frames['mp4'+n]);assert.ok(m.mae<12);}
  report.thresholds={backgroundMaeMin:1,stablePngMax:0,mp4VsPngMaeMax:12,preOnsetRmsMax:0.005,preOnsetInteriorRmsMax:0.001,addedRmsMin:0.002,addedVsPreRatioMin:5,afterAddedRmsMax:0.005};
  for(const [name,h]of Object.entries(report.productionBefore))assert.equal(hash(path.join(productionRoot,name)),h,name);assert.equal(hash(__filename),report.runnerSha256);report.status='PASS';
 }catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
 finally{
  try{report.sourceAfter=hashes(source);assert.deepEqual(report.sourceAfter,report.sourceBefore);assert.deepEqual(hashes(path.join(root,'fixture-copy')),report.sourceBefore);report.sourceHashesUnchanged=true;}catch(error){report.status='FAIL';report.sourceHashError=error.stack;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();const file=path.join(root,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,runId,report:file,error:report.error}));
 }
}
