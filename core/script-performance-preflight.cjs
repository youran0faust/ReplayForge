'use strict';
const {resolvePerformanceConfig}=require('./performance-config.cjs');
// Schema4 subset: codes/messages mirror builder; builder remains authoritative.
const ALLOWED={移动:['角色','位置','时长','同时'],出场:['角色','位置','表情','演出','时长','同时'],退场:['角色','演出','时长','同时'],背景:['文件','转场','时长','同时'],停顿:['时长','保留'],布局:['布局'],表情:['角色','表情'],音乐:['文件','动作','时长'],音效:['文件'],视频:['文件'],画面:['动作','时长','同时'],清字幕:[],对白框:['动作'],隐藏对白框:[],显示对白框:[]};
function validateCommandCombination(node){
 const name=node.name,a=node.args,fail=(code,message)=>({code,message});
 if(name==='视频'&&(!a||typeof a.文件!=='string'||!a.文件.trim()))return fail('UNSUPPORTED_PARAMETER','视频仅支持非空文件参数');
 if(!Object.hasOwn(ALLOWED,name))return fail('UNSUPPORTED_COMMAND',`当前生成子集不支持@${name}；标题、视频及复杂演出不静默忽略`);
 if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!ALLOWED[name].includes(k))||(a.演出!==undefined&&!['无',name==='出场'?'淡入':'淡出'].includes(a.演出))||(a.转场!==undefined&&!['无','黑屏'].includes(a.转场))||(a.同时!==undefined&&typeof a.同时!=='boolean'))return fail('UNSUPPORTED_PARAMETER',`@${name}含当前命令未支持的参数或演出；基础移动仅支持命名位置、时长及同时`);
 if(['出场','退场'].includes(name)&&(a.时长!==undefined||a.同时!==undefined)&&(!a.演出||a.演出==='无'))return fail('UNSUPPORTED_PARAMETER','时长/同时需要显式淡入或淡出演出');
 if(name==='画面'&&!['淡入','淡出'].includes(a.动作))return fail('UNSUPPORTED_PARAMETER','画面动作须为淡入或淡出');
 if(name==='对白框'&&!['显示','隐藏'].includes(a.动作))return fail('UNSUPPORTED_PARAMETER','对白框动作须为显示或隐藏');
 if(name==='背景'){
  if(a.转场!=='黑屏'&&(a.时长!==undefined||a.同时!==undefined))return fail('UNSUPPORTED_PARAMETER','背景时长/同时仅用于黑屏转场，转场必须阻塞');
  if(a.转场==='黑屏'&&a.同时===true)return fail('UNSUPPORTED_PARAMETER','黑屏背景转场必须阻塞');
 }
 if(name==='音乐'){
  if(a.时长!==undefined&&(a.动作!=='停止'||a.文件!==undefined))return fail('UNSUPPORTED_PARAMETER','音乐时长仅用于显式停止的末尾淡出');
  if(a.时长!==undefined&&(typeof a.时长!=='number'||!Number.isFinite(a.时长)||a.时长<0||!Number.isSafeInteger(Math.round(a.时长*48000))))return fail('INVALID_DURATION','音乐淡出时长须为非负有限秒数且对应安全整数样本');
  if(!(a.动作==='停止'&&a.文件===undefined)&&(a.动作!==undefined||!a.文件))return fail('INVALID_MUSIC','音乐须指定文件或停止');
 }else if(a.时长!==undefined||name==='移动'||name==='停顿'){
  const v=a.时长,zero=name==='停顿';
  if(typeof v!=='number'||!Number.isFinite(v)||(zero?v<0:v<=0)||!Number.isSafeInteger(Math.round(v*30)))return fail('INVALID_DURATION',zero?'停顿时长无效':name==='移动'?'移动须有正有限时长且累计帧数为安全整数':'演出须有正有限时长且累计帧数为安全整数');
 }
 if(name==='停顿'&&a.保留!==undefined&&typeof a.保留!=='boolean')return fail('UNSUPPORTED_PARAMETER','保留须为boolean');
 if(['出场','移动'].includes(name)&&a.位置==='坐标')return fail('POSITION_UNAVAILABLE','移动仅支持命名槽位，不支持坐标');
 return null;
}
function validatePerformanceCommands(nodes,config={}){
 const diagnostics=[],defaults=resolvePerformanceConfig(config);
 const add=(n,d)=>diagnostics.push({severity:'error',...d,line:n.line||1,column:n.column||1});
 // Local proof window only: no absolute cursor, media/page estimation, stage
 // allocation or fake project. Unknown blocking time discards busy evidence.
 const busy=new Map();
 const elapse=frames=>{for(const [key,value] of busy){value.frames-=frames;if(value.frames<=0)busy.delete(key);}};
 const frames=v=>typeof v==='number'&&Number.isFinite(v)&&v>0&&Number.isSafeInteger(Math.round(v*30))?Math.max(1,Math.round(v*30)):null;
 for(const n of nodes){
  if(n.type==='dialogue'||n.type==='title'){busy.clear();continue;}
  if(n.type!=='command')continue;
  const issue=validateCommandCombination(n);
  if(issue){add(n,issue);busy.clear();continue;}
  const a=n.args,name=n.name,actor='actor:'+a.角色;
  if(name==='画面'&&busy.has('screen')){add(n,{code:'ACTION_IN_PROGRESS',message:'画面遮罩淡变尚未完成'});continue;}
  if(name==='移动'&&(busy.has(actor+':move')||busy.has(actor+':exit'))){add(n,{code:'ACTION_IN_PROGRESS',message:'同角色上一移动或退场尚未完成'});continue;}
  if(name==='退场'&&[':move',':opacity',':exit'].some(k=>busy.has(actor+k))){add(n,{code:'ACTION_IN_PROGRESS',message:'移动或透明度演出完成前不可退场'});continue;}
  if(name==='视频'){busy.clear();continue;} // Unprobed blocking duration: retain Stage A only.
   if(name==='停顿'){elapse(Math.round(a.时长*30));continue;}
  let duration=null,key;
  if(name==='画面'){duration=frames(a.时长??defaults.screenFadeSeconds);key='screen';}
  if(name==='移动'){duration=frames(a.时长);key=actor+':move';}
  if(name==='出场'&&a.演出==='淡入'){duration=frames(a.时长??defaults.characterFadeSeconds);key=actor+':opacity';}
  if(name==='退场'&&a.演出==='淡出'){duration=frames(a.时长??defaults.characterFadeSeconds);key=actor+':exit';}
  // Background may fail resource/state validation; do not invent its state.
  if(name==='背景'&&a.转场==='黑屏'){busy.clear();continue;}
  if(duration!==null){if(a.同时)busy.set(key,{frames:duration});else elapse(duration);}
 }
 return diagnostics;
}
module.exports={validateCommandCombination,validatePerformanceCommands};
