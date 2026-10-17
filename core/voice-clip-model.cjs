'use strict';
const {voiceErrors}=require('./voice-binding.cjs');
function clipTiming(d,c){return {startFrame:c.binding?.mode==='independent'?c.startFrame:d.startFrame+(c.binding?.followOffsetFrames??0),sourceOffsetSamples:c.sourceOffsetSamples,durationSamples:c.durationSamples};}
function voiceClipsErrors(d,p,ids=new Set()){
 const e=[];
 if(p.schemaVersion===1){if(d.voiceClips!==undefined)e.push('schema1 cannot contain voiceClips');return e;}
 if(d.voice!==undefined)e.push('schema2 cannot contain legacy voice');
 if(d.voiceClips===undefined)return e;
 if(!Array.isArray(d.voiceClips))return [...e,'voiceClips must be an array'];
 for(const c of d.voiceClips){
  if(!c||typeof c!=='object'||Array.isArray(c)){e.push('invalid voice clip');continue;}
  if(typeof c.id!=='string'||!c.id.trim()||ids.has(c.id))e.push('voice clip id invalid or duplicate');ids.add(c.id);
  if(Reflect.ownKeys(c).some(k=>!['id','resourceId','sampleRate','sourceOffsetSamples','durationSamples','sourceDurationSamples','binding','startFrame'].includes(k)))e.push('unknown voice clip field');
  if(c.sampleRate!==48000||!Number.isSafeInteger(c.sourceOffsetSamples)||!c.binding)e.push('voice clip requires explicit sample rate, offset and binding');
  e.push(...voiceErrors({...d,voiceClips:undefined,voice:c},p));
 }
 return e;
}
module.exports={clipTiming,voiceClipsErrors};
