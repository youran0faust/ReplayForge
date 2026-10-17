'use strict';
// Actual BAT negative evidence only; no real or fake Electron child is run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {REQUIRED} = require('./core/startup-check.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

test('closeout launcher: actual BAT isolated negative tests', {
  skip: process.platform !== 'win32' ? 'Requires Windows cmd.exe' : false,
  timeout: 40000
}, async t => {
  const runId = crypto.randomUUID();
  const output = path.resolve(__dirname, '../test-output/P2', `closeout-launcher-${runId}`);
  const temporary = path.join(os.tmpdir(), `P2 收口 launcher ${runId}`);
  const originalEnv = {...process.env};
  const source = path.join(__dirname, '启动P2编辑器.bat');
  const sourceBytes = fs.readFileSync(source);
  const report = {
    runId, startedAt: new Date().toISOString(), status: 'RUNNING', output, temporary,
    source, sourceSha256: hash(sourceBytes), cases: [], actualGuiPositive: 'NOT_RUN',
    limitations: [
      'Actual BAT evidence is required-file failure only; Electron is absent or a directory in every run.',
      'Optional-tool warnings, child argv, recovery override and child environment are NOT dynamically verified here.',
      'No invalid executable, copied cmd.exe posing as Electron, real Electron, GUI or direct main.cjs launch.'
    ]
  };
  fs.mkdirSync(output, {recursive: true});
  function put(file, text = 'SAFE PLACEHOLDER; NEVER EXECUTE') {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, text);
  }
  function fixture(name) {
    const appRoot = path.join(temporary, name, 'fakeapp');
    for (const file of REQUIRED) put(path.join(appRoot, file));
    put(path.join(appRoot, 'examples/rain-corridor-v4.json'), JSON.stringify({schemaVersion: 4, resources: []}));
    const electron = path.resolve(appRoot, '../p0/node_modules/electron/dist/electron.exe');
    put(electron);
    const bat = path.join(appRoot, path.basename(source));
    fs.copyFileSync(source, bat);
    assert.equal(hash(fs.readFileSync(bat)), report.sourceSha256);
    return {appRoot, electron, bat};
  }
  async function recorded(name, fn) {
    await t.test(name, () => {
      const entry = {name, status: 'RUNNING'};
      report.cases.push(entry);
      try { fn(entry); entry.status = 'PASS'; }
      catch (error) { entry.status = 'FAIL'; entry.error = error.stack; throw error; }
    });
  }
  try {
    await recorded('static required/optional/environment/argv contract', entry => {
      const text = sourceBytes.toString('utf8');
      const calls = [...text.matchAll(/^call :required "([^"]+)"\r?$/gm)].map(m => m[1].replaceAll('\\', '/'));
      assert.deepEqual(calls, ['../p0/node_modules/electron/dist/electron.exe', ...REQUIRED]);
      assert.ok(text.includes('call :optional "..\\p0\\tools\\ffmpeg.exe"'));
      assert.ok(text.includes('call :optional "..\\p0\\tools\\ffprobe.exe"'));
      assert.ok(text.includes('set "ELECTRON_RUN_AS_NODE="'));
      assert.ok(text.includes('if not defined REPLAY_RECOVERY_DIR set "REPLAY_RECOVERY_DIR=%~dp0runtime-output\\recovery"'));
      assert.ok(text.includes('for %%I in ("%REPLAY_RECOVERY_DIR%") do set "REPLAY_RECOVERY_DIR=%%~fI"'));
      assert.ok(text.includes('"..\\p0\\node_modules\\electron\\dist\\electron.exe" "%~dp0main.cjs"'));
      entry.evidence = 'STATIC ONLY; no actual child, warning or recovery behavior observed';
    });
    for (const kind of ['missing-files', 'directories-not-files']) {
      await recorded(`actual BAT ${kind}: exit 1, absolute paths, pause consumes NUL`, entry => {
        const f = fixture(kind);
        const bad = [f.electron, path.join(f.appRoot, kind === 'missing-files' ? 'main.cjs' : 'renderer/index.html')];
        for (const file of bad) {
          fs.unlinkSync(file);
          if (kind === 'directories-not-files') fs.mkdirSync(file);
        }
        // Hard guard: no executable may be present when invoking the real BAT.
        assert.ok(!fs.existsSync(f.electron) || fs.statSync(f.electron).isDirectory());
        const stdoutPath = path.join(output, `${kind}.stdout.utf16le.log`);
        const stderrPath = path.join(output, `${kind}.stderr.utf16le.log`);
        const descriptors = [];
        const cmd = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe');
        // /u preserves Chinese absolute paths in builtin echo/pause output.
        const args = ['/d', '/u', '/c', `call "${f.bat}" <NUL`];
        let result;
        try {
          descriptors.push(fs.openSync(stdoutPath, 'w'));
          descriptors.push(fs.openSync(stderrPath, 'w'));
          result = spawnSync(cmd, args, {
            cwd: temporary, env: {...process.env, ELECTRON_RUN_AS_NODE: 'parent-sentinel'},
            stdio: ['ignore', ...descriptors], windowsHide: true, windowsVerbatimArguments: true, timeout: 10000
          });
        } finally { for (const fd of descriptors) fs.closeSync(fd); }
        Object.assign(entry, {cmd, args, cwd: temporary, stdoutPath, stderrPath,
          expectedMissingPaths: bad, exitCode: result.status, signal: result.signal,
          spawnError: result.error ? {code: result.error.code, message: result.error.message} : null});
        assert.ifError(result.error);
        assert.equal(result.signal, null);
        assert.equal(result.status, 1);
        const stdout = fs.readFileSync(stdoutPath).toString('utf16le');
        const missing = stdout.split(/\r?\n/).filter(line => line.startsWith('ERROR: Missing editor file: '))
          .map(line => line.slice('ERROR: Missing editor file: '.length));
        assert.deepEqual(missing, bad);
        assert.match(stdout, /ERROR: Editor startup blocked\./);
        assert.doesNotMatch(stdout, /WARNING:|Electron exited with code/);
        assert.equal(fs.existsSync(path.join(f.appRoot, 'runtime-output')), false);
        assert.deepEqual({...process.env}, originalEnv);
      });
    }
  } finally {
    report.sourceUnchanged = hash(fs.readFileSync(source)) === report.sourceSha256;
    report.parentEnvironmentUnchanged = JSON.stringify({...process.env}) === JSON.stringify(originalEnv);
    report.status = report.cases.length === 3 && report.cases.every(c => c.status === 'PASS') && report.sourceUnchanged && report.parentEnvironmentUnchanged ? 'PASS' : 'FAIL';
    // Remove only this UUID-owned tree. Keep report and stdout/stderr evidence.
    try { fs.rmSync(temporary, {recursive: true, force: true}); report.tempCleaned = true; }
    catch (error) { report.tempCleaned = false; report.cleanupError = error.message; report.status = 'FAIL'; }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Launcher closeout report: ${path.join(output, 'report.json')}`);
  }
  assert.equal(report.status, 'PASS');
});
