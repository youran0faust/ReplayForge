const assert = require('node:assert/strict');
const {compileAudioTimeline, buildFfmpegArgs} = require('./audio-timeline.cjs');
function fixture(count = 1) {
  const project = {design: {fps: 30}, scene: {durationFrames: 180, dialogues: []}};
  const diagnosis = {hasErrors: false, diagnostics: [], resources: {}};
  for (let i = 0; i < count; i++) {
    const id = `wav${i}`;
    project.scene.dialogues.push({id: `dialogue${i}`, startFrame: 30 + i * 30, endFrame: 45 + i * 30, voice: {resourceId: id, durationSamples: 96000}});
    diagnosis.resources[id] = {id, kind: 'audio', exists: true, absolute: `C:/space dir/${id}.wav`, audio: {format: 'wav', sampleRate: 48000, channels: i % 2 + 1, bitsPerSample: 16, durationSamples: 96000}};
  }
  return {project, diagnosis};
}
function argsFor(project, diagnosis, timeline = compileAudioTimeline(project, diagnosis)) {
  return buildFfmpegArgs({project, timeline, resources: diagnosis.resources, framesPattern: 'C:/frames dir/%04d.png', outputPath: 'C:/out dir/movie.mp4'});
}
let checks = 0;
check('schema4 fade validates and exports trim then gain then sample-local triangular fade', () => {
  const {project,diagnosis}=fixture(); project.schemaVersion=4;project.scene.dialogues=[];
  const track={id:'bgm',name:'BGM',kind:'bgm',resourceId:'wav0',startFrame:30,sourceOffsetSamples:123,durationSamples:48000,gain:.5,fadeOutSamples:24000};
  project.scene.audioTracks=[track];
  const timeline=compileAudioTimeline(project,diagnosis);assert.equal(timeline.clips[0].fadeOutSamples,24000);
  const args=argsFor(project,diagnosis,timeline),filter=args[args.indexOf('-filter_complex')+1];
  assert.match(filter,/atrim=start_sample=123:end_sample=48123,asetpts=PTS-STARTPTS,volume=0.5,afade=t=out:start_sample=24000:nb_samples=24000:curve=tri,adelay=48000S/);
  assert.doesNotMatch(filter,/atempo|asetrate/);
  track.fadeOutSamples=0;const zero=argsFor(project,diagnosis);assert.equal(Object.hasOwn(compileAudioTimeline(project,diagnosis).clips[0],'fadeOutSamples'),false);
  delete track.fadeOutSamples;assert.deepEqual(argsFor(project,diagnosis),zero);
  for(const value of [undefined,null,-1,.5,48001,Number.MAX_SAFE_INTEGER+1]){track.fadeOutSamples=value;assert.throws(()=>compileAudioTimeline(project,diagnosis),/fadeOutSamples/);}
  track.fadeOutSamples=0;project.schemaVersion=3;assert.throws(()=>compileAudioTimeline(project,diagnosis),/schema4/);
  project.schemaVersion=4;track.kind='sfx';assert.throws(()=>compileAudioTimeline(project,diagnosis),/bgm/);
});
function check(name, run) { run(); checks++; console.log(`PASS ${name}`); }
check('zero voices produce video only, no audio filters/codecs or fabricated silence', () => {
  const {project, diagnosis} = fixture(0), timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis);
  assert.equal(timeline.durationSamples, 288000); assert.deepEqual(timeline.clips, []);
  assert(args.includes('-an')); assert(!args.includes('-filter_complex')); assert(!args.includes('-c:a'));
  assert.equal(args.filter(a => a === '-i').length, 1); assert(!args.includes('-shortest'));
});
check('one voice retains identity and full WAV beyond dialogue end', () => {
  const {project, diagnosis} = fixture(), before = JSON.stringify({project, diagnosis});
  const timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis, timeline);
  assert.deepEqual(timeline.clips, [{id: 'dialogue0', dialogueId: 'dialogue0', resourceId: 'wav0', startSamples: 48000, durationSamples: 96000}]);
  assert.equal(timeline.policy, 'full-voice-from-dialogue-start'); assert.match(timeline.mixPolicy, /normalize=0/);
  assert.equal(JSON.stringify({project, diagnosis}), before);
  assert.equal(args.filter(a => a === '-i').length, 2);
  assert(args.includes('C:/space dir/wav0.wav'));
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /adelay=48000S:all=1,apad,atrim=end_sample=288000/);
  assert.match(filter, /amix=inputs=1.*normalize=0/); assert.match(filter, /alimiter=limit=0.95:level=0:latency=1/);
});
check('two overlapping voices have separate inputs, sample delays, padding and bounded mix', () => {
  const {project, diagnosis} = fixture(2), timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis, timeline);
  assert.equal(timeline.clips.length, 2); assert.equal(timeline.clips[1].startSamples, 96000);
  assert.equal(args.filter(a => a === '-i').length, 3);
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /\[1:a\].*adelay=48000S/); assert.match(filter, /\[2:a\].*adelay=96000S/);
  assert.match(filter, /\[voice0\]\[voice1\]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0/);
  assert.equal((filter.match(/atrim=end_sample=288000/g) || []).length, 3);
});
check('reused resources keep both dialogue clips and inputs', () => {
  const {project, diagnosis} = fixture(2); project.scene.dialogues[1].voice.resourceId = 'wav0';
  const timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis, timeline);
  assert.equal(timeline.clips[1].dialogueId, 'dialogue1'); assert.equal(args.filter(a => a === diagnosis.resources.wav0.absolute).length, 2);
});
check('voice ending at scene boundary is accepted', () => {
  const {project, diagnosis} = fixture(); project.scene.dialogues[0].startFrame = 120;
  assert.equal(compileAudioTimeline(project, diagnosis).clips[0].startSamples, 192000);
});
check('schema4 rejects legacy voice and accepts one explicit clip independent of subtitle hold',()=>{
  const {project,diagnosis}=fixture();project.schemaVersion=4;
  assert.throws(()=>compileAudioTimeline(project,diagnosis),/schema4 cannot contain legacy voice/);
  const d=project.scene.dialogues[0],voice=d.voice;delete d.voice;d.displayUntilFrame=180;
  d.voiceClips=[{...voice,id:'clip4',sampleRate:48000,sourceOffsetSamples:0,binding:{dialogueId:d.id,mode:'follow',followOffsetFrames:0}}];
  const timeline=compileAudioTimeline(project,diagnosis);assert.equal(timeline.clips.length,1);assert.equal(timeline.clips[0].durationSamples,96000);assert.equal(timeline.clips[0].startSamples,48000);
});
const invalid = [
  ['diagnostic error', (p,d) => { d.hasErrors = true; }, /diagnosis/],
  ['diagnostic error list', (p,d) => { d.diagnostics.push({severity: 'error'}); }, /diagnosis/],
  ['missing resource', (p,d) => { delete d.resources.wav0; }, /48kHz WAV/],
  ['missing file', (p,d) => { d.resources.wav0.exists = false; }, /48kHz WAV/],
  ['not audio', (p,d) => { d.resources.wav0.kind = 'image'; }, /48kHz WAV/],
  ['not WAV', (p,d) => { d.resources.wav0.audio.format = 'mp3'; }, /48kHz WAV/],
  ['wrong rate', (p,d) => { d.resources.wav0.audio.sampleRate = 44100; }, /48kHz WAV/],
  ['channels', (p,d) => { d.resources.wav0.audio.channels = 6; }, /Unsupported/],
  ['bits', (p,d) => { d.resources.wav0.audio.bitsPerSample = 12; }, /Unsupported/],
  ['fractional duration', (p,d) => { d.resources.wav0.audio.durationSamples = 1.5; }, /durationSamples/],
  ['zero duration', (p,d) => { d.resources.wav0.audio.durationSamples = 0; }, /durationSamples/],
  ['voice metadata', p => { p.scene.dialogues[0].voice.durationSamples++; }, /metadata mismatch/],
  ['voice rate metadata', p => { p.scene.dialogues[0].voice.sampleRate = 44100; }, /metadata mismatch/],
  ['resource metadata', (p,d) => { d.resources.wav0.durationSamples = 123; }, /metadata mismatch/],
  ['beyond scene', p => { p.scene.dialogues[0].startFrame = 121; }, /beyond scene/],
  ['negative start', p => { p.scene.dialogues[0].startFrame = -1; }, /frame/],
  ['fractional start', p => { p.scene.dialogues[0].startFrame = 1.5; }, /frame/],
  ['fractional sample start', p => { p.design.fps = 256; p.scene.durationFrames = 768; p.scene.dialogues[0].startFrame = 1; }, /sample boundary/],
  ['fractional scene samples', p => { p.design.fps = 29; }, /sample boundary/],
  ['invalid fps', p => { p.design.fps = Infinity; }, /fps/],
  ['invalid scene frames', p => { p.scene.durationFrames = 1.5; }, /durationFrames/],
  ['unsafe scene samples', p => { p.scene.durationFrames = Number.MAX_SAFE_INTEGER; }, /sample boundary/]
];
for (const [name, mutate, error] of invalid) check(`reject ${name}`, () => {
  const {project, diagnosis} = fixture(); mutate(project, diagnosis);
  assert.throws(() => compileAudioTimeline(project, diagnosis), error);
});
check('argument builder rejects missing input path', () => {
  const {project, diagnosis} = fixture(), timeline = compileAudioTimeline(project, diagnosis);
  delete diagnosis.resources.wav0.absolute;
  assert.throws(() => argsFor(project, diagnosis, timeline), /input path/);
});
function tracksFixture() {
  const f = fixture(2);
  f.project.scene.audioTracks = [
    {id: 'sfx', name: 'Effect', kind: 'sfx', resourceId: 'wav0', startFrame: 0, durationSamples: 96000, gain: 0.25},
    {id: 'bgm', name: 'Music', kind: 'bgm', resourceId: 'wav0', startFrame: 30, durationSamples: 96000, gain: 2}
  ];
  return f;
}
check('independent tracks preserve voices, overlap, reuse resources and apply gain before delay', () => {
  const {project, diagnosis} = tracksFixture(), before = JSON.stringify(project);
  const legacy = fixture(2), voices = compileAudioTimeline(legacy.project, legacy.diagnosis).clips;
  const timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis, timeline);
  assert.deepEqual(timeline.clips.slice(0, 2), voices);
  assert.deepEqual(timeline.clips[2], {id: 'sfx', trackId: 'sfx', resourceId: 'wav0', startSamples: 0, durationSamples: 96000, gain: 0.25});
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.match(filter, /volume=0.25,adelay=0S/); assert.match(filter, /volume=2,adelay=48000S/);
  assert.equal((filter.match(/volume=/g) || []).length, 2);
  assert.equal(JSON.stringify(project), before);
});
check('no-track fixture retains exact timeline and export arguments', () => {
  const {project, diagnosis} = fixture(2), expected = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis);
  project.scene.audioTracks = [];
  assert.deepEqual(compileAudioTimeline(project, diagnosis), expected); assert.deepEqual(argsFor(project, diagnosis), args);
  assert(!args.join(' ').includes('volume='));
});
check('independent-only audio supports mute and exact scene end', () => {
  const {project, diagnosis} = tracksFixture(); project.scene.dialogues = [];
  project.scene.audioTracks = [{...project.scene.audioTracks[0], gain: 0, startFrame: 120}];
  const timeline = compileAudioTimeline(project, diagnosis), args = argsFor(project, diagnosis, timeline);
  assert.equal(timeline.clips[0].startSamples, 192000); assert(args.includes('-c:a')); assert(!args.includes('-an'));
});
for (const gain of [-1, 2.01, NaN, Infinity, -Infinity, '1', undefined, null]) check(`reject track gain ${gain}`, () => {
  const {project, diagnosis} = tracksFixture(); project.scene.audioTracks[0].gain = gain;
  assert.throws(() => compileAudioTimeline(project, diagnosis), /gain/);
});
for (const [name, mutate, error] of [
  ['source overflow', (t,d) => t.durationSamples++, /source range/],
  ['overflow', t => t.startFrame = 121, /beyond scene/],
  ['fractional start', t => t.startFrame = 0.5, /frame/],
  ['kind', t => t.kind = 'voice', /track/],
  ['missing resource', t => t.resourceId = 'missing', /48kHz/],
  ['rate', (t,d) => d.resources.wav0.audio.sampleRate = 44100, /48kHz/]
]) check(`reject independent ${name}`, () => {
  const {project, diagnosis} = tracksFixture(); project.scene.dialogues = [];
  mutate(project.scene.audioTracks[0], diagnosis); assert.throws(() => compileAudioTimeline(project, diagnosis), error);
});
check('trim uses source range then timestamps gain delay; full source metadata stays authoritative',()=>{const {project,diagnosis}=tracksFixture();project.scene.dialogues=[];project.scene.audioTracks=[{...project.scene.audioTracks[0],sourceOffsetSamples:24000,durationSamples:32001,startFrame:150}];diagnosis.resources.wav0.durationSamples=96000;const before=JSON.stringify(project),t=compileAudioTimeline(project,diagnosis);assert.equal(t.clips[0].sourceOffsetSamples,24000);assert.equal(t.clips[0].durationSamples,32001);const args=argsFor(project,diagnosis,t);assert.match(args[args.indexOf('-filter_complex')+1],/atrim=start_sample=24000:end_sample=56001,asetpts=PTS-STARTPTS,volume=0.25,adelay=240000S/);assert.equal(JSON.stringify(project),before);for(const bad of [null,-1,0.5,'0',Infinity,Number.MAX_SAFE_INTEGER]){project.scene.audioTracks[0].sourceOffsetSamples=bad;assert.throws(()=>compileAudioTimeline(project,diagnosis),/source range/);}project.scene.audioTracks[0].sourceOffsetSamples=24000;diagnosis.resources.wav0.durationSamples=96001;assert.throws(()=>compileAudioTimeline(project,diagnosis),/metadata mismatch/);});
check('explicit voice effective start and source trim produce one clip independent of subtitle and pages',()=>{const {project:p,diagnosis:d}=fixture();const line=p.scene.dialogues[0],v=line.voice;Object.assign(v,{binding:{dialogueId:line.id,mode:'independent'},startFrame:90,sourceOffsetSamples:24000,durationSamples:48001,sourceDurationSamples:96000});let t=compileAudioTimeline(p,d);assert.equal(t.clips.length,1);assert.equal(t.clips[0].startSamples,144000);assert.equal(t.clips[0].durationSamples,48001);const args=argsFor(p,d,t);assert.equal(args.filter(a=>a==='-i').length,2);assert.match(args[args.indexOf('-filter_complex')+1],/atrim=start_sample=24000:end_sample=72001,asetpts=PTS-STARTPTS,adelay=144000S/);line.startFrame=0;assert.equal(compileAudioTimeline(p,d).clips[0].startSamples,144000);v.binding={dialogueId:line.id,mode:'follow',followOffsetFrames:15};assert.equal(compileAudioTimeline(p,d).clips[0].startSamples,24000);v.sourceOffsetSamples=0;assert.match(argsFor(p,d).join(' '),/atrim=start_sample=0:end_sample=48001/);for(const bad of [null,-1,1.5,'0',Infinity]){v.sourceOffsetSamples=bad;assert.throws(()=>compileAudioTimeline(p,d));}v.sourceOffsetSamples=0;v.sourceDurationSamples=96001;assert.throws(()=>compileAudioTimeline(p,d),/metadata mismatch/);v.sourceDurationSamples=96000;v.binding.dialogueId='bad';assert.throws(()=>compileAudioTimeline(p,d),/binding/);});
check('video own audio exact diagnosis and silent overlap retain ordinary voice/source offset/C fade',()=>{
  const {project:p,diagnosis:d}=fixture();p.schemaVersion=4;
  const line=p.scene.dialogues[0];delete line.voice;line.startFrame=0;
  line.voiceClips=[{id:'ordinary',resourceId:'wav0',sampleRate:48000,sourceOffsetSamples:123,durationSamples:48000,binding:{dialogueId:line.id,mode:'follow'}}];
  p.scene.videoClips=[{id:'insert',resourceId:'video',startFrame:30,endFrame:90}];
  p.resources=[{id:'video',kind:'video',mime:'video/mp4',width:640,height:360,fps:30,frameCount:60,normalizationVersion:1,audioResourceId:'own'},{id:'own',kind:'audio',sampleRate:48000,durationSamples:96000}];
  d.resources.own={kind:'audio',exists:true,absolute:'own.wav',audio:{format:'wav',sampleRate:48000,channels:2,bitsPerSample:16,durationSamples:96000}};
  p.scene.audioTracks=[{id:'fade',name:'BGM',kind:'bgm',resourceId:'wav0',startFrame:90,sourceOffsetSamples:123,durationSamples:48000,gain:.5,fadeOutSamples:24000}];
  const before=JSON.stringify(p),timeline=compileAudioTimeline(p,d);assert.equal(timeline.clips.length,3);assert.equal(timeline.clips[0].sourceOffsetSamples,123);assert.equal(timeline.clips[1].fadeOutSamples,24000);assert.equal(timeline.clips[2].sourceOffsetSamples,0);
  assert.match(argsFor(p,d).join(' '),/afade=t=out:start_sample=24000:nb_samples=24000/);assert.equal(JSON.stringify(p),before);
  for(const patch of [{durationSamples:96001},{channels:1},{bitsPerSample:24},{format:'mp3'},{formatTag:3},{sampleRate:44100}]) {const original=d.resources.own.audio;d.resources.own.audio={...original,...patch};assert.throws(()=>compileAudioTimeline(p,d),/normalized video WAV/);d.resources.own.audio=original;}
  delete p.resources[0].audioResourceId;assert.equal(compileAudioTimeline(p,d).clips.length,2);
  line.voiceClips[0].durationSamples++;assert.throws(()=>compileAudioTimeline(p,d),/overlaps video/);
});
console.log(JSON.stringify({status: 'PASS', checks}));
