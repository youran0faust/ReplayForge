'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {performanceErrors, evaluatePerformance, finalizePerformance, TITLE_TEXT_LIMIT} = require('./performance-model.cjs');
const {evaluate, validateProject} = require('./model.cjs');
const {compileAudioTimeline} = require('./audio-timeline.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
function project(performance) {
  return {schemaVersion:4,id:'p',title:'Test',locale:'en',design:{width:1280,height:720,fps:30},resources:[],
    characterDefinitions:[{id:'def',name:'A',color:'#fff'}],
    scene:{id:'s',durationFrames:100,characters:[{id:'instance',definitionId:'def',x:0,y:0,width:100,height:100,visibleFrom:0,visibleTo:100}],
      dialogues:[{id:'d',speakerId:'def',text:{en:'Hello'},startFrame:0,endFrame:20,displayUntilFrame:100,revealFrames:5}],
      ...(performance === undefined ? {} : {performance})}};
}
const fade = (id,startFrame,endFrame,from=0,to=1) => ({id,startFrame,endFrame,from,to});
const title = (id,startFrame,endFrame,fadeInFrames=0,fadeOutFrames=0) => ({id,startFrame,endFrame,fadeInFrames,fadeOutFrames,text:'Title'});
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }

test('optional schema4 only, strict fields and global IDs, malformed data', () => {
  assert.deepEqual(validateProject(project()), []);
  assert.deepEqual(validateProject(project({version:1})), []);
  for (const perf of [null,[],{}, {version:2}, {version:1,extra:1}, {version:1,titles:{}}, {version:1,titles:[null]}, {version:1,dialogueClears:[{id:'x',frame:0,extra:true}]}, {version:1,dialogueClears:[{id:'x',frame:0}],dialogueVisibility:[{id:'x',frame:2,visible:true}]}]) {
    assert.ok(performanceErrors(project(perf)).length, JSON.stringify(perf));
  }
  for (const schemaVersion of [1,2,3]) assert.match(performanceErrors({...project({version:1}),schemaVersion}).join(), /requires schema4/);
  const p=project({version:1});validateProject(p);assert.equal(p.schemaVersion,4);
});
test('interval endpoints, finite opacity, instance references and base range', () => {
  assert.deepEqual(performanceErrors(project({version:1,screenFades:[fade('s',0,100)]})), []);
  for (const update of [{startFrame:-1},{startFrame:0.5},{endFrame:0},{endFrame:101},{from:NaN},{from:Infinity},{from:-0.1},{to:1.1}]) {
    assert.ok(performanceErrors(project({version:1,screenFades:[{...fade('s',0,100),...update}]})).length);
  }
  for (const characterId of ['def','missing']) assert.match(performanceErrors(project({version:1,characterOpacity:[{...fade('c',0,100),characterId}]})).join(), /instance missing/);
  const p=project({version:1,characterOpacity:[{...fade('c',0,100),characterId:'instance'}]});
  assert.deepEqual(performanceErrors(p),[]);p.scene.characters[0].visibleFrom=1;
  assert.match(performanceErrors(p).join(), /visibility range/);
});
test('same-property overlaps reject; adjacency and independent properties allow', () => {
  for (const name of ['screenFades','characterOpacity','titles']) {
    const make=(id,s,e)=>name==='titles'?title(id,s,e):{...fade(id,s,e),...(name==='characterOpacity'?{characterId:'instance'}:{})};
    assert.deepEqual(performanceErrors(project({version:1,[name]:[make('a',0,20),make('b',20,40)]})),[]);
    assert.match(performanceErrors(project({version:1,[name]:[make('a',0,21),make('b',20,40)]})).join(),/overlapping/);
  }
  for(const name of ['dialogueVisibility','dialogueClears']) assert.match(performanceErrors(project({version:1,[name]:[{id:'a',frame:1,...(name==='dialogueVisibility'?{visible:true}:{})},{id:'b',frame:1,...(name==='dialogueVisibility'?{visible:false}:{})}]})).join(),/overlapping/);
  assert.deepEqual(performanceErrors(project({version:1,screenFades:[fade('s',0,100)],titles:[title('t',0,100)]})),[]);
});
test('pure seek-independent projection, last started holds to and unordered tracks', () => {
  const p=frozen(project({version:1,characterOpacity:[{...fade('c',10,20,1,0),characterId:'instance'}],screenFades:[fade('b',30,40,1,0),fade('a',10,20)],dialogueClears:[{id:'clear',frame:25}]}));
  const snapshot=JSON.stringify(p), samples=Array.from({length:101},(_,f)=>evaluatePerformance(p,f));
  assert.deepEqual(samples[0],{characterOpacity:{instance:1},screenOpacity:0,dialogueVisible:true,clearFrame:null,title:null});
  assert.equal(samples[15].screenOpacity,0.5);assert.equal(samples[15].characterOpacity.instance,0.5);
  assert.equal(samples[20].screenOpacity,1);assert.equal(samples[29].screenOpacity,1);assert.equal(samples[40].screenOpacity,0);
  let seed=123;for(let i=0;i<300;i++){seed=(seed*1664525+1013904223)>>>0;const f=seed%101;assert.deepEqual(evaluatePerformance(p,f),samples[f]);}
  assert.deepEqual(performanceErrors(p),[]);assert.equal(JSON.stringify(p),snapshot);
  samples[0].characterOpacity.instance=99;assert.equal(evaluatePerformance(p,0).characterOpacity.instance,1);
});
test('title envelope, exclusive end, restoration and text bounds', () => {
  const p=project({version:1,titles:[title('t',10,30,5,5),title('u',30,40)]});
  for (const [f,opacity] of [[10,0],[12,0.4],[15,1],[25,1],[29,0.2],[30,1]]) assert.equal(evaluatePerformance(p,f).title.opacity,opacity);
  assert.equal(evaluatePerformance(p,9).title,null);assert.equal(evaluatePerformance(p,40).title,null);
  assert.equal(evaluate(p,15).dialogues.length,1);assert.equal(evaluate(p,40).dialogues.length,1);
  for (const update of [{fadeInFrames:-1},{fadeOutFrames:0.5},{fadeInFrames:11,fadeOutFrames:10},{text:''},{text:'   '},{text:'x'.repeat(TITLE_TEXT_LIMIT+1)}]) assert.ok(performanceErrors(project({version:1,titles:[{...title('t',10,30),...update}]})).length);
});
test('title style validates and projects fresh optional data without changing legacy shape', () => {
  const p=project({version:1,titles:[title('t',0,30)]});
  assert.deepEqual(evaluatePerformance(p,0).title,{text:'Title',opacity:1});
  p.scene.performance.titles[0].style={fontSize:80,color:'#Ab1200',align:'right'};
  assert.deepEqual(validateProject(p),[]);
  const projected=evaluatePerformance(p,0).title;
  assert.deepEqual(projected.style,p.scene.performance.titles[0].style);
  projected.style.fontSize=12;assert.equal(p.scene.performance.titles[0].style.fontSize,80);
  p.scene.performance.titles[0].style={fontFamily:'unsafe'};
  assert.match(validateProject(p).join(),/title style unknown field/);
});
test('clear persists, same-frame new dialogue survives, visibility restores only uncleared text', () => {
  const p=project({version:1,dialogueClears:[{id:'clear',frame:25}],dialogueVisibility:[{id:'hide',frame:30,visible:false},{id:'show',frame:40,visible:true}]});
  assert.equal(evaluate(p,24).dialogues.length,1);assert.equal(evaluate(p,25).dialogues.length,0);assert.equal(evaluate(p,60).dialogues.length,0);
  p.scene.dialogues.push({...p.scene.dialogues[0],id:'new',startFrame:25,endFrame:35});
  assert.deepEqual(evaluate(p,25).dialogues.map(d=>d.id),['new']);assert.equal(evaluate(p,30).dialogues.length,0);assert.deepEqual(evaluate(p,40).dialogues.map(d=>d.id),['new']);
  assert.equal(evaluate(p,40).characters[0].opacity,1);
});
test('hiding, clearing and full-screen title do not change audio compilation', () => {
  const p=project();
  p.scene.dialogues[0].voiceClips=[{id:'v',resourceId:'audio',sampleRate:48000,sourceOffsetSamples:0,durationSamples:96000,binding:{dialogueId:'d',mode:'follow'}}];
  const diagnosis={hasErrors:false,resources:{audio:{kind:'audio',exists:true,audio:{format:'wav',sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:96000}}}};
  const before=compileAudioTimeline(p,diagnosis);
  p.scene.performance={version:1,dialogueVisibility:[{id:'hide',frame:0,visible:false}],dialogueClears:[{id:'clear',frame:1}],titles:[title('t',0,100)]};
  assert.equal(evaluate(p,10).dialogues.length,0);assert.deepEqual(compileAudioTimeline(p,diagnosis),before);
  assert.equal(before.clips[0].durationSamples,96000);
});
test('TS mirror validators and evaluator match CJS performance projection', () => {
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'model.ts'),'utf8');
  const body=source.slice(source.indexOf('export function validateProject'))
    .replace('export function validateProject(p:Project):string[]','function validateProject(p)')
    .replace('const e:string[]','const e').replace("(['width', 'height', 'fps'] as const)","['width', 'height', 'fps']")
    .replaceAll('new Set<string>()','new Set()').replaceAll('new Set<number>()','new Set()')
    .replace('export function evaluate(project:Project,frame:Frame)','function evaluate(project,frame)')
    .replace('const out:Character & {portraitLayers?:PortraitLayer[]}','const out');
  const context=Object.assign({},...['portrait','dialogue-pages','character-definitions','character-rows','components-model','voice-clip-model','dialogue-semantics','script-source-record','performance-model','video-model','audio-envelope'].map(n=>require(`./${n}.cjs`)));
  vm.runInNewContext(body+';this.api={validateProject,evaluate};',context);
  const p=project({version:1,screenFades:[fade('s',0,20)],titles:[title('t',10,30,5,5)],dialogueClears:[{id:'c',frame:35}]});
  assert.deepEqual(copy(context.api.validateProject(p)),validateProject(p));
  for(const f of [0,10,15,20,30,35,99])assert.deepEqual(copy(context.api.evaluate(p,f)),evaluate(p,f));
  p.scene.performance.screenFades[0].to=2;
  assert.deepEqual(copy(context.api.validateProject(p)),validateProject(p));
});
test('without performance legacy output is exact and finalizer returns identity', () => {
  const p=project();p.schemaVersion=1;p.scene.characters=[{id:'c',name:'A',color:'#fff',x:0,y:0,width:100,height:100,visibleFrom:0,visibleTo:100}];p.scene.dialogues[0].speakerId='c';
  const state=evaluate(p,0);
  assert.deepEqual(state,{frame:0,timeSeconds:0,background:{kind:'color',color:'#182338'},characters:copy(p.scene.characters),dialogues:[{...copy(p.scene.dialogues[0]),text:'Hello',visibleText:'H',progress:0.2}]});
  assert.equal(finalizePerformance(state,p,0),state);assert.equal(Object.hasOwn(state,'performance'),false);assert.equal(Object.hasOwn(state.characters[0],'opacity'),false);
});
