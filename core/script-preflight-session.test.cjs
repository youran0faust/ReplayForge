'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createScriptPreflightSession} = require('./script-preflight-session.cjs');
const core = require('./script-preflight.cjs');
test('global reading snapshot merged before report, invalidation and generation reject changed preferences',async t=>{const {createReadingSettingsStore,DEFAULTS}=require('./reading-settings.cjs'),store=createReadingSettingsStore();let generated=0,picked=0;const f=fixture(t,{previewPortable:trustedPreview,getReadingSettings:store.snapshot,pickOutput:()=>{picked++;return f.root},generatePortable:()=>{generated++;}});await f.ready();let report=await previewFor(f);assert.equal(report.ok,true);assert.equal(report.report.summary.dialoguePageHoldSeconds,.8);assert.equal(report.report.summary.readingConfigSource,'global');const old=report.token;store.update({revision:0,settings:{...DEFAULTS,dialoguePageMaxCharacters:1}});const failed=await f.api.generate(f.event,f.payload({token:old,paginationPlan:planFor(report.report)}));assert.equal(failed.ok,false);assert.equal(failed.error.code,'DISK_CHANGED');assert.equal(picked,0);assert.equal(generated,0);f.api.invalidateReadingSettings();assert.equal((await f.get()).report,null);assert.notEqual((await f.get()).token,old);assert.equal((await f.api.run(f.event,f.payload({token:old}))).error.code,'STALE_TOKEN');report=await f.run();assert.equal(report.report.summary.dialoguePageMaxCharacters,1);store.update({revision:1,settings:{...DEFAULTS,source:'config'}});f.api.invalidateReadingSettings();report=await f.run();assert.equal(report.report.summary.readingConfigSource,'config');assert.equal(report.report.summary.dialoguePageHoldSeconds,.6);});
const trustedPreview = async ({check}) => {await check(); return {summary:{fps:30,durationFrames:90,totalSeconds:3},fingerprint:'trusted-test-fingerprint'};};
const previewFor = async (f, paginationPlan) => {const s=await f.get(); return f.api.preview(f.event,f.payload({token:s.token,paginationPlan:paginationPlan??planFor(s.report)}));};
const invalidated = (current,before) => {assert.notEqual(current.token,before.token);assert.deepEqual(current,{...before,token:current.token,generationPreview:null});};
const planFor = report => ({version:1,sourceHash:report.sourceHash,layout:{id:'default-960x540-v1',width:822,maxLines:3},dialogues:report.nodes.filter(n=>n.type==='dialogue').map(n=>({nodeId:n.id,pages:[{start:0,end:n.text.length,text:n.text}]}))});
function fixture(t, injections = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-preflight-'));
 t.after(() => fs.rmSync(root, {recursive: true, force: true}));
 const paths = {script: path.join(root, 'script.txt'), config: path.join(root, 'config.json'), assets: path.join(root, 'assets')};
 fs.mkdirSync(path.join(paths.assets, '配音'), {recursive: true});
 fs.writeFileSync(paths.script, '小窗：你好');
 fs.writeFileSync(paths.config, JSON.stringify({version: 1, characters: [{name: '小窗', voiceCode: 'CHA'}]}));
 const voice = path.join(paths.assets, '配音', 'CHA_001_你好.wav'); fs.writeFileSync(voice, 'fake audio');
 const contents = {mainFrame: {}, isDestroyed: () => false};
 const ctx = {session: {}, documentId: 0, revision: 0, win: {webContents: contents, isDestroyed: () => false}, busy: false};
 const event = {sender: contents, senderFrame: contents.mainFrame};
 let pick = kind => paths[kind];
 const api = createScriptPreflightSession({getContext: () => ctx, pick: kind => pick(kind), ...injections});
 const payload = extra => ({documentId: ctx.documentId, expectedRevision: ctx.revision, ...extra});
 const get = () => api.getState(event, payload());
 const choose = kind => api.choose(event, payload({kind}));
 const run = async () => api.run(event, payload({token: (await get()).token}));
 const correct = async (action = 'unvoiced', extra = {}) => api.correct(event, payload({token: (await get()).token, nodeId: 'line-1', action, ...extra}));
 const ready = async () => { for (const k of Object.keys(paths)) assert.equal((await choose(k)).ok, true); return run(); };
 return {api, paths, root, voice, ctx, event, payload, get, choose, run, correct, ready, setPick: fn => {pick = fn;}};
}
const error = (r, code) => {assert.equal(r.ok, false); assert.equal(r.error.code, code);};
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
function generationFixture(t) {
 let outputCalls = 0, generateCalls = 0, captured;
 let pickOutput = () => f.root;
 let generator = async options => {await options.check(); return {file: path.join(f.root, 'generated', 'project.json'), root: path.join(f.root, 'generated'), mediaSummary: {copied: 1}};};
 const f = fixture(t, {previewPortable:trustedPreview,pickOutput: (...args) => {outputCalls++; assert.deepEqual(args, []); return pickOutput();}, generatePortable: async options => {generateCalls++; captured = options; return generator(options);}});
 const generate = async extra => {const state=await f.get(); return f.api.generate(f.event, f.payload({token:state.token,paginationPlan:state.report?planFor(state.report):undefined,...extra}));};
 const ready = async()=>{const r=await f.ready();if(r.report.ok){const p=await previewFor(f);if(p.ok)return p;}return r;};
 const correct = async(...args)=>{const r=await f.correct(...args);return r.ok?previewFor(f):r;};
 return {...f, ready, correct, preview: p=>previewFor(f,p), generate, counts: () => ({outputCalls, generateCalls}), captured: () => captured,
  setOutput: fn => {pickOutput = fn;}, setGenerator: fn => {generator = fn;}};
}

