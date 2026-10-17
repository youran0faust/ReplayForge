'use strict';
// Explicit integration-only synthetic inputs; no user files are read.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function createInputs({root,nativeImage,ffmpegPath,deadline=Date.now()+200000}={}){
 const f=require('./audio-tail-fixture.cjs').createInputs({root,nativeImage,ffmpegPath,deadline});
 const dir=path.join(f.assetsRoot,'视频');fs.mkdirSync(dir);
 const commands=[];
 for(const [name,frames,audio]of [['sound.mp4',18,true],['silent.mp4',12,false]]){
  const output=path.join(dir,name),stdout=path.join(root,name+'.stdout'),stderr=path.join(root,name+'.stderr');
  const args=['-nostdin','-v','error','-n','-f','lavfi','-i','testsrc2=size=320x180:rate=30',...(audio?['-f','lavfi','-i','sine=frequency=619:sample_rate=48000']:[]),'-map','0:v:0',...(audio?['-map','1:a:0']:[]),'-t',String(frames/30),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-r','30',...(audio?['-c:a','aac','-ac','2','-ar','48000']:['-an']),'-movflags','+faststart',output];
  const a=fs.openSync(stdout,'wx'),b=fs.openSync(stderr,'wx');let result;try{const left=deadline-Date.now();assert(left>0);result=spawnSync(ffmpegPath,args,{stdio:['ignore',a,b],windowsHide:true,timeout:Math.min(120000,left),killSignal:'SIGKILL'});}finally{fs.closeSync(a);fs.closeSync(b);}
  commands.push({executable:ffmpegPath,toolSha256:sha(fs.readFileSync(ffmpegPath)),args,exitCode:result.status,error:result.error?.message,stdout,stderr});fs.writeFileSync(path.join(root,'video-encode-provenance.json'),JSON.stringify(commands,null,2));assert.equal(result.error,undefined);assert.equal(result.status,0,'See fixture video stderr');assert(fs.statSync(output).size>0);
 }
 // Three blocking interludes: audio, silent, then the same audio resource again.
 // Explicit pauses leave distinct before/after states, while BGM is active across each cut.
 f.text=f.text.replace('@背景 night.png','@视频 sound.mp4\n@停顿 0.2秒\n@视频 silent.mp4\n@背景 night.png');
 f.text+='\n@音乐 music.ogg\n@视频 sound.mp4\n@停顿 0.2秒\n';
 const {scanAssets}=require('./core/script-asset-catalog.cjs'),{preflight,textHash}=require('./core/script-preflight.cjs');f.catalog=scanAssets(f.assetsRoot);
 const initial=preflight({text:f.text,config:f.config,catalog:f.catalog}),ds=initial.nodes.filter(n=>n.type==='dialogue');assert.equal(ds.length,3);
 f.corrections={version:1,sourceHash:textHash(f.text),overrides:Object.fromEntries(ds.map((n,i)=>[n.id,i===2?{status:'unvoiced'}:{resourceId:f.catalog.assets.find(a=>a.relativePath===(i?'配音/TRV_001_synthetic.ogg':'配音/CHA_001_synthetic.ogg')).id}]))};
 f.snapshot={text:f.text,config:f.config,catalog:f.catalog,corrections:f.corrections};f.report=preflight(f.snapshot);assert.equal(f.report.ok,true,JSON.stringify(f.report.diagnostics));
 assert.equal(f.report.nodes.filter(n=>n.type==='command'&&n.name==='视频').length,3,'Fixture insertion must find background directive');
 fs.writeFileSync(f.scriptFile,f.text);for(const [key,value]of Object.entries({config:f.config,corrections:f.corrections,report:f.report}))fs.writeFileSync(f.paths[key],JSON.stringify(value,null,2));
 f.intendedElements={...f.intendedElements,videoFiles:[{file:'sound.mp4',frames:18,audio:true},{file:'silent.mp4',frames:12,audio:false}],videoUses:3,videoFrameTotal:48,extraPauseFrames:12,limitations:['Short synthetic video, not six-second/high-resolution/cache-limit coverage.','Blocking script insertion tests BGM cut/restart; does not manufacture an overlapping/fully-covered voice clip.']};
 return f;
}
module.exports={createInputs};
