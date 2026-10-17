'use strict';
// Only launch through s1-recovery.integration.cjs. Real main/preload/renderer/recovery.
const {app, dialog} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = process.env.REPLAY_S1_RECOVERY_ROOT, phase = Number(process.env.REPLAY_S1_RECOVERY_PHASE);
const runId = process.env.REPLAY_S1_RECOVERY_RUN_ID;
assert.ok(root && runId && [1,2].includes(phase), 'Use node P2/s1-recovery.integration.cjs');
assert.equal(path.resolve(process.env.REPLAY_RECOVERY_DIR || ''), path.join(root,'autosave'));
const formalFile = path.join(root,'formal','baseline.json');
const invalidText = '{invalid S1 recovery draft\n  "preserve": "未提交代码原文",\n';
assert.throws(()=>JSON.parse(invalidText), SyntaxError, 'boundary fixture is genuinely invalid JSON');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const startedAt = new Date().toISOString();
let startupPrompts=0, closePrompts=0, closing=false, finished=false;
function finish(status, data={}) {
  if (finished) return; finished=true;
  const report={status,runId,phase,pid:process.pid,startedAt,finishedAt:new Date().toISOString(),startupPrompts,closePrompts,...data};
  fs.writeFileSync(path.join(root,`phase${phase}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report)); app.exit(status==='PASS'?0:1);
}
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(root,'fixture-copy','场景.json')]});
dialog.showSaveDialog=async()=>({canceled:false,filePath:formalFile});
dialog.showMessageBox=async(...args)=>{
  const options=args.at(-1);
  if(closing){closePrompts++;assert.ok(options.buttons?.length>=2);assert.ok(Number.isInteger(options.cancelId));return {response:options.cancelId};}
  startupPrompts++;assert.equal(phase,2,'isolated phase1 cannot offer recovery');return {response:0};
};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,label,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(50);}throw Error('Timeout: '+label);}
app.disableHardwareAcceleration();
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
  const js=source=>win.webContents.executeJavaScript(source);
  try {
    await until(()=>js("!!current && !!document.querySelector('#code-text').value"),'renderer initialization');
    if(phase===1){
      await js('(async()=>{await replay.openProject();await locate();await replay.saveAs();await locate();})()');
      const baseline=await js('replay.project()');
      assert.equal(baseline.file,formalFile);assert.equal(baseline.dirty,false);
      const formalBytes=fs.readFileSync(formalFile);const formalSha256=sha256(formalBytes);
      assert.deepEqual(JSON.parse(formalBytes.toString('utf8')).project,baseline.project);
      // Real code-editor input; subsequent committed event makes this old-revision draft stale.
      await js(`(()=>{codeText.value=${JSON.stringify(invalidText)};codeText.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(async()=>{const p=await js('replay.project()');return p.codeDraft?.text===invalidText&&p.codeDraft.dirty;},'code input publication');
      const command=await js(`(async()=>{const p=await replay.project();return replay.dropExpression({commandId:crypto.randomUUID(),documentId:p.documentId,expectedRevision:p.revision,source:{characterId:'window_guide',expressionId:'smile'},target:{characterId:'window_guide'},atFrame:90});})()`);
      assert.equal(command.ok,true,JSON.stringify(command));assert.equal(command.revision,baseline.revision+1);
      await js('locate()');
      const committed=await js('replay.project()');
      const event=committed.project.scene.characters.find(c=>c.id==='window_guide').expressionEvents.find(e=>e.id===command.created.eventId);
      assert.deepEqual(event,{id:command.created.eventId,frame:90,expressionId:'smile'});
      assert.deepEqual(committed.project.scene.dialogues,baseline.project.scene.dialogues);
      // The un-applied event form is intentionally different from the committed F90 event.
      await js(`(()=>{selectedCharacterId='window_guide';selectedEventId=${JSON.stringify(event.id)};syncExpressionEditor(current.project);eventFrame.value='91';eventFrame.dispatchEvent(new Event('input',{bubbles:true}));})()`);
      await until(async()=>{const p=await js('replay.project()');return p.expressionDraftDirty;},'event form dirty publication');
      const form=await js('({draft:eventFormDraft,value:eventFrame.value})');
      assert.equal(form.value,'91');assert.equal(form.draft.eventId,event.id);
      let ready;
      const waitingAt=new Date().toISOString();
      await until(async()=>{
        ready=await js('replay.project()');assert.equal(ready.recoveryError,null);
        return !ready.recoveryPending && !!ready.recoverySavedAt && ready.codeDraft?.text===invalidText && ready.codeDraft.dirty && ready.codeDraft.stale;
      },'real idle recovery save (no timer mocking)');
      assert.deepEqual(ready.project,committed.project,'unapplied form does not mutate project');
      const pointerBytes=fs.readFileSync(path.join(root,'autosave','latest.json'));
      const pointer=JSON.parse(pointerBytes), generation=path.join(root,'autosave',pointer.generation);
      const projectBytes=fs.readFileSync(path.join(generation,'project.json')), recordBytes=fs.readFileSync(path.join(generation,'record.json'));
      const persisted=JSON.parse(projectBytes),record=JSON.parse(recordBytes);
      assert.deepEqual(persisted.project,ready.project);assert.equal(record.draft.text,invalidText);assert.equal(record.draft.stale,true);
      assert.deepEqual(fs.readFileSync(formalFile),formalBytes);assert.equal(closePrompts,0);
      finish('PASS',{event,command,project:persisted.project,revision:ready.revision,documentId:ready.documentId,
        draft:ready.codeDraft,unappliedForm:form,formalBase64:formalBytes.toString('base64'),formalSha256,
        recovery:{waitingAt,savedAt:ready.recoverySavedAt,observedAt:new Date().toISOString(),generation:pointer.generation,
          pointerSha256:sha256(pointerBytes),projectSha256:sha256(projectBytes),recordSha256:sha256(recordBytes)},
        termination:'app.exit(0) bypasses close handling; not OS kill'});
      return;
    }
    const expected=JSON.parse(fs.readFileSync(path.join(root,'phase1.json'),'utf8'));
    assert.equal(expected.runId,runId);assert.equal(startupPrompts,1);
    const restored=await js(`(async()=>({packet:await replay.project(),text:codeText.value,status:codeStatus.textContent,applyDisabled:codeApply.disabled,form:eventFormDraft}))()`);
    assert.deepEqual(restored.packet.project,expected.project);
    const event=restored.packet.project.scene.characters.find(c=>c.id==='window_guide').expressionEvents.find(e=>e.id===expected.event.id);
    assert.deepEqual(event,expected.event,'stable persisted event ID and frame/expression');
    // documentId is process-local; it is not a persisted cross-process identity.
    assert.ok(Number.isSafeInteger(restored.packet.documentId));
    assert.equal(restored.packet.codeDraft.text,invalidText);assert.equal(restored.packet.codeDraft.dirty,true);assert.equal(restored.packet.codeDraft.stale,true);
    assert.equal(restored.text,invalidText);assert.match(restored.status,/旧版本|过期|冲突|stale/i);assert.equal(restored.applyDisabled,true);
    assert.equal(restored.form,null);assert.equal(restored.packet.expressionDraftDirty,false);
    await js(`(()=>{selectedCharacterId='window_guide';selectedEventId=${JSON.stringify(expected.event.id)};syncExpressionEditor(current.project);})()`);
    assert.equal(await js('eventFrame.value'),'90','unapplied F91 form is not restored');
    const previews=[];
    for(const at of [89,90]){
      const state=await js(`(async()=>{syncTransportFrame(${at});await locate();await sceneRenderer.ready();return current.state;})()`);
      assert.equal(state.frame,at);
      const character=state.characters.find(c=>c.id==='window_guide');
      assert.equal(character.resourceId,'portrait_base');
      assert.equal(character.portraitLayers.length,1);
      assert.equal(character.portraitLayers[0].resourceId,at===89?'expression_calm':'expression_smile');
      const screenshot=(await win.webContents.capturePage()).toPNG();
      const file=path.join(root,`preview-${at}.png`);fs.writeFileSync(file,screenshot);
      previews.push({frame:at,state,screenshot:file,sha256:sha256(screenshot)});
    }
    const formalBytes=Buffer.from(expected.formalBase64,'base64');
    assert.deepEqual(fs.readFileSync(formalFile),formalBytes);
    closing=true;win.close();await until(()=>closePrompts>0,'dirty close dialog');await delay(250);
    assert.equal(win.isDestroyed(),false,'cancel keeps real BrowserWindow alive');
    const afterCancel=await js('replay.project()');
    assert.deepEqual(afterCancel.project,expected.project);assert.equal(afterCancel.codeDraft.text,invalidText);assert.equal(afterCancel.codeDraft.stale,true);
    assert.deepEqual(fs.readFileSync(formalFile),formalBytes);
    assert.ok(fs.existsSync(path.join(root,'autosave','latest.json')),'cancel retains recovery');
    finish('PASS',{event,previews,formalSha256:sha256(fs.readFileSync(formalFile)),staleStatus:restored.status,
      checks:['real two-process recovery','committed F90 smile event and ID restored','preview F89 calm / F90 smile through production evaluate and renderer',
        'invalid code draft verbatim and automatically stale','unapplied F91 event form intentionally not persisted','formal baseline bytes unchanged','close cancel keeps project/draft/window/recovery']});
  }catch(error){finish('FAIL',{error:error.stack});}
}));
setTimeout(()=>finish('FAIL',{error:'GUI phase timeout'}),85000).unref();
require('./main.cjs');
// Override main's synchronous default before its whenReady callback. Profiles are per phase.
const profile=path.join(root,`profile-${phase}`);fs.mkdirSync(profile,{recursive:true});
app.setPath('userData',profile);app.setPath('sessionData',profile);
