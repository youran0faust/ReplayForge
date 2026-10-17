'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash, randomUUID} = require('node:crypto');
const {resolveAsset} = require('./script-asset-catalog.cjs');
const {parseImage} = require('./image-import.cjs');
const {parseVoiceWav} = require('./voice-import.cjs');
const {validateProject} = require('./model.cjs');
const {validatePaginationPlan} = require('./script-pagination-plan.cjs');
const LIMITS = {image:32*1024*1024, audio:256*1024*1024, video:256*1024*1024, total:512*1024*1024};
const safeErrors = new WeakSet();
function safeDiagnostics(items) {
  return (Array.isArray(items) ? items : []).map(d => ({code:/^[A-Z][A-Z0-9_]{0,79}$/.test(d?.code)?d.code:'BUILD_DIAGNOSTIC',severity:['warning','info'].includes(d?.severity||d?.level)?(d.severity||d.level):'error',message:'工程构建诊断，请检查剧本及配置。',...(Number.isSafeInteger(d?.line)&&d.line>0?{line:d.line}:{}),...(Number.isSafeInteger(d?.column)&&d.column>0?{column:d.column}:{})}));
}
function fail(code,message,diagnostics) {
  const e=Object.assign(new Error(message),{code,publicError:true});
  if(diagnostics){e.diagnostics=safeDiagnostics(diagnostics);const first=e.diagnostics.find(d=>d.severity==='error')||e.diagnostics[0];if(first)e.message+=(first.line?' 第'+first.line+'行':'')+' ['+first.code+']';}
  safeErrors.add(e);throw e;
}
function inside(root,file) {const r=path.relative(root,file);return r===''||(r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r));}
// Check the complete ancestor chain, including junctions above either root.
function ordinary(file,directory) {
  const full=path.resolve(file),base=path.parse(full).root;let current=base;
  const paths=[base];for(const part of full.slice(base.length).split(path.sep).filter(Boolean)){current=path.join(current,part);paths.push(current);}
  for(let i=0;i<paths.length;i++) {const s=fs.lstatSync(paths[i]);if(s.isSymbolicLink()||(i<paths.length-1||directory?!s.isDirectory():!s.isFile()))fail('PATH_UNSAFE','路径必须为普通文件或目录，不能包含链接。');}
  const real=fs.realpathSync(full);if(path.relative(real,full)!=='')fail('PATH_UNSAFE','路径不能通过链接重定向。');return real;
}
function assetFile(root,asset) {
  const r=asset.relativePath;
  if(typeof r!=='string'||!r||/[\0:]/.test(r)||path.win32.isAbsolute(r)||path.posix.isAbsolute(r)||r.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))fail('PATH_UNSAFE','素材路径必须为安全相对路径。');
  const file=path.resolve(root,r);if(!inside(root,file)||!inside(root,ordinary(file,false)))fail('PATH_UNSAFE','素材越出授权目录。');return file;
}
function collect(report,config,catalog) {
  const assets=catalog.assets,selected=new Map();
  const add=(category,reference,id)=>{
    if(!['character','background','music','sfx','voice','video'].includes(category))fail('MEDIA_UNSUPPORTED','本批不支持此媒体类别。');
    const match=resolveAsset(assets,category,reference);if(match.status!=='matched')fail('RESOURCE_UNRESOLVED','素材引用缺失、不唯一或无效。');
    const a=match.candidates[0];if(typeof a.id!=='string'||!a.id||assets.filter(x=>x.id===a.id).length!==1||(id!==undefined&&id!==a.id))fail('RESOURCE_UNRESOLVED','素材身份或类别不一致。');selected.set(a.id,a);
  };
  for(const r of report.references||report.refs||[]){if(r.status!=='matched')fail('RESOURCE_UNRESOLVED','素材引用尚未确认。');add(r.category,r.reference,r.resourceId);}
  for(const b of report.bindings||[]){if(b.status==='unvoiced'&&b.resourceId==null)continue;if(!['matched','manual'].includes(b.status))fail('RESOURCE_UNRESOLVED','配音绑定需要复核。');const found=assets.filter(a=>a.id===b.resourceId);if(found.length!==1)fail('RESOURCE_UNRESOLVED','配音身份不唯一。');add('voice',found[0].relativePath,b.resourceId);}
  const used=new Set((report.nodes||[]).filter(n=>n.type==='command'&&n.name==='出场').map(n=>n.args?.角色).filter(Boolean));
  for(const c of config.characters)if(used.has(c.name)){if(c.image!==undefined)add('character',c.image);for(const image of Object.values(c.expressionImages||{}))add('character',image);}
  return [...selected.values()];
}
// Canonical object ordering; arrays retain their semantic order.
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));return value;}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
/** Private mode argument cannot be supplied through snapshot/report or public options. */
async function preparePortableScript({snapshot,report,paginationPlan,assetsRoot,outputParent,decodeImage,normalizeVideo,verifyManagedVideo,videoTools,normalizeAudio,audioTools,expectedPreviewFingerprint,check=()=>{}}={},previewOnly=false) {
  let staging,identity;
  const checkpoint=async()=>{try{await check();}catch{fail('GENERATION_CANCELLED','生成已取消或输入已变化。');}};
  try {
    await checkpoint();
    if(!snapshot||typeof snapshot.text!=='string'||!Array.isArray(snapshot.config?.characters)||!Array.isArray(snapshot.catalog?.assets)||!report||report.ok===false||(report.diagnostics||[]).some(d=>(d.severity||d.level)==='error'))fail('PREFLIGHT_FAILED','请先解决预检错误。');
    if(snapshot.reimportSource?.mediaMappings?.some(m=>['video','videoAudio'].includes(m.category))&&snapshot.reimportSource.version!==3)fail('PRESERVATION_UNSUPPORTED','视频工程回接需要完整的第三版来源记录。');
    if(snapshot.reimportSource&&require('./script-source-record.cjs').validateSourceRecord(snapshot.reimportSource).length)fail('PRESERVATION_INVALID','回接来源记录无效。');
    const preservation=snapshot.reimportSource?require('./script-reimport-preservation.cjs').analyzePreservation({text:snapshot.text,config:snapshot.config,source:snapshot.reimportSource,report}):null;
    if(preservation){
      if(preservation.diagnostics.some(d=>d.severity==='error')||!Array.isArray(report.identities))fail('PRESERVATION_INVALID','回接来源或预检身份无效。',preservation.diagnostics);
      const trusted=require('./script-reimport-identity.cjs').reconcileNodes(snapshot.text,snapshot.reimportSource);
      const oldIds=new Set(snapshot.reimportSource.nodes.map(n=>n.stableId));
      if(trusted.identities.some(i=>oldIds.has(i.stableId)&&report.identities.find(r=>r.nodeId===i.nodeId)?.stableId!==i.stableId))fail('PRESERVATION_INVALID','回接身份与可信来源不一致。');
      if(report.preservation?.canPreserve!==undefined&&report.preservation.canPreserve!==preservation.canPreserve)fail('PRESERVATION_INVALID','回接保留状态已变化，请重新预检。');
    }
    const paginationConfig={...snapshot.config};if(preservation?.canPreserve)delete paginationConfig.dialoguePageMaxCharacters;
    try { paginationPlan=validatePaginationPlan(paginationPlan,report,snapshot.text,paginationConfig);
      if(preservation?.canPreserve&&!require('node:util').isDeepStrictEqual(paginationPlan.dialogues,preservation.preservedPages))throw Error('Preserved pagination mismatch');
    }
    catch(e) { fail(e.code==='PAGINATION_REQUIRED'?'PAGINATION_REQUIRED':'PAGINATION_INVALID',e.code==='PAGINATION_REQUIRED'?'生成需要完整分页计划。':'分页计划无效或已过期，请重新测量分页。'); }
    const {text,config,catalog}=JSON.parse(JSON.stringify(snapshot));report=JSON.parse(JSON.stringify(report));
    const source=ordinary(assetsRoot,true),sourceIdentity=fs.lstatSync(source),parent=previewOnly?null:ordinary(outputParent,true);
    if(parent&&(inside(source,parent)||inside(parent,source)))fail('OUTPUT_UNSAFE','输出目录与素材根目录不能互相包含。');
    const previousMapping=asset=>snapshot.reimportSource?.mediaMappings.find(m=>m.resourceId===asset.id);
    const inputFile=asset=>{const m=previousMapping(asset);if(m&&(m.category!==asset.category||m.relativePath!==asset.relativePath))fail('MEDIA_HASH_MISMATCH','回接媒体身份已变化。');return assetFile(source,m&&(m.audioNormalization||m.videoNormalization||m.videoAudioNormalization)?{relativePath:require('./script-audio-provenance.cjs').physicalMappingPath(m)}:asset);};
    const selected=collect(report,config,catalog),media=[],mediaMappings=[],copies=new Map(),inputHashes=new Map();
    if(snapshot.reimportSource?.version===3&&preservation?.canPreserve){for(const m of snapshot.reimportSource.mediaMappings.filter(m=>m.category!=='videoAudio')){if(!selected.some(a=>a.id===m.resourceId)){const a=catalog.assets.find(a=>a.id===m.resourceId);if(!a)fail('RESOURCE_UNRESOLVED','来源中的视频资源缺失。');selected.push(a);}}}
    let totalBytes=0;
    const dependencies=selected.filter(a=>previousMapping(a)?.videoNormalization?.audioResourceId).map(a=>{const m=snapshot.reimportSource.mediaMappings.find(m=>m.resourceId===previousMapping(a).videoNormalization.audioResourceId);if(!m?.videoAudioNormalization)fail('MEDIA_INVALID','视频派生声音缺失。');return {id:m.resourceId,category:m.category,relativePath:m.relativePath,kind:'audio'};});
    const inputs=[...selected,...dependencies];
    const verifyInputs=()=>{ordinary(source,true);const now=fs.lstatSync(source);if(now.dev!==sourceIdentity.dev||now.ino!==sourceIdentity.ino)fail('PATH_UNSAFE','素材根目录身份已变化。');for(const asset of inputs){const file=inputFile(asset),limit=asset.category==='video'?LIMITS.video:['character','background'].includes(asset.category)?LIMITS.image:LIMITS.audio;if(fs.lstatSync(file).size>limit)fail('MEDIA_TOO_LARGE','素材输入超过大小限制。');const bytes=fs.readFileSync(file);if(bytes.length>limit||createHash('sha256').update(bytes).digest('hex')!==inputHashes.get(asset.id))fail('MEDIA_HASH_MISMATCH','素材输入在准备或提交期间已变化。');}};
    // Freeze all selected bytes before the first asynchronous media callback.
    for(const asset of inputs){const file=inputFile(asset),kind=['character','background'].includes(asset.category)?'image':asset.category==='video'?'video':'audio',ext=path.extname(file).toLowerCase();if(asset.kind!==kind||!(kind==='image'?['.png','.jpg','.jpeg']:kind==='video'?['.mp4']:['.wav','.ogg','.mp3']).includes(ext))fail('MEDIA_UNSUPPORTED','仅支持 PNG/JPEG、48kHz PCM16 WAV、OGG Vorbis/Opus、MP3 和 MP4 视频。');if(fs.lstatSync(file).size>LIMITS[kind])fail('MEDIA_TOO_LARGE','素材输入超过大小限制。');const bytes=fs.readFileSync(file);if(bytes.length>LIMITS[kind])fail('MEDIA_TOO_LARGE','素材输入超过大小限制。');inputHashes.set(asset.id,createHash('sha256').update(bytes).digest('hex'));}
    for(const asset of selected) {
      await checkpoint();
      const file=inputFile(asset),ext=path.extname(file).toLowerCase(),kind=['character','background'].includes(asset.category)?'image':asset.category==='video'?'video':'audio';
      if(asset.kind!==kind||!(kind==='image'?['.png','.jpg','.jpeg']:kind==='video'?['.mp4']:['.wav','.ogg','.mp3']).includes(ext))fail('MEDIA_UNSUPPORTED','仅支持 PNG/JPEG、48kHz PCM16 WAV、OGG Vorbis/Opus、MP3 和 MP4 视频。');
      if(kind==='audio'&&['.ogg','.mp3'].includes(ext)) {
        if(previousMapping(asset))fail('MEDIA_INVALID','压缩音频回接必须具有有效的托管WAV来源记录。');
        const original=fs.readFileSync(file),sourceHash=createHash('sha256').update(original).digest('hex');
        if(original.length>LIMITS.audio||sourceHash!==inputHashes.get(asset.id))fail('MEDIA_HASH_MISMATCH','音频输入已变化。');
        const temporaryParent=ordinary(os.tmpdir(),true),temporary=fs.mkdtempSync(path.join(temporaryParent,'replay-audio-')),temporaryIdentity=fs.lstatSync(temporary);
        try {
          const tools=audioTools||{ffmpegPath:path.resolve(__dirname,'../../p0/tools/ffmpeg.exe'),ffprobePath:path.resolve(__dirname,'../../p0/tools/ffprobe.exe')};
          const normalized=await (normalizeAudio||require('./audio-media.cjs').normalizeAudio)({sourceFile:file,outputDirectory:temporary,...tools,check:checkpoint});
          await checkpoint();ordinary(temporary,true);const currentTemporary=fs.lstatSync(temporary);if(currentTemporary.dev!==temporaryIdentity.dev||currentTemporary.ino!==temporaryIdentity.ino)fail('PATH_UNSAFE','音频暂存目录身份已变化。');verifyInputs();
          const a=normalized?.audio,s=normalized?.source;
          if(normalized?.normalizationVersion!==1||!a||a.mime!=='audio/wav'||typeof a.file!=='string'||!path.isAbsolute(a.file)||!inside(temporary,a.file)||!s||s.hash!==sourceHash||s.extension!==ext||!(ext==='.ogg'?['vorbis','opus']:['mp3']).includes(s.codec)||!Number.isSafeInteger(s.sampleRate)||s.sampleRate<=0||![1,2].includes(s.channels))fail('MEDIA_INVALID','音频规范化来源或格式无效。');
          ordinary(a.file,false);if(fs.lstatSync(a.file).size>LIMITS.audio)fail('MEDIA_TOO_LARGE','规范化音频超过限制。');
          const bytes=fs.readFileSync(a.file);if(bytes.length>LIMITS.audio||totalBytes+bytes.length>LIMITS.total)fail('MEDIA_TOO_LARGE','规范化音频或总大小超过限制。');
          const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==a.hash)fail('MEDIA_HASH_MISMATCH','规范化音频内容校验失败。');
          let info;try{info=parseVoiceWav(bytes);}catch{fail('MEDIA_INVALID','规范化音频内容无效。');}
          if(info.sampleRate!==48000||info.bitsPerSample!==16||info.channels!==s.channels||info.durationSamples>600*48000||['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>a[k]!==info[k]))fail('MEDIA_INVALID','规范化音频参数不一致。');
          const relative='assets/'+hash+'.wav',audioNormalization={version:1,original:{sha256:sourceHash,bytes:original.length,container:ext.slice(1),codec:s.codec},managedRelativePath:require('./script-audio-provenance.cjs').managedAudioPath(asset.category,asset.id),mime:'audio/wav',sampleRate:48000,channels:info.channels,bitsPerSample:16,durationSamples:info.durationSamples,normalizationVersion:1};
          const mapping={resourceId:asset.id,category:asset.category,relativePath:asset.relativePath,hash,audioNormalization};
          if(require('./script-audio-provenance.cjs').validateAudioNormalization(mapping).length)fail('MEDIA_INVALID','音频来源记录无效。');
          totalBytes+=bytes.length;copies.set(relative,bytes);mediaMappings.push(mapping);media.push({id:asset.id,kind:'audio',path:relative,mime:'audio/wav',sampleRate:48000,channels:info.channels,bitsPerSample:16,durationSamples:info.durationSamples});
        } finally {try{const stat=fs.lstatSync(temporary);if(!stat.isSymbolicLink()&&stat.isDirectory()&&stat.dev===temporaryIdentity.dev&&stat.ino===temporaryIdentity.ino){ordinary(temporaryParent,true);fs.rmSync(temporary,{recursive:true,force:true});}}catch{}}
        continue;
      }
      if(kind==='video'&&previousMapping(asset)?.videoNormalization){
        const m=previousMapping(asset),n=m.videoNormalization,tools=videoTools||{ffmpegPath:path.resolve(__dirname,'../../p0/tools/ffmpeg.exe'),ffprobePath:path.resolve(__dirname,'../../p0/tools/ffprobe.exe')};
        const expected={hash:m.hash,width:n.width,height:n.height,fps:30,frameCount:n.frameCount,normalizationVersion:1};
        const actual=await (verifyManagedVideo||require('./managed-video-verify.cjs').verifyManagedVideo)({sourceFile:file,expected,...tools,check:checkpoint});
        if(!actual||Object.keys(expected).some(k=>actual[k]!==expected[k]))fail('MEDIA_INVALID','托管视频实际参数与来源不一致。');
        await checkpoint();verifyInputs();
        const checked=require('./script-managed-catalog.cjs').readManagedMapping({mapping:m,source:snapshot.reimportSource,assetsRoot:source});
        if(totalBytes+checked.bytes.length>LIMITS.total)fail('MEDIA_TOO_LARGE','托管媒体超过总大小限制。');totalBytes+=checked.bytes.length;
        const relative='assets/'+m.hash+'.mp4',resource={id:asset.id,kind:'video',path:relative,mime:'video/mp4',width:n.width,height:n.height,fps:30,frameCount:n.frameCount,normalizationVersion:1};copies.set(relative,checked.bytes);mediaMappings.push(structuredClone(m));
        if(n.audioResourceId!==null){const a=snapshot.reimportSource.mediaMappings.find(x=>x.resourceId===n.audioResourceId),value=require('./script-managed-catalog.cjs').readManagedMapping({mapping:a,source:snapshot.reimportSource,assetsRoot:source}),an=a.videoAudioNormalization;if(totalBytes+value.bytes.length>LIMITS.total)fail('MEDIA_TOO_LARGE','托管媒体超过总大小限制。');totalBytes+=value.bytes.length;const ap='assets/'+a.relativePath;copies.set(ap,value.bytes);resource.audioResourceId=a.resourceId;media.push({id:a.resourceId,kind:'audio',path:ap,mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:an.durationSamples});mediaMappings.push(structuredClone(a));}
        media.push(resource);continue;
      }
      if(kind==='video') {
        const inputSize=fs.lstatSync(file).size;if(inputSize>LIMITS.video)fail('MEDIA_TOO_LARGE','视频输入超过大小限制。');
        const inputBytes=fs.readFileSync(file);if(inputBytes.length>LIMITS.video)fail('MEDIA_TOO_LARGE','视频输入超过大小限制。');
        const inputHash=createHash('sha256').update(inputBytes).digest('hex');if(inputHashes.get(asset.id)!==inputHash)fail('MEDIA_HASH_MISMATCH','素材输入在准备期间已变化。');
        const temporaryParent=ordinary(os.tmpdir(),true),temporary=fs.mkdtempSync(path.join(temporaryParent,'replay-video-')),temporaryIdentity=fs.lstatSync(temporary);
        try {
          await checkpoint();
          // Dependency injection is exclusively a trusted main-process option, never report/config data.
          const normalize=normalizeVideo||require('./video-media.cjs').normalizeVideo;
          const tools=videoTools||{ffmpegPath:path.resolve(__dirname,'../../p0/tools/ffmpeg.exe'),ffprobePath:path.resolve(__dirname,'../../p0/tools/ffprobe.exe')};
          const normalized=await normalize({sourceFile:file,outputDirectory:temporary,ffmpegPath:tools.ffmpegPath,ffprobePath:tools.ffprobePath,check:checkpoint});
          await checkpoint();ordinary(temporary,true);const currentTemporary=fs.lstatSync(temporary);if(currentTemporary.dev!==temporaryIdentity.dev||currentTemporary.ino!==temporaryIdentity.ino)fail('PATH_UNSAFE','规范化临时目录身份已变化。');assetFile(source,asset);
          if(fs.lstatSync(file).size>LIMITS.video||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==inputHash)fail('MEDIA_HASH_MISMATCH','视频输入在规范化期间已变化。');
          const readNormalized=(entry,type)=>{
            if(!entry||typeof entry.file!=='string'||!path.isAbsolute(entry.file)||!inside(temporary,entry.file))fail('MEDIA_INVALID','规范化媒体路径无效。');
            ordinary(entry.file,false);
            const size=fs.lstatSync(entry.file).size;if(size>LIMITS[type]||totalBytes+size>LIMITS.total)fail('MEDIA_TOO_LARGE','规范化媒体或总大小超过限制。');
            const bytes=fs.readFileSync(entry.file);if(bytes.length>LIMITS[type]||totalBytes+bytes.length>LIMITS.total)fail('MEDIA_TOO_LARGE','规范化媒体或总大小超过限制。');
            const hash=createHash('sha256').update(bytes).digest('hex');if(entry.hash!==hash)fail('MEDIA_HASH_MISMATCH','规范化媒体内容校验失败。');totalBytes+=bytes.length;
            return {bytes,hash};
          };
          const v=normalized?.video;
          if(!v||v.fps!==30||v.normalizationVersion!==1||v.mime!=='video/mp4'||!['width','height','frameCount'].every(k=>Number.isSafeInteger(v[k])&&v[k]>0))fail('MEDIA_INVALID','规范化视频参数无效。');
          const video=readNormalized(v,'video'),relative='assets/'+video.hash+'.mp4';copies.set(relative,video.bytes);
          const resource={id:asset.id,kind:'video',path:relative,mime:'video/mp4',width:v.width,height:v.height,fps:30,frameCount:v.frameCount,normalizationVersion:1};
          // Mapping hashes describe the managed output, not the original input bytes.
          const videoMapping={resourceId:asset.id,category:'video',relativePath:asset.relativePath,hash:video.hash,videoNormalization:{version:1,original:{sha256:inputHash,bytes:inputBytes.length,container:'mp4'},managedRelativePath:'视频/__replay_normalized_'+asset.id+'.mp4',mime:'video/mp4',width:v.width,height:v.height,fps:30,frameCount:v.frameCount,normalizationVersion:1,audioResourceId:null}};mediaMappings.push(videoMapping);
          if(normalized.audio!==null&&normalized.audio!==undefined){
            const a=normalized.audio,audio=readNormalized(a,'audio');let info;try{info=parseVoiceWav(audio.bytes);}catch{fail('MEDIA_INVALID','派生音频内容无效。');}
            if(info.sampleRate!==48000||info.channels!==2||info.bitsPerSample!==16||['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>a[k]!==info[k]))fail('MEDIA_INVALID','派生音频参数无效。');
            const derivedHash=createHash('sha256').update(asset.id).digest('hex'),id='video-audio_'+derivedHash.slice(0,24),audioPath='assets/video-audio_'+derivedHash+'.wav';
            if(catalog.assets.some(x=>x.id===id)||media.some(x=>x.id===id))fail('RESOURCE_UNRESOLVED','派生音频身份冲突。');
            resource.audioResourceId=id;videoMapping.videoNormalization.audioResourceId=id;copies.set(audioPath,audio.bytes);
            media.push({id,kind:'audio',path:audioPath,mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:info.durationSamples});
            if(info.durationSamples!==v.frameCount*1600)fail('MEDIA_INVALID','派生音频样本数须与视频帧数一致。');
            mediaMappings.push({resourceId:id,category:'videoAudio',relativePath:'video-audio_'+derivedHash+'.wav',hash:audio.hash,videoAudioNormalization:{version:1,ownerResourceId:asset.id,managedRelativePath:'视频/__replay_audio_'+asset.id+'.wav',mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:info.durationSamples}});
          }
          media.push(resource);
        } finally {
          // Remove only the directory allocated by this invocation, never a replacement/link.
          try{const s=fs.lstatSync(temporary);if(!s.isSymbolicLink()&&s.isDirectory()&&s.dev===temporaryIdentity.dev&&s.ino===temporaryIdentity.ino){ordinary(temporaryParent,true);fs.rmSync(temporary,{recursive:true,force:true});}}catch{}
        }
        continue;
      }
      const size=fs.lstatSync(file).size;if(size>LIMITS[kind]||totalBytes+size>LIMITS.total)fail('MEDIA_TOO_LARGE','媒体文件或总大小超过限制。');
      const bytes=fs.readFileSync(file);if(bytes.length>LIMITS[kind]||totalBytes+bytes.length>LIMITS.total)fail('MEDIA_TOO_LARGE','媒体文件或总大小超过限制。');totalBytes+=bytes.length;
      if(inputHashes.get(asset.id)!==createHash('sha256').update(bytes).digest('hex'))fail('MEDIA_HASH_MISMATCH','素材输入在准备期间已变化。');
      let info;try{info=kind==='image'?parseImage(bytes,ext):parseVoiceWav(bytes);}catch{fail('MEDIA_INVALID','媒体内容损坏或参数不受支持。');}
      if(kind==='image') {
        if(typeof decodeImage!=='function')fail('IMAGE_DECODER_REQUIRED','图片需要主进程真实解码器验证。');
        await checkpoint();let decoded;try{decoded=await decodeImage(Buffer.from(bytes));}catch{fail('MEDIA_INVALID','图片无法完整解码。');}await checkpoint();
        if(!decoded||!Number.isSafeInteger(decoded.width)||!Number.isSafeInteger(decoded.height)||decoded.width<=0||decoded.height<=0||decoded.width!==info.width||decoded.height!==info.height)fail('MEDIA_INVALID','图片真实解码尺寸无效或不一致。');
      }
      const hash=createHash('sha256').update(bytes).digest('hex'),relative='assets/'+hash+(kind==='image'?info.extension:'.wav');copies.set(relative,bytes);
      if(snapshot.reimportSource){const previous=snapshot.reimportSource.mediaMappings.find(m=>m.resourceId===asset.id);if(previous&&(previous.hash!==hash||previous.category!==asset.category||previous.relativePath!==asset.relativePath))fail('MEDIA_HASH_MISMATCH','回接媒体内容或身份已变化，请重新预检。');}
      const prior=previousMapping(asset);
      if(prior?.audioNormalization){
        if(kind!=='audio'||ext!=='.wav'||require('./script-audio-provenance.cjs').validateAudioNormalization(prior,{id:asset.id,kind:'audio',mime:'audio/wav',...info}).length||['sampleRate','channels','bitsPerSample','durationSamples'].some(k=>prior.audioNormalization[k]!==info[k]))fail('MEDIA_INVALID','回接托管音频参数与来源不一致。');
      }
      mediaMappings.push({resourceId:asset.id,category:asset.category,relativePath:asset.relativePath,hash,...(prior?.audioNormalization?{audioNormalization:structuredClone(prior.audioNormalization)}:{})});
      media.push({id:asset.id,kind,path:relative,mime:kind==='image'?info.mime:'audio/wav',...(kind==='image'?{width:info.width,height:info.height}:{sampleRate:info.sampleRate,channels:info.channels,bitsPerSample:info.bitsPerSample,durationSamples:info.durationSamples})});
    }
    await checkpoint();let built;
    const buildConfig=preservation?.canPreserve?{...snapshot.reimportSource.config}:structuredClone(config);if(preservation?.canPreserve)delete buildConfig.dialoguePageMaxCharacters;
    if(preservation?.canPreserve&&snapshot.reimportSource?.version===3){const baseline=structuredClone(snapshot.reimportSource.baselineProject);delete baseline.scriptSource;baseline.id=randomUUID();const prepared=new Map(media.map(m=>[m.id,m]));if(!Array.isArray(baseline.resources)||baseline.resources.some(r=>!prepared.has(r.id)))fail('PRESERVATION_INVALID','视频来源资源未全部完成实际验证。');baseline.resources=baseline.resources.map(r=>{const p=prepared.get(r.id),strip=x=>Object.fromEntries(Object.entries(x).filter(([k])=>k!=='path'));const verified=strip(p);if(r.kind==='image'){if(r.width===undefined)delete verified.width;if(r.height===undefined)delete verified.height;}if(!require('node:util').isDeepStrictEqual(strip(r),verified))fail('PRESERVATION_INVALID','视频来源资源元数据与实际验证结果不一致。');return {...r,path:p.path};});built={project:baseline,sourceMap:{},diagnostics:[]};}else {
    try{built=await require('./script-project-builder.cjs').buildScriptProject({report:structuredClone(report),config:buildConfig,media:structuredClone(media),paginationPlan:paginationPlan.dialogues,title:'生成剧本工程',schemaVersion:4});}catch(e){fail('BUILD_FAILED','工程构建失败，请检查剧本及配置。',e?.diagnostics);}
    }
    if(built&&preservation)built.diagnostics=[...(built.diagnostics||[]),...preservation.diagnostics];
    await checkpoint();
    if(!built?.project||(built.diagnostics||[]).some(d=>(d.severity||d.level)==='error'))fail('BUILD_FAILED','工程构建失败，请检查诊断。',built?.diagnostics);
    if(preservation?.canPreserve){
      const retained=require('./script-reimport-preservation.cjs').applyPreservation({project:built.project,sourceMap:built.sourceMap,source:snapshot.reimportSource,report,plan:preservation.plan});
      if(!retained.project)fail('PRESERVATION_FAILED','回接实际帧值无法安全保留，未生成工程。',retained.diagnostics);
      built={...built,project:retained.project,sourceMap:retained.sourceMap};
    }
    const {project,sourceMap}=built;if(!sourceMap||validateProject(project).length)fail('BUILD_FAILED','生成工程未通过模型校验。',built.diagnostics);
    for(const r of project.resources||[]){const expected=media.find(m=>m.id===r.id);const keys=expected?.kind==='image'?['id','kind','path','mime']:Object.keys(expected||{});if(!expected||keys.some(k=>r[k]!==expected[k])||['width','height'].some(k=>r[k]!==undefined&&r[k]!==expected[k]))fail('BUILD_FAILED','工程包含未经验证的媒体资源。');}
    if(project.schemaVersion===4){
      project.scriptSource=require('./script-source-record.cjs').createSourceRecord({text,config,report,sourceMap,project,mediaMappings:mediaMappings.filter(m=>project.resources.some(r=>r.id===m.resourceId))});
      if(validateProject(project).length)fail('BUILD_FAILED','来源记录未通过模型校验。');
    }
    const dialogues=project.scene.dialogues||[],summary={durationFrames:project.scene.durationFrames,fps:project.design.fps,durationSeconds:project.scene.durationFrames/project.design.fps,dialogueCount:dialogues.length,pageCount:dialogues.reduce((n,d)=>n+(d.pages?.length||1),0),voicedDialogueCount:dialogues.filter(d=>d.voiceClips?.length||d.voice).length,unvoicedDialogueCount:dialogues.filter(d=>!d.voiceClips?.length&&!d.voice).length,characters:(project.characterDefinitions||[]).map(d=>({id:d.id,name:d.name,instanceCount:(project.scene.characters||[]).filter(c=>c.definitionId===d.id).length})),media:{count:media.length,images:media.filter(m=>m.kind==='image').length,audio:media.filter(m=>m.kind==='audio').length,videos:media.filter(m=>m.kind==='video').length,totalBytes},warnings:safeDiagnostics([...(report.diagnostics||[]),...(built.diagnostics||[])].filter(d=>['warning','info'].includes(d.severity||d.level)))};
    const fingerprintProject=structuredClone(project);
    if(snapshot.reimportSource?.version===3&&preservation?.canPreserve){fingerprintProject.id=snapshot.reimportSource.baselineProject.id;if(fingerprintProject.scriptSource?.baselineProject)fingerprintProject.scriptSource.baselineProject.id=snapshot.reimportSource.baselineProject.id;}
    // Only freshly allocated source stable UUIDs are nondeterministic. Builder IDs,
    // preserved identities and every baseline/model field remain fingerprinted.
    for(const n of fingerprintProject.scriptSource?.nodes||[])if(!report.identities?.some(i=>i.nodeId===n.nodeId))delete n.stableId;
    const fingerprint=digest({version:1,inputs:[...inputHashes],paginationPlan,config:buildConfig,report,media,mediaMappings,project:fingerprintProject,sourceMap,summary});
    await checkpoint();verifyInputs();
    if(!previewOnly&&expectedPreviewFingerprint!==undefined&&(typeof expectedPreviewFingerprint!=='string'||expectedPreviewFingerprint!==fingerprint))fail('PREVIEW_CHANGED','生成输入或预计结果已变化，请重新预览并确认。');
    if(previewOnly)return {summary,fingerprint};
    const files=new Map([['project.replay.json',JSON.stringify({format:'replay-project',revision:0,project},null,2)],['source.txt',text],['source-map.json',JSON.stringify(sourceMap,null,2)],['config.json',JSON.stringify(config,null,2)]]);
    await checkpoint();verifyInputs();ordinary(parent,true);
    staging=fs.mkdtempSync(path.join(parent,'.replay-staging-'));identity=fs.lstatSync(staging);fs.mkdirSync(path.join(staging,'assets'));
    for(const [relative,bytes] of copies){await checkpoint();ordinary(staging,true);ordinary(path.join(staging,'assets'),true);fs.writeFileSync(path.join(staging,relative),bytes,{flag:'wx'});}
    for(const [relative,bytes] of files){await checkpoint();ordinary(staging,true);fs.writeFileSync(path.join(staging,relative),bytes,{flag:'wx'});}
    await checkpoint();ordinary(source,true);ordinary(parent,true);ordinary(staging,true);
    verifyInputs();
    for(const [r,bytes] of copies){const f=path.join(staging,r);ordinary(f,false);if(!fs.readFileSync(f).equals(bytes))fail('COPY_FAILED','托管媒体副本校验失败。');}
    for(const [r,bytes] of files){const f=path.join(staging,r);ordinary(f,false);if(fs.readFileSync(f,'utf8')!==bytes)fail('COPY_FAILED','生成文件校验失败。');}
    // No asynchronous boundary between final validation and atomic publication.
    let root;for(let i=0;i<32;i++){const candidate=path.join(parent,'replay-generated-'+randomUUID());try{fs.lstatSync(candidate);}catch(e){if(e.code!=='ENOENT')throw e;root=candidate;break;}}
    if(!root)fail('OUTPUT_COLLISION','无法分配新的工程目录。');
    fs.renameSync(staging,root);staging=undefined;
    return {file:path.join(root,'project.replay.json'),root,project,sourceMap,generationSummary:summary,fingerprint,mediaSummary:{count:media.length,images:media.filter(m=>m.kind==='image').length,audio:media.filter(m=>m.kind==='audio').length,videos:media.filter(m=>m.kind==='video').length,totalBytes,uniqueFiles:copies.size,mediaValidated:true,diagnostics:safeDiagnostics(built.diagnostics)}};
  }catch(e){
    if(staging)try{const s=fs.lstatSync(staging);if(!s.isSymbolicLink()&&s.isDirectory()&&s.dev===identity?.dev&&s.ino===identity?.ino){ordinary(path.dirname(staging),true);fs.rmSync(staging,{recursive:true,force:true});}}catch{/* Never broaden rollback to source/outputParent. */}
    if(safeErrors.has(e))throw e;fail('GENERATION_FAILED','工程生成失败，未提交新工程。');
  }
}
function generatePortableScript(options){return preparePortableScript(options,false);}
function previewPortableScript(options){return preparePortableScript(options,true);}
module.exports={generatePortableScript,previewPortableScript};
