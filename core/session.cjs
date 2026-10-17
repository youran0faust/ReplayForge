const fs=require('fs'),path=require('path');const {clone,validateProject,evaluate}=require('./model.cjs');const expressions=require('./expressions.cjs');
class ProjectSession{constructor(project){const errors=validateProject(project);if(errors.length)throw Error(errors.join('; '));this.project=clone(project);this.revision=0;this.savedRevision=0;this.history=[];this.future=[];this.draft=null}snapshot(){return clone(this.project)}
addCharacter(){
 if([3,4].includes(this.project.schemaVersion))throw Error('从角色库创建');
 const id=require('crypto').randomUUID();
 this.apply(p=>{
  const width=Math.min(240,p.design.width),height=Math.min(360,p.design.height);
  p.scene.characters.push({id,name:'新角色',x:Math.min(180,Math.max(0,p.design.width-width)),y:Math.min(100,Math.max(0,p.design.height-height)),width,height,color:'#d58b9c',visibleFrom:0,visibleTo:p.scene.durationFrames});
 },'add character');
 return id;
}
editCharacter(id,patch){
 if([3,4].includes(this.project.schemaVersion)&&patch&&['name','color'].some(key=>Object.hasOwn(patch,key)))throw Error('在角色模板页编辑，影响全部引用实例');
 const fields=['name','x','y','width','height','visibleFrom','visibleTo'];
 if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!fields.includes(key)))throw Error('角色属性无效');
 const current=this.project.scene.characters.find(c=>c.id===id);
 if(current&&Object.keys(patch).every(key=>patch[key]===current[key]))return;
 this.apply(p=>{
  const character=p.scene.characters.find(c=>c.id===id);
  if(!character)throw Error('角色不存在');
  require('./performance-character-edit.cjs').editCharacterOpacity(p,character,Object.hasOwn(patch,'visibleFrom')?patch.visibleFrom:character.visibleFrom,Object.hasOwn(patch,'visibleTo')?patch.visibleTo:character.visibleTo);
   for(const key of fields)if(Object.hasOwn(patch,key))character[key]=patch[key];
 },'edit character');
}
deleteCharacter(id){
 this.apply(p=>{
  const index=p.scene.characters.findIndex(c=>c.id===id);
  if(index<0)throw Error('角色不存在');
  if(p.scene.performance?.characterOpacity)p.scene.performance.characterOpacity=p.scene.performance.characterOpacity.filter(entry=>entry.characterId!==id);
   p.scene.characters.splice(index,1);
   if(p.scene.characterRows)p.scene.characterRows=p.scene.characterRows.map(row=>({...row,characterIds:row.characterIds.filter(member=>member!==id)})).filter(row=>row.characterIds.length);
  if(p.schemaVersion!==4)for(const dialogue of p.scene.dialogues)if(dialogue.speakerId===id)dialogue.speakerId='narrator';
 },'delete character');
}
setDialogueSpeaker(dialogueId,speakerId){
 this.apply(p=>{
  const dialogue=p.scene.dialogues.find(d=>d.id===dialogueId);
  if(!dialogue)throw Error('对白不存在');
  if(speakerId!=='narrator'&&!(p.schemaVersion===4?p.characterDefinitions:p.scene.characters).some(c=>c.id===speakerId))throw Error('说话角色不存在');
  dialogue.speakerId=speakerId;
 },'set dialogue speaker');
}
addDialogue(){const id='dlg_'+require('crypto').randomUUID();this.apply(p=>{const start=Math.max(0,...p.scene.dialogues.map(d=>d.endFrame));if(start>=p.scene.durationFrames)throw Error('场景末尾没有空余帧，请先调整对白时长');const end=Math.min(p.scene.durationFrames,start+90);const locales=new Set(['zh-CN','ja-JP','en-US',p.locale,...p.scene.dialogues.flatMap(d=>Object.keys(d.text))]);p.scene.dialogues.push({id,speakerId:(p.schemaVersion===4?p.characterDefinitions[0]?.id:p.scene.characters[0]?.id)||'narrator',...(p.schemaVersion===4?{displayUntilFrame:end}:{}),text:Object.fromEntries([...locales].map(l=>[l,l==='zh-CN'?'新对白':l==='ja-JP'?'新しい台詞':'New dialogue'])),startFrame:start,endFrame:end,revealFrames:Math.min(30,end-start)})},'add dialogue');return id}deleteDialogue(id){this.apply(p=>{const i=p.scene.dialogues.findIndex(d=>d.id===id);if(i<0)throw Error('对白不存在');p.scene.dialogues.splice(i,1)},'delete dialogue')}moveDialogue(id,direction){if(direction!==-1&&direction!==1)throw Error('移动方向无效');const i=this.project.scene.dialogues.findIndex(d=>d.id===id);if(i<0)throw Error('对白不存在');const j=i+direction;if(j<0||j>=this.project.scene.dialogues.length)return false;this.apply(p=>{[p.scene.dialogues[i],p.scene.dialogues[j]]=[p.scene.dialogues[j],p.scene.dialogues[i]]},'reorder dialogue');return true}editDialogue(id,patch){if(this.project.scene.dialogues.find(d=>d.id===id)?.pages)throw Error('分页对白请使用分页编辑器；父对白时间暂不支持修改');if(!patch||typeof patch.text!=='string'||!patch.text.trim())throw Error('对白文本不能为空');for(const key of ['startFrame','endFrame','revealFrames'])if(!Number.isSafeInteger(patch[key]))throw Error(key+' 必须为整数帧');if(patch.startFrame<0||patch.endFrame<=patch.startFrame||patch.endFrame>this.project.scene.durationFrames||patch.revealFrames<1||patch.revealFrames>patch.endFrame-patch.startFrame)throw Error('对白时间范围无效');this.apply(p=>{const d=p.scene.dialogues.find(x=>x.id===id);if(!d)throw Error('对白不存在');d.text[p.locale]=patch.text;if(p.schemaVersion===4){if(d.fullText)d.fullText[p.locale]=patch.text;/* Keep the absolute hold endpoint; extending the dialogue cannot leave it before end. */d.displayUntilFrame=Math.max(d.displayUntilFrame,patch.endFrame);}d.startFrame=patch.startFrame;d.endFrame=patch.endFrame;d.revealFrames=patch.revealFrames},'edit dialogue')}apply(mutator,label='edit'){const before=this.snapshot();const next=this.snapshot();mutator(next);const errors=validateProject(next);if(errors.length)throw Error(errors.join('; '));this.history.push({label,before});this.future=[];this.project=next;this.revision++}undo(){const h=this.history.pop();if(!h)return false;this.future.push({project:this.snapshot()});this.project=h.before;this.revision++;return true}redo(){const f=this.future.pop();if(!f)return false;this.history.push({label:'redo',before:this.snapshot()});this.project=f.project;this.revision++;return true}save(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({format:'replay-project',revision:this.revision,project:this.project},null,2),'utf8');this.savedRevision=this.revision}static open(file){const x=JSON.parse(fs.readFileSync(file,'utf8'));return new ProjectSession(x.project??x)}evaluate(frame){return evaluate(this.project,frame)}}
ProjectSession.prototype.setPortraitCanvas=function(c,p){return expressions.setPortraitCanvas(this,c,p)};
ProjectSession.prototype.addExpression=function(c,p){return expressions.addExpression(this,c,p)};ProjectSession.prototype.editExpression=function(c,e,p){return expressions.editExpression(this,c,e,p)};ProjectSession.prototype.deleteExpression=function(c,e){return expressions.deleteExpression(this,c,e)};ProjectSession.prototype.addExpressionEvent=function(c,p){return expressions.addExpressionEvent(this,c,p)};ProjectSession.prototype.editExpressionEvent=function(c,e,p){return expressions.editExpressionEvent(this,c,e,p)};ProjectSession.prototype.deleteExpressionEvent=function(c,e){return expressions.deleteExpressionEvent(this,c,e)};
const dialoguePages=require('./dialogue-pages.cjs');
for(const name of ['setDialoguePages','addDialoguePage','editDialoguePage','deleteDialoguePage'])ProjectSession.prototype[name]=function(...args){return dialoguePages[name](this,...args)};
module.exports={ProjectSession};
