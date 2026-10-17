const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const {ProjectSession} = require('./session.cjs');
const {createExpressionCommands} = require('./expression-command.cjs');
const example = JSON.parse(fs.readFileSync(path.join(__dirname, '../examples/rain-corridor.json'), 'utf8').replace(/^\uFEFF/, ''));
function fixture(cacheLimit = 256) {
  const session = new ProjectSession(example), characterId = session.project.scene.characters[0].id;
  const expressionId = session.addExpression(characterId, {name:'S1',resourceId:example.resources.find(r=>r.kind==='image').id}).id;
  const win = {isDestroyed:()=>false,webContents:{mainFrame:{},send(){}}};
  const context = {session,documentId:7,win}; let publishes = 0;
  const commands = createExpressionCommands({getContext:()=>context,publish:()=>publishes++,cacheLimit});
  const event = {sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const payload = (commandId='drop',atFrame=10) => ({commandId,documentId:context.documentId,expectedRevision:context.session.revision,source:{characterId,expressionId},target:{characterId},atFrame});
  return {session,characterId,expressionId,context,commands,event,payload,publishes:()=>publishes};
}
function sharedFixture() {
  const f = fixture(), {upgradeCharacters, upgradeCharacters4} = require('./schema-migration.cjs');
  f.context.session = f.session = new ProjectSession(upgradeCharacters4(upgradeCharacters(f.session.snapshot())));
  const definitionId = f.session.project.scene.characters[0].definitionId;
  f.session.apply(p => {p.scene.characters.push({...structuredClone(p.scene.characters[0]), id:'shared-instance'});});
  f.payload = (commandId='drop',atFrame=10) => ({commandId,documentId:7,expectedRevision:f.session.revision,source:{definitionId,expressionId:f.expressionId},target:{characterId:f.characterId},atFrame});
  return {...f,definitionId};
}
test('schema4 shared definition drops and edits preserve owners, speakers and undo history',()=>{
  const f=sharedFixture(), c=f.commands, e=f.event, s=f.session, before=s.snapshot();
  for (const target of [f.characterId,'shared-instance']) assert.equal(c.dropExpression(e,{...f.payload('drop-'+target),target:{characterId:target}}).ok,true);
  const eventId=s.project.scene.characters[0].expressionEvents[0].id;
  const edit={commandId:'edit4',documentId:7,expectedRevision:s.revision,characterId:f.characterId,eventId,patch:{frame:22,expressionId:f.expressionId}};
  assert.equal(c.editExpressionEventChecked(e,edit).ok,true);
  assert.deepEqual(s.project.characterDefinitions,before.characterDefinitions);
  assert.deepEqual(s.project.scene.dialogues,before.scene.dialogues);
  const after=s.snapshot();s.undo();s.redo();assert.deepEqual(s.snapshot(),after);
  rejected(f,()=>c.dropExpression(e,{...f.payload(),source:{characterId:f.characterId,expressionId:f.expressionId}}),'INVALID_PAYLOAD');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),source:{definitionId:'foreign',expressionId:f.expressionId}}),'CROSS_CHARACTER');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),source:{definitionId:f.definitionId,expressionId:'absent'}}),'NOT_FOUND');
  rejected(f,()=>c.dropExpression({...e,senderFrame:{}},f.payload()),'INVALID_SENDER');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),documentId:6}),'DOCUMENT_MISMATCH');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),expectedRevision:0}),'REVISION_MISMATCH');
  for(const flag of ['busy','expressionDraftDirty','dialoguePageDraftDirty']) {f.context[flag]=true;rejected(f,()=>c.dropExpression(e,f.payload()),flag==='busy'?'BUSY':'DIRTY_DRAFT');delete f.context[flag];}
  s.project.characterDefinitions.find(d=>d.id===f.definitionId).expressions=[];
  s.project.scene.characters[0].expressions=[{id:f.expressionId,name:'forged instance fallback'}];
  rejected(f,()=>c.dropExpression(e,f.payload('no-fallback',30)),'NOT_FOUND');
});
function rejected(f, operation, code) {
  const before = JSON.stringify(f.context.session), result = operation();
  assert.equal(result.ok,false); if (code) assert.equal(result.error.code,code);
  assert.equal(JSON.stringify(f.context.session),before); return result;
}
test('one real transaction, idempotency, undo/redo and future branch',()=>{
  const f=fixture(), {session:s,commands:c,event:e}=f, p=f.payload(), before=s.snapshot(), history=s.history.length;
  const result=c.dropExpression(e,p); assert.equal(result.ok,true); assert.equal(s.revision,p.expectedRevision+1); assert.equal(s.history.length,history+1);
  const after=s.snapshot(); assert.deepEqual(after.scene.characters[0].expressions,before.scene.characters[0].expressions);
  assert.deepEqual(c.dropExpression(e,structuredClone(p)),result); assert.equal(f.publishes(),1);
  rejected(f,()=>c.dropExpression(e,{...p,atFrame:11}),'COMMAND_ID_REUSED');
  s.undo(); assert.deepEqual(s.snapshot(),before); rejected(f,()=>c.dropExpression(e,p),'COMMAND_STALE'); assert.equal(s.future.length,1);
  s.redo(); assert.deepEqual(s.snapshot(),after); rejected(f,()=>c.dropExpression(e,p),'COMMAND_STALE');
  s.undo(); assert.equal(c.dropExpression(e,f.payload('branch',11)).ok,true); assert.equal(s.future.length,0);
});
test('strict payload/frame/owner rejection leaves project history future revision untouched',()=>{
  const f=fixture(), c=f.commands,e=f.event;
  f.session.apply(p=>{p.locale='en-US';}); f.session.undo();
  const bad=[null,{}, {...f.payload(),extra:true}, {...f.payload(),target:{}}, {...f.payload(),source:{...f.payload().source,extra:1}}, {...f.payload(),atFrame:NaN}, {...f.payload(),atFrame:-1}, {...f.payload(),atFrame:1.5}, {...f.payload(),atFrame:f.session.project.scene.durationFrames}, {...f.payload(),source:{characterId:f.characterId,expressionId:null}}, {...f.payload(),target:{characterId:'other'}}, {...f.payload(),source:{characterId:'absent',expressionId:f.expressionId},target:{characterId:'absent'}}, {...f.payload(),source:{characterId:f.characterId,expressionId:'absent'}}];
  for(const p of bad) rejected(f,()=>c.dropExpression(e,p));
  assert.equal(c.dropExpression(e,f.payload()).ok,true);
  rejected(f,()=>c.dropExpression(e,f.payload('conflict')),'FRAME_CONFLICT');
});
test('duplicate stable target IDs reject before transaction',()=>{
  for(const kind of ['character','expression','event']) {
    const f=fixture(); const added=f.commands.dropExpression(f.event,f.payload());
    const char=f.session.project.scene.characters[0];
    if(kind==='character') f.session.project.scene.characters.push(structuredClone(char));
    if(kind==='expression') char.expressions.push(structuredClone(char.expressions[0]));
    if(kind==='event') char.expressionEvents.push(structuredClone(char.expressionEvents[0]));
    const p={commandId:'edit',documentId:7,expectedRevision:f.session.revision,characterId:f.characterId,eventId:added.created.eventId,patch:{frame:12,expressionId:f.expressionId}};
    rejected(f,()=>f.commands.editExpressionEventChecked(f.event,p),'AMBIGUOUS_TARGET');
  }
});
test('sender/mainFrame, version, busy and dirty guards; explicit edit allowed',()=>{
  const f=fixture(), c=f.commands,e=f.event;
  for(const bad of [{}, {sender:e.sender}, {...e,sender:{}}, {...e,senderFrame:{}}]) rejected(f,()=>c.dropExpression(bad,f.payload()),'INVALID_SENDER');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),documentId:6}),'DOCUMENT_MISMATCH');
  rejected(f,()=>c.dropExpression(e,{...f.payload(),expectedRevision:0}),'REVISION_MISMATCH');
  for(const [flag,code] of [['busy','BUSY'],['expressionDraftDirty','DIRTY_DRAFT'],['dialoguePageDraftDirty','DIRTY_DRAFT']]) { f.context[flag]=true; rejected(f,()=>c.dropExpression(e,f.payload()),code); f.context[flag]=false; }
  const result=c.dropExpression(e,f.payload()), eventId=result.created.eventId;
  const edit=()=>({commandId:'edit',documentId:7,expectedRevision:f.session.revision,characterId:f.characterId,eventId,patch:{frame:20,expressionId:null}});
  rejected(f,()=>c.editExpressionEventChecked(e,{...edit(),patch:{frame:20,expressionId:null,id:'injected'}}),'INVALID_PAYLOAD');
  rejected(f,()=>c.editExpressionEventChecked(e,{...edit(),eventId:'missing'}),'NOT_FOUND');
  f.context.expressionDraftDirty=true;
  const editPayload=edit(), beforeEdit=f.session.snapshot(), edited=c.editExpressionEventChecked(e,editPayload), afterEdit=f.session.snapshot();
  assert.equal(edited.ok,true); assert.deepEqual(c.editExpressionEventChecked(e,editPayload),edited);
  f.session.undo(); assert.deepEqual(f.session.snapshot(),beforeEdit); rejected(f,()=>c.editExpressionEventChecked(e,editPayload),'COMMAND_STALE');
  f.session.redo(); assert.deepEqual(f.session.snapshot(),afterEdit);
  const del=()=>({commandId:'delete',documentId:7,expectedRevision:f.session.revision,characterId:f.characterId,eventId});
  rejected(f,()=>c.deleteExpressionEventChecked(e,del()),'DIRTY_DRAFT');
  f.context.dialoguePageDraftDirty=true; rejected(f,()=>c.editExpressionEventChecked(e,{...edit(),commandId:'edit2'}),'DIRTY_DRAFT');
  f.context.expressionDraftDirty=f.context.dialoguePageDraftDirty=false;
  const p=del(), deleted=c.deleteExpressionEventChecked(e,p); assert.equal(deleted.ok,true); assert.deepEqual(c.deleteExpressionEventChecked(e,p),deleted);
  f.session.undo(); assert.equal(f.session.project.scene.characters[0].expressionEvents[0].id,eventId); rejected(f,()=>c.deleteExpressionEventChecked(e,p),'COMMAND_STALE');
  f.session.redo(); assert.equal(f.session.project.scene.characters[0].expressionEvents.length,0);
});
test('bounded FIFO cache and document/session replacement reset',()=>{
  const f=fixture(2),c=f.commands,e=f.event,p=f.payload('first');
  c.dropExpression(e,p); c.dropExpression(e,f.payload('second',11)); c.dropExpression(e,f.payload('third',12));
  rejected(f,()=>c.dropExpression(e,p),'REVISION_MISMATCH');
  f.context.documentId++; assert.equal(c.dropExpression(e,f.payload('third',13)).ok,true);
  f.context.session=new ProjectSession(f.session.snapshot()); assert.equal(c.dropExpression(e,f.payload('third',14)).ok,true);
});
test('save/reopen, save-as history/future references and recovery preserve event IDs and resource bytes',async t=>{
  const {saveSessionPortable,openPortable}=require('./project-storage.cjs'), {RecoveryStore}=require('./recovery.cjs');
  const base=fs.mkdtempSync(path.join(__dirname,'../../test-output/P2/s1-command-')); t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const f=fixture(), result=f.commands.dropExpression(f.event,f.payload()), id=result.created.eventId;
  const before=f.session.snapshot(); f.session.undo();
  const saved=await saveSessionPortable(f.session,path.join(__dirname,'..'),path.join(base,'copy/project.json'));
  f.session.project=saved.project; f.session.history=saved.history; f.session.future=saved.future; f.session.redo();
  assert.equal(f.session.project.scene.characters[0].expressionEvents[0].id,id);
  const saved2=await saveSessionPortable(f.session,saved.root,path.join(base,'second/project.json'));
  const reopened=await openPortable(saved2.file), fresh=new ProjectSession(reopened.project);
  assert.equal(fresh.history.length,0); assert.equal(fresh.project.scene.characters[0].expressionEvents[0].id,id);
  for(const resource of fresh.project.resources) { const original=before.resources.find(r=>r.id===resource.id); assert.deepEqual(fs.readFileSync(path.resolve(reopened.root,resource.path)),fs.readFileSync(path.resolve(__dirname,'..',original.path))); }
  const store=new RecoveryStore(path.join(base,'recovery')), draft={text:'{ invalid',baseRevision:0,dirty:true,stale:true};
  store.write({project:reopened.project,revision:f.session.revision,root:reopened.root,draft});
  const restored=store.open(); assert.equal(restored.project.scene.characters[0].expressionEvents[0].id,id); assert.deepEqual(restored.draft,draft);
  for(const r of restored.project.resources) assert.ok(fs.existsSync(path.resolve(restored.root,r.path)));
});
test('actual main IPC registration and preload bridge (VM, not native Electron)',async()=>{
  const handlers={}, context={console,structuredClone,process:{env:{}},__dirname:path.join(__dirname,'..'),setTimeout:()=>0,clearTimeout:()=>{}};
  let exposed; const electron={app:{setPath(){},whenReady:()=>({then(){}}),on(){}},ipcMain:{handle:(name,fn)=>handlers[name]=fn}};
  context.require=name=>name==='electron'?electron:name==='./core/recovery.cjs'?{RecoveryStore:class{},normalizeDraft:x=>x}:require(name.startsWith('.')?path.resolve(__dirname,'..',name):name);
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8')+'\nthis.setup=(s,w)=>{session=s;win=w;documentId=7;};this.flags=(a,b)=>{expressionDraftDirty=a;dialoguePageDraftDirty=b;};',context);
  const f=fixture(); context.setup(f.session,f.context.win);
  assert.equal(handlers['drop-expression']({},f.payload()).error.code,'INVALID_SENDER');
  assert.equal(handlers['drop-expression'](f.event,{...f.payload(),expectedRevision:0}).error.code,'REVISION_MISMATCH');
  const r=handlers['drop-expression'](f.event,f.payload()); assert.equal(r.ok,true);
  context.flags(true,false); assert.throws(()=>handlers.undo(f.event),/表单/); context.flags(false,true); assert.throws(()=>handlers.redo(f.event),/表单/);
  const calls=[]; vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed=api},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
  for(const [method,channel] of [['dropExpression','drop-expression'],['editExpressionEventChecked','edit-expression-event-checked'],['deleteExpressionEventChecked','delete-expression-event-checked']]) { const p={test:true}; exposed[method](p); assert.deepEqual(calls.pop(),[channel,p]); }
});
