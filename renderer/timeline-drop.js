'use strict';
function expressionDropFrame(clientX,rect,extent,duration){
 if(![clientX,rect?.left,rect?.width,extent,duration].every(Number.isFinite)||rect.width<=0||extent<=0||duration<=0)return null;
 const raw=(clientX-rect.left)/rect.width*extent;if(raw<0||raw>=duration)return null;return Math.min(duration-1,Math.round(raw));
}
// Intent and ghost only: all mutations go through the main-process command.
function createExpressionDrop(options){
 const root=options.root;let active=null,ghost=null,busy=false;
 const clear=()=>{const previous=active;active=null;ghost?.remove();ghost=null;if(previous){try{if(previous.element.hasPointerCapture(previous.pointerId))previous.element.releasePointerCapture(previous.pointerId);}catch(_){/* Element may have been removed by a document switch. */}}};
 function targetAt(x,y){const hit=document.elementFromPoint(x,y);let node=hit?.closest('[data-expression-drop-character]');if(!node&&hit?.closest('#timeline-playhead')&&root.contains(hit))node=Array.from(root.querySelectorAll('[data-expression-drop-character]')).find(lane=>{const r=lane.getBoundingClientRect();return x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;});if(!node||!root.contains(node))return null;const p=options.packet();if(!p)return null;const atFrame=expressionDropFrame(x,node.getBoundingClientRect(),Number(root.dataset.extent),p.project.scene.durationFrames);return atFrame===null?null:{node,characterId:node.dataset.expressionDropCharacter,atFrame};}
 function show(x,y){ghost?.remove();ghost=null;if(!active)return null;const target=targetAt(x,y);if(!target){options.status('请拖到对应角色的表情事件行；场景外或空白处不提交。');return null;}const p=options.packet(),instance=p?.project.scene.characters.find(c=>c.id===target.characterId);if([3,4].includes(p?.project.schemaVersion)?instance?.definitionId!==active.source.definitionId:target.characterId!==active.source.characterId){options.status('表情模板与目标角色实例不匹配。');return null;}ghost=document.createElement('span');ghost.className='expression-drop-ghost';ghost.style.cssText=`position:absolute;top:0;bottom:0;left:${target.atFrame/Number(root.dataset.extent)*100}%;width:2px;background:#ffd166;pointer-events:none;z-index:8`;target.node.appendChild(ghost);options.status(`松开：在第 ${target.atFrame} 帧创建表情事件`);return target;}
 async function commit(target,intent){if(!target||!intent||busy)return;busy=true;try{await options.commit({...intent,target:{characterId:target.characterId},atFrame:target.atFrame});}catch(e){options.status('未提交：'+e.message);}finally{busy=false;}}
 function begin(source,event){if(busy||event.button!==0||event.isPrimary===false)return;const p=options.packet();if(!p)return;clear();active={source:{...source},documentId:p.documentId,expectedRevision:p.revision,element:event.currentTarget,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};try{event.currentTarget.setPointerCapture(event.pointerId);}catch(_){clear();}}
 document.addEventListener('pointermove',e=>{if(!active||active.pointerId!==e.pointerId)return;if(Math.hypot(e.clientX-active.x,e.clientY-active.y)<4&&!active.moved)return;active.moved=true;e.preventDefault();show(e.clientX,e.clientY);});
 document.addEventListener('pointerup',e=>{if(!active||active.pointerId!==e.pointerId)return;const intent=active,target=active.moved?show(e.clientX,e.clientY):null;clear();if(intent.moved){options.suppressClick();void commit(target,intent);}});
 document.addEventListener('pointercancel',e=>{if(active?.pointerId===e.pointerId)clear();});document.addEventListener('lostpointercapture',e=>{if(active?.pointerId===e.pointerId)clear();});window.addEventListener('blur',clear);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active){e.preventDefault();clear();options.status('已取消拖入；工程未改变。');}});
 root.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='none';});
 root.addEventListener('drop',e=>{e.preventDefault();clear();options.status('外部文件拖入将在受控导入批次接入；本批请拖动工程内表情卡。');});
 return {begin,cancel:clear,invalidate(p){if(active&&(p.documentId!==active.documentId||p.revision!==active.expectedRevision))clear();},get busy(){return busy;}};
}
if(typeof module!=='undefined')module.exports={expressionDropFrame};
