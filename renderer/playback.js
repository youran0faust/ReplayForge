/* DOM-independent WebAudio transport. */
(function (root) {
  'use strict';
  const audioEnvelope = typeof module !== 'undefined' && module.exports ? require('../core/audio-envelope.cjs') : root.AudioEnvelope;
  const videoAudioPolicy = typeof module !== 'undefined' && module.exports ? require('../core/video-audio-policy.cjs') : root.VideoAudioPolicy;
  function createPlaybackController({onFrame = () => {}, onState = () => {}, onError = () => {},
    audioContextFactory = () => new (root.AudioContext || root.webkitAudioContext)({sampleRate: 48000}),
    requestFrame = fn => root.requestAnimationFrame(fn), cancelFrame = id => root.cancelAnimationFrame(id)} = {}) {
    let context, state = 'stopped', frame = 0, generation = 0, raf = null, abort;
    let fps = 30, frameCount = 1, anchorTime = 0, anchorFrame = 0, rangeEndFrame = 1;
    const sources = new Set(), gains = new Map(), cache = new Map(), tolerance = 0.02;
    function currentFrame() {
      if (state === 'playing') frame = Math.min(rangeEndFrame - 1, Math.max(anchorFrame,
        Math.floor(anchorFrame + Math.max(0, context.currentTime - anchorTime) * fps + 1e-7)));
      return frame;
    }
    function cleanup() {
      if (raf !== null) { cancelFrame(raf); raf = null; }
      if (abort) { abort.abort(); abort = null; }
      for (const source of sources) {
        source.onended = null;
        try { source.stop(); } catch (_) { /* Already ended. */ }
        try { source.disconnect(); } catch (_) { /* Best-effort cleanup. */ }
      }
      for (const gain of gains.values()) {
        try { gain.disconnect(); } catch (_) { /* Best-effort cleanup. */ }
      }
      gains.clear(); sources.clear();
    }
    function transition(next) { state = next; onState(next, frame); }
    function pause() { currentFrame(); ++generation; cleanup(); transition('paused'); return frame; }
    function stop() {
      const token = ++generation;
      cleanup(); frame = 0; transition('stopped');
      if (token === generation) onFrame(frame);
      return frame;
    }
    function wavInfo(bytes) {
      const view = new DataView(bytes);
      const text = (at, size) => String.fromCharCode(...new Uint8Array(bytes, at, size));
      if (bytes.byteLength < 12 || text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') throw Error('Voice must be a WAV file');
      let rate, channels, blockAlign, format, dataBytes, bitsPerSample;
      for (let at = 12; at + 8 <= bytes.byteLength;) {
        const size = view.getUint32(at + 4, true), body = at + 8;
        if (body + size > bytes.byteLength) throw Error('Truncated WAV chunk');
        const tag = text(at, 4);
        if (tag === 'fmt ') {
          if (size < 16) throw Error('Invalid WAV format');
          format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
          rate = view.getUint32(body + 4, true); blockAlign = view.getUint16(body + 12, true); bitsPerSample = view.getUint16(body + 14, true);
        }
        if (tag === 'data') dataBytes = size;
        at = body + size + (size % 2);
      }
      if (![1, 3, 65534].includes(format) || !channels || !blockAlign || !dataBytes || dataBytes % blockAlign) throw Error('Invalid WAV audio');
      if (rate !== 48000) throw Error('Voice WAV sample rate must be 48000 Hz');
      return {duration: dataBytes / blockAlign / rate, durationSamples: dataBytes / blockAlign, channels, bitsPerSample, blockAlign, format};
    }
    async function load(url, signal, token) {
      if (cache.has(url)) {
        const entry = cache.get(url); cache.delete(url); cache.set(url, entry); return entry;
      }
      const response = await root.fetch(url, {signal});
      if (!response.ok) throw Error(`Unable to fetch voice: ${url} (${response.status})`);
      const bytes = await response.arrayBuffer();
      if (token !== generation) return null;
      const info = wavInfo(bytes), buffer = await context.decodeAudioData(bytes);
      if (token !== generation) return null;
      if (!Number.isFinite(buffer.duration) || buffer.duration <= 0 || Math.abs(buffer.duration - info.duration) > tolerance) throw Error('Decoded WAV duration mismatch');
      const entry = {buffer, ...info};
      cache.set(url, entry);
      while (cache.size > 16) cache.delete(cache.keys().next().value);
      return entry;
    }
    async function play(project, resourceUrls = {}, startFrame = 0, options) {
      const token = ++generation;
      cleanup(); state = 'loading';
      try {
        fps = project?.design?.fps; frameCount = project?.scene?.durationFrames;
        if (!Number.isFinite(fps) || fps <= 0 || !Number.isSafeInteger(frameCount) || frameCount < 1) throw Error('Invalid playback timeline');
        const ranged = options !== undefined;
        if (ranged && (!options || typeof options !== 'object' || Array.isArray(options) || !Object.prototype.hasOwnProperty.call(options, 'endFrame'))) throw Error('Invalid playback range');
        if (ranged && (!Number.isSafeInteger(startFrame) || startFrame < 0)) throw Error('Invalid playback start frame');
        if (!ranged && !Number.isFinite(startFrame)) throw Error('Invalid playback start frame');
        rangeEndFrame = ranged ? options.endFrame : frameCount;
        if (!Number.isSafeInteger(rangeEndFrame) || rangeEndFrame > frameCount || rangeEndFrame < 1 || (ranged && startFrame >= rangeEndFrame)) throw Error('Invalid playback range');
        frame = ranged ? startFrame : Math.min(frameCount - 1, Math.max(0, Math.floor(startFrame)));
        const resources = new Map();
        for (const resource of project.resources || []) {
          if (resources.has(resource.id)) throw Error(`Duplicate resource: ${resource.id}`);
          resources.set(resource.id, resource);
        }
        const voices = [], explicitVoices = [], ordinaryIntervals = [], videoVoices = [];
        for (const dialogue of project.scene.dialogues || []) {
          if (dialogue.voiceClips !== undefined && !Array.isArray(dialogue.voiceClips)) throw Error('Invalid voiceClips: expected array');
          const clipIds = new Set();
          // A migrated collection owns playback, even when empty; never play the legacy mirror twice.
          for (const voice of dialogue.voiceClips !== undefined ? dialogue.voiceClips : (dialogue.voice ? [dialogue.voice] : [])) {
          const isClip = dialogue.voiceClips !== undefined;
          if (isClip) {
            if (!voice || typeof voice.id !== 'string' || !voice.id || clipIds.has(voice.id)) throw Error('Invalid or duplicate voice clip id');
            clipIds.add(voice.id);
            if (voice.sampleRate !== 48000 || !voice.binding || !Number.isSafeInteger(voice.sourceOffsetSamples)) throw Error('Invalid voice clip metadata');
          }
          const {resourceId, durationSamples} = voice;
          const resource = resources.get(resourceId), url = resourceUrls[resourceId];
          if (!resource || resource.kind !== 'audio' || typeof url !== 'string' || !url) throw Error(`Missing voice resource or URL: ${resourceId}`);
          if (resource.sampleRate != null && resource.sampleRate !== 48000) throw Error(`Voice sample rate must be 48000 Hz: ${resourceId}`);
          if (!Number.isSafeInteger(durationSamples) || durationSamples <= 0 || !Number.isSafeInteger(dialogue.startFrame) || dialogue.startFrame < 0) throw Error(`Invalid voice timing: ${resourceId}`);
          const binding = voice.binding, explicit = binding !== undefined;
          let effectiveStart = dialogue.startFrame, sourceOffsetSamples = 0;
          if (explicit) {
            if (!binding || binding.dialogueId !== dialogue.id || !['follow','independent'].includes(binding.mode)) throw Error('Invalid voice binding');
            const offset = binding.followOffsetFrames === undefined ? 0 : binding.followOffsetFrames;
            if (!Number.isSafeInteger(offset)) throw Error('Invalid voice follow offset');
            effectiveStart = binding.mode === 'follow' ? dialogue.startFrame + offset : voice.startFrame;
            sourceOffsetSamples = voice.sourceOffsetSamples === undefined ? 0 : voice.sourceOffsetSamples;
            if (!Number.isSafeInteger(sourceOffsetSamples) || sourceOffsetSamples < 0 || !Number.isSafeInteger(sourceOffsetSamples + durationSamples)) throw Error('Invalid voice source range');
            if (resource.durationSamples !== undefined && (!Number.isSafeInteger(resource.durationSamples) || resource.durationSamples <= 0 || sourceOffsetSamples + durationSamples > resource.durationSamples)) throw Error('Voice source range exceeds source');
          }
          const startSamples = effectiveStart * 48000 / fps, sceneSamples = frameCount * 48000 / fps;
          if (!Number.isSafeInteger(effectiveStart) || effectiveStart < 0 || !Number.isSafeInteger(startSamples) || !Number.isSafeInteger(sceneSamples) || !Number.isSafeInteger(startSamples + durationSamples) || startSamples + durationSamples > sceneSamples) throw Error(`Voice extends beyond scene: ${resourceId}`);
          const start = effectiveStart / fps, duration = durationSamples / 48000;
          const end = start + duration;
          const clip = {url, start, duration, end: Math.min(end, rangeEndFrame / fps), resourceId, ...(explicit ? {voiceTrim:true, durationSamples,sourceOffsetSamples,sourceOffset:sourceOffsetSamples/48000,sourceDurationSamples:resource.durationSamples,voiceSourceDurationSamples:voice.sourceDurationSamples} : {})};
          ordinaryIntervals.push({id: voice.id || dialogue.id, startSamples, durationSamples});
          if (explicit) explicitVoices.push(clip);
          if (end > frame / fps && start < rangeEndFrame / fps) voices.push(clip);
          }
        }
        if (project.scene.audioTracks !== undefined && !Array.isArray(project.scene.audioTracks)) throw Error('Invalid audioTracks: expected array');
        const tracks = [], trackIds = new Set();
        for (const track of project.scene.audioTracks || []) {
          if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) throw Error('Invalid or duplicate audio track id');
          trackIds.add(track.id);
          if (Object.prototype.hasOwnProperty.call(track, 'fadeOutSamples')) {
            if (!audioEnvelope) throw Error('AudioEnvelope module is required for fadeOutSamples');
            const errors = audioEnvelope.trackFadeErrors(track, project);
            if (errors.length) throw Error(errors.join('; '));
          }
          if (typeof track.name !== 'string' || !['sfx', 'bgm'].includes(track.kind)) throw Error(`Invalid audio track: ${track.id}`);
          if (!Number.isFinite(track.gain) || track.gain < 0 || track.gain > 2) throw Error(`Invalid audio track gain: ${track.id}`);
          const {resourceId, durationSamples} = track, resource = resources.get(resourceId), url = resourceUrls[resourceId];
          if (!resource || resource.kind !== 'audio' || typeof url !== 'string' || !url) throw Error(`Missing audio track resource or URL: ${resourceId}`);
          if (resource.sampleRate != null && resource.sampleRate !== 48000) throw Error(`Audio track sample rate must be 48000 Hz: ${resourceId}`);
          if (!Number.isSafeInteger(durationSamples) || durationSamples <= 0 || !Number.isSafeInteger(track.startFrame) || track.startFrame < 0) throw Error(`Invalid audio track timing: ${resourceId}`);
          const startSamples = track.startFrame * 48000 / fps, sceneSamples = frameCount * 48000 / fps;
          if (!Number.isSafeInteger(startSamples) || !Number.isSafeInteger(sceneSamples)) throw Error('Non-integral or unsafe audio track sample boundary');
          const sourceOffsetSamples = track.sourceOffsetSamples === undefined ? 0 : track.sourceOffsetSamples;
          if (!Number.isSafeInteger(sourceOffsetSamples) || sourceOffsetSamples < 0 || !Number.isSafeInteger(sourceOffsetSamples + durationSamples)) throw Error(`Invalid audio track source range: ${resourceId}`);
          if (resource.durationSamples != null && (!Number.isSafeInteger(resource.durationSamples) || resource.durationSamples <= 0 || sourceOffsetSamples + durationSamples > resource.durationSamples)) throw Error(`Audio track source range exceeds source: ${resourceId}`);
          if (!Number.isSafeInteger(startSamples + durationSamples) || startSamples + durationSamples > sceneSamples) throw Error(`Audio track extends beyond scene: ${resourceId}`);
          const start = startSamples / 48000, duration = durationSamples / 48000;
          const clip = {url, start, startSamples, duration, durationSamples, sourceOffsetSamples, sourceOffset: sourceOffsetSamples / 48000, sourceDurationSamples: resource.durationSamples, end: Math.min(start + duration, rangeEndFrame / fps), resourceId, trackId: track.id, gain: track.gain, ...(track.fadeOutSamples ? {fadeOutSamples: track.fadeOutSamples} : {})};
          ordinaryIntervals.push({id: track.id, startSamples, durationSamples});
          tracks.push(clip); // Validate the full WAV even for tracks outside the preview range.
          if (start + duration > frame / fps && start < rangeEndFrame / fps) voices.push(clip);
        }
        if (project.scene.videoClips !== undefined) {
          if (!videoAudioPolicy) throw Error('VideoAudioPolicy module is required');
          videoAudioPolicy.validateNoAudioOverlap(ordinaryIntervals, videoAudioPolicy.videoIntervals(project));
          for (const descriptor of videoAudioPolicy.videoAudioClips(project)) {
            const url = resourceUrls[descriptor.resourceId];
            if (typeof url !== 'string' || !url) throw Error(`Missing video WAV URL: ${descriptor.resourceId}`);
            const start = descriptor.startSamples / 48000, duration = descriptor.durationSamples / 48000;
            const clip = {...descriptor, url, start, duration, sourceOffset: 0, end: Math.min(start + duration, rangeEndFrame / fps)};
            videoVoices.push(clip);
            if (start + duration > frame / fps && start < rangeEndFrame / fps) voices.push(clip);
          }
        }
        context ||= audioContextFactory();
        // Resume before the first await, preserving the initiating user gesture.
        const resumed = Promise.resolve(context.resume());
        abort = new AbortController();
        const signal = abort.signal;
        transition('loading');
        if (token !== generation) { await resumed; return false; }
        const loads = new Map();
        const validated = [...voices.filter(voice => voice.trackId === undefined && !voice.voiceTrim && voice.videoId === undefined), ...explicitVoices, ...tracks, ...videoVoices];
        for (const voice of validated) if (!loads.has(voice.url)) loads.set(voice.url, load(voice.url, signal, token));
        const [, entries] = await Promise.all([resumed, Promise.all([...loads.values()])]);
        if (token !== generation) return false;
        const decoded = new Map([...loads.keys()].map((url, index) => [url, entries[index]]));
        for (const voice of validated) {
          const info = decoded.get(voice.url);
          if (voice.videoId !== undefined) {
            if (info.format !== 1 || info.channels !== 2 || info.bitsPerSample !== 16 || info.blockAlign !== 4 || info.durationSamples !== voice.durationSamples || info.buffer.sampleRate !== 48000 || info.buffer.numberOfChannels !== 2 || info.buffer.length !== voice.durationSamples) throw Error(`Invalid decoded normalized video WAV: ${voice.resourceId}`);
            continue;
          }
          if ((voice.trackId !== undefined || voice.voiceTrim) && (![1, 2].includes(info.channels) || ![8, 16, 24, 32].includes(info.bitsPerSample) || info.blockAlign !== info.channels * info.bitsPerSample / 8)) throw Error(`Unsupported audio track WAV: ${voice.resourceId}`);
          if (voice.trackId !== undefined || voice.voiceTrim) {
            if (voice.voiceTrim && voice.voiceSourceDurationSamples !== undefined && info.durationSamples !== voice.voiceSourceDurationSamples) throw Error('Voice source duration metadata mismatch');
            if (voice.sourceDurationSamples != null && info.durationSamples !== voice.sourceDurationSamples) throw Error(`Audio source duration metadata mismatch: ${voice.resourceId}`);
            if (voice.sourceOffsetSamples + voice.durationSamples > info.durationSamples) throw Error(`Audio track source range exceeds decoded WAV: ${voice.resourceId}`);
          } else if (Math.abs(info.duration - voice.duration) > tolerance) throw Error(`Audio duration metadata mismatch: ${voice.resourceId}`);
        }
        abort = null;
        anchorFrame = frame; anchorTime = context.currentTime;
        const position = frame / fps;
        for (const voice of voices) {
          const {buffer} = decoded.get(voice.url);
          const video = voice.videoId !== undefined;
          const positionSamples = frame * 48000 / fps;
          const elapsedSamples = video ? Math.max(0, positionSamples - voice.startSamples) : 0;
          const offset = video ? elapsedSamples / 48000 : (voice.sourceOffset || 0) + Math.max(0, position - voice.start);
          const duration = video ? (Math.min(voice.startSamples + voice.durationSamples, rangeEndFrame * 48000 / fps) - Math.max(positionSamples, voice.startSamples)) / 48000 : Math.min(voice.end - Math.max(position, voice.start), buffer.duration - offset);
          if (duration <= 0) continue;
          const source = context.createBufferSource();
          sources.add(source); source.buffer = buffer;
          if (voice.trackId !== undefined) {
            const gain = context.createGain(); gains.set(source, gain);
            if (voice.fadeOutSamples) {
              // Source offsets select WAV data; envelope time belongs only to the clip.
              const elapsedSamples = Math.max(0, frame * 48000 / fps - voice.startSamples);
              const when = anchorTime + Math.max(0, voice.start - position);
              const fadeStart = voice.durationSamples - voice.fadeOutSamples;
              gain.gain.setValueAtTime(voice.gain * audioEnvelope.envelopeAtSample(voice.durationSamples, voice.fadeOutSamples, elapsedSamples), when);
              if (elapsedSamples < fadeStart) gain.gain.setValueAtTime(voice.gain, when + (fadeStart - elapsedSamples) / 48000);
              // Keep the original clip end even when a preview range ends earlier.
              gain.gain.linearRampToValueAtTime(0, when + (voice.durationSamples - elapsedSamples) / 48000);
            } else gain.gain.value = voice.gain;
            source.connect(gain); gain.connect(context.destination);
          } else source.connect(context.destination);
          source.onended = () => {
            source.disconnect(); sources.delete(source);
            const gain = gains.get(source);
            if (gain) { gain.disconnect(); gains.delete(source); }
          };
          source.start(anchorTime + (video ? Math.max(0, voice.startSamples - positionSamples) / 48000 : Math.max(0, voice.start - position)), offset, duration);
        }
        transition('playing');
        if (token !== generation) return false;
        onFrame(frame);
        if (token !== generation) return false;
        function tick() {
          if (token !== generation || state !== 'playing') return;
          raf = null;
          const previous = frame;
          currentFrame();
          const ended = anchorFrame / fps + Math.max(0, context.currentTime - anchorTime) >= rangeEndFrame / fps - 1e-9;
          if (frame !== previous || ended) onFrame(frame);
          if (token !== generation) return;
          if (ended) { cleanup(); transition('ended'); return; }
          raf = requestFrame(tick);
        }
        raf = requestFrame(tick);
        return true;
      } catch (error) {
        if (token !== generation) return false;
        cleanup(); transition('error');
        if (token === generation) onError(error);
        throw error;
      }
    }
    return {play, pause, stop, get state() { return state; }, get frame() { return currentFrame(); },
      getState: () => state, getFrame: currentFrame};
  }
  root.createPlaybackController = createPlaybackController;
  if (typeof module !== 'undefined' && module.exports) module.exports = {createPlaybackController};
})(typeof globalThis !== 'undefined' ? globalThis : window);
