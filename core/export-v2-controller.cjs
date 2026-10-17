'use strict';
const fs=require('node:fs'),path=require('node:path');
// Main owns paths/tools. Renderer supplies only a worker count.
function createController(d){
 let active=null,lastCompleted=null;
 const progress=(event,p)=>{if(!event.sender.isDestroyed?.())event.sender.send('export-v2-progress',p);};
 function guard(event){d.authorize(event);d.requireIdle();if(active)throw Error('已有导出任务运行');d.guardDrafts();}
 function root(){const r=d.managedRoot();if(!fs.existsSync(r))fs.mkdirSync(r,{recursive:true});d.ordinary(r,true);return r;}
 const registry=()=>path.join(root(),'last-job.json');
 function remember(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('任务标识无效');const f=registry();if(fs.existsSync(f))d.ordinary(f);const tmp=f+'.tmp';const fd=fs.openSync(tmp,'wx');try{fs.writeFileSync(fd,JSON.stringify({version:1,id}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,f);}
 function previous(){const f=registry();d.ordinary(f);const x=JSON.parse(fs.readFileSync(f,'utf8'));if(x.version!==1||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x.id))throw Error('上次任务记录无效');return path.join(root(),x.id);}
 async function execute(event,resuming,payload={}){
  guard(event);if(!payload||typeof payload!=='object'||Object.keys(payload).some(k=>k!=='workers'))throw Error('无效导出设置');
  const workers=payload.workers??4;if(![1,2,4,8].includes(workers))throw Error('无效并发模式');
  const ac=new AbortController();active={jobRoot:null,controller:ac};d.setBusy(true,active);
  const emit=p=>progress(event,p);
  try{
   d.checkDependencies();let jobRoot;
   if(resuming){jobRoot=previous();const answer=await d.confirmResume();if(!answer)return null;}
   else{
    const captured=d.capture(),project=d.snapshot();let name;
    try{name=d.publicName(project.title);}catch{name=d.publicName('导出视频');}
    const selected=await d.chooseTarget(name);d.assertUnchanged(captured);d.guardDrafts();if(selected.canceled||!selected.filePath)return null;
    if(ac.signal.aborted)throw Error('导出已取消');
    try{d.validateTarget(selected.filePath);}catch(error){if(fs.existsSync(selected.filePath))throw Error('目标文件已存在，请另选文件名；不会覆盖原成片');throw error;}
    const created=await d.coordinator.create({...d.spec(),project,projectRoot:captured.root,managedRoot:root(),target:selected.filePath,workers,reuse:'on'});
    jobRoot=created.jobRoot;remember(created.jobId);
   }
   active.jobRoot=jobRoot;if(ac.signal.aborted)throw Error('导出已取消');
   const opts={onProgress:emit,signal:ac.signal};
   const hasFinal=resuming&&fs.existsSync(path.join(jobRoot,'state','final.json'));
   const state=hasFinal?{status:'VIDEO_SEGMENTS_COMPLETE'}:await (resuming?d.coordinator.resume(jobRoot,opts):d.coordinator.run(jobRoot,opts));
   if(state.status==='CANCELLED'||ac.signal.aborted)throw Error('导出已取消；可继续上次导出');
   if(state.status!=='VIDEO_SEGMENTS_COMPLETE')throw Error('导出失败，已保留恢复任务：'+jobRoot);
   let final;try{final=await (hasFinal?d.resumeFinalization:d.finalize)({jobRoot,...opts});}catch(error){if(ac.signal.aborted&&/Cancelled/.test(error.message))throw Error('导出已取消；可继续上次导出');throw error;}
   if(!['PASS','PUBLISHED_CLEANUP_PENDING'].includes(final.status))throw Error('合成未完成，诊断保留：'+jobRoot);
   lastCompleted=final.output;let warning=final.status!=='PASS';
   if(!warning&&d.cleanupCompleted)try{await d.cleanupCompleted(jobRoot);}catch(error){warning=true;emit({stage:'cleanup-warning',message:'成片完成，临时分段清理待处理：'+error.message});}
   emit({stage:warning?'cleanup-warning':'complete',message:warning?'成片完成，临时分段清理待处理':'导出完成',output:lastCompleted});return lastCompleted;
  }finally{active=null;d.setBusy(false,null);}
 }
 return {start:(e,p)=>execute(e,false,p),resume:e=>execute(e,true),cancel(e){d.authorize(e);if(!active)return{cancelled:false};active.controller.abort();if(active.jobRoot)d.coordinator.cancel(active.jobRoot);return{cancelled:true};},openFolder(e){d.authorize(e);if(!lastCompleted)throw Error('尚无本次会话完成的成片');d.showItem(lastCompleted);return true;},get busy(){return !!active;}};
}
module.exports={createController};
