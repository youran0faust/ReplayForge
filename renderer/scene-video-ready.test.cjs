'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(setImmediate);
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(t,options={}){
 const images=[],raf=[],requests=[],events=[];let renders=0,fonts=0;
 function node(tag){const n={style:{},dataset:{},children:[],classList:{add(){}},appendChild(c){this.children.push(c);},replaceChildren(...c){this.children=c;},remove(){}};if(tag==='img'){n.naturalWidth=n.naturalHeight=2;n.decoding=deferred();n.decode=()=>n.decoding.promise;images.push(n);}return n;}
 const stage=node('div');Object.defineProperty(stage,'offsetHeight',{get(){events.push('layout');return 2;}});
 const context=vm.createContext({setTimeout,clearTimeout,document:{createElement:node,fonts:{get ready(){fonts++;return Promise.resolve();}}},requestAnimationFrame:cb=>raf.push(cb),createTextRevealer:()=>({prepare(){},reveal(){}}),createComponentRenderer:()=>({render(){renders++;return {};}}),TitleLayout:{}});
 for(const file of ['video-renderer.js','scene-renderer.js'])vm.runInContext(fs.readFileSync(__dirname+'/'+file,'utf8'),context,{filename:file});
 const renderer=context.createSceneRenderer(stage,{requestVideoFrame:r=>{const d=deferred();requests.push({...r,...d});return d.promise;},...options});
 const project={design:{width:2,height:2},scene:{videoClips:[{}]},resources:[{id:'v'}]};
 const render=frame=>renderer.render({activeVideo:frame===null?null:{resourceId:'v',localFrame:frame,width:2,height:2}},project);
 async function respond(){const r=requests.at(-1);r.resolve({frameIndex:r.localFrame,width:2,height:2,dataUrl:'data:image/png;base64,AAAA'});await flush();return images.at(-1);}
 async function tick(){assert.ok(raf.length,'must have queued RAF');const callbacks=raf.splice(0);events.push('raf');callbacks.forEach(cb=>cb(0));await flush();}
 t.after(()=>render(null));return {renderer,render,respond,tick,images,requests,raf,events,stage,get renders(){return renders;},get fonts(){return fonts;}};
}
function observe(p){const s={done:false};s.promise=p.then(()=>{s.done=true;});return s;}
test('actual target decode then layout and two distinct RAFs precede scene capture readiness',async t=>{
 const f=fixture(t);f.render(39);const s=observe(f.renderer.ready()),image=await f.respond();
 assert.equal(s.done,false);assert.deepEqual(f.events,[]);assert.equal(f.raf.length,0);
 image.decoding.resolve();await flush();assert.equal(s.done,false);
 assert.equal(f.stage.children.find(n=>n.className==='video-layer').children[0],image);
 await f.tick();assert.equal(s.done,false);await f.tick();await s.promise;
 assert.deepEqual(f.events,['layout','raf','raf']);assert.equal(f.renders,1,'no full render replacing target');assert.equal(f.requests.length,1);assert.equal(f.fonts,0);
});
test('seeded random newer states during decode and either RAF require latest decode and paint',async t=>{
 let seed=4122;const random=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 for(let round=0;round<12;round++){
  const f=fixture(t);f.render(0);const s=observe(f.renderer.ready()),stale=await f.respond(),phase=round%3;
  if(phase){stale.decoding.resolve();await flush();}if(phase===2)await f.tick();
  const frames=Array.from({length:1+random()%5},()=>1+random()%500);for(const n of frames)f.render(n);await flush();
  while(f.raf.length)await f.tick();assert.equal(s.done,false);
  while(f.requests.at(-1).localFrame!==frames.at(-1))await f.respond();
  const latest=await f.respond();assert.equal(s.done,false);latest.decoding.resolve();await flush();assert.equal(s.done,false);
  await f.tick();assert.equal(s.done,false);await f.tick();await s.promise;stale.decoding.resolve();await flush();
  assert.equal(f.stage.children.find(n=>n.className==='video-layer').children[0],latest);assert.equal(f.renders,frames.length+1);
 }
});
test('scene forwards onVideoError with latest target while ready still rejects',async t=>{
 const errors=[];const f=fixture(t,{onVideoError:(...args)=>errors.push(args)});f.render(1);
 const rejected=assert.rejects(f.renderer.ready(),/bridge failed/);f.requests[0].reject(Error('bridge failed'));await rejected;await flush();
 assert.equal(errors.length,1);assert.equal(errors[0][1].active.localFrame,1);assert.equal(f.raf.length,0);
 const layer=f.stage.children.find(n=>n.className==='video-layer');assert.equal(layer.hidden,false);assert.equal(layer.children.length,0);
 f.render(null);assert.equal(layer.hidden,true);
});
test('latest actual decode failure propagates',async t=>{
 const f=fixture(t);f.render(1);const rejected=assert.rejects(f.renderer.ready(),/actual decode failed/);
 (await f.respond()).decoding.reject(Error('actual decode failed'));await rejected;assert.equal(f.raf.length,0);
});
test('new target failure during paint rejects instead of capturing old frame',async t=>{
 const f=fixture(t);f.render(1);const rejected=assert.rejects(f.renderer.ready(),/latest bridge failed/);
 (await f.respond()).decoding.resolve();await flush();await f.tick();f.render(2);f.requests.at(-1).reject(Error('latest bridge failed'));await f.tick();await rejected;
});
test('video cleared during paint falls through to original nonvideo ready',async t=>{
 const f=fixture(t);f.render(1);const s=observe(f.renderer.ready());(await f.respond()).decoding.resolve();await flush();
 f.render(null);await f.tick();await f.tick();assert.equal(s.done,false);assert.equal(f.fonts,1);await f.tick();await f.tick();await s.promise;assert.equal(f.renders,3);
});
test('nonvideo ready preserves render, fonts, layout and double RAF',async t=>{
 const f=fixture(t);f.render(null);const s=observe(f.renderer.ready());await flush();assert.equal(f.renders,2);assert.equal(f.fonts,1);assert.deepEqual(f.events,['layout']);
 await f.tick();assert.equal(s.done,false);await f.tick();await s.promise;assert.equal(f.requests.length,0);
});
