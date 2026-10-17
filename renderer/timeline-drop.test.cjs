'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {expressionDropFrame:f}=require('./timeline-drop.js');
test('drop maps scene coordinates and rejects outside instead of clamping',()=>{assert.equal(f(100,{left:100,width:900},900,900),0);assert.equal(f(550,{left:100,width:900},900,900),450);assert.equal(f(999.8,{left:100,width:900},900,900),899);assert.equal(f(1000,{left:100,width:900},900,900),null);assert.equal(f(99.9,{left:100,width:900},900,900),null);});
test('zoom and horizontal scroll share actual content rect; excess extent rejected',()=>{assert.equal(f(500,{left:-400,width:1800},900,900),450);assert.equal(f(700,{left:100,width:1200},1200,900),600);assert.equal(f(1000,{left:100,width:1200},1200,900),null);});
test('invalid geometries and values cannot create frames',()=>{for(const [x,r,e,d]of [[NaN,{left:0,width:1},1,1],[0,{left:0,width:0},1,1],[0,{left:0,width:1},Infinity,1],[0,{left:0,width:1},1,0]])assert.equal(f(x,r,e,d),null);});
function dropFixture(schema,source,target){
 const listeners={},commits=[],messages=[];let captures=false,ghosts=0;
 const lane={dataset:{expressionDropCharacter:target.id},getBoundingClientRect:()=>({left:0,width:100}),appendChild(){ghosts++;}},root={dataset:{extent:'100'},contains:n=>n===lane,addEventListener(){}},element={setPointerCapture(){captures=true;},hasPointerCapture:()=>captures,releasePointerCapture(){captures=false;}};
 const document={elementFromPoint:()=>({closest:()=>lane}),createElement:()=>({style:{},remove(){ghosts--;}}),addEventListener:(name,fn)=>{listeners[name]=fn;}},window={addEventListener(){}};
 const vm=require('node:vm'),fs=require('node:fs'),context=vm.createContext({document,window});vm.runInContext(fs.readFileSync(require.resolve('./timeline-drop.js'),'utf8'),context);
 const drop=context.createExpressionDrop({root,packet:()=>({documentId:7,revision:2,project:{schemaVersion:schema,scene:{durationFrames:100,characters:[target]}}}),status:s=>messages.push(s),suppressClick(){},commit:async intent=>{commits.push(intent);}});
 drop.begin(source,{button:0,pointerId:1,currentTarget:element,clientX:0,clientY:0});
 return {commits,messages,get ghosts(){return ghosts;},get captures(){return captures;},move(){listeners.pointermove({pointerId:1,clientX:20,clientY:0,preventDefault(){}});},up(){listeners.pointerup({pointerId:1,clientX:20,clientY:0});}};
}
for(const schema of [3,4])test(`schema${schema} expression drop matches definitions across instances and rejects foreign definitions`,()=>{
 const source={definitionId:'shared',characterId:'source',expressionId:'smile'},f=dropFixture(schema,source,{id:'other-instance',definitionId:'shared'});f.move();assert.equal(f.ghosts,1);f.up();assert.equal(f.ghosts,0);assert.equal(f.captures,false);assert.equal(f.commits.length,1);const intent=f.commits[0];assert.equal(intent.source.definitionId,'shared');assert.equal(intent.source.expressionId,'smile');assert.equal(intent.target.characterId,'other-instance');assert.equal(intent.atFrame,20);assert.equal(intent.documentId,7);assert.equal(intent.expectedRevision,2);
 const mismatch=dropFixture(schema,source,{id:'source',definitionId:'foreign'});mismatch.move();assert.equal(mismatch.ghosts,0);mismatch.up();assert.equal(mismatch.commits.length,0);assert.match(mismatch.messages.at(-1),/不匹配/);
});
for(const schema of [1,2])test(`legacy schema${schema} expression drop still matches character ids rather than definitions`,()=>{
 const source={definitionId:'shared',characterId:'source',expressionId:'smile'},match=dropFixture(schema,source,{id:'source',definitionId:'foreign'});match.move();match.up();assert.equal(match.commits.length,1);
 const mismatch=dropFixture(schema,source,{id:'other-instance',definitionId:'shared'});mismatch.move();mismatch.up();assert.equal(mismatch.commits.length,0);assert.match(mismatch.messages.at(-1),/不匹配/);
});
