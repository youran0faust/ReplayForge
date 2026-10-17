const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('persisted manual rows share top only when explicitly grouped, row order never changes stage order',()=>{const p={schemaVersion:3,design:{fps:30},characterDefinitions:[{id:'d',name:'Alice'}],scene:{durationFrames:120,characters:[{id:'a',definitionId:'d',visibleFrom:0,visibleTo:30},{id:'b',definitionId:'d',visibleFrom:30,visibleTo:60},{id:'c',definitionId:'d',visibleFrom:60,visibleTo:90}],dialogues:[],characterRows:[{id:'last',name:'Last',characterIds:['c']},{id:'shared',name:'Shared',characterIds:['a','b']}]}};const before=JSON.stringify(p),items=build(p).tracks[0].items;assert.deepEqual(items.map(i=>i.id),['a','b','c']);assert.equal(items[0].top,items[1].top);assert(items[2].top<items[0].top);assert.equal(items[0].rowId,'shared');assert.equal(JSON.stringify(p),before);});
test('voice clip timeline uses clip identity and parent dialogue, with no legacy duplicate',()=>{
  const p={design:{fps:30},scene:{durationFrames:300,dialogues:[{id:'d',startFrame:30,endFrame:90,voice:{resourceId:'v',durationSamples:48000},voiceClips:[{id:'a',resourceId:'v',sampleRate:48000,sourceOffsetSamples:0,durationSamples:48000,binding:{dialogueId:'d',mode:'follow',followOffsetFrames:15}},{id:'b',resourceId:'v',sampleRate:48000,sourceOffsetSamples:48000,durationSamples:48001,binding:{dialogueId:'d',mode:'independent'},startFrame:100}]}]},resources:[{id:'v',kind:'audio'}]};
  const before=JSON.stringify(p),m=build(p),clips=m.tracks.find(t=>t.kind==='voiceClips').items;
  assert.equal(m.tracks.find(t=>t.kind==='audio').items.length,0);assert.deepEqual(clips.map(c=>[c.id,c.dialogueId,c.startFrame]),[['a','d',45],['b','d',100]]);assert.equal(clips[1].endFrame,100+48001/48000*30);assert.equal(JSON.stringify(p),before);
});
test('schema3 timeline resolves shared definition labels and expression names without projecting into storage',()=>{
 const p={schemaVersion:3,design:{fps:30},characterDefinitions:[{id:'def',name:'同一角色',resourceId:'portrait',expressions:[{id:'smile',name:'微笑'}]}],scene:{durationFrames:60,dialogues:[],characters:[{id:'a',definitionId:'def',visibleFrom:0,visibleTo:30,expressionEvents:[{id:'ev',frame:3,expressionId:'smile'}]},{id:'b',definitionId:'def',visibleFrom:30,visibleTo:60}]}};
 const before=JSON.stringify(p),items=build(p).tracks.find(t=>t.kind==='characters').items;
 assert.deepEqual(items.map(i=>[i.id,i.label,i.startFrame,i.resourceId]),[['a','同一角色',0,'portrait'],['b','同一角色',30,'portrait']]);assert.equal(items[0].events[0].label,'微笑');assert.equal(items[1].events.length,0);assert.equal(JSON.stringify(p),before);
});
test('image lane projects only image-bearing components and keeps their independent intervals',()=>{const p=project();p.componentDefinitions=[{id:'picture',name:'Picture',elements:[{type:'image',resourceId:'img'}]},{id:'text',elements:[{type:'text'}]}];p.scene.components=[{id:'i',definitionId:'picture',visibleFrom:12,visibleTo:38},{id:'t',definitionId:'text',visibleFrom:0,visibleTo:99}];const before=JSON.stringify(p),lane=build(p).tracks.find(t=>t.kind==='components');assert.equal(lane.label,'图片');assert.deepEqual(lane.items.map(i=>[i.id,i.label,i.startFrame,i.endFrame]),[['i','Picture',12,38]]);assert.equal(JSON.stringify(p),before);});
// Restored regression coverage: keep these alongside the newer waveform tests.
test('empty project keeps voice and both explicit audio destination lanes and a zero duration', () => {
  for (const input of [undefined, null, {}, {scene:{characters:null,dialogues:null,audioTracks:null}}]) {
    const model=build(input);
    assert.equal(model.durationFrames,0);
    assert.deepEqual(model.tracks.map(t=>t.kind),['characters','dialogues','audio','audioTracks','audioTracks','components']);
    assert.ok(model.tracks.every(t=>t.items.length===0));
    assert.deepEqual(model.warnings,[]);
  }
});
test('independent tracks retain geometry and warn without changing project or URLs', () => {
  const p=project();p.scene.audioTracks=[{id:'bgm',name:'Music',kind:'bgm',resourceId:'v',startFrame:20,durationSamples:48000,gain:.5}];
  const urls={v:'file:///voice.wav'}, before=JSON.stringify(p),beforeUrls=JSON.stringify(urls),m=build(p,urls);
  const item=m.tracks.find(t=>t.kind==='audioTracks').items[0];
  assert.equal(m.tracks.length,6);assert.equal(item.label,'Music');assert.equal(item.startFrame,20);assert.equal(item.endFrame,50);assert.equal(item.warning,undefined);
  assert.equal(JSON.stringify(p),before);assert.equal(JSON.stringify(urls),beforeUrls);
  p.scene.audioTracks[0].gain=3;p.scene.audioTracks[0].startFrame=90;
  const badBefore=JSON.stringify(p),bad=build(p,{}),warnings=bad.warnings.join('\n');
  assert.match(warnings,/invalid gain/);assert.match(warnings,/audio overflow/);assert.match(warnings,/missing audio resource/);
  assert.equal(JSON.stringify(p),badBefore);
});
test('dialogue labels use active locale and retain exact scene intervals', () => {
  const p=project();p.scene.dialogues[0].text['zh-CN']='你好';p.locale='zh-CN';
  const before=JSON.stringify(p),item=build(p).tracks[1].items[0];
  assert.equal(item.label,'你好');assert.equal(item.startFrame,10);assert.equal(item.endFrame,50);assert.equal(build(p).durationFrames,100);assert.equal(JSON.stringify(p),before);
  p.locale='missing';assert.equal(build(p).tracks[1].items[0].label,'d');
});
test('paged dialogues preserve absolute child intervals and reserve taller overlapping rows', () => {
  const p=project(),d=p.scene.dialogues[0];
  d.pages=[{id:'a',startFrame:10,endFrame:30,text:{'en-US':'A'}},{id:'b',startFrame:30,endFrame:50,text:{'en-US':'B'}}];
  p.scene.dialogues.push({id:'other',startFrame:20,endFrame:40,text:{'en-US':'Other'}},{id:'after',startFrame:50,endFrame:70,text:{'en-US':'After'}});
  const before=JSON.stringify(p),m=build(p),[group,overlap,after]=m.tracks[1].items;
  assert.equal(group.group,true);assert.deepEqual(group.children.map(x=>[x.id,x.dialogueId,x.startFrame,x.endFrame,x.label]),[['a','d',10,30,'1 · A'],['b','d',30,50,'2 · B']]);
  assert.equal(group.top,0);assert.equal(group.height,54);assert.equal(overlap.top,54);assert.equal(overlap.height,28);assert.equal(after.top,0);assert.equal(after.height,54);
  assert.equal(m.tracks[2].items.length,1);assert.equal(JSON.stringify(p),before);
});
test('characters use visibility rather than dialogue intervals', () => {
  const p=project(),c=build(p).tracks[0].items[0];assert.equal(c.startFrame,5);assert.equal(c.endFrame,80);assert.equal(c.label,'Alice');
  delete p.scene.characters[0].visibleFrom;delete p.scene.characters[0].visibleTo;
  const fallback=build(p).tracks[0].items[0];assert.equal(fallback.startFrame,0);assert.equal(fallback.endFrame,100);
});
test('character instances keep independent scene-order rows across nonoverlap and resizing',()=>{
  const p=project();p.scene.characters=[{id:'later',name:'Later',visibleFrom:60,visibleTo:80},{id:'earlier',name:'Earlier',visibleFrom:0,visibleTo:20},{id:'adjacent',name:'Adjacent',visibleFrom:20,visibleTo:40}];
  const geometry=()=>build(p).tracks[0].items.map(i=>[i.id,i.top,i.height]);
  const expected=[['later',0,28],['earlier',28,28],['adjacent',56,28]],before=JSON.stringify(p);
  assert.deepEqual(geometry(),expected);assert.equal(JSON.stringify(p),before);assert.deepEqual(build(p).tracks.map(t=>t.kind),['characters','dialogues','audio','audioTracks','audioTracks','components']);
  p.scene.characters[0].visibleFrom=0;p.scene.characters[0].visibleTo=100;assert.deepEqual(geometry(),expected);
  p.scene.characters[1].visibleFrom=90;p.scene.characters[1].visibleTo=100;assert.deepEqual(geometry(),expected);
  p.scene.characters[0].visibleTo=1;const resized=JSON.stringify(p);assert.deepEqual(geometry(),expected);assert.equal(JSON.stringify(p),resized);
});
test('visibility-controlled instances retain one tall private row and same-template instances stay separate',()=>{
  const p={schemaVersion:3,design:{fps:30},characterDefinitions:[{id:'shared',name:'Alice',expressions:[]}],scene:{durationFrames:100,dialogues:[],characters:[{id:'a',definitionId:'shared',visibleFrom:0,visibleTo:40,visibilityEvents:[{frame:10,visible:false},{frame:20,visible:true}]},{id:'b',definitionId:'shared',visibleFrom:40,visibleTo:60},{id:'c',definitionId:'shared',visibleFrom:60,visibleTo:100,visibilityEvents:[{frame:60,visible:false}]}]}};
  const before=JSON.stringify(p),m=build(p),items=m.tracks[0].items;
  assert.deepEqual(items.map(i=>[i.id,i.label,i.top,i.height]),[['a','Alice',0,54],['b','Alice',54,28],['c','Alice',82,54]]);
  assert.deepEqual(items[0].segments,[{startFrame:0,endFrame:10},{startFrame:20,endFrame:40}]);assert.deepEqual(items[2].segments,[]);assert.equal(items.length,3);assert.equal(m.tracks.length,6);assert.equal(JSON.stringify(p),before);
  p.scene.characters[0].visibleTo=100;assert.deepEqual(build(p).tracks[0].items.map(i=>i.top),[0,54,82]);
});
test('audio lanes still pack nonoverlapping clips while characters use private rows',()=>{
  const p=project();p.scene.audioTracks=[{id:'first',kind:'bgm',resourceId:'v',startFrame:0,durationSamples:48000,gain:1},{id:'next',kind:'bgm',resourceId:'v',startFrame:30,durationSamples:48000,gain:1},{id:'overlap',kind:'bgm',resourceId:'v',startFrame:15,durationSamples:48000,gain:1}];
  const before=JSON.stringify(p),items=build(p).tracks.find(t=>t.kind==='audioTracks').items;
  assert.deepEqual(items.map(i=>[i.id,i.top,i.height]),[['first',0,28],['next',0,28],['overlap',28,28]]);assert.equal(JSON.stringify(p),before);
});
test('visibility segments preserve one identity, sort without mutation and merge repeated states',()=>{
 const p=project(),c=p.scene.characters[0];p.scene.durationFrames=900;c.visibleFrom=0;c.visibleTo=900;c.visibilityEvents=[{frame:510,visible:true},{frame:600,visible:true},{frame:270,visible:false},{frame:300,visible:false}];c.expressionEvents=[{id:'hidden-expression',frame:400,expressionId:null}];const before=JSON.stringify(p),items=build(p).tracks[0].items;
 assert.equal(items.length,1);assert.equal(items[0].id,c.id);assert.deepEqual(items[0].segments,[{startFrame:0,endFrame:270},{startFrame:510,endFrame:900}]);assert.equal(items[0].events[0].frame,400);assert.equal(items[0].height,54);assert.equal(JSON.stringify(p),before);
});
test('visibility segments are half-open, base bounded and retain fully hidden identity',()=>{
 const p=project(),c=p.scene.characters[0];c.visibilityEvents=[{frame:5,visible:false},{frame:80,visible:true}];let item=build(p).tracks[0].items[0];assert.deepEqual(item.segments,[]);assert.equal(item.label,'Alice');
 c.visibilityEvents=[{frame:0,visible:false},{frame:20,visible:true},{frame:40,visible:true},{frame:80,visible:false},{frame:90,visible:true}];item=build(p).tracks[0].items[0];assert.deepEqual(item.segments,[{startFrame:20,endFrame:80}]);
 c.visibilityEvents=[];assert.equal(build(p).tracks[0].items[0].segments,undefined);assert.equal(build(p).tracks[0].items[0].visibilityControlled,undefined);assert.equal(build(p).tracks[0].items[0].height,28);
});
test('segmented renderer uses unique segment keys, no resize handles and independent hidden markers',()=>{
 class Element{constructor(tag){this.tag=tag;this.dataset={};this.style={};this.children=[];this.className='';}append(...nodes){this.children.push(...nodes);}appendChild(n){this.append(n);return n;}setAttribute(k,v){this[k]=v;}get textContent(){return this.text||'';}set textContent(v){this.text=v;this.children=[];}}
 const p=project(),c=p.scene.characters[0];p.scene.dialogues=[];p.scene.durationFrames=900;c.visibleFrom=0;c.visibleTo=900;c.visibilityEvents=[{frame:270,visible:false},{frame:510,visible:true}];c.expressionEvents=[{id:'hidden',frame:400,expressionId:null}];
 const src=fs.readFileSync(path.join(__dirname,'preview.js'),'utf8'),tracks=new Element('div'),context={document:{createElement:t=>new Element(t),querySelector:()=>null},characterEventSublanes:null,timelineRenderKey:null,timelineModel:null,timelineRuler:new Element('div'),timelineTracks:tracks,timeline:{dataset:{}},timelineWarnings:{},timelineSelection:null,frame:{value:0},buildTimelineModel:build,characterReadView:require('../core/character-definitions.cjs').resolveCharacter,formatTimelineNumber:require('./timeline.js').formatTimelineNumber,cancelTimelineDrag(){},syncTimelineSelection(){},syncTransportFrame(){}};
 vm.runInNewContext(src.slice(src.indexOf('function renderTimeline('),src.indexOf('// One delegated handler')),context);context.renderTimeline(p,{});
 const all=n=>[n,...n.children.flatMap(all)],nodes=all(tracks),segments=nodes.filter(n=>n.className.includes('timeline-character-segment'));assert.equal(segments.length,2);assert.deepEqual(segments.map(n=>Number(n.dataset.startFrame)),[0,510]);assert.equal(new Set(segments.map(n=>n.dataset.id+':'+n.dataset.segmentIndex)).size,2);assert(segments.every(n=>n.dataset.id==='c'&&!n.children.length));assert.equal(segments[0].style.top,segments[1].style.top);
 assert.deepEqual(nodes.filter(n=>n.dataset.mediaDropKind).map(n=>n.dataset.mediaDropKind),['bgm','sfx','background','image']);assert.equal(nodes.filter(n=>n.dataset.characterCreateTarget).length,1);assert.equal(nodes.filter(n=>n.dataset.textCreateTarget).length,1);assert(!nodes.some(n=>/添加音频|文本预览|新增角色出场/.test(n.textContent)));
  const marker=nodes.find(n=>n.dataset.kind==='expressionEvents');assert.equal(marker.dataset.startFrame,400);assert(Math.abs(parseFloat(marker.style.left)-400/900*100)<1e-9);assert(nodes.some(n=>n.className==='timeline-character-identity'&&n.dataset.id==='c'));
 c.visibilityEvents=[{frame:0,visible:false}];context.renderTimeline(p,{});assert(!all(tracks).some(n=>n.className.includes('timeline-character-segment')));assert(all(tracks).some(n=>n.className==='timeline-character-identity'));
  c.visibleFrom=100;c.visibleTo=200;c.visibilityEvents=[{frame:100,visible:false}];context.renderTimeline(p,{});const identity=all(tracks).find(n=>n.className==='timeline-character-identity');assert(Math.abs(parseFloat(identity.style.left)-100/900*100)<1e-9);assert(Math.abs(parseFloat(identity.style.width)-100/900*100)<1e-9);assert.equal(identity.style.minWidth,'0');assert.match(identity.title,/角色事件页/);assert.doesNotMatch(identity.title,/JSON/);
});
test('expression markers sort by frame and identity without mutating source events', () => {
  const p=project(),c=p.scene.characters[0];c.expressions=[{id:'happy',name:'Happy'}];
  c.expressionEvents=[{id:'late',frame:40,expressionId:'happy'},{id:'b',frame:12,expressionId:null,label:'Neutral'},{id:'a',frame:12,expressionId:'unknown'}];
  const before=JSON.stringify(p),events=build(p).tracks[0].items[0].events;
  assert.deepEqual(events.map(e=>[e.id,e.frame,e.expressionId,e.label]),[['a',12,'unknown','unknown'],['b',12,null,'Neutral'],['late',40,'happy','Happy']]);assert.equal(JSON.stringify(p),before);
});
test('audio sample durations retain fractional ending frames for voice and independent tracks', () => {
  const p=project();p.scene.dialogues[0].voice.durationSamples=48001;
  p.scene.audioTracks=[{id:'tail',kind:'sfx',resourceId:'v',startFrame:20,durationSamples:1,gain:1}];
  const m=build(p),voice=m.tracks[2].items[0],track=m.tracks.find(t=>t.laneKey==='sfx').items[0];
  assert.ok(Math.abs(voice.endFrame-40.000625)<1e-10);assert.ok(Math.abs(track.endFrame-20.000625)<1e-10);
  assert.equal(voice.durationSamples,48001);assert.equal(track.durationSamples,1);assert.notEqual(voice.endFrame,Math.floor(voice.endFrame));
});
test('missing voice resource manifest and supplied URL produce explicit warnings', () => {
  const p=project();assert.equal(build(p).warnings.length,0);assert.equal(build(p,{v:'file:///v.wav'}).warnings.length,0);
  assert.match(build(p,{}).tracks[2].items[0].warning,/missing voice resource/);
  p.resources=[];assert.match(build(p).warnings.join('\n'),/missing voice resource/);
});
test('audio scene overflow is warned but never silently clamped', () => {
  const p=project();p.scene.dialogues[0].voice.durationSamples=48000*4;
  p.scene.audioTracks=[{id:'long',kind:'bgm',resourceId:'v',startFrame:90,durationSamples:48000,gain:1}];
  const before=JSON.stringify(p),m=build(p);assert.equal(m.durationFrames,100);assert.equal(m.tracks[2].items[0].endFrame,130);
  assert.equal(m.tracks.find(t=>t.kind==='audioTracks').items[0].endFrame,120);assert.match(m.tracks[2].items[0].warning,/audio overflow/);assert.equal(JSON.stringify(p),before);
});
test('overlapping dialogue layout preserves precedence and reuses non-overlapping rows', () => {
  const p=project();p.scene.dialogues=[{id:'first',startFrame:10,endFrame:50},{id:'second',startFrame:20,endFrame:40},{id:'third',startFrame:30,endFrame:60},{id:'edge',startFrame:50,endFrame:70}];
  const before=JSON.stringify(p),items=build(p).tracks[1].items;
  assert.deepEqual(items.map(x=>x.id),['first','second','third','edge']);assert.deepEqual(items.map(x=>x.top),[0,28,56,0]);assert.ok(items.every(x=>x.height===28));assert.equal(JSON.stringify(p),before);
});
test('click mapping clamps left midpoint right and outside positions to valid frames', () => {
  const rect={left:100,width:200};
  assert.equal(at(100,rect,100),0);assert.equal(at(200,rect,100),50);assert.equal(at(300,rect,100),99);
  assert.equal(at(-500,rect,100),0);assert.equal(at(900,rect,100),99);assert.equal(at(101,rect,100),0);assert.equal(at(102,rect,100),1);
});
test('invalid geometry and non-finite formatting produce safe finite values', () => {
  for(const rect of [null,undefined,{left:0,width:0},{left:0,width:-1},{left:0,width:NaN},{left:0,width:Infinity}])assert.equal(at(10,rect,100),0);
  for(const duration of [0,-1,NaN,Infinity,undefined])assert.equal(at(10,{left:0,width:20},duration),0);
  assert.equal(at(NaN,{left:100,width:100},100),0);
  for(const value of [NaN,Infinity,-Infinity,undefined,null,'1'])assert.equal(format(value),'0');
  assert.equal(format(1.23456),'1.235');assert.equal(format(-.0001),'0');assert.equal(format(12),'12');
});
test('ordinary drag rounds movement and clamps both edges to one-frame minimum', () => {
  const base={startFrame:10,endFrame:30,durationFrames:100},before=JSON.stringify(base);
  assert.deepEqual(drag({...base,mode:'move',deltaFrames:2.6}),{startFrame:13,endFrame:33});
  assert.deepEqual(drag({...base,mode:'move',deltaFrames:-100}),{startFrame:0,endFrame:20});
  assert.deepEqual(drag({...base,mode:'move',deltaFrames:100}),{startFrame:80,endFrame:100});
  assert.deepEqual(drag({...base,mode:'start',deltaFrames:100}),{startFrame:29,endFrame:30});
  assert.deepEqual(drag({...base,mode:'start',deltaFrames:-100}),{startFrame:0,endFrame:30});
  assert.deepEqual(drag({...base,mode:'end',deltaFrames:-100}),{startFrame:10,endFrame:11});
  assert.deepEqual(drag({...base,mode:'end',deltaFrames:100}),{startFrame:10,endFrame:100});
  assert.deepEqual(drag(),{startFrame:0,endFrame:1});assert.equal(JSON.stringify(base),before);
});
test('renderer scripts parse and timeline DOM hooks and delegated handlers remain wired', () => {
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),preview=fs.readFileSync(path.join(__dirname,'preview.js'),'utf8');
  for(const name of ['timeline.js','preview.js'])assert.doesNotThrow(()=>new vm.Script(fs.readFileSync(path.join(__dirname,name),'utf8'),{filename:name}));
  for(const id of ['timeline','timeline-ruler','timeline-tracks','timeline-warnings','timeline-split','timeline-selection-status']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'unique DOM hook '+id);
    assert.ok(preview.includes('#'+id),'renderer references '+id);
  }
  assert.ok(html.indexOf('src="timeline.js"')<html.indexOf('src="preview.js"'));
  for(const event of ['onclick','ondblclick','onpointerdown','onpointermove','onpointerup','onpointercancel','onlostpointercapture'])assert.equal((preview.match(new RegExp('timeline\\.'+event+'\\s*=','g'))||[]).length,1,'single delegated '+event);
  assert.match(preview,/window\.timelineTest\s*=/);assert.match(preview,/buildTimelineModel\(/);
});
function waveformFactory(globals={}) {
  const source=fs.readFileSync(path.join(__dirname,'preview.js'),'utf8');
  return vm.runInNewContext(source.slice(source.indexOf('function createWaveformLoader('),source.indexOf('const waveformLoader = createWaveformLoader();'))+'\ncreateWaveformLoader',{setTimeout,clearTimeout,AbortController,...globals});
}
function audioBuffer(channels, sampleRate=48000){return {length:channels[0].length,numberOfChannels:channels.length,sampleRate,getChannelData:i=>channels[i]};}
test('waveform exact ranges and stereo envelope share one uncached decode',async()=>{
  let count=0;const create=waveformFactory(),buffer=audioBuffer([Float32Array.from([.25,.25,.75,.75]),Float32Array.from([-.5,-.5,-1,-1])]);
  const loader=create({byteBudget:0,decode:async()=>{count++;return buffer;},yieldTask:async()=>{}});
  const first=loader.load('a',0,2);assert.equal(first,loader.load('a',0,2));
  const [left,right]=await Promise.all([first,loader.load('a',2,2)]);
  assert.equal(count,1);assert.ok(left.peaks.every(p=>p[0]===-.5&&p[1]===.25));assert.ok(right.peaks.every(p=>p[0]===-1&&p[1]===.75));assert.equal(loader.stats.decodedBytes,0);
  assert.ok((await loader.load('a',4,0)).peaks.every(p=>p[0]===0&&p[1]===0));
});
test('waveform retries failures but never caches failed result',async()=>{
  let count=0;const loader=waveformFactory()({decode:async()=>{if(++count<=2)throw Error('temporary');return audioBuffer([new Float32Array(8)]);},retryDelay:async()=>{},yieldTask:async()=>{}});
  assert.equal((await loader.load('a')).peaks,null);assert.equal(count,2);assert.ok((await loader.load('a')).peaks);assert.equal(count,3);assert.equal(loader.stats.inFlight,0);
});
test('waveform serializes sources, bounds caches and yields in reductions',async()=>{
  let active=0,max=0,yields=0;const loader=waveformFactory()({byteBudget:160,maxPeakEntries:2,decode:async()=>{active++;max=Math.max(active,max);await Promise.resolve();active--;return audioBuffer([new Float32Array(20)]);},yieldTask:async()=>{yields++;}});
  await Promise.all(Array.from({length:20},(_,i)=>loader.load(String(i),0,20)));assert.equal(max,1);assert.ok(loader.stats.decodedBytes<=160);assert.equal(loader.stats.peakEntries,2);assert.ok(yields>=20);
  const big=waveformFactory()({decode:async()=>audioBuffer([new Float32Array(200000)]),yieldTask:async()=>{yields++;}});const before=yields;await big.load('big');assert.ok(yields-before>=4);
});
test('waveform evicted source is decoded again and zero-budget range misses do not retain buffers',async()=>{
 const counts=new Map(),decode=async url=>{counts.set(url,(counts.get(url)||0)+1);return audioBuffer([new Float32Array(20)]);};
 const loader=waveformFactory()({byteBudget:80,decode,yieldTask:async()=>{}});
 await loader.load('a',0,10);await loader.load('b',0,10);await loader.load('a',1,10);
 assert.equal(counts.get('a'),2);assert.equal(counts.get('b'),1);assert.equal(loader.stats.decodedBytes,80);assert.equal(loader.stats.inFlight,0);
 const uncached=waveformFactory()({byteBudget:0,decode,yieldTask:async()=>{}});
 await uncached.load('c',0,10);await uncached.load('c',1,10);
 assert.equal(counts.get('c'),2);assert.equal(uncached.stats.decodedBytes,0);assert.equal(uncached.stats.inFlight,0);
});
for(const late of ['resolve','reject'])test(`waveform timeout settles active and queued requests and ignores late ${late}`,async()=>{
 let complete,fail,started=[];const buffer=audioBuffer([new Float32Array(8)]);
 const loader=waveformFactory()({timeoutMs:15,decode:url=>{started.push(url);return url==='cached'?Promise.resolve(buffer):new Promise((r,j)=>{complete=r;fail=j;});},yieldTask:async()=>{}});
 await loader.load('cached');assert(loader.stats.decodedBytes>0);
 const a=loader.load('hung'),b=loader.load('later');assert.equal(a,loader.load('hung'));
 const results=await Promise.all([a,b]);for(const x of results){assert.equal(x.restartRequired,true);assert.match(x.reason,/保存工程后重启/);}
 assert.equal(loader.stats.inFlight,0);assert.equal(loader.stats.decodedBytes,0);assert.equal(loader.stats.peakEntries,0);
 if(late==='resolve')complete(buffer);else fail(Error('late decode reject'));
 await new Promise(r=>setImmediate(r));assert.deepEqual(started,['cached','hung']);assert.equal(loader.stats.decodedBytes,0);
 assert.equal((await loader.load('new')).restartRequired,true);assert.deepEqual(started,['cached','hung']);
});
test('waveform timeout also settles the shifted active reducer and clears normal timers',async()=>{
 const timers=new Set(),factory=waveformFactory({setTimeout:(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout:id=>{timers.delete(id);clearTimeout(id);}});
 const ok=factory({decode:async()=>audioBuffer([new Float32Array(8)]),yieldTask:async()=>{}});await ok.load('ok');assert.equal(timers.size,0);
 const hung=factory({timeoutMs:15,decode:async()=>audioBuffer([new Float32Array(8)]),yieldTask:()=>new Promise(()=>{})});
 assert.equal((await hung.load('reduce')).restartRequired,true);assert.equal(hung.stats.inFlight,0);assert.equal(hung.stats.decodedBytes,0);assert.equal(timers.size,0);
});
for(const stage of ['fetch','read','decode'])test(`waveform real-path ${stage} timeout aborts fetch and closes context best effort`,async()=>{
 let signal,closed=0,constructed=0,resolveLate;
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);
 class Context{constructor(){constructed++;}decodeAudioData(){return new Promise(r=>{resolveLate=r;});}close(){closed++;return Promise.reject(Error('close failure'));}}
 const loader=waveformFactory({window:{AudioContext:Context},fetch:async(url,opts)=>{signal=opts.signal;if(stage==='fetch')return new Promise(()=>{});return{ok:true,headers:{get:()=>null},...(stage==='read'?{body:{getReader:()=>({read:()=>new Promise(()=>{}),releaseLock(){}})}}:{arrayBuffer:async()=>wav.buffer.slice(wav.byteOffset,wav.byteOffset+wav.byteLength)})};}})({timeoutMs:15});
 const a=loader.load('one'),b=loader.load('two');await Promise.all([a,b]);assert.equal(signal.aborted,true);assert.equal(constructed,stage==='decode'?1:0);assert.equal(closed,constructed);
 if(resolveLate)resolveLate(audioBuffer([new Float32Array(2)]));await new Promise(r=>setImmediate(r));
 assert.equal(loader.stats.inFlight,0);assert.equal(loader.stats.decodedBytes,0);assert.equal((await loader.load('three')).restartRequired,true);assert.equal(closed,constructed);
});
test('waveform maps decoded rates and rejects oversized metadata without decode',async()=>{
  let count=0;const loader=waveformFactory()({decode:async()=>{count++;return audioBuffer([Float32Array.from([.2,.4,.6,.8])],24000);},yieldTask:async()=>{}});
  const result=await loader.load('a',4,2);assert.ok(result.peaks.every(p=>Math.abs(p[1]-.6)<1e-6));
  assert.equal((await loader.load('huge',0,1,{sourceDurationSamples:48000*601})).skipped,true);assert.equal(count,1);
  assert.equal((await loader.load('a',-1,2)).skipped,true);
});
test('voice binding effective position and independent BGM SFX lanes',()=>{const p=project(),v=p.scene.dialogues[0].voice;let m=build(p);assert.equal(m.tracks[2].items[0].bindingMode,'follow');assert.equal(m.tracks[2].items[0].startFrame,10);assert.equal(m.tracks[2].items[0].sourceOffsetSamples,0);assert.equal(m.tracks[2].items[0].durationSamples,48000);v.binding={dialogueId:'d',mode:'follow',followOffsetFrames:5};m=build(p);assert.equal(m.tracks[2].items[0].startFrame,15);assert.match(m.tracks[2].items[0].warning,/不一致/);v.binding.mode='independent';v.startFrame=60;m=build(p);assert.equal(m.tracks[2].items[0].startFrame,60);assert.equal(m.tracks[2].items[0].bindingMode,'independent');p.scene.audioTracks=['bgm','sfx'].map((kind,i)=>({id:'a'+i,name:kind,kind,resourceId:'v',startFrame:0,sourceOffsetSamples:i?12345:8000,durationSamples:i?1:48001,gain:1}));m=build(p);assert.deepEqual(m.tracks.filter(t=>t.kind==='audioTracks').map(t=>[t.laneKey,t.items[0].id]),[['bgm','a0'],['sfx','a1']]);assert.equal(m.tracks.find(t=>t.laneKey==='bgm').items[0].sourceOffsetSamples,8000);assert.equal(m.tracks.find(t=>t.laneKey==='bgm').items[0].durationSamples,48001);assert.equal(m.tracks.find(t=>t.laneKey==='sfx').items[0].sourceOffsetSamples,12345);assert.equal(m.tracks.find(t=>t.laneKey==='sfx').items[0].durationSamples,1);assert.equal(m.tracks[2].items.length,1);assert.equal(JSON.stringify(p.scene.audioTracks.map(a=>[a.sourceOffsetSamples,a.durationSamples])),JSON.stringify([[8000,48001],[12345,1]]));});

