'use strict';
const assert = require('assert/strict');
const {ProjectSession} = require('./session.cjs');
const {applyTimelineEdit} = require('./timeline-edit.cjs');
const fixture = () => ({schemaVersion: 1, id: 'timeline', locale: 'en-US',
  design: {width: 1280, height: 720, fps: 30},
  resources: [{id: 'voice', kind: 'audio', path: 'voice.wav'}],
  scene: {durationFrames: 120,
    characters: [{id: 'actor', name: 'Actor', x: 0, y: 0, width: 100, height: 100,
      color: '#ffffff', visibleFrom: 10, visibleTo: 100}],
    dialogues: [{id: 'line', speakerId: 'actor', text: {'en-US': 'Hello', 'ja-JP': 'こんにちは'},
      startFrame: 10, endFrame: 60, revealFrames: 10,
      voice: {resourceId: 'voice', durationSamples: 48000}, custom: {preserve: true}}]}});
const patch = (startFrame, endFrame, kind = 'dialogues', id = kind === 'dialogues' ? 'line' : 'actor') => ({kind, id, startFrame, endFrame});
const state = s => JSON.stringify({project: s.snapshot(), revision: s.revision, savedRevision: s.savedRevision,
  history: s.history, future: s.future, draft: s.draft});
const s = new ProjectSession(fixture());
let calls = 0;
const apply = s.apply.bind(s);
s.apply = (...args) => { calls++; return apply(...args); };
const original = s.snapshot();
assert.deepEqual(applyTimelineEdit(s, patch(20, 70)), {revision: 1, changed: true});
assert.equal(calls, 1);
assert.deepEqual(s.snapshot().scene.dialogues[0], {...original.scene.dialogues[0], startFrame: 20, endFrame: 70});
assert.deepEqual(s.snapshot().resources, original.resources);
const moved = s.snapshot();
assert.equal(s.undo(), true);
assert.deepEqual(s.snapshot(), original);
const beforeNoop = state(s);
assert.deepEqual(applyTimelineEdit(s, patch(10, 60)), {revision: s.revision, changed: false});
assert.equal(state(s), beforeNoop, 'no-op must preserve redo and revision');
assert.equal(calls, 1);
assert.equal(s.redo(), true);
assert.deepEqual(s.snapshot(), moved);
// Resize both edges, including exact reveal minimum and scene boundaries.
applyTimelineEdit(s, patch(0, 70));
applyTimelineEdit(s, patch(0, 10));
assert.equal(s.snapshot().scene.dialogues[0].revealFrames, 10);
applyTimelineEdit(s, patch(90, 120)); // Full voice ends exactly at scene end.
applyTimelineEdit(s, patch(90, 100)); // Visual interval can end before voice.
for (const bad of [patch(91, 120), patch(0, 9), patch(-1, 40), patch(0, 121),
  patch(10, 10), patch(30, 20), patch(0.5, 40), patch(0, 40.5), patch('0', 40),
  patch(NaN, 40), patch(0, Infinity), patch(0, Number.MAX_SAFE_INTEGER + 1),
  patch(0, 40, 'unknown'), patch(0, 40, 'dialogues', 'missing'), patch(0, 40, 'characters', 'missing'),
  {...patch(0, 40), revealFrames: 1}, {...patch(0, 40), text: 'replace'},
  {kind: 'dialogues', id: 'line', startFrame: 0}, null, [], {}]) {
  const before = state(s);
  assert.throws(() => applyTimelineEdit(s, bad));
  assert.equal(state(s), before, 'invalid edits must roll back all session state');
}
for (const [start, end] of [[20, 110], [0, 110], [0, 120], [119, 120]]) {
  const before = s.snapshot();
  const count = calls;
  applyTimelineEdit(s, patch(start, end, 'characters'));
  assert.equal(calls, count + 1);
  assert.deepEqual(s.snapshot().scene.characters[0], {...before.scene.characters[0], visibleFrom: start, visibleTo: end});
  assert.deepEqual(s.snapshot().scene.dialogues, before.scene.dialogues);
  const after = s.snapshot();
  assert.equal(s.undo(), true);
  assert.deepEqual(s.snapshot(), before);
  assert.equal(s.redo(), true);
  assert.deepEqual(s.snapshot(), after);
}
for (const bad of [patch(-1, 1, 'characters'), patch(0, 121, 'characters'), patch(3, 3, 'characters')]) {
  const before = state(s);
  assert.throws(() => applyTimelineEdit(s, bad));
  assert.equal(state(s), before);
}
const characterNoop = state(s);
assert.equal(applyTimelineEdit(s, patch(119, 120, 'characters')).changed, false);
assert.equal(state(s), characterNoop);
// A single sample overflow must not get rounded down to a frame.
const samples = fixture();
samples.scene.dialogues[0].voice.durationSamples = 48001;
const sampleSession = new ProjectSession(samples);
assert.throws(() => applyTimelineEdit(sampleSession, patch(90, 120)), /语音超出/);
assert.equal(sampleSession.revision, 0);
// Failed edits preserve a pending redo branch too.
s.undo();
const redoState = state(s);
assert.throws(() => applyTimelineEdit(s, patch(1, 2)), /揭示/);
assert.equal(state(s), redoState);
assert.equal(s.redo(), true);
// T1 grouped timing: one transaction, all metadata/audio untouched, reversible.
const grouped = () => {
  const f = fixture(), d = f.scene.dialogues[0];
  d.revealFrames = 45;
  d.pages = [[10, 25], [25, 45], [45, 60]].map(([startFrame,endFrame],i)=>({id:'p'+i,text:{'en-US':'Page '+i,'ja-JP':'頁'+i},startFrame,endFrame,revealFrames:endFrame-startFrame}));
  return new ProjectSession(f);
};
const line = session => session.snapshot().scene.dialogues[0];
const ranges = session => line(session).pages.map(p=>[p.startFrame,p.endFrame,p.revealFrames]);
function reversible(session, edit, verify) {
  const before=session.snapshot(),rev=session.revision,history=session.history.length;
  assert.deepEqual(applyTimelineEdit(session,edit),{revision:rev+1,changed:true});
  assert.equal(session.history.length,history+1);
  verify(); const after=session.snapshot(); session.undo();assert.deepEqual(session.snapshot(),before);session.redo();assert.deepEqual(session.snapshot(),after);
  assert.deepEqual(line(session).voice,before.scene.dialogues[0].voice);
  assert.deepEqual(line(session).pages.map(p=>p.text),before.scene.dialogues[0].pages.map(p=>p.text));
  assert.deepEqual(session.snapshot().scene.characters,before.scene.characters);
}
{
 const g=grouped();
 reversible(g,patch(20,70),()=>assert.deepEqual(ranges(g),[[20,35,15],[35,55,20],[55,70,15]]));
 reversible(g,patch(34,70),()=>{assert.deepEqual(ranges(g),[[34,35,1],[35,55,20],[55,70,15]]);assert.equal(line(g).revealFrames,36);});
 reversible(g,patch(34,56),()=>{assert.deepEqual(ranges(g),[[34,35,1],[35,55,20],[55,56,1]]);assert.equal(line(g).revealFrames,22);});
 reversible(g,{...patch(35,36),pageId:'p1'},()=>assert.deepEqual(ranges(g),[[34,35,1],[35,36,1],[36,56,1]]));
 reversible(g,patch(0,56),()=>assert.equal(line(g).pages[0].startFrame,0));
 reversible(g,patch(0,120),()=>assert.equal(line(g).pages[2].endFrame,120));
 const before=state(g);assert.equal(applyTimelineEdit(g,patch(0,120)).changed,false);assert.equal(state(g),before);
}
{
 const g=grouped();
 reversible(g,{...patch(10,44),pageId:'p0'},()=>assert.deepEqual(ranges(g),[[10,44,15],[44,45,1],[45,60,15]]));
 g.undo();const before=state(g);
 for(const bad of [patch(25,60),patch(10,45),patch(11,62),patch(80,130),patch(-1,49),
 {...patch(10,25),pageId:'missing'},{...patch(45,59),pageId:'p2'},
 {...patch(11,24),pageId:'p0'},{...patch(10,45),pageId:'p0'},
 {...patch(10,10),pageId:'p0'},{...patch(10,25),pageId:null},
 {...patch(10,25,'characters'),pageId:'p0'}, {...patch(10,25),parentId:'line'},
 {...patch(10,25),[Symbol('hidden')]:true}]){
  assert.throws(()=>applyTimelineEdit(g,bad));assert.equal(state(g),before);
 }
 assert.equal(applyTimelineEdit(g,{...patch(10,25),pageId:'p0'}).changed,false);assert.equal(state(g),before);assert.equal(g.redo(),true);
}
{
 const g=grouped();g.snapshot();
 // Voice starts at parent start, NOT left page start for boundary edit.
 g.apply(p=>{p.scene.dialogues[0].voice.durationSamples=160000;});
 reversible(g,{...patch(25,46),pageId:'p1'},()=>assert.equal(line(g).pages[1].endFrame,46));
 const before=state(g);assert.throws(()=>applyTimelineEdit(g,patch(21,71)),/语音超出/);assert.equal(state(g),before);
 // Left edge can also overflow voice even with no visual-end change.
 assert.throws(()=>applyTimelineEdit(g,patch(21,60)),/语音超出/);assert.equal(state(g),before);
 reversible(g,patch(20,70),()=>assert.equal(line(g).startFrame,20));
}
{
 const g=grouped();g.setDialoguePages('line',[{id:'sole',text:{'en-US':'Only'},startFrame:10,endFrame:60,revealFrames:50}]);
 reversible(g,patch(59,60),()=>{assert.equal(line(g).revealFrames,1);assert.deepEqual(ranges(g),[[59,60,1]]);});
 const unpaged=new ProjectSession(fixture());assert.throws(()=>applyTimelineEdit(unpaged,{...patch(10,25),pageId:'p0'}));
}
// Schema4 edits are resolved project timings, independent of global generation defaults.
function schema4Session(paged=true,mode='follow',hold=8){
 const p=fixture(),d=p.scene.dialogues[0];p.schemaVersion=4;p.characterDefinitions=[];p.scene.characters=[];d.speakerId='narrator';d.displayUntilFrame=d.endFrame+hold;delete d.voice;
 Object.assign(p.resources[0],{sampleRate:48000,durationSamples:48000});
 d.voiceClips=[{id:'v',resourceId:'voice',sampleRate:48000,durationSamples:48000,sourceOffsetSamples:0,binding:{dialogueId:d.id,mode,...(mode==='follow'?{followOffsetFrames:2}:{})},...(mode==='independent'?{startFrame:5}:{})}];
 if(paged){d.pages=[{id:'p0',text:{'en-US':'Hel','ja-JP':'こん'},startFrame:10,endFrame:30,revealFrames:15},{id:'p1',text:{'en-US':'lo','ja-JP':'にちは'},startFrame:30,endFrame:60,revealFrames:20}];d.fullText=structuredClone(d.text);d.text=structuredClone(d.pages[0].text);}
 return new ProjectSession(p);
}
for(const paged of [false,true])for(const mode of ['follow','independent']){
 const g=schema4Session(paged,mode),before=g.snapshot(),voice=structuredClone(line(g).voiceClips),r=g.revision;
 applyTimelineEdit(g,patch(20,70));assert.equal(line(g).displayUntilFrame,78);assert.deepEqual(line(g).voiceClips,voice);assert.equal(g.history.length,1);g.undo();assert.deepEqual(g.snapshot(),before);g.redo();assert.equal(line(g).displayUntilFrame,78);
 applyTimelineEdit(g,patch(20,80));assert.equal(line(g).displayUntilFrame,88);assert.deepEqual(line(g).voiceClips,voice);
 applyTimelineEdit(g,patch(20,paged?41:30));assert.equal(line(g).displayUntilFrame,(paged?41:30)+8);assert.deepEqual(line(g).voiceClips,voice,'shortening subtitle never trims source samples');
 const short=g.snapshot();applyTimelineEdit(g,patch(19,line(g).endFrame));assert.equal(line(g).displayUntilFrame,short.scene.dialogues[0].displayUntilFrame,'start resize leaves end and hold alone');
 const stable=state(g);assert.throws(()=>applyTimelineEdit(g,patch(19,113)),/字幕保持终点/);assert.equal(state(g),stable,'hold overflow rejects atomically without silent clipping');
}
{
 const g=schema4Session();const before=line(g);applyTimelineEdit(g,{...patch(10,40),pageId:'p0'});assert.equal(line(g).displayUntilFrame,before.displayUntilFrame);assert.deepEqual(line(g).voiceClips,before.voiceClips);
 const nohold=schema4Session(true,'follow',0);applyTimelineEdit(nohold,patch(10,100));assert.equal(line(nohold).displayUntilFrame,100);
 const exact=schema4Session(true,'follow',8);applyTimelineEdit(exact,patch(10,112));assert.equal(line(exact).displayUntilFrame,120);const stable=state(exact);assert.throws(()=>applyTimelineEdit(exact,patch(11,113)),/字幕保持终点/);assert.equal(state(exact),stable);
}
console.log('PASS schema4 timeline: preserve hold on move/resize, reject hold overflow, keep voice samples, exact undo/redo');
console.log('PASS T1 groups: translate, first/last trim, internal boundary, one-frame clamp, metadata, voice fit, strict atomic rollback and exact undo/redo');
// Exercise main mutation wrapper and preload contract without launching Electron.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const handlers = {}, sends = [];
class Window {
  constructor() { this.webContents = {send: (...args) => sends.push(args), once() {}}; }
  isDestroyed() { return false; } loadFile() {} on() {}
}
let resolveSave;
const electron = {app: {setPath() {}, whenReady: () => ({then: fn => fn()}), on() {}},
  BrowserWindow: Window, ipcMain: {handle: (name, fn) => { handlers[name] = fn; }},
  dialog: {showSaveDialog: () => new Promise(resolve => { resolveSave = resolve; })}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8'), {
  __dirname: root, JSON, process, setTimeout:()=>1, clearTimeout(){}, require(name) {
    if (name === './core/recovery.cjs') return {RecoveryStore:class{inspect(){return null;} clear(){}},normalizeDraft:require('./recovery.cjs').normalizeDraft};
    if (name === 'electron') return electron;
    return name.startsWith('./core/') ? require(path.join(root, name)) : require(name);
  }
});
const initial = handlers.project();
const character = initial.project.scene.characters[0];
const ipcPatch = patch(character.visibleFrom + 1, character.visibleTo, 'characters', character.id);
assert.deepEqual(handlers['edit-timeline']({}, ipcPatch), {revision: initial.revision + 1, changed: true});
assert.equal(sends.length, 1);
assert.deepEqual(handlers['edit-timeline']({}, ipcPatch), {revision: initial.revision + 1, changed: false});
assert.equal(sends.length, 2);
assert.throws(() => handlers['edit-timeline']({}, {...ipcPatch, endFrame: -1}));
assert.equal(sends.length, 2);
assert.equal(handlers.project().revision, initial.revision + 1);
const saving = handlers['save-as']();
assert.throws(() => handlers['edit-timeline']({}, ipcPatch), /稍后重试/);
resolveSave({canceled: true});
let bridge, invocation;
vm.runInNewContext(fs.readFileSync(path.join(root, 'renderer/preload.cjs'), 'utf8'), {
  require: () => ({contextBridge: {exposeInMainWorld: (name, api) => { assert.equal(name, 'replay'); bridge = api; }},
    ipcRenderer: {invoke: (...args) => { invocation = args; return 'result'; }}})
});
assert.equal(bridge.editTimeline(ipcPatch), 'result');
assert.deepEqual(invocation, ['edit-timeline', ipcPatch]);
saving.then(() => console.log('PASS timeline editing: moves, resize edges, bounds, reveal, voice samples, metadata, rollback, undo/redo, no-op, IPC busy guard and preload')).catch(error => { console.error(error); process.exitCode = 1; });
