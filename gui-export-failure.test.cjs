'use strict';
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const runId=process.env.REPLAY_FAILURE_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString();
const root=path.join(__dirname,'test-output','export-failure-'+runId);
fs.mkdirSync(root,{recursive:true});process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const reportFile=path.join(root,'report.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
let failureJob;
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
 try{
  const js=source=>win.webContents.executeJavaScript(source);
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function wait(fn,label){const end=Date.now()+90000;while(Date.now()<end){if(await fn())return;await delay(25);}throw Error('Timeout '+label+'; '+await js('document.querySelector("#log").textContent'));}
  win.show();win.focus();await wait(()=>js('!!window.timelineTest?.model'),'editor initialization');
  const click=async selector=>{const pos=await js(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...pos});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pos});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pos});};
  const out=path.join(__dirname,'runtime-output');fs.mkdirSync(out,{recursive:true});
  const oldJobs=new Set(fs.readdirSync(out));
  const prior=fs.readdirSync(out).filter(n=>n.startsWith('job-')).map(n=>path.join(out,n,'p1-preview.mp4')).filter(f=>fs.existsSync(f));
  const priorHashes=prior.map(file=>[file,hash(file)]);
  // Odd width is a legal project, but libx264 yuv420p rejects it after actual frame rendering.
  const bad=await js(`(async()=>{const packet=await replay.project(),p=packet.project;const original=p.scene.dialogues.find(d=>d.voice);if(!original)throw Error('Fixture requires source voice');const voice=JSON.parse(JSON.stringify(original.voice));voice.binding={dialogueId:'failure-voice',mode:'follow',followOffsetFrames:0};delete voice.startFrame;voice.sourceOffsetSamples=0;voice.durationSamples=48000;p.design.width=65;p.design.height=64;p.design.fps=30;p.scene.durationFrames=30;p.scene.characters=[];p.scene.background={kind:'color',color:'#182338'};p.scene.audioTracks=[];p.scene.dialogues=[{id:'failure-voice',speakerId:'narrator',text:{[p.locale]:'Failure then retry'},startFrame:0,endFrame:30,revealFrames:1,voice}];await replay.applyProjectCode({text:JSON.stringify(p),expectedRevision:packet.revision});await locate();return p})()`);
  assert.deepEqual(require('./core/model.cjs').validateProject(bad),[],'bad encoding fixture remains model-valid');
  await click('#export');
  await wait(()=>js('!document.querySelector("#export").disabled && document.querySelector("#log").textContent.startsWith("导出失败")'),'real worker failure');
  const failedUI=await js(`({text:document.querySelector('#log').textContent,exportDisabled:document.querySelector('#export').disabled,cancelDisabled:document.querySelector('#export-cancel').disabled})`);
  assert.equal(failedUI.exportDisabled,false);assert.equal(failedUI.cancelDisabled,true);assert.ok(!failedUI.text.includes('已导出'));
  assert.equal(await js('(async()=> (await replay.cancelExport()).cancelled)()'),false);
  const added=fs.readdirSync(out).filter(n=>n.startsWith('job-')&&!oldJobs.has(n));assert.equal(added.length,1);
  failureJob=path.join(out,added[0]);
  for(const file of ['input.json','job.log','encode.log','export-snapshot.json','frames/0000.png'])assert.ok(fs.existsSync(path.join(failureJob,file)),file+' retained');
  assert.ok(!fs.existsSync(path.join(failureJob,'p1-preview.mp4')),'partial movie removed');
  const encoderLog=fs.readFileSync(path.join(failureJob,'encode.log'),'utf8');assert.match(encoderLog,/width not divisible by 2|not divisible by 2/i,'must fail inside actual libx264');
  assert.match(fs.readFileSync(path.join(failureJob,'job.log'),'utf8'),/FFmpeg failed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(failureJob,'input.json'),'utf8')).project.design.width,65);
  const failedLogs=['input.json','job.log','encode.log'].map(name=>[name,hash(path.join(failureJob,name))]);
  await js(`(async()=>{const packet=await replay.project();packet.project.design.width=64;await replay.applyProjectCode({text:JSON.stringify(packet.project),expectedRevision:packet.revision});await locate();return true})()`);
  await click('#export');await wait(()=>js('!document.querySelector("#export").disabled && document.querySelector("#log").textContent.startsWith("已导出：")'),'same window retry success');
  const successUI=await js(`({text:document.querySelector('#log').textContent,exportDisabled:document.querySelector('#export').disabled,cancelDisabled:document.querySelector('#export-cancel').disabled})`);
  assert.equal(successUI.exportDisabled,false);assert.equal(successUI.cancelDisabled,true);
  const video=successUI.text.slice('已导出：'.length);assert.ok(fs.statSync(video).size>0);assert.notEqual(path.dirname(video),failureJob);
  const probeFile=path.join(root,'probe.json'),fd=fs.openSync(probeFile,'w');let probe;
  try{probe=spawnSync(path.join(__dirname,'../p0/tools/ffprobe.exe'),['-v','error','-count_frames','-show_streams','-of','json',video],{stdio:['ignore',fd,'inherit']});}finally{fs.closeSync(fd);}
  if(probe.error)throw probe.error;assert.equal(probe.status,0);
  const streams=JSON.parse(fs.readFileSync(probeFile,'utf8')).streams,v=streams.find(s=>s.codec_type==='video'),a=streams.find(s=>s.codec_type==='audio');
  assert.equal(v.width,64);assert.equal(v.height,64);assert.equal(Number(v.nb_read_frames),30);assert.equal(a.codec_name,'aac');assert.equal(Number(a.sample_rate),48000);assert.equal(a.channels,2);
  for(const [file,digest] of priorHashes)assert.equal(hash(file),digest,'prior movie unchanged');
  for(const [name,digest] of failedLogs)assert.equal(hash(path.join(failureJob,name)),digest,'failed diagnostics retained after retry');
  assert.ok(!fs.existsSync(path.join(failureJob,'p1-preview.mp4')));
  const report={status:'PASS',runId,startedAt,finishedAt:new Date().toISOString(),failureJob,failedUI,successUI,video,frames:Number(v.nb_read_frames),audioRate:Number(a.sample_rate),priorMovieCount:priorHashes.length,checks:['legal 65x64 project reaches actual libx264 failure','native mouse export failure UI and button reset','input/job.log/encode.log/frames retained','failed partial MP4 removed','same-window correction and native mouse success retry','ffprobe 30 frames 64x64 AAC stereo48k','prior movie SHA256 unchanged','failed logs unchanged after retry'],limitations:['not long-encoding cancellation or forced termination test','not disk exhaustion']};
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }catch(error){const report={status:'FAIL',runId,startedAt,finishedAt:new Date().toISOString(),failureJob,error:error.stack||String(error)};fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.error(error);app.exit(1);}
}));
setTimeout(()=>{fs.writeFileSync(reportFile,JSON.stringify({status:'FAIL',runId,startedAt,error:'global timeout'}));app.exit(1)},180000).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
