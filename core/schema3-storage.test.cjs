'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {ProjectSession}=require('./session.cjs'),{createCharacterLibraryCommands}=require('./character-library-command.cjs'),{createTextCommands}=require('./text-command.cjs');
const {saveSessionPortable,openPortable}=require('./project-storage.cjs'),{RecoveryStore}=require('./recovery.cjs'),{evaluate,validateProject}=require('./model.cjs');
const {diagnoseAudio}=require('./resource-index.cjs'),{compileAudioTimeline}=require('./audio-timeline.cjs');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function resources(project,root){return Object.fromEntries(project.resources.map(r=>[r.id,hash(path.join(root,r.path))]));}
function fixture(t){
 const parent=path.resolve(__dirname,'../../test-output/P2');fs.mkdirSync(parent,{recursive:true});const base=fs.mkdtempSync(path.join(parent,'schema3-storage-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const original=path.resolve(__dirname,'../fixtures/original-scene-project'),source=path.join(base,'source');fs.cpSync(original,source,{recursive:true});const loaded=openPortable(path.join(source,'场景.json'));
 const project=loaded.project;project.scene.durationFrames=360; // Copy-only range extension; authored fixture is never changed.
 // Exercise actual WAV verification/hydration rather than injecting a verifier.
 for(const r of project.resources.filter(r=>r.kind==='audio')){delete r.sampleRate;delete r.durationSamples;}
 return {base,source,original,project,originalManifestHash:hash(path.join(original,'场景.json'))};
}
function commands(session,root){const wc={mainFrame:{}},context={session,projectRoot:root,documentId:3,win:{webContents:wc,isDestroyed:()=>false}},event={sender:wc,senderFrame:wc.mainFrame};let n=0;const envelope=extra=>({commandId:'storage-'+(++n),documentId:3,expectedRevision:session.revision,...extra});const chars=createCharacterLibraryCommands({getContext:()=>context}),text=createTextCommands({getContext:()=>context});return {run(method,p={}){const result=(chars[method]||text[method])(event,envelope(p));assert.equal(result.ok,true,JSON.stringify(result));return result;},text,chars,event,envelope};}
test('real schema3 migration, shared definitions, text creation, portable and relocated recovery preserve IDs/resources/audio',t=>{
 const {base,source,original,project,originalManifestHash}=fixture(t),sourceHashes=resources(project,source),s=new ProjectSession(project),api=commands(s,source),legacy=s.snapshot();
 api.run('upgradeCharacterLibrary');assert.equal(s.project.schemaVersion,3);assert.deepEqual(validateProject(s.project),[]);assert.equal(s.history.length,1);
 for(const r of s.project.resources.filter(r=>r.kind==='audio')){assert.equal(r.sampleRate,48000);assert(Number.isSafeInteger(r.durationSamples));}
 const migrated=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),legacy);s.redo();assert.deepEqual(s.snapshot(),migrated);
 const first=s.project.scene.characters[0],definitionId=first.definitionId,firstId=first.id;
 const secondId=api.run('instantiateCharacter',{definitionId,atFrame:0}).created.characterId;assert.notEqual(secondId,firstId);
 const geometry=structuredClone(s.project.scene.characters),definition={...structuredClone(s.project.characterDefinitions.find(d=>d.id===definitionId)),name:'共享姓名'};
 const beforeName=s.snapshot();api.run('editCharacterDefinition',{definitionId,definition,confirmedInstanceIds:[firstId,secondId]});const afterName=s.snapshot();assert.deepEqual(s.project.scene.characters,geometry);
 const state=evaluate(s.project,0);assert.equal(state.characters.filter(c=>[firstId,secondId].includes(c.id)).length,2);for(const c of state.characters.filter(c=>[firstId,secondId].includes(c.id)))assert.equal(c.name,'共享姓名');assert.equal(state.dialogues[0].speakerId,firstId);
 s.undo();assert.deepEqual(s.snapshot(),beforeName);s.redo();assert.deepEqual(s.snapshot(),afterName);
 const beforeGeometry=s.snapshot();s.editCharacter(secondId,{x:17,y:23,width:200,height:300});const afterGeometry=s.snapshot();assert.deepEqual(s.project.characterDefinitions,beforeGeometry.characterDefinitions);assert.deepEqual(s.project.scene.characters.find(c=>c.id===firstId),beforeGeometry.scene.characters.find(c=>c.id===firstId));s.undo();assert.deepEqual(s.snapshot(),beforeGeometry);s.redo();assert.deepEqual(s.snapshot(),afterGeometry);
 // Give an uninstantiated definition its own registered image resource.
 const image=s.project.resources.find(r=>r.kind==='image');const orphanPath='orphan-only.png';fs.copyFileSync(path.join(source,image.path),path.join(source,orphanPath));s.apply(p=>p.resources.push({id:'orphan-only-image',kind:'image',mime:'image/png',path:orphanPath}),'register orphan fixture image');
 const orphanId=api.run('createCharacterDefinition',{name:'未实例化模板',color:'#ffffff',resourceId:'orphan-only-image'}).created.definitionId;assert(!s.project.scene.characters.some(c=>c.definitionId===orphanId));
 const newId=api.run('createDialogueFromText',{text:'新对白\n独立文本',locale:s.project.locale,speakerId:secondId,atFrame:210,durationFrames:90,revealFrames:30}).created.dialogueId;
 const dialogue=s.project.scene.dialogues.find(d=>d.id===newId);assert.deepEqual(dialogue.text,{[s.project.locale]:'新对白\n独立文本'});for(const key of ['voice','voiceClips','pages'])assert.equal(Object.hasOwn(dialogue,key),false);assert.equal(dialogue.endFrame,300);assert(!evaluate(s.project,209).dialogues.some(d=>d.id===newId));assert(evaluate(s.project,210).dialogues.some(d=>d.id===newId));assert(!evaluate(s.project,300).dialogues.some(d=>d.id===newId));
 const beforeReject=s.snapshot(),bad=api.text.createDialogueFromText(api.event,api.envelope({text:'重叠',locale:s.project.locale,speakerId:secondId,atFrame:299,durationFrames:30,revealFrames:10}));assert.equal(bad.ok,false);assert.deepEqual(s.snapshot(),beforeReject);
 const committed=s.snapshot(),hashes=resources(committed,source),frames=[0,60,119,120,209,210,299,300,359],states=frames.map(f=>evaluate(committed,f));const timeline=compileAudioTimeline(committed,diagnoseAudio(committed,source));assert.equal(timeline.clips.length,2);assert.deepEqual(timeline.clips.map(c=>c.sourceOffsetSamples),[0,0]);
 const saved=saveSessionPortable(s,source,path.join(base,'portable','工程3.json'));assert.equal(saved.project.schemaVersion,3);assert.deepEqual(s.snapshot(),committed);assert.equal(JSON.parse(fs.readFileSync(saved.file,'utf8')).project.schemaVersion,3);assert.deepEqual(saved.project.characterDefinitions,committed.characterDefinitions);assert.deepEqual(saved.project.scene,committed.scene);assert.deepEqual(resources(saved.project,saved.root),hashes);
 const raw=path.join(saved.root,'raw-schema3.json');fs.writeFileSync(raw,JSON.stringify(saved.project));assert.deepEqual(openPortable(raw).project,saved.project);
 const draft={text:'{ invalid schema3 code draft\n',baseRevision:s.revision-1,dirty:true,stale:true},store=new RecoveryStore(path.join(base,'recovery'));store.write({root:source,project:committed,revision:s.revision,draft,unappliedUI:{x:999}});
 const recoveredRoot=path.join(base,'moved-recovery');fs.renameSync(store.root,recoveredRoot);fs.rmSync(source,{recursive:true});
 const opened=openPortable(saved.file);assert.deepEqual(opened.project,saved.project);assert.deepEqual(resources(opened.project,opened.root),hashes);assert.deepEqual(frames.map(f=>evaluate(opened.project,f)),states);assert.deepEqual(compileAudioTimeline(opened.project,diagnoseAudio(opened.project,opened.root)),timeline);
 fs.rmSync(saved.root,{recursive:true});const restored=new RecoveryStore(recoveredRoot).open();assert.deepEqual(restored.draft,draft);assert.equal(restored.unappliedUI,undefined);assert.equal(restored.project.schemaVersion,3);assert.deepEqual(restored.project.characterDefinitions,committed.characterDefinitions);assert.deepEqual(restored.project.scene,committed.scene);assert.deepEqual(resources(restored.project,restored.root),hashes);assert.deepEqual(frames.map(f=>evaluate(restored.project,f)),states);assert.deepEqual(compileAudioTimeline(restored.project,diagnoseAudio(restored.project,restored.root)),timeline);assert(restored.project.resources.some(r=>r.id==='orphan-only-image'));assert.equal(restored.history,undefined,'recovery is a single snapshot, not promised undo history');
 assert.equal(hash(path.join(original,'场景.json')),originalManifestHash);assert.deepEqual(resources(legacy,original),sourceHashes);
});
