const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{pathToFileURL}=require('url');
const {evaluate}=require('./core/model.cjs');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',path.join(__dirname,'user-data/parity'));
function diff(a,b){assert.equal(a.length,b.length);let changed=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d)changed++;max=Math.max(max,d)}return {exact:a.equals(b),changedChannels:changed,maxChannelDelta:max};}
const results=[];const centered=process.env.PARITY_CENTERED==='1';
function saveReport(status,error){const dir=path.join(__dirname,'test-output');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,centered?'parity-centered.json':'parity-origin.json'),JSON.stringify({status,scale:1,centered,results,error:error?.message},null,2));}
app.whenReady().then(async()=>{
 const project=JSON.parse(fs.readFileSync(path.join(__dirname,'examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,''));
 const urls=Object.fromEntries(project.resources.map(r=>[r.id,pathToFileURL(path.join(__dirname,r.path)).href]));
 const packet={project,revision:0,resourceUrls:urls};
 ipcMain.handle('parity-project',()=>packet);ipcMain.handle('parity-evaluate',(_,f)=>evaluate(project,f));
 const previewSize=centered?{width:1400,height:800}:{width:1270,height:540};
 const preview=new BrowserWindow({...previewSize,useContentSize:true,show:false,webPreferences:{offscreen:true,backgroundThrottling:false,preload:path.join(__dirname,'parity-preload.cjs')}});
 const output=new BrowserWindow({width:960,height:540,useContentSize:true,show:false,webPreferences:{offscreen:true,backgroundThrottling:false}});
 await preview.loadFile(path.join(__dirname,'renderer/index.html'));await output.loadFile(path.join(__dirname,'renderer/export.html'));
 for(const locale of ['zh-CN','ja-JP','en-US']){project.locale=locale;await output.webContents.executeJavaScript(`initialize(${JSON.stringify(project)},${JSON.stringify(urls)})`);
  for(const f of [0,29,30,45,90,119,179,180,438]){const state=evaluate(project,f);
   await preview.webContents.executeJavaScript(`previewTest.render(${JSON.stringify(state)},${JSON.stringify(packet)})`);
   const rect=await preview.webContents.executeJavaScript(`(()=>{const r=previewTest.stage.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)}})()`);
   assert.equal(rect.width,960);assert.equal(rect.height,540);await output.webContents.executeJavaScript(`renderFrame(${JSON.stringify(state)})`);
   const directImage=await preview.webContents.capturePage(rect);const direct=directImage.toBitmap();const full=await preview.webContents.capturePage();
   const cropImage=full.crop(rect),exportImage=await output.webContents.capturePage();
   const cropped=cropImage.toBitmap();const expected=exportImage.toBitmap();
   const directDiff=diff(direct,expected),cropDiff=diff(cropped,expected),captureDiff=diff(direct,cropped);
   // Centered mode is diagnostic: preserve the evidence even when direct
   // capturePage(rect) is the failing operation. Normal parity stays strict.
   const diagnostic={locale,frame:f,rect,direct:directDiff,crop:cropDiff,directVsCrop:captureDiff};
   results.push(diagnostic);
   saveReport('RUNNING');
   if(directDiff.maxChannelDelta>1||cropDiff.maxChannelDelta>1){
    const dir=path.join(__dirname,'test-output',centered?'centered-evidence':'origin-evidence');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,`${locale}-${f}-full.png`),full.toPNG());
    fs.writeFileSync(path.join(dir,`${locale}-${f}-crop.png`),cropImage.toPNG());
    fs.writeFileSync(path.join(dir,`${locale}-${f}-direct.png`),directImage.toPNG());
    fs.writeFileSync(path.join(dir,`${locale}-${f}-export.png`),exportImage.toPNG());
    const geometryScript=`(()=>{const stage=document.querySelector('#stage'),origin=stage.getBoundingClientRect();return {devicePixelRatio,viewport:[innerWidth,innerHeight],nodes:[stage,...stage.querySelectorAll('*')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {class:n.className,text:n.textContent,relativeRect:[r.x-origin.x,r.y-origin.y,r.width,r.height],backgroundImage:s.backgroundImage,backgroundColor:s.backgroundColor,transform:s.transform,font:s.font}})}})()`;
    const geometry={preview:await preview.webContents.executeJavaScript(geometryScript),export:await output.webContents.executeJavaScript(geometryScript)};
    fs.writeFileSync(path.join(dir,`${locale}-${f}-geometry.json`),JSON.stringify(geometry,null,2));
   }
   if(centered && results.length===1) console.log(JSON.stringify({firstCenteredDiagnostic:diagnostic}));
   if(!centered) assert.ok(directDiff.maxChannelDelta<=1,`${locale} frame ${f} differs: max ${directDiff.maxChannelDelta}`);
   else assert.ok(cropDiff.maxChannelDelta<=1,`${locale} frame ${f} full-crop differs: max ${cropDiff.maxChannelDelta}`);
  }
 }
 saveReport('PASS');
 console.log(JSON.stringify({status:'PASS',comparisons:results.length,centered}));preview.destroy();output.destroy();app.quit();
}).catch(e=>{saveReport('FAIL',e);console.error(e);app.exit(1)});
