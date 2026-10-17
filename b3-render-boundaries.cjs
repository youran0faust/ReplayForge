'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const root=path.resolve(process.env.B3_EVIDENCE_ROOT||'test-output/P2/script-b3-real-0b9c0f16-a605-402b-84ff-ce1814b10e03');
app.disableHardwareAcceleration();app.setPath('userData',path.join(root,'boundary-profile'));
const {ProjectSession}=require('./core/session.cjs');
app.whenReady().then(async()=>{
 const p=JSON.parse(fs.readFileSync(path.join(root,'export-input.json'),'utf8')).project,s=new ProjectSession(p),urls=Object.fromEntries(p.resources.map(r=>[r.id,pathToFileURL(path.join(root,'saved',r.path)).href]));
 // Exercise editing the actual generated project, then exact history restoration.
 const original=s.snapshot(),first=p.scene.dialogues[0];s.editDialoguePage(first.id,first.pages[0].id,{text:'修改后的第一页'});assert.equal(s.snapshot().scene.dialogues[0].fullText[p.locale],'修改后的第一页'+first.pages.slice(1).map(x=>x.text[p.locale]).join(''));s.undo();assert.deepEqual(s.snapshot(),original);
 const win=new BrowserWindow({show:false,width:960,height:540,useContentSize:true,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 await win.loadFile(path.join(__dirname,'renderer/export.html'));await win.webContents.executeJavaScript(`initialize(${JSON.stringify(p)},${JSON.stringify(urls)})`);
 const reports=[];
 for(const f of [0,14,15,29,30,44,45,74,75,89]){
  const state=s.evaluate(f);await win.webContents.executeJavaScript(`renderFrame(${JSON.stringify(state)})`);
  const actual=await win.webContents.executeJavaScript(`(()=>{const b=document.querySelector('.dialogue-body'),speaker=document.querySelector('.dialogue-speaker'),css=getComputedStyle(b),range=document.createRange();range.selectNodeContents(b);const rects=Array.from(range.getClientRects()).filter(r=>r.height>0);return{text:b.textContent,speaker:speaker.textContent,hidden:b.hidden,width:parseFloat(css.width),font:css.fontFamily,fontSize:css.fontSize,overflowX:b.scrollWidth>b.clientWidth,dpr:devicePixelRatio,rects:rects.map(r=>({top:r.top,left:r.left,right:r.right}))}})()`);
  assert.equal(actual.text,state.dialogues[0].text);assert.equal(actual.speaker,f<45?'小窗':'旅人');assert.equal(actual.hidden,false);assert.equal(actual.width,822);assert.equal(actual.overflowX,false);
  // Range may contain duplicate rects for the text-revealer span; cluster baselines.
  const tops=[];for(const r of actual.rects)if(!tops.some(t=>Math.abs(t-r.top)<4))tops.push(r.top);assert.ok(tops.length<=3,JSON.stringify(actual));
  reports.push({frame:f,pageId:state.dialogues[0].pageId,held:!!state.dialogues[0].held,progress:state.dialogues[0].progress,...actual,lineCount:tops.length});
 }
 fs.writeFileSync(path.join(root,'render-boundaries.json'),JSON.stringify({status:'PASS',reports,limitation:'DOM/text/layout assertions, not human screenshot review'},null,2));win.destroy();app.exit(0);
}).catch(e=>{fs.writeFileSync(path.join(root,'render-boundaries.json'),JSON.stringify({status:'FAIL',error:e.stack}));console.error(e);app.exit(1);});
