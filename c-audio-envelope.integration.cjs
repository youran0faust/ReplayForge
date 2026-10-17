'use strict';
// Offline PCM oracle: no Electron, sound card, or editor process interaction.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{spawnSync}=require('node:child_process');
const {compileAudioTimeline,buildFfmpegArgs}=require('./core/audio-timeline.cjs');
const {envelopeAtSample}=require('./core/audio-envelope.cjs');
const root=path.resolve(__dirname,'../test-output/P2/c-envelope-'+randomUUID());fs.mkdirSync(root,{recursive:true});
const ffmpeg=process.env.FFMPEG_PATH||path.resolve(__dirname,'../p0/tools/ffmpeg.exe');
const report={status:'running',root,ffmpeg,commands:[],checks:[]};
function run(name,args){const log=path.join(root,name+'.log'),fd=fs.openSync(log,'w');let result;try{result=spawnSync(ffmpeg,args,{stdio:['ignore',fd,fd],windowsHide:true});}finally{fs.closeSync(fd);}report.commands.push({name,args,log,status:result.status,error:result.error?.message});if(result.error)throw result.error;assert.equal(result.status,0,name+' failed; see '+log);}
try{
 const source=path.join(root,'constant.wav');
 run('source',['-y','-f','lavfi','-i','aevalsrc=0.125|0.125:s=48000:d=4','-c:a','pcm_s16le',source]);
 const project={schemaVersion:4,design:{fps:30},scene:{durationFrames:90,dialogues:[{id:'dialogue',startFrame:60,endFrame:61,voiceClips:[{id:'voice',resourceId:'wav',sampleRate:48000,durationSamples:48000,sourceOffsetSamples:0,binding:{dialogueId:'dialogue',mode:'follow'}}]}],audioTracks:[
  {id:'a',name:'before replacement',kind:'bgm',resourceId:'wav',startFrame:0,durationSamples:48000,sourceOffsetSamples:48000,gain:.5,fadeOutSamples:24000},
  {id:'b',name:'after replacement',kind:'bgm',resourceId:'wav',startFrame:30,durationSamples:48000,sourceOffsetSamples:96000,gain:1,fadeOutSamples:48000}
 ]}};
 const diagnosis={hasErrors:false,resources:{wav:{kind:'audio',exists:true,absolute:source,audio:{format:'wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:192000}}}};
 const timeline=compileAudioTimeline(project,diagnosis),args=buildFfmpegArgs({project,timeline,resources:diagnosis.resources,framesPattern:'unused-%04d.png',outputPath:'unused.mp4'});
 const filter=args[args.indexOf('-filter_complex')+1];report.filter=filter;report.timeline=timeline;
 const pcm=path.join(root,'mixed.f32le');
 // The production graph is used verbatim, including mix, limiter and scene trim.
 run('render',['-y','-f','lavfi','-i','color=c=black:s=16x16:r=30:d=3',...timeline.clips.flatMap(c=>['-i',diagnosis.resources[c.resourceId].absolute]),'-filter_complex',filter,'-map','[a]','-vn','-c:a','pcm_f32le','-f','f32le',pcm]);
 const bytes=fs.readFileSync(pcm),frames=bytes.length/8;assert.equal(frames,144000,'scene samples must not stretch');
 for(const clip of timeline.clips){
  const fade=clip.fadeOutSamples||0,local=fade?[0,Math.max(0,clip.durationSamples-fade-1),clip.durationSamples-fade,clip.durationSamples-Math.floor(fade/2),clip.durationSamples-1]:[0,24000,47999];
  for(const s of [...new Set(local)]){
   const globalSample=clip.startSamples+s,expected=.125*(clip.gain??1)*envelopeAtSample(clip.durationSamples,fade,s);
   for(let channel=0;channel<2;channel++){const actual=bytes.readFloatLE(globalSample*8+channel*4);assert.ok(Math.abs(actual-expected)<2e-7,`${clip.id} sample ${s} ch${channel}: ${actual} != ${expected}`);report.checks.push({clip:clip.id,localSample:s,globalSample,channel,expected,actual});}
  }
 }
 assert.equal(timeline.clips.find(c=>c.clipId==='voice').durationSamples,48000);report.frames=frames;report.status='PASS';
}catch(error){report.status='FAIL';report.error=error.stack;process.exitCode=1;}
finally{const output=path.join(root,'report.json');fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:output,checks:report.checks.length}));}
