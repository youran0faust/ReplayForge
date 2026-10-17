'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {upgradeProject, upgradeCharacters, upgradeCharacters4} = require('./schema-migration.cjs');
function fixture() {
 return {schemaVersion:3,characterDefinitions:[{id:'hero',name:'Hero'},{id:'unused',name:'Unused'}],scene:{characters:[{id:'a',definitionId:'hero'},{id:'b',definitionId:'hero'}],dialogues:[
 {id:'d1',speakerId:'a',endFrame:30,displayUntilFrame:45,voiceClips:[{id:'v',binding:{dialogueId:'d1',mode:'follow',followOffsetFrames:0}}],pages:[{id:'page',text:{en:'First'}}],display:{name:'Alias'},fullText:{en:'Original'}},
 {id:'d2',speakerId:'b',endFrame:60,displayUntilFrame:60,voice:{resourceId:'audio',durationSamples:4800}}, {id:'d3',speakerId:'narrator',endFrame:90,displayUntilFrame:90}]}};
}
function freeze(v) { if(v && typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v; }
test('schema3 to schema4 copies and changes only version and speaker references',()=>{
 const p=freeze(fixture()),before=JSON.stringify(p),next=upgradeCharacters4(p),expected=structuredClone(p);
 expected.schemaVersion=4; expected.scene.dialogues[0].speakerId='hero';expected.scene.dialogues[1].speakerId='hero';
 assert.deepEqual(next,expected);assert.equal(JSON.stringify(p),before);assert.deepEqual(upgradeCharacters4(p),next);
 assert.notEqual(next.characterDefinitions,p.characterDefinitions);
 for(const key of ['voiceClips','pages','display','fullText'])assert.notEqual(next.scene.dialogues[0][key],p.scene.dialogues[0][key]);
 next.scene.dialogues[0].display.name='Changed';assert.equal(p.scene.dialogues[0].display.name,'Alias');
});
test('new migration requires schema3 and old entry points never downgrade schema4',()=>{
 for(const schemaVersion of [1,2,4,5,undefined]){const p={...fixture(),schemaVersion},before=structuredClone(p);assert.throws(()=>upgradeCharacters4(p),/schema3/);assert.deepEqual(p,before);}
 const p={...fixture(),schemaVersion:4};for(const upgrade of [upgradeProject,upgradeCharacters])assert.throws(()=>upgrade(p),/Unsupported schemaVersion/);assert.equal(p.schemaVersion,4);
 for(const schemaVersion of [2,3]){const old={...fixture(),schemaVersion};assert.deepEqual(upgradeProject(old),old);}assert.deepEqual(upgradeCharacters(fixture()),fixture());
});
test('refuse missing or ambiguous mappings without partial input mutation',()=>{
 const mutations=[p=>{p.scene.dialogues[1].speakerId='missing';},p=>{p.scene.dialogues[1].speakerId='hero';},p=>{p.scene.characters[0].definitionId='missing';},p=>{p.scene.characters.push({...p.scene.characters[0]});},p=>{p.characterDefinitions.push({...p.characterDefinitions[0]});},p=>{p.characterDefinitions[0].id='narrator';p.scene.characters.forEach(c=>c.definitionId='narrator');},p=>{p.scene.characters=null;},p=>{p.scene.dialogues=null;},p=>{p.characterDefinitions=null;}];
 for(const mutate of mutations){const p=fixture();mutate(p);const before=structuredClone(p);assert.throws(()=>upgradeCharacters4(p));assert.deepEqual(p,before);}
});
test('paged migration fills missing fullText by exact per-locale concatenation, including narrator',()=>{
 const p=fixture();delete p.scene.dialogues[0].fullText;delete p.scene.dialogues[1].displayUntilFrame;
 p.scene.dialogues[0].pages=[{text:{en:'Hello\n',ja:'前'}},{text:{en:' world',ja:'後'}}];
 p.scene.dialogues[2].pages=[{text:{en:'Narration'}}];const before=structuredClone(p),next=upgradeCharacters4(p);
 assert.deepEqual(next.scene.dialogues[0].fullText,{en:'Hello\n world',ja:'前後'});
 assert.deepEqual(next.scene.dialogues[2].fullText,{en:'Narration'});
 assert.equal(Object.hasOwn(next.scene.dialogues[1],'fullText'),false);assert.deepEqual(p,before);
 assert.equal(next.scene.dialogues[1].displayUntilFrame,60);assert.equal(next.scene.dialogues[0].displayUntilFrame,45);
 delete p.scene.dialogues[0].pages[1].text.ja;assert.throws(()=>upgradeCharacters4(p),/locale missing/);
});
test('narrator-only projects require no stage instances',()=>{
 const p=fixture();p.scene.characters=[];p.scene.dialogues=[{id:'n',speakerId:'narrator',endFrame:30,displayUntilFrame:30}];const next=upgradeCharacters4(p);assert.equal(next.schemaVersion,4);assert.deepEqual(next.scene,p.scene);
});
