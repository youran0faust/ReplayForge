'use strict';
const {parseScript}=require('./script-parser.cjs');
const {createHash}=require('node:crypto');
const textHash=text=>createHash('sha256').update(text.replace(/^\uFEFF/,''),'utf8').digest('hex');
const {matchVoices}=require('./script-voice-matcher.cjs');
const {resolveAsset}=require('./script-asset-catalog.cjs');
const {resolveReadingConfig,validateReadingConfig}=require('./script-reading-budget.cjs');
function preflight({text,sourceHash,config,catalog,corrections,reimportSource,returnLosses=[],readingConfigSource='config'}={}){
 if(typeof text!=='string'||!config||!Array.isArray(config.characters)||!catalog||!Array.isArray(catalog.assets))throw Error('预检参数无效');
 // Hash decoded text here, never trust a caller-supplied identity for line-based corrections.
 sourceHash=textHash(text);
 const parsed=parseScript(text,{characters:config.characters,defaultLayout:config.defaultLayout||'双人'});
 const readingDiagnostics=validateReadingConfig(config),reading=readingDiagnostics.length?resolveReadingConfig({}):resolveReadingConfig(config);
 const diagnostics=[...catalog.diagnostics,...parsed.diagnostics,...readingDiagnostics,...require('./performance-config.cjs').validatePerformanceConfig(config)];
 const add=(node,severity,code,message)=>diagnostics.push({severity,code,message,line:node?.line||1,column:node?.column||1});
 diagnostics.push(...require('./script-performance-preflight.cjs').validatePerformanceCommands(parsed.nodes,config));
 let overrides={};
 if(corrections){
  if(corrections.version!==1||corrections.sourceHash!==sourceHash||!sourceHash||!corrections.overrides||typeof corrections.overrides!=='object'||Array.isArray(corrections.overrides))add(null,'error','CORRECTIONS_STALE','校正记录版本或剧本哈希不匹配，拒绝复用临时行号身份');
  else {overrides=corrections.overrides;const ids=new Set(parsed.nodes.filter(n=>n.type==='dialogue').map(n=>n.id));for(const id of Object.keys(overrides))if(!ids.has(id))add(null,'error','CORRECTIONS_UNKNOWN_NODE','校正引用不存在的对白：'+id);}
 }
 const references=[],onstage=new Set();
 const categoryFor={'背景':'background','音乐':'music','音效':'sfx','视频':'video'};
 for(const node of parsed.nodes){
  const speaker=node.type==='dialogue'?node.speaker:node.args?.角色;
  const expression=node.type==='dialogue'?node.expression:node.args?.表情;
  if(node.type==='command'&&node.name==='出场')onstage.add(speaker);
  if(expression&&!onstage.has(speaker))add(node,'warning','EXPRESSION_OFFSTAGE','角色未在场，表情不会自动生成立绘：'+speaker);
  if(node.type==='command'&&node.name==='退场')onstage.delete(speaker);
  if(expression){const c=config.characters.find(c=>c.name===speaker);if(c&&!c.expressions?.includes(expression))add(node,'error','EXPRESSION_UNKNOWN',`角色“${speaker}”未登记表情“${expression}”`);}
  if(node.type==='command'&&node.args?.文件){const category=categoryFor[node.name];if(!category)continue;const match=resolveAsset(catalog.assets,category,node.args.文件);references.push({nodeId:node.id,category,reference:node.args.文件,status:match.status,resourceId:match.candidates.length===1?match.candidates[0].id:undefined});if(match.status!=='matched')add(node,'error','RESOURCE_'+match.status.toUpperCase(),`素材引用${match.status}：${node.args.文件}`);}
 }
 const dialogues=parsed.nodes.filter(n=>n.type==='dialogue');
 for(const node of dialogues)if(!node.text.trim())add(node,'error','EMPTY_DIALOGUE','对白正文不能为空');
 if(!parsed.nodes.some(n=>!['comment','section'].includes(n.type)))add(null,'error','EMPTY_SCRIPT','剧本没有可预检的对白或演出');
 let reimport=null;
 if(reimportSource){
  const errors=require('./script-source-record.cjs').validateSourceRecord(reimportSource);
  if(errors.length)throw Error('回接来源记录无效');
  reimport=require('./script-reimport-identity.cjs').reconcileNodes(text,reimportSource);
  diagnostics.push(...reimport.diagnostics);

  for(const loss of returnLosses)add(null,'warning','REIMPORT_DECLARED_LOSS',String(loss.message)+' ['+String(loss.path)+']');
 }
 const voices=matchVoices(dialogues,catalog.assets,{characters:config.characters,overrides,previousBindings:reimport?.previousBindings||[]});
 diagnostics.push(...voices.diagnostics.map(d=>({...d,severity:d.severity||d.level||'error'})));
 let preservation=null;
 if(reimport){
  preservation=require('./script-reimport-preservation.cjs').analyzePreservation({text,config,source:reimportSource,report:{nodes:parsed.nodes,identities:reimport.identities,bindings:voices.bindings}});
  diagnostics.push(...preservation.diagnostics);
 }
 const errors=diagnostics.filter(d=>(d.severity||d.level)==='error').length;
 return {version:1,stage:'A-preflight-only',sourceHash,ok:errors===0&&voices.summary.reviewRequired===0&&voices.summary.unresolved===0,canGenerate:false,mediaValidated:false,
  limitations:['仅语法、登记引用与文件名匹配；未探测媒体内容或时长。','未创建工程、未修改当前工程、未进行播放或视频导出。',reimport?'使用已校验回接记录恢复身份和旧绑定；整份语义未变且映射明确时保留支持字段的实际帧，否则明确重新编排。':'未选择回接记录：校正仅允许同一原文哈希，跨改稿不会复用绑定。'],
  summary:{dialogues:dialogues.length,assets:catalog.assets.length,errors,warnings:diagnostics.filter(d=>(d.severity||d.level)==='warning').length,voices:voices.summary,unvoicedDurationSeconds:config.unvoicedDurationSeconds??3,dialoguePageMaxCharacters:config.dialoguePageMaxCharacters??null,dialoguePageHoldSeconds:reading.dialoguePageHoldSeconds,unvoicedTimingMode:reading.unvoicedTimingMode,unvoicedMinimumSeconds:reading.unvoicedMinimumSeconds,unvoicedReadingSpeed:reading.unvoicedReadingSpeed,dialogueRevealCharactersPerSecond:reading.dialogueRevealCharactersPerSecond,readingConfigSource},
  nodes:parsed.nodes,...(reimport?{identities:reimport.identities,preservation:{canPreserve:preservation.canPreserve,preservedPages:preservation.preservedPages}}:{}),assetCatalog:catalog.assets,references,bindings:voices.bindings,diagnostics};
}
module.exports={preflight,textHash};
