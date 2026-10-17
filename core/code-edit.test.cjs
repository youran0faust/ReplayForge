const test = require('node:test');
const assert = require('node:assert/strict');
const {ProjectSession} = require('./session.cjs');
const {applyProjectCode, MAX_CODE_BYTES} = require('./code-edit.cjs');
function fixture() { return {schemaVersion:1,id:'test',locale:'en-US',design:{width:1280,height:720,fps:30},resources:[{id:'wav',kind:'audio',path:'assets/voice.wav',sampleRate:48000},{id:'img',kind:'image',path:'assets/picture.png'}],scene:{durationFrames:300,background:{kind:'color',color:'#000'},characters:[{id:'c',name:'Character',x:0,y:0,width:100,height:200,color:'#fff',visibleFrom:0,visibleTo:300}],dialogues:[{id:'d',speakerId:'c',text:{'en-US':'Hello'},startFrame:0,endFrame:90,revealFrames:30}]}}; }
function submit(s, p, revision=s.revision) { return applyProjectCode(s,{text:JSON.stringify(p),expectedRevision:revision}); }
function unchanged(s, operation, pattern) { const before=JSON.stringify(s); assert.throws(operation,pattern); assert.equal(JSON.stringify(s),before); }

test('whole draft text and character edits are one undoable transaction',()=>{
 const s=new ProjectSession(fixture()),before=s.snapshot(),next=s.snapshot();
 next.scene.dialogues[0].text['en-US']='Changed 台词';next.scene.characters[0].x=123;next.scene.characters[0].name='Edited';next.design.width=1920;
 assert.deepEqual(submit(s,next),{revision:1,changed:true});assert.equal(s.history.length,1);assert.deepEqual(s.snapshot(),next);
 s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),next);
});
test('no-op ignores whitespace and key order, preserves revision, history and redo',()=>{
 const s=new ProjectSession(fixture()),p=s.snapshot();p.scene.characters[0].x=10;submit(s,p);s.undo();
 const before=JSON.stringify(s),p2=s.snapshot(),reordered=Object.fromEntries(Object.entries(p2).reverse());
 assert.deepEqual(applyProjectCode(s,{text:JSON.stringify(reordered,null,4),expectedRevision:s.revision}),{revision:s.revision,changed:false});assert.equal(JSON.stringify(s),before);
});
test('parse errors, envelopes and invalid project data cannot mutate state',()=>{
 const s=new ProjectSession(fixture());
 for(const text of ['{','null','[]','42',JSON.stringify({format:'replay-project',project:fixture(),revision:0})]) unchanged(s,()=>applyProjectCode(s,{text,expectedRevision:0}));
 for(const change of [p=>p.id='other',p=>p.schemaVersion=2,p=>p.design.width=-1,p=>p.scene.characters[0].width=0,p=>p.scene.dialogues[0].endFrame=999,p=>p.scene.dialogues=[null],p=>p.scene.dialogues[0].text['en-US']=42,p=>delete p.scene.characters]) {const p=s.snapshot();change(p);unchanged(s,()=>submit(s,p));}
});
test('strict payload and UTF-8 2 MiB bound',()=>{
 const s=new ProjectSession(fixture()),text=JSON.stringify(s.snapshot());
 for(const payload of [null,[],{}, {text}, {text,expectedRevision:0,extra:1},{text:123,expectedRevision:0},...[undefined,null,'0',-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1].map(expectedRevision=>({text,expectedRevision})),{text:'中'.repeat(Math.ceil(MAX_CODE_BYTES/3)),expectedRevision:0}]) unchanged(s,()=>applyProjectCode(s,payload));
 const exact=text+' '.repeat(MAX_CODE_BYTES-Buffer.byteLength(text)); assert.equal(applyProjectCode(s,{text:exact,expectedRevision:0}).changed,false);
 unchanged(s,()=>applyProjectCode(s,{text:exact+' ',expectedRevision:0}),/2 MiB/);
});
test('stale identical and changed drafts are rejected',()=>{
 const s=new ProjectSession(fixture()),p=s.snapshot();p.scene.characters[0].x=1;submit(s,p);
 unchanged(s,()=>submit(s,s.snapshot(),0),/Stale/);unchanged(s,()=>submit(s,fixture(),0),/Stale/);
});
test('registry insertion, deletion, path and metadata edits are rejected',()=>{
 const s=new ProjectSession(fixture());
 for(const change of [p=>p.resources.push({id:'injected',kind:'image',path:'C:/secret.png'}),p=>p.resources.pop(),p=>p.resources[0].path='../secret.wav',p=>p.resources[0].sampleRate=1,p=>delete p.resources,p=>p.resources.reverse()]) {const p=s.snapshot();change(p);unchanged(s,()=>submit(s,p),/Resource registry/);}
 const p=s.snapshot();p.scene.characters[0].resourceId='img';assert.equal(submit(s,p).changed,true);
 p.scene.characters[0].resourceId='wav';unchanged(s,()=>submit(s,p),/image resource/);
});
test('voice validates full-scene fit, metadata and safe sample boundaries',()=>{
 const s=new ProjectSession(fixture()),p=s.snapshot();p.scene.dialogues[0].voice={resourceId:'wav',durationSamples:480000};submit(s,p);
 for(const change of [p=>p.scene.dialogues[0].startFrame=1,p=>p.scene.dialogues[0].voice.durationSamples=480001,p=>p.scene.dialogues[0].voice.durationSamples=0,p=>p.scene.dialogues[0].voice.durationSamples=1.5,p=>p.scene.dialogues[0].voice.durationSamples=Number.MAX_SAFE_INTEGER,p=>p.scene.dialogues[0].voice.resourceId='img',p=>p.scene.dialogues[0].voice.sampleRate=44100,p=>p.design.fps=29]) {const bad=s.snapshot();change(bad);unchanged(s,()=>submit(s,bad),/voice|Voice/);}
});
test('main IPC and preload expose guarded mutation and notify renderer',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const main=path.join(__dirname,'../main.cjs'),realRequire=require('node:module').createRequire(main),handlers={},notifications=[];
 class Window { constructor(){this.webContents={mainFrame:{},send:(...args)=>notifications.push(args),once(){}};Window.instance=this;} isDestroyed(){return false;} on(){} loadFile(){} }
 const electron={app:{setPath(){},whenReady(){return {then:fn=>fn()};},on(){}},BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers[name]=fn},dialog:{}};
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{__dirname:path.dirname(main),JSON,process,setTimeout:()=>1,clearTimeout(){},require:name=>name==='electron'?electron:name==='./core/recovery.cjs'?{RecoveryStore:class{inspect(){return null;} clear(){}},normalizeDraft:require('./recovery.cjs').normalizeDraft}:realRequire(name)});
 const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame},snapshot=handlers.project().project;
 snapshot.scene.characters[0].x+=1;
 const payload={text:JSON.stringify(snapshot),expectedRevision:0};
 assert.throws(()=>handlers['apply-project-code']({sender:{}},payload),/窗口/);
 assert.throws(()=>handlers['apply-project-code']({...event,senderFrame:{}},payload),/主窗口/);
 assert.deepEqual(handlers['apply-project-code'](event,payload),{revision:1,changed:true});
 assert.equal(notifications.at(-1)[0],'state');assert.equal(notifications.at(-1)[3],1);
 assert.deepEqual(handlers.project().project,snapshot);
 let bridge,invocation;
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,api)=>bridge=api},ipcRenderer:{invoke:(...args)=>invocation=args}})});
 bridge.applyProjectCode(payload);assert.deepEqual(invocation,['apply-project-code',payload]);
});
test('schema4 code edits keep definition speakers and resource registry protected',()=>{
 const {upgradeCharacters,upgradeCharacters4}=require('./schema-migration.cjs'),s=new ProjectSession(upgradeCharacters4(upgradeCharacters(fixture()))),before=s.snapshot(),p=s.snapshot();
 p.characterDefinitions[0].resourceId='img';p.characterDefinitions[0].expressions=[{id:'smile',name:'Smile',resourceId:'img'}];p.scene.characters[0].expressionEvents=[{id:'event',frame:10,expressionId:'smile'}];
 assert.equal(submit(s,p).changed,true);assert.equal(s.project.scene.dialogues[0].speakerId,p.characterDefinitions[0].id);assert.deepEqual(s.project.resources,before.resources);
 const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
 for(const change of [q=>q.characterDefinitions[0].resourceId='wav',q=>q.characterDefinitions[0].expressions[0].resourceId='wav',q=>q.scene.dialogues[0].speakerId=q.scene.characters[0].id,q=>q.schemaVersion=3,q=>q.resources[1].path='../outside.png',q=>q.resources.push({id:'injected',kind:'image',path:'new.png'})]){const q=s.snapshot();change(q);unchanged(s,()=>submit(s,q));}
 unchanged(s,()=>submit(s,s.snapshot(),0),/Stale/);
});
test('unknown fields remain supported by existing permissive validation',()=>{
 const s=new ProjectSession(fixture()),p=s.snapshot();p.custom={note:'preserved'};submit(s,p);assert.deepEqual(s.snapshot().custom,p.custom);
});
