'use strict';
(function(root){
 function createCharacterRowEditor(options){
  const doc=options.container.ownerDocument,win=doc.defaultView||root;let busy=false,binding=null;
  const panel=doc.createElement('fieldset'),legend=doc.createElement('legend'),help=doc.createElement('p'),target=doc.createElement('select'),status=doc.createElement('p');
  panel.id='character-row-editor';legend.textContent='角色显示行';help.textContent='手动安排时间轴显示行，不改变舞台叠放顺序。同一行的基础出场时间不能重叠，请先调整时间或保持独立行。';target.id='character-row-target';target.setAttribute('aria-label','目标角色所在显示行');status.id='character-row-status';status.setAttribute('role','status');panel.append(legend,help,target);options.container.append(panel);
  const buttons={};function button(key,label){const b=doc.createElement('button');b.id='character-row-'+key;b.type='button';b.textContent=label;b.addEventListener('click',()=>run(key));panel.append(b);buttons[key]=b;}
  button('move','安排到所选角色所在行');button('separate','独立一行');button('up','整行上移');button('down','整行下移');panel.append(status);
  const packet=()=>options.packet(),selected=()=>typeof options.characterId==='function'?options.characterId():options.characterId;
  function report(text){status.textContent=text;options.status?.(text);}
  function rows(p){const helper=win.CharacterRows||root.CharacterRows;if(helper?.effectiveCharacterRows)return helper.effectiveCharacterRows(p);const result=(p.scene.characterRows||[]).map(r=>({...r,characterIds:[...r.characterIds]})),used=new Set(result.flatMap(r=>r.characterIds));for(const c of p.scene.characters||[])if(!used.has(c.id))result.push({id:'implicit:'+c.id,name:p.characterDefinitions?.find(d=>d.id===c.definitionId)?.name||c.name||c.id,characterIds:[c.id]});return result;}
  function render(p=packet()){
   if(!p)return;const id=selected(),cs=p.project.scene.characters||[],source=cs.find(c=>c.id===id),switched=!binding||binding.documentId!==p.documentId||binding.characterId!==id,previous=switched?'':target.value;binding={documentId:p.documentId,revision:p.revision,characterId:id};
   const effective=rows(p.project),nodes=[],blank=doc.createElement('option');blank.value='';blank.textContent='选择目标角色所在行';nodes.push(blank);
   for(const c of cs){if(c.id===id)continue;const row=effective.find(r=>r.characterIds.includes(c.id)),o=doc.createElement('option');o.value=c.id;o.textContent=`${p.project.characterDefinitions?.find(d=>d.id===c.definitionId)?.name||c.name||'角色'} · ${c.id} — ${row?.name||row?.id||'独立行'}`;nodes.push(o);}target.replaceChildren(...nodes);target.value=cs.some(c=>c.id===previous&&c.id!==id)?previous:'';
   const enabled=[3,4].includes(p.project.schemaVersion)&&!!source,index=effective.findIndex(r=>r.characterIds.includes(id));target.disabled=busy||!enabled||cs.length<2;buttons.move.disabled=busy||!enabled||!target.value;buttons.separate.disabled=busy||!enabled;buttons.up.disabled=busy||!enabled||index<=0;buttons.down.disabled=busy||!enabled||index<0||index===effective.length-1;
   if(![3,4].includes(p.project.schemaVersion))status.textContent='请先在角色库启用共享角色模板，升级后再手动安排显示行。';else if(!source)status.textContent='请先选择角色实例。';else if(switched)status.textContent='仅调整时间轴显示行，不自动合并，也不改变舞台叠放顺序。';
  }
  target.addEventListener('change',()=>{buttons.move.disabled=busy||![3,4].includes(packet()?.project.schemaVersion)||!target.value||!packet()?.project.scene.characters.some(c=>c.id===selected());});
  async function run(kind){if(busy)return;const p=packet(),id=selected(),source=p?.project.scene.characters.find(c=>c.id===id);if(!source||![3,4].includes(p.project.schemaVersion))return;const targetId=kind==='move'?target.value:null;if(kind==='move'&&(!targetId||targetId===id||!p.project.scene.characters.some(c=>c.id===targetId)))return;const captured={documentId:p.documentId,revision:p.revision,characterId:id,targetId};busy=true;render();
   try{if(options.prepare&&!await options.prepare())return;const now=packet();if(!now||now.documentId!==captured.documentId||now.revision!==captured.revision||selected()!==captured.characterId||(kind==='move'&&target.value!==targetId)||!now.project.scene.characters.some(c=>c.id===id)||(targetId&&!now.project.scene.characters.some(c=>c.id===targetId)))throw Error('等待期间工程、角色选择或目标行已变化，请重新操作');const env={commandId:win.crypto.randomUUID(),documentId:captured.documentId,expectedRevision:captured.revision,characterId:id},api=win.replay;const result=await (kind==='up'||kind==='down'?api.shiftCharacterRow({...env,direction:kind==='up'?-1:1}):api.moveCharacterToRow({...env,targetCharacterId:targetId}));if(!result?.ok)throw Error(result?.error?.message||'显示行操作失败');if(packet()?.documentId!==captured.documentId)return;await options.refresh();if(packet()?.documentId!==captured.documentId)return;report(result.changed===false?'显示行未变化。':'已调整角色显示行；舞台叠放顺序不变，可撤销。');}catch(e){report('未提交：'+e.message);}finally{busy=false;render();}
  }
  render();return {render,get busy(){return busy;}};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={createCharacterRowEditor};else root.createCharacterRowEditor=createCharacterRowEditor;
})(typeof globalThis!=='undefined'?globalThis:this);
