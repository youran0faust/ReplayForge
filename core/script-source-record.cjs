'use strict';
// Source evidence is data only. No saved path is ever opened here.
const {randomUUID,createHash}=require('node:crypto');
const sha=s=>createHash('sha256').update(s).digest('hex');
const {isDeepStrictEqual}=require('node:util');
const {parseScript}=require('./script-parser.cjs');
const {validateReadingConfig}=require('./script-reading-budget.cjs');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const str=s=>typeof s==='string'&&s.length>0&&s.length<=4096&&!/[\x00-\x1f]/.test(s);
const safePath=p=>str(p)&&p.length<=1024&&!/[<>:"|?*]/.test(p)&&!/^[/\\]/.test(p)&&!p.split(/[/\\]/).some(s=>!s||s==='.'||s==='..'||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIG=['version','characters','defaultLayout','unvoicedDurationSeconds','dialoguePageMaxCharacters','dialoguePageHoldSeconds','unvoicedTimingMode','unvoicedMinimumSeconds','unvoicedReadingSpeed','dialogueRevealCharactersPerSecond','titleFadeInSeconds','titleHoldSeconds','titleFadeOutSeconds','characterFadeSeconds','screenFadeSeconds','bgmFadeOutSeconds'];
const TYPES=['characterDefinition','characterInstance','expressionEvent','positionKeyframe','backgroundEvent','dialogue','dialoguePage','voiceClip','audioTrack','characterOpacity','screenFade','dialogueVisibility','dialogueClear','title','videoClip'];
const PERFORMANCE=[['characterOpacity','characterOpacity'],['screenFades','screenFade'],['dialogueVisibility','dialogueVisibility'],['dialogueClears','dialogueClear'],['titles','title']];
function dataError(root){
 const ancestors=new Set();let count=0,bytes=0;
 function visit(v,depth){
  if(++count>500000||depth>32)throw Error('data size/depth limit exceeded');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='string'){bytes+=Buffer.byteLength(v,'utf8');if(bytes>16*1024*1024)throw Error('data size limit exceeded');return;}
  if(typeof v==='number'&&Number.isFinite(v))return;
  if(typeof v!=='object'||(!Array.isArray(v)&&!plain(v)))throw Error('only finite JSON data is allowed');
  if(ancestors.has(v))throw Error('recursive data is forbidden');ancestors.add(v);
  if(Array.isArray(v)&&v.length>50000)throw Error('array size limit exceeded');
  const keys=Reflect.ownKeys(v);if(keys.length>50001)throw Error('object size limit exceeded');
  for(const k of keys){
   if(Array.isArray(v)&&k==='length')continue;
   if(typeof k!=='string'||['__proto__','prototype','constructor'].includes(k))throw Error('unsafe data key');
   const d=Object.getOwnPropertyDescriptor(v,k);if(!d.enumerable||!own(d,'value'))throw Error('accessors/non-enumerable data forbidden');
   if(Array.isArray(v)&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=v.length))throw Error('array property forbidden');
   bytes+=Buffer.byteLength(k);visit(d.value,depth+1);
  }
  if(Array.isArray(v)&&keys.length!==v.length+1)throw Error('sparse arrays forbidden');
  ancestors.delete(v);
 }
 try{visit(root,0);return null;}catch(e){return e.message;}
}
function validateSourceRecord(record){
 const errors=[],add=m=>{if(errors.length<100)errors.push('scriptSource: '+m);};
 const unsafe=dataError(record);if(unsafe)return ['scriptSource: '+unsafe];
 const shape=(v,keys,required=keys,label='object')=>{if(!plain(v)){add(label+' must be an object');return false;}for(const k of Object.keys(v))if(!keys.includes(k))add(label+' unknown field '+k);for(const k of required)if(!own(v,k))add(label+' missing '+k);return true;};
 try{
 if(!shape(record,['version','text','config','nodes','bindings','mediaMappings','baselineProject']))return errors;
 if(![1,2,3].includes(record.version))add('unsupported version');
  if(record.version===3&&!record.mediaMappings?.some(m=>m&&Object.hasOwn(m,'videoNormalization')))add('version3 requires normalized video mapping');
  if(record.version===2&&!record.mediaMappings?.some(m=>m&&Object.hasOwn(m,'audioNormalization')))add('version2 requires normalized audio mapping');
 if(typeof record.text!=='string'||Buffer.byteLength(record.text)>1024*1024)add('text must be a string of at most 1 MiB');
 const c=record.config;
 if(shape(c,CONFIG,['version','characters'],'config')){
  if(c.version!==1)add('config version must be 1');
  if(c.defaultLayout!==undefined&&!['单人','双人','三人','四人'].includes(c.defaultLayout))add('invalid defaultLayout');
  if(c.unvoicedDurationSeconds!==undefined&&(typeof c.unvoicedDurationSeconds!=='number'||c.unvoicedDurationSeconds<=0||c.unvoicedDurationSeconds>3600))add('invalid unvoicedDurationSeconds');
  if(c.dialoguePageMaxCharacters!==undefined&&(!Number.isInteger(c.dialoguePageMaxCharacters)||c.dialoguePageMaxCharacters<1||c.dialoguePageMaxCharacters>1000))add('invalid dialoguePageMaxCharacters');
  for(const d of validateReadingConfig(c))add(d.message);
   for(const d of require('./performance-config.cjs').validatePerformanceConfig(c))add(d.message);
  if(!Array.isArray(c.characters)||c.characters.length>1000)add('characters must be an array of at most 1000');
  else {const names=new Set(),codes=new Set();for(const ch of c.characters){
   if(!shape(ch,['name','voiceCode','expressions','defaultExpression','image','expressionImages'],['name'],'character'))continue;
   if(!str(ch.name)||!ch.name.trim()||names.has(ch.name))add('invalid/duplicate character name');names.add(ch.name);
   if(ch.voiceCode!==undefined){if(typeof ch.voiceCode!=='string'||! /^[A-Za-z][A-Za-z0-9]*$/.test(ch.voiceCode)||codes.has(ch.voiceCode.toUpperCase()))add('invalid/duplicate voiceCode');else codes.add(ch.voiceCode.toUpperCase());}
   if(ch.expressions!==undefined&&(!Array.isArray(ch.expressions)||ch.expressions.some(e=>!str(e)||!e.trim())||new Set(ch.expressions).size!==ch.expressions.length))add('invalid expressions');
   if(ch.defaultExpression!==undefined&&(!Array.isArray(ch.expressions)||!ch.expressions.includes(ch.defaultExpression)))add('invalid defaultExpression');
   if(ch.image!==undefined&&!safePath(ch.image))add('unsafe character image path');
   if(ch.expressionImages!==undefined){if(!plain(ch.expressionImages))add('invalid expressionImages');else for(const [name,path] of Object.entries(ch.expressionImages))if(!Array.isArray(ch.expressions)||!ch.expressions.includes(name)||!safePath(path))add('invalid expression image mapping');}
  }}
 }
 for(const key of ['nodes','bindings','mediaMappings'])if(!Array.isArray(record[key])||record[key].length>10000)add(key+' must be an array of at most 10000');
 const p=record.baselineProject;
  if(record.version===3&&p?.schemaVersion!==4)add('source3 requires schema4');
 // Reject nested provenance BEFORE lazy model validation to prevent recursion.
 if(!plain(p)||own(p,'scriptSource'))add('baselineProject must not contain scriptSource');
 if(errors.length)return errors;
 for(const e of require('./model.cjs').validateProject(p))add('baselineProject '+e);
 if(![3,4].includes(p.schemaVersion))add('baselineProject must use schema3 or schema4');
 if(errors.length)return errors;
 for(const r of p.resources)if(!safePath(r.path))add('unsafe baseline resource path');
 const parsed=parseScript(record.text,{characters:c.characters,defaultLayout:c.defaultLayout});
 if(parsed.diagnostics.some(d=>d.severity==='error'))add('text does not parse with config');
 if(parsed.nodes.length!==record.nodes.length)add('source node count differs from text');
 const ids=new Set(),stable=new Set(),nodeMap=new Map(),objects=new Map(),covered=new Set(),dialogueOwners=new Set();
 const index=(type,list)=>{for(const obj of list||[]){const key=type+':'+obj.id;if(objects.has(key))add('duplicate baseline object identity');objects.set(key,obj);}};
 index('videoClip',p.scene.videoClips);
  const videoOwners=new Set();
  index('characterDefinition',p.characterDefinitions);index('characterInstance',p.scene.characters);index('backgroundEvent',p.scene.backgroundEvents);index('dialogue',p.scene.dialogues);index('audioTrack',p.scene.audioTracks);
 for(const [key,type] of PERFORMANCE)index(type,p.scene.performance?.[key]);
  const performanceOwners=new Set();
  const positionOwners=new Map();
 for(const ch of p.scene.characters){index('expressionEvent',ch.expressionEvents);index('positionKeyframe',ch.positionKeyframes);for(const key of ch.positionKeyframes||[])positionOwners.set(key.id,ch);}
 for(const d of p.scene.dialogues){index('dialoguePage',d.pages);index('voiceClip',d.voiceClips);}
 record.nodes.forEach((n,i)=>{
  if(!shape(n,['stableId','nodeId','baseline','objects'],undefined,'node'))return;
  if(typeof n.stableId!=='string'||!UUID.test(n.stableId)||stable.has(n.stableId.toLowerCase()))add('invalid/duplicate stableId');else stable.add(n.stableId.toLowerCase());
  if(!str(n.nodeId)||ids.has(n.nodeId))add('invalid/duplicate nodeId');ids.add(n.nodeId);nodeMap.set(n.nodeId,n);
  if(!isDeepStrictEqual(n.baseline,parsed.nodes[i])||n.nodeId!==n.baseline?.id)add('node baseline differs from parser/text');
  if(!Array.isArray(n.objects)){add('node objects must be an array');return;}
  const seen=new Set();for(const o of n.objects){if(!shape(o,['type','id'],undefined,'object mapping'))continue;const key=o.type+':'+o.id;if(!TYPES.includes(o.type)||!str(o.id)||!objects.has(key)||seen.has(key))add('invalid/duplicate object mapping');seen.add(key);covered.add(key);}
  if(n.baseline?.type==='dialogue'){
   const ds=n.objects.filter(o=>o.type==='dialogue').map(o=>objects.get('dialogue:'+o.id)).filter(Boolean);
   if(ds.length!==1)add('dialogue node must map to exactly one dialogue');
   else {const d=ds[0];if(dialogueOwners.has(d.id))add('duplicate dialogue owner');dialogueOwners.add(d.id);
    if((d.fullText||d.text)?.[p.locale]!==n.baseline.text)add('dialogue baseline text mismatch');
    const speaker=d.speakerId==='narrator'?'旁白':p.characterDefinitions.find(def=>def.id===(p.schemaVersion===4?d.speakerId:p.scene.characters.find(ch=>ch.id===d.speakerId)?.definitionId))?.name;
    if(speaker!==n.baseline.speaker)add('dialogue baseline speaker mismatch');
    for(const [type,list] of [['dialoguePage',d.pages],['voiceClip',d.voiceClips]]){for(const obj of list||[])if(!seen.has(type+':'+obj.id))add('dialogue child mapping missing');for(const o of n.objects.filter(o=>o.type===type))if(!(list||[]).some(obj=>obj.id===o.id))add('foreign dialogue child mapping');}
   }
  }else if(n.objects.some(o=>['dialogue','dialoguePage','voiceClip'].includes(o.type)))add('non-dialogue owns dialogue object');
  const allowed=n.baseline?.type==='dialogue'?['characterDefinition','expressionEvent','dialogue','dialoguePage','voiceClip']:n.baseline?.type==='title'?['title']:n.baseline?.type==='command'?({移动:['positionKeyframe'],出场:['characterDefinition','characterInstance','expressionEvent','characterOpacity'],退场:['characterInstance','characterOpacity'],表情:['expressionEvent'],背景:['backgroundEvent','screenFade'],画面:['screenFade'],清字幕:['dialogueClear'],对白框:['dialogueVisibility'],隐藏对白框:['dialogueVisibility'],显示对白框:['dialogueVisibility'],音乐:['audioTrack'],音效:['audioTrack'],视频:['videoClip'],停顿:[],布局:[]}[n.baseline.name]||[]):[];
   for(const o of n.objects.filter(o=>PERFORMANCE.some(([,type])=>type===o.type))){
    const key=o.type+':'+o.id,obj=objects.get(key);if(performanceOwners.has(key))add('duplicate performance owner');performanceOwners.add(key);
    if(o.type==='characterOpacity'&&obj){const ch=p.scene.characters.find(ch=>ch.id===obj.characterId);if(!ch||p.characterDefinitions.find(d=>d.id===ch.definitionId)?.name!==n.baseline?.args?.角色||!n.objects.some(ref=>ref.type==='characterInstance'&&ref.id===obj.characterId))add('character opacity ownership mismatch');}
    if(o.type==='title'&&obj&&obj.text!==n.baseline?.text)add('title baseline text mismatch');
   }
   if(p.schemaVersion===4&&n.baseline?.type==='title'&&n.objects.filter(o=>o.type==='title').length!==1)add('title node must map to exactly one title');
  // Positive-duration intervals cannot be terminal-pruned or overwritten by
  // same-frame state events. Visibility/clear intentionally allow zero mappings.
  if(p.schemaVersion===4&&n.baseline?.type==='command'){
   const {name,args={}}=n.baseline;
   const expected=name==='出场'&&args.演出==='淡入'||name==='退场'&&args.演出==='淡出'?['characterOpacity',1]:name==='画面'&&['淡入','淡出'].includes(args.动作)?['screenFade',1]:name==='背景'&&args.转场==='黑屏'?['screenFade',2]:null;
   if(expected&&n.objects.filter(o=>o.type===expected[0]).length!==expected[1])add(name+' node must map to exactly '+expected[1]+' '+expected[0]);
  }
  if(n.baseline?.type==='command'&&n.baseline.name==='视频'){
    const clips=n.objects.filter(o=>o.type==='videoClip');
    if(clips.length!==1)add('video node must map to exactly one videoClip');
    for(const ref of clips){if(videoOwners.has(ref.id))add('duplicate videoClip owner');videoOwners.add(ref.id);}
   }
   if(n.objects.some(o=>!allowed.includes(o.type)))add('object type incompatible with source node');
  if(n.baseline?.type==='command'&&n.baseline.name==='移动'){
   const keys=n.objects.filter(o=>o.type==='positionKeyframe'),owners=keys.map(o=>positionOwners.get(o.id));
   if(keys.length!==2||!owners[0]||owners[0]!==owners[1])add('movement must map to two endpoints of one instance');
   else if(p.characterDefinitions.find(d=>d.id===owners[0].definitionId)?.name!==n.baseline.args.角色||n.baseline.args.角色==='旁白')add('movement endpoint character ownership mismatch');
   // Baseline coordinates/timing may be manually edited before saving. Only
   // structural ownership is evidence; source values are not a recompilation.
  }
  if(['section','comment'].includes(n.baseline?.type)&&n.objects.length)add('non-executable node owns objects');
 });
 for(const key of objects.keys())if(!covered.has(key))add('baseline object has no source mapping: '+key);
 const resources=new Map(p.resources.map(r=>[r.id,r])),mappings=new Map(),paths=new Set(),vp=require('./script-video-provenance.cjs');
 for(const m of record.mediaMappings){
  if(!shape(m,record.version===3?['resourceId','category','relativePath','hash','audioNormalization','videoNormalization','videoAudioNormalization']:record.version===2?['resourceId','category','relativePath','hash','audioNormalization']:['resourceId','category','relativePath','hash'],['resourceId','category','relativePath','hash'],'media mapping'))continue;
   for(const e of require('./script-audio-provenance.cjs').validateAudioNormalization(m,resources.get(m.resourceId)))add(e);
  if(!str(m.resourceId)||!resources.has(m.resourceId)||mappings.has(m.resourceId))add('invalid/duplicate media resourceId');
  if(!['character','background','voice','music','sfx','video','videoAudio'].includes(m.category))add('invalid media category');
  if(!safePath(m.relativePath))add('unsafe media relativePath');else{const key=m.relativePath.replaceAll('\\','/').toLowerCase();if(paths.has(key))add('duplicate media path');paths.add(key);}
  if(typeof m.hash!=='string'||!/^[0-9a-f]{64}$/i.test(m.hash))add('invalid media hash');
  const r=resources.get(m.resourceId);if(r&&r.kind!==(['voice','music','sfx','videoAudio'].includes(m.category)?'audio':m.category==='video'?'video':'image'))add('media category/kind mismatch');
  for(const e of vp.validateVideoNormalization(m,r))add(e);
   if(record.version===3&&m.category==='video'&&!m.videoNormalization)add('video mapping requires normalization');
   if(record.version===3&&m.category==='videoAudio'&&!m.videoAudioNormalization)add('derived audio mapping requires normalization');
   mappings.set(m.resourceId,m);
 }
 const physicalPaths=new Set();for(const m of record.mediaMappings){try{const physical=require('./script-audio-provenance.cjs').physicalMappingPath(m).replaceAll('\\','/').toLowerCase();if(physicalPaths.has(physical)||(['audioNormalization','videoNormalization','videoAudioNormalization'].some(k=>own(m,k))&&paths.has(physical)))add('physical media path collision/shadow');physicalPaths.add(physical);}catch{add('invalid physical media path');}}
  for(const id of resources.keys())if(!mappings.has(id))add('resource missing media mapping');
  const videos=p.resources.filter(r=>r.kind==='video');
  for(const m of record.mediaMappings)if(m.category==='videoAudio'){
   const owners=videos.filter(v=>v.audioResourceId===m.resourceId),v=owners[0];
   if(owners.length!==1||m.resourceId!=='video-audio_'+sha(v.id).slice(0,24)||m.relativePath!=='video-audio_'+sha(v.id)+'.wav')add('invalid videoAudio derived identity/path or owner');
    if(record.version===3)for(const e of vp.validateVideoAudioNormalization(m,resources.get(m.resourceId),v,mappings.get(v?.id)))add(e);
  }
  for(const v of videos){
   if(mappings.get(v.id)?.category!=='video')add('video resource requires video mapping');
   if(v.audioResourceId!==undefined&&mappings.get(v.audioResourceId)?.category!=='videoAudio')add('video audio requires videoAudio mapping');
  }
  const videoCatalog=record.mediaMappings.filter(m=>m.category==='video').map(m=>({id:m.resourceId,category:'video',relativePath:m.relativePath.replaceAll('\\','/'),categoryPath:m.relativePath.replaceAll('\\','/').split('/').slice(1).join('/')}));
  for(const n of record.nodes)if(n.baseline?.type==='command'&&n.baseline.name==='视频'){
   const match=require('./script-asset-catalog.cjs').resolveAsset(videoCatalog,'video',n.baseline.args.文件);
   const clip=objects.get('videoClip:'+n.objects.find(o=>o.type==='videoClip')?.id);
   if(match.status!=='matched'||match.candidates[0].id!==clip?.resourceId)add('video source path/resource mapping mismatch');
  }
 const category=(id,expected)=>{if(id!==undefined&&mappings.get(id)?.category!==expected)add('media category differs from baseline use');};
 for(const d of p.characterDefinitions){category(d.resourceId,'character');for(const e of d.expressions||[])category(e.resourceId,'character');}
 if(p.scene.background?.kind==='image')category(p.scene.background.resourceId,'background');
 for(const e of p.scene.backgroundEvents||[])if(e.background?.kind==='image')category(e.background.resourceId,'background');
 for(const t of p.scene.audioTracks||[])category(t.resourceId,t.kind==='bgm'?'music':'sfx');
 const bound=new Set(),voices=new Set();
 for(const b of record.bindings){
  if(!shape(b,['nodeId','status','resourceId','textBaseline'],['nodeId','status'],'binding'))continue;
  const n=nodeMap.get(b.nodeId);if(!n||n.baseline?.type!=='dialogue'||bound.has(b.nodeId))add('invalid/duplicate binding node');bound.add(b.nodeId);
  if(!['unvoiced','matched','manual','reviewRequired'].includes(b.status))add('unresolved binding');
  if(b.textBaseline!==undefined&&typeof b.textBaseline!=='string')add('invalid binding textBaseline');
  const unvoiced=b.status==='unvoiced'||(b.status==='reviewRequired'&&b.resourceId==null);
  if(unvoiced){if(b.resourceId!=null)add('unvoiced binding has resource');}
  else {if(!str(b.resourceId)||mappings.get(b.resourceId)?.category!=='voice'||voices.has(b.resourceId))add('invalid/duplicate voice resource');voices.add(b.resourceId);}
  const d=n?.objects?.find(o=>o.type==='dialogue'),dialogue=objects.get('dialogue:'+d?.id),clips=dialogue?.voiceClips;
   // Only a video covering the source voice start can explain a zero trim.
   const videoSilenced=clips?.length===0&&(p.scene.videoClips||[]).some(v=>dialogue.startFrame>=v.startFrame&&dialogue.startFrame<v.endFrame);
  if(clips&&(unvoiced?clips.length!==0:!videoSilenced&&(clips.length!==1||clips[0].resourceId!==b.resourceId)))add('binding differs from baseline voice clips');
 }
 for(const n of record.nodes)if(n.baseline?.type==='dialogue'&&!bound.has(n.nodeId))add('dialogue missing binding');
 return errors;
 }catch(e){add('invalid record: '+e.message);return errors;}
}
function createSourceRecord({text,config,report,sourceMap,project,mediaMappings}={}){
 if(!plain(project)||!plain(report)||!Array.isArray(report.nodes)||!plain(sourceMap))throw Error('Invalid source record input');
 if(Object.keys(sourceMap).length!==report.nodes.length||report.nodes.some(n=>!own(sourceMap,n.id)))throw Error('Source map must exactly cover source nodes');
  const identities=new Map(),used=new Set();
 if(report.identities!==undefined){
  const unsafe=dataError(report.identities);if(unsafe||!Array.isArray(report.identities))throw Error('Invalid source identities');
  for(const row of report.identities){if(!plain(row)||Object.keys(row).length!==2||!str(row.nodeId)||typeof row.stableId!=='string'||!UUID.test(row.stableId)||identities.has(row.nodeId)||used.has(row.stableId.toLowerCase())||!report.nodes.some(n=>n.id===row.nodeId))throw Error('Invalid/duplicate source identity');identities.set(row.nodeId,row.stableId);used.add(row.stableId.toLowerCase());}
 }
 const baselineProject=Object.fromEntries(Object.entries(project).filter(([k])=>k!=='scriptSource'));
 const record={version:mediaMappings?.some(m=>m&&Object.hasOwn(m,'videoNormalization'))?3:mediaMappings?.some(m=>m&&Object.hasOwn(m,'audioNormalization'))?2:1,text,config,nodes:report.nodes.map(n=>({stableId:identities.get(n?.id)||randomUUID(),nodeId:n?.id,baseline:n,objects:sourceMap[n?.id]?.objects})),bindings:report.bindings,mediaMappings,baselineProject};
 const errors=validateSourceRecord(record);if(errors.length){const error=Error(errors.join('\n'));error.code='INVALID_SOURCE_RECORD';error.errors=errors;throw error;}
 return JSON.parse(JSON.stringify(record));
}
module.exports={createSourceRecord,validateSourceRecord};
