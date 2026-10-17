'use strict';
(function(root){
 const EPSILON=1e-7;
 function collectTimelineSnapTargets({project,model,drag={},playhead}={}){
  const duration=project?.scene?.durationFrames,targets=[],seen=new Set();
  const add=(frame,label,owner)=>{if(!Number.isFinite(frame)||frame<0||!Number.isFinite(duration)||frame>duration||seen.has(frame))return;seen.add(frame);targets.push({frame,label,...(owner?{owner}: {})});};
  add(playhead,'播放头');add(0,'场景开始');add(duration,'场景结束');
  const dialogueDrag=['dialogues','dialogueGroups','pages'].includes(drag.kind)||drag.group;
  for(const track of model?.tracks||[])for(const item of track.items||[]){
   const same=track.kind===drag.kind&&item.id===drag.id;
   const ownedVoice=((track.kind==='audio'&&item.id===drag.id)||(track.kind==='voiceClips'&&item.dialogueId===drag.id))&&item.bindingMode!=='independent';
   const ownedDialogue=dialogueDrag&&((track.kind==='dialogues'&&item.id===drag.id)||ownedVoice);
   if(same||ownedDialogue)continue;
   const owner={kind:track.kind,id:item.id,...(item.dialogueId?{parentId:item.dialogueId}:{})},label=item.label||item.id;
   add(item.startFrame,label+' · 开始',owner);add(item.endFrame,label+' · 结束',owner);
   for(const child of item.children||[]){add(child.startFrame,(child.label||child.id)+' · 开始',{kind:'pages',id:child.id,parentId:item.id});add(child.endFrame,(child.label||child.id)+' · 结束',{kind:'pages',id:child.id,parentId:item.id});}
  }
  for(const c of project?.scene?.characters||[]){if(drag.kind==='characters'&&c.id===drag.id)continue;for(const event of c.expressionEvents||[]){if(drag.kind==='expressionEvents'&&drag.id===event.id&&drag.characterId===c.id)continue;add(event.frame,'表情事件 · '+event.id,{kind:'expressionEvents',id:event.id,parentId:c.id});}}
  for(const event of project?.scene?.backgroundEvents||[]){if(drag.kind==='backgroundEvents'&&drag.id===event.id)continue;add(event.frame,'背景事件 · '+event.id,{kind:'backgroundEvents',id:event.id});}
  return targets;
 }
 function edges(drag,result){
  if(drag.kind==='expressionEvents')return [{edge:'frame',frame:result.frame,origin:drag.startFrame}];
  if(drag.mode==='boundary'){const page=drag.pages?.find(p=>p.id===drag.pageId);return page?[{edge:'end',frame:result.endFrame,origin:page.endFrame}]:[];}
  const audio=['audioTracks','audio','voiceClips'].includes(drag.kind);
  const end=audio?result.startFrame+result.durationSamples/48000*drag.fps:result.endFrame;
  const originalEnd=audio?drag.startFrame+drag.durationSamples/48000*drag.fps:drag.endFrame;
  const startEdge={edge:'start',frame:result.startFrame,origin:drag.startFrame},endEdge={edge:'end',frame:end,origin:originalEnd};
  return drag.mode==='start'?[startEdge]:drag.mode==='end'?[endEdge]:drag.mode==='move'?[startEdge,endEdge]:[];
 }
 function snapTimelineDrag({drag,deltaFrames,targets=[],thresholdFrames,calculate}={}){
  if(typeof calculate!=='function')throw Error('Timeline snap requires a geometry calculator');
  const raw=calculate(deltaFrames),base={result:raw,snap:null};
  if(!Number.isFinite(thresholdFrames)||thresholdFrames<0)return base;
  const attempts=[];
  for(const edge of edges(drag,raw))for(const [index,target]of targets.entries()){
   const frame=typeof target==='number'?target:target?.frame;
   if(!Number.isFinite(frame)||!Number.isFinite(edge.frame)||!Number.isFinite(edge.origin))continue;
   const distance=Math.abs(frame-edge.frame);if(distance>thresholdFrames+EPSILON)continue;
   attempts.push({edge:edge.edge,frame,label:typeof target==='number'?String(frame):target.label,index,distance,delta:frame-edge.origin});
  }
  attempts.sort((a,b)=>a.distance-b.distance||a.index-b.index||(a.edge==='start'?-1:1));
  for(const candidate of attempts){let result;try{result=calculate(candidate.delta);}catch(_){continue;}
   const actual=edges(drag,result).find(e=>e.edge===candidate.edge)?.frame;
   if(Number.isFinite(actual)&&Math.abs(actual-candidate.frame)<=EPSILON)return {result,snap:{frame:candidate.frame,label:candidate.label,edge:candidate.edge}};
  }
  return base;
 }
 const api={collectTimelineSnapTargets,snapTimelineDrag};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else Object.assign(root,api);
})(typeof globalThis!=='undefined'?globalThis:this);
