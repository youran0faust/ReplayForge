'use strict';
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(__dirname,'test-output/audio-'));process.env.REPLAY_RECOVERY_DIR=path.join(dir,'recovery');
const wav=path.join(dir,'short.wav'),samples=4800,b=Buffer.alloc(44+samples*2);
b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);fs.writeFileSync(wav,b);
const save=path.join(dir,'project.json');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[wav]});dialog.showSaveDialog=async()=>({canceled:false,filePath:save});
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{try {
 const r=await win.webContents.executeJavaScript(`(async()=>{
 const $=s=>document.querySelector(s);for(let n=0;n<240&&(!window.timelineTest?.model);n++)await new Promise(r=>setTimeout(r,25));
 const before=await replay.project();$('#audio-track-kind').value='bgm';$('#audio-track-start').value='6';await $('#audio-track-import').onclick();const bgm=await replay.project();
 $('#audio-track-kind').value='sfx';$('#audio-track-start').value='12';await $('#audio-track-import').onclick();const imported=await replay.project();
 $('#audio-track-name').value='Test SFX';$('#audio-track-start').value='24';$('#audio-track-gain').value='1.5';await $('#audio-track-apply').onclick();const edited=await replay.project();
 $('#audio-track-gain').value='';await $('#audio-track-apply').onclick();const invalid=await replay.project();
 $('#audio-track-delete-confirm').checked=true;await $('#audio-track-delete').onclick();const deleted=await replay.project();await $('#undo').onclick();const restored=await replay.project();
 await $('#save').onclick();const saved=await replay.project();return {before,bgm,imported,edited,invalid,deleted,restored,saved,tracks:timelineTest.model.tracks.map(t=>t.kind)};
 })()`,true);
 assert.equal(r.before.project.scene.audioTracks?.length||0,0);assert.equal(r.bgm.project.scene.audioTracks[0].kind,'bgm');assert.equal(r.bgm.project.scene.audioTracks[0].startFrame,6);
 assert.equal(r.imported.project.scene.audioTracks.length,2);assert.equal(r.imported.project.scene.audioTracks[1].durationSamples,samples);assert.equal(r.imported.project.scene.audioTracks[1].kind,'sfx');
 assert.equal(r.edited.project.scene.audioTracks[1].gain,1.5);assert.equal(r.edited.project.scene.audioTracks[1].startFrame,24);assert.equal(r.invalid.revision,r.edited.revision);
 assert.equal(r.deleted.project.scene.audioTracks.length,1);assert.deepEqual(r.restored.project,r.edited.project);assert.ok(r.tracks.includes('audioTracks'));assert.equal(r.saved.dirty,false);
 const reopened=require('./core/project-storage.cjs').openPortable(save);assert.deepEqual(reopened.project.scene.audioTracks,r.edited.project.scene.audioTracks);
 const report={status:'PASS',chooser:'stubbed return; actual WAV import and portable reopen',checks:['initial BGM','SFX','gain and start edit','blank gain rejected','delete undo','portable save reopen','independent timeline lane']};fs.writeFileSync(path.join(__dirname,'test-output/gui-audio-track.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(0);
 }catch(e){console.error(e);app.exit(1)}}));
setTimeout(()=>app.exit(1),60000).unref();require('./main.cjs');const profile=path.join(dir,'profile');fs.mkdirSync(profile);app.setPath('userData',profile);app.setPath('sessionData',profile);
