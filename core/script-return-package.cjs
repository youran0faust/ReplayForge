'use strict';
// Return maps are inert review/identity data, never an alternative project loader.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {readUtf8}=require('./script-asset-catalog.cjs');
const {parseScript}=require('./script-parser.cjs');
const {physicalMappingPath,validateAudioNormalization}=require('./script-audio-provenance.cjs');
const vp=require('./script-video-provenance.cjs');
const LIMITS={video:256*1024*1024,map:32*1024*1024,text:4*1024*1024,config:1024*1024,image:32*1024*1024,audio:256*1024*1024,total:512*1024*1024,files:10000};
const folders={character:'角色',background:'背景',voice:'配音',music:'音乐',sfx:'音效',video:'视频',videoAudio:null};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const clone=x=>structuredClone(x),hash=x=>createHash('sha256').update(x).digest('hex');
function fail(code,message){throw Object.assign(new Error(message),{code,publicError:true});}
function inside(root,file){const r=path.relative(root,file);return r===''||(r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r));}
function ordinary(file,directory){
 const full=path.resolve(file),base=path.parse(full).root;let current=base;const chain=[base];
 for(const p of full.slice(base.length).split(path.sep).filter(Boolean)){current=path.join(current,p);chain.push(current);}
 for(let i=0;i<chain.length;i++){const s=fs.lstatSync(chain[i]);if(s.isSymbolicLink()||((i<chain.length-1||directory)?!s.isDirectory():!s.isFile()))fail('PATH_UNSAFE','路径必须为普通文件或目录，祖先链不能含链接。');}
 if(path.relative(fs.realpathSync(full),full)!=='')fail('PATH_UNSAFE','路径不能重定向。');return full;
}
function relative(value){
 if(typeof value!=='string'||!value||value.length>2048||/[\x00-\x1f<>:"|?*]/.test(value)||path.win32.isAbsolute(value)||path.posix.isAbsolute(value))fail('PATH_UNSAFE','素材路径必须为安全相对路径。');
 const parts=value.split(/[\\/]/);
 if(parts.length>13||parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail('PATH_UNSAFE','素材路径包含不安全片段。');return parts;
}
function sameVideoTopology(a,b){const key=list=>(list||[]).map(v=>({id:v.id,resourceId:v.resourceId})).sort((x,y)=>x.id.localeCompare(y.id));return JSON.stringify(key(a))===JSON.stringify(key(b));}
function resourceFile(root,r){const f=path.resolve(root,...relative(r.path));if(!inside(root,f))fail('PATH_UNSAFE','资源越出原工程。');return ordinary(f,false);}
function mediaFor(project,source){
 if(!Array.isArray(project.resources)||project.resources.length>LIMITS.files)fail('MEDIA_INVALID','资源列表无效或超过数量限制。');
 const ids=new Set(),paths=new Set();return project.resources.map(r=>{
  if(!plain(r)||typeof r.id!=='string'||ids.has(r.id))fail('MEDIA_INVALID','资源身份无效或重复。');ids.add(r.id);
  const matches=source.mediaMappings.filter(m=>m.resourceId===r.id);
  if(matches.length!==1)fail('RESOURCE_UNMAPPED','当前资源没有唯一原始语义路径，不能猜测新增素材名称。');
  const m=clone(matches[0]),parts=relative(m.relativePath),key=parts.join('/').toLowerCase();
  if(!Object.hasOwn(folders,m.category)||(m.category!=='videoAudio'&&(parts[0]!==folders[m.category]||parts.length<2))||m.relativePath!==parts.join('/')||paths.has(key)||!/^[a-f0-9]{64}$/.test(m.hash))fail('MEDIA_MAPPING_INVALID','素材原始分类、路径或哈希无效/冲突。');
  if(r.kind!==(['character','background'].includes(m.category)?'image':m.category==='video'?'video':'audio'))fail('MEDIA_MAPPING_INVALID','资源类别与原始映射不一致。');
  if(validateAudioNormalization(m,r).length||vp.validateVideoNormalization(m,r).length||vp.validateVideoAudioNormalization(m,r,project.resources.find(x=>x.id===m.videoAudioNormalization?.ownerResourceId),source.mediaMappings.find(x=>x.resourceId===m.videoAudioNormalization?.ownerResourceId)).length)fail('MEDIA_MAPPING_INVALID','音频规范化来源与资源不一致。');
   relative(r.path);const physical=physicalMappingPath(m).toLowerCase();if(m.audioNormalization&&source.mediaMappings.some(other=>other!==matches[0]&&other.relativePath.toLowerCase()===physical))fail('MEDIA_MAPPING_INVALID','托管音频路径与逻辑路径冲突。');paths.add(key);return m;
 });
}
function validateLosses(losses){
 let count=0,bytes=0;const ancestors=new Set();
 const visit=(v,depth)=>{
  if(++count>500000||depth>32)fail('RETURN_MAP_INVALID','损失数据超过深度或条目限制。');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v);if(bytes>16*1024*1024)fail('RETURN_MAP_INVALID','损失数据超过大小限制。');return;}
  if(typeof v==='number'&&Number.isFinite(v))return;
  if((!plain(v)&&!Array.isArray(v))||ancestors.has(v))fail('RETURN_MAP_INVALID','损失数据必须是有限JSON数据。');
  ancestors.add(v);for(const k of Reflect.ownKeys(v)){
   if(Array.isArray(v)&&k==='length')continue;
   const d=Object.getOwnPropertyDescriptor(v,k);
   if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)||!d.enumerable||!Object.hasOwn(d,'value'))fail('RETURN_MAP_INVALID','损失数据包含不安全字段。');
   visit(k,depth+1);visit(d.value,depth+1);
  }ancestors.delete(v);
 };
 visit(losses,0);
 if(!Array.isArray(losses)||losses.length>10000)fail('RETURN_MAP_INVALID','损失清单无效。');
 for(const l of losses)if(!plain(l)||Object.keys(l).some(k=>!['code','path','message','before','after','nodeId'].includes(k))||typeof l.code!=='string'||!/^[A-Z][A-Z0-9_]{0,99}$/.test(l.code)||typeof l.message!=='string'||!l.message.trim()||l.message.length>16384||typeof l.path!=='string'||l.path.length>2048||(l.nodeId!==undefined&&(typeof l.nodeId!=='string'||!l.nodeId||l.nodeId.length>2048)))fail('RETURN_MAP_INVALID','损失条目包含未知字段或无效值。');
}
async function prepareReturnPackageVerified({project,projectRoot,check=async()=>{},verifyManagedVideo,ffmpegPath=path.resolve(__dirname,'../../p0/tools/ffmpeg.exe'),ffprobePath=path.resolve(__dirname,'../../p0/tools/ffprobe.exe')}={}){
 project=clone(project);
 const old=project?.scriptSource;if(!old||require('./script-source-record.cjs').validateSourceRecord(old).length)fail('SOURCE_REQUIRED','需要有效的剧本来源记录。');
 const videos=(project.resources||[]).filter(r=>r.kind==='video');if(!videos.length)return prepareReturnPackage(project);
 if(videos.some(r=>!old.mediaMappings.some(m=>m.resourceId===r.id&&m.category==='video')))fail('RESOURCE_UNMAPPED','新视频缺少原始来源。');
 const oldClips=old.baselineProject.scene.videoClips||[],nowClips=project.scene.videoClips||[];if(!sameVideoTopology(oldClips,nowClips))fail('VIDEO_TOPOLOGY_CHANGED','视频片段拓扑或时序已改变，拒绝猜测回接。');
 if(typeof verifyManagedVideo!=='function')verifyManagedVideo=require('./managed-video-verify.cjs').verifyManagedVideo;
 const upgraded=clone(old),maps=upgraded.mediaMappings.map(m=>({...m}));
 for(const m of maps.filter(m=>m.category==='video')){
  const r=videos.find(x=>x.id===m.resourceId);if(!r)fail('MEDIA_MAPPING_INVALID','视频资源缺失。');
  const baseline=old.baselineProject.resources.find(x=>x.id===r.id);if(!baseline||['width','height','fps','frameCount','normalizationVersion','audioResourceId'].some(k=>r[k]!==baseline[k])||vp.validateVideoNormalization(m,r).length)fail('MEDIA_MAPPING_INVALID','视频元信息与来源不一致。');
  const expected={hash:m.hash,width:r.width,height:r.height,fps:30,frameCount:r.frameCount,normalizationVersion:1};
  const result=await verifyManagedVideo({sourceFile:resourceFile(projectRoot,r),expected,check,ffmpegPath,ffprobePath});
  if(!result||result.hash!==m.hash||result.width!==expected.width||result.height!==expected.height||result.fps!==30||result.frameCount!==expected.frameCount)fail('VIDEO_VERIFY_FAILED','视频来源验证失败。');
  m.videoNormalization={version:1,original:m.videoNormalization?.original??null,managedRelativePath:vp.managedVideoPath(m.resourceId),mime:'video/mp4',width:result.width,height:result.height,fps:30,frameCount:result.frameCount,normalizationVersion:1,audioResourceId:r.audioResourceId??null};
 }
 for(const m of maps.filter(m=>m.category==='videoAudio')){const r=(project.resources||[]).find(x=>x.id===m.resourceId),owner=(project.resources||[]).find(x=>x.kind==='video'&&x.audioResourceId===m.resourceId);if(!r||!owner||owner.kind!=='video')fail('MEDIA_MAPPING_INVALID','视频配套音频来源缺失。');const file=resourceFile(projectRoot,r),bytes=boundedRead(file,LIMITS.audio),info=require('./voice-import.cjs').parseVoiceWav(bytes);if(hash(bytes)!==m.hash||info.sampleRate!==48000||info.channels!==2||info.bitsPerSample!==16||info.durationSamples!==owner.frameCount*1600)fail('VIDEO_AUDIO_VERIFY_FAILED','视频配套音频WAV校验失败。');m.videoAudioNormalization={version:1,ownerResourceId:owner.id,managedRelativePath:vp.managedVideoAudioPath(owner.id),mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:info.durationSamples};}
  upgraded.version=3;upgraded.mediaMappings=maps;const errors=require('./script-source-record.cjs').validateSourceRecord(upgraded);if(errors.length)fail('SOURCE_REQUIRED','视频来源记录升级失败。');
 return prepareReturnPackage({...project,scriptSource:upgraded});
}
function validateMap(map){
 if(!plain(map)||Object.keys(map).length!==4||Object.keys(map).some(k=>!['format','version','source','losses'].includes(k))||map.format!=='replay-script-return'||![1,2,3].includes(map.version)||map.version!==map.source?.version)fail('RETURN_MAP_INVALID','回接映射格式、版本或字段不受支持。');
 const errors=require('./script-source-record.cjs').validateSourceRecord(map.source);
 if(!Array.isArray(errors)||errors.length)fail('RETURN_MAP_INVALID','回接来源记录无效。');
 validateLosses(map.losses);mediaFor(map.source.baselineProject,map.source);return map;
}
/** Pure preparation. Caller must display/confirm losses before invoking export. */
function prepareReturnPackage(project){
  if(project?.scriptSource?.version!==3&&[project,project?.scriptSource?.baselineProject].some(p=>p?.resources?.some(r=>r.kind==='video')||p?.scene?.videoClips?.length))fail('VIDEO_RETURN_UNSUPPORTED','VIDEO_RETURN_UNSUPPORTED：首批视频工程不支持回接包，请保留原工程；不会导出部分可回接工程。');
 const p=clone(project),old=p?.scriptSource;
 if(!old||require('./script-source-record.cjs').validateSourceRecord(old).length)fail('SOURCE_REQUIRED','需要有效的剧本来源记录。');
 const mediaMappings=mediaFor(p,old);
 if(old.version===3&&!sameVideoTopology(p.scene.videoClips,old.baselineProject.scene.videoClips))fail('VIDEO_TOPOLOGY_CHANGED','视频拓扑或时序已改变，拒绝猜测回接。');
 if(require('./model.cjs').validateProject(p).length)fail('PROJECT_INVALID','当前工程未通过模型校验。');
 const exported=require('./script-text-export.cjs').exportScriptText(p);
 const {text,nodeMappings}=exported,losses=clone(exported.losses);
 // The projection uses optional before/after:undefined for additions/deletions;
 // omit only these absent values, never coerce other invalid JSON data.
 if(Array.isArray(losses))for(const l of losses)for(const k of ['before','after'])if(l[k]===undefined)delete l[k];
 if(exported.ok===false||typeof text!=='string'||Buffer.byteLength(text)>LIMITS.text||!Array.isArray(nodeMappings))fail('TEXT_EXPORT_INVALID','导出剧本或节点映射无效。');
 const config=clone(old.config),renames=new Map();
 for(const before of old.baselineProject.characterDefinitions||[]){const after=p.characterDefinitions?.find(d=>d.id===before.id);if(after&&after.name!==before.name){if(renames.has(before.name)&&renames.get(before.name)!==after.name)fail('CONFIG_RENAME_INVALID','角色更名映射不唯一。');renames.set(before.name,after.name);}}
 const names=new Set();for(const c of config.characters){const originalName=c.name;c.name=renames.get(originalName)||originalName;if((c.name==='旁白'&&originalName!=='旁白')||names.has(c.name))fail('CONFIG_RENAME_INVALID','角色更名与其它角色或旁白冲突。');names.add(c.name);}
 const report=parseScript(text,config);
 if(report.diagnostics.some(d=>d.severity==='error'))fail('TEXT_EXPORT_INVALID','导出文本未通过解析。');
 for(const n of report.nodes){
  const expression=n.type==='dialogue'?n.expression:n.type==='command'?n.args?.表情:undefined;
  const name=n.type==='dialogue'?n.speaker:n.args?.角色;
  if(expression!=null&&!config.characters.find(c=>c.name===name)?.expressions?.includes(expression))fail('CONFIG_EXPRESSION_UNMAPPED','导出表情未登记在角色配置中；请保留完整工程，不交付此回接包。');
 }
 const sourceMap=Object.create(null);report.identities=[];report.bindings=[];const mapped=new Set();
 for(const m of nodeMappings){
  const n=report.nodes.find(n=>n.id===m.nodeId),previous=old.nodes.find(n=>n.nodeId===m.sourceNodeId);
  if(!n||!previous||mapped.has(n.id))fail('TEXT_EXPORT_INVALID','导出节点来源不唯一。');mapped.add(n.id);
  sourceMap[n.id]={line:n.line,objects:clone(previous.objects)};report.identities.push({nodeId:n.id,stableId:previous.stableId});
  if(n.type!=='dialogue')continue;
  const ds=previous.objects.filter(o=>o.type==='dialogue').map(o=>p.scene.dialogues.find(d=>d.id===o.id)).filter(Boolean);
  if(ds.length!==1)fail('TEXT_EXPORT_INVALID','对白来源对象缺失或不唯一。');
  const d=ds[0],clips=d.voiceClips||[];
  sourceMap[n.id].objects=sourceMap[n.id].objects.filter(o=>!['voiceClip','dialoguePage'].includes(o.type));
  for(const [type,list] of [['voiceClip',clips],['dialoguePage',d.pages||[]]])for(const child of list)sourceMap[n.id].objects.push({type,id:child.id});
  if(!Array.isArray(clips)||d.voice!==undefined)fail('VOICE_BINDING_INVALID','仅支持当前对白voiceClips。');
  const prior=old.bindings.find(b=>b.nodeId===previous.nodeId||b.stableId===previous.stableId);
  const b={nodeId:n.id,status:'unvoiced',resourceId:null,textBaseline:n.text};
  // A previously silent binding still carries a text-review decision. Export
  // must not accept edited words or clear an outstanding review implicitly.
  if(clips.length===0&&prior?.resourceId==null&&['unvoiced','reviewRequired'].includes(prior?.status)){
   b.status=prior.status;
   b.textBaseline=typeof prior.textBaseline==='string'?prior.textBaseline:previous.baseline.text;
  }
  if(clips.length===0&&prior?.resourceId!=null&&p.resources.some(r=>r.id===prior.resourceId)&&mediaMappings.some(m=>m.resourceId===prior.resourceId&&m.category==='voice')&&(p.scene.videoClips||[]).some(v=>v.startFrame<=d.startFrame&&v.endFrame>d.startFrame)){b.resourceId=prior.resourceId;b.status=prior.status;b.textBaseline=prior.textBaseline??previous.baseline.text;if(b.textBaseline!==n.text)b.status='reviewRequired';}
   if(clips.length>1)losses.push({code:'MULTIPLE_VOICE_CLIPS',path:'scene.dialogues.'+d.id+'.voiceClips',message:'多配音片段不能表示为单一剧本绑定；本回接包禁止交付。',nodeId:n.id});
  else if(clips.length===1){
   if(!mediaMappings.some(m=>m.resourceId===clips[0].resourceId&&m.category==='voice'))fail('VOICE_BINDING_INVALID','当前配音缺少原始配音映射。');
   b.resourceId=clips[0].resourceId;b.status=prior?.resourceId===b.resourceId&&prior.status!=='unvoiced'?prior.status:'manual';
   // Never bless edited words by replacing the old voice text baseline.
   b.textBaseline=prior?.resourceId===b.resourceId&&typeof prior.textBaseline==='string'?prior.textBaseline:n.text;
  }
  report.bindings.push(b);
 }
 if(report.nodes.some(n=>!mapped.has(n.id)))fail('TEXT_EXPORT_INVALID','导出节点缺少明确来源。');
 if(losses.some(l=>l.code==='MULTIPLE_VOICE_CLIPS')){validateLosses(losses);return {text,source:null,losses};}
 delete p.scriptSource;
 const source=require('./script-source-record.cjs').createSourceRecord({text,config,report,sourceMap,project:p,mediaMappings});
 validateMap({format:'replay-script-return',version:source.version,source,losses});return {text,source,losses};
}
function readReturnMap(mapFile){
 ordinary(mapFile,false);const {text}=readUtf8(mapFile,{extensions:['.json'],maxBytes:LIMITS.map});ordinary(mapFile,false);let value;
 try{value=JSON.parse(text);}catch{fail('RETURN_MAP_INVALID','回接映射不是有效JSON。');}
 // No path from this document is followed. baselineProject is inert.
 return validateMap(value);
}
function boundedRead(file,maxBytes){
 ordinary(file,false);const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>maxBytes)fail('MEDIA_TOO_LARGE','媒体大小超过限制。');const bytes=Buffer.alloc(st.size);let pos=0;while(pos<bytes.length){const n=fs.readSync(fd,bytes,pos,bytes.length-pos,pos);if(!n)fail('MEDIA_CHANGED','媒体读取期间发生变化。');pos+=n;}if(fs.fstatSync(fd).size!==st.size)fail('MEDIA_CHANGED','媒体读取期间发生变化。');return bytes;}finally{fs.closeSync(fd);}
}
async function exportReturnPackage({project,projectRoot,outputParent,check=async()=>{},verifyManagedVideo,ffmpegPath,ffprobePath}={}){
 let staging,identity;
 const checkpoint=async()=>{try{await check();}catch{fail('RETURN_CANCELLED','回接包导出已取消或工程已变化。');}};
 const owned=()=>{ordinary(staging,true);const s=fs.lstatSync(staging);if(s.dev!==identity.dev||s.ino!==identity.ino)fail('PATH_UNSAFE','暂存目录身份发生变化。');};
 try{
  // Capture before the first asynchronous boundary; check is the UI revision guard.
  const p=clone(project),prepared=await prepareReturnPackageVerified({project:p,projectRoot,check:checkpoint,verifyManagedVideo,ffmpegPath,ffprobePath});
  if(prepared.losses.some(l=>l.code==='MULTIPLE_VOICE_CLIPS'))fail('MULTIPLE_VOICE_CLIPS','多配音片段不能交付可回接包。');
  await checkpoint();const original=ordinary(projectRoot,true),parent=ordinary(outputParent,true);
  if(inside(original,parent)||inside(parent,original))fail('OUTPUT_UNSAFE','输出父目录与原工程不能互相包含。');
  const files=new Map([['script.txt',Buffer.from(prepared.text)],['script.replay-map.json',Buffer.from(JSON.stringify({format:'replay-script-return',version:prepared.source.version,source:prepared.source,losses:prepared.losses},null,2))],['config.json',Buffer.from(JSON.stringify(prepared.source.config,null,2))]]);
  if(files.get('script.replay-map.json').length>LIMITS.map||files.get('config.json').length>LIMITS.config)fail('RETURN_TOO_LARGE','回接记录或配置超过大小限制。');
  let total=0;const originals=[];
  for(const m of prepared.source.mediaMappings){
   await checkpoint();ordinary(original,true);const r=p.resources.find(r=>r.id===m.resourceId),f=resourceFile(original,r);
   const bytes=boundedRead(f,Math.min(LIMITS[r.kind],LIMITS.total-total));total+=bytes.length;
   if(hash(bytes)!==m.hash)fail('MEDIA_HASH_MISMATCH','当前媒体内容与原始映射哈希不同，不能静默更新。');
   if(m.audioNormalization||m.videoAudioNormalization){let info;try{info=require('./voice-import.cjs').parseVoiceWav(bytes);}catch{fail('MEDIA_INVALID','托管音频内容无效。');}const n=m.audioNormalization||m.videoAudioNormalization;if(['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>info[k]!==n[k]))fail('MEDIA_INVALID','托管音频样本元信息不匹配。');}
   originals.push({r,hash:m.hash});files.set('素材/'+physicalMappingPath(m),bytes);
  }
  await checkpoint();ordinary(original,true);ordinary(parent,true);staging=fs.mkdtempSync(path.join(parent,'.replay-return-staging-'));identity=fs.lstatSync(staging);fs.mkdirSync(path.join(staging,'素材'));
  for(const [r,bytes] of files){
   await checkpoint();owned();let dir=staging;
   for(const part of r.split('/').slice(0,-1)){dir=path.join(dir,part);try{fs.mkdirSync(dir);}catch(e){if(e.code!=='EEXIST')throw e;}ordinary(dir,true);}
   fs.writeFileSync(path.join(staging,...r.split('/')),bytes,{flag:'wx'});
  }
  await checkpoint();ordinary(original,true);ordinary(parent,true);owned();
  // No asynchronous boundary between final validation and atomic publication.
  for(const {r,hash:expected} of originals)if(hash(boundedRead(resourceFile(original,r),LIMITS[r.kind]))!==expected)fail('MEDIA_CHANGED','原工程媒体在导出期间发生变化。');
  for(const [r,bytes] of files){const f=path.join(staging,...r.split('/'));if(!boundedRead(f,bytes.length).equals(bytes))fail('COPY_FAILED','回接包副本校验失败。');}
  let root;for(let i=0;i<32;i++){const candidate=path.join(parent,'replay-return-'+randomUUID());try{fs.lstatSync(candidate);}catch(e){if(e.code!=='ENOENT')throw e;root=candidate;break;}}
  if(!root)fail('OUTPUT_COLLISION','无法分配新回接包目录。');fs.renameSync(staging,root);staging=undefined;
  return {root,textFile:path.join(root,'script.txt'),mapFile:path.join(root,'script.replay-map.json'),losses:prepared.losses};
 }catch(e){
  if(staging)try{const s=fs.lstatSync(staging);if(!s.isSymbolicLink()&&s.isDirectory()&&s.dev===identity?.dev&&s.ino===identity?.ino){ordinary(path.dirname(staging),true);fs.rmSync(staging,{recursive:true,force:true});}}catch{/* Rollback only this invocation's staging. */}
  if(e.publicError)throw e;fail('RETURN_EXPORT_FAILED','回接包导出失败，未提交新目录。');
 }
}
module.exports={prepareReturnPackage,prepareReturnPackageVerified,exportReturnPackage,readReturnMap};
