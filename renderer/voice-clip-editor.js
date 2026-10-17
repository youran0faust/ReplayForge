/* Voice-only inspector. Parent owns mounting, draft aggregation and the prepare gate. */
(function(root) {
  'use strict';
  function createVoiceClipEditor(options) {
    const doc = options.container?.ownerDocument || root.document;
    const fieldset = doc.createElement('fieldset'); fieldset.id = 'voice-clip-editor';
    const legend = doc.createElement('legend'); legend.textContent = '配音片段（样本精度）'; fieldset.append(legend);
    const make = (tag, id, label) => { const el = doc.createElement(tag); el.id = 'voice-clip-' + id; el.setAttribute('aria-label', label); return el; };
    const select = make('select','select','配音片段'), offset = make('input','offset','源偏移（样本，48000 样本/秒）'), duration = make('input','duration','片段长度（样本，48000 样本/秒）'), start = make('input','start','有效开始帧'), mode = make('select','binding','对白绑定模式');
    for (const el of [offset,duration,start]) { el.type='number'; el.step='1'; el.min=el===duration?'1':'0'; }
    for (const [value,text] of [['follow','跟随对白'],['independent','独立时间']]) {const o=doc.createElement('option');o.value=value;o.textContent=text;mode.append(o);}
    const status=make('p','status','配音片段状态');status.setAttribute('role','status');
    let packet=null, selection=null, draft=null, serial=0, busy=false, publishing=Promise.resolve();
    const button=(id,text,fn)=>{const el=make('button',id,text);el.type='button';el.textContent=text;el.onclick=()=>Promise.resolve().then(fn).catch(e=>{status.textContent='未提交：'+e.message;});return el;};
    const apply=button('apply','应用片段',()=>submit(false)),remove=button('delete','删除片段',()=>submit(true)),discard=button('discard','放弃修改',()=>{if(allowDiscard())render(options.packet());}),jump=button('jump','跳到片段',()=>{const e=current();if(e)options.seek?.(effective(e));});
    const label=(text,el)=>{const l=doc.createElement('label');l.textContent=text;l.append(el);return l;};
    fieldset.append(label('片段',select),label('源偏移（样本）',offset),label('长度（样本）',duration),label('有效开始帧',start),label('绑定',mode),apply,remove,discard,jump,status);
    options.container?.append(fieldset);
    function entries(p=packet) {return (p?.project?.scene?.dialogues||[]).flatMap(dialogue=>(dialogue.voiceClips!==undefined?dialogue.voiceClips:(dialogue.voice?[dialogue.voice]:[])).map(voice=>({dialogue,voice,dialogueId:dialogue.id,clipId:dialogue.voiceClips!==undefined?voice.id:null})));}
    const key=e=>JSON.stringify([e.dialogueId,e.clipId]);
    function current(){return entries().find(e=>key(e)===selection);}
    function effective(e){return e.voice.binding?.mode==='independent'?e.voice.startFrame:e.dialogue.startFrame+(e.voice.binding?.followOffsetFrames||0);}
    function stale(){return !!draft && (draft.documentId!==packet?.documentId||draft.revision!==packet?.revision||draft.selection!==selection);}
    function publish(){try{publishing=Promise.resolve(options.dirtyChanged?.());}catch(e){publishing=Promise.reject(e);}publishing.catch(e=>{status.textContent='配音草稿状态同步失败：'+e.message;});return publishing;}
    function controls(){const e=current();apply.disabled=busy||!e||stale()||e.clipId===null;remove.disabled=busy||!e||e.clipId===null||stale();discard.disabled=busy||!draft;select.disabled=busy;for(const el of [offset,duration,start,mode])el.disabled=busy||!e||e.clipId===null;jump.disabled=busy||!e;if(stale())status.textContent='配音草稿已过期，内容已保留；请放弃后重载。';}
    function mark(){if(busy||!current())return;if(!draft)draft={documentId:packet.documentId,revision:packet.revision,selection};Object.assign(draft,{offset:offset.value,duration:duration.value,start:start.value,mode:mode.value});serial++;publish();status.textContent='有未应用的配音片段修改；保存不会自动应用。';controls();}
    for(const el of [offset,duration,start])el.addEventListener('input',mark);mode.addEventListener('change',mark);
    function clear(){if(draft){draft=null;serial++;publish();}if(packet)render(options.packet());}
    function allowDiscard(){if(busy)return false;if(!draft)return true;if(!(options.confirm||root.confirm)('配音片段有未应用修改，确定放弃吗？'))return false;clear();return true;}
    function render(p){if(!p)return;const changedDocument=packet&&packet.documentId!==p.documentId;if(changedDocument){draft=null;selection=null;serial++;}packet=p;if(changedDocument)publish();const all=entries();if(!draft&&!all.some(e=>key(e)===selection))selection=all[0]?key(all[0]):null;select.replaceChildren(...all.map(e=>{const o=doc.createElement('option');o.value=key(e);o.textContent=e.dialogueId+' · '+(e.clipId||'旧配音（先在播放头分割）');return o;}));select.value=selection||'';const e=current();offset.value=draft?draft.offset:e?.voice.sourceOffsetSamples??0;duration.value=draft?draft.duration:e?.voice.durationSamples??'';start.value=draft?draft.start:e?effective(e):'';mode.value=draft?draft.mode:e?.voice.binding?.mode||'follow';if(!draft)status.textContent=e?.clipId===null?'旧配音保持原格式；首次分割后可编辑片段。':e?'48000 样本 = 1 秒；开始帧是按绑定计算后的有效位置。':'暂无配音片段。';controls();}
    function choose(dialogueId,clipId=null){if(busy||!entries(options.packet()).some(e=>e.dialogueId===dialogueId&&e.clipId===clipId)||!allowDiscard())return false;selection=key({dialogueId,clipId});serial++;render(options.packet());options.onSelect?.({dialogueId,clipId});options.show?.();fieldset.scrollIntoView?.({block:'nearest'});return true;}
    select.onchange=()=>{const next=select.value;const e=entries().find(e=>key(e)===next);if(!e||!choose(e.dialogueId,e.clipId))select.value=selection||'';};
    async function submit(deleting){
      const e=current();if(busy||!e||e.clipId===null)return;if(deleting&&draft)throw Error('请先应用或放弃配音草稿，再删除片段');if(stale())throw Error('配音草稿已过期，请放弃后重载');
      const token={commandId:root.crypto.randomUUID(),documentId:packet.documentId,expectedRevision:packet.revision,dialogueId:e.dialogueId,clipId:e.clipId},captured=serial;
      let patch;
      if(!deleting){const integer=(el,min)=>{const n=Number(el.value);if(!String(el.value).trim()||!Number.isSafeInteger(n)||n<min)throw Error('偏移、长度及开始帧必须是有效整数');return n;};const effectiveStart=integer(start,0);patch={sourceOffsetSamples:integer(offset,0),durationSamples:integer(duration,1),startFrame:effectiveStart,binding:{dialogueId:e.dialogueId,mode:mode.value,...(mode.value==='follow'?{followOffsetFrames:effectiveStart-e.dialogue.startFrame}:{})}};}
      busy=true;controls();
      try{
        if(!await options.prepare({preserveVoiceClips:true}))return;
        const p=options.packet();if(!p||p.documentId!==token.documentId||p.revision!==token.expectedRevision||selection!==key(e)||serial!==captured)throw Error('等待期间工程或配音表单变化');
        const settled=serial,replay=options.replay||root.replay;
        const result=await (deleting?replay.deleteVoiceClip(token):replay.editVoiceClip({...token,patch}));
        if(!result?.ok)throw Error(result?.error?.message||'配音操作失败');
        if(options.packet()?.documentId!==token.documentId)return;
        if(serial===settled)clear();await publishing;await options.refresh();status.textContent=deleting?'已删除；可撤销。':'已应用；可撤销。';
      }finally{busy=false;controls();}
    }
    return {element:fieldset,render,select:choose,clear,allowDiscard,get dirty(){return !!draft;},get serial(){return serial;},get publishing(){return publishing;},get busy(){return busy;}};
  }
  root.createVoiceClipEditor=createVoiceClipEditor;
  if(typeof module!=='undefined'&&module.exports)module.exports={createVoiceClipEditor};
})(typeof globalThis!=='undefined'?globalThis:window);
