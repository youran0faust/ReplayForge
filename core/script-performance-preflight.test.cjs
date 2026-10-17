'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseScript}=require('./script-parser.cjs');
const {preflight}=require('./script-preflight.cjs');
const {validateCommandCombination,validatePerformanceCommands}=require('./script-performance-preflight.cjs');
const config={characters:[{name:'甲',voiceCode:'A',expressions:[]},{name:'乙',voiceCode:'B',expressions:[]}]};
const catalog={diagnostics:[],assets:[['bg','background','a.png'],['music','music','a.wav'],['sfx','sfx','s.wav'],['video','video','a.mp4']].map(([id,category,categoryPath])=>({id,category,categoryPath,relativePath:categoryPath}))};
const run=(text,extra={})=>preflight({text,config,catalog,...extra});
const errors=r=>r.diagnostics.filter(d=>d.severity==='error');
const conflict=text=>run(text).diagnostics.filter(d=>d.code==='ACTION_IN_PROGRESS');
test('parser-valid unsupported combinations become located preflight errors',()=>{
 for(const text of ['@出场 甲 时长=1秒','@退场 甲 演出=无 同时=否','@背景 a.png 转场=淡入','@背景 a.png 转场=淡出','@背景 a.png 时长=1秒','@背景 a.png 转场=黑屏 同时','@音乐 a.wav 时长=1秒','@出场 甲 位置=坐标 x=10% y=20%']){
  assert.equal(parseScript(text,{characters:config.characters}).diagnostics.length,0,text);
  const r=run('  '+text);assert.equal(r.ok,false,text);
  assert.ok(errors(r).some(d=>d.code==='UNSUPPORTED_PARAMETER'&&d.line===1&&d.column===3),JSON.stringify(r.diagnostics));
 }
});
test('positive durations except pause and explicit music stop',()=>{
 for(const text of ['@画面 淡入 0秒','@出场 甲 演出=淡入 时长=0秒','@退场 甲 演出=淡出 时长=0秒','@背景 a.png 转场=黑屏 时长=0秒','@移动 甲 双人右 0秒','@画面 淡出 999999999999999999秒'])assert.ok(errors(run(text)).some(d=>d.code==='INVALID_DURATION'),text);
 for(const text of ['@音乐 停止 时长=0秒','@停顿 0秒','@出场 甲 演出=无','@退场 甲 演出=无','@背景 a.png 转场=无','@背景 a.png 转场=黑屏 同时=否 时长=.01秒','@画面 淡入 .01秒','@对白框 隐藏','@隐藏对白框','@显示对白框','@清字幕'])assert.deepEqual(errors(run(text)),[],text);
});
test('pure validator double checks malformed parsed/direct nodes using builder diagnostics',()=>{
 for(const [name,args,code] of [['出场',{角色:'甲',演出:'淡出'},'UNSUPPORTED_PARAMETER'],['退场',{角色:'甲',演出:'淡入'},'UNSUPPORTED_PARAMETER'],['画面',{动作:'旋转'},'UNSUPPORTED_PARAMETER'],['画面',{动作:'淡入',同时:'maybe'},'UNSUPPORTED_PARAMETER'],['画面',{动作:'淡入',时长:NaN},'INVALID_DURATION'],['音乐',{动作:'停止',时长:Infinity},'INVALID_DURATION'],['音乐',{动作:'停止',时长:-1},'INVALID_DURATION'],['未知',{},'UNSUPPORTED_COMMAND']])assert.equal(validateCommandCombination({name,args}).code,code);
 for(const text of ['@画面 淡入 时长=-1秒','@画面 淡入 同时=maybe','@出场 甲 演出=淡出'])assert.equal(run(text).ok,false);
});
test('video is supported but unprobed media remains Stage A',()=>{
 const r=run('@视频 a.mp4');assert.equal(r.ok,true);assert.equal(r.canGenerate,false);assert.equal(r.mediaValidated,false);
 assert.ok(!r.diagnostics.some(d=>d.code==='PARSE_ONLY_FEATURE'));
 assert.ok(!r.diagnostics.some(d=>d.code==='GENERATION_UNSUPPORTED'));
 assert.equal(validateCommandCombination({name:'视频',args:{文件:'a.mp4',同时:true}}).code,'UNSUPPORTED_PARAMETER');
 assert.equal(conflict('@画面 淡出 100秒 同时\n@视频 a.mp4\n@画面 淡入').length,0);
});
test('instantaneous screen batch conflict survives comments, headings and state changes',()=>{
 const r=run('@画面 淡出 同时\n// 注释\n## 段落\n@清字幕\n@对白框 隐藏\n@背景 a.png\n@音效 s.wav\n  @画面 淡入');
 const d=r.diagnostics.find(d=>d.code==='ACTION_IN_PROGRESS');assert.equal(d.message,'画面遮罩淡变尚未完成');assert.equal(d.line,8);assert.equal(d.column,3);assert.equal(r.ok,false);
});
test('explicit pause subtracts rounded frames, including exact boundary',()=>{
 assert.equal(conflict('@画面 淡出 1秒 同时\n@停顿 .5秒\n@画面 淡入').length,1);
 assert.equal(conflict('@画面 淡出 1秒 同时\n@停顿 0秒\n@画面 淡入').length,1);
 assert.equal(conflict('@画面 淡出 1秒 同时\n@停顿 .5秒\n@停顿 .5秒\n@画面 淡入').length,0);
 assert.equal(conflict('@画面 淡出 .01秒 同时\n@停顿 .02秒\n@画面 淡入').length,0);
});
test('blocking effects consume known time, unknown dialogue/title never assumed short',()=>{
 assert.equal(conflict('@画面 淡出\n@画面 淡入').length,0);
 assert.equal(conflict('@画面 淡出 1秒 同时\n@出场 甲 演出=淡入 时长=1秒\n@画面 淡入').length,0);
 for(const separator of ['旁白：未知媒体或分页时长','# 阻塞标题'])assert.equal(conflict('@画面 淡出 100秒 同时\n'+separator+'\n@画面 淡入').length,0);
 const text='@画面 淡出 100秒 同时\n旁白：未知时长\n@画面 淡入';
 assert.deepEqual(validatePerformanceCommands(parseScript(text).nodes,{...config,unvoicedDurationSeconds:.001}),[]);
});
test('same-actor move/opacity/exit conflicts, but distinct actors do not conflict',()=>{
 for(const text of ['@出场 甲 演出=淡入 同时\n@退场 甲','@出场 甲\n@移动 甲 双人右 2秒 同时\n@移动 甲 双人左 1秒','@出场 甲\n@移动 甲 双人右 2秒 同时\n@退场 甲','@出场 甲\n@退场 甲 演出=淡出 同时\n@移动 甲 双人右 1秒','@出场 甲\n@退场 甲 演出=淡出 同时\n@退场 甲'])assert.equal(conflict(text).length,1,text);
 assert.equal(conflict('@出场 甲 演出=淡入 同时\n@出场 乙 演出=淡入 同时').length,0);
 assert.equal(conflict('@出场 甲 演出=淡入 时长=1秒 同时\n@停顿 1秒\n@退场 甲').length,0);
});
test('validator is pure and performance config remains single-source',()=>{
 const nodes=parseScript('@画面 淡出 同时\n@停顿 .1秒\n@画面 淡入').nodes,before=structuredClone(nodes),c=structuredClone(config);
 validatePerformanceCommands(nodes,config);assert.deepEqual(nodes,before);assert.deepEqual(config,c);
 const r=run('@清字幕',{config:{...config,titleFadeInSeconds:0,titleHoldSeconds:0,titleFadeOutSeconds:0}});
 assert.equal(r.diagnostics.filter(d=>d.code==='INVALID_PERFORMANCE_CONFIG').length,1);
});
