'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {upgradeProject,upgradeCharacters,upgradeCharacters4}=require('./schema-migration.cjs');
const {validateProject,evaluate}=require('./model.cjs'),{resolveDialogueSpeaker}=require('./character-definitions.cjs');
const {ProjectSession}=require('./session.cjs'),{createVoiceClipCommands}=require('./voice-clips.cjs');
const {importVoice,parseVoiceWav}=require('./voice-import.cjs'),{compileAudioTimeline}=require('./audio-timeline.cjs');
const root=path.resolve(__dirname,'..');
const load=name=>JSON.parse(fs.readFileSync(path.join(root,'examples',name),'utf8').replace(/^\uFEFF/,''));
const legacy=()=>load('rain-corridor.json'),template=()=>load('rain-corridor-v4.json');
function withPages(p){for(const d of p.scene.dialogues){d.fullText=structuredClone(d.text);d.pages=[{id:'page_'+d.id,startFrame:d.startFrame,endFrame:d.endFrame,revealFrames:d.revealFrames,text:structuredClone(d.text)}];}return p;}
function diagnosis(p){return {resources:Object.fromEntries(p.resources.filter(r=>r.kind==='audio').map(r=>[r.id,{kind:'audio',exists:true,audio:{format:'wav',...parseVoiceWav(fs.readFileSync(path.join(root,r.path)))}}]))};}
function visual(p,f){const v=evaluate(p,f);for(const c of v.characters)delete c.definitionId;for(const d of v.dialogues){const speaker=resolveDialogueSpeaker(p,d);d.speakerName=speaker.name;d.speakerColor=speaker.color;for(const key of ['speakerId','voice','voiceClips','displayUntilFrame','fullText','pages','pageId','pageIndex','pageStartFrame','pageEndFrame'])delete d[key];}return v;}
function sound(t){return {...t,clips:t.clips.map(c=>{const out={...c,sourceOffsetSamples:c.sourceOffsetSamples??0};delete out.id;delete out.clipId;return out;})};}
test('default schema4 is the explicit formal migration plus equivalent single pages; legacy and resources stay intact',()=>{
 const old=legacy(),before=structuredClone(old),p=template();
 assert.equal(old.schemaVersion,1);assert.equal(p.schemaVersion,4);assert.equal(p.scene.durationFrames,438);
 assert.deepEqual(p,withPages(upgradeCharacters4(upgradeCharacters(old))));assert.deepEqual(old,before);assert.deepEqual(validateProject(p),[]);
 assert.deepEqual(p.resources,old.resources);for(const r of p.resources){assert.equal(path.isAbsolute(r.path),false);assert.ok(fs.statSync(path.join(root,r.path)).isFile(),r.path);}
 assert.deepEqual(Object.keys(p.scene.dialogues[0].text).sort(),['en-US','ja-JP','zh-CN']);
 for(const d of p.scene.dialogues){assert.equal(d.pages.length,1);const page=d.pages[0];assert.deepEqual(d.fullText,d.text);assert.deepEqual(page.text,d.text);for(const k of ['startFrame','endFrame','revealFrames'])assert.equal(page[k],d[k]);assert.equal(d.displayUntilFrame,d.endFrame);}
 assert.equal(diagnosis(p).resources.voice_alice_001.audio.durationSamples,432000);
 for(const upgrade of [upgradeProject,upgradeCharacters])assert.throws(()=>upgrade(p),/Unsupported schemaVersion/);
});
test('all 438 frames in all three locales preserve visual semantics and full-source sound',()=>{
 const old=legacy(),p=template(),a=compileAudioTimeline(old,diagnosis(old)),b=compileAudioTimeline(p,diagnosis(p));assert.deepEqual(sound(b),sound(a));assert.equal(b.durationSamples,700800);assert.equal(b.clips[0].durationSamples,432000);
 for(const locale of Object.keys(old.scene.dialogues[0].text)){old.locale=p.locale=locale;for(let f=0;f<438;f++){
  assert.deepEqual(visual(p,f),visual(old,f),locale+' frame '+f);
  const active=t=>t.clips.filter(c=>f*1600>=c.startSamples&&f*1600<c.startSamples+c.durationSamples).map(c=>({resourceId:c.resourceId,sourceSample:(c.sourceOffsetSamples??0)+f*1600-c.startSamples}));assert.deepEqual(active(b),active(a));
 }}
});
function setup(p){const session=new ProjectSession(p),webContents={mainFrame:{}},context={session,documentId:8,projectRoot:root,win:{isDestroyed:()=>false,webContents}},event={sender:webContents,senderFrame:webContents.mainFrame};let sequence=0;return {session,event,commands:createVoiceClipCommands({getContext:()=>context}),payload:extra=>({commandId:'default-'+sequence++,documentId:8,expectedRevision:session.revision,dialogueId:session.project.scene.dialogues[0].id,clipId:session.project.scene.dialogues[0].voiceClips?.[0].id??null,...extra})};}
for(const version of [1,2,3,4])test('voice clip edit verifies real bytes and preserves schema '+version+' except explicit schema1 migration',()=>{
 const p=version===1?legacy():version===2?upgradeProject(legacy()):version===3?upgradeCharacters(legacy()):template(),x=setup(p),before=x.session.snapshot();
 const result=x.commands.editVoiceClip(x.event,x.payload({patch:{durationSamples:430400}}));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.upgraded,version===1);assert.equal(x.session.project.schemaVersion,version===1?2:version);assert.equal(x.session.project.scene.dialogues[0].speakerId,p.scene.dialogues[0].speakerId);assert.deepEqual(x.session.project.characterDefinitions,p.characterDefinitions);assert.deepEqual(validateProject(x.session.project),[]);
 const after=x.session.snapshot();x.session.undo();assert.deepEqual(x.session.snapshot(),before);x.session.redo();assert.deepEqual(x.session.snapshot(),after);
});
test('schema4 split is sample-contiguous, keeps definitions/pages, and undo/redo is exact',()=>{
 const x=setup(template()),before=x.session.snapshot(),result=x.commands.splitVoiceClip(x.event,x.payload({atFrame:60}));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.upgraded,false);const after=x.session.snapshot(),d=after.scene.dialogues[0],[left,right]=d.voiceClips;assert.equal(after.schemaVersion,4);assert.equal(d.speakerId,'def_char_alice');assert.deepEqual(after.characterDefinitions,before.characterDefinitions);assert.deepEqual(d.pages,before.scene.dialogues[0].pages);assert.equal(left.durationSamples,48000);assert.equal(right.sourceOffsetSamples,48000);assert.equal(right.durationSamples,384000);assert.equal(right.binding.followOffsetFrames,30);assert.deepEqual(validateProject(after),[]);
 const t=compileAudioTimeline(after,diagnosis(after));assert.equal(t.clips[0].startSamples+t.clips[0].durationSamples,t.clips[1].startSamples);assert.equal(t.clips.reduce((s,c)=>s+c.durationSamples,0),432000);x.session.undo();assert.deepEqual(x.session.snapshot(),before);x.session.redo();assert.deepEqual(x.session.snapshot(),after);
});
test('schema4 voice import uses clips, retains definition speaker and exact source bytes, undo/redo restores binding',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'default-schema4-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const p=template(),s=new ProjectSession(p),source=path.join(root,'assets/alice-voice.wav'),result=importVoice(s,p.scene.dialogues[0].id,source,directory),after=s.snapshot(),d=after.scene.dialogues[0],r=after.resources.find(r=>r.id===result.resourceId);
 assert.equal(after.schemaVersion,4);assert.equal(d.speakerId,'def_char_alice');assert.deepEqual(after.characterDefinitions,p.characterDefinitions);assert.deepEqual(d.fullText,p.scene.dialogues[0].fullText);assert.equal(d.voice,undefined);assert.equal(d.voiceClips.length,1);assert.equal(d.voiceClips[0].resourceId,result.resourceId);assert.equal(d.voiceClips[0].durationSamples,432000);assert.deepEqual(fs.readFileSync(path.join(directory,r.path)),fs.readFileSync(source));assert.deepEqual(validateProject(after),[]);s.undo();assert.deepEqual(s.snapshot(),p);s.redo();assert.deepEqual(s.snapshot(),after);
});
