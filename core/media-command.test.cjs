const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm'), {createHash} = require('crypto');
const {ProjectSession} = require('./session.cjs');
const {createMediaCommands} = require('./media-command.cjs');
function wav(samples=4800, channels=1) {
  const b=Buffer.alloc(44+samples*channels*2); b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(48000*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function fixture(t,cacheLimit=256) {
  const root=fs.mkdtempSync(path.join(__dirname,'../../test-output/P2/s2-command-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'sound.wav'),wav());fs.writeFileSync(path.join(root,'image.png'),png);
  const p={schemaVersion:1,id:'test',locale:'zh-CN',design:{width:960,height:540,fps:30},resources:[{id:'a',kind:'audio',path:'sound.wav'},{id:'i',kind:'image',path:'image.png'}],scene:{id:'scene',durationFrames:60,background:{kind:'color',color:'#000000'},characters:[],dialogues:[]}};
  const session=new ProjectSession(p),win={isDestroyed:()=>false,webContents:{mainFrame:{},send(){}}};
  const context={session,win,documentId:7,projectRoot:root};const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const commands=createMediaCommands({getContext:()=>context,decodeImage:()=>({width:1,height:1}),cacheLimit});
  let serial=0;const envelope=()=>({commandId:'cmd'+serial++,documentId:context.documentId,expectedRevision:context.session.revision});
  const audio=(extra={})=>({...envelope(),resourceId:'a',kind:'bgm',atFrame:0,...extra});
  const bg=(extra={})=>({...envelope(),resourceId:'i',atFrame:10,...extra});
  return {root,session,context,event,commands,envelope,audio,bg};
}
function reject(f,fn,code) {const before=JSON.stringify(f.context.session);const r=fn();assert.equal(r.ok,false,JSON.stringify(r));if(code)assert.equal(r.error.code,code);assert.equal(JSON.stringify(f.context.session),before);return r;}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('audio real source, legacy metadata, one transaction, overlap, idempotency, undo redo and no file writes',t=>{
  const f=fixture(t),s=f.session,c=f.commands,e=f.event,p=f.audio(),before=s.snapshot();const files=fs.readdirSync(f.root),hashes=files.map(x=>hash(path.join(f.root,x)));
  const r=c.dropAudioResource(e,p);assert.equal(r.ok,true);assert.equal(s.revision,1);assert.equal(s.history.length,1);
  assert.deepEqual(s.project.scene.audioTracks[0],{id:r.created.audioTrackId,name:'a',kind:'bgm',resourceId:'a',startFrame:0,sourceOffsetSamples:0,durationSamples:4800,gain:1});
  assert.equal(s.project.resources[0].sampleRate,48000);assert.equal(s.project.resources[0].durationSamples,4800);assert.deepEqual(c.dropAudioResource(e,p),r);
  reject(f,()=>c.dropAudioResource(e,{...p,kind:'sfx'}),'COMMAND_ID_REUSED');const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),before);reject(f,()=>c.dropAudioResource(e,p),'COMMAND_STALE');s.redo();assert.deepEqual(s.snapshot(),after);
  assert.equal(c.dropAudioResource(e,f.audio()).ok,true);assert.equal(s.project.scene.audioTracks.length,2);assert.deepEqual(s.project.scene.dialogues,[]);
  assert.deepEqual(fs.readdirSync(f.root),files);assert.deepEqual(files.map(x=>hash(path.join(f.root,x))),hashes);
});
test('strict sender, document, version, fields, dirty, frame and kind guards',t=>{
  const f=fixture(t),c=f.commands,e=f.event;
  for(const bad of [{},{sender:e.sender},{...e,sender:{}},{...e,senderFrame:{}}])reject(f,()=>c.dropAudioResource(bad,f.audio()),'INVALID_SENDER');
  reject(f,()=>c.dropAudioResource(e,f.audio({documentId:6})),'DOCUMENT_MISMATCH');reject(f,()=>c.dropAudioResource(e,f.audio({expectedRevision:1})),'REVISION_MISMATCH');
  for(const extra of [{path:'sound.wav'},{kind:'voice'},{commandId:''},{atFrame:-1},{atFrame:60},{atFrame:0.5},{resourceId:null}])reject(f,()=>c.dropAudioResource(e,f.audio(extra)));
  for(const flag of ['busy','mediaDraftDirty','expressionDraftDirty','dialoguePageDraftDirty']){f.context[flag]=true;reject(f,()=>c.dropAudioResource(e,f.audio()),flag==='busy'?'BUSY':'DIRTY_DRAFT');f.context[flag]=false;}
  reject(f,()=>c.dropAudioResource(e,f.audio({atFrame:58})),'AUDIO_OUT_OF_RANGE');
  f.session.project.resources.push({...f.session.project.resources[0]});reject(f,()=>c.dropAudioResource(e,f.audio()),'AMBIGUOUS_TARGET');
});
test('missing, bad WAV, real metadata mismatch, size bound and controlled paths reject atomically',t=>{
  const f=fixture(t),r=f.session.project.resources[0],c=f.commands,e=f.event;
  r.path='missing.wav';reject(f,()=>c.dropAudioResource(e,f.audio()),'RESOURCE_MISSING');r.path='../outside.wav';reject(f,()=>c.dropAudioResource(e,f.audio()),'RESOURCE_PATH');r.path=path.join(f.root,'sound.wav');reject(f,()=>c.dropAudioResource(e,f.audio()),'RESOURCE_PATH');r.path='sound.wav';
  for(const bytes of [Buffer.from('bad'),wav().subarray(0,48),(()=>{const b=wav();b.writeUInt32LE(44100,24);return b;})()]) {fs.writeFileSync(path.join(f.root,r.path),bytes);reject(f,()=>c.dropAudioResource(e,f.audio()),'INVALID_AUDIO');}
  fs.writeFileSync(path.join(f.root,r.path),wav(4800,2));r.channels=1;reject(f,()=>c.dropAudioResource(e,f.audio()),'AUDIO_METADATA_MISMATCH');delete r.channels;r.durationSamples=1;reject(f,()=>c.dropAudioResource(e,f.audio()),'AUDIO_METADATA_MISMATCH');delete r.durationSamples;
  const fd=fs.openSync(path.join(f.root,r.path),'r+');fs.ftruncateSync(fd,256*1024*1024+1);fs.closeSync(fd);reject(f,()=>c.dropAudioResource(e,f.audio()),'RESOURCE_TOO_LARGE');
  fs.writeFileSync(path.join(f.root,r.path),wav(4800,2));assert.equal(c.dropAudioResource(e,f.audio()).ok,true);assert.equal(f.session.project.resources[0].channels,2);
});
test('realpath escape through directory junction rejects without reading outside source',t=>{
  const f=fixture(t), outside=fs.mkdtempSync(path.join(__dirname,'../../test-output/P2/s2-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'source.wav'),wav());
  try { fs.symlinkSync(outside,path.join(f.root,'linked'),'junction'); } catch(error) { if (['EISDIR','EPERM','EACCES'].includes(error.code)) { t.skip('Runtime cannot create junction: '+error.code); return; } throw error; }
  f.session.project.resources[0].path='linked/source.wav';
  reject(f,()=>f.commands.dropAudioResource(f.event,f.audio()),'RESOURCE_PATH');
});
test('background CRUD preserves base, frame conflicts, unique target, dirty Apply and undo redo',t=>{
  const f=fixture(t),c=f.commands,e=f.event,s=f.session,base=structuredClone(s.project.scene.background),p=f.bg(),r=c.dropBackgroundResource(e,p);assert.equal(r.ok,true);const eventId=r.created.eventId;
  assert.deepEqual(c.dropBackgroundResource(e,p),r);assert.deepEqual(s.project.scene.background,base);reject(f,()=>c.dropBackgroundResource(e,f.bg()),'FRAME_CONFLICT');
  assert.equal(c.dropBackgroundResource(e,f.bg({atFrame:20})).ok,true);
  const edit=frame=>({...f.envelope(),eventId,patch:{frame,resourceId:'i'}});
  reject(f,()=>c.editBackgroundEventChecked(e,edit(20)),'FRAME_CONFLICT');reject(f,()=>c.editBackgroundEventChecked(e,{...edit(11),patch:{frame:11,resourceId:'i',path:'x'}}),'INVALID_PAYLOAD');
  f.context.mediaDraftDirty=true;reject(f,()=>c.deleteBackgroundEventChecked(e,{...f.envelope(),eventId}),'DIRTY_DRAFT');assert.equal(c.editBackgroundEventChecked(e,edit(11)).ok,true);f.context.mediaDraftDirty=false;
  s.project.scene.backgroundEvents.push({...s.project.scene.backgroundEvents[0]});reject(f,()=>c.deleteBackgroundEventChecked(e,{...f.envelope(),eventId}),'AMBIGUOUS_TARGET');s.project.scene.backgroundEvents.pop();
  const before=s.snapshot();assert.equal(c.deleteBackgroundEventChecked(e,{...f.envelope(),eventId} ).ok,true);s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.equal(s.project.scene.backgroundEvents.length,1);assert.deepEqual(s.project.scene.background,base);
});
test('SVG explicit unsupported and invalid image/decode rejected, existing SVG project still loads',t=>{
  const f=fixture(t),r=f.session.project.resources[1];r.path='old.svg';r.mime='image/svg+xml';assert.doesNotThrow(()=>new ProjectSession(f.session.snapshot()));reject(f,()=>f.commands.dropBackgroundResource(f.event,f.bg()),'UNSUPPORTED_IMAGE');
  r.path='image.png';delete r.mime;fs.writeFileSync(path.join(f.root,r.path),Buffer.from('bad'));reject(f,()=>f.commands.dropBackgroundResource(f.event,f.bg()),'INVALID_IMAGE');fs.writeFileSync(path.join(f.root,r.path),png);
  const c=createMediaCommands({getContext:()=>f.context,decodeImage:()=>null});reject(f,()=>c.dropBackgroundResource(f.event,f.bg()),'INVALID_IMAGE');
});
test('bounded cache eviction and document reset',t=>{
  const f=fixture(t,2),p=f.audio();assert.equal(f.commands.dropAudioResource(f.event,p).ok,true);f.commands.dropAudioResource(f.event,f.audio());f.commands.dropAudioResource(f.event,f.audio());reject(f,()=>f.commands.dropAudioResource(f.event,p),'REVISION_MISMATCH');f.context.documentId++;assert.equal(f.commands.dropAudioResource(f.event,{...p,documentId:f.context.documentId,expectedRevision:f.session.revision}).ok,true);
});
test('portable save/reopen and save-as rebased future retain IDs, metadata and SHA256',async t=>{
  const {saveSessionPortable,openPortable}=require('./project-storage.cjs');const f=fixture(t),a=f.commands.dropAudioResource(f.event,f.audio()),b=f.commands.dropBackgroundResource(f.event,f.bg());assert.equal(a.ok,true);assert.equal(b.ok,true);
  const hashes=Object.fromEntries(f.session.project.resources.map(r=>[r.id,hash(path.join(f.root,r.path))]));f.session.undo();const saved=await saveSessionPortable(f.session,f.root,path.join(f.root,'copy/project.json'));Object.assign(f.session,{project:saved.project,history:saved.history,future:saved.future});f.session.redo();assert.equal(f.session.project.scene.backgroundEvents[0].id,b.created.eventId);
  const saved2=await saveSessionPortable(f.session,saved.root,path.join(f.root,'second/project.json'));const opened=await openPortable(saved2.file);assert.equal(opened.project.scene.audioTracks[0].id,a.created.audioTrackId);assert.equal(opened.project.resources.find(r=>r.id==='a').durationSamples,4800);for(const r of opened.project.resources)assert.equal(hash(path.join(opened.root,r.path)),hashes[r.id]);
});
test('actual main/preload VM handlers, dirty close/save semantics and protected draft status',t=>{
  const f=fixture(t),handlers={},context={console,structuredClone,process:{env:{}},__dirname:path.join(__dirname,'..'),setTimeout:()=>0,clearTimeout(){}};
  const electron={app:{setPath(){},whenReady:()=>({then(){}}),on(){}},ipcMain:{handle:(name,fn)=>handlers[name]=fn},nativeImage:{createFromBuffer:()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1})})}};
  context.require=name=>name==='electron'?electron:name==='./core/recovery.cjs'?{RecoveryStore:class{},normalizeDraft:x=>x}:require(name.startsWith('.')?path.resolve(__dirname,'..',name):name);vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../main.cjs'),'utf8')+'\nthis.setup=(s,w,r)=>{session=s;win=w;projectRoot=r;documentId=7;};this.dirty=()=>isDirty();this.markSaved=()=>{session.savedRevision=session.revision;};',context);context.setup(f.session,f.context.win,f.root);
  assert.equal(handlers['drop-audio-resource']({},f.audio()).error.code,'INVALID_SENDER');assert.equal(handlers['drop-audio-resource'](f.event,f.audio()).ok,true);
  assert.throws(()=>handlers['update-media-draft-status']({}, {documentId:7,dirty:true}),/mainFrame/);assert.throws(()=>handlers['update-media-draft-status'](f.event,{documentId:6,dirty:true}),/旧工程/);
  assert.throws(()=>handlers['update-media-draft-status'](f.event,{documentId:7,dirty:true,extra:1}),/无效/);handlers['update-media-draft-status'](f.event,{documentId:7,dirty:true});context.markSaved();assert.equal(context.dirty(),true);assert.throws(()=>handlers.undo(f.event),/表单/);assert.throws(()=>handlers.redo(f.event),/表单/);assert.equal(handlers['drop-background-resource'](f.event,f.bg()).error.code,'DIRTY_DRAFT');handlers['update-media-draft-status'](f.event,{documentId:7,dirty:false});assert.equal(context.dirty(),false);assert.equal(handlers['drop-background-resource'](f.event,f.bg()).ok,true);
  let exposed;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,api)=>exposed=api},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
  for(const [method,channel] of [['dropAudioResource','drop-audio-resource'],['dropBackgroundResource','drop-background-resource'],['editBackgroundEventChecked','edit-background-event-checked'],['deleteBackgroundEventChecked','delete-background-event-checked'],['updateMediaDraftStatus','update-media-draft-status']]){const p={test:true};exposed[method](p);assert.deepEqual(calls.pop(),[channel,p]);}
});
