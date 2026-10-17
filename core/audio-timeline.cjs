'use strict';
const {audioEnvelopeErrors, envelopeAtSample} = require('./audio-envelope.cjs');
const {videoIntervals, videoAudioClips, validateNoAudioOverlap} = require('./video-audio-policy.cjs');
const SAMPLE_RATE = 48000;
const VOICE_POLICY = 'full-voice-from-dialogue-start';
const MIX_POLICY = 'unity-gain-sum; normalize=0; limiter=0.95; auto-level=off; latency-compensated';
function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw Error(`Invalid ${name}: expected positive safe integer`);
}
function frameSamples(frame, fps, name) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw Error(`Invalid ${name} frame`);
  const samples = frame * SAMPLE_RATE / fps;
  if (!Number.isSafeInteger(samples)) throw Error(`Non-integral or unsafe sample boundary: ${name}`);
  return samples;
}
// Pure: consumes diagnosed WAV facts; never reads files or mutates the project.
// WAV facts do not include formatTag: codec/header integrity remains diagnosis/decoder responsibility.
// Dialogue endFrame does not truncate voice. The entire WAV must fit the scene.
function compileAudioTimeline(project, diagnosis) {
  if (!diagnosis || diagnosis.hasErrors || diagnosis.diagnostics?.some(d => d.severity === 'error')) throw Error('Resource diagnosis contains errors or is missing');
  const envelopeErrors = audioEnvelopeErrors(project);
  if (envelopeErrors.length) throw Error(envelopeErrors.join('; '));
  const fps = project?.design?.fps;
  if (!Number.isFinite(fps) || fps <= 0) throw Error('Invalid fps');
  positiveInteger(project?.scene?.durationFrames, 'scene durationFrames');
  const durationSamples = frameSamples(project.scene.durationFrames, fps, 'scene');
  positiveInteger(durationSamples, 'scene durationSamples');
  const clips = [], clipIds = new Set();
  for (const dialogue of project.scene.dialogues || []) {
    if (dialogue.voice !== undefined && dialogue.voiceClips !== undefined) throw Error('Ambiguous voice representations');
    if (dialogue.voiceClips !== undefined && (![2, 3, 4].includes(project.schemaVersion) || !Array.isArray(dialogue.voiceClips))) throw Error('Invalid voiceClips schema');
    if ([2, 3, 4].includes(project.schemaVersion) && dialogue.voice !== undefined) throw Error(`schema${project.schemaVersion} cannot contain legacy voice`);
    const voiceIds = clipIds;
    for (const voice of dialogue.voiceClips || (dialogue.voice ? [dialogue.voice] : [])) {
    if (dialogue.voiceClips !== undefined) {
      if (!voice || typeof voice.id !== 'string' || !voice.id || voiceIds.has(voice.id) || voice.sampleRate !== SAMPLE_RATE || !voice.binding) throw Error('Invalid voice clip');
      voiceIds.add(voice.id);
    }
    const resource = diagnosis.resources?.[voice.resourceId], audio = resource?.audio;
    if (!resource || resource.kind !== 'audio' || resource.exists !== true || !audio || audio.format !== 'wav' || audio.sampleRate !== SAMPLE_RATE) throw Error(`Requires diagnosed 48kHz WAV: ${voice.resourceId}`);
    if (![1, 2].includes(audio.channels) || ![8, 16, 24, 32].includes(audio.bitsPerSample)) throw Error('Unsupported WAV channels or bit depth');
    positiveInteger(audio.durationSamples, 'WAV durationSamples');
    positiveInteger(voice.durationSamples, 'voice durationSamples');
    const explicit = voice.binding !== undefined;
    let voiceStart = dialogue.startFrame, sourceOffsetSamples = 0;
    if (explicit) {
      if (voice.sourceDurationSamples !== undefined && voice.sourceDurationSamples !== audio.durationSamples) throw Error('Voice source duration metadata mismatch');
      const b = voice.binding;
      if (!b || b.dialogueId !== dialogue.id || !['follow', 'independent'].includes(b.mode)) throw Error('Invalid voice binding');
      const offset = b.followOffsetFrames === undefined ? 0 : b.followOffsetFrames;
      if (!Number.isSafeInteger(offset)) throw Error('Invalid voice follow offset');
      voiceStart = b.mode === 'follow' ? dialogue.startFrame + offset : voice.startFrame;
      sourceOffsetSamples = voice.sourceOffsetSamples === undefined ? 0 : voice.sourceOffsetSamples;
      if (!Number.isSafeInteger(sourceOffsetSamples) || sourceOffsetSamples < 0 || !Number.isSafeInteger(sourceOffsetSamples + voice.durationSamples) || sourceOffsetSamples + voice.durationSamples > audio.durationSamples) throw Error('Voice source range invalid');
    }
    if ((!explicit && voice.durationSamples !== audio.durationSamples) ||
        (voice.sampleRate != null && voice.sampleRate !== SAMPLE_RATE) ||
        (resource.sampleRate != null && resource.sampleRate !== SAMPLE_RATE) ||
        (resource.durationSamples != null && resource.durationSamples !== audio.durationSamples)) throw Error(`Voice metadata mismatch: ${voice.resourceId}`);
    const startSamples = frameSamples(voiceStart, fps, `dialogue ${dialogue.id}`);
    if (!Number.isSafeInteger(startSamples + voice.durationSamples) || startSamples + voice.durationSamples > durationSamples) throw Error(`Voice extends beyond scene: ${dialogue.id}`);
    clips.push({id: voice.id || dialogue.id, dialogueId: dialogue.id, ...(dialogue.voiceClips ? {clipId: voice.id} : {}), resourceId: voice.resourceId, startSamples, durationSamples: voice.durationSamples, ...(explicit ? {sourceOffsetSamples} : {})});
    }
  }
  if (project.scene.audioTracks !== undefined && !Array.isArray(project.scene.audioTracks)) throw Error('Invalid audioTracks: expected array');
  const trackIds = new Set();
  for (const track of project.scene.audioTracks || []) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) throw Error('Invalid or duplicate audio track id');
    trackIds.add(track.id);
    if (typeof track.name !== 'string' || !['sfx', 'bgm'].includes(track.kind)) throw Error(`Invalid audio track: ${track.id}`);
    if (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2) throw Error(`Invalid audio track gain: ${track.id}`);
    const resource = diagnosis.resources?.[track.resourceId], audio = resource?.audio;
    if (!resource || resource.kind !== 'audio' || resource.exists !== true || !audio || audio.format !== 'wav' || audio.sampleRate !== SAMPLE_RATE) throw Error(`Requires diagnosed 48kHz WAV: ${track.resourceId}`);
    if (![1, 2].includes(audio.channels) || ![8, 16, 24, 32].includes(audio.bitsPerSample)) throw Error('Unsupported WAV channels or bit depth');
    positiveInteger(audio.durationSamples, 'WAV durationSamples');
    positiveInteger(track.durationSamples, 'audio track durationSamples');
    const sourceOffsetSamples = track.sourceOffsetSamples === undefined ? 0 : track.sourceOffsetSamples;
    if (!Number.isSafeInteger(sourceOffsetSamples) || sourceOffsetSamples < 0 || !Number.isSafeInteger(sourceOffsetSamples + track.durationSamples) || sourceOffsetSamples + track.durationSamples > audio.durationSamples) throw Error(`Audio track source range invalid: ${track.id}`);
    if ((resource.sampleRate != null && resource.sampleRate !== SAMPLE_RATE) ||
        (resource.durationSamples != null && resource.durationSamples !== audio.durationSamples)) throw Error(`Audio track metadata mismatch: ${track.resourceId}`);
    const startSamples = frameSamples(track.startFrame, fps, `audio track ${track.id}`);
    if (!Number.isSafeInteger(startSamples + track.durationSamples) || startSamples + track.durationSamples > durationSamples) throw Error(`Audio track extends beyond scene: ${track.id}`);
    clips.push({id: track.id, trackId: track.id, resourceId: track.resourceId, startSamples, durationSamples: track.durationSamples, ...(sourceOffsetSamples ? {sourceOffsetSamples} : {}), gain: track.gain, ...(track.fadeOutSamples ? {fadeOutSamples: track.fadeOutSamples} : {})});
  }
  const intervals = videoIntervals(project);
  if (intervals.length) validateNoAudioOverlap(clips, intervals);
  for (const clip of videoAudioClips(project)) {
    const resource = diagnosis.resources?.[clip.resourceId], audio = resource?.audio;
    if (!resource || resource.kind !== 'audio' || resource.exists !== true || !audio || audio.format !== 'wav' || audio.sampleRate !== SAMPLE_RATE || audio.channels !== 2 || audio.bitsPerSample !== 16 || audio.durationSamples !== clip.durationSamples || (audio.formatTag !== undefined && audio.formatTag !== 1) || (audio.blockAlign !== undefined && audio.blockAlign !== 4)) throw Error(`Invalid diagnosed normalized video WAV: ${clip.resourceId}`);
    if ((resource.sampleRate !== undefined && resource.sampleRate !== SAMPLE_RATE) || (resource.durationSamples !== undefined && resource.durationSamples !== audio.durationSamples)) throw Error(`Video WAV metadata mismatch: ${clip.resourceId}`);
    clips.push(clip);
  }
  return {sampleRate: SAMPLE_RATE, durationSamples, policy: VOICE_POLICY, mixPolicy: MIX_POLICY, clips};
}
// Each clip has its own input, even when several dialogues use the same WAV.
// Stereo conversion gives mixed mono/stereo inputs a stable layout.
function buildFfmpegArgs({project, timeline, resources, framesPattern, outputPath}) {
  const args = ['-y', '-framerate', String(project.design.fps), '-i', framesPattern];
  for (const clip of timeline.clips) {
    const absolute = resources?.[clip.resourceId]?.absolute;
    if (typeof absolute !== 'string' || !absolute) throw Error(`Missing audio input path: ${clip.resourceId}`);
    args.push('-i', absolute);
  }
  if (timeline.clips.length) {
    const filters = timeline.clips.map((clip, index) => {
      if (clip.trackId !== undefined && (!Number.isFinite(clip.gain) || clip.gain < 0 || clip.gain > 2)) throw Error(`Invalid audio track gain: ${clip.trackId}`);
      if (Object.hasOwn(clip, 'fadeOutSamples')) {
        if (clip.trackId === undefined) throw Error('Fade requires an audio track');
        envelopeAtSample(clip.durationSamples, clip.fadeOutSamples, 0);
      }
      const fade = clip.fadeOutSamples ? `afade=t=out:start_sample=${clip.durationSamples - clip.fadeOutSamples}:nb_samples=${clip.fadeOutSamples}:curve=tri,` : '';
      const volume = clip.trackId !== undefined ? `volume=${clip.gain},` : '';
      const offset = clip.sourceOffsetSamples === undefined ? 0 : clip.sourceOffsetSamples;
      if ((clip.trackId !== undefined || Object.hasOwn(clip, 'sourceOffsetSamples')) && (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(clip.durationSamples) || clip.durationSamples <= 0 || !Number.isSafeInteger(offset + clip.durationSamples))) throw Error('Invalid audio source trim');
      const trim = (clip.trackId !== undefined || Object.hasOwn(clip, 'sourceOffsetSamples')) ? `atrim=start_sample=${offset}:end_sample=${offset + clip.durationSamples},` : '';
      return `[${index + 1}:a]aformat=sample_rates=48000:channel_layouts=stereo,${trim}asetpts=PTS-STARTPTS,${volume}${fade}adelay=${clip.startSamples}S:all=1,apad,atrim=end_sample=${timeline.durationSamples}[voice${index}]`;
    });
    const labels = timeline.clips.map((_, index) => `[voice${index}]`).join('');
    filters.push(`${labels}amix=inputs=${timeline.clips.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0:latency=1,apad,atrim=end_sample=${timeline.durationSamples}[a]`);
    args.push('-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[a]');
  } else args.push('-map', '0:v:0', '-an');
  args.push('-frames:v', String(project.scene.durationFrames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p');
  if (timeline.clips.length) args.push('-c:a', 'aac', '-ar', String(SAMPLE_RATE), '-ac', '2');
  args.push('-movflags', '+faststart', outputPath);
  return args;
}
module.exports = {SAMPLE_RATE, VOICE_POLICY, MIX_POLICY, compileAudioTimeline, buildFfmpegArgs};
