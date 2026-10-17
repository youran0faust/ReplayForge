'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{compare,requireExactSignal,requireIndependentMix}=require('./real-assets-export-evidence.cjs');
const signal=()=>Array.from({length:48000},(_,i)=>Math.fround(.2*Math.sin(i*.031)+.07*Math.cos(i*.127)));
test('exact decoded codec-reference signal passes; source independent float tolerance separate',()=>{const a=signal();assert.equal(requireExactSignal(a,[...a]).maxAbsError,0);assert(requireIndependentMix(a,a.map(v=>v+2e-8)).maxAbsError<1e-6);assert.throws(()=>requireExactSignal(a,a.map(v=>v+2e-8)));});
for(const kind of ['dropout','gain','shift','missingVoice'])test('negative control rejects '+kind,()=>{const a=signal(),b=a.map((v,i)=>kind==='gain'?v*.5:kind==='shift'?(a[i-1600]||0):kind==='missingVoice'?Math.fround(.07*Math.cos(i*.127)):i>=10000&&i<20000?0:v);assert.throws(()=>requireExactSignal(a,b));assert.throws(()=>requireIndependentMix(a,b));});
test('reject changed sample count and non-finite signals',()=>{assert.throws(()=>compare([1],[1,0]));assert.throws(()=>compare([NaN],[0]));assert.throws(()=>compare([1],[Infinity]));});
