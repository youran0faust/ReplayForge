'use strict';
// Test-only Node supervisor. Electron is launched only when this script is explicitly run.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
async function main(){
  const args=process.argv.slice(2);let input=null;
  if(args.length){if(args.length!==2||args[0]!=='--project')throw Error('Usage: node P2/closeout-recovery-cancel.integration.cjs [--project portable-project.json]');input=path.resolve(args[1]);}
  const root=path.resolve(__dirname,'../test-output/P2/closeout-recovery-cancel-'+crypto.randomUUID());fs.mkdirSync(root,{recursive:true});
  const report={status:'RUNNING',root,startedAt:new Date().toISOString(),phases:[],errors:[],encodingCancel:{status:'NOT_RUN',reason:'This run cancels rendering only; historical encoding-cancel evidence is separate.'},limitations:['Native dialogs explicitly stubbed; renderer IPC, RecoveryStore and export workers are real.','Phase1 supervisor kills only its own child after a persisted recovery marker; not an OS power-loss simulation.','Fresh recovery restores model and code draft, not undo history.']};
  const write=(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value,null,2));
  let child=null;
  try{
    const electron=path.resolve(__dirname,'../p0/node_modules/electron/dist/electron.exe');assert(fs.statSync(electron).isFile());
    const tools=path.join(root,'p0/tools');fs.mkdirSync(tools,{recursive:true});for(const n of ['ffmpeg.exe','ffprobe.exe'])fs.copyFileSync(path.resolve(__dirname,'../p0/tools',n),path.join(tools,n));
    for(const phase of [1,2]){const runtime=path.join(root,'runtime-'+phase);fs.mkdirSync(runtime);for(const n of ['core','renderer','assets','examples','component-packs'])fs.cpSync(path.join(__dirname,n),path.join(runtime,n),{recursive:true});for(const n of ['main.cjs','export-main.cjs','package.json','closeout-recovery-worker.cjs'])fs.copyFileSync(path.join(__dirname,n),path.join(runtime,n));}
    const {savePortable,openPortable}=require('./core/project-storage.cjs'),{validateProject}=require('./core/model.cjs');
    let sourceProject,sourceRoot;if(input){assert(fs.statSync(input).isFile(),'--project must be an actual portable JSON file');const loaded=openPortable(input);assert.equal(loaded.project.schemaVersion,4);sourceProject=loaded.project;sourceRoot=loaded.root;report.source={file:input,sha256:hash(input)};}else{sourceProject=JSON.parse(fs.readFileSync(path.join(__dirname,'examples/rain-corridor-v4.json'),'utf8'));sourceRoot=__dirname;report.source={file:'examples/rain-corridor-v4.json',schemaVersion:4};}
    assert.equal(sourceProject.schemaVersion,4);assert(sourceProject.scene.characters.length,'Fixture needs a role for applied x edit');assert(sourceProject.scene.durationFrames>=120,'Formal cancellation fixture must have at least 120 frames');assert.deepEqual(validateProject(sourceProject),[]);
    const fixture=savePortable(sourceProject,0,sourceRoot,path.join(root,'input/project.json'));
    // A separate, explicitly derived short voiced schema4 fixture, never a legacy original-scene fixture.
    const short=JSON.parse(fs.readFileSync(path.join(__dirname,'examples/rain-corridor-v4.json'),'utf8'));short.id+='-closeout-short';short.title+=' · closeout 60-frame derived';short.scene.durationFrames=60;for(const d of short.scene.dialogues){d.startFrame=0;d.endFrame=60;d.displayUntilFrame=60;d.revealFrames=30;for(const p of d.pages||[]){p.startFrame=0;p.endFrame=60;p.revealFrames=30;}for(const v of d.voiceClips||[]){v.durationSamples=96000;v.sourceOffsetSamples=0;v.binding={dialogueId:d.id,mode:'follow',followOffsetFrames:0};}}for(const c of short.scene.characters){c.visibleFrom=0;c.visibleTo=60;}assert.deepEqual(validateProject(short),[]);
    savePortable(short,0,__dirname,path.join(root,'short/project.json'));
    write('config.json',{root,input:fixture.file,formal:path.join(root,'formal/project.json'),short:path.join(root,'short/project.json'),recovery:path.join(root,'recovery')});
    for(const phase of [1,2]){
      const runtime=path.join(root,'runtime-'+phase),log=path.join(root,'phase'+phase+'.log'),fd=fs.openSync(log,'w');
      const env={...process.env,REPLAY_CLOSEOUT_ROOT:root,REPLAY_CLOSEOUT_PHASE:String(phase),REPLAY_RECOVERY_DIR:path.join(root,'recovery')};delete env.ELECTRON_RUN_AS_NODE;
      const result={phase,runtime,profile:path.join(runtime,'user-data'),log};report.phases.push(result);write('report.json',report);
      child=spawn(electron,[path.join(runtime,'closeout-recovery-worker.cjs')],{env,stdio:['ignore',fd,fd],windowsHide:true});fs.closeSync(fd);result.pid=child.pid;const own=child;
      await new Promise((resolve,reject)=>{
        let timer,poll,spawnError,killSent=false,timedOut=false;
        const cleanup=()=>{clearTimeout(timer);clearInterval(poll);};
        own.once('error',e=>{spawnError=e;});
        own.once('close',(code,signal)=>{cleanup();Object.assign(result,{code,signal,killSent,timedOut,closed:true});child=null;if(spawnError)return reject(spawnError);if(timedOut)return reject(Error('phase '+phase+' timed out'));try{if(phase===1){assert(killSent,'phase1 exited before supervisor recovery kill');assert(fs.existsSync(path.join(root,'phase1-ready.json')));}else{assert.equal(code,0,'phase2 worker failure; see '+log);assert.equal(JSON.parse(fs.readFileSync(path.join(root,'phase2-result.json'))).status,'PASS');}resolve();}catch(e){reject(e);}});
        timer=setTimeout(()=>{timedOut=true;own.kill();},phase===1?120000:360000);
        if(phase===1)poll=setInterval(()=>{const marker=path.join(root,'phase1-ready.json');if(killSent||!fs.existsSync(marker))return;try{const ready=JSON.parse(fs.readFileSync(marker));assert.equal(ready.pid,own.pid);assert.equal(ready.status,'READY');assert.equal(hash(path.join(root,'formal/project.json')),ready.formalSha256);killSent=true;result.marker=ready;assert(own.kill(),'owned child kill request rejected');}catch(e){spawnError=e;own.kill();}},50);
      });
    }
    const phase2=JSON.parse(fs.readFileSync(path.join(root,'phase2-result.json')));assert.notEqual(report.phases[0].pid,report.phases[1].pid);assert.notEqual(report.phases[0].profile,report.phases[1].profile);assert.equal(hash(path.join(root,'formal/project.json')),report.phases[0].marker.formalSha256);if(input)assert.equal(hash(input),report.source.sha256);report.evidence=phase2;report.status='PASS';
  }catch(e){report.status='FAIL';report.errors.push(e.stack||String(e));process.exitCode=1;}finally{if(child){const own=child;await new Promise(resolve=>{own.once('close',resolve);own.kill();});}report.finishedAt=new Date().toISOString();write('report.json',report);console.log(JSON.stringify({status:report.status,root,report:path.join(root,'report.json'),errors:report.errors},null,2));}
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
