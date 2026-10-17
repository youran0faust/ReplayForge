const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const policy = require('./video-audio-policy.cjs');
function fixture() { return {schemaVersion:4,design:{fps:30},scene:{durationFrames:180,videoClips:[{id:'insert',resourceId:'v',startFrame:30,endFrame:90}]},resources:[{id:'v',kind:'video',mime:'video/mp4',width:640,height:360,fps:30,frameCount:60,normalizationVersion:1,audioResourceId:'a'},{id:'a',kind:'audio',sampleRate:48000,durationSamples:96000}]}; }
test('pure UMD full-length descriptors use clip identity, no restart or mutation',()=>{
 const p=fixture(),before=JSON.stringify(p),sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('./video-audio-policy.cjs'),'utf8'),sandbox);
 const clips=policy.videoAudioClips(p);assert.deepEqual(clips,[{id:'video-audio:insert',videoId:'insert',resourceId:'a',startSamples:48000,durationSamples:96000,sourceOffsetSamples:0}]);
 assert.equal(JSON.stringify(sandbox.VideoAudioPolicy.videoAudioClips(p)),JSON.stringify(clips));assert.equal(JSON.stringify(p),before);
 delete p.resources[0].audioResourceId;assert.deepEqual(policy.videoAudioClips(p),[]);assert.equal(policy.videoIntervals(p).length,1);
});
test('silent intervals reject any half-open overlap but permit both exact edges',()=>{
 const p=fixture();delete p.resources[0].audioResourceId;const intervals=policy.videoIntervals(p);
 for(const clip of [{startSamples:0,durationSamples:48000},{startSamples:144000,durationSamples:1}]) assert.doesNotThrow(()=>policy.validateNoAudioOverlap([clip],intervals));
 for(const clip of [{startSamples:0,durationSamples:48001},{startSamples:48000,durationSamples:1},{startSamples:143999,durationSamples:2},{startSamples:0,durationSamples:200000}]) assert.throws(()=>policy.validateNoAudioOverlap([clip],intervals),/overlaps video/);
});
test('invalid formal metadata and non-full clips fail; legacy empty behavior remains',()=>{
 assert.deepEqual(policy.videoIntervals({scene:{}}),[]);
 for(const change of [p=>p.schemaVersion=3,p=>p.resources[0].frameCount=61,p=>p.resources[0].normalizationVersion=2,p=>p.resources[0].fps=25,p=>p.resources[1].durationSamples=96001,p=>p.scene.videoClips.push({...p.scene.videoClips[0],id:'other'})]) {const p=fixture();change(p);assert.throws(()=>policy.videoAudioClips(p));}
});
