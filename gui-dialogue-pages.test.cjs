'use strict';
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'test-output','pages-'+require('node:crypto').randomUUID());fs.mkdirSync(root,{recursive:true});process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(root,'saved.json')});dialog.showMessageBox=async()=>({response:0});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
const r=await win.webContents.executeJavaScript(`(async()=>{
const $=s=>document.querySelector(s);for(let i=0;i<200&&!$('#dialogue-select').value;i++)await new Promise(r=>setTimeout(r,20));
const did=$('#dialogue-select').value,before=(await replay.project()).project.scene.dialogues.find(d=>d.id===did),voice=JSON.stringify(before.voice),speaker=before.speakerId;
await $('#dialogue-page-add').onclick();let packet=await replay.project(),d=packet.project.scene.dialogues.find(d=>d.id===did);if(!d.pages||d.pages.length!==2)throw Error('split failed '+$('#log').textContent);
const count=d.pages.length,second=d.pages[1].id;$('#dialogue-page-select').value=second;$('#dialogue-page-select').onchange();
const readonlyStart=$('#dialogue-start').readOnly,readonlyLast=$('#dialogue-end').readOnly;
$('#dialogue-text').value='SECOND PAGE';$('#dialogue-text').oninput();await $('#apply').onclick();const preserved=$('#dialogue-text').value;
window.confirm=()=>false;$('#dialogue-page-select').value=d.pages[0].id;$('#dialogue-page-select').onchange();const cancelSelection=$('#dialogue-page-select').value===second;
await $('#dialogue-apply').onclick();packet=await replay.project();d=packet.project.scene.dialogues.find(d=>d.id===did);
const evaluated=await replay.evaluate(d.pages[1].startFrame),evaluatedText=evaluated.dialogues.find(x=>x.id===did)?.text;
const unchangedVoice=JSON.stringify(d.voice)===voice,unchangedSpeaker=d.speakerId===speaker;
$('#dialogue-text').value='UNAPPLIED';$('#dialogue-text').oninput();await $('#save').onclick();const savedDraft=$('#dialogue-text').value;await $('#open').onclick();const openRetained=$('#dialogue-text').value,mainFlag=(await replay.project()).dialoguePageDraftDirty;
await replay.editDialoguePage(did,second,{text:'EXTERNAL'});await $('#apply').onclick();const stale=$('#dialogue-apply').disabled,retained=$('#dialogue-text').value;
window.confirm=()=>true;await $('#dialogue-page-discard').onclick();const discarded=$('#dialogue-text').value;
$('#dialogue-page-delete-confirm').checked=true;$('#dialogue-page-delete-confirm').onchange();await $('#dialogue-page-delete').onclick();packet=await replay.project();d=packet.project.scene.dialogues.find(d=>d.id===did);const afterDelete=d.pages?.length??0;
await pagePublishing;return{openRetained,mainFlag,count,readonlyStart,readonlyLast,preserved,cancelSelection,evaluatedText,unchangedVoice,unchangedSpeaker,savedDraft,stale,retained,discarded,afterDelete};})()`);
assert.equal(r.openRetained,'UNAPPLIED');assert.equal(r.mainFlag,true);assert.equal(r.count,2);assert.equal(r.readonlyStart,true);assert.equal(r.readonlyLast,true);assert.equal(r.preserved,'SECOND PAGE');assert.equal(r.cancelSelection,true);assert.equal(r.evaluatedText,'SECOND PAGE');assert.equal(r.unchangedVoice,true);assert.equal(r.unchangedSpeaker,true);assert.equal(r.savedDraft,'UNAPPLIED');assert.equal(r.stale,true);assert.equal(r.retained,'UNAPPLIED');assert.equal(r.discarded,'EXTERNAL');assert.equal(r.afterDelete,1);
const report={status:'PASS',checks:['implicit split two pages','current locale page edit','page eval text','speaker and voice unchanged','readonly outer boundaries','draft repaint save protection','selection cancel','stale apply blocked','explicit discard','page deletion'],result:r};fs.writeFileSync(path.join(__dirname,'test-output/gui-dialogue-pages.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}catch(e){console.error(e);app.exit(1)}}));
setTimeout(()=>app.exit(1),60000).unref();require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
