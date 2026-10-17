'use strict';
// Run via recovery-integration.cjs: two real Electron processes share ONLY this test's recovery folder.
const {app, dialog} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.REPLAY_RECOVERY_TEST_ROOT;
const phase = Number(process.env.REPLAY_RECOVERY_TEST_PHASE);
assert.ok(root && [1, 2].includes(phase), 'Use node p1/recovery-integration.cjs');
assert.equal(path.resolve(process.env.REPLAY_RECOVERY_DIR || ''), path.join(root, 'autosave'));
const formalFile = path.join(root, 'formal-project.json');
const checkpointFile = path.join(root, 'phase1.json');
const invalidText = '{invalid recovery draft\n  "preserve": "未提交草稿",\n';
let startupPrompts = 0, closePrompts = 0, closing = false;
dialog.showSaveDialog = async () => ({canceled: false, filePath: formalFile});
dialog.showMessageBox = async (...args) => {
  const options = args[args.length - 1];
  if (closing) {
    closePrompts++;
    assert.ok(options.buttons?.length >= 2, 'close must offer cancel/discard');
    return {response: options.cancelId};
  }
  startupPrompts++;
  assert.equal(phase, 2, 'fresh isolated recovery folder must not trigger startup recovery');
  return {response: 0}; // Actual native chooser alone is stubbed; restore remains production code.
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(50); }
  throw Error('Timed out: ' + label);
}
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
  try {
    await until(() => win.webContents.executeJavaScript("!!document.querySelector('#code-text')?.value"), 'editor initialization');
    if (phase === 1) {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const $ = selector => document.querySelector(selector);
        await $('#save-as').onclick();
        const saved = await replay.project();
        $('#code-text').value = ${JSON.stringify(invalidText)};
        $('#code-text').dispatchEvent(new Event('input', {bubbles: true}));
        await replay.updateCodeDraft({text: ${JSON.stringify(invalidText)}, baseRevision: saved.revision, dirty: true, stale: false});
        $('#x').value = Number(saved.project.scene.characters[0].x) + 137;
        await $('#move').onclick();
        const changed = await replay.project();
        await replay.updateCodeDraft({text: ${JSON.stringify(invalidText)}, baseRevision: saved.revision, dirty: true, stale: true});
        return {saved, changed};
      })()`);
      assert.equal(result.saved.dirty, false);
      assert.notDeepEqual(result.changed.project, result.saved.project);
      let ready;
      await until(async () => {
        ready = await win.webContents.executeJavaScript('replay.project()');
        assert.equal(ready.recoveryError, null, 'autosave must not report failure');
        return ready.recoveryPending === false && !!ready.recoverySavedAt &&
          ready.codeDraft?.text === invalidText && ready.codeDraft.dirty && ready.codeDraft.stale;
      }, 'latest dirty project + invalid draft autosave');
      const pointer = JSON.parse(fs.readFileSync(path.join(process.env.REPLAY_RECOVERY_DIR, 'latest.json'), 'utf8'));
      const generationRoot = path.join(process.env.REPLAY_RECOVERY_DIR, pointer.generation);
      const persisted = JSON.parse(fs.readFileSync(path.join(generationRoot, 'project.json'), 'utf8'));
      const record = JSON.parse(fs.readFileSync(path.join(generationRoot, 'record.json'), 'utf8'));
      assert.equal(record.draft.text, invalidText, 'pointer must publish the latest invalid draft');
      assert.equal(record.draft.stale, true);
      assert.deepEqual(persisted.project.scene, ready.project.scene, 'pointer must publish the GUI edit');
      const formalBytes = fs.readFileSync(formalFile, 'utf8');
      assert.deepEqual(JSON.parse(formalBytes).project, result.saved.project);
      fs.writeFileSync(checkpointFile, JSON.stringify({formalBytes, project: persisted.project,
        documentId: ready.documentId, draft: ready.codeDraft, savedAt: ready.recoverySavedAt}, null, 2));
      console.log('Recovery phase 1 PASS: autosaved; app.exit bypasses close handling');
      app.exit(0); // Deliberately bypasses BrowserWindow close/discard; simulates abrupt termination.
      return;
    }
    const expected = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
    assert.equal(startupPrompts, 1, 'startup must offer recovery once');
    const restored = await win.webContents.executeJavaScript(`(async () => ({packet: await replay.project(),
      text: document.querySelector('#code-text').value,
      status: document.querySelector('#code-status').textContent,
      applyDisabled: document.querySelector('#code-apply').disabled}))()`);
    assert.deepEqual(restored.packet.project, expected.project, 'GUI project mutation survives restart');
    assert.notEqual(restored.packet.documentId, undefined, 'restored bundle identifies its document');
    assert.equal(restored.packet.codeDraft.text, invalidText);
    assert.equal(restored.packet.codeDraft.dirty, true);
    assert.equal(restored.packet.codeDraft.stale, true);
    assert.equal(restored.text, invalidText, 'renderer must restore invalid JSON verbatim');
    assert.match(restored.status, /旧版本|过期|冲突|stale/i);
    assert.equal(restored.applyDisabled, true, 'stale recovered draft must not be applied');
    assert.equal(fs.readFileSync(formalFile, 'utf8'), expected.formalBytes, 'recovery cannot overwrite formal save');
    closing = true;
    win.close();
    await until(() => closePrompts > 0, 'dirty close confirmation');
    await delay(200);
    assert.equal(win.isDestroyed(), false, 'cancel must keep window alive');
    const afterCancel = await win.webContents.executeJavaScript('replay.project()');
    assert.equal(afterCancel.codeDraft.text, invalidText, 'cancel must preserve draft');
    assert.deepEqual(afterCancel.project, expected.project, 'cancel must preserve project');
    assert.equal(fs.readFileSync(formalFile, 'utf8'), expected.formalBytes);
    const report = {status: 'PASS', chooser: 'native dialog stub only', recoveryDir: process.env.REPLAY_RECOVERY_DIR,
      checks: ['isolated two-process recovery', 'GUI character edit restored', 'invalid draft preserved verbatim',
        'stale draft status and apply disabled', 'formal save not overwritten', 'dirty-close cancel keeps window and draft'],
      staleStatus: restored.status, startupPrompts, closePrompts};
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}));
setTimeout(() => {console.error('Recovery GUI phase timeout'); app.exit(1);}, 75000).unref();
require('./main.cjs');
// main sets its default synchronously; isolate Chromium before its whenReady callback runs.
const userData = path.join(root, 'user-data');
fs.mkdirSync(userData, {recursive: true});
app.setPath('userData', userData);
app.setPath('sessionData', userData);
