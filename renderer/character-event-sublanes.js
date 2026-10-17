'use strict';
(function(scope){
 function createCharacterEventSublanes(options={}){
  let documentId,known=false,project=null;const expanded=new Set(),decided=new Set(),rows=new Map();
  const selected=()=>typeof options.selectedCharacterId==='function'?options.selectedCharacterId():options.selectedCharacterId;
  function invalidate(packet=options.packet?.()){
   if(!packet)return;
   if(!known||documentId!==packet.documentId){known=true;documentId=packet.documentId;expanded.clear();decided.clear();rows.clear();}
   project=packet.project||project;
  }
  function idExists(id){return !!project?.scene?.characters?.some(c=>c.id===id);}
  function view(raw,p){if(![3,4].includes(p.schemaVersion))return raw;if(scope.CharacterDefinitions?.resolveCharacter)return scope.CharacterDefinitions.resolveCharacter(p,raw)||raw;const d=p.characterDefinitions?.find(d=>d.id===raw.definitionId);return d?{...d,...raw,name:d.name,expressions:d.expressions}:raw;}
  function paint(id){const row=rows.get(id);if(!row)return;const open=expanded.has(id);row.label.hidden=row.lane.hidden=!open;row.button.setAttribute('aria-expanded',String(open));row.button.textContent=(open?'▾ ':'▸ ')+row.title;}
  function change(id,open){if(!idExists(id))return false;decided.add(id);if(open)expanded.add(id);else expanded.delete(id);paint(id);options.onToggle?.(id,open);return true;}
  function expand(id){return change(id,true);}
  function appendTo(container,p,items,extent){
   invalidate();project=p;rows.clear();const ids=new Set((p.scene?.characters||[]).map(c=>c.id));for(const id of [...expanded])if(!ids.has(id))expanded.delete(id);for(const id of [...decided])if(!ids.has(id))decided.delete(id);
   const doc=container.ownerDocument,order=Array.isArray(items)?items.map(i=>i.id):[...ids],seen=new Set();
   for(const id of order){if(seen.has(id))continue;seen.add(id);const raw=p.scene.characters.find(c=>c.id===id);if(!raw)continue;const c=view(raw,p),events=c.expressionEvents||[];
    if(!decided.has(id)&&selected()===id){expanded.add(id);decided.add(id);}
    const header=doc.createElement('div');header.className='timeline-label character-event-subrow-header';header.dataset.characterEventHeader=id;
    const button=doc.createElement('button');button.type='button';button.dataset.characterEventToggle=id;button.title='展开或折叠此实例的表情事件；不修改工程';header.append(button);
    const label=doc.createElement('div');label.className='timeline-label character-event-subrow-label';label.textContent='↳ 表情';label.title=`${c.name||id} · ${id} · 表情事件`;
    const lane=doc.createElement('div');lane.className='timeline-lane expression-drop-lane character-event-subrow';lane.dataset.expressionDropCharacter=id;lane.dataset.characterInstanceTarget=id;lane.style.height='24px';lane.setAttribute('aria-label',`${c.name||id} · ${id} 表情事件落点`);
    for(const e of events){const marker=doc.createElement('button');marker.type='button';marker.className='timeline-expression-marker';marker.dataset.kind='expressionEvents';marker.dataset.id=e.id;marker.dataset.characterId=id;marker.dataset.startFrame=e.frame;marker.style.left=`${Number.isFinite(extent)&&extent>0?e.frame/extent*100:0}%`;marker.title=`${e.frame}帧 · ${c.expressions?.find(x=>x.id===e.expressionId)?.name||'基础立绘'}`;marker.setAttribute('aria-label',marker.title);lane.append(marker);}
    const title=`${c.name||id} · 表情 ${events.length}`;button.title=`${c.name||id} · ${id}：展开或折叠表情事件，不修改工程`;rows.set(id,{header,button,label,lane,title});
    button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();change(id,!expanded.has(id));});
    container.append(header,label,lane);paint(id);
   }
   return [...rows.keys()];
  }
  return {appendTo,invalidate,expand,isExpanded:id=>expanded.has(id),idExists};
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={createCharacterEventSublanes};else scope.createCharacterEventSublanes=createCharacterEventSublanes;
})(typeof globalThis!=='undefined'?globalThis:this);
