'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {savePortable,saveSessionPortable,openPortable}=require('./project-storage.cjs');
const {validateProject}=require('./model.cjs');
const {upgradeCharacters4}=require('./schema-migration.cjs');
function fixture(t){
 const parent=path.resolve(__dirname,'../../test-output/P2');fs.mkdirSync(parent,{recursive:true});
 const base=fs.mkdtempSync(path.join(parent,'schema4-storage-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const source=path.join(base,'source');fs.mkdirSync(source);fs.writeFileSync(path.join(source,'portrait.bin'),'portrait fixture');
 const legacy={schemaVersion:3,id:'storage4',locale:'en',design:{width:100,height:100,fps:30},resources:[{id:'portrait',kind:'image',path:'portrait.bin'}],characterDefinitions:[{id:'hero',name:'Hero',color:'#ffffff',resourceId:'portrait'}],scene:{durationFrames:30,characters:[{id:'instance',definitionId:'hero',x:0,y:0,width:50,height:80,visibleFrom:0,visibleTo:30}],dialogues:[{id:'d',speakerId:'instance',startFrame:0,endFrame:30,revealFrames:1,text:{en:'Hello'},voiceClips:[],pages:[{id:'page',startFrame:0,endFrame:30,revealFrames:1,text:{en:'Hello'}}]}]}};
 return {base,source,legacy,project:upgradeCharacters4(legacy)};
}
test('schema4 portable roundtrip preserves definition speakers and independent character library',t=>{
 const {base,source,project}=fixture(t);project.scene.characters=[]; // Speakers do not require a stage instance in schema4.
 assert.deepEqual(validateProject(project),[]);const before=structuredClone(project);
 const saved=savePortable(project,7,source,path.join(base,'saved','project.json'));
 assert.deepEqual(project,before);assert.deepEqual(saved.project.scene,before.scene);assert.deepEqual(saved.project.characterDefinitions,before.characterDefinitions);
 assert.equal(saved.project.schemaVersion,4);const moved=path.join(base,'moved');fs.renameSync(saved.root,moved);fs.rmSync(source,{recursive:true});
 const opened=openPortable(path.join(moved,'project.json'));assert.equal(opened.revision,7);assert.deepEqual(opened.project,saved.project);
 assert.equal(fs.readFileSync(path.join(opened.root,opened.project.resources[0].path),'utf8'),'portrait fixture');
 const raw=path.join(moved,'raw.json');fs.writeFileSync(raw,JSON.stringify(opened.project));assert.deepEqual(openPortable(raw).project,opened.project);
});
test('storage delegates schema4 invalid speaker validation and does not overwrite a manifest',t=>{
 const {base,source,project}=fixture(t),file=path.join(base,'existing.json');fs.writeFileSync(file,'existing manifest');
 project.scene.dialogues[0].speakerId='instance';const before=structuredClone(project);assert(validateProject(project).length>0);
 assert.throws(()=>savePortable(project,0,source,file),/speaker/i);assert.equal(fs.readFileSync(file,'utf8'),'existing manifest');assert.deepEqual(project,before);
 const raw=path.join(source,'invalid.json');fs.writeFileSync(raw,JSON.stringify(project));assert.throws(()=>openPortable(raw),/speaker/i);
});
test('mixed schema3 history and schema4 snapshots preserve their own semantics',t=>{
 const {base,source,legacy,project}=fixture(t),future=structuredClone(project);future.scene.characters=[];
 const session={revision:2,snapshot:()=>project,history:[{label:'upgrade',before:legacy}],future:[{project:future}]},before=structuredClone({project,history:session.history,future:session.future});
 const saved=saveSessionPortable(session,source,path.join(base,'saved','mixed.json'));
 assert.equal(saved.project.schemaVersion,4);assert.equal(saved.history[0].before.schemaVersion,3);assert.equal(saved.history[0].before.scene.dialogues[0].speakerId,'instance');assert.equal(saved.future[0].project.scene.dialogues[0].speakerId,'hero');
 assert.deepEqual({project,history:session.history,future:session.future},before);
 const old=savePortable(legacy,1,source,path.join(base,'legacy','schema3.json'));assert.equal(openPortable(old.file).project.schemaVersion,3);assert.equal(old.project.scene.dialogues[0].speakerId,'instance');
});
