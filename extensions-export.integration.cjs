'use strict';
// Node runner; only native dialogs are scripted. Parent must authorize Electron execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function hashes(dir,prefix=''){return Object.fromEntries(fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?Object.entries(hashes(path.join(dir,e.name),prefix+e.name+'/')):[[prefix+e.name,hash(path.join(dir,e.name))]]));}
const roi={x:30,y:340,w:880,h:160};
function diff(a,b,r=roi){assert.equal(a.length,960*540*3);assert.equal(a.length,b.length);let sum=0,max=0;for(let y=r.y;y<r.y+r.h;y++)for(let x=r.x;x<r.x+r.w;x++)for(let c=0;c<3;c++){const d=Math.abs(a[(y*960+x)*3+c]-b[(y*960+x)*3+c]);sum+=d;max=Math.max(max,d);}return {roi:r,mae:sum/(r.w*r.h*3),max};}
if(process.versions.electron)electronPhase();else nodeRunner();
function electronPhase(){
 const {app,dialog}=require('electron'),root=process.env.REPLAY_EXTENSIONS_EXPORT_ROOT,runId=process.env.REPLAY_EXTENSIONS_EXPORT_RUN_ID;assert.ok(root&&runId,'Use Node runner');
 const productionRoot=path.join(root,'production/P2'),formalFile=path.join(root,'formal/schema2.json'),pack=path.join(productionRoot,'component-packs/starter-dialogue-v0.1');
 let openFile=path.join(root,'fixture-copy/场景.json'),finished=false;
 const evidence={runId,pid:process.pid,startedAt:new Date().toISOString(),productionRoot,formalFile,dialogs:[]};
 function finish(status,error){if(finished)return;finished=true;Object.assign(evidence,{status,error:error?.stack,finishedAt:new Date().toISOString()});fs.writeFileSync(path.join(root,'phase.json'),JSON.stringify(evidence,null,2));app.exit(status==='PASS'?0:1);}
 dialog.showOpenDialog=async(...args)=>{const options=args.at(-1),directory=options.properties?.includes('openDirectory'),selected=directory?pack:openFile;evidence.dialogs.push({kind:directory?'directory':'open',selected,options});assert.ok(fs.existsSync(selected));return {canceled:false,filePaths:[selected]};};
 dialog.showSaveDialog=async()=>{evidence.dialogs.push({kind:'save',selected:formalFile});return {canceled:false,filePath:formalFile};};
 dialog.showMessageBox=async()=>{throw Error('Unexpected confirmation/recovery dialog');};
 app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
 app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
  const js=s=>win.webContents.executeJavaScript(s),command=(method,extra)=>js(`(async()=>{const p=await replay.project();return replay.${method}({commandId:crypto.randomUUID(),documentId:p.documentId,expectedRevision:p.revision,...${JSON.stringify(extra)}});})()`);
  try{
   await js(`(async()=>{for(let i=0;i<400;i++){if(typeof current!=='undefined'&&current&&document.querySelector('#code-text').value)return;await new Promise(r=>setTimeout(r,25));}throw Error('Initialization timeout');})()`);
   await js('replay.openProject()');const baseline=await js('replay.project()');evidence.baseline=baseline;
   assert.equal(baseline.project.schemaVersion,1);assert.equal(baseline.project.scene.durationFrames,210);
   evidence.baselineMovie=await js('replay.exportCurrent()');assert.equal(typeof evidence.baselineMovie,'string');
   const split=await command('splitVoiceClip',{dialogueId:'d1',clipId:null,atFrame:60});assert.equal(split.ok,true,JSON.stringify(split));assert.equal(split.upgraded,true);evidence.split=split;
   const migrated=await js('replay.project()');evidence.migrated=migrated;assert.equal(migrated.project.schemaVersion,2);assert.equal(migrated.revision,baseline.revision+1);
   const d1=migrated.project.scene.dialogues.find(d=>d.id==='d1'),d2=migrated.project.scene.dialogues.find(d=>d.id==='d2');
   assert.equal(d1.voice,undefined);assert.equal(d2.voice,undefined);assert.equal(d1.voiceClips.length,2);assert.equal(d2.voiceClips.length,1);
   const [left,right]=d1.voiceClips;assert.notEqual(left.id,right.id);assert.equal(right.id,split.created.clipId);
   assert.equal(left.resourceId,'cue_01');assert.equal(right.resourceId,left.resourceId);assert.equal(left.sourceOffsetSamples,0);assert.equal(left.durationSamples,96000);assert.equal(right.sourceOffsetSamples,96000);assert.equal(right.durationSamples,96000);assert.equal(left.binding.followOffsetFrames,0);assert.equal(right.binding.followOffsetFrames,60);
   const imported=await js('replay.importComponentPack()');evidence.imported=imported;assert.equal(imported.cancelled,false);
   const afterImport=await js('replay.project()'),definition=afterImport.project.componentDefinitions.find(d=>imported.definitionIds.includes(d.id)&&d.kind==='dialogue-ui');assert.ok(definition);assert.equal(afterImport.project.scene.components.length,0);
   const added=await command('addComponent',{definitionId:definition.id,atFrame:0,x:40,y:350});assert.equal(added.ok,true,JSON.stringify(added));evidence.added=added;
   const instanceId=added.created.instanceId,afterAdd=await js('replay.project()'),instance=afterAdd.project.scene.components.find(c=>c.id===instanceId);
   assert.equal(instance.width,880);assert.equal(instance.height,160);assert.equal(instance.x,40);assert.equal(instance.y,350);
   const edited=await command('editComponent',{instanceId,patch:{x:30,y:340}});assert.equal(edited.ok,true,JSON.stringify(edited));evidence.edited=edited;
   const committed=await js('replay.project()');assert.deepEqual(committed.project.scene.dialogues,migrated.project.scene.dialogues);assert.deepEqual(committed.project.scene.components.find(c=>c.id===instanceId),{...instance,x:30,y:340});
   await js('replay.saveAs()');const saved=await js('replay.project()');assert.equal(saved.file,formalFile);assert.notEqual(saved.file,openFile);assert.equal(saved.dirty,false);assert.equal(JSON.parse(fs.readFileSync(formalFile,'utf8')).project.schemaVersion,2);evidence.formalSha256=hash(formalFile);
   // Rename ONLY isolated author pack, before reopen/export; original pack is never modified.
   fs.renameSync(pack,pack+'.unavailable');evidence.removedAuthorPack={from:pack,to:pack+'.unavailable',hashes:hashes(pack+'.unavailable')};assert.equal(fs.existsSync(pack),false);
   openFile=formalFile;await js('replay.openProject()');const reopened=await js('replay.project()');evidence.reopened=reopened;assert.notEqual(reopened.documentId,saved.documentId);assert.deepEqual(reopened.project,saved.project);assert.equal(reopened.revision,saved.revision);assert.equal(reopened.dirty,false);
   evidence.resourceHashes={};for(const r of reopened.project.resources){const original=baseline.project.resources.find(o=>o.id===r.id);assert.ok(original);const actual=hash(path.resolve(path.dirname(formalFile),r.path));assert.equal(actual,hash(path.resolve(root,'fixture-copy',original.path)));evidence.resourceHashes[r.id]={kind:r.kind,sha256:actual};}
   evidence.previews=[];
   // Model progress is (frame-start+1)/revealFrames. Isolated fixture uses 30-frame reveal; capture start, partial, full and page/split boundaries.
   for(const frame of [0,15,29,59,60,61,120,121]){
    const dom=await js(`(async()=>{syncTransportFrame(${frame});await locate();await sceneRenderer.ready();const state=await replay.evaluate(${frame});const group=sceneRenderer.stage.querySelector('.component-instance'),body=group?.querySelector('[data-element-id="body"]'),speaker=group?.querySelector('[data-element-id="speaker"]');const ranges=[...(CSS.highlights.get('replay-hidden-tail')||[])].filter(r=>r.startContainer===body?.firstChild);return {state,oldDialogueHidden:sceneRenderer.stage.querySelector('.dialogue').hidden,instanceId:group?.dataset.componentId,x:group?.style.left,y:group?.style.top,body:body?.textContent,speaker:speaker?.textContent,reveal:ranges.map(r=>({start:r.startOffset,end:r.endOffset})),devicePixelRatio};})()`);
    assert.equal(dom.oldDialogueHidden,true);assert.equal(dom.instanceId,instanceId);assert.equal(dom.x,'30px');assert.equal(dom.y,'340px');assert.equal(dom.speaker,'小窗');assert.equal(dom.devicePixelRatio,1);
    const active=dom.state.dialogues[0];assert.ok(active);assert.equal(dom.body,active.text);assert.equal(dom.reveal.length,1);
    const units=[...new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(active.text)],n=Math.max(0,Math.min(units.length,Math.floor(units.length*active.progress)));
    assert.equal(dom.reveal[0].start,n<units.length?units[n].index:active.text.length);assert.equal(dom.reveal[0].end,active.text.length);
    const screenshot=path.join(root,`editor-${frame}.png`);fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());evidence.previews.push({frame,...dom,screenshot,sha256:hash(screenshot)});
   }
   const first=evidence.previews.find(p=>p.frame===0),partial=evidence.previews.find(p=>p.frame===15),full=evidence.previews.find(p=>p.frame===29);
   assert.ok(first.state.dialogues[0].progress>0&&first.state.dialogues[0].progress<1);assert.ok(partial.reveal[0].start>first.reveal[0].start);assert.ok(partial.reveal[0].start<partial.reveal[0].end);assert.equal(full.reveal[0].start,full.reveal[0].end);
   evidence.extensionsMovie=await js('replay.exportCurrent()');assert.equal(typeof evidence.extensionsMovie,'string');assert.notEqual(evidence.extensionsMovie,evidence.baselineMovie);assert.equal(hash(formalFile),evidence.formalSha256);assert.equal(fs.existsSync(pack),false);finish('PASS');
  }catch(error){finish('FAIL',error);}
 }));
 setTimeout(()=>finish('FAIL',Error('Electron phase timeout')),480000).unref();require(path.join(productionRoot,'main.cjs'));
 const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);
}
async function nodeRunner(){
 const runId=crypto.randomUUID(),root=path.resolve(__dirname,'../test-output/P2','extensions-export-'+runId);fs.mkdirSync(root,{recursive:true});
 const source=path.join(__dirname,'fixtures/original-scene-project'),authorPack=path.join(__dirname,'component-packs/starter-dialogue-v0.1'),productionRoot=path.join(root,'production/P2');
 const report={runId,root,pid:process.pid,status:'RUNNING',startedAt:new Date().toISOString(),processes:[],metrics:{},roi,limitations:['Native dialogs scripted, real replay APIs/save/reopen/export; no pointer-drag claim','Two exports: baseline schema1 versus split+component schema2, no third split-only video','AAC decoded PCM uses explicit sample-aligned tolerances; manual listening NOT covered','DPI forced to 1; multi-DPI NOT covered','Editor screenshots and DOM verify preview; numerical MP4 ROI compares full-size production export PNG captures, not scaled editor pixels','Starter pack has zero external resources; imported definitions and existing project assets covered, not image-bearing pack import']};
 async function exec(exe,args,label,env=process.env,timeoutMs=120000){
  const log=path.join(root,label+'.log'),fd=fs.openSync(log,'w'),record={label,exe,args,log,pid:null,exitCode:null,startedAt:new Date().toISOString()};report.processes.push(record);
  try{await new Promise((resolve,reject)=>{let child;try{child=spawn(exe,args,{env,stdio:['ignore',fd,fd],windowsHide:true});}catch(e){record.spawnError=e.stack;reject(e);return;}record.pid=child.pid??null;let spawnError;child.once('error',e=>{spawnError=e;record.spawnError=e.stack;});const timer=setTimeout(()=>{record.timedOut=true;child.kill();},timeoutMs);child.once('close',(code,signal)=>{clearTimeout(timer);Object.assign(record,{exitCode:code,signal,finishedAt:new Date().toISOString()});if(spawnError||record.timedOut||code!==0||signal)reject(spawnError||Error(`${label} exit=${code} signal=${signal}; ${log}`));else resolve();});});}finally{fs.closeSync(fd);record.logSha256=hash(log);}return log;
 }
 try{
  report.sourceBefore=hashes(source);report.authorPackBefore=hashes(authorPack);report.runnerSha256=hash(__filename);fs.cpSync(source,path.join(root,'fixture-copy'),{recursive:true,errorOnExist:true,force:false});
  // Test-data setup only: slow reveal in the isolated schema1 project BEFORE both exports.
  // Production and original fixture bytes remain untouched; both movies share this same baseline.
  const fixtureFile=path.join(root,'fixture-copy/场景.json'),fixture=JSON.parse(fs.readFileSync(fixtureFile,'utf8').replace(/^\uFEFF/,''));
  report.fixtureSetup={file:fixtureFile,beforeSha256:hash(fixtureFile),change:'All dialogue/page revealFrames set to 30 in isolated test data before baseline'};
  for(const d of fixture.project.scene.dialogues){d.revealFrames=30;for(const p of d.pages||[])p.revealFrames=30;}
  fs.writeFileSync(fixtureFile,JSON.stringify(fixture,null,2));report.fixtureSetup.afterSha256=hash(fixtureFile);report.fixtureCopyBefore=hashes(path.join(root,'fixture-copy'));
  for(const [name,h]of Object.entries(report.sourceBefore))if(name!=='场景.json')assert.equal(report.fixtureCopyBefore[name],h,name);
  // Current production is copied only on invocation, including renderer index and new core/component code; never patched.
  fs.mkdirSync(productionRoot,{recursive:true});for(const name of ['main.cjs','export-main.cjs','core','renderer','examples','assets','component-packs'])fs.cpSync(path.join(__dirname,name),path.join(productionRoot,name),{recursive:true});report.productionBefore=hashes(productionRoot);
  for(const name of ['core/voice-clips.cjs','core/components.cjs','core/component-command.cjs','renderer/component-renderer.js','renderer/index.html'])assert.ok(report.productionBefore[name],name);
  const tools=path.join(root,'production/p0/tools');fs.mkdirSync(tools,{recursive:true});fs.copyFileSync(path.resolve(__dirname,'../p0/tools/ffmpeg.exe'),path.join(tools,'ffmpeg.exe'));
  const electron=path.resolve(__dirname,'../p0/node_modules/electron/dist/electron.exe'),ffmpeg=path.join(tools,'ffmpeg.exe'),ffprobe=path.resolve(__dirname,'../p0/tools/ffprobe.exe');report.toolHashes={electron:hash(electron),ffmpeg:hash(ffmpeg),ffprobe:hash(ffprobe)};
  const env={...process.env,REPLAY_EXTENSIONS_EXPORT_ROOT:root,REPLAY_EXTENSIONS_EXPORT_RUN_ID:runId,REPLAY_RECOVERY_DIR:path.join(root,'recovery')};for(const k of ['ELECTRON_RUN_AS_NODE','REPLAY_EXPORT_INPUT','REPLAY_EXPORT_OUTPUT','REPLAY_EXPORT_CANCEL','REPLAY_PROJECT_ROOT'])delete env[k];
  await exec(electron,[__filename],'electron-phase',env,510000);
  const phaseFile=path.join(root,'phase.json'),phase=JSON.parse(fs.readFileSync(phaseFile,'utf8'));assert.equal(phase.runId,runId);assert.equal(phase.pid,report.processes[0].pid);assert.equal(phase.status,'PASS');report.phase={file:phaseFile,sha256:hash(phaseFile),...phase};
  const pcm={},snapshots={};report.exports={};
  for(const [name,movie]of [['baseline',phase.baselineMovie],['extensions',phase.extensionsMovie]]){
   assert.ok(path.resolve(movie).startsWith(productionRoot+path.sep));const probeFile=await exec(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',movie],name+'-probe'),probe=JSON.parse(fs.readFileSync(probeFile,'utf8')),v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.filter(s=>s.codec_type==='audio');
   assert.equal(Number(v.nb_read_frames),210);assert.equal(v.width,960);assert.equal(v.height,540);assert.equal(v.r_frame_rate,'30/1');assert.equal(a.length,1);assert.equal(Number(a[0].sample_rate),48000);assert.equal(a[0].channels,2);assert.ok(Math.abs(Number(probe.format.duration)-7)<0.1);
   const snapshotFile=path.join(path.dirname(movie),'export-snapshot.json');snapshots[name]=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));const packet=name==='baseline'?phase.baseline:phase.reopened;assert.deepEqual(snapshots[name].project,packet.project);assert.equal(snapshots[name].revision,packet.revision);
   const raw=path.join(root,name+'.f32');await exec(ffmpeg,['-y','-v','error','-i',movie,'-vn','-ac','2','-ar','48000','-f','f32le',raw],name+'-pcm');pcm[name]=fs.readFileSync(raw);assert.ok(pcm[name].length>=336000*8);assert.equal(pcm[name].length%8,0);
   report.exports[name]={movie,sha256:hash(movie),probe,snapshotFile,snapshotSha256:hash(snapshotFile),pcm:raw,pcmSha256:hash(raw)};
  }
  const before=snapshots.baseline.timeline,after=snapshots.extensions.timeline;assert.equal(before.clips.length,2);assert.equal(after.clips.length,3);assert.equal(after.sampleRate,48000);assert.equal(after.durationSamples,336000);
  const old=before.clips.find(c=>c.dialogueId==='d1'),split=after.clips.filter(c=>c.dialogueId==='d1').sort((a,b)=>a.startSamples-b.startSamples);assert.equal(split.length,2);assert.equal(split[0].startSamples,old.startSamples);assert.equal(split[0].durationSamples,96000);assert.equal(split[1].durationSamples,96000);assert.equal(split[0].startSamples+split[0].durationSamples,split[1].startSamples);assert.equal(split[0].sourceOffsetSamples,old.sourceOffsetSamples||0);assert.equal(split[0].sourceOffsetSamples+split[0].durationSamples,split[1].sourceOffsetSamples);assert.equal(split[0].durationSamples+split[1].durationSamples,old.durationSamples);assert.ok(split.every(c=>c.resourceId===old.resourceId&&c.clipId));
  const withoutIds=c=>{const {id,clipId,...rest}=c;return rest;},other=after.clips.filter(c=>c.dialogueId!=='d1');assert.equal(other.length,1);assert.deepEqual(other.map(withoutIds),before.clips.filter(c=>c.dialogueId!=='d1').map(withoutIds));report.timeline={before,after};
  assert.equal(pcm.baseline.length,pcm.extensions.length);
  function pcmDiff(start,end){let sum=0,max=0,energy=0;for(let i=start*2;i<end*2;i++){const a=pcm.baseline.readFloatLE(i*4),b=pcm.extensions.readFloatLE(i*4);assert.ok(Number.isFinite(a)&&Number.isFinite(b));const d=a-b;sum+=d*d;energy+=a*a;max=Math.max(max,Math.abs(d));}return {startSample:start,endSample:end,rmsDifference:Math.sqrt(sum/((end-start)*2)),maxDifference:max,baselineRms:Math.sqrt(energy/((end-start)*2))};}
  report.thresholds={pcmRmsMax:0.00001,pcmSampleMax:0.0001,mp4VsPngMaeMax:12,componentVsBaselineMaeMin:5,revealMaeMin:0.01};
  for(const [label,start,end]of [['entireDecoded',0,pcm.baseline.length/8],['scene',0,336000],['splitBoundary',93600,98400],['otherVoice',192000,336000]]){const m=report.metrics[label]=pcmDiff(start,end);assert.ok(m.rmsDifference<=report.thresholds.pcmRmsMax,`${label} PCM RMS mismatch`);assert.ok(m.maxDifference<=report.thresholds.pcmSampleMax,`${label} PCM sample mismatch`);}assert.ok(report.metrics.scene.baselineRms>0.001,'not silent');
  report.frameEvidence=[];const frames={};
  for(const frame of [0,15,29,59,60,61,120,121]){
   frames[frame]={};for(const mode of ['png','mp4','baseline']){
    const movie=mode==='baseline'?phase.baselineMovie:phase.extensionsMovie,out=path.join(root,`${mode}-${frame}.rgb`),png=path.join(path.dirname(movie),'frames',String(frame).padStart(4,'0')+'.png');
    const input=mode==='png'?['-i',png]:['-i',movie,'-vf',`select=eq(n\\,${frame})`];await exec(ffmpeg,['-y','-v','error',...input,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',out],`${mode}-${frame}`);frames[frame][mode]=fs.readFileSync(out);assert.equal(frames[frame][mode].length,960*540*3);report.frameEvidence.push({frame,mode,raw:out,sha256:hash(out),...(mode==='png'?{screenshot:png,screenshotSha256:hash(png)}:{})});
   }
   const matching=report.metrics['mp4VsPng'+frame]=diff(frames[frame].png,frames[frame].mp4),changed=report.metrics['componentVsBaseline'+frame]=diff(frames[frame].baseline,frames[frame].mp4);assert.ok(matching.mae<report.thresholds.mp4VsPngMaeMax,`MP4/capture ROI ${frame}`);assert.ok(changed.mae>report.thresholds.componentVsBaselineMaeMin,`component visible ${frame}`);
  }
  const bodyRoi={x:54,y:393,w:832,h:88};report.metrics.revealPng=diff(frames[0].png,frames[29].png,bodyRoi);report.metrics.revealMp4=diff(frames[0].mp4,frames[29].mp4,bodyRoi);assert.ok(report.metrics.revealPng.mae>report.thresholds.revealMaeMin);assert.ok(report.metrics.revealMp4.mae>report.thresholds.revealMaeMin);
  for(const [name,h]of Object.entries(report.productionBefore)){const moved=name.replace(/^component-packs\/starter-dialogue-v0\.1\//,'component-packs/starter-dialogue-v0.1.unavailable/');assert.equal(hash(path.join(productionRoot,moved)),h,name);}assert.equal(hash(__filename),report.runnerSha256);report.status='PASS';
 }catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
 finally{
  const phaseFile=path.join(root,'phase.json');if(!report.phase&&fs.existsSync(phaseFile))try{report.phase={file:phaseFile,sha256:hash(phaseFile),...JSON.parse(fs.readFileSync(phaseFile,'utf8'))};}catch(error){report.phaseReadError=error.stack;}
  try{report.sourceAfter=hashes(source);report.authorPackAfter=hashes(authorPack);assert.deepEqual(report.sourceAfter,report.sourceBefore);assert.deepEqual(report.authorPackAfter,report.authorPackBefore);assert.deepEqual(hashes(path.join(root,'fixture-copy')),report.fixtureCopyBefore);report.originalsAndWavHashesUnchanged=true;}catch(error){report.status='FAIL';report.sourceHashError=error.stack;process.exitCode=1;}
  report.finishedAt=new Date().toISOString();const file=path.join(root,'report.json');fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,runId,report:file,error:report.error}));
 }
}
