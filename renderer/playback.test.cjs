const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require.resolve('./playback.js'), 'utf8');
function wav(seconds = 4, rate = 48000, channels = 2) {
  const bytes = Buffer.alloc(44 + seconds * rate * channels * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
  bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
}
function project(starts = []) {
  return {design: {fps: 30}, scene: {durationFrames: 300, dialogues: starts.map((startFrame, i) => ({
    id: `d${i}`, startFrame, endFrame: startFrame + 15, voice: {resourceId: 'v', durationSamples: 192000}
  }))}, resources: [{id: 'v', kind: 'audio', sampleRate: 48000}]};
}
function fixture({fetch, decode} = {}) {
  const frames = [], states = [], errors = [], sources = [], callbacks = new Map();
  let next = 1, fetches = 0, resumes = 0;
  const context = {currentTime: 10, destination: {}, resume() { resumes++; return Promise.resolve(); },
    decodeAudioData: decode || (async () => ({duration: 4, numberOfChannels: 2})),
    createBufferSource() {
      const source = {connect(target) { this.target = target; }, disconnect() { this.disconnected = true; }, stop() { this.stopped = true; },
        start(...args) { this.args = args; }};
      sources.push(source); return source;
    }};
  const sandbox = {AbortController, fetch: (...args) => { fetches++; return fetch ? fetch(...args) : Promise.resolve({ok: true, arrayBuffer: async () => wav()}); }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../core/audio-envelope.cjs'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(require.resolve('../core/video-audio-policy.cjs'), 'utf8'), sandbox);
  vm.runInNewContext(code, sandbox);
  const controller = sandbox.createPlaybackController({audioContextFactory: () => context,
    onFrame: f => frames.push(f), onState: s => states.push(s), onError: e => errors.push(e),
    requestFrame: cb => { const id = next++; callbacks.set(id, cb); return id; }, cancelFrame: id => callbacks.delete(id)});
  return {controller, context, frames, states, errors, sources, callbacks,
    get fetches() { return fetches; }, get resumes() { return resumes; },
    tick(time) { context.currentTime = time; const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(cb => cb(999999)); }};
}
function videoProject() {
  const p=project();p.schemaVersion=4;
  p.resources.push({id:'video',kind:'video',mime:'video/mp4',width:640,height:360,fps:30,frameCount:120,normalizationVersion:1,audioResourceId:'own'},{id:'own',kind:'audio',sampleRate:48000,durationSamples:192000});
  p.scene.videoClips=[{id:'insert',resourceId:'video',startFrame:30,endFrame:150}];return p;
}
const exactDecode=async()=>({duration:4,numberOfChannels:2,sampleRate:48000,length:192000});
test('video own audio uses absolute samples and seek source offset once without ordinary replay',async()=>{
 const p=videoProject();p.scene.dialogues=[{id:'d',startFrame:0,endFrame:30,voiceClips:[{id:'ordinary',resourceId:'v',sampleRate:48000,durationSamples:48000,sourceOffsetSamples:48000,binding:{dialogueId:'d',mode:'follow'}}]}];
 const f=fixture({decode:exactDecode});await f.controller.play(p,{v:'voice.wav',own:'own.wav'},90,{endFrame:120});assert.deepEqual(f.sources.map(s=>s.args),[[10,2,1]]);
 f.controller.pause();await f.controller.play(p,{v:'voice.wav',own:'own.wav'},0);assert.deepEqual(f.sources.slice(1).map(s=>s.args),[[10,1,1],[11,0,4]]);
});
test('silent video blocks full ordinary timeline outside seek range before fetch',async()=>{
 const p=videoProject();delete p.resources[1].audioResourceId;p.scene.dialogues=project([30]).scene.dialogues;
 const f=fixture();await assert.rejects(f.controller.play(p,{v:'voice.wav'},180,{endFrame:210}),/overlaps video/);assert.equal(f.fetches,0);
 p.scene.dialogues=[];await f.controller.play(p,{},90);assert.equal(f.fetches,0);assert.equal(f.sources.length,0);
});
test('video actual WAV and decoder facts reject lying metadata even outside range',async()=>{
 for(const kind of ['length','channels','format','decodedLength','decodedChannels','decodedRate']) {
  const bytes=wav(kind==='length'?4+1/48000:4,48000,kind==='channels'?1:2);if(kind==='format')new DataView(bytes).setUint16(20,3,true);
  const f=fixture({fetch:async()=>({ok:true,arrayBuffer:async()=>bytes}),decode:async()=>({...await exactDecode(),...(kind==='decodedLength'?{length:192001}:kind==='decodedChannels'?{numberOfChannels:1}:kind==='decodedRate'?{sampleRate:44100}:{})})});
  await assert.rejects(f.controller.play(videoProject(),{own:'actual.wav'},180,{endFrame:210}),/normalized video WAV/);assert.equal(f.sources.length,0);
 }
});
test('video coexistence preserves C fade automation and ordinary voice source offsets',async()=>{
 const p=videoProject();p.scene.audioTracks=[{id:'bgm',kind:'bgm',name:'BGM',resourceId:'v',startFrame:150,sourceOffsetSamples:48000,durationSamples:96000,gain:.5,fadeOutSamples:48000}];
 const f=fixture({decode:exactDecode}),calls=[];f.context.createGain=()=>({gain:{setValueAtTime:(v,t)=>calls.push(['set',v,t]),linearRampToValueAtTime:(v,t)=>calls.push(['ramp',v,t])},connect(){},disconnect(){}});
 await f.controller.play(p,{v:'voice.wav',own:'own.wav'},195);assert.deepEqual(f.sources.map(s=>s.args),[[10,2.5,.5]]);assert.deepEqual(calls,[['set',.25,10],['ramp',0,10.5]]);
});
test('voice clips compile each source once, exclude legacy mirror and preserve source samples on range seek', async () => {
  const p=project([30]),d=p.scene.dialogues[0];p.schemaVersion=2;
  d.voiceClips=[{id:'left',resourceId:'v',sampleRate:48000,sourceOffsetSamples:0,durationSamples:48000,binding:{dialogueId:d.id,mode:'follow'}},{id:'right',resourceId:'v',sampleRate:48000,sourceOffsetSamples:48000,durationSamples:96000,binding:{dialogueId:d.id,mode:'independent'},startFrame:60}];
  const before=JSON.stringify(p),f=fixture();await f.controller.play(p,{v:'voice.wav'},45,{endFrame:90});
  assert.deepEqual(f.sources.map(s=>s.args),[[10,.5,.5],[10.5,1,1]]);assert.equal(f.fetches,1);assert.equal(JSON.stringify(p),before);
  d.voiceClips=[];const empty=fixture();await empty.controller.play(p,{v:'voice.wav'});assert.equal(empty.sources.length,0);
});
test('voice clip binding, IDs and source metadata validate outside preview range',async()=>{
  for(const patch of [{id:''},{sampleRate:44100},{sourceOffsetSamples:-1},{sourceDurationSamples:1},{binding:{dialogueId:'wrong',mode:'follow'}}]){
    const p=project([180]);p.scene.dialogues[0].voiceClips=[{id:'c',resourceId:'v',sampleRate:48000,sourceOffsetSamples:0,durationSamples:48000,binding:{dialogueId:'d0',mode:'follow'},...patch}];
    const f=fixture();await assert.rejects(f.controller.play(p,{v:'voice.wav'},0,{endFrame:30}));assert.equal(f.sources.length,0);
  }
});
function addTracks(p, starts = [0, 30], gains = [0.25, 2]) {
  p.scene.audioTracks = starts.map((startFrame, i) => ({id: `t${i}`, name: `Track ${i}`, kind: i % 2 ? 'bgm' : 'sfx', resourceId: 'v', startFrame, durationSamples: 192000, gain: gains[i] ?? 1}));
  return p;
}
function enableGains(f) {
  const gains = [];
  f.context.createGain = () => {
    const gain = {gain: {value: 1}, connect(target) { this.target = target; }, disconnect() { this.disconnected = true; }};
    gains.push(gain); return gain;
  };
  return gains;
}
test('BGM fade schedule uses local samples on seek, not source offsets, and range does not compress fade', async()=>{
  for(const [startFrame,expected] of [[0,[['set',.5,11],['set',.5,12],['ramp',0,13]]],[60,[['set',.5,10],['ramp',0,11]]],[75,[['set',.25,10],['ramp',0,10.5]]]]){
    const f=fixture(),p=addTracks(project(),[30],[.5]);p.schemaVersion=4;
    Object.assign(p.scene.audioTracks[0],{kind:'bgm',sourceOffsetSamples:48000,durationSamples:96000,fadeOutSamples:48000});
    const calls=[];f.context.createGain=()=>({gain:{setValueAtTime:(v,t)=>calls.push(['set',v,t]),linearRampToValueAtTime:(v,t)=>calls.push(['ramp',v,t])},connect(){},disconnect(){}});
    await f.controller.play(p,{v:'voice.wav'},startFrame,{endFrame:80});assert.deepEqual(calls,expected);
    assert.equal(f.sources[0].args[1],1+Math.max(0,startFrame/30-1));
    f.controller.pause();assert.equal(f.sources[0].stopped,true);
  }
});
test('zero fade preserves gain.value legacy scheduling without automation methods',async()=>{
  const f=fixture(),gains=enableGains(f),p=addTracks(project(),[0],[.7]);p.schemaVersion=4;
  Object.assign(p.scene.audioTracks[0],{kind:'bgm',fadeOutSamples:0});await f.controller.play(p,{v:'voice.wav'});assert.equal(gains[0].gain.value,.7);
});
test('invalid fades reject even outside preview before fetching',async()=>{
  for(const patch of [{fadeOutSamples:-1},{fadeOutSamples:192001},{fadeOutSamples:null},{kind:'sfx'}]){
    const f=fixture(),p=addTracks(project(),[180]);p.schemaVersion=4;Object.assign(p.scene.audioTracks[0],{kind:'bgm',fadeOutSamples:48000},patch);
    await assert.rejects(f.controller.play(p,{v:'voice.wav'},0,{endFrame:30}),/fadeOutSamples/);assert.equal(f.fetches,0);
  }
});
test('explicit voice binding follows offsets or freezes start, trims once and validates outside range',async()=>{const p=project([30]),v=p.scene.dialogues[0].voice;p.resources[0].durationSamples=192000;Object.assign(v,{binding:{dialogueId:'d0',mode:'independent'},startFrame:90,sourceOffsetSamples:48000,durationSamples:48000,sourceDurationSamples:192000});let f=fixture();await f.controller.play(p,{v:'voice.wav'},105,{endFrame:120});assert.deepEqual(f.sources.map(s=>s.args),[[10,1.5,.5]]);assert.equal(f.fetches,1);p.scene.dialogues[0].startFrame=0;f=fixture();await f.controller.play(p,{v:'voice.wav'},0);assert.deepEqual(f.sources.map(s=>s.args),[[13,1,1]]);v.binding={dialogueId:'d0',mode:'follow',followOffsetFrames:15};f=fixture();await f.controller.play(p,{v:'voice.wav'},0);assert.deepEqual(f.sources.map(s=>s.args),[[10.5,1,1]]);for(const change of [()=>v.binding.dialogueId='wrong',()=>{v.binding.dialogueId='d0';v.sourceOffsetSamples=192000},()=>{v.sourceOffsetSamples=0;v.sourceDurationSamples=100}]){change();f=fixture();await assert.rejects(()=>f.controller.play(p,{v:'voice.wav'},200));assert.equal(f.sources.length,0);assert.equal(f.errors.length,1);}});
test('independent overlaps share decoded WAV, use per-track gains and exact range offsets', async () => {
  const f = fixture(), gains = enableGains(f), p = addTracks(project([0]), [0, 30, 150], [0, 0.25, 2]), before = JSON.stringify(p);
  await f.controller.play(p, {v: 'voice.wav'}, 60, {endFrame: 90});
  assert.deepEqual(f.sources.map(s => s.args), [[10, 2, 1], [10, 2, 1], [10, 1, 1]]);
  assert.equal(gains.length, 2); assert.deepEqual(gains.map(g => g.gain.value), [0, 0.25]);
  assert.equal(f.sources[0].target, f.context.destination);
  assert.equal(f.sources[1].target, gains[0]); assert.equal(gains[0].target, f.context.destination);
  assert.equal(f.fetches, 1); assert.equal(JSON.stringify(p), before);
  f.sources[1].onended(); assert.equal(gains[0].disconnected, true);
  f.controller.pause(); assert(gains.every(g => g.disconnected)); assert(f.sources.every(s => s.disconnected));
});
test('trim offsets add source offset once for seek range and shared URL cache',async()=>{const f=fixture();enableGains(f);const p=addTracks(project(),[30,90]);p.resources[0].durationSamples=192000;Object.assign(p.scene.audioTracks[0],{sourceOffsetSamples:48000,durationSamples:96000});Object.assign(p.scene.audioTracks[1],{sourceOffsetSamples:120000,durationSamples:48000});await f.controller.play(p,{v:'voice.wav'},60,{endFrame:105});assert.deepEqual(f.sources.map(s=>s.args),[[10,2,1],[11,2.5,0.5]]);assert.equal(f.fetches,1);f.controller.pause();await f.controller.play(p,{v:'voice.wav'},30);assert.deepEqual(f.sources.slice(2).map(s=>s.args),[[10,1,2],[12,2.5,1]]);assert.equal(f.fetches,1);});
test('trim range and actual full source corruption rejected outside preview range',async()=>{for(const offset of [null,-1,0.5,'0',Infinity,192000]){const f=fixture(),p=addTracks(project(),[180]);p.scene.audioTracks[0].sourceOffsetSamples=offset;await assert.rejects(f.controller.play(p,{v:'voice.wav'},0,{endFrame:30}),/source range/);}const f=fixture(),p=addTracks(project(),[180]);p.resources[0].durationSamples=240000;Object.assign(p.scene.audioTracks[0],{sourceOffsetSamples:100,durationSamples:48000});await assert.rejects(f.controller.play(p,{v:'voice.wav'},0,{endFrame:30}),/source duration metadata mismatch/);assert.equal(f.sources.length,0);});
test('track future start, full duration and gain2 end cleanly at scene end', async () => {
  const f = fixture(), gains = enableGains(f);
  await f.controller.play(addTracks(project(), [180], [2]), {v: 'voice.wav'}, 150);
  assert.deepEqual(f.sources[0].args, [11, 0, 4]); assert.equal(gains[0].gain.value, 2);
  f.tick(15); assert.equal(f.controller.state, 'ended'); assert.equal(gains[0].disconnected, true);
});
test('full scene track validation rejects invalid gain and overflow outside requested range', async () => {
  for (const gain of [-1, 2.01, NaN, Infinity, '1', undefined, null]) {
    const f = fixture(), p = addTracks(project(), [180]); p.scene.audioTracks[0].gain = gain;
    await assert.rejects(f.controller.play(p, {v: 'voice.wav'}, 0, {endFrame: 30}), /gain/);
    assert.equal(f.fetches, 0);
  }
  const f = fixture(); await assert.rejects(f.controller.play(addTracks(project(), [210]), {v: 'voice.wav'}, 0, {endFrame: 30}), /beyond scene/);
});
test('out-of-range independent WAVs must match full duration and sample rate', async () => {
  for (const rate of [48000, 44100]) {
    const f = fixture({fetch: async () => ({ok: true, arrayBuffer: async () => wav(4, rate)})}), p = addTracks(project(), [180]);
    if (rate === 48000) p.resources[0].durationSamples = 192001;
    await assert.rejects(f.controller.play(p, {v: 'voice.wav'}, 0, {endFrame: 30}), /metadata mismatch|48000/);
    assert.equal(f.sources.length, 0); assert.equal(f.fetches, 1);
  }
});
test('no-track backward fixture requires no createGain and remains unmodified', async () => {
  const f = fixture(), p = project([30]); p.scene.audioTracks = []; const before = JSON.stringify(p);
  assert.equal(f.context.createGain, undefined);
  await f.controller.play(p, {v: 'voice.wav'}); assert.deepEqual(f.sources[0].args, [11, 0, 4]);
  assert.equal(JSON.stringify(p), before);
});
test('paged dialogue keeps one continuous parent voice across pages and resumes inside later page', async () => {
  const p=project([30]), d=p.scene.dialogues[0]; d.endFrame=180; d.text={en:'First'};
  d.pages=[{id:'one',startFrame:30,endFrame:60,revealFrames:1,text:{en:'First'}},{id:'two',startFrame:60,endFrame:120,revealFrames:1,text:{en:'Second'}},{id:'three',startFrame:120,endFrame:180,revealFrames:1,text:{en:'Third'}}];
  const before=JSON.stringify(p), f=fixture(); await f.controller.play(p,{v:'voice.wav'},30);
  assert.equal(f.sources.length,1); assert.deepEqual(f.sources[0].args,[10,0,4]);
  for(const t of [10.99,11,11.01,12.99,13,13.01]){f.tick(t);assert.equal(f.sources.length,1);assert.equal(f.sources[0].stopped,undefined);assert.equal(f.controller.state,'playing');}
  assert.equal(f.fetches,1); f.controller.pause();
  await f.controller.play(p,{v:'voice.wav'},135,{endFrame:180});
  assert.equal(f.sources.length,2);assert.deepEqual(f.sources[1].args.slice(1),[3.5,0.5]);
  assert.equal(JSON.stringify(p),before);
});
test('zero voices uses audio clock, not RAF timestamps; ends on last valid frame', async () => {
  const f = fixture();
  const pending = f.controller.play(project());
  assert.equal(f.resumes, 1);
  assert.equal(await pending, true);
  f.tick(11); assert.equal(f.controller.frame, 30);
  f.tick(20); assert.equal(f.controller.frame, 299);
  assert.equal(f.controller.state, 'ended'); assert.equal(f.callbacks.size, 0);
  assert.deepEqual(f.frames, [0, 30, 299]); assert.equal(f.fetches, 0);
});
test('one stereo voice continues past dialogue end and uses full duration', async () => {
  const f = fixture(); await f.controller.play(project([30]), {v: 'voice.wav'});
  assert.deepEqual(f.sources[0].args, [11, 0, 4]);
  assert.equal(f.sources[0].buffer.numberOfChannels, 2);
  f.tick(12); assert.equal(f.controller.pause(), 60);
  assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.controller.stop(), 0);
});
test('overlapping voices starting in the middle get separate sources and exact offsets', async () => {
  const f = fixture(); await f.controller.play(project([0, 30, 90, 180]), {v: 'voice.wav'}, 150);
  assert.equal(f.sources.length, 2); // Voices at 0 and 1 seconds already ended.
  assert.deepEqual(f.sources[0].args, [10, 2, 2]);
  assert.deepEqual(f.sources[1].args, [11, 0, 4]); // Voice ends exactly at the scene boundary.
  assert.equal(f.fetches, 1);
  f.tick(11); assert.equal(f.controller.pause(), 180);
  await f.controller.play(project([0, 30, 90, 180]), {v: 'voice.wav'}, 180);
  assert.deepEqual(f.sources[2].args, [11, 3, 1]); assert.equal(f.fetches, 1);
});
test('overlap plays both active voices, not only the currently visible dialogue', async () => {
  const f = fixture(); await f.controller.play(project([0, 30]), {v: 'voice.wav'}, 60);
  assert.deepEqual(f.sources.map(s => s.args), [[10, 2, 2], [10, 1, 3]]);
});
test('pause invalidates pending fetch and stale RAF without callbacks', async () => {
  let resolveFetch, signal;
  const f = fixture({fetch: (_, options) => { signal = options.signal; return new Promise(r => { resolveFetch = r; }); }});
  const pending = f.controller.play(project([0]), {v: 'voice.wav'}, 30);
  assert.equal(f.controller.pause(), 30); assert.equal(signal.aborted, true);
  const states = f.states.slice();
  resolveFetch({ok: true, arrayBuffer: async () => wav()});
  assert.equal(await pending, false); assert.deepEqual(f.states, states); assert.deepEqual(f.frames, []);
  assert.equal(f.sources.length, 0);
  await f.controller.play(project(), {}, 60);
  const stale = [...f.callbacks.values()][0]; f.controller.pause();
  const count = f.frames.length; f.context.currentTime = 100; stale();
  assert.equal(f.frames.length, count); assert.equal(f.callbacks.size, 0);
});
test('new play invalidates pending decode, anchors only after loading completes', async () => {
  let resolveDecode, entered;
  const decoding = new Promise(r => { entered = r; });
  const f = fixture({decode: () => { entered(); return new Promise(r => { resolveDecode = r; }); }});
  const pending = f.controller.play(project([0]), {v: 'voice.wav'}); await decoding;
  f.context.currentTime = 50;
  await f.controller.play(project(), {}, 90);
  resolveDecode({duration: 4}); assert.equal(await pending, false);
  f.tick(51); assert.equal(f.controller.frame, 120); assert.equal(f.sources.length, 0);
});
test('loading time is excluded from audio scheduling and frame clock', async () => {
  let resolveDecode, entered;
  const decoding = new Promise(r => { entered = r; });
  const f = fixture({decode: () => { entered(); return new Promise(r => { resolveDecode = r; }); }});
  const pending = f.controller.play(project([30]), {v: 'voice.wav'}, 60);
  await decoding; f.context.currentTime = 100;
  resolveDecode({duration: 4}); assert.equal(await pending, true);
  assert.deepEqual(f.sources[0].args, [100, 1, 3]);
  assert.equal(f.controller.frame, 60); f.tick(101); assert.equal(f.controller.frame, 90);
});
test('cancelled rejected load never reports a stale error or changes state', async () => {
  let rejectFetch;
  const f = fixture({fetch: () => new Promise((_, reject) => { rejectFetch = reject; })});
  const pending = f.controller.play(project([0]), {v: 'voice.wav'});
  f.controller.pause(); rejectFetch(Error('late fetch error'));
  assert.equal(await pending, false); assert.equal(f.controller.state, 'paused');
  assert.equal(f.errors.length, 0); assert.equal(f.frames.length, 0);
});
test('natural ending stops and disconnects sources and cancels RAF', async () => {
  const f = fixture(); await f.controller.play(project([180]), {v: 'voice.wav'});
  f.tick(20);
  assert.equal(f.controller.state, 'ended'); assert.equal(f.frames.at(-1), 299);
  assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.callbacks.size, 0);
});
test('optional resource sampleRate is accepted only when WAV itself is 48k', async () => {
  const p = project([0]); delete p.resources[0].sampleRate;
  const f = fixture(); assert.equal(await f.controller.play(p, {v: 'voice.wav'}), true);
  const wrong = fixture({fetch: async () => ({ok: true, arrayBuffer: async () => wav(4, 44100)})});
  await assert.rejects(wrong.controller.play(p, {v: 'voice.wav'}), /48000/);
});
test('scene overflow is rejected rather than previewing an unexportable truncated voice', async () => {
  const f = fixture();
  await assert.rejects(f.controller.play(project([210]), {v: 'voice.wav'}), /beyond scene/);
  assert.equal(f.sources.length, 0); assert.equal(f.fetches, 0);
  assert.equal(f.controller.state, 'error');
});
test('range silence ends at exclusive boundary without project mutation', async () => {
  const f=fixture(),p=project(),before=JSON.stringify(p);
  await f.controller.play(p,{},60,{endFrame:63});f.tick(10.1);
  assert.equal(f.controller.state,'ended');assert.equal(f.controller.frame,62);assert.equal(JSON.stringify(p),before);
});
test('range mid-voice schedules source offset and duration even without timely RAF', async () => {
  const f=fixture();await f.controller.play(project([30]),{v:'voice.wav'},60,{endFrame:63});
  assert.equal(f.sources.length,1);assert.equal(f.sources[0].args[1],1);assert.ok(Math.abs(f.sources[0].args[2]-.1)<1e-9);
  f.tick(20);assert.equal(f.controller.frame,62);assert.equal(f.sources[0].disconnected,true);
});
test('range overlaps have independent offsets and future out-of-range sources are skipped', async () => {
  const f=fixture();await f.controller.play(project([0,30,150]),{v:'voice.wav'},60,{endFrame:90});
  assert.equal(f.sources.length,2);assert.deepEqual(f.sources.map(s=>s.args.slice(1)),[[2,1],[1,1]]);
  const empty=fixture();await empty.controller.play(project([150]),{v:'voice.wav'},60,{endFrame:90});assert.equal(empty.fetches,0);
});
test('invalid explicit ranges reject and default playback resets old endpoint', async () => {
  for(const [start,end] of [[-1,30],[1.5,30],[30,30],[60,30],[0,301],[0,0],[0,30.5],[0,NaN]]) {
    const f=fixture();await assert.rejects(f.controller.play(project(),{},start,{endFrame:end}));assert.equal(f.sources.length,0);
  }
  const f=fixture();await f.controller.play(project(),{},60,{endFrame:63});f.tick(11);
  await f.controller.play(project(),{},62);f.tick(12);assert.equal(f.controller.frame,92);assert.equal(f.controller.state,'playing');
});
test('reject missing references, wrong metadata, wrong WAV rate, duration mismatch and fetch errors', async () => {
  for (const type of ['reference', 'metadata', 'rate', 'duration', 'fetch']) {
    const p = project([0]);
    if (type === 'reference') p.resources = [];
    if (type === 'metadata') p.resources[0].sampleRate = 44100;
    if (type === 'duration') p.scene.dialogues[0].voice.durationSamples = 48000;
    const f = fixture({fetch: async () => ({ok: type !== 'fetch', status: 404,
      arrayBuffer: async () => wav(4, type === 'rate' ? 44100 : 48000)})});
    await assert.rejects(f.controller.play(p, {v: 'voice.wav'}));
    assert.equal(f.controller.state, 'error'); assert.equal(f.errors.length, 1);
    assert.equal(f.sources.length, 0); assert.equal(f.callbacks.size, 0);
  }
});
