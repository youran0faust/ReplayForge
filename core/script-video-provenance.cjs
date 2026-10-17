'use strict';
const {createHash}=require('node:crypto');
const sha=s=>createHash('sha256').update(s).digest('hex');
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const exact=(o,keys)=>plain(o)&&Reflect.ownKeys(o).length===keys.length&&Reflect.ownKeys(o).every(k=>typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(o,k),'value')&&Object.getOwnPropertyDescriptor(o,k).enumerable);
const videoId=id=>typeof id==='string'&&/^asset_[0-9a-f]{24}$/.test(id);
function managedVideoPath(id){if(!videoId(id))throw Error('Invalid video resource identity');return '视频/__replay_normalized_'+id+'.mp4';}
function managedVideoAudioPath(id){if(!videoId(id))throw Error('Invalid video owner identity');return '视频/__replay_audio_'+id+'.wav';}
function validateVideoNormalization(m,r){
 const errors=[],add=s=>errors.push('videoNormalization: '+s);if(!m||!Object.hasOwn(m,'videoNormalization'))return errors;const n=m.videoNormalization;
 if(!exact(n,['version','original','managedRelativePath','mime','width','height','fps','frameCount','normalizationVersion','audioResourceId']))return ['videoNormalization: invalid fields'];
 if(m.category!=='video'||!videoId(m.resourceId)||typeof m.relativePath!=='string'||!m.relativePath.startsWith('视频/')||m.relativePath.includes('\\')||!m.relativePath.toLowerCase().endsWith('.mp4')||m.resourceId!=='asset_'+sha(m.relativePath).slice(0,24))add('invalid logical identity');
 if(n.version!==1||n.normalizationVersion!==1||n.mime!=='video/mp4'||n.fps!==30||!['width','height','frameCount'].every(k=>Number.isSafeInteger(n[k])&&n[k]>0)||n.width>1920||n.width%2||n.height>1080||n.height%2||n.frameCount>1800)add('invalid normalized metadata');
 if(n.original!==null&&(!exact(n.original,['sha256','bytes','container'])||typeof n.original.sha256!=='string'||!/^[0-9a-f]{64}$/.test(n.original.sha256)||!Number.isSafeInteger(n.original.bytes)||n.original.bytes<1||n.original.bytes>256*1024*1024||n.original.container!=='mp4'))add('invalid original provenance');
 try{if(n.managedRelativePath!==managedVideoPath(m.resourceId))add('invalid managed path');}catch{add('invalid identity');}
 if(n.audioResourceId!==null&&n.audioResourceId!=='video-audio_'+sha(m.resourceId).slice(0,24))add('invalid derived audio identity');
 if(r&&(r.kind!=='video'||['mime','width','height','fps','frameCount','normalizationVersion'].some(k=>r[k]!==n[k])||(r.audioResourceId??null)!==n.audioResourceId))add('resource mismatch');return errors;
}
function validateVideoAudioNormalization(m,r,owner,ownerMapping){
 const errors=[],add=s=>errors.push('videoAudioNormalization: '+s);if(!m||!Object.hasOwn(m,'videoAudioNormalization'))return errors;const n=m.videoAudioNormalization;
 if(!exact(n,['version','ownerResourceId','managedRelativePath','mime','sampleRate','channels','bitsPerSample','durationSamples']))return ['videoAudioNormalization: invalid fields'];
 if(m.category!=='videoAudio'||!videoId(n.ownerResourceId)||m.resourceId!=='video-audio_'+sha(n.ownerResourceId).slice(0,24)||m.relativePath!=='video-audio_'+sha(n.ownerResourceId)+'.wav')add('invalid derived identity');
 if(n.version!==1||n.mime!=='audio/wav'||n.sampleRate!==48000||n.channels!==2||n.bitsPerSample!==16||!Number.isSafeInteger(n.durationSamples)||n.durationSamples<1600||n.durationSamples>1800*1600||n.durationSamples%1600!==0)add('invalid audio metadata');
 try{if(n.managedRelativePath!==managedVideoAudioPath(n.ownerResourceId))add('invalid managed path');}catch{add('invalid owner identity');}
 if(r&&(r.kind!=='audio'||['mime','sampleRate','channels','bitsPerSample','durationSamples'].some(k=>r[k]!==n[k])))add('resource mismatch');
 if(owner&&(owner.kind!=='video'||owner.id!==n.ownerResourceId||owner.audioResourceId!==m.resourceId||owner.frameCount*1600!==n.durationSamples))add('owner mismatch');
 if(ownerMapping&&(!ownerMapping.videoNormalization||validateVideoNormalization(ownerMapping,owner).length||ownerMapping.resourceId!==n.ownerResourceId||ownerMapping.videoNormalization.audioResourceId!==m.resourceId||ownerMapping.videoNormalization.frameCount*1600!==n.durationSamples))add('owner mapping mismatch');return errors;
}
module.exports={managedVideoPath,managedVideoAudioPath,validateVideoNormalization,validateVideoAudioNormalization};
