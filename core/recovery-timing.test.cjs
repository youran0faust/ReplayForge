const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const mainFile = path.join(__dirname, '../main.cjs');
const mainRequire = createRequire(mainFile);

// Execute real main/session/sample, but never launch Electron or write resources.
// Starting at zero also catches accidental truthy timestamp sentinels.
async function fixture() {
  let now = 0, nextTimer = 1, ready, window, clears = 0;
  const timers = new Map(), handlers = new Map(), writes = [];
  class FakeDate extends Date { static now() { return now; } }
  class BrowserWindow {
    constructor() {
      window = this;
      this.events = new Map();
      this.webContents = {mainFrame: {}, send() {},
        once: (name, callback) => { if (name === 'did-finish-load') callback(); }};
    }
    on(name, callback) { this.events.set(name, callback); }
    isDestroyed() { return false; }
    loadFile() {}
    close() { this.closed = true; }
  }
  class RecoveryStore {
    inspect() { return null; }
    write(snapshot) { writes.push({at: now, snapshot}); return `saved-${now}`; }
    clear() { clears++; }
  }
  const electron = {
    app: {setPath() {}, whenReady: () => ({then: callback => { ready = callback; }}), on() {}, quit() {}},
    BrowserWindow,
    ipcMain: {handle: (name, callback) => handlers.set(name, callback)},
    dialog: {showMessageBox: async () => ({response: 1}),
      showErrorBox: (_, message) => { throw Error(message); }},
    nativeImage: {}
  };
  const context = vm.createContext({
    __dirname: path.dirname(mainFile), JSON, process: {env: {}}, console, Date: FakeDate,
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, {at: now + delay, callback});
      return id;
    },
    clearTimeout: id => timers.delete(id),
    require(name) {
      if (name === 'electron') return electron;
      if (name === './core/recovery.cjs') return {RecoveryStore, normalizeDraft: mainRequire(name).normalizeDraft};
      return mainRequire(name);
    }
  });
  vm.runInContext(fs.readFileSync(mainFile, 'utf8'), context, {filename: mainFile});
  await ready();
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = target;
  }
  function invoke(name, ...args) {
    assert.ok(handlers.has(name), `registered IPC: ${name}`);
    return handlers.get(name)({sender: window.webContents, senderFrame: window.webContents.mainFrame}, ...args);
  }
  return {advance, invoke, writes, timers, window,
    get clears() { return clears; },
    run: source => vm.runInContext(source, context),
    // Access the lexical function without adding any production exports.
    edit() { vm.runInContext('session.revision++; scheduleRecovery()', context); }
  };
}

test('clean startup does not write; dirty changes wait for five seconds idle', async () => {
  const f = await fixture();
  f.run('scheduleRecovery()');
  f.advance(20000);
  assert.equal(f.writes.length, 0);
  assert.equal(f.timers.size, 0);
  f.edit();
  assert.equal(f.writes.length, 0, 'no immediate recovery write');
  assert.equal(f.timers.size, 1);
  f.advance(4999);
  assert.equal(f.writes.length, 0);
  f.advance(1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].at, 25000);
  assert.equal(f.writes[0].snapshot.revision, 1);
  assert.equal(f.timers.size, 0);
  f.advance(20000);
  assert.equal(f.writes.length, 1, 'no periodic rewrites without edits');
});

test('repeated edits replace the timer and debounce from the latest edit', async () => {
  const f = await fixture();
  f.edit();
  f.advance(3000);
  f.edit();
  assert.equal(f.timers.size, 1, 'old timeout must be cancelled');
  f.advance(3000);
  f.edit();
  assert.equal(f.timers.size, 1);
  f.advance(4999);
  assert.equal(f.writes.length, 0);
  f.advance(1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].at, 11000);
  assert.equal(f.writes[0].snapshot.revision, 3, 'capture newest revision');
});

test('continuous edits cap the first batch at fifteen seconds, including time zero', async () => {
  const f = await fixture();
  f.edit();
  for (let second = 1; second <= 14; second++) {
    f.advance(1000);
    f.edit();
    assert.equal(f.timers.size, 1);
    assert.equal(f.writes.length, 0);
  }
  f.advance(999);
  assert.equal(f.writes.length, 0);
  f.advance(1);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].at, 15000);
  assert.equal(f.writes[0].snapshot.revision, 15);
});

test('a write resets the batch deadline even when the document remains dirty', async () => {
  const f = await fixture();
  f.edit();
  f.advance(5000);
  assert.equal(f.writes.length, 1);
  f.advance(7000);
  f.edit(); // New batch starts at 12s rather than the original zero timestamp.
  for (let second = 1; second <= 14; second++) {
    f.advance(1000);
    f.edit();
    assert.equal(f.writes.length, 1);
  }
  f.advance(1000);
  assert.deepEqual(f.writes.map(write => write.at), [5000, 27000]);
});

test('status, project and evaluate reads neither start nor postpone recovery', async () => {
  const f = await fixture();
  function reads() {
    f.invoke('project');
    f.invoke('evaluate', 0);
    f.invoke('get-recovery-draft');
    f.run('recoveryStatus(); publishRecoveryStatus()');
  }
  reads();
  f.advance(20000);
  assert.equal(f.timers.size, 0);
  assert.equal(f.writes.length, 0);
  f.edit();
  for (let second = 0; second < 4; second++) { f.advance(1000); reads(); }
  f.advance(1000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].at, 25000);
  reads(); // Writing recovery does not mark the project clean.
  f.advance(20000);
  assert.equal(f.writes.length, 1);
  assert.equal(f.timers.size, 0);
});

test('clearing recovery cancels the queued write and resets its batch', async () => {
  const f = await fixture();
  f.edit();
  f.advance(4000);
  f.run('clearRecovery()');
  assert.equal(f.clears, 1);
  assert.equal(f.timers.size, 0);
  f.advance(20000);
  assert.equal(f.writes.length, 0);
  f.edit();
  f.advance(4999);
  assert.equal(f.writes.length, 0);
  f.advance(1);
  assert.equal(f.writes[0].at, 29000);
});

test('confirmed close cancels pending recovery instead of writing after close', async () => {
  const f = await fixture();
  f.edit();
  let prevented = false;
  f.window.events.get('close')({preventDefault() { prevented = true; }});
  // Flush discard/fileOperation continuations without real timers.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(prevented, true);
  assert.equal(f.window.closed, true);
  assert.equal(f.clears, 1);
  assert.equal(f.timers.size, 0);
  f.advance(20000);
  assert.equal(f.writes.length, 0);
});
