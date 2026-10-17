'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {collectTimelineSnapTargets:collect,snapTimelineDrag:snap}=require('./timeline-snap.js');
const {calculateTimelineDrag:plain,calculateGroupDrag:group,calculateAudioTrackDrag:audio}=require('./timeline.js');
const drag={kind:'characters',id:'c',mode:'move',startFrame:20,endFrame:40,durationFrames:200};
function run(d,delta,targets,threshold=8,fn=plain){return snap({drag:d,deltaFrames:delta,targets,thresholdFrames:threshold,calculate:n=>fn({...d,deltaFrames:n})});}
test('move compares both ends and keeps duration; exact pixel-derived threshold and deterministic ties',()=>{
 let r=run(drag,8,[{frame:50,label:'tail'}]);assert.deepEqual(r.result,{startFrame:30,endFrame:50});assert.equal(r.snap.edge,'end');
 r=run(drag,8,[{frame:30,label:'first'},{frame:50,label:'second'}]);assert.equal(r.snap.label,'first');
 assert.equal(run(drag,8,[50],1).snap,null);assert.equal(run(drag,8,[50],2).snap.frame,50);
 // Parent computes 8 * extent / whole-lane width: zoomed width reduces threshold.
 assert.equal(run(drag,8,[50],8*200/1600).snap,null);
});
test('clamp never produces false guide and trims only selected edge with one-frame minimum',()=>{
 assert.equal(run(drag,500,[205]).snap,null);
 let r=run({...drag,mode:'start'},19,[40]);assert.equal(r.snap,null);assert.equal(r.result.startFrame,39);
 r=run({...drag,mode:'end'},-19,[20]);assert.equal(r.snap,null);assert.equal(r.result.endFrame,21);
 r=run({...drag,mode:'end'},9,[50]);assert.deepEqual(r.result,{startFrame:20,endFrame:50});assert.equal(r.snap.edge,'end');
 assert.equal(run(drag,3,[60],NaN).snap,null);
});
test('group edges and internal boundary use actual endFrame result and preserve neighboring minimum',()=>{
 const d={...drag,kind:'dialogues',group:true,startFrame:10,endFrame:100,pages:[{id:'a',startFrame:10,endFrame:40},{id:'b',startFrame:40,endFrame:100}]};
 let r=run({...d,mode:'boundary',pageId:'a'},8,[50],8,group);assert.deepEqual(r.result,{startFrame:10,endFrame:50});assert.equal(r.snap.frame,50);
 r=run({...d,mode:'boundary',pageId:'a'},80,[100],8,group);assert.equal(r.result.endFrame,99);assert.equal(r.snap,null);
 r=run({...d,mode:'start'},29,[40],8,group);assert.equal(r.result.startFrame,39);assert.equal(r.snap,null);
});
test('audio fractional sample tail remains exact; impossible integer target rejects rather than rounding samples',()=>{
 const d={kind:'audioTracks',mode:'move',startFrame:10,durationSamples:16001,sourceOffsetSamples:0,sourceDurationSamples:96000,durationFrames:200,fps:30};
 let r=run(d,5,[26],2,audio);assert.equal(r.snap,null);assert.equal(r.result.durationSamples,16001);
 const target=26+1/1600;r=run(d,5,[target],2,audio);assert.equal(r.snap.edge,'end');assert.equal(r.result.startFrame,16);assert.equal(r.result.durationSamples,16001);
 r=run({...d,mode:'end'},5,[target],2,audio);assert.equal(r.snap.edge,'end');assert.equal(r.result.durationSamples,25601);
 const limited={...d,mode:'end',sourceDurationSamples:16001};assert.equal(run(limited,5,[26],8,audio).snap,null);
});
test('collect excludes own group/pages/follow voices, retains independent voices, and never mutates input',()=>{
 const project={scene:{durationFrames:200,characters:[{id:'c',expressionEvents:[{id:'e',frame:33}]}],backgroundEvents:[{id:'bg',frame:77}]}},model={tracks:[{kind:'characters',items:[{id:'c',startFrame:20,endFrame:40}]},{kind:'dialogues',items:[{id:'d',startFrame:10,endFrame:100,children:[{id:'p',startFrame:10,endFrame:55}]},{id:'other',startFrame:120,endFrame:150}]},{kind:'audio',items:[{id:'d',startFrame:12,endFrame:80}]},{kind:'voiceClips',items:[{id:'v',dialogueId:'d',bindingMode:'follow',startFrame:13,endFrame:90},{id:'ind',dialogueId:'d',bindingMode:'independent',startFrame:100,endFrame:120}]}]};
 const before=JSON.stringify({project,model});
 let ts=collect({project,model,drag:{kind:'dialogues',id:'d',group:true},playhead:66});assert.deepEqual(ts.map(t=>t.frame),[66,0,200,20,40,120,150,100,33,77]);
 ts=collect({project,model,drag:{kind:'characters',id:'c'},playhead:66});assert(!ts.some(t=>[20,40,33].includes(t.frame)));
 ts=collect({project,model,drag:{kind:'expressionEvents',id:'e',characterId:'c'}});assert(!ts.some(t=>t.frame===33));assert.equal(JSON.stringify({project,model}),before);
 // Legacy omitted binding is follow; explicit independent legacy voice remains fixed too.
 const legacyModel={tracks:[{kind:'audio',items:[{id:'d',bindingMode:'independent',startFrame:101,endFrame:121}]}]};
 ts=collect({project,model:legacyModel,drag:{kind:'dialogues',id:'d',mode:'move'}});assert(ts.some(t=>t.frame===101));assert(ts.some(t=>t.frame===121));
});
test('marker scene end is rejected by supplied half-open calculator; disabled caller uses original calculation',()=>{
 const d={kind:'expressionEvents',mode:'move',startFrame:20,durationFrames:30},calc=n=>({frame:Math.max(0,Math.min(29,Math.round(20+n)))});
 assert.equal(snap({drag:d,deltaFrames:10,targets:[30],thresholdFrames:8,calculate:calc}).snap,null);
 const raw=plain({...drag,deltaFrames:8});assert.deepEqual(raw,{startFrame:28,endFrame:48}); // Alt/toggle bypass doesn't invoke helper.
});
