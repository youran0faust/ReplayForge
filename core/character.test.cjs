const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {randomUUID} = require('crypto');
const {ProjectSession} = require('./session.cjs');
const {clone, validateProject} = require('./model.cjs');
const {saveSessionPortable, openPortable} = require('./project-storage.cjs');
const root = path.join(__dirname, '..');
const example = JSON.parse(fs.readFileSync(path.join(root, 'examples/rain-corridor.json'), 'utf8').replace(/^\uFEFF/, ''));
const alice = example.scene.characters[0].id;
const dialogueId = example.scene.dialogues[0].id;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function unchanged(session, action) {
  const before = JSON.stringify(session);
  assert.throws(action);
  assert.equal(JSON.stringify(session), before, 'failed action leaves project, revision, saved revision and history untouched');
}

function roundTrip(session, action) {
  const before = session.snapshot(), revision = session.revision, history = session.history.length;
  const result = action();
  const after = session.snapshot();
  assert.equal(session.revision, revision + 1);
  assert.equal(session.history.length, history + 1);
  assert.equal(session.undo(), true);
  assert.deepEqual(session.snapshot(), before);
  assert.equal(session.redo(), true);
  assert.deepEqual(session.snapshot(), after);
  return result;
}

test('add defaults are UUID, fully visible fallback without resource binding; undo/redo preserves identity', () => {
  const session = new ProjectSession(example);
  const id = roundTrip(session, () => session.addCharacter());
  assert.match(id, uuid);
  assert.deepEqual(session.snapshot().scene.characters[1], {id, name:'新角色', x:180, y:100, width:240, height:360, color:'#d58b9c', visibleFrom:0, visibleTo:438});
  assert.deepEqual(session.snapshot().resources, example.resources);
  assert.equal(session.evaluate(0).characters.length, 2);
  assert.equal(session.evaluate(437).characters.length, 2);
  assert.equal(session.evaluate(438).characters.length, 0);
  assert.notEqual(session.addCharacter(), id);
  const small = clone(example);
  small.design.width = 100; small.design.height = 80;
  const tiny = new ProjectSession(small), tinyId = tiny.addCharacter();
  const character = tiny.snapshot().scene.characters.find(c => c.id === tinyId);
  assert.deepEqual([character.x,character.y,character.width,character.height], [0,0,100,80]);
});

test('edits are atomic partial patches, preserve resources and dialogue data, and use half-open visibility', () => {
  const session = new ProjectSession(example);
  roundTrip(session, () => session.editCharacter(alice, {name:'爱丽丝', x:-12.5, y:42.25, width:8192, height:0.5, visibleFrom:25, visibleTo:100}));
  const character = session.snapshot().scene.characters[0];
  assert.equal(character.name, '爱丽丝');
  assert.equal(character.resourceId, example.scene.characters[0].resourceId);
  assert.deepEqual(session.snapshot().scene.dialogues, example.scene.dialogues);
  assert.equal(session.evaluate(24).characters.length, 0);
  assert.equal(session.evaluate(25).characters.length, 1);
  assert.equal(session.evaluate(99).characters.length, 1);
  assert.equal(session.evaluate(100).characters.length, 0);
  session.editCharacter(alice, {name:'Only the name'});
  assert.deepEqual(session.snapshot().scene.characters[0], {...character, name:'Only the name'});
});

test('invalid patches, references and IDs roll back without destroying redo', () => {
  const session = new ProjectSession(example);
  session.addCharacter(); session.undo();
  const invalid = [null, [], 'name', {name:''}, {name:'  '}, {name:42}, {x:NaN}, {x:Infinity}, {y:-Infinity}, {x:'3'}, {x:undefined},
    {width:0}, {height:-1}, {width:8193}, {height:8193}, {width:NaN}, {height:Infinity}, {height:'360'},
    {visibleFrom:-1}, {visibleFrom:1.2}, {visibleTo:1.5}, {visibleTo:0}, {visibleFrom:100,visibleTo:100}, {visibleFrom:100,visibleTo:99}, {visibleTo:439},
    {visibleTo:Infinity}, {visibleFrom:undefined}, {id:'changed'}, {resourceId:'new-image'}, {color:'red'}, {name:'must roll back',width:0}];
  for (const patch of invalid) unchanged(session, () => session.editCharacter(alice, patch));
  unchanged(session, () => session.editCharacter('missing', {name:'Nobody'}));
  unchanged(session, () => session.deleteCharacter('missing'));
  unchanged(session, () => session.deleteCharacter('narrator'));
  unchanged(session, () => session.setDialogueSpeaker(dialogueId, 'missing'));
  unchanged(session, () => session.setDialogueSpeaker(dialogueId, null));
  unchanged(session, () => session.setDialogueSpeaker('missing', alice));
  unchanged(session, () => session.apply(p => {p.scene.characters[0].width = Infinity;}));
  assert.equal(session.redo(), true);
  assert.equal(session.snapshot().scene.characters.length, 2);
});

