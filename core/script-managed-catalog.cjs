'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {physicalMappingPath,rehydrateAudioCatalog}=require('./script-audio-provenance.cjs');
const LIMIT=256*1024*1024,sha=b=>createHash('sha256').update(b).digest('hex'),fold=p=>p.replaceAll('\\','/').toLowerCase();
function fail(){throw Object.assign(Error('托管视频素材、派生声音或来源映射无效。'),{code:'MANAGED_MEDIA_INVALID',publicError:true});}
function ordinary(file,directory=false){const full=path.resolve(file),root=path.parse(full).root;let cur=root;const all=[root];for(const p of full.slice(root.length).split(path.sep).filter(Boolean)){cur=path.join(cur,p);all.push(cur);}for(let i=0;i<all.length;i++){const s=fs.lstatSync(all[i]);if(s.isSymbolicLink()||((i<all.length-1||directory)?!s.isDirectory():!s.isFile()))fail();}if(path.relative(fs.realpathSync(full),full)!=='')fail();return full;}
// No codec trust is inferred here. Storage must fully verify managed video before use.
function readManagedMapping({mapping,source,assetsRoot}){
 try{if(require('./script-source-record.cjs').validateSourceRecord(source).length)fail();const matches=source.mediaMappings.filter(m=>m.resourceId===mapping?.resourceId);if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(mapping))fail();const root=ordinary(assetsRoot,true),relative=physicalMappingPath(mapping),file=path.resolve(root,relative),rel=path.relative(root,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))fail();ordinary(file);const stat=fs.lstatSync(file);if(stat.size>LIMIT)fail();const bytes=fs.readFileSync(file);if(bytes.length!==stat.size||bytes.length>LIMIT||sha(bytes)!==mapping.hash)fail();const n=mapping.videoAudioNormalization||mapping.audioNormalization;if(n){const info=require('./voice-import.cjs').parseVoiceWav(bytes);if(['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>info[k]!==n[k]))fail();}ordinary(file);return {file,bytes,hash:mapping.hash};}catch{fail();}
}
function rehydrateManagedCatalog({catalog,source,assetsRoot}){
 const result=rehydrateAudioCatalog({catalog,source,assetsRoot});
 try{const videos=source.mediaMappings.filter(m=>m.category==='video');if(!videos.length)return result;if(source.version!==3||videos.some(m=>!m.videoNormalization))fail();const root=ordinary(assetsRoot,true),consumed=new Set(),aliases=[];
  for(const m of videos){const physical=physicalMappingPath(m),key=fold(physical),logical=fold(m.relativePath);if(result.assets.some(a=>fold(a.relativePath)===logical))fail();let dir=root;const parts=m.relativePath.replaceAll('\\','/').split('/');for(let i=0;i<parts.length;i++){ordinary(dir,true);const found=fs.readdirSync(dir).find(n=>n.toLowerCase()===parts[i].toLowerCase());if(!found)break;if(i===parts.length-1)fail();dir=path.join(dir,found);}
   const found=result.assets.filter(a=>fold(a.relativePath)===key);if(found.length!==1||found[0].relativePath!==physical||found[0].category!=='video'||found[0].kind!=='video'||consumed.has(found[0].id))fail();const checked=readManagedMapping({mapping:m,source,assetsRoot:root});consumed.add(found[0].id);aliases.push({id:m.resourceId,kind:'video',category:'video',relativePath:m.relativePath,categoryPath:m.relativePath.split('/').slice(1).join('/'),size:checked.bytes.length,mediaStatus:'unprobed'});
   const id=m.videoNormalization.audioResourceId;if(id!==null){const audio=source.mediaMappings.filter(a=>a.resourceId===id&&a.category==='videoAudio'&&a.videoAudioNormalization?.ownerResourceId===m.resourceId);if(audio.length!==1)fail();readManagedMapping({mapping:audio[0],source,assetsRoot:root});}
  }
  result.assets=result.assets.filter(a=>!consumed.has(a.id));for(const a of aliases){if(result.assets.some(x=>x.id===a.id||fold(x.relativePath)===fold(a.relativePath)))fail();result.assets.push(a);}return result;
 }catch{fail();}
}
module.exports={rehydrateManagedCatalog,readManagedMapping};
