'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ProjectSession}=require('./session.cjs');
const {applyTimelineEdit}=require('./timeline-edit.cjs');
function fixture(){return {schemaVersion:4,id:'p',locale:'en',design:{width:1280,height:720,fps:30},resources:[],characterDefinitions:[{id:'def',name:'A',color:'#fff'}],scene:{id:'scene',durationFrames:120,characters:['bound','other'].map(id=>({id,definitionId:'def',x:0,y:0,width:100,height:100,visibleFrom:10,visibleTo:100})),dialogues:[{id:'d',speakerId:'def',text:{en:'Hello'},startFrame:10,endFrame:30,displayUntilFrame:40,revealFrames:5}],performance:{version:1,characterOpacity:[{id:'opacity',characterId:'bound',startFrame:30,endFrame:50,from:0,to:1}],screenFades:[{id:'fade',startFrame:100,endFrame:120,from:0,to:1}],dialogueVisibility:[{id:'hide',frame:70,visible:false}],dialogueClears:[{id:'clear',frame:80}],titles:[{id:'title',startFrame:90,endFrame:110,text:'Title',fadeInFrames:0,fadeOutFrames:0}]}}};}
const state=s=>structuredClone({project:s.project,revision:s.revision,savedRevision:s.savedRevision,history:s.history,future:s.future,draft:s.draft});
const patch=(id,startFrame,endFrame,kind='characters')=>({kind,id,startFrame,endFrame});
function reversible(s,action){const before=s.snapshot(),revision=s.revision,history=s.history.length;action();assert.equal(s.revision,revision+1);assert.equal(s.history.length,history+1);const after=s.snapshot();assert.deepEqual(after.scene.performance,before.scene.performance);assert.equal(s.undo(),true);assert.deepEqual(s.snapshot(),before);assert.equal(s.redo(),true);assert.deepEqual(s.snapshot(),after);}
test('bound role move trim and deletion are single reversible transactions through both range paths',()=>{
 for(const range of [[20,110],[20,100],[10,90],[40,100],[60,100]])for(const form of [false,true]){
  const s=new ProjectSession(fixture()),before=s.snapshot();
  if(form)s.editCharacter('bound',{visibleFrom:range[0],visibleTo:range[1]});else applyTimelineEdit(s,patch('bound',...range));
  assert.equal(s.revision,1);assert.equal(s.history.length,1);const after=s.snapshot();assert.deepEqual(after.scene.performance.screenFades,before.scene.performance.screenFades);
  s.undo();assert.deepEqual(s.snapshot(),before);s.redo();assert.deepEqual(s.snapshot(),after);
 }
 const s=new ProjectSession(fixture()),before=s.snapshot();s.deleteCharacter('bound');assert.deepEqual(s.project.scene.performance.characterOpacity,[]);assert.deepEqual(s.project.scene.dialogues,before.scene.dialogues);s.undo();assert.deepEqual(s.snapshot(),before);
});
test('no-op preserves redo and drafts; invalid independent visibility ranges reject atomically',()=>{
 const p=fixture();p.scene.characters[0].visibilityEvents=[{id:'v',frame:15,visible:false}];const s=new ProjectSession(p);s.editCharacter('other',{x:1});s.undo();s.draft={text:'pending'};const before=state(s);
 assert.equal(applyTimelineEdit(s,patch('bound',10,100)).changed,false);s.editCharacter('bound',{visibleFrom:10,visibleTo:100});assert.deepEqual(state(s),before);
 for(const action of [()=>applyTimelineEdit(s,patch('bound',20,110)),()=>s.editCharacter('bound',{visibleFrom:20,visibleTo:110}),()=>applyTimelineEdit(s,patch('bound',-1,89))]){assert.throws(action);assert.deepEqual(state(s),before);}
 assert.equal(s.redo(),true);
});
test('target-specific guard permits unrelated role/dialogue edits and non-timing properties',()=>{
 const s=new ProjectSession(fixture());reversible(s,()=>applyTimelineEdit(s,patch('other',20,110)));reversible(s,()=>s.editCharacter('bound',{x:20,visibleFrom:10,visibleTo:100}));reversible(s,()=>applyTimelineEdit(s,patch('d',20,40,'dialogues')));reversible(s,()=>s.deleteCharacter('other'));
});
test('non-opacity scene performances do not block role timing or deletion',()=>{
 const p=fixture();delete p.scene.performance.characterOpacity;const s=new ProjectSession(p);reversible(s,()=>applyTimelineEdit(s,patch('bound',20,110)));reversible(s,()=>s.deleteCharacter('bound'));
});
test('direct invalid apply and full scene shrink reject via model without partial mutation',()=>{
 const s=new ProjectSession(fixture());s.editCharacter('other',{x:1});s.undo();s.draft='pending';const before=state(s);
 for(const action of [p=>{p.scene.characters=p.scene.characters.filter(c=>c.id!=='bound');},p=>{p.scene.characters[0].visibleFrom=40;},p=>{p.scene.durationFrames=119;}]){assert.throws(()=>s.apply(action));assert.deepEqual(state(s),before);}
});
