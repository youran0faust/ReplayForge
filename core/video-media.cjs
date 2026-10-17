'use strict';
const fs = require('node:fs'), fsp = fs.promises, path = require('node:path');
const { createHash } = require('node:crypto'), { spawn } = require('node:child_process');
const fail = message => { throw new Error(`video-media: ${message}`); };
const sig = s => [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':');
const num = (v, name) => { if (v === undefined || v === null || v === '' || !Number.isFinite(Number(v))) fail(`invalid ${name}`); return Number(v); };
async function ordinary(file, directory = false) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('absolute ordinary path required');
  const p = path.resolve(file), root = path.parse(p).root, parts = p.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    const s = await fsp.lstat(current);
    if (s.isSymbolicLink() || ((i < parts.length - 1 || directory) ? !s.isDirectory() : !s.isFile())) fail('symlink/nonordinary path');
  }
  return fsp.stat(p);
}
// Synchronous structural gate, not a codec/metadata probe. Success returns undefined.
// Shared by normalization and consumers of untrusted project JSON.
function assertSelfContainedMp4(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('absolute ordinary path required');
  const p = path.resolve(file), root = path.parse(p).root, parts = p.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  for (let i = -1; i < parts.length; i++) {
    if (i >= 0) current = path.join(current, parts[i]);
    const s = fs.lstatSync(current);
    if (s.isSymbolicLink() || (i < parts.length - 1 ? !s.isDirectory() : !s.isFile())) fail('symlink/nonordinary path');
  }
  if (path.extname(file).toLowerCase() !== '.mp4') fail('source must be .mp4');
  const stat = fs.statSync(file);
  if (stat.size > 256 * 1024 * 1024 || stat.size < 12) fail('source size budget');
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(12);
    if (fs.readSync(fd, header, 0, 12, 0) !== 12 || header.toString('ascii', 4, 8) !== 'ftyp') fail('not an MP4 container');
    let atomCount = 0;
    function walk(start, end, depth = 0) {
      if (depth > 16) fail('MP4 nesting budget');
      for (let pos = start; pos < end;) {
        if (++atomCount > 100000 || end - pos < 8) fail('invalid MP4 atom budget');
        const b = Buffer.alloc(16), nread = Math.min(16, end - pos);
        if (fs.readSync(fd, b, 0, nread, pos) !== nread) fail('truncated MP4 atom');
        let size = b.readUInt32BE(0), headerSize = 8; const type = b.toString('ascii', 4, 8);
        if (size === 1) { if (nread < 16) fail('truncated MP4 extended atom'); const big = b.readBigUInt64BE(8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail('MP4 atom too large'); size = Number(big); headerSize = 16; }
        if (size === 0) size = end - pos;
        if (size < headerSize || pos + size > end) fail('invalid MP4 atom');
        if (['moov', 'trak', 'mdia', 'minf', 'dinf'].includes(type)) walk(pos + headerSize, pos + size, depth + 1);
        if (type === 'dref') {
          if (size < headerSize + 8) fail('invalid dref');
          if (size - headerSize > 1024 * 1024) fail('dref budget');
          const entries = Buffer.alloc(size - headerSize);
          if (fs.readSync(fd, entries, 0, entries.length, pos + headerSize) !== entries.length) fail('truncated dref');
          const count = entries.readUInt32BE(4); let at = 8;
          for (let i = 0; i < count; i++) {
            if (at + 12 > entries.length) fail('invalid data reference');
            const n = entries.readUInt32BE(at), tag = entries.toString('ascii', at + 4, at + 8), flags = entries.readUInt32BE(at + 8) & 0xffffff;
            if (n !== 12 || at + n > entries.length || tag !== 'url ' || flags !== 1) fail('external MP4 data reference forbidden');
            at += n;
          }
          if (at !== entries.length) fail('invalid data references');
        }
        pos += size;
      }
    }
    walk(0, stat.size);
    if (sig(fs.fstatSync(fd)) !== sig(stat) || sig(fs.lstatSync(file)) !== sig(stat)) fail('source changed');
  } finally { fs.closeSync(fd); }
}
async function normalizeVideo({ sourceFile, outputDirectory, ffmpegPath, ffprobePath, check = () => {} }) {
  const deadline = Date.now() + 90000, owned = new Set(), logs = new Set();
  let sourceStat, outputStat, sequence = 0;
  const identities = new Map();
  const sameIdentity = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
  async function sameOutputDirectory() {
    try { return sameIdentity(await ordinary(outputDirectory, true), outputStat); } catch { return false; }
  }
  async function checked() {
    let timer;
    try {
      await Promise.race([Promise.resolve().then(check), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('video-media: 90s timeout')), Math.max(1, deadline - Date.now()));
      })]);
    } finally { clearTimeout(timer); }
  }
  async function guard() {
    if (Date.now() > deadline) fail('90s timeout');
    await checked();
    if (Date.now() > deadline) fail('90s timeout');
    if (sourceStat && sig(await ordinary(sourceFile)) !== sig(sourceStat)) fail('source changed');
    if (!await sameOutputDirectory()) fail('output directory identity changed');
    let total = 0;
    for (const name of await fsp.readdir(outputDirectory)) {
      const file = path.join(outputDirectory, name);
      if (!owned.has(file)) fail('unexpected output file');
      const s = await fsp.lstat(file);
      if (!s.isFile() || s.isSymbolicLink()) fail('nonordinary output');
      if (!sameIdentity(s, identities.get(file))) fail('output file identity changed');
      total += s.size;
      if (logs.has(file) && s.size > 1024 * 1024) fail('probe/log exceeds 1MiB');
    }
    if (total > 512 * 1024 * 1024) fail('output exceeds 512MiB');
  }
  async function hash(file) {
    const h = createHash('sha256'), fd = await fsp.open(file, 'r'), b = Buffer.alloc(1024 * 1024);
    try { let pos = 0; for (;;) { await guard(); const { bytesRead } = await fd.read(b, 0, b.length, pos); if (!bytesRead) break; h.update(b.subarray(0, bytesRead)); pos += bytesRead; } }
    finally { await fd.close(); }
    return h.digest('hex');
  }
  async function reserve(name) {
    const file = path.join(outputDirectory, name), fd = await fsp.open(file, 'wx');
    owned.add(file); identities.set(file, await fd.stat()); logs.add(file); return { file, fd };
  }
  async function run(exe, args) {
    await guard();
    const out = await reserve(`process-${++sequence}.json`), err = await reserve(`process-${sequence}.log`);
    try {
      await new Promise((resolve, reject) => {
        let child, failure, busy = false, polling = Promise.resolve();
        try { child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', out.fd.fd, err.fd.fd] }); }
        catch (e) { reject(e); return; }
        const stop = e => { failure ||= e; if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
        const timer = setInterval(async () => {
          if (Date.now() > deadline) { stop(new Error('video-media: 90s timeout')); return; }
          if (busy || failure) return;
          busy = true;
          polling = guard().catch(stop).finally(() => { busy = false; });
          await polling;
        }, 100);
        child.once('error', stop);
        child.once('close', async code => {
          clearInterval(timer);
          try { await polling; if (failure) throw failure; await guard(); if (code !== 0) fail(`subprocess failed (${code}): ${(await fsp.readFile(err.file, 'utf8')).slice(-3000)}`); resolve(); }
          catch (e) { reject(failure || e); }
        });
      });
    } finally { await out.fd.close(); await err.fd.close(); }
    await guard();
    const text = await fsp.readFile(out.file, 'utf8');
    for (const item of [out, err]) {
      if (!await sameOutputDirectory() || !sameIdentity(await fsp.lstat(item.file), identities.get(item.file))) fail('output identity changed before log cleanup');
      await fsp.unlink(item.file); owned.delete(item.file); logs.delete(item.file); identities.delete(item.file);
    }
    return text;
  }
  const input = file => ['-protocol_whitelist', 'file', '-format_whitelist', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0', '-i', file];
  async function probe(file, count = false) { return JSON.parse(await run(ffprobePath, ['-v', 'error', ...(count ? ['-count_frames'] : []), ...input(file), '-show_format', '-show_streams', '-of', 'json'])); }
  async function output(name) {
    const file = path.join(outputDirectory, name);
    try { await fsp.lstat(file); fail('output exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const fd = await fsp.open(file, 'wx');
    try { owned.add(file); identities.set(file, await fd.stat()); } finally { await fd.close(); }
    return file;
  }
  try {
    if (typeof check !== 'function') fail('check must be a function');
    await checked(); sourceStat = await ordinary(sourceFile);
    outputStat = await ordinary(outputDirectory, true);
    if ((await fsp.readdir(outputDirectory)).length) fail('outputDirectory must be empty');
    await ordinary(ffmpegPath); await ordinary(ffprobePath);
    assertSelfContainedMp4(sourceFile);
    await guard();
    const before = await hash(sourceFile), p = await probe(sourceFile);
    if (!p.format?.format_name?.split(',').includes('mp4')) fail('not mov/mp4');
    const streams = p.streams || [], videos = streams.filter(s => s.codec_type === 'video'), audios = streams.filter(s => s.codec_type === 'audio');
    if (videos.length !== 1 || audios.length > 1 || streams.some(s => !['video', 'audio'].includes(s.codec_type)) || videos[0].disposition?.attached_pic) fail('unsupported streams/attached picture');
    const v = videos[0], duration = num(p.format.duration, 'duration');
    if (duration <= 0 || duration > 60 || num(v.duration, 'video duration') > 60) fail('duration exceeds 60s');
    const w = num(v.width, 'width'), h = num(v.height, 'height');
    if (w <= 0 || h <= 0 || w * h > 4096 * 2160 || w > 4096 || h > 4096) fail('source pixel budget');
    const videoStart = num(v.start_time, 'video start_time');
    // Autorotation precedes the filter; dar includes source SAR. Reset the origin before FPS sampling.
    const vf = "setpts=PTS-STARTPTS,fps=30,scale=w='max(2,trunc(min(1920,1080*dar)/2)*2)':h='max(2,trunc(min(1080,1920/dar)/2)*2)',setsar=1,setpts=PTS-STARTPTS";
    const videoFile = await output('output.mp4');
    await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-xerror', ...input(sourceFile), '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '1', '-bf', '0', '-frames:v', '1801', '-movflags', '+faststart', '-map_metadata', '-1', videoFile]);
    const normalized = await probe(videoFile, true), nv = normalized.streams?.[0], frameCount = num(nv?.nb_read_frames, 'decoded frame count');
    if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 1800 || normalized.streams.length !== 1 || nv.codec_type !== 'video' || nv.width > 1920 || nv.height > 1080 || nv.width % 2 || nv.height % 2 || nv.sample_aspect_ratio !== '1:1' || nv.avg_frame_rate !== '30/1') fail('invalid normalized video/count budget');
    // Decode every output frame strictly, in addition to count_frames.
    await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-err_detect', 'explode', ...input(videoFile), '-map', '0:v:0', '-an', '-f', 'null', '-']);
    let audio = null;
    if (audios.length) {
      const offset = Math.round((num(audios[0].start_time, 'audio start_time') - videoStart) * 48000);
      if (Math.abs(offset) > 60 * 48000) fail('audio offset budget');
      const durationSamples = frameCount * 1600, audioFile = await output('audio.wav');
      const af = ['aresample=48000', 'asetpts=PTS-STARTPTS', ...(offset < 0 ? [`atrim=start_sample=${-offset}`, 'asetpts=PTS-STARTPTS'] : offset > 0 ? [`adelay=${offset}S:all=1`] : []), `apad=whole_len=${durationSamples}`, `atrim=end_sample=${durationSamples}`, 'asetpts=PTS-STARTPTS'].join(',');
      await run(ffmpegPath, ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-xerror', ...input(sourceFile), '-map', '0:a:0', '-vn', '-sn', '-dn', '-af', af, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-map_metadata', '-1', audioFile]);
      const wav = await fsp.readFile(audioFile);
      if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') fail('invalid PCM WAV');
      let dataBytes = -1, fmtOK = false;
      for (let i = 12; i + 8 <= wav.length;) {
        const size = wav.readUInt32LE(i + 4), tag = wav.toString('ascii', i, i + 4);
        if (i + 8 + size > wav.length) fail('invalid WAV chunk');
        if (tag === 'fmt ' && size >= 16) fmtOK = wav.readUInt16LE(i + 8) === 1 && wav.readUInt16LE(i + 10) === 2 && wav.readUInt32LE(i + 12) === 48000 && wav.readUInt16LE(i + 22) === 16;
        if (tag === 'data') dataBytes = size;
        i += 8 + size + (size % 2);
      }
      if (!fmtOK || dataBytes !== durationSamples * 4) fail('PCM sample count/format mismatch');
      audio = { file: audioFile, sampleRate: 48000, channels: 2, bitsPerSample: 16, durationSamples, hash: await hash(audioFile) };
    }
    if (await hash(sourceFile) !== before || sig(await ordinary(sourceFile)) !== sig(sourceStat)) fail('source changed');
    const result = { video: { file: videoFile, width: nv.width, height: nv.height, fps: 30, frameCount, mime: 'video/mp4', normalizationVersion: 1, hash: await hash(videoFile) }, audio };
    await guard(); return result;
  } catch (e) {
    // Remove only files created by this invocation; caller owns the directory.
    for (const file of owned) {
      try {
        if (!await sameOutputDirectory()) break;
        const s = await fsp.lstat(file);
        if (s.isFile() && !s.isSymbolicLink() && sameIdentity(s, identities.get(file))) await fsp.unlink(file);
      } catch {}
    }
    throw e;
  }
}
module.exports = { normalizeVideo, assertSelfContainedMp4 };
