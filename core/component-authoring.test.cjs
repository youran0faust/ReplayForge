'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ProjectSession}=require('./session.cjs');
const {createComponentCommands}=require('./component-command.cjs');
const {componentErrors,validateDefinition}=require('./components-model.cjs');
function fixture(options={},input){
 const project=input||{schemaVersion:1,id:'author',locale:'zh-CN',design:{width:960,height:540,fps:30},resources:[],scene:{id:'scene',durationFrames:60,characters:[],dialogues:[]}};
 const session=new ProjectSession(project),win={isDestroyed:()=>false,webContents:{mainFrame:{}}},context={session,win,documentId:7},event={sender:win.webContents,senderFrame:win.webContents.mainFrame};let serial=0;
 const commands=createComponentCommands({getContext:()=>context,...options}),envelope=()=>({commandId:'c'+serial++,documentId:context.documentId,expectedRevision:context.session.revision});
 const call=(method,body)=>commands[method](event,{...envelope(),...body});
 const create=(type='panel',x=10,y=20)=>{const r=call('createComponent',{type,atFrame:0,x,y});assert.equal(r.ok,true,JSON.stringify(r));return r.created.instanceId;};
 return {session,context,event,commands,envelope,call,create};
}
function schema4Fixture(){return {schemaVersion:4,id:'author4',locale:'zh-CN',design:{width:960,height:540,fps:30},resources:[{id:'png',kind:'image',mime:'image/png',path:'assets/image.png'},{id:'audio',kind:'audio',mime:'audio/wav',path:'assets/voice.wav',sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:48000}],characterDefinitions:[{id:'offstage',name:'画外音',color:'#ffffff'}],scene:{id:'scene',durationFrames:90,characters:[],dialogues:[{id:'d',speakerId:'offstage',startFrame:0,endFrame:30,displayUntilFrame:60,revealFrames:1,text:{'zh-CN':'保留字幕'},voiceClips:[]}]}};}
test('schema4 upgradeCandidate is an identity-preserving no-op and never calls legacy upgrade',()=>{
 const {upgradeCandidate}=require('./components.cjs'),p=schema4Fixture(),before=structuredClone(p),dialogue=p.scene.dialogues[0];
 upgradeCandidate(p,()=>{throw Error('must not downgrade');});assert.deepEqual(p,before);assert.equal(p.scene.dialogues[0],dialogue);
});
test('schema4 create image atFrame uses existing command with atomic undo redo preserving offstage hold',()=>{
 const f=fixture({upgradeProject(){throw Error('must not downgrade');}},schema4Fixture()),before=f.session.snapshot();
 const r=f.call('createComponent',{type:'image',resourceId:'png',atFrame:17,x:12,y:34});assert.equal(r.ok,true,JSON.stringify(r));
 const after=f.session.snapshot(),i=after.scene.components[0],d=after.componentDefinitions[0];
 assert.equal(after.schemaVersion,4);assert.equal(f.session.revision,1);assert.equal(f.session.history.length,1);assert.equal(i.id,r.created.instanceId);assert.equal(i.definitionId,r.created.definitionId);assert.equal(i.visibleFrom,17);assert.equal(i.visibleTo,90);assert.equal(i.x,12);assert.equal(i.y,34);assert.equal(d.kind,'decoration');assert.equal(d.visibility,'instance-range');assert.equal(d.elements[0].type,'image');assert.equal(d.elements[0].resourceId,'png');assert.deepEqual(after.scene.dialogues,before.scene.dialogues);assert.deepEqual(after.characterDefinitions,before.characterDefinitions);assert.deepEqual(componentErrors(after),[]);
 const {evaluateComponents}=require('./components-model.cjs');assert.equal(evaluateComponents(after,16).length,0);assert.equal(evaluateComponents(after,17).length,1);assert.equal(evaluateComponents(after,89).length,1);assert.equal(evaluateComponents(after,90).length,0);
 f.session.undo();assert.deepEqual(f.session.snapshot(),before);f.session.redo();assert.deepEqual(f.session.snapshot(),after);assert.equal(f.session.evaluate(40).dialogues[0].held,true);
});
test('schema4 wrong image resource kind and atFrame failures leave project history and redo atomic',()=>{
 const f=fixture({},schema4Fixture());assert.equal(f.call('createComponent',{type:'image',resourceId:'png',atFrame:5,x:0,y:0}).ok,true);f.session.undo();
 const before=f.session.snapshot(),revision=f.session.revision,history=structuredClone(f.session.history),future=structuredClone(f.session.future);
 for(const body of [{resourceId:'audio',atFrame:0},{resourceId:'absent',atFrame:0},{resourceId:'png',atFrame:90},{resourceId:'png',atFrame:-1},{resourceId:'png',atFrame:1.5}]){const r=f.call('createComponent',{type:'image',x:0,y:0,...body});assert.equal(r.ok,false,JSON.stringify(r));assert.deepEqual(f.session.snapshot(),before);assert.equal(f.session.revision,revision);assert.deepEqual(f.session.history,history);assert.deepEqual(f.session.future,future);}
 f.session.redo();assert.equal(f.session.snapshot().scene.components.length,1);assert.deepEqual(f.session.snapshot().scene.dialogues,before.scene.dialogues);
});
test('componentErrors validates schema4 directly without schema substitution',()=>{
 const f=fixture({},schema4Fixture());assert.equal(f.call('createComponent',{type:'image',resourceId:'png',atFrame:10,x:0,y:0}).ok,true);const p=f.session.snapshot(),before=structuredClone(p);assert.deepEqual(componentErrors(p),[]);assert.deepEqual(p,before);
 const wrong=structuredClone(p);wrong.componentDefinitions[0].elements[0].resourceId='audio';assert.ok(componentErrors(wrong).some(e=>e.includes('PNG/JPEG')));
 const range=structuredClone(p);range.scene.components[0].visibleTo=91;assert.ok(componentErrors(range).length);
 for(const schemaVersion of [1,5])assert.ok(componentErrors({...p,schemaVersion}).length);assert.equal(p.schemaVersion,4);
});
test('factory independent definitions, literal text, image validation and one upgrade undo/redo',()=>{
 let upgrades=0;const f=fixture({upgradeProject(p){upgrades++;return require('./schema-migration.cjs').upgradeProject(p);}}),before=f.session.snapshot();f.create('text');assert.equal(upgrades,1);assert.equal(f.session.revision,1);assert.equal(f.session.history.length,1);assert.equal(f.session.project.componentDefinitions[0].elements[0].text,'文字');const after=f.session.snapshot();f.session.undo();assert.deepEqual(f.session.snapshot(),before);f.session.redo();assert.deepEqual(f.session.snapshot(),after);f.create();f.create();assert.equal(new Set(f.session.project.scene.components.map(i=>i.definitionId)).size,3);assert.equal(upgrades,1);
 const checkpoint=f.session.snapshot(),revision=f.session.revision;assert.equal(f.call('createComponent',{type:'image',atFrame:0,x:0,y:0,resourceId:'absent'}).ok,false);assert.deepEqual(f.session.snapshot(),checkpoint);assert.equal(f.session.revision,revision);
 f.session.apply(p=>p.resources.push({id:'png',kind:'image',mime:'image/png',path:'assets/image.png'}));assert.equal(f.call('createComponent',{type:'image',atFrame:0,x:0,y:0,resourceId:'png'}).ok,true);
});
test('full definition validation and copy-on-write leave shared sibling unchanged',()=>{
 const f=fixture(),a=f.create(),original=f.session.project.componentDefinitions[0],b=f.call('addComponent',{definitionId:original.id,atFrame:0,x:40,y:20}).created.instanceId;
 const definition={...structuredClone(original),name:'changed'};definition.elements[0].fill='#ff0000';const before=f.session.snapshot(),r=f.call('editComponentDefinition',{instanceId:a,definition});assert.equal(r.ok,true,JSON.stringify(r));assert.notEqual(r.updated.definitionId,original.id);assert.equal(f.session.project.scene.components.find(i=>i.id===b).definitionId,original.id);assert.deepEqual(f.session.project.componentDefinitions[0],original);const after=f.session.snapshot();f.session.undo();assert.deepEqual(f.session.snapshot(),before);f.session.redo();assert.deepEqual(f.session.snapshot(),after);
 const current=structuredClone(f.session.project.componentDefinitions.at(-1));current.elements[0].html='unsafe';assert.equal(f.call('editComponentDefinition',{instanceId:a,definition:current}).ok,false);assert.deepEqual(f.session.snapshot(),after);
});
test('legacy roles default and explicit subsets, role rejection, singleton and nesting validation',()=>{
 const f=fixture();f.create();const d={...f.session.project.componentDefinitions[0],kind:'dialogue-ui'};assert.doesNotThrow(()=>validateDefinition(d,[]));for(const roles of [[],['body'],['speaker'],['body','speaker']])assert.doesNotThrow(()=>validateDefinition({...d,roles},[]));for(const roles of [['body','body'],['invalid'],'body',undefined])assert.throws(()=>validateDefinition({...d,roles},[]));assert.throws(()=>validateDefinition({...d,kind:'decoration',roles:['body']},[]));
 const bad=f.session.snapshot();bad.scene.components[0].groupId='singleton';assert(componentErrors(bad).length);delete bad.scene.components[0].groupId;bad.scene.components[0].parentId='nested';assert(componentErrors(bad).length);
 const instanceId=f.session.project.scene.components[0].id;assert.equal(f.call('editComponentDefinition',{instanceId,definition:d}).ok,false);assert.equal(f.call('editComponentDefinition',{instanceId,definition:{...d,roles:['body']}}).ok,true);
});
test('absolute groups reject partial edit/delete/nesting; union bbox transform atomic rollback and locks',()=>{
 const f=fixture(),a=f.create('panel',30,70),b=f.create('text',-10,20),ids=[a,b];const r=f.call('groupComponents',{instanceIds:ids});assert.equal(r.ok,true);const groupId=r.created.groupId;assert.deepEqual(f.session.project.scene.components.map(i=>[i.x,i.y]),[[30,70],[-10,20]]);
 for(const [method,body] of [['groupComponents',{instanceIds:ids}],['deleteComponent',{instanceId:a}],['editComponent',{instanceId:a,patch:{x:1}}],['transformComponents',{instanceIds:[a],dx:1,dy:0,scale:1}]])assert.equal(f.call(method,body).ok,false);
 const before=f.session.snapshot(),revision=f.session.revision;assert.equal(f.call('transformComponents',{instanceIds:ids,dx:7,dy:-3,scale:2}).ok,true);assert.equal(f.session.revision,revision+1);assert.deepEqual(f.session.project.scene.components.map(i=>[i.x,i.y,i.width,i.height]),[[77,117,480,320],[-3,17,640,160]]);f.session.undo();assert.deepEqual(f.session.snapshot(),before);f.session.redo();const transformed=f.session.snapshot(),rev=f.session.revision;
 for(const body of [{instanceIds:ids,dx:0,dy:0,scale:1e10},{instanceIds:ids,dx:NaN,dy:0,scale:1},{instanceIds:[a,a],dx:0,dy:0,scale:1},{instanceIds:ids,dx:0,dy:0,scale:0}]){assert.equal(f.call('transformComponents',body).ok,false);assert.deepEqual(f.session.snapshot(),transformed);assert.equal(f.session.revision,rev);}
 assert.equal(f.call('editComponent',{instanceId:a,patch:{locked:true,zIndex:2}}).ok,true);assert.equal(f.call('transformComponents',{instanceIds:ids,dx:1,dy:0,scale:1}).error.code,'COMPONENT_LOCKED');assert.equal(f.call('editComponentDefinition',{instanceId:b,definition:f.session.project.componentDefinitions[1]}).error.code,'COMPONENT_LOCKED');assert.equal(f.call('ungroupComponents',{groupId}).ok,true);assert(f.session.project.scene.components.every(i=>!Object.hasOwn(i,'groupId')));assert.equal(f.call('deleteComponent',{instanceId:b}).ok,true);
});
test('sender stale dirty ownership and document cache isolation',()=>{
 const f=fixture(),payload={...f.envelope(),type:'panel',atFrame:0,x:0,y:0};assert.equal(f.commands.createComponent({},payload).error.code,'INVALID_SENDER');const result=f.commands.createComponent(f.event,payload);assert.equal(result.ok,true);assert.deepEqual(f.commands.createComponent(f.event,payload),result);assert.equal(f.commands.createComponent(f.event,{...payload,x:1}).error.code,'COMMAND_ID_REUSED');f.create();assert.equal(f.commands.createComponent(f.event,payload).error.code,'COMMAND_STALE');assert.equal(f.call('createComponent',{type:'panel',atFrame:0,x:0,y:0,expectedRevision:0}).error.code,'REVISION_MISMATCH');
 const instanceId=result.created.instanceId,definition=f.session.project.componentDefinitions[0];f.context.extensionDraftDirty=true;assert.equal(f.call('editComponentDefinition',{instanceId,definition}).error.code,'DIRTY_DRAFT');f.context.componentDraftDirty=true;f.context.voiceClipDraftDirty=false;assert.equal(f.call('editComponentDefinition',{instanceId,definition}).ok,true);assert.equal(f.call('groupComponents',{instanceIds:f.session.project.scene.components.map(i=>i.id)}).error.code,'DIRTY_DRAFT');f.context.voiceClipDraftDirty=true;assert.equal(f.call('editComponentDefinition',{instanceId,definition}).error.code,'DIRTY_DRAFT');
 f.context.extensionDraftDirty=false;f.context.componentDraftDirty=false;f.context.voiceClipDraftDirty=false;f.context.documentId++;assert.equal(f.commands.createComponent(f.event,payload).error.code,'DOCUMENT_MISMATCH');assert.equal(f.commands.createComponent(f.event,{...payload,documentId:f.context.documentId,expectedRevision:f.session.revision}).ok,true);
});
test('whole-group transform applies own component draft but blocks foreign and unknown dirty owners',()=>{
 const f=fixture(),instanceIds=[f.create(),f.create('text')];assert.equal(f.call('groupComponents',{instanceIds}).ok,true);const payload={instanceIds,dx:5,dy:7,scale:1.2};
 f.context.componentDraftDirty=true;f.context.voiceClipDraftDirty=false;f.context.extensionDraftDirty=true;assert.equal(f.call('transformComponents',payload).ok,true);
 const before=f.session.snapshot(),revision=f.session.revision;
 for(const key of ['voiceClipDraftDirty','expressionDraftDirty','dialoguePageDraftDirty','mediaDraftDirty']){f.context[key]=true;assert.equal(f.call('transformComponents',payload).error.code,'DIRTY_DRAFT');f.context[key]=false;}
 delete f.context.voiceClipDraftDirty;assert.equal(f.call('transformComponents',payload).error.code,'DIRTY_DRAFT');assert.deepEqual(f.session.snapshot(),before);assert.equal(f.session.revision,revision);
});
test('portable save and relocated recovery preserve groups, roles, COW and historical image references',t=>{
 const fs=require('fs'),path=require('path'),{createHash}=require('crypto');
 const {saveSessionPortable,openPortable}=require('./project-storage.cjs'),{RecoveryStore}=require('./recovery.cjs'),{clone,validateProject}=require('./model.cjs');
 const output=path.resolve(__dirname,'../../test-output/P2');fs.mkdirSync(output,{recursive:true});const base=fs.mkdtempSync(path.join(output,'authoring-recovery-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const root=path.join(base,'source');fs.mkdirSync(root);const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');fs.writeFileSync(path.join(root,'image.png'),png);
 const f=fixture();f.context.projectRoot=root;f.session.apply(p=>p.resources.push({id:'image',kind:'image',mime:'image/png',path:'image.png'}));
 const created=f.call('createComponent',{type:'image',resourceId:'image',atFrame:0,x:10,y:20});assert.equal(created.ok,true);const a=created.created.instanceId,oldDefinitionId=created.created.definitionId;
 const b=f.call('addComponent',{definitionId:oldDefinitionId,atFrame:0,x:300,y:40}).created.instanceId;
 const grouped=f.call('groupComponents',{instanceIds:[a,b]});assert.equal(grouped.ok,true);const groupId=grouped.created.groupId;
 const definition={...structuredClone(f.session.project.componentDefinitions[0]),kind:'dialogue-ui',roles:['speaker'],name:'speaker image'};
 const edited=f.call('editComponentDefinition',{instanceId:a,definition});assert.equal(edited.ok,true);const newDefinitionId=edited.updated.definitionId;
 const committed=clone(f.session.project);assert.deepEqual(committed,f.session.snapshot());assert.equal(committed.scene.components[0].groupId,groupId);assert.equal(committed.scene.components[1].definitionId,oldDefinitionId);assert.notEqual(newDefinitionId,oldDefinitionId);
 const saved=saveSessionPortable(f.session,root,path.join(base,'portable','project.json')),opened=openPortable(saved.file);
 assert.deepEqual(opened.project.scene.components,committed.scene.components);assert.deepEqual(opened.project.componentDefinitions,committed.componentDefinitions);assert.deepEqual(validateProject(opened.project),[]);
 // Portable-save history is returned separately from the manifest, as in the real session save path.
 const portableSession=new ProjectSession(saved.project);portableSession.history=saved.history;portableSession.future=saved.future;portableSession.revision=saved.revision;
 portableSession.undo();assert.equal(portableSession.project.scene.components[0].definitionId,oldDefinitionId);assert.equal(portableSession.project.scene.components[0].groupId,groupId);assert(!portableSession.project.componentDefinitions.some(d=>d.id===newDefinitionId));portableSession.redo();assert.deepEqual(portableSession.snapshot(),saved.project);
 const draft={text:'{ invalid authoring draft',baseRevision:saved.revision-1,dirty:true,stale:true},store=new RecoveryStore(path.join(base,'recovery'));
 store.write({root:saved.root,project:saved.project,revision:saved.revision,draft});const moved=path.join(base,'moved-recovery');fs.renameSync(store.root,moved);fs.rmSync(root,{recursive:true});fs.rmSync(saved.root,{recursive:true});
 const restored=new RecoveryStore(moved).open();assert.equal(restored.revision,saved.revision);assert.deepEqual(restored.draft,draft);assert.deepEqual(validateProject(restored.project),[]);assert.deepEqual(restored.project.componentDefinitions,committed.componentDefinitions);assert.deepEqual(restored.project.scene.components,committed.scene.components);assert.deepEqual(restored.project.componentDefinitions.find(d=>d.id===newDefinitionId).roles,['speaker']);
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');for(const d of restored.project.componentDefinitions)for(const e of d.elements)if(e.type==='image'){const resource=restored.project.resources.find(r=>r.id===e.resourceId);assert(resource);assert.equal(hash(fs.readFileSync(path.join(restored.root,resource.path))),hash(png));}
});
test('factory legacy verification failure rolls back; verified clone upgrades once',()=>{
 const f=fixture({verifyProjectVoices(){throw Error('voice invalid');}});f.session.project.scene.dialogues.push({voice:{resourceId:'missing'}});const before=f.session.snapshot();assert.equal(f.call('createComponent',{type:'panel',atFrame:0,x:0,y:0}).ok,false);assert.deepEqual(f.session.snapshot(),before);assert.equal(f.session.revision,0);
 let verifications=0,upgrades=0;const g=fixture({verifyProjectVoices(p){verifications++;const next=structuredClone(p);next.scene.dialogues=[];return next;},upgradeProject(p){upgrades++;assert.deepEqual(p.scene.dialogues,[]);return require('./schema-migration.cjs').upgradeProject(p);}});g.session.project.scene.dialogues.push({voice:{resourceId:'missing'}});g.create();assert.equal(verifications,1);assert.equal(upgrades,1);assert.equal(g.session.revision,1);
});
