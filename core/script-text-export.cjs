'use strict';
// Pure source projection; no I/O, asset execution, or project mutation.
const {parseScript}=require('./script-parser.cjs');
const {isDeepStrictEqual:equal}=require('node:util');
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const ptr=(p,k)=>p+'/'+String(k).replace(/~/g,'~0').replace(/\//g,'~1');
function differences(a,b,p='',out=[]) {
 if(equal(a,b))return out;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)) {
  for(const k of new Set([...Object.keys(a),...Object.keys(b)])) {
   if(!own(a,k)||!own(b,k))out.push({path:ptr(p,k),before:a[k],after:b[k]});
   else differences(a[k],b[k],ptr(p,k),out);
  }
 }else out.push({path:p,before:a,after:b});
 return out;
}
function indexProject(p) {
 const map=new Map();
 const add=(type,v,path,parent)=>{if(!v||typeof v.id!=='string')return;const key=type+':'+v.id;if(map.has(key))throw Error('重复对象身份 '+key);map.set(key,{value:v,path,parent});};
 (p.characterDefinitions||[]).forEach((d,i)=>add('characterDefinition',d,`/characterDefinitions/${i}`));
 for(const [key,type] of [['dialogues','dialogue'],['characters','characterInstance'],['backgroundEvents','backgroundEvent'],['audioTracks','audioTrack'],['videoClips','videoClip']])
 (p.scene?.[key]||[]).forEach((v,i)=>{const path=`/scene/${key}/${i}`;add(type,v,path);for(const [field,t] of [['pages','dialoguePage'],['voiceClips','voiceClip'],['expressionEvents','expressionEvent'],['positionKeyframes','positionKeyframe']]) (v[field]||[]).forEach((e,j)=>add(t,e,`${path}/${field}/${j}`,v));});
 for(const [key,type] of [['characterOpacity','characterOpacity'],['screenFades','screenFade'],['dialogueVisibility','dialogueVisibility'],['dialogueClears','dialogueClear'],['titles','title']]) (p.scene?.performance?.[key]||[]).forEach((v,i)=>add(type,v,`/scene/performance/${key}/${i}`));
 return map;
}
const positions={单人中:50,双人左:30,双人右:70,三人左:20,三人中:50,三人右:80,四人左外:15,四人左内:38,四人右内:62,四人右外:85};
function quote(v){if(typeof v==='number')return `${v}s`;if(typeof v==='boolean')return v?'是':'否';if(typeof v!=='string'||/[\r\n\0]/.test(v))throw Error('参数无法表达');if(!/[\s()（）,，="\\]/.test(v))return v;return '"'+v.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';}
function command(n){return '@'+n.name+Object.entries(n.args).map(([k,v])=>' '+k+'='+quote(v)).join('');}
function dialogue(n,raw,eol) {
 if(typeof n.speaker!=='string'||!n.speaker.trim()||/[\r\n:：\[\]［］]/.test(n.speaker)||n.speaker!==n.speaker.trim())throw Error('角色名无法表达');
 if(n.expression!=null&&(typeof n.expression!=='string'||!n.expression.trim()||/[\r\n\[\]［］]/.test(n.expression)))throw Error('表情名无法表达');
 if(typeof n.text!=='string'||!n.text.trim()||n.text.includes('\r'))throw Error('正文无法表达');
 const parts=n.text.split('\n'),first=n.speaker+(n.expression?'['+n.expression+']':'')+'：'+parts.shift();
 // Keep comment/blank lines inside parser dialogue.raw; escape all continuations.
 const result=[first];
 for(const line of raw.split(/\r\n|\n|\r/).slice(1)) {
  if(!line.trim()||line.trimStart().startsWith('//'))result.push(line);
  else if(parts.length)result.push('\\'+parts.shift());
 }
 result.push(...parts.map(s=>'\\'+s));return result.join(eol);
}
function exportScriptText(project) {
 const losses=[],changes=[];
 const loss=(code,path,message,extra={})=>losses.push({code,path,message,...extra});
 const reject=message=>({ok:false,text:null,losses:[{code:'SOURCE_REQUIRED',path:'/scriptSource',message}],changes:[],lossless:false,scope:'supported-script-text'});
 const source=project?.scriptSource;
 if(!source)return reject('没有来源记录；拒绝本轮TXT回接，不从时间轴猜测剧本。');
 if(![1,2,3].includes(source.version)||typeof source.text!=='string'||!Array.isArray(source.nodes)||!source.baselineProject||typeof source.baselineProject!=='object')return reject('来源记录不完整或版本不支持；拒绝猜测。');
  if((source.version===2||source.version===3)&&require('./script-source-record.cjs').validateSourceRecord(source).length)return reject('媒体来源记录校验失败；拒绝猜测。');
 try {
 const current={...project};delete current.scriptSource;
 const base={...source.baselineProject};delete base.scriptSource;
 const oldIndex=indexProject(base),nowIndex=indexProject(current),covered=new Set(),patches=[];
  if([base,current].some(p=>p.resources?.some(r=>r.kind==='video')||p.scene?.videoClips?.length)||source.nodes.some(n=>n.baseline?.type==='command'&&n.baseline.name==='视频')){
   if(source.version!==3)loss('VIDEO_RETURN_UNSUPPORTED','/scene/videoClips','旧来源视频须先经可信媒体校验升级回接记录；TXT仅保留原@视频与批注，请保留原工程。');
    else loss('VIDEO_MAP_REQUIRED','/scene/videoClips','视频回接需配套v3映射和托管MP4/WAV；纯TXT不包含这些媒体与时间轴证据。');
   loss('VIDEO_TIMELINE_NOT_EXPRESSIBLE','/scene/videoClips','纯TXT不能重现规范化视频及其截断/重启音频时间轴；不推导托管内部路径。');
  }
 const sourceParsed=parseScript(source.text,{defaultLayout:source.config?.defaultLayout}),lines=source.text.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/),endings=source.text.match(/\r\n|\n|\r/g)||[],offsets=[];
 let offset=source.text.startsWith('\uFEFF')?1:0;for(let i=0;i<lines.length;i++){offsets.push(offset);offset+=lines[i].length+(endings[i]?.length||0);}
 if(sourceParsed.diagnostics.some(d=>d.severity==='error'))return reject('来源原文不能通过parser；拒绝回接。');
 const ids=new Set(),claimed=new Set();
 for(const r of source.nodes){const n=r?.baseline;if(!n||!r.stableId||ids.has(r.stableId)||!Array.isArray(r.objects)||!equal(sourceParsed.nodes.find(x=>x.id===r.nodeId),n))return reject('来源节点、raw/line或稳定身份与原文不一致。');ids.add(r.stableId);if(claimed.has(r.nodeId))return reject('来源节点身份重复。');claimed.add(r.nodeId);}
 if(sourceParsed.nodes.some(n=>!claimed.has(n.id)))return reject('来源节点未覆盖完整原文。');
 const nameFor=(p,id)=>id==='narrator'?'旁白':p.characterDefinitions?.find(d=>d.id===id)?.name || p.characterDefinitions?.find(d=>d.id===p.scene?.characters?.find(c=>c.id===id)?.definitionId)?.name;
 const rename=new Map((base.characterDefinitions||[]).map(d=>[d.name,current.characterDefinitions?.find(x=>x.id===d.id)?.name]));
 const renameSuccess=new Set(),renameFailure=new Set();
 for(const r of source.nodes) {
  const n=r.baseline,target=JSON.parse(JSON.stringify(n)),take=[];
  const mapped=type=>r.objects.filter(o=>o.type===type).map(o=>({old:oldIndex.get(type+':'+o.id),now:nowIndex.get(type+':'+o.id)}));
  const cover=(entry,field)=>take.push(ptr(entry.path,field));
  let touched=false,renamedFrom=null;
  try {
   if(n.type==='title'){
     const ts=mapped('title');if(ts.length!==1||!ts[0].old||!ts[0].now)throw Error('标题来源对象缺失或不唯一');
     const {old,now}=ts[0];if(old.value.text!==n.text)throw Error('标题来源正文与基线不一致');
     if(typeof now.value.text!=='string'||!now.value.text.trim()||/[\r\n\u2028\u2029]/.test(now.value.text))throw Error('标题正文无法表达');
     target.text=now.value.text;cover(now,'text');touched=target.text!==n.text;
    }
    if(n.type==='dialogue') {
    const ds=mapped('dialogue');if(ds.length!==1||!ds[0].old||!ds[0].now)throw Error('对白来源对象缺失或不唯一');
    const {old,now}=ds[0],d=now.value,locale=base.locale;
    if((old.value.fullText||old.value.text)?.[locale]!==n.text||nameFor(base,old.value.speakerId)!==n.speaker)throw Error('来源对白与基线正文/角色不一致');
    let text;
    if(Array.isArray(d.pages)&&d.pages.length){text=d.pages.map(p=>p.text?.[locale]).join('');if(d.pages.some(p=>typeof p.text?.[locale]!=='string')||d.fullText?.[locale]!==text||d.text?.[locale]!==d.pages[0].text?.[locale])throw Error('pages/fullText/parent正文不一致');}
    else {text=d.fullText?.[locale]??d.text?.[locale];if(d.fullText&&d.text?.[locale]!==text)throw Error('fullText与正文不一致');}
    if(typeof text!=='string')throw Error('缺少全文');
    const boundaries=value=>{let end=0;return (value.pages||[]).slice(0,-1).map(p=>end+=p.text?.[locale]?.length||0);};
    if(!equal(boundaries(old.value),boundaries(d)))loss('PAGINATION_NOT_EXPRESSIBLE',now.path+'/pages','人工分页边界已变化；TXT仅表达全文，不保留分页边界。');
    target.text=text;target.speaker=nameFor(current,d.speakerId);if(!target.speaker)throw Error('说话人引用无法解析');
    if(target.speaker!==n.speaker&&(target.speaker==='旁白'&&d.speakerId!=='narrator'||(current.characterDefinitions||[]).filter(d=>d.name===target.speaker).length>1))throw Error('角色重名或与旁白冲突');
    if(target.speaker!==n.speaker&&nameFor(base,old.value.speakerId)===n.speaker)renamedFrom=n.speaker;
    take.push(ptr(now.path+'/text',locale),ptr(now.path+'/fullText',locale));
    (d.pages||[]).forEach((p,i)=>take.push(ptr(`${now.path}/pages/${i}/text`,locale)));
    cover(now,'speakerId');
    touched=target.text!==n.text||target.speaker!==n.speaker;
   }
   if(n.type==='command'&&typeof n.args?.角色==='string') {
    const name=rename.get(n.args.角色);if(name&&name!==n.args.角色){target.args.角色=name;renamedFrom=n.args.角色;touched=true;}
   }
   for(const {old,now} of mapped('expressionEvent'))if(old&&now&&!equal(old.value.expressionId,now.value.expressionId)){
    const def=current.characterDefinitions?.find(d=>d.id===now.parent.definitionId),ex=def?.expressions?.find(e=>e.id===now.value.expressionId);
    if(!ex||!['dialogue','command'].includes(n.type)||n.type==='command'&&!['出场','表情'].includes(n.name))throw Error('表情状态不能投影为此来源节点');
    if(n.type==='dialogue')target.expression=ex.name;else target.args.表情=ex.name;cover(now,'expressionId');touched=true;
   }
   if(n.type==='command'&&n.name==='背景')for(const {old,now} of mapped('backgroundEvent'))if(old&&now&&!equal(old.value.background,now.value.background)){
    const bg=now.value.background,matches=(source.mediaMappings||[]).filter(m=>m.resourceId===bg.resourceId&&m.category==='background');
    if(bg.kind!=='image'||matches.length!==1)throw Error('背景无唯一来源素材映射');
    target.args.文件=matches[0].relativePath;take.push(now.path+'/background/resourceId');touched=true;
   }
   if(n.type==='command'&&n.name==='出场')for(const {old,now} of mapped('characterInstance'))if(old&&now&&old.value.x!==now.value.x){
    const c=now.value,anchor=(c.x+c.width/2)/960*100;
    if((c.positionKeyframes||[]).length)throw Error('含移动轨迹的出场基准改变不能单独反写站位；需保留配套帧值或明确重新编排');
    const position=Object.keys(positions).find(k=>Math.abs(positions[k]-anchor)<1e-8);
    if(!position||!equal(current.design,base.design)||current.design.width!==960||c.width!==old.value.width||c.y!==old.value.y||c.height!==old.value.height)throw Error('站位非已支持固定布局槽位');
    target.args.位置=position;cover(now,'x');touched=true;
   }
   if(touched){
    const start=offsets[n.line-1],end=start+n.raw.length,eol=endings[n.line-1]||'\n';
    if(source.text.slice(start,end)!==n.raw)throw Error('原文区间不匹配');
    const replacement=n.type==='title'?'# '+target.text:n.type==='dialogue'?dialogue(target,n.raw,eol):command(target);
    const parsed=parseScript(replacement),candidate=parsed.nodes.find(x=>x.type===n.type);
    if(parsed.diagnostics.some(d=>d.severity==='error')||!candidate||n.type==='title'&&(parsed.nodes.length!==1||candidate.text!==target.text)||n.type==='dialogue'&&(candidate.text!==target.text||candidate.speaker!==target.speaker||candidate.expression!==target.expression)||n.type==='command'&&!equal(candidate.args,target.args))throw Error('生成语法无法精确重解析');
    patches.push({start,end,text:replacement});changes.push({stableId:r.stableId,nodeId:r.nodeId,line:n.line});
   }
   take.forEach(p=>covered.add(p));if(renamedFrom)renameSuccess.add(renamedFrom);
  }catch(e){if(renamedFrom)renameFailure.add(renamedFrom);loss('NODE_NOT_PROJECTED','/scriptSource/nodes/'+r.stableId,e.message,{nodeId:r.nodeId});}
 }
 for(const [i,d] of (current.characterDefinitions||[]).entries()){
  const old=base.characterDefinitions?.find(x=>x.id===d.id);
  if(old&&old.name!==d.name&&renameSuccess.has(old.name)&&!renameFailure.has(old.name))covered.add(`/characterDefinitions/${i}/name`);
 }
 patches.sort((a,b)=>b.start-a.start);let text=source.text,last=Infinity;
 for(const patch of patches){if(patch.end>last)return reject('来源可编辑区间重叠；拒绝覆盖批注或其他节点。');text=text.slice(0,patch.start)+patch.text+text.slice(patch.end);last=patch.start;}
 // TXT has no title-style syntax, even when an explicit style is unchanged.
 const stylePaths=new Set();
 for(const [i,title] of (current.scene?.performance?.titles||[]).entries())if(own(title,'style')||own(base.scene?.performance?.titles?.find(t=>t.id===title.id)||{},'style')){
  const path=`/scene/performance/titles/${i}/style`;stylePaths.add(path);
  loss('TITLE_STYLE_NOT_EXPRESSIBLE',path,'标题样式无法由纯TXT重现；原文不新增样式参数，配套侧车仅在预检确认可保留时恢复已存实际样式。',{after:title.style});
 }
 for(const d of differences(base,current))if(!covered.has(d.path)&&![...stylePaths].some(path=>d.path===path||d.path.startsWith(path+'/'))){
  const code=/\/(voiceClips|voice|audioTracks)(\/|$)/.test(d.path)?'AUDIO_NOT_EXPRESSIBLE':/\/pages(\/|$)/.test(d.path)?'PAGINATION_NOT_EXPRESSIBLE':/(frame|Frame|Frames|Samples|visibleFrom|visibleTo|positionKeyframes|visibilityEvents)(\/|$)/.test(d.path)?'TIMELINE_NOT_EXPRESSIBLE':/^\/scene\/performance(?:\/|$)/.test(d.path)?'PERFORMANCE_NOT_EXPRESSIBLE':'PROJECT_CHANGE_NOT_EXPRESSIBLE';
  loss(code,d.path,'此工程差异不能由纯TXT重现；配套记录仅在预检确认可保留时恢复支持字段，改稿或冲突会重新编排，请保留原工程。',{before:d.before,after:d.after});
 }
 const exported=parseScript(text,{defaultLayout:source.config?.defaultLayout});
 if(exported.diagnostics.some(d=>d.severity==='error')||exported.nodes.length!==sourceParsed.nodes.length||exported.nodes.some((n,i)=>n.type!==sourceParsed.nodes[i].type||n.type==='command'&&n.name!==sourceParsed.nodes[i].name))return reject('导出后节点结构不一致；拒绝猜测回接身份。');
 const nodeMappings=exported.nodes.map((n,i)=>({nodeId:n.id,sourceNodeId:sourceParsed.nodes[i].id}));
 return {ok:true,text,losses,changes,nodeMappings,lossless:false,scope:'supported-script-text',sourceVersion:1};
 }catch(error){return reject('来源或工程结构无效：'+error.message);}
}
module.exports={exportScriptText};
