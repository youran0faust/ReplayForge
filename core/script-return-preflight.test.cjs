'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {scanAssets}=require('./script-asset-catalog.cjs');
const {preflight}=require('./script-preflight.cjs');
const {buildScriptProject}=require('./script-project-builder.cjs');
const {createSourceRecord}=require('./script-source-record.cjs');
const {exportReturnPackage,readReturnMap}=require('./script-return-package.cjs');
const {createScriptPreflightSession}=require('./script-preflight-session.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
function wav(){const b=Buffer.alloc(44+96000);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(96000,40);return b;}
async function fixture(t,{loss=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'p2-return-preflight-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const projectRoot=path.join(root,'original'),outputParent=path.join(root,'output'),assetsRoot=path.join(root,'input');for(const dir of [projectRoot,outputParent,path.join(assetsRoot,'配音')])fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(projectRoot,'assets'));
 const bytes=wav(),relativePath='配音/A_001_你好.wav';fs.writeFileSync(path.join(assetsRoot,relativePath),bytes);fs.writeFileSync(path.join(projectRoot,'assets/voice.wav'),bytes);
 const text='甲：你好',config={version:1,characters:[{name:'甲',voiceCode:'A'}]},catalog=scanAssets(assetsRoot),report=preflight({text,config,catalog});assert.equal(report.ok,true);const resourceId=catalog.assets[0].id;
 const built=buildScriptProject({config,report,schemaVersion:4,media:[{id:resourceId,kind:'audio',path:'assets/voice.wav',sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:48000}],paginationPlan:[{nodeId:'line-1',pages:[{start:0,end:2,text:'你好'}]}]});assert(built.project,JSON.stringify(built.diagnostics));
 built.project.scriptSource=createSourceRecord({text,config,report,...built,mediaMappings:[{resourceId,category:'voice',relativePath,hash:sha(bytes)}]});
 if(loss)built.project.title='不能由文本保留的新工程标题';
 const output=await exportReturnPackage({project:built.project,projectRoot,outputParent});
 const paths={script:output.textFile,assets:path.join(output.root,'素材'),config:path.join(output.root,'config.json'),returnMap:output.mapFile};
 const contents={mainFrame:{},isDestroyed:()=>false},session=Object.freeze({project:Object.freeze({sentinel:true}),dirty:false}),ctx={session,documentId:7,revision:3,win:{webContents:contents,isDestroyed:()=>false},busy:false},event={sender:contents,senderFrame:contents.mainFrame};
 const api=createScriptPreflightSession({getContext:()=>ctx,pick:kind=>paths[kind]});
 const payload=extra=>({documentId:ctx.documentId,expectedRevision:ctx.revision,...extra}),get=()=>api.getState(event,payload()),choose=kind=>api.choose(event,payload({kind}));
 const run=async()=>api.run(event,payload({token:(await get()).token})),ready=async()=>{for(const kind of ['script','assets','config','returnMap'])assert.equal((await choose(kind)).ok,true);return run();};
 return {root,projectRoot,paths,output,bytes,resourceId,relativePath,api,ctx,event,payload,get,choose,run,ready,session};
}
const error=(result,code)=>{assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,code);};
const rewrite=(file,mutate)=>{const value=JSON.parse(fs.readFileSync(file,'utf8'));mutate(value);fs.writeFileSync(file,JSON.stringify(value,null,2));};
test('real isolated return package selects all four inputs and keeps exact identities and bindings',async t=>{
 const f=await fixture(t),before=fs.readFileSync(path.join(f.projectRoot,'assets/voice.wav')),r=await f.ready(),map=readReturnMap(f.paths.returnMap);
 assert.equal(r.ok,true);assert.equal(r.report.ok,true,JSON.stringify(r.report.diagnostics));assert.equal(r.selection.returnMap,'script.replay-map.json');assert.equal(r.report.identities[0].stableId,map.source.nodes[0].stableId);assert.equal(r.report.bindings[0].resourceId,f.resourceId);assert(r.report.diagnostics.some(d=>d.code==='REIMPORT_PRESERVED'&&d.severity==='info'));assert.equal(f.ctx.session,f.session);assert.equal(f.ctx.revision,3);assert.deepEqual(fs.readFileSync(path.join(f.projectRoot,'assets/voice.wav')),before);
});
for(const [label,mutate] of [['voiceCode',c=>c.characters[0].voiceCode='B'],['character image',c=>c.characters[0].image='changed.png'],['layout',c=>c.defaultLayout='三人'],['character rename',c=>c.characters[0].name='乙']])test('non-reading config mismatch rejected: '+label,async t=>{const f=await fixture(t);rewrite(f.paths.config,mutate);error(await f.ready(),'RETURN_CONFIG_MISMATCH');assert.equal((await f.get()).report,null);});
test('reading-only config change cannot overwrite retained actual frames',async t=>{
 const f=await fixture(t);rewrite(f.paths.config,c=>{c.dialoguePageMaxCharacters=1;c.dialoguePageHoldSeconds=.9;c.unvoicedDurationSeconds=2;c.unvoicedTimingMode='auto';});const r=await f.ready();assert.equal(r.ok,true);assert.equal(r.report.ok,true,JSON.stringify(r.report.diagnostics));assert.equal(r.report.summary.dialoguePageMaxCharacters,1);assert.equal(r.report.summary.dialoguePageHoldSeconds,.9);assert(r.report.diagnostics.some(d=>d.code==='REIMPORT_PRESERVED'&&d.severity==='info'));
});
test('declared package losses reach visible preflight diagnostics',async t=>{const f=await fixture(t,{loss:true}),map=readReturnMap(f.paths.returnMap);assert(map.losses.length);const r=await f.ready();assert.equal(r.ok,true);assert.equal(r.report.ok,true);for(const loss of map.losses)assert(r.report.diagnostics.some(d=>d.code==='REIMPORT_DECLARED_LOSS'&&d.severity==='warning'&&d.message.includes(loss.path)));});
test('same-size audio hash tampering rejects selected return package',async t=>{const f=await fixture(t),file=path.join(f.paths.assets,f.relativePath),bytes=fs.readFileSync(file);bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);error(await f.ready(),'DISK_CHANGED');assert.equal((await f.get()).report,null);});
for(const [label,mutate] of [['top-level',m=>m.execute='not allowed'],['source',m=>m.source.extra=true],['binding',m=>m.source.bindings[0].extra=true]])test('unknown sidecar fields rejected: '+label,async t=>{const f=await fixture(t);rewrite(f.paths.returnMap,mutate);error(await f.ready(),'RETURN_MAP_INVALID');assert.equal((await f.get()).report,null);});
test('return map version tampering rejected',async t=>{const f=await fixture(t);rewrite(f.paths.returnMap,m=>m.version=999);error(await f.ready(),'RETURN_MAP_INVALID');});
test('sender and subframe cannot read or rerun return session',async t=>{const f=await fixture(t),r=await f.ready();for(const event of [{...f.event,sender:{}},{...f.event,senderFrame:{}}]){error(await f.api.getState(event,f.payload()),'INVALID_SENDER');error(await f.api.run(event,f.payload({token:r.token})),'INVALID_SENDER');error(await f.api.choose(event,f.payload({kind:'returnMap'})),'INVALID_SENDER');}});
test('stale revision and document rejected for return preflight',async t=>{const f=await fixture(t),r=await f.ready();error(await f.api.run(f.event,f.payload({token:r.token,expectedRevision:2})),'STALE_CONTEXT');error(await f.api.run(f.event,f.payload({token:r.token,documentId:8})),'STALE_CONTEXT');});
test('rotated token cannot replay return preflight or correction',async t=>{const f=await fixture(t),r=await f.ready(),next=await f.run();assert.notEqual(next.token,r.token);error(await f.api.run(f.event,f.payload({token:r.token})),'STALE_TOKEN');error(await f.api.correct(f.event,f.payload({token:r.token,nodeId:'line-1',action:'unvoiced'})),'STALE_TOKEN');});
test('sidecar mutation after report is rejected before correction commit',async t=>{const f=await fixture(t),r=await f.ready();rewrite(f.paths.returnMap,m=>m.losses.push({code:'DECLARED_CHANGE',path:'/scene',message:'new warning'}));error(await f.api.correct(f.event,f.payload({token:r.token,nodeId:'line-1',action:'unvoiced'})),'DISK_CHANGED');assert.equal((await f.get()).report.bindings[0].status,'matched');});
test('renderer cannot inject sidecar path or source object in run payload',async t=>{const f=await fixture(t),r=await f.ready();for(const extra of [{returnMap:f.paths.returnMap},{reimportSource:{}},{config:{}}])error(await f.api.run(f.event,f.payload({token:r.token,...extra})),'INVALID_PAYLOAD');});
