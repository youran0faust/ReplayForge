'use strict';
const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../test-output/P2/script-b3-real-'+crypto.randomUUID());
fs.mkdirSync(root,{recursive:true});
let phase='bootstrap',ended=false;const checks=[],picks=[];
function finish(status,error){if(ended)return;ended=true;const report={status,root,phase,checks,picks,error};fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(status==='PASS'?0:1);}
process.on('uncaughtException',e=>finish('FAIL',e.stack));process.on('unhandledRejection',e=>finish('FAIL',e.stack||String(e)));
setTimeout(()=>finish('FAIL','global timeout'),120000).unref();
const runtime=path.join(root,'runtime');fs.mkdirSync(runtime);
for(const n of ['core','renderer','examples','assets','component-packs'])fs.cpSync(path.join(__dirname,n),path.join(runtime,n),{recursive:true});
for(const n of ['main.cjs','export-main.cjs','package.json'])fs.copyFileSync(path.join(__dirname,n),path.join(runtime,n));
const source=path.join(root,'source'),assets=path.join(source,'素材'),output=path.join(root,'generated'),script=path.join(source,'script.txt'),config=path.join(source,'config.json');
for(const d of [output,path.join(assets,'配音'),path.join(assets,'角色/小窗')])fs.mkdirSync(d,{recursive:true});
const longText='这是一段真实字体分页验收对白，字幕必须完整保存，翻页不能重新播放配音。中英文 mixed words 和 emoji 👩‍🚀、组合字符 é 都不能被拆开。'.repeat(2);
fs.writeFileSync(script,['## B3真实验收','@出场 小窗（位置=双人左）','小窗：'+longText,'@停顿 0.5秒','@退场 小窗','旅人：我没有出场图片，也没有场景实例，这是画外音。','@停顿 0.5秒'].join('\n'));
fs.writeFileSync(config,JSON.stringify({version:1,unvoicedDurationSeconds:1,characters:[{name:'小窗',voiceCode:'CHA',expressions:[],image:'小窗/基础.png'},{name:'旅人',voiceCode:'TRV',expressions:[]}]}));
// Exact excerpt filenames exercise automatic matching; fixture stays below filename limits.
function tone(seconds,hz){const count=48000*seconds,b=Buffer.alloc(44+count*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*2,40);for(let i=0;i<count;i++)b.writeInt16LE(Math.round(6000*Math.sin(i*2*Math.PI*hz/48000)),44+i*2);return b;}
fs.writeFileSync(path.join(assets,'配音','CHA_001_'+longText+'.wav'),tone(1,440));fs.writeFileSync(path.join(assets,'配音/TRV_001_我没有出场图片，也没有场景实例，这是画外音。.wav'),tone(1,660));
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');app.disableHardwareAcceleration();
app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
dialog.showOpenDialog=async(_w,o)=>{picks.push(o.title);return{canceled:false,filePaths:[o.title.includes('保存位置')?output:o.title.includes('根目录')?assets:o.title.includes('配置')?config:script]};};
dialog.showMessageBox=async()=>({response:0});dialog.showMessageBoxSync=()=>0;dialog.showSaveDialog=async()=>({canceled:true});
app.once('browser-window-created',(_e,w)=>{
 w.webContents.on('did-fail-load',(_e,c,d,u)=>finish('FAIL',`${c} ${d} ${u}`));
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s),delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function wait(s){for(let i=0;i<400;i++){if(await js(s))return;await delay(40);}throw Error('timeout '+s+' / '+await js('document.querySelector("#script-preflight-status")?.textContent'));}
  async function click(sel){const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseMove','mouseDown','mouseUp'])w.webContents.sendInputEvent({type,...p,...(type==='mouseMove'?{}:{button:'left',clickCount:1})});await delay(130);}
  try{
   phase='native selection';fs.writeFileSync(path.join(assets,'角色/小窗/基础.png'),nativeImage.createFromBitmap(Buffer.from([120,80,200,255]),{width:1,height:1}).resize({width:120,height:180}).toPNG());
   w.setContentSize(1280,800);w.show();w.focus();await wait("typeof scriptPreflightEditor!=='undefined'&&current?.project");const before=await js('replay.project()');
   await click('[data-visual-tab="scriptPreflight"]');for(const k of ['script','assets','config']){await click('#script-preflight-pick-'+k);await wait('!scriptPreflightEditor.busy');}
   await click('#script-preflight-run');await wait('!scriptPreflightEditor.busy&&scriptPreflightEditor.state.report');const report=await js('scriptPreflightEditor.state.report');assert.equal(report.ok,true,JSON.stringify(report.diagnostics));assert.equal(report.summary.voices.matched,2);
   phase='real measurement and generation';await click('#script-preflight-generate');await wait('!scriptPreflightEditor.busy');assert.match(await js('document.querySelector("#script-preflight-status").textContent'),/生成成功/);
   const dirs=fs.readdirSync(output);assert.equal(dirs.length,1);const file=path.join(output,dirs[0],'project.replay.json');
   const {openPortable,saveSessionPortable}=require('./core/project-storage.cjs'),{ProjectSession}=require('./core/session.cjs');const opened=openPortable(file),p=opened.project;
   assert.equal(p.schemaVersion,4);assert.equal(p.scene.characters.length,1);const offstage=p.characterDefinitions.find(d=>d.name==='旅人');assert.ok(offstage);assert.ok(!p.scene.characters.some(c=>c.definitionId===offstage.id));assert.equal(p.scene.dialogues[1].speakerId,offstage.id);
   const first=p.scene.dialogues[0];assert.ok(first.pages.length>1);assert.equal(first.fullText['zh-CN'],longText);assert.equal(first.pages.map(x=>x.text['zh-CN']).join(''),longText);assert.equal(first.voiceClips.length,1);assert.equal(first.displayUntilFrame,first.endFrame+15);
   const session=new ProjectSession(p);const held=session.evaluate(first.endFrame);assert.equal(held.dialogues[0].held,true);assert.equal(held.dialogues[0].pageId,first.pages.at(-1).id);assert.equal(held.dialogues[0].progress,1);for(const page of first.pages)assert.equal(session.evaluate(page.startFrame).dialogues[0].pageId,page.id);fs.writeFileSync(path.join(root,'held-evaluation.json'),JSON.stringify(held,null,2));
   const after=await js('replay.project()');assert.deepEqual(after.project,before.project);assert.equal(after.revision,before.revision);checks.push('native clicks; two automatic voices; long text pages exact; no image or instance for offstage role; hold duration; unchanged active document');
   phase='portable save and reopen';const saved=saveSessionPortable(session,opened.root,path.join(root,'saved/project.json'));fs.rmSync(source,{recursive:true});assert.deepEqual(openPortable(saved.file).project,saved.project);checks.push('portable save/reopen after isolated source deletion');
   fs.writeFileSync(path.join(root,'export-input.json'),JSON.stringify({project:saved.project}));fs.writeFileSync(path.join(root,'evidence.json'),JSON.stringify({file:saved.file,projectRoot:saved.root,frames:p.scene.durationFrames,pageCount:first.pages.length},null,2));fs.writeFileSync(path.join(root,'final.png'),(await w.webContents.capturePage()).toPNG());finish('PASS');
  }catch(e){finish('FAIL',e.stack);}
 });
});
require(path.join(runtime,'main.cjs'));
