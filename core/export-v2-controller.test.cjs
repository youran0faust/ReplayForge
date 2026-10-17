'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createController}=require('./export-v2-controller.cjs');
function setup(over={}){let busy=false;const messages=[];const event={sender:{send:(c,p)=>messages.push(p)}};const d={authorize:e=>assert.equal(e,event),requireIdle(){},guardDrafts(){},capture:()=>({root:'root'}),snapshot:()=>({title:'x'}),assertUnchanged(){},setBusy:v=>busy=v,checkDependencies(){},publicName:n=>n+'.mp4',chooseTarget:async()=>({canceled:true}),validateTarget(){},managedRoot:()=>path.resolve('test-output/controller-mock'),ordinary(){},spec:()=>({}),coordinator:{},finalize(){},showItem(){},...over};return{c:createController(d),d,event,messages,busy:()=>busy};}
test('sender authorization and settings whitelist',async()=>{const x=setup();await assert.rejects(x.c.start({},{}));await assert.rejects(x.c.start(x.event,{target:'bad'}),/无效/);await assert.rejects(x.c.start(x.event,{workers:3}),/无效/);});
test('cancelled native chooser resets lifecycle returns null',async()=>{const x=setup();assert.equal(await x.c.start(x.event,{workers:4}),null);assert.equal(x.busy(),false);assert.equal(x.c.busy,false);});
test('revision race rejects after dialog and before filesystem',async()=>{const x=setup({assertUnchanged(){throw Error('changed');}});await assert.rejects(x.c.start(x.event),/changed/);assert.equal(x.busy(),false);});
test('duplicate in-flight request and cancellation before selected target',async()=>{let resolve;const x=setup({chooseTarget:()=>new Promise(r=>resolve=r)});const p=x.c.start(x.event);await assert.rejects(x.c.start(x.event),/已有/);assert.deepEqual(x.c.cancel(x.event),{cancelled:true});resolve({filePath:'unused.mp4'});await assert.rejects(p,/已取消/);assert.equal(x.busy(),false);});
test('no arbitrary folder opening before successful export',()=>{const x=setup();assert.throws(()=>x.c.openFolder(x.event),/尚无/);assert.deepEqual(x.c.cancel(x.event),{cancelled:false});});
test('successful return remains string and cleanup failure is warning',async()=>{
 const original={existsSync:fs.existsSync,mkdirSync:fs.mkdirSync,openSync:fs.openSync,writeFileSync:fs.writeFileSync,fsyncSync:fs.fsyncSync,closeSync:fs.closeSync,renameSync:fs.renameSync};
 const id='12345678-1234-1234-1234-123456789abc';
 try{fs.existsSync=()=>false;fs.mkdirSync=()=>{};fs.openSync=()=>9;fs.writeFileSync=()=>{};fs.fsyncSync=()=>{};fs.closeSync=()=>{};fs.renameSync=()=>{};
 const x=setup({chooseTarget:async()=>({filePath:'chosen.mp4'}),coordinator:{create:async()=>({jobId:id,jobRoot:'owned'}),run:async()=>({status:'VIDEO_SEGMENTS_COMPLETE'})},finalize:async()=>({status:'PASS',output:'chosen.mp4'}),cleanupCompleted:async()=>{throw Error('retained');}});
 assert.equal(await x.c.start(x.event),'chosen.mp4');assert(x.messages.some(p=>p.stage==='cleanup-warning'));assert.equal(x.busy(),false);
 }finally{Object.assign(fs,original);}
});
