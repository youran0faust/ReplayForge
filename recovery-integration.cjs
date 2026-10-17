'use strict';
// Plain Node orchestrator; inherited stdio avoids named-pipe capture.
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.join(__dirname, 'test-output', 'recovery-' + randomUUID());
const recoveryDir = path.join(root, 'autosave');
fs.mkdirSync(recoveryDir, {recursive: true});
const executable = path.resolve(__dirname, '../p0/node_modules/electron/dist/electron.exe');
function phase(number) {
  return new Promise((resolve, reject) => {
    const env = {...process.env, REPLAY_RECOVERY_DIR: recoveryDir,
      REPLAY_RECOVERY_TEST_ROOT: root, REPLAY_RECOVERY_TEST_PHASE: String(number)};
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [path.join(__dirname, 'gui-recovery.test.cjs')], {stdio: 'inherit', env});
    const timeout = setTimeout(() => {child.kill(); reject(Error('Recovery phase ' + number + ' timed out'));}, 90000);
    child.once('error', error => {clearTimeout(timeout); reject(error);});
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0 && !signal) resolve();
      else reject(Error('Recovery phase ' + number + ' exited ' + code + ' (' + signal + ')'));
    });
  });
}
(async () => {
  await phase(1);
  assert.ok(fs.existsSync(path.join(root, 'phase1.json')), 'phase one checkpoint missing');
  await phase(2);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'report.json'), 'utf8'));
  assert.equal(report.status, 'PASS');
  console.log(JSON.stringify({status: 'PASS', report: path.join(root, 'report.json'), recoveryDir}));
})().catch(error => {console.error(error); process.exitCode = 1;});
