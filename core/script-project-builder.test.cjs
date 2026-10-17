'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildScriptProject:build}=require('./script-project-builder.cjs');
const {parseScript}=require('./script-parser.cjs');
const {validateProject,evaluate}=require('./model.cjs');
function fixture(text='@出场 甲\n甲：你好'){
 const config={version:1,characters:['甲','乙','丙','丁'].map(name=>({name,image:'base.png',expressions:['平常','笑'],defaultExpression:'平常',expressionImages:{平常:'base.png',笑:'smile.png'}}))};
 const entries=[['base','character','base.png'],['smile','character','smile.png'],['bg','background','room.png'],['voice','voice','A_001_你好.wav'],['sfx','sfx','ding.wav'],['music','music','song.wav']];
 const assetCatalog=entries.map(([id,category,file])=>({id,category,kind:['voice','music','sfx'].includes(category)?'audio':'image',categoryPath:file,relativePath:category+'/'+file}));
 const media=assetCatalog.map(a=>({id:a.id,kind:a.kind,path:'assets/'+a.id+(a.kind==='audio'?'.wav':'.png'),...(a.kind==='audio'?{sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:a.id==='music'?480000:48001}:{width:400,height:600})}));
 const parsed=parseScript(text,{characters:config.characters});
 return {config,media,report:{ok:!parsed.diagnostics.some(d=>d.severity==='error'),nodes:parsed.nodes,assetCatalog,bindings:parsed.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,status:'unvoiced'})),diagnostics:parsed.diagnostics}};
}
function good(f){const r=build(f);assert(r.project,JSON.stringify(r.diagnostics));assert.deepEqual(validateProject(r.project),[]);return r;}
function bad(f,code,line){const r=build(f);assert.equal(r.project,null);assert.deepEqual(r.sourceMap,{});assert(r.diagnostics.some(d=>d.code===code&&(line===undefined||d.line===line)),JSON.stringify(r.diagnostics));return r;}
test('schema3 default design locale title and unvoiced duration',()=>{const p=good(fixture()).project;assert.equal(p.schemaVersion,3);assert.equal(p.title,'剧本生成工程');assert.deepEqual(p.design,{width:960,height:540,fps:30});assert.equal(p.locale,'zh-CN');assert.equal(p.scene.durationFrames,90);assert.equal(p.scene.dialogues[0].voiceClips.length,0);assert.equal(p.characterDefinitions.length,1);});
test('pure frozen input and deterministic IDs/source map',()=>{const f=fixture();const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};const before=JSON.stringify(f);freeze(f);assert.deepEqual(good(f),good(f));assert.equal(JSON.stringify(f),before);assert(good(f).sourceMap['line-2'].objects.some(o=>o.type==='dialogue'));});
test('custom uniform unvoiced seconds independent from text length',()=>{const f=fixture('@出场 甲\n甲：短\n甲：长一点的句子');f.config.unvoicedDurationSeconds=1.1;assert.deepEqual(good(f).project.scene.dialogues.map(d=>d.endFrame-d.startFrame),[33,33]);});
test('voice ceil samples and preserve complete sample count',()=>{const f=fixture();Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});const p=good(f).project;assert.equal(p.scene.durationFrames,31);assert.equal(p.scene.dialogues[0].voiceClips[0].durationSamples,48001);});
test('one sample voice occupies minimum one frame',()=>{const f=fixture();f.media.find(m=>m.id==='voice').durationSamples=1;Object.assign(f.report.bindings[0],{status:'manual',resourceId:'voice'});assert.equal(good(f).project.scene.durationFrames,1);});
test('narrator has no fake character instance',()=>{const p=good(fixture('旁白：天亮了')).project;assert.equal(p.scene.dialogues[0].speakerId,'narrator');assert.equal(p.scene.characters.length,0);assert.equal(p.characterDefinitions.length,0);});
test('offstage dialogue explicitly blocked',()=>bad(fixture('甲：电话'), 'OFFSTAGE_DIALOGUE_UNSUPPORTED',1));
test('default expression mapping restored on each omitted dialogue',()=>{const p=good(fixture('@出场 甲\n甲[笑]：你好\n甲：再见')).project;assert.equal(evaluate(p,0).characters[0].resourceId,'smile');assert.equal(evaluate(p,90).characters[0].resourceId,'base');});
test('missing configured default mapping blocked',()=>{const f=fixture();delete f.config.characters[0].expressionImages.平常;bad(f,'DEFAULT_EXPRESSION_MISSING',1);});
test('missing explicit expression mapping blocked',()=>{const f=fixture('@出场 甲\n甲[笑]：你好');delete f.config.characters[0].expressionImages.笑;bad(f,'EXPRESSION_MAPPING_MISSING',2);});
test('no configured default uses base image',()=>{const f=fixture();delete f.config.characters[0].defaultExpression;assert.equal(evaluate(good(f).project,0).characters[0].resourceId,'base');});
test('duplicate entrances blocked',()=>bad(fixture('@出场 甲\n@出场 甲\n甲：你好'),'DUPLICATE_ENTRANCE',2));
test('same slot blocked',()=>bad(fixture('@出场 甲 双人左\n@出场 乙 双人左\n甲：你好'),'POSITION_OVERLAP',2));
test('cross-layout shared center blocked',()=>bad(fixture('@出场 甲 单人中\n@出场 乙 三人中\n甲：你好'),'POSITION_OVERLAP',2));
test('new entrances do not move previous and empty slots used',()=>{const p=good(fixture('@出场 甲\n甲：你好\n@出场 乙\n乙：你好')).project;assert.deepEqual(p.scene.characters.map(c=>c.x+c.width/2),[288,672]);});
test('full position does not alter default layout',()=>{const p=good(fixture('@出场 甲 三人中\n@出场 乙\n甲：你好')).project;assert.deepEqual(p.scene.characters.map(c=>c.x+c.width/2),[480,288]);});
for(const [layout,xs] of Object.entries({单人:[50],双人:[30,70],三人:[20,50,80],四人:[15,38,62,85]}))test('preset '+layout,()=>{const names=['甲','乙','丙','丁'].slice(0,xs.length),p=good(fixture('@布局 '+layout+'\n'+names.map(n=>'@出场 '+n).join('\n')+'\n甲：你好')).project;assert(p.scene.characters.every((c,i)=>Math.abs((c.x+c.width/2)/9.6-xs[i])<1e-9));assert(p.scene.characters.every(c=>c.y+c.height===486));});
test('reenter creates new instance and reuses definition',()=>{const p=good(fixture('@出场 甲\n甲：你好\n@退场 甲\n@出场 甲\n甲：再见')).project;assert.equal(p.scene.characters.length,2);assert.notEqual(p.scene.characters[0].id,p.scene.characters[1].id);assert.equal(p.characterDefinitions.length,1);assert.equal(p.scene.characters[0].visibleTo,90);});
test('instant enter-exit is error without time consumption',()=>bad(fixture('@出场 甲\n@退场 甲\n旁白：你好'),'ZERO_LENGTH_INSTANCE',2));
test('sfx keeps exact audio full length and extends scene',()=>{const f=fixture('旁白：你好\n@音效 ding.wav');f.media.find(m=>m.id==='sfx').durationSamples=1601;const p=good(f).project;assert.equal(p.scene.durationFrames,92);assert.equal(p.scene.audioTracks[0].durationSamples,1601);assert.equal(p.scene.dialogues[0].endFrame,90);});
test('sfx alone yields valid positive timeline',()=>assert.equal(good(fixture('@音效 ding.wav')).project.scene.durationFrames,31));
test('BGM requires explicit stop even short sources',()=>bad(fixture('@音乐 song.wav\n旁白：你好'),'BGM_FADE_PENDING',1));
test('BGM hard stop truncates samples at cursor',()=>{const r=good(fixture('@音乐 song.wav\n旁白：你好\n@音乐 停止'));assert.equal(r.project.scene.audioTracks[0].durationSamples,144000);assert(r.diagnostics.some(d=>d.code==='BGM_HARD_STOP_INITIAL_SLICE'));});
test('BGM replacement truncates previous and never extends scene',()=>{const p=good(fixture('@音乐 song.wav\n旁白：一\n@音乐 song.wav\n旁白：二\n@音乐 停止')).project;assert.equal(p.scene.durationFrames,180);assert.deepEqual(p.scene.audioTracks.map(t=>[t.startFrame,t.durationSamples]),[[0,144000],[90,144000]]);});
test('BGM stop respects shorter source and cannot invent samples',()=>{const f=fixture('@音乐 song.wav\n旁白：一\n@音乐 停止');f.media.find(m=>m.id==='music').durationSamples=1;assert.equal(good(f).project.scene.audioTracks[0].durationSamples,1);});
test('zero length BGM omitted with warning',()=>{const r=good(fixture('@音乐 song.wav\n@音乐 停止\n旁白：一'));assert.equal(r.project.scene.audioTracks.length,0);assert(r.diagnostics.some(d=>d.code==='ZERO_LENGTH_AUDIO_OMITTED'));});
for(const text of ['# 标题','@视频 clip.mp4','@画面 淡出 1秒','@对白框 隐藏','@清字幕','@隐藏对白框','@显示对白框','@停顿 1秒'])test('unsupported explicit line: '+text,()=>bad(fixture('旁白：一\n'+text),text.startsWith('#')?'UNSUPPORTED_NODE':'UNSUPPORTED_COMMAND',2));
for(const text of ['@出场 甲 演出=淡入','@出场 甲 同时','@出场 甲 同时=否','@退场 甲 演出=淡出','@背景 room.png 转场=黑屏','@背景 room.png 时长=0秒','@音乐 停止 时长=1秒','@出场 甲 位置=坐标 x=20% y=90%'])test('unsupported parameter explicit line: '+text,()=>bad(fixture('旁白：一\n'+text),'UNSUPPORTED_PARAMETER',2));
test('section/comment are source records with zero time',()=>{const r=good(fixture('## 分段\n// 批注\n旁白：你好'));assert.equal(r.project.scene.durationFrames,90);assert.deepEqual(r.sourceMap['line-1'].objects,[]);});
test('long unicode codepoints rejected not UTF16 units',()=>{good(fixture('旁白：'+'😀'.repeat(80)));bad(fixture('旁白：'+'😀'.repeat(81)),'AUTO_PAGINATION_PENDING',1);});
test('more than two newlines rejected',()=>{good(fixture('旁白：一\n二\n三'));bad(fixture('旁白：一\n二\n三\n四'),'AUTO_PAGINATION_PENDING',1);});
test('terminal background and entrance omitted no zero objects',()=>{const r=good(fixture('旁白：你好\n@背景 room.png\n@出场 甲'));assert.equal(r.project.scene.characters.length,0);assert.equal(r.project.scene.backgroundEvents.length,0);assert(r.diagnostics.some(d=>d.code==='TERMINAL_STATE_OMITTED'));});
test('terminal expression pruned after valid instance',()=>{const p=good(fixture('@出场 甲\n甲：一\n@表情 甲 笑')).project;assert(p.scene.characters[0].expressionEvents.every(e=>e.frame<90));});
test('same frame background overwrite warns and keeps last only',()=>{const r=good(fixture('@背景 room.png\n@背景 room.png\n旁白：一'));assert.equal(r.project.scene.backgroundEvents.length,1);assert(r.diagnostics.some(d=>d.code==='STATE_EVENT_REPLACED'));});
test('resource output whitelist drops metadata and image dimensions',()=>{const f=fixture();f.media[0].category='character';f.media[0].absolutePath='C:/secret';f.media[0].arbitrary={bad:true};const p=good(f).project;assert.deepEqual(Object.keys(p.resources.find(r=>r.id==='base')).sort(),['id','kind','path']);});
test('resource category reference resolution and ambiguous rejection',()=>{const f=fixture('@背景 room.png\n旁白：一');f.report.assetCatalog.push({...f.report.assetCatalog.find(a=>a.id==='bg'),id:'bg2',relativePath:'background/sub/room.png',categoryPath:'sub/room.png'});bad(f,'RESOURCE_AMBIGUOUS',1);f.report.nodes[0].args.文件='sub/room.png';bad(f,'RESOURCE_UNAVAILABLE',1);f.media.push({id:'bg2',kind:'image',path:'assets/bg2.png'});good(f);});
test('malformed and escaped media paths blocked',()=>{for(const path of ['../evil','/evil','C:\\evil','assets/../evil','\\\\server\\evil','assets//evil']){const f=fixture();f.media[0].path=path;bad(f,'INVALID_MEDIA');}});
test('invalid audio facts rejected',()=>{for(const patch of [{sampleRate:44100},{bitsPerSample:24},{channels:3},{durationSamples:0},{durationSamples:1.5}]){const f=fixture();Object.assign(f.media.find(m=>m.id==='voice'),patch);bad(f,'INVALID_AUDIO_MEDIA');}});
test('duplicate catalog/media/bindings/nodes rejected',()=>{for(const [key,code] of [['assetCatalog','INVALID_CATALOG'],['bindings','INVALID_BINDING'],['nodes','INVALID_NODE']]){const f=fixture();f.report[key].push(f.report[key][0]);bad(f,code);}const f=fixture();f.media.push(f.media[0]);bad(f,'INVALID_MEDIA');});
test('unresolved binding is not silently unvoiced',()=>{const f=fixture();f.report.bindings[0].status='unresolved';bad(f,'VOICE_BINDING_UNRESOLVED',2);});
test('preflight errors fail atomically',()=>{const f=fixture();f.report.diagnostics.push({severity:'error',code:'TEST_ERROR',line:2,message:'bad'});bad(f,'TEST_ERROR',2);});
test('empty timeline rejected',()=>bad(fixture('## empty'),'EMPTY_TIMELINE'));
test('invalid input returns diagnostics never throws',()=>{for(const x of [null,{},[],{report:{}},undefined])bad(x,'INVALID_INPUT');});
test('image aspect ratio cap and fallback',()=>{const f=fixture();f.media[0].width=100000;f.media[0].height=1;assert.equal(good(f).project.scene.characters[0].width,8192);delete f.media[0].width;delete f.media[0].height;assert.equal(good(f).project.scene.characters[0].width,240);});
test('unused character mapping need not be present',()=>{const f=fixture('旁白：你好');f.config.characters[0].image='missing.png';good(f);});
function schema4(text){const f=fixture(text);f.schemaVersion=4;f.paginationPlan=f.report.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,pages:[{start:0,end:n.text.length,text:n.text}]}));return f;}
test('schema4 BGM tail stop replacement fade inside existing clip without scene extension',()=>{
  for(const suffix of ['', '\n@音乐 停止','\n@音乐 song.wav\n旁白：二']){
    const f=schema4('@音乐 song.wav\n旁白：一'+suffix),before=structuredClone(f),r=good(f),p=r.project;
    assert.equal(p.scene.durationFrames,suffix.includes('旁白：二')?180:90);
    for(const track of p.scene.audioTracks){assert.equal(track.durationSamples,144000);assert.equal(track.fadeOutSamples,24000);}
    assert(!r.diagnostics.some(d=>['BGM_FADE_PENDING','BGM_HARD_STOP_INITIAL_SLICE'].includes(d.code)));assert.deepEqual(f,before);
    assert(r.sourceMap['line-1'].objects.some(o=>o.type==='audioTrack'));
  }
});
test('schema4 BGM explicit stop seconds override default and zero disables fade',()=>{
  for(const [seconds,fade] of [[0,undefined],[1,48000],[10,144000]]){
    const f=schema4('@音乐 song.wav\n旁白：一\n@音乐 停止(时长='+seconds+'秒)'),p=good(f).project;
    assert.equal(p.scene.audioTracks[0].fadeOutSamples,fade);assert.equal(p.scene.durationFrames,90);
  }
  const f=schema4('@音乐 song.wav\n旁白：一');f.config.bgmFadeOutSeconds=0;assert.equal(good(f).project.scene.audioTracks[0].fadeOutSamples,undefined);
});
test('schema4 BGM short source and pending SFX tail never stretch music',()=>{
  const f=schema4('@音乐 song.wav\n旁白：一\n@音效 ding.wav');f.media.find(m=>m.id==='music').durationSamples=123;
  const p=good(f).project;assert.equal(p.scene.durationFrames,121);const t=p.scene.audioTracks.find(t=>t.kind==='bgm');assert.equal(t.durationSamples,123);assert.equal(t.fadeOutSamples,123);
});
test('schema4 music file duration and unknown animation are rejected',()=>{
  bad(schema4('@音乐 song.wav(时长=1秒)\n旁白：一'),'UNSUPPORTED_PARAMETER');
  const f=schema4('@音乐 song.wav\n旁白：一');f.report.nodes[0].args.演出='神秘';bad(f,'UNSUPPORTED_PARAMETER');
});
function videoFixture(text,withAudio=true){const f=schema4(text);f.report.assetCatalog.push({id:'video',kind:'video',category:'video',categoryPath:'clip.mp4',relativePath:'video/clip.mp4'});f.media.push({id:'video',kind:'video',path:'assets/video.mp4',mime:'video/mp4',width:640,height:360,fps:30,frameCount:30,normalizationVersion:1,...(withAudio?{audioResourceId:'video_audio'}:{})});if(withAudio)f.media.push({id:'video_audio',kind:'audio',path:'assets/video_audio.wav',mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:48000});return f;}
test('D video resource derivative clip source mapping and held dialogue preserve state',()=>{
 const f=videoFixture('@背景 room.png\n@出场 甲\n甲：一\n@视频 clip.mp4\n@停顿 1秒'),before=structuredClone(f),r=good(f),p=r.project,d=p.scene.dialogues[0];assert.deepEqual(f,before);
 assert.equal(p.scene.durationFrames,150);assert.deepEqual(p.scene.videoClips.map(v=>[v.startFrame,v.endFrame]),[[90,120]]);assert.equal(d.endFrame,90);assert.equal(d.pages[0].endFrame,90);assert.equal(d.displayUntilFrame,150);assert.equal(p.scene.backgroundEvents[0].background.resourceId,'bg');assert.equal(p.scene.characters[0].visibleTo,150);
 assert.deepEqual(r.sourceMap['line-4'].objects,[{type:'videoClip',id:p.scene.videoClips[0].id}]);const video=p.resources.find(r=>r.kind==='video');assert.equal(video.width,640);assert.equal(video.height,360);assert.equal(video.audioResourceId,'video_audio');assert(p.resources.some(r=>r.id==='video_audio'));assert.deepEqual(p.scene.audioTracks,[]);
});
test('D multiple BGM restart resets source offset and maps all tracks only to original music',()=>{
 const r=good(videoFixture('@音乐 song.wav\n@停顿 1秒\n@视频 clip.mp4\n@停顿 1秒\n@视频 clip.mp4\n@停顿 1秒')),tracks=r.project.scene.audioTracks;
 assert.deepEqual(tracks.map(t=>[t.startFrame,t.durationSamples,t.sourceOffsetSamples]),[[0,48000,0],[60,48000,0],[120,48000,0]]);assert.equal(new Set(tracks.map(t=>t.id)).size,3);assert.deepEqual(tracks.map(t=>t.fadeOutSamples),[undefined,undefined,24000]);assert.equal(r.sourceMap['line-1'].objects.filter(o=>o.type==='audioTrack').length,3);for(const line of [3,5])assert.deepEqual(r.sourceMap['line-'+line].objects.map(o=>o.type),['videoClip']);
});
test('D continuous videos omit zero BGM restarts yet resume after final video',()=>{
 const r=good(videoFixture('@音乐 song.wav\n@视频 clip.mp4\n@视频 clip.mp4\n@停顿 1秒'));assert.deepEqual(r.project.scene.audioTracks.map(t=>[t.startFrame,t.durationSamples]),[[60,48000]]);assert.equal(r.sourceMap['line-1'].objects.length,1);assert.equal(r.project.scene.videoClips.length,2);
});
test('D stopped or naturally completed BGM never revives at video end',()=>{
 for(const stop of [false,true]){const f=videoFixture('@音乐 song.wav\n@停顿 1秒\n'+(stop?'@音乐 停止\n':'')+'@视频 clip.mp4\n@停顿 1秒');if(!stop)f.media.find(m=>m.id==='music').durationSamples=48000;const p=good(f).project;assert.equal(p.scene.audioTracks.length,1);assert.equal(p.scene.audioTracks[0].startFrame,0);}
});
test('D video cuts long and same-frame SFX, removes mappings and stale audio tail',()=>{
 for(const pause of ['', '@停顿 1秒\n']){const f=videoFixture('@音效 ding.wav\n'+pause+'@视频 clip.mp4');f.media.find(m=>m.id==='sfx').durationSamples=4800000;const r=good(f);assert.equal(r.project.scene.durationFrames,pause?60:30);assert.equal(r.project.scene.audioTracks.length,pause?1:0);assert.equal(r.sourceMap['line-1'].objects.length,pause?1:0);if(pause)assert.equal(r.project.scene.audioTracks[0].durationSamples,48000);}
});
test('D audio tail cuts retain simultaneous motion opacity and screen tails',()=>{
 const f=videoFixture('@出场 甲 演出=淡入 时长=3秒 同时\n@移动 甲 双人右 4秒 同时\n@画面 淡出 5秒 同时\n@音效 ding.wav\n@视频 clip.mp4');f.media.find(m=>m.id==='sfx').durationSamples=4800000;const p=good(f).project;assert.equal(p.scene.durationFrames,150);assert.equal(p.scene.characters[0].positionKeyframes.at(-1).frame,120);assert.equal(p.scene.performance.characterOpacity[0].endFrame,90);assert.equal(p.scene.performance.screenFades[0].endFrame,150);assert.deepEqual(p.scene.audioTracks,[]);
});
test('D voice remains exact and pages unchanged while final held display extends across video',()=>{
 const f=videoFixture('旁白：一\n@视频 clip.mp4');Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});const p=good(f).project,d=p.scene.dialogues[0];assert.equal(d.voiceClips[0].durationSamples,48001);assert.equal(d.endFrame,31);assert.equal(d.pages[0].endFrame,31);assert.equal(d.displayUntilFrame,61);assert.equal(p.scene.videoClips[0].startFrame,31);
});
test('D strict normalized media and derived identity validation',()=>{
 for(const patch of [{fps:24},{frameCount:0},{frameCount:1801},{frameCount:1.5},{normalizationVersion:2},{width:0},{height:null},{mime:'video/webm'},{audioResourceId:'bad id'},{audioResourceId:'voice'}]){const f=videoFixture('@视频 clip.mp4');Object.assign(f.media.find(m=>m.kind==='video'),patch);assert.equal(build(f).project,null,JSON.stringify(patch));}
 for(const patch of [{durationSamples:47999},{channels:1},{sampleRate:44100},{bitsPerSample:24},{mime:'audio/mpeg'}]){const f=videoFixture('@视频 clip.mp4');Object.assign(f.media.find(m=>m.id==='video_audio'),patch);assert.equal(build(f).project,null);}
 const f=videoFixture('@视频 clip.mp4');f.media.push({...f.media.at(-1),id:'unknown'});bad(f,'INVALID_MEDIA');const duplicate=videoFixture('@视频 clip.mp4');duplicate.media.push({...duplicate.media.at(-1)});bad(duplicate,'INVALID_MEDIA');const missing=videoFixture('@视频 clip.mp4');missing.media.pop();bad(missing,'INVALID_VIDEO_AUDIO_MEDIA');
 const silent=good(videoFixture('@视频 clip.mp4',false)).project;assert.equal(silent.resources.length,1);assert.equal(silent.resources[0].audioResourceId,undefined);
});
test('D video refuses extra parameters and schema3',()=>{const f=videoFixture('@视频 clip.mp4');f.report.nodes[0].args.同时=true;bad(f,'UNSUPPORTED_PARAMETER');const old=videoFixture('@视频 clip.mp4');old.schemaVersion=3;assert.equal(build(old).project,null);});
function splitPlan(f,cuts){const n=f.report.nodes.find(n=>n.type==='dialogue');let start=0;f.paginationPlan[0].pages=[...cuts,n.text.length].map(end=>{const page={start,end,text:n.text.slice(start,end)};start=end;return page;});return f;}
test('builder accepts only numeric schema3/4',()=>{for(const schemaVersion of [1,2,5,'4',null])bad({...fixture(),schemaVersion},'UNSUPPORTED_SCHEMA');});
test('schema4 offstage definition requires no images or expression mappings',()=>{const f=schema4('甲[笑]：电话\n@表情 甲 笑\n@停顿 1秒');f.config.characters[0]={name:'甲',defaultExpression:'不存在',expressionImages:{笑:'missing.png'}};f.media=[];const r=good(f),p=r.project;assert.equal(p.scene.characters.length,0);assert.equal(p.resources.length,0);assert.equal(p.characterDefinitions[0].resourceId,undefined);assert.deepEqual(p.characterDefinitions[0].expressions,[]);assert.equal(p.scene.dialogues[0].speakerId,p.characterDefinitions[0].id);assert.equal(r.diagnostics.filter(d=>d.code==='EXPRESSION_OFFSTAGE'&&d.severity==='warning').length,2);assert.equal(evaluate(p,100).dialogues[0].visibleText,'电话');});
test('schema4 offstage configured images are not imported before entrance',()=>{const p=good(schema4('甲：电话')).project;assert.deepEqual(p.resources,[]);assert.equal(p.characterDefinitions[0].resourceId,undefined);});
test('schema4 entrance explicitly requires image',()=>{const f=schema4('甲：电话\n@出场 甲\n甲：到场');delete f.config.characters[0].image;bad(f,'CHARACTER_IMAGE_REQUIRED',2);});
test('schema4 later entrance hydrates existing definition without duplicate',()=>{const p=good(schema4('甲：电话\n@出场 甲\n甲[笑]：到场')).project;assert.equal(p.characterDefinitions.length,1);assert.equal(p.scene.dialogues[0].speakerId,p.scene.dialogues[1].speakerId);assert.equal(evaluate(p,90).characters[0].resourceId,'smile');});
test('schema4 long pages exact text one voice full samples and held final page evaluation',()=>{const text='长'.repeat(90)+'👨‍👩‍👧‍👦'+'末'.repeat(90),f=splitPlan(schema4('甲：'+text+'\n@停顿 1秒'),[90]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});const r=good(f),p=r.project,d=p.scene.dialogues[0];assert.equal(d.endFrame,31);assert.equal(d.displayUntilFrame,61);assert.equal(d.voiceClips.length,1);assert.equal(d.voiceClips[0].durationSamples,48001);assert.equal(d.fullText['zh-CN'],text);assert.equal(d.pages.map(x=>x.text['zh-CN']).join(''),text);assert.deepEqual(d.pages.map(x=>[x.startFrame,x.endFrame]),[[0,15],[15,31]]);assert.equal(r.sourceMap['line-1'].objects.filter(x=>x.type==='dialoguePage').length,2);assert.equal(evaluate(p,14).dialogues[0].visibleText,'长'.repeat(90));assert.equal(evaluate(p,31).dialogues[0].visibleText,d.pages[1].text['zh-CN']);assert.equal(evaluate(p,60).dialogues[0].held,true);const diagnosis={hasErrors:false,resources:{voice:{kind:'audio',exists:true,audio:{format:'wav',sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:48001}}}};const timeline=require('./audio-timeline.cjs').compileAudioTimeline(p,diagnosis);assert.equal(timeline.clips.length,1);assert.equal(timeline.clips[0].durationSamples,48001);});
test('schema4 single-page dialogues still carry formal pages/fullText/sourceMap',()=>{const r=good(schema4('旁白：单页'));const d=r.project.scene.dialogues[0];assert.equal(d.pages.length,1);assert.equal(d.fullText['zh-CN'],'单页');assert(r.sourceMap['line-1'].objects.some(o=>o.id===d.pages[0].id));});
test('schema4 default pause holds subtitle with endFrame unchanged',()=>{const p=good(schema4('旁白：一\n@停顿 1秒\n旁白：二')).project;assert.equal(p.scene.dialogues[0].endFrame,90);assert.equal(p.scene.dialogues[0].displayUntilFrame,120);assert.equal(evaluate(p,119).dialogues[0].visibleText,'一');assert.equal(evaluate(p,120).dialogues[0].id,p.scene.dialogues[1].id);});
for(const suffix of ['', '\n旁白：二', '\n@音效 ding.wav'])test('schema4 explicit false clears hold permanently '+suffix,()=>{const p=good(schema4('旁白：一\n@停顿 1秒\n@停顿 1秒 保留=false\n@停顿 1秒'+suffix)).project;assert.equal(p.scene.dialogues[0].displayUntilFrame,120);assert.equal(p.scene.dialogues[0].endFrame,90);assert.deepEqual(evaluate(p,120).dialogues,[]);assert.deepEqual(evaluate(p,179).dialogues,[]);});
test('schema4 rejects missing plan even single page',()=>{const f=schema4('旁白：一');f.paginationPlan=[];bad(f,'PAGINATION_PLAN_REQUIRED',1);});
for(const [name,mutate] of [
 ['non-array',f=>f.paginationPlan={}],['unknown node',f=>f.paginationPlan[0].nodeId='missing'],['duplicate',f=>f.paginationPlan.push(f.paginationPlan[0])],['empty',f=>f.paginationPlan[0].pages=[]],['extra keys',f=>f.paginationPlan[0].pages[0].startFrame=0],['wrong text',f=>f.paginationPlan[0].pages[0].text='改'],['gap',f=>f.paginationPlan[0].pages[0].start=1],['incomplete',f=>{f.paginationPlan[0].pages[0]={start:0,end:1,text:'一'};}],['fraction',f=>f.paginationPlan[0].pages[0].end=1.5],['null page',f=>f.paginationPlan[0].pages=[null]]
])test('schema4 invalid plan '+name,()=>{const f=schema4('旁白：一二');mutate(f);bad(f,'INVALID_PAGINATION_PLAN');});
for(const text of ['e\u0301好','👨‍👩‍👧‍👦好','😀好','🇨🇳好'])test('schema4 refuses grapheme split '+text,()=>bad(splitPlan(schema4('旁白：'+text),[1]),'INVALID_PAGINATION_PLAN'));
for(const count of [2,3])test('schema4 unvoiced '+count+' exact pages each round fractional seconds before multiplication',()=>{
 const f=splitPlan(schema4('旁白：一二三四五六\n旁白：随后'),count===2?[3]:[2,4]);f.config.unvoicedDurationSeconds=1.01;
 const before=structuredClone(f),p=good(f).project,[d,next]=p.scene.dialogues;
 assert.deepEqual(d.pages.map(x=>x.endFrame-x.startFrame),Array(count).fill(31));
 assert.deepEqual(d.pages.map(x=>[x.startFrame,x.endFrame]),Array.from({length:count},(_,i)=>[31*i,31*(i+1)]));
 assert.equal(d.endFrame,31*count);assert.equal(next.startFrame,31*count);assert.equal(p.scene.durationFrames,31*(count+1));
 assert.equal(d.fullText['zh-CN'],'一二三四五六');assert.deepEqual(f,before);
});
test('schema4 defaults to three seconds per actual page while schema3 remains one duration',()=>{
 const f=splitPlan(schema4('旁白：一二三'),[1,2]);assert.equal(good(f).project.scene.durationFrames,270);
 f.schemaVersion=3;const p=good(f).project;assert.equal(p.scene.durationFrames,90);assert.equal(p.scene.dialogues[0].pages,undefined);
});
for(const keep of [true,false])test('schema4 multiplied pages shift holds, state commands, audio starts and terminal tail '+keep,()=>{
 const f=splitPlan(schema4('@出场 甲\n@音乐 song.wav\n甲：一二三四五六\n@停顿 0.5秒 保留='+keep+'\n@音乐 停止\n@音乐 song.wav\n@背景 room.png\n@表情 甲 笑\n@退场 甲\n@出场 乙\n@音效 ding.wav\n乙：随后\n@音乐 停止\n@音效 ding.wav'),[2,4]);
 f.config.unvoicedDurationSeconds=1.01;const p=good(f).project,[first,next]=p.scene.dialogues;
 assert.equal(first.endFrame,93);assert.equal(first.displayUntilFrame,keep?108:93);
 assert.equal(next.startFrame,108);assert.equal(next.endFrame,139);assert.equal(p.scene.durationFrames,170);
 assert.equal(next.displayUntilFrame,170);assert.equal(p.scene.backgroundEvents[0].frame,108);
 assert.deepEqual(p.scene.characters.map(c=>[c.visibleFrom,c.visibleTo]),[[0,108],[108,170]]);
 assert(p.scene.characters[1].expressionEvents.some(e=>e.frame===108));
 assert.deepEqual(p.scene.audioTracks.filter(t=>t.kind==='bgm').map(t=>[t.startFrame,t.durationSamples]),[[0,108*1600],[108,31*1600]]);
 assert.deepEqual(p.scene.audioTracks.filter(t=>t.kind==='sfx').map(t=>[t.startFrame,t.durationSamples]),[[108,48001],[139,48001]]);
 assert.equal(evaluate(p,107).dialogues.length,keep?1:0);if(keep)assert.equal(evaluate(p,107).dialogues[0].visibleText,'五六');
 assert.equal(evaluate(p,108).dialogues[0].id,next.id);
});
test('schema4 explicit character expression event follows expanded page cursor',()=>{
 const f=splitPlan(schema4('@出场 甲\n旁白：一二三\n@表情 甲 笑\n旁白：随后\n@退场 甲'),[1,2]);f.config.unvoicedDurationSeconds=1.01;
 const p=good(f).project,c=p.scene.characters[0];assert.deepEqual(c.expressionEvents.map(e=>e.frame),[0,93]);assert.equal(c.visibleTo,124);assert.equal(evaluate(p,93).characters[0].resourceId,'smile');
});
test('schema4 voiced three-page duration stays sample based despite unvoiced setting',()=>{
 const f=splitPlan(schema4('旁白：一二三'),[1,2]);f.config.unvoicedDurationSeconds=1.01;Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});
 const p=good(f).project,d=p.scene.dialogues[0];assert.equal(d.endFrame,31);assert.equal(p.scene.durationFrames,31);assert.deepEqual(d.pages.map(p=>p.endFrame-p.startFrame),[10,10,11]);assert.equal(d.voiceClips.length,1);assert.equal(d.voiceClips[0].durationSamples,48001);
 f.media.find(m=>m.id==='voice').durationSamples=1601;bad(f,'PAGINATION_EXCEEDS_FRAMES',1);
});
test('schema4 duration overflow after valid prior nodes fails atomically without modifying input',()=>{
 const f=splitPlan(schema4('旁白：一二\n@停顿 1秒\n旁白：三'),[1]);
 const pause=f.report.nodes.find(n=>n.name==='停顿');pause.args.时长=(Number.MAX_SAFE_INTEGER-200)/30;
 f.config.unvoicedDurationSeconds=3;const before=structuredClone(f);bad(f,'INVALID_DURATION',3);assert.deepEqual(f,before);
});
test('schema4 default page hold reserves18 frames after reveal completion without changing90-frame duration',()=>{const p=good(schema4('旁白：完整显示')).project,d=p.scene.dialogues[0],page=d.pages[0];assert.equal(d.endFrame,90);assert.equal(page.revealFrames,72);assert(evaluate(p,70).dialogues[0].progress<1);for(let f=71;f<90;f++)assert.equal(evaluate(p,f).dialogues[0].progress,1);assert.equal(90-(71+1),18);});
test('schema4 short voice pages cap hold at40percent and preserve one parent clip',()=>{const f=splitPlan(schema4('旁白：一二三'),[1,2]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});f.media.find(m=>m.id==='voice').durationSamples=48000;const p=good(f).project,d=p.scene.dialogues[0];assert.equal(d.endFrame,30);assert.deepEqual(d.pages.map(p=>p.revealFrames),[6,6,6]);assert.equal(d.voiceClips.length,1);assert.equal(d.voiceClips[0].durationSamples,48000);});
test('schema4 page hold disabled, maximum capped, fractional ceil and one-frame minimum',()=>{const f=schema4('旁白：完整');f.config.dialoguePageHoldSeconds=0;assert.equal(good(f).project.scene.dialogues[0].pages[0].revealFrames,90);f.config.dialoguePageHoldSeconds=60;assert.equal(good(f).project.scene.dialogues[0].pages[0].revealFrames,54);f.config.dialoguePageHoldSeconds=.01;assert.equal(good(f).project.scene.dialogues[0].pages[0].revealFrames,89);f.config.unvoicedDurationSeconds=.001;assert.equal(good(f).project.scene.dialogues[0].pages[0].revealFrames,1);});
test('schema3 keeps reveal1 when page hold config is provided',()=>{const f=fixture();f.config.dialoguePageHoldSeconds=60;const d=good(f).project.scene.dialogues[0];assert.equal(d.revealFrames,1);assert.equal(d.pages,undefined);assert.equal(d.endFrame,90);});
for(const value of [null,-1,60.01,NaN,Infinity,'0.6',true])test('reject invalid page hold '+String(value),()=>{const f=schema4('旁白：一');f.config.dialoguePageHoldSeconds=value;const before=structuredClone(f);bad(f,'INVALID_PAGE_HOLD_SECONDS');assert.deepEqual(f,before);});
for(const value of [null,0,1001,1.5,NaN,Infinity,'3',true])test('reject invalid max characters '+String(value),()=>{const f=schema4('旁白：一');f.config.dialoguePageMaxCharacters=value;bad(f,'INVALID_PAGE_MAX_CHARACTERS');});
test('page max counts graphemes rather than UTF16 or codepoints and rejects oversized page atomically',()=>{const text='👨‍👩‍👧‍👦e\u0301🇨🇳',f=schema4('旁白：'+text);f.config.dialoguePageMaxCharacters=3;assert.equal(good(f).project.scene.dialogues[0].fullText['zh-CN'],text);f.config.dialoguePageMaxCharacters=2;const before=structuredClone(f);bad(f,'PAGINATION_PAGE_TOO_LONG',1);assert.deepEqual(f,before);splitPlan(f,['👨‍👩‍👧‍👦'.length]);assert.equal(good(f).project.scene.dialogues[0].pages.length,2);});
test('page cap is optional and accepts endpoints1 and1000',()=>{for(const cap of [1,1000]){const f=schema4('旁白：字');f.config.dialoguePageMaxCharacters=cap;good(f);}good(schema4('旁白：'+ '字'.repeat(1001)));});
test('auto different page lengths accumulate and preserve hold-clear/pause cursors',()=>{const f=splitPlan(schema4('旁白：'+ '字'.repeat(70)+'\n@停顿 0.5秒\n旁白：随后\n@停顿 0.5秒 保留=否\n旁白：结束'),[10]);f.config.unvoicedTimingMode='auto';const before=structuredClone(f),p=good(f).project,[a,b,c]=p.scene.dialogues;assert.deepEqual(a.pages.map(q=>[q.startFrame,q.endFrame,q.revealFrames]),[[0,90,10],[90,339,60]]);assert.equal(a.displayUntilFrame,354);assert.equal(b.startFrame,354);assert.equal(b.endFrame,444);assert.equal(b.displayUntilFrame,444);assert.equal(c.startFrame,459);assert.equal(p.scene.durationFrames,549);assert.deepEqual(f,before);});
test('auto mode never alters voiced frames page distribution reveal or clips',()=>{const f=splitPlan(schema4('旁白：一二三'),[1,2]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});f.media.find(m=>m.id==='voice').durationSamples=480000;const fixed=good(f).project;Object.assign(f.config,{unvoicedTimingMode:'auto',unvoicedMinimumSeconds:99,unvoicedReadingSpeed:1});assert.deepEqual(good(f).project,fixed);});
test('explicit fixed keeps old unequal text pages equal timing and reveal',()=>{const f=splitPlan(schema4('旁白：'+ '字'.repeat(70)),[10]),before=good(f).project;Object.assign(f.config,{unvoicedTimingMode:'fixed',unvoicedMinimumSeconds:200,unvoicedReadingSpeed:1});assert.deepEqual(good(f).project,before);});
test('explicit auto schema3 rejected atomically',()=>{const f=fixture();f.config.unvoicedTimingMode='auto';bad(f,'AUTO_TIMING_REQUIRES_SCHEMA4');});
for(const [key,value,code] of [['unvoicedTimingMode',null,'INVALID_UNVOICED_TIMING_MODE'],['unvoicedTimingMode','unknown','INVALID_UNVOICED_TIMING_MODE'],['unvoicedMinimumSeconds',0,'INVALID_UNVOICED_MINIMUM_SECONDS'],['unvoicedMinimumSeconds',3601,'INVALID_UNVOICED_MINIMUM_SECONDS'],['unvoicedReadingSpeed','8','INVALID_UNVOICED_READING_SPEED'],['dialogueRevealCharactersPerSecond',201,'INVALID_REVEAL_CHARACTERS_PER_SECOND']])test('auto config invalid atomic '+key+value,()=>{const f=schema4('旁白：一\n旁白：二');f.config[key]=value;const before=structuredClone(f);bad(f,code);assert.deepEqual(f,before);});
test('explicit voiced reveal speed changes only page reveals for48second four-page clip',()=>{const f=splitPlan(schema4('旁白：'+'字'.repeat(224)),[54,110,169]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});f.media.find(m=>m.id==='voice').durationSamples=2304000;f.config.dialoguePageHoldSeconds=.8;const before=good(f).project;f.config.dialogueRevealCharactersPerSecond=30;const after=good(f).project,d=after.scene.dialogues[0];assert.deepEqual(d.pages.map(p=>p.revealFrames),[54,56,59,55]);assert.equal(d.endFrame,1440);assert.equal(d.voiceClips.length,1);assert.equal(d.voiceClips[0].durationSamples,2304000);const expected=structuredClone(before);expected.scene.dialogues[0].pages.forEach((p,i)=>p.revealFrames=d.pages[i].revealFrames);assert.deepEqual(after,expected);for(const p of d.pages){assert(p.revealFrames>=1&&p.revealFrames<=60);assert.equal(evaluate(after,p.startFrame+p.revealFrames-1).dialogues[0].progress,1);}});
test('explicit voiced slow reveal clamps to short page budget without stretching clips',()=>{const f=splitPlan(schema4('旁白：一二三'),[1,2]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});f.media.find(m=>m.id==='voice').durationSamples=48000;Object.assign(f.config,{dialogueRevealCharactersPerSecond:1,dialoguePageHoldSeconds:60});const d=good(f).project.scene.dialogues[0];assert.deepEqual(d.pages.map(p=>p.revealFrames),[6,6,6]);assert.equal(d.endFrame,30);assert.equal(d.voiceClips[0].durationSamples,48000);});
test('schema3 explicit speed applies without pages while old absent reveal1 stays',()=>{const f=fixture('旁白：一二三');assert.equal(good(f).project.scene.dialogues[0].revealFrames,1);f.config.dialogueRevealCharactersPerSecond=30;let d=good(f).project.scene.dialogues[0];assert.equal(d.revealFrames,3);assert.equal(d.endFrame,90);assert.equal(d.pages,undefined);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});d=good(f).project.scene.dialogues[0];assert.equal(d.revealFrames,3);assert.equal(d.endFrame,31);assert.equal(d.voiceClips[0].durationSamples,48001);});
test('explicit speed affects fixed unvoiced reveal but never fixed durations',()=>{const f=splitPlan(schema4('旁白：'+'字'.repeat(70)),[10]);f.config.unvoicedTimingMode='fixed';const old=good(f).project;assert.deepEqual(old.scene.dialogues[0].pages.map(p=>p.revealFrames),[72,72]);f.config.dialogueRevealCharactersPerSecond=30;const updated=good(f).project;assert.deepEqual(updated.scene.dialogues[0].pages.map(p=>p.revealFrames),[10,60]);assert.deepEqual(updated.scene.dialogues[0].pages.map(p=>[p.startFrame,p.endFrame]),[[0,90],[90,180]]);});
test('movement endpoints midpoint and interval hold, shared seam mapping, deterministic pure lowering',()=>{
 const f=schema4('@出场 甲 双人左\n@移动 甲 双人右 1秒\n@停顿 1秒\n@移动 甲 三人中 1秒\n@移动 甲 双人左 1秒\n@停顿 1秒'),before=structuredClone(f),r=good(f),p=r.project,c=p.scene.characters[0],keys=c.positionKeyframes;
 assert.deepEqual(keys.map(k=>[k.frame,k.interpolation]),[[0,'linear'],[30,'hold'],[60,'linear'],[90,'linear'],[120,'hold']]);
 const center=f=>{const c=evaluate(p,f).characters[0];return c.x+c.width/2;};
 for(const [f,x] of [[0,288],[15,480],[29,659.2],[30,672],[45,672],[59,672],[60,672],[75,576],[90,480],[120,288],[149,288]])assert(Math.abs(center(f)-x)<1e-8);
 assert.equal(r.sourceMap['line-4'].objects[1].id,r.sourceMap['line-5'].objects[0].id);assert.deepEqual(f,before);assert.deepEqual(good(f),r);
});
test('movement accepts frozen input and checks safe cumulative frames',()=>{
 const f=schema4('@出场 甲\n@移动 甲 双人右 1秒'),freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}};freeze(f);good(f);
 const overflow=schema4('@出场 甲\n@停顿 1秒\n@移动 甲 双人右 1秒');overflow.report.nodes[1].args.时长=(Number.MAX_SAFE_INTEGER-1)/30;bad(overflow,'INVALID_DURATION',3);
 const initial=good(schema4('@出场 甲\n@停顿 1秒\n@移动 甲 双人右 1秒')).project;assert.equal(evaluate(initial,29).characters[0].x,initial.scene.characters[0].x);
});
test('movement min1 round no-op endpoint exit and fresh reentry',()=>{
 const p=good(schema4('@出场 甲\n@移动 甲 双人左 0.001秒\n@退场 甲\n@出场 甲\n@移动 甲 双人右 0.05秒')).project;
 assert.equal(p.scene.durationFrames,3);const [a,b]=p.scene.characters;assert.notEqual(a.id,b.id);assert.equal(a.visibleTo,1);assert.equal(a.positionKeyframes[1].frame,1);assert.equal(a.positionKeyframes[0].x,a.positionKeyframes[1].x);assert.deepEqual(b.positionKeyframes.map(k=>k.frame),[1,3]);
});
test('parallel independent moves only extend tail and release origins at completion',()=>{
 const p=good(schema4('@出场 甲 三人左\n@出场 乙 三人右\n@移动 甲 双人左 2秒 同时\n@移动 乙 双人右 1秒 同时\n@停顿 1秒\n@移动 乙 三人右 1秒 同时\n@停顿 1秒\n@出场 丙 三人左\n@移动 丙 单人中 1秒 同时')).project;
 assert.equal(p.scene.durationFrames,90);assert.deepEqual(p.scene.characters.map(c=>c.positionKeyframes.map(k=>k.frame)),[[0,60],[0,30,60],[60,90]]);
 const tail=good(schema4('@出场 甲\n@移动 甲 双人右 5秒 同时\n旁白：短')).project;assert.equal(tail.scene.dialogues[0].startFrame,0);assert.equal(tail.scene.durationFrames,150);
});
for(const [text,code] of [
 ['@移动 甲 双人右 1秒','MOVE_OFFSTAGE'],['@移动 旁白 双人右 1秒','MOVE_OFFSTAGE'],
 ['@出场 甲\n@移动 甲 双人右','INVALID_DURATION'],['@出场 甲\n@移动 甲 双人右 0秒','INVALID_DURATION'],
 ['@出场 甲\n@移动 甲 坐标 1秒 x=20% y=30%','UNSUPPORTED_PARAMETER'],
 ['@出场 甲\n@移动 甲 双人右 2秒 同时\n@移动 甲 三人中 1秒','ACTION_IN_PROGRESS'],
 ['@出场 甲\n@移动 甲 双人右 2秒 同时\n@退场 甲','ACTION_IN_PROGRESS'],
 ['@出场 甲\n@移动 甲 双人右 2秒 同时\n@出场 乙 双人左','POSITION_OVERLAP'],
 ['@出场 甲\n@移动 甲 双人右 2秒 同时\n@出场 乙 双人右','POSITION_OVERLAP'],
 ['@出场 甲\n@出场 乙\n@移动 甲 双人右 1秒','POSITION_OVERLAP']
])test('movement rejects atomically '+text,()=>bad(schema4(text),code));
test('movement strict duration and boolean validation even for constructed reports',()=>{for(const value of [undefined,0,-1,Infinity,NaN,'1',true,Number.MAX_VALUE]){const f=schema4('@出场 甲\n@移动 甲 双人右 1秒');f.report.nodes[1].args.时长=value;bad(f,'INVALID_DURATION');}const f=schema4('@出场 甲\n@移动 甲 双人右 1秒');f.report.nodes[1].args.同时='yes';bad(f,'UNSUPPORTED_PARAMETER');});
test('movement holds last subtitle without modifying pages or voice',()=>{
 const a=splitPlan(schema4('@出场 甲\n甲：一二'),[1]),b=splitPlan(schema4('@出场 甲\n甲：一二\n@移动 甲 双人右 1秒\n旁白：后'),[1]);for(const f of [a,b])Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});
 const before=good(a).project.scene.dialogues[0],p=good(b).project,d=p.scene.dialogues[0];assert.equal(d.endFrame,31);assert.equal(d.displayUntilFrame,61);assert.deepEqual(d.pages,before.pages);assert.deepEqual(d.voiceClips,before.voiceClips);assert.equal(evaluate(p,60).dialogues[0].held,true);assert.equal(evaluate(p,61).dialogues[0].text,'后');
});
test('C character fades wait by default and retain exact instance bounds and source types',()=>{
 const f=schema4('@出场 甲 演出=淡入\n@退场 甲 演出=淡出\n@出场 乙 双人左\n@停顿 1秒'),before=structuredClone(f),r=good(f),p=r.project;
 assert.deepEqual(p.scene.performance.characterOpacity.map(e=>[e.startFrame,e.endFrame,e.from,e.to]),[[0,15,0,1],[15,30,1,0]]);
 assert.deepEqual(p.scene.characters.map(c=>[c.visibleFrom,c.visibleTo]),[[0,30],[30,60]]);assert.equal(evaluate(p,0).characters[0].opacity,0);assert.equal(evaluate(p,15).characters[0].opacity,1);assert.equal(evaluate(p,30).characters.length,1);
 assert(r.sourceMap['line-1'].objects.some(o=>o.type==='characterOpacity'));assert.deepEqual(f,before);assert.deepEqual(good(f),r);
});
test('C simultaneous fade and movement are independent but exiting retains slot until end',()=>{
 const p=good(schema4('@出场 甲 演出=淡入 时长=1秒 同时\n@移动 甲 双人右 1秒 同时\n@停顿 1秒\n@退场 甲 演出=淡出 时长=2秒 同时\n@停顿 2秒\n@出场 甲 双人右\n@停顿 1秒')).project;
 assert.equal(p.scene.durationFrames,120);assert.deepEqual(p.scene.characters.map(c=>[c.visibleFrom,c.visibleTo]),[[0,90],[90,120]]);assert.equal(evaluate(p,15).characters[0].opacity,.5);assert.equal(evaluate(p,60).characters[0].opacity,.5);
 const tail=good(schema4('@出场 甲 演出=淡入 时长=4秒 同时')).project;assert.equal(tail.scene.durationFrames,120);assert.equal(tail.scene.characters[0].visibleTo,120);
 const exit=good(schema4('@出场 甲\n@退场 甲 演出=淡出 时长=1秒 同时\n@停顿 2秒')).project;assert.equal(exit.scene.characters[0].visibleTo,30);
});
for(const [source,code] of [
 ['@出场 甲 演出=淡入 同时\n@退场 甲','ACTION_IN_PROGRESS'],
 ['@出场 甲 演出=淡入 同时\n@出场 甲','DUPLICATE_ENTRANCE'],
 ['@出场 甲\n@移动 甲 双人右 1秒 同时\n@退场 甲 演出=淡出','ACTION_IN_PROGRESS'],
 ['@出场 甲\n@退场 甲 演出=淡出 同时\n@出场 乙 双人左','POSITION_OVERLAP'],
 ['@出场 甲\n@退场 甲 演出=淡出 同时\n@移动 甲 双人右 1秒','ACTION_IN_PROGRESS'],
 ['@出场 甲\n@退场 甲 演出=淡出 同时\n@退场 甲 演出=淡出','ACTION_IN_PROGRESS'],
 ['@出场 甲 演出=淡入 时长=0秒','INVALID_DURATION'],
 ['@画面 淡出 时长=0秒','INVALID_DURATION'],
 ['@画面 淡出 同时\n@画面 淡入','ACTION_IN_PROGRESS'],
 ['@画面 淡出\n@背景 room.png 转场=黑屏','SCREEN_TRANSITION_CONFLICT'],
 ['@画面 淡出 同时\n@背景 room.png 转场=黑屏','SCREEN_TRANSITION_CONFLICT'],
 ['@背景 room.png 转场=黑屏 同时','UNSUPPORTED_PARAMETER'],
 ['@背景 room.png 转场=淡入','UNSUPPORTED_PARAMETER']
])test('C rejects conflict atomically '+source,()=>bad(schema4(source),code));
test('C screen fades preserve current mask value, wait defaults, and simultaneous tail',()=>{
 const r=good(schema4('@画面 淡出\n@画面 淡出 时长=1秒\n@画面 淡入 同时\n旁白：一')),p=r.project;
 assert.deepEqual(p.scene.performance.screenFades.map(e=>[e.startFrame,e.endFrame,e.from,e.to]),[[0,12,0,1],[12,42,1,1],[42,54,1,0]]);assert.equal(p.scene.dialogues[0].startFrame,42);assert.equal(evaluate(p,6).performance.screenOpacity,.5);assert.equal(evaluate(p,48).performance.screenOpacity,.5);assert.equal(evaluate(p,54).performance.screenOpacity,0);assert(r.sourceMap['line-1'].objects.some(o=>o.type==='screenFade'));
 assert.equal(good(schema4('@画面 淡出 时长=4秒 同时\n旁白：一')).project.scene.durationFrames,120);
});
test('C black background transition splits odd total frames and minimum2 at midpoint',()=>{
 for(const [seconds,frames] of [[.001,2],[.1,3],[1,30]]){const r=good(schema4('@背景 room.png 转场=黑屏 时长='+seconds+'秒')),p=r.project,mid=Math.floor(frames/2);assert.equal(p.scene.durationFrames,frames);assert.equal(p.scene.backgroundEvents[0].frame,mid);assert.deepEqual(p.scene.performance.screenFades.map(e=>[e.startFrame,e.endFrame]),[[0,mid],[mid,frames]]);assert.equal(evaluate(p,mid).background.resourceId,'bg');assert.equal(evaluate(p,mid).performance.screenOpacity,1);assert.equal(r.sourceMap['line-1'].objects.filter(o=>o.type==='screenFade').length,2);}
 good(schema4('@画面 淡出\n@画面 淡入\n@背景 room.png 转场=黑屏'));
});
test('C title literal is independent black card with defaults and preserved audio and scene',()=>{
 const text='<script>${process.exit()} & 标题',r=good(schema4('@音乐 song.wav\n@背景 room.png\n@出场 甲\n# '+text+'\n@音乐 停止\n旁白：后')),p=r.project,t=p.scene.performance.titles[0];
 assert.deepEqual({...t,id:undefined},{id:undefined,startFrame:0,endFrame:90,fadeInFrames:15,fadeOutFrames:15,text});assert.equal(p.scene.dialogues[0].startFrame,90);assert.equal(p.scene.audioTracks[0].durationSamples,144000);assert.equal(evaluate(p,30).performance.title.text,text);assert.equal(evaluate(p,90).performance.title,null);assert.equal(evaluate(p,90).characters.length,1);assert.equal(evaluate(p,90).background.resourceId,'bg');assert.deepEqual(r.sourceMap['line-4'].objects,[{type:'title',id:t.id}]);
});
test('C configurable title phases round independently and allow zero phases but positive total',()=>{
 const f=schema4('# 卡');Object.assign(f.config,{titleFadeInSeconds:0,titleHoldSeconds:.001,titleFadeOutSeconds:0});let p=good(f).project;assert.equal(p.scene.durationFrames,1);assert.equal(p.scene.performance.titles[0].fadeInFrames,0);assert.equal(evaluate(p,0).performance.title.opacity,1);
 Object.assign(f.config,{titleFadeInSeconds:.05,titleHoldSeconds:.05,titleFadeOutSeconds:.05});p=good(f).project;assert.equal(p.scene.durationFrames,6);assert.equal(p.scene.performance.titles[0].fadeOutFrames,2);
});
test('C clear visibility are instantaneous events with source-order replacement and terminal pruning',()=>{
 const r=good(schema4('旁白：一\n@清字幕\n@清字幕\n@对白框 隐藏\n@显示对白框\n@停顿 1秒\n旁白：二\n@隐藏对白框\n@清字幕')),p=r.project,perf=p.scene.performance;
 assert.equal(p.scene.durationFrames,210);assert.equal(p.scene.dialogues[0].endFrame,90);assert.equal(p.scene.dialogues[1].startFrame,120);assert.deepEqual(perf.dialogueClears.map(e=>e.frame),[90]);assert.deepEqual(perf.dialogueVisibility.map(e=>[e.frame,e.visible]),[[90,true]]);assert.deepEqual(evaluate(p,100).dialogues,[]);assert.equal(evaluate(p,120).dialogues.length,1);for(const line of [2,4,8,9])assert.deepEqual(r.sourceMap['line-'+line].objects,[]);assert(r.diagnostics.some(d=>d.code==='STATE_EVENT_REPLACED'));assert(r.diagnostics.some(d=>d.code==='TERMINAL_STATE_OMITTED'));
});
test('C hidden dialogue retains complete voice and pages and becomes visible on show',()=>{
 const f=schema4('@隐藏对白框\n旁白：一\n@显示对白框\n@停顿 1秒');Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});const p=good(f).project,d=p.scene.dialogues[0];assert.equal(d.voiceClips[0].durationSamples,48001);assert.equal(d.endFrame,31);assert.deepEqual(evaluate(p,0).dialogues,[]);assert.equal(evaluate(p,31).dialogues.length,1);assert.equal(d.displayUntilFrame,61);
});
test('C no performance data is added for unchanged B script',()=>{assert.equal(good(schema4('旁白：一')).project.scene.performance,undefined);});
test('C explicit duration strict safe frames and positive minimum',()=>{
 for(const text of ['@画面 淡出 时长=.001秒','@出场 甲 演出=淡入 时长=.001秒'])assert.equal(good(schema4(text)).project.scene.durationFrames,1);
 for(const value of [null,0,-1,Infinity,NaN,'1',true,Number.MAX_VALUE]){const f=schema4('@画面 淡出');f.report.nodes[0].args.时长=value;bad(f,'INVALID_DURATION');}
 const f=schema4('@停顿 1秒\n@画面 淡出');f.report.nodes[0].args.时长=(Number.MAX_SAFE_INTEGER-1)/30;bad(f,'INVALID_DURATION',2);
});
test('schema4 pages cannot outnumber voice frames or stretch sound',()=>{const f=splitPlan(schema4('旁白：一二'),[1]);Object.assign(f.report.bindings[0],{status:'matched',resourceId:'voice'});f.media.find(m=>m.id==='voice').durationSamples=1;bad(f,'PAGINATION_EXCEEDS_FRAMES',1);});
