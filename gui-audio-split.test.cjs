'use strict';
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(__dirname,'test-output','audio-split-'));
process.env.REPLAY_RECOVERY_DIR=path.join(root,'recovery');
app.disableHardwareAcceleration();app.commandLine.appendSwitch('force-device-scale-factor','1');
const samples=96001,wav=Buffer.alloc(44+samples*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
for(let i=0;i<samples;i++){const amplitude=i<48000?1000:12000;wav.writeInt16LE(Math.round(amplitude*Math.sin(i*2*Math.PI*660/48000)),44+i*2);}
const source=path.join(root,'split.wav');fs.writeFileSync(source,wav);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),originalHash=hash(source);
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});dialog.showMessageBox=async()=>({response:0});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try{
 const js=s=>win.webContents.executeJavaScript(s),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn,label)=>{for(let i=0;i<250;i++){if(await fn())return;await delay(20);}throw Error('Timeout: '+label);};
 win.show();win.focus();await wait(()=>js(`!!window.timelineTest?.model && !!document.querySelector('#dialogue-select').value`),'editor ready');
 await js(`window.$=s=>document.querySelector(s);window.confirm=()=>true;true`);
 const packet=()=>js('(async()=>await replay.project())()');
 const click=async selector=>{const p=await js(`(()=>{const e=$(${JSON.stringify(selector)});if(!e)throw Error('Missing native target');e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await delay(80);};
 const keyS=()=>{win.webContents.sendInputEvent({type:'keyDown',keyCode:'S'});win.webContents.sendInputEvent({type:'char',keyCode:'s'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'S'});};
 const cursor=at=>js(`(async()=>{$('#frame').value=${at};await locate();return true})()`);
 const clip=id=>`.timeline-item[data-kind="audioTracks"][data-id="${id}"]`;
 const voices=(await packet()).project.scene.dialogues;
 const ids=await js(`(async()=>{const ids=[];for(const [kind,startFrame] of [['bgm',30],['sfx',110]]){const r=await replay.importAudioTrack({kind,startFrame});await replay.editAudioTrack(r.id,{sourceOffsetSamples:8000,durationSamples:48001});ids.push(r.id);}await locate();return ids})()`);
 const resources=(await packet()).project.resources;
 for(let i=0;i<ids.length;i++){
  const id=ids[i];await click(clip(id));await wait(()=>js(`selectedAudioTrackId===${JSON.stringify(id)}`),'native clip select');
  const before=await packet(),original=before.project.scene.audioTracks.find(t=>t.id===id),at=original.startFrame+10;
  await cursor(at);
  if(i===0){
   // Refusing to discard a dirty form must preserve both its text and project.
   await js(`$('#audio-track-name').value='UNAPPLIED SPLIT';window.confirm=()=>false;true`);
   await click('#timeline-split');await delay(100);assert.deepEqual((await packet()).project,before.project);assert.equal((await packet()).revision,before.revision);assert.equal(await js(`$('#audio-track-name').value`),'UNAPPLIED SPLIT');
   await js(`window.confirm=()=>true;allowAudioDiscard();syncAudioTrackEditor(current.project);true`);
   // Native S typed into an input is text, not a split shortcut.
   await click('#audio-track-name');keyS();await delay(100);assert.equal((await packet()).revision,before.revision);assert.ok((await js(`$('#audio-track-name').value`)).includes('s'));
   await js(`allowAudioDiscard();syncAudioTrackEditor(current.project);true`);
   // Start, and first integral frame after fractional end, are rejected.
   for(const edge of [original.startFrame,Math.ceil(original.startFrame+original.durationSamples/1600)]){await cursor(edge);await click('#timeline-split');await delay(80);assert.equal((await packet()).revision,before.revision);assert.deepEqual((await packet()).project,before.project);}
   await cursor(at);await click('#timeline-split');
  }else{await click(clip(id));keyS();}
  await wait(async()=> (await packet()).revision===before.revision+1,'one split transaction');
  const after=await packet(),tracks=after.project.scene.audioTracks,left=tracks.find(t=>t.id===id),right=tracks.find(t=>!before.project.scene.audioTracks.some(old=>old.id===t.id));
  assert.ok(right);assert.equal(left.durationSamples,16000);assert.equal(left.sourceOffsetSamples,8000);assert.equal(right.startFrame,at);assert.equal(right.sourceOffsetSamples,24000);assert.equal(right.durationSamples,32001);assert.equal(right.resourceId,left.resourceId);assert.equal(right.kind,original.kind);assert.equal(right.gain,original.gain);
  await wait(()=>js(`selectedAudioTrackId===${JSON.stringify(right.id)} && !!$(${JSON.stringify(clip(right.id)+'.selected')})`),'right clip selected');
  await click('#undo');await wait(async()=> (await packet()).revision===after.revision+1,'undo');assert.deepEqual((await packet()).project,before.project);
  await click('#redo');await wait(async()=> (await packet()).revision===after.revision+2,'redo');assert.deepEqual((await packet()).project,after.project);
 }
 // Exact end rejection (rather than just the fractional-tail out-of-range check).
 await js(`(async()=>{await replay.editAudioTrack(${JSON.stringify(ids[1])},{durationSamples:16000});await locate();return true})()`);
 await click(clip(ids[1]));const edgeBefore=await packet(),edgeTrack=edgeBefore.project.scene.audioTracks.find(t=>t.id===ids[1]);await cursor(edgeTrack.startFrame+10);await click('#timeline-split');await delay(100);assert.deepEqual((await packet()).project,edgeBefore.project);assert.equal((await packet()).revision,edgeBefore.revision);
 assert.deepEqual((await packet()).project.scene.dialogues,voices);assert.deepEqual((await packet()).project.resources,resources);assert.equal(hash(source),originalHash);
 const report={status:'PASS',checks:['sendInputEvent mouse selects BGM/SFX','native split button and native S shortcut','trimmed source offset and fractional sample tail partition','new right clip selected','dirty form cancellation preserves text and revision','native S in input only types','start and exact end rejected','one transaction and exact undo/redo','dialogue voices resource registry and source hash unchanged']};
 fs.writeFileSync(path.join(__dirname,'test-output','gui-audio-split.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
}catch(e){console.error(e.stack||e);app.exit(1)}}));
setTimeout(()=>{console.error('GUI audio split timed out');app.exit(1)},60000).unref();
require('./main.cjs');app.setPath('userData',path.join(root,'profile'));app.setPath('sessionData',path.join(root,'profile'));
