'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {mediaDropTarget, mediaDropContainsPoint} = require('./media-drop.js');

test('playhead fallback rectangle matching respects lane and viewport boundaries', () => {
  const lane = Object.freeze({left: 100, top: 200, right: 500, bottom: 224});
  assert.equal(mediaDropContainsPoint(lane, 300, 210), true);
  assert.equal(mediaDropContainsPoint(lane, 100, 200), true);
  for (const [x, y] of [[99, 210], [500, 210], [300, 199], [300, 224], [NaN, 210]]) {
    assert.equal(mediaDropContainsPoint(lane, x, y), false);
  }
  assert.equal(mediaDropContainsPoint(null, 300, 210), false);
  assert.equal(mediaDropContainsPoint({...lane, right: Infinity}, 300, 210), false);
  assert.equal(mediaDropContainsPoint({...lane, right: 100}, 100, 210), false);
  const viewport = {left: 0, top: 0, right: 250, bottom: 300};
  assert.equal(mediaDropContainsPoint(lane, 300, 210) && mediaDropContainsPoint(viewport, 300, 210), false);
});
test('release commits explicit destination once without a purpose dialog; generic audio is rejected', async () => {
  const {createMediaDrop}=require('./media-drop.js');
  for(const kind of ['bgm','sfx','audio','background']) {
    const listeners={},calls=[],created=[];
    const lane={dataset:{mediaDropKind:kind},getBoundingClientRect:()=>({left:100,width:1000}),closest:selector=>selector==='[data-media-drop-kind]'?lane:null};
    const doc={defaultView:{innerWidth:1200,innerHeight:800,addEventListener(){}},addEventListener:(name,fn)=>listeners[name]=fn,elementFromPoint:()=>lane,body:{appendChild(){}},createElement:tag=>{created.push(tag);return {style:{},setAttribute(){},remove(){}};}};
    const root={ownerDocument:doc,dataset:{extent:'200'},contains:()=>true};
    const packet={documentId:1,revision:3,project:{scene:{durationFrames:200}}};
    const api=createMediaDrop({root,packet:()=>packet,prepare:async()=>true,commit:async intent=>calls.push(intent)});
    const event={button:0,pointerId:7,clientX:100,clientY:20,currentTarget:{setPointerCapture(){},hasPointerCapture:()=>false},preventDefault(){}};
    assert(api.begin({resourceId:'wav',kind:'audio'},event));
    listeners.pointermove({...event,clientX:600});listeners.pointerup({...event,clientX:600});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.length,['bgm','sfx'].includes(kind)?1:0);
    if(calls.length)assert.deepEqual(calls[0],{documentId:1,expectedRevision:3,source:{resourceId:'wav',kind:'audio'},target:{kind},atFrame:100});
    assert(!created.includes('dialog'));assert.equal(api.busy,false);
  }
});
test('image commit uses component API while same resource background uses background API',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),source=fs.readFileSync(require.resolve('./preview.js'),'utf8');
 const calls=[],selected=[];const context={current:{documentId:1,revision:2,project:{scene:{backgroundEvents:[{id:'bg'}]}}},crypto:{randomUUID:()=> 'cmd'},pausePlayback(){},checkedResult:r=>r,locate:async()=>{},productionAssets:{follow:fn=>fn()},selectImageComponent:id=>selected.push(id),allowProductionSelection:()=>true,backgroundEditor:{select:id=>selected.push(id)},log:{},window:{replay:{createComponent:async p=>{calls.push(['image',p]);return {created:{instanceId:'image'}};},dropBackgroundResource:async p=>{calls.push(['background',p]);return {created:{eventId:'bg'}};},dropAudioResource:()=>{throw Error('wrong API');}}}};
 vm.runInNewContext(source.slice(source.indexOf('async function commitMediaIntent('),source.indexOf('function selectTimelineIdentity(')),context);
 for(const kind of ['image','background'])await context.commitMediaIntent({documentId:1,expectedRevision:2,source:{kind:'image',resourceId:'png'},target:{kind},atFrame:17});
 assert.deepEqual(calls.map(c=>c[0]),['image','background']);assert.deepEqual(selected,['image','bg']);
 assert.equal(calls[0][1].resourceId,calls[1][1].resourceId);assert.equal(calls[0][1].type,'image');assert.equal(calls[0][1].atFrame,17);assert.equal(calls[0][1].x,0);assert.equal(calls[0][1].y,0);
 await assert.rejects(()=>context.commitMediaIntent({documentId:1,expectedRevision:2,source:{kind:'audio',resourceId:'wav'},target:{kind:'image'},atFrame:17}));assert.equal(calls.length,2);
});
const {expressionDropFrame} = require('./timeline-drop.js');
const rect = Object.freeze({left: 100, width: 1000});
const target = (source, kind, x = 600, extent = 200, duration = 200) =>
  mediaDropTarget(source, kind, x, rect, extent, duration);

test('images target background or image with distinct semantics; audio only targets audio lanes', () => {
  assert.deepEqual(target('image', 'background'), {kind: 'background', atFrame: 100});
  for (const kind of ['bgm', 'sfx']) {
    assert.equal(target('image', kind), null);
    assert.deepEqual(target('audio', kind), {kind, atFrame: 100});
  }
  assert.deepEqual(target('image','image'),{kind:'image',atFrame:100});
  assert.equal(target('audio','image'),null);
  assert.equal(target('audio', 'background'), null);
  for (const kind of ['audio', 'voice', 'dialogue', 'expression', '', undefined]) {
    assert.equal(target('audio', kind), null);
    assert.equal(target('image', kind), null);
  }
  assert.equal(target('video', 'audio'), null);
});

test('shares expressionDropFrame rounding and scene bounds', () => {
  for (const x of [99, 100, 102.4, 102.5, 600, 1099, 1100]) {
    const frame = expressionDropFrame(x, rect, 200, 200);
    assert.deepEqual(target('audio', 'sfx', x), frame === null ? null : {kind: 'sfx', atFrame: frame});
  }
  assert.equal(target('audio', 'bgm', 600, 400, 200), null);
  assert.deepEqual(target('audio', 'bgm', 1099), {kind: 'bgm', atFrame: 199});
});

test('invalid or missing geometry never yields an intent', () => {
  for (const x of [NaN, Infinity, -Infinity]) assert.equal(target('audio', 'bgm', x), null);
  for (const extent of [0, -1, NaN, Infinity]) assert.equal(target('audio', 'bgm', 600, extent), null);
  for (const duration of [0, -1, NaN, Infinity, undefined]) {
    assert.equal(mediaDropTarget('image', 'background', 600, rect, 200, duration), null);
  }
  for (const bounds of [null, {}, {left: 100, width: 0}, {left: NaN, width: 1000}]) {
    assert.equal(mediaDropTarget('audio', 'bgm', 600, bounds, 200, 200), null);
  }
});
