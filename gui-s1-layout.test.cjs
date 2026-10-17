'use strict';
const {app,dialog}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const runId=crypto.randomUUID(),root=path.resolve(__dirname,'../test-output/P2','s1-layout-'+runId),start=new Date().toISOString();
fs.mkdirSync(root,{recursive:true});process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const fixtureRoot=path.resolve(__dirname,'fixtures/original-scene-project');
const fixture=path.join(root,'fixture');fs.cpSync(fixtureRoot,fixture,{recursive:true});
const base=JSON.parse(fs.readFileSync(path.join(fixture,'场景.json'),'utf8'));
const character=base.project.scene.characters[0],seed=structuredClone(character.expressions[0]);
for(let i=character.expressions.length;i<50;i++)character.expressions.push({...structuredClone(seed),id:'layout-expression-'+i,name:'布局测试表情 '+i+' · 长名称测试'});
const ordinary=path.join(fixture,'layout-50.json'),expanded=path.join(fixture,'layout-50-plus6.json');
fs.writeFileSync(ordinary,JSON.stringify(base,null,2));
const more=structuredClone(base);
for(let i=0;i<6;i++)more.project.scene.characters.push({...structuredClone(character),id:'layout-extra-'+i,name:'布局附加角色 '+i,expressionEvents:[],expressions:[],x:30+i*60});
fs.writeFileSync(expanded,JSON.stringify(more,null,2));
let selectedFile=ordinary,ended=false;const measurements=[],failures=[],errors=[];
const hashes=Object.fromEntries(['renderer/index.html','renderer/editor-layout.css','renderer/editor-layout.js','renderer/preview.js','renderer/asset-library.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));
function finish(status,extra={}){if(ended)return;ended=true;fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({status,runId,start,finishedAt:new Date().toISOString(),hashes,measurements,failures,errors,...extra},null,2));console.log(root,status);app.exit(status==='PASS'?0:1);}
dialog.showMessageBox=async()=>({response:1});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selectedFile]});
app.once('browser-window-created',(_,win)=>{win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});win.webContents.once('did-finish-load',async()=>{
 const js=s=>win.webContents.executeJavaScript(s),delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function wait(expr,label){const end=Date.now()+15000;while(Date.now()<end){if(await js(expr))return;await delay(30);}throw Error('Timeout: '+label);}
 const probe=`(()=>{const $=s=>document.querySelector(s),rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},content=e=>{const r=rect(e),s=getComputedStyle(e);return{...r,innerHeight:r.width>0&&r.height>0?e.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom):null}};const grid=$('#expression-library-grid'),g=rect(grid),cards=[...grid.querySelectorAll('.production-expression-card')].map(rect),audio=$('#audio-panel'),stage=$('#stage'),preview=$('.preview');return{viewport:[innerWidth,innerHeight],focus:editorLayout.snapshot(),stage:rect(stage),preview:rect(preview),audio:rect(audio),audioContent:content($('#audio-content')),visual:rect($('#visual-panel')),grid:g,gridVisible:g.width>0&&g.height>0,completeCards:g.width>0&&g.height>0?cards.filter(r=>r.width>0&&r.height>0&&r.x>=g.x-.1&&r.y>=g.y-.1&&r.right<=g.right+.1&&r.bottom<=g.bottom+.1).length:0,cardCount:cards.length,cardSample:cards[0],timeline:rect($('#timeline')),timelineClient:$('#timeline').clientHeight,timelineScroll:$('#timeline').scrollHeight,title:rect($('#app-titlebar')),menu:rect($('#app-menubar')),portrait:$('.production-expression-card .production-portrait')?rect($('.production-expression-card .production-portrait')):null};})()`;
 const check=(condition,label,m)=>{if(!condition)failures.push({label,viewport:m.viewport,mode:m.mode,plus6:m.plus6});};
 try{
  await wait('!!current&&!!productionAssets&&!!window.editorLayout','startup');win.show();
  for(const plus6 of [false,true]){
   selectedFile=plus6?expanded:ordinary;
   await js('(async()=>{await replay.openProject();await locate();})()');
   await wait('current.project.scene.characters[0].expressions.length===50','50 real expressions');
   for(const [width,height,minCards] of [[1280,800,12],[1366,768,12],[1440,900,12],[1920,1080,24]]){
    win.setContentSize(width,height);
    for(const mode of ['ordinary','expressions']){
     await js(mode==='expressions'?`productionAssets.showExpressions(${JSON.stringify(character.id)});document.querySelector('#expression-library-grid').scrollTop=0;editorLayout.refresh()`:`editorLayout.showVisualTab('character');editorLayout.setFocus(null);editorLayout.showAudioTab('dialogue');editorLayout.refresh()`);
     await delay(400);await js('document.fonts.ready');await delay(80);
     const m=await js(probe);m.mode=mode;m.plus6=plus6;measurements.push(m);
     check(m.viewport[0]===width&&m.viewport[1]===height,'exact content size',m);
     check(m.title.height===40&&m.menu.height===32,'40px title and32px menu',m);
     check(Math.abs(m.stage.width/m.stage.height-16/9)<.001,'16:9 scene',m);
     check(m.stage.width>=599,'stage width at least approximately600',m);
     check(m.stage.x>=m.preview.x-.01&&m.stage.y>=m.preview.y-.01&&m.stage.right<=m.preview.right+.01&&m.stage.bottom<=m.preview.bottom+.01,'stage fully contained without half-pixel overflow',m);
     if(mode==='ordinary'){check(m.audioContent.innerHeight>=80,'audio actual content at least80',m);check(!m.gridVisible&&m.completeCards===0,'hidden library has zero visible cards',m);}
     else{check(m.audioContent.innerHeight===null,'hidden audio content is not measurable',m);check(Math.abs(m.audio.height-32)<.01,'audio summary32',m);check(m.cardCount===50,'50 real cards',m);check(m.completeCards>=minCards,'complete cards minimum '+minCards,m);check(m.cardSample.height===72,'72px dense cards',m);check(Math.abs(m.portrait.width/m.portrait.height-2/3)<.001,'2:3 portrait container',m);}
     if(plus6)check(m.timelineScroll>m.timelineClient,'extra tracks scroll internally',m);
     fs.writeFileSync(path.join(root,`${width}x${height}-${mode}-${plus6?'plus6':'base'}.png`),(await win.webContents.capturePage()).toPNG());
    }
   }
  }
  assert.equal(failures.length,0,JSON.stringify(failures));
  finish('PASS',{checks:['four exact content sizes','ordinary and expression focus','base and six extra real characters','50 real expression definitions in isolated fixture','stage geometry and complete containment','audio content80 and summary32','complete dense card counts','internal timeline scrolling'],limitations:['file dialog is test stub; no external OS drag','test expressions intentionally share existing image resource in isolated fixture only','screenshots captured, not visual aesthetic acceptance','no DPI variants or long-duration performance test']});
 }catch(error){finish('FAIL',{error:error.stack});}
 });});
setTimeout(()=>finish('FAIL',{error:'global timeout'}),120000).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
