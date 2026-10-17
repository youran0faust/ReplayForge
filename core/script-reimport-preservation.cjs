'use strict';
// Pure provenance lowering. The caller supplies an explicitly authorized source;
// this module independently validates it and never opens saved resource paths.
const {isDeepStrictEqual:eq}=require('node:util');
const {validateSourceRecord}=require('./script-source-record.cjs');
const {validateProject}=require('./model.cjs');
const {parseScript}=require('./script-parser.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fields={videoClip:['id','resourceId','startFrame','endFrame'],characterDefinition:['id','name','color','resourceId','expressions'],characterInstance:['id','definitionId','x','y','width','height','visibleFrom','visibleTo','expressionEvents','positionKeyframes'],expressionEvent:['id','frame','expressionId'],positionKeyframe:['id','frame','x','y','interpolation'],backgroundEvent:['id','frame','background'],dialogue:['id','speakerId','startFrame','endFrame','displayUntilFrame','revealFrames','text','fullText','pages','voiceClips'],dialoguePage:['id','text','startFrame','endFrame','revealFrames'],voiceClip:['id','resourceId','sampleRate','sourceOffsetSamples','durationSamples','sourceDurationSamples','binding','startFrame'],audioTrack:['id','name','kind','resourceId','startFrame','durationSamples','sourceOffsetSamples','gain','fadeOutSamples'],characterOpacity:['id','characterId','startFrame','endFrame','from','to'],screenFade:['id','startFrame','endFrame','from','to'],dialogueVisibility:['id','frame','visible'],dialogueClear:['id','frame'],title:['id','startFrame','endFrame','fadeInFrames','fadeOutFrames','text','style']};
const timing={characterDefinition:[],characterInstance:['x','y','width','height','visibleFrom','visibleTo'],expressionEvent:['frame'],positionKeyframe:['frame','x','y','interpolation'],backgroundEvent:['frame'],dialogue:['startFrame','endFrame','displayUntilFrame','revealFrames'],dialoguePage:['startFrame','endFrame','revealFrames'],voiceClip:['sourceOffsetSamples','durationSamples','startFrame','binding'],audioTrack:['startFrame','durationSamples','sourceOffsetSamples','gain','fadeOutSamples'],characterOpacity:['startFrame','endFrame','from','to'],screenFade:['startFrame','endFrame','from','to'],dialogueVisibility:['frame','visible'],dialogueClear:['frame'],title:['startFrame','endFrame','fadeInFrames','fadeOutFrames','style']};
const PERFORMANCE=[['characterOpacity','characterOpacity'],['screenFades','screenFade'],['dialogueVisibility','dialogueVisibility'],['dialogueClears','dialogueClear'],['titles','title']];
function shape(x,keys){if(!x||typeof x!=='object'||Array.isArray(x)||Reflect.ownKeys(x).some(k=>!keys.includes(k)||!own(Object.getOwnPropertyDescriptor(x,k),'value')))throw Error('unknown/unsupported fields');}
function inventory(p){
 shape(p,['schemaVersion','id','title','design','locale','resources','characterDefinitions','scene']);shape(p.design,['width','height','fps']);shape(p.scene,['id','durationFrames','background','backgroundEvents','characters','dialogues','audioTracks','performance','videoClips']);
 if(own(p.scene,'performance')){if(p.schemaVersion!==4)throw Error('performance requires schema4');shape(p.scene.performance,['version',...PERFORMANCE.map(([key])=>key)]);if(p.scene.performance.version!==1)throw Error('unsupported performance version');}
 const bg=x=>{shape(x,['kind','color','resourceId']);if(!['image','color'].includes(x.kind))throw Error('unsupported background');};if(p.scene.background)bg(p.scene.background);
 const result=new Map(),ids=new Set();
 const add=(type,list=[])=>{if(!Array.isArray(list))throw Error('invalid collection');for(const x of list){shape(x,fields[type]);if(typeof x.id!=='string'||ids.has(x.id))throw Error('duplicate object identity/type');ids.add(x.id);result.set(type+':'+x.id,{type,object:x});
 if(type==='characterDefinition')for(const e of x.expressions||[]){shape(e,['id','name','mode','resourceId']);if(e.mode!=='replace')throw Error('unsupported expression');}
 if(type==='title'&&own(x,'style')){shape(x.style,['fontSize','color','align']);const errors=require('./title-style.cjs').validateTitleStyle(x.style);if(errors.length)throw Error(errors.join('; '));}
 if(type==='backgroundEvent')bg(x.background);if(type==='voiceClip')shape(x.binding,['dialogueId','mode','followOffsetFrames']);
 if(type==='characterInstance'){add('expressionEvent',x.expressionEvents);add('positionKeyframe',x.positionKeyframes);}if(type==='dialogue'){add('dialoguePage',x.pages);add('voiceClip',x.voiceClips);}}};
 add('characterDefinition',p.characterDefinitions);add('characterInstance',p.scene.characters);add('backgroundEvent',p.scene.backgroundEvents);add('dialogue',p.scene.dialogues);add('audioTrack',p.scene.audioTracks);add('videoClip',p.scene.videoClips);for(const [key,type] of PERFORMANCE)add(type,p.scene.performance?.[key]);return result;
}
const executable=n=>['dialogue','command','title'].includes(n.type);
const semantic=n=>n.type==='title'?{type:n.type,text:n.text}:n.type==='dialogue'?{type:n.type,speaker:n.speaker,expression:n.expression??null,text:n.text}:{type:n.type,name:n.name,args:n.args};
function mapping(nodes,index){const covered=new Set();for(const n of nodes){const local=new Set();for(const o of n.objects){shape(o,['type','id']);const k=o.type+':'+o.id;if(!index.has(k)||local.has(k))throw Error('invalid object mapping');local.add(k);covered.add(k);}}if(covered.size!==index.size)throw Error('unmapped object');}
function analyzePreservation({text,config,source,report}={}){
 const fail=(code,message,error=false)=>({canPreserve:false,plan:null,preservedPages:[],diagnostics:[{severity:error?'error':'warning',code: error?code:'REIMPORT_RECOMPILE',message}]});
 try{
 if(source?.version!==3&&(source?.baselineProject?.resources?.some(r=>r.kind==='video')||source?.baselineProject?.scene?.videoClips?.length||source?.nodes?.some(n=>n.baseline?.type==='command'&&n.baseline.name==='视频')))return fail('VIDEO_RETURN_UNSUPPORTED','VIDEO_RETURN_UNSUPPORTED：视频工程不支持回接保留，须重新编排并保留原工程，不恢复部分时间轴。');
  const errors=validateSourceRecord(source);if(errors.length)return fail('PRESERVATION_INVALID_SOURCE',errors.join('\n'),true);
 if(typeof text!=='string'||!config||!report)return fail('PRESERVATION_INVALID_INPUT','缺少保留分析输入',true);
 const parsed=parseScript(text,{characters:config.characters,defaultLayout:config.defaultLayout});
 if(parsed.diagnostics.some(d=>d.severity==='error')||!eq(parsed.nodes,report.nodes)||(report.sourceHash!==undefined&&report.sourceHash!==require('./script-preflight.cjs').textHash(text)))return fail('PRESERVATION_INVALID_REPORT','预检节点或哈希与当前原文不一致',true);
 const fresh=parsed.nodes.filter(executable),old=source.nodes.filter(n=>executable(n.baseline));
 if((source.version===3&&!eq(config,source.config))||!eq(fresh.map(semantic),old.map(n=>semantic(n.baseline)))||!eq(config.characters,source.config.characters)||(config.defaultLayout??'双人')!==(source.config.defaultLayout??'双人'))return fail('REIMPORT_RECOMPILE','可执行语义、顺序或角色/布局配置已变化：此次重新编排，不自动沿用旧绝对帧；旧配音复核由 matcher 负责。');
 const identity=new Map(),stable=new Set();if(!Array.isArray(report.identities))throw Error('identities required');
 for(const r of report.identities){shape(r,['nodeId','stableId']);if(typeof r.stableId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.stableId)||identity.has(r.nodeId)||stable.has(r.stableId.toLowerCase())||!parsed.nodes.some(n=>n.id===r.nodeId))throw Error('non-unique identities');identity.set(r.nodeId,r.stableId.toLowerCase());stable.add(r.stableId.toLowerCase());}
 const pairs=fresh.map((n,i)=>{if(identity.get(n.id)!==old[i].stableId.toLowerCase())throw Error('executable UUID does not match source');return {nodeId:n.id,sourceNodeId:old[i].nodeId};});
 const bindings=new Map();for(const b of report.bindings||[]){if(bindings.has(b.nodeId)||!fresh.some(n=>n.type==='dialogue'&&n.id===b.nodeId))throw Error('invalid binding identity');bindings.set(b.nodeId,b);}
 for(const pair of pairs){const n=fresh.find(n=>n.id===pair.nodeId);if(n.type!=='dialogue')continue;const b=bindings.get(n.id),previous=source.bindings.find(b=>b.nodeId===pair.sourceNodeId);if(!b||!['matched','manual','unvoiced'].includes(b.status)||(b.status==='unvoiced'?b.resourceId!=null||previous.resourceId!=null:!b.resourceId||b.resourceId!==previous.resourceId))throw Error('voice binding is not confirmed as same resource/unvoiced');}
 const index=inventory(source.baselineProject);mapping(source.nodes,index);const preservedPages=[];
 for(const pair of pairs){const node=source.nodes.find(n=>n.nodeId===pair.sourceNodeId);if(node.baseline.type!=='dialogue')continue;const d=index.get('dialogue:'+node.objects.find(o=>o.type==='dialogue').id).object;if(!d.pages)continue;let cursor=0;const pages=d.pages.map(p=>{const text=p.text[source.baselineProject.locale],start=cursor;cursor+=text.length;return {start,end:cursor,text};});if(pages.map(p=>p.text).join('')!==node.baseline.text)throw Error('pages do not exactly cover source');preservedPages.push({nodeId:pair.nodeId,pages});}
 if(source.baselineProject.schemaVersion===4){const {validatePaginationPlan,LAYOUT}=require('./script-pagination-plan.cjs');const hash=require('./script-preflight.cjs').textHash(text);validatePaginationPlan({version:1,sourceHash:hash,layout:LAYOUT,dialogues:preservedPages},{nodes:parsed.nodes,sourceHash:hash},text,{});}
 const plan={version:1,text,config:clone(config),pairs,preservedPages};return {canPreserve:true,plan,preservedPages:clone(preservedPages),diagnostics:[{severity:'info',code:'REIMPORT_PRESERVED',message:'保留已有实际帧和采样裁剪；旧分页仍须真实字体测量验证。'}]};
 }catch(e){return fail('REIMPORT_RECOMPILE','无法安全保留：'+e.message+'；此次重新编排，不自动沿用绝对帧。');}
}
function applyPreservation({project,sourceMap,source,report,plan}={}){
 try{
 const analysis=analyzePreservation({text:plan?.text,config:plan?.config,source,report});if(!analysis.canPreserve||!eq(plan,analysis.plan))throw Error('plan stale/altered/not eligible');
 if(source.version===3){
  // Saved video cuts/restarts are authoritative; rebuilding can change topology.
  const before=source.baselineProject;
  if(project?.schemaVersion!==before.schemaVersion||project.locale!==before.locale||!eq(project.design,before.design)||validateProject(project).length)throw Error('invalid prepared project/schema/design/locale');
  inventory(project);
  const resources=new Map();for(const r of project.resources){if(resources.has(r.id))throw Error('duplicate prepared resource');resources.set(r.id,r);}
  if(resources.size!==before.resources.length)throw Error('prepared resource inventory differs');
  const withoutPath=r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='path'));
  for(const r of before.resources){const actual=resources.get(r.id);if(!actual||!eq(withoutPath(r),withoutPath(actual)))throw Error('prepared media differs from saved baseline');}
  const out=clone(before);delete out.scriptSource;out.id=project.id;out.resources=clone(project.resources);
  const mapped={};for(const n of report.nodes){const pair=plan.pairs.find(p=>p.nodeId===n.id),previous=pair?source.nodes.find(p=>p.nodeId===pair.sourceNodeId):null;mapped[n.id]={line:n.line,objects:previous?clone(previous.objects):[]};}
  mapping(report.nodes.map(n=>({objects:mapped[n.id].objects})),inventory(out));
  const errors=validateProject(out);if(errors.length)throw Error(errors.join('\n'));
  const evidence={...clone(source),text:plan.text,config:clone(plan.config),baselineProject:out,bindings:clone(report.bindings),nodes:report.nodes.map(n=>({stableId:report.identities.find(i=>i.nodeId===n.id)?.stableId,nodeId:n.id,baseline:clone(n),objects:clone(mapped[n.id].objects)}))};
  const sourceErrors=validateSourceRecord(evidence);if(sourceErrors.length)throw Error(sourceErrors.join('\n'));
  return {project:out,sourceMap:mapped,diagnostics:analysis.diagnostics};
 }
 const before=source.baselineProject,old=inventory(before),current=inventory(project),out=clone(project),target=inventory(out);
 if(project.schemaVersion!==before.schemaVersion||project.locale!==before.locale||!eq(project.design,before.design))throw Error('schema/design/locale changed');if(validateProject(project).length)throw Error('invalid input project');
 if(Object.keys(sourceMap).length!==report.nodes.length||report.nodes.some(n=>!own(sourceMap,n.id)))throw Error('sourceMap nodes differ');mapping(report.nodes.map(n=>({objects:sourceMap[n.id].objects})),current);
 const forward=new Map(),reverse=new Map();for(const pair of plan.pairs){const a=source.nodes.find(n=>n.nodeId===pair.sourceNodeId).objects,b=sourceMap[pair.nodeId].objects;
 for(const type of Object.keys(fields)){const aa=a.filter(o=>o.type===type),bb=b.filter(o=>o.type===type);if(aa.length!==bb.length)throw Error('object topology differs');for(let i=0;i<aa.length;i++){const ak=type+':'+aa[i].id,bk=type+':'+bb[i].id;if((forward.has(ak)&&forward.get(ak)!==bk)||(reverse.has(bk)&&reverse.get(bk)!==ak))throw Error('non-bijective mapping');forward.set(ak,bk);reverse.set(bk,ak);}}}
 if(forward.size!==old.size||reverse.size!==current.size)throw Error('unmapped/new object');const idMap=new Map([...forward].map(([a,b])=>[old.get(a).object.id,current.get(b).object.id]));
 const translate=v=>Array.isArray(v)?v.map(translate):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,['id','speakerId','definitionId','dialogueId','characterId'].includes(k)&&idMap.has(x)?idMap.get(x):translate(x)])):v;
 for(const [a,b] of forward){const {type,object:src}=old.get(a),dst=target.get(b).object,translated=translate(src),skip=new Set([...timing[type],...(type==='voiceClip'?['sourceDurationSamples']:[])]);
 for(const key of fields[type]){if(skip.has(key))continue;if(['expressionEvents','positionKeyframes','pages','voiceClips'].includes(key)){if(!eq((translated[key]||[]).map(x=>x.id),(dst[key]||[]).map(x=>x.id)))throw Error('child ownership/order differs');continue;}if(!eq(translated[key],dst[key]))throw Error('non-timing structure/resource differs: '+type+'.'+key);}
 for(const key of timing[type]){if(own(translated,key))dst[key]=clone(translated[key]);else delete dst[key];}
 if(type==='voiceClip'){const r=out.resources.find(r=>r.id===dst.resourceId);if(!r||r.sampleRate!==48000||!Number.isSafeInteger(r.durationSamples)||r.durationSamples<=0)throw Error('current voice probe missing');dst.sampleRate=r.sampleRate;if(own(dst,'sourceDurationSamples'))dst.sourceDurationSamples=r.durationSamples;}}
 if(!eq(before.scene.background,out.scene.background))throw Error('initial background differs');out.scene.durationFrames=before.scene.durationFrames;const errors=validateProject(out);if(errors.length)throw Error(errors.join('\n'));
 // Validate the resulting provenance as well, without retaining it on the project.
 const evidence={...clone(source),text:plan.text,config:clone(plan.config),baselineProject:out,bindings:clone(report.bindings),nodes:report.nodes.map(n=>({stableId:report.identities.find(i=>i.nodeId===n.id)?.stableId,nodeId:n.id,baseline:clone(n),objects:clone(sourceMap[n.id].objects)}))};
 const sourceErrors=validateSourceRecord(evidence);if(sourceErrors.length)throw Error(sourceErrors.join('\n'));
 return {project:out,sourceMap:clone(sourceMap),diagnostics:analysis.diagnostics};
 }catch(e){return {project:null,sourceMap:{},diagnostics:[{severity:'error',code:'PRESERVATION_APPLY_FAILED',message:'保留校验失败（未修改输入）：'+e.message}]};}
}
module.exports={analyzePreservation,applyPreservation};
