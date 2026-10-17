'use strict';
// No I/O, sessions or publication. Main owns media preparation and shared-edit consent.
const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {validateProject}=require('./model.cjs');
function fail(code,message=code){throw Object.assign(Error(message),{code});}
function record(v,required,optional=[]){if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INVALID_PAYLOAD');for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||![...required,...optional].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_PAYLOAD');}if(required.some(k=>!Object.hasOwn(v,k)))fail('INVALID_PAYLOAD');}
function json(v,seen=new Set()){if(v===null||typeof v==='string'||typeof v==='boolean')return;if(typeof v==='number'){if(!Number.isFinite(v))fail('INVALID_PAYLOAD');return;}if(!v||typeof v!=='object'||seen.has(v))fail('INVALID_PAYLOAD');seen.add(v);if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INVALID_PAYLOAD');for(const k of Reflect.ownKeys(v)){if(Array.isArray(v)&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_PAYLOAD');json(d.value,seen);}seen.delete(v);}
function id(v){if(typeof v!=='string'||!v.trim()||v.length>256||v.includes('\0'))fail('INVALID_ID');}
const positive=v=>Number.isSafeInteger(v)&&v>0;
function target(a,key){id(key);const matches=(a||[]).filter(x=>x.id===key);if(matches.length!==1)fail('UNKNOWN_TARGET');return matches[0];}
function validate(p){let errors;try{errors=validateProject(p);}catch{fail('INVALID_PROJECT');}if(errors.length)fail('INVALID_PROJECT',errors.join('; '));}
function safePath(p){if(typeof p!=='string'||!p||/[\\:\x00-\x1f<>"|?*]/.test(p)||p.startsWith('/')||p.split('/').some(x=>!x||x==='.'||x==='..'||/[. ]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('INVALID_RESOURCE_PATH');}
function buildExternalDropCandidate(options){
 record(options,['project','items','intents'],['idFactory']);const {project,items,intents}=options;
 json(project);json(items);json(intents);
 if(![3,4].includes(project?.schemaVersion))fail('UNSUPPORTED_SCHEMA','Upgrade explicitly to schema3 or schema4 first');
 validate(project);
 if(!Array.isArray(project.resources)||new Set(project.resources.map(r=>r.id)).size!==project.resources.length)fail('INVALID_PROJECT');
 if(!Array.isArray(items)||items.length<1||items.length>20||!Array.isArray(intents)||items.length!==intents.length)fail('INVALID_BATCH');
 const factory=options.idFactory??(prefix=>prefix+'_'+randomUUID());if(typeof factory!=='function')fail('INVALID_ID_FACTORY');
 const p=structuredClone(project),created=[],resourcesAdded=[],usedIds=new Set(),writes=new Set();
 function gather(v){if(!v||typeof v!=='object')return;if(typeof v.id==='string')usedIds.add(v.id);for(const [k,x]of Object.entries(v))if(k!=='scriptSource')gather(x);}gather(p);
 function newId(prefix){const value=factory(prefix);id(value);if(usedIds.has(value))fail('ID_CONFLICT');usedIds.add(value);return value;}
 function write(key){if(writes.has(key))fail('DUPLICATE_TARGET');writes.add(key);}
 function frame(f){if(!Number.isSafeInteger(f)||f<0||f>=p.scene.durationFrames)fail('INVALID_FRAME');}
 function audioRange(start,samples){frame(start);const end=start+samples*p.design.fps/48000;if(!Number.isFinite(end)||end>p.scene.durationFrames)fail('AUDIO_OUT_OF_RANGE');if((p.scene.videoClips||[]).some(v=>start<v.endFrame&&end>v.startFrame))fail('VIDEO_AUDIO_OVERLAP','No silent truncation by video');}
 for(let index=0;index<items.length;index++){
  const item=items[index],intent=intents[index];if(item?.kind==='video'||intent?.kind==='video')fail('USE_SCRIPT_VIDEO');
  if(!['image','audio','text'].includes(item?.kind))fail('UNSUPPORTED_MEDIA');
  record(item,['kind','source',...(item.kind==='text'?['text']:item.kind==='image'?['resource','width','height']:['resource'])]);
  record(item.source,['name','sha256','bytes','extension']);const s=item.source;
  if(typeof s.name!=='string'||!s.name.trim()||s.name.includes('\0')||typeof s.sha256!=='string'||! /^[a-f0-9]{64}$/.test(s.sha256)||!positive(s.bytes)||s.bytes>256*1024*1024||typeof s.extension!=='string'||!/^\.[a-z0-9]+$/.test(s.extension))fail('INVALID_SOURCE');
  let r;
  if(item.kind!=='text'){
   r=item.resource;record(r,['id','kind','path','mime',...(item.kind==='audio'?['sampleRate','channels','bitsPerSample','durationSamples']:[])]);id(r.id);safePath(r.path);
   if(r.kind!==item.kind)fail('INVALID_RESOURCE');
   if(item.kind==='image'){
    if(!['image/png','image/jpeg'].includes(r.mime)||!(r.mime==='image/png'?/\.png$/i:/\.jpe?g$/i).test(r.path)||!positive(item.width)||!positive(item.height)||item.width>8192||item.height>8192)fail('INVALID_IMAGE');
   }else if(r.mime!=='audio/wav'||! /\.wav$/i.test(r.path)||r.sampleRate!==48000||![1,2].includes(r.channels)||r.bitsPerSample!==16||!positive(r.durationSamples)||r.durationSamples>600*48000)fail('INVALID_AUDIO');
   const existing=p.resources.filter(x=>x.id===r.id);
   if(existing.length){if(existing.length!==1||!isDeepStrictEqual(existing[0],r))fail('RESOURCE_COLLISION');}
   else {if(usedIds.has(r.id)||p.resources.some(x=>x.path.toLowerCase()===r.path.toLowerCase()))fail('RESOURCE_COLLISION');usedIds.add(r.id);p.resources.push(structuredClone(r));resourcesAdded.push(structuredClone(r));}
  }else if(typeof item.text!=='string'||!item.text.trim()||item.text.includes('\0')||Buffer.byteLength(item.text,'utf8')>256*1024)fail('INVALID_TEXT');
  const kind=intent?.kind,row={index,kind};
  if(['background','image','character-new','character-base','expression-slot'].includes(kind)&&item.kind!=='image'||['audio','voice-replace'].includes(kind)&&item.kind!=='audio'||kind==='text'&&item.kind!=='text')fail('INTENT_MEDIA_MISMATCH');
  switch(kind){
   case 'background':record(intent,['kind','atFrame']);frame(intent.atFrame);write('background:'+intent.atFrame);if((p.scene.backgroundEvents||[]).some(e=>e.frame===intent.atFrame))fail('DUPLICATE_TARGET');row.eventId=newId('background');(p.scene.backgroundEvents||=[]).push({id:row.eventId,frame:intent.atFrame,background:{kind:'image',resourceId:r.id}});break;
   case 'image':{
    record(intent,['kind','atFrame','x','y']);frame(intent.atFrame);if(!Number.isFinite(intent.x)||!Number.isFinite(intent.y))fail('INVALID_POSITION');
    const elementId=newId('element');row.definitionId=newId('component_definition');row.instanceId=newId('component');
    (p.componentDefinitions||=[]).push({id:row.definitionId,name:'图片',kind:'decoration',designSize:{width:240,height:160},scaleMode:'uniform',visibility:'instance-range',elements:[{id:elementId,type:'image',rect:{x:0,y:0,width:240,height:160},resourceId:r.id,fit:'contain'}]});
    (p.scene.components||=[]).push({id:row.instanceId,definitionId:row.definitionId,x:intent.x,y:intent.y,width:240,height:160,zIndex:0,locked:false,visibleFrom:intent.atFrame,visibleTo:p.scene.durationFrames});break;
   }
   case 'character-new':record(intent,['kind','name','color']);if(typeof intent.name!=='string'||!intent.name.trim()||intent.name.length>256||typeof intent.color!=='string'||!intent.color.trim())fail('INVALID_DEFINITION');row.definitionId=newId('character_definition');p.characterDefinitions.push({id:row.definitionId,name:intent.name,color:intent.color,expressions:[],resourceId:r.id});break;
   case 'character-base':record(intent,['kind','definitionId']);write('base:'+intent.definitionId);target(p.characterDefinitions,intent.definitionId).resourceId=r.id;row.definitionId=intent.definitionId;break;
   case 'expression-slot':{
    record(intent,['kind','definitionId','expressionId'],['layerId']);const d=target(p.characterDefinitions,intent.definitionId),ex=target(d.expressions,intent.expressionId);
    if(ex.mode==='overlay'){if(!Object.hasOwn(intent,'layerId'))fail('LAYER_REQUIRED');write('layer:'+d.id+':'+ex.id+':'+intent.layerId);target(ex.layers,intent.layerId).resourceId=r.id;row.layerId=intent.layerId;}
    else{if(Object.hasOwn(intent,'layerId'))fail('INVALID_LAYER');write('expression:'+d.id+':'+ex.id);ex.resourceId=r.id;}
    row.definitionId=d.id;row.expressionId=ex.id;break;
   }
   case 'audio':record(intent,['kind','trackKind','atFrame']);if(!['bgm','sfx'].includes(intent.trackKind))fail('INVALID_TRACK_KIND');audioRange(intent.atFrame,r.durationSamples);row.audioTrackId=newId('track');(p.scene.audioTracks||=[]).push({id:row.audioTrackId,name:r.id,kind:intent.trackKind,resourceId:r.id,startFrame:intent.atFrame,sourceOffsetSamples:0,durationSamples:r.durationSamples,gain:1});break;
   case 'voice-replace':{
    record(intent,['kind','dialogueId']);write('voice:'+intent.dialogueId);const d=target(p.scene.dialogues,intent.dialogueId);audioRange(d.startFrame,r.durationSamples);row.dialogueId=d.id;row.voiceClipId=newId('clip');delete d.voice;d.voiceClips=[{id:row.voiceClipId,resourceId:r.id,sampleRate:48000,sourceOffsetSamples:0,durationSamples:r.durationSamples,binding:{dialogueId:d.id,mode:'follow',followOffsetFrames:0}}];break;
   }
   case 'text':{
    record(intent,['kind','atFrame','durationFrames','revealFrames','locale','speakerId']);frame(intent.atFrame);if(intent.locale!==p.locale)fail('LOCALE_MISMATCH');id(intent.speakerId);if(intent.speakerId!=='narrator')target(p.schemaVersion===4?p.characterDefinitions:p.scene.characters,intent.speakerId);
    const end=intent.atFrame+intent.durationFrames;if(!positive(intent.durationFrames)||!Number.isSafeInteger(end)||end>p.scene.durationFrames||!positive(intent.revealFrames)||intent.revealFrames>intent.durationFrames)fail('INVALID_RANGE');
    if(p.scene.dialogues.some(d=>intent.atFrame<d.endFrame&&end>d.startFrame))fail('DIALOGUE_OVERLAP');row.dialogueId=newId('dlg');p.scene.dialogues.push({id:row.dialogueId,speakerId:intent.speakerId,text:{[p.locale]:item.text},startFrame:intent.atFrame,endFrame:end,...(p.schemaVersion===4?{displayUntilFrame:end}:{}),revealFrames:intent.revealFrames});break;
   }
   default:fail('INVALID_INTENT');
  }
  created.push(row);
 }
 validate(p);return {project:p,created,resourcesAdded};
}
module.exports={buildExternalDropCandidate};
