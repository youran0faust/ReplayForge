/* Exact decoded PNG overlay. No HTMLVideoElement or wall-clock seeking. */
(function(root) {
  function createVideoRenderer(stage, {requestFrame, timeoutMs = 95000, onError} = {}) {
    const layer = document.createElement('div');
    layer.className = 'video-layer';
    Object.assign(layer.style, {position:'absolute',inset:'0',zIndex:'3',isolation:'isolate',backgroundColor:'#000000',pointerEvents:'none',display:'none'});
    layer.hidden = true; stage.appendChild(layer);
    let serial=0, epoch=0, projectIdentity=null, target=null, inflight=false, disposed=false, wake;
    let changed=new Promise(resolve=>{wake=resolve;});
    function notify(){wake();changed=new Promise(resolve=>{wake=resolve;});}
    function clear(){layer.replaceChildren();layer.hidden=true;layer.style.display='none';}
    function cancelTarget(){if(target){clearTimeout(target.timer);target.resolve();}target=null;serial++;notify();}
    function current(t){return !disposed && target===t && t.token===serial && t.epoch===epoch && t.status==='pending';}
    function fail(t,error){
      if(!current(t))return;
      t.status='failed';clearTimeout(t.timer);
      // A failed video is not a successful underlying scene frame.
      layer.replaceChildren();layer.hidden=false;layer.style.display='block';
      t.reject(error);
      if(typeof onError==='function') {
        // Defer even synchronous bridge failures until render/initialization ends.
        Promise.resolve().then(()=>{
          if(disposed || target!==t || t.token!==serial || t.epoch!==epoch)return;
          try{onError(error,{project:t.project,active:t.active,state:t.state});}catch(_){/* Observer cannot alter ready() rejection. */}
        });
      }
    }
    function validate(result,active){
      if(!result || result.frameIndex!==active.localFrame || result.width!==active.width || result.height!==active.height || typeof result.dataUrl!=='string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl))throw Error('Video frame response mismatch');
    }
    async function pump(){
      if(inflight || !target || target.started || target.status!=='pending' || disposed)return;
      const t=target;t.started=true;inflight=true;
      try{
        // Provider owns the file-stat-aware cache. Re-seeks must revalidate the
        // source there rather than reuse URLs keyed only by project/path here.
        if(typeof requestFrame!=='function')throw Error('Video frame bridge unavailable');
        const result=await requestFrame({resourceId:t.active.resourceId,localFrame:t.active.localFrame});
        validate(result,t.active);
        if(!current(t))return;
        const image=document.createElement('img');image.className='video-frame';image.alt='';
        Object.assign(image.style,{display:'block',width:'100%',height:'100%',objectFit:'contain'});
        image.src=result.dataUrl;
        // Keep the last good frame visible until this exact target node is decoded.
        await Promise.race([image.decode(),t.promise]);
        if(!current(t))return;
        if(image.naturalWidth!==t.active.width || image.naturalHeight!==t.active.height)throw Error('Video image dimensions mismatch');
        layer.replaceChildren(image);layer.hidden=false;layer.style.display='block';
        t.status='ready';clearTimeout(t.timer);t.resolve();
      }catch(error){fail(t,error);}
      finally{
        // Do not release this slot on logical cancellation or timeout: the bridge
        // request cannot be cancelled and must settle before another IPC is sent.
        inflight=false;pump();
      }
    }
    function renderActive(state, project, resourceUrls = {}) {
      if(disposed)throw Error('Video renderer disposed');
      const active=state?.activeVideo;
      if(projectIdentity!==project){projectIdentity=project;epoch++;cancelTarget();clear();}
      if(!active){epoch++;cancelTarget();clear();return;}
      const resource=project.resources?.find(r=>r.id===active.resourceId);
      // Clip identity/placement is not part of the decoded source-frame identity.
      const key=JSON.stringify([active.resourceId,active.localFrame,active.width,active.height,resource,resourceUrls[active.resourceId]]);
      if(target?.key===key && target.status!=='failed'){target.state=state;return;}
      cancelTarget();
      const t={token:serial,epoch,key,project,state,active:{...active},status:'pending'};
      t.promise=new Promise((resolve,reject)=>{t.resolve=resolve;t.reject=reject;});
      t.promise.catch(()=>{});target=t;
      t.timer=setTimeout(()=>fail(t,Error('Video image readiness timeout')),timeoutMs);
      notify();pump();
    }
    async function ready(){
      for(;;){const t=target;if(!t)return;try{await Promise.race([t.promise,changed]);}catch(error){if(t===target)throw error;}if(t===target)return;}
    }
    function dispose(){disposed=true;epoch++;cancelTarget();clear();layer.remove();}
    return {renderActive,ready,dispose,layer};
  }
  const api={createVideoRenderer};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.VideoRenderer=api;
})(globalThis);