test('speaker assignment preserves timing, text and voice; deleting linked speaker retargets every reference in one transaction', () => {
  const session = new ProjectSession(example), second = session.addCharacter();
  roundTrip(session, () => session.setDialogueSpeaker(dialogueId, second));
  assert.deepEqual(session.snapshot().scene.dialogues[0], {...example.scene.dialogues[0], speakerId:second});
  roundTrip(session, () => session.setDialogueSpeaker(dialogueId, 'narrator'));
  session.setDialogueSpeaker(dialogueId, alice);
  const additional = session.addDialogue();
  assert.equal(session.snapshot().scene.dialogues.find(d => d.id === additional).speakerId, alice);
  const unlinked = session.addDialogue();
  session.setDialogueSpeaker(unlinked, second);
  const before = session.snapshot();
  roundTrip(session, () => session.deleteCharacter(alice));
  const after = session.snapshot();
  assert.deepEqual(after.scene.dialogues, before.scene.dialogues.map(d => d.speakerId === alice ? {...d, speakerId:'narrator'} : d));
  assert.deepEqual(after.resources, before.resources);
  assert.deepEqual(after.scene.characters, before.scene.characters.filter(c => c.id !== alice));
  session.deleteCharacter(second);
  assert.ok(session.snapshot().scene.dialogues.every(d => d.speakerId === 'narrator'));
  const narratorDialogue = session.addDialogue();
  assert.equal(session.snapshot().scene.dialogues.find(d => d.id === narratorDialogue).speakerId, 'narrator');
});

test('model rejects missing fields, duplicate/reserved IDs, broken speakers and geometry; preserves samples', () => {
  assert.deepEqual(validateProject(example), []);
  for (const field of ['id','name','x','y','width','height','color','visibleFrom','visibleTo']) {
    const invalid = clone(example); delete invalid.scene.characters[0][field];
    assert.ok(validateProject(invalid).length, 'reject missing ' + field);
    assert.throws(() => new ProjectSession(invalid));
  }
  const changes = [p => p.scene.characters.push({...p.scene.characters[0]}), p => {p.scene.characters[0].id = 'narrator';},
    p => {p.scene.dialogues[0].speakerId = 'deleted';}, p => {delete p.scene.dialogues[0].speakerId;},
    p => {p.scene.characters[0].x = NaN;}, p => {p.scene.characters[0].height = 8193;},
    p => {p.scene.characters[0].visibleTo = 439;}, p => {p.scene.characters[0].resourceId = 'missing';}];
  for (const change of changes) {const invalid = clone(example); change(invalid); assert.ok(validateProject(invalid).length);}
  // Type annotations are the only intentional differences between the two validators.
  const ts = fs.readFileSync(path.join(__dirname, 'model.ts'), 'utf8');
  const tsBody = ts.slice(ts.indexOf('export function validateProject'), ts.indexOf('export function evaluate'))
    .replace('export function validateProject(p:Project):string[]', 'function validateProject(p)')
    .replace('const e:string[]', 'const e').replace("(['width', 'height', 'fps'] as const)", "['width', 'height', 'fps']")
    .replaceAll('new Set<string>()', 'new Set()');
  const context = {...require('./audio-envelope.cjs'),...require('./performance-model.cjs'),...require('./video-model.cjs'),...require('./portrait.cjs'),...require('./dialogue-pages.cjs'),...require('./character-definitions.cjs'),...require('./character-rows.cjs')}; vm.runInNewContext(tsBody + ';this.validate = validateProject;', context);
  for (const change of [() => {}, ...changes]) {const candidate = clone(example); change(candidate); assert.deepEqual(Array.from(context.validate(candidate)), validateProject(candidate));}
});

