'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const fs=require('node:fs'),path=require('node:path');
const {capturePaintedFrame,markerBytes}=require('./export-capture.cjs');
const opts={width:960,height:540,token:1};
function painted(token,content,width=960,height=540){return {getSize:()=>({width:Math.max(width,5),height:height+1}),crop(rect){if(rect.y===height){const data=Buffer.from((token?markerBytes(token):[0,0,0,0,0]).flatMap(v=>[v,v,v,255]));return {toBitmap:()=>data};}assert.deepEqual(rect,{x:0,y:0,width,height});return {content,getSize:()=>({width,height})};}};}
class Offscreen extends EventEmitter {
 constructor(){super();this.invalidations=0;this.destroyed=false;this.scripts=[];}
 isOffscreen(){return true;}isDestroyed(){return this.destroyed;}
 executeJavaScript(script){assert.equal(this.listenerCount('paint'),1);this.scripts.push(script);return Promise.resolve(true);}
 invalidate(){this.invalidations++;assert.equal(this.listenerCount('paint'),1);}
 acknowledge(token,content,legacy=false,width=960,height=540){const image=painted(token,content,width,height);if(legacy)this.emit('paint',{},null,image);else this.emit('paint',{image});}
 capturePage(){throw Error('Must not use stale copy-output cache');}
}
function clean(w){assert.equal(w.listenerCount('paint'),0);assert.equal(w.listenerCount('destroyed'),0);}
test('queued initialization and previous frame paints do not acknowledge target token',async()=>{
 const w=new Offscreen();let complete=false;const result=capturePaintedFrame(w,opts).then(x=>{complete=true;return x;});await Promise.resolve();
 w.acknowledge(0,'init');await Promise.resolve();assert.equal(complete,false);assert.equal(w.invalidations,1);
 w.acknowledge(1,'frame0');assert.equal((await result).content,'frame0');clean(w);
 const next=capturePaintedFrame(w,{...opts,token:2});w.acknowledge(1,'frame0');w.acknowledge(2,'frame1',true);assert.equal((await next).content,'frame1');clean(w);
});
test('unchanged frames use new tokens and marker row is never part of returned stage',async()=>{
 const w=new Offscreen();for(let token=1;token<=3;token++){const p=capturePaintedFrame(w,{...opts,token});await Promise.resolve();w.acknowledge(token-1,'stale');w.acknowledge(token,'same');const image=await p;assert.equal(image.content,'same');assert.deepEqual(image.getSize(),{width:960,height:540});clean(w);}assert.equal(w.invalidations,3);
});
test('tiny stages keep their original crop dimensions despite wider marker viewport',async()=>{
 const w=new Offscreen(),p=capturePaintedFrame(w,{width:2,height:2,token:9});w.acknowledge(9,'tiny',false,2,2);assert.deepEqual((await p).getSize(),{width:2,height:2});clean(w);
});
test('timeout rejects stale-only paints and removes listeners',async()=>{
 const w=new Offscreen(),p=capturePaintedFrame(w,{...opts,timeoutMs:15,pollMs:2});w.acknowledge(0,'init');await assert.rejects(p,/timed out/);clean(w);
});
test('cancel pending marker execution and ignore its late completion',async()=>{
 const w=new Offscreen();let release,cancelled=false;w.executeJavaScript=()=>new Promise(r=>{release=r;});const p=capturePaintedFrame(w,{...opts,pollMs:2,checkCancelled(){if(cancelled)throw Error('cancelled');}});cancelled=true;await assert.rejects(p,/cancelled/);clean(w);release(true);await Promise.resolve();assert.equal(w.invalidations,0);
});
test('execution, invalidate, crop errors and destroyed webContents fail with cleanup',async()=>{
 for(const kind of ['execute','invalidate','crop','destroy']){const w=new Offscreen();if(kind==='execute')w.executeJavaScript=()=>Promise.reject(Error('execution failed'));if(kind==='invalidate')w.invalidate=()=>{throw Error('invalidate failed');};const p=capturePaintedFrame(w,opts);if(kind==='crop')w.emit('paint',{image:{getSize:()=>({width:960,height:541}),crop(){throw Error('crop failed');}}});if(kind==='destroy'){w.destroyed=true;w.emit('destroyed');}await assert.rejects(p,/failed|destroyed/);clean(w);}
});
test('missing offscreen API, bad token, wrong paint dimensions fail closed',async()=>{
 for(const change of [{invalidate:undefined},{isOffscreen:()=>false}]){const w=Object.assign(new Offscreen(),change);await assert.rejects(capturePaintedFrame(w,opts),/requires offscreen/);clean(w);}
 for(const token of [0,-1,1.5,0x1000000])await assert.rejects(capturePaintedFrame(new Offscreen(),{...opts,token}),/token/);
 const w=new Offscreen(),p=capturePaintedFrame(w,opts);w.emit('paint',{image:painted(1,'wrong',1,1)});await assert.rejects(p,/dimensions/);clean(w);
});
test('production uses expanded viewport and target token only after renderer target readiness',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../export-main.cjs'),'utf8'),render=source.indexOf('`renderFrame(${JSON.stringify(state)})`'),capture=source.indexOf("require('./core/export-capture.cjs').capturePaintedFrame(win.webContents, {width, height, token:f+1, checkCancelled})");assert(render>=0&&capture>render);assert(source.includes('width: Math.max(width, 5), height: height + 1'));assert(!source.includes('await win.webContents.capturePage()'));
});
