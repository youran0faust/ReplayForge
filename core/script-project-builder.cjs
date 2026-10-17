'use strict';
// Pure lowering; IDs and sourceMap describe this compilation, not stable reimport identity.
const {createHash}=require('node:crypto');
const {resolveAsset}=require('./script-asset-catalog.cjs');
const {validateProject}=require('./model.cjs');
const {validateReadingConfig,calculateReadingBudget,calculateRevealBudget}=require('./script-reading-budget.cjs');
const {validatePerformanceConfig,resolvePerformanceConfig}=require('./performance-config.cjs');
const layouts={单人:{中:50},双人:{左:30,右:70},三人:{左:20,中:50,右:80},四人:{左外:15,左内:38,右内:62,右外:85}};
const positions=Object.fromEntries(Object.entries(layouts).flatMap(([l,s])=>Object.entries(s).map(([k,x])=>[l+k,x])));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=o=>!!o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o));
const id=(kind,...parts)=>kind+'_'+createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,24);
const safePath=p=>typeof p==='string'&&!!p&&!/[\x00-\x1f:]/.test(p)&&!/^[/\\]/.test(p)&&!p.replaceAll('\\','/').split('/').some(s=>!s||s==='.'||s==='..');
/** media is already managed/probed. No I/O. Failure never returns a partial project. */
function buildScriptProject(input={}) {
 const diagnostics=[],sourceMap={};
 const add=(n,code,message,severity='error')=>diagnostics.push({severity,code,message,line:n?.line||1,column:n?.column||1,...(n?.id?{nodeId:n.id}:{})});
 const fail=()=>({project:null,sourceMap:{},diagnostics});
 try {
  const {report,config,media,title='剧本生成工程',schemaVersion=3,paginationPlan=[]}=input||{};
  if(!plain(report)||!Array.isArray(report.nodes)||!Array.isArray(report.assetCatalog)||!Array.isArray(report.bindings)||!plain(config)||!Array.isArray(config.characters)||!Array.isArray(media)||typeof title!=='string'||!title.trim()){add(null,'INVALID_INPUT','需要预检report、角色config、托管media数组和非空title');return fail();}
  for(const d of report.diagnostics||[])diagnostics.push({...d,severity:d.severity||d.level||'error',line:d.line||1,column:d.column||1});
  if(report.ok===false&&!diagnostics.some(d=>d.severity==='error'))add(null,'PREFLIGHT_FAILED','预检尚未通过');
  if(![3,4].includes(schemaVersion))add(null,'UNSUPPORTED_SCHEMA','builder仅支持schema3或schema4');
  if(schemaVersion===4)add(null,'SCHEMA4_SEMANTICS','使用schema4：说话人引用角色定义；字幕显示终点独立于对白和配音。','info');
  for(const error of [...validateReadingConfig(config),...validatePerformanceConfig(config)])add(null,error.code,error.message);
   const performanceConfig=resolvePerformanceConfig(config);
   const autoTiming=config.unvoicedTimingMode==='auto';
   if(autoTiming&&schemaVersion!==4)add(null,'AUTO_TIMING_REQUIRES_SCHEMA4','自动阅读时长需要schema4分页');
   const holdSeconds=config.dialoguePageHoldSeconds===undefined?0.6:config.dialoguePageHoldSeconds;
  if(!Number.isFinite(holdSeconds)||holdSeconds<0||holdSeconds>60)add(null,'INVALID_PAGE_HOLD_SECONDS','dialoguePageHoldSeconds须为0到60的有限秒数');
  const pageMax=config.dialoguePageMaxCharacters;
  if(pageMax!==undefined&&(!Number.isSafeInteger(pageMax)||pageMax<1||pageMax>1000))add(null,'INVALID_PAGE_MAX_CHARACTERS','dialoguePageMaxCharacters须为1到1000的整数');
  const segmenter=new Intl.Segmenter('zh-CN',{granularity:'grapheme'});
  const plans=new Map(),dialogueNodes=new Map(report.nodes.filter(n=>n?.type==='dialogue').map(n=>[n.id,n]));
  if(!Array.isArray(paginationPlan))add(null,'INVALID_PAGINATION_PLAN','分页plan须为数组');
  else for(const plan of paginationPlan){
   const n=dialogueNodes.get(plan?.nodeId);
   if(!plain(plan)||Object.keys(plan).some(k=>!['nodeId','pages'].includes(k))||!n||plans.has(plan.nodeId)||!Array.isArray(plan.pages)||!plan.pages.length){add(n,'INVALID_PAGINATION_PLAN','分页节点无效、重复或页数组为空');continue;}
   const boundaries=new Set([0,n.text.length]);for(const part of new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(n.text))boundaries.add(part.index);
   let end=0;
   for(const p of plan.pages){if(!plain(p)||Object.keys(p).some(k=>!['start','end','text'].includes(k))||!Number.isSafeInteger(p.start)||!Number.isSafeInteger(p.end)||p.start!==end||p.end<=p.start||p.end>n.text.length||!boundaries.has(p.start)||!boundaries.has(p.end)||typeof p.text!=='string'||!p.text.trim()||p.text!==n.text.slice(p.start,p.end))add(n,'INVALID_PAGINATION_PLAN','分页须连续exact覆盖原文且位于字素边界');if(pageMax!==undefined&&typeof p?.text==='string'&&Array.from(segmenter.segment(p.text)).length>pageMax)add(n,'PAGINATION_PAGE_TOO_LONG','分页字素数量超过dialoguePageMaxCharacters');end=p?.end;}
   if(end!==n.text.length)add(n,'INVALID_PAGINATION_PLAN','分页未完整覆盖原文');plans.set(plan.nodeId,plan.pages);
  }
  if(schemaVersion===4)for(const n of dialogueNodes.values())if(!plans.has(n.id))add(n,'PAGINATION_PLAN_REQUIRED','schema4每条对白都需要已验证分页plan（包括单页）');
  const seconds=config.unvoicedDurationSeconds??3;
  if(!Number.isFinite(seconds)||seconds<=0||seconds>3600)add(null,'INVALID_UNVOICED_DURATION','默认秒数须大于0且不超过3600');
  let layout=config.defaultLayout??'双人';
  if(!own(layouts,layout))add(null,'INVALID_LAYOUT','无效默认布局');
  const catalog=new Map(),resources=new Map(),characters=new Map(),bindings=new Map(),nodes=new Set();
  for(const a of report.assetCatalog){if(!plain(a)||typeof a.id!=='string'||!a.id||catalog.has(a.id)||!['image','audio','video'].includes(a.kind)||typeof a.relativePath!=='string')add(null,'INVALID_CATALOG','素材catalog身份、kind或路径无效/重复');else catalog.set(a.id,a);}
  // Only explicitly referenced, uniquely identified video derivatives may bypass catalog.
   const legalId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value);
   const derived=new Map();
   for(const m of media)if(plain(m)&&m.kind==='video'&&catalog.get(m.id)?.kind==='video'&&m.audioResourceId!==undefined){
    if(!legalId(m.audioResourceId)||catalog.has(m.audioResourceId)||derived.has(m.audioResourceId))add(null,'INVALID_MEDIA','视频派生音频id须合法且唯一，不能占用catalog身份');
    else derived.set(m.audioResourceId,m);
   }
   for(const m of media){
   if(!plain(m)||typeof m.id!=='string'||(!catalog.has(m.id)&&!derived.has(m.id))||resources.has(m.id)||m.kind!==(catalog.get(m.id)?.kind??'audio')||!safePath(m.path)){add(null,'INVALID_MEDIA','托管资源身份、kind或相对路径无效/重复');continue;}
   const fields=['id','kind','path','mime',...(m.kind==='image'?['width','height']:m.kind==='audio'?['sampleRate','channels','bitsPerSample','durationSamples']:m.kind==='video'?['width','height','fps','frameCount','normalizationVersion','audioResourceId']:[])];
   const r=Object.fromEntries(fields.filter(k=>own(m,k)).map(k=>[k,m[k]]));
   if(m.mime!==undefined&&(typeof m.mime!=='string'||!m.mime.trim()))add(null,'INVALID_MEDIA','mime须为非空字符串');
   if(m.kind==='image'&&['width','height'].some(k=>m[k]!==undefined&&(!Number.isSafeInteger(m[k])||m[k]<=0)))add(null,'INVALID_MEDIA','图片尺寸须为正整数');
   if(m.kind==='audio'&&(m.sampleRate!==48000||![1,2].includes(m.channels)||m.bitsPerSample!==16||!Number.isSafeInteger(m.durationSamples)||m.durationSamples<=0))add(null,'INVALID_AUDIO_MEDIA','音频须为已探测48kHz PCM16单/双声道且有真实正整数样本数');
   if(m.kind==='video'&&(schemaVersion!==4||!legalId(m.id)||m.mime!=='video/mp4'||!['width','height'].every(k=>Number.isSafeInteger(m[k])&&m[k]>0)||m.fps!==30||!Number.isSafeInteger(m.frameCount)||m.frameCount<1||m.frameCount>1800||m.normalizationVersion!==1))add(null,'INVALID_VIDEO_MEDIA','视频须为schema4规范化30fps MP4且1至1800帧');
    if(derived.has(m.id)&&(m.kind!=='audio'||m.mime!=='audio/wav'||m.channels!==2||m.durationSamples!==derived.get(m.id).frameCount*1600))add(null,'INVALID_VIDEO_AUDIO_MEDIA','视频派生音频须为精确N*1600样本的48k PCM16 stereo WAV');
    resources.set(m.id,r);
  }
  for(const key of derived.keys())if(!resources.has(key))add(null,'INVALID_VIDEO_AUDIO_MEDIA','视频派生音频资源缺失');
   for(const c of config.characters){if(!plain(c)||typeof c.name!=='string'||!c.name.trim()||characters.has(c.name)){add(null,'INVALID_CHARACTER_CONFIG','角色名无效或重复');continue;}characters.set(c.name,c);}
  for(const b of report.bindings){if(!plain(b)||typeof b.nodeId!=='string'||bindings.has(b.nodeId))add(null,'INVALID_BINDING','配音绑定身份无效或重复');else bindings.set(b.nodeId,b);}
  for(const n of report.nodes){if(!plain(n)||typeof n.id!=='string'||!n.id||nodes.has(n.id)||!Number.isSafeInteger(n.line)||n.line<1)add(n,'INVALID_NODE','节点身份/行号无效或重复');else nodes.add(n.id);}
  if(diagnostics.some(d=>d.severity==='error'))return fail();
  const project={schemaVersion,id:id('project',title,report.sourceHash,report.nodes),title,design:{width:960,height:540,fps:30},locale:'zh-CN',resources:[],characterDefinitions:[],scene:{id:id('scene',report.sourceHash),durationFrames:1,background:{kind:'color',color:'#182338'},backgroundEvents:[],characters:[],dialogues:[],audioTracks:[]}};
  const scene=project.scene,used=new Set(),definitions=new Map(),onstage=new Map(),origins=new Map();
  // evaluate reaches progress=1 at start+revealFrames-1; reserve this many
  // subsequent complete-display frames without extending the page or audio.
  const pageRevealFrames=duration=>duration-Math.min(Math.ceil(holdSeconds*project.design.fps),Math.floor(duration*.4),duration-1);
  let cursor=0,tail=0,bgm=null,lastDisplayed=null;
  const record=(n,type,objectId)=>sourceMap[n.id].objects.push({type,id:objectId});
  // Center reservations only: this does not detect swept-path collisions.
  const settleMoves=()=>{for(const [name,s] of onstage){if(s.exitEnd!==undefined&&s.exitEnd<=cursor){onstage.delete(name);continue;}if(s.opacityEnd<=cursor)delete s.opacityEnd;if(s.move&&s.move.end<=cursor){s.anchor=s.move.target;delete s.move;}}};
  const occupied=(anchor,except)=>[...onstage.values()].some(s=>s!==except&&(s.anchor===anchor||s.move?.target===anchor));
  const use=(resourceId,category,n)=>{
   const a=catalog.get(resourceId),r=resources.get(resourceId);
   if(!a||a.category!==category||!r){add(n,'RESOURCE_UNAVAILABLE',`资源未托管或类别不符：${resourceId}`);return null;}
   if(r.kind!==(category==='video'?'video':['voice','music','sfx'].includes(category)?'audio':'image')){add(n,'RESOURCE_KIND_MISMATCH','资源kind不符合用途');return null;}
   used.add(resourceId);return r;
  };
  const resolve=(category,ref,n)=>{const match=resolveAsset(report.assetCatalog,category,ref);if(match.status!=='matched'){add(n,'RESOURCE_'+match.status.toUpperCase(),`素材引用${match.status}：${ref}`);return null;}return use(match.candidates[0].id,category,n);};
  const definition=(name,n,visual=false)=>{
   if(definitions.has(name)&&(!visual||definitions.get(name).image))return definitions.get(name);
   const c=characters.get(name);if(!c||name==='旁白'){add(n,'UNKNOWN_CHARACTER','角色未登记或旁白不可出场：'+name);return null;}
   if(visual&&(typeof c.image!=='string'||!c.image.trim())){add(n,'CHARACTER_IMAGE_REQUIRED','角色出场必须配置image：'+name);return null;}
    const image=visual?resolve('character',c.image,n):null;if(visual&&!image)return null;
   const existing=definitions.get(name),d=existing?.definition||{id:id('definition',name),name,color:'#ffffff',expressions:[]};if(image)d.resourceId=image.id;
    if(visual){
   if(c.expressionImages!==undefined&&!plain(c.expressionImages)){add(n,'INVALID_EXPRESSION_IMAGES','expressionImages须为name到引用的对象');return null;}
   for(const [name,ref] of Object.entries(c.expressionImages||{})){if(!name.trim()){add(n,'INVALID_EXPRESSION_IMAGES','表情名不能为空');continue;}const r=resolve('character',ref,n);if(r)d.expressions.push({id:id('expression',c.name,name),name,mode:'replace',resourceId:r.id});}
   if(c.defaultExpression!==undefined&&!d.expressions.some(e=>e.name===c.defaultExpression))add(n,'DEFAULT_EXPRESSION_MISSING','defaultExpression缺少有效图片映射：'+c.defaultExpression);
   }
    const info=existing||{config:c,definition:d,image};info.image=image;definitions.set(c.name,info);if(!existing)project.characterDefinitions.push(d);record(n,'characterDefinition',d.id);return info;
  };
  const omit=(objectId,type)=>{for(const map of Object.values(sourceMap))map.objects=map.objects.filter(o=>o.id!==objectId||o.type!==type);};
  const event=(list,value,n,type)=>{const old=list.findIndex(e=>e.frame===value.frame);if(old>=0){omit(list[old].id,type);list.splice(old,1);add(n,'STATE_EVENT_REPLACED','同帧状态按源码顺序覆盖前一状态','warning');}list.push(value);origins.set(value.id,n);record(n,type,value.id);};
  const expression=(instance,info,name,n)=>{
   const requested=name??info.config.defaultExpression,ex=requested===undefined?null:info.definition.expressions.find(e=>e.name===requested);
   if(requested!==undefined&&!ex){add(n,requested===info.config.defaultExpression?'DEFAULT_EXPRESSION_MISSING':'EXPRESSION_MAPPING_MISSING','表情缺少图片映射：'+requested);return;}
   event(instance.expressionEvents,{id:id('expressionEvent',n.id,instance.id),frame:cursor,expressionId:ex?.id??null},n,'expressionEvent');
  };
  const performanceList=key=>{scene.performance||={version:1};return scene.performance[key]||=[];};
   const interval=(key,type,value,n)=>{const entry={id:id(type,n.id,value.startFrame),...value};performanceList(key).push(entry);record(n,type,entry.id);return entry;};
   const durationFrames=(value,n,min=1)=>{const frames=Math.max(min,Math.round(value*30));if(typeof value!=='number'||!Number.isFinite(value)||value<=0||!Number.isSafeInteger(frames)||!Number.isSafeInteger(cursor+frames)){add(n,'INVALID_DURATION','演出须有正有限时长且累计帧数为安全整数');return null;}return frames;};
   const advance=(end,simultaneous=false)=>{tail=Math.max(tail,end);if(!simultaneous){cursor=end;if(lastDisplayed)lastDisplayed.displayUntilFrame=cursor;}};
   const screenState=()=>{const last=scene.performance?.screenFades?.at(-1);return {active:!!last&&last.endFrame>cursor,opacity:last?.to??0};};
   const stopMusic=(n,fadeSeconds=performanceConfig.bgmFadeOutSeconds,endFrame=cursor)=>{if(!bgm)return;const duration=Math.min(bgm.resource.durationSamples,(endFrame-bgm.track.startFrame)*1600);if(duration>0){bgm.track.durationSamples=duration;if(schemaVersion===4){const fade=Math.min(Math.round(fadeSeconds*48000),duration);if(fade>0)bgm.track.fadeOutSamples=fade;}scene.audioTracks.push(bgm.track);record(bgm.node,'audioTrack',bgm.track.id);if(n.id!==bgm.node.id)record(n,'audioTrack',bgm.track.id);}else add(n,'ZERO_LENGTH_AUDIO_OMITTED','同帧音乐被停止/替换，无零长音轨写入','warning');bgm=null;};
  for(const n of report.nodes){
   settleMoves();
   Object.defineProperty(sourceMap,n.id,{value:{line:n.line,objects:[]},enumerable:true,writable:true,configurable:true});
   if(['section','comment'].includes(n.type))continue;
   if(n.type==='dialogue'){
    if(typeof n.text!=='string'||!n.text.trim()){add(n,'EMPTY_DIALOGUE','对白不能为空');continue;}
     if(schemaVersion!==4&&(Array.from(n.text).length>80||(n.text.match(/[\r\n]/g)||[]).length>2)){add(n,'AUTO_PAGINATION_PENDING','long text requires pagination');continue;}
     if(schemaVersion===4&&lastDisplayed&&lastDisplayed.displayUntilFrame<cursor)lastDisplayed.displayUntilFrame=cursor;
      const stage=onstage.get(n.speaker);
     const info=n.speaker!=='旁白'?definition(n.speaker,n):null;
     if(n.speaker!=='旁白'&&!info)continue;
      if(schemaVersion!==4&&n.speaker!=='旁白'&&!stage){add(n,'OFFSTAGE_DIALOGUE_UNSUPPORTED','offstage dialogue requires schema4');continue;}
    if(n.speaker==='旁白'&&n.expression){add(n,'NARRATOR_EXPRESSION_UNSUPPORTED','旁白不能使用表情');continue;}
    const b=bindings.get(n.id);
    if(!b||!['matched','manual','unvoiced'].includes(b.status)||(b.status==='unvoiced'&&b.resourceId!=null)){add(n,'VOICE_BINDING_UNRESOLVED','对白需要确认的配音或显式无配音绑定');continue;}
    let voice=null;if(b.status!=='unvoiced'){voice=use(b.resourceId,'voice',n);if(!voice)continue;}
    if(stage)expression(stage.instance,stage.info,n.expression,n);
    // Round the per-page reading budget first; voice remains one parent clip.
     const pageCount=schemaVersion===4?plans.get(n.id).length:1;
     const perPageFrames=Math.max(1,Math.ceil(seconds*30));
     const autoBudgets=!voice&&autoTiming?plans.get(n.id).map(p=>calculateReadingBudget(p.text,config)):null;
      const frames=voice?Math.max(1,Math.ceil(voice.durationSamples/1600)):autoBudgets?autoBudgets.reduce((sum,b)=>sum+b.frames,0):perPageFrames*pageCount;
     if(!Number.isSafeInteger(frames)||frames<1||!Number.isSafeInteger(cursor+frames)){add(n,'INVALID_DURATION','对白累计帧数超过安全整数范围');continue;}
    const planned=plans.get(n.id)||[];
     if(schemaVersion===4&&planned.length>frames){add(n,'PAGINATION_EXCEEDS_FRAMES','分页数量不可超过对白帧数；不得拉长声音');continue;}
     if(schemaVersion===4&&!stage&&n.expression&&n.speaker!=='旁白')add(n,'EXPRESSION_OFFSTAGE','画外音表情不应用也不导入图片','warning');
     const d={id:id('dialogue',n.id),speakerId:schemaVersion===4?(n.speaker==='旁白'?'narrator':info.definition.id):(stage?.instance.id??'narrator'),startFrame:cursor,endFrame:cursor+frames,...(schemaVersion===4?{displayUntilFrame:cursor+frames}:{}),revealFrames:schemaVersion!==4&&config.dialogueRevealCharactersPerSecond!==undefined?calculateRevealBudget(n.text,frames,{speed:config.dialogueRevealCharactersPerSecond,holdSeconds}).revealFrames:1,text:{'zh-CN':n.text},voiceClips:[]}; if(schemaVersion===4&&planned.length){let pageCursor=cursor;d.pages=planned.map((p,i)=>{const duration=autoBudgets?autoBudgets[i].frames:Math.floor(frames*(i+1)/planned.length)-Math.floor(frames*i/planned.length),page={id:id('page',n.id,i),text:{'zh-CN':p.text},startFrame:pageCursor,endFrame:pageCursor+duration,revealFrames:autoBudgets?autoBudgets[i].revealFrames:config.dialogueRevealCharactersPerSecond!==undefined?calculateRevealBudget(p.text,duration,{speed:config.dialogueRevealCharactersPerSecond,holdSeconds}).revealFrames:pageRevealFrames(duration)};pageCursor+=duration;return page;});d.text=d.pages[0].text;d.fullText={'zh-CN':n.text};for(const page of d.pages)record(n,'dialoguePage',page.id);}
    if(voice){const clip={id:id('voice',n.id),resourceId:voice.id,sampleRate:48000,durationSamples:voice.durationSamples,sourceOffsetSamples:0,binding:{dialogueId:d.id,mode:'follow',followOffsetFrames:0}};d.voiceClips.push(clip);record(n,'voiceClip',clip.id);}
    scene.dialogues.push(d);lastDisplayed=d;record(n,'dialogue',d.id);cursor+=frames;continue;
   }
   if(n.type==='title'&&schemaVersion===4){
    if(typeof n.text!=='string'||!n.text.trim()||n.text.length>4096){add(n,'INVALID_TITLE','标题须为非空文字且不超过4096字符');continue;}
    const parts=['titleFadeInSeconds','titleHoldSeconds','titleFadeOutSeconds'].map(k=>performanceConfig[k]===0?0:Math.max(1,Math.round(performanceConfig[k]*30))),frames=parts.reduce((a,b)=>a+b,0);
    if(!Number.isSafeInteger(frames)||frames<=0||!Number.isSafeInteger(cursor+frames)){add(n,'INVALID_DURATION','标题累计帧数无效');continue;}
    interval('titles','title',{startFrame:cursor,endFrame:cursor+frames,fadeInFrames:parts[0],fadeOutFrames:parts[2],text:n.text},n);advance(cursor+frames);continue;
   }
   if(n.type!=='command'){add(n,'UNSUPPORTED_NODE','当前不支持节点：'+n.type);continue;}
   const a=n.args||{},allowed={移动:['角色','位置','时长','同时'],出场:['角色','位置','表情','演出',...(schemaVersion===4?['时长','同时']:[])],退场:['角色','演出',...(schemaVersion===4?['时长','同时']:[])],背景:['文件','转场',...(schemaVersion===4?['时长','同时']:[])],停顿:['时长','保留'],布局:['布局'],表情:['角色','表情'],音乐:['文件','动作',...(schemaVersion===4?['时长']:[])],音效:['文件'],...(schemaVersion===4?{视频:['文件'],画面:['动作','时长','同时'],清字幕:[],对白框:['动作'],隐藏对白框:[],显示对白框:[]}: {})}[n.name];
   if(!Array.isArray(allowed)){add(n,'UNSUPPORTED_COMMAND',`当前生成子集不支持@${n.name}；标题、视频及复杂演出不静默忽略`);continue;}
   if(!plain(a)||Object.keys(a).some(k=>!allowed.includes(k))||(a.演出!==undefined&&!(schemaVersion===4?['无',n.name==='出场'?'淡入':'淡出']:['无']).includes(a.演出))||(a.转场!==undefined&&!(schemaVersion===4?['无','黑屏']:['无']).includes(a.转场))||(a.同时!==undefined&&typeof a.同时!=='boolean')){add(n,'UNSUPPORTED_PARAMETER',`@${n.name}含当前命令未支持的参数或演出；基础移动仅支持命名位置、时长及同时`);continue;}
   if(['出场','退场'].includes(n.name)&&(a.时长!==undefined||a.同时!==undefined)&&(!a.演出||a.演出==='无')){add(n,'UNSUPPORTED_PARAMETER','时长/同时需要显式淡入或淡出演出');continue;}
   if(n.name==='视频'){
     const r=resolve('video',a.文件,n);if(!r)continue;
     if(!Number.isSafeInteger(cursor+r.frameCount)){add(n,'INVALID_DURATION','视频累计帧数超过安全整数');continue;}
     const startSample=cursor*1600;
     // Hard cut every existing ordinary clip. Removing a zero-length object also
     // removes all source owners, without changing dialogue text/pages/bindings.
     const cut=(clips,startOf,type)=>clips.filter(clip=>{
      const length=Math.min(clip.durationSamples,Math.max(0,startSample-startOf(clip)));
      if(length===0){omit(clip.id,type);return false;}
      clip.durationSamples=length;if(clip.fadeOutSamples!==undefined)clip.fadeOutSamples=Math.min(clip.fadeOutSamples,length);return true;
     });
     for(const d of scene.dialogues)d.voiceClips=cut(d.voiceClips,c=>c.binding.mode==='follow'?(d.startFrame+(c.binding.followOffsetFrames||0))*1600:c.binding.startFrame*1600,'voiceClip');
     scene.audioTracks=cut(scene.audioTracks,t=>t.startFrame*1600,'audioTrack');
     const resume=bgm&&startSample<bgm.track.startFrame*1600+bgm.resource.durationSamples?{node:bgm.node,resource:bgm.resource,name:bgm.track.name}:null;
     if(bgm)stopMusic(bgm.node,0);
     const clip={id:id('videoClip',n.id),resourceId:r.id,startFrame:cursor,endFrame:cursor+r.frameCount};
     (scene.videoClips||=[]).push(clip);record(n,'videoClip',clip.id);
     if(r.audioResourceId)used.add(r.audioResourceId);
     advance(clip.endFrame);
     if(resume)bgm={node:resume.node,resource:resume.resource,track:{id:id('audioTrack',resume.node.id,'videoRestart',n.id),name:resume.name,kind:'bgm',resourceId:resume.resource.id,startFrame:cursor,durationSamples:resume.resource.durationSamples,sourceOffsetSamples:0,gain:1}};
     continue;
    }
    if(n.name==='清字幕'){event(performanceList('dialogueClears'),{id:id('dialogueClear',n.id),frame:cursor},n,'dialogueClear');lastDisplayed=null;continue;}
   if(['对白框','隐藏对白框','显示对白框'].includes(n.name)){const action=n.name==='对白框'?a.动作:n.name==='隐藏对白框'?'隐藏':'显示';if(!['显示','隐藏'].includes(action)){add(n,'UNSUPPORTED_PARAMETER','对白框动作须为显示或隐藏');continue;}event(performanceList('dialogueVisibility'),{id:id('dialogueVisibility',n.id),frame:cursor,visible:action==='显示'},n,'dialogueVisibility');continue;}
   if(n.name==='画面'){if(!['淡入','淡出'].includes(a.动作)){add(n,'UNSUPPORTED_PARAMETER','画面动作须为淡入或淡出');continue;}const frames=durationFrames(a.时长===undefined?performanceConfig.screenFadeSeconds:a.时长,n);if(frames===null)continue;const state=screenState();if(state.active){add(n,'ACTION_IN_PROGRESS','画面遮罩淡变尚未完成');continue;}interval('screenFades','screenFade',{startFrame:cursor,endFrame:cursor+frames,from:state.opacity,to:a.动作==='淡出'?1:0},n);advance(cursor+frames,a.同时);continue;}
   if(n.name==='停顿'){if(schemaVersion!==4){add(n,'UNSUPPORTED_COMMAND','停顿需要schema4');continue;}if(!Number.isFinite(a.时长)||a.时长<0||!Number.isSafeInteger(cursor+Math.round(a.时长*30))){add(n,'INVALID_DURATION','停顿时长无效');continue;}if(a.保留!==undefined&&typeof a.保留!=='boolean'){add(n,'UNSUPPORTED_PARAMETER','保留须为boolean');continue;}if(a.保留===false&&lastDisplayed){lastDisplayed.displayUntilFrame=cursor;lastDisplayed=null;}cursor+=Math.round(a.时长*30);if(lastDisplayed)lastDisplayed.displayUntilFrame=cursor;continue;}
    if(n.name==='布局'){if(!own(layouts,a.布局))add(n,'INVALID_LAYOUT','无效布局');else layout=a.布局;continue;}
   if(n.name==='移动'){
    if(a.同时!==undefined&&typeof a.同时!=='boolean'){add(n,'UNSUPPORTED_PARAMETER','同时须为boolean');continue;}
    const frames=Math.max(1,Math.round(a.时长*project.design.fps));
    if(!Number.isFinite(a.时长)||a.时长<=0||!Number.isSafeInteger(frames)||!Number.isSafeInteger(cursor+frames)){add(n,'INVALID_DURATION','移动须有正有限时长且累计帧数为安全整数');continue;}
    const s=onstage.get(a.角色);
    if(!s||a.角色==='旁白'){add(n,'MOVE_OFFSTAGE','移动角色必须在场且不可为旁白');continue;}
    if(s.move||s.exitEnd!==undefined){add(n,'ACTION_IN_PROGRESS','同角色上一移动或退场尚未完成');continue;}
    let position=a.位置;if(!own(positions,position)&&own(layouts[layout],position))position=layout+position;
    if(!own(positions,position)){add(n,'POSITION_UNAVAILABLE','移动仅支持命名槽位，不支持坐标');continue;}
    const target=positions[position];if(occupied(target,s)){add(n,'POSITION_OVERLAP','目标中心槽已占用或预占（不检测运动路径碰撞）');continue;}
    const c=s.instance,keys=c.positionKeyframes||=[];
    // A seam is one key with two source owners. Never use event()/omit():
    // replacing a previous end would destroy the previous movement's evidence.
    let start=keys.find(k=>k.frame===cursor);
    if(start)start.interpolation='linear';
    else {start={id:id('positionKeyframe',n.id,c.id,'start'),frame:cursor,x:960*s.anchor/100-c.width/2,y:c.y,interpolation:'linear'};keys.push(start);}
    const end={id:id('positionKeyframe',n.id,c.id,'end'),frame:cursor+frames,x:960*target/100-c.width/2,y:c.y,interpolation:'hold'};
    keys.push(end);record(n,'positionKeyframe',start.id);record(n,'positionKeyframe',end.id);
    s.move={end:end.frame,target};tail=Math.max(tail,end.frame);
    if(!a.同时){cursor=end.frame;if(schemaVersion===4&&lastDisplayed)lastDisplayed.displayUntilFrame=cursor;}
    continue;
   }
   if(n.name==='出场'){
    if(onstage.has(a.角色)){add(n,'DUPLICATE_ENTRANCE','角色已在场，重复出场被拒绝');continue;}
    const info=definition(a.角色,n,true);if(!info)continue;
    let position=a.位置;
    if(position===undefined)position=Object.keys(layouts[layout]).map(s=>layout+s).find(s=>!occupied(positions[s]));
    else if(!own(positions,position)&&own(layouts[layout],position))position=layout+position;
    if(!position||!own(positions,position)){add(n,'POSITION_UNAVAILABLE','站位无效或默认布局无空槽');continue;}
    const anchor=positions[position];if(occupied(anchor)){add(n,'POSITION_OVERLAP','站位脚底中心与在场角色重叠（含跨布局）');continue;}
    const height=360,width=info.image.width&&info.image.height?Math.min(8192,height*info.image.width/info.image.height):240;
    const instance={id:id('instance',n.id,a.角色),definitionId:info.definition.id,x:960*anchor/100-width/2,y:540*.9-height,width,height,visibleFrom:cursor,visibleTo:cursor,expressionEvents:[]};
    scene.characters.push(instance);origins.set(instance.id,n);const stage={instance,info,anchor};onstage.set(a.角色,stage);record(n,'characterInstance',instance.id);expression(instance,info,a.表情,n);
    if(a.演出==='淡入'){const frames=durationFrames(a.时长===undefined?performanceConfig.characterFadeSeconds:a.时长,n);if(frames===null)continue;stage.opacityEnd=cursor+frames;interval('characterOpacity','characterOpacity',{characterId:instance.id,startFrame:cursor,endFrame:stage.opacityEnd,from:0,to:1},n);advance(stage.opacityEnd,a.同时);}continue;
   }
   if(n.name==='退场'){const s=onstage.get(a.角色);if(!s){add(n,'EXIT_OFFSTAGE','角色当前未在场');continue;}if(s.move||s.opacityEnd!==undefined||s.exitEnd!==undefined){add(n,'ACTION_IN_PROGRESS','移动或透明度演出完成前不可退场');continue;}
    if(a.演出==='淡出'){const frames=durationFrames(a.时长===undefined?performanceConfig.characterFadeSeconds:a.时长,n);if(frames===null)continue;s.exitEnd=cursor+frames;s.opacityEnd=s.exitEnd;s.instance.visibleTo=s.exitEnd;record(n,'characterInstance',s.instance.id);interval('characterOpacity','characterOpacity',{characterId:s.instance.id,startFrame:cursor,endFrame:s.exitEnd,from:1,to:0},n);advance(s.exitEnd,a.同时);continue;}
    if(cursor<=s.instance.visibleFrom){add(n,'ZERO_LENGTH_INSTANCE','出场至退场必须至少1帧；瞬时命令不耗时');continue;}s.instance.visibleTo=cursor;record(n,'characterInstance',s.instance.id);onstage.delete(a.角色);continue;}
   if(n.name==='表情'){const s=onstage.get(a.角色);if(!s)add(n,'EXPRESSION_OFFSTAGE','未在场角色不应用表情也不导入图片',schemaVersion===4?'warning':'error');else if(typeof a.表情!=='string')add(n,'EXPRESSION_MAPPING_MISSING','表情名缺失');else expression(s.instance,s.info,a.表情,n);continue;}
   if(n.name==='背景'){
    if(a.转场!=='黑屏'&&(a.时长!==undefined||a.同时!==undefined)){add(n,'UNSUPPORTED_PARAMETER','背景时长/同时仅用于黑屏转场，转场必须阻塞');continue;}
    if(a.转场==='黑屏'){
     if(a.同时===true){add(n,'UNSUPPORTED_PARAMETER','黑屏背景转场必须阻塞');continue;}
     const frames=durationFrames(a.时长===undefined?1:a.时长,n,2);if(frames===null)continue;
     const state=screenState();if(state.active||state.opacity!==0){add(n,'SCREEN_TRANSITION_CONFLICT','黑屏转场要求当前遮罩为0且无活动淡变');continue;}
     const r=resolve('background',a.文件,n);if(!r)continue;const mid=cursor+Math.floor(frames/2),end=cursor+frames;
     interval('screenFades','screenFade',{startFrame:cursor,endFrame:mid,from:0,to:1},n);event(scene.backgroundEvents,{id:id('backgroundEvent',n.id),frame:mid,background:{kind:'image',resourceId:r.id}},n,'backgroundEvent');interval('screenFades','screenFade',{startFrame:mid,endFrame:end,from:1,to:0},n);advance(end);continue;
    }
    const r=resolve('background',a.文件,n);if(r)event(scene.backgroundEvents,{id:id('backgroundEvent',n.id),frame:cursor,background:{kind:'image',resourceId:r.id}},n,'backgroundEvent');continue;
   }
   if(n.name==='音效'){const r=resolve('sfx',a.文件,n);if(!r)continue;const track={id:id('audioTrack',n.id),name:a.文件,kind:'sfx',resourceId:r.id,startFrame:cursor,durationSamples:r.durationSamples,sourceOffsetSamples:0,gain:1};scene.audioTracks.push(track);record(n,'audioTrack',track.id);continue;}
   if(n.name==='音乐'){
    if(a.时长!==undefined&&(a.动作!=='停止'||a.文件!==undefined)){add(n,'UNSUPPORTED_PARAMETER','音乐时长仅用于显式停止的末尾淡出');continue;}
     if(a.时长!==undefined&&(typeof a.时长!=='number'||!Number.isFinite(a.时长)||a.时长<0||!Number.isSafeInteger(Math.round(a.时长*48000)))){add(n,'INVALID_DURATION','音乐淡出时长须为非负有限秒数且对应安全整数样本');continue;}
     if(a.动作==='停止'&&a.文件===undefined){stopMusic(n,a.时长);if(schemaVersion!==4)add(n,'BGM_HARD_STOP_INITIAL_SLICE','首版显式停止为硬停止，未实现淡出','warning');continue;}
    if(a.动作!==undefined||!a.文件){add(n,'INVALID_MUSIC','音乐须指定文件或停止');continue;}
    const r=resolve('music',a.文件,n);if(!r)continue;stopMusic(n);bgm={node:n,resource:r,track:{id:id('audioTrack',n.id),name:a.文件,kind:'bgm',resourceId:r.id,startFrame:cursor,durationSamples:r.durationSamples,sourceOffsetSamples:0,gain:1}};
   }
  }
  // Recompute audio tail after hard cuts; motion/performance tail is independent.
   const audioTail=Math.max(0,...scene.audioTracks.map(t=>t.startFrame+Math.ceil(t.durationSamples/1600)),...scene.dialogues.flatMap(d=>d.voiceClips.map(c=>d.startFrame+Math.ceil(c.durationSamples/1600))));
   tail=Math.max(tail,audioTail);
   if(bgm&&schemaVersion===4)stopMusic(bgm.node,undefined,Math.max(cursor,tail));
   if(bgm)add(bgm.node,'BGM_FADE_PENDING','片尾BGM淡出未实现；首版必须显式@音乐 停止，不以整曲拉长场景');
  scene.durationFrames=Math.max(cursor,tail);if(schemaVersion===4&&lastDisplayed&&lastDisplayed.displayUntilFrame<scene.durationFrames)lastDisplayed.displayUntilFrame=scene.durationFrames;if(scene.durationFrames<=0)add(null,'EMPTY_TIMELINE','工程必须含正时长对白或一次性音效');
  for(const {instance,exitEnd} of onstage.values())instance.visibleTo=exitEnd??scene.durationFrames;
  scene.characters=scene.characters.filter(c=>{if(c.visibleTo>c.visibleFrom)return true;add(origins.get(c.id),'TERMINAL_STATE_OMITTED','片尾出场无可见帧，未写入零长实例','warning');omit(c.id,'characterInstance');for(const e of c.expressionEvents)omit(e.id,'expressionEvent');return false;});
  const prune=(events,type,end)=>events.filter(e=>{if(e.frame<end)return true;add(origins.get(e.id),'TERMINAL_STATE_OMITTED','末端状态没有可见帧，未写入画面事件','warning');omit(e.id,type);return false;});
  scene.backgroundEvents=prune(scene.backgroundEvents,'backgroundEvent',scene.durationFrames);
   for(const [key,type] of [['dialogueVisibility','dialogueVisibility'],['dialogueClears','dialogueClear']])if(scene.performance?.[key])scene.performance[key]=prune(scene.performance[key],type,scene.durationFrames);
  for(const c of scene.characters)c.expressionEvents=prune(c.expressionEvents,'expressionEvent',c.visibleTo);
  project.resources=[...used].sort().map(key=>{const r=resources.get(key);if(r.kind==='video')return {...r};const {width,height,...resource}=r;return resource;});
  if(diagnostics.some(d=>d.severity==='error'))return fail();
  for(const error of validateProject(project))add(null,'PROJECT_VALIDATION_FAILED',error);
  return diagnostics.some(d=>d.severity==='error')?fail():{project,sourceMap,diagnostics};
 }catch(error){add(null,'INVALID_INPUT',`生成失败：${error.message}`);return fail();}
}
module.exports={buildScriptProject};
