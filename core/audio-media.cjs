'use strict';
// Trusted main-process API only. Decode once; loop tags are not interpreted.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path');
const {createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {parseVoiceWav}=require('./voice-import.cjs');
const LIMIT=256*1024*1024,LOG_LIMIT=1024*1024,SECONDS=600,known=new WeakSet();
function fail(code,message){const e=Object.assign(new Error('audio-media: '+message),{code,publicError:true});known.add(e);throw e;}
const identity=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
const signature=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
async function ordinary(file,directory=false){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||file.startsWith('\\\\')||file.slice(path.parse(file).root.length).includes(':'))fail('AUDIO_PATH_UNSAFE','absolute ordinary local path required');
 const full=path.resolve(file),root=path.parse(full).root;let current=root;const parts=full.slice(root.length).split(path.sep).filter(Boolean);
 for(let i=-1;i<parts.length;i++){if(i>=0)current=path.join(current,parts[i]);const s=await fsp.lstat(current);if(s.isSymbolicLink()||((i<parts.length-1||directory)?!s.isDirectory():!s.isFile()))fail('AUDIO_PATH_UNSAFE','link or nonordinary path');}
 return fsp.lstat(full);
}
function assertOgg(bytes){
 let at=0,serial,sequence=0,ended=false;
 while(at<bytes.length){if(ended||at+27>bytes.length||bytes.toString('ascii',at,at+4)!=='OggS'||bytes[at+4]!==0)fail('AUDIO_FORMAT','invalid or chained OGG');const flags=bytes[at+5],id=bytes.readUInt32LE(at+14),seq=bytes.readUInt32LE(at+18),n=bytes[at+26];if(flags&~7||at+27+n>bytes.length||seq!==sequence++||(serial!==undefined&&id!==serial)||(serial===undefined?!(flags&2):!!(flags&2)))fail('AUDIO_FORMAT','multiplexed or malformed OGG');serial=id;let size=0;for(let i=0;i<n;i++)size+=bytes[at+27+i];at+=27+n+size;if(at>bytes.length)fail('AUDIO_FORMAT','truncated OGG');ended=!!(flags&4);}
 if(serial===undefined||!ended)fail('AUDIO_FORMAT','incomplete OGG stream');
}
async function normalizeAudio({sourceFile,outputDirectory,ffmpegPath,ffprobePath,check=()=>{},runner=spawn}={}){
 const deadline=Date.now()+90000,owned=new Map();let sourceStat,outputStat;
 async function outputSame(){try{return identity(await ordinary(outputDirectory,true),outputStat);}catch{return false;}}
 async function checked(){let timer;try{await Promise.race([Promise.resolve().then(check).catch(()=>fail('AUDIO_CANCELLED','operation cancelled or inputs changed')),new Promise((_,reject)=>{timer=setTimeout(()=>{try{fail('AUDIO_TIMEOUT','90s deadline exceeded');}catch(e){reject(e);}},Math.max(1,deadline-Date.now()));})]);}finally{clearTimeout(timer);}}
 async function guard(){
  if(Date.now()>=deadline)fail('AUDIO_TIMEOUT','90s deadline exceeded');await checked();
  if(sourceStat&&signature(await ordinary(sourceFile))!==signature(sourceStat))fail('AUDIO_SOURCE_CHANGED','source changed');
  if(!await outputSame())fail('AUDIO_PATH_UNSAFE','output directory identity changed');
  for(const name of await fsp.readdir(outputDirectory)){const file=path.join(outputDirectory,name),entry=owned.get(file);if(!entry)fail('AUDIO_PATH_UNSAFE','unexpected output entry');const s=await fsp.lstat(file);if(!s.isFile()||s.isSymbolicLink()||!identity(s,entry.stat))fail('AUDIO_PATH_UNSAFE','output identity changed');if(s.size>(entry.log?LOG_LIMIT:LIMIT))fail('AUDIO_BUDGET','output or log budget exceeded');}
 }
 async function hash(file){const h=createHash('sha256'),fd=await fsp.open(file,'r'),b=Buffer.alloc(1024*1024);try{for(let pos=0;;){await guard();const {bytesRead}=await fd.read(b,0,b.length,pos);if(!bytesRead)break;h.update(b.subarray(0,bytesRead));pos+=bytesRead;}}finally{await fd.close();}return h.digest('hex');}
 async function reserve(suffix,log){const file=path.join(outputDirectory,'audio-'+randomUUID()+suffix),fd=await fsp.open(file,'wx');owned.set(file,{stat:await fd.stat(),log});return {file,fd};}
 async function remove(file){const entry=owned.get(file);if(await outputSame()){const s=await fsp.lstat(file);if(s.isFile()&&!s.isSymbolicLink()&&identity(s,entry?.stat)){await fsp.unlink(file);owned.delete(file);}}}
 async function run(exe,args){
  await guard();const out=await reserve('.stdout',true);let err;
  try{err=await reserve('.stderr',true);
   await new Promise((resolve,reject)=>{
    let child,failure,busy=false,polling=Promise.resolve();
    try{child=runner(exe,args,{windowsHide:true,stdio:['ignore',out.fd.fd,err.fd.fd]});}catch{try{fail('AUDIO_PROCESS_FAILED','media tool could not start');}catch(e){reject(e);}return;}
    const stop=e=>{failure||=e;if(child.exitCode==null&&child.signalCode==null)child.kill('SIGKILL');};
    const timer=setInterval(()=>{if(busy||failure)return;busy=true;polling=guard().catch(stop).finally(()=>{busy=false;});},100);
    child.once('error',()=>{try{fail('AUDIO_PROCESS_FAILED','media tool failed');}catch(e){stop(e);}});
    // Wait for close, not just exit, before closing descriptors/removing files.
    child.once('close',async code=>{clearInterval(timer);try{await polling;if(failure)throw failure;await guard();if(code!==0)fail('AUDIO_PROCESS_FAILED','media tool returned failure');resolve();}catch(e){reject(e);}});
   });
  }finally{await out.fd.close();if(err)await err.fd.close();}
  await guard();const text=await fsp.readFile(out.file,'utf8');await remove(out.file);await remove(err.file);return text;
 }
 try{
  if(typeof check!=='function'||typeof runner!=='function')fail('AUDIO_ARGUMENT','invalid trusted callback');await checked();
  sourceStat=await ordinary(sourceFile);outputStat=await ordinary(outputDirectory,true);
  if((await fsp.readdir(outputDirectory)).length)fail('AUDIO_OUTPUT_NOT_EMPTY','output directory must be empty');
  await ordinary(ffmpegPath);await ordinary(ffprobePath);
  const extension=path.extname(sourceFile).toLowerCase(),format=extension==='.ogg'?'ogg':extension==='.mp3'?'mp3':null;
  if(!format)fail('AUDIO_FORMAT','only OGG Vorbis/Opus and MP3 accepted');if(sourceStat.size<4||sourceStat.size>LIMIT)fail('AUDIO_BUDGET','input size budget exceeded');
  if(format==='ogg'){const bytes=await fsp.readFile(sourceFile);if(bytes.length>LIMIT)fail('AUDIO_BUDGET','input size budget exceeded');assertOgg(bytes);}
  const before=await hash(sourceFile),input=['-protocol_whitelist','file','-format_whitelist',format,'-f',format,'-i',sourceFile];
  let probe;try{probe=JSON.parse(await run(ffprobePath,['-v','error',...input,'-show_format','-show_streams','-of','json']));}catch(e){if(known.has(e))throw e;fail('AUDIO_PROBE_INVALID','invalid media probe');}
  const streams=probe?.streams,s=streams?.[0];
  if(!Array.isArray(streams)||streams.length!==1||s?.codec_type!=='audio'||s.disposition?.attached_pic||probe.format?.format_name!==format||!(format==='ogg'?['vorbis','opus']:['mp3']).includes(s.codec_name))fail('AUDIO_FORMAT','unsupported container, codec or streams');
  const channels=Number(s.channels),sampleRate=Number(s.sample_rate),duration=Number(probe.format?.duration);
  if(![1,2].includes(channels)||!Number.isSafeInteger(sampleRate)||sampleRate<8000||sampleRate>192000)fail('AUDIO_FORMAT','unsupported channel count or sample rate');
  if(!Number.isFinite(duration)||duration<=0||duration>SECONDS||(s.duration!==undefined&&(!Number.isFinite(Number(s.duration))||Number(s.duration)<=0||Number(s.duration)>SECONDS)))fail('AUDIO_BUDGET','duration must be at most 600 seconds');
  if(await hash(sourceFile)!==before)fail('AUDIO_SOURCE_CHANGED','source changed');
  const output=await reserve('.wav',false);await output.fd.close();
  await run(ffmpegPath,['-hide_banner','-v','error','-nostdin','-y','-xerror',...input,'-map','0:a:0','-vn','-sn','-dn','-t','601','-fs',String(LIMIT),'-ar','48000','-ac',String(channels),'-c:a','pcm_s16le','-map_metadata','-1','-f','wav',output.file]);
  await guard();const bytes=await fsp.readFile(output.file);if(bytes.length>LIMIT)fail('AUDIO_BUDGET','decoded byte budget exceeded');let info;
  try{info=parseVoiceWav(bytes);}catch{fail('AUDIO_PCM_INVALID','invalid normalized PCM WAV');}
  if(info.channels!==channels||info.durationSamples>SECONDS*48000)fail('AUDIO_BUDGET','decoded duration or channels invalid');
  const audioHash=createHash('sha256').update(bytes).digest('hex');if(await hash(sourceFile)!==before)fail('AUDIO_SOURCE_CHANGED','source changed');await guard();
  if(await hash(output.file)!==audioHash)fail('AUDIO_OUTPUT_CHANGED','normalized audio changed');
  return {audio:{file:output.file,hash:audioHash,mime:'audio/wav',sampleRate:48000,channels,bitsPerSample:16,durationSamples:info.durationSamples},source:{hash:before,extension,codec:s.codec_name,sampleRate,channels},normalizationVersion:1};
 }catch(e){for(const file of [...owned.keys()])try{await remove(file);}catch{}if(known.has(e))throw e;fail('AUDIO_NORMALIZATION_FAILED','normalization failed; no audio committed');}
}
module.exports={normalizeAudio};
