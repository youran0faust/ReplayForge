'use strict';
(function(root){
 const definitionFields=['id','name','color','resourceId','portraitCanvas','expressions'];
 const instanceFields=['id','definitionId','x','y','width','height','visibleFrom','visibleTo','expressionEvents','visibilityEvents','positionKeyframes'];
 const legacyFields=[...new Set([...definitionFields,...instanceFields.filter(k=>k!=='definitionId')])];
 const copy=v=>JSON.parse(JSON.stringify(v));
 const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
 const id=v=>typeof v==='string'&&!!v.trim()&&v.length<=256;
 function getDefinition(project,definitionId){return (Array.isArray(project.characterDefinitions)?project.characterDefinitions:[]).find(d=>d?.id===definitionId);}
 function resolveCharacter(project,instanceOrId){const c=typeof instanceOrId==='string'?(project.scene?.characters||[]).find(c=>c.id===instanceOrId):instanceOrId;if(!c)return undefined;if(![3,4].includes(project.schemaVersion))return copy(c);const d=getDefinition(project,c.definitionId);if(!d)return copy(c);return {...copy(d),...copy(c),id:c.id};}
 // A read projection only. Never feed this back to session.apply or storage.
 function resolveProjectCharacters(project){const p=copy(project);if([3,4].includes(project.schemaVersion)&&p.scene&&Array.isArray(p.scene.characters))p.scene.characters=p.scene.characters.map(c=>resolveCharacter(project,c));return p;}
 function getSpeakerName(project,speakerId){if(speakerId==='narrator')return '旁白';return resolveCharacter(project,speakerId)?.name||speakerId||'';}
 function resolveDialogueSpeaker(project,dialogueOrId){const speakerId=typeof dialogueOrId==='string'?dialogueOrId:dialogueOrId?.speakerId;if(speakerId==='narrator')return {id:'narrator',name:'旁白'};if(project.schemaVersion===4){const d=getDefinition(project,speakerId);return d?copy(d):undefined;}return resolveCharacter(project,speakerId);}
 function getDialogueSpeakerName(project,dialogueOrId){const speakerId=typeof dialogueOrId==='string'?dialogueOrId:dialogueOrId?.speakerId;return resolveDialogueSpeaker(project,dialogueOrId)?.name||speakerId||'';}
 function characterDefinitionErrors(p){const errors=[];if(![3,4].includes(p.schemaVersion)){if(Object.hasOwn(p,'characterDefinitions'))errors.push('characterDefinitions requires schema3');return errors;}
  if(!Array.isArray(p.characterDefinitions)){errors.push('characterDefinitions must be an array');return errors;}
  const ids=new Set();for(const d of p.characterDefinitions){if(!plain(d)){errors.push('invalid character definition');continue;}if(Reflect.ownKeys(d).some(k=>typeof k!=='string'||!definitionFields.includes(k)))errors.push('unknown character definition fields');if(!id(d.id)||ids.has(d.id)||(p.schemaVersion===4&&d.id==='narrator'))errors.push('character definition id invalid or duplicate');ids.add(d.id);if(typeof d.name!=='string'||!d.name.trim())errors.push('character definition name invalid');if(typeof d.color!=='string'||!d.color.trim())errors.push('character definition color invalid');if(d.resourceId!==undefined&&(!id(d.resourceId)||!(p.resources||[]).some(r=>r.id===d.resourceId&&r.kind==='image')))errors.push('character definition base image missing');}
  for(const c of Array.isArray(p.scene?.characters)?p.scene.characters:[]){if(!plain(c)){errors.push('invalid character instance');continue;}if(Reflect.ownKeys(c).some(k=>typeof k!=='string'||!instanceFields.includes(k)))errors.push('unknown character instance fields; appearance belongs to definition');if(!id(c.definitionId)||!ids.has(c.definitionId))errors.push('character definition reference missing');}
  return errors;
 }
 const api={definitionFields,instanceFields,legacyFields,getDefinition,resolveCharacter,resolveProjectCharacters,projectForLegacyEvaluation:resolveProjectCharacters,getSpeakerName,resolveDialogueSpeaker,getDialogueSpeakerName,characterDefinitionErrors};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CharacterDefinitions=api;
})(typeof globalThis!=='undefined'?globalThis:this);
