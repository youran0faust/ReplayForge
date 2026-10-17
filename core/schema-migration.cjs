'use strict';
// Pure deterministic migration; never called implicitly on open/save.
function upgradeProject(project) {
 if (![1,2,3].includes(project?.schemaVersion)) throw Error('Unsupported schemaVersion');
 const next=JSON.parse(JSON.stringify(project));
 if([2,3].includes(next.schemaVersion))return next;
 const ids=new Set();
 for(const d of next.scene.dialogues||[]){
  if(d.voiceClips!==undefined)throw Error('schema1 cannot contain voiceClips');
  d.voiceClips=[];
  if(d.voice!==undefined){const v=d.voice;let id='voice_'+d.id,n=1;while(ids.has(id))id='voice_'+d.id+'_'+n++;ids.add(id);
   d.voiceClips.push({...v,id,sampleRate:v.sampleRate??48000,sourceOffsetSamples:v.sourceOffsetSamples??0,binding:v.binding||{dialogueId:d.id,mode:'follow',followOffsetFrames:0}});delete d.voice;}
 }
 next.schemaVersion=2;return next;
}
function upgradeCharacters(project){
 const {legacyFields,definitionFields,instanceFields}=require('./character-definitions.cjs');
 const next=upgradeProject(project);if(next.schemaVersion===3)return next;
 if(Object.hasOwn(next,'characterDefinitions'))throw Error('Legacy characterDefinitions cannot be migrated implicitly');
 next.characterDefinitions=[];const ids=new Set();
 next.scene.characters=next.scene.characters.map(c=>{
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!legacyFields.includes(k)))throw Error('Unknown legacy character fields; explicit migration is required to avoid data loss');
  let definitionId='def_'+c.id,n=1;while(ids.has(definitionId))definitionId='def_'+c.id+'_'+n++;ids.add(definitionId);
  const d={id:definitionId};for(const k of definitionFields)if(k!=='id'&&Object.hasOwn(c,k))d[k]=c[k];next.characterDefinitions.push(d);
  const instance={id:c.id,definitionId};for(const k of instanceFields)if(k!=='id'&&k!=='definitionId'&&Object.hasOwn(c,k))instance[k]=c[k];return instance;
 });next.schemaVersion=3;return next;
}
// Explicit schema3 -> schema4 only: do not reinterpret older formats or silently
// accept definition IDs where schema3 requires an instance speaker reference.
function upgradeCharacters4(project) {
 if (project?.schemaVersion !== 3) throw Error('upgradeCharacters4 requires schema3');
 const next = JSON.parse(JSON.stringify(project));
 if (!Array.isArray(next.characterDefinitions) || !Array.isArray(next.scene?.characters) || !Array.isArray(next.scene?.dialogues)) throw Error('Invalid schema3 character library or scene');
 const validId = id => typeof id === 'string' && !!id.trim() && id !== 'narrator';
 const definitions = new Set(), instances = new Map();
 for (const d of next.characterDefinitions) {
  if (!d || !validId(d.id) || definitions.has(d.id)) throw Error('Invalid or duplicate character definition id');
  definitions.add(d.id);
 }
 for (const c of next.scene.characters) {
  if (!c || !validId(c.id) || instances.has(c.id)) throw Error('Invalid or duplicate character instance id');
  if (!definitions.has(c.definitionId)) throw Error('Character instance definition missing');
  instances.set(c.id, c.definitionId);
 }
 for (const d of next.scene.dialogues) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw Error('Invalid schema3 dialogue');
  if (d.displayUntilFrame === undefined) d.displayUntilFrame = d.endFrame;
  if (d.pages !== undefined && d.fullText === undefined) {
   if (!Array.isArray(d.pages) || !d.pages.length) throw Error('Invalid schema3 dialogue pages');
   const locales = new Set(d.pages.flatMap(page => Object.keys(page?.text || {})));
   if (!locales.size) throw Error('Dialogue page text missing');
   d.fullText = Object.fromEntries([...locales].map(locale => {
    if (d.pages.some(page => typeof page?.text?.[locale] !== 'string')) throw Error('Dialogue page locale missing: ' + locale);
    return [locale, d.pages.map(page => page.text[locale]).join('')];
   }));
  }
  if (d.speakerId === 'narrator') continue;
  if (!instances.has(d.speakerId)) throw Error('Dialogue speaker instance missing: ' + d.speakerId);
  d.speakerId = instances.get(d.speakerId);
 }
 next.schemaVersion = 4;
 return next;
}
module.exports={upgradeProject,upgradeCharacters,upgradeCharacters4};
