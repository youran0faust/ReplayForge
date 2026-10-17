'use strict';
// Run directly with Node. Real Electron worker + FFmpeg; no production mocks.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),{spawn}=require('child_process');
const {ProjectSession}=require('./core/session.cjs');
const {createExpressionCommands}=require('./core/expression-command.cjs');
const {saveSessionPortable,openPortable}=require('./core/project-storage.cjs');
const run=path.resolve(__dirname,'../test-output/P2/s1-export-'+crypto.randomUUID());fs.mkdirSync(run,{recursive:true});
const report={status:'RUNNING',run,started:new Date().toISOString(),processes:[],metrics:{}};
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const source=path.join(__dirname,'fixtures/original-scene-project'), manifest=path.join(source,'场景.json');
const original=JSON.parse(fs.readFileSync(manifest,'utf8').replace(/^\uFEFF/,''));
const protectedFiles=[manifest,...original.project.resources.map(r=>path.join(source,r.path))];
const beforeHashes=Object.fromEntries(protectedFiles.map(f=>[f,hash(f)]));
async function exec(exe,args,label,env={}) {
 const stdout=path.join(run,label+'.stdout.log'),stderr=path.join(run,label+'.stderr.log'),a=fs.openSync(stdout,'w'),b=fs.openSync(stderr,'w');
 const record={label,exe,args,stdout,stderr,started:new Date().toISOString()};report.processes.push(record);
 try { await new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{stdio:['ignore',a,b],windowsHide:true,env:Object.keys(env).length?env:process.env});let spawnError;
  child.once('error',error=>spawnError=error);child.once('close',(code,signal)=>{Object.assign(record,{code,signal,ended:new Date().toISOString()});if(spawnError)reject(spawnError);else if(code!==0)reject(Error(label+' exit '+code));else resolve();});
 }); } finally { fs.closeSync(a);fs.closeSync(b); }
 return stdout;
}
function difference(a,b,rect){let sum=0,max=0,changed=0;for(let y=rect.y;y<rect.y+rect.h;y++)for(let x=rect.x;x<rect.x+rect.w;x++)for(let c=0;c<3;c++){const d=Math.abs(a[(y*960+x)*3+c]-b[(y*960+x)*3+c]);sum+=d;max=Math.max(max,d);if(d)changed++;}return {mae:sum/(rect.w*rect.h*3),max,changed};}
(async()=>{
 const copy=path.join(run,'source-copy');fs.cpSync(source,copy,{recursive:true});
 const loaded=await openPortable(path.join(copy,'场景.json')),session=new ProjectSession(loaded.project);
 const win={isDestroyed:()=>false,webContents:{mainFrame:{}}},event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 const commands=createExpressionCommands({getContext:()=>({session,documentId:1,win})});
 const result=commands.dropExpression(event,{commandId:crypto.randomUUID(),documentId:1,expectedRevision:0,source:{characterId:'window_guide',expressionId:'smile'},target:{characterId:'window_guide'},atFrame:90});
 assert.equal(result.ok,true);assert.equal(session.revision,1);assert.equal(session.history.length,1);report.command=result;
 assert.deepEqual(session.project.scene.dialogues,original.project.scene.dialogues);
 const saved=await saveSessionPortable(session,loaded.root,path.join(run,'portable/project.json'));
 const reopened=await openPortable(saved.file);assert.ok(reopened.project.scene.characters[0].expressionEvents.some(e=>e.id===result.created.eventId&&e.frame===90));
 for(const r of reopened.project.resources)assert.equal(hash(path.resolve(reopened.root,r.path)),beforeHashes[path.resolve(source,original.project.resources.find(x=>x.id===r.id).path)]);
 const out=path.join(run,'export');fs.mkdirSync(out);const input=path.join(run,'input.json');fs.writeFileSync(input,JSON.stringify({project:reopened.project,revision:session.revision}));
 const electron=path.resolve(__dirname,'../p0/node_modules/electron/dist/electron.exe'),ffmpeg=path.resolve(__dirname,'../p0/tools/ffmpeg.exe'),ffprobe=path.resolve(__dirname,'../p0/tools/ffprobe.exe');
 // Electron must be an app, not ELECTRON_RUN_AS_NODE inherited from tooling.
 const env={...process.env,REPLAY_EXPORT_INPUT:input,REPLAY_EXPORT_OUTPUT:out,REPLAY_PROJECT_ROOT:reopened.root};delete env.ELECTRON_RUN_AS_NODE;delete env.REPLAY_EXPORT_CANCEL;
 await exec(electron,[path.join(__dirname,'export-main.cjs')],'export',env);
 const movie=path.join(out,'p1-preview.mp4');
 const probeFile=await exec(ffprobe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',movie],'ffprobe');
 const probe=JSON.parse(fs.readFileSync(probeFile,'utf8'));report.probe=probe;
 const video=probe.streams.find(s=>s.codec_type==='video'),audio=probe.streams.find(s=>s.codec_type==='audio');
 assert.equal(Number(video.nb_read_frames),210);assert.equal(video.width,960);assert.equal(video.height,540);assert.equal(video.r_frame_rate,'30/1');assert.equal(Number(audio.sample_rate),48000);assert.ok(Math.abs(Number(probe.format.duration)-7)<0.1);
 const snapshot=JSON.parse(fs.readFileSync(path.join(out,'export-snapshot.json'),'utf8'));report.timeline=snapshot.timeline;
 assert.equal(snapshot.timeline.clips.length,2,'exactly two parent voice clips, not per-page duplicates');
 assert.deepEqual(snapshot.timeline.clips.map(c=>c.dialogueId),['d1','d2']);
 report.audioTimelineShape=Object.keys(snapshot.timeline);
 // Compile structure is also checked against the unchanged original input.
 const {compileAudioTimeline}=require('./core/audio-timeline.cjs'),{diagnoseAudio}=require('./core/resource-index.cjs');
 const baseline=compileAudioTimeline(original.project,diagnoseAudio(original.project,source));
 assert.deepEqual(snapshot.timeline,baseline);assert.equal(original.project.scene.dialogues.filter(d=>d.voice).length,2);
 const frames={};for(const n of [89,90,91]){
  const raw=path.join(run,'png-'+n+'.rgb');await exec(ffmpeg,['-y','-v','error','-i',path.join(out,'frames',String(n).padStart(4,'0')+'.png'),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',raw],'png-'+n);frames[n]=fs.readFileSync(raw);assert.equal(frames[n].length,960*540*3);
  const decoded=path.join(run,'mp4-'+n+'.rgb');await exec(ffmpeg,['-y','-v','error','-i',movie,'-vf',`select=eq(n\\,${n})`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',decoded],'decode-'+n);frames['mp4'+n]=fs.readFileSync(decoded);assert.equal(frames['mp4'+n].length,960*540*3);
 }
 const face={x:680,y:175,w:120,h:70},body={x:620,y:270,w:240,h:100};
 report.metrics.pngFace89to90=difference(frames[89],frames[90],face);report.metrics.pngFace90to91=difference(frames[90],frames[91],face);
 assert.ok(report.metrics.pngFace89to90.mae>1,'new F90 face must visibly differ from F89');assert.equal(report.metrics.pngFace90to91.max,0);
 for(const n of [90,91]){const metric=report.metrics['pngBody89to'+n]=difference(frames[89],frames[n],body);assert.equal(metric.max,0,'body remains pixel-exact');}
 for(const n of [89,90,91])for(const [name,rect]of [['face',face],['body',body]]){const metric=report.metrics[`mp4VsPng${n}_${name}`]=difference(frames[n],frames['mp4'+n],rect);assert.ok(metric.mae<12,'MP4 regional MAE must be below 12 RGB levels');}
 report.metrics.mp4Face89to90=difference(frames.mp489,frames.mp490,face);assert.ok(report.metrics.mp4Face89to90.mae>1);
 report.thresholds={faceChangeMaeMin:1,bodyPngMax:0,stableFacePngMax:0,mp4VsPngRegionMaeMax:12};report.regions={face,body};report.status='PASS';
})().catch(error=>{report.status='FAIL';report.error=error.stack;process.exitCode=1;}).finally(()=>{
 report.originalHashesUnchanged=protectedFiles.every(f=>hash(f)===beforeHashes[f]);report.originalHashes=beforeHashes;if(!report.originalHashesUnchanged){report.status='FAIL';process.exitCode=1;}
 report.ended=new Date().toISOString();report.sourceHashes=Object.fromEntries(['s1-export.integration.cjs','export-main.cjs','core/expression-command.cjs'].map(f=>[f,hash(path.join(__dirname,f))]));
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,run,report:path.join(run,'report.json'),error:report.error}));
});
