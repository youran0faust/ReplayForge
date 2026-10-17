'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {videoErrors,videoAt,finalizeVideo}=require('./video-model.cjs');
const {evaluate,validateProject}=require('./model.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
function project(){return {schemaVersion:4,id:'p',title:'Video',locale:'en',design:{width:1920,height:1080,fps:30},characterDefinitions:[],resources:[{id:'v',name:'Movie',kind:'video',path:'media/movie.mp4',mime:'video/mp4',width:1920,height:1080,fps:30,frameCount:30,normalizationVersion:1,audioResourceId:'a'},{id:'a',kind:'audio',path:'media/movie.wav',mime:'audio/wav',sampleRate:48000,bitsPerSample:16,channels:2,durationSamples:48000}],scene:{id:'s',durationFrames:100,characters:[],dialogues:[],videoClips:[{id:'first',resourceId:'v',startFrame:10,endFrame:40},{id:'second',resourceId:'v',startFrame:40,endFrame:70}]}};}
function freeze(x){if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;}
test('full length repeated resource, half-open boundaries and random seek remain pure',()=>{
 const p=freeze(project()),before=JSON.stringify(p);assert.deepEqual(validateProject(p),[]);
 for(const f of [0,9,70,99,100,-1,NaN,1.5])assert.equal(videoAt(p,f),null);
 for(const [f,id,local] of [[10,'first',0],[39,'first',29],[40,'second',0],[69,'second',29]])assert.deepEqual(videoAt(p,f),{clipId:id,resourceId:'v',localFrame:local,width:1920,height:1080,audioResourceId:'a'});
 const frames=Array.from({length:101},(_,f)=>evaluate(p,f));let seed=7;
 for(let i=0;i<400;i++){seed=(seed*1664525+1013904223)>>>0;const f=seed%101;assert.deepEqual(evaluate(p,f),frames[f]);}
 assert.equal(JSON.stringify(p),before);const result=videoAt(p,10);result.width=1;assert.equal(videoAt(p,10).width,1920);
});
test('optional field preserves exact legacy shape and null is explicit only when present',()=>{
 const p=project();delete p.scene.videoClips;delete p.resources[0].audioResourceId;
 const state={frame:0,characters:[],dialogues:[]};assert.equal(finalizeVideo(state,p,0),state);assert.equal(Object.hasOwn(evaluate(p,0),'activeVideo'),false);
 p.scene.videoClips=[];assert.deepEqual(finalizeVideo(state,p,0),{...state,activeVideo:null});assert.equal(evaluate(p,0).activeVideo,null);
 p.scene.videoClips=[{id:'silent',resourceId:'v',startFrame:0,endFrame:30}];assert.equal(Object.hasOwn(videoAt(p,0),'audioResourceId'),false);
 p.scene.performance={version:1,screenFades:[{id:'fade',startFrame:0,endFrame:30,from:0,to:1}]};assert.equal(evaluate(p,10).activeVideo.localFrame,10);assert.ok(evaluate(p,10).performance);
});
test('schema gating includes empty or undefined clips and unused video resources',()=>{
 for(const schemaVersion of [1,2,3]){const p=project();p.schemaVersion=schemaVersion;delete p.scene.videoClips;assert.match(videoErrors(p).join(),/requires schema4/);p.resources=[];p.scene.videoClips=[];assert.match(videoErrors(p).join(),/requires schema4/);p.scene.videoClips=undefined;assert.match(videoErrors(p).join(),/requires schema4/);}
 const p=project();delete p.scene.videoClips;p.resources[0].frameCount=0;assert.match(validateProject(p).join(),/frameCount/);
});
test('video metadata strict numeric types, normalized bounds and no HTML or nested audio',()=>{
 const changes=[{id:''},{id:5},{path:''},{path:7},{path:'movie.HTML?x=1'},{mime:'video/webm'},{width:1922},{width:1},{width:0},{width:'1920'},{height:1082},{height:719},{height:Infinity},{fps:29.97},{fps:'30'},{frameCount:0},{frameCount:1801},{frameCount:1.5},{frameCount:NaN},{frameCount:Number.MAX_SAFE_INTEGER+1},{normalizationVersion:'1'},{normalizationVersion:2},{audioResourceId:null},{audioResourceId:undefined},{audio:{path:'bad.wav'}},{audioPath:'bad.wav'}];
 for(const change of changes){const p=project();Object.assign(p.resources[0],change);assert.ok(videoErrors(p).length,JSON.stringify(change));}
 const p=project();p.design.fps=60;assert.match(videoErrors(p).join(),/design fps/);
 for(const count of [1,1800]){const p=project();p.resources[0].frameCount=count;delete p.resources[0].audioResourceId;p.scene.durationFrames=count;p.scene.videoClips=[{id:'all',resourceId:'v',startFrame:0,endFrame:count}];assert.deepEqual(videoErrors(p),[]);}
});
test('clip strict fields, references, IDs, bounds, nonoverlap and no trim',()=>{
 for(const change of [{id:''},{resourceId:'missing'},{resourceId:'a'},{startFrame:-1},{startFrame:0.5},{endFrame:101},{endFrame:10},{endFrame:39},{startFrame:NaN},{path:'bad.mp4'},{sourceOffsetFrames:1},{audioResourceId:'a'}]){const p=project();Object.assign(p.scene.videoClips[0],change);assert.ok(videoErrors(p).length,JSON.stringify(change));}
 for(const clips of [null,{},[null],[[]],[{}]]){const p=project();p.scene.videoClips=clips;assert.ok(videoErrors(p).length);}
 const p=project();p.scene.videoClips[1].id='first';assert.match(videoErrors(p).join(),/duplicate/);p.scene.videoClips[1].id='second';p.scene.videoClips[1].startFrame=39;p.scene.videoClips[1].endFrame=69;assert.match(videoErrors(p).join(),/overlapping/);
 p.scene.videoClips.reverse();assert.match(videoErrors(p).join(),/overlapping/);
});
test('linked audio exact stereo WAV48 PCM16 duration and unique links',()=>{
 for(const change of [{id:'missing'},{kind:'image'},{path:5},{path:'audio.html'},{mime:'audio/mp3'},{sampleRate:'48000'},{sampleRate:44100},{bitsPerSample:24},{channels:0},{channels:3},{channels:'2'},{durationSamples:47999},{durationSamples:48000.5}]){const p=project();Object.assign(p.resources[1],change);assert.match(videoErrors(p).join(),/audioResourceId/);}
 for(const field of ['mime','sampleRate','bitsPerSample','channels','durationSamples']){const p=project();delete p.resources[1][field];assert.ok(videoErrors(p).length);}
 const p=project();p.resources[1].channels=1;assert.match(videoErrors(p).join(),/audioResourceId/);p.resources[1].channels=2;assert.deepEqual(videoErrors(p),[]);p.resources.push({...p.resources[0],id:'v2'});assert.match(videoErrors(p).join(),/duplicate audioResourceId/);p.resources.pop();p.resources.push({...p.resources[1]});assert.match(videoErrors(p).join(),/audioResourceId/);
});
test('TS VM explicitly injects video module and matches CJS validation and evaluation',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'model.ts'),'utf8');
 const body=source.slice(source.indexOf('export function validateProject'))
 .replace('export function validateProject(p:Project):string[]','function validateProject(p)')
 .replace('const e:string[]','const e').replace("(['width', 'height', 'fps'] as const)","['width', 'height', 'fps']")
 .replaceAll('new Set<string>()','new Set()').replaceAll('new Set<number>()','new Set()')
 .replace('export function evaluate(project:Project,frame:Frame)','function evaluate(project,frame)')
 .replace('const out:Character & {portraitLayers?:PortraitLayer[]}','const out');
 const context=Object.assign({},...['portrait','dialogue-pages','character-definitions','character-rows','components-model','voice-clip-model','dialogue-semantics','script-source-record','performance-model','audio-envelope','video-model'].map(n=>require(`./${n}.cjs`)));
 vm.createContext(context);vm.runInContext(body,context);
 const p=project();for(const f of [0,9,10,39,40,69,70,100])assert.deepEqual(copy(context.evaluate(p,f)),evaluate(p,f));
 for(const mutate of [()=>{},p=>p.resources[0].fps=24,p=>p.scene.videoClips[0].endFrame=39,p=>p.schemaVersion=3,p=>delete p.scene.videoClips,p=>p.scene.videoClips=[]]){const p=project();mutate(p);assert.deepEqual(copy(context.validateProject(p)),validateProject(p));assert.deepEqual(copy(context.evaluate(p,10)),evaluate(p,10));}
});
