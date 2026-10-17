'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const folders={voice:'配音',music:'音乐',sfx:'音效'},LIMIT=256*1024*1024;
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const exact=(o,keys)=>plain(o)&&Reflect.ownKeys(o).length===keys.length&&Reflect.ownKeys(o).every(k=>typeof k==='string'&&keys.includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(o,k),'value')&&Object.getOwnPropertyDescriptor(o,k).enumerable);
const sha=b=>createHash('sha256').update(b).digest('hex'),fold=p=>p.replaceAll('\\','/').toLowerCase();
function fail(){throw Object.assign(Error('音频来源、托管文件或映射冲突无效。'),{code:'AUDIO_PROVENANCE_INVALID',publicError:true});}
function managedAudioPath(category,resourceId){if(!Object.hasOwn(folders,category)||typeof resourceId!=='string'||! /^asset_[0-9a-f]{24}$/.test(resourceId))fail();return folders[category]+'/__replay_normalized_'+resourceId+'.wav';}
function validateAudioNormalization(mapping,resource){
 const errors=[];if(!mapping||!Object.hasOwn(mapping,'audioNormalization'))return errors;
 const n=mapping.audioNormalization,add=s=>errors.push('audioNormalization: '+s);
 if(!exact(n,['version','original','managedRelativePath','mime','sampleRate','channels','bitsPerSample','durationSamples','normalizationVersion'])){add('invalid fields');return errors;}
 if(n.version!==1||n.normalizationVersion!==1||n.mime!=='audio/wav'||n.sampleRate!==48000||![1,2].includes(n.channels)||n.bitsPerSample!==16||!Number.isSafeInteger(n.durationSamples)||n.durationSamples<1||n.durationSamples>600*48000||n.durationSamples*n.channels*2>LIMIT)add('invalid managed audio metadata');
 const o=n.original;if(!exact(o,['sha256','bytes','container','codec']))add('invalid original fields');
 else if(typeof o.sha256!=='string'||!/^[0-9a-f]{64}$/.test(o.sha256)||!Number.isSafeInteger(o.bytes)||o.bytes<1||o.bytes>LIMIT||!(o.container==='ogg'&&['vorbis','opus'].includes(o.codec)||o.container==='mp3'&&o.codec==='mp3'))add('invalid original provenance');
 try{if(n.managedRelativePath!==managedAudioPath(mapping.category,mapping.resourceId))add('noncanonical managed path');}catch{add('invalid category/resource identity');}
 if(typeof mapping.relativePath!=='string'||!['.ogg','.mp3'].includes(path.posix.extname(mapping.relativePath).toLowerCase())||o?.container!==path.posix.extname(mapping.relativePath||'').slice(1).toLowerCase())add('logical path/container mismatch');
 if(typeof mapping.relativePath==='string'&&(mapping.relativePath.includes('\\')||!mapping.relativePath.startsWith((folders[mapping.category]||'!')+'/')||mapping.resourceId!=='asset_'+sha(mapping.relativePath).slice(0,24)))add('logical resource identity/category mismatch');
 if(resource&&(resource.kind!=='audio'||['mime','sampleRate','channels','bitsPerSample','durationSamples'].some(k=>resource[k]!==n[k])))add('baseline resource mismatch');
 return errors;
}
function physicalMappingPath(mapping){const keys=['audioNormalization','videoNormalization','videoAudioNormalization'].filter(k=>mapping&&Object.hasOwn(mapping,k));const v=require('./script-video-provenance.cjs');if(keys.length>1||validateAudioNormalization(mapping).length||v.validateVideoNormalization(mapping).length||v.validateVideoAudioNormalization(mapping).length)fail();const p=(keys.length?mapping[keys[0]].managedRelativePath:mapping?.relativePath);if(typeof p!=='string'||!p||/[\x00-\x1f<>:"|?*]/.test(p)||/^[/\\]/.test(p)||p.split(/[/\\]/).some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))fail();return p;}
function ordinary(file,directory){const full=path.resolve(file),base=path.parse(full).root;let current=base;const all=[base];for(const p of full.slice(base.length).split(path.sep).filter(Boolean)){current=path.join(current,p);all.push(current);}for(let i=0;i<all.length;i++){const s=fs.lstatSync(all[i]);if(s.isSymbolicLink()||((i<all.length-1||directory)?!s.isDirectory():!s.isFile()))fail();}if(path.relative(fs.realpathSync(full),full)!=='')fail();return full;}
function rehydrateAudioCatalog({catalog,source,assetsRoot}){
 try{
  if(require('./script-source-record.cjs').validateSourceRecord(source).length||!Array.isArray(catalog?.assets))fail();
  const result=structuredClone(catalog),normalized=source.mediaMappings.filter(m=>m.audioNormalization);if(!normalized.length)return result;
  const root=ordinary(assetsRoot,true),consumed=new Set(),aliases=[];
  for(const m of normalized){
   const physical=physicalMappingPath(m),logicalKey=fold(m.relativePath),physicalKey=fold(physical);
   if(result.assets.some(a=>fold(a.relativePath)===logicalKey))fail();
   // Refuse even unscanned real files/directories at the original logical path.
   const parts=m.relativePath.replaceAll('\\','/').split('/');let dir=root;for(let i=0;i<parts.length;i++){ordinary(dir,true);const found=fs.readdirSync(dir).find(n=>n.toLowerCase()===parts[i].toLowerCase());if(!found)break;if(i===parts.length-1)fail();dir=path.join(dir,found);}
   const matches=result.assets.filter(a=>fold(a.relativePath)===physicalKey);if(matches.length!==1||matches[0].relativePath!==physical||matches[0].category!==m.category||matches[0].kind!=='audio'||consumed.has(matches[0].id))fail();
   const file=ordinary(path.resolve(root,...physical.split('/')),false),st=fs.lstatSync(file);if(st.size>LIMIT)fail();const bytes=fs.readFileSync(file);if(bytes.length>LIMIT||bytes.length!==st.size||sha(bytes)!==m.hash)fail();
   const info=require('./voice-import.cjs').parseVoiceWav(bytes),n=m.audioNormalization;if(['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>info[k]!==n[k]))fail();ordinary(file,false);
   consumed.add(matches[0].id);aliases.push({id:m.resourceId,kind:'audio',category:m.category,relativePath:m.relativePath,categoryPath:m.relativePath.split('/').slice(1).join('/'),size:bytes.length,mediaStatus:'unprobed',physicalRelativePath:physical,audioNormalization:structuredClone(n)});
  }
  result.assets=result.assets.filter(a=>!consumed.has(a.id));for(const a of aliases){if(result.assets.some(x=>x.id===a.id||fold(x.relativePath)===fold(a.relativePath)))fail();result.assets.push(a);}return result;
 }catch{fail();}
}
module.exports={managedAudioPath,validateAudioNormalization,physicalMappingPath,rehydrateAudioCatalog};
