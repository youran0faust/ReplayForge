'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSourceRecord,validateSourceRecord}=require('./script-source-record.cjs');
const {parseScript}=require('./script-parser.cjs');
const {buildScriptProject}=require('./script-project-builder.cjs');
function fixture(text='## 分段\n// 注释\n@出场 甲\n@音乐 song.wav\n甲：你好\n@音乐 停止\n@退场 甲',schemaVersion=4){
 const config={version:1,characters:[{name:'甲',voiceCode:'A',image:'base.png'}]};
 const assetCatalog=[['base','character','base.png'],['bg','background','room.png'],['voice','voice','A_001_你好.wav'],['music','music','song.wav']].map(([id,category,file])=>({id,category,kind:['character','background'].includes(category)?'image':'audio',relativePath:category+'/'+file,categoryPath:file}));
 const parsed=parseScript(text,config);assert(!parsed.diagnostics.some(d=>d.severity==='error'));
 const report={nodes:parsed.nodes,bindings:parsed.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,status:'matched',resourceId:'voice',textBaseline:n.text})),assetCatalog,diagnostics:parsed.diagnostics};
 const media=assetCatalog.map(a=>({id:a.id,kind:a.kind,path:'assets/'+a.id+(a.kind==='image'?'.png':'.wav'),...(a.kind==='audio'?{sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:480000}:{width:400,height:600})}));
 const result=buildScriptProject({config,report,media,schemaVersion,paginationPlan:report.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,pages:[{start:0,end:n.text.length,text:n.text}]}))});
 assert(result.project,JSON.stringify(result.diagnostics));
 return {text,config,report,...result,mediaMappings:result.project.resources.map(r=>({resourceId:r.id,category:assetCatalog.find(a=>a.id===r.id).category,relativePath:assetCatalog.find(a=>a.id===r.id).relativePath,hash:'a'.repeat(64)}))};
}
const good=()=>createSourceRecord(fixture());
function videoFixture(audio=false){
 const f=fixture(),p=f.project,start=p.scene.durationFrames;
 f.text+='\n// 视频批注\n@视频 movie.mp4';f.report.nodes=parseScript(f.text,f.config).nodes;
 for(const n of f.report.nodes)f.sourceMap[n.id]??={objects:[]};
 const video={id:'video-original',kind:'video',path:'assets/normalized.mp4',mime:'video/mp4',width:960,height:540,fps:30,frameCount:30,normalizationVersion:1};
 if(audio){const hash=require('node:crypto').createHash('sha256').update(video.id).digest('hex');video.audioResourceId='video-audio_'+hash.slice(0,24);p.resources.push({id:video.audioResourceId,kind:'audio',path:'assets/derived.wav',mime:'audio/wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:48000});f.mediaMappings.push({resourceId:video.audioResourceId,category:'videoAudio',relativePath:'video-audio_'+hash+'.wav',hash:'b'.repeat(64)});}
 p.resources.push(video);p.scene.durationFrames=start+30;p.scene.videoClips=[{id:'video-clip',resourceId:video.id,startFrame:start,endFrame:start+30}];
 f.sourceMap[f.report.nodes.at(-1).id].objects=[{type:'videoClip',id:'video-clip'}];
 f.mediaMappings.push({resourceId:video.id,category:'video',relativePath:'视频/movie.mp4',hash:require('node:crypto').createHash('sha256').update('normalized managed bytes').digest('hex')});return f;
}
test('D video-cut and restarted music tracks remain mapped to original music node',()=>{const f=videoFixture(),p=f.project,t=p.scene.audioTracks[0],v=p.scene.videoClips[0],node=f.report.nodes.find(n=>n.name==='音乐'&&n.args.文件);v.startFrame=30;v.endFrame=60;t.durationSamples=30*1600;const restarted={...t,id:'restarted-bgm',startFrame:60,durationSamples:30*1600,sourceOffsetSamples:0};p.scene.audioTracks.push(restarted);f.sourceMap[node.id].objects.push({type:'audioTrack',id:restarted.id});p.scene.dialogues[0].voiceClips[0].durationSamples=30*1600;const r=createSourceRecord(f);assert.deepEqual(validateSourceRecord(r),[]);assert.equal(r.nodes.find(n=>n.nodeId===node.id).objects.filter(o=>o.type==='audioTrack').length,2);});
for(const audio of [false,true])test('D video source complete normalized record '+audio,()=>{const f=videoFixture(audio),r=createSourceRecord(f);assert.deepEqual(validateSourceRecord(r),[]);assert.deepEqual(validateSourceRecord(JSON.parse(JSON.stringify(r))),[]);assert(!Object.hasOwn(r.mediaMappings.at(-1),'inputHash'));});
for(const [name,mutate] of [
 ['missing clip mapping',r=>r.nodes.at(-1).objects=[]],
 ['foreign clip owner',r=>r.nodes[0].objects.push(...r.nodes.at(-1).objects)],
 ['wrong source path',r=>r.mediaMappings.find(m=>m.category==='video').relativePath='视频/other.mp4'],
 ['wrong derived category',r=>r.mediaMappings.find(m=>m.category==='videoAudio').category='sfx'],
 ['wrong derived id',r=>{const v=r.baselineProject.resources.find(r=>r.kind==='video'),a=r.baselineProject.resources.find(r=>r.id===v.audioResourceId),m=r.mediaMappings.find(m=>m.category==='videoAudio');v.audioResourceId=a.id=m.resourceId='arbitrary-audio';}],
 ['wrong derived path',r=>r.mediaMappings.find(m=>m.category==='videoAudio').relativePath='video-audio_'+'a'.repeat(64)+'.wav'],
 ['unsafe derived path',r=>r.mediaMappings.find(m=>m.category==='videoAudio').relativePath='../derived.wav'],
 ['duplicate mapping',r=>r.mediaMappings.push({...r.mediaMappings.find(m=>m.category==='videoAudio')})],
 ['unknown input hash',r=>r.mediaMappings.find(m=>m.category==='video').inputHash='a'.repeat(64)],
 ['wrong linked audio',r=>r.baselineProject.resources.find(r=>r.kind==='video').audioResourceId='voice'],
 ['unlinked derived audio',r=>delete r.baselineProject.resources.find(r=>r.kind==='video').audioResourceId],
 ['incomplete full video',r=>r.baselineProject.scene.videoClips[0].endFrame--]
])test('D strict video '+name,()=>{const r=createSourceRecord(videoFixture(true));mutate(r);assert(validateSourceRecord(r).length);});
test('D zero-trim voice keeps source binding only when video covers dialogue start',()=>{
 const f=videoFixture(),d=f.project.scene.dialogues[0];d.voiceClips=[];f.sourceMap[f.report.nodes.find(n=>n.type==='dialogue').id].objects=f.sourceMap[f.report.nodes.find(n=>n.type==='dialogue').id].objects.filter(o=>o.type!=='voiceClip');
 f.project.scene.videoClips[0].startFrame=d.startFrame;f.project.scene.videoClips[0].endFrame=d.startFrame+30;
 const r=createSourceRecord(f);assert.equal(r.bindings[0].resourceId,'voice');assert.deepEqual(validateSourceRecord(r),[]);r.baselineProject.scene.videoClips[0].startFrame+=30;r.baselineProject.scene.videoClips[0].endFrame+=30;assert(validateSourceRecord(r).some(e=>e.includes('binding differs')));
});
function performanceFixture(){
 const f=fixture(),p=f.project;p.scene.durationFrames+=100;
 f.text+='\n# 标题\n@画面 淡出 1秒\n@清字幕\n@对白框 隐藏\n@显示对白框\n@隐藏对白框';f.report.nodes=parseScript(f.text,f.config).nodes;
 const perf=p.scene.performance={version:1,characterOpacity:[],screenFades:[],dialogueVisibility:[],dialogueClears:[],titles:[]};
 const put=(node,key,type,value)=>{perf[key].push(value);(f.sourceMap[node.id]??={objects:[]}).objects.push({type,id:value.id});};
 const by=name=>f.report.nodes.find(n=>n.name===name);
 put(by('出场'),'characterOpacity','characterOpacity',{id:'opacity',characterId:p.scene.characters[0].id,startFrame:0,endFrame:1,from:.2,to:.8});
 put(f.report.nodes.find(n=>n.type==='title'),'titles','title',{id:'title',startFrame:0,endFrame:10,fadeInFrames:2,fadeOutFrames:2,text:'标题'});
 put(by('画面'),'screenFades','screenFade',{id:'screen',startFrame:0,endFrame:10,from:.1,to:.9});
 put(by('清字幕'),'dialogueClears','dialogueClear',{id:'clear',frame:1});
 ['对白框','显示对白框','隐藏对白框'].forEach((name,i)=>put(by(name),'dialogueVisibility','dialogueVisibility',{id:'visibility'+i,frame:i+1,visible:i===1}));
 return f;
}
test('C source indexes all performance types, optional arrays and edited values',()=>{const r=createSourceRecord(performanceFixture());assert.deepEqual(validateSourceRecord(r),[]);const f=fixture();f.project.scene.performance={version:1};assert.deepEqual(validateSourceRecord(createSourceRecord(f)),[]);});
for(const [name,mutate] of [
 ['missing coverage',r=>r.nodes.find(n=>n.baseline.type==='title').objects=[]],
 ['title text mismatch',r=>r.baselineProject.scene.performance.titles[0].text='不同'],
 ['foreign source type',r=>{const title=r.nodes.find(n=>n.baseline.type==='title');r.nodes[0].objects.push(...title.objects);title.objects=[];}],
 ['wrong role',r=>{const p=r.baselineProject;p.characterDefinitions[0].name='乙';}],
 ['duplicate performance owner',r=>r.nodes.find(n=>n.baseline.name==='退场').objects.push({type:'characterOpacity',id:'opacity'})],
 ['unknown shape',r=>r.baselineProject.scene.performance.titles[0].extra=1],
 ['schema3',r=>r.baselineProject.schemaVersion=3],
 ['bad C config',r=>r.config.titleHoldSeconds=-1]
])test('C source strict '+name,()=>{const r=createSourceRecord(performanceFixture());mutate(r);assert(validateSourceRecord(r).length);});
test('all C flat config keys accepted and validated',()=>{const f=performanceFixture();for(const key of ['titleFadeInSeconds','titleHoldSeconds','titleFadeOutSeconds','characterFadeSeconds','screenFadeSeconds','bgmFadeOutSeconds'])f.config[key]=.5;assert.deepEqual(validateSourceRecord(createSourceRecord(f)),[]);});
test('real parser/builder schema4 roundtrip, complete nodes, shared object mappings and detached data',()=>{
 const f=fixture(),before=structuredClone(f),r=createSourceRecord(f);assert.deepEqual(f,before);assert.deepEqual(validateSourceRecord(r),[]);assert.deepEqual(validateSourceRecord(JSON.parse(JSON.stringify(r))),[]);
 assert.deepEqual(r.nodes.map(n=>n.baseline),f.report.nodes);assert.deepEqual(r.nodes.map(n=>n.objects),f.report.nodes.map(n=>f.sourceMap[n.id].objects));
 r.config.characters[0].name='changed';assert.equal(f.config.characters[0].name,'甲');
});
test('schema3 source snapshot remains supported',()=>assert.deepEqual(validateSourceRecord(createSourceRecord(fixture(undefined,3))),[]));
test('snapshot strips existing scriptSource without recursing into it',()=>{const f=fixture();f.project.scriptSource=f.project;const r=createSourceRecord(f);assert(!Object.hasOwn(r.baselineProject,'scriptSource'));assert.deepEqual(validateSourceRecord(r),[]);});
test('reuse stable identities and allocate new UUID only to new nodes',()=>{const f=fixture(),r=createSourceRecord(f);f.report.identities=r.nodes.slice(0,2).map(({nodeId,stableId})=>({nodeId,stableId}));const second=createSourceRecord(f);assert.deepEqual(second.nodes.slice(0,2).map(n=>n.stableId),r.nodes.slice(0,2).map(n=>n.stableId));assert.notEqual(second.nodes[2].stableId,r.nodes[2].stableId);});
for(const identities of [[{nodeId:'missing',stableId:'bad'}],[{nodeId:'line-1',stableId:'00000000-0000-4000-8000-000000000001',extra:true}]])test('reject invalid imported identities '+JSON.stringify(identities),()=>{const f=fixture();f.report.identities=identities;assert.throws(()=>createSourceRecord(f));});
test('duplicate imported identities rejected',()=>{const f=fixture(),r=createSourceRecord(f);const id={nodeId:r.nodes[0].nodeId,stableId:r.nodes[0].stableId};f.report.identities=[id,id];assert.throws(()=>createSourceRecord(f));});
test('old voice text baseline preserved including reviewRequired',()=>{const r=good();r.bindings[0].textBaseline='改词之前';r.bindings[0].status='reviewRequired';assert.deepEqual(validateSourceRecord(r),[]);});
for(const [name,mutate] of [
 ['version',r=>r.version=2],['unknown root',r=>r.extra=1],['unknown config',r=>r.config.extra=1],['config version',r=>r.config.version=2],['unknown character',r=>r.config.characters[0].extra=1],['unknown baseline node',r=>r.nodes[0].baseline.extra=1],['unknown node',r=>r.nodes[0].extra=1],['unknown binding',r=>r.bindings[0].extra=1],['unknown mapping',r=>r.mediaMappings[0].extra=1],
 ['changed source',r=>r.text+='\n// changed'],['changed node',r=>r.nodes.find(n=>n.baseline.type==='dialogue').baseline.text='篡改'],['duplicate UUID',r=>r.nodes[1].stableId=r.nodes[0].stableId],['invalid UUID',r=>r.nodes[0].stableId='line-1'],['duplicate node',r=>r.nodes[1].nodeId=r.nodes[0].nodeId],['missing node',r=>r.nodes.pop()],
 ['missing object',r=>r.nodes.find(n=>n.objects.length).objects=[]],['unknown object',r=>r.nodes.find(n=>n.objects.length).objects[0].id='missing'],['unknown object type',r=>r.nodes.find(n=>n.objects.length).objects[0].type='resource'],['unknown object field',r=>r.nodes.find(n=>n.objects.length).objects[0].extra=1],['duplicate object',r=>{const n=r.nodes.find(n=>n.objects.length);n.objects.push(n.objects[0]);}],
 ['duplicate media',r=>r.mediaMappings.push(r.mediaMappings[0])],['missing media',r=>r.mediaMappings.pop()],['duplicate media path',r=>r.mediaMappings[1].relativePath=r.mediaMappings[0].relativePath.toUpperCase()],['invalid hash',r=>r.mediaMappings[0].hash='not hash'],['wrong media category',r=>r.mediaMappings[0].category='voice'],
 ['duplicate binding',r=>r.bindings.push(r.bindings[0])],['missing binding',r=>r.bindings=[]],['unresolved binding',r=>r.bindings[0].status='unresolved'],['wrong voice',r=>r.bindings[0].resourceId='music'],['unvoiced but clip exists',r=>r.bindings[0]={nodeId:r.bindings[0].nodeId,status:'unvoiced'}],
 ['baseline dialogue mismatch',r=>{const d=r.baselineProject.scene.dialogues[0];d.fullText['zh-CN']='改词';d.text['zh-CN']='改词';d.pages[0].text['zh-CN']='改词';}],['nested provenance',r=>r.baselineProject.scriptSource={}],['invalid baseline',r=>r.baselineProject.scene.durationFrames=-1],
 ['cycle',r=>r.config.cycle=r],['non finite',r=>r.config.unvoicedDurationSeconds=Infinity],['text size',r=>r.text='a'.repeat(1024*1024+1)],['deep',r=>{let n=r.config;for(let i=0;i<40;i++)n=n.deep={};}],['large nodes',r=>r.nodes=Array(10001).fill(r.nodes[0])],['unsafe key',r=>Object.defineProperty(r.config,'__proto__',{value:{},enumerable:true})],['getter',r=>Object.defineProperty(r.config,'evil',{get(){throw Error('must not execute');},enumerable:true})]
])test('strict rejection: '+name,()=>{const r=good();mutate(r);assert(validateSourceRecord(r).length,name);});
for(const path of ['../escape','/absolute','C:\\secret','\\\\server\\share','a/../evil','a//b','a/./b','a\\..\\b','a:stream','a\u0000b','a/con.png','a/trailing.'])test('unsafe saved paths rejected '+JSON.stringify(path),()=>{const r=good();r.mediaMappings[0].relativePath=path;assert(validateSourceRecord(r).length);const s=good();s.baselineProject.resources[0].path=path;assert(validateSourceRecord(s).length);});
test('malformed primitives never throw',()=>{for(const x of [undefined,null,1,'x',[],{},new Date(),()=>{}])assert(validateSourceRecord(x).length);});
test('movement source records cover endpoints and preserve shared seams through JSON saving',()=>{
 const f=fixture('@出场 甲\n@移动 甲 双人右 1秒\n@移动 甲 三人中 1秒\n@退场 甲'),r=createSourceRecord(f),moves=r.nodes.filter(n=>n.baseline.name==='移动');
 assert.equal(moves[0].objects[1].id,moves[1].objects[0].id);assert.deepEqual(validateSourceRecord(r),[]);assert.deepEqual(validateSourceRecord(JSON.parse(JSON.stringify(r))),[]);
 const keys=r.baselineProject.scene.characters[0].positionKeyframes;keys[0].x+=11;keys[1].frame+=3;keys[1].y+=20;keys[1].interpolation='hold';assert.deepEqual(validateSourceRecord(r),[]);
});
test('movement mapping rejects missing endpoints, foreign types, mixed instances and wrong roles',()=>{
 const make=()=>createSourceRecord(fixture('@出场 甲\n@移动 甲 双人右 1秒\n@退场 甲\n@出场 甲\n@移动 甲 三人中 1秒'));
 for(const change of [
 r=>r.nodes[1].objects.pop(),
 r=>r.nodes[1].objects.push(r.nodes[0].objects[0]),
 r=>r.nodes[1].objects[1]=r.nodes[4].objects[1],
 r=>{r.baselineProject.characterDefinitions.push({...r.baselineProject.characterDefinitions[0],id:'foreign',name:'乙'});r.baselineProject.scene.characters[0].definitionId='foreign';r.nodes[0].objects.push({type:'characterDefinition',id:'foreign'});},
 r=>r.nodes[0].objects.push(r.nodes[1].objects[0])
 ]){const r=make();change(r);assert(validateSourceRecord(r).length);}
});
for(const [text,name,type,key,count] of [
 ['@出场 甲 演出=淡入','出场','characterOpacity','characterOpacity',1],
 ['@出场 甲\n@退场 甲 演出=淡出','退场','characterOpacity','characterOpacity',1],
 ['@画面 淡入','画面','screenFade','screenFades',1],
 ['@画面 淡出','画面','screenFade','screenFades',1],
 ['@背景 room.png 转场=黑屏','背景','screenFade','screenFades',2]
])test('source-declared positive intervals require exact count even after objects removed '+text,()=>{
 const good=createSourceRecord(fixture(text));assert.deepEqual(validateSourceRecord(good),[]);
 for(const mode of ['missing','extra']){const r=structuredClone(good),node=r.nodes.find(n=>n.baseline.name===name),list=r.baselineProject.scene.performance[key];
 if(mode==='missing'){const ref=node.objects.find(o=>o.type===type);node.objects=node.objects.filter(o=>o!==ref);r.baselineProject.scene.performance[key]=list.filter(o=>o.id!==ref.id);}
 else {const value={...list.at(-1),id:'extra-interval',startFrame:list.at(-1).endFrame,endFrame:list.at(-1).endFrame+1};list.push(value);r.baselineProject.scene.durationFrames=Math.max(r.baselineProject.scene.durationFrames,value.endFrame+1);if(type==='characterOpacity')r.baselineProject.scene.characters.find(c=>c.id===value.characterId).visibleTo=value.endFrame+1;node.objects.push({type,id:value.id});}
 assert(validateSourceRecord(r).some(e=>e.includes('exactly '+count+' '+type)),JSON.stringify(validateSourceRecord(r)));
 }
});
test('opacity must belong to mapped instance, not merely same character name',()=>{const r=createSourceRecord(fixture('@出场 甲 演出=淡入\n@退场 甲\n@出场 甲 演出=淡入')),entries=r.nodes.filter(n=>n.baseline.name==='出场');const refs=entries.map(n=>n.objects.find(o=>o.type==='characterOpacity'));[refs[0].id,refs[1].id]=[refs[1].id,refs[0].id];assert(validateSourceRecord(r).some(e=>e.includes('ownership mismatch')));});
test('terminal and overwritten dialogue state commands may have zero mappings',()=>{const r=createSourceRecord(fixture('@隐藏对白框\n@显示对白框\n@清字幕\n@清字幕\n@停顿 1秒\n@清字幕\n@隐藏对白框'));assert.deepEqual(validateSourceRecord(r),[]);assert(r.nodes.some(n=>['清字幕','隐藏对白框','显示对白框'].includes(n.baseline.name)&&n.objects.length===0));});
for(const style of [{},{fontSize:12.5,color:'#aBcDEF',align:'right'},{fontSize:120}])test('source snapshot accepts partial title style '+JSON.stringify(style),()=>{const f=performanceFixture();f.project.scene.performance.titles[0].style=style;const r=createSourceRecord(f);assert.deepEqual(validateSourceRecord(r),[]);});
for(const style of [{path:'fonts/x.ttf'},{fontSize:121},{fontSize:'42'},{color:'#fff'},{align:'justify'},null])test('source full snapshot validates title style '+JSON.stringify(style),()=>{const r=createSourceRecord(performanceFixture());r.baselineProject.scene.performance.titles[0].style=style;assert(validateSourceRecord(r).some(e=>e.includes('baselineProject')));});
test('create rejects incomplete mocks rather than weakening source evidence',()=>assert.throws(()=>createSourceRecord({text:'旁白：a',config:{version:1,characters:[]},report:{nodes:[],bindings:[]},sourceMap:{},project:{},mediaMappings:[]})));
