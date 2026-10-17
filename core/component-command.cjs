'use strict';
const {randomUUID}=require('crypto');
const {componentErrors,upgradeCandidate,verifyUpgrade,record}=require('./components.cjs');
const {validateDefinition}=require('./components-model.cjs');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function id(v){if(typeof v!=='string'||!v.trim()||v.length>256)fail('INVALID_PAYLOAD','ID无效');}
function unique(items,id){const matches=(items||[]).filter(i=>i.id===id);if(matches.length!==1)fail(matches.length?'AMBIGUOUS_TARGET':'NOT_FOUND','目标必须存在且唯一');return matches[0];}
const patchKeys=['x','y','width','height','zIndex','locked','visibleFrom','visibleTo'];
const fields={add:['definitionId','atFrame','x','y'],create:['type','atFrame','x','y'],edit:['instanceId','patch'],delete:['instanceId'],definition:['instanceId','definition'],group:['instanceIds'],ungroup:['groupId'],transform:['instanceIds','dx','dy','scale']};
// Stable fingerprints preserve idempotency even when object key order changes.
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function factory(payload){const {type}=payload,width=type==='text'?320:240,height=type==='text'?80:160;
 const element={id:'element_'+randomUUID(),type,rect:{x:0,y:0,width,height},...(type==='panel'?{fill:'#243247'}:type==='text'?{text:'文字',fontSize:32,color:'#ffffff'}:{resourceId:payload.resourceId,fit:'contain'})};
 return {id:'component_definition_'+randomUUID(),name:{panel:'矩形',text:'文字',image:'图片'}[type],kind:'decoration',designSize:{width,height},scaleMode:'uniform',visibility:'instance-range',elements:[element]};
}
function createComponentCommands({getContext,publish=()=>{},upgradeProject,verifyProjectVoices,verifyResource,cacheLimit=256}){
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<1||cacheLimit>4096)throw Error('invalid cacheLimit');
 const cache=new Map();let ownerSession,ownerDocument;
 function reset(){cache.clear();ownerSession=ownerDocument=undefined;}
 function execute(kind,event,payload){try{
  const context=getContext(),{session,documentId,win}=context;
  if(ownerSession!==session||ownerDocument!==documentId){reset();ownerSession=session;ownerDocument=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅允许主窗口mainFrame调用');
  if(!session)fail('NO_DOCUMENT','尚未加载工程');if(context.busy)fail('BUSY','文件操作中');if(context.readOnly||context.readonly)fail('READ_ONLY','工程只读');
  record(payload,['commandId','documentId','expectedRevision',...fields[kind]],kind==='create'?['resourceId']:[]);id(payload.commandId);
  if(!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','文档/版本必须非负整数');
  if(kind==='add'||kind==='create'){
   if(kind==='add')id(payload.definitionId);else {if(!['panel','text','image'].includes(payload.type))fail('INVALID_PAYLOAD','仅允许panel/text/image');if(payload.type==='image')id(payload.resourceId);else if(Object.hasOwn(payload,'resourceId'))fail('INVALID_PAYLOAD','仅图片可绑定资源');}
   if(!Number.isSafeInteger(payload.atFrame)||payload.atFrame<0||payload.atFrame>=session.project.scene.durationFrames)fail('INVALID_FRAME','帧超出场景');if(!Number.isFinite(payload.x)||!Number.isFinite(payload.y))fail('INVALID_PAYLOAD','坐标必须有限数值');
  }else if(kind==='group'||kind==='transform'){
   if(!Array.isArray(payload.instanceIds)||payload.instanceIds.length<(kind==='group'?2:1)||payload.instanceIds.length>10000||new Set(payload.instanceIds).size!==payload.instanceIds.length)fail('INVALID_PAYLOAD','选择必须为不重复的实例ID');payload.instanceIds.forEach(id);
   if(kind==='transform'&&(!Number.isFinite(payload.dx)||!Number.isFinite(payload.dy)||!Number.isFinite(payload.scale)||payload.scale<=0))fail('INVALID_PAYLOAD','位移必须有限，缩放必须为正数');
  }else if(kind==='ungroup')id(payload.groupId);
  else {id(payload.instanceId);if(kind==='edit'){record(payload.patch,[],patchKeys);if(!Object.keys(payload.patch).length)fail('INVALID_PAYLOAD','patch不能为空');}}
  if(payload.documentId!==documentId)fail('DOCUMENT_MISMATCH','旧工程命令');
  const fingerprint=JSON.stringify(canonical([kind,payload]));
  const cached=cache.get(payload.commandId);if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId已用于其他命令');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','版本已变化');
  const unknownExtensionOwner=context.extensionDraftDirty&&(typeof context.voiceClipDraftDirty!=='boolean'||typeof context.componentDraftDirty!=='boolean');
  if((session.draft!==null&&session.draft!==undefined)||unknownExtensionOwner||context.expressionDraftDirty||context.dialoguePageDraftDirty||context.mediaDraftDirty||context.voiceClipDraftDirty||((context.componentDraftDirty||context.extensionDraftDirty)&&!['edit','definition','transform'].includes(kind)))fail('DIRTY_DRAFT','先应用或放弃表单');
  const project=session.project,instances=project.scene.components||[];let target,definition,selected,groupId;
  if(kind==='add')definition=unique(project.componentDefinitions,payload.definitionId);
  else if(kind==='create'){definition=factory(payload);validateDefinition(definition,project.resources||[]);}
  else if(kind==='group'||kind==='transform'){
   selected=payload.instanceIds.map(i=>unique(instances,i));
   if(selected.some(i=>i.locked))fail('COMPONENT_LOCKED','先解锁部件再修改');
   if(kind==='group'){if(selected.some(i=>i.groupId!==undefined))fail('GROUPED_COMPONENT','先取消组合');groupId='component_group_'+randomUUID();}
   else if(selected.some(i=>i.groupId!==undefined&&instances.some(j=>j.groupId===i.groupId&&!payload.instanceIds.includes(j.id))))fail('INCOMPLETE_GROUP','请选择完整组合后整体变换');
  }else if(kind==='ungroup'){
   selected=instances.filter(i=>i.groupId===payload.groupId);if(selected.length<2)fail('NOT_FOUND','组合不存在');
  }else {
   target=unique(instances,payload.instanceId);
   if(target.locked&&kind==='edit'&&Object.keys(payload.patch).some(k=>k!=='locked'))fail('COMPONENT_LOCKED','先解锁部件再修改');
   if(target.groupId!==undefined&&(kind==='delete'||kind==='edit'&&['x','y','width','height'].some(k=>Object.hasOwn(payload.patch,k))))fail('GROUPED_COMPONENT',kind==='delete'?'先取消组合':'请选择完整组合后整体变换');
   if(kind==='definition'){
    if(target.locked||target.groupId!==undefined&&instances.some(i=>i.groupId===target.groupId&&i.locked))fail('COMPONENT_LOCKED','先解锁组合成员再编辑定义');
    validateDefinition(payload.definition,project.resources||[]);
    if(payload.definition.id!==target.definitionId)fail('INVALID_COMPONENT','definition id必须保留，副本ID由命令生成');
    if(payload.definition.kind==='dialogue-ui'&&!Object.hasOwn(payload.definition,'roles'))fail('INVALID_COMPONENT','新定义必须显式选择roles');
    definition={...structuredClone(payload.definition),id:'component_definition_'+randomUUID()};
   }
  }
  const verified=verifyUpgrade(project,context.projectRoot,{verifyProjectVoices,verifyResource});
  const instanceId=['add','create'].includes(kind)?'component_'+randomUUID():payload.instanceId;
  session.apply(p=>{
   if(verified)Object.assign(p,structuredClone(verified));upgradeCandidate(p,upgradeProject);
   if(kind==='create'||kind==='definition')(p.componentDefinitions||=[]).push(structuredClone(definition));
   if(kind==='add'||kind==='create')(p.scene.components||=[]).push({id:instanceId,definitionId:definition.id,x:payload.x,y:payload.y,width:definition.designSize.width,height:definition.designSize.height,zIndex:0,locked:false,visibleFrom:payload.atFrame,visibleTo:p.scene.durationFrames});
   else if(kind==='edit')Object.assign(unique(p.scene.components,instanceId),payload.patch);
   else if(kind==='definition')unique(p.scene.components,instanceId).definitionId=definition.id;
   else if(kind==='delete')p.scene.components=p.scene.components.filter(i=>i.id!==instanceId);
   else if(kind==='group')for(const i of selected)unique(p.scene.components,i.id).groupId=groupId;
   else if(kind==='ungroup')for(const i of selected)delete unique(p.scene.components,i.id).groupId;
   else if(kind==='transform'){
    const left=Math.min(...selected.map(i=>i.x)),top=Math.min(...selected.map(i=>i.y));
    for(const i of selected)Object.assign(unique(p.scene.components,i.id),{x:left+payload.dx+(i.x-left)*payload.scale,y:top+payload.dy+(i.y-top)*payload.scale,width:i.width*payload.scale,height:i.height*payload.scale});
   }
   const errors=componentErrors(p);if(errors.length)fail('INVALID_COMPONENT',errors.join(';'));
  },'component '+kind);
  const change=kind==='group'?{created:{groupId}}:kind==='ungroup'?{updated:{groupId:payload.groupId,instanceIds:selected.map(i=>i.id)}}:kind==='transform'?{updated:{instanceIds:payload.instanceIds.slice()}}:{[kind==='add'||kind==='create'?'created':kind==='delete'?'deleted':'updated']:{instanceId,...(kind==='create'||kind==='definition'?{definitionId:definition.id}:{})}};
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,...change};
  cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);try{publish();}catch(e){console.error('Component publication failed:',e);}return structuredClone(result);
 }catch(error){return {ok:false,error:{code:error.code||'TRANSACTION_REJECTED',message:error.message}};}}
 return {addComponent:(e,p)=>execute('add',e,p),createComponent:(e,p)=>execute('create',e,p),editComponent:(e,p)=>execute('edit',e,p),editComponentDefinition:(e,p)=>execute('definition',e,p),deleteComponent:(e,p)=>execute('delete',e,p),groupComponents:(e,p)=>execute('group',e,p),ungroupComponents:(e,p)=>execute('ungroup',e,p),transformComponents:(e,p)=>execute('transform',e,p),reset};
}
module.exports={createComponentCommands};
