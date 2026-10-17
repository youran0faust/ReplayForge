'use strict';
// Independent consumer; --extract explicitly runs only trusted, root-owned media tools.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {contained}=require('./closeout-export-evidence.cjs');
const {decodeWav,decodeStereo,mixTimeline,rms,matchWindow}=require('./d-export-evidence.cjs');
const {decodePng}=require('./preservation-export-evidence.cjs');
const {validateProject}=require('./core/model.cjs'),{diagnoseAudio}=require('./core/resource-index.cjs'),{compileAudioTimeline}=require('./core/audio-timeline.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const readJson=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
function sourceMix(project,resources,load=r=>decodeWav(fs.readFileSync(r.absolute))){
  assert.equal(project.schemaVersion,4);assert.equal(project.scene.videoClips?.length||0,0,'This oracle covers no-video plan-tail only');
  const unit=48000/project.design.fps,N=project.scene.durationFrames*unit;assert(Number.isSafeInteger(N));
  const left=new Float64Array(N),right=new Float64Array(N),voices=new Float64Array(N),intervals=[],sources={};
  function add(id,start,n,offset,gain,fade,kind,owner){
    assert([start,n,offset].every(Number.isSafeInteger)&&start>=0&&n>0&&offset>=0&&start+n<=N);
    const src=sources[id]||(sources[id]=load(resources[id]));assert(offset+n<=src.left.length);
    for(let j=0;j<n;j++){const envelope=fade&&j>=n-fade?(n-j)/fade:1,g=gain*(src.channels===1?Math.SQRT1_2:1)*envelope;left[start+j]+=src.left[offset+j]*g;right[start+j]+=src.right[offset+j]*g;if(kind==='voice')voices[start+j]+=Math.abs(src.left[offset+j]*g);}
    intervals.push({resourceId:id,start,end:start+n,kind,owner});
  }
  for(const d of project.scene.dialogues)for(const v of d.voiceClips||[]){const b=v.binding;assert(b&&['follow','independent'].includes(b.mode));const frame=b.mode==='follow'?d.startFrame+(b.followOffsetFrames||0):v.startFrame;add(v.resourceId,frame*unit,v.durationSamples,v.sourceOffsetSamples||0,1,0,'voice',d.id);}
  for(const t of project.scene.audioTracks||[])add(t.resourceId,t.startFrame*unit,t.durationSamples,t.sourceOffsetSamples||0,t.gain,t.fadeOutSamples||0,t.kind,t.id);
  return {left,right,voices,intervals,sources:Object.fromEntries(Object.entries(sources).map(([id,s])=>[id,{sha256:s.sha256,channels:s.channels,samples:s.left.length}]))};
}
function checkAudio(project,timeline,compiled,independent,actual){
  assert.equal(independent.left.length,timeline.durationSamples);assert(actual.left.length>=timeline.durationSamples&&actual.left.length<=timeline.durationSamples+1024,'AAC sample count/padding');assert.equal(actual.left.length,actual.right.length);
  for(const ch of ['left','right'])for(let i=0;i<timeline.durationSamples;i++)assert(Math.abs(independent[ch][i]-compiled[ch][i])<1e-12,'Independent project/source mixer differs from compiled timeline');
  const bounds=new Set([0,timeline.durationSamples]);for(const c of independent.intervals){bounds.add(c.start);bounds.add(c.end);}for(const d of project.scene.dialogues){bounds.add(d.startFrame*48000/project.design.fps);bounds.add(d.endFrame*48000/project.design.fps);}for(const c of timeline.clips)if(c.fadeOutSamples)bounds.add(c.startSamples+c.durationSamples-c.fadeOutSamples);
  const windows=[],silence=[];function window(start,n,label){for(const ch of ['left','right']){const expected=rms(independent[ch],start,n);if(expected>1e-5){const q={label,channel:ch,...matchWindow(independent[ch],actual[ch],start,n)};assert(q.correlation>=.99&&q.rmsGain>=.85&&q.rmsGain<=1.15,JSON.stringify(q));windows.push(q);}else{const value=rms(actual[ch],start,n);assert(value<=.001,'Unexpected audio in silent window '+label);silence.push({label,channel:ch,start,length:n,rms:value});}}}
  const sorted=[...bounds].sort((a,b)=>a-b);for(let i=1;i<sorted.length;i++){const a=sorted[i-1]+1280,b=sorted[i]-1280;if(b-a<256)continue;const n=Math.min(4800,b-a);for(const start of new Set([a,Math.floor((a+b-n)/2),b-n]))window(start,n,'interval');}
  const semantic=[];for(const d of project.scene.dialogues){const start=d.startFrame*48000/project.design.fps+1280,end=d.endFrame*48000/project.design.fps-1280;if(end-start<256)continue;const length=Math.min(4800,end-start),at=Math.floor((start+end-length)/2),voiced=!!d.voiceClips?.length;window(at,length,voiced?'voiced:'+d.id:'unvoiced:'+d.id);semantic.push({dialogueId:d.id,voiced,start:at,length,activeSources:independent.intervals.filter(c=>c.start<at+length&&c.end>at).map(c=>({kind:c.kind,resourceId:c.resourceId}))});}
  assert(windows.length>=6,'Insufficient signal windows');assert(semantic.filter(x=>x.voiced).length>=2,'Need two voiced dialogue windows');assert(semantic.some(x=>!x.voiced),'Need unvoiced dialogue window');assert(independent.intervals.some(x=>x.kind==='bgm'));assert(independent.intervals.some(x=>x.kind==='sfx'));
  return {windows,silence,semantic,thresholds:{correlation:.99,lagSamples:128,rmsGain:[.85,1.15],silenceRms:.001,boundaryPadSamples:1280},note:'Unvoiced dialogue is not necessarily silent: BGM/SFX or overlapping voices remain in the independent source sum. Gap windows likewise preserve continuing sound; no video/restart assertions.'};
}
function extract(root,m){
  const out=contained(root,m.exportOutput),mp4=contained(root,path.join(out,'p1-preview.mp4')),commands=[];if(fs.existsSync(path.join(out,'plan-tail-extraction.json')))contained(root,path.join(out,'plan-tail-extraction.json'));
  for(const [key,exe,args,name]of [
    ['ffprobePath','ffprobe.exe',['-v','error','-count_frames','-show_streams','-show_format','-of','json',mp4],'ffprobe.json'],
    ['ffmpegPath','ffmpeg.exe',['-v','error','-i',mp4,'-vn','-ac','2','-ar','48000','-f','s16le','-'],'decoded-stereo-48k.pcm']]){
    const executable=contained(root,m[key]);assert.equal(path.resolve(executable),path.resolve(root,'p0/tools',exe),'Only copied trusted root/p0/tools executables');
    const output=path.join(out,name),error=output+'.stderr.log';for(const f of [output,error])if(fs.existsSync(f))contained(root,f);
    const a=fs.openSync(output,'w'),b=fs.openSync(error,'w');let r;try{r=spawnSync(executable,args,{stdio:['ignore',a,b],windowsHide:true,timeout:120000});}finally{fs.closeSync(a);fs.closeSync(b);}
    commands.push({executable,toolSha256:sha(fs.readFileSync(executable)),args,exitCode:r.status,error:r.error?.message,stdout:output,stderr:error,stdoutSha256:sha(fs.readFileSync(output)),stderrSha256:sha(fs.readFileSync(error))});
    fs.writeFileSync(path.join(out,'plan-tail-extraction.json'),JSON.stringify({commands},null,2));assert(!r.error&&r.status===0,'Media extraction failed: '+JSON.stringify(commands.at(-1)));
  }
  fs.writeFileSync(path.join(out,'plan-tail-extraction.json'),JSON.stringify({mp4Sha256:sha(fs.readFileSync(mp4)),commands},null,2));
}
function verify(root,{extractMedia=false}={}){
  root=fs.realpathSync(path.resolve(root));const report={independentVerification:'FAIL',status:'FAIL',root,details:{},limitations:['Machine verification, not human viewing/listening.','Exact PNG comparison verifies encoding inputs, not decoded lossy H264 pixels.','Source oracle independently expands project voice bindings/tracks and linear fades; it is not an analytic fixture-tone oracle and does not independently prove compiler timing intent.','Audio windows allow AAC lag +/-128 samples; no video or BGM-restart coverage is claimed.','Recorded commands/hashes are audit provenance, not cryptographic proof of execution.']};
  try{
    const manifestFile=contained(root,'fixture-manifest.json'),m=readJson(manifestFile),projectFile=contained(root,m.projectFile),projectRoot=contained(root,m.projectRoot),out=contained(root,m.exportOutput),evidence=contained(root,m.evidenceDir),saved=readJson(projectFile),p=saved.project||saved;
    assert.deepEqual(validateProject(p),[]);assert.deepEqual([p.scene.durationFrames,p.design.width,p.design.height,p.design.fps],[m.frames,m.width,m.height,m.fps]);assert.equal(p.scene.videoClips?.length||0,0);
    const resources={};for(const r of p.resources){const f=contained(root,path.resolve(projectRoot,r.path));resources[r.id]={file:f,sha256:sha(fs.readFileSync(f))};}
    report.details.sources={manifestSha256:sha(fs.readFileSync(manifestFile)),projectSha256:sha(fs.readFileSync(projectFile)),resources};
    if(extractMedia)extract(root,m);
    const mp4=fs.readFileSync(contained(root,path.join(out,'p1-preview.mp4')));assert(mp4.length>32&&mp4.toString('ascii',4,8)==='ftyp');
    const probeFile=contained(root,path.join(out,'ffprobe.json')),pcmFile=contained(root,path.join(out,'decoded-stereo-48k.pcm')),probe=readJson(probeFile),pcm=fs.readFileSync(pcmFile),vs=probe.streams.filter(s=>s.codec_type==='video'),as=probe.streams.filter(s=>s.codec_type==='audio');assert.equal(vs.length,1);assert.equal(as.length,1);
    const ratio=x=>{const [n,d=1]=String(x).split('/').map(Number);return n/d;},v=vs[0],a=as[0];assert.deepEqual([v.codec_name,v.pix_fmt,v.width,v.height,Number(v.nb_frames),ratio(v.avg_frame_rate),ratio(v.r_frame_rate)],['h264','yuv420p',m.width,m.height,m.frames,m.fps,m.fps]);assert.deepEqual([a.codec_name,Number(a.sample_rate),a.channels],['aac',48000,2]);assert(Math.abs(Number(probe.format.duration)-m.frames/m.fps)<=1/m.fps+.001);
    const provenance=readJson(contained(root,path.join(out,'plan-tail-extraction.json')));assert.equal(provenance.mp4Sha256,sha(mp4));assert.equal(provenance.commands.length,2);for(const c of provenance.commands){assert.equal(c.exitCode,0);assert.equal(sha(fs.readFileSync(contained(root,c.executable))),c.toolSha256);assert.equal(sha(fs.readFileSync(contained(root,c.stdout))),c.stdoutSha256);assert.equal(sha(fs.readFileSync(contained(root,c.stderr))),c.stderrSha256);assert(c.args.includes(path.join(out,'p1-preview.mp4')));}
    report.details.media={frames:m.frames,seconds:Number(probe.format.duration),mp4Sha256:sha(mp4),pcmSha256:sha(pcm),ffprobeSha256:sha(fs.readFileSync(probeFile)),provenance};
    const snap=readJson(contained(root,path.join(out,'export-snapshot.json')));assert.deepEqual(snap.project,p);assert.equal(snap.frames,m.frames);const diag=diagnoseAudio(p,projectRoot);assert.equal(diag.hasErrors,false,JSON.stringify(diag.diagnostics));const timeline=compileAudioTimeline(p,diag);assert.deepEqual(snap.timeline,timeline);const mix=mixTimeline(timeline,diag.resources),oracle=sourceMix(p,diag.resources);report.details.audio=checkAudio(p,timeline,mix,oracle,decodeStereo(pcm));report.details.audio.sources=oracle.sources;
    const frames=contained(root,path.join(out,'frames'));assert.deepEqual(fs.readdirSync(frames).filter(n=>/\.png$/i.test(n)).sort(),Array.from({length:m.frames},(_,i)=>String(i).padStart(4,'0')+'.png'));
    for(let i=0;i<m.frames;i++){const b=fs.readFileSync(contained(root,path.join(frames,String(i).padStart(4,'0')+'.png')));assert.equal(b.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.deepEqual([b.readUInt32BE(16),b.readUInt32BE(20)],[m.width,m.height]);}
    assert(Array.isArray(m.selectedFrames)&&m.selectedFrames.length>=3&&new Set(m.selectedFrames).size===m.selectedFrames.length&&m.selectedFrames.includes(0)&&m.selectedFrames.includes(m.frames-1));report.details.visual=[];
    for(const f of m.selectedFrames){assert(Number.isInteger(f)&&f>=0&&f<m.frames);const files=[path.join(evidence,'preview-'+f+'.png'),path.join(evidence,'export-'+f+'.png'),path.join(frames,String(f).padStart(4,'0')+'.png')],buffers=files.map(n=>fs.readFileSync(contained(root,n))),hashes=buffers.map(sha);assert.equal(hashes[0],hashes[1],'GUI/page frame '+f);assert.equal(hashes[0],hashes[2],'Actual encoding input frame '+f);const im=decodePng(buffers[2]);assert.deepEqual([im.width,im.height],[m.width,m.height]);report.details.visual.push({frame:f,files,sha256:hashes[0]});}
    report.independentVerification=report.status='PASS';
  }catch(error){report.error=error.stack||String(error);}
  const dir=path.join(root,'independent-verification');if(fs.existsSync(dir))contained(root,dir);else fs.mkdirSync(dir);const file=path.join(dir,'report.json');if(fs.existsSync(file))contained(root,file);fs.writeFileSync(file,JSON.stringify(report,null,2));return report;
}
module.exports={sourceMix,checkAudio,extract,verify};
if(require.main===module){const args=process.argv.slice(2),extractMedia=args.includes('--extract'),pos=args.filter(x=>x!=='--extract');if(pos.length!==1||args.length>2){console.error('Usage: node P2/plan-tail-export-evidence.cjs <root> [--extract]');process.exitCode=2;}else{const r=verify(pos[0],{extractMedia});console.log(JSON.stringify({status:r.status,report:path.join(r.root,'independent-verification/report.json'),error:r.error}));if(r.status!=='PASS')process.exitCode=1;}}
