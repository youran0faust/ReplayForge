'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {editCharacterOpacity}=require('./performance-character-edit.cjs');
const {evaluatePerformance,performanceErrors}=require('./performance-model.cjs');
function fixture(){return {schemaVersion:4,scene:{durationFrames:200,characters:[{id:'c',visibleFrom:10,visibleTo:100},{id:'other',visibleFrom:0,visibleTo:200}],performance:{version:1,characterOpacity:[{id:'a',characterId:'c',startFrame:20,endFrame:30,from:0,to:.4},{id:'foreign',characterId:'other',startFrame:0,endFrame:10,from:0,to:1},{id:'b',characterId:'c',startFrame:50,endFrame:70,from:.8,to:0},{id:'jump',characterId:'c',startFrame:70,endFrame:80,from:1,to:.2}],screenFades:[{id:'screen',startFrame:0,endFrame:20,from:0,to:1}],dialogueVisibility:[{id:'vis',frame:5,visible:false}],dialogueClears:[{id:'clear',frame:6}],titles:[{id:'title',startFrame:0,endFrame:5,text:'T',fadeInFrames:0,fadeOutFrames:0}]}}};}
for(const [start,end] of [[0,90],[30,120],[10,100],[25,65],[35,90],[85,100],[85,86],[0,120],[0,15],[70,71],[30,50],[20,30],[60,70],[80,81]])test('curve projection and identity '+start+':'+end,()=>{
 const p=fixture(),before=structuredClone(p),c=p.scene.characters[0],delta=start-c.visibleFrom,move=end-c.visibleTo===delta;
 editCharacterOpacity(p,c,start,end);c.visibleFrom=start;c.visibleTo=end;
 assert.deepEqual(performanceErrors(p),[]);
 for(let f=start;f<end;f+=.25)assert(Math.abs(evaluatePerformance(p,f).characterOpacity.c-evaluatePerformance(before,move?f-delta:f).characterOpacity.c)<1e-12,'frame '+f);
 for(const key of ['screenFades','dialogueVisibility','dialogueClears','titles'])assert.deepEqual(p.scene.performance[key],before.scene.performance[key]);
 assert.deepEqual(p.scene.performance.characterOpacity.find(e=>e.id==='foreign'),before.scene.performance.characterOpacity[1]);
 assert(p.scene.performance.characterOpacity.every(e=>before.scene.performance.characterOpacity.some(old=>old.id===e.id)));
});
test('no-op leaves arrays untouched; tail hold reuses predecessor; discontinuous endpoint remains original to',()=>{
 const p=fixture(),all=p.scene.performance.characterOpacity,c=p.scene.characters[0];editCharacterOpacity(p,c,10,100);assert.equal(p.scene.performance.characterOpacity,all);
 editCharacterOpacity(p,c,85,86);assert.deepEqual(p.scene.performance.characterOpacity.filter(e=>e.characterId==='c'),[{id:'jump',characterId:'c',startFrame:85,endFrame:86,from:.2,to:.2}]);
 const q=fixture();editCharacterOpacity(q,q.scene.characters[0],60,70);assert.equal(q.scene.performance.characterOpacity.find(e=>e.id==='b').to,0);
});
test('source baseline stays historical across linked edits, save and deletion; return rejects dangling mappings',()=>{
 const {parseScript}=require('./script-parser.cjs'),{buildScriptProject}=require('./script-project-builder.cjs'),{createSourceRecord}=require('./script-source-record.cjs'),{ProjectSession}=require('./session.cjs'),{applyTimelineEdit}=require('./timeline-edit.cjs'),{exportScriptText}=require('./script-text-export.cjs'),{prepareReturnPackage}=require('./script-return-package.cjs');
 const text='@出场 甲 演出=淡入 时长=1秒\n@停顿 2秒\n@退场 甲 演出=淡出 时长=1秒',config={version:1,characters:[{name:'甲',image:'base.png'}]},parsed=parseScript(text,config),report={...parsed,assetCatalog:[{id:'base',kind:'image',category:'character',relativePath:'角色/base.png',categoryPath:'base.png'}],bindings:[]};
 const built=buildScriptProject({report,config,media:[{id:'base',kind:'image',path:'assets/base.png'}],schemaVersion:4});assert(built.project,JSON.stringify(built.diagnostics));
 built.project.scriptSource=createSourceRecord({text,config,report,...built,mediaMappings:[{resourceId:'base',category:'character',relativePath:'角色/base.png',hash:'a'.repeat(64)}]});
 const s=new ProjectSession(built.project),before=s.snapshot(),c=s.project.scene.characters[0];assert(s.project.scene.performance.characterOpacity.length);
 applyTimelineEdit(s,{kind:'characters',id:c.id,startFrame:c.visibleFrom+1,endFrame:c.visibleTo});const after=s.snapshot();assert.deepEqual(after.scriptSource,before.scriptSource);assert.deepEqual(new ProjectSession(JSON.parse(JSON.stringify(after))).snapshot(),after);assert(exportScriptText(after).losses.length);assert(prepareReturnPackage(after).source);s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
 s.deleteCharacter(c.id);assert.deepEqual(s.project.scriptSource,before.scriptSource);assert.deepEqual(new ProjectSession(s.snapshot()).snapshot(),s.snapshot());assert.throws(()=>prepareReturnPackage(s.snapshot()),/mapping/);
});
test('invalid ranges reject before mutation',()=>{for(const [a,b]of [[-1,89],[0,201],[10,10],[.5,80],[NaN,80],[10,Infinity]]){const p=fixture(),before=structuredClone(p);assert.throws(()=>editCharacterOpacity(p,p.scene.characters[0],a,b));assert.deepEqual(p,before);}});
