'use strict';
// Plain Node parent: file-descriptor stdio, never captured named pipes.
const {spawn} = require('node:child_process');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const runId = crypto.randomUUID();
const root = path.resolve(__dirname, '../test-output/P2', 's1-recovery-' + runId);
const source = path.join(__dirname, 'fixtures/original-scene-project');
const executable = path.resolve(__dirname, '../p0/node_modules/electron/dist/electron.exe');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function hashes(directory, prefix = '') {
  return Object.fromEntries(fs.readdirSync(directory, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
    const name = prefix + entry.name, file = path.join(directory, entry.name);
    return entry.isDirectory() ? Object.entries(hashes(file, name + '/')) : [[name, sha256(fs.readFileSync(file))]];
  }));
}
fs.mkdirSync(root, {recursive:true});
const report = {runId, root, startedAt:new Date().toISOString(), status:'RUNNING', executable,
  termination:'phase1 app.exit(0) bypasses BrowserWindow close; NOT OS kill', phases:[],
  limitations:['native file/recovery/close dialogs stubbed', 'IPC drop command, not native pointer drag', 'no power-loss or OS-kill durability claim']};
function phase(number) {
  return new Promise((resolve,reject) => {
    const log = path.join(root, `phase${number}.log`), fd = fs.openSync(log, 'w');
    const entry = {phase:number, log, startedAt:new Date().toISOString(), pid:null, exitCode:null, signal:null};
    report.phases.push(entry);
    const env = {...process.env, REPLAY_RECOVERY_DIR:path.join(root,'autosave'), REPLAY_S1_RECOVERY_ROOT:root,
      REPLAY_S1_RECOVERY_PHASE:String(number), REPLAY_S1_RECOVERY_RUN_ID:runId};
    delete env.ELECTRON_RUN_AS_NODE;
    let child;
    try { child = spawn(executable, [path.join(__dirname,'gui-s1-recovery.test.cjs')], {env, stdio:['ignore',fd,fd]}); }
    catch(error) { fs.closeSync(fd); entry.spawnError=error.stack; entry.finishedAt=new Date().toISOString(); reject(error); return; }
    fs.closeSync(fd); entry.pid=child.pid ?? null;
    let spawnError;
    child.once('error', error => {spawnError=error;entry.spawnError=error.stack;});
    const timeout = setTimeout(() => {entry.timedOut=true;child.kill();}, 95000);
    child.once('close', (code,signal) => {
      clearTimeout(timeout); Object.assign(entry,{exitCode:code,signal,finishedAt:new Date().toISOString(), logSha256:sha256(fs.readFileSync(log))});
      if (!spawnError && !entry.timedOut && code===0 && signal===null) resolve();
      else reject(spawnError || Error(`Phase ${number}: actual exit=${code}, signal=${signal}, timeout=${!!entry.timedOut}; see ${log}`));
    });
  });
}
(async()=>{
  try {
    report.sourceBefore=hashes(source);
    fs.cpSync(source,path.join(root,'fixture-copy'),{recursive:true,errorOnExist:true,force:false});
    assert.deepEqual(hashes(path.join(root,'fixture-copy')),report.sourceBefore);
    await phase(1);
    const first=JSON.parse(fs.readFileSync(path.join(root,'phase1.json'),'utf8'));
    assert.equal(first.runId,runId); assert.equal(first.status,'PASS');
    await phase(2);
    const second=JSON.parse(fs.readFileSync(path.join(root,'phase2.json'),'utf8'));
    assert.equal(second.runId,runId); assert.equal(second.status,'PASS');
    assert.notEqual(report.phases[0].pid,report.phases[1].pid,'two separate real Electron processes');
    report.sourceAfter=hashes(source); assert.deepEqual(report.sourceAfter,report.sourceBefore);
    assert.deepEqual(hashes(path.join(root,'fixture-copy')),report.sourceBefore,'opening copy cannot modify it');
    report.evidence={phase1:first,phase2:second}; report.status='PASS';
  } catch(error) {report.status='FAIL';report.error=error.stack;process.exitCode=1;}
  finally {
    report.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({status:report.status,runId,report:path.join(root,'report.json')}));
  }
})();
