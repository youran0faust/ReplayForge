'use strict';
// New test-only supervisor/worker adapter. Original harness and production remain untouched.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
function swap(s,a,b){assert(s.includes(a),'Harness contract changed: '+a.slice(0,90));return s.replaceAll(a,b);}
function workerSource(){let s=fs.readFileSync(path.join(__dirname,'closeout-recovery-worker.cjs'),'utf8');
 s=swap(s,"phase===1?110000:330000","phase===1?300000:270000");
 s=swap(s,"const js=code=>window.webContents.executeJavaScript(code);",`const sessionSteps=[];const js=async code=>{const began=Date.now();let timer;try{return await Promise.race([window.webContents.executeJavaScript(code),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Renderer IPC/DOM step timed out: '+activePhase)),30000);})]);}finally{clearTimeout(timer);sessionSteps.push({phase:activePhase,elapsedMs:Date.now()-began});write('phase'+phase+'-steps.json',sessionSteps);}};`);
 s=swap(s,'window=w;w.webContents.on','window=w;w.webContents.setBackgroundThrottling(false);w.webContents.on');
 s=swap(s,"const formalSha256=hash(config.formal);",`const roundMetrics=[],sessionStart=Date.now();
 for(let round=0;round<12;round++){
  const started=Date.now();activePhase='session round '+round+' edit';const before=(await packet()).project;const character=before.scene.characters[0],track=before.scene.audioTracks.find(t=>t.kind==='bgm');assert(track);
  await js('replay.editCharacter('+JSON.stringify(character.id)+','+JSON.stringify({x:character.x+(round%2? -1:1)})+')');
  await js('replay.editAudioTrack('+JSON.stringify(track.id)+','+JSON.stringify({gain:round%2?.15:.14})+')');const edited=(await packet()).project;
  activePhase='session round '+round+' undo redo';await js('replay.undo()');await js('replay.undo()');assert.deepEqual((await packet()).project,before);await js('replay.redo()');await js('replay.redo()');assert.deepEqual((await packet()).project,edited);
  activePhase='session round '+round+' save reopen';await js('(async()=>{await replay.saveAs();await locate();return true;})()');await open(config.formal);assert.deepEqual((await packet()).project,edited);
  activePhase='session round '+round+' seeks';const points=[0,Math.floor(edited.scene.durationFrames/3),Math.floor(edited.scene.durationFrames*2/3),edited.scene.durationFrames-1];for(const at of points){const state=await js('(async()=>{pausePlayback();frame.value='+at+';await locate();await sceneRenderer.ready();return current.state;})()');assert.deepEqual(state,require('./core/model.cjs').evaluate(edited,at));}
  roundMetrics.push({round,elapsedMs:Date.now()-started,seekFrames:points,saveReopenExact:true,undoRedoExact:true});write('session-rounds.json',{rounds:roundMetrics,elapsedMs:Date.now()-sessionStart,scope:'12 bounded real interaction cycles, 48 seeks; not hours-long soak or human native input.'});
 }
 checks.push('12 real edit/undo/redo/save/reopen cycles and 48 evaluated seeks; per-step deadlines and measured wall time');const formalSha256=hash(config.formal);`);
 const start=s.indexOf("  activePhase='system quit cancelled';"),end=s.indexOf('\n}',start);assert(start>0&&end>start);
 s=s.slice(0,start)+`  activePhase='clear recovered draft without replacing recovered model';await js('(async()=>{codeEditor.resetToLatest();syncCodeEditor(current);await publishCodeDraft();await awaitCodeDrafts();await replay.updateCodeDraft(null);return true;})()');assert.deepEqual((await packet()).project,expected.project);const beforeUndo=await packet();await js('replay.undo()');assert.deepEqual((await packet()).project,beforeUndo.project);assert.equal((await packet()).revision,beforeUndo.revision);
  activePhase='export exact recovered real project';const output=await successfulExport();assert.deepEqual((await packet()).project,expected.project);assert.equal(hash(config.formal),expected.formalSha256);write('recovered-export.json',{file:output,sha256:hash(output),worker:exportsObserved.at(-1),frames:expected.project.scene.durationFrames,scope:'Actual export of recovered real project; formal save deliberately remains prior revision. No short synthetic substitute. Independent frame/audio verification is a later step.'});checks.push('Fresh recovered actual project exported by real worker with exit0; preserved formal file hash; no cancellation claimed');assert.deepEqual(errors,[]);finish('PASS');`+s.slice(end);
 return s;}
function supervisorSource(){let s=fs.readFileSync(path.join(__dirname,'closeout-recovery-cancel.integration.cjs'),'utf8');
 s=swap(s,"'../test-output/P2/closeout-recovery-cancel-'","'../test-output/P2/real-assets-s5-session-'");
 s=swap(s,"const {savePortable,openPortable}=require('./core/project-storage.cjs')","for(const phase of [1,2])fs.writeFileSync(path.join(root,'runtime-'+phase,'closeout-recovery-worker.cjs'),require('./real-assets-s5-session.integration.cjs').workerSource());\n    const {savePortable,openPortable}=require('./core/project-storage.cjs')");
 s=swap(s,"phase===1?120000:360000","phase===1?310000:280000");
 s=swap(s,"This run cancels rendering only; historical encoding-cancel evidence is separate.","No cancellation in this S5 run; 12 real session cycles then owned-process kill/recovery and recovered-project export.");
 const a=s.indexOf('    // A separate, explicitly derived short voiced'),b=s.indexOf("    write('config.json'",a);assert(a>0&&b>a);s=s.slice(0,a)+s.slice(b);
 s=swap(s,"if(args.length){","assert.equal(args.length,2,'Explicit --project real portable project required');if(args.length){");
 return s;}
module.exports={workerSource,supervisorSource};if(require.main===module){const entry=new Module(__filename,module);entry.filename=__filename;entry.paths=module.paths;entry._compile(supervisorSource().replace("if(require.main===module)main()","main()"),__filename);}
