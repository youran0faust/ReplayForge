const test = require('node:test'), assert = require('node:assert/strict');
const {trackFadeErrors, audioEnvelopeErrors, envelopeAtSample} = require('./audio-envelope.cjs');
test('sample-local triangular envelope includes boundary and clamps; zero is identity', () => {
  for (const s of [-1,0,60,100,101]) assert.equal(envelopeAtSample(100,0,s),1);
  for (const [s,value] of [[0,1],[59,1],[60,1],[80,.5],[99,.025],[100,0],[101,0]]) assert.equal(envelopeAtSample(100,40,s),value);
  assert.equal(envelopeAtSample(100,100,50),.5);
  assert.equal(envelopeAtSample(100,1,99),1);
  assert.throws(()=>envelopeAtSample(100,101,0));
});
test('fade field is strictly schema4 BGM only including explicit zero', () => {
  const t={id:'bgm',kind:'bgm',durationSamples:100,fadeOutSamples:0};
  assert.deepEqual(trackFadeErrors(t,{schemaVersion:4}),[]);
  for (const value of [null,undefined,-1,.5,'0',Infinity,NaN,101,Number.MAX_SAFE_INTEGER+1]) assert.ok(trackFadeErrors({...t,fadeOutSamples:value},{schemaVersion:4}).length);
  for (const schemaVersion of [undefined,1,2,3]) assert.ok(trackFadeErrors(t,{schemaVersion}).length);
  assert.ok(trackFadeErrors({...t,kind:'sfx'},{schemaVersion:4}).length);
  assert.deepEqual(audioEnvelopeErrors({schemaVersion:1,scene:{audioTracks:[{kind:'bgm',durationSamples:100}]}}),[]);
});
test('UMD browser exposes matching pure API without Node globals', () => {
  const vm=require('node:vm'),fs=require('node:fs'),sandbox={};
  vm.runInNewContext(fs.readFileSync(require.resolve('./audio-envelope.cjs'),'utf8'),sandbox);
  assert.equal(sandbox.AudioEnvelope.envelopeAtSample(100,40,80),.5);
});
