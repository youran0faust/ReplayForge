'use strict';
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const runId=process.env.REPLAY_CRUD_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString();
const root=fs.mkdtempSync(path.join(__dirname,'test-output','expression-crud-')),reportPath=path.join(root,'report.json');
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
let finished=false;function finish(status,data){if(finished)return;finished=true;const report={status,runId,startedAt,finishedAt:new Date().toISOString(),root,...data};fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(status==='PASS'?0:1);}
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const js=s=>win.webContents.executeJavaScript(s),delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function wait(fn,label){const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await delay(25);}throw Error('Timeout '+label+'; '+await js(`document.querySelector('#log').textContent`));}
 const packet=()=>js(`(async()=>{const p=await replay.project();return {project:p.project,revision:p.revision};})()`);
 async function click(selector){const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing target');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return{x,y,hit:document.elementFromPoint(x,y)?.closest(${JSON.stringify(selector)})===e};})()`);assert(p.hit,'native target hit '+selector);win.webContents.sendInputEvent({type:'mouseMove',x:p.x,y:p.y});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:p.x,y:p.y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:p.x,y:p.y});await delay(50);}
 function key(keyCode,modifiers=[]){win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});}
 async function input(selector,value){await click(selector);key('A',['control']);await win.webContents.insertText(String(value));await wait(()=>js(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(String(value))}`),'typed '+selector);}
 async function select(selector,value){const index=await js(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).findIndex(o=>o.value===${JSON.stringify(value)})`);assert(index>=0,'option exists');
  // Focus the closed select, as gui-pages-native does: Chromium sendInputEvent
  // should target the renderer rather than an OS popup opened by mouseDown.
  await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.focus();return document.activeElement===e;})()`);
  key('Home');await delay(30);for(let i=0;i<index;i++){key('Down');await delay(30);}key('Return');
  try{await wait(()=>js(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(value)}`),'native select '+selector);}catch(error){const diagnostic=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return {active:document.activeElement?.id,value:e.value,index:e.selectedIndex,options:Array.from(e.options).map(o=>({value:o.value,text:o.textContent}))};})()`);throw Error(error.message+'; SELECT '+JSON.stringify(diagnostic));}
 }
 win.show();win.focus();await wait(()=>js(`!!document.querySelector('#character-select').value&&!!current`),'ready');
 const fixture=await js(`(async()=>{const cid=document.querySelector('#character-select').value,p=(await replay.project()).project,c=p.scene.characters.find(c=>c.id===cid),image=p.resources.find(r=>r.kind==='image');for(const e of c.expressionEvents||[])await replay.deleteExpressionEvent(cid,e.id);for(const e of c.expressions||[])await replay.deleteExpression(cid,e.id);const a=await replay.addExpression(cid,{name:'Native A',resourceId:image.id}),b=await replay.addExpression(cid,{name:'Native B',resourceId:image.id});await locate();return {cid,a:a.id,b:b.id};})()`);
 const character=p=>p.project.scene.characters.find(c=>c.id===fixture.cid),events=p=>character(p).expressionEvents||[];
 async function revision(n){await wait(async()=>(await packet()).revision===n,'revision '+n);await wait(()=>js(`current.revision===${n}`),'paint '+n);}
 const base=await packet();await input('#event-frame',30);await select('#event-expression',fixture.a);await click('#event-add');await revision(base.revision+1);
 const added=await packet(),id=events(added).find(e=>e.frame===30)?.id;assert(id);assert.equal(events(added).find(e=>e.id===id).expressionId,fixture.a);
 await wait(()=>js(`selectedEventId===${JSON.stringify(id)}&&document.querySelector('#event-select').value===${JSON.stringify(id)}`),'new event selected');
 await input('#event-frame',40);await select('#event-expression',fixture.b);await click('#event-apply');await revision(added.revision+1);
 const edited=await packet();assert.deepEqual(events(edited).find(e=>e.id===id),{id,frame:40,expressionId:fixture.b});assert.equal(await js('selectedEventId'),id);
 await click('#undo');await revision(edited.revision+1);assert.deepEqual((await packet()).project,added.project);
 await click('#redo');await revision(edited.revision+2);assert.deepEqual((await packet()).project,edited.project);
 const secondBefore=await packet();await input('#event-frame',60);await select('#event-expression',fixture.a);await click('#event-add');await revision(secondBefore.revision+1);
 const two=await packet(),second=events(two).find(e=>e.frame===60).id;assert.equal(await js('selectedEventId'),second);
 await input('#event-frame',40);await click('#event-add');await wait(()=>js(`document.querySelector('#log').textContent.includes('帧已存在')`),'duplicate add refused');assert.deepEqual(await packet(),two);assert.equal(await js('selectedEventId'),second);
 await input('#event-frame',40);await click('#event-apply');await delay(100);assert.deepEqual(await packet(),two);assert.match(await js(`document.querySelector('#log').textContent`),/帧已存在/);
 await select('#event-select',id);assert.equal(await js('selectedEventId'),id);assert.equal(await js(`document.querySelector('#event-frame').value`),'40');
 await click('#event-delete');await revision(two.revision+1);const deleted=await packet();assert.equal(events(deleted).length,1);assert.equal(events(deleted)[0].id,second);assert.equal(await js('selectedEventId'),second);
 await click('#undo');await revision(deleted.revision+1);assert.deepEqual((await packet()).project,two.project);
 await click('#redo');await revision(deleted.revision+2);assert.deepEqual((await packet()).project,deleted.project);
 await click('#undo');await revision(deleted.revision+3);assert.deepEqual((await packet()).project,two.project);
 // Event deletion has no confirmation UI. Expression deletion has a real checkbox and cascades event references.
 await select('#expression-select',fixture.b);const beforeCascade=await packet();assert.equal(await js(`document.querySelector('#expression-delete').disabled`),true);
 await click('#expression-delete');await delay(80);assert.deepEqual(await packet(),beforeCascade);
 await click('#expression-delete-confirm');await wait(()=>js(`!document.querySelector('#expression-delete').disabled`),'delete confirmation');await click('#expression-delete');await revision(beforeCascade.revision+1);
 const cascaded=await packet();assert(!character(cascaded).expressions.some(e=>e.id===fixture.b));assert(!events(cascaded).some(e=>e.id===id));assert(events(cascaded).some(e=>e.id===second));assert.equal(await js('selectedExpressionId'),fixture.a);
 await click('#undo');await revision(cascaded.revision+1);assert.deepEqual((await packet()).project,beforeCascade.project);
 await click('#redo');await revision(cascaded.revision+2);assert.deepEqual((await packet()).project,cascaded.project);
 finish('PASS',{fixture,eventIds:{first:id,second},finalRevision:(await packet()).revision,checks:['native mouse add event and selected identity','native typed frame and keyboard expression selection apply','duplicate frame add/apply rejected atomically','native event selection/delete and exact undo redo','expression delete disabled without confirmation','native confirmation checkbox then cascade delete and undo redo'],limitations:['fixture expressions initialized by production IPC','event-delete has no confirmation control; confirmation tested on expression-delete','not a drag or save/reopen test']});
 }catch(error){finish('FAIL',{error:error.stack||String(error)});}}));
setTimeout(()=>finish('FAIL',{error:'global timeout'}),90000).unref();require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
