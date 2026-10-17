'use strict';
// Read-only selection. Display holds never extend audio or persisted timing.
function dialogueCandidates(project,frame){
 const dialogues=project.scene.dialogues,active=dialogues.filter(d=>frame>=d.startFrame&&frame<d.endFrame);
 if(project.schemaVersion!==4||active.length)return active;
 const held=dialogues.filter(d=>frame>=d.endFrame&&frame<d.displayUntilFrame).sort((a,b)=>b.endFrame-a.endFrame||(a.id<b.id?-1:a.id>b.id?1:0));
 return held.length?[held[0]]:[];
}
module.exports={dialogueCandidates};
