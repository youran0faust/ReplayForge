'use strict';
(function(global){
function createCharacterClipEditor(options){
 const root=options.root,doc=root.ownerDocument,win=doc.defaultView||global,api=options.api||win.replay;let clipboard=null,busy=false,menu=null;
 const current=()=>options.packet(),character=(p,id)=>p?.project?.scene?.characters?.find(c=>c.id===id),selected=()=>{const s=options.selection();return s?.kind==='characters'?character(current(),s.id):null;};
 const input=e=>!!e.target?.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'),status=s=>options.status?.(s),fresh=(p)=>current()?.documentId===p.documentId&&current()?.revision===p.revision;
 const buttons={};function button(parent,id,label,action){const b=doc.createElement('button');b.type='button';b.id=id;b.textContent=label;b.addEventListener('click',()=>{void run(action);});parent.append(b);return b;}
 for(const [action,label]of [['copy','复制角色片段'],['paste','在播放头粘贴角色片段'],['delete','删除角色片段']])buttons[action]=button(options.toolbar,'timeline-character-'+action,label,action);
 function close(){menu?.remove();menu=null;}
 function render(){buttons.copy.disabled=buttons.delete.disabled=busy||!selected();buttons.paste.disabled=busy||!clipboard;}
 function invalidate(){close();render();}
 async function run(action){if(busy)return;close();const p=current(),c=selected();if(!p)return;
  if(action==='copy'){if(!c)return;clipboard={sourceCharacterId:c.id,documentId:p.documentId,revision:p.revision};status('已复制角色片段；粘贴到播放头位置，不使用系统剪贴板。');render();return;}
  if(action==='paste'&&!clipboard)return;if(action==='delete'&&!c)return;
  const captured={documentId:p.documentId,revision:p.revision},id=action==='paste'?clipboard.sourceCharacterId:c.id,atFrame=Number(options.frame());
  if(action==='paste'&&(clipboard.documentId!==p.documentId||clipboard.revision!==p.revision||!character(p,id))){status('角色剪贴板已过期，请重新复制。');return;}
  if(action==='delete'){if(p.project.schemaVersion===4){if(!win.confirm('仅删除此场景角色实例及关联透明度；保留共享模板、对白说话人和源素材，不会将对白转为旁白。可撤销，继续吗？'))return;}else{const count=p.project.scene.dialogues.filter(d=>d.speakerId===id).length;if(count&&!win.confirm(`删除此角色片段会将 ${count} 条关联对白转为旁白。继续吗？`))return;}}
  busy=true;render();try{if(options.prepare&&!await options.prepare())return;if(!fresh(captured))throw Error('等待期间工程版本已变化，请重新操作。');const env={commandId:win.crypto.randomUUID(),documentId:captured.documentId,expectedRevision:captured.revision};const result=await (action==='paste'?api.duplicateCharacterClip({...env,sourceCharacterId:id,atFrame}):api.deleteCharacterClip({...env,characterId:id}));if(!result?.ok)throw Error(result?.error?.message||'角色片段操作失败');if(current()?.documentId!==captured.documentId)return;await options.refresh();if(current()?.documentId!==captured.documentId)return;if(action==='paste')options.select(result.created.characterId);status(action==='paste'?'已在播放头粘贴独立角色片段，可撤销。':'已删除角色片段；角色模板和源素材保留，可撤销。');}catch(e){status('未提交：'+e.message);}finally{busy=false;render();}
 }
 root.tabIndex=0;
 root.addEventListener('pointerdown',e=>{if(!input(e))root.focus({preventScroll:true});});
 root.addEventListener('contextmenu',e=>{if(input(e)||busy)return;const node=e.target?.closest('[data-kind="characters"][data-id]');if(!node||!root.contains(node))return;e.preventDefault();close();if(options.select(node.dataset.id)===false)return;menu=doc.createElement('div');menu.id='timeline-character-menu';menu.setAttribute('role','menu');menu.style.cssText=`position:fixed;left:${Math.max(0,Math.min(e.clientX,win.innerWidth-250))}px;top:${Math.max(0,Math.min(e.clientY,win.innerHeight-130))}px;z-index:10000;display:flex;flex-direction:column;padding:6px;background:#202734;border:1px solid #77849a;color:white`;for(const [action,label]of [['copy','复制角色片段'],['paste','粘贴角色片段到播放头'],['delete','删除角色片段']]){const b=button(menu,'timeline-character-menu-'+action,label,action);b.disabled=action==='paste'?!clipboard:!selected();}doc.body.append(menu);render();});
 root.addEventListener('keydown',e=>{if(e.defaultPrevented||e.isComposing||e.repeat||input(e)||busy)return;const key=e.key?.toLowerCase();let action=null;if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&key==='c'&&selected())action='copy';if(e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&key==='v'&&clipboard)action='paste';if(!e.ctrlKey&&!e.altKey&&!e.shiftKey&&!e.metaKey&&e.key==='Delete'&&selected())action='delete';if(action){e.preventDefault();e.stopPropagation();void run(action);}});
 doc.addEventListener('pointerdown',e=>{if(menu&&!menu.contains(e.target))close();});doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&menu){e.preventDefault();close();}});win.addEventListener('blur',close);
 render();return {render,invalidate,get busy(){return busy;}};
}
if(typeof module!=='undefined'&&module.exports)module.exports={createCharacterClipEditor};else global.createCharacterClipEditor=createCharacterClipEditor;
})(typeof globalThis!=='undefined'?globalThis:this);
