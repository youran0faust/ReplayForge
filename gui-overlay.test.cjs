'use strict';
const {app,dialog,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'test-output','overlay-'+require('node:crypto').randomUUID());fs.mkdirSync(root,{recursive:true});
const file=path.join(root,'project.json');process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();
function png(name,size,b,g,r,a){const bitmap=Buffer.alloc(size*size*4);for(let i=0;i<bitmap.length;i+=4){bitmap[i]=b;bitmap[i+1]=g;bitmap[i+2]=r;bitmap[i+3]=a;}const file=path.join(root,name+'.png');fs.writeFileSync(file,nativeImage.createFromBitmap(bitmap,{width:size,height:size}).toPNG());return file;}
const imports=[png('base',32,120,80,40,255),png('red',8,0,0,128,128),png('green',8,0,128,0,128)];
dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[imports.shift()||file]});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const result=await win.webContents.executeJavaScript(`(async()=>{
 const $=s=>document.querySelector(s),wait=async p=>{for(let i=0;i<300;i++){if(p())return;await new Promise(r=>setTimeout(r,20));}throw Error('timeout')};
 await wait(()=>$('#character-select').value);const id=$('#character-select').value;
 await $('#character-import').onclick();let packet=await replay.project();const base=packet.project.scene.characters.find(c=>c.id===id).resourceId;
 $('#expression-mode').value='overlay';$('#expression-mode').onchange();const canvasSuggestion=[$('#portrait-canvas-width').value,$('#portrait-canvas-height').value];await $('#portrait-canvas-apply').onclick();
 await $('#layer-import').onclick();$('#expression-name').value='overlay';$('#expression-name').oninput();
 const change=(key,value)=>{const e=$('#layer-'+key);e.value=value;e.oninput()};change('x',3);change('y',4);
 await $('#layer-add').onclick();await $('#layer-import').onclick();change('x',7);change('y',9);
 const staged=await replay.project(),draftOrder=[...$('#layer-select').options].map(o=>o.value);
 await $('#layer-up').onclick();const reordered=[...$('#layer-select').options].map(o=>o.value);
 await $('#expression-add').onclick();const registered=await replay.project(),expressionId=$('#expression-select').value;
 const candidate=[...document.querySelectorAll('#expression-preview [data-layer-id]')].map(e=>({id:e.dataset.layerId,left:e.style.left,top:e.style.top,width:e.style.width,height:e.style.height}));
 $('#event-frame').value=10;$('#event-expression').value=expressionId;await $('#event-add').onclick();const before=await replay.evaluate(9),active=await replay.evaluate(10);
 change('x',11);const unapplied=await replay.evaluate(10);await $('#expression-apply').onclick();const edited=await replay.evaluate(10);await $('#undo').onclick();const undone=await replay.evaluate(10);
 change('x',13);await $('#apply').onclick();const discardStatus=$('#expression-draft-status').textContent;window.confirm=()=>true;$('#expression-discard').onclick();
 await $('#save').onclick();const saved=await replay.project();await $('#open').onclick();const reopened=await replay.project();
 return {id,base,canvasSuggestion,staged,draftOrder,reordered,registered,candidate,before,active,unapplied,edited,undone,discardStatus,saved,reopened};
 })()`);
 const character=packet=>packet.project.scene.characters.find(c=>c.id===result.id),state=packet=>packet.characters.find(c=>c.id===result.id);
 assert.deepEqual(result.canvasSuggestion,['32','32']);assert.equal(character(result.staged).resourceId,result.base);assert.equal(character(result.staged).expressions?.length||0,0);
 assert.deepEqual(result.reordered,[...result.draftOrder].reverse());const expression=character(result.registered).expressions[0];assert.equal(expression.mode,'overlay');assert.equal(expression.name,'overlay');assert.equal(expression.layers.length,2);assert.deepEqual(expression.layers.map(l=>l.id),result.reordered);assert.deepEqual(expression.layers.map(l=>[l.x,l.y,l.width,l.height]),[[7,9,8,8],[3,4,8,8]]);
 assert.deepEqual(result.candidate.map(l=>l.id),result.reordered);assert.deepEqual(result.candidate.map(l=>[l.left,l.top,l.width,l.height]),[['7px','9px','8px','8px'],['3px','4px','8px','8px']]);assert.equal(character(result.registered).resourceId,result.base);assert.equal(state(result.before).resourceId,result.base);assert.deepEqual(state(result.active).portraitLayers,expression.layers);assert.deepEqual(state(result.unapplied).portraitLayers,expression.layers);assert.equal(state(result.edited).portraitLayers.find(l=>l.id===result.reordered[0]).x,11);assert.deepEqual(state(result.undone).portraitLayers,expression.layers);assert.match(result.discardStatus,/草稿/);assert.deepEqual(result.saved.project,result.reopened.project);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).project,result.saved.project);
 const report={status:'PASS',checks:['native PNG independent import','base binding preserved','canvas confirmation','local layer staging and order','candidate nodes','event evaluate apply undo','sync discard status','save reopen']};fs.writeFileSync(path.join(__dirname,'test-output/gui-overlay.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}catch(error){console.error(error);app.exit(1)}}));
setTimeout(()=>{console.error('Overlay GUI timed out');app.exit(1)},60000).unref();require('./main.cjs');const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);
