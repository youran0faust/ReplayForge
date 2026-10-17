'use strict';
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const {upgradeProject}=require('./schema-migration.cjs');
const {parseVoiceWav}=require('./voice-import.cjs');
const {clipTiming}=require('./voice-clip-model.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const plain=x=>x&&typeof x==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
function record(x,fields,partial=false){if(!plain(x)||Reflect.ownKeys(x).some(k=>!fields.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value')||!Object.getOwnPropertyDescriptor(x,k).enumerable)||(!partial&&fields.some(k=>!Object.hasOwn(x,k))))fail('INVALID_PAYLOAD','字段必须匹配命令契约');}
function id(x){if(typeof x!=='string'||!x.trim()||x.length>256)fail('INVALID_PAYLOAD','ID无效');}
function unique(xs,key){const matches=(xs||[]).filter(x=>x.id===key);if(matches.length!==1)fail('NOT_FOUND','目标缺失或ID不唯一');return matches[0];}
function verifyResource(resource,context){
 const root=fs.realpathSync(context.projectRoot),rel=resource.path;
 if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||/[:\x00]/.test(rel))fail('RESOURCE_PATH','资源路径无效');
 const inside=file=>{const r=path.relative(root,file);return r&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
 const candidate=path.resolve(root,rel);if(!inside(candidate))fail('RESOURCE_PATH','资源路径超出工程');
 const file=fs.realpathSync(candidate);if(!inside(file))fail('RESOURCE_PATH','资源realpath超出工程');
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>256*1024*1024)fail('RESOURCE_TOO_LARGE','源文件无效或过大');
 const fd=fs.openSync(file,'r');
 try{const opened=fs.fstatSync(fd);if(!opened.isFile()||opened.size!==stat.size||opened.ino!==stat.ino||opened.dev!==stat.dev)fail('RESOURCE_CHANGED','资源已变化');
 const bytes=Buffer.alloc(opened.size);let offset=0;while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);if(!n)fail('RESOURCE_CHANGED','资源已变化');offset+=n;}
 if(fs.fstatSync(fd).size!==opened.size)fail('RESOURCE_CHANGED','资源已变化');return parseVoiceWav(bytes);
 }finally{fs.closeSync(fd);}
}
// Validates actual bytes even when metadata exists. Returns a clone with hydrated metadata.
function verifyProjectVoices(project,context,verify=verifyResource){
 const next=JSON.parse(JSON.stringify(project)),seen=new Set();
 for(const d of next.scene.dialogues||[]){
  if(d.voice!==undefined&&d.voiceClips!==undefined)fail('INVALID_VOICE','不能同时使用voice与voiceClips');
  for(const v of d.voice?[d.voice]:(d.voiceClips||[])){
   const r=unique(next.resources,v.resourceId);if(r.kind!=='audio')fail('RESOURCE_KIND','配音源必须是audio');
   if(!seen.has(r.id)){
    const info=verify(r,context);if(!info||info.sampleRate!==48000||!Number.isSafeInteger(info.durationSamples)||info.durationSamples<=0)fail('INVALID_AUDIO','需要真实48kHz音频采样信息');
    for(const key of ['sampleRate','channels','bitsPerSample','durationSamples'])if(info[key]!==undefined){if(r[key]!==undefined&&r[key]!==info[key])fail('AUDIO_METADATA_MISMATCH','音频元数据与真实源不一致：'+key);r[key]=info[key];}
    seen.add(r.id);
   }
   const offset=v.sourceOffsetSamples??0;
   if((v.sampleRate!==undefined&&v.sampleRate!==48000)||(v.sourceDurationSamples!==undefined&&v.sourceDurationSamples!==r.durationSamples)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(v.durationSamples)||v.durationSamples<=0||!Number.isSafeInteger(offset+v.durationSamples)||offset+v.durationSamples>r.durationSamples||(!v.binding&&(offset!==0||v.durationSamples!==r.durationSamples)))fail('AUDIO_METADATA_MISMATCH','配音源区间或完整源时长不一致');
  }
 }
 return next;
}
function createVoiceClipCommands({getContext,publish=()=>{},verifyResource:verify=verifyResource,cacheLimit=256}){
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<1||cacheLimit>4096)throw Error('invalid cacheLimit');
 const cache=new Map();let ownerSession,ownerDocument;
 function reset(){cache.clear();ownerSession=ownerDocument=undefined;}
 function execute(kind,event,payload){try{
  const context=getContext(),{session,documentId,win}=context;
  if(session!==ownerSession||documentId!==ownerDocument){reset();ownerSession=session;ownerDocument=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅允许主窗口mainFrame调用');
  if(!session)fail('NO_DOCUMENT','工程尚未加载');
  if(context.busy)fail('BUSY','正在读写工程');
  if(context.readOnly||context.readonly)fail('READ_ONLY','工程只读');
  record(payload,['commandId','documentId','expectedRevision','dialogueId','clipId',...(kind==='split'?['atFrame']:kind==='edit'?['patch']:[])]);
  id(payload.commandId);id(payload.dialogueId);if(payload.clipId!==null)id(payload.clipId);
  if(!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','文档与版本无效');
  if(kind==='edit'){record(payload.patch,['sourceOffsetSamples','durationSamples','startFrame','binding'],true);if(!Object.keys(payload.patch).length)fail('INVALID_PAYLOAD','patch不能为空');if(payload.patch.binding!==undefined){record(payload.patch.binding,['dialogueId','mode','followOffsetFrames'],true);if(payload.patch.binding.dialogueId!==payload.dialogueId||!['follow','independent'].includes(payload.patch.binding.mode)||(Object.hasOwn(payload.patch.binding,'followOffsetFrames')&&(!Number.isSafeInteger(payload.patch.binding.followOffsetFrames)||payload.patch.binding.mode!=='follow')))fail('INVALID_PAYLOAD','binding无效');}}
  if(payload.documentId!==documentId)fail('DOCUMENT_MISMATCH','命令属于旧工程');
  const fingerprint=JSON.stringify([kind,payload]),cached=cache.get(payload.commandId);
  if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','同ID不能用于不同命令');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','已执行命令现已过期');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程版本已改变');
  if(session.draft!==null&&session.draft!==undefined||Object.entries(context).some(([k,v])=>/DraftDirty$/.test(k)&&v&&!(kind==='edit'&&k==='voiceClipDraftDirty')&&!(k==='extensionDraftDirty'&&Object.hasOwn(context,'voiceClipDraftDirty')&&Object.hasOwn(context,'componentDraftDirty'))))fail('DIRTY_DRAFT','请先应用或放弃草稿');
  const original=session.project,oldDialogue=unique(original.scene.dialogues,payload.dialogueId);
  if(payload.clipId===null&&(original.schemaVersion!==1||!oldDialogue.voice))fail('INVALID_TARGET','null片段ID仅适用于旧单voice');
  const verified=verifyProjectVoices(original,context,verify);
   const next=original.schemaVersion===1?upgradeProject(verified):verified;
  const dialogue=unique(next.scene.dialogues,payload.dialogueId),clip=payload.clipId===null?dialogue.voiceClips[0]:unique(dialogue.voiceClips,payload.clipId);
  if(!clip)fail('NOT_FOUND','配音片段不存在');
  let selectedId=clip.id;
  if(kind==='split'){
   const start=clipTiming(dialogue,clip).startFrame,at=payload.atFrame,delta=(at-start)*48000/next.design.fps;
   if(!Number.isSafeInteger(at)||at<0||at>=next.scene.durationFrames||!Number.isSafeInteger(at*48000/next.design.fps)||!Number.isSafeInteger(delta)||delta<=0||delta>=clip.durationSamples)fail('INVALID_SPLIT','切口必须是片段内部精确整数采样边界');
   const right={...structuredClone(clip),id:'clip_'+randomUUID(),sourceOffsetSamples:clip.sourceOffsetSamples+delta,durationSamples:clip.durationSamples-delta};
   if(clip.binding.mode==='follow')right.binding.followOffsetFrames=(clip.binding.followOffsetFrames??0)+at-start;else right.startFrame=at;
   clip.durationSamples=delta;dialogue.voiceClips.splice(dialogue.voiceClips.indexOf(clip)+1,0,right);selectedId=right.id;
  }else if(kind==='edit'){
   const oldStart=clipTiming(dialogue,clip).startFrame,patch=payload.patch;
   for(const key of ['sourceOffsetSamples','durationSamples','startFrame'])if(Object.hasOwn(patch,key)&&(!Number.isSafeInteger(patch[key])||patch[key]<(key==='durationSamples'?1:0)))fail('INVALID_PAYLOAD','时间必须为有效整数');
   if(patch.binding!==undefined)clip.binding=structuredClone(patch.binding);
   for(const key of ['sourceOffsetSamples','durationSamples'])if(Object.hasOwn(patch,key))clip[key]=patch[key];
   if(clip.binding.mode==='follow'){
    if(patch.startFrame!==undefined)clip.binding.followOffsetFrames=patch.startFrame-dialogue.startFrame;
    else if(patch.binding&&patch.binding.followOffsetFrames===undefined)clip.binding.followOffsetFrames=oldStart-dialogue.startFrame;
    delete clip.startFrame;
   }else clip.startFrame=patch.startFrame??oldStart;
  }else dialogue.voiceClips=dialogue.voiceClips.filter(c=>c.id!==clip.id);
  session.apply(candidate=>{for(const k of Object.keys(candidate))delete candidate[k];Object.assign(candidate,next);},'voice clip '+kind);
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,upgraded:original.schemaVersion===1,[kind==='split'?'created':kind==='edit'?'updated':'deleted']:{dialogueId:dialogue.id,clipId:selectedId}};
  cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);
  try{publish();}catch(e){console.error('Voice clip publication failed',e);}
  return structuredClone(result);
 }catch(error){return {ok:false,error:{code:error.code||'TRANSACTION_REJECTED',message:error.message}};}}
 return {splitVoiceClip:(e,p)=>execute('split',e,p),editVoiceClip:(e,p)=>execute('edit',e,p),deleteVoiceClip:(e,p)=>execute('delete',e,p),reset};
}
module.exports={createVoiceClipCommands,verifyProjectVoices,verifyResource,clipTiming};
