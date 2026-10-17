'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(legacy=false){
 const root=path.resolve(__dirname,'..'),handlers={},messages=[];
 const p=JSON.parse(fs.readFileSync(path.join(root,'examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,'')),m=require('./schema-migration.cjs'),project=legacy?p:m.upgradeCharacters4(m.upgradeCharacters(p));
 if(!legacy)project.scene.performance={version:1,...(project.scene.performance||{}),screenFades:[{id:'fade',startFrame:0,endFrame:10,from:0,to:1}]};
 const s=new (require('./session.cjs').ProjectSession)(project),web={mainFrame:{},send(){},isDestroyed:()=>false},win={webContents:web,isDestroyed:()=>false};
 const electron={app:{setPath(){},whenReady:()=>({then(){}}),on(){}},ipcMain:{handle:(k,v)=>handlers[k]=v},dialog:{showMessageBox:async(_w,p)=>{messages.push(p);return {response:0};}}};
 const c=vm.createContext({console,structuredClone,process:{env:{}},__dirname:root,setTimeout:()=>0,clearTimeout(){},require:n=>n==='electron'?electron:n==='./core/recovery.cjs'?{RecoveryStore:class{clear(){}},normalizeDraft:x=>x}:require(n.startsWith('.')?path.resolve(root,n):n)});
 vm.runInContext(fs.readFileSync(path.join(root,'main.cjs'),'utf8')+'\nthis.setup=(s,w)=>{session=s;win=w;documentId=7;};this.inspect=()=>({dirty:isDirty(),status:recoveryStatus(),s3:s3Context(),legacy:legacyS3Context(),extension:extensionContext(),draftVersion});this.discard=()=>confirmDiscard(capture());this.install=p=>installProject({project:p,root:__dirname,file:null},0);this.flag=(name,value)=>eval(name+"=value");',c);c.setup(s,win);
 const event={sender:web,senderFrame:web.mainFrame};return {s,c,handlers,event,messages,project,mark(dirty){return handlers['update-scene-performance-draft-status'](event,{documentId:7,dirty});},payload(){return {commandId:'scene-update',documentId:7,expectedRevision:s.revision,kind:'screenFades',id:'fade',changes:{endFrame:12}};}};
}
test('preload exposes narrow scene channels',()=>{let api;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,a)=>api=a},ipcRenderer:{invoke:(...a)=>calls.push(a)}})});const p={documentId:7,dirty:true};api.updateScenePerformanceDraftStatus(p);api.updateScenePerformance(p);assert.deepEqual(calls,[['update-scene-performance-draft-status',p],['update-scene-performance',p]]);});
test('strict main-frame status and independent owner',()=>{
 const f=fixture(),h=f.handlers['update-scene-performance-draft-status'];for(const event of [{},{sender:f.event.sender},{...f.event,senderFrame:{}}])assert.throws(()=>h(event,{documentId:7,dirty:true}),/主窗口/);
 const getter={documentId:7};Object.defineProperty(getter,'dirty',{enumerable:true,get(){throw Error('getter executed');}});
 for(const p of [null,[],{documentId:6,dirty:true},{documentId:7,dirty:1},{documentId:7,dirty:true,x:1},{documentId:7,dirty:true,[Symbol()]:1},getter,Object.create({documentId:7,dirty:true})])assert.throws(()=>h(f.event,p),/字段|旧工程/);
 assert.equal(f.c.inspect().dirty,false);f.mark(true);const v=f.c.inspect().draftVersion;f.mark(true);assert.equal(f.c.inspect().draftVersion,v);assert.equal(f.c.inspect().status.scenePerformanceDraftDirty,true);assert.equal(f.c.inspect().s3.characterPerformanceDraftDirty,false);assert.equal(f.c.inspect().legacy.dialoguePageDraftDirty,true);assert.equal(f.c.inspect().extension.dialoguePageDraftDirty,true);
});
test('own dirty permits update; all foreign owners reject atomically',()=>{
 const f=fixture();f.mark(true);const r=f.handlers['update-scene-performance'](f.event,f.payload());assert.equal(r.ok,true,JSON.stringify(r));
 for(const owner of ['expressionDraftDirty','dialoguePageDraftDirty','mediaDraftDirty','extensionDraftDirty','voiceClipDraftDirty','componentDraftDirty','characterDefinitionDraftDirty','textImportDraftDirty','characterPerformanceDraftDirty','codeDraft']){f.c.flag(owner,owner==='codeDraft'?{dirty:true}:true);const before=f.s.snapshot();assert.equal(f.handlers['update-scene-performance'](f.event,{...f.payload(),commandId:owner}).error.code,'DIRTY_DRAFT',owner);assert.deepEqual(f.s.snapshot(),before);f.c.flag(owner,owner==='codeDraft'?null:false);}
});
test('scene dirty gates saves, exports, imports, legacy mutations and discard',async()=>{
 const f=fixture();f.mark(true);assert.equal(f.c.inspect().dirty,true);
 for(const channel of ['save','save-as','export-current','export-script-return-package','import-voice','import-audio-track','import-expression-image','import-image','import-component-pack','import-character-library-image'])await assert.rejects(async()=>f.handlers[channel](f.event,{documentId:7,expectedRevision:0}),/应用|草稿/);
 for(const channel of ['undo','redo','add-character','apply-project-code','edit-dialogue','set-locale'])assert.throws(()=>f.handlers[channel](f.event),/应用/);
 assert.equal(await f.c.discard(),false);assert.match(f.messages[0].detail,/未应用/);assert.equal(f.s.revision,0);f.mark(false);assert.equal(f.c.inspect().dirty,false);
});
test('legacy mutation owner matrix rejects foreign drafts and preserves own submissions',()=>{
 const cases=[['set-portrait-canvas','expressionDraftDirty'],['add-expression','expressionDraftDirty'],['edit-expression','expressionDraftDirty'],['add-expression-event','expressionDraftDirty'],['edit-expression-event','expressionDraftDirty'],['edit-dialogue','dialoguePageDraftDirty'],['edit-dialogue-page','dialoguePageDraftDirty'],['set-dialogue-pages','dialoguePageDraftDirty'],['apply-project-code','codeDraft'],...['set-locale','move-character','edit-character','add-character','delete-character','add-dialogue','delete-dialogue','move-dialogue','set-dialogue-speaker','add-dialogue-page','delete-dialogue-page','delete-expression','edit-audio-track','edit-timeline','undo','redo'].map(k=>[k,null])];
 const owners=['expressionDraftDirty','dialoguePageDraftDirty','mediaDraftDirty','extensionDraftDirty','voiceClipDraftDirty','componentDraftDirty','characterDefinitionDraftDirty','textImportDraftDirty','characterPerformanceDraftDirty','scenePerformanceDraftDirty','codeDraft'];
 const f=fixture();
 for(const [channel,allowed] of cases)for(const owner of owners){f.c.flag(owner,owner==='codeDraft'?{dirty:true}:true);if(owner!==allowed){const before=f.s.snapshot(),revision=f.s.revision;assert.throws(()=>f.handlers[channel](f.event),/其他表单或代码草稿/,channel+' '+owner);assert.deepEqual(f.s.snapshot(),before);assert.equal(f.s.revision,revision);}else assert.doesNotThrow(()=>vm.runInContext('requireMutationDrafts('+JSON.stringify(channel)+')',f.c));f.c.flag(owner,owner==='codeDraft'?null:false);}
});
test('legacy actual apply keeps expression, dialogue and code own drafts usable',()=>{
 const f=fixture(true),cid=f.s.project.scene.characters[0].id,did=f.s.project.scene.dialogues[0].id;
 f.c.flag('expressionDraftDirty',true);const event=f.handlers['add-expression-event'](f.event,cid,{frame:0,expressionId:null});assert.ok(event.id);f.handlers['set-portrait-canvas'](f.event,cid,{width:400,height:500});f.c.flag('expressionDraftDirty',false);
 f.c.flag('dialoguePageDraftDirty',true);f.handlers['edit-dialogue'](f.event,did,{...f.s.project.scene.dialogues[0],text:'owner text'});assert.equal(f.s.project.scene.dialogues[0].text[f.s.project.locale],'owner text');f.c.flag('dialoguePageDraftDirty',false);
 f.c.flag('codeDraft',{dirty:true});const p=f.s.snapshot();p.locale='en-US';f.handlers['apply-project-code'](f.event,{text:JSON.stringify(p),expectedRevision:f.s.revision});assert.equal(f.s.project.locale,'en-US');f.c.flag('codeDraft',null);
 f.handlers['set-locale'](f.event,'zh-CN');assert.equal(f.s.project.locale,'zh-CN');
});
test('installation resets scene draft and old command cache',()=>{const f=fixture();f.mark(true);assert.equal(f.handlers['update-scene-performance'](f.event,f.payload()).ok,true);f.c.install(f.project);assert.equal(f.c.inspect().status.scenePerformanceDraftDirty,false);assert.equal(f.c.inspect().dirty,false);assert.throws(()=>f.mark(true),/旧工程/);assert.equal(f.handlers['update-scene-performance'](f.event,f.payload()).error.code,'DOCUMENT_MISMATCH');const r=f.handlers['update-scene-performance'](f.event,{...f.payload(),documentId:8,expectedRevision:0});assert.equal(r.ok,true,JSON.stringify(r));});
