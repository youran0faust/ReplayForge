const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm');
const {ProjectSession}=require('./session.cjs');
const {validateProject,clone}=require('./model.cjs');
const {importAudioTrack,editAudioTrack,splitAudioTrack,deleteAudioTrack}=require('./audio-track.cjs');
const {applyProjectCode}=require('./code-edit.cjs');
const example=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,''));
function wav(channels=1,frames=480){const b=Buffer.alloc(44+channels*2*frames);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(48000*channels*2,28);b.writeUInt16LE(channels*2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'p1-track-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'input.wav');fs.writeFileSync(source,wav());return {root,source,session:new ProjectSession(example)};}
test('old omitted audioTracks accepted; import full managed WAV, edit/delete and undo preserve resources',t=>{
 const {root,source,session}=fixture(t),before=session.snapshot();assert.deepEqual(validateProject(before),[]);
 const result=importAudioTrack(session,source,root,{kind:'sfx',startFrame:0}),after=session.snapshot(),track=after.scene.audioTracks[0];
 assert.deepEqual(result,{id:track.id,revision:1});assert.equal(track.durationSamples,480);assert.equal(track.gain,1);assert.equal(track.name,'input');
 const resource=after.resources.find(r=>r.id===track.resourceId),target=path.join(root,resource.path);assert.deepEqual(fs.readFileSync(target),fs.readFileSync(source));
 session.undo();assert.deepEqual(session.snapshot(),before);assert.ok(fs.existsSync(target));session.redo();assert.deepEqual(session.snapshot(),after);
 editAudioTrack(session,track.id,{name:'BGM',gain:0,startFrame:1});assert.equal(session.history.length,2);assert.equal(session.snapshot().scene.audioTracks[0].gain,0);
 const edited=session.snapshot();deleteAudioTrack(session,track.id);assert.deepEqual(session.snapshot().scene.audioTracks,[]);assert.deepEqual(session.snapshot().resources,edited.resources);assert.ok(fs.existsSync(target));session.undo();assert.deepEqual(session.snapshot(),edited);
 fs.writeFileSync(source,wav(2));const second=importAudioTrack(session,source,root,{kind:'bgm',startFrame:0});assert.notEqual(second.id,track.id);assert.equal(session.snapshot().scene.audioTracks[1].durationSamples,480);
});
test('schema4 BGM trim clamps fade; safe splits preserve only right fade and fade-interior split is atomic',t=>{
  for(const splitFrame of [2,4]){
    const {root,source,session}=fixture(t);session.apply(p=>{p.schemaVersion=4;p.characterDefinitions=[];p.scene.dialogues=[];p.scene.characters=[];},'schema4');fs.writeFileSync(source,wav(1,9600));
    const {id}=importAudioTrack(session,source,root,{kind:'bgm',startFrame:0});editAudioTrack(session,id,{fadeOutSamples:3200});
    editAudioTrack(session,id,{startFrame:1});assert.equal(session.snapshot().scene.audioTracks[0].fadeOutSamples,3200);editAudioTrack(session,id,{startFrame:0});
    const before=session.snapshot();splitAudioTrack(session,id,splitFrame);const [left,right]=session.snapshot().scene.audioTracks;
    assert.equal(Object.hasOwn(left,'fadeOutSamples'),false);assert.equal(right.fadeOutSamples,3200);session.undo();assert.deepEqual(session.snapshot(),before);
    assert.throws(()=>splitAudioTrack(session,id,5),/淡出/);assert.deepEqual(session.snapshot(),before);
    editAudioTrack(session,id,{durationSamples:1600});assert.equal(session.snapshot().scene.audioTracks[0].fadeOutSamples,1600);session.undo();assert.deepEqual(session.snapshot(),before);
    assert.throws(()=>editAudioTrack(session,id,{fadeOutSamples:9601}),/fadeOutSamples/);
  }
});
test('gain, timing, metadata, duplicate IDs and code edits rollback',t=>{
 const {root,source,session}=fixture(t);const {id}=importAudioTrack(session,source,root,{kind:'bgm',startFrame:0});const before=session.snapshot(),revision=session.revision;
 for(const patch of [{gain:NaN},{gain:Infinity},{gain:-1},{gain:2.01},{startFrame:0.5},{startFrame:Number.MAX_SAFE_INTEGER},{startFrame:before.scene.durationFrames},{name:''},{kind:'sfx'},{durationSamples:481}]){
 assert.throws(()=>editAudioTrack(session,id,patch));assert.deepEqual(session.snapshot(),before);assert.equal(session.revision,revision);}
 for(const change of [p=>p.scene.audioTracks.push({...p.scene.audioTracks[0]}),p=>p.scene.audioTracks[0].resourceId='missing',p=>p.scene.audioTracks[0].durationSamples=Number.MAX_SAFE_INTEGER,p=>p.scene.audioTracks[0].durationSamples=481,p=>p.scene.audioTracks=null,p=>p.scene.audioTracks[0].gain=3]){
 const candidate=clone(before);change(candidate);assert.ok(validateProject(candidate).length);assert.throws(()=>applyProjectCode(session,{text:JSON.stringify(candidate),expectedRevision:revision}));assert.deepEqual(session.snapshot(),before);}
 const valid=clone(before);valid.scene.audioTracks[0].gain=2;assert.equal(applyProjectCode(session,{text:JSON.stringify(valid),expectedRevision:revision}).revision,revision+1);
});
test('split independent track preserves shared source and is undoable',t=>{
 const {root,source,session}=fixture(t);fs.writeFileSync(source,wav(1,4800));const {id}=importAudioTrack(session,source,root,{kind:'sfx',startFrame:0});
 const before=session.snapshot();const result=splitAudioTrack(session,id,2);const tracks=session.snapshot().scene.audioTracks;
 assert.equal(tracks.length,2);assert.equal(tracks[0].id,id);assert.equal(tracks[0].durationSamples,3200);assert.equal(tracks[1].startFrame,2);assert.equal(tracks[1].sourceOffsetSamples,3200);assert.equal(tracks[1].durationSamples,1600);
 assert.equal(tracks[1].resourceId,tracks[0].resourceId);assert.equal(session.history.length,2);session.undo();assert.deepEqual(session.snapshot(),before);session.redo();assert.equal(session.snapshot().scene.audioTracks.length,2);
 assert.throws(()=>splitAudioTrack(session,id,0));assert.throws(()=>splitAudioTrack(session,id,2));
});
test('trimmed split keeps nonzero offsets, one-sample tail, gain and exact undo for BGM and SFX',t=>{
 for(const kind of ['bgm','sfx']){const {root,source,session}=fixture(t);fs.writeFileSync(source,wav(2,20000));const {id}=importAudioTrack(session,source,root,{kind,startFrame:10});editAudioTrack(session,id,{sourceOffsetSamples:321,durationSamples:4801,gain:kind==='bgm'?0:0.73});const before=session.snapshot(),revision=session.revision,history=session.history.length;const result=splitAudioTrack(session,id,{atFrame:13}),after=session.snapshot(),[left,right]=after.scene.audioTracks;
 assert.equal(result.id,right.id);assert.notEqual(right.id,id);assert.equal(result.revision,revision+1);assert.equal(session.history.length,history+1);assert.equal(left.durationSamples,4800);assert.equal(left.sourceOffsetSamples,321);assert.equal(right.startFrame,13);assert.equal(right.sourceOffsetSamples,5121);assert.equal(right.durationSamples,1);assert.equal(left.kind,kind);assert.equal(right.kind,kind);assert.equal(right.gain,left.gain);assert.equal(left.resourceId,right.resourceId);assert.deepEqual(after.resources,before.resources);assert.deepEqual(after.scene.dialogues,before.scene.dialogues);session.undo();assert.deepEqual(session.snapshot(),before);session.redo();assert.deepEqual(session.snapshot(),after);}
});
test('invalid split is atomic and retains redo; unknown source metadata rejected',t=>{
 const {root,source,session}=fixture(t);fs.writeFileSync(source,wav(1,9601));const {id}=importAudioTrack(session,source,root,{kind:'bgm',startFrame:10});editAudioTrack(session,id,{gain:.7});session.undo();const before=session.snapshot(),revision=session.revision,history=JSON.stringify(session.history),future=JSON.stringify(session.future);
 for(const at of [10,17,0,-1,10.5,NaN,Infinity,null,[],{},'12',{sourceSample:3200},{atFrame:12,extra:true},Number.MAX_SAFE_INTEGER]){assert.throws(()=>splitAudioTrack(session,id,at));assert.deepEqual(session.snapshot(),before);assert.equal(session.revision,revision);assert.equal(JSON.stringify(session.history),history);assert.equal(JSON.stringify(session.future),future);}
 assert.throws(()=>splitAudioTrack(session,'missing',12));const p=clone(before);delete p.resources.find(r=>r.id===p.scene.audioTracks[0].resourceId).durationSamples;const unknown=new ProjectSession(p);assert.throws(()=>splitAudioTrack(unknown,id,12),/已知/);assert.equal(unknown.revision,0);session.redo();assert.equal(session.snapshot().scene.audioTracks[0].gain,.7);
});
test('split survives portable reopen and relocated recovery without source changes',t=>{
 const {root,source,session}=fixture(t);session.apply(p=>{p.scene.dialogues=[];p.scene.characters=[];p.scene.background=null;p.resources=[];},'isolated fixture');session.history=[];session.future=[];fs.writeFileSync(source,wav(1,12001));const {id}=importAudioTrack(session,source,root,{kind:'bgm',startFrame:10});editAudioTrack(session,id,{sourceOffsetSamples:777,durationSamples:9601});splitAudioTrack(session,id,16);const tracks=session.snapshot().scene.audioTracks;const {saveSessionPortable,openPortable}=require('./project-storage.cjs');const out=path.join(root,'portable');fs.mkdirSync(out);saveSessionPortable(session,root,path.join(out,'project.json'));const reopened=openPortable(path.join(out,'project.json'));assert.deepEqual(reopened.project.scene.audioTracks,tracks);assert.deepEqual(fs.readFileSync(source),wav(1,12001));
 const {RecoveryStore}=require('./recovery.cjs');const store=new RecoveryStore(path.join(root,'recovery'));store.write({root,project:session.snapshot(),revision:session.revision,draft:null});const relocated=path.join(root,'relocated');fs.renameSync(store.root,relocated);const recovered=new RecoveryStore(relocated).open();assert.deepEqual(recovered.project.scene.audioTracks,tracks);assert.deepEqual(fs.readFileSync(path.join(out,reopened.project.resources[0].path)),wav(1,12001));
});
test('bad import and failed transaction leave no registered resources or copied files',t=>{
 const {root,source,session}=fixture(t),before=session.snapshot();
 for(const options of [{kind:'voice',startFrame:0},{kind:'sfx',startFrame:-1},{kind:'sfx',startFrame:example.scene.durationFrames},{kind:'sfx',startFrame:0,path:source}])assert.throws(()=>importAudioTrack(session,source,root,options));
 fs.writeFileSync(source,Buffer.from('bad'));assert.throws(()=>importAudioTrack(session,source,root,{kind:'sfx',startFrame:0}));assert.deepEqual(session.snapshot(),before);
 fs.writeFileSync(source,wav());session.apply=()=>{throw Error('rejected');};assert.throws(()=>importAudioTrack(session,source,root,{kind:'sfx',startFrame:0}),/rejected/);assert.deepEqual(fs.readdirSync(path.join(root,'assets/imported')),[]);assert.equal(session.revision,0);
});
test('main native chooser sender/busy guard and preload exact audio track calls',async()=>{
 const main=path.join(__dirname,'../main.cjs'),realRequire=require('module').createRequire(main),handlers={};let resolveChooser,imported;
 class Window{constructor(){this.webContents={mainFrame:{},send(){},once(){}};Window.instance=this;}isDestroyed(){return false;}loadFile(){}on(){}}
 const electron={app:{setPath(){},whenReady(){return {then:fn=>fn()};},on(){}},BrowserWindow:Window,ipcMain:{handle:(n,f)=>handlers[n]=f},dialog:{showOpenDialog:()=>new Promise(resolve=>resolveChooser=resolve)}};
 const audio=require('./audio-track.cjs');
 vm.runInNewContext(fs.readFileSync(main,'utf8'),{__dirname:path.dirname(main),JSON,process,setTimeout:()=>1,clearTimeout(){},require:name=>name==='electron'?electron:name==='./core/recovery.cjs'?{RecoveryStore:class{inspect(){return null;}clear(){}},normalizeDraft:require('./recovery.cjs').normalizeDraft}:name==='./core/audio-track.cjs'?{...audio,importAudioTrack:(s,source,root,options)=>{imported={source,options};return {id:'track',revision:1};}}:realRequire(name)});
 const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame};
 await assert.rejects(handlers['import-audio-track']({sender:{}},{kind:'sfx',startFrame:0}));
 await assert.rejects(handlers['import-audio-track'](event,{kind:'sfx',startFrame:0,source:'evil'}));
 let pending=handlers['import-audio-track'](event,{kind:'sfx',startFrame:0});assert.throws(()=>handlers['delete-audio-track'](event,'track'),/稍后重试/);assert.throws(()=>handlers['split-audio-track'](event,'track',12),/稍后重试/);resolveChooser({canceled:true});assert.equal((await pending).cancelled,true);
 pending=handlers['import-audio-track'](event,{kind:'bgm',startFrame:0},'evil.wav');resolveChooser({canceled:false,filePaths:['native.wav']});assert.equal((await pending).id,'track');assert.equal(imported.source,'native.wav');
 let bridge,invocation;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,api)=>bridge=api},ipcRenderer:{invoke:(...args)=>invocation=args}})});
 bridge.splitAudioTrack('a',{atFrame:12});assert.deepEqual(invocation,['split-audio-track','a',{atFrame:12}]);
 bridge.importAudioTrack({kind:'sfx',startFrame:0});assert.equal(invocation[0],'import-audio-track');bridge.editAudioTrack('a',{gain:0.5});assert.deepEqual(invocation,['edit-audio-track','a',{gain:0.5}]);bridge.deleteAudioTrack('a');assert.deepEqual(invocation,['delete-audio-track','a']);
});
