'use strict';
const {randomUUID}=require('crypto');
const CACHE_LIMIT=256;
function fail(code,message){throw Object.assign(Error(message),{code});}
function record(value,keys){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_PAYLOAD','必须为普通对象');for(const key of Reflect.ownKeys(value)){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!keys.includes(key)||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))fail('INVALID_PAYLOAD','字段必须精确匹配命令契约');}if(keys.some(key=>!Object.hasOwn(value,key)))fail('INVALID_PAYLOAD','缺少字段');}
function id(value){if(typeof value!=='string'||!value.trim()||value.length>256)fail('INVALID_PAYLOAD','ID无效');}
function unique(project,value){const matches=project.scene.characters.filter(c=>c.id===value);if(matches.length!==1)fail('NOT_FOUND','角色实例缺失或不唯一');return matches[0];}
function createCharacterClipCommands({getContext,publish=()=>{}}){
 const cache=new Map();let ownerSession,ownerDocument;
 function reset(){cache.clear();ownerSession=ownerDocument=undefined;}
 function execute(kind,event,payload){try{
  const context=getContext(),{session,documentId,win}=context;
  if(ownerSession!==session||ownerDocument!==documentId){reset();ownerSession=session;ownerDocument=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅主窗口mainFrame可调用');
  if(!session)fail('NO_DOCUMENT','尚未加载工程');if(context.busy)fail('BUSY','文件操作中');if(context.readOnly||context.readonly)fail('READ_ONLY','工程只读');
  const keys=['commandId','documentId','expectedRevision',...(kind==='duplicate'?['sourceCharacterId','atFrame']:['characterId'])];record(payload,keys);id(payload.commandId);id(payload[kind==='duplicate'?'sourceCharacterId':'characterId']);
  if(!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','文档/版本必须非负整数');
  if(payload.documentId!==documentId)fail('DOCUMENT_MISMATCH','旧工程命令');
  if(kind==='duplicate'&&(!Number.isSafeInteger(payload.atFrame)||payload.atFrame<0))fail('INVALID_FRAME','落点必须是非负整数帧');
  if(session.draft!=null||context.codeDraft?.dirty||Object.entries(context).some(([key,value])=>/DraftDirty$/.test(key)&&!!value))fail('DIRTY_DRAFT','请先应用或放弃未提交表单');
  const fingerprint=JSON.stringify([kind,...keys.map(key=>payload[key])]),cached=cache.get(payload.commandId);
  if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId已使用');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程版本已变化，请重新复制角色片段');
  const project=session.project;if(![1,2,3,4].includes(project.schemaVersion))fail('UNSUPPORTED_SCHEMA','不支持的工程版本');
  const source=unique(project,payload[kind==='duplicate'?'sourceCharacterId':'characterId']);let character,affectedDialogueIds=[];
  if(kind==='duplicate'&&project.schemaVersion===4){const {copyCharacter,appendCharacter}=require('./timeline-clipboard.cjs');const copied=copyCharacter(project,source,payload.atFrame);character=copied.item;session.apply(p=>appendCharacter(p,character,copied.linked),'duplicate character clip');}else if(kind==='duplicate'){
   const length=source.visibleTo-source.visibleFrom,end=payload.atFrame+length,delta=payload.atFrame-source.visibleFrom;
   if(!Number.isSafeInteger(length)||length<=0||!Number.isSafeInteger(end)||end>project.scene.durationFrames)fail('OUT_OF_BOUNDS','复制片段超出场景；请调整落点或场景时长');
   character=structuredClone(source);character.id='character_'+randomUUID();character.visibleFrom=payload.atFrame;character.visibleTo=end;
   for(const field of ['expressionEvents','visibilityEvents','positionKeyframes'])if(Object.hasOwn(character,field))character[field]=character[field].map(item=>{
    const frame=item.frame+delta;if(!Number.isSafeInteger(frame)||frame<0||(field==='positionKeyframes'?frame>project.scene.durationFrames:frame>=project.scene.durationFrames))fail('EVENT_OUT_OF_BOUNDS','复制后的事件超出场景；包含片段范围外事件，不能静默丢弃');return {...item,id:field+'_'+randomUUID(),frame};
   });
   session.apply(p=>{p.scene.characters.push(character);},'duplicate character clip');
  }else{affectedDialogueIds=project.schemaVersion===4?[]:project.scene.dialogues.filter(d=>d.speakerId===source.id).map(d=>d.id);session.deleteCharacter(source.id);}
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,...(kind==='duplicate'?{created:{characterId:character.id}}:{deleted:{characterId:source.id},affectedDialogueIds})};
  cache.set(payload.commandId,{fingerprint,result});if(cache.size>CACHE_LIMIT)cache.delete(cache.keys().next().value);try{publish();}catch(error){console.error('Character clip publication failed:',error);}return structuredClone(result);
 }catch(error){return {ok:false,error:{code:error.code||'TRANSACTION_REJECTED',message:error.message}};}}
 return {duplicateCharacterClip:(event,payload)=>execute('duplicate',event,payload),deleteCharacterClip:(event,payload)=>execute('delete',event,payload),reset};
}
module.exports={createCharacterClipCommands};
