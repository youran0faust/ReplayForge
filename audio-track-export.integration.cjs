'use strict';
// Real audio-only FFmpeg check using the production export graph without AAC loss.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {compileAudioTimeline, buildFfmpegArgs} = require('./core/audio-timeline.cjs');
const ffmpeg = process.env.FFMPEG_PATH || path.resolve(__dirname, '../p0/tools/ffmpeg.exe');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-track-export-'));
try {
  const tone = path.join(dir, 'tone.wav'), count = 24000, bytes = Buffer.alloc(44 + count * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40);
  // Nonzero first sample makes exact onset/end boundaries observable.
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(4000 * Math.cos(2 * Math.PI * 1000 * i / 48000)), 44 + i * 2);
  fs.writeFileSync(tone, bytes);
  const diagnosis = {hasErrors: false, resources: {tone: {kind: 'audio', exists: true, absolute: tone,
    audio: {format: 'wav', sampleRate: 48000, channels: 1, bitsPerSample: 16, durationSamples: count}}}};
  function render(name, tracks) {
    const project = {design: {fps: 30}, scene: {durationFrames: 90, dialogues: [], audioTracks: tracks.map((t, i) => ({
      id: `t${i}`, name: `Tone ${i}`, kind: i % 2 ? 'bgm' : 'sfx', resourceId: 'tone', durationSamples: count, ...t
    }))}};
    const timeline = compileAudioTimeline(project, diagnosis);
    const production = buildFfmpegArgs({project, timeline, resources: diagnosis.resources, framesPattern: 'unused', outputPath: 'unused'});
    // Video input omitted: shift production audio input labels down by one.
    const filter = production[production.indexOf('-filter_complex') + 1].replace(/\[(\d+):a\]/g, (_, n) => `[${Number(n) - 1}:a]`);
    const out = path.join(dir, `${name}.f32`), args = ['-y', '-v', 'error'];
    for (const clip of timeline.clips) args.push('-i', diagnosis.resources[clip.resourceId].absolute);
    args.push('-filter_complex', filter, '-map', '[a]', '-c:a', 'pcm_f32le', '-f', 'f32le', out);
    const result = spawnSync(ffmpeg, args, {stdio: 'inherit', windowsHide: true});
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'FFmpeg failed');
    const data = fs.readFileSync(out);
    assert.equal(data.length, timeline.durationSamples * 2 * 4, 'full scene stereo PCM length');
    return Array.from({length: timeline.durationSamples}, (_, i) => data.readFloatLE(i * 8));
  }
  const unity = render('unity', [{startFrame: 30, gain: 1}]);
  const quarter = render('quarter', [{startFrame: 30, gain: 0.25}]);
  const mute = render('mute', [{startFrame: 30, gain: 0}]);
  const overlap = render('overlap', [{startFrame: 30, gain: 0.25}, {startFrame: 30, gain: 1}]);
  function rms(samples) { return Math.sqrt(samples.slice(49000, 71000).reduce((sum, v) => sum + v * v, 0) / 22000); }
  for (const samples of [unity, quarter, overlap]) {
    assert.equal(samples.findIndex(v => Math.abs(v) > 1e-8), 48000, 'sample-accurate delayed onset');
    assert(samples.slice(0, 48000).every(v => v === 0));
    assert(samples.slice(72000).every(v => v === 0), 'full source ends without looping');
  }
  assert(mute.every(v => v === 0));
  const quarterRatio = rms(quarter) / rms(unity), overlapRatio = rms(overlap) / rms(unity);
  assert(Math.abs(quarterRatio - 0.25) < 1e-6);
  assert(Math.abs(overlapRatio - 1.25) < 1e-6);
  console.log(JSON.stringify({status: 'PASS', sampleRate: 48000, durationSamples: unity.length, onsetSample: 48000, quarterRatio, overlapRatio}));
} finally {
  fs.rmSync(dir, {recursive: true, force: true});
}
