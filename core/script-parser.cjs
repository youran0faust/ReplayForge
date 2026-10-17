'use strict';
// Pure A-batch parser. line-N IDs are temporary, never stable reimport identities.
// Local grammar: '=' named keys, positional slots below, seconds as numbers,
// coordinates {value,unit}, headings end continuation; comments do not.
const LAYOUTS = { 单人: ['中'], 双人: ['左','右'], 三人: ['左','中','右'], 四人: ['左外','左内','右内','右外'] };
const POSITIONS = new Set(Object.entries(LAYOUTS).flatMap(([l,s]) => s.map(v => l+v)));
const SCHEMAS = {
 背景: [['文件'], ['文件','转场','时长','同时'], ['文件']],
 音乐: [['文件'], ['文件','动作','时长'], []],
 音效: [['文件'], ['文件'], ['文件']], 视频: [['文件'], ['文件'], ['文件']],
 布局: [['布局'], ['布局'], ['布局']],
 出场: [['角色','位置','演出','时长'], ['角色','位置','表情','演出','时长','同时','x','y'], ['角色']],
 移动: [['角色','位置','时长'], ['角色','位置','时长','同时','x','y'], ['角色','位置']],
 退场: [['角色','演出','时长'], ['角色','演出','时长','同时'], ['角色']],
 表情: [['角色','表情'], ['角色','表情'], ['角色','表情']],
 停顿: [['时长'], ['时长','保留'], ['时长']],
 画面: [['动作','时长'], ['动作','时长','同时'], ['动作']],
 清字幕: [[],[],[]], 对白框: [['动作'],['动作'],['动作']], 隐藏对白框: [[],[],[]], 显示对白框: [[],[],[]]
};
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function parseScript(text, options = {}) {
 const nodes = [], diagnostics = [];
 const report = (code,message,line,column,severity='error') => diagnostics.push({severity,code,message,line,column});
 if (typeof text !== 'string') { report('INVALID_INPUT','剧本文本必须是字符串。',1,1); return {version:1,nodes,diagnostics}; }
 if (!options || typeof options !== 'object' || Array.isArray(options)) { report('INVALID_OPTIONS','解析选项必须是对象。',1,1); options={}; }
 let characters=null;
 if (options.characters !== undefined) {
  if (!Array.isArray(options.characters) || options.characters.some(c=>!c || typeof c.name!=='string' || !c.name.trim())) report('INVALID_CHARACTERS','characters 必须是带非空 name 的数组。',1,1);
  else characters=new Set(options.characters.map(c=>c.name));
 }
 let layout=options.defaultLayout===undefined?'双人':options.defaultLayout;
 if (!own(LAYOUTS,layout)) { report('INVALID_LAYOUT','无效的默认布局。',1,1); layout='双人'; }
 const checkCharacter=(name,line,col)=>{ if(characters && name!=='旁白' && !characters.has(name)) report('UNKNOWN_CHARACTER',`未登记角色：${name}`,line,col); };
 const source=text.replace(/^\uFEFF/,'');
 const lines=source.split(/\r\n|\n|\r/), endings=source.match(/\r\n|\n|\r/g)||[];
 const rawSpan=(start,end)=>{ let raw=lines[start]; for(let n=start;n<end;n++) raw+=endings[n]+lines[n+1]; return raw; };
 let active=null;
 const make=(type,index,column,fields)=>{const node={id:`line-${index+1}`,type,line:index+1,column,raw:lines[index],...fields}; nodes.push(node); return node;};
 function lex(input,line,offset) {
  const tokens=[]; let i=0;
  while(i<input.length) {
   if(/\s/.test(input[i])) {i++;continue;}
   const start=i,ch=input[i];
   if('()（）,，='.includes(ch)) {tokens.push({kind:'（('.includes(ch)?'(': '）)'.includes(ch)?')':'，,'.includes(ch)?',':'=',value:ch,column:offset+i}); i++;continue;}
   if(ch==='"') {
    i++;let value='',closed=false;
    while(i<input.length) {
     if(input[i]==='"'){i++;closed=true;break;}
     if(input[i]==='\\') {
      const esc=input[i+1];
      if(esc==='"'||esc==='\\'){value+=esc;i+=2;continue;}
      report('INVALID_ESCAPE','引号内仅支持反斜杠和双引号转义。',line,offset+i);value+='\\';i++;continue;
     }
     value+=input[i++];
    }
    if(!closed)report('UNCLOSED_QUOTE','引号未闭合。',line,offset+start);
    if(i<input.length&&!/[\s()（）,，=]/.test(input[i]))report('MISSING_SEPARATOR','引号值后缺少分隔符。',line,offset+i);
    tokens.push({kind:'value',value,column:offset+start,quoted:true});continue;
   }
   while(i<input.length&&!/[\s()（）,，="]/.test(input[i]))i++;
   tokens.push({kind:'value',value:input.slice(start,i),column:offset+start});
  }
  return tokens;
 }
 function command(body,index,column) {
  const line=index+1, match=/^[@＠]\s*([^\s()（）,，=]+)(.*)$/.exec(body);
  if(!match){make('command',index,column,{name:'',args:{}});report('MISSING_COMMAND','@ 后缺少命令名。',line,column);return;}
  const name=match[1],args={},locations={};make('command',index,column,{name,args});
  if(!own(SCHEMAS,name)){report('UNKNOWN_COMMAND',`未知命令：${name}`,line,column);return;}
  const [slots,keys,required]=SCHEMAS[name],tokens=lex(match[2],line,column+body.length-match[2].length);
  let slot=0,opened=null,closed=false,lastComma=false;
  const assign=(key,value,col)=>{
   if(!keys.includes(key)){report('UNKNOWN_PARAMETER',`@${name} 不接受参数：${key}`,line,col);return;}
   if(own(args,key)){report('DUPLICATE_PARAMETER',`重复参数：${key}`,line,col);return;}
   args[key]=value;locations[key]=col;
  };
  for(let t=0;t<tokens.length;t++) {
   const token=tokens[t];
   if(token.kind==='('){if(opened||closed)report('INVALID_PARENTHESES','参数括号不可嵌套或重复。',line,token.column);else opened=token;lastComma=false;continue;}
   if(token.kind===')') {
    if(!opened||closed)report('INVALID_PARENTHESES','没有对应的参数左括号。',line,token.column);
    else if(!((opened.value==='('&&token.value===')')||(opened.value==='（'&&token.value==='）')))report('MISMATCHED_BRACKETS','参数括号须成对。',line,token.column);
    if(lastComma)report('EMPTY_PARAMETER','逗号后缺少参数。',line,token.column);
    closed=true;lastComma=false;continue;
   }
   if(token.kind===','){if(lastComma||t===0||tokens[t-1].kind==='('||closed)report('EMPTY_PARAMETER','空参数或无效逗号。',line,token.column);lastComma=true;continue;}
   lastComma=false;
   if(closed)report('TRAILING_ARGUMENT','参数括号结束后不允许额外参数。',line,token.column);
   if(token.kind!=='value'){report('INVALID_PARAMETER','缺少参数名称或参数值。',line,token.column);continue;}
   if(tokens[t+1]?.kind==='=') {
    t++;const value=tokens[t+1];
    if(!value||value.kind!=='value'||tokens[t+2]?.kind==='='){report('MISSING_VALUE',`参数 ${token.value} 缺少值。`,line,token.column);continue;}
    t++;assign(token.value,value.value,token.column);
   } else if(token.value==='同时'&&!token.quoted)assign('同时',true,token.column);
   else if(name==='停顿'&&token.value==='保留'&&!token.quoted)assign('保留',true,token.column);
   else {const key=slots[slot++];if(!key)report('EXTRA_ARGUMENT','多余简写参数；含空格或括号的文件名请加引号。',line,token.column);else assign(key,token.value,token.column);}
  }
  if(opened&&!closed)report('UNCLOSED_PARENTHESES','参数括号未闭合。',line,opened.column);
  if(lastComma)report('EMPTY_PARAMETER','逗号后缺少参数。',line,tokens.at(-1).column);
  for(const key of required)if(!own(args,key)||args[key]==='')report('MISSING_PARAMETER',`@${name} 缺少 ${key}。`,line,column);
  const invalid=(key,msg,code='INVALID_PARAMETER')=>report(code,msg,line,locations[key]||column);
  for(const [key,value] of Object.entries(args))if(value==='')invalid(key,`参数 ${key} 不可为空。`,'EMPTY_VALUE');
  if(own(args,'时长')) {
   const m=/^(\d+(?:\.\d+)?|\.\d+)(?:秒|s)$/.exec(args.时长);
   if(!m||!Number.isFinite(Number(m[1])))invalid('时长','时长须为非负有限数字并带 秒 或 s 单位。','INVALID_DURATION');else args.时长=Number(m[1]);
  }
  if(own(args,'同时')&&args.同时!==true){if(['是','true'].includes(args.同时))args.同时=true;else if(['否','false'].includes(args.同时))args.同时=false;else invalid('同时','同时只接受 是/否/true/false。');}
  if(name==='停顿') {
   // Normalize even invalid input to a safe boolean; diagnostics still reject it.
   if(!own(args,'保留'))args.保留=true;
   else if(args.保留!==true) {
    const value=args.保留;
    args.保留=['是','true'].includes(value);
    if(!['是','否','true','false'].includes(value))invalid('保留','保留只接受 是/否/true/false。');
   }
  }
  if(own(args,'角色'))checkCharacter(args.角色,line,locations.角色);
  if(own(args,'布局')){if(!own(LAYOUTS,args.布局))invalid('布局','布局须为单人、双人、三人或四人。','INVALID_LAYOUT');else layout=args.布局;}
  if(own(args,'位置')&&args.位置!=='坐标'&&!POSITIONS.has(args.位置)){if(LAYOUTS[layout].includes(args.位置))args.位置=layout+args.位置;else invalid('位置',`站位 ${args.位置} 不存在于布局 ${layout}。`,'INVALID_POSITION');}
  for(const key of ['x','y'])if(own(args,key)) {
   const m=/^(-?(?:\d+(?:\.\d+)?|\.\d+))(%|％|像素|px)$/.exec(args[key]);
   if(!m||!Number.isFinite(Number(m[1])))invalid(key,'坐标必须带 % 或 像素/px 单位。','INVALID_COORDINATE');else args[key]={value:Number(m[1]),unit:/^(%|％)$/.test(m[2])?'%':'px'};
  }
  if(args.位置==='坐标'){for(const key of ['x','y'])if(!own(args,key))report('MISSING_COORDINATE',`坐标位置缺少 ${key}。`,line,column);}
  else if(own(args,'x')||own(args,'y'))invalid(own(args,'x')?'x':'y','x/y 仅可与位置=坐标一同使用。','CONFLICTING_PARAMETERS');
  if(own(args,'演出')&&!(name==='出场'?['淡入','无']:['淡出','无']).includes(args.演出))invalid('演出',`@${name} 的演出参数非法。`);
  if(own(args,'转场')&&!['黑屏','淡入','淡出','无'].includes(args.转场))invalid('转场','未知背景转场。');
  if(name==='画面'&&own(args,'动作')&&!['淡入','淡出'].includes(args.动作))invalid('动作','画面动作须为淡入或淡出。');
  if(name==='对白框'&&own(args,'动作')&&!['显示','隐藏'].includes(args.动作))invalid('动作','对白框动作须为显示或隐藏。');
  if(name==='音乐') {
   if(args.文件==='停止'){if(own(args,'动作'))invalid('动作','音乐停止与动作参数重复。','CONFLICTING_PARAMETERS');else args.动作='停止';delete args.文件;}
   if(own(args,'动作')&&args.动作!=='停止')invalid('动作','音乐动作仅支持停止。');
   if(own(args,'文件')&&own(args,'动作'))invalid('动作','音乐文件与停止动作互斥。','CONFLICTING_PARAMETERS');
   if(!own(args,'文件')&&!own(args,'动作'))report('MISSING_PARAMETER','@音乐 缺少文件或停止动作。',line,column);
  }
  if(own(args,'文件')&&args.文件&&!/\.[^./\\\s]+$/.test(args.文件))invalid('文件','素材引用须包含文件扩展名。','MISSING_EXTENSION');
  // Video is a schema4 blocking command; media facts are checked after probe.
 }
 for(let index=0;index<lines.length;index++) {
  const raw=lines[index],body=raw.trimStart(),column=raw.length-body.length+1;
  if(!body.trim())continue;
  if(body.startsWith('//')){make('comment',index,column,{text:body.slice(2)});continue;}
  if(body.startsWith('\\')) {
   if(!active)report('ORPHAN_TEXT','转义正文之前没有对白。',index+1,column);
   else{active.text+='\n'+raw.slice(0,column-1)+body.slice(1);active.raw=rawSpan(active.line-1,index);}continue;
  }
  if(/^[@＠]/.test(body)){active=null;command(body,index,column);continue;}
  const heading=/^(#+)\s*(.*)$/.exec(body);
  if(heading){active=null;const level=heading[1].length;make(level===1?'title':'section',index,column,level===1?{text:heading[2]}:{text:heading[2],level});if(!heading[2].trim())report('EMPTY_HEADING','标题内容为空。',index+1,column,'warning');continue;}
  const d=/^([^:：\[\]［］]+?)\s*(?:([\[［])\s*(.*?)\s*([\]］])\s*)?[:：]([\s\S]*)$/.exec(body);
  if(d){const speaker=d[1].trim(),expression=d[2]?d[3]:null;active=make('dialogue',index,column,{speaker,expression,text:d[5]});checkCharacter(speaker,index+1,column);if(expression==='')report('EMPTY_EXPRESSION','表情名不可为空。',index+1,column+body.indexOf(d[2]));if(d[2]&&!((d[2]==='['&&d[4]===']')||(d[2]==='［'&&d[4]==='］')))report('MISMATCHED_BRACKETS','表情括号须成对。',index+1,column+body.indexOf(d[4]));continue;}
  if(/^[^:：]*[\[\]［］][^:：]*[:：]/.test(body)||/^[:：]/.test(body)){active=null;report('INVALID_DIALOGUE','对白角色或表情标记不合法。',index+1,column);continue;}
  if(!active)report('ORPHAN_TEXT','普通正文之前没有对白；标题或指令后须重新写角色。',index+1,column);
  else{active.text+='\n'+raw;active.raw=rawSpan(active.line-1,index);}
 }
 return {version:1,nodes,diagnostics};
}
module.exports={parseScript};
