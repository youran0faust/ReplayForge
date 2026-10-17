/* Shared pure policy: builder materializes interruptions and BGM restarts. */
(function (root) {
  'use strict';
  const SAMPLE_RATE = 48000;
  function samples(frame, fps) {
    const value = frame * SAMPLE_RATE / fps;
    if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isSafeInteger(value)) throw Error('Invalid video sample boundary');
    return value;
  }
  function videoIntervals(project) {
    const videos = project?.scene?.videoClips;
    if (videos === undefined) return [];
    if (!Array.isArray(videos)) throw Error('Invalid videoClips: expected array');
    if (!videos.length) return [];
    const fps = project?.design?.fps, endFrame = project?.scene?.durationFrames;
    if (project.schemaVersion !== 4 || fps !== 30 || !Number.isSafeInteger(endFrame) || endFrame <= 0) throw Error('Invalid schema4 video timeline');
    const resources = new Map(), ids = new Set();
    for (const resource of project.resources || []) {
      if (resources.has(resource.id)) throw Error(`Duplicate resource: ${resource.id}`);
      resources.set(resource.id, resource);
    }
    const intervals = videos.map(video => {
      if (!video || typeof video.id !== 'string' || !video.id || ids.has(video.id)) throw Error('Invalid or duplicate video clip id');
      ids.add(video.id);
      const startSamples = samples(video.startFrame, fps), endSamples = samples(video.endFrame, fps);
      if (video.endFrame > endFrame || endSamples <= startSamples) throw Error(`Invalid video range: ${video.id}`);
      const resource = resources.get(video.resourceId);
      if (!resource || resource.kind !== 'video') throw Error(`Missing video resource: ${video.resourceId}`);
      if (resource.normalizationVersion !== 1 || resource.mime !== 'video/mp4' || resource.fps !== fps || !Number.isSafeInteger(resource.width) || resource.width <= 0 || !Number.isSafeInteger(resource.height) || resource.height <= 0 || !Number.isSafeInteger(resource.frameCount) || resource.frameCount !== video.endFrame - video.startFrame) throw Error(`Invalid normalized video metadata or frame count: ${video.id}`);
      return {id: video.id, videoId: video.id, resource, startSamples, durationSamples: endSamples - startSamples};
    }).sort((a, b) => a.startSamples - b.startSamples);
    for (let i = 1; i < intervals.length; i++) if (intervals[i].startSamples < intervals[i - 1].startSamples + intervals[i - 1].durationSamples) throw Error('Overlapping video clips');
    return intervals;
  }
  function videoAudioClips(project) {
    const resources = new Map((project.resources || []).map(resource => [resource.id, resource]));
    return videoIntervals(project).flatMap(video => {
      const resourceId = video.resource.audioResourceId;
      if (resourceId === undefined) return [];
      const audio = resources.get(resourceId);
      if (typeof resourceId !== 'string' || !resourceId || !audio || audio.kind !== 'audio' || audio.sampleRate !== SAMPLE_RATE || audio.durationSamples !== video.durationSamples) throw Error(`Invalid normalized video WAV: ${video.id}`);
      return [{id: `video-audio:${video.id}`, videoId: video.id, resourceId, startSamples: video.startSamples, durationSamples: video.durationSamples, sourceOffsetSamples: 0}];
    });
  }
  // Half-open intervals; silence also blocks ordinary audio. Never truncate/restart here.
  function validateNoAudioOverlap(clips, videos) {
    for (const clip of clips) {
      const end = clip.startSamples + clip.durationSamples;
      if (!Number.isSafeInteger(clip.startSamples) || clip.startSamples < 0 || !Number.isSafeInteger(clip.durationSamples) || clip.durationSamples <= 0 || !Number.isSafeInteger(end)) throw Error('Invalid ordinary audio interval');
      for (const video of videos) if (clip.startSamples < video.startSamples + video.durationSamples && end > video.startSamples) throw Error(`Ordinary audio overlaps video: ${clip.id || clip.resourceId} / ${video.id}`);
    }
    return clips;
  }
  const api = {videoIntervals, videoAudioClips, validateNoAudioOverlap};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VideoAudioPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
