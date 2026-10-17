const {app,nativeImage}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
app.once('browser-window-created',(_,win)=>{
 win.webContents.once('did-finish-load',async()=>{
  try{
   const result=await win.webContents.executeJavaScript(`(async()=>{
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    for(let n=0;n<200&&!document.querySelector('#x').value;n++)await sleep(25);
    const before=await replay.project();
    document.querySelector('#x').value=420;document.querySelector('#y').value=80;
    await document.querySelector('#move').onclick();
    const edited=await replay.project();
    await document.querySelector('#export').onclick();
    return {before,edited,message:document.querySelector('#log').textContent,disabled:document.querySelector('#export').disabled};
   })()`);
   assert.equal(result.edited.project.scene.characters[0].x,420);
   assert.equal(result.edited.project.scene.characters[0].y,80);
   assert.equal(result.edited.revision,result.before.revision+1);
   assert.equal(result.disabled,false);
   assert.ok(result.message.startsWith('已导出：'),result.message);
   const video=result.message.slice('已导出：'.length),dir=path.dirname(video);
   const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'export-snapshot.json'),'utf8'));
   assert.deepEqual(snapshot.project,result.edited.project);
   assert.equal(snapshot.revision,result.edited.revision);
   assert.ok(fs.statSync(video).size>1000);
   const frame=nativeImage.createFromPath(path.join(dir,'frames/0000.png'));
   assert.deepEqual(frame.getSize(),{width:960,height:540});
   const bitmap=frame.toBitmap(),pixel=(x,y)=>[...bitmap.subarray((y*960+x)*4,(y*960+x)*4+3)];
   assert.notDeepEqual(pixel(540,180),pixel(800,180));
   // The opaque fallback rectangle is shifted to the edited position.
   // Top-left portrait margin is outside the SVG silhouette, so it has exact fallback color.
   assert.deepEqual(pixel(425,85),[156,139,213]);
   const report={status:'PASS',revision:snapshot.revision,position:{x:420,y:80},video,checks:['real UI coordinate edit','real UI export button','snapshot equals current session','revision preserved','button re-enabled','encoded file exists','frame dimensions','portrait pixel present']};
   fs.mkdirSync(path.join(__dirname,'test-output'),{recursive:true});fs.writeFileSync(path.join(__dirname,'test-output/gui-export.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify(report));app.exit(0);
  }catch(e){console.error(e);app.exit(1)}
 });
});
setTimeout(()=>{console.error('GUI export test timeout');app.exit(1)},180000).unref();
require('./main.cjs');