test('save/reopen retains edits and narrator links, resources stay portable after deletion and history rebasing', t => {
  const directory = path.join(root, 'test-output', 'characters-' + randomUUID());
  fs.mkdirSync(directory, {recursive:true});
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const session = new ProjectSession(example), id = session.addCharacter();
  session.editCharacter(id, {name:'保存角色',x:20,y:30,width:160,height:200,visibleFrom:10,visibleTo:420});
  session.setDialogueSpeaker(dialogueId, id);
  const direct = path.join(directory, 'direct.json'); session.save(direct);
  assert.deepEqual(ProjectSession.open(direct).snapshot(), session.snapshot());
  session.setDialogueSpeaker(dialogueId, alice); session.deleteCharacter(alice);
  const saved = saveSessionPortable(session, root, path.join(directory, 'portable', 'project.json'));
  const loaded = openPortable(saved.file), reopened = new ProjectSession(loaded.project);
  assert.deepEqual(reopened.snapshot(), saved.project);
  assert.equal(reopened.snapshot().scene.dialogues[0].speakerId, 'narrator');
  assert.equal(reopened.snapshot().scene.characters[0].name, '保存角色');
  assert.deepEqual(saved.project.resources.map(r => r.id), example.resources.map(r => r.id));
  for (const resource of saved.project.resources) assert.ok(fs.existsSync(path.join(saved.root, resource.path)));
  session.project = saved.project; session.history = saved.history; session.future = saved.future;
  assert.equal(session.undo(), true);
  assert.equal(session.snapshot().scene.dialogues[0].speakerId, alice);
  assert.ok(session.snapshot().scene.characters.some(c => c.id === alice));
  assert.equal(session.redo(), true);
  assert.deepEqual(session.snapshot(), saved.project);
});

test('main character and speaker IPC use mutation wrapper and return revision contracts', async () => {
  const handlers = {}, sends = []; let resolveDialog;
  class Window {
    constructor() {this.webContents = {mainFrame:{},send(...args){sends.push(args);},once(){}}; Window.instance = this;}
    isDestroyed(){return false;} loadFile(){} on(){}
  }
  const electron = {app:{setPath(){},whenReady(){return {then:fn=>fn()};},on(){}},BrowserWindow:Window,
    ipcMain:{handle:(channel, fn)=>{handlers[channel] = fn;}},dialog:{showSaveDialog:()=>new Promise(resolve=>{resolveDialog=resolve;})}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.cjs'), 'utf8').replace('examples/rain-corridor-v4.json','examples/rain-corridor.json'), {__dirname:root, JSON, process, setTimeout:()=>1, clearTimeout(){}, require(name){
    if(name === './core/recovery.cjs') return {RecoveryStore:class {inspect(){return null;} clear(){}}, normalizeDraft:require('./recovery.cjs').normalizeDraft};
    if(name === 'electron') return electron;
    if(name.startsWith('./core/')) return require(path.join(root, name));
    return require(name);
  }});
  const event = {sender:Window.instance.webContents, senderFrame:Window.instance.webContents.mainFrame};
  const added = handlers['add-character'](event);
  assert.deepEqual(Object.keys(added).sort(), ['id','revision']); assert.match(added.id, uuid); assert.equal(added.revision,1);
  assert.equal(handlers['edit-character'](event, added.id, {name:'IPC角色'}).revision,2);
  assert.equal(handlers['set-dialogue-speaker'](event, dialogueId, added.id).revision,3);
  assert.equal(handlers['delete-character'](event, added.id).revision,4);
  assert.equal(handlers.project().project.scene.dialogues[0].speakerId, 'narrator');
  assert.equal(sends.length,4);
  assert.throws(()=>handlers['edit-character'](event,alice,{x:NaN}));
  assert.throws(()=>handlers['set-dialogue-speaker'](event,dialogueId,'missing'));
  assert.equal(handlers.project().revision,4); assert.equal(sends.length,4);
  const saving = handlers['save-as']();
  assert.throws(()=>handlers['add-character'](event),/稍后重试/);
  assert.equal(handlers.project().revision,4);
  resolveDialog({canceled:true}); await saving;
  assert.equal(handlers['add-character'](event).revision,5);
});
