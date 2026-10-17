const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');
const {RecoveryStore, normalizeDraft} = require('./recovery.cjs');
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-recovery-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const root = path.join(base,'source'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,'import.txt'),'unsaved imported bytes');
  const project = {schemaVersion:1,id:'test',locale:'en-US',design:{width:100,height:100,fps:30},resources:[{id:'a',path:'import.txt'}],scene:{durationFrames:30,characters:[],dialogues:[]}};
  const draft = {text:'{ invalid JSON\n',baseRevision:2,dirty:true,stale:true};
  const store = new RecoveryStore(path.join(base,'recovery'));
  return {base,root,project,draft,store, input:{root,project,draft,revision:3}};
}
test('recovery preserves invalid draft and portable unsaved resources after relocation', t=>{
  const {base,root,project,draft,store,input}=fixture(t), before=JSON.stringify(project);
  const formal=path.join(root,'formal.json'); fs.writeFileSync(formal,'DO NOT OVERWRITE');
  store.write({...input,originalFile:formal});
  assert.equal(fs.readFileSync(formal,'utf8'),'DO NOT OVERWRITE'); assert.equal(JSON.stringify(project),before);
  const relocated=path.join(base,'moved'); fs.renameSync(store.root,relocated); fs.rmSync(root,{recursive:true});
  const restored=new RecoveryStore(relocated).open();
  assert.deepEqual(restored.draft,draft); assert.equal(restored.revision,3);
  assert.equal(fs.readFileSync(path.join(restored.root,restored.project.resources[0].path),'utf8'),'unsaved imported bytes');
});
test('failed portable snapshot leaves previous pointer and generation intact',t=>{
  const {store,input}=fixture(t); store.write(input); const old=fs.readFileSync(store.pointer,'utf8');
  input.project.resources[0].path='missing.txt';
  assert.throws(()=>store.write(input)); assert.equal(fs.readFileSync(store.pointer,'utf8'),old); assert.ok(store.open());
  assert.equal(fs.readdirSync(store.root).filter(n=>n.startsWith('gen-')).length,1);
});
test('failed atomic pointer rename retains previous recovery',t=>{
  const {store,input}=fixture(t); store.write(input); const old=fs.readFileSync(store.pointer,'utf8');
  const rename=fs.renameSync; fs.renameSync=(from,to)=>{if(to===store.pointer)throw Error('injected publication failure'); return rename(from,to);};
  try { assert.throws(()=>store.write(input),/publication failure/); } finally { fs.renameSync=rename; }
  assert.equal(fs.readFileSync(store.pointer,'utf8'),old); assert.ok(store.open());
  assert.equal(fs.readdirSync(store.root).filter(n=>n.endsWith('.tmp')).length,0);
});
test('bounds own generations and protects restored source and unrelated files',t=>{
  const {store,input}=fixture(t); store.write(input); const restored=store.open();
  const foreign=path.join(store.root,'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign,'keep'),'safe');
  for(let n=0;n<5;n++)store.write({...input,root:restored.root,project:restored.project,revision:n});
  assert.ok(fs.existsSync(restored.root)); assert.equal(fs.readFileSync(path.join(foreign,'keep'),'utf8'),'safe');
  assert.ok(fs.readdirSync(store.root).filter(n=>n.startsWith('gen-')).length<=3);
  store.clear(); assert.equal(store.inspect(),null); assert.ok(fs.existsSync(restored.root));
});
test('corrupt and traversal pointers fail without deleting recovery',t=>{
  const {store,input}=fixture(t); store.write(input);
  fs.writeFileSync(store.pointer,'{broken'); assert.throws(()=>store.open()); assert.equal(fs.readFileSync(store.pointer,'utf8'),'{broken');
  fs.writeFileSync(store.pointer,JSON.stringify({format:'replay-recovery',generation:'../source'})); assert.throws(()=>store.open(),/pointer/);
  assert.throws(()=>normalizeDraft({text:'bad',baseRevision:-1,dirty:true,stale:false}));
});
