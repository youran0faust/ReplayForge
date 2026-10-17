const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{spawnSync}=require('child_process');
const root=__dirname,out=path.join(root,'runtime-output/audio-cases');fs.mkdirSync(out,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(root,'examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,''));
function run(exe,args,log){const fd=fs.openSync(log,'w');try{const r=spawnSync(exe,args,{stdio:['ignore',fd,fd],env:process.env});if(r.error)throw r.error;assert.equal(r.status,0,log)}finally{fs.closeSync(fd)}}
const results=[];
for(const mode of ['silent','overlap','independent']){
 const p=structuredClone(base),dir=path.join(out,mode);fs.mkdirSync(dir,{recursive:true});
 if(mode==='independent') {
  const voice=p.scene.dialogues[0].voice;
  for(const d of p.scene.dialogues)delete d.voice;
  p.scene.audioTracks=[{id:'independent-bgm',name:'BGM',kind:'bgm',resourceId:voice.resourceId,startFrame:30,durationSamples:voice.durationSamples,gain:.25}];
 } else if(mode==='silent')for(const d of p.scene.dialogues)delete d.voice;
 else{const d=structuredClone(p.scene.dialogues[0]);d.id='second-voice';d.startFrame=90;d.endFrame=240;p.scene.dialogues.push(d)}
 const input=path.join(dir,'input.json');fs.writeFileSync(input,JSON.stringify({project:p,revision:7}));
 process.env.REPLAY_EXPORT_INPUT=input;process.env.REPLAY_EXPORT_OUTPUT=dir;
 run(path.join(root,'../p0/node_modules/electron/dist/electron.exe'),[path.join(root,'export-main.cjs')],path.join(dir,'run.log'));
 const video=path.join(dir,'p1-preview.mp4'),probe=path.join(dir,'probe.json');
 run(path.join(root,'../p0/tools/ffprobe.exe'),['-v','error','-count_frames','-show_streams','-of','json',video],probe);
 const streams=JSON.parse(fs.readFileSync(probe,'utf8')).streams,v=streams.find(s=>s.codec_type==='video'),audio=streams.filter(s=>s.codec_type==='audio');
 assert.equal(Number(v.nb_read_frames),438);assert.equal(Number(v.duration),14.6);assert.equal(audio.length,mode==='silent'?0:1);
 const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'export-snapshot.json'),'utf8'));assert.equal(snapshot.revision,7);assert.equal(snapshot.timeline.clips.length,mode==='silent'?0:mode==='independent'?1:2);
 let measurements;
 if(mode==='overlap'||mode==='independent'){
 assert.equal(audio[0].sample_rate,'48000');assert.equal(audio[0].channels,2);assert.ok(Math.abs(Number(audio[0].duration)-14.6)<.03);
 const pcm=path.join(dir,'decoded.f32');run(path.join(root,'../p0/tools/ffmpeg.exe'),['-y','-v','error','-i',video,'-vn','-ac','2','-ar','48000','-f','f32le',pcm],path.join(dir,'decode.log'));
 const b=fs.readFileSync(pcm);function rms(t){let sum=0;for(let i=Math.round(t*48000);i<Math.round((t+.1)*48000);i++){const x=b.readFloatLE(i*8);sum+=x*x}return Math.sqrt(sum/4800)}
 measurements={before:rms(.4),single:rms(2),overlap:rms(4),after:rms(13)};
 assert.ok(measurements.before<.001&&measurements.after<.001);
  if(mode==='overlap'){assert.ok(measurements.single>.02);assert.ok(measurements.overlap>measurements.single*1.1);}
  else {const baseline=results.find(r=>r.mode==='overlap').measurements.single; measurements.gainRatio=measurements.single/baseline;assert.ok(Math.abs(measurements.gainRatio-.25)<.03);assert.equal(snapshot.timeline.clips[0].gain,.25);}
 let peak=0;for(let i=0;i+4<=b.length;i+=4){const value=b.readFloatLE(i);assert.ok(Number.isFinite(value));peak=Math.max(peak,Math.abs(value))}assert.ok(peak<1);measurements.peak=peak;
 }
 results.push({mode,status:'PASS',video,frames:438,audioStreams:audio.length,measurements});
}
fs.mkdirSync(path.join(root,'test-output'),{recursive:true});fs.writeFileSync(path.join(root,'test-output/audio-export.json'),JSON.stringify({status:'PASS',results},null,2));console.log(JSON.stringify({status:'PASS',results}));
