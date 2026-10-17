'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {ProjectSession}=require('./session.cjs'),{validateProject}=require('./model.cjs');
const {upgradeProject,upgradeCharacters}=require('./schema-migration.cjs');
const {compileAudioTimeline}=require('./audio-timeline.cjs'),{diagnoseAudio}=require('./resource-index.cjs');
const {importVoice}=require('./voice-import.cjs'),{createVoiceClipCommands}=require('./voice-clips.cjs');
const {importComponentPack,upgradeCandidate,verifyUpgrade}=require('./components.cjs'),{componentErrors}=require('./components-model.cjs');
const fixtureRoot=path.resolve(__dirname,'../fixtures/original-scene-project');
const fixture=()=>JSON.parse(fs.readFileSync(path.join(fixtureRoot,'场景.json'),'utf8')).project;
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function rootFor(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'schema3-media-'));fs.cpSync(fixtureRoot,root,{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function context(session,projectRoot){const webContents={mainFrame:{}},c={session,projectRoot,documentId:1,win:{isDestroyed:()=>false,webContents}};return {c,event:{sender:webContents,senderFrame:webContents.mainFrame}};}
test('pure character migration keeps schema1/2 audio semantics and supports real schema3 voice splitting',t=>{
 const root=rootFor(t),legacy=fixture(),before=structuredClone(legacy),v2=upgradeProject(legacy),v3=upgradeCharacters(legacy);
 assert.deepEqual(legacy,before);assert.equal(v3.schemaVersion,3);assert.deepEqual(validateProject(v3),[]);assert.deepEqual(upgradeCharacters(v2).scene.dialogues,v3.scene.dialogues);
 const oldTimeline=compileAudioTimeline(legacy,diagnoseAudio(legacy,root)),newTimeline=compileAudioTimeline(v3,diagnoseAudio(v3,root));
 const audioShape=x=>x.clips.map(c=>({resourceId:c.resourceId,startSamples:c.startSamples,durationSamples:c.durationSamples,sourceOffsetSamples:c.sourceOffsetSamples||0}));
 assert.deepEqual(audioShape(newTimeline),audioShape(oldTimeline));assert.deepEqual(compileAudioTimeline(v2,diagnoseAudio(v2,root)),newTimeline);
 const s=new ProjectSession(v3),{c,event}=context(s,root),commands=createVoiceClipCommands({getContext:()=>c});const d=s.project.scene.dialogues[0],voice=d.voiceClips[0],source=path.join(root,s.project.resources.find(r=>r.id===voice.resourceId).path),sourceHash=hash(source),snapshot=s.snapshot();
 const result=commands.splitVoiceClip(event,{commandId:'split-schema3',documentId:1,expectedRevision:s.revision,dialogueId:d.id,clipId:voice.id,atFrame:60});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(s.project.schemaVersion,3);assert.equal(result.upgraded,false);assert.equal(s.history.length,1);assert.equal(s.project.scene.dialogues[0].voiceClips.length,2);assert.equal(s.project.scene.dialogues[0].voice,undefined);
 const timeline=compileAudioTimeline(s.project,diagnoseAudio(s.project,root));assert.equal(timeline.clips.length,newTimeline.clips.length+1);assert.equal(timeline.clips[0].durationSamples+timeline.clips[1].durationSamples,voice.durationSamples);assert.equal(timeline.clips[1].sourceOffsetSamples,timeline.clips[0].durationSamples);assert.equal(hash(source),sourceHash);
 const after=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),snapshot);s.redo();assert.deepEqual(s.snapshot(),after);
});
test('real WAV import writes clips in schemas2/3, legacy voice in schema1, and never downgrades',t=>{
 for(const version of [1,2,3]){const root=rootFor(t),p=version===1?fixture():version===2?upgradeProject(fixture()):upgradeCharacters(fixture()),s=new ProjectSession(p),d=p.scene.dialogues[0],resource=p.resources.find(r=>r.id===(d.voice?.resourceId||d.voiceClips[0].resourceId)),source=path.join(root,resource.path),before=hash(source),characters=structuredClone(s.project.scene.characters),definitions=structuredClone(s.project.characterDefinitions);
 const result=importVoice(s,d.id,source,root),actual=s.project.scene.dialogues[0];assert.equal(s.project.schemaVersion,version);assert.deepEqual(s.project.scene.characters,characters);assert.deepEqual(s.project.characterDefinitions,definitions);if(version===1){assert.equal(actual.voice.resourceId,result.resourceId);assert.equal(actual.voiceClips,undefined);}else{assert.equal(actual.voice,undefined);assert.equal(actual.voiceClips.length,1);assert.equal(actual.voiceClips[0].resourceId,result.resourceId);}assert.deepEqual(validateProject(s.project),[]);assert.equal(compileAudioTimeline(s.project,diagnoseAudio(s.project,root)).clips.length,2);assert.equal(hash(source),before);}
});
test('component pack imports stay schema3 and preserve character definitions and clip identities',t=>{
 const root=rootFor(t),p=upgradeCharacters(fixture()),s=new ProjectSession(p),before=s.snapshot();let invoked=false;const candidate=structuredClone(p);upgradeCandidate(candidate,()=>{invoked=true;throw Error('must not downgrade');});assert.equal(invoked,false);assert.deepEqual(candidate,p);assert.equal(verifyUpgrade(p,root,{verifyProjectVoices:()=>{throw Error('schema3 must not hydrate legacy voice');}}),null);
 const result=importComponentPack(s,root,path.resolve(__dirname,'../component-packs/independent-ui-v0.1'));assert.equal(result.definitionIds.length,3);assert.equal(s.project.schemaVersion,3);assert.deepEqual(s.project.scene.dialogues,before.scene.dialogues);assert.deepEqual(s.project.scene.characters,before.scene.characters);assert.deepEqual(s.project.characterDefinitions,before.characterDefinitions);assert.deepEqual(componentErrors(s.project),[]);assert.deepEqual(validateProject(s.project),[]);assert.deepEqual(compileAudioTimeline(s.project,diagnoseAudio(s.project,root)),compileAudioTimeline(before,diagnoseAudio(before,root)));s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.equal(s.project.schemaVersion,3);
 const legacy=fixture();upgradeCandidate(legacy);assert.equal(legacy.schemaVersion,2);
});
test('schema3 rejects legacy voice and future schema versions do not gain clip or component support',()=>{
 const p=upgradeCharacters(fixture()),diagnosis=diagnoseAudio(p,fixtureRoot);const legacy=structuredClone(p);legacy.scene.dialogues[0].voice=fixture().scene.dialogues[0].voice;delete legacy.scene.dialogues[0].voiceClips;assert.throws(()=>compileAudioTimeline(legacy,diagnosis),/schema3 cannot contain legacy voice/);
 for(const version of [0,5,999]){const unknown=structuredClone(p);unknown.schemaVersion=version;assert.throws(()=>compileAudioTimeline(unknown,diagnosis),/Invalid voiceClips schema/);unknown.componentDefinitions=[];unknown.scene.components=[];assert(componentErrors(unknown).length);assert.throws(()=>upgradeCandidate(unknown),/schema/);assert.throws(()=>importVoice({snapshot:()=>unknown},unknown.scene.dialogues[0].id,'must-not-read.wav','must-not-resolve-root'),/Unsupported schemaVersion/);}
});
