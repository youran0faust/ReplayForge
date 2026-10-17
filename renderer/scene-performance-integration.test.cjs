'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/preview.js','utf8'),html=fs.readFileSync(__dirname+'/index.html','utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}
function harness(){
 const current={documentId:'d',revision:1,project:{design:{width:1280,height:720},scene:{performance:{titles:[]}}}};
 const editor={serial:1,dirty:false,busy:false,publishing:Promise.resolve()};
 const context={current,scenePerformanceEditor:editor,scenePerformancePublishing:Promise.resolve(),log:{},window:{replay:{updateScenePerformanceDraftStatus:async()=>{}},TitleLayout:{createTitleLayoutProbe:()=>({measure:async()=>({fits:true})})}},document:{}};
 vm.createContext(context);vm.runInContext('let titleLayoutProbe;'+section('function measureSceneTitle','function publishPerformanceDraft'),context);return context;
}
test('host and dependency order retain character editor',()=>{
 assert.match(html,/id="scene-performance-editor-host"/);
 for(const file of ['../core/title-style.cjs','title-layout.js'])assert.ok(html.indexOf('src="'+file+'"')<html.indexOf('src="scene-renderer.js"'));
 assert.ok(html.indexOf('src="scene-performance-editor.js"')<html.indexOf('src="preview.js"'));
 assert.match(source,/performanceEditor=createCharacterPerformanceEditor/);assert.match(source,/scenePerformanceEditor=createScenePerformanceEditor/);
});
test('gate rejects dirty and busy',async()=>{
 const c=harness();c.scenePerformanceEditor.dirty=true;await assert.rejects(c.settleScenePerformance(),/未应用/);
 c.scenePerformanceEditor.dirty=false;c.scenePerformanceEditor.busy=true;await assert.rejects(c.settleScenePerformance(),/正在提交/);
 c.scenePerformanceEditor.busy=false;assert.equal((await c.settleScenePerformance()).documentId,'d');
});
test('publishing await rechecks serial document revision',async()=>{
 for(const key of ['serial','documentId','revision']){
  let resolve;const c=harness();c.scenePerformanceEditor.publishing=new Promise(r=>resolve=r);
  const pending=c.settleScenePerformance();if(key==='serial')c.scenePerformanceEditor.serial++;else c.current[key]='changed';resolve();await assert.rejects(pending,/等待期间/);
 }
});
test('all titles measured with design; save warns export rejects',async()=>{
 const c=harness(),seen=[];c.current.project.scene.performance.titles=[{id:'first',text:'正常',startFrame:0},{id:'late',text:'很长标题',startFrame:999}];
 c.window.TitleLayout.createTitleLayoutProbe=()=>({measure:async(t,d)=>{seen.push([t.id,d]);return {fits:t.id!=='late'};}});
 assert.match(await c.checkSceneTitles(),/late.*很长标题.*仍可保存/);await assert.rejects(c.checkSceneTitles({rejectOverflow:true}),/late.*很长标题.*导出已拒绝/);
 assert.deepEqual(seen.map(x=>x[0]),['first','late','first','late']);assert.ok(seen.every(x=>x[1]===c.current.project.design));
});
test('measurement await rechecks revision',async()=>{
 const c=harness();c.current.project.scene.performance.titles=[{id:'x'}];c.window.TitleLayout.createTitleLayoutProbe=()=>({measure:async()=>{c.current.revision++;return {fits:true};}});await assert.rejects(c.checkSceneTitles({rejectOverflow:true}),/等待期间/);
});
test('prepare cancellation preserves foreign drafts and own busy exemption is narrow',async()=>{
 const c=harness();Object.assign(c,{eventFormDraft:null,hasExpressionDraft:()=>false,pageDraft:null,audioFormDirty:()=>false,backgroundEditor:null,voiceClipEditor:null,componentEditor:null,characterLibraryEditor:null,textImportEditor:null,performanceEditor:null,codeBusy:false,codeEditor:{state:{dirty:true}}});
 c.scenePerformanceEditor.dirty=true;c.scenePerformanceEditor.busy=true;c.window.confirm=()=>false;
 vm.runInContext(section('async function prepareProductionMutation','async function commitExpressionIntent'),c);
 assert.equal(await c.prepareProductionMutation({preserveScenePerformance:true}),false);
 assert.equal(c.codeEditor.state.dirty,true);assert.equal(c.scenePerformanceEditor.dirty,true);
 await assert.rejects(c.prepareProductionMutation({preserveCode:true}),/正在提交/);
 c.scenePerformanceEditor.busy=false;c.componentEditor={busy:true};await assert.rejects(c.prepareProductionMutation({preserveScenePerformance:true}),/其他属性表单/);
});
test('selection cancellation keeps scene draft',()=>{
 const c=harness();c.scenePerformanceEditor.dirty=true;c.scenePerformanceEditor.allowDiscard=()=>false;
 vm.runInContext(section('function allowProductionSelection','function selectTimelineItem'),c);
 assert.equal(c.allowProductionSelection({owner:'resource'}),false);assert.equal(c.scenePerformanceEditor.dirty,true);
});
test('mutation self exemption and code exclusion are explicit',()=>{
 const prepare=section('async function prepareProductionMutation','async function commitExpressionIntent');
 assert.match(prepare,/!preserveScenePerformance&&scenePerformanceEditor\?\.dirty/);assert.match(prepare,/!preserveCode&&codeEditor.state.dirty/);
 assert.match(prepare,/if\(!preserveScenePerformance\)scenePerformanceEditor\?\.clear/);assert.match(prepare,/await scenePerformanceEditor\?\.publishing;await publishScenePerformanceDraft/);assert.match(prepare,/captured.scenePerformanceSerial!==scenePerformanceEditor\?\.serial/);
 assert.match(source,/prepare:\(\)=>prepareProductionMutation\(\{preserveScenePerformance:true\}\)/);assert.match(source,/prepareProductionMutation\(\{preserveCode:true\}\)/);
 for(const id of ['save','save-as','open'])assert.match(section("action('#"+id+"'",'\n'),/settleScenePerformance/);
 const exp=section("action('#export',",'function checkedResult');assert.ok(exp.indexOf('checkSceneTitles({rejectOverflow:true})')<exp.indexOf('window.replay.exportCurrent()'));
});
