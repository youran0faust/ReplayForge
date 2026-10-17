const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {savePortable, saveSessionPortable, openPortable} = require('./project-storage.cjs');
const {ProjectSession} = require('./session.cjs');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'portable-project-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const source = path.join(base, 'source'), target = path.join(base, 'saved');
  fs.mkdirSync(source); fs.mkdirSync(target);
  fs.mkdirSync(path.join(source, 'one')); fs.mkdirSync(path.join(source, 'two'));
  fs.writeFileSync(path.join(source, 'one', '雨 #1.txt'), 'first');
  fs.writeFileSync(path.join(source, 'two', '雨 #1.txt'), 'second');
  const project = {schemaVersion: 1, id: 'test', locale: 'en-US', design: {width: 100, height: 100, fps: 30},
    resources: [{id: 'a', path: 'one/雨 #1.txt'}, {id: 'b', path: 'two/雨 #1.txt'}, {id: 'duplicate', path: 'one/雨 #1.txt'}],
    scene: {durationFrames: 30, characters: [], dialogues: []}};
  return {base, source, target, project, file: path.join(target, '工程 #1.json')};
}

test('copies all resources, preserves inputs, deduplicates refs and survives relocation', t => {
  const {base, source, target, project, file} = fixture(t);
  const before = structuredClone(project);
  const saved = savePortable(project, 7, source, file);
  assert.deepEqual(project, before);
  assert.notEqual(saved.project, project);
  assert.equal(saved.root, target); assert.equal(saved.file, file);
  assert.equal(fs.readFileSync(path.join(source, project.resources[0].path), 'utf8'), 'first');
  assert.equal(saved.project.resources[0].path, saved.project.resources[2].path);
  assert.notEqual(saved.project.resources[0].path, saved.project.resources[1].path);
  assert.match(saved.project.resources[0].path, /assets[\\/]([a-f0-9]{64})\.txt$/);
  const moved = path.join(base, 'relocated');
  fs.renameSync(target, moved); fs.rmSync(source, {recursive: true});
  const opened = openPortable(path.join(moved, path.basename(file)));
  assert.equal(opened.revision, 7); assert.equal(opened.root, moved);
  assert.deepEqual(opened.project, saved.project);
  assert.deepEqual(opened.project.resources.map(r => fs.readFileSync(path.join(opened.root, r.path), 'utf8')), ['first', 'second', 'first']);
});

test('repeated saves deduplicate unchanged bytes and preserve old assets', t => {
  const {source, target, project, file} = fixture(t);
  const first = savePortable(project, 1, source, file);
  const old = path.join(first.root, first.project.resources[0].path);
  fs.writeFileSync(path.join(source, project.resources[0].path), 'updated');
  const second = savePortable(project, 2, source, file);
  assert.notEqual(first.project.resources[0].path, second.project.resources[0].path);
  assert.equal(fs.readFileSync(old, 'utf8'), 'first');
  const third = savePortable(project, 3, source, file);
  assert.equal(third.project.resources[1].path, second.project.resources[1].path);
  assert.equal(fs.readdirSync(path.join(target, 'assets')).length, 3);
  assert.equal(openPortable(file).revision, 3);
});

test('saving an opened project in place preserves previous snapshot assets', t => {
  const {source, project, file} = fixture(t);
  const first = savePortable(project, 1, source, file);
  const original = structuredClone(first.project);
  const second = savePortable(first.project, 2, first.root, first.file);
  assert.deepEqual(first.project, original);
  assert.equal(second.project.resources[0].path, first.project.resources[0].path);
  for (const resource of first.project.resources) assert.ok(fs.existsSync(path.join(first.root, resource.path)));
  assert.deepEqual(openPortable(file).project, second.project);
});

test('save session rebases undo and redo snapshots including history-only resources', t => {
  const {base, source, project} = fixture(t); const target = path.join(base, 'portable'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(source, 'two', 'future.txt'), 'future');
  const session = new ProjectSession(project);
  session.apply(p => p.resources.push({id:'future', path:'two/future.txt'}), 'add resource');
  session.undo();
  const file = path.join(target, 'session.json');
  const saved = saveSessionPortable(session, source, file);
  assert.equal(saved.history.length, 0); assert.equal(saved.future.length, 1);
  session.project = saved.project; session.history = saved.history; session.future = saved.future;
  fs.rmSync(source, {recursive:true, force:true});
  assert.equal(session.redo(), true);
  assert.equal(fs.readFileSync(path.join(saved.root, session.project.resources.find(r=>r.id==='future').path), 'utf8'), 'future');
  assert.equal(session.undo(), true);
  assert.equal(session.project.resources.some(r=>r.id==='future'), false);
  assert.equal(session.future[0].project.resources[0].path.includes('assets/'), true);
  assert.equal(fs.readFileSync(path.join(saved.root, session.future[0].project.resources.find(r=>r.id==='future').path), 'utf8'), 'future');
});

