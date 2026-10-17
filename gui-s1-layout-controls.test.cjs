'use strict';
// Native Electron layout input. DOM evaluation observes geometry or prepares fixture/tab state only.
const { app, dialog, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert/strict'), crypto = require('crypto');
const runId = crypto.randomUUID(), root = path.resolve(__dirname, '../test-output/P2', 's1-layout-controls-' + runId);
fs.mkdirSync(root, { recursive: true }); process.env.REPLAY_RECOVERY_DIR = path.join(root, 'recovery');
app.disableHardwareAcceleration(); app.commandLine.appendSwitch('force-device-scale-factor', '1');
const fixture = path.join(root, 'fixture'); fs.cpSync(path.resolve(__dirname, 'fixtures/original-scene-project'), fixture, { recursive: true });
const project = JSON.parse(fs.readFileSync(path.join(fixture, '场景.json'), 'utf8'));
const character = project.project.scene.characters[0], seed = structuredClone(character.expressions[0]);
for (let i = character.expressions.length; i < 50; i++) character.expressions.push({ ...structuredClone(seed), id: 'layout-control-' + i, name: '布局表情 ' + i });
const file = path.join(fixture, 'layout-controls.json'); fs.writeFileSync(file, JSON.stringify(project));
const startedAt = new Date().toISOString();
let ended = false; const checks = [], measurements = [], errors = [];
function finish(status, extra = {}) {
  if (ended) return; ended = true;
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({ status, runId, startedAt, finishedAt: new Date().toISOString(), checks, measurements, errors, ...extra }, null, 2));
  console.log(root, status); app.exit(status === 'PASS' ? 0 : 1);
}
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); dialog.showMessageBox = async () => ({ response: 1 });
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  const js = code => win.webContents.executeJavaScript(code), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  async function wait(code) { const end = Date.now() + 15000; while (Date.now() < end) { if (await js(code)) return; await delay(40); } throw Error('Timeout: ' + code); }
  const snapshot = () => js('editorLayout.snapshot()'), stored = () => js('localStorage.getItem(editorLayout.storageKey)');
  async function point(selector) { return js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`); }
  const input = event => win.webContents.sendInputEvent(event);
  async function click(selector) { const p = await point(selector); input({ type: 'mouseDown', button: 'left', clickCount: 1, ...p }); input({ type: 'mouseUp', button: 'left', clickCount: 1, ...p }); await delay(100); }
  async function key(keyCode, modifiers = []) { input({ type: 'keyDown', keyCode, modifiers }); input({ type: 'keyUp', keyCode, modifiers }); await delay(90); }
  async function drag(selector, dx, dy, cancel) {
    const p = await point(selector);
    const diagnostic = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),hit=document.elementFromPoint(${p.x},${p.y});window.__layoutInputLog=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture','focus','blur'])e.addEventListener(type,event=>window.__layoutInputLog.push({type:event.type,x:event.clientX,y:event.clientY,buttons:event.buttons}),{once:true});return{selector:${JSON.stringify(selector)},point:${JSON.stringify(p)},rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.id,focused:document.hasFocus(),before:editorLayout.snapshot()}})()`);
    input({ type: 'mouseMove', ...p }); input({ type: 'mouseDown', button: 'left', clickCount: 1, ...p }); await delay(35);
    diagnostic.afterDown = await snapshot();
    for (let i = 1; i <= 5; i++) { input({ type: 'mouseMove', modifiers: ['leftButtonDown'], x: Math.round(p.x + dx * i / 5), y: Math.round(p.y + dy * i / 5) }); await delay(20); }
    diagnostic.afterMove = await snapshot(); diagnostic.events = await js('window.__layoutInputLog');
    if (!diagnostic.afterMove.dragging) measurements.push({ failedDrag: diagnostic });
    assert(diagnostic.afterMove.dragging, 'real pointer capture started: ' + selector + ' hit=' + diagnostic.hit);
    if (cancel === 'Escape') await key('Escape');
    if (cancel === 'blur') { const other = new BrowserWindow({ width: 180, height: 120, show: true }); other.focus(); await wait('!document.hasFocus()'); await delay(80); other.destroy(); win.focus(); win.webContents.focus(); }
    input({ type: 'mouseUp', button: 'left', clickCount: 1, x: Math.round(p.x + dx), y: Math.round(p.y + dy) }); await delay(100);
  }
  const probe = `(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},a=document.querySelector('#audio-content'),s=getComputedStyle(a),g=document.querySelector('#expression-library-grid'),r=rect(g);return {stage:rect(document.querySelector('#stage')),preview:rect(document.querySelector('.preview')),audio:rect(document.querySelector('#audio-panel')),audioContent:a.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom),cards:[...g.children].map(rect).filter(c=>c.width>0&&c.height>0&&c.x>=r.x-.1&&c.y>=r.y-.1&&c.right<=r.right+.1&&c.bottom<=r.bottom+.1).length,layout:editorLayout.snapshot()}})()`;
  try {
    await wait('!!window.editorLayout && !!current && !!productionAssets'); win.setContentSize(1920, 1080); win.show(); win.focus(); win.webContents.focus();
    await js('(async()=>{await replay.openProject();await locate()})()'); await delay(300);
    const before = await js('replay.project()'); await click('#layout-reset'); const baseline = await snapshot();
    for (const [selector, dx, dy, dimension] of [['#split-left', 40, 0, 'left'], ['#split-right', -40, 0, 'right'], ['#split-upper', 0, -25, 'upper'], ['#split-timeline', 0, 25, 'timeline']]) {
      const old = await snapshot(); await drag(selector, dx, dy); assert.notEqual((await snapshot()).actual[dimension], old.actual[dimension], selector);
    }
    assert.equal((await snapshot()).timelineMode, 'manual'); checks.push('four real pointer splitters');
    await click('#split-left'); let old = await snapshot(); await key('Right'); assert.equal((await snapshot()).actual.left - old.actual.left, 8);
    old = await snapshot(); await key('Right', ['shift']); assert.equal((await snapshot()).actual.left - old.actual.left, 25); checks.push('native arrows and Shift acceleration');
    for (const cancel of ['Escape', 'blur']) {
      const previous = await snapshot(), saved = await stored(); await drag('#split-left', 35, 0, cancel);
      assert.deepEqual((await snapshot()).requested, previous.requested); assert.deepEqual((await snapshot()).actual, previous.actual); assert.equal(await stored(), saved); assert.equal((await snapshot()).dragging, null);
    }
    checks.push('native Esc and window blur cancel without persistence');
    await click('#timeline-fit-all'); assert.equal((await snapshot()).timelineMode, 'auto'); await click('#timeline-manual'); assert.equal((await snapshot()).timelineMode, 'manual');
    const preference = (await snapshot()).requested;
    assert.deepEqual(Object.keys(JSON.parse(await stored())).sort(), ['version', 'left', 'right', 'upper', 'timeline', 'timelineMode'].sort());
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve)); win.reload(); await loaded; await wait('!!window.editorLayout && !!current'); await delay(300);
    assert.deepEqual((await snapshot()).requested, preference); checks.push('mode buttons and versioned layout-only persistence after reload');
    const large = (await snapshot()).actual; win.setContentSize(1280, 800); await delay(300); assert.deepEqual((await snapshot()).requested, preference); assert((await snapshot()).actual.left < large.left);
    win.setContentSize(1920, 1080); await delay(300); assert.deepEqual((await snapshot()).actual, large); checks.push('resize clamp preserves requested dimensions');
    for (const [width, height, cards] of [[1280, 800, 12], [1366, 768, 12], [1440, 900, 12], [1920, 1080, 24]]) {
      win.setContentSize(width, height); await delay(250); await js("editorLayout.showVisualTab('character');editorLayout.setFocus(null)"); await delay(150);
      await drag('#split-timeline', 0, -400); await drag('#split-right', -400, 0); await drag('#split-upper', 0, 200);
      let m = await js(probe); assert(m.stage.width >= 599); assert(m.audioContent >= 80); assert(Math.abs(m.stage.width / m.stage.height - 16 / 9) < .001);
      assert(m.stage.x >= m.preview.x - .01 && m.stage.right <= m.preview.right + .01 && m.stage.bottom <= m.preview.bottom + .01); measurements.push({ width, height, mode: 'normal', ...m });
      await js(`productionAssets.showExpressions(${JSON.stringify(character.id)});document.querySelector('#expression-library-grid').scrollTop=0`); await delay(200);
      await drag('#split-timeline', 0, -400); m = await js(probe); assert(m.stage.width >= 599); assert(m.cards >= cards); assert.equal(m.audio.height, 32);
      assert.equal(await js("document.querySelector('#split-upper').getAttribute('aria-disabled')"), 'true'); measurements.push({ width, height, mode: 'focus', ...m });
    }
    checks.push('four viewport manual extremes preserve stage/audio/focused cards');
    win.setContentSize(1920, 1080); await delay(250); await js("editorLayout.showVisualTab('character')"); await click('#layout-reset');
    assert.deepEqual((await snapshot()).requested, { left: null, right: null, upper: null, timeline: null, timelineMode: 'auto' }); assert.deepEqual((await snapshot()).actual, baseline.actual); assert.equal(await stored(), null);
    const after = await js('replay.project()'); assert.equal(after.revision, before.revision); assert.equal(after.documentId, before.documentId); assert.deepEqual(after.project, before.project);
    checks.push('native reset defaults; project document/revision/data unchanged throughout');
    finish('PASS', { limitations: ['file dialog stub and isolated fixture preparation', 'single DPI; no screenshot aesthetic acceptance or storage-denial simulation'] });
  } catch (error) { finish('FAIL', { error: error.stack }); }
}));
setTimeout(() => finish('FAIL', { error: 'global timeout' }), 120000).unref();
require('./main.cjs'); app.setPath('userData', path.join(root, 'profile')); app.setPath('sessionData', path.join(root, 'profile'));
