'use strict';
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.trim().length > 0;
const positive = v => Number.isSafeInteger(v) && v > 0;
const has = (v, key) => record(v) && Object.hasOwn(v, key);
// Metadata only: no media I/O or audio timeline truncation.
function videoErrors(project) {
  const errors = [], resources = Array.isArray(project?.resources) ? project.resources : [];
  const videos = resources.filter(r => r?.kind === 'video'), scene = project?.scene;
  const hasClips = has(scene, 'videoClips');
  if (!videos.length && !hasClips) return errors;
  if (project?.schemaVersion !== 4) errors.push('video requires schema4');
  if (project?.design?.fps !== 30) errors.push('video requires design fps 30');
  const audioLinks = new Set();
  for (const r of videos) {
    const label = `video resource ${r.id}`;
    if (!text(r.id) || resources.filter(x => x?.id === r.id).length !== 1) errors.push(`${label} id invalid or duplicate`);
    if (!text(r.path) || /\.html?(?:[?#]|$)/i.test(r.path)) errors.push(`${label} path invalid`);
    if (r.mime !== 'video/mp4') errors.push(`${label} mime must be video/mp4`);
    if (!positive(r.width) || r.width % 2 !== 0 || r.width > 1920) errors.push(`${label} width invalid`);
    if (!positive(r.height) || r.height % 2 !== 0 || r.height > 1080) errors.push(`${label} height invalid`);
    if (r.fps !== 30) errors.push(`${label} fps must be 30`);
    if (!positive(r.frameCount) || r.frameCount > 1800) errors.push(`${label} frameCount invalid`);
    if (r.normalizationVersion !== 1) errors.push(`${label} normalizationVersion must be 1`);
    if (has(r, 'audio') || has(r, 'audioPath')) errors.push(`${label} audio must use audioResourceId, not nested metadata or path`);
    if (has(r, 'audioResourceId')) {
      const id = r.audioResourceId, matches = resources.filter(x => x?.id === id), audio = matches[0];
      if (!text(id) || matches.length !== 1 || audio?.kind !== 'audio' || !text(audio.path) || /\.html?(?:[?#]|$)/i.test(audio.path) || audio.mime !== 'audio/wav' || audio.sampleRate !== 48000 || audio.bitsPerSample !== 16 || audio.channels !== 2 || !positive(audio.durationSamples) || audio.durationSamples !== r.frameCount * 1600) errors.push(`${label} audioResourceId must reference exact WAV 48k PCM16 full-duration audio`);
      if (audioLinks.has(id)) errors.push(`${label} duplicate audioResourceId link`);
      audioLinks.add(id);
    }
  }
  if (!hasClips) return errors;
  if (!Array.isArray(scene.videoClips)) return [...errors, 'videoClips must be an array'];
  const ids = new Set(), ranges = [];
  for (const clip of scene.videoClips) {
    if (!record(clip)) { errors.push('video clip invalid'); continue; }
    if (Reflect.ownKeys(clip).some(k => !['id', 'resourceId', 'startFrame', 'endFrame'].includes(k))) errors.push('video clip unknown field');
    if (!text(clip.id) || ids.has(clip.id)) errors.push('video clip id invalid or duplicate');
    ids.add(clip.id);
    const r = resources.find(x => x?.id === clip.resourceId);
    if (!text(clip.resourceId) || r?.kind !== 'video') errors.push('video clip resource missing or not video');
    if (!Number.isSafeInteger(clip.startFrame) || clip.startFrame < 0 || !positive(clip.endFrame) || clip.endFrame <= clip.startFrame || !positive(scene.durationFrames) || clip.endFrame > scene.durationFrames) errors.push('video clip range invalid');
    else ranges.push(clip);
    if (r?.kind === 'video' && clip.endFrame - clip.startFrame !== r.frameCount) errors.push('video clip must use full resource frameCount without trim');
  }
  ranges.sort((a, b) => a.startFrame - b.startFrame);
  let end = -1;
  for (const clip of ranges) {
    if (clip.startFrame < end) errors.push('video clips overlapping');
    end = Math.max(end, clip.endFrame);
  }
  return errors;
}
function videoAt(project, frame) {
  if (!Number.isSafeInteger(frame) || frame < 0 || project?.schemaVersion !== 4) return null;
  const clips = project?.scene?.videoClips;
  const clip = Array.isArray(clips) ? clips.find(c => c && frame >= c.startFrame && frame < c.endFrame) : null;
  if (!clip) return null;
  const r = (Array.isArray(project.resources) ? project.resources : []).find(x => x?.id === clip.resourceId && x.kind === 'video');
  if (!r) return null;
  return {clipId:clip.id, resourceId:r.id, localFrame:frame - clip.startFrame, width:r.width, height:r.height,
    ...(has(r, 'audioResourceId') ? {audioResourceId:r.audioResourceId} : {})};
}
function finalizeVideo(state, project, frame) {
  return has(project?.scene, 'videoClips') ? {...state, activeVideo:videoAt(project, frame)} : state;
}
module.exports = {videoErrors, videoAt, finalizeVideo};
