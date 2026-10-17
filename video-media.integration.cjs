'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { normalizeVideo } = require('./core/video-media.cjs');
async function main() {
  const root = path.resolve(__dirname, '../test-output/P2', `d-video-media-${randomUUID()}`);
  fs.mkdirSync(root, { recursive: true });
  const ffmpegPath = path.resolve(__dirname, '../p0/tools/ffmpeg.exe'), ffprobePath = path.resolve(__dirname, '../p0/tools/ffprobe.exe');
  const checks = [], outputs = [];
  function run(args, name) {
    const fd = fs.openSync(path.join(root, name + '.log'), 'wx');
    try { const r = spawnSync(ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-n', ...args], { stdio: ['ignore', fd, fd], timeout: 90000 }); if (r.error) throw r.error; assert.equal(r.status, 0, name); } finally { fs.closeSync(fd); }
  }
  function dir(name) { const d = path.join(root, name); fs.mkdirSync(d); return d; }
  async function normalize(sourceFile, name, check) { return normalizeVideo({ sourceFile, outputDirectory: dir(name), ffmpegPath, ffprobePath, check }); }
  function pcm(file) { const b = fs.readFileSync(file); for (let p = 12; p + 8 <= b.length;) { const n = b.readUInt32LE(p + 4); if (b.toString('ascii', p, p + 4) === 'data') return b.subarray(p + 8, p + 8 + n); p += 8 + n + n % 2; } throw Error('no PCM'); }
  const landscape = path.join(root, 'landscape.mp4');
  run(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', landscape], 'landscape-fixture');
  const a = await normalize(landscape, 'landscape'); outputs.push(a);
  assert.equal(a.video.frameCount, 90); assert.equal(a.video.width / a.video.height, 16 / 9); assert.equal(a.audio.durationSamples, 144000); assert.equal(pcm(a.audio.file).length, 576000); checks.push('landscape 24fps -> 30fps, silent video + exact stereo PCM');
  const portrait = path.join(root, 'portrait.mp4');
  run(['-f', 'lavfi', '-i', 'testsrc2=s=180x320:r=30:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', portrait], 'portrait-fixture');
  const b = await normalize(portrait, 'portrait'); outputs.push(b); assert.equal(b.audio, null); assert(b.video.width < b.video.height); assert.equal(b.video.frameCount, 90); checks.push('portrait/no audio');
  const rotated = path.join(root, 'rotated.mp4');
  run(['-display_rotation:v:0', '90', '-i', landscape, '-c', 'copy', rotated], 'rotation-fixture');
  const rotation = await normalize(rotated, 'rotated'); outputs.push(rotation); assert(rotation.video.width < rotation.video.height); checks.push('rotation metadata baked into portrait pixels');
  const multi = path.join(root, 'multi.mp4');
  run(['-i', landscape, '-map', '0:v', '-map', '0:v', '-c', 'copy', multi], 'multi-fixture');
  await assert.rejects(normalize(multi, 'multi'), /streams/); checks.push('multiple video streams rejected');
  const external = path.join(root, 'external.mp4'), externalBytes = fs.readFileSync(landscape);
  const urlAt = externalBytes.indexOf(Buffer.from('url ')); assert(urlAt > 0); externalBytes.writeUInt32BE(0, urlAt + 4); fs.writeFileSync(external, externalBytes);
  await assert.rejects(normalize(external, 'external'), /external MP4/); checks.push('external MP4 data references rejected before FFmpeg');
  for (const [name, videoOffset, audioOffset] of [['audio-late', 2, 3], ['audio-early', 3, 2]]) {
    const source = path.join(root, name + '.mp4');
    run(['-f', 'lavfi', '-i', 'color=s=320x180:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=700:sample_rate=48000:duration=3', '-filter_complex', `[0:v]setpts=PTS+${videoOffset}/TB[v];[1:a]asetpts=PTS+${audioOffset}/TB[a]`, '-map', '[v]', '-map', '[a]', '-fps_mode', 'passthrough', '-c:v', 'libx264', '-c:a', 'aac', '-copyts', source], name + '-fixture');
    const r = await normalize(source, name); outputs.push(r); const raw = pcm(r.audio.file);
    function power(start, count) { let sum = 0; for (let i = start; i < start + count; i++) sum += Math.abs(raw.readInt16LE(i * 4)); return sum / count; }
    if (name === 'audio-late') { assert.equal(power(1000, 24000), 0); assert(power(60000, 12000) > 100); }
    else { assert(power(1000, 12000) > 100); assert.equal(power(120000, 12000), 0); }
    assert.equal(r.audio.durationSamples, r.video.frameCount * 1600); checks.push(name + ' nonzero PTS waveform offset verified');
  }
  const corrupt = path.join(root, 'corrupt.mp4'); fs.writeFileSync(corrupt, Buffer.from('0000ftypisomCORRUPT'));
  await assert.rejects(normalize(corrupt, 'corrupt')); assert.deepEqual(fs.readdirSync(path.join(root, 'corrupt')), []); checks.push('corrupt container rejection and cleanup');
  const oversized = path.join(root, 'oversized.mp4'); const large = fs.openSync(oversized, 'wx'); fs.ftruncateSync(large, 256 * 1024 * 1024 + 1); fs.closeSync(large);
  await assert.rejects(normalize(oversized, 'oversized'), /size budget/); fs.unlinkSync(oversized); checks.push('256MiB source budget');
  let cancelled = false;
  const cancellation = new Error('integration cancellation');
  await assert.rejects(normalize(landscape, 'cancel', async () => { await Promise.resolve(); const d = path.join(root, 'cancel'); if (fs.existsSync(path.join(d, 'output.mp4'))) { cancelled = true; throw cancellation; } }), e => e === cancellation);
  assert(cancelled); assert.deepEqual(fs.readdirSync(path.join(root, 'cancel')), []); checks.push('async in-process cancellation/owned-file cleanup');
  const report = { status: 'PASS', root, checks, outputs }; fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
