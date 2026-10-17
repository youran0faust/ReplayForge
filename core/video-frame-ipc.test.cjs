'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const root=path.resolve(__dirname,'..'),handlers={},events={},providers=[],calls=[],removed=[];
 const project={schemaVersion:5,resources:[{id:'v',kind:'video',frameCount:30,path:'assets/a.mp4'},{id:'image',kind:'image'}],scene:{}};
 const session={project,revision:0,savedRevision:0,snapshot:()=>structuredClone(project)};
 let ready, destroyed=false;const windowEvents={},dialogs=[],errors=[],cleanupErrors=[];
 const preventable=()=>({defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
 const web={mainFrame:{},send(){},once(){},isDestroyed:()=>destroyed},win={webContents:web,isDestroyed:()=>destroyed,on:(k,f)=>windowEvents[k]=f,loadFile(){},close(){
  if(destroyed)return;const event=preventable();windowEvents.close(event);if(!event.defaultPrevented){destroyed=true;events['window-all-closed']();}
 }};
 const realRequire=n=>require(n.startsWith('.')?path.resolve(root,n):n);
 const fakeFs={...fs,mkdirSync(){},mkdtempSync:p=>p+providers.length,lstatSync:p=>({dev:1,ino:String(p),isDirectory:()=>true,isSymbolicLink:()=>false}),rmSync:p=>removed.push(p)};
 const electron={app:{setPath(){},whenReady:()=>({then(f){ready=f;}}),on:(k,f)=>events[k]=f,quit(){
  events.quitCalls=(events.quitCalls||0)+1;assert.ok(events.quitCalls<20,'app.quit must not loop');
  const event=preventable();events['before-quit'](event);if(event.defaultPrevented)return;
  if(!destroyed)win.close();if(destroyed)events.quit=true;
 }},BrowserWindow:function(){return win;},dialog:{showMessageBox:()=>new Promise(resolve=>dialogs.push({resolve})),showErrorBox:(...args)=>errors.push(args)},ipcMain:{handle:(k,f)=>handlers[k]=f}};
 const fakeProvider={createVideoFrameProvider(options){const provider={options,disposed:0,prepare(input){return new Promise((resolve,reject)=>calls.push({input,resolve,reject,prepare:true}));},frame(input){return new Promise((resolve,reject)=>calls.push({input,resolve,reject}));},async dispose(){this.disposed++;}};providers.push(provider);return provider;}};
 const c=vm.createContext({console:{...console,error:(...args)=>cleanupErrors.push(args)},JSON,structuredClone,process:{env:{}},__dirname:root,setTimeout:()=>0,clearTimeout(){},require:n=>n==='electron'?electron:n==='fs'?fakeFs:n==='./core/video-frame-provider.cjs'?fakeProvider:n==='./core/recovery.cjs'?{RecoveryStore:class{clear(){}inspect(){return null;}},normalizeDraft:x=>x}:realRequire(n)});
 vm.runInContext(fs.readFileSync(path.join(root,'main.cjs'),'utf8')+'\nthis.setup=(s,w)=>{session=s;win=w;documentId=7;};this.change=(key,value)=>eval(key+"=value");this.reset=resetVideoFrames;this.inspect=()=>({documentId,busy,videoPending,videoGeneration,openedSchemaVersion,videoClosing,allowClose});',c);c.setup(session,win);
 const event={sender:web,senderFrame:web.mainFrame},request=(p={resourceId:'v',localFrame:0},e=event)=>handlers['video-frame'](e,p);
 return {c,session,project,providers,calls,removed,events,request,event,win,fakeFs,fakeProvider,dialogs,errors,cleanupErrors,quit:()=>electron.app.quit(),start:async()=>{await ready();c.setup(session,win);},destroy:()=>{destroyed=true;},prepare:(payload={},e=event)=>handlers['video-prepare'](e,payload)};
}
const frame={dataUrl:'data:image/png;base64,AAAA',width:1,height:1,frameIndex:0};
test('video IPC rejects sender/subframe and strict fields before side effects',async()=>{
 const f=fixture();for(const e of [{},{sender:f.event.sender},{...f.event,senderFrame:{}},{...f.event,sender:{}}])await assert.rejects(f.request(undefined,e),/VIDEO_SENDER/);
 const getter={resourceId:'v'};Object.defineProperty(getter,'localFrame',{enumerable:true,get(){throw Error('getter executed');}});
 for(const p of [null,[],{},getter,{resourceId:'v',localFrame:0,path:'evil'},{resourceId:'v',localFrame:0,[Symbol()]:1},{resourceId:'v',localFrame:-1},{resourceId:'v',localFrame:1.5},Object.create({resourceId:'v',localFrame:0})])await assert.rejects(f.request(p),/VIDEO_FIELDS/);
 for(const p of [{resourceId:'image',localFrame:0},{resourceId:'missing',localFrame:0},{resourceId:'v',localFrame:30}])await assert.rejects(f.request(p),/VIDEO_RESOURCE/);
 for(const p of [{documentId:6},{revision:1},{revision:NaN}])await assert.rejects(f.request({resourceId:'v',localFrame:0,...p}),/VIDEO_DOCUMENT/);
 assert.equal(f.providers.length,0);assert.equal(f.session.revision,0);assert.equal(f.project.schemaVersion,5);
});
test('captures project and fixed executable without locking or mutating',async()=>{
 const f=fixture(),before=structuredClone(f.project),p=f.request({resourceId:'v',localFrame:0,documentId:7,revision:0});
 assert.equal(f.c.inspect().busy,false);assert.equal(f.calls[0].input.projectRoot,path.resolve(__dirname,'..'));assert.deepEqual(f.calls[0].input.project,before);
 assert.equal(f.providers[0].options.ffmpegPath,path.resolve(__dirname,'../../p0/tools/ffmpeg.exe'));assert.match(f.providers[0].options.cacheRoot,/runtime-output[\\/]video-cache[\\/]preview-/);
 f.calls[0].resolve(frame);assert.deepEqual(await p,frame);assert.deepEqual(f.project,before);assert.equal(f.session.revision,0);
 f.c.change('busy',true);await assert.rejects(f.request(),/BUSY/);assert.equal(f.calls.length,1);
});
test('late revisions, documents, roots and closed windows reject replies',async()=>{
 for(const change of [f=>f.session.revision++,f=>f.c.change('documentId',8),f=>f.c.change('projectRoot','different'),f=>f.c.change('session',{...f.session}),f=>f.win.isDestroyed=()=>true]){
  const f=fixture(),p=f.request();change(f);f.calls[0].resolve(frame);await assert.rejects(p,/VIDEO_STALE|VIDEO_SENDER/);
 }
});
test('newest same-resource token suppresses old results and queue is bounded',async()=>{
 const f=fixture(),pending=[];for(let i=0;i<16;i++)pending.push(f.request({resourceId:'v',localFrame:i}).then(()=>true,e=>e.message));
 await assert.rejects(f.request(),/BUSY/);assert.equal(f.calls.length,16);
 f.calls.forEach(c=>c.resolve(frame));const results=await Promise.all(pending);assert.ok(results.slice(0,-1).every(r=>/VIDEO_STALE/.test(r)));assert.equal(results[15],true);assert.equal(f.c.inspect().videoPending,0);
});
test('reset and shutdown dispose generations and prevent old callbacks',async()=>{
 const f=fixture(),p=f.request().catch(e=>e.message),old=f.providers[0];await f.c.reset();assert.equal(old.disposed,1);assert.equal(old.options.check(),false);
 const fresh=f.request();f.calls[0].resolve(frame);assert.match(await p,/VIDEO_STALE/);assert.equal(f.providers[1].options.check(),true);f.calls[1].resolve(frame);await fresh;
 f.destroy();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await new Promise(resolve=>setImmediate(resolve));assert.equal(prevented,true);assert.equal(f.providers[1].disposed,1);assert.equal(f.events.quit,true);assert.equal(f.removed.length,2);await assert.rejects(f.request(),/VIDEO_SENDER/);
});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function prepared(f){const pending=f.prepare();f.calls.at(-1).resolve({prepared:1});await pending;}
test('app quit cancellation keeps provider usable, acceptance waits for one disposal',async()=>{
 const f=fixture();await f.start();await prepared(f);f.session.revision++;
 f.quit();f.quit();f.win.close();assert.equal(f.dialogs.length,1);assert.equal(f.providers[0].disposed,0);assert.equal(f.c.inspect().videoClosing,false);
 f.dialogs[0].resolve({response:0});await settle();assert.equal(f.win.isDestroyed(),false);await prepared(f);
 const pendingFrame=f.request();f.calls.at(-1).resolve(frame);assert.deepEqual(await pendingFrame,frame);
 assert.equal(f.providers.length,1);assert.equal(f.providers[0].options.check(),true);assert.equal(f.events.quit,undefined);
 let finish;f.providers[0].dispose=function(){this.disposed++;return new Promise(resolve=>finish=resolve);};
 f.quit();assert.equal(f.dialogs.length,2);f.dialogs[1].resolve({response:1});await settle();
 assert.equal(f.providers[0].disposed,1);assert.equal(f.win.isDestroyed(),false);assert.equal(f.removed.length,0);
 f.quit();f.win.close();assert.equal(f.dialogs.length,2);finish();await settle();
 assert.equal(f.win.isDestroyed(),true);assert.equal(f.events.quit,true);assert.equal(f.providers[0].disposed,1);assert.equal(f.removed.length,1);assert.equal(f.errors.length,0);
 await assert.rejects(f.prepare(),/VIDEO_SENDER/);
});
test('busy and exporting veto app quit without disposing preview or showing discard dialogs',async()=>{
 for(const guard of ['busy','exporting']){
  const f=fixture();await f.start();await prepared(f);f.session.revision++;f.c.change(guard,true);
  f.quit();f.quit();await settle();assert.equal(f.dialogs.length,0);assert.equal(f.win.isDestroyed(),false);assert.equal(f.providers[0].disposed,0);assert.equal(f.providers[0].options.check(),true);assert.equal(f.c.inspect().videoClosing,false);
  f.c.change(guard,false);await prepared(f);assert.equal(f.providers.length,1);
 }
});
test('clean app quit and direct window close share approval and disposal',async()=>{
 for(const direct of [false,true]){
  const f=fixture();await f.start();await prepared(f);if(direct)f.win.close();else f.quit();await settle();
  assert.equal(f.dialogs.length,0);assert.equal(f.events.quit,true);assert.equal(f.providers[0].disposed,1);assert.equal(f.removed.length,1);
 }
});
test('quit cleanup failure and foreign roots do not loop or remove unowned data',async()=>{
 for(const noWindow of [false,true])for(const failure of [false,true]){
  const f=fixture();await f.start();await prepared(f);
  f.fakeFs.lstatSync=()=>({dev:2,ino:'foreign',isDirectory:()=>true,isSymbolicLink:()=>false});
  if(failure)f.providers[0].dispose=function(){this.disposed++;return Promise.reject(Error('dispose failed'));};
  if(noWindow)f.destroy();f.quit();f.quit();await settle();
  assert.equal(f.events.quit,true);assert.equal(f.providers[0].disposed,1);assert.equal(f.removed.length,0);assert.equal(f.cleanupErrors.length,failure?1:0);assert.ok(f.events.quitCalls<=4);
 }
});
test('no-main-window quit waits for already pending reset only once',async()=>{
 const f=fixture();await f.start();await prepared(f);let finish;
 f.providers[0].dispose=function(){this.disposed++;return new Promise(resolve=>finish=resolve);};
 const reset=f.c.reset();f.destroy();f.quit();f.quit();await settle();assert.equal(f.events.quit,undefined);assert.equal(f.providers[0].disposed,1);
 finish();await reset;await settle();assert.equal(f.events.quit,true);assert.equal(f.events.quitCalls,3);assert.equal(f.removed.length,1);
});
test('cleanup preserves replacement roots on reset and factory failure',async()=>{
 for(const replacement of [{dev:2,ino:'foreign',isDirectory:()=>true,isSymbolicLink:()=>false},{dev:1,ino:'foreign',isDirectory:()=>true,isSymbolicLink:()=>true}]){
  const f=fixture(),pending=f.request().catch(()=>null);f.fakeFs.lstatSync=()=>replacement;await f.c.reset();f.calls[0].resolve(frame);await pending;assert.equal(f.removed.length,0);
  const failed=fixture();failed.fakeProvider.createVideoFrameProvider=()=>{failed.fakeFs.lstatSync=()=>replacement;throw Error('factory failed');};await assert.rejects(failed.request(),/factory failed/);assert.equal(failed.removed.length,0);
 }
});
test('prepare validates sender and exact fields without side effects',async()=>{
 const f=fixture();await assert.rejects(f.prepare({},{}),/VIDEO_SENDER/);await assert.rejects(f.prepare({}, {...f.event,senderFrame:{}}),/VIDEO_SENDER/);
 const getter={};Object.defineProperty(getter,'revision',{enumerable:true,get(){throw Error('getter executed');}});
 for(const payload of [null,[],{path:'evil'},{resourceId:'v'},{expectedRevision:0},{[Symbol()]:0},getter])await assert.rejects(f.prepare(payload),/VIDEO_FIELDS/);
 for(const payload of [{documentId:8},{revision:-1},{revision:1}])await assert.rejects(f.prepare(payload),/VIDEO_DOCUMENT/);
 assert.equal(f.providers.length,0);f.c.change('busy',true);await assert.rejects(f.prepare(),/BUSY/);
});
test('prepare captures document, rejects races and shares frame pending limit',async()=>{
 for(const change of [f=>f.session.revision++,f=>f.c.change('documentId',8),f=>f.c.change('projectRoot','changed'),f=>f.c.reset(),f=>f.win.isDestroyed=()=>true]){
  const f=fixture(),before=structuredClone(f.project),p=f.prepare({documentId:7,revision:0});assert.equal(f.c.inspect().busy,false);assert.equal(f.calls[0].prepare,true);assert.deepEqual(f.calls[0].input.project,before);change(f);f.calls[0].resolve({prepared:1});await assert.rejects(p,/VIDEO_STALE|VIDEO_SENDER/);assert.deepEqual(f.project,before);
 }
 const f=fixture(),pending=[f.prepare()];for(let i=0;i<15;i++)pending.push(f.request().catch(()=>null));await assert.rejects(f.prepare(),/BUSY/);await assert.rejects(f.request(),/BUSY/);f.calls.forEach(c=>c.resolve(c.prepare?{prepared:0}:frame));assert.deepEqual((await Promise.all(pending))[0],{prepared:0});assert.equal(f.c.inspect().videoPending,0);
});
test('preload defaults frame requests to observed document/revision',async()=>{
 let api;const listeners={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_,a)=>api=a},ipcRenderer:{on:(k,f)=>listeners[k]=f,invoke:async(k,p)=>{calls.push([k,p]);return k==='project'?{documentId:3,revision:4}:frame;}}})});
 await api.videoFrame({resourceId:'v',localFrame:2});assert.equal(calls[1][1].documentId,3);assert.equal(calls[1][1].revision,4);
 listeners.state({},null,null,9,{}, {documentId:8});await api.videoFrame({resourceId:'v',localFrame:3});assert.equal(calls[2][1].documentId,8);assert.equal(calls[2][1].revision,9);assert.equal(calls[2][0],'video-frame');
 await api.prepareVideo();assert.equal(calls[3][0],'video-prepare');assert.equal(calls[3][1].documentId,8);assert.equal(calls[3][1].revision,9);
 await api.prepareVideo({documentId:8,expectedRevision:9});assert.equal(calls[4][1].revision,9);assert.equal(Object.hasOwn(calls[4][1],'expectedRevision'),false);
 await assert.rejects(api.prepareVideo({revision:9,expectedRevision:8}),/conflicting/);
});