test('plan required and malformed plan rejected before output picker',async t=>{const f=generationFixture(t),state=await f.ready();error(await f.generate({paginationPlan:undefined}),'PAGINATION_REQUIRED');for(const mutate of [p=>p.sourceHash='0'.repeat(64),p=>p.dialogues.push(p.dialogues[0]),p=>p.path=f.root,p=>p.dialogues[0].pages[0].text='伪造']){const p=planFor(state.report);mutate(p);error(await f.generate({paginationPlan:p}),'PAGINATION_INVALID');}assert.deepEqual(f.counts(),{outputCalls:0,generateCalls:0});});
test('generation cap comes from trusted config not renderer report or payload',async t=>{const f=generationFixture(t);const config=JSON.parse(fs.readFileSync(f.paths.config));config.dialoguePageMaxCharacters=1;config.dialoguePageHoldSeconds=0.4;fs.writeFileSync(f.paths.config,JSON.stringify(config));const state=await f.ready();assert.equal(state.report.summary.dialoguePageMaxCharacters,1);assert.equal(state.report.summary.dialoguePageHoldSeconds,0.4);state.report.summary.dialoguePageMaxCharacters=1000;error(await f.generate({paginationPlan:planFor(state.report)}),'PAGINATION_INVALID');assert.deepEqual(f.counts(),{outputCalls:0,generateCalls:0});error(await f.generate({config:{dialoguePageMaxCharacters:1000}}),'INVALID_PAYLOAD');const plan=planFor(state.report);plan.dialogues[0].pages=[{start:0,end:1,text:'你'},{start:1,end:2,text:'好'}];assert.equal((await f.preview(plan)).ok,true);assert.equal((await f.generate({paginationPlan:plan})).ok,true);assert.equal(f.captured().snapshot.config.dialoguePageMaxCharacters,1);assert.equal(f.captured().snapshot.config.dialoguePageHoldSeconds,0.4);});
test('valid plan forwarded detached and completed token cannot be replayed',async t=>{const f=generationFixture(t),state=await f.ready(),p=planFor(state.report);assert.equal((await f.generate({paginationPlan:p})).ok,true);assert.deepEqual(f.captured().paginationPlan,p);assert.notEqual(f.captured().paginationPlan,p);error(await f.generate({token:state.token,paginationPlan:p}),'STALE_TOKEN');assert.equal(f.counts().generateCalls,1);});
test('generate cancellation retains token, report and corrections', async t => {
 const f = generationFixture(t); await f.ready(); const before = await f.correct();
 for (const result of [null, {canceled: true, filePaths: []}]) {f.setOutput(() => result); assert.deepEqual(await f.generate(), {...before, cancelled: true}); assert.deepEqual(await f.get(), before);}
 assert.equal(f.counts().generateCalls, 0);
});
test('generate refuses unavailable dependencies', async t => {const f = fixture(t), r = await f.ready(); error(await f.api.generate(f.event, f.payload({token: r.token})), 'GENERATION_UNAVAILABLE');});
test('generate requires successful existing report before picker', async t => {
 const f = generationFixture(t); error(await f.generate(), 'REPORT_REQUIRED');
 fs.writeFileSync(f.paths.script, '小窗：没有匹配'); const bad = await f.ready(); assert.equal(bad.report.ok, false);
 error(await f.generate(), 'PREFLIGHT_ERRORS'); assert.deepEqual(f.counts(), {outputCalls: 0, generateCalls: 0});
});
test('generate exact payload rejects renderer output paths and missing token', async t => {
 const f = generationFixture(t); await f.ready();
 error(await f.generate({outputParent: f.root}), 'INVALID_PAYLOAD'); error(await f.api.generate(f.event, f.payload()), 'INVALID_PAYLOAD');
 assert.equal(f.counts().outputCalls, 0);
});
test('generate validates sender frame and busy guard', async t => {
 const f = generationFixture(t), before = await f.ready();
 error(await f.api.generate({...f.event, senderFrame: {}}, f.payload({token: before.token})), 'INVALID_SENDER');
 f.ctx.busy = true; error(await f.api.generate(f.event, f.payload({token: before.token})), 'BUSY'); assert.equal(f.counts().outputCalls, 0);
});
test('generate rejects stale token and stale document revision', async t => {
 const f = generationFixture(t), before = await f.ready(); await f.run(); error(await f.generate({token: before.token}), 'STALE_TOKEN');
 error(await f.generate({documentId: 9}), 'STALE_CONTEXT'); error(await f.generate({expectedRevision: 9}), 'STALE_CONTEXT');
 assert.equal(f.counts().outputCalls, 0);
});
for (const change of ['document', 'revision', 'busy']) test('generate output chooser '+change+' race rejects before generator', async t => {
 const f = generationFixture(t); await f.ready(); const entered = deferred(), resume = deferred();
 f.setOutput(() => {entered.resolve(); return resume.promise;}); const generating = f.generate(); await entered.promise;
 if (change === 'document') f.ctx.documentId++; else if (change === 'revision') f.ctx.revision++; else f.ctx.busy = true;
 resume.resolve(f.root); error(await generating, change === 'busy' ? 'BUSY' : 'STALE_CONTEXT'); assert.equal(f.counts().generateCalls, 0);
});
test('generate pending chooser blocks parallel operations', async t => {
 const f = generationFixture(t), before = await f.ready(), entered = deferred(), resume = deferred();
 f.setOutput(() => {entered.resolve(); return resume.promise;}); const generating = f.generate(); await entered.promise;
 error(await f.api.generate(f.event, f.payload({token: before.token})), 'BUSY'); error(await f.choose('script'), 'BUSY');
 resume.resolve(null); assert.equal((await generating).cancelled, true); assert.deepEqual(await f.get(), before);
});
for (const when of ['before-picker', 'inside-picker']) test('generate detects disk changes '+when, async t => {
 const f = generationFixture(t), before = await f.ready();
 if (when === 'before-picker') fs.appendFileSync(f.paths.config, '\n');
 else f.setOutput(() => {fs.writeFileSync(f.paths.script, '小窗：变化'); return f.root;});
 error(await f.generate(), 'DISK_CHANGED'); assert.equal(f.counts().generateCalls, 0); invalidated(await f.get(), before);
 if (when === 'before-picker') assert.equal(f.counts().outputCalls, 0);
});
test('generate rejects nonabsolute picker paths', async t => {const f = generationFixture(t); await f.ready(); f.setOutput(() => 'relative'); error(await f.generate(), 'INVALID_PAYLOAD'); assert.equal(f.counts().generateCalls, 0);});
test('generate returns output paths, rotates token, leaves current project unchanged', async t => {
 const f = generationFixture(t); const session = Object.freeze({dirty: false, project: Object.freeze({name: 'current'})}); f.ctx.session = session;
 const before = await f.ready(), script = fs.readFileSync(f.paths.script); f.setOutput(() => ({canceled: false, filePaths: [f.root]}));
 const r = await f.generate(); assert.equal(r.ok, true); assert.notEqual(r.token, before.token); assert.deepEqual(r.report, before.report);
 assert.deepEqual(r.generated, {file: path.join(f.root, 'generated', 'project.json'), root: path.join(f.root, 'generated'), mediaSummary: {copied: 1}});
 assert.equal(f.ctx.session, session); assert.equal(session.dirty, false); assert.equal(f.ctx.revision, 0); assert.deepEqual(fs.readFileSync(f.paths.script), script);
 assert.equal(f.captured().assetsRoot, f.paths.assets); assert.equal(f.captured().outputParent, f.root); assert.equal(f.captured().snapshot.text, '小窗：你好');
});
test('generator receives detached snapshot and report', async t => {
 const f = generationFixture(t), before = await f.ready(); f.setGenerator(async options => {await options.check(); options.report.nodes.length = 0; options.snapshot.config.characters.length = 0; return {file: 'generated.json', root: 'generated'};});
 assert.equal((await f.generate()).ok, true); assert.deepEqual((await f.get()).report, before.report); assert.equal((await f.run()).report.ok, true);
});
for (const change of ['document', 'revision', 'disk', 'busy']) test('generator check callback detects '+change+' race', async t => {
 const f = generationFixture(t), before = await f.ready(); let committed = false;
 f.setGenerator(async ({check}) => {await check(); if (change === 'document') f.ctx.documentId++; else if (change === 'revision') f.ctx.revision++; else if (change === 'busy') f.ctx.busy = true; else fs.appendFileSync(f.paths.config, '\n'); await check(); committed = true; return {};});
 error(await f.generate(), change === 'disk' ? 'DISK_CHANGED' : change === 'busy' ? 'BUSY' : 'STALE_CONTEXT'); assert.equal(committed, false);
 if (change === 'disk') invalidated(await f.get(), before);
});
test('generate checks context after generator returns even after its final callback', async t => {
 const f = generationFixture(t); await f.ready(); f.setGenerator(async ({check}) => {await check(); f.ctx.documentId++; return {file: 'old.json', root: 'old'};});
 error(await f.generate(), 'STALE_CONTEXT'); assert.equal((await f.get()).report, null);
});
test('generator exception preserves report and releases pending without leaking paths', async t => {
 const f = generationFixture(t), before = await f.ready(); f.setGenerator(() => {throw new Error(f.paths.script);});
 const r = await f.generate(); error(r, 'IO_FAILED'); assert.ok(!JSON.stringify(r).includes(f.root)); assert.deepEqual(await f.get(), before);
});
test('session generation has no legacy dependency bypass',async t=>{
 const f=fixture(t,{generatePortable:()=>assert.fail('must not generate'),pickOutput:()=>assert.fail('must not pick')});
 const s=await f.ready();error(await f.api.generate(f.event,f.payload({token:s.token,paginationPlan:planFor(s.report)})),'PREVIEW_REQUIRED');
 error(await previewFor(f),'GENERATION_UNAVAILABLE');assert.equal((await f.get()).generationPreview,null);assert.equal(Object.isFrozen(f.api),true);
});
test('preview publishes detached summary only and binds trusted fingerprint',async t=>{
 const f=generationFixture(t),s=await f.ready();assert.deepEqual(s.generationPreview,{fps:30,durationFrames:90,totalSeconds:3});
 assert.ok(!JSON.stringify(s).includes('trusted-test-fingerprint'));s.generationPreview.fps=999;
 assert.equal((await f.get()).generationPreview.fps,30);assert.equal((await f.generate()).ok,true);assert.equal(f.captured().expectedPreviewFingerprint,'trusted-test-fingerprint');
});
test('preview rotates token and old preview callback payload cannot generate',async t=>{
 const f=generationFixture(t),s=await f.ready(),next=await f.preview();assert.notEqual(s.token,next.token);
 error(await f.generate({token:s.token}),'STALE_TOKEN');assert.deepEqual(f.counts(),{outputCalls:0,generateCalls:0});
});
test('different valid pagination requires a new preview and refreshes state',async t=>{
 const f=generationFixture(t),s=await f.ready(),p=planFor(s.report);p.dialogues[0].pages=[{start:0,end:1,text:'你'},{start:1,end:2,text:'好'}];
 const r=await f.generate({paginationPlan:p});error(r,'PREVIEW_CHANGED');invalidated(r.state,s);assert.deepEqual(await f.get(),r.state);
 error(await f.generate(),'PREVIEW_REQUIRED');assert.deepEqual(f.counts(),{outputCalls:0,generateCalls:0});assert.equal((await f.preview(p)).ok,true);assert.equal((await f.generate({paginationPlan:p})).ok,true);
});
test('storage fingerprint mismatch clears approval and returns fresh state',async t=>{
 const f=generationFixture(t),s=await f.ready();f.setGenerator(()=>{throw Object.assign(new Error('重新预览'),{publicError:true,code:'PREVIEW_CHANGED'});});
 const r=await f.generate();error(r,'PREVIEW_CHANGED');invalidated(r.state,s);error(await f.generate(),'PREVIEW_REQUIRED');
});
for(const operation of ['run','correct','choose','reset','revision','settings'])test('preview invalidated by '+operation,async t=>{
 const f=generationFixture(t),s=await f.ready();
 if(operation==='run')await f.run();else if(operation==='correct')await f.api.correct(f.event,f.payload({token:s.token,nodeId:'line-1',action:'unvoiced'}));
 else if(operation==='choose')await f.choose('script');else if(operation==='reset')await f.api.reset(f.event,f.payload({token:s.token}));
 else if(operation==='revision')f.ctx.revision++;else f.api.invalidateReadingSettings();
 assert.equal((await f.get()).generationPreview,null);
});
for(const change of ['revision','document','session','settings','disk','busy'])test('pending preview cannot publish after '+change,async t=>{
 const entered=deferred(),resume=deferred();const f=fixture(t,{previewPortable:async()=>{entered.resolve();await resume.promise;return {summary:{fps:30},fingerprint:'pending'};}});
 const s=await f.ready(),p=previewFor(f);await entered.promise;error(await f.get(),'BUSY');
 if(change==='revision')f.ctx.revision++;else if(change==='document')f.ctx.documentId++;else if(change==='session')f.ctx.session={};
 else if(change==='settings')f.api.invalidateReadingSettings();else if(change==='disk')fs.appendFileSync(f.paths.config,'\n');else f.ctx.busy=true;
 resume.resolve();error(await p,change==='disk'?'DISK_CHANGED':change==='busy'?'BUSY':change==='settings'?'STALE_TOKEN':'STALE_CONTEXT');
 f.ctx.busy=false;assert.equal((await f.get()).generationPreview,null);
});
test('preview strict sender and payload validation occurs before dependency',async t=>{
 let calls=0;const f=fixture(t,{previewPortable:async x=>{calls++;return trustedPreview(x);}}),s=await f.ready(),payload=f.payload({token:s.token,paginationPlan:planFor(s.report)});
 error(await f.api.preview({...f.event,senderFrame:{}},payload),'INVALID_SENDER');
 for(const extra of [{expectedPreviewFingerprint:'forged'},{summary:{}},{assetsRoot:f.paths.assets}])error(await f.api.preview(f.event,{...payload,...extra}),'INVALID_PAYLOAD');
 error(await f.api.preview(f.event,{...payload,token:'old'}),'STALE_TOKEN');error(await f.api.preview(f.event,{...payload,paginationPlan:null}),'PAGINATION_REQUIRED');assert.equal(calls,0);
});
test('preview post-probe disk check catches dependency without callback',async t=>{
 const f=fixture(t,{previewPortable:()=>{fs.writeFileSync(f.voice,'changed');return {summary:{fps:30},fingerprint:'changed'};}});const s=await f.ready();const r=await previewFor(f);error(r,'DISK_CHANGED');invalidated(r.state,s);
});
test('initial state exposes only empty basenames and token', async t => {const f = fixture(t), r = await f.get(); assert.equal(r.ok, true); assert.equal(r.report, null); assert.deepEqual(r.selection, {script: null, assets: null, config: null, returnMap: null}); assert.equal(typeof r.token, 'string');});
test('real fixture default readers run A preflight', async t => {const f = fixture(t), r = await f.ready(); assert.equal(r.report.ok, true); assert.equal(r.report.canGenerate, false); assert.equal(r.selection.script, 'script.txt'); assert.ok(!JSON.stringify(r).includes(f.root));});
test('foreign sender rejected', async t => {const f = fixture(t); error(await f.api.getState({...f.event, sender: {}}, f.payload()), 'INVALID_SENDER');});
test('subframe and missing frame rejected', async t => {const f = fixture(t); for (const senderFrame of [{}, undefined]) error(await f.api.getState({...f.event, senderFrame}, f.payload()), 'INVALID_SENDER');});
test('destroyed window rejected', async t => {const f = fixture(t); f.ctx.win.isDestroyed = () => true; error(await f.get(), 'INVALID_SENDER');});
test('exact payload whitelist rejects path and arbitrary fields', async t => {const f = fixture(t); for (const p of [{path: f.paths.script}, {text: 'x'}, {overrides: {}}]) error(await f.api.choose(f.event, f.payload({kind: 'script', ...p})), 'INVALID_PAYLOAD');});
test('document/revision required and exact', async t => {const f = fixture(t); error(await f.api.getState(f.event, {documentId: 0}), 'INVALID_PAYLOAD'); error(await f.api.getState(f.event, f.payload({documentId: 1})), 'STALE_CONTEXT'); error(await f.api.getState(f.event, f.payload({expectedRevision: 1})), 'STALE_CONTEXT');});
test('documentId accepts nonnegative safe integers only', async t => {
 const f = fixture(t);
 for (const documentId of ['0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) error(await f.api.getState(f.event, f.payload({documentId})), 'INVALID_PAYLOAD');
 assert.equal((await f.get()).documentId, 0);
 f.ctx.documentId = Number.MAX_SAFE_INTEGER; assert.equal((await f.get()).ok, true);
});
test('revision change retains selection and token but invalidates report until run', async t => {
 const f = fixture(t); await f.ready(); const before = await f.correct(); f.ctx.revision++;
 const current = await f.get(); assert.deepEqual(current.selection, before.selection); assert.equal(current.token, before.token); assert.equal(current.report, null);
 error(await f.correct(), 'REPORT_REQUIRED');
 error(await f.api.run(f.event, f.payload({expectedRevision: 0, token: before.token})), 'STALE_CONTEXT');
 const rerun = await f.api.run(f.event, f.payload({token: before.token})); assert.equal(rerun.ok, true); assert.equal(rerun.report.bindings[0].status, 'unvoiced'); assert.notEqual(rerun.token, before.token);
});
test('revision change during picker preserves choices for retry', async t => {
 const f = fixture(t), before = await f.ready(), d = deferred(); f.setPick(() => d.promise);
 const choosing = f.choose('script'); f.ctx.revision++; d.resolve(f.paths.script); error(await choosing, 'STALE_CONTEXT');
 const current = await f.get(); assert.deepEqual(current.selection, before.selection); assert.equal(current.token, before.token); assert.equal(current.report, null); assert.equal((await f.run()).ok, true);
});
test('busy rejects every operation', async t => {const f = fixture(t); f.ctx.busy = true; error(await f.get(), 'BUSY'); error(await f.choose('script'), 'BUSY');});
test('picker is called only with main process kind', async t => {const f = fixture(t); let args; f.setPick((...a) => {args = a; return f.paths.script;}); await f.choose('script'); assert.deepEqual(args, ['script']); error(await f.choose('arbitrary'), 'INVALID_PAYLOAD');});
test('picker cancellation preserves report and token', async t => {const f = fixture(t), before = await f.ready(); f.setPick(() => null); assert.deepEqual(await f.choose('script'), {...before, cancelled: true}); f.setPick(() => ({canceled: true, filePaths: []})); assert.deepEqual(await f.choose('assets'), {...before, cancelled: true});});
test('Electron picker result accepted and selection rotates token', async t => {const f = fixture(t), before = await f.get(); f.setPick(() => ({canceled: false, filePaths: [f.paths.script]})); const after = await f.choose('script'); assert.notEqual(before.token, after.token); assert.equal(after.selection.script, 'script.txt');});
test('picker document race rejected and old data discarded', async t => {const f = fixture(t); await f.ready(); const d = deferred(); f.setPick(() => d.promise); const p = f.choose('script'); f.ctx.documentId = 1; d.resolve(f.paths.script); error(await p, 'STALE_CONTEXT'); const r = await f.get(); assert.equal(r.report, null); assert.equal(r.selection.assets, null);});
for (const kind of ['session', 'revision', 'win']) test('picker '+kind+' race rejected', async t => {const f = fixture(t), d = deferred(); f.setPick(() => d.promise); const p = f.choose('script'); if (kind === 'revision') f.ctx.revision++; else if (kind === 'win') f.ctx.win = {...f.ctx.win}; else f.ctx.session = {}; d.resolve(f.paths.script); error(await p, 'STALE_CONTEXT');});
test('local pending blocks simultaneous picker and getState', async t => {const f = fixture(t), d = deferred(); f.setPick(() => d.promise); const p = f.choose('script'); error(await f.choose('assets'), 'BUSY'); error(await f.get(), 'BUSY'); d.resolve(null); assert.equal((await p).ok, true); assert.equal((await f.get()).ok, true);});
test('busy starting during dialog rejects commit', async t => {const f = fixture(t), d = deferred(); f.setPick(() => d.promise); const p = f.choose('script'); f.ctx.busy = true; d.resolve(f.paths.script); error(await p, 'BUSY'); f.ctx.busy = false; assert.equal((await f.get()).selection.script, null);});
test('missing choices reject run', async t => {const f = fixture(t); error(await f.run(), 'SELECTION_REQUIRED');});
test('stale and cross document token rejected', async t => {const f = fixture(t), before = await f.ready(); await f.run(); error(await f.api.run(f.event, f.payload({token: before.token})), 'STALE_TOKEN'); f.ctx.documentId = 2; error(await f.api.run(f.event, f.payload({token: before.token})), 'STALE_TOKEN'); assert.equal((await f.get()).report, null);});
test('unvoiced correction rotates token and reset restores automatic binding', async t => {const f = fixture(t), first = await f.ready(); const r = await f.correct(); assert.notEqual(r.token, first.token); assert.equal(r.report.bindings[0].status, 'unvoiced'); assert.equal((await f.correct('reset')).report.bindings[0].status, 'matched');});
test('binding accepts only registered voice resource ID', async t => {const f = fixture(t), first = await f.ready(); error(await f.correct('bind', {resourceId: f.voice}), 'INVALID_CORRECTION'); const r = await f.correct('bind', {resourceId: first.report.assetCatalog[0].id}); assert.equal(r.report.bindings[0].status, 'manual');});
test('correction exact action fields and node identity enforced', async t => {const f = fixture(t); await f.ready(); error(await f.correct('unvoiced', {resourceId: 'x'}), 'INVALID_PAYLOAD'); error(await f.correct('execute'), 'INVALID_PAYLOAD'); error(await f.correct('bind'), 'INVALID_PAYLOAD'); error(await f.correct('unvoiced', {nodeId: '__proto__'}), 'INVALID_CORRECTION');});
test('correction requires an existing report', async t => {const f = fixture(t); error(await f.correct(), 'REPORT_REQUIRED');});
for (const change of ['text', 'config', 'catalog', 'same-size-audio', 'unsupported-entry']) test('correction rejects disk '+change+' change with rollback', async t => {
 const f = fixture(t), before = await f.ready();
 if (change === 'text') fs.writeFileSync(f.paths.script, '小窗：改过');
 if (change === 'config') fs.appendFileSync(f.paths.config, '\n');
 if (change === 'catalog') fs.writeFileSync(path.join(f.paths.assets, '配音', 'CHA_002_新.wav'), 'x');
 if (change === 'same-size-audio') {fs.writeFileSync(f.voice, 'xxxx audio'); const now = new Date(Date.now()+2000); fs.utimesSync(f.voice, now, now);}
 if (change === 'unsupported-entry') fs.writeFileSync(path.join(f.paths.assets, 'other.bin'), 'x');
 error(await f.correct(), 'DISK_CHANGED'); invalidated(await f.get(), before);
});
test('run retains same-text corrections and rescans assets', async t => {const f = fixture(t); await f.ready(); await f.correct(); fs.writeFileSync(path.join(f.paths.assets, '配音', 'CHA_002_新.wav'), 'x'); const r = await f.run(); assert.equal(r.report.bindings[0].status, 'unvoiced'); assert.equal(r.report.assetCatalog.length, 2);});
test('changed text discards corrections on run', async t => {const f = fixture(t); await f.ready(); await f.correct(); fs.writeFileSync(f.paths.script, '小窗：改过'); const r = await f.run(); assert.notEqual(r.report.bindings[0].status, 'unvoiced');});
test('failed preflight correction rolls back atomically', async t => {let broken = false; const f = fixture(t, {preflight: x => {if (broken) throw new Error('private path'); return core.preflight(x);}}); const before = await f.ready(); broken = true; const r = await f.correct(); error(r, 'IO_FAILED'); assert.ok(!r.error.message.includes('private')); assert.deepEqual(await f.get(), before);});
test('incompatible speaker bind rejected without losing old correction', async t => {const f = fixture(t); fs.writeFileSync(path.join(f.paths.assets, '配音', 'OTHER_001_你好.wav'), 'x'); await f.ready(); const before = await f.correct(); const other = before.report.assetCatalog.find(a => a.relativePath.includes('OTHER')); error(await f.correct('bind', {resourceId: other.id}), 'INVALID_CORRECTION'); assert.deepEqual(await f.get(), before);});
test('returned report is detached from main-process report', async t => {const f = fixture(t), r = await f.ready(); r.report.nodes[0].id = 'forged'; r.report.assetCatalog.length = 0; const next = await f.get(); assert.equal(next.report.nodes[0].id, 'line-1'); assert.equal(next.report.assetCatalog.length, 1);});
test('reset requires token and drops selections/report/corrections', async t => {const f = fixture(t), first = await f.ready(); error(await f.api.reset(f.event, f.payload()), 'INVALID_PAYLOAD'); const r = await f.api.reset(f.event, f.payload({token: first.token})); assert.equal(r.report, null); assert.equal(r.selection.script, null); assert.notEqual(r.token, first.token);});
test('operations never dirty project or persist corrections', async t => {const f = fixture(t); f.ctx.session = Object.freeze({dirty: false}); const before = fs.readFileSync(f.paths.script); await f.ready(); await f.correct(); assert.equal(f.ctx.session.dirty, false); assert.deepEqual(fs.readFileSync(f.paths.script), before); assert.deepEqual(fs.readdirSync(f.root).sort(), ['assets', 'config.json', 'script.txt']);});
test('context change during asynchronous preflight prevents run commit', async t => {
 const entered = deferred(), resume = deferred(); let hold = false;
 const f = fixture(t, {preflight: async x => {if (hold) {entered.resolve(); await resume.promise;} return core.preflight(x);}});
 await f.ready(); hold = true; const running = f.run(); await entered.promise;
 f.ctx.documentId = 1; resume.resolve(); error(await running, 'STALE_CONTEXT'); assert.equal((await f.get()).report, null);
});
test('disk change during asynchronous correction preflight rolls back', async t => {
 const entered = deferred(), resume = deferred(); let hold = false;
 const f = fixture(t, {preflight: async x => {if (hold) {entered.resolve(); await resume.promise;} return core.preflight(x);}});
 const before = await f.ready(); hold = true; const correcting = f.correct(); await entered.promise;
 fs.appendFileSync(f.paths.config, '\n'); resume.resolve(); error(await correcting, 'DISK_CHANGED'); invalidated(await f.get(), before);
});
test('picker failures release lock and do not leak paths', async t => {const f = fixture(t); f.setPick(() => {throw new Error(f.paths.script);}); const r = await f.choose('script'); error(r, 'IO_FAILED'); assert.ok(!JSON.stringify(r).includes(f.root)); assert.equal((await f.get()).ok, true);});
