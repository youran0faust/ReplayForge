(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.createDialogueReadingEditor=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 return function createDialogueReadingEditor({container,getPacket,currentDialogue,api,refresh=async()=>{},beforeApply=()=>{},commandId=()=>globalThis.crypto.randomUUID()}){
  const doc=container.ownerDocument,make=(tag,id,text,parent=container)=>{const e=doc.createElement(tag);if(id)e.id=id;if(text)e.textContent=text;parent.appendChild(e);return e;};
  const host=make('section','dialogue-reading-editor');make('h3',null,'本条对白阅读覆盖',host);
  make('p',null,'仅应用到当前对白的全部页，按当前语言文字计算。不改变对白或页总时长，不修改音频和全局设置。',host);
  const label=make('label',null,'文字出现速度（字符/秒）',host),speed=make('input','dialogue-reading-characters-per-second',null,label);speed.type='number';speed.min='1';speed.max='200';speed.step='any';
  const holdLabel=make('label',null,'页末停留目标（秒）',host),hold=make('input','dialogue-reading-hold-seconds',null,holdLabel);hold.type='number';hold.min='0';hold.max='60';hold.step='any';
  make('p',null,'输入是本次应用参数，不作为可重算的元数据保存；保存的是最终揭示帧数，可撤销。短页停留可能压缩，文字提前出现后可停留更久。',host);
  const applyButton=make('button','dialogue-reading-apply','应用到本条全部页',host);applyButton.type='button';
  const status=make('p','dialogue-reading-status','',host);status.setAttribute('role','status');const summary=make('p','dialogue-reading-summary','',host);
  let capture=null,pending=false;
  function identity(){const p=getPacket(),d=currentDialogue();if(!p?.project||!d||!p.project.scene?.dialogues?.some(row=>row.id===d.id)||!Number.isSafeInteger(p.documentId)||!Number.isSafeInteger(p.revision))return null;return{documentId:p.documentId,expectedRevision:p.revision,dialogueId:d.id,locale:p.project.locale};}
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function reset(){speed.value='30';hold.value='0.8';}
  function controls(){speed.disabled=hold.disabled=applyButton.disabled=pending||!capture;}
  function render(){const next=identity();if(!equal(next,capture)){const had=!!capture;capture=next;reset();status.textContent=had?'选择、语言或工程版本已变化；应用参数已重置，请确认后再应用。':next?'参数仅用于本次应用。':'请先选择一条对白。';}const p=getPacket(),d=capture?currentDialogue():null;summary.textContent=d?`${d.id} · ${p.project.locale}\n`+(d.pages?.length?d.pages:[d]).map((page,i)=>{const fps=p.project.design?.fps||30,duration=page.endFrame-page.startFrame,reveal=page.revealFrames??d.revealFrames??1;return`第${i+1}页：揭示 ${(reveal/fps).toFixed(2)} 秒；完成后停留 ${(Math.max(0,duration-reveal)/fps).toFixed(2)} 秒`;}).join('\n'):'';controls();return capture;}
  async function apply(){if(pending)return;const now=identity();if(!equal(now,capture)){render();status.textContent='上下文已变化，参数已重置；请重新确认后应用。';return;}if(!capture)return;const rawSpeed=speed.value.trim(),rawHold=hold.value.trim(),charactersPerSecond=Number(rawSpeed),holdSeconds=Number(rawHold);if(!rawSpeed||!Number.isFinite(charactersPerSecond)||charactersPerSecond<1||charactersPerSecond>200||!rawHold||!Number.isFinite(holdSeconds)||holdSeconds<0||holdSeconds>60){status.textContent='文字速度须为1～200，停留秒数须为0～60。';return;}
   const target={...capture};pending=true;controls();status.textContent='正在应用…';try{await beforeApply();if(!equal(identity(),target))throw Error('应用前上下文已变化，请重新确认。');const result=await api.applyDialogueReading({commandId:commandId(),documentId:target.documentId,expectedRevision:target.expectedRevision,dialogueId:target.dialogueId,charactersPerSecond,holdSeconds});if(!result?.ok)throw Error(result?.error?.message||result?.error?.code||'应用失败');await refresh();render();const live=identity();if(live&&live.documentId===target.documentId&&live.dialogueId===target.dialogueId&&live.locale===target.locale&&live.expectedRevision===(Number.isSafeInteger(result.revision)?result.revision:target.expectedRevision+1))status.textContent='已应用到本条全部页，可撤销；总时长、音频和全局设置未改变。';}catch(e){if(equal(identity(),target))status.textContent='未应用：'+e.message;else{render();status.textContent='上下文已变化，请重新确认；'+e.message;}}finally{pending=false;controls();}}
  applyButton.addEventListener('click',apply);reset();render();return{render,apply,host,controls:{speed,hold,apply:applyButton},status,summary,get pending(){return pending;}};
 };
});
