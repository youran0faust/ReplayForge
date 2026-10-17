'use strict';
const {app, dialog, Menu} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.join(__dirname, 'test-output', 'file-menu-' + crypto.randomUUID());
fs.mkdirSync(root, {recursive:true});
const file = path.join(root, 'project.json'), saveAsFile = path.join(root, 'project-copy.json');
process.env.REPLAY_RECOVERY_DIR = path.join(root, 'recovery');
app.disableHardwareAcceleration();
let saveCalls = 0, openCalls = 0;
dialog.showSaveDialog = async () => ({canceled:false, filePath:saveCalls++ ? saveAsFile : file});
dialog.showOpenDialog = async () => { openCalls++; return {canceled:false, filePaths:[saveAsFile]}; };
dialog.showMessageBox = async () => ({response:0});
app.once('browser-window-created', (_, win) => win.webContents.once('did-finish-load', async () => {
 try {
  const js = source => win.webContents.executeJavaScript(source);
  const wait = async (fn, label) => {
   for (let i=0; i<300; i++) { if (await fn()) return; await new Promise(r=>setTimeout(r,20)); }
   throw Error('file menu test timeout: ' + label + '; ' + await js('document.querySelector("#log").textContent'));
  };
  await wait(()=>js('typeof current !== "undefined" && !!current && !!document.querySelector("#save").onclick'), 'startup');
  const menu = Menu.getApplicationMenu(), fileMenu = menu?.items.find(item=>/文件/.test(item.label));
  assert.ok(fileMenu, 'File menu missing');
  const labels = fileMenu.submenu.items.filter(item=>item.label && (!item.type || item.type==='normal')).map(item=>item.label);
  assert.deepEqual(labels.slice(0,5), ['打开工程…','保存工程','另存为…','导出 MP4…','取消导出']);
  for (const accelerator of ['CmdOrCtrl+S','CmdOrCtrl+O','CmdOrCtrl+Shift+S']) {
   assert.ok(fileMenu.submenu.items.find(item=>item.accelerator===accelerator), accelerator);
  }
  // Observe completion of the real button action reached via menu -> preload -> renderer.
  // Saved status can appear before locate() and the action promise have finished.
  await js(`(() => {
   window.fileMenuActions = {};
   for (const id of ['save','save-as','open']) {
    const button=document.getElementById(id), original=button.onclick;
    window.fileMenuActions[id]={started:0,finished:0};
    button.onclick=async function(...args) {
     window.fileMenuActions[id].started++;
     try { return await original.apply(this,args); }
     finally { window.fileMenuActions[id].finished++; }
    };
   }
  })()`);
  const shortcut = (key, modifiers) => {
   win.webContents.sendInputEvent({type:'keyDown',keyCode:key,modifiers});
   win.webContents.sendInputEvent({type:'keyUp',keyCode:key,modifiers});
  };
  const completed = id => wait(()=>js(`window.fileMenuActions[${JSON.stringify(id)}].finished===1`), id+' action settlement');
  const status = () => js(`(() => {const e=document.querySelector('#file-status'),r=e.getBoundingClientRect();return {text:e.textContent,saved:e.classList.contains('saved'),visible:r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight}})()`);
  assert.match((await status()).text,/未保存/);
  win.show(); win.focus();
  shortcut('S',['control']);
  await completed('save');
  assert.equal(await js('document.querySelector("#log").textContent'), '已保存：'+file);
  const firstStatus=await status();
  assert.ok(firstStatus.saved && firstStatus.visible); assert.ok(firstStatus.text.includes(file));
  assert.ok(fs.existsSync(file)); assert.equal(saveCalls,1);

  await js('replay.addCharacter()');
  await wait(()=>js('document.querySelector("#file-status").textContent.includes("未保存")'),'dirty state');
  assert.equal((await status()).saved,false);
  shortcut('S',['control','shift']);
  await completed('save-as');
  assert.equal(await js('document.querySelector("#log").textContent'), '已另存：'+saveAsFile);
  assert.equal(saveCalls,2); assert.ok(fs.existsSync(saveAsFile));
  const savedPacket=await js('replay.project()');
  const savedProject=JSON.parse(fs.readFileSync(saveAsFile,'utf8')).project;
  assert.deepEqual(savedPacket.project,savedProject);
  assert.ok((await status()).text.includes(saveAsFile));

  shortcut('O',['control']);
  await completed('open');
  await wait(async()=>openCalls===1 && await js(`current.documentId!==${JSON.stringify(savedPacket.documentId)}`),'new document installed');
  assert.equal(await js('document.querySelector("#log").textContent'),'已打开：'+saveAsFile);
  const reopened=await js('replay.project()');
  assert.notEqual(reopened.documentId,savedPacket.documentId);
  assert.deepEqual(reopened.project,savedProject);
  assert.equal(reopened.file,saveAsFile); assert.equal(reopened.dirty,false);
  const reopenedStatus=await status();
  assert.ok(reopenedStatus.saved && reopenedStatus.visible && reopenedStatus.text.includes(saveAsFile));
  assert.deepEqual(await js('window.fileMenuActions'),{save:{started:1,finished:1},'save-as':{started:1,finished:1},open:{started:1,finished:1}});
  const report={status:'PASS',checks:['File menu labels and accelerators','native Ctrl+S bridge, fully settled save, visible path and saved status','mutation visible unsaved status','native Ctrl+Shift+S bridge and fully settled portable save','native Ctrl+O bridge, fully settled open, changed documentId and exact reopened project'],saveCalls,openCalls};
  fs.writeFileSync(path.join(__dirname,'test-output/gui-file-menu.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));app.exit(0);
 } catch(error) { console.error(error);app.exit(1); }
}));
setTimeout(()=>{console.error('file menu test timed out');app.exit(1)},60000).unref();
require('./main.cjs');
const profile=path.join(root,'profile');fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',profile);
