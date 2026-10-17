'use strict';
const KEYS=['commandId','documentId','expectedRevision','kind','id','parentId'];
const KINDS=new Set(['characters','dialogues','audioTracks','backgroundEvents','expressionEvents','voiceClips']);
function fail(code,message){throw Object.assign(Error(message),{code});}
function record(value){if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('INVALID_PAYLOAD','必须为普通对象');for(const key of Reflect.ownKeys(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(typeof key!=='string'||!KEYS.includes(key)||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_PAYLOAD','字段必须精确匹配删除命令');}if(KEYS.some(k=>!Object.hasOwn(value,k)))fail('INVALID_PAYLOAD','缺少删除命令字段');}
function identifier(value){if(typeof value!=='string'||!value.trim()||value.length>256)fail('INVALID_PAYLOAD','ID无效');}
function unique(list,id){const matches=(list||[]).filter(x=>x.id===id);if(matches.length!==1)fail('NOT_FOUND','对象不存在或身份不唯一');return matches[0];}
function createTimelineDeleteCommands({getContext,publish=()=>{}}){
 const cache=new Map();let ownerSession,ownerDocument;
 function reset(){cache.clear();ownerSession=ownerDocument=undefined;}
 function deleteTimelineItem(event,payload){try{
  const context=getContext(),{session,documentId,win}=context;
  if(ownerSession!==session||ownerDocument!==documentId){reset();ownerSession=session;ownerDocument=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅主窗口mainFrame可删除');
  if(!session)fail('NO_DOCUMENT','尚未加载工程');if(context.busy)fail('BUSY','文件操作中');if(context.readOnly||context.readonly)fail('READ_ONLY','工程只读');
  record(payload);identifier(payload.commandId);identifier(payload.id);
  if(!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','文档/版本必须非负整数');
  if(payload.documentId!==documentId)fail('DOCUMENT_MISMATCH','旧工程命令');
  if(!KINDS.has(payload.kind))fail('UNSUPPORTED_KIND',payload.kind==='pages'?'删除分页请使用分页编辑器，不自动合并页面':payload.kind==='audio'?'旧格式配音请先升级后操作配音片段':'不支持此时间轴对象删除');
  const nested=payload.kind==='expressionEvents'||payload.kind==='voiceClips';if(nested)identifier(payload.parentId);else if(payload.parentId!==null)fail('INVALID_PAYLOAD','此对象parentId必须为null');
  if(session.draft!=null||context.codeDraft?.dirty||Object.entries(context).some(([key,value])=>/DraftDirty$/.test(key)&&!!value))fail('DIRTY_DRAFT','请先应用或放弃未提交表单或代码草稿');
  const fingerprint=JSON.stringify(KEYS.map(k=>payload[k])),cached=cache.get(payload.commandId);
  if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId已使用');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程版本已变化，请重新选择');
  const p=session.project,{kind,id,parentId}=payload;if(![1,2,3,4].includes(p.schemaVersion))fail('UNSUPPORTED_SCHEMA','不支持的工程版本');
  let list;if(kind==='expressionEvents')list=unique(p.scene.characters,parentId).expressionEvents;
  else if(kind==='voiceClips'){if(![2,3,4].includes(p.schemaVersion))fail('UNSUPPORTED_SCHEMA','旧格式配音请先升级后操作配音片段');list=unique(p.scene.dialogues,parentId).voiceClips;}
  else list=p.scene[kind];unique(list,id);
  const affectedDialogueIds=kind==='characters'&&p.schemaVersion!==4?p.scene.dialogues.filter(d=>d.speakerId===id).map(d=>d.id):[];
  if(kind==='characters')session.deleteCharacter(id);
  else session.apply(candidate=>{const target=kind==='expressionEvents'?unique(candidate.scene.characters,parentId).expressionEvents:kind==='voiceClips'?unique(candidate.scene.dialogues,parentId).voiceClips:candidate.scene[kind];unique(target,id);target.splice(target.findIndex(x=>x.id===id),1);},'delete timeline '+kind);
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,deleted:{kind,id,parentId},affectedDialogueIds};
  cache.set(payload.commandId,{fingerprint,result});if(cache.size>256)cache.delete(cache.keys().next().value);try{publish();}catch(error){console.error('Timeline deletion publication failed:',error);}return structuredClone(result);
 }catch(error){return {ok:false,error:{code:error.code||'TRANSACTION_REJECTED',message:error.message}};}}
 return {deleteTimelineItem,reset};
}
module.exports={createTimelineDeleteCommands};
