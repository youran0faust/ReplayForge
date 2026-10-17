'use strict';
const {randomUUID}=require('crypto');
function fail(code,message){throw Object.assign(Error(message),{code});}
function record(v,required,optional=[]){if(!v||typeof v!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('INVALID_PAYLOAD','必须为普通对象');for(const k of Reflect.ownKeys(v)){const d=Object.getOwnPropertyDescriptor(v,k);if(typeof k!=='string'||![...required,...optional].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('INVALID_PAYLOAD','未知字段或访问器');}if(required.some(k=>!Object.hasOwn(v,k)))fail('INVALID_PAYLOAD','缺少字段');}
function id(v){if(typeof v!=='string'||!v.trim()||v.length>256)fail('INVALID_PAYLOAD','ID无效');}
function unique(items,value){const found=(items||[]).filter(x=>x.id===value);if(found.length!==1)fail('NOT_FOUND','目标缺失或不唯一');return found[0];}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
function validateDefinitionShape(d){record(d,['id','name','color','expressions'],['resourceId','portraitCanvas']);id(d.id);if(typeof d.name!=='string'||!d.name.trim()||d.name.length>256||typeof d.color!=='string'||!d.color.trim())fail('INVALID_DEFINITION','名称或颜色无效');if(!Array.isArray(d.expressions))fail('INVALID_DEFINITION','表情必须为数组');if(Object.hasOwn(d,'resourceId'))id(d.resourceId);}
const fields={upgrade:[],create:['name','color'],edit:['definitionId','definition','confirmedInstanceIds'],delete:['definitionId'],instantiate:['definitionId','atFrame'],instantiateLegacy:['characterId','atFrame']};
function createCharacterLibraryCommands({getContext,publish=()=>{},verifyResource,cacheLimit=256}){
 if(!Number.isSafeInteger(cacheLimit)||cacheLimit<1||cacheLimit>4096)throw Error('invalid cacheLimit');
 const cache=new Map();let ownerSession,ownerDocument;
 function reset(){cache.clear();ownerSession=ownerDocument=undefined;}
 function newInstance(project,definitionId,atFrame){const height=project.design.height*2/3,width=height*2/3;return {id:'character_'+randomUUID(),definitionId,x:(project.design.width-width)/2,y:project.design.height*0.9-height,width,height,visibleFrom:atFrame,visibleTo:Math.min(project.scene.durationFrames,atFrame+Math.max(1,Math.round(3*project.design.fps)))};}
 function execute(kind,event,payload){try{
  const context=getContext(),{session,documentId,win}=context;
  if(ownerSession!==session||ownerDocument!==documentId){reset();ownerSession=session;ownerDocument=documentId;}
  if(!win||win.isDestroyed()||!win.webContents?.mainFrame||event?.sender!==win.webContents||event?.senderFrame!==win.webContents.mainFrame)fail('INVALID_SENDER','仅主窗口mainFrame可调用');
  if(!session)fail('NO_DOCUMENT','尚未加载工程');if(context.busy)fail('BUSY','文件操作中');if(context.readOnly||context.readonly)fail('READ_ONLY','工程只读');
  record(payload,['commandId','documentId','expectedRevision',...fields[kind]],kind==='create'?['resourceId']:[]);id(payload.commandId);
  if(!Number.isSafeInteger(payload.documentId)||payload.documentId<0||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0)fail('INVALID_PAYLOAD','文档/版本必须非负整数');
  if(payload.documentId!==documentId)fail('DOCUMENT_MISMATCH','旧工程命令');
  if(kind==='instantiateLegacy')id(payload.characterId);else if(kind!=='upgrade'&&kind!=='create')id(payload.definitionId);
  if(kind==='edit'){validateDefinitionShape(payload.definition);if(payload.definition.id!==payload.definitionId)fail('INVALID_DEFINITION','定义ID不能改变');if(!Array.isArray(payload.confirmedInstanceIds)||payload.confirmedInstanceIds.length>10000||new Set(payload.confirmedInstanceIds).size!==payload.confirmedInstanceIds.length)fail('INVALID_PAYLOAD','确认实例ID必须唯一');payload.confirmedInstanceIds.forEach(id);}
  if((kind==='instantiate'||kind==='instantiateLegacy')&&(!Number.isSafeInteger(payload.atFrame)||payload.atFrame<0||payload.atFrame>=session.project.scene.durationFrames))fail('INVALID_FRAME','帧超出场景');
  const fingerprint=JSON.stringify(canonical([kind,payload]));const cached=cache.get(payload.commandId);if(cached){if(cached.fingerprint!==fingerprint)fail('COMMAND_ID_REUSED','commandId已使用');if(cached.result.revision!==session.revision)fail('COMMAND_STALE','命令执行后工程已变化');return structuredClone(cached.result);}
  if(payload.expectedRevision!==session.revision)fail('REVISION_MISMATCH','工程版本已变化');
  const otherDraft=Object.entries(context).some(([k,v])=>/DraftDirty$/.test(k)&&k!=='characterDefinitionDraftDirty'&&!!v);
  if(session.draft!=null||context.codeDraft?.dirty||otherDraft||(context.characterDefinitionDraftDirty&&kind!=='edit'))fail('DIRTY_DRAFT','先应用或放弃其他表单');
  const project=session.project;let upgraded,definition,character;
  if(kind==='upgrade'||kind==='instantiateLegacy'){
   if(kind==='instantiateLegacy'){if(![1,2].includes(project.schemaVersion))fail('LEGACY_ONLY','旧角色拖入仅适用于版本1/2；版本3请使用instantiateCharacter');unique(project.scene.characters,payload.characterId);}
    if([3,4].includes(project.schemaVersion)){const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,upgraded:false};cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);return structuredClone(result);}
   const verified=project.schemaVersion===1?require('./voice-clips.cjs').verifyProjectVoices(project,{projectRoot:context.projectRoot},verifyResource):project;
   upgraded=require('./schema-migration.cjs').upgradeCharacters(verified);
   if(kind==='instantiateLegacy'){const old=upgraded.scene.characters.find(c=>c.id===payload.characterId);if(!old)fail('NOT_FOUND','旧角色实例不存在');character=newInstance(upgraded,old.definitionId,payload.atFrame);}
    if(upgraded.schemaVersion!==3)fail('INVALID_MIGRATION','角色库迁移未产生版本3');
  }else{
   if(![3,4].includes(project.schemaVersion))fail('UPGRADE_REQUIRED','请先显式升级角色库');
   if(kind==='create'){definition={id:'character_definition_'+randomUUID(),name:payload.name,color:payload.color,expressions:[],...(Object.hasOwn(payload,'resourceId')?{resourceId:payload.resourceId}:{})};validateDefinitionShape(definition);}
   else{unique(project.characterDefinitions,payload.definitionId);const refs=project.scene.characters.filter(c=>c.definitionId===payload.definitionId);
    if(kind==='delete'&&(refs.length||(project.schemaVersion===4&&project.scene.dialogues.some(d=>d.speakerId===payload.definitionId))))fail('DEFINITION_IN_USE','定义仍被场景实例引用');
    if(kind==='edit'){const expected=refs.map(c=>c.id).sort(),confirmed=[...payload.confirmedInstanceIds].sort();if(JSON.stringify(expected)!==JSON.stringify(confirmed))fail('REFERENCE_CONFIRMATION_REQUIRED','必须确认当前全部引用实例');definition=structuredClone(payload.definition);const expressionIds=new Set(definition.expressions.map(e=>e.id));if(refs.some(c=>(c.expressionEvents||[]).some(e=>e.expressionId!==null&&!expressionIds.has(e.expressionId))))fail('EXPRESSION_IN_USE','表情仍被实例事件引用');}
    if(kind==='instantiate')character=newInstance(project,payload.definitionId,payload.atFrame);
   }
  }
  session.apply(p=>{
   if(kind==='upgrade'||kind==='instantiateLegacy'){for(const key of Object.keys(p))delete p[key];Object.assign(p,structuredClone(upgraded));if(kind==='instantiateLegacy')p.scene.characters.push(character);}
   else if(kind==='create')p.characterDefinitions.push(definition);
   else if(kind==='edit')p.characterDefinitions[p.characterDefinitions.findIndex(d=>d.id===payload.definitionId)]=definition;
   else if(kind==='delete')p.characterDefinitions=p.characterDefinitions.filter(d=>d.id!==payload.definitionId);
   else p.scene.characters.push(character);
   const errors=require('./model.cjs').validateProject(p);if(errors.length)fail('INVALID_PROJECT',errors.join(';'));
  },'character library '+kind);
  const change=kind==='instantiateLegacy'?{upgraded:true,created:{characterId:character.id,definitionId:character.definitionId}}:kind==='upgrade'?{upgraded:true}:kind==='create'?{created:{definitionId:definition.id}}:kind==='instantiate'?{created:{characterId:character.id}}:kind==='edit'?{updated:{definitionId:payload.definitionId}}:{deleted:{definitionId:payload.definitionId}};
  const result={ok:true,commandId:payload.commandId,documentId,revision:session.revision,...change};cache.set(payload.commandId,{fingerprint,result});if(cache.size>cacheLimit)cache.delete(cache.keys().next().value);try{publish();}catch(error){console.error('Character library publication failed:',error);}return structuredClone(result);
 }catch(error){return {ok:false,error:{code:error.code||'TRANSACTION_REJECTED',message:error.message}};}}
 return {upgradeCharacterLibrary:(e,p)=>execute('upgrade',e,p),createCharacterDefinition:(e,p)=>execute('create',e,p),editCharacterDefinition:(e,p)=>execute('edit',e,p),deleteCharacterDefinition:(e,p)=>execute('delete',e,p),instantiateCharacter:(e,p)=>execute('instantiate',e,p),instantiateLegacyCharacter:(e,p)=>execute('instantiateLegacy',e,p),reset};
}
module.exports={createCharacterLibraryCommands};
