'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto'),{TextDecoder}=require('node:util');
const {parseImage}=require('./image-import.cjs'),{parseVoiceWav}=require('./voice-import.cjs');
const TOTAL=512*1024*1024,AUDIO=256*1024*1024;
function fail(code){throw Object.assign(Error('External media preparation rejected.'),{code,publicError:true});}
function ordinary(file,directory=false){if(typeof file!=='string'||!path.isAbsolute(file)||/^[/\\]{2}/.test(file)||/[\x00-\x1f]/.test(file)||file.slice(path.parse(file).root.length).includes(':')||file.slice(path.parse(file).root.length).split(/[/\\]/).some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('PATH_UNSAFE');const full=path.resolve(file),root=path.parse(full).root;let current=root;const all=[root];for(const p of full.slice(root.length).split(path.sep).filter(Boolean)){current=path.join(current,p);all.push(current);}for(let i=0;i<all.length;i++){const s=fs.lstatSync(all[i]);if(s.isSymbolicLink()||((i<all.length-1||directory)?!s.isDirectory():!s.isFile()))fail('PATH_UNSAFE');}if(path.relative(fs.realpathSync(full),full)!=='')fail('PATH_UNSAFE');const stat=fs.lstatSync(full,{bigint:true});if(stat.size<0n||stat.size>BigInt(TOTAL))fail('MEDIA_BUDGET');stat.size=Number(stat.size);return stat;}
const identity=s=>`${s.dev}:${s.ino}`,signature=s=>`${identity(s)}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`,hash=b=>createHash('sha256').update(b).digest('hex');
function classify(f){const extension=path.extname(f).toLowerCase();if(extension==='.mp4')fail('USE_SCRIPT_VIDEO');if(['.png','.jpg','.jpeg'].includes(extension))return {kind:'image',limit:32*1024*1024,extension};if(['.wav','.ogg','.mp3'].includes(extension))return {kind:'audio',limit:AUDIO,extension};if(['.txt','.md'].includes(extension))return {kind:'text',limit:256*1024,extension};fail('UNSUPPORTED_MEDIA');}
async function prepareExternalMedia({files,outputDirectory,ffmpegPath,ffprobePath,check=()=>{},decodeImage,normalizeAudio=require('./audio-media.cjs').normalizeAudio}={}){
 const owned=new Map(),ownedFiles=new Map();let parentIdentity;
 async function cleanup(){let removed=0,skipped=0;for(const [dir,id]of [...owned]){try{if(identity(ordinary(outputDirectory,true))!==parentIdentity||identity(ordinary(dir,true))!==id){skipped++;continue;} // Never recursively traverse an injected link or foreign file.
 const entries=fs.readdirSync(dir,{withFileTypes:true});if(entries.some(e=>!e.isFile()||e.isSymbolicLink()||ownedFiles.get(path.join(dir,e.name))!==identity(fs.lstatSync(path.join(dir,e.name),{bigint:true})))){skipped++;continue;}for(const e of entries)fs.unlinkSync(path.join(dir,e.name));fs.rmdirSync(dir);owned.delete(dir);removed++;}catch(e){if(e.code==='ENOENT'){owned.delete(dir);continue;}skipped++;}}return {removed,skipped};}
 const checkpoint=async()=>{try{await check();}catch{fail('PREPARE_CANCELLED');}if(parentIdentity&&identity(ordinary(outputDirectory,true))!==parentIdentity)fail('PATH_UNSAFE');};
 try{
 if(!Array.isArray(files)||files.length<1||files.length>20||typeof check!=='function'||typeof normalizeAudio!=='function')fail('INVALID_PAYLOAD');
 parentIdentity=identity(ordinary(outputDirectory,true));if(fs.readdirSync(outputDirectory).length)fail('OUTPUT_NOT_EMPTY');await checkpoint();
 const seen=new Set(),inodes=new Set(),inputs=[];let raw=0;
 for(const file of files){const type=classify(file),stat=ordinary(file),key=path.resolve(file).toLowerCase();if(seen.has(key)||inodes.has(identity(stat)))fail('DUPLICATE_FILE');seen.add(key);inodes.add(identity(stat));if(stat.size<1||stat.size>type.limit||(raw+=stat.size)>TOTAL)fail('MEDIA_BUDGET');inputs.push({file,...type,signature:signature(stat)});}
 // Freeze every source before any decoder callback is allowed to run.
 for(const s of inputs){const b=fs.readFileSync(s.file);if(b.length>s.limit||signature(ordinary(s.file))!==s.signature)fail('SOURCE_CHANGED');s.sha256=hash(b);s.bytes=b.length;}
 function read(s){const st=ordinary(s.file);if(signature(st)!==s.signature||st.size>s.limit)fail('SOURCE_CHANGED');const b=fs.readFileSync(s.file);if(b.length!==s.bytes||hash(b)!==s.sha256)fail('SOURCE_CHANGED');return b;}
 function verify(){for(const s of inputs)read(s);}
 let totalManagedBytes=0;const items=[];
 for(const s of inputs){await checkpoint();const bytes=read(s),source={name:path.basename(s.file),sha256:s.sha256,bytes:s.bytes,extension:s.extension};
 if(s.kind==='text'){let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('TEXT_INVALID_UTF8');}if(text.includes('\0'))fail('TEXT_NUL');items.push({kind:'text',source,text});continue;}
 const dir=fs.mkdtempSync(path.join(outputDirectory,'external-media-'));owned.set(dir,identity(ordinary(dir,true)));let data=bytes,info,file;
 if(s.kind==='image'){if(typeof decodeImage!=='function')fail('IMAGE_DECODER_REQUIRED');try{info=parseImage(bytes,s.extension);const decoded=await decodeImage(Buffer.from(bytes));if(!decoded||decoded.width!==info.width||decoded.height!==info.height)fail('IMAGE_DECODE_FAILED');}catch(e){if(e.publicError)throw e;fail('IMAGE_DECODE_FAILED');}}
 else if(s.extension!=='.wav'){
 const result=await normalizeAudio({sourceFile:s.file,outputDirectory:dir,ffmpegPath,ffprobePath,check:async()=>{await checkpoint();verify();}}),a=result?.audio,origin=result?.source;
 if(!a||typeof a.file!=='string'||path.dirname(a.file)!==dir||path.extname(a.file).toLowerCase()!=='.wav'||result.normalizationVersion!==1||origin?.hash!==s.sha256||origin.extension!==s.extension||!(s.extension==='.ogg'?['vorbis','opus']:['mp3']).includes(origin.codec))fail('AUDIO_NORMALIZATION_INVALID');
 if(identity(ordinary(dir,true))!==owned.get(dir))fail('PATH_UNSAFE');const audioStat=ordinary(a.file);ownedFiles.set(a.file,identity(audioStat));if(audioStat.size>AUDIO)fail('MEDIA_BUDGET');data=fs.readFileSync(a.file);if(data.length>AUDIO||hash(data)!==a.hash)fail('AUDIO_NORMALIZATION_INVALID');try{info=parseVoiceWav(data);}catch{fail('AUDIO_INVALID');}if(['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>a[k]!==info[k])||a.mime!=='audio/wav')fail('AUDIO_NORMALIZATION_INVALID');file=a.file;
 }else{try{info=parseVoiceWav(bytes);}catch{fail('AUDIO_INVALID');}}
 if(s.kind==='audio'){if(info.durationSamples>600*48000)fail('MEDIA_BUDGET');info={mime:'audio/wav',sampleRate:info.sampleRate,channels:info.channels,bitsPerSample:info.bitsPerSample,durationSamples:info.durationSamples};}
 if((totalManagedBytes+=data.length)>TOTAL)fail('MEDIA_BUDGET');await checkpoint();verify();if(identity(ordinary(dir,true))!==owned.get(dir))fail('PATH_UNSAFE');
 if(!file){file=path.join(dir,'prepared'+(s.kind==='audio'?'.wav':info.extension));fs.writeFileSync(file,data,{flag:'wx'});ownedFiles.set(file,identity(ordinary(file)));}if(hash(fs.readFileSync(file))!==hash(data))fail('PREPARED_CHANGED');
 const {extension,...metadata}=info;items.push({kind:s.kind,source,file,hash:hash(data),...metadata});
 }
 await checkpoint();verify();for(const item of items)if(item.file&&(identity(ordinary(item.file))!==ownedFiles.get(item.file)||hash(fs.readFileSync(item.file))!==item.hash))fail('PREPARED_CHANGED');return {items,totalManagedBytes,cleanup};
 }catch(e){const clean=await cleanup();if(e.publicError){e.cleanup=clean;throw e;}const error=Object.assign(Error('External media preparation failed.'),{code:'MEDIA_PREPARE_FAILED',publicError:true,cleanup:clean});throw error;}
}
module.exports={prepareExternalMedia};
