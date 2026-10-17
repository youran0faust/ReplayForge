const test=require('node:test'),assert=require('node:assert/strict');
const {createVideoRenderer}=require('./video-renderer.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(t,requestFrame,options={}){
 const old=global.document,images=[];
 function node(tag){const n={tag,style:{},children:[],hidden:false,appendChild(c){this.children.push(c);},replaceChildren(...children){this.children=children;},remove(){},naturalWidth:2,naturalHeight:2};if(tag==='img'){n.decoding=deferred();n.decode=()=>n.decoding.promise;images.push(n);}return n;}
 global.document={createElement:node};t.after(()=>{global.document=old;});
 const stage=node('div'),renderer=createVideoRenderer(stage,{requestFrame,timeoutMs:500,...options});t.after(()=>renderer.dispose());return {stage,renderer,images};
}
const project={resources:[{id:'v',path:'a.mp4'}]},state=n=>({activeVideo:{clipId:'c',resourceId:'v',localFrame:n,width:2,height:2}}),result=n=>({dataUrl:'data:image/png;base64,AAAA',frameIndex:n,width:2,height:2});
const flush=()=>new Promise(setImmediate);
const previewSource=require('node:fs').readFileSync(require.resolve('./preview.js'),'utf8');
const previewHelper=previewSource.slice(previewSource.indexOf('let videoPlaybackStartBusy = false;'),previewSource.indexOf('const playback = window.playbackController'));
function previewFixture(video=true){const preparation=deferred(),calls=[];const context={current:{documentId:'d',revision:1,project:{scene:{videoClips:video?[{resourceId:'v'}]:[]}},resourceUrls:{}},playbackGeneration:0,log:{},window:{replay:{prepareVideo(){calls.push('prepare');return preparation.promise;}}},playback:{async play(...args){calls.push(['play',...args]);}}};require('node:vm').createContext(context);require('node:vm').runInContext(previewHelper,context);return {context,calls,preparation,start:(...args)=>context.startPreparedPlayback(...args)};}
test('preview video prewarm precedes clock; duplicate start is ignored',async()=>{const f=previewFixture();const p=f.start(7,{endFrame:9});await f.start(8);assert.deepEqual(f.calls,['prepare']);f.preparation.resolve({resourceCount:2});await p;assert.equal(f.calls[1][0],'play');assert.equal(f.calls[1][3],7);assert.deepEqual(f.calls[1][4],{endFrame:9});});
test('preview pause/seek, foreign document/revision/project/packet cancel auto resume',async()=>{for(const mutate of [c=>c.playbackGeneration++,c=>c.current.documentId='foreign',c=>c.current.revision++,c=>c.current.project={scene:{videoClips:[]}},c=>c.current={...c.current}]){const f=previewFixture();const p=f.start(0);mutate(f.context);f.preparation.resolve();await p;assert.deepEqual(f.calls,['prepare']);}});
test('preview preparation failure does not play and releases busy guard',async()=>{const f=previewFixture();const p=f.start(0);f.preparation.reject(Error('budget exceeded'));await assert.rejects(p,/budget exceeded/);assert.deepEqual(f.calls,['prepare']);f.context.window.replay.prepareVideo=async()=>({resourceCount:1});await f.start(0);assert.equal(f.calls.at(-1)[0],'play');});
test('preview no-video projects skip prepare; both play entry points wired',async()=>{const f=previewFixture(false);await f.start(4);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'play');assert.match(previewSource,/await startPreparedPlayback\(start, \{endFrame: end\}\)/);assert.match(previewSource,/await startPreparedPlayback\(Number\(frame.value\)\)/);});
test('preview error bridge pauses the real clock, clears queued frames and logs video context',async t=>{
 const vm=require('node:vm'),{createPlaybackController}=require('./playback.js');
 const audio={currentTime:0,resume:async()=>{}},raf=new Map();let id=0;
 const playback=createPlaybackController({audioContextFactory:()=>audio,requestFrame:cb=>{raf.set(++id,cb);return id;},cancelFrame:id=>raf.delete(id)});
 const p={design:{fps:30},scene:{durationFrames:300},resources:[]};await playback.play(p);assert.equal(playback.state,'playing');
 const context={window:{},stage:{},current:undefined,log:{},playback,playbackGeneration:0,pendingFrame:9,createSceneRenderer:(stage,options)=>({render(){},options})};
 vm.createContext(context);
 const helper=previewSource.slice(previewSource.indexOf('const sceneRenderer = window.sceneRenderer'),previewSource.indexOf('let productionAssets='));
 vm.runInContext(helper+'\n'+previewSource.slice(previewSource.indexOf('function pausePlayback()'),previewSource.indexOf('\n\nfunction characterReadView')),context);
 context.packet={documentId:'d',project:p};context.state=state(7);
 vm.runInContext('current=packet; renderPreviewScene(state, current.project, {});',context);
 audio.currentTime=1;context.window.sceneRenderer.options.onVideoError(Error('bridge rejected'),{project:p,state:context.state,active:context.state.activeVideo});
 assert.equal(playback.state,'paused');assert.equal(raf.size,0);assert.equal(context.pendingFrame,null);assert.equal(context.playbackGeneration,1);assert.match(context.log.textContent,/视频错误.*bridge rejected.*源帧 7.*暂停/);
 const frame=playback.frame;audio.currentTime=2;assert.equal(playback.frame,frame);
 // A replaced document/project must not be paused by an old render's callback.
 await playback.play(p);vm.runInContext('current={...packet,documentId:"new"};',context);
 context.window.sceneRenderer.options.onVideoError(Error('stale'),{project:p,state:context.state,active:context.state.activeVideo});assert.equal(playback.state,'playing');assert.doesNotMatch(context.log.textContent,/stale/);playback.pause();
 const pump=previewSource.slice(previewSource.indexOf('async function pumpPlaybackFrame()'),previewSource.indexOf('function pausePlayback()'));
 assert.doesNotMatch(pump,/\.ready\(/,'playback never waits double RAF readiness');assert.match(pump,/renderPreviewScene/);
});
async function decode(f){await flush();f.images.at(-1).decoding.resolve();await f.renderer.ready();}
test('single inflight coalesces a slow decode burst directly to latest desired frame',async t=>{
 const requests=[];const f=fixture(t,p=>{const d=deferred();requests.push({...d,...p});return d.promise;});
 f.renderer.renderActive(state(0),project);const waiting=f.renderer.ready();
 for(let n=1;n<40;n++)f.renderer.renderActive(state(n),project);
 assert.equal(requests.length,1);requests[0].resolve(result(0));await flush();
 assert.deepEqual(requests.map(r=>r.localFrame),[0,39]);assert.equal(f.images.length,0);
 requests[1].resolve(result(39));await flush();let ready=false;waiting.then(()=>ready=true);await flush();assert.equal(ready,false);
 f.images[0].decoding.resolve();await waiting;assert.equal(f.renderer.layer.children[0],f.images[0]);assert.equal(f.renderer.layer.style.zIndex,'3');
 // Re-seek consults provider again so external file replacement is revalidated.
 f.renderer.renderActive(state(0),project);assert.equal(requests.length,3);requests[2].resolve(result(0));await decode(f);
});
test('same frame ticks avoid IPC; old good image remains until next image decode',async t=>{
 let calls=0;const f=fixture(t,async p=>{calls++;return result(p.localFrame);});
 f.renderer.renderActive(state(0),project);await decode(f);const previous=f.images[0];
 f.renderer.renderActive({...state(0),activeVideo:{...state(0).activeVideo,clipId:'other'}},project);assert.equal(calls,1);
 f.renderer.renderActive(state(1),project);await flush();assert.equal(f.renderer.layer.children[0],previous);
 f.images[1].decoding.resolve();await f.renderer.ready();assert.equal(f.renderer.layer.children[0],f.images[1]);
 f.renderer.renderActive(state(0),project);await decode(f);assert.equal(calls,3);
});
test('superseded image decoding does not delay latest IPC or show late image',async t=>{
 let calls=0;const f=fixture(t,async p=>{calls++;return result(p.localFrame);});
 f.renderer.renderActive(state(0),project);await flush();const stale=f.images[0];
 f.renderer.renderActive(state(1),project);await flush();assert.equal(calls,2);
 f.images[1].decoding.resolve();await f.renderer.ready();stale.decoding.resolve();await flush();assert.equal(f.renderer.layer.children[0],f.images[1]);
});
test('project/null clears immediately and old response cannot cross epoch',async t=>{
 const requests=[];const f=fixture(t,p=>{const d=deferred();requests.push({...d,...p});return d.promise;});
 f.renderer.renderActive(state(0),project);f.renderer.renderActive(state(0),{...project});assert.equal(requests.length,1);
 requests[0].resolve(result(0));await flush();assert.equal(requests.length,2);assert.equal(f.images.length,0);
 f.renderer.renderActive({activeVideo:null},project);requests[1].resolve(result(0));await f.renderer.ready();await flush();assert.equal(f.images.length,0);assert.equal(f.renderer.layer.hidden,true);
 f.renderer.renderActive(state(0),project);assert.equal(requests.length,3);requests[2].resolve(result(0));await decode(f);
});
test('exact response mismatch, dimensions and decode error reject latest ready',async t=>{
 let mode='ok';const f=fixture(t,async p=>result(mode==='wrong'?9:p.localFrame));
 f.renderer.renderActive(state(0),project);await decode(f);
 mode='wrong';f.renderer.renderActive(state(1),project);await assert.rejects(f.renderer.ready(),/mismatch/);assert.equal(f.renderer.layer.children.length,0);
 mode='ok';f.renderer.renderActive(state(2),project);await flush();f.images.at(-1).naturalWidth=3;f.images.at(-1).decoding.resolve();await assert.rejects(f.renderer.ready(),/dimensions/);
 f.renderer.renderActive(state(3),project);await flush();f.images.at(-1).decoding.reject(Error('decode failed'));await assert.rejects(f.renderer.ready(),/decode failed/);
});
test('timeout rejects without releasing physical request slot or late display',async t=>{
 const requests=[];const f=fixture(t,p=>{const d=deferred();requests.push(d);return d.promise;},{timeoutMs:15});
 f.renderer.renderActive(state(0),project);await assert.rejects(f.renderer.ready(),/timeout/);
 f.renderer.renderActive(state(1),project);assert.equal(requests.length,1);requests[0].resolve(result(0));await flush();assert.equal(requests.length,2);assert.equal(f.images.length,0);
 requests[1].resolve(result(1));await decode(f);
});
test('ready follows latest target after superseded request rejects',async t=>{
 const a=deferred(),b=deferred();let n=0;const f=fixture(t,()=>++n===1?a.promise:b.promise);
 f.renderer.renderActive(state(0),project);const waiting=f.renderer.ready();f.renderer.renderActive(state(1),project);a.reject(Error('stale'));await flush();b.resolve(result(1));await decode(f);await waiting;
});
test('latest failures notify once, keep black cover, reject ready and permit same-frame retry',async t=>{
 for(const mode of ['bridge','sync','invalid PNG','dimensions','decode','timeout'])await t.test(mode,async t=>{
  const errors=[];let calls=0,broken=true;const late=deferred();
  const f=fixture(t,p=>{calls++;if(!broken)return Promise.resolve(result(p.localFrame));if(mode==='sync')throw Error('sync failed');if(mode==='bridge')return Promise.reject(Error('bridge failed'));if(mode==='timeout')return late.promise;return Promise.resolve(mode==='invalid PNG'?{...result(p.localFrame),dataUrl:'not PNG'}:result(p.localFrame));},{timeoutMs:20,onError:(...args)=>errors.push(args)});
  f.renderer.renderActive(state(4),project);const rejected=assert.rejects(f.renderer.ready());
  await flush();if(mode==='dimensions'){f.images[0].naturalHeight=3;f.images[0].decoding.resolve();}if(mode==='decode')f.images[0].decoding.reject(Error('invalid PNG decode'));
  await rejected;await flush();assert.equal(errors.length,1);assert.equal(errors[0][1].project,project);assert.equal(errors[0][1].active.localFrame,4);
  assert.equal(f.renderer.layer.hidden,false);assert.equal(f.renderer.layer.style.display,'block');assert.equal(f.renderer.layer.style.backgroundColor,'#000000');assert.equal(f.renderer.layer.children.length,0);
  await assert.rejects(f.renderer.ready());assert.equal(errors.length,1);assert.equal(calls,1,'failure must not auto retry');
  broken=false;f.renderer.renderActive(state(4),project);if(mode==='timeout')late.reject(Error('late bridge rejection'));await decode(f);assert.equal(calls,2);assert.equal(errors.length,1);
  f.renderer.renderActive({activeVideo:null},project);assert.equal(f.renderer.layer.hidden,true);await f.renderer.ready();
 });
});
test('superseded bridge/decode/project/null failures never notify',async t=>{
 for(const mode of ['bridge','decode','project','null','dispose'])await t.test(mode,async t=>{
  const errors=[],requests=[];const f=fixture(t,()=>{const d=deferred();requests.push(d);return d.promise;},{onError:e=>errors.push(e)});
  f.renderer.renderActive(state(0),project);
  if(mode==='decode'){requests[0].resolve(result(0));await flush();}
  if(mode==='dispose')f.renderer.dispose();else f.renderer.renderActive(mode==='null'?{}:state(1),mode==='project'?{...project}:project);
  if(mode==='decode')f.images[0].decoding.reject(Error('stale decode'));else requests[0].reject(Error('stale bridge'));
  await flush();assert.equal(errors.length,0);
  if(!['null','dispose'].includes(mode)){requests[1].resolve(result(1));await decode(f);assert.equal(errors.length,0);}
 });
});
test('synchronous failure notification is deferred and suppressed if replaced before delivery',async t=>{
 const errors=[];const f=fixture(t,()=>{throw Error('sync');},{onError:e=>errors.push(e)});
 f.renderer.renderActive(state(0),project);assert.equal(errors.length,0);f.renderer.renderActive({},project);await flush();assert.equal(errors.length,0);
});
test('re-seeking consults provider instead of retaining stale source URLs',async t=>{
 let calls=0;const f=fixture(t,async p=>{calls++;return result(p.localFrame);});
 for(const n of [0,1,0,2,1]){f.renderer.renderActive(state(n),project);await decode(f);}assert.equal(calls,5);
});
