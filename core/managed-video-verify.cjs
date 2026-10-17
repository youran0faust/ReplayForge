'use strict';
// Trusted main-process verifier. Never re-encodes or exports video frames.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {assertSelfContainedMp4}=require('./video-media.cjs');
const LIMIT=256*1024*1024,LOG_LIMIT=8*1024*1024,known=new WeakSet();
function fail(code,message){const e=Object.assign(Error('managed-video: '+message),{code,publicError:true});known.add(e);throw e;}
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'),same=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
async function ordinary(file,directory=false){
 if(typeof file!=='string'||!path.isAbsolute(file)||/[\x00-\x1f]/.test(file)||/^[/\\]{2}/.test(file)||file.slice(path.parse(file).root.length).includes(':'))fail('VIDEO_PATH_UNSAFE','ordinary absolute local path required');
 const full=path.resolve(file),root=path.parse(full).root,parts=full.slice(root.length).split(path.sep).filter(Boolean);let current=root;
 for(let i=-1;i<parts.length;i++){if(i>=0)current=path.join(current,parts[i]);const s=await fsp.lstat(current);if(s.isSymbolicLink()||((i<parts.length-1||directory)?!s.isDirectory():!s.isFile()))fail('VIDEO_PATH_UNSAFE','link or nonordinary path');}
 return fsp.lstat(full);
}
function rational(value){if(typeof value!=='string'||!/^\d+\/\d+$/.test(value))fail('VIDEO_METADATA_INVALID','invalid time base');const [n,d]=value.split('/').map(Number);if(!Number.isSafeInteger(n)||!Number.isSafeInteger(d)||n<=0||d<=0)fail('VIDEO_METADATA_INVALID','invalid time base');return n/d;}
function validateProbe(p,e){
 const streams=p?.streams,v=streams?.[0],frames=p?.frames;
 if(!Array.isArray(streams)||streams.length!==1||!v||typeof v!=='object'||v.codec_type!=='video'||v.codec_name!=='h264'||v.pix_fmt!=='yuv420p'||v.disposition?.attached_pic||v.width!==e.width||v.height!==e.height||v.avg_frame_rate!=='30/1'||v.r_frame_rate!=='30/1'||v.sample_aspect_ratio!=='1:1'||Number(v.nb_read_frames)!==e.frameCount)fail('VIDEO_METADATA_INVALID','managed stream mismatch');
 const tick=rational(v.time_base);if(tick>1/30)fail('VIDEO_CFR_INVALID','time base too coarse');
 const tolerance=tick+1e-7,number=x=>typeof x==='number'||typeof x==='string'&&x.trim()!==''?Number(x):NaN;
 if(!Number.isFinite(number(v.start_time))||Math.abs(number(v.start_time))>tolerance)fail('VIDEO_CFR_INVALID','nonzero video start');
 if(!Array.isArray(frames)||frames.length!==e.frameCount)fail('VIDEO_CFR_INVALID','decoded frame count mismatch');
 let previous=-Infinity;
 for(let i=0;i<frames.length;i++){
  const f=frames[i],t=number(f.best_effort_timestamp_time);
  if(f.media_type!=='video'||!Number.isFinite(t)||t<=previous||Math.abs(t-i/30)>tolerance)fail('VIDEO_CFR_INVALID','frame timestamps not constant rate');
  // Timestamp in stream ticks prevents printed decimal rounding masking a forged clock.
  if(f.best_effort_timestamp!==undefined){const pts=number(f.best_effort_timestamp);if(!Number.isSafeInteger(pts)||Math.abs(pts*tick-t)>tolerance)fail('VIDEO_CFR_INVALID','frame clock mismatch');}
  const duration=f.duration_time??f.pkt_duration_time;
  if(duration!==undefined&&(!Number.isFinite(number(duration))||number(duration)<=0||Math.abs(number(duration)-1/30)>tolerance))fail('VIDEO_CFR_INVALID','frame duration not constant rate');
  previous=t;
 }
}
async function verifyManagedVideo({sourceFile,expected,ffmpegPath,ffprobePath,check=()=>{},runner=spawn}={}){
 const deadline=Date.now()+90000,owned=new Map();let directory,directoryStat,sourceStat;
 async function checked(){let timer;try{await Promise.race([Promise.resolve().then(check).catch(()=>fail('VIDEO_CANCELLED','verification cancelled or inputs changed')),new Promise((_,reject)=>{timer=setTimeout(()=>{try{fail('VIDEO_TIMEOUT','90s deadline exceeded');}catch(e){reject(e);}},Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}}
 async function guard(){if(Date.now()>=deadline)fail('VIDEO_TIMEOUT','90s deadline exceeded');await checked();if(sourceStat&&signature(await ordinary(sourceFile))!==signature(sourceStat))fail('VIDEO_SOURCE_CHANGED','source identity changed');if(directory){if(!same(await ordinary(directory,true),directoryStat))fail('VIDEO_PATH_UNSAFE','temporary directory changed');for(const name of await fsp.readdir(directory)){const file=path.join(directory,name),s=await fsp.lstat(file);if(!s.isFile()||s.isSymbolicLink()||!same(s,owned.get(file)))fail('VIDEO_PATH_UNSAFE','temporary file changed');if(s.size>LOG_LIMIT)fail('VIDEO_BUDGET','tool output budget exceeded');}}}
 async function hash(){const fd=await fsp.open(sourceFile,'r'),h=createHash('sha256'),b=Buffer.alloc(1024*1024);try{for(let pos=0;;){await guard();const {bytesRead}=await fd.read(b,0,b.length,pos);if(!bytesRead)break;h.update(b.subarray(0,bytesRead));pos+=bytesRead;}}finally{await fd.close();}return h.digest('hex');}
 async function reserve(){const file=path.join(directory,randomUUID()+'.log'),fd=await fsp.open(file,'wx');owned.set(file,await fd.stat());return {file,fd};}
 async function run(exe,args){
  await guard();const out=await reserve();let err;
  try{err=await reserve();await new Promise((resolve,reject)=>{
   let child,failure,busy=false,polling=Promise.resolve();
   try{child=runner(exe,args,{windowsHide:true,stdio:['ignore',out.fd.fd,err.fd.fd]});}catch{try{fail('VIDEO_PROCESS_FAILED','tool could not start');}catch(e){reject(e);}return;}
   const stop=e=>{failure||=e;if(child.exitCode==null&&child.signalCode==null)try{child.kill('SIGKILL');}catch{}};
   const timer=setInterval(()=>{if(busy||failure)return;busy=true;polling=guard().catch(stop).finally(()=>{busy=false;});},100);
   child.once('error',()=>{try{fail('VIDEO_PROCESS_FAILED','tool failed');}catch(e){stop(e);}});
   child.once('close',async code=>{clearInterval(timer);try{await polling;if(failure)throw failure;await guard();if(code!==0)fail('VIDEO_PROCESS_FAILED','strict media validation failed');resolve();}catch(e){reject(e);}});
  });}finally{await out.fd.close();if(err)await err.fd.close();}
  await guard();return fsp.readFile(out.file,'utf8');
 }
 try{
  if(typeof check!=='function'||typeof runner!=='function')fail('VIDEO_ARGUMENT','invalid trusted callback');
  if(!expected||typeof expected!=='object'||Array.isArray(expected)||Reflect.ownKeys(expected).length!==6||Object.keys(expected).some(k=>!['hash','width','height','fps','frameCount','normalizationVersion'].includes(k))||typeof expected.hash!=='string'||!/^[a-f0-9]{64}$/.test(expected.hash)||expected.fps!==30||expected.normalizationVersion!==1||!Number.isSafeInteger(expected.frameCount)||expected.frameCount<1||expected.frameCount>1800||!Number.isSafeInteger(expected.width)||expected.width<2||expected.width>1920||expected.width%2||!Number.isSafeInteger(expected.height)||expected.height<2||expected.height>1080||expected.height%2)fail('VIDEO_EXPECTED_INVALID','invalid expected normalized video');
  // Detach caller data before the first await.
  expected={...expected};await checked();sourceStat=await ordinary(sourceFile);if(path.extname(sourceFile).toLowerCase()!=='.mp4'||sourceStat.size<12||sourceStat.size>LIMIT)fail('VIDEO_BUDGET','managed MP4 size or extension invalid');
  try{assertSelfContainedMp4(sourceFile);}catch{fail('VIDEO_CONTAINER_INVALID','MP4 is not self contained');}
  await ordinary(ffmpegPath);await ordinary(ffprobePath);const parent=path.resolve(os.tmpdir());await ordinary(parent,true);directory=await fsp.mkdtemp(path.join(parent,'replay-managed-video-'));directoryStat=await ordinary(directory,true);
  const before=await hash();if(before!==expected.hash)fail('VIDEO_HASH_MISMATCH','managed content hash mismatch');
  const input=['-protocol_whitelist','file','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i',sourceFile];
  let probe;try{probe=JSON.parse(await run(ffprobePath,['-v','error',...input,'-count_frames','-show_streams','-show_frames','-show_entries','stream=index,codec_type,codec_name,pix_fmt,width,height,sample_aspect_ratio,avg_frame_rate,r_frame_rate,time_base,start_time,nb_read_frames:stream_disposition=attached_pic:frame=media_type,best_effort_timestamp,best_effort_timestamp_time,pkt_duration_time,duration_time','-of','json']));}catch(e){if(known.has(e))throw e;fail('VIDEO_PROBE_INVALID','invalid probe result');}
  validateProbe(probe,expected);
  await run(ffmpegPath,['-hide_banner','-v','error','-nostdin','-xerror','-err_detect','explode',...input,'-map','0:v:0','-an','-sn','-dn','-f','null','-']);
  if(await hash()!==before)fail('VIDEO_SOURCE_CHANGED','managed content changed');await guard();
  return {...expected,mime:'video/mp4'};
 }catch(e){if(known.has(e))throw e;fail('VIDEO_VERIFY_FAILED','managed video verification failed');}
 finally{if(directory)try{if(same(await ordinary(directory,true),directoryStat)){for(const [file,stat]of owned){try{const s=await fsp.lstat(file);if(s.isFile()&&!s.isSymbolicLink()&&same(s,stat))await fsp.unlink(file);}catch{}}await fsp.rmdir(directory);}}catch{}}
}
module.exports={verifyManagedVideo};
