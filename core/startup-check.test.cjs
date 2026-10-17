'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {checkStartup, REQUIRED} = require('./startup-check.cjs');
const {run} = require('../run-electron.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-startup-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const appRoot = path.join(root, 'P2');
  const put = (name, content = 'fixture') => {
    const file = path.resolve(appRoot, name);
    fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, content);
    return file;
  };
  for (const name of REQUIRED) put(name);
  put('examples/rain-corridor-v4.json', JSON.stringify({schemaVersion:4, resources:[
    {path:'assets/rain-corridor.svg'}, {path:'assets/alice.svg'}, {path:'assets/alice-voice.wav'}
  ]}));
  put('../p0/node_modules/electron/dist/electron.exe');
  return {appRoot, put, root};
}
function tree(root) {
  return fs.readdirSync(root, {recursive:true}).sort().map(name => {
    const file = path.join(root, name), stat = fs.statSync(file);
    return [name, stat.isFile() ? fs.readFileSync(file).toString('base64') : null];
  });
}
test('check is read-only, structured and optional tools only warn', t => {
  const f = fixture(t), before = tree(f.root);
  const report = checkStartup({appRoot:f.appRoot, env:{}});
  assert.deepEqual(Object.keys(report), ['ok','errors','warnings','paths']);
  assert.equal(report.ok, true); assert.equal(report.warnings.length, 2);
  assert.equal(report.errors.length, 0);
  assert.equal(report.paths.recovery, path.join(f.appRoot, 'runtime-output/recovery'));
  assert.deepEqual(tree(f.root), before);
  assert.equal(fs.existsSync(path.join(f.appRoot, 'user-data')), false);
  assert.equal(fs.existsSync(path.join(f.appRoot, 'runtime-output')), false);
  f.put('../p0/tools/ffmpeg.exe'); f.put('../p0/tools/ffprobe.exe');
  assert.equal(checkStartup({appRoot:f.appRoot, env:{}}).warnings.length, 0);
  assert.throws(() => checkStartup({appRoot:'relative'}), /absolute/);
});
test('each required file and Electron missing or a directory blocks startup', async t => {
  const f = fixture(t);
  for (const name of [...REQUIRED, '../p0/node_modules/electron/dist/electron.exe']) {
    const file = path.resolve(f.appRoot, name), bytes = fs.readFileSync(file);
    fs.unlinkSync(file);
    let report = checkStartup({appRoot:f.appRoot, env:{}});
    assert.equal(report.ok, false, name); assert.ok(report.errors.some(e => e.includes(file)));
    fs.mkdirSync(file);
    assert.equal(checkStartup({appRoot:f.appRoot, env:{}}).ok, false, name);
    fs.rmdirSync(file); fs.writeFileSync(file, bytes);
  }
  fs.unlinkSync(path.join(f.appRoot, 'main.cjs'));
  assert.equal(await run([], {appRoot:f.appRoot, env:{}, spawnImpl:() => assert.fail('must not spawn'), stderr:() => {}}), 1);
});
test('default JSON and additional absolute/relative resource paths checked without loading code', t => {
  const f = fixture(t);
  f.put('examples/rain-corridor-v4.json', '{broken');
  assert.match(checkStartup({appRoot:f.appRoot, env:{}}).errors.join('\n'), /Invalid default project/);
  const extra = f.put('assets/extra.wav');
  f.put('examples/rain-corridor-v4.json', JSON.stringify({schemaVersion:4,resources:[{path:extra},{path:'assets/absent.wav'}]}));
  const report = checkStartup({appRoot:f.appRoot, env:{}});
  assert.equal(report.ok, false); assert.ok(report.paths.assets.includes(extra));
  assert.match(report.errors.join('\n'), /absent.wav/);
});
test('--check/help/unknown arguments never spawn; --check no writes', async t => {
  const f = fixture(t), before = tree(f.root), output = [];
  const options = {appRoot:f.appRoot, env:{}, spawnImpl:() => assert.fail('must not spawn'), stdout:s=>output.push(s), stderr:s=>output.push(s)};
  assert.equal(await run(['--check'], options), 0);
  assert.equal(JSON.parse(output.pop()).ok, true);
  assert.deepEqual(tree(f.root), before);
  assert.equal(await run(['--help'], options), 0); assert.match(output.pop(), /Usage:/);
  for (const args of [['--unknown'], ['--check','--help'], ['other-root']]) assert.equal(await run(args, options), 2);
  fs.unlinkSync(path.join(f.appRoot, 'main.cjs'));
  assert.equal(await run(['--check'], options), 1); assert.equal(JSON.parse(output.pop()).ok, false);
});
test('spawn inherits stdio, clears only child Electron node mode and shares recovery semantics', async t => {
  const f = fixture(t);
  for (const override of [undefined, 'custom-recovery', path.join(f.root, 'external-recovery')]) {
    const env = {ELECTRON_RUN_AS_NODE:'1', electron_run_as_node:'1', KEEP:'yes'};
    if (override !== undefined) env.REPLAY_RECOVERY_DIR = override;
    const before = {...env};
    const code = await run([], {appRoot:f.appRoot, env, stderr:()=>{}, spawnImpl:(exe,args,options)=>{
      assert.equal(exe, path.resolve(f.appRoot, '../p0/node_modules/electron/dist/electron.exe'));
      assert.deepEqual(args, [path.join(f.appRoot,'main.cjs')]);
      assert.equal(options.stdio, 'inherit'); assert.equal(options.cwd, f.appRoot);
      assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined); assert.equal(options.env.electron_run_as_node, undefined);
      assert.equal(options.env.KEEP, 'yes');
      assert.equal(options.env.REPLAY_RECOVERY_DIR, path.resolve(f.appRoot, override || 'runtime-output/recovery'));
      const child = new EventEmitter(); queueMicrotask(()=>child.emit('exit',0,null)); return child;
    }});
    assert.equal(code, 0); assert.deepEqual(env, before);
  }
});
test('spawn throw/error/signal/null exit never count as success, nonzero preserved', async t => {
  const f = fixture(t);
  for (const mode of ['throw','error','signal','null',7]) {
    const messages = [];
    const code = await run([], {appRoot:f.appRoot, env:{}, stderr:s=>messages.push(s), spawnImpl:()=>{
      if (mode === 'throw') throw new Error('stub spawn throw');
      const child = new EventEmitter();
      queueMicrotask(()=>{
        if (mode === 'error') { child.emit('error',new Error('stub spawn error')); child.emit('exit',0,null); }
        else child.emit('exit', mode === 7 ? 7 : null, mode === 'signal' ? 'SIGTERM' : null);
      });
      return child;
    }});
    assert.equal(code, mode === 7 ? 7 : 1);
    assert.ok(messages.some(message=>/spawn failed|signal|valid exit code|code 7/.test(message)));
  }
});
test('BAT required/default-asset list stays aligned and requires neither Node nor npm', () => {
  const bat = fs.readFileSync(path.resolve(__dirname,'../启动P2编辑器.bat'),'utf8');
  const required = [...bat.matchAll(/^call :required "([^"]+)"/gm)].map(m=>m[1].replaceAll('\\','/'));
  assert.deepEqual(required, ['../p0/node_modules/electron/dist/electron.exe', ...REQUIRED]);
  const project = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../examples/rain-corridor-v4.json'),'utf8'));
  for (const r of project.resources) assert.ok(required.includes(r.path), r.path);
  assert.match(bat, /if not defined REPLAY_RECOVERY_DIR set/);
  assert.match(bat, /set "ELECTRON_RUN_AS_NODE="/);
  assert.match(bat, /set "EDITOR_EXIT=%ERRORLEVEL%"/);
  assert.match(bat, /exit \/b %EDITOR_EXIT%/);
  assert.match(bat, /pause\nexit \/b 1/);
  assert.doesNotMatch(bat, /^\s*(?:call\s+)?(?:node|npm|npx)(?:\s|$)/mi);
  for (const tool of ['ffmpeg','ffprobe']) assert.ok(bat.includes(`call :optional "..\\p0\\tools\\${tool}.exe"`));
});
