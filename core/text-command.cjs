'use strict';
const {randomUUID}=require('node:crypto');
const MAX_TEXT_BYTES=256*1024;
function fail(code,message){throw Object.assign(Error(message),{code});}
function createTextCommands({getContext,publish=()=>{},cacheLimit=256}){
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<1||cacheLimit>4096)throw Error('invalid cacheLimit');
 const cache=new Map();let owner,doc;
 function reset(){cache.clear();owner=doc=undefined;}
 function createDialogueFromText(event,payload){try{
  const c=getContext(),{session,documentId,win}=c;if(owner!==session||doc!==documentId){reset();owner=session;doc=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅主窗口mainFrame可创建对白');
  if(!session)fail('NO_DOCUMENT','未打开工程');if(c.busy)fail('BUSY','文件操作中');if(c.readOnly||c.readonly)fail('READ_ONLY','工程只读');
  const keys=['commandId','documentId','expectedRevision','text','locale','speakerId','atFrame','durationFrames','revealFrames'];
  if(!payload||typeof payload!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(payload))||Reflect.ownKeys(payload).length!==keys.length||keys.some(k=>!Object.hasOwn(payload,k)||!Object.getOwnPropertyDescriptor(payload,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(payload,k),'value')))fail('INVALID_PAYLOAD','文本命令字段必须精确匹配');
  if(typeof payload.commandId!=='string'||!payload.commandId.trim()||payload.commandId.length>256||!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','命令或版本无效');
  if(typeof payload.text!=='string'||!payload.text.trim()||payload.text.includes('\0')||Buffer.byteLength(payload.text,'utf8')>MAX_TEXT_BYTES)fail('INVALID_TEXT','文本不能为空、含NUL或超过256KiB');
  const p=session.project;
  if(payload.locale!==p.locale)fail('LOCALE_MISMATCH','语言已改变，请重新预览');
  if(typeof payload.speakerId!=='string'||(payload.speakerId!=='narrator'&&(p.schemaVersion===4?p.characterDefinitions:p.scene.characters).filter(x=>x.id===payload.speakerId).length!==1))fail('INVALID_SPEAKER','请选择当前场景说话人或旁白');
  const {atFrame,durationFrames,revealFrames}=payload;
  if(!Number.isSafeInteger(atFrame)||atFrame<0||!Number.isSafeInteger(durationFrames)||durationFrames<1||!Number.isSafeInteger(atFrame+durationFrames)||atFrame+durationFrames>p.scene.durationFrames||!Number.isSafeInteger(revealFrames)||revealFrames<1||revealFrames>durationFrames)fail('INVALID_RANGE','起点、时长和揭示帧必须有效且位于场景内；不会自动延长场景');
  if(documentId!==payload.documentId)fail('DOCUMENT_MISMATCH','文本预览属于旧工程');
  const fingerprint=JSON.stringify(keys.map(k=>payload[k])),cached=cache.get(payload.commandId);
  if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId不能用于不同内容');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程已变化，请重新预览');
  if(session.draft!=null||c.codeDraft?.dirty||c.characterPerformanceDraftDirty||c.expressionDraftDirty||c.dialoguePageDraftDirty||c.mediaDraftDirty||c.voiceClipDraftDirty||c.componentDraftDirty||c.extensionDraftDirty||c.characterDefinitionDraftDirty||c.characterDraftDirty)fail('DIRTY_DRAFT','请先应用或放弃其他表单');
  const end=atFrame+durationFrames;if(p.scene.dialogues.some(d=>atFrame<d.endFrame&&end>d.startFrame))fail('DIALOGUE_OVERLAP','此对白区间与已有对白重叠，请明确调整起点或时长');
  const dialogueId='dlg_'+randomUUID();session.apply(next=>{next.scene.dialogues.push({id:dialogueId,speakerId:payload.speakerId,text:{[payload.locale]:payload.text},startFrame:atFrame,endFrame:end,...(next.schemaVersion===4?{displayUntilFrame:end}:{}),revealFrames});},'create dialogue from text');
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,created:{dialogueId}};cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);try{publish();}catch(e){console.error('Text command publication failed',e);}return structuredClone(result);
 }catch(e){return {ok:false,error:{code:e.code||'TRANSACTION_REJECTED',message:e.message}};}}
 return {createDialogueFromText,reset};
}
module.exports={createTextCommands,MAX_TEXT_BYTES};
