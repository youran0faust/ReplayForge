'use strict';
// Run with Electron. OS window geometry only: no main startup, renderer or fixture.
const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../test-output/P2/window-state-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const file=path.join(root,'editor-window-state.json'),checks=[],measurements=[],windows=new Set(),trackers=new Set();let ended=false;
function finish(status,error){if(ended)return;ended=true;for(const t of trackers)try{t.dispose();}catch{}for(const w of windows)try{if(!w.isDestroyed())w.destroy();}catch{}fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({status,root,checks,measurements,error,scope:'Real BrowserWindow geometry with minimal data URL, isolated profile; main wiring source assertions only',limitations:['No production renderer screenshot or main-project startup','Removed-monitor behavior covered by separate pure tests','setBounds simulates resize/move; not mouse-border gesture']},null,2));console.log(JSON.stringify({status,root,error}));app.exit(status==='PASS'?0:1);}
process.on('uncaughtException',e=>finish('FAIL',e.stack));process.on('unhandledRejection',e=>finish('FAIL',e.stack||String(e)));setTimeout(()=>finish('FAIL','global timeout 60s'),60000).unref();app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms)),keys=['x','y','width','height'];
async function wait(fn,label){const end=Date.now()+8000;let last;while(Date.now()<end){try{if(await fn())return;}catch(e){last=e.message;}await delay(40);}throw Error('Timeout '+label+' '+(last||''));}
const equal=(a,b)=>keys.every(k=>Math.abs(a[k]-b[k])<=2);
function near(a,b,label){assert.ok(equal(a,b),label+' '+JSON.stringify({actual:a,expected:b}));}
function inside(b,a){assert.ok(b.x>=a.x-2&&b.y>=a.y-2&&b.x+b.width<=a.x+a.width+2&&b.y+b.height<=a.y+a.height+2,'full bounds within workArea '+JSON.stringify({b,a}));}
app.whenReady().then(async()=>{try{
 const {getWindowOptions,loadWindowState,trackWindowState}=require('./core/window-state.cjs');
 const main=fs.readFileSync(path.join(__dirname,'main.cjs'),'utf8');
 for(const regex of [/require\(['"]\.\/core\/window-state\.cjs['"]\)/,/screen\.getAllDisplays\(\)/,/screen\.getPrimaryDisplay\(\)/,/app\.getPath\(['"]userData['"]\)/,/getWindowOptions\(\{[^}]*displays:[\s\S]*?saved:loadWindowState\(/,/trackWindowState\(win,\s*windowStateFile\)/,/if\s*\(restoreMaximized\)\s*win\.maximize\(\)/])assert.match(main,regex);
 checks.push('main source wires screen, userData, options/load/track and maximize restore');
 const displays=screen.getAllDisplays(),primaryDisplay=screen.getPrimaryDisplay(),area=primaryDisplay.workArea,options=saved=>getWindowOptions({displays,primaryDisplay,saved});
 const defaults=options(loadWindowState(file));assert.equal(defaults.maximized,false);inside(defaults,area);assert.ok(Math.abs(defaults.height-Math.round(area.height*.92))<=1,'92% primary workArea default height');measurements.push({phase:'default-options',area,defaults,displays:displays.map(d=>({id:d.id,workArea:d.workArea,scaleFactor:d.scaleFactor}))});
 async function create(opts){const {maximized,...bounds}=opts,w=new BrowserWindow({...bounds,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});windows.add(w);w.on('closed',()=>windows.delete(w));await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><title>Window state test</title><h1 id="marker">Isolated geometry test</h1>'));assert.equal(await w.webContents.executeJavaScript('document.querySelector("#marker").textContent'),'Isolated geometry test');if(maximized){w.maximize();await wait(()=>w.isMaximized(),'restore maximize');}return w;}
 function track(w){const t=trackWindowState(w,file);assert.equal(typeof t.save,'function');assert.equal(typeof t.dispose,'function');trackers.add(t);return t;}
 async function destroy(w,t){await t.save();t.dispose();trackers.delete(t);w.destroy();await wait(()=>w.isDestroyed(),'destroy');}
 let w=await create(defaults),t=track(w);await wait(()=>equal(w.getBounds(),defaults),'native default geometry');inside(w.getBounds(),area);checks.push('native default height 92% and complete outer bounds inside primary workArea');
 const target={x:area.x+Math.round(area.width*.08),y:area.y+Math.round(area.height*.06),width:Math.round(area.width*.72),height:Math.round(area.height*.78)};
 w.setBounds(target);await wait(()=>equal(w.getBounds(),target),'native move/resize');const normal=w.getBounds();inside(normal,area);
 await wait(()=>fs.existsSync(file)&&equal(options(loadWindowState(file)),normal)&&!options(loadWindowState(file)).maximized,'resize/move event persistence');const saved=loadWindowState(file);near(options(saved),normal,'normal save/load');measurements.push({phase:'resized',target,normal,saved});checks.push('native setBounds resize/move events persist file and load round trip');
 await destroy(w,t);w=await create(options(loadWindowState(file)));t=track(w);await wait(()=>equal(w.getBounds(),normal),'normal recreate');assert.equal(w.isMaximized(),false);checks.push('destroy/recreate restores normal bounds');
 w.maximize();await wait(()=>w.isMaximized(),'maximize');await wait(()=>options(loadWindowState(file)).maximized===true,'maximize persistence');await t.save();const maxSaved=loadWindowState(file);assert.equal(options(maxSaved).maximized,true);near(options(maxSaved),normal,'maximized saved normal bounds');near(w.getNormalBounds(),normal,'native normal bounds while maximized');measurements.push({phase:'maximized',bounds:w.getBounds(),normal:w.getNormalBounds(),saved:maxSaved});
 await destroy(w,t);w=await create(options(loadWindowState(file)));t=track(w);assert.equal(w.isMaximized(),true);near(w.getNormalBounds(),normal,'maximized recreate normal bounds');checks.push('maximize persisted and recreated maximized without losing normal bounds');
 w.unmaximize();await wait(()=>!w.isMaximized()&&equal(w.getBounds(),normal),'unmaximize normal bounds');await t.save();assert.equal(options(loadWindowState(file)).maximized,false);
 w.close();await wait(()=>w.isDestroyed(),'native close');t.dispose();trackers.delete(t);w=await create(options(loadWindowState(file)));t=track(w);await wait(()=>equal(w.getBounds(),normal),'close/recreate geometry');checks.push('unmaximize and native close/recreate retain normal bounds');
 await destroy(w,t);finish('PASS');
}catch(e){finish('FAIL',e.stack);}});
