'use strict';
const {calculateRevealBudget}=require('./script-reading-budget.cjs');
const KEYS=['commandId','documentId','expectedRevision','dialogueId','charactersPerSecond','holdSeconds'];
const DIRTY=['characterPerformanceDraftDirty','expressionDraftDirty','dialoguePageDraftDirty','mediaDraftDirty','voiceClipDraftDirty','componentDraftDirty','extensionDraftDirty','characterDefinitionDraftDirty','characterDraftDirty','textImportDraftDirty'];
function fail(code,message){throw Object.assign(Error(message),{code});}
function createDialogueReadingCommands({getContext,publish=()=>{},cacheLimit=256}){
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<1||cacheLimit>4096)throw Error('invalid cacheLimit');
 const cache=new Map();let owner,doc;function reset(){cache.clear();owner=doc=undefined;}
 function applyDialogueReading(event,payload){try{
  const c=getContext(),{session,documentId,win}=c;if(owner!==session||doc!==documentId){reset();owner=session;doc=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||win.webContents.isDestroyed?.()||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅主窗口mainFrame可修改对白阅读参数');
  if(!session)fail('NO_DOCUMENT','未打开工程');if(c.busy||c.exporting)fail('BUSY','文件操作或导出中');if(c.readOnly||c.readonly)fail('READ_ONLY','工程只读');
  if(!payload||typeof payload!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(payload))||Reflect.ownKeys(payload).length!==KEYS.length||KEYS.some(k=>!Object.hasOwn(payload,k)||!Object.getOwnPropertyDescriptor(payload,k)?.enumerable||!Object.hasOwn(Object.getOwnPropertyDescriptor(payload,k),'value')))fail('INVALID_PAYLOAD','阅读命令字段必须精确匹配');
  if(typeof payload.commandId!=='string'||!payload.commandId.trim()||payload.commandId.length>256||!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0||typeof payload.dialogueId!=='string'||!payload.dialogueId.trim())fail('INVALID_PAYLOAD','命令、版本或对白无效');
  if(!Number.isFinite(payload.charactersPerSecond)||payload.charactersPerSecond<1||payload.charactersPerSecond>200||!Number.isFinite(payload.holdSeconds)||payload.holdSeconds<0||payload.holdSeconds>60)fail('INVALID_READING_PARAMETERS','出现速度须为1～200，停留目标须为0～60秒');
  if(documentId!==payload.documentId)fail('DOCUMENT_MISMATCH','对白属于旧工程');
  if(session.draft!=null||c.codeDraft?.dirty||DIRTY.some(k=>c[k]))fail('DIRTY_DRAFT','请先应用或放弃所有表单草稿');
  const fingerprint=JSON.stringify(KEYS.map(k=>payload[k])),cached=cache.get(payload.commandId);
  if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId不能用于不同内容');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程已变化，请重新选择对白');
  const p=session.project,matches=p.scene.dialogues.filter(d=>d.id===payload.dialogueId);if(matches.length!==1)fail('INVALID_DIALOGUE','所选对白不存在或不唯一');const d=matches[0],explicit=Array.isArray(d.pages)&&d.pages.length>0,pages=explicit?d.pages:[d],fps=p.design.fps;
  const applied=pages.map(page=>{const text=page.text?.[p.locale];if(typeof text!=='string')fail('MISSING_LOCALE_TEXT','所选对白缺少当前语言文本');const duration=page.endFrame-page.startFrame,b=calculateRevealBudget(text,duration,{speed:payload.charactersPerSecond,holdSeconds:payload.holdSeconds},fps);return {pageId:explicit?page.id:null,revealFrames:b.revealFrames,durationFrames:duration,actualRevealSeconds:b.revealFrames/fps,remainingHoldSeconds:(duration-b.revealFrames)/fps,reservedHoldSeconds:b.holdFrames/fps,requestedHoldSeconds:payload.holdSeconds,holdClamped:b.holdFrames<Math.ceil(payload.holdSeconds*fps-Number.EPSILON*Math.max(1,Math.abs(payload.holdSeconds*fps))*4)};});
  session.apply(next=>{const target=next.scene.dialogues.find(q=>q.id===d.id);if(explicit)target.pages.forEach((page,i)=>{page.revealFrames=applied[i].revealFrames;});else target.revealFrames=applied[0].revealFrames;},'apply dialogue reading');
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,dialogueId:d.id,appliedPages:applied.length,pages:applied};cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);try{publish();}catch(e){console.error('Dialogue reading publication failed',e);}return structuredClone(result);
 }catch(e){return {ok:false,error:{code:e.code||'TRANSACTION_REJECTED',message:e.message}};}}
 return {applyDialogueReading,reset};
}
module.exports={createDialogueReadingCommands};
