'use strict';
const path = require('node:path');
const {spawn} = require('node:child_process');

async function run(args = process.argv.slice(2), {
  appRoot = __dirname, env = process.env, spawnImpl = spawn,
  stdout = text => console.log(text), stderr = text => console.error(text)
} = {}) {
  if (args.length === 1 && args[0] === '--help') {
    stdout('Usage: node run-electron.cjs [--check | --help]\nNo arguments: check editor files, then launch Electron (no npm).\n--check: read-only JSON {ok,errors,warnings,paths}; never launches GUI or creates user-data/recovery.\nPaths are absolute; relative REPLAY_RECOVERY_DIR overrides resolve against P2, not the calling directory.\nOptional FFmpeg/ffprobe warnings do not block editing; this is not a full feature readiness test.');
    return 0;
  }
  if (args.length && !(args.length === 1 && args[0] === '--check')) {
    stderr('Unknown arguments. Usage: node run-electron.cjs [--check | --help]');
    return 2;
  }
  let report;
  try { report = require('./core/startup-check.cjs').checkStartup({appRoot: path.resolve(appRoot), env}); }
  catch (error) { stderr(`Startup check failed: ${error.message}`); return 1; }
  if (args[0] === '--check') { stdout(JSON.stringify(report, null, 2)); return report.ok ? 0 : 1; }
  for (const warning of report.warnings) stderr(`WARNING: ${warning}`);
  for (const error of report.errors) stderr(`ERROR: ${error}`);
  if (!report.ok) return 1;
  const childEnv = {...env};
  for (const key of Object.keys(childEnv)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete childEnv[key];
  childEnv.REPLAY_RECOVERY_DIR = report.paths.recovery;
  return new Promise(resolve => {
    let settled = false;
    const finish = (code, message) => {
      if (settled) return;
      settled = true;
      if (message) stderr(message);
      resolve(code);
    };
    try {
      const child = spawnImpl(report.paths.electron, [report.paths.main], {
        cwd: report.paths.appRoot, env: childEnv, stdio: 'inherit'
      });
      child.once('error', error => finish(1, `Electron spawn failed: ${error.message}`));
      child.once('exit', (code, signal) => {
        if (signal) return finish(1, `Electron terminated by signal: ${signal}`);
        if (!Number.isInteger(code) || code < 0) return finish(1, 'Electron exited without a valid exit code.');
        finish(code, code ? `Electron exited with code ${code}.` : null);
      });
    } catch (error) { finish(1, `Electron spawn failed: ${error.message}`); }
  });
}
module.exports = {run};
if (require.main === module) run().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`Launcher failed: ${error.message}`); process.exitCode = 1;
});
