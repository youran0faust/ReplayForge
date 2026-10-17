const {app,dialog}=require('electron');const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const saveFile=path.join(__dirname,'test-output','dialogue-save-'+require('crypto').randomUUID(),'project.replay.json');
dialog.showSaveDialog=async()=>({canceled:false,filePath:saveFile});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const r=await win.webContents.executeJavaScript(`(async()=>{
 const $=s=>document.querySelector(s);for(let i=0;i<200&&!$('#dialogue-select').value;i++)await new Promise(r=>setTimeout(r,25));
 const before=await replay.project();$('#dialogue-text').value='编辑器对白测试 👩‍🚀';$('#dialogue-start').value=60;$('#dialogue-end').value=240;$('#dialogue-reveal').value=60;
 await $('#dialogue-apply').onclick();const edited=await replay.project();
 await $('#undo').onclick();const undone=await replay.project();await $('#redo').onclick();
 $('#frame').value=90;await $('#apply').onclick();await sceneRenderer.ready();const rendered=$('#stage .dialogue-body').textContent;
 $('#dialogue-end').value=20;await $('#dialogue-apply').onclick();const rejected=await replay.project();const error=$('#log').textContent;
 await $('#save').onclick();return {before,edited,undone,rejected,rendered,error,saved:$('#log').textContent,postSave:await replay.project()};})()`);
 assert.equal(r.edited.project.scene.dialogues[0].text['zh-CN'],'编辑器对白测试 👩‍🚀');assert.deepEqual(r.undone.project,r.before.project);assert.deepEqual(r.rejected.project,r.edited.project);assert.equal(r.rendered,'编辑器对白测试 👩‍🚀');assert.match(r.error,/错误/);assert.ok(r.saved.startsWith('已保存：'));
 const saved=JSON.parse(fs.readFileSync(r.saved.slice('已保存：'.length),'utf8'));assert.deepEqual(saved.project,r.postSave.project);assert.deepEqual(saved.project.scene,r.edited.project.scene);assert.equal(r.postSave.dirty,false);
 fs.mkdirSync(path.join(__dirname,'test-output'),{recursive:true});const report={status:'PASS',checks:['real dialogue apply','undo redo','preview full text','invalid range rejected','save matches edited project']};fs.writeFileSync(path.join(__dirname,'test-output/gui-dialogue.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }catch(e){console.error(e);app.exit(1)}}));
setTimeout(()=>app.exit(1),60000).unref();require('./main.cjs');
