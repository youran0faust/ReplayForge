'use strict';
// Diagnostic only. Reads an existing isolated closeout runtime/project, writes a
// unique probe directory; never modifies its runtime, fixtures, or failed exports.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]||''),manifest=JSON.parse(fs.readFileSync(path.join(root,'fixture-manifest.json'),'utf8'));
const output=path.join(root,'paint-probe-'+crypto.randomUUID());fs.mkdirSync(output);
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');app.setPath('userData',path.join(output,'profile'));app.setPath('sessionData',app.getPath('userData'));
const events=[],captures=[],dom=[];let phase='bootstrap',seq=0,win;
const deadline=setTimeout(()=>finish('Probe deadline 30s'),30000);
function imageRecord(image,name){if(!image||typeof image.toPNG!=='function')return {missing:true};const bytes=image.toPNG(),bitmap=image.toBitmap(),size=image.getSize();fs.writeFileSync(path.join(output,name+'.png'),bytes);return {file:name+'.png',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bitmapSha256:crypto.createHash('sha256').update(bitmap).digest('hex'),size,firstBGRA:[...bitmap.subarray(0,4)]};}
function finish(error){clearTimeout(deadline);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({output,phase,error,events,captures,dom},null,2));console.log(JSON.stringify({output,error,events:events.length,captures:captures.length}));if(win&&!win.isDestroyed())win.destroy();app.exit(error?1:0);}
app.whenReady().then(async()=>{
 const runtime=manifest.runtime,data=JSON.parse(fs.readFileSync(manifest.shortFile,'utf8')),project=data.project||data;
 const {ProjectSession}=require(path.join(runtime,'core/session.cjs')),{diagnoseAudio}=require(path.join(runtime,'core/resource-index.cjs'));
 const diag=diagnoseAudio(project,manifest.shortRoot),urls=Object.fromEntries(Object.entries(diag.resources).map(([id,r])=>[id,pathToFileURL(r.absolute).href])),session=new ProjectSession(project),{width,height}=project.design;
 win=new BrowserWindow({width,height,useContentSize:true,show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
 const wc=win.webContents;
 wc.on('paint',(details,dirtyRect,image)=>{const index=seq++;events.push({index,phase,dirtyRect:details.dirtyRect||dirtyRect,...(index<12?imageRecord(details.image||image,'paint-'+index):{})});});
 wc.on('console-message',(...args)=>{events.push({console:true,phase,message:args[0]?.message||args[2]});});
 const js=source=>wc.executeJavaScript(source);
 const inspect=async(label)=>{dom.push({label,phase,value:await js(`(()=>{const stage=document.querySelector('#stage'),bg=document.querySelector('#background');return {stageRect:stage.getBoundingClientRect().toJSON(),backgroundStyle:bg?.getAttribute('style'),backgroundComputed:bg&&getComputedStyle(bg).backgroundImage,dialogue:document.querySelector('#dialogue')?.outerHTML,stageChildren:[...stage.children].map(n=>({className:n.className,hidden:n.hidden,style:n.getAttribute('style')}))};})()`)});};
 const shot=async(label)=>captures.push({phase,label,...imageRecord(await wc.capturePage(),label)});
 const barrier=require('./core/export-capture.cjs').capturePaintedFrame;
 phase='load';await win.loadFile(path.join(runtime,'renderer/export.html'));
 phase='initialize';await js(`initialize(${JSON.stringify(project)},${JSON.stringify(urls)})`);await inspect('initialized');
 phase='render0';await js(`renderFrame(${JSON.stringify(session.evaluate(0))})`);await inspect('render0-DOM');
 phase='invalidate0';captures.push({phase,label:'barrier0',...imageRecord(await barrier(wc),'barrier0')});
 phase='post-barrier0';await shot('direct0');
 phase='extra-RAF0';await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await shot('after-RAF0');
 phase='render1';await js(`renderFrame(${JSON.stringify(session.evaluate(1))})`);await inspect('render1-DOM');
 phase='invalidate1';captures.push({phase,label:'barrier1',...imageRecord(await barrier(wc),'barrier1')});
 phase='render0-again';await js(`renderFrame(${JSON.stringify(session.evaluate(0))})`);await inspect('render0-again-DOM');
 phase='invalidate0-again';captures.push({phase,label:'barrier0-again',...imageRecord(await barrier(wc),'barrier0-again')});
 finish();
}).catch(error=>finish(error.stack));
