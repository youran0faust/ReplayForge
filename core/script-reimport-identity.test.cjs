'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcileNodes}=require('./script-reimport-identity.cjs');
const {preflight,textHash}=require('./script-preflight.cjs');
const {parseScript}=require('./script-parser.cjs');
const {buildScriptProject}=require('./script-project-builder.cjs');
const {createSourceRecord,validateSourceRecord}=require('./script-source-record.cjs');
function fixture(text='甲：你好',extra=[]){
 const config={version:1,characters:[{name:'甲',voiceCode:'A'}]},parsed=parseScript(text,config),dialogues=parsed.nodes.filter(n=>n.type==='dialogue');
 const assets=[...dialogues.map((n,i)=>({id:'v'+(i+1),kind:'audio',category:'voice',relativePath:`voice/A_${String(i+1).padStart(3,'0')}_${n.text}.wav`})),...extra.map((text,i)=>({id:'extra'+i,kind:'audio',category:'voice',relativePath:`voice/A_${String(dialogues.length+i+1).padStart(3,'0')}_${text}.wav`}))];
 const catalog={assets,diagnostics:[]},report=preflight({text,config,catalog});assert.equal(report.ok,true,JSON.stringify(report.diagnostics));
 const built=buildScriptProject({config,report,schemaVersion:4,media:assets.map(a=>({id:a.id,kind:'audio',path:'assets/'+a.id+'.wav',sampleRate:48000,channels:1,bitsPerSample:16,durationSamples:48000})),paginationPlan:dialogues.map(n=>({nodeId:n.id,pages:[{start:0,end:n.text.length,text:n.text}]}))});assert(built.project,JSON.stringify(built.diagnostics));
 const source=createSourceRecord({text,config,report,project:built.project,sourceMap:built.sourceMap,mediaMappings:built.project.resources.map(r=>({resourceId:r.id,category:'voice',relativePath:assets.find(a=>a.id===r.id).relativePath,hash:'a'.repeat(64)}))});assert.deepEqual(validateSourceRecord(source),[]);
 return {source,config,catalog};
}
function run(f,text,overrides){return preflight({text,config:f.config,catalog:f.catalog,reimportSource:f.source,...(overrides?{corrections:{version:1,sourceHash:textHash(text),overrides}}:{})});}
const dialogues=r=>r.nodes.filter(n=>n.type==='dialogue');
function assertReview(r){assert.equal(r.ok,false);assert(r.bindings.some(b=>b.status==='reviewRequired'));assert(!r.bindings.some(b=>b.status==='matched'&&b.resourceId?.startsWith('extra')));}
test('exact source including duplicate dialogue reuses every stable identity and binding',()=>{
 const f=fixture('## 场景\n甲：一样\n甲：一样'),before=structuredClone(f.source),identity=reconcileNodes(f.source.text,f.source),r=run(f,f.source.text);
 assert.deepEqual(identity.identities,f.source.nodes.map(({nodeId,stableId})=>({nodeId,stableId})));assert.deepEqual(identity.previousBindings,f.source.bindings);assert.deepEqual(r.bindings,f.source.bindings);assert.equal(r.ok,true);assert.deepEqual(f.source,before);
});
test('inserting comment retains unique dialogue identity and resource despite shifted parser IDs',()=>{
 const f=fixture('甲：你好\n甲：再见'),r=run(f,'// 插入\n甲：你好\n甲：再见');assert.equal(r.ok,true);
 assert.deepEqual(r.bindings.map(b=>b.resourceId),['v1','v2']);assert.deepEqual(r.bindings.map(b=>b.nodeId),['line-2','line-3']);
 for(let i=0;i<2;i++)assert.equal(r.identities.find(x=>x.nodeId==='line-'+(i+2)).stableId,f.source.nodes[i].stableId);
 assert(!f.source.nodes.some(n=>n.stableId===r.identities[0].stableId));
});
test('single changed utterance preserves old resource and old text baseline but blocks preflight',()=>{
 const f=fixture(),r=run(f,'甲：改词');assertReview(r);assert.equal(r.bindings[0].resourceId,'v1');assert.equal(r.bindings[0].textBaseline,'你好');assert.equal(r.identities[0].stableId,f.source.nodes[0].stableId);
});
test('one changed dialogue between established anchors retains evidence without changing voice',()=>{
 const f=fixture('## 开始\n甲：你好\n## 结束'),r=run(f,'## 开始\n甲：改词\n## 结束');assertReview(r);assert.equal(r.bindings[0].resourceId,'v1');assert.equal(r.identities[1].stableId,f.source.nodes[1].stableId);
});
test('changed text with duplicate sentences does not guess positional identity or numeric voice',()=>{
 const f=fixture('甲：一样\n甲：一样'),r=run(f,'// shifted\n甲：一样\n甲：一样');assertReview(r);assert(r.bindings.every(b=>b.status==='reviewRequired'&&!Object.hasOwn(b,'resourceId')));
 const oldIds=new Set(f.source.nodes.map(n=>n.stableId));assert(r.identities.every(n=>!oldIds.has(n.stableId)));
});
for(const [name,oldText,newText] of [['split','甲：一二','甲：一\n甲：二'],['merge','甲：一\n甲：二','甲：一二']])test(name+' cannot silently reuse old identity or numeric queue',()=>{
 const f=fixture(oldText),r=run(f,newText);assertReview(r);assert(r.bindings.every(b=>b.status==='reviewRequired'&&!b.resourceId));const oldIds=new Set(f.source.nodes.map(n=>n.stableId));assert(r.identities.every(n=>!oldIds.has(n.stableId)));
});
test('new line matching next numeric filename remains reviewRequired while old line stays bound',()=>{
 const f=fixture('甲：你好',['新增']),r=run(f,'甲：你好\n甲：新增');assertReview(r);assert.equal(r.bindings[0].resourceId,'v1');assert.equal(r.bindings[1].status,'reviewRequired');assert.equal(r.bindings[1].resourceId,undefined);
 assert.equal(r.identities[0].stableId,f.source.nodes[0].stableId);assert.notEqual(r.identities[1].stableId,f.source.nodes[0].stableId);
});
test('inserting a new leading line cannot steal reserved old numeric resource',()=>{
 const f=fixture('甲：你好'),r=run(f,'甲：新增\n甲：你好');assertReview(r);assert.equal(r.bindings[0].resourceId,undefined);assert.equal(r.bindings[1].resourceId,'v1');assert.equal(r.identities[1].stableId,f.source.nodes[0].stableId);
});
for(const kind of ['manual','unvoiced'])test('explicit '+kind+' correction clears changed-word review and updates textBaseline',()=>{
 const f=fixture(),text='甲：改词',r=run(f,text,{'line-1':kind==='manual'?{resourceId:'v1'}:{status:'unvoiced'}});assert.equal(r.ok,true,JSON.stringify(r.diagnostics));assert.equal(r.bindings[0].status,kind);assert.equal(r.bindings[0].textBaseline,'改词');assert.equal(r.bindings[0].resourceId,kind==='manual'?'v1':undefined);assert.equal(r.identities[0].stableId,f.source.nodes[0].stableId);
});
for(const kind of ['manual','unvoiced'])test('explicit '+kind+' correction clears new-identity review',()=>{
 const f=fixture('甲：你好',['新增']),r=run(f,'甲：你好\n甲：新增',{'line-2':kind==='manual'?{resourceId:'extra0'}:{status:'unvoiced'}});assert.equal(r.ok,true,JSON.stringify(r.diagnostics));assert.equal(r.bindings[1].status,kind);assert.equal(r.bindings[0].resourceId,'v1');
});
test('duplicate dialogue ambiguity can only be cleared by explicit per-node corrections',()=>{
 const f=fixture('甲：一样\n甲：一样'),r=run(f,'// shifted\n甲：一样\n甲：一样',{'line-2':{resourceId:'v1'},'line-3':{resourceId:'v2'}});assert.equal(r.ok,true);assert.deepEqual(r.bindings.map(b=>b.status),['manual','manual']);
});
test('stale correction cannot clear review or overwrite old binding',()=>{
 const f=fixture(),r=preflight({text:'甲：改词',config:f.config,catalog:f.catalog,reimportSource:f.source,corrections:{version:1,sourceHash:textHash(f.source.text),overrides:{'line-1':{status:'unvoiced'}}}});assertReview(r);assert.equal(r.bindings[0].resourceId,'v1');assert(r.diagnostics.some(d=>d.code==='CORRECTIONS_STALE'));
});
test('forged reimport source rejected before identities enter matcher',()=>{const f=fixture();f.source.nodes[0].stableId='not-a-uuid';assert.throws(()=>run(f,f.source.text),/来源记录无效/);});
function unvoicedFixture(){
 const text='甲：你好',config={version:1,characters:[{name:'甲'}]},catalog={assets:[],diagnostics:[]};
 const report=preflight({text,config,catalog,corrections:{version:1,sourceHash:textHash(text),overrides:{'line-1':{status:'unvoiced'}}}});assert.equal(report.ok,true);
 const built=buildScriptProject({config,report,media:[],schemaVersion:4,paginationPlan:[{nodeId:'line-1',pages:[{start:0,end:2,text:'你好'}]}]});assert(built.project);
 return {config,catalog,source:createSourceRecord({text,config,report,...built,mediaMappings:[]})};
}
test('existing unvoiced binding needs no voiceCode on exact reimport',()=>{const f=unvoicedFixture(),r=run(f,f.source.text);assert.equal(r.ok,true,JSON.stringify(r.diagnostics));assert.equal(r.bindings[0].status,'unvoiced');});
test('changed unvoiced text without voiceCode requests review instead of losing evidence',()=>{const f=unvoicedFixture(),r=run(f,'甲：改词');assertReview(r);assert.equal(r.bindings[0].textBaseline,'你好');});
test('new unvoiced-source identity without voiceCode still requests review and explicit unvoiced clears it',()=>{const f=unvoicedFixture(),text='甲：你好\n甲：新增',r=run(f,text);assertReview(r);assert.equal(r.bindings[0].status,'unvoiced');assert.equal(r.bindings[1].status,'reviewRequired');assert(!r.diagnostics.some(d=>d.code==='VOICE_CHARACTER_CODE_MISSING'));const corrected=run(f,text,{'line-2':{status:'unvoiced'}});assert.equal(corrected.ok,true);assert(corrected.bindings.every(b=>b.status==='unvoiced'));});
test('changed unvoiced without voiceCode explicit confirmation clears review',()=>{const f=unvoicedFixture(),r=run(f,'甲：改词',{'line-1':{status:'unvoiced'}});assert.equal(r.ok,true);assert.equal(r.bindings[0].textBaseline,'改词');});
