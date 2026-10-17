const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const {ProjectSession}=require('./session.cjs'),{validateProject}=require('./model.cjs'),{importExpressionImage,unbindImage}=require('./image-import.cjs'),{saveSessionPortable,openPortable}=require('./project-storage.cjs');
const root=path.join(__dirname,'..'),example=JSON.parse(fs.readFileSync(path.join(root,'examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,'')),cid=example.scene.characters[0].id,images=example.resources.filter(r=>r.kind==='image').map(r=>r.id);
function fresh(){const s=new ProjectSession(example);s.apply(p=>{p.scene.characters[0].resourceId=images[0]});s.setPortraitCanvas(cid,{width:100,height:200});return s}
const layer=(id='l')=>({id,resourceId:images[1],x:10,y:20,width:30,height:40});const overlay=()=>({name:'face',mode:'overlay',layers:[layer()]});
function atomic(s,fn){const before=JSON.stringify(s);assert.throws(fn);assert.equal(JSON.stringify(s),before)}
function dir(t){const d=fs.mkdtempSync(path.join(root,'overlay-test-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d}
function png(){return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=','base64')}
test('legacy shape exact, mode replacement removes incompatible fields, canvas one undo transaction',()=>{
 const s=fresh(),old={name:'old',resourceId:images[1]},id=s.addExpression(cid,old).id;
 assert.deepEqual(s.snapshot().scene.characters[0].expressions,[{id,...old}]);
 s.editExpression(cid,id,overlay());assert.equal(s.snapshot().scene.characters[0].expressions[0].resourceId,undefined);
 s.editExpression(cid,id,{...old,mode:'replace'});assert.equal(s.snapshot().scene.characters[0].expressions[0].layers,undefined);
 s.undo();assert.equal(s.snapshot().scene.characters[0].expressions[0].mode,'overlay');
 const before=s.snapshot(),rev=s.revision;s.setPortraitCanvas(cid,{width:120,height:220});assert.equal(s.revision,rev+1);s.undo();assert.deepEqual(s.snapshot(),before);
});
test('strict shape, geometry, references, base, canvas, reserved derived state reject atomically',()=>{
 const s=fresh(),id=s.addExpression(cid,overlay()).id;
 for(const value of [null,{width:0,height:1},{width:8193,height:1},{width:1.1,height:20},{width:100,height:200,x:1},{width:1,height:1}])atomic(s,()=>s.setPortraitCanvas(cid,value));
 const bad=[{name:'x'},{...overlay(),id:'hack'},{...overlay(),resourceId:images[0]},{name:'x',mode:'bogus',resourceId:images[0]},{name:'x',mode:undefined,resourceId:images[0]},{name:'x',resourceId:images[0],layers:[]},{...overlay(),layers:[layer(),layer()]},{...overlay(),layers:null}];
 for(const p of [{x:-1},{x:NaN},{x:Infinity},{y:-1},{width:0},{height:8193},{x:99},{resourceId:'missing'},{resourceId:example.resources.find(r=>r.kind!=='image')?.id||'bad'},{extra:1}])bad.push({...overlay(),layers:[{...layer(),...p}]});
 for(const p of bad){atomic(s,()=>s.editExpression(cid,id,p));atomic(s,()=>s.addExpression(cid,p))}
 atomic(s,()=>unbindImage(s,{kind:'character',id:cid}));
 for(const mutate of [c=>delete c.portraitCanvas,c=>delete c.resourceId,c=>c.resourceId='missing',c=>c.portraitLayers=[],c=>c.portraitLayers=undefined]){const p=s.snapshot();mutate(p.scene.characters[0]);assert.ok(validateProject(p).length)}
 s.deleteExpression(cid,id);unbindImage(s,{kind:'character',id:cid});atomic(s,()=>s.addExpression(cid,overlay()));
});
test('unordered overlay replace null events random seeks and deep immutable evaluated copies',()=>{
 const s=fresh(),p=overlay();p.layers.push({...layer('front'),x:40});const a=s.addExpression(cid,p).id,b=s.addExpression(cid,{name:'replace',resourceId:images[1]}).id;
 for(const [frame,expressionId] of [[30,null],[10,a],[20,b],[40,a]])s.addExpressionEvent(cid,{frame,expressionId});
 let seed=42;for(let i=0;i<200;i++){seed=(seed*1664525+1013904223)>>>0;const f=seed%60,c=s.evaluate(f).characters[0],active=(f>=10&&f<20)||f>=40;
 assert.equal(c.resourceId,f>=20&&f<30?images[1]:images[0]);assert.deepEqual(c.portraitLayers,active?p.layers:undefined);
 if(active){c.portraitLayers[0].x=99;c.expressions[0].layers[0].y=99;c.portraitCanvas.width=1;assert.deepEqual(s.evaluate(f).characters[0].portraitLayers,p.layers)} }
});
test('TS validator agrees for valid and invalid overlays',()=>{
 const ts=fs.readFileSync(path.join(__dirname,'model.ts'),'utf8'),body=ts.slice(ts.indexOf('export function validateProject'),ts.indexOf('export function evaluate')).replace('export function validateProject(p:Project):string[]','function validateProject(p)').replace('const e:string[]','const e').replace("(['width', 'height', 'fps'] as const)","['width', 'height', 'fps']").replaceAll('new Set<string>()','new Set()');
 const context={...require('./audio-envelope.cjs'),...require('./performance-model.cjs'),...require('./video-model.cjs'),...require('./portrait.cjs'),...require('./dialogue-pages.cjs'),...require('./character-definitions.cjs'),...require('./character-rows.cjs')};vm.runInNewContext(body+';this.validate=validateProject;',context);const s=fresh();s.addExpression(cid,overlay());
 for(const mutate of [()=>{},c=>c.expressions[0].layers[0].x=-1,c=>delete c.resourceId,c=>c.portraitLayers=[],c=>c.expressions[0].mode='invalid']){const p=s.snapshot();mutate(p.scene.characters[0]);assert.deepEqual(Array.from(context.validate(p)),validateProject(p))}
});
test('portable save reopen and history retain ordered overlay data',t=>{
 const s=fresh(),id=s.addExpression(cid,overlay()).id;s.addExpressionEvent(cid,{frame:0,expressionId:id});const saved=saveSessionPortable(s,root,path.join(dir(t),'project.json')),reopened=new ProjectSession(openPortable(saved.file).project);
 assert.deepEqual(reopened.evaluate(0).characters[0].portraitLayers,overlay().layers);assert.equal(Object.hasOwn(saved.project.scene.characters[0],'portraitLayers'),false);
 s.project=saved.project;s.history=saved.history;s.future=saved.future;s.undo();assert.equal(s.evaluate(0).characters[0].portraitLayers,undefined);s.redo();assert.deepEqual(s.evaluate(0).characters[0].portraitLayers,overlay().layers);
});
test('independent image import copy, dimensions, undo, native decode failures and copy rollback',t=>{
 const d=dir(t),src=path.join(d,'face.png');fs.writeFileSync(src,png());const s=fresh(),before=s.snapshot(),r=importExpressionImage(s,src,d,{decodeImage:()=>({width:1,height:1})});
 assert.deepEqual(Object.keys(r).sort(),['height','resourceId','revision','width']);assert.equal(r.width,1);assert.deepEqual(s.snapshot().scene,before.scene);
 const res=s.snapshot().resources.find(x=>x.id===r.resourceId),copy=path.join(d,res.path);assert.deepEqual(fs.readFileSync(copy),png());s.undo();assert.deepEqual(s.snapshot(),before);s.redo();
 atomic(s,()=>importExpressionImage(s,src,d,{decodeImage:()=>null}));const files=fs.readdirSync(path.join(d,'assets/imported'));
 assert.throws(()=>importExpressionImage({apply(){throw Error('injected commit failure')}},src,d));assert.deepEqual(fs.readdirSync(path.join(d,'assets/imported')),files);
});
test('new IPC native picker rejects wrong sender, locks edits, ignores renderer path, cancels and returns dimensions',async t=>{
 const handlers={},d=dir(t),src=path.join(d,'face.png');fs.writeFileSync(src,png());let resolveDialog,decoded=0,discardAnswer=0,discardCount=0,closeHandler;
  let windowClosed=false;
 class Window{constructor(){this.webContents={mainFrame:{},send(){},once(){}};Window.instance=this}isDestroyed(){return false}loadFile(){}on(name,fn){if(name==='close')closeHandler=fn}close(){windowClosed=true}}
 const electron={app:{setPath(){},whenReady(){return{then:fn=>fn()}},on(){}},BrowserWindow:Window,ipcMain:{handle:(k,f)=>handlers[k]=f},dialog:{showOpenDialog:()=>new Promise(r=>resolveDialog=r),showMessageBox:async(_,options)=>{discardCount++;assert.match(options.detail,/表单/);return{response:discardAnswer}},showErrorBox:(_,message)=>{throw Error(message)}}, nativeImage:{createFromBuffer(bytes){decoded++;assert.deepEqual(bytes,png());return{isEmpty:()=>false,getSize:()=>({width:1,height:1})}}}};
 let copy;
 vm.runInNewContext(fs.readFileSync(path.join(root,'main.cjs'),'utf8').replace('examples/rain-corridor-v4.json','examples/rain-corridor.json'),{__dirname:root,JSON,process,setTimeout:()=>1,clearTimeout(){},require(n){if(n==='electron')return electron;if(n==='./core/recovery.cjs')return{RecoveryStore:class{inspect(){return null}clear(){}},normalizeDraft:x=>x};if(n==='./core/image-import.cjs')return{...require(path.join(root,n)),importExpressionImage(s,source,projectRoot,options){assert.equal(source,src);copy=importExpressionImage(s,source,d,options);return copy}};return n.startsWith('./core/')?require(path.join(root,n)):require(n)}});
 const event={sender:Window.instance.webContents,senderFrame:Window.instance.webContents.mainFrame};
  const notify=handlers['update-expression-draft-status'];
  assert.throws(()=>notify({sender:{}},{dirty:true,documentId:0}));
  assert.throws(()=>notify(event,{dirty:'true',documentId:0}),/无效/);
  assert.throws(()=>notify(event,{dirty:true,documentId:99}),/旧工程/);
  notify(event,{dirty:true,documentId:0});assert.equal(handlers.project().dirty,true);assert.equal(handlers.project().expressionDraftDirty,true);
  assert.equal((await handlers['open-project']()).cancelled,true);assert.equal(discardCount,1);assert.equal(handlers.project().expressionDraftDirty,true);
  let prevented=false;closeHandler({preventDefault(){prevented=true}});await new Promise(resolve=>setImmediate(resolve));assert.equal(prevented,true);assert.equal(windowClosed,false);assert.equal(discardCount,2);
  notify(event,{dirty:false,documentId:0});assert.equal(handlers.project().dirty,false);
  const pageNotify=handlers['update-dialogue-page-draft-status'];assert.throws(()=>pageNotify({sender:{}},{dirty:true,documentId:0}));assert.throws(()=>pageNotify(event,{dirty:true,documentId:9}),/旧工程/);assert.throws(()=>pageNotify(event,{dirty:'yes',documentId:0}),/无效/);
  pageNotify(event,{dirty:true,documentId:0});assert.equal(handlers.project().dirty,true);assert.equal((await handlers['open-project']()).cancelled,true);assert.equal(handlers.project().dialoguePageDraftDirty,true);pageNotify(event,{dirty:false,documentId:0});assert.equal(handlers.project().dirty,false);
  const dirtyDuringDialog=handlers['import-expression-image'](event);notify(event,{dirty:true,documentId:0});resolveDialog({canceled:false,filePaths:[src]});await assert.rejects(dirtyDuringDialog,/工程已改变/);assert.equal(decoded,0);notify(event,{dirty:false,documentId:0});
  await assert.rejects(handlers['import-expression-image']({sender:{}}));
 const before=handlers.project().project,work=handlers['import-expression-image'](event,'untrusted.png');assert.throws(()=>handlers['add-character'](event));resolveDialog({canceled:false,filePaths:[src]});const result=await work;assert.equal(result.width,1);assert.equal(decoded,1);assert.deepEqual(handlers.project().project.scene,before.scene);assert.equal(result.resourceId,copy.resourceId);
 const cancel=handlers['import-expression-image'](event);resolveDialog({canceled:true});assert.equal((await cancel).cancelled,true);assert.equal(handlers.project().revision,1);
 const stale=handlers['import-expression-image'](event);handlers['update-code-draft'](event,{dirty:false});resolveDialog({canceled:false,filePaths:[src]});await assert.rejects(stale,/工程已改变/);assert.equal(handlers.project().revision,1);assert.equal(decoded,1);
});
