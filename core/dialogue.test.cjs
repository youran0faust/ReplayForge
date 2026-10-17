const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {ProjectSession}=require('./session.cjs');
const project=JSON.parse(fs.readFileSync(path.join(__dirname,'../examples/rain-corridor.json'),'utf8').replace(/^\uFEFF/,''));
const s=new ProjectSession(project),id=project.scene.dialogues[0].id;
const patch={text:'新的对白 👩‍🚀',startFrame:60,endFrame:240,revealFrames:60};
s.editDialogue(id,patch);
assert.equal(s.revision,1);assert.equal(s.evaluate(59).dialogues.length,0);
assert.equal(s.evaluate(60).dialogues[0].text,patch.text);
assert.equal(s.evaluate(240).dialogues.length,0);
assert.equal(s.snapshot().scene.dialogues[0].text['en-US'],project.scene.dialogues[0].text['en-US']);
const changed=s.snapshot();s.undo();assert.deepEqual(s.snapshot(),project);s.redo();assert.deepEqual(s.snapshot(),changed);
for(const bad of [{text:''},{startFrame:NaN},{startFrame:1.5},{endFrame:60},{endFrame:999},{revealFrames:0},{revealFrames:181}]){
 const revision=s.revision;assert.throws(()=>s.editDialogue(id,{...patch,...bad}));assert.equal(s.revision,revision);assert.deepEqual(s.snapshot(),changed);
}
assert.throws(()=>s.editDialogue('missing',patch));assert.deepEqual(s.snapshot(),changed);
const file=path.join(__dirname,'../test-output/dialogue-project.json');s.save(file);assert.deepEqual(ProjectSession.open(file).snapshot(),changed);
console.log(JSON.stringify({status:'PASS',checks:['edit localized text','frame boundaries','other locale preserved','undo redo','invalid transaction rollback','save reopen']}));