test('session save failure preserves current history future revision and manifest', t => {
  const {source, project, file} = fixture(t); const session = new ProjectSession(project);
  session.apply(p => {p.title='one'}, 'first');session.apply(p => {p.title='two'}, 'second');session.undo();
  const before=JSON.stringify(session);fs.writeFileSync(file,'old manifest');const rename=fs.renameSync;
  fs.renameSync=()=>{throw Error('session commit failure')};
  try {assert.throws(()=>saveSessionPortable(session,source,file),/session commit failure/)} finally {fs.renameSync=rename}
  assert.equal(JSON.stringify(session),before);assert.equal(fs.readFileSync(file,'utf8'),'old manifest');
  const saved=saveSessionPortable(session,source,file);assert.equal(saved.history[0].label,'first');assert.equal(saved.future.length,1);assert.equal(JSON.stringify(session),before);
});

test('preflight rejects missing, directory, absolute and escaping resource paths without mutation', t => {
  const {base, source, project, file} = fixture(t);
  fs.writeFileSync(path.join(base, 'outside'), 'private');
  fs.writeFileSync(file, 'existing manifest');
  for (const invalid of ['missing', 'one', '../outside', path.join(base, 'outside')]) {
    const bad = structuredClone(project); bad.resources[1].path = invalid;
    const before = structuredClone(bad);
    assert.throws(() => savePortable(bad, 0, source, file));
    assert.deepEqual(bad, before);
    assert.equal(fs.readFileSync(file, 'utf8'), 'existing manifest');
  }
  assert.equal(fs.existsSync(path.join(path.dirname(file), 'assets')), false);
});

test('manifest target cannot overwrite a registered source resource', t => {
  const {source, project} = fixture(t);
  const file = path.join(source, project.resources[0].path);
  assert.throws(() => savePortable(project, 0, source, file), /source resource/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'first');
});

test('disk-full (ENOSPC) during asset copy preserves prior snapshot and cleans partial save', t => {
  const {source, target, project, file} = fixture(t);
  const first = savePortable(project, 1, source, file);
  const beforeManifest = fs.readFileSync(file, 'utf8');
  const beforeAssets = fs.readdirSync(path.join(target, 'assets')).sort();
  const realCopy = fs.copyFileSync; let calls = 0;
  fs.copyFileSync = (...args) => {
    if (++calls === 1) return realCopy(...args);
    const error = Error('simulated disk full'); error.code = 'ENOSPC'; throw error;
  };
  try {
    fs.writeFileSync(path.join(source, project.resources[0].path), 'changed before ENOSPC');
    fs.writeFileSync(path.join(source, project.resources[1].path), 'changed second before ENOSPC');
    assert.throws(() => savePortable(project, 2, source, file), error => error && error.code === 'ENOSPC');
  } finally { fs.copyFileSync = realCopy; }
  assert.equal(fs.readFileSync(file, 'utf8'), beforeManifest);
  assert.deepEqual(fs.readdirSync(path.join(target, 'assets')).sort(), beforeAssets);
  assert.equal(fs.readdirSync(target).filter(name => name.includes('.tmp')).length, 0);
  assert.equal(first.revision, 1);
});

test('copy, manifest write and rename failures clean only this save assets and temp', t => {
  const {source, target, project, file} = fixture(t);
  savePortable(project, 1, source, file);
  const before = fs.readFileSync(file, 'utf8'), directories = fs.readdirSync(path.join(target, 'assets'));
  const original = structuredClone(project);
  for (const method of ['copyFileSync', 'writeFileSync', 'renameSync']) {
    const real = fs[method]; let calls = 0;
    fs.writeFileSync(path.join(source, project.resources[0].path), 'changed-' + method);
    fs[method] = (...args) => {
      if (method !== 'copyFileSync' || ++calls === 1) throw Error('injected ' + method);
      return real(...args);
    };
    try { assert.throws(() => savePortable(project, 2, source, file), /injected/); }
    finally { fs[method] = real; }
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(target, 'assets')), directories);
    assert.deepEqual(fs.readdirSync(target).sort(), ['assets', path.basename(file)].sort());
    assert.deepEqual(project, original);
    fs.writeFileSync(path.join(source, project.resources[0].path), 'first');
  }
});

