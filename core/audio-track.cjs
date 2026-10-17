'use strict';
const fs = require('fs');
const path = require('path');
const {randomUUID} = require('crypto');
const {parseVoiceWav} = require('./voice-import.cjs');
const {validateProject} = require('./model.cjs');
const {trackFadeErrors} = require('./audio-envelope.cjs');
const plain = value => value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function validateAudioTrackOptions(options) {
  if (!plain(options) || Reflect.ownKeys(options).some(key => !['kind', 'startFrame'].includes(key)) || !['sfx', 'bgm'].includes(options.kind) || !Number.isSafeInteger(options.startFrame) || options.startFrame < 0) throw Error('音轨导入参数无效');
}
function requireTrack(project, id) {
  if (typeof id !== 'string' || !id) throw Error('音轨 ID 无效');
  const track = (project.scene.audioTracks || []).find(t => t.id === id);
  if (!track) throw Error('音轨不存在');
  return track;
}
function importAudioTrack(session, sourceFile, projectRoot, options) {
  validateAudioTrackOptions(options);
  const bytes = fs.readFileSync(sourceFile);
  const info = parseVoiceWav(bytes);
  const uuid = randomUUID(), id = 'track_' + uuid, resourceId = 'audio_' + uuid;
  const relative = 'assets/imported/' + uuid + '.wav';
  const resource = {id: resourceId, kind: 'audio', mime: 'audio/wav', path: relative, sampleRate: info.sampleRate, channels: info.channels, bitsPerSample: info.bitsPerSample, durationSamples: info.durationSamples};
  const track = {id, name: path.basename(sourceFile, path.extname(sourceFile)), kind: options.kind, resourceId, startFrame: options.startFrame, durationSamples: info.durationSamples, gain: 1};
  const append = project => {
    if ((project.resources || []).some(r => r.id === resourceId)) throw Error('音轨资源 ID 冲突');
    (project.resources ||= []).push(resource);
    (project.scene.audioTracks ||= []).push(track);
  };
  const candidate = session.snapshot(); append(candidate);
  const errors = validateProject(candidate); if (errors.length) throw Error(errors.join('; '));
  const root = fs.realpathSync(projectRoot), directory = path.join(root, 'assets', 'imported');
  for (const part of [path.join(root, 'assets'), directory]) {
    if (fs.existsSync(part)) {
      const stat = fs.lstatSync(part);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('导入资源目录必须是工程内的普通目录');
    } else fs.mkdirSync(part);
  }
  const target = path.join(root, relative); let created = false;
  try {
    const fd = fs.openSync(target, 'wx'); created = true;
    try { fs.writeFileSync(fd, bytes); } finally { fs.closeSync(fd); }
    session.apply(append, 'import audio track');
  } catch (error) { if (created) fs.unlinkSync(target); throw error; }
  return {id, revision: session.revision};
}
function editAudioTrack(session, id, patch) {
  if (!plain(patch) || Reflect.ownKeys(patch).some(key => !['name', 'startFrame', 'gain', 'sourceOffsetSamples', 'durationSamples', 'fadeOutSamples'].includes(key))) throw Error('音轨属性无效');
  const candidate = session.snapshot(), track = requireTrack(candidate, id);
  const trimming = Object.hasOwn(patch, 'sourceOffsetSamples') || Object.hasOwn(patch, 'durationSamples');
  if (trimming) {
    const resource = candidate.resources.find(r => r.id === track.resourceId);
    if (!Number.isSafeInteger(resource?.durationSamples) || resource.durationSamples <= 0) throw Error('裁剪需要已知的源音频总样本数');
    if (Object.hasOwn(patch, 'sourceOffsetSamples') && (!Number.isSafeInteger(patch.sourceOffsetSamples) || patch.sourceOffsetSamples < 0)) throw Error('源音频偏移必须为非负整数样本');
    if (Object.hasOwn(patch, 'durationSamples') && (!Number.isSafeInteger(patch.durationSamples) || patch.durationSamples <= 0)) throw Error('音频播放长度必须为正整数样本');
  }
  const effectivePatch = {...patch};
  if (Object.hasOwn(patch, 'durationSamples') && !Object.hasOwn(patch, 'fadeOutSamples') && track.fadeOutSamples > patch.durationSamples)
    effectivePatch.fadeOutSamples = patch.durationSamples;
  Object.assign(track, effectivePatch);
  const errors = [...trackFadeErrors(track, candidate), ...validateProject(candidate)]; if (errors.length) throw Error(errors.join('; '));
  const before = requireTrack(session.snapshot(), id);
  const changed = Object.keys(effectivePatch).some(key => key === 'sourceOffsetSamples' ? (before[key] ?? 0) !== effectivePatch[key] : before[key] !== effectivePatch[key]);
  if (!changed) return {revision: session.revision};
  session.apply(project => { Object.assign(requireTrack(project, id), effectivePatch); }, 'edit audio track');
  return {revision: session.revision};
}
function splitAudioTrack(session, id, atFrame) {
  const candidate = session.snapshot();
  const track = requireTrack(candidate, id);
  const fps = candidate.design?.fps;
  const frameSamples = 48000 / fps;
  if (!Number.isSafeInteger(frameSamples) || frameSamples <= 0) throw Error('帧采样数必须为正整数');
  let splitFrame = atFrame;
  if (plain(atFrame)) {
    const keys = Reflect.ownKeys(atFrame);
    if (keys.length !== 1 || keys[0] !== 'atFrame') throw Error('拆分位置仅支持场景帧 atFrame');
    splitFrame = atFrame.atFrame;
  }
  if (!Number.isSafeInteger(splitFrame)) throw Error('拆分位置必须为整数场景帧');
  const resource = candidate.resources.find(r => r.id === track.resourceId);
  if (!Number.isSafeInteger(resource?.durationSamples) || resource.durationSamples <= 0) throw Error('切分需要已知的源音频总样本数');
  const offset = track.sourceOffsetSamples ?? 0;
  const elapsed = (splitFrame - track.startFrame) * frameSamples;
  if (!Number.isSafeInteger(elapsed) || !Number.isSafeInteger(splitFrame) || elapsed <= 0 || elapsed >= track.durationSamples) throw Error('拆分位置必须严格位于音轨区间内');
  const fadeErrors = trackFadeErrors(track, candidate);
  if (fadeErrors.length) throw Error(fadeErrors.join('; '));
  if (track.fadeOutSamples && elapsed > track.durationSamples - track.fadeOutSamples)
    throw Error('不能在淡出区间内部拆分音轨：fadeOutSamples 无法保持左段的原始包络');
  const leftDuration = elapsed, rightDuration = track.durationSamples - elapsed;
  const right = {...track, id: 'track_' + randomUUID(), name: track.name + ' (split)', startFrame: splitFrame, sourceOffsetSamples: offset + elapsed, durationSamples: rightDuration};
  track.durationSamples = leftDuration;
  if (track.fadeOutSamples) delete track.fadeOutSamples;
  candidate.scene.audioTracks.push(right);
  const errors = validateProject(candidate); if (errors.length) throw Error(errors.join('; '));
  session.apply(project => {
    const current = requireTrack(project, id);
    current.durationSamples = leftDuration;
    if (current.fadeOutSamples) delete current.fadeOutSamples;
    project.scene.audioTracks.push({...right});
  }, 'split audio track');
  return {id: right.id, revision: session.revision};
}
function deleteAudioTrack(session, id) {
  session.apply(project => {
    requireTrack(project, id);
    project.scene.audioTracks = project.scene.audioTracks.filter(track => track.id !== id);
  }, 'delete audio track');
  // Keep resources and managed files for other bindings, undo and export snapshots.
  return {revision: session.revision};
}
module.exports = {importAudioTrack, editAudioTrack, splitAudioTrack, deleteAudioTrack, validateAudioTrackOptions};
