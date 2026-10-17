'use strict';
const {app,dialog,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'test-output','context-menu-'+require('node:crypto').randomUUID());fs.mkdirSync(root,{recursive:true});process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');dialog.showMessageBox=async()=>({response:0});
const menus=[],events=[];const original=Menu.buildFromTemplate.bind(Menu);Menu.buildFromTemplate=template=>{const menu=original(template);menus.push({template,menu});return menu;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));async function waitFor(fn,label){for(let i=0;i<200;i++){if(await fn())return;await delay(20);}throw Error('Timeout: '+label);}
app.once('browser-window-created',(_,win)=>{
 win.webContents.on('context-menu',(_,params)=>events.push(params));
 win.webContents.once('did-finish-load',async()=>{try{
  await waitFor(()=>win.webContents.executeJavaScript(`!!document.querySelector('#dialogue-text').value`),'dialogue loaded');win.show();win.focus();win.webContents.focus();
  async function selectText(selected){return win.webContents.executeJavaScript(`(()=>{const t=document.querySelector('#dialogue-text');t.scrollIntoView({block:'center'});t.focus();t.setSelectionRange(0,${selected?'Math.min(4,t.value.length)':'0'});const r=t.getBoundingClientRect();return{x:Math.round(r.left+8),y:Math.round(r.top+8),text:t.value};})()`);}
  async function rightClick(selected){const point=await selectText(selected),count=events.length,menuCount=menus.length;win.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y});win.webContents.sendInputEvent({type:'mouseDown',button:'right',x:point.x,y:point.y,clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',button:'right',x:point.x,y:point.y,clickCount:1});await waitFor(()=>events.length>count&&menus.length>menuCount,'native context menu');const item=menus[menus.length-1],params=events[events.length-1];item.menu.closePopup(win);return{item,params};}
  const first=await rightClick(true);assert.equal(first.params.isEditable,true);assert(first.params.selectionText.length>0,'right click should preserve text selection');
  const expected={undo:['撤销','canUndo'],redo:['重做','canRedo'],cut:['剪切','canCut'],copy:['复制','canCopy'],paste:['粘贴','canPaste'],delete:['删除选中文字','canDelete'],selectAll:['全选','canSelectAll']};
  for(const [role,[label,flag]]of Object.entries(expected)){const entry=first.item.template.find(x=>x.role===role);assert(entry,role);assert.equal(entry.label,label);assert.equal(entry.enabled,!!first.params.editFlags[flag]);}
  assert.equal(first.item.template.find(x=>x.role==='copy').enabled,true);assert.equal(first.item.template.find(x=>x.role==='cut').enabled,true);
  // Do not invoke copy/cut/paste or read/write the user's clipboard. Native typing
  // exercises Chromium input and draft tracking without modifying clipboard data.
  await selectText(false);await win.webContents.insertText('NATIVE_EDIT_');await waitFor(()=>win.webContents.executeJavaScript(`document.querySelector('#dialogue-text').value.startsWith('NATIVE_EDIT_')`),'native insertion');
  const second=await rightClick(false);assert.equal(second.params.selectionText,'');assert.equal(second.item.template.find(x=>x.role==='copy').enabled,false);assert.equal(second.item.template.find(x=>x.role==='cut').enabled,false);assert.equal(second.item.template.find(x=>x.role==='delete').enabled,false);assert.equal(second.item.template.find(x=>x.role==='undo').enabled,true);
  const state=await win.webContents.executeJavaScript(`(async()=>{await pagePublishing;return{dirty:(await replay.project()).dialoguePageDraftDirty,text:document.querySelector('#dialogue-text').value};})()`);assert.equal(state.dirty,true);assert(state.text.startsWith('NATIVE_EDIT_'));
  const report={status:'PASS',checks:['native right mouse context-menu event','real Menu.buildFromTemplate Chinese native edit roles','enabled flags match Chromium editFlags','copy cut delete disabled without selection','native insertText updates page draft','clipboard untouched'],menus:menus.map(m=>m.template.map(({label,role,type,enabled})=>({label,role,type,enabled})))};fs.writeFileSync(path.join(__dirname,'test-output/gui-context-menu.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }catch(e){console.error(e.stack||e);app.exit(1);}});
});
setTimeout(()=>app.exit(1),60000).unref();require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