test('reads BOM envelope/raw, defaults to manifest directory and accepts explicit legacy raw root', t => {
  const {source, project, file} = fixture(t);
  const saved = savePortable(project, 4, source, file);
  fs.writeFileSync(file, '\uFEFF' + fs.readFileSync(file, 'utf8'));
  assert.equal(openPortable(file).revision, 4);
  fs.writeFileSync(file, '\uFEFF' + JSON.stringify(saved.project));
  assert.deepEqual(openPortable(file).project, saved.project);
  assert.equal(openPortable(file).revision, 0);
  fs.writeFileSync(file, JSON.stringify(project));
  assert.throws(() => openPortable(file));
  assert.equal(openPortable(file, source).root, source);
});

test('open rejects invalid models, formats, revisions and missing/non-file/outside resources', t => {
  const {source, project, file} = fixture(t);
  const saved = savePortable(project, 0, source, file);
  for (const data of [null, {}, {...saved.project, schemaVersion: 999},
    {format: 'unknown', revision: 0, project: saved.project},
    {format: 'replay-project', revision: -1, project: saved.project}]) {
    fs.writeFileSync(file, JSON.stringify(data)); assert.throws(() => openPortable(file));
  }
  for (const invalid of ['missing', 'assets', '../source/one/雨 #1.txt']) {
    const bad = structuredClone(saved.project); bad.resources[0].path = invalid;
    fs.writeFileSync(file, JSON.stringify(bad)); assert.throws(() => openPortable(file));
  }
});

test('rejects resource and target asset symlinks outside root', t => {
  const {base, source, target, project, file} = fixture(t);
  const outside = path.join(base, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret'), 'private');
  // Junctions do not require Windows symlink privileges.
  fs.symlinkSync(outside, path.join(source, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const bad = structuredClone(project); bad.resources[0].path = 'escape/secret';
  assert.throws(() => savePortable(bad, 0, source, file), /escapes/);
  const raw = path.join(source, 'raw.json'); fs.writeFileSync(raw, JSON.stringify(bad));
  assert.throws(() => openPortable(raw), /escapes/);
  fs.symlinkSync(outside, path.join(target, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => savePortable(project, 0, source, file), /ordinary directory/);
  assert.deepEqual(fs.readdirSync(outside), ['secret']);
});

test('large text and many resources/characters/dialogues survive save and reopen', t => {
  const {base, source, target} = fixture(t);
  const resources = [], bytes = [];
  for (let i = 0; i < 48; i++) {
    const relative = path.join('imports', `资源-${i}`, `asset-${i}.bin`);
    const filename = path.join(source, relative);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    const data = Buffer.from(`asset-${i}\\0` + '内容'.repeat(i + 1) + '\\n' + 'A'.repeat(257));
    fs.writeFileSync(filename, data); bytes.push(data);
    resources.push({id: `asset_${i}`, path: relative.split(path.sep).join('/'), kind: 'data', mime: 'application/octet-stream'});
  }
  const durationFrames = 12000;
  const characters = Array.from({length: 200}, (_, i) => ({
    id: `character_${i}`, name: `角色 ${i} · 雨夜`, x: i, y: i % 100,
    width: 120, height: 240, color: '#d58b9c', visibleFrom: 0,
    visibleTo: durationFrames, resourceId: resources[i % resources.length].id
  }));
  const largeText = ('长文本🙂かな العربية — line\\n').repeat(7000);
  const dialogues = Array.from({length: 200}, (_, i) => ({
    id: `dialogue_${i}`, speakerId: characters[i].id,
    text: {'zh-CN': `${i}: ${largeText}`, 'en-US': `dialogue ${i}: ${largeText}`},
    startFrame: i * 50, endFrame: i * 50 + 40, revealFrames: 30
  }));
  const project = {schemaVersion: 1, id: 'large-integration', title: '大型保存集成测试', locale: 'zh-CN',
    design: {width: 1920, height: 1080, fps: 30}, resources,
    scene: {durationFrames, background: {kind: 'image', resourceId: resources[0].id}, characters, dialogues}};
  const before = structuredClone(project), file = path.join(target, 'large.json');
  const saved = savePortable(project, 42, source, file);
  assert.deepEqual(project, before);
  assert.equal(saved.project.scene.characters.length, 200);
  assert.equal(saved.project.scene.dialogues.length, 200);
  assert.ok(fs.statSync(file).size > 1000000);
  const moved = path.join(base, 'moved'); fs.renameSync(target, moved); fs.rmSync(source, {recursive: true, force: true});
  const opened = openPortable(path.join(moved, 'large.json'));
  assert.equal(opened.revision, 42);
  assert.deepEqual(opened.project, saved.project);
  assert.deepEqual(opened.project.resources.map(r => fs.readFileSync(path.join(opened.root, r.path))), bytes);
});
