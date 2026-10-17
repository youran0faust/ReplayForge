'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
const {checkExportDependencies} = require('./export-dependencies.cjs');
const root = path.resolve(__dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '导出 依赖-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return {appRoot:path.join(dir, '中文 应用'), ffmpegPath:path.join(dir, 'p0/tools/ffmpeg.exe')};
}
function install(f) { fs.mkdirSync(path.dirname(f.ffmpegPath), {recursive:true}); fs.writeFileSync(f.ffmpegPath, 'ordinary file, not an executable'); }

test('real filesystem: missing/directory fail; ordinary file in Unicode/spaced path suffices without ffprobe', t => {
  const f = fixture(t);
  assert.throws(() => checkExportDependencies(f), /无法导出：缺少FFmpeg运行文件.*修复相邻p0\/tools，不修改工程/);
  fs.mkdirSync(f.ffmpegPath, {recursive:true});
  assert.throws(() => checkExportDependencies(f), /不是普通文件/);
  fs.rmdirSync(f.ffmpegPath); install(f);
  assert.deepEqual(checkExportDependencies(f), {ffmpegPath:f.ffmpegPath});
  assert.equal(fs.existsSync(path.join(path.dirname(f.ffmpegPath), 'ffprobe.exe')), false);
});

test('default check uses actual trusted installation, not project/env supplied paths', t => {
  const f = fixture(t); install(f);
  const trusted = path.resolve(root, '../p0/tools/ffmpeg.exe');
  let present = false;
  try { present = fs.statSync(trusted).isFile(); } catch (_) {}
  const options = {projectRoot:f.appRoot, ffmpegPath:f.ffmpegPath, project:{ffmpegPath:f.ffmpegPath}};
  if (present) assert.deepEqual(checkExportDependencies(options), {ffmpegPath:trusted});
  else assert.throws(() => checkExportDependencies(options), e => e.message.includes(trusted));
});

function observedHelper(stats, fsImpl = fs) {
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'export-dependencies.cjs'), 'utf8'), {
    __dirname, module, require(name) {
      if (name === 'path') return path;
      assert.equal(name, 'fs', 'helper may require only filesystem/path, never processes');
      return {statSync(file) { stats.push(file); return fsImpl.statSync(file); }};
    }
  });
  return module.exports;
}

test('main missing dependency is after guards and leaves no writes, child, job, lock or project mutation', async t => {
  const f = fixture(t), stats = [], helper = observedHelper(stats), handlers = {};
  const main = path.join(root, 'main.cjs'), real = require('module').createRequire(main);
  const contents = {mainFrame:{}}, win = {webContents:contents, isDestroyed:() => false};
  const project = {sentinel:'unchanged'}, session = {revision:4, savedRevision:4, snapshot:() => project};
  const writes = [], children = [];
  const fakeFs = new Proxy({}, {get:(_, method) => (...args) => { writes.push([method, args]); throw Error('unexpected fs operation'); }});
  const context = vm.createContext({__dirname:f.appRoot, process, console, setTimeout, clearTimeout,
    require(name) {
      if (name === 'electron') return {app:{setPath(){}, whenReady:() => ({then(){}}), on(){}}, ipcMain:{handle:(n, fn) => handlers[n] = fn}};
      if (name === 'fs') return fakeFs;
      if (name === 'child_process') return {spawn:() => {children.push(true); throw Error('unexpected child');}};
      if (name === './core/export-dependencies.cjs') return helper;
      return real(name);
    }
  });
  vm.runInContext(fs.readFileSync(main, 'utf8') + '\nthis.setup=(s,w)=>{session=s;win=w;};this.flags=(key,value)=>eval(key+"=value");this.inspect=()=>({busy,exporting,activeExport,dirty:isDirty(),draftVersion});', context);
  context.setup(session, win);
  const event = {sender:contents, senderFrame:contents.mainFrame}, before = JSON.stringify(context.inspect());
  await assert.rejects(handlers['export-current']({sender:{}}), /窗口/);
  await assert.rejects(handlers['export-current']({...event, senderFrame:{}}), /主窗口/);
  context.flags('busy', true); await assert.rejects(handlers['export-current'](event), /读写/); context.flags('busy', false);
  for (const flag of ['characterDefinitionDraftDirty','textImportDraftDirty','characterPerformanceDraftDirty','scenePerformanceDraftDirty']) {
    context.flags(flag, true); await assert.rejects(handlers['export-current'](event), /先应用/); context.flags(flag, false);
  }
  context.flags('exporting', true); await assert.rejects(handlers['export-current'](event), /已有导出/); context.flags('exporting', false);
  assert.deepEqual(stats, [], 'guards must run before stat');
  for (let i=0; i<2; i++) await assert.rejects(handlers['export-current'](event), /无法导出：缺少FFmpeg运行文件/);
  assert.deepEqual(stats, [f.ffmpegPath, f.ffmpegPath]);
  assert.deepEqual(writes, []); assert.deepEqual(children, []);
  assert.equal(JSON.stringify(context.inspect()), before);
  assert.equal(JSON.stringify(project), '{"sentinel":"unchanged"}');
  assert.equal(handlers['cancel-export'](event).cancelled, false);
});

test('standalone worker checks before input, frames, screenshots, child and video provider; valid FFmpeg advances without ffprobe', async t => {
  const f = fixture(t);
  async function run() {
    const stats = [], operations = [], helper = observedHelper(stats);
    let promise, exitCode;
    const stop = Error('input reached');
    vm.runInNewContext(fs.readFileSync(path.join(root, 'export-main.cjs'), 'utf8'), {
      __dirname:f.appRoot, process:{env:{REPLAY_PROJECT_ROOT:'untrusted project'}}, console:{error(){}},
      require(name) {
        if (name === 'electron') return {app:{disableHardwareAcceleration(){}, commandLine:{appendSwitch(){}}, setPath(){}, getPath:() => 'profile', whenReady:() => ({then(fn) { promise = fn(); return promise; }}), exit(code) {exitCode=code;}}, BrowserWindow:class {constructor(){operations.push('window');}}};
        if (name === 'fs') return new Proxy({}, {get:(_, method) => () => {operations.push(method); throw stop;}});
        if (name === 'child_process') return {spawn() {operations.push('spawn'); throw stop;}};
        if (name === './core/export-dependencies.cjs') return helper;
        if (['./core/session.cjs','./core/resource-index.cjs','./core/audio-timeline.cjs'].includes(name)) return {};
        assert.ok(['path','url'].includes(name), 'no video provider before check'); return require(name);
      }
    });
    await assert.rejects(promise, /缺少FFmpeg|input reached/);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(exitCode, 1); assert.deepEqual(stats, [f.ffmpegPath]);
    return operations;
  }
  assert.deepEqual(await run(), []);
  fs.mkdirSync(f.ffmpegPath, {recursive:true}); assert.deepEqual(await run(), []);
  fs.rmdirSync(f.ffmpegPath); install(f);
  assert.deepEqual(await run(), ['readFileSync']);
});
