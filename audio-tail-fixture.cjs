'use strict';
// Called only by explicit integration entry. Never reads user media.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function createInputs({root,nativeImage,ffmpegPath,deadline=Date.now()+240000}={}){
 const f=require('./plan-tail-fixture.cjs').createInputs({root,nativeImage});
 assert(path.isAbsolute(ffmpegPath)&&fs.statSync(ffmpegPath).isFile());
 const commands=[],jobs=[
  ['配音/A_001_synthetic.wav','配音/CHA_001_synthetic.ogg','libvorbis',44100,1],
  ['配音/B_001_synthetic.wav','配音/TRV_001_synthetic.ogg','libopus',48000,2],
  ['音乐/music.wav','音乐/music.ogg','libvorbis',44100,2],
  ['音效/pulse.wav','音效/pulse.mp3','libmp3lame',44100,1]
 ];
 for(const [source,target,codec,rate,channels]of jobs){
  const input=path.join(f.assetsRoot,source),output=path.join(f.assetsRoot,target),index=commands.length,stdout=path.join(root,'encode-'+index+'.stdout'),stderr=path.join(root,'encode-'+index+'.stderr');
  const args=['-nostdin','-v','error','-n','-i',input,'-map','0:a:0','-vn','-ar',String(rate),'-ac',String(channels),'-c:a',codec,...(codec==='libopus'?['-b:a','96k']:[]),output];
  const remaining=deadline-Date.now();assert(remaining>0,'Fixture global deadline expired');const a=fs.openSync(stdout,'wx'),b=fs.openSync(stderr,'wx');let r;try{r=spawnSync(ffmpegPath,args,{stdio:['ignore',a,b],timeout:Math.min(120000,remaining),killSignal:'SIGKILL',windowsHide:true});}finally{fs.closeSync(a);fs.closeSync(b);}
  commands.push({executable:ffmpegPath,toolSha256:sha(fs.readFileSync(ffmpegPath)),args,exitCode:r.status,error:r.error?.message,inputSha256:sha(fs.readFileSync(input)),stdout,stderr});fs.writeFileSync(path.join(root,'fixture-encode-provenance.json'),JSON.stringify(commands,null,2));
  assert.equal(r.error,undefined,'Fixture encoder failed; see disk stderr');assert.equal(r.status,0,'Fixture encoder exit; see disk stderr');assert(fs.statSync(output).size>0);fs.unlinkSync(input);
 }
 f.text=f.text.replaceAll('music.wav','music.ogg').replaceAll('pulse.wav','pulse.mp3');f.config.characters[0].voiceCode='CHA';f.config.characters[1].voiceCode='TRV';
 const {scanAssets}=require('./core/script-asset-catalog.cjs'),{preflight,textHash}=require('./core/script-preflight.cjs');f.catalog=scanAssets(f.assetsRoot);
 const initial=preflight({text:f.text,config:f.config,catalog:f.catalog}),ds=initial.nodes.filter(n=>n.type==='dialogue');assert.equal(ds.length,3);
 const voiceFiles=jobs.slice(0,2).map(j=>j[1]);f.corrections={version:1,sourceHash:textHash(f.text),overrides:Object.fromEntries(ds.map((n,i)=>[n.id,i===2?{status:'unvoiced'}:{resourceId:f.catalog.assets.find(a=>a.relativePath===voiceFiles[i])?.id}]))};
 assert(Object.values(f.corrections.overrides).every(o=>o.status==='unvoiced'||typeof o.resourceId==='string'),'Compressed extensions missing from production catalog');
 f.snapshot={text:f.text,config:f.config,catalog:f.catalog,corrections:f.corrections};f.report=preflight(f.snapshot);assert.equal(f.report.ok,true,JSON.stringify(f.report.diagnostics));
 fs.writeFileSync(f.scriptFile,f.text);for(const [key,value]of Object.entries({config:f.config,corrections:f.corrections,report:f.report}))fs.writeFileSync(f.paths[key],JSON.stringify(value,null,2));
 f.intendedElements={...f.intendedElements,compressedInputs:jobs.map(j=>({path:j[1],codec:j[2],sampleRate:j[3],channels:j[4]}))};f.summary={...f.summary,intendedElements:f.intendedElements};f.encodeCommands=commands;return f;
}
module.exports={createInputs};