test('sample native audio drag preserves fractional tails and restores source bounds',()=>{const f=require('./timeline.js').calculateAudioTrackDrag,b={startFrame:10,sourceOffsetSamples:0,durationSamples:48001,sourceDurationSamples:48001,durationFrames:100,fps:30};const trimmed=f({...b,mode:'start',deltaFrames:5});assert.deepEqual(trimmed,{startFrame:15,sourceOffsetSamples:8000,durationSamples:40001});assert.deepEqual(f({...b,...trimmed,mode:'start',deltaFrames:-99}),{startFrame:10,sourceOffsetSamples:0,durationSamples:48001});const right=f({...b,mode:'end',deltaFrames:-10});assert.equal(right.durationSamples,32001);assert.equal(f({...b,...right,mode:'end',deltaFrames:99}).durationSamples,48001);assert.equal(f({...b,mode:'move',deltaFrames:99}).startFrame,69);assert.equal(f({...b,mode:'end',deltaFrames:-99}).durationSamples,1);assert.equal(f({...b,sourceDurationSamples:undefined,mode:'move',deltaFrames:1}).startFrame,11);assert.throws(()=>f({...b,sourceDurationSamples:undefined,mode:'end',deltaFrames:1}));assert.throws(()=>f({...b,fps:29,mode:'move',deltaFrames:1}));});
const {buildTimelineModel: build, timelineFrameAt: at, formatTimelineNumber: format, downsampleWaveform, calculateTimelineDrag: drag} = require('./timeline.js');
test('downsampleWaveform returns bounded peak pairs and handles empty input', () => {
  assert.deepEqual(downsampleWaveform([-.5, .25, 1, -1], 2), [[-.5, .25], [-1, 1]]);
  assert.equal(downsampleWaveform(new Float32Array(1000), 999).length, 128);
  assert.deepEqual(downsampleWaveform([], 8), Array.from({length:8}, () => [0,0]));
});
test('downsampleWaveform scans large Float32Array without copying or unbounded output', () => {
  const samples = new Float32Array(10_000_000); samples[123] = -.75; samples[9_999_999] = .9;
  const peaks = downsampleWaveform(samples, 64);
  assert.equal(peaks.length, 64); assert.equal(peaks[0][0], -.75); assert.equal(peaks[0][1], 0); assert.equal(peaks[63][0], 0); assert.ok(Math.abs(peaks[63][1] - .9) < 1e-6);
});
test('group drag geometry clamps first last and internal one-frame limits without mutation',()=>{const groupDrag=require('./timeline.js').calculateGroupDrag,pages=[{id:'a',startFrame:20,endFrame:60},{id:'b',startFrame:60,endFrame:100}],base={startFrame:20,endFrame:100,durationFrames:150,pages},before=JSON.stringify(pages);assert.deepEqual(groupDrag({...base,mode:'move',deltaFrames:100}),{startFrame:70,endFrame:150});assert.deepEqual(groupDrag({...base,mode:'start',deltaFrames:100}),{startFrame:59,endFrame:100});assert.deepEqual(groupDrag({...base,mode:'end',deltaFrames:-100}),{startFrame:20,endFrame:61});assert.deepEqual(groupDrag({...base,mode:'boundary',pageId:'a',deltaFrames:100}),{startFrame:20,endFrame:99});assert.deepEqual(groupDrag({...base,mode:'boundary',pageId:'a',deltaFrames:-100}),{startFrame:20,endFrame:21});assert.equal(JSON.stringify(pages),before);});
function project() { return {locale: 'en-US', design: {fps: 30}, resources: [{id: 'v'}], scene: {durationFrames: 100, characters: [{id: 'c', name: 'Alice', visibleFrom: 5, visibleTo: 80}], dialogues: [{id: 'd', startFrame: 10, endFrame: 50, text: {'en-US': 'Hello'}, voice: {resourceId: 'v', durationSamples: 48000}}]}}; }
